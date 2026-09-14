# GUI 工作区选择器回归复盘

## 根因
`origin/main` 合并 Mp 工作区后，`/accounts` 与 `/publish` 路由改用 `MpModuleNav`，不再渲染旧的 `.cohere-sidebar` 和 `.cohere-topnav`。Electron GUI v9 仍把这两个旧选择器当作账号页的固定合同，因此在业务页面均通过后，侧边栏/顶部导航专项误报失败。

## 逃逸链
- 单元测试：未覆盖 Electron 真实 DOM 组合，未拦截。
- 浏览器 E2E：覆盖业务表单和路由，未覆盖旧导航选择器合同，未拦截。
- 视觉回归：截图流程通过，但没有把旧选择器存在性作为失败条件，未拦截。
- CI GUI：首次在 Mp 合并后的完整窗口中暴露，定位到测试合同过时。
- 代码审查：合并 Mp 导航时缺少“旧导航合同迁移/兼容”检查项。

## 修复与回归保护
- 保留 `cohere-main` 兼容类，避免依赖该布局类的既有选择器失效。
- GUI v9 在 `/accounts` 检测新版 `data-testid="mp-module-nav"` 时，断言模块标签数量和“账号管理”激活；旧版页面继续执行原侧边栏/顶部导航断言。
- `node --check apps/desktop/tests/electron-gui-v9.js` 通过；Vue 生产构建通过；远端 GUI/Quality Gate 作为最终回归证据。

## 预防措施
今后导航/工作区替换必须同时更新稳定 `data-testid` 合同、GUI 测试分支断言和视觉回归基线；不得只依赖历史 CSS 类名。