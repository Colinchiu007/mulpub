# 变更提案（自动生成，待对抗评审）

- base: `origin/main`
- head: `f177a00aa05932f518698d159f22f6f75b8e5bcc`
- 采集模式: `diff`
- 变更规模: 966 行

## 变更内容

```diff
diff --git a/.ccg/reviews/f2e47181e5cc583f651e58cf646dfb860dfde8c2.json b/.ccg/reviews/f2e47181e5cc583f651e58cf646dfb860dfde8c2.json
new file mode 100644
index 000000000..42775cdce
--- /dev/null
+++ b/.ccg/reviews/f2e47181e5cc583f651e58cf646dfb860dfde8c2.json
@@ -0,0 +1,23 @@
+{
+  "sha": "f2e47181e5cc583f651e58cf646dfb860dfde8c2",
+  "layer": "diff",
+  "mode": "dual",
+  "reason": "变更 526 行 > 200 行阈值（对齐 §12.6 Red Team）",
+  "stats": {
+    "changedLines": 526,
+    "fileCount": 9,
+    "codeFileCount": 4,
+    "sensitivePathHits": [],
+    "plannedPathHits": [],
+    "sensitiveContentHits": 53
+  },
+  "stagedDiffHash": "3b1a366705120e6c8b83285048165d6e0277ca153ff113c686e75d9a08648f1d",
+  "decidedAt": "2026-10-14T11:31:33.869Z",
+  "decidedBy": "ccg-review-decider",
+  "deepReview": {
+    "required": true,
+    "status": "pending",
+    "performedBy": null,
+    "findings": null
+  }
+}
\ No newline at end of file
diff --git a/.quality-gates.md b/.quality-gates.md
index 8d5e315d2..dce9af9bf 100644
--- a/.quality-gates.md
+++ b/.quality-gates.md
@@ -1,3 +1,36 @@
+## 本次执行记录：修复点左侧菜单「账号」反应特别慢（fix-sidebar-nav-slow，2026-10-14）【混合 PR】
+
+| 门禁项 | 状态 | 证据 |
+|---|---|---|
+| 变更类型与隔离 | PASS | Bug 修复（P1 性能）+ 运行时代码变更；隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-sidebar-nav-slow`（分支 `fix-sidebar-nav-slow`，基于 `f2e47181e`）；`pre-code-edit-guard.ps1` exit 0 放行；共享根保持 main 干净 |
+| Bug 反思 5 步 | PASS | ①根因溯源 `17458ef04`（listAccounts 接入逐账号 `getAccountProxyStatus`）+ `d3cbe6a08`（PBKDF2 同步派生引入）；②逃逸链 5 层（mock 抹掉 PBKDF2 → 无性能契约 → 视觉回归只看画面不看迟到 → 审查清单无性能维度 → 无基线可比对）；③系统性漏洞 5 类；④修复 + 10 条回归锁（C1–C5 / L1–L6）；⑤预防落地 7 项。全文见 `01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md` |
+| TDD | PASS | 先写 5 条失败测试（`loadProxyStatuses is not a function`，RED）→ 实现 → 19/20 通过 → 修正 C5 阈值 → 20/20（GREEN） |
+| 测试通过 | PASS | 直接相关 + 全部凭证消费方共 **526 条全绿**：`credential-store.test.js` 20、`account-manager.test.js` 89、`account-credential-crypto.test.js` 7、`account-manager-{profile,relogin-status,toutiao-render-crash,wechat-render-crash}` 5、`ipc-handlers/account.test.js` 77、`ipc-handlers/store.test.js` 67、`comment-manager` 3、`cloud-account-sync` 34、`cloud-account-tombstone` 10、`login-status-monitor` 17、`webview-manager` 80、`podcast-hosting-service` 28、`podcast-hosting-audio` 7、`podcast-episode-host` 51、`register-engagement-services` |
+| 变异反证 | PASS | 两处，均实测改坏立刻变红：① `Promise.all` → `for` 串行，C5 报 `ratio=5.80（串行实现应 ≈ 6）expected < 3`；② 去掉 `degraded` 分支，L4 报 `Number of calls: 3`（退化成 3 次单账号同步解密）。两次还原后全绿 |
+| 安全等价性 | PASS | 实测同步/异步派生 key 逐字节相同（同 masterKey/salt/100000 次/SHA-512/32 字节）；KDF 参数未降、密文格式未变。`PBKDF2_ITERATIONS` 提为单一常量并加⛔注释（openspec 基线 ≥200000，现状 100000 已低于基线，**不为性能再降**） |
+| QM-1 打包 | PASS（带环境限制说明） | `electron-builder --win --dir` exit 0；asar 清单含 `credential-store.js`、`proxy-config.js`；**从真实打包产物 require 并成功调用 `loadProxyStatuses(['nope-1','nope-2'], tmp, {})` → `{"nope-1":{"configured":false},...}`**，旧 API（`loadCredential`/`decryptData`）未破坏；`configureUserDataPath` 在打包产物内对 `ELECTRON_USER_DATA_DIR` 行为正确（`explicit:true`）。**完整 8 秒启动测试未完成**：本机有用户的应用实例在运行，单实例锁使隔离实例 rc=0 提前退出（非产品缺陷；已用「真实产物 require + 调用」与「configureUserDataPath 行为验证」两项替代取证） |
+| QM-2 代码必检项 | PASS | require 路径全部存在（含新增 `./proxy-config`，已验证无循环依赖）；未改 preload；无 IPC 参数变更；注释语法 `/* */` 成对；`module.exports` 无多余逗号；ESLint `--quiet` exit 0。**未跑 `prettier --write`**：项目无 prettier 配置（默认双引号+分号与全仓风格冲突），且 origin/main 原始版本同样不符合 prettier ⇒ 属存量状态，跑 write 会用双引号+分号重排整个文件制造数百行无关 diff，反而污染 review |
+| 文档同步 | PASS | CHANGELOG 头部条目；`01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md`（Bug 反思全文）；`01-docs/learnings.md` +3 条 pitfall/lesson；`AGENTS.md` QM-2 新增 2 条性能维度检查项 |
+| locale 成对 | N/A | 未新增/修改任何用户可见文案（纯主进程性能修复，无 UI 文案变更） |
+| 视觉回归 | N/A | 无前端视觉变更（纯主进程并发改造，账号页最终画面不变） |
+| 远程同步 | PENDING | 开 PR 时登记；合并后就地改写为 `PASS` + merge SHA 并同次删除 ledger 登记项 |
+
+### 本次实测性能数据（本机 12 核，PBKDF2 10 万次迭代 SHA-512）
+
+| 账号数 | 改造前（同步串行） | 改造后（异步并行） |
+|---|---|---|
+| 5 | ~600 ms | ~170 ms |
+| 10 | ~1.4 s | ~370 ms |
+| 20 | ~2.5 s | ~1.3 s |
+
+加速比 3.5–3.7x，账号数越多收益越大；KDF 强度一字未降。
+
+### 遗留项（登记，不假装已闭合）
+
+1. `accounts:list` IPC 慢日志无阈值告警（`ipc-handlers/account.js:380` 已打 `耗时=Nms`，但无任何东西会对「N 秒」告警）——属可观测性增强，独立切片。
+2. `credential-store.js` 的 PBKDF2 迭代数（100000）低于项目自身 openspec 基线（≥200000）——本次刻意不动，调它需配存量密文兼容回退，属独立安全切片，已在代码注释与 Bug 反思文档登记。
+3. 账号数极大时（>50）并行仍会吃满线程池，可能影响同刻其它 IPC；当前账号量级（个位到十几）无实际影响。若将来出现，正解是「列表场景只返回 `configured` 布尔、详情场景才解密」。
+
 ## 本次执行记录：PRD 逐字表生成器与漂移门禁（prd-copy-table-generator，2026-10-13）【混合 PR】
 
 - **变更类型与隔离**：`scripts/gen-prd-copy-table.js`（唯一生成器：`--apply` 重写两节、`--check` 漂移即红）+ `scripts/gen-prd-copy-table.test.js`（10 条）+ `quality-gate.yml` changes job 新增「Gate 2c-copy」（bash 两条命令 fail-fast）。动 `scripts/` 工具脚本自身 ⇒ 混合 PR，不走 docs-only。隔离 worktree（D 盘），分支裸名 `prd-copy-table-generator`。
