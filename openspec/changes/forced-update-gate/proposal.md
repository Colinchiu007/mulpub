# Proposal: forced-update-gate（重大版本强制升级安全机制）

## Why

当已发布版本出现重大问题或安全漏洞、且修复已随新版本发出时，需要一个"必须升级才能继续使用"的强制升级机制：用户打开或登录应用时弹出不可关闭的弹窗，仅提供"升级"按钮，点击后下载并安装新版。

现状缺口（事实锚定，2026-10-19）：

1. **策略通道已有，阻断缺失**：ops-center `update_policy` 表（`ops-center/backend/models.py` `UpdatePolicy`）已具备 min_version（仅提示）/ force_version（仅自动下载）/ gray_ratio（灰度跳过）三种语义，经 `GET /api/v1/runtime/bootstrap` 签名下发、桌面端 `ops-center-sync.setUpdatePolicyConsumer` → `auto-updater.applyPolicy` 消费。三者都不是"不升级不能用"——`policy-min-version` 只是发一条状态，渲染端无专门阻断 UI；`force_version` 只是置 `autoDownload=true`，应用照常可用。
2. **exe 未签名**：electron-builder `win.sign=false`，asar 可解包、主进程 JS 可篡改。任何"仅客户端"的阻断判断都可被破解者 patch 掉。
3. **内嵌视图遮挡浮层**：渲染端全屏遮罩会被 home-shell 的 WebContentsView 原生图层盖住（CHANGELOG L9874 先例），渲染端弹窗天然不可靠。

已定案的设计决策（grilling 会话 Q1-Q12，全部按推荐采纳）：

| # | 决策 |
|---|---|
| Q1 | 离线/服务器不可达：**72h 宽限期**。本地缓存"最后已知策略 + 成功拉取时间戳"，拉不到新策略时 72h 内沿用旧策略放行，超期封锁（显示"版本验证失败，请联网重试"页，带重试按钮）；已知"阻断"状态的用户断网仍保持阻断 |
| Q2 | 服务端执法覆盖面：挂在**桌面端真实消费的机器端点**（`GET /api/v1/model-presets/catalog`、`POST /api/v1/runtime/ack`、`POST /api/v1/telemetry/degradation`）返回 **426 Upgrade Required**；`GET /api/v1/runtime/bootstrap` 豁免（策略通道自锁排除）、Cookie 会话（运营后台）豁免；机器通道**缺头/坏头按旧版处理 → 426**（fail-closed，否则存量旧客户端不发新头使执法层失效）；纯离线功能服务端够不着，属架构边界。事实修正（2026-10-19）：原推荐挂 `/api/v1/member/*`，探查证实该 router 仅 admin 手动开通端点、桌面端不调用，故修正挂点 |
| Q3 | `update_policy` 新增 **`enforce_min_version`**（低于此版本硬阻断）与 **`enforce_enabled`**（总开关，默认 0）两个字段；现有 min_version/force_version/gray_ratio 语义不动；**阻断判定不受 gray_ratio 灰度分桶影响**（必须全员一致）；不加服务端自定义文案字段 |
| Q4 | 阻断弹窗 = **主进程独立 BrowserWindow**（无边框、置顶、拦截 close、主窗口隐藏），渲染端不参与判定；点"升级"复用现有 `autoUpdater.installNow()`（三态幂等） |
| Q5 | 检查时机三处：启动（bootstrap 拉取）、登录成功后（bootstrap 刷新）、运行中**每 6 小时轮询** |
| Q6 | 版本号真源 = `app.getVersion()`（= apps/desktop/package.json `0.2.0`）；PRD.md 头部 v2.3.60 口径差异顺手修正 |
| Q7 | 弹窗文案：标题"检测到重要核心更新"/ 正文"当前版本存在重大问题，必须升级到新版本后才能继续使用。"/ 按钮"立即升级"/ 显示"当前版本 x.x.x → 新版本 y.y.z"/ 进度"正在下载更新… N%"/ 失败"下载失败，请检查网络后重试"（zh/en 双语，按 app.getLocale 切换，主进程自带字典） |
| Q8 | 仅"立即升级"一个按钮，无"联系客服/查看说明"逃生通道；OS 兼容等边界写入 PRD 已知限制 |
| Q9 | 防破解定位：客户端判定是**劝导层**、服务端拒绝是**执法层**；本轮落地基础档（判定全在主进程 + 服务端 426），Electron fuses 与代码签名证书列入后续加固路线图 |
| Q10 | 交付四项全做（文档 → 服务端 → 客户端 → worktree/PR/CI 绿后自动 squash 合并），任务名 `forced-update-gate` |
| Q11 | GitHub Releases 下载失败本轮只做"失败重试按钮 + 明确错误文案"，镜像源列入后续路线图 |
| Q12 | 接受存量过渡现实：本功能只对"升级到带阻断能力版本"的用户生效；更老存量用户依赖下一次常规更新把本功能带下去 |

## What Changes

### ADDED Capabilities

- `forced-update-gate`：重大版本强制升级契约——服务端 `update_policy` 双新字段（enforce_min_version/enforce_enabled）与 upsert 校验、bootstrap payload 透传、`/api/v1/member/*` 版本门（426）、后台管理页配置项；桌面端主进程 enforce-gate 状态机（阻断判定 / 72h 宽限 / 原子持久化 / 三时机检查 / 6h 轮询）、独立置顶阻断窗口（阻断态与验证失败态两种视图）、复用 electron-updater 的下载安装链路。

### MODIFIED Requirements

- 无破坏性变更：bootstrap payload 的 `update_policy` 块仅**新增**两个字段，向后兼容；`enforce_enabled` 默认 0（关闭），上线即安全，行为零变化。

## Impact

- **ops-center 后端**：`models.py` UpdatePolicy 加两列；`services/update_policy_migration.py`（幂等补列，照 usage_migration.py 先例）+ main.py 启动接线；`runtime_service.py` 序列化与 upsert 校验扩展；`model_presets.py` / `runtime.py`(ack) / `telemetry.py` 挂 `Depends` 版本门；新 `services/version_gate.py`；pytest 新增 `tests/test_version_gate.py`。
- **ops-center 前端**：`views/UpdatePolicy.vue` 增加强制升级配置卡片（输入框 + 开关 + 语义说明）。
- **桌面端主进程**：新 `electron/services/enforce-gate.js`（状态机 + 窗口管理 + 轮询）与 `electron/services/enforce-gate-text.js`（zh/en 文案字典）；`bootstrap/phase1-context.js` 接线（consumer + identity 登录钩子 + shutdown 清理）；`auto-updater.js` 增加 enforce 场景需要的进度回调透传（不破坏现有 `update:status` 通道）。
- **不涉及**：渲染端 UI（阻断窗口完全在主进程）、locales 渲染端命名空间（主进程窗口文案自带字典）、electron-builder 配置、CI workflow。
