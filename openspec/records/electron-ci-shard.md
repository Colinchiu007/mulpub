---
record: electron-ci-shard
task: 接通 Electron CI 串行单测的自证块（#2525 承诺但从未执行），并按 --shard 切成三片消除撞墙
date: 2026-10-20
---

## 本次执行记录：Electron CI 自证块接通 + 分片（electron-ci-shard，2026-10-20）
> ⚠️ **本轮实际落地范围（2026-10-20 收尾修正）**：只做了「接通自证块」与本轮 CI 抓出的
> 「台账名派生」两处真 bug 修复。**matrix 分片部分没有落地** —— 它被 ruleset 的 required
> context `electron-ci-tests` 与 matrix 后缀名冲突卡住，三轮尝试的现场见 §九。
> 下面 §四 / §五 里关于「切成三片」的描述是**当时的计划**，不是已交付的事实。


| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码/CI 变更 | worktree `<WORKTREE_ROOT>\mp-electron-ci-shard`，裸分支 `electron-ci-shard`；`.github/` 属运行时路径，未在共享根落盘 |
| 第一性原因（QM-5 ①） | 完成 | 见下 §一：两个独立引入点，各有 commit |
| 逃逸分析（QM-5 ②） | 完成 | 见下 §二：四层逃逸链 |
| 修复 + 回归保护（QM-5 ④） | 完成 | 见下 §四 + 45 例绿 + 变异反证 |
| 防止再次发生（QM-5 ⑤） | 完成 | 见下 §五：判据域从「文本存在」改为「行为成立」 |
| 行尾与 diff 对账 | 待提交后取证 | `--numstat` 与 `--ignore-cr-at-eol --numstat` 必须相等 |
| 接线棘轮 | N/A | 未新增 `*.test.js`（锁写进已在 CI 里被点名的既有文件） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/**` 与任何渲染面 |
| QM-6 CCG 双模型外部评审 | 见提交后回填 | M 级（跨 2 文件 + CI 形状变更），按决策矩阵需双模型审查 |
| 远程同步 | 由门禁推导 | 本行不需事后改写；合并后按主干历史推导（`scripts/lib/merge-ledger.js` 只认 squash 尾注 `(#NNNN)`） |

## 一、第一性原因（QM-5 ①）

两个独立的引入点，都追溯到具体 commit：

| # | 缺陷 | 引入点 | 当时意图 |
|---|------|--------|---------|
| R1 | 自证块在 `bash -e -o pipefail` 下永不执行 | `bef5fb72c`（#2525，2026-09-28） | PR 标题是「**让超时失败能自证**」。作者把 `RC=${PIPESTATUS[0]}` 与整段诊断**放在** `timeout … \| tee` **之后**，但该 job 的 `shell: bash` 在 GitHub 上带 `-e -o pipefail` ⇒ `timeout` 返回 124 时 `-e` 立刻退出步骤，后面一行都不到。作者想到了「`cmd \| tee` 的 `$?` 是 tee 的」，却漏了 `-e` 会先杀进程 |
| R2 | 整轮单 worker 串行，无分片 | 与 R1 同源（`timeout` 包装自 #1913/#1906 起的形状） | 用单 worker 串行换确定性 + 「main 侧第二次独立运行」的 flake 检出。这个目标本身是对的，但「一轮跑完全部」使步骤耗时对 runner 负载极度敏感 |

**关键旁证**：#2525 只改了这一处 step，而同一 `run:` 目录下早就有 `set +e … set -e` 的正确写法
（Electron 冒烟步骤 `set +e; timeout 30 pnpm exec electron …; status=$?; set -e`）。
即：**同一个文件里已有正确范式，新增的这段没用它。**

## 二、逃逸分析（QM-5 ②）—— 四层逃逸链

| 层 | 是否拦住 | 为什么没拦住 |
|----|---------|-------------|
| 单元/结构锁 | **否** | `apps/desktop/tests/gui-ci-exit-contract.test.js` 的「预算挂实测、超时可自证、不与 job 级倒挂」只断言 `BUDGET_SECONDS=2100` / `TIMEOUT_BUDGET_EXCEEDED` / `elapsed=` / `RC=${PIPESTATUS[0]}` 四个**字符串存在于 YAML**。判据域是文本，被测性质是运行时执行路径 —— 两者不等价 |
| 集成/E2E | **否** | 没有任何测试**真跑**一次「让 `timeout` 触发」的 shell 片段。唯一会触发它的是 CI 超时本身，而超时是低频事件；即便触发，也没人比对「日志里有没有自证行」 |
| 代码审查 | **否** | diff 里那段 `echo "[electron-ci-timeout-budget] elapsed=…"` 视觉上完全满足「能自证」的叙述。审查者要发现它，必须在脑内模拟 `-e` 的控制流 |
| CI 门禁 | **否** | 该结构锁通过 ⇒ 绿 ⇒ 无信号。红灯来自 `exit 124`，而 `exit 124` 恰恰就是「自证块没跑」的表现，两者互为因果，形成闭环 |

**逃过原因分类**：① 断言不精确（判据域错位，属于本仓 `mutation-probe-blindness` 同族：
「反证全绿可以是一条都没跑」）；② 测试不执行（行为从未被真实执行过）。

## 三、系统性漏洞定位（QM-5 ③）

- **文件**：`apps/desktop/tests/gui-ci-exit-contract.test.js`（用例「Electron CI 串行单测预算挂实测、超时可自证、且不与 job 级倒挂」）
- **漏洞类别**：**测试质量不足 —— 断言域错位**。`toContain` 系列断言的是「这段文本在 YAML 里」，
  而仓库真正需要的性质是「这段代码在 `-e -o pipefail` 下会被执行」。
- **可机械判定的形态**：凡「YAML 里有一整段失败诊断」，都必须有一条测试**真执行**它，
  否则该诊断与不存在等价。这一条可推广到所有 `timeout` 包装、所有 `|| echo` 依赖。
- **同族历史**：本仓已在 `01-docs/learnings.md` 记过两次同型（变异驱动没自证探针活着；
  `.quality-gates.md` 的「表格行 PASS、bullet PENDING」两口径矛盾）。**本次是第三次**。

## 四、修复 + 回归保护（QM-5 ④）

| 改动 | 内容 |
|------|------|
| C1 接通自证 | `set +e` … `RC=${PIPESTATUS[0]}` … `set -e`（与同文件冒烟步骤同形） |
| C2 分片 | `strategy.matrix.shard: [1,2,3]` + `--shard=${{ matrix.shard }}/${{ strategy.job-total }}` |
| C3 单片预算 | `BUDGET_SECONDS=900`（≈ 单片健康 265s ×3.4，且**严格低于**旧墙 1200s） |
| C4 确定性不变 | `--maxWorkers=1 --no-file-parallelism --reporter=verbose` 全保留 |

**回归保护（新增两条锁）**：

1. **行为锁**「自证块必须在 bash -e -o pipefail 下真能执行」——
   取 `run` 原文，只替换两个量（预算→1s、`pnpm …`→`sleep 5`），用 `bash -e -o pipefail` 真跑，
   断言 `status===124` 且 stdout 含 `[electron-ci-timeout-budget] elapsed=` / `rc=124` / `TIMEOUT_BUDGET_EXCEEDED`。
   **变异反证已做**：摘掉 `set +e` → 立即红并报「自证行缺席 ⇒ 自证块又被 -e 提前杀掉了」。
2. **结构锁**「按 shard 切开，单片预算挂单片实测」——
   断言 matrix 存在且 ≥2 片、`--shard=…/job-total`、确定性参数保留、`budget ≥ 单片健康 ×3`、
   以及反向判据 `budget < 20*60`（防「把抬预算包装成分片」）。

**既有锁的口径同步（属实现更正确后契约要改，不是掩盖失败）**：
原锁用整轮 794s 卡预算（要求 ≥1588s）。分片后必须按片摊薄，否则会得出「必须 ≥1588s」
这种把分片收益吐回去的结论。同一次还改了三处按步骤名精确等值的 `find/filter`——
步骤名新增了 `, shard <i>/<n>` 后缀，精确等值会返回空集，而 `toHaveLength(1)` 会因此
红得莫名其妙（前缀匹配才是这些断言的本意）。

## 五、防止再次发生（QM-5 ⑤）

1. **判据域升级**：诊断类代码的锁一律从「字符串存在」改为「**真执行且断言输出**」。
   本次给出可复制的范式：文本替换两处 + `bash -e -o pipefail` + 断言 stdout。
2. **变异反证留痕**：新锁必须能因「删掉 `set +e`」而红。这一条已写进本记录并在提交信息里点名。
3. **换算规则写进事实源**：`docs/electron-ci-step-budget-baseline.md` 新增「整轮 794s 不能直接卡单片预算」，
   并就地更正该文档原先那句「档 3 已实现」——**那句话是错的，且它是本次偏差的直接来源**。
4. **提案层留证**：`openspec/changes/electron-ci-shard-budget/proposal.md` 记录了
   lectron-tests **就是** required context，但 gate 挂在 ruleset main-ci-gate（id 23749994）而不是 legacy protection API 上；matrix 会让该 context 永不出现 ⇒ PR 恒 BLOCKED。修法是补 lectron-tests-summary 汇入作业（
ame: electron-tests）。

## 遗留（不假装已闭合）

- **档 4 仍未做**：`CI Failure Handler` 尚未把「`exit 124` 且无摘要行」归类为 `ci-timeout-budget`。
  分片 + 自证接通后，这类事件的归因成本已大幅下降，但自动化归类仍缺。
- **成本上升**：三片各跑一遍 install / electron runtime / preload 构建，runner 分钟数约 ×3。
  这是用成本换「不再撞墙 + 失败可归因」，未做成本优化。
- **分片数是否该更大**：本次取 3 片是按 794s 健康耗时估的，**尚未用真实分片运行数据校准**。
  接通自证之后，下一轮 main push 会首次产出 `elapsed=` 读数，届时应据此复核片数与预算，
  而不是沿用本记录里的估计值。

## 六、CCG 对抗审查（第二轮：审这次修复本身）

`sh scripts/deep-review.sh`（critic=claude；决策层判 SINGLE —— 方案 49 行 ≤200）。
代码层 470 行 / 7 文件。产出 **7 条**（5 Warning + 2 Info），4 维度，最低分 6；5 条争议全部 `upheld`。

| ID | 维度 | 问题 | 处置 |
|----|------|------|------|
| i1 | correctness | **同 PR 内三处口径矛盾**：strategy 注释与 proposal C3 写 1200s，实现是 900s；且 1200 恰好**等于**旧墙，反向判据 `budget < 20*60` 按提案值必红 | 三处统一 900s，proposal 同步余量 3.3×→3.4× |
| i2 | performance | **PR 侧三倍浪费**：我只核算了 main 侧收益。测试步骤被 `if: event_name != 'pull_request'` 跳过，但 checkout/install/electron runtime/冒烟等**无 if** 的步骤照跑，matrix 会把它们各跑三遍、零收益 | matrix 按事件分档：PR 1 片 / 非 PR 3 片（`fromJSON(... && '[1]' || '[1,2,3]')`） |
| i3 | maintainability | **反向判据可组合回退**：片数降到 2 时上界 = 794/2×3 = 1191s，则「`budget ≥ 1191` 且 `budget < 1200`」交集非空 —— 「2 片 + 1191s」能同时通过两条判据 | 片数从 `>= 2` 改为**恰好 3**；上界再加 `<= 900` 钉住现值 |
| i4 | correctness | `.ccg/reviews` 记录 `deepReview=pending` 一并入库 | 回填 findings + `self_play_resolved`。**另一半被证伪**：`sha=6b41d715c` 是父提交（引擎文档化行为），且该记录**无** `changedLines` 字段（实测 `undefined`），故「189 行 vs 640 行不符」是对不存在的字段做比对 |
| i5 | maintainability | job 级倒挂注释仍写「内层 timeout 35 = 55 分钟」，实际 900s=15min ⇒ 10+10+15=35 | 注释同步为 15 分钟并点名常量来源 |
| i6 | Info | 794/3 是**均值**假设；`vitest --shard` 按文件切，各片时长未必均匀 | 锁内加 `TODO(校准)`；该项留在「遗留」不假装闭合 |
| i7 | Info | 担心行为锁只跑前缀段、且诊断命令在空 log 上会改写退出码 | **部分证伪 + 加固**：行为锁跑的是整段 `run`（含末尾 `exit $RC`），诊断命令本就全带 `|| true`；仍加断言 `已完成测试行数` 证明控制流穿过了那条 `grep -c` |

### 「审这次修复本身」抓到的两条最值钱的

- **i2**：我把 matrix 当成纯赚，只算了 main 侧收益，**漏了 PR 侧三倍 setup 开销** —— 这与 #4052 那次「假同源」同族：只验证了自己关心的那一面。
- **i3**：反向判据只防「单片变大」，没防「片数变少把均值上界抬高」。结构锁的价值正在于「没人在意时也不失效」，而这次改动恰好就在动片数与预算。

### 变异反证（锁是否真有牙）

新锁写完后**摘掉 `set +e`** 再跑：立刻红，报「自证行缺席 ⇒ 自证块又被 -e 提前杀掉了」。还原后 45 例全绿。**没有这一步，「行为锁」就只是另一段文本断言。**

### 调试过程留痕（两次红错根因）

行为锁的 harness 自己错过两次，都记在这里，因为它们是「红得不是被测性质」的典型：

1. 用 **shell 函数桩**替 `pnpm` → `exit 127`。因为 `timeout` 是**外部命令**，它 `execve` 出来的子进程看不到当前 shell 的函数表。
2. 改成 **PATH 注入 stub** → 仍 `exit 127`。因为 Node 直接 spawn MSYS 的 bash 时不做 Windows→POSIX 转换，继承来的 `C:\…;C:\…` 被按 `:` 切坏，连 `date` 都 command not found。

最终用**文本替换内层命令** + 显式 `PATH=/usr/bin:/bin` 才让这条锁测的是被测性质。另：`spawnSync` 阻塞事件循环，vitest 的 10s 默认超时**无法中断**它（实测报成 15s 的 “Test timed out in 10000ms”），故该用例给了显式 `SHELL_HARNESS_TIMEOUT_MS`。

## 七、CI 抓到的那一层：行为锁 spawn bash 撞上运行时出站台账

首次 PR CI：`QG Desktop Shards (1/2)` 红，但日志显示 **525 个测试文件 / 9541 例全 pass**，红在测试**之后**：

```
FAIL: 出现基线之外的运行时台账键：
  + child::Program
```

我的行为锁要真跑一段 bash 才能验证 `-e -o pipefail` 语义，而 `resolveGitBash()` 给的是
`<GIT_BASH>`（形如 `<GitRoot>\usr\bin\bash.exe`，路径含空格） —— 这是一条**正当**的非 node 子进程，被
`packages/shared-utils/src/network-egress-guard.js` 的 `ledgerCommandName` 记账时折成了
`Program`。

### 这是台账名派生的缺陷，不是"我该去加个键"

`shellFirstToken` 只处理了**带引号**的含空格路径（仓库自己在注释里记过
`"<带空格的绝对路径>/evil.exe" → Program` 这个形态），但 `spawn(file, args)` 传的是**裸路径**，
从来没人管。于是：

- 若我图省事，把 `child::Program` 加进基线 —— 等于给一个**无意义键**背书：以后任何
  含空格的安装目录下的子进程都会被它盖住，台账彻底读不出是谁在起子进程。而基线本仓
  的规矩是「清单只能缩小，新增必须逐条写清为什么这里会起非 node 子进程」——`Program` 写不清。
- 正解是修派生：裸串且**整串据存在性解析成文件**时取真实 basename。判据取文件存在性而不是猜词法，
  因为 `exec`/`execSync` 传的是含空格分隔的整条命令行，整串不会解析成一个存在的文件。

### 落地的三件事

1. `ledgerCommandName`：裸路径且 `fs.existsSync(整串)` ⇒ `path.basename`；
2. 回归锁（`network-egress-guard-child.test.js` +1 例，22 例绿）：临时目录里造一个**文件名含空格**的
   stub，断言台账名是 `my tool.exe`，并用**负控**钉住「不得是 `my`」；再断言不存在的含空格串仍按命令行处理。
3. 基线登记 `child::bash.exe`，理由写全（哪个测试、为什么必须起 bash、只跑 coreutils、不预期出站）。

本地端到端复核：跑行为锁并落临时台账，`type=child` 两行分别是 `git` 与 **`bash.exe`**（不再是 `Program`）；
再用真判据 `check-test-egress-ledger.js --ledger <临时台账>` ⇒ `PASS: 运行时出站台账与基线一致`。

### 这一层的教训

我本地跑的是**单个测试文件**，而台账判据挂在**整套桌面测试**跑完之后 —— 单文件通过不构成
「这一层也通过」的证据。这与本 PR 主线要修的那个毛病同型：**局部绿不等于整体绿**，
所以收尾必须回读 CI，而不是拿本地绿推结论。

## 八、PR 卡在 `base branch policy prohibits` —— 我第一次取证取错了

CI 22 项全绿、5 个 required check 全 SUCCESS，`gh pr merge` 仍被拒：
`Pull request is not mergeable: the base branch policy prohibits the merge`。

**根因**：`electron-tests` **就是** required context —— 但那个 gate 挂在 **ruleset** 上，
不在 legacy protection API 上。我最初只查了

```
gh api repos/<owner>/<repo>/branches/main/protection
  → required_status_checks.contexts = ["Gate Result","build","QG Unit Tests","QG Coverage"]
```

于是写下「`electron-tests` 不在 required checks 里，matrix 不会破坏分支保护」。**这个结论是错的。**
真正的 gate 在：

```
gh api repos/<owner>/<repo>/rulesets            → 23749994 main-ci-gate  active
gh api repos/<owner>/<repo>/rulesets/23749994   → required contexts:
    QG Static / QG Unit Tests / electron-tests / 文档同步检查
    债务熔断检查 / 单元测试 + Lint / GUI Gate Result
```

matrix 把作业报成 `electron-tests (1)`/`(2)`/`(3)` ⇒ `electron-tests` 这个 context **永不出现**
⇒ 无论多少项全绿都判 blocked。

**修法**：加汇入作业 `electron-tests-summary`（`name: electron-tests`、`needs: [electron-tests]`、
`if: always()`），把 matrix 的聚合结果按 required 名报出去：任一片失败即失败，`skipped`（docs-only
短路）按本仓既有约定放行。结构锁钉住三件事：汇入作业不得被删、`name` 不得改、matrix 作业自己
不得叫同一个名字（否则两条同名检查、聚合语义失效）。

**教训（比这一条本身更重要）**：GitHub 有**两套并存**的分支保护面 —— legacy protection 与 rulesets。
只查一套就得出「不受约束」的结论，形态上等同于「查到第一个空结果就收工」。这与本轮主线要修的
那个毛病（`toContain` 通过 ≠ 代码会执行）是同一类：**判据覆盖了局部，就以为覆盖了整体**。


## 九、收尾：分片没有落地，以及三轮尝试的现场

原计划是「接通自证 + 按 `--shard` 切成三片」。三轮实测后只落地了前一半，后一半被
required context 卡死：

| 尝试 | 现场 |
|------|------|
| ① matrix `shard: [1,2,3]`（PR 1 片 / 非 PR 3 片） | 分片能跑（PR 上 `electron-tests (1) pass 2m14s`），但 check 名变成 `electron-tests (1)`；ruleset `main-ci-gate` 要求的 context 是 `electron-tests` ⇒ 该 context 永不出现，**22 项全绿仍判 `base branch policy prohibits the merge`** |
| ② 另加 `name: electron-tests` 的汇入作业（`if: always()`） | **整份 workflow 被判不可解析**：幻影 `push` run + **0 job**，run 的 `name` 退化成 workflow 路径；`on.push.branches: [main]` 下却出现本分支的 push run ⇒ GitHub 连 `on:` 都没读到 |
| ②' 同上但 `if: ${{ always() && needs.changes.outputs.docs-only != 'true' }}` | 同样 0 job + 幻影 push run（排除「只是 if 表达式写法」这一解释） |
| ③ 只给 matrix 作业加静态 `name: electron-tests` | 解析正常（`event=pull_request`、`jobs=1`），但 check 名**仍是** `electron-tests (1)` |

**所以正解不是「再试一种 if 写法」，而是把 matrix 作业改 id**（如 `electron-tests-shards`）
+ 用 id 为 `electron-tests` 的汇入作业。这一步本身能成立，但它要同步改
`.github/scripts/workflow-contract.test.js` 的多条结构性锁（「跑桌面 vitest 全量的每个 job
必须在测试前重建那 5 个产物」「测试步的 `if` 必须是字面量非 PR 事件」等按 job 名/needs 断言
的判据），以及 `apps/desktop/tests/gui-ci-exit-contract.test.js` 里所有
`workflow.jobs['electron-tests']` 引用。**那是另一件事，且挨着「谁来守门」**，不该塞进一个
修超时的 PR。已按这个判断收窄，并把分片留给下一轮（依据是自证块接通后首次产出的逐片 `elapsed=`）。

### 这轮真正值钱的两条方法论

1. **判据域错位比判据缺失更危险**：`toContain('elapsed=')` 一直是绿的，而它守护的代码
   一次都没执行。修法不是「再加一条断言」，而是**把判据域从文本换成行为**（真跑那段 shell）。
2. **两套并存的分支保护面**：`branches/main/protection` 只有 4 个 context，而真正拦人的是
   `rulesets/23749994`（7 个）。只查一套就得出「不受约束」的结论，等同于「查到第一个空结果就收工」
   —— 与本轮主线要修的毛病同型。
