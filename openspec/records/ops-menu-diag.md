---
record: ops-menu-diag
task: 运营中心「应用菜单」改完不生效——应用侧早退静默，失败无信号
date: 2026-10-14
---

## 本次执行记录：运营中心「应用菜单」改完不生效——应用侧早退静默（ops-menu-diag，2026-10-14）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 改 `apps/desktop/electron/services/`（运行时代码）⇒ 必须独立 worktree。**注意**：`scripts/start-mp-task.ps1` 本次被 `mp-worktree-health.ps1` 拒（`ok:false`），原因**不是我的**——`outsideWorktrees: ["D:/Temp/egress-base"]` 是**别的会话**在 `mp-worktrees` 之外建的游离 worktree（`38bef9765`，detached）。按铁律 A 我**没有**删它、也**没有**把它登记进 `allowed-worktrees.json` 替别人背书；改为把**自己的** worktree 建在规范根内（`git worktree add -b ops-menu-diag D:\Data\projects\mp-worktrees\mp-ops-menu-diag origin/main`），健康检查里 `clean:true` 与 `writeGuard.ok:true` 均通过，仅在 `outsideWorktrees` 一项因他人产物保持红。依赖按 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 就绪 |
| 第一性原因（QM-5 ①） | PASS | 断点**不在菜单链路**，而在 `autoSyncOnStart()` 的**静默早退**。原实现三道早退全是裸 `return`：`if (!cfg.autoSync) return` / `if (!cfg.url && !auto) return` / `if (cfg.url && !cfg.apiKeyConfigured && !auto) return`。判据本身没错（没配置就不该硬发请求），错的是**不发请求也不说为什么**——于是应用可以在「运营下发配置（应用菜单/公告/功能开关）永远不会生效」的状态下常年运行而**没有任何信号**。这与「守护者只在有人看着时才工作」是同一类缺陷：**失败无信号**。现场实证：共享数据锚点 `shared-user-data\multi-publish.db` 的 settings 表里 `opsCenterSync` 与 `opsCenterRuntime` **各 0 行**（18 个键里没有任何 ops 项），且 `opsCenterSync` 在**全部 13 个库（含 2026-09-23 起每份备份）**中都从未出现过 ⇒ 不是「配置被弄丢」，是**从未配置过**；当日 `logs\app-2026-10-14.log` 里 `catalog-synced` / `auto-sync-skipped` / `auto-sync-error` **一条都没有** ⇒ 同步要么没发起、要么在静默处返回，排查者连断点在应用侧还是服务端都判断不了 |
| 逃逸分析（QM-5 ②） | PASS | ①**测试层**——既有 `ops-center-sync.test.js:352`「未配置自动同步时不调度」**只锁了「不调度」，没锁「要出声」**；「不调度」与「不出声」是两件事，前者绿不代表后者，于是这条锁定格了缺陷形态；②**判据层**——`getConfig().url` 会把自动发现地址并入（`url = 手动 url \|\| 自动 url`），而 `_getAutoContext()` 在缺登录令牌回调时返回 null；两者叠加使「自动发现地址已配好、只是缺令牌」**伪装成「完全未配置」**（本机现场正是这一态：`config/identity-public.json` 里 `opsCenterUrl=https://ops.iart.work`，但令牌回调缺失）——即便当时有日志，只要原因含糊，排查者仍会去翻设置页而找不到问题；③**观测层**——运行时唯一来源是内置占位种子 `apps/desktop/resources/ops-seed/runtime-bootstrap.json`，其第 28 行 `"appMenu": null`，日志里却有 `runtime-hydrated-from-seed ... staleDays:6` 的**正常**记录 ⇒ 系统「看起来是好的」；④**验收层**——没有端到端判据回答「我的运营配置到底生效了没有」，用户只能靠肉眼比对侧边栏。系统性漏洞＝**判据只覆盖「该不该同步」，没覆盖「没同步时是否出声」，且两种不同原因被压成同一种表象** |
| 修复 + 回归保护（QM-5 ④） | PASS | ①判据外移到独立模块 `apps/desktop/electron/services/ops-center-sync-autosync-guard.js`：纯函数 `resolveAutoSyncGuard(cfg, hasAutoContext, autoUrlRaw, hasAccessToken)` 返回 `{ok:true}` 或 `{ok:false, reason, params}`，**不读环境、不碰 store、不打日志**，判据可单测；②**出声留在主文件**（`if (!guard.ok) return this._log && this._log.notify(...)`）——判据可以外移，但「谁负责说话」必须留在调用点，否则又会退化成无人出声；③三种原因**可区分**：`auto-sync-not-started-disabled` / `-unconfigured` / `-missing-api-key`，各自带 `hint` 下一步；`-unconfigured` 额外带 `autoUrlConfigured` 与 `hasAccessToken` 两个字段，把「自动发现地址有、只是缺令牌」从「完全未配置」里拆出来；④**归一化不写第二份**：`normalizeUrl` 仍在主文件（单一实现），调用方把已归一化的 auto url 传进去；⑤**回归锁**加在**已接线**的 `apps/desktop/electron/services/ops-center-sync.test.js`（`electron-ci.yml`）里，4 条各钉「不调度」**且**「出声且原因可区分」（含一对 `not.toContain` 反向断言，防止三种原因被合并成一条含糊的 skipped）；⑥**债务熔断**：主文件登记值 570 + 容差 200 = 770，改前已 768（几乎顶格），故本笔把判据整体外移，主文件净变化 **+1 行（769）**，`check-max-lines.js` rc=0 |
| 防止再次发生（QM-5 ⑤） | PASS | ①**同型扫描**：本仓 `syncNow` 内部**曾经**踩过同一形态并已修（#2374「运营配置不被模型目录门控」、2026-09-25 复盘「目录失败导致运营菜单永远拉不到」，现为 `Promise.allSettled` 双通道并行）——说明「运营配置被别的东西门控」在本仓是**复发型**缺陷，本笔修的是它在**上一层**（是否发起同步）的重犯；②**判据可单测**：新模块是纯函数，后续任何人改早退条件都必须过这 4 条锁与反向断言；③**出声带下一步**：`hint` 直接给「设置 → 运营中心同步 → 打开自动同步」/「手填地址 + API Key（bootstrap 只认 X-Catalog-Key，Bearer 不适用）」，把排查从「翻源码」降到「读一行日志」；④**实测纪律**：本笔原打算修「本地签名私钥是 27 字符占位串」——**实测否证**：`/api/v1/runtime/bootstrap` 返回 200、含 `signature`、`verifyRuntimeSignature(data, '')` 用内置 DEV 公钥验签 `{"ok":true}`，遂弃该假设、不做无据修复（该实测已写入 PR 正文）；⑤**残留（不假装已闭合）**：`auto-sync-*` 目前只进日志，**未在设置页做可见提示**——用户不翻日志仍看不到；建议后续在「运营中心同步」设置页展示最近一次未发起原因（属产品决策，另行排期） |
| 反证（变异必须变红） | PASS | 4 条新用例各自钉住一条早退路径。**变异实跑**：把主文件的出声口改回静默（`if (!guard.ok) return`）⇒ 4 条**全部变红**（`Tests 4 failed \| 75 passed (79)`）；还原 ⇒ `79 passed (79)`。变异是在**判据外移之后重做的**（代码结构变了，不复用外移前的结论） |
| 编码与行尾 | PASS | `check-max-lines.js` rc=0（主文件 769 ≤ 770，无 `LEDGER_GREW`）；`ops-center-sync.test.js` 79/79 通过；相邻测试 `settings-roundtrip-contract.test.js` + `ops-center-sync.resilience.test.js` 28/28 通过 |
| QM-1 本地打包 | PASS | `apps/desktop` 下 `pnpm exec electron-builder --win --dir --publish never` 返回 0；`asar list` 清单含新模块 `ops-center-sync-autosync-guard.js`（require 路径在打包产物中可解析）；`win-unpacked\Multi-Publish.exe` 启动存活 >8s；stderr 无 `Failed to load platform config`、无 `ENOTDIR.*app.asar` |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | merge `4d777356d`（2026-10-14 04:31:43 +08:00）；PR 已 MERGED、远端分支已删（`git ls-remote` 0 行）；回填与销账同次提交 |

