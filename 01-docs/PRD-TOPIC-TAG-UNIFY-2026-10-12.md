# PRD — 发布页话题标签统一 + #添加话题 + 常用话题标签管理

> change: topic-tag-unify | 日期: 2026-10-12 | 状态: 已评审（用户截图 + 指令即确认）
> 参考产品: 参考产品 4.0（逆向目录仅含 Electron 外壳，发布编辑器为云端页面；本 PRD 交互以其截图为准，数据结构参考其话题条目 `{id, name, link, viewNum}` 形态）

## 1. 背景

发布页同时存在「标签」和「话题」两个输入框。引擎层（publisher-router.js `mergeUniqueStrings` 四源合并）早已把二者合并为同一个字段，UI 上两个框行为完全一致（都经 `publish-topic-inline-description` 追加管道写入描述），但对用户呈现出两个概念，必然产生「一个给算法、一个给平台话题页」的错误猜测。

用户决策（2026-10-12）：
1. **逻辑与 UI 同时合并**：一个「话题标签」入口。
2. **交互对齐参考产品**：点击「#添加话题」按钮只是在描述正文末尾追加一个 `#` 字符，用户自己接着输入话题名——不再走「整词追加 `#话题名`」的输入框模式。
3. **新增「常用话题标签」弹窗**：分组管理常用话题，搜索、全选本组、勾选计数、确定应用（照截图 2 复刻）。

## 2. 目标用户与价值

- 多平台发布者：少一层概念、少一次「填哪个框」的犹豫。
- 高频运营：常用话题一次分组维护，发布时勾选批量应用，省去逐字输入。

## 3. 功能列表（P0 全部）

| # | 功能 | 优先级 |
|---|------|--------|
| F1 | 标签/话题两框合并为单一「话题标签」入口（单篇 + 批量） | P0 |
| F2 | 「#添加话题」按钮：向描述 textarea 末尾追加 `#` 并聚焦 | P0 |
| F3 | 「常用话题标签」弹窗：分组 / 搜索 / 全选本组 / 计数 / 确定应用 | P0 |
| F4 | 弹窗持久化（localStorage，跨会话保留分组与话题） | P0 |
| F5 | 智能标签建议 / 历史视频跳转等既有入口改写到统一入口 | P0（随 F1 自然收口） |

## 4. 详细需求

### 4.1 F1 话题标签统一

**数据模型**（向后兼容，不迁移）：
- 单篇：`article.tags` 为唯一 UI 真源；`article.topics` 保留在数据结构中但 UI 不再写入（历史草稿加载时 `topics` 并入 `tags` 一次性合并，经去重）。
- 批量条目：`tagsText` 为唯一 UI 真源；`topicsText` 同上保留结构、UI 不再写。
- payload 构造（`buildArticleData` / `buildBatchArticlePayload`）：`tags` 照旧提交；`topics` 仅在历史草稿残留非空时照旧提交（引擎侧 `mergeUniqueStrings` 反正合并，无双份风险）——**payload 键集不变**，P2-7 parity 锁不破坏。

**UI 变更**：
- 单篇图文/视频两分支、批量卡片的 `publish-metadata-grid` 中，「标签」「话题」两个格子合并为一个格子，label = 「话题标签」（复用 zh `colTags` 既有叫法；en `Tags & topics`）。
- placeholder：「输入或点击下方按钮添加，自动带入描述」。
- 输入框行为：逗号分隔输入仍然支持（normalizePublishStringList 归一 + Set 去重），每次变更经 `syncTopicsToContent` 管道同步描述。

**验收**：
- 页面只出现一个话题标签输入框（单篇图文 / 单篇视频 / 批量卡片三处）。
- 描述追加语义与合并前一致（词边界去重、删除同步移除）。
- 历史草稿（含 topics）加载后编辑不丢话题。

### 4.2 F2 #添加话题按钮

