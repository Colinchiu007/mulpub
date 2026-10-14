# PRD：运营中心远程化韧性（断连降级 / 批量告警 / 配置生效验证）

- 文档编号：PRD-OPS-CENTER-RESILIENCE-2026-10-08
- 日期：2026-10-08
- 状态：已实现（对应 openspec change `ops-center-resilience`）
- 架构方案：`01-docs/ARCH-OPS-CENTER-RESILIENCE-2026-10-06.md`
- 契约单一真源：`openspec/changes/ops-center-resilience/design.md`

---

## 1. 背景与要解决的问题

运营中心（FastAPI）即将部署到远程阿里云 ECS。网络不稳定的现实前提下，桌面端存在三类**用户可感知**的问题：

| # | 问题 | 用户看到什么 | 当前行为 |
|---|---|---|---|
| P1 | **重启/断连后配置大面积退回默认** | 菜单项变了、模板没了、平台字数限制变了、关键词监测空了 | 6 类数据走纯内存 setter，不落盘 |
| P2 | **网络抖一下付费用户被降级** | 付费功能突然提示「需要开通权限」 | 权益同步失败即清空本地快照（fail-closed） |
| P3 | **运营改了设置不知道生效没有** | —— | bootstrap 无版本号、客户端从不回执、断连期完全静默 |

P3 对运营负责人尤其关键：远程化部署后，「改了配置」与「客户端真的用上了」之间没有任何可验证的链路。

### 1.1 非目标（明确不做）

- 不改变通道 C（usage / diagnostics / scheduler 上报）的既有语义——其「水印仅成功时推进」已正确。
- 不把**管控类配置**内置进安装包：会员权益、密钥、限流配额、封号名单、计费规则一律不进。
  理由：过期的封号名单进包 = 客户端变成可篡改的黑名单绕过源。
- 不实现看板前端（V-4）、外部探针（A-5）、告警 Webhook（A-6）、审计写入点补全（V-5）、下钻页（V-6）。
  本 change 交付**数据通路与契约**，这些列入部署清单逐项勾掉。

---

## 2. 数据源分层（L1 / L2 / L3）

### 2.1 定义与读取顺序

| 层级 | 载体 | 生命周期 | 何时读 | 数据新鲜度 |
|---|---|---|---|---|
| **L1** | 主进程内存 `this._runtime` + 6 个注入管理器的内存态 | 单次运行 | 总是优先 | 本次会话最新 |
| **L2** | `settings['opsCenterRuntimeSnapshot']` | 永久，直到下次成功同步 | L1 缺失 / 应用启动时 | 上次成功同步时刻 |
| **L3** | `resources/ops-seed/runtime-bootstrap.json`（随 asar 发布） | 随版本 | L1 与 L2 均不可用 | 发版时刻 |
| **兜底** | 代码内置默认值 | 永久 | L1/L2/L3 均无 | 编译时刻 |

### 2.2 层级归属规则（`servingTier` 取值）

| 值 | 含义 |
|---|---|
| `L1` | 本次运行已成功同步，用的是实时数据 |
| `L2` | 用本地 SQLite 快照（断连或未同步过） |
| `L3` | 用安装包内置种子（连快照都没有） |
| `default` | 连种子都没有，用代码内置默认值 |

### 2.3 数据校验规则

**L2 快照（`opsCenterRuntimeSnapshot`）**

| 字段 | 校验 | 违反时 |
|---|---|---|
| 整体 | 必须为 object，非数组 | 视为无快照，落到 L3 |
| `syncedAt` | ISO8601 字符串 | 视为无快照 |
| 各数据块 | 类型与运行时一致（数组/对象） | 逐块跳过，不影响其余块 |
| 大小 | 单块序列化 ≤ 1MB | 丢弃该块并告警 |

**L3 种子文件（CI 强制，见 §7）**

