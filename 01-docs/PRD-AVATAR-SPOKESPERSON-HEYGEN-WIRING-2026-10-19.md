# PRD：数字人（avatar-spokesperson）流水线真正接通 HeyGen

| 项 | 值 |
|---|---|
| 文档编号 | PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19 |
| 状态 | 待实现 |
| 分支 | `avatar-heygen-wiring`（隔离 worktree：仓库父目录下 `mp-worktrees/mp-avatar-heygen-wiring`，非共享根） |
| 优先级 | P1（补齐已登记但未接通的流水线能力） |
| 关联流水线 | `avatar-spokesperson`（数字人口播） |
| 关联模型 | HeyGen（provider id `heygen`，model `heygen-video`） |

---

## 一、背景与问题（第一性原因）

### 1.1 现状事实

`avatar-spokesperson`（外显「数字人口播」）在仓库中已被完整登记：

- [pipeline-engine.js:225](../apps/desktop/electron/services/pipeline-engine.js) 定义了 4 阶段：`avatar_select` → `script` → `generate` → `render`
- [locales/pipelines/zh.js:11](../apps/desktop/src/locales/pipelines/zh.js) 外显名「数字人口播」，模式「口播式（数字人出镜）」
- [model-provider-seeds.js:283](../apps/desktop/electron/services/model-provider-seeds.js) 已内置 HeyGen provider（`category: 'video'`）
- [adapters/heygen.js](../apps/desktop/electron/services/adapters/heygen.js) 已实现数字人 adapter，`generateVideo()` 要求 `character` + `voice` + `script`
- [ops-center pipeline_dependency_service.py:45](../ops-center/backend/services/pipeline_dependency_service.py) 已登记「数字人视频生成（video）」「数字人口播语音（tts）」

### 1.2 但它并没有真正接通数字人

代码事实上的行为是「LLM 写口播文案 → 把主题当通用文生视频提示词 → **默认视频模型**生成 → FFmpeg 拼接」，与数字人无关。三处断裂：

| # | 断裂点 | 位置 | 事实 |
|---|---|---|---|
| B1 | `generate` 阶段取的是**通用视频默认 provider**，不认数字人 | [videogen-stages.js:677](../apps/desktop/electron/services/videogen-stages.js) `getVideoProviderConfig()` = `manager.getDefault('video')` | 候选是 agnes-video/cogvideo/kling/runway/veo/wan/minimax 等通用文生视频模型，HeyGen 只是其中**之一**且不是默认（默认 `minimax`，见 `DEFAULTS.video`） |
| B2 | 调用 `generateVideo` 时**没有传数字人参数** | [videogen-stages.js:777](../apps/desktop/electron/services/videogen-stages.js) | 实参只有 `prompt/model/width/height/numFrames/frameRate`，缺 `character`/`voice`/`script`。若默认 provider 恰为 heygen，adapter 直接抛 `INVALID_CONFIG` |
| B3 | `avatarId` 无人消费 | [videogen-stages.js:479、484](../apps/desktop/electron/services/videogen-stages.js) | 只在 `avatar_select` 读出并写进 output，**无下游**；前端全仓无数字人选择 UI（`avatarId` 仅主进程 2 处出现） |

### 1.3 逃逸分析（测试为什么没抓到）

| 层 | 是否拦住 | 为什么没拦住 |
|---|---|---|
| 单元测试 | ❌ | `heygen.test.js` 只测 adapter 自身（传足 character/voice/script 就通过），从没测「流水线调用 adapter 时传了什么」 |
| 流水线测试 | ❌ | `pipeline-engine.test.js:30/44` 只断言「流水线在列表里 / 被实现」，不断言阶段参数 |
| 能力前置测试 | ❌ | `pipeline-model-preflight.test.js:47` 只断言 `avatar-spokesperson → [llm, video]`，而 `video` 能力对通用模型也成立 ⇒ 声明与「数字人」无关 |
| E2E | ❌ | [video-model-pipelines.js:42](../apps/desktop/tests/e2e/video-model-pipelines.js) 只跑 `params: { text }`，从不下发 avatarId，且依赖真实 API Key，CI 不跑 |
| Code Review | ❌ | 阶段名 `avatar_select` / 错误文案「数字人视频生成」在代码里读起来**像**已接通，review 时无法从命名看出参数未透传 |

**系统性漏洞（单一根因）**：「流水线定义的**语义**」与「阶段执行器的**实际调用契约**」之间没有任何机械对账。命名像 ≠ 接通。

---

## 二、目标与非目标

### 2.1 目标（Do）

1. **G1**：`avatar-spokesperson` 的 `generate` 阶段真正调用数字人能力，成片是数字人口播视频，而非通用文生视频。
2. **G2**：用户能在 UI 上选择「数字人形象」与「音色」，选择结果随流水线启动下发。
3. **G3**：数字人能力缺失/未配置时，**启动前**给出可操作的结构化错误（而不是跑到 generate 阶段才失败）。
4. **G4**：数字人形象/音色列表从 HeyGen 真实拉取，带缓存、加载中、失败重试三态。
5. **G5**：全程 fail-closed——拿不到列表/参数不合法，明确报错，不静默降级成通用视频模型。

