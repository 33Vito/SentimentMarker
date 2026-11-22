# PR #22 change-by-change walkthrough (English edition)

**Evidence tags**: [git] = reproducible directly from the repo/git (path attached); [me:X] = measured by X (X = a review seat or the facilitator; artifacts are file:line in the roundtable directory or a DECISIONS.md line); [inf] = inference. Untagged = statement of file content.
Scope: `7df44e2..f65d2cf` (`4a0bd12` the migration body + `5216bcc`/`b011584`/`f65d2cf` the review rounds), squash-merged to main as `ee9460b` (diff between the two trees is empty [git]). 34 files, +2902/−1888 [git:numstat].

## Overview and motivation
Unifying page and offline built-in General/Finance scoring onto one engine happened in **#16 `388c0fd`** (the earlier #14 `89d2cbb` only shared the core between the two **pages**; as of `7df44e2` the offline `score_financial.py` already ran the JS engine, but the external-scorer example was still Python VADER) [git: git show 89d2cbb/388c0fd; me: codex-v3check, gemini-v3check]. Yet the whole offline toolchain sat on a second runtime: `sm_engine.py` says of itself "There is no Python scorer: this sends one batch request to the JS engine" [git: 7df44e2:tools/sm_engine.py:1-2] — a pure forwarding shell; `sm_diff.py`/`build_finance_vocab.py` were "real logic (alignment / statistics / vocabulary building) + shell" hybrids. The dual runtime meant CI pinned Python 3.13 via `setup-python@v5` plus two pip packages [git: 7df44e2:.github/workflows/ci.yml:14–28], and every contributor needed Python locally. **After the migration the offline tools need only Node; CI runs Node 22**; no Python locally at all. `ui-smoke` additionally needs Node ≥22 (built-in `WebSocket`). Optional surfaces: `ui-smoke` needs Chrome/Edge [git: README.md:94]; `pack_fsr`'s PDF extraction needs `pdfjs-dist` [git: examples/pack_fsr.js:4–11]; the CI vocabulary block uses `curl`/`unzip`/`sha256sum` [git: .github/workflows/ci.yml:28–53].

## I. Major groups

### 1. `sm_diff.py` (588 lines) + `sm_engine.py` (42) → `sm-diff.js` (+1155) [git]
- **difflib port**: the `SequenceMatcher` class lives at :152–308 (Ratcliff/Obershelp ratio, `autojunk=False`); the rare-token shortlist (top 25), greedy pairing and the +0.02 same-section bonus live in `align()` :489–573 [git]. On equal weights JS breaks ties by target index; Python inherited dict insertion order produced by set **iteration** (sets guarantee no order) — the JS side is more deterministic [me: codex-r1.md:9]
- **Score arithmetic**: `scoreFraction` (:146) replicates `Fraction(round(s*10000),10000)` — multiply by 10000 → `floatToFrac` (:80) to an exact rational → `roundFracInt` (:108) half-even to an integer → divide by 10000; means/decomposition then **accumulate** BigInt fractions at :612–639 and :685–770; output means 4dp, deltas/contributions 5dp; the decomposition identity is checked within a 1e-9 tolerance against the **unrounded** fractions [git: :757–760; me: claude-v3check:38]. `se` is the **standard error** (sd/√n, null when n=1); float in both versions [git: sm-diff.js:621,637]
- **CLI**: argparse → hand-written `parseArgs` (:1049+); `--edition ID=PATH`, `--assume-ordered`, and the YYYY-MM rules keep the baseline's ASCII `[0-9]` test [git: 7df44e2:sm_diff.py:401–420]; argparse usage errors exited 2, the JS uniformly throws → exit 1 (a small deliberate delta) [git]
- **Pack comparison (behavior parity)**: old vs new `fsr-timeline.diff.js` parse to a **deep compare with 0 value differences** — plain deep compares [me: claude-r1.md:66, codex-r1.md:25] and an `Object.is`-level walk [me: walk-antigravity.md:6, walk-claude.md:9, walk-codex.md:31]; the only change is serialization: `X.0` float spellings become integers (in the old pack: 1262 `0.0`, 279 non-zero `.0`, **zero** literal `-0.0` [me: walk-antigravity.md:6 counts, re-counted identically by codex-v3check])
- Guard commands: `node test/diff.test.js` + `node test/diff-ui.test.js` (six-edition `--check`) [me: codex-r3.md:12–15, claude-r3.md:46–52; facilitator ran green at f65d2cf (DECISIONS.md:45)]
- **Leftover bug**: the error text at `sm-diff.js:817` still cites the Python-style `(or assume_ordered=True)` [git: that line]

