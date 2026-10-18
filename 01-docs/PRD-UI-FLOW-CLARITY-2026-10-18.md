# PRD：应用操作流程与结果归属清晰度治理（UI Flow Clarity）

| 项 | 内容 |
|------|------|
| 文档版本 | v1.6（2026-10-18 四轮后：自纠 A1-A4/E1 + 第一轮双轴 6×C + 第二轮双轴 3×C + 第三轮降级自查 E3-1~E3-5） |
| 状态 | 待评审（S0 契约阶段；**S1 风险等级已由「低」上调为「高」——不是纯删减，含新建 UI 与不可达风险**） |
| 评审记录 | `.ccg/reviews/ui-flow-clarity-review.md`（含修正依据与双模型未取得说明） |
| 文档类型 | 信息架构 / 交互流程契约 |
| 变更类型 | 流程契约 + 前端 UI 收敛（分期实施，首批为纯删减与重指向） |
| 关联规格 | `docs/frontend-interaction-spec.md` §6.3（模块导航栏）、§9（路由入口登记规则）；`docs/desktop-ui-layout-spec.md` §1.1（总体布局框架）、§3（模块导航栏） |
| 关联代码 | `apps/desktop/src/config/route-registry.js`、`apps/desktop/src/layouts/MpModuleNav.vue`、`apps/desktop/src/App.vue`、`apps/desktop/src/views/Publish.vue`、`apps/desktop/src/views/PublishHistory.vue`、`apps/desktop/src/views/CreateView.vue`、`apps/desktop/src/views/ResultView.vue`、`apps/desktop/src/views/RewriteView.vue`、`apps/desktop/src/views/HotTopics.vue`、`apps/desktop/src/views/Collection.vue`、`apps/desktop/src/components/PublishProgressPanel.vue`、`apps/desktop/src/components/PipelineBackgroundToast.vue`、`apps/desktop/electron/services/first-run.js` |

---

## 1. 背景与问题

### 1.1 总述

当前应用的操作流程存在**结构性混乱**，集中体现在两处：**操作结果的归属不清**（一次保存/发布/跳转后，产物去了哪里、有几份副本、去哪找回）、以及**操作后的流程断裂**（后台任务、审批门、引导流程缺少常驻出口）。

经对 30 条路由、19 项一级菜单、4 个核心流转页的实证梳理，定位到 **10 个具体困惑现场**（见 1.2）。这些现场不是孤立的页面缺陷，而是三条结构性根因叠加的结果：

1. **同一个"东西"有多个入口，每个入口的归属规则不同**（发布 / 草稿 / 视频项目 / 文案库）；
2. **跨页状态机由 query 参数承载，且各页消费时机不一致**，导致交接语义随页面漂移；
3. **三层外壳（TabBar+NavBar / MpModuleNav / MpSidebar）语义重叠**，叠加暗路由与失效的首跑引导，用户失去"我在哪、从哪来、结果在哪"的空间感。

### 1.2 十个困惑现场（证据）

| # | 现场 | 证据 | 用户困惑 |
|---|------|------|----------|
| 1 | 侧边栏「发布」菜单指向发布**记录**页，而「新建发布」藏在左上角 `+` 按钮 | `apps/desktop/src/config/route-registry.js:88-90` 注释自陈："菜单「发布」目前指向 /publish/history（语义错位，由 T1 处理）"；`apps/desktop/src/layouts/MpSidebar.vue:250-252` `goToPublish()` → `/publish` | 点「发布」看到历史列表，找不到新建入口 |
| 2 | 「去发布」实现**分散且统计口径易漏** | 代码存在**两种写法**，只按一种统计必然漏：<br>① **对象形式** `router.push({path:'/publish', query})`：`CreateView.vue:4199`(视频浮层)、`:4557`(历史一键发布)、`ResultView.vue:728`、`HotTopics.vue:817/819`、`Collection.vue:1669`、`Publish.vue:1368/1373`(内部导航)；<br>② **字符串字面量** `router.push('/publish?draft='+id)`：**`Collection.vue` 7 处**（:951/:991/:996/:1662/:1680/:1733/:1807）、`PublishHistory.vue:767/772`、`RewriteView.vue:854`。<br>⚠️ **本文档前两版称"5 处""7 处"均属低估**——只按对象形式统计。**正确口径是按"是否携带 draft/video_path/republish 载荷"判定交接语义，而非按语法形式** | 同一句话，有时被追问"图文还是视频"，有时不追问 |
| 3 | 发布页「创作视频」隐式存一份草稿 | `apps/desktop/src/composables/useCopyDetailMode.js:85-100` `handleCreateVideo()` 先 `saveDraft()` 再 `push('/create?draft=')` | 草稿箱凭空多出一条，与用户主动存的草稿混淆 |
| 4 | 草稿箱有 **4 个**入口、4 份 UI，其中 1 个**当前无业务入口** | `Publish.vue:545`（开启按钮）+ `:570-592`（页内浮层）；`Publish.vue:5-35`（`?tab=drafts` 整页）；`PublishHistory.vue:745-748`（第三个标签）；**`Collection.vue:8` `CollectionDraftsTab` + `:215` `CollectionDraftsPanel`（第 4 处，采集页页签，走同一份 `draftList`）**。`?tab=drafts` 全仓无业务跳转来源，仅测试引用 | 从不同入口进草稿箱，界面与操作完全不同 |
| 5 | 视"保存"为同一动作，但背后 5 种副作用 | 纯草稿（`Publish.vue:542`）；草稿+知识反馈（`RewriteView.vue:787-789`）；草稿+跳转（#3）；草稿+文案库双写（`Collection.vue:1637-1650`）；保存时回写文案库（`useCopyDetailMode.js:63-80`） | 同一种按钮，3 种副作用用户不可见 |
| 6 | 同一行存储被 4 个页面写入，无单一事实源 | `apps/desktop/src/composables/useCollectionDrafts.js:17-19` 自陈"两套方言互相污染"；文案库 `copy_library_rewrites` 另有 3 处写入 | 一条内容存在几份副本，无一处告知 |
| 7 | 视频创作页三层视图 + 自带的"浏览器"，后台任务无常驻出口 | `CreateView.vue:23-27`（三页签）；`CreateView.vue:1962-1991`（自建 `viewHistory` 前进后退栈）；`CreateView.vue:482-513`（进度浮层 4 按钮）；`PipelineBackgroundToast.vue`（居中 toast，`pointer-events:none`，4 秒消失） | 任务转后台后，唯一找回路径是"自己想起去历史记录" |
| 8 | 首跑引导事实上是死的 | `apps/desktop/electron/services/first-run.js:24-44` `runSetup()` 仅写标记文件并广播 done（注释："P2-E: 无需检查浏览器资源，直接标记首次运行完成"）；`route-registry.js:79` 标为暗路由、入口待确认 | 新用户首次打开看到主页，而非引导 |
| 9 | 审批门处理结果无后续 | `ProductionBoard.vue:155-165` `handleGateResolved()` 仅 unshift 一条"审批门已处理"到 `eventLog`，不导航、不提示 run 是否继续 | 批完不知道该等还是该操作 |
| 10 | 「发布」一词在 UI 中承载 4 种语义 | 侧边栏菜单（=记录）、左上角 `+`（=新建）、页面按钮（=立即执行）、`/cloud-publish`「CLI」（=另一种发布通道） | 用户无法单凭文案判断按钮行为 |

补充：三个路由被 `route-registry.js` 自标为**无入口暗路由**——`/first-run`（L79）、`/intelligence`（L232）、`/auto-pipeline`（L322），注释均为"入口待确认"。

### 1.3 根因

| 根因 | 说明 |
|------|------|
| **R1 登记表只管可达性，不管语义一致性** | `route-registry.js` + CI `check-route-registry.js` 校验"有入口"，不校验"入口语义一致"。5 种「去发布」全部合法通过 |
| **R2 query 参数承担跨页状态机，消费点分散** | `Publish.vue` 在 `onMounted`/`onActivated`/2 个 `watch` 分别消费不同参数（L1388-1434）；`CreateView.vue` 在 `mounted` + 2 个 `watch` 消费（L5098-5121）。每加一个交接参数需 3–4 处接线，漏一处即静默失效（`HotTopics.vue:811-814` 即一次事故复盘） |
| **R3 keep-alive 仅缓存 Publish，其余页面重挂载** | `App.vue:75-79` `<keep-alive :include="['Publish']">`。用户对"哪些页面退出不清空"无稳定预期 |
| **R4 结果归属无单一事实源** | 见 #5/#6，写点各自决定同步策略 |

---

## 2. 目标与非目标

### 2.1 目标

1. 建立**一条主线 + 五条规则**的流程契约，作为后续所有流程改动的判据（S0）。
2. 收敛导航层数与草稿箱入口，消除"同一功能多入口多归属"（S1）。
3. 「去发布」实现同构化，消除隐式副作用与冗余选择（S2）。
4. 交接参数收敛，消掉分散接线（S3）。
5. 首次使用体验与后台任务出口收口（S4）。

### 2.2 非目标

