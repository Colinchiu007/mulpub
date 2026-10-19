# 影视工程（film-engineering）流水线 · 完整使用手册

> **版本**：2.0（2026-10-19）｜ **取证基线**：当前工作区 `main`（三标签 Hub 形态）
> **受众**：影视工程功能使用者（第一~十章）、进阶使用者与二次开发者（第十一~十四章）
> **取证口径**：本手册全部功能点、限制、错误码、路径、常量均取自当前代码，逐条标注 `文件:行号`。
> **与旧手册的关系**：仓库内已有 `01-docs/FILM-ENGINEERING-PIPELINE-OPERATIONS-2026-10-09.md`（基线 `main@8b3d3e91`）与 `01-docs/USER-MANUAL-FILM-ENGINEERING-2026-10-07.md`。本手册按**当前代码**重写——最大的形态变化是页面已从「单画布视图」重组为**三标签 Hub（自动 / 画布 / 工程案例）**，并新增了「自动」模式。旧手册的六阶段引擎、film-kit、安全合同部分仍然有效，可作为补充阅读。

---

## 目录

- 一、五分钟上手：影视工程是什么、该怎么选
- 二、进入功能与页面总览（三标签 Hub）
- 三、【自动】模式：从一段文案到成片（推荐新手）
- 四、【画布】模式：节点式编排，逐镜可控
- 五、【工程案例】：真实分镜库、剧本套用、提示词方法论
- 六、全量分批出片（>10 镜）：台账、断点续跑、原片回收
- 七、成片合成与产物管理
- 八、参考图机制（人物/场景一致性）
- 九、提示词方法论：七大块、五检查块、原文直送合同
- 十、数据资产 film-kit 与产物目录布局
- 十一、前置条件与模型配置
- 十二、故障排查手册（按症状/错误码索引）
- 十三、已知边界与限制清单
- 十四、附录：常量速查、IPC 清单、错误码表

---

## 一、五分钟上手：影视工程是什么、该怎么选

### 1.1 一句话定位

**影视工程**是一条「专业影视分镜生产线」：把一部开源 AI 电影《Hell Grind》的**真实工程方法**（怎么写分镜提示词、怎么锁角色一致性、怎么控制空间与时间）连同**真实分镜数据**打包进应用，让你把自己的剧本套进这套方法里，一键拆成分镜、逐镜出片、合成成片。

页面副标题原文（`apps/desktop/src/locales/film-engineering/zh.js:8`）：

> 三种用法：自动（只给文案与参考图，其余交给程序）、画布（节点式编排，逐镜可控）、工程案例（真实分镜库、剧本套用与提示词方法论）。

### 1.2 它和普通「文案转视频」有什么不同

它不是一个普通的"文案转视频"流水线，而是四层能力堆叠：

| 层 | 内容 | 证据 |
|---|---|---|
| 数据层 | 随包 film-kit：162 场景 / 153 分镜 / 332 资产索引 / 方法论（7 块 + 10 律 + 术语）/ 11 张图 | `electron/film-kit/`（本手册实测统计） |
| 服务层 | `FilmEngineeringService` 聚合服务：kit 加载、分镜查询、一键复制、剧本套用、生成、导出 | `electron/services/film-engineering/film-engineering-service.js` |
| 引擎层 | 在 PipelineEngine 上注册 6 个自定义阶段执行器 | `electron/services/pipeline-engine.js:481-531` |
| 前端层 | 三个视图（Hub / 画布 / 经典）+ 多套 composable | `src/views/FilmEngineeringHubView.vue` 等 |

### 1.3 三个标签怎么选（决策树）

| 你的情况 | 选哪个标签 | 理由 |
|---|---|---|
| 有文案/剧本，想最快拿到成片，不想管细节 | **自动** | 只需①剧本 ②参考图（可选）③横竖屏 ④大概时长，其余全由程序完成（`zh.js:12`） |
| 想精细控制每一镜、要连线注入参考图、要逐个重试 | **画布** | 节点式编排，逐镜可控（`zh.js:13`） |
| 想学习真实分镜怎么写、想把提示词复制出去自己用、要跑全集出片 | **工程案例** | 分镜库 + 剧本套用 + 方法论 + 全量分批出片（`zh.js:14`） |

> **提示**：三个标签是**懒挂载 + 常驻**的（`FilmEngineeringHubView.vue:32-33,105-131`），切换标签不会丢失另一个标签的进度。画布跑到一半切去工程案例，再切回来进度还在。

---

## 二、进入功能与页面总览（三标签 Hub）

### 2.1 怎么进去

| 入口 | 动作 | 代码位置 |
|---|---|---|
| 视频创作页 → 点「影视工程」卡片 | `router.push('/film-engineering')` | `src/views/CreateView.vue:2133-2135` |
| 直接访问路由 | `/film-engineering` → Hub 页 | `src/router/index.js:52` |
| 经典视图直达（暗路由） | `/film-engineering/classic` | `src/router/index.js:53` |

**注意**（`CreateView.vue:2139`）：影视工程是「跳转到专属页面」，而不是在创作页里直接跑一次 run——所以它不会出现在创作页的流水线进度浮层里。

### 2.2 页面结构

```
影视工程                                    ← 页头标题 zh.js:7
副标题（三种用法的说明）                     ← zh.js:8
┌──────────┬──────────┬──────────┐
│  自动    │  画布    │ 工程案例 │          ← 三标签 zh.js:10
└──────────┴──────────┴──────────┘
┌─────────────────────────────────────────┐
│ 当前标签的面板（首个标签「自动」默认挂载）│
└─────────────────────────────────────────┘
```

**标签与 URL 双向绑定**：`?tab=auto|canvas|classic`，缺省 `auto`（`FilmEngineeringHubView.vue:19-31`）。切换标签用 `router.replace`（:50），所以你可以把某个标签的链接存下来。

**键盘导航**（ARIA tab 模式，`FilmEngineeringHubView.vue:55-65`）：
- `←` / `→`：循环切换标签
- `Home`：跳到第 1 个标签（自动）
- `End`：跳到最后 1 个标签（工程案例）

**三个标签的含义提示**（悬停可见，`zh.js:11-15`）：

| 标签 | 提示原文 |
|---|---|
| 自动 | 填剧本、参考图、横竖屏与大概时长即可；程序自动完成分镜规划、参考绑定、批量出片与合成 |
| 画布 | 节点式编排：剧本拆分镜、参考图连线注入、逐镜重试与成片 |
| 工程案例 | 《Hell Grind》真实分镜库、剧本套用、提示词方法论与全量分批出片 |

---

## 三、【自动】模式：从一段文案到成片（推荐新手）

> 设计目标原文（`src/views/film-auto/FilmAutoPanel.vue:5-6`）：**越简单越好**——输入一段文案、可选人物/场景参考图、设定横竖屏与大概时长，其余全部由程序完成生成与合成；生成后可对某个片段修改调整。

### 3.1 四步步骤条

顶部有一条四步步骤条（`FilmAutoPanel.vue:205-210`），文案见 `zh.js:46-49`：

```
① 填写文案  →  ② 确认清单  →  ③ 自动生成  →  ④ 收口合成
```

面板内部用 `phase` 状态机驱动：`input` → `preview` → `running` → `done`（`FilmAutoPanel.vue:53-54`）。

### 3.2 第①步：填写文案

**剧本输入框**（`FilmAutoPanel.vue:216-229`）

| 项 | 值 | 证据 |
|---|---|---|
| 占位文案 | 粘贴你的剧本或故事文案。按空行分隔场景；程序会自动套用影视工程的提示词架构（场景上下文 / GEO 空间布局 / 动作时间线 / 对白音效 / 角色表演 / 风格 / 正向约束）并规划分镜数量。 | `zh.js:19` |
| 字数上限 | **10000 字** | `auto-constants.js:8`；后端 `auto-plan.js:37` |
| 字数计数器 | 「{n} / 10000 字」，超限变红并显示「剧本超过 10000 字上限」 | `zh.js:20-21`；`FilmAutoPanel.vue:227-228` |
| 分场规则 | **按空行分隔场景** | `auto-plan.js:107-110`（复用 `splitScript`） |

> **关键操作提示**：剧本必须**按空行分段**，每一段对应场景。如果你只写一段长文案，程序会按句末标点把它拆开（`auto-plan.js:138-163`），但分场质量不如你自己分好。

**人物参考图（可选）**（`FilmAutoPanel.vue:232-245`）

| 项 | 值 | 证据 |
|---|---|---|
| 数量上限 | **8 张** | `auto-constants.js:9`；`auto-plan.js:42` |
| 格式 | PNG / JPEG / WEBP | `zh.js:23` |
| 单张大小 | 不超过 **10MB**（⚠️ 前端**不**前置校验，超限会白跑一轮上传后才报错） | `zh.js:23`；服务端 `reference-store.js:17,79-81` |
| 角色名 | 每张可填角色名，命中该角色的分镜自动注入这张图 | `zh.js:23-24` |
| 角色名默认值 | 取文件名去扩展名，空则回落「角色」 | `useFilmAutoRefs.js:56-57` |
| 绑定逻辑 | 人物命中 + 场景轮转，每镜**最多 2 张** | `auto-plan.js:15,33` |

**场景参考图（可选）**（`FilmAutoPanel.vue:247-259`）

