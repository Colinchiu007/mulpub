---
record: ops-seed-asar-stat
task: 消除打包版启动时 stderr 的 Node DEP0180（根因＝对 asar 内种子用 fs.statSync），并删掉一条永远命中不了的第二候选路径
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 合并后由后续 docs PR 按既有 PASS 口径回填 merge SHA 与时间，并在同一次提交删除 frontmatter 三字段与本记录对应的 ledger 登记项
sync_backfill_owner: 本会话（本片作者）
---

# L3 种子探测改按 fd，消除打包态 DEP0180（ops-seed-asar-stat，2026-10-14）

> 分支 `ops-seed-asar-stat`（worktree `D:/Data/projects/mp-worktrees/mp-ops-seed-asar-stat`，非 C 盘），起点 `1185e00a9` = 当时 origin/main。
> 起因：#3595 的 QM-1 撞到三层判据的第②层（stderr 非空但未命中红线 ⇒ 不得自判通过）。交给人裁决后，裁决是**先去查源头**，于是有了本片。

## 根因（带堆栈，不是推测）

打包版 `Multi-Publish.exe` 启动时 stderr 稳定输出 `(node:…) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated.`。加 `--trace-deprecation` 后拿到真堆栈：

```
at asarStatsToFsStats (node:electron/js2c/node_init)
at Object.lstatSync / Object.statSync (node:electron/js2c/node_init)
at OpsRuntimeSnapshot._probeSeed (electron/services/ops-runtime-snapshot.js:354)
at OpsRuntimeSnapshot.readSeed (…:374)
at OpsCenterSync.restoreRuntimeFromDisk (electron/services/ops-center-sync.js:181)
at OpsCenterSync.autoSyncOnStart (…:752)
at extractContext (electron/bootstrap/phase1-context.js:242)
```

链路是：L3 种子文件按 PRD §7「随 asar 发布」装在 `app.asar` 内（`asar list` 实测 `/resources/ops-seed/runtime-bootstrap.json` 存在）；探测它用的是 `fs.statSync`；Electron 为了让 asar 内路径能被 stat，走 `asarStatsToFsStats` 造一个 `fs.Stats`，而那个构造函数就是 Node 现在报废弃的东西。**发起方是我们的一行代码，造对象的是 Electron 的兼容层。** 未打包态（dev，走 node_modules 而非 asar）stderr 为 0 字节、DEP0180 命中 0 ⇒ 告警只在走 asar 时出现。

## 实测对照：哪一类 fs 操作会触发

每种操作**单独开一个进程**跑（Node 每类弃用告警每进程只发一次，混在一个进程里就分不出是谁）。夹具是临时 electron app，用与主进程同版本的 `node_modules/electron/dist/electron.exe`：

| 对 asar 内那份种子做什么 | DEP0180 |
| --- | --- |
| `fs.statSync` | **1** |
| `fs.lstatSync` | **1** |
| `fs.promises.stat` | **1** |
| `fs.existsSync` | 0 |
| `fs.readFileSync` | 0 |
| `fs.openSync` + `fs.fstatSync` | 0 |
| 普通磁盘路径上做 stat / exists / read（对照组） | 0 / 0 / 0 |

对照组全 0 是这张表的可信度前提：**它证明探针不是恒 0**。只报"asar 那一列有 1"而不报对照组，等于没排除"任何操作都会触发"这种可能。

## 语义等价性（改之前必须先量，不然就是把 Bug 换个形状）

`openSync + fstatSync` 与原 `statSync` 在三种输入上的差异逐条实测：

| 输入 | `statSync` | `openSync` | `_probeSeed` 里的净效果 |
| --- | --- | --- | --- |
| 正常文件 | `isFile=true size=1905` | 同值 | 一致 |
| 目录占住该路径 | `isFile=false`（不抛） | **抛 ENOENT** | 两条路都 `continue` ⇒ 一致 |
| 文件缺失 | 抛 ENOENT | 抛 ENOENT | 一致 |

所以在本调用点二者等价；但**不能**顺手改成"先 `readFileSync` 再比长度"——`MAX_SNAPSHOT_BYTES` 的语义是"超限就拒绝加载"，先读再判等于把防线换成"读进内存再后悔"。

## 改了什么

1. **`_probeSeed` 改为按 fd 探测**：`openSync` → `fstatSync` → 取 `isFile/size`，`closeSync` 放 `finally`（`continue` / `return` / 抛错三种出口都必须归还句柄）。
2. **删掉第二条候选路径**：`resolveSeedPaths` 原返回两个候选，第二个是 `<process.resourcesPath>/ops-seed/…`，注释写"extraResources 从 resources/ 拷出时"——但 `package.json` 的 `build.extraResources` **从未登记 `ops-seed`**，安装后那条路径永远不存在。它是"看上去提供回退、实际一次都命中不了"的装饰候选，还会让读者以为包外有副本。连同 `OpsRuntimeSnapshot` 构造器的 `resourcesPath` 形参与 `OpsCenterSync._resolveResourcesPath()` 一起删除（删完 `git grep` 该 helper 命中 0）。
3. **PRD §7.1 新增「运行态怎么找到这份种子」**：单候选的事实与出处、为什么删第二候选、**真要搬出包外必须同一 PR 里补 extraResources 登记 + 恢复候选 + 放开结构锁三者缺一不可**、探测一律按 fd、必须先看大小再决定读不读、`exists` 与 `usable` 继续分开报。

## 测试（TDD 两段，先红后绿）

