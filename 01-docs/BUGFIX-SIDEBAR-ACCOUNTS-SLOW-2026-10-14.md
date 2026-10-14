# BUGFIX — 应用左侧菜单点击「账号」反应特别慢（主进程 PBKDF2 串行阻塞）

- **状态**：已修复（待 CI 合并）
- **分支**：`fix-sidebar-nav-slow`
- **worktree**：`D:\Data\projects\mp-worktrees\mp-fix-sidebar-nav-slow`
- **发现日期**：2026-10-14
- **严重级别**：P1（核心入口可用性受损；账号数越多越慢，无上界）
- **用户原话**：

> 应用点击左侧的菜单时，比如"账号"，反应特别慢，好几秒才加载。查一下原因并修复。

---

## 0. 现象与量化

点左侧边栏「账号」后，工作区要等数秒才渲染出账号列表。**账号越多越慢，且没有上界**——这不是网络抖动，是随账号数线性增长的同步计算阻塞。

| 账号数 | 改造前首帧阻塞（实测） | 改造后（实测） |
|---|---|---|
| 1 | ~125 ms | ~125 ms |
| 5 | ~600 ms | ~170 ms |
| 10 | ~1.4 s | ~370 ms |
| 20 | ~2.5 s | ~1.3 s |

（测量方法：`account-manager.listAccounts()` 全流程 wall-time，PBKDF2 10 万次迭代、SHA-512、本机 12 核。）

---

## 1. ① 根因溯源（追到第一性引入点）

### 1.1 直接原因

渲染层点击「账号」→ `Accounts.vue` `onMounted` → `accountStore.load()` → IPC `accounts:list`
→ 主进程 `ipc-handlers/account.js:376` `AccountManager.listAccounts()`
→ **为每个账号附加 `proxy` 代理状态** → `getAccountProxyStatus(accountId, platform)`
→ `loadSavedCredentials()` → `credentialStore.loadCredential()`
→ `decryptData()` → `deriveKey()` → **`crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512')`**。

`pbkdf2Sync` 是**同步** API，它阻塞 Node 事件循环。N 个账号 = N 次同步 PBKDF2 串行执行，
IPC handler 在全部算完之前无法返回，渲染层的 `await` 就一直挂着。

### 1.2 第一性引入点（两个独立改动叠加）

| 引入提交 | 日期 | 贡献 |
|---|---|---|
| `d3cbe6a08` `feat: integrate 参考产品 reverse engineering findings` | 2026-06-12 | 引入 `credential-store.js` 的 AES-256-GCM + PBKDF2 10 万次迭代派生。**这是性能特征的源头**：设计意图是"凭证要抗离线暴力破解"，迭代数选得高是对的；但它同时是同步实现 |
| `17458ef04` `feat(publish): harden account lifecycle and platform workflows` | 2026-07-25 | 在 `listAccounts()` 里接入 `getAccountProxyStatus(accountId, platform)`，把「逐个账号解密凭证」放进了**列表**这条路径 |

`git log -S 'getAccountProxyStatus(accountId, platform)'` 定位到后者；`git log -S '100000, KEY_LENGTH'` 定位到前者。

### 1.3 为什么会写成这样（动机推测，非借口）

`17458ef04` 的意图是"harden account lifecycle"——让账号列表能显示每个账号是否绑定了代理。
实现上最省事的方式就是复用已有的 `getAccountProxyStatus()`（它本来就是给单账号详情/代理弹窗用的）。
**没有追问"列表场景是否需要为每个账号付一次完整的凭证解密"**：

- `getAccountProxyStatus()` 为了读一个 `proxy` 字段，解密的是**整份**凭证（cookies + localStorage + indexedDB + accountInfo）；
- 而 `listAccounts()` 是**每次进账号页都会走**的高频路径。

这是典型的"详情场景的函数被放进了列表场景"——单账号视角完全合理，批量视角就是灾难。

### 1.4 关键约束（决定了修复形态）

