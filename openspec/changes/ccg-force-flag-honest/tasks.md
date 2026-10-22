# 任务清单

## 1. 取证（动手前先量，判据不靠回忆）

- [x] 1.1 引擎侧：`mode=skip` 分支真跑一次（临时仓 + 自造记录），取 rc / stdout / `deepReview` 前后读数 ⇒ **已实跑 2026-10-22**：`rc=0`、`不做深度审查 —— 退出 0`、`wipe=true`（`cleared/external/evidence=PR #4204 issuecomment-6323452201` → `skipped_by_mode/performedBy:null/findings:null`）
- [x] 1.2 入口侧：确认 `--force` 未转发给驱动，且引擎不认识该旗标（读 `deep-review.sh:798` 与三处 `exec`；读引擎 argv 取法）⇒ 成立，见 design D2
- [x] 1.3 确认"无后端环境会把旗标缺陷伪装成环境故障"这一归因形态 ⇒ `deep-review.sh:807` 起依赖体检在 `exec` 之前，`exit 2` 文案只点名后端缺失 ⇒ 见 design D3，本刀锁里同时断言 rc 与文案
- [ ] 1.4 清点 `--force` 的引用面（谁在教人敲它）：已命中两份执行记录 `collection-page-ui-ue-refine.md:176`、`film-engineering-user-manual.md:42`，及一条已诊断未修的 `fix-worktree-remove-dirty-gate.md` tasks 6.10；`.adversarial/` 里的命中是历史评审载荷对 diff 的引用，不算调用点 ⇒ 待最终提交前用 `rg -a` 复扫一遍并把当场读数写进执行记录

## 2. 规格与文档

- [x] 2.1 `specs/qm6-review-chain/spec.md`：三条 ADDED Requirement（旗标不得承诺做不到的事 / 不得触达驱动与覆写产物 / 两层不对称必须分别成锁）
- [x] 2.2 `proposal.md` / `design.md` 定稿，含 D6 三条残留与 D7 变异格子表

## 3. 回归锁先行（TDD 红）

- [x] 3.1a 验证层 skip + `--force` 的**答复面**（rc=2 + 固定判据串 + 替代路径）⇒ 实现前见证红（`not ok 42`）
- [x] 3.1b 同一档的**产物面**（桩驱动未起 + 判定记录逐字节不变）⇒ 与 3.1a 原为同一条用例，因 M-E1/M-E3 同红集而拆开；拆出时未重走"先见证红"，可证性由 M-E1（红 3 条）与 M-E3（红 1 条）提供
- [x] 3.2 同文件：验证层 skip 不带旗标 ⇒ `rc=0`、驱动不起、记录不动 ⇒ 首跑即绿（它锁的是既有语义，作用是把"把误用与正常跳过做成同一种红"这条退化路径钉住，如实记为**取证性绿**）
- [x] 3.3 同文件：拒绝点必须早于依赖体检段与 `exec`，三个锚点各自缺失即红 ⇒ **实现前实跑见证红**（`not ok 44`）
- [x] 3.4 同文件：`--help` 必须如实描述（含"打印区间覆盖到新行"这一并证）⇒ **实现前实跑见证红**（`not ok 45`）
- [x] 3.5 `scripts/plan-review-deps.test.js`：四把 —— 判定器对 `--input` 两种路径形状都不产出 skip（首跑绿，实测 SINGLE×2）、S 复杂度方案必须交给驱动（首跑绿）、已删旗标不得复活的结构锁（**红**：`not ok 13`）、带已删旗标时行为同形且必须出声「忽略未知旗标」（**红**：`not ok 14`）
- [x] 3.6 终版计数：`deep-review-deps` 41→46（含上游 #4151 带入的 1 条）、`plan-review-deps` 10→14 ⇒ 本片新增 9 条。红的用例名逐条记录：`deep-review-deps` 3 条（42/44/45）+ `plan-review-deps` 2 条（13/14），共 5 条指名红；另有 2 条首跑即绿的取证性锁（3.2 与 3.5 前两把），其价值在拦住将来的退化，不在证明本刀改动

## 4. 实现

