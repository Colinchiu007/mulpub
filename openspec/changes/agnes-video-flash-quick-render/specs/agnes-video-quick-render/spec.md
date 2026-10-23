## ADDED Requirements

### Requirement: 快速渲染的 AI 视频模式集合

快速渲染页 SHALL 提供四种模式 tab：文生视频（`mode=text`）、首尾帧（`mode=keyframe`）、参考素材（`mode=reference`）、图片轮播（本地 Remotion，不调用 AI 视频模型）。前三种 tab SHALL 共享同一套「提示词 + 参数区 + 素材区 + 进度 + 结果」结构；图片轮播 SHALL 保持既有本地渲染语义不变。

各 AI 模式的媒体要求 SHALL 互斥且由服务端规则决定：
- 文生视频：SHALL NOT 携带任何媒体（`firstFrame` / `lastFrame` / `images` / `audios` / `videos` 全部为空）
- 首尾帧：`firstFrame` 与 `lastFrame` SHALL 至少提供一个
- 参考素材：`images` / `audios` / `videos` SHALL 至少一类非空

#### Scenario: 模式 tab 组成

- **WHEN** 打开视频创作页的「快速渲染」tab
- **THEN** 渲染 4 个模式 tab：文生视频 / 首尾帧 / 参考素材 / 图片轮播，默认选中「文案生成」等价的那一个

#### Scenario: 素材要求随模式切换

- **WHEN** 切到「首尾帧」模式
- **THEN** 素材区只渲染首帧与尾帧两个上传位；切到「参考素材」模式
- **THEN** 素材区只渲染参考图与参考音频两个上传位；切到「文生视频」模式
- **THEN** 素材区不渲染任何上传位

#### Scenario: 素材不足时不可提交

- **WHEN** 当前为「首尾帧」模式且首帧与尾帧均未提供
- **THEN** 「开始渲染」按钮为禁用态

#### Scenario: 模式与媒体不匹配时拒绝提交

- **WHEN** 当前为「文生视频」模式但状态里残留了参考图
- **THEN** 客户端在提交前拦截并提示「当前模式不接受素材」，SHALL NOT 发起网络请求

### Requirement: 参数区（时长 / 画幅 / 种子 / 分辨率）

AI 视频模式的参数区 SHALL 暴露：时长（4–12 秒，步长 1，默认 5）、画幅（由「输出平台」映射）、随机种子（可选整数，0 为合法值）、分辨率档位。

分辨率档位 SHALL 由**当前视频模型的能力描述**决定：模型只支持单一档位时，该控件 SHALL 呈禁用态并显示该档位值，不得提供其它取值。

画幅 SHALL 由「输出平台」下拉的既有选项映射得到，映射表 SHALL 以适配器能力描述中的合法画幅集合为准；无法映射时 SHALL 回落 `16:9`。

#### Scenario: 时长边界

- **WHEN** 打开时长选择
- **THEN** 可选值为 4 至 12 的整数，默认 5；选 3 或 13 SHALL NOT 出现在选项中

#### Scenario: 分辨率随模型能力禁用

- **WHEN** 当前视频模型为 `agnes-video-2.5-flash`
- **THEN** 分辨率控件为禁用态且显示 `720P`，SHALL NOT 提供 `1080P` / `1K` / `2K` 选项

#### Scenario: 输出平台映射到画幅

- **WHEN** 「输出平台」选择「YouTube 横屏 (1920x1080)」
- **THEN** 提交请求的 `aspect_ratio` 为 `16:9`；选择「抖音/TikTok (1080x1920)」时为 `9:16`；选择「小红书 (1080x1440)」时为 `3:4`

#### Scenario: 种子为零是合法值

- **WHEN** 随机种子填 `0`
- **THEN** 提交请求 SHALL 携带 `seed=0`，SHALL NOT 因「假值」而丢弃该字段

### Requirement: 参考素材上限与客户端预校验

参考素材模式下，参考图 SHALL 至多 5 张、参考音频 SHALL 至多 3 段。超出上限时 SHALL 在**客户端**拦截并给出可读提示，SHALL NOT 发起网络请求。

单文件体积 SHALL 受客户端护栏约束：参考图单张不超过 5MB、参考音频单段不超过 10MB（Base64 编码后约膨胀 33%，为单请求 50MB 上限留出余量）。超限 SHALL 在客户端拦截并提示。

#### Scenario: 参考图超上限

