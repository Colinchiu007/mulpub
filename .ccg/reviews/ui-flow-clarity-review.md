# UI 流程清晰度方案 · 对抗性评审记录（2026-10-18）

评审对象：`01-docs/PRD-UI-FLOW-CLARITY-2026-10-18.md`
流程：CCG 双模型并行（codex 后端轴 / gemini 前端轴）+ 主模型独立对抗性自纠
证据等级（沿用项目 `adversarial-review-loop` 口径）：
- **L1 反例**：成立即评审应改口（有代码反证）
- **L2 约束**：既有设计或跨文件事实
- **L3 权衡**：无对错，需产品决策

---

## A. 主模型独立对抗性自纠（不依赖双轴，先自查）

> 这三条是我在写完文档后**回头拿代码核对自己断言**时发现的，其中 A1 是我文档的错误，不是代码的问题。

### A1（Critical，L1）规则 2 的"统一实现"写法不成立 —— **我的错误**

文档 §5-S2 写：「去发布」统一走 `buildPublishFromProject → publishDataToQuery`。

**反证**：这两个函数**硬编码 `type: 'video'`**：

- `apps/desktop/src/features/publish/publish-from-project.js:75` → `return { type: 'video', ... }`
- `apps/desktop/src/features/publish/publish-from-project.js:91` → `const query = { type: 'video', ... }`

而图文路径（改写页 `RewriteView.vue:854`）走的是 `/publish?draft=<id>`，**不带 `type`**，由 `Publish.vue:790-794` 的 `publishType` 兜底为 `article`。

**结论**：若按文档现行写法强行"统一"，改写页图文会被输出成 `type=video`，**把图文误判为视频**——比现状更糟。

**修正**：规则 2 应改为——
- 视频路径：继续用 `buildPublishFromProject → publishDataToQuery`（该函数本就是视频项目提取器，名字也说明了）；
- 图文路径：统一为 `?draft=<id>`（不带 type，由发布页兜底 article）；
- 即"统一"应理解为**分流契约明确**（视频→payload、图文→draft id），而非"合并成一个函数调用"。

### A2（Warning，L1）§4.1 心智模型对文案库的定性不准确

文档写：「文案库是草稿的**只读索引**，不是第二份存储」。

**反证**：`apps/desktop/src/composables/useCopyLibrary.js:5-17` 的存储契约是**混合模型**：
- 采集正文不复制存储（读时由 `collected_items` 合成）——这部分"索引"定性成立；
- **改写文案持久化**在 `copy_library_rewrites`（上限 200 条，按用户隔离）——这是真实存储，不是索引。

且该文件已有 M-5 并发串行队列修复（L32-47），说明写入是真实且需防护的。

**修正**：§4.1 改为「采集正文是素材（读时合成），改写文案是独立持久化的第二份产物（有 200 条上限与并发防护），草稿是发布前的暂存」。

### A3（Info，L2）§1.2 #4 的表述需更精确

文档称 `?tab=drafts` 是"死状态"。核实确认无业务入口（仅 `MpModuleNav.test.js:69`、`Publish.test.js:166/180/190` 引用），断言成立。
但严格说它是**有实现、无入口**，而非"永远走不到"——运营中心若下发含该路径的配置仍可达。措辞改为「当前无业务入口」。

---

### A4（Info，L2）账号页「分享链接」是死入口，文档未点名

核实 `apps/desktop/src/views/Accounts.vue:121-127`：「分享链接」tab 渲染的是 `module-placeholder` + 一个 **`disabled`** 的「创建分享链接」按钮 + 「未接入」状态。即该 tab 是**零能力占位**。

文档 §5-S1 只写了"账号域 4 个 tab 并入 `Accounts.vue` 页内"，未点名其中「分享链接」是死入口。
**S1 执行时应一并决策**：是随 tab 迁移保留（继续占位），还是按 `MpModuleNav` 同类占位被移除的先例（见 `docs/desktop-ui-layout-spec.md` §3.3「为零能力入口提供视觉热区」应移除）一并下线。

> 依据：`desktop-ui-layout-spec.md:246-248` 已确立先例——原右上角 4 个工具入口因"均为占位说明文案"被整体移除，理由是"避免为零能力入口提供视觉热区"。「分享链接」符合同一判据。

---

## B. 已核实成立的文档断言（未被挑翻）

