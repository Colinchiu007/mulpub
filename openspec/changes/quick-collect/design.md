# 设计：快捷采集（quick-collect）

## 1. 决策记录（含备选与理由）

### D-1 前端入口用独立页签，而不是命令条或一级页面

- **备选 A**：采集页顶部横向命令条 —— 采集页已有 5 个信息块（URL 采集、批量采集、知乎收藏夹、结果列表、草稿箱），
  再叠命令条会把"输入—结果"的视觉主线打散；且 6+ 条自定义指令的 CRUD 无处安放。
- **备选 C**：独立一级页面（新路由 + 侧边栏项）—— 需要动路由与侧边栏（两处门禁面），
  而且「快捷采集」与「采集」是同一心智模型的两个阶段，拆开徒增导航成本。
- **决定 B**：独立页签。先例是「博主监控」页签（`CollectionCreatorTab.vue` + `CreatorMonitor.vue`），
  同构实现零新范式。

### D-2 结果不另做一套 UI，执行后切回「采集」页签

结果卡绑定 10+ 个 `ref`（改写策略、字数区间、爆款库开关、创建草稿、发布……）。复制一份必然漂移
（本仓库对"第二份实现/装饰性链路"有明确禁令，见 AGENTS.md）。因此面板只 emit 结果条目，
由 `Collection.vue` 的一个 7 行 handler 走既有出口：`normalizeCollectedItem` → `unshift` → `saveCollectedItems` → `switchTab('collect')`。

### D-3 检索复用 `content-intelligence`，不新建第二套抓取

`content-intelligence.search()` 已经承担"跨源检索 + 相关性门禁 + 缓存"三件事，且被
`intelligence:*` 通道与标签建议共用。另写一份 fetch 会立刻产生"两套相关性口径"，与 AGENTS.md 的
「聚合外部搜索源的展示面必须有语义相关性判据」条款直接冲突。因此引擎只以**注入的 `searchFn`** 消费它。

已知取舍：该实现自带 5 分钟缓存，快捷采集要求"最近动态"，故调用时显式传 `noCache: true`。

### D-4 时间窗口过滤放在引擎侧，不修改数据源

数据源的 `_search*` 方法把 `t: 'month'`（Reddit）等窗口写死在自己的查询里，
改它们会牵动 `content-intelligence.test.js` 的既有断言与标签建议的语义。
因此窗口过滤由引擎在**合并后**执行：`createdUtc >= now - windowHours*3600`，缺时间戳的素材丢弃。

### D-5 无素材时仍调用模型，但由引擎插入声明行

- **备选**：素材为空时直接返回"未检索到"，不调模型。
- **问题**：用户指令常常包含"找不到可靠信息就如实说"，一句冷冰冰的系统文案会丢掉指令里的处置要求
  （比如"告诉我该换哪些关键词"）。
- **决定**：仍然调用模型，把「本次未获得素材」写进提示词，并在正文首行由**引擎**插入声明行。
  声明行不交给模型自由发挥（模型可能漏掉或改写成含糊表述）。若模型正文已自述"未检索到/未联网"，则不重复插入。

### D-6 自定义指令落 `store` 设置键（渲染端读写），不新增主进程存储服务

`collected_items` 就是这么存的（`storeGetSetting`/`storeSetSetting`），同一通道 = 同一备份/清理语义。
主进程只在执行时收一次性 payload，不持有指令状态 ⇒ 引擎无状态、可注入、可测。

### D-7 内置指令在主进程

两个理由：① 内置词条是**产品内容**（6 段长提示词），放渲染端会进 CI 的渲染端 CJK 硬编码扫描面；
② 版本升级时内置词条必须能随应用更新，落盘副本会盖住新版本 ⇒ 内置指令**不落盘**，
读设置时过滤掉 `builtin === true` 的残留条目。

### D-8 依赖注入而非 container 注册

引擎构造签名 `createQuickCollectEngine({ searchFn, llmFn, log, now })`。
生产接线在 `bootstrap/phase5-ipc.js` 里把 `contentIntelligence` 与 `aiGenerator` 传进 handler deps
（二者已在 context 中）；测试注入假源，零出网。

