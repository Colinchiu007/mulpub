# 测试矩阵与证据

日期：2026-08-04
工作树：`C:/tmp/Multi-Publish-mp-full-parity-20260804`
分支：`codex/mp-full-parity-20260804`
基线：`origin/main@ea8782f`

## 通过项

| 层级 | 命令/证据 | 结果 |
|---|---|---|
| 定向 Vitest | 账号卡片、账号页、发布页、发布历史、模块导航、侧栏、发布类型弹窗 | 7 files / 139 tests passed |
| 账号/发布回归 | 前序闭环运行 | 78/78 passed |
| 故障注入 | `npm run test:fault` | 14/14 passed |
| Monkey | `npm run test:monkey` | 5/5 passed |
| Preload sandbox | sandbox=true/false | 双模式通过 |
| 视觉捕获 | 账号、发布、批量发布三视口 | 9/9 passed |
| 参考产品像素审计 | 账号、发布、批量发布 | 3/3 passed；差异 2.5389%、5.3809%、5.8431% |
| Vue 生产构建 | `scripts/build-preload.js` + Vite build | 通过；仅有 Rollup/chunk warning |
| ESLint | 本次变更 Vue 文件定向检查 | 0 errors / 5 compatibility warnings |
| 工作树静态检查 | `git diff --check` | 通过 |
| Electron 打包 | electron-builder win x64 | exit code 0 |
| ASAR 文件集 | `app.asar` 包含主进程、dist、preload、rpa-engine | 通过 |
| ASAR require | 隔离解包后加载 `@multi-publish/rpa-engine` | 通过 |
| 可见窗口 | 打包 `Multi-Publish.exe` | `MainWindowHandle=3147842`，标题“社媒管家”，Responding=true |
| 真实 renderer/IPC | Playwright Electron firstWindow | `window.electronAPI=true`，`getVersion()` 返回 `2.3.53` |
| stderr | 打包应用启动 10 秒 | 0 行 |

## 条件性/未通过项

| 项目 | 结果 | 边界与处理 |
|---|---|---|
| 全量桌面 Vitest | 344 files / 6016 passed / 2 failed | 两个失败均为本任务未修改的既有问题：`asset-generator.test.js` 的 spawn 参数缺 `run_id`；`stage-media-tools.test.js` 的依赖二进制缺失。不得伪装成全绿。 |
| 覆盖率门禁 | 测试主体通过但全局阈值失败 | 仓库全局覆盖率阈值/历史覆盖率问题，未改动无关测试或阈值。 |
| `accountList()` 真实 IPC | 被许可证访问控制拒绝 | 打包应用真实 renderer 调用返回“许可证权限不足，无法调用 accountList”；不是伪造账号成功。需要 Pro/真实租户凭据才能继续。 |
| 外部 Antigravity 审查 | 未启动 | wrapper 真实输出：`agy command not found in PATH`。 |
| 外部 Claude 审查 | 未生成审查报告 | wrapper 真实启动后退出码 1；不能当作通过。 |
| 第三方平台 | 未验证 | 登录、上传、审核、配额、团队分享和跨设备同步依赖外部服务/真实凭据。 |

## 媒体工具打包前置

干净 worktree 的 `ffmpeg-ffprobe-static` 安装缺少 `ffmpeg.exe` 及许可证 sidecar，首次打包因此按门禁 fail closed。为完成本机 Windows 打包验证，使用同一仓库主工作树已锁定的二进制与许可证文件补齐当前 worktree 的 ignored `node_modules`，SHA-256 与 `media-tools-lock.json` 一致；二进制未进入 Git 变更。该环境前置缺口仍需在 CI/新 worktree 安装流程中单独修复。
