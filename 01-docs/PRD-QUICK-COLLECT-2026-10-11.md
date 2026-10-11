# PRD：采集页「快捷采集」（quick-collect，2026-10-11）

> 分支：`quick-collect`（隔离 worktree `D:\Data\projects\mp-worktrees\mp-quick-collect`，非 C 盘）
> 关联：`openspec/changes/quick-collect/**`、`openspec/records/quick-collect.md`、`CHANGELOG.md`
> 状态：**已交付**（代码 + 测试 + 文档同 PR；文末 §13 诚实记录未闭合项）

---

## 1. 背景与问题

采集页（`apps/desktop/src/views/Collection.vue`）当前提供的是**「给定 URL → 抓正文」**的采集：用户必须自己先找到值得采集的链接（URL 采集），或者先去别的站点挑好文章再回来粘贴（批量/RSS/知乎收藏夹同理）。

但内容创作者的高频动作不是"我有一个链接"，而是**"我想知道最近发生了什么"**：

1. 我关心 AI 领域过去 48 小时有没有值得写的新东西 → 现在只能自己逐个站点刷；
2. 我关心平台规则有没有变化（限流、AIGC 标识、审核口径）→ 现在没有任何入口；
3. 我关心同行在写什么、什么形式在起量 → 只能靠人工刷。

这三件事的共同点：**结论是一段可直接进创作流程的文字，且需要"最近一段时间"的真实素材**。用户既不想每次重写一遍同样的检索指令，也不希望结果是一次性会话（用完即弃）。

同时，产品已经具备两侧能力：① 检索侧有 `content-intelligence`（Reddit / Hacker News / GitHub 三源，免费无 Key，实测带 `created_utc` 时间戳，可做时间窗口过滤）；② 生成侧有 `aiGenerator.generateWithDefault('llm')`（用户自己的默认大模型）。缺的是**把两者固定成"一条可复用的指令"**的产品形态。

## 2. 目标用户与核心价值

| 维度 | 内容 |
| --- | --- |
| 目标用户 | 内容创作者 / 自媒体运营（本产品的既有用户画像） |
| 核心价值 | 把"我关心的方向"沉淀为**一条可重复执行的采集指令**：点一下，按最近 N 小时的真实素材给出结论，结论直接进既有创作闭环（改写 → 草稿 → 发布 / 爆款库） |
| 成功判据 | ① 内置指令开箱可用（无需任何配置，除已配置的默认大模型）；② 自定义指令可增删改且刷新不丢；③ 结果条目与手动采集条目在**存储、列表、下游动作**上完全同形 |

## 3. 范围（P0 / P1 / 不做）

### P0（本次交付）

- **F-1 快捷采集页签**：采集页新增第 3 个页签「快捷采集」，与既有页签同构（`role="tab"` + `aria-selected` + `.collection-tab-btn`）。
- **F-2 内置指令**：主进程内置 6 条官方指令（含用户指定的「AI 领域动向」，提示词逐字采用用户给定文本），渲染端只读展示，不可编辑/删除。
- **F-3 自定义指令 CRUD**：新增 / 编辑 / 删除；标题与指令正文均提供默认示例文案；落盘 `store` 设置键 `quick_collect_commands`（与 `collected_items` 同一存储通道，刷新/重启不丢）。
- **F-4 一键执行**：点击指令 → 主进程「检索素材（时间窗口过滤）→ 组装提示词 → 调默认大模型 → 归一为采集条目」→ 返回结果。
- **F-5 结果同形**：结果条目走既有 `normalizeCollectedItem` 出口进入 `collectedItems`，并自动切到「采集」页签复用**同一套结果卡**（查看/改写/创建草稿/加入爆款库/发布/字数区间/改写策略），不做第二套结果 UI。
- **F-6 数据校验三层**：表单层（即时内联错误）、IPC 层（形状与领域码）、引擎层（纵深防御 + 素材 URL 协议判据）。
- **F-7 可观测**：执行阶段（检索中 / 生成中）在卡片内可见；失败有领域码 → 文案映射；成功提示含素材条数。

### P1（本次不做，已登记）

