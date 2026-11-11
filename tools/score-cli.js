#!/usr/bin/env node
/* Batch scoring through the one JS engine (sentiment-core.js), for offline / Python use. One process per run:
   read one JSON request on stdin, write one JSON response on stdout.

     {"jobs": [job, …]}  ->  {"modelVersion": "…", "results": [result, …]}     (a bare job is accepted too)

   Jobs (profile: "general" by default, or "finance" - the lexicon asset is loaded from lexicon/<name>.js):
     {"profile": "finance", "sentences": ["Not strong.", …]}
        -> {"profile", "sentences": [{"text", "score", "raw", "words": [...], "cues": [...]}]}
           each string is scored as ONE sentence (no splitting); score = the sentence score, raw = before squashing.
           words: every scored word {text, start, end, base, score, notes, note?}: score = the effective score (after
             boosters, negation, caps, clipping; contrast weights act on the sentence sum), notes = the engine's own
             records ({t:"boost", w, m} | {t:"neg", w} | {t:"caps"} | {t:"but", w: weight}), note = their text
           cues: the words that changed others or were neutralised {text, start, end, kind: "negator" | "booster" | "neutral", m?}
           This is also the shape of test/golden.json's `expected`.
     {"profile": "finance", "title": "…", "paragraphs": [{"type": "p"|"h", "level"?: 2, "text": "…"} | {"type", "sentences": ["…"]}]}
        -> {"profile", "doc": <scored JSON exactly as the page's Export JSON writes it, docs/FORMAT.md>}
           paragraphs with `text` are split with the engine's own sentence splitter.
   Offsets are Unicode code points (Python str indices). */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let core = null;
/* the engine, plus any lazy vocabulary a job asks for (its generated classic script, evaluated with SMCore in scope) */
function engine(profile) {
  if (!core) core = require(path.join(ROOT, 'sentiment-core.js'));
  const name = profile || 'general';
  if (!core.dictionaries().some(d => d.name === name)) throw new Error('unknown profile: ' + name);
  if (!core.hasLexicon(name)) {
    const src = fs.readFileSync(path.join(ROOT, core.lexiconSrc(name)), 'utf8');
    new Function('SMCore', src)(core);
  }
  return core;
}
const cpLen = s => [...s].length;

/* everything analyzeSentence exposes, as plain JSON with code-point offsets */
function detail(C, a) {
  const at = new Map();
  let off = 0;
  for (const t of a.toks) { at.set(t, off); off += cpLen(t.text); }
  const span = t => ({ text: t.text, start: at.get(t), end: at.get(t) + cpLen(t.text) });
  return {
    score: a.score, raw: a.raw,
    words: a.scored.map(t => {
      const w = Object.assign(span(t), { base: t.base, score: t.score, notes: t.notes.map(n => Object.assign({}, n)) }), note = C.noteText(t);
      if (note) w.note = note;
      return w;
    }),
    cues: a.toks.filter(t => t.word && (t.neutral || (t.info && t.info.k !== 'lex')))
      .map(t => Object.assign(span(t), t.neutral ? { kind: 'neutral' } : t.info.k === 'neg' ? { kind: 'negator' } : { kind: 'booster', m: t.info.m })),
  };
}
function scoreSentences(C, profile, texts) {
  return texts.map(text => {
    if (typeof text !== 'string') throw new Error('sentences[] must be strings');
    return Object.assign({ text }, detail(C, C.analyzeSentence(text, profile)));
  });
}
function scoreDoc(C, profile, title, paragraphs) {
  if (!Array.isArray(paragraphs)) throw new Error('paragraphs must be a list');
  const blocks = paragraphs.map(p => {
    const b = { type: p.type === 'h' ? 'h' : 'p' };
    if (b.type === 'h') b.level = Number(p.level) >= 2 ? 2 : 1;
    if (Array.isArray(p.sentences)) b.sentences = p.sentences; else b.text = String(p.text || '');
    return b;
  });
  return C.docToJSON(C.buildDoc(String(title || 'Untitled document'), blocks, { profile }));
}
function run(req) {
  const jobs = req && Array.isArray(req.jobs) ? req.jobs : [req];
  let C = engine('general');
  const results = jobs.map(job => {
    if (!job || typeof job !== 'object') throw new Error('each job must be an object');
    const profile = job.profile || 'general';
    C = engine(profile);
    if (Array.isArray(job.sentences)) return { profile, sentences: scoreSentences(C, profile, job.sentences) };
    if (job.paragraphs) return { profile, doc: scoreDoc(C, profile, job.title, job.paragraphs) };
    throw new Error('a job needs "sentences" or "paragraphs"');
  });
  return { modelVersion: C.modelVersion, results };
}

if (require.main === module) {
  try {
    const out = run(JSON.parse(fs.readFileSync(0, 'utf8')));
    process.stdout.write(JSON.stringify(out) + '\n');
  } catch (e) { process.stderr.write('score-cli: ' + (e && e.message || e) + '\n'); process.exit(1); }
}
module.exports = { run, engine, detail };
