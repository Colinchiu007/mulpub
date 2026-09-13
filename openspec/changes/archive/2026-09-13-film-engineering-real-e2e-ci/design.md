## Context

`film-engineering-real.js` 使用 Playwright `_electron` 启动 `dist-electron/win-unpacked/Multi-Publish.exe`，通过真实 preload/IPC 驱动电影工程页面。它要求 Windows 可执行文件和 Playwright devDependency，不需要预装 Chromium。

## Goals / Non-Goals

**Goals:**

- 让每次影响 Build & Release 的 PR 都在 Windows 打包产物上运行电影工程真实 E2E。
- 失败时保留 JSON 报告、截图和主进程 stdout/stderr 证据。
- 保持文档同步、quality gate 和 workflow 契约测试不被破坏。

**Non-Goals:**

- 不把该脚本并入 Vite 浏览器的 `test:e2e` 运行器。
- 不新增真实外部图片 Provider 验收；无 Provider 时继续走离线 ffmpeg 占位图 fallback。
- 不新建独立 workflow job；复用现有 Windows 构建产物避免二次 electron-builder。

## Decisions

### 在现有 Windows build job 内运行，而非新 job

Build & Release 的 Windows matrix 已经执行 `electron-builder --win --x64 -p never`，产物目录包含 `win-unpacked/Multi-Publish.exe`。直接在后置步骤运行 E2E 可以复用同一份依赖与构建产物，避免新 job 重复构建和额外排队。

### 输出到工作区并 always 上传

`FILM_E2E_OUTPUT` 设为 `tests/e2e/reports/film-engineering-real`（pnpm 在 `apps/desktop` 目录执行），上传路径为 `apps/desktop/tests/e2e/reports/film-engineering-real/**`；上传步骤使用 `if: always()`，失败时也能取到失败截图与日志。

## Risks / Trade-offs

- [风险] Windows hosted runner 的 GUI 会话能力波动 → [缓解] Electron 以 `--no-sandbox --disable-gpu` 启动并设置独立用户数据目录；脚本用条件轮询等待主窗口，超时上限覆盖启动链。
- [风险] 无外部 Provider 时“生成”提示可能是 Provider 阻断而非成功 → [缓解] E2E 明确把 Provider 阻断视为环境阻断、不判失败，但把“提交的数据不符合要求”等参数校验错误视为失败。
- [风险] Windows build job 时间变长 → [缓解] E2E 仅 24 项检查且使用本地 film-kit，不在网络下载素材；失败截图直接上传。

## Migration Plan

1. 修改 `build.yml` 添加 E2E 步骤与 artifact 上传步骤。
2. 本地运行 workflow-contract 测试和 YAML 解析校验。
3. 推送 PR，观察 Build & Release Windows job 真实执行 E2E 并上传报告。
4. 若 CI 不稳定，回退为移除两个步骤即可，不影响应用代码。