- [x] 4.1 `scripts/deep-review.sh`：`:798` 那格拆成两档，带旗标那档新增 `exit 2` 拒绝块（文案三件事 + 两条出路），位置排在 `# ---------- 4. 依赖体检 ----------` 之前；`sh -n` 通过
- [x] 4.2 文件头用法行与退出码说明改写（`不会强制` / 「含 --force 在 skip 档做不到这一格」），由 `--help` 锁证明区间覆盖到
- [x] 4.3 `scripts/plan-review.sh`：删除不可达的 SKIP 早退分支、`FORCE` 变量与 `--force` 的 case 臂，用法行与未知旗标文案同步；原分支位置留下"为什么删"的注记（`不可达`，供结构锁的第三条断言命中）；`sh -n` 通过，`grep -c FORCE` 读数 0
- [x] 4.4 消费者并集全跑（`git grep -l -e deep-review.sh -e plan-review.sh -- '*.test.js'` 取到 5 个文件）：`deep-review-deps` 45/45、`plan-review-deps` 14/14，其余三个消费者 `ccg-bash-entry` + `ccg-review-decider` + `check-pr-exec-record` 合并跑 **tests=201 pass=201 fail=0 rc=0**（2026-10-22 本机）

## 5. 变异反证

- [ ] 5.1 按 design D7 的 M-E1..M-E6 逐条实跑，记录每条的红集；红集必须互不相同，出现子集关系要显式披露
- [x] 5.2 任何一条读成 UNREADABLE / LOADFAIL 的必须单列，不得计入 CAUGHT ⇒ 两轮 UNREADABLE（`tests=-1 rc=null`，子进程被并发驱动抢杀）都单列并整轮作废重跑
- [x] 5.3 第一轮读数的两条自打并修复：M-E4 MISSED（位置锁锚串不唯一 ⇒ 恒真）、M-E1/M-E3 同红集（一条用例混两种不变式 ⇒ 拆成答复面/产物面两把）
- [x] 5.4 驱动并发事故处置：TaskStop 报"已停止"而驱动树仍在改文件 ⇒ 按亲缘核对后逐个 PID 终止（前后 node 计数 24→19，未按名字批量杀）、污染文件按精确路径 `git restore --source=HEAD --worktree` 复位、驱动加单实例锁、第一轮读数作废重跑

## 6. QM-6 外部评审（高危面）

- [x] 6.1 设计层：`sh scripts/plan-review.sh <本次 design 的唯一命名副本> --force` ⇒ 2026-10-22 实跑判定 DUAL、critic=claude 交付 6 条（Critical 0，最低维度分 7，converged/cleared）；产物 `.adversarial/ccg-plan-ccg-force-design-20261022-claude/`（gitignored），判定产物 `.ccg/reviews/ab806ce0….json`；逐条处置见 design D8。副本放系统临时目录的代价=评审的是快照（该目录只读不写回仓内 design.md），已在残留里记
- [ ] 6.2 实现层：`sh scripts/deep-review.sh`（本刀判定为 dual 时）或由 decider 的补跑档按已提交区间判定后跑；产物落 `.ccg/reviews/`，`tier=external` + 可核 `evidence`
- [ ] 6.3 逐条处置发现：采纳的写落点，拒绝的给可反证理由；处置写进 PR 评论与执行记录

## 7. 收尾

- [ ] 7.1 `openspec/records/ccg-force-flag-honest.md`：执行记录 + `## CHANGELOG 条目` + `## learnings`
- [ ] 7.2 本机预跑 CI 侧静态门禁（`check-doc-abs-paths`、`check-gate-record-debt`、`openspec-sync-check`、`check-pr-exec-record --mode=enforce`、`check-max-lines`、`check-step-failfast`、`check-unwired-tests`）
- [ ] 7.3 建 PR、CI 全绿后按 AGENTS「PR 自动合并」判据合并并做产物取证（merge SHA / 远端分支 0 行 / `check-branch-merged`）
- [ ] 7.4 回读本次合并触发的 `quality-gate.yml` main push run，读数写进 **PR 评论**（不写回仓库文件、不开回填 PR）
- [ ] 7.5 `scripts/safe-worktree-remove.ps1 -WhatIf` 干跑通过后实跑；本地分支打 `retire/` 标签后删除
- [ ] 7.6 记忆收敛：把「装饰性旗标 + 覆写出处」这条形态与两入口不对称写进项目记忆，并核对既有 `qm6-reviewer-operational-realities` 的形态清单是否需要追加
