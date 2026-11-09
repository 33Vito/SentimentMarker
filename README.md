# SentimentMarker

A lightweight reader that paints the sentiment score of every word, sentence and paragraph as a highlighter-style heat map.

- Warm orange = negative, teal = positive, neutral stays uncoloured
- Three levels - word / sentence / paragraph - switchable with the 1 / 2 / 3 keys
- A weak-signal filter slider, so you can look only at strong sentiment
- Topic filter: high-frequency words are extracted automatically and you can add your own; sentences that do not mention a topic word are dimmed
- Click a sentence or paragraph to see each word's score and how negation, boosters and contrasts affected it
- A heat strip on the right shows the sentiment distribution of the whole document; click or drag it to jump
- Reads PDF, Markdown, TXT and pasted text
- **Open externally scored files** (JSON / CSV): the scores come from your own Python module or API, the reader only displays them
- An emotion spectrum sidebar: where the words of this document sit inside the distribution of a reference lexicon (VADER, for example), listing the most positive and most negative words with percentiles
- Export the current document's scores (JSON / CSV) and use them as a format template

## Bring your own scores

The reader makes no sentiment judgements. Score every word / sentence / paragraph with Python or an API, save it as JSON or CSV, and drop it on the page:

```
pip install vaderSentiment
python examples/score_with_python.py examples/launch-week.md   # writes launch-week.scored.json
```

See [docs/FORMAT.md](docs/FORMAT.md). You may supply only some of the three levels; giving `reference` (the scores of the reference lexicon) is what draws the emotion spectrum.
Without external scores the page falls back to its built-in dictionary and labels itself "Built-in dictionary" in the corner - demo only.

## Usage

Pure front end, no build step. Open `index.html` in a browser, or host it on any static server.
PDF parsing uses pdf.js loaded from cdnjs, so it needs a network connection.
The "Sample article" dropdown in the top bar offers three built-in demos: the Assessment section of the RBA Financial Stability Review, October 2026 (real text, externally scored), the full Review, and a synthetic sample scored with the same LM x VADER lexicon. The first one opens at start-up.

## Layout

- `docs/FORMAT.md`: the scoring file format
- `examples/`: sample text, scored results in both formats, and the Python scoring scripts (swap in your own model)
- `examples/demos.js`: the picker list (`window.DEMOS`). The Assessment and the synthetic sample are inlined. The full Review is only a `{label, file, src}` stub. Packed by `examples/pack_fsr.js`. Loaded as a classic `<script>`, not `fetch()`, because `file://` blocks fetch.
- `examples/fsr-2026-10.demo.js`: the full Review as a second classic script (`window.DEMO_FILES`). The page inserts it the first time that article is chosen, so start-up does not parse it.
- `examples/fsr-assessment-2026-10.txt / .scored.json`: the Assessment text of the RBA FSR (extracted with the page's pdf.js line joiner)
- `examples/fsr-2026-10.txt / .scored.json`: the full Review, extracted with the same joiner (`itemsToLines` / `linesToBlocks` in `index.html`, pdf.js 3.11.174). Pretty JSON is the readable source; the demo script is generated from it.
- `examples/financial-stability-review-2026-10.pdf`: Source: Reserve Bank of Australia (2026), Financial Stability Review, October 2026. https://www.rba.gov.au/publications/fsr/2026/oct/ Text is reproduced under the Creative Commons Attribution 4.0 International licence (https://creativecommons.org/licenses/by/4.0/). Sentiment scores were added by SentimentMarker and are not the Reserve Bank's. The Reserve Bank does not endorse this project. Graphs, tables, and series drawn from third parties (including the HILDA and BLADE material noted at the back of the Review) are not covered by that licence and are not part of the text demo.


The script inside `index.html` is split into two sections, marked by comments:

- `//<core>`: input parsing (PDF line rejoining, Markdown, plain text) and the sentiment engine - DOM-free and testable under Node
- `//<app>`: rendering and interaction

## Tests

```
node test/core.test.js
```

## Built-in sentiment engine (demo only)

A dictionary approach inside the browser: about 500 English words plus a small Chinese lexicon, handling negation, degree adverbs, contrasts (but / however) and exclamation marks.
A sentence score is the weighted sum of its word scores squashed into -1..1; a paragraph score is the mean of its sentences.

## Known limits

- Scanned PDFs have no text layer and there is no OCR
- Multi-column and table layouts may come out of order; headers and footers are removed heuristically. The full October 2026 FSR is the specimen for that joiner: `itemsToLines` skips footnote superscripts, and `linesToBlocks` drops an edge line that says "financial stability review", a letterspaced running footer, or a repeated banner (a chapter title tiled along the line), even when that line appears on only one page. A section header that is none of those can still leak. A callout can still split a sentence in half (the Assessment "Key messages" box is the known case). The packer also drops short chart crumbs; dropping the PDF on the page does not, because the page has no table model. Columns stay in stream order.
- The Chinese lexicon is small, so English works better
- A dictionary approach has no sense of context: in "lost confidence" the word confidence still reads positive

## Next steps

1. Wire in your own scoring module or API (right now it goes through a file; a direct call is the next step)
2. Sentiment relative to a chosen topic word
3. Export a highlighted PDF
4. Chinese word segmentation and a larger Chinese lexicon
