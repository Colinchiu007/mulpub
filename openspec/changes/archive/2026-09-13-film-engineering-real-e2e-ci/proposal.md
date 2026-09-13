## Why

电影工程打包 Electron 真实 E2E 当前是显式命令（`pnpm test:e2e:film-engineering`），不会在默认 CI 中运行。上次修复证明该缺陷只有真实 preload/IPC 才能暴露，继续保留 opt-in 脚本会让回归再次逃逸到用户环境。

## What Changes

- 在 Build & Release 的 Windows build job 中，于 `electron-builder --win --x64 -p never` 之后新增“Run film engineering real E2E”步骤。
- E2E 产物写入 `apps/desktop/tests/e2e/reports/film-engineering-real`，并在成功或失败时上传为 artifact。
- 不改默认 `pnpm test:e2e`：该门禁运行于 Vite + mock desktop 环境，无法覆盖打包 EXE 的真实 IPC。

## Capabilities

### New Capabilities

- ci.real-electron-e2e：Build & Release Windows job 在打包产出 `dist-electron/win-unpacked/Multi-Publish.exe` 后运行电影工程真实 E2E，失败即阻塞 PR。

### Modified Capabilities

- 无。

## Impact

- 仅修改 `.github/workflows/build.yml`，引用已存在的 `apps/desktop/tests/e2e/film-engineering-real.js` 与 `test:e2e:film-engineering` 脚本。
- 不新增依赖、不改变应用代码；Windows build job 运行时间增加一次真实 E2E（约 1-3 分钟）。
- E2E 在没有外部图片 Provider 的临时 profile 下仍可通过，Provider 阻断不视为失败；参数校验错误仍视为失败。
