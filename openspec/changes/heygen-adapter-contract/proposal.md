# Proposal: heygen-adapter-contract（HeyGen Adapter 对齐官方 v2 契约）

## Why

`avatar-spokesperson` 数字人流水线已于 #3969 接通 HeyGen（`digital-human-stages.js` 透传 `character/voice/script`），但它调用的 `apps/desktop/electron/services/adapters/heygen.js` 从未经过真实调用验证：

1. **请求体形状不符合官方契约**：`video_inputs[0] = { character:'<id>', voice:'<id>', script:'<text>' }`（扁平静态字符串）；官方 v2 要求 `character: { type:'avatar', avatar_id, avatar_style }`、`voice: { type:'text', input_text, voice_id }`，顶层带 `dimension`。
2. **轮询端点不存在**：adapter 用 `GET /v2/video/status?id=`；官方是 `GET /v1/video_status.get?video_id=`（与 `/v2` 提交不同 API 根）。
3. **认证头不一致**：adapter 只发 `Authorization: Bearer`；官方文档使用 `X-Api-Key`。

后果：即使账号与 Key 正确，首次真实调用也会在提交阶段 400，或提交成功后卡在轮询直到 10 分钟超时。

### 逃逸分析（QM-5）

| 层级 | 逃逸原因 |
|---|---|
| 单元测试 | `heygen.test.js` 断言的是**自家实现的形状**（`expect(body.video_inputs[0].character).toBe('anna')`），把 bug 写成了期望值 |
| 契约测试 | 没有「按官方文档 fixture 断言请求体」的 adapter 契约层 |
| E2E | `ipc-mock.js` 的 heygen fixture 直接返回成功，跨过 HTTP 契约 |
| 验收 | #3969 的 A1-A8 只要求「callAdapter 实参含三要素」，没有一条落在 adapter 的 HTTP 形状上 |
| 代码审查 | adapter 由 `473609440` 一次性批量生成，review 按文件存在性通过，未逐字段对照文档 |

## What Changes

### ADDED Capabilities

- `heygen-adapter-contract`：HeyGen 数字人 adapter 的 HTTP 契约。
  - 提交：`POST {baseUrl}/video/generate`（默认 baseUrl `https://api.heygen.com/v2`），body 为
    `{ video_inputs: [{ character: { type:'avatar', avatar_id, avatar_style }, voice: { type:'text', input_text, voice_id } }], dimension: { width, height } }`；
    上游扁平字段映射：`character→avatar_id`、`voice→voice_id`、`script→input_text`，`avatar_style` 缺省 `normal`，`dimension` 缺省 `1280x720`（调用方可传 `width/height` 覆盖）。
  - 轮询：`GET {apiRoot}/v1/video_status.get?video_id=<id>`，`apiRoot` 由 baseUrl 去掉版本段得到。
  - 认证：单一 `X-Api-Key` 头（不发送 `Authorization`）。
  - 状态映射：`waiting/pending/processing→processing`，`completed/success→completed`，`failed/error/cancelled→failed`；HTTP 200 但业务 `code` 既不是 `100`（官方成功码）也不是 `0`（网关归一码）⇒ `PROVIDER_ERROR`。
  - 输入校验：`width/height` 非正数或非数字 ⇒ 回落 `1280x720`；`avatarStyle` 只接受 `normal`/`circle`，其它值回落 `normal`（不把拼错值发给上游）。
  - 轮询策略：adapter 只提供单次 `getVideoStatus`，**不内置轮询循环**；10 分钟上限、10 秒间隔与终止态判定在调用方 `digital-human-stages.js` 已有实现，本次不改。
  - `testConnection`：复用已实现的 `GET {baseUrl}/avatars`（真实目录、免费、同时验证读权限），与提交共用同一 `_headers()`（`X-Api-Key`），不新增 `/v1/me` 之类未验证端点。
  - 日志安全：adapter 不打印请求头；`model-provider-manager` 只记录 `providerId.method`，API Key 不出现在日志或错误消息里。

### MODIFIED Requirements

- 无。`avatar-spokesperson` 流水线契约与 IPC 面不变；`digital-human-stages.js` 不改。

## 明确不做（防止范围蔓延）

- 不引入 `HEYGEN_AUTH_MODE` 之类运行时开关；本轮就是单一 `X-Api-Key`，无双认证头路径需要门控。
- 不引入 `/v1/me`、`/v1/me` 类「假设端点」；`testConnection` 用已经实现并有测试的 `/avatars`。
- 不新增 fixture 文件与 hash/轮换机制；官方契约形状直接写在 `heygen.test.js` 的断言里。
- 不扩错误码分类体系（`invalid_request` / `rate_limited` 细分）；本轮只处理「业务 code 非成功 ⇒ PROVIDER_ERROR」，HTTP 层错误沿用既有 `fromHttpStatus`。
- 不改 Python 后端（`packages/python-backend` 的 HeyGen 走 `/v1/workflows/executions`，是另一条链路）。

## Impact

- **改动文件**：`apps/desktop/electron/services/adapters/heygen.js`、`apps/desktop/electron/services/adapters/heygen.test.js`。
- **验证边界（如实声明）**：无真实 Key，本轮只做契约级正确性与单测；真实账号首跑仍待 Key 到位后执行（`tasks.md` T4 给出可执行判据）。
