#!/usr/bin/env node
'use strict';
/**
 * Score finance prose with the finance dictionary (Loughran-McDonald polarity x VADER strength)
 * and write a SentimentMarker JSON file.
 *
 *   node examples/score-financial.js report.txt
 *   node examples/score-financial.js report.txt --title "RBA Financial Stability Review (Oct 2026), Assessment" -o report.scored.json
 *
 * Runs the same JS engine the page uses (sentiment-core.js via tools/score-cli.js in-process),
 * with the finance profile of data/sentiment-model.json, so a file scored here and the same text
 * pasted into the page with the Finance dictionary get identical scores.
 *
 * Licence: the Loughran-McDonald word list is free for non-commercial / academic use only;
 * commercial use requires a licence from its authors. VADER is MIT-licensed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../tools/score-cli.js');

const PROFILE = 'finance';
const ROOT = path.join(__dirname, '..');
const MODEL = path.join(ROOT, 'data', 'sentiment-model.json');

function profileScale(profile = PROFILE) {
  const scale = JSON.parse(fs.readFileSync(MODEL, 'utf8')).vocabularies[profile].scale;
  const out = {};
  for (const k of ['word', 'sentence', 'paragraph']) {
    if (scale[k] !== 'auto') out[k] = scale[k];
  }
  return out;
}

function parseParagraphs(raw) {
  const out = [];
  for (const rawBlock of String(raw).split(/\n\s*\n/)) {
    const block = rawBlock.trim();
    if (!block) continue;
    if (block.startsWith('## ')) {
      out.push({ type: 'h', level: 2, sentences: [block.slice(3).trim()] });
    } else if (block.startsWith('# ')) {
      out.push({ type: 'h', sentences: [block.slice(2).trim()] });
    } else {
      out.push({ type: 'p', text: block });
    }
  }
  return out;
}

function readParagraphs(filePath) {
  return parseParagraphs(fs.readFileSync(filePath, 'utf8'));
}

function buildFromText(raw, title, profile = PROFILE) {
  const doc = run({ profile, title, paragraphs: parseParagraphs(raw) }).results[0].doc;
  return {
    version: 1,
    title,
    model: doc.model,
    scale: profileScale(profile),
    reference: doc.reference,
    paragraphs: doc.paragraphs,
  };
}

function build(filePath, title, profile = PROFILE) {
  return buildFromText(fs.readFileSync(filePath, 'utf8'), title, profile);
}

function formatScoredJSON(doc) {
  const text = JSON.stringify(doc, null, 1);
  return text.replace(/\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]/g, (_, inner) => '[' + inner.replace(/\s+/g, '') + ']');
}

function scoreFile(inputPath, title, outPath) {
  const docTitle = title || path.basename(inputPath, path.extname(inputPath));
  const dest = outPath || inputPath.replace(/\.[^.]+$/, '') + '.scored.json';
  const doc = build(inputPath, docTitle);
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  fs.writeFileSync(dest, formatScoredJSON(doc), 'utf8');
  const n = doc.paragraphs.reduce((sum, p) => sum + p.sentences.reduce((s2, s) => s2 + s.words.length, 0), 0);
  console.log(`wrote ${dest}: ${doc.paragraphs.length} paragraphs, ${n} scored words, lexicon ${doc.reference.scores.length} words`);
  return doc;
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    let input = null;
    let out = null;
    let title = null;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '-h' || arg === '--help') {
        console.log('Usage: node examples/score-financial.js <input> [-o|--out OUT] [--title TITLE]');
        process.exit(0);
      } else if (arg === '-o' || arg === '--out') {
        out = argv[++i];
      } else if (arg === '--title') {
        title = argv[++i];
      } else if (!arg.startsWith('-') && !input) {
        input = arg;
      } else {
        throw new Error(`unexpected argument: ${arg}`);
      }
    }
    if (!input) throw new Error('missing input path');
    scoreFile(input, title, out);
  } catch (e) {
    process.stderr.write('scoring failed: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  }
}

module.exports = {
  PROFILE,
  profileScale,
  parseParagraphs,
  readParagraphs,
  buildFromText,
  build,
  formatScoredJSON,
  scoreFile,
};
