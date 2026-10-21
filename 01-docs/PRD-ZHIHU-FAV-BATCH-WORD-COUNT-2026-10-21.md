# PRD：知乎收藏批量改写支持字数区间 + 显示改写稿实际字数（2026-10-21）

> **变更类型**：运行时代码（新功能 + 一处语义修正）　**分支**：`feat-zhihu-fav-batch-wordcount`
> **worktree**：`<仓库父目录>/mp-worktrees/mp-feat-zhihu-fav-batch-wordcount`
> **上游**：#4111（采集页字数区间真实生效）—— 本片把同一能力补到**知乎收藏批量**这条链路上，
> 并修掉它暴露出的「目标篇幅中点语义」问题。
> **相关**：`01-docs/PRD-COLLECTION-REWRITE-WORD-COUNT-2026-10-20.md`（采集页同族修复）

---

## 1. 背景：两条改写链路的能力不对等

采集页与知乎收藏批量都提供「AI 改写」，但**它们根本不是同一条链路**：

| | 采集页主「改写」按钮 | 知乎收藏批量「采集并改写」 |
|---|---|---|
| 引擎 | Node 引擎 `packages/rewrite-engine` | **Python 后端** `/aggregation/rewrite` |
| 字数区间 UI | 有（#4111 修好后真实生效） | **没有** |
| 长度由谁决定 | 用户设的区间 | 写死的 `length: 'keep'` → 目标 1500 字 / 区间 300-3000 |
| 结果字数可见 | 有（#4111 加的「改写后 N 字（原文 M 字）」） | **没有** |

上一轮把采集页修好后，知乎收藏批量成了**唯一一条"改写不可控、且看不见结果长度"**的链路。

### 1.1 长度实际由什么决定（逐段取证）

```
BatchCollectPanel.vue  runZhihuFavCollectRewrite()
  → api.zhihuFavBatchRun({ items, rewriteStyle, imageLocalization, forceRecollect, collectedUrls, batchId })
  → IPC 'zhihu-fav-batch:run'  →  ipc-handlers/zhihu-favlist.js
  → rewriteOne(pythonBridge, content, style, llm)
       body = { content, style, length: 'keep', llm }        ← 没有任何字数
  → POST /aggregation/rewrite
  → AggregationService.rewrite()
       min/max 未显式传 ⇒ 回落 _LENGTH_RANGES['keep'] = (300, 3000, 1500)
  → content_aggregator_shared 的 prompt：
       "字数要求:{min}-{max}字,目标{target}字。"
```

两个必须先讲清的事实：

1. **风格下拉只改策略、不改长度**（`_STYLE_TO_STRATEGY`：轻松易懂→paraphrase / 吸引眼球→short_video /
   深度分析→expand …），长度只由 `length:'keep'` 决定 ⇒ 用户无法左右批量稿的长度。
2. **Python 侧 `max_word_count` 是「软指令」，不是强制上限**：`content_aggregator_shared` 的
   `_parse_response` 只把区间写进 prompt，**不按 max 截断输出** ⇒ 模型写超了就是超了
   （返回的 `word_count` 是实际长度）。这与 Node 引擎不同（Node 引擎会按上限砍尾并置
   `outputTruncated`）。**所以「显示实际字数」在这条链路上不是锦上添花，是必需的**——
   否则用户设了 6000 拿到 9000 字，界面毫无提示。

---

## 2. 目标与非目标

### 2.1 目标

- G1 知乎收藏批量面板提供**字数区间**输入，与采集页同一组件、同一校验口径；
- G2 区间**真的生效**：透传到 Python 的 `min_word_count` / `max_word_count`，不再回落 `length:'keep'`；
- G3 `min=0`（不设下限）时**目标篇幅与原文相当**（不是区间中点），与 Node 引擎语义对齐；
- G4 采集结果卡片显示**改写稿的实际字数**；
- G5 批量摘要告知**有多少条超出了设定上限**（不截断、不静默）。

### 2.2 非目标（明确不做）

- **不做** Python 侧硬截断输出。截断 = 静默丢内容（切在半句），与「可见化」理念冲突；
  改为**告知**（G5）。若将来要做截断，必须同时做可见化标记（Node 引擎的 `outputTruncated` 那样）。
- **不做**单条粒度的字数区间（一次批量一个区间）。
- **不做**给文案库卡片加「超上限」提示：`copy_library_rewrites` 是**跨批次持久化**的，
  把一次性的上限写进去会产生"上周的批次带着上周的上限"的怪味 ⇒ 超限只在**当次批量摘要**里说。
