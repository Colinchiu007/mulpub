---
record: tv-cdn-hosts
task: 视频号三段式上传改用逆向实证的分步主机
date: 2026-10-23
---

## 本次执行记录：视频号分步 CDN 主机（tv-cdn-hosts，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-cdn-hosts` |
| 第一性原因（QM-5 ①） | ✅ | **逆向实证**（`reverse-two-competitors/01-analysis/融媒宝-完整拆解.md` §5.8 对照表）：竞品原生层三段式的三步**主机不同** —— `applyuploaddfs`/`completepartuploaddfs` → `finderassistancea.video.qq.com`，**`uploadpartdfs` → `finderassistanced.video.qq.com`**；本项目此前三步共用同一 baseURL，与实证不符 |
| 逃逸分析（QM-5 ②） | ✅ | 单元测试注入假 cdn 客户端、只断言相对路径 ⇒ 主机差异在测试层不可见；实现层把「同一协议」误当成「同一主机」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `RE_HOST_APPLY` / `RE_HOST_PART` 常量；注入客户端时（测试/自定义）仍用相对路径，真实运行时用分步主机；`shipinhao` 相关 **15 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 主机与路径分离为常量，并注明逆向出处，后续改主机不再散落在三处 |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 常量与 URL 拼接 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
