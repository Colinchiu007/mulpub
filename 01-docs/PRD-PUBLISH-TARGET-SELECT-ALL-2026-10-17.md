# PRD：发布页「发布目标」区增加「全选」与「分组选择」（publish-target-select-all，2026-10-17）

> **需求来源**：用户反馈（图片/视频发布页右侧「发布目标」区）——「增加『全选』选项，和分组选择的选项。从 UE 用户交互上考虑，怎么设计和优化更合适。」
> **应用范围**：图文发布页与视频发布页右侧「发布目标」操作区（两者共用同一组件 `PublishTargetSelector.vue`，故一处实现两处生效）。
> **上游**：`01-docs/PRD-PUBLISH-GROUP-PICKER-2026-10-03.md`（P2-8b 按组添加，已合并 #2817）、`01-docs/PRD-PUBLISH-ADD-ACCOUNT-ENTRY-2026-10-15.md`（空态出口）。
> **立项**：`01-docs/PRD-PUBLISH-PAGE-OPTIMIZATION-2026-10-08.md` 差距表 P2-8 的第三刀（第一刀分组持久化 P2-8a、第二刀按组添加 P2-8b）。

## 一、问题定义（为什么不是"加两个按钮"这么简单）

### 1.1 现状实测（改前取证）

发布页「发布目标」区（`apps/desktop/src/features/publish/components/PublishTargetSelector.vue`，193 行）自上而下的显构成：

| 序 | 元素 | 说明 |
|---|---|---|
| 1 | 搜索框 | 只筛**可见集**（平台/账号），不碰选中集 |
| 2 | 分组 chip 行（`PublishGroupPicker.vue`） | **只增不减**的 additive 语义，chip 显示 `可添加数/成员数` |
| 3 | 平台分组列表 | 国内平台 / 国际平台 两组，每组下平台行 + 账号子列表 |

选中集的唯一写入口是 `usePlatformSelection` 的 `togglePlatform` / `toggleAccount` / `selectPlatform` / `selectAccount`。

**三类真实痛点**：

1. **15+ 平台逐个勾选是 O(N) 次点击**。用户"全平台都发"的意图（多平台分发是该产品的核心场景）需要 15 次点击；而"只发某几个"反而是少数场景。参考产品的发布目标区有批量选择能力，本仓没有。
2. **"全选"若按字面实现会立刻撞上三个硬约束**：① 平台目录里**大量平台当前没有任何账号**（CI 空 profile 下 `byPlatform` 全空，真实用户也常有只登录了 3-5 个平台的情况），全选这些平台后 `validatePublishTargets` 会以「请为<平台>选择至少一个账号」阻断提交——**用户点了全选反而发不出去**；② 停用账号不可勾选（`isAccountActive` 收口），全选不得把停用账号带进选中集；③ 风控挂起的账号/平台虽然仍可勾选，但全选把它们一起带上会让用户在一次点击里引入多个已知会被派发前置守卫拦下的目标。
3. **分组选择已有 chip，但缺"这一组到底选了哪些"的回视**。chip 只能"加"，加完之后用户要滚列表核对；且 `可添加数/成员数` 的 `可添加` 判据（`isAccountAvailable`）与 `applyAccountGroup` 的跳过判据虽然同源，但用户点击前看不到"点下去会跳过几个、为什么"。

### 1.2 本刀的定义（一句话）

在「发布目标」区提供**两个批量操作**（全选 / 按分组选择）与**一处状态回视**（分组 chip 显示已选成员数），使"多发"与"按组织发"两种意图各一次点击可达，同时**绝不把不可发布的目标静默塞进选中集**。

## 二、UE 设计：为什么这样定（交互逻辑推导）

### 2.1 核心 UE 判断一：全选必须定义成"全选**可发布的**"，并且必须说出来

"全选"在用户脑子里是"所有平台"。但产品语义里"平台"要能发布必须满足：**该平台当前至少有一个可勾选账号**。二者不等价，因此：

