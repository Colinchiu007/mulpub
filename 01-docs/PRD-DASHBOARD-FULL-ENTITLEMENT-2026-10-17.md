# PRD：数据看板套餐分级与内容增强（dash-full-entitlement）

> 分支 `dash-full-entitlement` | 创建 2026-10-17 | 状态：实现中
> 前置：PR #3752（横幅视觉修正 + 位置回归锁）已确认「免费版提示在本页是误导」这一事实

---

## 一、背景与问题

### 1.1 两个真实缺陷

**缺陷 A：文案说谎。**
数据看板页顶部 `TrialBanner` 对免费版用户显示「当前为免费版，部分功能受限」。查证结论是**本页没有任何一项功能/内容因套餐受限**：

| 数据源 | 通道 | 门禁性质 |
| --- | --- | --- |
| 发布统计/趋势/平台分布 | `dashboard:stats` | `LOGIN_ONLY_FEATURE_MAP` → `publish_history`，**登录即可，不强制套餐** |
| 最近发布 | `history:list` | 同上 |
| 互动回流 | `performance:overview` | handler 内自判身份，**不读套餐** |

未登录时页面显示的是另一条独立的引导条（`.dashboard-login-gate`），与这条免费版横幅无关。

**缺陷 B：权益定义了但没接线。**
`packages/api-publish-engine/src/auth/plan-matrix.js` 中：

| 档位 | `dashboard` 字段 | 派生 feature |
| --- | --- | --- |
| free | `'basic'` | — |
| standard | `'full'` | `dashboard_full` |
| pro | `'full'` | `dashboard_full` |

`dashboard_full` 全仓 grep 结果：**只在 plan-matrix.js:153 定义、只在 plan-matrix.test.js:53 被断言存在**，无任何消费方。结果是「权益表上写了分级，界面上三档看到完全一样的东西」——这是误导的下游来源。

### 1.2 用户决策

用户选择 **方案 C**：既然本页确实没受限，就在本页**隐藏**这条误导横幅；同时**补充看板内容**，让 `dashboard_full` 真正落地为可见差异。

---

## 二、目标与非目标

### 目标
1. 撤下看板页那条误导的免费版横幅（本页无受限项，不再声称受限）
2. 让 `dashboard_full` 成为真实可见的差异：付费版比免费版多看若干块内容
3. 用**已存在但未使用**的数据源补充 3 个实用区块（零新增 IPC）
4. 免费版看到被锁区块时，给**诚实**的升级引导（说明能解锁什么，不说「部分功能受限」）

### 非目标（明确不做）
- **不改**服务端权益下发逻辑（`plan-matrix.js` 的矩阵值不动）
- **不新增** IPC 通道、不改数据库 schema
- **不改** `performance:overview` 等既有通道的返回形状
- **不动** `UpgradeModal` 的支付链路（它读本地 licenseStore 且正式包购买入口恒关，属既有技术债，本次只复用不修）

---

## 三、分级方案

### 3.1 判据：一律走服务端 entitlement，禁用本地 licenseStore

**关键约束（调研确认）**：渲染层**没有** `hasFeature()` 工具函数；`licenseStore.isPro` 会把 **standard 档误判为免费**（它是二值 isPro，不认三档）。`entitlement` 在未登录/未取到时是 **`null`**（不是空对象）。

因此新增单一真源工具，落点选 `views/member-center/labels.js`——它是全仓既有的「权益判定纯函数」约定位置（注释即写「壳层与各子视图共用」）：

```js
// 未登录/未取到 → null → false（降级为基本版，不崩）
export function hasFeatureOf(entitlement, feature) {
  return Boolean(entitlement && Array.isArray(entitlement.features) && entitlement.features.includes(feature))
}
```

### 3.2 分级对照表

