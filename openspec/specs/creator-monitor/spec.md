# creator-monitor Specification

## Purpose

定义「博主监控与采集」能力：对博主账号做长期关注、定期监控、发现新作品并一键采集，采集物可送入 AI 写作。

本能力在本仓是**从零引入领域概念**——此前不存在博主实体、关注关系、按账号列举作品的能力，也不存在周期内容监控。首批平台为 YouTube。

本契约已随 CCG 决策层评审同步至第 8 轮（约 78 条意见）。评审未形式收敛，故此处收录的是**每一条 Critical 与 Warning 的最终处置结论**，作为实现期的强制约束。

## Requirements

### Requirement: 博主实体与 canonical ID

系统 SHALL 为被关注的博主建立独立实体，其平台侧标识 MUST 为平台 API 返回的 canonical ID（YouTube 为 `channels.list` 返回的 `channelId`，形如 `UC…`），SHALL NOT 直接使用用户输入的原始字符串。

系统 SHALL 支持四种 YouTube 频道输入形态并各自给出明确失败文案：频道 ID（`UC…`，0 units）、`@handle`、`/c/<name>`、`/user/<name>`（后两者走 `forUsername`）。系统 SHALL 对作品链接（`watch?v=`、`playlist?list=`）与非 YouTube 域名给出「这不是频道链接」而非泛化的格式错误。

系统 SHALL 在 `(platform, external_id)` 上建立唯一索引。同一博主的多种 URL 写法 MUST 归并为同一实体，不得产生多行。

#### Scenario: 四种输入形态解析

- **WHEN** 用户依次粘贴 `UC…`、`youtube.com/@name`、`youtube.com/c/name`、`youtube.com/user/name`
- **THEN** 四者均解析到同一 `channelId`，且 `creator_accounts` 中仅有一行

#### Scenario: canonical ID 解析失败不得降级

- **WHEN** `channels.list` 对某个 `/c/name` 旧式链接返回 404
- **THEN** 系统拒绝写入并提示频道不存在，MUST NOT 退化为把用户原始输入当作 `external_id` 落库

#### Scenario: 作品链接被明确拒绝

- **WHEN** 用户粘贴 `youtube.com/watch?v=xxx`
- **THEN** 系统提示「这是作品链接，请粘贴博主主页链接」，MUST NOT 尝试按频道解析

### Requirement: 正文来源可控性与端到端前置验证

正文 SHALL 来自字幕、AI 识别补全或视频描述，媒体下载 SHALL NOT 作为正文来源。系统 MUST 在写入运行时代码前，先用真实 API Key 跑通端到端冒烟（E2E-1~E2E-5）。

**正文链路 SHALL NOT 消耗 YouTube Data API 配额**：字幕来自 `youtube-transcript-api`（非 Data API），描述随 `playlistItems` 免费返回。系统 MUST 据此把「发现配额」与「正文获取」当作两件事分别降级——配额耗尽时已发现的条目 MUST 仍可正常采集。

#### Scenario: 依赖不可用时先证伪再开发

- **WHEN** 实现开始前
- **THEN** MUST 先用真实 API Key 验证频道解析、作品枚举、字幕正文（≥500 字且 `transcript_source='subtitle'`）、探测幂等、单条入库五项；任一失败则先修复该层，MUST NOT 在未验证依赖的前提下写其余代码

#### Scenario: 配额耗尽不影响已发现条目采集

- **WHEN** 探测池耗尽但采集池充足，且已有 `pending` 条目
- **THEN** 用户仍可正常采集这些条目，提示语 MUST NOT 把「配额问题」说成「内容不可用」

#### Scenario: 正文质量分级

- **WHEN** 视频无字幕但已配置 `llm_config`
- **THEN** 正文来自 AI 识别，质量标为 `derived`，MUST NOT 与原生字幕的 `full` 混为一谈；未配置时标 `stub` 并在送入 AI 写作前明示

### Requirement: 定期监控与增量发现

系统 SHALL 按每个关注项的可配间隔（默认 60 分钟，范围 5~1440 分钟）定期检查博主是否有新作品。

系统 SHALL 以 `(platform, external_id)` 唯一索引保证探测幂等：同一作品被重复探测 MUST NOT 产生重复记录。

探测阶段 SHALL 使用 `fetch_transcript=False`（只取列表元数据），正文与字幕仅在采集阶段获取。

