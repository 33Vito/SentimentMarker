#!/usr/bin/env python3
"""Score a text/markdown file with VADER and write a SentimentMarker JSON (or CSV) file.

    pip install vaderSentiment
    python score_with_python.py launch-week.md                # -> launch-week.scored.json
    python score_with_python.py launch-week.md --csv          # -> launch-week.scored.csv
    python score_with_python.py notes.md --lexicon my_zh.json   # Chinese words from your own lexicon

This is a template: swap `score_word` / `score_sentence` / `score_paragraph` for your own
model or API call. Everything else (splitting, offsets, file layout) can stay as is.
The reference vocabulary is the full VADER lexicon, so the reader can show where the
document's words sit among all the words people commonly score.

Chinese / CJK text: VADER is English-only. Sentences are split on 。！？ and line breaks, but
CJK words are only scored when you pass `--lexicon` (a JSON object {"词": score} or a TSV file
"词<TAB>score"); without it CJK sentences get no words and no sentence score, and the reader
shows them unmarked. Plug a real Chinese model into `cjk_words` / `score_sentence` if you have one.

Offsets (`start` / `end`) are Python str indices, i.e. Unicode code points, which is what the
reader expects (see docs/FORMAT.md).
"""
import argparse, csv, json, os, re, sys

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
except ImportError:
    sys.exit("Missing dependency: pip install vaderSentiment")

vader = SentimentIntensityAnalyzer()
LEX = vader.lexicon                      # {word: valence in about -4 .. +4}
WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")
CJK = re.compile(r"[㐀-鿿豈-﫿]")
CJK_RUN = re.compile(r"[㐀-鿿豈-﫿]+")
# sentence end: CJK 。！？ (anywhere), or . ! ? followed by space and a capital/digit/quote
SENT_END = re.compile(r"[。！？]+[”’」』）)]*|(?<=[.!?])[\"'”’)\]]*\s+(?=[\"'“(\[]?[A-Z0-9])")


def score_word(token):                   # replace with your own word-level scorer
    return LEX.get(token.lower(), 0.0)


def score_sentence(text):                # replace with your own sentence-level scorer
    """VADER compound (-1 .. +1). Returns None for CJK-only text: VADER cannot read it, so the
    reader derives the sentence score from the word scores instead."""
    if CJK.search(text) and not WORD.search(text):
        return None
    return vader.polarity_scores(text)["compound"]


def score_paragraph(sent_scores):        # replace if you score paragraphs directly
    xs = [s for s in sent_scores if s is not None]
    return sum(xs) / len(xs) if xs else None


def cjk_words(sentence, lexicon):
    """Optional hook for CJK words: greedy longest match of `lexicon` entries inside CJK runs.
    Returns [(start, end, word, score)] with code-point offsets. Empty without a lexicon."""
    if not lexicon:
        return []
    maxlen = max((len(w) for w in lexicon), default=0)
    out = []
    for run in CJK_RUN.finditer(sentence):
        i = run.start()
        while i < run.end():
            for L in range(min(maxlen, run.end() - i), 0, -1):
                w = sentence[i:i + L]
                if w in lexicon:
                    out.append((i, i + L, w, lexicon[w]))
                    i += L
                    break
            else:
                i += 1
    return out


def split_sentences(text):
    """CJK-aware: split after 。！？, after . ! ? + space + capital, and at line breaks."""
    out = []
    for line in text.split("\n"):
        start = 0
        for m in SENT_END.finditer(line):
            end = m.end()
            piece = line[start:end].strip()
            if piece:
                out.append(piece)
            start = end
        piece = line[start:].strip()
        if piece:
            out.append(piece)
    return out


def join_lines(lines):
    """Wrapped English lines become one paragraph; a line break next to CJK text is kept as a break."""
    text = ""
    for ln in (l.strip() for l in lines):
        if not ln:
            continue
        if text:
            text += "\n" if (CJK.search(text[-1]) or CJK.search(ln[0])) else " "
        text += ln
    return text


def read_paragraphs(path):
    """Blank-line separated blocks; markdown '#' lines become headings."""
    out = []
    for block in re.split(r"\n\s*\n", open(path, encoding="utf-8").read().replace("\r\n", "\n")):
        block = block.strip()
        if not block:
            continue
        if re.match(r"#{1,6}\s", block):
            out.append(("h", re.sub(r"^#{1,6}\s+", "", block.splitlines()[0]).strip()))
            block = "\n".join(block.splitlines()[1:]).strip()
            if not block:
                continue
        out.append(("p", join_lines(block.splitlines())))
    return out


def load_lexicon(path):
    if not path:
        return {}
    if path.endswith(".json"):
        return {str(k): float(v) for k, v in json.load(open(path, encoding="utf-8")).items()}
    lex = {}
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2 and parts[0]:
            try:
                lex[parts[0]] = float(parts[1])
            except ValueError:
                pass
    return lex


def build(path, lexicon=None):
    paragraphs = []
    for kind, text in read_paragraphs(path):
        sents = []
        for s in (split_sentences(text) if kind == "p" else [text]):
            words = []
            for m in WORD.finditer(s):
                v = lexicon.get(m.group().lower(), score_word(m.group())) if lexicon else score_word(m.group())
                if v:
                    words.append({"text": m.group(), "score": round(v, 4), "start": m.start(), "end": m.end()})
            for a, b, w, v in cjk_words(s, lexicon):
                if v:
                    words.append({"text": w, "score": round(v, 4), "start": a, "end": b})
            words.sort(key=lambda x: x["start"])
            sent = {"text": s}
            sc = score_sentence(s)
            if sc is not None:
                sent["score"] = round(sc, 4)
            sent["words"] = words
            sents.append(sent)
        para = {"type": kind}
        ps = score_paragraph([x.get("score") for x in sents])
        if ps is not None:
            para["score"] = round(ps, 4)
        para["sentences"] = sents
        paragraphs.append(para)
    ref = sorted(v for v in LEX.values() if v)
    return {
        "version": 1,
        "title": os.path.splitext(os.path.basename(path))[0],
        # |score| that gets full colour. Optional, but always write it: otherwise the reader
        # picks the 90th percentile of this file, so colours change from file to file.
        "scale": {"word": 3.0, "sentence": 0.6, "paragraph": 0.3},
        "reference": {"name": "VADER dictionary", "scores": ref,
                      "examples": [{"text": w, "score": LEX[w]} for w in ("terrible", "bad", "okay", "good", "great", "excellent") if w in LEX]},
        "paragraphs": paragraphs,
    }


def write_csv(doc, path):
    blank = lambda v: "" if v is None else v
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["level", "paragraph", "sentence", "text", "score", "type", "start", "end", "note"])
        for pi, p in enumerate(doc["paragraphs"]):
            w.writerow(["paragraph", pi, "", "", blank(p.get("score")), p["type"], "", "", ""])
            for si, s in enumerate(p["sentences"]):
                w.writerow(["sentence", pi, si, s["text"], blank(s.get("score")), "", "", "", ""])
                for t in s["words"]:
                    w.writerow(["word", pi, si, t["text"], t["score"], "", t["start"], t["end"], ""])


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input"); ap.add_argument("-o", "--out"); ap.add_argument("--csv", action="store_true")
    ap.add_argument("--lexicon", help="optional {word: score} JSON or word<TAB>score TSV; used for CJK words (and overrides VADER for English words it lists)")
    a = ap.parse_args()
    doc = build(a.input, load_lexicon(a.lexicon))
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