| # | 文档断言 | 核实结果 |
|---|----------|----------|
| 1 | 后台任务 toast 4 秒消失、不可点击 | ✅ 成立：`stores/pipeline-background-toast.js:18-24` `durationMs = 4000` + `setTimeout`；`PipelineBackgroundToast.vue:51` `pointer-events: none` |
| 2 | 发布进度面板完成 5 秒自动收敛 | ✅ 成立：`usePublishProgressAutoCollapse.js:16` `AUTO_COLLAPSE_DELAY_MS = 5000`，L56-69 仅在 hasRunning true→false 跃迁触发 |
| 3 | `/publish?tab=drafts` 无业务入口 | ✅ 成立（见 A3） |
| 4 | 首跑引导主进程只写标记 | ✅ 成立：`electron/services/first-run.js:24-44`，注释「P2-E: 无需检查浏览器资源，直接标记首次运行完成」 |
| 5 | 侧边栏「发布」指向 `/publish/history` 且注释自陈语义错位 | ✅ 成立：`config/route-registry.js:88-90` |
| 6 | `handleCreateVideo` 先 saveDraft 再跳转 | ✅ 成立：`composables/useCopyDetailMode.js:85-100` |

---

## C. 双模型评审结果

### C.1 后端轴（codex）✅ 已取得

> 说明：经 3 次 `--parallel` 调用失败/卡死后改派独立 subagent，后端轴结果**已回传**。
> 前端轴（gemini）因同一工具链问题未取得，见 C.2。

**总体判断**：方向对、证据实，但 **S1「低风险纯删减」定级错误**，踩中两个未识别的硬约束。

| # | 级别 | 问题 | 我的核实 | 处置 |
|---|------|------|----------|------|
| **Critical-1** | 🔴 | 删 `MpModuleNav` 击穿内嵌主页壳态：`App.vue:15-23` 有**第二处**无条件渲染（我只写了 L63 一处），是 WebContentsView 内嵌实例的**唯一导航层**，`tab-independent-home.test.js:48` 有机械断言 | ✅ **成立**（已读 `App.vue:11-23` 确认注释"故意只渲染模块导航+工作区"；确认 `tab-independent-home.test.js:48` 断言） | S1 已拆两格：主窗口删 L63；壳态导航列为**独立决策项**，禁止一刀删文件 |
| **Critical-2** | 🔴 | 草稿箱"三删一留"→生产链路**零入口**：`Publish.vue:545` 是唯一能开草稿列表的按钮，而它正在删除清单里 | ✅ **成立**（已读 `Publish.vue:545` 确认 `@click="showDraftList = true; loadDrafts()"`） | S1 已补"新建草稿箱业务入口"落点（改造 L545 或侧边栏加项） |
| Warning-3 | 🟠 | 规则 4 把 `?republish=` 塞进 `?draft=` 会违反规则 1（快照回放非草稿交接，强行收敛需临时落草稿） | ✅ 逻辑成立 | 规则 4 已把 `?republish=` **移出收敛范围**，保留原参数 |
| Warning-4 | 🟠 | S3"删分散接线"与"旧深链重定向"互相抵消，且重定向层无落点 | ✅ 成立 | S3 已给落点（`useRouteHandoff` 入口 normalize），并承认"接线不减少，只是集中" |
| Warning-5 | 🟠 | 侧边栏重指向改变 `isActive` 命中范围（发布记录页会高亮发布菜单）；且 `+` 按钮与菜单功能重合 | ✅ 成立 | §10 已补两条影响项 |
| Info-6 | 🟡 | "账号域 4 tab 并入"实为**新建 UI**（页内无对应 tablist）；`MpModuleNav.test.js:56-61` 契约应迁移非删除 | ✅ 成立（已核实 `Accounts.vue:77` 唯一 tablist 属状态筛选器） | S1 已重新分级为"新建 UI"；验收标准 3 改为迁移 |
| Info-7 | 🟡 | 主页域 MpModuleNav 是自指空壳，应与账号域真导航分开陈述 | 认可 | 未改文档（表述已足够） |
| Info-8 | 🟡 | 测试夹具 `/?tab=drafts` 非生产 URL，勿照抄 | ✅ 成立 | 验收标准已加第 6 条：显式断言 `/publish?tab=drafts` |

**后端轴 passed（10 条）**：与 B 节核实一致，含 `publish-from-project.js:75/:91` 硬编码 `type:'video'`（印证 A1 修正正确）、侧边栏 key 与 ops-center 耦合属实、`check-route-registry.js:325-326` 判 `navEntry` 与 `internal:true` 互斥（故重指向必须补 `navEntry:null`，已补）。

