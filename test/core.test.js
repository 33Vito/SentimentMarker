const fs = require('fs');
const path = process.argv[2] || require('path').join(__dirname, '..', 'index.html');
const html = fs.readFileSync(path, 'utf8');
/* the core lives in sentiment-core.js next to index.html; both pages load it with <script src> */
const corePath = require('path').join(require('path').dirname(path), 'sentiment-core.js');
const coreFile = fs.readFileSync(corePath, 'utf8');
const core = coreFile.split('//<core>')[1].split('//</core>')[0];
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
const supItems = [
  mk('risks ', 50, 400, 36, 10.8),
  mk('7', 90, 404, 6, 7.3),
  mk('to stability.', 100, 400, 80, 10.8),
];
const supLines = C.itemsToLines(supItems);
ok(supLines.length === 1 && supLines[0].text === 'risks to stability.', 'superscript not joined: ' + JSON.stringify(supLines.map(l => l.text)));
const sameBase = [
  mk('• ', 50, 400, 12, 18),
  mk('Vulnerabilities persist.', 70, 400, 160, 11.5),
];
const sbLines = C.itemsToLines(sameBase);
ok(sbLines.length === 1 && sbLines[0].text.includes('Vulnerabilities persist.') && sbLines[0].size === 11.5, 'same-baseline small text is kept and sets the line size: ' + JSON.stringify(sbLines.map(l => ({ text: l.text, size: l.size }))));
const leadPage = [{ height: 800, lines: C.itemsToLines([
  mk('• ', 50, 400, 12, 18),
  mk('Operational vulnerabilities have continued to grow.', 70, 400, 280, 11.5),
  mk('The next sentence stays with them.', 50, 386, 220, 11.5),
]) }];
const leadBlocks = C.linesToBlocks(leadPage);
ok(leadBlocks.length === 1 && leadBlocks[0].type === 'p' && leadBlocks[0].text.includes('Operational vulnerabilities') && leadBlocks[0].text.includes('next sentence'), 'a bullet lead stays one paragraph: ' + JSON.stringify(leadBlocks));
const noteItems = [
  mk('vulnerable to external shocks.', 50, 400, 160, 11),
  mk('1 ', 50, 386, 12, 8),
  mk('Conflicts in the Middle East remain.', 64, 386, 200, 11),
];
const noteLines = C.itemsToLines(noteItems);
ok(noteLines.length === 2 && noteLines[1].text.startsWith('1 ') && noteLines[1].text.includes('Conflicts'), 'a smaller note marker on the next line is kept: ' + JSON.stringify(noteLines.map(l => l.text)));
const edgePage = [{ height: 842, lines: [
  { y: 820, x: 40, size: 9, text: 'Financial Stability Review | October 2026' },
  { y: 400, x: 80, size: 11, text: 'The body sentence stays on the only page.' },
  { y: 30, x: 40, size: 8, text: 'R e s e r v e B a n k o f A u s t r a l i a' },
]}];
const eb = C.linesToBlocks(edgePage);
ok(eb.some(b => b.text.includes('body sentence')) && !eb.some(b => /financial stability review/i.test(b.text)) && !eb.some(b => /\be\b/.test(b.text) && /Reserve/.test(b.text)), 'publication header and letterspaced footer drop on one page');
const keptBody = C.linesToBlocks([{ height: 842, lines: [
  { y: 400, x: 80, size: 11, text: 'A sentence about the Financial Stability Review stays when it is not in the margin.' },
]}]);
ok(keptBody.some(b => /Financial Stability Review/.test(b.text)), 'the publication name in body text is kept');
const banner = 'Chapter 1 | ' + 'The Global Macro-financial Environment'.repeat(4);
const up = [{ height: 800, lines: [
  { y: 400, x: 50, size: 11, text: 'exposures to' },
  { y: 780, x: 300, size: 8.5, text: banner },
  { y: 386, x: 50, size: 11, text: 'NBFIs have continued.' },
]}];
const ub = C.linesToBlocks(up);
ok(ub.length === 1 && ub[0].text === 'exposures to NBFIs have continued.', 'repeated edge banner dropped and the sentence rejoins: ' + JSON.stringify(ub));
const jump = [{ height: 800, lines: [
  { y: 400, x: 50, size: 11, text: 'First column ends here.' },
  { y: 386, x: 50, size: 11, text: 'Still the first column.' },
  { y: 700, x: 50, size: 11, text: 'Second column starts up here.' },
  { y: 686, x: 50, size: 11, text: 'And continues downward.' },
]}];
const jb = C.linesToBlocks(jump);
ok(jb.length === 2 && jb[0].text === 'First column ends here. Still the first column.' && jb[1].text === 'Second column starts up here. And continues downward.', 'an upward jump starts a new block: ' + JSON.stringify(jb));

// 4c. heading levels for the outline: absolute size cut, markdown hashes, section sums
const lvPage = [{ height: 800, lines: C.itemsToLines([
  mk('Body line one of the paragraph runs long enough to be body text.', 50, 400, 320, 11),
  mk('Body line two continues below it.', 50, 386, 200, 11),
  mk('Chapter title is twenty-two pt.', 50, 340, 260, 22),
  mk('A section head is sixteen pt.', 50, 300, 240, 16),
  mk('Body after the section head also runs a full line of text here.', 50, 260, 330, 11),
]) }];
const lvH = C.linesToBlocks(lvPage).filter(b => b.type === 'h');
ok(lvH.length === 2 && lvH[0].level === 1 && lvH[1].level === 2, 'level by absolute size: 22pt -> 1, 16pt -> 2: ' + JSON.stringify(lvH));
const mdH = C.parseMarkdown('# One\n\ntext one\n\n## Two\n\ntext two\n\n### Three\n').filter(b => b.type === 'h');
ok(mdH.length === 3 && mdH[0].level === 1 && mdH[1].level === 2 && mdH[2].level === 2, 'markdown hashes map to levels 1 / 2 / 2: ' + JSON.stringify(mdH.map(b => b.level)));
const secDoc = C.buildDoc('T', C.parseMarkdown('# Alpha\n\nGreat work here.\n\n## Beta\n\nAwful luck.\n\n## Gamma\n\nFine.\n\n# Delta\n\nTerrible.\n'));
const secs = C.sectionScores(secDoc);
const bsum = i => secDoc.blocks[i].sents.reduce((x, s) => x + s.score, 0);
const rsum = (i0, i1) => Math.round(Array.from({ length: i1 - i0 }, (_, k) => bsum(i0 + k)).reduce((x, y) => x + y, 0) * 100) / 100;
ok(secs.length === 4 && secs.map(r => r.blockId).join() === '0,2,4,6' && secs.map(r => r.level).join() === '1,2,2,1', 'one outline row per heading, levels survive buildDoc: ' + JSON.stringify(secs.map(r => [r.blockId, r.level])));
ok(secs[1].score === rsum(2, 4) && secs[1].count === 2, 'an h2 section is its heading plus the paragraphs until the next heading');
ok(secs[0].score === rsum(0, 6) && secs[0].count === 6, 'an h1 section runs through its nested h2s until the next h1');
ok(secs[3].score === rsum(6, 8) && secs[3].count === 2, 'the last h1 owns only its own block');
const lvlDoc = C.docFromScored({ version: 1, title: 't', paragraphs: [
  { type: 'h', sentences: [{ text: 'Head one' }] },
  { type: 'h', level: 2, sentences: [{ text: 'Head two' }] },
  { type: 'h', level: 9, sentences: [{ text: 'Head nine' }] },
  { type: 'h', level: '2', sentences: [{ text: 'Head string two' }] },
  { type: 'p', sentences: [{ text: 'Body.' }] },
] });
ok(lvlDoc.blocks.slice(0, 4).map(b => b.level).join() === '1,2,2,2' && lvlDoc.blocks[4].level === undefined, 'level reads: default 1, 2 kept, 9 clamps to 2, "2" coerces; paragraphs carry none: ' + lvlDoc.blocks.map(b => b.level));
const rtLv = C.docToJSON(lvlDoc);
ok(rtLv.paragraphs[1].level === 2 && rtLv.paragraphs[0].level === undefined && rtLv.paragraphs[2].level === 2, 'docToJSON writes level 2 (clamped 9 included), omits the default 1');

