/* SentimentMarker core: input parsing (PDF line rejoining, Markdown, plain text), the built-in sentiment
   engine, scored files <-> doc, and the pure summaries (outline, topics, spectrum). DOM-free.
   One copy for both pages: index.html and SentimentStoryDemo.html load it as a classic <script src>
   (not fetch(): file:// blocks it), and test/core.test.js runs it under Node.
   Browser: the API is window.SMCore. Node: module.exports. The IIFE keeps the helpers out of page globals. */
(function () {
//<core>
/* ========== CORE: input parsing + sentiment engine (no DOM) ========== */
const CAP = { word: 3.0, sent: 0.6, para: 0.3 };
const LEX = new Map(), NEGS = new Set(), BOOST = new Map();
const BUTS = new Set(['but','however','nevertheless','nonetheless','但是','可是','然而','不过']);
const lex = (v, s) => { for (const w of s.split(/\s+/)) if (w) LEX.set(w, v); };

lex(3.5, `amazing wonderful fantastic outstanding superb excellent thrilled delighted love loved lovely awesome terrific perfect triumph triumphant breakthrough ecstatic spectacular magnificent flawless`);
lex(2.8, `great happy joy joyful proud impressive remarkable cheerful grateful brilliant beautiful inspiring inspired exciting excited victory win won winning succeed success successful thriving generous`);
lex(2.2, `good pleasant pleasure enjoy enjoyed enjoyable glad confident confidence hopeful encouraging encouraged valuable strength strong stronger strongest stable secure reliable effective efficient benefit benefits growth gain gained gains improve improved improvement improving progress welcome healthy recover recovered recovery relief relieved smooth clean best better`);
lex(1.9, `thanks thank thankful`);
lex(1.6, `kind kindly helpful useful nice fine fair solid steady calm safe ready trust trusted supportive patient patience honest clear easy easier simple fresh fun warm bright rise rose rising boost opportunity opportunities positive`);
lex(1.0, `active interested interesting free approve approved repair repaired fix fixed solve solved resolve resolved pleased upgrade`);
lex(-3.5, `terrible awful horrible disaster catastrophe catastrophic devastating devastated hate hated disgusting tragic tragedy collapse collapsed fraud horrific nightmare brutal furious`);
lex(-2.8, `bad angry anger painful pain crisis fail failed failure failing hurt loss lose loses losing lost damage damaged corrupt corrupted broken disappointing disappointed disappointment miserable hopeless`);
lex(-2.2, `poor weak worse worst threat threatened fear afraid anxious anxiety sad sadness stress stressed stressful conflict crash crashed mistake mistakes error errors bug bugs blame blamed blaming debt deficit shortage decline declined declining drop dropped fall fell falling cancel cancelled canceled reject rejected refuse refused harm harmful regret frustrating frustrated frustration exhausted exhausting lonely bleak grim dire`);
lex(-1.8, `sorry`);
lex(-1.6, `problem problems risk risks worry worried worries concern concerned doubt doubts uncertain uncertainty fragile unstable volatile slow delay delayed lag lagging difficult difficulty struggle struggled struggling tense tired miss missed missing expensive costly burden confusing confused confusion messy discouraged trouble troubled`);
lex(-1.2, `serious unfortunate unfortunately limited lack lacking tough`);
/* Chinese (small starter set) */
lex(2.5, `优秀 出色 精彩 惊喜 美好 满意 成功 高兴 开心 喜欢 感谢 希望 稳定 顺利 有效 宝贵 友善 温暖 进步 增长 信任 强大 棒`);
lex(2.0, `好 不错 赞`);
lex(-2.6, `糟糕 失败 痛苦 愤怒 崩溃 危机 失望 恐惧 悲伤 焦虑 难过 伤害`);
lex(-1.8, `担心 损失 下降 困难 疲惫 压力 错误 冲突 脆弱 不安 遗憾 不好 坏 抱歉`);
lex(-1.4, `问题 风险 延迟`);
for (const w of `not no never none nobody nothing neither nor nowhere without hardly scarcely cannot cant dont doesnt didnt isnt arent wasnt werent wont wouldnt couldnt shouldnt havent hasnt hadnt aint don't doesn't didn't isn't aren't wasn't weren't won't wouldn't couldn't shouldn't haven't hasn't hadn't can't ain't 不 没 没有 无 非 未 别 不是 并非`.split(/\s+/)) NEGS.add(w);
Object.entries({very:1.35,extremely:1.5,really:1.3,incredibly:1.5,so:1.25,highly:1.3,deeply:1.4,truly:1.3,remarkably:1.4,absolutely:1.5,completely:1.4,totally:1.4,especially:1.3,particularly:1.25,quite:1.15,utterly:1.5,seriously:1.3,
  slightly:.75,somewhat:.8,barely:.7,fairly:.9,rather:.9,mildly:.7,partly:.8,marginally:.75,
  非常:1.5,很:1.3,特别:1.4,十分:1.4,太:1.3,极其:1.6,相当:1.3,格外:1.4,有点:.75,稍微:.8,略:.85,比较:.9,还算:.85}).forEach(([k,v]) => BOOST.set(k, v));

const CJK_RE = /[㐀-鿿豈-﫿]/;
const CJK_MULTI = new Set([...LEX.keys(), ...NEGS, ...BOOST.keys(), ...BUTS].filter(k => CJK_RE.test(k) && [...k].length >= 2));
const SEG = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

function splitCJK(s) {
  const chars = [...s];
  if (chars.length < 2) return [{ text: s, word: true }];
  if (CJK_MULTI.has(s)) return [{ text: s, word: true }];
  const out = []; let i = 0, buf = '';
  while (i < chars.length) {
    let hit = 0;
    for (let L = Math.min(4, chars.length - i); L >= 2; L--) { if (CJK_MULTI.has(chars.slice(i, i + L).join(''))) { hit = L; break; } }
    if (hit) { if (buf) { out.push({ text: buf, word: true }); buf = ''; } out.push({ text: chars.slice(i, i + hit).join(''), word: true }); i += hit; }
    else { buf += chars[i]; i++; }
  }
  if (buf) out.push({ text: buf, word: true });
  return out;
}
function rawTokens(text) {
  const base = [];
  if (SEG) { for (const s of SEG.segment(text)) base.push({ text: s.segment, word: !!s.isWordLike }); }
  else { const re = /[\p{L}\p{N}'’]+|\s+|[^\s\p{L}\p{N}]/gu; let m; while ((m = re.exec(text))) base.push({ text: m[0], word: /[\p{L}\p{N}]/u.test(m[0]) }); }
  const res = [];
  for (const t of base) { if (t.word && CJK_RE.test(t.text)) res.push(...splitCJK(t.text)); else res.push(t); }
  return res;
}
function lexLookup(w) {
  if (LEX.has(w)) return LEX.get(w);
  if (CJK_RE.test(w)) return undefined;
  const tries = [];
  if (w.endsWith('ies')) tries.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ied')) tries.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ably')) tries.push(w.slice(0, -4) + 'able');
  if (w.endsWith('ily')) tries.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ly')) tries.push(w.slice(0, -2));
  if (w.endsWith('es')) tries.push(w.slice(0, -2));
  if (w.endsWith('s')) tries.push(w.slice(0, -1));
  if (w.endsWith('ed')) { tries.push(w.slice(0, -2)); tries.push(w.slice(0, -1)); }
  if (w.endsWith('ing')) { tries.push(w.slice(0, -3)); tries.push(w.slice(0, -3) + 'e'); }
  if (w.endsWith('er')) tries.push(w.slice(0, -2));
  for (const t of tries) if (t.length > 2 && LEX.has(t)) return LEX.get(t);
  return undefined;
}
function lookup(lower) {
  if (NEGS.has(lower) || /n't$/.test(lower)) return { k: 'neg' };
  if (BOOST.has(lower)) return { k: 'boost', m: BOOST.get(lower) };
  const v = lexLookup(lower);
  if (v !== undefined) return { k: 'lex', v };
  return null;
}
const strength = (level, score, cap = CAP) => Math.min(1, Math.abs(score) / cap[level]);

/* outline rows (pure): true when the document is long enough for the outline to auto-open */
function outlineWorthy(doc) {
  return !!doc && doc.blocks.length >= 12 && doc.blocks.filter(b => b.type === 'h').length >= 4;
}
/* outline spans (pure): every heading block owns the blocks that follow it until the next heading
   whose level is <= its own (an h2 ends the previous h2; only an h1 ends an h1). Blocks [from, to). */
function sectionSpans(doc) {
  const B = doc.blocks, out = [], lvOf = b => (b.level >= 2 ? 2 : 1);
  B.forEach((h, i) => {
    if (h.type !== 'h') return;
    const lv = lvOf(h);
    let j = i + 1;
    while (j < B.length && !(B[j].type === 'h' && lvOf(B[j]) <= lv)) j++;
    out.push({ blockId: h.id, level: lv, from: i, to: j });
  });
  return out;
}
/* outline rows (pure): one per heading, over its span. The section score is the plain sum of its
   sentence scores, the heading's own included: addition for now, the display squashes the sum
   before colouring so long sections do not saturate. */
function sectionScores(doc) {
  const B = doc.blocks;
  return sectionSpans(doc).map(r => {
    let sum = 0, n = 0;
    for (let j = r.from; j < r.to; j++) B[j].sents.forEach(s => { sum += s.score; n++; });
    return { blockId: r.blockId, level: r.level, text: B[r.from].sents.map(s => s.text).join(' ').trim(), score: Math.round(sum * 100) / 100, count: n };
  });
}

function analyzeSentence(text) {
  const toks = rawTokens(text);
  const wi = [];
  toks.forEach((t, i) => { if (t.word) { t.lower = t.text.toLowerCase().replace(/[’‘]/g, "'"); t.info = lookup(t.lower); wi.push(i); } });
  let butAt = -1;
  for (let p = 0; p < wi.length; p++) {
    const t = toks[wi[p]];
    if (BUTS.has(t.lower)) { const prev = p > 0 ? toks[wi[p - 1]] : null; if (!(prev && prev.info && prev.info.k === 'neg')) { butAt = p; break; } }
  }
  let S = 0; const scored = [];
  const hasLower = /[a-z]/.test(text);
  for (let p = 0; p < wi.length; p++) {
    const t = toks[wi[p]];
    if (!t.info || t.info.k !== 'lex') continue;
    const v = t.info.v; let mult = 1, negW = null; const notes = [];
    for (let d = 1; d <= 3 && p - d >= 0; d++) {
      const pt = toks[wi[p - d]], pi = pt.info;
      if (!pi) continue;
      if (pi.k === 'boost') { const m = 1 + (pi.m - 1) * [1, .95, .9][d - 1]; mult *= m; notes.push({ t: 'boost', w: pt.text, m }); }
      else if (pi.k === 'neg' && !negW) negW = pt.text;
    }
    let eff = v * mult;
    if (negW) { eff *= v > 0 ? -0.6 : -0.5; notes.push({ t: 'neg', w: negW }); }
    if (hasLower && t.text.length > 2 && t.text === t.text.toUpperCase() && /[A-Z]/.test(t.text)) { eff *= 1.2; notes.push({ t: 'caps' }); }
    eff = Math.max(-4.5, Math.min(4.5, eff));
    t.score = eff; t.base = v; t.notes = notes;
    let w = 1;
    if (butAt >= 0) { w = p < butAt ? 0.5 : p > butAt ? 1.5 : 1; if (w !== 1) notes.push({ t: 'but', w }); }
    S += eff * w; scored.push(t);
  }
  const ex = (text.match(/!/g) || []).length;
  if (S !== 0 && ex) S += Math.sign(S) * Math.min(ex, 3) * 0.3;
  return { text, toks, scored, raw: S, score: S / Math.sqrt(S * S + 15), lc: text.toLowerCase() };
}

const ABBR = new Set(['mr','mrs','ms','dr','prof','sr','jr','st','vs','etc','e.g','i.e','fig','figs','al','no','inc','ltd','co','dept','approx','est','vol','pp','cf','eq','sec','ch','jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec','u.s','u.k']);
function splitSentences(text) {
  const out = []; let start = 0, m;
  const re = /([.!?…]+|[。！？]+)(["'”’»)\]」』）]*)(\s*)/g;
  while ((m = re.exec(text))) {
    const end = m.index + m[1].length + m[2].length, gapEnd = re.lastIndex;
    const cjk = /[。！？]/.test(m[1]);
    if (!cjk) {
      if (!m[3] && gapEnd < text.length) continue;
      const before = text.slice(start, m.index);
      if (m[1] === '.') {
        const lw = (before.match(/([A-Za-z.]+)$/) || [])[1];
        if (lw && (ABBR.has(lw.toLowerCase()) || lw.length === 1)) continue;
        if (start === 0 && /^\d+$/.test(before.trim())) continue;
        const next = text[gapEnd];
        if (next && /[a-z]/.test(next)) continue;
      }
    }
    out.push({ text: text.slice(start, end), gap: text.slice(end, gapEnd) });
    start = gapEnd;
  }
  if (start < text.length) out.push({ text: text.slice(start), gap: '' });
  return out.filter(s => s.text.trim());
}

const STOP = new Set(`the and but with without within from into onto over under about after before during while because that this these those then than they them their theirs were been being does done have has had having its itself she him her hers who whom whose which what when where why how all any both each few more most other some such only own same too very can will just should would could might may must shall also not nor yet still even ever never again once here there thus though although whether either neither one two three four five six seven eight nine ten hundred many much every another anyone someone everyone nobody nothing something anything everything first last next new old like get got make made makes making take took taken see saw seen say said says told tell came come goes went going gone around across along among between through against towards upon per via etc monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december`.split(/\s+/));
const normWord = w => { w = w.toLowerCase().replace(/’/g, "'"); if (!CJK_RE.test(w) && w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1); return w; };

function buildDoc(title, blocks) {
  const doc = { title, blocks: [], sents: [], words: [] };
  let sid = 0, wid = 0;
  blocks.forEach((b, bi) => {
    const blk = { id: bi, type: b.type, sents: [], score: 0, k: 0, derived: false };
    if (b.type === 'h') blk.level = b.level >= 2 ? 2 : 1;
    for (const st of splitSentences(b.text)) {
      const a = analyzeSentence(st.text);
      a.gap = st.gap; a.id = sid++; a.block = bi;
      a.norm = new Set(); for (const t of a.toks) if (t.word) a.norm.add(normWord(t.text));
      a.wt = a.toks;
      a.k = strength('sent', a.score); a.derived = true;
      for (const t of a.scored) { t.wid = wid++; t.k = strength('word', t.score); doc.words.push(t); }
      blk.sents.push(a); doc.sents.push(a);
    }
    blk.score = blk.sents.length ? blk.sents.reduce((x, s) => x + s.score, 0) / blk.sents.length : 0;
    blk.k = strength('para', blk.score); blk.derived = true;
    doc.blocks.push(blk);
  });
  doc.cap = CAP; doc.capSrc = { word: 'builtin', sent: 'builtin', para: 'builtin' }; doc.center = { word: 0, sent: 0, para: 0 };
  doc.ref = builtinRef(); doc.builtin = true; setHas(doc);
  return doc;
}
/* which levels have any non-zero score (the UI greys out the rest) */
const setHas = doc => { doc.has = { word: doc.words.length > 0, sent: doc.sents.some(s => s.score !== 0), para: doc.blocks.some(b => b.score !== 0) }; };
/* reference spectrum used by the side panel when the doc was scored by the built-in demo lexicon */
function builtinRef() {
  const ex = w => ({ text: w, score: LEX.get(w) });
  return { name: `Built-in dictionary (${LEX.size} words, demo only)`, scores: [...LEX.values()].sort((a, b) => a - b),
    examples: ['terrible', 'bad', 'poor', 'problem', 'serious', 'active', 'helpful', 'good', 'great', 'wonderful'].map(ex) };
}
function extractTopics(doc, max = 8) {
  const cnt = new Map();
  for (const s of doc.sents) for (const t of s.wt) {
    if (!t.word || t.info || /^\d+$/.test(t.text)) continue;
    const k = normWord(t.text), cjk = CJK_RE.test(k);
    if ((!cjk && k.length < 4) || (cjk && [...k].length < 2) || STOP.has(k)) continue;
    let e = cnt.get(k); if (!e) { e = { key: k, count: 0, surf: new Map() }; cnt.set(k, e); }
    e.count++; const sf = t.text.toLowerCase(); e.surf.set(sf, (e.surf.get(sf) || 0) + 1);
  }
  return [...cnt.values()].filter(e => e.count >= 2)
    .sort((a, b) => b.count - a.count || b.key.length - a.key.length).slice(0, max)
    .map(e => ({ key: e.key, sub: null, label: [...e.surf.entries()].sort((a, b) => b[1] - a[1])[0][0], count: e.count, on: false, custom: false }));
}
function makeTopic(str, doc) {
  const s = str.trim().toLowerCase(); if (!s) return null;
  const phrase = /\s/.test(s) || CJK_RE.test(s);
  const t = { key: phrase ? s : normWord(s), sub: phrase ? s : null, label: s, count: 0, on: true, custom: true };
  if (doc) t.count = doc.sents.filter(x => matches(x, t)).length;
  return t;
}
const matches = (sent, t) => t.sub ? sent.lc.includes(t.sub) : sent.norm.has(t.key);

/* ---------- topic summary (pure). Attribution is per sentence, through matches(): a sentence counts once per
   topic however often it repeats the word, and a sentence that mentions several topics counts toward each. ---------- */
const NEUTRAL_K = 0.2;   /* below this share of the colour scale a sentence counts as neutral (the header's split too) */
/* the score a sentence stands for: its own, or its paragraph's when the file scored only the paragraph
   (no sentence score, no word scores, a paragraph score from the file) */
function sentValue(doc, s) {
  const b = doc.blocks[s.block];
  return s.derived && !s.scored.length && b && !b.derived ? { score: b.score, level: 'para' } : { score: s.score, level: 'sent' };
}
/* count / sum / mean and the negative / neutral / positive split of a sentence list; an empty list gives zeros, never NaN.
   byPara = how many were read on the paragraph scale (they stand for their paragraph) */
function tally(doc, list) {
  const r = { count: list.length, sum: 0, mean: 0, pos: 0, neg: 0, neu: 0, byPara: 0 }, cap = doc.cap || CAP;
  for (const s of list) {
    const v = sentValue(doc, s);
    r.sum += v.score; if (v.level === 'para') r.byPara++;
    if (!v.score || strength(v.level, v.score, cap) < NEUTRAL_K) r.neu++; else if (v.score > 0) r.pos++; else r.neg++;
  }
  if (r.count) r.mean = r.sum / r.count;
  return r;
}
/* one row per topic, in the order given: { key, label, count, sum, mean, pos, neg, neu, byPara, shared, topPos, topNeg }.
   shared = hits that also match another topic in this list. topPos = up to opts.n (default 3) hits with score > 0,
   highest first; topNeg = up to n hits with score < 0, lowest first; ties in document order. Each is
   { id, block, score, text }; id is doc.sents[id]. opts.sents narrows the pool (the story view counts body sentences only). */
function topicScores(doc, topics, opts = {}) {
  const n = opts.n == null ? 3 : opts.n, pool = opts.sents || doc.sents;
  const hits = topics.map(t => pool.filter(s => matches(s, t)));
  const seen = new Map();
  hits.forEach(h => h.forEach(s => seen.set(s.id, (seen.get(s.id) || 0) + 1)));
  return topics.map((t, i) => {
    const rows = hits[i].map(s => ({ id: s.id, block: s.block, score: sentValue(doc, s).score, text: s.text }));
    return Object.assign({ key: t.key, label: t.label }, tally(doc, hits[i]), {
      shared: hits[i].filter(s => seen.get(s.id) > 1).length,
      topPos: rows.filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, n),
      topNeg: rows.filter(x => x.score < 0).sort((a, b) => a.score - b.score || a.id - b.id).slice(0, n),
    });
  });
}
/* outline rows x topics: per sectionSpans row, the sentences that match ANY of `topics` (the same union the
   topic filter leaves undimmed), as { blockId, count, sum, mean, pos, neg, neu, byPara } */
function sectionTopicScores(doc, topics) {
  const B = doc.blocks;
  return sectionSpans(doc).map(r => {
    const list = [];
    for (let j = r.from; j < r.to; j++) for (const s of B[j].sents) if (topics.some(t => matches(s, t))) list.push(s);
    return Object.assign({ blockId: r.blockId }, tally(doc, list));
  });
}

function parseText(raw) {
  return raw.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map(text => ({ type: 'p', text }));
}
const mdClean = t => t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`~]+/g, '').replace(/\s+/g, ' ').trim();
function parseMarkdown(raw) {
  raw = raw.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  const blocks = []; let buf = [], code = false;
  const flush = () => { if (buf.length) { const t = mdClean(buf.join(' ')); if (t) blocks.push({ type: 'p', text: t }); buf = []; } };
  for (const line of raw.split('\n')) {
    if (/^\s*```/.test(line)) { flush(); code = !code; continue; }
    if (code) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); const t = mdClean(h[2]); if (t) blocks.push({ type: 'h', text: t, level: h[1].length >= 2 ? 2 : 1 }); continue; }
    if (!line.trim()) { flush(); continue; }
    if (/^\s*\|/.test(line) || /^\s*[-*_]{3,}\s*$/.test(line)) { flush(); continue; }
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) { flush(); buf.push(li[1]); flush(); continue; }
    buf.push(line.replace(/^\s*>\s?/, '').trim());
  }
  flush(); return blocks;
}

