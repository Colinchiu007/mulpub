# PRD — 视频任务编辑页 UX 补齐（169 段长列表的信息完整性与操作效率）

| 项 | 值 |
| --- | --- |
| 文档版本 | v1.0 |
| 日期 | 2026-10-20 |
| 分支 | `s2v-result-ux-polish` |
| 上游 PRD | `01-docs/PRD-S2V-RESULT-VIEW-PERF-2026-10-20.md`（PR #4064，已合并 `f6a61d24c`） |
| 关联执行记录 | `openspec/records/s2v-result-ux-polish.md` |
| 变更类型 | 运行时（`apps/desktop`：主进程媒体服务 + 渲染端 7 处交互） |

---

## 1. 背景与问题来源

上游 PR #4064 修掉了用户直接抱怨的四个现象（进页面无限加载后空白 / 破图闪烁 / 169 段很慢 / 无占位区块）。
PR 合并后复查**代码而不是界面**，发现两类遗留：

### 1.1 已证实的遗留缺陷（有代码证据）

| # | 缺陷 | 证据 | 用户可见后果 |
| --- | --- | --- | --- |
| D1 | 媒体令牌登记容量 128、**FIFO 淘汰** | `story2video-media-server.js` `DEFAULT_MAX_ENTRIES=128`、`_enforceCapacity` 删最老令牌 | 169 段 × 最多 5 个媒体位 = **最多 845** 个 URL。展开到约 **26 段**就开始淘汰，被淘汰 == 该段图 404 == 渲染端 `@error` 兜底显示「未生成」。**用户最初抱怨的破图形态会回归** |
| D2 | 令牌 TTL **固定 15 分钟** | `DEFAULT_TOKEN_TTL_MS=15min`，命中不续期 | 在编辑页停留 >15 分钟 ⇒ 全部令牌被 `_pruneExpired` 清空 ⇒ 图片整片变「未生成」 |
| D3 | 滚动高亮**无节流** | `window.addEventListener('scroll', this.onSegmentScroll)` 直接挂，`onSegmentScroll` 对每个已挂 ref 调 `getBoundingClientRect()` | 169 段全展开 = 每个 scroll 事件 **169 次强制 layout 读取**（会触发重排）⇒ 滚动发涩、右侧高亮拖尾 |

### 1.2 明确的 UX 缺口

| # | 缺口 | 用户心里的话 |
| --- | --- | --- |
| U1 | 失败任务**不显示失败原因** | 「为什么没成片？是我做错了什么吗？」——页面只说「尚未生成成品视频，可先编辑分段内容，再重新合成」 |
| U2 | `completionSummary`（完成进度）被关在 `v-if="videoPath"` 分支里 | 失败任务连「完成了几段」都看不到 |
| U3 | 大跨度跳转的 1–2 秒**无反馈** | 「点了没反应？」（渲染 130+ 张卡 + 最多 ~650 次 IPC 期间） |
| U4 | 169 段要点 **8 次**「显示更多分段」，且不告诉用户还剩多少 | 「还要点几次？」 |
| U5 | 无**回到顶部** | 滚到第 169 段改完，回顶很痛苦 |
| U6 | 无**分段搜索/筛选** | 想找「提到 A 产品的那段」只能滚 169 次；12 段失败混在 169 段里靠肉眼找 |
| U7 | 右侧 169 个数字的**键盘可达性**差 | Tab 要按 169 次 |

---

## 2. 目标与非目标

### 2.1 目标

1. **D1/D2 归零**：让一个 169 段（乃至 200 段）任务在整页展开 + 长时间编辑下，图片**不会**因为令牌机制变成「未生成」。
2. **D3 归零**：滚动高亮每帧最多 1 次重排，且高亮不滞后。
3. **U1/U2 补齐**：占位区块从「一句通用说明」升级为「能回答为什么失败」的摘要卡。
4. **U3 补齐**：任何跳转都有「正在展开到第 N 段…」的即时反馈。
5. **U4–U7 补齐**：计数文案（已显示 N / 共 M）、展开全部、回到顶部、搜索 + 三档筛选、roving tabindex 键盘导航。

