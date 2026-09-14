# 需求（会员中心 + 头像入口）

## 用户诉求
1. 桌面版尚无会员中心（个人中心）——新增对用户有用的会员中心功能；
2. 入口除「更多」菜单外，加在左上角用户头像（分析：直接跳转 vs 弹菜单）；
3. 未登录点头像应直接弹登录弹窗；
4. 排查历史「点头像没反应/登录未生效」根因；
5. worktree 隔离开发、更新记忆、推送 GitHub 合并、PRD 详细补充、质量节拍。

## 已核查事实
- 根因：MpSidebar 左上角 .mp-profile 从未绑定点击事件；
- 登录弹窗已存在可用：IdentityAuthWindow（modal 520x720，Logto OIDC），IdentityMenu 触发；
- 会员中心页面不存在；UpgradeModal/licenseStore/identityStore（user+entitlement）已存在；
- entitlement.quota 主进程已计算但 renderer normalizeState 未透传（本次修复）。

## 方案
- 交互：signed_out/expired 点头像直接 signIn() 弹登录；已登录弹菜单（会员中心/切换账号/退出）；disabled/error 弹菜单展示原因不直登；
- 页面：/member-center 独立路由（账号卡/版本卡/权益卡/配额卡/关于卡/未登录空态）；
- 入口：更多菜单 + IdentityMenu + 头像菜单三处；
- 砍掉：设备标识、上传头像/改名/订单历史（无后端能力）；
- 范围：仅 renderer，不动 electron/（无 QM-1 整包门禁）。
