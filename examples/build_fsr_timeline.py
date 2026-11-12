#!/usr/bin/env python3
"""Build the RBA FSR Diff + Timeline demo from the extracted texts in examples/fsr/.

    python examples/build_fsr_timeline.py            # score every examples/fsr/fsr-YYYY-MM.txt, then diff them

1. Text: examples/fsr/fsr-YYYY-MM.txt (plus examples/fsr-2026-10.txt, the reader demo), one per edition, extracted from the RBA PDF with the page's own joiner:
       node examples/pack_fsr.js --pdf financial-stability-review-2025-04.pdf --txt examples/fsr/fsr-2025-04.txt
   (needs pdfjs-dist@3.11.174, see pack_fsr.js). The PDFs themselves are not committed.
2. Scores: examples/score_financial.py, Finance dictionary, the same engine for every edition (written to
   examples/fsr/build/, not committed: they are regenerated from the text in a few seconds).
3. Diff: tools/sm_diff.py with the topics in examples/fsr-topics.json -> examples/fsr-timeline.diff.js, which
   SentimentDiff.html loads as a classic script (so it works from file://).

Text: Reserve Bank of Australia, Financial Stability Review (March 2024 - October 2026), CC BY 4.0.
Scores are SentimentMarker's, not the Reserve Bank's.
"""
import glob, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "examples", "fsr")
BUILD = os.path.join(SRC, "build")
ATTR = ("Source: Reserve Bank of Australia, Financial Stability Review, March 2024 to October 2026, "
        "https://www.rba.gov.au/publications/fsr/. Text reproduced under the Creative Commons Attribution 4.0 International "
        "licence (https://creativecommons.org/licenses/by/4.0/). Sentiment scores, topic tags and alignments were added by "
        "SentimentMarker and are not the Reserve Bank's. The Reserve Bank does not endorse this project.")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def run(*args):
    r = subprocess.run([sys.executable, *args], cwd=ROOT)
    if r.returncode:
        sys.exit(r.returncode)


def main():
    os.makedirs(BUILD, exist_ok=True)
    # examples/fsr/ holds the earlier editions; the October 2026 text already lives in examples/ (the reader demo)
    texts = sorted(glob.glob(os.path.join(SRC, "fsr-????-??.txt")) + glob.glob(os.path.join(ROOT, "examples", "fsr-????-??.txt")),
                   key=os.path.basename)
    if len(texts) < 2:
        sys.exit("need at least two examples/fsr/fsr-YYYY-MM.txt files")
    editions = []
    for t in texts:
        eid = re.search(r"(\d{4}-\d{2})", os.path.basename(t)).group(1)
        y, m = eid.split("-")
        out = os.path.join(BUILD, f"fsr-{eid}.scored.json")
        run(os.path.join("examples", "score_financial.py"), t, "--title",
            f"RBA Financial Stability Review ({MONTHS[int(m) - 1]} {y})", "-o", out)
        editions += ["--edition", f"{eid}={out}"]
    run(os.path.join("tools", "sm_diff.py"), *editions, "--topics", os.path.join("examples", "fsr-topics.json"),
        "--title", "RBA Financial Stability Review, " + re.search(r"(\d{4})", os.path.basename(texts[0])).group(1)
        + "–" + re.search(r"(\d{4})", os.path.basename(texts[-1])).group(1),
        "--note", ATTR, "-o", os.path.join(BUILD, "fsr-timeline.diff.json"), "--js", os.path.join("examples", "fsr-timeline.diff.js"))


if __name__ == "__main__":
    main()
