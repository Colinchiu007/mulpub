# film-engineering

影视工程流水线在批次一（提示词资产层，PR #4052）之上补齐**分镜提示词三分**、**生成就绪度**、**单镜锁定**、**项目文件乐观锁**、**出站下载安全**与**外部工具前置体检**；同时为视频创作的提示词优化阶段补上**角色身份锚点**与**参考图优先级声明**。

本文件只承载**可被测试校验的行为合同**。字段级规格（控件、取值范围、默认值、文案中英对照、错误码）以 `01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md` 为单一来源。

## ADDED Requirements

### Requirement: 分镜提示词三分与存量零迁移

Shot SHALL 支持三个可选提示词字段：`imagePrompt`（首帧/图片）、`videoPrompt`（视频运动提示）、`endFramePrompt`（尾帧约束）。既有 `prompt` 字段 SHALL 保留且语义不变。kit 加载期 SHALL 对每条分镜做一次性归一化：`imagePrompt ??= prompt`、`videoPrompt ??= prompt`、`endFramePrompt ??= ''`。归一化后下游消费方 SHALL **不再**保留 `?? prompt` 分支。

单字段长度 SHALL 受既有 `FILM_PROMPT_MAX_LEN = 50000` 约束（该常量不得放宽）；三分**合计**长度 SHALL 受 `FILM_PROMPT_BUNDLE_MAX_LEN = 50000` 约束。合计超限 SHALL 判定 kit 加载失败（`FILM_KIT_UNAVAILABLE`），SHALL NOT 静默截断。

存量 `shot-library.json` SHALL **零改动**：既有分镜在归一化后三分字段非空，且 `prompt` 原值逐字不变。

#### Scenario: 存量分镜加载后三分齐备

- **WHEN** 加载含 153 条既有分镜的 kit
- **THEN** 每条分镜的 `imagePrompt` 与 `videoPrompt` 非空且等于原 `prompt`，`endFramePrompt` 为空串，`prompt` 原值未被改写

#### Scenario: 三分合计超限判 kit 不可用

- **WHEN** kit 内某分镜的 `imagePrompt + videoPrompt + endFramePrompt` 合计超过 `FILM_PROMPT_BUNDLE_MAX_LEN`
- **THEN** `loadFilmKit` 返回 `ok: false`，错误含 `FILM_KIT_UNAVAILABLE`，且**不产出**截断后的分镜

#### Scenario: 图片与视频各走各的提示词

- **WHEN** 提交某镜的图片生成与视频生成
- **THEN** 图片请求使用 `imagePrompt`，视频请求使用 `videoPrompt`；当 `videoPrompt` 为空时回落 `imagePrompt`

#### Scenario: 尾帧提示词只产出不消费

- **WHEN** 分镜已派生 `endFramePrompt`
- **THEN** 该字段在规划确认卡与分镜节点可见，但 SHALL NOT 被送入任何 provider 请求（参考图注入的 provider 支持面尚未覆盖）

### Requirement: 生成就绪度内联于既有成本闸

`costCheck` SHALL 在既有 `references` 汇总同级新增 `readiness` 子结构，含 `readyCount`、`notReadyCount` 与逐镜 `shots[]`（每项含 `index`、`shotId`、`ready`、`reason`、`reasonCode`）。就绪度 SHALL **内联**进既有成本闸 SHALL NOT 新增第二道 checkpoint 或新闸门。未确认成本闸时 SHALL 保持**零 provider 调用**。

就绪判据 SHALL 只覆盖"必然失败"项，SHALL NOT 包含主观质量判断：`SHOT_PROMPT_EMPTY`、`SHOT_REFERENCE_UNRESOLVED`、`SHOT_DURATION_OUT_OF_RANGE`、`SHOT_ASPECT_UNSUPPORTED`、`SHOT_SECONDS_UNSUPPORTED`、`SHOT_LOCKED`。每条未就绪的镜 SHALL 给出可操作的 `reason` 文案。

#### Scenario: 未确认时仍零 provider 调用且带就绪度

- **WHEN** 用户未勾选成本确认即触发视频生成阶段
- **THEN** 返回 `awaitingConfirmation: true` 与含 `readiness` 的 `costCheck`，provider 调用次数为 0

#### Scenario: 空提示词的镜在确认前即被标出

- **WHEN** 选中镜头中存在归一化后 `imagePrompt` 为空白的镜
- **THEN** `costCheck.readiness.shots` 中该镜 `ready` 为 `false`、`reasonCode` 为 `SHOT_PROMPT_EMPTY`，且 `reason` 为可操作文案

#### Scenario: 成本闸既有锁不被削弱

- **WHEN** 运行既有成本闸恢复路径契约测试
- **THEN** `film-video-checkpoint-integration.test.js` 的既有断言**未被修改**且仍全部通过

### Requirement: 出站下载合同统一

影视工程的**原片下载**与**成片下载** SHALL 共用同一份出站合同（`egress-guard`）。合同 SHALL 包含：仅允许 `https`；内网地址（loopback / 私网段 / 链路本地）一律拒绝；**每次请求发起前**解析主机名并校验解析结果为非内网地址；3xx **手动逐跳**跟随且每跳重新过合同校验、跳数有上限；单文件字节数有上限；下载先写 `.part` 临时文件，经探测校验通过后才改名为正式文件，失败路径 SHALL 清理 `.part` 且 SHALL NOT 留下半成品。

成片下载路径的 URL 来自 provider 轮询响应，域名不固定 ⇒ SHALL NOT 对该路径施加固定域名白名单；信任边界由"provider 响应经已认证的轮询通道取得"承担。

#### Scenario: 成片下载拒绝内网地址

