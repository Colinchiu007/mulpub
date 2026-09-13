# lint-gate-error-zero（ESLint error 级 CI 门禁 + 存量清零）

## Why

ESLint 配置早已存在（`apps/desktop/eslint.config.mjs` + `pnpm run lint`），但 **CI（quality-gate.yml）没有任何 lint 步骤**，`pnpm run lint` 也长期无人执行且当前本身就是红的（17 error + 393 warning，超 `--max-warnings 300`）。结果是 error 级问题在 main 上静默存活。2026-09-14 全量扫描（`eslint electron/ src/ --no-ignore -f json`）发现 17 个 error，人工逐一核对后确认其中 **4 个 `no-undef` 是真实功能缺陷**：

1. `src/views/AutoPipelineView.vue:356,364`：调用 `notifyInfo` 但 `useNotify()` 只解构了 notifyError/notifySuccess/notifyWarning —— `resumePipeline()` 的提示**不在 try 内**，点「恢复流水线」直接抛 ReferenceError、恢复流程中断；`cancelPipeline()` 的提示被 try/catch 吞掉。
2. `electron/ipc-handlers/notify.js:109`：catch 兜底分支引用了未导入的 `EC`（实际导出名为 `ERROR`）→ 写日志失败时兜底路径自身抛 ReferenceError，IPC 拿不到干净错误封包。
3. `electron/publishers/account-manager.js:594`：引用了未导入的 `PLATFORM_ACCOUNT_INFO_SELECTORS`（定义于 `@multi-publish/shared-utils/src/platform-definitions`）→ `extractAccountInfo()` 每次调用都在 try 内抛错并被吞成 `{}`，「账号信息提取」功能自引入以来从未生效。
4. `src/views/video-creation/StageProgress.vue:105`：data 键 `_lastActiveStageIndex` 以 `_` 开头（Vue 保留前缀，实例代理不可见）→ 活动阶段去重逻辑恒失效。

其余 error：`preserve-caught-error` ×4（rethrow 未挂 cause）、`no-useless-assignment` ×4、`no-empty` ×3（含 1 处位于**生成物** `electron/preload/index.bundle.js`）、`no-control-regex` ×1（有意匹配控制字符的清洗正则）。

## What Changes

- 清零全部 17 个 error 级告警（4 个真 bug 修复 + 13 处机械修复/带说明豁免），`pnpm exec eslint electron/ src/ --quiet` 达到 0 error。
- 修 lint 配置缺陷：`lint`/`lint:fix` 脚本去掉 `--no-ignore`（它会绕过 flat config 的 ignores，导致生成的 `electron/preload/index.bundle.js` 等 15 处噪音被误扫）；`eslint.config.mjs` 全局 ignores 新增 `electron/preload/**/*.bundle.js`；新增 `lint:warnings` 脚本保留 warning 可见性。
- CI 接入：`quality-gate.yml` static-gates 新增 **Gate 11 - ESLint (error-level gate)**，执行 `pnpm exec eslint electron/ src/ --quiet`（与本地 `pnpm run lint` 同口径，只拦 error 级）。
- 回归测试：notify 兜底封包、extractAccountInfo 平台选择器注入、AutoPipelineView resume/cancel 通知、StageProgress 活动阶段索引——4 个真 bug 各有对应回归用例。

## Scope

- 覆盖：上述 12 个源文件的最小修复、`eslint.config.mjs`、`apps/desktop/package.json`（lint 脚本）、`.github/workflows/quality-gate.yml`（Gate 11）、4 个测试文件（3 新增 1 追加）、CHANGELOG 与 .quality-gates.md。
- 不覆盖：warning 级基线棘轮（`no-var` 193 / `no-unused-vars` 173 / `prefer-const` 14，后续单独 change：per-rule 基线只降不升）；`lint` 脚本不拦 warning（观察期用 `pnpm run lint:warnings` 查看）；electron/preload 生成物入库方式（另行治理）。
