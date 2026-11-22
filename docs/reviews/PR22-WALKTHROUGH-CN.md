# PR #22 逐项解读（中文版）

**证据标签**：〔git〕= 可从仓库/git 直接复现（随附路径）；〔me:X〕= X 实测（X=评审席位或 facilitator，工件为 roundtable 目录内文件:行号或 DECISIONS.md 行号）；〔inf〕= 推断。未标 = 直陈文件内容。
对象：`7df44e2..f65d2cf`（`4a0bd12` 迁移主体 + `5216bcc`/`b011584`/`f65d2cf` 评审轮），squash 进 main 为 `ee9460b`（两树 diff 为空〔git〕）。34 files，+2902/−1888〔git:numstat〕。

## 总览与动机
页面与离线的内建 General/Finance 打分统一到一个引擎是 **#16 `388c0fd`** 的事（更早 #14 `89d2cbb` 只是让两个**页面**共享 core；`7df44e2` 时离线 `score_financial.py` 已走 JS 引擎，但外部示例仍是 Python VADER）〔git:git show 89d2cbb/388c0fd；me:codex-v3check、gemini-v3check〕。但离线工具链整体跑在第二运行时上：`sm_engine.py` 自称 "There is no Python scorer: this sends one batch request to the JS engine"〔git:7df44e2:tools/sm_engine.py:1-2〕——纯转发壳；`sm_diff.py`/`build_finance_vocab.py` 则是"真逻辑（alignment / 统计 / 词表构建）+ 壳"混合。双运行时 = CI 用 `setup-python@v5` pin 3.13 + pip 两包〔git:7df44e2:.github/workflows/ci.yml:14–28〕，本地也要装 Python。**迁移后离线工具只需 Node，CI 跑 Node 22**，本地无 Python。`ui-smoke` 另需 Node ≥22（内置 `WebSocket`）。可选面：`ui-smoke` 要 Chrome/Edge〔git:README.md:94〕；`pack_fsr` 的 PDF 提取要 `pdfjs-dist`〔git:examples/pack_fsr.js:4–11〕；CI 词表块用 `curl`/`unzip`/`sha256sum`〔git:.github/workflows/ci.yml:28–53〕。

## 一、大组

### 1. `sm_diff.py`(588 行) + `sm_engine.py`(42) → `sm-diff.js`(+1155)〔git〕
- **difflib 移植**：`SequenceMatcher` 类在 :152–308（Ratcliff/Obershelp ratio、`autojunk=False`）；rare-token 短名单（top 25）、贪心配对、同 section +0.02 加权在 `align()` :489–573〔git〕。权重并列时 JS 按 target index 决胜；Python 侧继承 set **迭代**产生的 dict 插入序（set 本身无顺序保证）——JS 端更确定〔me:codex-r1.md:9〕
- **分数表示**：`scoreFraction`(:146) 复刻 `Fraction(round(s*10000),10000)`——乘 10000 → `floatToFrac`(:80) 转精确有理数 → `roundFracInt`(:108) half-even 取整 → 除以 10000；其后均值/分解在 :612–639、:685–770 用 BigInt 分数**累加**；输出 means 4dp、deltas/contributions 5dp；分解恒等式对**未舍入**分数按 1e-9 断言〔git::757–760；me:claude-v3check:38〕。`se` = **standard error**（sd/√n，n=1 时 null），两版皆 float〔git:sm-diff.js:621,637〕
- **CLI**：argparse → 手写 `parseArgs`(:1049+)；`--edition ID=PATH`、`--assume-ordered`、YYYY-MM 规则沿用基线的 ASCII `[0-9]` 判定〔git:7df44e2:sm_diff.py:401–420〕；argparse 用法错误原退 2，JS 统一 throw→exit 1（微小有意差异）〔git〕
- **pack 对照（行为保真）**：新旧 `fsr-timeline.diff.js` **解析后深比 0 值差**——普通深比〔me:claude-r1.md:66、codex-r1.md:25〕、`Object.is` 级 walk〔me:walk-antigravity.md:6、walk-claude.md:9、walk-codex.md:31〕；序列化面变化 = `X.0` 浮点写法转整数（旧包 `0.0` 1262 处、非零 `.0` 279 处、字面量 `-0.0` **零**处〔me:walk-antigravity.md:6 计数，codex-v3check 复点一致〕）
- 守卫命令：`node test/diff.test.js` + `node test/diff-ui.test.js`（六 edition `--check`）〔me:codex-r3.md:12–15、claude-r3.md:46–52；facilitator 于 f65d2cf 跑绿（DECISIONS.md:45）〕
- **残留小 bug**：`sm-diff.js:817` 报错文案仍写 Python 风格 `(or assume_ordered=True)`〔git:该行〕