### 2.2 非目标（Don't）

- ❌ 不做声音克隆/人脸克隆（[RESEARCH-VIDEO-CLONE-REFERENCE](../01-docs/RESEARCH-VIDEO-CLONE-REFERENCE-2026-08-12.md) 已拍板「不克隆声音与人脸」）。本次只用 HeyGen **官方已有**的数字人形象与音色。
- ❌ 不新增第二个数字人供应商（MuseTalk/Wav2Lip/HeyGem/Duix-Avatar 等一律不在范围）。
- ❌ 不改 `talking-head`（真人出镜口播）流水线的任何行为。
- ❌ 不改 `animation` / `character-animation` / `hybrid` 的通用文生视频链路（它们复用同一 GENERATE 阶段，本次改动必须不破坏）。
- ❌ 不做数字人形象预览图下载与展示（HeyGen 返回的是预览 URL，首期只展示名称，不落盘图片）。

---

## 三、方案设计

### 3.1 方案对比

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A. 通用 provider 参数适配** | 保持 `getDefault('video')`，在 GENERATE 里判断流水线是 avatar 就补 character/voice/script | 改动最小 | 语义错：通用文生视频模型（kling/veo…）根本不认这些参数，会把数字人参数发给错误 provider；且默认 provider 是 minimax 时照样不通 | ❌ |
| **B. 数字人走独立能力位 `digital_human`** | 新增 capability，preflight 校验，stages 按能力位取 provider | 语义清晰，可扩展第二家 | 需改 capability 枚举、preflight 表、ops-center 依赖表 | ⚠️ 过度设计（当前只有一家） |
| **C. 数字人流水线强制 HeyGen provider + 参数透传** | avatar-spokesperson 的 generate 阶段**固定**解析 heygen provider（可由 `params.videoProvider` 覆盖），并透传 character/voice/script；preflight 用「数字人专用能力校验」拦截 | 语义正确、fail-closed、改动可控、不破坏其他流水线 | 硬编码一家 | ✅ **采用** |

**选 C 的理由（P5 Explicit over clever + P3 Pragmatic）**：当前仓库**只有** HeyGen 一家数字人 adapter（`model-provider-seeds.js` 中 `category: 'video'` 里唯一带数字人语义的），为一个供应商引入新 capability 枚举是凭空增加抽象层。将来接第二家时，只需把「解析 heygen」替换成「解析 capability=digital_human 的 default」，改动面仍是同一处函数。

### 3.2 数据流

```
[UI] 数字人选择区（CreateView 新增，仅 avatar-spokesperson 显示）
   │  mount → avatarCatalog.list({ providerId:'heygen' })
   ▼
[IPC] avatar-catalog:list  →  AvatarCatalogService.list()
   │                            └→ modelProviderManager.callAdapter('heygen','listAvatars',{})
   ▼
[Adapter] HeyGenAdapter.listAvatars() → GET /v2/avatars   （带 TTL 缓存 5min）
          HeyGenAdapter.listVoices()  → GET /v2/voices
   ▼
[UI] 用户选 avatarId + voiceId → 存入 avatarConfig
   │
[启动] startExplainerPipeline()  params 增补：
       { text, avatarId, voiceId, videoProvider:'heygen' }
   ▼
[IPC] pipeline:startOrchestrated → startOrchestrated(name, params)
   │  ① checkPipelineModelRequirements（新增数字人分支）
   ▼
[Stage] avatar_select (videogen_avatar)
   │  校验 avatarId 非空 + voiceId 非空 → 否则 fail-closed 报错
   │  LLM 生成口播文案 script
   │  output: { script, avatarId, voiceId, topic }
   ▼
[Stage] script (videogen_script)  —— 复用现有 LLM 文案（保留）
   ▼
[Stage] generate (videogen_generate)  ★本次核心改动
   │  if 流水线是 avatar-spokesperson：
   │     provider = resolveDigitalHumanProvider()  → heygen
   │     callAdapter(provider,'generateVideo',{
   │       character: avatarId, voice: voiceId, script: <口播文案>
   │     })
   │     轮询 getVideoStatus → 下载 → scene_000.mp4
   │  else：走既有通用文生视频链路（逐字节不变）
   ▼
[Stage] render (videogen_merge) → FFmpeg 拼接 → 成片
```

### 3.3 关键决策记录（Decision Log）