## 2. 数据流

```
QuickCollectPanel.vue
  ├─ useQuickCollectCommands (CRUD + 落盘)
  │     ├─ quickCollectListPresets() ──► ipc quick-collect:list-presets ──► quick-collect-presets.js
  │     └─ storeGetSetting('quick_collect_commands') / storeSetSetting(...)
  └─ quickCollectRun(command) ──► ipc quick-collect:run ──► engine.run(command)
                                                              ├─ validateCommand（同口径复用）
                                                              ├─ searchFn(keyword, {sources, limit, noCache, relevanceOn})
                                                              ├─ mergeMaterials（去重 / 窗口 / safeHttpUrl / 排序 / 截断）
                                                              ├─ buildMessages（system + 指令 + 素材 + 输出要求）
                                                              ├─ llmFn({messages, temperature, max_tokens})
                                                              └─ assembleItem（+ 声明行 + quickCollect 溯源）
  └─ emit('collected', item) ──► Collection.vue: normalizeCollectedItem → collectedItems → 落盘 → switchTab('collect')
```

## 3. 模块边界

| 模块 | 职责 | 纯函数? | 行数预算 |
| --- | --- | --- | --- |
| `quick-collect-presets.js` | 6 条内置指令（冻结 + 深拷贝出口） | 是 | <300 |
| `quick-collect-command.js` | 校验（返回领域码）、归一（trim/去重/截断）、`newCustomId` | 是 | <160 |
| `quick-collect-materials.js` | 合并、url 去重、时间窗口、协议判据、排序截断、窗口过滤统计 | 是 | <160 |
| `quick-collect-prompt.js` | `buildMessages` + `buildDisclaimerLine` + `shouldPrependDisclaimer` | 是 | <160 |
| `quick-collect-engine.js` | 编排 + 进度 + 错误码 + 条目装配 | 否（注入 IO） | <220 |
| `ipc-handlers/quick-collect.js` | 2 通道 + 进度事件 + 依赖降级 | 否 | <120 |
| `src/features/collection/quick-collect-commands.js` | 前端纯逻辑（校验文案键、编解码、合并、排序） | 是 | <260 |
| `useQuickCollectCommands.js` | 加载/CRUD/落盘/状态 | 否 | <200 |
| `QuickCollectPanel.vue` | 列表 + 执行态 + 错误态 | 否 | <400 |
| `QuickCollectCommandDialog.vue` | 表单 + 校验 + 计数器 | 否 | <320 |

## 4. 风险与回退

| 风险 | 处置 | 回退 |
| --- | --- | --- |
| 模型在无素材时编造 | 提示词硬约束 + 引擎声明行 + `quickCollect.retrieval` 随条目留痕 | 关闭入口（删页签一行）即回到现状 |
| 检索源在用户网络下不可达 | 与 `content-intelligence` 同表现（返回空）；正文声明"未检索到" | 同上 |
| 指令正文含私密方向被写进日志 | 日志只记 `sources`/`count`/`stage` | — |
| `Collection.vue` 行数门禁（targets 零容差） | 组件外置 + 1 行 import + 1 行页签 + 1 行面板 + 7 行 handler，净增 ≤30 | 若超限，把 handler 也移进 composable（面板 emit 后由 composable 提供回调） |

## 5. 与既有不变量的关系

- **IPC 单轨制**：渲染端只经 `src/api/quick-collect.js`；新通道在 `check-ipc-bridge` 中成对出现。
- **sender 守卫**：`quick-collect:run` 显式 `withSenderCheck`（触发付费模型调用，与 `ai:generate` 同级）。
- **i18n 成对**：所有 UI 文案进 `locales/collection`，内置指令正文留在主进程。
- **行数门禁**：本次所有新增文件均 <500 行；`Collection.vue` 净增 ≤30 行（targets 2920 零容差）。
- **既有语义不动**：`content-intelligence`、`collected_items`、发布/RPA/队列链路一律不改。
