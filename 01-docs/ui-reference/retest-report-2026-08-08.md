# 参考产品功能重测报告（2026-08-08）

工作树：`C:\tmp\Multi-Publish-mp-retest-20260808`（分支 `codex/mp-retest-20260808`，基线 `origin/main@fe1d04ea`）

## 重测范围
复用真实参考产品逆向分析参考（`D:\Data\projects\_逆向工程_参考产品4.0`）与 2026-07-24 已登录真实客户端的 `mp-live-20260724` 参考图，对账号管理、发布记录、批量管理三个“借鉴参考产品”页面执行真实基线像素审计、功能测试与视觉回归。

## 发现并修复的回归

**回归**：`capture-mp-current.js` 在 480px mobile 视口对账号页布局检查失败：`scrollWidth=575 > clientWidth=480`（横向溢出 95px）。

- 根因：提交 `1a4ad2ad`（fix: keep mp account toolbar on one row）在 scoped 样式块加入 8 列 `grid-template-columns`，其 scoped 属性选择器特异性（0,2,0）高于非 scoped 的 `@media (max-width: 900px) { grid-template-columns: 1fr }`（0,1,0），导致移动端不再折叠为单列。
- 溢出元素：`.account-sort-controls`、`.account-command-bar`、`.filter-tabs`、`.account-count`。
- 修复：在 scoped 块末尾补充 `@media (max-width: 900px)` 覆盖（同特异性、更晚来源生效），恢复单列并允许工具栏 flex-wrap；`filter-tabs` 限制最大宽度并可横向滚动。
- 修复后验证：`/accounts` 与 `/publish/history` 在 480px 下 `scrollWidth=480`、`overflow=0`。

## 验证证据

| 测试 | 结果 |
|------|------|
| mp 当前界面捕获（3 路由 × 3 视口） | 9/9 通过，exit 0 |
| 真实参考产品像素审计（compare-mp） | 3/3 通过；accounts 2.6690%、publish 5.3809%、batch-publish 5.8431%（阈值 10%） |
| 17 视图像素回归 | 17/17 通过 |
| accounts 功能测试 | 14/14 checks，0 console errors，0 page errors |
| publish 功能测试 | 12/12 checks，0 console errors，0 page errors |
| 定向 Vitest（Accounts/account IPC/useAccountEvents/代理对话框） | 117/117 通过 |
| ESLint（Accounts.vue） | 0 errors；4 个既有 unused warning |
| 桌面完整 Vitest | 377 files / 6432 tests passed |

## 边界
- 真实参考图为 2026-07-24 捕获；账号误差从 2.5240% 升至 2.6690%，符合 #357 新增排序控件（参考图无该控件）的预期，仍远低于阈值。
- 像素审计裁剪主内容区域（参考图全幅 2280x1272；当前图裁剪 280,56 起 2280x1272），浏览器外壳与最左侧导航不参与比较。
- 不宣称真实第三方登录、Cookie 恢复、平台发布审核、团队分享、跨设备同步已验证。
