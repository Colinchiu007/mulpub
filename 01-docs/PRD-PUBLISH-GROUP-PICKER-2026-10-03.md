# PRD：发布页「按组添加」发布目标选择器（P2-8b，publish-group-picker，2026-10-03）

> 上游：`01-docs/PRD-ACCOUNT-GROUPS-PERSISTENCE-2026-10-01.md`（P2-8a，已合并 #2756）——分组真源已从 `localStorage` 迁到按用户命名空间隔离的 settings 面。
> 立项：`01-docs/PRD-PUBLISH-PAGE-OPTIMIZATION-2026-10-08.md` 差距表 P2-8 的第二刀。
> 本刀只解决一件事：**分组在账号页能建、在发布页用不上**。用户建组的动机就是"发布时一键选这组号"，P2-8a 之后这个动机没有出口。
>
> **下游（2026-10-17）**：`01-docs/PRD-PUBLISH-TARGET-SELECT-ALL-2026-10-17.md`（第三刀）在同一个「发布目标」区加了「全选 / 清空」，并给本刀的 chip 补了"已选/成员"回视与点击前预告 tooltip。第三刀**未改本刀的任何结论**：additive 语义、不做按组替换、无组不渲染三条全部沿用。

## 一、目标与范围

- **目标**：在发布页的「发布目标」区提供一个按分组批量勾选发布账号的入口；一次点击 = 把该组的成员账号加入选中集（并自动勾上这些账号所属的平台）。
- **不做**（每条都是刻意的范围克制，不是遗漏）：
  1. **不改分组的 CRUD**：建组/改名/增删成员仍在账号页 `AccountGroupsPanel.vue`，本刀只读。发布页出现第二套编辑面就会有两份写路径，而 P2-8a 的全部教训就是"写入口必须唯一"。
  2. **不做「按组移除」**：移除是逐个勾选的反向操作，语义上是"取消这一组当前已勾中的成员"，但用户更常想要的是"只发这一组"——那是替换语义，会把用户手工加进去的别组账号悄悄清掉。**替换是一种破坏性动作，不能被当成便利性顺手加进来**。
  3. **不改批量模式**（`BatchArticleFields.vue` 的逐条目选平台）：批量态每个条目目标不同，"按组"的作用域是整篇而非条目，硬套会把层级搞混。
  4. **不新建第二份分组真源/第二份成员校验**：一律经 `account-groups-store` 的归一结果与 `usePlatformSelection` 的可用性判据。

## 二、数据来源与接线（实测）

| 层 | 位置 | 本刀怎么用 |
|---|---|---|
| 分组真源 | `store:get-setting` / `store:set-setting`，业务键 `account_groups`，owner 命名空间由主进程加 | 只读，经 `accountStore.groups` |
| 渲染层状态 | `apps/desktop/src/stores/accounts.js` 的 `groups` / `groupsStatus` / `loadGroups()` / `ensureLoaded()` | 复用，不另拉一次 IPC |
| 归一与校验 | `apps/desktop/src/features/accounts/account-groups-store.js` 的 `normalizeAccountGroups`（组形状：`{id,name,platformFilter,accountIds,categoryTags}`） | 复用；本刀不重复校验形状 |
| 选中集 | `apps/desktop/src/composables/usePlatformSelection.js`：`selectedPlatforms: string[]`、`selectedAccounts: {platformId: accountId[]}` | 唯一写入口 |
| 可用性判据 | 同文件的 `getAvailableAccountIds(platformId)`（内部 `getAccounts` 已按 `isAccountActive` 收口） | 唯一判据，禁止另写「有账号就能选」 |

**必须"先平台、后账号"的顺序约束（不是风格问题）**：`usePlatformSelection.js:139-142` 的 `reconcileSelectedAccounts()` 在 deep watch 里遍历 `selectedAccounts` 的键，凡不在 `selectedPlatforms` 里的平台**直接 delete**。所以只写 `selectedAccounts[pid]` 而不先把 `pid` 加进 `selectedPlatforms`，账号会在下一个 flush 被静默抹掉——表现正是"点了没反应"。本刀的判据顺序由 `usePublishGroupApply.test.js` 的行为锁守住（断言"平台选择发生在该账号被写入之前"）。

