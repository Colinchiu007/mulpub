# PRD：账号资料（昵称 / 头像 / 粉丝数）补全与「错误头像」治理

> 文档版本：v1.1（2026-10-22 初版；2026-10-23 补 §4.5 公众号模板取值与校验细则、§9 竞品交叉互证）
> 关联 change：`openspec/changes/fix-account-profile-avatar/`
> 关联执行记录：`openspec/records/fix-account-profile-avatar.md`、`openspec/records/fix-account-profile-extra-endpoints.md`
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
| 微信公众号 | `GET mp.weixin.qq.com/cgi-bin/loginpage`（HTML 同页） | `nick_name_decode`（回落 `real_nick_name` → `nick_name`） | **`head_img` / `head_url`** | — | `uin` |

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

### 4.5 公众号登录页模板的取值与校验细则（2026-10-23 补）

取值来源只有一个：`window.wx.commonData.data`（登录页 HTML 内嵌对象，**零新增请求**）。

| 目标字段 | 取值键（按优先级） | 形态判定 | 不合格时的行为 |
|---|---|---|---|
| 昵称 | `nick_name_decode`（函数调用形态 `handlerNickname("值", false)`）→ `real_nick_name` → `nick_name` | 长度 ≤ 40；不含控制字符（U+0000–U+001F）；非模板占位值 `{{…}}` | 跳过该候选、继续下一个；三个候选都不合格 ⇒ **不产出昵称键**（键缺席 = 不修改） |
| 头像 | `head_img` → `head_url` | 归一后 scheme **必须是** `http`/`https`；**且主机必须是公网主机形态**（拒绝 IP 字面量、单标签主机、`localhost` / `.local` / `.internal` / `.lan` / `.home.arpa`）；`javascript:` / `data:` / `file:` 一律拒绝 | 该候选被拒 ⇒ 回落下一个候选；两个都被拒 ⇒ **不产出头像键** |
| 平台 ID | `uin` | `normalizeUid` 形态白名单（纯数字；占位值 `0` / `null` / `{{userId}}` 拒绝） | 不合格 ⇒ 不产出 |

**为什么头像要卡主机形态（而不是只卡 scheme）**：头像 URL 最终进 `<img :src>`，由**用户本机**发起请求。
只判 scheme 的话，`https://192.168.1.1/x`、`https://svc.internal/...` 这类地址会原样通过 ——
页面内容一旦被污染，桌面端就会替用户去访问内网 / 跟踪地址。

**为什么不用域名闭集**：公众号头像走平台自己的图片 CDN，该域名**不在**平台的 Cookie 域名表里
（`PLATFORM_COOKIE_DOMAINS.wechat_mp` 只有 `mp.weixin.qq.com` / `weixin.qq.com`），
闭集会把**所有真头像**判死（误杀），与本仓「宁可漏判不误杀」的取舍相反。
故只挡「**不可能是公网 CDN**」的形态：真头像一个都不误伤，内网探测 / IP 外泄被堵住。

**引号闭合规则（关键，容易写错）**：字段值按「**同种引号闭合**」取 ——
双引号值用 `"…"` 配对，单引号值用 `'…'` 配对 —— 因此值里可以含**异种**引号。
若把两种引号合并成一个字符类（`[^"']*`），含引号的昵称会在第一个引号处被**静默截断**
（显示出来的名字少半截，且没有任何报错可查）。
真实模板里同种引号若要出现在值中必须被转义（模板的转义形态是 HTML 实体 `&quot;`），
所以同种引号闭合**不会漏掉真值**。

**模板微调容忍**：函数名与左括号之间允许有空白（`handlerNickname ("名字", false)` 同样能取到）——
模板什么时候改不由我方决定，一个空格不该让昵称静默消失。

**登录页关键词只有一份**：登录页判定关键词（`扫码登录` / `请使用微信扫码` / `请登录` / `welcome_login`）
由解析器**导出唯一一份**，资料侧与登录判定侧都引用它 ——
各抄一份的话，改了其中一处就会让「判定未登录」与「不产出资料」给出相反结论。

