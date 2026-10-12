# PRD：热门选题「一键发布」UX 优化（hot-topics-publish-ux）

- **日期**：2026-10-12
- **状态**：已实现（本文档与代码同 PR 落地）
- **前置**：`PRD-HOT-TOPICS-PUBLISH-HANDOFF-2026-10-09.md`（跨页交接已修复）、`PRD-ARTICLE-PUBLISH-IMAGE-2026-09-29.md`（自动封面兜底已上线）
- **关联分支**：`hot-topics-publish-ux`

---

## 1. 背景与问题

用户实测发现，热门选题页的「一键发布」按钮并非一般理解的一键发布：点按钮后实际发生的是「批量 AI 改写 → 存草稿 → 跳到发布页手工补齐 → 手工点发布」。名不副实 + 三个体验断点：

1. **图片硬断点**：图文平台无图必败，用户被迫逐条手工找图（已有自动封面兜底，但用户不知道）。
2. **改写黑箱**：改写完成后只有一条汇总提示，用户看不到改得怎么样，点「去发布」像开盲盒。
3. **命名误导**：「一键发布」承诺了它不兑现的东西。

经评审共识（Q1–Q10 全部采纳推荐答案），确定优化主目标为 **自动化闭环 + 诚实命名**，人工边界为「发布页字段全部预填、最终发布必须人工点击」。

## 2. 目标与非目标

**目标**
- G1 按钮与流程诚实化：按钮改名、分阶段进度提示、发布页确认横幅。
- G2 改写结果确认点前移：选题页内联预览/编辑改写稿，满意再「去发布」。
- G3 单条快捷路径：每条选题行新增「发布」按钮 = 单篇一键改写（跳过批量弹窗）。

**非目标（本轮不做，PRD 预留）**
- N1 批量多选题自动发布 / 批量直发（演进方向：批量改写 → 草稿箱）。
- N2 自动配图（搜图有版权风险、AI 生图有成本）；沿用发布链路已有的自动封面兜底。
- N3 改写 diff 对照视图（选题通常只有标题/一句话，对照价值有限）。
- N4 完全自动发布（多平台发布不可逆，最终确认必须人工）。

## 3. 变更清单

| # | 变更 | 文件 | 类型 |
|---|------|------|------|
| C1 | 批量按钮改名 | `src/locales/hot-topics/{zh,en}.js` `publishBtn` | 文案 |
| C2 | 分阶段进度提示 key | 同上 `publishStageRewrite` / `publishStagePrepare` | 文案 |
| C3 | 单条「发布」按钮 | `src/views/HotTopics.vue` 行内操作区最右 + `singlePublishBtn` key | 功能 |
| C4 | 改写结果内联预览/编辑 | `src/views/HotTopics.vue` 进度区 + `editPreview/editCollapse/editSaveFailed` key + `HotTopics.css` | 功能 |
| C5 | 去发布前回写编辑 | `HotTopics.vue` `persistEditedDrafts()` + `goToDestination()` 改 async | 功能 |
| C6 | 发布页确认横幅 | `src/locales/publish-page/{zh,en}.js` `handoff.banner`（宿主 Publish.vue 后续接线可选） | 文案 |
| C7 | 回归锁 | `src/views/hot-topics-publish-ux.test.js`（8 例） | 测试 |

## 4. 功能逻辑详述

### 4.1 批量「改写并发布」（既有流程，改名+文案透明化）

流程不变：勾选（≤20，`hotTopics.batchLimit`）→ `PublishDestinationModal` 选图文/视频 → 逐条 `aiRewrite`（IPC `ai:rewrite`，`useViralLibrary` 跟随「结合爆款库」开关）→ `draftSave` 落草稿库 → 「去发布」带 `?draft=`/`?drafts=` 跳发布页 → `useHotTopicsDraftHandoff` 装载并预置全部有账号平台 + 各平台默认账号。

文案变更：
- 按钮 `publishBtn`：`一键发布` → `改写并发布`（en：`Publish` → `Rewrite & Publish`）。
- 进度提示新增分阶段 key：`publishStageRewrite`（「AI 改写中 done/total」）、`publishStagePrepare`（「正在为你预填发布信息…」，供发布页装载阶段使用）。原 `publishProgress` 保留兜底。

