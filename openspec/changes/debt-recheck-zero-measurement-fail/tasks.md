# Tasks — debt-recheck-zero-measurement-fail

> 判据一律取产物，不取 rc；每条"已实测"后面必须跟当场读数，活数不许写成常数。

## 1. QM-5 第 1 步：第一性原因取证

- [ ] 1.1 取 run `39563222046` / job `119099176198` 的步骤结论与 `[recheck]` 原文（**已完成**：step conclusion=`success`；`rows=30 IN_BASELINE=0 VIOLATES=0 UNJUDGEABLE=30 CHECKER_FAILED=0`；逐条 15 × `worktree-setup` + 15 × `conflict`；整步 13.3 秒、每条 242–296 ms）
- [ ] 1.2 逃逸分析：这条假绿逃过了切片 C 的哪些锁？逐档说明（已有 25 条锁为什么抓不到——`worktree-setup` 不在故障名单是"名单抄两遍"，全量注入替身使默认闭包不可见）
- [ ] 1.3 系统性漏洞定位：`TOOL_FAULT_REASONS` 手抄第二份真源 + `live()` 生产默认装配零覆盖（两类都要指名到具体行为，不许停在"测试不够"）
- [ ] 1.4 根因状态如实记为**未证实**，并列出候选（committer 身份 / `worktree add` 被拒 / 其它），明确"本刀只让下一次运行自己说出口"
- [ ] 1.5 预防措施落点确认：派生归类表 + 结构不变式 + 生产默认装配锁三条各自有执行体，写进本文件对应小节

## 2. 规格与判据设计

- [ ] 2.1 proposal / design / specs / tasks 四件套（含"全 conflict 退 0"这条刻意的收窄裁决）
- [ ] 2.2 设计阶段 QM-6 双模型外部评审（改 `scripts/check-*` 属高危面），逐条处置并把结论写进执行记录

## 3. 实现（先让测试红，再转绿）

- [ ] 3.1 `REASON_CLASS` 一处真源；`UNJUDGEABLE_REASONS` / `TOOL_FAULT_REASONS` 由它派生
- [ ] 3.2 三个失败单位三个档名：`worktree-setup`（seam 未装配）/ `merge-commit-failed` / `merge-worktree-failed`；`mergedTreeEvidence` 同步
- [ ] 3.3 `UNJUDGEABLE` 条目带 `stage` + `detail`（失败命令首条非空 stderr，截 200）；逐条日志与 `renderComment` 都打出来
- [ ] 3.4 `summarize()` 退出码结构不变式 + `MEASURED=0(all-conflict)` 留痕行
- [ ] 3.5 `live()` 默认闭包的 `runChecker` 路径与 `commit-tree` 参数在**不注入**时被真跑到

## 4. 回归锁（新增，逐条先见证红）

- [ ] 4.1 锁 A：全 `merge-worktree-failed` 的一轮 ⇒ `exitCode≠0` 且 `shouldComment=false`
- [ ] 4.2 锁 B：全 `conflict` 的一轮 ⇒ `exitCode=0` 且输出含 `MEASURED=0(all-conflict)`
- [ ] 4.3 锁 C：三档名互不相同且都属工具侧故障（含 seam 未装配那档仍是 `worktree-setup`）
- [ ] 4.4 锁 D：`detail` 含失败命令 stderr 首行，并出现在逐条日志里
- [ ] 4.5 锁 E：归类表出现非法值 ⇒ 判据点名失败；词表成员必在表内（双向）
- [ ] 4.6 锁 F：`mergedTreeEvidence` 与 `evaluatePr` 对同一失败阶段报同一档名
- [ ] 4.7 锁 G：**生产默认装配**真跑一次（只注入 `gh` 与 `repoDir`），断言量到了、不是任何 `UNJUDGEABLE`
- [ ] 4.8 全量 `node --test scripts/check-debt-recheck.test.js` 通过，打印用例条数（活数，随实现变化要重取）

## 5. 变异反证

- [ ] 5.1 每条新锁各配一个"取被禁形态本身"的变异，红集互不相同（测试名粒度）
- [ ] 5.2 至少包含：把 `merge-worktree-failed` 折回 `worktree-setup` 并**同时**保留旧故障名单（复现本次事故）、摘掉 `detail` 赋值、归类表加非法值、默认 `runChecker` 路径改错一个字母
- [ ] 5.3 驱动必须自证"这一跑真跑了几条用例"；跑完按字节还原并打印 md5

## 6. 交付与收尾

- [ ] 6.1 执行记录 `openspec/records/debt-recheck-zero-measurement-fail.md`（含 `## CHANGELOG 条目` 小节；**不动 CHANGELOG.md**）
- [ ] 6.2 本机按 CI 清单点名跑相关判据（`check-unwired-tests`、`check-step-failfast`、`check-gate-record-debt`、`check-pr-exec-record --mode=enforce`、`check-changelog-growth`、`check-changelog-duplicate-entries`、`check-record-qm5-rows`）
- [ ] 6.3 PR + `mergeable`/checks 闸门 + squash 自动合并 + 三件产物取证
- [ ] 6.4 回读本次合并触发的 main push，读数写进 PR 评论（不写回仓库文件）
- [ ] 6.5 `check-branch-merged` → retire 标签 → `safe-worktree-remove.ps1 -WhatIf` 再实跑 → 删本地分支
- [ ] 6.6 记忆收敛：本轮可复用教训（不写代码模式，写判据与失效形态）
