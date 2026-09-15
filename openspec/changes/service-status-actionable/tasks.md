## 1. 契约与归因（主进程）

- [x] 1.1 `base-python-bridge.js` 新增 `healthCheckDetail()`（返回 `{ ok, reason, statusCode }`），`healthCheck()` 改为委托以保持布尔语义与既有调用方零改动
- [x] 1.2 归因取值收敛为：`ok` / `connection_refused` / `timeout` / `http_error` / `unhealthy` / `unknown`（settle 幂等，error 与 timeout 竞争时先到者胜出）
- [x] 1.3 `ipc-handlers/services.js`：每项新增 `reason` / `restartable` / `onDemand`（向后兼容新增字段，`status` 三态枚举不变）
- [x] 1.4 归因规则：bridge 的 `isRunning` 为 false → 优先 `not_started`；否则采用探测给出的具体原因
- [x] 1.5 对齐引擎显式返回 `status: 'standby'` + `reason: 'on_demand'` + `onDemand: true`，移除 `bridgeStatus(null, …)` 的隐式空语义
- [x] 1.6 splitter/prompt 健康探测改为 `Promise.all` 并行，避免两个 2s 超时串行叠加

## 2. 重启通道

- [x] 2.1 新增 `services:restart` IPC handler（`withSenderCheck` + 白名单 `mainBackend`/`splitterEngine`/`promptEngine`/`callbackServer`/`mediaServer`）
- [x] 2.2 启动入口优先级：`ensureRunning()` → `start()` → `startPythonBackend()`；`restartingKeys` 去重防并发
- [x] 2.3 错误码：`SERVICES_RESTART_UNSUPPORTED_KEY` / `SERVICES_RESTART_IN_PROGRESS` / `SERVICES_RESTART_UNAVAILABLE` / `SERVICES_RESTART_FAILED`
- [x] 2.4 preload `servicesRestart` + `src/api/services.js` 封装
- [x] 2.5 重新构建 `preload/index.bundle.js`（运行时实际加载产物）
- [x] 2.6 确认权限语义：不加入 `PUBLIC_CHANNELS` / `PUBLIC_METHODS`（写操作需登录）

## 3. 渲染端 store

- [x] 3.1 归一化透传 `reason` / `restartable` / `onDemand`，未知 reason 归一为 `unknown`，缺失时按 status 兜底
- [x] 3.2 轮询改为递归 `setTimeout` + 指数退避（10s→20s→40s→60s），健康立即回落；`polling` 标志替代 `pollTimer` 判活
- [x] 3.3 `lastSeenRunning` 时间戳记录（running 刷新，故障保留旧值）
- [x] 3.4 新增 `stoppedCount` / `hasDegradation` 计算属性
- [x] 3.5 新增 `restart(key)` 动作（防重复 + AUTH_ERROR(-3)/权限文案归一为 `AUTH_REQUIRED`）

## 4. UI

- [x] 4.1 触发方式 hover → click，`v-model:visible` 绑定使 `aria-expanded` 真实
- [x] 4.2 摘要降级文案改为「X 项服务不可用（M/6 运行中）」
- [x] 4.3 状态点 pulse 动画（`prefers-reduced-motion` 下关闭）
- [x] 4.4 服务行点击展开详情（归因 + 上次运行 + 重试按钮），再次点击折叠
- [x] 4.5 对齐引擎状态文字「待命」→「按需」（`onDemand`）
- [x] 4.6 `reason` snake_case → camelCase i18n key 映射（`REASON_KEY`）+ `te()` 判存消除 intlify 回退告警

## 5. i18n

- [x] 5.1 zh/en 成对新增 `degradedSummary` / `retry` / `retrying` / `lastSeen` / `states.onDemand` / `reasons.*`（8）/ `restartErrors.*`（6）
- [x] 5.2 `check-locale-sync --keys` 通过

## 6. 质量与交付

- [x] 6.1 相关套件回归：ipc-handlers/services、stores/serviceStatus、components/SidebarServiceStatus、layouts/MpSidebar、electron/preload、electron/services/base-python-bridge、electron/tests/ipc-contract、electron/tests/build-preload 全绿
- [x] 6.2 eslint 对改动文件 0 error 0 warning
- [x] 6.3 `preload.test.js` 合并键数断言 320 → 321
- [x] 6.4 文档：PRD-SERVICE-STATUS-PANEL §8 增强记录 + 本 openspec change
- [ ] 6.5 全量 `vitest run` 回归通过
- [ ] 6.6 分支提交、推送、PR、CI 全绿、合并回 main；三同步归档
