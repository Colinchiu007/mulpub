---
record: gate-budget-reprobe
task: Gate 测试预算贴脸（30 分钟墙）——按实测抬预算、收进单一真源、并留可重跑复测入口
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后按 `git log origin/main --grep='(#NNNN)$'` 取证回填
sync_backfill_owner: 本会话（若被压缩则由下一个会话接手本 slug）
---

## 本次执行记录：Gate 测试预算按实测抬高（gate-budget-reprobe，2026-10-11）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🔥 配置/工具 + 🧪 测试变更（混合 PR：`.github/workflows/quality-gate.yml`、`.github/scripts/workflow-contract.test.js`、`.github/scripts/check-test-microtask-spin.js` 注释、`.gitignore`、三个新建 `scripts/gate-budget*.js`、CHANGELOG 与本记录）⇒ 必须隔离：`powershell -File scripts/start-mp-task.ps1 -TaskName gate-budget-reprobe`，实证用 `git worktree list`（1 命中）+ `rev-parse --abbrev-ref HEAD`=`gate-budget-reprobe` + `rev-parse --short HEAD`=`bc209b000`（= 当时 origin/main tip，基线新鲜）。**参数面已变**：`-NoShell` 不存在、默认不开 shell（见"自纠"第 3 条） |
| 第一性原因（QM-5 ①） | PASS | 不是某次提交写坏了什么：**套件长过了预算**。字面量 `1800000` 抄在 workflow 两处（Gate 4 / shard），配 `timeout-minutes: 40`；观测上"成功样本贴着上限跑"（最大 29.9 分，离上限 7 秒）⇒ 这是设计时按当时时长定的数，从未随实测更新 |
| 逃逸链（QM-5 ②） | PASS | ①单元层——没有任何测试读过 workflow 里的时间预算；②门禁层——`Gate Result` 只汇总作业结论，看不出"红是因为用例坏还是因为墙到了"；③判据层——`# fail 0` 与 `##[error] exit 1` 同屏，读日志的人先看到 exit 1 就当成测试失败；④记录层——欠账/门禁清单里没有"预算是否仍站得住"这一项；⑤采集层——GitHub 只保留最新 attempt，重跑会把旧证据覆盖掉。**结论：没有任何东西在看"预算 vs 实际时长"这一对比，属测试场景缺失 + 审查盲区** |
| 系统性漏洞（QM-5 ③） | PASS | 具体到文件：`.github/workflows/quality-gate.yml` 的时间预算是**跨两处的手工副本**，且 `.github/scripts/workflow-contract.test.js` 把旧字面量钉成了契约——于是"改数字"这件事在仓库里等价于"同时改 3 个地方，少一个就恒红"，没有人敢改，也没人量过 |
| 修复 + 回归保护（QM-5 ④） | PASS | 单一真源 `scripts/gate-budget.js`（预算/job 上限/倍数/样本下限/出处/`checkSizing()`），workflow 两处改读注入值且取不到即 throw；新锁 `scripts/gate-budget.test.js` 7 条：判据自证（抬高观测最大值必须翻脸）、倍数与样本下限是红线、两处都走注入且旧字面量归零、fail-closed 结构锁、job 上限与真源相等且 ≥ 预算+前置+余量、探针字段与出处逐字段对齐、以及"别的锁不得把旧形态钉回来"。复跑 `7 pass / 0 fail`，同 PR `workflow-contract` **35/35**、spin 检查器 **7/7** 且本体 PASS（1254 文件） |
| TDD 红→绿 | PASS | 先写锁（workflow 未改）⇒ `tests 7 / pass 2 / fail 5`，五条各以预期理由红（注入缺失、fail-closed 缺失、job 上限不符、探针字段解析退化、contract 仍钉旧值）；另两条纯判据锁与 workflow 无关，本就该绿。实现后 ⇒ `7 / 7 / 0`。**中间一次假红是我自己的测试 bug**：① 探针字段切片用 `indexOf('}')`，被模板插值 `${pushIds.length}` 的右花括号提前截断（只数到 3 个键）；② 用正则去找"本身含反斜杠的正则字面量文本"，永远匹配不上。两条都改成按结构截尾 / 字面串 `includes`，不是放宽断言 |
| 变异反证（13 条，全实测点名） | PASS | M1 两处等待退回写死值 / M2 预算调成 10 分 / M3 两个 job 上限回 40 / M4 守卫弱化成只打日志（无失败语义）/ M5 守卫去掉 `-notmatch` / M6 探针删出处字段 / M7 安全倍数改 1.0 / M8 `workflow-contract` 钉回旧字面量 / M9 重新引入中文「30 分钟」/ M10 交换两个 per-job 前置字段 / M11 摘掉带内告警整块 / M13 只留告警文本、删掉一处赋值 / M12 截尾比较把分钟乘 60000 —— 13 条各自让**预期的那一条**点名变红，`MUTATION_BAD=0`、被改文件与备份 `Buffer.compare===0`、终态 `11/11`；汇总已落盘 `.ccg/reviews/gatebudget-mutations.txt`。**其中两条一度误报来自驱动脚本自己**：M5/M12 的"预期锁名"被我写成断言消息，且一次全局 `sed` 顺手改掉了 M2 的预期（非唯一锚点做全局替换）——都不是锁缺失，但都让结论错过 |
| 实测出处（定数依据，以探针可复现为准） | PASS | 坐标：workflow `306371582`，`push(branch=main) n=40 + pull_request n=60`，留档时刻 `2026-10-11T08:22:54Z`，`probe_errors=0`（非 0 则整批作废）。Gate 4 成功 69（两池合并；只算 push 面 33），min 17.6 / p50 27.9 / p90 29.4 / **max 29.88 分**（离 30 分上限 7 秒 = 贴脸）；截尾 prior **9** 次 / current 0 次（抬价后属预期）；shard 步级 **29.77 分**；两 job 前置均 **≤1.38 分**。**样本数随窗口漂移**（同一探针隔 90 分钟再跑得 66 而非 69），所以规则一律用"下限 + 比例档"表达，不写"必须等于某数" |
| 单位与定义的两处自纠 | PASS | ① `/6000` vs `/60000`（曾把分钟放大 10 倍报成"300.2 分"）：锁改成只查 `minutes()` 函数体本身，不再用"文件里出现过 `/ 60000`"这种可被别处顺带满足的形式。② **「前置开销」被我量错**：2.8 分是「job 总时长 − 步时长」，含的是步骤**之后**的清理；手工核对 job 起点→步起点两次为 1.18 / 1.38 分 ⇒ 出处改 1.38，结论 55 不变（45+1.38+5=51.38 → 向上取整到 5 的倍数）。③ committed 探针的 shard 面因 job 名**精确相等**（真名带 ` (2/2)` 后缀）而静默取到空集，却照样打印 `sizing_ok=true` —— 改 `test()` 匹配并加 `PROBE_EMPTY_SET` 零行即抛：否则"测了个空"会被读成"没发生" |
| 未改动项（防"顺手改") | PASS | `coverage` job 的 `timeout-minutes: 40` 保持原值（它没有 `WaitForExit` 站点）；`CI_IGNORED_PATHS`、分支保护、判据与用例集合**一字未动**。判据：`yaml.load` 实跑打印 `jobs=10 unit-tests.timeout=55 shards.timeout=55 coverage.timeout=40` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/**`、`packages/rpa-engine/**` 与任何前端文件 |
| 其余门禁 | PENDING | `check-step-failfast` OK、`check-unwired-tests` OK（检查域 72 个，新锁已接进 `QG Static` 的 Gate 3）；`check-gate-record-debt` OK（本记录走新载体三字段，**未**往 ledger 加键）；`check-no-brand-residue` / `classify-docs-only` / `check-pr-exec-record` 待提交后跑并回填本行 |
| 行尾与 diff 对账 | PASS | 动手前实测：workflow / contract / spin 注释 / `.gitignore` 均 `crlf=行数`（纯 CRLF），三个新建文件为 LF；每个编辑脚本写完即断言"行尾不得由 LF 转为 CRLF、混行尾即抛错"，最终 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径同数 |
| QM-6 CCG 双模型外部评审 | PASS（两轴均已执行并处置） | 替代通道（CC Switch `:15721` 实测 `Quiet=False`，两个 primary 都在它上面）：逻辑轴 `opencode/nemotron-3-ultra-free` ⇒ `.ccg/reviews/gatebudget-logic.json` 8 条（2C/2W/4I）；可维护性轴 `opencode/ling-3.1-flash-free` ⇒ `.ccg/reviews/gatebudget-maint.json` 7 条（5W/2I）。逐条对自己取证：① 两轴独立命中的「截尾阈值绑当前预算」成立且当场复现（`gate4CensoredN=0 ⇒ sizing_ok=false`，即 CHANGELOG mandated 的复测在健康态必红）⇒ 阈值改绑 `priorBudgetMin`、字段拆 prior/current、"要求截尾证据"只在贴脸档生效；② logic 轴 Critical#6 **不接受**：它担心的"只改常量不改 YAML"已被 M3 变异实测拦下；③ logic 轴 Info#4 机制被**当场否证**（`[int]"NaN"` 在 PowerShell 是抛 RuntimeException，不是变 0），但它建议的 `-notmatch '^\d+$'` 仍采纳——空串走 `[int]` 才是 0；④ maint W1 是本轮最有价值的一条：我的锁只匹配英文 `/30-minute/`，而 `:633`、`:739` 两处**中文「30 分钟」**从盲区穿过 ⇒ 判据扩成 `/30\s*(?:分钟|minute)/` 并清掉两处旧自述（M9 实测重新引入必红）；⑤ maint W3 同类：fail-closed 原本只看"有没有 if"，`{ Write-Host }` 弱化形态能过 ⇒ 要求窗口内含 `throw|exit`（M4/M5 各测一档）；⑥ maint W2 采纳：把"贴脸只在手动探针"补成 **CI 带内告警**（两 job 各三条赋值 + warning，阈值与 WARN_RATIO 同档；M11 测整块摘掉、M13 测只留文本删赋值）；⑦ maint I4/I5 成立：删死常量 `OVERHEAD_ALLOWANCE_MIN`、注释算式与代码对齐，变异汇总落盘 `.ccg/reviews/gatebudget-mutations.txt` 供独立复核；⑧ maint I6 的 vendored 模板（`quality-gate.yml.tpl:76`、`shard-matrix.yml.tpl:45`）确认仍带旧字面量，属上游技能制品 ⇒ 登记遗留、不在本 PR 动 vendored 镜像。两轴产物落盘后才动盘（串行）。 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin gate-budget-reprobe` 返回 0 行证远端分支已删；回填与删除上面三个 `sync_*` 字段必须同一次提交 |

### 为什么这个 PR 建议人工过目（而不是自动合并）

它不改判据，但改的是**守门流程本身允许跑多久**：`QG Unit Tests` 与 `QG Desktop Shards` 的 `timeout-minutes` 从 40 抬到 55，
一次挂死的测试套件会从 30 分钟就暴露变成 45 分钟才暴露，Windows runner 的占用时间同步变长。
AGENTS.md 的禁止清单原文只点名"分支保护规则本身"与 `CI_IGNORED_PATHS` 两类，这条不在字面范围内；
按"改谁来守门"的精神我判定它需要人看一眼，所以 CI 全绿后停在这里等确认。

### 遗留（不假装已闭合）

- M10 变异（交换两个 per-job 前置字段）在 1.38 == 1.38 之后是**数值空操作** ⇒ 只看数值的判据抓不到它。补的是**按名字的结构性锁**（`JOB_OVERHEAD_FIELD` 必须逐 job 指名不同字段，且两个字段名不得相同）。一般化：当两个来源的量恰好相等时，"靠值不同来意外暴露口径错误"不成立，口径必须显式钉名字。
- **45 分钟仍是待证实的假设**：7 次被杀的样本是截尾的，真实需求的上界这份数据给不出来。正解是合并后跑一次
  `node scripts/gate-budget-probe.js --check`（退 2 = 贴脸，要再抬或改分片；退 1 = 规则不再满足）。
  我没有为了"看起来闭合"把预算直接抬到 60 分钟——那同样是没量过的数。
- **根因没解决**：套件在长。`test:all`（非桌面全量）与两个 shard 都在 30 分钟档贴脸，下一次长到 45 分钟档还红，
  而终局修法是把 Gate 4 按 nx 项目分片并行（用户在 A/B 里选了 A）。本 PR 只保证"红灯不再因为墙到而说谎"，并留下复测入口。
- 贴脸预警目前只落在复测入口脚本里（手动）。CI 自身还没有"每次跑完打印 elapsed/预算 比值并出声"的步骤——
  加它要在 `Gate 4` 末尾多一步断言，属再一次 CI 改动，本 PR 不叠。
