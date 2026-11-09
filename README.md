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
The "Sample article" dropdown in the top bar offers two built-in demos: the Assessment section of the RBA Financial Stability Review, October 2026 (real text, externally scored), and a synthetic sample scored with the same LM x VADER lexicon. The first one opens at start-up.

## Layout

- `docs/FORMAT.md`: the scoring file format
- `examples/`: sample text, scored results in both formats, and the Python scoring scripts (swap in your own model)
- `examples/demos.js`: the data for the two built-in demo articles (`window.DEMOS`, packed from the `*.scored.json` files; repack after swapping articles, loaded as a classic `<script>` so no server is needed under `file://`)
- `examples/fsr-assessment-2026-10.txt / .scored.json`: the Assessment text of the RBA FSR (extracted from the PDF with the page's own pdf.js line-rejoining logic)
- `examples/financial-stability-review-2026-10.pdf`: (c) Reserve Bank of Australia, Financial Stability Review - October 2026, bundled for demo use only


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
- Multi-column and table layouts may come out of order; headers and footers are removed heuristically
- The Chinese lexicon is small, so English works better
- A dictionary approach has no sense of context: in "lost confidence" the word confidence still reads positive

## Next steps

1. Wire in your own scoring module or API (right now it goes through a file; a direct call is the next step)
2. Sentiment relative to a chosen topic word
3. Export a highlighted PDF
4. Chinese word segmentation and a larger Chinese lexicon
