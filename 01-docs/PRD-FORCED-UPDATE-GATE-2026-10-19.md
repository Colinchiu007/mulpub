# PRD：强制升级安全机制（Forced Update Gate）

> 日期：2026-10-19 ｜ 任务：forced-update-gate ｜ 状态：已定案（grilling Q1-Q12 全部按推荐）
> 关联：`openspec/changes/forced-update-gate/`（proposal/design/tasks）；执行记录落地后见 `openspec/records/forced-update-gate.md`

## 1. 背景与目标

当已发布版本出现**重大问题或安全漏洞**、修复已随新版本发出时，产品需要能力：让所有旧版本用户在**打开应用或登录进入应用时**看到不可关闭、不可绕过的弹窗——提示存在重大核心升级、必须升级后才能正常使用，仅显示一个"升级"按钮；点击后自动下载并安装新版。

同时必须考虑**exe 被破解**的场景：破解者可能篡改客户端、绕过弹窗继续使用旧版。因此本机制是**双层架构**：

| 层 | 归属 | 职责 | 定位 |
|---|---|---|---|
| 劝导层 | 桌面端主进程 | 阻断判定 + 全屏阻断弹窗 + 引导升级 | 正常用户 100% 覆盖；对破解者是成本而非保证 |
| 执法层 | ops-center 服务端 | 旧版本调用桌面端真实消费的机器端点 → 426 拒绝（model-presets/catalog、runtime/ack、telemetry/degradation） | 破解者 patch 掉弹窗后，联网同步/上报仍不可用 |

**诚实的威胁模型**（写入已知限制 §9）：exe 未签名、asar 可解包，客户端任何判断都可被技术用户移除。本机制的目标不是"绝对防破解"，而是：(a) 绝大多数普通用户被正确引导升级；(b) 破解者即使绕过弹窗，其客户端在服务端仍被降级为"不可用"（会员功能 426），破解价值大幅下降。

## 2. 用户故事

- **US-1（被阻断用户）**：我是 0.1.0 版用户，官方宣布 0.1.x 有重大漏洞并发布了 0.2.0。我打开应用 → 主界面不出现，弹出置顶窗口："检测到重要核心更新——当前版本存在重大问题，必须升级到新版本后才能继续使用。当前版本 0.1.0 → 新版本 0.2.0"【立即升级】。点击后显示进度"正在下载更新… 42%"，完成后应用自动退出安装并重启为新版。
- **US-2（升级失败用户）**：点击升级后下载失败（网络问题）→ 弹窗内变为"下载失败，请检查网络后重试"【重试】。应用仍然被阻断，无法跳过。
- **US-3（离线用户）**：我是被阻断用户但拔了网线 → 弹窗保持阻断（阻断态不因断网缓解）。
- **US-4（策略不可达的正常用户）**：我的版本达标，但 ops-center 暂时不可达 → 72 小时宽限期内正常使用；超过 72h 仍拉不到策略 → 显示"版本验证失败，请检查网络后重试"【重试】，无法进入主界面。
- **US-5（管理员）**：我是运营负责人，发现重大漏洞。打开 ops-center 后台 → 版本发布策略页 → "强制升级阻断"卡片 → 填写 enforce_min_version=0.2.0、打开开关、保存。所有低于 0.2.0 的客户端在下次启动/登录/6h 轮询时进入阻断。
- **US-6（破解者）**：我解包 asar、patch 掉 enforce-gate 判断 → 应用能进，但模型目录同步（model-presets/catalog）与生效上报（runtime/ack）等机器端点返回 426 Upgrade Required，同步链路不可用。

## 3. 数据与字段

### 3.1 ops-center `update_policy` 表（单行，id=1）

