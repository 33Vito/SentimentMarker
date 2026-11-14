#!/usr/bin/env python3
"""Sentiment Diff + Timeline: compare N editions of one publication that were scored with the same model.

    python tools/sm_diff.py --edition 2026-03=examples/fsr-2026-03.scored.json \
                            --edition 2026-10=examples/fsr-2026-10.scored.json \
                            --topics examples/fsr-topics.json -o examples/fsr-timeline.diff.json [--js out.diff.js]

Input: SentimentMarker scored JSON files (docs/FORMAT.md), all scored by the SAME model and profile
(a timeline across two rulers means nothing; the tool refuses files whose `model` differs).
Edition ids of the form YYYY-MM are sorted oldest first, so a reversed command line cannot swap added and removed.
Other ids require --assume-ordered to confirm they are supplied oldest first.
Any other id keeps the order it was given. Duplicate ids are refused.
Output: one `sentiment-diff` JSON (docs/DIFF_FORMAT.md) that SentimentDiff.html shows.

What it does, per adjacent pair of editions (A = older, B = newer):
  1. Sentence alignment over the whole document (text moves between sections):
       unchanged  normalised text identical (matched in order, duplicates paired one to one)
       edited     word-token similarity >= --min-sim, paired greedily, best first (same section breaks ties)
       removed    in A only;  added  in B only
  2. Exact decomposition of the change in a group's mean sentence score (a group = all text, a topic, the
     Assessment narrative, or a section):
       mean_B - mean_A = edit + added + removed
         edit    = sum over edited pairs (b - a) / n_B
         added   = sum over added sentences (b - mean_A) / n_B
         removed = -sum over removed sentences (a - mean_A) / n_B
     Unchanged sentences contribute exactly 0. A sentence that enters or leaves a group through an edit
     (for instance the topic word was added) counts as added / removed for that group.
     Each term is the sum of per-sentence contributions, which are written out as the evidence list.
     A group with sentences on only one side has no second mean: delta is null and the sentences are still listed.

Standard library only. The decomposition is checked against the direct difference for every group (|err| < 1e-9).
"""
import argparse, difflib, json, math, os, re, sys, unicodedata
from collections import defaultdict, deque

FORMAT = "sentiment-diff"
VERSION = 1
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Headings that are furniture, not sections. Content under an EXCLUDE heading is dropped until the next heading
# of the same or a higher level (Endnotes are references, Contents is a list of titles).
EXCLUDE = re.compile(r"^(end ?notes|contents|references|copyright|bibliography|abbreviations)\b", re.I)
# Back matter that runs over several pages: a running title or date heading on its next page does not end it.
# (Contents does end there: the page after it is the overview, which opens with the running title.)
RUNS_ON = re.compile(r"^(end ?notes|references|bibliography)\b", re.I)
JUNK = re.compile(r"^((january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}"
                  r"|financial stability( review.*)?|review|(chapter\s+\d+\s*)?(focus topics?)?)$", re.I)
# Chart furniture that leaks into the prose of a PDF (source lines, observation notes, graph captions). Not text the
# author argues with, and it dilutes every mean towards 0, so it is left out of every group.
FURNITURE = re.compile(r"^(sources?|notes?|(latest|earliest) observations?|(graph|table|figure|chart)\s+[\dA-Z]+(\.\d+)*\b)", re.I)
STOP = set("""a an the and or but of to in on for with by at from as is are was were be been being this that these those
it its into over under than then there their they them which who whom whose what when where while also has have had
not no nor so such can could may might will would should more most less least very much many some any each other""".split())
WORD = re.compile(r"[A-Za-z][A-Za-z'’\-]*|\d+(?:[.,]\d+)*%?|[一-鿿]")


# ---------- reading ----------
def center_of(doc, level):
    c = doc.get("center", 0)
    if isinstance(c, dict):
        c = c.get(level, 0)
    return c if isinstance(c, (int, float)) else 0


