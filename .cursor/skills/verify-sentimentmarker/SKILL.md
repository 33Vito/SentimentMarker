---
name: verify-sentimentmarker
description: Drive the SentimentMarker static reader and Story page in a real browser (CDP over headless Chrome). Use when proving UI behavior, topic sentiment, outline, demos, or click-to-jump; not for the Node core suite.
---

# Verify SentimentMarker

SentimentMarker is a pure front end. There is no build, no auth, and no database. A user opens `index.html` (the reader) or `SentimentStoryDemo.html` (the story page) in a browser. Demos load from `examples/demos.js`.

## Launch

From the repo root:

```
python3 -m http.server 8765 --bind 127.0.0.1
```

Ready when `curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/index.html` prints `200` and the same request for `/core.js` and `/SentimentStoryDemo.html` also prints `200`. The Assessment demo is inlined in `examples/demos.js`, so the reader is usable as soon as those three files serve. Do not wait on pdf.js.

Teardown: kill the Python process you started, by PID. Do not `pkill python`.

Two instances can share nothing if they use different ports. The pages have no writable data dir. `localStorage` keys `sm.theme`, `sm.level`, `sm.th`, `sm.spec`, `sm.toc` live in the Chrome profile; give each run its own `--user-data-dir`.

## Doctor

Run the helper in check mode. It answers whether this instance is worth driving:

```
node .cursor/skills/verify-sentimentmarker/helpers/verify.mjs --doctor --base http://127.0.0.1:8765
```

It must print `DOCTOR OK` and exit 0. It fails if the static server is down, `core.js` is missing, Chrome is missing, or `/index.html` does not load `core.js`.

## Drive

The harness is Chrome DevTools Protocol (no npm). Prefer ARIA labels and the stable ids below, not coordinates.

| Handle | What it is |
| --- | --- |
| `#selDemo` | Demo article picker. Value `0` is the RBA FSR Assessment (October 2026). |
| `#tsum` | Topic sentiment summary on the reader. |
| `#chips .chip` | Topic chips. `pos` / `neg` mark lean. |
| `#tsum [data-sent]` | Source sentence in the summary. Click jumps with `jumpTo`. |
| `#toc` | Document outline. Rows use `[data-goto]`. |
| `#topics .tp` | Story page topic rail. Click jumps to the next mention. |
| `.s.sel` | The sentence the reader selected after a jump. |

Recipe for a headed or headless run:

```
node .cursor/skills/verify-sentimentmarker/helpers/verify.mjs --base http://127.0.0.1:8765 --out /tmp/sentimentmarker-verify
```

That loads both pages on the Assessment, screenshots the summary, clicks a source sentence, and screenshots the jump.

## Evidence

Proof lives in the `--out` directory (default `/tmp/sentimentmarker-verify`). Cleanup must not delete it.

| File | What it proves |
| --- | --- |
| `index-tsum.png` | Reader summary panel on the Assessment, with counts, means, leans, and source sentences. |
| `index-jump.png` | After a summary click, the matching sentence is in view. |
| `index-insp.png` | Inspector showing the jumped sentence score. |
| `index-jump.json` | `beforeId`, `afterId`, `selected`, `inspectorOpen` from the live DOM. |
| `story-topics.png` | Story page topic rail on the Assessment. |
| `story-jump.png` | After a topic click, that sentence is at the reading line. |
| `story-jump.json` | `fromId`, `toId`, `text`. |
| `doctor.json` | Last doctor snapshot. |

Standards:

- Drive the real pages over HTTP, not a unit of `topicSentiment`.
- Capture the click and the resulting selection, not only the final frame.
- `index-jump.json` must show `afterId === beforeId` and `selected === true`.
- Do not mock `examples/` or `core.js`.

## Cleanup

The helper starts Chrome with `--user-data-dir` under `/tmp/sm-verify-*` and kills that Chrome PID on exit. It does not kill the static server unless it started it (`--serve`). It never deletes `--out`.

```
node .cursor/skills/verify-sentimentmarker/helpers/verify.mjs --serve --out /tmp/sentimentmarker-verify
```

`--serve` starts `python3 -m http.server` on a free port, runs the drive, then stops that server.

## Helpers

```
node .cursor/skills/verify-sentimentmarker/helpers/verify.mjs --doctor --base http://127.0.0.1:8765
node .cursor/skills/verify-sentimentmarker/helpers/verify.mjs --serve --out /tmp/sentimentmarker-verify
```

The core suite stays separate: `node test/core.test.js`. The outline geometry smoke is `python test/ui-smoke.py` (needs Chrome plus `websocket-client`; skip is exit 0).
