---
record: electron-tests-shard-step
task: electron-ci 桌面全量在 main push 撞 2100s 步骤预算墙 —— 收回单一实现、同一步两片并行、共享预算 2700s、修掉计数器失明
date: 2026-10-21
branch: electron-tests-shard-step
---

## 本次执行记录：electron-ci 桌面全量步骤分片化（electron-tests-shard-step，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=false files=12`）；改动集 = `.github/workflows/electron-ci.yml`、`.github/workflows/quality-gate.yml`、`.github/scripts/workflow-contract.test.js`、`apps/desktop/tests/gui-ci-exit-contract.test.js`、`.gitignore`、`scripts/electron-ci-desktop-step{,.test}.js`、`scripts/electron-ci-shard-audit{,.test}.js`、`CHANGELOG.md`、`docs/electron-ci-step-budget-baseline.md`、本记录。隔离 worktree `D:/Data/projects/mp-worktrees/mp-electron-tests-shard-step` / 裸分支 `electron-tests-shard-step`，起始基线 `origin/main=e8799536c`；**合并前两次 re-sync**（→ `11e7d0ca8`，再 → `2f5c0a32f`），两次与上游改动集的交集都只有 `CHANGELOG.md` 一处顶部插入，按「主干每行都在 ∧ 我的块还在」解，现场读数 `MARKERS_LEFT=0 / MAIN_LOST=0 / MINE_LOST=0 / REST_LOST=0`；rebase 后全套重跑（见 §7 命令）仍全绿 |
| 第一性原因（QM-5 ①） | PASS | 不是"套件变慢了"。三条同源前提各自有出处：① 该步把**整轮桌面全量**塞进一个串行 `pnpm … test`，墙钟随文件数线性涨；② `BUDGET_SECONDS=2100` 与计数锚在 workflow 内联 bash 里各存一份，**没有回归锁**（判据与产物口径分裂）；③ 计数锚 `^[[:space:]]+[✓×↓-]` 对 vitest 真实行恒 0（行首是 `033[32m✓`，`od -c` 实测），所以"跑满预算"在现场读起来是"一条都没跑"，把可归因的墙伪装成不可归因 |
| 逃逸分析（QM-5 ②） | PASS | ① **单元层**：`gui-ci-exit-contract.test.js` 旧版断言的是"这四行字符串存在于 YAML"，而性质是"这四行会在 `bash -e -o pipefail` 下真执行" ⇒ 判据域错位，锁恒绿（#2525 的自证块从未真跑过一次，2026-10-20 已现场否证）；② **集成层**：该步骤 `if: github.event_name != 'pull_request'` ⇒ **PR 侧永远不跑**，PR 全绿对 push 红零信息量；③ **审查层**：预算数字与耗时基线的关系写在注释里，没有任何东西在它不成立时变红 |
| 系统性漏洞定位（QM-5 ③） | PASS | 两类具体漏洞：**(a)「判据住在 workflow 正文里」** —— CI 的 required check 由一个无锁的 bash 块产出，改它不需要任何人同意，也不会有任何东西因它变红（本仓范式是"收回单一实现 + 脚本自带锁"，先例 `agent-review-gate.js` / `main-red.js`）；**(b)「计数的锚没被证明能命中真实字节」** —— 一个恒 0 的计数器和一个"真的什么都没跑"的现场同形，而修复动作（改锚）与结论（跑没跑完）只能靠一次 `od -c` 分开 |
| 修复 + 回归保护（QM-5 ④） | PASS | `scripts/electron-ci-desktop-step.js`（一步内两片并行 + 一份共享预算 + 四档 verdict + 剥 ANSI 的现场计数 + 逐片 `elapsed=`）；`scripts/electron-ci-shard-audit.js`（**复测入口落在仓库里**，输出字段与 `STEP_BUDGET_PROVENANCE` 逐字段对齐，NO_SAMPLES/BELOW_FLOOR/HUGGING/OK 四档，零样本与自身故障均非零退出）。锁：`electron-ci-desktop-step.test.js` **12 条** + `electron-ci-shard-audit.test.js` **9 条** + 迁移 `gui-ci-exit-contract.test.js`（46/46）与 `workflow-contract.test.js`（45/45）到委托形状 |
| 防止再次发生（QM-5 ⑤） | PASS | ① **委托判据按语义不按名字**：`workflow-contract.test.js` 认委托成立的条件是被点名脚本**自己的源码**里有三条锚（`DESKTOP_PKG` 常量、`'--filter', DESKTOP_PKG, 'test'`、`--shard=`），并双向可测；② **覆盖面下界**：`rows.length >= 3` 反失明（本轮真实拦下一次，见 §5）；③ **预算三把锁**：`≥ max×倍数`、`> max`、样本量下界，且断言一律 `≥`（低读数不构成收紧理由）；④ **复测入口与其字段对齐锁** + 零样本非零退出；⑤ 新脚本本体两条 `.gitignore` 反选 + 锁内断言反选在位 |
| 行尾与 diff 对账 | PASS | 见 §6（两个 numstat 口径当场对数） |
| 接线棘轮 | PASS | `check-unwired-tests.js`：检查域内测试文件 **119 个**（本片新增 2 个测试文件，均已在 `quality-gate.yml` 的 `changes` job 逐条点名，该 job 不被 docs-only 短路且在非 PR 早退之前）；`check-workflow-structure.js` files=16 violations=0；`check-step-failfast.js` rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 运行时代码与任何 UI 文件；改动全在 CI 编排、判据本体与文档 |
| QM-6 CCG 双模型外部评审 | 自演，非外部模型 | 按用户指定「QM-6 你自己来模拟外部评审」执行，两轴逐条自审见 §5。**如实标注：这不是外部模型产出，不得当作双模型证据登记**；本 PR 变更集内 `.ccg/reviews/` 产物数 = 0（当场取数：`git diff --name-only $(git merge-base origin/main HEAD) HEAD \| grep -c '.ccg/reviews/'` → 0） ⇒ `evaluateDeepReviewDebt` 的**扫描域为空、当场早退**。这句不推广成"CCG 未装就无从判红"——条件在扫描域：PR 只要携带 `mode=dual` 产物该判据就会红 |
| 远程同步 | 由门禁推导 | 本行状态列不手写状态词，由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

