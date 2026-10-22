# PRD：账号资料（昵称 / 头像 / 粉丝数）补全与「错误头像」治理

> 文档版本：v1.0（2026-10-22）
> 关联 change：`openspec/changes/fix-account-profile-avatar/`
> 关联执行记录：`openspec/records/fix-account-profile-avatar.md`
> 状态：已实现（随 PR #待补 落地）

---

## 0. 一句话问题陈述

账号管理页上，多个平台账号显示的是**灰色通用头像**或**平台名称**而不是账号本人的昵称与头像，粉丝数一列**全部「暂无数据」**；其中小红书账号显示的头像**不是该账号的头像**，而是平台默认图。用户无法在账号页确认「这个号是不是我自己的那个号」。

---

## 1. 背景与现象（生产真源快照，2026-10-22）

真源：`shared-user-data/backend-data/accounts.json`（10 个账号 / 9 个平台）

| 平台 | account_name（昵称） | avatar（头像） | followers（粉丝） | 现象归类 |
|---|---|---|---|---|
| baijiahao 百家号 | `百家号`（= 平台名） | `pic.rmb.bdstatic.com/bjh/portrait/…`（平台默认肖像） | 空 | 昵称=平台名 + 头像非本人 |
| kuaishou 快手 | `命运石` ✅ | `p2-pro.a.yximgs.com/uhead/…` ✅ | 空 | 仅缺粉丝数 |
| bilibili B 站 | `奔跑的丘丘` ✅ | **空** | 空 | 缺头像（B 站本号未设头像，平台返回 `noface.jpg`） |
| douyin 抖音 | `作品发布`（= 页面标题，噪声词） | `p3.douyinpic.com/aweme/100x100/aweme-avatar/…` ✅ | 空 | 昵称错 + 缺粉丝数 |
| wechat_mp 公众号 | `数字生命丘丘` ✅ | **空** | 空 | 缺头像（会话已失效） |
| toutiao 头条 | `观四方` ✅ | `sf3-cdn-tos.toutiaostatic.com/obj/mp/logo-toutiao.png`（**平台 logo**） | 空 | 头像错 + 缺粉丝数 |
| zhihu 知乎 | `知乎`（= 平台名） | `picx.zhimg.com/v2-…_l.jpg`（实为本人头像） | 空 | 昵称=平台名 + 缺粉丝数 |
| toutiao 头条 | `秋叔的觉醒` ✅ | **空** | 空 | 缺头像 + 缺粉丝数 |
| xiaohongshu 小红书 | `小红书`（= 平台名） | `sns-avatar-qc.xhscdn.com/avatar/1040g2jo31sv4l8…`（**平台默认图**） | 空 | 昵称=平台名 + 头像非本人 + 缺粉丝数 |
| tencent_video 视频号 | `搞艺术的秋叔` ✅ | `wx.qlogo.cn/finderhead/…` ✅ | `50` ✅ | 三者齐全（唯一正常样本） |

用户口头补充：**粉丝数也没有获取到**（与上表一致，10 个账号里 9 个为空）。

---

## 2. 根因分析（三条，互相独立，必须分别修）

### 根因 A：资料通道的契约里**根本没有头像这一格**

`apps/desktop/electron/publishers/http-login-checker.js` 的 `extract` 契约只声明了
`nickname` / `followers` / `platformAccountId`；`shapeInfoResult` 只搬运这三个键；
`account-profile-refresh.js` 把它交给 `buildProfilePatch` 时也只传这三个。

⇒ 凡是走 **HTTP 快速路径**（绝大多数平台）的账号，头像在架构上就**无处可落**，
只能显示灰色通用头像。**这不是「没采到」，是「没有这个字段」。**

### 根因 B：登录判定端点被反向绑死成资料端点

一张 `HTTP_CHECK_APIS` 表同时承担「登录态判定」与「资料提取」两件事。后果：

- **抖音**：注册的判定端点 `GET creator.douyin.com/aweme/v1/creator/pc/user/info/`
  真实响应是 `{"status_code":0,"uid":"…"}` —— **顶层有 uid、没有 user 对象**。
  而 `check` 读的是 `data.data.*`、`extract` 读的是 `data.user` ⇒
  ① `check` 恒返回 `undefined` ⇒ 抖音的 HTTP 快速路径**恒不成立**，永远降级浏览器检测；
  ② `extract` 恒空 ⇒ 昵称永远回落成平台名。
  真正带 user 对象的 `GET creator.douyin.com/web/api/media/user/info/` 从未被登记。
