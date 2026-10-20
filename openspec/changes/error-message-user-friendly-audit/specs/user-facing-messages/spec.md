# Delta Spec: user-facing-messages

> 能力来源：既有 `openspec/specs/user-facing-messages/spec.md`（2026-08-11 `prompt-user-friendly-i18n`）。
> 本 delta 补齐该规格从未覆盖的一块：**非 IPC 路径的失败透出**——compose 引擎经 `service-bus → stage-executor → pipeline-engine` 落库、前端从历史记录读取的链路。
> 2026-10-20 事故（历史记录失败卡片显示 `Input media exceeds the total size limit`）正是这块缺口的直接后果。

## ADDED Requirements

### Requirement: 主进程业务失败必须返回稳定错误码

`apps/desktop/electron` 下所有**会被前端渲染给用户**的失败返回体（IPC handler 结果、service 方法结果、stage 执行结果）SHALL 同时携带稳定机器可读的 `errorCode` 与可插值的 `messageParams`；`message` 字段仅作诊断保留，MUST NOT 作为用户可见文案的唯一来源。

`errorCode` SHALL 取自该模块导出的封闭常量集合（如 `COMPOSE_ERROR_CODES`），MUST NOT 是临时字符串。
`messageParams` SHALL 只含用户可读的插值值（带单位的体积、1-based 序号、格式化时长），MUST NOT 含裸字节数、绝对路径、堆栈、HTTP 状态码或内部标识符。

#### Scenario: compose 预检输入总量超限

- **WHEN** `Story2VideoComposeEngine.compose()` 的输入媒体累计大小超过 `maxInputTotalBytes`
- **THEN** 返回 `{ code: -1, errorCode: 'COMPOSE_INPUT_SIZE_EXCEEDED', message: <诊断原文>, messageParams: { limitMb: <带单位串>, actualMb: <带单位串>, scene: <1-based 场景号> } }`

#### Scenario: compose 预检场景素材不可读

- **WHEN** 第 N 个场景的 `imagePath`/`videoPath` 解析失败（不存在、越权或不可读）
- **THEN** 返回 `errorCode: 'COMPOSE_SCENE_MEDIA_UNREADABLE'` 且 `messageParams.scene === N`（1-based，MUST NOT 是 0-based 索引）

#### Scenario: compose 预检场景旁白不可读

- **WHEN** 第 N 个场景的 `audioPath` 解析失败
- **THEN** 返回 `errorCode: 'COMPOSE_SCENE_AUDIO_UNREADABLE'` 且 `messageParams.scene === N`

#### Scenario: 无稳定错误码的旧路径不得新增

- **WHEN** 在 `story2video-compose-engine.js` 新增一个会返回给用户的失败分支
- **THEN** 必须复用 `COMPOSE_ERROR_CODES` 中的既有码或在其中新增码，MUST NOT 只返回 `{ code: -1, message: <英文原文> }`
- **AND** 新增码必须同步 `history-utils.js` 的 `COMPOSE_ERROR_KEY_MAP` 与 `locales/story2video/{zh,en}.js` 文案（由 `scripts/check-compose-error-codes.js` 机械校验）

### Requirement: 稳定错误码必须穿透 stage 与落库边界

stage 执行器 SHALL 把下游失败结果中的 `errorCode`/`messageParams` 原样上抛；流水线引擎 SHALL 在运行终态时把它们与 `error` 一起持久化。

`run.error` 与 `stage.error` SHALL 保持字符串契约（恢复门控与阶段摘要读字符串），MUST NOT 改为对象。
新增字段 SHALL 为 additive：旧快照缺省时读取端 MUST NOT 抛错，IPC 快照输出 MUST 用 `null` 而非 `undefined`。

#### Scenario: stage 失败带上错误码

- **WHEN** `stage-executor` 的 COMPOSE 分支收到引擎返回的 `{ code: -1, errorCode, messageParams }`
- **THEN** stage 结果为 `{ success: false, error: <message>, errorCode, messageParams }`

