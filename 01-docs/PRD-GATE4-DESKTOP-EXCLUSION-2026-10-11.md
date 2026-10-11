# PRD：Gate 4 的 desktop 排除断链（gate4-desktop-exclusion，2026-10-11）

关联：`.github/workflows/quality-gate.yml` Gate 4 / `desktop-shards`、`package.json` scripts、
`scripts/check-gate4-selection.js`（新增判据本体）、`scripts/get-test-process-tree.ps1`（新增投影函数）。
引入提交：`bb6aab5b8`（2026-08-09，"桌面测试套件跨 runner 分片"）。存续 **63 天**。

## 1. 症状（用户可见的那一面）

`QG Unit Tests` 是 main 的 required context。它在 main push 上**间歇性**红：

| run | sha | Gate 4 步骤耗时 | 结论 |
| --- | --- | --- | --- |
| 38111621873 | `c576b2dea` | 1322s | success |
| 38111779207 | `87e311c45` | 1173s | success |
| 38114881457 | `942506fe9` | **1801s** | failure |
| 38117318132 | `9b49b1e6b` | **1801s** | failure |
| 38117456528 | `73892e06e` | **1801s** | failure |

`1801s` 不是"测试跑了 30 分钟"，它是 `WaitForExit(1800000)` 到点：三条红的那一步末尾只有
`Gate 4 timed out; terminated the pnpm process tree.`。**一条 required check 的成败取决于 runner 快慢。**

## 2. 第一性原因

```powershell
$testArgs = @("run", "test:all", "--", "--exclude=@multi-publish/desktop")
```

那个独立的 `"--"` 不是 PowerShell 的引号习惯。pnpm 会把 `--` 之后的实参**原样**附加到脚本命令上：

```
$ nx run-many -t test --all --parallel=1 "--" "--exclude=@multi-publish/desktop"
```

而 nx 把独立 `--` **之后**的一切解释为「转发给每个任务命令的参数」。于是 nx 自己的选择集纹丝不动。
run 38117456528 的两行日志就是这件事的全部证据（`##[group]` 原文）：

```
 NX   Running target test for 13 projects:      ← 13 个，第 470 行就是 - @multi-publish/desktop
 ...
 $ vitest run "--exclude=@multi-publish/desktop" ← 旗标落到了叶子命令上
```

同一步的其余事实：12 个非桌面包在 **100 秒**内全部跑完并打印（`launchMark=06:18:23` 取于 `Start-Process` 之前，
nx 在 `06:18:26` 声明 13 个包，最后一个非桌面包的 `##[group]` 落在 `06:20:03`），**第 13 个任务（desktop）从头到尾
没有输出**（nx 的 static 输出风格要等任务结束才成块打印），`##[endgroup]` 落在 06:48:23 ——
即"静默 28 分钟"其实是 desktop 全量套件在跑。成功的那两次不是没跑 desktop，
而是**刚好跑完**。这 100 秒也是"本 PR 之后 Gate 4 应该长什么样"的直接读数：
排除生效后这一步只剩 12 个包，而它的预算是 30 分钟。

本机复现同一形态（`mp-visual-baseline-domain`，2026-10-11 14:47）：13 声明 / 12 打印 / desktop 零输出，
最后一次输出后静默 1112s，20 分钟硬上限到点仍未退出。

**同族反证（四种形态实跑，nx v20.8.4）**：

| 形态 | nx 声明 | desktop |
| --- | --- | --- |
| `run test:all -- --exclude=@multi-publish/desktop`（历史形态） | 13 | **IN** |
| `run test:all --exclude=@multi-publish/desktop`（不带 `--`） | 12 | OUT |
| `run test:affected -- --exclude=...`（干净工作区） | 无声明 | `NX   No tasks were run` rc=0 |
| 修复后的 `run test:all:no-desktop`（A/B 的 A 臂） | 12 | OUT |
| 去掉 exclude 的负控（B 臂） | 13 | **IN** |

第 2 行说明"旗标本来可以生效"，第 1 行说明那个 `--` 恰好把它推进了转发区。

## 3. 为什么必须在 Gate 4 排除 desktop

