# PRD：采集页「AI 改写 → 去发布 → 视频创作」链路修复（2026-10-20）

> change：`fix-collection-rewrite-publish-flow`
> 分支：`fix-collection-rewrite-publish-flow`
> 执行记录：`openspec/records/fix-collection-rewrite-publish-flow.md`

## 1. 背景与目标

### 1.1 用户报障（三条，独立缺陷，一次报障）

用户在采集页连续操作时遇到三个问题：

1. **字数区间设了不生效**：把「字数」设成 0-6000，点「AI 改写」后出来的正文**非常少**，
   而且**像是没有结束**（句子戛然而止）。
2. **「视频创作」不该跳页**：点「去发布」→ 选「视频创作」后，应用跳到了视频创作页。
   更合理的交互是：发布操作浮层（发布图文 / 视频创作）**消失**，改为弹出
   **视频创作流水线的执行进度状态浮层**。
3. **二次改写带的是旧文案**：对单条网页「一键改写」后不满意，又点了一次「AI 改写」。
   二次改写完成后走「去发布」→「视频创作」，**带进视频创作的文案是第一次「一键改写」的
   输出**，不是第二次的最新结果。

### 1.2 目标

- 采集页的字数区间**真正送达改写引擎并生效**，且截断对用户**可见**；
- 「视频创作」改为**就地执行 + 进度浮层**，不再跳转视频创作页；
- 任何一次改写之后，带往下游（图文物化 / 视频创作）的一定是**最新那次**的文案。

### 1.3 非目标

- 不改改写引擎（`packages/rewrite-engine`）的任何行为——本次只修**调用方传参契约**；
- 不改 Python 聚合层（`packages/python-backend`）的 `target_word_count` 契约——
  该链路已不在采集页主链路上（2026-10-18 起采集页改写走桌面 `aiRewrite`），
  但**保留**其向后兼容能力；
- 不改「热门选题一键成片」的既有交互（本次只**复用**它的契约，不动它的行为）；
- 不做视频创作参数（分镜、配音、素材）的可视化配置——采集页沿用用户上次保存的
  `story2video.lastOptions.v1` 快照。

---

## 2. 缺陷根因（第一性原因）

### 2.1 缺陷 ①：字数区间失效（键名契约错位 + `||` 吞 0）

**现象**：0-6000 ⇒ 实得约 3000 字，且砍在句子中间。

**根因 A（主因）：传参键名对不上。**

采集页 `Collection.vue` 的 `rewriteViaEngine()` 构造的 `userSettings` 是：

```js
userSettings: {
  tone: ...,
  targetWordCount: { min, max },   // ← Python 聚合层的旧契约
  targetLength: 'short' | 'medium' | 'long',
  knowledgeOptions: { ... },
}
```

而桌面改写引擎（`packages/rewrite-engine/src/rewrite-engine-core.js`）读的是
**`userSettings.wordCountRange`**：

| 引擎位置 | 读哪个键 | 读不到时的后果 |
|---|---|---|
| `_getWordCountInstruction(userSettings)` | `wordCountRange` | **不注入**「【字数要求】改写后的文本长度必须控制在 X 到 Y 字之间」指令 ⇒ 模型根本不知道要写多少字 |
| `_postProcess(text, strategy, wordCountRange)` | `wordCountRange.max` | 回落到 `策略.postProcess.maxLength ?? DEFAULT_MAX_OUTPUT_LENGTH(3000)` ⇒ **输出被硬砍到 3000 码点** |

连带损伤：主进程 `apps/desktop/electron/services/rewrite-engine.js` 的
`_lastWordCountRangeMax` 读的也是 `wordCountRange.max`，取不到 ⇒ `max_tokens`
永远按兜底 3000 推导 ⇒ 模型侧还会被 token 上限二次截断。

**为什么用户会看到「像没有结束」**：`_postProcess` 的砍尾是
`codePoints.slice(0, maxLength).join('')` —— **硬切**，不找句读、不加省略号，
所以最后一句停在半句上。

**根因 B：`||` 兜底把用户填的 0 吞成 800。**

```js
const minW = Number(rewriteWordCountMin.value) || 800   // 0 是 falsy ⇒ 0 变 800
```