### 2.2 非目标（明确不做，避免范围蔓延）

| 不做 | 理由 |
| --- | --- |
| 虚拟滚动（windowing）重构 | 分段卡高度可变（文案/提示词/4 个素材位），真正的变高虚拟滚动需要锚点补偿，会同时影响**成功任务**的滚动体验；本轮用「追加窗口 + 展开全部 + 筛选」已把 169 段场景做到可用。记入 §9 |
| 服务端批量签 URL（降 IPC 次数本身） | 需改 IPC 契约 + preload + 三层测试，独立议题。本轮只保证「按需申请」与「容量足够」 |
| 渲染端主动 `revoke` 旧令牌 | 需要新增 IPC 通道（改 preload 契约）。本轮把容量提到 1024 后，169 段（845）与 200 段（1000）都在容量内，revoke 的收益让位于契约风险。记入 §9 |
| 失败原因码的语义扩写 | 本轮只在**已存在的** `failureCode` 字段上做聚合与翻译；不猜测后端没给的成因 |

---

## 3. 数据校验（逐字段）

### 3.1 媒体服务器容量与过期（主进程）

| 常量 | 旧值 | 新值 | 依据 |
| --- | --- | --- | --- |
| `DEFAULT_MAX_ENTRIES` | 128 | **1024** | 169 段 × 5 位 = 845；取 1024 覆盖到 200 段并留写后刷新的新旧令牌并存余量 |
| `MAX_REGISTRY_ENTRIES`（上限钳制） | 256 | **2048** | `maxEntries = min(positiveInteger(opt), MAX_REGISTRY_ENTRIES)`，不抬上限则默认值会被静默钳回 256 |
| `DEFAULT_TOKEN_TTL_MS` | 15 min（固定） | 15 min（**滑动**） | 命中即 `expiresAt = now + ttl`；停止使用超过 TTL 仍失效 |

**滑动过期的精确语义（必须写清，否则会被实现成"永不过期"）**：

```
get(token):
  entry = entries.get(token)
  if !entry or entry.expiresAt <= now:        # 已过期
      delete(token); return 404
  entry.expiresAt = now + ttl                 # ← 命中即续期（本次新增）
  ...继续走文件存在性校验与 Range--
```

**校验矩阵**：

| 场景 | 期望 |
| --- | --- |
| 845 个 URL 全部创建后立刻访问第 1 个 | 200（不得被 FIFO 淘汰） |
| 845 个 URL 全部创建后访问第 845 个 | 200 |
| 超容量（>1024）继续创建 | 仍按 FIFO 淘汰最老（容量语义不变，只是上限放宽） |
| 每 800ms 访问一次、累计 4000ms（>TTL 1000ms） | 每次 200（续期生效） |
| 最后一次访问后静置 1200ms（>TTL） | 404（**不是永不过期**） |
| 容量 1 + 两个令牌 + 续期第一个后创建第二个 | 第二个进驻时第一个被淘汰，即使它刚续过期 |

### 3.2 失败摘要 `buildFailureSummary({ segments })`

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `total` | number | **只计对象型分段**（`isPlainObject`）；`null`/`'oops'` 等脏元素不计入 |
| `failedCount` | number | `status === 'failed'` |
| `completedCount` / `pendingCount` / `processingCount` | number | 对应 status 精确匹配 |
| `policyFlaggedCount` | number | `policyFlagged === true`（严格 true，`'true'` 字符串不计） |
| `failedIndexes` | number[] | 失败段的**全量下标**（升序，DOM 顺序） |
| `firstFailedIndex` | number | 最小失败下标；**无失败段为 -1** |
| `hasFailure` | boolean | `failedIndexes.length > 0` |
| `reasons` | `{code,count}[]` | 依据 `failureCode`（回落 `failedReasonCode`）；**空码不计入**；按 count 降序、同 count 按 code 字典序（渲染稳定，不随对象键序抖动） |

