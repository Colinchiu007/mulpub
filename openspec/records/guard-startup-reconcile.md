---
record: guard-startup-reconcile
task: 共享根写保护缺启动对账——watcher 没看见的漂移永远不回头（静默盲区）
date: 2026-10-13
---

## 本次执行记录：共享根写保护缺启动对账（guard-startup-reconcile，2026-10-13）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 改 `scripts/` 工具脚本 ⇒ 按 AGENTS.md「纯流程变更不需要独立 worktree」在共享主工作区就地编辑、经 PR 落地。**注意**：共享根当前被其他会话的陈旧改动占据（59 个运行时路径），`start-mp-task.ps1` 的 `-RequireClean` 因此拒建 worktree；本笔只用就地路径，未绕过任何闸门。改动仅 2 个已 tracked 的 .ps1（改前它们**不在**陈旧集合内） |
| 第一性原因（QM-5 ①） | PASS | `scripts/guard-shared-root-writes.ps1` 是**纯事件驱动**的：`FileSystemWatcher` 注册 Created/Changed/Renamed/Deleted（L247-256）+ `while ($true)` 事件循环，**没有任何启动时的全量对账**。于是本进程未运行期间（AtLogOn 拉起前、崩溃、重启）或事件因缓冲区溢出被丢弃期间产生的漂移**永远不会被回看**——「guard 报 Running、violations.jsonl 为空」与「共享根已漂移数天」可以同时为真。这不是「少写了一个开关」，是**守护者自身的语义缺口：它只对『发生在我看着的时候』负责** |
| 逃逸分析（QM-5 ②） | PASS | ①**判据层**——`mp-worktree-health.ps1` 有 `clean:false` 这个信号，但它把「docs 在途」与「运行时路径漂移」混成一个布尔，而后者才是违规；信号在，可读性不在，没人会为一个常态为 false 的字段停工；②**自愈层**——guard 只在事件到达时恢复，事件没到就没有第二次机会，**没有兜底回路**；③**取证层**——345 条 violation 记录里 `detail` 全空、**不记录写入者身份**（无 PID/进程名/命令行），出事后无法归因；④**观测层**——`violations.jsonl` 落在 `%LOCALAPPDATA%`，会话默认不可见（脚本自己在 L121-122 注释里承认了这点，所以才额外写 `.agent_context/write-guard-alert.json`）；⑤**审查层**——既有测试（`scripts/session-write-guard.test.ps1`）**全部**是逐路径 `-ProcessPaths` 调用，等价于「watcher 看见了那次写」，**没有任何一条覆盖『watcher 没看见』**。系统性漏洞＝**判据只覆盖『有人看着时』这一半，另一半无人看守且失败无信号** |
| 修复 + 回归保护（QM-5 ④） | PASS | ①新增 `-Reconcile` 单次全量对账 + `-Watch` 启动时先跑一次（放在 `$watcher.EnableRaisingEvents` **之后**，使对账自身的恢复动作也走事件流并被 `ignoreUntil` 吸收，不与会话中的 watcher 打架），失败出声但不阻断监听（守卫瞎着比半瞎更糟）；②对账**复用 `Invoke-GuardPath`**，不写第二份「恢复/隔离」判据；③用**一次** `git status --porcelain --untracked-files=no` 取漂移集，而不是逐文件 `ls-files`（受保护前缀下近 8.6k 个 tracked 文件，逐文件探测＝启动时上千次 git 调用，会把 watcher 挡在门外数分钟）；④**范围刻意收窄到 tracked 漂移**（改 + 删）：未跟踪文件仍由实时 watcher 负责，启动时批量清扫它们的爆炸半径大得多而 tracked 不变量并无增益；⑤顺带修掉 `Invoke-GuardPaths` 把日志与返回值混进同一管线的隐患（`$failures = Invoke-GuardPaths ...` 会拿到字符串数组，`-gt 0` 退化成逐元素比较 ⇒ rc 判据失真）；⑥回归锁扩在**已接线**的 `scripts/session-write-guard.test.ps1`（`quality-gate.yml:480`）内，无需改 workflow |
| 防止再次发生（QM-5 ⑤） | PASS | ①**兜底回路已落地**：`-Watch` 每次启动都先做一次全量对账，把「进程没运行的那段时间」纳入覆盖——这正是本次缺口的形状（不是某个 if 写错，而是**没有第二次机会**）；②**锁的缺口也一并补上**：行为用例只证明「对账本身对」，证明不了「常驻模式真的会调用它」，故另加 2 条结构锁钉住「Watch 必须在事件循环之前调用对账」，并对该锁做过变异反证（删掉启动调用 ⇒ FAIL）；③**同类形状的教训写进 PR 与记录**：本笔自己就重犯了一次「把日志与返回值混进同一管线」——在 `Invoke-GuardPaths` 修掉、又在 `Invoke-ReconcilePass` 的函数边界上重犯，被「输出为空」暴露⇒ 该形态已写入 `.quality-gates.md` 与本记录，作为「修一处要扫同类」的实例；④**编码门禁证明了自己**：改含中文的 .ps1 时 BOM 被剥，`check-ps1-bom.js` 当场判红并给出修法，说明「机械拦截优于临场自觉」在本仓是活的；⑤**建议（未做，不假装已闭合）**：`Write-Violation` 目前不记写入者身份（`detail` 全空、无 PID/进程名/命令行），出事后无法归因——建议后续补上，Windows 下取写入进程需 ETW 或句柄审计，成本待评估；退一步先记「当前 shell 归属 + 时间线」也胜过全空 |
| 反证（变异必须变红） | PASS | ①**行为层**：新增 6 条/档断言，夹具**不逐路径调用守卫**（模拟 watcher 全程没看见），一次 `-Reconcile` 收掉「改」与「删」两处漂移；两档 EOL 各跑，规模锁 36→50；②**结构层**：行为用例只证明「对账本身对」，证明不了「常驻模式真的会调用它」——删掉启动那次调用，那 12 条**一条都不会红**，故另加 2 条结构锁钉住「Watch 模式必须在事件循环之前调用对账」；③**变异实跑**：把启动调用那行改成注释 ⇒ `FAIL: watch mode invokes the startup reconcile pass`（rc=1）；还原 ⇒ rc=0、51 checks。**首次变异是空操作**（锚点落在我的注释块开头，只删掉 161 字符注释而调用仍在），rc=0 是**正确**结果而非锁失效——已如实记录，不把「变异没生效」读成「锁有效」 |
| 编码与行尾 | PASS | 改这两个**含中文的 .ps1** 时 BOM 被 `ReadAllText`/`WriteAllText(UTF8Encoding(false))` 剥掉，`.github/scripts/check-ps1-bom.js` **当场判红**（`missing-bom nonASCII=2505 / 3535`，rc=1）——门禁有效；按它给的一键写法前置 `EF BB BF` 后 rc=0（54 个 tracked .ps1 全部守约）。两文件 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（103/8、45/3） |
| QM-1 / QM-4 | N/A | 未触 `apps/desktop/electron/` 与渲染层 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | merge `74843fc40`（2026-10-14 01:41:17 +08:00），PR #3491 已 MERGED、远端分支 guard-startup-reconcile 已删（`git ls-remote` 0 行）；回填与销账同次提交 |