**另一个反向陷阱**：`reconcileSelectedAccounts()` 对"已选平台但选中集为空"会回填**默认账号**（`:126-130`）。若"按组添加"先勾平台、再等下一轮才写账号，中间那一帧会被默认账号占位，结果组里没有默认账号时选中集里凭空多出一个号。因此两步必须在**同一个同步段**内完成，不得用 `await`/`nextTick` 分开。

## 三、数据校验（逐条判据与归类）

输入：一个 `group`（`normalizeAccountGroups` 的输出元素）+ 当前账号集。输出必须是**分好类的计数**，不得只有一个布尔。

| # | 情况 | 判据 | 归类 | 用户看到 |
|---|---|---|---|---|
| 1 | 成员 id 在当前账号集里查不到（账号被删/换机导入） | `resolveAccount(id)` 为空 | `missing` | 「N 个成员不在当前账号列表，已跳过」 |
| 2 | 成员存在但已停用 | `isAccountAvailable(platform, id)` 为 false（内含 `isAccountActive`） | `inactive` | 同上文案并列计数；**不得**把它算成已添加 |
| 3 | 成员的 `platform` 与组 `platformFilter` 不符（真源被外部改写过） | 两者都有值且不等 | `platformMismatch` | 计入跳过，reason 归入同一条文案 |
| 4 | 成员已在选中集里 | `isAccountSelected` 为 true | `already` | 「已在选中集」，新增数为 0 |
| 5 | 组里没有**可判定成员** | 去重后的字符串成员数为 0 | 空组 | 「这个分组还没有成员」，不发写请求 |
| 5b | 成员列表缺失 / 非数组 / 全是非字符串 | `Array.isArray(accountIds)` 为假，或过滤后长度为 0 | 空组（同上） | 同上。**不按"全部账号"回填**：归一层 `normalizeAccountGroups` 已按平台筛选回填过一次（`healed`），走到纯函数还拿到非数组说明消费者绕过了归一，此时猜成员会把用户没放进组里的号发出去。**口径（QM-6 后端轴 W-Q3 反哺）**：判据锚定在"过滤后的可判定成员数"，不是原始 `accountIds.length` —— 例 `[123,null]` 原始长度 2，仍按空组处理，因为这两个元素都不可判定；本表此前按原始长度写，会让读者以为它会走"2 成员"分支 |
| 6 | 全部成员都不可添加 | `added.length === 0` | 全跳过 | 按 missing/inactive 的**具体原因**播报，不得只说"失败" |
| 7 | 分组真源读不到 | `groupsStatus !== 'ok'`（`unreadable` / `save-failed` / `pending-migration`） | 状态面 | 控件不显示假组列表；`P2-8a` 已定「读不到 ≠ 没有」，此处进一步「读不到 ≠ 可添加」 |
| 8 | 发布进行中 | `props.disabled` | 禁用 | 按钮 disabled，不吞点击也不改选中集 |

**不新做上限**：成员数与组数上限由 `normalizeAccountGroups`（`MAX_ACCOUNT_GROUPS=50`、`MAX_GROUP_ACCOUNTS=500`）在真源读侧统一收口，本刀再设一份就是第二份口径。

## 四、流程

```
发布页挂载
  └─ accountStore.ensureLoaded()  // 账号与分组都到位才谈"按组添加"
       └─ groups.length > 0 ? 渲染 PublishGroupPicker : 不渲染（见 §六 视觉中性）
点击某组
  └─ applyAccountGroup(group, {resolveAccount, isAccountAvailable, isAccountSelected, selectPlatform, selectAccount})
       ├─ 逐成员归类（§三）
       ├─ 需要新平台时：selectPlatform(pid) → 紧接着 selectAccount(pid, id)（同一同步段）
       └─ 返回 {added, already, skipped[{accountId,reason}], platforms:[新启用平台]}
  └─ 按结果播报（§八），并在 §二 的 reconcile 之后不撤销（additive 语义）
```

## 五、功能逻辑（为什么这样定）

