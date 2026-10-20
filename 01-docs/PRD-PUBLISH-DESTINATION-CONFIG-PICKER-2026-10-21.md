# 「去发布」弹窗「配置选择」PRD（publish-config-picker）

> **状态**：已实现，待合并验收
> **日期**：2026-10-21
> **分支**：`publish-config-picker`
> **关联 OpenSpec**：`openspec/changes/publish-config-picker/`
> **适用范围**：桌面端「去发布」浮窗（`components/PublishDestinationModal.vue`）与其三个入口（改写页 / 采集页 / 热门选题页）、视频创作页（`views/CreateView.vue`）的配置档案套用
> **关联既有规格**：`openspec/specs/story2video-pipeline-config-profiles/spec.md`（配置档案服务契约，本片不改动该契约，只消费它）

---

## 1. 背景与问题陈述

### 1.1 现状

「去发布」浮窗（`PublishDestinationModal.vue`）是改写页、采集页、热门选题页共用的**发布去向选择器**，只有两个去向：「直接发图文」与「生成视频」。视频创作分支里挂着一个「流水线选择」下拉。

现状有三个问题：

| # | 问题 | 用户可感知的现象 |
|---|---|---|
| P1 | 流水线下拉只有「故事讲述」一个选项 | 组件 `pipelineOptions` prop 默认写死 `[{ value: 'story2video-compose', label: '故事讲述' }]`，且三个调用方**都没有**覆盖它。用户想用「口播视频」「AI 讲解视频」等其它流水线，必须先关掉弹窗、进创作页、重新选流水线——弹窗里的选择器形同虚设。 |
| P2 | 没有「配置」入口 | 创作页每条流水线都有「保存配置 / 我的配置」（**配置档案**，config profile，见 `openspec/specs/story2video-pipeline-config-profiles/spec.md`），可以把当前全部选项存成有名字的组合配置并一键套用。但这个能力**只能在创作页内部进入**：用户从「去发布」跳过去之后，还要再点「我的配置」→「应用」→ 二次确认，多两步且容易忘。于是「配置」这个功能事实上只服务于「已经在创作页里干活」的人。 |
| P3 | 热门选题页丢失所选流水线 | 热门选题页的「生成视频」去向最终跳 `/create?draft=<id>`，**不带流水线**。用户在弹窗里选的流水线被静默丢弃（选了等于没选）。这条既有的断链也直接卡住 P2：配置档案按流水线分域，没有流水线就无从知道该套哪条流水线的配置。 |

### 1.2 「其它流水线有没有配置管理」的结论

本片开工前逐条核对（核对口径见 §10.2），结论是：

> **不是只有「故事讲述」有配置管理。** 截至本片开工，配置档案（保存/我的配置/应用/重命名/删除）已经覆盖**全部**视频创作流水线，分三种承载形态：

| 承载形态 | 覆盖的流水线 | 实现位置 |
|---|---|---|
| 创作页共享分支（编排型） | `story2video-compose`（故事讲述） | `views/CreateView.vue` 的操作条辅助区 + `views/video-creation/S2vConfigPanels.vue` |
| 创作页共享分支（legacy 型） | `talking-head` `localization-dub` `animated-explainer` `documentary-montage` `animation` `character-animation` `hybrid` `avatar-spokesperson`（即除故事讲述外的全部文案型流水线，以及素材型流水线的 legacy 配置段） | 同上（「保存配置 / 我的配置」按钮的显示条件是 `v-if="selectedPipeline?.name"`，与流水线类型无关） |
| 独立页面 | `video-clone`（视频克隆）、`film-engineering`（影视工程） | `views/VideoCloneView.vue`、`views/FilmEngineeringView.vue` + 复用组件 `components/ConfigProfileManager.vue` |

也就是说：**「每条流水线都有配置管理」这件事本身已经成立**（既有规格 `story2video-pipeline-config-profiles` 的 Requirement「All video creation pipelines expose managed configuration profiles」即为此契约）。

真正缺的是 **P2 的入口**：配置档案在「去发布」这一步**选不到**。本片因此把重点放在「让配置档案在去发布这一步可被选中并落到创作页」，而不是重复造一套配置管理。

### 1.3 本片要解决的问题