| 项 | 值 | 证据 |
|---|---|---|
| 数量上限 | **8 张** | `zh.js:26` |
| 绑定逻辑 | 按场景顺序轮转绑定，同一场景的分镜共享同一张参考图（与 GEO 空间布局「每场锁定」一致） | `zh.js:26` |

**画面方向**（`FilmAutoPanel.vue:261-270`）

| 选项 | 值 | 证据 |
|---|---|---|
| 横屏 | `16x9` | `zh.js:28`；`auto-plan.js:40` |
| 竖屏 | `9x16` | `zh.js:29`；`auto-plan.js:40` |
| 默认值 | `16x9` | `auto-constants.js:15` |

**大概时长**（`FilmAutoPanel.vue:271-285`）

| 项 | 值 | 证据 |
|---|---|---|
| 快捷档位 | 30 / 60 / 90 / 120 秒（点 chip 直接选） | `FilmAutoPanel.vue:36,274-282` |
| 手动输入 | 任意整数 | `FilmAutoPanel.vue:283` |
| 合法范围 | **10 – 600 秒** | `auto-constants.js:10-11`；`auto-plan.js:38-39` |
| 默认值 | **60 秒** | `auto-constants.js:17` |
| 越界提示 | 「时长需在 {min}–{max} 秒之间」 | `zh.js:32` |

**高级设置**（折叠区，`FilmAutoPanel.vue:288-295`）

| 项 | 值 | 证据 |
|---|---|---|
| 单镜时长 | **5 / 8 / 10 秒**三选一 | `auto-constants.js:14`；`auto-plan.js:41` |
| 默认值 | **5 秒** | `auto-constants.js:16` |

**实时预估**（`FilmAutoPanel.vue:298-300`）：

> 预估 {shots} 个分镜 · 实际时长约 {seconds} 秒（确认前不产生任何模型调用与费用）

镜数公式：`N = clamp(round(目标时长 / 单镜秒数), 1, 120)`（`auto-plan.js:51-59`；前端同公式 `auto-constants.js:22-28`）。

**点「生成预览」**（`zh.js:37`；`FilmAutoPanel.vue:301-303`）。这一步调用 `autoPlan`，**零模型调用、零费用**，只是规划并落盘计划。

### 3.3 第②步：确认清单

预览卡出现（`FilmAutoPanel.vue:307-359`），逐项列出：

| 显示项 | 含义 | 文案 key |
|---|---|---|
| 任务 ID | 形如 `auto-20261019143022`，断点续跑的凭据 | `zh.js:52` |
| 分镜数 | 规划出的镜数 | `zh.js:53` |
| 批次 | 镜数 > 10 时自动分批的批数 | `zh.js:54` |
| 时长 | 「约 {planned} 秒（目标 {target} 秒）」 | `zh.js:56` |
| 画面方向 | 横屏 16:9 / 竖屏 9:16 | `zh.js:57` |
| 视频 Provider | 实际使用的模型；未配置显示「未配置」 | `zh.js:58-59` |
| 注入参考图的分镜 | 有多少镜会带参考图 | `zh.js:60` |
| 预计占用磁盘 | 按 **8MB/镜** 估算 | `zh.js:91`；`auto-plan.js:44` |
| 预计耗时 | 按 **300 秒/镜** 估算 | `zh.js:92`；`auto-plan.js:45` |

**角色槽位映射**（`FilmAutoPanel.vue:328-331`）：显示 `ROKO → 小强` 这样的槽位映射。角色检出优先级为「用户标注 > 显式标记 > 对话动词 > 频次」，并有停用词守卫（`auto-plan.js:13`）。槽位顺序固定为 `ROKO / JAXX / LULU / REIN`（`auto-plan.js:30`）。

**分镜预览列表**（`FilmAutoPanel.vue:333-340`）：逐镜显示 `shotId`、标题、「{n} 字提示词」、参考图数量（🖼）。**注意**：这里只显示提示词**字数**，完整提示词只存在服务端计划文件里（`FilmAutoPanel.vue:64`）。

**「需要注意」警告区**（`FilmAutoPanel.vue:321-326`）。可能出现的警告码（`auto-plan.js:246-276`）：

| 码 | 触发条件 | 原文 |
|---|---|---|
| W2 | 镜数 > 10 | 镜数超过 10，将自动分 N 批顺序执行（无需逐批确认） |
| W3 | 实际时长 ≠ 目标时长 | 实际时长约 X 秒，与目标 Y 秒存在差异（单镜 Z 秒 × N 镜） |
| W5 | 墙钟预估 > 2 小时 | 墙钟预估约 X 小时，建议缩短时长或分批推进（支持停止与断点续跑） |
| W6 | 参考图越出受控目录被跳过 | 部分参考图未通过受控目录校验已跳过：… |
| W7 | 有分镜没解析到文案 | 有 N 个分镜没有解析到文案（剧本里可能只写了场景标题行），这些镜将沿用模板原文：… |

**确认勾选框**（`FilmAutoPanel.vue:351-355`）：

> 我已知悉：将生成 {shots} 个分镜（约 {seconds} 秒成片），确认后才会开始调用视频模型

提示文案（`zh.js:65`）：确认后程序将自动完成分镜规划、参考绑定、批量出片与合成；中途可停止，已完成的镜头不会重复生成。

**同名任务冲突**（`FilmAutoPanel.vue:343-349`）：若任务 ID 已存在，会出现覆盖勾选框「覆盖同名任务 {taskId}（旧一轮的产物与确认历史会归档保留）」。勾选后旧一轮会被移到 `archive/<runSeq>/` 保留（`auto-project.js:200-206,377-390`）。

**点「开始生成」**（`zh.js:66`）。

### 3.4 第③步：自动生成

**进度显示**：复用 `StageProgress.vue` 组件（`FilmAutoPanel.vue:32,363-368`，`testid-prefix="film-auto"`），进度摘要「已完成 {done} / {total} 镜」（`zh.js:67`）。

> **✅ 2026-10-19 已修复**：三个阶段 id 已登记进 `src/i18n/pipeline-labels.js` 的 STAGES 表，并在 `locales/pipelines/{zh,en}.js` 补成对文案，现在显示为中文。分支：`fix-film-engineering-defects`。
>
> | 阶段 id | 中文 |
> |---|---|
> | `film_auto_plan` | 分镜规划 |
> | `film_auto_generate` | 逐镜生成 |
> | `film_auto_render` | 收口合成 |
>
> （修复前：`film_auto_*` 未登记进翻译表，`translate()` 走 fallback，界面显示的就是这串英文 id。）

**进度机制**：事件推送优先 + **3000ms 轮询兜底**（`FilmAutoPanel.vue:24,40`）。

**重要特性**（`zh.js:68`）：

> 生成期间可继续操作界面；关闭页面不会中断任务，重新打开可续跑。

这是因为长任务在主进程**立即返回**后继续跑（`film-engineering-auto.js:324-328` 的注释明确记录了这个真机 E2E 缺陷的修复：原实现 `await driver(...)` 会让界面一直挂到整轮跑完，用户看到的是「点了没反应」）。

**停止生成**（`FilmAutoPanel.vue:370-373`）：点「停止生成」，**批间生效**——已开始的批跑完，未开始的批保持待跑；已完成的镜不会被重做（`film-engineering-auto.js:397-398`）。提示文案（`zh.js:88`）：

> 已请求停止：当前批次跑完后停下，未开始的批次保持待跑（再次点开始即从断点继续）

**逐镜状态表**（`FilmAutoPanel.vue:377-397`）：

| 列 | 内容 |
|---|---|
| 分镜 | shotId |
| 状态 | 待生成 / 生成中 / 已完成 / 失败（`zh.js:74`） |
| 失败原因 | 具体错误文本 |
| 操作 | 「修改片段」「重新生成」 |

### 3.5 第④步：收口合成

镜全部跑完后进入 `done` 阶段（`FilmAutoPanel.vue:400-421`）：

- **「收口合成成片」**按钮：校验渲染清单完整性后发起合成（`zh.js:77`）
- 若有缺镜，显示「缺镜 {n} 个：{list}」（`zh.js:82`），此时合成按钮禁用
- 合成中显示「合成中（run {runId}，{percent}%）」（`zh.js:78`）
- 成片出现后：**内嵌视频预览** + 「打开所在文件夹」+「另存为」（`zh.js:83-84`）
- 「开始新任务」重置面板（`zh.js:85`）

> ⚠️ **「开始新任务」不清 localStorage 里的 `last-task-id`**（`useFilmAutoRun.js:33` vs `:347-356`）。所以点完之后关闭页面再打开，**仍会自动恢复上一个任务的进度**。想彻底从零开始，需要重新打开时手动不理会恢复提示，或清掉浏览器/应用本地存储中的 `film-auto:last-task-id`。

**收敛口径（重要）**：进入 `done` 的判据是「不再运行 **且** `已完成 + 失败 ≥ 总镜数`」（`useFilmAutoRun.js:109-116`）。**即部分失败也算「跑完了」**——此时缺镜会在完成区列出并**阻断合成**，你需要先重新生成失败片段。这是刻意设计：早期只认「全部成功」会让有失败镜的任务永远卡在运行态。

### 3.6 片段编辑（生成后改某一镜）

点「修改片段」打开编辑器（`FilmAutoSegmentEditor.vue`）：