- **WHEN** provider 返回的成片 URL 解析到 `169.254.169.254` 或 `10.0.0.1` / `172.16.0.1` / `192.168.1.1`
- **THEN** 下载被拒绝，错误文案指明内网地址，且目标文件不存在

#### Scenario: 成片下载拒绝明文 http

- **WHEN** provider 返回的成片 URL 使用 `http://` 协议
- **THEN** 下载被拒绝

#### Scenario: 重定向逐跳重校验

- **WHEN** 首个 `https` 响应 `Location` 指向内网地址
- **THEN** 下载在**第二跳发起前**即被拒绝，SHALL NOT 跟随到该地址

#### Scenario: 下载中断不留半成品

- **WHEN** 下载过程中连接中断
- **THEN** 目标路径不存在，`.part` 文件已被清理

#### Scenario: 原片下载行为逐字不变

- **WHEN** 以既有 `shot-downloader` 用例集运行
- **THEN** 全部既有断言通过（重构仅改实现位置，不改可观察行为）

### Requirement: 外部工具前置体检

视频生成阶段 SHALL 在**出片前**对 ffmpeg / ffprobe 做存在性体检。缺失时 SHALL 返回可操作错误（指明缺失的工具与处置方式），SHALL NOT 推迟到合成阶段才暴露。体检 SHALL **只以存在性为放行条件**：版本号 SHALL 被解析并用于展示，SHALL NOT 作为阻断条件。

#### Scenario: 缺失 ffmpeg 在出片前暴露

- **WHEN** 运行环境无 ffmpeg 时触发视频生成
- **THEN** 阶段返回带明确工具名与处置指引的错误，SHALL NOT 进入 provider 调用或合成阶段

#### Scenario: 版本过旧只提示不阻断

- **WHEN** ffmpeg 存在但版本低于参考值
- **THEN** 出片 SHALL NOT 被阻断，版本信息以提示形式给出

### Requirement: 单镜锁定保护人工确认结果

Shot SHALL 支持 `locked` 布尔字段。自动模式**批量重跑** SHALL 跳过 `locked` 的镜（不重生成、不覆盖其 `outputPath`）。用户**显式发起单镜重生成** SHALL 仍然对 `locked` 镜生效。`locked` SHALL 可经项目文件写入通道置位与解除。

#### Scenario: 重跑不覆盖锁镜

- **WHEN** 某镜 `locked` 为真且触发批量重跑
- **THEN** 该镜的提示词与 `outputPath` 保持原值，其他未锁镜正常重跑

#### Scenario: 单镜重生成仍可作用于锁镜

- **WHEN** 用户对 `locked` 的镜显式点击重生成
- **THEN** 该镜被重新生成并更新产物路径

### Requirement: 项目文件乐观锁

项目文件 SHALL 记录整数 `revision`，写入时递增。写入通道 SHALL 支持可选的 `expectedRevision`；携带时 SHALL 与当前 `revision` 比对，不一致 SHALL **fail-closed** 返回冲突错误且 SHALL NOT 覆盖既有文件。`expectedRevision` 缺省时 SHALL **不执行**比对（向后兼容，既有单写路径行为不变）。

既有 `needsReconfirm` 重确认机制 SHALL 保留并与乐观锁并存：前者回答"用户确认是否仍作数"，后者回答"是否有并发写覆盖"。

#### Scenario: 陈旧 revision 写入被拒

- **WHEN** 调用方携带 `expectedRevision` 且其值小于当前 `revision`
- **THEN** 写入被拒绝并返回冲突错误码，既有项目文件内容逐字不变

#### Scenario: 缺省 expectedRevision 不阻断

- **WHEN** 调用方未携带 `expectedRevision`
- **THEN** 写入正常完成，`revision` 递增 1

### Requirement: 逐镜时长落进项目文件

项目文件的每条镜 SHALL 记录 `durationMs`、`durationSource` 与 `durationRawSec`，取值 SHALL 与规划阶段派生值一致。`durationSource` SHALL 取自 `user` / `tts` / `formula` / `tier` 四级来源链。续跑与单镜重生成 SHALL 读取项目文件中的时长，SHALL NOT 回落到全局单镜秒数。

#### Scenario: 时长随镜持久化

- **WHEN** 计划含 3 镜且其中 1 镜走 `formula` 推算
- **THEN** 项目文件 `shots[].durationMs` 非空、`shots[].durationSource` 与规划阶段一致、`durationRawSec` 如实回传

### Requirement: 角色身份锚点与参考图优先级

提示词优化阶段 SHALL 向提示词引擎上下文注入**角色身份锚点**（骨相 / 五官 / 发色瞳色 / 唇色四类，硬上限 4 条）与**参考图优先级声明**（最早参考图为身份锚，其后参考图仅用于场景 / 光线 / 构图 / 情绪）。多人同框场景 SHALL 注入防串脸约束（禁止交换角色身份、肢体身份、说话归属与动作归属）。锚点被截断时 SHALL 以显式标记与被截角色名回传，SHALL NOT 静默丢弃。

三类提示词文本 SHALL 外置为数据资产，SHALL NOT 内联进 JavaScript 源码。

#### Scenario: 锚点硬上限 4 条

- **WHEN** 文本中可识别 6 个候选角色
- **THEN** 锚点输出为 4 条，且回传 `anchorTruncated` 为真与被截角色名

#### Scenario: 参考图优先级声明进入优化上下文

- **WHEN** 某场景绑定 2 张参考图
- **THEN** 送进提示词引擎的上下文包含优先级声明，且第 1 张被标记为身份锚、第 2 张被标记为仅环境参考

#### Scenario: 提示词未内联进代码

- **WHEN** 检索本仓 JavaScript 源码
- **THEN** 身份锚点 / 参考图优先级 / 防串脸三类提示词文本 SHALL NOT 出现在 `.js` 文件中，只存在于外置资产