**关键设计：L2 存「完整原始 payload」而非归一化摘要。**
理由：6 个注入管理器（`platform_defs` / `content_templates` / `keyword_watchlist` /
`rewrite_strategies` / `rewrite_hard_constraints` / `rewrite_ai_taste_map`）的**入参就是原始 payload 块**。
存原文 → 启动时把同一个 payload 再喂一次即可全部重放，无需为每个 setter 单独设计持久化格式。
这一次改动直接消灭「重启丢 6 类数据」的缺口。

---

## 3. 失败语义（最容易做错的地方，必须分清）

| 情形 | 判定 | 行为 | 数据处理 |
|---|---|---|---|
| **连接失败** | 超时 / DNS / 网络断开 / 5xx | **fail-open** | 保持旧值；**不写 L2**；**不推进 `syncedAt`**；warn 留痕；继续重试 |
| **契约破坏** | 验签失败 / 结构非法 | **fail-closed** | 拒绝应用任何新策略；保留旧值；**不推进 `syncedAt`**；warn 留痕 |
| **显式空配置** | 验签通过但某块为空 | 正常应用为空 | 落盘；**推进 `syncedAt`** |
| **账号被停用** | 响应 `status !== 'active'` | **fail-closed** | 清空权益快照 |

> **「连接失败」不等于「请求失败」**——这是本设计最容易写错的地方。
> 服务端明确拒绝（401/403）、响应结构非法，都属于「拿到了不可信/无效响应」，**不进宽限**。

---

## 4. 功能逻辑

### 4.1 同步主流程

```
启动
 └─ 从 settings 恢复 L2 → 重放 applyRuntime（L2 数据即刻可用，不等网络）
 └─ 3 秒后 best-effort 自动同步
     ├─ 成功 → 写 L2 → 推进 syncedAt → 计算 ACK（hash 变才发）
     │        → 上报本轮攒下的降级事件（恢复补报）
     └─ 失败 → 不动 L2 / 不同步时间戳 → 记降级事件（连续失败计数 +1）
              → 连续失败 ≥3 或累计 >30min → 判定「降级中」，写本地队列
```

### 4.2 ACK 频率控制

| 场景 | 是否发送 | `ack_type` |
|---|---|---|
| `config_hash` 变化 | 是 | `applied` |
| `config_hash` 未变且距上次 ACK < 24h | **否** | —— |
| `config_hash` 未变但距上次 ACK ≥ 24h | 是 | `heartbeat` |
| 断连恢复后首次成功 | 是 | `recovered` |

**用 hash 而非 version 判断**：否则每次发版所有客户端都会上报一次（几千台 × 每次发布 = 无谓流量）。

### 4.3 断连降级遥测

```
失败判定 → 累计连续失败次数 / 记录起始时刻 → 写本地队列（settings，不外发）
恢复成功 → 一次性上报本轮全部断连事件 → 成功即出队 / 失败保留，下轮再试
```

**本地队列约束**：上限 200 条，超出丢最旧（降级事件有天然时效性）；单条序列化上限 8KB。

### 4.4 会员权益宽限期（本 change 唯一改动 fail-closed 语义的地方）

| 本地快照 | token 状态 | 行为 | `source` |
|---|---|---|---|
| 无 | —— | **fail-closed**，降级 free | `null` |
| 有 | 未过期 | 按快照授权，功能完全不受影响 | `grace` |
| 有 | 过期 ≤72h | 宽限授权；**读功能全开，新增付费消耗禁用** | `grace` |
| 有 | 过期 >72h | fail-closed，降级 free | `null` |

**为什么首次安装仍 fail-closed**：无快照时无法区分「正版付费用户」与「未付费用户」，
fail-open 会让所有人白嫖。**有**快照时快照本身就是上次成功认证的证据，信任它合理。

**72h 的依据**：覆盖「周五晚断连 → 周一才发现」的最长常见周期。宽限期**只禁写不禁读**——
读功能（看历史、看已生成内容）完全不受影响，避免用户完全不可用。

