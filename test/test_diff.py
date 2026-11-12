#!/usr/bin/env python3
"""Tests for tools/sm_diff.py (standard library only; also runs under pytest).

    python3 test/test_diff.py
"""
import json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.dont_write_bytecode = True
import sm_diff as M  # noqa: E402


def doc(paras, model=None):
    d = {"version": 1, "title": "t", "paragraphs": paras}
    if model:
        d["model"] = model
    return d


def h(text, level=1):
    return {"type": "h", "level": level, "sentences": [{"text": text, "score": 0}]}


def p(*sents):
    return {"type": "p", "sentences": [{"text": t, "score": s, "words": []} for t, s in sents]}


TOPICS = [{"id": "banks", "label": "Banks", "patterns": ["banks?"], "_re": None},
          {"id": "homes", "label": "Households", "patterns": ["households?"], "_re": None}]


def topics():
    import re
    out = []
    for t in TOPICS:
        out.append(dict(t, _re=[re.compile(r"(?<![A-Za-z])" + x + r"(?![A-Za-z])", re.I) for x in t["patterns"]]))
    return out


OLD = doc([
    h("Financial Stability Review March 2024"),
    h("1.1 Banks"),
    p(("Banks remain well capitalised and profitable.", 0.5),
      ("Households are under pressure from high interest rates and rising costs.", -0.4),
      ("Sources: ABS; APRA; RBA.", 0.0),
      ("Bank funding conditions were stable over the period under review.", 0.2)),
    h("Endnotes", 2),
    p(("[1] See RBA (2023).", 0.0)),
    h("Chapter 2 Households"),
    p(("Arrears on household loans remain low.", 0.3)),
])
NEW = doc([
    h("1.1 Banks"),
    p(("Banks remain well capitalised and profitable.", 0.5),                                   # unchanged
      ("Households are under severe pressure from high interest rates and rising costs.", -0.7),  # edited
      ("Bank losses on business loans have increased.", -0.6)),                                   # added
    h("Chapter 2"), h("Households"),
    p(("Arrears on household loans remain low.", 0.3),                                         # unchanged, moved section
      ("Some households and banks report rising stress.", -0.5)),                              # added, two topics
])


def build():
    return M.build([("2024-03", OLD), ("2024-09", NEW)], topics(), min_sim=0.55)


def test_flatten_skips_furniture_endnotes_and_junk_headings():
    sents, sections = M.flatten(OLD)
    texts = [s["t"] for s in sents]
    assert "Sources: ABS; APRA; RBA." not in texts
    assert "[1] See RBA (2023)." not in texts
    assert [s["key"] for s in sections] == ["banks", "households"]       # "Chapter 2 Households" -> households


def test_split_chapter_heading_matches_one_line_layout():
    _, sections = M.flatten(NEW)
    assert [s["key"] for s in sections] == ["banks", "households"]


def test_alignment_kinds():
    r = build()
    d = r["diffs"][0]
    kinds = sorted(k for _, _, k, _ in d["pairs"])
    assert kinds == ["e", "u", "u"], kinds
    assert len(d["added"]) == 2 and len(d["removed"]) == 1
    assert d["unchangedScoreMismatch"] == 0
    (i, j), = [(a, b) for a, b, k, _ in d["pairs"] if k == "e"]
    dels, ins = d["ops"][f"{i}:{j}"]
    B = r["editions"][1]["sentences"][j]["t"]
    assert [B[a:b] for a, b in ins] == ["severe"]
    assert dels == []


def test_decomposition_is_exact_and_matches_direct_difference():
    r = build()
    for gid, g in r["diffs"][0]["groups"].items():
        a = r["editions"][0]["stats"][gid]["mean"]
        b = r["editions"][1]["stats"][gid]["mean"]
        assert abs((b - a) - g["delta"]) < 1e-3, gid
        assert abs(g["delta"] - (g["edit"] + g["added"] + g["removed"])) < 1e-4, gid
        assert abs(sum(it[3] for it in g["items"]) - g["delta"]) < 1e-3, gid
        assert all(it[0] != "u" for it in g["items"])


