# PRD：采集页草稿箱标签页 + 素材来源入口修正

> 变更日期：2026-10-12　分支：`collection-drafts-tab`
> 范围：① 采集页新增「草稿箱」标签页；② 底部快捷区新增「草稿箱」按钮；
> ③ 微博/知乎/今日头条三个快捷按钮的目标页修正；④ 采集页草稿写入统一到发布页真源。

---

## 一、背景与问题定义

### 1.1 草稿箱没有独立页面

草稿此前只以「草稿箱」小标题的形式挂在采集页 `collect` 标签底部，与「采集结果」「快捷操作」
混在一个长页面里。用户要翻过 URL 采集、批量采集、知乎收藏夹三大块才能看到自己的草稿，
且它与「文案库」（采集正文 + 改写文案）在概念上并列却不在同一层级，导航上不成立。

### 1.2 两套草稿其实共用同一行存储（本次发现的核心缺陷）

这不是「有两套草稿」的问题，而是**两套写入方言写进了同一个存储行**：

| 写入方 | 通道 | 最终落点 |
|---|---|---|
| 发布页 | `draftSave` / `draftList` → `store.getUserSetting('drafts', owner)` | `user:<ns>:drafts` |
| 采集页（旧） | `storeGetSetting('drafts')` → `store:get-setting` → `store.getUserSetting(key, owner)` | **同一个** `user:<ns>:drafts` |

依据：`apps/desktop/electron/services/store/settings-store.js` 的 `scopedSettingKey(key, owner)`
对两个入口算出同一个键。由此产生四个用户可见缺陷：

| 现象 | 根因 |
|---|---|
| 发布页存的草稿出现在采集页列表，但**时间显示空白** | 发布页写 ISO `createdAt`，采集页读 `created_at` |
| 采集页存的草稿在发布页列表显示 **0 个平台** | 采集页草稿不写 `platforms` 字段 |
| 同内容草稿**互相合并覆盖** | `computeDraftFingerprint` 只算标题+正文，两侧内容相同即命中幂等 |
| 排序错乱 | 采集页草稿无 `updatedAt` / `_fp`，只能靠惰性兜底 |

结论：**必须统一**，而不是「能否整合」的选择题。统一方案：写入一律走 `draftSave`，
读取一律走 `draftList`，读取侧兼容历史 `created_at` 字段。

### 1.3 三个快捷按钮的目标页不合理

按钮图标与分组（`✏️新建草稿 / 剪贴板导入 / ✧微博 / ❓知乎 / 📰今日头条`）表明它们是
**「素材从哪来」** 的入口，但旧目标取的是 `PLATFORM_DASHBOARD_URLS`（创作者后台）。

2026-10-12 实测（`web_fetch`，纯 HTTP、无 UA 伪装、无 Cookie、不执行 JS）：

| 平台 | 旧值 | 实测结果 | 定性 |
|---|---|---|---|
| 微博 | `https://weibo.com/` | 302 → `passport.weibo.com` → `login.sina.com.cn` | 消费端信息流首页，非选题源 |
| 知乎 | `https://www.zhihu.com/` | 403（反爬；首页同样 403） | 消费端首页推荐流，非选题源 |
| 今日头条 | `https://mp.toutiao.com/` | **200 → 重定向 `profile_v4`**，标题「头条号」 | **创作后台 = 发布目的地**，分类错误 |

头条那条不是「链接旧了」，而是**放错了类别**——它是发布端，不是采集端。

**取证边界（必须如实记录，不得在文档中夸大）**：
- `web_search` 在本次会话不可用（缺 `DEEPSEEK_API_KEY`），全部证据来自 `web_fetch`。
- 微博：`s.weibo.com/**` 与 `weibo.com/` **全部** 302 到登录，属服务端强制登录墙。
  换 URL 只改变「登录后看到的是热搜榜还是信息流」，**不会**让用户免登录浏览。
- 知乎：`www.zhihu.com/hot` 返回 403 是**反爬拦截**（裸首页同样 403），故 403 ≠ 失效；
  `/creator` 已确证强制登录（302 → `/signin?next=%2Fcreator`）。
  **真人浏览器下 `/hot` 是否免登录可浏览，本次工具未能证实**，上线前需人工开一次确认。
- 头条：`www.toutiao.com/hot/` 实测 **404**（不可用）；
  `hot-event/hot-board/` 必须带 `?origin=toutiao_pc`，缺参返回 `{"status":"fail","message":"parameter err"}`。

---

## 二、功能设计

### 2.1 采集页标签栏（新增一个标签）

顺序：**内容采集 → 快捷采集 → 草稿箱 → 文案库 → 博主监控**