- **判据（单一真源）**：全选的目标集合 = 平台目录中 `getAvailableAccountIds(platform).length > 0` 的平台。这与 `usePlatformSelection.getAccounts()`（已按 `isAccountActive` 过滤）是同一个函数，**禁止另写一份"有账号"判据**。
- **不可静默**：若目录里存在"没有可发布账号的平台"，全选后必须用一条提示如实说明「N 个平台没有可用账号，未纳入发布目标」，并列出平台名（≤3 个 + "等 N 个"）。理由：用户看到的是 15 个平台、只勾了 8 个，若不出声，下一次点击"一键发布"时的阻断文案就是第一次通知——那正是本仓反复在消灭的"静默失败"形态。
- **空态不出声**：若所有平台都没有可用账号（典型：CI 空 profile、刚装好还没登录），**不弹提示**，按钮 disabled + tooltip 说明原因。理由：此时"无可选目标"由平台列表本身的空态（「请先添加账号」+ 添加按钮）已经说清，再弹一条 toast 是重复噪音。

### 2.2 核心 UE 判断二：全选是"增量"不是"替换"，且必须可一次撤销

- **增量（additive）而非替换**：与既有的「按组添加」chip、与逐个勾选三者语义一致。用户先手工勾了 2 个平台，再点全选 → 结果是 2 个 + 其余全部。若是替换，用户手工选的那 2 个会被悄悄抹掉——这与 P2-8b PRD §一.2 拒绝"按组替换"是同一条理由：**替换是破坏性动作，不能被当成便利性顺手加进来**。
- **账号联动**：勾上一个平台时，`reconcileSelectedAccounts` 会给"已选平台但选中集为空"回填**默认账号**（`usePlatformSelection.js:143-147`）。全选走同一条路径（先平台、后由 reconcile 回填默认账号），因此全选后每个平台都有账号，`validatePublishTargets` 不会因"选了平台没选账号"被拦。
- **可撤销**：全选后提供「清空」按钮（不是"反选"）。理由：反选（invert）在本场景语义混乱——反选后选中的恰是"没有账号的平台"集合，用户得到的是一个必然被提交校验拒绝的状态。清空是唯一无歧义的逆向操作，且与 `selectedPlatforms = []` 的自然语义一致。

### 2.3 核心 UE 判断三：分组选择从"chip 只增"升级为"chip + 已选回视 + 可整组取消"

保留 chip 的 additive 语义（不引入替换），但补三件 UE 必需品：

| 补什么 | 为什么 |
|---|---|
| chip 上显示 `已选/成员` | 加完之后用户不必滚列表核对"这组到底进了几个"。判据与 `applyAccountGroup` 同源（`isAccountSelected`），避免"显示 3 个、点下去只加 1 个"的口径分裂 |
| chip  Tooltip 展开"点下去会发生什么" | 预告新启用的平台与将被跳过的成员数，把 P2-8b 的播报文案**前移**到点击前。点击前预告比点击后 toast 更符合"减少意外"的 UE 原则 |
| 已全选的 chip 视觉态（非禁用） | 表示"这组已全部在选中集里"，再点是幂等 no-op；**不禁用**（与 P2-8b 一致：禁用会把"已经加过了"伪装成"按钮坏了"） |

**明确不做「整组取消」**：取消是"把这一组当前已勾中的成员取消"，但用户更常想要的是"只发这一组"（替换语义）。P2-8b PRD §一.2 已论证替换属破坏性、需单独设计（含撤销），本刀沿用该结论，只做增量与全局清空。用户要减成员，用平台行/账号行的逐个勾选（既有能力）。

### 2.4 核心 UE 判断四：布局——批量操作放哪一行

「发布目标」区是右栏第一块（`openspec/specs/publish-page-right-rail/spec.md`：主行动首屏可见）。新增控件必须：

1. **不把平台列表挤出首屏**：右栏高度预算有限，批量操作只能占用**一行**（全选 / 清空 + 分组 chip 行），不得新增第二行以上的常驻块。
2. **不给死控件**：全选按钮在"没有可发布平台"时 disabled + tooltip；分组 chip 在"没有可操作分组"时整块不渲染（P2-8b 既有约定，CI 空 profile 下必须保持视觉中性）。
3. **不改变既有 DOM 形状到会撞像素门禁的程度**：见 §六 视觉中性策略。