#### Scenario: 重复探测幂等

- **WHEN** 同一博主被连续探测 10 次且期间无新作品
- **THEN** `creator_discoveries` 行数不变，`consecutive_failures` 保持 0

#### Scenario: 探测不消耗采集配额

- **WHEN** 系统执行一次探测
- **THEN** 仅消耗探测配额，MUST NOT 消耗采集配额，且 MUST NOT 拉取字幕正文

### Requirement: 采集数量双轨与硬上限

系统 SHALL 区分两条采集路径并各自提供默认值：「一键采集新作品」默认 **5** 条，「手动批量采集」默认 **50** 条，全局硬上限 **100** 条。

`count` 超过生效上限时系统 MUST 拒绝执行并给出上限提示，MUST NOT 执行任何采集副作用，MUST NOT 静默截断。

`count` 未超限但可采集条数多于 `count` 时，系统 MUST 执行 `count` 条并提示剩余条数留待下次，剩余项保持 `pending`。

单博主可设置低于全局的个人上限，MUST NOT 超过全局上限。

#### Scenario: 超限拒绝且零副作用

- **WHEN** 用户输入 `count=150`（上限 100）并提交
- **THEN** 系统拒绝并提示「本次最多采集 100 条」，`creator_discoveries` 与 `viral_library` 均无任何写入

#### Scenario: 有剩余时必须提示

- **WHEN** 发现 12 条 `pending` 且用户以默认 `count=5` 一键采集
- **THEN** 采集最新 5 条并提示「共发现 12 条，已采集最新 5 条，剩余 7 条留待下次」，剩余 7 条仍为 `pending`

### Requirement: 单条采集的体验与豁免边界

发现列表中每条作品 SHALL 提供独立的零填参「采集」按钮。已采集的作品 SHALL 显示「已采集 · 时间」且按钮置灰，该状态 MUST 持久化，刷新页面后 MUST NOT 丢失。

单条采集 SHALL 仅豁免「数量上限」，MUST NOT 豁免采集配额；采集池耗尽时同样拒绝并提示。

重复采集同一条 SHALL 被拒绝并提示已采集时间。

#### Scenario: 已采集状态持久

- **WHEN** 用户单条采集某作品后关闭并重开应用
- **THEN** 该作品仍显示「已采集 · 采集时间」且按钮保持置灰

#### Scenario: 单条不豁免配额

- **WHEN** 采集配额已耗尽且用户点击单条「采集」
- **THEN** 系统拒绝并提示配额已用尽，MUST NOT 因为「只有一条」而放行

### Requirement: 探测与采集双轨配额及其持久化对账

系统 SHALL 将探测与采集计入**相互独立**的两份逻辑配额，且两者 MUST 共用 YouTube 项目级物理池的不同切分比例（探测 15% / 采集 60% / 安全余量 25%）。切分 MUST 按相对比例而非绝对数字，以适配配额可扩容或调整。

配额计数 SHALL 以**持久 ledger**（`collection_quota_ledger(day, kind, units, request_sig, created_at)`）为真源，MUST NOT 以内存累加器为真源。跨日重置 SHALL 依赖 `day` 字段自然分界，MUST NOT 使用定时器清零（应用关闭时定时器不触发，会漏清或重复清）。

系统 SHALL 在**新增关注、修改间隔、批量调整、导入、备份恢复、迁移、启动加载**七条路径上强制校验 `Σ(1440/check_interval_min) ≤ 探测池`。

导入与迁移的校验失败 MUST 整体拒绝，MUST NOT 部分导入。批量调整 MUST 在单个数据库事务内应用，任一条不满足则整体回滚。启动时若存量数据已超限，系统 SHALL 降级运行并告警，MUST NOT 删除用户数据，MUST NOT 拒绝启动。

#### Scenario: 最小间隔导致超限被拒

- **WHEN** 已有 50 个关注项且用户把其中一个间隔改为 5 分钟
- **THEN** 校验发现总需求超过探测池，拒绝该次修改并提示需调大部分博主间隔

#### Scenario: 批量调整不做部分应用

- **WHEN** 用户一次性把 10 个博主的间隔调密，仅其中 6 个满足配额
- **THEN** 整批回滚，MUST NOT 只应用前 6 个

#### Scenario: 启动时存量超限降级而非拒绝启动

