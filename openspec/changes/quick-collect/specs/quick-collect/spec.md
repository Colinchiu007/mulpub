## ADDED Requirements

### Requirement: 快捷采集指令是显式的可校验数据结构

系统 SHALL 把「快捷采集指令」表达为一个显式数据结构（`QuickCollectCommand`），其必填字段与取值闭集为：
`title`（去空白后 1–40 字符）、`prompt`（去空白后 10–4000 字符）、`keywords`（0–5 项，每项 1–30 字符）、
`windowHours ∈ {0, 24, 48, 168}`、`sources ⊆ {reddit, hackernews, github}`、`builtin: boolean`。
校验判据的唯一实现 SHALL 是 `apps/desktop/electron/services/quick-collect-command.js` 的
`validateQuickCollectCommand`，IPC 层与引擎层 SHALL 共用它（禁止第二份口径）；非法输入 SHALL 返回
领域码（`QC_TITLE_REQUIRED` / `QC_TITLE_TOO_LONG` / `QC_PROMPT_REQUIRED` / `QC_PROMPT_TOO_SHORT` /
`QC_PROMPT_TOO_LONG` / `QC_KEYWORDS_TOO_MANY` / `QC_KEYWORD_TOO_LONG` / `QC_WINDOW_INVALID` / `QC_SOURCES_INVALID`），
SHALL NOT 静默截断成合法值。

#### Scenario: 超长标题被拒绝而不是截断
- **WHEN** 调用方提交 41 个字符的 `title`
- **THEN** 校验返回 `{ ok: false, code: 'QC_TITLE_TOO_LONG' }`，且归一化结果不包含该指令

#### Scenario: 关键词数量与长度边界
- **WHEN** 提交 6 个关键词，或其中一项为 31 个字符
- **THEN** 分别返回 `QC_KEYWORDS_TOO_MANY` 与 `QC_KEYWORD_TOO_LONG`，两条都不放行

#### Scenario: 时间窗口只接受闭集
- **WHEN** 提交 `windowHours = 72`
- **THEN** 返回 `QC_WINDOW_INVALID`，不按"最接近的合法值"处理

### Requirement: 内置指令是不可编辑不可删除的只读目录

系统 SHALL 在主进程内置 6 条官方指令（`builtin-ai-trends` / `builtin-ai-papers` / `builtin-hot-topics` /
`builtin-dev-tools` / `builtin-peer-content` / `builtin-ai-howto`；2026-10-11 用「AI 前沿论文速览」「AI 实操技巧与工作流」
替换了原 `builtin-platform-policy`「平台规则与合规动向」与 `builtin-risk-alert`「舆情风险与避雷」—— 后两条是
agent 推演内容、并非用户要求，用户明确不需要），其中 `builtin-ai-trends` 的 `prompt`
SHALL 与用户给定文本**逐字一致**，且每条词条 SHALL 声明 `provenance ∈ {'user','agent'}`（恰有一条为 `'user'`）。内置指令 SHALL NOT 落盘（用户存储键中只保留自定义指令），
其编辑/删除入口 SHALL NOT 渲染；`listPresets()` SHALL 返回深拷贝，调用方修改返回值 SHALL NOT 影响主进程单例。

#### Scenario: 内置指令不落盘
- **WHEN** 用户保存任意一条自定义指令后读取设置键 `quick_collect_commands`
- **THEN** 键内 `commands` 不含任何 `builtin === true` 的条目，仍为 6 条内置 + N 条自定义的合并视图

#### Scenario: 修改返回的目录不影响下一次读取
- **WHEN** 调用方对 `listPresets()` 的返回值做 `push` / 改字段
- **THEN** 再次调用 `listPresets()` 得到的仍是 6 条未被污染的指令

#### Scenario: 内置指令的提示词逐字采用
- **WHEN** 读取 `builtin-ai-trends.prompt`
- **THEN** 其内容与 PRD 引用的用户给定提示词逐字相同（含"过去48小时""3-5条'建议关注'"等细节）

### Requirement: 自定义指令支持增删改且跨会话持久化

系统 SHALL 支持自定义指令的新增、编辑、删除，并把结果持久化到设置键 `quick_collect_commands`，
形状为 `{ version: 1, commands: [...] }`。读路径 SHALL 容忍历史形态（裸数组按 v0 迁移）并对每条执行
同一份校验，丢弃不合法条目且**计数**（`skipped`），SHALL NOT 因单条脏数据清空整个列表。
标题字段 SHALL 在自定义指令间唯一（比较前去除首尾空白、不区分大小写）。删除 SHALL 有二次确认，
且 SHALL NOT 影响任何已采集结果。

#### Scenario: 刷新后自定义指令仍在
- **WHEN** 用户新增一条自定义指令并刷新应用
- **THEN** 列表仍显示该指令，且存储键内容为 `{ version: 1, commands: [<该指令>] }`

