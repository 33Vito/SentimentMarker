'use strict';
/* SentimentDiff.html, without a browser.

   Extracts the inline script, stubs document.querySelector, and renders every
   group against every edition in absolute and relative mode. A small fixture
   covers the review bugs (n == 1 band, relative headline, one-sided evidence,
   trend gaps, score 0, provenance). The committed pack is then exhausted the
   same way.

   The default run also rebuilds examples/fsr-timeline.diff.js and compares it
   byte for byte (`python examples/build_fsr_timeline.py --check`).
   Set SM_DIFF_SKIP_CHECK=1 to run only the page smoke.
*/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'SentimentDiff.html'), 'utf8');
const code = html.replace(/<!--[\s\S]*?-->/g, '');
assert.equal(code.includes('fetch('), false, 'file:// must not depend on fetch');
assert.equal(html.includes('claude:viewport-fit-sides'), false);
assert.match(html, /<html lang="en">/);
assert.match(html, /<script src="examples\/fsr-timeline\.diff\.js"><\/script>/);
assert.match(html, /data-v="assessment"/);

const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(inline.length, 1, 'one inline script');
const source = inline[0][1];
assert.match(source, /window\.__smDiffTest/);
assert.equal(/95% CI|sampling noise/.test(source), false);
assert.equal(/Number\(s\.se\)\s*\|\|/.test(source), false, 'a null standard error must not become 0');
assert.match(source, /if \(w && w\[2\]\)/);

function noBad(text, where) {
  assert.equal(text.includes('NaN'), false, where + ' contains NaN');
  assert.equal(/\bundefined\b/.test(text), false, where + ' contains undefined');
}

function mount(files) {
  const nodes = new Map();
  const make = id => ({
    id,
    innerHTML: '',
    textContent: '',
    hidden: false,
    value: '',
    disabled: false,
    dataset: {},
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollIntoView() {},
  });
  for (const id of ['file', 'tl', 'kindSeg', 'modeSeg', 'sortSeg', 'lede', 'title', 'badges', 'foot', 'oneoff', 'tlsub', 'detail']) {
    nodes.set(id, make(id));
  }
  const context = {
    console,
    document: {
      querySelector(sel) {
        return typeof sel === 'string' && sel.startsWith('#') ? (nodes.get(sel.slice(1)) || null) : null;
      },
    },
    DIFF_FILES: files,
    innerWidth: 1400,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'SentimentDiff.html' });
  const api = context.__smDiffTest;
  assert.ok(api && api.renderTable && api.renderDetail && api.rows && api.setData && api.st);
  return { api, nodes };
}

function rowOf(table, title) {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = table.match(new RegExp('<tr><td class="gl" title="' + esc + '">[\\s\\S]*?</tr>'));
  assert.ok(m, 'missing row ' + title);
  return m[0];
}

function stat(n, mean, se) {
  return { n, mean, se, neg: 0, pos: 0 };
}

