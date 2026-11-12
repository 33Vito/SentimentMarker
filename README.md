# SentimentMarker

A lightweight reader that paints the sentiment score of every word, sentence and paragraph as a highlighter-style heat map.

- Warm orange = negative, teal = positive, neutral stays uncoloured
- Three levels - word / sentence / paragraph - switchable with the 1 / 2 / 3 keys
- A weak-signal filter slider, so you can look only at strong sentiment
- Topic filter: high-frequency words are extracted automatically and you can add your own; sentences that do not mention a topic word are dimmed
- Topic sentiment summary: every topic chip carries the mean score of the sentences that mention it; its ▾ lists the negative / neutral / positive split and the five strongest passages (click one to jump to it); with a topic selected, each outline row shows that topic's hits and mean in the section. Attribution is per sentence: a sentence that mentions two topics counts toward both
- Click a sentence or paragraph to see each word's score and how negation, boosters and contrasts affected it
- A heat strip on the right shows the sentiment distribution of the whole document; click or drag it to jump
- An outline panel for long articles: two heading levels, each row carrying a sentiment bar and the running sum of its section, click to jump, the current section stays highlighted
- Reads PDF, Markdown, TXT and pasted text, scored in the page with the built-in General dictionary or the optional Finance dictionary (Loughran-McDonald × VADER), picked in the toolbar
- **Open externally scored files** (JSON / CSV): the scores come from your own Python module or API, the reader only displays them
- An emotion spectrum sidebar: where the words of this document sit inside the distribution of a reference lexicon (VADER, for example), listing the most positive and most negative words with percentiles
- Export the current document's scores (JSON / CSV) and use them as a format template

## Bring your own scores

When you import external scores (a JSON / CSV file, or one pasted into the dialog), the reader only displays them: it never rescores them and never loads a dictionary for them. When you paste or open plain text (TXT, Markdown, PDF), it scores that text itself with its built-in dictionary: the General one, or the optional Finance dictionary chosen in the toolbar.
To use your own model, score every word / sentence / paragraph with Python or an API, save it as JSON or CSV, and drop it on the page:

```
pip install vaderSentiment
python examples/score_with_python.py examples/launch-week.md   # writes launch-week.scored.json
```

See [docs/FORMAT.md](docs/FORMAT.md). You may supply only some of the three levels; giving `reference` (the scores of the reference lexicon) is what draws the emotion spectrum.
Without external scores the page scores the text with its built-in dictionary and says so in the badge next to the file name ("Built-in" or "Finance") and in the colour-scale line, which names the dictionary - demo quality. Its Export JSON then records `model: {version, profile}`, so a file says which engine and dictionary scored it.

For finance prose there is an offline path that gives exactly the page's Finance scores (it runs the same JS engine through Node; Node.js is the only requirement):

```
python examples/score_financial.py examples/fsr-assessment-2026-10.txt -o report.scored.json
```

## Usage

### Sentiment Diff + Timeline

Open [SentimentDiff.html](SentimentDiff.html) directly (`file://` works, no server or network required for the analysis). It compares six RBA Financial Stability Assessment narratives from March 2024 to October 2026 across six explicit keyword topics. The timeline shows mean sentence sentiment plus matching/all sentence counts and coverage. Select a topic and any two editions to inspect the change, original sentences, and each scored word's base/effective weight and rule notes.

Text alignment is separate from sentiment: greedy one-to-one Jaccard word overlap ≥ 0.38 identifies similar passages without using their scores. Unmatched sentences are exposed on each side; they are not automatically policy additions/deletions. Topics overlap and sentence sentiment is not aspect-level sentiment. Means/deltas are withheld below five matching sentences; deltas also require identical model version/profile. The chart leaves gaps for insufficient or incompatible samples.

All six editions are scored with the same Finance engine. Source links, scope, PDF page ranges and extraction caveats appear in the page. All editions include substantive headings. Section labels, endnotes, publication metadata and standalone punctuation are excluded from counts. Original heading ellipses remain in the source text. The October 2026 sentence interrupted by the industry callout is rejoined before scoring. Counts refer to extracted narrative sentences, not entire Reviews; changing composition and extraction quality limit interpretation. Scores are descriptive dictionary output, not a financial risk measure or significance test. Source text: RBA, CC BY 4.0 subject to its exclusions; scoring is ours and is not endorsed by the RBA.

`examples/fsr-evolution-assessments.js` holds the five earlier source extracts; the sixth uses the existing October 2026 Assessment narrative, including substantive headings and the industry callout, excluding its closing vulnerabilities Box, Figure and Endnotes. Original source files remain available for inspection. The regression tests check the repaired sentence, preserved headings, excluded material and CRLF handling. Run `node tools/build-evolution.js` to rebuild the classic-script pack `examples/fsr-evolution.scored.js`; `node tools/build-evolution.js --check` checks reproducibility. `sentiment-diff-core.js` contains DOM-free topic summaries and alignment. Run `node test/diff.test.js` for the comparison/data checks.

