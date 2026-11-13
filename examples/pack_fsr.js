#!/usr/bin/env node
/* Pack the RBA Financial Stability Review demos.
   Uses the page's own itemsToLines / linesToBlocks (eval'd from sentiment-core.js) and
   pdfjs-dist 3.11.174, the same version as the cdnjs script in index.html.
   Do not point this at a newer pdf.js: the joiner is sensitive to glyph metrics.

   The repo has no package.json. Install the pinned extractor beside the
   command, or point PDFJS_DIST at legacy/build/pdf.js:
   npm install pdfjs-dist@3.11.174
   PDFJS_DIST may be an absolute path. Otherwise the script requires
   pdfjs-dist from node_modules.

   Assessment is PDF pages 4–12 (printed pages 1–9, including Endnotes).
   Its Figure 1 has no text layer: fsr-assessment-supplement.md transcribes the RBA-authored
   vector figure and corrects the Endnotes numbering lost by PDF text extraction.
   node examples/pack_fsr.js --heads
   node examples/pack_fsr.js --from 4 --to 12 --txt examples/fsr-assessment-2026-10.txt --title "RBA Financial Stability Review (Oct 2026), Assessment"
   node examples/pack_fsr.js --from 1 --to 79 --txt examples/fsr-2026-10.txt --title "RBA Financial Stability Review (Oct 2026)" --side examples/fsr-2026-10.demo.js
   node examples/pack_fsr.js --repack-demos
   node examples/pack_fsr.js --rescore      re-score all three finance examples from their .txt / .md (after a model change)
*/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
let pdfPath = path.join(__dirname, 'financial-stability-review-2026-10.pdf');   // --pdf picks another edition
const ATTR = [
  'Source: Reserve Bank of Australia (2026), Financial Stability Review, October 2026.',
  'https://www.rba.gov.au/publications/fsr/2026/oct/',
  'Text is reproduced under the Creative Commons Attribution 4.0 International licence (https://creativecommons.org/licenses/by/4.0/).',
  "Sentiment scores were added by SentimentMarker and are not the Reserve Bank's. The Reserve Bank does not endorse this project.",
  'Graphs, tables, and series drawn from third parties (including the HILDA and BLADE material noted at the back of the Review) are not covered by that licence and are not part of the text demo.',
  'The Assessment includes a text-only transcription of Figure 1, credited to the RBA in the figure.',
].join(' ');

function loadCore() {
  const src = fs.readFileSync(path.join(root, 'sentiment-core.js'), 'utf8');
  const core = src.split('//<core>')[1].split('//</core>')[0];
  const m = { exports: {} };
  new Function('module', core)(m);
  return m.exports;
}

function loadPdfjs() {
  const dist = process.env.PDFJS_DIST || 'pdfjs-dist/legacy/build/pdf.js';
  return require(dist);
}

function keepBlock(b) {
  const t = (b.text || '').trim();
  if (!t) return false;
  if (/^(graph|figure|table|box|chart)\b/i.test(t)) return true;
  if (/^[-+−–]?\d[\d,.\s%]*%?$/.test(t)) return false;
  if (/^sources?\s*:/i.test(t) && t.length < 80) return false;
  if (/^[•·●]$/.test(t)) return false;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 8) {
    const avg = parts.reduce((n, p) => n + p.length, 0) / parts.length;
    if (avg <= 2 && !/[.!?。！？]/.test(t)) return false;
  }
  if (parts.length >= 4 && !/[.!?。！？]/.test(t)) {
    const nums = parts.filter(p => /\d/.test(p)).length;
    if (nums / parts.length >= 0.5) return false;
  }
  if (b.type !== 'h' && t.length < 40 && !/[.!?。！？]/.test(t)) return false;
  return true;
}

function blocksToText(blocks) {
  const body = blocks.filter(keepBlock).map(b => (b.type === 'h' ? (b.level === 2 ? '## ' : '# ') : '') + b.text.trim()).join('\n\n');
  return body + (body.endsWith('\n') ? '' : '\n');
}

