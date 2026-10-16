## Why

`.ccg/reviews/*.json` 是 CCG 判定器与深度评审引擎的落盘产物。上一个 PR（`fix-precommit-reviews-spawn-storm`，#3688）拆掉了「提交耗时随记录数线性增长」这条放大器，但**产物本身的治理是空白**：它无界增长、写一次永久保留、并且按父提交 sha 命名会跨会话互相覆盖。

### 实测现场（2026-10-16 本机，数值为时点数、会自增）

| 判据 | 实测值 | 复跑手法 |
| --- | --- | --- |
| origin/main 树内 `.ccg/reviews` 受管文件 | **733**（同日上一 PR 文档记的是 659 ⇒ 确在自增） | `git ls-tree -r --name-only origin/main -- .ccg/reviews \| wc -l` |
| 本机 worktree 数 | **38**（自增） | `git worktree list \| wc -l` |
| 磁盘体积 | 约 0.9 MiB（**不是**成本所在） | `du -sh .ccg/reviews` |
| 在飞 open PR 中变更集带 `.ccg/reviews` 文件的比例 | **13 / 15**（2026-10-16 复取） | `gh pr list --state open --json number` + 逐个 `--json files` 计数 |

### 三条真实成本（体积不在其中）

1. **每检出一个 worktree 就继承全量**（733 × 33），而其中绝大多数对该分支毫无意义。
2. **写一次、永久保留**：判定记录是一次性产物，squash 合并后按 HEAD sha 寻址的文件永不再被引用，却永久留在版本树与历史里。
3. **按父提交 sha 命名 ⇒ 跨会话撞名**：两个会话站在同一个 main tip 上提交，会生成**同名**记录，后来者静默覆盖前者（实测 M 而非 add/add），审计留痕在无人知晓的情况下丢失。

### 为什么不能「直接 gitignore 掉」

`scripts/check-pr-exec-record.js` 的深度审查欠账判据**读的就是这些文件的工作树副本**。硬切存档面，会把上面 5 个在飞 PR 的 dual 守卫**静默撤掉**（它们不可能有尚不存在的替代字段）——这是本仓反复出现的「判据比现实窄 ⇒ 门禁变装饰」的同型错误。所以必须先换判据的数据源，再动存档面。

## What Changes

本 PR 只做**刀 1**：把深度审查的闭环判据从「仓内 json」换源到「执行记录台账」，并给台账加一枚**可机器重算的防伪锚**；旧 json 在一个双读周期内继续生效。

- 新增 `scripts/lib/ccg-evidence-hash.js`：载荷哈希定义、台账字段清单、frontmatter 就地改写、证据评论正文——**写入侧与判据侧共用一份实现**。
- 新增 `scripts/ccg-record-ledger.js`：深度评审收口后贴一条 PR 证据评论（并从 GitHub 读回确认），成功后才回写 `openspec/records/<分支>.md` 的 `ccg_*` 字段。
- `scripts/deep-review.sh`：引擎跑完后调用上述收口；收口失败只出声不改判（强制力在判据那一侧）。
- `scripts/check-pr-exec-record.js`：`evaluateDeepReviewDebt` 改为**新源优先 + 旧源兜底**，并复核证据锚（状态词 ∈ 闭环白名单、URL 指向具体 PR 评论、载荷哈希与锚记录的 base 重算一致）。
- `quality-gate.yml` 新增 Gate 2b4（`changes` 作业，`shell: bash`）点名两份新测试。

**不在本 PR**（明确记为欠账，见 tasks「刀 2/刀 3」）：`.gitignore` 排除 `.ccg/reviews/**`、一次性 `git rm --cached`、常驻清理节拍与保留窗口、引用面解析门禁。这两刀是在改「谁来守门」，按 AGENTS.md 必须人工过目，不由 agent 自动合并。

## Impact

- **受影响的既有能力**：`commit-hook-record-staging`（钩子仍写 json，语义不变）；深度审查欠账判据（取值源变了，行为在双读周期内向后兼容）。
- **回归面**：`scripts/check-pr-exec-record.test.js` 61 例（含 13 例刀 1）、`scripts/lib/ccg-evidence-hash.test.js` 11 例、`scripts/ccg-record-ledger.test.js` 11 例、`scripts/deep-review-deps.test.js` 13 例（改 `deep-review.sh` 尾段后必须跑）。
- **用户可见影响**：无。全部落在开发流程工具链，不触打包产物与渲染层。
