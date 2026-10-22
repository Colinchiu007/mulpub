---
record: fix-account-profile-avatar
task: 修账号页昵称/头像/粉丝数缺失与「显示平台 logo/默认头像」的错头像问题
date: 2026-10-22
---

## 本次执行记录：账号资料补全与错头像治理（fix-account-profile-avatar，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码 | 隔离 worktree `<仓库父目录>/mp-worktrees/mp-fix-account-profile-avatar`（裸分支 `fix-account-profile-avatar`，非系统盘）；共享根保持 main + clean，未在其运行时路径落盘 |
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
   **配套拆分（CI 门禁强制）**：本轮把该文件从 480 行推到 871 行，触发逐文件行数门禁
   `NEW_OVER_LIMIT`（≥500 行阻断新代码引入超大文件）⇒ 资料来源表与抓取入口拆到新模块
   `apps/desktop/electron/publishers/http-profile-api.js`（480 行），本文件回到 419 行。
   依赖方向**单一**：http-login-checker → http-profile-api（反向 require 会成环）；
   `toCount` / `parseWechatMpIdentity` / `cookiesToHeader` / `HTTP_TIMEOUT_MS` 随之搬到新模块
   （各一份实现，不复制），http-login-checker 再导出 `HTTP_PROFILE_APIS` 与
   `fetchAccountInfoViaHttpApi`，**既有调用面不变**（account-profile-refresh / 测试 / 结构锁
   照旧从 http-login-checker 取）。
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

- **QM-6 CCG 双家族外部评审**：`scripts/ccg-review.ps1 -Mode Deep`
  - 后端体检：critic=**claude**（`/c/Users/邱领/.local/bin/claude.exe`，2.1.303）、
    proposer=**opencode**（`/d/Program Files/npm-global/opencode.cmd`，1.18.34）——
    **两个后端都真实可跑**（`X --version` 已自检），不是「工具不可用」。
  - 判定：DUAL（变更 1361 行 > 200 行阈值）⇒ 双模型深度审查已跑。
  - critic 产出 **8 条问题**（correctness 4 / security 7 / performance 6 / maintainability 3，最低分 3），
    引擎进入自扮演裁决，要求逐条填 adjudication（`.adversarial/ccg-deep-6a6e95a9/adjudication.json`）。
  - 逐条处置（裁决全文与证据在该文件）：

    | # | 严重度 | 结论 | 处置 |
    |---|---|---|---|
    | i1 | Critical | **成立** | 品牌图正则含「任意词 + 连字符」开放前缀，与注释的封闭词表自相矛盾，会误杀 `user-logo.png` 这类真头像文件名 ⇒ **已修**：改为只认封闭词表，并补回归锁断言 4 个真头像形态一律不判品牌图 |
    | i2 | Critical | **不成立** | `sha=9adf66fd` 是**父提交**（工具既定行为，脚本实跑自证「pre-commit 时新 commit 尚未生成，判定记录写在父 sha 上」），同一记录内另存评审目标 sha；`1361 vs 2177` 是「代码文件口径（`codeFileCount=13`）vs 整份 diff 口径」两个分母，实测 `git diff --numstat origin/main...HEAD` = 16 文件 / 1821 行，代码文件 13 个与记录吻合 ⇒ 工件未过期、未错配 |
    | i3 | Warning | **成立（昵称那半）** | uid 侧不成立（`normalizeUid` 已做形态白名单与占位拒绝）；昵称侧缺校验 ⇒ **已修**：拒绝模板占位（`{{nickname}}`）与空串，并在 docblock 写明依赖/校验/改版时行为（如实降级，不换正则重试） |
    | i4 | Warning | **不成立** | `01-docs/` 在 `check-docs-sync.sh` 的 `PRD_PATTERN` 内（文档层由门禁认定，非构建输入是分层设计）；PRD 与本记录互相引用；PRD 是用户明确要求的交付物 ⇒ 保留 |
    | i5 | Warning | **不成立** | 实现是 `const out = { ...raw }` 浅拷贝后 `delete`，**入参不被修改**，同一对象调用两次结果恒等 ⇒ 不改（改了反而偏离纯函数约定） |
    | i6 | Info | 已有覆盖 | 锁里已有前置断言「解析退化即红」（`parseItBlocks(...).length > 八平台数 × 2`） |
    | i7 | Info | **已修** | 互不依赖的资料来源改**并发取**（Promise.all 保序 ⇒ 合并顺序仍按来源声明顺序），只有 `url` 为函数的依赖链串行 ⇒ 消掉「来源数 × 8s」线性累加 |
    | i8 | Info | 已文档化 | `isBrandImageUrl` 只判绝对 URL 这一局限写进 docblock（相对路径不判，理由：误判会误伤真头像） |

  - 裁决后复跑：受影响的 `apps/desktop/electron/publishers/` + `electron/tests/account-profile-collector.test.js`
    + `src/features/accounts/` ⇒ **33 文件 / 556 例全绿**（1 例既有 skip）；
    `packages/shared-utils/src/__tests__/account-avatar-guard.test.js` ⇒ **7 例全绿**（含 i1 回归锁）。

