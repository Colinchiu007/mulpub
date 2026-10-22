---
record: tv-gate-fix
task: 视频号封面走纯 CDP + 内容报告不被通用链路覆盖
date: 2026-10-22
---

## 本次执行记录：视频号两处缺陷修复（tv-gate-fix，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-gate-fix` |
| 第一性原因（QM-5 ①） | ✅ | ①封面：视频号实际走 `coverSel` 那条 `_setFileInput`，其 JS fallback 对 file input 必抛（上一 PR 改的是另一条 `sel.cover_input[0]` 分支，没命中）②内容：frame-aware 已把正文写入子 frame（readback=170），但通用链路随后在主 frame 找不到编辑器并把 `fillReport.content` 覆盖成 `ok:false`，门禁据此拦截 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「两条 cover 分支都要走 CDP」的用例；集成层无「frame-aware 成功后通用链路必须跳过/不得覆盖」的用例；E2E 层把 `content-not-filled` 当成真未写入；审查层未核对实际执行的是哪条 cover 分支 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`coverSel` 分支对 `tencent_video` 改为 `setFileViaCdp`；②通用链路失败时若 `fillReport.content.ok` 已为 true 则不覆盖；`rpa-view-platforms` + `toutiao-cover` 合计 **86 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 同一条 set-file 修复覆盖**两条分支**；内容报告加「已成功则不覆盖」的幂等保护 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅主进程服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机尚未复跑；下一轮跑一次视频号，判据：不再出现 `Script failed to execute`，且门禁不再报 `content-not-filled`。