function fixture() {
  const baseStats = () => ({
    all: stat(8, 0.1, 0.05),
    't:houses': stat(8, 0.2, 0.08),
    't:gap': stat(8, 0.3, 0.04),
    't:solid': stat(8, 0.15, 0.04),
    't:tiny': stat(1, 0.4, 0),
    't:nullse': stat(8, 0.05, null),
    't:cyber': stat(0, null, null),
    'as:all': stat(6, 0.11, 0.05),
    's:intro': stat(6, 0.1, 0.05),
  });
  const sentence = {
    t: 'ZEROWORD is calm but NEGWORD failed.',
    s: 0.2, sec: 0, tp: [0],
    w: [[0, 8, 0, 0], [21, 28, -1.5, 2.2, 'negated not']],
  };
  const ids = ['2024-03', '2024-09', '2025-04', '2026-10'];
  const slugs = ['mar', 'sep', 'apr', 'oct'];
  const labels = ['Mar 2024', 'Sep 2024', 'Apr 2025', 'Oct 2026'];
  const editions = ids.map((id, i) => ({
    id, label: labels[i], title: labels[i], sections: ['intro'],
    stats: baseStats(),
    sentences: [Object.assign({}, sentence, { w: sentence.w.map(w => w.slice()) })],
    source: 'https://www.rba.gov.au/publications/fsr/' + id.slice(0, 4) + '/' + slugs[i] + '/',
    assessmentPages: [4, 6],
    scope: 'Full Financial Stability Review text layer',
    quality: 'Extracted with examples/pack_fsr.js',
  }));
  editions[2].stats['t:gap'] = stat(0, null, null);
  editions[3].stats.all = stat(8, 0.12, 0.05);
  editions[3].stats['t:houses'] = stat(8, 0.22, 0.08);
  editions[3].stats['t:cyber'] = stat(3, -0.3, null);
  editions[3].pages = [1, 79];
  editions[3].assessmentPages = [4, 12];
  editions[3].sentences.push({
    t: 'Only the later edition names cyber risk.',
    s: -0.3, sec: 0, tp: [1], w: [],
  });
  const diffs = [1, 2, 3].map(to => {
    const groups = {};
    for (const id of ['all', 't:houses', 't:gap', 't:solid', 't:tiny', 't:nullse', 'as:all', 's:intro']) {
      const delta = (id === 'all' || id === 't:houses') && to === 3 ? 0.02 : 0;
      groups[id] = {
        delta, edit: delta, added: 0, removed: 0,
        counts: { u: 1, e: id === 't:houses' ? 1 : 0, a: 0, r: 0 },
        items: id === 't:houses' ? [['e', 0, 0, delta ? 0.002 : 0]] : [],
      };
    }
    if (to === 3) {
      groups['t:cyber'] = {
        delta: null, edit: null, added: null, removed: null, oneSided: 'added',
        counts: { u: 0, e: 0, a: 1, r: 0 },
        items: [['a', null, 1, null]],
      };
    }
    return { from: to - 1, to, pairs: [[0, 0, 'u', 1]], removed: [], added: [], ops: {}, unchangedScoreMismatch: 0, groups };
  });
  return {
    format: 'sentiment-diff', version: 1, title: 'Fixture',
    model: { version: '1.0.0', profile: 'finance' },
    params: { minSim: 0.55, neutral: 0.2, minHits: 5 },
    scale: { word: 2.5, sentence: 1, mean: 0.5, delta: 0.5 },
    topics: [{ id: 'houses', label: 'Households', patterns: ['households?'] }, { id: 'cyber', label: 'Cyber', patterns: ['cyber\\w*'] }],
    groups: [
      { id: 'all', label: 'All text', kind: 'all' },
      { id: 't:houses', label: 'Households', kind: 'topic', patterns: ['households?'] },
      { id: 't:gap', label: 'Gap topic', kind: 'topic' },
      { id: 't:solid', label: 'Solid topic', kind: 'topic' },
      { id: 't:tiny', label: 'Tiny topic', kind: 'topic' },
      { id: 't:nullse', label: 'Null spread', kind: 'topic' },
      { id: 't:cyber', label: 'Cyber', kind: 'topic', patterns: ['cyber\\w*'] },
      { id: 'as:all', label: 'Assessment narrative', kind: 'assessment' },
      { id: 's:intro', label: 'Introduction', kind: 'section' },
    ],
    sectionKeys: ['intro'],
    editions, diffs,
  };
}

function exhaustData(api, nodes, data, label) {
  for (const kind of ['topic', 'section', 'assessment']) {
    for (const mode of ['abs', 'rel']) {
      api.st.kind = kind;
      api.st.mode = mode;
      api.st.filter = 'all';
      api.st.shown = 12;
      api.renderTable();
      noBad(nodes.get('tl').innerHTML, label + ' table ' + kind + ' ' + mode);
      noBad(nodes.get('foot').innerHTML, label + ' foot');
      for (const g of api.rows()) {
        for (let k = 1; k < data.editions.length; k++) {
          api.st.sel = { g: g.id, k };
          try {
            api.renderDetail();
          } catch (err) {
            throw new Error(label + ' ' + kind + ' ' + mode + ' ' + g.id + ' k=' + k + ': ' + err.message);
          }
          noBad(nodes.get('detail').innerHTML, label + ' ' + g.id + ' k=' + k + ' ' + mode);
        }
      }
    }
  }
}

