## ADDED Requirements

### Requirement: 去发布标题由 AI 按爆款元素生成并带三级降级

热门选题页「生成视频」run 成功后，用户点击弹窗 footer【去发布】时，系统 SHALL 通过默认文字推理模型生成一个发布用标题，并在模型不可用或生成失败时逐级降级，最终标题 SHALL NOT 为空（原始选题为空除外）。

标题生成 SHALL 与文案改写分离：改写 prompt MUST NOT 附带标题生成指令，标题 MUST 由一次独立的 LLM 调用产出。

#### Scenario: 已配置默认文字推理模型，AI 标题生成成功

- **WHEN** 用户在热门选题页对某条选题执行【生成视频】，run 进入 `completed` 且取得成片路径
- **AND** 用户在「模型设置」中已配置默认文字推理模型（含可用模型与 API Key）
- **THEN** 点击【去发布】SHALL 先调用 `ai:generate-gen-video-title`（参数含原始选题文本与改写正文摘要）
- **AND** 跳转 query SHALL 携带 `title` = 清洗后的 AI 标题（≤100 字硬限）、`title_source='ai'`
- **AND** query SHALL NOT 携带 `title_reason`
- **AND** 标题 SHALL NOT 是改写正文的前 N 字切片

#### Scenario: 未配置默认文字推理模型时不发起 LLM 调用

- **WHEN** 用户未在「模型设置」中配置默认文字推理模型（`getDefault('llm')` 返回 null，或缺可用模型，或缺 API Key）
- **THEN** 系统 SHALL NOT 调用 LLM
- **AND** 跳转 query SHALL 携带 `title` = 原始选题文本（截断至上限）、`title_source='topic'`、`title_reason='no-model'`

#### Scenario: AI 标题生成失败或返回空时降级为原始选题

- **WHEN** LLM 调用抛错、超时、返回非 0 code、返回空 content，或输出经清洗后为空（例如仅含 `<think>` 思维链）
- **THEN** 跳转 query SHALL 携带 `title` = 原始选题文本（截断至上限）、`title_source='topic'`、`title_reason='failed'`
- **AND** 跳转 SHALL 仍然发生（标题降级不阻断发布）

#### Scenario: 原始选题文本为空时不注入标题

- **WHEN** 本次编排的选题文本 trim 后为空
- **THEN** 跳转 query SHALL NOT 携带 `title`、`title_source`、`title_reason`
- **AND** 系统 SHALL NOT 调用 LLM

#### Scenario: run-only（非 S2V 流水线）同样获得标题

- **WHEN** 用户选择的流水线不是 `story2video-compose`，run 终态 context 无 `story2videoProject`
- **THEN** 跳转 query SHALL 携带 `type='video'`、`video_path`、`title` 与 `title_source`
- **AND** query SHALL NOT 携带 `content` 或 `tags`（既有 run-only 语义不变）

#### Scenario: 重复点击不产生第二次 LLM 调用

- **WHEN** 用户点击【去发布】后，在标题生成完成前再次点击该按钮
- **THEN** 系统 SHALL NOT 发起第二次 `ai:generate-gen-video-title` 调用
- **AND** 系统 SHALL NOT 发生第二次路由跳转

### Requirement: LLM 标题输出按防御性规则清洗

LLM 返回的原始内容 SHALL 经统一的清洗函数处理后才可作为标题。清洗 MUST 至少覆盖：推理思维链（闭合与未闭合形态）、markdown 代码围栏、多行输出取首个非空行、成对引号/书名号包裹、列表编号前缀、「标题：」类前缀标签、尾部标点、控制字符、Unicode 码点长度截断。

清洗后为空的输出 SHALL 视为生成失败（触发降级），MUST NOT 把原始输出或空白字符当作标题。

#### Scenario: 推理模型返回思维链 + 标题

- **WHEN** LLM 返回 `意识和\n```\n外婆的灶台\n``` `
- **THEN** 清洗结果 SHALL 为 `外婆的灶台`

#### Scenario: 未闭合思维链尾部

- **WHEN** LLM 返回 `意识\n外婆的灶台`（`<think>` 无闭合标签，因 `finish_reason=length` 截断）
- **THEN** 清洗结果 SHALL 为 `外婆的灶台`

#### Scenario: 输出多行

- **WHEN** LLM 返回 `外婆的灶台\n第二个候选\n第三个候选`
- **THEN** 清洗结果 SHALL 为 `外婆的灶台`（仅首个非空行）

#### Scenario: 输出仅为思维链或空白