- 保留门禁：变更类型与隔离 ✅ | QM-5 五步 ✅ | 行尾对账 ✅ | 接线棘轮 ✅ | QM-6 自演（非外部）✅ | 文档同步 ✅ | 远程同步 PR #4192

## 2. 现场读数（2026-10-21 全部现取，复测入口见 §7）

### 2.1 红因归因：8/8 是预算墙，不是用例坏

| run | head | 时刻 | 结论 | 作业墙钟 | rc=124 | TIMEOUT_BUDGET_EXCEEDED | ✓×行 | 摘要行 | 断言红 |
|---|---|---|---|---|---|---|---|---|---|
| 39606272536 | `11e7d0ca8` | 13:14:34Z | failure | 2184s | 1 | 2 | 18508 | 0 | 0 |
| 39596352462 | `e8799536c` | 12:01:36Z | failure | 2215s | 1 | 2 | 18929 | 0 | 0 |
| 39588059071 | `617e4bf69` | 10:54:56Z | failure | 2206s | 1 | 2 | 18746 | 0 | 0 |
| 39584501319 | `2a63373d3` | 10:25:38Z | **success** | 1934s | — | — | — | — | — |
| 39584142005 | `760826d19` | 10:22:42Z | **success** | 1820s | — | — | — | — | — |
| 39569099718 | `b14935951` | 08:25:04Z | failure | 2198s | 1 | 2 | 18741 | 0 | 0 |
| 39565044965 | `4711f4a64` | 07:52:16Z | failure | 2177s | 1 | 2 | 18770 | 0 | 0 |
| 39562665707 | `c074b91b6` | 07:32:10Z | failure | 2178s | 1 | 2 | 18901 | 0 | 0 |
| 39562100679 | `4aaabc911` | 07:27:27Z | **success** | 1511s | — | — | — | — | — |
| 39559430408 | `eefd3914f` | 07:04:06Z | failure | 2189s | 1 | 2 | 18520 | 0 | 0 |
| 39557067585 | `05e83ddf1` | 06:42:13Z | **success** | 1542s | — | — | — | — | — |
| 39553019483 | `e297ccc73` | 06:02:41Z | failure | 2187s | 1 | 2 | 18156 | 0 | 0 |

