# film-engineering Specification

## Purpose
影视工程（film-engineering）流水线：将开源 AI 电影《Hell Grind》的真实分镜结构、提示词与参考素材以 film-kit 数据资产形式复刻进应用，支持用户浏览分镜、一键复制提示词、勾选分镜生成资源、输入剧本按 Hell Grind 工程方法套用（剧情不同、方法复刻）。
## Requirements
### Requirement: film-kit 数据资产 schema 与加载校验
应用 SHALL 支持两级 film-kit 数据资产来源：随包精简 kit（asar 内 film-kit 目录）与用户数据目录全量 kit（由导入工具生成，落点为共享数据锚点下的 kit 目录，含 film-manifest.json、shot-library.json、reference-registry.json、prompt-doctrine.json 与精选参考图目录）。加载 SHALL 优先使用用户数据目录全量 kit，缺失或校验失败时回退随包精简 kit；两者均不可用 SHALL 视为 kit 不可用（fail-closed），查询接口返回 FILM_KIT_UNAVAILABLE。kit 加载 SHALL 执行 schema 校验：manifest：schemaVersion、filmMeta 含 title/durationSec/logline/characters、scenes 每项含唯一 id/非空 name/count>=0/parentId/level 且树无环；shot-library：shotId 唯一、sceneId 存在于 manifest、prompt 非空且不超过统一上限常量 FILM_PROMPT_MAX_LEN（50000 字符，随包与全量两级同值）、refTokens 为合法 uuid 格式、可选扩展字段（durationSec/width/height/aspectRatio/model/resultUrl/iterationCount）存在时类型与取值范围合法；reference-registry：token 为合法 uuid、imageUrls 仅 https。任一文件缺失、JSON 损坏或 schema 非法 SHALL 拒绝该级 kit 并记录具体校验错误（含文件与条目索引），禁止静默降级为部分数据。

#### Scenario: 正常加载返回完整目录
- **WHEN** 用户数据目录存在通过校验的全量 kit（每场景可含多镜）
- **THEN** 服务优先加载全量 kit，分镜树、分镜详情与参考注册表查询返回全量数据；无全量 kit 时加载随包精简 kit 返回完整精简数据

#### Scenario: 缺文件或坏 JSON 时 fail-closed
- **WHEN** 全量 kit 的 shot-library.json 缺失或 JSON 解析失败
- **THEN** 若随包精简 kit 完好则记录校验错误并回退加载精简 kit（错误在前端可见，非静默）；若精简 kit 同样不可用，所有 film-engineering 查询 IPC 返回 FILM_KIT_UNAVAILABLE，前端显示空态与重试，不返回部分分镜数据

#### Scenario: schema 非法被拒绝
- **WHEN** 某级 kit 中某分镜 prompt 为空字符串或超过 FILM_PROMPT_MAX_LEN、shotId 重复、refTokens 非 uuid 格式，或扩展字段 durationSec 为负数
- **THEN** 该级 kit 整体校验失败并报告具体错误（含文件与条目索引），按回退链处理，不回退到该级部分数据

### Requirement: 分镜库查询契约
film-engineering SHALL 提供分镜树查询（listScenes：树节点含 id/name/count/level）、分镜列表查询（listShots：按 sceneId 过滤、含 shotId/sceneId/prompt/model/refTokens/resultUrl/宽高及全量 kit 扩展字段 durationSec/aspectRatio/iterationCount）与分镜详情查询（getShot：附加 inputImages 与参考图解析结果）；未知 sceneId/shotId SHALL 返回明确错误而非空结果；返回的提示词 SHALL 保留原文（含引用令牌），不做改写。全量 kit 下单场景可含数百镜：listShots SHALL 支持 limit/offset 分页参数（缺省返回全部时 SHALL 有服务端上限保护并在响应中携带 total），响应总负载超过 IPC 安全上限时 SHALL 截断并提示分页获取，不得静默丢弃数据。

#### Scenario: 查询分镜树与列表
- **WHEN** 用户进入影视工程页面请求分镜树
- **THEN** 返回 film-manifest 中的场景树（含各场景素材计数与层级），点击场景后返回该场景分镜列表（含真实提示词原文与模型标签）