## 三、数据校验（逐条判据与归类）

输入：平台目录（`groupedPlatforms`，含每平台 `accounts`，其中 `disabled` 已由 `usePublishPlatformCatalog` 标注）+ 当前选中集。输出必须是**分好类的计数**，不得只有一个布尔。

| # | 情况 | 判据 | 归类 | 用户看到 |
|---|---|---|---|---|
| 1 | 平台目录为空 / 全无可用账号 | 可发布平台集合 size == 0 | `no-targets` | 全选按钮 disabled + tooltip「暂无可发布的平台」；**不弹 toast** |
| 2 | 平台已有可用账号 | `getAvailableAccountIds(pid).length > 0` | `selectable` | 点全选后该平台进入选中集 |
| 3 | 平台无可用账号（未登录 / 全部停用） | 可用集合为空 | `skipped` | 不纳入选中集；若 `skipped > 0` 弹一条 info 提示，点名前 3 个 + 「等 N 个」 |
| 4 | 平台已被选中 | `selectedPlatforms.includes(pid)` | `already` | 不重复写；计入"本次新增"之外，不单独播报（避免"全选"变成一条长清单） |
| 5 | 停用账号 | `isAccountActive(account) === false` | 不可勾选 | 不进选中集（与账号行 checkbox disabled 同源） |
| 6 | 风控挂起的账号/平台 | `riskSuspended` 命中 | 仍可选，但**不计入"本次新增"的静默路径** | 全选带上它们（它们仍可勾选，见 §四 第 4 条），徽标已可见 |
| 7 | 发布进行中 | `props.disabled`（`publishing`） | 禁用 | 全选/清空/分组 chip 全部 disabled，不吞点击也不改选中集 |
| 8 | 分组为空 / 成员全不可用 | P2-8b 既有分类（`empty-group` / `nothingToAdd`） | 既有 | 沿用既有播报，本刀不改 |

**不新做上限**：平台数量、账号数量、分组数量上限一律沿用既有真源侧收口（`MAX_ACCOUNT_GROUPS` / `MAX_GROUP_ACCOUNTS` / 平台目录），本刀再设一份就是第二份口径。

## 四、功能逻辑（实现约束，逐条可验）

### 4.1 纯函数 + 依赖注入（与 P2-8b 同一范式）

批量判据本体落在 `apps/desktop/src/features/publish/usePublishTargetBulk.js`（新文件，纯函数、不 import store、不碰 Vue 响应式）：

```
selectAllPublishTargets({ platforms, getAvailableAccountIds, isPlatformSelected, selectPlatform })
  → { ok, selected: string[], added: string[], already: string[], skipped: [{platformId, reason}] }
```

- `platforms`：`groupedPlatforms` 拍平后的平台数组（`[{id, label, accounts}]`）。
- 顺序约束与 P2-8b **同源**：先 `selectPlatform(pid)`，账号由宿主 `reconcileSelectedAccounts` 在同一同步段之后回填默认账号。**不得**在本函数内写 `selectedAccounts`——那会绕过 `normalizeAccountIds` 与 reconcile，形成第二份写路径。
- **不得出现 `await` / `nextTick`**（源码锁，与 `usePublishGroupApply.test.js` L3 同型）：全选是一次同步段完成的批量写入，拆帧会让默认账号回填插在中间，产生"多出一个号"的不可解释状态。
- 分类互斥且穷尽：`added + already + skipped === 平台目录规模`。

### 4.2 全选的"可发布"判据必须问宿主，不得自己数 accounts

`getAvailableAccountIds` 由调用方（`usePublishGroupTargets` 同层的接线 composable）注入，内部即 `usePlatformSelection.getAvailableAccountIds`（它经 `getAccounts` 走 `isAccountActive`）。**禁止**在纯函数里直接读 `platform.accounts.length`——那个数组包含停用账号（`usePublishPlatformCatalog` 刻意保留停用账号以供显示禁用态），直接数会把停用账号当成可发布。

### 4.3 分组 chip 的"已选/成员"判据与 applyAccountGroup 同源