- 不改动发布引擎 / 改写引擎 / 流水线引擎的业务逻辑与 IPC 契约。
- 不重构 `CreateView.vue` 超大文件的整体结构（属独立技术债，见 `docs/frontend-deep-review-2026-10-05.md` M-8）。
- 不迁移 `drafts` 的存储结构（仅收敛写点与入口，不改存储格式）。
- 不处理 `/intelligence`、`/auto-pipeline` 的功能归属（仅登记，见 §8 边界）。

---

## 3. 用户故事

- **作为**首次使用应用的用户，**我希望**打开应用就能被引导完成"添加账号 → 首次发布"，**以便**不靠猜测就能走通第一条主线。
- **作为**在改写页点了「去发布」的用户，**我希望**系统不再追问我"图文还是视频"（它已知道我手里是文本），**以便**一步到位进入发布页。
- **作为**点了「创作视频」的用户，**我希望**明确知道这次操作会存一份草稿，或在需要时再自行保存，**以便**草稿箱里的每一条都是我有意识留下的。
- **作为**把视频任务切到后台的用户，**我希望**有一个常驻入口能随时回到该任务，**以便**不必记住"去历史记录里找"。
- **作为**打开草稿箱的用户，**我希望**无论从哪个入口进来，看到的都是同一个草稿箱，**以便**不必重新学习界面。

---

## 4. 心智模型与流程契约（本文档核心）

### 4.1 一条主线

```
找选题 → 写/改文案 → 定载体（图文 / 视频）→ 选平台账号 → 发布 → 看结果
   ↓          ↓             ↓                 ↓           ↓        ↓
HotTopics   Rewrite      Create            Publish    进度面板  /publish/history
Collection
```

**关键认知：这条主线上的每一站，用户需要理解的"产出物"只有三类，且各有明确落点：**

| 产出物 | 落点 | 是否持久化 | 用户可见入口 |
|--------|------|-----------|--------------|
| **素材**（采集到的原文） | `collected_items` | 是（采集记录） | 采集页、文案库（读时合成） |
| **草稿**（改写结果 / 发布前暂存） | `drafts` | 是 | 草稿箱 `/publish?tab=drafts` |
| **视频项目** | settings `story2video_projects_v1` + 磁盘 `userData/story2video-projects` | 是 | 视频创作历史 `/create?view=history` |
| **改写文案（副本）** | `copy_library_rewrites`，上限 **200**（触顶静默丢弃，见规则 1） | 是 | 文案库 |

> **命名澄清**：`story2videoProject` 是 IPC/context 里的**对象名**（挂在 `run.context.story2videoProject`，见 `pipeline-engine.js:2181`），
> **不是存储键名**——真实持久化键为上表所列。心智模型表不要当存储契约引用。
> 另：`/create?view=history` 读的是 **run 记录 + project 列表**两条来源，并非直接读该 settings key。

关于文案库（`useCopyLibrary`）——它是**混合模型，不能笼统说成索引**：

- 采集正文**不复制存储**：列表读时由 `collected_items` 实时合成（`useCopyLibrary.js:5-7`）；
- 改写文案**是独立持久化**的：`copy_library_rewrites`，上限 200 条、按用户隔离，且已有 M-5 并发串行队列防护（`:8-17`、`:32-47`）。

> ⚠️ **已修正（2026-10-18 对抗性评审 A2）**：初稿写"文案库是草稿的只读索引，不是第二份存储"。
> **反证**：改写文案确实持久化在 `copy_library_rewrites`（上限 200），是真实第二份存储，不是索引。
> 因此"一条内容有几份副本"这个问题必须正面回答，而不是靠改写心智模型绕开。

### 4.2 五条规则（执行契约）

> 以下五条为**强制条款**，新增任何流程/入口/按钮前必须逐条自检；违反需在 PR 中显式说明理由。

#### 规则 1：一个动作 = 一个结果 = 一个可见归属

每次用户点击"保存 / 确定 / 发布"，必须能在**同一界面**看到"它现在在哪、叫什么、怎么回去"。

- 禁止隐式副作用：不得在用户未感知的情况下写入第二份存储；
- 任何"后台继续"的任务必须提供**常驻且可点击**的返回入口，禁止仅依赖定时消失的 toast；
- **任何有上限的存储，触顶时必须给用户可见提示，禁止静默截断**（2026-10-18 评审补）：
  现状 `useCopyLibrary.js:29` `MAX_COPY_REWRITES = 200`，`upsertRewrite` 落库时 `[record, ...kept].slice(0, 200)`
  （`:172`）会让第 201 条改写**无声消失**，与本条正面冲突。
  > ⚠️ **落地层次（第三轮更正我 D2 的过度悲观判断）**：`upsertRewrite` 内部虽是 try/catch 静默
  > （`:176-178`），但 **`notifyWarning` 是即时副作用**——调用点（如 `useCopyDetailMode.js:77`）的
  > `catch {}` 只吞异常、**不吞已发出的通知**。故提示**直接加在 `upsertRewrite` 内部**（`:150-182`，
  > 在 `slice` 之前比较 `kept.length` 与 `MAX`）即可，**无需改三个调用点的错误处理**。
  > 唯一前提：该函数需新增 `useNotify` 依赖（当前 `:19-20` 只 import `ref` 与 store API）。
  > 但**返回值仍需改造**：调用点无法从 `null` 区分"失败"与"触顶丢弃"，故应返回可感知信号
  > （如 `{ record, evicted: n }`），供需要精确处理的调用点使用。

#### 规则 2：同一语义的按钮必须同构

- **是否需要选图文/视频由载荷自决定**，禁止让用户做系统早已知晓答案的选择；
- 但"同构"指**分流契约明确**，不是"合并成一个函数调用"。两条路径各自固定：
  - **视频路径** → `buildPublishFromProject → publishDataToQuery`，产出 `?type=video&video_path=...`；
  - **图文路径** → `?draft=<id>`（**不带 `type`**，由 `Publish.vue:790-794` 的 `publishType` 兜底为 `article`）。
- 流水线选择从"去发布"路径上移除（发布不需要知道用哪条流水线）。

> ⚠️ **已修正（2026-10-18 对抗性评审 A1）**：初稿曾写"统一走 `buildPublishFromProject → publishDataToQuery`"。
> **反证**：该函数硬编码 `type: 'video'`（`publish-from-project.js:75` 与 `:91`），而图文路径靠 `?draft=` 不带 type 兜底为 article。
> 若强行统一，图文会被误判为视频——比现状更糟。图为"该函数是**视频项目**提取器"（文件名与 `:75` 均已表明），不能承载图文。

#### 规则 3：草稿箱唯一化

- 全仓仅保留**一个**草稿箱视图：`/publish?tab=drafts` 整页模式；
- 删除一切页内草稿浮层与第三处草稿标签；
- 侧边栏「发布」指向 `/publish`（新建发布），发布记录走 `/publish/history`——修正 `route-registry.js:88` 自陈的语义错位。

#### 规则 4：交接参数收敛

**收敛范围**：`?draft=` / `?drafts=` / `?video_path=` → **`?draft=<id>` + `?mode=article|video`**。

> ⚠️ **`?republish=` 移出收敛范围，保留原参数**（2026-10-18 评审 Warning-3）：
> 它不是"草稿交接"，而是**发布记录快照回放**——走 `historyGetRepublishSnapshot` IPC，有独立快照存储、
> `appliedIds` 幂等键、快照缺失时 `republishMissing` 分支（`usePublishRepublish.js:16-17/:42`），
> **不产生也不需要 draft id**。强行收敛需"读快照→临时落草稿→传 draftId"，凭空多一份草稿，
> 直接违反**规则 1「禁止隐式副作用 / 不得写入第二份存储」**，并打破 §3「草稿箱每条都是有意识留下的」。
> 同理 `?video_path=` 是文件路径、`?draft=` 是草稿 id，本体不同——二者收敛需先定义落盘时机（见 §7）。

- 批量交接（如热门选题 N 条）先落成一个批草稿组，再传组 id；
- 所有消费点收敛到单一 composable（`CreateView` / `Publish` 共用），消掉现有 4 处（Publish）+ 3 处（CreateView）分散接线。

#### 规则 5：外壳降为两层，语义互不重叠

| 层 | 职责 | 铁律 |
|----|------|------|
| TabBar + NavBar | 多标签 / 网页态（浏览器标签、登录标签） | 首页标签下 NavBar 必须**看起来就是只读的**，不得伪装成可用地址栏 |
| MpSidebar | 全部 SPA 页面导航 | 一级导航只放主线 5 站，其余进「更多」 |
| MpModuleNav | **删除** | 该组件仅在主页域（自指单标签）与账号域渲染，存在本身即混乱源 |

---

## 5. 功能逻辑（分阶段实现规格）

### S1：导航收敛（纯删减 + 重指向，最低风险）