| # | 决策 | 理由 | 替代方案（被否） |
|---|---|---|---|
| D1 | 数字人 provider 由 `AVATAR_DIGITAL_HUMAN_PROVIDER='heygen'` 常量固定，允许 `params.videoProvider` 显式覆盖 | 单一供应商 + 留覆盖口子；常量集中一处便于将来替换 | 新增 capability 枚举（过度设计） |
| D2 | character/voice/script 三参数在 `generate` 阶段**直接取 context.avatar_select 的 output**，不从 params 二次读取 | 阶段上下文是单一真源，避免 params 与 context 双源不一致 | 每次都从 params 读（params 在 normalize 后可能丢字段） |
| D3 | 数字人分支**跳过 prompt-engine 视频提示词优化** | prompt-engine 是通用文生视频提示词优化器，对「数字人 + 口播文案」无意义；且 8013 未运行时它会 fail-closed 直接失败 | 仍走优化（多一次无意义的网络往返 + 无谓失败点） |
| D4 | 形象/音色列表加 5 分钟 TTL 缓存，提供 `refresh:true` 强制刷新 | HeyGen 列表接口按次计费/限流（8 rpm），流水线配置页会频繁开关 | 每次实时拉（浪费配额） |
| D5 | `avatarId`/`voiceId` 缺失时**启动前**拦截（preflight），不在 generate 阶段才报 | 用户可立即修正；跑到 generate 才失败意味着前面已消耗了 LLM 调用 | 运行时才校验（浪费） |
| D6 | 数字人能力不单独占用 `video` capability 校验，而用「provider 可用性 + 三参数齐全」复合校验 | 避免把「配了 kling 就算数字人可用」的假阳性 | 只校验 video 能力（正是当前的假阳性来源） |
| D7 | 数字人文案**全部**走 locale，渲染端不写中文 fallback | CI Gate 7（`check-locale-sync.js --cjk`）会拦截渲染端新增的中文字符串字面量；locale 是文案唯一真源 | 用 `translateWithLocaleFallback(key, '中文兜底')`（该范式会让 CJK 基线新增条目，被门禁拦） |
| D8 | 错误文案在 composable 侧只存「locale key 或原始错误码」，渲染端翻译 | 纯函数 composable 不持有 i18n 实例；识别不了的错误码原样显示，不臆造翻译 | composable 内直接写中文（违反 D7） |

---

## 四、数据校验规则

### 4.1 IPC 入参校验（`avatar-catalog:list` / `:voices`）

参照 [tts-voice-catalog.js:17](../apps/desktop/electron/ipc-handlers/tts-voice-catalog.js) 的 `isSafeIdentifier` 范式：

| 字段 | 类型 | 必填 | 校验规则 | 不通过返回 |
|---|---|---|---|---|
| `providerId` | string | 是 | `/^[a-zA-Z0-9._-]+$/`，长度 1..128 | `{ code: VALIDATION_ERROR, message: 'AVATAR_CATALOG_INVALID_ARGUMENTS' }` |
| `refresh` | boolean | 否 | 严格布尔，`undefined` 视为 false | 同上 |
| 顶层 | object | 是 | 非 null、非数组 | 同上 |

### 4.2 流水线启动校验（preflight，新增数字人分支）

| 顺序 | 检查 | 失败 errorCode | 用户可见提示 |
|---|---|---|---|
| 1 | 流水线 == `avatar-spokesperson` | — | — |
| 2 | `params.avatarId` 非空字符串 | `AVATAR_ID_REQUIRED` | 「请先选择数字人形象」 |
| 3 | `params.voiceId` 非空字符串 | `AVATAR_VOICE_REQUIRED` | 「请先选择数字人音色」 |
| 4 | HeyGen provider 已配置且 API Key 可用 | `PIPELINE_MODEL_REQUIREMENTS_MISSING` | 复用既有能力缺失弹窗（含「去模型设置」） |
| 5 | 默认 LLM 可用（写口播文案） | `PIPELINE_MODEL_REQUIREMENTS_MISSING` | 同上 |

校验位置：`checkPipelineModelRequirements()` 内新增数字人分支，**在 `start()` 之前**（[pipeline-engine.js:1383](../apps/desktop/electron/services/pipeline-engine.js)），保证不创建孤儿 run。

### 4.3 阶段运行时校验（generate）

| 检查 | 失败行为 |
|---|---|
| `context.avatar_select` 缺失或不含 `script` | `{ success:false, error:'数字人视频生成需要前序口播文案' }` |
| `avatarId` 或 `voiceId` 为空 | `{ success:false, error:'数字人视频生成需要 avatarId 与 voiceId' }` |
| HeyGen provider 未配置 | `{ success:false, errorCode:'VIDEO_MODEL_NOT_CONFIGURED', error:'需要 HeyGen 数字人模型…' }` |
| adapter 未实现 `generateVideo` | 透出 adapter 原始错误，不吞 |

### 4.4 边界值

| 输入 | 期望 |
|---|---|
| `avatarId` 含空格/引号/超长（>256） | 校验阶段拒绝（isSafeIdentifier） |
| 文案为空 | `startExplainerPipeline` 已拦截（`TEXT_REQUIRED`），保持 |
| 文案超长（>1000 字） | 交由 HeyGen 侧返回错误，前端透出；不本地截断（避免截断出半句） |
| 列表接口返回空数组 | UI 显示「未获取到可用形象」，**不**回退成通用视频 |
| 列表接口超时/401 | UI 显示错误 + 「重试」按钮；缓存内仍有旧数据时显示旧数据并标注「（缓存）」 |

