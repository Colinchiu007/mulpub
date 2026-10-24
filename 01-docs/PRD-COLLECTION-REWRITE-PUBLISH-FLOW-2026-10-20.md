# PRD：采集页「AI 改写 → 去发布 → 视频创作」链路修复（2026-10-20）

> change：`fix-collection-rewrite-publish-flow`
> 分支：`fix-collection-rewrite-publish-flow`
> 执行记录：`openspec/records/fix-collection-rewrite-publish-flow.md`
>
> ## ⚠️ 与 #4111（`collect-rewrite-wordcount`）的关系（2026-10-21 补记，如实说明）
>
> 用户报障里**第一条**（字数区间不生效 + 截断不可见）在**另一个会话**的 PR **#4111**
> （`01-docs/PRD-COLLECTION-REWRITE-WORD-COUNT-2026-10-20.md`、
> 执行记录 `openspec/records/collect-rewrite-wordcount.md`）里已经落地到 main，
> 且**比本刀最初的方案更深**：
>
> - 它同样定位到「采集页传 `targetWordCount`、引擎只认 `wordCountRange`」这一根因，
>   并把区间归一放进**共享的** `useWordCountValidation`（`range` computed），
>   渲染层不再有第二份实现；
> - 它额外发现了本刀最初**没看到**的一层：`min=0` 时引擎注入的指令是
>   「长度必须控制在 **0** 到 6000 字之间」⇒ **模型把它读成「可以任意短」**
>   （实测 3515 字原文 + 区间 0-6000 ⇒ 输出 1229 字摘要），于是它改了
>   **引擎侧**的指令形态（`packages/rewrite-engine/src/word-count-instruction.js`：
>   `min=0` 走「不得超过 {max} 字 + 目标篇幅约 {target} 字 + 不得压缩成摘要」），
>   并加了「改写后 N 字（原文 M 字）」与两类截断横幅。
>
> ⇒ **本 PR 与 #4111 的关系**：本刀最初也独立定位到了同一根因并实现了同方向的修法，
> 但在合并 main 时发现 #4111 **已先行落地且更完整**，于是**主动撤回**了本刀在
> 字数区间的重复实现（删除本 PR 自带的 `features/collection/rewrite-word-count.js`
> 及其测试），**只保留 #4111 没有覆盖的部分**：
>
> | 报障 | 归属 | 本 PR 状态 |
> |---|---|---|
> | ① 字数区间不生效 / 截断不可见 | **#4111**（已入 main） | 本 PR **撤回**重复实现，只保留「消费者清单」这一迁移判据的文档化（§2.4） |
> | ② 「视频创作」跳页而非就地出进度浮层 | **本 PR** | 保留（§3.2 / §5.2 / §6.2） |
> | ③ 二次改写带的是第一次的旧文案 | **本 PR** | 保留（§3.3 / §4 / §5.3） |
> | ④（评审派生）改写信封缺类型守卫 | **本 PR** | 保留（§3.4） |
> | ⑤（合并 main 后新增）弹窗里选中的**配置档案**被就地执行吞掉 | **本 PR** | 保留并补齐（F4）——主干 `publish-config-picker` 的功能不因本刀改成就地执行而丢失 |
>
> 本文档其余部分描述**本 PR 实际交付**的行为；凡涉及字数区间的部分，
> 以 #4111 的 PRD 与实现为准（本文只保留迁移影响面的判据说明）。
>
> ### ⑤ 合并 main 时 `onPublishVideo` 的冲突处置（2026-10-21）
>
> 本分支的基线早于主干的 `publish-config-picker`，两边**同时**改了 `onPublishVideo`：
>
> | 侧 | 实现 | 归属 |
> |---|---|---|
> | 本分支 | 就地启动流水线 + 进度浮层（不跳页） | 用户报障②③ 的正解 ⇒ **保留** |
> | 主干 | 跳 `/create` 并把 `configProfileId` 放进 query | 「配置档案」功能 ⇒ **不能丢** |
>
> ⇒ 处置：**保留本分支的交互形态**，并把主干的 `configProfileId` 兑现进就地执行
> （采集页自己读配置档案、自己套用）。判据与失败分支见 §3 F4。
> **不采用**「就地执行但忽略配置档案」——那正是主干在热门选题页修过的
> 「选了等于没选」。

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