- **不改** Python 侧的 `_LENGTH_RANGES` 三档映射与 `RewriteRequest` 字段定义（已有，不动）。
- **不改** `/rewrite` 页与采集页主改写按钮（#4111 已修好，本片不碰）。

---

## 3. 功能需求

### F1 面板字数区间输入

- 位置：知乎收藏批量「采集并改写」按钮**左侧**（清单头 `zb-list-head` 行内），与采集页同位置观感；
- 控件：**复用** `apps/desktop/src/components/WordCountRangeInput.vue`（不新建组件）；
- 校验：**复用** `apps/desktop/src/composables/useWordCountValidation.js`（不新建校验）；
- 默认值：**800 / 2000**（与采集页一致）；
- 非法（浮点 / 非数字 / 越界 / max<min）⇒ 红字提示 + **「采集并改写」按钮 disabled**（同采集页口径）；
- 合法 ⇒ 区间随 IPC 下发。

### F2 区间透传（主进程 → Python）

- `zhihuFavBatchRun` 的 payload 新增 `wordCountMin` / `wordCountMax`；
- 主进程把它们转成 Python 请求体的 `min_word_count` / `max_word_count`；
- **只有区间合法时才带这两个字段**：缺省/非法 ⇒ 不带 ⇒ Python 回落 `length:'keep'`（**旧行为不变**，
  避免老客户端与未升级的调用方被新语义影响）。

### F3 目标篇幅语义修正（Python）

现状（`packages/python-backend/src/multi_publish/aggregation/service.py`）：

```python
target_wc = (min_wc + max_wc) // 2      # 区间中点
```

问题：用户设 `0-6000` ⇒ 目标 **3000** 字。
- 对一篇 300 字的知乎回答 ⇒ 要求写 3000 字 ⇒ **离谱地膨胀**；
- 对一篇 5000 字的长文 ⇒ 目标 3000 ⇒ **砍掉四成**。
中点语义对「宽区间」天然失真。

改成（**只改显式区间路径**，`min>0` 与 `length` 三档的既有语义不动）：

| 情形 | 目标篇幅 |
|------|---------|
| 显式区间且 `min == 0`（不设下限） | `min(原文码点数, max)` —— **与原文篇幅相当**，且不超过用户上限 |
| 显式区间且 `min > 0` | 区间中点（保持既有语义：用户给了窄区间，中点就是他要的） |
| 无显式区间（`length` 三档） | 不动（keep=1500 / compress=400 / expand=2500） |

> **为什么不把 `min>0` 也改成 `min(原文, max)`**：那会改变既有的 Python 侧语义。
> 而且 `min>0` 时用户已经明确说了下限（如 800），对 300 字的原文要 800 字是**用户自己的选择**，
> 不该被"与原文相当"覆盖。

### F4 改写稿实际字数回传 + 卡片显示

- Python 响应已带 `word_count`（实际输出长度，码点口径）—— 主进程目前**只取 `result_content`，把字数丢了**；
- 主进程取回 `word_count` ⇒ 落到条目的 `rewrittenWordCount`；
- `mapFavBatchResultsToItems` 映射该字段（否则它到不了渲染层）；
- `normalizeCollectedItem` 保留该字段；
- 采集结果卡片元信息行显示「改写 N 字」（**与原文字数并存**，用户能一眼看出改写后变长还是变短）。

### F5 批量摘要告知超限条数

- 主进程统计本批次中 `wordCount > 用户上限` 的条数；
- 批量摘要追加「其中 N 条超出设定上限」（`collection.zhihuFav.progressSummary` 扩展一个参数）；
- **不截断、不改内容**，只告知。

---

## 4. 数据校验规则

### 4.1 渲染层（`useWordCountValidation`，与采集页同一份）

| 校验项 | 规则 | 错误 key | 文案（zh / en） |
|--------|------|----------|----------------|
| min 非法 | 空 / 非整数 / <0 / >49999 | `collection.wordCountMinInvalid` | 最小字数需为 0-49999 的整数 / Min must be an integer between 0 and 49999 |
| max 非法 | 空 / 非整数 / <1 / >50000 | `collection.wordCountMaxInvalid` | 最大字数需为 1-50000 的整数 / Max must be an integer between 1 and 50000 |
| max < min | 跨字段 | `collection.wordCountMaxLtMin` | 最大字数不能小于最小字数 / Max cannot be less than min |