| # | 目标 | 验收口径 |
|---|---|---|
| G1 | 「去发布」浮窗的视频创作分支，在「流水线选择」旁增加一个**配置选择**下拉，列出**所选流水线**已保存的配置档案 | 见 §3.3 |
| G2 | 该流水线**一条配置都没有**时，下拉框显示文字「默认」，且**下拉内容为空** | 见 §3.3.3 |
| G3 | 所选配置随导航带到创作页并**自动套用** | 见 §3.5 |
| G4 | 流水线下拉扩为全部**文案型**视频创作流水线（与创作页「带文案进入时灰显非文案型」同一判据） | 见 §3.2 |
| G5 | P3 的断链一并修好（热门选题页也把流水线带过去） | 见 §3.4.3 |

---

## 2. 目标 / 非目标

### 2.1 目标

1. 把「配置档案」这条已有能力接到「去发布」这一步，形成闭环：**改写/采集/选题 → 选流水线 → 选配置 → 进创作页即带着这套选项**。
2. 让「流水线选择」真正可选（文案型全集），并让「配置选择」随流水线联动。
3. 全部失败路径都**对用户可见**：配置列表加载失败、配置已被删除、配置属于别的流水线——三态各有提示文案，绝不静默降级成「什么也没发生」。

### 2.2 非目标（明确不做）

| 不做 | 原因 |
|---|---|
| 配置的云同步 / 账号同步 / 跨设备备份 | 既有配置档案是**设备级本地**（`userData/story2video-config-profiles/config-profiles.json`），本片沿用同一语义；声称同步就是撒谎。 |
| 在「去发布」浮窗里新增「保存配置 / 重命名 / 删除」 | 弹窗只做「选」。配置管理仍在创作页 / 视频克隆页 / 影视工程页，避免同一个配置有两套管理面。 |
| 改配置档案的持久化格式、主进程服务或 IPC 契约 | `electron/services/story2video-config-profiles.js` 与 `story2video:config-profile-*` 四个通道**一字不改**，本片只消费。 |
| 把素材型 / 录屏型 / 内部冒烟流水线放进下拉 | 这条入口带的是「一段改写文案」；`clip-factory` / `cinematic` / `screen-demo` / `framework-smoke` 等接不了文案（创作页对它们是灰显的），放进去只会让用户选到跑不起来的项。 |
| 改发布页（图文去向）的任何行为 | 「直接发图文」与本片无关，`publish-article` 事件契约不变。 |
| 改造流水线选择器本身的交互 | 仍是原生 `<select>`，只换选项集合。 |

---

## 3. 交互与功能逻辑

### 3.1 浮窗结构（视频创作分支）

```
┌─ 选择发布去向 ─────────────────────────────── ✕ ┐
│ 改写内容已存入草稿箱，请选择下一步操作            │  ← 既有「已存草稿」披露（role=status）
│                                                 │
│ ┌─ 🖼️ 直接发图文 ────────────────────────────┐  │
│ │ 打开图文发布页，改写内容将自动填入文案输入框  │  │
│ └───────────────────────────────────────────┘  │
│ ┌─ 🎬 生成视频 ──────────────────────────────┐  │
│ │ 打开视频创作流水线页，改写文本将自动填入…    │  │
│ └───────────────────────────────────────────┘  │
│   流水线选择  [ 故事讲述          ▾ ]           │  ← 既有控件，选项集合扩大（§3.2）
│   配置选择    [ 默认              ▾ ]           │  ← 本片新增（§3.3）
│                该流水线还没有保存过配置，可在…    │  ← 仅在无配置时出现的一行说明
└─────────────────────────────────────────────────┘
```

- 「流水线选择」与「配置选择」**同一行内并排**（标签在左、控件在右），两者垂直对齐、同一字号与边框。
- 「配置选择」在「流水线选择」**下一行**（窄屏时自然换行），避免两行标签挤在一行 560px 宽的浮窗里。
- 「配置选择」为空态时，控件不可展开（`disabled`），但**仍然渲染**——用户必须能看到「这里有一个配置选择，只是现在没有可选项」。

### 3.2 流水线选择（G4）