`success=4 nonSuccess=8 ⇒ 预算墙=8、断言失败=0、两者都无=0`。

三条必须分开说的结论：
1. **红趟里 `✓×行≈1.8 万`** ⇒ 旧 bash 计数报的"已完成测试行数: 0"是**计数器失明**，不是事实。
2. **摘要行=0 是正确读数** —— 被杀趟根本没有 vitest 摘要行。把它和①一起"修掉"等于给自己造假象。
3. 取数前必须**先剥 Actions 的每行时间戳前缀**再剥 ANSI，否则任何 `^` 锚恒不命中，"0 条"是探针坏而不是世界。

### 2.2 预算取值：`max × 1.5 = 2091s` 只剩 9 秒，所以取 2700s

`QG Desktop Shards`（`quality-gate.yml` main push，只取 `conclusion=success`，时长按作业自己的 `started_at/completed_at`）：

`runs=7 shards=14 min=11.2 p50=18.6 max=23.2`（分钟，全样本 11.2,11.2,15.8,17.6,17.7,17.8,18.4,18.6,18.6,19.2,22.1,22.2,22.3,23.2）

| 候选 | 值 | 判 |
|---|---|---|
| 旧值 2100s | `max×1.5 = 2091s`，余量 **9s（0.4%）** | ✗ 贴脸；且样本形状是**每片独占一个 runner**，本步是同 runner 两片并行 ⇒ 争用倍数未测，9 秒不构成任何保护 |
| **采用 2700s** | `= max × 1.94` | ✓ 给争用留约一倍空间；仍 `≥ max×1.5`；单调放宽（不会让任何原本通过的运行变红）；不倒挂：本 job 其余带步骤级 timeout 的步骤合计 20 min，`20 + 45 = 65 < 70` |
| 抬到 3000s+ | `20 + 50 = 70`，判据是 `timeout-minutes > 其余 + 预算` **严格大于** ⇒ 70 不满足 | ✗ 要它必须同时改 job 级 `timeout-minutes`，属另一处预算面，本片不动 |

## 3. 三条被否证或不成立的形状（为什么是这个方案而不是别的）

| 候选形状 | 结论与依据 |
|---|---|
| **删掉 electron-ci 里这一步**（"PR 侧 QG Desktop Shards 已经跑过桌面全量了"） | ✗ 不成立。这一步的产品语义是「**main 侧、单 worker、串行、确定性模式**的第二次独立运行」，用于 flake 检出；`QG Desktop Shards` 是另一套环境（矩阵作业、PR 也跑）。删它等于关掉一种覆盖，而不是修一个超时 |
| **matrix 分片 + 汇入作业**（2026-10-20 那版计划） | ✗ 未采用。matrix 会把 required context 变成 `electron-tests (1/2/3)`，需要新增汇入作业去"骗回"那个名字 —— 那是改「谁来守门」。本片在**同一个作业内**并行两片，名字与 required 清单一个字都不动 |
| **只抬预算，不改形状** | ✗ 不成立。抬到能容纳串行的值（实测红趟 2177–2215s 已被掐，说明整轮 > 2100s）需要 ≥3000s，而 3000s 会撞上 job 级 70 min 的不倒挂判据（见 §2.2），连锁改动更大且不修根因 |
| **用 vitest `--shard` 但把两片写进两个 `timeout` 分别掐** | ✗ 不成立。各自预算 = 两份墙钟，等于把预算翻倍还 disguise 成"分片"。本片显式**共享一份** `budgetMs`，并由锁断言"两片各 0.8×预算时总耗时 ≤ 1.6×"（串行会到 ~1.6×，并行 ≤ ~0.8×+ε） |

