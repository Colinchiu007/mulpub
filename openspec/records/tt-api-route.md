---
record: tt-api-route
task: 头条视频改走 API 轨（复用已有 toutiao-video-publish 实现）
date: 2026-10-23
---

## 本次执行记录：头条视频路由（tt-api-route，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-api-route` |
| 第一性原因（QM-5 ①） | ✅ | `publisher-router.js` L62 把 `toutiao` 写死 `mode:'rpa_vm'`，而仓库已有实网抓包实现的 `packages/api-publish-engine/src/publish/platforms/toutiao-video-publish.js` ⇒ API 轨不可达；RPA 轨在真机反复因页面时序失败（`add-video NO_BTN`、`发布结果缺少平台作品 ID`） |
| 逃逸分析（QM-5 ②） | ✅ | 路由是平台级单值，无法表达「同平台不同内容类型走不同轨」；单元层无内容类型分流用例；审查层未核对「已实现但不可达」的模块 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `createPublisher` 中：`toutiao` + `deps.contentType==='video'` ⇒ `route.mode='api'`；`bootstrap` 在 deps 里补 `contentType`（视频/图文）；`publisher-router` **71 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 分流条件显式写在 createPublisher 内并注释来源，后续可按内容类型扩展其它平台 |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅路由逻辑 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
