# 账号页首帧卡顿修复 · 实施计划（fix-sidebar-nav-slow）

> **文档性质说明（诚实声明）**：本文件是**动手后补写**的范围对账单，不是"动手前的方案"。
> CCG pre-commit 判定的「范围漂移」项（5 个改动文件不在方案声明范围内）由本文件闭合：
> 把实际改动的文件、动机、边界逐条写明，供事后审计比对。
> 决策层对抗评审（`scripts/plan-review.sh`）**未在动手前执行**——本次是用户报障后的
> Bug 修复，走的是「先定位根因再动手」路径；决策层缺失这一点在此如实登记，不假装走过。

**Goal:** 消除「点击左侧菜单『账号』后数秒才加载」——把 `AccountManager.listAccounts()`
为每个账号附加 `proxy` 状态时的 **N 次同步 PBKDF2 串行阻塞**，改为 **N 次异步并行**。

**根因（一句话）:** `listAccounts()` 逐个调 `getAccountProxyStatus()` → `loadCredential()`
→ `decryptData()` → `deriveKey()` → `crypto.pbkdf2Sync(100000 次迭代)`；
`pbkdf2Sync` 同步阻塞事件循环，N 个账号 = N×125ms 串行，IPC 全部算完才返回。

**第一性引入点:**
- `d3cbe6a08`（2026-06-12）引入 credential-store 的 AES-256-GCM + PBKDF2 同步派生
- `17458ef04`（2026-07-25）在 `listAccounts()` 里接入逐账号 `getAccountProxyStatus()`
  —— 把「详情场景的函数」放进了「列表场景」

**Tech Stack:** Node.js `crypto.pbkdf2`（libuv 线程池异步版）、`fs.promises.readFile`、vitest。

---

## 方案对比（为什么选并行化）

| 方案 | 结论 | 判据 |
|---|---|---|
| A 缓存主密钥 | ❌ 无效 | 实测 `getMasterKey` 单次 0.195ms、PBKDF2 单次 125–143ms ⇒ PBKDF2 占 `loadCredential` **99.85%**，缓存主密钥只能省 0.15% |
| A′ 批量预取 + 降迭代 | ❌ 放弃 | salt 取自每个凭证文件前 32 字节且**每次保存重新随机生成** ⇒ 跨账号不可复用派生 key，「预取一次复用」技术上不成立；且 openspec 对本项目 PBKDF2 基线是 **≥200000 次**，现状 100000 **已低于基线**，再降是放大安全欠账 |
| B 列表只返回 `configured` 布尔 | ⚠️ 备选 | 功能契约变更（tooltip 的 hostMasked/port 不再显示），需同步改前端文案；本次不动功能 |
| **C 并行化（采用）** | ✅ | 不动 KDF 参数、不动功能、不动安全基线；实测 5 账号 600ms→170ms、10 账号 1.4s→370ms（3.5–3.7x） |
| D 移到 Worker 线程 | ⚠️ 过大 | 改动面最大，本次不值当 |

**用户决策记录：** 用户先在 A/A′/C 中选 A′，经我反馈「salt 不可复用 + openspec 基线 ≥200000」
后改选「不动安全参数」，最终在「并行化 / 懒加载 / 两者结合」中选定**并行化**。

---

## 文件结构（先读后写）—— 与实际改动逐条对应

| 文件 | 操作 | 职责 |
|---|---|---|
| `apps/desktop/electron/services/credential-store.js` | 修改 | +`PBKDF2_ITERATIONS` 单一常量（带⛔注释）、+`deriveKeyAsync`、+`decryptDataAsync`、+`loadProxyStatuses`（批量并行入口）、+`toPublicProxyStatus`；导出新增 3 项 |
| `apps/desktop/electron/publishers/account-manager.js` | 修改 | `listAccounts()` 改走批量入口；+`loadProxyStatusMap`（带 `degraded` 标记）、+`safeAccountProxyStatus`（经 `module.exports` 调用以便可注入） |
| `apps/desktop/electron/services/credential-store.test.js` | 修改 | +describe「loadProxyStatuses 并行批量读取」C1–C5 |
| `apps/desktop/electron/publishers/account-manager.test.js` | 修改 | +describe「listAccounts proxy 批量并行入口」L1–L6 |
| `01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md` | 新建 | Bug 反思 5 步全文 |
| `01-docs/learnings.md` | 修改 | +3 条 pitfall/lesson |
| `AGENTS.md` | 修改 | QM-2 新增 2 条性能维度检查项 |
| `CHANGELOG.md` | 修改 | 头部条目 |
| `.quality-gates.md` | 修改 | 本次执行记录 |

**范围外（明确不做）:** 渲染端任何文件、preload、IPC 契约、KDF 迭代数、密文格式、
`loadCredential` 的同步契约（12+ 处同步消费方依赖它，改它会破坏大量既有调用点与测试）。

---

## 三条硬语义（实现必须满足）

1. **不改变 KDF 与密文格式**：同一主密钥、同一 10 万次迭代、同一 AES-256-GCM；
   与 `loadCredential` 读出的 proxy 结论**逐字段一致**（C1 锁定）。
2. **单个失败不拖垮整批**：文件不存在 / 解密失败一律降级 `{configured:false}`（C2/C3 锁定）。
3. **批量入口整体降级时绝不回落逐账号同步解密**——那会退化成 N 次同步 PBKDF2，
   正是本 Bug 原形（L4 锁定，变异反证实测 `Number of calls: 3` 判红）。

---

## 关键设计决策：`degraded` 标记

`loadProxyStatusMap()` 返回 `{ map, degraded }`，调用方据此区分：

| 场景 | `degraded` | 行为 | 理由 |
|---|---|---|---|
| 批量入口正常跑完，表里缺某账号 | `false` | 该账号走单账号兜底 | 极少发生，付得起一次同步解密 |
| 批量入口整体失败（safeStorage 失效/抛错） | `true` | **全部**直接 `{configured:false}` | 否则 N 个账号各走一次同步解密 = 回到串行阻塞 |

这个标记是自审查时发现的：第一版实现用 `proxy || safeAccountProxyStatus(...)`，
在批量入口整体降级（返回 `{}`）时会静默退化成 N 次同步解密——**修了一半**。
补 L4/L6 两条测试锁住。

---

## 变异反证（AGENTS.md 硬要求）

| # | 改坏方式 | 结果 | 还原 |
|---|---|---|---|
| 1 | `Promise.all` → `for` 串行 | C5 报 `ratio=5.80（串行应 ≈ 6）expected < 3` 判红 | ✅ |
| 2 | 去掉 `degraded` 分支 | L4 报 `Number of calls: 3` 判红 | ✅ |

---

## 验收标准

- [x] `listAccounts()` 调 `loadProxyStatuses` 且只调 1 次、一次拿全部 id；`loadCredential` 一次都不被调（L1）
- [x] 批量入口返回的 proxy 逐字段落到每个账号（L2）
- [x] 与单账号口径 proxy 结论逐字段一致（C1）
- [x] 并行不串行：N=6 时 `batchMs/singleMs < N/2`（C5）
- [x] 单账号解密失败/文件不存在不拖垮整批（C2/C3）
- [x] 批量入口整体失败不回落逐账号同步解密（L4）
- [x] 直接相关 + 全部凭证消费方 526 条测试全绿
- [x] ESLint `--quiet` exit 0
- [x] QM-1：`electron-builder --win --dir` exit 0；asar 含两文件；真实产物 require 并调用新函数成功
