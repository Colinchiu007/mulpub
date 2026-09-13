## ADDED Requirements

### Requirement: URL 下载时长上限
`createFfprobeAnalyze` SHALL 接受 `maxDurationSec`（默认 1800），元数据探测后若 durationSec 超限 SHALL 抛 `VIDEOCLONE_FILE_TOO_LONG`（phase=analyze, retryable=false），与本地文件 ≤30min 对齐。

#### Scenario: 超长 URL 视频
- **WHEN** URL 视频时长 34 分钟
- **THEN** 下载成功后在 analyze 阶段抛 FILE_TOO_LONG，流水线停止（不进入拆解/生成）

#### Scenario: 限制内不拦截
- **WHEN** 时长 ≤ 限制
- **THEN** 正常完成 analyze（元数据/场景检测）

### Requirement: 可复用下载探针
`scripts/video-clone-dl-probe.js` SHALL 支持 `node scripts/video-clone-dl-probe.js <https-url> [--max-duration 1800] [--out <dir>]`：下载 → 分析 → 摘要输出；退出码 0=成功 / 1=业务失败（打印错误码）/ 2=用法错误。`test/adapters/dl-probe.test.js` SHALL 在 `VC_DL_TEST_URL` 未设置时 skip，设置时断言真实下载与分析成功。

#### Scenario: 真实平台探针
- **WHEN** 设置 VC_DL_TEST_URL 并运行测试
- **THEN** 探针 exit 0 且输出含 INGEST_OK / ANALYZE_OK