| 区块 | 数据源 | free（basic） | standard / pro（full） |
| --- | --- | --- | --- |
| 4 张总览卡（发布/阅读/评论/粉丝） | `sync:cached` | ✅ | ✅ |
| 发布统计（累计/成功/失败/成功率） | `dashboard:stats` | ✅ | ✅ |
| 各平台数据卡片 | `sync:cached` | ✅ | ✅ |
| 最近发布 | `history:list` | ✅ | ✅ |
| **发布趋势（近 14 天）** | `dashboard:stats.daily` | 🔒 锁 | ✅ |
| **平台分布** | `dashboard:stats.perPlatform` | 🔒 锁 | ✅ |
| **作品互动回流** | `performance:overview` | 🔒 锁 | ✅ |
| **账号健康度**（新） | `accounts:batch-check-login` | ✅ | ✅ |
| **发布队列状态**（新） | `queue:status` + `queue:history` | ✅ | ✅ |
| **题材表现榜**（新） | `performance:list-pattern-performance` | 🔒 锁 | ✅ |

**为什么这 4 块归 full**：趋势/平台分布/互动回流是「分析型」内容，需要历史数据支撑才有意义；题材榜是归因分析结果，属进阶洞察。基础档保留的是「我发了多少、成功了没、账号正常吗」这类**运营必需**信息——不给足这些会让免费版用户无法判断基本可用与否，那是另一种伤害。

### 3.2.1 ⚠️「锁」的实现边界：只做渲染层门控，主进程不设防（Critical i1 修正）

**这是本方案最关键的一条自我修正。** 初稿把 `performance:overview` 列为 🔒 full-only，同时又在「非目标」里写明「不改既有通道返回形状」——**这两条互斥**：该 handler（`electron/ipc-handlers/performance-loop.js:95`）只判 `resolveIpcOwnerSubject` 认不认得出人，**完全不读套餐**，所以主进程侧根本拦不住。

因此明确「锁」的真实含义，不假装它是安全边界：

| 层 | 做什么 | 不做什么 |
| --- | --- | --- |
| **渲染层**（唯一落点） | 权益不含 `dashboard_full` → **不发起**该 IPC + **不渲染**真实内容，改渲染占位块 | — |
| **主进程** | 不动 | 不加权益校验、不改返回形状、不改门禁表 |

**必须如实记录的边界**：这是**体验分级，不是访问控制**。技术上具备动手能力的人仍能自己调 IPC 拿到数据。它的产品目的是「让套餐差异可见、给免费版升级动机」，不是防绕过。真正的访问控制必须在主进程做，那是另一个独立任务（需改 `CHANNEL_FEATURE_MAP`，牵动 `01-docs/ACCESS-CONTROL-MATRIX.md`），**本次不做**。

**为什么仍然值得做**：把它写成「权益门禁」是谎；写成「体验分级 + 明确边界」是可交付的事实。

### 3.2.2 锁区块内不发请求的连带收益

未解锁时不发起 IPC，顺带避免了一个歧义态：「请求已发出 but 被权益拒绝」——主进程不设防，所以请求会成功返回，但界面又不能显示，这个状态无从解释。不发请求就没这个状态。

### 3.3 免费版锁区块的显示形态（不是隐藏，是占位 + 诚实引导）

| 项 | 内容 |
| --- | --- |
| 显示项 | 区块标题 + 一行说明 + 「升级解锁」按钮 |
| 文案 | 标题保留（如「发布趋势（近 14 天）」）；说明行：`升级后查看近 14 天发布趋势` |
| 交互 | 点「升级解锁」→ `showUpgradeModal = true`（复用页面既有 UpgradeModal 接线） |
| ⚠️ 已知失效 | **`UpgradeModal` 的购买/激活/试用入口全是 `import.meta.env.DEV` 构建期常量，正式包恒关**（`components/UpgradeModal.vue` 内注释已自认：显示的价格与 `plan-matrix.js` 真实定价完全脱节）。即：**这个 CTA 在正式包里点了不会走到支付**，转化路径实际不可达（Critical i2）。<br>**本次处置**：仍保留 CTA（它是唯一已有的升级入口接线，且 dev 环境可用），但**不得**在文案里承诺「立即开通/立即支付」这类会落空的动作；文案用中性的「升级解锁」。真正的支付链路修复是独立任务，本次不做。 |
| 数据 | **不发起**对应 IPC 请求（省流量也避免拿到拿不到的数据） |
| `data-testid` | `dashboard-locked-<区块名>`，如 `dashboard-locked-trend` |
| 无障碍 | `role="status"` |

