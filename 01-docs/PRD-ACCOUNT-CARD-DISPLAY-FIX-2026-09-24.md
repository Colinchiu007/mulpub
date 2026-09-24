# PRD-ACCOUNT-CARD-DISPLAY-FIX — 账号管理页账号卡片显示与数据修复

- 日期：2026-09-24
- 分支 / worktree：`codex/account-card-display-fix` @ `D:/Data/projects/mp-worktrees/mp-account-card-display-fix`
- 触发：用户截图（electron.exe_20260924_134429）反馈账号卡片平台名/账号名/粉丝/检查记录/折行多处显示错误
- 参考：蚁小二（yixiaoer）逆向工程（`D:/Data/yixiaoer-extracted/`）——账号资料一律「带 Cookie 调平台创作者 API 读结构化 JSON」，不做 DOM 抓取

## 1. 问题清单与根因（7 现象 → 5 根因）

| # | 现象（用户可见） | 根因层 | 根因 |
|---|---|---|---|
| 1 | 快手卡片顶部平台名、账号名都显示「0粉丝0关注0获赞账号认证退出登录…」 | 渲染 + 采集 | ①顶部 chip 误渲染账号名而非平台名；②`account_name` 被 DOM 通用选择器抓成整块容器 textContent |
| 2 | 其他平台账号名显示「作品发布/头条号/百家号/视频号助手/Bilibili 创作者中心」 | 采集 | 昵称多层回退最后落到 `document.title`，把页面标题/菜单名当昵称写库 |
| 3 | 「粉丝：暂无数据」 | 数据 | 存量账号 `followers=null`：DOM 未抓到 + HTTP 检测链路未回填粉丝 |
| 4 | 「暂无检查记录」（详情行） | 渲染 | `LAST_CHECK_KEYS` 缺真实字段 `last_validated`，导致已检测账号仍走「从未检测」兜底文案 |
| 5 | 卡片顶部平台名称不对（抖音/微信公众号） | 渲染 | 同 #1①：chip 用了 `accountDisplayName` |
| 6 | 「负责人」「运营人」标签折行 | 渲染 | `.account-assignees > div` 徽章列固定 `44px` 容不下三字标签 + padding，触发换行 |

> 公众号账号「数字生命丘丘」是**真实昵称**，任何守卫都不得误伤。

## 2. 修复设计（四层，最小侵入 + 单一数据源）

### Layer A — 共享噪声守卫（单一数据源）
新增 `packages/shared-utils/src/account-name-guard.js`，导出 `isNoiseAccountName(name)`。判定（命中任一即噪声）：
1. **会话/后台 chrome 关键词**：退出登录 / 账号认证 / 扫码登录 / 请登录 / 创作者中心 / 创作中心 / 数据中心 / 发布记录 / 作品管理 / 内容管理 / 首页 / 设置 / 提现 / 收益。
2. **平台指标块文本**：同串中「粉丝 / 获赞 / 关注者 / 粉丝数 / 关注数」计数词命中 **≥2**（典型「0粉丝0关注0获赞」）。单个「关注」不计，避免误杀含「关注」的真实昵称。
3. **已知页面标题精确命中**（忽略大小写与首尾空格）：作品发布 / 头条号 / 百家号 / 视频号助手 / 视频号 / Bilibili 创作者中心 / 哔哩哔哩 / 微信公众号 / 公众号 / 大鱼号 / 搜狐号 / 网易号 / 一点号 / 爱奇艺号 / 企鹅号 等。
- 空值 `''`/`null` 判为噪声（无展示信息，由调用方决定兜底文案）。

### Layer B — 渲染层显示修复（`AccountManagementCard.vue`）
1. **顶部平台名 chip**：`{{ accountDisplayName }}` → `{{ platformLabel }}`（父组件 `Accounts.vue` 传 `platformLabel(account.platform)`，即平台显示名）。修复 #1①/#5。
2. **账号名噪声守卫**：`accountName()` 命中 `isNoiseAccountName` 时回落 `props.platformLabel`，仍无则 `unnamedAccount`。修复 #1/#2 的存量脏数据显示（无需重登录）。
3. **检查时间键补全**：`LAST_CHECK_KEYS` 追加 `last_validated / lastValidated / validated_at / validatedAt`，已检测账号改显「最近检查 <时间>」。修复 #4。
4. **归属标签不折行**：`.account-assignees > div` 列宽 `44px` → `max-content`；徽章 `span` 加 `white-space: nowrap`。修复 #6。

### Layer C — 采集写回守卫（`account-profile.js`）
- `profileForCreate` / `buildProfilePatch` 在生成 `account_name` 前经 `isNoiseAccountName` 过滤：命中噪声 → 不下发/回落 fallback。防止新采集再把页面标题/容器文本写脏。DOM 抓取通道保持可用，但出口有闸。

### Layer D — 数据层 API 提取（对齐蚁小二，`http-login-checker.js` + `account-manager.js`）
- `http-login-checker.js` 为已注册平台（douyin / toutiao / tencent_video / bilibili）新增 `extract(data)`，从登录检测**同一批** API 响应直接取昵称/粉丝/平台ID：
  - douyin `creator/pc/user/info` → `data.{nickname, follower_count/fans_count, uid}`
  - toutiao `get_media_info` → `data.user.{name/screen_name, fans_count, id}`
  - tencent_video `auth_data` → `data.finderUser.{nickname, fansCount, uniqId}`（与蚁小二 `getUserinfo` 一致）
  - bilibili `web-interface/nav` → `data.{uname, mid}`（nav 不含粉丝，仅回填昵称/ID）
