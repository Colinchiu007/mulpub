# PRD — 侧边栏服务运行状态面板（多服务细化 + 客户端真实状态）

- 文档编号：PRD-SERVICE-STATUS-PANEL-2026-09-12
- 状态：开发中（分支 `codex/service-status-panel`）
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
- 面板为只读展示，不提供服务启停操作（服务由 BasePythonBridge watchdog 自动守护重启）