- **小红书**：原实现从创作者后台 SSR HTML 的 `data-account-id` 取 uid，而实测该页
  不直出身份属性 ⇒ 生产库小红书账号的 `platform_account_id` 一直是空。
  且小红书**没有** `check/checkHtml` ⇒ 永远走浏览器检测，而浏览器昵称选择器
  `.user-name` 在创作后台 SPA 里不存在 ⇒ 昵称恒回落成平台名「小红书」。
- **知乎**：判定页是 `www.zhihu.com`（HTML），而资料在 `www.zhihu.com/api/v4/me`（JSON），
  一张表放不下两个端点 ⇒ 昵称/头像取不到。

### 根因 C：DOM 采集的头像兜底链会抓**站点品牌图**

`packages/shared-utils/src/account-profile.js` 的头像取值链末端是
`meta[property="og:image"]`。og:image 是**站点级**的品牌图 —— 今日头条创作后台的
og:image 就是 `obj/mp/logo-toutiao.png`。它被落盘成账号头像后，
因 `buildProfilePatch` 的「值不变就不写」语义，**再也不会被正确值覆盖**。

> 同链的另一个隐患：取值是「第一个匹配 `[class*="avatar"]` 的元素」，
> 平台 SPA 的导航栏/侧边栏常有品牌头像或运营位图片。

### 根因 D（次要）：粉丝数与昵称常在不同端点

抖音 `follower_count`、小红书 `fans_count`、头条 `fans_stat.total_fans_count`、
B 站 `relation/stat.follower`、视频号 `finderUser.fansCount` 都不在昵称那个端点里，
而旧结构只允许「一个端点一个 extract」。

---

## 3. 目标与非目标

### 目标
1. 账号卡上显示**平台真实昵称**（不是平台名、不是页面标题）。
2. 账号卡上显示**账号本人头像**；平台本身没设头像时，显示平台自己的默认头像（B 站 `noface.jpg`）而不是错图。
3. 账号卡上显示**粉丝数**（能取到的平台都取到）。
4. 取不到时**如实显示「暂无数据 / 未获取」**，并给出下一步（点「验证」重新获取），不猜、不编。
5. 已落盘的**错误头像**（平台 logo / 平台默认图）能被正确值替换。

### 非目标（明确不做）
- 不做「平台没设头像时帮用户生成头像」——那是造数据。
- 不实现任何平台风控/验证码/频控机制。
- 不新增有副作用的端点（全部只读）。
- 不为公众号/百家号/知乎补粉丝数（无只读取证，见 §7 诚实缺口）——宁可空着，不猜。

---

## 4. 方案（详见实现清单）

### 4.1 资料来源与登录判定**分表**

- `HTTP_CHECK_APIS` —— 只回答「这批 Cookie 还活着吗」，行为与本轮无关（抖音仅修判定口径）。
- `HTTP_PROFILE_APIS` —— 只回答「这个账号叫什么/长什么样/多少粉丝」。
  - 每个平台可登记**多个来源**，结果按字段合并（先到先得）。
  - `url` 可以是函数，拿到前面来源的结果再决定（例：B 站 `relation/stat` 需要 nav 给出的 `mid`）。
  - 平台可声明 `responseType: 'html'`（公众号 loginpage 同页取昵称）与 `uidSource: 'cookie'`（快手，纯本地不发请求）。

### 4.2 字段路径（**全部来自 2026-10-22 真实服务端只读端点实测**）

| 平台 | 端点 | 昵称 | 头像 | 粉丝数 | 平台 ID |
|---|---|---|---|---|---|
| 抖音 | `GET creator.douyin.com/web/api/media/user/info/` | `user.nickname` | `user.avatar_larger.url_list[0]`（备选 `avatar_medium`/`avatar_thumb`） | `user.follower_count` | `user.uid` |
| 今日头条 | `GET mp.toutiao.com/mp/agw/media/get_media_info` | `data.media.display_name` | `data.media.https_avatar_url` | `GET mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat` → `data.fans_stat.total_fans_count` | `data.user.id` |
| B 站 | `GET api.bilibili.com/x/web-interface/nav` | `data.uname` | `data.face` | `GET api.bilibili.com/x/relation/stat?vmid=<mid>` → `data.follower` | `data.mid` |
| 小红书 | `GET creator.xiaohongshu.com/api/galaxy/user/info` | `data.userName` | `data.userAvatar` | `GET creator.xiaohongshu.com/api/galaxy/creator/home/personal_info` → `data.fans_count` | `data.userId`（兜底 `data.redId`） |
| 知乎 | `GET www.zhihu.com/api/v4/me` | `name` | `avatar_url` | — | `id`（兜底 `url_token`） |
| 视频号 | `POST channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data` | `data.finderUser.nickname` | —（走 DOM） | `data.finderUser.fansCount` | `data.finderUser.uniqId` |
| 快手 | （无纯 HTTP 端点，需签名） | —（走 DOM） | —（走 DOM） | — | Cookie 派生 `userId` |
| 微信公众号 | `GET mp.weixin.qq.com/cgi-bin/loginpage`（HTML 同页） | `nick_name` | —（走 DOM） | — | `uin` |