| 字段 | 类型 | 缺省 | 语义 | 本轮 |
|---|---|---|---|---|
| min_version | String | "" | 低于此版本**提示**升级（不阻断） | 既有不动 |
| force_version | String | "" | 低于此版本**自动下载**（不阻断不拦截使用） | 既有不动 |
| gray_ratio | Integer | 100 | 更新检查灰度比例（0-100） | 既有不动 |
| enabled | Integer | 1 | 策略总开关 | 既有不动 |
| **enforce_min_version** | String | "" | **低于此版本硬阻断**（必须升级才能使用） | 新增 |
| **enforce_enabled** | Integer | 0 | 阻断总开关（默认关） | 新增 |

**三条语义边界（防误配）：**
1. enforce 判定**不受 gray_ratio 灰度分桶影响**——阻断必须全员一致，灰度只作用于既有"检查更新"行为。
2. enforce_min_version 与 force_version 互不约束（force=自动下载体验，enforce=可用性闸门）。
3. `enforce_enabled=1` 时要求 `enforce_min_version` 非空，且当 min_version 非空时要求 `enforce_min_version < min_version`（阻断线必须严于提示线）。

### 3.2 服务端下发（GET /api/v1/runtime/bootstrap，Ed25519 签名整包）

`update_policy` 块新增两键透传（旧客户端忽略未知字段，向后兼容）：

```json
"update_policy": {
  "min_version": "", "force_version": "0.2.0", "gray_ratio": 100, "enabled": true,
  "enforce_min_version": "0.2.0", "enforce_enabled": true
}
```

### 3.3 客户端本地状态文件 `userData/enforce-gate-state.json`

```json
{
  "policy": { ...最后已知的 update_policy 对象... },
  "fetchedAt": "2026-10-19T06:00:00.000Z",
  "monotonicRefMs": 123456.789
}
```

- `tmp + rename` 原子写；读失败视为无缓存（fail-open 到宽限逻辑）。
- `monotonicRefMs` 记录写入时的单调时钟读数，用于检测时钟回拨（§8）。

### 3.4 服务端版本门请求头

客户端所有**机器通道**请求（Bearer / X-Catalog-Key 鉴权的 ops-center 端点）携带 `X-Client-Version: <app.getVersion()>`。**缺头/坏头按旧版处理（fail-closed → 426）**：存量旧客户端不发新头，正是执法对象；豁免面只有两个——Cookie 会话（运营后台人工操作）与 `runtime/bootstrap`（策略通道自锁排除，客户端必须先拿到策略才知道要升级）。

## 4. 数据校验规则

### 4.1 服务端 upsert（PUT /api/v1/update-policy，admin 鉴权）

| # | 规则 | 失败响应 |
|---|---|---|
| V1 | enforce_min_version 符合 `x.y.z` 数字段格式（复用 _validate_version） | 400 |
| V2 | enforce_enabled 仅接受 true/1 为真 | 静默转 0 |
| V3 | enforce_enabled=1 ⇒ enforce_min_version 非空 | 400 "启用强制阻断时必须填写 enforce_min_version" |
| V4 | enforce_enabled=1 且 min_version 非空 ⇒ enforce < min_version | 400 "强制阻断版本必须低于最低提示版本" |
| V5 | 既有 force < min 校验不变 | 400 |
| V6 | enforce_enabled=1 时必须已有上界：min_version 非空则 enforce < min_version；min_version 为空则以 force_version 为上界；两者全空禁止启用（防误配 99.0.0 全员硬锁，QM-6 二轮 i4） | 400 |

### 4.2 版本比较（服务端 `_cmp_version` / 客户端 `_compareVersions`）

- 按点分段转整数逐段比较，短段补 0；`0.2.0 == 0.2` 视为相等。
- 非法段（非数字）按 0 处理；空串视为"未配置"。
- 边界：`client == enforce_min_version` → 放行（"低于"是严格小于）。

### 4.3 客户端 evaluate 输入防御

- policy 非 Object / `enforce_enabled !== true` → 不阻断（并清除本地缓存）。
- `enforce_min_version` 非法（空/NaN 段）→ 不阻断 + WARN 日志（服务端误配不能把所有人锁死，fail-open 到"配置坏了=不阻断"，因为服务端有 V1-V4 兜底，到达客户端的坏值只剩传输损坏场景）。