### 4.2 主进程侧防御（**双层，不是双真源**）

主进程**不信任**渲染层传来的值（渲染层可被旧客户端 / 直接调 IPC 绕过），做一次**归一**：

| 情形 | 主进程行为 |
|------|-----------|
| min/max 均为整数、min∈[0,49999]、max∈[1,50000]、max≥min | 采用，带 `min_word_count` / `max_word_count` |
| 缺省 / 任一不合法 | **不带**这两个字段 ⇒ Python 回落 `length:'keep'`（旧行为） |

> **为什么是「双层」而不是「两份实现」**：渲染层那份的产物是**给用户看的红字**，
> 主进程那份的产物是**降级到旧行为**。两者的判定字段相同（整数 + 上下界 + max≥min），
> 但**失败后果不同**（一个不让点、一个照旧跑），所以是两层防御而非两份语义。

### 4.3 Python 侧（`RewriteRequest`，已有，不改）

- `min_word_count: int`（0-49999，默认 800）、`max_word_count: int`（1-50000，默认 2000）；
- `model_validator` 已校验 `max >= min`（否则 422 `AGGREGATION_WORD_COUNT_RANGE_INVALID`）。

---

## 5. 交互流程

### 5.1 知乎收藏批量（改写）

```
用户勾选收藏条目
  → 设定字数区间（默认 800-2000）
  → [区间合法?] ─否→ 红字提示 + 「采集并改写」按钮 disabled（点不动）
                └是→ 点「采集并改写」
  → 采集（逐条，带频率控制）→ 图片本地化 → 逐条改写
       改写请求体：{ content, style, length:'keep', min_word_count, max_word_count, llm }
       Python 目标篇幅：min==0 ⇒ min(原文, max)；min>0 ⇒ 区间中点
  → 进度行 + 摘要：「成功 N · 失败 N · 跳过 N · 改写失败 N · 超出设定上限 N」
  → 采集结果卡片追加「改写 N 字」
  → 改写稿进文案库（文案库卡片已有字数显示）
```

### 5.2 边界与异常

| 情形 | 行为 |
|------|------|
| 区间非法 | 按钮 disabled；不发 IPC |
| 区间缺省（旧客户端） | 不带 min/max ⇒ 旧行为（目标 1500 / 区间 300-3000） |
| 改写失败 | 沿用既有 `rewriteError` 回退原文 + 条目标注 |
| 模型写超上限 | **不截断**；条目的 `rewrittenWordCount` 照实记；摘要里计入「超出设定上限」 |
| 空结果 | 沿用既有「改写接口返回空结果」提示 |

---

## 6. 显示项与提示文字

| 位置 | 项 | 条件 | i18n key | 文案（zh / en） |
|------|----|------|-----------|----------------|
| 批量面板 | 字数区间标签 | 恒显 | `collection.zhihuFav.wordCountLabel` | 字数 / Word count |
| 批量面板 | 区间错误 | 非法时 | `collection.wordCount*Invalid` | 见 §4.1 |
| 采集结果卡片 | 改写稿字数 | 有改写稿时 | `collection.recordsRewrittenCount` | 改写 {count} 字 / Rewritten {count} chars |
| 批量摘要 | 超限条数 | >0 时 | `collection.zhihuFav.overLimitSuffix` | ，其中 {count} 条超出设定上限 / , {count} over the word-count limit |

> 提示文字**不放 `rewrite-page` 命名空间**：本片是采集页/知乎面板的场景，
> 与「字数区间输入」相关的文案留在 `collection` 命名空间（与采集页已有 `collection.wordCount*` 同族）；
> 「改写稿字数」是采集结果卡片的一项 ⇒ 也在 `collection` 命名空间。

---

## 7. 代码落点（含行数约束）

