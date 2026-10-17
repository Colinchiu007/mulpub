# PRD — 热门选题「生成视频 → 去发布」标题改为 AI 爆款标题（fix-hot-topics-genvideo-title）

- 状态：待实现（2026-10-17）
- 关联分支：`fix-hot-topics-genvideo-title`
- 关联变更目录：`openspec/changes/fix-hot-topics-genvideo-title/`
- 上游依据：`01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md` §3.10/§3.13/§6.6；`01-docs/PRD-VIDEO-PIPELINE-PROGRESS-MODAL-2026-10-17.md` §4.3

---

## 1. 问题陈述（用户原话）

> 热门选题页，选择某个选题的生成视频，成功后点击「去发布」。进入发布页，带入的标题是正文的前多少字，而不是 AI 按照爆款元素来生成标题。这个需要修复调整。同时提供降级方案，如果没有保存的文字推理模型设置，或 AI 生成没成功，则使用生成视频的原始的选题作为标题。

### 1.1 现场实测形态

1. 用户在热门选题页勾选/点击某条选题的【生成视频】（默认 `story2video-compose`）。
2. 弹窗内完成「改写文案 → 流水线执行 → 成片落盘」，run 进入 `completed`，【去发布】解锁。
3. 点击【去发布】→ 路由 `/publish?type=video&video_path=…&title=…&content=…&tags=…`。
4. 发布页装载后：**标题输入框里是改写正文的前 N 个字符**（实测为前 100 字，百家号标题上限截断后的长度），正文是完整改写文案，标签来自 S2V 配置快照。

### 1.2 为什么这是缺陷

| 维度 | 期望 | 实际 | 影响 |
| --- | --- | --- | --- |
| 标题语义 | 一个**标题**（钩子/悬念/情绪词，符合爆款结构） | 一段**正文切片**（句子中间截断，常以「，」「、」结尾） | 标题不像标题，平台推荐与点击率双输 |
| 标题来源 | AI 按爆款元素生成 | `project.title` 回退到 `sourceText` 后截断 | 用户每次都要手工重写标题，自动化承诺落空 |
| 降级语义 | 明确的降级链（原始选题） | 无降级概念，标题来源是一个静默回退链 | 用户无法预期拿到什么 |

---

## 2. 根因分析（第一性原因，追溯至 commit 层）

### 2.1 链路还原

```
HotTopics.vue [hot-topics-gen-video-publish]
  └─ useHotTopicsGenVideo.publishGenVideoResult()            apps/desktop/src/composables/useHotTopicsGenVideo.js:366
       ├─ project = genVideoCompletedProject.value           ← data.context.story2videoProject
       └─ publishDataToQuery(buildPublishFromProject({ ...project, videoPath }))
            └─ buildPublishFromProject                        apps/desktop/src/features/publish/publish-from-project.js:54
                 rawTitle = publish.title || project.title || sourceText      ← 第 60 行
                 truncateTitle(rawTitle, 100)                                  ← 第 43-47 行
```

### 2.2 三处叠加导致「正文前 100 字」

| # | 位置 | 事实 | 后果 |
| --- | --- | --- | --- |
| 1 | `apps/desktop/src/features/hot-topics/gen-video-pipelines.js:186-201` | `buildGenVideoStartParams` 构造的 `params` **不含 `title`**（只有 `text/inputMode/checkpointPolicy/autoAdvance/background/uiLocale/story2videoTextConfig`） | 主进程 `run.params.title` 为空 |
| 2 | `apps/desktop/src/story2video/s2v-config-snapshot.js:172-179` | `story2videoTextConfig.config.publish.title = config.title \|\| ''`，而 `S2V_CONFIG_DEFAULTS.title = ''`，热门选题链路从不写这个字段 | `publish.title` 为空 |
| 3 | `apps/desktop/electron/services/story2video-project-service.js:1010` | `project.title = safeText(run.params?.title \|\| publish.title \|\| sourceText, 160)` —— 前两者空 ⇒ **落到 `sourceText`**（= 改写全文，上限 100000） | `buildPublishFromProject` 拿到 `project.title` = 改写全文 |
| 4 | `apps/desktop/src/features/publish/publish-from-project.js:43-47` | `truncateTitle(rawTitle, 100)` | 标题 = **正文前 100 字** |

### 2.3 第二形态：run-only / 非 S2V 流水线