### 2. `build_finance_vocab.py` (126) → `build-finance-vocab.js` (+212) [git]
- Merge rule unchanged (header :11–14): take the VADER valence when it agrees in sign with LM polarity, else ±1.5; plus alphabetic VADER-only words with |valence| ≥ 2.5 [git: :74–82]. For the pinned inputs the product is 3381 words [git: data/sentiment-model.json:114]
- **The real change is acquisition**: site-packages imports → raw data files via `--lm/--vader` flags or the `LM_CSV`/`VADER_LEXICON` env vars (:135–136) [git]. **Recording and checking both source sha256s already existed** [git: 7df44e2:tools/build_finance_vocab.py:58–101]; only the pip-free path is new
- Known regression (deferred): a non-`--check` rebuild overwrites `sources.upstream.*.version` with generic text and `file` with the input basename [git: build-finance-vocab.js:86–106,194–198; me: claude-r1.md:29]
- "Rebuilding from the pinned wheels' raw files == the committed vocabulary, both sha256s match" [me: claude-r1.md:26–28 (pip download); facilitator: curl wheel → full hashes → `--check` exit 0 (DECISIONS.md:39, artifacts under scratch/v3-check/)]

### 3. CI `.github/workflows/ci.yml` (**+33/−8**) [git:numstat]
- **Before** [git: 7df44e2:.github/workflows/ci.yml:14–28]: already 3 Node steps (core.test / diff-ui.test / build-lexicon --check) + `setup-python@v5` (3.13) + two pip packages + `python3 test_golden.py` / `python test_diff.py` / `python3 build_finance_vocab.py --check`
- **After** [git: ci.yml:13–53]: 3 test steps + 1 generated-asset check + `actions/cache@v4` (key `finance-vocab-wheels-d0ff7a0b-3bf1d243`, the two pinned hashes abbreviated) + the vocabulary block: if absent, `curl` the exact wheel URLs → **unconditional `sha256sum -c` on every run of the shell step** (a bad cache fails closed) → `unzip` only the two data files → `node build-finance-vocab.js --check`
- **Why**: the initial migration deleted the real upstream vocabulary check entirely — one of the two consensus must-fixes in round 1 (the other: the README fixture hazard; CLI validation was a third item added after facilitator reproduction) [me: DECISIONS.md:10–29]. LM.csv's original terms are non-commercial/academic — the repo ships the **derived** vocabulary, not the original; CI fetches the original at check time [git: THIRD_PARTY_NOTICES.md:5–12]
- Cold/warm: simulated locally in codex-r2.md:38, claude-r2.md:65–68; tamper → exit 1 in claude-r2.md:15; the facilitator ran a cold pass plus wheel URL/hash checks at f65d2cf (DECISIONS.md:39). GitHub's hosted cache service itself is uncovered (the reviewers' own stated limit [me: codex-r2.md:15])

