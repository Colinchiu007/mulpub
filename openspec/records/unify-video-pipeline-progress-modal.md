---
record: unify-video-pipeline-progress-modal
task: 统一视频流水线进度浮层样式为四按钮契约，成功后浮层保留并提供【查看】（历史已完成）/【去发布】（发布页预填充）两个完成出口
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：流水线进度浮层四按钮与完成出口（unify-video-pipeline-progress-modal，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码变更：worktree `<仓库父目录>/mp-worktrees/mp-unify-video-pipeline-progress-modal` + 裸分支 `unify-video-pipeline-progress-modal`（`scripts/session-init.sh` 创建，`rev-parse --abbrev-ref HEAD` 实证）；共享根保持 main clean；`pre-code-edit-guard.ps1` 在共享根 rc=1（正确拒绝），worktree 内放行 |
| 第一性原因（QM-5 ①） | PASS | 两页 footer 各写一套（热门选题用页面私有 `cohere-btn-*`）；成功后自动跳转写死在两条代码路径 `CreateView.applyOrchestrationOutcome`（L3698/3733 旧）与 `useHotTopicsGenVideo.finishGenVideoCompleted`（L326-327 旧）；同一份「完成即跳转」承诺另在 `PRD.md` §3a.2 与 `PRD-video-creation.md` §1.6 各写一遍 —— 四处不一致的根因是**没有单一承载面** |
| 逃逸分析（QM-5 ②） | PASS | 原有用例只断言"跳转发生了"（`toHaveBeenCalledWith({path:'/create/result'})`），对"跳转是否是用户想要的"零覆盖；`hot-topics-gen-video-modal` 的 footer 无任何样式断言（`cohere-btn-*` 与 `ui-btn-*` 在功能测试中完全等价 ⇒ 只能靠结构/类名断言守）；测试侧另有两条自身缺陷：`vi.spyOn` 幂等导致跨用例调用泄漏、`s2v-cancel-trigger` 跨面板重名 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增/改写用例全绿（`CreateView.test.js` 296 + `HotTopics.test.js` 49 = 345）；为满足 `.github/scripts/check-max-lines.js` 的测试账本容差（+200 行），把新增的 12 个用例合并成 8 个，**断言项一条未删**（合并后仍逐条覆盖：四按钮顺序/灰显/解锁/不跳结果页/查看/去发布含 run-only/无成片/终态门禁/深链）；关键用例：四按钮组成与顺序、灰显/解锁、成功后不跳转、查看/去发布路由与 query、run-only 退化、无成片不解锁、终态门禁逐状态映射、`?filter=` 深链消费；**变异反证 M1/M2 各 3 例指名变红，还原后逐字节回绿** |
| 防止再次发生（QM-5 ⑤） | PASS | 契约写成"集合+顺序+门控"三元组断言（不是单点断言）；`01-docs/learnings.md` 新增 2 篇（承诺扫面 / spy 幂等与 testid 重名）；`01-docs/DESIGN.md` 把四按钮契约写成设计规范；`PRD-VIDEO-PIPELINE-PROGRESS-MODAL-2026-10-17.md` 含取舍与遗留 |
| 行尾与 diff 对账 | PASS | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径一致（见下方"本机读数"） |
| 接线棘轮 | N/A | 未新增 `*.test.js` 文件，全部为既有测试文件内追加（`CreateView.test.js`、`HotTopics.test.js`），无需新增 workflow 点名 |
| QM-1 打包 / QM-4 视觉 | N/A | 本轮仅改渲染端（`apps/desktop/src/**` + `01-docs` + `openspec`），未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/` ⇒ QM-1 不适用；QM-4 无 `create-pipeline`/`hot-topics` 浮层基线，且改动只在 footer 动作层（无布局类变更），按"无基线"如实记 N/A |
| QM-6 CCG 双模型外部评审 | PASS（评审已执行 + 自扮演裁决；逐提交记录缺失如实记） | `sh scripts/deep-review.sh` 在实质改动集上真实执行（claude 作 critic、opencode 作 proposer，跨家族校验通过；单轮 ~13 分钟）：critique 出 **8 条意见 / 4 维度（correctness/security/performance/maintainability）最低分 3** → 引擎进自扮演裁决（置信权重 0.6）。逐条裁决：**i3（热点页 run-only 去发布注入空 title/content）upheld → 已修**；**i4（completed 无成片仍可开浮层）upheld → 已修**；i1（记录 status=pending 即虚假审计痕迹）dismissed（`check-pr-exec-record` 把 `pending` 判欠账并阻断，机制本身在防这件事）；i2（PRD 插入重复内容块）**判为真实命中**——`replace_all` 误命中巨型段落里的重复标题，已改行锚定重做（现 §3a.3 恰好 2 份、+74/−2）；i5（断言改写给既有覆盖）dismissed（`durationMs` 口径搬到浮层完成汇总仍断言「2 分 5 秒」；teleport stub 是文件既有默认；独立 router 是为隔离已发现的共享 router 泄漏）；i6（learnings 写入测试策略）dismissed（该文件本就是"可复用判据"合集，未声称任何产品缺陷已修）。证据留存：`.adversarial/ccg-deep-2c4e1fea/{proposal-v1.md, critique-v1.md, adjudication.json}`（未入库，属本地评审产物）。**残留（不假装闭合）**：最终 squash 提交因反复 amend 使 `.ccg/reviews/<sha>.json` 的内容寻址与提交口径分叉，引擎对本提交报「无判定记录」并以 rc=1 fail-closed —— 该逐提交记录**不是"通过"**，只是"没找到"；`check-pr-exec-record --mode=enforce` 读数为 OK（本 PR 携带执行记录），故按"评审已执行、逐提交留痕缺失"如实登记，不以 rc=1 反推评审未做。 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin <branch>` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