---

## 5. 服务端接口契约

### 5.1 bootstrap 新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `config_version` | int | 单调递增，仅当内容指纹变化时 +1 |
| `config_hash` | 16 位小写 hex | 13 个数据块 canonical JSON 的 SHA-256 前 16 位 |

两者均在 **Ed25519 签名覆盖范围内**（写入 payload 早于签名步骤）——客户端可验证版本号非伪造，
否则 ACK 不可信。旧客户端忽略未知字段，向后兼容。

**hash 计算三条硬约束**：① 只取 13 块白名单，**不得纳入 `synced_at`**（否则每次请求 hash 都变 → 推送地狱）；
② 不得纳入 `config_version` / `config_hash` / `signature`（自指）；③ 缺失键以 `null` 参与而非跳过
（否则「删除一个数据块」与「该键本来不存在」无法区分，删除配置会静默不升版）。

### 5.2 新增端点

| 端点 | 鉴权 | 用途 |
|---|---|---|
| `POST /api/v1/runtime/ack` | Bearer JWT 或 `X-Catalog-Key` | 客户端上报生效回执 |
| `POST /api/v1/telemetry/degradation` | Bearer JWT 或 `X-Catalog-Key` | 客户端补报断连降级事件 |
| `GET /api/v1/runtime/rollout` | **仅管理员**（目录 Key 不放行） | 配置生效聚合 |
| `GET /api/v1/telemetry/degradation/summary` | **仅管理员** | 断连影响面统计 |

> 生效看板是内部运营数据，**不得**用客户端持有的目录同步 Key 读取——否则任何装了客户端的人
> 都能枚举运营侧的客户端清单。

### 5.3 入参校验（服务端一律 400，绝不静默丢弃）

**ACK**

| 字段 | 规则 |
|---|---|
| `client_id` | 必填非空字符串 ≤64 |
| `client_version` | 字符串 ≤32 |
| `config_version` | 整数 ≥0（**bool 不算整数**） |
| `config_hash` | 匹配 `^[0-9a-f]{16}$` |
| `applied_blocks` | object，值均为非负整数，键数 ≤32，键名 ≤64 |
| `skipped_blocks` | string 数组，元素非空 ≤64，个数 ≤32 |
| `ack_type` | ∈ `applied` / `heartbeat` / `recovered` |
| `degraded` | 必须是真正的 bool |
| `degradation_tier` | ∈ `L1` / `L2` / `L3` / `default` |
| `degraded_since` | ISO8601；`degraded=true` 时**必填且不得为空串** |

**降级事件**

| 字段 | 规则 |
|---|---|
| `channel` | ∈ `runtime` / `entitlement` |
| `failure_kind` | ∈ `timeout` / `dns` / `network` / `http_4xx` / `http_5xx` / `verify_failed` / `invalid_payload` / `auth_failed` |
| `consecutive_failures` | 整数 ≥1 |
| `degraded_since` | 必填 ISO8601，**空串等同缺失** |
| `offline_seconds` | 整数 ≥0，≤90 天 |
| `serving_tier` | ∈ `L1` / `L2` / `L3` / `default` |

> **空串必须与缺失同等拒绝**：客户端传 `degraded_since=""` 若放行，降级事件就没有真实起点，
> 看板上的断连时长无从计算。

### 5.4 落库语义（两张表刻意不同）

| 表 | 类型 | 理由 |
|---|---|---|
| `runtime_client_ack` | **快照表**（每 client_id 一行，保留最新） | 回答「**现在**多少客户端在最新版」，只需最新态 |
| `client_degradation_events` | **流水表**（一轮断连一行） | 回答「上周有多少用户受断连影响过」，必须留历史 |

### 5.5 生效聚合口径

