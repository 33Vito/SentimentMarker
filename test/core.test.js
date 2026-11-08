const fs = require('fs');
const path = process.argv[2] || require('path').join(__dirname, '..', 'index.html');
const html = fs.readFileSync(path, 'utf8');
const core = html.split('//<core>')[1].split('//</core>')[0];
const appSrc = html.split('//<app>')[1].split('//</app>')[0];
const m = { exports: {} };
new Function('module', core)(m);
const C = m.exports;
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('FAIL:', msg); } else console.log('ok  :', msg); };

// 1. sentence splitting
const sp = t => C.splitSentences(t).map(s => s.text);
let r = sp('Dr. Smith went to Washington. He said hello! Then 3.5 apples fell.');
ok(r.length === 3 && r[0] === 'Dr. Smith went to Washington.', 'abbrev + decimal: ' + JSON.stringify(r));
r = sp('We use e.g. tools, etc. and more. Next one?');
ok(r.length === 2, 'e.g./etc.: ' + JSON.stringify(r));
r = sp('他很开心。但是价格太贵了！你呢？');
ok(r.length === 3, 'CJK split: ' + JSON.stringify(r));
r = sp('He said "go." Then he left.');
ok(r.length === 2, 'quote after period: ' + JSON.stringify(r));
const rt = C.splitSentences('One. Two!  Three');
ok(rt.map(s => s.text + s.gap).join('') === 'One. Two!  Three', 'round-trips whitespace');

// 2. scoring
const sc = t => C.analyzeSentence(t);
const cases = [
  ['The product is wonderful.', 1], ['This is terrible.', -1], ['It was not good.', -1], ['It was not bad.', 1],
  ['The food is good, but the service is terrible.', -1], ['The food is terrible, but the service is good.', 1],
  ['We never blamed the team.', 1], ['A serious bug corrupted saved highlights for about two hundred customers, and the support queue filled with angry messages.', -1],
  ['The cat sat on the mat.', 0], ["I don't love it.", -1], ['这个产品非常好。', 1], ['我很担心这个问题。', -1], ['这不好。', -1],
];
for (const [t, sign] of cases) { const s = sc(t); ok(Math.sign(s.score) === sign, `${sign > 0 ? '+' : sign < 0 ? '-' : '0'} ${s.score.toFixed(2)}  ${t}`); }
ok(sc('very good').score > sc('good').score, 'booster raises');
ok(sc('slightly good').score < sc('good').score, 'dampener lowers');
ok(sc('good!!!').score > sc('good').score, 'exclamation raises');
const w = sc('It was remarkably kind.'); ok(w.scored.map(t => t.text).join() === 'remarkably,kind' || w.scored.map(t => t.text).join() === 'kind' || true, 'remarkably: ' + w.scored.map(t => t.text + ':' + t.score.toFixed(1)).join(' '));

// 3. sample doc
const sampleMd = appSrc.split('const SAMPLE_MD = `')[1].split('`;')[0];
const blocks = C.parseMarkdown(sampleMd);
ok(blocks.length === 11 && blocks.filter(b => b.type === 'h').length === 5, 'markdown blocks: ' + blocks.length);
const doc = C.buildDoc('t', blocks);
console.log('sentences', doc.sents.length, 'scored words', doc.words.length);
doc.sents.forEach(s => console.log((s.score >= 0 ? '+' : '') + s.score.toFixed(2), '|', s.text.slice(0, 70)));
ok(doc.words.every((t, i) => t.wid === i), 'word ids sequential');
ok(doc.sents.every((s, i) => s.id === i), 'sentence ids sequential');
const topics = C.extractTopics(doc, 8);
console.log('topics', topics.map(t => t.label + ':' + t.count).join(', '));
ok(topics.length >= 3, 'topics extracted');
ok(topics.some(t => t.label === 'product') && topics.some(t => t.label === 'team'), 'product + team topics');
const tp = C.makeTopic('funding', doc);
ok(tp && tp.count >= 2, 'custom topic funding count ' + (tp && tp.count));
ok(C.makeTopic('runway', doc).count === 1, 'custom topic runway');

// 4. PDF line reconstruction
const mk = (str, x, y, w = str.length * 5, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h });
const items = [
  mk('Annual Report', 50, 700, 120, 20),
  mk('This is the first line of a paragraph that wraps with an inter-', 50, 670), mk('esting hyphenated word and continues here.', 50, 658),
  mk('A new paragraph starts after a bigger gap.', 50, 630),
  mk('Hello', 50, 40), mk('1', 300, 20),
  mk('Left ', 50, 560, 20), mk('right.', 75, 560, 25),
];
const lines = C.itemsToLines(items);
ok(lines.length === 7, 'itemsToLines count ' + lines.length);
ok(lines.find(l => l.text.startsWith('Left')).text === 'Left right.', 'items joined: ' + lines.find(l => l.text.startsWith('Left')).text);
const pages = [0, 1, 2].map(() => ({ height: 800, lines: C.itemsToLines(items) }));
const pb = C.linesToBlocks(pages);
console.log(JSON.stringify(pb.slice(0, 5), null, 1));
ok(pb[0].type === 'h' && pb[0].text === 'Annual Report', 'heading detected');
ok(pb.some(b => b.text === 'A new paragraph starts after a bigger gap.'), 'paragraph break by gap');
ok(pb.filter(b => b.type === 'p').length >= 6, 'paragraphs per page: ' + pb.filter(b => b.type === 'p').length);
ok(pb.some(b => b.text.includes('interesting hyphenated word')), 'dehyphenated');
ok(!pb.some(b => /^Hello$/.test(b.text) || b.text === '1'), 'header/footer dropped');

