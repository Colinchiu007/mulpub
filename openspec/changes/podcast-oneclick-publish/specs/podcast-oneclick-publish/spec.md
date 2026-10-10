## ADDED Requirements

### Requirement: 播客频道为多实例且 id 不可变

系统 SHALL 支持同一登录态下存在多个播客频道，每个频道以不可变短 id（`^ch_[a-z0-9]{4,16}$`）标识，且该 id 的唯一载体为 `index.json` 的 `channels[].id`（目录名与之相等，落盘校验与对象 key 派生共用同一判据）。频道改名 SHALL NOT 改变其 id、目录名或托管对象路径。

#### Scenario: 新建频道分配合规 id
- **WHEN** 用户在频道目录中创建名为"午间电台"的频道
- **THEN** 返回的 `channelId` 匹配 `^ch_[a-z0-9]{4,16}$`，且 `<userData>/podcast/channels/<channelId>/` 目录存在

#### Scenario: 改名不影响对外 feed 地址
- **WHEN** 用户把频道显示名从"午间电台"改为"夜间电台"
- **THEN** `channelId` 与托管对象 key 逐字不变，已提交给聚合端的 feed URL 仍然有效

#### Scenario: 目录名不得充当频道 id
- **WHEN** 任何调用方以 `default` 作为 channelId 请求频道目录
- **THEN** 系统抛 `PODCAST_CHANNEL_ID_INVALID`，不创建任何目录

### Requirement: 存量单频道数据的迁移必须可回退且不改写身份

系统 SHALL 在首个需要频道数据的调用处一次性完成迁移（注册处理器阶段 SHALL NOT 触碰 userData 目录），按内容哈希三态判定完整性，并把冲突与硬失败落为**持久化状态**：读路径 SHALL 能读到该状态以渲染处置入口，写路径与一键发布 SHALL fail-closed。迁移 SHALL NOT 删除 legacy 文件，SHALL NOT 改写既有单集的 `guid`。

#### Scenario: 从非空 legacy 迁移
- **WHEN** 存在 legacy `channel.json` 与 `episodes.json` 且尚无 `index.json`
- **THEN** 系统为 legacy 频道分配合规 `ch_*` id 并复制两份文件，字段值逐字保留（含 `guid` 缺席时不得补写），legacy 原件仍在原位

#### Scenario: 半复制目标按续传处理
- **WHEN** 目标频道目录存在但缺 `episodes.json`，且 legacy 来源完整
- **THEN** 系统补齐缺失文件而**不**判为冲突，迁移状态为空

#### Scenario: 真冲突不得静默选一份
- **WHEN** 目标与 legacy 各为不同合法内容
- **THEN** `index.json` 落 `migrationStatus: "conflict"`，`podcast:channel:list` 仍成功返回该状态，而 `podcast:channel:create` 抛 `PODCAST_MIGRATION_CONFLICT`

#### Scenario: 迁移中途 IO 失败
- **WHEN** 复制过程中发生 IO 错误
- **THEN** 落 `migrationStatus: "error"` 与 `PODCAST_MIGRATION_IO_FAILED`，只读通道保留，写路径拒绝

### Requirement: 发布同步状态必须持久化且不被改名抹除

系统 SHALL 把每频道的 feed 同步结果（`result` / `attemptedAt` / `errorCodes` / `hostingSnapshot`）保存在 `channel.json` 的 `feedSync` 段，与 `validateChannel` 白名单所属的 `meta` 段分离。`podcast:channel:save` SHALL NOT 修改 `feedSync`；应用重启后 SHALL 仍能从持久化状态恢复"公网 feed 未同步"提示。

#### Scenario: 改名保留发布状态
- **WHEN** feed 上传失败使 `feedSync.result = "partial"`，随后用户保存一次频道名
- **THEN** `feedSync` 逐字仍在，播客页仍显示"公网 feed 尚未更新"

#### Scenario: 服务实例重建后状态仍在
- **WHEN** 主进程服务实例被重建（等价于应用重启）
- **THEN** 同一频道的 `partial` 状态与错误码仍可读回，无需依赖当次会话内存

### Requirement: 单集写入必须按内容校验且区分严格模式

系统 SHALL 在写入单集前对**将要落盘的完整对象（合并结果）**执行引擎 `validateEpisode` 判据，SHALL NOT 只校验传入的部分字段。一键发布路径 SHALL 以严格模式调用（不合规即整次拒绝、不落盘）；播客页手工路径 SHALL 保留"先登记、后补直链"的中间态，落盘后即时校验但仅出声不阻断。字段判据的唯一实现 SHALL 位于共享引擎，各调用点不得复制第二份。

#### Scenario: 旧脏字段不得借合并存活
- **WHEN** 已存在的单集含非法 `mime`，随后以仅含合法 `title` 的对象保存同一期
- **THEN** 严格模式保存被拒绝，合并结果不得落盘

#### Scenario: 手工中间态可保存但必须出声
- **WHEN** 播客页保存一条只有本地文件、尚无 https 直链的单集
- **THEN** 落盘成功，日志与 `episode:list` 的每期 `compliance` 均如实标记不合规原因

