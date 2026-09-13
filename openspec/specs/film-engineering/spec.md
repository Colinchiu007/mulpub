# film-engineering Specification

## Purpose
影视工程（film-engineering）流水线：将开源 AI 电影《Hell Grind》的真实分镜结构、提示词与参考素材以 film-kit 数据资产形式复刻进应用，支持用户浏览分镜、一键复制提示词、勾选分镜生成资源、输入剧本按 Hell Grind 工程方法套用（剧情不同、方法复刻）。
## Requirements
### Requirement: film-kit 数据资产 schema 与加载校验
应用 SHALL 随包携带 film-kit 数据资产目录，包含 film-manifest.json、shot-library.json、reference-registry.json、prompt-doctrine.json（含中英双语方法论）与精选参考图目录；kit 加载 SHALL 执行 schema 校验（manifest：schemaVersion=1、filmMeta 含 title/durationSec/logline/characters、scenes 每项含唯一 id/非空 name/count>=0/parentId/level 且树无环；shot-library：shotId 唯一、prompt 非空且 <=20000 字符、refTokens 为合法 uuid 格式；reference-registry：token 为合法 uuid、imageUrls 仅 https）。任一文件缺失、JSON 损坏或 schema 非法 SHALL 视为 kit 不可用（fail-closed），相关查询接口返回 FILM_KIT_UNAVAILABLE 错误，前端显示空态与重试入口，禁止静默降级为部分数据。

#### Scenario: 正常加载返回完整目录
- **WHEN** film-kit 全部文件存在且通过 schema 校验
- **THEN** 服务启动时加载成功，分镜树、分镜详情与参考注册表查询均返回完整数据

#### Scenario: 缺文件或坏 JSON 时 fail-closed
- **WHEN** shot-library.json 缺失或 JSON 解析失败
- **THEN** 服务标记 kit 不可用，所有 film-engineering 查询 IPC 返回 FILM_KIT_UNAVAILABLE，前端显示空态与重试，不返回部分分镜数据

#### Scenario: schema 非法被拒绝
- **WHEN** shot-library.json 中某分镜 prompt 为空字符串、shotId 重复或 refTokens 非 uuid 格式
- **THEN** 加载失败并报告具体校验错误（含文件与条目索引），kit 整体不可用

### Requirement: 分镜库查询契约
film-engineering SHALL 提供分镜树查询（listScenes：树节点含 id/name/count/level）、分镜列表查询（listShots：按 sceneId 过滤、含 shotId/sceneId/prompt/model/refTokens/resultUrl/宽高）与分镜详情查询（getShot：附加 inputImages 与参考图解析结果）；未知 sceneId/shotId SHALL 返回明确错误而非空结果；返回的提示词 SHALL 保留原文（含引用令牌），不做改写。

#### Scenario: 查询分镜树与列表
- **WHEN** 用户进入影视工程页面请求分镜树
- **THEN** 返回 film-manifest 中的场景树（含各场景素材计数与层级），点击场景后返回该场景分镜列表（含真实提示词原文与模型标签）

#### Scenario: 非法 id 报错
- **WHEN** 请求 listShots 传入不存在的 sceneId 或 getShot 传入不存在 shotId
- **THEN** 返回带具体 id 的错误，前端提示数据不存在，不返回空数组冒充成功

### Requirement: 一键复制文本组装
film-engineering SHALL 支持一键复制，至少提供四种复制模式：完整提示词、分块说明（ACTION TIMING / CHARACTER ACTING / GEO SPATIAL LAYOUT / AUDIO / POSITIVE CONSTRAINTS 等块的标签与内容）、角色描述符、GEO 布局块；复制文本 SHALL 由后端组装并返回（保证跨平台一致），前端复制成功后提示「已复制到剪贴板」，剪贴板不可用时提示改用手动选择。

#### Scenario: 四种模式复制文本
- **WHEN** 用户点击「复制完整提示词」或「复制分块说明」「复制角色描述符」「复制 GEO 布局块」
- **THEN** 后端返回对应组装文本，前端写入剪贴板并显示成功提示；分块说明包含各块标签与内容，空块以「无」标注

#### Scenario: 剪贴板失败降级
- **WHEN** navigator.clipboard 写入失败（权限拒绝/不可用）
- **THEN** 前端显示提示词文本域供手动选择复制，并提示复制失败原因，不静默失败

### Requirement: 剧本套用引擎
film-engineering SHALL 提供剧本套用能力：输入剧本（非空字符串，<=10000 字符）与角色映射（<=10 键、值为非空字符串），按 Hell Grind 工程模板把剧本分场并映射到分镜模板，输出 adaptedShots（每项与 kit 分镜同构：shotId/sceneId/prompt/model/refTokens/roleBindings），剧情来自用户剧本、实现方法（提示词块结构、模型类型、参考图约定）复刻自 Hell Grind；可选 LLM 润色（复用 PromptBridge），LLM 不可用时 SHALL 以本地模板结果继续并标记 `llmEnhanced: false`，不得因 LLM 失败阻塞套用；超长剧本/非法角色映射 SHALL 被拒绝并给出明确错误。

