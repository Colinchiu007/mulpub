---
record: tv-artifact-order
task: 视频号作品列表判据挪到验证入口（此前被 url/dom 判据抢先超时）
date: 2026-10-23
---

## 本次执行记录：视频号判据顺序（tv-artifact-order，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-artifact-order` |
| 第一性原因（QM-5 ①） | ✅ | #4260 把 `tencent_video` 的 `confirmPublished` 插在 `toutiao-artifact` 分支旁，而该位置在 url/dom 判据**之后**；视频号发布后页面重置为壳页 ⇒ url/dom 先 timeout 抛出，artifact 永远跑不到。真机 20:26:52 实测：`publish verification timeout` 且**无任何 artifact 日志** |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「判据顺序」用例；集成层只测函数存在；E2E 层把 timeout 当失败；审查层未核对调用顺序 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 将该分支移到 `_verifyPublishSuccess` **函数入口**（任何 url/dom 逻辑之前），命中即返回 `mode:'artifact'`；`rpa-view-platforms` + `tencent-artifact` 合计 **84 例**通过；行数 1483（零增长容差内） |
| 防止再次发生（QM-5 ⑤） | ✅ | 判据按「先看用户可见结果、再看页面信号」排序；入口注释写明原因 |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
