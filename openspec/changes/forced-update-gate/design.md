# Design: forced-update-gate

## 1. 架构总览（双通道）

```
┌─ 劝导层（客户端）─────────────────────────────────────┐
│ ops-center bootstrap（签名 payload）                    │
│   └─ update_policy { min_version, force_version,        │
│        gray_ratio, enforce_min_version,                 │
│        enforce_enabled }                                │
│         ↓ ops-center-sync.applyRuntime（既有）          │
│         ↓ setUpdatePolicyConsumer（既有钩子）           │
│   enforce-gate.js（主进程）                             │
│   ├─ evaluate(policy, now)：阻断判定状态机              │
│   ├─ 持久化 userData/enforce-gate-state.json（原子写）   │
│   ├─ showGateWindow()：独立置顶无边框窗口               │
│   │    ├─ 视图 A「阻断」：标题/正文/版本/立即升级        │
│   │    └─ 视图 B「验证失败」：联网重试（超 72h 宽限）    │
│   └─ 每 6h 轮询 syncNow() 刷新判定                      │
│         ↓ 点"升级" → autoUpdater.installNow()（既有）   │
└────────────────────────────────────────────────────────┘
┌─ 执法层（服务端）─────────────────────────────────────┐
│ 桌面端真实消费的机器端点挂 Depends(version_gate)：       │
│   GET  /api/v1/model-presets/catalog                    │
│   POST /api/v1/runtime/ack                              │
│   POST /api/v1/telemetry/degradation                    │
│   ├─ Cookie 会话（运营后台）→ 豁免                       │
│   ├─ bootstrap → 豁免（策略通道自锁排除）                │
│   ├─ enforce_enabled=1 且（缺头/坏头/低于阻断线）        │
│   │     → 426 {"detail":{"code":"upgrade_required",...}}│
│   └─ 策略关 → 放行                                       │
└────────────────────────────────────────────────────────┘
```

判据分工：客户端判定决定"能不能用"（劝导 + 阻断 UX），服务端 426 决定"旧版联网还能拿到什么"（执法）。**机器通道 fail-closed**：存量旧客户端不发 `X-Client-Version` 头，缺头即按旧版拒绝——否则执法层对它要拦的对象完全失效。破解者 patch 掉客户端弹窗后，目录更新/生效上报仍返回 426，破解价值大幅下降（纯离线功能除外——这是 Q2 确认的架构边界，写入 PRD 风险章）。

判据分工：客户端判定决定"能不能用"（劝导 + 阻断 UX），服务端 426 决定"旧版联网还能拿到什么"（执法）。破解者 patch 掉客户端弹窗后，会员权益、兑换等服务器端点仍返回 426，破解价值大幅下降（纯离线功能除外——这是 Q2 确认的架构边界，写入 PRD 风险章）。

## 2. 服务端（ops-center/backend）

### 2.1 模型与迁移

- `models.py` `UpdatePolicy` 增两列：
  - `enforce_min_version = Column(String, default="")`
  - `enforce_enabled = Column(Integer, default=0)`
- 新 `services/update_policy_migration.py`：`ensure_update_policy_columns(db)` 幂等补列（`PRAGMA table_info(update_policy)` → 缺列 `ALTER TABLE ... ADD COLUMN`），照 `usage_migration.py` 先例；`main.py` 启动 lifespan 处接线（与 ensure_usage_columns 同位）。

### 2.2 序列化与校验（runtime_service.py）

- `_update_policy_to_dict` 增两键：`enforce_min_version`（str，缺省 ""）、`enforce_enabled`（bool(row.enforce_enabled)）。
- `upsert_update_policy` 新校验：
  - `enforce_min_version` 走既有 `_validate_version`（格式 x.y.z）；
  - `enforce_enabled` 接受 true/1（其余为 false）；
  - **一致性规则**：`enforce_enabled=1` 时 `enforce_min_version` 必须非空（400："启用强制阻断时必须填写 enforce_min_version"）；`enforce_enabled=1` 且 min_version 非空时要求 `_cmp_version(enforce_min_version) < _cmp_version(min_version)`（阻断线必须严于提示线，否则提示永远不会出现在阻断前）；
  - enforce_min_version 与 force_version 互不约束（两者语义独立：force=自动下载，enforce=硬阻断）。

### 2.3 版本门（新 services/version_gate.py + routers 接线）

