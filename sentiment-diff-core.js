/* Pure aggregation and text alignment for SentimentDiff.html. */
(function (root) {
  'use strict';
  const TOPICS = [
    { id: 'global', label: 'Global markets', terms: ['global', 'international', 'geopolitical', 'sovereign', 'china'] },
    { id: 'households', label: 'Households', terms: ['household', 'mortgage', 'borrower', 'consumer'] },
    { id: 'business', label: 'Businesses & credit', terms: ['business', 'corporate', 'credit', 'lending', 'commercial real estate', 'cre'] },
    { id: 'banks', label: 'Banks & liquidity', terms: ['bank', 'liquidity', 'funding', 'capital'] },
    { id: 'nonbank', label: 'Non-bank finance', terms: ['non-bank', 'nbfi', 'superannuation', 'private credit'] },
    { id: 'operational', label: 'Operational resilience', terms: ['operational', 'cyber', 'payments', 'technology'] }
  ];
  const MIN_HITS = 5;
  const comparable = (a, b) => !!(a && b && a.model && b.model && a.model.version === b.model.version && a.model.profile === b.model.profile);
  function hits(text, topic) {
    const lower = text.toLowerCase();
    return topic.terms.some(term => new RegExp('(^|[^a-z])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:s|es)?(?=$|[^a-z])').test(lower));
  }
  function summary(edition, topic) {
    const all = edition.sentences;
    const rows = all.map((s, index) => ({ ...s, index })).filter(s => hits(s.text, topic));
    const sum = rows.reduce((n, s) => n + s.score, 0);
    return { rows, count: rows.length, total: all.length, coverage: all.length ? rows.length / all.length : 0,
      mean: rows.length >= MIN_HITS ? sum / rows.length : null, small: rows.length < MIN_HITS };
  }
  const tokens = text => new Set((text.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !/^(that|this|with|from|have|their|there|which|would|could|should|about|than|also|been|more|were|will|into|when|they)$/.test(w)));
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let common = 0; for (const w of A) if (B.has(w)) common++;
    return common / (A.size + B.size - common);
  }
  function align(left, right, threshold = 0.38) {
    const candidates = [];
    left.forEach((a, i) => right.forEach((b, j) => {
      const sim = similarity(a.text, b.text);
      if (sim >= threshold) candidates.push({ i, j, similarity: sim, scoreDelta: b.score - a.score });
    }));
    candidates.sort((a, b) => b.similarity - a.similarity || a.i - b.i || a.j - b.j);
    const li = new Set(), rj = new Set(), pairs = [];
    for (const p of candidates) if (!li.has(p.i) && !rj.has(p.j)) { pairs.push(p); li.add(p.i); rj.add(p.j); }
    pairs.sort((a, b) => a.i - b.i);
    return { pairs, leftOnly: left.map((_, i) => i).filter(i => !li.has(i)), rightOnly: right.map((_, j) => j).filter(j => !rj.has(j)), threshold };
  }
  function compare(a, b, topic) {
    const left = summary(a, topic), right = summary(b, topic);
    const valid = comparable(a, b) && !left.small && !right.small;
    return { left, right, valid, delta: valid ? right.mean - left.mean : null,
      alignment: align(left.rows, right.rows) };
  }
  const api = { TOPICS, MIN_HITS, comparable, hits, summary, similarity, align, compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SMDiffCore = api;
})(typeof window === 'undefined' ? globalThis : window);