- 执行中取消（贯穿到在途 LLM/网络请求的 AbortController）。
- 指令排序拖拽 / 分组 / 导入导出。
- 素材源扩展（中文平台、付费检索 API）。
- 定时执行（复用 `automation` 调度）。

### 不做（明确排除）

- 不新增平台、不改 `publish-capabilities`、不碰 RPA DOM、不碰发布链路。
- 不引入新的第三方检索依赖（不新增 npm 包、不新增 API Key 配置项）。
- 不改 `content-intelligence` 的任何既有语义（含其相关性门禁与缓存键策略）。

## 4. 前端展示形态（决策）

**决策：新增页签「快捷采集」，而不是把入口塞进「采集」页签内部。**

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| A. 采集页顶部横向命令条 | 结果与输入同屏 | 采集页已有 URL 输入 + 批量采集 + 知乎收藏夹 + 结果列表 + 草稿箱，再加一条命令条等于第 5 个信息块；且命令管理（CRUD）无处安放，只能再叠一个弹窗 | ✗ |
| B. 独立页签「快捷采集」 | 与既有「博主监控」页签同构（先例已证明该模式可行）；命令列表 + 管理有独立空间；执行后切到采集页复用同一结果卡 | 点击执行后页面会切换（用 toast 明示） | ✓ 采用 |
| C. 独立一级页面 | 最干净 | 与「采集」是同一心智模型的两个阶段，拆开后用户要在两个导航间来回；且需要动路由与侧边栏 | ✗ |

**页签顺序**：`采集 | 快捷采集 | 文案库 | 博主监控`。

**为什么执行后要切到「采集」页签**：结果卡（改写策略选择、字数区间、结合爆款库/个人经历、创建草稿、加入爆款库、发布）是采集页已有的一大块交互，它绑定了十余个 `ref`。复制一份到快捷采集页 = 两套逻辑必然漂移（本仓库对"装饰性链路/第二份实现"已有明确禁令）。因此快捷采集页签只做**启动器 + 管理器**，结果落在同一处。

## 5. 数据模型

### 5.1 快捷采集指令（`QuickCollectCommand`）

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string | ✓ | 内置：`builtin-*`（固定）；自定义：`qc-` + 时间戳36 + 4 位随机 | 主键；删除/编辑按 id |
| `title` | string | ✓ | 去空白后 1–40 字符 | 卡片标题；结果条目标题前缀 |
| `summary` | string | ✗ | ≤80 字符 | 一句话说明（内置有，自定义默认空） |
| `prompt` | string | ✓ | 去空白后 10–4000 字符 | **指令正文**，等价于固定好的 AI 提示词 |
| `keywords` | string[] | ✗ | 0–5 项，每项 1–30 字符 | 检索关键词（喂给 `content-intelligence`）；空数组 = 不检索 |
| `windowHours` | number | ✓ | `0 / 24 / 48 / 168` 之一 | 素材时间窗口；`0` = 不限 |
| `sources` | string[] | ✓ | `reddit` / `hackernews` / `github` 的子集，去重 | 检索源 |
| `builtin` | boolean | ✓ | — | 内置指令不可改不可删 |
| `createdAt` / `updatedAt` | ISO string | 自定义必填 | — | 展示与排序（自定义按 `updatedAt` 倒序） |

### 5.2 持久化

- 键：`quick_collect_commands`（经既有 `store:get-setting` / `store:set-setting`，与 `collected_items` 同通道）。
- 形状：`{ "version": 1, "commands": [ ... ] }`。
- **读时容错（v0 → v1 迁移）**：历史/异常数据若为**裸数组**，按 v0 读入并归一；`version` 非 1 或 `commands` 非数组 → 视为空列表并计入 `skipped`（不抛错、不清库）。
- **逐条校验**：读入时对每条执行与表单同一份 `validateQuickCollectCommand`；不合法条目**丢弃并计数**（`skipped`），合法条目保留 —— 一条脏数据不得让整个列表消失。
- 写入时：只写 `builtin !== true` 的条目（内置指令由主进程提供，不落盘，避免版本升级后内置词条被旧副本盖住）。