- **WHEN** 已选 5 张参考图后再添加第 6 张
- **THEN** 提示「参考图最多 5 张」且第 6 张不被加入，SHALL NOT 发起网络请求

#### Scenario: 参考音频超上限

- **WHEN** 已选 3 段参考音频后再添加第 4 段
- **THEN** 提示「参考音频最多 3 段」且第 4 段不被加入

#### Scenario: 单文件超体积

- **WHEN** 选择的参考图超过 5MB
- **THEN** 提示单文件体积上限且该文件不被加入

### Requirement: 不支持参考视频的模型 SHALL 明确告知

当当前视频模型的能力描述标注 `supportsReferenceVideo === false` 时，参考素材模式 SHALL NOT 渲染参考视频上传位；若状态中残留参考视频素材，客户端 SHALL 拦截并提示「当前模型不支持参考视频」，SHALL NOT 发起会被服务端以 `videos is not supported` 拒绝的请求。

#### Scenario: Flash 模型不渲染参考视频位

- **WHEN** 当前视频模型为 `agnes-video-2.5-flash` 且处于参考素材模式
- **THEN** 素材区只渲染参考图与参考音频，不渲染参考视频上传位

#### Scenario: 残留参考视频被拦截

- **WHEN** 模型不支持参考视频但状态中残留了参考视频素材
- **THEN** 提交被客户端拦截并提示「当前模型不支持参考视频」，SHALL NOT 发起网络请求

### Requirement: 生成进度 SHALL 反映真实阶段

AI 视频生成期间，页面 SHALL 展示由主进程经 `render:progress` 通道推送的进度，SHALL NOT 以固定步长伪造连续增长。阶段 SHALL 至少区分：提交、排队、生成、下载、完成。

进度来源 SHALL 是服务端返回的 `status` / `progress`；服务端内部字段 `internal_status` / `internal_progress` SHALL NOT 用于判定完成。

#### Scenario: 提交与生成阶段

- **WHEN** 任务已提交且服务端返回 `status=queued`
- **THEN** 页面显示「排队中」阶段与对应百分比；服务端返回 `in_progress` 时显示「生成中」

#### Scenario: 不伪造连续增长

- **WHEN** 服务端连续多次返回同一百分比
- **THEN** 页面显示的百分比保持不变，SHALL NOT 自动递增

#### Scenario: 切到其它 tab 后进度不依赖前端轮询

- **WHEN** 用户在生成过程中切到「历史记录」tab
- **THEN** 进度更新 SHALL 仍由主进程推送驱动，SHALL NOT 因前端轮询停止而中断

#### Scenario: 完成

- **WHEN** 成片下载落盘且可解码性校验通过
- **THEN** 进度为 100%、阶段为完成，并展示「查看视频」入口

### Requirement: 输出平台 SHALL 真正生效

「输出平台」下拉的既有 6 个选项 SHALL 映射到画幅并随请求下发。SHALL NOT 出现「选了下拉但成片画幅不变」的行为。图片轮播模式 SHALL 保持既有语义（按平台 profile 走本地 Remotion）。

#### Scenario: 平台影响 AI 视频成片画幅

- **WHEN** 「输出平台」选择竖屏平台且模式为文生视频
- **THEN** 提交请求携带对应的竖屏画幅，成片画幅与所选平台一致

### Requirement: 取消 SHALL 只停止本地等待并如实告知

「取消」SHALL 停止本地等待与页面状态更新；由于上游未公开任务取消端点，页面 SHALL 明示「远端任务可能仍在生成」，SHALL NOT 声称任务已终止。

#### Scenario: 取消后的提示

- **WHEN** 用户在生成过程中点击「取消」
- **THEN** 页面退出渲染态并提示「已停止等待，远端任务可能仍在生成」

### Requirement: 失败 SHALL 给出可归因的原因

服务端返回失败时，页面 SHALL 展示可读原因。Agnes 的参数类拒绝 SHALL 被翻译为可操作提示（而非原始英文 detail 串）。

#### Scenario: 客户端预校验拦截优先于服务端错误

- **WHEN** 用户提交了超出参考图上限的请求
- **THEN** 错误来自客户端预校验，提示指向上限数值，SHALL NOT 展示服务端原始 `detail`

#### Scenario: 服务端失败文案

- **WHEN** 服务端任务进入 `failed` 且返回错误信息
- **THEN** 页面展示该失败原因，且不展示「已完成」态