function runFixture() {
  const data = fixture();
  const { api, nodes } = mount({ 'fixture.diff.json': data });
  noBad(nodes.get('lede').innerHTML, 'fixture lede');
  assert.match(nodes.get('lede').innerHTML, /not by itself a new or deleted policy/);
  assert.match(nodes.get('foot').innerHTML, /standard error of the mean sentence score/);
  assert.match(nodes.get('foot').innerHTML, /not confidence intervals/);

  api.st.kind = 'topic';
  api.st.mode = 'abs';
  api.renderTable();
  const table = nodes.get('tl').innerHTML;
  const k0 = [...table.matchAll(/<button\b[^>]*data-k="0"[^>]*>/g)];
  assert.ok(k0.length > 0, 'column 0 is present');
  for (const m of k0) assert.match(m[0], /\bdisabled\b/, 'column 0 stays disabled');

  const gap = rowOf(table, 'Gap topic');
  const gapLines = [...gap.matchAll(/<polyline points="([^"]+)"/g)].map(m => m[1]);
  assert.equal(gapLines.length, 1, 'a hole splits the trend');
  assert.ok(gapLines[0].includes('4,'), gapLines[0]);
  assert.equal(gapLines[0].includes('106,'), false, 'the line must not cross the missing edition: ' + gapLines[0]);

  const solid = rowOf(table, 'Solid topic');
  const solidLines = [...solid.matchAll(/<polyline points="([^"]+)"/g)].map(m => m[1]);
  assert.equal(solidLines.length, 1);
  assert.ok(solidLines[0].includes('4,') && solidLines[0].includes('106,'), solidLines[0]);

  const tiny = rowOf(table, 'Tiny topic');
  assert.equal(tiny.includes('<polygon'), false, 'n == 1 must not draw a zero-width band');
  assert.equal(tiny.includes('<polyline'), false, 'n == 1 is withheld from the trend');
  const nullSe = rowOf(table, 'Null spread');
  assert.equal(nullSe.includes('<polygon'), false, 'a null standard error must not be drawn as a zero band');
  assert.equal((nullSe.match(/<polyline /g) || []).length, 1);

  const cyberBtn = table.match(/<button class="cell[^"]*"[^>]*data-g="t:cyber"[^>]*>/g) || [];
  assert.equal(cyberBtn.length, 1);
  assert.equal(/disabled/.test(cyberBtn[0]), false, 'a one-sided topic stays openable');

  api.st.sel = { g: 't:houses', k: 3 };
  api.st.mode = 'abs';
  api.st.filter = 'all';
  api.st.shown = 12;
  api.renderDetail();
  const absHtml = nodes.get('detail').innerHTML;
  const big = absHtml.match(/class="big[^"]*"[^>]*>([^<]+)/);
  assert.ok(big);
  assert.equal(big[1], '+0.020');
  const spread = absHtml.match(/The change shown above \(([^)]+)\)/);
  assert.ok(spread, absHtml.slice(0, 500));
  assert.equal(spread[1], big[1], 'the spread sentence uses the headline number');
  assert.match(absHtml, /not a confidence interval/);
  assert.equal(/<span class="w [^"]*"[^>]*>ZEROWORD<\/span>/.test(absHtml), false, 'score 0 is not painted');
  assert.match(absHtml, /<span class="w neg"[^>]*>NEGWORD<\/span>/);
  assert.match(absHtml, /title="base \+2\.20 → effective −1\.50 · negated not"/);
  assert.match(absHtml, /not aspect-level sentiment/);
  assert.match(absHtml, /publications\/fsr\/2026\/oct\//);
  assert.match(absHtml, /assessment PDF pp\. /);

  // Even imported legacy files with se: 0 must not imply certainty for n=1.
  data.params.minHits = 1;
  api.st.sel = { g: 't:tiny', k: 3 };
  api.renderDetail();
  assert.equal(nodes.get('detail').innerHTML.includes('<polygon'), false, 'n=1 never has a band, even if its stored se is zero');
  assert.equal(nodes.get('detail').innerHTML.includes('The change shown above'), false);
  data.params.minHits = 5;
  api.st.sel = { g: 't:houses', k: 3 };
  api.st.mode = 'rel';
  api.renderDetail();
  const relHtml = nodes.get('detail').innerHTML;
  const bigRel = relHtml.match(/class="big[^"]*"[^>]*>([^<]+)/);
  assert.ok(bigRel);
  assert.equal(bigRel[1], '0.000');
  assert.equal(/The change shown above/.test(relHtml), false, 'relative mode must not judge the absolute delta');
  assert.match(relHtml, /Relative to the edition mean: 0\.000/);
  assert.match(relHtml, /the whole edition moved \+0\.020/);
  api.renderTable();
  assert.equal(relHtml.includes('<polygon'), false, 'relative trend must not draw an absolute standard error band');
  assert.match(relHtml, /no band/);
  const relRow = rowOf(nodes.get('tl').innerHTML, 'Households');
  assert.equal(relRow.includes('<polygon'), false, 'relative sparkline must not draw an absolute standard error band');
  assert.match(relRow, /data-k="3"[^>]*>0\.10</);

  api.st.mode = 'abs';
  api.st.sel = { g: 't:cyber', k: 3 };
  api.renderDetail();
  const cyberHtml = nodes.get('detail').innerHTML;
  assert.match(cyberHtml, /Only the later edition names cyber risk/);
  assert.match(cyberHtml, /No mean on both sides/);
  assert.match(cyberHtml, /only on the later side/);
  assert.equal(/Essentially unchanged/.test(cyberHtml), false);

  api.st.kind = 'assessment';
  api.renderTable();
  assert.match(nodes.get('tl').innerHTML, />Assessment</);
  assert.match(nodes.get('tl').innerHTML, /Assessment narrative/);
  assert.match(nodes.get('tlsub').textContent, /share one scope/);

  api.st.kind = 'section';
  api.renderTable();
  assert.match(nodes.get('tlsub').textContent, /no closing heading/);

  exhaustData(api, nodes, data, 'fixture');
  console.log('fixture page smoke passed');
}

