# 会员中心 + 左上角头像入口 — 分析与方案设计（opencode 分析报告）

> 任务：`.ccg/tasks/member-center-avatar-entry/task.json`
> 阶段：analysis（本报告为产出物，尚未进入代码阶段）
> 结论先行：**同意「会员中心独立路由页」方向；不同意「未登录点头像直接弹登录」——改为统一弹 ProfileMenu（菜单首项为「立即登录」）。**

---

## 第 1 节 功能清单评审（P0/P1/P2 分级）

### 总原则

- **能不做就不做**：本任务不新增任何后端接口、不新增任何 IPC 通道（现有 `identity:*`、`license:*`、`payment:*` 均已在 `PUBLIC_CHANNELS`，见 `apps/desktop/electron/ipc-handlers/license-access-control.js:6-58`，未登录可读）。
- 会员中心定位 = **只读聚合展示** + **复用现有操作**（登录/切换/退出/升级），全部数据已存在于 `identity` store 与 `license` store。

### P0（必须，数据全在本地 store，成本最低）

| 卡片 | 数据来源 | 说明 |
|------|----------|------|
| 账号信息卡 | `identity.user` + `identity.status` | 头像（picture/首字母）、昵称、用户名、登录状态、切换账号/退出 |
| 版本会员卡 | `license.info` | `type`(free/pro/trial)、`daysRemaining`、升级 Pro（复用 `UpgradeModal.vue` 逻辑） |
| 登录权益卡 | `identity.entitlement` | `plan`/`features[]`/`source`(online/offline)/`expiresAt`（签名快照 exp） |
| 未登录空态 | `status` | 引导文案 + 「登录」按钮（`signIn()`）+ 「查看版本权益」锚点 |
| 关于卡 | `app:get-version` | 版本号（现有 `app:get-version` public 通道） |

### P1（有价值，需小幅前端扩展）

| 卡片 | 数据来源 | 说明 |
|------|----------|------|
| 配额卡 | `entitlement.quota` | ⚠️ **当前未透传**：`EntitlementService.normalizeEntitlement`（entitlement-service.js:24-25）已算 quota，但 renderer `stores/identity.js` 的 `normalizeState`（identity.js:29-37）只挑 plan/features/source/expiresAt，**丢弃 quota**。需在 normalizeState 补 `quota` 透传 + 测试。若嫌改动可 P2 砍掉。 |
| 设备标识 | 主进程 deviceId | `EntitlementService` 的 `deviceId` 未暴露给 renderer；需在状态桥透传 `deviceId`（脱敏展示后 4 位） |

### P2（砍掉或延后）

| 候选 | 砍掉理由 |
|------|----------|
| 上传头像 / 改昵称 | 需后端 `/api/v1/me` 写接口，无后端支持，明确不做 |
| 设备管理（下线其他设备） | 需后端设备会话接口 |
| 订单/支付历史 | `payment:list-orders` 虽 public，但价值低、无既有 UI，可延后 |
| 在线/离线账号操作日志 | 无数据源 |

**结论**：P0 五卡全做，P1 配额卡/设备标识按"补透传是否顺利"决定，P2 全部砍。

---

## 第 2 节 交互方案评审：未登录点头像「直接弹登录」 vs 「统一弹菜单」

### 结论：统一弹菜单（ProfileMenu）更优，不采纳「直接弹登录」

### 理由

| 维度 | 直接弹登录 | 统一弹菜单 |
|------|-----------|-----------|
| **可用性** | 未登录时点头像必跳登录流程，用户无法先了解"登录能得到什么"（会员/权益/版本对比都在登录墙后），转化意图被压制 | 菜单含「登录」主项 + 「会员中心」，未登录也可先看权益再决定登录 |
| **可发现性** | 登录弹窗是 BrowserWindow modal，一上来打断当前工作；用户若误点（头像 30px，紧邻「新建发布」按钮）即弹窗 | 弹菜单是非破坏性操作，误点直接 Esc/点外部关闭 |
| **与其他入口一致性** | 顶部 `MpModuleNav` 的 `IdentityMenu` 已是"头像→下拉菜单"心智；侧栏头像若变成"点了就弹登录"，两处入口行为分裂 | 与 `IdentityMenu` 行为一致（菜单模式），学习成本为零 |
| **状态覆盖** | 直接 `signIn()` 只对 `signed_out` 合理；`expired`/`error`/`refreshing` 状态直接弹登录会与 store 的 `runExclusive`（identity.js:72-83）竞争或误触 | 菜单可按 status 分支渲染（已登录→会员中心/切换/退出；未登录→登录/会员中心；disabled→提示身份服务未启用），天然覆盖全状态 |
| **误触风险** | 高 | 低 |

### 保留用户诉求的折衷

用户明确认为"未登录点头像弹登录弹窗合理"。折衷：**未登录时点头像→弹出 ProfileMenu，菜单首项就是高亮的「⚡ 立即登录」按钮**，用户只需"点头像 → 点登录"两下，且登录窗口复用现有 `IdentityAuthWindow`（主进程 modal BrowserWindow，520x720，已可用）。这比直接弹窗多一次点击，但换来：防误触、可先看权益、状态全覆盖。若产品最终仍坚持一键直达，可把"未登录默认直接 signIn"做成开关——**但本报告不推荐**。