### 5.3 结果条目（`CollectedItem` 的超集）

在既有条目字段基础上新增一个**只读溯源字段**（写入 `normalizeCollectedItem` 的唯一出口）：

```js
quickCollect: {
  commandId, commandTitle, builtin,
  windowHours, sources: [],
  materialCount,                    // 实际参与提示词的素材条数
  retrieval: 'ok' | 'empty' | 'partial' | 'skipped',
  generatedAt                        // ISO
}
```

- `source` 字段填**指令标题**（卡片/文案库显示为「AI 领域动向 · 1200字」，语义可读；`source` 在既有实现里只用于展示）。
- `sourceUrl` 填**第一条素材的 URL**（无素材则空串）；它同时是文案库去重集合（`collectedUrlSet`）的成员，空串会被既有 `filter(Boolean)` 过滤，不影响去重语义。

## 6. 流程与功能逻辑

### 6.1 执行主流程（`quickCollect:run`）

```
渲染端点击「立即采集」
  → 卡片进入 running（阶段=准备）
  → IPC quickCollect:run({ command })        [withSenderCheck]
      → handler：形状校验（requireArgs）→ engine.run(command)
          → 1) validateCommand（纵深防御，非法即 -2 + 领域码）
          → 2) parseCommand → keywords 去重截断（≤3 次真实查询）
          → 3) 检索：对每个关键词调 content-intelligence.search()
                  { sources, limit: 8, noCache: true, relevanceOn: ['title','snippet'] }
                  progress: { stage: 'retrieving', percent: 10 }
              合并 → 按 url 去重 → 时间窗口过滤 → 按 engagement 倒序 → 截断 12 条
          → 4) 组提示词 buildMessages(command, materials)
                  progress: { stage: 'summarizing', percent: 60 }
          → 5) llmFn({ messages, temperature: 0.3, max_tokens: 1600 })
          → 6) 归一：title/content/sourceUrl/quickCollect
                  progress: { stage: 'done', percent: 100 }
      → 返回 { code: 0, data: item } 或 { code: <领域码>, message }
  → 渲染端成功：emit('collected', item) → Collection.vue 入列表 + 落盘 + 切到「采集」页签
  → 渲染端失败：按领域码映射文案（卡内错误条 + toast）
```

**关键顺序约束**：素材不足/为空时**仍然**调用大模型（让模型按指令如实说明"没找到"），但引擎会在正文**开头**插入机器生成的声明行（见 §6.3）。不得在无素材时假装有事实。

### 6.2 检索逻辑

- **关键词使用**：只用前 3 个（每次外呼 3 个源 × 1 关键词 = 最多 3 次 `search()`，每次内部 3 源请求；避免指令写 5 个关键词就打出 15 次请求）。
- **时间窗口过滤**：`windowHours > 0` 时，仅保留 `createdUtc >= (now - windowHours*3600)` 的素材；**缺时间戳的素材丢弃**（无法证明"最近"）。`windowHours === 0` 时不看时间。
- **去重**：按 `url` 精确去重（保留 engagement 更高者）。无 `url` 的素材丢弃（链接是"可核对"的前提）。
- **协议判据**：素材 URL 一律过共享 `safeHttpUrl`，非法直接丢弃（渲染端会把 `sourceUrl` 落进历史与 IPC，脏 url 不进库）。
- **排序与截断**：`engagement` 倒序，取前 12 条进提示词。
- **源不可用的三态**：`search()` 单源失败**不抛**（既有实现内部 try/catch 返回空数组）。引擎把"该关键词该源返回 0"与"整体 0 条"分开记录：
  - 有素材且尝试的源均返回过数据 → `retrieval: 'ok'`；
  - 有素材但部分查询失败/为空 → `retrieval: 'partial'`；
  - 0 条素材 → `retrieval: 'empty'`（正文加声明行）；
  - 指令无关键词 → `retrieval: 'skipped'`（正文加"未联网检索"声明行）。

### 6.3 提示词组装（`buildMessages`）