### 4. Tests: `diff.test.js` (+663), `core.test.js` (+14/−5); three Python test files deleted [git]
- All 23 `test_*` names from `test_diff.py` ported identically [me: walk-claude.md:12 (comm comparison)]; `diff.test.js` now holds 28 (net-new 5: CLI regressions, emoji code-points, score-financial, synthetic vocabulary, score-external JSON/CSV) [git]
- New sm-diff CLI rejection cases **22** = 19 mixed-argument cases (13 of which involve the numeric options + boolean/path operands) + 3 dedicated path cases; 19 assert exit 1 **and no output file**, plus a separate `--help`-file assertion; across the three CLIs **33** new rejection cases total (22+5+6) [git: diff.test.js:312–427,561–572,601–614; counts me: walk-antigravity.md:9, re-counted 22=19+3 by claude-v3check]
- **`test_golden.py`'s 5 cases were redistributed three ways**: the golden batch → core.test.js; `score_financial_uses_the_engine` → diff.test.js:491–519; `finance_vocabulary_matches_upstream` → the CI vocabulary block + a synthetic-fixture test; offsets/required-cases were already in core [me: unanimous across the codex/claude/gemini walk rounds]
- Strictness, corrected: the **JS-side CLI check** in core.test.js widened from finance-only to every profile + a document job, **replacing what the old `test_golden.py` already did** — an all-profile exact comparison via `repr()` (7df44e2:test/test_golden.py:59–61). **Whole-suite coverage is flat, not stricter**; what changed is the guard moving from Python into core. For scores, the old `repr()` check agrees with `Object.is` (`util.isDeepStrictEqual` likewise) [me: codex-walk.md:24, claude-v3check:51 (self-correction), gemini-v3check:15]
- Known gap (deferred): the batch loop's `every` never asserts the returned row count [me: codex-r1.md:15]
- Local regression baseline [me: facilitator at f65d2cf: core ALL OK / diff 28 / diff-ui six-edition match / build-lexicon current; codex+claude green in their own rounds]

### 5. Three delete→add pairs [git:numstat: 119→250 / 93→124 / 204→230]
- **ui-smoke**: the old file depended on pip `websocket-client` (import name `websocket`) [git: 7df44e2:test/ui-smoke.py:3,9]; the new one drives CDP over Node 22's built-in `WebSocket`+`fetch`, same candidate order, same port 9337, SKIP with exit 0 when no browser [git]. Still optional, still not in CI. Regressions (deferred): the old 30s WS timeout is gone; the fixed shared profile carries over [me: codex-r1.md:27–31, claude-r1.md:35–36]; one real-browser pass on macOS [me: claude-r1.md:36]
- **score-financial**: in-process `require('../tools/score-cli.js').run` [git: score-financial.js:19] — what disappears is the **NODE** env override and the per-call Node subprocess; the `PYTHON` env fallback lived in pack_fsr/diff-ui and is gone everywhere (`git grep PYTHON` 0 hits [git])
- **score-external**: default engine VADER → built-in General, and it no longer emits `reference` — **exactly why it corrupts the VADER fixture** (11 of 13 sentence scores differ, no reference [me: claude-r1.md:51,67 + codex-r1.md:40; re-counted in the walk rounds at walk-codex.md:33, walk-antigravity.md:11]); internally `utf16OffsetMap` (:73) maps UTF-16 indices to code points — **output offsets remain code points** [git]