| 项 | 规格 | 落点 |
|----|------|------|
| **主窗口**删除 `MpModuleNav` | 仅删除 `App.vue:63` 的 `<MpModuleNav v-if="isHomeTab" />`（主窗口分支） | `App.vue:63` |
| ⚠️ **`Accounts.vue:825` 会清空整个 query** | `openFavoriteGroup`（`Accounts.vue:823-826`）用 `router.replace({ path:'/accounts', query:{} })` 把**整个 query 清空**。用户在「收藏分组」tab 内点开任一组，就会被踢回 `accountTab` 默认值 `'accounts'`（`:541`）且无提示——**验收 2b 在收藏分组路径上不可满足**。<br>**规格**：先把 `:825` 改为 `router.replace({ query:{ tab:'favorites' } })`（或保留既有 tab 值），再建 tablist | `Accounts.vue:823-826` |
| ⚠️ 新 tab 行与既有 tablist 的**隔离** | `Accounts.vue:77` **已存在**一个 `role="tablist"`（登录状态筛选器，绑 `onFilterKeydown`，`:88-89`）。新 tab 行若同样套 `class="filter-tabs"`，会出现**两个 tablist、两套键盘处理器**。<br>**规格**：新 tab 行复用 `.filter-tabs` 样式但须带**独立 `aria-label`**（如 `accountsPage.moduleTabsAria`）、键盘处理器命名为 `onModuleTabKeydown`（与 `onFilterKeydown` 区分）；并核实 `:1454` 的 `flex:0 0 auto` 不会让新 tab 行在窄屏不换行 | `Accounts.vue:77-93`、`:1454` |
| ⚠️ **keep-alive 表述需修正**（`§8`） | 初版写「其余页面维持重挂载取最新」，但这条**只对路由路径变化成立**。tab 切换是**同路由内只改 query**，Vue Router 复用实例、**不触发 `onMounted`**（`Accounts` 不在 `App.vue:76` 的 keep-alive include 里，同样不重挂载）→ `loadGroups`/`refresh` **不会重复触发**。若某 tab 需进入时才取数，须**显式 watch `accountTab`** 补一次加载，不得依赖"重挂载取最新" | §8 边界表 |
| ⚠️ `accountTab` 需白名单兜底 | `accountTab`（`Accounts.vue:541`）为 `String(route.query?.tab || 'accounts')`，**无白名单**。新建 tablist 后若用户手改 URL 为非法值，会渲染空白面板（现状 `MpModuleNav` 的 `isTabActive` 只认 4 个已知 key，非法值下 tab 全不高亮但面板走 v-else 兜底）。**规格**：加白名单，非法值回落 `'accounts'` | `Accounts.vue:541` |
| ⚠️ groups 未就绪的骨架 | `Accounts.vue:131` 直接渲染 `AccountGroupsPanel`，`groupsStatus` 只处理非 ok 三态，**无"加载中"分支**；groups 仅在 `onMounted` 加载一次（`:1250`）。**规格**：groups 未就绪时按 `UiSkeleton variant="list"` 渲染 | `Accounts.vue:131`、`:1250` |
| ⚠️ **账号页 tab 必须先建后删**（顺序不可颠倒） | `Accounts.vue` **只有 `accountTab` 的读取**（L541 只读 computed 自 `route.query?.tab`），**全文件无任何改写 `?tab=` 的控件**（`router.push`/`setAccountTab` 零命中；唯一写 query 处 L825 是清空）。tab 切换 **100% 依赖 `MpModuleNav.vue:36-41` 的 router-link**。若先删组件，除「账号管理」外的 tab **完全不可达**，`accountTab` 恒为 `'accounts'`。<br>**执行顺序**：① 先在 `Accounts.vue` 新增页内 tablist（`role="tablist"` + **3 个** `role="tab"`〔按 §14 裁决 #4，分享链接已下线〕，点击 `router.push({ query:{ tab: key } })`，补 Arrow/Home/End 键盘导航）；② 再删组件 | `Accounts.vue`（新增页内 tablist）、`MpModuleNav.vue:36-41`（删除方） |
| ⚠️ **内嵌主页壳态导航**（结论已定，见下） | **关键事实（已读代码确认）**：`MpModuleNav.vue` **零 props**，`tabs` 只由 `route.path` 计算（`:50-59`）——**主窗口与壳态在相同路由下行为完全一致**。<br>故 `homeTabs`（`:46-48`）只是一个**自指单标签**（`to:'/'`，而当前路由就是 `/`），**无任何导航能力**。<br>**✅ 结论（新增方案 d，优于原三选项）**：**S1 把账号 tab 移进 `Accounts.vue` 后，`MpModuleNav` 对主窗口与壳态都已无用途**——accounts 域由页内 tablist 承担（`Accounts.vue` 渲染在壳态的 `router-view` 内，同样生效）；home 域是自指空壳；publish 域本就 `tabs=[]`。<br>**执行**：① 删除组件文件；② `App.vue:63` 与 `:15-23` **两处引用一并删除**；③ `tab-independent-home.test.js:48` 的 `expect(shellBlock).toMatch(/MpModuleNav/)` 改为**断言壳态不含任何导航 chrome**（与 `:50-52` 已有的 `not.toMatch` 同向）；④ 壳态导航能力写入 §8 边界：**页内 tab（accounts 域）+ 主窗口侧边栏 IPC（`home-shell-navigate`）**，无独立页内导航 | `App.vue:63`、`App.vue:15-23`、`tab-independent-home.test.js:41-52` |
| ⚠️ 上一行的**原理澄清**（避免实施者走错） | 初版我曾写「壳态本来就不显示 `homeTabs`」——**错**。组件零 props 且只看 `route.path`，壳态在 `/` 时**同样渲染 `homeTabs`**。这一点必须澄清，否则实施者会误以为"置空 `homeTabs` 只影响主窗口" | `MpModuleNav.vue:50-59` |
| 侧边栏「发布」重指向 | `route-registry.js` 中 `/publish/history` 的 `navEntry`(key `publish`) 迁移到 `/publish`（key 保持不变，运营中心种子不变）；`/publish/history` 转为 `internal:true` + `entryFrom:'/publish'`，**且必须同时 `navEntry: null`**（`check-route-registry.js:325-326` 判二者互斥，否则 CI 红） | `route-registry.js:97-104`（`/publish`）、L86-96（`/publish/history`） |
| 草稿箱**视图**唯一化（含第 4 处） | 删除 `Publish.vue:545`（开启按钮）+ `Publish.vue:570-592`（浮层本体）；删除 `PublishHistory.vue:745-748` 草稿标签；**同时处置采集页第 4 处**：`Collection.vue:8` `CollectionDraftsTab` + `:215` `CollectionDraftsPanel`（走同一份 `draftList`）。保留 `/publish?tab=drafts` 整页 | `Publish.vue:545/570-592`、`PublishHistory.vue`、`Collection.vue:8/215` |
| ⚠️ 上项的**事件契约迁移**（否则功能倒退） | 采集页 panel 通过 `@publish/@edit/@create` 回调 `Collection.vue` 的 `goPublish(:994)`/`editDraft(:989)`；而 `/publish?tab=drafts` 整页（`Publish.vue:29-31`）**只有 `editDraft` + `removeDraft`，没有"发布"出口**。若按 (a) 改为入口按钮，**"发布"按钮消失**属功能倒退。<br>**处置**：整页草稿箱必须补齐「去发布」出口（`router.replace` 指向 `/publish?draft=<id>`，复用 `Publish.vue:1373` `editDraft` 同族写法）；若选 (b) 复用组件，须明确 `CollectionDraftsTab` **一并删除**（否则仍有 2 个入口，与验收 4 冲突） | `Publish.vue:22-34`（补发布出口）、`Collection.vue:8`（删页签） |
| ⚠️ 草稿箱回归锁的**可实现判据** | 见 §9 验收 4 修正——**不得**用「grep『草稿箱』/`draftsTitle` ≤1」（4 个渲染点用 3 个不同 locale key，且中文串全仓 71 命中含大量注释/i18n 定义，必然误伤）。改用**组件级白名单 + 结构化判据**：命中"调用 `draftList`/`draftSave`/`useCollectionDrafts`"或"含 `data-testid` 匹配 `/drafts-(page|panel|list|tab)/`"的文件集合 === 白名单；显式排除 `locales/**`、`*.test.js`、注释行 | 新增 `drafts-render-points.test.js` |
| ⚠️ **补建草稿箱业务入口**（必需，否则零入口） | 上表删掉的 `Publish.vue:545` 按钮（`showDraftList = true; loadDrafts()`）是**生产链路唯一能开草稿列表的入口**，`?tab=drafts` 整页当前无业务来源（§1.2 #4）。故 S1 必须**显式补一个入口**，二选一：(a) 把 L545 按钮改为 `router.replace({ path:'/publish', query:{ tab:'drafts' } })`（复用 `Publish.vue:1367` `goToPublish` 同族写法）；(b) 侧边栏新增「草稿箱」项指向该路由 | `Publish.vue:545`（改造）或 `route-registry.js`（新增） |
| ⚠️ **`showDraftList` 还有两处驱动点（文档初版漏了）** | 删按钮 + 删浮层**不足以**清掉 `showDraftList`——它还被**另外两处**写入：<br>① `watch(publishTab)`（`Publish.vue:1335-1342`）：`value === 'drafts'` 时 `showDraftList.value = true` + `await loadDrafts()`；<br>② `onMounted`（`Publish.vue:1390-1393`）：同样 `showDraftList.value = true` + `loadDrafts()`。<br>若只删 UI 不删这两处 ⇒ **留下写一个已不存在状态的死代码**。<br>**规格**：两处**只删 `showDraftList` 赋值、保留 `loadDrafts()`**（整页草稿箱仍需它填 `drafts`）；并补第三条——`onActivated`（`:1425-1434`）**当前未处理 `?tab=drafts`**，keep-alive 命中同值时不会重新加载，需补一次 `if (publishTab.value === 'drafts') loadDrafts()` | `Publish.vue:1335-1342`、`:1390-1393`、`:1425-1434` |
| 回归保护 | `MpModuleNav.test.js` 整体删除（组件已删）；`Publish.test.js` / `PublishHistory.test.js` 中草稿相关用例迁移到整页草稿箱用例 | 测试文件 |

