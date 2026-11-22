#!/usr/bin/env node
'use strict';
/**
 * Sentiment Diff + Timeline: compare N editions of one publication that were scored with the same model.
 *
 *   node tools/sm-diff.js --edition 2026-03=examples/fsr-2026-03.scored.json \
 *                         --edition 2026-10=examples/fsr-2026-10.scored.json \
 *                         --topics examples/fsr-topics.json -o examples/fsr-timeline.diff.json [--js out.diff.js]
 *
 * Input: SentimentMarker scored JSON files (docs/FORMAT.md), all scored by the SAME model and profile
 * (a timeline across two rulers means nothing; the tool refuses files whose `model` differs).
 * Edition ids of the form YYYY-MM are sorted oldest first, so a reversed CLI cannot swap added and removed.
 * Other ids keep the order given, and require --assume-ordered to confirm that order is oldest first.
 * Invalid YYYY-MM dates, mixed date/non-date ids and duplicate ids are refused.
 * Output: one `sentiment-diff` JSON (docs/DIFF_FORMAT.md) that SentimentDiff.html shows.
 *
 * Node.js built-ins only. Uses exact BigInt rational arithmetic and checks decomposition identity (|err| < 1e-9).
 */
const fs = require('node:fs');
const path = require('node:path');

const FORMAT = 'sentiment-diff';
const VERSION = 1;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ASSESS_KEY = 'financial stability assessment';
const MIN_HITS = 5;

// Headings that are furniture, not sections. Content under an EXCLUDE heading is dropped until the next heading
// of the same or a higher level (Endnotes are references, Contents is a list of titles).
const EXCLUDE = /^(end ?notes|contents|references|copyright|bibliography|abbreviations)\b/i;
// Back matter that runs over several pages: a running title or date heading on its next page does not end it.
// (Contents does end there: the page after it is the overview, which opens with the running title.)
const RUNS_ON = /^(end ?notes|references|bibliography)\b/i;
const JUNK = /^((january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}|financial stability( review.*)?|review|(chapter\s+\d+\s*)?(focus topics?)?)$/i;
// Chart furniture that leaks into the prose of a PDF (source lines, observation notes, graph captions). Not text the
// author argues with, and it dilutes every mean towards 0, so it is left out of every group.
const FURNITURE = /^(sources?|notes?|(latest|earliest) observations?|(graph|table|figure|chart)\s+[\dA-Z]+(\.\d+)*\b)/i;
const STOP = new Set(
  ('a an the and or but of to in on for with by at from as is are was were be been being this that these those ' +
   'it its into over under than then there their they them which who whom whose what when where while also has have had ' +
   'not no nor so such can could may might will would should more most less least very much many some any each other').split(' ')
);
const WORD_SRC = "[A-Za-z][A-Za-z'’\\-]*|\\d+(?:[.,]\\d+)*%?|[一-鿿]";

function makeWordRegex() {
  return new RegExp(WORD_SRC, 'g');
}

// ---------- exact BigInt rationals & CPython half-even rounding ----------
function gcdBig(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1n;
}

function frac(n, d = 1n) {
  if (d === 0n) throw new RangeError('Division by zero');
  if (n === 0n) return { n: 0n, d: 1n };
  let num = n;
  let den = d;
  if (den < 0n) { num = -num; den = -den; }
  const g = gcdBig(num, den);
  return { n: num / g, d: den / g };
}

const fracAdd = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const fracSub = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const fracNeg = a => ({ n: -a.n, d: a.d });
const fracDivInt = (a, k) => frac(a.n, a.d * BigInt(k));
const fracAbs = a => ({ n: a.n < 0n ? -a.n : a.n, d: a.d });

const _f64Buf = new ArrayBuffer(8);
const _f64View = new DataView(_f64Buf);

function floatToFrac(x) {
  if (!Number.isFinite(x)) throw new RangeError(`Non-finite float: ${x}`);
  if (x === 0) return { n: 0n, d: 1n };
  _f64View.setFloat64(0, x, false);
  const bits = _f64View.getBigUint64(0, false);
  const sign = (bits >> 63n) !== 0n ? -1n : 1n;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & ((1n << 52n) - 1n);
  let mant;
  let exp;
  if (expBits === 0) {
    mant = fracBits;
    exp = -1074;
  } else {
    mant = (1n << 52n) | fracBits;
    exp = expBits - 1075;
  }
  mant *= sign;
  if (exp >= 0) return { n: mant << BigInt(exp), d: 1n };
  // d is 2^(-exp); strip trailing zero bits from mant to reduce immediately
  let shift = -exp;
  while (shift > 0 && (mant & 1n) === 0n) {
    mant >>= 1n;
    shift--;
  }
  return { n: mant, d: 1n << BigInt(shift) };
}