chip 的已选数 = 该组成员中 `isAccountSelected(platform, id)` 为真的个数（成员先过 `countGroupApplicable` 的可判定过滤）。判据函数与 `applyAccountGroup` 读同一组注入依赖，避免"chip 显示 3/5、点下去加 2 个"的分裂。

### 4.4 风控挂起目标：全选带上，但提示里点名

P0-2 的口径是"发布前可见"（徽标 + tooltip）。全选把挂起目标带上**不违反**该口径（它们仍可勾选、徽标仍可见、派发前置守卫仍会拦），但若本次新增中含挂起目标，提示文案须追加一句「其中 N 个已风控挂起，发布时会先被拦截」。理由：一次点击引入多个已知失败目标，属于"把意外藏起来"。

### 4.5 接线层与行数预算

`views/Publish.vue` 被 `max-lines-baseline.json` 的 `targets` 点名（**容差 0**，现 1672 行 ≤ 1773，还有 101 行余量但不得挥霍）。因此：

- 全选/清空的判据 → 纯函数 `usePublishTargetBulk.js`（可单测）；
- store ↔ 视图的桥 + 播报文案拼接 → `composables/usePublishTargetBulkTargets.js`（与 `usePublishGroupTargets.js` 同范式）；
- `Publish.vue` 只增 **1 行解构 + 2 行模板绑定**（`@select-all` / `@clear-all`），把净增长压到 ≤5 行。

## 五、流程

```
发布页挂载
  └─ accountStore.ensureLoaded()（既有）：账号与分组到位后才谈批量选择
       └─ 可发布平台集合 size > 0 ? 全选按钮可用 : disabled + tooltip
       └─ 可操作分组 size > 0 ? 渲染分组 chip（含 已选/成员） : 整块不渲染

点「全选」
  └─ selectAllPublishTargets({platforms, getAvailableAccountIds, isPlatformSelected, selectPlatform})
       ├─ 逐平台分类（§三）
       ├─ 需要新平台时：selectPlatform(pid)（同一同步段）
       └─ 返回 {selected, added, already, skipped}
  └─ 播报（§八）：added>0 → info；skipped>0 → 同一条里点名；added==0 && already>0 → info「已全部选中」；no-targets → 不可达（按钮 disabled）

点「清空」
  └─ selectedPlatforms = []（宿主既有能力，经接线 composable 暴露）
  └─ 播报 info「已清空发布目标」（可撤销语义：再点全选即恢复）

点分组 chip（既有 applyAccountGroup，本刀只增强回视与预告）
  └─ 结果播报沿用 P2-8b §八；本刀不新增播报分支
```

## 六、视觉中性策略（像素门禁）—— 含一次实测推翻的前提更正

**初稿的前提错了，实测推翻后已改设计。** 初稿写「CI 的 `publish-form` 跑空 profile ⇒ 无可发布平台 ⇒ 整行不渲染即可视觉中性」。实测不成立：`tests/e2e/fixtures/accounts.json` **有 8 个账号**（覆盖 8 个平台），所以 CI 里 `canSelectAll` 恒为 **真**，全选/清空**必然渲染**。"空态不渲染"只能挡住"刚装好未登录"那一种真机情形，挡不住 CI。

**实测后果（判据取产物，非推断）**：把全选/清空做成**搜索框下的新一行**后，`QG Visual` 的 workflows 套件判红 ——
`[GATE-7] suite exits: pixel=0 views=0 views-supplement=0 dark=0 workflows=1 workflows-supplement=0`，
两轮甄别重跑仍是 `workflows 重跑 rc=1`，**可复现、非 flake**。具体是
`工作流结果: 25/31 通过，6 失败`，6 条全是 `/publish` 用例
（`publish-title-edit-reset` / `publish-author-edit-reset` / `publish-platform-search-reset` /
`publish-cover-url-reset` / `publish-template-panel-toggle` / `publish-ai-panel-toggle`），
每条都是 `视觉差异 1.7783082561728396% 超过阈值 1%`（**workflows 套件的阈值是 1%，不是像素套的 6%**；
同一张图在像素套里 1.778% < 6% 是 PASSED —— 两个套件阈值不同口径，别拿一个的绿当另一个的绿）。
diff 图显示红线覆盖**整个右栏下半部**：新增一行把下方所有内容整体下移。

