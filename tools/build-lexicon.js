#!/usr/bin/env node
/* Build the browser lexicon assets from the canonical model, data/sentiment-model.json.

     node tools/build-lexicon.js                       rewrite the model canonically + regenerate the assets
     node tools/build-lexicon.js --check               exit 1 if any of the three files is stale (run by test/core.test.js)
     node tools/build-lexicon.js --import-finance F    replace the finance vocabulary and upstream records with
                                                       F (JSON {words, upstream}; "-" = stdin), then regenerate.
                                                       tools/build_finance_vocab.py calls this.

   Outputs (all deterministic: sorted words and groups, JS number formatting, no timestamps):
     data/sentiment-model.json  canonical form: keys sorted (modelVersion first), negators / contrast words sorted,
                                sources.vocabularies.<name> = word count + sha256 of the canonical content
     sentiment-core.js          the region between //<model> and //</model>: rules, parameters, profile metadata
                                and the general vocabulary, so it is there synchronously when the core loads
     lexicon/<name>.js          every vocabulary with an `asset`: a classic script calling SMCore.registerLexicon,
                                inserted by the page the first time that dictionary is needed (works under file://)

   Canonical vocabulary content (what the sha256 covers): one line "word<TAB>score\n" per entry, words sorted by
   UTF-16 code unit, score written as JavaScript String(number). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MODEL_PATH = path.join(ROOT, 'data', 'sentiment-model.json');
const CORE_PATH = path.join(ROOT, 'sentiment-core.js');
const BEGIN = '//<model>', END = '//</model>';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const fail = msg => { throw new Error(msg); };

/* ---------- canonical JSON: sorted keys (modelVersion first at the top), scalar arrays on one line ---------- */
function sortKeys(o, top) {
  const keys = Object.keys(o).sort(cmp);
  if (top && keys.includes('modelVersion')) keys.splice(keys.indexOf('modelVersion'), 1), keys.unshift('modelVersion');
  return keys;
}
function pretty(v, ind = '', top = true) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const in2 = ind + '  ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(x => x === null || typeof x !== 'object')) return '[' + v.map(x => JSON.stringify(x)).join(', ') + ']';
    return '[\n' + v.map(x => in2 + pretty(x, in2, false)).join(',\n') + '\n' + ind + ']';
  }
  const keys = sortKeys(v, top);
  if (!keys.length) return '{}';
  return '{\n' + keys.map(k => in2 + JSON.stringify(k) + ': ' + pretty(v[k], in2, false)).join(',\n') + '\n' + ind + '}';
}

/* deep copy with object keys sorted (array order kept), so generated code never depends on input key order */
const sorted = v => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(sorted) : Object.fromEntries(sortKeys(v, false).map(k => [k, sorted(v[k])]));

/* ---------- validation + canonical content ---------- */
const isNum = v => typeof v === 'number' && isFinite(v);
function vocabEntries(name, words) {
  if (!words || typeof words !== 'object' || Array.isArray(words)) fail(`vocabularies.${name}.words must be an object {word: score}`);
  const out = Object.keys(words).sort(cmp).map(w => [w, words[w]]);
  for (const [w, v] of out) {
    if (!w || /\s/.test(w)) fail(`vocabularies.${name}: "${w}" is empty or contains whitespace`);
    if (w !== w.toLowerCase()) fail(`vocabularies.${name}: "${w}" must be lower case (the engine lower-cases tokens)`);
    if (!isNum(v) || v === 0) fail(`vocabularies.${name}.${w}: score must be a non-zero number`);
  }
  return out;
}
const vocabContent = entries => entries.map(([w, v]) => w + '\t' + String(v) + '\n').join('');
/* [[score, "w1 w2 …"], …]: highest score first, words sorted inside a group */
function grouped(entries) {
  const g = new Map();
  for (const [w, v] of entries) { if (!g.has(v)) g.set(v, []); g.get(v).push(w); }
  return [...g.keys()].sort((a, b) => b - a).map(v => [v, g.get(v).join(' ')]);
}
const groupLines = groups => '[\n' + groups.map(([v, s]) => '[' + String(v) + ',' + JSON.stringify(s) + ']').join(',\n') + '\n]';

