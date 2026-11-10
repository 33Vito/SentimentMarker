# Topic sentiment summary

The reader lists each extracted topic with how many sentences mention it, the mean score, whether it leans positive or negative, and the three strongest positive and negative source sentences. Clicking a source sentence jumps to it in the article. A sentence that names two topics counts toward both.

## Sub-features

- `tsum-visible` shows `#tsum` on the Assessment with at least one topic row.
- `tsum-dual` states that a sentence naming two topics counts toward both.
- `tsum-stats` shows a sentence count, a mean, and a lean word on each topic.
- `tsum-jump` selects the clicked sentence in the article.
- `chip-lean` paints a pos/neg marker on topic chips.
- `toc-lean` paints a pos/neg marker on outline rows.

## How to get to it (user POV)

- Open `index.html` and wait for the Assessment demo to load (the default picker value).
- Read the **Topic sentiment** block under the article header.
- Choose a source sentence button in that block.
- Look at the topic chips in the toolbar and the outline on a wide window.

## Driving it with CDP

Preconditions:

- Doctor is `DOCTOR OK` at `http://127.0.0.1:8765`.
- Viewport is at least 1500×1000 so the outline can auto-open.
- `#selDemo` is `0` (Assessment).

- **Open Assessment.** Load `/index.html`. Run the helper (it navigates and waits until `#tsum .ti` exists). The heading includes `Financial Stability Review` and `#tsum` is not `hidden`.
- **Read the dual-count rule.** The first `.sub` inside `#tsum` contains `A sentence that names two topics counts toward both`.
- **Read one topic.** The first `.ti` contains a sentence count, `mean`, and `leans positive` or `leans negative` or `leans neutral`.
- **Jump.** Click `#tsum [data-sent]`. Run the helper's jump step. `.s.sel` exists, its `data-s` equals the button's `data-sent`, and `#insp` is visible.
- **Chip marker.** `#chips .chip.pos, #chips .chip.neg` is non-empty.
- **Outline marker.** `#toc .tdot` is non-empty on a wide window once the outline is open.
- **Proof.** Save `index-tsum.png`, `index-jump.png`, and `index-jump.json` under the `--out` directory. The JSON has `selected: true` and matching ids.

## Gotchas

- The Assessment is inlined; the full Review is a lazy script. Do not use demo index `1` unless you wait for `window.DEMO_FILES`.
- `#tsum` is `hidden` until `openDoc` fills topics. Wait on `#tsum .ti`, not on `document.readyState`.
- Click-to-jump also opens the inspector. A screenshot of only `#tsum` after the click is not proof of the jump.
- Chip counts are sentence mentions after `syncTopicSum`, not the token frequencies `extractTopics` uses to rank.
