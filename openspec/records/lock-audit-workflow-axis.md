---
record: lock-audit-workflow-axis
task: 给锁预算复测脚本的采样域补上第二轴（workflow 坐标），并把二元组判据锁死
date: 2026-10-21
---

## 本次执行记录：锁预算复测脚本的采样域补上 workflow 轴（lock-audit-workflow-axis）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（`scripts/` 判据本体 + 其回归锁 + `test-helpers/` + `docs/`）；隔离 worktree `mp-lock-audit-workflow-axis` / 裸分支 `lock-audit-workflow-axis`，经 PR 落地 |
| 第一性原因（QM-5 ①） | PASS | `scripts/lock-timing-audit.js:40` 持有 `const WORKFLOW = 'quality-gate.yml'` 单坐标常量，采集端只列这一个 workflow；上一片（#4072）只扩了**作业名轴**，workflow 轴写成注释里的「本片未扩」 |
| 逃逸分析（QM-5 ②） | PASS | ① **单元层**：旧 A/B 那条锁只测 `JOB_RE.test(name)`（作业名轴），二元组的另一维在它的夹具里根本不可表示 ⇒ 组合红不可达；② **集成层**：`--runs=26` 跑通并打印 samples=410，「采到了东西」把「采自半个域」盖住；③ **审查层**：上一片把边界写进注释而不是写进判据，读的人只看到一句自述，没有任何东西在它不成立时变红 |
| 系统性漏洞定位（QM-5 ③） | PASS | 「采样域是按**单一坐标**硬编码的，而真跑夹具的坐标集无人登记」—— 与 `case-timeout-audit.js` 那片同根，差别只在这一维漏了**不会让样本数变少到可疑**：另一个 workflow 的样本被静默归零，总数照报，且与「那个 workflow 恰好没跑」逐字同形 |
| 修复 + 回归保护（QM-5 ④） | PASS | 登记表 `PRODUCERS` + `isProducer(workflow, jobName)` + `producerWorkflows()` + `pickProducerJobs()`；采集端按 workflow 逐个列 run，PARTIAL 按轴点名。回归锁在 `apps/desktop/electron/services/windows-file-lock.test.js`（已点名进 `quality-gate.yml` Gate 2b），24 → **25 passed** |
| 防止再次发生（QM-5 ⑤） | PASS | ① 二元组 A/B：同名作业跨 workflow 的四个错配组合必须**不命中**；② 结构面双向锚：列 run 必须出现在 `for (const wf of producerWorkflows())` 循环体内，且 `listRuns('` 字面量写法一律判红；③ `const WORKFLOW = 'quality-gate.yml'` 残留即红 |
| 行尾与 diff 对账 | PASS | 四个被改文件均为 `i/lf w/crlf attr=text=auto`；新增行逐条带 `\r`；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（见下表） |
| 接线棘轮 | PASS | 本片刻**未新增测试文件**（新锁加在既有 `windows-file-lock.test.js` 内），`check-unwired-tests.js` rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 运行时代码与 UI 文件；改动全在 CI 复测工具与锁 |
| QM-6 CCG 双模型外部评审 | 自演，非外部模型 | 按用户指定「QM-6 你自己来模拟外部评审」执行，两轴逐条自审见 §3。**如实标注：这不是外部模型产出，不得当作双模型证据登记**；本机 CCG 未安装（pre-commit 打印「未找到 CCG（run_skill.js），已跳过」），机械闸门对本 PR 无从判红 |
| 远程同步 | 由门禁推导 | 本行状态列不手写状态词，由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 文档同步 ✅ | 品牌残留 ✅ | 债务基线 ✅ | 远程同步 PR #TBD

## 1. 现场取证：workflow 轴到底产不产样本（不是推断，是取的数）

**取证坐标**：`electron-ci.yml` main push run `39569099718` / job `119118831343`（步骤「Unit tests (Vitest, non-Electron, single-worker deterministic)」），
日志经 `gh api --allow-escape-sequences` 取回，剥 ANSI 后用**夹具自己那份** `parseTimingLine` 解析（不另写正则）：

| 指标 | 实测值 |
|---|---|
| `[windows-file-lock]` 总行数 | 11 |
| `mock=true`（单元用例注入的假握手） | 4 |
| **`mock=false`（真跑产出的样本）** | **7** |
| 无标签（legacy）行 | 0 |
| 真样本 max | 4282ms |
| 真样本 min | 343ms |