### 4.2 单条「发布」按钮（新增）

**位置**：每条选题行操作区最右侧（收藏♡ → 创作文案 → 爆款分析 → 生成视频 → **发布**），`data-testid="hot-topic-publish-<topicId>"`，主按钮样式（与「生成视频」同层级）。

**行为**（`startSinglePublish(topic)`）：
1. 守卫：`publishing` 为 true 时忽略点击（批量改写进行中不允许并发开队列）。
2. 构造队列长度 1：`publishQueue = [{ id, topic, status:'pending', draftId:null, pipelineId:null }]`，`publishMode='article'`。
3. **跳过 `PublishDestinationModal`**：单条图文意图明确，弹窗选「直接发图文」是纯摩擦。
4. 复用 `runQueue()` → `rewriteOne()`：入参与批量完全一致（`buildRewriteInput` 补引导语、`useViralLibrary` 跟随开关）。
5. 成功 → 草稿入库（`source:'hot-topics'`）→ 进度区显示完成态 + 内联编辑入口 + 「去发布」。
6. 「去发布」→ `/publish?draft=<id>`（单篇语义，与既有单条批量路径一致）。
7. 失败 → 条目标红 + 重试按钮（复用 `retryPublishItem`）；取消 → 复用 `cancelPublish`。

**数据校验**：
- 选题 topic 为空/空白：按钮点击早退（不改状态、不弹提示——数据损坏条目与收藏页口径一致，依赖其他按钮的 `disabled` 守卫）。
- `aiRewrite` 返回 `code!==0` 或 `data.success!==true`：条目 `failed`，`error` 记录 message。
- `draftSave` 失败：条目 `failed`，可重试（重试会重新改写并生成新草稿 id，避免悬挂引用）。
- 组件卸载（`disposed`）：草稿已保存但不回写 UI 状态（既有口径保持）。

### 4.3 改写结果内联预览/编辑（新增）

**位置**：发布进度区内，每条 `success` 条目下方渲染「预览 / 编辑改写稿」切换按钮（`data-testid="hot-topic-edit-<topicId>"`），展开后 textarea（`data-testid="hot-topic-edit-textarea-<topicId>"`，rows=8，可纵向拉伸）。

**状态模型**：
- `editingItemId: Ref<string|null>`：当前展开的选题 id（单开，切换自动收起前一条）。
- `editingDraftContent: Ref<string>`：编辑器 v-model。
- `itemDraftContents: Record<topicId, string>`：正文快照。改写成功时以 AI 结果初始化。

**交互逻辑**：
- 展开：以快照为初值填充 textarea。
- 收起（点「收起」）：当前内容写回快照。
- **直接点「去发布」（未收起）**：`persistEditedDrafts()` 先冲刷打开中的编辑器再回写（用户不必先收起）。
- `backToBatch()`：重置全部编辑状态（快照清空，下次改写重新初始化）。

**回写规则（`persistEditedDrafts`）**：
1. 编辑器展开中 → 冲刷到快照。
2. 遍历 `success && draftId` 且快照为 string 的条目；内容 trim 后为空 → 跳过（保留原稿，避免用户清空正文后误存空稿）。
3. 逐条 `draftSave({ id, title: topic.slice(0,64), content, source:'hot-topics', updatedAt })`——与改写时同一 id，主进程按 id 覆盖。
4. 任一条保存失败 → `notifyError('hotTopics.editSaveFailed')`（「编辑内容保存失败，请重试后再去发布」）并**阻止跳转**，进度区保持可见（`publishDone` 仍为 true），用户可重试。
5. 无编辑（快照均为非 string / 未触碰）→ 零 IPC 调用，行为与旧版完全一致。

**显示项**：
| 项 | 说明 |
|---|---|
| 预览/编辑切换按钮 | 未展开显示「预览 / 编辑改写稿」，展开显示「收起」 |
| textarea | 展开时显示，初值 = 快照，双向绑定 |
| 保存失败 toast | 仅回写失败时出现，含引导语 |

### 4.4 发布页确认横幅（key 已备，宿主接线说明）

