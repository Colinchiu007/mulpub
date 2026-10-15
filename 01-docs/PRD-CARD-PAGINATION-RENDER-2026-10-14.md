# PRD：图文卡片分页渲染（P2-5 渲染层入口与文案 + P2-6 上游链路）

- 日期：2026-10-14
- 状态：已交付（分支 `p25-cards-entry`，PR #3577）
- 关联：`PLAN-REUSE-ROLLOUT-2026-10-13.md`（P2-5 / P2-6）、
  `ARCH-REUSE-INTEGRATION-2026-10-13.md` §7（R-5 分页引擎）、§7.7（卡片几何）

---

## 1. 目标与范围

### 1.1 一句话

把用户的长文按页切成图文卡片，逐页导出 PNG，**并在文本放不下时如实告诉用户**。

### 1.2 分层（三块，各司其职）

| 层 | 位置 | 职责 |
| --- | --- | --- |
| **引擎层** | `packages/shared-utils/src/card-paginator-core.js`（+ `.browser.js` 孪生）| 测量驱动贪心装箱；**纯计算，不碰 DOM** |
| **测量层** | `apps/desktop/electron/services/card-capture.js` | offscreen 窗口真实测量 + 逐页截图 |
| **桥接层** | `apps/desktop/src/api/cards.js` | 渲染进程唯一接触 IPC 的入口 |
| **状态层** | `src/features/cards/useArticlePagination.js` · `useCardsRender.js` · `useCardsPipeline.js` | 交互状态机 |
| **展示层** | `src/features/cards/CardsRenderPanel.vue` | 按钮 / 进度 / 结果 / 失败 / warnings |

### 1.3 明确不在范围

- 真实 DOM 测量的 QM-1 判据④⑤真机验证（需 GUI）
- 模板供给（U-6 阻塞项；当前用内置 1242×1660）
- 把面板挂到选题/发布页（依赖上游 `pages` 供给，见 §9）

---

## 2. 数据校验（四层，全 fail-closed）

### 2.1 L1 渲染端入参

| 校验 | 位置 | 失败表现 |
| --- | --- | --- |
| `text` 必须是字符串 | `buildItems()` | 按空串处理 ⇒ 空正文分支 |
| 空正文（trim 后无内容）| `paginate()` | `failure.key = 'empty'`，**不调分页器** |
| `measure` 必须是函数 | 引擎抛 `TypeError` | 桥接层接住 ⇒ `failure.key = 'failed'` |
| `availableHeightPx` 有限正数 | 引擎抛 `TypeError` | 同上 |

**★ `availableHeightPx` 的 `0` 必须原样透传，不得静默回落默认值**：
`args.availableHeightPx || DEFAULT` 会把合法的 `0` 吞掉、绕过引擎的 fail-closed。
正确写法是**只有 `undefined` 才用默认**。

### 2.2 L2 主进程入参（`render:cards` 通道）

四层校验，任一层不过即 `{ code: EC.VALIDATION_ERROR, message }`：

1. 信封形状（必须是对象）
2. `pages` 必须是数组且非空
3. 每页必须是数组；每页每个块必须是字符串
4. `widthPx` / `heightPx` 若给出必须是有限正数

### 2.3 L3 主进程产物校验（**不返回部分产物**）

渲染完成后校验 `pngs.length === pages.length`。

**数量不符 ⇒ 视为整体失败，丢弃已成功的页**，返回：

```js
{
  code: EC.REQUEST_ERROR,
  message: 'RENDER_PAGE_COUNT_MISMATCH',   // 领域码
  detail: `期望 N 页，实得 M`,              // 数字在 detail 里
}
```

**★ 为什么用领域码而不是中文句子**：渲染端原先靠
`message.includes('渲染页数不符')` 识别这一种失败 —— 那是**两侧靠自然语言匹配**，
主进程改一个字渲染端就静默失配；且渲染端的中文字面量会被
`check-locale-sync --cjk` 拦（用户可见文案必须走 locale）。