> **key 稳定性约束**：`SIDEBAR_MENU_KEY_ORDER` 中的 key 与 `ops-center/backend/services/app_menu_service.py` 的 `CATALOG` 为主键，**重命名即运营侧配置失效**。本步只改 `to` 指向，不改 key。

### S2：「去发布」同构化

| 项 | 规格 | 落点 |
|----|------|------|
| 统一实现（**按交接语义收敛，勿按语法形式统计**） | 按 §4.2 规则 2 分流：图文 → `?draft=<id>`；视频 → `buildPublishFromProject → publishDataToQuery`。<br>⚠️ **代码有两种写法**（对象形式 + 字符串字面量 `'/publish?draft='+id`），统计与改造**必须同时覆盖两种**，否则必然漏（`Collection.vue` 7 处字符串写法是重灾区）。<br>**建议加机械锁**：断言全仓 `router.push(` 中匹配 `/(?:path:\s*['"]\/(?:publish|create)['"]|['"]\/(?:publish|create)\?draft=)/` 的调用点数量 === 登记表声明数 | 见 §1.2 #2 清单 |
| `pipeline` 参数处置 | 删弹窗后 `Collection.vue:1666` 的 `pipeline=story2video-compose` 兜底值必须显式化：要么去掉该 query 由 `CreateView` 默认选，要么保留并在按钮文案披露。**不得静默回退**（与 `PublishDestinationModal.vue:108-110` 同款隐性行为） | `Collection.vue:1666-1670` |
| 消除隐式存草稿（**已裁决：改文案明示，不移除副作用**） | 按 §14 裁决 #2：`handleCreateVideo()` 的 `saveDraft()` 前置**保留**；仅把按钮文案由「创作视频」改为「**保存草稿并创作视频**」。依据：草稿本身有价值（用户可能中途回来），问题只在**不告知** | `useCopyDetailMode.js:85-100`（**不改**）、`publishPage.createVideo`（改文案） |
| ⚠️ **「已存草稿」披露必须迁移**（不得随弹窗删除） | 弹窗 `subtitle`（`PublishDestinationModal.vue:85`「改写内容已存入草稿箱，请选择下一步操作」）是**全应用唯一**告知用户"去发布已替你存了一份草稿"的文案；而 `RewriteView.goToPublish`(L809-823) 与 `Collection.goPublishAfterRewrite`(L1636-1657) **仍会先 `saveDraft()` 再跳转**。删弹窗 = 删掉唯一的副作用披露 UI，**与规则 1「禁止隐式副作用」正面冲突**——把困惑从"被迫选一次"换成"完全不知情"。**处置**：二选一并写进落点——(a) 跳转后在 `/publish` 顶部渲染 `role="status"` 提示（`CopyDetailBanner` **视觉形态** + 新 locale key）；(b) 按钮文案改为「存入草稿并去发布」 | `Publish.vue`（新增 banner）或 `publishPage.createVideo` 文案 |
| ⚠️ 上项的**实现边界（第三轮精确化）** | `CopyDetailBanner.vue` 是**零 props 硬编码单文案**组件——文案写死 `t('copyLibrary.detailModeBanner')`（`:3`）、`data-testid` 写死 `copy-detail-banner`（`:2`），script 段（`:14-19`）**无任何 props**。若在 `Publish.vue:4` 同位置再挂一个，两条提示会**共享同一 `data-testid`**，导致验收 8 无法区分"草稿已保存"与"文案详情态"。<br>另：文案详情态由 **sessionStorage 读后即焚**载荷驱动（`copy-detail-handoff.js:45-55`），而 `applyCopyDetailHandoff` 在 `onMounted`(`:1389`) 与 `onActivated`(`:1427`) **各调一次**——两条提示若共用该载荷通道会**互相 take 掉**。<br>**规格**：① 复用其**视觉样式**但组件须**新增 props**（`:message-key` / `:test-id`），或新建 `DraftSavedBanner.vue`；**禁止共享 `data-testid`**；② 「草稿已保存」走 **query**（如 `?draftSaved=1`）而非 sessionStorage，**不得写入 `COPY_DETAIL_HANDOFF_KEY`**；③ 验收 8 补反向断言：两个 banner 的 `data-testid` 不同，同时触发时并存且文案各自正确 | 新建组件；`Publish.vue:4` 旁新增 |
| 流水线选择移除 | `PublishDestinationModal` 删除流水线下拉（含 `-- 选择流水线 --` 空选项；当前选中空值时 `chooseVideo` 静默回退 `story2video-compose`，属隐性行为） | `PublishDestinationModal.vue:55-70`、`L108-110` |
| 文案统一 | 文案由 locale 承担，移除 `PublishDestinationModal` 内的硬编码中文（当前违反渲染端 CJK 基线） | `PublishDestinationModal.vue:84-93` |

### S3：交接参数收敛（技术底座，保障 S2 不腐化）

| 项 | 规格 | 落点 |
|----|------|------|
| 新增 `useRouteHandoff()` | 单一 composable，统一消费 `?draft=` + `?mode=`；`Publish.vue` / `CreateView.vue` 共用 | 新建 `apps/desktop/src/composables/useRouteHandoff.js` |
| 批量交接改造 | 热门选题 N 条 → 先落批草稿组，传组 id（替代 `?drafts=id,id`） | `HotTopics.vue:815-819`、`useHotTopicsDraftHandoff.js` |
| 消掉分散接线 | 删除 `Publish.vue` 的 `onMounted`(L1388-1418)/`onActivated`(L1425-1434)/2 个 `watch`(L1342-1346、L1356) 分散消费；删除 `CreateView.vue` 的 `mounted` + 2 个 `watch` | `Publish.vue:1388-1434`、`CreateView.vue:5098-5121` |
| ⚠️ **职责边界（必须写明）** | `useRouteHandoff` **只消费** `?draft=` / `?mode=`（及旧 `?drafts=`/`?video_path=` 重定向）；**`?republish=` 由 `usePublishRepublish.watchRepublishQuery` 独立消费**（该 watcher 仍在，`usePublishRepublish.js:141-146`，由 `Publish.vue:1356` 调用，不会因移出收敛而失活）。`useRouteHandoff` 入口 normalize 必须**白名单透传 `republish`**，**不得 `replace` 掉**。<br>⚠️ 「原样透传」措辞与代码事实不符：`usePublishRepublish.js:125` 在载入成功后会**主动把 `republish` 从地址栏清掉**（`editorQuery()` 只返回 `{tab:'publish', ...extra, type?}`）。故正确表述是「**不被 `useRouteHandoff` 收敛，由 `usePublishRepublish` 独立消费并在载入后自行清理地址栏**」 | 新建 `composables/useRouteHandoff.js`（入口 normalize 段） |
| ⚠️ **`?draft=` 与 `?republish=` 同时出现的优先级** | 二者**共用同一份字段映射**（`applyPublishSnapshot`，`publish-snapshot.js:89`；草稿走 `usePublishDrafts.js:112-126`，republish 走 `usePublishRepublish.js:113`）。现状互斥**只写在 `Publish.vue:1409-1414` 的 `onMounted` 一处**；`onActivated`（`:1433`）**无守卫**直接 `void applyRepublishFromQuery()`，且两个 watcher（`Publish.vue:1344-1348` 与 `usePublishRepublish.js:142`）**各自独立** → URL 同时带两者时会**后到者静默覆盖先到者已写入的表单**。<br>**规格**：以 **`?draft=` 为准**（用户当下的手工选择优先），该互斥必须在 `useRouteHandoff` 入口**一次性裁定**，**不允许两个 watcher 各自判断** | `useRouteHandoff.js` 入口裁定点 |
| 保留幂等契约 | `usePublishRepublish` 的 `appliedIds`、`useHotTopicsDraftHandoff` 的 `handoffAppliedKey` 幂等语义必须保留，不得因重构丢失 | 既有测试 |

### S4：首次使用与后台任务出口