- FastAPI 依赖 `enforce_version_gate(request, db)`：
  1. 判别通道：请求带 Cookie 会话（`get_current_session` 命中）→ 放行（运营后台豁免）；
  2. 读 `X-Client-Version` 头（strip）：**缺/空 → 按旧版处理**（机器通道 fail-closed，存量旧客户端不发新头正是执法对象）；
  3. 头格式非 `^\d+(\.\d+){0,3}$` → 同旧版处理 + 记 WARN 日志；
  4. 读 update_policy 单行；`enforce_enabled` 假或 `enforce_min_version` 空 → 放行（总开关应急）；
  5. `_cmp_version(client, enforce_min_version) >= 0` → 放行；
  6. 否则 `raise HTTPException(426, detail={"code":"upgrade_required","min_version":...,"message":"当前版本过低，必须升级后才能使用"})`。
- 接线（router 级 `dependencies=[Depends(enforce_version_gate)]`）：`model_presets.py` 的 `/api/v1/model-presets/catalog`、`runtime.py` 的 `/api/v1/runtime/ack`、`telemetry.py` 的 `/api/v1/telemetry/degradation`；`runtime/bootstrap` **明确豁免**（gate 未过也必须能拿到策略，否则客户端永远无法得知要升级——策略通道自锁排除）。
- 每请求一次单行 select（SQLite WAL 并发安全，无 N+1）。

### 2.4 bootstrap payload（runtime_service.py get_runtime_bootstrap）

- `update_policy` 块自动携带新字段（_update_policy_to_dict 扩展即生效），签名整包机制不变（Ed25519 canonical JSON，新字段进签名内容属自然行为）。

## 3. 桌面端主进程

### 3.1 新文件 enforce-gate.js（状态机）

状态：`idle → evaluating → blocking / verify-failed / pass`。

- `evaluate(policy, now)`（纯函数，TDD 主战场）：
  1. `policy == null` → 首次部署/未配置 → pass（fail-open 到"策略缺失不阻断"，与服务端 enforce_enabled 默认 0 对齐）；
  2. `policy.enforce_enabled !== true` → 清除本地缓存阻断态 → pass；
  3. `_compareVersions(app.getVersion(), policy.enforce_min_version) < 0` → **blocking**（目标版本 = policy.force_version 存在且大于当前则用它，否则用 enforce_min_version 显示）；
  4. 版本达标 → 清缓存 → pass。
- 宽限期（`onSyncOutcome`，判据 = `_applyRuntimeSettled` 的结果）：
  - 同步成功 → 持久化 `{ policy, fetchedAt }` 到 `userData/enforce-gate-state.json`（tmp+rename 原子写），重置计时；
  - 同步失败 → 读缓存：`now - fetchedAt < 72h` → 沿用缓存 policy 继续判定（fail-open 窗口）；≥72h 或无缓存 → **verify-failed**（验证失败视图：文案"版本验证失败，请检查网络后重试"+ 重试按钮 → 触发 syncNow）；
  - 缓存 policy 判定为 blocking → 无论宽限期，立即 blocking（阻断态不因断网缓解）。
- 三时机：`phase1-context` 启动后首次 bootstrap（既有 autoSyncOnStart 后沿 consumer 路径）→ evaluate；identity auth-service `_setState('authenticated')` 后经 phase1 注入的回调刷新（`opsCenterSync.syncNow()` → consumer → evaluate）；`setInterval 6h` 轮询（`unref()`，shutdown 清除）。
- 弹窗生命周期：`showGateWindow()` 创建 420×520 无边框、`alwaysOnTop('screen-saver')`、`closable=false`（`close` 事件 preventDefault + 日志）、`skipTaskbar:false`；主窗口 `mainWindow.hide()`；`hideGate()`（evaluate → pass 时）关闭弹窗并恢复主窗口。重复 evaluate 幂等（已有 blocking 窗口不重复创建，仅刷新文案数据）。
- 升级动作：gate 渲染层按钮 → IPC `enforce-gate:upgrade` → `autoUpdater.installNow()`（三态幂等：已下载直接装 / 未下载先下载后自动装 / 无更新报 not-available）。进度/失败经 `auto-updater.js` 新增 `onProgress(fn)` 订阅器透传给 gate 窗口（`download-progress` 百分比、`error` 重试按钮），不改动既有 `update:status` 渲染端广播。

### 3.2 gate 窗口渲染层

