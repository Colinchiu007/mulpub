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
| 变异反证（7 条，全实测点名） | PASS | M1 两处 `WaitForExit` 都退回写死值 ⇒ 注入锁点名红；M2 预算调成 10 分钟 ⇒ 判据锁红；M3 两个 job 上限都回 40 ⇒ 上限锁红；M4 摘掉取数后的 `$LASTEXITCODE` 判定（"装饰性装配"形态）⇒ fail-closed 锁红；M5 探针删一个出处字段 ⇒ 对齐锁红；M6 把安全倍数改成 1.0（用改判据消化矛盾）⇒ 红线锁红（连带判据锁）；M7 contract 钉回旧字面量 ⇒ 同口径锁红。收尾 `MUTATION_BAD=0`、四个被改文件与备份 `Buffer.compare===0` 逐字节相同、终态 `7/7`。**汇总脚本自己也错了一次**：`res` 元素是 `[名, 结果]` 二元组，我按 `m1.failed` 取值 ⇒ TypeError；修成 `m1[1].failed` 后才有 `MUTATION_BAD=0` 这行输出 |
| 实测出处（定数依据） | PASS | 采集器坐标：workflow `306371582`，`push(branch=main) n=40 / pull_request n=60`，时刻 `2026-10-11T06:52:51Z`，`probe_errors=0`（非 0 则整批数据作废，这是聚合探针自带的自检）。Gate 4 成功 n=33，min 17.6 / p50 27.9 / p90 29.4 / **max 29.9 分**；被杀 n=7（截尾，不进 max）；shard 步级 max 30.0 分；前置 max 1.3 分（shard 侧 2.8 分）。换算口径锁死 ms/60000 —— 本次采集第一版写成 /6000，把分钟放大 10 倍报成"300.2 分"，是靠"数字不可能超过 job 上限"这条常识反查出来的 |
| 单位换算自纠（同一件事的第二次） | PASS | 见上一条：/6000 与 /60000。已把 `/ 60000` 写成新锁的断言项之一（`探针里必须出现 / 60000`），并把这条纪律记进 `checkSizing` 的注释 |
| 未改动项（防"顺手改") | PASS | `coverage` job 的 `timeout-minutes: 40` 保持原值（它没有 `WaitForExit` 站点）；`CI_IGNORED_PATHS`、分支保护、判据与用例集合**一字未动**。判据：`yaml.load` 实跑打印 `jobs=10 unit-tests.timeout=55 shards.timeout=55 coverage.timeout=40` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/**`、`packages/rpa-engine/**` 与任何前端文件 |
| 其余门禁 | PENDING | `check-step-failfast` OK、`check-unwired-tests` OK（检查域 72 个，新锁已接进 `QG Static` 的 Gate 3）；`check-gate-record-debt` OK（本记录走新载体三字段，**未**往 ledger 加键）；`check-no-brand-residue` / `classify-docs-only` / `check-pr-exec-record` 待提交后跑并回填本行 |
| 行尾与 diff 对账 | PASS | 动手前实测：workflow / contract / spin 注释 / `.gitignore` 均 `crlf=行数`（纯 CRLF），三个新建文件为 LF；每个编辑脚本写完即断言"行尾不得由 LF 转为 CRLF、混行尾即抛错"，最终 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径同数 |
| QM-6 CCG 双模型外部评审 | PENDING | 本 PR 改的是 CI 执行预算与门禁接线，属 AGENTS.md「改谁来守门」的边界情形。串行纪律照旧：所有写型变异跑完才派两轴；结论与逐条处置在合并前追加 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin gate-budget-reprobe` 返回 0 行证远端分支已删；回填与删除上面三个 `sync_*` 字段必须同一次提交 |

### 为什么这个 PR 建议人工过目（而不是自动合并）

它不改判据，但改的是**守门流程本身允许跑多久**：`QG Unit Tests` 与 `QG Desktop Shards` 的 `timeout-minutes` 从 40 抬到 55，
一次挂死的测试套件会从 30 分钟就暴露变成 45 分钟才暴露，Windows runner 的占用时间同步变长。
AGENTS.md 的禁止清单原文只点名"分支保护规则本身"与 `CI_IGNORED_PATHS` 两类，这条不在字面范围内；
按"改谁来守门"的精神我判定它需要人看一眼，所以 CI 全绿后停在这里等确认。

### 遗留（不假装已闭合）

- **45 分钟仍是待证实的假设**：7 次被杀的样本是截尾的，真实需求的上界这份数据给不出来。正解是合并后跑一次
  `node scripts/gate-budget-probe.js --check`（退 2 = 贴脸，要再抬或改分片；退 1 = 规则不再满足）。
  我没有为了"看起来闭合"把预算直接抬到 60 分钟——那同样是没量过的数。
- **根因没解决**：套件在长。`test:all`（非桌面全量）与两个 shard 都在 30 分钟档贴脸，下一次长到 45 分钟档还红，
  而终局修法是把 Gate 4 按 nx 项目分片并行（用户在 A/B 里选了 A）。本 PR 只保证"红灯不再因为墙到而说谎"，并留下复测入口。
- 贴脸预警目前只落在复测入口脚本里（手动）。CI 自身还没有"每次跑完打印 elapsed/预算 比值并出声"的步骤——
  加它要在 `Gate 4` 末尾多一步断言，属再一次 CI 改动，本 PR 不叠。