用户填 0 的语义是「下限不设限」，被静默改成 800。

**逃逸分析（QM-5 ②）**

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | `rewrite-engine-core.test.js` 断言的是引擎**收到 `wordCountRange` 时**的行为；**没有任何用例断言「采集页传出去的键名」** |
| 组件测试 | `Collection.test.js` 断言的是「改写后 `rewriteResult` 被赋值」，不检查 `aiRewrite` 的入参形状 |
| 契约测试 | 引擎与渲染层之间**没有键名契约锁**（`rewrite-engine-limits.test.js` 只锁上下限常量） |
| 评审 | 改写页（RewriteView）一直传 `wordCountRange`，**采集页是唯一的例外**——但两页共用同一套 UI 组件，评审默认两边一致 |
| 流程 | 2026-10-18 采集页从 Python 链切到桌面 `aiRewrite` 时，**只改了调用函数，没改参数形状**（迁移期留下的契约漂移） |

### 2.2 缺陷 ②：「视频创作」跳页

**现象**：点「视频创作」→ 跳 `/create?draft=...&pipeline=...`，用户还要再点一次「启动」。

**根因**：`Collection.vue` 的 `onPublishVideo(pipelineId)` 是「跳页型」实现：

```js
function onPublishVideo (pipelineId) {
  showPublishModal.value = false
  if (!genreDraftId) return
  router.push({ path: '/create', query: { draft: genreDraftId, pipeline: pipelineId || 'story2video-compose' } })
}
```

「去发布 → 视频创作」在采集页被设计成「跳到视频创作页自己点启动」，而不是「就地启动」。

### 2.3 缺陷 ③：二次改写带旧文案（stale `genreDraftId`）

**现象**：二次改写后带进视频创作的是第一次改写的文案。

**根因**：`genreDraftId`（本页「已存草稿 id」）是**模块级 `let`**，在改写结果变化时
**从不被作废**：

- `clearRewriteResult()` 只清 `rewriteResult` 与 `collectRewriteLineageId`；
- `rewriteCollected()` / `collectAndRewrite()` 成功分支只写 `rewriteResult.value`；
- `goPublishAfterRewrite()` 见到 `genreDraftId` 非空就**跳过重存**：

```js
if (!genreDraftId) { await saveDraftAfterRewrite() }   // ← 旧 id 非空 ⇒ 不重存
```

⇒ 草稿箱里躺着的是**第一次**改写时存的那份草稿，视频创作拿到的就是它。

**对照**：改写页（`RewriteView.vue`）**早就有**这个防护——`invalidateSavedDraft()`
在改写结果变化时置空 `savedDraftId`（注释写明「新改写结果产生：旧草稿（如有）内容已过期，
置空 id 让发布/视频创作按当前文案重存」）。**采集页漏了同一条**。

---

## 3. 功能需求

### F1 字数区间契约修正（采集页）

**F1.1 传参键名**

- 采集页 `aiRewrite` 的 `userSettings` 必须携带 **`wordCountRange: { min, max }`**；
- **移除** `targetWordCount`（那是 Python 聚合层的死字段，引擎不认，留着只会误导后来人）；
- 保留 `targetLength`（引擎 prompt 变量 `{targetLength}` 的来源；`imitate` 模式下不进模式
  指令，但策略模板可能引用它，删掉会改变 prompt 形状）；
- `knowledgeOptions` 原样透传。

**F1.2 区间归一（新增纯函数模块 `features/collection/rewrite-word-count.js`）**

单一真源，唯一实现。规则：

| 输入 | 归一后 | 理由 |
|---|---|---|
| min = `0`（数字或字符串 `"0"`） | `0` | 「下限不设限」是合法语义，**不得**被 `\|\|` 吞成 800 |
| min / max = `''` / `null` / `undefined` | min→800，max→2000 | 「未填」≠「填了 0」，两者必须可区分 |
| min / max 非整数、非数字 | min→800，max→2000 | 不把 `NaN` 送进引擎（引擎会整段丢弃区间 ⇒ 回落到 3000 兜底） |
| min < 0 | 800 | 负数非法 |
| max < 1 | 2000 | 引擎合法域要求 `max >= 1` |
| max < min（两者都合法） | `max = min` | 引擎要求 `max >= min`，否则**整段区间被丢弃** |
| min > 49999 / max > 50000 | 夹到 49999 / 50000 | 引擎合法域上界（`rewrite-engine-limits.js`） |

