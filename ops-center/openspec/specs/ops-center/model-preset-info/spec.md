# ops-center/model-preset-info Specification

## Purpose
运营后台预设模型设置支持更多运营信息字段（获取模型ID URL/每分钟连接次数/5小时限额）、默认模型下拉与获取模型ID、多模态分能力技术文档URL。
## Requirements
### Requirement: 模型更多信息字段
模型预设必须支持 models_url（获取模型ID URL）、rate_per_minute（每分钟连接次数）、limit_per_5h（5小时限额次数），并复用 base_url 作为端口URL；允许为空，按类型校验。

#### Scenario: 保存合法字段
- **WHEN** admin 提交 models_url=https://...、rate_per_minute=30、limit_per_5h=1000
- **THEN** 保存成功且响应包含这些字段

#### Scenario: 空值允许
- **WHEN** models_url/rate_per_minute/limit_per_5h 均留空
- **THEN** 保存成功，字段为 null/空串

#### Scenario: 非法 URL
- **WHEN** models_url 为 ftp://... 或非法字符串
- **THEN** 返回 400 且错误信息包含字段名

#### Scenario: 非法数字
- **WHEN** rate_per_minute 为 -1、0、'abc' 或超上限
- **THEN** 返回 400 且错误信息明确

### Requirement: 默认模型下拉与获取模型ID
默认模型 ID 必须可从模型列表下拉选择；「获取模型」按钮从 models_url 拉取全部支持的模型ID并回写模型列表。

#### Scenario: 默认模型必须在列表中
- **WHEN** models 非空且 default_model 非空但不在 models
- **THEN** 返回 400「默认模型 ID 必须在模型列表中」

#### Scenario: 获取模型成功
- **WHEN** admin 点击获取模型且 models_url 返回合法 JSON 模型列表
- **THEN** models 被更新，default_model 若不在新列表则清空，响应返回新列表

#### Scenario: 获取模型失败
- **WHEN** models_url 不可达/超时/非 JSON/被 SSRF 规则拒绝
- **THEN** 返回 400/502 且不修改已有 models；SSRF 拒绝文案区分真实私网（「解析到私网/保留地址」）与 fake-IP 代理基准段 198.18.0.0/15（明确提示设 OPS_ALLOW_PROXY_BENCHMARK_IPS=true 或关闭代理 fake-IP）

### Requirement: 多模态分能力技术文档URL
多模态模型必须按 7 类能力显示技术文档 URL 输入框：文字推理接口(llm)、图片生成(image)、视频生成(video)、TTS语音生成(tts)、TTS语音克隆(voice_clone)、语音识别(speech_recognition)、视觉识别(vision)。

#### Scenario: 多模态表单显示
- **WHEN** 编辑多模态预设
- **THEN** 表单显示 7 个固定能力文档 URL 输入框（label 与能力对应）

#### Scenario: 保存能力文档
- **WHEN** 填写某能力文档 URL 并保存
- **THEN** capability_doc_links 对应键存为包含该 URL 的数组

#### Scenario: 非法能力键
- **WHEN** capability_doc_links 含非 7 能力之外键
- **THEN** 返回 400（未知能力文档键）