def test_all_text_numbers():
    g = build()["diffs"][0]["groups"]["all"]
    # old: 0.5, -0.4, 0.2, 0.3 -> mean 0.15 ; new: 0.5, -0.7, -0.6, 0.3, -0.5 -> mean -0.2
    assert abs(g["delta"] - (-0.35)) < 1e-9
    assert abs(g["edit"] - (-0.3 / 5)) < 1e-9
    assert abs(g["added"] - ((-0.6 - 0.15) + (-0.5 - 0.15)) / 5) < 1e-9
    assert abs(g["removed"] - (-(0.2 - 0.15) / 5)) < 1e-9
    assert g["counts"] == {"u": 2, "e": 1, "a": 2, "r": 1}


def test_topic_membership_change_through_edit():
    old = doc([p(("Lending standards are sound.", 0.4))])
    new = doc([p(("Lending standards at banks are sound.", 0.4))])
    r = M.build([("a", old), ("b", new)], topics())
    assert "t:banks" not in r["diffs"][0]["groups"]               # no banks sentences in the old edition
    assert r["diffs"][0]["groups"]["all"]["counts"]["e"] == 1


def test_refuses_mixed_models():
    a = doc([p(("x y z.", 0.1))], {"version": "1.0.0", "profile": "finance"})
    b = doc([p(("x y z.", 0.1))], {"version": "1.0.0", "profile": "general"})
    try:
        M.build([("a", a), ("b", b)], topics())
    except SystemExit:
        return
    raise AssertionError("mixed models must be refused")


def test_output_is_json_serialisable():
    json.dumps(build())


def test_unchanged_text_with_a_different_score_is_reported_not_fatal():
    # equal after normalisation (case), but the engine scores capitals, so the score differs
    old = doc([p(("Risks remain elevated.", -0.4), ("Banks are sound.", 0.3))])
    new = doc([p(("RISKS REMAIN ELEVATED.", -0.6), ("Banks are sound.", 0.3))])
    d = M.build([("a", old), ("b", new)], topics())["diffs"][0]
    assert d["unchangedScoreMismatch"] == 1
    g = d["groups"]["all"]
    assert abs(g["delta"] - (-0.1)) < 1e-9
    assert abs(g["edit"] - (-0.1)) < 1e-9
    assert g["counts"] == {"u": 1, "e": 1, "a": 0, "r": 0}


def test_running_title_inside_endnotes_does_not_end_them():
    d = doc([
        h("1.1 Banks"),
        p(("Banks remain well capitalised and profitable.", 0.5)),
        h("Endnotes"),
        p(("[1] See RBA (2023).", 0.0)),
        h("Financial Stability Review"), h("October 2026"),       # page furniture on the next page
        p(("[2] See APRA (2024).", 0.0)),
        h("2.1 Households"),
        p(("Arrears on household loans remain low.", 0.3)),
    ])
    sents, sections = M.flatten(d)
    assert [s["t"] for s in sents] == ["Banks remain well capitalised and profitable.", "Arrears on household loans remain low."]
    assert [s["key"] for s in sections] == ["banks", "households"]


def test_running_title_after_contents_ends_it():
    # Contents is one page; the overview after it opens with the running title and is content
    d = doc([h("Contents"), p(("1.1 Banks 4", 0.0)), h("Financial Stability Review"),
             h("Banks remain resilient overall.", 2), p(("Risks to banks are contained.", 0.2))])
    texts = [s["t"] for s in M.flatten(d)[0]]
    assert texts == ["Banks remain resilient overall.", "Risks to banks are contained."], texts


def test_topic_alternation_keeps_word_boundaries():
    r = M.compile_pattern("bank|ADI")
    assert r.search("The bank said") and r.search("ADI lending")
    assert not r.search("bankruptcy rose") and not r.search("RADIO hosts")


def test_two_sections_of_one_edition_never_merge_into_one_row():
    old = doc([h("1.1 Risks to household and business finances in Australia"), p(("Arrears are low.", 0.2))])
    new = doc([h("1.1 Risks to household and business finance in Australia"), p(("Arrears are low.", 0.2)),
               h("1.2 Risks to household and business finances in Australia now"), p(("Insolvencies rose.", -0.5))])
    r = M.build([("a", old), ("b", new)], topics())
    keys = r["editions"][1]["sections"]
    assert len(keys) == 2 and len(set(keys)) == 2, keys
    assert keys[0] == r["editions"][0]["sections"][0]               # the first rename still joins the old row


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); n += 1; print("ok  :", name)
    print(f"\n{n} passed")
