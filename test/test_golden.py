#!/usr/bin/env python3
"""Golden vectors through the Python -> Node batch path: the same test/golden.json that test/core.test.js runs on
the JS engine directly must come back identical through tools/sm_engine.py -> tools/score-cli.js.

    python3 test/test_golden.py          # plain runner, no pytest needed
    python3 -m pytest test/test_golden.py

Needs Node.js. The finance-vocabulary rebuild check needs pysentiment2 + vaderSentiment and is skipped without them;
the Node path still runs.
"""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "examples"))
import sm_engine  # noqa: E402

with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as f:
    GOLDEN = json.load(f)


class Skip(Exception):
    pass


PLAIN = False   # True under the plain runner below: skip with our own exception, not pytest's


def skip(msg):
    if PLAIN:
        raise Skip(msg)
    import pytest
    pytest.skip(msg)


def project(r):
    """the CLI's sentence result in the golden shape (offsets are checked separately)"""
    words = []
    for w in r["words"]:
        x = {"text": w["text"], "base": w["base"], "score": w["score"]}
        if "note" in w:
            x["note"] = w["note"]
        words.append(x)
    return {"score": r["score"], "words": words}


def batch():
    """every golden case in one Node process: one job per profile, case order kept"""
    profiles = sorted({c["profile"] for c in GOLDEN["cases"]})
    jobs = [{"profile": p, "sentences": [c["text"] for c in GOLDEN["cases"] if c["profile"] == p]} for p in profiles]
    res = sm_engine.score(jobs)
    out, it = {}, {p: iter(r["sentences"]) for p, r in zip(profiles, res)}
    for i, c in enumerate(GOLDEN["cases"]):
        out[i] = next(it[c["profile"]])
    return out


def test_golden_vectors_identical_through_node():
    got = batch()
    bad = [c["name"] for i, c in enumerate(GOLDEN["cases"]) if project(got[i]) != c["expected"]]
    assert not bad, "golden mismatch via Python -> Node: " + "; ".join(bad)


def test_offsets_are_code_points():
    got = batch()
    for i, c in enumerate(GOLDEN["cases"]):
        for w in got[i]["words"]:
            assert c["text"][w["start"]:w["end"]] == w["text"], (c["name"], w)


def test_required_cases_present():
    have = {(c["text"], c["profile"]) for c in GOLDEN["cases"]}
    for t in ("not strong", "very strong", "financial stability"):
        for p in ("general", "finance"):
            assert (t, p) in have, (t, p)


def test_score_financial_uses_the_engine():
    """examples/score_financial.py: same sentence scores as the engine, reader-compatible schema, finance reference"""
    import score_financial
    text = "# Overview\n\nFinancial stability is strong. Losses were not severe!\n\n## Outlook\n\nThe goods trade is bridging the gap; however, risks remain.\n"
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(text)
    try:
        doc = score_financial.build(f.name, "t")
    finally:
        os.unlink(f.name)
    assert list(doc) == ["version", "title", "scale", "reference", "paragraphs"]
    assert doc["scale"] == {"word": 2.5} and doc["reference"]["name"] == "LM × VADER finance vocabulary"
    assert len(doc["reference"]["scores"]) == 3381
    assert [p["type"] for p in doc["paragraphs"]] == ["h", "p", "h", "p"] and doc["paragraphs"][2]["level"] == 2
    sents = [s for p in doc["paragraphs"] for s in p["sentences"]]
    direct = sm_engine.score_sentences([s["text"] for s in sents], "finance")
    for s, d in zip(sents, direct):
        assert s["score"] == round(d["score"], 4), (s["text"], s["score"], d["score"])
        assert [w["text"] for w in s["words"]] == [w["text"] for w in d["words"]]
        for w in s["words"]:
            assert s["text"][w["start"]:w["end"]] == w["text"]
    words = [w["text"] for s in sents for w in s["words"]]
    assert "stability" not in [w.lower() for w in words] and "goods" not in words and "bridging" not in words


def test_finance_vocabulary_matches_upstream():
    """data/sentiment-model.json's finance words + upstream hashes are what pysentiment2 / vaderSentiment give today"""
    try:
        import build_finance_vocab
        build_finance_vocab.upstream_paths()
    except ImportError:
        skip("pysentiment2 / vaderSentiment not installed: finance vocabulary rebuild not checked")
    bad = build_finance_vocab.stale_reasons()
    assert not bad, "; ".join(bad)


if __name__ == "__main__":
    PLAIN = True
    fails = 0
    for name, fn in sorted((n, f) for n, f in globals().items() if n.startswith("test_") and callable(f)):
        try:
            fn()
            print("ok  :", name)
        except Skip as e:
            print("SKIP:", name, "-", e)
        except Exception as e:  # noqa: BLE001 - report every failure, then exit non-zero
            fails += 1
            print("FAIL:", name, "-", repr(e))
    print(f"\n{fails} FAILED" if fails else "\nALL OK")
    sys.exit(1 if fails else 0)
