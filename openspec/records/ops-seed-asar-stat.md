---
record: ops-seed-asar-stat
task: 消除打包版启动时 stderr 的 Node DEP0180（根因＝对 asar 内种子用 fs.statSync），并删掉一条永远命中不了的第二候选路径
date: 2026-10-14
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

## 变异反证：处置后重跑六道

| 变异 | 内容 | 结果 |
| --- | --- | --- |
| M1 | 把 `fs.statSync(candidate)` 加回**代码**（不是注释——注释里本来就有这个名字） | 指名红：结构锁 |
| M2 | 超限判定挪到读盘之后（先读**候选本身**） | 指名红：按路径过滤的 spy 断言 |
| M2b | 改成读**另一个**路径（`candidate + '.copy'`） | **非指名红**——4 条 L3 行为用例收到。按路径过滤那条抓不到"读了别的文件"，是行为锁抓的；分工如实记 |
| M3 | 恢复第二候选 | 指名红：resolveSeedPaths 那条防"顺手加回来"的用例 |
| M4 | 摘掉 `finally` 里的 `closeSync` | 指名红：结构锁（close 必须在 finally） |
| M5 | 把**锁自己的**切片正则改窄，使函数体提前截断 | 指名红：新加的完整性断言（对锁本身做反证，不是只验业务改动） |

红集互不相同；基线 47/0，全部还原后 0 红，实现与测试两份文件 md5 均与开工前一致。

**过程中结构锁自己踩了一次本仓已知的坑**：判据按源码原文匹配，而函数注释里就写着"不用 `fs.statSync`"来说明理由 ⇒ 注释被当成代码命中，改完实现那条锁照红。正解是**判据先剥行注释再匹配**（不是把注释删掉——注释是唯一能留住"为什么不能用 statSync"这个信息的地方）。这正是 [[podcast-rss-implementation-gotchas]] 记过的「结构锁不剥注释 = 幽灵通道」的同形复发，本次是**反向**触发（注释里有被禁词 ⇒ 假红，而非注释里有被允许词 ⇒ 假绿）。

## QM-1：修复后复测——这次是真的落到第③层

- `verify-worktree-deps.js` OK；`pnpm run build:vue` 58.7s；`pnpm exec electron-builder --win --dir --publish never` **rc=0**；asar `151,613,521` 字节 / 14,991 条目。
- 产物归属：`ops-runtime-snapshot.js`=1、**其测试文件=0**（测试不进包）、种子 `runtime-bootstrap`=1。`ops-center-sync.js` 计数 2 不是重影，是两个不同文件（`\electron\ipc-handlers\ops-center-sync.js` 与 `\electron\services\ops-center-sync.js`）。
- **差点误判的一处**：第一次数 asar 用 `ops-seed/runtime-bootstrap.json` 作模式 ⇒ 得到 **0**，读起来像"这个包里没有种子"。真因是 Windows 下 `asar list` 用**反斜杠**输出路径，带斜杠的模式对不上 ⇒ **探针失明而不是产物缺失**。当场三方交叉重取：`git ls-files` 证明受管、`ls` 证明盘上有 1905 字节、无斜杠模式 `runtime-bootstrap`=1。教训同「0 命中先证明我的坐标是旧的」。
- 冷启动复测（`>out 2>err` 双流分开、进程退出后再读）：`proc_count_before=0`（上一轮遗留实例已自行退出，全程只按自己启动的 PID 收口，未按名字批量 kill）；10 秒存活=yes；stdout 24,737 字节 / 263 行（**应用日志走 stdout**，与 stderr 无关）；**stderr 0 字节 / 0 行**；四类红线命中 0、`app.asar` 内部路径命中 0、**DEP0180 命中 0**。
- ⇒ QM-1 三层判据落到**第③层（stderr 为空）= 通过**。与 #3595 那次 163 字节的对比就是本片的收口证明：修复前 stderr 恒有一行 Node 告警，修复后为空。且这里的"空"是读到的空——同一片里已把"读被子进程占用的重定向文件失败被 `Continue` 吞成空串 ⇒ 假第③层"那条测量陷阱记进记忆并改掉了取法。