## 5. 功能流程

### 5.1 检查时机（三处）

| 时机 | 触发 | 说明 |
|---|---|---|
| 启动 | phase1-context 装配后首次 bootstrap 拉取 | consumer 路径自然触发 |
| 登录成功后 | identity auth-service 进入 authenticated 状态 | `syncNow()` 刷新策略 → 重判 |
| 运行中 | 每 6 小时 `setInterval`（unref） | 管理员随时可改策略，最迟 6h 生效 |

### 5.2 判定状态机

```
evaluate(policy):
  policy 缺失/关闭        → pass（清缓存）
  client >= enforce_min   → pass（清缓存）
  client <  enforce_min   → blocking（showGateWindow）
```

同步结果钩子（onSyncOutcome）：

```
成功 → 缓存 {policy, fetchedAt=now} → evaluate(新 policy)
失败 → 有缓存且 now-fetchedAt < 72h → evaluate(缓存 policy)   # 宽限
     → 无缓存或 ≥72h          → verify-failed（验证失败视图）
```

**不变式**：缓存 policy 自身判定为 blocking 时，无论宽限与否立即 blocking——阻断态永不因断网缓解。

### 5.3 阻断窗口交互

| 状态 | 显示元素 | 可交互 |
|---|---|---|
| blocking | 标题 + 正文 + "当前版本 x.x.x → 新版本 y.y.z" + 【立即升级】 | 仅升级按钮 |
| downloading | 同上 + 进度条 + "正在下载更新… N%" | 按钮禁用 |
| error | 失败文案"下载失败，请检查网络后重试" + 【重试】 | 仅重试 |
| verify-failed | "版本验证失败，请检查网络后重试" + 【重试】（触发 syncNow） | 仅重试 |

窗口属性：无边框（frame:false）、置顶（alwaysOnTop screen-saver 级）、拦截 close 事件（preventDefault + 日志）、420×520 居中；主窗口同步 `hide()`，pass 时恢复。重复判定幂等（已有窗口不重建，仅刷新视图数据）。

### 5.4 升级动作链

点【立即升级】→ IPC `enforce-gate:upgrade` → `autoUpdater.installNow()`（既有三态幂等：已下载→quitAndInstall；未下载→downloadUpdate 成功后自动装；无更新→not-available）→ 进度经新 `onProgress` 订阅器推给 gate 窗口 → `update-downloaded` 后 quitAndInstall → 重启进新版 → 新版 evaluate → pass。

### 5.5 服务端执法链

三个桌面端真实消费的机器端点（`GET /api/v1/model-presets/catalog`、`POST /api/v1/runtime/ack`、`POST /api/v1/telemetry/degradation`）挂 `enforce_version_gate` 依赖：Cookie 会话豁免 → 读 `X-Client-Version` → **缺/坏头按旧版处理** → 读 policy → enforce 关闭或未配置放行 → `client < enforce_min_version` → **HTTP 426**，body：

```json
{ "detail": { "code": "upgrade_required", "min_version": "0.2.0", "message": "当前版本过低，必须升级后才能使用" } }
```

`GET /api/v1/runtime/bootstrap` **不挂门**（策略通道自锁排除：被阻断客户端仍须能拿到策略与阻断标志，否则永远无法得知要升级）。

## 6. 交互与显示细节

- 文案双语（zh/en），主进程按 `app.getLocale()` 前缀选择，缺键回英文：

| key | zh | en |
|---|---|---|
| gateTitle | 检测到重要核心更新 | Critical update required |
| gateBody | 当前版本存在重大问题，必须升级到新版本后才能继续使用。 | This version has a critical issue. You must update to continue using the app. |
| gateVersionLine | 当前版本 {current} → 新版本 {target} | Current {current} → New {target} |
| gateUpgradeBtn | 立即升级 | Update Now |
| gateDownloading | 正在下载更新… {percent}% | Downloading update… {percent}% |
| gateFailed | 下载失败，请检查网络后重试 | Download failed. Check your network and try again. |
| gateRetry | 重试 | Retry |
| gateVerifyFailed | 版本验证失败，请检查网络后重试 | Version verification failed. Check your network and try again. |