`desktop-shards` job 已经用 `--shard=1/2` + `2/2` 两个 runner 并行跑完整桌面套件（实测每片 1148–1876s）。
Gate 4 的定位是"非桌面包"——步骤里的注释原文就是「探测受影响项目（排除 desktop）」。
所以这不是"少跑一点省时间"，是**同一套测试被要求跑两遍、其中一遍压在 30 分钟预算上**。
排除后桌面覆盖不降级：仍由两个分片跑全量，Gate 4b 的 `test:startup` 也不动。

## 4. 逃逸链（QM-5 第 2 步）

| 层 | 为什么没拦住 |
| --- | --- |
| 单元/结构锁 | **`.github/scripts/workflow-contract.test.js:202-203` 逐字钉住了带 `"--"` 的错误 argv**：`assert.match(unitTestStep, /"run",\s*"test:all",\s*"--",\s*"--exclude=@multi-publish\/desktop"/)`。锁与缺陷由**同一次提交 `bb6aab5b8`** 引入，它匹配文本形状、从不问 nx 收到什么 ⇒ 把缺陷声明成了"受保护形态"。这是 AGENTS.md「装饰性门禁」的又一落点：锁可以既精确又无用。 |
| 相邻正确用法 | #1897（2026-09-17，`bdabd7745`）在**同一步骤内**写了正确的 `nx show projects --affected --base=origin/main --exclude=@multi-publish/desktop --json`（旗标直给 nx，实测有效），与错误的 `$testArgs` 相距 **14 行**（当时 198 ↔ 212；本 PR 落地后是 30 行，757 ↔ 787/789），中间隔着整个 affected 探测块；注释还点明了"排除 desktop"的意图，却没有任何东西把两份用法对照。QM-6 前端轴实读纠正了我原先"上方一行 / 相隔 8 行"的说法——那个数字我当时是**按 diff 观感写的，没量过**。 |
| 视觉/E2E | 与本变更无关（CI 配置面）。 |
| Code review | 红的是 main push，不在任何 PR 的 diff 里；PR 侧 `TEST_MODE=affected` 时多数 PR 的受影响集小、跑得快，看不出预算问题。 |
| 观测 | 超时时 `Get-TestProcessTree | Format-Table` 打印的是 Win32_Process 默认列（PID/Name/内存），**CommandLine 不在其中** ⇒ 13 个存活 `node.exe` 点不出归属；nx 的 static 输出风格又把未完成任务的输出整块缓冲 ⇒ 日志里连"> nx run desktop"这一行都没有。 |

## 5. 系统性漏洞（QM-5 第 3 步）与修法

1. **判据缺失**：没有任何东西测量"nx 实际收到了什么"。⇒ 新增 `scripts/check-gate4-selection.js`：
   结构层把 `$testArgs` 组装成最终命令行并要求 exclude 落在独立 `--` **之前**；
   live 层真跑 A/B，读 **nx 自己打印的选择声明**，A 臂必须无 desktop、B 臂（负控）**必须有** ——
   负控不成立时判"探针失明"而不是判绿。affected 侧不强制 live 是有理由的例外（选择集等于本 PR
   影响的包，干净工作区上是空集、无声明可判），该语义由测试 T18 钉住，防止有人把 `liveRequired`
   全改 false 让 A/B 臂整条静默消失。
2. **可写错的位置**：旗标本来由 workflow 转发，就有"转发错层"这个位置。⇒ 排除写进
   `package.json` 的 `test:all:no-desktop` / `test:affected:no-desktop`，Gate 4 调用它们且**不再传任何实参**。
   `test:all` / `test:affected` 保留（它们是诚实的"全部包"脚本）。
3. **锁反向固化**：`workflow-contract.test.js` 的两条断言改为钉新形态，并加
   `assert.doesNotMatch(/"run",\s*"test:(affected|all)",\s*"--"/)` —— 反向的那条才是防复发的。
4. **观测盲区**：`get-test-process-tree.ps1` 新增 `Format-TestProcessTreeLine` / `Write-TestProcessTreeDetail`，
   在超时/非零/残留三个分支逐行打命令行原文；空白或取不到一律打 `<unreadable>`（不得留空），
   空集合也必须打 `rows=0`（沉默不等于证据）。刻意**不改** `Get-TestProcessTree` 的输出形状：
   它的结果同时被 `.Count` 计数与 `taskkill /PID` 消费。

