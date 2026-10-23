---
record: fix-account-profile-extra-endpoints
task: 用竞品逆向成果交叉验证账号资料端点，并补齐公众号头像/昵称
date: 2026-10-23
---

## 本次执行记录：账号资料端点交叉验证与公众号头像补齐（fix-account-profile-extra-endpoints，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码 | 隔离 worktree `mp-fix-account-profile-extra-endpoints`（裸分支 `fix-account-profile-extra-endpoints`，非系统盘）；共享根保持 main + clean |
| 第一性原因（QM-5 ①） | 1 条 | 上一轮（PR #4278）补齐了 8 个平台的资料通道，但**公众号头像仍是缺口**：当时只知「loginpage 模板里有 `nick_name`」，**不知道模板里还有 `head_img` / `head_url`（头像）与 `nick_name_decode` / `real_nick_name`（更准的昵称）**。本轮由竞品逆向成果的候选端点出发实测，挖出了这批字段。 |
| 逃逸分析（QM-5 ②） | 3 环 | ① 上一轮只把 loginpage 当「昵称来源」，**没把同一页当「头像来源」**（页面上有头像字段这件事没人查过）；② 竞品成果里的头像线索是**另一个端点** `misc/getheadimg?fakeid=`，天然会把人引向「新增端点」而不是「翻同一页的模板」；③ 昵称取 `nick_name` 而模板注释明写它是「encode 一次」的结果 ⇒ 带空格的昵称会显示成转义残渣，而**没有带空格的账号测不出来**。 |
| 修复 + 回归保护（QM-5 ④） | 见下 | 公众号昵称优先取解码值；头像取 `head_img`/`head_url` 并做 `http://`→`https://` 归一；昵称/头像形态白名单；结构化失败原因；异常大页面不解析 |
| 防止再次发生（QM-5 ⑤） | 5 道锁 | ①新建 `http-profile-api-wechat.test.js`（**26 例**）锁公众号资料契约与结构化 reason；②昵称/头像形态白名单（长度、控制字符、模板占位值、URL scheme、**主机公网形态**）；③解析失败给出**结构化 reason**（区分「模板改版」与「值不合法」）；④**登录页关键词单一真源**（解析器/资料侧/登录判定侧三处合一）；⑤字段值按「**同种引号闭合**」取 + 体积判据按**字节**算 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 逐文件一致（提交前现测） |
| 接线棘轮 | PASS | 新增测试落在既有 `apps/desktop/electron/publishers/` 测试域（被 desktop shard 收录），`node scripts/check-unwired-tests.js` 读数为「全部测试均已接线或按欠账登记」 |
| QM-1 打包 / QM-4 视觉 | QM-1 PENDING / QM-4 N/A | QM-1：触面含 `apps/desktop/electron/**`，按 AGENTS.md 须跑本地打包验证；打包证据由 CI `build` job 统一取证 ⇒ 如实记 PENDING，不伪造。QM-4：无样式/路由变更 ⇒ N/A |
| QM-6 CCG 双模型外部评审 | 已跑 4 轮，处置见「## 评审」 | critic=claude / proposer=opencode，两个后端实测可跑，跨家族校验通过；第 1~4 轮逐条裁决并处置，高危域条目已外部复核（证据公开于 PR 评论） |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

### 做了什么（用户视角）

- **公众号账号卡现在会显示头像**（此前恒为空 ⇒ 灰色通用图标）。头像与昵称取自**同一个已存在的请求**（公众号登录页），**不新增任何网络请求**。
- **公众号昵称更准**：平台模板里 `nick_name` 是「encode 一次」的转义形态（带空格时显示成 `%20`/`&nbsp;` 一类残渣），现改为优先取平台自己 decode 过的 `nick_name_decode`，再回落 `real_nick_name` → `nick_name`。

### 证据链：竞品候选端点逐个实测（2026-10-23）

实测方式同上一轮：本机已登录账号的 Cookie（Electron `persist:*` 分区只读快照）调**只读**端点，
只打印字段名/形态，不打印任何 Cookie/token/昵称/ID 值。