**★ 为什么丢弃部分产物**：部分成功比完全失败更危险 —— 用户会以为发全了。

### 2.4 L4 渲染端信封校验

`res.code === 0 && Array.isArray(res.data)` 才认为成功；
否则按 §5 的领域码映射表出文案。

---

## 3. 流程

```
① 用户写正文（编辑器）
        │
        ▼
② useArticlePagination.buildItems(text)
     按 \r?\n 切段 → 逐段 trim → 丢空段 → 编 id（p0, p1, …）
        │
        ▼
③ 引擎 paginate(items, { availableHeightPx, measure, maxPages? })
     · 惰性测量（按 id 缓存，只有轮到装箱的段才测）
     · 贪心装箱 + 二分切分探针（探针**不走缓存**，见 §4.3）
     · 提前退出（fillRatio 收页 / maxPages 立刻停）
        │
        ▼
④ pages + warnings（item-exceeds-page / page-limit-reached / degenerate-split-skipped）
        │
        ▼
⑤ 桥接层 cardsRender({ pages, widthPx?, heightPx? })
     invokeWithFallback → IPC 'render:cards' → 主进程
        │
        ▼
⑥ 主进程：四层校验 → offscreen 逐页截图 → 数量校验 → 落临时文件
        │
        ▼
⑦ { code: 0, data: [pngPath…], warnings: [] }
        │
        ▼
⑧ useCardsPipeline 合并两处 warnings（去重）→ 面板展示
```

### 3.1 临时文件

主进程用 `fsp.mkdtemp(path.join(os.tmpdir(), 'mp-cards-'))` 建**每次调用一个**子目录，
每页一个 PNG（`page-001.png`…）。

**⇒ 同一批共用一个目录，便于整批清理。**

---

## 4. 功能逻辑

### 4.1 正文 → items 的三个决定（看起来只是 `split`，其实影响分页）

| # | 决定 | 不做会怎样 |
| --- | --- | --- |
| ① | **空段必须丢** | 空串高度为 0 但仍占一个 item ⇒ 每页条数虚高，`item-exceeds-page` 出现高度 0 噪声 |
| ② | **每段 trim** | HTML 折叠空白不改视觉高度，但会污染 `minTailChars` / `minSplitChars` 这些**按字符数**的判据 |
| ③ | **id 用下标** | 用内容哈希会让两条一样的段共享 `measuredHeights` 缓存 ⇒ 切分探针按 id 取高度时拿到错的值 |

### 4.2 测量：为什么不能用估算公式

分页要按**换行后**的高度切，而换行位置取决于：
字宽（中英日混排、全角/半角、标点悬挂）、段前/段后距、行高、模板 CSS。

任何「字符数 × 每字像素」的公式都会在这几项上漂移，后果是
**一页放不下**（用户看到内容被截断）或**一页只放半页**（排版难看）。

### 4.3 切分探针**必须不走 id 缓存**

`rawHeight()` 按 `id` 缓存；而切分探针是「同一个 id、不断变化的文本片段」。
用缓存会让每次探针都返回**原始条目**的高度（实测：二分查找一次都没真跑，
直接判成退化切分）。

**⇒ 缓存键必须覆盖会影响结果的全部输入 —— 这里含文本。**

### 4.4 测量的三条硬约束

| # | 约束 | 反例后果 |
| --- | --- | --- |
| ① | 容器用 `position:absolute; left:-10000px`，**不是** `display:none` | `display:none` 不参与布局 ⇒ 高度**恒为 0** ⇒ 分页把全文塞进一页 |
| ② | 拿不到高度**必须抛错**，绝不返回 0 | 返回 0 等于告诉分页器「这段不占高度」⇒ 无数段塞进一页 |
| ③ | 正文里的 `<` `>` `&` **必须转义** | 未转义会被当标签：既改变量到的高度，也可能注入样式（`#include <stdio.h>` 是真实技术正文）|

