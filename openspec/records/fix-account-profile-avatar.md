---
record: fix-account-profile-avatar
task: 修账号页昵称/头像/粉丝数缺失与「显示平台 logo/默认头像」的错头像问题
date: 2026-10-22
---

## 本次执行记录：账号资料补全与错头像治理（fix-account-profile-avatar，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码 | 隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-account-profile-avatar`，裸分支 `fix-account-profile-avatar`；共享根保持 main + clean，未在其运行时路径落盘 |
| 第一性原因（QM-5 ①） | 4 条架构性缺口 | ①**资料契约里没有头像这一格**（`extract` 只声明 nickname/followers/platformAccountId，`shapeInfoResult` 只搬这三个键）⇒ 走 HTTP 快路径的账号头像**无处可落**；②**登录判定端点被反向绑死成资料端点**（抖音判定端点真实响应是顶层 `{status_code,uid}`、无 user 对象 ⇒ 判定恒不确定 ⇒ 快路径恒不成立 ⇒ 提取恒空 ⇒ 昵称恒回落平台名；小红书从 SSR HTML 取 `data-account-id` 实测取不到且无 `check`）；③**DOM 头像兜底链末端抓 `og:image` = 站点品牌图**（头条号 og:image = `obj/mp/logo-toutiao.png`），落盘后因「值不变就不写」永不覆盖；④**粉丝数与昵称常在不同端点**，旧结构只允许「一端点一 extract」 |
| 逃逸分析（QM-5 ②） | 6 环 | ①采集能力已存在但形状缺头像 → ②HTTP 快路径成主路径（无 DOM） → ③契约无 avatar 位置（补采也无处落） → ④昵称取数绑定判定端点（端点选错/缺判定） → ⑤og:image 兜底抓到品牌图 → ⑥存量账号无「重新采集资料」入口。**每环都有「看起来对」的实现**（有 extract、有 check、有兜底、有落盘），故不报错、不变红 |
| 修复 + 回归保护（QM-5 ④） | 见下 | 新增品牌图判据模块 + 资料来源表；移除 og:image 兜底；头像改候选列表 + Node 侧择优；资料契约纳入 avatar；抖音判定补顶层 uid 口径；小红书登记 JSON 判定端点；渲染层加「原因 + 下一步」提示 |
| 防止再次发生（QM-5 ⑤） | 3 道机械锁 | ①`http-login-checker-uid-coverage.test.js` 结构锁扩到资料来源表：八平台都须登记来源、每个来源须能产出 `platformAccountId`、平台集合不得出现第二套口径；②`account-avatar-guard.test.js` 锁品牌图判据（真头像不误杀 / logo·favicon·brand 形态命中 / 全品牌图返回空）；③`http-login-checker-profile.test.js` 锁逐平台字段路径（含「静态 bundle 推断出的旧字段名不得被当真」） |
| 行尾与 diff 对账 | PASS | 两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件一致（提交前现测） |
| 接线棘轮 | PASS | `node scripts/check-unwired-tests.js` ⇒ 新增两个 `*.test.js` 均被既有测试域收录（`packages/shared-utils/src/__tests__/` 与 `apps/desktop/electron/publishers/`），无新增欠账（实跑读数见下） |
| QM-1 打包 / QM-4 视觉 | QM-1 PENDING / QM-4 N/A | QM-1：本次触面含 `apps/desktop/electron/**`，按 AGENTS.md 字面规则**必须**跑本地打包验证，打包与三层判据由 Lead 统一取证 ⇒ 如实记 **PENDING**，不伪造打包证据。QM-4：无样式/路由变更，仅新增 title 提示 ⇒ N/A |
| QM-6 CCG 双模型外部评审 | 见「评审」小节 | `scripts/ccg-review.ps1 -Mode Deep`（critic=claude / proposer=opencode）实跑读数见「## 评审」小节；**不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

### 做了什么（用户视角）

- 账号卡上多个平台现在显示**平台真实昵称**（抖音不再显示页面标题「作品发布」，小红书/知乎不再显示平台名）。
- 账号卡上显示**账号本人的头像**（头条号不再显示平台 logo，小红书不再显示平台默认图）。
- 账号卡上显示**粉丝数**（抖音/头条/B 站/小红书/视频号）。
- 取不到时**如实显示「暂无数据 / 未获取到」**并给出下一步（点「验证」可重新获取），不猜、不编。

