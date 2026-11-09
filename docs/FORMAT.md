# Scoring file format

SentimentMarker makes no sentiment judgements itself. Compute the scores with your own Python module or API, save them as JSON or CSV, and bring them in with "Open file" or by dropping the file on the page.
The dictionary approach built into the browser is only a demo, used when there are no external scores.

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
