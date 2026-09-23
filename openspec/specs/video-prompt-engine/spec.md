# video-prompt-engine Specification

## Purpose
TBD - created by archiving change video-prompt-optimize-engine. Update Purpose after archive.
## Requirements
### Requirement: 视频提示词统一经 prompt-engine 优化
所有视频提示词优化路径（videogen 流水线 videogen_generate 前、Story2Video 混合模式 select_video_scenes→generateSceneVideo 前）SHALL 统一调用 prompt-engine 服务（POST /v1/optimize 或 /v1/optimize/batch，请求携带 domain=video），执行视频提示词改写与输出校验；不得绕过 prompt-engine 直接把未经优化的提示词提交视频 provider，也不得把图片优化提示词原样复用为视频提示词。本义务不适用 film-engineering 视频生成路径（film_generate_videos 阶段及失败分镜单镜重试）：该路径的 kit/剧本套用提示词 SHALL 原文直送视频 provider（`<<<uuid>>>` 令牌与块标签逐字符不变），在该路径调用 prompt-engine 优化链路本身构成合同违例。

#### Scenario: videogen generate 前优化
- **WHEN** videogen 流水线执行 videogen_generate 阶段且场景提示词数组非空
- **THEN** 每个场景提示词经 PromptBridge 以 domain=video 提交 prompt-engine 优化，校验通过后的 optimized_prompt 才传入 callAdapter('generateVideo')

#### Scenario: 混合模式视频场景优化
- **WHEN** Story2Video 混合模式选中 useVideo 场景且其提示词来自图片优化结果
- **THEN** 该提示词先经视频优化引擎（domain=video）改写，再提交 generateSceneVideo；不得直接复用图片 optimized_prompt

#### Scenario: 服务不可用明确失败
- **WHEN** prompt-engine（8013）未运行或 /v1/optimize 网络失败（或独立视频引擎 8020 已配置但不可用）
- **THEN** 视频优化阶段返回明确错误（如「prompt-engine 未运行，无法优化视频提示词」），不静默回退到默认 LLM，也不把原 prompt 当作优化结果继续

#### Scenario: film-engineering 直送豁免
- **WHEN** film-engineering 流水线执行 film_generate_videos 阶段或失败分镜单镜重试
- **THEN** 提示词不经任何 prompt-engine 调用直接提交 callAdapter('generateVideo')，提交文本与导出文本逐字符一致；prompt-engine 服务是否在运行对该阶段无影响

#### Scenario: film 路径调用优化器即违例
- **WHEN** film_generate_videos 的执行链路中出现对 prompt-engine（/v1/optimize 或 /v1/optimize/batch，domain=video）的调用
- **THEN** 该行为被合同判定为违例（回归测试以"优化器被调用即失败"的负向用例拦截）

### Requirement: 领域与视频平台契约
视频优化请求 SHALL 携带 `domain` 字段（缺省 image，显式 video 进入视频领域）；视频平台采用 VideoPlatformType 枚举（sora/kling/veo/runway/wan/seedance/minimax/hunyuan/cogvideo/ltx/higgsfield/grok/agnes/generic_video），风格沿用 StyleType 枚举与 auto_detect_style 语义；别名（sora-v2、kling-pro、veo3 等）发送前归一，非法值回退 generic_video。

#### Scenario: domain 缺省兼容
- **WHEN** 请求不传 domain（现有图片调用方）
- **THEN** 行为与图片契约完全一致，不进入视频领域，零回归

#### Scenario: 视频平台别名归一
- **WHEN** 输入使用非规范别名（如 sora-v2、kling-pro、veo-3、runway-gen4）
- **THEN** 归一为契约枚举（sora、kling、veo、runway）后提交；非法平台回退 generic_video

### Requirement: 结构化视频输出
视频优化结果 SHALL 返回结构化 `video` 对象（shot 景别、camera 机位/运动、motion_intensity 1-10、scene_transition 转场、continuity_token 一致性令牌、duration_hint 秒），并渲染单串 `optimized_prompt`（可直接喂视频 provider）；上层编排读结构化字段，provider 直用渲染单串。