## 6. 验证

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 新判据单测（21 例） | `node --test scripts/check-gate4-selection.test.js` | `pass 21 / fail 0`；修复前 T16/T17 对**真实仓文件**判红（`actual:'task'`），修复后全绿 |
| 新判据 live A/B | `node scripts/check-gate4-selection.js` | rc=0，`A 臂 12 个不含 desktop` / `B 臂 13 个含 desktop`，8.8s |
| 进程树锁（18 例，含新增 10 例） | `pwsh` 与 `powershell` 各一遍 | 两档均 `OK: 18 checks passed` rc=0 |
| workflow 结构锁 | `node --test .github/scripts/workflow-contract.test.js` | `35 pass / 0 fail` |
| 接线与 fail-fast | `check-unwired-tests.js` / `check-step-failfast.js` | 均 OK |
| 孤儿进程 | 采集脚本自带的"只杀自己 spawn 的树"生效后按创建时间复查 | `recent-node-esbuild=0` |

变异反证见 `openspec/records/gate4-desktop-exclusion.md`。

## 7. 不在本次范围（登记，不静默修）

- `Gate 4b`、`desktop-shards` 的 30 分钟预算本身没改；分片时长 1148–1876s 仍有长尾风险，属另一账。
- `nx run-many --all` 里 `--all` 已被 nx 标 deprecated（不传 projects 即为全部），本次不动。
- `desktop-shards` 步骤同样用了 `"--"`，但那里的消费者是 **vitest**，转发是正确用法 —— 不"顺手收敛"。
- Gate 4 成功后残留进程仍会 `throw`（既有行为），本次只补点名能力。

## 8. QM-6 双模型外部评审（替代通道，标准通道本机不可用）

CC Switch `:15721` 探针 DOWN（当场 `Test-NetConnection` 实测）且 `ccg-deep-review.js` 缺失 ⇒ 两路都走
`opencode run --agent plan --auto --model opencode/<free>`。**本轮把评审产物留在仓库外**（`.tools/tmp`），
理由是前端轴自己指出：写进 `openspec/…` 的那批 untracked 文件会让后续 `git merge --ff-only` 变成
"untracked working tree files would be overwritten"，把一条文档 PR 卡住 —— 与本仓已登记的那条坑同源。
两路运行期间**没有**在该 worktree 做任何写型动作（变异电池早在评审启动前跑完并逐字节还原）。

- **后端/逻辑轴 `opencode/nemotron-3-ultra-free`**：0 Critical / 3 Warning / 4 Info，结论"Approve"。
  它答的是我给的六个问题（会不会漏拦 / 会不会误拦 / 负控能否被坏探针满足 / 杀树会不会留孤儿 /
  桌面覆盖是否降级 / 拼 shell 的注入面），每条带 文件:行号。逐条处置：
  - **B1**（声明头正则可能取到错误的行）：不采纳修改——它已被既有 T13 天然 fail-closed
    （`headerCount ≠ 清单条数` 即判红），取错数字本身就是结论不可信，不是放过。
  - **B2**（`MIN_OTHERS=11` 与测试夹具 `OTHERS` 必须同 PR 改，否则假红）：**采纳**，新增 T25
    把"下界 ≤ 夹具规模、夹具规模 = 12、夹具不得含 desktop、下界不得为 0"钉成一条锁。
  - **B3**（affected 侧不跑 live ⇒ 若 nx 在 affected 模式下语义漂移就漏判）：**前提部分不成立**——
    CLI 对 affected 臂也做了采集，只要 nx 打出选择声明就照常判；只有本机那种
    `NX   No tasks were run`（干净工作区、0 受影响任务）才降级为结构层，且这条降级会打证据行。
    评审担心的"结构层判了但 nx 实际忽略旗标"在有受影响包的 PR 上是会被 live 臂抓到的。
  - **C1**（A 臂走 `pnpm run <script>`、B 臂走 `pnpm exec nx …`，两条臂调用路径不同）：**采纳**，
    这是本轮唯一落到代码上的评审意见。负控改为**同一条入口的孪生脚本** `pnpm run test:all`
    （由 `:no-desktop` 后缀反推；找不到孪生才退回 `pnpm exec`，且退回形式由 T23 出声锁定）。
    前提实测过：在未改动的 worktree 里 `pnpm run test:all` 打印 `13 projects`、desktop **在内**。
    现在 A/B 唯一的差别就是"脚本自身带不带那个旗标"，由 T22 钉住。
  - **I1**（夹具随实现走）：与前端轴的观察一致，见下；`liveOk()` 的 map 键由 entries 派生，
    单独不构成锁，但 T20/T22/T23 显式钉住了 runLine/baseRunLine 的形态，组合后可证伪。
