# 需求与根因

CI 视觉像素门禁在 `/accounts` 等待 `.mp-workspace .page-title:has-text("账号管理")`，而参考产品复刻账号页为了保留无障碍语义使用 `.accounts-page` 加 `sr-only` 标题，页面没有可见 `.page-title`。本修复只更新视觉/功能测试的就绪选择器为稳定的 `.mp-workspace .accounts-page`，不改变用户可见 UI 或账号流程。

回归范围：像素门禁、全视图视觉测试、功能测试、条件等待测试。
