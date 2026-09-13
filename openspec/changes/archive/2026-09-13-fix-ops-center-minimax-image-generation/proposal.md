## Why

运营后台「提示词评测」点击【生成图片并评估】报错：`生成失败：generation: 生成服务返回 404: 404 page not found`。根因：`prompt_eval_generation_service.generate_images()` 对 `minimax-image / image-01` 走 OpenAI 兼容端点 `{base}/images/generations`，而 MiniMax 图片生成专有端点是 `POST {base}/image_generation`（官方契约 platform.minimax.io/docs/api-reference/image-generation-t2i），因此 404。

## What Changes

- `prompt_eval_generation_service.py` 按 provider/model 分支：
  - `minimax-image`（或模型名 `image-01` 前缀）→ 端点 `{base}/image_generation`；
  - 请求体移除 `size`，使用 MiniMax 契约：`model/prompt/n/aspect_ratio/response_format=base64`（`n` 上限 9，超限 fail closed）；
  - 响应解析：`response_format=base64` → `data.image_base64`（base64 串，兼容 `data:image/...;base64,` 前缀）；`response_format=url` → `data.image_urls`（复用下载落盘分支）；
  - 业务失败 `base_resp.status_code != 0` → `GenerationError` fail closed（不重试）。
- flux 等 OpenAI 兼容 provider 走 `/images/generations` 分支保持不变。
- 回归测试：MiniMax 端点/payload 断言、base64 落盘、URL 下载、业务失败 fail closed、`n>9` 拒绝、flux 不变。

## Capabilities

### New Capabilities

（无新增能力）

### Modified Capabilities

- `ops-center-prompt-eval`: 图片生成契约——MiniMax image-01 走专有 `/image_generation`（base64 返回 + base_resp 业务失败 fail closed），OpenAI 兼容 provider 不变。

## Impact

- ops-center/backend/services/prompt_eval_generation_service.py（端点/payload/响应解析/业务失败）
- ops-center/backend/tests/test_prompt_eval_services.py（回归用例）
- 不涉及数据库、不涉及密钥存储格式、不改变 flux 行为；真实生图验证会消耗用户 MiniMax 额度（由用户确认后执行）。