- **system**：角色（内容情报分析师）+ 硬约束：只允许使用「素材清单」中的事实；不得编造事件、链接、版本号、时间；素材不足时按指令如实说明；中文输出；不得输出 Markdown 表格以外的多余解释；禁止输出免责声明套话。
- **user**：三段结构 —— ① `【指令】` 用户指令正文（逐字透传）；② `【素材清单】` 每条 `n. 标题 | 来源 | 时间(UTC+8) | 链接 | 摘要(≤200字)`，无素材时写 `（本次未获得素材）`；③ `【输出要求】` 时间窗口、素材条数、若指令要求"来源链接"必须使用清单内链接、若素材不足以支撑结论必须明确说明缺什么。
- **声明行（引擎插入，非模型生成）**：
  - `retrieval === 'empty'` → `> 本次未检索到 N 小时内的可核对素材，以下内容未包含联网事实。`（无关键词时为「本指令未配置检索关键词，以下内容未联网检索。」）
  - 声明行与模型正文之间空一行；声明行**不参与**模型的自由发挥（若模型正文已包含同类声明，uphold 模型输出、不重复插入 —— 引擎判定正文是否含 `未检索到` / `未联网` 关键词）。

### 6.4 CRUD 逻辑

- **新增**：表单校验通过 → `id = 'qc-' + Date.now().toString(36) + rand4`，`builtin=false`，`createdAt=updatedAt=now` → 入列 → 落盘 → toast。
- **编辑**：仅自定义；按 `id` 定位，保留 `id`/`createdAt`，更新 `updatedAt`；内置指令的编辑入口不渲染。
- **删除**：仅自定义；`notifyConfirm` 二次确认（文案含标题）→ 移除 → 落盘 → toast。**不删除任何已采集结果**。
- **重复标题**：新增/编辑时若标题（去空白后不区分大小写）与**其它**自定义指令重复 → 内联错误 + 阻断保存（避免用户分不清点了哪个）。
- **执行中禁止写操作**：`running` 期间「新增/编辑/删除」按钮禁用（避免执行回调读到已被删的指令）。

## 7. 交互逻辑与提示文字

