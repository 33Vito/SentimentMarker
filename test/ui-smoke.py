#!/usr/bin/env python
"""Optional UI smoke for the outline: drives a headless Chrome over CDP (no npm needed).
Requires Chrome/Edge and Python websocket-client:  uv run --with websocket-client python test/ui-smoke.py [path-to-index.html]
Checks narrow-sheet rotation, docked inspector geometry, active row, hold clearing, auto-open floors.
Not part of node test/core.test.js - that suite is dependency-free; this one is the interactive layer.
"""
import json, os, subprocess, sys, time, urllib.request
import websocket

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PAGE = 'file:///' + (sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'index.html').replace('\\', '/')).replace('\\', '/')
PROFILE = os.path.join(os.environ.get('LOCALAPPDATA', '/tmp'), 'sm-ui-smoke-profile')
PORT = 9337
CHROME_CANDIDATES = [r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"]
chrome_bin = next((c for c in CHROME_CANDIDATES if os.path.exists(c)), None)
if not chrome_bin:
    print('SKIP: no Chrome/Edge found'); sys.exit(0)

chrome = subprocess.Popen([chrome_bin, '--headless=new', '--disable-gpu', f'--user-data-dir={PROFILE}',
                           f'--remote-debugging-port={PORT}', '--window-size=1500,1000', 'about:blank'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ID = [0]
def send(ws, method, **params):
    ID[0] += 1; mid = ID[0]
    ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
    while True:
        m = json.loads(ws.recv())
        if m.get('id') == mid: return m.get('result', {})
def ev(ws, e):
    return send(ws, 'Runtime.evaluate', expression=e, returnByValue=True).get('result', {}).get('value')

fails = []
def check(name, cond):
    print(('OK  ' if cond else 'FAIL') + f' | {name}')
    if not cond: fails.append(name)

try:
    ws_url = None
    for _ in range(60):
        try:
            tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json', timeout=1))
            pg = [t for t in tabs if t['type'] == 'page']
            if pg: ws_url = pg[0]['webSocketDebuggerUrl']; break
        except Exception: time.sleep(0.5)
    ws = websocket.create_connection(ws_url, timeout=30)
    send(ws, 'Page.enable'); send(ws, 'Runtime.enable')
    ev(ws, "try{localStorage.clear()}catch(e){}")
    send(ws, 'Page.navigate', url=PAGE)
    for _ in range(60):
        if ev(ws, "document.querySelectorAll('#toc [data-goto]').length > 0"): break
        time.sleep(0.4)
    time.sleep(1)
    check('wide auto-opens the outline on the Assessment', ev(ws, "!document.getElementById('toc').hidden"))
    # inspector docks under the outline while a sentence is selected (wide)
    ev(ws, "document.querySelector('.doc .blk .s').click()"); time.sleep(0.5)
    check('wide: inspector under outline', ev(ws, "document.getElementById('insp').getBoundingClientRect().top >= document.getElementById('toc').getBoundingClientRect().bottom"))
    check('wide: inspector inside viewport', ev(ws, "document.getElementById('insp').getBoundingClientRect().bottom <= innerHeight"))
    check('wide: outline stays', ev(ws, "!document.getElementById('toc').hidden"))
    # short window: outline gives room back
    send(ws, 'Emulation.setDeviceMetricsOverride', width=1500, height=620, deviceScaleFactor=1, mobile=False); time.sleep(0.6)
    check('short wide window: both fit', ev(ws, "document.getElementById('insp').getBoundingClientRect().bottom <= innerHeight + 1 && !document.getElementById('toc').hidden"))
    send(ws, 'Emulation.clearDeviceMetricsOverride'); time.sleep(0.6)
    ev(ws, 'closeInsp()'); time.sleep(0.3)
    # headingless document: Outline button disabled, nothing persists
    ev(ws, "openDoc(null, [{type:'p', text:'Just a plain document without any headings at all. '.repeat(30)}], {name:'plain'})"); time.sleep(0.6)
    check('headingless: Outline button disabled', ev(ws, "document.getElementById('btnToc').disabled"))
    check('headingless: no persisted pref', ev(ws, "!localStorage.getItem('sm.toc')"))
    # narrow rotation: exactly one sheet in every state
    send(ws, 'Emulation.setDeviceMetricsOverride', width=800, height=900, deviceScaleFactor=1, mobile=True); time.sleep(0.6)
    ev(ws, "const s=document.getElementById('selDemo'); s.value='0'; s.dispatchEvent(new Event('change'));"); time.sleep(1)
    def one_sheet():
        return ev(ws, "[document.getElementById('spec').hidden, document.getElementById('insp').hidden, document.getElementById('toc').hidden].filter(x=>!x).length <= 1")
    ev(ws, "document.querySelector('.doc .blk .s').click()"); time.sleep(0.4)
    check('narrow: select shows exactly one sheet', one_sheet())
    ev(ws, "document.getElementById('btnToc').click()"); time.sleep(0.4)
    check('narrow: Outline click with a selection shows the outline (not blank)', ev(ws, "!document.getElementById('toc').hidden"))
    check('narrow: still exactly one sheet', one_sheet())
    ev(ws, "document.getElementById('btnSpec').click()"); time.sleep(0.4)
    check('narrow: Spectrum comes to front, outline retreats', ev(ws, "!document.getElementById('spec').hidden && document.getElementById('toc').hidden"))
    ev(ws, "closeInsp()"); time.sleep(0.3)
    ev(ws, "document.getElementById('btnSpec').click()"); time.sleep(0.4)   # turn spectrum off
    ev(ws, "document.getElementById('btnToc').click()"); time.sleep(0.4)
    check('narrow: outline opens without a selection too', ev(ws, "!document.getElementById('toc').hidden"))
    send(ws, 'Emulation.clearDeviceMetricsOverride')
    ws.close()
finally:
    chrome.terminate()
    try: chrome.wait(timeout=8)
    except Exception: chrome.kill()

print('UI SMOKE ' + ('OK' if not fails else 'FAILED: ' + '; '.join(fails)))
sys.exit(0 if not fails else 1)