## 4. 变异反证 T1–T10

驱动：`D:/tmp/p320-mut90b.js`（每刀跑**三套**取红集并集：`electron-ci-desktop-step.test.js` 12 条、`electron-ci-shard-audit.test.js` 9 条、`gui-ci-exit-contract.test.js` 46 条）。控制跑自证健康：`CONTROL_OK src=12/12 audit=9/9 wf=46/46`。还原自证：`RESTORED_BYTE_IDENTICAL=true`。

| ID | 这一刀 | 指名的锁（必须红） | 结果 |
|---|---|---|---|
| T1 | 起一片就 `await`（退回串行） | 两片必须在等待任何一片之前就已启动 | CAUGHT（另带出一条「预算挂实测/不倒挂」也红 —— 串行使总耗时越墙，属真实的跨锁命中） |
| T2 | `allSettled` 退回 `race(h.done)` | 超预算的那一片按 timeout 归档 | CAUGHT |
| T3 | 计数不剥 ANSI | 已完成测试行数：必须先剥 ANSI 再数 | CAUGHT |
| T4 | 锚要求行首必须有空白（`+` 代 `*`） | 同上 | CAUGHT |
| T5 | `rc = (timedOut‖failed) ? 1 : 0`（两档并档） | 超预算归档 + Electron CI 预算挂实测 | CAUGHT 2/2 |
| T6 | provenance 的 `maxObservedShardMin` 抬到 40（反向：预算跟不上） | 预算取值有实测出处 + 预算挂实测 + 审计的「当前读数支持当前预算」 | CAUGHT 3/3 |
| T7 | workflow 退回内联 bash（不委托） | 接线 + 使用测试环境/串行 watchdog + 预算挂实测 + 自证块必须在 bash | CAUGHT 4/4 |
| T8 | 摘掉逐片 `elapsed=` 打印 | report 必须打印逐片 elapsed 与复测入口 + 审计的同缝锚 | CAUGHT 2/2 |
| T9 | 摘掉时间戳剥离（审计读真日志） | 逐片墙钟的锚必须只认新形状 | CAUGHT |
| T10 | 零样本不再短路（读成通过） | 三档退出码各自可达 | CAUGHT |

驱动自己的两处错（不是被测代码的错，必须留证）：
1. **首轮 T5/T6 误报 MISSED**：期望清单里点名了住在**另一套**里的锁，而驱动只跑"改动所在的那套" ⇒ 那条锁结构性不可能命中。改法是每刀跑全套取并集，而不是把期望改窄。
2. **T4 锚写多一层转义**（`\\\\t`）→ 匹配的是 `\\t` 而源文件是 `\t` ⇒ `ANCHOR_MISS`。为此给驱动加了 `MP_PREFLIGHT=1` 一趟：**先验 10 条锚再烧 15 分钟**（preflight 当场抓到这一条，避免了一次整轮白跑）。
3. 另记一条判据分工：T9 只让"带时间戳的真实行"那条锚红，生产者↔消费者的同缝锁对这一刀**结构性免疫**（它喂的是 `runStep` 原文，不带时间戳）。这不是缺口 —— 一条锁测一个变量；如果为了让两条都红而把夹具改成带时间戳，同缝锁就不再在测"生产者真打印了什么"。

## 5. QM-6 双轴自演（按用户指定，非外部模型）

### 后端轴（正确性 / 边界 / 安全 / 规格合规）

