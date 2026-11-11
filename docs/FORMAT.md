# Scoring file format

When you import external scores (this format, through "Open file", drag and drop or the paste dialog), SentimentMarker only displays them: they are not rescored and no dictionary is loaded for them. When you paste or open plain text, the page scores it with its built-in dictionary - the General one, or the optional Finance dictionary chosen in the toolbar (see "The built-in scoring model" below). That dictionary approach is a demo; compute real scores with your own Python module or API, save them as JSON or CSV, and bring them in.

You may supply just one level (words only, sentences only or paragraphs only); the missing levels are greyed out in the interface.
When both words and sentences are given, a sentence is coloured from the sentence score you supplied - it is never recomputed from the words. When only words are given, sentence and paragraph scores are derived from them, and opening a sentence or paragraph labels it "Derived from words" / "Derived from sentences".
If some sentences in one file carry a score and others do not, the header warns that the two may not be on the same scale.

## JSON

```json
{
  "version": 1,
  "title": "launch-week",
  "center": 0,
  "scale": { "word": 3.0, "sentence": 0.6, "paragraph": 0.3 },
  "reference": {
    "name": "VADER dictionary",
    "scores": [-3.9, -3.8, "...one entry per word of the lexicon...", 3.9],
    "examples": [{ "text": "terrible", "score": -3.4 }, { "text": "great", "score": 3.1 }]
  },
  "paragraphs": [
    {
      "type": "p",
      "score": 0.12,
      "sentences": [
        {
          "text": "The launch went better than we feared.",
          "score": -0.08,
          "words": [
            { "text": "better", "score": 1.9, "start": 16, "end": 22, "note": "optional, shown when the sentence is opened" }
          ]
        }
      ]
    }
  ]
}
```

| Field | Required | Description |
| --- | --- | --- |
| `paragraphs[]` | yes | In document order. `type` = `"h"` marks a heading, anything else is body text |
| `paragraphs[].level` | no | Heading depth for the outline: 1 (chapter) or 2 (section). Only meaningful with `type: "h"`. Values ≥ 2 are flattened to 2 (deeper levels are not a third indent); missing, non-numeric or below 2 fall back to 1. CSV cannot carry it - its `level` column already names the row kind - so CSV headings are level 1 |
| `paragraphs[].score` | no | Paragraph score. When missing it is the mean of its sentence scores (labelled "Derived from sentences") |
| `paragraphs[].sentences[]` | no | When missing or an empty array `[]`, the paragraph's `text` is split into sentences automatically (in that case there are no word scores) |
| `paragraphs[].text` | no | Used for sentence splitting when there is no `sentences`. A paragraph with neither sentences nor `text` (for example only a `score`) **is skipped**, and the page reports how many were skipped |
| `sentences[].text` | yes | The sentence as written. A bare string is allowed and means a sentence with only text. Sentences with empty text are invalid data: skipped and counted |
| `sentences[].score` | no | Sentence score. When missing it is derived from the word scores: S / sqrt(S^2 + 15), where S is the sum of the word scores |
| `sentences[].words[]` | no | List only the words that have a score; every other word counts as neutral |
| `words[].start / end` | no | The word's position inside `sentence.text`, half-open interval, **measured in Unicode code points** (same indexing as a Python `str`, not UTF-16). See "Locating words" below |
| `words[].note` | no | A short note, shown when the sentence is opened |
| `center` | no | The neutral point, 0 by default. A number (shared by all three levels) or `{word, sentence, paragraph}`. Scores are first shifted down by the centre of that level (so a 1-5 star rating is centred at 3); `reference` uses the `word` centre |
| `scale` | no, but worth always writing | Which absolute score counts as "strongest colour". A number (shared) or `{word, sentence, paragraph}`, applied to the score after subtracting `center`. When missing it takes the 90th percentile of non-zero \|scores\| for that level, which makes colour intensity incomparable across files |
| `reference` | no | The reference lexicon used to draw the emotion spectrum. See below |

The sign of a score decides the colour: negative is orange, positive is teal, 0 stays uncoloured. The numeric range is yours to choose - normalisation is not required, `scale` is what tells the reader which values count as strong.
The header shows the colour scale currently in use and whether it came from the file, was computed automatically, or comes from the built-in dictionary.

### Locating words

- **With `start` / `end`**: code points are converted to positions in the browser, then the text at that span is compared with `words[].text` (NFC-normalised, case-insensitive).
  A match wins. A mismatch (or an out-of-range offset) is treated as no offset at all and the word is searched for in the sentence as described below; those found are counted in "offsets did not match, relocated by text", the rest in "words not found".
  So a wrong offset can never colour the wrong word.
