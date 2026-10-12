---
record: hot-topics-publish-ux
task: 热门选题一键发布 UX 优化：按钮改名「改写并发布」+ 单条行内发布按钮（单篇一键改写）+ 改写稿内联预览/编辑与回写 + 发布页确认横幅 key + 专项 PRD
date: 2026-10-12
---

## 本次执行记录：热门选题一键发布 UX 优化（hot-topics-publish-ux，2026-10-12）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（apps/desktop/src/**）：隔离 worktree D:\Data\projects\mp-worktrees\mp-hot-topics-publish-ux + 裸分支 hot-topics-publish-ux，经 scripts/start-mp-task.ps1 创建，依赖就绪验证 verify-worktree-deps OK |
| 第一性原因（QM-5 ①） | ✅ | 非缺陷修复，为新功能/UX 优化：痛点三源（按钮名不副实/改写结果黑箱/单条路径缺快捷入口），现状取证见 01-docs/PRD-HOT-TOPICS-PUBLISH-UX-2026-10-12.md §1；自动封面兜底经取证已存在（usePublishFlow）故列非目标 |
| 逃逸分析（QM-5 ②） | N/A | 非 Bug 反哺任务 |
| 修复 + 回归保护（QM-5 ④） | ✅ | TDD：先写 src/views/hot-topics-publish-ux.test.js 8 例（RED 确认 8/8 失败）再实现（GREEN 8/8）；既有回归 HotTopics.test.js 45 例（其中「去发布」跳转断言补 flushPromises 适配 goToDestination async 化）、Publish.test.js 111 例、useBatchPublish.test.js 84 例全绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | 三条教训落 01-docs/learnings.md（能力先探再设计方案 / async 化跳转破坏既有测试面 / i18n 契约断言锚点与 utf8 陷阱）；回归锁 8 例接 vitest CI |
| 行尾与 diff 对账 | ✅ | git diff --numstat 与 --ignore-cr-at-eol --numstat 两口径一致（新增文件 LF 正常入库，无 CJK 噪声删改） |
| 接线棘轮 | ✅ | hot-topics-publish-ux.test.js 位于 apps/desktop/src/views/，由既有 unit workflow glob 覆盖（与 HotTopics.test.js 同目录同模式），单元测试 + Lint job PASS |
| QM-1 打包 / QM-4 视觉 | ✅/N/A | 未触 electron/ 主进程与 rpa-engine → QM-1 N/A（CI build job PASS 兜底）；UI 变更为既有列表行内加按钮 + 进度区加编辑块，沿用既有组件类（cohere-btn-primary/secondary）与局部样式，无视觉基线破坏，CI Visual job 按白名单跳过 |
| QM-6 CCG 双模型外部评审 | ⚠️ | pre-commit CCG 门禁执行：审查模式 SINGLE（变更 ≤200 行常规专家分派），3 项通过，判定落盘 .ccg/reviews/*.json 随提交入库；deep-review 跨家族对抗未执行（本机 wrapper 就绪但按 SINGLE 模式判定不强制） |
| 远程同步 | PASS | PR #3404 squash 合并：merge SHA 6cce888d5d26acc1d29cb05add2acf05fff8c2a9（2026-10-12T14:06:12+08:00）；`git ls-remote --heads origin hot-topics-publish-ux` 返回 0 行，远端分支已删 |

### 遗留（不假装已闭合）
- 发布页确认横幅（publishPage.handoff.banner）本轮只落 key 与契约测试，Publish.vue 宿主接线为后续小 PR（宿主在零增长容差清单）。
- 自动配图（搜图/AI 生图）明确不做（版权/成本），自动封面兜底已覆盖图文平台无图场景。