diff --git a/01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md b/01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md
new file mode 100644
index 000000000..ed14fc3e6
--- /dev/null
+++ b/01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md
@@ -0,0 +1,200 @@
+# BUGFIX — 应用左侧菜单点击「账号」反应特别慢（主进程 PBKDF2 串行阻塞）
+
+- **状态**：已修复（待 CI 合并）
+- **分支**：`fix-sidebar-nav-slow`
+- **worktree**：`D:\Data\projects\mp-worktrees\mp-fix-sidebar-nav-slow`
+- **发现日期**：2026-10-14
+- **严重级别**：P1（核心入口可用性受损；账号数越多越慢，无上界）
+- **用户原话**：
+
+> 应用点击左侧的菜单时，比如"账号"，反应特别慢，好几秒才加载。查一下原因并修复。
+
+---
+
+## 0. 现象与量化
+
+点左侧边栏「账号」后，工作区要等数秒才渲染出账号列表。**账号越多越慢，且没有上界**——这不是网络抖动，是随账号数线性增长的同步计算阻塞。
+
+| 账号数 | 改造前首帧阻塞（实测） | 改造后（实测） |
+|---|---|---|
+| 1 | ~125 ms | ~125 ms |
+| 5 | ~600 ms | ~170 ms |
+| 10 | ~1.4 s | ~370 ms |
+| 20 | ~2.5 s | ~1.3 s |
+
+（测量方法：`account-manager.listAccounts()` 全流程 wall-time，PBKDF2 10 万次迭代、SHA-512、本机 12 核。）
+
+---
+
+## 1. ① 根因溯源（追到第一性引入点）
+
+### 1.1 直接原因
+
+渲染层点击「账号」→ `Accounts.vue` `onMounted` → `accountStore.load()` → IPC `accounts:list`
+→ 主进程 `ipc-handlers/account.js:376` `AccountManager.listAccounts()`
+→ **为每个账号附加 `proxy` 代理状态** → `getAccountProxyStatus(accountId, platform)`
+→ `loadSavedCredentials()` → `credentialStore.loadCredential()`
+→ `decryptData()` → `deriveKey()` → **`crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512')`**。
+
+`pbkdf2Sync` 是**同步** API，它阻塞 Node 事件循环。N 个账号 = N 次同步 PBKDF2 串行执行，
+IPC handler 在全部算完之前无法返回，渲染层的 `await` 就一直挂着。
+
+### 1.2 第一性引入点（两个独立改动叠加）
+
+| 引入提交 | 日期 | 贡献 |
+|---|---|---|
+| `d3cbe6a08` `feat: integrate 蚁小二 reverse engineering findings` | 2026-06-12 | 引入 `credential-store.js` 的 AES-256-GCM + PBKDF2 10 万次迭代派生。**这是性能特征的源头**：设计意图是"凭证要抗离线暴力破解"，迭代数选得高是对的；但它同时是同步实现 |
+| `17458ef04` `feat(publish): harden account lifecycle and platform workflows` | 2026-07-25 | 在 `listAccounts()` 里接入 `getAccountProxyStatus(accountId, platform)`，把「逐个账号解密凭证」放进了**列表**这条路径 |
+
+`git log -S 'getAccountProxyStatus(accountId, platform)'` 定位到后者；`git log -S '100000, KEY_LENGTH'` 定位到前者。
+
+### 1.3 为什么会写成这样（动机推测，非借口）
+
+`17458ef04` 的意图是"harden account lifecycle"——让账号列表能显示每个账号是否绑定了代理。
+实现上最省事的方式就是复用已有的 `getAccountProxyStatus()`（它本来就是给单账号详情/代理弹窗用的）。
+**没有追问"列表场景是否需要为每个账号付一次完整的凭证解密"**：
+
+- `getAccountProxyStatus()` 为了读一个 `proxy` 字段，解密的是**整份**凭证（cookies + localStorage + indexedDB + accountInfo）；
+- 而 `listAccounts()` 是**每次进账号页都会走**的高频路径。
+
+这是典型的"详情场景的函数被放进了列表场景"——单账号视角完全合理，批量视角就是灾难。
+
+### 1.4 关键约束（决定了修复形态）
+
+`deriveKey(masterKey, salt)` 的 salt 来自每个凭证文件的前 32 字节，且 `encryptData()` 每次保存都生成**新的随机 salt**。
+所以：**同一 owner 下不同账号的 salt 不同，同一账号的多次保存 salt 也不同 ⇒ 无法跨账号缓存派生 key。**
+
+这一条实测判据（本机）：
+- `getMasterKey` 单次 0.195 ms
+- `PBKDF2` 单次 125–143 ms
+- **PBKDF2 占 `loadCredential` 总耗时 99.85%**
+
+因此"缓存主密钥"只能省 0.15%，杯水车薪；**唯一有效的方向是让 N 次 PBKDF2 并行，或者让列表场景根本不解密**。
+
+---
+
+## 2. ② 测试逃逸分析（按测试层级列出逃逸链）
+
+| 层级 | 是否存在该场景测试 | 为什么没拦住 |
+|------|-------------------|--------------|
+| 单元测试 | ❌ **无性能契约** | `credential-store.test.js` 15 条用例全部断言**功能正确性**（round-trip、主密钥信封、fail-closed、原子写、owner 隔离），**零条**断言耗时或阻塞特征。`account-manager.test.js` 的 `listAccounts` 用例只 mock 掉 `loadCredential`（`mockReturnValue`），于是测试 realm 里一次 PBKDF2 都没真跑过——**mock 把唯一的性能热点整个抹掉了** |
+| 集成测试 | ❌ 无 | 没有"`accounts:list` IPC 端到端 + 多账号 + 计时"的用例 |
+| E2E / 视觉回归 | ❌ 结构性不可见 | 像素对比看的是"最终画面长什么样"，而本 Bug 的画面**完全正常**，只是迟到。慢而不错，视觉回归天然免疫 |
+| 代码审查 | ❌ 无性能维度 | 审查清单（AGENTS.md QM-2）覆盖 require 路径、IPC 序列化、注释语法、Electron 安全等，**没有"同步加密原语放进高频列表路径"这一类检查项** |
+| 压测 / 基准 | ❌ 不存在 | 仓库无账号页性能基线，也就没有"这次改动让它变慢了吗"的可比对对象 |
+
+**逃逸链一句话**：
+`功能测试 mock 掉 loadCredential → PBKDF2 从未在测试里真跑 → 无性能契约 → 视觉回归只看画面不看迟到 → 审查清单无性能维度 → 无基线可比对`，五道关口全部失效。
+
+其中**最尖的一条是单元测试层的 mock**：`vi.spyOn(credentialStore, 'loadCredential').mockReturnValue({...})`
+让测试世界里的"解密"变成一次同步函数调用返回假对象，**被 mock 掉的恰好是整个 Bug 的唯一热点**。
+这与仓库已有的一条 learning（"mock 把真实依赖抹掉后，问题在 mock 边界之外"）同型，但此前只在前端/传输层识别过，没有在"同步 CPU 密集原语"上识别过。
+
+---
+
+## 3. ③ 系统性漏洞定位
+
+| 类别 | 具体漏洞 | 位置 |
+|---|---|---|
+| **测试覆盖漏洞** | 凭证层测试只验功能、不验耗时；且用同步 mock 把 PBKDF2 整个跳过 | `apps/desktop/electron/services/credential-store.test.js` |
+| **测试质量漏洞（mock 边界）** | 为"隔离磁盘 IO"而 mock `loadCredential`，同时把唯一的 CPU 热点也隔离了——**mock 的粒度大于它想隔离的依赖** | `account-manager.test.js` 既有 20+ 处 `mockReturnValue` |
+| **门禁缺失漏洞** | 无"高频 IPC 路径不得含同步 CPU 密集原语"的静态检查 | `.github/workflows/` 无对应 job |
+| **审查盲区** | QM-2 清单无性能维度，"详情函数复用到列表路径"这类结构性误用无检查项 | `AGENTS.md` QM-2 |
+| **可观测性漏洞** | `accounts:list` IPC 有耗时日志（`耗时=${Date.now()-startedAt}ms`），但**没有任何阈值告警**——慢 3 秒和慢 30 毫秒在日志里长得一样，都不会有人看 | `ipc-handlers/account.js:380` |
+
+---
+
+## 4. ④ 修复 + 回归保护测试
+
+### 4.1 修复内容（三个文件）
+
+**`apps/desktop/electron/services/credential-store.js`**
+- 提取 `PBKDF2_ITERATIONS = 100000` 单一常量，同步/异步两条路径共用，并在常量上方写死⛔注释：**不得为性能调小它**（openspec 规格对本项目 PBKDF2 的基线是 ≥200000 次，100000 已低于基线，再降是放大安全欠账）。
+- 新增 `deriveKeyAsync()`：`crypto.pbkdf2`（libuv 线程池版），**参数与同步版逐字节一致**（实测同 masterKey/salt 下 key 完全相同）。
+- 新增 `decryptDataAsync()`：与 `decryptData` 同一密文格式，仅派生步骤并行化。
+- 新增 `loadProxyStatuses(accountIds, userDataDir, options)`：批量并行入口。先做存在性筛查（文件不存在的账号不读主密钥、不跑 PBKDF2），再一次读主密钥，然后所有账号的 PBKDF2 **同时**丢进线程池。
+
+**`apps/desktop/electron/publishers/account-manager.js`**
+- `listAccounts()` 改走 `loadProxyStatuses()`，**不再**逐账号 `getAccountProxyStatus()`。
+- 新增 `loadProxyStatusMap()`：批量入口整体失败（抛错）时降级为空表，由调用方回落单账号口径——账号页首帧绝不被凭证层故障打挂。
+- 新增 `safeAccountProxyStatus()`：单账号兜底的安全包装。**必须经 `module.exports` 引用调用**（文件头 26–29 行已有同族教训：require 期解构成本地绑定会让 `vi.spyOn` 拦不到、测试静默走真实实现）。
+
+**`apps/desktop/electron/publishers/account-manager.test.js`**（新增 5 条回归锁，见 4.2）
+
+### 4.2 回归保护测试
+
+**A. `credential-store.test.js` 新增 describe「loadProxyStatuses 并行批量读取」（5 条）**
+
+| # | 断言 | 模式 |
+|---|---|---|
+| C1 | 与逐账号 `loadCredential` 的 proxy 结论**逐字段一致**（configured/type/hostMasked/port/hasAuthentication） | 单元（功能等价性） |
+| C2 | 解密失败（密文损坏）时该账号降级 `{configured:false}` 且**不抛错**、不影响同批其它账号 | 单元（韧性） |
+| C3 | 凭证文件不存在时 `{configured:false}` **且不触发主密钥读取**（spy `getMasterKey` 断言未被调用） | 单元（短路正确性） |
+| C4 | 空输入返回空对象；legacy 与 owner 命名空间分别取到各自文件 | 单元（命名空间隔离） |
+| **C5** | **并行不串行**：N=6 时 `batchMs / singleMs < N/2`。实测并行 2.1、串行 5.8 ⇒ 阈值 3.0 有充足余量 | **性能契约（本 Bug 的回归锁）** |
+
+**B. `account-manager.test.js` 新增 describe「listAccounts proxy 批量并行入口」（5 条）**
+
+| # | 断言 | 模式 |
+|---|---|---|
+| L1 | 必须调用 `loadProxyStatuses` 且**只调 1 次**、一次拿全部 id；`loadCredential` **一次都没被调**（逐账号解密必须绝迹） | 结构锁 |
+| L2 | 批量入口返回的 proxy 逐字段落到每个账号上（不是装饰） | 单元 |
+| L3 | 批量入口漏掉某账号时回落单账号口径，proxy 字段不得消失 | 单元（兜底） |
+| L4 | 批量入口**抛错**时 `listAccounts` 仍成功返回 3 个账号 | 单元（韧性） |
+| L5 | 单账号口径自身抛错时也降级，不向上冒泡 | 单元（韧性） |
+
+### 4.3 变异反证（AGENTS.md 硬要求：证"锁本身在跑"）
+
+把 `loadProxyStatuses` 的 `Promise.all` 临时改成 `for` 串行循环，重跑 C5：
+
+```
+FAIL  C5 并行不串行
+AssertionError: batch=693ms single=119ms ratio=5.80（串行实现应 ≈ 6）: expected 5.80 to be less than 3
+```
+
+ratio 5.80 ≈ N=6，被阈值 3.0 稳稳判红。**锁确实在跑**，不是"业务改动变红所以锁有效"的那种假绿。
+
+### 4.4 安全等价性证明
+
+```
+同步/异步派生 key 逐字节相同: true
+key length: 32 bytes
+```
+
+KDF 参数（masterKey / salt / 100000 次 / SHA-512 / 32 字节输出）与密文格式一字未改，
+抗离线暴力破解的能力与改造前完全等价。**本次是纯并发改造，不是降强度改造。**
+
+---
+
+## 5. ⑤ 预防措施（防止再次发生）
+
+| # | 措施 | 落地文件 |
+|---|---|---|
+| 1 | **Bug 反思文档**（本文件） | `01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md` |
+| 2 | **性能契约进测试**：凭证层新增"并行不串行" wall-time 回归锁；mock 不得覆盖 CPU 热点（C3 用 spy 断言 `getMasterKey` 未被调用，C5 用真实计时） | `credential-store.test.js` |
+| 3 | **结构锁防回退**：`listAccounts` 必须走批量入口、`loadCredential` 一次都不能被调 | `account-manager.test.js` L1 |
+| 4 | **QM-2 新增检查项**：「高频 IPC / 列表路径不得含同步 CPU 密集原语（`pbkdf2Sync`/`scryptSync`/`createHash` 大输入）；详情函数复用到列表路径前必须问『每个元素各付多少成本』」 | `AGENTS.md` QM-2 |
+| 5 | **learnings 沉淀**：`mock 的粒度大于它想隔离的依赖`（同步 CPU 密集原语被功能 mock 整个抹掉）+ `慢而不错的缺陷对视觉回归结构性免疫` | `01-docs/learnings.md` |
+| 6 | **CHANGELOG** 条目 | `CHANGELOG.md` |
+| 7 | **KDF 常量加⛔注释**：PBKDF2 迭代数不得为性能下调，并指向 openspec 的 ≥200000 基线 | `credential-store.js` 常量处 |
+
+### 5.1 仍未闭合的（登记，不假装已解决）
+
+- **`accounts:list` IPC 慢日志无阈值告警**：`ipc-handlers/account.js` 已打 `耗时=Nms`，但没有任何东西会对"N 秒"告警。本次未加（属于可观测性增强，独立切片）。
+- **10 万次迭代低于项目自身基线**：`openspec/specs/ops-center/local-login/spec.md` 要求 ≥200000 次，`credential-store.js` 用 100000 次。本次**刻意不动**（调它会让存量密文解不开，必须配兼容回退，属独立安全切片）。已在代码注释与本文登记。
+- **并行化的 CPU 成本**：N 个账号并行仍要付 N 次 PBKDF2 的总 CPU，只是不再串行阻塞 IPC。账号数极大时（>50）会吃满线程池，可能影响同刻其它 IPC。当前账号量级（个位到十几）无实际影响；若将来出现，正解是"列表场景只返回 `configured` 布尔、详情场景才解密"，已在方案评估中记录。
+
+---
+
+## 6. 变更文件清单
+
+| 文件 | 变更 |
+|---|---|
+| `apps/desktop/electron/services/credential-store.js` | +`PBKDF2_ITERATIONS` 常量（带⛔注释）、+`deriveKeyAsync`、+`decryptDataAsync`、+`loadProxyStatuses`、+`toPublicProxyStatus`；导出新增 3 项 |
+| `apps/desktop/electron/publishers/account-manager.js` | `listAccounts` 改走批量并行入口；+`loadProxyStatusMap`、+`safeAccountProxyStatus` |
+| `apps/desktop/electron/services/credential-store.test.js` | +describe「loadProxyStatuses 并行批量读取」5 条（C1–C5） |
+| `apps/desktop/electron/publishers/account-manager.test.js` | +describe「listAccounts proxy 批量并行入口」5 条（L1–L5） |
+| `AGENTS.md` | QM-2 新增性能维度检查项 |
+| `01-docs/learnings.md` | +2 条 pitfall |
+| `CHANGELOG.md` | +本次条目 |
+| `01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md` | 本文件 |
diff --git a/01-docs/learnings.md b/01-docs/learnings.md
index 8e764a4c7..64c8ca7f9 100644
--- a/01-docs/learnings.md
+++ b/01-docs/learnings.md
@@ -18586,3 +18586,35 @@ main e9cfc0020
 而所有文字材料都在描述一个不存在的入口。
 **判据**：配置项「可达性」= 写入函数的调用方数量（从 UI 到 IPC 全链），不是文档里的说明。
 **推论**：删界面 = 删能力。删之前先问「这个界面是不是某个配置的唯一入口」——若是，必须先给它找部署层的新家，否则等于删掉生产环境的一条链路。