| 项 | 说明 | 证据 |
|---|---|---|
| 标题 | 修改片段 {shotId} | `zh.js:94` |
| 提示词编辑 | 可改，上限 **50000 字** | `zh.js:105`；`auto-project.js:26` |
| 本镜时长 | 可改，限 5/8/10 秒 | `zh.js:99`；`auto-project.js:303` |
| 恢复原文 | 一键还原 | `zh.js:98` |
| 直送说明 | 提示词会逐字符提交给视频模型，不做任何润色改写——这是影视工程「原文直送」合同。 | `zh.js:100` |
| 块检查 | 提示词缺少这些结构块：{blocks}（影视工程的提示词块是成片质量的关键；仍可保存，仅作提示） | `zh.js:108` |
| 操作 | 保存修改 / 按当前内容重新生成 | `zh.js:101-102` |

**改完要重新确认**：编辑会更新 `editedAt`，使「编辑晚于最新确认」成立 → 下次重生成时服务端返回 `needsReconfirm`，回到确认卡（`auto-project.js:350-358`；`film-engineering-auto.js:80-89`）。这是刻意设计：改动了内容就得重新过成本闸。

**⚠️ `needsReconfirm` 不是错误**：它是 `code: 0` 的正常回包。界面会静默回到确认卡，**不弹错误提示**（`FilmAutoPanel.vue:145-150`）。看到「又回到确认卡了」别以为是失败，重新勾确认即可。

**编辑器内没有「重新合成」按钮**（`FilmAutoSegmentEditor.vue` 只提供保存/重生成/恢复原文/关闭）。要重新合成整片，需关掉编辑器，回完成区点「收口合成成片」（`FilmAutoPanel.vue:406`）。

**保存只提交变化字段**（`FilmAutoSegmentEditor.vue:67-68`）：只改提示词就只发 `patch:{prompt}`，改了时长才追加 `patch.seconds`。服务端允许的 patch 键仅 `prompt / refPaths / seconds / title` 四个（`auto-project.js:295`）。

**单镜重生成是原子覆盖**：临时目录生成 → ffprobe 校验 → rename 覆盖正式产物（`auto-runner.js:164-237`）。校验不通过就不覆盖，绝不留坏文件。

---

## 四、【画布】模式：节点式编排，逐镜可控

> 副标题（`zh.js:198`）：填写剧本、连参考图，一键拆分镜并驱动到成片。

### 4.1 画布能做什么

画布承载五类可拖拽节点（`openspec/specs/film-engineering/spec.md:107`）：**剧本输入节点、人物参考图节点、场景参考图节点、分镜节点、产物节点（图片/视频）**。节点间可连线，支持选中、删除、缩放、平移、撤销/重做、自动布局与小地图导航。

起始面板收集（spec 口径）：剧本文本（非空、≤10000 字符）、人物/场景参考图上传、选项（画幅 16:9/9:16/保持源、全局时长 5/8/10 秒、角色映射 ≤10 键）。

> ⚠️ **实际 UI 没有独立的「起始面板」弹窗**。画布的剧本输入是**顶栏下方常驻的一条区块**（3 行 textarea），不是浮层（`FilmCanvasView.vue:169-174`）。角色映射虽有 `characterMap = {ROKO,JAXX,LULU,REIN}` 数据结构（`useFilmCanvas.js:40-42`），但画布视图**未渲染任何角色映射输入框**——要填角色映射需去「工程案例」标签的剧本套用页。

### 4.2 画布上实际会出现几种节点

模型层定义 5 种（`film-canvas-model.js:15-21`）：`scriptInput / characterRef / sceneRef / shot / artifact`。但**实际只会出现 3 种**：

| 类型 | 是否出现 | 说明 |
|---|---|---|
| 人物参考 `characterRef` | ✅ | 点「上传人物参考」创建（`useFilmCanvas.js:145-150`） |
| 场景参考 `sceneRef` | ✅ | 点「上传场景参考」创建 |
| 分镜 `shot` | ✅ | 拆分镜后铺出（`useFilmCanvas.js:69-76`） |
| 剧本 `scriptInput` | ❌ | 有插槽但**全仓无创建该类型节点的代码** |
| 产物 `artifact` | ❌ | 只在模型里定义，视图层零引用 |

### 4.2.1 ⚠️ 画布没有撤销/重做、没有自动布局按钮

这两点 spec 里写了（`spec.md:107`），但**代码里不存在**：

- **无撤销/重做**：`useFilmCanvas.js` 的返回值里没有 undo/redo，全仓画布相关文件 `grep undo|redo|history` 零命中。唯一「不可逆」操作是「清空画布」（`useFilmCanvas.js:239-243`），点了就删 localStorage，**无法恢复**。
- **无自动布局命令**：只有**铺节点时的网格算法**（按 `sceneId` 分组、组内每行 4 个、场景簇纵向堆叠，`film-canvas-model.js:56,64-93`），没有手动触发的按钮。已存在的同 id 节点会保留原位置（`mergeNodesKeepPosition`，`:99-106`）。
- **无键盘 Delete 删节点配置**：`deleteKeyCode` 未在源码出现；删节点只能点节点右上角 `×`。

**手册口径**：删节点前请确认——没有撤销。

### 4.2 节点类型与展示

| 节点 | 文案 | 证据 |
|---|---|---|
| 剧本 | 剧本 / 未命名剧本 / {n} 字 | `zh.js:203-205` |
| 人物参考 | 人物参考 | `zh.js:206` |
| 场景参考 | 场景参考 | `zh.js:207` |

分镜节点就地展示：提示词全文（可折叠）、模型与来源标签、ref 引用解析、所连参考图缩略与复制按钮组（`spec.md:107`）。

产物状态（`zh.js:210-213`）：待生成 / 生成中 / 已完成 / 失败。

### 4.3 连线规则（重要）

**只支持「参考图 → 分镜」连线**（`zh.js:221`）。非法连线会被拒绝并提示原因：

| 原因 key | 提示原文 |
|---|---|
| `edgeRule.sameNode` | 不能连接到自身 |
| `edgeRule.duplicate` | 该连线已存在 |
| `edgeRule.unknownType` | 未知节点类型 |
| `edgeRule.unsupportedPair` | 仅支持「参考图 → 分镜」连线 |

（规则实现：`src/composables/film-canvas-model.js:44-50`；文案 `zh.js:221`）

**连线即数据流**：下游生成时自动收集所有直连上游的产物作为输入，**无需手动上传或复制**（`spec.md:160`）。

### 4.4 工具栏

| 按钮 | 文案 | 用途 |
|---|---|---|
| 拆分镜 | 拆分镜 | 把剧本拆成分镜节点（`zh.js:214`） |
| 生成所选 | 生成所选 | 对选中分镜节点出片（`zh.js:216`） |
| 清空画布 | 清空画布 | 清空（`zh.js:217`） |
| 经典视图 | 经典视图 | 跳到「工程案例」标签（`zh.js:217`；`FilmEngineeringHubView.vue:119`） |
| 确认成本并生成 | 确认成本并生成 | 成本闸确认（`zh.js:217`） |

拆分镜结果提示：`已生成 {n} 个分镜` / `拆分镜失败，请重试`（`zh.js:214`）。

### 4.5 剧本输入限制

| 项 | 值 | 证据 |
|---|---|---|
| 非空 | 剧本不能为空 | `zh.js:214` |
| ≤10000 字 | 剧本超过 10000 字上限 / 剧本最多 10000 字 | `zh.js:214` |
| 角色映射 | ≤10 键，值为非空字符串 | IPC 层 `film-engineering.js:42,158-160` |

### 4.6 成本确认闸

点「生成所选」先弹成本确认卡（`zh.js:218`）：

> 成本确认 — 将为 {n} 个分镜生成视频，确认后才开始计费。

**确认前零模型调用、零计费**（`spec.md:107` 明确：advance 前零 provider 调用）。

> **✅ 2026-10-19 已修复**：现在按服务端 `errorCode` 精准分流——
> - `VIDEO_MODEL_NOT_CONFIGURED`（没配视频模型）→ 显示「尚未配置默认视频模型。请在模型设置中配置视频 Provider（如 Seedance / Kling / Veo）并设为默认后重试。」
> - `FILM_KIT_UNAVAILABLE`（kit 缺失，确实是引擎不可用）→ 仍显示「影视引擎不可用」
> - 其余 → 兜底「影视引擎不可用」（不吞掉、不静默）
>
> 修复是**两处**：视图分流 + `useFilmVideoGen.start` 如实透传 `errorCode`（原第 169 行恒返回硬编码 `'startFailed'`，把真因丢掉了，只改视图无效）。分支：`fix-film-engineering-defects`。

### 4.7 单镜重试

失败的分镜节点上会出现「重试」按钮（仅当 `data.status === 'failed'` 且 `shotId` 非空，`ShotNode.vue:47-54`）。失败时提示（`zh.js:222`）：

> 该镜重试失败，请稍后再试或前往经典视图处理

**重试只传定位参数**（`{runId, shotIndex, aspect, seconds}`），提示词由主进程从 run 快照取**原文**逐字符直送（`useFilmVideoGen.js:228-236`；`film-engineering.js:263-266`）——所以你在画布上改不了这一镜的提示词，要改得去自动模式或工程案例。

**两条重试通道并存，别混用**：

| 通道 | 定位方式 | 适用 |
|---|---|---|
| `film-engineering:retry-shot` | `pipelineEngine.getRunSnapshot(runId)` 查**流水线 run 快照** | 画布/单批生成 |
| `film-engineering:production-retry-shot` | 按**出片台账**定位（taskId → ledger → batchIndex → shotIndex） | 全量分批出片 |

