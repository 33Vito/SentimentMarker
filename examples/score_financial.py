#!/usr/bin/env python3
"""Score finance prose with a graded word list built from Loughran-McDonald (finance-specific
polarity) and VADER (graded strength), and write a SentimentMarker JSON file.

    pip install vaderSentiment pysentiment2
    python score_financial.py report.txt                # one paragraph per blank-line block
    python score_financial.py report.txt --title "RBA Financial Stability Review (Oct 2026), Assessment"

How the word list is built (this is an example, not a validated model):
  * Loughran-McDonald decides polarity: a word counts only if LM marks it Negative or Positive.
    This keeps neutral finance words such as "risk", "capital", "credit" from lighting up, which
    general-purpose lexicons get wrong on financial text.
  * VADER supplies the strength when it agrees on sign; otherwise +-1.5.
  * VADER-only words are kept only when strongly polarised (|score| >= 2.5).
The same list is written as `reference`, so the spectrum panel compares the document with it.
Offsets are Unicode code points (Python str indices).
"""
import argparse, csv, json, os, re, sys

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    import pysentiment2, importlib.util
except ImportError:
    sys.exit("需要先安装：pip install vaderSentiment pysentiment2")

VADER = SentimentIntensityAnalyzer().lexicon
LM_CSV = os.path.join(os.path.dirname(pysentiment2.__file__), "static", "LM.csv")
WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")
SENT = re.compile(r"(?<=[.!?])\s+(?=[\"'“(\[]?[A-Z0-9])")
ABBR = re.compile(r"\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Ms|No|Inc|Ltd|Pty|cf|approx)\.$")


def build_lexicon():
    lex = {}
    for r in csv.DictReader(open(LM_CSV, encoding="utf-8")):
        w = r["Word"].lower()
        neg, pos = r["Negative"] not in ("0", ""), r["Positive"] not in ("0", "")
        if neg == pos:
            continue
        sign = 1 if pos else -1
        v = VADER.get(w)
        lex[w] = v if v is not None and (v > 0) == (sign > 0) and v != 0 else 1.5 * sign
    for w, v in VADER.items():
        if w not in lex and abs(v) >= 2.5 and w.isalpha():
            lex[w] = v
    return lex


LEX = build_lexicon()
# Fixed phrases whose words are a topic name, not sentiment ("financial stability" is polarity-free).
NEUTRAL_PHRASES = [re.compile(r"\bfinancial\s+(stability)\b", re.I)]


def neutral_spans(text):
    return [m.span(1) for p in NEUTRAL_PHRASES for m in p.finditer(text)]


def split_sentences(text):
    out, start = [], 0
    for m in SENT.finditer(text):
        if ABBR.search(text[start:m.start()]):
            continue
        out.append(text[start:m.start()]); start = m.end()
    out.append(text[start:])
    return [s for s in out if s.strip()]


def build(path, title):
    paragraphs = []
    for block in re.split(r"\n\s*\n", open(path, encoding="utf-8").read()):
        block = block.strip()
        if not block:
            continue
        kind = "p"
        if block.startswith("# "):
            kind, block = "h", block[2:].strip()
        sents = []
        for s in ([block] if kind == "h" else split_sentences(block)):
            skip = neutral_spans(s)
            words = [{"text": m.group(), "score": round(LEX[m.group().lower()], 3), "start": m.start(), "end": m.end()}
                     for m in WORD.finditer(s) if m.group().lower() in LEX and m.span() not in skip]
            sents.append({"text": s, "words": words})        # sentence / paragraph scores are derived from the words
        paragraphs.append({"type": kind, "sentences": sents})
    return {
        "version": 1, "title": title,
        "scale": {"word": 2.5},
        "reference": {"name": "LM × VADER 金融词表", "scores": sorted(round(v, 3) for v in LEX.values()),
                      "examples": [{"text": w, "score": round(LEX[w], 3)} for w in
                                   ("losses", "vulnerabilities", "disruption", "stress", "resilient", "stable", "favourable", "strong") if w in LEX]},
        "paragraphs": paragraphs,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input"); ap.add_argument("-o", "--out"); ap.add_argument("--title")
    a = ap.parse_args()
    doc = build(a.input, a.title or os.path.splitext(os.path.basename(a.input))[0])
    out = a.out or os.path.splitext(a.input)[0] + ".scored.json"
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    text = re.sub(r"\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]", lambda m: "[" + re.sub(r"\s+", "", m.group(1)) + "]", text)
    open(out, "w", encoding="utf-8").write(text)
    n = sum(len(s["words"]) for p in doc["paragraphs"] for s in p["sentences"])
    print(f"wrote {out}: {len(doc['paragraphs'])} paragraphs, {n} scored words, lexicon {len(LEX)} words")