/* Assessment only. The vector Figure 1 has no PDF text layer, and pdf.js attaches some
   Endnote numbers to the preceding note. Keep the verified transcription separate from
   generated text so a rerun cannot silently discard or scramble either section. */
function supplementAssessment(txt) {
  const broken = 'Recent developments related to global sovereign bond markets,\n\n## the AI investment boom, low market risk premia and operational resilience are also reinforcing risks to international financial system stability.';
  const joined = '## Recent developments related to global sovereign bond markets, the AI investment boom, low market risk premia and operational resilience are also reinforcing risks to international financial system stability.';
  if (!txt.includes(broken)) throw new Error('Assessment split heading changed; update the Assessment-only repair');
  txt = txt.replace(broken, joined);
  const caption = 'Figure 1: Key Global and Domestic Vulnerabilities of the Financial System';
  const at = txt.indexOf(caption), endnotes = txt.indexOf('\n\n## Endnotes', at);
  if (at < 0 || endnotes < 0 || txt.slice(at + caption.length, endnotes).trim()) throw new Error('Assessment Figure 1 / Endnotes boundary changed');
  const supplement = fs.readFileSync(path.join(__dirname, 'fsr-assessment-supplement.md'), 'utf8').trim();
  if (!supplement.includes('## Endnotes') || (supplement.match(/^Endnote [1-8]:/gm) || []).length !== 8) throw new Error('Assessment supplement is incomplete');
  return txt.slice(0, at + caption.length) + '\n\n' + supplement + '\n';
}

async function readPages(pdfjs, from, to) {
  const C = loadCore();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
  const numPages = doc.numPages;
  const last = Math.min(to || numPages, numPages);
  const first = Math.max(1, from || 1);
  const pages = [];
  for (let i = first; i <= last; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const vp = page.getViewport({ scale: 1 });
    pages.push({ num: i, height: vp.height, lines: C.itemsToLines(tc.items) });
  }
  await doc.destroy();
  return { C, pages, numPages };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
}