### 2.4 契约迁移说明（键名变更的影响面与向后兼容判定）

**这一变更由 #4111 落地**（本刀在合并 main 时已撤回自己的重复实现，见文首的关系说明）。
它**只发生在「渲染层 → 桌面改写引擎」这一条 IPC 契约上**，但涉及两个不同的「字数契约」，
必须分清，否则会误判影响面：

| 契约 | 拥有者 | 字段名 | 本次是否受影响 |
|---|---|---|---|
| 渲染层 → 桌面改写引擎（`ai:rewrite`） | `packages/rewrite-engine`（`rewrite-engine-core.js` 的 `_getWordCountInstruction` / `_postProcess`） | **`wordCountRange`** | **本次修正的目标**：引擎只认这个键 |
| Python 聚合层改写（`/aggregation/rewrite`） | `packages/python-backend`（`models.py` 的 `RewriteRequest` / `service.py` 的 `RewriteConfig`） | `min_word_count` / `max_word_count` / `target_word_count`（**内部**字段） | **不受影响**：字段与桌面链路无关，且桌面端自 2026-10-18 起不再经该路径改写 |

**为什么 `targetWordCount` 可以直接移除（不需要向后兼容）**：

1. **它从来没有被消费过**：桌面改写引擎读取的是 `userSettings.wordCountRange`
   （`rewrite-engine-core.js` 的 `_getWordCountInstruction` 与 `_postProcess`），
   `targetWordCount` 是 **Python 聚合层的旧契约**，在桌面引擎侧是**死字段** ——
   发过去也只是被忽略（正是缺陷 ① 的成因）。
2. **全仓没有第二个发送方**：除采集页外，渲染层没有第二处构造 `targetWordCount`；
   主进程 `rewrite-engine.js` 读的也是 `wordCountRange.max`。
3. **保留它反而有害**：留着会让后来人以为「引擎认这个键」，从而把同一个缺陷再犯一次；
   本刀专门加了回归锁断言 `userSettings.targetWordCount` **不出现**。
4. **Python 侧是另一套字段名**（下划线 + `min/max` 三元组），本刀**一行没动**它，
   旧客户端走 `/aggregation/rewrite` 的行为完全不变。

> **外部独立复核（QM-6 高危面 datamigration）**：本节结论已由**外部厂商模型 claude**
> 独立核实（自行读代码、不参考本仓既有评审记录），结论为「**不破坏**、不需要向后兼容措施」，
> 依据为引擎真实键名、仓库内 `targetWordCount` 的收发方清单、以及 Python 侧契约与其解耦路径；
> 原文见 PR #4114 的评审评论（公开可点）。

**消费者清单（可自证，逐条给出检索命令与命中位置）**

> 起因：QM-6 深审指出「『死字段』的判定只基于桌面引擎读 `wordCountRange`，未给出
> Python 服务 / 旧客户端 / 移动端调用方的清单 ⇒ 向后兼容未经验证」。
> 下表把该判断做成**任何人可复算**的形式（命令与命中位置逐条给出）。

