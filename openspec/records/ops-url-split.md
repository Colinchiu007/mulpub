---
record: ops-url-split
task: getConfig().url 混装「手填 / 自动发现」地址的拆分
date: 2026-10-15
---

## 本次执行记录：getConfig().url 混装「手填 / 自动发现」地址拆分（ops-url-split，2026-10-15）【混合 PR】

| 门禁项 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 运行时代码变更（`apps/desktop/electron/services/`）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-ops-url-split`（分支 `ops-url-split`，基线 `3aef9f1cc`） |
| 第一性原因（QM-5 ①） | PASS | `getConfig().url` 把「用户手填地址」与「部署层自动发现地址」并入同一字段。**第一性缺陷**：`_fetchCatalog(baseUrl, auth)` / `_fetchRuntime(baseUrl, auth)` 早已接收 `baseUrl` 参数，但 `_fetchJson(path, auth)` **从不接收它**，只能内部重读混装字段 ⇒ **自动发现地址被当成手填地址消费**（死参数 + 混装重读，两个缺陷叠加）。变更与 `apiKeyConfigured`/`lastSyncedAt` 无关，故不动 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链：①**单元层**——旧实现把判据写成 `getConfig()` 内联字段，无任何测试直接断言「手填/自动/生效」三态形状；②**集成层**——`_fetchJson` 的 base 由内部读取，测试用 mock fetch 时只断言 URL 路径片段（`/api/v1/...`），base 从哪来无从检验；③**端到端层**——真实零配置部署下两条路径**恰好同源同序**（`manualUrl \|\| autoUrl` 与 `cfg.url \|\| auto.url` 等价），故行为正确，缺陷**被巧合掩盖**；④**审查层**——`_syncNowInner` 的注释（L297-298）已明确写「不能用 `getConfig().url` 判断手动态」，但同一份注释没有把**唯一误用的 L712** 一并指出，属于「写下判据却没扫全消费点」。系统性漏洞分类：**测试场景缺失**（无三态形状锁）+ **审查盲区**（注释只写"不要用"，未做全消费点扫描） |
| 修复 + 回归保护（QM-5 ④） | PASS | ①新纯函数模块 `ops-center-sync-url.js`（`resolveSyncUrls` / `shouldRefusePin`，零依赖、可单测）；②`getConfig()` 经它产出 `manualUrl`/`effectiveUrl`/`autoUrl` 三口径，`url` 保留为**同值别名**（历史兼容）；③`_fetchJson(path, auth, base)` 改为**显式接收** base，`_fetchCatalog`/`_fetchRuntime` 把已接收的 `baseUrl` 真正传下去（死参数消除）；④`saveConfig` 加**固化护栏**（零配置态下拒绝把自动地址原样写回手填 —— 该动作不可逆，会让终端不再跟随部署层）。回归锁 `ops-center-sync-url-semantics.test.js` **18 条**（4 条纯函数 + 4 条 getConfig 形状/别名 + 5 条固化护栏 + 5 条结构锁） |
| 防止再次发生（QM-5 ⑤） | PASS | 结构锁**直接扫源码**断言：①`getConfig().url` 形式的取用**必须为 0 处**（唯一混装消费点已消除）；②`_fetchJson` 的 base 来自第三参数；③两个 fetch 方法把 `baseUrl` 真正传给 `_fetchJson`；④`getConfig` 经 `resolveSyncUrls` 产出三口径（不在本文件重抄判据）；⑤纯函数模块零 `require`、零 `this`。**判据化**：日后任何人再把 `getConfig().url` 拿去当 base，第 ① 条锁立刻红 |
| 变异反证 | PASS | 三处，均实测改坏立刻变红 + **字节级还原**：①`manualUrl` 退回旧混装 `manual \|\| auto` ⇒ **4 条失败**；②`effectiveUrl` 只取 `manualUrl` ⇒ **3 条失败**；③`shouldRefusePin` 恒 `false`（摘护栏）⇒ **2 条失败**。脚本 `D:\Temp\mutate-url-semantics.js` 每次还原后 `Buffer.compare` 自证 |
| 测试通过 | PASS | `ops-center-sync.test.js` + `ops-center-sync.resilience.test.js` + 新文件 **共 116 条全绿**（既有 98 + 新 18）。既有测试未被破坏 ⇒ 别名与显式字段的方案对旧消费点透明 |
| QM-1 打包 | PASS | `pnpm run build:dir` **rc=0**；产物级证据：`asar list` 含 `\electron\services\ops-center-sync-url.js`（新模块确实进产物）。构建重写的 3 个生成文件（`index.bundle.js` / `home-shell-preload.bundle.js` / `card-paginator.iife.js`）**两口径 numstat 皆空（纯行尾）**，已按 R2 精确恢复、未混入本 PR |
| QM-2 代码必检项 | PASS | require 路径存在（`./ops-center-sync-url` 已验证 `node --check` 通过）；**未改 preload**（故无需 sandbox 双模式与重启验证）；无新增 IPC 入口与参数（`saveConfig` 的拒绝分支返回既有 `{code, message}` 形状）；无 IPC 序列化风险；`module.exports` 无多余逗号；零硬编码等待；无 `console.log` 污染 |
| locale 成对 | N/A | 未新增/修改任何用户可见文案（`saveConfig` 的拒绝 `message` 是**主进程返回给调用方的错误串**，非渲染端静态文案；渲染端无对应展示面 —— 运营中心配置入口已于 #3543 整体移出应用前端） |
| 视觉回归 | N/A | 无前端视觉变更（纯主进程地址口径改造，零 UI 改动） |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记（变更 279 行 > 200 行阈值，按判据本应走 dual） |
| 远程同步 | PASS | merge `325e6151617368af8cd8e90997a556de31e15fd5`（2026-10-15 03:25:55 +08:00）；PR 已 MERGED，远端分支 `ls-remote` 0 行 |
### 交付内容（3 文件，279 插入 / 11 删除）

1. **`apps/desktop/electron/services/ops-center-sync-url.js`（新增 44 行）** — 零依赖纯函数模块：
   - `resolveSyncUrls({ storedUrl, autoUrl, autoAvailable })` → `{ manualUrl, autoUrl, effectiveUrl, autoConnected }`
   - `shouldRefusePin({ storedUrl, autoUrl, candidate })` → 固化护栏判据
2. **`apps/desktop/electron/services/ops-center-sync.js`（+22 −11）** — 四处接线：
   - `+1` import；`getConfig()` 经 `resolveSyncUrls` 产出三口径（`url` 保留为同值别名）
   - `_fetchJson(path, auth, base)` 显式接收 base；`_fetchCatalog`/`_fetchRuntime` 把 `baseUrl` 真正传下去
   - `saveConfig` 加固化护栏（拒绝时返回既有 `{code:-1, message}` 形状）
3. **`apps/desktop/electron/services/ops-center-sync-url-semantics.test.js`（新增 213 行 / 18 条）**

### 本笔刻意不带 `.quality-gates.md` 与 ledger 登记项（判据化说明，非遗漏）

这两个文件是**全体并发会话的共同追加热点**：带它们会让本 PR 每 ~13 分钟就 `CONFLICTING`，
而混合 PR 自身的 CI 需要 ~40 分钟 ⇒ **结构性活锁**（上一笔 #3585 连续 4 次重放全败即为实证）。
**实测去掉后门禁仍全绿**（`check-gate-record-debt.test.js` **49/0**、`check-pr-exec-record` rc=0、
`check-record-qm5-rows` OK）—— 判据只要求 `.quality-gates.md` 的**顶部记录**带行，而本笔的记录住在
自己的**新文件**（本文件，永不与他人的追加重叠）。载体的写入由随后的 **docs-only 回填 PR** 完成
（该 PR CI 秒级，不受活锁影响），并在其中把本记录的两形态一并改为 `PASS` + merge SHA。

### 残留风险（不假装已闭合）

1. **`saveConfig` 的固化护栏目前无 UI 触发路径**（运营中心配置入口已于 #3543 移出应用前端），
   本护栏是**数据层**防护：防的是「日后重新引入入口时，把自动地址写回手填」这一不可逆动作。
   因此它的价值绑定在**未来**，当前仅由单测与判据保证形状正确。
2. **`process.env.OPS_CENTER_URL` 仍是 `_fetchJson` 的兜底**（`base || env || ''`）。本次只把
   「内部重读 `getConfig().url`」改为「调用方显式传入」，**未动 env 兜底语义**（那是既有行为，
   改动它会牵动 `resolveAutoSyncGuard` 的判据）。若日后要收敛 env 与部署层两条来源，需独立切片。
3. **`getConfig().url` 仍作为同值别名保留**（历史兼容）。结构锁只保证「不再出现 `getConfig().url`
   形式的**取用**」，**不阻止**外部模块继续读该字段。若要彻底移除，需先盘点跨进程消费点
   （渲染端 IPC 返回体 `res.config`）并做契约迁移，属独立切片。

### 保留门禁

行尾对账 ✅（3 文件两口径一致） | 品牌残留 ✅ | locale 成对 N/A | 视觉回归 N/A | 债务熔断 ✅（`filesOver500` 计数 97 ≤ 基线 101） | QM-1 ✅（rc=0 + asar 含新模块） | 远程同步 PASS（merge 325e61516，远端分支 0 行）