---

## 五、交互与显示项

### 5.1 触发条件

仅当 `selectedPipeline.name === 'avatar-spokesperson'` 时，在「输入内容」区下方、输出配置上方渲染「数字人」配置区。

### 5.2 数字人配置区（新增）

| 元素 | 说明 |
|---|---|
| 区块标题 | 「数字人」 |
| 形象下拉 | label「数字人形象」；选项来自 `GET /v2/avatars`（`avatar_id` + `avatar_name`）；placeholder「请选择数字人形象」 |
| 音色下拉 | label「数字人音色」；选项来自 `GET /v2/voices`（`voice_id` + `name` + `language`）；placeholder「请选择音色」 |
| 刷新按钮 | 图标按钮，「刷新列表」；点击后强制 `refresh:true` 重拉 |
| 加载态 | 下拉禁用 + 文案「正在加载数字人列表…」 |
| 错误态 | 红字 + 「重试」按钮；文案「数字人列表加载失败：{reason}」 |
| 空态 | 「未获取到可用数字人形象，请检查 HeyGen 配置」 |
| 未配置 provider | 整区替换为提示「使用数字人需要在模型设置中配置 HeyGen」+ 「前往配置」链接（跳 `#/model-providers`） |

### 5.3 状态矩阵

| 状态 | 形象下拉 | 音色下拉 | 刷新按钮 | 提示文案 |
|---|---|---|---|---|
| 初始（未选择流水线） | 不渲染 | 不渲染 | — | — |
| 加载中 | 禁用 | 禁用 | 禁用(loading) | 「正在加载数字人列表…」 |
| 加载成功有数据 | 启用 | 启用 | 启用 | 无 |
| 加载成功无数据 | 禁用 | 禁用 | 启用 | 「未获取到可用数字人形象」 |
| 加载失败（无缓存） | 禁用 | 禁用 | 启用 | 「数字人列表加载失败：{reason}」+ 重试 |
| 加载失败（有缓存） | 启用（缓存数据） | 启用 | 启用 | 「列表为缓存数据，刷新失败：{reason}」 |
| provider 未配置 | 不渲染 | 不渲染 | — | 「使用数字人需要在模型设置中配置 HeyGen」+ 前往配置 |

### 5.4 启动行为

- 点击「启动流水线」时，若流水线为 avatar-spokesperson 且 avatarId/voiceId 任一为空 → **禁用启动按钮**，禁用原因（常驻可见，非 hover title）显示「请先选择数字人形象」/「请先选择数字人音色」。
- 启动参数下发：`{ text, inputMode:'text', checkpointPolicy:'none', autoAdvance:true, background:true, avatarId, voiceId, videoProvider:'heygen' }`。

### 5.5 进度文案（复用既有 key，不新增）

| 阶段 | 复用 key | 显示 |
|---|---|---|
| avatar_select | `stageProgress.videogenAvatar` | 「正在生成数字人口播文案…」 |
| generate | `stageProgress.videogenGenerateStart` | 「正在准备生成视频场景…」 |
| render | `stageProgress.videogenRender` | 「正在检查最终视频文件…」 |

> 说明：数字人分支复用通用文案，避免为一家供应商新增一组 locale（zh/en 成对维护成本）。若后续数字人链路独立化再拆。

---

## 六、功能逻辑

### 6.1 HeyGen adapter 新增方法

```js
// apps/desktop/electron/services/adapters/heygen.js
async listAvatars()   // GET /v2/avatars  → [{ id, name, previewUrl, gender }]
async listVoices()    // GET /v2/voices   → [{ id, name, language, gender }]
```

- 复用 `_request()`；错误经 `fromHttpStatus` 归一为 ProviderError。
- 404/401 均向上冒泡，由 service 层决定降级文案。

### 6.2 AvatarCatalogService（新增）

`apps/desktop/electron/services/avatar-catalog-service.js`

```js
class AvatarCatalogService {
  constructor({ modelProviderManager, ttlMs = 5 * 60 * 1000 })
  async listAvatars({ providerId, refresh })  // 缓存 + callAdapter('listAvatars')
  async listVoices({ providerId, refresh })   // 缓存 + callAdapter('listVoices')
  invalidate(providerId)                       // 清理缓存
}
```

- 缓存键 = `${providerId}`，存 `{ at: Date.now(), value }`。
- `refresh === true` 跳过缓存读。
- adapter 未实现该方法（非 heygen provider）→ 返回 `{ code:-1, message:'AVATAR_CATALOG_UNSUPPORTED_PROVIDER' }`，**不抛异常**。

### 6.3 videogen-stages.js 改动