| 可能的消费者 | 检索命令 | 实际命中 | 结论 |
|---|---|---|---|
| 桌面改写引擎（**唯一**真契约持有者） | `git grep -n "targetWordCount" -- packages/rewrite-engine/` | **0 处** | 引擎**从不读**该键；它只读 `wordCountRange`（`rewrite-engine-core.js` 的 `_getWordCountInstruction` / `_postProcess`、`output-cap.js` 的 `resolveOutputCap`） |
| 渲染层发送方 | `git grep -n "targetWordCount" -- apps/` | 仅**测试断言**（`Collection.rewrite-publish-flow.test.js` / `Collection.rewrite-wordcount.test.js` / `Collection.step-flow.test.js` 三处都断言它**不出现**）与**注释** | 无生产发送方；回归锁钉死「不得下发」 |
| Python 聚合层 | `git grep -n "target_word_count" -- packages/python-backend/` | `multi_publish/aggregation/service.py:296`（**它自己**的内部字段）+ 其自身测试 | **另一套契约**（下划线命名、`min/max` 三元组），桌面端自 2026-10-18 起不再经该路径改写；本 PR 一行没动它 |
| 旧客户端 | 该链路仍在（`/aggregation/rewrite`），但**键名不同**（`min_word_count`/`max_word_count`/`target_word_count`） | 不受桌面端渲染层改动影响 | 旧客户端行为**完全不变** |
| 移动端 | `ls apps/` ⇒ 只有 `desktop` | 本仓**无移动端** | 无此类消费者 |

**保留一个发布周期的替代方案为何不做**：保留 `targetWordCount` 并做映射，代价是
「引擎不消费 ⇒ 保留它只会让人以为引擎认它」——而那**正是缺陷 ① 的成因**
（下一位开发者照着这个残留键写，又会犯同一个错）。本仓的判据是
「**跨进程传参的键名契约只能有一个**」，故选择移除并用**回归锁**替代兼容期。

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

**F2.3.1 浮层组件的导入方式（实现约束，2026-10-24 补）**

- 进度浮层复用视频创作页的 `StageProgress`，但**必须直连具体模块**
  （`@/views/video-creation/StageProgress.vue`），**不得**从桶文件 `@/views/video-creation` 取；
- 理由（可复算）：桶文件同时 re-export `PipelineSelector`，而 `PipelineSelector.vue` 顶部
  `import '@/styles/pipeline-selector.css'` ⇒ 从桶文件取组件会把该样式表注入进**采集页**的模块图，
  位置比创作页的 `create-view.css` 更靠前。两份全局样式表对流水线卡片边框给出**同特异性（0,2,0）**
  的声明（`create-view.css` 的 `.pipeline-card.<category> { border-left: 3px solid var(--pipe-*) }`
  与 `pipeline-selector.css` 的 `.pipeline-card.has-bg { border-color: rgba(255,255,255,0.16) }`），
  **靠加载顺序决胜** ⇒ 顺序一翻转，视频创作页的流水线卡片边框就从「半透明白」变成「分类色」
  （用户可见的观感回归 + 视觉基线门禁判红）；
- 机械锁：`apps/desktop/src/features/collection/collection-css-cascade-order.test.js`（**4 例**）
  —— 采集页模块图不得触及 `pipeline-selector.css`；`features/collection/**` 不得从桶文件取组件
  （**按解析后的真实文件**判定，别名 `@/…` 与相对路径 `../../…` 都命中；**递归**扫子目录）；
  `create-view.css` 必须早于 `pipeline-selector.css`；外加一条**探测器对写法敏感**的合成用例
  （证明断言不是恒真：把导入改回桶形态必须红）。
- **已知局限（如实登记）**：该锁的模块图走法把**动态 import 当即时求值**，与 Vite dev 的**懒求值**
  有差异 ⇒ 前两条断言不依赖全局顺序、结论可靠；第三条（全局顺序兜底）是**近似**而非精确模型。

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

### F4 「去发布」弹窗里选中的**配置档案**就地兑现（2026-10-21 合并 main 后补）

> **动因**：主干 `publish-config-picker`（#4123 前后）给「去发布」弹窗加了**配置档案**选择，
> 采集页原先是**跳转**创作页、由创作页读 `?configProfile=` 套用。本刀把入口改成
> **就地启动流水线**（用户明确要求不跳页）⇒ 用户在弹窗里选中的配置必须由采集页
> **自己兑现**。兑现不了就是主干在热门选题页修过的同一个坑：**选了等于没选**
> （HotTopics 原注释：「修复前这里只带 draft，弹窗里选的流水线被静默丢弃」）。