- **WHEN** 用户从旧备份导入的关注项总需求已超探测池
- **THEN** 应用正常启动，监控按 `check_interval_min ASC, created_at ASC` 保底运行，UI **逐个列出**被跳过的博主及其原因；被跳过者不发请求因而不消耗配额

#### Scenario: 崩溃后计数不丢

- **WHEN** 应用在当日已发出若干 API 请求后被强制杀死并重启
- **THEN** 当日已消耗量以 ledger 重算为准，MUST NOT 从零重新计数导致超发

#### Scenario: 外部争用时收缩并可恢复

- **WHEN** 收到 `quotaExceeded` 而本地计数很低
- **THEN** 判定同 Key 被其他程序占用，池收缩至 50%（连续 2 次至 25%）并进入 30 分钟冷却；收缩带 24 小时 TTL，到点无条件回基准，MUST NOT 永久停在低水位

### Requirement: 失败分级与降级

系统 SHALL 按平台 API 响应的 `error.errors[].reason` 分类，MUST NOT 仅按 HTTP 状态码分类——YouTube 的 `quotaExceeded` 返回 403。响应含多个 `reason` 时 MUST 按固定优先级匹配：quota/rate → auth/config → notFound → item → unknown。

节流类与瞬时类（5xx/超时/连接重置）MUST NOT 计入连续失败。博主级真故障连续 3 次 MUST 转入 `auto_paused`。凭证类 MUST 首次即转入 `fatal_paused` 并在 UI 指向设置页。

分类无法完成时系统 SHALL fail-closed 计入失败并保留脱敏响应摘要（含 HTTP 状态码与 `x-goog-request-id`），MUST NOT 静默放行。

#### Scenario: 配额耗尽不会被误判为故障

- **WHEN** API 返回 `quotaExceeded`（HTTP 403）
- **THEN** `consecutive_failures` 不增加，状态保持 `active`，UI 不报警

#### Scenario: 视频被删不会停用整个博主

- **WHEN** 某条作品采集时返回 `videoNotFound`
- **THEN** 仅该条进入 `failed`，博主的 `consecutive_failures` 不增加，博主不被暂停

#### Scenario: 分页错误不得静默跳过

- **WHEN** 探测翻页时返回 `invalidPageToken`
- **THEN** 该次探测整体判为任务级失败并触发重试，MUST NOT 归为单条 item 级——否则会「跳过该条继续翻页」，静默丢失后续分页的全部作品

#### Scenario: 应用级 403 不得归为单条

- **WHEN** 返回 `ipRefererBlocked`
- **THEN** 归为致命级并首次即暂停，MUST NOT 归为 item 级——否则表现为「每条都失败但博主永不暂停」，监控静默失效

#### Scenario: 凭证失效首次即暂停

- **WHEN** API 返回 `keyInvalid`
- **THEN** 该博主首次失败即进入 `fatal_paused`（不等 3 次），UI 显示凭证原因并提供直达设置页入口

### Requirement: 采集并发安全与最终化原子性

采集 SHALL 通过 `claim + lease + fencing token` 保证同一作品不被并发重复采集。claim MUST 为单条原子 UPDATE（`UPDATE ... RETURNING claim_token`）。

**所有行内变更与副作用**——进度写入、lease 续期、跨表插入、熔断计数——MUST 按 `claim_token` 条件提交。成功/失败提交 token 不匹配时 MUST 放弃提交，MUST NOT 覆盖新持有者。

心跳续租 MUST 以**实质进展**为条件，进展粒度 MUST 明确定义（字节回调 / 阶段边界跨越 / 每 5s 阶段内心跳，满足其一即续租），MUST NOT 因事件循环空转而无进展续租。系统 MUST 另设总 deadline 与分阶段超时，与续租解耦。

产物落在**事务外**的文件系统侧，因此 SHALL 采用 outbox 最终化协议：先落 staging 产物 → 单个最终化事务内完成搬产物 + UPSERT `viral_library` + `collect_state='collected'` + outbox `done` → 异步 worker 消费。中间态用 `collecting`/`ready`，MUST NOT 参与终态判据。

outbox SHALL 设重试上限与**死信状态**，永久失败 MUST 停止自动重试并告警，MUST NOT 无限重试导致 staging 永不清理。

#### Scenario: 并发点击只采集一次

- **WHEN** 用户在两个窗口同时对同一条作品点击「采集」
- **THEN** 仅一个窗口 claim 成功并执行采集，另一窗口收到「该作品正在采集中」

