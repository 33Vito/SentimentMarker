#!/usr/bin/env node
'use strict';
/**
 * Tests for tools/sm-diff.js, examples/score-financial.js, examples/build-fsr-timeline.js,
 * tools/build-finance-vocab.js, and examples/score-external.js (Node.js built-ins only).
 *
 *   node test/diff.test.js
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'tools', 'sm-diff.js'));
const B = require(path.join(ROOT, 'examples', 'build-fsr-timeline.js'));
const SF = require(path.join(ROOT, 'examples', 'score-financial.js'));
const BFV = require(path.join(ROOT, 'tools', 'build-finance-vocab.js'));
const scoreCli = require(path.join(ROOT, 'tools', 'score-cli.js'));
const SMCore = require(path.join(ROOT, 'sentiment-core.js'));

const doc = (paras, model = null) => {
  const d = { version: 1, title: 't', paragraphs: paras };
  if (model) d.model = model;
  return d;
};
const h = (text, level = 1) => ({ type: 'h', level, sentences: [{ text, score: 0 }] });
const p = (...sents) => ({ type: 'p', sentences: sents.map(([text, score]) => ({ text, score, words: [] })) });

const TOPIC_DEFS = [
  { id: 'banks', label: 'Banks', patterns: ['banks?'] },
  { id: 'homes', label: 'Households', patterns: ['households?'] },
];
const topics = () => TOPIC_DEFS.map(t => ({ ...t, _re: t.patterns.map(M.compilePattern) }));

const OLD = doc([
  h('Financial Stability Review March 2024'),
  h('1.1 Banks'),
  p(
    ['Banks remain well capitalised and profitable.', 0.5],
    ['Households are under pressure from high interest rates and rising costs.', -0.4],
    ['Sources: ABS; APRA; RBA.', 0.0],
    ['Bank funding conditions were stable over the period under review.', 0.2],
  ),
  h('Endnotes', 2),
  p(['[1] See RBA (2023).', 0.0]),
  h('Chapter 2 Households'),
  p(['Arrears on household loans remain low.', 0.3]),
]);

const NEW = doc([
  h('1.1 Banks'),
  p(
    ['Banks remain well capitalised and profitable.', 0.5],
    ['Households are under severe pressure from high interest rates and rising costs.', -0.7],
    ['Bank losses on business loans have increased.', -0.6],
  ),
  h('Chapter 2'),
  h('Households'),
  p(
    ['Arrears on household loans remain low.', 0.3],
    ['Some households and banks report rising stress.', -0.5],
  ),
]);

const buildSample = () => M.build([['2024-03', OLD], ['2024-09', NEW]], topics(), { minSim: 0.55 });

function test_quantised_statistics_ignore_float_addition_order() {
  const scores = [-0.1001, -0.0910];
  assert.equal(M.stats(scores, 0.2).mean, -0.0956);
  assert.equal(M.stats(scores.slice().reverse(), 0.2).mean, -0.0956);
  assert.equal(M.stats([0.0001, 0.0], 0.2).mean, 0.0); // half-even
  assert.equal(M.stats([0.0003, 0.0], 0.2).mean, 0.0002);
  const bSet = [{ s: -0.3000 }, { s: -0.2435 }, { s: -0.2717 }, { s: -0.2717 }];
  const aSet = bSet.map(() => ({ s: 0.0 }));
  const result = M.decompose(
    aSet,
    bSet,
    () => true,
    () => true,
    bSet.map((_, i) => [i, i, 'e', 1]),
    [],
    [],
  );
  assert.equal(result.delta, -0.27172);
  assert.equal(result.edit, -0.27172);
}

function test_pack_check_compares_canonical_quantised_payloads() {
  const payload = {
    editions: [{ stats: { all: { mean: -0.0956, n: 2 } } }],
    diffs: [{ groups: { all: { delta: -0.27172, edit: -0.27172, added: 0, removed: 0, items: [] } } }],
  };
  const script = (obj, space) =>
    `/* provenance */\nwindow.DIFF_FILES["fsr-timeline.diff.json"] = ${JSON.stringify(obj, null, space)};\n`;
  const reordered = {
    diffs: [{ groups: { all: { items: [], removed: 0, added: 0, edit: -0.27172, delta: -0.27172 } } }],
    editions: [{ stats: { all: { n: 2, mean: -0.0956 } } }],
  };
  const expected = B.canonicalPayload(script(payload));
  assert.deepStrictEqual(expected, B.canonicalPayload(script(reordered, 2)));
  assert.equal(expected.editions[0].stats.all.mean, -956n);
  assert.equal(expected.diffs[0].groups.all.delta, -27172n);
  const muts = [
    [payload.editions[0].stats.all, 'mean', -0.0955],
    [payload.diffs[0].groups.all, 'delta', -0.27173],
    [payload.editions[0].stats.all, 'n', 3],
    [payload.diffs[0].groups.all, 'items', [['e', 0, 0, 0.1]]],
  ];
  for (const [target, key, value] of muts) {
    const old = target[key];
    target[key] = value;
    assert.notDeepStrictEqual(B.canonicalPayload(script(payload)), expected, key);
    target[key] = old;
  }
}

function test_flatten_skips_furniture_endnotes_and_junk_headings() {
  const [sents, sections] = M.flatten(OLD);
  const texts = sents.map(s => s.t);
  assert.equal(texts.includes('Sources: ABS; APRA; RBA.'), false);
  assert.equal(texts.includes('[1] See RBA (2023).'), false);
  assert.deepStrictEqual(sections.map(s => s.key), ['banks', 'households']);
}

function test_split_chapter_heading_matches_one_line_layout() {
  const [, sections] = M.flatten(NEW);
  assert.deepStrictEqual(sections.map(s => s.key), ['banks', 'households']);
}

function test_alignment_kinds() {
  const r = buildSample();
  const d = r.diffs[0];
  const kinds = d.pairs.map(x => x[2]).sort();
  assert.deepStrictEqual(kinds, ['e', 'u', 'u']);
  assert.equal(d.added.length, 2);
  assert.equal(d.removed.length, 1);
  assert.equal(d.unchangedScoreMismatch, 0);
  const [[i, j]] = d.pairs.filter(x => x[2] === 'e');
  const [dels, ins] = d.ops[`${i}:${j}`];
  const bText = r.editions[1].sentences[j].t;
  assert.deepStrictEqual(ins.map(([a, b]) => bText.slice(a, b)), ['severe']);
  assert.deepStrictEqual(dels, []);
}

function test_decomposition_is_exact_and_matches_direct_difference() {
  const r = buildSample();
  for (const [gid, g] of Object.entries(r.diffs[0].groups)) {
    if (g.delta === null) {
      assert.ok(['added', 'removed'].includes(g.oneSided));
      assert.ok(g.items.every(it => it[3] === null));
      continue;
    }
    const a = r.editions[0].stats[gid].mean;
    const b = r.editions[1].stats[gid].mean;
    assert.ok(Math.abs((b - a) - g.delta) < 1e-3, gid);
    assert.ok(Math.abs(g.delta - (g.edit + g.added + g.removed)) < 1e-4, gid);
    assert.ok(Math.abs(g.items.reduce((acc, it) => acc + it[3], 0) - g.delta) < 1e-3, gid);
    assert.ok(g.items.every(it => it[0] !== 'u'));
  }
}

function test_all_text_numbers() {
  const g = buildSample().diffs[0].groups.all;
  assert.ok(Math.abs(g.delta - (-0.35)) < 1e-9);
  assert.ok(Math.abs(g.edit - (-0.3 / 5)) < 1e-9);
  assert.ok(Math.abs(g.added - ((-0.6 - 0.15) + (-0.5 - 0.15)) / 5) < 1e-9);
  assert.ok(Math.abs(g.removed - (-(0.2 - 0.15) / 5)) < 1e-9);
  assert.deepStrictEqual(g.counts, { u: 2, e: 1, a: 2, r: 1 });
}

function test_topic_membership_change_through_edit() {
  const oldD = doc([p(['Lending standards are sound.', 0.4])]);
  const newD = doc([p(['Lending standards at banks are sound.', 0.4])]);
  const r = M.build([['a', oldD], ['b', newD]], topics(), { assumeOrdered: true });
  const g = r.diffs[0].groups['t:banks'];
  assert.equal(g.delta, null);
  assert.equal(g.oneSided, 'added');
  assert.equal(g.counts.a, 1);
  assert.notEqual(g.items[0][2], null);
  assert.equal(r.diffs[0].groups.all.counts.e, 1);
}

function test_refuses_mixed_models() {
  const a = doc([p(['x y z.', 0.1])], { version: '1.0.0', profile: 'finance' });
  const b = doc([p(['x y z.', 0.1])], { version: '1.0.0', profile: 'general' });
  assert.throws(() => M.build([['a', a], ['b', b]], topics(), { assumeOrdered: true }), /different models/);
}

function test_output_is_json_serialisable() {
  assert.equal(typeof JSON.stringify(buildSample()), 'string');
}

function test_unchanged_text_with_a_different_score_is_reported_not_fatal() {
  const oldD = doc([p(['Risks remain elevated.', -0.4], ['Banks are sound.', 0.3])]);
  const newD = doc([p(['RISKS REMAIN ELEVATED.', -0.6], ['Banks are sound.', 0.3])]);
  const d = M.build([['a', oldD], ['b', newD]], topics(), { assumeOrdered: true }).diffs[0];
  assert.equal(d.unchangedScoreMismatch, 1);
  const g = d.groups.all;
  assert.ok(Math.abs(g.delta - (-0.1)) < 1e-9);
  assert.ok(Math.abs(g.edit - (-0.1)) < 1e-9);
  assert.deepStrictEqual(g.counts, { u: 1, e: 1, a: 0, r: 0 });
}

function test_running_title_inside_endnotes_does_not_end_them() {
  const d = doc([
    h('1.1 Banks'),
    p(['Banks remain well capitalised and profitable.', 0.5]),
    h('Endnotes'),
    p(['[1] See RBA (2023).', 0.0]),
    h('Financial Stability Review'),
    h('October 2026'),
    p(['[2] See APRA (2024).', 0.0]),
    h('2.1 Households'),
    p(['Arrears on household loans remain low.', 0.3]),
  ]);
  const [sents, sections] = M.flatten(d);
  assert.deepStrictEqual(sents.map(s => s.t), [
    'Banks remain well capitalised and profitable.',
    'Arrears on household loans remain low.',
  ]);
  assert.deepStrictEqual(sections.map(s => s.key), ['banks', 'households']);
}

function test_running_title_after_contents_ends_it() {
  const d = doc([
    h('Contents'),
    p(['1.1 Banks 4', 0.0]),
    h('Financial Stability Review'),
    h('Banks remain resilient overall.', 2),
    p(['Risks to banks are contained.', 0.2]),
  ]);
  const [sents] = M.flatten(d);
  assert.deepStrictEqual(sents.map(s => s.t), [
    'Banks remain resilient overall.',
    'Risks to banks are contained.',
  ]);
}

function test_topic_alternation_keeps_word_boundaries() {
  const r = M.compilePattern('bank|ADI');
  assert.ok(r.test('The bank said') && r.test('ADI lending'));
  assert.ok(!r.test('bankruptcy rose') && !r.test('RADIO hosts'));
  assert.ok(!r.test('non-bank lenders') && !r.test('non-banks grew'));
}

function test_bank_pattern_does_not_match_inside_non_bank() {
  const fsrTopics = M.loadTopics(path.join(ROOT, 'examples', 'fsr-topics.json'));
  const banks = fsrTopics.find(t => t.id === 'banks');
  const hit = s => banks._re.some(r => r.test(s));
  assert.ok(hit('Banks remain well capitalised.'));
  assert.ok(hit('The banking system is resilient.'));
  assert.ok(!hit('Stress in non-bank lenders rose.'));
  assert.ok(!hit('non-banks grew quickly.'));
}

function test_date_editions_are_sorted_chronologically() {
  const early = doc([p(['Banks remain well capitalised and profitable.', 0.2])]);
  const late = doc([p(['Banks remain well capitalised and profitable.', 0.5])]);
  const r = M.build([['2024-09', late], ['2024-03', early]], topics());
  assert.deepStrictEqual(r.editions.map(e => e.id), ['2024-03', '2024-09']);
  assert.ok(r.diffs[0].groups.all.delta > 0);
  assert.throws(() => M.build([['2024-03', early], ['2024-03', late]], topics()), /duplicate/);
}

function test_edition_order_validation() {
  const empty = doc([]);
  for (const ids of [
    ['2024-00', '2024-01'],
    ['2024-13', '2025-01'],
    ['0000-01', '2024-01'],
    ['2024-01', 'later'],
    ['later', 'earlier'],
  ]) {
    assert.throws(() => M.build(ids.map(x => [x, empty]), topics()), `must reject ${ids}`);
  }
  const [ordered, changed] = M.sortEditions([['earlier', empty], ['later', empty]], true);
  assert.deepStrictEqual(ordered.map(x => x[0]), ['earlier', 'later']);
  assert.equal(changed, false);
  assert.throws(() => M.sortEditions([['2024-13', empty], ['2025-01', empty]], true), /invalid YYYY-MM/);
}

function test_cli_order_validation() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-diff-cli-'));
  try {
    const docPath = path.join(tmp, 'doc.json');
    fs.writeFileSync(docPath, JSON.stringify(doc([p(['One sentence.', 0.1])])), 'utf8');
    const output = path.join(tmp, 'out.json');
    const baseArgs = [
      path.join(ROOT, 'tools', 'sm-diff.js'),
      '--topics', path.join(ROOT, 'examples', 'fsr-topics.json'),
      '-o', output,
    ];
    const run = (ids, extra = []) => {
      const args = ids.flatMap(eid => ['--edition', `${eid}=${docPath}`]);
      return spawnSync(process.execPath, [...baseArgs, ...args, ...extra], { encoding: 'utf8' });
    };
    assert.notEqual(run(['a', 'b']).status, 0);
    assert.equal(run(['a', 'b'], ['--assume-ordered']).status, 0);
    assert.notEqual(run(['2024-13', '2025-01'], ['--assume-ordered']).status, 0);
    const result = run(['2024-09', '2024-03']);
    assert.equal(result.status, 0);
    assert.ok(result.stderr.includes('sorted by YYYY-MM'));
    const written = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.deepStrictEqual(written.editions.map(e => e.id), ['2024-03', '2024-09']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function test_cli_numeric_and_equals_validation() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-diff-cli-num-'));
  try {
    const docPath = path.join(tmp, 'doc.json');
    fs.writeFileSync(docPath, JSON.stringify(doc([p(['One sentence.', 0.1])])), 'utf8');
    const topicsPath = path.join(ROOT, 'examples', 'fsr-topics.json');
    const cli = path.join(ROOT, 'tools', 'sm-diff.js');
    const badCases = [
      [['--min-sim', 'garbage'], /invalid float value for --min-sim/],
      [['--min-sim=garbage'], /invalid float value for --min-sim/],
      [['--min-sim='], /invalid float value for --min-sim/],
      [['--min-sim', 'NaN'], /invalid float value for --min-sim/],
      [['--min-sim', 'Infinity'], /invalid float value for --min-sim/],
      [['--min-sim', '0.5oops'], /invalid float value for --min-sim/],
      [['--min-sim', '--help'], /missing value for --min-sim/],
      [['--min-hits', '5oops'], /invalid int value for --min-hits/],
      [['--min-hits=5oops'], /invalid int value for --min-hits/],
      [['--min-hits', 'nonsense'], /invalid int value for --min-hits/],
      [['--min-hits', '3.5'], /invalid int value for --min-hits/],
      [['--min-hits='], /invalid int value for --min-hits/],
      [['--min-hits', '9007199254740992'], /invalid int value for --min-hits/],
      [['--assume-ordered=true'], /option --assume-ordered does not take a value/],
      [['--help=1'], /option --help does not take a value/],
      [['--js='], /empty value for --js/],
      [['--sources='], /empty value for --sources/],
      [['--js', '--help'], /missing value for --js/],
      [['--sources', '--help'], /missing value for --sources/],
    ];
    badCases.forEach(([extra, errRe], idx) => {
      const output = path.join(tmp, `bad-${idx}.json`);
      const res = spawnSync(process.execPath, [
        cli,
        '--edition', `2024-03=${docPath}`,
        '--edition', `2024-09=${docPath}`,
        '--topics', topicsPath,
        '-o', output,
        ...extra,
      ], { encoding: 'utf8', cwd: tmp });
      assert.equal(res.status, 1, `expected exit 1 for ${extra.join(' ')} (got ${res.status})`);
      assert.match(res.stderr, errRe, `unexpected stderr for ${extra.join(' ')}: ${res.stderr}`);
      assert.equal(fs.existsSync(output), false, `must not write output for ${extra.join(' ')}`);
    });

    // Missing/flag-like/empty path operands on -o / --out / --edition must fail before any I/O
    const pathBadCases = [
      [['--edition', `2024-03=${docPath}`, '--edition', `2024-09=${docPath}`, '--topics', topicsPath, '-o', '--help'], /missing value for -o/],
      [['--edition', `2024-03=${docPath}`, '--edition', `2024-09=${docPath}`, '--topics', topicsPath, '--out='], /empty value for --out/],
      [['--edition', `2024-03=`, '--edition', `2024-09=${docPath}`, '--topics', topicsPath, '-o', path.join(tmp, 'never.json')], /invalid --edition spec/],
    ];
    for (const [args, errRe] of pathBadCases) {
      const res = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: tmp });
      assert.equal(res.status, 1, `expected exit 1 for ${args.join(' ')}`);
      assert.match(res.stderr, errRe);
    }
    assert.equal(fs.existsSync(path.join(tmp, '--help')), false);

    // Valid equals syntax, literal dash-prefixed path via --out=, and compatibility values (--min-sim=1.1, --min-hits=0)
    const okOut = path.join(tmp, 'ok-equals.json');
    const okRes = spawnSync(process.execPath, [
      cli,
      `--edition=2024-03=${docPath}`,
      `--edition=2024-09=${docPath}`,
      `--topics=${topicsPath}`,
      `--out=${okOut}`,
      '--title=a=b',
      '--min-sim=0.7',
      '--min-hits=3',
    ], { encoding: 'utf8', cwd: tmp });
    assert.equal(okRes.status, 0, okRes.stderr);
    const written = JSON.parse(fs.readFileSync(okOut, 'utf8'));
    assert.equal(written.title, 'a=b');
    assert.equal(written.params.minSim, 0.7);
    assert.equal(written.params.minHits, 3);

    const boundRes = spawnSync(process.execPath, [
      cli,
      `--edition=2024-03=${docPath}`,
      `--edition=2024-09=${docPath}`,
      `--topics=${topicsPath}`,
      '--out=-dashed.json',
      '--min-sim=0',
      '--min-hits=1',
    ], { encoding: 'utf8', cwd: tmp });
    assert.equal(boundRes.status, 0, boundRes.stderr);
    const bound = JSON.parse(fs.readFileSync(path.join(tmp, '-dashed.json'), 'utf8'));
    assert.equal(bound.params.minSim, 0);
    assert.equal(bound.params.minHits, 1);

    // --min-sim=1.1 disables fuzzy pairing while keeping exact matches; --min-hits=0 writes 0
    const docAPath = path.join(tmp, 'doc-a.json');
    const docBPath = path.join(tmp, 'doc-b.json');
    fs.writeFileSync(docAPath, JSON.stringify(doc([p(['Exact sentence stays.', 0.1], ['Bank credit rose, abruptly.', -0.2])])), 'utf8');
    fs.writeFileSync(docBPath, JSON.stringify(doc([p(['Exact sentence stays.', 0.1], ['Bank credit rose abruptly.', -0.2])])), 'utf8');
    const compatOut = path.join(tmp, 'compat-exact-only.json');
    const compatRes = spawnSync(process.execPath, [
      cli,
      `--edition=2024-03=${docAPath}`,
      `--edition=2024-09=${docBPath}`,
      `--topics=${topicsPath}`,
      `--out=${compatOut}`,
      '--min-sim=1.1',
      '--min-hits=0',
    ], { encoding: 'utf8', cwd: tmp });
    assert.equal(compatRes.status, 0, compatRes.stderr);
    const compat = JSON.parse(fs.readFileSync(compatOut, 'utf8'));
    assert.equal(compat.params.minSim, 1.1);
    assert.equal(compat.params.minHits, 0);
    const d0 = compat.diffs[0];
    assert.equal(d0.pairs.filter(pair => pair[2] === 'u').length, 1);
    assert.equal(d0.pairs.filter(pair => pair[2] === 'e').length, 0);
    assert.equal(d0.removed.length, 1);
    assert.equal(d0.added.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function test_single_sentence_has_no_fake_standard_error() {
  const s = M.stats([0.4], 0.2);
  assert.equal(s.n, 1);
  assert.equal(s.mean, 0.4);
  assert.equal(s.se, null);
  const s2 = M.stats([0.0, 0.4], 0.2);
  assert.ok(s2.se !== null && s2.se > 0);
}

function test_word_pack_keeps_base_and_rule_and_skips_empty_note() {
  const packed = M.packWord({ start: 0, end: 4, score: -1.2, base: 2.2, note: 'negated not' }, 0);
  assert.deepStrictEqual(packed, [0, 4, -1.2, 2.2, 'negated not']);
  const plain = M.packWord({ start: 1, end: 5, score: 1.5, base: 1.5 }, 0);
  assert.deepStrictEqual(plain, [1, 5, 1.5, 1.5]);
  const zero = M.packWord({ start: 0, end: 3, score: 0, base: 0 }, 0);
  assert.equal(zero[2], 0);
  assert.equal(zero[3], 0);
}

function test_clean_prose_repairs_bullet_y_and_slash_without_touching_words() {
  const src = 'Australia: y Further weakness in housing.\n\ny Low risk premia remain.\n\nCosts and/ or wages rose.\n\nby Australian banks in February Statement.';
  const out = B.cleanProse(src);
  assert.equal(out.includes('y Further'), false);
  assert.ok(out.includes('• Further weakness'));
  assert.ok(out.includes('• Low risk premia'));
  assert.ok(out.includes('and/or wages') && !out.includes('and/ or'));
  assert.ok(out.includes('by Australian banks') && out.includes('February Statement'));
}

function test_params_record_min_hits_and_assessment_group_is_present() {
  const r = buildSample();
  assert.equal(r.params.minHits, 5);
  assert.ok('as:all' in r.editions[0].stats);
  assert.ok(r.groups.some(g => g.kind === 'assessment'));
}

function test_two_sections_of_one_edition_never_merge_into_one_row() {
  const oldD = doc([h('1.1 Risks to household and business finances in Australia'), p(['Arrears are low.', 0.2])]);
  const newD = doc([
    h('1.1 Risks to household and business finance in Australia'),
    p(['Arrears are low.', 0.2]),
    h('1.2 Risks to household and business finances in Australia now'),
    p(['Insolvencies rose.', -0.5]),
  ]);
  const r = M.build([['a', oldD], ['b', newD]], topics(), { assumeOrdered: true });
  const keys = r.editions[1].sections;
  assert.equal(keys.length, 2);
  assert.equal(new Set(keys).size, 2);
  assert.equal(keys[0], r.editions[0].sections[0]);
}

function test_word_ops_code_point_offsets_with_emoji() {
  const a = '🎉 Risks rose.';
  const b = '🎉 Risks fell.';
  const [dels, ins] = M.wordOps(a, b);
  assert.deepStrictEqual(dels.map(([s, e]) => [...a].slice(s, e).join('')), ['rose']);
  assert.deepStrictEqual(ins.map(([s, e]) => [...b].slice(s, e).join('')), ['fell']);
  // Code-point index after '🎉 Risks ' is 8, not UTF-16 index 9
  assert.deepStrictEqual(dels, [[8, 12]]);
  assert.deepStrictEqual(ins, [[8, 12]]);
}

function test_score_financial_uses_the_engine() {
  const text = '# Overview\n\nFinancial stability is strong. Losses were not severe!\n\n## Outlook\n\nThe goods trade is bridging the gap; however, risks remain.\n';
  const scored = SF.buildFromText(text, 't');
  assert.deepStrictEqual(Object.keys(scored), ['version', 'title', 'model', 'scale', 'reference', 'paragraphs']);
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sentiment-model.json'), 'utf8'));
  const fin = model.vocabularies.finance.scale;
  assert.deepStrictEqual(scored.model, { version: model.modelVersion, profile: 'finance' });
  const expectedScale = Object.fromEntries(Object.entries(fin).filter(([, v]) => v !== 'auto'));
  assert.deepStrictEqual(scored.scale, expectedScale);
  assert.deepStrictEqual(scored.scale, { word: 2.5 });
  assert.equal(scored.reference.name, 'LM × VADER finance vocabulary');
  assert.equal(scored.reference.scores.length, 3381);
  assert.deepStrictEqual(scored.paragraphs.map(x => x.type), ['h', 'p', 'h', 'p']);
  assert.equal(scored.paragraphs[2].level, 2);
  const sents = scored.paragraphs.flatMap(x => x.sentences);
  const direct = scoreCli.run({ profile: 'finance', sentences: sents.map(s => s.text) }).results[0].sentences;
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i], d = direct[i];
    assert.equal(s.score, Math.round(d.score * 10000) / 10000);
    assert.deepStrictEqual(s.words.map(w => w.text), d.words.map(w => w.text));
    for (const w of s.words) {
      assert.equal([...s.text].slice(w.start, w.end).join(''), w.text);
    }
  }
  const words = sents.flatMap(s => s.words.map(w => w.text));
  assert.equal(words.map(w => w.toLowerCase()).includes('stability'), false);
  assert.equal(words.includes('goods'), false);
  assert.equal(words.includes('bridging'), false);
}

function test_build_finance_vocab_on_synthetic_fixtures() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-vocab-'));
  try {
    const lmPath = path.join(tmp, 'LM.csv');
    const vaderPath = path.join(tmp, 'vader_lexicon.txt');
    fs.writeFileSync(lmPath, [
      'Word,Negative,Positive',
      'STRONG,0,2009',
      'LOSS,2009,0',
      'BOTH,2009,2009',
      'NEUTRAL,0,0',
      'SOLOPOS,0,2009',
      'DISAGREE,2009,0',
    ].join('\n') + '\n', 'utf8');
    fs.writeFileSync(vaderPath, [
      'strong\t2.3\t0.1\t[2]',
      'loss\t-1.9\t0.1\t[-2]',
      'disagree\t1.2\t0.1\t[1]', // opposite sign to LM -> fallback -1.5
      'euphoric\t3.2\t0.1\t[3]', // VADER-only |v| >= 2.5 alpha -> kept
      'mild\t1.8\t0.1\t[2]', // VADER-only |v| < 2.5 -> skipped
      'ok!\t2.9\t0.1\t[3]', // VADER-only non-alpha -> skipped
    ].join('\n') + '\n', 'utf8');
    const lex = BFV.buildLexicon(lmPath, vaderPath);
    assert.deepStrictEqual(lex, {
      strong: 2.3,
      loss: -1.9,
      solopos: 1.5,
      disagree: -1.5,
      euphoric: 3.2,
    });
    const fakeModel = {
      vocabularies: { finance: { words: lex } },
      sources: { upstream: BFV.upstreamInfo(lmPath, vaderPath) },
    };
    assert.deepStrictEqual(BFV.staleReasons(lmPath, vaderPath, fakeModel), []);
    fakeModel.vocabularies.finance.words = { strong: 2.0 };
    const stale = BFV.staleReasons(lmPath, vaderPath, fakeModel);
    assert.equal(stale.length, 1);
    assert.ok(stale[0].includes('finance words differ'));

    const bfvCli = path.join(ROOT, 'tools', 'build-finance-vocab.js');
    for (const [args, re] of [
      [['--lm'], /missing value for --lm/],
      [['--lm', '--vader', vaderPath], /missing value for --lm/],
      [['--vader='], /empty value for --vader/],
      [['--check=true'], /option --check does not take a value/],
      [['--bogus'], /unknown argument: --bogus/],
    ]) {
      const r = spawnSync(process.execPath, [bfvCli, ...args], { encoding: 'utf8', cwd: tmp });
      assert.equal(r.status, 1, `expected exit 1 for build-finance-vocab ${args.join(' ')}`);
      assert.match(r.stderr, re);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function test_score_external_launch_week_json_and_csv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-ext-'));
  try {
    const cli = path.join(ROOT, 'examples', 'score-external.js');
    const mdPath = path.join(ROOT, 'examples', 'launch-week.md');
    const jsonOut = path.join(tmp, 'launch.scored.json');
    const csvOut = path.join(tmp, 'launch.scored.csv');
    const rj = spawnSync(process.execPath, [cli, mdPath, '-o', jsonOut], { encoding: 'utf8' });
    assert.equal(rj.status, 0, rj.stderr);
    const rc = spawnSync(process.execPath, [cli, mdPath, '--csv', '-o', csvOut], { encoding: 'utf8' });
    assert.equal(rc.status, 0, rc.stderr);
    const jDoc = SMCore.docFromScored(JSON.parse(fs.readFileSync(jsonOut, 'utf8')));
    const cDoc = SMCore.docFromScored(SMCore.csvToScored(fs.readFileSync(csvOut, 'utf8')));
    assert.ok(Object.values(jDoc.warn).every(v => v === 0));
    assert.ok(Object.values(cDoc.warn).every(v => v === 0));
    assert.equal(jDoc.sents.length, cDoc.sents.length);
    assert.equal(jDoc.words.length, cDoc.words.length);

    // Guard against missing/flag-like/empty -o / --out / --lexicon overwriting the default sibling fixture
    const copyMd = path.join(tmp, 'launch-week.md');
    const sentinelJson = path.join(tmp, 'launch-week.scored.json');
    fs.copyFileSync(mdPath, copyMd);
    fs.writeFileSync(sentinelJson, '{"sentinel":true}\n', 'utf8');
    for (const [args, re] of [
      [[copyMd, '-o'], /missing value for -o/],
      [[copyMd, '-o', '--csv'], /missing value for -o/],
      [[copyMd, '--out='], /empty value for --out/],
      [[copyMd, '--lexicon'], /missing value for --lexicon/],
      [[copyMd, '--lexicon='], /empty value for --lexicon/],
      [[copyMd, '--csv=true'], /option --csv does not take a value/],
    ]) {
      const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: tmp });
      assert.equal(r.status, 1, `expected exit 1 for score-external ${args.join(' ')}`);
      assert.match(r.stderr, re);
      assert.equal(fs.readFileSync(sentinelJson, 'utf8'), '{"sentinel":true}\n');
    }
    assert.equal(fs.existsSync(path.join(tmp, '--csv')), false);

    // Omitting -o preserves default sibling output behavior
    const rDefault = spawnSync(process.execPath, [cli, copyMd], { encoding: 'utf8', cwd: tmp });
    assert.equal(rDefault.status, 0, rDefault.stderr);
    const defDoc = SMCore.docFromScored(JSON.parse(fs.readFileSync(sentinelJson, 'utf8')));
    assert.equal(defDoc.sents.length, jDoc.sents.length);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const TESTS = [
  test_quantised_statistics_ignore_float_addition_order,
  test_pack_check_compares_canonical_quantised_payloads,
  test_flatten_skips_furniture_endnotes_and_junk_headings,
  test_split_chapter_heading_matches_one_line_layout,
  test_alignment_kinds,
  test_decomposition_is_exact_and_matches_direct_difference,
  test_all_text_numbers,
  test_topic_membership_change_through_edit,
  test_refuses_mixed_models,
  test_output_is_json_serialisable,
  test_unchanged_text_with_a_different_score_is_reported_not_fatal,
  test_running_title_inside_endnotes_does_not_end_them,
  test_running_title_after_contents_ends_it,
  test_topic_alternation_keeps_word_boundaries,
  test_bank_pattern_does_not_match_inside_non_bank,
  test_date_editions_are_sorted_chronologically,
  test_edition_order_validation,
  test_cli_order_validation,
  test_cli_numeric_and_equals_validation,
  test_single_sentence_has_no_fake_standard_error,
  test_word_pack_keeps_base_and_rule_and_skips_empty_note,
  test_clean_prose_repairs_bullet_y_and_slash_without_touching_words,
  test_params_record_min_hits_and_assessment_group_is_present,
  test_two_sections_of_one_edition_never_merge_into_one_row,
  test_word_ops_code_point_offsets_with_emoji,
  test_score_financial_uses_the_engine,
  test_build_finance_vocab_on_synthetic_fixtures,
  test_score_external_launch_week_json_and_csv,
];

let passed = 0;
for (const fn of TESTS) {
  fn();
  passed++;
  console.log('ok  :', fn.name);
}
console.log(`\n${passed} passed`);