**脏数据边界**：`buildFailureSummary({})` / `{segments:null}` / 全部非对象 ⇒ 返回 `{total:0, failedCount:0, firstFailedIndex:-1, hasFailure:false, reasons:[]}`，不抛错。

### 3.3 筛选与搜索 `filterSegments(segments, {mode, query, policySceneNumbers})`

| 项 | 规则 |
| --- | --- |
| `mode` | 仅接受 `all` / `failed` / `policy`；其他值回落 `all` |
| `failed` | `status === 'failed'` |
| `policy` | `policySceneNumbers.has(index + 1)`（场景号 **1-based**）；无集合时返回空 |
| `query` | `trim().toLowerCase()` 后做**子串**匹配；空/空白 = 不筛选 |
| 搜索文本源 | `text` / `prompt` / `videoPrompt` / `subtitleBlocks`（数组则展开，字符串直接用） |
| **`absoluteIndex`** | **必须是全量下标，不是筛选后序号** ← 硬约束 |

> ⚠️ **为什么 `absoluteIndex` 是全量下标**：上移 / 下移 / 删除 / 导出命名 / 政策徽标全部按全量下标寻址。若退化成筛选序号，在「只看失败段」模式下点删除会**删掉别的段**。回归锁：`filterSegments` 的 failed 用例断言 `[1,3]` 而不是 `[0,1]`。

### 3.4 计数文案 `buildSegmentCountLabel({ shown, total, filtered, translate })`

| 条件 | 文案键 |
| --- | --- |
| `filtered && shown === 0` | `segmentCountNoMatch` |
| `!filtered && shown >= total && total > 0` | `segmentCountAll`（`{total}`） |
| 其他 | `segmentCountPartial`（`{shown}` / `{total}`） |

负数 / 非数字入参一律按 0 处理（`Math.max(0, Math.floor(n))`）。

### 3.5 跳转计划 `resolveSegmentJumpPlan({ index, total, renderedTo })`

| 输入 | `needsScroll` | `needsExpand` | `expandTo` | `batch` |
| --- | --- | --- | --- | --- |
| 非整数 / 负数 / `>= total` | false | false | `renderedTo` | `{from:renderedTo,to:renderedTo}` |
| `index < renderedTo`（窗口内） | true | false | `renderedTo` | 空区间 |
| `index >= renderedTo`（窗口外） | true | true | `min(total, index+1)` | `{from:renderedTo, to:index+1}` |

**只解析新增区间**：`batch.from = renderedTo`（绝不复用 0），这是上游 QM-6 审查 A6「首批被重复解析」的同一个坑，本轮把它固化成函数契约。

### 3.6 roving tabindex `resolveJumpFocusTarget({ key, current, total })`

| key | 结果 |
| --- | --- |
| `ArrowRight` / `ArrowDown` | `min(total-1, current+1)` |
| `ArrowLeft` / `ArrowUp` | `max(0, current-1)` |
| `Home` | 0 |
| `End` | `total-1` |
| 其他（含 `Tab`） | `null` ⇒ 调用方**不得** `preventDefault`（Tab 必须能出去） |
| `total <= 0` | `null` |

---

## 4. 功能逻辑

### 4.1 滑动过期（D2）

- 命中令牌后**先校验未过期**，再续期，最后做文件存在性/Range 校验。
- 续期**不改变容量**：`_enforceCapacity` 只按插入顺序淘汰，续期不动 Map 顺序 ⇒ 活跃令牌不会让已淘汰令牌复活（有回归锁）。

### 4.2 失败摘要卡（U1/U2）