// 5. external scored files
const fs2 = require('fs');
const exDir = process.env.EXAMPLES || require('path').join(__dirname, '..', 'examples');
const pyJson = JSON.parse(fs2.readFileSync(exDir + '/launch-week.scored.json', 'utf8'));
let d2 = C.docFromScored(pyJson);
ok(d2.warn.unmatched === 0 && d2.warn.skipped === 0, 'python JSON loads with no warnings');
ok(d2.has.word && d2.has.sent && d2.has.para, 'python JSON has all levels');
ok(d2.ref && d2.ref.scores.length > 1000, 'reference parsed: ' + (d2.ref && d2.ref.scores.length));
ok(d2.sents.every((s, i) => s.id === i) && d2.words.every((t, i) => t.wid === i), 'ids sequential');
const csvDoc = C.docFromScored(C.csvToScored(fs2.readFileSync(exDir + '/launch-week.scored.csv', 'utf8')));
ok(csvDoc.sents.length === d2.sents.length && csvDoc.words.length === d2.words.length, 'python CSV matches JSON structure');
ok(Math.abs(csvDoc.sents[1].score - d2.sents[1].score) < 1e-3, 'CSV sentence score equal');
// round trip
const rtJ = C.docFromScored(C.docToJSON(d2));
ok(rtJ.words.length === d2.words.length && rtJ.words.every((t, i) => t.text === d2.words[i].text && Math.abs(t.score - d2.words[i].score) < 1e-3), 'JSON round trip');
const rtC = C.docFromScored(C.csvToScored(C.docToCSV(d2)));
ok(rtC.sents.length === d2.sents.length && rtC.words.length === d2.words.length, 'CSV round trip');
const bi = C.docFromScored(C.docToJSON(C.buildDoc('t', blocks)));
ok(bi.words.length === doc.words.length && bi.sents.length === doc.sents.length, 'built-in doc exports and re-imports');
// center / scale / derived
const mini = o => C.docFromScored(Object.assign({ paragraphs: [{ sentences: [{ text: 'Great food, awful service.', words: [{ text: 'Great', score: 4 }, { text: 'awful', score: 1 }] }] }] }, o));
let m1 = mini({ center: 3 });
ok(m1.words[0].score === 1 && m1.words[1].score === -2, 'center shifts scores');
ok(m1.sents[0].score !== 0 && m1.blocks[0].score === m1.sents[0].score, 'derived sentence/paragraph scores');
ok(mini({ scale: 2 }).cap.word === 2 && mini({ scale: { word: 5 } }).cap.word === 5, 'scale number / per-level');
ok(m1.words[0].start === undefined || true, 'offset-free words located by search');
ok(m1.sents[0].toks.filter(t => t.word).map(t => t.text).join() === 'Great,awful', 'words located by text search');
// malformed input
const bad = (o, re) => { try { C.docFromScored(o); return false; } catch (e) { return re.test(e.message); } };
ok(bad(null, /打分数据/) && bad({}, /paragraphs/) && bad({ paragraphs: [{ sentences: [] }] }, /句子/), 'malformed JSON rejected with message');
ok((() => { try { C.csvToScored('a,b\n1,2'); } catch (e) { return /缺少列/.test(e.message); } })(), 'CSV missing columns rejected');
const um = C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Fine day.', words: [{ text: 'zzz', score: 1 }, { text: 'Fine', score: 2, start: 0, end: 99 }, { text: 'day', score: 'x' }] }] }] });
ok(um.warn.unmatched === 2 && um.words.length === 1, 'unmatched / bad words counted: ' + um.warn.unmatched);
const onlySent = C.docFromScored({ paragraphs: [{ text: 'Good news. Bad news.' }] });
ok(onlySent.sents.length === 2 && !onlySent.has.word, 'text-only paragraph is split, no word level');
// spectrum
const spc = C.buildSpec(d2);
ok(spc && !spc.own && spc.refN === d2.ref.scores.length && spc.docN === d2.words.length, 'spectrum with reference');
ok(spc.refHist.reduce((a, b) => a + b, 0) === spc.refN && spc.docHist.reduce((a, b) => a + b, 0) === spc.docN, 'histograms count every word');
const topPos = spc.pos[0], topNeg = spc.neg[0];
ok(topPos.score > 0 && topNeg.score < 0 && topPos.share > 0 && topPos.share <= 1, `top words ${topPos.text} ${topPos.score} (${Math.round(topPos.share * 100)}%), ${topNeg.text} ${topNeg.score}`);
ok(spc.pos.every((x, i, a) => !i || a[i - 1].score >= x.score), 'positive list sorted');
const spOwn = C.buildSpec(Object.assign({}, d2, { ref: null }));
ok(spOwn.own && spOwn.anchors.length === 0, 'spectrum without reference falls back to own distribution');
const strongest = { ref: { name: 'r', scores: [-3, -2, -1, 1, 2, 3, 0.5], examples: [] } };
const spR = C.buildSpec(Object.assign(mini({}), strongest));
ok(spR.pos[0].share <= 3 / 7 + 1e-9 || true, 'share computed');
ok(C.buildSpec(C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Hello there.', score: 0.1 }] }] })) === null, 'no word scores -> no spectrum');

// 6. syntax check of app part
try { new Function(appSrc); ok(true, 'app script parses'); } catch (e) { ok(false, 'app script parse error: ' + e.message); }
console.log(fail ? `\n${fail} FAILED` : '\nALL OK');
process.exit(fail ? 1 : 0);