**改法（构造性中性）**：全选/清空**塞进搜索行内部**（`.target-selector__search-row`：搜索框 `flex:1` + 按钮块 `flex:0 0 auto`），
不再新开一行 ⇒ 搜索行下方的一切原地不动。配套两条约束：
① 按钮做成小号 chip（`font-size-xs` + `padding: 1px 8px`），**不得撑高搜索行**——撑高就等于把换来的收益还回去；
② section 直接子节点数**恒为 2**（`[搜索行, 列表]`），空态下搜索行内只剩 `<input>` 本人。

预期残留差异只落在搜索行那一带（约 `470 × 34` px 量级 < 1%），**是否真的低于 1% 以 CI 的 `QG Visual` 为准**，
不在本地声称（本机无 Chromium，跑不了视觉套件；本仓纪律：环境缺失不得判成"无回归"）。

- 判据形态：`PublishTargetSelector` 的直接子节点恒为 `[div(target-selector__search-row), div(target-selector__list)]`，且空态下搜索行内 `children` 恰为 `['input']`。
- **不得**把这条锁写成"改前 html == 改后 html"（两次挂载跑同一份新代码 ⇒ 恒真，P2-8b §六已论证并纠正）。
- 若最终 CI 仍判红，正解是**由 CI 同源产出基线**（`base-screenshots/publish-form{,-dark}.png` 是可跟踪文件，历史 PR #2623/#2709/#2804 都走过这条路），
  **不得**用本机 `--update-baseline` 掩盖。

## 七、显示项

| 位置 | 内容 | 数据 | 空/异常态 |
|---|---|---|---|
| **搜索行内**（搜索框右侧） | 「全选」+「清空」两个小号 chip 按钮，与搜索框**同一行**（不新开行，见 §六） | 可发布平台集合 | 集合为空 ⇒ **整块不渲染**（视觉中性 + 不给死控件） |
| 全选按钮 tooltip | 「选中所有有可用账号的平台（N 个）」 | 可发布平台数 | 集合为空时不渲染，无 tooltip |
| 清空按钮 | 「清空」 | `selectedPlatforms.length` | 未选任何平台时 disabled（点了无效果，禁用以示"无可清空"） |
| 分组 chip（既有，增强） | 组名 + `已选/成员` + 预告 tooltip | `isAccountSelected` 逐成员计数 | 无可操作分组 ⇒ 整块不渲染（P2-8b 既有） |
| 已全选的 chip | 视觉态（非禁用） | 已选数 === 可添加数 | — |

**「已选/成员」与「可添加/成员」的取舍**：chip 上保留 `可添加/成员`（P2-8b 既有，点击前预告"能加几个"），在 tooltip 里给 `已选/成员`。理由是 chip 空间极小（`max-width: 220px`），塞两组数字会挤压组名；而 tooltip 是"想细看时才看"的位置。

## 八、提示文字（locale 键，zh/en 成对；新增文案一律进 locales）

| key | zh | en | 触发 |
|---|---|---|---|
| `publishPage.targetBulk.groupAria` | 批量选择发布目标 | Bulk publish target selection | 工具条容器 aria-label |
| `publishPage.targetBulk.selectAll` | 全选 | Select all | 按钮文案 |
| `publishPage.targetBulk.clearAll` | 清空 | Clear | 按钮文案 |
| `publishPage.targetBulk.selectAllAria` | 选中所有可发布的平台（{count} 个） | Select all publishable platforms ({count}) | aria-label |
| `publishPage.targetBulk.selectAllDisabledTitle` | 暂无可发布的平台，请先添加账号 | No publishable platform yet, add an account first | 集合为空时（整行不渲染，本键仅供测试与未来复用） |
| `publishPage.targetBulk.clearDisabledTitle` | 当前没有选中的发布目标 | No publish target is selected | 未选任何平台（按钮 disabled 时不可达，键仍成对维护） |
| `publishPage.targetBulk.listRest` | 等 {rest} 个 | and {rest} more | 清单截断后缀 |
| `publishPage.targetBulk.added` | 已选中 {added} 个平台{skippedText} | Selected {added} platform(s){skippedText} | added>0 |
| `publishPage.targetBulk.skipped` | ，{count} 个平台没有可用账号，未纳入：{platforms} | , {count} platform(s) have no available account and were skipped: {platforms} | skipped>0（接上一条） |
| `publishPage.targetBulk.riskIncluded` | ；其中 {count} 个已风控挂起，发布时会先被拦截 | ; {count} of them are suspended for risk control and will be blocked at publish time | 新增中含挂起目标 |
| `publishPage.targetBulk.alreadyAll` | 已全部选中（{count} 个平台） | All {count} platform(s) already selected | added=0 且 already>0 |
| `publishPage.targetBulk.cleared` | 已清空发布目标 | Publish targets cleared | 点清空 |
| `publishPage.groupPicker.selectedCount` | 已选 {selected}/{total} | {selected}/{total} selected | chip tooltip |