**F4.1 不变量**

> **用户在「去发布」弹窗里选中的配置档案，必须影响本次生成的启动参数；
> 套不上时必须有一条可见提示。**

**F4.2 兑现方式（快照同构 ⇒ 直接换快照）**

| 环节 | 规则 |
|---|---|
| 快照来源 | 编排型配置档案的快照形状是 `{s2vConfig, s2vOutputConfig}`，与 `buildGenVideoStartParams` 消费的键**同构** ⇒ 直接作为 `snapshot` 入参 |
| 未选档案 | 沿用「上次选项」快照（`story2video.lastOptions.v1`）——**既有行为不变** |
| 判据 | **复用**主干纯函数 `resolveConfigProfileTarget`（`features/publish-destination/apply-config-profile-handoff.js`），**不复制**第二份「能不能套用」的规则 |
| 提示文案 | **复用**主干 `create.story2video.configProfile.*` 的既有 locale key，**不另写**一份同义句 |

**F4.3 失败分支（每条一个分支，各有专属提示）**

| 分支 | 判据 | 行为 | 提示（locale key） |
|---|---|---|---|
| 档案不存在 / 已删除 | 列表里查无此 id | 回退「上次选项」，视频照常出 | `create.story2video.configProfile.notFound` |
| 属于别的流水线 | `profile.pipelineId !== 本次流水线` | 同上 | `create.story2video.configProfile.wrongPipeline` |
| 配置库载入失败 | `code !== 0` 或调用抛异常 | 同上（**异常不冒泡**，否则整次生成失败） | `create.story2video.configProfile.handoffLoadFailed` |
| 快照形态不适用 | 快照无 `s2vConfig` / `s2vOutputConfig`（如 legacy 形态） | 同上（硬塞会被启动参数**静默忽略**） | `create.story2video.configProfile.snapshotInvalid` |

> **为什么失败不阻断生成**：用户点的是「生成视频」，不是「套用配置」；视频照常出，
> 但**必须留一条可见提示**——静默回退默认值就是「选了等于没选」。

**F4.4 落点**

- 纯判据与 IO：`features/collection/collection-video-config-profile.js`（可脱离 Vue 单测）；
- 编排层只做依赖注入（`useCollectionVideoCreation.js` 传 `listConfigProfiles` / `readLastOptions`），
  **编排层不直接知道「配置档案」这回事**；
- 提示显示在进度浮层内容区顶部（与文案裁切横幅同款橙色警示）。

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
| 配置档案 id 为空 | 未选档案 | 沿用「上次选项」快照，**不是**失败 |
| 配置档案 id 查无此条 | 列表里没有 | 回退「上次选项」+ 可见提示（`notFound`） |
| 配置档案属于别的流水线 | `profile.pipelineId !== 本次流水线` | 回退 + 可见提示（`wrongPipeline`） |
| 配置档案快照形态不适用 | 快照无 `s2vConfig` / `s2vOutputConfig` | 回退 + 可见提示（`snapshotInvalid`） |
| 配置库载入失败 | `code !== 0` / 调用抛异常 | 回退 + 可见提示（`handoffLoadFailed`），异常**不冒泡** |

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

### 5.5 配置档案就地兑现

