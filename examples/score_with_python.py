#!/usr/bin/env python3
"""Score a text/markdown file with VADER and write a SentimentMarker JSON (or CSV) file.

    pip install vaderSentiment
    python score_with_python.py launch-week.md                # -> launch-week.scored.json
    python score_with_python.py launch-week.md --csv          # -> launch-week.scored.csv

This is a template: swap `score_word` / `score_sentence` / `score_paragraph` for your own
model or API call. Everything else (splitting, offsets, file layout) can stay as is.
The reference vocabulary is the full VADER lexicon, so the reader can show where the
document's words sit among all the words people commonly score.
"""
import argparse, csv, json, os, re, sys

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
except ImportError:
    sys.exit("需要先安装：pip install vaderSentiment")

vader = SentimentIntensityAnalyzer()
LEX = vader.lexicon                      # {word: valence in about -4 .. +4}
WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")
SENT = re.compile(r"(?<=[.!?])\s+(?=[\"'“(\[]?[A-Z0-9])")


def score_word(token):                   # replace with your own word-level scorer
    return LEX.get(token.lower(), 0.0)


def score_sentence(text):                # replace with your own sentence-level scorer
    return vader.polarity_scores(text)["compound"]          # -1 .. +1


def score_paragraph(sent_scores):        # replace if you score paragraphs directly
    return sum(sent_scores) / len(sent_scores) if sent_scores else 0.0


def read_paragraphs(path):
    """Blank-line separated blocks; markdown '#' lines become headings."""
    out = []
    for block in re.split(r"\n\s*\n", open(path, encoding="utf-8").read()):
        block = block.strip()
        if not block:
            continue
        if re.match(r"#{1,6}\s", block):
            out.append(("h", re.sub(r"^#{1,6}\s+", "", block.splitlines()[0])))
            block = "\n".join(block.splitlines()[1:]).strip()
            if not block:
                continue
        out.append(("p", " ".join(block.split())))
    return out


def build(path):
    paragraphs = []
    for kind, text in read_paragraphs(path):
        sents = []
        for s in (SENT.split(text) if kind == "p" else [text]):
            words = []
            for m in WORD.finditer(s):
                v = score_word(m.group())
                if v:
                    words.append({"text": m.group(), "score": round(v, 4), "start": m.start(), "end": m.end()})
            sents.append({"text": s, "score": round(score_sentence(s), 4), "words": words})
        paragraphs.append({"type": kind, "score": round(score_paragraph([x["score"] for x in sents]), 4), "sentences": sents})
    ref = sorted(v for v in LEX.values() if v)
    return {
        "version": 1,
        "title": os.path.splitext(os.path.basename(path))[0],
        "scale": {"word": 3.0, "sentence": 0.6, "paragraph": 0.3},   # score that gets full colour; optional
        "reference": {"name": "VADER 词典", "scores": ref,
                      "examples": [{"text": w, "score": LEX[w]} for w in ("terrible", "bad", "okay", "good", "great", "excellent") if w in LEX]},
        "paragraphs": paragraphs,
    }


def write_csv(doc, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["level", "paragraph", "sentence", "text", "score", "type", "start", "end", "note"])
        for pi, p in enumerate(doc["paragraphs"]):
            w.writerow(["paragraph", pi, "", "", p["score"], p["type"], "", "", ""])
            for si, s in enumerate(p["sentences"]):
                w.writerow(["sentence", pi, si, s["text"], s["score"], "", "", "", ""])
                for t in s["words"]:
                    w.writerow(["word", pi, si, t["text"], t["score"], "", t["start"], t["end"], ""])


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input"); ap.add_argument("-o", "--out"); ap.add_argument("--csv", action="store_true")
    a = ap.parse_args()
    doc = build(a.input)
    base = a.out or os.path.splitext(a.input)[0] + ".scored." + ("csv" if a.csv else "json")
    if a.csv:
        write_csv(doc, base)                 # CSV has no reference/scale; use JSON if you need the spectrum panel
    else:
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        # keep long number arrays on one line so the file stays small and readable
        text = re.sub(r"\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]", lambda m: "[" + re.sub(r"\s+", "", m.group(1)) + "]", text)
        open(base, "w", encoding="utf-8").write(text)
    n = sum(len(s["words"]) for p in doc["paragraphs"] for s in p["sentences"])
    print(f"wrote {base}: {len(doc['paragraphs'])} paragraphs, {n} scored words")