#### Scenario: 查询多镜场景分页列表
- **WHEN** 全量 kit 下请求某场景（含 241 镜）的 listShots，传 limit=50/offset=0
- **THEN** 返回该场景前 50 镜（含扩展字段）与 total=241，提示词原文与引用令牌完整保留

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
film-engineering SHALL 注册为应用流水线（PIPELINES 条目），执行链 SHALL 包含六个阶段：film_load_template（加载 kit 模板）、film_adapt_script（剧本套用）、film_select_shots（分镜选择过滤）、film_export_prompts（导出提示词集合）、film_generate_videos（分镜视频生成）、film_render（成片合成）；阶段 SHALL 遵循既有 StageExecutor 契约（checkpoint/进度/错误上报），任一阶段失败 SHALL 在错误上下文标注阶段名与原因，不做静默回退。film_generate_videos SHALL 声明 checkpointRequired=true（前四阶段维持 checkpointRequired=false）。

#### Scenario: 流水线完整执行
- **WHEN** 用户从电影工程页面勾选分镜发起视频生成，完成成本确认并在前序阶段就绪后推进流水线
- **THEN** 六个阶段按序执行，context 携带 kit 模板、adaptedShots、选中分镜、导出文本、逐镜视频结果清单与成片路径，进度与阶段状态按既有流水线契约回显

#### Scenario: 阶段失败上报
- **WHEN** film_adapt_script 阶段因剧本校验失败
- **THEN** 流水线以失败状态结束，错误信息含阶段名与校验原因，前端显示可操作提示

#### Scenario: 生成前停在成本确认点
- **WHEN** 流水线推进至 film_generate_videos 阶段入口
- **THEN** 流水线进入等待确认（checkpoint）状态，未经用户 advance 不发生任何视频 provider 调用，不产生计费请求

### Requirement: IPC 参数校验与 sender 校验

film-engineering 全部 IPC 通道 SHALL 经过 withSenderCheck 校验（仅受信窗口可调用），并对入参执行运行时校验（film-kit 查询类：sceneId/shotId 为字符串；套用类：script 非空 <=10000、characterMap <=10 键且值非空、shots 数组 <=50 项且每项 prompt 非空 <=50000；视频生成发起类：选中分镜 <=10 项且每项 prompt 非空、画幅为 16x9/9x16/source 枚举之一、时长为 5/8/10 枚举之一；单镜重试类：runId 与镜序号合法且属于该 run）；通过校验的参数化通道 MUST 将原始 IPC event 作为第一个参数、将业务参数按调用顺序转发给业务逻辑；非法入参 SHALL 返回带原因的拒绝错误，不得进入业务逻辑。

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
- **THEN** 传给 ipcRenderer.invoke 的负载必须为纯 JSON（可被 structuredClone 复制），不得携带 Vue 响应式代理，也不得触发 "An object could not be cloned"

#### Scenario: 视频生成入参枚举校验

- **WHEN** 视频生成发起请求携带非法画幅或时长值（如 4:3、7 秒）
- **THEN** IPC 返回枚举校验错误，流水线不启动

### Requirement: 画布式前端交互契约
前端 SHALL 提供 `/film-engineering` 路由并渲染**节点连线画布视图**（取代旧三栏视图）：画布承载五类可拖拽节点——剧本输入节点、人物参考图节点、场景参考图节点、分镜节点、产物节点（图片/视频），节点间 SHALL 可连线并支持选中、删除、缩放、平移、撤销/重做、自动布局与小地图导航；分镜节点 SHALL 就地展示提示词全文（可折叠）、模型与来源标签、ref 引用解析、所连参考图缩略与复制按钮组。起始面板 SHALL 收集剧本文本（非空、<=10000 字符）、人物/场景参考图上传、选项（画幅 16:9/9:16/保持源、全局时长 5/8/10 秒、角色映射 <=10 键、LLM 润色开关），并发起"自动拆分镜"。画布 SHALL 就地驱动全链路：拆分镜 → 编辑分镜 → 逐镜出图/出片 → 合成成片；页面 SHALL 渲染成本确认 checkpoint 卡（advance 前零 provider 调用）、逐镜生成结果态（成功/失败/单镜重试按钮）与成片完成态（打开所在文件夹/另存）。所有用户可见文案 SHALL 进 locales（zh/en 成对），产品名词（Hell Grind、影视工程、分镜、剧本套用、画布）SHALL 进 i18n-glossary；kit 不可用或查询失败 SHALL 在画布显示空态说明与重试；provider 未配置时发起生成 SHALL 引导用户到模型设置页并提示原因，不发起无效生成。