**F1.3 截断可见化**

采集页此前把引擎返回的三个可见字段收进 `meta` 却**没人读**，用户只看到「像是没有结束」。
本次全部显示：

| 引擎信号 | 含义 | 采集页展示 |
|---|---|---|
| `outputTruncated` + `outputLength` | 引擎按**字数区间上限**砍尾 | 横幅「改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字）…」（复用 `rewritePage.outputTruncated`） |
| `modelTruncated` + `truncatedSegments` | 模型自身生成上限截断（`finish_reason=length\|max_tokens`） | 分两档：全部被截 → `rewritePage.outputTruncatedByModel`；部分段被截 → `rewritePage.outputTruncatedByModelSegments`（点名段号） |
| `segmented.enabled` + `segmented.segmentCount` | 分段改写（>50000 字输入） | `rewritePage.segmentedMeta`「分段改写 ×{count}」 |

> 两条截断**必须分型**：上面那条建议「调大字数上限」对模型侧上限无效，混成一条会让用户
> 调完字数还是不够，第二次更困惑。

**F1.4 复位规则**

- 每轮**新改写开始**（`rewriteViaEngine` 入口）⇒ 复位上一次的三个横幅
  （否则用户把「上次被截断」读成「这次也被截断」）；
- 改写**失败**时横幅保持空（失败有自己的错误位，不叠加）。

### F2 「视频创作」就地执行 + 进度浮层

**F2.1 交互契约**

点「视频创作」后：

1. 发布操作浮层（发布图文 / 视频创作）**立即消失**；
2. **不跳转**任何页面；
3. 弹出**视频创作流水线的执行进度状态浮层**（与视频创作页、热门选题一键成片**同款**：
   `UiModal variant="progress"` + `StageProgress` + 四按钮契约）；
4. 浮层内就地启动流水线，输入是**当前这次改写结果**。

**F2.2 编排状态机（新增 `composables/useCollectionVideoCreation.js`）**

| 相位 | 含义 | 浮层表现 |
|---|---|---|
| `idle` | 未开始 | 浮层关闭 |
| `starting` | 正在组装参数并请求启动 | 进度 0%，阶段全 pending，第一个阶段 running |
| `running` | 流水线已启动（有 runId） | 阶段进度实时更新 + 总百分比 + 已用时长 |
| `completed` | 成功且取到成片 | 【查看视频】【去发布】解锁 |
| `failed` | 启动失败 / 流水线失败 / 成片缺失 | 错误文案 + 【重试】 |
| `cancelled` | 用户取消 | 取消文案 + 【关闭】 |

**F2.3 阶段列表**

- 阶段名来自流水线 Registry（`i18n/pipeline-labels`），与视频创作页、热门选题**同一真源**；
- **不含** `rewrite_copy`（改写阶段）——采集页的改写**已经完成**，再列一个「改写」阶段是假的；
- 流水线 Registry 缺失时回退 S2V 阶段名（仅展示兜底；启动侧仍 fail-closed）。

**F2.4 文案裁切披露**

视频创作流水线的文案上限取 `story-text-limit.js` 的**内置默认**（10000 码点；
运营中心可下发 `storyTextLimit` 覆盖，但采集页不订阅运营中心运行时块）。

- 超过上限 ⇒ 按**码点**裁切（不切 UTF-16，避免劈碎 emoji 代理对）；
- 裁切发生时**必须显示**横幅：「文案共 {length} 字，超过视频创作上限 {max} 字，已截取前 {max} 字用于生成。」
  —— 否则用户以为视频用的是完整文案。

**F2.5 出口按钮（与「热门选题一键成片」同源）**