- 播报一律走 `useNotify`（info 级），**成功与失败不得共用一条文案**：`added=0` 时不得出现"已选中 N 个平台"。
- 平台名清单截断规则：前 3 个用「、」连接，超出记「等 N 个」（`MAX_LISTED = 3`）。
- 所有文案必须成对维护于 `src/locales/publish-page/{zh,en}.js`（CI Gate 7 `check-locale-sync.js`），渲染层 `src/` 非 locales 文件不得新增中文字符串字面量。

**清单截断的文案边界（实现后修正：Gate 7 实测红过一次）**：截断上限 `MAX_LISTED_PLATFORMS = 3` 是纯函数常量没问题，但「等 N 个」这个**后缀本身是中文** —— 把它写在 `usePublishTargetBulk.js` 里，就是"渲染层非 locales 文件的硬编码中文"，`check-locale-sync --cjk` 当场判红（实测 4 处命中）。因此定：纯函数 `formatPlatformList(labels, { maxListed, restLabel })` 只负责"取前 N 个 + 调回调拼后缀"，`restLabel` 由接线层从 locale 注入。纯函数因此**仍可在无 Vue 环境单测**（判据本体的硬要求），中文也不越界。若不注入 `restLabel`，纯函数返回完整清单而不自行拼中文（纯函数的边界，不是"降级后照旧"）。

## 九、测试矩阵与反证

| 层 | 文件 | 锁 | 反证（须变红） |
|---|---|---|---|
| L1 | `usePublishTargetBulk.test.js`（新） | 分类互斥穷尽：`added + already + skipped === 平台目录规模` | 把 inactive 平台并进 added ⇒ 红 |
| L2 | 同上 | **可发布判据必须问注入的 `getAvailableAccountIds`**：夹具里 `platform.accounts` 含停用账号但 `getAvailableAccountIds` 返回空 ⇒ 该平台必须落 `skipped` | 改成读 `accounts.length` ⇒ 红 |
| L3 | 同上 | 空目录 ⇒ `no-targets`，且**不调用任何写入器** | 空目录仍 selectPlatform ⇒ 红 |
| L4 | 同上 | 平台已被选中 ⇒ 不重复 `selectPlatform`，计入 `already` | 重复调用 ⇒ 红 |
| L5 | 同上 | **同段锁**：源码剥离注释后不得出现 `await` / `nextTick`（与 P2-8b L3 同型，含"读不到源文件必须失败"的路径扫描） | 插入 await ⇒ 红 |
| L6 | `usePublishTargetBulkTargets.test.js`（新） | 播报文案的每个数字来自同一次分类结果；`added=0` 时不得出现 `added` 键的文案 | 恒播"已选中" ⇒ 红 |
| L7 | `usePublishTargetBulkTargets.test.js` | 平台名清单截断：>3 个时只列 3 个 + 后缀由 `restLabel` 注入；不注入时不得自行拼中文 | 后缀写回纯函数 ⇒ 红（Gate 7 亦红） |
| L8 | `publish-target-bulk.component.test.js`（新） | 空 profile 下 section 直接子节点仍恰为 `[input, div]`（全选行与分组行都不在） | 空态渲染全选行 ⇒ 红 |
| L9 | `publish-target-bulk.component.test.js` | 有可发布平台时渲染全选/清空；点击只 emit `select-all` / `clear-all`（组件不持有选中集） | 组件自己写选中集 ⇒ 红 |
| L10 | `publish-target-bulk.component.test.js` | 清空按钮在 `selectedPlatforms` 为空时 disabled；`disabled`（发布中）时全选/清空全禁 | 未选也可点 ⇒ 红 |
| L11 | `publish-target-bulk.component.test.js` | v-bind 合同（驼峰 `on*` ↔ kebab 事件名，与 Publish.vue 的 `v-bind` 用法对齐） | 键名漂移 ⇒ 红 |
| L12 | `usePublishGroupApply.test.js`（既有） | 零回归：`applyAccountGroup` 顺序/幂等/分类不变 | — |
| L13 | `usePlatformSelection.test.js`（既有） | 零回归：reconcile 删键与默认账号回填行为不变；新增的 `clearPlatforms` 只动 `selectedPlatforms` | 若既有行为被改，L5 的理由须同步改写 |
| L14 | `publish-target-select-all.test.js`（新，视图层） | 点全选真的把有账号平台写进选中集并播报；点清空真的清掉；发布中禁用；无可发布平台时整行不渲染 | 按钮在但写了空 ⇒ 红 |

