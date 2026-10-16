## Why

**一次 `git commit` 要 24–30 分钟，13 个并发会话的提交同时卡死，机器 CPU 打满而每个 `git commit` 自身 CPU≈0。** 根因不在网络、不在锁、不在仓库体积，而在 `scripts/hooks/pre-commit` 里一段按文件数线性放大的进程创建循环，撞上本机被实时拦截层抬高的进程创建成本。

### 实测证据（2026-10-15/16 本机）

> **下列计数是时点数，不是常量。** `.ccg/reviews/` 会随每一笔提交自增（本 PR 落地后仍会），因此落文档时 MUST 按「构成」描述、MUST NOT 把某个总数当基线引用。判据命令本身可直接复跑。

| 判据 | 实测值 | 复跑手法 |
| --- | --- | --- |
| 单次进程创建成本（与 git 无关，**拥堵现场读数**） | `cmd.exe /c exit` 均值 **1,175 ms**；`git --version` 699 ms。风暴排空后同法复测为 **53 ms / 84 ms** ⇒ 这是并发放大值，不是机器常数（见下条更正） | PowerShell 里循环 10 次取均值 |
| 空临时仓库 `git rev-parse HEAD` | 705 ms | 同机 A/B：新建空库 vs 本仓（774 ms）⇒ **与仓库无关** |
| 钩子循环单迭代 | **2,438–3,032 ms**（= 2~3 次进程创建） | 复制 `pre-commit` L156–161 循环体跑 20 次取均值 |
| 外推单次提交耗时 | 1,446–1,798 s（**24–30 分钟**） | 单迭代 × 当时在盘的记录数 |
| 现场卡死链 | 13 条 `git commit`→`bash pre-commit`，墙钟 2.6–30.1 分钟，而钩子 bash 累计 CPU 仅 **17–35 秒** | `Get-CimInstance Win32_Process` 取 CommandLine/CreationDate |
| 进程创建风暴 | **18.2 个 git.exe/秒**（12 秒内 218 个不同 PID） | 400 ms 采样累计去重 PID |
| 占空比 | 每个钩子 bash CPU/墙钟 ≈ **2–3%** ⇒ 阻塞而非空转 | 同上 |

### 根因链（三段，缺一不成立）

1. **`.ccg/reviews/*.json` 不被 `.gitignore` 排除**（实测 `git check-ignore` ⇒ `NOT_IGNORED`），因此它们是被提交进版本树的审计留痕；origin/main 树里该目录当前有 **659 个文件（609 个 `.json` + 50 个 `.md` brief）**，且**每一个 worktree 检出时都会继承全部**（实测一个本轮新建的 worktree 开箱即带 657 个）。增量按月：2026-08 加 0、2026-09 加 0、2026-10 加 607。
2. **钩子把「本次产生的记录」写成了「对盘上每个文件问一遍」**（2026-10-16 复测更正：单次进程创建并非常数——拥堵现场 1,175 ms、排空后 53 ms，差 22 倍；所以 O(N) 的 spawn 形态既是受害者也是拥堵的制造者，拆掉 N 才是拆放大器。）。L156–161 对 `.ccg/reviews/*.json` 逐文件执行 `[ -z "$(git ls-files -- $rec)" ] || ! git diff --quiet -- $rec` ⇒ 每文件 2~3 次进程创建。**于是 N 不是「本次新增的 1–2 条」，而是「树上全部 609 条」**；其中绝大多数早已跟踪且无改动（实测共享根 `tracked=644 / untracked=0 / modified=0`），即这 **约 1,218 次只读调用全部用来发现「无事可做」**。
3. 第 2 段的 O(N) 乘上第 1 段自增的 N，再乘上机器级的 ~1 秒/进程 ⇒ 单次提交分钟级退化；并发提交互为正反馈（每个提交都在制造别人要扫的记录），最终表现为「CPU 打满 + 提交集体不动」。

### 已被取证否证的三条误判（不得按它们修）

| 误判 | 否证证据 |
| --- | --- |
| 「共享仓库级 git 锁竞争」 | 全机 **0 把锁**：38 个 worktree 无 `index.lock`、`refs/` 递归 `.lock`=0、`.git/worktrees/*/*.lock`=0、无 `gc.log`/`gc.pid`，松散对象仅 295（远低于 auto-gc 阈值），无 `git gc`/`repack` 在跑 |
| 「钩子在等 CCG 外部模型」（`SKIP_CCG_GATE=1` 可解） | 计数窗口内**没有任何 `node.exe` 在跑 `ccg-gate.js`/`quality-rhythm-wrapper.js`**；且 `SKIP_CCG_GATE` 只在 `ccg-gate.js` 内部生效（L242/L334），那段 for 循环在钩子 shell 里**无条件执行**，豁免它无效 |
| 「MSYS bash fork 模拟慢 / 钩子自递归」 | 原生 `cmd.exe` 同样 1,175 ms ⇒ 非 MSYS 特有；「嵌套的 pre-commit bash」是 `$(...)` 命令替换的 fork 继承父 argv（52/59 次采样命中的都是同一 argv 形态），不是递归调用 |

