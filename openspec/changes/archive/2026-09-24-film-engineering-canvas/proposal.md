## Why

当前影视工程（film-engineering）桌面页是三栏浏览器式界面（场景树 / 分镜列表 / 详情面板），它把底层已经建好的能力（剧本套用引擎 `adaptScript`、六阶段流水线、逐镜出片、合成）摊成了一堆需要用户手动点选的控件——**用户要理解 Hell Grind 工程方法、自己勾分镜、自己走阶段，实操门槛极高，"一个剧本直接套流水线"的核心价值被界面埋没了**。行业里成熟的短剧创作工具（火宝画布、影策等）早已用"节点连线画布"把这类多阶段生成流水线可视化：用户只投喂剧本与参考图，拆分镜、连参考、逐镜出图出片在一张图上就地发生。我们要把这套交互范式引进来，让底层引擎能力真正变成"填剧本就能跑通到成片"的实操流水线。

## What Changes

- **新增**：桌面端影视工程改为**节点连线画布**（基于 Vue Flow / MIT）——剧本节点、人物/场景参考图节点、分镜节点、图片/视频产物节点，可拖拽连线，连线即把上游产物自动注入下游生成输入。
- **新增**：**初始拆分镜流**——用户在起始面板填入剧本文本、上传人物参考图与场景参考图、选好选项（画幅/时长/角色映射/LLM 润色），下一步流水线用既有 `adaptScript` 自动把剧本拆成分镜并以分镜节点铺到画布上。
- **新增**：**参考图喂给生成**——用户上传的本地图经新 IPC 通道落盘到受控媒体根，作为 provider 的图生图/一致性参考输入（扩展既有 `generateSelected` / 视频生成入参以携带本地参考）。
- **新增**：画布上就地驱动**全链路到成片**（拆分镜 → 编辑分镜 → 逐镜出图/出片 → 合成 final.mp4），复用既有六阶段流水线与成本 checkpoint，不新造引擎。
- **BREAKING（界面层）**：**废弃** `FilmEngineeringView.vue` 三栏视图，由画布视图取代；底层 IPC 与数据契约保持不变，仅前端交互契约改写。
- 明确**不改**运营中心（ops-center）：本能力全部在 Electron 桌面端实现。

## Capabilities

### New Capabilities
<!-- 无新增独立能力域；画布交互与参考图喂生成均归属既有 film-engineering 能力的需求演进。 -->
（无）

### Modified Capabilities
- `film-engineering`: 前端交互契约从"三栏视图"改写为"节点连线画布 + 初始拆分镜流"；新增"参考图上传与喂给生成"与"画布节点连线数据模型（连线即上游注入下游）"两类需求。引擎侧既有需求（film-kit 校验、剧本套用、六阶段流水线、分镜视频生成、成本 checkpoint、成片合成、全量分批、resultUrl 下载）保持不变，不重复规格化。

## Impact

- **前端**：`apps/desktop/src/views/`（新增画布视图，废弃三栏 `FilmEngineeringView.vue`）、`composables/`（新增 useFilmCanvas，复用 useFilmEngineering/useFilmVideoGen/useFilmProduction）、路由 `/film-engineering` 指向画布。
- **依赖**：新增 `@vue-flow/core` + `@vue-flow/background` + `@vue-flow/controls` + `@vue-flow/minimap`（MIT）。
- **IPC/preload**：`apps/desktop/electron/preload/film-engineering.js` 与主进程 handler 新增"参考图上传落盘"通道（sender 校验 + 入参校验 + 受控媒体根落盘），并扩展 generate 入参携带本地参考；既有通道签名保持兼容。
- **文档**：`docs/features/` 影视工程 PRD 补画布交互与参考图喂生成细则；`openspec/specs/film-engineering/spec.md` 经 sync 吸收本次增量。
- **合规**：huobao-canvas（CC BY-NC-SA）、影策（AGPL）仅作交互设计参考，不复制任何代码；底座与可 vendored 片段限于 MIT 来源。
