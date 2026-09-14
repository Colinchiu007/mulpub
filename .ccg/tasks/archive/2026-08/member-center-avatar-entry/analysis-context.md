# 会员中心 + 左上角头像入口 — 分析与方案设计任务

## 需求背景（用户原话要点）
1. 桌面版目前没有会员中心/个人中心功能，请分析适合实现哪些对用户有用的会员中心功能。
2. 入口除了菜单中的「更多」，也加在左上角的用户头像上；点击后的交互：直接跳转 or 弹出菜单选择？
3. 未登录状态时，点左上用户头像应弹出登录弹窗（用户认为合理），请评估。
4. 用户称"以前好像做过这个功能，但一直没生效"，需查清原因（已查，见下）。
5. 之后会：worktree 隔离开发、双模型审查、更新 PRD 详细文档、推送 GitHub 合并分支。

## 代码现状（已核实，勿重复探索）

### 布局
- apps/desktop/src/layouts/MpSidebar.vue：左侧栏。顶部 header 有 `.mp-profile`（头像 `mp-avatar` + displayName + licenseLabel），**无任何点击 handler（git 历史确认自引入起从未绑定，这就是"没生效"根因）**。侧边栏有主菜单 6 项 + 「更多」下拉（moreItems：监控/发布日历/私信评论/CLI/素材库/关键词监控/爆款分析/提示词评估/模型提供商）。
- apps/desktop/src/layouts/MpModuleNav.vue：顶部模块导航（App.vue 中 `v-if="isHomeTab"` 仅首页标签渲染），其 `.mp-module-tools` 里挂载 `<IdentityMenu />`。
- apps/desktop/src/components/IdentityMenu.vue：身份下拉（未登录 ⚡登录 高亮 / 已登录 头像首字母+昵称），菜单项：登录 Multi-Publish / 切换账号 / 退出登录。
- 路由：apps/desktop/src/router/index.js — hash 路由，约 25 个页面（Home/Publish/Accounts/Dashboard/Create/...）。**无会员/个人中心路由**。

### 身份与权益（可展示数据）
- apps/desktop/src/stores/identity.js（Pinia）：status（disabled/signed_out/signing_in/authenticated/refreshing/offline_authenticated/expired/error/signing_out）、user（sub/name/username/picture）、entitlement（plan/features[]/source[online|offline]/expiresAt/quota）、isAuthenticated/displayName；signIn/switchAccount/signOut 走 IPC。
- apps/desktop/electron/services/identity/：Logto OIDC 集成。IdentityAuthWindow 打开 modal BrowserWindow（520x720，标题「登录 Multi-Publish」）→ **"登录弹窗"主进程侧已实现且可用**。auth-service signIn → loopback 127.0.0.1:16526 回调 → entitlement 同步 `/api/v1/me`（Bearer + X-Device-Id）→ entitlement-service 校验签名快照（RSA）存 identity-entitlement.json。
- apps/desktop/src/stores/license.js + apps/desktop/src/components/UpgradeModal.vue：本地许可证（免费/Pro ¥99 永久/试用，激活码/支付宝/微信支付模拟），侧边栏底部「⭐ 升级 Pro」按钮触发 UpgradeModal。

### 相关约束
- i18n：apps/desktop/src/locales/zh.js + en.js 必须成对修改（CI 检查 check-locale-sync.js）。
- 测试：Vitest，组件测试放 src/components/*.test.js 旁（identity store 测试 src/stores/identity.test.js）。
- 登录门禁：01-docs/ACCESS-CONTROL-MATRIX.md 定义写操作需登录（commit 95021b001）。
- 上传头像/改名等写操作需要后端 API 支持——当前 business API 仅 /api/v1/me 只读，无用户资料修改接口（本任务不应新增后端接口，按"能不做就不做"原则）。

## 我倾向的方案（请批判）
1. 新增 /member-center 独立路由页（会员中心），作为主内容区页面，不弹窗（内容量大：账号卡/版本卡/权益清单/配额/设备/账号操作）。
2. 左上角头像改为可点击 ProfileMenu：未登录 → 点击直接触发 signIn()（弹出登录 modal 弹窗，满足用户诉求）；已登录 → 弹出下拉菜单（会员中心 / 切换账号 / 退出登录）。复用 identity store，不复制 IdentityMenu 逻辑（可提取公共 composable）。
3. 「更多」菜单加入「会员中心」项（router-link），未登录也可进入查看版本权益与登录引导。
4. 会员中心内容（未登录显示空态+登录按钮；已登录显示数据）：
   - 账号信息卡：头像（picture/首字母）、昵称、用户名、登录状态、切换账号/退出
   - 版本会员卡：licenseType（免费/试用/Pro）、daysRemaining、升级 Pro 按钮（复用 UpgradeModal 逻辑）
   - 登录权益卡：entitlement.plan/features/source/expiresAt（在线/离线来源标识）
   - 配额卡：entitlement.quota（如有）
   - 安全与设备：设备标识（脱敏展示）
   - 关于：版本号
5. 交互细节：菜单用点击外部关闭+Esc 关闭、键盘导航（复用 IdentityMenu 模式）；未登录直接登录前先 resolve 状态避免重复弹窗。

## 需要你输出的
1. 功能清单评审：哪些功能对用户真正有价值、哪些应砍（考虑无后端支持、最小成本原则）；给出 P0/P1/P2 分级。
2. 交互方案评审：未登录点头像直接登录弹窗 vs 统一弹菜单，哪个更优？给出结论与理由（考虑可用性、可发现性、误触风险、与其他入口一致性）。
3. 技术方案：组件/文件划分（新建哪些文件、改哪些文件）、路由注册、i18n key 结构、测试清单。
4. 风险与边界：登录弹窗已有实现如何复用、signIn 并发/状态竞争、离线/disabled 身份服务时会员中心如何降级、打包验证注意点。
5. 最终推荐方案（如与我的倾向不同请明说）。
OUTPUT：结构化报告（中文），分 5 节，每节给结论+理由，关键处给文件名建议。
