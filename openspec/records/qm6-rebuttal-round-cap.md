---
record: qm6-rebuttal-round-cap
task: 把外部深审的"已否证清单 + 跨调用轮次上限"立成合同（只落文档，实现未开工）
date: 2026-10-23
---

## 本次执行记录：外部深审轮次与已否证清单——合同片（qm6-rebuttal-round-cap，2026-10-23）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格变更（新增 `openspec/changes/qm6-rebuttal-round-cap/{proposal,tasks}.md` 与 `specs/qm6-rebuttal-round-cap/spec.md` + 本篇记录），零代码、零 CI 改动。为与后续实现片同分支，仍按运行时代码任务的规格走独立 worktree（`<仓库父目录>/mp-worktrees/mp-qm6-rebuttal-round-cap`，裸分支同名，起点 `origin/main == 05597f42e`）——AGENTS 的 docs-only 允许就地编辑，这里不借那个便利，避免合同与实现分处两分支 |
| 立项动因（读数以八轮实跑为源） | ✅ | 同一切片（PR #4148）真跑外部深审八轮：Critical 2/3/3/3/3/4（轮 3→8），最低 security 分 2→6→4。其中 **6 条是真属于我的缺陷**（拒写名散在 11 个 return / 复核漏引擎 / `dry-run` 游离两张表 / 快照被信号打断即漏盘 / "约 30 处夹具"从没量过 / 一条**成因写反**），其余是**同一指控重复 3–5 次**（realpath 当安全边界、记录 `sha` 指父提交、design 混排）。机制只看见前者，对后者没有任何记忆，也没有跨调用的轮次上限 |
| 本刀明确**不做**的事 | ✅ | 不改"什么算闭合"（`CLOSED_DEEP_REVIEW_STATUSES` / `tier=external` 取得条件 / `HIGH_RISK_SURFACES` / 收口矩阵逐条保持现状，并计划加一条结构锁钉住"未被本 change 修改"）；不引入严重度标尺；不做 tasks 8.2（引擎 vendoring）；**不自动合并** |
| 合同的落点选择（为什么账不放 `.ccg` 下） | ✅ | 前提实测在 tasks §0.1 / §0.4：判定记录名是内容寻址（八轮里换过 6 个名字）⇒ 计数器挂在记录名上每次归零且看起来完全正常；而 pre-commit 暂存记录用的 glob 是 `:(glob).ccg/reviews/*.json`（`*` 不跨 `/`）⇒ 子目录里的账不会随 PR 入库，会变成"只有本机看得见"的第二份事实。故落 `openspec/changes/<change>/external-rounds.json`（受管、可 diff） |
| 两个待决岔口（要人拍板） | 交人工 | tasks §4.1「短路重跑算不算一轮」（现按"不算"，因为零模型调用，且算的话"填完裁决再跑一次"这个必须动作会白烧配额）；§4.2「账本受管 vs 提交噪声」（现选受管，正解是合并写策略而不是搬到不受管区） |
| 行尾与编码对账 | ✅ | 四个新文件全部新建、LF；提交前后两口径 numstat 一致（读数见 PR 正文）。未改写任何既有受管文件 ⇒ 不存在 CRLF 幽灵行风险 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` 通过（外部后端一律写 `critic` / `proposer` / "评审引擎"，不写产品品牌名） |
| 文档同步 / 绝对路径 | ✅ | `scripts/check-doc-abs-paths.js` 通过；worktree 路径一律写 `<仓库父目录>/...` 占位形态，仓外引擎一律写 `~/.claude/...`（Gate 12c 的教训：执行记录的取证力靠分支名与 PR 号，不靠本机绝对路径） |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 零运行时代码、零 UI；本刀不产可测行为，实现片的 TDD 步骤逐条写在 tasks §1–§2（且刻意先写红再写码） |
| QM-6 CCG 双模型外部评审 | 不适用（docs-only） | 判定器对纯 openspec 差量判 `skip`/`single`，机械链上不强制双模型。但本 change 是**改评审怎么算数**的方案文档，其评审归属被写进 tasks §3.2：交人工过目，不自动合并 |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的读数在 commit 之后取并写进 PR 正文
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 遗留（不假装已闭合）

1. **实现未开工**：本篇只落合同。tasks §1 起才是代码，且 §2 的前置 §0.2 可能要求一次**仓外引擎改动**（送审载荷注入点），那需另行人工授权——本 change MUST NOT 被读成"注入已经能做成"。
2. **上限默认值 3 是价值判断不是事实**：它来自"我在第八轮才停手"这个反面教训，不是量出来的分布。选 3 的代价（真需要 4 轮的复杂改动会提前升级）与选 5 的代价（每轮约 10 分钟 + 模型额度）都写在这里，改值需人工过目。
3. **第 1 条与第 3 条未采纳也未否决**：收口判据从"没有 Critical"改成"每条 Critical 都有可核处置"、以及严重度标尺，都留在讨论区。#4148 的收口目前仍只有"一轮零 Critical"这一条机械出口，本 change 不为它开后门（tasks §3.3 明写）。
4. **`.ccg/reviews` 无界增长治理**（更早的欠账）与本 change 无关，不因本篇而闭合。
