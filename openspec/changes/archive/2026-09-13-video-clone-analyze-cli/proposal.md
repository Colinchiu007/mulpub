## Why

分析能力已具备（ingest + analyze），但缺少「一条命令出报告」的用户入口：手动写胶水脚本才能拿到 report.json，不利于测试平台与快速验收。

## What Changes

- 新增 `packages/video-clone-engine/scripts/video-clone-analyze.js`（npm run analyze -w @multi-publish/video-clone-engine -- <url|本地文件> [--out <dir>] [--max-duration 1800]）：
  输入 https 链接或本地视频 → ingest（URL 下载/本地校验）→ analyze（元数据/时长上限/场景检测）→ 输出 report.json（7 层 CloneReport）+ summary.txt（人类可读摘要），URL 输入保留下载媒体；
  退出码 0=成功 / 1=业务失败（打印错误码）/ 2=用法错误。
- 测试：test/scripts/analyze-cli.test.js（本地样例 exit 0 + 产物断言 + 无参 exit 2，ffmpeg 缺失 skip）。
- 文档：PRD v1.10 §24、CHANGELOG、.quality-gates。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `video-clone-pipeline`: 新增 analyze CLI 用户入口（一条命令出报告）。

## Impact

- 新增：`packages/video-clone-engine/scripts/video-clone-analyze.js`、`test/scripts/analyze-cli.test.js`、`openspec/changes/video-clone-analyze-cli/`、PRD §24。
- 修改：`package.json`（+analyze script）、PRD v1.9→v1.10。
- 验证：engine 105（104 pass + 1 skip）；真实 B 站 CLI 演示 exit 0（report.json/summary.txt/媒体）。