| 项 | 值 |
|---|---|
| 标签文案（zh） | 草稿箱 |
| 标签文案（en） | Drafts |
| i18n key | `collection.draftsTab` |
| 测试锚点 | `collection-tab-drafts` |
| 角标 | `collection-tab-drafts-badge`，显示草稿条数；**为 0 时不渲染**（不留空壳，与博主监控角标同款契约） |
| 切换守卫 | `switchTab('drafts')`，`TAB_KEYS = ['collect','quick','drafts','records','creator']`，非法值直接 return |

### 2.2 底部快捷区（新增「草稿箱」按钮）

位置：紧跟「剪贴板导入」之后，微博/知乎/头条之前。

| 项 | 值 |
|---|---|
| 图标 | `FolderOpened`（Element Plus） |
| 文案（zh/en） | 草稿箱 / Drafts（`collection.draftsBoxShort`） |
| 测试锚点 | `quick-drafts-box` |
| 行为 | `switchTab('drafts')`，等价于点标签 |

### 2.3 草稿箱面板（`CollectionDraftsPanel.vue`）

**显示项（每张卡片）**

| 字段 | 来源 | 缺省/边界 |
|---|---|---|
| 标题 | `draft.title` | 空 → 「未命名草稿」（zh）/「Untitled draft」（en） |
| 时间 | `createdAt` → `created_at` → `updatedAt` → `updated_at` | 解析失败/缺失 → 「时间未知」/「Time unknown」 |
| 字数 | `content.length` | 0 字正常显示 |
| 平台数 | `platforms.length` | **为 0 时整段隐藏**（采集页草稿没有 platforms，显示「0 个平台」是噪音） |
| 来源标签 | `source` 枚举映射 | 未知值**如实回显原值**，禁止兜底成某个平台名 |
| 正文摘要 | `content` 去空白后截断 60 字 | 空则不渲染；`title` 属性挂全文便于悬停查看 |

**排序**：按时间倒序（新在上）。两种时间字段混排也能正确排序；无时间字段的排在末尾
（`Date.parse` 为 NaN 时按 0 处理，不得打乱其余顺序）。

**卡片操作**

| 按钮 | 行为 |
|---|---|
| 编辑 | `router.push('/publish?draft=<id>')` |
| 发布（primary） | `router.push('/publish?draft=<id>')` |
| 删除（danger） | `ElMessageBox.confirm` → `draftDelete(id)` → 刷新列表 + 成功提示 |

> 编辑与发布当前跳同一个路由：发布页 `watch(route.query.draft)` 会执行
> `loadDrafts()` + `loadDraft()` 填充表单，是否直接发由用户在发布页决定。

**状态机**

| 状态 | 判据 | 呈现 |
|---|---|---|
| 加载中 | `loading && 条数===0` | 「正在加载草稿…」/「Loading drafts…」 |
| 读取失败 | `loadError` 非空 | 错误条 + 「刷新」按钮（`drafts-load-error`） |
| 空 | 无失败且条数===0 | `EmptyState`：暂无草稿 / No drafts yet，主按钮「新建草稿」 |
| 有数据 | 条数>0 | 卡片网格 |

> **关键合同**：读取失败**不得**伪装成「暂无草稿」。把「读不到」显示成「你没有草稿」
> 会让用户以为数据丢了，是比报错更坏的谎言。

**刷新时机**：`onMounted` / `watch(active)` / `watch(reloadToken)` 三处触发，
且**仅当 `active === true` 时**才发 IPC（避免切走时仍在轮询）。
`reloadToken` 由父组件在「新建/采集入库」后自增，保证新草稿立刻可见。

### 2.4 数据写入（统一真源）

新增 `apps/desktop/src/composables/useCollectionDrafts.js`。

**写入载荷**（`saveDraft(payload, options)`）

| 字段 | 规则 |
|---|---|
| `title` / `content` | 去空格后 trim |
| `images`/`image_files`/`tags`/`topics`/`mentions` | **非数组一律回落 `[]`**，不得回落空串 |
| `cover_url` | 取 `cover_url`，缺省取 `coverImage`（采集侧字段名） |
| `platforms` / `accounts` / `platformOverrides` | 缺省 `[]` / `{}` / `{}` |
| `rewriteHistoryId` | 走 `normalizeRewriteLineage()`（`string\|null` 语义，不得折成空串） |
| `source` / `sourceUrl` | 采集溯源；发布页读端白名单不含这两个字段，写入不影响发布侧 |

**空内容校验**：`title` 与 `content` 全空时默认拒绝并告警
（「标题和正文都为空，无法保存草稿」）。
唯一例外是 `allowEmpty: true`，**仅供「新建空白草稿 → 跳发布页继续写」这一条路径**：
主进程指纹把全空内容算成同一个 `EMPTY_FINGERPRINT`，不开这个口子用户连点「新建草稿」
永远跳不出第二份空白草稿。其余路径（采集 / 剪贴板 / 改写产物）一律不得开。