function roundFracInt(f, dp = 0) {
  const scale = dp >= 0 ? 10n ** BigInt(dp) : 1n;
  const num = dp >= 0 ? f.n * scale : f.n;
  const den = dp >= 0 ? f.d : f.d * (10n ** BigInt(-dp));
  const absNum = num < 0n ? -num : num;
  let q = absNum / den;
  const r = absNum % den;
  const twiceR = r * 2n;
  if (twiceR > den || (twiceR === den && (q & 1n) === 1n)) q += 1n;
  if (dp < 0) q *= 10n ** BigInt(-dp);
  return num < 0n ? -q : q;
}

function roundFrac(f, dp = 0) {
  const q = roundFracInt(f, dp);
  if (q === 0n) return 0;
  if (dp <= 0) {
    const v = Number(q);
    return v === 0 ? 0 : v;
  }
  const neg = q < 0n;
  const absStr = (neg ? -q : q).toString().padStart(dp + 1, '0');
  const v = Number((neg ? '-' : '') + absStr.slice(0, -dp) + '.' + absStr.slice(-dp));
  return v === 0 ? 0 : v;
}

function roundPy(x, dp = 0) {
  return roundFrac(floatToFrac(x), dp);
}

function fracToNumber(f) {
  if (f.n === 0n) return 0;
  const MAX_EXACT = 9007199254740991n;
  const absN = f.n < 0n ? -f.n : f.n;
  if (absN <= MAX_EXACT && f.d <= MAX_EXACT) return Number(f.n) / Number(f.d);
  return Number(f.n) / Number(f.d);
}

function scoreFraction(score) {
  // Sentence scores are packed at 1e-4; sum those integer units exactly.
  // Rational arithmetic keeps half-even rounding independent of float addition order.
  return frac(roundFracInt(floatToFrac(score * 10000), 0), 10000n);
}

// ---------- CPython difflib.SequenceMatcher (autojunk = false) ----------
class SequenceMatcher {
  constructor(a = [], b = []) {
    this.a = a;
    this.b = b;
    this.b2j = new Map();
    this.matchingBlocks = null;
    this.opcodes = null;
    this._chainB();
  }

  _chainB() {
    const b2j = new Map();
    const b = this.b;
    for (let i = 0; i < b.length; i++) {
      const elt = b[i];
      let arr = b2j.get(elt);
      if (!arr) {
        arr = [];
        b2j.set(elt, arr);
      }
      arr.push(i);
    }
    this.b2j = b2j;
  }

  findLongestMatch(alo = 0, ahi = this.a.length, blo = 0, bhi = this.b.length) {
    const a = this.a;
    const b = this.b;
    const b2j = this.b2j;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map();

    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      const js = b2j.get(a[i]);
      if (js) {
        for (let idx = 0; idx < js.length; idx++) {
          const j = js[idx];
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }

    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize++;
    }
    return [besti, bestj, bestsize];
  }

  getMatchingBlocks() {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;
    const queue = [[0, la, 0, lb]];
    const blocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const [i, j, k] = x;
      if (k) {
        blocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    blocks.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]));
    let i1 = 0, j1 = 0, k1 = 0;
    const nonAdjacent = [];
    for (let idx = 0; idx < blocks.length; idx++) {
      const [i2, j2, k2] = blocks[idx];
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push([i1, j1, k1]);
        i1 = i2; j1 = j2; k1 = k2;
      }
    }
    if (k1) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);
    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  getOpcodes() {
    if (this.opcodes) return this.opcodes;
    let i = 0;
    let j = 0;
    const answer = [];
    const mbs = this.getMatchingBlocks();
    for (let idx = 0; idx < mbs.length; idx++) {
      const [ai, bj, size] = mbs[idx];
      let tag = '';
      if (i < ai && j < bj) tag = 'replace';
      else if (i < ai) tag = 'delete';
      else if (j < bj) tag = 'insert';
      if (tag) answer.push([tag, i, ai, j, bj]);
      i = ai + size;
      j = bj + size;
      if (size) answer.push(['equal', ai, i, bj, j]);
    }
    this.opcodes = answer;
    return answer;
  }

  ratio() {
    const len = this.a.length + this.b.length;
    if (!len) return 1.0;
    let matches = 0;
    const mbs = this.getMatchingBlocks();
    for (let i = 0; i < mbs.length; i++) matches += mbs[i][2];
    return (2.0 * matches) / len;
  }

  quickRatio() {
    const len = this.a.length + this.b.length;
    if (!len) return 1.0;
    const avail = new Map();
    for (let i = 0; i < this.b.length; i++) {
      const elt = this.b[i];
      avail.set(elt, (avail.get(elt) || 0) + 1);
    }
    let matches = 0;
    for (let i = 0; i < this.a.length; i++) {
      const elt = this.a[i];
      const numb = avail.get(elt) || 0;
      if (numb > 0) {
        avail.set(elt, numb - 1);
        matches++;
      }
    }
    return (2.0 * matches) / len;
  }

  realQuickRatio() {
    const la = this.a.length;
    const lb = this.b.length;
    const len = la + lb;
    return len ? (2.0 * Math.min(la, lb)) / len : 1.0;
  }
}