#### Scenario: 进入画布与空态
- **WHEN** 用户进入影视工程页面
- **THEN** 显示节点连线画布与起始面板；kit 加载失败时画布显示空态说明与重试按钮，重试成功后恢复可编辑画布

#### Scenario: 起始面板发起拆分镜
- **WHEN** 用户填入合法剧本文本、上传参考图、选好选项并点击"下一步：自动拆分镜"
- **THEN** 流水线用剧本套用引擎把剧本拆为分镜节点铺到画布上，各分镜节点显示按 Hell Grind 块模板组装的提示词与角色绑定；剧本为空或超 10000 字时禁用该按钮并提示具体校验原因

#### Scenario: 画布内编辑与复制
- **WHEN** 用户点击某分镜节点
- **THEN** 节点展开提示词全文（可折叠）、参考图缩略、模型与来源标签与复制按钮组；复制成功显示「已复制到剪贴板」，剪贴板不可用时降级为可选中文本域并提示原因

#### Scenario: 逐镜生成与 provider 引导
- **WHEN** 用户在画布上对分镜发起出图/出片且默认 provider 已配置
- **THEN** 先弹出成本确认卡（逐镜清单 + 画幅/时长），用户确认后才发生 provider 调用并实时回显逐镜进度与结果；provider 未配置时提示配置并给跳转入口，不启动生成

#### Scenario: 成片完成态
- **WHEN** 合成阶段完成产出 final.mp4
- **THEN** 画布显示成片完成态并提供"打开所在文件夹""另存"入口，报告含实测时长与清单规模

### Requirement: 画布初始拆分镜流
影视工程画布 SHALL 提供"剧本一步到分镜"的初始流：输入剧本文本（非空、<=10000 字符）、角色映射（<=10 键、值为非空字符串）、可选参考图与选项后，系统 SHALL 复用既有剧本套用引擎把剧本分场并映射为分镜集合，输出与 kit 分镜同构的 adaptedShots（shotId/sceneId/prompt/model/refTokens/roleBindings），并以分镜节点形式落到画布、按场景聚组；引擎返回的 warnings（如 LLM 不可用降级 llmEnhanced=false）SHALL 在画布以非阻断提示呈现，拆分镜仍成功完成；拆分镜阶段 MUST NOT 触发任何计费 provider 调用（生成发生在后续显式确认的生成阶段）。

#### Scenario: 剧本自动铺为分镜节点
- **WHEN** 用户输入 3000 字剧本并保留默认角色映射后发起拆分镜
- **THEN** 画布按场景分组铺出对应分镜节点，每节点提示词剧情来自用户剧本、块结构/模型类型来自工程模板；无任何计费调用发生

#### Scenario: LLM 不可用降级仍完成拆分镜
- **WHEN** 拆分镜时 LLM 润色链路健康检查失败
- **THEN** 拆分镜以本地模板结果完成，llmEnhanced=false，画布显示「已使用本地模板润色」的非阻断提示，分镜节点正常生成

#### Scenario: 非法剧本拒绝
- **WHEN** 剧本为空、超 10000 字符，或角色映射超 10 键/值为空
- **THEN** 拆分镜按钮禁用或返回带字段名与边界的校验错误，不产生部分分镜

### Requirement: 参考图上传与喂给生成
影视工程画布 SHALL 支持用户上传本地人物/场景参考图并作为生成输入：上传 SHALL 经 IPC 落盘到 film-engineering 受控媒体根下的参考目录，仅接受图片类型（png/jpg/webp）与单文件大小上限，落盘文件 SHALL 以规范化路径返回且越界/非图片/超限 SHALL 被拒绝并给出原因；参考图节点 SHALL 可连线到下游分镜/生成节点，连线后对应本地图 SHALL 作为 provider 的图生图/角色一致性参考输入随生成请求提交；用户未连接参考时生成 SHALL 正常走纯文本提示路径，不因缺参考失败。参考图上传 MUST NOT 自动外发（不在上传即调用 provider），仅在用户发起生成时随请求提交。

