# 变更：采集页「快捷采集」（quick-collect）

## Why

采集页只有「给我一个 URL，我去抓正文」这一条路径（`Collection.collectUrl`）。而内容创作者的高频问题是
**"最近发生了什么、值不值得写"**——这类问题没有 URL，需要的是"用固定的检索指令去查最近一段时间的真实动态"。

两侧能力其实都已存在，缺的只是产品形态：

- 检索侧：`content-intelligence`（Reddit / Hacker News / GitHub，免费无 Key，条目带 `created_utc`）；
- 生成侧：`aiGenerator.generateWithDefault('llm')`（用户自己的默认大模型）。

本变更把这两侧固定成**一条可复用的「快捷采集指令」**：内置 6 条官方指令 + 用户自定义指令（可增删改），
点一下即按固定提示词采集，结果与手动采集**同形同链路**（进 `collectedItems`、可改写/草稿/爆款库/发布）。

## What Changes

- **新页签**：采集页 `采集 | 快捷采集 | 文案库 | 博主监控`，页签按钮与面板各自落在独立组件里
  （`Collection.vue` 是 `check-max-lines` 的 targets 零容差文件，本次对它净增 ≤30 行）。
- **内置指令 6 条**：`AI 领域动向`（**用户给定文本，逐字采用**，标 `provenance:'user'`）、`AI 前沿论文速览`、
  `热点选题雷达`、`创作工具与效率新品`、`同行内容与形式趋势`、`AI 实操技巧与工作流`（其余 5 条为依 PRD 场景
  推演的产品内容，标 `provenance:'agent'`）；只读、不落盘、不可编辑删除。
  （2026-10-11 更正：原 `平台规则与合规动向`/`舆情风险与避雷` 两条是 agent 推演、并非用户要求，已分别替换为
  `AI 前沿论文速览`/`AI 实操技巧与工作流`，见 change `quick-collect-preset-refresh`。）
- **自定义指令 CRUD**：标题 + 指令正文（含默认示例文案）+ 可选检索关键词 + 素材时间范围；
  落盘 `store` 键 `quick_collect_commands`（`{version:1,commands:[...]}`），读时容错 + 逐条校验。
- **主进程执行链**：`quick-collect-presets` / `-command`（校验归一）/ `-materials`（合并去重窗口协议判据）/
  `-prompt`（提示词 + 无素材声明行）/ `-engine`（编排，依赖注入可测）。
- **IPC + preload**：`quick-collect:list-presets`、`quick-collect:run`（`withSenderCheck`）、
  `quick-collect:progress` 事件；preload 三个扁平方法并重生成 `index.bundle.js`。
- **渲染端**：`src/api/quick-collect.js` 桥接 + `useQuickCollectCommands` composable + 面板/弹窗组件；
  结果经 `normalizeCollectedItem` 出口入列表（新增 `quickCollect` 溯源字段透传）并自动切到采集页签复用同一结果卡。
- **i18n**：`src/locales/collection/{zh,en}.js` 成对新增用户可见文案；内置指令正文属产品内容，留在主进程
  （不进渲染端 CJK 扫描面）。

## Impact

- 受影响面：`apps/desktop/electron/services/quick-collect-*.js`（5 个新模块 + 测试）、
  `apps/desktop/electron/ipc-handlers/quick-collect.js`、`apps/desktop/electron/ipc-handlers/index.js`（1 行注册）、
  `apps/desktop/electron/bootstrap/phase5-ipc.js`（依赖透传 1 处 + 1 行）、
  `apps/desktop/electron/preload/quick-collect.js` + `preload/index.js` + `index.bundle.js`、
  `apps/desktop/src/api/quick-collect.js`、`src/features/collection/quick-collect-*`、
  `src/features/collection/collected-item.js`（新增字段透传）、`src/views/Collection.vue`（≤30 行）、
  `src/locales/collection/{zh,en}.js`、`01-docs/PRD-QUICK-COLLECT-2026-10-11.md`、
  `openspec/changes/quick-collect/**`、`openspec/records/quick-collect.md`、`.quality-gates.md`、
  `scripts/gate-record-debt-ledger.json`、`CHANGELOG.md`。
- **不受影响且不得触碰**：`content-intelligence`（三个源与相关性门禁、缓存键策略）、
  `collected_items` 存储键与既有条目形状、`publish`/`rpa`/`taskQueue` 全链路、
  `config/platforms.yaml`、`publish-capabilities.json`、`platform-definitions.js`。
- 破坏性：**无**。既有采集条目无 `quickCollect` 字段时照常显示；不新增依赖、不新增配置项、不新增网络源。
- 风险：① 无素材时模型可能"补事实" ⇒ 提示词硬约束 + 引擎侧机器声明行（`retrieval=empty/skipped` 时正文首行声明）；
  ② 指令正文可能含私密业务方向 ⇒ 日志只记源名与计数，不记指令原文；③ 检索源仅英文三源 ⇒ PRD §13 如实登记覆盖面限制。

## 评审与门禁

- 复杂度/风险自评：M / 中（新增 IPC 通道 + 新增落盘键 + 新增模型调用出口），按仓库铁律建本 change 并走完整质量节拍。
- 实现期门禁：TDD（先测后码）、变异反证（守卫改 no-op 必须指名变红）、静态门禁（ipc-bridge / ipc-sender-guard /
  locale-sync 三档 / max-lines / eslint）、QM-1 打包（build:dir + asar 核对）、QM-4 视觉（若页签导致像素变化）。