def norm_text(s):
    s = unicodedata.normalize("NFKC", s).lower()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    s = re.sub(r"^[•·●\-\s]+", "", s)
    return re.sub(r"\s+", " ", s).strip()


def section_key(title):
    t = norm_text(title)
    t = re.sub(r"^chapter\s+\d+\s+", "", t)             # "Chapter 1 The Global ..." (2024 layout: one heading)
    t = re.sub(r"^(\d+(\.\d+)*)\s+", "", t)              # "1.2 key vulnerabilities" -> "key vulnerabilities"
    t = re.sub(r"^focus topic:\s*", "", t)
    return t


def same_section(a, b):
    return difflib.SequenceMatcher(None, tokens(a), tokens(b), autojunk=False).ratio()


def label_for(eid):
    m = re.match(r"^(\d{4})-(\d{2})$", eid)
    return f"{MONTHS[int(m.group(2)) - 1]} {m.group(1)}" if m else eid


def flatten(doc):
    """Sentences in document order with their section. Headings of level 2 that are full sentences (RBA key messages)
    are content; level-1 headings name sections. Returns (sentences, sections)."""
    paras = doc.get("paragraphs", [])
    c = center_of(doc, "sentence")
    heads = [(i, p) for i, p in enumerate(paras) if p.get("type") == "h"]

    def head_text(p):
        return " ".join((s if isinstance(s, str) else s.get("text", "")) for s in p.get("sentences", []) or []) or p.get("text", "")

    def level(p):
        lv = p.get("level", 1)
        return 2 if isinstance(lv, (int, float)) and lv >= 2 else 1

    # A level-1 "Summary" sits before its "Chapter N" heading: name it after the chapter that follows.
    titles = {}
    for k, (i, p) in enumerate(heads):
        t = head_text(p).strip()
        if level(p) != 1 or JUNK.match(norm_text(t)) or EXCLUDE.match(norm_text(t)):
            continue
        if norm_text(t) == "summary":
            nxt = next((head_text(q).strip() for _, q in heads[k + 1:]
                        if level(q) == 1 and not JUNK.match(norm_text(head_text(q))) and norm_text(head_text(q)) != "summary"
                        and not EXCLUDE.match(norm_text(head_text(q)))), "")
            t = f"Summary · {nxt}" if nxt else t
        titles[i] = t

    sections, sec_index = [], {}
    out, cur_sec, skip_level, skip_runs = [], None, None, False
    for i, p in enumerate(paras):
        if p.get("type") == "h":
            t, lv = head_text(p).strip(), level(p)
            # a junk level-1 heading (running title, date) inside Endnotes is page furniture, not the end of them
            junk = lv == 1 and i not in titles and not EXCLUDE.match(norm_text(t))
            if skip_level is not None and lv <= skip_level and not (junk and skip_runs):
                skip_level = None
            if EXCLUDE.match(norm_text(t)):
                skip_level, skip_runs = lv, bool(RUNS_ON.match(norm_text(t)))
                continue
            if i in titles:
                key = section_key(titles[i])
                if key not in sec_index:
                    sec_index[key] = len(sections)
                    sections.append({"key": key, "title": titles[i]})
                cur_sec = sec_index[key]
                continue
            if lv == 1:
                continue                                   # junk level-1 heading (date, "Chapter 2", running title)
        if skip_level is not None:
            continue
        for s in p.get("sentences", []) or []:
            if isinstance(s, str):
                s = {"text": s}
            text = s.get("text", "")
            if not text.strip() or not isinstance(s.get("score"), (int, float)) or FURNITURE.match(text.strip()):
                continue
            words = [pack_word(w, center_of(doc, "word"))
                     for w in s.get("words", []) if isinstance(w.get("start"), int) and isinstance(w.get("score"), (int, float))]
            out.append({"t": text, "s": round(s["score"] - c, 4), "sec": cur_sec, "w": words, "h": p.get("type") == "h"})
    return out, sections