出片批次从不注册为流水线 run，所以前者对出片批次恒返回「runId 不属于任何运行中的流水线」——这正是后者存在的理由（`film-engineering-production.js:72-86`）。

> **历史缺陷提示**（已修复，仅作背景）：2026-10-05 前曾存在 preload 命名空间错配，导致「单镜重试」永久失效且界面零报错。现由 `ipc-exposure-contract.test.js` 契约测试守护（`docs/ipc-exposure-contract.md:75`）。

> **✅ 2026-10-19 已修复**：`addEdge` 与 `removeNodes` 后由 `collectShotReferences` 回写 `refCount`（**真源与实际参与生成的参考同源**，不引入第二套计数）。现在连线成功后分镜节点会显示「已注入 {n} 张参考」，断开连线后计数归零。分支：`fix-film-engineering-defects`。

### 4.8 画布持久化

画布图状态（节点位置、连线拓扑、每节点数据）**可持久化与恢复**，应用重启后同一工程的画布可复原；产物节点结果状态**以磁盘实际产物为准**回显，而非缓存内存态（`spec.md:160`）。

### 4.9 参考图上传限制

| 错误 | 提示原文 |
|---|---|
| 文件读取失败 | 文件读取失败 |
| 格式不对 | 仅支持 PNG / JPEG / WEBP 图片 |
| 超限 | 参考图超过 10MB 上限 |
| 上传失败 | 参考图上传失败 |

（`zh.js:220`；前端校验 `useFilmCanvas.js:118-124`）

### 4.10 成片

成片生成后（`zh.js:219`）：

> 成片已生成 — 前往经典视图查看/导出

---

## 五、【工程案例】：真实分镜库、剧本套用、提示词方法论

> 即旧版「经典视图」，现为 Hub 的第 3 个标签（`FilmEngineeringHubView.vue:130`）。

### 5.1 三个子标签页

| 子标签 | 文案 | 用途 |
|---|---|---|
| 分镜库 | 分镜库 | 浏览 162 场景 / 153 分镜，一键复制（`zh.js:121`） |
| 剧本套用 | 剧本套用 | 把自己的剧本套进 Hell Grind 工程方法（`zh.js:121`） |
| 提示词方法论 | 提示词方法论 | 七大块 / 十条铁律 / 术语表（`zh.js:121,124`） |

> ⚠️ **只有三个标签页**。文案里还有第四个 `tabs.video`（视频生成，`zh.js:121`），但**没有对应的标签页渲染它**——视频生成与全量出片是分镜库工具条上的**两个按钮**（`FilmEngineeringView.vue:102,105-107`），不是标签页。

### 5.2 「三栏」的第三栏其实是抽屉

左场景树 + 中分镜列表是 flex 并排（`FilmEngineeringView.vue:58,721-723`），但**右详情面板不是常驻栏**，而是点分镜卡片后弹出的右侧抽屉 `el-drawer`（`size="min(720px, 92vw)"`，`FilmEngineeringView.vue:213`）。

### 5.3 头部元信息卡

显示：场景 / 分镜 / 资产索引 / 时长（`zh.js:118`）。整部片子为《Hell Grind》，时长 5706 秒（约 95 分钟，`film-manifest.json` 实测 `durationSec: 5706`）。

**kit 不可用时**（`zh.js:115-116`）：

> 影视工程资源不可用 — 随包 film-kit 数据资产缺失或校验失败，无法浏览分镜库。请检查安装完整性后重试。

### 5.3 分镜库：三栏操作

**左：场景树** → **中：分镜列表** → **右：详情面板**。

| 操作 | 说明 | 文案 |
|---|---|---|
| 展开场景 | 点左侧场景查看分镜 | 请选择左侧场景查看分镜 / 该场景暂无分镜（`zh.js:122`） |
| 分页 | 默认每页 100，最大 200，全量上限 500 | `shot-library.js:29-31` |
| 加载更多 | 显示「已加载 {loaded} / 共 {total} 镜」+「加载更多」 | `zh.js:122` |
| 全选本场 | 全选本场 | `zh.js:122` |
| 全选/取消已加载 | 全选/取消当前已加载的分镜 | `zh.js:122` |

### 5.4 一键复制：四种模式

**复制内容下拉**（`zh.js:122`）有四种模式，由**后端组装文本**（跨平台一致），前端只写剪贴板（`shot-library.js:13`）：

| 模式 | 值 | 复制出什么 | 实现 |
|---|---|---|---|
| **完整提示词**（主推） | `full` | 完整提示词原文 | `shot-library.js:173` |
| 提示词块 | `blocks` | 按 5 个块标题切分，格式化为 `[ 块名 ]\n内容` | `shot-library.js:16-22,63-73` |
| 角色行 | `characters` | 只含 `[CHARACTER:` 的行 | `shot-library.js:51-54` |
| GEO 布局 | `geo` | 只取 `GEO SPATIAL LAYOUT` 块内容 | `shot-library.js:56-61` |

复制后提示：「提示词已复制到剪贴板」/「复制失败，请手动选择复制」（`zh.js:125-126`）。

> ✅ **2026-10-19 已修复**：切块判定原为整行精确比较，真实语料上几乎切不出块；现改为**行首前缀正则**（从 `BLOCK_HEADINGS` 单一真源生成），并补齐为 7 个块（新增 `SCENE CONTEXT` 与 `STYLE`，与方法论同源）。
>
> 实测同一份 kit（153 镜）**修复前后对比**：
>
> | 指标 | 修复前 | 修复后 |
> |---|---|---|
> | 能切出块的分镜 | 3（2.0%） | **66（43.1%）** |
> | `GEO SPATIAL LAYOUT` 命中 | 0 | 1 |
> | `AUDIO` 命中 | 3 | 71 |
> | `SCENE CONTEXT` 命中 | 0（未识别该块） | 26 |
> | `STYLE` 命中 | 0（未识别该块） | 38 |
>
> 分支：`fix-film-engineering-defects`。

**匹配规则**（修复后的数据校验口径）：

| 形态 | 是否识别为块标题 |
|---|---|
| `GEO SPATIAL LAYOUT` | ✅ 纯标题 |
| `GEO SPATIAL LAYOUT (locked ...):` | ✅ 带括号后缀 + 冒号 |
| `ACTION TIMING:` | ✅ 带结尾冒号 |
| `  geo spatial layout :` | ✅ 前导空白 + 小写 + 冒号 |
| `Roko says: the AUDIO in this scene` | ❌ 行中出现的标题字样不误判 |

> **仍需注意**：`characters`（角色行）模式在**当前随包数据上仍 0 命中**（真实提示词里没有 `[CHARACTER:` 行）。这是数据形态而非缺陷——要拿提示词就用 `full`。

**按钮位置差异**：列表卡片上的单个复制按钮**只暴露 `full`**（硬编码，`FilmEngineeringView.vue:122`）；四种模式的选择在**详情抽屉里**（`FilmEngineeringView.vue:221-224`）。下拉框本身没有可见 label（`library.copyMode` 文案未被引用）。

**批量复制**：勾选多个 → 「批量复制」→「已复制 {n} 个分镜」（`zh.js:127`）。批量上限 50 条（`film-engineering.js:43`）。

### 5.5 导出

| 格式 | 按钮 | 说明 |
|---|---|---|
| JSON | 导出 JSON | `zh.js:122` |
| Markdown | 导出 Markdown | `zh.js:122` |

导出约束：1-50 项，每项必须含非空 prompt（≤50000 字符）（`film-engineering.js:182-193`）。成功后提示「已导出 {fileName}」（`zh.js:135`）。

**文件名规则**：`film-engineering-prompts-YYYY-MM-DD.json` / `.markdown`（`film-engineering-service.js:161`，取 `toISOString().slice(0,10)`）。例：`film-engineering-prompts-2026-10-19.json`。

**导出内容格式**（`film-engineering-service.js:149-158`）：
- JSON：`[{shotId, sceneId, prompt, model, refTokens}]`，缩进 2
- Markdown：每镜 `## [i] sceneId · model` + prompt，条间 `\n\n---\n\n`

导出走浏览器端 Blob + `<a download>` 触发下载（`useFilmEngineering.js:347-385`）。

### 5.5.1 还有「生成图片」按钮

工具条第 4 个按钮「生成图片」（`zh.js:122`），**生成的是图片不是视频**：走 `assetGenerator`，固定 `aspectRatio: '16:9'`（`useFilmEngineering.js:394`），上限 **20 镜**（`film-engineering-service.js:23`；按钮 >20 时禁用）。结果与视频生成是两条不同链路，别混淆。

### 5.6 剧本套用（adaptScript）

输入区（`zh.js:123`）：

- **剧本占位文字**：在这里粘贴你的剧本。按空行分隔场景（每个场景 = 一个分镜模板）。剧情内容会被套用到 Hell Grind 的提示词架构中，其余实现方式（角色定妆、GEO 锁定、动作时间线、AUDIO、STYLE、正向约束）原样保留。
- **上限**：最多 10000 字
- **角色映射**：把剧本里的角色映射到 Hell Grind 主角（ROKO / JAXX / LULU / REIN 等）。映射后描述符中的角色名会被替换为你的角色名。上限 **10 个键**，值必须非空字符串（`film-engineering.js:42,157-165`）。

**LLM 增强开关**：开启时用推理模型增强套用；不可用时降级（`llmEnhanced=false`）并给出 warning，**拆分镜仍成功完成**（`spec.md:130`）。

