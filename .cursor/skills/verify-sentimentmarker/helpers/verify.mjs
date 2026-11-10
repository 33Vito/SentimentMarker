#!/usr/bin/env node
'use strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  if (name.startsWith('--') && (args[i + 1] == null || args[i + 1].startsWith('--'))) return true;
  return args[i + 1];
};
const DOCTOR = args.includes('--doctor');
const SERVE = args.includes('--serve');
const BASE = flag('--base', '');
const OUT = path.resolve(flag('--out', '/tmp/sentimentmarker-verify'));
const CHROME = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome']
  .find(p => existsSync(p));

function fail(msg) { console.error(msg); process.exit(1); }

async function httpGet(url) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, text };
}

function startStatic(portWanted) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
      createReadStream(file)
        .on('open', () => { res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); })
        .on('error', () => { res.writeHead(404); res.end('not found'); })
        .pipe(res);
    });
    server.listen(portWanted, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    server.on('error', reject);
  });
}

async function waitHttp(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await httpGet(url); if (r.status === 200) return r; } catch {}
    await sleep(150);
  }
  throw new Error('not ready: ' + url);
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = [];
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled') {
        const txt = (m.params.args || []).map(a => a.value || a.description || '').join(' ');
        this.logs.push('console ' + m.params.type + ': ' + txt);
      }
      if (m.method === 'Runtime.exceptionThrown') this.logs.push('exception: ' + ((m.params.exceptionDetails || {}).text || '') + ' ' + (((m.params.exceptionDetails || {}).exception || {}).description || ''));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP timeout ' + method)), 20000);
      this.pending.set(id, m => { clearTimeout(t); if (m.error) reject(new Error(method + ': ' + m.error.message)); else resolve(m.result || {}); });
    });
  }
  eval(expression) {
    return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      .then(r => {
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
        return r.result ? r.result.value : undefined;
      });
  }
}

async function connectChrome(port) {
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); if (list.length) break; } catch {}
    await sleep(100);
  }
  if (!list || !list.length) throw new Error('no chrome tabs on ' + port);
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { cdp, ws };
}