- **第 2 轮**（针对第 1 轮处置的提交，判定 SINGLE / 81 行）：critic=claude 产出 **6 条**
  （correctness 3 / security 6 / performance 8 / maintainability 5，最低分 3），裁决如下：

  | # | 严重度 | 结论 | 处置 |
  |---|---|---|---|
  | i1 | Critical | **不成立** | 「`toCount` 引用未定义变量 `n`、粉丝数全部失效」被**源码 + 实跑**双重推翻：`n` 由上一行 `const` 声明；且本 PR 有 5 条 `followers` 断言（头条 369 / 小红书 457 / B 站 1234 / 视频号 50 / 抖音 266）实跑通过，若真抛 ReferenceError 会同时红 |
  | i2 | Critical | **成立** | 品牌图正则的**后缀**仍是开放形态 ⇒ `logo-portrait.png` / `brand-new-avatar.jpg` 这类真头像会被误杀 ⇒ **已修**：后缀改封闭词表（保住实测观测到的 `logo-toutiao.png`），并补回归锁断言三个形态不被误杀 |
  | i3 | Warning | **成立（可观测性那半）** | 「结构化 JSON 优先」不成立（loginpage 内嵌的是 **JS 对象字面量**，不是 JSON）；但「静默降级、无法观测」成立 ⇒ **已修**：页面不像登录页却取不到身份字段时打 `warn`，使「模板改版」与「账号未登录」可区分 |
  | i4 | Warning | **成立（security）** | 多个资料端点共用整包 Cookie，URL 配错即跨域泄露 ⇒ **已修**：新增 `scopedCookieHeader` —— ①**域名闸**（目标主机不在 `PLATFORM_COOKIE_DOMAINS[platform]` 内 ⇒ 一个 Cookie 都不发、也不发请求，fail-closed）②**逐 Cookie 过滤**（只发 domain 匹配目标主机的；无 domain 的保留，因为上游已按平台过滤过）。补两条回归锁：只发同主机 Cookie / 未登记主机时零请求零凭据 |
  | i5 | Info | 认可 | 评审自评并发实现正确；后续可加「批量检测整体超时 + 并发数上限」⇒ backlog |
  | i6 | Warning | **成立** | `shapeInfoResult` 只查 `typeof number`，NaN 会被写回真源 ⇒ **已修**：收口处改为 `Number.isFinite && >= 0`（不依赖上游自觉） |

- **第 2 轮处置后复跑**：`apps/desktop/electron/publishers/` + `electron/tests/` + `src/features/accounts/`
  ⇒ **93 文件 / 1434 例**，其中 3 例失败经查为**环境性**（`electron/preload/index.bundle.js` 是
  gitignore 的构建产物，fresh worktree 里没有；共享根同样没有）⇒ 跑 `pnpm run build:preload` 后
  **11/11 全绿**。该失败与本次改动无关（本次 diff 未触及 `apps/desktop/electron/preload/**`）。