| 函数 | 改动 |
|---|---|
| `getVideoProviderConfig` | 保持不变（通用链路用） |
| 新增 `resolveDigitalHumanProvider(aiGenerator, params)` | 返回 `{ providerId: params.videoProvider || 'heygen', model }` |
| GENERATE 执行器 | 开头判定 `stage.options?.digitalHuman === true` 或 run.pipeline === 'avatar-spokesperson' → 走数字人分支；否则走原路径（**逐字节不变**） |
| 数字人分支 | 取 `context.avatar_select.{script,avatarId,voiceId}` → `callAdapter(providerId,'generateVideo',{character,voice,script})` → 轮询 → 下载 |

**兼容性硬要求**：`animation` / `character-animation` / `hybrid` 三条流水线共用 GENERATE，其执行路径不得有任何行为变化（由回归测试锁定）。

### 6.4 pipeline-model-preflight.js 改动

`STATIC_PIPELINE_REQUIREMENTS['avatar-spokesperson']` 保持 `[LLM, VIDEO]`（不破坏既有断言），**新增**独立的数字人校验函数 `checkDigitalHumanRequirements()`，在 `checkPipelineModelRequirements` 内对 avatar-spokesperson 追加执行。

---

## 七、验收标准

| # | 验收项 | 判据 |
|---|---|---|
| A1 | 数字人分支调用正确 | 单测断言 `callAdapter` 被调用且实参含 `character`/`voice`/`script` |
| A2 | 通用链路零回归 | animation/character-animation/hybrid 的既有单测全绿，且新增断言「数字人分支未被触发」 |
| A3 | 参数缺失 fail-closed | avatarId 为空时启动被拦，返回 `AVATAR_ID_REQUIRED`，不创建 run |
| A4 | 列表三态 | 加载中/失败/空 三态 UI 均有对应 data-testid 且单测可断言 |
| A5 | 缓存生效 | 5 分钟内二次 list 不触发第二次 adapter 调用；`refresh:true` 触发 |
| A6 | locale 成对 | zh/en 新增 key 成对，CI Gate 7 `check-locale-sync.js` 通过 |
| A7 | IPC 契约 | 新 namespace `avatarCatalog` 在 preload 暴露面契约测试中登记 |
| A8 | 打包通过 | QM-1：`electron-builder --win --x64` exit 0 |

---

## 八、不做清单（防止范围蔓延）

1. 不做数字人形象预览图下载/展示。
2. ~~不做自定义数字人（上传照片生成形象）。~~
   **2026-10-22 修订（change: avatar-voice-clone）**：本条原意是「不克隆**他人**身份」，
   而非「不允许用户克隆自己」。用户自克隆自己的形象与声音已单独立项实现，
   见 `openspec/changes/avatar-voice-clone/`；本条作用域收窄为「不克隆他人身份」。
3. 不做多数字人同屏/对话视频。
4. 不做数字人视频的字幕烧录（复用 render 阶段现有合并，不新增字幕能力）。
5. 不改 `talking-head` / 其它流水线。

---

# 附录 A：数字人 provider 多供应商化（change: digital-human-multiprovider，2026-10-23）

> 本附录是对正文的**增量修订**。正文写于 2026-10-19，当时仓库只有 HeyGen 一家数字人
> adapter，provider 名在两处硬编码。本附录记录「去硬编码 + 接入飞影 HiFly」的完整契约。

## A.1 背景与动因

| 问题 | 后果 |
|---|---|
| `DIGITAL_HUMAN_PROVIDER = 'heygen'` 在 `digital-human-stages.js` 与 `pipeline-model-preflight.js` **各写一份** | 两处容易漂移；注释要求「保持同步」但无机械约束 |
| provider 名写死 | 用户无法在设置里切换数字人服务商；加第三家要改多处 |
| 克隆 registry 键为 `avatar-clones:v1:<ownerHash>`（不含 provider） | 两家克隆 id **同形同键**，会写进同一份 registry；用户切换 provider 后看到的是另一家的失效 id，选了要到 generate 阶段才炸 |

## A.2 能力判据（单一真源）

provider 通过 `capabilities` 声明自己是数字人服务商：

```
capabilities: ['video', 'digital_human']
```

**前端与主进程用同一把判据**：`CreateView.vue` 的 `hasDigitalHumanCapability()` 与主进程
`resolveDigitalHumanProviderId()` 都检查 `capabilities.includes('digital_human')`。
若两边判据不一致，会出现「下拉里有、一启动就报 provider 不可用」。

解析优先级（`resolveDigitalHumanProviderId`）：

| 优先级 | 条件 | 说明 |
|---|---|---|
| 1 | `params.videoProvider` 非空 | 显式覆盖，保留人工指向其他数字人服务的口子 |
| 2 | 只有一家声明了 `digital_human` | 直接命中，无需默认 provider |
| 3 | 多家时取模型设置里 `video` 能力的默认 provider | 与图片/视频生成器的默认 provider 同源 |
| 4 | 默认 provider 不是数字人 | 取排序后第一家（稳定，不随机） |
| — | 一家都没声明 | 返回 `null`，调用方 fail closed |