### 6. Small changes
- `pack_fsr.js` (+2/−6): `spawnSync(python)` → in-process `scoreFile`; failure now surfaces as throw→exit 1 with a stack instead of the child's exit code (reviewers accepted) [git; me: codex-r1.md:35, claude-r1.md:45]
- ⚠️ **`build-fsr-timeline.js` (+158)**: the **canonical/quantised `--check` predates this PR — it is #21 `c70ceb8`'s Python behavior**; this PR only fixed README's stale "byte-for-byte" wording [git: 7df44e2:examples/build_fsr_timeline.py:112–149; me: unanimous across the three walk reviews]. The real change: the old build ran 7 Python subprocesses (6 scoring + 1 diff), and each scoring run itself spawned Node batches (engine batch + word-detail batch): 19 child processes in total (7 Python + 12 Node) → now **one in-memory process** [me: walk-codex §6, claude-v3check:52; git: 7df44e2:examples/build_fsr_timeline.py:97,105]
- `SentimentDiff.html` (+4/−4 overall): the 3 copy changes belong to `4a0bd12` (+3/−3); the `minHits()` `||5` → `!= null?:5` fix belongs to `b011584` (+1/−1) (a legitimately stored 0 in a pack is no longer swallowed by the falsy fallback) [git: per-commit diff; me: gemini-v3check:17]
- `docs/DIFF_FORMAT.md` (+6/−6): CLI commands, the JS API `{ assumeOrdered: true }`, `difflib` → "Ratcliff/Obershelp SequenceMatcher" [git]
- `docs/FORMAT.md` (+10/−10): the external-scores example rewritten from the `score_with_python.py`/VADER-pip posture to the `score-external.js` Node template, with UTF-16/code-point wording synced [git]
- `test/diff-ui.test.js` (+2/−9): the PYTHON/python3/python probe chain removed → `execFileSync(process.execPath,…)` — the actual CI path for the six-edition rebuild [git]
- Topic boundary regex: `(?<![\w-])` → `(?<![\p{L}\p{N}_-])` with the `u` flag; falls back to an ASCII boundary if the `iu` compile fails [git: sm-diff.js:460–466; me: codex-r1.md:8]. The `fsr-topics.json` note was rewritten accordingly; the ASCII behavior of `\w`/`\d` inside user patterns remains deferred
- Seven data/comment files: model changes only the `/origin` line; the topics/golden notes are **genuine rewrites** (new boundary description, new test-path semantics); score-cli changed "offline / Python use" → "offline / CLI use" (never said "only") [git]; **no scoring values changed** [me: codex-r1.md:42 deep compare]
- `README.md` (+25/−26): commands rewritten; the Tests list gains the `ui-smoke` line; a fixture-protection warning ("cannot be regenerated" qualified as **from this repo alone**); the `--check` line uses quoted shell variables (`f65d2cf`) [git]
- `THIRD_PARTY_NOTICES.md` (+4/−4): the pysentiment2 section became "historical build provenance only" [git]
- `.gitignore` (−2): `__pycache__/`, `*.pyc` removed; 3 lines → 1 [git]

### 7. What the review rounds stacked on top (⚠️ direction: argparse was always right)
Python argparse **accepted** the equals form `--min-sim=0.7` and **rejected** garbage (`type=float`) [git: 7df44e2:sm_diff.py:550–561]; it was `4a0bd12`'s hand-written JS parseArgs that inverted both — the equals form threw "unknown argument" and garbage silently became `NaN→null` written out with exit 0 [me: facilitator reproduced against the original 4a0bd12 file (scratch/v3-check/: two sm-r0.js probes); first reported codex-r1.md:7; the 5216bcc state in DECISIONS.md:14].
`5216bcc`: parseFloatArg/parseIntArg + equals-form parsing + CLI regression tests (closing the three must-fixes) → `b011584`: hardening (CI cache, score-external parseArgs guards, builder validation, the viewer minHits line) **but overreached** with `minSim∈[0,1]`/`minHits≥1`; Codex r2 flagged the compatibility regression (`--min-sim=1.1` = the real "fuzzy off, exact kept" switch), and the facilitator reproduced it (old build exit 0 with observable behavior: `edited 0/removed 2/added 2` vs default `edited 1/removed 1/added 1` [me: DECISIONS.md:41–44 + r2-verify/, r3-verify/ at the scratch root]) → `f65d2cf`: bounds reverted, format validation kept, README placeholders fixed.
Final: Codex **approve** (codex-r3.md); Claude **approve**, retracting its r2 "benign" call (claude-r3.md:5); Gemini is the implementer and shipped the adjudicated fix without dissent [me: DECISIONS.md:45–47].

