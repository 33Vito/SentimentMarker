# SentimentMarker

一个轻量的阅读器：把文档里每个词、每句、每段的情感分数画成马克笔式热力图。

- 暖橙 = 负面，青绿 = 正面，中性不上色
- 词 / 句 / 段三个粒度可切换（快捷键 1 / 2 / 3）
- 弱信号过滤滑块，只看强烈的情绪
- 主题词筛选：自动提取高频词，也可以自己添加；没提到该词的句子会变淡
- 点击句子或段落，查看每个词的得分、否定、加强和转折的影响
- 右侧热力条显示整篇文档的情感分布，点击或拖动跳转
- 支持 PDF、Markdown、TXT 和粘贴文本
- **打开外部打分文件**（JSON / CSV）：分数由你自己的 Python 模块或 API 算好，阅读器只负责显示
- 「情感光谱」侧栏：本文的词在一个参考词表（如 VADER 词典）的分布里处于什么位置，列出最正面 / 最负面的词和百分位
- 可导出当前文档的打分结果（JSON / CSV），当作格式模板

## 用你自己的打分

阅读器不做情感判断。用 Python 或 API 给每个词 / 句 / 段打好分，存成 JSON 或 CSV，再拖进页面：

```
pip install vaderSentiment
python examples/score_with_python.py examples/launch-week.md   # 生成 launch-week.scored.json
```

格式见 [docs/FORMAT.md](docs/FORMAT.md)。三个粒度可以只给其中一部分；给 `reference`（参考词表的分数）就能画出情感光谱。
没有外部分数时，页面用内置词典打分，右上角标记为「内置词典」，只当演示。

## 使用

纯前端，没有构建步骤。直接用浏览器打开 `index.html`，或者放到任何静态托管上。
PDF 解析用的 pdf.js 从 cdnjs 加载，所以需要联网。
顶栏「示例文章」下拉内置两篇演示：RBA《Financial Stability Review》2026 年 10 月 Assessment 部分（真实文本，外部打分），以及一篇合成演示文（同样 LM×VADER 打分）。启动时自动打开第一篇。

## 结构

- `docs/FORMAT.md`：打分文件格式
- `examples/`：示例文本、两种格式的打分结果、Python 打分脚本（可改成你的模型）
- `examples/demos.js`：页面内置的两篇演示文章数据（`window.DEMOS`，由各 `*.scored.json` 打包生成；换文章后重新打包即可，classic `<script>` 加载，`file://` 下无需服务器）
- `examples/fsr-assessment-2026-10.txt / .scored.json`：RBA FSR 的 Assessment 正文（用页面自身的 pdf.js 行还原逻辑从 PDF 提取）
- `examples/financial-stability-review-2026-10.pdf`：© Reserve Bank of Australia, Financial Stability Review – October 2026，随仓库附带仅作演示用途


`index.html` 里的脚本分成两段，用注释标记：

- `//<core>`：输入解析（PDF 行还原、Markdown、纯文本）和情感引擎，不依赖 DOM，可以在 Node 里测试
- `//<app>`：渲染和交互

## 测试

```
node test/core.test.js
```

## 内置情感引擎（仅演示）

浏览器内的词典法：约 500 个英文词和少量中文词，处理否定、程度副词、转折（but / however）和感叹号。
句子分数是词分数加权求和后压到 -1 到 1，段落分数是句子均值。

## 已知限制

- 扫描件 PDF 读不到文字，没有 OCR
- 多栏、表格版面可能乱序；页眉页脚用启发式去除
- 中文词典很小，英文效果更好
- 词典法不理解语境，例如 "lost confidence" 里的 confidence 仍显示为正面

## 下一步

1. 接入你的打分模块 / API（现在靠文件，之后可以做成直接调用）
2. 面向某个主题词的情感
3. 导出带高亮的 PDF
4. 中文分词和词典增强