| # | 发现 | 等级 | 处置 |
|---|---|---|---|
| B1 | `realSpawn` 的 `out` 有 32MB 上限，`slice(0, cap)` **静默截断** ⇒ `completed=` 计数可能偏小 | MINOR（不影响判定：rc 取自子进程退出码，verdict 与 rc 不受截断影响） | 就地加注释写明"截断只影响诊断计数"，并登记为遗留（§6-②）；正解是流式计数而不是整份缓冲 |
| B2 | `kill` 抛错时该片仍按 `timeout` 归档，日志里没有"杀不掉"这件事 | MINOR | 保留该语义（杀不掉仍越墙，改判成 crashed 会把墙读成工具坏），但注释写明理由，不静默 |
| B3 | `spawn('pnpm', argv, {shell: win32})` —— shell:true 历来是注入面 | INFO | 参数全是脚本内常量旗标（`--shard=i/n` 由整数拼接），无任何用户输入；注释已写明该边界 |
| B4 | 「两片并行」这件事在测试里由 `started.length===2` 断言，位置在 settle 回调 | INFO（曾错） | 第一版把断言写在 spawn 回调里 —— 那测的是"我调用了几次"而不是"两片是否同时在跑"，已移到 settle 并留注释 |

### 前端轴（模式 / 可维护性 / 集成风险）

| # | 发现 | 等级 | 处置 |
|---|---|---|---|
| F1 | **`workflow-contract.test.js` 的覆盖面下界真实拦下一次**：委托判据取**第一个** `node scripts/*.js`，而我写的注释里"复测入口 node scripts/electron-ci-shard-audit.js"排在前面 ⇒ `electron-tests` 整片消失，读数 `2 < 3` | **MAJOR（已修）** | 正解不是改注释措辞：判据改为扫**全部**候选按语义判定（`matchAll`，不用带 `g` 的 `.test()` —— 那是有状态的，同仓踩过），并补双向对照（遮挡形态必须 true、只有非桌面脚本必须 false） |
| F2 | 预算数字同时出现在 workflow 注释与脚本里，注释会变成过期陈述 | MINOR | 注释只写"唯一真源是脚本 + 判据是什么"，数字改由 `STEP_BUDGET_MS` 持有；锁按**变量名** `BUDGET_SECONDS=` 而不是数值判残留（写死 2100 的那版在预算改 2700 后会被 T7 绕过） |
| F3 | `runStep` 的等待块形如 `while (…) { … break }`，实际只等一轮 | MINOR（异味） | 未在本片收敛：改动落在 T2/T8 锚的邻域，会让"ALL_CAUGHT 对 shipped 文本成立"这条证据重新变脏。登记为遗留（§6-③） |
| F4 | 两个新脚本 + 两个新测试文件都落在 `scripts/`，而第 106 行 `scripts/*.js` 静默忽略新建脚本 | MAJOR（已在写代码时避免） | 两条 `!scripts/*.js` 反选 + 反选在位断言（同族第 5/6 次，症状是本地全绿、CI 上 `Cannot find module`）；`.gitignore` 里注释一律 `#` 开头 —— 本轮确实先误写成 `! 说明文字`（三条永远匹配不到的坏模式），由审计的接线锁顺手钉成判据 |

## 5.1 CI 现场红一条（本机绿、CI 红 ⇒ 归因按"这一维可否本地配置"）

首跑（run `39612728047` / job `119265564600`，ubuntu `changes` job）红在：

```
not ok 8 - realSpawn 必须真能把 pnpm 起起来（win32 上 pnpm 是 .cmd shim，不 shell 就 ENOENT）
  error: pnpm --version 必须真的退出 0；实际 {"rc":null,"signal":null,"timedOut":false,"stdout":"",
         "error":"spawn pnpm ENOENT"} ⇒ argv/shell 的组合在本机就不成立
```

| 问 | 答 |
|---|---|
| 是被测代码坏吗 | **不是**。`spawn pnpm ENOENT` 在这里是**那台 runner 上没有 pnpm**，而 win32 的 `.cmd shim` 问题根本不存在于 Linux |
| 这一维可本地配置吗 | 可 —— 维度是「这个 job 装不装依赖」，而 `changes` job 按既有约定**不装依赖**（AGENTS：接进 changes job 的锁只能 require node 内置模块）。所以既不是"只有 runner 知道"，也不该记成欠账 |
| 两条正解里属哪条 | ②「期望该由实测推导」：先用本进程探一次 `which/where pnpm`，**按探到的能力选期望**，两条支路各自成立 |
| 怎么防止它变成"永远不测" | ① 每次跑打印 `platform= pnpmResolvable= resolvedTo= branch=`；② **win32 上解析不到 ⇒ 直接 FAIL**（那才是被测面），非 win32 缺工具时改判形态契约（`rc` 必须可读、不得抛）；③ 断言"realSpawn 自带 kill"与 shard 字段形态在两条支路里都无条件跑 |