- **WHEN** LLM 返回 `意识和` 或纯空白
- **THEN** 清洗结果 SHALL 为空串，调用方据此降级为原始选题

#### Scenario: 长度按 Unicode 码点截断

- **WHEN** AI 标题含 emoji 或中文且超过上限
- **THEN** 截断 SHALL 按 Unicode 码点计数，MUST NOT 产生半个代理对（孤立代理）

### Requirement: 标题来源对用户可见

发布页在视频模式装载带 `title_source` 的 query 时，SHALL 在标题输入框下方显示来源提示，区分「AI 生成」「未配置文字推理模型」「AI 标题生成失败」三种状态。无 `title_source` 时 SHALL NOT 渲染该提示。

#### Scenario: AI 标题来源提示

- **WHEN** 发布页以 `type=video` 且 `title_source=ai` 装载
- **THEN** 标题输入框下方 SHALL 显示「标题由 AI 按爆款元素生成」

#### Scenario: 未配置模型来源提示

- **WHEN** 发布页以 `title_source=topic` 且 `title_reason=no-model` 装载
- **THEN** 标题输入框下方 SHALL 显示「未配置文字推理模型，标题已使用原始选题」

#### Scenario: 生成失败来源提示

- **WHEN** 发布页以 `title_source=topic` 且 `title_reason=failed` 装载
- **THEN** 标题输入框下方 SHALL 显示「AI 标题生成失败，标题已使用原始选题」

#### Scenario: 无来源信息时不渲染

- **WHEN** 发布页装载的 query 不含 `title_source`，或当前不是视频模式
- **THEN** SHALL NOT 渲染任何标题来源提示节点

### Requirement: 用户可见文案成对写入 locales

新增用户可见文案 SHALL 成对写入 `apps/desktop/src/locales/hot-topics/{zh,en}.js` 与 `apps/desktop/src/locales/publish-page/{zh,en}.js`（CI Gate 7）；渲染端 `src/` 非 locales 文件 SHALL NOT 新增硬编码中文字符串（CJK 基线扫描）；产品名词 SHALL 在 `01-docs/i18n-glossary.md` 登记。

## API 契约

### IPC：`ai:generate-gen-video-title`

| 项 | 值 |
| --- | --- |
| 通道 | `ai:generate-gen-video-title` |
| 参数 | `{ topicText: string, bodyText: string, max?: number }` |
| 成功返回 | `{ code: 0, data: { success: true, title: string } }` |
| 无模型返回 | `{ code: 0, data: { success: false, reason: 'no-model' } }` |
| LLM 失败返回 | `{ code: 0, data: { success: false, reason: 'failed', message: string } }` |
| 参数非法 | `{ code: EC.VALIDATION_ERROR, message: string }` |
| sender 校验 | `withSenderCheck` |
| 模型解析 | 主进程 `aiGenerator._modelProviderManager.getDefault('llm')` + `resolveProviderDefaultModel` |
| API Key | 只在主进程边界读取，不出渲染层、不落日志 |
| 推理模型 | `max_tokens` 按 `isReasoningLlmModel` 放大（与 `videogen-stages.callDefaultLlm` 一致） |

### 路由 query 扩展（`/publish`）

| 键 | 值域 | 出现条件 |
| --- | --- | --- |
| `title` | string（encodeURIComponent） | 决策结果标题非空 |
| `title_source` | `ai` \| `topic` | `title` 非空 |
| `title_reason` | `no-model` \| `failed` | `title_source === 'topic'` |

## 测试要求

- `apps/desktop/src/features/publish/gen-video-title.test.js` SHALL 覆盖：思维链两种形态、围栏、多行、成对/单边引号、编号、前缀标签、尾部标点、码点截断、空结果、降级链六格（none/topic-no-model/ai/topic-failed/非字符串/超长）、prompt 构造（含爆款元素要求与摘要截断）。
- `apps/desktop/electron/ipc-handlers/gen-video-title.test.js` SHALL 覆盖：正常返回、无默认模型、无可用模型、LLM 抛错、空 content、参数非法、空 topicText、max 非法回退、推理模型预算放大。
- `apps/desktop/src/views/HotTopics.test.js` SHALL 覆盖：AI 成功 / 无模型 / LLM 空 / run-only 带标题 / 标题取自原始选题而非改写文案 / 重复点击幂等 / 完成态静态说明；既有 3 例仍全绿。
- `apps/desktop/src/views/Publish.test.js` SHALL 覆盖：三态来源提示、无 `title_source` 不渲染、非视频模式不渲染。