function canonical(model) {
  const m = JSON.parse(JSON.stringify(model));
  if (typeof m.modelVersion !== 'string' || !m.modelVersion) fail('modelVersion must be a non-empty string');
  const P = m.params || fail('params missing');
  if (!Number.isInteger(P.lookBack) || P.lookBack < 1) fail('params.lookBack must be a positive integer');
  if (!Array.isArray(P.booster && P.booster.distanceDecay) || P.booster.distanceDecay.length !== P.lookBack || !P.booster.distanceDecay.every(isNum))
    fail('params.booster.distanceDecay needs one number per look-back position');
  for (const k of ['negation.positiveFactor', 'negation.negativeFactor', 'contrast.before', 'contrast.after', 'caps.factor', 'caps.minLength', 'exclamation.perMark', 'exclamation.maxMarks', 'wordClip', 'sentenceNormAlpha', 'cjkMaxWordLength', 'display.scale.word', 'display.scale.sentence', 'display.scale.paragraph', 'display.neutralShare'])
    if (!isNum(k.split('.').reduce((o, p) => (o == null ? o : o[p]), P))) fail('params.' + k + ' must be a number');
  if (typeof P.negation.suffix !== 'string') fail('params.negation.suffix must be a string');
  const words = (k, a) => { if (!Array.isArray(a) || !a.every(x => typeof x === 'string' && x && !/\s/.test(x))) fail(k + ' must be a list of words'); const s = [...new Set(a)].sort(cmp); if (s.length !== a.length) fail(k + ' has duplicates'); return s; };
  m.negators = words('negators', m.negators);
  m.contrastWords = words('contrastWords', m.contrastWords);
  if (!m.boosters || typeof m.boosters !== 'object' || !Object.values(m.boosters).every(v => isNum(v) && v > 0)) fail('boosters must be {word: multiplier > 0}');
  const V = m.vocabularies || fail('vocabularies missing');
  if (!V.general) fail('vocabularies.general is required (it is the synchronous built-in profile)');
  if (V.general.asset) fail('vocabularies.general cannot have an asset: it is inlined into sentiment-core.js');
  const stats = {};
  for (const [name, voc] of Object.entries(V)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) fail('vocabulary name must be [a-z][a-z0-9-]*: ' + name);
    const sp = voc.suffixPolicy || fail(`vocabularies.${name}.suffixPolicy missing`);
    if (sp.type === 'suffix') {
      if (!Number.isInteger(sp.minStemLength) || !Array.isArray(sp.rules) || !sp.rules.every(r => Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && r[0] && typeof r[1] === 'string'))
        fail(`vocabularies.${name}.suffixPolicy: suffix needs minStemLength and rules [[suffix, replacement], …]`);
      if (typeof sp.skipCJK !== 'boolean') fail(`vocabularies.${name}.suffixPolicy.skipCJK must be true or false`);
    } else if (sp.type !== 'exact') fail(`vocabularies.${name}.suffixPolicy.type must be "suffix" or "exact"`);
    for (const k of ['label', 'referenceName']) if (typeof voc[k] !== 'string' || !voc[k]) fail(`vocabularies.${name}.${k} must be a string`);
    if (!Array.isArray(voc.referenceExamples)) fail(`vocabularies.${name}.referenceExamples must be a list`);
    if (voc.asset != null && (typeof voc.asset !== 'string' || !/^[\w./-]+\.js$/.test(voc.asset) || voc.asset.includes('..'))) fail(`vocabularies.${name}.asset must be a relative .js path`);
    const entries = vocabEntries(name, voc.words);
    voc.words = Object.fromEntries(entries);
    stats[name] = { entries, sha256: sha256(vocabContent(entries)), words: entries.length };
  }
  m.neutralPhrases = (m.neutralPhrases || []).map((ph, i) => {
    if (!Array.isArray(ph.profiles) || !ph.profiles.length || !ph.profiles.every(p => V[p])) fail(`neutralPhrases[${i}].profiles must name vocabularies`);
    if (!Array.isArray(ph.tokens) || ph.tokens.length < 2 || !ph.tokens.every(t => typeof t === 'string' && t && t === t.toLowerCase() && !/\s/.test(t))) fail(`neutralPhrases[${i}].tokens: two or more lower-case words`);
    if (!Array.isArray(ph.neutral) || !ph.neutral.length || !ph.neutral.every(j => Number.isInteger(j) && j >= 0 && j < ph.tokens.length)) fail(`neutralPhrases[${i}].neutral: indexes into tokens`);
    return ph;
  });
  m.sources = m.sources || {};
  m.sources.vocabularies = Object.fromEntries(Object.keys(V).sort(cmp).map(n => [n, Object.assign({}, (m.sources.vocabularies || {})[n], { sha256: stats[n].sha256, words: stats[n].words })]));
  return { model: m, stats };
}

