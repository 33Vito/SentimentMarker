#!/usr/bin/env node
'use strict';
/**
 * "Bring your own scores" Node.js template: read a text or Markdown file, score words/sentences/paragraphs
 * using your own model, lexicon, or API call, and emit SentimentMarker JSON or CSV (docs/FORMAT.md).
 *
 *   node examples/score-external.js examples/launch-week.md -o my-launch-week.scored.json
 *   node examples/score-external.js examples/launch-week.md --csv -o my-launch-week.scored.csv
 *   node examples/score-external.js notes.md --lexicon my_zh.json
 *
 * Swap `scoreWord` / `scoreSentence` / `scoreParagraph` for your own model or `fetch()` API call
 * (everything else — paragraph/sentence splitting, code-point offsets, JSON/CSV layout — stays as is).
 * Offsets (`start` / `end`) are emitted in Unicode code points, as docs/FORMAT.md specifies.
 */
const fs = require('node:fs');
const path = require('node:path');
const { analyzeSentence, parseMarkdown, splitSentences } = require('../sentiment-core.js');

const WORD = /[A-Za-z][A-Za-z'’\-]*/g;
const CJK = /[㐀-鿿豈-﫿]/;
const CJK_RUN = /[㐀-鿿豈-﫿]+/g;

// Starter lexicon hook: defaults to the built-in General words as a stand-in for an external dictionary.
// Replace `scoreWord`, `scoreSentence`, and `scoreParagraph` with your own model or API.
function scoreWord(token, lexicon) {
  const lw = token.toLowerCase();
  if (lexicon && lw in lexicon) return lexicon[lw];
  const r = analyzeSentence(token, 'general');
  return r.scored.length ? r.scored[0].base : 0;
}

function scoreSentence(text) {
  if (CJK.test(text) && !/[A-Za-z]/.test(text)) return null;
  return analyzeSentence(text, 'general').score;
}

function scoreParagraph(sentScores) {
  const xs = sentScores.filter(s => typeof s === 'number' && Number.isFinite(s));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function cjkWords(sentence, lexicon) {
  if (!lexicon) return [];
  const entries = Object.keys(lexicon);
  const maxLen = entries.reduce((m, w) => Math.max(m, [...w].length), 0);
  if (!maxLen) return [];
  const out = [];
  const cps = [...sentence];
  const cpAt = utf16OffsetMap(sentence);
  let m;
  CJK_RUN.lastIndex = 0;
  while ((m = CJK_RUN.exec(sentence))) {
    const startCp = cpAt[m.index];
    const endCp = cpAt[m.index + m[0].length];
    let i = startCp;
    while (i < endCp) {
      let matched = false;
      for (let L = Math.min(maxLen, endCp - i); L > 0; L--) {
        const w = cps.slice(i, i + L).join('');
        if (w in lexicon) {
          out.push([i, i + L, w, lexicon[w]]);
          i += L;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
  }
  return out;
}

function utf16OffsetMap(text) {
  const map = new Int32Array(text.length + 1);
  let cp = 0;
  for (let u = 0; u < text.length;) {
    map[u] = cp;
    const c = text.charCodeAt(u);
    const step = (c >= 0xd800 && c <= 0xdbff && u + 1 < text.length && (text.charCodeAt(u + 1) & 0xfc00) === 0xdc00) ? 2 : 1;
    if (step === 2) map[u + 1] = cp;
    u += step;
    cp++;
  }
  map[text.length] = cp;
  return map;
}

function loadLexicon(lexPath) {
  if (!lexPath) return null;
  const raw = fs.readFileSync(lexPath, 'utf8');
  if (lexPath.endsWith('.json')) {
    const obj = JSON.parse(raw);
    const out = Object.create(null);
    for (const [k, v] of Object.entries(obj)) out[String(k).toLowerCase()] = Number(v);
    return out;
  }
  const out = Object.create(null);
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length >= 2 && parts[0]) {
      const n = Number(parts[1]);
      if (Number.isFinite(n)) out[parts[0].toLowerCase()] = n;
    }
  }
  return out;
}

const r4 = x => Math.round(x * 10000) / 10000;

function build(inputPath, lexicon = null) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const blocks = parseMarkdown(raw);
  const paragraphs = blocks.map(b => {
    const sentsRaw = b.type === 'h' ? [b.text] : splitSentences(b.text).map(s => s.text);
    const sentences = sentsRaw.map(s => {
      const cpAt = utf16OffsetMap(s);
      const words = [];
      let m;
      WORD.lastIndex = 0;
      while ((m = WORD.exec(s))) {
        const v = scoreWord(m[0], lexicon);
        if (v) words.push({ text: m[0], score: r4(v), start: cpAt[m.index], end: cpAt[m.index + m[0].length] });
      }
      for (const [a, e, w, v] of cjkWords(s, lexicon)) {
        if (v) words.push({ text: w, score: r4(v), start: a, end: e });
      }
      words.sort((x, y) => x.start - y.start);
      const sent = { text: s };
      const sc = scoreSentence(s);
      if (sc !== null && Number.isFinite(sc)) sent.score = r4(sc);
      sent.words = words;
      return sent;
    });
    const para = { type: b.type };
    if (b.type === 'h' && b.level >= 2) para.level = 2;
    const ps = scoreParagraph(sentences.map(s => s.score));
    if (ps !== null) para.score = r4(ps);
    para.sentences = sentences;
    return para;
  });
  return {
    version: 1,
    title: path.basename(inputPath, path.extname(inputPath)),
    scale: { word: 3.0, sentence: 0.6, paragraph: 0.3 },
    paragraphs,
  };
}

function toCSV(doc) {
  const blank = v => (v === undefined || v === null ? '' : String(v));
  const q = v => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [['level', 'paragraph', 'sentence', 'text', 'score', 'type', 'start', 'end', 'note']];
  doc.paragraphs.forEach((p, pi) => {
    rows.push(['paragraph', String(pi), '', '', blank(p.score), p.type, '', '', '']);
    p.sentences.forEach((s, si) => {
      rows.push(['sentence', String(pi), String(si), s.text, blank(s.score), '', '', '', '']);
      for (const w of s.words) {
        rows.push(['word', String(pi), String(si), w.text, String(w.score), '', String(w.start), String(w.end), '']);
      }
    });
  });
  return rows.map(r => r.map(q).join(',')).join('\n') + '\n';
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    let input = null;
    let out = null;
    let csv = false;
    let lexPath = null;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '-h' || arg === '--help') {
        console.log('Usage: node examples/score-external.js <input> [-o|--out OUT] [--csv] [--lexicon PATH]');
        process.exit(0);
      } else if (arg === '-o' || arg === '--out') out = argv[++i];
      else if (arg === '--csv') csv = true;
      else if (arg === '--lexicon') lexPath = argv[++i];
      else if (!arg.startsWith('-') && !input) input = arg;
      else throw new Error(`unexpected argument: ${arg}`);
    }
    if (!input) throw new Error('missing input path');
    const doc = build(input, loadLexicon(lexPath));
    const dest = out || input.replace(/\.[^.]+$/, '') + '.scored.' + (csv ? 'csv' : 'json');
    const content = csv
      ? toCSV(doc)
      : JSON.stringify(doc, null, 1).replace(/\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]/g, (_, inner) => '[' + inner.replace(/\s+/g, '') + ']');
    fs.writeFileSync(dest, content, 'utf8');
    const n = doc.paragraphs.reduce((sum, p) => sum + p.sentences.reduce((s2, s) => s2 + s.words.length, 0), 0);
    console.log(`wrote ${dest}: ${doc.paragraphs.length} paragraphs, ${n} scored words`);
  } catch (e) {
    process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  }
}

module.exports = { scoreWord, scoreSentence, scoreParagraph, build, toCSV, loadLexicon };