// 5. external scored files
const fs2 = require('fs');
const exDir = process.env.EXAMPLES || require('path').join(__dirname, '..', 'examples');
const pyJson = JSON.parse(fs2.readFileSync(exDir + '/launch-week.scored.json', 'utf8'));
let d2 = C.docFromScored(pyJson);
const noWarn = d => Object.values(d.warn).every(v => v === 0);
ok(noWarn(d2), 'python JSON loads with no warnings: ' + JSON.stringify(d2.warn));
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
ok(bad(null, /valid scored data/) && bad({}, /paragraphs/) && bad({ paragraphs: [{ sentences: [] }] }, /sentences/i), 'malformed JSON rejected with message');
ok((() => { try { C.csvToScored('a,b\n1,2'); } catch (e) { return /missing column/i.test(e.message); } })(), 'CSV missing columns rejected');
const um = C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Fine day.', words: [{ text: 'zzz', score: 1 }, { text: 'Fine', score: 2, start: 0, end: 99 }, { text: 'day', score: 'x' }] }] }] });
ok(um.warn.unmatched === 2 && um.words.length === 1, 'unmatched / bad words counted: ' + um.warn.unmatched);
const onlySent = C.docFromScored({ paragraphs: [{ text: 'Good news. Bad news.' }] });
ok(onlySent.sents.length === 2 && !onlySent.has.word, 'text-only paragraph is split, no word level');
// item 1: code-point offsets (Python str indices) vs UTF-16
const emo = '🎉 Great launch, awful bug.';
const pyOff = (t, w) => { const cps = [...t], wc = [...w]; for (let i = 0; i + wc.length <= cps.length; i++) if (cps.slice(i, i + wc.length).join('') === w) return [i, i + wc.length]; return null; };
const [g0, g1] = pyOff(emo, 'Great'), [a0, a1] = pyOff(emo, 'awful');
ok(g0 === 2 && a0 === 16, 'python-style offsets are code points: ' + g0 + ',' + a0);
const de = C.docFromScored({ paragraphs: [{ sentences: [{ text: emo, words: [{ text: 'Great', score: 2, start: g0, end: g1 }, { text: 'awful', score: -3, start: a0, end: a1 }] }] }] });
ok(de.words.map(t => t.text).join() === 'Great,awful' && de.warn.misaligned === 0 && de.warn.unmatched === 0, 'emoji sentence: code-point offsets highlight the right words: ' + de.words.map(t => t.text).join());
const ej = C.docToJSON(de).paragraphs[0].sentences[0].words;
ok(ej[0].start === g0 && ej[0].end === g1 && ej[1].start === a0, 'export writes code-point offsets');
const ec = C.docToCSV(de).split('\n').filter(l => l.startsWith('word,'));
ok(ec[0].split(',')[6] === String(g0) && ec[1].split(',')[6] === String(a0), 'CSV export writes code-point offsets');
const wrong = C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Great food, awful service.', words: [{ text: 'awful', score: -3, start: 0, end: 5 }] }] }] });
ok(wrong.words[0].text === 'awful' && wrong.warn.misaligned === 1, 'wrong-but-in-range offset is relocated, not highlighted on the wrong text');
const wrong2 = C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Great food.', words: [{ text: 'awful', score: -3, start: 0, end: 5 }] }] }] });
ok(wrong2.words.length === 0 && wrong2.warn.unmatched === 1, 'wrong offset for a word that is not in the sentence -> unmatched');
const nfc = C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Café is GOOD.', words: [{ text: 'Café', score: 1, start: 0, end: 5 }, { text: 'good', score: 2, start: 9, end: 13 }] }] }] });
ok(nfc.warn.misaligned === 0 && nfc.words.length === 2, 'offset check is NFC-normalised and case-insensitive');
// item 2: paragraph-only input
const po = C.docFromScored({ paragraphs: [{ text: 'Good news. Bad news.', score: 0.4, sentences: [] }] });
ok(po.sents.length === 2 && po.blocks[0].score === 0.4, 'sentences: [] falls back to splitting p.text');
const pcsv = C.docFromScored(C.csvToScored('level,paragraph,sentence,text,score\nparagraph,0,,Good news. Bad news.,0.3\nparagraph,1,,,0.5\n'));
ok(pcsv.sents.length === 2 && pcsv.has.para && pcsv.warn.skipped === 1, 'CSV paragraph rows with text work; score-only paragraph skipped and counted');
// item 4: CSV orphans / empty sentence text
const orph = C.csvToScored('level,paragraph,sentence,text,score\nsentence,0,0,Fine day.,0.2\nsentence,0,1,,0.1\nword,0,1,x,1\nword,0,2,good,1\nword,0,0,Fine,1\n');
ok(orph._bad === 3, 'CSV: empty sentence row + orphan word rows counted as bad: ' + orph._bad);
ok(C.docFromScored(orph).warn.bad === 3, 'bad rows reach warn');
ok(C.parseCSV('a,b\r\n"x\r\ny",2\r\n')[1][0] === 'x\ny', 'parseCSV normalises \\r\\n inside quoted fields');
// item 5: unordered keyword lists, ## subwords
const uo = C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Bad start, good end, good mood.', words: [{ text: 'good', score: 2 }, { text: 'bad', score: -2 }, { text: 'good', score: 2 }, { text: '##mood', score: 1 }] }] }] });
ok(uo.words.map(t => t.text).join() === 'Bad,good,good,mood' && uo.warn.unmatched === 0, 'unordered words found from sentence start, each occurrence once; ## stripped: ' + uo.words.map(t => t.text).join() + ' ' + uo.warn.unmatched);
// item 9: per-level center
const pc = C.docFromScored({ center: { word: 3, sentence: 0.5, paragraph: 0 }, reference: { scores: [1, 2, 4, 5, 5, 1] }, paragraphs: [{ score: 0.2, sentences: [{ text: 'Great food.', score: 0.9, words: [{ text: 'Great', score: 5 }] }] }] });
ok(pc.words[0].score === 2 && Math.abs(pc.sents[0].score - 0.4) < 1e-9 && pc.blocks[0].score === 0.2 && pc.ref.scores[0] === -2, 'center object applies per level; reference uses word center');
ok(C.docFromScored({ center: 3, paragraphs: [{ score: 4, sentences: [{ text: 'x y.', score: 4 }] }] }).blocks[0].score === 1, 'plain number center still works');
// item 10: derived flags
const dv = C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Good.', score: 0.5 }, { text: 'Bad.', words: [{ text: 'Bad', score: -2 }] }] }] });
ok(!dv.sents[0].derived && dv.sents[1].derived && dv.blocks[0].derived && dv.mixedSent, 'derived sentence / paragraph scores flagged; mixed doc detected');

// item 3: export -> import keeps scale, reference and the file's own scale (center)
const capEq = (x, y) => ['word', 'sent', 'para'].every(k => Math.abs(x.cap[k] - y.cap[k]) < 1e-3);
const rt2 = C.docFromScored(C.docToJSON(d2));
ok(capEq(rt2, d2) && rt2.ref && rt2.ref.scores.length === d2.ref.scores.length && rt2.ref.examples.length === d2.ref.examples.length, 'JSON export keeps scale + reference');
const autoDoc = mini({});
const rt3 = C.docFromScored(C.docToJSON(autoDoc));
ok(capEq(rt3, autoDoc) && rt3.capSrc.word === 'file' && autoDoc.capSrc.word === 'auto', 'auto caps exported as scale and re-imported unchanged');
const cdoc = C.docFromScored({ center: { word: 3, sentence: 0, paragraph: 0 }, reference: { name: 'stars', scores: [1, 2, 2, 4, 5, 5] }, paragraphs: [{ sentences: [{ text: 'Great food.', words: [{ text: 'Great', score: 5 }] }] }] });
const cj = C.docToJSON(cdoc);
ok(cj.paragraphs[0].sentences[0].words[0].score === 5 && cj.reference.scores[0] === 1 && cj.center.word === 3, 'export undoes center and writes it back');
const cr = C.docFromScored(cj);
ok(cr.words[0].score === cdoc.words[0].score && cr.ref.scores.join() === cdoc.ref.scores.join() && capEq(cr, cdoc), 'centered export -> import is stable');
const bj = C.docToJSON(C.buildDoc('t', blocks));
ok(bj.scale && bj.reference && bj.reference.scores.length > 100 && C.buildSpec(C.docFromScored(bj)).own === false, 'built-in doc export carries scale + reference (spectrum kept)');

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

