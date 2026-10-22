---
record: platform-picker-ux
task: 账号页「添加账号」的平台选择器由原生 <select> 改为应用内自绘浮层——图标/搜索/分组/键盘全可控（原生控件展开态由操作系统绘制，CSS 无法介入）
date: 2026-10-21
---

## 本次执行记录：账号页「添加账号」平台选择器自绘浮层（platform-picker-ux，2026-10-21）

> 本文件为执行记录（唯一强制载体，见 `openspec/records/` 新形态）。
> 状态列不手写远程同步状态词：合并一旦发生，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。
> `CHANGELOG.md` 与 `01-docs/learnings.md` 是聚合器专属的归档写面（热写面，多 PR 并发必撞），本 PR **零改动**。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-platform-picker-ux`（D 盘，非 C 盘）+ 裸分支 `platform-picker-ux`；入口 `scripts/start-mp-task.ps1 -TaskName platform-picker-ux`（自动探测 Git for Windows Bash），依赖 `pnpm install --frozen-lockfile` + `ensure-electron` + `verify-worktree-deps` 全绿。**共享主目录全程未落任何代码**：全程 cwd 在 worktree 内；`git worktree list` 复核共享根仍停在 `main` 且 clean（唯一 untracked 是既有 `.ccg/reviews/8131f04….json` 孤儿，非本轮产生） |
| 第一性原因（QM-5 ①） | ✅ | **不是「样式没写好」，是「控件选错了」**。`UiSelect.vue` 的实现是原生 `<select>` + `appearance: none`；`appearance: none` 只能去掉**收起态**的原生外观（箭头、边框），一旦展开，弹出列表由**操作系统**绘制 ⇒ **CSS 完全无法介入**。这是 Web 平台的能力边界，不是本项目的实现缺陷 ⇒ 「把这个下拉调精致一点」在原生控件形态下**走不通**，必须把展开态收回到应用内自绘。现场证据：用户截图里那个浮层是系统蓝高亮、直角、无图标、无搜索、无分组、从弹窗里长出来盖住底部按钮——每一项都是系统绘制的特征 |
| 逃逸分析（QM-5 ②） | ✅ | ① **组件层**：`UiSelect` 自身有 15 处调用方（含视频创作面板的运营后台隐藏守卫契约），它是**通用控件** ⇒ 「平台选择要带图标/分组/搜索」这个需求天然无法塞进通用控件——通用化的代价是丢掉领域信息，于是每个需要领域信息的调用方都要自己再画一遍；② **评审层**：视觉评审看的是**截图**，而原生下拉的展开态在自动化截图里**根本抓不到**（它是操作系统窗口，不是 DOM）⇒ 「浮层长什么样」从来没进入过任何视觉回归的判定面；③ **测试层**：原生 `<select>` 的选项用 `options[].text` 断言即可，不需要测试「展开后的分组与搜索」⇒ 行为覆盖率天然为 0；④ **需求层**：平台分类（国内/海外）在仓里已经存在（`platformStore.getCategory` + 发布页 `usePublishPlatformCatalog.js`），但**账号页从未消费过它** ⇒ 数据在、界面不用，是典型的「能力已备而接线缺失」 |
| 系统性漏洞（QM-5 ③） | ✅ | ① 通用控件与领域控件的边界没定：`UiSelect` 被要求承载「平台」这种带图标/带分组的领域对象；② 平台分类的**非本地化缺口**：`getCategory()` 返回中文值「中文/海外」，任何 UI 层要按它分组就得在渲染端代码里写中文字面量（本仓 `locale-sync --cjk` 门禁对新增硬编码中文零容忍，基线只降不升）⇒ 缺少「翻成结构键」这一层；③ 视觉基线只能取自 CI 同源渲染（QM-4 第 7 条），而**交互态**（浮层展开）在本仓当前设计里**没有落点**——工作流基线复用视图基线，视图是路由级的 ⇒ 「展开态」既无像素锁也无采集面；④ 死组件：`PlatformIcon.vue` 自 2026-10-19 起挂在「未接线组件」欠账清单上（生产面零引用），而它恰恰是 15 个平台图标 + 品牌色首字回退的现成实现 |
| 修复 + 回归保护（QM-5 ④） | ✅ | **修复**：① 新增 `AccountPlatformPicker.vue`（390 行，自绘浮层：`Teleport` 到 body 避开 `UiModal` 的 `overflow` 裁剪；图标复用 `PlatformIcon`；搜索框按平台显示名 + 平台 id 双路大小写不敏感子串匹配；按 `getCategoryGroup` 分「国内平台 / 国际平台」两组，空组整组不渲染；`role="combobox"` + `role="listbox"` + `aria-activedescendant` 全键盘可达；关闭后焦点交还触发器；下方空间不足时向上翻转）。② `AccountLoginDialog.vue` 的「平台」字段由 `UiSelect` 换成它（119 行）。③ `stores/platforms.js` 新增 `getCategoryGroup(id)`，把分类值翻成 `domestic`/`international` 结构键（中文值只留在 store 与 locale 两处）。④ locale 新增 12 条成对文案（`accountsPage.platformPicker.*`，zh/en）。⑤ 顺带把 `PlatformIcon.vue` 接线（欠账清单对应条目销账）——它是 15 个平台图标与品牌色首字回退的现成实现，复用它比再造一份图标表更少漂移。**回归保护**：新增 `AccountPlatformPicker.test.js` **22 例**（展开/收起、显示名过滤、平台 id 过滤且大小写不敏感、纯空格等价空输入、搜索无结果空态、平台目录为空空态、点击选项 emit 并收起、已选项勾选态、ArrowDown/ArrowUp 打开与移动、边界不循环、Esc 收起、点击外部收起、焦点回收、重复 id 去重、缺失 label 回退、禁用态不展开、鼠标打开无幽灵高亮、鼠标打开激活项落在已选平台）；`stores/platforms.test.js` 新增 2 例（`getCategoryGroup` 的结构键映射 + 跟随平台目录加载的分类）；`AccountLoginDialog.test.js` 更新 stub 并新增 1 例（平台选择由自绘选择器承接并向外透传 id）。**真实渲染核对**：用仓库自带的 Playwright 视觉管线（`TEST_URL` 指向本 worktree 的 vite 实例）实跑，截图确认图标/分组/搜索/勾选/焦点环/收起态图标均按预期渲染，并据此修掉三处观感问题（见 CHANGELOG 条目） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **把「控件选型」写进 PRD**：§1.2 明确「原生 `<select>` 的展开态由操作系统绘制，CSS 无法介入」⇒ 下一个人不会再去「调原生下拉的样式」；② **视觉工作流接线**：新增 `accounts-platform-picker` 工作流（`all-workflows.visual.test.js`），把「开弹窗 → 展开浮层 → 搜索 → Esc 收起 → 关弹窗 → 复位」整段交互跑完，**末态回到账号列表**，于是拿到的是**交互层**回归保护（浮层打不开/搜索不生效/收不回弹窗都会让该条红）而不需要引入一张来路不明的像素基线；③ **不给「像素基线」造假**：本仓视觉基线必须与 CI 同一次渲染逐像素相等（Gate 7b 的 0 px 判定），本机截图当基线是明确禁止的 ⇒ 「浮层展开态」的像素基线**留作遗留项**，等 CI 产出同源渲染后再补，不在本 PR 里用本机截图冒充；④ **结构键缺口封死**：分类值的中文形态只允许出现在 `stores/platforms.js` 与 locale，UI 层拿到的恒为 `domestic`/`international` ⇒ 新的调用方不会再写第二份中文字面量；⑤ **死组件销账**：`scripts/ui-wired-debt.json` 删掉 `PlatformIcon.vue` 条目（欠账清单只能缩小），本 PR 即为它补上了生产面消费者 |
| 行尾与 diff 对账 | ✅ | 新建文件（PRD / 组件 / 组件测试 / 组件 CSS）统一为 **CRLF**，与全仓工作副本约定一致（`* text=auto` 的 checkout 转换；blob 仍是 LF）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐行相等（见自测块） |
| 接线棘轮 | ✅ | 新增 `apps/desktop/src/features/accounts/components/AccountPlatformPicker.test.js` 落在 `apps/desktop/src/`，被 vitest 的 `src/**/*.test.js` 收录（桌面端分片 `--shard=1/2`/`2/2` 按文件自动分配，新文件自动进片）；`node scripts/check-unwired-tests.js` rc=0 |
| QM-1 打包 | ✅ | 见自测块（`pnpm run build:vue` rc=0 + electron-builder `--dir` rc=0 + 启动存活 + stderr 0 字节） |
| QM-2 代码必检项 | ✅ | 无新增 IPC、无 `v-html`、无同步阻塞原语、无硬编码等待；所有新增用户可见文案走 locale（zh/en **成对**提交，`check-locale-sync.js --keys` 209 个使用中 key 均存在于 zh/en）；CSS 零 hex 字面量、零 `font-size` 字面量、零未定义 CSS 变量（`check-color-literals` / `check-font-size-scale` / `check-css-var-defined` 三门禁均 PASS）；`check-scoped-root` / `check-vue-style-parse` / `check-max-lines` / `check-ui-wired` / `check-frontend-consistency` 全 PASS |
| QM-4 视觉回归 | ✅（有据，附一处如实留白） | ① **真实渲染核对已做**：用仓库自带 Playwright 管线对本 worktree 的 vite 实例实跑并出图（开弹窗 / 展开浮层 / 搜索 / 选中 / 重开六态），据此修掉三处观感问题：① 搜索框焦点环原为「描边叠在边框上」的粗重双层紫环 ⇒ 改为与 `UiSelect` 同口径的「主色边框 + 14% 柔光环」；② 浮层最大高度 320px 时只能露出 5 个平台 ⇒ 提到 420px（可见 8 个）；③ 浮层宽度取 320 会比触发器宽出一截（右边缘对不齐）⇒ 取 300（本仓 360px 弹窗里恰好等于触发器宽度）；另把「鼠标点开时预置首项高亮」改为「不预置（无幽灵高亮）/ 激活项落在已选平台」。② **像素基线这一格如实留白**：本仓视觉基线必须与 **CI 同一次渲染**逐像素相等（QM-4 第 7 条 + Gate 7b 的 0 px 判定），本机截图当基线是明确禁止的；且工作流基线复用**视图**基线（视图是路由级，渲染不出「浮层展开」这个交互态）⇒ 本 PR 只补**交互层**保护（新增 `accounts-platform-picker` 工作流，复用既有 `accounts-list` 基线、末态复位），不伪造像素基线。「浮层展开态」的像素基线留作遗留项（见下节） |
| QM-6 CCG 双模型外部评审 | 🟡（第一轮已完成裁决并修复；第二轮见下节） | pre-commit 判定 **DUAL**（变更 886 行 > 200 行阈值）⇒ `sh scripts/deep-review.sh` 实跑 **opencode(proposer) + claude(critic)** 双后端（`--check-deps` 两后端裸名自检均通过，依赖体检通过）。**第一轮**（针对 commit `e2e07725`）：critic=claude 给出 **7 条**（2 Critical + 3 Warning + 2 Info），4 维度分 correctness 6 / security 8 / performance 7 / maintainability 5，**最低分 5** ⇒ 引擎判 `status=self_play`（置信权重 0.6 < 1.0），落自扮演裁决模板 `.adversarial/ccg-deep-e2e07725/adjudication.json`。**逐条裁决**：**upheld 2 条（i1 弹窗测试用假桩件致集成回归失真、i5 滚动时逐事件重算位置无节流）**——两条均已修（i1 改为挂**真组件**跑真实交互，i5 合并到 `requestAnimationFrame` 一帧一算）；**dismissed 5 条**，逐条理由见「§QM-6 第一轮逐条裁决」。i6（CSS 令牌）被引擎判为高危域（`auth`）⇒ 不允许自扮演豁免，**必须外部复核 + 公开出处**，见「§QM-6 外部复核」 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

## QM-6 第一轮逐条裁决（critic=claude，7 条）

引擎把这一轮判为 `self_play`（置信权重 0.6 < 1.0），并规定：`verdict=upheld` 恒计阻断 ⇒ **成立项必须修掉并重跑评审**；高危域项**不允许自扮演豁免**，必须外部复核且留公开出处。逐条裁决（prosecution / defense / verdict / rationale 的完整版落在 `.adversarial/ccg-deep-e2e07725/adjudication.json`）：

| id | 严重度 | 裁决 | 理由（可当场复核） |
|----|--------|------|--------------------|
| i1 弹窗测试用假桩件，集成回归失真 | Critical | **upheld（已修）** | 指控成立：初版 `AccountLoginDialog.test.js` 给选择器打的是「一个只会硬编码 emit 一个固定平台 id 的假按钮」桩件，**完全忽略 `platforms` prop** ⇒ 把弹窗里 `:platforms="props.platforms"` 这行绑定整个删掉，用例照样全绿——集成回归等于没测。**修法**：取消桩件，改挂**真组件**跑真实交互（点触发器 → 真实浮层里点「抖音」→ 断言弹窗向外 emit `douyin`）。平台选项能出现，本身就证明 prop 契约是通的。 |
| i2 体量过大、无模块拆分 | Critical | **dismissed** | 指控的前提数字需要拆开看：1711 行里 **≈1100 行是测试**、**292 行是 PRD**（TDD 与「先文档再代码」都是仓库强制），真正的新增代码是 390 行 SFC + 211 行 CSS。仓库对「文件太大」的**机械定义**是 `check-max-lines`（limit 500）：SFC 414 行、CSS 211 行，均在限内 ⇒ 该门禁在每个 PR 上自动盯着，不靠自觉。「模块拆分」其实已做——样式按仓内既有范式（`<style scoped src>`，与 `HotTopics.vue` / `FilmAutoPanel.vue` 同款）拆到独立 CSS 文件，SFC 里只剩结构与逻辑；「architecture record linking PRD and code」也已满足（PRD §2 数据流 + §9 影响面清单 + 本记录 QM-5 五步）。「把一个内聚控件再拆成子组件」会**增加**文件数与 prop 传递链，不减少指控里量到的那个体量。 |
| i3 目录未就绪时分组会把海外平台误分到国内 | Warning | **dismissed** | 指控的事实前提不成立：`getCategory(id)` 的兜底是 `categories.value[id] \|\| DEFAULT_CATEGORIES[id] \|\| ''`，而 `DEFAULT_CATEGORIES` 是**按平台逐个**登记的 15 条（10 个中文 + 5 个海外）⇒ 目录未加载时 `youtube` 依然落 `international`，不是「一律当国内」。为免这一口径将来被改坏，本轮**补了一条用例**把逐平台兜底钉住（`stores/platforms.test.js`「getCategoryGroup falls back per-platform before the directory is loaded」）。 |
| i4 Teleport 的 pointerdown 捕获监听可能与弹窗关闭冲突 | Warning | **dismissed** | 捕获阶段监听是这里**刻意**的选择：浮层在 body 上，点击判定必须能在内层处理器 `stopPropagation()` 时仍然生效。处理器**不修改事件**（无 `preventDefault` / `stopPropagation`），因此不会吃掉任何其他处理器；「点弹窗关闭按钮」时两个动作各自照常发生（浮层收起 + 弹窗关闭），互不吞掉。守卫是 `rootRef.contains(target)` / `popupRef.contains(target)` 两个早退，落在浮层内或触发器上的点击一律不关。卸载守卫也**已有**（`onBeforeUnmount` 移除监听）。 |
| i5 滚动/resize 逐事件重算位置，无节流 | Info | **upheld（已修）** | 指控成立：浮层打开时 `scroll`/`resize` 每来一次就 `getBoundingClientRect()` + 写 style，触控板惯性滚动与窗口拖拽时会在一帧内连发多次，形成「读—写」交替的强制同步布局。**修法**：合并到 `requestAnimationFrame`，一帧只算一次；关闭与卸载时 `cancelAnimationFrame` 取消未执行的帧。 |
| i6 CSS 用 `color-mix()` 与变量，缺令牌会静默降级 | Warning（**高危域 `auth` ⇒ 须外部复核**） | **外部复核** | 指控的前提「without build validation」不成立：仓内有 `check-css-var-defined.js` 专门拦「引用未定义的 CSS 变量」（本次 rc=0，当前未定义变量 0 / 基线 64），且 `color-mix(in srgb, var(--color-primary) N%, transparent)` 是**仓内既有写法**（`UiSelect.vue` 与 `create-view.css` 同款），支持面与全站一致。引擎把本条判为高危域（`auth`）——该标签与本条内容无关（CSS 令牌不涉认证），但契约规定高危域**不得自扮演豁免**，故走外部后端复核，出处见「§QM-6 外部复核」。 |
| i7 `PlatformIcon` 的 props/资源坏了会让图标静默失效 | Info | **dismissed** | `PlatformIcon` 有自己的契约测试（`apps/desktop/src/components/PlatformIcon.test.js`）锁 prop 形状与图标解析，`usePlatformIconUrl.test.js` 锁 15 个平台的资源映射；本组件的测试另有一条断言「已选平台时触发器必须渲染出图标节点」。本 PR **没有改** `PlatformIcon.vue`（只引用它），不存在「diff 排除该文件导致契约漂移」的场景。 |

## QM-6 第二轮逐条裁决（critic=claude，6 条；针对 commit `16d8b08cc`）

第二轮的 6 条**多数是评审流程自身的读数**（评审记录里的 pending 快照、高危域外部复核未执行），另有两条指向代码。逐条裁决（完整版落在 `.adversarial/ccg-deep-16d8b08c/adjudication.json`）：

| id | 严重度 | 裁决 | 理由（可当场复核） |
|----|--------|------|--------------------|
| i1 评审记录里 `status=self_play_pending`、`findings=null`，对抗评审流程未完成却被纳入变更提案 | Critical | **dismissed（流程在本轮完成）** | 指控指向的是一个**过程状态**，不是代码缺陷：判定记录是 pre-commit 时刻写下的快照（那一刻深度评审还没跑）。本轮填完裁决后，引擎的 `writeBack` 会把**同一份记录**改写为 `self_play_resolved` 并带上 6 条 findings 与逐条 verdict，随本 PR 的后续提交落地 ⇒ 指摘的正是这个尚未完成的过程，本轮即完成它。 |
| i2 高危域（`auth`）的外部复核未执行，`performedBy` 仍是 `self-play(pending)` | Critical（**高危域 ⇒ 必须外部复核**） | **外部复核已完成（dismissed）** | 引擎契约规定高危域项**不得自扮演豁免**，必须由 `expectedExternalBackend`（本轮 = claude）真跑一遍并留下**公开可点开的出处**。已按引擎同一条调用路径（`codeagent-wrapper --backend claude --lite -`，workdir = 本 PR 工作副本）真跑：结论 **VERDICT: dismissed / CONFIDENCE: high**，逐字原文与 Session-ID 已发布为**公开 PR 评论**：<https://github.com/Colinchiu007/mulpub/pull/4160#issuecomment-6311273936>。复核逐条反证了指控的两条断言：A（未定义令牌静默降级）—— 本文件 29 处 `var()` 引用的 19 个令牌槽位**全部**在 `tokens.css` 有定义；B（无构建期校验）—— `.github/scripts/check-css-var-defined.js`（CI Gate 15c）专拦「无 fallback 的 `var(--x)` 引用未定义变量」，本工作区实跑 `current 0 / baseline 64`、rc=0；另附 `color-mix` 是仓内既有写法（`UiSelect.vue:132`，提交 `ee5f7c95b` 2026-09-21，早于本 PR）与 Electron 43/Chromium ≥132 的支持面证据 |
| i3 `openPicker` 在 nextTick 内读 `popupRef`，Teleport 挂载可能滞后于 nextTick，导致 null 读取或位置算错 | Critical | **upheld（已加固）** | 指控成立（风险真实存在，判据是「可能滞后」这一时序假设）。**修法**：把「定位 + 聚焦 + 设定激活项」从 `openPicker` 里的 `nextTick` 挪到**`flush: 'post'` 的 `watch(open)`** —— post-flush 保证本次渲染（含 Teleport 到 body 的子节点）已落定，ref 必非空，**不再依赖「nextTick 与 Teleport 挂载的先后」这种隐含假设**。另附现场证据：修复前的真实浏览器渲染里，浮层位置正确对齐触发器、且搜索框**自动获得焦点**（截图可见焦点环）—— 这两点都要求 Teleport 的 ref 在 nextTick 时已就位。 |
| i4 平台 id 直接拼进 `querySelector('#'+id)`，未转义 | Warning | **upheld（已修）** | 指控成立且比原描述更实：平台 id 来自平台目录，**理论上可含 `:` / `.`** 这类字符；拼进选择器后 `querySelector` 会**抛 SyntaxError**（`#a:b` 是未知伪类）而不是「匹配不到」—— 键盘导航一按就炸。**修法**：改用 `document.getElementById`（不做选择器解析，天然无此问题）。**回归锁 + 变异反证**：新增用例「平台 id 含 CSS 选择器非法字符时，键盘移动仍能定位到该项」；把实现退回旧的 `querySelector` 写法后该用例**当场变红**（1 failed / 22 passed），恢复后 23 例全绿。 |
| i5 `updatePosition` 只按视口算，未处理变换/滚动父容器 | Warning | **dismissed** | 指控的前提不成立：浮层是 `position: fixed` 且**Teleport 到 `body`**（无 transform 祖先 ⇒ fixed 的包含块就是视口），而触发器的 `getBoundingClientRect()` 返回的**也是视口坐标** ⇒ 两者同一坐标系，不存在「浮层相对触发器所在容器」这类错位。真实浏览器渲染里浮层与触发器左边缘对齐、右边缘齐平，可当场复核。 |
| i6 测试用 `document.body.replaceChildren()` 做全局清理，并行下会破坏其他测试的 DOM | Warning | **dismissed** | 本仓 vitest 配置是 `maxWorkers: 1` + `fileParallelism: false` ⇒ **测试文件串行执行**，不存在并行互相踩 DOM 的场景；同一仓已有先例（`RewriteView.output-truncated.test.js` 用的是同一个 `document.body.replaceChildren()` 写法，且注释里就写明了它是为绕开 CCG 安全扫描对 `innerHTML` 的判定）。本文件的清理只针对自己 `attachTo` 挂上去的节点。 |



