# 打分文件格式

SentimentMarker 本身不做情感判断。分数由你自己的 Python 模块或 API 算好，存成 JSON 或 CSV，再用「打开文件」或拖进页面。
浏览器里内置的词典法只在没有外部分数时当演示用。

可以只给其中一个粒度（只有词、只有句、只有段都行），缺的粒度会在界面上变灰。
词和句都有时，句子的底色用你给的句分，不会用词分重算。只给词时，句分和段分由词分推出。

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
            { "text": "better", "score": 1.9, "start": 15, "end": 21, "note": "可选，点开后显示" }
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
| `paragraphs[].score` | 否 | 段分。缺省时取句分均值 |
| `paragraphs[].sentences[]` | 否 | 缺省时用该段的 `text` 自动断句（这种情况下没有词分） |
| `sentences[].text` | 是 | 句子原文。字符串也行，等价于只有 text |
| `sentences[].score` | 否 | 句分。缺省时由词分推出：S / √(S² + 15) |
| `sentences[].words[]` | 否 | 只列有分数的词，其余词当中性 |
| `words[].start / end` | 否 | 词在 `sentence.text` 里的字符偏移，半开区间。缺省时从左到右在句子里搜索 `text` |
| `words[].note` | 否 | 一句说明，点开句子时显示 |
| `center` | 否 | 中性点，默认 0。所有分数会先减去它（比如 1–5 星的评分设成 3） |
| `scale` | 否 | 分数多大时颜色最深。数字（三个粒度共用）或 `{word, sentence, paragraph}`。缺省取该粒度非零 \|分数\| 的 90 分位 |
| `reference` | 否 | 参考词表，用来画「情感光谱」。见下 |

分数的符号决定颜色：负为橙，正为青绿，0 不上色。数值范围随你，不要求归一化，用 `scale` 告诉阅读器多大算「很强」就行。

对不上句子的词（偏移越界、搜不到、互相重叠）会被跳过，并在页面上提示跳过了多少个。

## CSV

长格式，一行一个单元。必需列：`level, paragraph, sentence, text, score`；可选列：`type, start, end, note`。

```csv
level,paragraph,sentence,text,score,type,start,end,note
paragraph,1,,,0.499,p,,,
sentence,1,0,The launch went better than we feared.,-0.0772,,,,
word,1,0,better,1.9,,15,21,
```

- `level` 取 `paragraph` / `sentence` / `word`
- `paragraph`、`sentence` 是从 0 开始的序号；词行靠它们归属到句子
- 段行只需要 `paragraph` 和 `score`，标题加 `type=h`
- 句行必须有 `text`；词行的 `text` 是词本身，`start` / `end` 可省略
- UTF-8，带不带 BOM 都行，字段里有逗号、引号、换行时按标准 CSV 加引号
- CSV 没地方放 `reference` 和 `scale`；要用光谱的参考词表请用 JSON

## 情感光谱需要的参考词表

右侧的「情感光谱」把本文用到的词放进一个参考词表的分布里，回答「这个词在常见词表里算多正面」。参考词表由你提供：

- 给 `reference.scores`（词表里所有词的分数，顺序随意）：光谱显示参考词表的分布、本文词的分布，并给出每个词的百分位，例如「比词表里 97% 的词更正面」
- 再给 `reference.examples`：作为刻度显示（哪些常见词对应哪个分数）
- 不给：只显示本文自己的分布，百分位是在本文用到的词里排的

Python 里最方便的是用 VADER 的词典，见 `examples/score_with_python.py`：`vader.lexicon.values()` 就是词表分数。换成别的词表（AFINN、NRC、你们自己的）同理。参考词表的分数要和 `words[].score` 是同一把尺子，否则百分位没有意义。

## 导出

页面上「导出 JSON / CSV」会把当前文档（包括内置词典打的分）按这个格式写出来，可以当模板，也可以用来对比你的模型和内置词典。