- 保留门禁：TDD ✅ | 编码/行尾对账 ✅ | 品牌残留 ✅ | 债务账本 ✅ | 远程同步 PASS

### 现场取证（本笔的动因，如实记录）

用户报告：「运营中心『应用菜单』的设置修改内容没有体现在应用前端」。逐层取证结论如下（**这条链路的代码是好的，断点在应用从未去取**）：

1. **运营中心侧 100% 健康**——读 `mp-ops-data\config.db` 的 `app_menu_items`（21 行，`updated_at=2026-10-12T09:34:41Z` by `admin`：`dashboard` 移入「更多」、`hot-topics`/`knowledge-base` 提级到一级导航、`comments`/`cloud-publish`/`model-providers`/`member-center` 置为隐藏）；`config.db-wal` 的写入时间正是该时刻（数据在 WAL 未 checkpoint，只读连接可正常读到）。启动后实测 `GET /api/v1/runtime/bootstrap`（`X-Catalog-Key`）**返回 200**，`appMenu.items` 21 项**与上述改动逐项吻合（7/7 抽查 ✅）**，且含 `signature`。
2. **信任锚无问题**——把该响应喂给桌面端**自己的** `verifyRuntimeSignature(data, '')`（未打包、无自定义锚 ⇒ 回落内置 DEV 公钥）⇒ `{"ok":true}`。
3. **应用侧从未取过**——运行中的应用（6 个 electron 进程）以 `--user-data-dir=D:/Data/projects/mulpub/shared-user-data` 启动，该库 settings 表 18 个键**无任何 ops 项**；当日日志无任何 `auto-sync-*`；唯一运行时来源是内置占位种子，其 `"appMenu": null` ⇒ 渲染端 `resolveSidebarMenu(def, null)` **fail-open 回退本地默认菜单**。
4. ⇒ **你的改动永远不可能出现在应用里**，且应用不会为此报任何错。

