---
record: tt-publish-diag
task: 头条点发布后 dump 可见提示（定位平台为何拒收）
date: 2026-10-23
---

## 本次执行记录：头条发布后诊断（tt-publish-diag，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-publish-diag` |
| 第一性原因（QM-5 ①） | ✅ | 真机 `publishing...` 后始终无「平台作品 ID」，后续 `artifact 未命中：no-endpoint-hit / works-page-timeout` ⇒ 平台未接受提交；源码显示二次确认（bundle 实证的两次点击）**已实现**，因此缺的是「平台拒收原因」这一观测 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「提交被拒」用例；集成层看不到 toast；E2E 层只看到 timeout；审查层未核对「点击后页面是否有可见错误」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 第二次点击后 dump `[class*=error|toast|tip|warn|message]` 的可见文本并记 warn；`rpa-view-platforms` **79 例**通过；行数 1483（零增长容差内） |
| 防止再次发生（QM-5 ⑤） | ✅ | 诊断失败被 catch 包裹，不影响主流程；提示文本会进 app 日志 |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅日志 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