- **Without offsets**: searching starts after the previous word (case-insensitive); if nothing is found it restarts at the beginning of the sentence and takes the first position not already claimed. So word order may be arbitrary, for example a plain list of keywords.
- WordPiece-style subword prefixes `##` (as in `##ing`) are stripped before matching.
- A word is skipped, and the count is reported on the page, when: `text` is not a string or is empty, `score` is not a number, the word cannot be found in the sentence, or it overlaps a word that was already placed.

## CSV

Long format, one unit per line. Required columns: `level, paragraph, sentence, text, score`; optional: `type, start, end, note`.

```csv
level,paragraph,sentence,text,score,type,start,end,note
paragraph,0,,,0.0,h,,,
sentence,0,0,Launch week review,0.0,,,,
paragraph,1,,,0.499,p,,,
sentence,1,0,The launch went better than we feared.,-0.0772,,,,
word,1,0,better,1.9,,16,22,
word,1,0,feared,-2.2,,31,37,
```

- `level` is one of `paragraph` / `sentence` / `word`
- `paragraph` and `sentence` are zero-based indexes (in the example above paragraph 0 is the heading, paragraph 1 is body text); word rows use them to attach to a sentence
- A paragraph row needs only `paragraph` and `score`; add `type=h` for a heading. A paragraph row may also carry the whole paragraph in `text` with no sentence rows, in which case sentences are split automatically
- Sentence rows must have `text`; a sentence row with empty text is invalid data. On a word row `text` is the word itself, `start` / `end` may be omitted, and they are measured the same way as in JSON (code points)
- A word row whose sentence row cannot be found (or whose sentence row has empty text) is invalid data. Invalid rows are skipped and the count is reported on the page
- Paragraphs that have a score but no text at all (no sentence rows and no `text`) are skipped and reported
- UTF-8, with or without a BOM. Quote fields the standard CSV way when they contain commas, quotes or newlines (a `\r\n` inside a field is read as `\n`)
- CSV has nowhere to put `reference`, `scale` or `center`; use JSON when you want the spectrum's reference lexicon or a fixed colour scale

## The reference lexicon behind the emotion spectrum

The emotion spectrum places the words used in this document inside the distribution of a reference lexicon and answers "how positive is this word compared with a common lexicon". You supply the reference lexicon:

- Give `reference.scores` (the score of every word in the lexicon, in any order): the spectrum shows the reference distribution and this document's distribution, and ranks each word, for example "most positive 3%".
  That means: the words in the reference lexicon that share its sign and score at least as high (or, for negative words, at most as low) make up 3% of the **whole** lexicon
- Also give `reference.examples`: shown as tick marks (which common words sit at which score)
- Give neither: only this document's own distribution is shown, and the ranking is among the words this document uses ("most positive X% of this document")

Words are grouped by "word + sign", so "good" and the negated "not good" (negative score) stay two separate entries instead of averaging out to something near 0.

In Python, VADER's lexicon is the convenient choice - see `examples/score_with_python.py`: `vader.lexicon.values()` are exactly the lexicon scores. Any other lexicon (AFINN, NRC, your own) works the same way.
The reference lexicon must use the same ruler as `words[].score`, otherwise the ranking means nothing. If the largest absolute word score in this document is far below the reference (under 1/4) or far above it (over 4x), the spectrum warns that the two may not be on the same scale.

## Chinese text

`examples/score_with_python.py` splits Chinese on `。！？` and line breaks, and takes offsets straight from Python string indexes (code points).
VADER only knows English, so Chinese gets no word or sentence scores by default. Pass `--lexicon my_lexicon.json` (`{"词": score}`) or a TSV (`词<TAB>score`) with Chinese entries and the script matches the longest Chinese word in each sentence; the sentence score is then derived by the reader from those word scores.
To plug in your own Chinese model, replace the `cjk_words` and `score_sentence` functions.

## Export

"Export JSON / CSV" on the page writes the current document (including scores from the built-in dictionary) in this format - useful as a template, and for comparing your model against the built-in dictionary.

Scores are written on the file's own scale: the `center` subtracted at import is added back and `center` itself is written out too
JSON always writes `scale` (the colour scale actually in use, including an automatic one) and `reference` when present, so exporting and re-importing leaves colour intensity and the spectrum unchanged
Offsets are written as code points
Sentence and paragraph scores derived from word scores are written as ordinary scores

## The built-in scoring model

Everything the built-in engine knows is in `data/sentiment-model.json`, one hand-maintained file in a canonical form (keys sorted, `modelVersion` first; negators and contrast words sorted; one vocabulary entry per line):