- **第 3 轮**（8 条，最低分 5）：critic=claude，裁决如下：

  | # | 严重度 | 结论 | 处置 |
  |---|---|---|---|
  | i1 | Critical | **不成立** | 「品牌图前缀开放、`user-logo.png` 被误杀（实测 match true）」在第 1 轮 i1 处置中已改为**封闭词表**，并有回归锁逐条钉住（4 个真头像形态一律不判品牌图），本轮实跑 **8/8 绿** ⇒ 评审依据的代码版本已过期 |
  | i2 | Critical | **不成立** | 「无 domain Cookie 放行」不是泄露路径：跨域外发的唯一出口是**域名闸**（目标主机不在 `PLATFORM_COOKIE_DOMAINS[platform]` 内 ⇒ 零 Cookie 零请求）；无 domain 的条目来自本平台自己的会话快照与已按平台过滤的分区 Cookie。已在 docblock 写明该信任边界 |
  | i3 | Warning | **成立** | 公众号身份解析缺「模板占位值变化」的防御测试 ⇒ **已修**：补用例断言 `nick_name` 为空或 `{{…}}` 时昵称与 uid **两个键都不产出** |
  | i4 | Warning | **成立** | 字段路径用例喂的是手写 mock（实现与 mock 一起错）⇒ **已修**：新增三条用例，fixture 直接照抄 2026-10-22 实测到的**真实响应形状**（小红书 `galaxy/user/info`、抖音 `web/api/media/user/info`、知乎 `/api/v4/me`），字段路径从此锚在外部真值上 |
  | i5 | Info | 登记 backlog | 「并发上限 + 整体超时」属批量检测调度层改造，与本次范围不同；实际影响有限（每平台来源 ≤ 2，仅 B 站是依赖链） |
  | i6 | Info | 已文档化 | 品牌图规则刻意保守（宁可漏判也不误杀），新增形态靠「发现真实错图 → 补形态 + 补回归锁」逐步积累 |
  | i7 | Warning | **成立** | 存量**平台 logo / 默认头像**在采集拿不到真头像时永远留着（用户看到的正是本次报障现象）⇒ **已修**：`buildProfilePatch` 新增有界清值规则 —— 本次采集**确实判过头像**（`avatarResolved === true`）、仍取不到真头像、且真源里存的是**品牌图** ⇒ 清空。边界写死在代码里：采集失败（`avatarResolved` 缺席）一律不动真源；只清品牌图，真头像保留。配套 4 条用例 |
  | i8 | Info | **不成立** | 「URL 配错时请求仍发出」与实现相反：域名闸**先于**请求执行，主机不在平台登记域内时既不发 Cookie 也不发请求（第 2 轮 i4 已修，带回归锁） |

- **三份判定记录的收口**：本 PR 的三份 `.ccg/reviews/*.json` 曾停在 `self_play_pending` ——
  引擎的自扮演出口把 `verdict=upheld` 一律计为阻断（那些条当时确实成立、随后已修）。
  本次变更集**未命中任何高危面前缀**（判据本体 / workflows / 凭证加解密 / 登录态真源），
  按欠账门禁给出的出口②收口：`deepReview.status=cleared` + **结构化 `closureNote`**
  （轮次标记 + 逐条处置结论）+ `tier=external` + 可核证据
  （PR 评论 `https://github.com/Colinchiu007/mulpub/pull/4278#issuecomment-6353347788`，
  逐轮裁决在 `.adversarial/ccg-deep-*/adjudication.json`）。
  门禁读数：`TIER-COVERAGE dual-closed total=3 external=3 external-unverified=0`、
  `OK: 本 PR 携带执行记录或带原因的豁免`。

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