⇒ 该作业**真跑本夹具并产真实握手**，扩面前一条都采不到。取证命令可重跑：
`node /d/tmp/p293-measure.js <job 日志路径> electron-tests`（一次性探针，未入库；入库的复测入口是 `scripts/lock-timing-audit.js`，它现在自己就覆盖这一维）。

## 2. 扩面前后对照（同一条命令，只差 `--runs=8`）

**A 臂 · 扩面前**（单坐标 `quality-gate.yml`）：`by_job` 只含三个 quality-gate 作业族，`electron-tests` 不出现在读数里 —— 而它并不是「不存在」，只是没被列。

**B 臂 · 扩面后**（2026-10-21 当场实跑 `node scripts/lock-timing-audit.js --runs=8`，rc=0）：

```
[lock-timing-audit] domain=electron-ci.yml,quality-gate.yml pages=2 runs_total=16 jobs=32
  samples=168 mock_lines=96 legacy_lines=0
  by_job={"electron-ci.yml/electron-tests":56,
          "quality-gate.yml/QG Desktop Shards (2/2)":32,
          "quality-gate.yml/QG Coverage":56,
          "quality-gate.yml/QG Desktop Shards (1/2)":24}
  ready.p50=185ms ready.max=10933ms errors=0
当前 DEFAULT_READY_TIMEOUT_MS=45000，要求 ≥ max×2=21866
OK: 预算余量成立（headroom=4.12×）
```

三条必须一起读的结论：
1. `electron-ci.yml/electron-tests` 独贡 **56** 条真样本（8 run × 7 条），证明扩面在**采集端**真的穿过，不只是判据函数成立 —— 这是「注册≠注入≠生效」那一族的落点，所以这条必须实跑一次并贴现场。
2. `by_job` 的键现在带 workflow 前缀。不带前缀时，两个 workflow 里的同名作业会被并成一个数，样本来源不可归因；归因不了 provenance 就失去意义。
3. **本次读数 max=10933ms 低于既有 provenance 的 12762ms ⇒ 按不对称纪律不收紧预算**。定点窗口只有 8+8 run，它既不构成收紧依据，也不构成「扩面后 max 不会更高」的证据；长尾只会因窗口变窄而漏看，不会因「这次没看到」被否证。

## 3. QM-6 自演双轴发现与处置

| 轴 | 发现 | 级别 | 处置 |
|---|---|---|---|
| 后端（正确性/边界） | `isProducer` 若把缺坐标当通配，采集端字段漂移（`jobs` 响应里 `name` 缺席）会静默收下整个作业 | Warning | 已按「非字符串一律 false」实现，并有独立变异 Q7 守着（红在新锁） |
| 后端 | `pickProducerJobs` 丢掉 `status === 'completed'` 会把 in_progress 的作业送去取日志（取不到 ⇒ 归因成「探针坐标坏了」） | Warning | 行为锁 + 变异 Q6 |
| 后端 | 覆盖不足（PARTIAL）若合并成总样本数报，会把「electron-ci 一个 run 都没列到」摊进「quality-gate 采了 20 个」 | MAJOR | 改为 `shortWorkflows` 按轴点名，零样本出口另打印 `domain=` 整域 |
| 前端（模式/可维护性） | 登记表与注释分离：上一片把「第二层残缺」写成注释，注释不会在它变假时变红 | MAJOR | 本轮把这一维从注释转正为数据（PRODUCERS 一行），并把注释里那句「本片未扩」删掉；`docs/windows-lock-budget-provenance.md` §4 第 6 条同步改写，避免同源复述留下第二份过期口径 |
| 前端 | 旧 A/B 那条锁与新锁职责重叠 | Info | 不合并：旧条只测作业名轴（固定 workflow 坐标），新条测二元组与错配；两条各守一轴，注释里写明「不合并计一条」 |

## 4. 变异反证（Q1-Q8，驱动 `node /d/tmp/p295-mut87.js`，控制跑自证 `CONTROL_OK passed=25`）

