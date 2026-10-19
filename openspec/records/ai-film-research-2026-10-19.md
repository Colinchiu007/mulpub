---
record: ai-film-research-2026-10-19
task: 克隆 16 个 AI 影视开源项目做代码级逆向分析，输出研究报告与落地实施方案，并完成 CCG 双模型对抗性审核
date: 2026-10-19
---

## 本次执行记录：16 个 AI 影视开源项目调研 + CCG 双模型对抗审核（ai-film-research-2026-10-19，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 纯文档，就地编辑 + 经 PR 落地 | 变更集仅 3 个文件（2 篇 01-docs 文档 + 1 个 pre-commit 自动 stage 的 `.ccg/reviews/<sha>.json` 产物）；无运行时代码（apps/、packages/ 未动）。docs-only 判定 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true` |
| 第一性原因（QM-5 ①） | N/A（本次无 Bug 修复） | — |
| 逃逸分析（QM-5 ②） | N/A | — |
| 修复 + 回归保护（QM-5 ④） | ✅ 有回归锁证据 | CI 红点 `check-doc-abs-paths.test.js:608`（本仓绝对路径基线逐文件相等）已修复并本地复验 PASS |
| 防止再次发生（QM-5 ⑤） | ✅ | 报告新增 §5.5 防膨胀硬约束 + 门禁清单（含「ffmpeg 滤镜白名单」「kit 资产需登记 KIT_FILES」「落点目录/语言实测」三条）；审核记录固化「本仓现状关键事实表」供后续实施直接引用 |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致：1334 / 168（删除数 0，无归因需求） |
| 接线棘轮 | N/A | 本次未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（变更集 0 个源文件） |
| QM-6 CCG 双模型外部评审 | ⚠️ 如实记录 | 双模型评审**实际执行**（backend 架构/数据/算法视角 + frontend 工程/交付视角，两条独立并行），三轮累计 **55 条意见、0 拒绝**。但载体为**本机子代理**，`codeagent-wrapper` 外部模型未调用（本机无该工具），属「双模型交叉审查」的降级形态，非「外部模型评审」 |
| 远程同步 | 由门禁推导 | 本行不事后改写；合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`） |

### 交付更正（2026-10-19，补交 PR）

**PR #3945 实际只合并了本记录 + 1 个 CCG 产物，两篇研究报告未进入 main。**

根因：共享根文档流程是「本地 main commit → `git branch <name>` → `git reset --keep origin/main`」。本次在三次连续提交中重复执行该序列，最后一次 `git branch -f` 时 HEAD 的父链已不含前两次的文档提交（每次 `reset --keep` 都把工作区与 HEAD 一起回退，靠 `git checkout <branch> -- <files>` 逐次恢复文件），于是 PR 的 diff 只剩最后一个 commit 的记录文件。**校验失效点**：`gh pr view --json files` 只看了最后一次推送后的结果（2 个文件），没有核对「预期交付的 2 篇文档是否都在变更集里」——`docs-only=true files=3` 的判定也被后续 commit 覆盖而失真。

**修复**：从本地 reflog 保留的 `616dde143`（含两篇文档的最终形态）恢复文件，另开 PR 补交。该 commit 未被 gc，取证命令 `git ls-tree -r --name-only 616dde143 -- 01-docs | grep RESEARCH-AI-FILM`。

**回归保护（防再次发生）**：
1. 开 PR 前必须核对「预期交付物清单」与 `gh pr view <n> --json files` 的两个集合相等，不等即停下；
2. `git branch -f` 之后必须用 `git log --oneline origin/main..<branch>` 确认提交链完整，而不是只看分支 tip；
3. 共享根连续多次「commit → branch → reset」是有损操作（工作区随 HEAD 回退），后续多 commit 文档任务应改为「一次性 commit 全部文件」或改用隔离 worktree。

### 遗留（不假装已闭合）

1. **ZJT 署名范围未定论**：修改版 Apache-2.0 的署名义务是否及于「算法思路的重实现」存疑。采取保守策略（F17 无论是否构成二次开发均声明来源），标注「非法律意见」。
2. **VLM 适配器是否存在待核实**：`adapters/_base/base.js:37-50` 的 `KNOWN_METHODS` 实测无视觉方法 ⇒ F12 依赖不存在的适配器，已拆出 F12-0 前置任务，未完成则 F12 不可开工。
3. **剪映草稿格式兼容性待 spike**：F23 需先用 ZJT `jianying/` 子库在目标剪映版本实际生成并打开验证，未通过不进批次。
4. **F29（TTS 时长驱动）优先级待决策**：评审指出其优先级应高于 F8c（事后 pad/trim 对齐），需先做可行性验证再决定取舍。
5. **防膨胀「机械契约锁」尚未落地**：本次仅在文档中确立约束方向，门禁脚本 `scripts/check-file-size-gate.js` 尚未编写（列为后续任务，需挂在不被 docs-only 短路的 CI job）。
6. **`.ccg/reviews` 产物解析不动 1 条**：`c289326f....json`。该产物由 pre-commit 自动生成，不参与欠账判定与覆盖率统计；按判据要求「让 pre-commit 重新生成，不手工修补 JSON」——已由后续 commit 自然再生。

### 附录编号修正（2026-10-19，follow-up）

报告原有两个「附录 B」（「克隆位置与复现命令」与「许可证核实方法」），后者改为「附录 C」。纯编号修正，无内容变更。