- 非 `story2video-compose` 流水线（animated-explainer / documentary-montage / animation / avatar-spokesperson / character-animation / hybrid）**不产出 `story2videoProject`**（见 `openspec/changes/hot-topics-pipeline-picker/proposal.md:48`）。
- 此时 `publishGenVideoResult` 走 run-only 分支：`{ type:'video', video_path }`，**标题为空**。
- 用户看到的是**空标题**——同样不符合预期（期望至少是原始选题）。

### 2.4 测试逃逸分析（QM-5 ②）

| 层级 | 现状 | 为什么没拦住 |
| --- | --- | --- |
| 单元测试 | `publish-from-project.test.js` 7 例覆盖「publish.title → project.title → sourceText」回退链 | 夹具**手工给定** `project.title` 与 `sourceText` 同值、且都只有 38 字，看不出「title 其实是正文」；没有一例模拟「上游 params 不带 title」的真实生产路径 |
| 组件测试 | `HotTopics.test.js:615-662` 断言 `title === '发布标题'` | 夹具直接给了 `story2videoTextConfig.config.publish.title = '发布标题'`，而真实链路该字段恒为空串 |
| E2E | 无 | 热门选题生成视频需真实 LLM + 真实流水线，E2E 未覆盖该链 |
| 代码审查 | `hot-topics-pipeline-picker` 评审明确记录了「run-only 发布只能交接成片路径（现有 run-only 语义）」 | 当时把「不伪造标题」当成合规终态，**没有继续问「那标题应该是什么」**——这是审查盲区：规则写的是「不得注入空标题」，没人验证「注入的标题从哪来」 |

**系统性漏洞（QM-5 ③）**：`buildPublishFromProject` 的回退链在**测试夹具层被自证**——夹具让 `project.title` 与 `sourceText` 相等，于是「title 回退到 sourceText」这条在生产中是缺陷的路径，在测试中表现为「正确行为」。同类风险：任何「多级回退 + 夹具填满前几级」的纯函数，都需要至少一例**前几级全部为空**的生产形态夹具。

---

## 3. 目标与非目标

### 3.1 目标（P0）

1. 【去发布】带入的标题 = **AI 按爆款元素生成的标题**（调用用户保存的默认文字推理模型）。
2. 降级链（任一条件不满足即降级，最终必有标题）：
   - **L1**：AI 生成成功 → 用 AI 标题；
   - **L2**：AI 生成失败/超时/返回空 → 用**原始选题文本**（`genVideoTopic.topic`）；
   - **L3**：无保存的文字推理模型设置（未配置默认 LLM / 无可用模型 / 无 API Key）→ **不调用 AI**，直接用原始选题文本。
3. 标题长度受平台上限约束（百家号 100 字），AI 标题同样截断。
4. run-only（非 S2V 流水线）同样获得标题（此前为空）。
5. 用户对降级**可见**（发布页标题旁/顶部有来源提示），不做静默降级。

### 3.2 非目标（本期不做）

- 不改 `buildPublishFromProject` 的通用回退链（历史记录/结果页/播客入口仍按原语义）——本期的标题决策发生在**调用方**（热门选题 composable），不动共享提取点，避免影响其它三条入口。
- 不做「标题候选列表 + 用户挑选」交互（后续切片）。
- 不改主进程 `story2videoProject.title` 的落库语义（避免影响历史卡片标题回退链）。
- 不改发布页「标题助手」面板（那是另一条人工链路）。

---

## 4. 方案设计

### 4.1 方案对比

| 方案 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A | 改 `buildPublishFromProject`：title 增加 `aiGeneratedTitle` 参数位 | 单点修改，三入口都能用 | 改共享真源，影响历史/结果页/播客；AI 标题的「何时生成」问题没解决 | ❌ |
| B | 在 `runGenVideoRewrite` 阶段顺手让 LLM 多产出一个标题 | 一次 LLM 调用 | 改写与标题是两种任务，混在一个 prompt 里会互相污染（改写引擎已因「结构标题混入正文」踩过坑，见 learnings 2026-09-18） | ❌ |
| C | **新增独立纯函数模块 + 独立 IPC 通道**，在【去发布】点击时按需生成标题 | 不碰共享真源；纯函数可穷举测试；失败路径显式 | 多一次 IPC 往返（可接受，用户已点击按钮） | ✅ **采用** |

### 4.2 架构

