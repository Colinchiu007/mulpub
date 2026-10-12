## ADDED Requirements

### Requirement: 账号级作品互动数据采集必须走创作者后台接口而不是公开作品页

系统 SHALL 提供账号级作品互动数据采集通道（`apps/desktop/electron/services/account-metrics/`），
通过携带该账号已保存会话凭证调用平台**创作者后台列表接口**获取该账号全部作品的
播放 / 评论 / 点赞 / 收藏 / 分享五项指标，SHALL NOT 以「抓取公开作品页 HTML」作为本通道的主数据源。

每个平台适配器 SHALL 声明 `{ platform, displayName, requiredCookieNames, requiresSigner,
buildListRequest, parseList }`；未注册平台的账号 SHALL 记为 `unsupported` 并点名，
SHALL NOT 静默跳过或补 0。

#### Scenario: 已注册平台返回真实指标
- **WHEN** 账号登录态有效且适配器已注册
- **THEN** 一次列表请求返回包含 `postId` 与五项指标的条目数组，并落成 `performance_snapshot`

#### Scenario: 未注册平台如实报不支持
- **WHEN** 账号平台无适配器（如 `wechat_mp`）
- **THEN** 该账号状态为 `unsupported`、`error='no_adapter'`，且不产生任何网络请求

### Requirement: 采集必须在发请求之前完成会话与签名前置校验

系统 SHALL 在发起任何请求之前完成三项前置校验：① 账号 `status === 'active'`；
② 该平台声明的必需会话 Cookie 齐备；③ 声明了 `requiresSigner` 的平台必须拿到签名器。
任一不满足时 SHALL 记对应状态（`needs_login` / `unsupported`）并**不发起请求**，
SHALL NOT 退化为「不带签名硬发」。

#### Scenario: 缺会话 Cookie 时零请求
- **WHEN** 小红书账号凭证里没有 `web_session`
- **THEN** 状态记为 `needs_login`、`error` 含 `missing_cookie:web_session`，且本轮该账号请求数为 0

#### Scenario: 签名器不可用时降级而非硬发
- **WHEN** 适配器声明 `requiresSigner` 但签名器未装配或返回不可识别的结果
- **THEN** 状态记为 `unsupported`（`error='signer_unavailable'` 或 `'sign_failed'`），请求数为 0

### Requirement: 采集频率必须有三层上限且超限出声

系统 SHALL 对采集施加三层上限：① 轮次层：调度每 24h 一轮；
② 账号层：单账号每 UTC 日最多 `accountDailyMax`（默认 4，含用户手动刷新）；
③ 请求层：页间延迟带随机抖动、账号之间**串行**（不并发）。
任一上限命中时 SHALL 计数（`skipped_daily_cap` / `truncated`）并如实返回，SHALL NOT 静默丢弃。

#### Scenario: 账号日额度用尽不再发请求
- **WHEN** 同一账号在本 UTC 日内已达 `accountDailyMax` 轮
- **THEN** 该账号状态为 `skipped_daily_cap`，本轮的请求数不增加

#### Scenario: 单账号页数触顶如实报截断
- **WHEN** 分页到 `maxPagesPerAccount` 仍有下一页
- **THEN** 结果中该账号 `truncated=true`，且请求数恰好等于 `maxPagesPerAccount`

#### Scenario: 页间延迟带抖动
- **WHEN** 连续两页之间的等待时长被计算
- **THEN** 该值落在 `[base, base × (1 + jitterRatio)]` 且两次计算不必相等

### Requirement: 采集失败必须与「零值」严格区分

系统 SHALL 在 HTTP 非 2xx、响应非 JSON、或响应结构不符预期时把该账号判为 `failed` 并携带原因，
SHALL NOT 因此写入任何零值快照。指标字段在平台未返回时 SHALL 落为 `null`，SHALL NOT 补 0、
SHALL NOT 用其他语义字段顶替（如以涨粉量充当分享数）。

#### Scenario: 服务端 500 不写快照
- **WHEN** 列表接口返回 HTTP 500
- **THEN** 该账号 `status='failed'`、`error='http_500'`，且本轮不调用任何快照写入

#### Scenario: 平台缺该指标落 null
- **WHEN** 抖音响应里没有收藏数字段
- **THEN** 该条目的 `metrics.favorites` 为 `null`（渲染为 `-`），而不是 0

### Requirement: 作品到发布记录的归因必须按强度分层且歧义留空

