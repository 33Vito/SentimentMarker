#!/usr/bin/env python3
"""(Re)build the finance vocabulary in data/sentiment-model.json from its upstream word lists.

    pip install vaderSentiment pysentiment2
    python tools/build_finance_vocab.py            # rebuild, then node tools/build-lexicon.js writes the model + assets
    python tools/build_finance_vocab.py --check    # exit 1 if the model's finance vocabulary / upstream hashes are stale

How the word list is built (an example, not a validated model):
  * Loughran-McDonald decides polarity: a word counts only if LM marks it Negative or Positive (not both).
    This keeps neutral finance words such as "risk", "capital", "credit" from lighting up, which
    general-purpose lexicons get wrong on financial text.
  * VADER supplies the strength when it agrees on sign; otherwise +-1.5.
  * VADER-only words are kept only when strongly polarised (|score| >= 2.5) and purely alphabetic.

This script only produces data. Scoring is done by the one JS engine (sentiment-core.js), from the
browser or, offline, through tools/score-cli.js (see examples/score_financial.py).

Licence: the Loughran-McDonald Master Dictionary is free for non-commercial / academic use only;
commercial use requires a licence from its authors (https://sraf.nd.edu/loughranmcdonald-master-dictionary/).
VADER is MIT-licensed.
"""
import argparse, csv, hashlib, json, os, subprocess, sys
from importlib import metadata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODEL = os.path.join(ROOT, "data", "sentiment-model.json")
NODE = os.environ.get("NODE", "node")


def upstream_paths():
    """(LM.csv, vader_lexicon.txt) paths; ImportError when either package is missing."""
    import pysentiment2, vaderSentiment
    return (os.path.join(os.path.dirname(pysentiment2.__file__), "static", "LM.csv"),
            os.path.join(os.path.dirname(vaderSentiment.__file__), "vader_lexicon.txt"))


def build_lexicon():
    """{word: score} for the finance profile (3381 words with pysentiment2 0.1.1 and vaderSentiment 3.3.2)."""
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    lm_csv, _ = upstream_paths()
    vader = SentimentIntensityAnalyzer().lexicon
    lex = {}
    with open(lm_csv, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            w = r["Word"].lower()
            neg, pos = r["Negative"] not in ("0", ""), r["Positive"] not in ("0", "")
            if neg == pos:
                continue
            sign = 1 if pos else -1
            v = vader.get(w)
            lex[w] = v if v is not None and (v > 0) == (sign > 0) and v != 0 else 1.5 * sign
    for w, v in vader.items():
        if w not in lex and abs(v) >= 2.5 and w.isalpha():
            lex[w] = v
    return lex


def sha256_file(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def upstream_info():
    lm_csv, vader_txt = upstream_paths()
    return {
        "loughranMcDonald": {
            "name": "Loughran-McDonald Master Dictionary",
            "version": "as shipped in pysentiment2 " + metadata.version("pysentiment2") + " (the package does not state the LM release)",
            "file": "pysentiment2/static/LM.csv",
            "sha256": sha256_file(lm_csv),
            "url": "https://sraf.nd.edu/loughranmcdonald-master-dictionary/",
            "licence": "Free for non-commercial / academic use only; commercial use requires a licence from the authors (Tim Loughran and Bill McDonald).",
            "role": "polarity (Negative / Positive columns)",
        },
        "vader": {
            "name": "VADER sentiment lexicon",
            "version": "vaderSentiment " + metadata.version("vaderSentiment"),
            "file": "vaderSentiment/vader_lexicon.txt",
            "sha256": sha256_file(vader_txt),
            "url": "https://github.com/cjhutto/vaderSentiment",
            "licence": "MIT",
            "role": "strength (mean valence)",
        },
    }


def stale_reasons(model=None):
    """[] when data/sentiment-model.json matches what the upstream packages produce now."""
    if model is None:
        with open(MODEL, encoding="utf-8") as f:
            model = json.load(f)
    out = []
    want = build_lexicon()
    have = model["vocabularies"]["finance"]["words"]
    if have != want:
        diff = sorted(set(have) ^ set(want)) or sorted(w for w in want if have.get(w) != want[w])
        out.append(f"finance words differ ({len(have)} in the model, {len(want)} rebuilt; e.g. {diff[:5]})")
    up = model.get("sources", {}).get("upstream", {})
    for k, v in upstream_info().items():
        if up.get(k, {}).get("sha256") != v["sha256"]:
            out.append(f"sources.upstream.{k}.sha256 is stale")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if the model is stale; write nothing")
    a = ap.parse_args(argv)
    try:
        upstream_paths()
    except ImportError:
        sys.exit("Missing dependencies: pip install vaderSentiment pysentiment2")
    if a.check:
        bad = stale_reasons()
        for b in bad:
            print("stale: " + b, file=sys.stderr)
        print("finance vocabulary up to date" if not bad else "run: python tools/build_finance_vocab.py")
        return 1 if bad else 0
    payload = json.dumps({"words": build_lexicon(), "upstream": upstream_info()}, ensure_ascii=False)
    r = subprocess.run([NODE, os.path.join(ROOT, "tools", "build-lexicon.js"), "--import-finance", "-"],
                       input=payload.encode("utf-8"), cwd=ROOT)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