---

## 第 3 节 技术方案：文件划分 / 路由 / i18n / 测试清单

### 新建文件

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/views/MemberCenter.vue` | 会员中心页面（五卡布局 + 空态 + 复用操作） |
| `apps/desktop/src/components/ProfileMenu.vue` | 头像下拉菜单（复用 `useIdentity`，抽取公共 dropdown composable） |
| `apps/desktop/src/composables/useIdentityMenu.js` | ⭐ 从 `IdentityMenu.vue` 抽取的公共下拉逻辑（open/outside-click/Esc/Arrow 导航/菜单项 focus）——`IdentityMenu` 与 `ProfileMenu` 共用，避免复制 159-190 行逻辑 |
| `apps/desktop/src/components/MemberCenter.test.js` | 页面测试（空态/已登录各卡渲染/登录与升级入口） |
| `apps/desktop/src/components/ProfileMenu.test.js` | 菜单测试（未登录首项登录/已登录三项/disabled/键鼠） |
| `apps/desktop/src/composables/useIdentityMenu.test.js` | composable 导出完整性 + 交互行为测试 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/layouts/MpSidebar.vue` | `.mp-profile`（L4-10）改为可点击 `<button>`/可聚焦容器，挂 `<ProfileMenu />`；`moreItems` 增加 `{ key: 'member-center', label: t('memberCenter.title'), to: '/member-center' }` |
| `apps/desktop/src/components/IdentityMenu.vue` | 抽出下拉逻辑到 `useIdentityMenu.js`（行为不变，回归测试全绿） |
| `apps/desktop/src/router/index.js` | 增加 `{ path: '/member-center', name: 'MemberCenter', component: () => import('@/views/MemberCenter.vue') }` |
| `apps/desktop/src/stores/identity.js` | `normalizeState` 补 `quota` 与 `deviceId` 透传（P1，若做） |
| `apps/desktop/src/locales/zh.js` + `en.js` | 新增 `memberCenter`、`profileMenu` 命名空间（**必须成对，CI Gate 7 拦截**） |
| `apps/desktop/src/layouts/MpSidebar.test.js` | 新增：头像可点击、moreItems 含会员中心、未登录点击进入菜单等断言 |

### i18n key 结构（建议）

```js
memberCenter: {
  title: '会员中心', subtitle: '账号、版本与权益',
  notSignedIn: '登录后查看完整权益', signIn: '登录',
  account: { cardTitle: '账号信息', name: '昵称', username: '用户名', status: '登录状态', switchAccount: '切换账号', signOut: '退出登录' },
  plan: { cardTitle: '版本会员', free: '免费版', pro: 'Pro 版', trial: '试用版', daysRemaining: '剩余 {n} 天', upgrade: '升级 Pro' },
  entitlement: { cardTitle: '登录权益', plan: '套餐', source: '权益来源', sourceOnline: '在线', sourceOffline: '离线快照', expiresAt: '到期时间' },
  quota: { cardTitle: '配额', used: '已用', total: '总量' },
  about: { cardTitle: '关于', version: '版本' },
},
profileMenu: {
  login: '立即登录', memberCenter: '会员中心', switchAccount: '切换账号', signOut: '退出登录', serviceDisabled: '身份服务未启用',
},
```

### 路由注册注意

- hash 路由（`createWebHashHistory`），直接加一条即可；`MpSidebar.isActive`（L157-160）对 `moreItems` 用 `route.path.startsWith(item.to + '/')`，`/member-center` 是叶子路径无子路由，安全。
- 会员中心**不在** `MpModuleNav` 的 tabs 体系内（module 只有 home/accounts/publish），进入会员中心后顶部 tab �erer via the main process state bridge."
[PROGRESS] message text="Let me verify the access-control public channels for identity/license to ground the report."
[PROGRESS] message text="Let me check the locale file structure and the sidebar test to understand conventions for the report."
[PROGRESS] message text="I now have a comprehensive understanding of the codebase. Let me verify one more detail — how `quota` flows (or doesn..."
[PROGRESS] message text="Let me check licenseManager.getInfo() to see what fields are available for the version card (daysRemaining, isTrial)."
[PROGRESS] message text="I have all the facts I need. Key confirmations: `.mp-profile` in `MpSidebar.vue:4-10` has no click handle..."
[PROGRESS] message text="Now let me update the task.json to reflect completed analysis and next phase."
[PROGRESS] message text="Done. Wrote the analysis report to `.ccg/tasks/member-center-avatar-entry/analysis-opencode.md` and advanced the task..."
[PROGRESS] session_completed total_events=139
I see there's a `.ccg/tasks/member-center-avatar-entry/` directory already. Let me understand the task. This appears to be a design/analysis task for a Member Center + top-left avatar entry feature.

Let me first check the current state — this is a task that's been set up. Let me look at the existing task directory and understand the codebase.

The environment is Windows. Let me use PowerShell-appropriate commands.

