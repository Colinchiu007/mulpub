---
record: ccg-alt-form-producer
task: 让深度审查 alt 形态白名单跟上生产方真实投影，并补两条防退化的锁
date: 2026-10-18
branch: ccg-alt-form-producer
---

# 执行记录：alt 形态跟上生产方投影（ccg-alt-form-producer，2026-10-18）

## 0. 动因

`#3724` 的 §7.4 记过一次：判据的 alt 形态与生产方不一致，且**行为探测与判据同源于想象**所以永远自洽地绿。本轮先在当前 main 上重做探测——结论是**那处修法尚未落地**：`RE.test(生产方文件名)` 仍为 false，候选表里仍只有想象形态。于是把它切成独立的一刀，不等整条 PR 的函数重写。

## 1. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | `scripts/` 工具脚本（门禁本体）+ 文档，不触 `apps/`、`packages/` ⇒ 按分层判据不需独立 worktree |
| 落地方式 | 共享主工作区就地编辑 + 经 PR 落地（不直推 `refs/heads/main`）|
| 前置纠正 | 上一轮我把「隔离入口失败」归因成写保护任务未注册；实跑枚举证伪——`\Mulpub\Session Isolation Write Guard = Running`，我的两条探针（`Get-ScheduledTask -TaskPath 'Mulpub\'` 缺前导反斜杠、`schtasks //query` 被 git-bash 改写）都是**探针失明**。入口真正要求的是 `-RequireClean -RequirePrimary`，与写保护无关 |

## 2. 实现

- `AUDIT_ARTIFACT_RE`：alt 时间戳分支扩为 `(?:\d{8}T\d{6}(?:\.\d{1,3})?Z|\d{4}-\d{2}-\d{2}T\d{9}Z)`（想象形态保留，删它会让历史 alt 记录变夹带）
- `AUDIT_ALT_ISO_CANDS` 增一条生产方形态 ⇒ 行为探测的输入面第一次覆盖真实投影
- 两条新锁：§7.4-A（投影现算，不从判据取）、§7.4-B（六条逐位负控防退化成通配）
- **明确不做**：不改 `evaluateDeepReviewDebt` 判定逻辑、不动阈值、不放宽闭合词表

## 3. 门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | `scripts/` 工具脚本 + 文档，就地编辑、经 PR 落地 |
| TDD | PASS | 补丁应用后 `tests 68 / pass 68 / fail 0`；红由行为探测（`RE.test(生产方名)=false`）与变异共同见证 |
| 变异反证 | PASS | 摘掉新增分支 ⇒ 指名 2 条变红；还原 rc=0、md5 相符（测量域＝同字节工作树副本）|
| 行尾两口径对账 | PASS | 见提交前 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 读数 |
| 旧载体冻结 | PASS | 未往 `.quality-gates.md` 插块、未加 ledger 键 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触主进程 / RPA / 任何 UI 文件 |
| QM-6 双模型评审 | 见第 4 节 | 变更规模判定 |
| 远程同步 | 由门禁推导 | 收口按主干历史推导（本 PR 不写状态词、不做回填提交）|

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | 变异反证 ✅ | 行尾对账 ✅ | 旧载体冻结 ✅ | 文档同步 ✅ | 远程同步 PR #<本 PR 号>

## 4. QM-6 判定

`scripts/ccg-review-decider.js` 按本次变更集判定并落审计产物（pre-commit 自动暂存）。本刀是**判据形态修正 + 两条回归锁**，不引入新的判定分支语义；若判定为 dual 且状态无法闭环，按本仓规则转人工合并，不手写状态字段。

## 5. 未闭合（不假装闭合）

1. `#3724` 主体仍在飞：`evaluateDeepReviewDebt` 的两侧结构层叠（约 100 行）+ 测试并集，另成一刀。
2. 真实 alt 形态的生产方调用点在哪些路径上会被触发，本轮未穷举（只钉了「判据必须接受它」），需要一次覆盖性清点。