### Requirement: 并发写必须按记录键串行且发布不得叠发

系统 SHALL 为 `episodes.json` 的全部写者（一键发布、手工增删）提供按 `channelId` 键的串行锁，为 `index.json` 提供全局单键串行锁；两把锁 SHALL 均为 try-acquire、等待有上限、超时者不得执行其临界区、前序抛错必须放行后来者，且同一键 SHALL NOT 重入。同频道已有发布在跑时，系统 SHALL 立即返回 `PODCAST_CHANNEL_BUSY` 而不是排队等待。

#### Scenario: 跨频道并行不被全局化
- **WHEN** 两个不同频道同时发起发布
- **THEN** 两者互不阻塞，各自的 episodes 写入串行

#### Scenario: 同频道叠发立即被拒
- **WHEN** 某频道发布尚未结束（含分块合成与对象上传）时用户再次点击发布
- **THEN** 第二次调用立即得到 `PODCAST_CHANNEL_BUSY`，装配器一次都没有被调用

#### Scenario: 等待超时者不得补写
- **WHEN** 某写者等待锁超过预算
- **THEN** 它不执行自己的临界区，且后序等待者仍能正常获得锁（序位不被放弃者压乱）

### Requirement: 一键发布不得进入平台发布链

系统 SHALL 以独立通道承载播客一键发布：`config/platforms.yaml`、`publish-capabilities.json`、`platform-definitions.js`、rpa-engine 选择器、`publishMode` 取值集合 SHALL 逐字不变；一键发布 SHALL NOT 占用 taskQueue 通道、平台日配额，SHALL NOT 复用 `publish:progress` 事件或写入平台发布历史。进度事件 SHALL 使用独立事件名并成对提供注册/注销。

#### Scenario: 分发端目录仍是唯一的全局频道无关通道
- **WHEN** 渲染层请求 `podcast:endpoints:list`
- **THEN** 该调用不需要 channelId（它是全局目录），而 6 条频道作用域通道缺 channelId 一律被拒；且该 handler **不得**经按频道构造的服务取目录——在没有注入任何替身的生产注册路径上调用它必须返回非空目录

#### Scenario: 平台契约面零污染
- **WHEN** CI 运行 `podcast-endpoints.test.js` 的「与平台契约面隔离」判据
- **THEN** 播客分发端 id 不出现在任何平台表中，`publishMode` 仍为三态闭集


### Requirement: 迁移状态必须在发现它的那一次调用上可读，写路径单独 fail-closed

系统 SHALL 把「能不能看见迁移状态」与「能不能写」拆成两条判据，且唯一实现落在 registry：`assertChannelExists()`（读：id 形态 + 频道存在）与 `assertChannelWritable()`（写：再查 `migrationStatus`）。`ensureMigratedOnce()` SHALL NOT 因发现冲突或硬失败而使**本次读调用** reject——它必须返回带着 `migrationStatus` 的索引。

#### Scenario: 首次访问即撞见冲突
- **WHEN** 存在 legacy 数据且迁移目标已是另一份合法内容，用户第一次请求 `podcast:channel:list`
- **THEN** 该请求成功返回 `migrationStatus="conflict"` 与冲突文件清单，界面渲染出横幅与两个处置按钮；不得返回错误、不得要求用户重开应用第二次才看得见

#### Scenario: 冲突态下读写分档
- **WHEN** 迁移处于 `conflict` 或 `error` 态
- **THEN** 读通道（`channel:get` / `episode:list` / `feed:verify`）照常返回数据，写通道（`channel:save` / `episode:save` / `episode:remove` / `feed:build`）与建频道/改默认一律被拒，且拒绝原因是迁移待处置而不是频道不存在

### Requirement: 手工写者与一键发布之间只有一个互斥判据

系统 SHALL 用进程内、按 channelId 键的「发布在飞」标记作为手工写者与一键发布之间的唯一互斥判据，该标记的实例在 registry 与频道服务之间共享（同一份，禁止第二实例）。手工写者 SHALL NOT 为等待发布而排队。

#### Scenario: 发布在飞时提交手工编辑
- **WHEN** 某频道有发布正在进行，用户保存/删除单集、改频道元信息或重建 feed
- **THEN** 调用立即得到 `PODCAST_CHANNEL_BUSY`，`episodes.json` 与 `channel.json` 逐字未变，界面给出「等本次发布结束后再修改」而不是「保存成功」

#### Scenario: 发布结束后立即恢复
- **WHEN** 上一次发布结束（成功、失败或取消均含）
- **THEN** 同一频道的手工写入口立即恢复可用；该拒绝不是粘滞态，且不依赖应用重启


### Requirement: 托管凭证的合并语义必须在唯一一处判定