**最大风险**：S1 若按初稿文字实施，**合入即功能倒退**（内嵌主页失导航 + 草稿箱不可达）。

### C.2 前端轴（gemini / UX）✅ 已取得

> 与 C.1 同：经 3 次 `--parallel` 失败/卡死后改派独立 subagent，结果**已回传**。

**总体判断**：「问题诊断质量明显高于解决方案质量」——§1.2 十个现场、A1/A2 自纠经逐条核实几乎全部属实、行号精确；
但作为**解决方案**有三处结构性缺陷 + a11y 系统性缺口。

| # | 级别 | 问题 | 我的核实 | 处置 |
|---|------|------|----------|------|
| **F-Critical-1** | 🔴 | 账号页 tab **删了就不可达**：`Accounts.vue` 只有 `accountTab` **读取**（L541），全文件无任何改写 `?tab=` 的控件，切换 100% 依赖被删的 `MpModuleNav.vue:36-41` | ✅ **成立**（grep `router.push|accountTab =|setAccountTab` 全文件仅 L541 只读 + L825 清空，无写入） | S1 改为**先建页内 tablist 再删组件**，两步同 PR；新增验收 2b |
| **F-Critical-2** | 🔴 | 草稿箱漏数**第 4 处**：采集页 `Collection.vue:8` `CollectionDraftsTab` + `:215` `CollectionDraftsPanel`，走同一份 `draftList` | ✅ **成立**（grep 确认） | §1.2 #4 改 4 处；S1 落点含采集页；验收 4 加「渲染点 ≤1」回归锁 |
| **F-Critical-3** | 🔴 | 验收 6「统一经 `publishDataToQuery`」与我自己的规则 2（A1）**打架**，照做会把图文误判为视频 | ✅ **成立**（与 A1 同源） | 验收 7 改为双路径表述 + 反向守卫测试 |
| **F-Critical-4** | 🔴 | S2 删弹窗会删掉**唯一**的"已存草稿"披露（`PublishDestinationModal.vue:85`），与规则 1 正面冲突 | ✅ **成立**（已读 L85 确认，且 locales 有对应 key） | S2 补「披露必须迁移」落点；验收 8 新增 |
| W-a11y | 🟠 | 分享链接 `disabled` 违反 `frontend-interaction-spec.md` §10.3 四条（无 title/常驻提示/aria-describedby/locale） | ✅ 成立（A4 已发现，前端轴给了具体修法） | §6 补落点；验收 3 含 §10.3 合规 |
| W-a11y | 🟠 | 漏 §8 骨架屏规则，新增加载面无 variant 约定 | ✅ 成立 | 新增 §6.1 映射表 |
| W-a11y | 🟠 | 窄屏误判：受影响的是**账号域**（`MpModuleNav.vue:132-155` 有 700px 横滚），非发布域 | ✅ 成立 | 新增 §6.2 窄屏规格 |
| W-mental | 🟠 | 文案库上限 200 是**静默 slice**（`useCopyLibrary.js:172`），违反规则 1；且写点未收敛 | ✅ 成立 | 规则 1 增「有上限存储触顶须可见提示」 |
| W-consistency | 🟠 | `/publish/history` 宿主不止 `/publish`（Home 3 处 + Publish 1 处），`entryFrom` 单值会重蹈 R1 | ✅ 成立 | §7 补多宿主说明 + grep 清单要求 |
| W-consistency | 🟠 | S4「后台任务」一词覆盖两条现有通道，不判定会造第三套进度反馈 | ✅ 成立 | S4 加通道判定；澄清 5 秒收敛≠消失 |
| W-verifiability | 🟠 | 验收 7/12/14 用「或」「明确」不可证伪；验收 2 的 70px 在 jsdom 不可测 | ✅ 成立 | 全部改写为可断言形式 |
| W-consistency | 🟠 | 规则 4「批草稿组」与 §2.2「不改存储格式」自相矛盾 | ✅ 成立 | §7 明确为「新增可选 group_id」 |
| Info | 🟡 | 行号偏差（草稿箱按钮是 545 非 544）；`story2videoProject` 是 context 对象名非存储键；首跑恢复需重构 step 事件协议 | 均成立 | 已逐一更正 |

**前端轴 passed（14 条）**：与 B 节 + 后端轴高度重合，含 `pointer-events:none`、5 秒收敛、首跑不可达、分享链接 disabled、`?tab=drafts` 无来源、文案库混合模型、`buildPublishFromProject` 硬编码 `type:'video'`（**交叉印证 A1**）。

