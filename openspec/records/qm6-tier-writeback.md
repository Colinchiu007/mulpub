---
record: qm6-tier-writeback
task: 立 OpenSpec change qm6-closure-writeback（8.1b 的落点重选与合同），本 PR 只落提案与规格，不落实现
date: 2026-10-20
---

## 本次执行记录：立 qm6-closure-writeback 提案（qm6-tier-writeback，2026-10-20）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格变更：`openspec/changes/qm6-closure-writeback/{proposal,tasks,design,specs/**}.md` 四份新建，零代码。正规入口 `scripts/start-mp-task.ps1 -TaskName qm6-tier-writeback -NoDeps` 建成 `<仓库父目录>/mp-qm6-tier-writeback`，裸分支同名、起点 == `origin/main`（`87f8de7ba`），工作树 0 脏项；判据取产物（`git worktree list` 命中 + `rev-parse --abbrev-ref HEAD`），不取 rc |
| 为什么本 PR 只有提案 | ✅ | 这片改的是 `scripts/deep-review.sh` 与 `scripts/check-pr-exec-record.js`——两条都在高危面清单内，属"改谁来守门"。按 #3987 同一条自反纪律，先把合同过一遍评审再动代码：**方案错了改代码很便宜，代码写完才发现方案不成立就变成第二次拆锁**。设计阶段的跨家族对抗评审要打在方案上，不是留给 PR 前补 |
| 落点偏差的取证 | ✅ | 8.1b 原文假设"落点在仓外引擎"。当场重取路径链：`ls -ld ~/.claude/skills/adversarial-review-loop` ⇒ 符号链接指向 nacos 技能同步目录；`git -C <该目录> rev-parse --show-toplevel` ⇒ 另一个 git 仓（同步盘内，值一条命令可重取，故文档里按 Gate 12c 写成占位符）；`git ls-files \| grep ccg-deep-review` ⇒ 本仓只有规格引用、无实现副本；`deep-review.sh:536-544` 那段 2026-10-17 的修复自证 **CI runner 上该文件不存在**。四条合起来否证了"改引擎"，落点改为仓内驱动写回（design §1） |
| 立项读数的诚实边界 | ✅ | 见 design §2 表：每条带复现命令。**其中「闭环 × tier」交叉表（已闭环 208 / 无 tier 157 / 自造值 22）是本次一次性手工探针**，本仓工具 `scripts/ccg-artifact-shape-survey.js` 现在只打总缺席数（`:66`，实测 `[丙的前提] deepReview.tier 缺席=1258/1563`）、没有交叉表 ⇒ 该读数按本仓纪律属**孤立数**，已登记为 tasks 0.1b：实现片必须先给普查工具加交叉表、再用它重跑并改写 design §2 那一行。不得让下一个会话把 208/157/22 当现状引用 |
| 行尾与 diff 对账 | ✅ | 四份新建文件写入时是 LF，`git add` 后 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` **逐文件相等**（120/0、74/0、95/0、69/0），无幽灵行 |
| 旧载体冻结 | ✅ | 未向 `.quality-gates.md` 插块、未向 `scripts/gate-record-debt-ledger.json` 加键 |
| 品牌残留 / 文档同步 / 绝对路径 | ✅ | `check-no-brand-residue.js` PASS；`check-doc-abs-paths.js` 第一次是 **FAIL（超出存量基线 1 个文件）**，成因就是 design §1 里那条同步盘绝对路径；正解按 Gate 12c 写占位符并附一条可重取命令（不是调大账本），改后 `counts=1161 files=561 canJudge=true` ⇒ PASS |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 零代码、零 UI；本片还没写实现，因此也没有可测行为 |
| QM-6 CCG 双模型外部评审 | PENDING | 本 PR 是**方案**，正解是在方案阶段打评审（不留到 PR 前）：待本 PR 合入后按 `sh scripts/deep-review.sh` 跑设计产物的对抗循环，跨家族轴不可得时按四档归因并如实写"单轴"。判定器对当前差量判 `mode=skip`（纯文档），所以机械链上不强制——**这条不写成"已过"** |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的读数在 commit 之后取，并写进 PR 正文
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 遗留（不假装已闭合）

1. **实现未动**：本 PR 只立合同。`deep-review.sh` 的 4 条 `exec`、写回器、`delivery@` 档、parity 锁全部还没落码——tasks 1–6 一条都没勾。**不要把"提案已合并"读成"8.1b 已闭合"**。
2. **本片的强度上限已经在 design §3-D3 写明**：交付摘要是**自洽性**判据，不是签名；手工伪造一份自洽产物技术上仍然成立，本片只把成本从"写一个词"抬到"伪造一份条数/内容/后端名互相自洽的评审正文"。联网核验单独立片（tasks 8.1）。
3. **引擎归属决策（vendoring）没做也不做**：tasks 8.2 挂着，属人工过目。本片的 D1–D3 不依赖它；若日后 vendoring 先行，本片仍成立。
4. `unknown` 占比、`single` 在高危面无人守、CI 侧仍 `advisory` 三条残余一条未动。