| 项 | 规格 | 落点 |
|----|------|------|
| 首跑引导恢复或下线 | **二选一需产品决策**：(a) 恢复真实职责（账号 → 发布 两步），主进程恢复引导触发；(b) 在 `route-registry.js` 中显式登记为有入口路由并挂到首次启动。禁止维持"代码在、入口无"的现状 | `electron/services/first-run.js`、`route-registry.js:79` |
| 账号前置可见 | 无账号时，主页 hero 卡与 `Publish.vue` 顶部直接给「添加账号」出口（复用 `usePublishAddAccountTargets`，从选择器内兜底提升为页级） | `Home.vue:28-43`、`Publish.vue:518-533` |
| 小红书约束前置 | `xhs-draft-only-hint` 从"勾选后提示"提前到"勾选前可见" | `Publish.vue:536-539` |
| ⚠️ 后台任务常驻入口 —— **先做通道判定** | 现状已有**两条**通道：视频流水线走 `PipelineBackgroundToast`（4 秒），发布任务走 App 级 `PublishProgressPanel`（`App.vue:90`，展开浮卡 ↔ 最小化胶囊，首次收纳有 `ElMessage`）。**"后台任务"一词同时覆盖二者**。S4 须先判定并写进文档：视频后台任务是**复用** `PublishProgressPanel` 胶囊形态（登记为 session），还是**新建**独立胶囊？**严禁不判定就造第三套进度反馈形态**（正是本文反对的"同一语义多实现"）。若复用，则 `PipelineBackgroundToast` 只保留 4 秒即时反馈、不常驻化 | `App.vue:88-90`、`PublishProgressPanel.vue`、`PipelineBackgroundToast.vue` |
| 审批门后续 | `handleGateResolved` 增加明确后续。⚠️ 现状**并非完全无反馈**——`eventLog` 渲染在页面侧栏可见区（`ProductionBoard.vue:52`、`:57-60`）。真实缺口是"事件可见但缺 run 状态与下一步动作"。故应**基于既有 `eventLog` 增强**（unshift 的事件带 run 状态 + "查看进度"动作入口），而非另起一套提示机制 | `ProductionBoard.vue:155-165` |

> **通道判定结论（代码已能确定，不留"先判定"）**：
> 视频流水线任务只有 `runId`（`useHotTopicsGenVideo.js:69`，来自 `pipelineStartOrchestrated`），**无 `taskIds`/`batchId`**
> → `registerSession` 在 `publishProgress.js:243` 直接 **`return null`**；
> 且视频事件走 `onPipelineUpdate`（`publisher.js:213`，载荷为 `{runId,status,context}`），
> **无 `taskId`/`platform`** → 进 store 会被 `handleProgressEvent`（`publishProgress.js:141-147`）的非法事件守卫**整条丢弃**。
> **故"直接复用 `registerSession`"在现有会话模型下不成立。** 二选一：
> - **(a) 扩展 store**：新增 `registerRunSession({runId,title})` + `handlePipelineEvent`，并放宽 `handleProgressEvent` 的 taskId/platform 硬门槛（成本较高）；
> - **(b) 新建独立常驻胶囊**（推荐，与视频事件模型同构）——`data-testid` 固定为 `persistent-video-task-pill`。

> **澄清**：`usePublishProgressAutoCollapse` 的 5 秒自动收敛是**收成胶囊**而非消失，与规则 1「禁止仅依赖定时消失的 toast」**不冲突**——实施时勿误以为要取消该收敛。

> **澄清**：`usePublishProgressAutoCollapse` 的 5 秒自动收敛是**收成胶囊**而非消失，与规则 1「禁止仅依赖定时消失的 toast」**不冲突**——实施时勿误以为要取消该收敛。

---

## 6. 显示项与提示文字

| 场景 | 文案要求 | 落点 |
|------|----------|------|
| 创作视频 | **已裁决（§14 #2）**：文案改为「**保存草稿并创作视频**」，行为不变 | `publishPage.createVideo`（zh/en 成对） |
| 去发布 | 不再出现「选择发布去向 / 直接发图文 / 生成视频」二选一；`PublishDestinationModal` 的硬编码中文全部转 locale | 删除相关文案键 |
| 后台脱离 | 常驻入口文案需含可操作语义（如"查看进度"），而非仅"任务已转入后台运行" | `common.pipelineBackgroundToast` + 新键 |
| 审批门 | 处理后需明确告知 run 状态 | 新键 |
| 首跑引导 | 恢复时改为两步（账号 → 发布），移除已失效的"环境检测"步骤 | `onboarding.*` |
| **已存草稿披露**（S2 新增） | 弹窗移除后，「改写内容已存入草稿箱」必须迁移到落地位置：`role="status"` + 固定 `data-testid` 提示节点，或按钮改「存入草稿并去发布」 | 新 locale key |
| ~~分享链接禁用原因~~ **（已取消，§14 #4 裁决下线）** | 该 tab 整块删除（`Accounts.vue:121-127`），页面不再存在该 `disabled` 按钮，故 a11y 补齐**不需要做** | — |
| **首跑引导下线**（S4，已裁决） | 删除后须保证：① 无任何路由指向 `/first-run`；② `first-run-done` 标记的写入**保留下线**（避免老用户被判定为"未完成"）；③ 相关 locale key 一并清理 | `onboarding.*` 清理 |

> **i18n 约束**：新增用户可见文案一律写入 locales（zh/en 成对）；渲染端非 locales 文件新增中文字符串由 CI `check-locale-sync.js --cjk` 拦截——`PublishDestinationModal` 当前的硬编码中文即属违规，S2 一并修正。

### 6.1 新增加载面 → 骨架屏 variant 映射（补 `frontend-interaction-spec.md` §8）

> 该节被初版遗漏，但本次改动有多处新增加载面，不约定 variant 极易各自自造骨架（§8.1 明令禁止自造 `@keyframes *shimmer*`）。

| 新增加载面 | variant | 说明 |
|-----------|---------|------|
| 账号页内 tab 切换后的分组/收藏面板 | `list` 或 `card` | 纵向条目列表按 §8.2 取 3~5 |
| S4 后台任务常驻入口 | **不用骨架** | 按 §8.2 末行「按钮内提交中不用骨架」，用 loading 文案 |
| 首跑引导恢复（若选方案 a） | `paragraph` | 步骤型内容 |
| 整页草稿箱 `/publish?tab=drafts` | `list` `:count=3` | **现状已合规**（`Publish.vue:16`），保持不变 |

一律复用 `UiSkeleton.vue`，由 `UiSkeleton.contract.test.js` 的 8 条契约兜底。

### 6.2 窄屏规格（修正初版误判）

初版写「删除 `MpModuleNav` 后发布域窄屏无额外分支」——**只对一半**：发布域本就不渲染（确为零影响），但**账号域受影响**。

- `MpModuleNav.vue:132-155` 有专门的 `@media (max-width:700px)`（padding 收至 14px、tab 行 `overflow-x:auto` 横滚、隐藏滚动条、高度 -8px）。删组件后这段能力消失；
- `Accounts.vue` 自身断点为 900/1360/1100/720（L1431/L1440/L1483-1489），与新 tab 行无对齐关系。

**规格**：新页内 tab 行在 `max-width: 900px` 下复用 `.filter-tabs`(L1489) 的 `max-width:100% + overflow-x:auto` 横滚方案，**禁止**等分压缩导致中文文案截断。

---

## 7. 数据校验

- **S1**：无表单/接口/存储变更。路由重指向后，`/publish` 与 `/publish/history` 的可见性对调需同步 `sidebar-menu.test.js` 的 `EXPECTED_DERIVED_MENU` 冻结基线。
  - ⚠️ **多宿主需机械锁**：`/publish/history` 转 `internal:true` 后 `entryFrom` 只能填单值 `/publish`，会**丢失"Home 也能进"**这一事实（与本文根因 R1 同型复发）；仅写在注释里**无锁**（注释不被任何判据读取）。
    **规格（二选一给落点）**：(a) 新增断言「全仓跳 `/publish/history` 的调用点集合 ⊆ 登记表登记宿主集合」，用源码 grep + 注释解析实现（与 `usePublishFlow.test.js` 源码契约测试同型）；(b) 把 `entryFrom` 语义扩展为数组（需同步改 `check-route-registry.js:340` 的 `registryByPath.has` 判定）。
- **S2**：`buildPublishFromProject` / `publishDataToQuery` 的字段映射不得新增或删减；**二者硬编码 `type:'video'`，仅服务视频路径**；图文路径靠 `?draft=` 不带 type、由 `Publish.vue:790-794` 兜底 `article`，判据需单测覆盖。
- **S3**：`drafts` 存储**既有字段语义不变**，但规则 4 的「批草稿组」需在现有 drafts 行上**新增可选 `group_id` 字段**（向后兼容：旧行无该字段即视为独立单篇）。故 §2.2 非目标的「不改存储格式」应改述为「**不改既有字段语义，允许新增可选字段**」，并说明读端兼容。旧 `?drafts=` 深链需**重定向兼容**（读旧参数 → 落组 → 跳新参数），不得静默丢弃。
  - ⚠️ **`group_id` 必须纳入 `draftSave` 指纹输入**：drafts 写入有**指纹幂等**机制（`Collection.vue:1623-1624` 注释「id 由主进程 draftSave 的指纹幂等决定，命中即复用原 id」），而 `computeDraftFingerprint` **只算标题正文**（`useCollectionDrafts.js:22-26`，已记录"同内容两份草稿互相合并覆盖"的既有事故）。**规格**：`group_id` 纳入指纹 + 单测断言「同标题正文、不同 `group_id` → 两条独立草稿」；旧行无 `group_id` 时按空值参与，保证历史草稿 id 不被重算。
  - ⚠️ **规则 1「触顶提示」触发面须含新增写点**：「批量落组」与「旧深链重定向落组」都是新增写点，不得只覆盖单篇 `upsertRewrite`。
  - ⚠️ **组行呈现契约需明确**（否则与 §1.2 #6 脱节）：批组在唯一草稿箱里是**折叠为一条**（单篇仍可单独编辑）还是**展开为 N 条**，须写进 §6 显示项表。
