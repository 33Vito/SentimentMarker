# Diff + Timeline format

`tools/sm_diff.py` compares N editions of one publication and writes a `sentiment-diff` JSON file. `SentimentDiff.html` shows it: a timeline of topic and section means, and for any edition the diff against the previous one, with the change split into its sources and the sentences behind it.

```
python tools/sm_diff.py --edition 2026-03=a.scored.json --edition 2026-10=b.scored.json \
                        --topics examples/fsr-topics.json -o out.diff.json --js out.diff.js
python examples/build_fsr_timeline.py        # the RBA FSR demo: score examples/fsr/*.txt, then diff
```

The inputs are ordinary scored files ([FORMAT.md](FORMAT.md)). Edition ids of the form `YYYY-MM` are sorted chronologically before alignment, so passing them newest-first cannot swap added and removed. Valid months are 01–12 (and years 0001–9999); invalid dates and mixed date/non-date IDs are refused. For non-date IDs, the CLI requires `--assume-ordered` to confirm they are supplied oldest first; the Python API requires `assume_ordered=True`. Their actual chronology cannot be verified. Duplicate ids are refused. Every file must come from the same model and profile: the tool compares their `model` fields and refuses a mix, because a timeline measured with two rulers shows the change of ruler, not of text. Files with external scores and no `model` are accepted together.

## Method

**What is compared.** Every scored sentence, including level-2 headings (the RBA writes its key messages as headings). Left out: everything under Endnotes / Contents / References / Copyright headings, and chart furniture that leaks into PDF text (lines starting with Sources, Notes, Latest / Earliest observation, Graph / Table / Figure N). Scores are taken after subtracting the file's `center`.

**Sections.** A level-1 heading opens a section. Dates, running titles, bare "Chapter N" and "Focus Topics" headings are not sections. The key drops numbering and prefixes ("Chapter 1 The Global…", "1.2 Key…", "Focus Topic: …"), and a key within 0.86 word similarity of one seen in an earlier edition joins it, so a lightly renamed section stays one row. A level-1 "Summary" is named after the chapter that follows it.

**Topics.** A JSON list of `{id, label, patterns}`; a sentence belongs to a topic when any pattern (case-insensitive regular expression, whole words) matches. A sentence can be in several topics, as in the reader's topic summary.

**Alignment** (adjacent editions A → B, across the whole document, because text moves between sections):

| Kind | Rule |
| --- | --- |
| unchanged | normalised text identical (case, whitespace, quotes, dashes, leading bullets). Duplicates are paired one to one, in order |
| edited | word-token similarity (`difflib` ratio) ≥ `--min-sim` (0.55). Candidates share rare words; pairs are taken greedily, best first; the same section breaks ties |
| removed / added | left over in A / in B |

Unchanged sentences must keep their score exactly (the built-in engine scores a sentence on its own). The tool reports any that do not as `unchangedScoreMismatch`, which would mean the editions were not scored the same way.

**Decomposition.** For a group (all text, a topic or a section) with means m_A, m_B and n_B sentences in B:

```
m_B − m_A = edit + added + removed
edit    =  Σ edited pairs  (b − a) / n_B
added   =  Σ added         (b − m_A) / n_B
removed = −Σ removed       (a − m_A) / n_B
```

The identity is exact (checked for every group, error < 1e-9). Unchanged sentences contribute 0. An added sentence moves the mean only by how far it sits from the old mean, so adding a sentence exactly as negative as the old average changes nothing. A sentence that enters or leaves a group through an edit (the topic word was written in or out) counts as added or removed for that group. Each term is a sum of per-sentence contributions, which are the evidence list.

In absolute mode, the page draws a descriptive mean-score band of ±1.96 standard errors around each mean. Relative-mode bands are omitted because the group and edition means overlap and their covariance is not captured by the stored standard errors. The sentences are the text, not a random sample, so the band is not a confidence interval and not a significance test. A one-sentence group has no standard error (`se` is null); it is not stored as 0. Means and changes are withheld when either side has fewer than `params.minHits` sentences (5). The chart leaves a gap there instead of connecting across it.

"vs. edition mean" subtracts the edition's all-text mean, so a shift in the whole document's tone does not read as a change in every topic. In that mode the heading number is the relative change. The mean-change band sentence is shown only next to the absolute change, and it quotes that same number. The whole-text group is the reference in this mode, so its relative change is 0 by definition and the page says so instead of calling it unchanged. A group that exists on only one side still lists its sentences; it has no delta.

An added, removed or unmatched sentence is not by itself a policy addition or deletion. A sentence score is the whole sentence, not aspect-level sentiment. The Assessment rows (`kind: "assessment"`) keep only sentences whose section key is `financial stability assessment`, so those comparisons share one section. Section rows still follow PDF reading order.

## JSON