> ⚠️ **当前生产环境该开关恒不生效**：DI 注册时传 `llm: null`（`electron/core/container.setup.js:468`），而启用判定要求 `this.llm` 非空（`script-adapt.js:168`），故 `useLlm` 恒 false。流水线阶段侧还进一步硬编码 `llmEnabled: false`（`film-engineering-stages.js:126-130`）。
> **即：当前版本的「剧本套用」走的永远是本地模板路径**，回传的 `llmEnhanced` 恒为 `false`。`FilmCanvasView.actions.test.js:106-160` 是一组专门锁住「开关已从 UI 下线」的反证回归锁。手册不把 LLM 润色列为可操作项。

结果：「已生成 {n} 个分镜」（`zh.js:136`）；失败「剧本套用失败」（`zh.js:137`）。

### 5.7 提示词方法论

| 区块 | 内容 | 证据 |
|---|---|---|
| 七大提示词块 | 7 个结构化块 | `zh.js:124`；`prompt-doctrine.json` 实测含 `blocks` |
| 十条铁律 | 10 条规则 | `zh.js:124`；实测含 `rules` |
| 术语表 | 术语（中文/英文切换） | `zh.js:124`；实测含 `glossary` |

底部提示（`zh.js:124`）：完整方法论文档见随包 `prompt-doctrine.zh.md`。

### 5.8 视频生成子页

| 项 | 值 | 证据 |
|---|---|---|
| 画幅 | 16:9 横屏 / 9:16 竖屏 / 跟随原图 | `zh.js:149` |
| 时长 | 5/8/10 秒 | `zh.js:149` |
| 单批上限 | **最多 20 个分镜** | `zh.js:131`；`film-engineering.js:44` |
| 成本确认 | 将为 {totalShots} 个分镜生成视频（画幅 {aspect} / 时长 {seconds}s，Provider：{provider}）。确认后才开始计费生成。 | `zh.js:149` |
| 未配模型 | 尚未配置默认视频模型。请在模型设置中配置视频 Provider（如 Seedance / Kling / Veo）并设为默认后重试。 | `zh.js:149` |
| 结果 | 成片已生成 + 打开所在文件夹 / 另存为 / 再来一批 | `zh.js:149` |
| 失败 | 生成失败 + 前往模型设置 | `zh.js:149` |

---

## 六、全量分批出片（>10 镜）：台账、断点续跑、原片回收

> 入口：「全量出片」（`zh.js:151`）。说明：对已导入分镜按批次生成视频并合成成片；逐批确认后才计费，支持断点续跑。（`zh.js:152`）

### 6.1 什么时候用

| 场景 | 用哪个 |
|---|---|
| ≤10 镜 | 画布「生成所选」或经典视图「视频生成」（单批最多 20） |
| \>10 镜，乃至全集 153 镜 | **全量分批出片**（自动切批，每批 10 镜） |

### 6.2 任务 ID

| 项 | 值 | 证据 |
|---|---|---|
| 用途 | 出片台账与断点续跑的凭据 | `zh.js:155` |
| 占位提示 | 用于出片台账与断点续跑，如 my-task-01（仅限字母/数字/._-） | `zh.js:155` |
| 规则 | `^[A-Za-z0-9._-]{1,64}$` | `auto-project.js:35` |
| 非法提示 | 任务 ID 只允许字母、数字、._-，长度 1-64 | `zh.js:156` |

### 6.3 批次计划

「批次计划预览」显示（`zh.js:158`）：

> 共 {batches} 批（每批最多 {size} 镜），本次 {shots} 个分镜

**批大小固定 10**（`production-driver.js:31`）。153 镜 → 16 批（15×10 + 1×3）。

同时显示磁盘预估与耗时预估（`zh.js:159-160`），口径同自动模式：**8MB/镜、300 秒/镜**（`film-engineering-production.js:23,25`）。

### 6.4 逐批确认与执行

每批一张卡（`zh.js:163`）：

> 第 {i}/{n} 批 · {count} 个分镜 · 画幅 {aspect} · 时长 {seconds}s

点「确认执行本批」。提示（`zh.js:165`）：确认后才开始本批生成；确认前零模型调用、零计费。

**批次状态**（`zh.js:168-171`）：待确认 / 生成中 / 已完成 / 失败。

**累计已确认 {count} 镜**（`zh.js:167`）——让你清楚已授权了多少。

### 6.5 断点续跑

| 项 | 说明 | 证据 |
|---|---|---|
| 入口 | 「断点续跑」→ 输入此前的任务 ID →「恢复任务」 | `zh.js:176-178` |
| 语义 | **只读恢复批/镜进度，不触发任何生成与计费** | `zh.js:177` |
| 台账缺失 | 未找到该任务的出片台账，请确认任务 ID 或先发起一次出片 | `zh.js:179` |

**续跑的裁决依据是磁盘，不是台账**（`production-driver.js:120-124`，重入协议 D6）：

- 磁盘齐 → `needRun=false`，**零 provider 调用**直接跳过
- 台账标 done 但磁盘缺 → **降级重跑**
- 台账标 pending/failed 但磁盘齐 → **复核通过跳过**

这就是「双核」：台账记意图，磁盘裁事实。

**批次 runId 含指纹**（`production-driver.js:59-75`）：`prod-<taskId>-<fp10>-b<N>`。指纹按批次分镜集计算，防止「同一 taskId 换一组分镜却复用了旧产物目录」。

### 6.6 单镜重试

批次明细里有「重试该镜」（`zh.js:174`）。它走**独立的台账定位通道** `film-engineering:production-retry-shot`——不能用普通 `retry-shot`（那条走流水线 run 快照，而出片批次从不注册为流水线 run，会恒报「runId 不属于任何运行中的流水线」）（`film-engineering-production.js:72-86`）。

提示词**从 kit 原文取**，逐字符直送，不过优化器（`film-engineering-production.js:119-122`）。

### 6.7 原片回收

| 项 | 说明 | 证据 |
|---|---|---|
| 引导 | 建议先回收原片到本地再精修：远端结果链接有效期有限，过期后需重新生成。 | `zh.js:180` |
| 按钮 | 回收全部原片 / 回收中… | `zh.js:181-182` |
| 结果 | 已回收 {ok}/{total} 个文件到 {dir} | `zh.js:183` |
| 并发 | 4 | `film-engineering.js:46` |
| 单批上限 | 50 条 | `film-engineering.js:45` |
| 落点 | `<mediaRoot>/production/<taskId>/recycled/shot_NNN.mp4` | `film-engineering.js:332` |
| 无链接的镜 | 该镜无 resultUrl，无法回收下载（需走批量出片重新生成） | `film-engineering.js:342` |

**安全**：URL 一律取 kit 的 `resultUrl`（**忽略**渲染端传入的 url 字段），allowedHosts 取 kit manifest，防 SSRF（`film-engineering.js:294-296,323-327`）。

> ⚠️ **当前版本「回收原片」实际不可用**：下载前要求 `allowedHosts` 清单非空，否则 fail-closed 拒绝（`shot-downloader.js:55-57`）；而随包 kit 的 `film-manifest.json` **不含 `allowedHosts` 字段**（顶层键仅 `schemaVersion / filmMeta / scenes`，已实测确认）。因此该通道在默认 kit 下必然返回「allowedHosts 清单缺失，拒绝下载」。
> **应对**：本机若存在全量 kit 即可恢复该功能——实测 `shared-user-data/film-kit/film-manifest.json` **含 `allowedHosts: ["d8j0ntlcm91z4.cloudfront.net"]`**，且该目录是回退链的**首级**（优先于随包精简包，`kit-loader.js:291-318`）。所以：
> - 装了全量 kit 的机器 → 回收原片**可用**
> - 只有随包精简包的机器 → 回收原片**不可用**，需要原片就走批量出片重新生成

### 6.7.1 两级 kit 与规模差异

| 级 | 路径 | 分镜数 | 体积 |
|---|---|---|---|
| 首级（全量） | `<userData>/film-kit`（本机实测 `shared-user-data/film-kit`） | **6558** | shot-library 约 80.6 MB |
| 末级（随包精简） | `apps/desktop/electron/film-kit`（打包进 asar） | **153** | 约 2.8 MB |

两级均 162 场景 / 332 资产索引。回退链：首级目录不存在时记 `missing`（不算错误，不告警），级内损坏才记 `fallbacks` 并 warn；全部不可用才 `FILM_KIT_UNAVAILABLE`（`kit-loader.js:291-318`）。

**这解释了为什么不同机器上「分镜数」显示不同**：精简包每场景 1 镜（153），全量包单场景最多 754 镜（6558）。全量出片的上限 1000 也是为它设的。

### 6.8 收口

全部批次完成 → 「全部批次已收口，渲染清单共 {count} 条」（`zh.js:184`）→ 点「合成成片」（`zh.js:185`）。

未收口时（`zh.js:189`）：暂无法合成：渲染清单未收口（{error}）。

---

## 七、成片合成与产物管理

### 7.1 合成逻辑

`film_render` 阶段（`film-render.js:1-13`）：

1. **产物清单以 run 目录磁盘扫描为准**，不信任内存态结果
2. **缺任一镜头 → fail 并列出缺失序号，绝不输出缺镜假成片**
3. 全部片段规格一致（codec/宽高/帧率/时基/音频参数）→ `concat demuxer -c copy` **零重编码直拷**
4. 不一致 → 仅做最小 `scale+pad` 归一到目标画幅后拼接（16x9→1280x720、9x16→720x1280、source→首片段宽高）
5. **无转场 / 无调色 / 无字幕 / 无音轨处理**
6. 产物 `final.mp4` 落在受控媒体根内