- **S4**：首跑引导恢复需保证 `first-run-done` 标记语义一致，避免老用户被强制重走引导。**方案 (a) 还需重构 `first-run:status` 的 step 事件协议**（当前主进程只发 done/error，不发 step；`FirstRun.vue:31-64` 的 Step1「环境检测」前后端均已废弃），工作量高于"改文案去掉一步"。

---

## 8. 状态与边界

| 边界 | 行为 |
|------|------|
| keep-alive | `Publish.vue` 缓存语义不变（草稿不丢）；其余页面维持重挂载取最新 |
| 深链兼容 | 旧 `?drafts=` / `?republish=` / `?video_path=` 深链在 S3 后需能重定向到新参数，或显式提示失效 |
| 运营中心菜单 | `SIDEBAR_MENU_KEY_ORDER` key 集合不变；改 `to` 指向需同步 `ops-center` 契约说明 |
| 暗路由 | `/intelligence`、`/auto-pipeline` 本次不处理，维持 `entryFrom:'/'` + "入口待确认"登记；`/first-run` 由 S4 决策 |
| 窄屏 / reduced-motion | 删除 `MpModuleNav` 后发布域窄屏无额外分支；后台常驻入口需遵循 `prefers-reduced-motion` 关闭动效 |

---

## 9. 验收标准

**S1**
1. 侧边栏「发布」点击后进入新建发布页 `/publish`；发布记录经 `/publish/history` 可达（发布页内入口保留）。
2. **主窗口**首页与发布域路由下 `MpModuleNav` 的 DOM 不存在（`[data-testid="mp-module-nav"]` 查询为空）。
   > 初版后半句「页面无该层 70px 占位」**不可测，已移除**：70px 来自 CSS 变量 `--mp-nav-height` 的 `min-height`（`MpModuleNav.vue:75/:96`），vitest/jsdom 不计算布局高度；且组件 `tabs.length===0` 时本就整行不渲染（`:2` `v-if`），DOM 不存在即无占位，后半句属同义反复。改由**视觉回归基线（QM-4）**断言首屏顶边位移，与 §10「首页/账号域基线需重建」措辞对齐。
   > **内嵌主页壳态**（`?mp-home-shell=1`）导航按独立决策项处置——保留则 `tab-independent-home.test.js:48` 断言同步更新，不得因删组件而红。
2b. **账号页 tab 不经 URL 直接点击可达**（防 S1 删组件后 tab 恒为 `accounts`）。
   - **可测形式（初版写法不可测，已修正）**：初版写「点击后断言 `route.query.tab` 正确」——**测不了**。
     `Accounts.test.js:66-68` 把 `vue-router` mock 为 `useRoute: () => _routeState` + `useRouter: () => ({ replace: vi.fn() })`，
     **只有 `replace`、没有 `push`**，且 `mount` 未装 router 插件（`global.plugins` 仅 `[createPinia(), i18n]`）。
     故：① 新 tablist 若用 `router.push` 会直接 **`router.push is not a function`**；② 点 `_routeState` 是普通对象，点击不会真的改变它。
   - **改为三层断言**：(i) **DOM**：tablist 渲染 N 个 `role="tab"`，`aria-selected` 与当前 `_routeState.query.tab` 一致；
     (ii) **调用**：把 mock 扩为 `{ push: vi.fn(), replace: vi.fn() }`，点击后断言 `push` 被调用且入参为 `{ query: { tab: '<key>' } }`；
     (iii) **渲染**：设 `_routeState.query.tab = 'groups'` 后 `await nextTick()`，断言分组面板渲染。
   - 另需一条 e2e（真实路由）断言「不经手改 URL 可达分组管理」，与上述单测互补。
3. 账号页 **3 个** tab（账号管理 / 分组管理 / 收藏分组）激活态正确（「分享链接」已按 §14 #4 下线，页面不存在该 tab 与禁用按钮）；`MpModuleNav.test.js:56-61` 的账号 tab 激活态契约**迁移**至 `Accounts.test.js`，不得整体删除。
4. 全仓仅剩 `/publish?tab=drafts` **一个草稿箱渲染点**（含采集页 `CollectionDraftsPanel` 已改为入口按钮或组件复用）；**且存在至少一个业务入口可到达**。
   - **回归锁（组件级白名单，非字符串计数）**：新增 `drafts-render-points.test.js`，扫全仓 `.vue`，
     断言命中下列**结构化判据**的文件集合 === 白名单：
     ① 调用 `draftList` / `draftSave` / `usePublishDrafts` / `useCollectionDrafts`；
     ② 含 `data-testid` 匹配 `/drafts-(page|panel|list|tab)/`；
     ③ 含 `role="tabpanel"` 且 `aria-label` 走 `collection.draftsTitle` / `publishPage.draftsTitle`。
     白名单收敛后应只剩 `views/Publish.vue`；**显式排除** `locales/**`、`*.test.js`、注释行。
   > ⚠️ 初版写「全仓『草稿箱』/`draftsTitle` 渲染点 ≤1」**不可实现且必然误伤**：
   > 4 个渲染点用的是 **3 个不同 locale key**（`publishPage.draftsTitle` / `historyPage.tabDrafts` / `collection.draftsTitle`），
   > 无任何单一字符串可覆盖；且中文串"草稿箱"全仓 **71 命中**（大量注释、测试描述、i18n 值）。
   > `draftsTitle` 仅在 zh/en locale 各出现一次就已违反"≤1"。
4b. **整页草稿箱每条草稿存在「去发布」出口**（指向 `/publish?draft=<id>`），不得只有"继续编辑/删除"——
   否则从采集页进入后"发布"按钮消失，属功能倒退（见 S1 落点）。
5. `node .github/scripts/check-route-registry.js` 输出 `[route-registry] PASS`（含 `/publish/history` 转 `internal:true` 后 `navEntry` 已置 null）。
6. 新增的整页草稿箱用例**显式断言 `/publish?tab=drafts`**，不得复用 `Publish.test.js` 的 `/?tab=drafts` 根路由夹具（该夹具非生产 URL）。

**S2**
7. **双路径各自只有一个实现点**（按 §4.2 规则 2，不得写成"统一经 `publishDataToQuery`"）：**图文路径**统一收敛到 `?draft=<id>`（**不经** `publishDataToQuery`）；**视频路径**统一经 `buildPublishFromProject → publishDataToQuery`。`PublishDestinationModal` 不再要求用户选择图文/视频。
   - 配套反向守卫：`publish-from-project.test.js` 增加「图文载荷不得进入 `publishDataToQuery`」断言，防止后续为"统一"把图文塞回去。
8. **「已存草稿」披露必须落地**（不得随弹窗一起消失）：点「去发布」/「创作视频」后，须存在一条可见的「草稿已保存」提示节点（`role="status"` + 固定 `data-testid`，复用 `CopyDetailBanner` 形态 + 新 locale key），或按钮文案改为「存入草稿并去发布」。**禁止静默存草稿**（详见 S2 落点）。
9. **「创作视频」文案已明示**（§14 #2 裁决）：按钮文案为「保存草稿并创作视频」；`useCopyDetailMode.js` 的 `saveDraft()` 行为**保持不变**（不要求"不新增条目"，因为副作用被保留且已披露）。
10. `PublishDestinationModal` 内无硬编码中文（CI `--cjk` 通过）。

**S3**
11. **`?draft=` / `?mode=` 及旧深链**的消费收敛到 `useRouteHandoff()` 单一入口（`?republish=` **除外**，见验收 12）。
12. 旧深链 `?drafts=` / `?video_path=` 在 `useRouteHandoff` 入口 normalize 后重定向到新参数；**`?republish=` 不被 `useRouteHandoff` 收敛**，由 `usePublishRepublish` 独立消费并在载入后自行清理地址栏（`usePublishRepublish.js:125`）。`useRouteHandoff` 入口须白名单透传 `republish`，不得 replace。
    - 初版写「原样透传」与代码事实不符（该参数会被主动清理）且**与验收 11 字面打架**——按 11 会把 republish 收进单一入口（正是第一轮要避免的），按 12 则 11 不成立。已按职责边界改写。
13. 幂等契约测试（`appliedIds`、`handoffAppliedKey`）全部保留并通过；**且 `?draft=X&republish=Y` 时只有草稿被装载、`appliedIds` 不消耗 Y**（优先级裁定点唯一，在 `useRouteHandoff` 入口）。