```
【新增】apps/desktop/src/features/publish/gen-video-title.js
  ├─ buildGenVideoTitlePrompt(topicText, bodyText)     纯函数：构造 system/user prompt
  ├─ normalizeGeneratedTitle(raw, { max })             纯函数：清洗 LLM 输出（去引号/去编号/去思考块/截断）
  └─ resolveGenVideoTitle({ topicText, aiTitle, ... }) 纯函数：降级链决策 → { title, source }

【新增】apps/desktop/electron/ipc-handlers/gen-video-title.js
  └─ ipcMain.handle('ai:generate-gen-video-title', …)  ← 复用 aiGenerator.generateWithDefault('llm', …)

【改】apps/desktop/src/composables/useHotTopicsGenVideo.js
  ├─ publishGenVideoResult() 改 async
  ├─ 新增 genVideoTitleSource 状态（'ai' \| 'topic'）+ genVideoTitleHint 计算属性
  └─ 标题注入 publish query（有项目与 run-only 两条分支都带标题）

【改】apps/desktop/src/views/HotTopics.vue
  └─ 弹窗完成态内容区新增「标题来源」提示行（genVideoTitleReady 时才显示）
```

### 4.3 降级链（单一真源：`resolveGenVideoTitle`）

```
输入：{ topicText, aiTitle, aiAvailable, max }
  ① topicText trim 为空            → { title: '', source: 'none' }   （理论上不可达：入口已校验 topic 非空）
  ② aiAvailable === false          → { title: truncate(topicText), source: 'topic' }   ← 不调用 AI
  ③ aiTitle 非空字符串             → { title: truncate(normalize(aiTitle)), source: 'ai' }
  ④ 其余（AI 失败/空/异常/超时）    → { title: truncate(topicText), source: 'topic' }
```

- `source: 'ai'` → 发布页提示「标题由 AI 生成」；
- `source: 'topic'` → 发布页提示「标题来自原始选题（AI 标题不可用）」；
- `source: 'none'` → 不注入 title query 字段（保持「不伪造」语义，由用户在发布页手填）。

### 4.4 「爆款元素」的 Prompt 设计

system prompt（中文，短，不要求 JSON，降低推理模型输出结构标题的风险）：

```
你是短视频爆款标题编剧。基于给定选题与文案，写 1 个发布用标题。
硬性要求：
1. 只输出标题本身，不要引号、编号、解释、前后缀、markdown；
2. 不超过 30 字；
3. 必须包含以下爆款元素中的至少 2 种：悬念钩子、具体数字、情绪共鸣词、身份标签（如"打工人""新手妈妈"）、反常识结论；
4. 不使用"震撼""绝了""必看"等空洞夸张词作为唯一卖点；
5. 与选题主题一致，不改变事实，不添加原文没有的承诺。
```

user prompt：`选题：{topic}\n文案摘要：{body 前 200 字}`

> **为什么限制 30 字而不是平台上限**：百家号上限 100 字是「允许」，不是「合适」。30 字是中文短视频标题的可用区间；`normalizeGeneratedTitle` 仍按 `max`（100）做二次截断兜底。

### 4.5 主进程 LLM 通道（复用既有能力，不新增模型解析）

`aiGenerator.generateWithDefault('llm', { temperature, max_tokens, messages }, undefined, runtimeOptions)`
—— 与 `videogen-stages.callDefaultLlm` / `explainer-stages.callDefaultLlm` 同一通道：

- 模型解析：`aiGenerator._modelProviderManager.getDefault('llm')` + `resolveProviderDefaultModel`（用户默认 > 运营默认 > `capability_models.llm` > `models[0]`）。
- **未配置默认 LLM / 无可用模型 / 无 API Key** → `getLlmConfig` 返回 null ⇒ handler 返回 `{ code: 0, data: { success: false, reason: 'no-model' } }`（**不是 error**，让渲染层走 L3 降级，不弹错误对话框）。
- 推理型模型预算放大（`isReasoningLlmModel`）与既有 `callDefaultLlm` 一致。
- 超时：120s（与 `BasePythonBridge.requestTimeout` 一致），由既有桥接层兜底。

### 4.6 时序（为什么放在点击时而不是生成时）

| 时点 | 做法 | 理由 |
| --- | --- | --- |
| ❌ 改写阶段顺手生成 | 与改写混在一次调用 | 任务混淆，改写输出会被标题指令污染（历史教训） |
| ❌ run completed 时自动生成 | 用户可能只是想【查看】，不需要标题 | 浪费一次 LLM 调用；且 run 完成时改写正文已在 `genVideoRewrittenContent`，可用 |
| ✅ **点击【去发布】时按需生成** | 一次独立调用，await 后跳转 | 用户意图明确；调用失败只影响标题不影响跳转 |

