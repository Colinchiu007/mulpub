---
record: cli-health-port-flake
task: 修掉让 main push 常红的 cli.test.js 两处环境假设（硬编码端口 + stderr 必须为空）
date: 2026-10-20
---

## 本次执行记录：`cli.test.js` 两处环境假设（cli-health-port-flake，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码路径（`packages/`）⇒ 走正规入口 `bash scripts/session-init.sh cli-health-port-flake`，在 `<仓库父目录>/mp-worktrees/mp-cli-health-port-flake` 与裸分支 `cli-health-port-flake` 中工作，起点 == `origin/main`；`verify-worktree-deps.js` 通过（11 项消费方解析） |
| 根因与逃逸链（QM-5） | ✅ | 见 `01-docs/BUGFIX-CLI-HEALTH-PORT-FLAKE-2026-10-20.md`。**两个独立缺陷**：① `'--port','4568'` 硬编码 vs nx 把 node:test 与 45 个 vitest 文件并发跑 ⇒ 端口被占后子进程绑定失败即退出，而 `waitForPort` 只会等到超时；② `eq(err,'')` 把 nx 注入 `FORCE_COLOR` + 环境里 `NO_COLOR` 引起的 Node 环境警告当成失败。**确定性复现**：先占住 4568 再跑 ⇒ `Result: 3/4`，红文案与 CI 一字不差 |
| 修法与判据 | ✅ | `pickFreePort()`（`listen(0)` 由内核分配）；`BOOT_TIMEOUT_MS=15000` + 失败时把子进程 stderr 末 800 字拼进错误；`--help` 等待 3s→15s；`eq(err,'')`→`stripBenignNodeWarnings(err)`（只剔除已点名的两类警告行）；新增**行扫描防回归锁**（同行出现 `'--port'` 与 4 位固定端口即红） |
| 变异反证（两条） | ✅ | ① 还原旧断言 ⇒ 包级 `[API 测试] 失败：cli.test.js`；② `pickFreePort()` 还原成 4568 且占住该端口 ⇒ `Timed out waiting for port 4568 after 15000ms (last error: read ECONNRESET)`、`Result: 5/6`；还原两处 ⇒ 单跑 `6/6`、包级 `NX Successfully ran target test` rc=0 |
| TDD 顺序 | ✅ | 先写**确定性复现**（占端口 → 3/4）作为红，再改代码转绿；两条变异用于确认判据不是空转。本次未新增生产代码，故无「先写单测再写实现」的传统形态，红→绿→反证三段齐全 |
| QM-1 打包 / QM-4 视觉 | N/A | 只改 `packages/api-publish-engine/test/cli.test.js`（测试文件），未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-2 必检项 | N/A | 零生产代码变更；无高频路径、无同步 CPU 密集原语、无 UI 框架引入 |
| QM-6 CCG 双模型评审 | 见判定记录 | 本 PR 预期 < 200 行（实测 109+/10-）⇒ 判定器按 `skip` 档，属豁免面；若被提为 `dual` 则按闭环口径补记 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（见 PR 正文）；Git 提示的 `LF will be replaced by CRLF` 属既有 `text=auto` 行为 |
| 旧载体冻结 | ✅ | 未向 `.quality-gates.md` 插块、未向 `scripts/gate-record-debt-ledger.json` 加键 |
| 品牌残留 / 文档同步 / 绝对路径 | ✅ | 三条实跑（读数见 PR 正文）。文档内一律写 `<仓库父目录>/mp-worktrees/mp-<task>` 占位形态，不落本机绝对路径 |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=false`（含 `packages/` 运行时代码）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #4094

### 为什么值得单独记一笔

这条红灯的代价被严重低估：**它是 main push 的常红项**，等于给所有会话的收尾判据加了永久噪音。
而它之所以活了两天没被修，恰好因为三件「读起来不像错误」的事叠在一起：

1. **单跑永远绿**（端口空闲、无 `FORCE_COLOR` 注入），本地复现不了；
2. 红文案只有 `Timed out waiting for port 4568` 一句 —— 超时既能是「服务慢」也能是「端口被占」，判据没有自证能力；
3. 失败落在 `packages/api-publish-engine`，而同期在飞的工作都在这之外 ⇒ 每个会话都合理地把结论写成「不是我的」。

第三次才是最贵的：**「不是我的」在证据层面是对的**（改动集里确实 0 个该包文件），但它不构成「不需要修」。
本案的正确落点是：把它当成独立任务开 PR，而不是留给下一个会话再判一次「不是我的」。

另记一条本次现场发现：**修好缺陷 A 之后，红点自动移到缺陷 B**（`--help` 的 `eq(err,'')`）。
第一反应很容易是「修了也没用 / 回滚」，实际是同一个 target 的第二个隐含前提刚被暴露。
判据：修 A 后若红点**换了用例名**，几乎一定是第二个独立缺陷，而不是 A 改坏了什么。