### 4.5 引擎的三条不可破（见引擎文件头）

① **情况 0 必须有**：单条比整页还高 ⇒ 独占一页（原实现缺这条 ⇒ **死循环**）
② **拆完必须重测两段**（`substring + trim` 改变行数分布，且 `paddingBottom` / `marginBottom` 会被重复计算）
③ **提前退出**（填到 `fillRatio` 就收页；`maxPages` 一到立刻停，不是事后截断）

---

## 5. 失败契约（领域码 → 文案键）

| 领域码 / 条件 | 文案键 | 含义 |
| --- | --- | --- |
| `CARDS_IPC_UNAVAILABLE` | `cards.failedService` | **暂不可用**（非渲染失败）；用户可重试 |
| `code === -2`（VALIDATION_ERROR）| `cards.failedValidation` | 入参非法；**主进程原文进 `vars.message`** |
| `RENDER_PAGE_COUNT_MISMATCH` | `cards.failedCount` | 页数不符；期望/实得从 `detail` 取 |
| 其他 | `cards.failedUnknown` | **原因原文进 `vars.message`**（不得吞掉）|
| 空正文 | `cards.???`（`failure.key='empty'`）| 尚未给文案（见 §9 残余）|

**★ 三条设计原则**：

1. **失败必须点名原因**，不得只写「生成失败」
2. **「暂不可用」≠「渲染失败」** —— 混成一句会让用户无法判断该重试还是该报障
3. **未知领域码的原文必须进 `vars`** —— 否则新故障在界面上无从定位

---

## 6. 交互逻辑

### 6.1 阶段机

```
idle ──run()──► paginating ──成功──► rendering ──成功──► done
                    │                    │
                    └──失败──► done ◄────┘
                   （failure.stage = 'paginate' | 'render'）
```

**★ 为什么「分页」也要可见**：真实 DOM 测量是耗时操作，用户需要知道
「正在分页」而不是只看到「正在渲染」。

**★ 为什么失败要归属阶段**：分页失败是**输入问题**（改文案即可），
渲染失败是**环境问题**（重试或报障）。混成一个 `failed` 就无法给建议。

### 6.2 可取消重入（用户改一个字就重跑是常态）

`run()` 每次先 `generation++`；任一步完成后校验 generation 是否仍是最新。

**★ 过期探针必须下沉到「写状态的那一层」**：
`resultFiles` 是 `useCardsRender.render()` 自己赋值的，
上层 pipeline 的 generation 守卫**拦不住底层的赋值**（实测踩过：旧结果写回了，
`expected ['/old.png'] to deeply equal ['/new.png']`）。

**⇒ 上层的 `isStale` 探针传给 `render()`，在写任何 ref 之前先问。**

### 6.3 warnings 的合并与去重

分页器与渲染侧各自可能产出 warnings，**是同一类用户必须知情的信息**：

- 分开展示 ⇒ 用户漏看
- 直接拼数组 ⇒ 重复（同一条可能两边都给）

**⇒ `mergeWarnings()` 合并去重，保持首次出现顺序（渲染稳定）。**

---

## 7. 显示项（逐项，含 `data-testid`）

| 项 | testid | 出现条件 | 内容 |
| --- | --- | --- | --- |
| 面板容器 | `cards-render-panel` | 恒 | `cards.entryLabel` + `cards.entryDesc` |
| 入口按钮 | `cards-render-run` | 恒 | `cards.entryLabel`；渲染中换成 `cards.rendering` |
| 进度区 | `cards-render-progress` | `rendering === true` | `cards.rendering` |
| **警告区** | `cards-render-warnings` | **`warnings.length > 0`** | `cards.warningsTitle` + 逐条 |
| 单条警告 | `cards-warning-<key>` | 逐条 | 见 §8 映射；**未知 key 原样回显其标识** |
| 错误条 | `cards-render-error` | `failed === true` | 按 §5 映射 |
| 结果区 | `cards-render-result` | `hasResult` | `cards.resultTitle` + `cards.resultCount` + `cards.resultHint` |

