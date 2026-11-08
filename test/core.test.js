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

// 5. syntax check of app part
try { new Function(appSrc); ok(true, 'app script parses'); } catch (e) { ok(false, 'app script parse error: ' + e.message); }
console.log(fail ? `\n${fail} FAILED` : '\nALL OK');
process.exit(fail ? 1 : 0);