### 复测协议还要再修一次：stderr 必须在「进程存活期间」取

重构后再复测，同一条命令两次读数不一致：一次 stderr 0 字节，一次 270 字节、两行 `Network service crashed or was terminated` + `GPU process exited unexpectedly: exit_code=143`。**`exit_code=143` 就是 128+SIGTERM**——这两行是**测量动作自己**（我 kill 它）产生的收尾，不是应用启动输出。取法因此改成两段快照：

- **LIVE（进程仍存活 12 秒时读）**：`proc_count_before=0`、alive=yes、**stderr 0 字节 / 0 行**、DEP0180 命中 0、四类红线命中 0、stdout 22,590 字节（业务日志走 stdout，与 stderr 分道）。⇒ **判据只认这一份**。
- **POST（收进程之后再读）**：270 字节、teardown_delta=270 ⇒ 全额归因于 SIGTERM，**不计入判据**，但必须打出来，否则下一个会话会把它读成"应用有错"。

顺带解释了此前"0 字节 / 163 字节"的飘忽：**真正的启动输出只有在存活期被读到才算数**，事后读既可能漏掉（写慢了）也可能多算（把收尾话算进来）。#3595 收尾时按这个两段式协议重取。

### Gate 11（ESLint）在 CI 红过一次：本机 pre-commit 不覆盖它

前两笔提交都过了本机 pre-commit（日志 `CCG 门禁已执行：5 项通过`），推上去 **`QG Static` 的 `Gate 11 - ESLint` 当场红 3 条**。归因路径没靠猜：CI 在跑时 job 日志 API 只回 99 字节、`gh run view --log-failed` 直接拒绝（run 未结束），于是用 `gh api .../actions/runs/<run>/jobs` 取 **失败步骤名**，一次定位到 Gate 11，再本机跑同一条命令（`cd apps/desktop && pnpm exec eslint electron/ src/ --quiet`）复现。三条 error 与处置：

- `no-useless-assignment` ×2：`let fd = null` / `let size = 0`。`size` 那条是**真死初值**；`fd` 那条规则看不穿 `finally` 会读初值。**没有用 `eslint-disable`**——把"探测 + 消费"整段收进同一个 `try`（解析失败改用**嵌套** try 保住 `seed-parse-failed` 分支），两个哨兵初值就都不必存在，`fd` 改 `let fd` + `typeof fd === 'number'` 守卫。不服一条规则时先找"让这条规则根本不该适用"的写法，disable 只是把死代码换个形式留下。
- `no-regex-spaces` ×1：结构锁的切片正则里写了两个字面空格，改成 `{2}`。

改完复跑：ESLint 全量（`electron/ src/`）**rc=0**；4 文件消费者并集 **177 passed / 0 failed**；六道变异在新结构上重跑仍是 **5 道指名红 + M2b 非指名红**，还原后 md5 一致；`build:vue` + `electron-builder --win --dir` rc=0、asar 151,629,108 字节 / 14,992 条、`ops-runtime-snapshot`=1、种子 `runtime-bootstrap`=1；`build:vue` 重生的三个 bundle 产物内容 diff=0，按精确单文件还原、不进本 PR。

## QM-6 外部评审（后端单轴成立，前端三次全败——按 critic-only 记账）

**后端 `claude`：实跑成功，5 条可解析 findings（全 Info，无 Critical/Warning）**，逐条处置：