**页面体积上限**：超过 **2MB（按 UTF-8 字节计）** 的页面**整体不解析**。
判据按**字节**而不是 `String.length`（UTF-16 单元数）—— 中文页面按字符数会低估真实体积
（150 万个汉字 = 150 万单元，但 UTF-8 是 450 万字节）。
超限时**不截断而是整体放弃**：截断会把 `head_img` 之类的字段切掉，
制造「解析不出」与「字段不在」两种难以区分的假空值。

**登录页形态优先短路**：页面出现「扫码登录 / 请使用微信扫码 / 请登录 / welcome_login」时，
即便页面里同时出现示例 `uin` / `nick_name`，也**一律不产出**任何资料字段。

**结构化失败原因**（落进日志，用于区分两类问题）：

| `reason` | 含义 | 该怎么修 |
|---|---|---|
| `no_html` | 没拿到页面 | 查网络/端点 |
| `login_page` | 是未登录的登录页 | 重新登录 |
| `page_too_large` | 页面异常大 | 查是否被劫持/注入 |
| `identity_fields_missing` | 页面不像登录页，且**身份字段根本不存在** | **多半是模板改版** |
| `identity_fields_invalid` | 字段**在**，但值形态全不合格（含模板占位值 `{{…}}`） | 查取值规则 / 服务端是否渲染了 |
| `nickname_invalid` | 昵称字段在但形态不合格（超长 / 含控制字符 / 占位值），其余字段正常 | 查形态白名单 |
| `avatar_rejected_scheme` | 头像字段在，但 scheme 或主机形态不合法 | 查白名单 |

> 「模板改版」与「字段值不合法」的修法完全不同（前者改解析、后者改校验），
> 所以失败原因必须**结构化**，不能只记一句「解析失败」。
> 另注：模板占位值（`{{nickname}}`）算「**值不合格**」而不是「字段缺失」——
> 把两者混为一谈会把「这次没渲染出昵称」误报成「模板改版」，把排查引向错误方向。

**夹具纪律**：测试夹具里的昵称 / 账号 ID / 头像 URL **全部是虚构值**（保留域 `example.invalid`），
解析规则与真实模板同构（字段名、赋值形态、转义形态一致）但**值是假的** ——
真实账号昵称/ID 属用户数据，不得进仓库。

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
| ~~公众号头像~~ | **已闭合（2026-10-23 补）** | 登录页模板内嵌 `window.wx.commonData.data` 的 `head_img` / `head_url` ⇒ **零新增请求**即可取到（详见 §9） |
| 公众号昵称的空格 | **已闭合（2026-10-23 补）** | 模板的 `nick_name` 是「encode 一次」的结果（空格等会被转义），改为优先取 `nick_name_decode`（平台自己 decode 过） |
| 公众号粉丝数 | 无只读取证 | 留空 |
| 百家号昵称/头像/粉丝 | 本机无可用会话（分区无 Cookie） | 仍走 DOM 采集 |
| 知乎粉丝数 | `/api/v4/me` 不含粉丝数；未找到可只读取证的端点 | 留空 |
| 快手粉丝数 | 账号端点 `authority/account/current` **直连被拒**（实测 `{"result":500002,"message":"请稍后重试"}`）⇒ 必须带 `__NS_sig3` 签名 | 留空；需用已合入的 `kuaishou-sig3.js` 单独接一轮（竞品用「页面注入 + 拦 XHR」绕开签名，因为签名由页面自己的 JS 算） |
| 头条 / 抖音的**兜底资料源** | 已实测存在等价端点（见 §9），但加兜底需要先有「按需取数」机制（只在主源缺字段时才请求），否则每次检测都多一次请求 | 记入 backlog，本轮不加 |

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
- [x] **我方已登记的字段路径被第三方端点独立互证**（见 §9）—— 抖音/头条各有两个互不相干的端点给出同一组数值。
- [ ] 真机复验：点「验证」后账号卡上出现真昵称、真头像、粉丝数。
- [ ] 百家号/知乎/快手三个缺口在后续迭代闭合。

---

## 9. 与竞品逆向成果的交叉互证（2026-10-23 补）

两个**参考产品**的逆向成果给了两样东西：**端点清单**与**注入规则**。
（参考产品 A = 页面注入式；参考产品 B = 平台 API 式。下同。）
本轮把它们当**候选**逐个实测，结论分三类：互证通过、可用但无净收益、已失效。

### 9.1 互证通过（最有力的一类：两个互不相干的来源给出同一组数值）