| 候选端点（来源） | 实测结果 | 处置 |
|---|---|---|
| 头条 `mp/agw/creator_center/user_info`（参考产品 A 的注入规则） | ✅ **一个端点给出昵称+头像+粉丝数**（`name` / `avatar_url` / `total_fans_count=369`） | **不登记**：与我方现有两个端点字段等价；登记它要么每次多一次请求，要么把现有端点挤成死代码。保留「拆成两个端点」更健壮（一个改版不影响另一个） |
| 抖音 `/aweme/v1/creator/user/info/`（参考产品 B 的 RPA 适配器） | ✅ `user_profile.nick_name` / `avatar_url` / `follower_count=266` | 同上，不登记（且它头像是 100×100，比我方 1080×1080 小） |
| 抖音 `/aweme/v1/creator/pc/user/info/` | 只回 `{status_code, uid}`，**无 user 对象** | 印证「判定端点不含资料」⇒ 它只能当登录判定用 |
| 视频号 `auth/get_auth_info`（参考产品 A 的注入规则） | 返回 **HTML 页面**（非 JSON） | 端点已改版 ⇒ 排除 |
| 快手 `authority/account/current` 直连 | `{"result":500002,"message":"请稍后重试"}` | 未带 `__NS_sig3` 签名被拒 ⇒ 快手粉丝数需签名器接线（独立 PR） |
| 公众号 `misc/getheadimg?fakeid=`（竞品字符串表） | 本轮**不需要它** | 模板里就有 `head_img`/`head_url` ⇒ 同一页取，零新增请求 |

### ★ 字段级互证（两个互不相干的来源给出同一组数值）

| 平台 | 我方登记的端点 → 实测 | 竞品来源的端点 → 实测 |
|---|---|---|
| 抖音 | `web/api/media/user/info/` → `user.nickname` / `user.follower_count=266` | `aweme/v1/creator/user/info/` → `user_profile.nick_name` / `follower_count=266` |
| 头条 | `statistic/v2/fans/latest_stat` → `fans_stat.total_fans_count=369` | `creator_center/user_info` → `total_fans_count=369` |
| 头条头像 | `get_media_info` → `data.media.https_avatar_url` = `/img/user-avatar/910883f6…~300x300.image` | `creator_center/user_info` → `avatar_url` = **同一路径** |
| 知乎 / B 站 / 快手 / 视频号 | 我方端点 | 竞品注入规则命中**同一 URL**（`/api/v4/me`、`/x/web-interface/nav`、`authority/account/current`、`auth/auth_data`） |

> 竞品的端点与本仓的端点**由两个互不相干的来源独立得出**，比任何单方文档都硬。

### ★ 关键发现：公众号登录页模板自带账号资料对象

竞品字符串表里的头像线索是另一个端点 `misc/getheadimg?fakeid=`，但实测**同一页的模板**里就有
`window.wx.commonData.data`（模板自带注释）：

```
uin              账号 ID（数字）
user_name        用户名
nick_name        // encode 一次            → 只 encode 过，可能是转义残渣
nick_name_decode // encode 一次 decode 一次，因为空格需要特殊转义处理 → 显示用这个
real_nick_name   // 真实 nick_name，后台无兜底逻辑，未设置则返回空
head_img         // ''.replace('http://', 'https://')  → 头像
head_url         → 头像的另一种 URL 形态
alias / verify_status / sp_user_name / sp_nick_name …
```

⇒ **头像零新增请求**即可拿到；`http://`→`https://` 归一照做（平台模板自己就这么写，
说明它知道这个头图在 https 页面里会被当混合内容拒掉）。

## 评审