**交互补偿**：点击【去发布】后按钮进入 `disabled + 加载中`（`genVideoBusy` 复用），提示「正在生成标题…」；若 3s 内未返回，允许用户再次点击跳过（不阻塞）。—— **为控制本期改动面，采用更简单的形态：跳转前 await，期间弹窗保持完成态不可重复点击（`genVideoBusy` 守卫），无倒计时跳过。**

### 4.7 与发布页的衔接

发布页已有 `?title=` 装载逻辑（`usePublishHistoryPrefill.applyHistoryVideoQuery`：`decode(query.title)` 非空才写入 `article.title`）。

- 标题经 `publishDataToQuery` 的 `encodeURIComponent` 编码；vue-router 再编码一层 ⇒ 装载侧双重解码（既有 `decode` 循环最多 2 次），**无需改动发布页**。
- **新增**：标题来源提示。发布页在视频模式 + `title_source` query 存在时，于标题输入框下方渲染一行说明文字（`videoTitleSourceHint`）。
  - 实现位置：`apps/desktop/src/views/Publish.vue`（标题 form-item 之后，与标题助手入口同侧）。
  - query 键：`title_source=ai|topic`（**不带 `title` 时不带 `title_source`**）。

---

## 5. 数据校验

### 5.1 输入校验

| 字段 | 类型 | 校验规则 | 失败行为 |
| --- | --- | --- | --- |
| `topicText` | string | trim 后非空；≤ 100000（主进程 sourceText 上限同量级） | 返回 `{ title:'', source:'none' }`，不注入 query |
| `bodyText` | string | 仅取前 200 字进 prompt；非字符串按 `''` 处理 | prompt 中摘要段为空串，不抛错 |
| `aiAvailable` | boolean | 由 IPC 返回的 `data.reason === 'no-model'` 推导 | — |
| `aiTitle` | string \| null | LLM 原始输出，交给 `normalizeGeneratedTitle` | 见 5.2 |
| `max` | number | 默认 100（百家号 `DEFAULT_CONTENT_LIMITS.titleMax`）；非有限数/≤0 回退默认 | 用默认值 |

### 5.2 LLM 输出清洗（`normalizeGeneratedTitle`）

按顺序执行，任一规则命中即记录（便于测试精确断言）：

| # | 规则 | 正则/手法 | 目的 |
| --- | --- | --- | --- |
| 1 | 剥离推理思维链 | `<think>[\s\S]*?</think>` 与未闭合的 `<think>[\s\S]*$` | 推理模型（MiniMax-M3 等）会把思考块混进 content（既有教训，ops-center 侧已实现同款，见 `prompt_eval_evaluation_service._strip_think`） |
| 2 | 剥离 markdown 围栏 | ```` ```lang\n…\n``` ```` | — |
| 3 | 取首个非空行 | `split('\n')` + trim + filter | 防止模型输出多行 |
| 4 | 去成对引号/书名号包裹 | 首尾 `"` `'` `「」` `《》` 成对出现才剥 | 不剥单边引号（可能是标题内容） |
| 5 | 去列表编号前缀 | `^\s*(\d+[.、)]\|[-*+]\s*\d*)\s*` | 模型爱加「1. 」 |
| 6 | 去常见前后缀标签 | `^\s*(标题\|Title)\s*[:：]\s*` | — |
| 7 | 去尾部标点 | `[。！？…；;,，、\s]+$` | 标题不带句尾标点 |
| 8 | 控制字符清洗 | 去掉 `\u0000-\u001F`（保留换行已不需要） | 防注入/防日志污染 |
| 9 | 长度截断 | `[...title].slice(0, max).join('')`（Unicode 码点，与 `truncateTitle` 一致） | 平台上限 |
| 10 | 空结果 | 任一步后为空 ⇒ 返回 `''`（调用方据此降级） | — |

**不做的清洗**：不做敏感词过滤（发布前有既有 `sensitiveCheck` 链路）；不改写事实内容。

### 5.3 降级判据（`resolveGenVideoTitle`）

| 条件 | 结果 |
| --- | --- |
| `topicText` trim 为空 | `source: 'none'` |
| `aiAvailable !== true` | `source: 'topic'`，标题 = 截断后的 topicText |
| `aiTitle` 经 normalize 后非空 | `source: 'ai'`，标题 = normalize 后截断 |
| `aiTitle` 为空/非字符串/normalize 后为空 | `source: 'topic'` |