`publishPage.handoff.banner`（zh：「已根据热门选题自动改写并预填 {count} 条内容与发布目标，请确认后发布」）。设计为**常驻可关闭横幅**（替代一闪而过的 toast 作为改写结果确认点）：`useHotTopicsDraftHandoff.applyDraftHandoff` 装载成功（`found.length === ids.length`）时置 `showHandoffBanner=true` 并 `notifySuccess` 保留；Publish.vue 页头下方渲染，关闭按钮置 false。本轮先落 key 与契约测试，横幅组件接线为 Publish.vue 的独立小改动（宿主在零增长容差清单，评审通过后并入）。

### 4.5 图片断点（说明性，无代码变更）

发布链路已具备自动封面兜底（`usePublishFlow`：图文平台无图时自动生成封面，`publishFlow.generatingCover` / `coverGenerated` / `coverGeneratedFailed` 文案齐全，见 PRD-ARTICLE-PUBLISH-IMAGE-2026-09-29）。热门选题链路经由该链路发布，兜底自动生效；本轮不改。

## 5. 数据校验汇总

| 场景 | 校验 | 行为 |
|---|---|---|
| 单条发布时批量进行中 | `publishing === true` | 点击忽略 |
| 改写返回失败 | `res.code !== 0 \|\| !res.data.success` | 条目 failed + 重试 |
| 草稿保存失败 | `saved.code !== 0` | 条目 failed + 重试 |
| 编辑内容为空白 | `content.trim() === ''` | 跳过回写，保留原稿 |
| 编辑回写失败 | `res.code !== 0` | 阻止跳转 + 错误 toast + 进度区保持 |
| 卸载后在途回写 | `disposed` | 不回写 UI 状态 |

## 6. 提示文字（locales key 清单，zh/en 成对）

| key | zh | en |
|---|---|---|
| `hotTopics.publishBtn` | 改写并发布 | Rewrite & Publish |
| `hotTopics.singlePublishBtn` | 发布 | Publish |
| `hotTopics.publishStageRewrite` | AI 改写中 {done}/{total} | AI rewriting {done}/{total} |
| `hotTopics.publishStagePrepare` | 正在为你预填发布信息… | Preparing publish form for you… |
| `hotTopics.editPreview` | 预览 / 编辑改写稿 | Preview / edit rewrite |
| `hotTopics.editCollapse` | 收起 | Collapse |
| `hotTopics.editSaveFailed` | 编辑内容保存失败，请重试后再去发布 | Failed to save your edits. Retry before publishing. |
| `publishPage.handoff.banner` | 已根据热门选题自动改写并预填 {count} 条内容与发布目标，请确认后发布 | Auto-rewritten from hot topics and pre-filled {count} entries with publish targets. Review and publish. |

## 7. 测试与回归锁

`src/views/hot-topics-publish-ux.test.js`（8 例，CI vitest）：
1. locales 契约 ×4：改名 key、分阶段 key、单条按钮 key、横幅 key（zh/en 成对，读源文件断言——i18n mock 下组件渲染 key 而非文案，模板断言无意义）。
2. 行为锁 ×4：行内「发布」按钮渲染；单条发布 = 队列长度 1 + 不弹目标弹窗 + 仅改写该条；编辑回写先落库再跳转（含未收起直接去发布的冲刷语义）；回写失败阻止跳转。

既有回归全部通过：`HotTopics.test.js`（45 例，其中「去发布」跳转断言补 `flushPromises` 适配 async 化的 `goToDestination`）、`Publish.test.js` 111 例、`useBatchPublish.test.js` 84 例、locale-sync `--keys` / `--cjk` PASS。

## 8. 验收标准

- [x] 批量按钮文案为「改写并发布」，流程提示分阶段
- [x] 每条选题行最右有「发布」按钮，点击后直接进入单条改写（无弹窗），完成后可预览/编辑、可去发布
- [x] 内联编辑的结果在去发布前持久化到草稿库，发布页装载的是编辑后内容
- [x] 编辑保存失败时不跳转，用户可重试
- [x] zh/en 文案成对，locale-sync 门禁通过
- [x] 既有批量/单条/视频链路回归通过
