'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const C = require('../sentiment-diff-core.js');
global.window = global;
require('../examples/fsr-evolution.scored.js');
const editions = global.SM_EVOLUTION;
const { currentBlocks, historicalBlocks } = require('../tools/build-evolution.js');
const scoringCore = require('../sentiment-core.js');
const octoberText = fs.readFileSync(require('path').join(__dirname, '../examples/fsr-assessment-2026-10.txt'), 'utf8');
const octoberBlocks = currentBlocks(octoberText);
assert.deepEqual(currentBlocks(octoberText.replace(/\r?\n/g, '\r\n')), octoberBlocks, 'CRLF must preserve scope and repairs');
assert.throws(() => currentBlocks(octoberText.replace('a growing focus of', 'changed source')), /anchors changed/);
assert.throws(() => currentBlocks(octoberText.replace('## Box:', '## Changed:')), /boundary changed/);
const repairedSentence = 'In particular, the potential for financial and non-financial risks to interact in complex and novel ways is a growing focus of financial system regulators in Australia and internationally.';
const october = editions.find(e => e.date === '2026-10');
assert.equal(october.sentences.filter(s => s.text === repairedSentence).length, 1);
assert.ok(!october.sentences.some(s => s.text.endsWith('a growing focus of') || s.text.startsWith('financial system regulators')));
assert.equal(october.sentences.filter(s => s.text === 'CFR agencies will continue to work with industry on preparedness initiatives.').length, 1, 'preserve industry callout');
const substantiveHeadings = scoringCore.parseMarkdown(octoberText.split('## Box:')[0]).filter(b => b.type === 'h' && b.text.endsWith('.'));
assert.equal(substantiveHeadings.length, 5);
for (const heading of substantiveHeadings) assert.equal(october.sentences.filter(s => s.text === heading.text).length, 1, 'include substantive heading once');
assert.deepEqual(editions.map(e => e.sentences.length), [55, 71, 79, 82, 90, 104]);
assert.equal(historicalBlocks([{text:'Banks remain strong. Endnote Reference material.'}])[0].text, 'Banks remain strong.');
for (const edition of editions) {
  assert.ok(edition.sentences.every(s => /[\p{L}\p{N}]/u.test(s.text)), 'exclude standalone punctuation');
  assert.ok(!edition.sentences.some(s => /^Endnote|^This Financial Stability Review was finalised/.test(s.text)));
}
for (const date of ['2025-04', '2025-10']) {
  assert.ok(editions.find(e => e.date === date).sentences.some(s => s.text === 'However, it is important that lending standards remain sound …'), 'preserve substantive historical heading');
}
assert.equal(editions.length, 6);
assert.deepEqual(editions.map(e => e.date), ['2024-03','2024-09','2025-04','2025-10','2026-03','2026-10']);
for (const e of editions) {
  assert.ok(e.sentences.length > 40);
  assert.equal(e.model.profile, 'finance');
  for (const s of e.sentences) {
    assert.ok(Number.isFinite(s.score) && Math.abs(s.score) <= 1);
    for (const w of s.words) assert.equal(Array.from(s.text).slice(w.start,w.end).join(''), w.text);
  }
  for (const t of C.TOPICS) {
    const s = C.summary(e,t);
    assert.equal(s.coverage, s.count/s.total);
    assert.equal(s.mean === null, s.count < C.MIN_HITS);
  }
}
const topic=C.TOPICS.find(t=>t.id==='households');
const make=(n,score)=>({model:{version:'1',profile:'finance'},sentences:Array.from({length:n},()=>({text:'Households remain resilient.',score}))});
assert.equal(C.compare(make(4,0),make(5,.2),topic).delta,null);
assert.ok(Math.abs(C.compare(make(5,-.2),make(5,.2),topic).delta-.4)<1e-10);
const mismatch=make(5,.2);mismatch.model.version='2';
assert.equal(C.compare(make(5,0),mismatch,topic).delta,null);
mismatch.model.version='1';mismatch.model.profile='general';
assert.equal(C.comparable(make(5,0),mismatch),false);
assert.equal(C.summary({sentences:[]},topic).coverage,0);
assert.equal(C.hits('Banking supervision',C.TOPICS[3]),false);
assert.equal(C.hits('Banks remain well capitalised.',C.TOPICS[3]),true);
const left=[{text:'Households remain resilient.',score:-1},{text:'Households remain resilient.',score:1}];
const right=[{text:'Households remain resilient.',score:1}];
const alignment=C.align(left,right);
assert.equal(alignment.pairs.length,1);
assert.equal(alignment.leftOnly.length,1);
assert.deepEqual(C.align(left,right.map(s=>({...s,score:-1}))).pairs.map(p=>[p.i,p.j]),alignment.pairs.map(p=>[p.i,p.j]));
assert.equal(C.similarity('Bank capital is strong.','Bank capital is strong.'),1);
assert.equal(C.align([{text:'Households',score:0}],[{text:'Cybersecurity',score:0}]).pairs.length,0);
const html=fs.readFileSync(require('path').join(__dirname,'../SentimentDiff.html'),'utf8');
for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(script[1]);
assert.ok(!/fetch\(/.test(html),'file:// must not depend on fetch');
// Execute the page with minimal DOM surfaces to exercise every topic/edition pair.
// Browser geometry is deliberately outside this dependency-free smoke check.
const nodes = new Map();
const document = {getElementById(id) {
  if(!nodes.has(id))nodes.set(id,{value:id==='topic'?'global':'',innerHTML:'',addEventListener(){},scrollIntoView(){}});
  return nodes.get(id);
}};
const context = {document,SMDiffCore:C,SM_EVOLUTION:editions};
require('node:vm').createContext(context);
require('node:vm').runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],context);
for(const t of C.TOPICS)for(let a=0;a<6;a++)for(let b=0;b<6;b++) {
  nodes.get('left').value=String(a); nodes.get('right').value=String(b);nodes.get('topic').value=t.id;
  require('node:vm').runInContext('render()',context);
  assert.ok(!/NaN|undefined/.test(nodes.get('result').innerHTML));
  assert.ok(nodes.get('evidence').innerHTML.includes('unmatched'));
}
nodes.get('swap').onclick();
assert.ok(nodes.get('timeline').innerHTML.includes('2026-10'));
execFileSync(process.execPath,[require('path').join(__dirname,'../tools/build-evolution.js'),'--check'],{stdio:'inherit'});
console.log('Diff tests passed: data, offsets, coverage, thresholds, model mismatch, independent alignment and offline wiring.');