---

## 6. 流程

### 6.1 主流程（成功）

```
用户点【去发布】
  → publishGenVideoResult()  [async]
  → genVideoBusy = true（按钮禁用，防重复点击）
  → ① 取本次编排上下文：videoPath / project / topicText
  → ② aiAvailable = await resolveGenVideoTitleAvailable()   // modelProviderGetDefault('llm')
  →      不可用 → 跳过 ③，titleSource = 'topic'
  → ③ aiTitle = await generateGenVideoTitle({ topicText, bodyText })
  →      code!==0 / 空 / 异常 → titleSource = 'topic'
  → ④ resolveGenVideoTitle({ topicText, aiTitle, aiAvailable, max: 100 })
  → ⑤ query = { type:'video', video_path, title, content, tags, title_source }
  →      （run-only 分支同样带 title 与 title_source；content/tags 仍不注入）
  → ⑥ resetGenVideoFrontendState() + router.push('/publish', query)
```

### 6.2 降级流程

| 场景 | 触发 | 用户可见 |
| --- | --- | --- |
| 无默认文字推理模型 | `modelProviderGetDefault('llm')` 返回 `data: null` / `code !== 0` | 发布页标题旁：「标题来自原始选题（未配置文字推理模型）」 |
| 有模型但无 API Key / 无可用模型 | handler `reason: 'no-model'` | 同上 |
| LLM 调用失败（网络/超时/5xx） | handler 抛错或 `code !== 0` | 「标题来自原始选题（AI 标题生成失败）」 |
| LLM 返回空/仅思考块 | normalize 后为空 | 「标题来自原始选题（AI 标题生成失败）」 |
| 选题文本异常为空 | `topicText` trim 空 | 不注入 title；发布页标题为空，用户手填（既有形态） |

> **区分「未配置模型」与「生成失败」两种提示**：前者用户该去模型设置补配置，后者是偶发。故 `title_source` 之外，query 增加 `title_reason`（`no-model` / `failed`）供提示文案区分。**`title_source='ai'` 时不带 `title_reason`。**

---

## 7. 功能逻辑与交互逻辑

### 7.1 交互状态机（弹窗完成态）

| 状态 | 【去发布】按钮 | 弹窗内容区 | 说明 |
| --- | --- | --- | --- |
| `completed` + 未点击 | enabled | 完成汇总 + **标题来源提示行** | 提示行在 run 成功时即可显示预测值？**否** —— AI 标题未生成，此时只显示「点击去发布时将自动生成标题」的静态说明 |
| 点击后 `genVideoBusy = true` | disabled + loading 文案 | 原完成汇总 + 「正在生成标题…」 | 不再接受重复点击 |
| 跳转完成 | — | 弹窗复位关闭 | 与既有 `resetGenVideoFrontendState` 一致 |

### 7.2 按钮与文案

| 元素 | 现状 | 改动 |
| --- | --- | --- |
| 【去发布】按钮 | `data-testid="hot-topics-gen-video-publish"`，文案 `hotTopics.genVideoPublish` | **不变**（不改 data-testid，既有测试锚点保留） |
| 完成态内容区 | 阶段全完成 + 进度 100% + 完成汇总 | 新增一行 `hotTopics.genVideoTitleHint`：「标题将由 AI 按爆款元素生成；若未配置文字推理模型或生成失败，将使用原始选题」 |
| busy 态 | — | 新增 `hotTopics.genVideoTitleGenerating`：「正在生成标题…」 |

### 7.3 发布页显示项（新增）

| 位置 | 条件 | 文案 key | zh | en |
| --- | --- | --- | --- | --- |
| 标题输入框下方 | `type=video` 且 `title_source=ai` | `publishPage.videoTitleFromAi` | 标题由 AI 按爆款元素生成 | Title generated by AI with viral elements |
| 标题输入框下方 | `title_source=topic` 且 `title_reason=no-model` | `publishPage.videoTitleFromTopicNoModel` | 未配置文字推理模型，标题已使用原始选题 | No text reasoning model configured; the original topic is used as the title |
| 标题输入框下方 | `title_source=topic` 且 `title_reason=failed` | `publishPage.videoTitleFromTopicFailed` | AI 标题生成失败，标题已使用原始选题 | AI title generation failed; the original topic is used as the title |

