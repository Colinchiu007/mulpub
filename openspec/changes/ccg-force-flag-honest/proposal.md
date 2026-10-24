# 变更提案：`deep-review.sh --force` 从装饰性旗标改为显式拒绝

## Why

仓库里有**两份已合并的执行记录**把 `sh scripts/deep-review.sh --force` 写成"缺评审轴时唯一能真正补审的路径"：

- `openspec/records/collection-page-ui-ue-refine.md:176`：「等 claude 网关恢复后重跑 `sh scripts/deep-review.sh --force`（唯一能真正补审的路径）」
- `openspec/records/film-engineering-user-manual.md:42`：「需在具备评审后端的 Windows 主机上补跑 `sh scripts/deep-review.sh --force`」

而这条命令**一次也不可能产生评审**。2026-10-22 用真引擎实测（在系统临时目录里造一个临时 git 仓 + 自造一条 `mode=skip` 的判定记录；探针不入仓，重跑配方见 design D2）：

```
engine rc=0
engine stdout tail: ═══ CCG 深度审查 ═══ | 提交判定: SKIP (S 复杂度（探针构造）) | 判定为 S 复杂度低风险，按决策矩阵不做深度审查 —— 退出 0
BEFORE.deepReview={"required":true,"status":"cleared","performedBy":"claude","tier":"external","evidence":"PR #4204 issuecomment-6323452201","findings":7}
AFTER.deepReview ={"required":false,"status":"skipped_by_mode","performedBy":null,"findings":null}
VERDICT wipe=true
```

三件事同时成立，且第三条是这次实测**新增**的事实（旧记录只说了"不真 force"）：

1. **旗标不强制**：入口只在 `:798` 跳过自己的早退，之后照样 `exec node "$DRIVER" --sha "$SHA"`，**不带任何旗标**；引擎（住在仓外技能目录 `$HOME/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js`）在验证层独立地从判定记录读 `decision.mode`，遇 `skip` 直接 `return 0`。未知旗标即使转发也不会被读到（引擎只按 `process.argv.indexOf(名字)` 取它认识的那几个）。
2. **rc=0 读起来像成功**：调用者拿到退出码 0、拿到一句"不做深度审查"，而记录里 `deepReview` 从 `cleared` 变成别的什么——**没有任何东西会因为"我请求强制、实际没审"而变红**。
3. **它会把那条记录的评审出处抹掉**：引擎在 skip 分支调 `writeBack(sha, {required:false, status:"skipped_by_mode", performedBy:null, findings:null})`，整块覆盖 `deepReview`。于是"先补审并把出处写进记录、后来有人跑了一次 `--force`"这个顺序下，出处静默消失（`mode` 字段本身不变，仍是 `skip`）。

同一族的**第三个现场**是 `openspec/records/fix-worktree-remove-dirty-gate.md` tasks 6.10：那次已经诊断出「`deep-review.sh --force` 不真 force（引擎用 `decision.mode` 覆盖一切）」，但当时判成「属"谁来守门"，报人不自治」于是没修。本刀**不改守门归属**——分支保护、`CI_IGNORED_PATHS`、required 清单一条都不动——只做一件事：**把对不存在能力的承诺删掉，并把命令的真实出路写在它自己嘴里**。文件头 `:13` 至今写着「`#   sh scripts/deep-review.sh --force      # 忽略 mode=skip，强制跑`」，而 `--help` 是把整段文件头打出来的（`:83`），所以每一个查帮助的人都读到这句假话。

## What Changes

**落点一：验证层 `scripts/deep-review.sh` 的 `--force`**

- `MODE=skip` 且带 `--force` 时，在**依赖体检之前、`exec` 之前**早退，`exit 2`。文案必须说破三件事：① 该旗标在验证层做不到（驱动自己从判定记录读 `mode`，转发旗标无人认识）；② 继续走下去的后果是驱动把那条记录的 `deepReview` 整块覆写成 `skipped_by_mode`，评审出处会没；③ 当前真能用的出路——决策层直接 `sh scripts/plan-review.sh <方案>`（它对方案恒不跳过），验证层要真审就按 AGENTS.md QM-6 的原始命令形态直接起后端，或走只读 fresh-context 派发，并把出处写进 PR 评论或 `closureNote`。
- 文件头用法行与退出码说明随之改写（`--help` 打印的就是这段头注释）。

**落点二：决策层 `scripts/plan-review.sh` 的 `--force` 与 `SKIP` 分支（实测无对象）**

- 删掉 `if [ "$MODE" = "SKIP" ] && [ "$FORCE" -eq 0 ]` 那格、`--force` 旗标与它的用法行。依据是当场实测：同一份 2 行方案，裸临时目录与 `openspec/changes/.../design.md` 两种路径形状都判 `SINGLE`；而 `isDocsOnly()` 首行对 `staged.proposal` 直接 `return false` ⇒ 决策层产不出 `skip`，那句「跳过跨家族对抗评审（--force 可强制）」永远不会被打印。删的是**死码上的第二个假承诺**，不改任何真实行为（S 复杂度的方案今天照样全量跑，只是走 SINGLE）。

**回归锁**

- 验证层 `skip + --force` ⇒ `rc=2`、点名旗标做不到、**桩驱动一次都没起来**、判定记录**逐字节未变**；
- 验证层 `skip` 不带旗标 ⇒ 既有 `rc=0` 语义不变、同样不起驱动（防"把人为误用与正常跳过做成同一种红"，那会诱导下一个人把整段拒绝删掉）；
- 拒绝点必须排在依赖体检与 `exec` 之前（按源码位置；位置锁是 M-E4 的唯一可见者）；
- `--help` 必须如实描述 `--force`，同时证明打印区间覆盖到了新行；
- `ccg-review-decider.js --input` 对两种路径形状都不得输出 `skip` —— 把"决策层不可达"钉成可执行事实，而不是留一句注释；
- S 复杂度方案执行 `plan-review.sh`（不带任何旗标）⇒ **确实把控制权交给驱动**（桩驱动落标记）；带已删的 `--force` 时行为同形（未知旗标只出声不拦，走既有分支）。

## Non-Goals（写在这里是为了下一片有合同）

本刀**不实现**"验证层真强制"。原因不是省事，是落点不在仓内：`decision.mode` 由引擎从 `.ccg/reviews/<sha>.json` 自己读，仓侧唯一能改的是那份记录本身，而**事后改写记录的 `mode` 等于伪造判定产物的决策**（入口现在的注释已明文拒绝"新建判定产物"）。真强制的正确形态是另开一条**显式留痕**的补审通道（由 decider 按已提交区间重测并写一条新判定，或由入口生成 diff 简报走决策层），那属新增能力，须单独设计。本刀把这一格作为**残留**写进 design 与规格，不得被读成"已经能强制了"。

## Impact

- 受影响规格：新增能力 `qm6-review-chain`（`specs/qm6-review-chain/spec.md`，三条 ADDED Requirement）。
- 运行时影响面：仅本地/评审链工具脚本；不改任何 CI 判定、不改分支保护、不改 required check 清单、不改 `CI_IGNORED_PATHS`。
- 用户可见变化：以前 `--force` 返回 0 并"什么都不做"；现在返回 2 并说清楚为什么、以及用什么替代。**在飞的两条欠账（那两份记录点名的补审）不会被这条命令自动关掉**——这是刻意的：它们本来就没被关掉过，只是没人知道。
- 回滚：单文件 + 三把测试锁，回滚即恢复原行为；不涉数据迁移。