`deriveKey(masterKey, salt)` 的 salt 来自每个凭证文件的前 32 字节，且 `encryptData()` 每次保存都生成**新的随机 salt**。
所以：**同一 owner 下不同账号的 salt 不同，同一账号的多次保存 salt 也不同 ⇒ 无法跨账号缓存派生 key。**

这一条实测判据（本机）：
- `getMasterKey` 单次 0.195 ms
- `PBKDF2` 单次 125–143 ms
- **PBKDF2 占 `loadCredential` 总耗时 99.85%**

因此"缓存主密钥"只能省 0.15%，杯水车薪；**唯一有效的方向是让 N 次 PBKDF2 并行，或者让列表场景根本不解密**。

---

## 2. ② 测试逃逸分析（按测试层级列出逃逸链）

| 层级 | 是否存在该场景测试 | 为什么没拦住 |
|------|-------------------|--------------|
| 单元测试 | ❌ **无性能契约** | `credential-store.test.js` 15 条用例全部断言**功能正确性**（round-trip、主密钥信封、fail-closed、原子写、owner 隔离），**零条**断言耗时或阻塞特征。`account-manager.test.js` 的 `listAccounts` 用例只 mock 掉 `loadCredential`（`mockReturnValue`），于是测试 realm 里一次 PBKDF2 都没真跑过——**mock 把唯一的性能热点整个抹掉了** |
| 集成测试 | ❌ 无 | 没有"`accounts:list` IPC 端到端 + 多账号 + 计时"的用例 |
| E2E / 视觉回归 | ❌ 结构性不可见 | 像素对比看的是"最终画面长什么样"，而本 Bug 的画面**完全正常**，只是迟到。慢而不错，视觉回归天然免疫 |
| 代码审查 | ❌ 无性能维度 | 审查清单（AGENTS.md QM-2）覆盖 require 路径、IPC 序列化、注释语法、Electron 安全等，**没有"同步加密原语放进高频列表路径"这一类检查项** |
| 压测 / 基准 | ❌ 不存在 | 仓库无账号页性能基线，也就没有"这次改动让它变慢了吗"的可比对对象 |

**逃逸链一句话**：
`功能测试 mock 掉 loadCredential → PBKDF2 从未在测试里真跑 → 无性能契约 → 视觉回归只看画面不看迟到 → 审查清单无性能维度 → 无基线可比对`，五道关口全部失效。

其中**最尖的一条是单元测试层的 mock**：`vi.spyOn(credentialStore, 'loadCredential').mockReturnValue({...})`
让测试世界里的"解密"变成一次同步函数调用返回假对象，**被 mock 掉的恰好是整个 Bug 的唯一热点**。
这与仓库已有的一条 learning（"mock 把真实依赖抹掉后，问题在 mock 边界之外"）同型，但此前只在前端/传输层识别过，没有在"同步 CPU 密集原语"上识别过。

---

## 3. ③ 系统性漏洞定位

| 类别 | 具体漏洞 | 位置 |
|---|---|---|
| **测试覆盖漏洞** | 凭证层测试只验功能、不验耗时；且用同步 mock 把 PBKDF2 整个跳过 | `apps/desktop/electron/services/credential-store.test.js` |
| **测试质量漏洞（mock 边界）** | 为"隔离磁盘 IO"而 mock `loadCredential`，同时把唯一的 CPU 热点也隔离了——**mock 的粒度大于它想隔离的依赖** | `account-manager.test.js` 既有 20+ 处 `mockReturnValue` |
| **门禁缺失漏洞** | 无"高频 IPC 路径不得含同步 CPU 密集原语"的静态检查 | `.github/workflows/` 无对应 job |
| **审查盲区** | QM-2 清单无性能维度，"详情函数复用到列表路径"这类结构性误用无检查项 | `AGENTS.md` QM-2 |
| **可观测性漏洞** | `accounts:list` IPC 有耗时日志（`耗时=${Date.now()-startedAt}ms`），但**没有任何阈值告警**——慢 3 秒和慢 30 毫秒在日志里长得一样，都不会有人看 | `ipc-handlers/account.js:380` |

---