### 2. `build_finance_vocab.py`(126) → `build-finance-vocab.js`(+212)〔git〕
- 合并规则新旧一致（文件头 :11–14）：LM polarity 与 VADER valence 同号取 valence，否则 ±1.5；加 VADER 独有字母词 |valence|≥2.5〔git::74–82〕。pinned 输入下产物 3381 词〔git:data/sentiment-model.json:114〕
- **真变化 = 取数方式**：site-packages import → `--lm/--vader` 或 `LM_CSV`/`VADER_LEXICON`(:135–136) 读原始数据文件〔git〕。**两个源文件的 sha256 记录与校验旧版就有**〔git:7df44e2:tools/build_finance_vocab.py:58–101〕；新增的只是绕开 pip 的取数路径
- 已知回归（deferred）：非 `--check` 重建会把 `sources.upstream.*.version` 覆盖成泛化描述、`file` 变成输入 basename〔git:build-finance-vocab.js:86–106,194–198；me:claude-r1.md:29〕
- "pinned wheel 的原始文件重建 == 提交词表、双 sha256 吻合"〔me:claude-r1.md:26–28（pip download）；facilitator：curl wheel → 全量 hash → `--check` exit 0（DECISIONS.md:39，scratch/v3-check/ 有工件）〕

### 3. CI `.github/workflows/ci.yml`（**+33/−8**）〔git:numstat〕
- **Before**〔git:7df44e2:.github/workflows/ci.yml:14–28〕：已有 3 个 Node 步骤（core.test / diff-ui.test / build-lexicon --check）+ `setup-python@v5`(3.13) + pip 两包 + `python3 test_golden.py` / `python test_diff.py` / `python3 build_finance_vocab.py --check`
- **After**〔git:ci.yml:13–53〕：3 个测试 + 1 个生成物校验 + `actions/cache@v4`（key `finance-vocab-wheels-d0ff7a0b-3bf1d243` = 两个 pinned hash 的缩写）+ 词表块：缺则 `curl` 精确 wheel URL → **每次运行词表 shell 步骤都无条件 `sha256sum -c`**（坏缓存 fail-closed）→ `unzip` 仅解两个数据文件 → `node build-finance-vocab.js --check`
- **Why**：迁移初版把真实词表校验整个删了——round-1 两个共识 must-fix 之一（另一个是 README fixture 危害；CLI 校验是 facilitator 复现后追加的第三项）〔me:DECISIONS.md:10–29〕。LM.csv 原件协议非商业/学术——仓库分发**派生**词表而不带原件，原件由 CI 现取〔git:THIRD_PARTY_NOTICES.md:5–12〕
- 冷/热：codex-r2.md:38、claude-r2.md:65–68 本地模拟；篡改 → exit 1：claude-r2.md:15；facilitator 于 f65d2cf 冷跑 + wheel URL/hash 实测（DECISIONS.md:39）。GitHub hosted cache 服务未覆盖（评审自报局限〔me:codex-r2.md:15〕）