function runPack() {
  const packPath = path.join(root, 'examples', 'fsr-timeline.diff.js');
  const packSrc = fs.readFileSync(packPath, 'utf8');
  const loader = { console };
  loader.window = loader;
  vm.createContext(loader);
  vm.runInContext(packSrc, loader, { filename: 'fsr-timeline.diff.js' });
  const files = loader.DIFF_FILES;
  assert.ok(files && Object.keys(files).length === 1);
  const data = files[Object.keys(files)[0]];
  assert.equal(data.format, 'sentiment-diff');
  assert.equal(data.params.minHits, 5);
  assert.equal(data.model.profile, 'finance');
  assert.equal(data.editions.map(e => e.id).join(','), '2024-03,2024-09,2025-04,2025-10,2026-03,2026-10');
  const urls = {
    '2024-03': 'https://www.rba.gov.au/publications/fsr/2024/mar/',
    '2024-09': 'https://www.rba.gov.au/publications/fsr/2024/sep/',
    '2025-04': 'https://www.rba.gov.au/publications/fsr/2025/apr/',
    '2025-10': 'https://www.rba.gov.au/publications/fsr/2025/oct/',
    '2026-03': 'https://www.rba.gov.au/publications/fsr/2026/mar/',
    '2026-10': 'https://www.rba.gov.au/publications/fsr/2026/oct/',
  };
  let prose = '';
  for (const e of data.editions) for (const s of e.sentences) prose += s.t + '\n';
  assert.equal(prose.includes('y Further'), false, 'leading y-bullet should have been repaired before scoring');
  assert.equal(prose.includes('and/ or'), false, 'and/ or should have been joined before scoring');
  assert.equal(prose.includes('\u2022'), true, 'the repaired bullet should survive into the pack');
  let based = 0, noted = 0;
  const banks = data.topics.findIndex(t => t.id === 'banks');
  assert.ok(banks >= 0);
  for (const e of data.editions) {
    assert.equal(e.source, urls[e.id]);
    assert.ok(Array.isArray(e.assessmentPages) && e.assessmentPages.length === 2, e.id);
    assert.match(e.scope, /^Full Financial Stability Review text layer/);
    assert.match(e.quality, /Before scoring/);
    if (e.id === '2026-10') assert.equal(JSON.stringify(e.pages), '[1,79]');
    else assert.equal(e.pages, undefined, e.id + ' must not invent a full-review page span');
    assert.ok(e.stats['as:all'] && e.stats['as:all'].n >= 40, e.id + ' assessment n=' + (e.stats['as:all'] && e.stats['as:all'].n));
    for (const s of e.sentences) {
      for (const w of s.w || []) {
        if (w.length >= 4 && w[3] != null) based++;
        if (w.length >= 5 && w[4]) noted++;
        if (w[2] === 0) assert.notEqual(w[2] > 0, true);
      }
      const nonBankOnly = /non-banks?/i.test(s.t)
        && !/(?<![\w-])banks?(?![\w-])/i.test(s.t)
        && !/(?<![\w-])banking(?![\w-])/i.test(s.t)
        && !/(?<![\w-])ADIs?(?![\w-])/i.test(s.t)
        && !/authorised deposit-taking/i.test(s.t);
      if (nonBankOnly) assert.equal(s.tp.includes(banks), false, s.t.slice(0, 120));
    }
  }
  assert.ok(based > 0, 'word tuples should carry the lexicon base');
  assert.ok(noted > 0, 'word tuples should carry a rule note when the engine recorded one');
  assert.ok(data.groups.some(g => g.id === 'as:all' && g.kind === 'assessment'));

  const { api, nodes } = mount(files);
  exhaustData(api, nodes, data, 'pack');
  console.log('pack page smoke passed (' + data.editions.length + ' editions, ' + data.groups.length + ' groups)');
}

runFixture();
runPack();

if (process.env.SM_DIFF_SKIP_CHECK === '1') {
  console.log('skipped --check (SM_DIFF_SKIP_CHECK=1)');
} else {
  execFileSync('python', [path.join('examples', 'build_fsr_timeline.py'), '--check'], {
    cwd: root, stdio: 'inherit', timeout: 30 * 60 * 1000,
  });
}
console.log('diff-ui tests passed');
