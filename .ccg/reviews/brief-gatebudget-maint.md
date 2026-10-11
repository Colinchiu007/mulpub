审查一个混合 PR（CI 执行预算 + 门禁接线）。工作区根＝当前目录（git worktree，分支 `gate-budget-reprobe`，head 短 sha `6698db402`）。

被审改动＝`git diff $(git merge-base HEAD origin/main)...HEAD`，共 9 个文件：
`.github/workflows/quality-gate.yml`、`.github/scripts/workflow-contract.test.js`、
`.github/scripts/check-test-microtask-spin.js`（注释）、`.gitignore`、
新建 `scripts/gate-budget.js` / `scripts/gate-budget-probe.js` / `scripts/gate-budget.test.js`、
`CHANGELOG.md`、`openspec/records/gate-budget-reprobe.md`。

主张：main 连续两次 push 红在 `QG Unit Tests → Gate 4` 而断言层 `# fail 0`，真因是 30 分钟预算小于套件耗时；
于是按实测抬到 45 分（job 上限 55 分），数字收进单一真源，并留一个要 gh 的复测脚本。

轴二：**可维护性 / 测试质量 / 集成风险**（不是代码风格）。重点找：

1. "单一真源"是不是**名副其实**：数字仍存在于几处？`scripts/gate-budget.js` 的常量、workflow 里的
   `timeout-minutes: 55`、记录/CHANGELOG 里的叙述，四处之间的真相关系是否被锁住；
   若有人只改其中一处，会在**什么时候**、以**什么措辞**变红。特别注意
   `timeout-minutes` 是 YAML 字面量而预算是 JS 常量，这个不对称是否留下漂移面。
2. 新锁 `scripts/gate-budget.test.js` 的**可绕过性**：它读 workflow 文本做正则匹配——
   插入位置改动/缩进变化/注释里的同名字样会不会让它假绿或假红；"取数点之后必须判 `$LASTEXITCODE`"
   这条结构锁的窗口大小（只看后 2 行）够不够；探针字段解析的截尾方式是否稳。
3. **复测入口不进 CI** 的后果：`scripts/gate-budget-probe.js` 靠人跑。作者自己承认"贴脸预警目前只在手动
   脚本里"。请判断这是否等于"这次的核心指标（预算 vs 实际时长）没有看守"，并给一个能落地的最小方案。
4. 三处叙述（CHANGELOG 条目 / 执行记录 / PR 正文）与代码是否**互相同一件事说三种话**，
   以及有无把"没做"写成"做了"。特别核：记录里写的 `MUTATION_BAD=0`、`7/7`、
   `workflow-contract 35/35` 这类数字，你能否从仓库现场判断它们可信度（不必复跑，指出证据链是否闭合即可）。
5. 这次改动会不会让**别的既有机制失去读者**（例如某个依赖 30 分钟假设的注释/断言/文档、
   或依赖"job 上限 40"的并发额度估算）。

输出：JSON 数组写到 `.ccg/reviews/gatebudget-maint.json`，每项
`{severity:"Critical|Warning|Info", file, line, issue, fix}`，最多 8 条，无发现写 `[]`。
**文件是唯一验收物**；每条必须给你实际读过的文件与行号。