#### Scenario: 上传并作为参考连线
- **WHEN** 用户上传一张合法人物参考图并连到某分镜节点后发起生成
- **THEN** 该图经 IPC 落盘到受控媒体根，生成请求携带该本地参考作为图生图/一致性输入，产物体现角色一致性

#### Scenario: 非法参考图拒绝
- **WHEN** 上传文件非图片类型、超过单文件大小上限或落盘路径规范化后越界
- **THEN** IPC 返回带原因的校验错误，不落盘、不创建参考节点

#### Scenario: 无参考纯文本生成
- **WHEN** 分镜节点未连接任何参考图即发起生成
- **THEN** 生成以纯文本提示词正常提交，不因缺参考而失败

### Requirement: 画布节点连线数据模型
影视工程画布 SHALL 以"连线即数据流"的语义组织节点：每条边 SHALL 表达上游产物向下游输入的注入关系——文本/剧本连到分镜提供剧情、参考图连到分镜/生成节点提供视觉参考、分镜连到产物节点表示生成目标；建立边时 SHALL 按节点类型校验合法性，非法连线（如产物节点回连剧本节点）SHALL 被拒绝并提示原因；下游生成发起时 SHALL 自动收集所有直连上游的产物作为输入，无需用户手动上传或复制；画布图状态（节点位置、连线拓扑、每节点数据）SHALL 可持久化与恢复，应用重启后同一工程的画布可复原，产物节点结果状态 SHALL 以磁盘实际产物为准回显而非缓存内存态。

#### Scenario: 合法连线自动注入上游
- **WHEN** 用户把一个参考图节点和一个剧本分镜节点都连到某生成节点
- **THEN** 发起生成时该节点自动收集上游的提示词与参考图作为输入，无需手动上传

#### Scenario: 非法连线拒绝
- **WHEN** 用户尝试建立类型不合法的连线（如产物节点指向剧本输入节点）
- **THEN** 连线被拒绝并提示不合法原因，图状态不改变

#### Scenario: 画布状态复原
- **WHEN** 用户编辑画布后关闭应用再重开同一工程
- **THEN** 节点位置、连线拓扑与每节点数据复原，产物节点完成态按磁盘实际文件回显

### Requirement: 分镜视频生成阶段
film_generate_videos 阶段 SHALL 将选中分镜的提示词**原文**（含 `<<<uuid>>>` 令牌与全部块标签，逐字符相等）提交视频 provider：provider 统一解析自模型设置的默认视频能力（getDefault('video')），kit 分镜的 model 字段仅作展示、不参与路由；未配置默认视频 provider 时 SHALL 以 VIDEO_MODEL_NOT_CONFIGURED 失败并在错误上下文携带跳转模型设置的引导信息，不得静默回退其他 provider。该阶段 MUST NOT 调用 prompt-engine 视频优化链路的任何环节。提交参数 SHALL 携带用户发起时选择的画幅（16:9 默认 / 9:16 / 保持源规格）与全局时长（5/8/10 秒，默认 5 秒）；单批选中分镜数 SHALL 不超过 10。每镜 SHALL 按提交→轮询（上限 10 分钟）→下载到本次 run 受控目录（命名 shot_NNN.mp4，NNN 为选中序号）执行。部分镜失败时阶段 SHALL 以部分成功（partialFailure）继续，结果清单 SHALL 逐镜标注成功/失败与失败原因；全部镜失败时阶段 SHALL 失败。

#### Scenario: 提示词原文直送
- **WHEN** film_generate_videos 对某分镜发起 generateVideo 调用
- **THEN** 提交的 prompt 与该分镜导出文本逐字符一致（含 refTokens 令牌），且调用链未经过 prompt-engine 优化（对优化器的调用即为本合同违例）

#### Scenario: provider 未配置 fail-closed
- **WHEN** 用户未在模型设置配置默认视频 provider 并推进至生成阶段
- **THEN** 阶段以 VIDEO_MODEL_NOT_CONFIGURED 失败，错误含跳转模型设置页的引导，无任何 provider 调用发生