**关键约束**：一家都没配时**不得回落** `getDefault('video')`——那会拿到 agnes-video /
kling / runway 等**通用文生视频**模型，它们不认 `character/voice/script`，
把数字人参数发给它们等于把流水线跑成普通文生视频。

## A.3 两家 adapter 的契约对照

上层（`digital-human-stages.js`）按 `{character, voice, script}` 调用，两家 adapter
**同名同参**，差异全在内部字段映射：

| 维度 | HeyGen | 飞影 HiFly |
|---|---|---|
| Base URL | `https://api.heygen.com/v2` | `https://hfw-api.hifly.cc/api/v2/hifly` |
| 认证头 | `X-Api-Key` | `Authorization: Bearer` |
| 视频生成 | `POST /v2/video/generate`，body `video_inputs:[{character:{...},voice:{...}}]` + `dimension` | `POST /video/create_by_tts`，body **扁平** `{avatar, voice, text, title?}` |
| 状态查询 | `GET /v1/video_status.get?video_id=` | `GET /video/task?task_id=` |
| 状态字段 | `status` 字符串 | `status` **整数**（1等待/2处理中/3完成/4失败） |
| 视频地址字段 | `video_url` | `video_Url`（大写 U，文档原样） |
| 形象列表 | `GET /v2/avatars` 全量 | `GET /avatar/list`，`page`/`size`/`kind` 分页，字段 `avatar`/`title`/`kind` |
| 音色列表 | `GET /v2/voices` | `GET /voice/list`，`page`/`size`/`kind` |
| 素材上传 | 直接发 Blob | **两步**：`POST /tool/create_upload_url` 换 `file_id` → PUT 上传二进制 |
| 形象克隆 | `POST /v3/avatars`（type: photo/digital_twin） | `POST /avatar/create_by_image` / `POST /avatar/create_by_video` |
| 声音克隆 | `POST /v3/voices/clone` | `POST /voice/create`（`voice_type` 必填，目前只支持 8） |
| 克隆任务状态 | `GET /v3/avatars/looks/{id}` | `GET /avatar/task`（形象）/ `GET /voice/task`（声音） |
| 删除 | `DELETE /v3/avatars/looks/{id}` | `DELETE /avatar?avatar=` |
| 错误模型 | 401 认 token；其余 200 + body `code` | 同型，`code === 0` 为成功 |
| 免费档 | 有水印 | demo token 有水印 + 30s 限制 |

**飞影 `kind` 参数语义**（`avatar/list`）：`0`=全部（自己的在前）/`1`=自己的/
`2`=公共（不传时默认）。数字人配置区取 **1**——取默认值 2 会把用户刚克隆的形象整批漏掉
（最坏故障形态：克隆成功但下拉里看不见）。

**飞影官方限制**（写进 UI 提示）：
- 声音：mp3/m4a/wav、≤20MB、5 秒～3 分钟；`title` ≤20 字；API 创建上限 200 个
- 视频素材：mp4/mov（h264）、≤500MB、360p～4K、5 秒～30 分钟；**相同 URL 视为同一个数字人**
- 文本：≤10000 字，不支持 html 标签
- 字幕：`st_show`/`st_font_name`/`st_font_size`/`st_primary_color`/`st_outline_color`/`st_width`/`st_height`/`st_pos_x`/`st_pos_y`（本轮未接，留待后续）

## A.4 克隆产物隔离（防串库）

registry 键与样本目录都按 `providerId` 分段：

```
registry 键：avatar-clones:v1:<providerId>:<ownerHash>
样本目录：  userData/avatar-clone-samples/<providerId>/<ownerHash>/<storageId>/
```

**为什么必须分**：两家克隆 id 同形（都是 `avatar` / look id），不分段则
- 用户切到飞影后，列表里混着 HeyGen 的克隆项，选中即失败；
- 同名 storageId 会落在同一目录互相覆盖。

**老数据不迁移**：升级前的 registry 是 3 段目录，新代码**同时放行 3 段与 4 段**
（`isSafeSampleStorage`），让已克隆的用户仍能看到自己的形象；registry 键不含
providerId 的老数据自然失效（用户重新克隆即可）——迁移要把「这条记录属于哪家」
猜出来，而老 registry 里没存这个信息。

## A.5 前端交互（切换服务商）

数字人配置区顶部新增「数字人服务商」下拉：

| 状态 | 表现 |
|---|---|
| 只配了一家 | 下拉仅一项且**禁用**，附常驻提示「当前仅配置了一家数字人服务商，切换需先在模型设置中添加」 |
| 配了多家 | 可切换；切换后**立即**清空已选形象/音色 → invalidate 目录缓存 → 带新 providerId 重拉形象/音色/克隆列表 |
| 一家都没配 | 整区替换为「前往配置」引导 |