### 7.2 产物目录布局

受控媒体根 = `os.tmpdir()/film-engineering`（`film-render.js:81-83`；`video-gen.js:64-66`）。

| 用途 | 路径 | 证据 |
|---|---|---|
| 普通 run 产物 | `<root>/<runId>/shot_NNN.mp4`、`final.mp4` | `video-gen.js:48-50` |
| 全量出片批次 | `<root>/prod-<taskId>-<fp10>-b<N>/shot_NNN.mp4` | `production-driver.js:65-75` |
| 全量出片台账 | `<root>/production/<taskId>/ledger.json` | `film-engineering-production.js:205` |
| 回收原片 | `<root>/production/<taskId>/recycled/shot_NNN.mp4` | `film-engineering.js:332` |
| 自动模式计划 | `<root>/auto/_plans/<planId>.json` | `auto-project.js:7,55-57` |
| 自动模式项目 | `<root>/auto/<taskId>/project.json`（**可编辑内容真源**） | `auto-project.js:8,67-69` |
| 自动模式台账 | `<root>/auto/<taskId>/ledger.json` | `auto-project.js:9,71-73` |
| 自动模式产物 | `<root>/auto/<taskId>/b<N>/shot_NNN.mp4` | `auto-runner.js:9-10,25-27` |
| 自动模式成片 | `<root>/auto/<taskId>/final.mp4` | `film-engineering-auto-inspect.js:41-43` |
| 自动模式归档 | `<root>/auto/<taskId>/archive/<runSeq>/` | `auto-project.js:11,75-77` |
| 参考图 | `<root>/references/` | `film-engineering.js:218` |

### 7.3 ⚠️ 临时目录会被系统清理

`os.tmpdir()` 下的产物**会被系统清理**。重要成片务必用界面上的「打开所在文件夹」/「另存为」导出。

应用「设置 → 清理」里有「影视工程缓存」条目，文案（`zh.js` 同级缓存文案）：视频合成与影视工程在系统临时目录产生的中间产物，可安全清理以释放磁盘空间。**清理后不可恢复**。

---

## 八、参考图机制（人物/场景一致性）

### 8.1 上传

渲染端把本地图片读成 dataURL 提交，`saveReference` 做**魔数嗅探**（不信任扩展名）、大小上限、服务端生成文件名，落盘 `<root>/references/`，返回规范化绝对路径（`film-engineering.js:216-236`）。

| 约束 | 值 |
|---|---|
| 格式 | PNG / JPEG / WEBP（魔数嗅探，非扩展名） |
| 单张大小 | ≤10MB |
| 自动模式数量 | 人物 ≤8、场景 ≤8 |

**上传不自动外发**：仅在用户发起生成时随请求提交（`spec.md:145`）。

### 8.2 注入生成

参考图节点连线到分镜后，对应本地图**作为 provider 的图生图/角色一致性参考输入**随生成请求提交（`spec.md:145`）。

未连参考图时生成正常走纯文本提示路径，**不因缺参考失败**（`spec.md:145`）。

**能力降级**：provider 不支持参考输入时给出明确提示而非静默失败（`auto-plan.js:247` 的 `buildReferenceWarnings`）。

### 8.3 自动模式的自动绑定

- 人物图：命中该角色名的分镜自动注入
- 场景图：按场景顺序轮转，同场景共享
- 每镜**最多 2 张**
- 越出受控媒体根的路径**跳过并给 W6 警告**（`auto-plan.js:266-275`）
- 启动前还会对每条 `refPaths` **重校验**受控根，越界即 fail-closed 拒绝启动（`film-engineering-auto.js:274-282`）

---

## 九、提示词方法论：七大块、五检查块、原文直送合同

### 9.1 原文直送合同（这条最重要）

> **影视工程提交给视频 Provider 的提示词，逐字符等于你复制出来的提示词原文。**

代码层面：`prompt: shot.prompt` 直接进载荷，MUST NOT 经过 prompt-engine 视频优化链路（`video-gen.js:7-8,73-83`）。

界面上的直送说明（`zh.js:100`）：

> 提示词会逐字符提交给视频模型，不做任何润色改写——这是影视工程「原文直送」合同。

**这意味着**：你编辑提示词的每一个字都会原样影响出片，程序不会「帮你优化」。这是特性，不是缺陷——它保证可复现。

### 9.2 提示词块结构

从提示词中可按 5 个块标题切分（`shot-library.js:16-22`）：

| 块 | 解决什么问题 |
|---|---|
| GEO SPATIAL LAYOUT | 空间布局（每场锁定） |
| ACTION TIMING | 动作时间线 |
| AUDIO | 对白与音效 |
| CHARACTER ACTING | 角色表演 |
| POSITIVE CONSTRAINTS | 正向约束 |

另有「场景上下文」与「风格」两块，共 7 块（见 `zh.js:19` 的占位文案与方法论标签页）。

编辑提示词时会检查这 5 个块是否还在，缺了给提示（`zh.js:108`）：

> 提示词缺少这些结构块：{blocks}（影视工程的提示词块是成片质量的关键；仍可保存，仅作提示）

**注意**：只是提示，不阻断保存。

### 9.3 角色槽位

Hell Grind 四个主角（`film-manifest.json` 实测）：

| 槽位 | 描述符 |
|---|---|
| ROKO | Determined street kid; crystal arm; glowing red fist when charged. |
| JAXX | Reckless, hungry street kid; always half-joking; London street voice. |
| LULU | Clever street kid; technical voice; flat, fast, precise. |
| REIN | Mysterious street kid; calm under pressure; carries the coordinates. |

映射后，描述符中的角色名会被替换为你的角色名。角色锁定正是通过这套槽位 + 参考图实现的。

---

## 十、数据资产 film-kit 与产物目录布局

### 10.1 kit 内容（本手册实测统计）

| 文件 | 大小 | 内容 |
|---|---|---|
| `shot-library.json` | 2.65 MB | 153 个分镜（索引 0-152） |
| `reference-registry.json` | 88 KB | 332 条资产索引（UUID 键） |
| `film-manifest.json` | 30 KB | `schemaVersion` / `filmMeta` / `scenes`（**162** 场景） |
| `prompt-doctrine.json` | 6.7 KB | `blocks` / `rules` / `glossary` |
| `prompt-doctrine.zh.md` | 5.9 KB | 完整方法论文档 |
| `SCHEMA.md` | 4.5 KB | 数据契约说明 |
| `images/` | 11 个文件 | 精选小图 |

`filmMeta` 实测：片名 **Hell Grind**，时长 **5706 秒**（≈95 分钟）。

来源（`film-manifest.json` 实测）：
- 项目页 `https://higgsfield.ai/@higgsfield.studio/projects/hell-grind`
- skill 仓库 `https://github.com/OSideMedia/higgsfield-ai-prompt-skill`（MIT）

**版权边界**：只使用公开 API 元数据与精选小图，电影视频本体不入库。

### 10.2 kit 加载：fail-closed

kit 加载失败（缺失或 schema 校验不通过）→ 抛 `FILM_KIT_UNAVAILABLE` → 前端显示「影视工程资源不可用」/「影视引擎不可用」（`zh.js:115-116,200-201`），**功能不可用而非降级跑空数据**。

### 10.3 可复现重建

`scripts/film-engineering/fetch-hell-grind-kit.py` 可重建 kit（`scripts/README.md:87` 记为「影视工程素材获取」），支持精选 / `--full` 两口径。

---

## 十一、前置条件与模型配置

### 11.1 必须配置视频模型

影视工程出片需要**视频模型**。未配置时报错（`film-engineering.js:270-276`）：

> 影视工程视频重试需要视频模型（如 Seedance / Kling / Veo / CogVideo 等），请在模型设置中配置并设为默认视频 Provider 后重试

**怎么配**：进入模型设置页 → 添加一个视频 Provider（填 API Key 与端点）→ 把它**设为默认视频 Provider**。保存后回到影视工程页。

Provider 解析采用**双默认语义**：用户默认 > 运营默认 > `capability_models.video` > `models[0]`（`video-gen.js:103-110`）。

**注意**：kit 里分镜的 `model` 字段仅作展示，**不用于路由**（`video-gen.js:9`）。实际用哪个模型只取决于你的默认视频 Provider。

### 11.2 模型需求分析

`film-engineering` 默认无模型要求；仅当启用 LLM 增强时才需要 `llm`（`pipeline-model-preflight.test.js:78-80`）。

### 11.3 生成参数

| 项 | 值 | 证据 |
|---|---|---|
| 画幅 | `16x9` → 1280×720；`9x16` → 720×1280；`source` → 不下发尺寸 | `video-gen.js:40,85-91` |
| 时长→帧数 | 5s→121 帧；8s→201 帧；10s→241 帧 | `video-gen.js:52-60` |
| 帧率 | 24 | `video-gen.js:43` |
| 轮询间隔 | 10 秒 | `video-gen.js:44` |
| 轮询上限 | 10 分钟 | `video-gen.js:45` |
| 单批上限 | 10（自动/全量）/ 20（经典视图图片生成） | `video-gen.js:39`；`film-engineering.js:44` |
| 批内并发 | 2 | `auto-runner.js:156` 引用 `PRODUCTION_BATCH_CONCURRENCY` |

