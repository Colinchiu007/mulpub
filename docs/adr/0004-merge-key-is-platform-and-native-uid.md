# 合并键是 (platform, platform_uid)，且必须八平台覆盖做全才上线

两条设备上的记录是否为同一账号，只由 `(platform, platform_uid)` 判定。`platform_uid` 是平台原生主键，由带凭证调用平台 user-info 接口取得——我们仓库已有这条链路（`http-login-checker.js` 的 `extract`：视频号 `:127` 取 `finderUser.uniqId`、B站 `:148` 取 `mid`、抖音 `:61`、头条 `:79`），与蚁小二 `getPlatformUserInfo` 完全同构。显示名与昵称**永不**参与判定。

蚁小二的取证也印证了这是竞品级答案：`index.cjs:87265` 把 `id / platformUserId / platformUserName` 明确分成三列，上云时送的 `userId` 就是平台原生 uid，昵称只作附属字段。

## 为什么不接受"缺口转人工确认"

现状 `extract` 只覆盖 4 个平台（`wechat_mp` 只有 HTML 判定、无 extract；`kuaishou`/`xiaohongshu`/`zhihu` 未实现），本机真源里 `platform_account_id` 填充率实测 3/8。缺口若转人工确认，功能可立刻上线，但用户每次同步都要当一次去重器。决定先补齐 4 个平台的 uid 提取、做到 8/8 全自动，再让同步功能可用。

## 后果

- 快手是已知雷区：未登录与登录后都落在 `cp.kuaishou.com/profile`，URL 判定本质不可区分（AGENTS.md 记录过 2026-09-25 事故）。新增该平台的 uid 提取必须同时提供「登录页不算成功」负例，并考虑 `PLATFORM_SESSION_COOKIE_MARKERS`。
- 若某平台确实取不到稳定 uid，它的账号在云端只能以"本机 `local_account_id` 派生的占位键"存在，并在 PRD 中标注该平台不支持跨设备合并——这是显式降级，不是静默猜名。