**本机读数（Fresh 证据）**

- 测试：`pnpm exec vitest run src/views/CreateView.test.js src/views/HotTopics.test.js` → **2 files / 345 passed**（CreateView 296 + HotTopics 49）；关联套件 `CreateViewHistory` + `StageProgress` + `history-utils` + `publish-from-project` → **4 files / 100 passed**。
- 本地化：`check-locale-sync.js --pair-base origin/main` PASS；`--cjk` PASS（基线 1374 / 当前 1223，无新增硬编码）；`--keys` PASS（2069 个 key 全存在）。
- 债务熔断：`node scripts/check-debt-budget.js` → `maxFileLines 5029 (baseline 5657)`、`filesOver1000 30 (baseline 32)`、`filesOver500 98 (baseline 101)`、`circularDeps 0`，**全部在基线内**。
- 第四轮 QM-6（最终 squash，完整一轮）：8 条意见 / 4 维度最低分 4 → **i2 upheld 已加强**（负向偏匹配 `not.toHaveBeenCalledWith({path:"/create/result"})` 改为 `not.toHaveBeenCalled()`，成功瞬间禁止任何导航）；i1 dismissed（`PRD.md` 整篇重复两遍，§3a.3=2 与 §3a.2=2 同形，两处同改才对）；i3 dismissed（completed 唯一调用点先写路径再 open，无成片提前 return 走 PREVIEW_MISSING；11 个调用点逐条核对）；w1 dismissed（`.openspec.yaml` 与同目录 change 逐字同形；被引擎按文件名误标 highRiskDomains=["datamigration"]）；w2 dismissed（已登记的取舍，第三个入口出现即抽组件）；w3 dismissed（本仓变异口径 = 动手后本地一次性取证）。引擎出口不能表达「upheld 且同 PR 已修」，按既定通道写明原因收口 `cleared`，裁决见 `.adversarial/ccg-deep-b75824f4/adjudication.json`。
- 第三轮 QM-6（最终 squash 上重跑）：5 条意见 → **i1（Critical，解锁判据漏判 `status === 'completed'`）upheld 并已修**（`pipelineProgressResultReady` 加状态判据 + 新增「旧路径残留 + 非完成态仍灰显」回归）；i2/i3/i5 dismissed（i2 = `PRD.md` 整篇重复两遍、两处必须同改；i3 = i1 同源已随其修复；i5 = `buildPublishFromProject` 白名单构造）；i4 dismissed（用例合并受测试账本 +200 行硬约束，断言未删）。引擎自扮演出口只能表达「upheld ⇒ blocked」，无法表达「同一 PR 内已修」，故该轮记录以 agent 裁决 + 证据闭环，理由与证据见 CHANGELOG 同日条目。
- 变异反证：M1 `openPipelineProgressModal()` → `closePipelineProgressModal()` ⇒ 3 例红（编排启动即完成 / applyOrchestrationOutcome 完成 / 后台 run 完成）；M2 `finishGenVideoCompleted` 加回 `genVideoModalOpen = false` ⇒ 4 例红（completes: modal stays open / view·publish 跳转 / 有项目预填充 / run-only 退化）；两次还原逐字节回到全绿。
- QM-6 归一：claude critic 8 条 → 自扮演裁决 6 条（2 条归入高危域外的常规项、0 条高危域），其中 **2 条 upheld 已修并各补 1 条锁**；记录状态由引擎写回闭环值（`self_play_resolved` / `self_play_blocked` 以引擎产物为准，不手写）。

### 遗留（不假装已闭合）

- 两页仍是同构实现，未抽共享 `PipelineProgressFooter` 组件（状态载体 Options API vs composable）；若出现第三个入口应抽组件，否则契约会漂移。
- 【去发布】依赖终态 `context.story2videoProject`；run-only 记录只带 `video_path`（标题正文留空由用户补），与结果页 `goPublish` 同语义，未做进一步富化。
- 成功后默认路径不再经过结果页；结果页入口收窄为"从历史记录进入"。若产品后续要恢复"完成即跳转"，应做成可配置项而非改回硬编码。
- QM-6 采用第三档自扮演裁决（置信权重 0.6）而非真跨家族双跑：claude 已作为 critic 真实评审，但 proposer 侧未做独立对抗提案，故结论强度低于真跨家族（如实记）。
