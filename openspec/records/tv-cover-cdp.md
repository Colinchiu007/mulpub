---
record: tv-cover-cdp
task: 视频号封面上传改用纯 CDP（去掉必抛的 JS fallback）
date: 2026-10-22
---

## 本次执行记录：视频号封面 CDP（tv-cover-cdp，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-cover-cdp` |
| 第一性原因（QM-5 ①） | ✅ | 视频号封面走 `_setFileInput`，其 JS fallback 用 `input.files = ...` 赋值；FileList 只读 ⇒ 必抛 `Script failed to execute`，且真实 CDP 错误被吞进同一 catch |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「file input 走 JS fallback 必失败」的用例；集成层 `_setFileInput` 无平台区分；E2E 层把该报错当成「封面可选、忽略」；审查层未核对头条已有 `setFileViaCdp` 这一已验证实现 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 视频号封面分支改为 `require('./toutiao-cover').setFileViaCdp(win, path, selector)`（纯 CDP，无 JS fallback）；`rpa-view-platforms` + `toutiao-cover` 合计 **86 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 复用已验证的 `setFileViaCdp`，不再自造第二条 set-file 路径；注释写明失败原因 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线的 `tests/toutiao-cover.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 仅主进程服务层，未改 UI/打包 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机尚未复跑确认封面通过；下一轮跑一次视频号发布看是否还出现 `Script failed to execute`。
- `pre-submit gate blocked: content-not-filled` 仍未定位（`content={…}` 日志被截断），需先补完整读数再改。