1. **纯函数 + 注入依赖**：`applyAccountGroup` 不 import store、不碰 Vue 响应式，只做"给定解析器与写入器，产出分类计数"。这样它能被直接单测，也保证发布页与未来任何消费者（如自动化任务按组下发）能共用同一份判据，不再抄第二遍。
2. **additive（只增不减）**：与逐个勾选同语义。用户点第二组 = 两组并集；这与"替换"相比唯一的好处是不会覆盖用户的手工选择。
3. **幂等**：同一组连点两次，第二次 `added=0 / already=n`，选中集逐字节不变。这条必须有测试，因为"再点一次把账号取消"是 toggle 语义的自然错觉，而按组 toggle 会让用户以为界面坏了。
4. **平台随账号一起被选中，且必须如实说出来**：组里若含抖音号而抖音当前未选，点击后抖音会进入发布目标。这不是副作用而是本刀的功能定义（"把这组号加进发布目标"），但**提示文字必须点名新启用的平台**，否则用户会以为只加了账号（§八）。
5. **不写第二份"显示名"**：成员计数与跳过理由只报 id 的数量，名字仍由 `PublishTargetSelector` 经 `resolveAccountDisplayName` 渲染——AGENTS.md 已把"显示名唯一入口"定为纪律。

## 六、显示项

| 位置 | 内容 | 数据 | 空/异常态 |
|---|---|---|---|
| 「发布目标」标题下、平台列表上 | 一行分组按钮（chip），文案 = 组名 + `可添加数/成员数` | `accountStore.groups`；可添加数 = 该组成员里当前 `isAccountAvailable` 为真的个数 | 无组 ⇒ **整块不渲染**（不给死控件，也不改像素基线）；全组都不可添加 ⇒ 仍渲染，数字显示 `0/3`，点击后如实播报而不是禁用（禁用会让用户以为按钮坏了） |
| 组名过长 | 省略号 + `title` 原值 | `GROUP_NAME_MAX=40` 已在真源侧限长 | — |

**「0/3 会不会在账号加载完成前闪一下、完成后跳成 2/3」（QM-6 前端轴 W-F2 提出，实测否证）**：不会，原因在宿主自身的赋值顺序 —— `stores/accounts.js` 的 `load()` 里 `accounts.value = res.data`（`:65`）严格发生在 `await loadGroups()`（`:81`）之前，而分组**只**经 `loadGroups()` 进入 store（发布页的 `ensureLoaded()` 走的就是这条 `load()`）。所以"组可见"与"账号已在"不是两件事，chip 从一开始就能算出真实的 `applicable`。唯一残留分支是 `listAccounts()` 非瞬时失败 ⇒ `accounts.value = []` 而分组照常加载，此时 chip 显示 `0/N`，那是**如实**（确实一个都加不了），点击得到 `nothingToAdd` 而不是假成功。
> 顺带记一条本刀自证的问题（两轴评审都没问到）：**如果 `loadGroups()` 不在 `load()` 里，本刀功能会永久不可见**（用户必须先去账号页触发一次分组加载）。这条跨层时序不在 diff 内，只能靠"知道去哪读"来查 —— 外部评审替代不了对宿主调用链的自证。

**视觉基线纪律（为什么"无组不渲染"不只是审美选择）**：按 AGENTS.md 视觉第 7 条，基线只能取自 CI 产物、且换基线必须自证「新基线 vs 同一次 CI 渲染 = 0 px」。本刀是数据/交互层修复，不该把一次基线重建混进来。

**实测出处（本刀为什么必须保持渲染缺席）**：发布视图**确实在 CI 执行的那份注册表里** ——
`apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js:22`
`{ name: 'publish-form', route: '/publish', waitFor: '.mp-workspace .target-selector [data-testid^="platform-"]' }`。
而 CI 用空 profile 跑 ⇒ `groups` 恒为空。所以"空态也渲染"不是一次可以事后补基线的漂移，而是一次确定性红。两点连带结论：

1. 「无组不渲染」既是交互判断，也是本刀**构造性保持视觉中性**的手段；它的证据不靠 `QG Visual` 的绿，
   而靠 `PublishTargetSelector.test.js` 的结构断言（空态下 section 的直接子节点仍恰为 `[input, div]`）。
   该断言做过反证：摘掉 picker 的 `v-if` 后必须变红（见 §九 M8 与质量记录）。
