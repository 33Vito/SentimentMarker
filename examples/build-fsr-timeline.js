#!/usr/bin/env node
'use strict';
/**
 * Build the RBA FSR Diff + Timeline demo from the extracted texts in examples/fsr/.
 *
 *   node examples/build-fsr-timeline.js            # score every edition, then diff them
 *   node examples/build-fsr-timeline.js --check    # rebuild in memory and compare canonical, quantised JSON payloads
 *
 * Runs entirely in-process (one Node process):
 * 1. Reads examples/fsr/fsr-YYYY-MM.txt (+ examples/fsr-2026-10.txt), repairs PDF leftovers in cleanProse().
 * 2. Scores with examples/score-financial.js (Finance dictionary, same JS engine as the page) and attaches
 *    lexicon base and rule notes via tools/score-cli.js.
 * 3. Diffs with tools/sm-diff.js, examples/fsr-topics.json, and examples/fsr/sources.json -> examples/fsr-timeline.diff.js.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { engine, detail } = require('../tools/score-cli.js');
const smDiff = require('../tools/sm-diff.js');
const { buildFromText } = require('./score-financial.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'examples', 'fsr');
const BUILD = path.join(SRC, 'build');
const JS_NAME = 'fsr-timeline.diff.js';
const ATTR = 'Source: Reserve Bank of Australia, Financial Stability Review, March 2024 to October 2026, ' +
  'https://www.rba.gov.au/publications/fsr/. Text reproduced under the Creative Commons Attribution 4.0 International ' +
  'licence (https://creativecommons.org/licenses/by/4.0/). Sentiment scores, topic tags and alignments were added by ' +
  "SentimentMarker and are not the Reserve Bank's. The Reserve Bank does not endorse this project.";
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function cleanProse(text) {
  return String(text)
    .replace(/\u00ad/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(^|[.:;]\s+)y (?=[A-Z])/gm, '$1• ')
    .replace(/and\/ or/g, 'and/or');
}

function editionTexts() {
  const match = name => /^fsr-\d{4}-\d{2}\.txt$/.test(name);
  const earlier = fs.readdirSync(SRC).filter(match).map(f => path.join(SRC, f));
  const latest = fs.readdirSync(path.join(ROOT, 'examples')).filter(match).map(f => path.join(ROOT, 'examples', f));
  const texts = [...earlier, ...latest].sort((a, b) => {
    const ba = path.basename(a), bb = path.basename(b);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  });
  if (texts.length < 2) throw new Error('need at least two examples/fsr/fsr-YYYY-MM.txt files');
  return texts;
}

function attachWordDetail(doc, core) {
  const profile = (doc.model && doc.model.profile) || 'finance';
  const C = core || engine(profile);
  const flat = [];
  for (const p of doc.paragraphs || []) {
    for (const s of p.sentences || []) {
      if (s && typeof s === 'object' && typeof s.text === 'string') flat.push(s);
    }
  }
  if (!flat.length) return doc;
  for (const sent of flat) {
    const d = detail(C, C.analyzeSentence(sent.text, profile));
    const by = new Map();
    for (const w of d.words || []) by.set(`${w.start}:${w.end}`, w);
    for (const w of sent.words || []) {
      const src = by.get(`${w.start}:${w.end}`);
      if (!src) continue;
      if (typeof src.base === 'number' && Number.isFinite(src.base)) w.base = src.base;
      if (typeof src.note === 'string' && src.note) w.note = src.note;
    }
  }
  return doc;
}

function buildPackData({ log = true } = {}) {
  const texts = editionTexts();
  const C = engine('finance');
  const editions = [];
  for (const t of texts) {
    const eid = /(\d{4}-\d{2})/.exec(path.basename(t))[1];
    const [y, m] = eid.split('-');
    if (log) console.log(`scoring ${eid}`);
    const cleaned = cleanProse(fs.readFileSync(t, 'utf8'));
    const title = `RBA Financial Stability Review (${MONTHS[Number(m) - 1]} ${y})`;
    const doc = attachWordDetail(buildFromText(cleaned, title, 'finance'), C);
    editions.push([eid, doc]);
  }
  const topics = smDiff.loadTopics(path.join(ROOT, 'examples', 'fsr-topics.json'));
  const sources = JSON.parse(fs.readFileSync(path.join(SRC, 'sources.json'), 'utf8'));
  const firstYear = /(\d{4})/.exec(path.basename(texts[0]))[1];
  const lastYear = /(\d{4})/.exec(path.basename(texts[texts.length - 1]))[1];
  return smDiff.build(editions, topics, {
    title: `RBA Financial Stability Review, ${firstYear}–${lastYear}`,
    sources,
  });
}

function sortKeysDeep(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
  return out;
}

function canonicalPayload(script) {
  const m = /window\.DIFF_FILES\["fsr-timeline\.diff\.json"\]\s*=\s*(\{[\s\S]*\})\s*;\s*$/.exec(script);
  if (!m) throw new Error('missing fsr-timeline.diff.json assignment');
  const payload = sortKeysDeep(JSON.parse(m[1]));
  for (const edition of payload.editions) {
    for (const stats of Object.values(edition.stats)) {
      if (stats.mean !== null) stats.mean = smDiff.roundFracInt(smDiff.floatToFrac(stats.mean), 4);
    }
  }
  for (const diff of payload.diffs) {
    for (const group of Object.values(diff.groups)) {
      for (const key of ['delta', 'edit', 'added', 'removed']) {
        if (group[key] !== null) group[key] = smDiff.roundFracInt(smDiff.floatToFrac(group[key]), 5);
      }
    }
  }
  return payload;
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const committed = path.join(ROOT, 'examples', JS_NAME);
  if (check) {
    const res = buildPackData();
    const got = smDiff.formatJsWrapper(JSON.stringify(res), 'fsr-timeline.diff.json', ATTR);
    const have = fs.readFileSync(committed, 'utf8');
    try {
      assert.deepStrictEqual(canonicalPayload(got), canonicalPayload(have));
    } catch {
      console.error('examples/fsr-timeline.diff.js is stale; run node examples/build-fsr-timeline.js');
      process.exit(1);
    }
    console.log('examples/fsr-timeline.diff.js matches the rebuild');
    return;
  }
  const res = buildPackData();
  fs.mkdirSync(BUILD, { recursive: true });
  smDiff.write(res, path.join(BUILD, 'fsr-timeline.diff.json'), committed, ATTR);
  console.log(`wrote ${committed} (${fs.statSync(committed).size} bytes)`);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write((e && e.stack ? e.stack : String(e)) + '\n');
    process.exit(1);
  }
}

module.exports = { cleanProse, attachWordDetail, buildPackData, canonicalPayload };
