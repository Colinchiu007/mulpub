---
record: upload-donecopy-fix
task: 移除 doneCopy 中的「设置封面」（静态文案导致上传完成误判）
date: 2026-10-23
---

## 本次执行记录：上传完成误判修复（upload-donecopy-fix，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `upload-donecopy-fix` |
| 第一性原因（QM-5 ①） | ✅ | 头条真机：视频未附加却仍点发布。链路核查：门禁 `publish-precondition` 正确（`upload.ok!==true` 即拦）、接线正确（`if(!gate.ok) return`）、报告写入正确 ⇒ 唯一漏洞是 `_waitForVideoUploadComplete` 误判完成。`doneCopy` 含静态文案「设置封面」，该按钮在上传前即存在 ⇒ doneCopy 恒真 ⇒ `uploadDone` 为真 ⇒ `fillReport.upload.ok=true` ⇒ 门禁放行 ⇒ 空点发布（消耗 60–80 分钟窗口） |
| 逃逸分析（QM-5 ②） | ✅ | 无 upload-waiter 专项测试；真机只验证过「能收敛」，未验证「不该收敛时不收敛」（缺变异反证） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 从 `doneCopy` 正则移除 `设置封面`，保留 `上传成功/上传完成/上传完毕/检测为高清`（2026-10-21 真机实测西瓜上传成功页明写「上传成功」，故不影响正常收敛） |
| 防止再次发生（QM-5 ⑤） | ✅ | 静态 UI 文案不得作为「完成」证据——只有语义上表示"已完成"的词才可入 doneCopy |
| 行尾与 diff 对账 | ✅ | 单行替换 |
| 接线棘轮 | N/A | 无专项测试文件（已在记录中说明） |
| QM-1 打包 / QM-4 视觉 | N/A | 单行正则 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
