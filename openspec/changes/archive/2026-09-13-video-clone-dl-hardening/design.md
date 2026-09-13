# 设计：下载加固（URL 时长上限 + 探针）

- 时长上限单一执行点：analyze（URL 无元数据时补探后立即校验），本地文件仍由 ingest-local 前置校验；两路共用 maxDurationSec=1800。
- 错误语义：VIDEOCLONE_FILE_TOO_LONG（phase=analyze, retryable=false）→ 用户提示「视频超过 30 分钟上限，请裁剪后重试」。
- 探针：直接调用 adapter（不经 pipeline 校验 https，脚本自身校验），保留下载文件供复测；退出码区分 成功/业务失败/用法错误。
- 可选集成测试：环境变量门控（VC_DL_TEST_URL），默认 skip，CI 零外部依赖。