### 遗留（不假装已闭合）

- **「浮层展开态」的像素基线尚未建立**。原因与处置见 QM-4 行：本仓基线必须取自 CI 同源渲染（Gate 7b 判 0 px），本机截图当基线被明确禁止；而视图注册表是**路由级**的，渲染不出「浮层已展开」这个交互态。**下一刀**应是给视觉套件补一条**带 `prepare` 钩子**的用例（`run-pixel-tests.js` 的 `pixelTests` 支持 `prepare`，可在路由就绪后点开弹窗与浮层再截图），由 CI 产出同源渲染后再把 PNG 落进 `base-screenshots/`。本 PR 已用**交互工作流**（`accounts-platform-picker`）覆盖了「打不开/搜不到/收不回」这类行为级回归，两层互补但不互相顶替。
- **拼音首字母匹配不做**（`xhs` 搜不到小红书）。本仓没有拼音库，引入需要新依赖；`id` 子串已覆盖「知道英文名」的用户。这条是**明确接受的边界**，PRD §2.3 已写明，且**不做隐藏兜底**（避免用户以为「搜了没结果」是 bug）。
- **浮层不做深色主题专项打磨**：沿用 `tokens.css` 的 `[data-theme="dark"]` 重定义，浅色下写对的颜色在暗色下自动跟随；本次未在暗色档实拍核对。
- **`UiSelect` 未被替换**：它有 15 处调用方（含视频创作面板的运营后台隐藏守卫契约），替换它属跨模块重构，不在本次范围。本次只新增领域专用组件并在一处接线。
- **`Accounts.vue` 零改动**：该文件是 `check-max-lines` 的点名还账文件（天花板 1578 行），分组信息由选择器自己从 `usePlatformStore()` 读，视图层一行不增。

