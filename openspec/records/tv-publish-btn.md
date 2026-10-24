---
record: tv-publish-btn
task: 视频号发布按钮改用精确文案匹配（:has-text 子串误命中「发表视频」）
date: 2026-10-23
---

## 本次执行记录：视频号发布按钮精确匹配（tv-publish-btn，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-publish-btn` |
| 第一性原因（QM-5 ①） | ✅ | 用户两次地面真相：创作者中心无新内容、**草稿箱也为空** ⇒ 内容从未提交。日志显示表单已填（`desc readback=189`、`title readback=16`），但点击发布后页面停在 `/platform/notification/notificationList`（通知中心）⇒ 点击落在错误元素。选择器 `button:has-text("发表")` 为**子串匹配**，会先命中首页「发表视频」上传入口 |
| 逃逸分析（QM-5 ②） | ✅ | 选择器无「精确文案」约束；无「点击后 URL 必须仍在编辑页」的断言；单测只校验选择器存在，不校验匹配语义 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 改为 `button:text-is("发表")` / `div:text-is("发表")` / `button:text-is("发布")`，精确匹配；`rpa-engine` 相关 3 个测试文件 **216 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 发布类按钮一律用 `:text-is`（精确），禁止 `:has-text`（子串）；后续应补「点击后 URL 仍含 post/create」断言 |
| 行尾与 diff 对账 | ✅ | 单行替换 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 配置常量 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