/* ---------- generated outputs ---------- */
function coreRegion(m, stats) {
  const V = m.vocabularies;
  const profiles = {};
  for (const name of Object.keys(V).sort((a, b) => (a === 'general' ? -1 : b === 'general' ? 1 : cmp(a, b)))) {
    const v = V[name], p = { label: v.label, referenceName: v.referenceName, referenceExamples: v.referenceExamples, suffixPolicy: v.suffixPolicy, size: stats[name].words, sha256: stats[name].sha256 };
    if (v.asset) p.asset = v.asset;
    profiles[name] = p;
  }
  const rules = { modelVersion: m.modelVersion, params: m.params, negators: m.negators, boosters: Object.fromEntries(Object.keys(m.boosters).sort(cmp).map(k => [k, m.boosters[k]])),
    contrastWords: m.contrastWords, neutralPhrases: m.neutralPhrases, profiles };
  return BEGIN + ' generated by tools/build-lexicon.js from data/sentiment-model.json - do not edit by hand\n'
    + 'const MODEL = {\n' + Object.entries(rules).map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(k === 'profiles' ? Object.fromEntries(Object.entries(v).map(([n, p]) => [n, sorted(p)])) : sorted(v))).join(',\n') + '\n};\n'
    + 'const GENERAL_WORDS = ' + groupLines(grouped(stats.general.entries)) + ';\n'
    + END;
}
function assetFile(m, name, stats) {
  const v = m.vocabularies[name], src = m.sources || {}, up = src.upstream || {};
  const lines = [
    `Generated by tools/build-lexicon.js from data/sentiment-model.json (model ${m.modelVersion}). Do not edit by hand.`,
    `SentimentMarker "${name}" dictionary: ${stats.words} words, ${v.suffixPolicy.type === 'exact' ? 'exact match only' : 'suffix fallback'}. ${v.description || ''}`.trim(),
    ...Object.keys(up).sort(cmp).map(k => { const u = up[k]; return `Upstream: ${u.name}${u.version ? ' ' + u.version : ''}${u.file ? ' (' + u.file + ', sha256 ' + u.sha256 + ')' : ''}. Licence: ${u.licence || 'see data/sentiment-model.json'}`; }),
    src.licence ? 'Licence note: ' + src.licence : '',
    `Vocabulary sha256 (canonical content): ${stats.sha256}`,
    'Loaded on demand by sentiment-core.js (SMCore.ensureLexicon) as a classic script, so it also works from file://.',
  ].filter(Boolean);
  return '/* ' + lines.join('\n   ').replace(/\*\//g, '* /') + ' */\n'
    + 'SMCore.registerLexicon(' + JSON.stringify(name) + ', {"sha256":' + JSON.stringify(stats.sha256) + ',"words":' + groupLines(grouped(stats.entries)) + '});\n';
}

function build(model) {
  const { model: m, stats } = canonical(model);
  const out = new Map();
  out.set(MODEL_PATH, pretty(m) + '\n');
  const core = fs.readFileSync(CORE_PATH, 'utf8'), a = core.indexOf(BEGIN), b = core.indexOf(END);
  if (a < 0 || b < a) fail(`sentiment-core.js has no ${BEGIN} … ${END} region`);
  out.set(CORE_PATH, core.slice(0, a) + coreRegion(m, stats) + core.slice(b + END.length));
  for (const name of Object.keys(m.vocabularies).sort(cmp)) if (m.vocabularies[name].asset) out.set(path.join(ROOT, m.vocabularies[name].asset), assetFile(m, name, stats[name]));
  return out;
}

function main(argv) {
  const check = argv.includes('--check');
  let model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
  const imp = argv.indexOf('--import-finance');
  if (imp >= 0) {
    if (check) fail('--check and --import-finance do not mix');
    const f = argv[imp + 1] || fail('--import-finance needs a file or -');
    const data = JSON.parse(fs.readFileSync(f === '-' ? 0 : f, 'utf8'));
    if (!data.words || !data.upstream) fail('import file needs {words, upstream}');
    model.vocabularies.finance = Object.assign({}, model.vocabularies.finance, { words: data.words });
    model.sources = Object.assign({}, model.sources, { upstream: Object.assign({}, (model.sources || {}).upstream, data.upstream) });
  }
  const out = build(model);
  const stale = [];
  for (const [p, text] of out) {
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (cur === text) continue;
    stale.push(path.relative(ROOT, p));
    if (!check) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); console.log('wrote ' + path.relative(ROOT, p) + ' (' + Buffer.byteLength(text) + ' bytes)'); }
  }
  if (check && stale.length) { console.error('stale generated files (run node tools/build-lexicon.js): ' + stale.join(', ')); return 1; }
  if (!stale.length) console.log('up to date: ' + [...out.keys()].map(p => path.relative(ROOT, p)).join(', '));
  return 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (e) { console.error('build-lexicon: ' + e.message); process.exit(1); }
}
module.exports = { build, canonical, grouped, vocabContent, pretty };