- 三条提示均为 `titleAssistant` 面板同级的辅助文字（`<div class="form-hint">` 级），不抢焦点。
- 用户随后**手工编辑标题不影响提示**（提示只说明来源，不声称实时同步）。
- 视频模式以外的 `title_source` **忽略**（防御性：query 可能被用户手改）。

---

## 8. 显示项汇总

| 页面 | 元素 | 内容 |
| --- | --- | --- |
| 热门选题·生成视频弹窗 | 完成态提示行 | 「标题将由 AI 按爆款元素生成；若未配置文字推理模型或生成失败，将使用原始选题」 |
| 热门选题·生成视频弹窗 | busy 提示 | 「正在生成标题…」 |
| 发布页（视频模式） | 标题下方来源提示 | 三态（AI / 未配置模型 / 生成失败）见 7.3 |

---

## 9. 接口契约

### 9.1 新增 IPC：`ai:generate-gen-video-title`

| 项 | 值 |
| --- | --- |
| 通道 | `ai:generate-gen-video-title` |
| 方向 | renderer → main（`ipcMain.handle`） |
| 参数 | `{ topicText: string, bodyText: string, max?: number }` |
| 返回（成功） | `{ code: 0, data: { success: true, title: string } }` |
| 返回（无模型） | `{ code: 0, data: { success: false, reason: 'no-model' } }` |
| 返回（LLM 失败） | `{ code: 0, data: { success: false, reason: 'failed', message: string } }` |
| 返回（参数非法） | `{ code: EC.VALIDATION_ERROR, message: '缺少参数对象' }` |
| sender 校验 | `withSenderCheck`（与 `ai:generate` 一致） |
| 安全 | API Key 只在主进程 `modelProviderManager.getProviderWithKey` 边界读取，不出渲染层、不落日志（与 `prompt-bridge.resolveLlmBind` 同契约） |

### 9.2 渲染层 API 封装

`apps/desktop/src/api/publisher.js` 新增：

```js
export async function aiGenerateGenVideoTitle (payload) {
  return invokeWithFallback('aiGenerateGenVideoTitle', { code: -1, message: 'electronAPI not available' }, payload)
}
```

### 9.3 路由 query 契约（扩展）

| 键 | 类型 | 出现条件 | 示例 |
| --- | --- | --- | --- |
| `type` | `'video'` | 总是 | `video` |
| `video_path` | string（encodeURIComponent） | 总是 | `D%3A%5Cvideos%5Cout.mp4` |
| `title` | string（encodeURIComponent） | `resolveGenVideoTitle().title` 非空 | `%E5%A5%B9%E5%A6%88%E7%9A%84%E7%81%B6%E5%8F%B0` |
| `content` | string | **仅有项目对象时**（既有语义不变） | — |
| `tags` | string | **仅有项目对象且有标签时**（既有语义不变） | `AI` |
| `title_source` | `'ai' \| 'topic'` | `title` 非空 | `ai` |
| `title_reason` | `'no-model' \| 'failed'` | `title_source==='topic'` | `no-model` |

---

## 10. 测试计划（TDD）

### 10.1 新增纯函数测试 `apps/desktop/src/features/publish/gen-video-title.test.js`

| # | 用例 | 断言 |
| --- | --- | --- |
| T1 | `normalizeGeneratedTitle` 剥离 `<think>` 闭合块 | 只剩标题本体 |
| T2 | 剥离未闭合 `<think>` 尾部 | 同上 |
| T3 | 剥离 markdown 围栏 | 同上 |
| T4 | 多行输出取首个非空行 | 只留第一行 |
| T5 | 去成对引号/书名号 | `「xxx」` → `xxx` |
| T6 | 单边引号不剥 | `"xxx` → `"xxx` |
| T7 | 去列表编号 | `1. xxx` / `1、xxx` / `- xxx` → `xxx` |
| T8 | 去「标题：」前缀 | `标题：xxx` → `xxx` |
| T9 | 去尾部标点 | `xxx。` → `xxx` |
| T10 | Unicode 码点截断（emoji/中文） | 长度按码点计，不产生半个代理对 |
| T11 | 空/纯空白/纯标点 → `''` | 返回空串 |
| T12 | `resolveGenVideoTitle`：aiAvailable=false → topic | `source:'topic'`，标题=截断 topic |
| T13 | aiAvailable=true + 有效 aiTitle | `source:'ai'` |
| T14 | aiAvailable=true + aiTitle 空串 | `source:'topic'` |
| T15 | aiAvailable=true + aiTitle normalize 后为空（纯思考块） | `source:'topic'` |
| T16 | aiAvailable=true + aiTitle 非字符串（null/number/object） | `source:'topic'`，不抛错 |
| T17 | topicText 空/纯空白 | `source:'none'`，标题 `''` |
| T18 | topicText 超长按 max 截断 | 码点截断 |
| T19 | max 非法（0/-1/NaN/'30'） | 回退默认 100 |
| T20 | `buildGenVideoTitlePrompt`：含选题与摘要、含 5 类爆款元素要求、含「只输出标题本身」 | 字符串包含断言 |
| T21 | `buildGenVideoTitlePrompt`：bodyText 截断到 200 字 | 长度断言 |
| T22 | `buildGenVideoTitlePrompt`：bodyText 非字符串 | 不抛错，摘要段为空 |