```
用户在「去发布」弹窗里选流水线 + 配置档案 ⇒ 点「视频创作」
  → 发布浮层消失
  → startVideoCreation({ text, pipelineName, title, configProfileId })
  → 解析启动快照：
       选了档案 ⇒ 读配置列表 → resolveConfigProfileTarget 判可套用
                    ⇒ 用档案快照（s2vConfig / s2vOutputConfig）
       套不上   ⇒ 回退「上次选项」快照 + 浮层顶部显示可见提示
  → 启动流水线（全程不调用 router.push）
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

> **配置档案提示**（F4）不新增 locale key：**复用**主干 `create.story2video.configProfile.*`
> 的既有文案，让「同一个失败在创作页与采集页说的是同一句话」。
>
> | 分支 | locale key | zh | en |
> |---|---|---|---|
> | 档案不存在/已删除 | `create.story2video.configProfile.notFound` | 所选配置不存在或已被删除，已按流水线默认参数继续 | The selected configuration no longer exists. Continuing with the pipeline defaults. |
> | 属于别的流水线 | `create.story2video.configProfile.wrongPipeline` | 该配置属于其他流水线，无法在当前流水线应用 | This configuration belongs to another pipeline and cannot be applied here. |
> | 配置库载入失败 | `create.story2video.configProfile.handoffLoadFailed` | 未能载入配置列表，无法套用所选配置，已按流水线默认参数继续 | Could not load the configuration list, so the selected configuration was not applied. Continuing with the pipeline defaults. |
> | 快照形态不适用 | `create.story2video.configProfile.snapshotInvalid` | 配置快照无效，请重新尝试保存 | The configuration snapshot is invalid. Please try saving again. |

### 6.3 浮层显示项

| 显示项 | 数据源 | 规则 |
|---|---|---|
| 总进度百分比 | 已完成阶段数 / 总阶段数 + 流水线 run progress | 0-100；未完成时封顶 99 |
| 阶段列表 | 流水线 Registry 阶段名 + 运行时状态 | 状态 ∈ pending / running / completed / failed / cancelled |
| 已用时长 | 编排开始时刻 → 当前 | 1s tick 驱动；终态后停止 |
| 当前流水线 | `pipeline-labels` Registry 显示名 | 未选择时为空串（不渲染该行） |
| 错误文案 | 失败/取消态 | 浮层底部左侧，与按钮同行 |
| 文案裁切横幅 | 裁切发生时 | 浮层内容区顶部，橙色警示 |
| 配置档案提示横幅 | 档案套用失败时 | 浮层内容区顶部，橙色警示（与裁切横幅同款）；可套用时**不渲染** |

---

## 7. 技术实现要点

| 文件 | 变更 | 理由 |
|---|---|---|
| `apps/desktop/src/composables/useRewriteResultInvalidation.js` | **新增**：改写结果变化时的「已存草稿 / 归因链」作废契约 | 判据单一实现、可脱离视图单测；程序赋值与用户手改两条路径各有独立用例 |
| `apps/desktop/src/composables/useRewriteResultInvalidation.test.js` | **新增** 6 例 | 含两条**交错边界**用例（程序赋值后立即手改 ⇒ 归因链被清、不假挂） |
| `apps/desktop/src/composables/useCollectionVideoCreation.js` | **新增**：就地编排状态机 + 文案裁切 | 复用热门选题的阶段跟踪/启动参数/run 跟踪层 |
| `apps/desktop/src/composables/useCollectionVideoCreation.test.js` | **新增** 16 例 | 编排层回归锁 + 6 条**外部依赖契约锁**（被复用模块的导出名与类型） |
| `apps/desktop/src/features/collection/CollectionVideoProgressModal.vue` | **新增**：纯受控进度浮层 | 与视频创作页/热门选题同款 |
| `apps/desktop/src/views/Collection.vue` | 改：`applyRewriteResult` 统一落地（**含非字符串信封的类型守卫**）；接上作废 composable；`genreDraftId` 改 `ref`；`onPublishVideo` 改就地执行 | 本 PR 三个缺陷 + 一条评审派生项的落点 |
| `apps/desktop/src/views/Collection.rewrite-publish-flow.test.js` | **新增** 11 例 | 组件级回归锁 |
| `apps/desktop/src/locales/collection/{zh,en}.js` | 改：新增 `videoCreate` 命名空间 | 显示项与提示文字 |
| `apps/desktop/src/locales/collection/quick-collect/{zh,en}.js` | **新增**（从 collection/{zh,en}.js 拆出） | 逐文件行数门禁（500 行硬限）对 locale 同样生效，collection/{zh,en}.js 当时已 498 行 |
| `apps/desktop/src/features/collection/collection-video-config-profile.js` | **新增**（2026-10-21）：配置档案解析（纯判据 + IO 注入） | 判据复用主干 `resolveConfigProfileTarget`；**不**复制第二份「能不能套用」规则；IO 以函数入参注入 ⇒ 可脱离 Vue 单测 |
| `apps/desktop/src/features/collection/collection-video-config-profile.test.js` | **新增** 10 例 | 4 个失败分支各自专属提示 + 载入失败/异常不冒泡 + 未选档案不读配置库 |
| `apps/desktop/src/composables/useCollectionVideoCreation.js` | 改：接 `configProfileId`；新增 `videoConfigProfileWarning` | 编排层只做依赖注入，不直接知道「配置档案」这回事（判据在 features 模块里） |
| `apps/desktop/src/composables/useCollectionVideoCreation.contract.test.js` | 改：依赖导出清单 +1（`story2videoConfigProfileList`） | 依赖契约锁：改名/删除即红，不推迟到用户点「视频创作」时才炸 |
| `apps/desktop/src/features/collection/CollectionVideoProgressModal.vue` | 改：新增 `configWarning` 横幅 | 「选了等于没选」必须有可见出口 |

> **已撤回的重复实现**：本刀最初也自带 `features/collection/rewrite-word-count.js`（区间归一纯函数）
> 与 14 例回归锁；合并 main 时发现 #4111 已把区间归一放进共享的 `useWordCountValidation`
> （`range` computed）且实现更完整 ⇒ 本 PR **删除**自己的重复实现，只保留「消费者清单」
> 这一迁移判据的文档化（§2.4）。**不保留两份同义实现**是本仓的一贯纪律。

**复用而非重写**：视频创作编排复用了热门选题一键成片的
`gen-video-stage-tracking.js` / `gen-video-view-model.js` / `gen-video-pipelines.js` /
`useGenVideoRunTracking.js` / `run-context-video-path.js` / `useGenVideoPublishTitle.js`
——**没有**为采集页写第二份阶段跟踪或第二份发布出口。

---

## 8. 测试

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `composables/useRewriteResultInvalidation.test.js` | 6 | 程序赋值（草稿作废、归因链**保留**）/ 用户手改（两者都作废）/ 清空 / **两条交错边界** |
| `composables/useCollectionVideoCreation.test.js` | 16 | 输入即当前文案、浮层先于请求打开、阶段无 `rewrite_copy`、启动失败留失败态、空文案拒启、裁切披露、取消走 `pipelineCancelRun`、码点裁切不劈 emoji + **6 条外部依赖契约锁** |
| `views/Collection.rewrite-publish-flow.test.js` | 11 + 2 | 0-6000 原样送达、旧键消失、min=0 不被吞、引擎砍尾横幅、模型侧截断横幅、二次改写带最新文案、**去发布重存的草稿是最新文案**、不跳 `/create`、浮层有阶段、无文案不启动、非字符串信封判失败 + **配置档案兑现 / 套不上时可见提示** |
| `features/collection/collection-video-config-profile.test.js` | 10 | 四个失败分支各自专属提示 + 载入失败/异常不冒泡 + 未选档案不读配置库 + 未选档案沿用「上次选项」 |
| `composables/useCollectionVideoCreation.test.js` | 16 + 3 | 上表 16 例 + **配置档案进启动参数 / 套不上仍有可见提示 / 未选档案不读配置库** |

**既有回归**：`vitest run src/views/Collection* src/features/collection src/composables/useCollection* src/locales`
⇒ **33 文件 / 509 用例全绿**（含 #4111 带入的 `Collection.rewrite-wordcount.test.js`）。

---

## 9. 验收标准

- [x] **（#4111 已交付）** 采集页把字数区间设成 0-6000，引擎收到的 `wordCountRange` 恰为 `{min:0, max:6000}`；
- [x] **（#4111 已交付）** `userSettings` 中不再出现 `targetWordCount`；
- [x] **（#4111 已交付）** min 填 0 时送进引擎的仍是 0（不被吞成 800），且引擎对 min=0 改用「不得超上限 + 目标篇幅」形态的指令（不再被模型读成「写摘要」）；
- [x] **（#4111 已交付）** 引擎砍尾 / 模型侧截断在采集页**各自可见**，并显示「改写后 N 字（原文 M 字）」；
- [x] **（本 PR）** 二次改写后「去发布 → 视频创作」带进流水线的是**第二次**的文案；
- [x] **（本 PR）** 「去发布」重存的草稿内容是**最新**那次改写的结果（图文发布路径同样不被旧草稿带偏）；
- [x] **（本 PR）** 点「视频创作」后发布浮层消失、**不跳转**、进度浮层弹出；
- [x] **（本 PR）** 进度浮层展示流水线阶段（非空壳）；
- [x] **（本 PR）** 文案超流水线上限时裁切并如实披露；
- [x] **（本 PR）** 引擎信封的正文不是字符串 ⇒ 判失败（不写正文、不挂归因链、不报成功）；
- [x] **（本 PR，2026-10-21 补）** 「去发布」弹窗里选中的配置档案**影响本次生成的启动参数**（不再被就地执行吞掉）；
- [x] **（本 PR，2026-10-21 补）** 配置档案套不上时视频**照常出**，且浮层里有**可见提示**（不静默回退）；
- [x] zh/en locale 成对（`check-locale-sync --keys` PASS）；
- [x] 逐文件行数门禁 PASS（locale 同受约束，已按范式拆分）；
- [x] 采集页相关测试全集全绿（509 例）。

---

## 10. 未闭合 / 遗留

1. **端到端真机复核未执行**：本刀只做了组件级与纯函数级验证，**未在真机上跑一遍
   「0-6000 改写 → 看实际字数」**。判据 = 实际输出字数应落在 [0, 6000] 且不再出现
   句子戛然而止。需用户侧复核。（该修复由 #4111 交付，本 PR 不重复实现。）
2. **视频创作浮层未做视觉回归（QM-4）**：浮层复用 `UiModal variant="progress"` +
   `StageProgress`（与视频创作页/热门选题同款），但采集页是**新入口**，像素基线未覆盖。
3. **运营中心 `storyTextLimit` 未接线**：采集页用内置默认上限（10000 码点），
   若运营中心把上限调高，采集页仍按 10000 裁切（会少用一段文案）。
   本刀按「不订阅运营中心运行时块」处理，已如实记录。
4. **Python 聚合层的 `target_word_count` 契约保留**：采集页不再使用（#4111 已交付），
   但该链路仍在（旧客户端兼容）。两套契约并存是历史包袱，本 PR 只保证采集页不再误用。
5. ~~**`genreDraftId` 仍是模块级 `let`**~~ —— **已销账**（QM-6 深审 i5 采纳后落地）：改为
   `const genreDraftId = ref(null)`，6 处读写同步改为 `.value`。理由：它是**跨异步边界**的状态
   （存草稿是异步的、内容变化是同步的），裸 `let` 让「读到它」与「写它」之间没有可追踪的时序。
   同时，作废逻辑已抽到 `composables/useRewriteResultInvalidation.js`，程序赋值与用户手改
   **两条路径各有独立行为级用例**（含「快速二次编辑交错」边界）。
6. **QM-6 深审的轮次是在「合并 main 之前」的代码上跑的**：本刀最初也自带字数区间的实现，
   与 #4111 重复；合并时已撤回该部分（见文首）。**仍在最终代码里的**评审结论（i3 类型守卫、
   i5 抽 composable、i7 并发模型文档化）都保持成立；**已被 #4111 取代**的那部分结论
   （键名契约、截断可见化）以 #4111 的实现与记录为准。
7. **未做「视频创作」的真机端到端**：浮层与流水线的对接只在组件级与 composable 级验证
   （真实 `pipelineStartOrchestrated` 调用被 mock）。判据 = 真机上点「视频创作」后
   浮层出现、阶段进度推进、成片可「查看/去发布」。
