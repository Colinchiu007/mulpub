# 账号卡片昵称显示错误 — Bug 反哺复盘（account-nickname-noise-fix，2026-09-26）

现象：账号管理页 7 个账号卡片，6 个的「自媒体用户名称」显示为垃圾文本。

| 平台 | 卡片显示 | 应显示 |
|---|---|---|
| 微信公众号 | 数字生命丘丘 | 正确（唯一一条） |
| 今日头条 | 485.9万人看过 | 账号昵称 |
| 知乎 | 分享此刻的想法...同步到圈子发想法 | 账号昵称 |
| Bilibili | 哔哩哔哩 (゜ | 账号昵称 |
| 小红书 | 小红书创作服务平台 | 账号昵称 |
| 快手 | 快手创作者服务平台 | 账号昵称 |
| 抖音 | 抖音 | 账号昵称（库里是「抖音创作者中心」，被守卫拦后回落平台名） |

## ① 根因溯源（第一性引入点）

真源 `userData/backend-data/accounts.json` 的 `account_name` 字段本身就是脏的 —— 不是显示层取错字段。

追溯链条：

- `852ae22c`（PRD-ACCOUNT-PROFILE-INFO-2026-09-23，#2290）在 `packages/shared-utils/src/account-profile.js` 的 `accountInfoCollector` 里为昵称加了三级「标题类」兜底：`og:title` → `twitter:title` → `document.title`。**当时的意图**是「DOM 选择器没命中时至少给个名字」，误把「网页标题」当成昵称的同义物。
- `be181b69`（PRD-ACCOUNT-CARD-DISPLAY-FIX-2026-09-24）补了 `account-name-guard.js` 去追这批产物，但采用**枚举式黑名单**（`KNOWN_PAGE_TITLES` 逐个列举已见过的垃圾标题）。

三个具体缺陷：

1. **标题不是昵称**（`account-profile.js` 原 64-79 行）。`小红书创作服务平台` / `快手创作者服务平台` / `抖音创作者中心` 就是各平台创作者后台的 `document.title`，无分隔符时原样入库。
2. **去后缀正则匹配首个分隔符而非最后一个**。`/\s*[-–—|·]\s*(.+)$/` 对 `哔哩哔哩 (゜-゜)つロ 干杯~-bilibili` 在颜文字内部的 `-` 处就切断，产出残缺的 `哔哩哔哩 (゜`（已实测复现，逐字符一致）。
3. **通用选择器过宽**。`[class*="creator"] span` 命中页面统计块 → `485.9万人看过`；`.user-info` / `[class*="profile"] strong` 命中输入框占位与整块容器 → `分享此刻的想法...同步到圈子发想法`。

## ② 逃逸链（逐层为什么没拦住）

| 层级 | 为什么没拦住 |
|---|---|
| 单元测试（采集器） | **断言反向固化了错误行为**：`account-profile-collector.test.js` 有一条用例直接断言「全部缺失时回落 document.title 并剥掉平台后缀」为正确，fixture 用的是干净标题 `我的主页 - 哔哩哔哩`。它把缺陷本身钉成了契约。 |
| 单元测试（守卫） | `account-name-guard.test.js` 的样本全部取自 `KNOWN_PAGE_TITLES` 自身枚举 —— 用黑名单测黑名单，对任何新垃圾形态天然免疫。 |
| 集成测试 | 无「真机登录后 `account_name` 合理性」断言；`account-manager-extract-info.test.js` 只喂 `{ nickName: '张三' }` 这类构造数据。 |
| E2E | `tests/e2e/specs/` 下账号相关 spec 只验登录态三态与头像遮罩，不验昵称文本。 |
| 视觉回归 | 昵称是动态数据，`test:visual:pixel` 基线在 1920 CSS 下烘死了当时的布局与文案，数据变化不作为 diff 判据。 |
| 代码审查 | QM-2 清单无「DOM 采集兜底源可信度」与「枚举黑名单必须配结构化规则」条目。 |

## ③ 系统性漏洞定位

**类型：测试质量不足 + 审查盲区（复合）。**

- 具体文件/环节：`apps/desktop/electron/tests/account-profile-collector.test.js` 的 T1 组用例、`packages/shared-utils/src/__tests__/account-name-guard.test.js`。
- 机制缺口：噪声判定只有「已知垃圾词枚举」这一种**负向**表达，没有「什么才像昵称」的**正向**契约。因此每出现一种新垃圾形态就要改一次代码 + 补一次枚举，而测试恰好把这套枚举当成正确性的定义 —— 这是该模块长期停在「拦住 1/6」的结构性原因，不是漏写几个词。
- 同族历史：与 `01-docs/learnings.md`「昵称/头像『没获取到』的真根因是装饰性链路 + PATCH 空串反向覆写（account-profile-info，2026-09-23）」是同一链路的第二次复发。

## ④ 修复 + 回归保护

### 采集端 `packages/shared-utils/src/account-profile.js`

- 删除 `og:title` / `twitter:title` / `document.title` 三级昵称兜底。选择器未命中即**不产出 `nickName` 键**，由 `buildProfilePatch()` 既有的「键缺席 = 不修改」语义保住上一次的真值，展示端回落平台名。
- 通用昵称选择器表收窄为语义明确指向名字节点的 7 条（移除 `.user-info`、`[class*="profile"] h1`、`[class*="profile"] strong`、`[class*="creator"] h1`、`[class*="creator"] span`）。
- `trySelectors` 新增可选 `maxLen`，昵称候选上限 30 字符。**长度只放在采集端不放守卫**：用户手写的长名字不该被展示端判成垃圾藏起来。

### 守卫端 `account-name-guard.js` + `account-name-guard.browser.js`（孪生同步）

在保留既有枚举规则的基础上新增 4 条**可泛化**规则：

| 规则 | 抓到的生产垃圾 | 不误杀的对照 |
|---|---|---|
| 站点 chrome 后缀（`endsWith`：创作者服务平台/创作服务平台/服务平台/工作台/管理后台/开放平台/数据中心） | 小红书创作服务平台、快手创作者服务平台 | 某地政务服务中心 |
| 指标量词（数字 + 可选量词 + 统计项） | 485.9万人看过、1.2万次阅读 | 36氪、1998年的夏天、1.2万 |
| 占位文案指纹（省略号 `...`/`…`/`。。`） | 分享此刻的想法...同步到圈子发想法 | — |
| 截断指纹（中英文括号开合数量不等） | 哔哩哔哩 (゜ | 阿b(≧▽≦)、小新的日常(vlog) |
| 标题形态指纹（空格包裹的分隔符 `\s[-–—\|·]\s`） | 头条号 - 个人中心、我的主页 - 哔哩哔哩 | A-B、K-Line、小·明、上下-五千年 |

`profileForCreate` / `buildProfilePatch` 已调用守卫，故**写库侧随守卫升级自动加强**，无需另改。

### 第三处同源缺陷：`captured.name` 绕过守卫（审查自己 diff 时发现，已一并收口）

`apps/desktop/electron/services/auth-view-manager.js:340` 把 `document.title` 装进 `authData.name`；`account-manager.js` 的两处写回点（创建 `saveCapturedAccount` 与重登 `updateCapturedAccount`）原样把它作为 `name` POST/PATCH 进真源，**并且**把它当 `profileForCreate` 的昵称兜底 —— 而 `profileForCreate` 只对 `accountInfo.nickName` 过守卫，对 `fallbackName` 不过。于是即便采集器已修好，新增账号仍会把站点名写进 `account_name`（`'公众号'` 本身就是 `KNOWN_PAGE_TITLES` 成员，守卫早就认识它，只是没人调用）。

修复：新增 `resolveAccountDisplayName(rawName, platform)` 作为这两处的唯一入口 —— 命中噪声即回落 `getPlatformName(platform)`，与卡片展示端、采集写回端共用同一份判定。

对应地，`account-manager.test.js:382` 与 `account-manager-profile.test.js:106` 两处**正面断言网页标题成为账号名**的用例（`name: '公众号'` → `account_name: '公众号'`；`runCreate({})` → `'头条号'`）是同一类「测试反向固化错误行为」，已改为断言回落平台名，并各加一条「干净真实昵称仍保留、不得一律降级」的反向用例。


### 存量数据（决策：展示回落 + 验证回填，不写迁移）

守卫升级后 6 条脏名全部命中噪声 → 卡片直接显示平台名。其中 `douyin` / `toutiao` / `wechat_mp` / `bilibili` 已在 `http-login-checker.js` 注册 `extract`，点「验证」即经 `refreshProfileFromHttpApi` 用平台 API 真昵称覆盖（该路径本就只在「现网名命中噪声」时才覆盖，用户手输名受保护）。`xiaohongshu` / `kuaishou` / `zhihu` 无 HTTP extract，需重新登录一次由 DOM 采集补齐。

### 回归保护测试

- `packages/shared-utils/src/__tests__/account-name-guard.test.js`：新增 3 组用例。① 6 条生产脏值 `filter(isNoiseAccountName)` 结果 `toEqual` 原数组（精确结构断言，非 toContain）；② 8 条真实昵称/品牌名负控；③ 每条新规则各自的边界（`1.2万` 不判、`A(B)` 判、`想法……` 判）。
- `apps/desktop/electron/tests/account-profile-collector.test.js`：把 3 条「标题兜底为正确」的错误断言**反转为「标题一律不采纳」**，并新增「选择器不得命中统计块/占位容器」「超长容器文本不采纳」两组。
- parity 回归扩展：`CHROME_SUFFIXES` / `METRIC_PATTERNS`（按 `source` + `flags`）/ `ELLIPSIS_PATTERN` / 括号字符表纳入 CJS↔ESM 逐字一致断言，防止只改一侧。

### 反证（确认新断言能失败）

用 `git show HEAD:` 取出改动前的两份实现，在同一 fixture 上跑新用例的判据：

- 守卫：6 条脏值中 **5 条 `old=false`**（只有「抖音创作者中心」因既有 `NOISE_KEYWORDS` 命中）→ 新规则确实改变了结果；8 条负控在新旧实现下均为 `false` → 未引入误杀。
- 采集器：5 个标题 fixture 在旧实现下**全部被采纳为 nickName**（含逐字符复现出生产库里的 `哔哩哔哩 (゜`），3 个容器 fixture 同样全部命中 → 断言可失败，非恒真。

## ⑤ 预防措施（已落地文件）

1. `AGENTS.md` QM-2 新增两条门禁条目：「DOM 采集禁止把标题类来源当结构化身份字段」「枚举式黑名单必须配结构化正向契约，且测试样本不得取自被枚举集合本身」。
2. `01-docs/learnings.md` 追加 pitfall 条目（含反证手法与「断言反向固化错误行为」的识别信号）。
3. `.quality-gates.md` 登记本次门禁执行记录与反证证据。
4. `CHANGELOG.md` 收口本次变更。

## 已知遗留（如实登记，本次不扩大范围）

- 守卫作用于展示端时无法区分「采集写入」与「用户手动改名」，因此命中新规则的名字（例如用户真把账号命名为「XX服务平台」）会被回落成平台名。后果仅为显示层，且下次 HTTP 回填会用平台真昵称覆盖。彻底解决需要给账号表加 `name_source` 列，属 schema 变更，不在本次范围。
- `xiaohongshu` / `kuaishou` / `zhihu` 缺 HTTP `extract` 注册，这三条脏名只能靠重新登录修复。