### 10.2 新增 IPC 测试 `apps/desktop/electron/ipc-handlers/gen-video-title.test.js`

| # | 用例 |
| --- | --- |
| I1 | 有默认 LLM + 正常返回 → `{code:0,data:{success:true,title}}` |
| I2 | 无默认 LLM（`getDefault` 返回 null）→ `success:false, reason:'no-model'` |
| I3 | 默认 LLM 无可用模型（`resolveProviderDefaultModel` 空）→ `reason:'no-model'` |
| I4 | `generateWithDefault` 抛错 → `reason:'failed'` + message，不向渲染层抛 |
| I5 | 返回空 content → `reason:'failed'` |
| I6 | 参数非对象 → `VALIDATION_ERROR` |
| I7 | `topicText` 为空串 → `VALIDATION_ERROR`（不浪费 LLM 调用） |
| I8 | `max` 非法 → 用默认 100（透传给 normalize 的上限） |
| I9 | 推理型模型预算放大（`isReasoningLlmModel`）→ `max_tokens` 放大 |

### 10.3 组件测试扩展 `apps/desktop/src/views/HotTopics.test.js`

| # | 用例 |
| --- | --- |
| C1 | AI 标题成功 → `title` = AI 标题、`title_source='ai'`、无 `title_reason` |
| C2 | 无默认 LLM → 不调用 generateGenVideoTitle；`title` = 原始选题、`title_source='topic'`、`title_reason='no-model'` |
| C3 | LLM 返回空 → `title` = 原始选题、`title_reason='failed'` |
| C4 | run-only（无 project）→ 仍带 `title` 与 `title_source`；`content/tags` 仍为 undefined |
| C5 | 选题文本为原始 topic（不被改写文案污染） | 断言 `title` 与 `mockTopics[i].topic` 相关 |
| C6 | 点击后 busy 期间重复点击不产生第二次 IPC |
| C7 | 完成态内容区显示 `genVideoTitleHint` 文案 |
| C8 | 既有 3 例（有项目 / run-only / view）仍全绿 |

### 10.4 发布页测试扩展 `apps/desktop/src/views/Publish.test.js`

| # | 用例 |
| --- | --- |
| P1 | `?title_source=ai` → 显示 `videoTitleFromAi` |
| P2 | `?title_source=topic&title_reason=no-model` → 显示 `videoTitleFromTopicNoModel` |
| P3 | `?title_source=topic&title_reason=failed` → 显示 `videoTitleFromTopicFailed` |
| P4 | 无 `title_source` → 不显示任何来源提示 |
| P5 | 图文模式（`activeMode!=='video'`）带 `title_source` → 不显示 |

### 10.5 门禁

- `pnpm -C apps/desktop test`（含上述全部）
- locale-sync：`node .github/scripts/check-locale-sync.js --pair-base origin/main` / `--cjk` / `--keys`
- eslint
- QM-1 打包（改动含 `apps/desktop/electron/ipc-handlers/`）：
  `cd apps/desktop && pnpm exec electron-builder --win --dir --publish never` + asar 清单 + require 链 + 启动测试（三层 stderr 判据 + 存活断言 + `buildChildEnv`）

---

## 11. 兼容性与风险