#### Scenario: 租约过期的旧持有者不得覆盖

- **WHEN** 旧 worker 租约过期后新 worker 接管并完成采集，随后旧 worker 才返回结果
- **THEN** 旧 worker 的提交因 `claim_token` 不匹配被拒绝，新 worker 的结果不被覆盖

#### Scenario: 事务解决不了双写

- **WHEN** 数据库已提交 `collected` 而产物写入失败
- **THEN** 系统 MUST NOT 留下「已采集但正文为空」——产物先于入库落 staging，失败时 discovery 仍为 `failed` 且用户可重试

#### Scenario: 删除与最终化的竞态

- **WHEN** 删除发生在 outbox 消费之前
- **THEN** 删除事务写入 tombstone 并递增 `claim_token`，迟到的 finalizer 在校验 token 时必然失败并放弃，MUST NOT 把产物搬回来导致「已删除却又复活」

#### Scenario: 挂起任务不得无限续租

- **WHEN** 采集任务卡死且无任何字节或阶段进展
- **THEN** 心跳不续租，租约到期后可被其他 worker 抢占；总 deadline 到达时强制放弃

### Requirement: 采集库与发现记录的一致性维护

`viral_library` SHALL 作为采集事实源，`creator_discoveries` 作为发现事实源，两者 MUST NOT 建立外键（存量行无 `creator_id`，外键会导致迁移失败）。

删除采集库条目 MUST 在**单个事务**内完成：删除 `viral_library` 行、将 `creator_discoveries.collect_state` 落回 **`pending`**、递增 `claim_token` 使在途 worker 失效、撤销未 `done` 的 outbox。

系统 SHALL 提供**每日完整性巡检**：`collect_state='collected'` 但 `viral_library` 无对应行者 MUST 复位为 `pending` 并记日志。巡检复位前 MUST 过采集池准入校验。

#### Scenario: 删除后作品可重新采集

- **WHEN** 用户删除某已采集作品
- **THEN** 对应 discovery 回到 `pending`，后续探测不会因唯一索引跳过，该作品可被重新采集

#### Scenario: 跨入口删除不留幽灵记录

- **WHEN** 用户从批量清理等非主路径删除 `viral_library` 行
- **THEN** 每日巡检 MUST 发现并复位该 discovery，MUST NOT 依赖「所有删除都走同一入口」这一代码纪律

### Requirement: 凭证安全

API Key SHALL 经 Electron `safeStorage` 加密后存储，MUST NOT 明文落盘，MUST NOT 写入任何日志、崩溃报告或隔离区载荷。

IPC 契约 SHALL 为**单向**：MUST 提供一次性写入通道接收用户输入的明文（用户必须在渲染层输入，此项无法回避），但所有查询通道 MUST NOT 回传明文，只返回状态与末四位指纹。保存后主进程 MUST 立即丢弃明文引用，渲染层 MUST 立即清空输入框且 MUST NOT 写入任何持久化存储。

系统 SHALL 区分「未配置」「系统密钥库不可用」「已保存但无法解密」「本地存储读取失败」四种状态并给出各自文案。前三种的处置各不相同（填写 / 检查系统环境 / 重新填写）；读取失败时重填无效，MUST 引导重启或检查磁盘，MUST NOT 并入「无法解密」让用户反复重填。

`safeStorage` 不可用时系统 SHALL fail-closed 禁用该功能，MUST NOT 降级为明文保存。

#### Scenario: 渲染层拿不到密钥原文

- **WHEN** 前端查询凭证状态
- **THEN** 只得到 `status` 与末四位指纹，MUST NOT 得到密钥原文

#### Scenario: 换机后密钥不可解密

- **WHEN** OS 密码重置或跨设备迁移后 `safeStorage.decryptString` 抛错
- **THEN** 状态标为「已保存但无法解密」并引导重新输入，MUST NOT 笼统报「未配置」让用户反复重填仍失败

#### Scenario: 密钥库不可用时功能禁用

- **WHEN** `safeStorage.isEncryptionAvailable()` 为 false
- **THEN** 博主监控功能整体禁用并明示原因，MUST NOT 明文保存密钥

### Requirement: 送入 AI 写作的外发边界

