# 认证页面内嵌主窗口全屏标签 — PRD

> 变更 ID: auth-inline-tabs | 状态: 已完成 | 分支: csdwe/auth-inline-tabs | PR: #1677

## 1. 需求背景

原认证系统使用独立 BrowserWindow 承载登录/扫码/OAuth 页面，存在无用户反馈、窗口分离等问题。参考产品逆向分析分析表明认证就是普通标签（isAuth:true），无需独立窗口。

## 2. 功能需求

### 核心交互
- 点击"去登录" → 主窗口内嵌 WebContentsView（定位 TabBar+NavBar 下方，y=76，x=sidebarWidth）
- NavBar 在登录标签激活时显示"保存账号"按钮
- 用户登录 → CDP/URL 自动检测完成 → 提取 Cookie+localStorage+IndexedDB
- 用户点击"保存账号" → completeLogin → 持久化凭证 → 关闭视图
- TabBar × / Escape 关闭登录视图 → 回到原页面

### 显示规则
- "去登录"按钮：仅当前会话中 checkedExpiredIds Set 包含的账号显示（非数据库 status 字段）
- 账号卡片状态：offline 显示"已登录"，仅 checkLogin 明确检测失效的才标记过期

## 3. 技术方案

### 主进程
- auth-view-manager.js / qrcode-login.js / oauth-manager.js → mainWindow.contentView.addChildView + _positionView
- webview-manager.js → 虚拟 isLogin 标签：打开时创建虚拟标签、_hideAllTabs()，关闭时 removeChildView + 恢复之前标签

### 前端
- App.vue → isLoginTab 时隐藏 router-view（消除 WebContentsView 与 Vue 渲染重叠）
- NavBar.vue → isLoginTab 时显示"保存账号"按钮
- TabBar.vue → 展示 isLogin 虚拟标签，支持点击切换和关闭
- Accounts.vue → addAccount/reloginAccount 统一走 AuthViewManager
- AccountManagementCard.vue → checkedExpiredIds prop 控制去登录按钮显示

### 数据校验
- Cookie 只提取 isPlatformCookieDomain 范围内的
- localStorage 过滤 __ 前缀 key
- IndexedDB ≤ 512KB JSON 安全快照
- URL 导航：初始加载完成前的重定向链不判定为登录成功（百家号等 fail-closed）
- 恶意外部 URL 注入成功路径在 query 中被拒绝

## 4. 测试
- auth-view-manager.test.js: 26/26 通过
- qrcode-login.test.js: 15/15 通过
- oauth-manager.test.js: 4/4 通过
- 总计 45/45 全部通过
- Vite 生产构建通过
- Electron 启动正常主窗口可见

## 5. 变更历史
- 645b8668: 认证页面改为内嵌主窗口全屏标签（参照参考产品 isAuth 模式）
- cacb47d2: close() 加 removeChildView
- d8ca4ecc: completeLogin 会话已结束时静默返回成功
- a7d9aa78: "去登录"改用前端本地 Set 跟踪
- 564b042e: 恢复 Close 图标导入
- 88776a35: 登录完成后不再跳转首页
- 5fd6e61a: 修复 AccountManagementCard 代码腐坏 + webview-manager 语法错误
