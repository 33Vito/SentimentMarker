#!/usr/bin/env python3
"""Score finance prose with the finance dictionary (Loughran-McDonald polarity x VADER strength) and write a
SentimentMarker JSON file.

    python score_financial.py report.txt                # one paragraph per blank-line block; "# " / "## " = headings
    python score_financial.py report.txt --title "RBA Financial Stability Review (Oct 2026), Assessment"

Needs Node.js, not pysentiment2: the scores come from the same JS engine the page uses (sentiment-core.js,
called once per run through tools/score-cli.js), with the finance profile of data/sentiment-model.json, so a
file scored here and the same text pasted into the page with the Finance dictionary get identical scores
(negation, boosters, contrast, caps, exclamation marks, the "financial stability" neutral phrase, exact match).

The vocabulary itself (an example, not a validated model) is built by tools/build_finance_vocab.py, which is
the only step that needs `pip install vaderSentiment pysentiment2`:
  * Loughran-McDonald decides polarity: a word counts only if LM marks it Negative or Positive.
    This keeps neutral finance words such as "risk", "capital", "credit" from lighting up, which
    general-purpose lexicons get wrong on financial text.
  * VADER supplies the strength when it agrees on sign; otherwise +-1.5.
  * VADER-only words are kept only when strongly polarised (|score| >= 2.5).
The same list is written as `reference`, so the spectrum panel compares the document with it.
Offsets are Unicode code points (Python str indices).

Licence: the Loughran-McDonald word list is free for non-commercial / academic use only; commercial use
requires a licence from its authors. VADER is MIT-licensed.
"""
import argparse, json, os, re, sys

sys.dont_write_bytecode = True                         # no __pycache__ inside the repo's tools/
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import sm_engine  # noqa: E402

PROFILE = "finance"
MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "sentiment-model.json")


def profile_scale(profile=PROFILE):
    """The profile's colour scale from data/sentiment-model.json, as the file's `scale`. A level the model sets to "auto"
    is left out, so the reader applies the same 90th-percentile rule the page applies to text scored with that profile."""
    with open(MODEL, encoding="utf-8") as f:
        scale = json.load(f)["vocabularies"][profile]["scale"]
    return {k: scale[k] for k in ("word", "sentence", "paragraph") if scale[k] != "auto"}


def build_lexicon():
    """The finance vocabulary rebuilt from upstream (needs pysentiment2 + vaderSentiment); see tools/build_finance_vocab.py."""
    from build_finance_vocab import build_lexicon as rebuild
    return rebuild()


def read_paragraphs(path):
    """Blank-line blocks; a block starting with "# " or "## " is one heading (level 1 / 2), kept as one sentence."""
    out = []
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    for block in re.split(r"\n\s*\n", raw):
        block = block.strip()
        if not block:
            continue
        if block.startswith("## "):
            out.append({"type": "h", "level": 2, "sentences": [block[3:].strip()]})
        elif block.startswith("# "):
            out.append({"type": "h", "sentences": [block[2:].strip()]})
        else:
            out.append({"type": "p", "text": block})      # split into sentences by the engine
    return out


def build(path, title):
    doc = sm_engine.score_document(read_paragraphs(path), title, PROFILE)
    return {
        "version": 1, "title": title,
        "model": doc["model"],                            # provenance: {version, profile} of the engine that scored it
        "scale": profile_scale(),                         # finance: {"word": 2.5}; sentence / paragraph "auto"
        "reference": doc["reference"],                    # every score of the finance vocabulary
        "paragraphs": doc["paragraphs"],
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input"); ap.add_argument("-o", "--out"); ap.add_argument("--title")
    a = ap.parse_args()
    try:
        doc = build(a.input, a.title or os.path.splitext(os.path.basename(a.input))[0])
    except sm_engine.EngineError as e:
        sys.exit("scoring failed: " + str(e))
    out = a.out or os.path.splitext(a.input)[0] + ".scored.json"
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    text = re.sub(r"\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]", lambda m: "[" + re.sub(r"\s+", "", m.group(1)) + "]", text)
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    n = sum(len(s["words"]) for p in doc["paragraphs"] for s in p["sentences"])
    print(f"wrote {out}: {len(doc['paragraphs'])} paragraphs, {n} scored words, lexicon {len(doc['reference']['scores'])} words")
