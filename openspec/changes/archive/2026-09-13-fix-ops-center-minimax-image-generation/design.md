## 设计

### 现状
`prompt_eval_generation_service.generate_images()`（services/prompt_eval_generation_service.py:129）：
- 所有 provider 固定 `POST {base}/images/generations`（OpenAI 兼容）；
- 请求体 `build_image_payload()` 固定含 `size: "1024x1024"` + `response_format: "b64_json"`；
- 响应解析 `_extract_images()` 只认 `data[].b64_json` / `data[].url`。

问题：MiniMax image-01 无 `/images/generations` 端点（404），且请求体/响应结构与 OpenAI 兼容不一致。

### 修复
1. `_is_minimax(provider, model)`：`provider == "minimax-image"` 或 `model` 以 `image-01` 开头。
2. `build_image_payload()` 分支：
   - MiniMax：`{"model", "prompt", "n", "aspect_ratio", "response_format": "base64"}`，无 `size`；`n > 9` 抛 `GenerationError`（前端允许 1-20，MiniMax 仅 1-9，fail closed）。
   - 其余：保持 `size=1024x1024 + b64_json` 不变。
3. 端点：MiniMax → `{base}/image_generation`；其余 → `{base}/images/generations`。
4. 响应处理：
   - `body.base_resp.status_code`（整数，容错字符串）非空且非 0 → `GenerationError("生成服务返回业务失败 {code}: {msg}")`（业务失败不进入重试）。
   - MiniMax 解析 `_extract_minimax_images()`：`response_format=base64` → `data.image_base64`（纯 base64，兼容 `data:image/...;base64,` 前缀）；`response_format=url` → `data.image_urls`（复用 `b"url:"` 下载分支）；两者都兼容。解码失败跳过（空结果 fail closed）。
   - 数量校验：MiniMax 返回图片数 != 请求 `n` → `GenerationError("生成图片数量不符：期望 N 张，实际 M 张")` fail closed（覆盖 `metadata.failed_count > 0` 与超量场景）。

### 测试
`tests/test_prompt_eval_services.py`：
- `test_minimax_payload_contract`：MiniMax payload 无 size、response_format=base64、n=10 抛错；flux payload 含 size+b64_json。
- `test_minimax_generate_uses_image_generation_endpoint`：请求 URL=`.../v1/image_generation`，base64 响应（含 data URL 前缀）落盘且魔数校验通过。
- `test_minimax_business_failure_fail_closed`：`base_resp.status_code=1001` → GenerationError，不重试。
- `test_minimax_url_result_downloads`：image_urls 含 URL → 下载落盘。
- `test_flux_still_uses_openai_images_generations`：flux 仍走 `/images/generations` + size/b64_json。
- 既有 `test_generate_saves_valid_image_and_retries_429` / `test_generate_empty_or_invalid_fails` 改用 MiniMax 真实响应形状。
