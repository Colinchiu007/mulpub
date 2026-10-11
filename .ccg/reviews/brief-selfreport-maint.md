审查一个混合 PR（changelog 门禁的输出与可测性修复）。工作区根＝当前目录（worktree，分支 changelog-gate-selfreport，head 5f5e88e50）。

被审改动：`git diff 3a4c70311...HEAD`（scripts/check-changelog-growth.js、changelog-dedup-regen.js、changelog-dedup-reconcile.js、两个测试文件、openspec/specs/changelog-ledger-integrity/spec.md、openspec/records/changelog-gate-selfreport.md、CHANGELOG.md）。

轴：**可维护性 / 测试质量 / 集成风险**（不是代码风格）。重点找：
1. 新加进 check-changelog-growth.test.js 与 check-changelog-duplicate-entries.test.js 的两条锁，
   断言是否**能被绕过**（例：从源码正则取 implemented 集合的锚点形状多脆弱；stdout 捕获有无恢复 console；
   夹具的临时目录/配置隔离是否会污染真实仓库或与其他用例互踩）。
2. 退休这条"单独成行"的输出与既有 PASS 行的关系：会不会出现"打印了退休但实际没走退休分支"这类可分离错误。
3. CHANGELOG 与主规格与记录三处叙述是否互相一致（同一件事三个说法＝未来的漂移源）。
4. 本次是否悄悄扩大了某个棘轮、或让某条既有锁失去读者。

输出：JSON 数组写到 `.ccg/reviews/selfreport-maint.json`，每项
{severity:"Critical|Warning|Info", file, line, issue, fix}，最多 8 条，无发现写 []。**文件是唯一验收物**。
