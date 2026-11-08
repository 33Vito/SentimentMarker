# 打分文件格式

SentimentMarker 本身不做情感判断。分数由你自己的 Python 模块或 API 算好，存成 JSON 或 CSV，再用「打开文件」或拖进页面。
浏览器里内置的词典法只在没有外部分数时当演示用。

可以只给其中一个粒度（只有词、只有句、只有段都行），缺的粒度会在界面上变灰。
词和句都有时，句子的底色用你给的句分，不会用词分重算。只给词时，句分和段分由词分推出，点开句子 / 段落时会标出「由词分推出」/「由句分推出」；
同一个文件里有的句子给了句分、有的没给时，页头会提示两者不一定在同一尺度上。

## JSON

```json
{
  "version": 1,
  "title": "launch-week",
  "center": 0,
  "scale": { "word": 3.0, "sentence": 0.6, "paragraph": 0.3 },
  "reference": {
    "name": "VADER 词典",
    "scores": [-3.9, -3.8, "…词表里每个词的分数…", 3.9],
    "examples": [{ "text": "terrible", "score": -3.4 }, { "text": "great", "score": 3.1 }]
  },
  "paragraphs": [
    {
      "type": "p",
      "score": 0.12,
      "sentences": [
        {
          "text": "The launch went better than we feared.",
          "score": -0.08,
          "words": [
            { "text": "better", "score": 1.9, "start": 16, "end": 22, "note": "可选，点开后显示" }
          ]
        }
      ]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `paragraphs[]` | 是 | 按文档顺序。`type` 为 `"h"` 表示标题，其余当正文 |
| `paragraphs[].score` | 否 | 段分。缺省时取句分均值（标记为「由句分推出」） |
| `paragraphs[].sentences[]` | 否 | 缺省或为空数组 `[]` 时，用该段的 `text` 自动断句（这种情况下没有词分） |
| `paragraphs[].text` | 否 | 没有 `sentences` 时用来断句。既没有句子也没有 `text` 的段（例如只有 `score`）**会被跳过**，页面上提示跳过了几个 |
| `sentences[].text` | 是 | 句子原文。字符串也行，等价于只有 text。空文本的句子算无效数据，跳过并计数 |
| `sentences[].score` | 否 | 句分。缺省时由词分推出：S / √(S² + 15)，S 为句内词分之和 |
| `sentences[].words[]` | 否 | 只列有分数的词，其余词当中性 |
| `words[].start / end` | 否 | 词在 `sentence.text` 里的位置，半开区间，**单位是 Unicode 码点**（和 Python `str` 的下标一致，不是 UTF-16）。见下方「词的定位」 |
| `words[].note` | 否 | 一句说明，点开句子时显示 |
| `center` | 否 | 中性点，默认 0。数字（三个粒度共用）或 `{word, sentence, paragraph}`。分数会先减去对应粒度的中性点（比如 1–5 星的评分设成 3）；`reference` 用 `word` 的中性点 |
| `scale` | 否，但建议总是写 | 分数的绝对值多大时颜色最深。数字（三个粒度共用）或 `{word, sentence, paragraph}`，指减去 `center` 之后的分数。缺省时自动取该粒度非零 \|分数\| 的 90 分位，于是不同文件的颜色深浅没法直接比 |
| `reference` | 否 | 参考词表，用来画「情感光谱」。见下 |

分数的符号决定颜色：负为橙，正为青绿，0 不上色。数值范围随你，不要求归一化，用 `scale` 告诉阅读器多大算「很强」就行。
页头会显示当前用的颜色刻度，以及它来自文件、自动计算还是内置词典。

### 词的定位

- **有 `start` / `end`**：按码点换算成浏览器里的位置，再核对这段原文和 `words[].text` 是否一致（先做 NFC 规范化，不分大小写）。
  一致就用它；不一致（或越界）就当作没给偏移，按下面的方法在句子里搜索，找到的计入提示里的「偏移和原文对不上，已按文字重新定位」，找不到的计入「找不到的词」。
  所以偏移错了不会把颜色涂到别的词上。
- **没有偏移**：从上一个词之后开始找（不分大小写）；找不到就回到句首，取第一个还没被别的词占用的位置。所以词的顺序可以是乱的，比如一串关键词。
- WordPiece 这类子词前缀 `##`（如 `##ing`）会先去掉再匹配。
- 以下情况会跳过这个词，并在页面上提示数量：`text` 不是字符串或为空、`score` 不是数字、在句子里找不到、和已经定位的词重叠。

