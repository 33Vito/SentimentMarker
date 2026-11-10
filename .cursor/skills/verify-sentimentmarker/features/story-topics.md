# Story topic rail

The Story page lists recurring topics with a running count and a positive/negative bar as you scroll. Clicking a topic jumps to the next sentence that mentions it. Missing `scale` in the scored file uses the same `autoCap` default as the reader because the page calls `docFromScored`.

## Sub-features

- `story-load` opens the Assessment in `SentimentStoryDemo.html`.
- `story-rail` shows `#topics .tp` with labels and totals.
- `story-jump` moves the matching sentence to the reading line.

## How to get to it (user POV)

- Open `SentimentStoryDemo.html`.
- Choose the Assessment in the article picker if it is not already selected.
- Use the topic list in the right rail (wide) or after scrolling into the article.
- Click a topic name.

## Driving it with CDP

Preconditions:

- Doctor is `DOCTOR OK`.
- `/SentimentStoryDemo.html` served from the same origin as `core.js`.

- **Open Assessment.** Load `/SentimentStoryDemo.html`. Wait until `#topics .tp` length is greater than 0 and `#story .s` exists.
- **Jump.** Click the first `#topics .tp`. The helper records `fromId` then `toId` and asserts they differ or the article flashed the first mention when already on it.
- **Proof.** Save `story-topics.png`, `story-jump.png`, and `story-jump.json`.

## Gotchas

- Story excludes heading sentences from the scroll engine. Ids are dense body-sentence ids, not `doc.sents` ids from core.
- The finale bubbles sit at the bottom of a long page. Prefer the rail `#topics .tp` for a jump you can screenshot without scrolling the finale into view.
- `file://` loads `core.js` as a sibling script. Prefer the HTTP server so a missing `core.js` is a 404 instead of a silent empty page.