# ---------- topics ----------
def compile_pattern(p):
    """Whole-word, case-insensitive. The group keeps both boundaries on every branch of a top-level `a|b`.

    Hyphen is part of the boundary, so `banks?` does not match inside `non-bank` / `non-banks`.
    A plain `\\b` would, because `-` is not a word character.
    """
    return re.compile(r"(?<![\w-])(?:" + p + r")(?![\w-])", re.I)


def load_topics(path):
    with open(path, encoding="utf-8") as f:
        spec = json.load(f)
    topics = []
    for t in spec["topics"]:
        pats = [compile_pattern(p) for p in t["patterns"]]
        topics.append({"id": t["id"], "label": t["label"], "patterns": t["patterns"], "_re": pats})
    return topics


def tag_topics(sents, topics):
    for s in sents:
        s["tp"] = [k for k, t in enumerate(topics) if any(r.search(s["t"]) for r in t["_re"])]


# ---------- alignment ----------
def tokens(text):
    return [m.group(0).lower().replace("’", "'") for m in WORD.finditer(text)]


def align(A, B, min_sim):
    """Returns pairs [(i, j, kind, sim)], removed [i], added [j]."""
    nA = [norm_text(s["t"]) for s in A]
    nB = [norm_text(s["t"]) for s in B]
    by_text = defaultdict(deque)
    for j, t in enumerate(nB):
        by_text[t].append(j)
    pairs, usedA, usedB = [], set(), set()
    for i, t in enumerate(nA):                        # unchanged: identical text, paired in order
        lst = by_text.get(t)
        if lst:
            j = lst.popleft()
            pairs.append((i, j, "u", 1.0)); usedA.add(i); usedB.add(j)

    tokA = {i: tokens(A[i]["t"]) for i in range(len(A)) if i not in usedA}
    tokB = {j: tokens(B[j]["t"]) for j in range(len(B)) if j not in usedB}
    df = defaultdict(int)
    for tk in list(tokA.values()) + list(tokB.values()):
        for w in set(tk):
            df[w] += 1
    inv = defaultdict(set)
    for j, tk in tokB.items():
        for w in set(tk):
            if w not in STOP and len(w) > 2:
                inv[w].add(j)
    cands = []
    for i, tk in tokA.items():
        score = defaultdict(float)
        for w in set(tk):
            if w in STOP or len(w) <= 2:
                continue
            for j in inv.get(w, ()):
                score[j] += 1.0 / df[w]
        for j, _ in sorted(score.items(), key=lambda kv: -kv[1])[:25]:
            sm = difflib.SequenceMatcher(None, tk, tokB[j], autojunk=False)
            if sm.real_quick_ratio() < min_sim or sm.quick_ratio() < min_sim:
                continue
            r = sm.ratio()
            if r >= min_sim:
                bonus = 0.02 if A[i]["sec"] is not None and A[i].get("seckey") == B[j].get("seckey") else 0.0
                cands.append((r + bonus, r, i, j))
    cands.sort(key=lambda c: (-c[0], c[2], c[3]))
    for _, r, i, j in cands:                          # edited: greedy, best similarity first
        if i in usedA or j in usedB:
            continue
        pairs.append((i, j, "e", round(r, 3))); usedA.add(i); usedB.add(j)
    pairs.sort(key=lambda p: (p[1], p[0]))
    removed = [i for i in range(len(A)) if i not in usedA]
    added = [j for j in range(len(B)) if j not in usedB]
    return pairs, removed, added


def word_ops(a, b):
    """Changed spans for an edited pair, as code-point [start, end] lists in each text: (deleted in a, inserted in b)."""
    ma = [(m.start(), m.end()) for m in WORD.finditer(a)]
    mb = [(m.start(), m.end()) for m in WORD.finditer(b)]
    ta = [a[s:e].lower() for s, e in ma]
    tb = [b[s:e].lower() for s, e in mb]
    dels, ins = [], []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ta, tb, autojunk=False).get_opcodes():
        if op in ("delete", "replace") and i2 > i1:
            dels.append([ma[i1][0], ma[i2 - 1][1]])
        if op in ("insert", "replace") and j2 > j1:
            ins.append([mb[j1][0], mb[j2 - 1][1]])
    return dels, ins