| 平台 | 我方登记的端点 → 实测值 | 竞品来源的端点 → 实测值 | 结论 |
|---|---|---|---|
| 抖音 | `GET creator.douyin.com/web/api/media/user/info/` → `user.nickname` / `user.follower_count=266` | `GET creator.douyin.com/aweme/v1/creator/user/info/` → `user_profile.nick_name` / `user_profile.follower_count=266` | **同一昵称、同一粉丝数** ⇒ 端点与字段路径正确 |
| 头条 | `GET mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat` → `fans_stat.total_fans_count=369` | `GET mp.toutiao.com/mp/agw/creator_center/user_info` → `total_fans_count=369` | **同一粉丝数** ⇒ 正确 |
| 头条头像 | `get_media_info` → `data.media.https_avatar_url` = `/img/user-avatar/910883f6…~300x300.image` | `creator_center/user_info` → `avatar_url` = **同一路径** | 正确 |
| 知乎 / B 站 / 快手 / 视频号 | 我方端点 | 竞品注入规则命中**同一 URL**（`/api/v4/me`、`/x/web-interface/nav`、`authority/account/current`、`auth/auth_data`） | 正确 |

> 竞品的端点与本仓的端点**由两个互不相干的来源独立得出**，这比任何单方文档都硬。

### 9.2 可用但**无净收益**（故不登记）

| 候选端点 | 实测 | 为什么不登记 |
|---|---|---|
| 头条 `mp/agw/creator_center/user_info` | ✅ 昵称 + 头像 + 粉丝数**一个端点全给** | 与我方现有两个端点字段等价；加进来要么每次多一次请求，要么把现有端点挤成死代码。保留「拆成两个端点」更健壮（一个改版不影响另一个） |
| 抖音 `/aweme/v1/creator/user/info/` | ✅ 昵称 + 头像 + 粉丝数一个端点全给 | 同上（且它的头像是 100×100，比我方 1080×1080 更小） |

### 9.3 已失效 / 不可用（排除）

| 候选端点 | 实测 | 结论 |
|---|---|---|
| 视频号 `auth/get_auth_info` | 返回 **HTML 页面**（非 JSON） | 端点已改版，排除 |
| 抖音 `/aweme/v1/creator/pc/user/info/` | 只回 `{status_code, uid}`，**无 user 对象** | 印证「判定端点不含资料」⇒ 它只能当登录判定用 |
| 快手 `authority/account/current`（直连） | `{"result":500002,"message":"请稍后重试"}` | 未带 `__NS_sig3` 签名被拒 ⇒ 粉丝数需签名器接线 |

### 9.4 ★ 意外收获：公众号头像在同一页就有

竞品字符串表里有 `mp.weixin.qq.com/misc/getheadimg?fakeid=`（公众号头像端点线索）。
实测**页面模板本身就内嵌账号资料对象** `window.wx.commonData.data`，字段（模板自带注释）：

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

⇒ **公众号头像零新增请求即可拿到**（我方本来就在抓这一页），且**不需要** `getheadimg?fakeid=` 那个端点。
⇒ 昵称应取 `nick_name_decode`（平台自己 decode 过，空格是真空格），否则带空格的昵称会显示成转义残渣。
⇒ `head_img` 的 `http://` → `https://` 归一照做（平台模板自己就这么写，说明它知道这个头图在 https 页面里会被当混合内容拒）。

### 9.5 机制差异（为什么我方比竞品轻）

| | 参考产品 A（页面注入式） | 参考产品 B（平台 API 式） | 我方 |
|---|---|---|---|
| 取数机制 | **浏览器注入 + 拦平台自己的 XHR** | 平台 API（RPA 适配器） | **Node 直连 + Cookie**（无浏览器） |
| 粉丝数来源 | 数据看板**页面**上读数字 | 数据概览 API | 只读统计 API |
| 签名平台 | 注入页自带签名（快手 sig3 由页面算） | 自己算 | 需单独接签名器（快手） |
| 快路径 | 慢 | 中 | 快（<1s/平台） |

> 这也解释了**为什么我方快手只能走 DOM 路径**：`authority/account/current` 直连被拒（需 sig3），
> 而 DOM 路径在页面内执行、签名由页面自己算。竞品用注入同样受益于这一点。