| 变异 | 改的是什么 | 期望红 | 实测 |
|---|---|---|---|
| Q1 | `isProducer` 丢掉 workflow 等值判定（二元组退化成只看作业名） | 新锁 | CAUGHT 总红=1 未预期红=0 |
| Q2 | `PRODUCERS` 删掉 `electron-ci.yml` 那一行 | 新锁 | CAUGHT 总红=1 未预期红=0 |
| Q3 | `isProducer` 恒真（把扩面实现成扫所有作业） | 新锁 + 旧 A/B | CAUGHT 总红=2 未预期红=0 |
| Q4 | 采集端写死 `'quality-gate.yml'` 字面量绕过登记表 | 新锁（结构面正/反锚） | CAUGHT 总红=1 未预期红=0 |
| Q5 | `producerWorkflows()` 塌回单坐标 | 新锁（精确清单） | CAUGHT 总红=1 未预期红=0 |
| Q6 | `pickProducerJobs` 丢 status 过滤 | 新锁（行为面） | CAUGHT 总红=1 未预期红=0 |
| Q7 | 缺坐标读成通配 | 新锁（null 安全） | CAUGHT 总红=1 未预期红=0 |
| Q8 | `PRODUCERS` 常量改名（模块级变异，非定向） | 新锁 + mock 标签结构锁 + 旧 A/B + LEGACY_ONLY | CAUGHT 总红=4 未预期红=0 |

两条过程记录（都是驱动自身出错、不是被测面出错，改正的是**期望**不是断言）：

1. 第一版驱动把健康判据写成 `nfailed !== 0`，而 vitest 全绿时**根本不打** `Tests N failed` 段 ⇒ `nfailed` 为 `null` 被读成不健康，整轮报 `PROBE_BLIND` 不出结论。现改为 `passed === 25 && (nfailed === null || nfailed === 0)`。
2. Q2 第一版 ANCHOR_MISS：变异锚写了 `\n`，而该文件工作副本是 **CRLF**（`i/lf w/crlf`）。现驱动按文件真实行尾展开锚（`nl()`），同族第 N 次踩行尾，所以把归一化放进驱动而不是靠人记。
3. Q8 第一版只期望两条红，实测四条全红 ⇒ 这是**模块级**变异（改常量名让所有消费者一起炸），它的力度只证明「这几条锁都经过 PRODUCERS」，不证明各自守哪一格。定向的那两格由 Q1（丢 workflow 等值）与 Q5（清单塌回单坐标）负责 —— 期望已改正并在驱动注释里写明这一局限。

## 5. 遗留（不假装已闭合）

1. **扩面后的足量重测未完成**：本轮只做了 8+8 run 的定点复测。欠的动作是 `node scripts/lock-timing-audit.js --runs=26 --json` 并把输出整份回填 `LOCK_BUDGET_PROVENANCE`；若重测出**更高** max，必须同步抬 `DEFAULT_READY_TIMEOUT_MS` 与 `LOCK_CASE_TIMEOUT_MS` 的全部消费方。provenance 的 `source` 已把「这组数来自更窄的域」写成显式声明，避免下一个会话把下界读成分布。
2. **域本身仍由人工登记**：`PRODUCERS` 的 correctness 靠「有没有新增一个跑本夹具的作业却忘了登记」，本仓没有判据能发现它 —— 可发现的形态只能是「某作业产了握手行但不在域里」，而那要求先扫过所有作业，与「不得退化成扫所有作业」直接冲突。本轮选择：保留显式登记表 + A/B 负控，把这个残余缺口如实记在这里（同 `check-unwired-tests.js` 的「由人登记、由判据核对登记正确性」口径）。
3. **同族第三处**：`case-timeout-audit.js` 的作业名轴已在本轮之前扩过（#4086），它的 workflow 轴同样只有 `quality-gate.yml`。GUI CLI e2e 那条用例是否在 `electron-ci.yml` 的 `electron-tests` 里产出 verbose 行，**未取证** —— 取证方式与本片同形（取一份该作业日志数那条用例的行）。未取证不得扩面（把没量过的坐标写进域，会让样本来源同样无法归因）。
4. `electron-ci.yml` 的 `electron-tests` 作业今天在 main push 上因 2100s 步骤预算连红（`TIMEOUT_BUDGET_EXCEEDED`，非断言失败）。它与本片**无因果关系**（本片只改复测工具的读取端，不改 CI 执行编排），但它是本片采样能不能攒够窗口的上游约束：那一作业若长期跑不完，`mock=false` 的握手行数会随成功 run 一起减少。已另开任务处理。
5. QM-6 是自演（用户指定），**不构成**双模型外部评审证据；`check-pr-exec-record.js` 的 `evaluateDeepReviewDebt` 只看 `.ccg/reviews/<sha>.json` 的 status，「是否真的跑过外部模型」这一维度本仓仍无判据（AGENTS「残留风险」已记录）。

