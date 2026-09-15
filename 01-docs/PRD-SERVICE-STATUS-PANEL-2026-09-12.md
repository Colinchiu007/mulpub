# PRD — 侧边栏服务运行状态面板（多服务细化 + 客户端真实状态）

- 文档编号：PRD-SERVICE-STATUS-PANEL-2026-09-12
- 状态：已增强（2026-09-15 追加第 8 节：故障归因 / 可操作性 / 轮询退避）
- 关联模块：`apps/desktop/src/layouts/MpSidebar.vue`、`apps/desktop/electron/ipc-handlers/services.js`、`apps/desktop/src/stores/serviceStatus.js`
- 创建日期：2026-09-12

## 1. 背景与目标

应用左下角原有两行状态：

1. **"客户端状态未知"** — 纯静态硬编码占位文案，与身份链路（identity:get-state IPC → identity store）完全解耦，永远显示"未知"，无任何信息量。
2. **"服务运行中"** — 同为硬编码字符串，未走 i18n，且不反映任何真实服务状态；即使后端 Python 进程崩溃，这里仍显示"运行中"，误导用户与排障。

本需求将两行占位改为真实数据驱动：

- "服务运行中"细化为 **主服务、分句引擎、提示词优化引擎、回调服务、媒体服务、对齐引擎** 六项真实状态；
- "客户端状态未知"接入 identity store，按登录态显示 已连接/离线/登录中/已过期/错误 等。

## 2. 服务清单（经代码核实的完整盘点）

### 2.1 随应用自启动的常驻本地服务（5 个，全部纳入面板）

| 面板显示名 | key | 端口 | 源码 | 状态判定方式 |
|---|---|---|---|---|
| 主服务 | mainBackend | 8299（BACKEND_PORT，冲突自动 +0~+4 回退） | python-bridge.js | `pythonBridge.isRunning()` 同步标志 |
| 分句引擎 | splitterEngine | 8002（SPLITTER_PORT） | splitter-bridge.js | `healthCheck()` GET /health（2s 超时） |
| 提示词优化引擎 | promptEngine | 8013（PROMPT_PORT） | prompt-bridge.js | `healthCheck()` GET /health（2s 超时） |
| 回调服务 | callbackServer | 16521（CALLBACK_SERVER_PORT） | callback-server.js | `server.listening` 同步标志 |
| 媒体服务 | mediaServer | 随机（listen(0) 动态分配） | story2video-media-server.js | `origin` 非空（启动后形如 http://127.0.0.1:<port>） |

### 2.2 按需懒启动服务（1 个，纳入面板显示"待命"）

| 面板显示名 | key | 端口 | 说明 |
|---|---|---|---|
| 对齐引擎 | alignerEngine | 8004（ALIGNER_PORT） | 由 subtitle-align-service 首次调用时懒启动；`packages/audio-aligner/aligner` 目录不存在时功能整体禁用。未激活不算故障，显示"待命" |

### 2.3 明确不纳入面板的（非常驻/远程依赖）

- ffmpeg/ffprobe（按需 execFile，非服务）、Remotion 渲染子进程（按需 spawn）、TTS 脚本（按需）、发布告警（按需）
- ops-center、platform-orchestrator、各模型 API（远程 HTTP，桌面端不启动其进程）
- 独立视频提示词引擎 8020（外部托管，VIDEO_PROMPT_PORT 显式配置才启用）

## 3. 数据契约与校验

### 3.1 IPC 通道 `services:get-status`

主进程 handler（ipc-handlers/services.js）返回：

```
{ code: 0, data: { services: [{ key, name, status, port }], timestamp } }
```

- status 枚举：`running` | `stopped` | `standby`
- port：主服务返回实际回退后端口（currentPort()），媒体服务从 origin 解析动态端口，其余返回配置端口
- 异常兜底：任一服务探测抛错 → 该项 status='stopped'，不阻断其他项；整体异常返回 `{ code: -99, message: 'SERVICES_STATUS_UNAVAILABLE' }`
- 安全：withSenderCheck 校验 senderFrame 来源，不可信来源返回 code:-3

### 3.2 渲染端 store 归一化（serviceStatus.js）

- services 非数组 → 空数组；key 非字符串的项被过滤
- name 非字符串回退为 key；status 非法枚举归一为 'stopped'；port 非有限数字归一为 0
- IPC 不可用（非 Electron 环境返回 SERVICES_API_UNAVAILABLE）→ unavailable=true，不抛错