## CHANGELOG 条目

# feat(账号): 「添加账号」的平台选择器改为应用内自绘浮层——图标 / 搜索 / 分组 / 键盘全可控（platform-picker-ux）

> 标题末尾按合同写 **record 名（= 分支名）**。
> 本条按 `changelog-record-carrier` 的新合同写在执行记录里，`CHANGELOG.md` 与 `01-docs/learnings.md` **零改动**（那两个是聚合器专属的归档写面）。

- **用户现场**：账号管理页点「+ 添加账号」，展开「平台」下拉时看到的是**操作系统绘制的系统列表**——系统蓝高亮、直角、无平台图标、15 个平台平铺一条、没有搜索也没有分组；列表还从弹窗里「长」出来盖住底部的「打开登录页 / 取消」按钮。用户反馈：「这个 UI 界面非常粗糙，不精致」。
- **第一性原因（不是样式问题，是控件选型问题）**：`UiSelect` 用的是原生 `<select>` + `appearance: none`。`appearance: none` 只能去掉**收起态**的原生外观（箭头、边框）；一旦展开，弹出列表由**操作系统**绘制 ⇒ **CSS 完全无法介入**。圆角、配色、图标、分组、搜索、动效全都不归本应用管 —— 这不是「样式没写好」，是「控件选错了」。任何在原生下拉上做的视觉优化都改不动展开态。
- **修复（换成应用内自绘的浮层）**：新增 `AccountPlatformPicker`，展开态完全由本应用绘制——
  - **平台图标**：复用现成的 `PlatformIcon`（15 个平台真实品牌 SVG，无图时回退品牌色首字块），不再是一行行纯文字；
  - **搜索**：按平台显示名与平台 id **双路**匹配（大小写不敏感），`dou` 命中抖音、`XiaoHongShu` 命中小红书；纯空格输入等价于空输入（不误伤「随手打一个空格结果列表全没了」）；
  - **分组**：按平台目录的分类分成「国内平台 / 国际平台」两组（口径与发布页同源），**空组整组不渲染**，不留空标题；
  - **收起态**：显示已选平台的**图标 + 名称**，随时能确认「我现在选的是哪个」；未选时用更浅的占位色（不靠字号区分）；
  - **已选项**：列表里带勾选标记 + 主色底 + 主色文字三重表达，颜色不是唯一信息载体；
  - **键盘全可达**：`role="combobox"` + `role="listbox"` + `aria-activedescendant`；↑↓ 移动、Enter 选中、Esc 收起并把焦点交还触发器；下方空间不足时**向上翻转**，浮层宽度与触发器对齐。
