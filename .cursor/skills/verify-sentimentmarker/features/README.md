# SentimentMarker verification map

This directory is the maintained source for verifying user-facing behavior of the SentimentMarker reader and Story page. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Serve the repo root at `http://127.0.0.1:8765` with `python3 -m http.server 8765 --bind 127.0.0.1`.
- Run `node .cursor/skills/verify-sentimentmarker/helpers/verify.mjs --doctor --base http://127.0.0.1:8765` and require `DOCTOR OK`.
- Use a disposable Chrome profile (`--user-data-dir` the helper creates). Clear `localStorage` in the page under test before a demo load if a prior run left `sm.toc` / `sm.spec`.
- Never drive a tab that was not started by this verification run.

## Driving conventions

- Start every recipe from the Assessment demo (`#selDemo` value `0`) unless the feature file says otherwise.
- Prefer the ids in the skill table (`#tsum`, `#toc`, `#chips`, `#topics .tp`) over nth-child selectors.
- Treat every command as literal.
- Run browser actions through the CDP helper. Run core assertions with `node test/core.test.js`.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes a screenshot with the SentimentMarker chrome visible and a JSON dump of the DOM fact that must hold.
- Record the feature ID and entry point with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.

## Features

- [Topic sentiment summary](./topic-sentiment.md) covers the reader summary panel, dual-counting copy, chip/outline lean marks, and click-to-jump on the Assessment.
- [Story topic rail](./story-topics.md) covers the Story page's topic list and jump-to-mention on the same Assessment.
- [Demo picker](./demo-picker.md) covers opening the Assessment and switching articles.
- [Outline](./outline.md) covers the two-level outline, jump without opening the inspector, and the optional `test/ui-smoke.py` geometry checks.