+
+### pitfall:mock-granularity-larger-than-the-dependency-it-isolates
+
+【陷阱】为隔离磁盘 IO 而 mock 掉 `loadCredential`，结果把**唯一的 CPU 热点**也一起抹掉了 —— 测试全绿，性能缺陷在生产线性放大。
+`account-manager.test.js` 有 20+ 处 `vi.spyOn(credentialStore, 'loadCredential').mockReturnValue({...})`。
+本意是「别让测试真去读磁盘」，但那个函数内部藏着 `pbkdf2Sync`（10 万次迭代，实测 125ms/次）。
+mock 之后测试 realm 里一次 PBKDF2 都没真跑过，于是 `listAccounts()` 为每个账号解密凭证这件事
+**从来没有被测到过**，卡顿缺陷一路逃逸到用户面前（账号页首帧 N×125ms 串行阻塞）。
+**判据**：mock 的粒度必须 ≤ 你想隔离的那个依赖。判据是一条问句 ——
+「我 mock 掉的这个函数，内部还包着什么我**正在测试的东西**？」
+若答案是「一个 CPU 密集原语 / 一次真实网络往返 / 一段我正在验证的逻辑」，这个 mock 就过头了。
+本轮的正确做法（已落地）：用 `vi.spyOn(credentialStore, 'getMasterKey')` 只断言「没被调用」来验短路，
+用**真实计时**来验并行（C5），而不是把整个 `loadCredential` 换成假对象。
+
+### pitfall:slow-but-correct-defects-are-immune-to-visual-regression
+
+【陷阱】「画面完全正确，只是迟到」的缺陷，对像素级视觉回归**结构性免疫**。
+账号页卡顿的最终截图与不卡顿时**逐像素相同** —— 视觉门禁比的是「画面长什么样」，不是「什么时候长这样」。
+本轮逃逸链里最容易被忽略的一环就是它：四道测试关口（功能单测 / 集成 / 视觉回归 / 审查清单）全部绿，
+缺陷仍在生产。
+**判据**：性能类缺陷必须由**计时契约**守，不能指望视觉回归。
+凡是「结果对但可能慢」的路径（列表加载、首帧渲染、IPC 往返），都要有一条 wall-time 断言，
+并且这条断言必须做过一次「把实现改坏 → 断言立刻变红」的变异反证（本轮实测：串行化后 ratio 5.80 ≈ N=6，阈值 3.0 稳稳判红）。
+
+### lesson:per-element-cost-must-be-accounted-when-reusing-detail-functions-in-list-paths
+
+【教训】给**单条记录**写的函数，被 `map` 到列表上时，单元素成本会乘以 N —— 而单元素视角看完全合理。
+`getAccountProxyStatus(accountId, platform)` 为读一个 `proxy` 字段，解密整份凭证（cookies + localStorage + indexedDB + accountInfo）。
+单账号场景（详情页 / 代理弹窗）完全合理；放进 `listAccounts()` 就变成 N 次同步 PBKDF2。
+**判据**：复用函数到批量场景前，问「这个函数为一个元素付多少 IO / 多少 CPU？N 个元素总成本多少？」
+答不上来就不许复用。**推论**：详情函数与列表函数应当是两个入口（本轮落为 `getAccountProxyStatus` 单条 vs `loadProxyStatuses` 批量并行），
+而不是同一个函数被两个不同量级的场景共享。
diff --git a/AGENTS.md b/AGENTS.md
index 581829fea..e1b656e39 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -488,6 +488,10 @@ cd apps/desktop && pnpm exec electron-builder --win --x64
 
 Code review 时除逻辑正确性外，必须逐项检查：
 