- 宿主 `failureSummary` computed 调 `buildFailureSummary`，作为 prop 传给 `ResultPreviewPlaceholder`。
- 组件内部拼文案：段数统计 → 聚合原因 → 政策提示 → 行动位。
- **原因码 → 文案** 走 `FAILURE_REASON_LABEL_KEYS`（composable 单一真源）；未知码回落 `failureReasonUnknown`，不编造。
- 「定位到首个失败段」：`firstFailedIndex < 0` 时不渲染该按钮。

### 4.3 跳转反馈（U3）

```
jumpToSegmentIndex(vm, index)
  plan = resolveSegmentJumpPlan(...)
  if !plan.needsScroll: return false
  vm.activeSegmentIndex = index                     # 高亮立刻跟手
  if plan.needsExpand:
      vm.jumpPendingIndex = index                   # 渲染「正在展开到第 N 段…」+ 数字 pending 态
      try: 只解析 [batch.from, batch.to) 的 URL
      finally: vm.jumpPendingIndex = -1             # 必须复位（防止永久 loading）
  await vm.$nextTick()                              # 等 DOM 落地
  refs[index].scrollIntoView({behavior:'smooth'})
```

### 4.4 展开全部（U4）

- 前置：`renderedTo < total`，否则直接返回 false。
- **先确认**（`window.confirm`，文案含 `{total}`）——一次性渲染 169 张卡可能短暂卡顿；用户取消则**不做任何事**。
- 确认后：窗口一步推到 `total`，只解析 `[renderedTo, total)`。

### 4.5 筛选与搜索（U6）

- 宿主 `displayedSegments` computed：
  - 未筛选 ⇒ 返回渲染窗口内可见段（保持分批语义，省 DOM）；
  - 已筛选 ⇒ **跨全量分段**搜索（用户预期是在整个任务里找，不是只在已展开的 20 段里找）。
- 筛选生效时**隐藏哨兵与「显示更多」**（筛选结果已跨全量，再追加没有意义）。
- 筛选无命中渲染 `segment-empty-filter`：明确告诉用户「是筛选条件的问题」，不是页面空了。
- 搜索输入框 `type="search"`，`@input` 直传（无防抖：本地全量数组过滤，169 × 4 字段 < 1ms）。

### 4.6 回到顶部（U5）

- 出现条件：`window.scrollY > 600`（并入滚动回调计算，不额外加监听）。
- 点击：优先 `vm.$el.scrollIntoView`，否则 `window.scrollTo({top:0})`。
- 位置：`fixed; right:24px; bottom:96px`（避开底部固定操作条 `result-action-bar`）。

### 4.7 滚动节流（D3）

**前沿节流（leading-edge）**：本帧第一次滚动**立即**算一次，同帧后续事件只把帧标记清空。

- 为什么不是 trailing（推迟到 rAF 里算）：那会让高亮滞后一帧，且程序化重算（删除/移动后）会被同帧吞掉 ⇒ 高亮滞留在被删掉的那一段上（**本轮实测踩过**）。
- 程序化重算走 `recalcSegmentHighlight()`：先清帧标记再立即算，**不受节流影响**。

---

## 5. 交互逻辑与显示项

### 5.1 失败摘要卡（`ResultPreviewPlaceholder`）