| 按钮 | 可用条件 | 行为 |
|---|---|---|
| 查看视频 | `completed` 且已取得成片 | 跳 `/create?view=history&filter=completed` |
| 去发布 | 同上 | 组装 `/publish` query（标题走既有降级链），跳发布页 |
| 重试 | `failed` | 从**流水线启动**开始重试（文案还在手上，不重新改写） |
| 取消生成 | `starting` / `running` | 已启动 ⇒ 调 `pipelineCancelRun`；未启动 ⇒ 只收前端态 |
| 关闭 | 终态 | 复位并关闭 |

### F3 改写结果变化 ⇒ 已存草稿作废

**F3.1 不变量**

> **改写结果一变，已存草稿 id 立刻作废。**

- `watch(rewriteResult, …, { flush: 'sync' })`：`flush: 'sync'` 是为了不留「改写 → 点去发布」
  之间的竞态窗口；
- 作废后 `goPublishAfterRewrite()` 会用**当前** `rewriteResult` 重存草稿 ⇒
  发布图文路径拿到的也是最新文案。

**F3.2 归因链的例外**

归因链 id（`rewrite_history` 行 id）**只在用户手改正文时**才作废：

- 程序赋值（新一轮改写）⇒ 归因链 id 刚由 `rewriteViaEngine` 写入，与新正文是一对，**不得自清**；
- 用户手改正文（textarea `v-model`）⇒ 界面上那份正文已经不是 `rewrite_history` 行里存的
  那条改写了，继续带旧 id 进 payload 就是**假归因**（比没关联更糟）。

区分手段：记录「最近一次程序赋值的正文」，与当前值比对——比引入一个易漏置位的布尔标志更不易漂移。

---

## 4. 数据校验

### 4.1 字数区间（采集页输入 → 引擎契约）

| 校验项 | 规则 | 失败时 | 提示（zh） | 提示（en） |
|---|---|---|---|---|
| min 非法 | 非整数 / <0 / >49999 | 归一为 800（**0 合法**，保留） | 最小字数需为 0-49999 的整数 | Min must be an integer between 0 and 49999 |
| max 非法 | 非整数 / <1 / >50000 | 归一为 2000 | 最大字数需为 1-50000 的整数 | Max must be an integer between 1 and 50000 |
| max < min | 跨字段 | 归一为 `max = min` | 最大字数不能小于最小字数 | Max cannot be less than min |
| 入口拦截 | 区间非法时 | 改写按钮 disabled + 入口早退 | 请先修正字数设置 | Fix word count settings first |

> 校验分两层：**UI 层**（`useWordCountValidation`，实时红字 + 按钮禁用）与
> **契约层**（`resolveRewriteWordCountRange`，保证送进引擎的区间恒落在引擎合法域内）。
> 契约层是本次新增的——UI 层挡不住「程序化调用」（批量采集、剪贴板导入等路径）。

### 4.2 视频创作输入

| 校验项 | 规则 | 失败时 |
|---|---|---|
| 文案为空 | `rewriteResult` trim 后为空 | 不启动流水线，warning「当前没有可用的改写文案…」 |
| 文案超上限 | 码点数 > 10000（内置默认） | 裁切 + 横幅披露；**不阻断** |
| 流水线名非法 | 不在可执行集合 | 拒绝启动（第二道防线，UI 已禁用） |
| 启动返回无 runId | `code !== 0` 或 `runId` 空 | 判失败，阶段标 failed，浮层留在失败态 |

### 4.3 草稿指纹幂等（既有）

`draftSave` 按**内容指纹**去重（`services/draft-fingerprint.js`）：
内容不同 ⇒ 新草稿；内容相同 ⇒ 复用原 id 原地更新。
⇒ 二次改写（内容不同）天然产生**新草稿**，旧草稿留在草稿箱里（既有行为，不在本刀范围）。

---

## 5. 交互流程

### 5.1 字数区间生效（改写）