## CSV

长格式，一行一个单元。必需列：`level, paragraph, sentence, text, score`；可选列：`type, start, end, note`。

```csv
level,paragraph,sentence,text,score,type,start,end,note
paragraph,0,,,0.0,h,,,
sentence,0,0,Launch week review,0.0,,,,
paragraph,1,,,0.499,p,,,
sentence,1,0,The launch went better than we feared.,-0.0772,,,,
word,1,0,better,1.9,,16,22,
word,1,0,feared,-2.2,,31,37,
```

- `level` 取 `paragraph` / `sentence` / `word`
- `paragraph`、`sentence` 是从 0 开始的序号（上例第 0 段是标题，第 1 段是正文）；词行靠它们归属到句子
- 段行只需要 `paragraph` 和 `score`，标题加 `type=h`。段行也可以在 `text` 里放整段文字、不写句行，这时自动断句
- 句行必须有 `text`；空文本的句行算无效数据。词行的 `text` 是词本身，`start` / `end` 可省略，单位同 JSON（码点）
- 找不到所属句行（或所属句行文本为空）的词行算无效数据。无效行都会跳过，并在页面上提示数量
- 只有分数、没有文字的段（没有句行也没有 `text`）会被跳过并提示
- UTF-8，带不带 BOM 都行，字段里有逗号、引号、换行时按标准 CSV 加引号（字段里的 `\r\n` 按 `\n` 读）
- CSV 没地方放 `reference`、`scale` 和 `center`；要用光谱的参考词表或固定颜色刻度，请用 JSON

## 情感光谱需要的参考词表

「情感光谱」把本文用到的词放进一个参考词表的分布里，回答「这个词在常见词表里算多正面」。参考词表由你提供：

- 给 `reference.scores`（词表里所有词的分数，顺序随意）：光谱显示参考词表的分布、本文词的分布，并给每个词一个排名，例如「最正面的 3%」。
  意思是：参考词表里和它同号、且分数不低于它（负面词则不高于它）的词，占**整个**词表的 3%
- 再给 `reference.examples`：作为刻度显示（哪些常见词对应哪个分数）
- 不给：只显示本文自己的分布，排名是在本文用到的词里排的（「本文最正面的 X%」）

同一个词按「词 + 正负号」分组，所以 "good" 和被否定的 "not good"（负分）会分成两条，不会平均成一个接近 0 的分数。

Python 里最方便的是用 VADER 的词典，见 `examples/score_with_python.py`：`vader.lexicon.values()` 就是词表分数。换成别的词表（AFINN、NRC、你们自己的）同理。
参考词表的分数要和 `words[].score` 是同一把尺子，否则排名没有意义；如果本文词分的最大绝对值比参考词表小很多（不到 1/4）或大很多（超过 4 倍），光谱里会提示两者可能不是同一尺度。

## 中文

`examples/score_with_python.py` 按 `。！？` 和换行给中文断句，偏移直接用 Python 的字符串下标（码点）。
VADER 只认英文，所以中文默认没有词分和句分；用 `--lexicon 你的词表.json`（`{"词": 分数}`）或 TSV（`词<TAB>分数`）提供中文词表后，会在句子里做最长匹配给中文词打分，句分则由阅读器从词分推出。
接入自己的中文模型时，改 `cjk_words` 和 `score_sentence` 两个函数即可。

## 导出

页面上「导出 JSON / CSV」会把当前文档（包括内置词典打的分）按这个格式写出来，可以当模板，也可以用来对比你的模型和内置词典。

- 分数按文件自己的尺度写出：导入时减去的 `center` 会加回来，并把 `center` 一起写出
- JSON 总是写 `scale`（当前实际用的颜色刻度，包括自动算出的）和 `reference`（如果有），所以导出再导入，颜色深浅和光谱都不变
- 偏移按码点写出
- 由词分推出的句分 / 段分会作为普通分数写出
