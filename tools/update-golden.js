#!/usr/bin/env node
/* Refill test/golden.json's `expected` from the JS engine and print every case whose expectation changed.
   Only run this after a deliberate model / engine change, and review the printed diff: the golden file is what
   test/core.test.js (JS direct) and test/test_golden.py (Python -> Node batch) both hold the engine to.
     node tools/update-golden.js            rewrite test/golden.json
     node tools/update-golden.js --dry      print the changes only */
'use strict';
const fs = require('fs');
const path = require('path');
const { engine } = require('./score-cli.js');

const FILE = path.join(__dirname, '..', 'test', 'golden.json');
/* the shape both test runners compare: sentence score + scored word tokens (text, base, effective score, note) */
function expected(C, profile, text) {
  const a = C.analyzeSentence(text, profile);
  return { score: a.score, words: a.scored.map(t => { const w = { text: t.text, base: t.base, score: t.score }, n = C.noteText(t); if (n) w.note = n; return w; }) };
}
function format(g) {
  return '{\n"comment": ' + JSON.stringify(g.comment) + ',\n"modelVersion": ' + JSON.stringify(g.modelVersion) + ',\n"cases": [\n'
    + g.cases.map(c => JSON.stringify(c)).join(',\n') + '\n]\n}\n';
}
if (require.main === module) {
  const g = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let changed = 0;
  g.cases = g.cases.map(c => {
    const C = engine(c.profile), e = expected(C, c.profile, c.text);
    if (JSON.stringify(e) !== JSON.stringify(c.expected)) { changed++; console.log(`${c.name} [${c.profile}] ${JSON.stringify(c.text)}\n  was ${JSON.stringify(c.expected)}\n  now ${JSON.stringify(e)}`); }
    return { name: c.name, profile: c.profile, text: c.text, expected: e };
  });
  g.modelVersion = engine('general').modelVersion;
  if (!process.argv.includes('--dry')) fs.writeFileSync(FILE, format(g));
  console.log(changed + ' case(s) changed' + (process.argv.includes('--dry') ? ' (dry run)' : ', wrote test/golden.json'));
}
module.exports = { expected };
