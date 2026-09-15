## 上下文

服务状态面板的数据链路：`SidebarServiceStatus.vue` → `stores/serviceStatus.js`（10s 轮询）→ `src/api/services.js` → `preload/services.js` → `ipc-handlers/services.js`（聚合）→ 各 bridge / server。

本次增强的核心问题是：**链路只负责「读出状态」，不负责「解释状态」与「改变状态」。**

## 决策

### D1：归因放在基类而非 IPC 层

`healthCheck()` 只返回布尔，无法区分「端口没人监听」和「进程在但卡死」。选择在 `BasePythonBridge` 新增 `healthCheckDetail()` 而非让 IPC 层自己发 HTTP：

- 复用既有 host/port 与 2s 超时，避免第二套探测逻辑漂移；
- `healthCheck()` 改为委托 `healthCheckDetail().then(d => d.ok)`，行为等价（原逻辑：`statusCode===200 || body.status ∈ {ok,healthy}`；新逻辑保持同一判定，仅在失败时补充原因）；
- 子类无一处 override `healthCheck`（已核查 `splitter-bridge.js` / `prompt-bridge.js` / `aligner-bridge.js`），改动面收敛。

`settle()` 依赖 Promise resolve 幂等：Node 的 `req.destroy()` 会随后触发 `error`，若不幂等会覆盖 timeout 归因。

### D2：`status` 枚举不动，归因走新增字段

`running|stopped|standby` 已被 store、组件、以及多份测试断言消费。若把 `never_started` / `crashed` 作为新 status 值，会波及 `ALLOWED_STATUS`、汇总逻辑与所有断言。

因此保持三态不变，新增 `reason` / `restartable` / `onDemand` 三个**纯新增**字段——旧消费方忽略即兼容。

### D3：`restart` 采用能力探测而非硬编码映射

`restartable` 由 `typeof target.ensureRunning === 'function' || typeof target.start === 'function'` 决定，IPC 层另对 `mainBackend` 额外识别 `startPythonBackend`（`python-bridge.js` 是函数式导出，与 `BasePythonBridge` 子类不同形）。

好处：回调服务/媒体服务是否有启动入口无需在此处硬编码假设；UI 依据 `restartable` 决定是否渲染按钮，前后端不会不一致。

### D4：`services:restart` 权限为 authenticated

不在 `PUBLIC_CHANNELS`（主进程）也不在 `PUBLIC_METHODS`（preload）→ 默认需要登录。

理由：`services:get-status` 是**只读诊断**（未登录可见，与 `identity:get-state` 对齐），而 `restart` 会 spawn 本地进程，属**写操作**。项目既有约定是「读 public、写 authenticated」（见 `access-control.js` 中 modelProvider 注释）。未登录时 preload 守卫抛 `AUTH_ERROR(-3)`，store 归一为 `AUTH_REQUIRED`，UI 提示「需要登录后才能重启服务」。

### D5：轮询退避用递归 setTimeout

`setInterval` 无法动态改变间隔。改为 `setTimeout` 递归 + `polling` 显式标志：

- `polling` 标志用于 `startPolling` 幂等与 `stopPolling` 生效（早期方案用「占位空定时器」表达启动态，语义混乱且有竞态，已废弃）；
- `degradedStreak` 上限 4，使延迟序列 10s→20s→40s→60s（上限 3 时最大只能到 40s，达不到 60s 封顶）；
- 健康时立即 `degradedStreak = 0`，避免恢复后仍慢速轮询。

### D6：overlay 触发由 hover 改 click

面板现在含可点击的展开区与重试按钮。hover 触发在含交互内容时易误触丢失，click 语义更明确；`v-model:visible` 让 `aria-expanded` 反映真实状态。

## 未采纳方案

- **不引入全局服务管理器**：本次不重构服务生命周期，只补「读—解释—操作」三件事，watchdog 仍是自动守护主路径。
- **不为对齐引擎注入真实 bridge**：源码 TODO 提到常驻化后可接入 DI，但那属于架构变更（影响 subtitle-align-service 懒启动模型），本次仅做诚实标注。
- **不在 IPC 层自建 HTTP 探测**：会造成与 bridge 内部逻辑的第二套实现，已在 D1 说明。

## 风险

- `restart` 会触发 `_waitForHealthy`（最长 10s），期间 UI 显示「重试中…」并禁用按钮；`restartingKeys` 防重复。
- `restart` 无法修复根因（如 Python 依赖缺失），只提供恢复入口；失败时回显错误消息供排障。
- preload bundle 是产物文件，必须与源码同步提交（`build-preload.test.js` 会校验一致性）。