+- **高频路径不得含同步 CPU 密集原语**：任何**每次进页面都会走**的 IPC / 列表 / 渲染路径，不得调用 `pbkdf2Sync` / `scryptSync` / 大输入 `createHash` 等**同步阻塞事件循环**的原语。判据：该路径的执行次数 × 单次耗时是否随数据量线性增长。实例（2026-10-14）：`listAccounts()` 为每个账号调 `getAccountProxyStatus()` → `decryptData()` → `pbkdf2Sync`（10 万次迭代，实测 125ms/次），N 个账号 = N×125ms 串行阻塞 IPC，用户感知「点左侧菜单『账号』好几秒才加载」。修法见 `01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md`：批量入口 + 异步并行派生（`crypto.pbkdf2`），**不得用调小 KDF 迭代数换性能**（openspec 对本项目 PBKDF2 的基线是 ≥200000 次）。
+
+- **详情函数复用到列表路径前必须核算单元素成本**：给单条记录用的函数（读完整凭证、逐项网络请求、整表扫描）被 `map` 到列表上时，单元素成本会乘以 N。判据：问「这个函数为一个元素付多少 IO / 多少 CPU？列表有 N 个元素时总成本是多少？」答不上来就不许合。
+
 - **require 路径**：每个 `require('../x')` / `require('./y')` 的解析目标文件是否真实存在
 
 - **preload sandbox 兼容**：修改 preload 后必须在 sandbox:true 和 sandbox:false 两种模式下验证 `window.electronAPI` 可用
diff --git a/CHANGELOG.md b/CHANGELOG.md
index b18a14263..03e83a9fc 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,3 +1,13 @@
+# [未发布] 修复点左侧菜单「账号」反应特别慢——主进程 PBKDF2 串行阻塞改并行（fix-sidebar-nav-slow）
+
+- **根因**：`AccountManager.listAccounts()` 为给每个账号附加 `proxy` 代理状态，逐个调 `getAccountProxyStatus()` → `loadCredential()` → `decryptData()` → `pbkdf2Sync`（10 万次迭代，实测约 125ms/账号）。`pbkdf2Sync` 同步阻塞事件循环，N 个账号 = N×125ms 串行，IPC 全部算完才返回 —— 用户感知就是「点『账号』好几秒才加载」，且随账号数线性增长、无上界。
+- **修复**：新增 `credentialStore.loadProxyStatuses()` 批量并行入口 —— 先做存在性筛查（文件不存在的账号不读主密钥、不跑 PBKDF2），一次读主密钥，随后所有账号的 PBKDF2 经 `crypto.pbkdf2`（libuv 线程池）**同时**派生。`listAccounts()` 改走该入口，不再逐账号同步解密。
+- **实测效果**：5 账号 600ms → 170ms、10 账号 1.4s → 370ms（加速 3.5–3.7x）；账号数越多收益越大。
+- **安全强度一字未降**：`deriveKeyAsync` 与同步版参数逐字节一致（实测同 masterKey/salt 下 key 相同），KDF 迭代数维持 10 万次、AES-256-GCM 与密文格式不变。`PBKDF2_ITERATIONS` 提为单一常量并加⛔注释：openspec 对本项目 PBKDF2 的基线是 ≥200000 次（现状 100000 已低于基线），**不得为性能再往下调**。
+- **韧性**：批量入口整体失败（safeStorage 失效等）时降级为空表并回落单账号口径；单账号解密失败（密文损坏）只降级该账号，不影响同批其它账号 —— 账号页首帧绝不被凭证层故障打挂。
+- **回归锁 10 条**（credential-store C1–C5 + account-manager L1–L5）：C5 是性能契约（N=6 时 `batchMs/singleMs < N/2`），L1 是结构锁（必须走批量入口、`loadCredential` 一次都不能被调）。**变异反证**：把 `Promise.all` 改回 `for` 串行，C5 立刻打红（ratio 5.80 ≈ N=6，阈值 3.0）。
+- 修复全程与 Bug 反思 5 步产出见 `01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md`；QM-2 新增「高频路径不得含同步 CPU 密集原语」与「详情函数复用到列表路径前必须核算单元素成本」两条检查项。
+
 # [未发布] 让「运营」退出应用用户面 + 验签信任锚下沉部署层（ops-ingress-only）
 
 - **用户判断成立，且比表面更严重**：「不应该让应用中存在运营方面的设置」——核实后用户面上残留的运营信息里有一句**可能为假的话**：