**最大体验风险**（前端轴原话）：S2 删弹窗二选一，会"把用户的困惑从『被迫做一次多余选择』换成『完全不知道系统做了什么』"——正是本次评审要警惕的"把混乱从一处挪到另一处"。

### C.3 双轴交叉印证

两条轴**独立**得出并相互印证的结论：
1. `buildPublishFromProject` 硬编码 `type:'video'` → A1 修正正确（我自纠 + 两轴一致）
2. 删 `MpModuleNav` 不是纯删减（后端轴指内嵌壳态，前端轴指账号 tab 不可达，**两个不同角度**）
3. 草稿箱入口问题（后端轴指零入口，前端轴指漏第 4 处，**互补**）

**无一条两轴结论互相矛盾。**

---

## D. 第二轮评审（Round 2）

### D.1 主模型自查（针对"v1.3 的修正本身"）

> 第二轮派了两条子代理轴（方案闭环 / 修正引入回归），结果待回传。
> 等待期间先自查**我自己为修第一轮而新增的内容**是否可落地——结果：**三条中有两条我自己写的东西不可实现/落地不了**。

| # | 自查发现 | 核实证据 | 处置 |
|---|----------|----------|------|
| **D1** | **「渲染点 ≤1」回归锁不可实现**：`draftsTitle` 是 **locale key**，在 `locales/collection/zh.js:327`、`en.js:331`、`locales/publish-page/zh.js:6`、`en.js:6` **必然存在 4 处**（两个命名空间各一份是合理的）。按"grep draftsTitle ≤1"写锁**恒失败** | grep 确认 4 处 | 判据改为：锁定「渲染草稿列表的**组件挂载点**」≤1（`CollectionDraftsPanel`/`PublishDraftList` 在 `views/` 下挂载处），或断言 `draftList()` 调用点收敛到单一 composable |
| **D2** | **「触顶须可见提示」写了等于没写**：`upsertRewrite` 内部**全段 try/catch 静默返回 null**（`useCopyLibrary.js:176-178`），且 `writeChain.then(run, run)`（`:180`）让调用方**拿不到异常**；调用点（如 `useCopyDetailMode.js:77`）又全部 `catch {}` 静默。**两层都静默** | 已读 L150-182 确认 | 规格补：触顶判定须在 `slice` **之前**发生并**返回可感知信号**（如 `{ record, evicted: n }`），由**调用点** `notifyWarning`；禁止只在 composable 内部 try/catch 里提示（会被吞） |
| **D3** | **S4 通道判定缺判据**：`registerSession` 有硬门槛 `if (ids.length === 0 && !hasBatch) return null`（`stores/publishProgress.js:243`），即必须传 `taskIds` 或 `batchId`。而视频流水线任务标识是 `pipelineRunId`，**两者皆非** → 直接复用会**静默返回 null**（不建会话也不报错）。我原稿只写"先判定"，没给判据 | 已读 L238-270 确认 | 补判据：复用须先定义 `pipelineRunId` → `batchId` 映射（或扩展 store 支持 `runId`）并补 `_findAdoptableSessions` 匹配分支；新建须说明与 `PublishProgressPanel` 的**视觉互斥规则**。**不给出二者之一，本项不可实施** |

**这三条的共同特征**：都是我在第一轮"补要求"时**只写了目标、没验证落地路径**——与本文 §1.3 根因 R1「登记表只管可达性、不管语义一致性」是同一种错误，发生在文档自己身上。

### D.2 第二轮 · 闭环审计轴 ✅ 已取得

**总体判断**：「S1–S4 整体比第一轮扎实得多」——第一轮 3 条 Critical 的修正（壳态不可一刀删、账号 tab 先建后删、A1 双路径）**经核实确实闭环**；
但 **S1 仍未真正可落地**，最大未闭合点：**内嵌主页壳态删掉 MpModuleNav 后靠什么导航，文档只写"独立决策项"没有结论**。