- **QM-6 CCG 双家族外部评审**：`scripts/ccg-review.ps1 -Mode Deep`
  - 后端体检：critic=**claude**（2.1.303）、proposer=**opencode**（1.18.34），均实测可跑。
  - 判定 DUAL（变更 214 行 > 200 行阈值），跨家族校验通过。
  - 第 1 轮：critic 产出 **7 条**（correctness 4 / security 3 / performance 6 / maintainability 2，最低分 2），
    其中 **1 条高危域（`auth`）**。逐条处置：

    | # | 严重度 | 结论 | 处置 |
    |---|---|---|---|
    | i1 | Critical | **不成立** | 「`.ccg/reviews/*.json` 泄露评审流程」的前提被实测推翻：主干上已有 **2058** 个同类产物（`.ccg/` 共 3233 个文件），是仓库既有机制（pre-commit 自动 stage），本 PR 未引入新泄露面。改机制属跨仓工程决策，不在本 PR 范围。 |
    | i2 | Critical（高危域 auth） | **成立** | 测试夹具里用了**真实账号昵称**（来自生产真源）⇒ 已改为**全虚构值**（`example.invalid` 保留域 + 假昵称 + 假 ID），并在夹具注释里写明纪律。同时补形态白名单与结构化失败原因。**外部复核见第 2 轮**（高危域不接受自扮演豁免）。 |
    | i3 | Warning | **成立** | 「只靠非空判断、无结构化错误信息」⇒ 已加：昵称形态白名单（长度 ≤ 40、无控制字符）、解析失败给出结构化 `reason`（`identity_fields_missing` / `identity_fields_invalid` / `nickname_invalid` / `avatar_rejected_scheme` / `page_too_large`），并写进 warn 日志。 |
    | i4 | Warning | **成立** | 「头像 URL 未校验 scheme，`javascript:`/`data:` 会漏过」⇒ 已加 **scheme 白名单**（仅 http/https），非法返回空串（= 不产出头像）。这条是真问题：头像 URL 最终进 `<img :src>`，而这是链路上唯一能收口不可信字符串的地方。 |
    | i5 | Warning | **不成立** | 与 i1 同源（评审产物落盘位置），同上。 |
    | i6 | Info | **部分采纳** | 「无长度截断」⇒ 已加**异常大页面（>2MB）整体不解析**的兜底；但**不按建议截断**——截断会把 `head_img` 之类的字段切掉，制造「解析不出」与「字段不在」两种不同的假空值，排查时更糊。 |
    | i7 | Info | **不成立** | 「自定义全局 mock 与标准 vitest 不兼容」是**仓库既有测试基建**（`global.__enableElectronMock()` 全 desktop 套件通用，如 `http-login-checker-info.test.js` 同样用），本 PR 只是沿用；改成插件化是全仓工程，超出本 PR 范围。 |

  - 第 2 轮（对修复后的代码复核，7 条 / 最低分 5 / 高危域归零）：

    | # | 严重度 | 结论 | 处置 |
    |---|---|---|---|
    | i1 | Critical | **成立** | 「一次性脚本 `fix-control-re.cjs` 被提交进仓库」⇒ 已 `git rm --cached` + `node scripts/safe-delete.js` 删除（可恢复删除，审计日志在 safe-delete.log）。**教训**：取证脚本留在仓外，别进版本控制。 |
    | i2 | Critical | **不成立** | 「`.ccg/reviews/*.json` 的 `sha` 与 proposal head 不一致」⇒ 该字段记的是**判定时**的父提交（pre-commit 时新 commit 还不存在），是既定行为不是错配。 |
    | i3 | Warning | **驳回（附理由）** | 「头像 URL 应限死已知 CDN 域名」⇒ **不采纳域名闭集**：公众号头像走平台图片 CDN，该域名不在 `PLATFORM_COOKIE_DOMAINS.wechat_mp` 里，闭集会把**所有真头像**判死（误杀），与本仓「宁可漏判不误杀」的取舍相反。**但**指出的风险是真的 ⇒ 改成「主机形态白名单」（见第 3 轮 i2 的处置）。 |
    | i4 | Warning | **成立** | 「测试依赖 `global.__enableElectronMock()` 无守卫」⇒ 已在测试文件头**写明前置条件来源**（`apps/desktop/test-setup.js` 登记在 `vitest.config.js` 的 `setupFiles`），并说明**故意不写**防御分支：写了会让本文件在 setupFiles 缺失时静默不跑（用例数变 0 而 CI 仍绿），与「vitest include 是白名单」是同一类静默失败。 |
    | i5 | Warning | **成立** | 「`[^"']*` 会在值里遇到引号时静默截断昵称」⇒ 已改成「同种引号闭合」（双引号值配双引号、单引号值配单引号），并加 2 例锁住。 |
    | i6 | Info | **成立** | 「体积判据用 `String.length`（UTF-16 单元）会低估中文页体积」⇒ 已改 `Buffer.byteLength(html,'utf8')`，并加 1 例（150 万汉字 = 450 万字节 ⇒ 必须拦下）。 |
    | i7 | Info | **不成立** | 「`.ccg/reviews/*.json` 暴露内部工作流元数据」⇒ 主干已有 **2058** 个同类产物，是仓库既有机制（pre-commit 自动 stage），本 PR 未引入新泄露面。 |

  - 第 3 轮（**整个 PR 差量** origin/main..HEAD，7 条 / 最低分 4 / 含 1 条高危域 `auth`）：逐条处置见下方「第 3~4 轮裁决」。
  - 第 4 轮（按第 3 轮结论修复后，**复评整个 PR 差量**）：结论见下方。