- 新增导出 `fetchAccountInfoViaHttpApi(platform, cookies)`：复用端点与 Cookie 头；无 extract 平台（kuaishou 需 `__NS_sig3` 签名，本期未接）/无 Cookie/precheck 失败/非 2xx/解析失败一律 `{ supported }` 不带字段（缺席即不修改）。
- `account-manager.js` 新增 `refreshProfileFromHttpApi`：HTTP 检测判 `valid===true` 时旁路回填。
  - **昵称保护纪律**：仅当现网名命中噪声或缺失时才用 API 昵称覆盖；现网名非噪声（含用户手动改名）→ 删除 `account_name`，只回填粉丝/平台ID/头像，绝不冲掉用户手输。
  - 走 `buildProfilePatch`（字段缺席=不修改）；全程 try/catch，任何失败只 warn，绝不影响登录态判定。

## 3. 数据校验规则

- **昵称入库前**：`isNoiseAccountName(raw)===false` 方可写 `account_name`；否则按 Layer D「昵称保护」或 Layer B「显示回落平台名」处理。
- **粉丝**：`toCount` 取正整数（`Number.isFinite && >=0`），非数字/负数/缺失 → `undefined`（PATCH 不下发，保留原值）。
- **平台ID**：`String(...)`，空串不下发。
- **检查时间**：`LAST_CHECK_KEYS` 任一键对应值可被 `new Date()` 解析方显「最近检查」，否则继续尝试失败原因键，最后才「暂无检查记录」。

## 4. 显示项与提示文字（locales `accountsPage.accountCardLabels`）

| 键 | 中文 | 触发条件 |
|---|---|---|
| （chip） | 平台显示名 `platformLabel`（抖音/微信公众号/快手…） | 恒显示，取自 `platform-display-definitions.json` |
| `account_name` 区 | 真实昵称；噪声则回落 `platformLabel`；皆无 → `unnamedAccount`「未命名账号」 | 主标题 |
| `followers` + `noData` | 「粉丝：<整数>」；无数据「粉丝：暂无数据」 | 有值显数，无值显 `noData` |
| `lastCheck` | 「最近检查 <本地化时间>」 | 命中 `LAST_CHECK_KEYS`（含 `last_validated`） |
| `statusNoCheck` | 「暂无检查记录」 | 从未检测且无失败原因（仅真·未检测出现） |
| `ownerLabel`/`publisherLabel`/`proxyLabel` | 「负责人」「运营人」「代理」徽章 | 徽章 `nowrap`，单行不折行 |

> 本次**不新增**用户可见文案，`zh.js`/`en.js` 无需成对改动（不触发 Gate 7 locale-sync）。

## 5. 交互与流程

1. 用户进入账号管理页 → `Accounts.vue` 以 `platformLabel(account.platform)` 渲染每张卡片顶部平台名。
2. 存量脏数据即时以平台名兜底显示（无需任何操作）。
3. 用户点「验证」/批量检测 → `checkLoginStatus` HTTP 快速路径成功 → 旁路 `refreshProfileFromHttpApi` 回填真实昵称与粉丝 → 下次刷新显示平台 API 权威昵称与真实粉丝数。
4. 重新登录成功 → `updateCapturedAccount`/DOM `refreshProfileFromPage` 仍走噪声过滤，不写脏名。

## 6. 边界与已知限制

- **快手粉丝**：`infoV2` 需 `__NS_sig3` 签名（蚁小二 `getSign$5`），本期未接入 HTTP 提取；快手走 DOM 通道 + 噪声守卫 + 显示回落，粉丝暂无 API 来源时保持「暂无数据」。后续如需可单独立项做签名逆向。
- **公众号昵称**：登录页 HTML 未必内嵌昵称，未做 HTML 提取；真实存量昵称「数字生命丘丘」由噪声守卫保留。
- **bilibili 粉丝**：nav 接口不含粉丝，仅回填昵称/ID，粉丝走 DOM 或后续专项接口。

## 7. 验收标准

- [x] 顶部 chip 显平台名，不再是账号名/垃圾文本。
- [x] 噪声 `account_name` 卡片显平台名；真实昵称「数字生命丘丘」原样显示。
- [x] 已检测账号显「最近检查 …」，不再误显「暂无检查记录」。
- [x] 负责人/运营人/代理徽章单行不折行（源码契约断言）。
- [x] HTTP 检测成功可回填 douyin/toutiao/tencent_video/bilibili 真实昵称；tencent_video/toutiao 回填粉丝。
- [x] 用户手动改名不被 API 昵称冲掉。
- [x] 采集写回过滤噪声昵称。
- [x] 相关 vitest 全绿；ESLint + Prettier 通过。

## 8. 测试矩阵（回归保护）

| 测试文件 | 覆盖 |
|---|---|
| `packages/shared-utils/src/__tests__/account-name-guard.test.js` | 噪声判定：空/chrome/页面标题/真实昵称/单个「关注」不误杀 |
| `packages/shared-utils/src/__tests__/account-profile-guard.test.js` | `profileForCreate`/`buildProfilePatch` 噪声昵称不入库、粉丝照常回填 |
| `apps/desktop/electron/publishers/http-login-checker-info.test.js` | `fetchAccountInfoViaHttpApi` 各平台提取、无 cookie/无 extract 省略、bilibili precheck 不发请求 |
| `apps/desktop/.../AccountManagementCard.test.js`（追加 4 例） | chip 显平台名、噪声回落平台名/真实名保留、`last_validated`→「最近检查」、徽章 nowrap 源码契约 |