**S4**
14. 首跑引导在 `route-registry.js` 中 `internal` 与 `entryFrom` 的取值**等于 §14 决策 #1 的结论**，且存在一条断言该结论的测试（消除"要么可达要么下线"的不可证伪表述）。
15. 后台任务在 4 秒 toast 消失后，仍可通过 **`data-testid="persistent-video-task-pill"`**（按 S4 判定选 (b)）或扩展后的 `PublishProgressPanel` 胶囊返回——**不再写"由判定结论给出"**（判据已由代码确定，见 §5-S4）。
16. 审批门处理后渲染 `data-testid="gate-resolved-run-status"` 的 `role="status"` 节点，文案来自 locale 且**包含 run 当前状态枚举之一**。
17. **文案库触顶提示可断言**：`useCopyLibrary.test.js` 增加——触顶时 `notifyWarning` 被调用一次且文案来自新 locale key `copyLibrary.rewriteLimitReached`，丢弃记录数 = 1。
    > ⚠️ **既有用例会锁住旧行为**：`useCopyLibrary.test.js:169-178`「超过上限时丢弃最旧记录」断言的正是
    > **静默丢弃**（被规则 1 判定为违规）。修完后该用例**仍会绿**，等于用一条通过的测试锁住旧行为。
    > **必须同步改写**，不得保留只断言静默丢弃的版本。
    > **层次澄清**（与我 D2 自查的纠偏）：`notifyWarning` 是**即时副作用**，调用点的 `try/catch` 只吞异常、
    > **不吞已发出的通知**。故提示**加在 `upsertRewrite` 内部**（`useCopyLibrary.js:150-182`，`slice` 之前比较
    > `kept.length` 与 `MAX`）即可，**无需改三个调用点的错误处理**（我 D2 说"两层都静默"过于悲观，此处更正）。
    > 前提：该函数需新增 `useNotify` 依赖（当前 `:19-20` 只 import `ref` 与 store API）。

---

## 10. 影响面与风险

| 影响点 | 说明 | 处置 |
|--------|------|------|
| 运营中心菜单配置 | 侧边栏「发布」`to` 指向变更；key 不变，但运营侧既有排序/显隐配置语义需复核 | PR 中说明对运营侧的影响；`sidebar-menu.test.js` 基线同步 |
| 视觉基线 | `MpModuleNav` 删除后，首页/账号域页面整体下移 70px；发布域本就在基线中不渲染（ipc-mock 空态 `isHomeTab===false`） | 首页/账号域基线需重建；发布域零影响 |
| ⚠️ 发布记录页**高亮变更**（新增影响） | `MpSidebar.vue:244-248` `isActive` 用 `path === item.to \|\| path.startsWith(item.to + '/')`。`to` 由 `/publish/history` 改为 `/publish` 后，**`/publish/history` 会被判为「发布菜单激活」**——这是修复了高亮丢失（期望行为），但属**新增**视觉差异 | 发布记录页视觉基线需同步重建，不得沿用"发布域零影响"的旧判断 |
| ⚠️ 新建按钮与发布菜单**功能重合** | `MpSidebar.vue:250` `goToPublish()` 已是 `onNavClick('/publish')`，重指向后与菜单 `to` 完全同路：左上角 `+`「新建发布」与侧边栏「发布」指向同一路由 | 需产品决策是否撤掉其一；§1.2 #10「『发布』承载 4 种语义」在修正 #1 后会**转移**至此，不因 S1 消失 |
| e2e 流程 | `MpModuleNav.test.js` 中发布域用例（:65-83）与主页用例（:85-91）随组件删除；**账号 tab 激活态契约（:56-61）须迁移**至 `Accounts.test.js` | 迁移而非删除 |
| ⚠️ 账号域 tab 并入实为**新建 UI** | `Accounts.vue:541` 虽有 `accountTab` computed 与 4 个分支（:4/:121/:132/:157），但页内**没有**对应的导航 tablist（:77 唯一 `role="tablist"` 属 `statusAria` 状态筛选器，非模块导航） | 该子项由"纯删减"重新分级为"新建 UI"，工作量与风险需重估 |
| GUI 冒烟 | `tests/electron-gui-v9.js` 在 `/accounts` 断言模块导航 | 改为断言页内 tab |
| 深链兼容 | S3 参数收敛后旧深链失效风险 | 保留重定向层 + 单测 |
| ⚠️ **视觉契约测试**（第二轮补） | `collection-visual-case-contract.test.js` 断言采集页草稿箱页签/panel 的 testid 存在；采集页第 4 处处置后该断言失效，且它属 **QM-4 视觉契约**范畴 | 随第 4 处处置重建基线；`Collection.test.js:1620` 页签数量断言同步（5→4） |
| 首跑引导 | 恢复引导可能影响老用户（已有 `first-run-done` 标记者不应重走） | 保持标记语义；仅对无标记用户生效 |

---

## 11. 回归保护测试

| 阶段 | 测试落点 | 断言要点 |
|------|----------|----------|
| S1 | 删除 `apps/desktop/src/layouts/MpModuleNav.test.js`；新增 `App.module-nav-removed.test.js` | 各路由下 `[data-testid="mp-module-nav"]` 不存在 |
| S1 | `apps/desktop/src/config/sidebar-menu.test.js` | `EXPECTED_DERIVED_MENU` 基线随 `to` 变更同步更新并冻结 |
| S1 | `apps/desktop/src/views/Publish.test.js` / `PublishHistory.test.js` | 草稿列表仅在 `/publish?tab=drafts` 渲染；页内浮层与历史页标签不存在 |
| S1 | 新增 `drafts-render-points.test.js` | 组件级白名单锁（见 §9 验收 4）：扫 `.vue` 命中结构化判据的文件集合 === 白名单，排除 `locales/**`、`*.test.js`、注释行 |
| ⚠️ S1 | **漏列的 5 处既有测试需同步**（第二轮补） | ① `App.sidebar-collapse.test.js:60`、② `publish-draft-keepalive.test.js:79`、③ `publish-tab-state-keepalive.test.js:93`：三处 stub 清单含 `MpModuleNav`，删组件后 stub 项成孤儿；④ `Collection.test.js:1620` 断言"五个"页签，采集页第 4 处收敛后应为 4；⑤ **`collection-visual-case-contract.test.js:39/45`** 断言 `collection-drafts-panel` 页签/面板 testid 存在——**属视觉契约测试，直接影响 QM-4 基线，风险高于普通单测** |
| S2 | 新增 `features/publish/publish-from-project.test.js` 补充用例 | 载荷自决定 mode：有 `video_path` → video |
| S2 | `apps/desktop/src/composables/useCopyDetailMode.test.js` | 「创作视频」不再产生草稿（或文案已明示） |
| S3 | 新增 `apps/desktop/src/composables/useRouteHandoff.test.js` | 参数收敛、旧深链重定向、幂等保留 |
| S4 | `apps/desktop/src/components/PipelineBackgroundToast.test.js` 扩展 | 常驻入口存在且可点击 |
| 全程 | `node .github/scripts/check-route-registry.js` | PASS |

---

## 12. 推进计划

按"先立契约、再收入口、最后拆代码"排序，每阶段可独立验收：

| 阶段 | 内容 | 依赖 | 风险 |
|------|------|------|------|
| **S0** | 本文档（流程契约）评审通过并合入 | — | 低 |
| **S1a** | **账号页页内 tablist**（新建 UI）+ 先修 `Accounts.vue:825` 清 query + `accountTab` 白名单 + 键盘导航 + 窄屏 + §10.3 a11y | S0 | **中**（纯新建，不动删除路径，可独立验证） |
| **S1b** | **删 `MpModuleNav`**（组件文件 + `App.vue:63` + `App.vue:15-23` 两处引用）+ 同步改 `tab-independent-home.test.js:48` | **S1a 必须先合入** | **中高**（删后不可回退到"页内 tab 未就绪"状态） |
| **S1c** | **草稿箱唯一化**（删浮层+按钮+历史页标签+采集页页签；清 `showDraftList` 两处驱动；补业务入口；整页补"去发布"出口） | 与 S1a/S1b 无交集，可并行 | **中高**（含功能倒退风险：发布出口缺失） |
| **S1d** | 侧边栏「发布」重指向 + `/publish/history` 转 internal | 与 S1c 同为 `route-registry.js`，**须串行** | 低 |
| **S2** | 「去发布」双路径收敛（**按交接语义统计，非 7 处**）、「已存草稿」披露迁移、消隐式存草稿 | S0 | 中高（触达点含归因链） |
| **S3** | 交接参数收敛 + `useRouteHandoff` + 深链重定向层 | S2 | 中（技术债，保障 S2 不腐化） |
| **S4** | 首跑引导决策（含 step 事件协议）、后台常驻入口通道判定、审批门后续 | S0 | 中高（需产品决策 + 主进程协议改动） |

> **S1 必须再拆（第三轮降级自查结论）**：初版把 S1 当一个 PR，实际它有 **14 行落点、8 个 ⚠️ 风险项**，
> 且内部有**严格先后依赖**（先建 tablist 才能删组件；先修 `:825` 才能建 tablist）。
> 一次合入时若任一环出错，**无法判断是"新建没做好"还是"删除做错了"**。拆成 S1a/S1b/S1c/S1d 后每格都可独立验证、独立回滚。
> **S1a 与 S1b 不可颠倒**：S1a 未合入就删组件 ⇒ 账号 tab 完全不可达（前端轴 Critical-1）。

> **S1 与 S4 不再建议并行**：S1 风险上调为"高"后，其失败模式（tab 不可达、内嵌主页失导航）需要单独验证窗口；
> 且二者都要动 `App.vue` 附近的挂载结构，并行易互相掩盖回归。改为 **S1 全部合入、验证通过后再做 S4**。
> S3 仍应在 S2 之后，避免重复接线改造。

---

## 13. 发布与回滚

- **发布**：随常规桌面端版本分批发；S1 无数据迁移、无配置开关；S3 涉及深链重定向需保留兼容层至少一个版本。
- **回滚**：各阶段均为独立 PR，revert 对应 PR 即可恢复。S3 回滚需保留旧参数读取路径（否则旧深链失效）。