### 第 3~4 轮裁决（外部双家族评审的逐条处置）

高危域条目（`auth`）**不接受自扮演豁免**：必须由外部后端（`expectedExternalBackend=claude`）复核，
并把「外部复核结果」以**公开 PR 评论**的形式贴出（URL 记在评审产物的 `externalReview.evidenceRef`）。
本轮的外部复核证据见 PR #4310 的评审评论（claude 的原始输出逐字公开）。

### 遗留（不假装已闭合）

- **快手粉丝数**：账号端点直连被拒（`result:500002`）⇒ 需用已合入的 `kuaishou-sig3.js` 签名器接一轮（独立 PR）。
- **公众号粉丝数**：无只读取证 ⇒ 留空（卡片上明示）。
- **百家号昵称/头像/粉丝**：本机无可用会话 ⇒ 仍走 DOM 采集。
- **知乎粉丝数**：`/api/v4/me` 不含粉丝数 ⇒ 留空。
- **头条/抖音的兜底资料源**：已实测存在等价端点，但加兜底需要先有「按需取数」机制
  （只在主源缺字段时才请求），否则每次检测都多一次请求 ⇒ 记入 backlog，本轮不加。

## CHANGELOG 条目

# fix(公众号): 账号卡显示账号头像，昵称取平台解码后的值（fix-account-profile-extra-endpoints）

- 公众号账号现在显示账号本人头像（此前恒为空，只能看到灰色通用图标），头像与昵称取自同一个已有请求，不新增网络请求。
- 公众号昵称不再显示转义残渣（平台对昵称做过一次编码，现优先取它解码后的那份）。

## learnings

### lesson: 同一个页面往往同时是多个字段的来源（same-page-is-multi-field-source）

**现场**：账号资料里公众号头像恒为空，仓库里的既有结论是「loginpage HTML 只提供 `nick_name`」——
这句话本身没错，但它把「昵称来源」和「页面能力」混为一谈了：同一页的
`window.wx.commonData.data` 里还有 `head_img` / `head_url`（头像）和
`nick_name_decode`（解码后的昵称）。

**根因**：需求被表述成「给头像找个端点」，于是去找端点（竞品成果里正好有个
`misc/getheadimg?fakeid=` 线索），而**没去翻已经在抓的那一页**。
既有结论一旦写成「某页只有 X」，后来者就不会再查这页还有没有别的字段。

**可复用的 2 条**：

1. 写「某接口只提供 A」这类结论时，**同时写下「它还提供什么」**（哪怕当时是空的），
   否则下一个人会把「没查过」读成「没有」。
2. 找端点之前先问一句：**我已经在抓的响应里有没有这个字段？** 本轮的头像就是零新增请求拿到的。

### lesson: 字段的「编码形态」会伪装成「取错值」（encoded-value-looks-like-wrong-value）

**现场**：公众号昵称取的是模板里的 `nick_name`，而模板注释明写它「encode 一次」
（空格等会被转义），另有一份 `nick_name_decode` 是平台自己 decode 过的。

**根因**：我方测试用的昵称**恰好不含空格**，转义形态与原形态长得一样 ⇒ 缺陷测不出来；
生产账号名里有空格时才现形。这类缺陷不会报错、不会让任何测试变红，
**只有"刚好踩中"的账号才会显形**。

**可复用的 1 条**：从外部取值时，**要按「取到的值会被怎么用」来定判据**：
显示用的字符串要看它是不是「已解码形态」，而不是「看起来像不像原值」。