| 风险 | 影响面 | 缓解 |
| --- | --- | --- |
| 多一次 LLM 调用增加点击延迟 | 单次点击 | 无模型时**不调用**（先查默认模型）；有模型时一次 chat completion（秒级） |
| LLM 输出不可控（超长/多行/带围栏） | 标题质量 | 10 条 normalize 规则 + 30 字 prompt 约束 + max 截断 |
| 改了 `publishGenVideoResult` 为 async | 既有 3 例组件测试 | 全部补 `flushPromises`；`genVideoBusy` 守卫保证幂等 |
| 发布页新增提示行触发像素门禁 | 视觉回归 | 提示行是**条件渲染**（无 `title_source` 时不渲染），热门选题→发布页视觉基线路径若不含该 query 则 DOM 不变；需跑 `test:visual:pixel` 复核 |
| 主进程 handler 注册失败导致 IPC 不可用 | 降级 | 渲染层 `invokeWithFallback` 已兜底；`aiAvailable` 查询同样有 fallback |
| 选题文本本身超长（热榜标题可能很长） | 标题长度 | `max` 截断（100）+ normalize |

---

## 12. 验收标准（AC）

| ID | 标准 | 验证方式 |
| --- | --- | --- |
| AC-1 | 配置了默认文字推理模型时，【去发布】带入的标题是 AI 生成的爆款标题（≤30 字理想、≤100 字硬限），不是正文切片 | 单测 C1 + I1 + T13 |
| AC-2 | 未配置默认文字推理模型时，不发起 LLM 调用，标题 = 原始选题文本 | 单测 C2 + I2/I3 |
| AC-3 | LLM 调用失败/返回空时，标题 = 原始选题文本，且发布页显示失败提示 | 单测 C3 + I4/I5 + P3 |
| AC-4 | 非 S2V 流水线（run-only）同样带入标题，`content/tags` 仍不注入 | 单测 C4 |
| AC-5 | 发布页按 `title_source`/`title_reason` 显示三态来源提示 | 单测 P1-P5 |
| AC-6 | 点击【去发布】后重复点击不产生第二次 LLM 调用 | 单测 C6 |
| AC-7 | 全部测试 + 门禁 + QM-1 打包通过，CI 绿 | CI |
| AC-8 | 文档同步：PRD、PRD-HOT-TOPICS-MODULE、PRD-VIDEO-PIPELINE-PROGRESS-MODAL、CHANGELOG、i18n-glossary、learnings | 人工核对 |

---

## 13. 影响文件清单

| 文件 | 改动类型 |
| --- | --- |
| `apps/desktop/src/features/publish/gen-video-title.js` | 新增 |
| `apps/desktop/src/features/publish/gen-video-title.test.js` | 新增 |
| `apps/desktop/electron/ipc-handlers/gen-video-title.js` | 新增 |
| `apps/desktop/electron/ipc-handlers/gen-video-title.test.js` | 新增 |
| `apps/desktop/electron/main.js`（或 handlers 注册处） | 接线注册 |
| `apps/desktop/src/api/publisher.js` | 新增 `aiGenerateGenVideoTitle` / `modelProviderGetDefault` 复用 |
| `apps/desktop/src/composables/useHotTopicsGenVideo.js` | 改 `publishGenVideoResult` + 新增状态 |
| `apps/desktop/src/views/HotTopics.vue` | 完成态提示行 |
| `apps/desktop/src/views/Publish.vue` | 标题来源提示行 |
| `apps/desktop/src/locales/hot-topics/{zh,en}.js` | 新增 2 key |
| `apps/desktop/src/locales/publish-page/{zh,en}.js` | 新增 3 key |
| `apps/desktop/src/views/HotTopics.test.js` | 新增 8 例 |
| `apps/desktop/src/views/Publish.test.js` | 新增 5 例 |
| `apps/desktop/src/api/publisher.test.js` | 新增 1 例（API 封装契约） |
| `01-docs/PRD.md` | 补充热门选题视频发布标题口径 |
| `01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md` | §3.13 补标题生成小节 |
| `01-docs/PRD-VIDEO-PIPELINE-PROGRESS-MODAL-2026-10-17.md` | §4.3 补标题降级链 |
| `01-docs/i18n-glossary.md` | 登记新文案 |
| `CHANGELOG.md` | 追加本次变更 |
| `01-docs/learnings.md` | 记录根因与教训 |
| `openspec/changes/fix-hot-topics-genvideo-title/` | proposal/design/tasks/specs |

---

## 14. 本期明确不做（防范围蔓延）

1. 不改 `buildPublishFromProject` 的回退链（历史记录/结果页/播客三条入口的标题语义不变）。
2. 不做标题候选多选交互。
3. 不改主进程 `story2videoProject.title` 落库。
4. 不改发布页「标题助手」面板。
5. 不改 `publishDataToQuery` 的既有字段语义（只新增可选字段，由调用方决定是否传入）。