**形态决策理由**：整块隐藏会让用户不知道「原来还有这个」，也失去升级动机；骨架占位（假数据）是欺骗。占位 + 说明「升级后能看到什么」是唯一诚实且有转化价值的形态。

---

## 四、新增区块详细规格

### 4.1 账号健康度（free 可见）

- **数据源**：`accountBatchCheckLogin(accountIds)`（`src/api/publisher.js:106`）→ `accounts:batch-check-login`
- **数据来源**：账号 store 已加载的账号 id 列表
- **显示项**：
  - 总账号数、`正常` / `异常` / `未检测` 三态计数
  - 异常账号列表（平台名 + 账号名），最多显示 5 条，超出显示「还有 N 个」
- **状态机**：`loading`（首次）→ `ready` / `error`
- **空态**：无账号 → 不渲染本区块（不是显示 0）
- **错误态**：取数失败 → 显示 `账号状态暂时无法获取`，**不**渲染成「全部异常」
- **未登录**：该通道不在 public 列表，未登录返回 AUTH_REQUIRED → 显示登录引导，不显示 0
- `data-testid`：`dashboard-account-health`

### 4.2 发布队列状态（free 可见）

- **数据源**：`getQueueStatus()` + `getQueueHistory()`（`src/api/publisher.js:51/55`）
- **显示项**：运行中任务数、排队中数、**最近失败数**（近 20 条历史内 status=failed）、失败任务标题（最多 3 条）
- **失败数的口径**：只在 `queue:history` 返回的记录上统计，不自行推测原因
- **空态**：队列为空 → 显示 `当前没有进行中的发布任务`（这是合法空态，不是错误）
- **错误态**：`队列状态暂时无法获取`
- `data-testid`：`dashboard-queue-status`

### 4.3 题材表现榜（full 专属）

- **数据源**：`listPatternPerformance({ dimension: 'narrative_structure' })`（`src/api/knowledge-library.js:25`）
- **显示项**：Top 5 题材（value + engagement_score），按分数降序
- **空态触发条件（明确，Critical i5）**：以下任一成立即 `empty`，两者文案共用一条：
  1. `items` 数组为空（表内无归因记录）；
  2. `items` 非空但**全部** `engagement_score` 为 0 或缺失（有记录但无有效分）。
  - 不区分这两种情况给不同文案：用户无法据此行动，区分只会增加解释成本。
  - 文案必须点明成因：`暂无题材表现数据（需先发布并回采内容）`
  - 背景：该表依赖 `pattern-attribution-service.js` 要求 `rewrite_history_id` 非空且 `knowledge_refs` 含 `viral_library`，而 `phase4-events.js` 只在任务带 `rewriteHistoryId` 时才填 ⇒ **不经「从爆文库改写」路径发布的内容永远进不了该表**（既知归因断链）。空态必须说明原因，否则用户会以为功能坏了。
- `data-testid`：`dashboard-pattern-board`

---

## 五、数据校验与流程

### 5.1 权益读取流程

```
组件挂载
  → useIdentityStore().entitlement
  → null?                    → 降级 basic（不崩，不显示锁区块的升级按钮以外的东西）
  → features.includes('dashboard_full')?
      → true  → 渲染完整区块并发起对应 IPC
      → false → 渲染锁区块占位（不发 IPC）
```

### 5.2 各区块取数纪律（沿用既有范式）

| 纪律 | 要求 |
| --- | --- |
| 并行发起 | 三个新区块的 IPC 用 `Promise.allSettled` 并行，不串行 await |
| 单点失败不扩散 | 某区块失败只停该区块，其余照常渲染 |
| 不阻塞首屏 | 静态区块（标题/骨架）在 `nextTick` 即渲染，不等 IPC |
| 认证态变化重载 | `watch(identityAuthenticated)` 登录后自动重载（复用既有范式） |
| 未登录判据 | 一律用 `isAuthGateResult(res)` 单一实现，禁止各区块自判错误码 |

### 5.3 IPC 参数序列化

Vue ref/reactive 包装的对象直接传 IPC 会抛 `An object could not be cloned`。账号 id 列表从 store 取出后必须 `JSON.parse(JSON.stringify(...))` 脱壳再传。

---

## 六、文案清单（zh / en 成对）

新增键全部落在 `apps/desktop/src/locales/dashboard/{zh,en}.js`：