系统 SHALL 按强度递减的三级判据把采集到的作品归因到发布记录：
① `tracked_content.publish_history_id`（发布任务 id）；
② `(platform, post_id)` 精确命中；
③ 归一标题相等且发布时间落在发布记录时间窗内，**且候选唯一**。
候选多于一个时 SHALL 留空并计数 `ambiguous`，SHALL NOT 猜测。

#### Scenario: 同标题多候选判为歧义
- **WHEN** 一条发布记录在时间窗内匹配到两个同标题作品
- **THEN** 该记录不产生关联，且结果中 `ambiguous` 计数增加

#### Scenario: 真实作品 ID 精确命中优先
- **WHEN** 某 tracked 行的 `post_id` 与采集回来的作品 ID 相等
- **THEN** 以该行建立一级关联，且该作品不再参与二级匹配

### Requirement: 回填作品 ID 只补空值且写库幂等

系统 SHALL 在回填 `tracked_content.post_id` 时仅当原值为空（`NULL` 或空白）才写入，
SHALL NOT 覆盖既有值。同一 tracked 行、同一 UTC 日、同一来源的快照写入 SHALL 幂等
（主键形如 `acct:<trackedId>:<UTC 日>`），重复采集不得产生多行。

#### Scenario: 既有 post_id 不被覆盖
- **WHEN** tracked 行已有 `post_id='existing-real-id'`，采集回来的是另一个值
- **THEN** 库中该列仍为 `existing-real-id`

#### Scenario: 同日重复采集折叠为一行
- **WHEN** 同一 UTC 日内对同一 tracked 行连续写入两次快照
- **THEN** `performance_snapshot` 中该行只有一条记录，且值为最后一次

### Requirement: 发布记录页指标读口必须在主进程按归属完成 join

系统 SHALL 提供 `performance:history-metrics` 通道，由主进程按调用方给出的发布任务 id 列表
一次完成「任务 id → tracked 行 → 每行最新一份快照」的关联，并同时返回 `postId`、`capturedAt`
与账号级采集状态。归属过滤 SHALL 在 SQL 层完成，SHALL NOT 依赖渲染端传入的归属值。
认不出当前身份时 SHALL 返回 `AUTH_ERROR`，SHALL NOT 返回空指标的成功信封。

#### Scenario: 未登录不返回空数据成功信封
- **WHEN** 身份服务存在但取不到 `sub`
- **THEN** 返回 `code = AUTH_ERROR` 且 `data` 为 undefined

#### Scenario: 查询失败不吞成空结果
- **WHEN** 底层查询抛出（如表缺失）
- **THEN** 返回 `REQUEST_ERROR` 并携带原因，而不是 `{ metrics: {} }`

### Requirement: 界面必须如实表达非实时与四类空态

发布记录页 SHALL 常驻「数据为低频采集，非实时」说明；有指标时 SHALL 追加「数据截至 <相对时刻>」。
无指标时 SHALL 按原因显示互斥提示：尚未采集 / 平台不支持自动采集 / 账号登录已过期 / 上次采集失败。
平台不支持时 SHALL NOT 补 0 假装完整。

#### Scenario: 平台不支持时点名原因
- **WHEN** 该记录所属平台的采集状态为 `unsupported`
- **THEN** 指标区提示「该平台暂不支持自动采集」

#### Scenario: 有数据时不显示空态提示
- **WHEN** 该记录已合并到一份快照
- **THEN** 指标区显示真实数字且无任何空态提示

### Requirement: 整卡点击打开内容页，草稿语义如实区分

发布记录卡片 SHALL 在能解析出平台公开内容页时整块可点，点击后经应用内标签页打开该内容页
并保持在前台。解析不出公开内容页时卡片 SHALL 不可点且 title 说明原因。
发布结果 `result.draft === true` 的记录 SHALL 显示草稿语义提示，SHALL NOT 复用
「暂无平台公开链接」（点不动是正确语义，不是缺陷）。

#### Scenario: 可点卡片打开并置前台
- **WHEN** 记录的平台作品 ID 能派生出公开内容页
- **THEN** 卡片带可点样式，点击调用应用内标签页创建并把该标签置为活动标签

#### Scenario: 草稿记录不可点且文案为草稿语
- **WHEN** 记录的 `result.draft` 为 `true`
- **THEN** 卡片不带可点样式，title 为草稿提示，点击不产生任何打开行为