# ---------- statistics ----------
def pack_word(w, c_word):
    """[start, end, effective] plus optional base and rule note.

    Effective is the file score after subtracting the word centre. Base is the lexicon
    weight before negation, boosters and caps, and is not centre-shifted. A rule note
    is present only when the engine recorded one. Score 0 is not a positive weight.
    """
    item = [w["start"], w["end"], round(w["score"] - c_word, 4)]
    has_base = isinstance(w.get("base"), (int, float))
    note = w.get("note") if isinstance(w.get("note"), str) and w.get("note") else ""
    if has_base or note:
        item.append(round(w["base"], 4) if has_base else None)
        if note:
            item.append(note)
    return item


def stats(scores, neutral):
    n = len(scores)
    if not n:
        return {"n": 0, "mean": None, "se": None, "neg": 0, "pos": 0}
    m = sum(scores) / n
    # n == 1 has no sample spread. A zero standard error would draw a fake certainty band.
    if n < 2:
        sd = None
    else:
        sd = math.sqrt(sum((x - m) ** 2 for x in scores) / (n - 1))
    return {"n": n, "mean": round(m, 4), "se": None if sd is None else round(sd / math.sqrt(n), 4),
            "neg": sum(1 for x in scores if x < -neutral), "pos": sum(1 for x in scores if x > neutral)}


def _one_sided(A, B, inA, inB, pairs, removed, added):
    """A group that exists on only one side has no mean to subtract. Still list the sentences."""
    ia = [i for i in range(len(A)) if inA(i)]
    jb = [j for j in range(len(B)) if inB(j)]
    if ia and jb:
        return None
    if not ia and not jb:
        return None
    counts = {"u": 0, "e": 0, "a": 0, "r": 0}
    items, seen = [], set()
    if jb and not ia:
        for i, j, _kind, _sim in pairs:
            if inB(j):
                counts["a"] += 1
                items.append(["a", i, j, None])
                seen.add(j)
        for j in added:
            if inB(j) and j not in seen:
                counts["a"] += 1
                items.append(["a", None, j, None])
        side = "added"
    else:
        for i, j, _kind, _sim in pairs:
            if inA(i):
                counts["r"] += 1
                items.append(["r", i, j, None])
                seen.add(i)
        for i in removed:
            if inA(i) and i not in seen:
                counts["r"] += 1
                items.append(["r", i, None, None])
        side = "removed"
    return {"delta": None, "edit": None, "added": None, "removed": None,
            "counts": counts, "items": items, "oneSided": side}