系统 SHALL 把「留空即沿用已存凭证」的合并判定放在 `podcast-hosting-service.saveHosting` 一处：字段**缺席**表示保持不变，`clearSecret` 表示删除，二者不得由 IPC 层或渲染层各自再解释一遍。落盘层 SHALL NOT 以空字符串静默覆写已有 secret；凭证 SHALL 只经 `credential-store` 加密落盘（按登录归属分区），`index.json` 只存 `credentialRef`，任何读接口 SHALL NOT 回显 secret（只回掩码）。

#### Scenario: 只改 endpoint 而留空凭证
- **WHEN** 用户改了 Endpoint 但两个凭证字段都留空，保存后再次 `:get`
- **THEN** Endpoint 已更新，已存凭证仍可用（payload 里根本没有这两个键，落盘层不会收到空覆写）

#### Scenario: 系统凭据保护不可用
- **WHEN** 加密落盘返回失败
- **THEN** 保存整体失败并回 `PODCAST_HOSTING_CRYPTO_UNAVAILABLE`，`index.json` 不得出现指向不存在凭证的 `credentialRef`（半配置比没配置更难排障）

#### Scenario: 归属无法确定
- **WHEN** 登录归属解析为 `null`
- **THEN** 拒绝写入并回 `PODCAST_HOSTING_IDENTITY_REQUIRED`；legacy 形态（`undefined`）沿用旧命名空间，不 fail-closed——两种情形的文案与处置方向不同，不得合并

### Requirement: 发布 Feed 必须先建回滚点再覆盖主键，且失败形状必须可见

系统 SHALL 在覆盖公网 `feed.xml` **之前**建立回滚点（本地 `feed.prev.xml` + OSS 时间戳副本），且回滚点的内容 SHALL 是**本次 `buildFeed` 之前**磁盘上那份 `feed.xml`——`buildFeed` 就地覆写真源产物，在其后复制得到的只是同一份内容的第二份拷贝，`backupCreated:true` 因此会说谎。回滚点建不出来 SHALL NOT 阻断主上传（否则用户被锁死在原地），但必须在结果里如实标 `backupCreated:false`，并按「上一版本来就不存在」与「有上一版但没存档成功」两种成因分别标注（`prevExists` 与 `backupCreated` 一起进信封）。上传失败 SHALL 仍写入 `feedSync` 的失败态，使「公网未更新」在重启后依然可见；而**失败态写盘自身抛错**（真源损坏/锁超时）SHALL NOT 顶掉该失败形状。本期 SHALL NOT 提供一键退回（上一版对象 key 未持久化），该边界须在文档里明写而不是留成隐含承诺。

#### Scenario: PUT 返回非 2xx
- **WHEN** 对象存储返回 403 或无状态码
- **THEN** 结果为 `failed` 并带领域码与状态码，`feedSync.status` 落 `failed`，界面文案是「公网 feed 未更新，本地 Feed 与已发布内容不受影响，可重试」，绝不进入成功分桶

#### Scenario: 成功但无回滚点
- **WHEN** 主键覆盖成功而回滚点建立失败
- **THEN** 结果仍为 `success` 且 `backupCreated:false`，界面在成功文案之外**额外**显示回滚点缺失标注

#### Scenario: 回滚点内容必须是上一版而不是本次产物
- **WHEN** 同一频道第二次发布（第一次发布的内容记为 v1，第二次为 v2）
- **THEN** `feed.prev.xml` 与 OSS 时间戳副本逐字等于 **v1**，主键等于 v2；快照动作发生在 `buildFeed` 之前

#### Scenario: 首次发布没有上一版
- **WHEN** 该频道磁盘上还不存在 `feed.xml`
- **THEN** 不建本地 prev、不发时间戳副本，结果带 `prevExists:false`，界面显示「这是该频道首次发布，暂时还没有可退回的上一版」而不是「回滚点没建上」

#### Scenario: 失败态写盘自身抛错不得顶掉失败形状
- **WHEN** 主键 `PUT` 失败且随后的 `writeFeedSync` 抛出真源类错误
- **THEN** 调用方仍拿到 `{state:'failed', code, status}` 且 `feedSync:null`，写失败另落 warn 留痕

### Requirement: 对象上传的读流错误不得逃出主进程，也不得被 2xx 掩盖

`putObject` SHALL 给注入的读流挂 `error` 监听（`createReadStream` 的 open 排在下一个 tick，`destroy()` 取消不掉它；迟到的 open 失败若无人监听会以 uncaughtException 崩掉 Electron 主进程）。请求期内发生读流错误时，即便对端返回 2xx 也 SHALL NOT 报告成功。

#### Scenario: 请求返回后文件才被移除
- **WHEN** `PUT` 已返回，读流那次迟到的 open 因文件被删/被移而失败
- **THEN** 错误被流的监听吸收，主进程不出现 uncaughtException，已返回的结果不被追溯改写

#### Scenario: 请求进行中读体失败
- **WHEN** 读流在 `PUT` 尚未结算时发出 error，而对端仍回 200
- **THEN** `putObject` 抛 `PODCAST_HOSTING_BODY_READ_FAILED`，调用方按失败处理（2xx 只证明对端收了请求，不证明体真被读出来过）