2. **不要**把这条锁写成"改前 html 与改后 html 相同"这种形式 —— 那份对比里两次挂载跑的是同一份新代码，
   对本刀声称的"与改前一致"是恒真断言（装饰性门禁）。必须断言**改前就存在的形态**本身。

## 七、交互逻辑

- 触发：点击组 chip 即应用（不设"确认"步，因为它可逐个再点掉、非破坏性）。
- 禁用：`disabled`（发布中）时整块禁用；`groupsStatus==='unreadable'` 时不渲染组列表（P2-8a 的语义：读不到 ≠ 没有，也不等于可操作）。
- 键盘/可达性：chip 用原生 `<button>`，容器带 `role="group"` + `aria-label`（走 locale）。
- 与搜索框的关系：`PublishTargetSelector` 自己的搜索只筛平台/账号，**不影响**按组添加的结果（组是选中集的操作，不是可见集的操作）。这点写进提示，避免用户以为"搜了再点组会只加搜到的那些"。
- 不做 loading 态：`ensureLoaded()` 已在页面挂载时完成，点击路径是同步的；加一个转圈等于给不存在的异步建门面。

## 八、提示文字（locale 键，zh/en 成对；新增文案一律进 locales）

| key | zh | 触发 |
|---|---|---|
| `publishPage.groupPicker.label` | 按分组添加 | 容器 aria-label / 小标题 |
| `publishPage.groupPicker.applyAria` | 按分组 {name} 添加发布账号 | 每个 chip 的 aria-label |
| `publishPage.groupPicker.added` | 已按「{name}」添加 {added} 个账号{platformText} | added>0 |
| `publishPage.groupPicker.platformsEnabled` | ，并启用平台：{platforms} | added>0 且有新启用平台（接在上一条后） |
| `publishPage.groupPicker.skipped` | ，跳过 {skipped} 个（账号已删除或已停用） | skipped>0 |
| `publishPage.groupPicker.alreadySelected` | 该分组的 {count} 个账号已在选中集里 | added=0 且 already>0 |
| `publishPage.groupPicker.emptyGroup` | 这个分组还没有成员 | 组成员为 0 |
| `publishPage.groupPicker.nothingToAdd` | 「{name}」里的账号当前都不可用（已删除或已停用） | added=0 且 already=0 且 skipped>0 |

- 播报一律走 `useNotify`，成功用 info、"什么都没加进去"用 warning（用户点了没反应最容易被当成 Bug）。
- **禁止**出现"添加成功"这种与 `added=0` 同时打印的文案；每条文案的数字都来自同一次分类结果。

## 九、测试矩阵与反证

| 层 | 文件 | 锁 | 反证（须变红） |
|---|---|---|---|
| L1 | `usePublishGroupApply.test.js` | 分类正确：missing/inactive/platformMismatch/already/added 各自计数，且 `added+already+skipped === 成员数` | 把 inactive 并进 added ⇒ 红 |
| L2 | 同上 | **顺序锁**：新平台必须在写入该账号之前被选中 | 交换两次调用的先后 ⇒ 红 |
| L3 | 同上 | **同段锁**：实现里不得出现 `await`/`nextTick`（否则默认账号回填插在中间） | 读源码断言（剥注释后） |
| L4 | 同上 | 幂等：同组两次 ⇒ 第二次 added=0，且写入器调用次数不增 | 改成 toggle 语义 ⇒ 红 |
| L5 | `PublishGroupPicker.test.js` | 无组 ⇒ 不渲染（`find` 为空）；有组 ⇒ chip 数 = 组数、显示 `可添加/成员` | 空态也渲染 ⇒ 红 |
| L6 | `PublishGroupPicker.test.js` | `groupsStatus='unreadable'` ⇒ 不渲染列表（读不到 ≠ 没有 ≠ 可操作） | 无条件渲染 ⇒ 红 |
| L7 | `PublishTargetSelector`/`Publish.vue` 既有测试 | 既有断言零回归（选中集形状与 toggle 语义未变） | — |
| L8 | `usePlatformSelection.test.js`（既有） | 反向确认 reconcile 会删「未选平台的账号键」——本刀顺序约束的成因就在这条既有行为里 | 若该既有行为被改掉，L2 的理由须同步改写 |
| L9 | `PublishTargetSelector.test.js` | 空态下 section 的直接子节点仍恰为 `[input, div]`（视觉中性的 DOM 级证据）；`accountGroups` 只转发 `apply-group` | **实跑**：摘掉 picker 的行 `v-if` ⇒ 该用例红（M8，命中"没有可操作分组时不渲染…"）。注：该红由同用例第一条断言（testid 不存在）先命中，第二条子节点断言是同一失效的后继形状锁；本锁**不得**写成"改前 html == 改后 html"（两次挂载跑同一份新代码 ⇒ 恒真），初版就是这么写的，已当场纠正 |

