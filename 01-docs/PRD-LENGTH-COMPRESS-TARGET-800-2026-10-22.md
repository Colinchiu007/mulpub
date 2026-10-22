# PRD：长度三档「精简」目标字数 400 → 800，并在界面显示各档目标字数

- 记录编号：fix-length-compress-target-800
- 日期：2026-10-22
- 关联：follow-up 自 PR #4208（三档 max 统一到 50000）
- 影响面：Python 聚合后端的长度三档表 + 渲染层镜像常量 + 自动流水线的长度下拉文案 + 跨语言结构锁

---

## 1. 背景与问题

### 1.1 「精简」档现在会给用户 400 字

长度三档在 Python 聚合后端以一张常量表实现（`packages/python-backend/src/multi_publish/aggregation/service.py` 的 `_LENGTH_RANGES`），
三元组含义是 `(min, max, target)`：

| length 档 | 界面名称 | min | max | target |
|---|---|---|---|---|
| `keep` | 保持原文 | 300 | 50000 | 1500 |
| `compress` | 精简 | 100 | 50000 | **400** |
| `expand` | 扩写 | 800 | 50000 | 2500 |

`target` 才是**实际篇幅的落点**（写进 prompt 的「目标 N 字」），`max` 只是硬上界。

### 1.2 400 这个数字的来历

它**不是**按任何平台的内容长度需求定的，而是 2026-09-06 提交 `d0a9b00ba`（Phase 1.4）里
**按 keep 档 1500 的 1/4 人工取的一个相对档**（375 取整 400），该提交**没有记录推导过程**。

### 1.3 400 字对什么场景不够

| 用途 | 常见长度 | 400 字是否够 |
|---|---|---|
| 短视频口播（1.5–2 分钟） | 300–600 字 | 够 |
| 朋友圈 / 短文案 | 100–500 字 | 够 |
| 小红书正文（上限约 1000） | 500–1000 字 | 偏少（只占四成） |
| 知乎回答 | 1000–3000 字 | **不够**（差一个量级） |
| 公众号正文 | 1500–3000 字 | **不够**（差一个量级） |

自动流水线**同时支持文章发布与视频发布**（`contentType: 'article' | 'video'`，发布平台由用户勾选），
所以**一个固定值无法同时满足两类场景** —— 400 字对短视频刚好，对文章明显不够。

### 1.4 用户在选之前不知道会拿到多少字

长度下拉只有三个词：保持原文 / 精简 / 扩写，**没有任何字数提示**。
用户在点「精简」之前不知道会拿到 400 字；点完才在结果里看到长度 —— 这与本项目 2026-10-20
那次「改写结果文字非常少、像没写完」的原始反馈是同一痛点的两端。

### 1.5 现在改 target 是干净的（前置条件已具备）

PR #4208 已把三档 `max` 统一到 50000（与引擎 `MAX_OUTPUT_CHARS` 对齐），
所以「字数要求:{min}-{max}字,目标{target}字」里的**上界不再构成约束**：
改 `target` 会被模型直接采纳，不会被上界拉回。

> 反过来看：改前 compress 档的 `max=800` 本来就高于 `target=400`，**从不构成约束** ——
> 即 400 一直就是 compress 档的实际篇幅，与 max 无关。

---

## 2. 目标与非目标

### 2.1 目标

1. `compress` 档 `target`：**400 → 800**。
2. 长度下拉的三个选项**显示各自的目标字数**（如「精简（约 800 字）」），用户在选之前就知道会得到什么。

### 2.2 非目标（明确不做）

1. **不做「按原文比例压缩」**：target 仍与原文长度无关，5000 字原文仍会被压到 800 字。
   按比例压缩需要引入「比例」概念与上下界策略，是一次独立改动（本片只调数值 + 加显示）。
2. **不动 `keep` / `expand` 的 target**（仍为 1500 / 2500）。
3. **不动任何 `min` / `max`**。
4. **不新增字数输入框**：采集页/改写页已有显式「字数区间」入口，自动流水线这里只做三档选择。
5. **不改「保持原文」名不副实的问题**（`keep` 档实际压到 1500 字，同样与原文长度无关）——
   与非目标 1 同源，一并留作独立排期。

---

## 3. 功能逻辑

### 3.1 三档 target 新值

| length 档 | min | max | target | 说明 |
|---|---|---|---|---|
| `keep` | 300 | 50000 | 1500 | 不变 |
| `compress` | 100 | 50000 | **800**（原 400） | 本片唯一改动的数值 |
| `expand` | 800 | 50000 | 2500 | 不变 |

### 3.2 档位语义的相对关系（不变）

三档 `max` 同值后，区分「精简 / 保持原文 / 扩写」语义的**唯一依据**就是 `target`，
因此三档 `target` 的单调关系必须保持：

```
compress.target (800) < keep.target (1500) < expand.target (2500)
```

该关系已由契约测试钉住（`test_length_ranges_max_aligned_with_engine_output_cap` 内的单调性断言）。
把 compress 从 400 提到 800 **仍在单调区间内**（800 < 1500），故该契约不需要修改即继续成立。

### 3.3 显示文案的取值链

```
长度下拉文案 = 档位名 + 目标字数
  ├─ 档位名：locale（collection.rewriteLengthKeep / Compress / Expand，带 {count} 插值）
  └─ 目标字数：渲染层镜像常量 LENGTH_TARGET_CHARS[档]（= Python 侧 target）
```

**关键约束**：`apps/desktop/src/locales/collection/zh.js` 现为 **498 行**、
`en.js` **496 行**，而行数门禁规则是 **>= 500 即 NEW_OVER_LIMIT**（这两个文件未登记在
max-lines 账本里）⇒ **本片不得新增 locale key**，只能在**既有 key 的同一行内**改成带
`{count}` 插值的文案。