function score(txt, title, out) {
  const py = process.env.PYTHON || 'python';
  const r = spawnSync(py, [path.join(__dirname, 'score_financial.py'), txt, '--title', title, '-o', out], {
    cwd: root, stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

function writeSide(scoredPath, sidePath) {
  const scored = JSON.parse(fs.readFileSync(scoredPath, 'utf8'));
  const body = 'window.DEMO_FILES = window.DEMO_FILES || {};\n'
    + "window.DEMO_FILES['fsr-2026-10.scored.json'] = " + JSON.stringify(scored) + ';\n';
  const head = '/* Generated by examples/pack_fsr.js. Do not edit by hand.\n   ' + ATTR + ' */\n';
  fs.writeFileSync(sidePath, head + body);
  console.log('wrote ' + sidePath + ' (' + fs.statSync(sidePath).size + ' bytes)');
}

function repackDemos() {
  const assessment = JSON.parse(fs.readFileSync(path.join(__dirname, 'fsr-assessment-2026-10.scored.json'), 'utf8'));
  const synthetic = JSON.parse(fs.readFileSync(path.join(__dirname, 'financial-stability-review.scored.json'), 'utf8'));
  const demos = [
    { label: 'RBA Financial Stability Review · Oct 2026 (Assessment)', file: 'fsr-assessment-2026-10.scored.json', scored: assessment },
    { label: 'RBA Financial Stability Review · Oct 2026 (full)', file: 'fsr-2026-10.scored.json', src: 'examples/fsr-2026-10.demo.js' },
    { label: 'Synthetic demo · Meridian stress review', file: 'financial-stability-review.scored.json', scored: synthetic },
  ];
  const head = [
    '// Built-in demo articles (the data source of the article picker). Packed by examples/pack_fsr.js.',
    '// Regenerate Assessment: node examples/pack_fsr.js --from 4 --to 12 --txt examples/fsr-assessment-2026-10.txt --title "..."',
    '// Its Figure 1 and corrected Endnotes come from examples/fsr-assessment-supplement.md. Repack with --repack-demos.',
    '// The full review remains a separate lazy script; regenerate it only when its source changes.',
    '// Needs pdfjs-dist 3.11.174 (PDFJS_DIST or node_modules). The full review is a second classic script, not fetch().',
    '// ' + ATTR,
    'window.DEMOS = ' + JSON.stringify(demos) + ';\n',
  ].join('\n');
  const dest = path.join(__dirname, 'demos.js');
  fs.writeFileSync(dest, head);
  console.log('wrote ' + dest + ' (' + fs.statSync(dest).size + ' bytes)');
}

/* Re-score the three finance examples from their committed sources (no PDF, no pdfjs-dist): the two RBA texts
   produced above and the hand-written synthetic review. Then rebuild the lazy full-review script and demos.js. */
const RESCORE = [
  ['fsr-assessment-2026-10.txt', 'RBA Financial Stability Review (Oct 2026), Assessment'],
  ['fsr-2026-10.txt', 'RBA Financial Stability Review (Oct 2026)'],
  ['financial-stability-review.md', 'Meridian Financial Stability Review (Fictional Demonstration)'],
];
function rescore() {
  for (const [src, title] of RESCORE) score(path.join(__dirname, src), title, path.join(__dirname, src.replace(/\.(txt|md)$/i, '.scored.json')));
  writeSide(path.join(__dirname, 'fsr-2026-10.scored.json'), path.join(__dirname, 'fsr-2026-10.demo.js'));
  repackDemos();
}

async function main() {
  if (arg('--repack-demos')) { repackDemos(); return; }
  if (arg('--rescore')) { rescore(); return; }
  if (arg('--side-only')) {
    writeSide(path.resolve(root, arg('--json')), path.resolve(root, arg('--side')));
    return;
  }
  const pdfjs = loadPdfjs();
  const pdfArg = arg('--pdf');
  if (pdfArg && pdfArg !== true) pdfPath = path.resolve(process.cwd(), pdfArg);
  const from = Number(arg('--from', 1));
  // the default PDF keeps its documented range (1-79); another edition defaults to all of its pages
  const to = Number(arg('--to', pdfArg && pdfArg !== true ? 9999 : 79));
  const { C, pages, numPages } = await readPages(pdfjs, from, to);
  console.log('pdf pages ' + numPages + ', read ' + pages[0].num + '-' + pages[pages.length - 1].num);
  if (arg('--heads')) {
    for (const p of pages) {
      const text = p.lines.map(l => l.text).join(' ').replace(/\s+/g, ' ').slice(0, 110);
      console.log(String(p.num).padStart(3) + '  ' + text);
    }
    return;
  }
  const blocks = C.linesToBlocks(pages.map(p => ({ height: p.height, lines: p.lines })));
  let txt = blocksToText(blocks);
  const txtPath = path.resolve(root, arg('--txt'));
  if (path.basename(txtPath) === 'fsr-assessment-2026-10.txt') {
    if (from !== 4 || to !== 12) throw new Error('Assessment generation requires PDF pages 4–12');
    txt = supplementAssessment(txt);
  }
  fs.writeFileSync(txtPath, txt);
  console.log('wrote ' + txtPath + ' (' + txt.length + ' chars, ' + blocks.filter(keepBlock).length + ' blocks)');
  const title = arg('--title');
  if (title && title !== true) score(txtPath, title, txtPath.replace(/\.txt$/i, '.scored.json'));
  const side = arg('--side');
  if (side && side !== true) writeSide(txtPath.replace(/\.txt$/i, '.scored.json'), path.resolve(root, side));
}

main().catch(err => { console.error(err); process.exit(1); });