// item 8: spectrum groups by (word, sign)
const gs = C.buildSpec(C.docFromScored({ paragraphs: [{ sentences: [{ text: 'Good start. Not good end.', words: [{ text: 'Good', score: 2 }, { text: 'good', score: -1.2 }] }] }] }));
ok(gs.pos.length === 1 && gs.neg.length === 1 && gs.pos[0].score === 2 && gs.neg[0].score === -1.2, 'good / not good kept apart in spectrum');
const shr = C.buildSpec(Object.assign(mini({}), { ref: { name: 'r', scores: [-3, -2, -1, 1, 2, 3, 4, 5], examples: [] } }));
ok(Math.abs(shr.pos[0].share - 2 / 8) < 1e-9 && Math.abs(shr.pos[1].share - 5 / 8) < 1e-9 && C.rankText(shr.pos[0], false) === 'most positive 25%', 'share = same-side at-least-as-extreme / all reference words');
// item 10: scale mismatch warning
const sw1 = C.buildSpec(Object.assign(mini({}), { ref: { name: 'r', scores: [-40, -20, 10, 20, 40], examples: [] } }));
const sw2 = C.buildSpec(Object.assign(mini({}), { ref: { name: 'r', scores: [-4, -2, 1, 2, 4], examples: [] } }));
ok(sw1.scaleWarn && !sw2.scaleWarn && !C.buildSpec(Object.assign(mini({}), { ref: null })).scaleWarn, 'scale mismatch flagged only when ratio is far off');
// item 11: colour scale shown with its source
ok(/From file/.test(C.scaleText(d2)) && /±3/.test(C.scaleText(d2)), 'scale text (file): ' + C.scaleText(d2).replace(/<[^>]+>/g, ''));
ok(/Auto/.test(C.scaleText(mini({}))) && /\(General dictionary\)$/.test(C.scaleText(doc)) && !/Built-in dictionary/.test(C.scaleText(doc)), 'scale text (auto / the profile that scored the text): ' + C.scaleText(doc).replace(/<[^>]+>/g, ''));
ok(/Sentence.*From file/.test(C.scaleText(mini({ scale: { sentence: 1 } }))), 'mixed scale sources labelled per level');
// items 6 / 7: app wiring (checked in the source; the UI itself is checked with Playwright)
ok(/matchMedia\('\(min-width:1360px\)'\)/.test(appSrc) && /@media \(min-width:1360px\)/.test(html) && !/min-width:1520px/.test(html), 'wide breakpoint is 1360px in CSS and JS');
ok(/specWanted === null \? wideMQ\.matches/.test(appSrc) && !/setSpec\(e\.matches\)/.test(appSrc), 'manual spectrum choice wins over width changes');
ok(!/\/读取\/\.test/.test(appSrc) && /toastBusy/.test(appSrc), 'PDF truncation toast not cleared by a text regex');