```
total    = 见过面的客户端总数（活跃分母）
acked    = config_version == 所查版本
stale    = config_version <  所查版本（仍在用更旧的）
degraded = degraded == 1（断连降级中）

注意：degraded 与 acked 有交集——一台「已确认最新版但当前断连」的机器两边都算，
      因此 degraded 单独统计，不从 acked 里扣除。
```

---

## 6. 交互逻辑与显示项

### 6.1 设置 → 运营中心同步配置

| 显示项 | 取值 | 说明 |
|---|---|---|
| 配置来源 | `实时` / `本地快照` / `安装包内置` / `内置默认值` | 对应 L1/L2/L3/default |
| 数据时间 | `2026-10-08 14:30` | L1 取 `syncedAt`；L2 取快照写入时刻；L3 取 `_meta.exported_at` |
| 配置版本 | `v42 · a3f9c2e1` | 仅 L1/L2 有；L3 取 `_meta` |
| 降级状态 | `断连中 · 已持续 2 小时` | 仅降级时显示 |

### 6.2 会员权益宽限期提示

在**会员中心**的权益卡片上以副标题形式呈现，不弹窗、不打断操作：

- 状态标签：`宽限中`
- 提示文本：`网络暂时不可用，已使用上次验证的权益。{hours} 小时后将重新验证。`

### 6.3 提示文案（i18n key 一律 zh/en 成对）

新增命名空间 `opsResilience`（`apps/desktop/src/locales/zh.js` 与 `en.js` 必须同时新增）：

| key | 中文 | English |
|---|---|---|
| `opsResilience.tier.l1` | 实时配置 | Live configuration |
| `opsResilience.tier.l2` | 本地快照 | Local snapshot |
| `opsResilience.tier.l3` | 安装包内置 | Bundled defaults |
| `opsResilience.tier.default` | 内置默认值 | Built-in defaults |
| `opsResilience.dataTime` | 数据时间：{time} | Data updated: {time} |
| `opsResilience.configVersion` | 配置版本 v{version} · {hash} | Config version v{version} · {hash} |
| `opsResilience.offlineBanner` | 运营中心暂时无法连接，正在使用{fallback}。部分功能可能不是最新配置。 | Cannot reach the operations center. Using {fallback}. Some settings may be out of date. |
| `opsResilience.degradedSince` | 已断连 {duration} | Offline for {duration} |
| `opsResilience.entitlementGraceTag` | 宽限中 | Grace period |
| `opsResilience.entitlementGraceHint` | 网络暂时不可用，已使用上次验证的权益。{hours} 小时后将重新验证。 | Network unavailable. Using the entitlement verified on {time}. It will be re-checked in {hours}h. |
| `opsResilience.entitlementGraceWriteBlocked` | 宽限期内暂不支持新增付费操作 | New paid operations are unavailable during the grace period |

> 占位符统一用 `{name}` 风格（与既有 locale 一致）；多参数文案用函数式 `(ctx) => ...` 形式。

### 6.4 提示强度原则

| 场景 | 强度 | 理由 |
|---|---|---|
| 断连但功能完全可用 | **不打扰**（仅设置页可见） | 用户没遇到问题，弹窗只会制造焦虑 |
| 断连且影响功能（如平台元数据退回默认） | 一次性非阻断横幅 | 需要让用户知道「为什么平台字数限制变了」 |
| 会员进入宽限期 | 权益卡片副标题 + 付费操作按钮禁用说明 | 直接影响用户能不能用，必须说清楚 |
| 降级超过 24h | 横幅加「建议检查网络」 | 长时间降级多半是用户环境问题，不是服务端 |

---

## 7. L3 种子文件与 CI 校验

路径：`apps/desktop/resources/ops-seed/runtime-bootstrap.json`

```json
{
  "_meta": {
    "config_version": 42,
    "config_hash": "a3f9c2e1b7d4c2f9",
    "exported_at": "2026-10-08T10:00:00Z",
    "source": "https://ops.iart.work/api/v1/runtime/bootstrap"
  },
  "announcements": [], "update_policy": {}, "..."
}
```