def decompose(A, B, inA, inB, pairs, removed, added):
    """inA(i) / inB(j): membership of a sentence in the group. Returns the decomposition and per-sentence items."""
    ia = [i for i in range(len(A)) if inA(i)]
    jb = [j for j in range(len(B)) if inB(j)]
    if not ia or not jb:
        return _one_sided(A, B, inA, inB, pairs, removed, added)
    mA = sum(A[i]["s"] for i in ia) / len(ia)
    mB = sum(B[j]["s"] for j in jb) / len(jb)
    nB = len(jb)
    items, edit, add, rem = [], 0.0, 0.0, 0.0
    counts = {"u": 0, "e": 0, "a": 0, "r": 0}
    for i, j, kind, sim in pairs:
        a_in, b_in = inA(i), inB(j)
        if a_in and b_in:
            if kind == "u" and B[j]["s"] == A[i]["s"]:
                counts["u"] += 1
                continue
            # an "unchanged" pair whose score differs (text equal only after normalisation, e.g. case, which the
            # engine scores) is reported as unchangedScoreMismatch; its change is counted as an edit so the sum holds
            c = (B[j]["s"] - A[i]["s"]) / nB
            edit += c; counts["e"] += 1
            items.append(["e", i, j, round(c, 5)])
        elif b_in:                                      # entered the group through an edit
            c = (B[j]["s"] - mA) / nB
            add += c; counts["a"] += 1
            items.append(["a", i, j, round(c, 5)])
        elif a_in:                                      # left the group through an edit
            c = -(A[i]["s"] - mA) / nB
            rem += c; counts["r"] += 1
            items.append(["r", i, j, round(c, 5)])
    for j in added:
        if inB(j):
            c = (B[j]["s"] - mA) / nB
            add += c; counts["a"] += 1
            items.append(["a", None, j, round(c, 5)])
    for i in removed:
        if inA(i):
            c = -(A[i]["s"] - mA) / nB
            rem += c; counts["r"] += 1
            items.append(["r", i, None, round(c, 5)])
    delta = mB - mA
    err = abs(delta - (edit + add + rem))
    if err > 1e-9:
        raise AssertionError(f"decomposition does not add up (err {err})")
    items.sort(key=lambda it: -abs(it[3]))
    return {"delta": round(delta, 5), "edit": round(edit, 5), "added": round(add, 5), "removed": round(rem, 5),
            "counts": counts, "items": items}