| 元素 | testid | 显示条件 | 文案键 |
| --- | --- | --- | --- |
| 容器 | `result-preview-placeholder` | `projectId && !loading`（加载失败另走独立空态） | — |
| 标题 | — | 始终 | `previewPlaceholderTitle` |
| 说明 | — | 始终 | `previewPlaceholderDescription` |
| 摘要容器 | `failure-summary` | `total > 0` | — |
| 段数统计 | `failure-summary-counts` | 同上 | `failureSummaryCounts`（`{total}{failed}{completed}`） |
| 聚合原因 | `failure-summary-reasons` | `reasons.length > 0` | `failureSummaryReasons`（`{reasons}`），条目 `failureSummaryReasonItem`（`{label}{count}`），多条以「、」连接 |
| 无原因提示 | `failure-summary-no-reason` | `reasons` 为空 **且** `hasFailure` | `failureSummaryNoReason` |
| 政策提示 | `failure-summary-policy` | `policyFlaggedCount > 0` | `failureSummaryPolicyNote`（`{count}`） |
| 定位失败段按钮 | `failure-summary-jump` | `hasFailure` | `failureSummaryJump`；`disabled = jumpPending` |
| 重新合成按钮 | `preview-placeholder-recompose` | `placeholder.actionEnabled` | `recompose`；`disabled = recomposing \|\| anySegmentBusy` |

### 5.2 分段筛选栏（`ResultSegmentEditor`）

| 元素 | testid | 行为 |
| --- | --- | --- |
| 计数文案 | `segment-count-label` | 「已显示 20 / 共 169 段」/「共 169 段」/「没有匹配的分段」 |
| 模式：全部 | `segment-filter-all` | 始终可用 |
| 模式：只看失败 | `segment-filter-failed` | `failedCount <= 0` 时 **disabled**（避免点了必然空列表） |
| 模式：只看政策标记 | `segment-filter-policy` | `policyCount <= 0` 时 disabled |
| 搜索框 | `segment-search-input` | `type=search`，placeholder `segmentSearchPlaceholder`，`aria-label` 同文案 |
| 清空 | `segment-filter-clear` | 仅 `filtered` 时显示；一键回到「全部 + 空关键词」 |
| 筛选无命中 | `segment-empty-filter` | `filtered && 显示 0 条` |
| 显示更多 | `segment-load-more-button` | `batchLoading` 时文案变 `loading` |
| 展开全部 | `segment-expand-all-button` | 仅未筛选时显示 |

### 5.3 右侧定位条（`ResultSegmentJumpBar`）

| 元素 | 规则 |
| --- | --- |
| 显示条件 | `projectId && segments.length > 1` |
| 数字按钮 | `tabindex`：焦点重置点 `0`，其余 `-1`；`aria-current="true"` 标记当前段；`aria-label` 为 `segmentJumpAriaLabel{n}` |
| 跳转中 | `class="pending"`（`opacity .55` + `cursor:progress`）+ `disabled` |
| 键盘 | 方向键 ±1、Home / End；`Tab` 不被拦截 |
| 上一条/下一条 | `activeIndex <= 0` / `>= 末位` 时 disabled |

### 5.4 回到顶部

| 元素 | testid | 规则 |
| --- | --- | --- |
| 浮动按钮 | `back-to-top` | `scrollY > 600` 才渲染；`aria-label` = `backToTopAria`，`title` = `backToTop`；图标 `↑` |

---

## 6. 提示文字（zh/en 成对，18 个新键）

