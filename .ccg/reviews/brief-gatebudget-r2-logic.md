# 评审任务书（第 2 轮 · 逻辑/正确性轴）— PR #3313 re-sync 后的增量

## 你在审什么

分支 `gate-budget-reprobe`，仓库根 = 当前工作目录。第 1 轮评审已过 head `c5e606a06`。
**本轮只看这之后的两笔**：

- `003e3cdde` —— `git merge origin/main`（main 里含并发 PR #3315：Gate 4 的 `--exclude` 被独立 `--`
  转发吃掉、桌面全量混跑，对方把排除写进 `test:all:no-desktop` 并改了同一批行）
- `9705c40d3` —— 归因纠正 + 我把自己那条过宽禁令收窄

取证命令：`git show 003e3cdde`、`git show 9705c40d3`、`git diff c5e606a06..HEAD`。

## 必须逐项回答（每条给"文件:行 + 实测/读数"，不许凭印象）

1. **融合是否双向保留**：`.github/workflows/quality-gate.yml` 两个等待点（Gate 4 与 Desktop shard）现在是否
   同时具备①我方 `WaitForExit([int]$gateBudgetMs)` + 取数失败当场 throw，②对方 `$treeRows` 捕获 +
   `Write-TestProcessTreeDetail` 三个分支。有没有哪一侧在合并中被静默吃掉（尤其 `$testProcess.ExitCode -ne 0`
   分支和 timeout 分支的树打印是否都还在）。
2. **对方的选择集修复有没有被我改坏**：`$testArgs` 现在是否为 `@("run", "test:all:no-desktop")`（不带独立 `--`），
   `scripts/check-gate4-selection.js` 在 `Start-Process` **之前**跑、且其 rc 被显式判（pwsh 步骤不自动中止）。
3. **收窄后的锁到底在测什么**：`scripts/gate-budget.test.js` 里"非注释行不得把时长写成字面量 + 两处超时文案必须
   插值 `$gateBudgetMs`"这三条判据，是否存在可被绕过的写法（例如把数字放进 `^\s*#` 开头的行、放进
   `exceeded its` 之外的文案、或只改一处而使另一处静默失守）。请构造**具体**绕过串并说明它现在红不红。
4. **定数结论是否被证据支撑**：`scripts/gate-budget.js` 说"45 分钟自始至终由 shard 侧绑定"。请核
   `PROVENANCE`（shard 29.77 / ×1.5=44.6）、`checkSizing()` 的 `HARD_RATIO/WARN_RATIO` 与该结论是否自洽；
   以及"Gate 4 修复后样本 n=1 不足以收紧"这句是否与该文件自己写的 `MIN_SAMPLE_GATE4_SUCCESS` 一致。
5. **归因改写有没有留下互相矛盾的两份自述**：同一件事现在写在 `scripts/gate-budget.js` docblock、
   `openspec/records/gate-budget-reprobe.md`、`CHANGELOG.md` 三处。请逐处读，指出任何一处仍在说
   "套件长过 30 分钟"或任何与"Gate 4 修复后 94 秒 / shard 侧才是约束"冲突的旧句。

## 硬约束

- **只读**。不得修改、创建、删除任何文件；不得运行 `git commit/checkout/reset`、不得跑变异脚本。
  只允许 `git show/diff/log`、读文件、跑现成的**只读**测试（`node --test scripts/gate-budget.test.js` 等）。
- 结论**必须全部打进 stdout**（不落文件也行），格式：
  每条发现一行 `SEVERITY | 文件:行 | 问题 | 建议`，最后给 `TOTAL=<条数>`。
  若你选择写文件，只准写 `.ccg/reviews/gatebudget-r2-logic.json`，且 stdout 仍要有同样结论。
- 不确定的地方写"未验证"，不要推断成事实。**没有发现也要明确写 `NO_FINDING` 并说明你实际读了哪些文件。**
