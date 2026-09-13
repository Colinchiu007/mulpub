# Ops Center Prompt Evaluation Specification

## Purpose
Define the security and error-handling contract for prompt-evaluation provider keys in the Ops Center backend.
## Requirements
### Requirement: Provider-key encryption uses the loaded Ops Center configuration
The prompt-evaluation provider-key API SHALL obtain its encryption secret from the loaded Ops Center settings instance. It SHALL NOT depend on the dotenv value being copied into the process environment, and it SHALL NOT create or replace the configured secret while saving a provider key.

#### Scenario: dotenv-loaded secret is not exported to process environment
- **WHEN** OPS_SECRET_KEY is loaded from the backend .env file but is absent from os.environ
- **THEN** an administrator can save a valid prompt-evaluation provider key and receives HTTP 200

### Requirement: Invalid provider-key encryption configuration returns an actionable client error
The provider-key API SHALL preserve fail-closed encryption validation. A missing or insecure OPS_SECRET_KEY SHALL return HTTP 400 with a non-secret error that identifies the configuration requirement; unexpected persistence failures SHALL remain server errors.

#### Scenario: missing encryption secret
- **WHEN** an administrator saves a provider key while the loaded OPS_SECRET_KEY is missing or insecure
- **THEN** the API returns HTTP 400 and its detail identifies OPS_SECRET_KEY

### Requirement: 连通性探测回退覆盖 image/多模态 provider
provider 密钥连通性探测 SHALL 先 `POST {base}/chat/completions`（max_tokens=1）；当返回 404/405，或返回 400 且错误体命中模型关键字（unknown model / invalid model 等）时，SHALL 回退 `GET {base}/models`，`/models` 可达（<400）即判定连通成功并注明「/models 可达」。400 但错误体非模型类（参数非法等）、401/403/429 及其他 5xx SHALL 保持直接失败不回退；两个端点均不可达时 SHALL 返回双状态码并提示改用真实生成/评估验证。

#### Scenario: 图片模型 chat 探测 400 回退成功
- **WHEN** 保存 MiniMax 图片模型密钥（如 image-01），`chat/completions` 返回 400（unknown model）而 `GET /models` 返回 200
- **THEN** 测试连通返回成功，detail 含「/models 可达」

#### Scenario: 鉴权失败不因回退而放行
- **WHEN** `chat/completions` 返回 401（密钥无效）
- **THEN** 测试连通直接失败并携带 401 状态码，不尝试 /models 回退

#### Scenario: 双端点均不可达
- **WHEN** `chat/completions` 400 且 `GET /models` 也失败（如 404）
- **THEN** 测试连通失败，错误含两个状态码并提示使用真实生成/评估验证

### Requirement: 模型密钥可被管理员删除
管理员 SHALL 能删除已保存的 provider 密钥条目；`DELETE /api/v1/prompt-eval/providers/{key_id}` 按 id 物理删除。非 admin 返回 403；id 不存在返回 404；删除后列表与 LLM/视觉密钥回退查找均不再返回该条目；同一 provider+model 可重新保存。

#### Scenario: 管理员删除密钥
- **WHEN** admin 调用 `DELETE /providers/{key_id}` 删除已保存的 minimax-llm 密钥
- **THEN** 返回成功，列表不再包含该项，`get_llm_key` 不再返回该密钥

#### Scenario: 权限与存在性校验
- **WHEN** 非 admin 调用删除，或删除不存在的 key_id
- **THEN** 分别返回 403 / 404，数据不变

#### Scenario: 删除后可重建
- **WHEN** 删除某 provider+model 后再次保存相同 provider+model
- **THEN** 新条目正常创建（唯一约束不冲突）

### Requirement: 模型密钥「设为默认」按用途分组唯一
provider 密钥 SHALL 支持「设为默认」标记（`is_default`）；同一用途分组内至多一个密钥为默认。用途分组 SHALL 定义为：LLM=`minimax-llm`；视觉=`minimax-vision`、`opencode-go-vision`；生图=`minimax-image`、`flux`、`hunyuan`。管理员通过 `PUT /api/v1/prompt-eval/providers/{key_id}/default` 设置默认，服务端在同一事务内将同分组其他密钥默认标记清 0。

#### Scenario: 设置默认并同分组唯一
- **WHEN** admin 对视觉分组某密钥（如 minimax-vision / MiniMax-M3）调用 `PUT /providers/{key_id}/default`
- **THEN** 返回成功；该密钥 `is_default=1`；同分组其他密钥 `is_default=0`；列表仅该密钥显示默认标记

#### Scenario: 跨分组默认互不影响
- **WHEN** admin 设置生图分组某密钥为默认，而 LLM/视觉分组已有默认
- **THEN** 仅生图分组内默认标记被重排，LLM/视觉分组的默认保持原样

#### Scenario: 权限与存在性校验
- **WHEN** 非 admin 调用设为默认，或 key_id 不存在
- **THEN** 分别返回 403 / 404，数据不变

### Requirement: 默认键的有效性约束
SHALL 仅允许启用中的密钥被设为默认：对禁用（`enabled=0`）密钥设置默认 SHALL 返回 HTTP 400 并给出可操作提示。禁用或删除当前默认键时，其默认标记 SHALL 被清空且不自动转移到其他密钥（选择链路回退到「最新启用」）。

#### Scenario: 禁用密钥拒绝设默认
- **WHEN** admin 对 `enabled=0` 的密钥调用设为默认
- **THEN** 返回 HTTP 400，提示先启用，默认标记不变

#### Scenario: 禁用/删除默认键后清空
- **WHEN** 当前默认键被禁用（编辑 enabled=0）或被删除
- **THEN** 该键默认标记清空；同分组其他密钥默认标记保持，选择链路回退最新启用

### Requirement: 默认键被选择链路优先使用
LLM（中英对照优化/翻译）与视觉评估的选择链路 SHALL 优先使用其分组内 `is_default=1` 的启用密钥；分组内无默认时回退到现有「最新启用」逻辑。新保存的密钥在其分组尚无默认时 SHALL 自动成为默认。

#### Scenario: LLM 选择优先默认
- **WHEN** minimax-llm 分组存在多个启用密钥且其中一个 `is_default=1`
- **THEN** `get_llm_key` 返回默认密钥（而非最新更新的非默认密钥）

#### Scenario: 视觉选择优先默认
- **WHEN** 视觉分组存在默认密钥（无论 minimax-vision 或 opencode-go-vision）
- **THEN** `get_vision_key` 返回该默认密钥

#### Scenario: 新键自动默认
- **WHEN** admin 保存一个新 provider+model 密钥，且其分组尚无任何默认
- **THEN** 新密钥自动 `is_default=1`，列表可见默认标记

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