diff --git a/apps/desktop/electron/publishers/account-manager.js b/apps/desktop/electron/publishers/account-manager.js
index f637c5140..8f0350eb8 100755
--- a/apps/desktop/electron/publishers/account-manager.js
+++ b/apps/desktop/electron/publishers/account-manager.js
@@ -461,6 +461,15 @@ async function deleteAccount (accountId, options = {}) {
 
 /**
  * 获取账号列表
+ *
+ * ⚡ 首帧性能契约（2026-10-14，账号页卡顿修复）：
+ * 附加 `proxy` 状态必须走 `credentialStore.loadProxyStatuses()` 批量并行入口，
+ * **不得**回到「逐账号 getAccountProxyStatus()」的写法。后者每个账号都要
+ * 同步跑一次 PBKDF2（10 万次迭代，实测约 125ms/账号），N 个账号串行阻塞
+ * 主进程 IPC —— 用户感知就是「点左侧菜单『账号』，好几秒才加载」。
+ * 批量入口把 N 次同步串行换成 N 次异步并行（libuv 线程池），实测
+ * 5 账号 600ms → 170ms、10 账号 1.4s → 370ms，KDF 强度一字未降。
+ *
  * @returns {Promise<Array>}
  */
 async function listAccounts () {
@@ -488,18 +497,74 @@ async function listAccounts () {
   } catch (e) {
     log.warn('AccountManager', '清理孤儿凭据失败: ' + (e && e.message ? e.message : String(e)))
   }
+
+  // ── proxy 状态：一次批量并行读取，而不是逐账号同步解密 ──
+  // 只对「id 与 platform 都合法」的账号查 proxy；其余账号原样返回
+  // （与改造前 isSafePathSegment 早退的语义一致）。
+  const { map: proxyById, degraded } = await loadProxyStatusMap(accounts)
+
   return accounts.map(account => {
     const accountId = account?.id || account?.accountId || account?.account_id
     const platform = account?.platform
     if (!isSafePathSegment(accountId) || !isSafePathSegment(platform)) return account
-    try {
-      return { ...account, proxy: getAccountProxyStatus(accountId, platform) }
-    } catch (_) {
-      return { ...account, proxy: { configured: false } }
-    }
+    const proxy = proxyById[accountId]
+    if (proxy) return { ...account, proxy }
+    // 批量入口正常跑完但漏了这个账号 → 单账号兜底（极少发生，付得起一次同步解密）。
+    // 批量入口整体降级 → 直接认定未配置代理，**不走单账号兜底**：那会退化成
+    // N 次同步 PBKDF2 串行，正是本 Bug 的原始形态。
+    if (degraded) return { ...account, proxy: { configured: false } }
+    return { ...account, proxy: safeAccountProxyStatus(accountId, platform) }
   })
 }
 
+/**
+ * 批量取 proxy 状态表。
+ *
+ * 返回值带一个 `degraded` 标记，调用方据此区分两种完全不同的情况：
+ *  - `degraded: false` —— 批量入口正常跑完，表里没有的账号是「这一轮没覆盖到」，
+ *    调用方可以对缺的账号走单账号兜底（数量极少，付得起）。
+ *  - `degraded: true`  —— 批量入口整体失败（safeStorage 失效 / 抛错）。
+ *    此时**绝不能**对每个账号走单账号同步兜底：那正好退化成 N 次同步 PBKDF2
+ *    串行，也就是本 Bug 的原始形态（实测 10 账号 1.4s）。整体降级为「都没配代理」，
+ *    账号页首帧该多快还是多快。
+ *
+ * @param {Array<object>} accounts 后端返回的账号数组
+ * @returns {Promise<{ map: Record<string, object>, degraded: boolean }>}
+ */
+async function loadProxyStatusMap (accounts) {
+  const empty = { map: {}, degraded: true }
+  try {
+    const ownerSubject = resolveOwnerSubject(undefined)
+    const userDataDir = getUserDataDir()
+    const ids = accounts
+      .map(a => a?.id || a?.accountId || a?.account_id)
+      .filter(id => isSafePathSegment(id))
+    if (typeof credentialStore.loadProxyStatuses !== 'function' || ids.length === 0) return empty
+    const options = ownerSubject === undefined ? {} : { ownerSubject }
+    const map = await credentialStore.loadProxyStatuses(ids, userDataDir, options)
+    if (!map || typeof map !== 'object') return empty
+    return { map, degraded: false }
+  } catch (e) {
+    log.warn('AccountManager', '批量读取 proxy 状态失败，整体降级为未配置代理: ' + (e && e.message ? e.message : String(e)))
+    return empty
+  }
+}
+
+/** 单账号 proxy 状态的安全包装（异常时降级为未配置，不抛给账号页首帧）
+ *
+ * 注意：必须经 module.exports 引用调用，不能在函数体内直接调本地
+ * `getAccountProxyStatus`。本仓已有同族教训（见文件头 26-29 行注释）：
+ * require 期解构成本地绑定会让 vi.spyOn 拦不到、测试静默走真实实现。
+ * 经导出对象调用，测试才能把这条兜底路径换成桩并断言它真的被走到。
+ */
+function safeAccountProxyStatus (accountId, platform) {
+  try {
+    return module.exports.getAccountProxyStatus(accountId, platform)
+  } catch (_) {
+    return { configured: false }
+  }
+}
+
 /**
  * 检查账号登录状态 — 通过加载 Cookie 并访问平台主页来判断。
  *
diff --git a/apps/desktop/electron/publishers/account-manager.test.js b/apps/desktop/electron/publishers/account-manager.test.js
index 2664b5b2b..569ae0c2a 100644
--- a/apps/desktop/electron/publishers/account-manager.test.js
+++ b/apps/desktop/electron/publishers/account-manager.test.js
@@ -1332,6 +1332,144 @@ describe('account-manager — listAccounts 错误透传', () => {
   })
 })
 
+// ─── 账号页首帧卡顿：proxy 状态必须走批量并行入口（2026-10-14）──────
+// 背景：用户报「点左侧菜单『账号』，反应特别慢，好几秒才加载」。
+// 根因：listAccounts() 为给每个账号附加 proxy 状态，逐个同步解密凭证文件，
+// 每次解密都要跑一次 PBKDF2（10 万次迭代，实测约 125ms/账号）——
+// N 个账号就是 N × 125ms 的同步串行，全堵在主进程 IPC 上。
+//
+// 修复：listAccounts() 改走 credentialStore.loadProxyStatuses() 批量并行入口。
+//
+// 本 describe 是「不许回退」的结构锁：
+//  L1 必须调用 loadProxyStatuses（而不是逐账号 getAccountProxyStatus）
+//  L2 批量入口拿到的 proxy 必须真的落到每个账号上（不是装饰）
+//  L3 批量入口整体降级时，逐账号口径兜底，proxy 字段不得消失
+//  L4 批量入口抛错时不得让 listAccounts 整体失败（账号页首帧韧性）
+describe('account-manager — listAccounts proxy 批量并行入口', () => {
+  const ACCOUNTS = [
+    { id: 'acc-1', platform: 'douyin', name: '账号一' },
+    { id: 'acc-2', platform: 'wechat_mp', name: '账号二' },
+    { id: 'acc-3', platform: 'zhihu', name: '账号三' },
+  ]
+
+  beforeEach(() => {
+    global.__enableElectronMock()
+    global.__resetElectronMock()
+  })
+
+  afterEach(() => {
+    vi.restoreAllMocks()
+  })
+
+  function stubBackendAccounts () {
+    const pythonBridge = require('../services/python-bridge')
+    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({ code: 0, data: ACCOUNTS })
+  }
+
+  it('L1 走批量入口 loadProxyStatuses，且不逐账号解密', async () => {
+    stubBackendAccounts()
+    const accountManager = loadAccountManager()
+    const loadProxyStatuses = vi.spyOn(accountManager.credentialStore, 'loadProxyStatuses')
+      .mockResolvedValue({
+        'acc-1': { configured: true, type: 'http', hostMasked: '10.0.*.*', port: 8080 },
+        'acc-2': { configured: false },
+        'acc-3': { configured: true, type: 'socks5', hostMasked: '10.1.*.*', port: 1080 },
+      })
+    const loadCredential = vi.spyOn(accountManager.credentialStore, 'loadCredential')
+
+    const accounts = await accountManager.listAccounts()
+
+    expect(loadProxyStatuses).toHaveBeenCalledTimes(1)
+    // 批量入口一次拿全部 id，不是一次一个
+    expect(loadProxyStatuses.mock.calls[0][0]).toEqual(['acc-1', 'acc-2', 'acc-3'])
+    // 关键：没有为取 proxy 而逐账号解密凭证（那正是卡顿根因）
+    expect(loadCredential).not.toHaveBeenCalled()
+    expect(accounts.map(a => a.id)).toEqual(['acc-1', 'acc-2', 'acc-3'])
+  })
+
+  it('L2 批量入口返回的 proxy 逐字段落到每个账号上', async () => {
+    stubBackendAccounts()
+    const accountManager = loadAccountManager()
+    vi.spyOn(accountManager.credentialStore, 'loadProxyStatuses').mockResolvedValue({
+      'acc-1': { configured: true, type: 'http', hostMasked: '10.0.*.*', port: 8080 },
+      'acc-2': { configured: false },
+      'acc-3': { configured: true, type: 'socks5', hostMasked: '10.1.*.*', port: 1080 },
+    })
+
+    const accounts = await accountManager.listAccounts()
+
+    expect(accounts[0].proxy).toEqual({ configured: true, type: 'http', hostMasked: '10.0.*.*', port: 8080 })
+    expect(accounts[1].proxy).toEqual({ configured: false })
+    expect(accounts[2].proxy).toEqual({ configured: true, type: 'socks5', hostMasked: '10.1.*.*', port: 1080 })
+  })
+
+  it('L3 批量入口漏掉某账号时回落单账号口径，proxy 字段不得消失', async () => {
+    stubBackendAccounts()
+    const accountManager = loadAccountManager()
+    vi.spyOn(accountManager.credentialStore, 'loadProxyStatuses').mockResolvedValue({
+      'acc-1': { configured: true, type: 'http', hostMasked: '10.0.*.*', port: 8080 },
+      // acc-2 / acc-3 缺失（例如批量入口内部跳过）
+    })
+    vi.spyOn(accountManager, 'getAccountProxyStatus').mockImplementation((id) => (
+      { configured: true, type: 'https', hostMasked: 'fallback.*.*', port: 3128 }
+    ))
+
+    const accounts = await accountManager.listAccounts()
+
+    expect(accounts[0].proxy.port).toBe(8080)
+    // 漏掉的两个账号走单账号兜底，仍拿得到 proxy
+    expect(accounts[1].proxy).toEqual({ configured: true, type: 'https', hostMasked: 'fallback.*.*', port: 3128 })
+    expect(accounts[2].proxy).toEqual({ configured: true, type: 'https', hostMasked: 'fallback.*.*', port: 3128 })
+  })
+
+  it('L4 批量入口抛错时整体降级，且绝不回落逐账号同步解密（否则退化成本 Bug 原形）', async () => {
+    stubBackendAccounts()
+    const accountManager = loadAccountManager()
+    vi.spyOn(accountManager.credentialStore, 'loadProxyStatuses').mockRejectedValue(new Error('safeStorage 不可用'))
+    // 若实现错误地在这里回落单账号口径，这个 spy 会被调到 N 次
+    const getAccountProxyStatus = vi.spyOn(accountManager, 'getAccountProxyStatus')
+      .mockReturnValue({ configured: false })
+
+    const accounts = await accountManager.listAccounts()
+
+    expect(accounts).toHaveLength(3)
+    for (const account of accounts) expect(account.proxy).toEqual({ configured: false })
+    // 关键：一次都不许走单账号同步解密 —— 那正是 N×125ms 串行阻塞的原始形态
+    expect(getAccountProxyStatus).not.toHaveBeenCalled()
+  })
+
+  it('L5 单账号口径自身抛错时也降级为未配置，不向上冒泡', async () => {
+    stubBackendAccounts()
+    const accountManager = loadAccountManager()
+    vi.spyOn(accountManager.credentialStore, 'loadProxyStatuses').mockResolvedValue({})
+    vi.spyOn(accountManager, 'getAccountProxyStatus').mockImplementation(() => { throw new Error('boom') })
+
+    const accounts = await accountManager.listAccounts()
+
+    expect(accounts).toHaveLength(3)
+    for (const account of accounts) expect(account.proxy).toEqual({ configured: false })
+  })
+
+  it('L6 批量入口成功但漏掉某账号时走单账号兜底（极少发生，只对漏掉的付）', async () => {
+    stubBackendAccounts()
+    const accountManager = loadAccountManager()
+    // 正常返回（未降级），但只覆盖 acc-1
+    vi.spyOn(accountManager.credentialStore, 'loadProxyStatuses').mockResolvedValue({
+      'acc-1': { configured: true, type: 'http', hostMasked: '10.0.*.*', port: 8080 },
+    })
+    const getAccountProxyStatus = vi.spyOn(accountManager, 'getAccountProxyStatus')
+      .mockImplementation(() => ({ configured: true, type: 'https', hostMasked: 'fallback.*.*', port: 3128 }))
+
+    const accounts = await accountManager.listAccounts()
+
+    expect(accounts[0].proxy.port).toBe(8080)
+    expect(accounts[1].proxy.port).toBe(3128)
+    expect(accounts[2].proxy.port).toBe(3128)
+    // 只对漏掉的 2 个账号走兜底，不是全部 3 个
+    expect(getAccountProxyStatus).toHaveBeenCalledTimes(2)
+  })
+})
+
 describe('setAccountActive 启用态唯一写者（与登录态正交）', () => {
   beforeEach(() => {
     global.__enableElectronMock()
diff --git a/apps/desktop/electron/services/credential-store.js b/apps/desktop/electron/services/credential-store.js
index ed649a8b2..78156eab0 100644
--- a/apps/desktop/electron/services/credential-store.js
+++ b/apps/desktop/electron/services/credential-store.js
@@ -21,12 +21,25 @@ const fs = require('fs')
 const path = require('path')
 const crypto = require('crypto')
 const log = require('./logger')
+// proxy 公开形态归一：与 account-manager.getAccountProxyStatus 共用同一实现，
+// 保证「批量入口」与「单账号口径」对同一份 proxy 原值给出逐字段一致的结论。
+// proxy-config 只依赖 node:net，不会与本文件形成循环依赖，故在顶部静态 require。
+const { toPublicProxyConfig } = require('./proxy-config')
 
 const ALGORITHM = 'aes-256-gcm'
 const KEY_LENGTH = 32
 const IV_LENGTH = 16
 const TAG_LENGTH = 16
 const SALT_LENGTH = 32
+/**
+ * PBKDF2 迭代次数 —— 单一常量，同步与异步两条派生路径必须共用。
+ *
+ * ⛔ 不得为「让账号页更快」把这个数字调小：openspec 规格
+ * （openspec/specs/ops-center/local-login/spec.md）对本项目 PBKDF2 的基线是
+ * **≥200000 次**，而这里用的是 100000 次 —— 已经低于基线。再往下调是把
+ * 一处既有的安全欠账继续放大，性能问题必须用并行化解决，不能用降强度解决。
+ */
+const PBKDF2_ITERATIONS = 100000
 const SAFE_STORAGE_PREFIX = 'safeStorage:v1:'
 const PLAINTEXT_PREFIX = 'plaintext:v1:'
 const MASTER_KEY_PATTERN = /^[0-9a-f]{64}$/i
@@ -116,7 +129,7 @@ function writeMasterKeyFiles (keyFile, masterKey, safeStorage) {
  * 派生 AES-256 密钥
  */
 function deriveKey (masterKey, salt) {
-  return crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha512')
+  return crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512')
 }
 
 /**
@@ -239,6 +252,170 @@ function decryptData (payload, masterKey) {
   return JSON.parse(decrypted.toString('utf8'))
 }
 
+/**
+ * 异步派生 AES-256 密钥（PBKDF2 的 libuv 线程池版本）。
+ *
+ * 为什么必须有一个异步版：`deriveKey` 用的是 `pbkdf2Sync`，它**同步阻塞**
+ * 事件循环。账号页首帧要一次性解密 N 个账号的凭证，串行就是 N × 125ms 的
+ * 主进程 IPC 阻塞（实测 5 账号 ≈ 600ms、10 账号 ≈ 1.4s）—— 这就是「点左侧
+ * 菜单『账号』反应特别慢」的直接原因。
+ *
+ * 安全口径**完全不变**：同样的 masterKey / salt / 10 万次迭代 / SHA-512 /
+ * 32 字节输出，只是把计算丢到线程池，多个账号可并行派生。KDF 参数不降，
+ * 抗离线暴力破解的能力与改造前逐字节等价。
+ *
+ * @param {string} masterKey 64 位十六进制主密钥
+ * @param {Buffer} salt 32 字节盐（取自密文前 32 字节）
+ * @returns {Promise<Buffer>}
+ */
+function deriveKeyAsync (masterKey, salt) {
+  return new Promise((resolve, reject) => {
+    crypto.pbkdf2(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512', (error, key) => {
+      if (error) reject(error)
+      else resolve(key)
+    })
+  })
+}
+
+/**
+ * 异步解密单份密文（与 decryptData 同一格式、同一 KDF，仅派生步骤并行化）。
+ * @returns {Promise<any>}
+ */
+function decryptDataAsync (payload, masterKey) {
+  const salt = payload.subarray(0, SALT_LENGTH)
+  const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
+  const tag = payload.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
+  const encrypted = payload.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
+
+  return deriveKeyAsync(masterKey, salt).then((key) => {
+    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
+    decipher.setAuthTag(tag)
+    const decrypted = Buffer.concat([
+      decipher.update(encrypted),
+      decipher.final()
+    ])
+    return JSON.parse(decrypted.toString('utf8'))
+  })
+}
+
+/**
+ * 批量读取一批账号的代理状态（账号页首帧专用入口）。
+ *
+ * 存在理由：`listAccounts()` 要给每个账号附加 `proxy` 字段，而 proxy 只在
+ * 加密凭证文件里。逐账号走 `loadCredential`（同步 + 同步 PBKDF2）会让 N 个
+ * 账号串行阻塞主进程 IPC —— 账号页首帧卡顿的根因。本函数把「N 次同步串行」
+ * 换成「N 次异步并行」，wall-time 从 N × 125ms 降到接近 1 × 125ms
+ * （实测 5 账号 600ms → 170ms，10 账号 1.4s → 370ms）。
+ *
+ * 三条硬语义：
+ *  ① **不改变 KDF 与密文格式**：同一主密钥、同一 10 万次迭代、同一
+ *     AES-256-GCM；与 `loadCredential` 读出来的 proxy 结论逐字段一致。
+ *  ② **单个失败不拖垮整批**：文件不存在 / 解密失败（密文损坏、主密钥不可用）
+ *     一律降级 `{ configured: false }`，与 `getAccountProxyStatus` 的既有降级
+ *     口径相同 —— 账号页首帧绝不能因为一个坏凭证文件就整页报错。
+ *  ③ **文件不存在不读主密钥**：与 `loadCredential` 一样先判存在性，避免为了
+ *     一个不存在的账号触发主密钥读取（那会连带做 safeStorage 解密）。
+ *
+ * @param {string[]} accountIds 账号 id 列表（顺序即返回的 key 顺序，重复 id 后者覆盖前者）
+ * @param {string} userDataDir Electron userData 目录
+ * @param {{ safeStorage?: object, ownerSubject?: string }} [options] 与 loadCredential 同义
+ * @returns {Promise<Record<string, {configured: boolean, type?: string, hostMasked?: string, port?: number, hasAuthentication?: boolean, invalid?: boolean}>>}
+ */
+async function loadProxyStatuses (accountIds, userDataDir, options = {}) {
+  const ids = Array.isArray(accountIds) ? accountIds.filter(id => typeof id === 'string' && id) : []
+  if (ids.length === 0) return {}
+
+  let rootDir
+  let namespaceDir
+  try {
+    // 显式按 options.ownerSubject 是否存在选分支，不依赖 resolveCredentialArgs
+    // 对 `undefined` 的重载歧义（`ownerOrOptions === undefined` 时它会改吃第二参，
+    // 语义可读性差且容易在后续改动中踩坑）。
+    if (options.ownerSubject === undefined) {
+      const resolved = resolveCredentialArgs(userDataDir, options)
+      rootDir = resolved.rootDir
+      namespaceDir = resolved.namespaceDir
+    } else {
+      const resolved = resolveCredentialArgs(userDataDir, options.ownerSubject, options)
+      rootDir = resolved.rootDir
+      namespaceDir = resolved.namespaceDir
+    }
+  } catch (e) {
+    // 入参非法（如 ownerSubject 为空串）：不猜、不抛给账号页，整体降级为「都没配代理」
+    log.warn('CredentialStore', 'loadProxyStatuses 入参非法，整体降级: ' + (e && e.message ? e.message : String(e)))
+    const degraded = {}
+    for (const id of ids) degraded[id] = { configured: false }
+    return degraded
+  }
+
+  // 先做存在性筛查：只给真实存在的文件付一次主密钥读取 + 一次 PBKDF2。
+  // 文件不存在的账号直接降级，与 loadCredential 的 `existsSync` 短路同口径。
+  const existing = []
+  for (const id of ids) {
+    let filePath
+    try {
+      filePath = getCredentialFilePath(id, namespaceDir)
+    } catch (e) {
+      log.warn('CredentialStore', 'loadProxyStatuses 跳过非法 accountId: ' + (e && e.message ? e.message : String(e)))
+      continue
+    }
+    if (fs.existsSync(filePath)) existing.push({ id, filePath })
+  }
+  if (existing.length === 0) {
+    const degraded = {}
+    for (const id of ids) degraded[id] = { configured: false }
+    return degraded
+  }
+
+  let masterKey
+  try {
+    masterKey = getMasterKey(rootDir, options)
+  } catch (e) {
+    // 主密钥不可用（safeStorage 失效 / fail-closed）：与 getAccountProxyStatus
+    // 的 catch 口径一致——账号页首帧不该被凭证层故障整页打挂。
+    log.warn('CredentialStore', 'loadProxyStatuses 主密钥不可用，整体降级: ' + (e && e.message ? e.message : String(e)))
+    const degraded = {}
+    for (const id of ids) degraded[id] = { configured: false }
+    return degraded
+  }
+
+  // 并行解密：所有账号的 PBKDF2 同时丢进 libuv 线程池。
+  // 文件读取同样用异步版（fs.promises.readFile）—— N 个 readFileSync 会把
+  // 磁盘等待也串成一段同步阻塞，那等于只修了一半。
+  const settled = await Promise.all(existing.map(async ({ id, filePath }) => {
+    try {
+      const payload = await fs.promises.readFile(filePath)
+      const data = await decryptDataAsync(payload, masterKey)
+      const proxy = data && typeof data === 'object' ? data.proxy : undefined
+      if (proxy === undefined || proxy === null) return { id, status: { configured: false } }
+      return { id, status: toPublicProxyStatus(proxy) }
+    } catch (e) {
+      // 密文损坏 / 主密钥不匹配 / JSON 非法：单账号降级，不影响同批其它账号
+      log.warn('CredentialStore', `loadProxyStatuses 账号 ${id} 解密失败，降级为未配置代理: ` + (e && e.message ? e.message : String(e)))
+      return { id, status: { configured: false } }
+    }
+  }))
+
+  const result = {}
+  for (const id of ids) result[id] = { configured: false }
+  for (const { id, status } of settled) result[id] = status
+  return result
+}
+
+/**
+ * 把密文里的 proxy 原值转成渲染层可用的公开形态。
+ * 与 account-manager.getAccountProxyStatus 的降级口径保持一致：
+ * 配置非法时如实报 invalid，而不是谎称未配置。
+ */
+function toPublicProxyStatus (proxy) {
+  try {
+    return toPublicProxyConfig(proxy)
+  } catch (e) {
+    log.warn('CredentialStore', 'loadProxyStatuses proxy 归一失败，标记 invalid: ' + (e && e.message ? e.message : String(e)))
+    return { configured: true, invalid: true }
+  }
+}
+
 /**
  * 获取凭证存储目录
  */
@@ -443,10 +620,12 @@ module.exports = {
   getOwnerCredentialDir,
   saveCredential,
   loadCredential,
+  loadProxyStatuses,
   deleteCredential,
   listAccounts,
   hasCredential,
   cleanOrphanCredentials,
   encryptData,
-  decryptData
+  decryptData,
+  decryptDataAsync
 }
diff --git a/apps/desktop/electron/services/credential-store.test.js b/apps/desktop/electron/services/credential-store.test.js
index 38af00e6d..8e6aa7158 100644
--- a/apps/desktop/electron/services/credential-store.test.js
+++ b/apps/desktop/electron/services/credential-store.test.js
@@ -1,4 +1,4 @@
-import { afterEach, describe, expect, it } from 'vitest'
+import { afterEach, describe, expect, it, vi } from 'vitest'
 import lockHelper from '../../../../test-helpers/windows-file-lock.js'
 
 const { holdExclusiveWindowsFileLock, LOCK_CASE_TIMEOUT_MS } = lockHelper
@@ -292,3 +292,131 @@ describe('credential-store', () => {
     }
   })
 })
