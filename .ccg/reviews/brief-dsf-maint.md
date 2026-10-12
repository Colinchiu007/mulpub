# 评审任务书（可维护性/模式/集成风险轴）— PR #3357 desktop-shard-flag

## 你在审什么

分支 `desktop-shard-flag`，仓库根 = 当前工作目录，head `b680f413044f85b03cd03c6b317324004b025fa5`（PR #3357）。
新增文件：`scripts/check-desktop-shard-forwarding.js`（判据，三层）+ `.test.js`（10 条锁）+
`.ccg/reviews/shardflag-mutate.driver.js` / `shardflag-ps3state.driver.js` / `shardflag-ps-parse.ps1` 及两份产物；
改动：`quality-gate.yml`（Gate 3 接线 + 删裸 `"--"` + 一段位置纪律注释）、`.gitignore`（两条 negation）、
CHANGELOG 顶部一条、`openspec/records/desktop-shard-flag.md`。

可跑的**只读**检查：`node --test scripts/check-desktop-shard-forwarding.test.js`、
`node scripts/check-desktop-shard-forwarding.js`、`node scripts/check-unwired-tests.js`、
`node scripts/check-step-failfast.js`、`node scripts/check-gate-record-debt.js`、
`node .github/scripts/check-max-lines.js`（若存在）。

## 必须逐项回答（每条给"文件:行 + 实测/读数"；没有发现也要明确写 NO_FINDING）

1. **职责边界**。本仓已有 `scripts/gate-budget.js`、`scripts/check-gate4-selection.js`、
   `.github/scripts/workflow-contract.test.js` 三件同族判据。请判定新文件与该三者的边界是否清楚：
   ① 是否有重叠判据被抄成第二份（特别是"workflow 里不得出现裸 `--`"这条，现在一共在几处、口径是否一致）；
   ② "不重复造判据"那条锁（读 `workflow-contract.test.js` 源码找反向断言）是**行为锁**还是**记录性断言**，
   它能否挡住对方把那行改掉。
2. **命名与单一真源**。`findContinuationSevers` / `checkContinuations` 这层能力（"扫描 workflow 正文的
   PowerShell 语法相邻性"）是否应该是 `check-desktop-shard-forwarding.js` 的私有函数，还是该抽成共享模块
   供其他 workflow 判据复用？给出你的判据标准（本仓惯例是"两处用到才抽"，请用实测说明现在有几处用到）。
3. **注入缝的代价**。`check({ root, probe = runArgv })` 为了锁"负控失效"而开了注入点。
   请评估：① 是否留下"生产调用点传了假 probe"的风险，有没有东西在看；
   ② 更轻的替代（例如把负控判据拆成纯函数 `evaluateControl(control)`）是否更可维护，代价是什么。
4. **原件可重跑性**。`shardflag-mutate.driver.js` 与 `shardflag-ps3state.driver.js` 是否真能从仓库直接重跑：
   ① 有无写死的绝对路径；② `ps3state` 依赖 `js-yaml` 与 `pwsh` —— 请核它被接进了哪个 CI job
   （如果没有接进任何 job，是否可接受，以及"只在本地能跑"的证据强度如何）；
   ③ 驱动是否**幂等**（重复跑会不会把 CHANGELOG/workflow 留在变异态）。
5. **注释与散文的可维护性**。workflow 里那段"位置纪律"注释、脚本 docblock、记录里的表格行都写了同一条
   三态实测结论。请判定：数值（334/34/324、873、29.77）散落在几处文档，漂移风险由什么守住；
   哪些应只留"指针 + 结论"，哪些必须留数字。**不要**建议删掉缺陷账（那是本仓的记录纪律）。
6. **门禁登记一致性**。记录 frontmatter 的三个 `sync_*` 字段 + `远程同步 | PENDING` 行 +
   `QM-6 | PENDING` 行是否满足本仓"回填与销账必须同一次提交"的口径；
   `check-gate-record-debt` 现在 OK（请实跑确认），若有人把 `远程同步` 状态列写成 `PENDING→PASS` 这类复合箭头，
   门禁会不会红（请引用该脚本的词表判据行号）。

## 硬约束

- **只读**。不得修改、创建、删除任何文件；不得 `git commit/checkout/reset`、不得跑变异脚本、不得跑 pnpm install。
  只允许 `git show/diff/log`、读文件、跑上面列出的只读检查。
- 结论**必须全部打进 stdout**，每条一行，格式 `SEVERITY | 文件:行 | 问题 | 建议`，最后 `TOTAL=<条数>`。
  若选择写文件，只准写 `.ccg/reviews/dsf-maint.json`，且 stdout 仍要有同样结论。
- 标签要诚实：不确定写 INFO，不要把"我核过了没问题"标成 CRITICAL/MAJOR。