**即时解法（配置，非代码）**：应用「设置 → 运营中心同步」手填 **地址 `http://127.0.0.1:8010`** + **API Key = 锚点 `.env` 的 `OPS_CATALOG_API_KEY`**、打开「自动同步」、信任锚**留空**（未打包回落到已实测通过的内置 DEV 公钥）。**不能靠自动发现**：`config/identity-public.json` 的 `opsCenterUrl` 指向生产的 `https://ops.iart.work`（不是你在改的本地库），且该端点只认 `X-Catalog-Key`（`routers/runtime.py::_require_catalog_key`），而自动发现路径会发 Bearer（`useBearer = !manualUrl && !!auto && !apiKeyConfigured`）⇒ 必然被拒。

### 一个被实测否证的假设（如实记录，避免后人重走）

排查中途我据 `.env` 里 `OPS_RUNTIME_SIGNING_PRIVATE_KEY` **只有 27 字符**（恰为 `-----BEGIN PRIVATE KEY-----` 的长度）推断「它是只有 PEM 头的占位串 ⇒ bootstrap 签不出来」。**实测否证**：端点返回 200 且验签通过 ⇒ 该推断错误，遂**未**据此改任何代码、也**未**据此让用户去重新生成密钥。教训：**推断必须在动手前用一次真实请求否证**，否则会把一次误判写成一笔无据修复。

### 遗留（不假装已闭合）

- **`auto-sync-*` 只进日志，未在设置页可见**：用户不翻日志仍看不到「为什么没生效」。建议后续在「运营中心同步」设置页展示最近一次未发起原因。
- **运维侧无同型判据**：`scripts/start-ops-center.ps1` 只校验 `/health`，不校验「桌面端依赖的 `/api/v1/runtime/bootstrap` 能否签发」——本次该端点恰好正常，但同一形态（**判据只覆盖「进程活着」，不覆盖「它能否提供桌面端要的东西」**）仍留在脚本里，建议后续补一条冒烟断言。
- **`getConfig().url` 混装两种来源**：把自动发现地址并入 `url` 使「有自动地址但缺令牌」无法与「完全未配置」在数据上区分；本笔靠额外传 `autoUrlRaw` 绕开，但**根因未动**（拆 `url` / `autoUrl` 语义会波及设置页与多处判据，属独立改造）。