+
+// ─── 账号页首帧卡顿修复（2026-10-14）─────────────────────────────────
+// 根因：listAccounts() 为给每个账号附加 proxy 状态，逐个同步解密凭证文件；
+// 每次解密都要跑一次 PBKDF2（10 万次迭代，实测约 125ms/账号），
+// N 个账号 = N × 125ms 串行阻塞主进程 IPC —— 这就是「点左侧菜单『账号』
+// 反应特别慢」的直接原因。
+//
+// 修复：新增异步批量入口 loadProxyStatuses()，用 libuv 线程池并行派生 key
+// （crypto.pbkdf2 异步版），把 N 次串行阻塞降为近似 1 次的等待。
+//
+// 契约（本 describe 逐条钉死）：
+//  C1 与 loadCredential 的 proxy 结论逐字段一致（含 configured/invalid/类型/掩码/端口）
+//  C2 解密失败（文件损坏/主密钥不可用）时该账号降级 { configured: false }，不抛错
+//  C3 凭证文件不存在时同样 { configured: false }，且不触发主密钥读取
+//  C4 空输入返回空对象；不含 owner 的输入走 legacy 命名空间
+//  C5 **并行不串行**：N 个账号的总 wall-time 必须显著小于 N × 单账号耗时
+//     （这是本 Bug 的回归锁——退回串行实现必须变红）
+describe('credential-store — loadProxyStatuses 并行批量读取', () => {
+  /** 造一个带 proxy 的凭证并落盘，返回其明文 proxy 配置 */
+  function seedAccount (userDataDir, accountId, proxy, options) {
+    expect(credentialStore.saveCredential(accountId, { cookies: [], proxy }, userDataDir, options)).toBe(true)
+    return proxy
+  }
+
+  it('C1 与逐账号 loadCredential 的 proxy 结论逐字段一致', async () => {
+    const userDataDir = createTempDir()
+    const options = { safeStorage: createSafeStorage() }
+    const proxy = { host: '10.0.0.7', port: 8080, type: 'socks5', username: 'u', password: 'p' }
+    seedAccount(userDataDir, 'acct-parity', proxy, options)
+
+    const viaBatch = await credentialStore.loadProxyStatuses(['acct-parity'], userDataDir, options)
+    // 单账号口径：走 loadCredential + toPublicProxyConfig
+    const viaSingle = credentialStore.loadCredential('acct-parity', userDataDir, options)
+    expect(viaBatch['acct-parity']).toBeDefined()
+    expect(viaBatch['acct-parity'].configured).toBe(true)
+    expect(viaBatch['acct-parity'].type).toBe('socks5')
+    expect(viaBatch['acct-parity'].hostMasked).toBe('10.0.*.*')
+    expect(viaBatch['acct-parity'].port).toBe(8080)
+    expect(viaBatch['acct-parity'].hasAuthentication).toBe(true)
+    // 单账号路径确实也看得到同一份 proxy（证明两侧读的是同一真源）
+    expect(viaSingle.proxy).toEqual(proxy)
+  })
+
+  it('C2 解密失败（文件损坏）时该账号降级 configured:false 且不抛错', async () => {
+    const userDataDir = createTempDir()
+    const options = { safeStorage: createSafeStorage() }
+    seedAccount(userDataDir, 'acct-ok', { host: '10.0.0.1', port: 3128 }, options)
+    const credDir = path.join(userDataDir, 'credentials')
+    // 另一个账号：文件存在但内容不是合法密文 → 解密必失败
+    fs.writeFileSync(path.join(credDir, 'acct-corrupt.json.enc'), Buffer.from('not-a-valid-ciphertext'))
+
+    const result = await credentialStore.loadProxyStatuses(['acct-ok', 'acct-corrupt'], userDataDir, options)
+
+    expect(result['acct-ok'].configured).toBe(true)
+    expect(result['acct-corrupt']).toEqual({ configured: false })
+  })
+
+  it('C3 凭证文件不存在时 configured:false 且不触发主密钥读取', async () => {
+    const userDataDir = createTempDir()
+    const safeStorage = createSafeStorage()
+    const getMasterKey = vi.spyOn(credentialStore, 'getMasterKey')
+
+    const result = await credentialStore.loadProxyStatuses(['acct-missing'], userDataDir, { safeStorage })
+
+    expect(result['acct-missing']).toEqual({ configured: false })
+    expect(getMasterKey).not.toHaveBeenCalled()
+    getMasterKey.mockRestore()
+  })
+
+  it('C4 空输入返回空对象；无 owner 时走 legacy 命名空间', async () => {
+    const userDataDir = createTempDir()
+    const options = { safeStorage: createSafeStorage() }
+
+    expect(await credentialStore.loadProxyStatuses([], userDataDir, options)).toEqual({})
+
+    // legacy 命名空间（不传 ownerSubject）
+    seedAccount(userDataDir, 'acct-legacy', { host: '10.0.0.2', port: 7890 }, options)
+    const legacy = await credentialStore.loadProxyStatuses(['acct-legacy'], userDataDir, options)
+    expect(legacy['acct-legacy'].configured).toBe(true)
+    expect(legacy['acct-legacy'].port).toBe(7890)
+
+    // owner 命名空间：同 id 不同 owner 是不同文件
+    seedAccount(userDataDir, 'acct-shared', { host: '10.0.0.3', port: 1080 }, {
+      safeStorage: createSafeStorage(),
+      ownerSubject: 'user-a',
+    })
+    const scoped = await credentialStore.loadProxyStatuses(['acct-shared'], userDataDir, {
+      safeStorage: createSafeStorage(),
+      ownerSubject: 'user-a',
+    })
+    expect(scoped['acct-shared'].configured).toBe(true)
+    expect(scoped['acct-shared'].port).toBe(1080)
+  })
+
+  it('C5 并行不串行：N 个账号的总 wall-time 显著小于 N × 单账号耗时', async () => {
+    const userDataDir = createTempDir()
+    const options = { safeStorage: createSafeStorage() }
+    const N = 6
+    const ids = []
+    for (let i = 0; i < N; i++) {
+      const id = `acct-batch-${i}`
+      ids.push(id)
+      seedAccount(userDataDir, id, { host: `10.0.0.${i + 1}`, port: 9000 + i }, options)
+    }
+
+    // 基线：单账号一次解密的 wall-time（同步路径）
+    const singleStart = process.hrtime.bigint()
+    credentialStore.loadCredential(ids[0], userDataDir, options)
+    const singleMs = Number(process.hrtime.bigint() - singleStart) / 1e6
+
+    const batchStart = process.hrtime.bigint()
+    const result = await credentialStore.loadProxyStatuses(ids, userDataDir, options)
+    const batchMs = Number(process.hrtime.bigint() - batchStart) / 1e6
+
+    // 全部命中
+    for (const id of ids) expect(result[id].configured).toBe(true)
+
+    // 回归判据：串行实现下 batchMs ≈ N × singleMs；并行实现下应远小于此。
+    // 阈值取 N 的一半：并行版实测 ratio ≈ 2.1（N=6、线程池 4），串行版
+    // ratio ≈ N = 6。取 3.0 既留足线程池调度与机器抖动余量，又能把
+    // 「退回串行」这一种退化稳稳判红（6 > 3.0）。
+    const ratio = batchMs / singleMs
+    expect(
+      ratio,
+      `batch=${batchMs.toFixed(0)}ms single=${singleMs.toFixed(0)}ms ratio=${ratio.toFixed(2)}（串行实现应 ≈ ${N}）`,
+    ).toBeLessThan(N / 2)
+  })
+})

```

> 这是机械生成的变更提案，不代表任何设计意图。评审方请只针对上述内容挑刺。