// ---------- reading & normalisation ----------
function centerOf(doc, level) {
  let c = doc && doc.center !== undefined ? doc.center : 0;
  if (c && typeof c === 'object' && !Array.isArray(c)) c = c[level] ?? 0;
  return typeof c === 'number' && Number.isFinite(c) ? c : 0;
}

function normText(s) {
  let t = String(s).normalize('NFKC').toLowerCase();
  t = t.replace(/’/g, "'").replace(/‘/g, "'").replace(/“/g, '"').replace(/”/g, '"').replace(/–/g, '-').replace(/—/g, '-');
  t = t.replace(/^[•·●\-\s]+/, '');
  return t.replace(/\s+/g, ' ').trim();
}

function sectionKey(title) {
  let t = normText(title);
  t = t.replace(/^chapter\s+\d+\s+/, '');
  t = t.replace(/^(\d+(?:\.\d+)*)\s+/, '');
  t = t.replace(/^focus topic:\s*/, '');
  return t;
}

function tokens(text) {
  const out = [];
  const re = makeWordRegex();
  let m;
  while ((m = re.exec(text))) {
    out.push(m[0].toLowerCase().replace(/’/g, "'"));
  }
  return out;
}

function sameSection(a, b) {
  return new SequenceMatcher(tokens(a), tokens(b)).ratio();
}

function labelFor(eid) {
  const m = /^(\d{4})-(\d{2})$/.exec(eid);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : eid;
}

function packWord(w, cWord) {
  const item = [w.start, w.end, roundPy(w.score - cWord, 4)];
  const hasBase = typeof w.base === 'number' && Number.isFinite(w.base);
  const note = typeof w.note === 'string' && w.note ? w.note : '';
  if (hasBase || note) {
    item.push(hasBase ? roundPy(w.base, 4) : null);
    if (note) item.push(note);
  }
  return item;
}

function flatten(doc) {
  const paras = Array.isArray(doc && doc.paragraphs) ? doc.paragraphs : [];
  const c = centerOf(doc, 'sentence');
  const wCenter = centerOf(doc, 'word');
  const heads = [];
  for (let i = 0; i < paras.length; i++) {
    if (paras[i] && paras[i].type === 'h') heads.push([i, paras[i]]);
  }

  const headText = p => {
    const sents = Array.isArray(p.sentences) ? p.sentences : [];
    const joined = sents.map(s => (typeof s === 'string' ? s : (s && s.text) || '')).join(' ');
    return joined || p.text || '';
  };

  const level = p => {
    const lv = p.level ?? 1;
    return typeof lv === 'number' && Number.isFinite(lv) && lv >= 2 ? 2 : 1;
  };

  // A level-1 "Summary" sits before its "Chapter N" heading: name it after the chapter that follows.
  const titles = new Map();
  for (let k = 0; k < heads.length; k++) {
    const [i, p] = heads[k];
    let t = headText(p).trim();
    const nt = normText(t);
    if (level(p) !== 1 || JUNK.test(nt) || EXCLUDE.test(nt)) continue;
    if (nt === 'summary') {
      let nxt = '';
      for (let m = k + 1; m < heads.length; m++) {
        const qt = headText(heads[m][1]).trim();
        const nqt = normText(qt);
        if (level(heads[m][1]) === 1 && !JUNK.test(nqt) && nqt !== 'summary' && !EXCLUDE.test(nqt)) {
          nxt = qt;
          break;
        }
      }
      t = nxt ? `Summary · ${nxt}` : t;
    }
    titles.set(i, t);
  }

  const sections = [];
  const secIndex = new Map();
  const out = [];
  let curSec = null;
  let skipLevel = null;
  let skipRuns = false;

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (!p) continue;
    if (p.type === 'h') {
      const t = headText(p).trim();
      const nt = normText(t);
      const lv = level(p);
      const junk = lv === 1 && !titles.has(i) && !EXCLUDE.test(nt);
      if (skipLevel !== null && lv <= skipLevel && !(junk && skipRuns)) skipLevel = null;
      if (EXCLUDE.test(nt)) {
        skipLevel = lv;
        skipRuns = RUNS_ON.test(nt);
        continue;
      }
      if (titles.has(i)) {
        const title = titles.get(i);
        const key = sectionKey(title);
        if (!secIndex.has(key)) {
          secIndex.set(key, sections.length);
          sections.push({ key, title });
        }
        curSec = secIndex.get(key);
        continue;
      }
      if (lv === 1) continue;
    }
    if (skipLevel !== null) continue;
    const sents = Array.isArray(p.sentences) ? p.sentences : [];
    for (let si = 0; si < sents.length; si++) {
      let s = sents[si];
      if (typeof s === 'string') s = { text: s };
      if (!s || typeof s !== 'object') continue;
      const text = typeof s.text === 'string' ? s.text : '';
      if (!text.trim() || typeof s.score !== 'number' || !Number.isFinite(s.score) || FURNITURE.test(text.trim())) {
        continue;
      }
      const words = [];
      for (const w of Array.isArray(s.words) ? s.words : []) {
        if (w && Number.isInteger(w.start) && typeof w.score === 'number' && Number.isFinite(w.score)) {
          words.push(packWord(w, wCenter));
        }
      }
      out.push({ t: text, s: roundPy(s.score - c, 4), sec: curSec, w: words, h: p.type === 'h' });
    }
  }
  return [out, sections];
}