#### Scenario: 结构化字段可选回退
- **WHEN** 某视频优化结果缺少可选 video 字段（如 scene_transition）
- **THEN** 结构化校验以 optimized_prompt 非空为准，缺失的可选字段以默认值填充，不拒绝整条结果

### Requirement: 输出校验 fail closed
视频优化结果 SHALL 经过输出校验：optimized_prompt 非空字符串且不超过 max_length；error 非空视为失败；批量结果数量与输入一致；任一项无效立即失败。视频字段越界（motion_intensity 非 1-10 等）收敛到边界或置默认。

#### Scenario: 空/超长/error 结果失败
- **WHEN** 某视频场景 optimized_prompt 为空、超长或响应 error 非空
- **THEN** 视频优化阶段失败并输出含场景序号的可解释错误，不进入视频生成

#### Scenario: 批量数量不匹配失败
- **WHEN** optimize/batch 返回结果数量与输入场景数不一致
- **THEN** 阶段失败并报告 expected/got 数量

### Requirement: 上下文与一致性
视频优化请求 SHALL 支持视频上下文（full_text 完整文案、scene_type 场景类型、narration 旁白、prev_scene/next_scene 前后场景、duration_hint、aspect_ratio、continuity_token 一致性令牌）；context 发送前 SHALL 复用敏感凭据键拦截（api_key/token/secret/password 等），命中即拒绝。

#### Scenario: 敏感键拦截
- **WHEN** context 对象含 api_key/token/secret 等敏感键（任意层级）
- **THEN** 请求被拒绝并给出可解释错误，不发送外部服务

#### Scenario: 一致性令牌透传
- **WHEN** 上层提供 continuity_token（如角色/场景/风格令牌）
- **THEN** 令牌随 context 透传，优化结果保留同一令牌供跨场景一致性消费

### Requirement: 配置契约边界
视频优化配置 SHALL 对齐 prompt-engine 参数边界并做输入校验：domain 枚举（image/video）、视频平台枚举、creativeLevel 1-10（默认 5）、maxLength 50-2000（默认 500）、numCandidates 1-5（默认 1）、negativePrompt ≤500、autoDetectStyle boolean（默认 true）；越界输入拒绝或按边界收敛。

#### Scenario: 配置范围校验
- **WHEN** 用户传入越界 creativeLevel/maxLength/numCandidates 或非法 video platform
- **THEN** 配置归一化拒绝越界值或收敛到边界并给出可解释错误

### Requirement: 场景-测试映射
本能力每个 WHEN/THEN 场景 SHALL 在实现中映射到对应测试（单元/集成），标注于 change tasks.md；不依赖真实 8013 服务，使用 mock PromptBridge 或本地 HTTP stub 覆盖契约。

#### Scenario: 契约测试不依赖真实服务
- **WHEN** 运行视频优化相关测试
- **THEN** 通过 mock/本地 stub 验证请求体（domain/platform/motion 相关字段）与响应校验（空/超长/error/数量不匹配/结构化字段），真实 8013 与 LLM key 只作为外部验收边界

### Requirement: 视频优化事实保真指令

prompt-engine 视频领域（domain=video）优化 SHALL 在指令中约束不得改变输入主体身份、时代背景与事件事实；当请求携带 context 时，优化结果必须与 context 提供的事实锚点一致。

#### Scenario: 中文历史事实不被改写

- **WHEN** 优化请求 domain=video 且 prompt 描述中文历史事件（如"关羽水淹七军"）

- **THEN** 输出保留主体/事件/时代，不翻译成改变事实的表述，不新增与原文矛盾的情节

#### Scenario: context 事实锚点

- **WHEN** 请求携带 context.synopsis/full_text

- **THEN** 策略指令引用事实锚点，输出画面要素与锚点一致（人物身份、时代道具、核心事件）

### Requirement: context 白名单契约

视频优化请求 SHALL 只接受 context 白名单键（synopsis/character/setting/character_list/full_text）；未知键在服务端忽略并记录，不改变优化行为；既有批量上限 20 与有界并发 8 不变。

#### Scenario: 未知键忽略

- **WHEN** 请求 context 含白名单外键