### 7.1 按钮禁用条件

`rendering === true` **或** `pages.length === 0`。

**⇒ 防重复点击（防重复触发主进程渲染）。**

---

## 8. 提示文字（zh / en 成对，CI Gate 7 强制）

位置：`apps/desktop/src/locales/cards/{zh,en}.js`；主文件 `zh.js`/`en.js` 以
`cards: { ...cardsZh }` 展开。

| 键 | 中文 | 英文 |
| --- | --- | --- |
| `entryLabel` | 生成图文卡片 | Generate image cards |
| `entryDesc` | 把长文按页切成图文卡片，逐页导出 PNG | … |
| `rendering` | 正在生成图文卡片… | … |
| `resultTitle` | 图文卡片已生成 | … |
| `resultCount` | 共 {count} 张 | … |
| `resultHint` | 已保存到临时目录，可在发布时选择使用 | … |
| `failedValidation` | 入参不合法：{message} | … |
| `failedService` | 渲染服务暂不可用，请稍后重试 | … |
| `failedCount` | 生成页数与预期不符（期望 {expected} 页，实际 {actual} 页），已放弃本次结果 | … |
| `failedUnknown` | 生成失败：{message} | … |
| `warningsTitle` | 请注意以下情况 | … |
| `warningItemExceedsPage` | 有内容单段就超出一页，已被单独成页（排版可能偏空）| … |
| `warningPageLimitReached` | 内容已达页数上限，后续内容未纳入卡片 | … |

### 8.1 warning 键 → 文案键映射

| 引擎 warning | 文案键 |
| --- | --- |
| `item-exceeds-page` | `warningItemExceedsPage` |
| `page-limit-reached` | `warningPageLimitReached` |
| **未知** | **原样回显该标识**（不伪装成已知文案，也不丢弃）|

**★ 未知 warning 的处理是产品契约**：若 `WARNING_KEYS` 缺项就静默丢一条，
用户会漏看真实告警。**如实回显标识至少让用户与支持人员能看到它存在。**

---

## 9. 残余与未含（不假装已闭合）

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | **面板未挂到选题/发布页** | 依赖上游「正文 → pages」供给；当前 `pages` 无来源 ⇒ 挂上去会是「按钮恒禁用」的死 UI |
| 2 | **`failure.key = 'empty'` 无文案** | 分页层的空正文分支，展示层尚未接（面板不接受空正文入口）|
| 3 | 真实 DOM 测量的 QM-1 判据④⑤ | 需 GUI，无 GUI runner 里不写假绿 |
| 4 | 模板供给（U-6）| 当前用内置 1242×1660 |
| 5 | 失败文案里的 `detail` 解析 | 从 `detail` 用正则取数字；若主进程改 `detail` 格式需同步 |

---

## 10. 验证（已落地的机械判据）

| 层 | 测试 | 数量 |
| --- | --- | --- |
| 引擎（CJS） | `shared-utils/src/__tests__/card-paginator-core.test.js` | — |
| 引擎（ESM 孪生 parity）| `card-paginator-core-parity.test.js` | 8 |
| 测量（纯函数）| `electron/services/card-capture-measure.test.js` | 10 |
| 主进程通道 | `electron/ipc-handlers/render.test.js` | 30 |
| 正文 → items | `src/features/cards/useArticlePagination.test.js` | 10 |
| 渲染状态机 | `src/features/cards/useCardsRender.test.js` | 9 |
| 流水线 | `src/features/cards/useCardsPipeline.test.js` | 7 |
| 面板（模板层）| `src/features/cards/CardsRenderPanel.test.js` | 8 |

**★ 反证纪律**：parity 做过「改一处即红、还原即绿」；结构锁做过「接错模块即红」。
