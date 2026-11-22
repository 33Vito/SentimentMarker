#!/usr/bin/env node
'use strict';
/**
 * (Re)build the finance vocabulary in data/sentiment-model.json from upstream word lists.
 *
 *   node tools/build-finance-vocab.js --lm path/to/LM.csv --vader path/to/vader_lexicon.txt
 *   node tools/build-finance-vocab.js --check --lm path/to/LM.csv --vader path/to/vader_lexicon.txt
 *
 * Also reads LM_CSV and VADER_LEXICON environment variables when flags are omitted.
 *
 * How the word list is built (an example, not a validated model):
 *   * Loughran-McDonald decides polarity: a word counts only if LM marks it Negative or Positive (not both).
 *   * VADER supplies the strength when it agrees on sign; otherwise +-1.5.
 *   * VADER-only words are kept only when strongly polarised (|score| >= 2.5) and purely alphabetic.
 *
 * Licence: Loughran-McDonald is free for non-commercial / academic use only; commercial use requires a
 * licence from its authors (https://sraf.nd.edu/loughranmcdonald-master-dictionary/). VADER is MIT-licensed.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseCSV } = require('../sentiment-core.js');
const { canonical, build: buildAssets } = require('./build-lexicon.js');

const ROOT = path.join(__dirname, '..');
const MODEL_PATH = path.join(ROOT, 'data', 'sentiment-model.json');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseLM(lmPath) {
  const rows = parseCSV(fs.readFileSync(lmPath, 'utf8'));
  if (rows.length < 2) throw new Error('LM.csv has no rows');
  const head = rows[0].map(h => h.trim());
  const wi = head.indexOf('Word');
  const ni = head.indexOf('Negative');
  const pi = head.indexOf('Positive');
  if (wi < 0 || ni < 0 || pi < 0) throw new Error('LM.csv missing Word, Negative, or Positive column');
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[wi]) continue;
    const neg = r[ni] !== '0' && r[ni] !== '';
    const pos = r[pi] !== '0' && r[pi] !== '';
    if (neg === pos) continue;
    out.push([r[wi].toLowerCase(), pos ? 1 : -1]);
  }
  return out;
}

function parseVader(vaderPath) {
  const vader = new Map();
  const lines = fs.readFileSync(vaderPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const score = Number(parts[1]);
    if (Number.isFinite(score)) vader.set(parts[0], score);
  }
  return vader;
}

function buildLexicon(lmPath, vaderPath) {
  const vader = parseVader(vaderPath);
  const lex = {};
  const setWord = (w, score) => Object.defineProperty(lex, w, {
    value: score,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  for (const [w, sign] of parseLM(lmPath)) {
    const v = vader.get(w);
    setWord(w, v !== undefined && (v > 0) === (sign > 0) && v !== 0 ? v : 1.5 * sign);
  }
  for (const [w, v] of vader) {
    if (!Object.hasOwn(lex, w) && Math.abs(v) >= 2.5 && /^\p{L}+$/u.test(w)) {
      setWord(w, v);
    }
  }
  return lex;
}

function upstreamInfo(lmPath, vaderPath, opts = {}) {
  return {
    loughranMcDonald: {
      name: 'Loughran-McDonald Master Dictionary',
      version: opts.lmVersion || 'Loughran-McDonald Master Dictionary CSV',
      file: opts.lmFile || path.basename(lmPath),
      sha256: sha256File(lmPath),
      url: 'https://sraf.nd.edu/loughranmcdonald-master-dictionary/',
      licence: 'Free for non-commercial / academic use only; commercial use requires a licence from the authors (Tim Loughran and Bill McDonald).',
      role: 'polarity (Negative / Positive columns)',
    },
    vader: {
      name: 'VADER sentiment lexicon',
      version: opts.vaderVersion || 'VADER sentiment lexicon',
      file: opts.vaderFile || path.basename(vaderPath),
      sha256: sha256File(vaderPath),
      url: 'https://github.com/cjhutto/vaderSentiment',
      licence: 'MIT',
      role: 'strength (mean valence)',
    },
  };
}

function staleReasons(lmPath, vaderPath, model = null) {
  const m = model || JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
  const out = [];
  const want = buildLexicon(lmPath, vaderPath);
  const have = m.vocabularies.finance.words;
  const wantKeys = Object.keys(want).sort();
  const haveKeys = Object.keys(have).sort();
  const diff = [];
  const seen = new Set([...wantKeys, ...haveKeys]);
  for (const w of seen) {
    if (have[w] !== want[w]) diff.push(w);
  }
  if (diff.length) {
    diff.sort();
    out.push(`finance words differ (${haveKeys.length} in the model, ${wantKeys.length} rebuilt; e.g. ${JSON.stringify(diff.slice(0, 5))})`);
  }
  const up = (m.sources && m.sources.upstream) || {};
  for (const [k, v] of Object.entries(upstreamInfo(lmPath, vaderPath))) {
    if (!up[k] || up[k].sha256 !== v.sha256) out.push(`sources.upstream.${k}.sha256 is stale`);
  }
  return out;
}

function parseArgs(argv) {
  const opts = {
    check: false,
    lm: process.env.LM_CSV || null,
    vader: process.env.VADER_LEXICON || null,
    help: false,
  };
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
    const nextPath = () => {
      let val;
      if (hasInline) {
        val = inlineVal;
      } else {
        if (i + 1 >= argv.length) throw new Error(`missing value for ${flag}`);
        val = argv[++i];
        if (val.startsWith('-')) {
          throw new Error(`missing value for ${flag} (got ${JSON.stringify(val)}; pass ${flag}=${val} for a literal dash-prefixed path)`);
        }
      }
      if (val === '') throw new Error(`empty value for ${flag}`);
      return val;
    };
    const noValue = () => {
      if (hasInline) throw new Error(`option ${flag} does not take a value`);
    };
    if (flag === '-h' || flag === '--help') { noValue(); opts.help = true; }
    else if (flag === '--check') { noValue(); opts.check = true; }
    else if (flag === '--lm') opts.lm = nextPath();
    else if (flag === '--vader') opts.vader = nextPath();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log('Usage: node tools/build-finance-vocab.js [--check] --lm <LM.csv> --vader <vader_lexicon.txt>');
      process.exit(0);
    }
    if (!opts.lm || !opts.vader) {
      throw new Error('Provide upstream lexicon paths via --lm <LM.csv> --vader <vader_lexicon.txt> (or LM_CSV / VADER_LEXICON env vars)');
    }
    if (opts.check) {
      const bad = staleReasons(opts.lm, opts.vader);
      for (const b of bad) process.stderr.write('stale: ' + b + '\n');
      console.log(bad.length ? 'run: node tools/build-finance-vocab.js --lm ... --vader ...' : 'finance vocabulary up to date');
      process.exit(bad.length ? 1 : 0);
    }
    const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
    model.vocabularies.finance = Object.assign({}, model.vocabularies.finance, { words: buildLexicon(opts.lm, opts.vader) });
    model.sources = Object.assign({}, model.sources, {
      upstream: Object.assign({}, (model.sources || {}).upstream, upstreamInfo(opts.lm, opts.vader)),
    });
    canonical(model);
    const out = buildAssets(model);
    for (const [p, text] of out) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text, 'utf8');
      console.log(`wrote ${path.relative(ROOT, p)} (${Buffer.byteLength(text)} bytes)`);
    }
  } catch (e) {
    process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  }
}

module.exports = { buildLexicon, parseLM, parseVader, sha256File, upstreamInfo, staleReasons };