| # | 级别 | 问题 | 我的核实 | 处置 |
|---|------|------|----------|------|
| **R2-Critical-1** | 🔴 | 壳态导航的两个选项**自相矛盾**：选"保留并重命名"则 `App.vue:63` 主窗口引用必须同改（同一 import），两者立刻不独立；选"先决策再动"则 S1 带"壳态零导航"中间态合入。且替代通道 `App.vue:406-413` 的 `home-shell-navigate` **只在侧边栏点击时触发**，不提供页内自导航 | ✅ **成立**（已读 `App.vue:406-413` 确认是 IPC 订阅，仅被动接收；`homeTabs` 确为自指单标签） | 改为**三选一必落其一**（homeTabs 置空 / 壳态渲染 MpSidebar / 承认被动跳转写入 §8），并进 §14 决策 #5 |
| **R2-Critical-2** | 🔴 | 「渲染点 ≤1」回归锁**不可实现且必然误伤**：4 个渲染点用 **3 个不同 locale key**；中文串"草稿箱"全仓 **71 命中**（注释/测试/i18n 值）；`draftsTitle` 仅 zh/en 各一次就已违反 ≤1 | ✅ **成立**（与我 D1 自查一致，且给了更完整的反证：71 命中 + 3 个 key） | 改为**组件级白名单 + 结构化判据**（draftList 调用 / testid 正则 / tabpanel aria-label），显式排除 locales 与 test |
| **R2-Critical-3** | 🔴 | 采集页第 4 处**两个选项都未闭合**：改入口按钮会丢"发布"出口（整页草稿箱只有 `editDraft`+`removeDraft`）；复用组件又与"渲染点 ≤1"冲突 | ✅ **成立**（已读 `Publish.vue:29-31` 确认无发布出口） | S1 补硬要求：整页草稿箱**必须补齐「去发布」出口**；选 (b) 须明确 `CollectionDraftsTab` 一并删除；新增验收 4b |
| W-sequencing | 🟠 | 我写"复用 `PublishHistory.vue:750-758` onTabKeydown 模式"——该函数是 **2-tab 硬编码**（`:753`），账号页 4 个 tab 照抄会让 End 跳到第 2 个 | ✅ 成立 | 改为按 tabs 长度通用实现；补 `accountTab` 白名单兜底 + groups 未就绪骨架 |
| W-closure | 🟠 | S2 落点**漏列 Collection.vue 两个出口**（:1659/:1666），而 §1.2 #2 明明把它记为唯一带归因链者；`pipeline=story2video-compose` 兜底未处置 | ✅ 成立 | 补齐 7 处；`pipeline` 参数显式化；归因链加源码契约测试钉住 |
| W-consistency | 🟠 | 规则 3×规则 4 **不打架**（这点我是对的），但 `group_id` 与 **draftSave 指纹幂等**的关系未定义——不纳入指纹则同文不同组互相覆盖（`useCollectionDrafts.js:22-26` 既有事故形态） | ✅ 成立 | §7 补：`group_id` 必须纳入指纹 + 单测；触顶提示触发面含批量落组；组行呈现契约 |
| W-consistency | 🟠 | 多宿主仅写注释**等于无锁**（注释不被判据读取），与 R1 同型复发 | ✅ 成立 | 二选一给落点：源码契约测试断言宿主集合，或 `entryFrom` 扩展为数组 |
| Info | 🟡 | 「分享链接」去留未裁决，而验收 2b/3 写死"4 个 tab"= **默认保留占位** | ✅ 成立 | 进 §14 决策 #4；验收改为 N 个（N 由决策定） |
| Info | 🟡 | 漏列 **5 处会变红的既有测试**，其中 `collection-visual-case-contract.test.js` 属 QM-4 视觉契约，风险高于单测 | ✅ 成立 | §11 补 5 处；§10 补视觉契约基线重建 |

**闭环轴 passed（10 条）**中值得记的两条：
- **「Collection 归因链在双路径收敛后不会丢」**——归因挂草稿落盘（:1641）而非弹窗回调，删弹窗安全（这点是我在文档里没写但实现安全的，评审主动确认了）；
- **规则 3×规则 4 在存储层不打架**（第一轮 W-consistency 已被 §7 解消）。

### D.3 第二轮 · 修正引入回归轴 ✅ 已取得

**总体判断**：「v1.3 的修正整体方向正确，**未发现『合入即功能倒退』级回归**」——但六处修正留下未闭合边界。
**0 Critical / 6 Warning / 2 Info**。

