# Design: collection-ui-refinement

## 方案对比

### 方案 1（采纳）：子组件抽取 + 折叠分组 + token 收编
- 批量采集区与采集结果列表抽成 `features/collection/` 下两个子组件（沿用 quick-collect / 博主监控先例「新组件 + Collection.vue 一行 import」）。
- 优点：同时满足行数门禁与 IA 收敛；抽出的组件获得独立测试位；重复进度机制在迁移过程中天然统一。
- 缺点：迁移面较大（~250 行模板 + 对应 script），需要严格的 props/emit 契约防止行为漂移。

### 方案 2：不拆文件，纯 CSS/token 修改
- 被否：max-lines 零容差下没有增量空间，且解决不了散乱的结构性根因。

### 方案 3：向导式重设计
- 被否：破坏既有直达入口（KnowledgeBasePage「用链接采集」跳转、HotTopics 复用），回归面爆炸。

## 组件契约

### `BatchCollectPanel.vue`
- props: 无（自持状态；对外只 emit）。
- emits:
  - `collected(items: CollectedItem[])` — 批量采集完成，items 已按既有归一化契约构造（与 `Collection.vue` 各 `unshift` 路径同形，含 `id/source/title/content/wordCount/mediaType/…`）；
  - `error(message: string)` — 批量失败（batchError 上抛，父级走统一错误横幅）。
- 内部状态整体迁自 Collection.vue：`rssUrl`、`urlListInput`、`batchCollecting`、`batchTaskId`、`batchProgress`、`batchError`、`zhihu*` 全族。轮询/取消/事件订阅的生命周期由本组件 `onUnmounted` 自理（对齐 PRD-IPC-RESILIENCE-2026-10-07 的清理清单要求）。
- 进度统一：知乎「采集并改写」进度卡与批量采集进度条都渲染为同一个 `ColProgressBlock`（props: `title/percent/text/cancelable/detailLines?`）。

### `CollectedResultsList.vue`
- props: `items: CollectedItem[]`、`activeId: string|null`、`selectedIds: Set<string>`。
- emits: `select(item)`、`createDraft(item)`、`toVideo(item)`、`publish(item)`、`toggleSelect(item)`、`toggleSelectAll(checked)`、`clear()`、`batchPublishImages()`、`batchGenerateVideos()`、`batchPublishVideos()`。
- 批量操作条的平台/账号选择逻辑经 props 传入 options、经 emit 上抛（父级持 batch composable 不动）。

### Collection.vue 侧
- 保留：页头/页签、URL 单条采集工具条与结果卡（本页主路径，不折叠）、草稿箱、文案库/快捷采集/博主监控页签、全部弹窗。
- 改造：style 块亮色硬编码 → tokens 语义槽；知乎收藏夹内联样式类化（类名迁入 BatchCollectPanel）。
- 行数预算：模板迁出 ~250 行 + script 迁出 ~600 行，净降 ≥600 行，远低于 2920 基线。

## 视觉规范（显示项 / 提示文字）

### token 收编映射（亮色硬编码 → 语义槽）
| 现值 | 目标 |
|---|---|
| `linear-gradient(135deg,#f8fafc,#f1f5f9)`（.cohere-content） | `var(--color-bg-page)`（新增槽，亮 #f8fafc 系 / 暗 #16161d 系） |
| `rgba(255,255,255,0.98)` 卡底 | `var(--color-bg-card)` |
| `rgba(229,231,235,.8/.6)` 卡边 | `var(--color-border)` |
| `linear-gradient(90deg,#ea580c…)` 顶部饰带 | `var(--color-ribbon)`（新增槽，暗色降饱和） |
| `#fff3f3` / `#d32f2f` 错误底/字 | `var(--color-error-banner-bg/-text)`（已有槽） |
| `#e6a23c` 改写失败徽标 | `var(--color-warning)`（新增槽或复用既有警告槽，亮/暗两档） |
| `#ececee` / `#a8a8b3` 未知标签 | `var(--soft-stone)` / `var(--color-text-secondary)` |
| `#dcdee3` 标签边 | `var(--color-border)` |

新增槽一律同步登记进 `tokens.slots.test.js` / `tokens.aliases.test.js` 既有契约测试（亮/暗两档 + WCAG 对比断言），不得只写亮色。

### 折叠分组交互逻辑
- 手风琴互斥：`expandedBatch: 'rss' | 'urlList' | 'zhihu' | null`，点击标题切换，展开一组时收起其他组；默认展开 `rss`。
- 折叠态显示摘要（如知乎组显示已选收藏夹名/数量），保证折叠不丢上下文。
- 键盘可达：标题为 `<button>`，Enter/Space 切换，`aria-expanded` + `aria-controls`。
- `data-testid` 保留原值（`batch-select-all` 等属结果列表；`zhihu-fav-*` 随迁 BatchCollectPanel 原样保留）。

### 进度统一显示项
- 标题（locale）、进度轨道（`--color-progress-track`/`--color-primary`）、`done/total` 文本、取消按钮（`cancelBatch`）；知乎组追加可展开逐条明细（保留 `zhihu-fav-summary` / `zhihu-fav-batch-progress` testid）。

### 结果卡信息层级
- 一级：标题（单行截断 + title 提示）、来源·字数·时长·平台、时间。
- 二级徽标：改写失败（warning 色）、已改写（含前 40 字预览）、图片降级计数。
- 操作分主次：`创建草稿`/`发布` primary；`查看`/`视频创作`/`改写` secondary；`删除` danger。悬停抬升效果保留但动效时长/缓动走 token。

### 三态
- 空：草稿箱/文案库已有 EmptyState，采集结果列表补「暂无采集结果」空态（复用 EmptyState，action 唤起 URL 输入焦点）。
- 加载：采集按钮文案既有 locale（采集中…/批量采集中）保留；新增列表骨架可选，本轮不引入新骨架组件。
- 错误：全部走 `col-error-banner` token 化样式 + locale 文案；禁止裸 message 直出（对齐 PRD 全量错误格式化契约）。

## 数据校验（不变项的显式声明）
- 知乎数量输入 1–100、全量 ≤200、URL 非空校验、采集错误分类（collect-error.js）、改写字数区间校验——全部保留原实现，仅随迁组件；迁移前后 IPC 入参逐字段一致（回归锁见 tasks）。

## 风险与对策
- **行为漂移**：Collection.test.js（100+ 用例）与 CollectionCreatorTab/QuickCollect 测试是回归网；迁移必须保持 testid 与 DOM 角色标签不变。
- **视觉基线**：collection 像素基线必然漂移 → 按 learnings 先例「先归因（差异带剖面 = 本次有意改动区）→ 再 --update 重建 → 前后截图入档」。
- **locale 基线**：新文案只进 locales（zh/en 成对）；`Collection.vue` script 迁移不改字符串字面量，CJK 基线不新增。