| 场景 | 交互 | 提示文字（locale 键） |
| --- | --- | --- |
| 页签 | 点击切换，`aria-selected` 同步 | `collection.tabQuickCollect` = 快捷采集 |
| 说明区 | 常驻 | `collection.quickCollect.intro` = 点一条指令即按固定提示词采集；结果与手动采集同源，可继续改写/发布 |
| 内置分组标题 | 常驻 | `collection.quickCollect.builtinSection` = 官方内置；`collection.quickCollect.customSection` = 我的自定义 |
| 执行按钮 | 点击后卡内 loading | `collection.quickCollect.run` = 立即采集；`collection.quickCollect.running` = 采集中… |
| 阶段 | 卡内副标题 | `…stageRetrieving` = 正在检索最近素材… / `…stageSummarizing` = 正在生成摘要… |
| 成功 | toast + 自动切页签 | `…runSuccess` = 快捷采集完成，已切换到采集结果（素材 {count} 条） |
| 无素材 | 成功但正文首行声明 | 引擎生成的声明行（中文正文，属采集**内容**不是 UI 文案） |
| 失败（未配模型） | 卡内错误条 + toast | `…errorLlmNotConfigured` = 未配置默认大模型，无法执行快捷采集；请到「模型服务」页配置后重试 |
| 失败（模型调用） | 同上 | `…errorLlmFailed` = 大模型调用失败：{message} |
| 失败（空输出） | 同上 | `…errorLlmEmpty` = 大模型返回空内容，请稍后重试或更换模型 |
| 失败（参数） | 同上 | `…errorValidation` = 指令参数不合法：{message} |
| 失败（未知） | 同上 | `…errorUnknown` = 快捷采集失败：{message} |
| 自定义空态 | EmptyState | 标题 `…emptyTitle` = 还没有自定义指令；描述 `…emptyDesc` = 把常用的检索方向存成指令，下次一键出发；按钮 `…emptyAction` = 新增指令 |
| 新增按钮 | 常驻 | `…add` = 新增自定义指令 |
| 弹窗标题 | 新增/编辑 | `…dialogAddTitle` = 新增快捷采集指令 / `…dialogEditTitle` = 编辑快捷采集指令 |
| 标题字段 | 输入 + 计数器 + 内联错误 | 标签 `…titleLabel` = 标题；提示 `…titleHint` = 给这条指令起个一眼能认出的名字（1–40 字）；占位 `…titlePlaceholder` = 例如：AI 领域动向 |
| 指令字段 | 多行 + 计数器 + 内联错误 | 标签 `…promptLabel` = 快捷采集内容（AI 指令）；提示 `…promptHint` = 这段文字会作为提示词原样发送给大模型，建议写清要检索什么、输出格式与来源要求；占位 `…promptPlaceholder` = 例如：请检索过去 24 小时内值得关注的 AI 开源项目，输出 3 条「建议关注」（含项目名、来源链接、为什么值得关注、建议动作），用中文，不要编造。 |
| 关键词字段 | 输入（逗号分隔）+ 提示 | 标签 `…keywordsLabel` = 检索关键词（可选）；提示 `…keywordsHint` = 逗号分隔，最多 5 个；留空则不做联网检索，仅用大模型知识回答；占位 `…keywordsPlaceholder` = 例如：AI, 大模型, 开源项目 |
| 时间范围 | 下拉 | 标签 `…windowLabel` = 素材时间范围；选项 `…window24/48/168/0` = 最近 24 小时 / 最近 48 小时 / 最近 7 天 / 不限时间 |
| 数据源 | 只读展示（固定三源） | `…sourcesLabel` = 素材来源：Reddit · Hacker News · GitHub（免费公开源） |
| 校验错误 | 字段下方红字 | `…errTitleRequired` / `…errTitleTooLong` / `…errTitleDuplicate` / `…errPromptRequired` / `…errPromptShort` / `…errPromptTooLong` / `…errKeywordsTooMany` / `…errKeywordTooLong` |
| 删除确认 | notifyConfirm | `…deleteConfirm` = 删除快捷采集指令「{title}」？已采集的结果不受影响。 |
| 保存/取消 | 弹窗底部 | `…save` = 保存 / `…cancel` = 取消 |
| 溯源徽章 | 结果条目卡片 | 既有卡片已显示 `source`（= 指令标题）；文案库同 |

## 8. 数据校验（三层，逐条）

### 8.1 渲染层（表单，即时）

| 字段 | 规则 | 触发时机 | 错误文案键 |
| --- | --- | --- | --- |
| 标题 | 必填；去空白；≤40 | blur + 提交 | errTitleRequired / errTitleTooLong |
| 标题 | 与其它自定义指令重名（不区分大小写） | 提交 | errTitleDuplicate |
| 指令 | 必填；去空白后 ≥10 | blur + 提交 | errPromptRequired / errPromptShort |
| 指令 | ≤4000 | 输入计数 | errPromptTooLong |
| 关键词 | 拆分（`,` `，` `、`）；去空；去重；≤5 | 输入 | errKeywordsTooMany |
| 关键词 | 单项 >30 字 | 输入 | errKeywordTooLong |
| 时间范围 | 枚举 `0/24/48/168` | 下拉受限 | 不可能的取值不进入 |

> 计数器显示：标题 `n/40`、指令 `n/4000`；超限时计数器变红。

### 8.2 IPC 层

- `quick-collect:run` 用 `wrapIpcHandlerRaw` + `withSenderCheck`；非对象参数 → `{ code: -2, message: '缺少参数对象' }`。
- `command` 缺失或非对象 → `-2` + `QC_COMMAND_REQUIRED`。
- 通过 `validateQuickCollectCommand` 的具体失败项 → `-2` + 领域码（`QC_TITLE_REQUIRED` / `QC_TITLE_TOO_LONG` / `QC_PROMPT_REQUIRED` / `QC_PROMPT_TOO_SHORT` / `QC_PROMPT_TOO_LONG` / `QC_KEYWORDS_TOO_MANY` / `QC_KEYWORD_TOO_LONG` / `QC_WINDOW_INVALID` / `QC_SOURCES_INVALID`）。
- `quick-collect:list-presets` 无参，返回内置目录（只读快照，`Object.freeze` 深拷贝出口，防止渲染端改到主进程单例）。