def pct(values, q):
    v = sorted(values)
    if not v:
        return 0
    k = (len(v) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def nice(x):
    if x <= 0:
        return 1
    p = 10 ** math.floor(math.log10(x))
    for n in (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if n * p >= x - 1e-12:
            return round(n * p, 6)
    return round(10 * p, 6)


# ---------- main ----------
ASSESS_KEY = "financial stability assessment"
MIN_HITS = 5


def sort_editions(editions, assume_ordered=False):
    """YYYY-MM ids are ordered chronologically so a reversed CLI cannot swap added and removed.

    Other ids require an explicit oldest-to-newest order confirmation.
    """
    ids = [eid for eid, _doc in editions]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate edition ids: " + ", ".join(ids))
    dates = [bool(re.fullmatch(r"[0-9]{4}-[0-9]{2}", eid)) for eid in ids]
    for eid, is_date in zip(ids, dates):
        if is_date and (int(eid[:4]) == 0 or not 1 <= int(eid[5:]) <= 12):
            raise SystemExit(f"invalid YYYY-MM edition id: {eid}")
    if any(dates) and not all(dates):
        raise SystemExit("cannot mix YYYY-MM and other edition ids; use a consistent format")
    if all(dates):
        ordered = sorted(editions, key=lambda pair: pair[0])
        return ordered, [eid for eid, _doc in editions] != [eid for eid, _doc in ordered]
    if not assume_ordered:
        raise SystemExit("non-YYYY-MM edition ids: confirm oldest-to-newest order with --assume-ordered (or assume_ordered=True)")
    return list(editions), False


def build(editions, topics, min_sim=0.55, title=None, neutral=0.2, sources=None, min_hits=MIN_HITS, assume_ordered=False):
    editions, _reordered = sort_editions(editions, assume_ordered)
    sources = sources or {}
    models = {json.dumps(d.get("model"), sort_keys=True) for _, d in editions}
    if len(models) > 1:
        raise SystemExit("editions were scored by different models / profiles: " + ", ".join(sorted(models)))
    eds, sec_keys = [], []
    for eid, doc in editions:
        sents, sections = flatten(doc)
        own = {sec["key"] for sec in sections}
        claimed = set()
        for sec in sections:                            # renamed slightly between editions -> one row
            if sec["key"] not in sec_keys:
                # never onto a key another section of this edition has, or one an earlier rename here took
                free = [k for k in sec_keys if k not in own and k not in claimed]
                near = max(free, key=lambda k: same_section(k, sec["key"]), default=None)
                if near and same_section(near, sec["key"]) >= 0.86:
                    sec["key"] = near
            claimed.add(sec["key"])
        for s in sents:
            s["seckey"] = sections[s["sec"]]["key"] if s["sec"] is not None else None
        tag_topics(sents, topics)
        eds.append({"id": eid, "doc": doc, "sents": sents, "sections": sections})
        for sec in sections:
            if sec["key"] not in sec_keys:
                sec_keys.append(sec["key"])
    sec_pos = {k: n for n, k in enumerate(sec_keys)}
    sec_titles = {}
    for e in eds:                                       # the newest title wins for display
        for sec in e["sections"]:
            sec_titles[sec["key"]] = sec["title"]

    groups = [{"id": "all", "label": "All text", "kind": "all"}]
    groups += [{"id": "t:" + t["id"], "label": t["label"], "kind": "topic", "patterns": t["patterns"]} for t in topics]
    groups += [{"id": "s:" + k, "label": sec_titles[k], "kind": "section"} for k in sec_keys]
    # Same section across editions: the Assessment narrative, then each topic inside it.
    groups += [{"id": "as:all", "label": "Assessment narrative", "kind": "assessment"}]
    groups += [{"id": "as:" + t["id"], "label": t["label"], "kind": "assessment", "patterns": t["patterns"]} for t in topics]

    def member(e, g):
        ss = e["sents"]
        if g["kind"] == "all":
            return lambda i: True
        if g["kind"] == "topic":
            k = next(n for n, t in enumerate(topics) if "t:" + t["id"] == g["id"])
            return lambda i: k in ss[i]["tp"]
        if g["kind"] == "assessment":
            def in_assess(i):
                return ss[i].get("seckey") == ASSESS_KEY
            if g["id"] == "as:all":
                return in_assess
            k = next(n for n, t in enumerate(topics) if "as:" + t["id"] == g["id"])
            return lambda i, k=k: in_assess(i) and k in ss[i]["tp"]
        key = g["id"][2:]
        return lambda i: ss[i]["seckey"] == key

    out_eds = []
    for e in eds:
        st = {}
        for g in groups:
            f = member(e, g)
            st[g["id"]] = stats([s["s"] for n, s in enumerate(e["sents"]) if f(n)], neutral)
        src = sources.get(e["id"]) or {}
        prov = {}
        for key in ("source", "pages", "assessmentPages", "scope", "quality"):
            if src.get(key) not in (None, ""):
                prov[key] = src[key]
        out_eds.append({
            "id": e["id"], "label": label_for(e["id"]), "title": e["doc"].get("title", e["id"]),
            **prov,
            "sections": [s["key"] for s in e["sections"]],
            "stats": st,
            "sentences": [{"t": s["t"], "s": s["s"], "sec": sec_pos[s["seckey"]] if s["seckey"] else None,
                           "tp": s["tp"], "w": s["w"], **({"h": 1} if s["h"] else {})} for s in e["sents"]],
        })

    diffs = []
    for k in range(1, len(eds)):
        A, B = eds[k - 1]["sents"], eds[k]["sents"]
        pairs, removed, added = align(A, B, min_sim)
        ops = {}
        for i, j, kind, _ in pairs:
            if kind == "e":
                ops[f"{i}:{j}"] = word_ops(A[i]["t"], B[j]["t"])
        bad = [(i, j) for i, j, kind, _ in pairs if kind == "u" and A[i]["s"] != B[j]["s"]]
        groups_out = {}
        for g in groups:
            d = decompose(A, B, member(eds[k - 1], g), member(eds[k], g), pairs, removed, added)
            if d:
                groups_out[g["id"]] = d
        diffs.append({"from": k - 1, "to": k,
                      "pairs": [[i, j, kind, sim] for i, j, kind, sim in pairs], "removed": removed, "added": added,
                      "ops": ops, "unchangedScoreMismatch": len(bad), "groups": groups_out})

    all_s = [abs(s["s"]) for e in eds for s in e["sents"] if s["s"]]
    means = [abs(st["mean"]) for e in out_eds for st in e["stats"].values() if st["mean"] is not None and st["n"] >= 5]
    deltas = [abs(g["delta"]) for d in diffs for g in d["groups"].values() if isinstance(g.get("delta"), (int, float))]
    words = [abs(w[2]) for e in eds for s in e["sents"] for w in s["w"]]
    model = eds[0]["doc"].get("model")
    ref = eds[-1]["doc"].get("scale", {})
    return {
        "format": FORMAT, "version": VERSION,
        "title": title or eds[-1]["doc"].get("title", ""),
        "model": model,
        "params": {"minSim": min_sim, "neutral": neutral, "minHits": min_hits},
        "scale": {"word": ref.get("word") if isinstance(ref, dict) and ref.get("word") else nice(pct(words, 0.9)),
                  "sentence": nice(pct(all_s, 0.9)), "mean": nice(pct(means, 0.95)), "delta": nice(pct(deltas, 0.9))},
        "topics": [{"id": t["id"], "label": t["label"], "patterns": t["patterns"]} for t in topics],
        "groups": groups,
        "sectionKeys": sec_keys,
        "editions": out_eds,
        "diffs": diffs,
    }


def write(obj, path, js=None, note=None):
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with open(path, "w", encoding="utf-8", newline="\n") as f:     # LF on every platform
        f.write(text)
    if js:
        with open(js, "w", encoding="utf-8", newline="\n") as f:
            f.write("/* Generated by tools/sm_diff.py. Do not edit by hand." + (("\n   " + note.replace("*/", "* /")) if note else "") + " */\n"
                    "window.DIFF_FILES = window.DIFF_FILES || {};\n"
                    f"window.DIFF_FILES[{json.dumps(os.path.basename(path))}] = {text};\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--edition", action="append", required=True, help="ID=PATH (YYYY-MM ids are sorted oldest first; other ids require --assume-ordered)")
    ap.add_argument("--assume-ordered", action="store_true", help="confirm non-date IDs are supplied oldest first")
    ap.add_argument("--topics", required=True)
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--js", help="also write a classic script for file:// pages")
    ap.add_argument("--title")
    ap.add_argument("--note", help="attribution / provenance line for the head of the --js script")
    ap.add_argument("--sources", help="JSON object keyed by edition id: source, pages, assessmentPages, scope, quality")
    ap.add_argument("--min-sim", type=float, default=0.55)
    ap.add_argument("--min-hits", type=int, default=MIN_HITS, help="page withholds means and deltas below this many sentences")
    a = ap.parse_args()
    if len(a.edition) < 2:
        sys.exit("need at least two editions")
    editions = []
    for spec in a.edition:
        eid, path = spec.split("=", 1)
        with open(path, encoding="utf-8") as f:
            editions.append((eid, json.load(f)))
    _ordered, reordered = sort_editions(editions, a.assume_ordered)
    if reordered:
        print("edition ids were not chronological; sorted by YYYY-MM so added/removed stay in time order", file=sys.stderr)
    src = None
    if a.sources:
        with open(a.sources, encoding="utf-8") as f:
            src = json.load(f)
    res = build(editions, load_topics(a.topics), a.min_sim, a.title, sources=src, min_hits=a.min_hits, assume_ordered=a.assume_ordered)
    write(res, a.out, a.js, a.note)
    for d in res["diffs"]:
        c = defaultdict(int)
        for p in d["pairs"]:
            c[p[2]] += 1
        A, B = res["editions"][d["from"]], res["editions"][d["to"]]
        delta = d["groups"]["all"]["delta"]
        delta_s = "n/a" if delta is None else f"{delta:+.4f}"
        print(f"{A['id']} -> {B['id']}: unchanged {c['u']}, edited {c['e']}, removed {len(d['removed'])}, "
              f"added {len(d['added'])}; all-text delta {delta_s}"
              + (f"  WARNING {d['unchangedScoreMismatch']} unchanged sentences changed score" if d["unchangedScoreMismatch"] else ""))
    print(f"wrote {a.out} ({os.path.getsize(a.out)} bytes)")