| 键 | zh | en |
| --- | --- | --- |
| `failureSummaryTitle` | 生成未完成 | Generation did not finish |
| `failureSummaryCounts` | `{total} 段中 {failed} 段失败、{completed} 段已完成` | `{failed} of {total} segments failed, {completed} completed` |
| `failureSummaryReasons` | `主要原因：{reasons}` | `Main causes: {reasons}` |
| `failureSummaryReasonItem` | `{label}（{count} 段）` | `{label} ({count} segments)` |
| `failureSummaryPolicyNote` | `其中 {count} 段已被内容政策定位，建议优先检查。` | `{count} segments were flagged by content policy — check those first.` |
| `failureSummaryJump` | 定位到首个失败段 | Go to the first failed segment |
| `failureSummaryNoReason` | 未记录具体失败原因，可查看完整日志或直接重新合成。 | No specific cause was recorded. Check the full log or recompose directly. |
| `failureReasonPolicy` | 内容政策拦截 | Content policy blocked |
| `failureReasonQuota` | 额度不足 | Quota exhausted |
| `failureReasonMaterial` | 素材生成失败 | Material generation failed |
| `failureReasonTimeout` | 生成超时 | Generation timed out |
| `failureReasonModel` | 模型调用失败 | Model call failed |
| `failureReasonUnknown` | 其他原因 | Other cause |
| `segmentCountAll` | `共 {total} 段` | `{total} segments` |
| `segmentCountPartial` | `已显示 {shown} / 共 {total} 段` | `Showing {shown} of {total} segments` |
| `segmentCountNoMatch` | 没有匹配的分段 | No matching segments |
| `loadAllSegments` | 展开全部 | Show all |
| `expandAllConfirm` | `展开全部 {total} 段会一次性渲染全部卡片，可能短暂卡顿，确定吗？` | `Showing all {total} segments renders every card at once and may stutter briefly. Continue?` |
| `segmentFilterAll` | 全部 | All |
| `segmentFilterFailed` | 只看失败 | Failed only |
| `segmentFilterPolicy` | 只看政策标记 | Policy-flagged only |
| `segmentSearchPlaceholder` | 搜索文案 / 提示词 / 字幕 | Search text / prompt / subtitle |
| `segmentSearchClear` | 清空搜索 | Clear search |
| `segmentJumpPending` | `正在展开到第 {n} 段…` | `Expanding to segment {n}…` |
| `backToTop` | 回到顶部 | Back to top |
| `backToTopAria` | 返回页面顶部 | Return to the top of the page |

---

## 7. 组件契约

### 7.1 `ResultPreviewPlaceholder.vue`

| prop | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `placeholder` | Object | ✅ | `buildPreviewPlaceholder()` 产物 |
| `failure` | Object | — | `buildFailureSummary()` 产物 |
| `recomposeDisabled` | Boolean | — | 重新合成不可用 |
| `jumpPending` | Boolean | — | 跳转中（禁用定位按钮） |

emits：`recompose`、`jump-first-failed`。

### 7.2 `ResultSegmentJumpBar.vue`

| prop | 类型 | 说明 |
| --- | --- | --- |
| `segments` | Array | 全量分段（只读 id 与长度） |
| `activeIndex` | Number | 当前高亮段（-1 = 无） |
| `pendingIndex` | Number | 跳转中目标（-1 = 空闲） |
| `focusIndex` | Number | roving tabindex 焦点重置点 |

emits：`jump(index)`、`step(offset)`、`update:focus-index(index)`。

### 7.3 `composables/useSegmentNavigation.js`

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `resolveJumpFocusTarget` | `({key, current, total}) => number\|null` | 纯函数 |
| `jumpToSegmentIndex` | `(vm, index) => Promise<boolean>` | 依赖 vm 的 `previewLayout` / `refreshSegmentImageUrls` / `$nextTick` |
| `expandAllSegments` | `(vm, host?) => Promise<boolean>` | `host.confirm` 可注入（测试用） |
| `backToTop` | `(vm) => void` | — |

> 设计取舍：这些函数接收宿主 `vm` 而不是闭包捕获 `this`，便于单测直接传桩对象；同时**不在函数内重算步长**（一律用 `resolveSegmentJumpPlan` 的结论），避免重现「首批被重复解析」。

---

## 8. 验收标准

