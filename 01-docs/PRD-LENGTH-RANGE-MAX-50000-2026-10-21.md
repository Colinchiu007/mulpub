# PRD：长度三档上限统一到 50000（与引擎输出上限对齐）

- 记录编号：fix-length-range-max-50000
- 日期：2026-10-21
- 关联 PR：主 PR（知乎收藏批量字数区间）合并后的 follow-up
- 影响面：Python 聚合后端的 `length` 三档映射 + 其回归测试 + 文档

---

## 1. 背景与问题

### 1.1 用户可见的现象

在「自动流水线」里选择改写长度（保持原文 / 精简 / 扩写）后，产出的稿子长度有一个**用户看不见、但确实存在的硬天花板**：
最长也就 3000 字出头。选「扩写」时，用户期待得到更长的稿子，实际上最多也就 5000 字，
而系统内部早已允许写到 50000 字 —— 也就是说，**用户能拿到的长度被一个没人看见的旧常量卡住了**。

### 1.2 三档映射表（改前）

长度三档在 Python 聚合后端以一张常量表实现（`packages/python-backend/src/multi_publish/aggregation/service.py` 的 `_LENGTH_RANGES`）：

| length 档 | 界面名称 | min | max | target |
|---|---|---|---|---|
| `keep` | 保持原文 | 300 | 3000 | 1500 |
| `compress` | 精简 | 100 | 800 | 400 |
| `expand` | 扩写 | 800 | 5000 | 2500 |

### 1.3 三个数字是怎么来的（取证结论）

| 档 | 数字来源 | 有无推导记录 |
|---|---|---|
| `keep` (300 / 3000 / 1500) | **外部引擎 `content_aggregator_shared` 的 `RewriteConfig` 默认值逐字**（`shared/rewriters/rewriter.py` 的 `RewriteConfig` 默认字段）⇒ keep 档的语义就是「用引擎默认配置」 | 有（默认值即出处） |
| `compress` (100 / 800 / 400) | 2026-09-06 的 Phase 1.4 改动里**人工挑的相对档**：以 keep 为轴，约缩到 1/4 左右 | **无**（该提交未记录推导过程） |
| `expand` (800 / 5000 / 2500) | 同一提交里**人工挑的相对档**：以 keep 为轴，放大约 5/3 | **无**（同上） |

### 1.4 为什么会变成「暗上限」

- 这三个数字定的时代，全局输出上限还是 **6000 字**；三档当时是合理的。
- 2026-10-19 的 `rewrite-limits-50000` 把引擎侧的 `MAX_OUTPUT_CHARS` 放到了 **50000**。
- 但 `_LENGTH_RANGES` 是**另一处常量**（在 Python 后端，不是引擎里），没有任何判据检查这两处是否同步
  ⇒ 引擎允许 5 万字，走 length 路径最多只能出 3000 字。**越往上，档位越紧**：
  `keep` 3000 < `expand` 5000 < 全局 6000 < 引擎 50000，成了整套体系里最紧的一道「暗上限」。

---

## 2. 目标与非目标

### 2.1 目标

1. 三档的 **max 统一提到 50000**，与引擎输出上限 `MAX_OUTPUT_CHARS` 对齐。
2. 把「三档 max 必须 == 引擎上限」写成**可执行契约**（回归测试），将来谁写小就红。
3. 把三个数字的来历写进**代码注释**，不再靠考古。

### 2.2 非目标（明确不做）

1. **不改 target**。target 才是「目标 N 字」的锚（实际篇幅的落点）；本次只解除**上界**，
   改 target 属于改篇幅语义，是独立排期。
2. **不改 min**。min 是下限语义（低于 min 视为不合格），与上界无关。
3. **不硬截断输出**。Python 侧不按 max 截断（截断 = 静默丢内容），沿用「告知 + 显示实际字数」的既有做法。
4. **不改外部 pip 包 `content_aggregator_shared`**。它不同仓、生产走 PyPI；本次只对齐调用侧常量。
5. **不修三档 target 与原文长度无关的语义错位**（见 §9 遗留）。

