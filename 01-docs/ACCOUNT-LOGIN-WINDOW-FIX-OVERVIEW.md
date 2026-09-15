# 本次交付总览：账号「去登录」登录页顶部重叠修复

**日期**：2026-09-08 ｜ **PR**：[#1557](https://github.com/Colinchiu007/Multi-Publish/pull/1557)
**分支**：`fix-wechat-login-tab` ｜ **提交**：`582f267e`（8 files, +451 / -16）
**worktree**：`D:\Data\projects\mp-worktrees\mp-fix-wechat-login-tab`

---

## TL;DR

| 项 | 结论 |
|---|---|
| 你的判断 | ✅ **正确** —— 不应使用浮层内嵌，应改为独立承载 |
| 但需注意 | 不能直接用外部浏览器标签页（`createTab` 无凭证捕获，登录存不下） |
| 实际方案 | 改为**独立 BrowserWindow 窗口**承载，保留全部凭证捕获能力 |
| 根除效果 | 登录视图从 `(0,0)` 铺满独立窗口，**彻底消除与主窗口 DOM 的重叠** |
| 交付状态 | 已提交、已推送、PR 已开（auto-merge 待 CI） |

---

## 一、问题与根因

**现象**：账号管理 → 已保存公众号卡片 →「去登录」→ 登录页顶部重叠数层。

**根因**（`auth-view-manager.js`）：登录页作为 `WebContentsView` **内嵌**到主窗口
`contentView`，坐标依赖硬编码常量：

```js
const AUTH_VIEW_TOP = 76        // 假设 TabBar(36) + NavBar(40)
const SIDEBAR_WIDTH_DEFAULT = 200
```

账号管理页顶部**还有自身 header / 工具栏 / 搜索栏**，实际可用区起点远高于 76px，
于是「平台页顶栏 + 应用 TabBar/NavBar + 页面 header」挤在有限顶部空间内。

内嵌模式坐标必须与主窗口 DOM 严格同步，而布局随页面切换 / 侧边栏折叠 / 窗口缩放变化
→ **架构性缺陷，调参无法根治**。同仓 `oauth-manager.js` 也是同一模式（遗留风险）。

## 二、方案选型

| 方案 | 消除重叠 | 保留凭证捕获 | 结论 |
|---|---|---|---|
| A 调大 `AUTH_VIEW_TOP` | ⚠️ 治标 | ✅ | ❌ 换页面仍错位 |
| B 外部浏览器标签页 | ✅ | ❌ **丢失** | ❌ 不可用 |
| C 渲染进程上报真实高度 | ✅ | ✅ | ⚠️ IPC 竞态 |
| **D 独立 BrowserWindow** | ✅ | ✅ | ✅ **采用** |

**关键约束**（`Accounts.vue:838-839` 原注释）：`openLoginPage`（`tabStore.createTab`）
无凭证捕获机制，登录成功也无法保存 → 排除方案 B。

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `electron/services/auth-view-manager.js` | 新增 `_createLoginWindow()`；`openLogin()` 改独立窗口承载；resize 同步布局；窗口关闭按「取消登录」结算；`close()` 销毁窗口；`contentView` 不可用降级告警 |
| `src/locales/{zh,en}.js` | `loginStateBrowser` 文案更新（zh/en 成对） |
| `test-setup.js` | 补 `BrowserWindow` mock（contentView / getContentBounds / destroy / isDestroyed）；`WebContentsView` 的 `setBounds` 改 `vi.fn` |
| `electron/services/auth-view-manager.test.js` | 新增 3 条回归测试 |
| `01-docs/PRD-ACCOUNT-LOGIN-WINDOW.md` | **新增** 249 行专项文档 |
| `01-docs/PRD.md` | 4 处「内嵌登录」描述同步更新 |
| `CHANGELOG.md` | 追加条目 |

## 四、文档要点（详见 PRD-ACCOUNT-LOGIN-WINDOW.md）

- **数据校验**：主窗口初始化、平台支持、凭证捕获、会话有效性、Cookie 域名过滤、
  IndexedDB ≤512KB、初始重定向期不误判 —— 7 项校验点与失败处理
- **流程**：打开 / 结算（CDP·URL·手动·Esc·关窗·超时）/ 关闭与资源回收
- **功能逻辑**：独立窗口 1180×820（最小 900×640），`modal:false` 可切回主窗口
- **交互逻辑**：6 类场景行为表
- **显示项**：登录状态条的平台图标 / 平台名 / 状态文案 / 操作按钮
- **提示文字**：zh/en 对照表（`loginStateBrowser` 等 7 项）

## 五、回归测试

| 用例 | 断言 |
|---|---|
| 独立窗口承载，不再内嵌主窗口 | `loginWindow` 非空；**`mainWindow.contentView.addChildView` 未被调用** |
| 布局从原点铺满 | `setBounds` 末次调用 `x===0 && y===0` |
| 关闭后窗口销毁 | `loginWindow===null`、`win.isDestroyed()===true` |

## 六、遗留项（建议后续处理）

1. `oauth-manager.js` 仍为内嵌模式，有同类坐标错位风险
2. `openSavedAccount()` 仍走内嵌路径（本次聚焦「去登录」主链路）
3. 建议抽公共「认证窗口」基类，供 AuthView / OAuth / 扫码三种模式复用

## 七、过程备注

分支名未用 `codex/` 前缀：本环境 `codex/*` 命名空间 ref 静默写盘失败
（`git worktree add -b codex/...` → `invalid reference`），改用无斜杠分支名
（仓库有 `mp-upload` 先例）。该坑已记入项目记忆。