### 3.3 轮询与竞态守卫

- 侧边栏 onMounted 启动 10s 间隔轮询，onUnmounted 停止；unmount 后在飞响应不写回
- refresh 使用 pollGeneration 递增快照：旧响应返回时 generation 不匹配则丢弃（防止乱序覆盖新状态）

## 4. 交互逻辑与显示项

### 4.1 服务摘要行（footer 第二行，替换原"服务运行中"）

| 场景 | 显示 | 样式 |
|---|---|---|
| 六项全部 running/standby | "服务运行中" | 绿点 + is-ok |
| 部分 running | "N 项服务运行中"（N=running 数） | 黄点 + is-degraded |
| IPC 不可用 | "服务状态不可用" | 黄点 + is-degraded |

鼠标悬停 200ms 弹出 el-popover（宽 280，placement top-start），列出六项：每项 = 状态点 + 服务名 + 状态文字。

### 4.2 服务状态点颜色

- running → 绿 #6fbf73
- stopped → 红 #f56c6c
- standby → 灰 #c0c2cf

### 4.3 客户端状态行（footer 第一行，替换"客户端状态未知"）

identity store status → 显示映射（复用 memberCenter 既有 i18n key）：

| identity status | 显示 | class |
|---|---|---|
| authenticated / refreshing / offline_authenticated | 已连接 | is-online（绿点） |
| signing_in | 登录中 | is-busy（黄点） |
| signing_out | 退出中 | is-busy |
| disabled | 未启用 | is-offline |
| signed_out | 未登录 | is-offline |
| expired | 已过期 | is-offline |
| error（及其他未知） | 连接异常 | is-error（黄点） |

title 属性与文案一致，悬停可复读。

## 5. 提示文字清单（zh / en 成对，sidebar.serviceStatus）

| key | zh | en |
|---|---|---|
| allRunning | 服务运行中 | Services running |
| partialRunning | {count} 项服务运行中 | {count} service(s) running |
| unavailable | 服务状态不可用 | Service status unavailable |
| services.mainBackend | 主服务 | Main service |
| services.splitterEngine | 分句引擎 | Sentence splitter engine |
| services.promptEngine | 提示词优化引擎 | Prompt optimization engine |
| services.callbackServer | 回调服务 | Callback server |
| services.mediaServer | 媒体服务 | Media server |
| services.alignerEngine | 对齐引擎 | Aligner engine |
| states.running | 运行中 | Running |
| states.stopped | 已停止 | Stopped |
| states.standby | 待命 | Standby |

partialRunning 为 Message Function：`(ctx) => ctx.named('count') + ' 项服务运行中'`（zh/en 一致形式），禁止 {name} 占位符静态字符串。

## 6. 测试覆盖

- ipc-handlers/services.test.js：3 例（聚合结构 / 异常降级 stopped / 不可信 sender 拒绝）
- stores/serviceStatus.test.js：5 例（归一化 / 非法值 / IPC 不可用 / 乱序快照守卫 / 轮询启停）
- layouts/MpSidebar.test.js：7 例（真实身份状态 + 摘要 / 六项列表 / 降级+离线 / 导航回归 4 例）
- 门禁：check-locale-sync --cjk / --keys / --pair-base 全过；eslint 0 error 0 warning

## 7. 边界与已知限制

- splitterEngine/promptEngine 的 healthCheck 是主动 HTTP 探测（各 2s 超时），轮询周期 10s；服务刚崩溃时最长 10s 内面板仍显示旧状态
- alignerEngine 的 standby 不区分"目录缺失功能禁用"与"尚未触发懒启动"（两者对用户语义相同：当前未激活）
- mediaServer 端口为动态分配，仅用于展示，不承诺稳定
- ~~面板为只读展示，不提供服务启停操作（服务由 BasePythonBridge watchdog 自动守护重启）~~
  → 2026-09-15 起支持按服务「重试连接」（见第 8 节）；watchdog 仍是自动守护的第一道防线，手动重试是其补充而非替代

## 8. 增强记录（2026-09-15）：故障归因 + 可操作性 + 轮询退避

### 8.1 背景

原面板只能回答「是否运行」，无法回答「为什么没起来」「我该怎么办」。用户看到 3 项「已停止」时无从下手；且「对齐引擎 → 待命」易被误读为「随时可用」。

### 8.2 数据契约扩展（向后兼容）