---

## 3. 功能逻辑

### 3.1 改后映射表

| length 档 | 界面名称 | min | max | target |
|---|---|---|---|---|
| `keep` | 保持原文 | 300 | **50000** | 1500 |
| `compress` | 精简 | 100 | **50000** | 400 |
| `expand` | 扩写 | 800 | **50000** | 2500 |

### 3.2 三个数字各自的职责（本 PRD 最重要的一条约定）

| 字段 | 职责 | 改了会怎样 |
|---|---|---|
| `min` | **下限**：产出短于它视为不合格 | 影响"够不够长"的判定 |
| `target` | **篇幅锚**：写进 prompt 的「目标 N 字」，是实际落点 | **直接改变稿子长度** |
| `max` | **硬上界**：写进 prompt 的字数要求区间上界 | 只是解除人为上限，**不改变实际篇幅** |

⇒ **放宽 max ≠ 让稿子变长**。`keep` 档放宽后，篇幅仍以 1500 字为目标；
若要 keep 产出更长稿子，须另调 target（独立排期）。

### 3.3 与显式字数区间路径的关系（不冲突）

两条路径并存，互不干扰：

| 路径 | 触发方式 | 长度参数 | 目标篇幅来源 |
|---|---|---|---|
| **length 三档** | 自动流水线的「长度」下拉（保持原文 / 精简 / 扩写） | `length=keep/compress/expand` | 三档表里的 `target`（本次不动） |
| **显式区间** | 知乎收藏批量面板的「字数区间」输入（主 PR 新增） | `min_word_count` / `max_word_count` | `min==0` ⇒ 与原文相当；`min>0` ⇒ 区间中点 |

### 3.4 三档是否有活 UI（有）

`apps/desktop/src/views/AutoPipelineView.vue` 的「长度」下拉直接下发 `keep` / `compress` / `expand`，
⇒ 这三档**是用户可选的真实选项**，不是死常量。本次的改动会直接作用在用户选择上。

---

## 4. 数据校验

### 4.1 恒等式（三档必须始终成立）

```
min ≤ target ≤ max
```

- `keep`: 300 ≤ 1500 ≤ 50000 ✓
- `compress`: 100 ≤ 400 ≤ 50000 ✓
- `expand`: 800 ≤ 2500 ≤ 50000 ✓

### 4.2 与引擎上限的对齐契约（新增回归锁）

```
三档的 max 全部 == 引擎 MAX_OUTPUT_CHARS（50000）
```

- 判据：新增用例 `test_length_ranges_max_aligned_with_engine_output_cap`。
- 用途：引擎上限将来再变（例如提到 100000），这条用例会红，提醒同步；
  或者有人把某个档的 max 写小了，同样会红。

### 4.3 非法输入处理（沿用既有约定，不改）

- `length` 只能是 `keep` / `compress` / `expand` 之一；其他值一律按 `keep` 处理。
- 显式区间路径下 `min_word_count` / `max_word_count` 缺省或非法 ⇒ **不带这两个字段** ⇒ 回落到 length 三档。

---

## 5. 流程（改写请求的完整链路）

```
自动流水线「长度」下拉 (keep/compress/expand)
  → Electron 主进程（IPC：collection 改写入口）
    → Python 后端 POST /aggregation/rewrite  { content, style, length, llm }
      → service.py 查 _LENGTH_RANGES[length] ⇒ (min, max, target)
        → 拼 prompt：「字数要求：{min}-{max}字，目标{target}字。」
          → 外部引擎 content_aggregator_shared 执行改写
            → _parse_response：返回 word_count（真实产出字数），**不按 max 截断**
      → 返回 result_content + word_count
    → 主进程取回字数（若上游未透传则本次不涉及）
  → 界面展示产出与字数
```