| # | 主张 | 处置 |
| --- | --- | --- |
| 1 | `openSync` 与原 `statSync` 只在"stat 读得开但 open 打不开"（Windows 共享占用/杀软瞬时持锁）这一边上不同：旧码报 `exists:true`、新码报 `exists:false`；降级行为完全一致，差的只是日志诊断标注 | **采纳**——在 `_probeSeed` 注释里写明该边沿并叮嘱"不要把它读成种子没打进包"。**拒绝**同一建议里的"补一次 stat 校准"：那会重新踩回 DEP0180 路径，与本修复目标直接冲突（L2 约束） |
| 2 | fd 在所有出口（try 内 `continue` / catch 内 `continue` / 两条 `return`）都经 `finally` 归还；`finally` 只含 close，不会吞 `continue` | 确认无缺陷，无动作 |
| 3 | spy 捕的是全局 `fs.readFileSync`，"总调用数为 0"会把运行器同进程内的无关读取算进去 ⇒ 偶发 flake；应按被读路径过滤 | **采纳**——改为 `calls.filter(c => String(c[0]) === seedPath)` 判 0，注释写明为何不用总数。为防这条新判据变成"永远过滤掉一切"的空断言，加了变异 M2（读候选本身，红）与 M2b（读别的路径，由行为锁收）双向验 |
| 4 | 结构锁切函数体用"首个两空格缩进的 `}`"，将来若提前截断，锁会只检查半截函数体而**静默通过**；建议改花括号配对扫描 | **部分采纳**——配对扫描要正确处理字符串字面量里的括号（本仓做过，两处截断都是这么来的），成本和收益不对等，且新写的扫描器本身会成为下一个失明点（L3 权衡）。改为加一条**完整性断言** `body` 必须含 `this._seedPaths[0]`，并据此设计变异 **M5**：把锁自己的切片正则改窄 ⇒ 当场指名红。这是对锁本身做反证，不是只验业务改动 |
| 5 | 删第二候选不会让任何打包形态读不到种子：`build.files` 含 `resources/**/*`、无 `asarUnpack`、`--dir`/portable 都内嵌 asar、历史构建从未拷到 `resourcesPath`、种子受 git 跟踪 | 独立确认本片中心论断成立（它是从反方向核"包外那份是否真的从未存在"），无动作 |

**前端 `opencode`：三次全败**，已用满 AGENTS.md 允许的 2 次重试。① `exited with status 1`，线索是日志里那句 `Using stdin mode for task due to: length>800`——提示词超 800 字符被切 stdin 后随即退出，属既有五种"跑完但没有 findings"之外的**新形态**；②③ 压缩提示词并显式禁止输出进度报告后，两次都只交一份"已读/待读文件清单"的 Work State/Next Move 就停在 SESSION_ID，零 findings。
**因此本片只能记成 critic-only（后端单模型）+ 主代理逐条处置，不得写成"双模型通过"。** 前端失败期间唯一有价值的旁证是它自己提出"确认 `ops-center-sync.js:127` 是否留下无用实参"——已由后端 #5 与本机 `git grep`（该 helper 命中 0）双向核过。

处置后重跑：47 passed / 0 failed；六道变异（M1–M5 + M2b）见上一节，其中 M5 是对锁本身做的反证。

## 与相关链的接续（不虚报，也不代他人改）

- **#3595 需要在本片合并后 rebase 并重取 QM-1**：它那次的 stderr 是 163 字节（DEP0180），本片进主干后它的复测应变为 0 字节 ⇒ 第③层成立，才可按"CI 绿即自动合并"收尾。这条不属于本片，属 #3595 的收尾动作。
- 主干归档 change `openspec/changes/ops-center-resilience/tasks.md` 的 3.1/3.2 至今挂着未勾，而 3.1 的产物实际已在库内（`apps/desktop/resources/ops-seed/runtime-bootstrap.json` 受管）、3.2 的 `scripts/export-ops-seed.js` 实测**不存在**。这属他人会话的账，本片**不代改**，只在此点名，由该 change 的负责人核。

## 远程同步

| 远程同步 | PASS | merge SHA ac9c60e21 · 2026-10-14T18:42:32Z · 远端分支已删（ls-remote 0 行）· 同次提交删除 ledger 登记项 |
