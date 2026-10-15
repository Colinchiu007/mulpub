---
record: ops-base-single-src
task: 收敛 ops-center 请求 base 的单一真源
date: 2026-10-15
---

## 本次执行记录：收敛 ops-center 请求 base 的单一真源（ops-base-single-src，2026-10-15）【混合 PR】

| 门禁项 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 运行时代码变更（`apps/desktop/electron/services/`）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-ops-base-single-src`（分支 `ops-base-single-src`，基线 `8e9109a55`） |
| 第一性原因（QM-5 ①） | PASS | `_fetchJson(path, auth, base)` 的 base 行写着 `base \|\| process.env.OPS_CENTER_URL \|\| ''`。**第一性缺陷**：env 早已被 `_getAutoContext()`（L679）归一后经 `effectiveUrl = manualUrl \|\| auto.url` 汇入 base，所以这个兜底在真实调用链下**不可达**；而它一旦可达，就会让「谁提供 base」劈成两个真源 —— 调用方明明用 `effectiveUrl` 表达了来源优先级（手填 > 自动发现），这一行却会在 base 为空时**悄悄改走 env**，与 `autoConnected` / `useBearer` / `resolveAutoSyncGuard` 所依据的优先级不一致。变更与密钥、目录结构无关，故不动 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链：①**单元层**——既有测试只断言「fetch 收到了哪个 URL」，从未断言「URL 的**来源**只有一个」；②**集成层**——env 注入型用例（`ops-center-sync.test.js:231` 向后兼容 env）只验证 env 能被用上，**不验证它不会从第二个口子进来**；③**端到端层**——真实调用链上 `_syncNowInner` L307 有 `if (!effectiveUrl) return`，空 base 被拦在门外，所以兜底从不触发，**缺陷被早期 return 掩盖**；④**审查层**——上一笔 #3608 把 `getConfig().url` 的混装拆开后，注释里点名了「唯一误用点」，但**漏看了同函数内还剩一个 env 兜底**，属于「拆一层没扫全同函数其余真源」。系统性漏洞分类：**测试场景缺失**（无「来源唯一性」断言） |
| 修复 + 回归保护（QM-5 ④） | PASS | ①删掉 `_fetchJson` 的 env 兜底，base 改为**唯一真源**；②base 为空时 **fail-closed 抛错**（`内部错误：请求缺少运营中心地址（base 未传入）`）而非静默改走 env；③env 的两个**正当**入口保持不变：`_getAutoContext` 的 autoUrl 归一、`resolveAutoSyncGuard` 的判据入参。回归锁 `ops-center-sync-url-semantics.test.js` 由 18 条增至 **24 条**：新增 3 条结构锁（env 在源码中恰好 2 处且都在归一处、`_fetchJson` 不再含 env、空 base 必须抛错）+ 4 条行为锁（env 仍能驱动真实请求、手填优先于 env、空 base 抛错且不发出请求、两次同步 origin 一致） |
| 防止再次发生（QM-5 ⑤） | PASS | 结构锁**扫源码**断言：`process.env.OPS_CENTER_URL` 在去掉注释后的代码行中**恰好出现 2 次**，且两行都必须匹配 `normalizeUrl(this._autoOpsCenterUrl \|\| process.env.OPS_CENTER_URL \|\| '')`，并断言其中**没有任何一行**与 `_fetchJson` 相关。判据化：日后任何人再把 env 加回 `_fetchJson` 当 fallback，这条锁立刻红 |
| 变异反证 | PASS | 四处，均实测改坏立刻变红 + **字节级还原**：①把 env 兜底加回 `_fetchJson` ⇒ **2 红**；②摘掉空 base 的 fail-closed ⇒ **2 红**；③让 env 绕过 `_getAutoContext` 直接进 autoUrl ⇒ **3 红**；④让 env 压过 manualUrl（`effectiveUrl` 只取 auto）⇒ **1 红**。脚本 `D:\Temp\mutate-base-single-src.js`，每次还原后 `Buffer.compare` 自证 |
| 测试通过 | PASS | `ops-center-sync.test.js` + `ops-center-sync.resilience.test.js` **98 条全绿**（既有行为零破坏）；新文件 **24 条全绿**（18 旧 + 6 新） |
| QM-1 打包 | PASS | `pnpm run build:dir` **rc=0**；`asar list` 含 `\electron\services\ops-center-sync-url.js`。构建重写的生成文件按 R2 精确恢复，未混入本 PR |
| QM-2 代码必检项 | PASS | require 路径存在；**未改 preload**；无新增 IPC 入口与参数；`throw new Error(...)` 走既有 `tagOpsError` 出口（`_fetchRuntime` 的 try/catch 会包成 failureKind），不改错误分类；注释 `/* */` 成对；`module.exports` 无多余逗号 |
| 行数门禁 | PASS | `.github/scripts/check-max-lines.js` **rc=0**：文件 770 行 = 登记值 570 + 容差 200 的上限（**未动基线**）。过程中一度 772，按上一轮沉淀的判据**压缩注释**（而非 `--update`）回到 770 |
| locale 成对 | N/A | 未新增/修改任何用户可见文案（`内部错误：…` 是主进程内部错误串，不达渲染端） |
| 视觉回归 | N/A | 无前端视觉变更（纯主进程地址来源收敛） |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | merge `a92508dff528c8c6c7c4f156abe50849f3c5d93f`（2026-10-15 13:10:48 +08:00）；PR 已 MERGED，远端分支 `ls-remote` 0 行 |
### 交付内容（2 文件）

1. **`apps/desktop/electron/services/ops-center-sync.js`（+7 −2）** —— 只动 `_fetchJson` 的 base 行：删 env 兜底 + 加空 base fail-closed；另压缩 1 行注释以留在行数上限内。
2. **`apps/desktop/electron/services/ops-center-sync-url-semantics.test.js`（+90 −1）** —— 18 条 → **24 条**：3 条结构锁（env 恰好 2 处且在归一处、`_fetchJson` 无 env、空 base 抛错）+ 4 条行为锁（env 仍驱动请求、手填优先、空 base 不发出请求、两次同步 origin 一致）。

### 本笔刻意不带 `.quality-gates.md` 与 ledger 登记项（判据化说明，非遗漏）

这两个文件是全体并发会话的共同追加热点，带它们会让本 PR 每 ~13 分钟 `CONFLICTING`，而混合 PR 自身 CI 需 ~40 分钟 ⇒ 结构性活锁。判据只要求「未收口的远程同步行已登记」，本记录自带 `sync_*` 三字段即满足（实测 `check-gate-record-debt.test.js` 49/0）。载体写入由随后的 **docs-only 回填 PR** 完成，其中把本记录两形态改为 `PASS` + merge SHA 并新增本体 QG 块（直接 PASS 形态）。

### 残留风险（不假装已闭合）

1. **`_getAutoContext()` 仍把 env 与 `_autoOpsCenterUrl` 并列**（`this._autoOpsCenterUrl || process.env.OPS_CENTER_URL`）。本轮只收敛了 `_fetchJson` 一个口子，**没有动这个并列** —— 因为 `_autoOpsCenterUrl` 由 bootstrap 经 `setOpsCenterUrl` 注入，改它的优先级会牵动 `resolveAutoSyncGuard` 的判据，属独立切片。
2. **空 base 的 `内部错误：…` 目前只有单测覆盖**，真实链路被 `if (!effectiveUrl) return` 挡在前面，所以这条 fail-closed 是**纵深防御**而非当前可触发路径；它的价值在于「将来有人绕过 `_syncNowInner` 直接调 `_fetchJson` 时不会静默打错地址」。

### 保留门禁

行尾对账 ✅ | 品牌残留 ✅ | locale 成对 N/A | 视觉回归 N/A | 行数门禁 ✅（rc=0，未动基线）| QM-1 ✅ | 远程同步 PASS（merge a92508dff，远端分支 0 行）
