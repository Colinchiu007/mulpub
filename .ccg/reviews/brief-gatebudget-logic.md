审查一个混合 PR（CI 执行预算 + 门禁接线）。工作区根＝当前目录（git worktree，分支 `gate-budget-reprobe`，head 短 sha `6698db402`）。

被审改动＝`git diff $(git merge-base HEAD origin/main)...HEAD`，共 9 个文件：
`.github/workflows/quality-gate.yml`、`.github/scripts/workflow-contract.test.js`、
`.github/scripts/check-test-microtask-spin.js`（注释）、`.gitignore`、
新建 `scripts/gate-budget.js` / `scripts/gate-budget-probe.js` / `scripts/gate-budget.test.js`、
`CHANGELOG.md`、`openspec/records/gate-budget-reprobe.md`。

这个 PR 的主张：main 连续两次 push 红在 `QG Unit Tests → Gate 4`，但断言层是 `# fail 0`，
真因是"30 分钟预算小于套件实际耗时"。作者据实测把预算抬到 45 分、job 上限抬到 55 分，
并把数字收进 `scripts/gate-budget.js`。

轴一：**正确性 / 边界 / 判据是否被悄悄改宽**。重点找：

1. 抬预算之后，**"超时"这件事还看得见吗**？会不会出现"挂死 45 分钟才红"或"挂死后仍被判成功"。
   具体核 `WaitForExit([int]$gateBudgetMs)` 之后的分支、`$testProcess.ExitCode` 判定、
   以及末尾的运行时出站台账判定位置有没有被挪走/变成不执行。
2. `[int]$gateBudgetMs` 的类型与取值：node 打印的是字符串，`-not $gateBudgetMs` 与
   `[int]` 转换在 PowerShell 里各自的行为；空串 / 非数字 / 多行输出会怎样。fail-closed 是否真的 fail。
3. `checkSizing()` 的判据会不会**恒真**：样本量、截尾计数、倍数三处任一为 0/缺失时的结果。
   以及"把 max 算进 p90 而不是 max"这类取数退化。
4. `timeout-minutes` 与内部预算的**耦合关系**是否还有别的隐含前提（例如 job 里还有别的重型步骤、
   或 GitHub 层的其它超时），作者只量了"前置 1.3 分 + 尾部 4 秒"，这个测量范围是否够。
5. 有没有借这次改动**放宽任何其它门禁**（对比 diff 里所有非预算相关的行）。

输出：JSON 数组写到 `.ccg/reviews/gatebudget-logic.json`，每项
`{severity:"Critical|Warning|Info", file, line, issue, fix}`，最多 8 条，无发现写 `[]`。
**文件是唯一验收物**；每条必须给你实际读过的文件与行号，不接受"可能/建议检查"式表述。