### 8.3 引擎层（纵深防御）

- 再次 `validateQuickCollectCommand`；此处失败直接抛错（不信任 IPC 层的"已校验"）。
- 素材：`url` 必须过 `safeHttpUrl`；`title` 必须非空字符串（≤300 字，超长截断）；`snippet` 截断 200 字；非法条目丢弃并计入 `dropped`。
- LLM 输出：`typeof content === 'string'`；去空白后为空 → `QC_LLM_EMPTY`；超过 20000 字截断（防止把整篇灌进采集库）。
- 素材条数与来源一并回传（`quickCollect.materialCount`），让用户能判断"结论有没有据"。

## 9. 接口契约

### 9.1 IPC 通道

| 通道 | 入参 | 返回 | 守卫 |
| --- | --- | --- | --- |
| `quick-collect:list-presets` | 无 | `{ code: 0, data: QuickCollectCommand[] }` | 受控 ipcMain（咽喉点） |
| `quick-collect:run` | `{ command: QuickCollectCommand }` | 成功 `{ code: 0, data: CollectedItem }`；失败 `{ code, message }` | `withSenderCheck` + `wrapIpcHandlerRaw` |
| `quick-collect:progress`（事件，主进程→渲染端） | `{ requestId, stage, percent }` | — | 仅 send，不接收 |

### 9.2 preload 暴露（扁平方法名，走 `src/api` 桥接层）

| 方法 | 通道 |
| --- | --- |
| `quickCollectListPresets()` | `quick-collect:list-presets` |
| `quickCollectRun(payload)` | `quick-collect:run` |
| `onQuickCollectProgress(cb)` | 订阅 `quick-collect:progress`（返回取消订阅函数） |

### 9.3 渲染端桥接（`src/api/quick-collect.js`）

```js
export async function quickCollectListPresets()
export async function quickCollectRun(command)     // 内部包 { command }
export function onQuickCollectProgress(cb)
```

全部经 `invokeWithFallback` / `on`（禁止 `window.electronAPI` 直调 —— Gate 10）。

## 10. 非功能需求

| 项 | 要求 |
| --- | --- |
| 性能 | 单次执行最坏 3 次检索 + 1 次 LLM；检索 8s 超时（既有实现），LLM 由 `apiUsageGovernor` 网关管控 |
| 可观测 | 阶段进度事件；失败领域码；`log.warn` 记录检索失败（只记源名与计数，不记用户指令原文 —— 指令可能含私密业务方向） |
| 安全 | 素材 URL 过 `safeHttpUrl`；无硬编码密钥；renderer 不直调 electronAPI；`withSenderCheck` 拦外部 sender |
| i18n | 新增用户可见文案一律进 `src/locales/collection/{zh,en}.js`（成对）；内置指令正文（产品内容）在主进程，不进渲染端 CJK 扫描面 |
| 兼容 | 无破坏性变更；`collected_items` 既有条目无 `quickCollect` 字段时正常显示 |
| 依赖 | 零新增 npm 依赖、零新增配置项、零新增网络源 |
| 行数门禁 | `Collection.vue` 是 targets 零容差文件（2920），本特性对它的净增量必须 ≤30 行，其余全部落独立组件/模块 |

## 11. 目录与文件清单

**主进程**

- `apps/desktop/electron/services/quick-collect-presets.js` — 6 条内置指令（只读目录）
- `apps/desktop/electron/services/quick-collect-command.js` — 指令校验/归一（纯函数，表单与 IPC 共用口径）
- `apps/desktop/electron/services/quick-collect-materials.js` — 素材合并/去重/时间窗口/协议判据/排序
- `apps/desktop/electron/services/quick-collect-prompt.js` — 提示词组装 + 声明行
- `apps/desktop/electron/services/quick-collect-engine.js` — 编排（依赖注入 `searchFn` / `llmFn`）
- `apps/desktop/electron/ipc-handlers/quick-collect.js` — 2 条通道 + 进度事件