---

## 十二、故障排查手册（按症状/错误码索引）

### 12.1 症状索引

| 症状 | 原因 | 处理 |
|---|---|---|
| 页面显示「影视工程资源不可用」 | kit 缺失或校验失败 | 见 12.2 |
| 点「开始生成」没反应 | 未勾选确认框 | 勾确认框；提示「请先勾选确认，再开始生成」（`zh.js:50`） |
| 提示「时长需在 10–600 秒之间」 | 时长越界 | 调到范围内 |
| 提示「剧本超过 10000 字上限」 | 剧太长 | 精简或分段跑 |
| 报「需要视频模型…请在模型设置中配置」 | 未配默认视频 Provider | 见第十一章 |
| 合成按钮灰着 / 提示缺镜 | 有镜失败 | 先「重新生成」失败片段，再收口 |
| 重生成时又弹回确认卡 | 你改过提示词（编辑晚于确认） | 正常行为，重新勾确认 |
| 提示「同名任务已存在」 | taskId 重复 | 勾选「覆盖同名任务」（旧一轮会归档） |
| 提示「该计划已被消费/已过期」 | 计划被用过或超 24h | 重新点「生成预览」（`auto-project.js:33` TTL=24h） |
| 进度不动但任务在跑 | 长任务已派发，主进程继续跑 | 正常；可关页面，重开可续跑 |
| 点停止后没立刻停 | 停止**批间生效** | 等当前批跑完；已完成的镜不会被重做 |

### 12.2 FILM_KIT_UNAVAILABLE

**症状**：画布顶部红色告警「影视引擎不可用」/「影视工程资源不可用」，说明文字：随包 film-kit 资源缺失或校验失败，请检查安装完整性后重试。（`zh.js:116,201`）

**处理**：检查安装完整性；必要时重装应用。kit 是随包数据资产，无法从界面修复。

### 12.3 VIDEO_MODEL_NOT_CONFIGURED

**症状**：发起生成/重试时报「尚未配置默认视频模型…」（`zh.js:149,190`）

**处理**：模型设置页配置视频 Provider 并设为默认。

### 12.4 自动模式错误码速查

| 错误码 | 含义 | 出处 |
|---|---|---|
| `AUTO_SCRIPT_EMPTY` | 剧本不能为空 | `auto-plan.js:76` |
| `AUTO_SCRIPT_TOO_LONG` | 剧本超过 10000 字 | `auto-plan.js:77-79` |
| `AUTO_BAD_PARAM` | 参数非法（aspect/seconds/时长/参考图/越界路径） | `auto-plan.js:61-63` |
| `AUTO_NO_TEMPLATES` | 没有可用模板分镜（film-kit 未加载或为空） | `auto-plan.js:189` |
| `AUTO_TOO_MANY_SHOTS` | 计划镜数超 120 上限，请缩短时长或增大单镜秒数 | `auto-plan.js:196-202` |
| `AUTO_NO_BEATS` | 剧本无法分场（请用空行分隔场景） | `auto-plan.js:209` |
| `AUTO_PLAN_EXPIRED` | 计划已过期/已消费/损坏，请重新生成预览 | `auto-project.js:145-157` |
| `AUTO_PLAN_MISMATCH` | 计划归属与任务 ID 不一致 | `auto-project.js:161` |
| `AUTO_TASK_EXISTS` | 同名任务已存在；如需覆盖请显式确认 | `auto-project.js:198` |
| `AUTO_TASK_BUSY` | 已有自动模式任务在运行 | `film-engineering-auto.js:305` |
| `AUTO_PROJECT_UNREADABLE` | 项目文件不存在或已损坏（fail-closed，绝不静默续跑） | `auto-project.js:264` |
| `AUTO_SHOT_INVALID` | shotIndex 越界 / 提示词为空 / patch 字段不支持 | `auto-project.js:289-313` |
| `AUTO_REGENERATE_FAILED` | 重生成失败 | `auto-runner.js:220` |
| `AUTO_REGENERATE_INVALID_CLIP` | 生成的片段未通过 ffprobe 校验（**不会覆盖原文件**） | `auto-runner.js:226` |
| `AUTO_MANIFEST_INCOMPLETE` | 渲染清单未收口（存在缺镜） | `film-engineering-auto-inspect.js:110-117` |
| `AUTO_TEMPLATE_UNAVAILABLE` | 取模板失败（非 kit 原因） | `film-engineering-auto.js:162` |

### 12.5 通用错误提示文案

| 场景 | 文案 | key |
|---|---|---|
| 桌面能力缺失 | 当前环境未提供桌面端能力 | `zh.js:117,139` |
| 通用失败 | 操作失败，请重试 | `zh.js:140` |
| 场景加载失败 | 场景加载失败 | `zh.js:141` |
| 分镜加载失败 | 分镜加载失败 | `zh.js:142` |
| 加载更多失败 | 下一页分镜加载失败 | `zh.js:143` |
| 详情加载失败 | 分镜详情加载失败 | `zh.js:144` |
| 未勾选 | 请先勾选分镜 | `zh.js:130` |
| 图片生成超限 | 一次最多生成 20 个分镜 | `zh.js:131` |

> **注意**（浏览器直开 Vite dev server 时）：无 `window.electronAPI`，所有 IPC 调用静默降级，影视工程功能不可用。必须在 Electron 窗口中使用。

---

## 十三、已知边界与限制清单

| # | 限制 | 值/说明 | 证据 |
|---|---|---|---|
| 1 | 剧本长度 | ≤10000 字 | `auto-constants.js:8` |
| 2 | 目标时长 | 10–600 秒 | `auto-constants.js:10-11` |
| 3 | 自动模式最大镜数 | 120 | `auto-plan.js:36` |
| 4 | 自动模式参考图 | 人物 ≤8、场景 ≤8，每镜 ≤2 张 | `auto-plan.js:42`；`auto-plan.js:15` |
| 5 | 单镜提示词 | ≤50000 字符 | `auto-project.js:26` |
| 6 | 单镜时长 | 仅 5/8/10 秒 | `auto-plan.js:41` |
| 7 | 角色映射键数 | ≤10（经典视图） | `film-engineering.js:42` |
| 8 | 图片生成单批 | ≤20（经典视图） | `film-engineering.js:44` |
| 9 | 视频生成单批 | ≤10（video-gen） | `video-gen.js:39` |
| 10 | 全量出片批大小 | 10 | `production-driver.js:31` |
| 11 | 全量出片总数 | ≤1000 | `film-engineering-production.js:24` |
| 12 | 回收下载单批 | ≤50，并发 4 | `film-engineering.js:45-46` |
| 13 | 分镜列表分页 | 默认 100 / 最大 200 / 全量上限 500 | `shot-library.js:29-31` |
| 14 | 自动模式单飞 | 同一时刻只允许一个自动任务 | `film-engineering-auto.js:48,304` |
| 15 | 计划 TTL | 24 小时，且首次启动即消费 | `auto-project.js:33,310` |
| 16 | 合成无后期 | 无转场/调色/字幕/音轨处理 | `film-render.js:12` |
| 17 | 产物在系统临时目录 | 会被系统清理，需另存 | `film-render.js:81-83` |
| 18 | 参考图不自动外发 | 仅生成时提交 | `spec.md:145` |
| 19 | 画布连线 | 仅支持「参考图 → 分镜」 | `zh.js:221` |
| 20 | kit 不可用 | 功能整体不可用（fail-closed，不降级） | `zh.js:115-116` |
| 21 | 上传参考图需登录 | 24 条通道里唯一的非 public 项 | `license-access-control.js:61-71` |
| 22 | LLM 增强永不生效 | 生产 DI 传 `llm: null` | `container.setup.js:468` |
| 23 | 回收原片不可用 | kit 缺 `allowedHosts`，下载必 fail-closed | `shot-downloader.js:55-57` |
| 24 | 画布无撤销/重做、无自动布局按钮 | 代码不存在 | `useFilmCanvas.js` 返回值 |
| 25 | 画布角色映射无输入框 | 只有数据结构，无 UI | `useFilmCanvas.js:40-42` |
| 26 | 自动模式单任务单飞 | 同一时刻只允许一个自动任务 | `film-engineering-auto.js:48,304` |

> **2026-10-19 修复状态**：上表第 27 条（进度阶段名显示英文 id）已于分支 `fix-film-engineering-defects` 修复，见 §3.4。第 21–25 条属**既有设计/实现现状**，本次未改动，仍按上表执行。

### 13.1 设计上的「刻意为之」（不是 bug）

| 现象 | 为什么 | 证据 |
|---|---|---|
| 改了提示词就要重新确认 | 编辑晚于确认 → 必须重过成本闸 | `auto-project.js:350-358` |
| 长任务点完立刻返回，进度靠事件 | 否则界面会挂数小时像"没反应" | `film-engineering-auto.js:324-328` |
| 停止是批间生效 | 已完成镜绝不重做，靠磁盘复核续跑 | `film-engineering-auto.js:397-398` |
| 重生成先落临时目录再校验后覆盖 | 校验不通过绝不留坏文件 | `auto-runner.js:164-237` |
| 续跑以磁盘为准而非台账 | 磁盘是事实，台账只是意图 | `production-driver.js:120-124` |
| 渲染清单缺一镜就 fail | 绝不产出缺镜假成片 | `film-render.js:9` |
| 计数器与台账差值如实暴露不修正 | 那是崩溃窗口的正常产物 | `auto-project.js:370-375` |