### 本 PR 闭合什么、不闭合什么

**闭合**：把钩子对记录目录的处理从 O(N) 次进程创建改为**常数次**，使「提交耗时」与「树上记录数」解耦——这是仓库侧唯一可机械修的一环。

**不闭合（如实登记，不留模糊）**：单次进程创建 ~1 秒属**机器级**，来自实时拦截层（本机注册 AV 含腾讯电脑管家系统防护，`QQPCRTP` 在运行；`Everything` 与极空间 `ZSpaceSync`/`syncstate` 常驻监听 D:），**不在仓库里、本 PR 修不了**。本 PR 另交一份《进程创建路径排除清单》文档（只给判据与自证方法，不改任何第三方设置）。不修这一条，仓库侧改完仍会有「所有 agent 工具链整体偏慢」的残留。

## What Changes

- **钩子（`scripts/hooks/pre-commit` L156–161）改写为常数次进程创建**：候选集改由 **git 自己的视图**派生——`git ls-files --others --exclude-standard -z -- <pathspec>`（未跟踪）∪ `git diff --name-only -z -- <pathspec>`（已跟踪但有改动），两集合按定义互斥（一个不在 index、一个在 index），直接拼接无需去重；再一次 `git add --pathspec-from-file=- --pathspec-file-nul` 从 stdin 批量暂存。走 stdin 而非 argv，是为绕开 Windows `CreateProcess` ~32k 命令行上限（609 条路径会溢出）。
- **有意的行为分歧（必须写明，不得冒充「完全等价」）**：被 `.gitignore` 命中的路径**不再被提出**。旧写法会对其发起 `git add`、必然失败、并被 `|| true` 静默吞掉；新写法靠 `--exclude-standard` 根本不纳入候选。方向是严格减少注定失败的调用。
- **批量 `git add` 失败时回退逐个并出声**，保留旧写法「单个失败不阻断提交」的 fail-open 语义；回退不得静默。
- **回归锁 `scripts/hooks/pre-commit.test.sh` 新增 scenario16**，三向约束缺一不可：① 同成本（记录数 N=2 与 N=200 时钩子的 git 调用总数**逐字相等**）；② 有预算（argv 含 `.ccg/reviews` 的调用 ≤3）；③ **仍有效**（200 条记录确实入库）。只断言 ①② 会被「什么都不做」的实现满足——这条是本类规模锁的通用陷阱。
- **CI 结构锁 `scripts/check-precommit-spawn-budget.js` 常驻 `quality-gate.yml` 的 `changes` job（Gate 2b）**，断言钩子正文不得再出现「按 glob 逐文件 fork git」的形态。宿主刻意**不选 pre-commit**：钩子自己正是被约束对象，且本仓同日实测「判据挂 pre-commit 两刀都不拦」；`changes` job 无 Install deps，新脚本 MUST 只 require node 内置模块。
- **不删除任何既有判定记录**（经用户决策）：609 个 `.json` 是已入库审计留痕，删除受轨文件须走 `git rm` 评审，且会让 38 个 worktree 同时出现大规模 `D`、与在飞提交正面撞车。登记为独立的治理待决项。

## Impact

- Affected specs: `commit-hook-record-staging`（新增 capability）
- Affected code: `scripts/hooks/pre-commit`（权威源；经 `scripts/install-git-hooks.ps1` 同步到共享 `.git/hooks/`，**因此本改动作用于全部 38 个 worktree 的每一次提交**）、`scripts/hooks/pre-commit.test.sh`、`scripts/check-precommit-spawn-budget.js`（新）、`scripts/check-precommit-spawn-budget.test.js`（新）、`.github/workflows/quality-gate.yml`（接线）、`.gitignore`（补 `!scripts/…` negation，否则新脚本被第 106 行 `scripts/*.js` 静默吞掉 → CI 永不执行它）
- 风险面：改的是「每次提交都跑的守门件」。语义等价性由 scenario16 的「仍有效」这条 + 精确 staged 集合锁双向守住；批量失败路径有回退。
- 顺带登记（本 PR 不动，经用户决策）：`scripts/pre-code-edit-guard.ps1` 对共享根**无条件** `exit 1`（源码 L18–26，无路径放行清单），与 `AGENTS.md`「`scripts/` 工具脚本、docs 可就地编辑」相互矛盾。两处规则现由不同层执行（守卫 fail-closed / 文档允许），需另行裁定口径。