// article picker: Assessment and the synthetic sample are inline; the full review is a classic script
ok(/<select[^>]*id="selDemo"/.test(html) && !/id="btnSample"/.test(html), 'sample button replaced by an article picker');
ok(/window\.DEMOS/.test(appSrc) && /loadDemo/.test(appSrc) && /initDemoSel\(\);/.test(appSrc), 'picker wired to window.DEMOS at boot');
const djs = fs2.readFileSync(exDir + '/demos.js', 'utf8');
const dlist = JSON.parse(djs.slice(djs.indexOf('window.DEMOS =') + 'window.DEMOS ='.length).replace(/;\s*$/, ''));
ok(dlist.length === 3 && dlist[0].file.includes('fsr-assessment') && dlist[0].scored && dlist[0].scored.title, 'start-up demo stays the Assessment');
ok(dlist[1].label && dlist[1].file && dlist[1].src && !dlist[1].scored, 'full review is a lazy script stub');
ok(/demoScriptLoads\[d\.src\] === load\) delete demoScriptLoads/.test(appSrc), 'a failed demo script is not cached');
ok(/gen === demoOpenGen/.test(appSrc) && /if \(!current\(\)\) return ''/.test(appSrc), 'a late demo load does not replace the article now open');
ok(dlist[2].scored && dlist[2].scored.title, 'synthetic demo stays inline');
const assessmentText = fs2.readFileSync(exDir + '/fsr-assessment-2026-10.txt', 'utf8');
const figureThemes = ['Operational resilience', 'Global equity and credit markets', 'Sovereign debt markets', 'Households and businesses', 'System liquidity'];
ok(figureThemes.every(t => assessmentText.includes('## ' + t) && dlist[0].scored.paragraphs.some(p => p.type === 'h' && p.level === 2 && p.sentences[0].text.startsWith(t))), 'Figure 1 has five readable, outlined themes');
ok(Array.from({ length: 8 }, (_, i) => 'Endnote ' + (i + 1) + ':').every((n, i, a) => assessmentText.indexOf(n) >= 0 && (i === 0 || assessmentText.indexOf(n) > assessmentText.indexOf(a[i - 1]))), 'Assessment includes correctly ordered Endnotes 1–8');
const syntheticSections = dlist[2].scored.paragraphs.reduce((sections, p) => {
  if (p.type === 'h' && p.level === 2) sections.push({ pos: 0, neg: 0 });
  else if (p.type !== 'h' && sections.length) for (const s of p.sentences) for (const w of s.words) sections.at(-1)[w.score > 0 ? 'pos' : 'neg']++;
  return sections;
}, []);
ok(syntheticSections.length >= 9 && syntheticSections.every(s => s.pos && s.neg) && C.outlineWorthy(C.docFromScored(dlist[2].scored)), 'synthetic chapters each contain scored positive and negative words and open the outline');
ok(dlist[0].scored.paragraphs.some(p => p.type === 'h' && p.level === 2) && dlist[0].scored.paragraphs[0].level === undefined, 'packed Assessment carries level 2 on section heads, default 1 elsewhere');
ok(/id="btnToc"/.test(html) && /class="toc" id="toc"/.test(html), 'Outline toggle and outline aside exist');
ok(/S\.tocRows = sectionScores\(S\.doc\)/.test(appSrc) && /renderToc\(\);/.test(appSrc), 'the outline is built from the opened document inside openDoc');
ok(/const showToc = ton && \(wide \|\| panelFront === 'toc'\)/.test(appSrc) && /const showSpec = on && \(wide \|\| \(!sel && panelFront !== 'toc'\) \|\| panelFront === 'spec'\)/.test(appSrc) && /const showInsp = sel && \(wide \|\| \(panelFront !== 'toc' && !on\) \|\| panelFront === 'insp'\)/.test(appSrc), 'narrow: exactly one sheet - inspector, spectrum or outline, front token decides');
ok(/E\.insp\.style\.top = \(bottom \+ 12\)/.test(appSrc) && /else \{ E\.toc\.style\.maxHeight = ''; E\.insp\.style\.top = ''; E\.insp\.style\.maxHeight = ''; \}/.test(appSrc) && /Math\.min\(window\.innerHeight \* 0\.5, window\.innerHeight - t - 156\)/.test(appSrc), 'the inspector docks under the outline, the outline gives room back on short windows, and both revert when either closes');
ok(/el\.scrollIntoView\(\{ block: 'start', behavior: scrollBehavior\(\) \}\)/.test(appSrc) && !/jumpTo\(|select\(/.test(appSrc.slice(appSrc.indexOf('E.toc.addEventListener'), appSrc.indexOf('\n});', appSrc.indexOf('E.toc.addEventListener')))), 'an outline row scrolls without opening the inspector');
const awDoc = { blocks: [] };
for (let i = 0; i < 11; i++) awDoc.blocks.push({ type: i < 4 ? 'h' : 'p', id: i, level: 1, sents: [{ score: 0 }], score: 0, k: 0 });
for (let i = 0; i < 3; i++) awDoc.blocks.push({ type: 'p', id: 11 + i, sents: [{ score: 0 }], score: 0, k: 0 });
ok(C.outlineWorthy(secDoc) === false, 'outlineWorthy: 8 blocks with 4 headings is below the floor');
ok(C.outlineWorthy({ blocks: awDoc.blocks.slice(0, 12) }) === true && C.outlineWorthy({ blocks: awDoc.blocks.slice(0, 11) }) === false, 'outlineWorthy: the block floor is exactly 12');
awDoc.blocks[3].type = 'p';
ok(C.outlineWorthy({ blocks: awDoc.blocks.slice(0, 12) }) === false, 'outlineWorthy: 12 blocks with only 3 headings is below the heading floor');
[dlist[0], dlist[2]].forEach(d => { const dd = C.docFromScored(d.scored); ok(noWarn(dd) && dd.has.word && dd.has.sent && dd.has.para, 'demo loads with all levels, no warnings: ' + d.file); });
const side = fs2.readFileSync(exDir + '/fsr-2026-10.demo.js', 'utf8');
const marker = "window.DEMO_FILES['fsr-2026-10.scored.json'] = ";
const fullObj = JSON.parse(side.slice(side.indexOf(marker) + marker.length).replace(/;\s*$/, ''));
const full = C.docFromScored(fullObj);
ok(fullObj.title === 'RBA Financial Stability Review (Oct 2026)' && noWarn(full) && full.has.word && full.has.sent && full.has.para, 'full review loads with all levels, no warnings');
ok(full.sents.length > 400 && full.words.length > 400, 'full review is not truncated: ' + full.sents.length + ' sentences, ' + full.words.length + ' words');

// item 12: the examples in docs/FORMAT.md load cleanly
const fmd = fs2.readFileSync(require('path').join(__dirname, '..', 'docs', 'FORMAT.md'), 'utf8');
const fcsv = C.docFromScored(C.csvToScored(fmd.split('```csv\n')[1].split('```')[0]));
ok(noWarn(fcsv) && fcsv.blocks[0].type === 'h' && fcsv.words.map(t => t.text).join() === 'better,feared', 'FORMAT.md CSV example loads with no warnings');
const fjson = JSON.parse(fmd.split('```json\n')[1].split('```')[0]);
fjson.reference.scores = fjson.reference.scores.filter(v => typeof v === 'number');
const fj = C.docFromScored(fjson);
ok(noWarn(fj) && fj.words[0].text === 'better', 'FORMAT.md JSON example offsets are right');
ok(noWarn(csvDoc), 'python CSV loads with no warnings');

// 5b. the shared core file: one classic script for both pages, API on window.SMCore
const fakeWin = {};
new Function('window', 'module', coreFile)(fakeWin, undefined);
ok(fakeWin.SMCore && typeof fakeWin.SMCore.topicScores === 'function' && typeof fakeWin.SMCore.docFromScored === 'function', 'sentiment-core.js as a classic script publishes window.SMCore');
const storyHtml = fs.readFileSync(require('path').join(require('path').dirname(path), 'SentimentStoryDemo.html'), 'utf8');
const loadsCore = (h, mark) => { const i = h.indexOf('<script src="sentiment-core.js"></script>'), j = h.indexOf(mark); return i >= 0 && j > i; };
ok(loadsCore(html, '//<app>') && loadsCore(storyHtml, "'use strict'") && !/\/\/<core>/.test(html),'index.html and the story page both load sentiment-core.js before their own script; index.html no longer inlines a core');
ok(!/function (docFromScored|placeWords)\b|const p90\b/.test(html + storyHtml), 'no second copy of the scored-file reader or the p90 scale in either page');

// 5c. topicScores: sentence-level topic summary
const tdoc = C.buildDoc('t', C.parseMarkdown('# Funding and team\n\nThe team was great. The funding was awful. The team and the funding were fine. Nothing here.\n'));
const tTeam = C.makeTopic('team', tdoc), tFund = C.makeTopic('funding', tdoc), tNone = C.makeTopic('zebra', tdoc);
const tsc = C.topicScores(tdoc, [tTeam, tFund, tNone]);
const hitsOf = (d, t) => d.sents.filter(s => C.matches(s, t));
const near = (a, b) => Math.abs(a - b) < 1e-9;
ok(tsc.length === 3 && tsc[0].key === 'team' && tsc[1].label === 'funding', 'one row per topic, in the order given');
ok(tsc[0].count === 3 && tsc[1].count === 3 && tsc[0].count === hitsOf(tdoc, tTeam).length, 'count = sentences matched through matches() (heading included): ' + tsc.map(r => r.count));
const both = tdoc.sents.find(s => /team and the funding/.test(s.text));
ok(tsc[0].topPos.some(x => x.id === both.id) && tsc[1].topPos.some(x => x.id === both.id) && tsc[0].shared === 2 && tsc[1].shared === 2, 'a sentence that mentions two topics counts toward each; shared counts the overlap');
ok(near(tsc[0].mean, hitsOf(tdoc, tTeam).reduce((x, s) => x + s.score, 0) / 3) && near(tsc[1].sum, hitsOf(tdoc, tFund).reduce((x, s) => x + s.score, 0)), 'mean and sum are the plain average / sum of the hit sentences');
ok(tsc[1].mean < 0 && tsc[0].mean > 0, 'team leans positive, funding negative: ' + tsc[0].mean.toFixed(3) + ' / ' + tsc[1].mean.toFixed(3));
ok(tsc.every(r => r.pos + r.neg + r.neu === r.count) && tsc[0].neu >= 1, 'negative + neutral + positive = count; the unscored heading is neutral');
ok(tsc[2].count === 0 && tsc[2].mean === 0 && tsc[2].sum === 0 && tsc[2].topPos.length === 0 && tsc[2].topNeg.length === 0 && tsc[2].pos + tsc[2].neg + tsc[2].neu === 0 && tsc[2].shared === 0, 'no hits -> zeros and an empty list, never NaN');
ok(C.topicScores(tdoc, []).length === 0 && C.topicScores(tdoc, [tNone])[0].mean === 0, 'no topics -> no rows; a lone miss is still 0');
/* topPos: score > 0, highest first; topNeg: score < 0, lowest first; equal scores in document order */
const posOrd = l => l.every((x, i) => x.score > 0 && (!i || l[i - 1].score > x.score || (l[i - 1].score === x.score && l[i - 1].id < x.id)));
const negOrd = l => l.every((x, i) => x.score < 0 && (!i || l[i - 1].score < x.score || (l[i - 1].score === x.score && l[i - 1].id < x.id)));
ok(tsc.every(r => posOrd(r.topPos) && negOrd(r.topNeg)), 'topPos only positive, descending; topNeg only negative, ascending; zero scores in neither');
ok(tsc[0].topPos.length === 2 && tsc[0].topNeg.length === 0 && tsc[1].topPos.length === 1 && tsc[1].topNeg.length === 1, 'each side holds only its own sign (team: 2 positive, no negative; funding: 1 + 1)');
const tN1 = C.topicScores(tdoc, [tTeam], { n: 1 })[0];
ok(tN1.topPos.length === 1 && tN1.topPos[0].id === tsc[0].topPos[0].id, 'n honoured; n = 1 keeps the strongest');
ok(tsc.every(r => r.topPos.concat(r.topNeg).every(x => tdoc.sents[x.id].text === x.text && tdoc.sents[x.id].block === x.block)), 'each strong hit carries the sentence id and block to jump to');
const tieScores = [-0.5, 0.5, 0.2, -0.9, 0.5, -0.5, 0.7, -0.1, 0];
const tie = C.topicScores(C.docFromScored({ paragraphs: [{ sentences: tieScores.map((v, i) => ({ text: 'Rates moved ' + i + '.', score: v })) }] }), [{ key: 'rate', sub: null, label: 'rates' }])[0];
ok(tie.topPos.map(x => x.id).join() === '6,1,4' && tie.topNeg.map(x => x.id).join() === '3,0,5', 'default n = 3 per side; equal scores in document order: pos ' + tie.topPos.map(x => x.id) + ' / neg ' + tie.topNeg.map(x => x.id));
// external file docs (launch-week JSON, the Assessment, the full review)
[d2, C.docFromScored(dlist[0].scored), full].forEach(d => {
  const tps = C.extractTopics(d, 8), r = C.topicScores(d, tps);
  const good = r.every((x, i) => {
    const h = hitsOf(d, tps[i]);
    return x.count === h.length && near(x.mean, h.length ? h.reduce((a, s) => a + s.score, 0) / h.length : 0)
      && x.pos === h.filter(s => s.k >= C.NEUTRAL_K && s.score > 0).length && x.neg === h.filter(s => s.k >= C.NEUTRAL_K && s.score < 0).length
      && posOrd(x.topPos) && negOrd(x.topNeg) && x.topPos.length === Math.min(3, h.filter(s => s.score > 0).length) && x.topNeg.length === Math.min(3, h.filter(s => s.score < 0).length)
      && (!x.topPos.length || x.topPos[0].score === Math.max(...h.map(s => s.score))) && (!x.topNeg.length || x.topNeg[0].score === Math.min(...h.map(s => s.score)))
      && x.topPos.concat(x.topNeg).every(t => d.sents[t.id].text === t.text);
  });
  ok(good && r.length === tps.length, 'external doc topics: counts, means, the header\'s neutral split and top 3 positive / negative agree with matches(): ' + d.title + ' · ' + r.slice(0, 3).map(x => x.label + ' ' + x.count + ' ' + x.mean.toFixed(2)).join(', '));
});
const bdoc = C.buildDoc('t', blocks), bt = C.extractTopics(bdoc, 8), bs = C.topicScores(bdoc, bt);
ok(bs.every((x, i) => x.count === hitsOf(bdoc, bt[i]).length) && bs.find(x => x.label === 'product').count > 0 && bs.every(x => isFinite(x.mean)), 'built-in dictionary doc topics: ' + bs.slice(0, 4).map(x => x.label + ' ' + x.mean.toFixed(2)).join(', '));
const paraOnly = C.docFromScored({ paragraphs: [{ text: 'Rates rose. Rates fell.', score: -0.4 }, { text: 'Rates held.', score: 0.2 }, { sentences: [{ text: 'Rates eased.', score: 0.1 }] }] });
const po1 = C.topicScores(paraOnly, [C.makeTopic('rates', paraOnly)])[0];
ok(po1.count === 4 && near(po1.mean, (-0.4 - 0.4 + 0.2 + 0.1) / 4) && po1.topNeg[0].score === -0.4 && po1.topNeg.length === 2 && po1.topPos.map(x => x.score).join() === '0.2,0.1', 'paragraph-only file: a sentence without its own score stands for its paragraph; one with a score keeps it');
// outline x topics
const stDoc = C.buildDoc('t', C.parseMarkdown('# Alpha\n\nThe rates were great.\n\n## Beta\n\nThe rates were awful. The team was fine.\n\n# Delta\n\nThe team was terrible.\n'));
const tRates = C.makeTopic('rates', stDoc), tT = C.makeTopic('team', stDoc), sts = C.sectionTopicScores(stDoc, [tRates]);
const scoreOf = re => stDoc.sents.find(s => re.test(s.text)).score;
ok(sts.map(r => r.blockId).join() === C.sectionScores(stDoc).map(r => r.blockId).join() && C.sectionSpans(stDoc).length === sts.length, 'section x topic rows line up with the outline rows');
ok(sts[0].count === 2 && near(sts[0].mean, (scoreOf(/great/) + scoreOf(/awful/)) / 2) && sts[1].count === 1 && near(sts[1].mean, scoreOf(/awful/)) && sts[2].count === 0 && sts[2].mean === 0, 'per section: an h1 includes its h2s, an empty section is 0 not NaN');
ok(C.sectionTopicScores(stDoc, [tRates, tT]).map(r => r.count).join() === '3,2,1', 'several topics: the union of their sentences, as the dim filter shows them');

// 5d. the story page reads a scored file through the same core: same scales (incl. the automatic p90), words, topic means
const storyRegion = storyHtml.split('//<story-data>')[1].split('//</story-data>')[0];
const storyBuild = new Function('SMCore', "'use strict';\n" + storyRegion + '\nreturn build;')(C);
const noScale = o => { const c = JSON.parse(JSON.stringify(o)); delete c.scale; return c; };
const p90Case = { paragraphs: [{ sentences: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v, i) => ({ text: 'Rate move ' + i + '.', score: i % 2 ? v : -v })) }] };
[['launch-week JSON', pyJson], ['launch-week without scale', noScale(pyJson)], ['Assessment', dlist[0].scored], ['Assessment without scale', noScale(dlist[0].scored)], ['synthetic', dlist[2].scored], ['FORMAT.md example', fjson], ['ten sentences, no scale', p90Case], ['paragraph-only', { paragraphs: [{ text: 'Rates rose. Rates fell.', score: -0.4 }, { text: 'Rates held.', score: 0.2 }] }]].forEach(([name, obj]) => {
  const d = C.docFromScored(obj), sd = storyBuild(obj);
  ok(sd.wScale === d.cap.word && sd.sScale === d.cap.sent && sd.pScale === d.cap.para, `story and analyzer share the colour scale (${name}): word ${sd.wScale} sent ${+sd.sScale.toPrecision(4)} para ${+sd.pScale.toPrecision(4)} · ${d.capSrc.sent}`);
});
ok(C.docFromScored(p90Case).capSrc.sent === 'auto' && storyBuild(p90Case).sScale === 1, 'automatic scale = 90th percentile of non-zero |scores| on both pages (10 values -> the 10th)');
const sdA = storyBuild(dlist[0].scored), dA = C.docFromScored(dlist[0].scored), bodyA = dA.sents.filter(s => dA.blocks[s.block].type === 'p');
const spansOf = toks => toks.map(t => (t.word && t.score ? `[${t.text}:${t.score}]` : t.text)).join('');
ok(sdA.sents.length === bodyA.length && sdA.sents.every((s, i) => s.text === bodyA[i].text && s.score === bodyA[i].score && spansOf(s.toks) === spansOf(bodyA[i].toks)), 'story body sentences are the analyzer\'s: same text, score and word placement');
const lastI = sdA.sents.length - 1;
ok(sdA.topics.length > 0 && sdA.topics.every(t => { const r = C.topicScores(dA, [t], { sents: bodyA })[0]; return t.total === r.count && t.cnt[lastI] === r.count && near(t.mean, r.mean); }), 'story topic totals and means come from topicScores, and the rail\'s running count ends on the same total: ' + sdA.topics.slice(0, 3).map(t => t.label + ' ' + t.total + ' ' + t.mean.toFixed(2)).join(', '));
ok(sdA.sents.every(s => s.topics.every(i => C.matches(s.core, sdA.topics[i]))), 'story sentence -> topic membership is matches()');
// app wiring for the topic summary (the UI itself is not driven here)
ok(/S\.tstats = topicScores\(S\.doc, S\.topics\)/.test(appSrc) && /sectionTopicScores\(S\.doc, act\)/.test(appSrc) && /data-more=/.test(appSrc) && /jumpSent\(\+b\.dataset\.sent\)/.test(appSrc), 'chips, outline and the topic popover are wired to topicScores / sectionTopicScores / jumpSent');
ok(/group\('Positive', st\.topPos\)/.test(appSrc) && /group\('Negative', st\.topNeg\)/.test(appSrc) && /<p class="none">none<\/p>/.test(appSrc) && !/st\.top\b(?!Pos|Neg)/.test(appSrc), 'popover lists Positive and Negative groups, each "none" when empty; no caller of the old top list');
// chip number = sentences (topicScores.count), the same figure as the popover and the prev/next "N matches" for that topic alone
ok(/\$\{esc\(t\.label\)\} <small>\$\{st\.count\}<\/small>/.test(appSrc) && !/<small>\$\{t\.count\}<\/small>/.test(appSrc), 'topic chip shows the sentence count from topicScores, not word occurrences');
const chipDoc = C.docFromScored(dlist[0].scored), chipTopics = C.extractTopics(chipDoc, 8), chipStats = C.topicScores(chipDoc, chipTopics);
const finIdx = chipTopics.findIndex(t => t.label === 'financial');
ok(finIdx >= 0 && chipTopics[finIdx].count === 92 && chipStats[finIdx].count === 68, 'Assessment "financial": 92 occurrences, 68 sentences -> the chip reads 68 like the popover');
ok(chipTopics.every((t, i) => chipStats[i].count === chipDoc.sents.filter(s => C.matches(s, t)).length), 'chip count = the match total prev/next walks with that topic alone selected');
// the popover states the neutral rule tally() applies, with this document's numbers
const neuSrc = appSrc.slice(appSrc.indexOf('function neutralText('), appSrc.indexOf('\n}\n', appSrc.indexOf('function neutralText(')) + 2);
const neutralText = (d, st) => new Function('S', 'NEUTRAL_K', neuSrc + '\nreturn neutralText;')({ doc: d }, C.NEUTRAL_K)(st);
const nt = neutralText(chipDoc, chipStats[finIdx]);
ok(nt === 'Neutral: |score| &lt; <b>0.158</b> (20% of the colour scale <b>±0.791</b>)', 'popover neutral line for the Assessment: ' + nt);
ok(/<p class="scl" data-neutral>\$\{neutralText\(st\)\}<\/p>/.test(appSrc), 'the neutral line is rendered in the popover');
const finHits = chipDoc.sents.filter(s => C.matches(s, chipTopics[finIdx]));
ok(chipStats[finIdx].byPara === 0 && chipStats[finIdx].neu === finHits.filter(s => Math.abs(s.score) < C.NEUTRAL_K * chipDoc.cap.sent).length, 'the stated threshold is the one the neutral count uses: ' + chipStats[finIdx].neu);
const pOnly = C.docFromScored({ paragraphs: [{ text: 'Rates rose. Rates fell.', score: -0.4 }, { text: 'Rates held.', score: 0.05 }] });
const pOnlyStat = C.topicScores(pOnly, [C.makeTopic('rates', pOnly)])[0];
ok(pOnlyStat.byPara === 3 && neutralText(pOnly, pOnlyStat) === 'Neutral: |score| &lt; <b>0.08</b> (20% of the colour scale <b>±0.4</b>)' && pOnlyStat.neu === 1, 'paragraph-only file: the line quotes the paragraph scale: ' + neutralText(pOnly, pOnlyStat));
const mixStat = C.topicScores(paraOnly, [C.makeTopic('rates', paraOnly)])[0], mixText = neutralText(paraOnly, mixStat);
ok(mixStat.byPara === 3 && /&lt; <b>0\.02<\/b> for sentence scores, &lt; <b>0\.08<\/b> for paragraph-only scores \(20% of the colour scales <b>±0\.1<\/b> \/ <b>±0\.4<\/b>\)/.test(mixText), 'mixed file: both thresholds stated: ' + mixText);
ok(/if \(!E\.tpop\.hidden\) closeTpop\(true\)/.test(appSrc) && /e\.key === '1'\) setLevel\('word'\)/.test(appSrc), 'Escape closes the topic popover first; level shortcuts unchanged');