---

## 十四、附录

### 14.1 常量速查表

| 常量 | 值 | 位置 |
|---|---|---|
| `MAX_AUTO_SCRIPT_LENGTH` | 10000 | `auto-constants.js:8` / `auto-plan.js:37` |
| `MIN_AUTO_DURATION_SEC` | 10 | `auto-constants.js:10` / `auto-plan.js:38` |
| `MAX_AUTO_DURATION_SEC` | 600 | `auto-constants.js:11` / `auto-plan.js:39` |
| `MAX_AUTO_SHOTS` | 120 | `auto-constants.js:12` / `auto-plan.js:36` |
| `AUTO_ASPECTS` | `16x9`, `9x16` | `auto-plan.js:40` |
| `AUTO_SHOT_SECONDS` | 5, 8, 10 | `auto-plan.js:41` |
| `AUTO_DEFAULT_*` | 16x9 / 5s / 60s | `auto-constants.js:15-17` |
| `MAX_AUTO_REFS` | 8 | `auto-plan.js:42` |
| `MAX_SHOT_PROMPT_LENGTH` | 50000 | `auto-project.js:26` |
| `PLAN_TTL_MS` | 24h | `auto-project.js:33` |
| `PRODUCTION_BATCH_SIZE` | 10 | `production-driver.js:31` |
| `MAX_PRODUCTION_SHOTS` | 1000 | `film-engineering-production.js:24` |
| `FILM_ASPECTS` | `16x9`, `9x16`, `source` | `video-gen.js:40` |
| `FILM_DURATIONS` | 5, 8, 10 | `video-gen.js:41` |
| `FILM_FRAME_RATE` | 24 | `video-gen.js:43` |
| `POLL_INTERVAL_MS` | 10000 | `video-gen.js:44` |
| `POLL_DEADLINE_MS` | 600000 | `video-gen.js:45` |
| `MAX_VIDEO_BATCH` | 10 | `video-gen.js:39` |
| `DISK_ESTIMATE_BYTES_PER_SHOT` | 8MB | `auto-plan.js:44` |
| `WALLCLOCK_SECONDS_PER_SHOT` | 300 | `auto-plan.js:45` |
| `WALLCLOCK_WARN_SECONDS` | 7200 | `auto-plan.js:47` |
| `RECYCLE_CONCURRENCY` | 4 | `film-engineering.js:46` |
| 轮询间隔（自动模式前端） | 3000ms | `FilmAutoPanel.vue:40` |

### 14.2 IPC 通道全清单（26 个方法）

`window.electronAPI.filmEngineering.*`（`electron/preload/film-engineering.js`）：

| 方法 | 通道 | 用途 |
|---|---|---|
| `status` | `film-engineering:status` | kit 状态与元信息 |
| `listScenes` | `film-engineering:list-scenes` | 场景树 |
| `listShots` | `film-engineering:list-shots` | 分镜列表（分页） |
| `getShot` | `film-engineering:get-shot` | 分镜详情 |
| `doctrine` | `film-engineering:doctrine` | 方法论 |
| `copyText` | `film-engineering:copy-text` | 单镜复制（4 模式） |
| `copyTexts` | `film-engineering:copy-texts` | 批量复制 |
| `adaptScript` | `film-engineering:adapt-script` | 剧本套用 |
| `exportPrompts` | `film-engineering:export` | 导出 JSON/Markdown |
| `generateSelected` | `film-engineering:generate-selected` | 生成所选 |
| `uploadReference` | `film-engineering:upload-reference` | 参考图上传 |
| `retryShot` | `film-engineering:retry-shot` | 流水线 run 单镜重试 |
| `productionRetryShot` | `film-engineering:production-retry-shot` | 台账定位单镜重试 |
| `downloadRecycled` | `film-engineering:download-recycled` | 原片回收 |
| `productionPlan` | `film-engineering:production-plan` | 批次计划预览 |
| `productionRunBatch` | `film-engineering:production-run-batch` | 执行批次 |
| `productionStatus` | `film-engineering:production-status` | 断点视图 |
| `onProductionUpdate` | 事件 `film-engineering:production-update` | 出片进度 |
| `autoPlan` | `film-engineering:auto-plan` | 自动规划 |
| `autoStart` | `film-engineering:auto-start` | 启动/续跑 |
| `autoStop` | `film-engineering:auto-stop` | 停止（批间生效） |
| `autoStatus` | `film-engineering:auto-status` | 只读状态投影 |
| `autoUpdateShot` | `film-engineering:auto-update-shot` | 片段编辑 |
| `autoRegenerateShot` | `film-engineering:auto-regenerate-shot` | 单镜重生成 |
| `autoCompose` | `film-engineering:auto-compose` | 收口清单校验 |
| `onAutoUpdate` | 事件 `film-engineering:auto-update` | 自动模式进度 |

**权限**：24 条通道中 **23 条登记为 public**（未登录可用）——因为本地规划/执行，provider 由用户自己的模型配置决定（`license-access-control.js:61-71`；`preload.test.js:766-777`）。

> ⚠️ **唯一例外**：`film-engineering:upload-reference`（上传参考图）**未登记在 PUBLIC_CHANNELS**（`license-access-control.js:61-71` 该段逐条核对无此项）。按 `requiredLevelForChannel` 兜底规则，它按 `authenticated` 处理，**需登录后才能上传参考图**。这与「影视工程全族公开」的直觉相反，但代码如此。

### 14.3 六阶段流水线定义

`film-engineering` 流水线（`pipeline-engine.js:481-531`）：

| # | 阶段 | 类型 | 做什么 | 成本闸 |
|---|---|---|---|---|
| 1 | `load_template` | `film_load_template` | 加载 Hell Grind 影视工程模板（film-kit，fail-closed） | 否 |
| 2 | `adapt_script` | `film_adapt_script` | 剧本分场并按 Hell Grind 模板组装提示词 | 否 |
| 3 | `select_shots` | `film_select_shots` | 按选中分镜 id 过滤（kit 或 adapted） | 否 |
| 4 | `export_prompts` | `film_export_prompts` | 导出选中分镜提示词（JSON/Markdown） | 否 |
| 5 | `generate_videos` | `film_generate_videos` | 分镜视频生成（成本确认入口闸，原文直送） | **是**（`cost_confirm`） |
| 6 | `render` | `film_render` | 成片合成（concat/归一，产物 final.mp4） | 否 |

**注意**：自动模式与全量出片**不走这个引擎**（`film-engineering-auto.js:20`：执行不经 pipeline 引擎，直连 production-driver + auto-runner）；但**收口合成仍走既有 manifest 直通 run**（`FilmAutoPanel.vue:16-17`）。

### 14.4 名词对照

| 名词 | 含义 |
|---|---|
| 分镜（shot） | 一个镜头，最小出片单位 |
| 场景（scene） | 剧情段落，含若干分镜；kit 有 162 个 |
| film-kit | 随包数据资产（《Hell Grind》真实工程数据） |
| 剧本套用（adapt） | 把自己的剧情套进 Hell Grind 的提示词架构 |
| 角色槽位 | ROKO/JAXX/LULU/REIN 四个固定主角位 |
| 台账（ledger） | 出片批次的持久化记录，断点续跑的事实源 |
| 渲染清单（renderManifest） | 收口后的片段清单，用于合成 |
| 原文直送 | 提示词逐字符提交，不做润色改写 |
| 成本闸 / checkpoint | 生成前必须确认，确认前零调用零计费 |
| 断点续跑 | 以磁盘为准跳过已完成的镜 |
| 批（batch） | 10 镜一组，全量出片的执行单位 |
| 收口 | 所有批次完成、渲染清单完整，可合成 |

### 14.5 三条设计原则（理解本功能的钥匙）

影视工程是本仓里三个工程原则最完整的示范：

1. **fail-closed**：kit 不可用就整体不可用；渲染清单缺一镜就 fail；项目文件损坏就拒绝续跑——绝不降级跑空数据或产出假成片。
2. **磁盘为真**：内存态与台账都不可信，一切以磁盘实际产物裁决。
3. **粒度对齐**：成本闸的粒度 = 用户授权的粒度（确认多少镜就只生成多少镜），不相差、不相混。

---

## 相关文档

- [ARCH-FILM-ENGINEERING-2026-08-14.md](./ARCH-FILM-ENGINEERING-2026-08-14.md) — 架构设计（Hell Grind 复刻）
- [FILM-ENGINEERING-PIPELINE-OPERATIONS-2026-10-09.md](./FILM-ENGINEERING-PIPELINE-OPERATIONS-2026-10-09.md) — 代码视角深度解读（基线 `main@8b3d3e91`，六阶段引擎与安全合同部分仍有效）
- [USER-MANUAL-FILM-ENGINEERING-2026-10-07.md](./USER-MANUAL-FILM-ENGINEERING-2026-10-07.md) — 旧版用户手册 v1.0
- [USER-MANUAL-FILM-ENGINEERING-AUTO-2026-10-09.md](./USER-MANUAL-FILM-ENGINEERING-AUTO-2026-10-09.md) — 自动模式手册（film-auto-mode 分支版）
- [PRD-FILM-ENGINEERING-CANVAS-2026-09-24.md](./PRD-FILM-ENGINEERING-CANVAS-2026-09-24.md) — 画布 PRD
- [PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md](./PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md) — 全量出片 PRD
- `openspec/specs/film-engineering/spec.md` — 规格契约
