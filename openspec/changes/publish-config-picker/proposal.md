## Why

「去发布」浮窗（`components/PublishDestinationModal.vue`）是改写页 / 采集页 / 热门选题页共用的发布去向选择器，它的视频创作分支里只有「流水线选择」，**没有「配置选择」**。结果是：

1. 创作页里已有的「配置档案」能力（保存/我的配置/应用/重命名/删除，规格见 `openspec/specs/story2video-pipeline-config-profiles/spec.md`）**只能在创作页内部进入**。用户从「去发布」跳过去后还要再点「我的配置」→「应用」→ 二次确认，多两步且容易忘——配置这项能力事实上只服务「已经在创作页里干活」的人。
2. 流水线下拉写死只有「故事讲述」一个选项（`pipelineOptions` prop 默认值，三个调用方都没覆盖），用户想用其它流水线必须关弹窗、进创作页重选，选择器形同虚设。
3. 热门选题页的「生成视频」去向最终跳 `/create?draft=<id>`，**不带流水线**——弹窗里选的流水线被静默丢弃。这条既有的断链也直接卡住第 1 点：配置档案按流水线分域，没有流水线就无从判断该套哪条流水线的配置。

先澄清一个常见误解：**「只有故事讲述有配置管理」并不成立**。逐条核对（见 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md` §1.2 / §10.2）后确认，配置档案已经覆盖**全部**视频创作流水线——创作页共享分支（编排型 + legacy 型）、视频克隆页、影视工程页都有。缺的是**入口**：配置在「去发布」这一步选不到。因此本 change 的重点是「把已有能力接出去」，不是重复造一套配置管理。

## What Changes

- **「去发布」浮窗新增「配置选择」下拉**（与「流水线选择」并排，位于其下一行）：
  - 选项来源 = 主进程 `story2video:config-profile-list`（设备级 `userData` 持久化），按 `pipelineId` 过滤、`updatedAt` 倒序；非法条目逐条丢弃、其余保留。
  - **该流水线一条配置都没有时：触发器显示「默认」且不可展开（下拉内容为空）**，并给出一行说明「该流水线还没有保存过配置，可在创作页用「保存配置」创建」。
  - 有配置时菜单首项恒为「默认」（= 不套用任何配置，用流水线默认参数），其后是各条已保存配置。
  - 加载中 / 加载失败 / 无配置三态互斥且都有可见文案，**加载失败不被伪装成「没有配置」**。
  - 自建下拉（不引 Element Plus）：与左侧原生 `<select>` 同套视觉，且遵守本仓 EP「显式按需装配」硬约束（先例：`components/HotTopicsGenVideoPicker.vue`）。
- **流水线下拉扩为全部文案型视频创作流水线**（`story2video-compose` `talking-head` `localization-dub` `animated-explainer` `documentary-montage` `animation` `character-animation` `hybrid` `avatar-spokesperson`），判据与创作页「带文案进入时灰显非文案型」同源；为此给 `@/i18n/pipeline-labels` 补只读导出 `TEXT_BASED_PIPELINE_IDS`（枚举与判定共用一份真源）。
- **`publish-video` 事件扩展**：第 1 个参数仍是流水线 id（既有调用方零改动兼容），第 2 个参数新增 `{ configProfileId, configProfileName }`。
- **交接契约收敛到一处**：新增 `features/publish-destination/publish-destination-config.js`，提供 `buildCreateHandoffQuery()`（`draft` / `pipeline` / `configProfile` 三个 query 键的唯一构造入口；空值或非法值一律**不带该键**，绝不传空串）。
- **三个入口都把配置档案带到创作页**：改写页、采集页补 `configProfile`；热门选题页顺带修好 P3 断链（最终跳转补上 `pipeline` 与 `configProfile`）。
- **创作页自动套用**：新增 `CreateView._applyConfigProfileFromRoute()`，在「选中流水线」之后执行，复用既有 `applyS2VConfigProfileSnapshot()`（枚举归一化 / 失效服务商回退 / 分辨率归一等语义全部复用，不新增第二套套用逻辑）。
- **修掉一处竞态**：创作页的「恢复上次选项」与本片的「套用配置档案」写同一份表单，并发时后写者胜；把恢复的 promise 留住并在套用前 `await` 它，保证**配置档案（用户显式选择）必胜**。
- **失败路径全部可见**：配置已删除 / 跨流水线 / 套用失败 / 无法确定流水线，四种各有提示文案，且**都不阻断创作**。
- **新增 locale**：`publishDestination.configLabel` / `configDefaultOption` / `configEmpty` / `configLoading` / `configLoadFailed`，`create.story2video.configProfile.notFound`（zh/en 成对）。
- **文档**：`01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md`（详细 PRD：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 / 边界 / 验收 / 测试映射）、`01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §9.11、`01-docs/CHANGELOG.md`、本 change 的 `tasks.md` / `design.md` / `spec.md` 与 `openspec/records/publish-config-picker.md`。

