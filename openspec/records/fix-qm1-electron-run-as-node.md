---
record: fix-qm1-electron-run-as-node
task: 修 QM-1 启动验证的假绿——子进程 env 显式剔除 ELECTRON_RUN_AS_NODE，并断言存活是三层判据的隐含前提
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：QM-1 启动验证的 `ELECTRON_RUN_AS_NODE` 假绿（fix-qm1-electron-run-as-node，2026-10-15）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 工具脚本 + CI 接线 + 流程文档（非运行时业务代码，但仍按混合 PR 走完整质量节拍）。隔离 worktree：`D:/Data/projects/mp-worktrees/mp-fix-qm1-electron-run-as-node`（D 盘），裸分支 `fix-qm1-electron-run-as-node`；依赖经 `verify-worktree-deps.js` 通过（11 项消费方解析）。**建 worktree 时被 `session-init.sh` 拒绝过一次**（共享根存在他人未提交/已暂存文件 ⇒ 该入口按设计 fail-closed），按纪律**未绕过、未手工 `git worktree add`**，等他人收口后共享根干净才重试成功 |
| 第一性原因（QM-5 ①） | ✅ | `scripts/qm1-scheduled-publish-verify.cjs:108` 原为 `spawn(EXE, [], { stdio: [...] })` —— **不传 `env` 即继承父环境**。父环境（本机 DSH 会话）带 `ELECTRON_RUN_AS_NODE=1` 时，Electron 可执行文件以**纯 Node 模式**启动并静默退出（实测 rc=0、stdout 空、stderr 空、不建窗口、不建 userData），与「启动干净」**完全同形**。三层 stderr 判据只规定「stderr 内容怎么判」，它**默认进程确实起来了**；前提没被断言 ⇒ 把「根本没启动」读成「启动干净」 |
| 逃逸分析（QM-5 ②） | ✅ | 三层判据（①红线 ②非空即 NEEDS_REVIEW ③空才 PASS）是 2026-10-14 为「黑名单之外一律放行」而修的，修得对；但它**只覆盖 stderr 这一维**，对「进程没起来」这类**前提失守**结构性失明。本轮是我**手工**跑验证时踩到的：我自写的判据只看 stderr，打印了「判定 = PASS（stderr 为空）」—— 即该形态能骗过任何「只读输出」的判据，包括人眼 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 新增 `scripts/lib/qm1-child-env.js`：`buildChildEnv()`（纯函数、不改入参、剔除该变量）+ `envDefectNotice()`（父环境带着它时**出声**，不静默剔除）；② `qm1-scheduled-publish-verify.cjs` 改为 `spawn(EXE, [], { ..., env: buildChildEnv(process.env) })`，并在提前退出分支打印该变量的诊断提示；③ 新增 `scripts/qm1-child-env.test.js`（7 条：剔除/不改入参/不凭空造键/容忍 undefined/**出声告警**/**接线锁**）；④ `.github/workflows/quality-gate.yml` 的 Gate 2c 点名该测试；⑤ AGENTS.md QM-1 段新增一条（存活必须单独断言 + env 必须显式传 + 必须出声） |
| 防止再次发生（QM-5 ⑤） | ✅ | 关键是**机械锁**而非文档：接线锁直接读真机脚本源码，断言 `spawn(EXE...)` 必须显式传 `env: buildChildEnv(...)`、必须调用 `envDefectNotice`、提前退出分支必须点名该变量 —— 任何一处改回老写法当场红。`01-docs/learnings.md` 已在前一片记入同一陷阱（本条 PR 把「文档」升级为「门禁」） |
| 变异反证 | ✅ | 把 `spawn` 的 `env: buildChildEnv(process.env)` 删掉（回到继承父环境）⇒ **接线锁第 7 条指名红**（`not ok 7`，pass 6 / fail 1）；还原后 7/7 全绿 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 接线棘轮 | ✅ | 实跑 `node --test scripts/check-unwired-tests.test.js` = **30 passed / 0 failed**；新锁已在 `quality-gate.yml` Gate 2c 点名 |
| workflow 契约 | ✅ | 本 PR 改了 workflow，故实跑 `node --test .github/scripts/workflow-contract.test.js` = **37 passed / 0 failed**；`check-workflow-structure.test.js` = **6 passed / 0 failed** |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/`，无渲染层改动 |
| QM-6 CCG 双模型外部评审 | 未执行 | `scripts/ccg-gate.js` 随 pre-commit 跑（结果见提交输出）；深度审查未执行，如实登记，不以自审冒充通过 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin fix-qm1-electron-run-as-node` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 为什么不是「只写文档」

本仓 R0 的原话：写进记忆、文档与提交信息**都没能阻止第 5 次**误删，因为依赖临场自觉，所以必须是机械拦截。
本条的失败形态更隐蔽 —— 「rc=0 + 零输出」与「启动干净」**在输出上不可区分**，任何只读输出的判据（脚本的、人的）都会读错。
因此修法落在两处机械点：**spawn 必须显式传 env**（构造上剔除变量）+ **必须断言存活**（判据上覆盖前提），并各配一条会在改回老写法时变红的锁。

### 遗留（不假装已闭合）

- **本机 `ELECTRON_RUN_AS_NODE` 仍存在**：本 PR 只让**验证工具**免疫，没有（也不应该）去改宿主/工具链的环境变量 —— 那是别的东西在用的设置。手工启动验证的人仍会踩到，故 AGENTS.md 用 ⛔ 条目如实写明该变量与其形态。
- 未对 `scripts/qm1-scheduled-publish-verify.cjs` 的**其它**验证步骤做同类前提审计（本轮只覆盖验证 3 的启动存活）；「验证 1/2 是否也有隐含前提未被断言」未做系统排查。
- 同族风险未穷举：任何「只看输出/退出码」的就绪判据都可能被「静默早退」骗过（如缺显示、单实例锁、profile 损坏）。本 PR 只堵了已知的这一条。