- 先只改测试：`47 例 / 3 红`，红的正是三条新语义——结构锁（`_probeSeed` 禁 statSync）、`resolveSeedPaths` 再传 `resourcesPath` 也不得生出第二候选、构造器只认 asar 内候选（往包外写读不到、往候选那一位写才读到）。
- 再改实现：消费者并集**全部 4 个测试文件 177 passed / 0 failed**（`ops-runtime-snapshot` / `ops-center-sync` / `ops-center-sync.resilience` / `observability-messagekey`；并集按 `git grep -l OpsRuntimeSnapshot` 取，不按"我改过的文件"取）。

## 变异反证：四条全部指名红

| 变异 | 内容 | 结果 |
| --- | --- | --- |
| M1 | 把 `fs.statSync(candidate)` 加回**代码**（不是注释——注释里本来就有这个名字） | 指名红：结构锁 |
| M2 | 超限判定挪到读盘之后 | 指名红：超限种子不得调用 readFileSync |
| M3 | 恢复第二候选 | 指名红：resolveSeedPaths 那条防"顺手加回来"的用例 |
| M4 | 摘掉 `finally` 里的 `closeSync` | 指名红：结构锁（close 必须在 finally） |

四条红集互不相同；基线 47/0，全部还原后 0 红且实现文件 md5 与开工前一致。

**过程中结构锁自己踩了一次本仓已知的坑**：判据按源码原文匹配，而函数注释里就写着"不用 `fs.statSync`"来说明理由 ⇒ 注释被当成代码命中，改完实现那条锁照红。正解是**判据先剥行注释再匹配**（不是把注释删掉——注释是唯一能留住"为什么不能用 statSync"这个信息的地方）。这正是 [[podcast-rss-implementation-gotchas]] 记过的「结构锁不剥注释 = 幽灵通道」的同形复发，本次是**反向**触发（注释里有被禁词 ⇒ 假红，而非注释里有被允许词 ⇒ 假绿）。

## QM-1：修复后复测——这次是真的落到第③层

- `verify-worktree-deps.js` OK；`pnpm run build:vue` 58.7s；`pnpm exec electron-builder --win --dir --publish never` **rc=0**；asar `151,613,521` 字节 / 14,991 条目。
- 产物归属：`ops-runtime-snapshot.js`=1、**其测试文件=0**（测试不进包）、种子 `runtime-bootstrap`=1。`ops-center-sync.js` 计数 2 不是重影，是两个不同文件（`\electron\ipc-handlers\ops-center-sync.js` 与 `\electron\services\ops-center-sync.js`）。
- **差点误判的一处**：第一次数 asar 用 `ops-seed/runtime-bootstrap.json` 作模式 ⇒ 得到 **0**，读起来像"这个包里没有种子"。真因是 Windows 下 `asar list` 用**反斜杠**输出路径，带斜杠的模式对不上 ⇒ **探针失明而不是产物缺失**。当场三方交叉重取：`git ls-files` 证明受管、`ls` 证明盘上有 1905 字节、无斜杠模式 `runtime-bootstrap`=1。教训同「0 命中先证明我的坐标是旧的」。
- 冷启动复测（`>out 2>err` 双流分开、进程退出后再读）：`proc_count_before=0`（上一轮遗留实例已自行退出，全程只按自己启动的 PID 收口，未按名字批量 kill）；10 秒存活=yes；stdout 24,737 字节 / 263 行（**应用日志走 stdout**，与 stderr 无关）；**stderr 0 字节 / 0 行**；四类红线命中 0、`app.asar` 内部路径命中 0、**DEP0180 命中 0**。
- ⇒ QM-1 三层判据落到**第③层（stderr 为空）= 通过**。与 #3595 那次 163 字节的对比就是本片的收口证明：修复前 stderr 恒有一行 Node 告警，修复后为空。且这里的"空"是读到的空——同一片里已把"读被子进程占用的重定向文件失败被 `Continue` 吞成空串 ⇒ 假第③层"那条测量陷阱记进记忆并改掉了取法。

## QM-6 双模型外部评审（截至本提交的状态如实记）

- 后端 `claude`：已派发，**结论尚未返回**（本机该轴时长分布 5~70 分钟，**不得用等待时长判成败**，判据只认能否从 stdout 切出可解析的 findings）。
- 前端 `opencode`：**第一次派发失败**——`opencode exited with status 1`，日志里那条 `Using stdin mode for task due to: length>800` 是可归因线索：提示词超过 800 字符时 wrapper 改走 stdin，本次随即退出。这是既有五种"跑完但没有 findings"之外的**新形态**。已按纪律把提示词压到阈值以下**重试第 1 次**（AGENTS.md 允许前端最多重试 2 次，3 次全败才允许跳过并降级记账）。
- 因此本 PR **在两轴 findings 到齐并逐条处置前不合并**（不自扮演豁免，也不把"CI 绿"当"评审过"）。

## 与相关链的接续（不虚报，也不代他人改）

- **#3595 需要在本片合并后 rebase 并重取 QM-1**：它那次的 stderr 是 163 字节（DEP0180），本片进主干后它的复测应变为 0 字节 ⇒ 第③层成立，才可按"CI 绿即自动合并"收尾。这条不属于本片，属 #3595 的收尾动作。
- 主干归档 change `openspec/changes/ops-center-resilience/tasks.md` 的 3.1/3.2 至今挂着未勾，而 3.1 的产物实际已在库内（`apps/desktop/resources/ops-seed/runtime-bootstrap.json` 受管）、3.2 的 `scripts/export-ops-seed.js` 实测**不存在**。这属他人会话的账，本片**不代改**，只在此点名，由该 change 的负责人核。

## 远程同步

| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在 |