### 证据链

**取证方法**：本机已登录账号的 Cookie（Electron `persist:*` 分区）调**只读** user-info 端点。
只打印字段名/类型/派生结论，**不打印任何 Cookie / token / 会话值**；昵称只输出「是否等于真源显示名」；
头像只输出主机名与「是否与落盘值相同」；粉丝数是公开指标。脚本一次性、不入仓（`.tmp-research/`，已 gitignore）。

**实测字段表**（全量见 `01-docs/PRD-ACCOUNT-PROFILE-AVATAR-2026-10-22.md` §4.2）：

| 平台 | 端点 | 昵称 | 头像 | 粉丝数 | 平台 ID |
|---|---|---|---|---|---|
| 抖音 | `GET creator.douyin.com/web/api/media/user/info/` | `user.nickname` | `user.avatar_larger.url_list[0]` | `user.follower_count` | `user.uid` |
| 今日头条 | `GET mp.toutiao.com/mp/agw/media/get_media_info` | `data.media.display_name` | `data.media.https_avatar_url` | `GET mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat` → `data.fans_stat.total_fans_count` | `data.user.id` |
| B 站 | `GET api.bilibili.com/x/web-interface/nav` | `data.uname` | `data.face` | `GET api.bilibili.com/x/relation/stat?vmid=<mid>` → `data.follower` | `data.mid` |
| 小红书 | `GET creator.xiaohongshu.com/api/galaxy/user/info` | `data.userName` | `data.userAvatar` | `GET creator.xiaohongshu.com/api/galaxy/creator/home/personal_info` → `data.fans_count` | `data.userId` |
| 知乎 | `GET www.zhihu.com/api/v4/me` | `name` | `avatar_url` | — | `id` |
| 视频号 | `POST channels.weixin.qq.com/…/auth/auth_data` | `data.finderUser.nickname` | —（DOM） | `data.finderUser.fansCount` | `data.finderUser.uniqId` |
| 快手 | （无纯 HTTP 端点，需签名） | —（DOM） | —（DOM） | — | Cookie 派生 `userId` |
| 公众号 | `GET mp.weixin.qq.com/cgi-bin/loginpage`（HTML 同页） | `nick_name` | —（DOM） | — | `uin` |

**由此推翻的既有结论**（照抄会直接犯错）：

| 既有实现 | 实测真相 | 后果 |
|---|---|---|
| `xiaohongshu-capabilities.js`：`data.nickname` / `data.images` | 真字段 `data.userName` / `data.userAvatar` | 该模块头像与昵称恒为空 |
| `douyin-capabilities.js`：`d.user.avatar_life` / `avatar_168x168` | 真字段 `d.user.avatar_larger`（**对象** `{uri, url_list[]}`） | 同上 |
| 抖音判定端点读 `data.data.*`、提取读 `data.user` | 真实响应是**顶层** `user`，判定端点无 user 对象 | 判定恒不确定 + 提取恒空 |
| 头条头像靠 DOM 的 `og:image` 兜底 | og:image = 平台 logo | 账号卡显示平台 logo |

> 与逆向成果文档 §5「已失效结论」同型：静态 bundle 切片推字段名会错，必须运行期验证。
> 本轮三处静态推断（小红书/抖音/头条）全部被实测推翻。

**改动清单**：

1. **新增** `packages/shared-utils/src/account-avatar-guard.js` —「站点品牌图」单一判据。
   判 `logo*` / `favicon` / `brand-*` / `sitelogo*` 文件名形态与已知形态 `…/obj/mp/logo-*.png`；
   **不判**平台默认头像（B 站 `noface.jpg` 等是账号真实在用的头像）；判不出来一律不判。
2. **改** `packages/shared-utils/src/account-profile.js` — 移除 `og:image` 兜底；
   采集器上报**头像候选列表** `avatarCandidates`（页面内不得引用模块作用域标识符）；
   Node 侧新增 `pickUserAvatar` / `finalizeCollectedInfo`：剔除品牌图后取第一个，全是品牌图则**不产出头像**。