**本次改动落点**：仅 `service.py` 里 `_LENGTH_RANGES` 的 max 取值（3 个数字）+ 对应注释；
其余链路**一行不改**。

---

## 6. 交互逻辑

### 6.1 交互流程（不变）

1. 用户在自动流水线的「长度」下拉里选一档。
2. 提交改写 → 后端按该档的 `(min, max, target)` 组织字数要求。
3. 产出返回，界面照旧展示。

### 6.2 交互差异（本次引入）

| | 改前 | 改后 |
|---|---|---|
| 用户选「扩写」且原文很长 | prompt 写「800-5000 字，目标 2500 字」 | prompt 写「800-50000 字，目标 2500 字」 |
| 模型实际产出 | ≤ 5000 字 | 仍以 2500 字为目标（target 未动） |
| 被上界卡住时 | 只能写到上限，无法更长 | 上限不再是人为的 5000，但仍受 target 锚定 |

⇒ **界面上没有任何新控件、没有任何新的提示文案**（见 §8）。

---

## 7. 显示项

- **不新增任何显示项**。本次是后端常量调整，不改 UI 结构、不改字段、不改文案。
- 现有显示项（改写结果、改写字数）语义与口径均不变。

---

## 8. 提示文字

- **不新增任何提示文案**。
- 理由：三档本来就没有逐档的文案；本次只是放宽一个后端常量，
  用户在界面上感知不到「上限」这个概念（它从未被展示过），凭空加一句「上限已放宽」属于噪音。
- **i18n**：本次**不新增/不修改任何 locale key**。

---

## 9. 遗留（明确不假装已闭合）

1. **三档 target 与原文长度无关**：名为「保持原长」的 `keep` 档，实际把 5000 字原文压到 1500、
   把 300 字短文撑到 1500 ⇒ 这是 `length` 三档自 v1 引擎以来的**语义错位**。
   修它要动 target 推导（需要原文长度），属独立排期，本次只解除上界。
2. **`compress` / `expand` 的档位推导无记录**：2026-09-06 的人工相对档没有写下来源，
   本次已把「来历」补进代码注释，但「为什么是 1/4 和 5/3」本身仍然不可考。
3. **三档的 min 同样偏小**（compress 的 min=100），本次不动。

---

## 10. 验证方式

| 层 | 验证项 | 判据 |
|---|---|---|
| 单元（Python） | `packages/python-backend/tests/test_aggregation.py` | 全绿；其中 `test_length_ranges_mapping` 断言三档精确值，新增 `test_length_ranges_max_aligned_with_engine_output_cap` 断言「三档 max == 引擎上限」且 `min ≤ target ≤ max` |
| 单元（Node/桌面端） | 本次无改动 | 不适用 |
| 契约 | `scripts/check-max-lines.js` / `scripts/check-debt-budget.js` | rc=0（未新增超限文件） |
| 行尾对账 | `git diff --cached --numstat` vs `--ignore-cr-at-eol --numstat` | 两口径相等 |
| 外部评审 | CCG 双家族（opencode + claude） | 逐条裁定并回填记录 |

---

## 11. 附录：证据索引

| 结论 | 证据位置 |
|---|---|
| 三档常量的实际取值 | `packages/python-backend/src/multi_publish/aggregation/service.py` 的 `_LENGTH_RANGES` |
| keep 档数字 = 引擎默认值 | 外部引擎 `content_aggregator_shared/shared/rewriters/rewriter.py` 的 `RewriteConfig` 默认字段 |
| 引擎不按 max 截断，只回真实字数 | 同上文件的响应解析函数 |
| 三档有活 UI | `apps/desktop/src/views/AutoPipelineView.vue` 的长度下拉 |
| 引擎输出上限 | `packages/rewrite-engine/src/rewrite-engine-core.js` 的 `MAX_OUTPUT_CHARS` |