#### Scenario: 正常套用生成同构分镜
- **WHEN** 用户输入 3000 字剧本并保留默认角色映射（ROKO/JAXX/LULU/REIN）
- **THEN** 返回 N 个 adaptedShots，每项含按 Hell Grind 块模板组装的提示词、模型类型与角色绑定；剧情内容全部来自用户剧本，模板结构来自 Hell Grind；输出可被勾选生成功能消费

#### Scenario: 空剧本或超长剧本拒绝
- **WHEN** 剧本为空字符串或超过 10000 字符、角色映射超过 10 键或值为空
- **THEN** 请求被拒绝并返回具体校验错误（如「剧本不能为空」「剧本不能超过 10000 字」）

#### Scenario: LLM 不可用降级
- **WHEN** PromptBridge 健康检查失败或润色请求超时
- **THEN** 套用仍以本地模板结果完成，输出标记 llmEnhanced=false，提示「已使用本地模板润色」

### Requirement: film-engineering 流水线阶段契约
film-engineering SHALL 注册为应用流水线（PIPELINES 新增条目），执行链 SHALL 包含四个阶段：film_load_template（加载 kit 模板）、film_adapt_script（剧本套用）、film_select_shots（分镜选择过滤）、film_export_prompts（导出提示词集合）；阶段 SHALL 遵循既有 StageExecutor 契约（checkpoint/进度/错误上报），任一阶段失败 SHALL 在错误上下文标注阶段名与原因，不做静默回退。

#### Scenario: 流水线完整执行
- **WHEN** 用户从流水线入口启动 film-engineering 并完成剧本输入
- **THEN** 四个阶段按序执行，context 携带 kit 模板、adaptedShots、选中分镜与导出文本，进度与阶段状态按既有流水线 UI 展示

#### Scenario: 阶段失败上报
- **WHEN** film_adapt_script 阶段因剧本校验失败
- **THEN** 流水线以失败状态结束，错误信息含阶段名与校验原因，前端显示可操作提示

### Requirement: IPC 参数校验与 sender 校验

film-engineering 全部 IPC 通道 SHALL 经过 withSenderCheck 校验（仅受信窗口可调用），并对入参执行运行时校验（film-kit 查询类：sceneId/shotId 为字符串；套用类：script 非空 <=10000、characterMap <=10 键且值非空、shots 数组 <=50 项且每项 prompt 非空 <=50000）；通过校验的参数化通道 MUST 将原始 IPC event 作为第一个参数、将业务参数按调用顺序转发给业务逻辑；非法入参 SHALL 返回带原因的拒绝错误，不得进入业务逻辑。

#### Scenario: 非受信 sender 拒绝

- **WHEN** 非受信窗口（如外部 file:// 或未注册 sender）调用 film-engineering IPC
- **THEN** 调用被拒绝并记录安全日志，业务逻辑不执行

#### Scenario: 非法入参拒绝

- **WHEN** script 为空、超过 10000 字符或 shots 数组超过 50 项
- **THEN** IPC 返回明确校验错误（含字段名与边界），不进入套用逻辑

#### Scenario: 合法参数按原顺序转发

- **WHEN** 受信窗口以合法 sceneId、shotId 或选中分镜参数调用参数化 film-engineering IPC
- **THEN** 业务逻辑收到原始 IPC event 和未错位的业务参数，调用成功且不返回参数校验错误

#### Scenario: 导出/生成负载可被结构化克隆

- **WHEN** renderer 对选中分镜调用 export 或 generate-selected，且分镜包含 refTokens 数组
- **THEN** 传给 ipcRenderer.invoke 的负载必须为纯 JSON（可被 structuredClone 复制），不得携带 Vue 响应式代理，也不得触发 “An object could not be cloned”

### Requirement: 前端交互契约
前端 SHALL 提供 /film-engineering 路由与三栏视图：场景树（加载骨架/空态+重试/搜索过滤）、分镜详情（提示词全文可折叠、参考图缩略、模型与来源标签、ref 引用解析、复制按钮组）、操作面板（分镜勾选汇总、复制全部、生成图片、导出 JSON/Markdown、剧本套用表单与结果列表）；所有用户可见文案 SHALL 进 locales（zh/en 成对），产品名词（Hell Grind、影视工程、分镜、剧本套用）SHALL 进 i18n-glossary；provider 未配置时勾选生成 SHALL 引导用户到模型设置页并提示原因。

#### Scenario: 三栏浏览与复制
- **WHEN** 用户进入影视工程页面
- **THEN** 左侧显示场景树（含素材计数），点击场景中间显示分镜列表，点击分镜右侧显示详情与复制按钮组；复制成功显示「已复制」提示

#### Scenario: 勾选生成与 provider 引导
- **WHEN** 用户勾选若干分镜后点击「生成图片」且当前 provider 未配置
- **THEN** 提示「请先在模型设置中配置图片生成 Provider」，并提供跳转设置页入口，不发起无效生成

#### Scenario: 空态与重试
- **WHEN** kit 加载失败（FILM_KIT_UNAVAILABLE）或分镜查询失败
- **THEN** 页面显示空态说明与重试按钮，重试成功后恢复完整视图