| key | zh | en |
| --- | --- | --- |
| `lockedHint` | 升级后查看{name} | Upgrade to view {name} |
| `lockedCta` | 升级解锁 | Upgrade |
| `accountHealthTitle` | 账号状态 | Account status |
| `accountHealthOk` | {count} 个正常 | {count} healthy |
| `accountHealthBad` | {count} 个异常 | {count} failed |
| `accountHealthUnknown` | {count} 个未检测 | {count} unchecked |
| `accountHealthLoadFailed` | 账号状态暂时无法获取 | Account status unavailable |
| `queueTitle` | 发布队列 | Publish queue |
| `queueRunning` | 运行中 {count} | Running {count} |
| `queuePending` | 排队中 {count} | Queued {count} |
| `queueFailed` | 最近失败 {count} | Recent failures {count} |
| `queueEmpty` | 当前没有进行中的发布任务 | No publish tasks in progress |
| `queueLoadFailed` | 队列状态暂时无法获取 | Queue status unavailable |
| `patternTitle` | 题材表现榜 | Topic performance |
| `patternEmpty` | 暂无题材表现数据（需先发布并回采内容） | No topic data yet (publish and let metrics sync) |
| `patternLoadFailed` | 题材表现暂时无法获取 | Topic performance unavailable |

**校验**：`.github/scripts/check-locale-sync.js` 四道判据（`--pair-base` / `--keys` / `--cjk` / `--py-cjk`）全接 CI Gate 7，只改一侧即 exit 1。

---

## 七、不做的降级（明确记录）

1. **不接 `analytics:overview`**：`src/api/` 无封装，且它走外部平台 API 带凭证，与 `sync:cached` 同源不同路，接进来会引入第二套口径冲突。
2. **不接 `usage:daily`**：读 **`userData/usage-data.json`（JSON 文件，功能使用量）**，与 `dashboard:stats`（**SQLite `publish_history` 表，发布量**）**存储层与语义层双双不同源**，当趋势接进看板是口径错误（Info i6 要求显式点明存储差异）。
3. **不做失败原因分布**：无现成聚合通道，只有 `record.error` 原文，需渲染侧 group-by——本次不做（避免前端自行发明统计口径）。

---

## 八、验收标准

| # | 验收项 | 判据 |
| --- | --- | --- |
| 1 | 看板页不再显示误导横幅 | `Dashboard.vue` 不含 `TrialBanner`；回归锁断言 |
| 2 | free 档看到锁区块占位 | features 无 `dashboard_full` → 4 个锁区块渲染占位 + 升级 CTA |
| 3 | full 档看到完整内容 | features 含 `dashboard_full` → 4 个区块渲染真实数据 |
| 4 | 未登录不崩 | entitlement=null → 降级 basic，不抛异常 |
| 5 | standard 不误判 | plan=standard（含 dashboard_full）→ 看到完整内容；**不得**用 licenseStore.isPro 判 |
| 6 | 三新区块状态机完整 | loading / ready / empty / error 四态各有断言 |
| 7 | i18n 成对 | check-locale-sync 四道全绿 |
| 8 | 回归锁 | 新增源码守卫，且**做过变异反证** |
| 9 | **feature 键名不漂移**（Critical i4） | 常量 `DASHBOARD_FULL_FEATURE === 'dashboard_full'`，且与 `plan-matrix.js` 派生名一致 —— 服务端一旦改名，全部 full 用户静默降级为 basic，是**无声故障**，必须有断言锁死 |
| 10 | **未解锁不发请求**（3.2.1） | free 档下 4 个锁区块对应的 IPC **零调用**（断言 mock 未被调用） |

---

## 九、风险

| 风险 | 缓解 |
| --- | --- |
| 服务端未下发 `dashboard_full`（老用户快照） | 降级为 basic，不崩；需在会员中心可见真实权益 |
| `UpgradeModal` 正式包购买入口恒关 | 已知技术债，本次复用不修；占位 CTA 指向它，转化路径实际不可达 —— 已在此明确记录 |
| E2E mock 的 features 键名已漂移（`ai_writer` 等） | 新测试按 `plan-matrix.js` 真源写 mock，不沿用旧 mock |