async function screenshot(cdp, file, sel) {
  if (sel) {
    await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      const bar = (document.getElementById('bar') || { offsetHeight: 0 }).offsetHeight;
      const top = el.getBoundingClientRect().top + window.scrollY - bar - 12;
      window.scrollTo(0, Math.max(0, top));
      return true;
    })()`);
    await sleep(400);
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(file, Buffer.from(data, 'base64'));
}

async function doctor(base) {
  const index = await waitHttp(base + '/index.html');
  const core = await waitHttp(base + '/core.js');
  const story = await waitHttp(base + '/SentimentStoryDemo.html');
  const info = {
    base, chrome: CHROME || null,
    index: index.status, core: core.status, story: story.status,
    indexLoadsCore: /src=["']core\.js["']/.test(index.text),
    storyLoadsCore: /src=["']core\.js["']/.test(story.text),
    storyHasOwnDocFromScored: /function docFromScored\s*\(/.test(story.text)
  };
  const ok = info.index === 200 && info.core === 200 && info.story === 200 && info.indexLoadsCore && info.storyLoadsCore && !info.storyHasOwnDocFromScored && !!CHROME;
  return { ok, info };
}

async function drive(base, out) {
  await mkdir(out, { recursive: true });
  const dbgPort = 9338;
  const profile = '/tmp/sm-verify-' + process.pid;
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + dbgPort,
    '--window-size=1500,1000', 'about:blank'
  ], { stdio: 'ignore' });
  const stop = () => { try { chrome.kill('SIGTERM'); } catch {} };
  process.on('exit', stop);
  try {
    const { cdp, ws } = await connectChrome(dbgPort);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

    await cdp.send('Page.navigate', { url: base + '/index.html' });
    for (let i = 0; i < 80; i++) {
      if (await cdp.eval(`!!document.querySelector('#tsum .ti') && document.querySelectorAll('#chips .chip').length > 0`)) break;
      await sleep(200);
    }
    const tsumReady = await cdp.eval(`({ hidden: document.getElementById('tsum').hidden, topics: document.querySelectorAll('#tsum .ti').length, dual: (document.querySelector('#tsum .sub')||{}).textContent || '', chips: [...document.querySelectorAll('#chips .chip')].map(c => c.className), title: (document.querySelector('#dochead h1')||{}).textContent || '' })`);
    if (!tsumReady.topics) throw new Error('reader summary did not render: ' + JSON.stringify(tsumReady));
    if (!/counts toward both/.test(tsumReady.dual)) throw new Error('dual-count copy missing: ' + tsumReady.dual);
    await screenshot(cdp, path.join(out, 'index-tsum.png'), '#tsum');
    await screenshot(cdp, path.join(out, 'index-chips.png'), '#topics');
    const tocOpen = await cdp.eval(`!document.getElementById('toc').hidden && document.querySelectorAll('#toc .tdot').length`);
    if (tocOpen) await screenshot(cdp, path.join(out, 'index-toc.png'), '#toc');

    const before = await cdp.eval(`(() => { const b = document.querySelector('#tsum [data-sent]'); if (!b) return null; const r = b.getBoundingClientRect(); return { id: +b.dataset.sent, text: b.textContent, x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
    if (!before) throw new Error('no source sentence in #tsum');
    await cdp.eval(`document.querySelector('#tsum [data-sent]').click()`);
    await sleep(700);
    const after = await cdp.eval(`(() => { const sel = document.querySelector('.s.sel'); return { selected: !!sel, id: sel ? +sel.dataset.s : null, inspectorOpen: !document.getElementById('insp').hidden, text: sel ? sel.textContent.slice(0, 180) : '' }; })()`);
    if (!after.selected || after.id !== before.id) throw new Error('jump failed: ' + JSON.stringify({ before, after }));
    await screenshot(cdp, path.join(out, 'index-jump.png'), '.s.sel');
    await screenshot(cdp, path.join(out, 'index-insp.png'), '#insp');
    await writeFile(path.join(out, 'index-jump.json'), JSON.stringify({ beforeId: before.id, afterId: after.id, selected: after.selected, inspectorOpen: after.inspectorOpen, text: after.text, title: tsumReady.title }, null, 2));

    await cdp.send('Page.navigate', { url: base + '/SentimentStoryDemo.html' });
    for (let i = 0; i < 80; i++) {
      if (await cdp.eval(`document.querySelectorAll('#topics .tp').length > 0 && document.querySelectorAll('#story .s').length > 10`)) break;
      await sleep(200);
    }
    const storyReady = await cdp.eval(`({
      topics: document.querySelectorAll('#topics .tp').length,
      sents: document.querySelectorAll('#story .s').length,
      title: (document.getElementById('title')||{}).textContent || '',
      toast: (document.getElementById('toast')||{}).textContent || '',
      docFromScored: typeof docFromScored,
      href: location.href,
      ready: document.readyState
    })`);
    await cdp.eval(`window.scrollTo(0, Math.round(innerHeight * 0.9))`);
    await sleep(500);
    if (!storyReady.topics) {
      const extra = await cdp.eval(`(() => {
        try {
          return {
            demos: (window.DEMOS || []).length,
            pick: document.getElementById('pick') && document.getElementById('pick').options.length,
            typeofBuild: typeof build,
            typeofOpen: typeof open,
            err: window.__err || null,
            kicker: (document.getElementById('kicker')||{}).textContent,
            tryBuild: (() => { try { const d = build(window.DEMOS[0].scored); return { sents: d.sents.length, topics: d.topics.length, title: d.title }; } catch (e) { return { error: String(e && e.stack || e) }; } })()
          };
        } catch (e) { return { outer: String(e && e.stack || e) }; }
      })()`);
      throw new Error('story topics missing: ' + JSON.stringify({ storyReady, extra, logs: cdp.logs.slice(-20) }));
    }
    await screenshot(cdp, path.join(out, 'story-topics.png'), '#rail');
    const fromId = await cdp.eval(`document.querySelectorAll('#story .s.now').length ? +document.querySelector('#story .s.now').dataset.s : -1`);
    await cdp.eval(`document.querySelector('#topics .tp').click()`);
    await sleep(900);
    const to = await cdp.eval(`(() => { const now = document.querySelector('#story .s.now') || document.querySelector('#story .s.flash'); return now ? { id: +now.dataset.s, text: now.textContent.slice(0, 180) } : null; })()`);
    if (!to) throw new Error('story jump produced no current sentence');
    await screenshot(cdp, path.join(out, 'story-jump.png'));
    await writeFile(path.join(out, 'story-jump.json'), JSON.stringify({ fromId, toId: to.id, text: to.text, title: storyReady.title, topics: storyReady.topics }, null, 2));

    ws.close();
    const pub = '/opt/cursor/artifacts';
    try {
      await mkdir(pub, { recursive: true });
      for (const name of ['index-tsum.png', 'index-jump.png', 'index-insp.png', 'index-chips.png', 'index-toc.png', 'story-topics.png', 'story-jump.png', 'index-jump.json', 'story-jump.json', 'doctor.json']) {
        const src = path.join(out, name);
        if (existsSync(src)) await writeFile(path.join(pub, name), await readFile(src));
      }
    } catch (e) { console.warn('artifact copy skipped', e.message); }
    console.log('VERIFY OK');
    console.log(JSON.stringify({ tsumReady, after, storyReady, to, out }, null, 2));
  } finally {
    stop();
  }
}

const main = async () => {
  if (!CHROME) fail('SKIP: no Chrome found');
  let server, base = BASE.replace(/\/$/, '');
  if (SERVE || !base) {
    const started = await startStatic(0);
    server = started.server;
    base = 'http://127.0.0.1:' + started.port;
  }
  try {
    const d = await doctor(base);
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, 'doctor.json'), JSON.stringify(d, null, 2));
    if (!d.ok) fail('DOCTOR FAIL ' + JSON.stringify(d.info));
    console.log('DOCTOR OK ' + JSON.stringify(d.info));
    if (DOCTOR) return;
    await drive(base, OUT);
  } finally {
    if (server) server.close();
  }
};

main().catch(err => { console.error(err); process.exit(1); });
