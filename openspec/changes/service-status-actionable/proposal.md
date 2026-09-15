## Why

侧边栏服务状态面板（PRD-SERVICE-STATUS-PANEL-2026-09-12）已能真实反映六个服务的 running/stopped/standby，但存在三个可用性缺口：

1. **只报忧不救忧**：用户看到「已停止」时无法得知原因，也没有任何恢复入口——面板是纯只读展示。
2. **「待命」语义误导**：对齐引擎因 `bridgeStatus(null, …)` 硬编码传 null，恒返回 `standby`。用户容易读成「随时可用」，实际是「按需懒启动、当前无全局实例」。
3. **摘要信息量低**：「N 项服务运行中」需要用户心算故障数（6 − N），且异常态无视觉吸引机制。

同时轮询固定 10s 间隔，在服务持续故障时也保持高频探测，属于无谓开销。

## What Changes

- **故障归因**：`services:get-status` 每项新增 `reason` 字段（`ok` / `not_started` / `on_demand` / `connection_refused` / `timeout` / `http_error` / `unhealthy` / `unknown`）；`BasePythonBridge` 新增 `healthCheckDetail()` 返回 `{ ok, reason, statusCode }`，`healthCheck()` 委托它保持原布尔语义。
- **可操作性**：新增 IPC 通道 `services:restart`（白名单 + 并发去重 + 权限为 authenticated 写操作）；前端服务行可点击展开详情（归因文案 + 上次运行时间 + 「重试连接」按钮）。
- **诚实标注按需服务**：`alignerEngine` 增加 `onDemand: true` 与 `reason: 'on_demand'`，UI 状态文字由「待命」改为「按需」。
- **紧凑摘要**：降级时显示「X 项服务不可用（M/6 运行中）」（故障数前置），状态点加 pulse 动画（`prefers-reduced-motion` 下关闭）。
- **轮询退避**：健康 10s；降级 10s→20s→40s→60s 封顶；恢复健康立即回落。
- **状态历史**：store 记录每服务 `lastSeenRunning` 时间戳（故障时保留旧值），供「上次运行」展示。
- **可访问性**：`aria-expanded`（面板 + 服务行）、`aria-label` 摘要、重试按钮 disabled 态。
- **preload bundle 重建**：运行时加载的是 `preload/index.bundle.js`（esbuild 产物），已重新构建并同步 `preload.test.js` 键数断言。

## Capabilities

### New Capabilities

- `service-status-panel`: 侧边栏服务运行状态面板的真实状态聚合、故障归因、按服务重启入口与轮询策略。

### Modified Capabilities

<!-- 无（该能力此前未在 openspec 登记，本次首次纳入） -->

## Impact

- 运行时代码：
  - `apps/desktop/electron/services/base-python-bridge.js`（新增 `healthCheckDetail`，`healthCheck` 改为委托）
  - `apps/desktop/electron/ipc-handlers/services.js`（归因、能力探测、`services:restart`）
  - `apps/desktop/electron/preload/services.js` + `preload/index.bundle.js`（重建）
  - `apps/desktop/src/api/services.js`、`src/stores/serviceStatus.js`、`src/components/SidebarServiceStatus.vue`
  - `apps/desktop/src/locales/zh.js` + `en.js`（成对新增文案）
- 权限：`services:restart` 不进入 `PUBLIC_CHANNELS` / `PUBLIC_METHODS`，保持 authenticated 写操作语义；`services:get-status` 维持未登录可见。
- 测试：`services.test.js`、`serviceStatus.test.js`、`SidebarServiceStatus.test.js`、`YixiaoerSidebar.test.js`、`preload.test.js`
- 文档：`01-docs/PRD-SERVICE-STATUS-PANEL-2026-09-12.md` §8、本 change
