# Third-party notices

SentimentMarker's own code is in this repository. The following third-party material is included in it, derived from, or used by it.

## Loughran-McDonald Master Dictionary

- **What:** the finance word list by Tim Loughran and Bill McDonald (University of Notre Dame). Its Negative / Positive columns decide the polarity of the Finance dictionary.
- **Where:** `data/sentiment-model.json` (`vocabularies.finance`), the generated `lexicon/finance.js`, and the `reference` scores of the finance-scored examples (`examples/fsr-assessment-2026-10.scored.json`, `examples/fsr-2026-10.scored.json`, `examples/financial-stability-review.scored.json`, `examples/demos.js`, `examples/fsr-2026-10.demo.js`).
- **Source:** `LM.csv` as shipped in pysentiment2 0.1.1. The package does not state which LM release it contains. sha256 `8fc9dbfc2e66e0c1a99e8f03fb30f5e255f7bd401d33b63facd2c85a2d061729`, also recorded in `data/sentiment-model.json` (`sources.upstream.loughranMcDonald`).
- **Licence:** free for non-commercial / academic use only. **Commercial use requires a licence from the authors.** Terms and contact: https://sraf.nd.edu/loughranmcdonald-master-dictionary/
- **Citation:** Loughran, T. and McDonald, B. (2011), "When Is a Liability Not a Liability? Textual Analysis, Dictionaries, and 10-Ks", *Journal of Finance* 66(1), 35–65.

If you use SentimentMarker's Finance dictionary commercially, obtain that licence first, or replace the finance vocabulary (`tools/build_finance_vocab.py` builds it; any `{word: score}` list can take its place in `data/sentiment-model.json`).

## VADER sentiment lexicon

- **What:** the VADER lexicon by C.J. Hutto and Eric Gilbert. Its mean valences give the strength of Finance dictionary words where VADER agrees with LM on the sign, plus strongly polarised VADER-only words (|score| ≥ 2.5).
- **Where:** the same files as above. Also `examples/launch-week.scored.json` / `.csv`, which `examples/score_with_python.py` scored with vaderSentiment; the JSON's `reference` lists every VADER lexicon score.
- **Source:** `vader_lexicon.txt` from vaderSentiment 3.3.2, sha256 `1ec9c6e9ee19aade328f8beb393a6afa71a5bb3acf7d3cc22d4ef568df374bf5` (`sources.upstream.vader`).
- **Citation:** Hutto, C.J. and Gilbert, E.E. (2014), "VADER: A Parsimonious Rule-based Model for Sentiment Analysis of Social Media Text", Eighth International Conference on Weblogs and Social Media (ICWSM-14).
- **Licence:** MIT:

```text
The MIT License (MIT)

Copyright (c) 2016 C.J. Hutto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## pysentiment2 (build-time only)

`tools/build_finance_vocab.py` imports pysentiment2 0.1.1 (https://github.com/nickderobertis/pysentiment) only to read the `LM.csv` it ships. No pysentiment2 code is included in this repository or needed to run it. The Loughran-McDonald terms above cover the word list, whichever package delivers it. For the package itself, its metadata says MIT, but the `LICENSE` file in the 0.1.1 distribution is the GNU GPL version 2 text (from the original pysentiment). Check that discrepancy yourself if you redistribute pysentiment2.

## Reserve Bank of Australia, Financial Stability Review, October 2026

The RBA text in `examples/` (the `.txt` files and the packed demo scripts) is reproduced under the Creative Commons Attribution 4.0 International licence (https://creativecommons.org/licenses/by/4.0/). The full attribution, and what the licence does not cover, are in the README, under "Layout". `examples/financial-stability-review-2026-10.pdf` is the unmodified publication. It includes material the RBA excludes from CC BY 4.0 (https://www.rba.gov.au/copyright/), and this project does not relicense it.

## pdf.js (loaded at run time, not included)

`index.html` loads pdf.js 3.11.174 from cdnjs to read PDFs. `examples/pack_fsr.js` uses pdfjs-dist 3.11.174 if you install it. pdf.js is Apache-2.0-licensed (https://github.com/mozilla/pdf.js), and neither copy is in this repository.