---

## 4. 数据校验

| 校验项 | 判据 | 失败后果 |
|---|---|---|
| 前端镜像与 Python 真源一致 | 结构锁读 `service.py` 的 `_LENGTH_RANGES`，解析三档 `target`，与渲染层 `LENGTH_TARGET_CHARS` 逐档比对 | 只改一边 ⇒ 测试红（防止「界面显示 800 字、实际产出 400 字」） |
| 三档 target 单调 | `compress < keep < expand` | 档位名不副实 ⇒ 测试红 |
| 文案插值已落地 | 渲染出的标签里**不得残留 `{count}`** | UI 露出占位符 ⇒ 测试红 |
| target 落在区间内 | `min < target <= max` | 越界 ⇒ 测试红 |

---

## 5. 流程（改写请求的完整链路）

```
自动流水线「长度」下拉（保持原文/精简/扩写 + 目标字数）
  → config.rewriteLength（默认 keep）
  → full-auto-pipeline.js 的 _doRewrite()（并发 3 篇批量改写）
  → POST /aggregation/rewrite { title, content, style, length }
  → Python service.py：_LENGTH_RANGES.get(request.length) ⇒ (min, max, target)
  → 外部引擎 RewriteConfig(min_word_count, max_word_count, target_word_count)
  → prompt：「字数要求:{min}-{max}字,目标{target}字。」
  → 引擎**不按 max 截断**、只回真实产出字数
```

**本片落点**：`target` 一个数值（400→800）+ 渲染层镜像常量 + 下拉文案拼装 + 跨语言结构锁。
链路其余部分**一行不改**。

> 其它两条链路不受影响：知乎收藏批量固定用 `length:'keep'`；
> 采集页/改写页走 Node 引擎的显式「字数区间」（`wordCountRange`），与 length 三档是两套机制。

---

## 6. 交互逻辑

### 6.1 下拉选项文案

| 档 | 改前 | 改后（中文） | 改后（英文） |
|---|---|---|---|
| keep | 保持原文 | 保持原文（约 1500 字） | Keep original (~1500 words) |
| compress | 精简 | 精简（约 800 字） | Compress (~800 words) |
| expand | 扩写 | 扩写（约 2500 字） | Expand (~2500 words) |

### 6.2 交互流程

1. 用户打开自动流水线 → 「改写设置」区 → 长度下拉。
2. 下拉三项均带目标字数；**默认仍是 `keep`（保持原文）**，不改变默认行为。
3. 选「精简」⇒ 改写阶段的每篇产出目标 ~800 字。

### 6.3 本次引入的交互变化

- 唯一变化是**下拉选项文案多了目标字数**；选项数量、顺序、默认值、位置均不变。
- 文案是**静态展示**，不随所选档位之外的其它配置变化。

---

## 7. 显示项

| 位置 | 显示项 | 改前 | 改后 |
|---|---|---|---|
| 自动流水线「长度」下拉 | 三个选项的标签 | 保持原文 / 精简 / 扩写 | 保持原文（约 1500 字）/ 精简（约 800 字）/ 扩写（约 2500 字） |

**无其它新增显示项**：不改结果区、不加横幅、不加字数徽标。

---

## 8. 提示文字

- **不新增任何 toast / 横幅 / 错误提示**。
- locale 改动方式：**在既有 key 的同一行内**改成带 `{count}` 的模板
  （`rewriteLengthKeep: '保持原文（约 {count} 字）'` 等），
  **不新增 key**（collection locale 已贴 500 行天花板，新增 key 会触发行数门禁）。
- 英文用 `words`（`(~{count} words)`）。

---

## 9. 验证

| 层 | 验证项 | 判据 |
|---|---|---|
| 跨语言结构锁 | 渲染层 `LENGTH_TARGET_CHARS` === Python `_LENGTH_RANGES[*].target` | 只改一边 ⇒ 红 |
| Python 单测 | `test_length_ranges_mapping` 断言 compress = (100, 50000, 800) | 全绿 |
| Python 单测 | 三档 target 单调性 | compress(800) < keep(1500) < expand(2500) |
| 渲染层单测 | 长度下拉标签含正确目标字数、**无残留 `{count}`** | 全绿 |
| 反证 | 只改 Python 侧 target ⇒ 锁变红；只改前端镜像 ⇒ 锁变红；还原 ⇒ 绿 | 双向有效 |
| 门禁 | 行数（locale 不加行）、行尾对账、编码完整性、债务熔断 | 全部 rc=0 |

---

## 10. 附录：证据索引

| 结论 | 证据位置 |
|---|---|
| 三档数值真源 | `packages/python-backend/src/multi_publish/aggregation/service.py` 的 `_LENGTH_RANGES` |
| 长度下拉与其唯一入口 | `apps/desktop/src/views/AutoPipelineView.vue` 的 `rewriteLengths` |
| length 的传递链路 | `apps/desktop/electron/services/full-auto-pipeline.js` 的 `_doRewrite()`（`length: rewriteLength`） |
| 渲染层镜像常量的归属与理由 | `apps/desktop/src/utils/rewrite-engine-limits.js` 文件头注释 |
| 既有结构锁的写法（跨语言读源） | `apps/desktop/src/utils/rewrite-engine-limits.test.js` |
| locale 行数天花板 | `apps/desktop/src/locales/collection/zh.js`（498 行）/ `en.js`（496 行）；门禁规则见 `.github/scripts/check-max-lines.js` |
