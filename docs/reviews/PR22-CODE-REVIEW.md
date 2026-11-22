> Post-merge review of `main` as of `ee9460b` (diff `7df44e2...ee9460b`).

# Review of PR #22: Migrate offline tools, tests, and CI to zero-dependency Node.js

I compared `HEAD~1...HEAD` (7df44e2 → ee9460b). The PR isn't linked to an issue, so I used its description as the spec.

## Standards

The PR breaks none of the repo's written rules. The repo has no CONTRIBUTING file, so I took the rules from the README and `docs/`:
- Node 22 with no npm or Python dependencies: every CLI uses only built-in `node:*` modules and repo files.
- One scoring engine: no CLI scores text with its own copy. They all call `sentiment-core.js`, directly or through `tools/score-cli.js`.
- Code-point offsets and half-even rounding are kept. `build-fsr-timeline.js` reuses `sm-diff.js`'s rounding rather than copying it.

The findings below are all design judgement calls, not bugs:
1. **Argument parsing written three times.** `sm-diff.js:1049`, `build-finance-vocab.js:132` and `score-external.js:165` each carry their own copy of the same parser, including the `--flag=value` handling. One shared helper would remove the copies.
2. **A fourth, weaker parser.** `score-financial.js:88-106` does `out = argv[++i]`, so a missing value or another flag gets taken as the output path. The other three CLIs reject both cases.
3. **Key-sorted JSON written twice.** `sortKeysDeep` in `build-fsr-timeline.js:100` does the same job as `canonicalJsonString` in `sm-diff.js:822`, and that file already imports `sm-diff.js`.
4. **Code that repeats what the core already provides:**
   - `toCSV` in `score-external.js:149` duplicates the core's `docToCSV` (`sentiment-core.js:756`).
   - `parseParagraphs` in `score-financial.js:34` duplicates the core's `parseMarkdown` (`sentiment-core.js:396`).
   - `sm-diff.js` has its own word splitter (`:43`) and text normaliser (`:317`). These are only used to match sentences between editions, not to score them, so they matter less.
5. **Names left over from Python.** `roundPy` (`sm-diff.js:134`) and the "CPython half-even rounding" comment (`sm-diff.js:49`) refer to a runtime the repo no longer uses; `roundHalfEven` would say what it does. `r4` (`score-external.js:108`) is also hard to read.
6. **`sm-diff.js` does a lot.** In 1155 lines it holds the exact-fraction rounding maths, text normalisation, sentence matching, statistics, output writing and the CLI. The rounding maths is also used by `build-fsr-timeline.js`, so it could become its own module.
7. **Mixed rounding.** `r4` in `score-external.js:108` uses `Math.round`, which rounds halves up, while the rest of the change rounds half to even. `docs/FORMAT.md` doesn't say how scored files should round, so this isn't a breach.

## Spec

The PR mostly does what its description says, and nothing it promises is missing. The spec reviewer checked the following and confirmed them:
- **Tests:** all four pass.
- **Python removal:** no `.py` files are left, and no deleted script is still referenced anywhere.
- **Test coverage:** every case from the deleted Python tests has a JS equivalent.
- **Viewer:** the `!= null` check in `minHits()` is there, at `SentimentDiff.html:202`.
- **CI:** the wheels are cached and their SHA-256 hashes are checked on every run.
- **Bad-input checks:** `sm-diff.js` rejects every malformed input tried, including `nan`, `inf`, `1e400`, `0x10`, `1.5`, a bare `-o`, `--out=` and `--js --title`. It still accepts `--min-sim=1.1` and `--min-hits=0`.
- **Same output as the old Python:** the old `sm_diff.py` and the new JS produce identical JSON at `--min-sim` 0.55, 0.3 and 1.1.

**(a) Partly done**
- *"strict numeric/path validation (rejecting malformed/non-finite/unsafe numbers…)"*: negative values still go through. `--min-sim -0.5` and `--min-hits -1` both write output. The Python allowed them too, and the PR never promised range checks.

**(b) Changes the description doesn't mention**
- *"replaces the Python example scripts"*: `examples/score-external.js:25-34` now scores with the built-in General dictionary. The deleted `score_with_python.py` used VADER, so the committed VADER fixture files can no longer be regenerated from the repo. `README.md:43,69` mentions this, but the PR description doesn't. Also, running `score-external.js` on `examples/launch-week.md` without `-o` overwrites the tracked fixture with General scores. The Python default overwrote it too.
- `core.test.js:636-649` now runs every golden profile through the batch CLI, not just Finance. This is harmless.

**(c) Done, but not exactly as described**
- *"preserving exact BigInt rational quantisation so the… pack reproduces identically"*: this holds at the settings the pack uses. At unusually low `--min-sim` (e.g. -0.5) the output differs from the Python. When candidate matches tie, the JS picks by position (`tools/sm-diff.js:549`), while the Python's choice varied from run to run. So the JS is more consistent, but it doesn't match the Python there.
- The `--js` output writes `"mean":0` where Python wrote `0.0`. The pack check compares the data, not the exact text, so it passes, but the committed `.diff.js` no longer matches the Python output byte for byte.

The spec reviewer's test outputs are in `/private/tmp/claude-501/rv22/`.

---

**Summary:**
- **Standards:** 7 findings, all judgement calls. The worst is the fourth argument parser in `score-financial.js`, which takes a missing value or another flag as the output path.
- **Spec:** 5 findings. The worst is that `score-external.js` no longer uses VADER and was never described as doing so. Run without `-o`, it overwrites the tracked VADER fixtures with General scores.