- **前端/工程轴 `opencode/ling-3.1-flash-free`**（第一次运行被 Plan 模式的写文件限制卡住、rc=0 零结论，
  按"最多重试 2 次"收窄任务书重跑一次，全程只读）：它**自己实跑**了 `check-gate4-selection.test.js`（21 例）、
  两档 shell 的 `get-test-process-tree.test.ps1`（各 18 条）、`workflow-contract.test.js`（35/35）、
  `check-unwired-tests.js`，以及 live A/B（`A=12 / B=13`），据此对账文档里每个点名物。
  结论：恒真断言审查 **NO FINDINGS**；两处命中——
  - **[Warning] PRD §4 的"上方一行 / 相隔 8 行"不实**：实测 origin/main 现为 757 ↔ 787/789（30 行），
    `bdabd7745` 当时是 198 ↔ 212（14 行），任何版本都不是 8 行。**已改**（PRD §4、CHANGELOG、record 三处），
    并把"这个数当时是按 diff 观感写的、没量过"如实写进 PRD——这正是本仓反复出事的形态。
  - **[Warning] "100 秒"这个数字不在任何入库文档里**：核对成立，但它的"正确值"是另一件事——
    评审把它和我自检脚本的 8.8s 混为一谈。100 秒指的是 **CI 日志里 12 个非桌面包的完成时长**
    （`06:18:23` 启动 → `06:20:03` 第 12 个包成块打印），我已把带时间戳的原始坐标补进 PRD §2，
    让它从"我随口说的数"变成可复核的读数。
  - **[Info，它主动给] workflow 里 4 份逐字相同的注释是纯文案漂移面**：**采纳**，注释收敛成一行指针
    （指向 `get-test-process-tree.ps1` 的 docblock），4 个调用点保留——它同时明确"调用序列不必收敛，
    YAML 无局部函数机制，强收敛要动 treeLib，属本 PR 范围外的重构"，与我自己的判断一致。
- **我自己查出一条两路评审都没提的假红风险**（同族：判据落在了会污染证据的位置）：Gate 4 这一步带
  `MP_TEST_EGRESS_LEDGER` 并在末尾按"基线之外的新键即红"判定，而自检的 A/B 两臂会真起测试进程再杀掉，
  继承该变量等于让自检往被判定的台账里写记录。已加 `childEnv()` 纯函数摘掉那两个键（其余原样保留，
  `nx` 依赖 PATH），并由 T24 锁住"摘掉什么 / 保留什么 / 不得原地改父进程对象"。
  顺带核实 `check-test-egress-ledger.js` 对 `staleKeys` 只提示不判红，所以风险面只有"新键"这一条。
- **产物归档**：`D:/Data/projects/.tools/tmp/vt-gate4/qm6-artifacts/`（含两份原始 log 与后端 findings 原件；
  后端那份最初被写到一个被 MSYS 路径改写毁掉的文件名上，已救出内容并从工作树删除，仓库内不留评审产物）。

### 采纳后新增的验证数字（供回填轮核对）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 判据单测（扩到 25 例） | `node --test scripts/check-gate4-selection.test.js` | `tests 25 / pass 25 / fail 0` |
| 负控同源（T22）与退回形式（T23） | 同上 | 真实仓两侧 `baseKind = twin:test:all / twin:test:affected` |
| 台账隔离（T24） | 同上 | 两个键被摘、`PATH`/`NX_SKIP_NX_CACHE` 保留、父对象不被原地改 |
| 下界与夹具同源（T25） | 同上 | `MIN_OTHERS=11 ≤ OTHERS.length=12`，夹具不含 desktop |