/* PDF text items -> lines -> blocks (pure, so it can be tested without pdf.js) */
function itemsToLines(items) {
  const lines = []; let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string' || it.str === '') continue;
    const tr = it.transform, x = tr[4], y = tr[5];
    const size = Math.abs(it.height) || Math.hypot(tr[2], tr[3]) || 10;
    /* A footnote digit is smaller and raised by more than 2pt ("risks 7"). Skip that.
       A smaller glyph on the same baseline is real text (a bullet's bold lead) and stays.
       Line size follows the longest run, so the bullet does not make that lead a heading. */
    if (cur && size < cur.size * 0.75 && y - cur.y > 2) continue;
    if (!cur || Math.abs(y - cur.y) > Math.max(2, size * 0.5)) { if (cur) lines.push(cur); cur = { y, x, size, text: '', endX: x, span: 0 }; }
    if (cur.text && x - cur.endX > size * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
    cur.text += it.str; cur.endX = x + (it.width || 0);
    const span = it.str.trim().length;
    if (span >= cur.span) { cur.size = size; cur.span = span; }
  }
  if (cur) lines.push(cur);
  return lines.map(l => ({ y: l.y, x: l.x, size: l.size, text: l.text.replace(/\s+/g, ' ').trim() })).filter(l => l.text);
}
function linesToBlocks(pages) {
  const n = pages.length, freq = new Map();
  const key = l => l.text.replace(/\d+/g, '#').trim().toLowerCase();
  const edge = (l, p) => { const H = p.height || 800; return l.y > H * 0.92 || l.y < H * 0.08; };
  pages.forEach(p => { const seen = new Set(); p.lines.forEach(l => { if (edge(l, p)) { const k = key(l); if (!seen.has(k)) { seen.add(k); freq.set(k, (freq.get(k) || 0) + 1); } } }); });
  /* A publication running header such as "Financial Stability Review" changes section
     wording often enough to miss the 40% repeat test on a long document. The same
     banner is also painted several times on one baseline ("AssessmentAssessment…").
     Drop that edge line, and its letterspaced twin, even on a single page. Do not
     lower the 8% band: a real last line can sit just inside it. */
  const letterspaced = text => { const parts = text.trim().split(/\s+/).filter(Boolean); return parts.length >= 8 && parts.filter(p => p.length === 1).length / parts.length >= 0.6; };
  const repeatedBanner = text => {
    const raw = text.replace(/\s+/g, '');
    for (let k = 3; k <= 8; k++) { if (raw.length % k) continue; const chunk = raw.slice(0, raw.length / k); if (chunk.length >= 12 && chunk.repeat(k) === raw) return true; }
    /* "Chapter 1 | TitleTitleTitle" — the first copy carries a prefix, the rest tile. */
    return /(.{20,}?)\1{2,}/.test(text);
  };
  const drop = (l, p) => edge(l, p) && ((n >= 3 && freq.get(key(l)) >= Math.max(3, n * 0.4)) || /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(l.text.trim()) || key(l).includes('financial stability review') || letterspaced(l.text) || repeatedBanner(l.text));
  const kept = pages.map(p => p.lines.filter(l => !drop(l, p)));
  const hist = new Map();
  kept.forEach(ls => ls.forEach(l => { const k = Math.round(l.size); hist.set(k, (hist.get(k) || 0) + l.text.length); }));
  const body = [...hist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const blocks = []; let curP = null, curH = null, prevHead = false;
  const closeP = () => { if (curP) { blocks.push({ type: 'p', text: curP.text.trim() }); curP = null; } };
  kept.forEach(ls => {
    const gaps = []; for (let i = 1; i < ls.length; i++) { const g = ls[i - 1].y - ls[i].y; if (g > 0 && g < ls[i].size * 3) gaps.push(g); }
    gaps.sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : (ls[0] ? ls[0].size * 1.3 : 12);
    ls.forEach((l, i) => {
      const prev = i > 0 ? ls[i - 1] : null, gap = prev ? prev.y - l.y : null;
      const isHead = l.size >= body * 1.18 && l.text.length <= 140 && !/[,;]$/.test(l.text);
      if (isHead) {
        /* outline level by absolute size, not a ratio of the body mode: the mode flips between
           slices of one document (11 vs 12), the font roles do not (22pt+ = chapter, 13-16 = section) */
        const lv = l.size >= 20 ? 1 : 2;
        if (curH && prevHead && gap != null && gap < l.size * 1.8 && Math.abs(prev.size - l.size) < 0.6) curH.text += ' ' + l.text;
        else { closeP(); curH = { type: 'h', text: l.text, level: lv }; blocks.push(curH); }
        prevHead = true; return;
      }
      curH = null; prevHead = false;
      let fresh;
      if (!curP) fresh = true;
      else if (!prev) fresh = /[.!?:”"')\]。！？]$/.test(curP.text.trim());
      /* A line that jumps upward is the next column or a banner that arrived late in
         the content stream, not the next wrapped line. Do not glue it onto the sentence. */
      else fresh = gap > typical * 1.45 || gap < -(l.size || 10) * 0.8 || (l.x > prev.x + l.size * 1.2 && /[.!?”"')]$/.test(curP.text.trim()));
      if (fresh) { closeP(); curP = { text: l.text }; }
      else if (/[A-Za-z]-$/.test(curP.text) && /^[a-z]/.test(l.text)) curP.text = curP.text.slice(0, -1) + l.text;
      else curP.text += ' ' + l.text;
    });
  });
  closeP();
  return blocks.filter(b => b.text);
}
/* ---------- scored files (JSON / CSV)  <->  doc.  The scores come from outside; this layer only lays them out. ---------- */
const isNum = v => typeof v === 'number' && isFinite(v);
const r4 = v => Math.round(v * 10000) / 10000;
const noteText = t => (t.notes || []).map(n => n.t === 'boost' ? `${n.m < 1 ? 'weakened' : 'intensified'} ${n.w} ×${n.m.toFixed(2)}` : n.t === 'neg' ? `negated ${n.w}` : n.t === 'caps' ? 'ALL CAPS ×1.2' : n.t === 'text' ? n.s : n.w < 1 ? 'before contrast ×0.5' : 'after contrast ×1.5').join(' · ');

/* offsets in files are Unicode code points (= Python str indices); JS strings index UTF-16 units.
   cpMap(text)[i] is the UTF-16 index of code point i (length = code points + 1). */
const cpMap = text => { const m = [0]; let u = 0; for (const ch of text) { u += ch.length; m.push(u); } return m; };
const cpLen = s => { let n = 0; for (const _ of s) n++; return n; };
const fold = s => s.normalize('NFC').toLowerCase();
/* first occurrence of needle (case-insensitive) at or after `from` that does not overlap a claimed span;
   if none, retry from the start of the sentence (so unordered keyword lists still work) */
function findFree(text, needle, from, claimed) {
  const lt = text.toLowerCase(), ln = needle.toLowerCase();
  const [hay, nd] = lt.length === text.length && ln.length === needle.length ? [lt, ln] : [text, needle];
  const free = (a, b) => claimed.every(c => b <= c.a || a >= c.b);
  for (const start of from > 0 ? [from, 0] : [0]) {
    for (let i = hay.indexOf(nd, start); i >= 0; i = hay.indexOf(nd, i + 1)) if (free(i, i + nd.length)) return i;
  }
  return -1;
}
/* center: a number (all levels) or {word, sentence, paragraph}; missing levels are 0 */
function readCenter(c) {
  const out = { word: 0, sent: 0, para: 0 };
  if (isNum(c)) out.word = out.sent = out.para = c;
  else if (c && typeof c === 'object') { if (isNum(c.word)) out.word = c.word; if (isNum(c.sentence)) out.sent = c.sentence; if (isNum(c.paragraph)) out.para = c.paragraph; }
  return out;
}

function docFromScored(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('File content is not valid scored data (format: docs/FORMAT.md)');
  if (!Array.isArray(obj.paragraphs) || !obj.paragraphs.length) throw new Error('Missing paragraphs array (format: docs/FORMAT.md)');
  const center = readCenter(obj.center), adjW = v => v - center.word, adjS = v => v - center.sent, adjP = v => v - center.para;
  const warn = { unmatched: 0, misaligned: 0, bad: obj._bad || 0, skipped: 0 };
  const doc = { title: String(obj.title || 'Untitled document'), blocks: [], sents: [], words: [], warn, ref: null, center };
  let sid = 0, wid = 0;
  obj.paragraphs.forEach(p => {
    let sentsIn = p && Array.isArray(p.sentences) && p.sentences.length ? p.sentences : null;
    if (!sentsIn && p && typeof p.text === 'string' && p.text.trim()) sentsIn = splitSentences(p.text.trim());
    /* no sentences and no text: nothing to show (a paragraph score alone is skipped and counted) */
    if (!sentsIn || !sentsIn.length) { warn.skipped++; return; }
    const bi = doc.blocks.length;
    const blk = { id: bi, type: p.type === 'h' ? 'h' : 'p', sents: [], score: 0, k: 0, derived: false };
    if (blk.type === 'h') blk.level = Number(p.level) >= 2 ? 2 : 1;   /* optional paragraphs[].level; anything else defaults to 1 */
    sentsIn.forEach((s, si) => {
      const text = String(typeof s === 'string' ? s : (s && s.text != null ? s.text : ''));
      if (!text.trim()) { warn.bad++; return; }
      const wordsIn = s && Array.isArray(s.words) ? s.words : [];
      const m = cpMap(text), ncp = m.length - 1, items = [], claimed = [];
      for (const w of wordsIn) {
        if (!w || typeof w.text !== 'string' || !isNum(w.score)) { warn.unmatched++; continue; }
        const needle = w.text.replace(/^##/, '');           /* WordPiece-style subword marker */
        if (!needle) { warn.unmatched++; continue; }
        const hasOff = w.start != null || w.end != null;
        let a = -1, b = -1;
        if (Number.isInteger(w.start) && Number.isInteger(w.end) && w.start >= 0 && w.end <= ncp && w.start < w.end) {
          const ua = m[w.start], ub = m[w.end];
          if (fold(text.slice(ua, ub)) === fold(needle)) { a = ua; b = ub; claimed.push({ a, b }); }
        }
        items.push({ w, needle, hasOff, a, b });
      }
      const spans = []; let cursor = 0;
      for (const it of items) {
        if (it.a < 0) {
          const i = findFree(text, it.needle, cursor, claimed);
          if (i < 0) { warn.unmatched++; continue; }
          if (it.hasOff) warn.misaligned++;             /* offsets given but pointed at other text: relocated by search */
          it.a = i; it.b = i + it.needle.length; claimed.push({ a: it.a, b: it.b });
        }
        cursor = it.b;
        spans.push({ a: it.a, b: it.b, score: adjW(it.w.score), note: typeof it.w.note === 'string' && it.w.note ? it.w.note : null });
      }
      spans.sort((x, y) => x.a - y.a);
      const toks = []; let pos = 0;
      for (const sp of spans) {
        if (sp.a < pos) { warn.unmatched++; continue; }
        if (sp.a > pos) toks.push({ text: text.slice(pos, sp.a), word: false });
        toks.push({ text: text.slice(sp.a, sp.b), word: true, score: sp.score, notes: sp.note ? [{ t: 'text', s: sp.note }] : [] });
        pos = sp.b;
      }
      if (pos < text.length) toks.push({ text: text.slice(pos), word: false });
      const scored = toks.filter(t => t.word && t.score);
      let score, derived = false;
      if (s && isNum(s.score)) score = adjS(s.score);
      else { const S = scored.reduce((x, t) => x + t.score, 0); score = S / Math.sqrt(S * S + 15); derived = true; }
      const last = si === sentsIn.length - 1;
      const gap = s && typeof s.gap === 'string' ? s.gap : (last || CJK_RE.test(text.slice(-1)) || /[。！？]$/.test(text) ? '' : ' ');
      const a = { text, toks, scored, score, raw: score, derived, lc: text.toLowerCase(), gap, id: sid++, block: bi, k: 0 };
      a.wt = rawTokens(text); a.norm = new Set();
      for (const t of a.wt) if (t.word) { t.lower = t.text.toLowerCase().replace(/[’‘]/g, "'"); t.info = lookup(t.lower); a.norm.add(normWord(t.text)); }
      for (const t of scored) { t.wid = wid++; doc.words.push(t); }
      blk.sents.push(a); doc.sents.push(a);
    });
    if (!blk.sents.length) { warn.skipped++; return; }
    if (isNum(p.score)) blk.score = adjP(p.score);
    else { blk.score = blk.sents.reduce((x, s) => x + s.score, 0) / blk.sents.length; blk.derived = true; }
    doc.blocks.push(blk);
  });
  if (!doc.sents.length) throw new Error('The file has no sentences to display');
  const R = obj.reference;
  if (R && Array.isArray(R.scores)) {
    const sc = R.scores.filter(isNum).map(adjW).filter(v => v !== 0).sort((x, y) => x - y);
    if (sc.length >= 5) doc.ref = { name: String(R.name || 'reference vocabulary'), scores: sc,
      examples: (Array.isArray(R.examples) ? R.examples : []).filter(e => e && typeof e.text === 'string' && isNum(e.score)).map(e => ({ text: e.text, score: adjW(e.score) })) };
  }
  const sc = obj.scale;
  const pick = key => (isNum(sc) && sc > 0) ? sc : (sc && isNum(sc[key]) && sc[key] > 0 ? sc[key] : 0);
  const auto = arr => { const a = arr.map(Math.abs).filter(v => v > 0).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] : 0; };
  const cap = {}, capSrc = {};
  [['word', 'word', () => doc.words.map(t => t.score)], ['sent', 'sentence', () => doc.sents.map(s => s.score)], ['para', 'paragraph', () => doc.blocks.map(b => b.score)]].forEach(([lv, key, vals]) => {
    const f = pick(key), au = f ? 0 : auto(vals());
    cap[lv] = f || au || CAP[lv]; capSrc[lv] = f ? 'file' : au ? 'auto' : 'default';
  });
  doc.cap = cap; doc.capSrc = capSrc;
  doc.mixedSent = doc.sents.some(s => s.derived) && doc.sents.some(s => !s.derived);
  doc.words.forEach(t => { t.k = strength('word', t.score, cap); });
  doc.sents.forEach(s => { s.k = strength('sent', s.score, cap); });
  doc.blocks.forEach(b => { b.k = strength('para', b.score, cap); });
  setHas(doc);
  return doc;
}
/* Export writes every score on the file's own scale: the centre is added back and written as `center`,
   so export -> import gives the same scores, colour scale and spectrum. Word offsets are code points. */
const docCenter = doc => doc.center || { word: 0, sent: 0, para: 0 };
function docToJSON(doc) {
  const c = docCenter(doc), out = { version: 1, title: doc.title };
  if (c.word || c.sent || c.para) out.center = c.word === c.sent && c.sent === c.para ? c.word : { word: c.word, sentence: c.sent, paragraph: c.para };
  const cap = doc.cap || CAP;
  out.scale = { word: r4(cap.word), sentence: r4(cap.sent), paragraph: r4(cap.para) };
  if (doc.ref) out.reference = { name: doc.ref.name, scores: doc.ref.scores.map(v => r4(v + c.word)),
    examples: (doc.ref.examples || []).filter(e => isNum(e.score)).map(e => ({ text: e.text, score: r4(e.score + c.word) })) };
  out.paragraphs = doc.blocks.map(b => ({
    type: b.type, ...(b.type === 'h' && b.level === 2 ? { level: 2 } : {}), score: r4(b.score + c.para),
    sentences: b.sents.map(s => {
      let off = 0; const words = [];
      for (const t of s.toks) {
        const n = cpLen(t.text);
        if (t.word && t.score) { const w = { text: t.text, score: r4(t.score + c.word), start: off, end: off + n }; const nt = noteText(t); if (nt) w.note = nt; words.push(w); }
        off += n;
      }
      return { text: s.text, score: r4(s.score + c.sent), words };
    }) }));
  return out;
}
function docToCSV(doc) {
  const c = docCenter(doc);
  const q = v => { v = String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = [['level', 'paragraph', 'sentence', 'text', 'score', 'type', 'start', 'end', 'note']];
  doc.blocks.forEach((b, bi) => {
    rows.push(['paragraph', bi, '', '', r4(b.score + c.para), b.type, '', '', '']);
    b.sents.forEach((s, si) => {
      rows.push(['sentence', bi, si, s.text, r4(s.score + c.sent), '', '', '', '']);
      let off = 0;
      for (const t of s.toks) { const n = cpLen(t.text); if (t.word && t.score) rows.push(['word', bi, si, t.text, r4(t.score + c.word), '', off, off + n, noteText(t)]); off += n; }
    });
  });
  return rows.map(r => r.map(q).join(',')).join('\n') + '\n';
}
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], f = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else quoted = false; }
      else if (c === '\r') { if (text[i + 1] === '\n') i++; f += '\n'; }   /* \r\n or \r inside a quoted field -> \n */
      else f += c;
    }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function csvToScored(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The CSV has no data rows');
  const head = rows[0].map(h => h.trim().toLowerCase());
  for (const need of ['level', 'paragraph', 'sentence', 'text', 'score']) if (head.indexOf(need) < 0) throw new Error(`CSV missing column: ${need} (format: docs/FORMAT.md)`);
  const get = (r, n) => { const i = head.indexOf(n); return i < 0 ? undefined : r[i]; };
  const num = v => { if (v === undefined || String(v).trim() === '') return undefined; const n = Number(v); return isFinite(n) ? n : undefined; };
  const P = new Map(); let bad = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], lv = String(get(r, 'level') || '').trim().toLowerCase(), pi = num(get(r, 'paragraph'));
    if (pi === undefined) { bad++; continue; }
    let p = P.get(pi); if (!p) { p = { type: 'p', sents: new Map() }; P.set(pi, p); }
    if (lv === 'paragraph') {
      const sc = num(get(r, 'score')); if (sc !== undefined) p.score = sc;
      if (String(get(r, 'type') || '').trim() === 'h') p.type = 'h';
      const tx = get(r, 'text'); if (tx) p.text = tx;
      continue;
    }
    const si = num(get(r, 'sentence')); if (si === undefined) { bad++; continue; }
    let s = p.sents.get(si); if (!s) { s = { words: [] }; p.sents.set(si, s); }
    if (lv === 'sentence') {
      const tx = get(r, 'text') || '';
      if (!tx.trim()) { bad++; continue; }                 /* a sentence row needs its text */
      s.text = tx; const sc = num(get(r, 'score')); if (sc !== undefined) s.score = sc;
    }
    else if (lv === 'word') {
      const sc = num(get(r, 'score')); if (sc === undefined) { bad++; continue; }
      const w = { text: get(r, 'text') || '', score: sc }, a = num(get(r, 'start')), b = num(get(r, 'end'));
      if (a !== undefined && b !== undefined) { w.start = a; w.end = b; }
      const nt = get(r, 'note'); if (nt) w.note = nt;
      s.words.push(w);
    } else bad++;
  }
  const paragraphs = [...P.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => {
    const sentences = [];
    for (const [, s] of [...p.sents.entries()].sort((a, b) => a[0] - b[0])) {
      if (s.text === undefined) { bad += s.words.length; continue; }   /* word rows whose sentence row is missing or empty */
      sentences.push(s);
    }
    const o = { type: p.type };
    if (p.score !== undefined) o.score = p.score;
    if (p.text) o.text = p.text;
    if (sentences.length) o.sentences = sentences;                       /* else docFromScored splits o.text */
    return o;
  });
  return { version: 1, title: '', paragraphs, _bad: bad };
}

