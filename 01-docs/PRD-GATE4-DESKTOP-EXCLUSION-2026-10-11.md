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

同一步的其余事实：12 个非桌面包在 06:20:03 前全部跑完并打印，**第 13 个任务（desktop）从头到尾
没有输出**（nx 的 static 输出风格要等任务结束才成块打印），`##[endgroup]` 落在 06:48:23 ——
即"静默 28 分钟"其实是 desktop 全量套件在跑。成功的那两次（1173s/1322s）不是没跑 desktop，
而是**刚好跑完**。

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
| 相邻正确用法 | #1897（2026-09-17）在同一段上方一行写了正确的 `nx show projects --affected --exclude=@multi-publish/desktop --json`（旗标直接给 nx），两份用法相隔 8 行、注释还点明了"排除 desktop"的意图，却没有任何东西把它们对照。 |
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
