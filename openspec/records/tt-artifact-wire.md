---
record: tt-artifact-wire
task: 把头条 artifact 判据接进发布成功判定
date: 2026-10-22
---

## 本次执行记录：头条 artifact 接线（tt-artifact-wire，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-artifact-wire` |
| 第一性原因（QM-5 ①） | ✅ | `_verifyPublishSuccess` 只有 url/api/dom 三模式：url 因页面不跳转必超时；api 因 RPA 轨 `rp` 恒 null 不触发；dom 因无成功文案不命中。artifact 模块已合入但**未接线**，所以头条判定仍然走必超时的 url |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「平台分支优先级」用例；集成层 `_verifyPublishSuccess` 无 toutiao 专属路径；E2E 层把超时当未发布；审查层未核对「模块已合入但调用点未接」这一形态 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 在 `const mode = config.success_mode` 之前插入 toutiao 分支：先调 `confirmPublished`，命中即返回 `{ok:true, mode:'artifact'}`，异常时回落原逻辑；`rpa-view-platforms` + `toutiao-artifact` 合计 **87 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 判据优先级显式写在代码注释里（artifact → 回落 success_mode），避免再次出现「模块存在但无人调用」 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线的 `tests/toutiao-artifact.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 仅主进程判定分支，未改 UI 与打包配置 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机尚未在接线后跑一次头条发布确认 `mode:'artifact'` 命中；下一轮验证。
- 视频号仍待一次真机验证（`content frame found → desc filled`）。
