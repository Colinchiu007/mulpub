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

### v2 增补：3 个新项目（2026-10-19，follow-up）

调研对象由 16 扩到 19：新增 FireRed-OpenStoryline（Apache-2.0）、smy-seedance-storyboard（**无 LICENSE**）、ToonCrafter（Apache-2.0）。

两处实测修正：
1. F32（TransNetV2 镜头边界检测）**删除** —— 实测 mulpub 已有 video_creation/analysis/scene_detect.py（282 行，PySceneDetect + ffmpeg 回退），引入 TransNetV2 需 torch（+1~2 GB），与桌面端不匹配。
2. ASR 口播粗剪**确认是真缺口** —— transcriber.py（247 行）已提供 word_timestamps，但全仓无口水词/粗剪逻辑。

另修：§2.1 waoowaoo 重复行（结论互斥）合并；§5 批次一表格被修正块从中间截断已修复。

### 第二层深挖（v3，follow-up）

三个新项目各加一节第二层（§3.17.1 / §3.18.1 / §3.19.1）：FireRed 的 MoviePy 栈与节拍分配算法（SUBCLIP_END_SAFETY_MARGIN_S 安全边距 / 双窗口 clamp / BGM 三态 / SNAP_SAFETY_MAX_STEPS 防死循环）、smy 的失败模式表与分层配方与色盘闭环（仅抽象做法，文本不可复制）、ToonCrafter 的首尾帧约束模型机制（c_concat 钉两端 / Fusion zero-init / 末帧裁剪）。报告 1690 → 1867 行。

### 第三层综合（v4，follow-up）

新增 §3.17.2（ASR 粗剪编排层：逐句裁决/静默分组/前缀和重校，升级为可直接实施）与两个横向收束节 §3.20（分镜数据模型四方对照——mulpub refTokens 为四方最强实体机制、prompt 单字段 13.9k 是最刺眼缺口、sceneId 全 1:1 暴露 Scene 树未被消费、时长字段缺失）、§3.21（连续性七种武器全景——mulpub 仅有第 1 档，短板在 prompt 纪律/输入接力/生成策略/验收闭环）。报告 1867 → 2001 行。

### 第四层收束（v5，follow-up）

新增 §3.22：F×七档覆盖映射（F15/F6b+F31/F3b-palette 提级进批次一，连续性覆盖 1/7→4/7）、三个新 F/修订（F3b-palette 色盘资产、F1 增补失败模式台账与分端配方、F34 durationMs 字段+来源优先级链）、依赖重排四处（F8 为咽喉）、三层演变总账（七次自我修正同模式：外部判断被内部实测推翻）。报告 2001 → 2091 行。

### 第五层新视角（v6，follow-up）

新增 §3.23 三视角：①成本经济学（waoowaoo 19 条 BA 不变量——BA-01 双轨事故直接命中 publish-capabilities 双版本形态；BA-08 attempt 与收费分离回答 F12 遗留；moyin SEEDANCE_LIMITS 常量结构；showvi 即梦逆向 API 能力矩阵）②失败哲学（FG-01~05 证据保全派 vs fail-soft/fail-closed/静默吞掉四形态；FG-03 为 F19 提供规范依据）③prompt 演化（waoowaoo canary 基线在开源仓无消费代码——执行器在闭源 EE；mulpub 建议最小 canary：每条 rule 的本地渲染断言，无需调 LLM 零成本；失败模式台账+canary 成闭环）。报告 2091 → 2189 行。