| 项 | 规则 |
|---|---|
| 选项集合 | 默认取**文案型**视频创作流水线全集：`story2video-compose` `talking-head` `localization-dub` `animated-explainer` `documentary-montage` `animation` `character-animation` `hybrid` `avatar-spokesperson`（真源：`@/i18n/pipeline-labels` 的 `TEXT_BASED_PIPELINE_IDS`） |
| 判据一致性 | 与创作页「带文案进入时灰显非文案型流水线」用的是**同一个** `isTextBasedPipeline` 判据；本片为它补了只读导出 `TEXT_BASED_PIPELINE_IDS`，避免调用方另抄一份名单（双源真相） |
| 默认选中 | `story2video-compose`（故事讲述）—— 保持既有行为不变 |
| 空占位项 | 保留既有 `disabled` 的 `-- 选择流水线 --` 占位项（不可选中，避免静默回落） |
| 覆盖方式 | `pipelineOptions` prop 传数组时完全由调用方决定（既有调用方零改动兼容） |
| 显示名 | 走 locale（`pipelines.names.<id>`），随界面语言切换 |

### 3.3 配置选择（G1 / G2）——本片核心

#### 3.3.1 选项来源

- 数据源：主进程 IPC `story2video:config-profile-list`（**全部**档案，一次拉全）。
- 过滤：按 `profile.pipelineId === 当前所选流水线` 过滤。
- 排序：按 `updatedAt` 倒序（与创作页「我的配置」列表同序，新建的在前）。
- 归一化：非法条目（id 不匹配 `/^[A-Za-z0-9-]{8,64}$/`、名称 trim 后为空、`pipelineId` 不匹配 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`）**逐条丢弃**，其余保留——不因一条坏数据让整列表变空。

#### 3.3.2 联动规则

| 触发 | 行为 |
|---|---|
| 切换流水线 | ① 配置选项列表立即换成新流水线的；② **原先选中的配置作废**（回到「默认」）。配置档案按流水线分域，跨流水线套用是错误语义。 |
| 配置在库里被删/改名 | 选中项回落成「默认」，不留「指向不存在档案」的悬空选中态。 |
| 弹窗每次打开 | 重新拉一次配置库——用户可能刚在创作页存了新配置。 |

#### 3.3.3 空态（G2）：「默认」+ 下拉内容为空

> 需求原文：「如果还没有添加过配置，下拉选择框中就显示文字『默认』，下拉内容中为空。」

实现口径（逐条对应）：

| 需求措辞 | 实现 |
|---|---|
| 「下拉选择框中就显示文字『默认』」 | 触发器按钮的**当前值文本** = 「默认」（`publishDestination.configDefaultOption`）。这是该状态下**唯一**的入口文案。 |
| 「下拉内容中为空」 | 该流水线零配置时：触发器 `disabled`（不可展开）⇒ **下拉菜单节点根本不渲染**（`v-if="configMenuOpen"` + 选项为空），展开内容为空。 |
| （补充）为什么不只显示一个空框 | 空框对用户零信息量。所以额外给一行说明：「该流水线还没有保存过配置，可在创作页用「保存配置」创建」——告诉用户**为什么**没有可选项、下一步去哪创建。 |

#### 3.3.4 有配置时的菜单

菜单第一项恒为「默认」（= 不套用任何配置，用流水线默认参数），其后是各条已保存配置（名称）。这样用户选完还能退回「不套用」。

> 说明：为什么用**自建下拉**而不是 `el-select`：① 与左侧原生 `<select>` 保持同一套视觉与交互（同一个弹窗里两种控件会明显割裂）；② 本仓 Element Plus 是**显式按需装配**（`plugins/element-plus.js` 硬约束①：新增 EP 组件必须登记），为一个轻量浮窗引入 EP 下拉会扩大装配面与样式闭包；③ 仓内已有同款先例（`components/HotTopicsGenVideoPicker.vue` 明确写了「不用 el-dropdown/el-popover：Element Plus 按需注册有机械锁，本地自建菜单零新依赖、零样式导入」）。

#### 3.3.5 加载态与失败态

| 状态 | 触发器显示 | 说明行 | 可选 |
|---|---|---|---|
| 加载中 | 「默认」 | 「正在加载配置…」 | 否（`disabled`） |
| 加载失败（IPC 报错或返回码非 0） | 「默认」 | 「配置列表加载失败，暂时无法选择配置」 | 否（`disabled`） |
| 加载成功但该流水线无配置 | 「默认」 | 「该流水线还没有保存过配置，可在创作页用「保存配置」创建」 | 否（`disabled`） |
| 加载成功且有配置 | 「默认」或所选配置名 | 无 | 是 |

三态互斥，**绝不静默**：加载失败不会被伪装成「没有配置」。

### 3.4 提交与交接

#### 3.4.1 事件契约

`publish-video` 事件：

| 位置 | 载荷 | 说明 |
|---|---|---|
| 第 1 个参数 | `pipelineId: string` | **保持不变**——既有调用方零改动兼容 |
| 第 2 个参数（新增） | `{ configProfileId: string, configProfileName: string }` | 未选配置时两者都是空串 |

#### 3.4.2 跳转到创作页的 query

真源：`features/publish-destination/publish-destination-config.js` 的 `buildCreateHandoffQuery()`（弹窗侧与创作页侧的**唯一**契约，三个入口共用，避免键名漂移导致配置静默丢失）。

| query 键 | 值 | 缺省时 |
|---|---|---|
| `draft` | 草稿 id | 空 ⇒ **不带该键**（调用方据此放弃跳转，而不是带空串过去） |
| `pipeline` | 流水线 id | 空 ⇒ **不带该键**（创作页走默认选择流程） |
| `configProfile` | 配置档案 id | 空或非法 ⇒ **不带该键**（= 不套用任何配置）。**不传空串**：空串会被创作页当成「指定了一个叫空串的配置」而报「配置不存在」。 |

#### 3.4.3 三个入口的具体行为

| 入口 | 既有行为 | 本片 |
|---|---|---|
| 改写页 `views/RewriteView.vue` | `onPublishVideo(pipelineId)` → `/create?draft=<id>&pipeline=<pid>` | 追加 `configProfile=<id>`（有选时） |
| 采集页 `views/Collection.vue` | `onPublishVideo(pipelineId)` → `/create?draft=<id>&pipeline=<pid>` | 追加 `configProfile=<id>`（有选时） |
| 热门选题页 `views/HotTopics.vue` | `onPublishVideo(pipelineId)` → 批量改写 → `goToDestination()` → `/create?draft=<id>`（**丢流水线**） | 流水线与配置档案随队列项一路带到最终跳转：`/create?draft=<id>&pipeline=<pid>&configProfile=<id>` |

热门选题页的修复是**必须的**，不是顺手改：配置档案按流水线分域，没有流水线就无法判断「这条配置属不属于当前流水线」，P2 无从谈起。

### 3.5 创作页自动套用（G3）

入口：`views/CreateView.vue` 的 `_applyConfigProfileFromRoute()`。

#### 3.5.1 时序

```
mounted
  └─ 有 draft → _loadDraftForRewrite(draftId)      // 载入文案 + 按 query.pipeline 选中流水线
        └─ .then(() => _applyConfigProfileFromRoute())   // ← 必须在选中流水线之后
  └─ 无 draft → _applyConfigProfileFromRoute()      // 无流水线 ⇒ 提示并放弃套用
