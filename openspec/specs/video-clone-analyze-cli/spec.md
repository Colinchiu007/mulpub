# video-clone-analyze-cli Specification

## Purpose
TBD - created by archiving change video-clone-analyze-cli. Update Purpose after archive.
## Requirements
### Requirement: analyze CLI
`scripts/video-clone-analyze.js` SHALL 支持 `node scripts/video-clone-analyze.js <https-url|本地视频路径> [--out <dir>] [--max-duration 1800]`：输入 https 链接（createUrlIngest）或本地文件（createLocalFileIngest）→ createFfprobeAnalyze → 在 outDir 写出 report.json（7 层 CloneReport）与 summary.txt；退出码 0=成功 / 1=业务失败（打印错误码）/ 2=用法错误。

#### Scenario: 本地文件出报告
- **WHEN** 输入本地 mp4 与 --out <dir>
- **THEN** exit 0，report.json 校验 OK、summary.txt 含时长/镜头数

#### Scenario: 用法错误
- **WHEN** 无参数或本地文件不存在
- **THEN** exit 2 并打印用法

### Requirement: 场景-测试映射
以上场景 SHALL 由 `test/scripts/analyze-cli.test.js` 覆盖（本地样例 exit 0 + 产物断言；无参 exit 2；ffmpeg 缺失 skip）。

#### Scenario: 回归断言
- **WHEN** 运行 `node --test test/scripts/analyze-cli.test.js`
- **THEN** 全部用例通过且 exit code 0