## 4. ④ 修复 + 回归保护测试

### 4.1 修复内容（三个文件）

**`apps/desktop/electron/services/credential-store.js`**
- 提取 `PBKDF2_ITERATIONS = 100000` 单一常量，同步/异步两条路径共用，并在常量上方写死⛔注释：**不得为性能调小它**（openspec 规格对本项目 PBKDF2 的基线是 ≥200000 次，100000 已低于基线，再降是放大安全欠账）。
- 新增 `deriveKeyAsync()`：`crypto.pbkdf2`（libuv 线程池版），**参数与同步版逐字节一致**（实测同 masterKey/salt 下 key 完全相同）。
- 新增 `decryptDataAsync()`：与 `decryptData` 同一密文格式，仅派生步骤并行化。
- 新增 `loadProxyStatuses(accountIds, userDataDir, options)`：批量并行入口。先做存在性筛查（文件不存在的账号不读主密钥、不跑 PBKDF2），再一次读主密钥，然后所有账号的 PBKDF2 **同时**丢进线程池。

**`apps/desktop/electron/publishers/account-manager.js`**
- `listAccounts()` 改走 `loadProxyStatuses()`，**不再**逐账号 `getAccountProxyStatus()`。
- 新增 `loadProxyStatusMap()`：批量入口整体失败（抛错）时降级为空表，由调用方回落单账号口径——账号页首帧绝不被凭证层故障打挂。
- 新增 `safeAccountProxyStatus()`：单账号兜底的安全包装。**必须经 `module.exports` 引用调用**（文件头 26–29 行已有同族教训：require 期解构成本地绑定会让 `vi.spyOn` 拦不到、测试静默走真实实现）。

**`apps/desktop/electron/publishers/account-manager.test.js`**（新增 5 条回归锁，见 4.2）

### 4.2 回归保护测试

**A. `credential-store.test.js` 新增 describe「loadProxyStatuses 并行批量读取」（5 条）**

| # | 断言 | 模式 |
|---|---|---|
| C1 | 与逐账号 `loadCredential` 的 proxy 结论**逐字段一致**（configured/type/hostMasked/port/hasAuthentication） | 单元（功能等价性） |
| C2 | 解密失败（密文损坏）时该账号降级 `{configured:false}` 且**不抛错**、不影响同批其它账号 | 单元（韧性） |
| C3 | 凭证文件不存在时 `{configured:false}` **且不触发主密钥读取**（spy `getMasterKey` 断言未被调用） | 单元（短路正确性） |
| C4 | 空输入返回空对象；legacy 与 owner 命名空间分别取到各自文件 | 单元（命名空间隔离） |
| **C5** | **并行不串行**：N=6 时 `batchMs / singleMs < N/2`。实测并行 2.1、串行 5.8 ⇒ 阈值 3.0 有充足余量 | **性能契约（本 Bug 的回归锁）** |

**B. `account-manager.test.js` 新增 describe「listAccounts proxy 批量并行入口」（5 条）**

| # | 断言 | 模式 |
|---|---|---|
| L1 | 必须调用 `loadProxyStatuses` 且**只调 1 次**、一次拿全部 id；`loadCredential` **一次都没被调**（逐账号解密必须绝迹） | 结构锁 |
| L2 | 批量入口返回的 proxy 逐字段落到每个账号上（不是装饰） | 单元 |
| L3 | 批量入口漏掉某账号时回落单账号口径，proxy 字段不得消失 | 单元（兜底） |
| L4 | 批量入口**抛错**时 `listAccounts` 仍成功返回 3 个账号 | 单元（韧性） |
| L5 | 单账号口径自身抛错时也降级，不向上冒泡 | 单元（韧性） |

### 4.3 变异反证（AGENTS.md 硬要求：证"锁本身在跑"）

把 `loadProxyStatuses` 的 `Promise.all` 临时改成 `for` 串行循环，重跑 C5：

```
FAIL  C5 并行不串行
AssertionError: batch=693ms single=119ms ratio=5.80（串行实现应 ≈ 6）: expected 5.80 to be less than 3
```