// ---------- topics ----------
function compilePattern(p) {
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${p})(?![\\p{L}\\p{N}_-])`, 'iu');
  } catch {
    return new RegExp(`(?<![\\w-])(?:${p})(?![\\w-])`, 'i');
  }
}

function loadTopics(topicsPath) {
  const spec = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
  return spec.topics.map(t => ({
    id: t.id,
    label: t.label,
    patterns: t.patterns,
    _re: t.patterns.map(compilePattern),
  }));
}

function tagTopics(sents, topics) {
  for (const s of sents) {
    const tp = [];
    for (let k = 0; k < topics.length; k++) {
      if (topics[k]._re.some(r => r.test(s.t))) tp.push(k);
    }
    s.tp = tp;
  }
}

// ---------- alignment ----------
function align(A, B, minSim) {
  const nA = A.map(s => normText(s.t));
  const nB = B.map(s => normText(s.t));
  const byText = new Map();
  for (let j = 0; j < nB.length; j++) {
    const t = nB[j];
    let q = byText.get(t);
    if (!q) { q = []; byText.set(t, q); }
    q.push(j);
  }
  const byHead = new Map();
  const pairs = [];
  const usedA = new Set();
  const usedB = new Set();

  for (let i = 0; i < nA.length; i++) {
    const lst = byText.get(nA[i]);
    if (lst) {
      const pos = byHead.get(nA[i]) || 0;
      if (pos < lst.length) {
        const j = lst[pos];
        byHead.set(nA[i], pos + 1);
        pairs.push([i, j, 'u', 1.0]);
        usedA.add(i);
        usedB.add(j);
      }
    }
  }

  const tokA = new Map();
  const tokB = new Map();
  for (let i = 0; i < A.length; i++) if (!usedA.has(i)) tokA.set(i, tokens(A[i].t));
  for (let j = 0; j < B.length; j++) if (!usedB.has(j)) tokB.set(j, tokens(B[j].t));

  const df = new Map();
  for (const tk of [...tokA.values(), ...tokB.values()]) {
    for (const w of new Set(tk)) df.set(w, (df.get(w) || 0) + 1);
  }

  const inv = new Map();
  for (const [j, tk] of tokB) {
    for (const w of new Set(tk)) {
      if (!STOP.has(w) && w.length > 2) {
        let s = inv.get(w);
        if (!s) { s = new Set(); inv.set(w, s); }
        s.add(j);
      }
    }
  }

  const cands = [];
  for (const [i, tk] of tokA) {
    const score = new Map();
    for (const w of new Set(tk)) {
      if (STOP.has(w) || w.length <= 2) continue;
      const js = inv.get(w);
      if (!js) continue;
      const inc = 1.0 / df.get(w);
      for (const j of js) score.set(j, (score.get(j) || 0) + inc);
    }
    const top = [...score.entries()].sort((x, y) => (y[1] - x[1]) || (x[0] - y[0])).slice(0, 25);
    for (const [j] of top) {
      const sm = new SequenceMatcher(tk, tokB.get(j));
      if (sm.realQuickRatio() < minSim || sm.quickRatio() < minSim) continue;
      const r = sm.ratio();
      if (r >= minSim) {
        const bonus = A[i].sec !== null && A[i].seckey === B[j].seckey ? 0.02 : 0.0;
        cands.push([r + bonus, r, i, j]);
      }
    }
  }
  cands.sort((x, y) => (y[0] - x[0]) || (x[2] - y[2]) || (x[3] - y[3]));
  for (const [, r, i, j] of cands) {
    if (usedA.has(i) || usedB.has(j)) continue;
    pairs.push([i, j, 'e', roundPy(r, 3)]);
    usedA.add(i);
    usedB.add(j);
  }
  pairs.sort((x, y) => (x[1] - y[1]) || (x[0] - y[0]));
  const removed = [];
  const added = [];
  for (let i = 0; i < A.length; i++) if (!usedA.has(i)) removed.push(i);
  for (let j = 0; j < B.length; j++) if (!usedB.has(j)) added.push(j);
  return [pairs, removed, added];
}

function utf16ToCp(s) {
  const map = new Int32Array(s.length + 1);
  let cp = 0;
  for (let u = 0; u < s.length;) {
    map[u] = cp;
    const code = s.charCodeAt(u);
    const step = (code >= 0xd800 && code <= 0xdbff && u + 1 < s.length && (s.charCodeAt(u + 1) & 0xfc00) === 0xdc00) ? 2 : 1;
    if (step === 2) map[u + 1] = cp;
    u += step;
    cp++;
  }
  map[s.length] = cp;
  return map;
}

function wordOps(a, b) {
  const ma = [];
  const mb = [];
  const reA = makeWordRegex();
  const reB = makeWordRegex();
  let m;
  while ((m = reA.exec(a))) ma.push([m.index, m.index + m[0].length]);
  while ((m = reB.exec(b))) mb.push([m.index, m.index + m[0].length]);
  const ta = ma.map(([s, e]) => a.slice(s, e).toLowerCase());
  const tb = mb.map(([s, e]) => b.slice(s, e).toLowerCase());
  const cpA = utf16ToCp(a);
  const cpB = utf16ToCp(b);
  const dels = [];
  const ins = [];
  for (const [op, i1, i2, j1, j2] of new SequenceMatcher(ta, tb).getOpcodes()) {
    if ((op === 'delete' || op === 'replace') && i2 > i1) dels.push([cpA[ma[i1][0]], cpA[ma[i2 - 1][1]]]);
    if ((op === 'insert' || op === 'replace') && j2 > j1) ins.push([cpB[mb[j1][0]], cpB[mb[j2 - 1][1]]]);
  }
  return [dels, ins];
}

// ---------- statistics ----------
function stats(scores, neutral) {
  const n = scores.length;
  if (!n) return { n: 0, mean: null, se: null, neg: 0, pos: 0 };
  let sumF = frac(0n, 1n);
  for (const x of scores) sumF = fracAdd(sumF, scoreFraction(x));
  const m = fracDivInt(sumF, n);
  const mf = fracToNumber(m);
  let sd = null;
  if (n >= 2) {
    let ss = 0;
    for (const x of scores) {
      const d = x - mf;
      ss += d * d;
    }
    sd = Math.sqrt(ss / (n - 1));
  }
  let neg = 0, pos = 0;
  for (const x of scores) {
    if (x < -neutral) neg++;
    else if (x > neutral) pos++;
  }
  return {
    n,
    mean: roundFrac(m, 4),
    se: sd === null ? null : roundPy(sd / Math.sqrt(n), 4),
    neg,
    pos,
  };
}

function oneSided(A, B, inA, inB, pairs, removed, added) {
  let hasA = false, hasB = false;
  for (let i = 0; i < A.length; i++) if (inA(i)) { hasA = true; break; }
  for (let j = 0; j < B.length; j++) if (inB(j)) { hasB = true; break; }
  if ((hasA && hasB) || (!hasA && !hasB)) return null;
  const counts = { u: 0, e: 0, a: 0, r: 0 };
  const items = [];
  const seen = new Set();
  let side;
  if (hasB && !hasA) {
    for (const [i, j] of pairs) {
      if (inB(j)) {
        counts.a++;
        items.push(['a', i, j, null]);
        seen.add(j);
      }
    }
    for (const j of added) {
      if (inB(j) && !seen.has(j)) {
        counts.a++;
        items.push(['a', null, j, null]);
      }
    }
    side = 'added';
  } else {
    for (const [i, j] of pairs) {
      if (inA(i)) {
        counts.r++;
        items.push(['r', i, j, null]);
        seen.add(i);
      }
    }
    for (const i of removed) {
      if (inA(i) && !seen.has(i)) {
        counts.r++;
        items.push(['r', i, null, null]);
      }
    }
    side = 'removed';
  }
  return { delta: null, edit: null, added: null, removed: null, counts, items, oneSided: side };
}

function decompose(A, B, inA, inB, pairs, removed, added) {
  const ia = [];
  const jb = [];
  for (let i = 0; i < A.length; i++) if (inA(i)) ia.push(i);
  for (let j = 0; j < B.length; j++) if (inB(j)) jb.push(j);
  if (!ia.length || !jb.length) return oneSided(A, B, inA, inB, pairs, removed, added);

  const aScores = new Map();
  let sumA = frac(0n, 1n);
  for (const i of ia) {
    const f = scoreFraction(A[i].s);
    aScores.set(i, f);
    sumA = fracAdd(sumA, f);
  }
  const bScores = new Map();
  let sumB = frac(0n, 1n);
  for (const j of jb) {
    const f = scoreFraction(B[j].s);
    bScores.set(j, f);
    sumB = fracAdd(sumB, f);
  }

  const mA = fracDivInt(sumA, ia.length);
  const mB = fracDivInt(sumB, jb.length);
  const nB = jb.length;
  const items = [];
  let edit = frac(0n, 1n);
  let add = frac(0n, 1n);
  let rem = frac(0n, 1n);
  const counts = { u: 0, e: 0, a: 0, r: 0 };

  for (const [i, j, kind] of pairs) {
    const aIn = inA(i);
    const bIn = inB(j);
    if (aIn && bIn) {
      if (kind === 'u' && B[j].s === A[i].s) {
        counts.u++;
        continue;
      }
      const c = fracDivInt(fracSub(bScores.get(j), aScores.get(i)), nB);
      edit = fracAdd(edit, c);
      counts.e++;
      items.push(['e', i, j, roundFrac(c, 5)]);
    } else if (bIn) {
      const c = fracDivInt(fracSub(bScores.get(j), mA), nB);
      add = fracAdd(add, c);
      counts.a++;
      items.push(['a', i, j, roundFrac(c, 5)]);
    } else if (aIn) {
      const c = fracNeg(fracDivInt(fracSub(aScores.get(i), mA), nB));
      rem = fracAdd(rem, c);
      counts.r++;
      items.push(['r', i, j, roundFrac(c, 5)]);
    }
  }
  for (const j of added) {
    if (inB(j)) {
      const c = fracDivInt(fracSub(bScores.get(j), mA), nB);
      add = fracAdd(add, c);
      counts.a++;
      items.push(['a', null, j, roundFrac(c, 5)]);
    }
  }
  for (const i of removed) {
    if (inA(i)) {
      const c = fracNeg(fracDivInt(fracSub(aScores.get(i), mA), nB));
      rem = fracAdd(rem, c);
      counts.r++;
      items.push(['r', i, null, roundFrac(c, 5)]);
    }
  }

  const delta = fracSub(mB, mA);
  const err = fracAbs(fracSub(delta, fracAdd(edit, fracAdd(add, rem))));
  if (err.n * 1000000000n > err.d) {
    throw new Error(`decomposition does not add up (err ${fracToNumber(err)})`);
  }
  items.sort((x, y) => Math.abs(y[3]) - Math.abs(x[3]));
  return {
    delta: roundFrac(delta, 5),
    edit: roundFrac(edit, 5),
    added: roundFrac(add, 5),
    removed: roundFrac(rem, 5),
    counts,
    items,
  };
}

function pct(values, q) {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return 0;
  const k = (v.length - 1) * q;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return v[lo] + (v[hi] - v[lo]) * (k - lo);
}

function nice(x) {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const n of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (n * p >= x - 1e-12) return roundPy(n * p, 6);
  }
  return roundPy(10 * p, 6);
}

// ---------- main ----------
function sortEditions(editions, assumeOrdered = false) {
  const ids = editions.map(([eid]) => eid);
  if (new Set(ids).size !== ids.length) {
    throw new Error('duplicate edition ids: ' + ids.join(', '));
  }
  const dates = ids.map(eid => /^[0-9]{4}-[0-9]{2}$/.test(eid));
  for (let idx = 0; idx < ids.length; idx++) {
    const eid = ids[idx];
    if (dates[idx]) {
      const year = Number(eid.slice(0, 4));
      const month = Number(eid.slice(5));
      if (year === 0 || month < 1 || month > 12) {
        throw new Error(`invalid YYYY-MM edition id: ${eid}`);
      }
    }
  }
  if (dates.some(Boolean) && !dates.every(Boolean)) {
    throw new Error('cannot mix YYYY-MM and other edition ids; use a consistent format');
  }
  if (dates.every(Boolean)) {
    const ordered = editions.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const changed = editions.some(([eid], i) => eid !== ordered[i][0]);
    return [ordered, changed];
  }
  if (!assumeOrdered) {
    throw new Error('non-YYYY-MM edition ids: confirm oldest-to-newest order with --assume-ordered (or assume_ordered=True)');
  }
  return [editions.slice(), false];
}

function canonicalJsonString(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJsonString).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJsonString(v[k])).join(',') + '}';
}

function build(editions, topics, opts = {}) {
  const minSim = opts.minSim ?? 0.55;
  const title = opts.title ?? null;
  const neutral = opts.neutral ?? 0.2;
  const sources = opts.sources || {};
  const minHits = opts.minHits ?? MIN_HITS;
  const assumeOrdered = !!opts.assumeOrdered;

  const [ordered] = sortEditions(editions, assumeOrdered);
  const models = new Set(ordered.map(([, d]) => canonicalJsonString(d.model ?? null)));
  if (models.size > 1) {
    throw new Error('editions were scored by different models / profiles: ' + [...models].sort().join(', '));
  }

  const eds = [];
  const secKeys = [];
  for (const [eid, doc] of ordered) {
    const [sents, sections] = flatten(doc);
    const own = new Set(sections.map(sec => sec.key));
    const claimed = new Set();
    for (const sec of sections) {
      if (!secKeys.includes(sec.key)) {
        const free = secKeys.filter(k => !own.has(k) && !claimed.has(k));
        let near = null;
        let bestSim = -1;
        for (const k of free) {
          const sim = sameSection(k, sec.key);
          if (sim > bestSim) { bestSim = sim; near = k; }
        }
        if (near !== null && bestSim >= 0.86) sec.key = near;
      }
      claimed.add(sec.key);
    }
    for (const s of sents) {
      s.seckey = s.sec !== null ? sections[s.sec].key : null;
    }
    tagTopics(sents, topics);
    eds.push({ id: eid, doc, sents, sections });
    for (const sec of sections) {
      if (!secKeys.includes(sec.key)) secKeys.push(sec.key);
    }
  }

  const secPos = new Map(secKeys.map((k, n) => [k, n]));
  const secTitles = new Map();
  for (const e of eds) {
    for (const sec of e.sections) secTitles.set(sec.key, sec.title);
  }

  const topicIdxById = new Map(topics.map((t, k) => [t.id, k]));
  const groups = [
    { id: 'all', label: 'All text', kind: 'all' },
    ...topics.map(t => ({ id: 't:' + t.id, label: t.label, kind: 'topic', patterns: t.patterns })),
    ...secKeys.map(k => ({ id: 's:' + k, label: secTitles.get(k), kind: 'section' })),
    { id: 'as:all', label: 'Assessment narrative', kind: 'assessment' },
    ...topics.map(t => ({ id: 'as:' + t.id, label: t.label, kind: 'assessment', patterns: t.patterns })),
  ];

  const member = (e, g) => {
    const ss = e.sents;
    if (g.kind === 'all') return () => true;
    if (g.kind === 'topic') {
      const k = topicIdxById.get(g.id.slice(2));
      return i => ss[i].tp.includes(k);
    }
    if (g.kind === 'assessment') {
      if (g.id === 'as:all') return i => ss[i].seckey === ASSESS_KEY;
      const k = topicIdxById.get(g.id.slice(3));
      return i => ss[i].seckey === ASSESS_KEY && ss[i].tp.includes(k);
    }
    const key = g.id.slice(2);
    return i => ss[i].seckey === key;
  };

  const outEds = [];
  for (const e of eds) {
    const st = {};
    for (const g of groups) {
      const f = member(e, g);
      const vals = [];
      for (let n = 0; n < e.sents.length; n++) if (f(n)) vals.push(e.sents[n].s);
      st[g.id] = stats(vals, neutral);
    }
    const src = sources[e.id] || {};
    const prov = {};
    for (const key of ['source', 'pages', 'assessmentPages', 'scope', 'quality']) {
      if (src[key] !== undefined && src[key] !== null && src[key] !== '') prov[key] = src[key];
    }
    outEds.push({
      id: e.id,
      label: labelFor(e.id),
      title: e.doc.title || e.id,
      ...prov,
      sections: e.sections.map(s => s.key),
      stats: st,
      sentences: e.sents.map(s => ({
        t: s.t,
        s: s.s,
        sec: s.seckey ? secPos.get(s.seckey) : null,
        tp: s.tp,
        w: s.w,
        ...(s.h ? { h: 1 } : {}),
      })),
    });
  }

  const diffs = [];
  for (let k = 1; k < eds.length; k++) {
    const A = eds[k - 1].sents;
    const B = eds[k].sents;
    const [pairs, removed, added] = align(A, B, minSim);
    const ops = {};
    let bad = 0;
    for (const [i, j, kind] of pairs) {
      if (kind === 'e') ops[`${i}:${j}`] = wordOps(A[i].t, B[j].t);
      if (kind === 'u' && A[i].s !== B[j].s) bad++;
    }
    const groupsOut = {};
    for (const g of groups) {
      const d = decompose(A, B, member(eds[k - 1], g), member(eds[k], g), pairs, removed, added);
      if (d) groupsOut[g.id] = d;
    }
    diffs.push({
      from: k - 1,
      to: k,
      pairs,
      removed,
      added,
      ops,
      unchangedScoreMismatch: bad,
      groups: groupsOut,
    });
  }

  const allS = [];
  const words = [];
  for (const e of eds) {
    for (const s of e.sents) {
      if (s.s) allS.push(Math.abs(s.s));
      for (const w of s.w) words.push(Math.abs(w[2]));
    }
  }
  const means = [];
  for (const e of outEds) {
    for (const st of Object.values(e.stats)) {
      if (st.mean !== null && st.n >= 5) means.push(Math.abs(st.mean));
    }
  }
  const deltas = [];
  for (const d of diffs) {
    for (const g of Object.values(d.groups)) {
      if (typeof g.delta === 'number' && Number.isFinite(g.delta)) deltas.push(Math.abs(g.delta));
    }
  }
  const model = eds[0].doc.model ?? null;
  const ref = eds[eds.length - 1].doc.scale || {};
  const wordScale = ref && typeof ref === 'object' && !Array.isArray(ref) && ref.word ? ref.word : nice(pct(words, 0.9));

  return {
    format: FORMAT,
    version: VERSION,
    title: title || eds[eds.length - 1].doc.title || '',
    model,
    params: { minSim, neutral, minHits },
    scale: {
      word: wordScale,
      sentence: nice(pct(allS, 0.9)),
      mean: nice(pct(means, 0.95)),
      delta: nice(pct(deltas, 0.9)),
    },
    topics: topics.map(t => ({ id: t.id, label: t.label, patterns: t.patterns })),
    groups,
    sectionKeys: secKeys,
    editions: outEds,
    diffs,
  };
}

function formatJsWrapper(text, jsonPath, note) {
  const header = '/* Generated by tools/sm-diff.js. Do not edit by hand.' +
    (note ? '\n   ' + String(note).replace(/\*\//g, '* /') : '') + ' */\n';
  return header + 'window.DIFF_FILES = window.DIFF_FILES || {};\n' +
    `window.DIFF_FILES[${JSON.stringify(path.basename(jsonPath))}] = ${text};\n`;
}

function write(obj, outPath, jsPath = null, note = null) {
  const text = JSON.stringify(obj);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf8');
  if (jsPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsPath)), { recursive: true });
    fs.writeFileSync(jsPath, formatJsWrapper(text, outPath, note), 'utf8');
  }
  return text;
}

function parseFloatArg(raw, flag) {
  const s = String(raw).trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) {
    throw new Error(`invalid float value for ${flag}: ${JSON.stringify(raw)}`);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid float value for ${flag}: ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseIntArg(raw, flag) {
  const s = String(raw).trim();
  if (!/^[+-]?\d+$/.test(s)) {
    throw new Error(`invalid int value for ${flag}: ${JSON.stringify(raw)}`);
  }
  const n = Number(s);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`invalid int value for ${flag}: ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseArgs(argv) {
  const opts = { edition: [], assumeOrdered: false, minSim: 0.55, minHits: MIN_HITS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let flag = arg;
    let hasInline = false;
    let inlineVal = null;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) {
        flag = arg.slice(0, eq);
        hasInline = true;
        inlineVal = arg.slice(eq + 1);
      }
    }
    const next = () => {
      if (hasInline) return inlineVal;
      if (i + 1 >= argv.length) throw new Error(`missing value for ${flag}`);
      return argv[++i];
    };
    const noValue = () => {
      if (hasInline) throw new Error(`option ${flag} does not take a value`);
    };
    if (flag === '-h' || flag === '--help') { noValue(); opts.help = true; continue; }
    if (flag === '--edition') opts.edition.push(next());
    else if (flag === '--assume-ordered') { noValue(); opts.assumeOrdered = true; }
    else if (flag === '--topics') opts.topics = next();
    else if (flag === '-o' || flag === '--out') opts.out = next();
    else if (flag === '--js') opts.js = next();
    else if (flag === '--title') opts.title = next();
    else if (flag === '--note') opts.note = next();
    else if (flag === '--sources') opts.sources = next();
    else if (flag === '--min-sim') opts.minSim = parseFloatArg(next(), flag);
    else if (flag === '--min-hits') opts.minHits = parseIntArg(next(), flag);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

