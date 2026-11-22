#!/usr/bin/env node
'use strict';
/**
 * Optional UI smoke for the outline: drives a headless Chrome over CDP (Node 22+ built-ins only).
 * Requires Chrome/Edge:  node test/ui-smoke.js [path-to-index.html]
 * Checks narrow-sheet rotation, docked inspector geometry, active row, hold clearing, auto-open floors.
 * Not part of node test/core.test.js - that suite is dependency-free; this one is the interactive layer.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const PAGE = pathToFileURL(path.resolve(process.argv[2] || path.join(ROOT, 'index.html'))).href;
const PROFILE = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'sm-ui-smoke-profile');
const PORT = 9337;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'google-chrome',
  'chromium-browser',
  'chromium',
];

function whichOnPath(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const d of dirs) {
    for (const ext of exts) {
      const p = path.join(d, cmd + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function findChrome() {
  const env = process.env.CHROME_BIN;
  if (env) {
    const found = fs.existsSync(env) ? env : whichOnPath(env);
    if (!found) {
      console.log(`FAIL: CHROME_BIN=${JSON.stringify(env)} not found`);
      process.exit(1);
    }
    return found;
  }
  for (const c of CHROME_CANDIDATES) {
    const found = path.isAbsolute(c) ? (fs.existsSync(c) ? c : null) : whichOnPath(c);
    if (found && fs.existsSync(found)) return found;
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result || {});
      }
    });
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const onErr = err => reject(err instanceof Error ? err : new Error(String(err)));
      ws.addEventListener('error', onErr, { once: true });
      ws.addEventListener('open', () => {
        ws.removeEventListener('error', onErr);
        resolve(new CdpClient(ws));
      }, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async ev(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return res && res.result ? res.result.value : undefined;
  }

  close() {
    this.ws.close();
  }
}

async function waitForDebuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) {
        const tabs = await resp.json();
        const pg = tabs.find(t => t.type === 'page');
        if (pg && pg.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl;
      }
    } catch {
      // retry until Chrome CDP endpoint is up
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chrome CDP on port ${PORT}`);
}

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) {
    console.log('SKIP: no Chrome/Edge found (set CHROME_BIN to point at one)');
    process.exit(0);
  }
  console.log(`using ${chromeBin}`);

  const chrome = spawn(
    chromeBin,
    [
      '--headless=new',
      '--disable-gpu',
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${PORT}`,
      '--window-size=1500,1000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const fails = [];
  const check = (name, cond) => {
    console.log(`${cond ? 'OK  ' : 'FAIL'} | ${name}`);
    if (!cond) fails.push(name);
  };

  let cdp = null;
  try {
    const wsUrl = await waitForDebuggerUrl();
    cdp = await CdpClient.connect(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: PAGE });
    for (let i = 0; i < 60; i++) {
      if (await cdp.ev("Boolean(document.getElementById('toc'))")) break;
      await sleep(400);
    }
    await cdp.ev('try{localStorage.clear()}catch(e){}');
    await cdp.send('Page.navigate', { url: PAGE });
    for (let i = 0; i < 60; i++) {
      if (await cdp.ev("document.querySelectorAll('#toc [data-goto]').length > 0")) break;
      await sleep(400);
    }
    await sleep(1000);

    check('wide auto-opens the outline on the Assessment', await cdp.ev("!document.getElementById('toc').hidden"));
    await cdp.ev("document.querySelector('.doc .blk .s').click()");
    await sleep(500);
    check('wide: inspector under outline', await cdp.ev("document.getElementById('insp').getBoundingClientRect().top >= document.getElementById('toc').getBoundingClientRect().bottom"));
    check('wide: inspector inside viewport', await cdp.ev("document.getElementById('insp').getBoundingClientRect().bottom <= innerHeight"));
    check('wide: outline stays', await cdp.ev("!document.getElementById('toc').hidden"));

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 620, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    check('short wide window: both fit', await cdp.ev("document.getElementById('insp').getBoundingClientRect().bottom <= innerHeight + 1 && !document.getElementById('toc').hidden"));
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(600);
    await cdp.ev('closeInsp()');
    await sleep(300);

    await cdp.ev("openDoc(null, [{type:'p', text:'Just a plain document without any headings at all. '.repeat(30)}], {name:'plain'})");
    await sleep(600);
    check('headingless: Outline is aria-disabled and dimmed', await cdp.ev("document.getElementById('btnToc').getAttribute('aria-disabled') === 'true'"));
    await cdp.ev("document.getElementById('btnToc').click()");
    await sleep(300);
    check('headingless: dead click changes nothing and writes no pref', await cdp.ev("document.getElementById('btnToc').getAttribute('aria-pressed') === 'false' && !localStorage.getItem('sm.toc')"));

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: true });
    await sleep(600);
    await cdp.ev("const s=document.getElementById('selDemo'); s.value='0'; s.dispatchEvent(new Event('change'));");
    await sleep(1000);

    const oneSheet = () =>
      cdp.ev("[document.getElementById('spec').hidden, document.getElementById('insp').hidden, document.getElementById('toc').hidden].filter(x=>!x).length == 1");

    await cdp.ev("document.querySelector('.doc .blk .s').click()");
    await sleep(400);
    check('narrow: select shows exactly one sheet', await oneSheet());
    await cdp.ev("document.getElementById('btnToc').click()");
    await sleep(400);
    check('narrow: Outline click with a selection shows the outline (not blank)', await cdp.ev("!document.getElementById('toc').hidden"));
    check('narrow: still exactly one sheet', await oneSheet());
    await cdp.ev("document.getElementById('btnSpec').click()");
    await sleep(400);
    check('narrow: Spectrum comes to front, outline retreats', await cdp.ev("!document.getElementById('spec').hidden && document.getElementById('toc').hidden"));
    await cdp.ev('closeInsp()');
    await sleep(300);
    await cdp.ev("document.getElementById('btnSpec').click()");
    await sleep(400);
    await cdp.ev("document.getElementById('btnToc').click()");
    await sleep(400);
    check('narrow: outline opens without a selection too', await cdp.ev("!document.getElementById('toc').hidden"));

    await cdp.ev("document.querySelector('.doc .blk .s').click()");
    await sleep(300);
    await cdp.ev("document.getElementById('btnToc').click()");
    await sleep(300);
    check('narrow: outline front while selected', await cdp.ev("!document.getElementById('toc').hidden"));
    await cdp.ev("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))");
    await sleep(400);
    check('narrow: Escape closes outline and keeps one visible sheet', await cdp.ev("document.getElementById('toc').hidden && [ 'spec','insp','toc' ].some(id => !document.getElementById(id).hidden)"));
    check('narrow: still exactly one sheet after Escape', await oneSheet());
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  } finally {
    if (cdp) {
      try { cdp.close(); } catch {}
    }
    chrome.kill('SIGTERM');
    await sleep(200);
    if (chrome.exitCode === null) {
      try { chrome.kill('SIGKILL'); } catch {}
    }
  }

  console.log('UI SMOKE ' + (!fails.length ? 'OK' : 'FAILED: ' + fails.join('; ')));
  process.exit(fails.length ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