「送入 AI 写作」SHALL 只外发正文与标题，MUST NOT 外传作者标识、频道 ID、链接、缩略图或任何用户标识字段。出站目标 MUST 限于用户已配置的 LLM 供应商，MUST NOT 新增隐式出站通道。

正文中的邮箱、手机号、长数字串 MUST 在出站前做脱敏。首次外发 MUST 一次性说明并取得确认，用户撤回后该入口 MUST 置灰。每次外发 MUST 记录时间与运行 ID 以便追溯来源。

采集内容默认为**本地优先**：MUST NOT 在用户未显式点击时自动外发。

#### Scenario: 外发字段最小化

- **WHEN** 用户点击「送入 AI 写作」
- **THEN** 出站 payload 仅含标题与脱敏正文，MUST NOT 含 `author` / `channel_id` / `url` / `thumbnails`

#### Scenario: 未确认不外发

- **WHEN** 用户尚未对首次外发说明做出确认
- **THEN** 系统 MUST 先展示说明并要求确认，MUST NOT 直接把内容发给模型

### Requirement: 自动化任务调度的健壮性

新增博主监控任务类型时，`automation-scheduler` 的 `action.type` 硬编码点 MUST 改为可扩展分发。未知任务类型 MUST **挂起该任务并隔离原始载荷**，MUST NOT `throw`（会中断调度循环，导致所有自动化停摆），MUST NOT fallback 到其他任务类型（会静默跑错链路）。

隔离区 SHALL 在落库前脱敏、设容量上限、记录用户显式删除审计，MUST NOT 自动删除（自动删等于静默丢用户配置）。任务被挂起 MUST 主动告知用户（未收口徽标 + 首次通知 + 卡片开关置灰但保持可见）。

#### Scenario: 未知类型不拖垮调度器

- **WHEN** 存在一条 `action.type` 无法识别的历史任务
- **THEN** 该任务被挂起并隔离，其余任务照常触发；该任务在 UI 显示明确错误并可编辑恢复

#### Scenario: 用户不会因绿灯误判自动化正常

- **WHEN** 某任务因未知类型被挂起
- **THEN** UI MUST 显示未收口徽标且卡片启用开关置灰，MUST NOT 仍显示为「已启用」让用户以为自动化在跑

### Requirement: 平台能力分层与诚实标注

系统 SHALL 为每个平台标记能力等级：`official`（官方接口）、`best_effort`（尽力而为，可能不稳定）、`unsupported`（暂不支持），并在 UI 显式展示。

首批仅 YouTube 为 `official`；视频号为 `unsupported`；其余为 `best_effort`。

系统 MUST 在文案中如实声明：关闭应用期间不检查新作品，重新打开后仅检查增量而不补跑关闭期间的内容。

系统 MUST NOT 承诺抖音 / 小红书 / 视频号长期稳定可用——其反爬为持续对抗，架构只保证失效时不拖垮整体。

#### Scenario: 能力等级正确展示

- **WHEN** 用户在平台选择器查看可用平台
- **THEN** YouTube 标注「官方接口」且可选，视频号标注「暂不支持」且禁用

#### Scenario: 生命周期如实告知

- **WHEN** 用户首次开启博主监控
- **THEN** 明确告知关闭应用期间不会检查新作品，重新打开后仅检查增量

### Requirement: 面板接线的可解析性（2026-10-12 修复）

博主监控的服务 MUST 在 IPC 注册点从 DI 容器取用（`context.container.get(name)`）。MUST NOT 依赖 `context` 自身的 `get` —— 该对象是 `bootstrap/phase1-context.js` 的分组 Proxy（`{infra, services, windows, pipelines}`），只暴露 `container` 字段。任何一项依赖缺失 MUST 只降级对应通道并留 warn 日志，MUST NOT 让整个 IPC 注册失败。

装配期接线的三个形状 MUST 与消费方一致，且 MUST 有回归锁：

1. `creatorCollector` MUST 暴露 `resolveChannelId`（`creator:follow` 的唯一解析入口）；
2. `creatorCredentialProvider` MUST 注册（容器 `get` 对未注册名**抛错**，不是返回 `undefined`）；
3. 采集器的 `credentialProvider` MUST 是返回 `{ apiKey, pythonBridge } | null` 的**函数**，MUST NOT 直接传 provider 对象。

#### Scenario: 容器缺项只降级不抛

- **WHEN** 容器未注册任一 creator 依赖
- **THEN** 其余 IPC 通道照常注册，creator 通道返回 `reason: 'service-unavailable'` 且日志有 warn，MUST NOT 抛出