---

## 14. 待决策项 —— **已全部裁决（2026-10-19）**

> 状态：**APPROVED**。以下 5 项由项目负责人裁决，本版起按裁决结论执行，不再作为开放问题。

| # | 决策项 | **裁决结论** | 影响 |
|---|--------|-------------|------|
| 1 | 首跑引导 | **下线（方案 b）** | 删除 `FirstRun.vue`、路由 `/first-run`、`route-registry.js:77-85` 登记、`first-run.js` 的 `runSetup()` 与 IPC；清理 tests 中 ≥10 处 `/first-run` 引用。**不做**恢复，首次体验由 `Home.vue` 空态承担 |
| 2 | 「创作视频」隐式存草稿 | **保留存草稿行为，改文案明示** | `publishPage.createVideo` 文案改为「保存草稿并创作视频」；`useCopyDetailMode.js:85-100` 的 `saveDraft()` 与 `syncCopyDetailToLibrary()` **行为不变**，只改可见文案。**不移除**副作用（草稿有保留价值，问题只在不告知） |
| 3 | `/intelligence`、`/auto-pipeline` | **维持登记，本次不动** | 无代码变更；`route-registry.js` 保持现状（`internal:true` + `entryFrom`） |
| 4 | 「分享链接」tab | **下线** | 账号域 tab 由 **4 个变为 3 个**（账号管理 / 分组管理 / 收藏分组）；删除 `Accounts.vue:121-127` 整块 + `accountTab === 'share'` 分支；§6「分享链接禁用原因」a11y 落点**取消**；§9 验收 2b/3 的「4 个 tab」→ **3 个** |
| 5 | 内嵌主页壳态导航 | **方案 (d)：直接删除 `MpModuleNav`** | 依据：组件零 props、`tabs` 仅由 `route.path` 计算 ⇒ S1 把账号 tab 移入页内后，主窗口与壳态均已无用途。删除组件文件 + `App.vue:63` + `App.vue:15-23` 两处引用；`tab-independent-home.test.js:48` 改为断言壳态**不含**导航 chrome；壳态导航能力写入 §8（页内 tab + `home-shell-navigate` IPC） |

### 14.1 裁决后的连锁变更清单（实施时必须同步）

| 受影响项 | 原值 | 新值 |
|---------|------|------|
| 账号域 tab 数 | 4 | **3** |
| `Accounts.vue` tab 分支 | 4 个（accounts/groups/share/favorites） | **3 个**（accounts/groups/favorites） |
| §6 a11y「分享链接禁用原因」 | 必做 | **取消**（整块删除，无禁用按钮） |
| `tab-independent-home.test.js:48` | 断言含 `MpModuleNav` | 断言**不含**任何导航 chrome |
| `publishPage.createVideo` 文案 | 「创作视频」 | **「保存草稿并创作视频」** |
| `/first-run` 路由与组件 | 存在（暗路由） | **删除** |
| 首跑相关 test 引用 | ≥10 处 | **全部清理** |

---

## 15. 实施记录（2026-10-19）

> 分支 `ui-flow-clarity`，隔离 worktree `D:/Data/projects/mp-worktrees/mp-ui-flow-clarity`。

### 15.1 已完成

| 阶段 | 状态 | 关键产出 |
|------|------|---------|
| **S1a** | ✅ 已实现 | `Accounts.vue` 页内 tablist（3 tab）+ white-list 兜底 + 键盘取模导航 + 窄屏横滚；删「分享链接」整块（4 locale 键 + 占位面板 + 死 CSS + 未用图标）；`openFavoriteGroup` 不再清空 query；v-if 链改为显式三分支。测试 126 项 |
| **S1b** | ✅ 已实现 | 删 `layouts/MpModuleNav.vue` + 其 106 行测试；`App.vue` 两处引用（主窗口 / 壳态）+ import 一并删；清 3 处孤儿 stub；`tab-independent-home.test.js` 断言方向反转 + 新增「组件不得复活」跨文件结构锁 |
| **S1c** | ✅ 已实现 | 草稿箱 5 处 UI → 唯一整页。删发布页浮层、发布记录页草稿标签（含整条 tablist）、采集页 `CollectionDraftsPanel`、死组件 `PublishDraftList.vue`；补整页「去发布」出口 + `onActivated` drafts 分支；清 `showDraftList` 三处驱动。测试 Publish 110 / History 90 / Collection 117 |
| **S1d** | ✅ 已实现 | 菜单「发布」由 `/publish/history` 改指 `/publish`（key 不变）；`/publish/history` 转 `internal:true` + `navEntry:null` + `entryFrom:'/publish'`；新增 `route-registry-entry-hosts.test.js`（4 例）把「多宿主」从注释变成机械锁 |
| **S2（部分）** | ✅ 已实现 | 创作视频文案明示（§14 #2）；`PublishDestinationModal` 补 `role="status"` + `data-testid` 披露节点；该组件全部硬编码中文改接 locale（补 `pipelineEmptyOption`）；流水线空选项 `disabled` 消除静默回落。新增 7 例测试 |

### 15.2 落地时发现与文档不符之处（**这些是本文档最有价值的部分**）

| # | 文档原写法 | 实际事实 | 处置 |
|---|-----------|---------|------|
| D1 | 壳态选项 (a)「homeTabs 置空只会误伤主窗口」 | `MpModuleNav` **零 props**，`tabs` 只由 `route.path` 算 ⇒ 主窗口与壳态行为**完全一致** | 已改写 §5-S1 并给出**更优方案 (d)**：直接删组件 |
| D2 | 三选一（a/b/c） | 三条都不必要——S1 把账号 tab 移进页面后组件对两个实例都已无用途 | 已替换为方案 (d) |
| D3 | 删草稿浮层 = 删按钮 + 浮层 | `showDraftList` 还被 `watch(publishTab)` 与 `onMounted` **两处**驱动；`onActivated` **完全没有** drafts 分支 | 已补 §5-S1c 规格；实施时三处全清 |
| D4 | 验收 2b「断言 `route.query.tab`」 | `Accounts.test.js:66-68` 把 `useRouter` mock 成只有 `replace`、**无 `push`**，且未装 router 插件 ⇒ 该验收**测不了** | 已改写为三层断言（DOM / push 入参 / 设 query 后渲染） |
| D5 | S1 作为一个 PR | 14 行落点、8 个 ⚠️ 风险项、内部严格先后依赖 | 已拆 S1a/S1b/S1c/S1d 并标注顺序 |
| D6 | 草稿箱 4 处 UI | 实际 **5 处**——`features/publish/components/PublishDraftList.vue` 是第 5 份列表实现，且**全仓零引用**（死代码） | 实施时一并删除 |
| D7 | （未记录） | `PublishDestinationModal` **全部文案硬编码中文**，而 `publishDestination.*` locale 键早已存在却无人使用 ⇒ 英文界面下该弹窗一直显示中文 | 实施时接入 i18n |
| D8 | （未记录） | `Collection.vue` 的 `editDraft` 与 `goPublish` **实现完全相同**（都 push `/publish?draft=<id>`）——规则 1「一个动作=一个结果」的现存违规 | 实施时合并为整页单一出口 |
| D9 | （未记录） | 删除 share 面板后 `v-else-if` 链断裂；且原 `<div v-else>` 挂在 `<p v-if="groups && …">` 那条独立链上，语义上在 groups tab 下也会命中 | 实施时改为显式 `v-else-if="accountTab === 'accounts'"` |
| D10 | S4「首跑下线」= 删组件/路由/登记/IPC + 清理 ≥10 处 test | 全仓 `first-run` 命中 **386 处**：含 preload API（`firstRunCheck`/`onFirstRunStatus`）、`license-access-control.js` 白名单、`access-control.js`、`App.vue` 的 `isFullScreenRoute`、`ipc-manifest.md`、约 40 处视觉配置、2 张基线 PNG | **推翻 §12 的"≥10 处"估计**；S4 单独成 PR，逐项清点后再动 |

### 15.3 未完成（后续 PR）

| 阶段 | 剩余内容 | 原因 |
|------|---------|------|
| **S2 剩余** | 「去发布」双路径**已核实无需改动**（`buildPublishFromProject` 仅服务视频路径，`type:'video'` 硬编码符合设计；图文路径靠 `?draft=` 不带 type 回落 article，两路本就同构） | — |
| **S3** | 交接参数收敛 + `useRouteHandoff` + 深链重定向层 | 依赖 S2 接线完成 |
| **S4** | 首跑引导下线（按 §14 #1 裁决） | 影响面 386 处，须单独 PR 并逐项清点 |
| **暗路由** | `/intelligence`、`/auto-pipeline` 维持登记 | §14 #3 裁决 |

### 15.4 视觉基线

删除 70px 模块导航层会让**主窗口内所有页面**整体上移，S1a 新增的 tablist 又会让账号页局部下移；
故本次 PR 必须同步重建 `apps/desktop/tests/visual-testing/base-screenshots/` 下受影响基线，
否则 `QG Visual`（Gate 7，阈值 6%）必然判红。基线以同源渲染重建，逐张确认差异仅来自本 PR 的布局变更。