#### Scenario: 运行终态落库错误码

- **WHEN** 流水线以 failed 终态收尾且失败结果带 `errorCode`
- **THEN** `run.error` 为 message 字符串、`run.errorCode` 为该码、`run.errorParams` 为参数对象
- **AND** `getRunSnapshot()` 输出含同名字段（无码时为 `null`）

#### Scenario: 断点快照保留错误码

- **WHEN** 编排模式运行失败并写入 run-state 快照
- **THEN** 快照含 `errorCode` 与 `errorParams` 字段（无码时为 `null`），`version` 保持 1

#### Scenario: 字符串 error 的旧调用方不回归

- **WHEN** `_finalizeRun(run, 'failed', 'legacy string error')` 被调用
- **THEN** `run.error === 'legacy string error'`，`run.errorCode`/`run.errorParams` 为 `undefined`

### Requirement: 渲染端必须同时识别稳定错误码与存量原文

用户可见失败的归一化 SHALL 按固定优先级取值：**① 稳定 `errorCode`（显式映射）→ ② 已知原文模式 → ③ 调用方兜底文案**。

第 ② 级 MUST NOT 使用「长度 < 120 且无技术标记即透传原文」这类启发式作为唯一判据——英文技术文本（如 `Input media exceeds the total size limit`）会被误判为自然语言而直出。

存量历史数据（只有英文 `run.error`、无 `errorCode`）SHALL 经第 ② 级归一化为同一自然语言文案。

#### Scenario: 历史卡片按稳定码渲染

- **WHEN** 历史记录项的 `errorCode === 'COMPOSE_INPUT_SIZE_EXCEEDED'` 且 `errorParams = { limitMb: '512MB', actualMb: '780MB' }`
- **THEN** 失败原因显示含 `512MB` 与 `780MB` 的自然语言文案（zh/en 各自本地化）
- **AND** 文案 MUST NOT 含 `Input media exceeds`、`total size limit` 或 `story2video.compose_input_size_exceeded`

#### Scenario: 存量英文原文同样归一化

- **WHEN** 历史记录项只有 `error: 'Input media exceeds the total size limit'`（无 `errorCode`）
- **THEN** 归一化到同一 messageKey，卡片 MUST NOT 显示英文原文

#### Scenario: 参数缺失不得渲染空占位符

- **WHEN** `messageParams` 缺 `scene` 或缺 `limitMb`/`actualMb`
- **THEN** 用 locale 中的兜底标签（`labels.currentScene` / `labels.unknownSize`）填充
- **AND** 最终文案 MUST NOT 含 `{scene}`、`{limitMb}`、`{actualMb}` 等未解析占位符

#### Scenario: 错误码到 locale key 必须显式映射

- **WHEN** 渲染端把 `errorCode` 转换为 locale key
- **THEN** 必须查 `COMPOSE_ERROR_KEY_MAP` 显式映射表，MUST NOT 用字符串替换/大小写转换推导 key
- **AND** 映射表与主进程 `COMPOSE_ERROR_CODES` 的一一对应关系由 `scripts/check-compose-error-codes.js` 机械校验

### Requirement: 归一化判定顺序不得被泛化规则抢先

compose 预检类模式 SHALL 在归一化链中**早于**泛化 compose 规则（`COMPOSE_STAGE_PATTERN`、`compose_failed`）与「短自然语言直出」分支求值。

#### Scenario: 预检超限不被判成合成超时或合成失败

- **WHEN** 原文为 `Input media exceeds the total size limit`
- **THEN** 归一化结果为 `compose_input_size_exceeded`
- **AND** MUST NOT 是 `compose_timeout`、`compose_failed` 或透传原文

#### Scenario: 既有合成超时/时长规则不回归

- **WHEN** 原文为 `视频合成超时` 或 `视频内容超过 30 分钟上限`
- **THEN** 仍分别归一化为 `compose_timeout` 与 `compose_duration_exceeded`