```

「必须先选流水线」的理由：配置档案按 `pipelineId` 分域，没有选中流水线就无从判断归属。

#### 3.5.2 与「恢复上次选项」的竞态（本片识别并修掉的坑）

创作页在选中编排型流水线时会异步触发「恢复上次选项」（`restoreS2VLastOptions()`，读 `story2video.lastOptions.v1`）。它与本片的「套用配置档案」**写的是同一份表单**，两者并发时**后写者胜**——若恢复后到，用户刚挑好的配置会被「上次选项」覆盖掉（用户感知：「我在弹窗里选了配置，进创作页却不是那套」）。

修法：把恢复的 promise 留住（`this._s2vRestorePromise`），套用配置前 `await` 它 —— 恢复先写、配置后写，配置档案（用户显式选择）**必胜**。

#### 3.5.3 套用语义

复用创作页既有的 `applyS2VConfigProfileSnapshot(profile)`（编排型走 `_applyS2VSnapshotObject`，legacy 型走 legacy 段），因此枚举归一化、失效服务商回退、分辨率按当前能力上限归一、语音数据重载、折叠组恢复等既有语义**全部复用**，本片不新增第二套套用逻辑。

套用成功后：`s2vActiveConfigProfile = 配置名`（创作页会显示「当前已应用的配置」），并 toast「已应用配置」。

#### 3.5.4 三种拒绝/失败路径

| 场景 | 判据 | 用户可见结果 | 是否继续创作 |
|---|---|---|---|
| URL 没带 `configProfile` | — | **无任何提示**（不是错误，是默认路径：用流水线默认参数） | 是 |
| 没有选中流水线 | `selectedPipeline` 为空 | toast「未能确定流水线，无法套用所选配置」 | 是（按默认参数） |
| 配置已被删除 | 库里找不到该 id | toast「所选配置不存在或已被删除，已按流水线默认参数继续」 | 是（按默认参数） |
| 配置属于别的流水线 | `profile.pipelineId !== selectedPipeline.name` | toast「该配置属于其他流水线，无法在当前流水线应用」 | 是（按默认参数） |
| 套用执行失败 | `applyS2VConfigProfileSnapshot` 返回 false | toast「配置应用失败，请检查选项后重试」 | 是（按默认参数） |

**所有失败都不阻断创作**——配置是锦上添花，不能因为它让用户做不了正事。

---

## 4. 数据校验

### 4.1 渲染层（弹窗）校验

| 字段 | 来源 | 判据 | 不通过时 |
|---|---|---|---|
| `profile.id` | IPC | `/^[A-Za-z0-9-]{8,64}$/`（与主进程 `isSafeProfileId` 同口径） | 丢弃该条档案 |
| `profile.name` | IPC | trim 后非空 | 丢弃该条档案 |
| `profile.pipelineId` | IPC | `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`，且 ≤ 64 字符（与主进程 `isSafePipelineId` 同口径） | 丢弃该条档案 |
| `profile.updatedAt` | IPC | 有限数值 | 归零（排序稳定，不产生 NaN） |
| 整个列表 | IPC | 数组 | 非数组 ⇒ 当作空列表（不抛错） |
| IPC 返回码 | IPC | `code === 0` | 非 0 ⇒ 列表置空 + 失败提示 |
| `configProfileId`（提交时） | 组件内 | 同 `profile.id` 判据 | 清空 ⇒ 视为「未选配置」 |
| `pipelineId`（提交时） | 组件内 | trim 后非空 | 空 ⇒ 回落 `story2video-compose` |

### 4.2 交接层（query）校验

| 键 | 判据 | 不通过时 |
|---|---|---|
| `draft` | trim 后非空 | 不带该键 |
| `pipeline` | trim 后非空 | 不带该键 |
| `configProfile` | trim 后非空 **且** 匹配 `/^[A-Za-z0-9-]{8,64}$/` | 不带该键（= 不套用配置） |

### 4.3 创作页（套用时）校验

| 判据 | 不通过时 |
|---|---|
| `configProfile` 非空 | 直接返回（不套用、不提示） |
| `selectedPipeline` 存在 | toast「未能确定流水线…」+ 放弃 |
| 库中存在该 id | toast「所选配置不存在或已被删除…」+ 放弃 |
| `profile.pipelineId === selectedPipeline.name` | toast「该配置属于其他流水线…」+ 放弃 |
| `applyS2VConfigProfileSnapshot` 返回 true | toast「已应用配置」；否则 toast「配置应用失败…」 |

---

## 5. 显示项

| 位置 | 元素 | 文本来源 | 中文 | 英文 |
|---|---|---|---|---|
| 浮窗标题 | 标题 | `publishDestination.title` | 选择发布去向 | Choose publish destination |
| 浮窗副标题 | 已存草稿披露 | `publishDestination.subtitle` | 改写内容已存入草稿箱，请选择下一步操作 | Rewritten content saved to drafts. Choose the next step |
| 视频分支 | 流水线标签 | `publishDestination.pipelineLabel` | 流水线选择 | Pipeline |
| 视频分支 | 流水线下拉 | — | 见 §3.2 清单 | — |
| 视频分支 | 流水线占位项 | `publishDestination.pipelineEmptyOption` | -- 选择流水线 -- | -- Choose a pipeline -- |
| 视频分支 | 配置标签 | `publishDestination.configLabel` | 配置选择 | Configuration |
| 视频分支 | 配置触发器当前值 | `publishDestination.configDefaultOption` | 默认 | Default |
| 视频分支 | 配置菜单首项 | `publishDestination.configDefaultOption` | 默认 | Default |
| 视频分支 | 配置菜单项 | `profile.name`（用户自取） | — | — |

## 6. 提示文字

| 场景 | i18n key | 中文 | 英文 | 时长 |
|---|---|---|---|---|
| 弹窗：配置列表加载中 | `publishDestination.configLoading` | 正在加载配置… | Loading configurations… | 常驻至加载结束 |
| 弹窗：配置列表加载失败 | `publishDestination.configLoadFailed` | 配置列表加载失败，暂时无法选择配置 | Could not load configurations. Selecting a configuration is unavailable for now. | 常驻（直到下次打开） |
| 弹窗：该流水线无配置 | `publishDestination.configEmpty` | 该流水线还没有保存过配置，可在创作页用「保存配置」创建 | No saved configuration for this pipeline yet. Create one with "Save configuration" on the creation page. | 常驻 |
| 创作页：套用成功 | `create.story2video.configProfile.applied`（既有） | 已应用配置 | Configuration applied | 既有默认 |
| 创作页：配置已失效 | `create.story2video.configProfile.notFound`（**新增**） | 所选配置不存在或已被删除，已按流水线默认参数继续 | The selected configuration no longer exists. Continuing with the pipeline defaults. | 2600ms |
| 创作页：跨流水线 | `create.story2video.configProfile.wrongPipeline`（既有） | 该配置属于其他流水线，无法在当前流水线应用 | This configuration belongs to another pipeline and cannot be applied here. | 2600ms |
| 创作页：套用失败 | `create.story2video.configProfile.applyFailed`（既有） | 配置应用失败，请检查选项后重试 | Could not apply the configuration. Check the options and try again. | 2600ms |
| 创作页：无法确定流水线 | `create.story2video.configProfile.applyFailed`（复用） | 未能确定流水线，无法套用所选配置 | Could not resolve the pipeline, so the selected configuration was not applied | 2600ms |

> 说明：最后一格复用 `applyFailed` 键（`translateWithLocaleFallback` 的第三个参数提供兜底中英文），避免为一个提示新增一个键；该兜底文案与键名语义不完全对齐，是**已知取舍**（见 §9.3）。

---

## 7. 流程

### 7.1 主流程

```
用户（改写页/采集页/热门选题页）
  │  点「去发布」
  ▼