| # | 级别 | 问题 | 我的核实 | 处置 |
|---|------|------|----------|------|
| R2-W1 | 🟠 | **验收 11 vs 12 字面打架**：11 说"交接消费收敛到 useRouteHandoff **单一入口**"，12 说"`?republish=` 原样透传不收敛"——按 11 会把 republish 收进去（正是第一轮要避免的）；按 12 则 11 不成立。且"原样透传"与代码不符：`usePublishRepublish.js:125` 载入成功后**主动把 republish 从地址栏清掉** | ✅ 成立 | §5-S3 补**职责边界**；验收 11/12 改写；措辞改为"不被 useRouteHandoff 收敛，由 usePublishRepublish 独立消费并自行清理" |
| R2-W2 | 🟠 | `?draft=` 与 `?republish=` **共用 `applyPublishSnapshot`**，互斥只写在 `onMounted` 一处；`onActivated`(:1433) 无守卫，且两个 watcher 独立 → 同时带两者时后到者静默覆盖先到者 | ✅ 成立 | §5-S3 补优先级裁定（以 `?draft=` 为准，裁定点唯一）；验收 13 加断言 |
| R2-W3 | 🟠 | **`Accounts.vue:825` 清空整个 query**：`openFavoriteGroup` 用 `router.replace({query:{}})`，用户在收藏分组 tab 内点组会被踢回 `accounts` → 验收 2b 在该路径不可满足 | ✅ 成立 | §5-S1 补：先改 `:825` 保留 tab 值 |
| R2-W4 | 🟠 | `CopyDetailBanner` 是**零 props**（无 props、testid 写死）——无法承载新 locale key / 新 testid；且两条提示会共享 testid、共用 sessionStorage 载荷会互相 take 掉 | ✅ 成立（我已读该组件确认无 props） | §5-S2 精确化：新增 props 或新建组件；走 query 不走 sessionStorage |
| R2-W5 | 🟠 | **S4 通道判定只写"先判定"没给判据**——但代码已能确定：视频任务无 `taskIds`/`batchId` → `registerSession` **return null**；`pipeline:update` 事件无 `taskId`/`platform` → 被 `handleProgressEvent` **整条丢弃** ⇒ 现状不可直接复用 | ✅ 成立（与我的 D3 自查一致，且给了完整证据链） | §5-S4 改为**确定结论** + 二选一落点；验收 15 testid 固定 |
| R2-W6 | 🟠 | 规则 1 触顶提示**无测试落点**，且既有用例 `useCopyLibrary.test.js:169-178` 断言的正是**静默丢弃**（被判违规的行为）——**修完后仍会绿，等于用通过的测试锁旧行为** | ✅ 成立 | §11 补落点；显式注明该既有用例**必须同步改写** |
| Info | 🟡 | 两个 tablist 共存（`Accounts.vue:77` 已有状态筛选器 tablist）；新 tab 行需独立 aria-label 与键盘处理器命名 | 认可 | §5-S1 补隔离规格 |
| Info | 🟡 | §8「其余页面重挂载取最新」**只对路由路径变化成立**；tab 切 query 不重挂载、`loadGroups` 不重跑 | ✅ 成立 | §8 补澄清 |

**回归轴 passed（5 条）中两条纠正了我的判断**：
1. **触顶提示加在 composable 内不会被吞** —— `notifyWarning` 是即时副作用，调用点 `catch {}` 只吞异常、**不吞已发出的通知**。
   我 D2 自查写"两层都静默"**过于悲观**，已在文档更正：直接加在 `upsertRewrite` 内部即可（只需新增 `useNotify` 依赖）。
2. **账号页切 tab 不会触发平台筛选重置、不会中断 groupsStatus** —— 三个 watch 的源均非 `route.query.tab`；`groupsStatus` 非轮询。我 D-B 的担心不成立。

**无需立刻处理的 Critical**：本轮 0 Critical，说明 v1.3 修正未引入倒退级回归。

### D.4 第二轮小结

| 轴 | Critical | Warning | Info | 核心贡献 |
|----|----------|---------|------|----------|
| 闭环审计轴 | 3 | 6 | 2 | 指出 **S1 仍不可落地**（壳态导航无结论、回归锁不可实现、采集页两选项未闭合） |
| 修正引入回归轴 | 0 | 6 | 2 | 证明**修正未引入倒退**，但六处边界未定义；并**纠正我两条自查的过度/不足判断** |

**最重要的一条**：闭环轴的「壳态导航必须给结论」——文档不能留"独立决策项"当答案，已进 §14 决策 #5。
**最有价值的一条纠偏**：回归轴证明触顶提示可直接在 composable 内实现（我原判断过悲观），避免了不必要的调用点改造。

---

## E. 第三轮评审（Round 3）

### E.1 主模型自查：调用点统计口径缺陷（等待轴结果时独立发现）

