## Purpose
提示词评测 provider 密钥与图片生成契约：密钥加密/探测/删除 fail-closed，MiniMax image-01 走专有生成端点且业务失败不静默降级。

## ADDED Requirements

### Requirement: MiniMax 图片生成走专有 /image_generation 契约
图片生成 SHALL 按 provider 分支调用：`minimax-image`（或模型名以 `image-01` 开头）SHALL 请求 `POST {base}/image_generation`，请求体为 `model/prompt/n/aspect_ratio/response_format=base64`（不得携带 OpenAI 兼容 `size`/`b64_json` 字段），`n` SHALL 限制 1-9（越界返回可操作错误，不得透传非法请求）；响应 SHALL 解析 `response_format=base64` 时的 `data.image_base64`（纯 base64，兼容 `data:image/...;base64,` 前缀）与 `response_format=url` 时的 `data.image_urls`（下载落盘）；`base_resp.status_code` 非空且非 0 SHALL 判定生成业务失败并 fail closed（不重试、不静默降级）；返回图片数不等于请求 `n` SHALL fail closed（覆盖 `metadata.failed_count > 0`）。OpenAI 兼容 provider（如 flux）SHALL 保持 `{base}/images/generations` 与 `size`/`b64_json` 契约不变，且不受 `base_resp` 字段影响。

#### Scenario: MiniMax 生成使用专有端点
- **WHEN** 使用已保存的 minimax-image/image-01 密钥触发【生成图片并评估】
- **THEN** 请求发送到 `{base}/image_generation`，payload 无 `size` 且 `response_format=base64`，`data.image_base64` 解码落盘并通过魔数校验

#### Scenario: MiniMax 业务失败不静默降级
- **WHEN** 生成接口返回 HTTP 200 但 `base_resp.status_code != 0`（如 1001 invalid params）
- **THEN** 生成失败并携带业务状态码与消息，不进入重试，不返回空/占位结果

#### Scenario: 单次数量越界 fail closed
- **WHEN** 请求 `n` 不在 1-9 范围（前端允许 1-20，MiniMax 仅 1-9）
- **THEN** 生成失败并提示「MiniMax image-01 单次生成数量必须是 1-9」，不向 provider 发送非法请求

#### Scenario: 生成数量不足 fail closed
- **WHEN** MiniMax 返回图片数少于请求 `n`（如 `metadata.failed_count > 0`）
- **THEN** 生成失败并提示实际数量，避免评估阶段图片数与维度权重错位

#### Scenario: OpenAI 兼容 provider 行为不变
- **WHEN** 使用 flux 等 OpenAI 兼容 provider 生成图片
- **THEN** 仍请求 `{base}/images/generations`，payload 含 `size=1024x1024` 与 `response_format=b64_json`，响应含 `base_resp` 字段不被误拦截