### 4. 测试：`diff.test.js`(+663)、`core.test.js`(+14/−5)；删三个 py 测试〔git〕
- `test_diff.py` 的 23 个 `test_*` 同名移植全在〔me:walk-claude.md:12（comm 比对）〕；`diff.test.js` 现共 28（净新增 5：CLI 回归、emoji code-point、score-financial、合成词表、score-external JSON/CSV）〔git〕
- sm-diff CLI 新增拒绝用例 **22** = 19 个混合参数情形（含 13 个涉及数值选项者 + 布尔/路径操作数）+ 3 个专门路径情形；19 个逐一断言 exit 1 **且无输出文件**，另有独立的 `--help` 文件断言；三工具新增拒绝合计 **33**（22+5+6）〔git:diff.test.js:312–427,561–572,601–614；计数 me:walk-antigravity.md:9，claude-v3check 复点 22=19+3 一致〕
- **`test_golden.py` 的 5 个用例拆散三处**：golden 批跑 → core.test.js；`score_financial_uses_the_engine` → diff.test.js:491–519；`finance_vocabulary_matches_upstream` → CI 词表块 + 合成夹具测试；offsets/required-cases 本已在 core〔me:codex/claude/gemini walk 轮一致〕
- 严格性辨析：core.test.js 的 **JS 侧 CLI 检查**从 finance-only 扩到全 profile + document job，**接替的是旧 `test_golden.py` 本来就有的全 profile 精确比较**（`repr()` 对比，7df44e2:test/test_golden.py:59–61）——**整个 suite 覆盖持平，非变严**；变的只是守卫从 Python 搬进 core。`Object.is`、`util.isDeepStrictEqual`、旧 `repr()` 三者对原始值等价〔me:codex-walk.md:24、claude-v3check:51（自纠）、gemini-v3check:15〕
- 已知缺口（deferred）：batch 循环用 `every` 未断言返回行数〔me:codex-r1.md:15〕
- 本地回归基线〔me:facilitator 于 f65d2cf：core ALL OK / diff 28 / diff-ui 六 edition 匹配 / build-lexicon current；codex+claude 各轮同绿〕

### 5. 三个删除→新增对〔git:numstat：119→250 / 93→124 / 204→230〕
- **ui-smoke**：旧版依赖 pip `websocket-client`（import 名 `websocket`）〔git:7df44e2:test/ui-smoke.py:3,9〕；新版用 Node 22 内置 `WebSocket`+`fetch` 走 CDP，同候选顺序、同 port 9337、缺浏览器 SKIP exit 0〔git〕。仍是可选、不进 CI。回退项（deferred）：旧 WS 的 30s 超时没了、固定共享 profile 被继承〔me:codex-r1.md:27–31、claude-r1.md:35–36〕；macOS 真浏览器通过一次〔me:claude-r1.md:36〕
- **score-financial**：in-process `require('../tools/score-cli.js').run`〔git:score-financial.js:19〕——消掉 **NODE** env 覆盖与每次调用的 Node 子进程；`PYTHON` env fallback 属 pack_fsr/diff-ui 侧，全部消失（`git grep PYTHON` 0 hits〔git〕）
- **score-external**：默认引擎 VADER → 内建 General，且不再输出 `reference`——**这正是它污染 VADER fixture 的根因**（13 句中 11 句分数不同、无 reference〔me:claude-r1.md:51,67 + codex-r1.md:40；walk 轮复点 walk-codex.md:33、walk-antigravity.md:11〕）；内部 `utf16OffsetMap`(:73) 做 UTF-16 → code-point 映射，**输出偏移仍是 code point**〔git〕