- 保留门禁：TDD ✅ | 编码/行尾对账 ✅ | 品牌残留 ✅ | 债务账本 ✅ | 远程同步 PASS

### 现场取证（本笔的动因，如实记录）

本仓 `origin/main` 的共享根实测：`git status --porcelain` 有 **59 个运行时路径改动**（+318/−5170），横跨 **10-05 → 10-13 八天**。逐条核对：

- 28 个工作副本的内容 blob **在历史中存在**（＝某个更早提交的版本）
- 31 个是「HEAD 有、磁盘没有」的**缺失**文件
- **0 个**含历史中不存在的独有内容 ⇒ 还原不会丢失任何未提交的工作

而 guard **只记录过其中 3 个**，另 **56 个在 345 条 violation 里一条都没有**——正是「启动对账缺失」的直接后果。

**归因结论（诚实边界）**：**无法归因到具体会话**。guard 的 violation 记录 `detail` 全空、不记 PID／进程名／命令行；`.agent_context/session.json` 虽记了 17:27:37 声明共享根的 PID 15020，但该 PID 已被回收成另一个进程（node，22:16 启动），**PID 复用使这条线索不可信**。只能确定：17:59:05.481 / 17:59:10.665 有写入被抓住并隔离（隔离副本 17450B / 63016B），而磁盘上留下的是更小的**旧版本**（9924B / 56925B）。

⇒ 「写入者身份不可考」本身就是本笔要修的那一族缺陷的一部分（**守卫的取证层缺失**）。记录在案，不假装已解决。

### 遗留（不假装已闭合）

- **写入者身份仍未记录**：本笔只补了「回头看」，没补「记下是谁」。建议后续在 `Write-Violation` 里带 PID／进程名／命令行（Windows 下取写入进程需要 ETW 或句柄审计，成本待评估——先用 `detail` 记当前 shell 归属与时间线亦胜过全空）。
- **共享根的 59 个陈旧改动仍在**：本笔**未清理**（除为落地本 PR 而必须改写的 2 个载体文件，写法是「HEAD 内容 + 本笔追加」，净效果是补齐而非回退）。清理需要用户决策，见 PR 正文。
- **`clean` 布尔混装**：`mp-worktree-health.ps1` 未区分「docs 在途」与「运行时路径漂移」，建议拆成两个字段，让违规不再淹没在常态里。
- **未跟踪文件的启动清扫**：刻意不做，理由见上；若将来要做，需先解决「新会话刚建的文件被误扫」的爆炸半径问题。
