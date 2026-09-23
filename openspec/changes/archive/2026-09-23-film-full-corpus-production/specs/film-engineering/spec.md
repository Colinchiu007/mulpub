## MODIFIED Requirements

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

## ADDED Requirements

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