## Capabilities

- 新增：`publish-destination-config-picker`（「去发布」浮窗的流水线/配置选择与交接）
- 不改动：`story2video-pipeline-config-profiles`（配置档案服务契约与 IPC 通道本片只消费、不修改）

## Impact

> 下面这份清单是**声明范围**（CCG 决策层据此判「范围漂移」），必须与本 change 实际落地的文件一致。
> 实施中途新增/拆分出来的文件**也要在这里点名**——决策层只认声明，认不到声明就报漂移。

- 渲染层：
  - `components/PublishDestinationModal.vue`（新增配置选择器接线、流水线下拉改用文案型全集、`publish-video` 增加第 2 个载荷参数）
  - `components/PublishDestinationConfigPicker.vue`（**新增**：配置选择器控件本体。从浮窗里拆出来的原因是 `PublishDestinationModal.vue` 触到 `check-max-lines` 的 500 行上限）
  - `views/RewriteView.vue` / `views/Collection.vue` / `views/HotTopics.vue`（交接 query 带配置档案；热门选题页顺带修好流水线断链）
  - `views/CreateView.vue`（新增 `_applyConfigProfileFromRoute()`；`selectPipeline` 留住恢复 promise；mounted 串接套用）
- 新增模块（`features/publish-destination/`）：
  - `publish-destination-config.js`（纯函数：归一化 / 过滤 / 选中解析 / 载荷与 query 构造）
  - `apply-config-profile-handoff.js`（**新增**：创作页的套用流程。从 `CreateView.vue` 里抽出来的原因是它触到 `check-debt-budget` 的「单文件最大行数只降不升」）
  - `publish-destination-config.test.js`（**新增**：纯函数回归锁）
- 测试：
  - `components/PublishDestinationModal.test.js`（既有 7 例 + 新增 7 例）
  - `views/CreateView.config-profile-handoff.test.js`（**新增**：创作页交接 4 例）
- i18n：`locales/publish-destination/{zh,en}.js`（5 键）、`locales/create/{zh,en}.js`（2 键：`notFound` / `pipelineUnresolved`）
- 共享只读导出：`i18n/pipeline-labels.js`（`TEXT_BASED_PIPELINE_IDS`）
- 文档：`01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md`（**新增**）、`01-docs/PRD-S2V-PIPELINE-PAGE-UX.md`（§14）、`openspec/records/publish-config-picker.md`（**新增**）、本 change 的 `proposal.md` / `tasks.md` / `design.md` / `specs/publish-destination-config-picker/spec.md`
- **不改动**：主进程 `services/story2video-config-profiles.js`、`ipc-handlers/story2video.js` 的四个 `story2video:config-profile-*` 通道、`preload/publish.js`、`components/ConfigProfileManager.vue`、`api/publisher.js`、根级 `CHANGELOG.md` 与 `01-docs/learnings.md`（热写面已由 `scripts/aggregate-changelog.js` 收敛，条目真源在本 change 的执行记录里）