#### Scenario: 采集器替身不得自造方法

- **WHEN** 端到端测试使用采集器替身
- **THEN** 替身的方法集 MUST 是真实 `createCreatorCollector` 返回对象的子集，MUST NOT 出现「替身有、真实没有」的方法（否则会把不可用的功能测成可用）

### Requirement: 服务未就绪与依赖缺失必须分因

`reason: 'service-unavailable'`（主进程服务未装配 ⇒ 重启应用）与**可选依赖缺失**（正文/字幕增强腿缺 Python 包 ⇒ 装包）SHALL 是两条互斥的提示路径。渲染层 MUST 按 `reason` 选文案，MUST NOT 用同一句话承载两种处置。

依赖状态 SHALL 由只读通道 `creator:dependency-status` 提供，分两腿回报：发现腿（Node 内置 https + Data API，MUST 无第三方包依赖）与正文腿（Python `content-aggregator`，MUST 标记 `optional: true`）。正文腿缺失 MUST NOT 阻塞发现与采集，MUST 在界面上如实告知质量降级并给出确切安装命令。

`{command}` 类占位符 MUST NOT 以空串渲染 —— 无命令可给时 MUST 换成不含占位符的文案。

#### Scenario: 服务未就绪不得显示为依赖缺失

- **WHEN** creator 通道返回 `service-unavailable`
- **THEN** 界面显示「服务未就绪 + 重试」，MUST NOT 显示「缺少采集依赖。请执行：」

#### Scenario: 可选依赖缺失只作非阻塞提示

- **WHEN** Python 后端桥不在运行
- **THEN** 发现与采集仍可用，界面显示字幕增强不可用及安装命令，MUST NOT 因此禁用功能

### Requirement: 添加博主的入口与交互

「添加博主」MUST 走应用内弹窗。MUST NOT 使用 `window.prompt` —— Electron 渲染进程不支持它（调用即抛 `prompt() is and will not be supported`），会使该入口**整条不存在**。

输入校验 SHALL 分层：渲染层只负责「非空」与「≤512 字符」，形态判定（链接 / `@handle` / `UC…` ID）MUST 复用主进程 `parseChannelInput` 的单一实现，MUST NOT 在渲染层再写一份猜测逻辑。

关注成功后 MUST **立即执行首次探测**（`fetch_transcript=False`），MUST NOT 让用户等到下一个巡检周期才看到结果。失败 MUST 按领域 `reason` 分因提示（格式 / 不是频道 / 频道不存在 / 凭证缺失），凭证缺失 MUST 直接打开凭证配置弹窗。

#### Scenario: 弹窗而不是系统 prompt

- **WHEN** 用户点击「关注」
- **THEN** 打开应用内弹窗并聚焦输入框，MUST NOT 调用 `window.prompt`

#### Scenario: 超长输入不静默截断

- **WHEN** 粘贴内容超过 512 字符
- **THEN** 提交时给出内联错误且不发请求，MUST NOT 截断后提交、MUST NOT 让按钮无反应

#### Scenario: 添加后立即检查

- **WHEN** 频道解析成功并落库
- **THEN** 系统立即对该关注项执行一次探测（不取正文），待采集角标随之更新

### Requirement: 凭证配置的可见入口

系统 SHALL 在博主监控页提供凭证明文写入入口，并以 PRD §7.4 的四种状态（未配置 / 密钥库不可用 / 已保存但无法解密 / 已配置）展示当前状态。已配置时展示末四位指纹。

文案 MUST NOT 引导用户去不存在的位置（如「请在设置中填写」而设置页并无该字段）。保存成功后 MUST 清空输入框并立即刷新状态；写入通道 MUST 受 sender 守卫，MUST NOT 被外部页面调用。

形态提示 SHALL 非阻塞：值不匹配 Google API Key 现行前缀时 SHOULD 提示核对，MUST NOT 据此拒绝保存。

#### Scenario: 入口可达

- **WHEN** 用户处于「未配置」状态
- **THEN** 页面显示横幅与「配置 API Key」按钮，点击后打开写入弹窗

#### Scenario: 写入通道受守卫

- **WHEN** 非可信来源调用凭证写入通道
- **THEN** 请求在业务逻辑之前被拒绝，明文 MUST NOT 进入任何业务函数