生成：`node scripts/export-ops-seed.js`（从运营中心导出 → 剔除 `content_policy.word_list` → 写 `_meta`）。

CI 校验（`.github/scripts/check-ops-seed.js`）：

| # | 检查 | 级别 |
|---|---|---|
| 1 | 13 个数据块键齐全 | 失败 |
| 2 | 每块类型与运行时一致 | 失败 |
| 3 | 文件 ≤1MB（对齐 `MAX_CATALOG_BYTES`） | 失败 |
| 4 | UTF-8 无 BOM、无 U+FFFD | 失败 |
| 5 | `_meta.config_hash` 与实算一致 | 失败 |
| 6 | **`content_policy.word_list` 必须已剔除** | 失败 |
| 7 | `_meta.exported_at` 距今 >90 天 | **警告**（不阻塞） |

> 第 6 条是**安全硬约束**：敏感词库进安装包 = 可被逆向提取。把封禁词库打进客户端等于公开词库。

### 7.1 运行态怎么找到这份种子（2026-10-14 补，随 Node DEP0180 修复写回现实）

- **候选只有一个**：`OpsRuntimeSnapshot` 只探 `<app>/resources/ops-seed/runtime-bootstrap.json`，
  打包态该路径落在 `app.asar` 内（与 §7 上方「随 asar 发布」一致，由 `files` 白名单保证）。
- **曾有第二个候选已删除**：`<process.resourcesPath>/ops-seed/runtime-bootstrap.json`，注释写的是
  「extraResources 从 resources/ 拷出时」——但 `package.json` 的 `build.extraResources` 从未登记 `ops-seed`，
  安装后那条路径永远不存在。它表面上提供回退、实际一次都命中不了，还会让读者以为包外有副本，
  因此连同构造器形参 `resourcesPath` 与 `OpsCenterSync._resolveResourcesPath()` 一起删掉。
- **真要搬出包外**（比如为了让运营者可直接替换种子）：必须**同一个 PR** 里补 `extraResources` 登记 +
  恢复第二候选 + 恢复结构锁允许两个候选，三者缺一不可；只加其一会得到「配置说在包外、代码还在包内」的分裂态。
  回归锁 `resolveSeedPaths` 的第二条用例专门拦「只把候选加回来」这一半动作。
- **探测方式一律按文件描述符**：`fs.openSync` + `fs.fstatSync` + `finally` 里 `closeSync`。
  原因不是风格：种子在 asar 内，`fs.statSync` 的结果由 Electron 的 `asarStatsToFsStats` 构造，而它用的是
  Node 已废弃的 `fs.Stats` 构造 ⇒ **打包版每次启动都往 stderr 吐一行 `DEP0180`**。按现行 QM-1 三层判据，
  「stderr 非空且未命中红线」＝ NEEDS_REVIEW，于是每个改主进程的 PR 都会停在同一次人工判断上。
  实测对照（每种操作单独一个进程跑，因为 Node 每类弃用告警每进程只发一次）：
  `statSync`/`lstatSync`/`fs.promises.stat` **触发**；`existsSync`/`readFileSync`/`openSync+fstatSync` **不触发**；
  普通磁盘路径上三种都不触发（对照组，证明探针不是恒 0）。
- **必须先看大小再决定读不读**：超限（`MAX_SNAPSHOT_BYTES`，1MB）的种子要**拒绝加载**，而不是读进内存后再判。
  所以不能拿 `readFileSync` 的长度替代 `stat.size`。回归锁是一条 spy：超限场景下 `fs.readFileSync`
  的调用次数必须为 0（变异 M2 把判定挪到读盘之后就让它指名红）。
- **`exists` 与 `usable` 继续分开报**：文件在但超限/非法 ⇒ `exists:true, usable:false`；
  目录占位或文件缺失 ⇒ `exists:false` 且不抛错。合成「读不到就是没有」会把「种子被拒」误报成「没打包种子」。
