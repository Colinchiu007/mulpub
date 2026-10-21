## D1 归因粒度必须等于「可被修复的那个单位」

现状把三件不同的事写进同一个 `worktree-setup`：seam 没装配（工具自己的代码问题）、`git commit-tree` 失败、`git worktree add` 失败。这三者的**修法完全不同**（补注入 / 补身份或参数 / 补检出形态），共用一个档名等于让读日志的人从结论倒推原因。

拆成三个档，且**旧名不改语义**：`worktree-setup` 继续只表示"seam 没装配好"（`evaluatePr` 第 71 行那条出口），真 git 的两个阶段新增 `merge-commit-failed` / `merge-worktree-failed`。这样切片 C 记录里"缺 commitTree/worktreeAdd/runChecker 任一 ⇒ 归 `worktree-setup`，不得归成 conflict"那句既有合同仍然成立。

`mergedTreeEvidence`（构造合并态、从不判决的那条）同步改，保持两条路档位同源——它是集成用例走的路，若两路边数不一致，"同一件事在两个函数里叫不同名字"就是下一个会话的坑。

## D2 故障归类只准有一处真源

`REASON_CLASS` 是 `{ reason: 'tool-fault' | 'other-pr' }` 一张表，`UNJUDGEABLE_REASONS = Object.keys(REASON_CLASS)`，`TOOL_FAULT_REASONS = keys.filter(fault)`。配一条判据：表里每个值必须落在这两个档之一，否则红（值写错 = 该档既不算故障也不算别人的 PR ⇒ 会静默退 0）。

为什么这不是"把 3 档名单改成 5 档名单"就完事：漏一档的原因就是**名单抄了两遍**。只补 `worktree-setup` 进 `TOOL_FAULT_REASONS` 是同一缺陷的下一版——第六档照样会漏。派生 + 闭集校验把"忘了归类"从"没人会发现的静默放行"变成"当场红"。

## D3 退出码：结构不变式，外加一条刻意的窄出口

主判据不看名单是否完备，只看计数：

```
measured = IN_BASELINE + VIOLATES
exitCode != 0  ⟺  存在 tool-fault 行  ∨  (rows > 0 ∧ measured = 0 ∧ 并非每行都是 conflict)
```

第二项是网：将来出现一个没归类好的新形态，只要它让整轮一条都没量到，仍然非零。

**全 conflict 的一轮为什么仍退 0**（这条是对原报缺陷「零测量 ⇒ 非零」的收窄，属裁决，必须留着理由）：`conflict` 的含义是"这笔 PR 与主干真有冲突"，而 GitHub 在 `CONFLICTING` 状态下**根本不让合并**——陈旧绿进不了主干，本作业要防的那件事没有发生。把它判红会诱导人去"让它不红"（改评论、放宽判据），而不是解决什么。留痕仍然要给：打印 `MEASURED=0(all-conflict)`，让"这一轮一条都没量"在日志里看得见，与"量了且都在基线内"（`MEASURED>0`）两形态可区分。

`rows=0`（没有任何 open PR）仍退 0——这是既有语义，别改：它是"无事可做"，不是"没量到"。

## D4 `detail` 只取失败命令的首条非空 stderr，不取全文

取 stderr 第一行非空文本、截 200 字符，随条目落进逐条日志与评论表格。为什么不放全文：评论是写给别人 PR 的，多行原文会把别人的 PR 页面刷成长帖；而 git 的报错**首行就是结论**（`fatal: ...`）。为什么必须放：本次运行的日志里没有任何 git 原文，导致"CI 上哪一步坏了"到现在未证实——这是本刀唯一能立刻消灭的失明。

同时不改判：拿到 `detail` 之后根因仍要另起一轮修（见「不做」）。

## D5 生产默认装配必须有一条锁（替身掩盖接线缺口）

`live()` 的四个 seam 都有默认实现（真 git / 真 spawn 判据），而现有 25 条锁**全部**注入假实现。后果：默认闭包里任何笔误——`path.join(d,'scripts','check-debt-budget.js')` 拼错、`commit-tree` 少传一个 `-p`、`worktree add` 参数顺序错——测试面完全看不见，只能在 CI 上以"整轮零测量"的形态显形（这次就是这么发生的）。

新增用例的形态：只注入 `gh`（网络面必须假，本仓 `network-egress-guard` 会拦真出站）与 `repoDir`（`os.tmpdir()` 下真建一个 git 仓库，含 `scripts/check-debt-budget.js` 的**桩**——桩的是被消费的判据，不是本函数的 seam），`classify/commitTree/worktreeAdd/runChecker` 一律不注入，断言：

- 真跑完 merge-tree → commit-tree → worktree add → 真 `spawn(process.execPath, ...)`；
- 结论档位是 `IN_BASELINE`/`VIOLATES` 之一（即真的量到了），不是任何 `UNJUDGEABLE`；
- 该用例必须能抓住"把默认 `runChecker` 的路径改错一个字母"这一变异（改名后条目变 `UNJUDGEABLE/merge-worktree-failed` 或 `CHECKER_FAILED`，绝不静默变绿）。

夹具注意：临时仓库的 `GIT_DIR` 不得泄漏到进程 env（本仓记过「夹具读到别人的仓」的同型事故），一律 `repoDir` 显式传 + `-C`。

## 残余（不假装已闭合）

- **根因仍未证实**。本刀只让下一次运行报出失败命令与首行 stderr。候选按可能性列在这里，供下一轮对照：① runner 上 git 未配置 committer 身份 ⇒ `commit-tree` 失败（注意：这条**不可能被现有测试抓到**，因为集成夹具在临时仓库里显式 `git config user.email`——正是 D5 说的那格）；② `worktree add` 在 CI 检出形态下被拒；③ 别的原因。修它需另一刀，且若结论是①，"给 CI 环境补身份"与"给 commit-tree 显式 `-c user.name/-c user.email`"是两种形态，须按报出来的原文再选。
- **落地后这个非 required 作业会持续红**，直到根因那一刀进去。这是设计意图，但要在执行记录里写明，否则下一个会话会把它当成新引入的故障去"修绿"。
- 评论面（`MP_RECHECK_COMMENT="1"`）仍未启用，因此 CI 侧耗时与评论速率**依旧未测**；本轮新取的 13.3 秒只覆盖 fetch+merge，不覆盖判据执行。