- **THEN** 服务端忽略该键并记录 warning，请求仍按正常流程优化

#### Scenario: 批量契约不变

- **WHEN** 批量请求 12 条且均带 context

- **THEN** 单批 200、结果顺序与请求一致、每条结果非空（与 max_length=20 契约一致）

### Requirement: 双向约束字段契约

视频优化响应 SHALL 支持结构化字段 `excluded_characters[]`、`no_swap_pairs[]` 与 `color_ratio`，并 SHALL 在 `normalizeVideoMeta` 中收敛。`excluded_characters` 输入 SHALL 兼容字符串（按 `[\n;,]+` 分割）与字符串数组两种形态，输出 SHALL 为去空白、按 trim 后精确匹配去重（大小写敏感，保留首次出现序）的字符串数组，上限 10，超限截断。`no_swap_pairs` 输入 SHALL 兼容 JSON 数组形态，每对 SHALL 为恰含两个非空字符串的二元组；任一元素非法（非字符串/空白/数量非 2）时 SHALL 丢弃整对，上限 5，超限截断。`color_ratio` SHALL 匹配格式 `^\d{1,3}(:\d{1,3}){2}$`（三段 1-999 正整数）；不匹配或缺失时 SHALL 丢弃且不得填充默认值。非法输入 SHALL 被丢弃而非抛出。

#### Scenario: 新字段收敛通过
- **WHEN** 响应包含 `video.excluded_characters = ["JAX", " jax ", ""]`、`video.no_swap_pairs = [["ROKO","JAX"]]`、`video.color_ratio = "60:30:10"`
- **THEN** 归一化结果为 `["JAX","jax"]`（大小写敏感去重，空串剔除）、`[["ROKO","JAX"]]` 与原始比率字符串，且长度不超过上限

#### Scenario: 字符串输入兼容
- **WHEN** `video.excluded_characters = "JAX, Rein; JAX"`（字符串形态）
- **THEN** 输出 `["JAX","Rein"]`，与数组输入行为一致

#### Scenario: 非法字段被丢弃
- **WHEN** `excluded_characters` 为对象、`no_swap_pairs` 含 `["ROKO", 123]` 或 `["ROKO"]`、`color_ratio` 为 "abc" 或 "60:30:10:5" 或 "0:30:10"
- **THEN** 对应字段不进入输出 meta，其余合法字段不受影响，不抛出异常

#### Scenario: 零回归（无新字段）
- **WHEN** 响应不含任何新字段
- **THEN** 输出 meta 与改动前完全一致，不新增任何键

### Requirement: 多切时间块契约

视频优化响应 SHALL 支持结构化字段 `shots[]`：每切包含 `shot` 与 `camera`（SHALL 沿用单切字段的字符串约束：非空、trim、≤50 字符）、`duration`（SHALL 为必填正数秒，上限 15，超限按 15 clamp 而非丢弃）、`beats[]`（时间块数组，每项含 `time`（形如 "0.0–1.0s" 或 "BEAT 1 (0-1s)" 的非空字符串，上限 40 字符）与 `action`（非空字符串，上限 500 字符））。`shots` 数组长度上限 3，超限截断。任一子字段非法时 SHALL 丢弃整切；全部切非法时 `shots` 不进入输出。`beats` 处理顺序 SHALL 为：先丢弃非法 beat（time/action 任一为空即非法），再取前 6 条。

#### Scenario: 多切时间块通过
- **WHEN** 响应包含 2 切 `shots`，每切含合法 shot/camera/duration 与 beats
- **THEN** 输出 meta 保留全部 2 切与 beats，且与输入一致

#### Scenario: 超限截断与非法丢弃
- **WHEN** `shots` 含 5 切、某切 beats 达 8 项且其中第 2 项 action 为空、某切 duration 为 20
- **THEN** 仅保留前 3 切；该切先丢弃空 action 的 beat 再取前 6 条（有效 beat 数 7→6）；duration 20 被 clamp 为 15，切保留

#### Scenario: 单切局部非法整体丢弃
- **WHEN** 某切 `shot` 为空、或 `duration` 缺失、或 `beats` 为对象
- **THEN** 该切整体不进入输出，其余合法切不受影响；全部非法时 `shots` 键不出现