| Key | Contents |
| --- | --- |
| `modelVersion` | Version of the rules + vocabularies; `test/golden.json` records the version it was made with |
| `params` | Every number the engine uses: `lookBack` (how many words back a negator or booster acts, 3), `booster.distanceDecay` (a booster's effect at distance 1 / 2 / 3), `negation` (factor for a negated positive / negative word, and the `n't` suffix), `contrast` (weights before / after the first contrast word), `caps` (factor and minimum length), `exclamation` (per mark, at most 3 marks), `wordClip` (±4.5), `sentenceNormAlpha` (the 15 in S / sqrt(S² + 15)), `cjkMaxWordLength`, and `display` (default colour scale and the neutral share of the topic summary) |
| `negators`, `boosters`, `contrastWords` | Shared by all profiles. `boosters` maps a word to its multiplier (< 1 weakens) |
| `neutralPhrases` | `{profiles, tokens, neutral, note}`: in the named profiles, where the lower-cased word tokens `tokens` follow each other with only whitespace between them, the tokens at the indexes in `neutral` are not scored. Example: finance, `["financial", "stability"]`, `[1]` |
| `vocabularies.<name>` | `label`, `description`, `words` (`{word: score}`, lower case), `suffixPolicy`, `referenceName` / `referenceExamples` (the emotion spectrum for text scored with it), and `asset` for a lazily loaded profile |
| `suffixPolicy` | `{"type": "exact"}`, or `{"type": "suffix", "minStemLength", "skipCJK", "rules": [[suffix, replacement], …]}`: after an exact miss, every rule whose suffix ends the word gives a candidate, in rule order; the first candidate of at least `minStemLength` characters that is in the vocabulary wins |
| `sources` | Licence note, upstream lists (`loughranMcDonald`, `vader`: name, version, file, sha256 of the upstream file, licence), and per vocabulary its word count and the sha256 of its canonical content (one `word<TAB>score\n` line per entry, sorted) |

Profiles: `general` (293 English + 55 Chinese entries, suffix fallback) and `finance` (3381 words: Loughran-McDonald decides polarity, VADER the strength, ±1.5 when VADER has none; exact match only). They are separate vocabularies with one `Map` each; finance is not merged into general, so a word LM deliberately leaves neutral (`risk`) is not scored as negative.

The Loughran-McDonald word list is free for non-commercial / academic use only; commercial use requires a licence from its authors (https://sraf.nd.edu/loughranmcdonald-master-dictionary/). VADER is MIT-licensed.

### Generated files

`node tools/build-lexicon.js` rewrites, byte for byte deterministically (sorted words and groups, JavaScript number formatting, no timestamps):

- `data/sentiment-model.json` in canonical form, with the vocabulary hashes refreshed
- the `//<model>` … `//</model>` region of `sentiment-core.js`: rules, parameters and the general vocabulary, so General is there synchronously on every page and under `require('./sentiment-core.js')`
- `lexicon/finance.js`: `SMCore.registerLexicon("finance", {sha256, words: [[score, "word word …"], …]})`, words grouped by score. The core refuses an asset whose sha256 does not match its own copy

`--check` writes nothing and exits 1 when any of them is stale; `node test/core.test.js` runs it. `python tools/build_finance_vocab.py` rebuilds the finance words and upstream hashes from pysentiment2's `LM.csv` and VADER's `vader_lexicon.txt`, then calls the generator.

### Lazy loading in the page

`SMCore.ensureLexicon('finance')` inserts `lexicon/finance.js` as a classic `<script>` (resolved next to `sentiment-core.js`; `fetch()` is not used because `file://` blocks it). The Promise is cached, so concurrent and later calls share one load; a failed load is dropped from the cache so the next call retries. The scorer stays synchronous: `analyzeSentence(text, 'finance')` and `buildDoc(title, blocks, {profile: 'finance'})` throw until the load has finished. The analyzer awaits it before scoring pasted or opened text, re-scores that text when the dictionary picker changes, and leaves imported scored files alone.

### Offline scoring through the same engine

`tools/score-cli.js` reads one JSON request on stdin and writes the answer on stdout, one Node process per run:

```text
{"jobs": [{"profile": "finance", "sentences": ["Not strong."]},
          {"profile": "finance", "title": "t", "paragraphs": [{"type": "p", "text": "…"}, {"type": "h", "level": 2, "sentences": ["…"]}]}]}
```

A `sentences` job scores each string as one sentence and returns `score`, `raw` and the scored words (`text`, `base`, effective `score`, code-point `start` / `end`, `note`). A `paragraphs` job returns the document in this file format, exactly as "Export JSON" writes it. `tools/sm_engine.py` wraps it for Python; `examples/score_financial.py` uses it, so its output equals the page's Finance scores.

### Golden vectors

`test/golden.json` lists `{name, profile, text, expected: {score, words: [{text, base, score, note}]}}`. `node test/core.test.js` checks them on the JS engine, `python3 test/test_golden.py` through Python -> Node; both must match exactly. After a deliberate change, `node tools/update-golden.js` refills them and prints the differences to review.