- **结构锁**：`ops-runtime-snapshot.test.js` 末尾的 describe 断言 `_probeSeed` 函数体内
  不得出现 `fs.statSync`/`fs.lstatSync`/`fs.promises.stat`，必须出现 `fs.openSync`+`fs.fstatSync`，
  且 `closeSync` 在 `finally` 里。判据**先剥行注释再匹配**——函数注释里就写着被禁 API 的名字来解释为什么不用它。

---

## 8. 运营侧：怎么知道「改完生效了」

### 8.1 生效看板数据（`GET /api/v1/runtime/rollout`）

运营负责人应看到：

```
配置版本 42 · 内容哈希 a3f9c2e1 · 最近变更 2026-10-08 14:30
────────────────────────────────────────────────
生效进度  ████████████████░░░░  82%
  活跃客户端   2,245
  已确认生效   1,842 (82%)
  仍在用旧版     287  ⚠️
  降级中         116  🔴 ← 这批是断连用户

分块确认率:
  appMenu           97%  ✅
  featureFlags      94%  ✅
  contentTemplates  71%  ⚠️  ← 有问题？
```

这直接回答「改了之后真实生效了吗」——不再靠猜，直接看**生效比例 + 未确认原因**（断连 / 版本太老 / 某块未应用）。

### 8.2 告警分层（红线：绝不自监控）

| 场景 | 探测方式 | 依赖运营中心存活？ |
|---|---|---|
| 个别客户端断连 | 客户端本地队列 → 恢复后补报 | 否 |
| **大面积断连 / 运营中心宕机** | **外部探针**（阿里云云监控 / UptimeRobot）打 `/health` | **否** |
| ECS 宕机 / 磁盘满 / 证书过期 | 阿里云云监控 + 外部探针 | 否 |

> **任何「运营中心挂了 → 告警」的设计都不成立**。外部探针是唯一正确解法。
> 属基础设施配置（A-5），不在代码范围，但**必须在部署清单里勾掉**。

### 8.3 熔断阈值建议（部署后按实际基线校准）

| 指标 | 阈值 | 级别 |
|---|---|---|
| bootstrap 请求 QPS 环比骤降 | >80% 且持续 5min | P0 |
| 客户端心跳缺失率 | >30%（对比历史基线） | P1 |
| 降级事件上报量突增 | >3σ | P1 |
| 单客户端连续降级时长 | >24h | P2（可考虑提醒用户） |

---

## 9. 验收标准

| # | 场景 | 期望结果 |
|---|---|---|
| 1 | 断网后重启应用 | 菜单 / 公告 / 分类 / 平台元数据 / 模板 / 关键词 / 改写配置**全部可用**，无报错弹窗 |
| 2 | 断网状态下发布内容 | 发布流程完整可用（限流用 L2 配额） |
| 3 | 断网时会员用户登录 | 宽限期内**保持付费权益** |
| 4 | 首次安装即断网 + 付费用户 | 降级 free（fail-closed，符合设计） |
| 5 | 断网 → 恢复 | 自动同步，`syncedAt` 前进，ACK 上报，降级事件补报 |
| 6 | 运营改菜单 → 24h | 看板显示生效比例；未确认列表可下钻到具体客户端 |
| 7 | 打包版未配信任锚 | 明确报错「需配置自定义 Ed25519 公钥」，非静默失败 |
| 8 | 运营中心宕机 | **外部探针**告警触发（不依赖运营中心自身） |
| 9 | 1000 台客户端同时断连 | 恢复后降级事件集中上报，看板「降级中」计数正确 |
| 10 | 种子文件超 90 天未更新 | CI 警告但不阻塞 |
| 11 | 连续 3 次同步成功且 hash 未变 | **零 ACK 请求**（流量控制有效） |
| 12 | 客户端篡改 `config_hash` | 服务端 400；且 hash 在签名内，改了必然验签失败 |
| 13 | 配置里出现浮点（如 `0.5` 的限流阈值） | **两端 hash 机制上不一致** ⇒ 服务端记 error、`config_version=0`、`config_hash=""`，**策略本体照常下发**（不让整个 bootstrap 500）；客户端本轮**跳过写 L2 快照**并记 `runtime-snapshot-skipped` WARN，**既有的 L2 快照与内存态保持不变**，功能不中断（代价是这一版配置无法参与 ACK 比对，退回 24h 心跳） |
| 14 | 断连恢复后看 `degraded_since` | 是**降级起点**而不是恢复时刻（否则服务端算出的断连时长是错的） |
| 15 | 上报时无可用 transport（无 fetcher / 拿不到凭证） | 事件**留在本地队列**、ACK **不写记录**，只发告警 —— 「没发出去」绝不能被记成「已发送」 |