**切换时必须清空已选形象/音色**：两家 id 同形，留着旧值等于让用户误选另一家的资源
（选了要到 generate 阶段才炸，错误还指不到真正原因）。

**切换时三份列表都要重拉**：形象目录、音色目录、克隆列表都按 provider 分段，
只重拉一份会出现「新服务商的形象 + 旧服务商的克隆项」这种混搭。

### A.5.1 声音克隆（与形象克隆的关系）

**形象与声音是两条独立链路**（样本类型、存储目录、训练轮询都不同，不合并成一套选择器），
但 UI 位置在 2026-10-23 起收敛到同一面板：

| 链路 | UI 位置 | 样本 | 产物 |
|---|---|---|---|
| 形象克隆 | 数字人配置区 →「管理克隆形象」 | 照片 / 视频 | avatar id（look id） |
| 声音克隆 | 数字人配置区 →「管理克隆形象」→「克隆我的声音」 | 录音（mp3/m4a/wav） | voice id |

> **2026-10-23 修订（change: hifly-voice-subtitle-parity）**：声音克隆入口从配音面板
> （`S2vConfigPanels` 的「音色复制 / 克隆」）**内联进数字人克隆面板**。原因是形象与声音
> 在用户眼里是「一个数字人」的两半，此前的分离让用户克隆了形象后找不到配自己声音的地方。
>
> 内联版是**最小闭环**（上传录音 → 得到可用音色），不带 model 选择、requirements 提示、
> 列表/重命名/删除一整套——那些留给配音面板那个面向 TTS provider 系的完整版。
> 两者共用同一套 IPC 与 service（`tts-voice-clone`，早已完全 provider 化），
> 不另起样本存储（否则会有两份目录、两套 TTL、两套清理）。
>
> **provider/model 由当前数字人服务商决定，不给用户选**：让用户在别处选 TTS provider
> 会造出「HeyGen 的形象配 ElevenLabs 的声音」这种服务商不认的组合。
>
> **状态与形象克隆分开**（`voiceCreating` / `voiceCreateError` / `voiceCreatedName`）：
> 两者可并行操作；共用一个 `creating` 会造出「传照片时不能同时传录音」的假约束。

**两家服务商的声音克隆能力**（`tts-voice-catalog.js` 声明，`USER_CLONE` + `DESKTOP_UPLOAD_CLONE`）：

| 服务商 | 端点 | 约束 |
|---|---|---|
| HeyGen | `POST /v3/voices/clone` | `mode: instant`（单条）/ `professional`（多条） |
| 飞影 HiFly | `POST /api/v2/hifly/voice/create` | `voice_type` 必填且目前只支持 8；mp3/m4a/wav、≤20MB、5 秒～3 分钟；同账号 API 创建上限 200 个 |

**能力探测口径**：克隆面板的能力提示与内联上传区都由 `getTtsVoiceCloneRequirements` IPC 判定
（`type === 'user_clone' && clone.enabled === true`）。**不在渲染端直判**——能力目录在主进程，
且「支持克隆」还要看该 provider 是否已配置可用 Key；探测失败时保守显示「不支持」（不谎称支持）。

**探测时机**：`selectPipeline` 时探一次 + `watch avatarProviderId` 兜底。
后者不可省：`loadS2VProviders` 是异步的，选中数字人流水线那一刻 provider 列表往往还没回来，
探测拿到空值被保守判 false；且「先打开创作页、再切数字人流水线」的用户根本不会触发
`loadS2VProviders` 里那次探测（mounted 时 `isAvatarPipeline` 为 false）。

### A.5.2 字幕（飞影独有）

飞影官方 `create_by_tts` 支持 9 个 `st_*` 字段：

| 字段 | 类型 | 说明 | 默认 |
|---|---|---|---|
| `st_show` | int | 是否显示字幕，1 显示 / 0 不显示 | 不显示 |
| `st_font_name` | string | 字体（抖音美好体、荆南波波黑、Alimama FangYuanTi VF、云峰飞云体、三极泼墨体、快看世界体等） | 服务商默认 |
| `st_font_size` | int | 字号 | 100 |
| `st_primary_color` | string | 文字颜色，`#ff0000` | 服务商默认 |
| `st_outline_color` | string | 文字描边颜色，`#ff0000` | 服务商默认 |
| `st_width` | int | 字幕区域宽度 | 600 |
| `st_height` | int | 字幕区域高度 | 100 |
| `st_pos_x` | int | 字幕区域左上角 X 坐标 | 60 |
| `st_pos_y` | int | 字幕区域左上角 Y 坐标 | 900 |

**分层职责**：