| 文件 | 改动 | 行数约束（落地后实测） |
|------|------|---------|
| `apps/desktop/electron/services/zhihu-fav-rewrite.js`（**新增**） | ① 区间归一（纯函数）；② 超限判定；③ **从 `zhihu-favlist.js` 搬出**「单条改写调用 + 失败诊断脱敏」 | 新文件 168 行 |
| `apps/desktop/electron/ipc-handlers/zhihu-favlist.js` | 区间透传 + 字数回传 + 超限计数；三个函数搬出后**行数从 498 降到 463** | 搬出前 498（距 500 天花板只剩 2 行，加不动） |
| `apps/desktop/src/features/collection/BatchCollectPanel.vue` | 字数区间 UI + 校验 + 禁用 + IPC payload + 摘要超限后缀 | 登记 728 → 831（天花板 928，余量 97） |
| `apps/desktop/src/features/collection/collection-batch.js` | 映射 `rewrittenWordCount` | 151 → 154 |
| `apps/desktop/src/features/collection/CollectedResultsList.vue` | 卡片显示「改写 N 字」（与原文字数并排） | 小改 |
| `packages/python-backend/src/multi_publish/aggregation/service.py` | 新增 `_resolve_target_word_count`；显式区间路径改用它 | 445 → 470（天花板 500） |
| `apps/desktop/src/locales/collection/{zh,en}.js` | 新增 2 个 key（`overLimitSuffix` / `recordsRewrittenCount`） | **496/495 → 498/496**（天花板 499：这两个文件**未登记**在 max-lines 账本里，>= 500 即 NEW_OVER_LIMIT 阻断 ⇒ 新 key 只能**并到既有行**，不能新起行） |

### 7.1 顺带修掉的一个既有缺陷（实测发现）

面板的批量摘要调用的是 `collection.zhihuFav.progressSummary`，而该 key 实际在
`collection.zhihuFavlist.progressSummary` 下 ⇒ `resolveNotifyText` 返回
`{text:'', resolved:false}` ⇒ **批量摘要行一直是空的**（用户看不到「成功 N · 失败 N …」）。
本片把它改到正确的命名空间（0 新增 key），并把超限条数挂在同一行末尾。

### 7.2 为什么 Python 侧**不**硬截断

`content_aggregator_shared` 的 `_parse_response` 只把区间写进 prompt
（「字数要求:{min}-{max}字,目标{target}字。」），**不按 max 截断输出**。
截断 = 静默丢内容（可能切在半句），与本仓「可见化而非静默」的理念冲突（Node 引擎按上限砍尾时会置
`outputTruncated` 并在界面横幅告知）。因此本片选择**告知**（摘要里的「其中 N 条超出设定上限」+
卡片上的实际字数），不选择截断。

---

## 8. 回归保护

| 层 | 文件 | 断言 |
|----|------|------|
| 渲染层（面板） | `apps/desktop/src/features/collection/BatchCollectPanel.wordcount.test.js`（新增） | ① 区间输入渲染且默认 800/2000；② 非法区间 ⇒ 按钮 disabled；③ 合法区间 ⇒ IPC payload 带 `wordCountMin/Max`；④ 非法区间 ⇒ 不发 IPC |
| 主进程 | `apps/desktop/electron/ipc-handlers/zhihu-favlist.wordcount.test.js`（新增） | ① 合法区间 ⇒ Python body 含 `min_word_count`/`max_word_count`；② 缺省/非法 ⇒ body **不含**这两字段（旧行为）；③ 条目带 `rewrittenWordCount`；④ 超限条数被计入 |
| 映射层 | `apps/desktop/src/features/collection/collection-batch.test.js`（扩） | `rewrittenWordCount` 一路映射到条目 |
| Python | `packages/python-backend/tests/test_aggregation.py`（扩） | ① `min=0` ⇒ target = min(原文, max)；② `min>0` ⇒ target = 中点（不变）；③ 无显式区间 ⇒ 仍走 length 三档（不变） |

---

## 9. 验收标准

- [ ] 批量面板出现字数区间，默认 800/2000，非法即禁用按钮；
- [ ] 合法区间随 IPC 下发，Python 请求体带 `min_word_count`/`max_word_count`；
- [ ] `min=0` 时目标篇幅 = min(原文, max)（短文不膨胀、长文不砍半）；
- [ ] 采集结果卡片显示「改写 N 字」；
- [ ] 批量摘要在有超限时告知条数；
- [ ] 缺省/非法区间 ⇒ 旧行为不变（Python body 无新字段）；
- [ ] 四层回归锁全绿；既有 `zhihu-favlist` / `collection-batch` / `test_aggregation` 套件全绿；
- [ ] 门禁（max-lines / debt-budget / unwired-tests / locale / encoding）rc=0。

---

## 10. 变更记录

| 日期 | 变更 | 说明 |
|------|------|------|
| 2026-10-21 | 初版 | 知乎收藏批量支持字数区间 + 显示改写稿实际字数；顺带修 Python 目标篇幅中点语义 |