```json
{
  "format": "sentiment-diff", "version": 1,
  "title": "RBA Financial Stability Review, 2024–2026",
  "model": {"version": "1.0.0", "profile": "finance"},
  "params": {"minSim": 0.55, "neutral": 0.2, "minHits": 5},
  "scale": {"word": 2.5, "sentence": 0.8, "mean": 0.4, "delta": 0.2},
  "topics": [{"id": "banks", "label": "Banks", "patterns": ["banks?", "banking"]}],
  "groups": [{"id": "all", "label": "All text", "kind": "all"},
             {"id": "t:banks", "label": "Banks", "kind": "topic", "patterns": ["banks?"]},
             {"id": "s:banks", "label": "3.1 Banks", "kind": "section"}],
  "sectionKeys": ["financial stability assessment", "banks"],
  "editions": [{
    "id": "2026-03", "label": "Mar 2026", "title": "…",
    "source": "https://www.rba.gov.au/publications/fsr/2026/mar/",
    "pages": [1, 79], "assessmentPages": [4, 8],
    "scope": "Full Financial Stability Review text layer",
    "quality": "Extracted with pack_fsr.js. Bullet glyphs and 'and/ or' repaired before scoring.",
    "sections": ["financial stability assessment", "banks"],
    "stats": {"t:banks": {"n": 123, "mean": -0.075, "se": 0.021, "neg": 40, "pos": 22}},
    "sentences": [{"t": "Banks remain well placed…", "s": 0.49, "sec": 1, "tp": [0], "w": [[0, 5, 1.6, 1.6], [13, 23, -1.2, 2.2, "negated not"]], "h": 1}]
  }],
  "diffs": [{
    "from": 0, "to": 1,
    "pairs": [[0, 0, "u", 1.0], [3, 2, "e", 0.938]],
    "removed": [4], "added": [3],
    "ops": {"3:2": [[[24, 30]], [[24, 32]]]},
    "unchangedScoreMismatch": 0,
    "groups": {"t:banks": {"delta": -0.072, "edit": -0.004, "added": -0.06, "removed": -0.008,
                           "counts": {"u": 3, "e": 5, "a": 40, "r": 30},
                           "items": [["a", null, 17, -0.0051], ["e", 3, 2, -0.0032], ["r", 9, null, 0.0011]]}}
  }]
}
```

| Field | Meaning |
| --- | --- |
| `editions[].source / pages / assessmentPages / scope / quality` | Optional per-edition provenance. `pages` and `assessmentPages` are `[first, last]` PDF pages. The page prints them next to the evidence |
| `editions[].sentences[]` | `t` text, `s` score (centre removed), `sec` index into `sectionKeys` (or null), `tp` indexes into `topics`, `w` scored words, `h` 1 for a heading. A word is `[start, end, effective]`, or with a lexicon base `[start, end, effective, base]`, or `[start, end, effective, base, note]` when a rule note exists. Offsets are code points. Effective is centre-removed; base is the lexicon weight before negation, boosters and caps. A zero effective score is not a positive weight |
| `editions[].stats[group]` | `n`, `mean`, `se` (standard error; null when `n < 2`), `neg` / `pos` counts beyond ±`params.neutral` |
| `groups[].kind` | `all`, `topic`, `section`, or `assessment` (the Assessment section, and each topic inside it) |
| `diffs[].groups[group].oneSided` | `"added"` or `"removed"` when the group has sentences on only one side. `delta` is then null and the items still list those sentences |
| `diffs[].pairs` | `[i in A, j in B, "u" or "e", similarity]` |
| `diffs[].ops["i:j"]` | changed word spans of an edited pair: `[deleted spans in A, inserted spans in B]`, code points |
| `diffs[].groups[group].items` | `[kind, i or null, j or null, contribution]`, kind `e` / `a` / `r`, sorted by \|contribution\| |
| `scale` | colour scales shared by every edition: word (from the inputs), sentence (90th percentile of \|score\|), mean (95th percentile of group means with n ≥ 5), delta |

`--js` writes the same object as `window.DIFF_FILES["<name>.json"] = …` for pages opened from `file://`. `SentimentDiff.html` loads `examples/fsr-timeline.diff.js` by default and opens any other diff JSON through "Open diff JSON".

## Known limits

- Section boundaries follow PDF stream order. A box has no closing heading, so text after a box until the next heading is counted in the box (Oct 2025: most of "2.2 Businesses" sits under its box). Topics are not affected; prefer them for comparisons.
- Most of an FSR is rewritten each edition (only 10–20% of sentences carry over unchanged or edited), so changes are mostly explained by added and removed sentences. That is a property of the text, not a failed alignment: the closest leftover pairs score well below the edit threshold.
- Topic patterns are keywords; "risk premia" text that never says "equity" is missed, and a sentence that mentions banks in passing counts fully for Banks.
- The scores are the Finance dictionary's (Loughran-McDonald polarity, VADER strength), a demo-quality lexicon with no sense of context. The diff is only as good as the scorer; swap in a model and rerun.
- Full-review section rows move when the PDF's box and heading structure moves. Prefer topics, or the Assessment rows, when the comparison should stay on one scope.