```
用户填 min=0, max=6000
  → resolveRewriteWordCountRange(0, 6000) ⇒ { min: 0, max: 6000 }      ← 0 不再被吞
  → buildRewriteUserSettings({ tone, range, … })
      ⇒ userSettings.wordCountRange = { min: 0, max: 6000 }              ← 引擎契约键
      ⇒ userSettings.targetWordCount 不存在                              ← 死字段移除
  → aiRewrite(params) → IPC ai:rewrite → rewriteEngineService.rewrite
  → 引擎 _getWordCountInstruction：注入「【字数要求】…0 到 6000 字之间」   ← 引擎侧生效
  → 引擎 _postProcess：上限取 wordCountRange.max = 6000（不再回落 3000）  ← 引擎侧生效
  → 主进程 max_tokens：按 6000 推导（不再按兜底 3000）                    ← 连带修复
  → 采集页消费 meta：
       outputTruncated ⇒ 横幅「已按字数上限截断：实际输出 {length} 字（上限 {max} 字）」
       modelTruncated  ⇒ 横幅「模型输出达到单次生成上限而截断…」
       segmented       ⇒ 「分段改写 ×{count}」
```

### 5.2 「去发布 → 视频创作」（就地执行）

```
用户点「去发布」
  → goPublishAfterRewrite()：
       genreDraftId 为空（改写后已作废）⇒ saveDraftAfterRewrite() 用当前 rewriteResult 重存草稿
       ⇒ showPublishModal = true（发布操作浮层出现：发布图文 / 视频创作）
用户点「视频创作」
  → onPublishVideo(pipelineId)：
       ① showPublishModal = false                        ← 发布浮层消失
       ② text = rewriteResult.trim()；为空 ⇒ warning 提示并返回（不启动）
       ③ startVideoCreation({ text, pipelineName, title })
            → videoModalOpen = true                      ← 进度浮层弹出（先于请求返回）
            → 阶段列表 = 流水线 Registry 阶段（无 rewrite_copy）
            → 读取 story2video.lastOptions.v1 快照
            → 裁切文案（超上限 ⇒ 披露横幅）
            → pipelineStartOrchestrated(pipelineName, params)
            → 成功：runId 落位、进入 running、启动跟踪层（推送 + 3s 轮询）
            → 失败：第一个阶段标 failed、浮层留在失败态、给出错误文案
  → 全程不调用 router.push（不跳视频创作页）
```

### 5.3 二次改写的文案流

```
一键改写 ⇒ R1（rewriteResult = R1，genreDraftId = null）
用户点「AI 改写」⇒ R2
  → applyRewriteResult：lastProgrammaticRewrite = R2；rewriteResult = R2
  → watch(rewriteResult, sync)：R2 === lastProgrammaticRewrite ⇒ 归因链保留；genreDraftId 作废（本来就 null）
用户点「去发布」
  → saveDraftAfterRewrite()：草稿内容 = R2（**不是 R1**）
用户点「视频创作」
  → startVideoCreation({ text: R2 }) ⇒ 流水线输入 = R2（**不是 R1**）
```

### 5.4 用户手改正文

```
用户在「改写内容」文本框里手改 ⇒ rewriteResult 变化
  → watch(sync)：内容 !== lastProgrammaticRewrite ⇒ 归因链 id 作废（防假归因）
  → genreDraftId 作废 ⇒ 下次「去发布」按手改后的内容重存草稿
```

---

## 6. 显示项与提示文字

### 6.1 采集页（新增/改动）

| 位置 | i18n key | zh | en |
|---|---|---|---|
| 字数区间错误（min） | `collection.wordCountMinInvalid` | 最小字数需为 0-49999 的整数 | Min must be an integer between 0 and 49999 |
| 字数区间错误（max） | `collection.wordCountMaxInvalid` | 最大字数需为 1-50000 的整数 | Max must be an integer between 1 and 50000 |
| 引擎砍尾横幅 | `rewritePage.outputTruncated` | 改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字），原文后半部分未包含在结果中。如需完整改写，请调大「字数控制」上限。 | （既有，本页复用） |
| 模型侧截断横幅（整篇） | `rewritePage.outputTruncatedByModel` | 模型输出达到单次生成上限而截断：实际输出 {length} 字。… | （既有，本页复用） |
| 模型侧截断横幅（部分段） | `rewritePage.outputTruncatedByModelSegments` | 第 {segments} 段因模型单次生成上限被截断（合并后共 {length} 字）。… | （既有，本页复用） |
| 分段改写元信息 | `rewritePage.segmentedMeta` | 分段改写 ×{count} | （既有，本页复用） |

