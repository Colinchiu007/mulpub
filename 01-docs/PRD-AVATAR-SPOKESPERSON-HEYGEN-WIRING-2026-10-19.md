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
2. 不做自定义数字人（上传照片生成形象）。
3. 不做多数字人同屏/对话视频。
4. 不做数字人视频的字幕烧录（复用 render 阶段现有合并，不新增字幕能力）。
5. 不改 `talking-head` / 其它流水线。
