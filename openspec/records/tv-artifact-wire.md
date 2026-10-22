---
record: tv-artifact-wire
task: 视频号作品列表判据接进发布验证链
date: 2026-10-23
---

## 本次执行记录：视频号 artifact 接线（tv-artifact-wire，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-artifact-wire` |
| 第一性原因（QM-5 ①） | ✅ | 视频号发布后页面重置为壳页，`_verifyPublishSuccess` 的 url/dom 模式均不命中 ⇒ verify timeout；判据模块 `tencent-artifact` 已合入但**无调用点** |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「平台专属 artifact 分支」用例；集成层判据单一；E2E 层把 timeout 当失败；审查层未核对「模块已合但未接线」这一形态（本会话已出现两次） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 在 toutiao artifact 分支旁插入 `tencent_video` 分支：先查作品列表，命中即返回 `mode:'artifact'`；`rpa-view-platforms` + `tencent-artifact` 合计 **79 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 接线点选在**已有 artifact 分支内部**（唯一锚点），避免上一版误插到同名 `if (platform === 'toutiao')` 的另一处 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机未验证；判据：发布后日志出现 `[tencent_video] artifact 命中作品列表`。
