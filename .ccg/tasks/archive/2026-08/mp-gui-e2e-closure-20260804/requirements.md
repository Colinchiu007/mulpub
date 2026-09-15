# GUI E2E 收口分析

## 证据
- PR #355 的 GUI Tests 在 `08708d2` 失败；本地 Windows 同一套路由/集成流通过，CI Ubuntu 在首次加载 `/publish` 与 `/accounts` 时出现 3-5 秒选择器超时。
- CI 截图显示页面最终渲染完整，说明不是 UI 缺失，而是首次 Vite/组件编译与异步平台数据加载超出旧测试等待窗口。
- 账号卡片当前 `AccountManagementCard` 已有未提交的“验证”按钮改动；原测试依赖“验证”但旧卡片没有该入口，导致跨版本契约漂移。
- 账号添加按钮已有 `data-testid="account-add"`，发布页此前缺少标题、编辑器、发布目标、提交按钮的稳定 testid。

## 根因
1. E2E helper 用 5 秒/3 秒固定等待，未等待发布页的 feature-ready 条件。
2. 发布/流程测试混用 placeholder、文本和通用 checkbox 选择器，首屏异步渲染或页面重置时容易选不到目标。
3. 账号测试仍寻找旧 `.account-row button:has-text("验证")`；当前卡片只保留设置/删除/失效重新登录，且验证入口的改动尚未提交。
4. Flow 5/6 的离线/错误失败是发布表单未就绪后的级联失败，不是 IPC mock 缺少 `offlineAddToCache`/`publishBatch`。

## 本轮实施与验证

- `FunctionalRunner` 首次挂载与重置路由等待预算统一为 15000ms；发布/账号集成流增加 feature-ready 条件，避免页面仍在异步挂载时继续操作。
- 发布页改用 `publish-title`、`publish-editor`、`publish-target-selector`、`publish-submit`、`publish-batch-mode` 和 `publish-progress` 稳定合同；账号页使用 `account-add` 与 `verify-*` 合同。
- IPC 断言对发布、离线缓存和失败路径记录操作前 baseline，并等待调用计数增量；Flow 5/6 同时等待离线状态、错误 UI 和对应 IPC。
- 路由结果页等待完整 query hash；链接扫描不再使用 Playwright 不支持的 `filter({ visible: true })`；旧账号/发布 E2E 已迁移到当前 DOM 合同。
- 账号/发布定向单测：3 files / 28 tests passed。
- 路由 functional E2E：18/18；发布 12/12、账号 14/14。
- 集成流：Flow 1–6 共 44/44 checks passed。
- `npm run build:vue`：exit 0；像素视觉门禁：17/17 passed。
- 桌面完整 Vitest：357 files / 6107 tests passed。

## PR #355 GUI 门禁复盘

- 新 SHA `f52e37d` 的 GitHub `gui-test` 首次仍失败：账号页基线将 8 个按钮计为平台筛选。
- 根因是 `selectors.json` 使用 `.platform-filter-panel button`，该范围同时包含嵌套的分组筛选按钮；不是账号页面平台数据或渲染缺失。
- 修复为 `button[data-testid^="platform-filter-"]`，只匹配稳定的平台筛选 testid。
- 修复后本地真实 Electron GUI v9 复跑通过：`60/60`，控制台错误 `0`，页面错误 `0`。
- 修复提交 `2d4cf9c` 的 PR #355 远端检查全部通过，并已用合并提交 `f629765` 实际合并到 `main`。

## 审查边界

- Antigravity wrapper：`agy command not found in PATH`。
- Claude wrapper：exit code 1。
- 两个外部模型均未产生可用独立审查报告；不能将其标记为通过。已完成本地静态审查、语法检查、组件/路由/集成/视觉和完整 Vitest 验证。

## 外部模型分析
- Antigravity wrapper：`agy command not found in PATH`。
- Claude wrapper：退出码 1。
两次调用均未产生可用独立分析，按质量规则记录为未完成，不伪装为通过。