/* ---------- spectrum: where this doc's sentiment words sit among a reference vocabulary ---------- */
function lowerBound(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
function upperBound(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; } return lo; }
const NICE = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
function niceMax(v) { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; for (const n of NICE) if (n >= f - 1e-9) return n * p; return 10 * p; }
function buildSpec(doc, bins = 24) {
  const words = doc.words, own = !doc.ref;
  const docScores = words.map(t => t.score);
  if (!docScores.length) return null;
  const refScores = own ? docScores.slice().sort((a, b) => a - b) : doc.ref.scores, n = refScores.length;
  let M = 0; for (const v of refScores) M = Math.max(M, Math.abs(v)); for (const v of docScores) M = Math.max(M, Math.abs(v));
  M = niceMax(M);
  const hist = arr => { const h = new Array(bins).fill(0); for (const v of arr) h[Math.max(0, Math.min(bins - 1, Math.floor((v + M) / (2 * M) * bins)))]++; return h; };
  /* share = (reference words on the same side of zero that are at least as extreme as v) / (ALL n reference words).
     Shown as "most positive X%": X% of the whole vocabulary is this positive or more. */
  const share = v => Math.min(1, Math.max((v > 0 ? n - lowerBound(refScores, v) : upperBound(refScores, v)) / n, 1 / n));
  /* group by (word, sign) so "good" and a negated "not good" stay separate entries */
  const g = new Map();
  for (const t of words) { const lw = t.text.toLowerCase(), k = lw + '\u0000' + Math.sign(t.score); let e = g.get(k); if (!e) { e = { text: lw, n: 0, sum: 0, best: t }; g.set(k, e); } e.n++; e.sum += t.score; if (Math.abs(t.score) > Math.abs(e.best.score)) e.best = t; }
  const items = [...g.values()].map(e => { const mean = e.sum / e.n; return { text: e.text, n: e.n, score: mean, wid: e.best.wid, share: share(mean) }; });
  const mean = docScores.reduce((x, y) => x + y, 0) / docScores.length;
  /* the reference must be on the same scale as the doc's word scores; flag a big mismatch */
  let docMax = 0, refMax = 0; for (const v of docScores) docMax = Math.max(docMax, Math.abs(v)); if (!own) for (const v of refScores) refMax = Math.max(refMax, Math.abs(v));
  const scaleRatio = !own && refMax > 0 ? docMax / refMax : 1;
  return { own, M, bins, docMax, refMax, scaleRatio, scaleWarn: scaleRatio < 0.25 || scaleRatio > 4, refHist: hist(refScores), docHist: hist(docScores), refN: n, docN: docScores.length,
    nPos: docScores.filter(v => v > 0).length, nNeg: docScores.filter(v => v < 0).length, mean,
    refMean: own ? null : refScores.reduce((x, y) => x + y, 0) / n,
    pos: items.filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.n - a.n).slice(0, 6),
    neg: items.filter(x => x.score < 0).sort((a, b) => a.score - b.score || b.n - a.n).slice(0, 6),
    anchors: own ? [] : (doc.ref.examples || []), refName: own ? '' : doc.ref.name };
}
/* the colour scale in use: |score| at which the marker is darkest, and where that number came from */
const CAP_SRC = { file: 'From file', auto: 'Auto: 90th percentile of non-zero |scores|', default: 'Default value', builtin: 'Built-in dictionary' };
function scaleText(doc) {
  const cap = doc.cap || CAP, src = doc.capSrc || {}, has = doc.has || { word: true, sent: true, para: true };
  const lv = [['word', 'Word'], ['sent', 'Sentence'], ['para', 'Paragraph']].filter(([k]) => has[k]);
  if (!lv.length) return '';
  const same = lv.every(([k]) => src[k] === src[lv[0][0]]);
  const parts = lv.map(([k, n]) => `${n} <b>±${+cap[k].toPrecision(3)}</b>${same ? '' : '（' + (CAP_SRC[src[k]] || '?') + '）'}`);
  return 'Colour scale ' + parts.join(' · ') + (same ? ' (' + (CAP_SRC[src[lv[0][0]]] || '?') + ')' : '');
}
const rankText = (it, own) => (it.score > 0 ? 'most positive ' : 'most negative ') + Math.max(1, Math.round(it.share * 100)) + '%' + (own ? ' here' : '');
const SMCore = { splitSentences, analyzeSentence, buildDoc, extractTopics, makeTopic, matches, parseMarkdown, parseText, itemsToLines, linesToBlocks, strength, CAP, docFromScored, docToJSON, docToCSV, parseCSV, csvToScored, buildSpec, rankText, noteText, scaleText, sectionScores, outlineWorthy,
  sectionSpans, topicScores, sectionTopicScores, sentValue, NEUTRAL_K, normWord, rawTokens };
if (typeof module !== 'undefined' && module.exports) module.exports = SMCore;
if (typeof window !== 'undefined') window.SMCore = SMCore;
//</core>
})();
