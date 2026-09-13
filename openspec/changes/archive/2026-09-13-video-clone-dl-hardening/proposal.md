## Why

下载链路存在两处工程缺口：① URL 输入未执行 30 分钟时长上限（本地文件在 ingest 卡 ≤30min，URL 只卡 500MB，超长视频会进入拆解浪费算力）；② 缺少可复用的真实网络下载探针，平台可达性/反爬分类难以快速验证。

## What Changes

- `analyze-ffprobe.js`：新增 `maxDurationSec`（默认 1800），元数据探测后统一执行时长上限，超限抛 `VIDEOCLONE_FILE_TOO_LONG`（phase=analyze, retryable=false）——URL 下载与本地文件对齐。
- 新增 `scripts/video-clone-dl-probe.js`（`npm run dl:probe -- <url>`）：createUrlIngest → createFfprobeAnalyze → 摘要输出（platform/size/duration/shots/aspect/elapsed），退出码 0/1/2。
- 新增 `test/adapters/dl-probe.test.js`：`VC_DL_TEST_URL` 未设置时 skip（CI 不依赖外部网络）；设置时真实下载+分析断言。
- 测试：analyze 时长上限 3 用例；合计 engine 103（102 pass + 1 skip）。
- 文档：PRD v1.9 §23、CHANGELOG、.quality-gates。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `video-clone-pipeline`: URL 下载时长上限统一执行（≤30min）；可复用真实网络探针与可选集成测试。

## Impact

- 新增：`packages/video-clone-engine/scripts/video-clone-dl-probe.js`、`test/adapters/dl-probe.test.js`、`openspec/changes/video-clone-dl-hardening/`、PRD §23。
- 修改：`src/adapters/analyze-ffprobe.js`（+maxDurationSec）、`package.json`（test script + dl:probe）、PRD v1.8→v1.9。
- 不触碰既有运行时代码（独立流水线原则）。
- 验证：engine 103（102 pass + 1 skip）；真实 B 站探针：时长上限触发 FILE_TOO_LONG、瞬时失败分类 LINK_UNAVAILABLE（retryable）；此前 happy path 84MB/23s 已实证。