- **顺带修掉三处观感问题**（真实渲染出图后逐条对照）：① 搜索框焦点环原是「描边叠在边框上」的粗重双层紫环 ⇒ 改为与既有 `UiSelect` 同口径的「主色边框 + 14% 柔光环」；② 浮层最大高度 320px 时只能露出 5 个平台 ⇒ 提到 420px（可见 8 个，其余滚动）；③ 浮层宽度取 320 会比触发器宽出一截、右边缘对不齐 ⇒ 取 300，在本仓 360px 弹窗里恰好等于触发器宽度；另把「鼠标点开时预置首项高亮」改为「**不预置**（不出现『鼠标并不在那儿却像被悬停』的幽灵高亮），已选平台则作为激活项，让用户看到『我现在在哪个平台上』」。
- **连带把一个死组件接上线**：`PlatformIcon.vue` 自 2026-10-19 起挂在「未接线组件」欠账清单上（生产面零引用），本 PR 复用它 ⇒ 欠账清单对应条目销账（清单只能缩小）。复用现成的 15 平台图标实现，比在新组件里再造一份图标表更少漂移。
- **分组口径的一处结构缺口**：平台目录的分类值是中文「中文 / 海外」，UI 层若直接拿它比字符串，就得在渲染端代码里写中文字面量（本仓 `locale-sync --cjk` 门禁对新增硬编码中文零容忍）。故在 `stores/platforms.js` 新增 `getCategoryGroup(id)`，把分类翻成 `domestic` / `international` 结构键 —— **中文值只留在 store 与 locale 两处**，新的调用方不会再写第二份。
- **回归保护**：新增 `AccountPlatformPicker.test.js` **22 例**（展开/收起、显示名过滤、id 过滤且大小写不敏感、纯空格等价空输入、两种空态、点击选项 emit 并收起、已选项勾选态、键盘上下移动与边界不循环、Esc、点击外部、焦点回收、重复 id 去重、缺失 label 回退、禁用态、无幽灵高亮、激活项落已选平台）；`stores/platforms.test.js` 新增 2 例；`AccountLoginDialog.test.js` 更新 stub 并新增 1 例。视觉侧新增 `accounts-platform-picker` 工作流（开弹窗 → 展开浮层 → 搜索 → Esc → 关弹窗 → 复位），覆盖交互级回归。
- **如实留白**：**「浮层展开态」的像素基线尚未建立** —— 本仓基线必须与 CI 同一次渲染逐像素相等（Gate 7b 判 0 px），本机截图当基线被明确禁止；且视图注册表是路由级的，渲染不出「浮层已展开」这个交互态。本 PR 补的是**交互层**保护，像素基线留作后续一刀（给视觉套件补一条带 `prepare` 钩子的用例，由 CI 产出同源渲染后再落 PNG）。