## 九之二、实现期实测到的三条坑（写进文档，因为它仨都不是"改个参数"能绕过的）

**① `publishableCount` 不能写成 computed。** `getAvailableAccountIds` 是 `usePlatformSelection` 的普通函数，它读的 `accountStore.byPlatform` 在**测试替身**里不是响应式源（`Publish.test.js` 的 `useAccountStore` mock 早前是普通对象 + getter）。写成 computed 时它在账号目录就绪前求值一次即被缓存，之后不重算 —— 表现是"平台列表里账号明明在，全选按钮永远不出现"。改为 `watch` 订阅三个确实是响应式的源（`flatPlatforms` / `selectedPlatforms` / `selectedAccounts`，`deep`）后重算：`reconcileSelectedAccounts` 正是在这些源变化时补齐/剔除账号键，它跑完那一刻就是重算的正确时机。

**② 测试替身的 `byPlatform` 必须是 ref，否则整类缺陷只在测试里成立。** 真实 Pinia store 的 `byPlatform` 是对 `accounts` 派生的 computed，"账号到了 ⇒ 界面跟着变"是响应式保证的；用普通对象 + getter 的替身把这条保证抹掉了（Mock 边界漏洞：替身比真身弱，弱出来的缺陷没人见过）。已把 `Publish.test.js` 的容器改成 `ref`，getter 读 `.value` —— 调用方拿到的仍是普通对象（与 Pinia 自动解包同形），但这次读发生在响应式 Effect 里。

**③ CI 的 `publish-form` 不是"空 profile"，且两个视觉套件阈值不同口径。** 初稿按「空 profile ⇒ 无可发布平台 ⇒ 不渲染即视觉中性」设计，被 CI 实测推翻：`tests/e2e/fixtures/accounts.json` 有 8 个账号，CI 里全选按钮**必然渲染**；而 workflows 套件的阈值是 **1%**（不是像素套的 6%），新增一行让 6 条 `/publish` 用例在 **1.778%** 判红，两轮甄别可复现（同一张图在像素套 1.778% < 6% 是 PASSED）。改法：按钮塞进搜索行同一行，让下方原地不动（详见 §六）。两条可迁移判据：**① "空态不渲染"只挡得住真机的空，挡不住 CI 的夹具数据 —— 设计前先读夹具；② 同一视图在不同套件可能阈值不同，别拿一个套件的绿当另一个的绿。**

## 十、验收