- 位置：话题标签输入框下方一行，与「常用话题标签」按钮并排（同截图 1 布局：按钮在描述框左下角下方）。
- 点击行为：**仅在描述 textarea 末尾追加 `#` 字符并聚焦描述框**（光标置于末尾），不追加任何话题名。用户自行输入话题名；发布时由描述解析（既有 `extractInlineTopics`）收口。
- 追加守卫：描述末尾若已是 `#`（或末尾已有孤立 `#`）则不重复追加，只聚焦。
- 单篇图文（ArticleEditor）、单篇视频（UiInput textarea）、批量卡片（UiInput textarea）三处描述框都接同一行为；批量模式下按钮作用于**本篇**描述。
- 参考产品式细节：不加确认、不加 toast，动作即反馈（光标出现 `#`）。

**验收**：
- 描述 `今天探店` + 点击 → `今天探店 #`，焦点在描述框且光标在末尾。
- 描述 `今天探店 #` 再点击 → 仍是 `今天探店 #`（不产生 `##`），仅聚焦。
- 空描述点击 → 内容恰为 `#`。

### 4.3 F3+F4 常用话题标签弹窗

**入口**：`#添加话题` 按钮右侧的「常用话题标签」按钮（单篇三处 + 批量卡片，共 4 个入口共用同一弹窗组件实例——挂在 Publish.vue，批量卡片经 emit 打开；应用目标 = 打开时指定的写入目标）。

**弹窗结构**（照截图 2）：
- 标题「话题标签管理」；副标题「选择常用话题标签，并按分组快速应用。」
- 顶部搜索框：placeholder「搜索分组或话题关键词...」。过滤规则：大小写不敏感子串匹配；命中**分组名**显示该组全部话题；命中**话题名**显示该话题（其所在组保留显示）；两者都不命中则该组隐藏；全部不命中显示空态「没有匹配的话题标签」。
- 分组列表：每组一个卡片，头部为组名 + 话题数徽标；组内话题以 chips（勾选态）展示；组尾「全选本组」复选框（三态：全选/半选/未选）。
- 新建分组：左下「＋ 新建分组」按钮 → 弹内联输入（弹窗内不套第二层模态），回车确认、Esc 取消，组名非空去重。
- 底部栏：左「＋ 新建分组」；右「已选 N 个 ˄」展开已选 chips 摘要（可单独取消勾选）+「确定应用」主按钮。
- 「确定应用」：把选中话题名列表交给打开方回调：
  - **默认目标（单篇/批量）**：经追加管道写入话题标签输入（= 同步追加 `#话题` 进描述），与手填同口径；`normalizePublishStringList` 去重防双份。
  - 应用后弹窗关闭；toast「已应用 N 个话题标签」。

**数据模型与持久化**：
- localStorage key：`mp_topic_tag_presets`（v1）。结构：
  ```json
  { "version": 1, "groups": [ { "id": "g_<ts>_<rand>", "name": "科技", "topics": ["科技", "人工智能", "AI"] } ] }
  ```
- 话题条目就是字符串（无 id/link——参考产品的 `{id,name,link}` 是平台 API 联想结构，本地常用标签无平台绑定，不引入死字段）。
- 校验：读取时容错（非数组/组缺字段/话题非字符串一律过滤丢弃，不抛错）；写入前 `JSON.parse(JSON.stringify())` 脱壳；配额异常（QuotaExceeded）静默失败并 console.warn。
- 组名唯一（trim 后比对，不区分大小写）；组内话题去重、空串过滤、剥 `#` 与空白（复用 `normalizeTopicName` 口径）。
- 初始态无数据：弹窗显示「还没有分组」空态 + 新建分组引导。

**交互细节**：
- 勾选状态是弹窗内临时态，不持久化；关闭即清空。
- 「确定应用」在选中数为 0 时禁用。
- 弹窗遵守**应用级浮层互斥合同**：owner 常量 `topic-tag-manager-dialog`，`suspendEmbeddedViewsForOverlay` / `releaseEmbeddedViewsForOverlay` 成对（watch visible + immediate，onBeforeUnmount 兜底），并登记进 `overlay-view-suspension.test.js` 的 owner 登记表。
- 弹窗用 UiModal（Teleport to body），`size="lg"`，Esc/遮罩可关。

**验收**：
- 分组新建/搜索/全选/勾选/应用全链路可用，刷新后数据仍在。
- 应用到批量卡片时只写该篇。

## 5. 不做什么