### 6.2 视频创作进度浮层（新增命名空间 `collection.videoCreate.*`）

| 位置 | key | zh | en |
|---|---|---|---|
| 浮层标题 | `collection.videoCreate.title` | 视频创作 | Video creation |
| 流水线行 | `collection.videoCreate.pipelineLabel` | 流水线：{pipeline} | Pipeline: {pipeline} |
| 启动中摘要 | `collection.videoCreate.starting` | 正在启动视频创作… | Starting video creation… |
| 文案裁切横幅 | `collection.videoCreate.textTruncated` | 文案共 {length} 字，超过视频创作上限 {max} 字，已截取前 {max} 字用于生成。如需完整文案，请调小改写字数上限或缩短原文。 | The copy is {length} characters, over the {max}-character limit for video creation. The first {max} characters are used. … |
| 空文案提示 | `collection.videoCreate.noContent` | 当前没有可用的改写文案，无法开始视频创作。请先完成一次 AI 改写。 | There is no rewritten copy to work with, so video creation cannot start. Run an AI rewrite first. |
| 失败提示 | `collection.videoCreate.pipelineFailed` | 视频创作失败，请重试；若持续失败请查看应用日志。 | Video creation failed. Please retry; if it keeps failing, check the app logs. |
| 取消提示 | `collection.videoCreate.cancelled` | 视频创作已取消。 | Video creation was cancelled. |
| 按钮：查看视频 | `collection.videoCreate.view` | 查看视频 | View video |
| 按钮：去发布 | `collection.videoCreate.publish` | 去发布 | Publish |
| 按钮：重试 | `collection.videoCreate.retry` | 重试 | Retry |
| 按钮：取消生成 | `collection.videoCreate.cancel` | 取消生成 | Cancel generation |
| 按钮：关闭 | `collection.videoCreate.close` | 关闭 | Close |

### 6.3 浮层显示项

| 显示项 | 数据源 | 规则 |
|---|---|---|
| 总进度百分比 | 已完成阶段数 / 总阶段数 + 流水线 run progress | 0-100；未完成时封顶 99 |
| 阶段列表 | 流水线 Registry 阶段名 + 运行时状态 | 状态 ∈ pending / running / completed / failed / cancelled |
| 已用时长 | 编排开始时刻 → 当前 | 1s tick 驱动；终态后停止 |
| 当前流水线 | `pipeline-labels` Registry 显示名 | 未选择时为空串（不渲染该行） |
| 错误文案 | 失败/取消态 | 浮层底部左侧，与按钮同行 |
| 文案裁切横幅 | 裁切发生时 | 浮层内容区顶部，橙色警示 |

---

## 7. 技术实现要点

| 文件 | 变更 | 理由 |
|---|---|---|
| `apps/desktop/src/features/collection/rewrite-word-count.js` | **新增**：区间归一 + `userSettings` 构造 + `targetLength` 三档 | 单一真源；纯函数可单测 |
| `apps/desktop/src/features/collection/rewrite-word-count.test.js` | **新增** 14 例 | 区间归一与键名契约的回归锁 |
| `apps/desktop/src/composables/useCollectionVideoCreation.js` | **新增**：就地编排状态机 + 文案裁切 | 复用热门选题的阶段跟踪/启动参数/run 跟踪层 |
| `apps/desktop/src/composables/useCollectionVideoCreation.test.js` | **新增** 10 例 | 编排层回归锁 |
| `apps/desktop/src/features/collection/CollectionVideoProgressModal.vue` | **新增**：纯受控进度浮层 | 与视频创作页/热门选题同款 |
| `apps/desktop/src/views/Collection.vue` | 改：`rewriteViaEngine` 传参；新增截断三态消费；`watch(rewriteResult)` 作废已存草稿；`onPublishVideo` 改就地执行 | 三个缺陷的落点 |
| `apps/desktop/src/views/Collection.rewrite-publish-flow.test.js` | **新增** 9 例 | 组件级回归锁 |
| `apps/desktop/src/views/Collection.rewrite-input-limit.test.js` | 改：meta 形状断言（新增 2 字段） | 契约扩展的同步 |
| `apps/desktop/src/locales/collection/{zh,en}.js` | 改：字数上限文案修正 + 新增 `videoCreate` 命名空间 | 显示项与提示文字 |
| `apps/desktop/src/locales/collection/quick-collect/{zh,en}.js` | **新增**（从 collection/{zh,en}.js 拆出） | 逐文件行数门禁（500 行硬限）对 locale 同样生效，collection/{zh,en}.js 已 498 行 |