ratio 5.80 ≈ N=6，被阈值 3.0 稳稳判红。**锁确实在跑**，不是"业务改动变红所以锁有效"的那种假绿。

### 4.4 安全等价性证明

```
同步/异步派生 key 逐字节相同: true
key length: 32 bytes
```

KDF 参数（masterKey / salt / 100000 次 / SHA-512 / 32 字节输出）与密文格式一字未改，
抗离线暴力破解的能力与改造前完全等价。**本次是纯并发改造，不是降强度改造。**

---

## 5. ⑤ 预防措施（防止再次发生）

| # | 措施 | 落地文件 |
|---|---|---|
| 1 | **Bug 反思文档**（本文件） | `01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md` |
| 2 | **性能契约进测试**：凭证层新增"并行不串行" wall-time 回归锁；mock 不得覆盖 CPU 热点（C3 用 spy 断言 `getMasterKey` 未被调用，C5 用真实计时） | `credential-store.test.js` |
| 3 | **结构锁防回退**：`listAccounts` 必须走批量入口、`loadCredential` 一次都不能被调 | `account-manager.test.js` L1 |
| 4 | **QM-2 新增检查项**：「高频 IPC / 列表路径不得含同步 CPU 密集原语（`pbkdf2Sync`/`scryptSync`/`createHash` 大输入）；详情函数复用到列表路径前必须问『每个元素各付多少成本』」 | `AGENTS.md` QM-2 |
| 5 | **learnings 沉淀**：`mock 的粒度大于它想隔离的依赖`（同步 CPU 密集原语被功能 mock 整个抹掉）+ `慢而不错的缺陷对视觉回归结构性免疫` | `01-docs/learnings.md` |
| 6 | **CHANGELOG** 条目 | `CHANGELOG.md` |
| 7 | **KDF 常量加⛔注释**：PBKDF2 迭代数不得为性能下调，并指向 openspec 的 ≥200000 基线 | `credential-store.js` 常量处 |

### 5.1 仍未闭合的（登记，不假装已解决）

- **`accounts:list` IPC 慢日志无阈值告警**：`ipc-handlers/account.js` 已打 `耗时=Nms`，但没有任何东西会对"N 秒"告警。本次未加（属于可观测性增强，独立切片）。
- **10 万次迭代低于项目自身基线**：`openspec/specs/ops-center/local-login/spec.md` 要求 ≥200000 次，`credential-store.js` 用 100000 次。本次**刻意不动**（调它会让存量密文解不开，必须配兼容回退，属独立安全切片）。已在代码注释与本文登记。
- **并行化的 CPU 成本**：N 个账号并行仍要付 N 次 PBKDF2 的总 CPU，只是不再串行阻塞 IPC。账号数极大时（>50）会吃满线程池，可能影响同刻其它 IPC。当前账号量级（个位到十几）无实际影响；若将来出现，正解是"列表场景只返回 `configured` 布尔、详情场景才解密"，已在方案评估中记录。

---

## 6. 变更文件清单

| 文件 | 变更 |
|---|---|
| `apps/desktop/electron/services/credential-store.js` | +`PBKDF2_ITERATIONS` 常量（带⛔注释）、+`deriveKeyAsync`、+`decryptDataAsync`、+`loadProxyStatuses`、+`toPublicProxyStatus`；导出新增 3 项 |
| `apps/desktop/electron/publishers/account-manager.js` | `listAccounts` 改走批量并行入口；+`loadProxyStatusMap`、+`safeAccountProxyStatus` |
| `apps/desktop/electron/services/credential-store.test.js` | +describe「loadProxyStatuses 并行批量读取」5 条（C1–C5） |
| `apps/desktop/electron/publishers/account-manager.test.js` | +describe「listAccounts proxy 批量并行入口」5 条（L1–L5） |
| `AGENTS.md` | QM-2 新增性能维度检查项 |
| `01-docs/learnings.md` | +2 条 pitfall |
| `CHANGELOG.md` | +本次条目 |
| `01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md` | 本文件 |