### Requirement: 收尾参数行模板

系统 SHALL 提供纯函数 `appendVideoTrailer(prompt, options)`：在提示词末尾追加一行参数行（`Photoreal. NON-IP. {aspect}. {duration}s. {audio} only.` 语义），`aspect`/`duration`/`audio`/`nonIp` 均可配置；`duration` 默认 15、`audio` 默认 "SFX"、`nonIp` 默认 true、`aspect` 默认 "16:9"。当提示词已含 "NON-IP" 时 SHALL 不重复追加（幂等）。函数 SHALL 不修改原始 prompt，返回新字符串；追加后仍超调用方长度预算时 SHALL 按模板段从尾部截断，但 SHALL 保留 "NON-IP" 段。

#### Scenario: 默认参数行追加
- **WHEN** 调用 `appendVideoTrailer("A hero walks.", {})`
- **THEN** 返回以 "Photoreal. NON-IP. 16:9. 15s. SFX only." 结尾的提示词，原始字符串未被修改

#### Scenario: 幂等性
- **WHEN** 提示词已含 "NON-IP" 再调用 `appendVideoTrailer`
- **THEN** 返回与输入相同的字符串，不重复追加

#### Scenario: 超长截断保 NON-IP
- **WHEN** 预算 100 字符且提示词本身已占 95 字符
- **THEN** 返回以 "NON-IP" 结尾的截断参数行，无残缺模板段（如孤立的 "{duration}s." 不得出现）

### Requirement: 结构完整性 fail-closed 校验

`extractOptimizedVideoPrompt` SHALL 在 `video.excluded_characters` 或 `video.no_swap_pairs` 非空时，基于**截断前**的 `optimized_prompt` 文本校验其包含引用协议标记（`<<<` 或 `[ABSENT]`，大小写敏感）；缺失时返回 `{ ok: false, error }`，错误信息指明缺失的字段与原因。该校验 SHALL 仅在声明的字段存在时触发，不得改变无新字段请求的行为。

#### Scenario: 声明缺席排除但正文未落实
- **WHEN** `video.excluded_characters = ["JAX"]` 且截断前 `optimized_prompt` 不含 `<<<` 或 `[ABSENT]`
- **THEN** 返回 `{ ok: false, error }`，错误信息包含 "excluded_characters"

#### Scenario: 仅声明防替换对同样校验
- **WHEN** `video.no_swap_pairs = [["ROKO","JAX"]]` 且截断前 prompt 不含任何标记
- **THEN** 返回 `{ ok: false, error }`，错误信息包含 "no_swap_pairs"

#### Scenario: 声明与正文一致
- **WHEN** `video.excluded_characters = ["JAX"]` 且截断前 prompt 含 `[ABSENT] JAX` 标记
- **THEN** 返回 `{ ok: true }`，prompt 与 meta 正常透传

#### Scenario: 超长截断不误杀
- **WHEN** `video.excluded_characters = ["JAX"]`、标记 `[ABSENT] JAX` 位于 prompt 尾部、且调用方 maxLength 截断会削掉该标记
- **THEN** 校验基于截断前完整文本仍通过，返回 `{ ok: true }`（截断仅作用于最终 prompt 输出）

#### Scenario: 未声明新字段零回归
- **WHEN** 响应无 `excluded_characters`/`no_swap_pairs` 且 prompt 不含引用标记
- **THEN** 校验不触发，返回 `{ ok: true }`，行为与改动前一致

### Requirement: 平台参数画像默认值

系统 SHALL 提供平台参数画像映射，每个画像 SHALL 含四个键：`duration`（秒）、`aspect`（字符串）、`resolution`（字符串）、`audio`（布尔，表示生成音频开启）。seedance 默认 `{ duration: 15, aspect: "21:9", resolution: "1080p", audio: true }`；未登记平台 SHALL 使用 generic 画像 `{ duration: 15, aspect: "16:9", resolution: "1080p", audio: false }`。画像常量 SHALL 集中定义于契约层常量区；画像键与 `appendVideoTrailer` options 的类型映射（audio 布尔 → "SFX"/"No audio" 字符串）SHALL 由调用方在接线时转换，契约不隐式转换。