#### Scenario: 超出批次上限拒绝
- **WHEN** 发起时选中分镜超过 10 个
- **THEN** 请求在进入生成阶段前被拒绝，错误说明单批上限为 10 镜，流水线不启动计费调用

#### Scenario: 部分失败逐镜标注
- **WHEN** 一批 5 镜中 1 镜轮询超时或提交报错
- **THEN** 其余 4 镜产物正常落盘，阶段结果为部分成功，失败镜在结果清单中标注失败原因且可单独重试

### Requirement: 成本确认 checkpoint
film_generate_videos 的 checkpoint SHALL 在等待态暴露成本预估载荷（逐镜 shotId、标题、所选画幅与时长、预计镜数），供前端渲染确认卡；用户 advance 前 MUST NOT 发生任何视频 provider 调用；流水线从任何路径恢复（含应用重启后 resumeFromCheckpoint）SHALL 重新经过该确认点，不存在绕过路径。

#### Scenario: 确认卡内容
- **WHEN** 流水线停在 film_generate_videos 入口等待确认
- **THEN** 前端可获取逐镜清单与画幅/时长参数用于成本预估展示，用户须显式确认后才开始生成

#### Scenario: 恢复不绕过成本闸
- **WHEN** 应用在等待确认状态下退出并重启，用户恢复该 run
- **THEN** 流水线仍停留在成本确认 checkpoint，未再次确认不发生 provider 调用

### Requirement: 失败分镜单镜重试
系统 SHALL 提供页面级单镜重试能力（独立 IPC 通道，经 sender 校验与入参校验）：对结果清单中失败的指定镜，以与生成阶段相同的原文直送合同重新提交单镜（提交→轮询→下载），成功后覆盖该镜的 shot_NNN.mp4 产物；单镜重试 MUST NOT 改变流水线阶段状态机；film_render 阶段 SHALL 以磁盘实际产物清单为准判定可用性，不信任生成阶段的内存态结果。

#### Scenario: 重试成功补齐产物
- **WHEN** 用户对失败的第 3 镜点击重试且本次生成成功
- **THEN** shot_003.mp4 落盘且结果视图更新为成功，流水线阶段状态不因该次重试发生迁移

#### Scenario: 重试入参非法拒绝
- **WHEN** 重试请求携带空 shotId 或不属于该 run 的镜序号
- **THEN** IPC 返回带字段名与原因的校验错误，不发生 provider 调用

### Requirement: 成片合成与产物合同
film_render 阶段 SHALL 将镜头清单中按顺序可用的镜头视频合成为 final.mp4。镜头清单来源分两种：（a）默认——本 run 的 selectedShots 与本 run 目录 shot_NNN.mp4 磁盘扫描对齐（既有行为，单批 ≤ MAX_VIDEO_BATCH）；（b）全量模式——context.renderManifest 数组，每项含 `{shotId, path, sourceKind: generated|downloaded, orderIndex}`，path 必须位于 film-engineering 受控媒体根内（规范化后越界 SHALL 拒绝），清单条目间可来自不同 run 目录。合成规则不变：全部片段编解码规格一致时 SHALL 零重编码直拷拼接；不一致时 SHALL 仅做最小 scale+pad 归一到目标画幅（不添加转场、调色、字幕或音轨处理）；存在缺失或不可读条目时 SHALL 失败并按 orderIndex 列出缺失清单，不得输出缺镜假成片。完成后前端 SHALL 提供打开所在文件夹与另存入口，报告 SHALL 含成片时长（ffprobe 实测）与清单规模。

#### Scenario: 单批模式向后兼容
- **WHEN** 选中的 5 镜产物齐备且规格一致，推进 film_render（无 renderManifest）
- **THEN** 按选中顺序直拷拼接生成 final.mp4，行为与既有合同完全一致

#### Scenario: 顺序拼接成功
- **WHEN** 单批选中的 5 镜产物齐备且规格一致，推进 film_render
- **THEN** 按选中顺序直拷拼接生成 final.mp4，可播放且镜头顺序与选择顺序一致

