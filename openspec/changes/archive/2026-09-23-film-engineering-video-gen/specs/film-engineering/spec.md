## MODIFIED Requirements

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

### Requirement: 前端交互契约
前端 SHALL 提供 /film-engineering 路由与三栏视图：场景树（加载骨架/空态+重试/搜索过滤）、分镜详情（提示词全文可折叠、参考图缩略、模型与来源标签、ref 引用解析、复制按钮组）、操作面板（分镜勾选汇总、复制全部、生成图片、导出 JSON/Markdown、剧本套用表单与结果列表）；操作面板 SHALL 新增「生成视频」发起入口（含画幅与全局时长选择），页面 SHALL 渲染成本确认 checkpoint 卡、逐镜生成结果列表（成功/失败/重试按钮）与成片完成态（打开所在文件夹/另存）；所有用户可见文案 SHALL 进 locales（zh/en 成对），产品名词（Hell Grind、影视工程、分镜、剧本套用）SHALL 进 i18n-glossary；provider 未配置时勾选生成 SHALL 引导用户到模型设置页并提示原因。

#### Scenario: 三栏浏览与复制
- **WHEN** 用户进入影视工程页面
- **THEN** 左侧显示场景树（含素材计数），点击场景中间显示分镜列表，点击分镜右侧显示详情与复制按钮组；复制成功显示「已复制」提示

#### Scenario: 勾选生成与 provider 引导
- **WHEN** 用户勾选若干分镜后点击「生成图片」且当前 provider 未配置
- **THEN** 提示「请先在模型设置中配置图片生成 Provider」，并提供跳转设置页入口，不发起无效生成

#### Scenario: 空态与重试
- **WHEN** kit 加载失败（FILM_KIT_UNAVAILABLE）或分镜查询失败
- **THEN** 页面显示空态说明与重试按钮，重试成功后恢复完整视图

#### Scenario: 生成视频引导与确认
- **WHEN** 用户勾选 10 个以内分镜点击「生成视频」但默认视频 provider 未配置
- **THEN** 页面提示配置视频 Provider 并给跳转入口，不启动流水线；已配置时进入发起面板选择画幅与时长，流水线启动后页面渲染成本确认卡，确认后逐镜进度与结果实时回显

## ADDED Requirements

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
film_render 阶段 SHALL 将本 run 目录中按选中顺序可用的镜头视频合成为 final.mp4：全部片段编解码规格一致时 SHALL 零重编码直拷拼接；不一致时 SHALL 仅做最小 scale+pad 归一到目标画幅（不添加转场、调色、字幕或音轨处理）；存在缺失镜头（重试后仍失败）时 SHALL 失败并列出缺失镜清单，不得输出缺镜假成片。全部产物（逐镜 mp4 与 final.mp4）SHALL 落在 film-engineering/<runId>/ 受控媒体根内，遵循既有媒体路径白名单合同；完成后前端 SHALL 提供打开所在文件夹与另存入口。

#### Scenario: 顺序拼接成功
- **WHEN** 选中的 5 镜产物齐备且规格一致，推进 film_render
- **THEN** 按选中顺序直拷拼接生成 final.mp4，可播放且镜头顺序与选择顺序一致

#### Scenario: 规格不一致自动归一
- **WHEN** 片段间分辨率/帧率不一致
- **THEN** 合成前仅做 scale+pad 归一到目标画幅后拼接成功，成片不出现花屏或时间轴错乱

#### Scenario: 缺镜拒绝出片
- **WHEN** 某镜在重试后仍无产物
- **THEN** film_render 失败并列出缺失镜序号，不生成不完整的 final.mp4