PublishDestinationModal 打开
  │  ├─ 拉取配置库（story2video:config-profile-list）→ 归一化 → 缓存
  │  └─ 默认选中流水线 = 故事讲述
  ▼
用户点「生成视频」按钮
  │  ※ 流水线/配置的选择发生在「生成视频」按钮**之前**（同排的原生 select / 自建下拉）
  ▼
emit('publish-video', pipelineId, { configProfileId, configProfileName })
  ▼
调用方 buildCreateHandoffQuery({ draftId, pipelineId, configProfileId })
  │  ├─ 改写页/采集页：直接 router.push
  │  └─ 热门选题页：先批量改写产出草稿，再 goToDestination() 带全参数跳转
  ▼
创作页 mounted
  │  ├─ _loadDraftForRewrite(draft)  → 载入文案 + 选中 query.pipeline
  │  └─ .then(_applyConfigProfileFromRoute())
  │        ├─ await _s2vRestorePromise   （「恢复上次选项」先写，配置后写）
  │        ├─ 校验四道闸（见 §4.3）
  │        └─ applyS2VConfigProfileSnapshot(profile)
  ▼
创作页展示该配置的选项 + toast「已应用配置」
  ▼
用户点「启动流水线」
```

### 7.2 「我的配置」在创作页的既有入口（本次未改动）

创作页操作条辅助区：`保存配置` / `我的配置`（显示条件：已选中流水线）。「我的配置」列表按 `updatedAt` 倒序，每行提供 应用 / 重命名 / 删除；应用跨流水线配置时按钮禁用并提示「该配置属于其他流水线，无法在当前流水线应用」。

---

## 8. 数据流与持久化

- **配置档案存储**：设备级本地，路径 `userData/story2video-config-profiles/config-profiles.json`（主进程 `electron/services/story2video-config-profiles.js`）。本片**不改动**该格式与写语义。
- **记录结构**：`{ id, name, pipelineId, snapshot, createdAt, updatedAt }`；`id` = `randomUUID`；名称 trim 后 1..60 码点；`pipelineId` ≤ 64 字符；快照序列化 ≤ 64KB；单流水线 ≤ 50 条。
- **本片新增的传递路径**：配置档案 id 从「去发布」浮窗 → URL query → 创作页 → 既有 `applyS2VConfigProfileSnapshot`。**快照本身不进 URL**（URL 长度与隐私都不合适），只传 id，创作页按 id 回库取快照。
- **并发/一致性**：配置在「浮窗打开 → 用户点生成视频」之间被删除，创作页按「配置已失效」路径处理（§3.5.4），不会崩、不会静默。

---

## 9. 边界与已知限制

### 9.1 边界

1. 浮窗一次只处理一个流水线、一个配置（不做批量选配置）。热门选题页的批量改写只影响草稿产出，配置在进入创作页时套用一次。
2. 配置档案是**设备级**的：换设备、换用户目录就没有了（与既有语义一致，不声称同步）。
3. 「默认」= 不套用任何配置 = 创作页的流水线默认参数（不是「上一次用的参数」——那是「恢复上次选项」的职责，两者互不覆盖：本片保证配置档案后写、必胜）。
4. 视频克隆 / 影视工程有独立页面，不在创作页的流水线下拉里，因此也不会出现在本弹窗的下拉里（它们的配置管理在自己页面上，本片不动）。

### 9.2 已知限制

1. 配置档案一旦套用，创作页的「恢复上次选项」不会覆盖它（设计如此，见 §3.5.2）；反过来，如果不套用配置，「恢复上次选项」照常生效。
2. 热门选题页的批量改写过程中若用户改了弹窗里的选择，改动只在下次打开弹窗时生效（弹窗关闭时选择不保留）。
3. 本片不给配置档案加「跨流水线复制」能力。

### 9.3 已知取舍

1. 「未能确定流水线，无法套用所选配置」复用了 `create.story2video.configProfile.applyFailed` 键（靠 `translateWithLocaleFallback` 的兜底参数区分文案）。若后续 locale 治理要求键名与文案严格一一对应，应拆成独立键。
2. 配置下拉的「默认」在**有配置**时是菜单第一项而不是不可见的占位——为了让用户能退回「不套用」。

---

## 10. 验收标准

### 10.1 功能验收（可测）

| # | 验收项 | 判据 |
|---|---|---|
| A1 | 流水线下拉列出全部文案型流水线 | 包含 `story2video-compose` `talking-head` `animated-explainer` `avatar-spokesperson`；不含 `clip-factory` `framework-smoke` `video-clone` |
| A2 | 无配置时显示「默认」 | 触发器文本 === 「默认」；触发器 `disabled`；`[data-testid="publish-dest-config-menu"]` 不存在 |
| A3 | 无配置时给出原因说明 | 提示行文本包含「还没有保存过配置」 |
| A4 | 有配置时只列本流水线的配置 | 菜单文本含本流水线配置名，不含其它流水线的配置名 |
| A5 | 菜单首项为「默认」 | `[data-testid="publish-dest-config-option-default"]` 存在且文本为「默认」 |
| A6 | 切换流水线后旧配置作废 | 切换后触发器文本回到「默认」 |
| A7 | 选了配置后提交带上配置 id | `publish-video` 第 2 个参数 = `{ configProfileId, configProfileName }` |
| A8 | 没选配置时提交不带配置 | 第 2 个参数 = `{ configProfileId: '', configProfileName: '' }` |
| A9 | 加载失败如实提示 | 提示行文本包含「加载失败」；触发器仍显示「默认」 |
| A10 | 创作页自动套用 | 进入 `/create?draft&pipeline&configProfile` 后，`s2vActiveConfigProfile` === 配置名，表单字段被覆盖，toast「已应用配置」 |
| A11 | 创作页拒绝跨流水线配置 | toast 含「属于其他流水线」，`s2vActiveConfigProfile` 仍为空 |
| A12 | 创作页对已删除配置如实提示 | toast 含「不存在或已被删除」 |
| A13 | 创作页无配置参数时不提示、不拉库 | `s2vActiveConfigProfile` 为空；`story2videoConfigProfileList` 未被调用 |
| A14 | 配置后写必胜 | 「恢复上次选项」与「套用配置」并发时，最终表单等于配置档案的快照 |

### 10.2 「其它流水线有没有配置管理」的核对口径

| 核对项 | 方法 | 结论 |
|---|---|---|
| 创作页的「保存配置 / 我的配置」按钮显示条件 | 读 `views/CreateView.vue` 操作条辅助区：`v-if="selectedPipeline?.name"` | 与流水线类型无关 ⇒ 全部流水线可见 |
| 快照分型 | `buildPipelineConfigSnapshot()` 产出 `kind: 'orchestrated' \| 'legacy'` | 编排型与 legacy 型各有白名单 |
| 独立页 | `views/VideoCloneView.vue` / `views/FilmEngineeringView.vue` 均挂 `components/ConfigProfileManager.vue` | 视频克隆、影视工程各有配置管理 |
| 既有规格 | `openspec/specs/story2video-pipeline-config-profiles/spec.md` 的 Requirement「All video creation pipelines expose managed configuration profiles」 | 该契约**已在规格中成立** |

### 10.3 回归锁（自动化）

| 锁 | 位置 | 覆盖 |
|---|---|---|
| 纯函数 | `src/features/publish-destination/publish-destination-config.test.js` | 归一化 / 过滤 / 选中解析 / 提交载荷 / query 构造 |
| 组件 | `src/components/PublishDestinationModal.test.js` | A1..A9 |
| 创作页 | `src/views/CreateView.config-profile-handoff.test.js` | A10..A13 |

---

## 11. 相关文件

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/components/PublishDestinationModal.vue` | 新增配置选择器；流水线下拉改用文案型全集；`publish-video` 增加第 2 个载荷参数 |
| `apps/desktop/src/features/publish-destination/publish-destination-config.js` | **新增**：归一化 / 过滤 / 选中解析 / 载荷与 query 构造（纯函数） |
| `apps/desktop/src/features/publish-destination/publish-destination-config.test.js` | **新增** |
| `apps/desktop/src/i18n/pipeline-labels.js` | **新增导出** `TEXT_BASED_PIPELINE_IDS`（只读） |
| `apps/desktop/src/locales/publish-destination/{zh,en}.js` | 新增 5 个键（configLabel / configDefaultOption / configEmpty / configLoading / configLoadFailed） |
| `apps/desktop/src/locales/create/{zh,en}.js` | 新增 1 个键（configProfile.notFound） |
| `apps/desktop/src/views/CreateView.vue` | 新增 `_applyConfigProfileFromRoute()`；`selectPipeline` 留住恢复 promise；mounted 串接套用 |
| `apps/desktop/src/views/RewriteView.vue` | `onPublishVideo` 带上配置档案 |
| `apps/desktop/src/views/Collection.vue` | `onPublishVideo` 带上配置档案 |
| `apps/desktop/src/views/HotTopics.vue` | `onPublishVideo` → 队列项 → 最终跳转带上流水线 + 配置档案 |
| `apps/desktop/src/components/PublishDestinationModal.test.js` | 新增 7 例 |
| `apps/desktop/src/views/CreateView.config-profile-handoff.test.js` | **新增**：4 例 |
| `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` | 新增 §9.11「去发布弹窗的配置选择器」 |
| `01-docs/CHANGELOG.md` | 变更记录 |
| `openspec/changes/publish-config-picker/` | **新增**：proposal / tasks / design / spec |
| `openspec/records/publish-config-picker.md` | **新增**：执行记录 |

> **未改动**（明确列出，便于评审核对）：`apps/desktop/electron/services/story2video-config-profiles.js`、`apps/desktop/electron/ipc-handlers/story2video.js`（四个 `story2video:config-profile-*` 通道）、`apps/desktop/electron/preload/publish.js`、`apps/desktop/src/components/ConfigProfileManager.vue`、`apps/desktop/src/api/publisher.js`。