**preload**：`apps/desktop/electron/preload/quick-collect.js` + `preload/index.js` 注册 + `index.bundle.js` 重生成

**渲染端**

- `apps/desktop/src/api/quick-collect.js` — 桥接层
- `apps/desktop/src/features/collection/quick-collect-commands.js` — 前端纯逻辑（归一/校验/编解码/排序）
- `apps/desktop/src/features/collection/useQuickCollectCommands.js` — composable（加载/CRUD/落盘）
- `apps/desktop/src/features/collection/QuickCollectTab.vue` — 页签按钮
- `apps/desktop/src/features/collection/QuickCollectPanel.vue` — 面板（列表 + 执行态 + 错误态）
- `apps/desktop/src/features/collection/QuickCollectCommandDialog.vue` — 新增/编辑弹窗
- `apps/desktop/src/features/collection/quick-collect-ui.js` — 对 `Collection.vue` 的**一行 import** 出口
- `apps/desktop/src/features/collection/collected-item.js` — 新增 `quickCollect` 字段透传（唯一出口）

## 12. 验收标准

| # | 验收项 | 判据 |
| --- | --- | --- |
| AC-1 | 页签存在且可切换 | 采集页出现「快捷采集」页签，`aria-selected` 正确 |
| AC-2 | 6 条内置指令可见且不可编辑/删除 | 内置卡无编辑/删除按钮；删除 API 对内置项返回拒绝 |
| AC-3 | 自定义指令新增/编辑/删除并可持久化 | 刷新后列表不变；存储键内容为 `{version:1,commands:[...]}` |
| AC-4 | 表单校验逐条生效 | 空标题/超长标题/重名/短指令/6 个关键词/31 字关键词全部给出对应内联错误且阻断保存 |
| AC-5 | 执行返回条目且与手动采集同形 | 执行后自动切到采集页签，结果卡出现；条目入 `collectedItems` 且落盘；`normalizeCollectedItem` 输出含 `quickCollect` |
| AC-6 | 无素材时不编造 | `retrieval='empty'` 时正文首行是引擎声明行；模型提示词内素材段为「本次未获得素材」 |
| AC-7 | 未配置大模型时明确报错 | 返回 `-101`，界面显示 `errorLlmNotConfigured` 文案，不产生空条目 |
| AC-8 | 非法 URL 素材不进库 | 非法 url 素材被丢弃，`materialCount` 不含它 |
| AC-9 | 时间窗口过滤生效 | `windowHours=48` 时 72 小时前的素材不参与（单测断言） |
| AC-10 | 内置指令词条与用户给定文本逐字一致 | 单测对 `builtin-ai-trends.prompt` 做逐字断言 |
| AC-11 | 门禁全绿 | ipc-bridge / ipc-sender-guard / locale-sync（pair+cjk+keys）/ max-lines / eslint / 打包 |
| AC-12 | 无 `Collection.vue` 行数违约 | `check-max-lines.js` 通过（净增量 ≤30 行） |

## 13. 未闭合（诚实记录）

1. **执行不可取消**：P1；长时间 LLM 调用只能等返回或关页面（页面关闭后结果被丢弃，库中不留脏条目 —— 因为条目只在渲染端收到结果后才构造）。
2. **素材源为英文三源**：中文平台（小红书/抖音/公众号）动态覆盖有限；PRD 已如实写明，扩展属 P1。因此内置指令的结果更偏"技术/AI 圈"事件，不承诺覆盖中文平台内幕消息。
3. **本机未做真机端到端点击验证**：CI 的 `gui-test`（打包应用启动存活）闭合打包链路；真实"点一下拿到结果"依赖用户已配置默认大模型与可访问 Reddit/HN/GitHub 的网络，**受本机条件限制未在本轮实测**（引擎层用真实 `content-intelligence` 结构与注入式假源做单测，网络路径不假装已验证）。
4. **QM-4 视觉基线**：本特性新增页签属可见像素变化，`collection` 页截图基线需要按 QM-4 从同一次 CI run 的 artifact 重取（记录内回填）。