> ⚠️ **本轮推翻了仓库里三处「静态 bundle 推断」的字段名**（它们此前一直没人验证）：
> 小红书 `data.nickname`/`data.images` → 实测 `data.userName`/`data.userAvatar`；
> 抖音 `d.user.avatar_life`/`avatar_168x168` → 实测 `d.user.avatar_larger.url_list[]`；
> 抖音 `d.data.user` → 实测**顶层** `d.user`。
> 教训与逆向成果文档 §5 一致：静态推断必须运行期验证。

### 4.3 「站点品牌图」判据（新增单一数据源）

`packages/shared-utils/src/account-avatar-guard.js`：

- **判品牌图**：路径文件名段形如 `logo*.png` / `favicon.ico` / `brand-*.svg` / `sitelogo.png` 等；
  以及已知形态 `…/obj/mp/logo-*.png`。
- **不判**平台默认头像（B 站 `noface.jpg`、小红书默认头像）：那是该账号**真实在用**的头像，
  展示它比展示空白更接近平台真实形态。
- 判不出来一律**不判**（宁可不判，也不误杀真头像）。
- 页面内采集器**不得**引用该模块（函数体会被序列化注入页面）⇒ 页面内只上报**候选列表**，
  品牌图剔除统一在 Node 侧做，**判据只有一份实现**。

### 4.4 DOM 采集器修正

- **移除 `og:image` 兜底**（站点品牌图 ≠ 用户头像）——直接修掉头条的 logo 头像。
- 头像改为**收集全部候选**（`src` / `data-src` / `data-original` / `background-image:url()`），
  由 Node 侧剔除品牌图后取第一个；**全部是品牌图时不产出头像**（宁可空着，不显示错图）。

---

## 5. 数据校验与写回契约

### 5.1 字段级校验