| # | 标准 | 验证方式 |
| --- | --- | --- |
| A1 | 845 个 URL 全部可访问（无一被 FIFO 淘汰） | 单测：默认容量下建 845 个令牌，断言首/尾均 200 |
| A2 | 访问即续期：活跃使用不因固定 TTL 失效 | 单测：每 800ms 访问一次、累计 4000ms 仍 200 |
| A3 | 停止使用超过 TTL 仍失效（**不是永不过期**） | 单测：续期后静置 >TTL ⇒ 404 |
| A4 | 续期不改变容量：已淘汰令牌不复活 | 单测：容量 1 + 续期 + 新建 ⇒ 旧的 404 |
| A5 | 失败摘要统计正确（总数/失败/完成/待处理/政策/首失败下标） | 单测 + 组件断言 |
| A6 | 失败原因同因合并且按次数降序；无码不计入 | 单测 |
| A7 | 无失败段时 `firstFailedIndex === -1` 且不渲染定位按钮 | 单测 |
| A8 | 未知原因码回落「其他原因」，不编造 | 单测（映射表契约） |
| A9 | 「只看失败」筛选后 `absoluteIndex` 仍是全量下标 | 单测：断言 `[1,3]` 而非 `[0,1]` |
| A10 | 搜索跨全部 169 段（不只在首屏 20 段里找） | 单测：第 150 段命中 |
| A11 | 计数文案三种形态（已显示/全部/无命中） | 单测 |
| A12 | 「展开全部」取消时不做任何事 | 单测（`confirm` 返回 false ⇒ 窗口不变） |
| A13 | 大跨度跳转结束后 `jumpPendingIndex === -1`（不残留 loading） | 单测 |
| A14 | 越界跳转返回 false 且不抛错 | 单测 |
| A15 | roving tabindex：整组只有当前项 `tabindex=0` | 单测 |
| A16 | 方向键移动焦点并跳转；`Tab` 不被拦截 | 单测（真实 DOM keydown） |
| A17 | 滚动超过 600px 才出现回顶按钮 | 单测 |
| A18 | 滚动高亮每帧最多 1 次重排，且首帧立即跟手 | 结构 + 行为（前沿节流） |
| A19 | 程序化重算不受节流影响（删除/移动后高亮不滞留） | 单测：删除后 `activeSegmentIndex` 立即正确 |
| A20 | `ResultView.vue` ≤ 1890 行（点名还账零增长） | `check-max-lines.js` |
| A21 | 测试文件行数在账本容差内（新守护独立成文件） | `check-max-lines.js` |
| A22 | zh/en 文案成对，无新增渲染端硬编码中文 | `check-locale-sync.js --cjk` / `--pair-base` |
| A23 | 打包通过（改 `electron/`） | QM-1 `electron-builder --win --x64` |

---

## 9. 已知局限（不假装闭合）

1. **未做虚拟滚动**：169 段展开后仍是 169 个 DOM 卡片。用「追加窗口 + 展开全部 + 筛选」把 169 段做到可用；1000 段级任务需要真正的变高虚拟滚动（含锚点补偿），会同时影响成功任务的滚动体验，需独立排期。
2. **未做渲染端 `revoke`**：容量提到 1024 后，169 段（845）与 200 段（1000）都在容量内；>200 段任务仍会 FIFO 淘汰。彻底修法是新增 revoke IPC 并让窗口外的分段释放令牌（需改 preload 契约）。
3. **IPC 次数本身未降**：仍是每段最多 5 次 `create-share-url`；服务端批量签 URL 是独立议题。
4. **原因码语义有限**：只聚合后端已给的 `failureCode`；后端不写码时显示「未记录具体失败原因」，不猜测。
5. **`expandAllSegments` 用 `window.confirm`**：Electron 下是原生模态，视觉与应用内弹窗不一致。后续可换 `UiModal`；本轮优先保证「不会误触一次性渲染」。
6. **搜索无防抖**：本地全量过滤，169 段 × 4 字段实测 <1ms，加防抖反而引入输入延迟。若未来分段数上千再评估。
7. **QM-4 视觉回归未跑**：本机 QG Visual 基线已仓库级失效（同 `result-view-back-btn-style` 结论），不重建基线。本轮新增了失败摘要卡与筛选栏，建议基线修复后统一重建。
8. **未做实机 wall-time 复测**：滚动节流的收益来自「每帧 1 次 vs 每事件 N 次」的静态推算 + 单测，真实手感需实机确认。