3. **改** `apps/desktop/electron/publishers/http-login-checker.js` — 新增 `HTTP_PROFILE_APIS` 资料来源表
   （与登录判定表**分表**；每平台多来源按字段合并；`url` 可为函数以依赖前序结果；
   支持 `responseType:'html'` 与 `uidSource:'cookie'`）；`shapeInfoResult` 纳入 `avatar`；
   抖音 `check` 补顶层 uid 口径；小红书登记 JSON 判定端点（uid 改由 `data.userId` 产出，**保持既有 uid 语义**）；
   新增 `parseWechatMpIdentity`（公众号昵称与 uin 的唯一解析实现，两表共用）。
4. **改** `apps/desktop/electron/publishers/account-profile-refresh.js` — `refreshProfileFromHttpApi`
   把 `avatar` 一并交给 `buildProfilePatch`。
5. **改** 渲染层 `AccountManagementCard.vue` + `locales/accounts-page/{zh,en}.js` —
   头像容器与粉丝行新增「原因 + 下一步」提示；按钮名「验证 / Verify」与卡片按钮逐字一致。

**既有断言变更清单**（每条都在代码内写明理由与证据，遵守 AGENTS.md「不放宽既有断言」）：

| 断言 | 变更 | 理由与证据 |
|---|---|---|
| 采集器 og:image 兜底 | 改为「一律不采纳」 | 头条 og:image 实测 = `obj/mp/logo-toutiao.png`（平台 logo），已落盘成账号头像 |
| 采集器头像取值 | `avatar` → `avatarCandidates` + Node 侧择优 | 「第一个匹配元素」可能是品牌位；品牌图判定必须在 Node 侧做 |
| info 抖音 ×2 | 端点/字段按实测改 | 顶层 `user` + `avatar_larger.url_list[]` |
| info 头条 ×1 | 昵称/头像取 `data.media`，粉丝取第二端点 | 实测 `display_name` / `https_avatar_url` / `fans_stat.total_fans_count` |
| info B 站 ×1 | nav 取昵称头像，`relation/stat` 取粉丝 | 实测 `uname` / `face` / `follower`（需 vmid） |
| info 公众号 ×1 | 结果增加 `nickname` | loginpage HTML 内嵌 `nick_name`（平台模板 + 仓库既有夹具） |
| info 小红书 ×3 | 改走 `galaxy/user/info` JSON | SSR HTML 的 `data-account-id` 实测取不到（生产库 uid 一直为空） |
| info 知乎 ×1 | 改走 `/api/v4/me` | 判定页 HTML 与资料页 JSON 需分表 |

**测试实跑**（本机）：

- `apps/desktop/electron/publishers/` + `electron/tests/account-profile-collector.test.js` ⇒ **20 文件 / 361 例全绿**。
- `apps/desktop/electron/publishers/http-login-checker-profile.test.js` ⇒ **24 例全绿**（新增）。
- `apps/desktop/electron/publishers/http-login-checker-uid-coverage.test.js` ⇒ **35 例全绿**（结构锁已扩到资料来源表）。
- `packages/shared-utils/src/__tests__/account-avatar-guard.test.js` ⇒ **6 例全绿**（新增）。
- `apps/desktop/src/features/accounts/components/AccountManagementCard.test.js` ⇒ **43 例全绿**（1 例既有 skip）。
- `apps/desktop/electron/publishers/http-login-checker-info.test.js` + `http-login-checker-uid-coverage.test.js` ⇒ **52 例全绿**（既有断言按实测更新后）。

## 评审

- **QM-6 CCG 双家族外部评审**：`scripts/ccg-review.ps1 -Mode Deep`（critic=claude / proposer=opencode）。
  实跑读数与处置见下（**不以自审冒充通过；后端跑不出来就如实写具体失败原因**）。

### 遗留（不假装已闭合）