---

## 10. 实施中实测抓到的缺陷（供后续实现者避坑）

### 10.1 种子压根不会进安装包

`electron-builder` 的 `build.files` 只含 `dist/**` / `electron/**` / `node_modules/**` / `package.json`，
种子放 `apps/desktop/resources/ops-seed/` **根本不会被收集** ⇒ L3 兜底层静默变成空壳。
已补 `resources/**/*`。**单元测试验不了这类问题**（读取端能解析 ≠ 产物里存在），
只有真打包的 asar 清单能证明。

### 10.2 数据类型要对着消费方写，不要照着文档想当然

首版把 `contentCategories` 标成数组，实际服务端返回 `{items, count, synced_at}` 对象 ⇒
**导出自检第一次运行就失败**。正确判据必须逐条对着客户端 `applyRuntime` 的
`Array.isArray` / `typeof` 判定与各 normalize 函数的真实接受形态推导。

### 10.3 夹具比生产更顺，会替实现兜住缺陷（本 change 最值得记的一条）

两个独立缺陷，根因相同：

| 缺陷 | 夹具怎么"帮忙"兜住了 |
|---|---|
| `platform_defs` 恢复不回来（注入器比水合晚 217 行到达） | 测试把 6 个管理器全接在水合**之前** |
| 上报链路整条空转（构造时没传 `fetcher`） | 测试夹具**总是注入 fetcher** |

写测试时请直接问：**夹具的注入顺序与形态，和生产一致吗？夹具里有没有"总是存在"、
而生产可能为空的依赖？** 单块数据失效的症状与「压根没做」完全一样，靠读代码很难归因。

### 10.4 「跳过」不能与「成功」混淆

`_postJson` 在无可用 transport 时返回 `{code:0, skipped:true}`。若调用方只判 `code`，
就会把「什么都没发」记成「已发送」—— 降级证据被永久删除、ACK 污染看板且空烧心跳窗口。
凡是有 `skipped` / `no-op` 语义的返回值，**调用方必须显式判它**。

---

## 10. 部署前必做检查清单（ECS）

| # | 检查项 | 状态 |
|---|---|---|
| 1 | **配置自定义 Ed25519 信任锚**（否则打包版运行时策略全部拒绝） | ⬜ |
| 2 | 确认 `ops.iart.work` 域名与证书 | ⬜ |
| 3 | 确认 `/api/v1/me/*` 归属主机（`auth.iart.work` vs ops-center） | ⬜ |
| 4 | 生成并提交 L3 种子文件（`node scripts/export-ops-seed.js`） | ⬜ |
| 5 | **外部探针配置**（独立于运营中心） | ⬜ |
| 6 | 生成 L3 种子后跑一次 CI 校验（词库剔除项必过） | ⬜ |
| 7 | nginx 限流与超时配置 | ⬜ |
| 8 | SQLite 备份策略（三张新表在 `ops.db`） | ⬜ |