### 6. 小改动
- `pack_fsr.js`(+2/−6)：`spawnSync(python)` → `scoreFile` in-process；失败由透传子进程 exit code 变 throw→exit 1 带堆栈（评审判定可接受）〔git；me:codex-r1.md:35、claude-r1.md:45〕
- ⚠️ **`build-fsr-timeline.js`(+158)**：**canonical / 量化 `--check` 是 #21 `c70ceb8` 的 Python 旧物**，本 PR 只修正 README 里过时的 "byte-for-byte" 措辞〔git:7df44e2:examples/build_fsr_timeline.py:112–149；me:三方 walk 一致〕。真变化：旧构建是 7 个 Python 子进程（6 次打分 + 1 次 diff），打分内部每个 edition 还要起 2 个 Node 批处理（引擎批 + word-detail 批）——共 19 次子进程启动（7 Python + 12 Node）→ **单进程内存**〔me:walk-codex §6、claude-v3check:52；git:7df44e2:examples/build_fsr_timeline.py:97,105〕
- `SentimentDiff.html`（共 +4/−4）：3 处文案属 `4a0bd12`(+3/−3)，`minHits()` `||5` → `!= null?:5` 属 `b011584`(+1/−1)（pack 里合法存的 0 不再被 falsy 吞）〔git:分 commit diff；me:gemini-v3check:17〕
- `docs/DIFF_FORMAT.md`(+6/−6)：CLI 命令、JS API `{ assumeOrdered: true }`、`difflib` → "Ratcliff/Obershelp SequenceMatcher"〔git〕
- `docs/FORMAT.md`(+10/−10)：外部打分示例从 `score_with_python.py`/VADER-pip 姿势改写为 `score-external.js` Node 模板，UTF-16/code-point 措辞同步〔git〕
- `test/diff-ui.test.js`(+2/−9)：删 PYTHON/python3/python 探测链 → `execFileSync(process.execPath,…)`——六 edition 重建的 CI 实际路径〔git〕
- topic 边界正则：`(?<![\w-])` → `(?<![\p{L}\p{N}_-])` + `u` flag；`iu` 编译失败时退 ASCII 边界〔git:sm-diff.js:460–466；me:codex-r1.md:8〕。`fsr-topics.json` 的 note 相应改写；用户 pattern 内 `\w`/`\d` 的 ASCII 差异 deferred
- 7 个 data/注释文件：model 仅 `/origin` 一行；topics/golden 的 note/comment 是**实质改写**（新边界描述、新测试路径语义）；score-cli 是 "offline / Python use" → "offline / CLI use"（无"专用"限制语）〔git〕；**均无打分值变化**〔me:codex-r1.md:42 深比〕
- `README.md`(+25/−26)：命令改写；Tests 清单加 `ui-smoke` 行；fixture 保护警告（"不可再生成"限定 **from this repo alone**）；`--check` 行用引号 shell 变量（`f65d2cf`）〔git〕
- `THIRD_PARTY_NOTICES.md`(+4/−4)：pysentiment2 一节改为 "historical build provenance only"〔git〕
- `.gitignore`(−2)：删 `__pycache__/`、`*.pyc`，3 行 → 1 行〔git〕

### 7. 评审轮叠加（⚠️ 方向：argparse 本来就对）
Python argparse **支持** `--min-sim=0.7` 等号形式、**拒绝** garbage（`type=float`）〔git:7df44e2:sm_diff.py:550–561〕；是 `4a0bd12` 的手写 JS parseArgs 反着来——等号报 "unknown argument"，garbage 静默 `NaN→null` 写出且 exit 0〔me:facilitator 用 4a0bd12 原文件复现（scratch/v3-check/：sm-r0.js 两探针）；首报 codex-r1.md:7；5216bcc 状态见 DECISIONS.md:14〕。
`5216bcc`：`parseFloatArg`/`parseIntArg` + 等号形式 + CLI 回归测试（关三个 must-fix）→ `b011584`：加固（CI 缓存、score-external parseArgs 守卫、builder 校验、viewer minHits 行），**但矫枉过正**加了 `minSim∈[0,1]`/`minHits≥1`；Codex r2 抓出兼容回归（`--min-sim=1.1` = 关 fuzzy 留 exact 的真实开关），facilitator 实测复现（旧版 exit 0 且行为可观测：`edited 0/removed 2/added 2` vs 默认 `edited 1/removed 1/added 1`〔me:DECISIONS.md:41–44 + scratch 根目录 r2-verify/、r3-verify/〕）→ `f65d2cf`：回退界限、保格式校验、修 README 占位符。
终审：Codex **approve**（codex-r3.md）；Claude **approve** 并撤回 r2 的 "benign" 误判（claude-r3.md:5）；Gemini 是实现者，按裁决修复、无异议〔me:DECISIONS.md:45–47〕。