`services:get-status` 每项新增 3 个字段（旧消费方忽略即可）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `reason` | string | 故障归因：`ok` / `not_started` / `on_demand` / `connection_refused` / `timeout` / `http_error` / `unhealthy` / `unknown` |
| `restartable` | boolean | 该服务是否暴露了启动入口（决定 UI 是否显示重试按钮） |
| `onDemand` | boolean | 是否为按需懒启动服务（对齐引擎为 true） |

归因来源：

- `mainBackend` / `callbackServer` / `mediaServer`：进程/套接字标志，未运行即 `not_started`
- `splitterEngine` / `promptEngine`：`healthCheckDetail()`（新增于 base-python-bridge.js）返回 `{ ok, reason, statusCode }`；若 bridge 的 `isRunning` 为 false 则优先归因 `not_started`，否则采用探测给出的具体原因（如 `timeout` / `http_error`）
- 探测改为 `Promise.all` 并行，避免两个 2s 超时串行叠加成 4s

### 8.3 新增 IPC 通道 `services:restart`

- 入参 `{ key }`，白名单：`mainBackend` / `splitterEngine` / `promptEngine` / `callbackServer` / `mediaServer`
- 启动入口优先级：`ensureRunning()` → `start()` → `startPythonBackend()`
- 同一 key 并发请求返回 `SERVICES_RESTART_IN_PROGRESS`；不在白名单返回 `SERVICES_RESTART_UNSUPPORTED_KEY`；无可用入口返回 `SERVICES_RESTART_UNAVAILABLE`
- **权限**：不在 `PUBLIC_CHANNELS` / `PUBLIC_METHODS`，属 authenticated 写操作——未登录调用被 preload 许可证守卫以 AUTH_ERROR(-3) 拒绝，前端提示「需要登录后才能重启服务」

### 8.4 渲染端 store

- **轮询退避**：健康时 10s；降级时 10s→20s→40s→60s 封顶；恢复健康立即回落 10s
- **lastSeenRunning**：每服务最近一次观测到 running 的时间戳，故障时保留旧值供 UI 展示「上次运行」
- 新增计算属性 `stoppedCount`、`hasDegradation`；新增动作 `restart(key)`（含防重复与 AUTH 归一）

### 8.5 UI 变更

| 项 | 变更 |
|---|---|
| 触发方式 | hover → **click**（面板内含可交互内容，避免 hover 丢失） |
| 摘要（降级） | 「N 项服务运行中」→ **「X 项服务不可用（M/6 运行中）」**（故障数前置） |
| 摘要指示 | 降级时状态点 pulse 动画（`prefers-reduced-motion` 下自动关闭） |
| 服务行 | 可点击展开详情：故障归因文案 + 上次运行时间 + 「重试连接」按钮 |
| 对齐引擎 | 状态文字「待命」→ **「按需」**（`onDemand` 标记，避免误读为随时可用） |
| 可访问性 | `aria-expanded`（面板与服务行）、`aria-label` 摘要、重试按钮 disabled 态 |

### 8.6 新增文案（zh/en 成对）

`degradedSummary` / `retry` / `retrying` / `lastSeen` / `states.onDemand` / `reasons.*`（8 项）/ `restartErrors.*`（6 项）。

`reason` 为 snake_case，组件内通过 `REASON_KEY` 映射为 camelCase i18n key，并用 `te()` 判存避免 intlify 回退告警。

### 8.7 测试覆盖（本次增补）

- `ipc-handlers/services.test.js`：14 例（新增归因、healthCheckDetail 降级回退、restart 成功/白名单/不可用/失败/并发/不可信 sender）
- `stores/serviceStatus.test.js`：13 例（新增 reason 透传与未知归一、退避、lastSeenRunning、restart 成功/失败/AUTH/防重复）
- `components/SidebarServiceStatus.test.js`：11 例（新增展开/折叠、重试按钮显隐、错误文案回退）
- `layouts/MpSidebar.test.js`：同步 mock 字段与「按需」断言
- `preload.test.js`：合并后 api 键数 320 → 321（新增 servicesRestart）
- 门禁：check-locale-sync --keys 通过；eslint 0 error 0 warning

### 8.8 已知限制

- `restart` 对 `mainBackend` 依赖 `startPythonBackend()`；若 Python 环境本身缺失（依赖未安装），重试仍会失败并回显错误消息，不解决根因
- `splitterEngine` / `promptEngine` 的重试走 `ensureRunning()`，可能触发 `_waitForHealthy` 最长 10s；UI 期间显示「重试中…」
- 对齐引擎不支持重试（无全局实例，按需懒启动）

