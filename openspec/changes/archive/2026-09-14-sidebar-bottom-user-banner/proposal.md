## Why

应用壳（左侧侧边栏 + 右侧工作区）当前的系统级入口分布零散且含无效信息：

1. 登录区占据**左上角**，与主导航争夺视觉焦点，导航层级不清；
2. 模块导航**右上角**有 4 个入口（移动端预览 / 客服支持 / 使用指南 / 通知），其面板内容全部是占位说明文案（"当前工作区尚未接入在线客服服务""暂无新通知"），提供零价值信息却占据视觉热区；
3. 「服务连接信息」「升级 Pro」散落在左下角，与登录区分离，入口碎片化；
4. 主流桌面客户端（参考客户端 Claw）已普遍采用「底部收起 banner → 点击向上展开完整用户菜单」的成熟范式。

本次把这些入口收敛到侧边栏底部一个可展开的 banner，并清理模块导航右上角的占位入口。

## What Changes

- **登录区下移**：`ProfileMenu` 改造为底部形态（面板向上展开）并迁移到侧边栏 footer，收起时只显示一条 banner，点击**向上展开**菜单；展开面板与 banner 同宽且不溢出侧边栏。
- **「设置」迁入菜单**：主导航移除设置按钮，改由菜单项 `profile-menu-settings`（文案 `nav.settings`）承载，点击先关菜单再抛 `open-settings`（侧边栏透传 `App.vue`，链路不变）。
- **「⭐ 升级 Pro」迁入菜单**：footer 原独立胶囊按钮移除，改由菜单项 `profile-menu-upgrade`（文案 `memberCenter.upgradePro`）承载，复用 `.profile-menu-action` 版式（仅金色强调），仅非 Pro 显示，点击抛 `upgrade` 由侧边栏打开升级弹窗。
- **服务连接信息上移**：footer DOM 顺序固定为 [0] 服务连接信息 → [1] 用户 banner。
- **状态行合并**：footer 原「客户端状态」独立文字行移除，信息下沉为 banner 状态点 + `title` + 菜单标题区状态文案。
- **占位入口移除**：`MpModuleNav` 的右侧工具区、工具面板、脚本状态与样式整体删除。
- **header 改造**：登录区移出后，header 改为品牌区（`MP` 标识 + `Multi-Publish` + `+ 新建发布`）。

## Capabilities

### New Capabilities

- `desktop/navigation-shell`: 定义应用壳导航与用户入口契约 —— 登录区位置与展开行为、底部区域层级顺序、系统级入口（设置 / 升级）归属、模块导航内容边界、键盘与无障碍契约、身份状态降级。

### Modified Capabilities

- 无既有 spec 需要修改（本次不改动 IPC / 数据契约 / i18n 文案集；`ProfileMenu` 仅新增两个 emit，既有 props / emit 语义不变）。

## Impact

- **受影响代码**：`apps/desktop/src/layouts/MpSidebar.vue`、`apps/desktop/src/layouts/MpModuleNav.vue`、`apps/desktop/src/components/ProfileMenu.vue` 及对应 3 个单测文件。
- **不受影响**：账号认证 / 身份服务 / 服务状态轮询的 IPC 与数据契约；`SettingsDialog` 与 `UpgradeModal` 内部结构；侧边栏宽度（`--mp-sidebar-width: 200px`）；「更多」二级菜单路由清单。
- **依赖**：无新增第三方依赖。
- **风险**：低—中（纯渲染层布局调整，无业务逻辑与持久化变更；由 3 个组件测试 26 用例 + CI 像素视觉门禁保护）。