- 不做平台话题联想 API（参考产品的 douyin/xhs sug 接口属发布链路增强，另行立项）。
- 不做话题热度/链接展示。
- 不迁移历史 `article.topics` 数据（留在快照里惰性合并）。
- 「扩写描述」AI 按钮：参考产品逆向目录无实现可借鉴，且属 AI 写作域既有能力（AiWriterPanel），本次不做。

## 6. 提示文案（zh / en 成对，进 locales）

| key | zh | en |
|---|---|---|
| publishPage.topicTag.label | 话题标签 | Tags & topics |
| publishPage.topicTag.placeholder | 输入或点击下方按钮添加，自动带入描述，多个用逗号分隔 | Type or add via buttons below; auto-appended to description, comma separated |
| publishPage.topicTag.addHash | #添加话题 | # Add topic |
| publishPage.topicTag.manage | 常用话题标签 | Common topic tags |
| publishPage.topicTag.managerTitle | 话题标签管理 | Topic tag manager |
| publishPage.topicTag.managerSubtitle | 选择常用话题标签，并按分组快速应用。 | Pick common topic tags and apply them by group. |
| publishPage.topicTag.searchPlaceholder | 搜索分组或话题关键词... | Search groups or topics... |
| publishPage.topicTag.selectAllGroup | 全选本组 | Select all in group |
| publishPage.topicTag.newGroup | 新建分组 | New group |
| publishPage.topicTag.newGroupPlaceholder | 输入分组名称 | Group name |
| publishPage.topicTag.selectedCount | 已选 {count} 个 | {count} selected |
| publishPage.topicTag.apply | 确定应用 | Apply |
| publishPage.topicTag.applied | 已应用 {count} 个话题标签 | Applied {count} topic tags |
| publishPage.topicTag.emptyGroups | 还没有分组，点击「新建分组」开始维护常用话题 | No groups yet. Create one to keep your common topics. |
| publishPage.topicTag.emptySearch | 没有匹配的话题标签 | No matching topic tags |
| publishPage.topicTag.groupNameEmpty | 分组名称不能为空 | Group name cannot be empty |
| publishPage.topicTag.groupNameDuplicate | 已存在同名分组 | A group with this name already exists |

## 7. 数据校验汇总

| 输入 | 规则 |
|---|---|
| 组名 | trim 非空；与既有组名 trim+lowercase 唯一；长度 ≤ 30 |
| 话题名 | `normalizeTopicName`（剥 # 与空白）非空；组内去重；单个 ≤ 30 字符 |
| 持久化读取 | 结构容错：顶层对象/groups 非数组/组缺 name/topics → 过滤；version !== 1 → 整体视为空并重写 |
| localStorage 异常 | 写失败 warn 不抛；读失败返回空结构 |

## 8. 交互流程（确定应用 → 描述）

```
勾选 N 个话题 → 确定应用
  → 回调 (names: string[])
  → 单篇: article.tags = normalize([...tags, ...names]); syncTopicsToContent(prev, next)
  → 批量: setBatchTagsText(item, normalize([...normalize(item.tagsText), ...names]).join(','))
  → 描述尾部出现 #话题1 #话题2 ...（词边界去重）
  → 弹窗关闭 + toast
```

## 9. 测试计划

- 单元：`topic-tag-presets.js`（存取容错/校验/去重）、`#追加` 纯函数 `appendHashToContent`。
- 组件：`TopicTagManagerDialog.test.js`（渲染/搜索/全选/计数/应用/持久化容错/浮层 owner）。
- 视图：`Publish.test.js` 更新合并后的单入口断言 + `#添加话题` 行为 + 弹窗打开/应用接线；批量卡片同口径。
- 既有回归：`topic-inline.test.js`、`useBatchPublish.test.js`（P2-7 parity）、`Publish.test.js` 话题管道用例（topicsText 断言改 tagsText 口径）、`overlay-view-suspension.test.js` 登记。
- 视觉回归：涉及 UI 文件，`npm run test:visual` 在合并前跑受影响视图（publish）。

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 既有测试大量断言 `topicsText` | 逐个改口径为单入口；payload parity 锁不动键集 |
| 浮层互斥遗漏 | owner 登记表先写锁（TDD 红）再实现 |
| 历史草稿双份话题 | mergeUniqueStrings 引擎侧兜底已在；applyDraft 时 topics 并入 tags 即不再双份 |
