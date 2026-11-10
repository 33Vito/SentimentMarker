# Outline

Long articles open a two-level outline. Each row has a sentiment bar, a running sum, and a positive/negative marker. Clicking a row jumps to that heading without opening the inspector.

## Sub-features

- `toc-open` auto-opens the outline on a wide window for the Assessment.
- `toc-jump` scrolls the heading into view and does not select a sentence.
- `toc-lean` shows a pos/neg dot on each row.
- `toc-geometry` (optional) checks inspector docking via `test/ui-smoke.py`.

## How to get to it (user POV)

- Open the Assessment on a window at least 1360px wide, or choose **Outline**.
- Click a heading row.

## Driving it with CDP

Preconditions:

- Doctor is `DOCTOR OK`.
- Viewport 1500×1000.

- **Auto-open.** After the Assessment loads, `#toc` is not `hidden` and `[data-goto]` length is greater than 0.
- **Lean marks.** Each row contains `.tdot`.
- **Jump.** Click the first `[data-goto]`. `#insp` stays `hidden`. The heading block is near the top of the viewport.
- **Geometry.** Optional: `uv run --with websocket-client python test/ui-smoke.py`. Skip (exit 0) if Chrome paths in that script do not match this OS.

## Gotchas

- Outline click must not call `select` / `jumpTo`. A selected sentence after an outline click is a regression.
- On a short wide window the inspector docks under the outline. Prove that in `ui-smoke.py`, not in the topic-sentiment run.
- Headingless documents disable the Outline button. Do not treat a disabled button as a failed open.
