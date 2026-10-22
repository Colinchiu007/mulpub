---
record: tt-artifact
task: 今日头条发布后判定改为查作品列表（复用逆向成果端点）
date: 2026-10-22
---

## 本次执行记录：头条 artifact 判据（tt-artifact，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-artifact` |
| 第一性原因（QM-5 ①） | ✅ | 头条发布后**页面不跳转且无成功文案**（publish verify snapshot 实测仍停在表单）；`success_mode` 未配置 ⇒ 默认 `url` ⇒ 必然超时。`api` 轨不可用（`rp` 仅 API 轨非空，RPA 轨恒 null），`dom` 轨不可用（无成功文案） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无 artifact 判据测试；集成层 `_verifyPublishSuccess` 只有 url/api/dom 三模式；E2E 层此前把「超时」当成「未发布」；审查层未核对 `rpa-view-artifacts.js` 只有百家号分支、头条根本没有该能力 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `electron/services/toutiao-artifact.js`（probeEndpoints / probeWorksPage / confirmPublished），端点取自逆向成果 `01-analysis/mtm-platform-apis.md`；回归 `apps/desktop/tests/toutiao-artifact.test.js` **8 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 判据改为「作品列表端点返回体命中标题」+「作品管理页 DOM 命中」双路，二者都不命中即失败（不假成功）；已记入记忆与 EverOS |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | `tests/toutiao-artifact.test.js` 由 `apps/desktop/tests/run-tests.js` 聚合执行 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅新增主进程服务模块，未改 UI 与打包配置 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 本 PR **只交付判据模块与测试**，尚未接进 `rpa-view-platforms` 的 `_verifyPublishSuccess`（该文件有零增长容差，接线需同步压缩注释，单列一个 PR）。
- 真机尚未验证这三个端点在本账号登录态下的返回体是否含标题；下一轮真机跑一次头条发布并抓 `confirmPublished` 的结果。