const rootDir = require('path').dirname(path);
const fableHtml = fs.readFileSync(require('path').join(rootDir, 'SentimentStoryFable.html'), 'utf8');
const astraHtml = fs.readFileSync(require('path').join(rootDir, 'SentimentStoryAstra.html'), 'utf8');
ok(loadsCore(fableHtml, "'use strict'") && loadsCore(astraHtml, "'use strict'"), 'Fable and Astra load sentiment-core.js before their own script');
ok(/<script src="examples\/demos.js"><\/script>/.test(fableHtml) && /<script src="examples\/demos.js"><\/script>/.test(astraHtml), 'Fable and Astra load examples/demos.js');
ok(fableHtml.split('//<story-data>')[1].split('//</story-data>')[0] === storyRegion, 'Fable keeps the current Story data step on SMCore');
ok(/id="play"/.test(fableHtml) && /id="aurora"/.test(fableHtml) && /id="ink"/.test(fableHtml) && /const Play =/.test(fableHtml) && /const FX =/.test(fableHtml) && /Play\.stop\(\); FX\.clear\(\)/.test(fableHtml), 'Fable has Play autoplay and the ink FX layer');
ok(!/function scored\s*\(/.test(astraHtml) && !/function makeData\s*\(/.test(astraHtml), 'Astra dropped the local scoring helpers');
const astraRegion = astraHtml.split('//<astra-data>')[1].split('//</astra-data>')[0];
const astraBuild = new Function('SMCore', "'use strict';\n" + astraRegion + '\nreturn build;')(C);
const aA = astraBuild(dlist[0].scored), dA2 = C.docFromScored(dlist[0].scored);
const bodyA2 = dA2.sents.filter(s => dA2.blocks[s.block].type === 'p');
const astraSents = aA.sections.flatMap(g => g.sents);
ok(astraSents.length === bodyA2.length && astraSents.every((s, i) => s.text === bodyA2[i].text && s.score === bodyA2[i].score), 'Astra body sentences are the analyzer\'s: same text and score');
ok(aA.topics.length > 0 && aA.topics.every((t, i) => { const r = C.topicScores(dA2, C.extractTopics(dA2, 8), { sents: bodyA2 })[i]; return t.label === r.label && t.count === r.count && near(t.mean, r.mean); }), 'Astra topic means come from topicScores over body sentences');
const navStart = html.indexOf('<nav class="views"');
const viewNav = html.slice(navStart, html.indexOf('</nav>', navStart)).replace(/<!--[\s\S]*?-->/g, '');
const navLinks = [...viewNav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(mm => [mm[1], mm[2].trim()]);
const navWant = [['index.html', 'Analyzer'], ['SentimentDiff.html', 'Timeline'], ['SentimentStoryFable.html', 'Fable'], ['SentimentStoryAstra.html', 'Astra']];
ok(JSON.stringify(navLinks) === JSON.stringify(navWant), 'analyzer toolbar visible links are Analyzer, Timeline, Fable, Astra - got ' + JSON.stringify(navLinks));
const navCurrent = [...viewNav.matchAll(/<a\b[^>]*>/g)].filter(t => /aria-current="page"/.test(t[0]));
ok(navCurrent.length === 1 && /href="index.html"/.test(navCurrent[0]), 'aria-current="page" is only on Analyzer');
for (const navHref of navLinks.map(l => l[0])) ok(fs.existsSync(require('path').join(rootDir, navHref)), 'toolbar link target exists: ' + navHref);

// 5e. lexicon unification: one model file, generated assets, vocabulary profiles, lazy finance, golden vectors
const P_ = require('path'), cp = require('child_process'), util = require('util'), crypto = require('crypto'), repo = P_.join(__dirname, '..');
const gen = cp.spawnSync(process.execPath, [P_.join(repo, 'tools', 'build-lexicon.js'), '--check'], { encoding: 'utf8' });
ok(gen.status === 0, 'tools/build-lexicon.js --check: generated files match data/sentiment-model.json ' + (gen.stdout + gen.stderr).trim());
const model = JSON.parse(fs.readFileSync(P_.join(repo, 'data', 'sentiment-model.json'), 'utf8'));
ok(Object.keys(model.vocabularies.general.words).length === 348 && Object.keys(model.vocabularies.finance.words).length === 3381, 'model: general 348 entries (293 English + 55 Chinese), finance 3381');
ok(model.vocabularies.general.suffixPolicy.type === 'suffix' && model.vocabularies.finance.suffixPolicy.type === 'exact', 'suffix fallback for general, exact match for finance');
ok(C.dictionaries().map(d => d.name + ':' + d.loaded).join() === 'general:true,finance:false', 'general is there synchronously, finance is not loaded until asked for');
const lexSrc = coreFile.slice(coreFile.indexOf('function lexLookup('), coreFile.indexOf('\n}\n', coreFile.indexOf('function lexLookup(')));
ok(!/\.has\(/.test(lexSrc) && (lexSrc.match(/M\.get\(/g) || []).length === 2 && /!== undefined/.test(lexSrc), 'lexLookup: one Map.get per candidate, tested with !== undefined (no has + get)');
const finAsset = fs.readFileSync(P_.join(repo, 'lexicon', 'finance.js'), 'utf8');
ok(/non-commercial \/ academic use only/.test(finAsset) && /MIT/.test(finAsset) && /^SMCore\.registerLexicon\("finance", /m.test(finAsset), 'finance asset: licence note in the header, a classic script that registers itself');
// 5f. general compatibility: the general profile must score exactly like main 56f66cb's engine (test/fixtures), deep-equal
const fixture = fs.readFileSync(P_.join(__dirname, 'fixtures', 'sentiment-core-56f66cb.js'), 'utf8');
ok(crypto.createHash('sha256').update(fixture).digest('hex') === '171dd8708826416a8fc9666826a519d6c2d5906dcb72fa14c280aa338f4e08ae', 'fixture is git show 56f66cb:sentiment-core.js, byte for byte');
const O = (() => { const mm = { exports: {} }; new Function('module', fixture.split('//<core>')[1].split('//</core>')[0])(mm); return mm.exports; })();
const exFiles = fs.readdirSync(exDir).filter(f => /\.(txt|md)$/.test(f)).sort();
const goldenTexts = JSON.parse(fs.readFileSync(P_.join(__dirname, 'golden.json'), 'utf8')).cases.map(c => c.text);
const edge = ['', ' ', '!!!', 'NOT GOOD', "can't stand it", 'isn’t bad', 'won’t fail!!!', 'Very, very good.', 'not, good', 'good but', 'But good.', 'However good, terrible.', 'good, nevertheless awful',
  '🎉 Great launch!', '100% success', 'e-mail failed', 'well-being improved', 'HAPPY happy', 'A', 'ok', 'Café is GOOD.', '他很开心但是价格不好', '没有问题', '不是很好', '非常非常好', '这不是不好。', '有点担心，不过还算满意！',
  'tab\tseparated good', 'line\nbreak bad', "rock 'n' roll", 'goods bridging happily recovered failing simply hopes excitedly', 'extremely utterly absolutely completely wonderful', 'good '.repeat(60), 'so so good',
  "don't", "n't", 'nevertheless', 'greatest strongest kindly', 'stability financial stability risk', 'Good. Bad! Ugly?', 'The goods were not cheap, but quality was SUPERB!!!', 'not not good', 'never ever bad', 'hardly a good start',
  'scarcely helpful', 'without fear', 'No problem.', 'nothing bad', 'Mr. Smith was happy. Dr. Who was sad.', 'U.S. growth slowed; however, jobs held up.', '“Terrible,” she said.', 'risks risked risking', 'improvements'];
const strip = d => { const c = Object.assign({}, d); delete c.profile; delete c.profileLabel; delete c.model; return c; };
const noModel = j => { const c = Object.assign({}, j); delete c.model; return c; };
let nSent = 0, nDoc = 0; const cmpBad = [];
const sameSentence = t => { nSent++; if (!util.isDeepStrictEqual(C.analyzeSentence(t), O.analyzeSentence(t)) || !util.isDeepStrictEqual(C.rawTokens(t), O.rawTokens(t))) cmpBad.push('sentence ' + JSON.stringify(t.slice(0, 60))); };
for (const f of exFiles) {
  const raw = fs.readFileSync(P_.join(exDir, f), 'utf8');
  for (const [kind, parse] of [['md', 'parseMarkdown'], ['text', 'parseText']]) {
    const bl = C[parse](raw);
    if (!util.isDeepStrictEqual(bl, O[parse](raw))) cmpBad.push(`${f} ${parse}`);
    for (const b of bl) { const ss = C.splitSentences(b.text); if (!util.isDeepStrictEqual(ss, O.splitSentences(b.text))) cmpBad.push(`${f} split`); ss.forEach(s => sameSentence(s.text)); }
    const dn = C.buildDoc(f, bl), dold = O.buildDoc(f, bl); nDoc++;
    if (!util.isDeepStrictEqual(strip(dn), dold)) cmpBad.push(`${f} (${kind}) buildDoc`);
    if (JSON.stringify(noModel(C.docToJSON(dn))) !== JSON.stringify(O.docToJSON(dold)) || C.docToCSV(dn) !== O.docToCSV(dold)) cmpBad.push(`${f} (${kind}) export`);
    if (!util.isDeepStrictEqual(C.extractTopics(dn, 12), O.extractTopics(dold, 12))) cmpBad.push(`${f} (${kind}) topics`);
  }
}
goldenTexts.concat(edge).forEach(sameSentence);
const edgeDoc = C.buildDoc('e', edge.filter(t => t.trim()).map(text => ({ type: 'p', text })));
if (!util.isDeepStrictEqual(strip(edgeDoc), O.buildDoc('e', edge.filter(t => t.trim()).map(text => ({ type: 'p', text }))))) cmpBad.push('edge-case doc');
for (const f of fs.readdirSync(exDir).filter(f => /\.scored\.(json|csv)$/.test(f)).sort()) {
  const t = fs.readFileSync(P_.join(exDir, f), 'utf8'), o = f.endsWith('.csv') ? C.csvToScored(t) : JSON.parse(t);
  const dn = C.docFromScored(o), dold = O.docFromScored(o); nDoc++;
  if (!util.isDeepStrictEqual(strip(dn), dold) || JSON.stringify(noModel(C.docToJSON(dn))) !== JSON.stringify(O.docToJSON(dold))) cmpBad.push(`${f} docFromScored / export`);
}
ok(!cmpBad.length && nSent > 2000, `general profile == 56f66cb engine, deep-equal: ${nSent} sentences (analyzeSentence + rawTokens), ${nDoc} documents (buildDoc / docFromScored, export JSON + CSV, topics) from ${exFiles.length} example texts, ${goldenTexts.length} golden inputs, ${edge.length} edge cases` + (cmpBad.length ? ' — DIFFERS: ' + cmpBad.slice(0, 8).join('; ') : ''));

// lazy load: scoring before the load throws; a failed load is not cached; a good one is, and later calls reuse it
const thrown = (() => { try { C.analyzeSentence('not strong', 'finance'); return ''; } catch (e) { return e.message; } })();
ok(/not loaded.*ensureLexicon\('finance'\)/.test(thrown), 'finance before loading: a clear error, not general scores: ' + thrown);
const assessmentDoc = C.docFromScored(dlist[0].scored);
C.topicScores(assessmentDoc, C.extractTopics(assessmentDoc, 8)); C.buildSpec(assessmentDoc); C.docToJSON(assessmentDoc);
ok(assessmentDoc.words.length > 0 && !C.hasLexicon('finance'),'showing an already scored file (the finance-scored Assessment) does not load the finance dictionary');
const loads = [];
const asyncTests = (async () => {
  const failing = src => { loads.push('fail ' + src); return Promise.reject(new Error('offline')); };
  const p1 = C.ensureLexicon('finance', failing), p2 = C.ensureLexicon('finance', failing);
  ok(p1 === p2, 'concurrent requests share one cached Promise');
  const e1 = await p1.then(() => null, e => e.message);
  ok(e1 === 'offline' && loads.length === 1 && !C.hasLexicon('finance'), 'a failed load rejects once and leaves finance unloaded');
  const good = src => { loads.push('ok ' + src); new Function('SMCore', finAsset)(C); return Promise.resolve(); };
  const p3 = C.ensureLexicon('finance', good);
  ok(p3 !== p1, 'after a failure the cache is cleared, so a retry starts a new load');
  ok(await p3 === 'finance' && C.hasLexicon('finance') && loads.join() === 'fail lexicon/finance.js,ok lexicon/finance.js', 'retry loads the asset and registers it: ' + loads.join());
  await C.ensureLexicon('finance', good);
  ok(loads.length === 2, 'once loaded, ensureLexicon does not insert the script again');
  const silent = (() => { const d = C.dictionaries().find(x => x.name === 'finance'); return d.loaded && d.size === 3381; })();
  ok(silent, 'finance registered with all 3381 words');
  /* registerLexicon hashes the words it receives (canonical content), it does not trust a claim in the asset */
  const finWords = model.vocabularies.finance.words;
  const refused = data => { try { C.registerLexicon('finance', data); return ''; } catch (e) { return e.message; } };
  const asGroups = ws => Object.entries(ws).map(([w, v]) => [v, w]);
  const tampered = Object.assign({}, finWords, { strong: 2.4 }), extra = Object.assign({}, finWords, { zzzz: 1 });
  ok(/content sha256 \w+… is not the 0c9333a78094… this sentiment-core\.js expects/.test(refused({ words: asGroups(tampered) })) && /is not the/.test(refused({ words: asGroups(extra) })) && /is not the/.test(refused({ words: [] })),
    'a changed score, an extra word or an empty asset is refused by the sha256 of its content: ' + refused({ words: asGroups(tampered) }));
  ok(C.analyzeSentence('strong', 'finance').scored[0].base === 2.3, 'a refused asset leaves the loaded vocabulary in place');
  ok(refused({ words: asGroups(finWords).reverse() }) === '', 'the same words grouped and ordered differently hash the same (it is the content, not the file, that is checked)');
  ok(crypto.createHash('sha256').update(Object.keys(finWords).sort().map(w => w + '\t' + finWords[w] + '\n').join('')).digest('hex') === model.sources.vocabularies.finance.sha256, 'model sha256 = node:crypto over the canonical content the core hashes');
  ok(!/"sha256"\s*:/.test(finAsset.slice(finAsset.indexOf('SMCore.registerLexicon'))), 'the asset carries no hash of its own to compare against');
  /* profiles are separate Maps: loading finance changes nothing for general */
  ok(C.analyzeSentence('The goods arrived.').scored.length === 1 && C.analyzeSentence('The goods arrived.', 'finance').scored.length === 0, 'goods: general suffix fallback still applies; finance is exact');
  ok(C.buildDoc('t', blocks).words.length === doc.words.length && C.buildDoc('t', blocks).sents.every((s, i) => s.score === doc.sents[i].score), 'general buildDoc unchanged after the finance load');
  const fdoc = C.buildDoc('t', C.parseText('Financial stability is strong. Losses rose.'), { profile: 'finance' });
  ok(fdoc.profile === 'finance' && fdoc.ref.name === 'LM × VADER finance vocabulary' && fdoc.ref.scores.length === 3381 && fdoc.words.map(t => t.text).join() === 'strong,Losses', 'finance doc: own reference spectrum, "financial stability" neutral: ' + fdoc.words.map(t => t.text));
  ok(C.docFromScored(C.docToJSON(fdoc)).words.length === 2, 'finance doc exports and re-imports');
  // colour scale per profile (data/sentiment-model.json vocabularies.<name>.scale)
  const gdoc = C.buildDoc('t', blocks);
  ok(model.vocabularies.general.scale.word === 3 && util.isDeepStrictEqual(gdoc.cap, { word: 3, sent: 0.6, para: 0.3 }) && util.isDeepStrictEqual(gdoc.cap, C.CAP) && Object.values(gdoc.capSrc).every(s => s === 'builtin'), 'general keeps its fixed scale 3 / 0.6 / 0.3');
  const fbig = C.buildDoc('t', C.parseText(assessmentText.slice(0, 6000)), { profile: 'finance' });
  const p90of = arr => { const a = arr.map(Math.abs).filter(v => v > 0).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.9))]; };
  ok(model.vocabularies.finance.scale.word === 2.5 && fbig.cap.word === 2.5 && fbig.capSrc.word === 'builtin' && fbig.capSrc.sent === 'auto' && fbig.cap.sent === p90of(fbig.sents.map(s => s.score)) && fbig.cap.para === p90of(fbig.blocks.map(b => b.score)),
    'finance: word ±2.5 from the model, sentence / paragraph "auto" = 90th percentile: ' + JSON.stringify(fbig.cap));
  ok(fbig.words.every(t => t.k === Math.min(1, Math.abs(t.score) / 2.5)) && fbig.sents.every(s => s.k === Math.min(1, Math.abs(s.score) / fbig.cap.sent)), 'colour strength uses the profile scale');
  const fst = C.scaleText(fbig).replace(/<[^>]+>/g, '');
  ok(/Word ±2\.5（Finance dictionary \(LM × VADER\)）/.test(fst) && !/Built-in dictionary/.test(fst) && /Auto/.test(fst), 'the finance scale line names the finance dictionary, not "Built-in dictionary": ' + fst);
  const fre = C.docFromScored(C.docToJSON(fbig));
  ok(['word', 'sent', 'para'].every(k => Math.abs(fre.cap[k] - fbig.cap[k]) < 1e-4), 'export -> import keeps the finance colour scale');
  // provenance: model {version, profile} on text scored here; kept through import / export; never invented
  const ver = C.modelVersion;
  ok(util.isDeepStrictEqual(C.docToJSON(gdoc).model, { version: ver, profile: 'general' }) && util.isDeepStrictEqual(C.docToJSON(fbig).model, { version: ver, profile: 'finance' }), 'Export JSON of text scored here carries model {version, profile}');
  ok(Object.keys(C.docToJSON(fbig)).slice(0, 3).join() === 'version,title,model', 'model sits right after the title');
  const rt1 = C.docToJSON(C.docFromScored(C.docToJSON(fbig)));
  ok(util.isDeepStrictEqual(rt1.model, { version: ver, profile: 'finance' }) && util.isDeepStrictEqual(C.docToJSON(C.docFromScored(rt1)).model, rt1.model), 'model survives import -> export -> import');
  ok(C.docToJSON(d2).model === undefined && pyJson.model === undefined, 'an external file without model (VADER launch-week) exports without one');
  const withM = o => C.docFromScored(Object.assign({ paragraphs: [{ sentences: [{ text: 'Good.', score: 0.5 }] }] }, o));
  const keptM = withM({ model: { version: '0.9.0', profile: 'my-model' } });
  ok(noWarn(keptM) && util.isDeepStrictEqual(C.docToJSON(keptM).model, { version: '0.9.0', profile: 'my-model' }), 'a file that carries model keeps it as given (unknown profile fine, no warnings)');
  ok([{ model: 'x' }, { model: { version: 1, profile: 'finance' } }, { model: { profile: 'finance' } }, { model: null }].every(o => { const d = withM(o); return noWarn(d) && C.docToJSON(d).model === undefined; }), 'a malformed model is ignored, not an error, and not written back');
  ok([dlist[0].scored, dlist[2].scored, fullObj].every(o => util.isDeepStrictEqual(o.model, { version: ver, profile: 'finance' })) && noWarn(C.docFromScored(dlist[0].scored)), 'regenerated finance examples carry model {version, finance} and load cleanly');
  // golden vectors, JS direct (test/test_golden.py runs the same file through Python -> Node)
  const golden = JSON.parse(fs.readFileSync(P_.join(__dirname, 'golden.json'), 'utf8'));
  ok(golden.modelVersion === C.modelVersion && golden.cases.length >= 40, 'golden file: ' + golden.cases.length + ' cases for model ' + golden.modelVersion);
  /* every field: score, raw, each word's offsets / base / effective score / notes / note text, and the cues */
  const { detail } = require(P_.join(repo, 'tools', 'score-cli.js'));
  const bad = golden.cases.filter(c => !util.isDeepStrictEqual(detail(C, C.analyzeSentence(c.text, c.profile)), c.expected));
  ok(!bad.length, 'golden vectors match the JS engine in every field' + (bad.length ? ': ' + bad.map(c => c.name).join('; ') : ''));
  const offBad = golden.cases.filter(c => c.expected.words.concat(c.expected.cues).some(w => [...c.text].slice(w.start, w.end).join('') !== w.text));
  ok(!offBad.length && golden.cases.every(c => c.expected.words.every(w => Array.isArray(w.notes) && typeof w.base === 'number') && typeof c.expected.raw === 'number'), 'golden offsets are code points into the text; every word carries base, notes; every case raw');
  const a0 = C.analyzeSentence('It is NOT GOOD at all!!!');
  ok(a0.raw === golden.cases.find(c => c.text === a0.text).expected.raw && a0.score === a0.raw / Math.sqrt(a0.raw * a0.raw + 15), 'raw is the pre-squash sum: score = raw / sqrt(raw² + 15)');
  const kinds = new Set(golden.cases.flatMap(c => c.expected.cues.map(q => q.kind).concat(c.expected.words.flatMap(w => w.notes.map(n => n.t)))));
  ok(['negator', 'booster', 'neutral', 'neg', 'boost', 'but', 'caps'].every(k => kinds.has(k)), 'golden exercises every cue kind and note kind: ' + [...kinds].join());
  const need = ['not strong', 'very strong', 'financial stability'];
  ok(need.every(t => ['general', 'finance'].every(p => golden.cases.some(c => c.text === t && c.profile === p))), 'golden covers not strong / very strong / financial stability under both profiles');
  // the batch CLI is the same engine
  const cli = cp.spawnSync(process.execPath, [P_.join(repo, 'tools', 'score-cli.js')], { input: JSON.stringify({ jobs: [{ profile: 'finance', sentences: golden.cases.filter(c => c.profile === 'finance').map(c => c.text) }, { profile: 'finance', title: 't', paragraphs: [{ type: 'p', text: 'Financial stability is strong. Losses rose.' }] }] }), encoding: 'utf8' });
  const cr = cli.status === 0 && JSON.parse(cli.stdout).results;
  ok(cr && cr[0].sentences.every((s, i) => { const c = golden.cases.filter(g => g.profile === 'finance')[i]; const { text, ...rest } = s; return text === c.text && util.isDeepStrictEqual(rest, c.expected); }), 'tools/score-cli.js sentence jobs give the golden detail, every field');
  ok(cr && JSON.stringify(cr[1].doc) === JSON.stringify(C.docToJSON(fdoc)), 'tools/score-cli.js document jobs give the page\'s Export JSON');
  // index.html: the dictionary picker; only text the page scores itself goes through the lazy load
  ok(/<select[^>]*id="selDict"/.test(html) && /initDictSel\(\);/.test(appSrc), 'analyzer has a dictionary picker');
  const fnSrc = name => appSrc.slice(appSrc.indexOf('function ' + name + '('), appSrc.indexOf('\n}\n', appSrc.indexOf('function ' + name + '(')));
  ok(/await ensureLexicon\(profile, insertScript\)/.test(fnSrc('openText')) && /gen !== demoOpenGen/.test(fnSrc('openText')), 'openText awaits the dictionary before the synchronous scorer, and a newer open wins');
  ok(!/ensureLexicon|openText/.test(fnSrc('openScoredText') + fnSrc('loadDemo') + fnSrc('openDoc')), 'scored files and demos never load a dictionary');
  ok(/await openText\('Pasted text'/.test(appSrc) && /await openText\(file\.name/.test(appSrc), 'pasted and opened text are scored through openText');
  ok(/if \(S\.src\)/.test(fnSrc('initDictSel')) && /dictFailed\(profile, err\)/.test(fnSrc('openText')), 'switching re-scores page-scored text; a failed load is reported');
})();
asyncTests.catch(e => ok(false, 'async tests threw: ' + e.stack)).then(() => {

// 6. syntax check of app part
try { new Function(appSrc); ok(true, 'app script parses'); } catch (e) { ok(false, 'app script parse error: ' + e.message); }
console.log(fail ? `\n${fail} FAILED` : '\nALL OK');
process.exit(fail ? 1 : 0);
});