#### Scenario: seedance 画像
- **WHEN** 查询 seedance 平台画像
- **THEN** 返回 duration 15、aspect "21:9"、resolution "1080p"、audio true

#### Scenario: 未登记平台回退
- **WHEN** 查询未登记平台
- **THEN** 返回 generic 画像（duration 15、aspect "16:9"、resolution "1080p"、audio false），不抛出异常

### Requirement: 精修层 max_length 层级语义（按后端能力门控）

请求构造 SHALL 按 creative_level 分层处理 `max_length`，并 SHALL 按目标后端能力范围收敛（防止 422）：8013 兼容后端（`buildVideoOptimizeRequest`）能力范围为 [50, 2000]（对齐 `prompt_engine/models.py` ge=50/le=2000）；8020 独立引擎（`buildStandaloneVideoOptimizeRequest`）能力范围为 [200, 20000]（对齐 `video_prompt_engine/models.py` ge=200/le=20000，tasks 4.4 边界上浮已生效：精修层 500–5,000 词导演分镜单 ≈22,871 字符）。`creative_level ≥ 7` 且调用方未显式传 `max_length` 时 SHALL 使用精修层默认 5000（8020 [200,20000] 范围内无需额外收敛）；仅当显式值或层级默认超出目标后端能力范围时才 SHALL 收敛到边界（8013 精修层默认 5000 → 2000；8020 显式超上限 → 20000）；`creative_level < 7` 且未显式传时 SHALL 使用常规层默认：8013 保持 500（零回归）、8020 对齐引擎默认 1800（`video_prompt_engine/models.py` max_length 默认，保证 batch 层 100 词下界可达）。显式传入的值 SHALL 始终优先，且 SHALL 在目标后端能力范围内收敛；`null`/空串 SHALL 视为未显式传（与 PromptBridge 归一一致）。精修层目标上限（`videoMaxLengthRefinedDefault=5000` / `videoMaxLengthMax=20000`）已随引擎侧模型边界抬高生效（`video_prompt_engine/models.py` le=20000，2026-08-14 边界修订）；精修层长度判据为词数刻度 500–5,000 词（DEEP 报告 P0-1，max_length 为字符裁剪预算，不参与 refined 判据）。

#### Scenario: 精修层默认上浮（8013）
- **WHEN** `creative_level = 8` 且调用方未传 `max_length`，构造 8013 请求
- **THEN** 请求携带 `max_length = 2000`（精修层默认 5000 收敛到 8013 能力上限）

#### Scenario: 精修层默认上浮（8020）
- **WHEN** `creative_level = 8` 且调用方未传 `max_length`，构造 8020 请求
- **THEN** 请求携带 `max_length = 5000`（精修层默认，收敛到 8020 能力上限 20000 内）

#### Scenario: 常规层默认
- **WHEN** `creative_level = 5` 且调用方未传 `max_length`
- **THEN** 8013 请求携带 `max_length = 500`（零回归）；8020 请求携带 `max_length = 1800`（对齐 8020 引擎默认，batch 层 100 词下界可达）

#### Scenario: 显式值优先（8013 能力范围内）
- **WHEN** `creative_level = 9` 且调用方显式传 `max_length = 1500`
- **THEN** 请求携带 `max_length = 1500`，不被层级默认覆盖

#### Scenario: 显式值超上限收敛（8013）
- **WHEN** 调用方显式传 `max_length = 3000`，构造 8013 请求
- **THEN** 请求携带 `max_length = 2000`（收敛到 8013 能力上限）

#### Scenario: 8020 能力范围（含 min 边界修复）
- **WHEN** 调用方显式传 `max_length = 99999`、`max_length = 18000` 或 `max_length = 10`，构造 8020 请求
- **THEN** 分别携带 `max_length = 20000`、`max_length = 18000` 与 `max_length = 200`（收敛到 8020 [200, 20000]；18000 精修层真实长模板预算透传，不再被 clamp 到 5000；min 200 修复既有 min 50 低于引擎 ge=200 的 422 隐患）