## 净效果
tracked `.py` 9→0〔git:ls-files〕；离线工具与 CI 不再需要 Python（CI Node 22；ui-smoke 需 Node≥22 + Chrome/Edge、pack_fsr 需 pdfjs-dist、CI 词表块需 curl/unzip/sha256sum——均为可选/工具面）；**值级等价有三层证据**：45 条 golden 全过、新旧已提交 pack 解析深比相同、六版重建过量化 check〔me:各席位 + facilitator，见 §1/§4〕；词表校验的**新保证只在供应链层**（wheel 级 pin + 无条件全量 sha256 + fail-closed 缓存），词表/stale 比较逻辑本身与旧版等严〔git:新旧 staleReasons 对比；inf〕。

## 附：34/34 文件索引（权威值 `git diff 7df44e2..HEAD --numstat`〔git〕；三方 v3-check 逐行比对 0 mismatch）

| # | 路径 | 状 | +/− | 一句话 why（→ 大组） |
|---|---|---|---|---|
| 1 | .github/workflows/ci.yml | M | +33 −8 | Node-only + 词表上游校验回归（§3） |
| 2 | .gitignore | M | −2 | Python 产物规则作废（§6） |
| 3 | README.md | M | +25 −26 | 命令/Tests/fixture 警告（§6） |
| 4 | SentimentDiff.html | M | +4 −4 | 3 文案(4a0bd12) + minHits(b011584)（§6） |
| 5 | THIRD_PARTY_NOTICES.md | M | +4 −4 | pysentiment2→历史 provenance（§6） |
| 6 | data/sentiment-model.json | M | +1 −1 | origin 字符串（§2/§6） |
| 7 | docs/DIFF_FORMAT.md | M | +6 −6 | 指向 JS CLI/API（§6） |
| 8 | docs/FORMAT.md | M | +10 −10 | Python 模板→Node 模板（§6） |
| 9 | examples/build-fsr-timeline.js | A | +158 | 单进程 pack 构建（§6⚠️） |
| 10 | examples/build_fsr_timeline.py | D | −156 | 被 9 替代 |
| 11 | examples/fsr-timeline.diff.js | M | +2 −2 | JS 重生成；0 值差（§1） |
| 12 | examples/fsr-topics.json | M | +1 −1 | note 实质改写（§6） |
| 13 | examples/pack_fsr.js | M | +2 −6 | in-process scoreFile（§6） |
| 14 | examples/score-external.js | A | +230 | BYO 模板 Node 化（§5） |
| 15 | examples/score-financial.js | A | +124 | in-process 引擎（§5） |
| 16 | examples/score_financial.py | D | −93 | 被 15 替代 |
| 17 | examples/score_with_python.py | D | −204 | 被 14 替代 |
| 18 | index.html | M | +1 −1 | MIN_HITS 注释（§6） |
| 19 | test/core.test.js | M | +14 −5 | JS 侧 CLI 检查接替旧全 profile 比较（§4） |
| 20 | test/diff-ui.test.js | M | +2 −9 | execPath 替代 python 探测（§6） |
| 21 | test/diff.test.js | A | +663 | 23 移植 + 5 新增（§4） |
| 22 | test/golden.json | M | +1 −1 | comment 语义改写（§6） |
| 23 | test/test_diff.py | D | −338 | 被 21 替代 |
| 24 | test/test_golden.py | D | −132 | 5 用例拆三处（§4） |
| 25 | test/ui-smoke.js | A | +250 | 内置 WebSocket/fetch 驱动 CDP（§5） |
| 26 | test/ui-smoke.py | D | −119 | 被 25 替代（可选层） |
| 27 | tools/build-finance-vocab.js | A | +212 | 原始文件直读（§2） |
| 28 | tools/build-lexicon.js | M | +1 −1 | 注释调用方（§6） |
| 29 | tools/build_finance_vocab.py | D | −126 | 被 27 替代 |
| 30 | tools/score-cli.js | M | +2 −2 | "offline / Python use"→"CLI"（§6） |
| 31 | tools/sm-diff.js | A | +1155 | 引擎移植（§1） |
| 32 | tools/sm_diff.py | D | −588 | 被 31 替代 |
| 33 | tools/sm_engine.py | D | −42 | 转发壳作废 |
| 34 | tools/update-golden.js | M | +1 −1 | 注释测试路径（§6） |