## Net effect
Tracked `.py` files 9→0 [git: ls-files]; offline tooling and CI no longer need Python (CI on Node 22; ui-smoke needs Node≥22 + Chrome/Edge, pack_fsr needs pdfjs-dist, the CI vocabulary block needs curl/unzip/sha256sum — all optional/tooling surfaces); **value-level equivalence rests on three evidence layers**: all 45 goldens pass, old vs new committed packs deep-compare equal after parsing, and the six-edition rebuild passes the quantised check [me: seats + facilitator, see §1/§4]; the vocabulary check's **new guarantees are supply-chain only** (wheel-level pinning + unconditional full sha256 + fail-closed cache); the vocabulary/stale comparison logic itself is exactly as strict as before [git: old vs new staleReasons comparison; inf].

## Appendix: 34/34 file index (authoritative numbers from `git diff 7df44e2..HEAD --numstat` [git]; line-by-line 0 mismatches in all three v3-checks)

| # | Path | St | +/− | One-line why (→ group) |
|---|---|---|---|---|
| 1 | .github/workflows/ci.yml | M | +33 −8 | Node-only + upstream vocab check restored (§3) |
| 2 | .gitignore | M | −2 | Python build-artifact rules retired (§6) |
| 3 | README.md | M | +25 −26 | Commands/Tests/fixture warning (§6) |
| 4 | SentimentDiff.html | M | +4 −4 | 3 copy lines (4a0bd12) + minHits (b011584) (§6) |
| 5 | THIRD_PARTY_NOTICES.md | M | +4 −4 | pysentiment2 → historical provenance (§6) |
| 6 | data/sentiment-model.json | M | +1 −1 | origin string (§2/§6) |
| 7 | docs/DIFF_FORMAT.md | M | +6 −6 | Points at the JS CLI/API (§6) |
| 8 | docs/FORMAT.md | M | +10 −10 | Python template → Node template (§6) |
| 9 | examples/build-fsr-timeline.js | A | +158 | Single-process pack build (§6⚠️) |
| 10 | examples/build_fsr_timeline.py | D | −156 | Replaced by 9 |
| 11 | examples/fsr-timeline.diff.js | M | +2 −2 | JS-regenerated; 0 value diffs (§1) |
| 12 | examples/fsr-topics.json | M | +1 −1 | Note genuinely rewritten (§6) |
| 13 | examples/pack_fsr.js | M | +2 −6 | In-process scoreFile (§6) |
| 14 | examples/score-external.js | A | +230 | bring-your-own-scores template ported to Node (§5) |
| 15 | examples/score-financial.js | A | +124 | In-process engine (§5) |
| 16 | examples/score_financial.py | D | −93 | Replaced by 15 |
| 17 | examples/score_with_python.py | D | −204 | Replaced by 14 |
| 18 | index.html | M | +1 −1 | MIN_HITS comment (§6) |
| 19 | test/core.test.js | M | +14 −5 | JS CLI check inherits the old all-profile comparison (§4) |
| 20 | test/diff-ui.test.js | M | +2 −9 | execPath replaces the python probe (§6) |
| 21 | test/diff.test.js | A | +663 | 23 ported + 5 new (§4) |
| 22 | test/golden.json | M | +1 −1 | Comment semantics rewritten (§6) |
| 23 | test/test_diff.py | D | −338 | Replaced by 21 |
| 24 | test/test_golden.py | D | −132 | 5 cases redistributed (§4) |
| 25 | test/ui-smoke.js | A | +250 | Built-in WebSocket/fetch over CDP (§5) |
| 26 | test/ui-smoke.py | D | −119 | Replaced by 25 (optional layer) |
| 27 | tools/build-finance-vocab.js | A | +212 | Reads raw upstream files (§2) |
| 28 | tools/build-lexicon.js | M | +1 −1 | Caller comment (§6) |
| 29 | tools/build_finance_vocab.py | D | −126 | Replaced by 27 |
| 30 | tools/score-cli.js | M | +2 −2 | "offline / Python use" → "CLI" (§6) |
| 31 | tools/sm-diff.js | A | +1155 | Engine port (§1) |
| 32 | tools/sm_diff.py | D | −588 | Replaced by 31 |
| 33 | tools/sm_engine.py | D | −42 | Forwarding shell retired |
| 34 | tools/update-golden.js | M | +1 −1 | Test-path comment (§6) |