- 管理页（UpdatePolicy.vue）新增卡片文案：标题"强制升级阻断"；说明"低于此版本的客户端将在启动/登录时被阻断，仅可点击升级；不影响既有提示与灰度逻辑。启用前请确认新版本已发布且可用。"；保存失败 toast 透出后端 400 文案。
- 进度百分比取整显示；下载中按钮禁用防重复触发。

## 7. 验收标准

| # | 场景 | 期望 |
|---|---|---|
| A1 | enforce 关闭（默认部署） | 全链路行为与现状完全一致（零变化） |
| A2 | enforce 开启 + 旧版启动 | 弹窗出现、主窗口隐藏、无法关闭/绕过 UI |
| A3 | 弹窗点升级 | 进度显示 → 自动装 → 重启后不再阻断 |
| A4 | 下载失败 | 重试按钮可再次触发 |
| A5 | 断网 + 被阻断 | 保持阻断视图 |
| A6 | 断网 + 版本达标 + 72h 内 | 正常使用（宽限） |
| A7 | 断网 ≥72h + 无成功拉取 | verify-failed 视图，重试可恢复 |
| A8 | 旧版（或缺头/坏头）调 catalog/ack/degradation 机器端点 | 426 upgrade_required |
| A9 | 达标版调机器端点 / Cookie 会话 / bootstrap | 放行（bootstrap 无门） |
| A10 | 管理页 V3/V4 误配 | 400 且前端 toast 透出 |
| A11 | 策略运行中被改 | ≤6h 内生效（轮询） |

## 8. 边界与风险

| # | 边界/风险 | 处置 |
|---|---|---|
| R1 | 纯离线功能（本地编辑、本地发布队列）服务端够不着 | 架构边界，明确接受；执法层覆盖"联网权益" |
| R2 | ops-center 故障 >72h → 全员 verify-failed | Runbook：后台将 enforce_enabled 置 0 即全员解锁（应急开关即总开关本身） |
| R3 | 运营误配（阻断线高于最新版） | V3/V4 校验 + 管理页说明；若已生效，走 R2 应急 |
| R4 | 时钟回拨绕过宽限期 | 状态文件带单调时钟参考；回拨 >24h 判时钟异常，打 WARN 且维持缓存判定，不引入可信时钟重方案 |
| R5 | GitHub Releases 国内下载慢/失败 | 本轮失败重试；镜像源列后续路线图 |
| R6 | 存量更老版本无 gate 能力 | 接受：阻断能力随下一次常规更新下发（Q12） |
| R7 | 破解者 patch 客户端 | 执法层 426；fuses/签名列后续路线图（design.md §7） |

## 9. 已知限制（诚实清单）

1. 客户端阻断对"技术型用户 + 未签名 exe"只是成本，不是保证——执法层才是底线。
2. 服务端执法本轮覆盖三个桌面端真实消费的机器端点（catalog/ack/degradation）；bootstrap 豁免（自锁排除）、Cookie 会话豁免（运营后台）、桌面端会员 API（外部服务 auth.iart.work）不在 ops-center 执法范围。
3. 72h 宽限是可用性/安全性的折中：0-72h 内被阻断用户断网可继续用缓存策略判定（若缓存判定为达标）。
4. 轮询间隔 6h 意味着紧急场景下管理员手动配置后，已在运行中的客户端最迟 6h 后才被阻断；启动/登录路径是即时的。

## 10. 不做什么（Out of Scope）

- Electron fuses、代码签名证书、下载镜像源（后续路线图）。
- 服务端自定义阻断文案（enforce_message）。
- 渲染端阻断 UI（主进程独立窗口已覆盖，且规避内嵌视图遮挡问题）。
- iOS/移动端（本项目桌面范围）。