同场并跑纪律：本轮第一次本地重跑撞上了变异驱动正在改文件，读出 `11 pass / 1 fail` —— 那不是被测代码红，
是**我在变异窗口里跑测试**。变异反证与本地验证必须串行，否则读数不可归属（本仓已有同型记录）。

## 6. 行尾与 diff 对账 / 遗留


（落地前当场重取，数值由 §7 的命令复现。）

| 项 | 读数 |
|---|---|
| 对账命令与结果 | `git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat` 逐文件**完全相同**（11 个文件，+764 / −60）⇒ 没有一行是"只因行尾变了"而进 diff 的 |
| 既有文件的 EOL 档位 | `i/lf w/crlf attr=text=auto`（`CHANGELOG.md`、`docs/electron-ci-step-budget-baseline.md`、两份 workflow、既有两份测试）——`CHANGELOG.md` 顶部插入按**文件自身行尾**物化（当场量得 crlf=23530、lf_only=0 ⇒ 取 CRLF），并自证 `MAIN_IS_TAIL=true`、块数 567→568、冲突标记 Δ=0（存量 5 处 `=======` 属历史记录，非本次引入） |
| 本片新建的 4 个文件 | 工作副本 LF；git 按 `* text=auto` 归一入库为 `i/lf` ⇒ 与主干形态一致；checkout 侧按仓库既有约定物化（`warning: LF will be replaced by CRLF` 是既有事实，不是本次改动） |

**遗留（不假装闭合）**

| # | 内容 | 归属 |
|---|---|---|
| ① | **并行争用倍数只有第一次 main push 真跑才知道**。预算 2700s 是按"给争用留一倍"拍的，不是实测。上线后必须跑 `node scripts/electron-ci-shard-audit.js`，`verdict=HUGGING/BELOW_FLOOR` 就按现场重定数 | 本片合并后的第一次 push（自动义务） |
| ② | `realSpawn` 的 32MB 缓冲上限会截断**计数用**的副本（不改判定）。正解是流式计数 | 未做，已加注释 |
| ③ | `runStep` 的 `while{…break}` 等待块可读性异味（实为单次等待） | 未做，理由见 F3 |
| ④ | issue #2458 档 4：`CI Failure Handler` 把「`exit 124` 且无摘要行」归类为 `ci-timeout-budget` | 未做，挂在该 issue |
| ⑤ | `docs/electron-ci-step-budget-baseline.md` 里 2026-10-20 那节的 matrix/汇入作业方案作为**历史事实**保留，只加了导航行；不改写历史 | 已按口径处理 |

## 7. 复测与取证命令（都可离线/在线重跑）

```
# 逐片墙钟与预算判定（三档退出码：0 支持 / 1 不支持 / 2 取不到数）
node scripts/electron-ci-shard-audit.js --runs=10

# 本片的三套锁
node --test scripts/electron-ci-desktop-step.test.js
node --test scripts/electron-ci-shard-audit.test.js
node --test .github/scripts/workflow-contract.test.js
(cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run tests/gui-ci-exit-contract.test.js)

# 静态门禁
node .github/scripts/check-workflow-structure.js
node scripts/check-unwired-tests.js
node scripts/check-step-failfast.js

# 归因读数（红趟到底是不是预算墙）
gh run list --workflow=electron-ci.yml --event=push --limit=12 --json databaseId,headSha,status,conclusion
gh api repos/{owner}/{repo}/actions/runs/<run_id>/jobs --paginate
gh api repos/{owner}/{repo}/actions/jobs/<job_id>/logs --allow-escape-sequences
```