**id 生成**：前端**不再自造 id**。旧代码用 `Date.now().toString(36)` 自造 id，会让主进程
`draftSave` 的指纹幂等失效（同内容必然不同 id）。现在 id 由主进程决定，命中指纹即复用原 id。

**失败语义**：`draftSave` 返回非 0 或抛异常 → 返回 `{ ok:false, draftId:null }` + 错误提示，
调用方**必须判 `ok`**（返回恒为对象，恒 truthy，判真值必错）。

### 2.5 素材来源入口修正

新增 `PLATFORM_SOURCE_URLS`（CJS 与 browser 孪生各一份），**不修改**
`PLATFORM_DASHBOARD_URLS`。

**为什么必须新开一张表**：`PLATFORM_DASHBOARD_URLS` 是「创作者后台/发布目的地」，
同时被三处复用：
1. `Accounts.vue` 卡片点击 → `openCreatorCenter`（开创作者中心）
2. `electron/publishers/http-login-checker.js`（用 `PLATFORM_DASHBOARD_URLS.zhihu` 作登录态 DOM 校验目标页）
3. `electron/publishers/account-manager.js`（goto 目标）

改这张表会连带改变登录态判定与创作者中心入口。「找素材」与「发内容」语义相反，
共用一张表必然有一边错。

**取值**