#### Scenario: 脏数据不导致整表消失
- **WHEN** 存储键中混入一条 `prompt` 为空的条目
- **THEN** 该条被丢弃并计入 `skipped`，其余合法条目照常显示

#### Scenario: 重名标题阻断保存
- **WHEN** 用户保存标题为 ` ai 领域动向 `（含首尾空格、大小写不同）而列表已有 `AI 领域动向`
- **THEN** 表单报 `errTitleDuplicate` 且不写入存储

### Requirement: 执行链路必须先检索真实素材再生成，且无素材时不得编造

系统 SHALL 通过唯一通道 `quick-collect:run` 执行指令，顺序为：校验 → 按关键词检索（每关键词只取前 3 个，
`noCache: true`）→ 合并/去重/时间窗口过滤/协议判据 → 组装提示词 → 调用默认大模型 → 归一为采集条目。
时间窗口开启（`windowHours > 0`）时，缺时间戳或无合法 `url` 的素材 SHALL 被丢弃；
时间窗口关闭（`0`）时不按时间过滤但仍要求合法 `url`。素材条数 SHALL 随结果回传（`quickCollect.materialCount`），
并以 `retrieval ∈ {ok, partial, empty, skipped}` 区分"有素材/部分失败/无素材/未检索"。
`retrieval` 为 `empty` 或 `skipped` 时，结果正文 SHALL 由**引擎**（不是模型）在首行插入声明行；
若模型正文已自述同类声明则 SHALL NOT 重复插入。

#### Scenario: 48 小时窗口过滤掉过期素材
- **WHEN** 素材集合含 72 小时前与 2 小时前各一条，`windowHours = 48`
- **THEN** 参与提示词的只有 2 小时前那条，`materialCount === 1`

#### Scenario: 非法 URL 素材不进库
- **WHEN** 某素材 `url` 为 `javascript:alert(1)`
- **THEN** 该条被丢弃，`sourceUrl` 不会取到它，`materialCount` 不含它

#### Scenario: 无素材时正文首行是引擎声明
- **WHEN** 所有关键词都检索不到最近素材
- **THEN** 结果 `quickCollect.retrieval === 'empty'`，正文第一行是"本次未检索到 N 小时内的可核对素材…"

#### Scenario: 未配置大模型时明确失败且不产生空条目
- **WHEN** 默认 LLM 未配置
- **THEN** 返回 `{ code: -101, message: 'QC_LLM_NOT_CONFIGURED' }`，渲染端不向 `collectedItems` 写入任何条目

### Requirement: 快捷采集结果与手动采集同形同链路

执行成功返回的条目 SHALL 经 `normalizeCollectedItem` 唯一出口进入 `collectedItems` 并落盘，
字段 SHALL 满足既有采集条目形状，另含只读溯源字段 `quickCollect`
（`{ commandId, commandTitle, builtin, windowHours, sources, materialCount, retrieval, generatedAt }`）。
`source` SHALL 为指令标题，`sourceUrl` SHALL 为第一条素材 URL（无素材时为空串，且不参与既有去重集合）。
渲染端点选指令执行成功后 SHALL 自动切到「采集」页签并复用同一张结果卡
（改写策略 / 字数区间 / 创建草稿 / 加入爆款库 / 发布），SHALL NOT 新写第二套结果 UI。

#### Scenario: 结果条目可继续走既有闭环
- **WHEN** 快捷采集成功后用户点击「创建草稿」
- **THEN** 草稿内容取自该条目的 `content`，与手动采集条目的行为一致

#### Scenario: 溯源字段在落盘后仍可读
- **WHEN** 结果条目落盘并由文案库重新载入
- **THEN** `quickCollect.commandTitle` 与 `materialCount` 仍可读

### Requirement: 快捷采集通道必须带 sender 守卫且进度可见

`quick-collect:run` SHALL 经 `withSenderCheck` 与受控 ipcMain 双重把关，非可信 sender SHALL 得到
`{ code: -3 }` 且 SHALL NOT 触发任何检索或模型调用；参数非对象 SHALL 得到 `{ code: -2 }`。
执行过程 SHALL 通过 `quick-collect:progress` 事件向发起窗口推送阶段（`retrieving` / `summarizing` / `done`），
渲染端在运行时 SHALL 禁用其它指令的执行与管理入口。日志 SHALL 只记录源名、条数与阶段，
SHALL NOT 记录用户指令正文。

#### Scenario: 外部 sender 被拒绝
- **WHEN** 打包态下由非受信来源调用 `quick-collect:run`
- **THEN** 返回 `{ code: -3 }`，检索函数与 LLM 函数都不被调用

#### Scenario: 运行期间管理入口禁用
- **WHEN** 某条指令处于 `running` 状态
- **THEN** 面板上「新增 / 编辑 / 删除 / 其它指令的执行」按钮均为 disabled