Pure front end, no build step. Open `index.html` in a browser, or host it on any static server. The toolbar links to three Story presentations: [Story](SentimentStoryDemo.html), [Fable](SentimentStoryFable.html) (ink FX and autoplay), and [Astra](SentimentStoryAstra.html) (editorial layout of the Assessment).
PDF parsing uses pdf.js loaded from cdnjs, so it needs a network connection.
The "Sample article" dropdown in the top bar offers three built-in demos: the Assessment section of the RBA Financial Stability Review, October 2026 (real text), the full Review, and a synthetic sample. All three were scored offline with the Finance dictionary through the same engine (`examples/score_financial.py`), so they open as scored files and do not download the dictionary. The first one opens at start-up.

## Layout

- `docs/FORMAT.md`: the scoring file format, and the built-in scoring model (profiles, rules, lazy loading)
- `data/sentiment-model.json`: the canonical scoring model - rules, parameters, negators, boosters, contrast words, neutral phrases, and the named vocabularies `general` and `finance` with their suffix policies and sources. Hand-maintained; everything the browser uses is generated from it
- `tools/build-lexicon.js`: the deterministic generator. Writes the model back in canonical form, the `//<model>` region of `sentiment-core.js` (rules + the general vocabulary, so they are there synchronously) and `lexicon/finance.js`. `--check` fails on stale files (run by the tests)
- `tools/build_finance_vocab.py`: rebuilds the finance vocabulary and the upstream hashes from `pysentiment2` / `vaderSentiment` and hands them to the generator (`--check` compares without writing)
- `lexicon/finance.js`: generated Finance dictionary, a classic script inserted the first time finance scoring is needed
- `tools/score-cli.js`, `tools/sm_engine.py`: batch scoring through the JS engine (JSON on stdin / stdout, one Node process per run) and its Python wrapper
- `tools/update-golden.js`: refills `test/golden.json` after a deliberate model change and prints what changed
- `test/fixtures/sentiment-core-56f66cb.js`: the engine as it was before the model file (main at 56f66cb), kept byte for byte so the tests can prove the General profile still scores exactly like it
- `THIRD_PARTY_NOTICES.md`: licences of the word lists and other third-party material (Loughran-McDonald, VADER, pysentiment2, the RBA text, pdf.js)
- `examples/`: sample text, scored results in both formats, and the Python scoring scripts (swap in your own model). After a model change, `node examples/pack_fsr.js --rescore` re-scores the three finance examples from their `.txt` / `.md` and repacks `demos.js` and `fsr-2026-10.demo.js` (no PDF needed). `launch-week.scored.json / .csv` are the "bring your own scores" example, scored by VADER via `examples/score_with_python.py`, not by this engine; re-running that script reproduces them byte for byte
- `examples/demos.js`: the picker list (`window.DEMOS`). The Assessment and the synthetic sample are inlined. The full Review is only a `{label, file, src}` stub. Packed by `examples/pack_fsr.js` (needs `pdfjs-dist@3.11.174` via `PDFJS_DIST` or `node_modules`; this repo has no `package.json`). Loaded as a classic `<script>`, not `fetch()`, because `file://` blocks fetch.
- `examples/fsr-2026-10.demo.js`: the full Review as a second classic script (`window.DEMO_FILES`). The page inserts it the first time that article is chosen, so start-up does not parse it.
- `examples/fsr-assessment-2026-10.txt / .scored.json`: the Assessment text of the RBA FSR, PDF pages 4–12 (printed pages 1–9, including Endnotes). `examples/pack_fsr.js` extracts the text, repairs one split heading, and adds the verified Figure 1 transcription and corrected Endnotes from `examples/fsr-assessment-supplement.md` only to the Assessment. Figure 1 was read from the RBA's vector figure (`https://www.rba.gov.au/publications/fsr/2026/oct/images/figure-0.01.svg`); its five themes intentionally sit at the same outline level as the preceding Box heading.
- `examples/fsr-2026-10.txt / .scored.json`: the full Review, extracted with the same joiner (`itemsToLines` / `linesToBlocks` in `sentiment-core.js`, pdf.js 3.11.174). Pretty JSON is the readable source; the demo script is generated from it.
- Those text files and the packed demo scripts reproduce Reserve Bank of Australia (2026), Financial Stability Review, October 2026 (https://www.rba.gov.au/publications/fsr/2026/oct/) under the Creative Commons Attribution 4.0 International licence (https://creativecommons.org/licenses/by/4.0/). Sentiment scores were added by SentimentMarker and are not the Reserve Bank's. The Reserve Bank does not endorse this project. The Assessment includes a text-only transcription of Figure 1, which credits the RBA as its source. Graphs, tables, and series drawn from third parties (including the HILDA and BLADE material noted at the back of the Review) are not covered by that licence and are not part of the text demo.
- `examples/financial-stability-review-2026-10.pdf`: the unmodified RBA publication. It includes the Reserve Bank logo and third-party graphs and tables, which the Reserve Bank excludes from CC BY 4.0 (https://www.rba.gov.au/copyright/). This project does not relicense that file.


The script is split in two:

- `sentiment-core.js` (between `//<core>` markers): input parsing (PDF line rejoining, Markdown, plain text), the sentiment engine, the scored-file reader and the pure summaries (outline, topics, spectrum) - DOM-free and testable under Node. One copy for the analyzer and the Story pages: `index.html`, `SentimentStoryDemo.html`, `SentimentStoryFable.html` and `SentimentStoryAstra.html` load it as a classic `<script src>` (not `fetch()`, because `file://` blocks fetch) and use it through `window.SMCore`, so they read a scored file the same way (centre, word placement, colour scale)
- `//<app>` inside `index.html`: rendering and interaction. The story view keeps its own layout code; its data step (`//<story-data>`) is built on `SMCore`
- `SentimentStoryDemo.html`: scroll-driven Story reading. `SentimentStoryFable.html` is that page plus the ink FX layer and Play/Space autoplay. `SentimentStoryAstra.html` is an editorial "Stability under pressure" reading of the same files, still scored through `SMCore`

## Tests

```
node test/core.test.js            # core, app wiring, generator --check, golden vectors, General == the 56f66cb engine
python3 test/test_golden.py       # the same golden vectors through Python -> Node (also runs under pytest)
node tools/build-lexicon.js --check
python3 tools/build_finance_vocab.py --check   # needs pysentiment2 + vaderSentiment
```

`test/golden.json` holds the shared golden vectors (negation, boosters, contrast, caps / exclamation, the "financial stability" neutral phrase, exact-match collisions such as goods / bridging, Chinese). Every field is checked: sentence score and raw sum, each scored word's code-point offsets, base and effective score and the engine's notes, and the negators / boosters / neutralised words that acted. Both runners must reproduce them exactly. `test/test_golden.py` skips only the vocabulary rebuild when pysentiment2 is missing.
`node test/core.test.js` also deep-compares the General profile with the pre-model engine in `test/fixtures/` over every example text, the golden inputs and edge cases (sentences, tokens, whole documents, exports, topics): they must be identical.

## Built-in sentiment engine (demo only)

A dictionary approach inside the browser, handling negation, degree adverbs (boosters and dampeners), contrasts (but / however), ALL CAPS and exclamation marks.
A sentence score is the weighted sum of its word scores squashed into -1..1; a paragraph score is the mean of its sentences.
There is one implementation, `sentiment-core.js`; Python reaches it through `tools/score-cli.js`, so offline and in-page scores are identical.

Two vocabulary profiles share those rules:

- **General** (default): 293 English and 55 Chinese entries, with a suffix fallback (`improved` -> `improve`, `happily` -> `happy`). Built into `sentiment-core.js`, available as soon as it loads. Colour scale word ±3, sentence ±0.6, paragraph ±0.3
- **Finance**: 3381 words, Loughran-McDonald polarity with VADER strength. Exact match only, because the fallback produced false matches (`goods` -> `good`, `bridging` -> `bridge`); words LM leaves neutral, such as `risk`, `capital`, `credit`, stay neutral. Inside "financial stability" the word stability is not scored. It is a separate dictionary, not merged into General. The page downloads `lexicon/finance.js` (about 37 KB, 13 KB gzipped) only when text is first scored with it; showing an already scored file never downloads it. A failed download is reported and retried the next time Finance is chosen. The core recomputes the sha256 of the words it receives and installs them only if it matches the one recorded in the model, so a stale or edited asset is refused. Colour scale word ±2.5; sentence and paragraph scales follow the document (90th percentile), the same in the page and in `score_financial.py` output

### Licences of the word lists

Full notices, including the VADER copyright and MIT text: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

- The Loughran-McDonald Master Dictionary, which the Finance dictionary derives from, is free for non-commercial / academic use only. Commercial use requires a licence from its authors, Tim Loughran and Bill McDonald (https://sraf.nd.edu/loughranmcdonald-master-dictionary/)
- VADER (C.J. Hutto and Eric Gilbert), which supplies the strengths, is MIT-licensed
- The same note sits in `data/sentiment-model.json` (`sources`) and at the head of `lexicon/finance.js`

## Known limits

- Scanned PDFs have no text layer and there is no OCR
- Multi-column and table layouts may come out of order; headers and footers are removed heuristically. The full October 2026 FSR is the specimen for that joiner: `itemsToLines` skips a footnote superscript only when it is raised by more than 2pt (a smaller lead on the same baseline stays), and `linesToBlocks` drops an edge line that says "financial stability review", a letterspaced running footer, or a repeated banner (a chapter title tiled along the line), even when that line appears on only one page. A section header that is none of those can still leak. A callout can still split a sentence in half (the Assessment "Key messages" box is the known case). The packer also drops short chart crumbs; dropping the PDF on the page does not, because the page has no table model. Columns stay in stream order.
- The Chinese lexicon is small, so English works better
- A dictionary approach has no sense of context: in "lost confidence" the word confidence still reads positive

## Next steps

1. Wire in your own scoring module or API (right now it goes through a file; a direct call is the next step)
2. Sentiment relative to a chosen topic word: the topic summary scores whole sentences that mention it; next is aspect-level scoring, so "rates fell but jobs held up" reads differently for rates and for jobs
3. Export a highlighted PDF
4. Chinese word segmentation and a larger Chinese lexicon