#### Scenario: 规格不一致自动归一
- **WHEN** 片段间分辨率/帧率不一致
- **THEN** 合成前仅做 scale+pad 归一到目标画幅后拼接成功，成片不出现花屏或时间轴错乱

#### Scenario: 跨 run manifest 聚合成功
- **WHEN** renderManifest 含 15 个批次 run 目录与下载目录混合来源的 144 条有效条目，orderIndex 连续
- **THEN** 按 orderIndex 顺序拼接产出全片 final.mp4，报告时长等于各片段实测之和（±拼接误差）

#### Scenario: manifest 越界路径拒绝
- **WHEN** renderManifest 某条目 path 指向受控媒体根之外（含 `..` 遍历或 junction 逃逸）
- **THEN** film_render fail-closed 拒绝并指出非法条目，不读取该路径、不产出成片

#### Scenario: 缺镜拒绝出片
- **WHEN** manifest 或磁盘扫描存在缺失/不可读条目（重试后仍缺）
- **THEN** film_render 失败并列出缺失条目序号，不生成不完整的 final.mp4

### Requirement: 全量分批出片驱动
film-engineering SHALL 提供"全量出片"模式：输入超过 MAX_VIDEO_BATCH（10 镜）的分镜集合时，驱动 SHALL 按选择顺序自动切分为每批 ≤10 镜的批次子 run，逐批执行六阶段流水线至 generate_videos 阶段。每批 SHALL 独立经过成本确认 checkpoint（该批 costCheck 展示并确认前零 provider 调用）；批次产物落盘于各自 run 目录且 SHALL 幂等可续跑——已完成批次重入时 SHALL 跳过不重复计费；单批失败（partialFailure）SHALL 仅影响该批，失败镜可按既有单镜重试通道补齐，全部批次收口后自动生成 renderManifest 供 film_render 全片合成。驱动 SHALL 汇报批次级进度（第 k/M 批、每批逐镜状态）并持久化批次台账以支持应用重启后从断点继续。

#### Scenario: 144 镜全量切分与逐批过闸
- **WHEN** 用户对 144 镜发起全量出片
- **THEN** 驱动切分为 15 批（14×10+1×4），每批生成前展示该批 costCheck 并等待确认，确认前该批零调用

#### Scenario: 断点续跑不重复计费
- **WHEN** 应用在第 8 批进行中重启后重入同一全量出片任务
- **THEN** 已完成批次（1-7）被跳过且不发起 provider 调用，从第 8 批未完成镜继续

#### Scenario: 单批失败隔离
- **WHEN** 第 3 批中 2 镜生成失败且重试预算耗尽
- **THEN** 其余批次照常推进，台账标记该 2 镜待处理，全量 render 前缺镜校验 fail-closed 并列出精确清单

### Requirement: 原片 resultUrl 下载通道
film-engineering SHALL 提供 kit 镜产物下载通道：对携带 https resultUrl 的分镜，用户可将原作者已生成的视频拉取到本地受控媒体目录（film-engineering 根下），落盘文件 SHALL 经 ffprobe 验证可读并登记为 renderManifest 的 sourceKind=downloaded 条目。下载 SHALL 仅允许 https、限制单文件大小与总并发、校验响应为视频内容类型；URL 失效（404/过期）或内容校验失败 SHALL 将该镜标记"下载不可用"并降级为生成路径，不得产出损坏片段。下载动作 SHALL 显式用户触发，不在浏览/查询时自动预取。

#### Scenario: 有效 resultUrl 下载并进入成片
- **WHEN** 用户勾选 50 镜执行"回收原片"，其中 48 镜 URL 有效
- **THEN** 48 镜下载落盘且 ffprobe 验证通过，进入 renderManifest；2 镜标记下载不可用并可逐镜转入生成路径

#### Scenario: 过期 URL 不产生坏片段
- **WHEN** 某镜 resultUrl 已过期返回 404 或非视频内容
- **THEN** 该镜下载失败被标记，媒体目录不留半成品文件，全量 render 缺镜清单包含该镜

#### Scenario: 非法 URL 拒绝
- **WHEN** 下载请求目标为 http（非 https）或指向受控目录之外
- **THEN** 请求被拒绝并记录原因，不发起网络调用

