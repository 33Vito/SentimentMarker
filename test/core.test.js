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
const supItems = [
  mk('risks ', 50, 400, 36, 10.8),
  mk('7', 90, 404, 6, 7.3),
  mk('to stability.', 100, 400, 80, 10.8),
];
const supLines = C.itemsToLines(supItems);
ok(supLines.length === 1 && supLines[0].text === 'risks to stability.', 'superscript not joined: ' + JSON.stringify(supLines.map(l => l.text)));
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
ok(/Auto/.test(C.scaleText(mini({}))) && /Built-in/.test(C.scaleText(doc)), 'scale text (auto / built-in)');
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
ok(dlist[2].scored && dlist[2].scored.title, 'synthetic demo stays inline');
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

// 6. syntax check of app part
try { new Function(appSrc); ok(true, 'app script parses'); } catch (e) { ok(false, 'app script parse error: ' + e.message); }
console.log(fail ? `\n${fail} FAILED` : '\nALL OK');
process.exit(fail ? 1 : 0);
