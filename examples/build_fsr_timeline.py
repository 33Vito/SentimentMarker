#!/usr/bin/env python3
"""Build the RBA FSR Diff + Timeline demo from the extracted texts in examples/fsr/.

    python examples/build_fsr_timeline.py            # score every edition, then diff them
    python examples/build_fsr_timeline.py --check    # rebuild in a temp dir and compare the committed script byte for byte

1. Text: examples/fsr/fsr-YYYY-MM.txt (plus examples/fsr-2026-10.txt, the reader demo), one per edition, extracted from the RBA PDF with the page's own joiner:
       node examples/pack_fsr.js --pdf financial-stability-review-2025-04.pdf --txt examples/fsr/fsr-2025-04.txt
   (needs pdfjs-dist@3.11.174, see pack_fsr.js). The PDFs themselves are not committed.
2. Before scoring, clean_prose() repairs two PDF text-layer leftovers: a bullet that survived as a leading "y ", and "and/ or".
3. Scores: examples/score_financial.py, Finance dictionary, the same engine for every edition (written to
   examples/fsr/build/, not committed: they are regenerated from the text in a few seconds).
   Word records then gain the engine's lexicon base and rule note (score-cli sentence detail), which the page shows.
4. Diff: tools/sm_diff.py with the topics in examples/fsr-topics.json and the per-edition provenance in
   examples/fsr/sources.json -> examples/fsr-timeline.diff.js, which SentimentDiff.html loads as a classic script
   (so it works from file://).

Text: Reserve Bank of Australia, Financial Stability Review (March 2024 - October 2026), CC BY 4.0.
Scores are SentimentMarker's, not the Reserve Bank's.
"""
import glob, os, re, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "examples", "fsr")
BUILD = os.path.join(SRC, "build")
JS_NAME = "fsr-timeline.diff.js"
ATTR = ("Source: Reserve Bank of Australia, Financial Stability Review, March 2024 to October 2026, "
        "https://www.rba.gov.au/publications/fsr/. Text reproduced under the Creative Commons Attribution 4.0 International "
        "licence (https://creativecommons.org/licenses/by/4.0/). Sentiment scores, topic tags and alignments were added by "
        "SentimentMarker and are not the Reserve Bank's. The Reserve Bank does not endorse this project.")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(ROOT, "tools"))
import sm_engine  # noqa: E402


def clean_prose(text):
    """Repair PDF leftovers before scoring. Does not touch ordinary words such as 'by Australian' or 'February'."""
    text = text.replace("\u00ad", "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(?m)(^|[.:;]\s+)y (?=[A-Z])", lambda m: m.group(1) + "• ", text)
    return text.replace("and/ or", "and/or")


def run(*args):
    r = subprocess.run([sys.executable, *args], cwd=ROOT)
    if r.returncode:
        sys.exit(r.returncode)


def edition_texts():
    # examples/fsr/ holds the earlier editions; the October 2026 text already lives in examples/ (the reader demo)
    texts = sorted(glob.glob(os.path.join(SRC, "fsr-????-??.txt")) + glob.glob(os.path.join(ROOT, "examples", "fsr-????-??.txt")),
                   key=os.path.basename)
    if len(texts) < 2:
        sys.exit("need at least two examples/fsr/fsr-YYYY-MM.txt files")
    return texts


def attach_word_detail(doc):
    """Copy lexicon base and rule note onto each scored word. Offsets stay the sentence's code points."""
    profile = (doc.get("model") or {}).get("profile") or "finance"
    flat = [s for p in doc.get("paragraphs") or [] for s in (p.get("sentences") or [])
            if isinstance(s, dict) and isinstance(s.get("text"), str)]
    if not flat:
        return doc
    details = sm_engine.score_sentences([s["text"] for s in flat], profile)
    for sent, detail in zip(flat, details):
        by = {(w.get("start"), w.get("end")): w for w in detail.get("words") or []}
        for w in sent.get("words") or []:
            src = by.get((w.get("start"), w.get("end")))
            if not src:
                continue
            if isinstance(src.get("base"), (int, float)):
                w["base"] = src["base"]
            if isinstance(src.get("note"), str) and src["note"]:
                w["note"] = src["note"]
    return doc


def build_pack(js_path, json_path):
    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    texts = edition_texts()
    editions = []
    for t in texts:
        eid = re.search(r"(\d{4}-\d{2})", os.path.basename(t)).group(1)
        y, m = eid.split("-")
        print(f"scoring {eid}", flush=True)
        with open(t, encoding="utf-8") as f:
            raw = f.read()
        cleaned = os.path.join(BUILD, f"fsr-{eid}.clean.txt")
        with open(cleaned, "w", encoding="utf-8", newline="\n") as f:
            f.write(clean_prose(raw))
        out = os.path.join(BUILD, f"fsr-{eid}.scored.json")
        run(os.path.join("examples", "score_financial.py"), cleaned, "--title",
            f"RBA Financial Stability Review ({MONTHS[int(m) - 1]} {y})", "-o", out)
        import json
        with open(out, encoding="utf-8") as f:
            doc = json.load(f)
        attach_word_detail(doc)
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        editions += ["--edition", f"{eid}={out}"]
    run(os.path.join("tools", "sm_diff.py"), *editions, "--topics", os.path.join("examples", "fsr-topics.json"),
        "--sources", os.path.join("examples", "fsr", "sources.json"),
        "--title", "RBA Financial Stability Review, " + re.search(r"(\d{4})", os.path.basename(texts[0])).group(1)
        + "–" + re.search(r"(\d{4})", os.path.basename(texts[-1])).group(1),
        "--note", ATTR, "-o", json_path, "--js", js_path)


def main():
    check = "--check" in sys.argv
    committed = os.path.join(ROOT, "examples", JS_NAME)
    if check:
        tmp = tempfile.mkdtemp(prefix="fsr-diff-check-")
        js_path = os.path.join(tmp, JS_NAME)
        json_path = os.path.join(tmp, "fsr-timeline.diff.json")
        build_pack(js_path, json_path)
        with open(js_path, encoding="utf-8", newline="\n") as f:
            got = f.read()
        with open(committed, encoding="utf-8", newline="\n") as f:
            have = f.read()
        if got != have:
            sys.exit("examples/fsr-timeline.diff.js is stale; run python examples/build_fsr_timeline.py")
        print("examples/fsr-timeline.diff.js matches the rebuild")
    else:
        os.makedirs(BUILD, exist_ok=True)
        build_pack(committed, os.path.join(BUILD, "fsr-timeline.diff.json"))


if __name__ == "__main__":
    main()