- 单测：新增文件全绿 + `PublishTargetSelector.test.js` / `PublishGroupPicker.test.js` / `usePublishGroupApply.test.js` / `usePlatformSelection.test.js` / `Publish.test.js` 既有断言零回归。
- `check-locale-sync`：zh/en 成对（pair PASS）+ CJK 基线扫描不因本刀上升（PASS）。
- `check-max-lines`：`Publish.vue` 仍在 targets（1773）之下（现 1770）；新文件 < 500 行。
- eslint exit 0（仅 2 处既有 warning，均不在本刀 diff 内）。
- QM-1：本刀不改 `apps/desktop/electron/` 与 `packages/rpa-engine/`，不触发强制打包；但因改了渲染层，以 CI 的 `QG Visual` 为准。构造性论证是「**搜索行内改动、下方原地不动**」（§六），证据为组件层形状锁（顶层恒 2 节点 + 空态搜索行内仅 `<input>`）与视图层"无可发布平台整块不渲染"用例。本机无 Chromium ⇒ **不在本地声称像素结论**。
- 真机行为验证需要已登录 profile 与至少一个有账号平台；本机不做端到端（牵动共享 userData），行为面以单测为准并如实标注。

## 十一、残余（明确不在本刀）

1. **按组替换/整组取消**：破坏性语义，需单独设计（含撤销），P2-8b 已论证。
2. **批量模式（`BatchArticleCard` 逐条目目标）**：条目级目标与"整篇按组"层级不同；批量侧已有「批量设置发布目标」工具条（`BatchTargetsToolbar.vue`），本刀不动。
3. **"反选"**：语义混乱（反选后选中的恰是无账号平台集合），明确不做，只提供「清空」。
4. **分组内逐成员的跳过原因明细**：留在聚合播报计数里（P2-8b §十二.3 结论），本刀不改。
5. **可发现性**：从未建过组的用户在发布页看不到分组入口（P2-8b §十二.5 结论），本刀沿用。

## 十二、变更影响面（供 review 与 CI 取证）

| 文件 | 变更 | 性质 |
|---|---|---|
| `apps/desktop/src/features/publish/usePublishTargetBulk.js` | 新增纯函数（全选判据 + 清单截断骨架） | 新文件 |
| `apps/desktop/src/composables/usePublishTargetBulkTargets.js` | 新增接线层（store ↔ 视图 + 播报 + v-bind 合成） | 新文件 |
| `apps/desktop/src/features/publish/components/PublishTargetSelector.vue` | 新增全选/清空一行；新增 3 个 prop 与 2 个 emit | 改 |
| `apps/desktop/src/features/publish/components/PublishGroupPicker.vue` | chip 增加 tooltip（已选/成员）与已全选视觉态 | 改 |
| `apps/desktop/src/composables/usePlatformSelection.js` | 新增 `clearPlatforms`（只动 selectedPlatforms） | 改 |
| `apps/desktop/src/views/Publish.vue` | 1 行解构 + 1 行 v-bind + 2 行事件绑定（净 +4，仍在 targets 1773 之下） | 改 |
| `apps/desktop/src/locales/publish-page/zh.js` / `en.js` | 新增 `targetBulk` 段 + `groupPicker.selectedCount` | 改（成对） |
| `apps/desktop/src/features/publish/usePublishTargetBulk.test.js` | 新增（12 例） | 新文件 |
| `apps/desktop/src/composables/usePublishTargetBulkTargets.test.js` | 新增（9 例） | 新文件 |
| `apps/desktop/src/features/publish/components/publish-target-bulk.component.test.js` | 新增（7 例，L8-L11） | 新文件 |
| `apps/desktop/src/views/publish-target-select-all.test.js` | 新增（6 例，视图层接线 L14） | 新文件 |
| `apps/desktop/src/views/Publish.test.js` | 账号目录替身改 ref（响应式修复），无新用例 | 改 |
| `01-docs/PRD-PUBLISH-GROUP-PICKER-2026-10-03.md` | 交叉引用本刀（不改其结论） | 改 |
| `01-docs/UI-INVENTORY.md` §7.2 | 补全选/清空/分组回视 | 改 |
| `01-docs/PRD-PUBLISH-PAGE-OPTIMIZATION-2026-10-08.md` | P2-8 第三刀标记 | 改 |
| `CHANGELOG.md` | 置顶条目 | 改 |
| `openspec/records/publish-target-select-all.md` | 执行记录 | 新文件 |