Let me read the task definition and the analysis context files.

Let me read the other two analysis files and understand the context better.

The task files confirm: the previous analysis attempts failed to launch wrapper agents, and this is the opencode path. I'm the one who needs to produce the structured analysis report (5 sections) in Chinese.

The task.json says: complexity L, risk medium, domain desktop-frontend, currentPhase analysis, nextAction "并发探索现有功能与历史实现" (concurrently explore existing features and historical implementations).

This is an **analysis + solution design task** — NOT a code modification task. So no worktree isolation is needed yet (that's only for runtime code changes). The user explicitly says "之后会：worktree 隔离开发" — that's the next phase. My deliverable is the analysis report in `.ccg/tasks/member-center-avatar-entry/`.

Let me verify the key code facts before writing the report. The context already says these are verified, but I should confirm the critical ones myself (especially the avatar having no click handler, and the IdentityMenu/identity store/logging flow) to give an accurate report.

Let me use codegraph to explore the relevant files.

Codegraph timed out. Let me use direct file reads and grep instead.The output got truncated weirdly. Let me use glob to list components.Confirmed: `.mp-profile` (line 4-10) has no click handler — the "didn't work" root cause. Now let me read IdentityMenu, the identity store, and related files.Now let me look at the useIdentity composable, UpgradeModal, license store, router, and the module nav that hosts IdentityMenu.Now the router, module nav, App.vue layout, and the entitlement/electron identity side.Let me check App.vue layout, git history for the avatar, and the entitlement side + locales.Now let me look at App.vue, the electron identity service, and check entitlement/quota usage in views.Let me check the locales structure and existing tests, plus verify the git history claim about the avatar.Let me verify the "never had a click handler" claim by checking the introducing commit, and look at the IdentityMenu test for patterns.Let me check the identity API layer, and look for any existing entitlement/quota usage in views, plus the ACCESS-CONTROL-MATRIX.Let me check Home.vue's profile area and confirm test coverage for the sidebar.Let me verify how entitlement reaches the renderer via the main process state bridge.Let me verify the access-control public channels for identity/license to ground the report.Let me check the locale file structure and the sidebar test to understand conventions for the report.I now have a comprehensive understanding of the codebase. Let me verify one more detail — how `quota` flows (or doesn't) to the renderer store, since that affects the quota card decision.Let me check licenseManager.getInfo() to see what fields are available for the version card (daysRemaining, isTrial).I have all the facts I need. Key confirmations: `.mp-profile` in `MpSidebar.vue:4-10` has no click handler (root cause confirmed — the div was introduced inert in `e3e33af07` and never wired); `IdentityMenu.vue` already implements the full dropdown + login-modal-reuse pattern; `identity.js` store already guards concurrency via `runExclusive`; entitlement `quota` is computed main-process-side but **not** passed through to the renderer store. Now I'll write the structured report.

Now let me update the task.json to reflect completed analysis and next phase.Done. Wrote the analysis report to `.ccg/tasks/member-center-avatar-entry/analysis-opencode.md` and advanced the task to design phase.

## 报告要点（5 节）

**1. 功能清单分级**
- P0 五卡：账号信息卡、版本会员卡、登录权益卡、未登录空态、关于卡（数据全在现有 `identity`/`license` store，零后端）
- P1：配额卡 + 设备标识 —— ⚠️ 发现 `EntitlementService` 已算 quota 但 renderer `stores/identity.js:29-37` 的 `normalizeState` **丢弃了 quota**，需补透传
- P2 全砍：上传头像/改名、设备管理、支付历史（无后端接口）

**2. 交互评审（与你倾向不同）**
- 结论：**统一弹 ProfileMenu**，不采纳"未登录直接弹登录"
- 理由：头像仅 30px 紧邻「新建发布」，直接弹 modal 误触成本高；顶部 `IdentityMenu` 已是"头像→菜单"心智，两处行为应一致；未登录先看权益再登录转化更优；`signed_out`/`expired`/`error`/`disabled` 全状态需菜单分支而非单一 signIn
- 折衷保留你的诉求：未登录时菜单首项高亮「⚡ 立即登录」，两下完成登录

**3. 技术方案**：新建 `MemberCenter.vue`/`ProfileMenu.vue`/`useIdentityMenu.js`(抽取 IdentityMenu 共用下拉逻辑) + 3 个测试；改 Sidebar 头像接线 + `moreItems`、router、locales 成对

**4. 风险**：登录弹窗 `IdentityAuthWindow` 已实现零改动复用；`runExclusive` 已防并发；`disabled`/`offline_authenticated` 降级方案；`identity:*`/`license:*` 均在 `PUBLIC_CHANNELS` 未登录可读，无需新 IPC

**5. 差异**：仅第 2 点与你倾向不同，其余对齐；建议配额卡先补透传否则降 P2

未做任何代码修改（分析阶段，符合 worktree 隔离规则）。下一步：`scripts/session-init.sh member-center-avatar-entry` 进入隔离开发。

---
SESSION_ID: ses_fbe31c462ffeopKVhFb2nNmc64