- **公众号头像/粉丝数**：会话已失效（`cgi-bin/home` 返回错误页），无真机证据；头像仍走 DOM 采集（平台模板含 `img.user_avatar`），重新登录后可得；粉丝数无只读取证 ⇒ 留空。
- **百家号昵称/头像/粉丝**：本机无可用会话（分区无 Cookie）⇒ 全靠 DOM 路径，未做真机取证。
- **知乎粉丝数**：`/api/v4/me` 不含粉丝数，未找到可只读取证的端点 ⇒ 留空。
- **快手粉丝数**：`home/infoV2` 需 `__NS_sig3` 签名，本轮未接线 ⇒ 留空。
- **小红书头像端到端复验**：API 真值已取得，**尚未在应用内跑通一次完整回填** ⇒ 需真机验收（清单见下）。
- **`api-publish-engine` 的 `capabilities/*` 字段名**：同样是静态 bundle 推断（小红书/抖音已被实测推翻），本轮**未改**（发布链用不到这些字段，改它要重跑发布侧验证）⇒ 记为 backlog，并在 PRD 与本记录标注「静态推断字段名不可信」。
- **QM-1 打包**：PENDING（未伪造证据）。

### 真机验收清单

1. 账号页点「一键检测」⇒ 抖音/头条/B 站/小红书/知乎卡上出现真昵称、真头像、粉丝数。
2. 头条卡头像从「头条号 logo」变成用户头像；小红书卡头像从「小红书默认图」变成用户头像。
3. 抖音昵称从「作品发布」变成真昵称；小红书/知乎昵称从平台名变成真昵称。
4. B 站头像显示平台自己的默认图（`noface.jpg`）—— 该账号确实没设头像，属正确表现。
5. 无头像/无粉丝的平台（公众号等）显示灰色通用头像 + 「点『验证』可重新获取账号资料」提示。

## CHANGELOG 条目

# fix(账号): 账号卡显示平台真实昵称、头像与粉丝数（fix-account-profile-avatar）

- 账号页多个平台不再显示灰色通用头像或平台名：抖音/小红书/知乎显示账号真实昵称，头条/小红书显示账号本人头像而不是平台 logo 或默认图。
- 账号页新增粉丝数显示（抖音/头条/B 站/小红书/视频号）。
- 头像或粉丝数取不到时，卡片上明确提示「未获取到…，点『验证』可重新获取账号资料」，不再是一个无从判断的灰色图标。

## learnings

### lesson: 资料契约缺字段比采集失败更难发现（static-derived-field-paths-must-be-verified）

**现场**：账号页 10 个账号里 9 个缺粉丝数、5 个缺头像、4 个昵称显示成平台名。
而仓库里**有**采集实现（`account-profile.js` 抽取于 2026-09-23）、**有**登录判定（`http-login-checker.js`）、
**有**写回（`buildProfilePatch`）、**有**测试（`http-login-checker-info.test.js` 27 例全绿）——
每一样都在，唯独「头像」这一格在契约里**不存在**。

**根因**：`extract` 的契约只声明了 nickname/followers/platformAccountId。形状级缺失比运行期失败更难发现：
运行期失败会报错、会有测试红；形状级缺失**不报错、不变红**，只是永远拿不到。
更隐蔽的是第二层：登录判定端点被反向绑死成资料端点 ——
抖音注册的判定端点真实响应是顶层 `{status_code,uid}`（没有 user 对象），
于是「判定」恒不确定 ⇒ 快路径恒不成立 ⇒ 「提取」恒空 ⇒ 昵称恒回落平台名。
**两处都长得像「已实现」，所以没有任何一层会亮红灯。**

**可复用的 3 条**：

1. 契约（类型/字段表）比实现更容易被遗漏审查。**新增一个「从外部取到的字段」时，
   先确认它在契约里有位置，再写采集** —— 否则采集写在哪都是无处落。
2. 「判定端点」与「取数端点」是两类需求，**合并成一张表必然有一边取不到**。
   判据：端点能不能回答两个不同的问题？不能就分表（本仓先例：`CAPABILITY_MATRIX` vs `LOGIN_DETECTION`）。
3. **静态切片（bundle 字符串、二进制反推）推出的字段名必须运行期验证**。
   本轮三处静态推断（小红书 `data.nickname`、抖音 `avatar_life`、抖音 `data.user`）**全部**被实测推翻，
   而这三个字段名看起来都「很像那么回事」。先例见逆向成果文档 §5 的七条已失效结论 ——
   同一个错误形态在两个仓里各犯了一次。
