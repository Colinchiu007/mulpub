# 测试矩阵

| 项目 | 结果 |
|---|---|
| 账号页选择器回归 | `visual-ci.test.js` + `condition-waiting.test.js`，40/40 |
| 像素视觉门禁 | 17/17，账号页基线刷新后通过 |
| 全视图视觉路由 | 24 个路由通过 |
| 账号/发布既有定向回归 | 7 files / 139 tests |
| 外部审查 | Antigravity 不可用；Claude exit 1 |

## 根因与逃逸链

- 根因：`Accounts.vue` 使用 `.accounts-page` + `sr-only` 标题以保持参考产品布局和无障碍语义，CI `run-pixel-tests.js` 仍等待旧 `.page-title`。
- 逃逸：页面组件回归、参考产品专用截图脚本已使用 `.accounts-page`，但共享像素门禁、全视图和功能测试保留旧选择器；本地专用视觉通过而 CI 共享门禁失败。
- 系统性修复：四个共享测试入口统一稳定容器选择器，并新增测试断言防止回退；预期 UI 改版同步更新批准基线。