## learnings

### lesson: 原生控件的展开态是操作系统的画布，「调样式」这件事本身就走错了路（platform-picker-ux）

**现场**：用户说「添加账号时弹出的选择平台的浮层，UI 界面非常粗糙，不精致」。

**第一直觉的错误**：去改 `UiSelect` 的 CSS —— 加圆角、调配色、换高亮色。但 `appearance: none` 只作用于**收起态**；一旦展开，弹出列表由操作系统绘制，**CSS 一行都管不到**。也就是说，这道题在原生控件形态下**没有解**。

**可迁移的判据**：遇到「某个下拉/菜单看起来很糙」时，先问一句「**它展开后还是不是 DOM**」。
- 展开后是 DOM（自绘浮层、popover、listbox）⇒ 视觉可改，直接动手。
- 展开后是操作系统窗口（原生 `<select>`、原生 `<input type=date>`、原生右键菜单）⇒ 视觉**不可改**，唯一的路是**换控件**，而换控件之前要先看清它的调用方与契约（本仓 `UiSelect` 有 15 处调用方，含运营后台隐藏守卫）。

**为什么这件事值得写下来**：仓库里有一条门禁专门盯「未接线组件」（`scripts/check-ui-wired.js`），它会告诉你「建好但没人用的组件」是缺陷。但它盯的是**接不接得上**，不盯**该不该用这个控件** —— 「用了一个视觉不可控的通用控件」在这条门禁下完全隐形：组件接得好好的，测试也全绿，只有用户在真机上看见那个系统蓝下拉。

**同一类缺口在别处的形状**：本仓的平台分类（国内/海外）一直在 `platformStore.getCategory` 里，发布页也一直在用，而账号页**从未消费**它 —— 数据在、界面不用，与「控件选错」是同一族缺口：**能力已备，接线缺失**。本次补的 `getCategoryGroup` 之所以要翻成结构键，也是同一族：中文分类值让「按分类分组」这件事在渲染端无法不写硬编码中文，于是每个调用方都只能绕开分组功能。