> 第三轮派了两条子代理轴：S1 可实施性审计 / 盲区补漏。等待期间自查发现一条**统计口径**问题。

| # | 发现 | 证据 | 状态 |
|---|------|------|------|
| **E1** | 文档 §1.2 #2 称「去发布有 **7 处**实现」——这个数字**低估**。我按 `router.push({path:'/publish'})` **对象形式**统计得 7 处，但代码里还有 **11 处字符串字面量**写法 `router.push('/publish?draft=' + id)`：`Collection.vue` 7 处（:951/:991/:996/:1662/:1680/:1733/:1807）、`PublishHistory.vue` 2 处（:767/:772）、`RewriteView.vue` 1 处（:854）。两种写法合计远超 7 | grep 确认：对象形式 14 处（含内部导航）+ 字符串形式 11 处 | **已确认，待盲区轴给出完整清单后统一修正**（不擅自改数字，避免与轴结果冲突） |

> 这条的意义：文档前两轮都在"补齐数量"（5→7），但**统计口径本身错了**——
> 只按一种写法统计，必然漏掉另一种。这也解释了为什么第一轮报 5 处、第二轮补到 7 处仍可能不准。
> 正确做法应是**按"交接语义"统计**（是否携带 draft/video_path/republish 载荷），而非按语法形式。

### E.2 第三轮子代理轴（1 失败 / 1 未回传）

| 轴 | 任务 | 状态 |
|----|------|------|
| S1 可实施性审计轴 | 假设自己是实施者，拿 v1.5 的 S1 表格能否做完 | ❌ **失败**（`fdf4534c-e0d0-4e49-93b5-3f24843c50c8`，无 closing message） |
| 盲区补漏轴 | 找前两轮完全没碰的角度 | ❌ **失败**（`b7c069c7-3a80-4e33-aef1-52d5e1855569`，无 closing message） |

> **纪律**：按本文 §C.2 同口径，**未取得 ≠ 无问题**。
> 第三轮两条轴都未产出结论。按 AGENTS.md「子代理降级」——出现后端不可用错误时**立即降级为主代理直接执行，不盲等**。
> 故**改由主模型自行完成 S1 可实施性审计**，结果见 E.3。

### E.3 主模型自行执行 S1 可实施性审计（子代理失败的降级产出）

> 方法：把自己当实施者，逐条检查 v1.5 的 S1 落点能否照做。每条都读代码验证。
> **产出 5 条实质发现，其中 2 条推翻了我自己文档里的写法。**

| # | 级别 | 审计点 | 结论 | 证据 | 处置 |
|---|------|--------|------|------|------|
| **E3-1** | 🔴 **推翻文档** | 壳态选项 (a)「homeTabs 置空」的副作用方向写反了 | `MpModuleNav.vue` **零 props**，`tabs` 只由 `route.path` 计算（`:50-59`）⇒ **主窗口与壳态在相同路由下行为完全一致**。故「壳态本来就不显示 homeTabs」是**错的**——壳态在 `/` 时同样渲染 `homeTabs`。置空会让**所有**在 `/` 上的实例（主窗口 + 壳态）都失去导航 | `MpModuleNav.vue:46-59` | 文档已加"原理澄清"行 |
| **E3-2** | ✅ **新增更优方案** | 原三选项都不如一条新路：**S1 把账号 tab 移进 `Accounts.vue` 后，`MpModuleNav` 对主窗口与壳态都已无用途** | 因为：accounts 域由**页内 tablist** 承担（`Accounts.vue` 渲染在壳态的 `router-view` 内，同样生效）；home 域是**自指空壳**（`to:'/'` 而当前就是 `/`）；publish 域本就 `tabs=[]`。<br>⇒ **方案 (d)**：删组件 + 删两处引用 + 改 `tab-independent-home.test.js:48` 为"断言壳态无导航 chrome" + 壳态导航写入 §8 | `App.vue:15-23`、`tab-independent-home.test.js:41-52` | **已替换原三选项**，圆满了第二轮 Critical-1 |
| **E3-3** | 🟠 **文档漏项** | 删草稿箱 Flayer 不够——`showDraftList` 还有**两处驱动点**，且 `onActivated` **未处理** `?tab=drafts` | ① `watch(publishTab)` `:1335-1342`：`drafts` 时 `showDraftList = true` + `loadDrafts()`；② `onMounted` `:1390-1393`：同上；③ `onActivated` `:1425-1434` **完全没有 drafts 分支**（keep-alive 命中同值时不会重新加载）。只删 UI ⇒ 留下写已不存在状态的死代码 | `Publish.vue:1335-1342/1390-1393/1425-1434` | 文档已补规格：两处只删赋值保留 `loadDrafts()`，并补 onActivated 分支 |
| **E3-4** | 🟠 **验收不可测** | 验收 2b「点击后断言 `route.query.tab`」**测不了** | `Accounts.test.js:66-68` 把 `vue-router` mock 为 `useRoute: () => _routeState` + `useRouter: () => ({ replace: vi.fn() })`——**没有 `push`**，且 `mount` 未装 router 插件。故：① 新 tablist 用 `router.push` 会直接报 `router.push is not a function`；② `_routeState` 是普通对象，点击不会真的改变它 | `Accounts.test.js:66-68`、`:230-231` | 验收 2b 已改写为**三层断言**（DOM 渲染 / `push` 调用入参 / 设 query 后 tabpanel 渲染）+ e2e 互补 |
| **E3-5** | 🟠 **该拆 PR** | S1 作为一个 PR 太大，且内部有严格先后依赖 | S1 现 **14 行落点、8 个 ⚠️ 风险项**；先建 tablist 才能删组件、先修 `Accounts.vue:825` 才能建 tablist。一次合入时若出错**无法判断是"新建没做好"还是"删除做错了"** | 落点行数统计 | §12 已拆成 **S1a/S1b/S1c/S1d**，并标注 S1a 不可晚于 S1b |