| 层 | 职责 |
|---|---|
| 前端 `AvatarSubtitlePanel.vue` | 只暴露开关 + 字体名/字号/文字色/描边色；`st_width`/`st_height`/`st_pos_x`/`st_pos_y` 用服务商默认（面板有一句说明） |
| 前端 `avatarSubtitlePayload` | 开关关闭时返回 **undefined** 而非 `{show:false}`——请求体不出现 `subtitle` 键，让服务商用它自己的「默认不显示」语义；也让「没碰过字幕」和「显式关掉」在日志里可区分 |
| 主进程 `resolveDigitalHumanInputs` | 提取 `subtitle`（对象字段，不走 `nonEmpty`；只认非数组普通对象） |
| 主进程 `runDigitalHumanGenerate` | `...(inputs.subtitle ? { subtitle: inputs.subtitle } : {})` 透传，**不做字段级校验**（那是 adapter 职责） |
| adapter `buildSubtitleFields` | 字段映射 + 校验：颜色必须 `#rrggbb`、数值必须非负整数，非法即抛错并点名字段（不猜、不静默丢弃） |

**为什么整个面板不渲染而非置灰**：HeyGen 的 `create_by_tts` 没有 `st_*` 字段，
给它看一堆字幕选项等于骗人。判据是 `providerId === 'hifly'` 白名单——字幕是飞影独有契约
字段，官方文档只在他家出现；接第三家时若也支持字幕，把 id 加进去即可。

### A.5.3 多 provider 差异的设计原则（能力驱动统一 UI）

**问题**：数字人换供应商后，支持的功能与可选项差异可能很大。该做统一 UI 还是各做一套？

**结论：统一布局 + 能力驱动显隐。** 三条规则：

1. **核心三要素（形象/音色/文案）永远统一**——这是数字人流水线的最小契约，所有 provider
   都有，布局固定，不随 provider 变化；
2. **可选能力按 capability 显隐**——一个选项只在「至少一家支持」时出现在 UI 里；
   当前 provider 不支持就**整个不渲染**，不是置灰（置灰会让用户以为再点点就能用）；
3. **provider 切换时重算显隐**，已选的不支持项清空（两家 id 同形，留着等于让用户误选
   另一家的资源）。

**不做的两种方案及理由**：

| 方案 | 不做的理由 |
|---|---|
| 每家做一套布局 | N 份维护、N 份测试、N 份视觉基线；provider 间切换时用户要重新适应；且差异主要集中在可选能力，核心流程完全同形 |
| 全堆上去再禁用 | UI 常驻一半灰项；「支不支持」这件事对用户没有信息量——他只想用当前这家能用的东西 |

**已按此原则落地的三处**：字幕面板只对飞影渲染（A.5.2）、声音克隆入口按能力显隐（A.5.1）、
文案全走 provider 名不写死任何一家（`avatarCloneErrProvider` 的 `{name}` 占位符）。

**新增一家 provider 时的检查清单**：
① `model-provider-seeds.js` 加种子 + `capabilities: ['video', 'digital_human']`；
② 写 adapter（与 HeyGen 同名同参，内部做字段映射）；
③ `_base/base.js` 的 `KNOWN_METHODS` 登记其方法；
④ 若支持声音克隆：`tts-voice-catalog.js` 加 `USER_CLONE` 声明；
⑤ 若支持字幕：把 id 加进 `avatarSubtitleSupported` 白名单；
⑥ 上述五步之外，**不改** UI 布局、IPC 契约、流水线编排。


## A.6 数据校验

| 层 | 校验 |
|---|---|
| adapter | `generateVideo` 三要素任一缺失抛 `INVALID_CONFIG` 且不发请求；`createAvatar` 缺素材抛 `INVALID_CONFIG`；`cloneVoice` 缺 `name`/音频源抛 `INVALID_CONFIG` |
| adapter | `getVideoStatus` / `getAvatarStatus` / `getVoiceCloneStatus` 的 `status` 只认 1/2/3/4，**未知值兜底 `processing`**（不谎称完成） |
| adapter | 删除类响应**只认 `code === 0`**，不拿 `data` 真值判（`data` 常为 null，会把成功读成失败） |
| registry | `isSafeSampleStorage`：目录必须 3 或 4 段、前缀精确、每段过 `safeIdentifier`（不许 `..`、绝对路径、空段） |
| service | `_normalizeRequest` 对 `undefined`/`null` 输入回落默认 provider 而不是判负（只读入口常被无参调用） |
| 前端 | provider 下拉只列 `enabled && is_configured && capabilities 含 digital_human` 的项 |

## A.7 已知遗留

- **真实飞影 Token 首跑未执行**：端点与字段来自用户提供的官方文档本地版
  （`<用户本地官方文档副本：飞影数字人 API V2 技术文档.md>`），
  但真实 Token 下的响应形状未经核对，首跑 checklist 见
  `openspec/changes/digital-human-multiprovider/tasks.md` §7.1。
- **声音克隆前端入口未做**：adapter 已就绪（`cloneVoice` / `getVoiceCloneStatus` 已登记
  `KNOWN_METHODS`），但 UI 仍只有形象克隆的照片/视频两个入口。
- **飞影字幕参数未接**：`st_show` 等 9 个字幕字段已在 adapter 契约里预留，UI 未开放。