| 字段 | 来源 | 校验规则 | 非法时的行为 |
|---|---|---|---|
| `account_name` | 昵称 | 非空字符串；命中噪声守卫（页面标题/统计块/占位文案）即丢弃 | 键缺席 = **不修改**（保留旧值） |
| `avatar` | 头像 URL | 非空字符串；剔除站点品牌图 | 键缺席 = **不修改** |
| `followers` | 粉丝数 | 有限非负数，取整 | 键缺席 = **不修改`；`0` 是**合法值**（不得当「没取到」） |
| `platform_account_id` | 平台 ID | 形态白名单 `^[A-Za-z0-9_.:-]{1,64}$`；占位值（`0`/`null`/`{{userId}}`）拒绝 | 键缺席 = **不修改**（绝不拿昵称/页面标题顶替） |

### 5.2 写回语义（沿用既有契约，不改）

- `buildProfilePatch`：**键缺席 = 本次不修改**；只下发「命中且与真源不同」的字段。
- 用户显式改名（`name_source=manual`）**永不被采集结果覆盖**。
- 资料回填失败（网络异常/端点 404/结构变更）**只记 warn**，绝不影响登录态判定。
- 端点非 2xx / 非对象响应 / 字段缺失 ⇒ 该来源**不产出任何字段**。

### 5.3 存量脏数据处理

| 存量坏值 | 处理 |
|---|---|
| 头条的 `logo-toutiao.png` | API 取得真头像后因「值不同」被覆盖 ✅ |
| 小红书的平台默认头像 | API 取得 `data.userAvatar` 后被覆盖 ✅（实测两个文件 id 不同） |
| 抖音的 `作品发布`（页面标题） | API 取得 `user.nickname` 后被覆盖 ✅（且「作品发布」本就在噪声词表内） |
| 知乎/百家号的平台名 | 知乎由 API 覆盖 ✅；百家号仍走 DOM（见 §7） |
| B 站 / 公众号的空头像 | B 站由 API 补 `noface.jpg`；公众号待重新登录后由 DOM 补 |

---

## 6. 交互与显示项（渲染层）

### 6.1 账号卡显示项

| 显示项 | 取值 | 缺失时 |
|---|---|---|
| 平台徽标 | 平台图标 + 平台名 | — |
| 头像 | `account.avatar` / `account.avatar_url` | 灰色通用图标（`UserFilled`） |
| 登录状态 | 已登录 / 已失效 / 异常 / 未确认 / 暂无检查记录 | 失效态压在头像上 |
| 账号名 | 真昵称；无昵称回落平台名；再无回落「未命名账号」 | — |
| 添加时间 | `添加于 YYYY-MM-DD` | 「账号信息已同步」 |
| 最近检查 | `最近检查 <本地时间>` | 「暂无检查记录」 |
| 粉丝数 | `粉丝：<数字>` | `粉丝：暂无数据` |

### 6.2 新增提示文字（2026-10-22）

| 触发条件 | 位置 | 文案（zh） | 文案（en） |
|---|---|---|---|
| 账号无头像 | 头像容器 `title` + `aria-label` | `未获取到账号头像，点「验证」可重新获取账号资料` | `Account avatar not fetched. Click "Verify" to fetch account info again` |
| 账号无粉丝数 | 粉丝行 `title` | `未获取到粉丝数，点「验证」可重新获取账号资料` | `Follower count not fetched. Click "Verify" to fetch account info again` |
| 有头像 / 有粉丝数 | — | 不显示提示（不打扰） | — |

设计要点：灰色通用头像本身不解释「为什么没有」——用户分不清是「平台没设头像」
还是「我们没取到」。提示必须同时给出**原因**与**下一步**（点「验证」重新获取，
该按钮已存在于卡片底部）。按钮名「验证」与卡片上的按钮文案**逐字一致**。

### 6.3 交互流程

```
用户点击账号卡底部「验证」
   └─ 主进程 checkLoginStatus(account)
        ├─ 有 Cookie 且平台已登记 HTTP 判定 → HTTP 快速路径
        │    ├─ 判定为有效 → refreshProfileFromHttpApi()
        │    │      └─ 按 HTTP_PROFILE_APIS 逐个来源取资料 → buildProfilePatch → PATCH 后端真源
        │    └─ 判定不确定 → 降级浏览器检测（隐藏窗口；渲染崩溃白名单平台不开窗）
        └─ 浏览器判定成功 → refreshProfileFromPage()
               └─ 页面内采集昵称/头像候选/粉丝/平台ID → 品牌图剔除 → buildProfilePatch → PATCH
   └─ 渲染层刷新列表 → 卡片显示新的昵称/头像/粉丝数
```

> 单账号「验证」与顶部「一键检测」走同一条链路，因此两条入口的效果一致。

---

## 7. 诚实缺口（本轮未闭合，不得假装已解决）

| 缺口 | 原因 | 现状 |
|---|---|---|
| 公众号头像 | 会话已失效，`cgi-bin/home` 返回错误页；该页不提供头像 | 仍走 DOM 采集（平台模板含 `img.user_avatar`），重新登录后可得 |
| 公众号粉丝数 | 无只读取证 | 留空 |
| 百家号昵称/头像/粉丝 | 本机无可用会话（分区无 Cookie） | 仍走 DOM 采集 |
| 知乎粉丝数 | `/api/v4/me` 不含粉丝数；未找到可只读取证的端点 | 留空 |
| 快手粉丝数 | `home/infoV2` 需 `__NS_sig3` 签名，本轮未接线 | 留空 |
| 小红书头像端到端复验 | 已取得 API 真值，但**尚未在应用内跑通一次完整回填** | 需真机验收 |

---

## 8. 验收标准

- [x] 八个账号管理平台都登记了资料来源（结构锁 `http-login-checker-uid-coverage.test.js` 拦截漏登记）。
- [x] 头像进入资料契约（此前没有这一格）。
- [x] 粉丝数 0 被当合法值。
- [x] `og:image` 不再被当作头像。
- [x] 站点品牌图不落库；全部候选是品牌图时不产出头像。
- [x] 单来源失败不牵连其它来源（粉丝端点挂了，昵称头像仍要拿到）。
- [x] 取不到就留空 + 提示下一步，绝不猜值。
- [x] 既有断言的每一次变更都在代码内写明**理由与证据**。
- [ ] 真机复验：点「验证」后账号卡上出现真昵称、真头像、粉丝数。
- [ ] 公众号/百家号/知乎/快手四个缺口在后续迭代闭合。