| L10 | `PublishGroupPicker.test.js` | 组名里的 vue-i18n 元字符（`{name}`、`@:key`、`{0}`、`${j}`、`\{`）只当文本、不被二次解析（QM-6 前端轴 F5 反哺） | 4 个恶意组名 × 3 条文案（`applyAria`/`added`/`nothingToAdd`）断言 `toContain(原组名)`；**实跑 7 passed** ⇒ "vue-i18n 不递归解析插值值"是测出来的，不是推断的。若将来改成手写字符串拼接文案，这条保护会失效 —— 所以提示文字一律走键 |

## 十、外部评审（QM-6）与逐条处置

0 Critical / 2 Warning。后端轴 W-Q3（PRD 判据按原始长度写、代码按过滤后长度判空组）**接受并改文档**；
前端轴 W-F1（`toggle*` 与 `select*` 两族写入器，建议改名 `ensure*`）**以可达性论证拒绝**——
`applyAccountGroup` 在调用写入器之前已用 `isAccountSelected` 短路，"误传 toggle 会取消选择"这一路径不可达，
而为不可达的场景改名/加运行时警告属于给假想未来建抽象。前端轴 W-F2（`0/3 → 2/3` 跳变）**被宿主赋值顺序否证**（§六）。
F5 补测试（L10）、F3/F4/F6 登记或否证。全部原文与处置见
`01-docs/QM6-FINDINGS-PUBLISH-GROUP-PICKER-2026-10-03.md`（含替代通道偏差声明、
以及"第一次启动空跑 15 分钟被误读成还在跑"这条通道现场）。

**评审没问到、但由本刀自证的一条**：`loadGroups()` 必须在 `load()` 之内 —— 否则功能冷启动即不可见（§六 末注）。

## 十一、验收

- 单测：新增文件全绿 + `Publish.vue`/`usePlatformSelection`/`accounts store` 相关既有测试合跑全绿（按 AGENTS.md「消费者并集」口径，改共用模块前先 `git grep -l` 取消费者）。
- `check-locale-sync`：zh/en 成对 + key existence + CJK 基线扫描不因本刀上升（新文案必须全部在 locales 里）。
- `QG Visual`：以 CI 为准；本刀主张"空 profile 下 DOM 无新增"，由「无组不渲染」用例 + CI 0 px 共同支撑。
- 真机行为验证需要已登录 profile 与至少一个分组；本机不做端到端（会牵动共享 userData），行为面以单测为准并在质量记录里如实标注。

## 十二、残余（明确不在本刀）

1. **批量模式按组**：条目级目标与"整篇按组"的层级不同，需要先定"组作用域"产品口径。
2. **按组替换/移除**：见 §一 第 2 条，属破坏性语义，需要单独设计（含撤销）。
3. **组内成员的可用性徽标**：本刀只在 chip 上给一个 `可添加/成员` 计数；逐成员的 missing/inactive 原因明细留在播报文案的聚合计数里，逐条列出会把一行提示变成清单。
4. **分组与 `categoryTags`（内容类别）联动**：`automation-content-category` 已给组加了软标签，但"按类别选组"属自动化侧，不在发布页本刀。
5. **可发现性（QM-6 前端轴 F4 提出的产品取舍）**：从未建过组的用户在发布页看不到任何入口。已核：在"不改 DOM"的约束下**不存在**既能让其看到、又不新增渲染节点的方案（看到=渲染=改 DOM）。评审给的折中 (1)（改既有节点文案）自己就承认会触发像素门禁；(2)（账号页加"去发布页使用"引导）是另一刀的文案改动。**本刀明确选择"视觉中性优先"**，把可发现性留给后续切片用文案位解决（那需要一次 CI 同源基线重建）。
