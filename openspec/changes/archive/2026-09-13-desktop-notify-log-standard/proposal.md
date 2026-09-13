## Why

桌面应用的通知/错误文案当前不是一套统一机制：大量用户可见文案以中文字面量硬编码散落在 composable（`useBatchPublish`/`usePublishFlow`/`useProviderCrud` 等约 50+ 条），未走 i18n、无稳定 key、无日志；三个错误格式化模块（`user-facing-error.js`/`story2video-notifications.js`/`pipeline-error-formatter.js`）正则语义重叠、规则漂移；用户看到的 UI 通知与主进程日志完全隔离，用户报"弹出错误 X"时无法按稳定标识检索对应技术栈。现有 `show-notification` 通道是半成品死通道（主进程发、renderer 无消费方）。

本 change 建立统一通知/错误文案标准 + 日志关联机制（M+ 复杂度 / 中高风险，需规格化后进入实现）。方案文档：`01-docs/ARCH-notify-log-standard.md`（经 CCG 双模型评审，C1-C3 CRITICAL 修复要求已并入正文）。

## What Changes

- 引入 `messageKey` 作为「用户文案 ↔ 错误分类 ↔ 日志」唯一关联键，贯穿五层架构
- 新增契约层 `message-contract.js`：`MESSAGE_KEYS` 枚举 + 共享归一化规则表 + `errorCategory` 跨模块关联键
- 新增通知通道 `notifyCore` 纯函数核心 + `useNotify.js` composable 薄封装，统一所有 UI 通知入口
- 新增主进程 `notify:log` IPC + `logger.notify()` 结构化日志行，含 C2 主进程侧校验（sender/level/白名单复验/换行消毒/速率限制）
- renderer 全局错误钩子（onerror/unhandledrejection/Vue errorHandler）覆盖崩溃场景
- `show-notification` 死通道收敛并入统一通道；keyword-spike 主进程源头记日志
- 存量硬编码文案分批迁移到 locales（zh/en 成对），非 toast 文案走 locales + 组件内 i18n
- CI/lint 强化：禁止非通道封装文件直接 import ElMessage

## Capabilities

### New Capabilities
- `desktop-notify-log`: 桌面端统一通知/错误文案标准 + 日志关联——messageKey 契约、notify 通道、notify:log IPC、renderer 崩溃日志、show-notification 收敛、存量迁移

### Modified Capabilities
<!-- 无既有 spec 被修改（openspec/specs/ 目前仅 openspec-integration），无修改项 -->

## Impact

- 涉及：apps/desktop/src（renderer：message-contract、useNotify、locales、各 composable 迁移）、apps/desktop/electron（main：notify:log IPC、logger.notify、phase3-services keyword-spike、misc.js/preload 清理）
- 约束：运行时改动（apps/desktop）必须在隔离 worktree 进行；文案必须 zh/en 成对（CI Gate 7）；对成熟模块 `story2video-notifications.js` 零侵入；不重命名既有 `story2video.*` key
- 待澄清：`logger.notify()` 方法形态（新增方法 vs 复用 log 三参）；多窗口/主窗口最小化兜底策略；keyword-spike 无窗口降级策略