if (require.main === module) {
  try {
    const a = parseArgs(process.argv.slice(2));
    if (a.help) {
      console.log('Usage: node tools/sm-diff.js --edition ID=PATH --edition ID=PATH --topics PATH -o OUT [--js OUT.js] [--assume-ordered] [--title TITLE] [--note NOTE] [--sources PATH] [--min-sim 0.55] [--min-hits 5]');
      process.exit(0);
    }
    if (a.edition.length < 2) throw new Error('need at least two editions');
    if (!a.topics) throw new Error('--topics is required');
    if (!a.out) throw new Error('-o / --out is required');
    const editions = a.edition.map(spec => {
      const idx = spec.indexOf('=');
      if (idx < 0) throw new Error(`invalid --edition spec (expected ID=PATH): ${spec}`);
      const eid = spec.slice(0, idx);
      const p = spec.slice(idx + 1);
      return [eid, JSON.parse(fs.readFileSync(p, 'utf8'))];
    });
    const [, reordered] = sortEditions(editions, a.assumeOrdered);
    if (reordered) {
      process.stderr.write('edition ids were not chronological; sorted by YYYY-MM so added/removed stay in time order\n');
    }
    const src = a.sources ? JSON.parse(fs.readFileSync(a.sources, 'utf8')) : null;
    const res = build(editions, loadTopics(a.topics), {
      minSim: a.minSim,
      title: a.title,
      sources: src,
      minHits: a.minHits,
      assumeOrdered: a.assumeOrdered,
    });
    write(res, a.out, a.js, a.note);
    for (const d of res.diffs) {
      const c = { u: 0, e: 0 };
      for (const p of d.pairs) if (p[2] === 'u' || p[2] === 'e') c[p[2]]++;
      const A = res.editions[d.from];
      const B = res.editions[d.to];
      const delta = d.groups.all.delta;
      const deltaS = delta === null ? 'n/a' : `${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`;
      const warn = d.unchangedScoreMismatch ? `  WARNING ${d.unchangedScoreMismatch} unchanged sentences changed score` : '';
      console.log(`${A.id} -> ${B.id}: unchanged ${c.u}, edited ${c.e}, removed ${d.removed.length}, added ${d.added.length}; all-text delta ${deltaS}${warn}`);
    }
    console.log(`wrote ${a.out} (${fs.statSync(a.out).size} bytes)`);
  } catch (e) {
    process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  }
}

module.exports = {
  FORMAT, VERSION, ASSESS_KEY, MIN_HITS,
  SequenceMatcher, roundPy, roundFrac, roundFracInt, floatToFrac, fracToNumber, scoreFraction,
  normText, sectionKey, sameSection, labelFor, flatten, compilePattern, loadTopics, tagTopics,
  tokens, align, wordOps, packWord, stats, decompose, pct, nice, sortEditions, build, formatJsWrapper, write, parseArgs,
};