**复用而非重写**：视频创作编排复用了热门选题一键成片的
`gen-video-stage-tracking.js` / `gen-video-view-model.js` / `gen-video-pipelines.js` /
`useGenVideoRunTracking.js` / `run-context-video-path.js` / `useGenVideoPublishTitle.js`
——**没有**为采集页写第二份阶段跟踪或第二份发布出口。

---

## 8. 测试

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `features/collection/rewrite-word-count.test.js` | 14 | min=0 保留、非法值回落、max<min 收敛、越界夹取、键名为 `wordCountRange`、三档 `targetLength` |
| `composables/useCollectionVideoCreation.test.js` | 10 | 输入即当前文案、浮层先于请求打开、阶段无 `rewrite_copy`、启动失败留失败态、空文案拒启、裁切披露、取消走 `pipelineCancelRun`、码点裁切不劈 emoji |
| `views/Collection.rewrite-publish-flow.test.js` | 9 | 0-6000 原样送达、旧键消失、min=0 不被吞、三条截断横幅、未截断不显示、二次改写带最新文案、不跳 `/create`、浮层有阶段、无文案不启动 |

**既有回归**：`vitest run src/views/Collection* src/features/collection src/composables/useCollection* src/locales`
⇒ **31 文件 / 473 用例全绿**。

---

## 9. 验收标准

- [x] 采集页把字数区间设成 0-6000，引擎收到的 `wordCountRange` 恰为 `{min:0, max:6000}`；
- [x] `userSettings` 中不再出现 `targetWordCount`；
- [x] min 填 0 时送进引擎的仍是 0（不被吞成 800）；
- [x] 引擎砍尾 / 模型侧截断 / 分段改写三个信号在采集页**各自可见**；
- [x] 二次改写后「去发布 → 视频创作」带进流水线的是**第二次**的文案；
- [x] 点「视频创作」后发布浮层消失、**不跳转**、进度浮层弹出；
- [x] 进度浮层展示流水线阶段（非空壳）；
- [x] 文案超流水线上限时裁切并如实披露；
- [x] zh/en locale 成对（`check-locale-sync --keys` PASS）；
- [x] 逐文件行数门禁 PASS（locale 同受约束，已按范式拆分）；
- [x] 采集页相关测试全集全绿（473 例）。

---

## 10. 未闭合 / 遗留

1. **端到端真机复核未执行**：本刀只做了组件级与纯函数级验证，**未在真机上跑一遍
   「0-6000 改写 → 看实际字数」**。判据 = 实际输出字数应落在 [0, 6000] 且不再出现
   句子戛然而止。需用户侧复核。
2. **视频创作浮层未做视觉回归（QM-4）**：浮层复用 `UiModal variant="progress"` +
   `StageProgress`（与视频创作页/热门选题同款），但采集页是**新入口**，像素基线未覆盖。
3. **运营中心 `storyTextLimit` 未接线**：采集页用内置默认上限（10000 码点），
   若运营中心把上限调高，采集页仍按 10000 裁切（会少用一段文案）。
   本刀按「不订阅运营中心运行时块」处理，已如实记录。
4. **Python 聚合层的 `target_word_count` 契约保留**：采集页不再使用，但该链路仍在
   （旧客户端兼容）。两套契约并存是历史包袱，本次只保证采集页不再误用。
5. **`genreDraftId` 仍是模块级 `let`**：本次用 `watch(rewriteResult, sync)` 保证作废，
   但它不是响应式的（视图不读它，只有 `goPublishAfterRewrite` / `onPublishArticle` 读）。
   若将来有第二个消费点，应改为 `ref`。