- 单 HTML（`electron/enforce-gate/gate.html` + 内联 CSS/JS，经 `loadFile` 加载，`contextIsolation:true`、`nodeIntegration:false`、preload 暴露 `enforceGate.upgrade()` / `enforceGate.onState(cb)`）。
- 文案字典 `enforce-gate-text.js`：`{ zh: {...}, en: {...} }` 按 `app.getLocale().startsWith('zh')` 选择，缺键回英文。
- 视图状态机：blocking（标题/正文/版本行/升级按钮/进度条隐藏）→ downloading（进度条 + 百分比 + `installingHint`）→ error（失败文案 + 重试按钮）。verify-failed 视图独立：无升级按钮，仅重试。

### 3.3 接线（bootstrap/phase1-context.js）

- `opsCenterSync.setUpdatePolicyConsumer(p => enforceGate.onPolicy(p))`（与既有 autoUpdater.applyPolicy 并列，不动原链）；
- `opsCenterSync.setOnSyncOutcome(...)`（新公开 setter，包装 `_applyRuntimeSettled` 结果回调，ops-center-sync 仅增透传不改逻辑）；
- identity auth-service 增 `onAuthenticated(fn)` 订阅器（`_setState` 命中 authenticated 时调用，照 setGetAccessToken 同构 setter 模式）；
- app quit 前 `enforceGate.dispose()`（清定时器、关弹窗）。

## 4. 后台管理页（ops-center/frontend）

- `UpdatePolicy.vue` 新增"强制升级阻断"卡片：`enforce_min_version` 输入框（占位"如 0.3.0"）、`enforce_enabled` 开关、语义说明文字（"低于此版本的客户端启动/登录时将被阻断，仅可升级；不影响既有提示/灰度逻辑"）、保存走既有 PUT `/api/v1/update-policy`（校验错误 toast 透出 400 文案）。
- 表单状态与既有三字段同份 payload 提交，不新增端点。

## 5. 测试策略（TDD 先行）

- **pytest**（ops-center/backend/tests/test_version_gate.py）：
  - 服务端：policy 双新字段 upsert 校验 5 例（格式/空值一致性/阻断线<提示线/开关语义/roundtrip）；
  - 版本门：带头达标放行、低于阻断线 426（detail.code=upgrade_required）、缺头 426（fail-closed）、坏头 426、enforce 关闭放行、无 policy 行放行、Cookie 会话豁免、bootstrap 端点不带门（豁免自锁）、426 body 结构；router 依赖注入断言（三个端点有门、bootstrap 无门）。
- **node:test**（apps/desktop/electron/services/enforce-gate.test.js）：
  - evaluate 纯函数 10 例（无策略/关闭/达标/低于/边界相等/坏版本串/目标版本选择/缓存沿用/宽限超期 verify-failed/缓存中有阻断）；
  - 窗口管理层 mock Electron app/BrowserWindow：幂等创建、close 拦截、hide/restore 主窗口、dispose 清理、宽限期时间边界（71.9h/72.1h）。
- **契约锁**：phase1-context 接线锁（consumer/outcome/authenticated 三钩子必须接线，照 qm1-child-env.test.js 先例）、enforce-gate-text zh/en 键集合一致性锁。

## 6. 风险与边界

| 风险 | 处置 |
|---|---|
| ops-center 故障 > 72h → 全员封锁 | 宽限期每次成功拉取重置；运维 Runbook 写明"封锁应急 = 后台把 enforce_enabled 置 0" |
| 运营误配 enforce_min_version 高于当前最新版 → 全员阻断 | upsert 校验阻断线 < 提示线；管理页说明 + 二次确认 |
| 下载失败（GitHub 不可达） | 失败重试按钮 + 明确错误文案；镜像源列后续路线图 |
| 破解者 patch 客户端 | 执法层 426 兜底（会员端点）；fuses/签名列后续 |
| 存量老版本无 gate 能力 | Q12 接受；下一次常规更新自然带下去 |
| 时钟回拨绕过宽限期 | 状态文件同时记录墙钟+单调时钟参考；回拨超 24h 视为时钟异常，维持现有缓存判定但打 WARN（不引入更重的可信时钟方案，边界写入 PRD） |

## 7. 后续加固路线图（本轮不做）

1. Electron fuses（onlyLoadAppFromAsar / runAsNode 禁用）+ QM-1 打包验证覆盖；
2. Windows 代码签名证书（sign: false → EV/OV 证书），提升篡改成本；
3. 下载镜像源（国内可达性）；
4. 服务端执法扩展到更多桌面端业务端点（当前仅 member）。