| 平台 | 新值 | 说明 |
|---|---|---|
| weibo | `https://s.weibo.com/top/summary` | 微博热搜榜 |
| zhihu | `https://www.zhihu.com/hot` | 知乎热榜 |
| toutiao | `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | 头条热榜（`origin` 参数必带） |

**按钮文案同步改为**：微博热搜 / 知乎热榜 / 头条热榜（en: Weibo Hot Search / Zhihu Hot / Toutiao Hot）。
理由：按钮目标变了，文案必须跟着变，否则用户点「微博」却被带到热搜榜会困惑。

**打开行为**（`createOpenSourceHandler`）
- 无 URL 的平台 → `notifyWarning('collection.platformUnsupported')`，**不发 IPC**
- `createTab` 返回 falsy（建页失败）→ **不报成功**（假成功比不提示更糟）
- 成功 → `notifySuccess('collection.openedPlatform')`，标签标题取 `platformSourceTabTitle`

---

## 三、交互与提示文字（zh / en 成对）

| 场景 | key | zh | en |
|---|---|---|---|
| 标签名 | `collection.draftsTab` | 草稿箱 | Drafts |
| 面板标题 | `collection.draftsTitle` | 草稿箱 | Drafts |
| 快捷按钮 | `collection.draftsBoxShort` | 草稿箱 | Drafts |
| 条数 | `collection.draftsCount` | {count} 篇 | {count} drafts |
| 刷新 | `collection.draftsRefresh` | 刷新 | Refresh |
| 加载中 | `collection.draftsLoading` | 正在加载草稿… | Loading drafts… |
| 时间未知 | `collection.draftsTimeUnknown` | 时间未知 | Time unknown |
| 未命名 | `collection.draftsUntitled` | 未命名草稿 | Untitled draft |
| 平台数 | `collection.draftsPlatformCount` | {count} 个平台 | {count} platforms |
| 读取失败 | `collection.draftsLoadFailed` | 草稿读取失败 | Failed to load drafts |
| 保存失败 | `collection.draftsSaveFailed` | 草稿保存失败 | Failed to save draft |
| 删除失败 | `collection.draftsDeleteFailed` | 草稿删除失败 | Failed to delete draft |
| 空内容拒绝 | `collection.draftsEmptyContent` | 标题和正文都为空，无法保存草稿 | Both title and content are empty; cannot save the draft |
| 剪贴板默认标题 | `collection.draftsClipboardTitle` | 从剪贴板导入 | Imported from clipboard |
| 来源：手动 | `collection.draftsSource_manual` | 手动新建 | Manual |
| 来源：剪贴板 | `collection.draftsSource_clipboard` | 剪贴板 | Clipboard |
| 来源：链接 | `collection.draftsSource_url` | 链接采集 | URL |
| 来源：RSS | `collection.draftsSource_rss` | RSS | RSS |
| 标签标题 | `collection.platformSourceTabTitle` | {platform} 素材来源 | {platform} source |
| 按钮：微博 | `collection.sourceWeibo` | 微博热搜 | Weibo Hot Search |
| 按钮：知乎 | `collection.sourceZhihu` | 知乎热榜 | Zhihu Hot |
| 按钮：头条 | `collection.sourceToutiao` | 头条热榜 | Toutiao Hot |
| 删除确认 | `collection.confirmDeleteDraft` | 确定删除这篇草稿吗？ | （既有） |
| 不支持 | `collection.platformUnsupported` | 该平台暂不支持网页查看 | （既有） |

**来源标签兜底规则**：`source` 是内部枚举，未在 `draftsSource_*` 登记的值在卡片上
**如实回显原值**，禁止兜底成具体平台名（沿用「来源标签禁止兜底品牌名」判据——
打错的标签与真实来源在界面上必须可区分）。

---

## 四、数据校验清单

| # | 校验点 | 期望 | 失败处理 |
|---|---|---|---|
| V1 | `saveDraft` 标题正文全空（非 allowEmpty） | 拒绝 | 告警，不发 IPC |
| V2 | `saveDraft` 标题正文全空（allowEmpty） | 放行 | 正常保存 |
| V3 | 数组字段缺失/非数组 | 回落 `[]` | 静默归一 |
| V4 | `draftSave` 返回 `code !== 0` | `ok:false` | 错误提示 |
| V5 | `draftSave` reject | 捕获 | 错误提示，不向上抛 |
| V6 | `draftList` 返回 `code !== 0` | `[]` + `loadError` | 显示错误条（**不显示空态**） |
| V7 | `draftList` data 非数组 | `[]` | 静默归一 |
| V8 | 草稿缺 `createdAt` / `created_at` | 时间未知 | 显示占位文案，不崩 |
| V9 | `Date.parse` 为 NaN | 按 0 排序 | 该条排末尾 |
| V10 | `platforms` 为 0 | 隐藏平台数标签 | 不显示「0 个平台」 |
| V11 | 删除未确认 | 不调 `draftDelete` | 无副作用 |
| V12 | 删除传空 id | 直接 false | 不发 IPC |
| V13 | `openCollection` 未知平台 | 告警 | 不调 `createTab` |
| V14 | `createTab` 返回 falsy | 不报成功 | 静默 |
| V15 | 面板 `active===false` | 不发 IPC | 无请求 |

---

## 五、验收标准

| # | 验收项 | 判据 |
|---|---|---|
| A1 | 采集页标签栏 5 个标签，草稿箱在快捷采集与文案库之间 | `.collection-tab-btn` 数量 === 5，`collection-tab-drafts` 存在 |
| A2 | 底部快捷区有「草稿箱」按钮且在剪贴板导入之后 | `quick-drafts-box` 存在 |
| A3 | 草稿箱列表与发布页草稿**同源** | 列表来自 `draftList`，非 `storeGetSetting` |
| A4 | 发布页存的草稿能在草稿箱看到且**时间不空白** | `resolveCreatedAt` 兼容 `createdAt` |
| A5 | 草稿箱删除后发布页列表同步消失 | 同存储行 |
| A6 | 读取失败显示错误条而非空态 | `drafts-load-error` 存在且空态不存在 |
| A7 | 空列表显示 EmptyState | `collection-drafts-empty` 存在 |
| A8 | 角标条数正确，0 时不渲染 | badge 断言 |
| A9 | 微博按钮打开热搜榜 URL | `PLATFORM_SOURCE_URLS.weibo` |
| A10 | 头条按钮**不再**指向头条号后台 | `SOURCE.toutiao !== DASHBOARD.toutiao` |
| A11 | 未知平台告警且不发 IPC | `notifyWarning` + `createTab` 未调用 |
| A12 | 新建空白草稿能跳发布页 | `allowEmpty` 路径 |
| A13 | 采集/剪贴板/改写产物写入走 `draftSave` | `draftSave` 被调用 |
| A14 | `Collection.vue` 行数 ≤ 2920（零容差点名目标） | `check-max-lines` 通过 |
| A15 | zh/en 词条成对 | `check-locale-sync --keys` 通过 |

---

## 六、遗留与风险（不假装已闭合）

| # | 风险 | 说明 |
|---|---|---|
| R1 | 知乎 `/hot` 免登录性未证实 | 抓取器 403 是反爬；真人浏览器是否免登录需上线前人工开一次确认 |
| R2 | 微博登录墙不可绕过 | `s.weibo.com/**` 全系 302 到登录。换 URL 只改语义，不改登录要求。已写进代码注释，不得后续误判为「链接配错」 |
| R3 | 头条热榜为数据接口形态 | `hot-event/hot-board/?origin=toutiao_pc` 返回 JSON 榜单，在浏览器里呈现的是 JSON 而非渲染页。若用户期望的是可视化热榜页，需后续另找页面（`/hot/` 已实测 404） |
| R4 | 编辑与发布跳同一路由 | 当前语义重叠，是否拆分为「编辑」直达表单、「发布」直达选平台步骤，待定 |
| R5 | `Collection.vue` 零容差 | 2920 行天花板，任何后续新增都必须走 `features/collection/*` 独立组件，不得内联 |