**这 5 条的价值**：全部是"拿着文档真去做"才暴露的，静态通读看不出来。
尤其 E3-2 —— **评审了两轮都说"S1 不可落地"，降级自查反而找到了一条能落地的路**（因为读代码时发现组件零 props 这个事实，而之前的评审都只盯着"两处引用"）。

---

---

## F. 三轮评审总账

### F.1 finding 统计（全部经代码核实后才采纳）

| 轮次 | 来源 | Critical | Warning | Info | 有效？ |
|------|------|----------|---------|------|--------|
| 0 | 主模型自纠（A1-A4） | 1 | 1 | 2 | ✅ |
| 1 | 后端轴（codex） | 2 | 3 | 3 | ✅ |
| 1 | 前端轴（UX） | 4 | 6 | 3 | ✅ |
| 2 | 闭环审计轴 | 3 | 6 | 2 | ✅ |
| 2 | 修正引入回归轴 | 0 | 6 | 2 | ✅ |
| 3 | 主模型自查（E1） | 0 | 1 | 0 | ✅ |
| 3 | S1 可实施性轴 | — | — | — | ❌ 未回传 |
| 3 | 盲区补漏轴 | — | — | — | ❌ 失败 |
| **合计** | | **10** | **23** | **12** | |

**10 个 Critical 全部已修正**，无一条被"照单全收"或"整体拒绝"——每条都独立核实后才改文档。

### F.2 三轮里最有价值的四件事

1. **A1（自纠）**：规则 2 原写"统一走 `buildPublishFromProject → publishDataToQuery`"，而该函数硬编码 `type:'video'`——
   照做会把**图文误判成视频**，比现状更糟。这条是我自己的方案硬伤。
2. **前端轴 Critical-4**：删 `PublishDestinationModal` 会连带删掉**全应用唯一**告知"已替你存了草稿"的文案——
   把"被迫多选一次"换成"完全不知情"，与规则 1 正面冲突。
3. **闭环轴 Critical-2**：我加的回归锁「grep 渲染点 ≤1」**不可实现**——4 个渲染点用 3 个不同 locale key，
   中文串全仓 71 命中。这是"只写目标、不验落地"的典型。
4. **回归轴的两条纠偏**：证明我两处自查判断**过于悲观**（触顶提示可直接在 composable 内实现；
   账号页切 tab 不会重置筛选）。评审不只是"挑错"，也防止我做无谓的改造。

### F.3 三轮的共同模式（值得写进 learnings）

> **每轮评审都在证明上一轮的方案不够扎实，而每次不扎实都出在同一处：只写了"要什么"，没验证"怎么落地"。**
> - 第一轮：写了"删 MpModuleNav"（没查有第二处无条件渲染）
> - 第二轮：写了"回归锁 ≤1"（没查 key 有 4 处）
> - 第三轮：写了"7 处调用点"（没查还有 11 处字符串写法）
>
> 这与本文 §1.3 根因 R1「登记表只管可达性、不管语义一致性」**是同一个错误**，只是发生在文档自己身上。
