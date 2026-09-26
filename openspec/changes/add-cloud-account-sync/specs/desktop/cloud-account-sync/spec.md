# Spec Delta: desktop/cloud-account-sync

## ADDED Requirements

### Requirement: 云端账号归属登录身份

系统 MUST 把云端账号镜像归属于一个登录身份（Logto `sub` 解析出的业务用户），并 MUST 在所有账号云接口上以该归属做数据隔离；未认证请求 MUST NOT 读到任何账号数据。设备标识 MUST NOT 参与归属或合并判定。

#### Scenario: 未登录时拉取云端账号

- **WHEN** 客户端在未登录状态下请求 `GET /api/v1/me/accounts`
- **THEN** 服务端返回 401/503 且响应体不含任何账号字段，客户端不进入同步流程

#### Scenario: A 用户读不到 B 用户的账号

- **WHEN** 用户 A 与用户 B 各自云端有账号，A 请求自己的账号列表
- **THEN** 返回结果只含 `owner_subject = A` 的记录，条数与 B 的存量无关

### Requirement: 合并键为平台与平台原生 uid

系统 MUST 以 `(platform, platform_uid)` 作为"同一账号"的唯一判定键。`platform_uid` MUST 来自带凭证调用平台 user-info 接口取得的平台原生主键，MUST NOT 来自显示名、昵称、页面标题或头像 URL。本地 `uuid4[:8]` 账号 ID MUST NOT 作跨设备判定键。

#### Scenario: 同 uid 同平台视为同一账号

- **WHEN** 设备 A 与设备 B 各自登录了同一个视频号账号（`finderUser.uniqId` 相同）并分别同步
- **THEN** 云端只存在一条该 `(tencent_video, uniqId)` 的记录，第二次同步的结果是 `updated` 或 `unchanged`，不是新增

#### Scenario: 同平台不同 uid 视为不同账号

- **WHEN** 用户在同一平台有两个不同创作者账号并同步
- **THEN** 云端存在两条记录，二者 `platform` 相同、`platform_uid` 不同，均不被合并

#### Scenario: 昵称变化不改判定

- **WHEN** 某账号改了平台昵称后再次同步
- **THEN** 该记录被更新为同一账号（`updated`），不因名称变化产生第二条记录

### Requirement: 八平台 uid 提取覆盖

系统 MUST 对账号管理支持的八个平台（`douyin`、`toutiao`、`wechat_mp`、`tencent_video`、`bilibili`、`kuaishou`、`xiaohongshu`、`zhihu`）提供 `platform_uid` 提取实现，并 MUST 对每个平台同时具备正向（真实题材仍取到 uid）与负向（登录页/未登录响应不得产出 uid）回归。

#### Scenario: 新增平台 uid 提取缺负例时门禁拦截

- **WHEN** 某平台新增了 uid 提取但没有对应「登录页不算成功」负例
- **THEN** `platform-definitions` / `http-login-checker` 回归套件 MUST 失败

#### Scenario: 快手登录页不产出 uid

- **WHEN** 快手未登录与已登录都落在 `cp.kuaishou.com/profile`，采集到的是未登录响应
- **THEN** uid 提取返回空，账号被标为该次同步无法定身份，MUST NOT 用页面标题或昵称充当 uid

### Requirement: 凭证上云前须信封加密

系统 MUST 在凭证离开本机前用随机数据密钥以 AES-256-GCM 加密，并 MUST 用按用户隔离的主密钥再加密该数据密钥；主密钥 MUST 经 KMS 抽象层管理。数据库内 MUST NOT 出现明文凭证或明文数据密钥。主密钥不可用时 MUST fail-closed，MUST NOT 降级为明文存储。

#### Scenario: 库内取证只见密文

- **WHEN** 直接查询 `cloud_accounts` 的凭证列
- **THEN** 得到的是密文与加密后的数据密钥及 IV/tag，不含任何可解出的明文 cookie

#### Scenario: KMS 不可用不得降级

- **WHEN** 主密钥服务不可达时执行同步
- **THEN** 同步在该账号上以明确错误码失败并在过程区如实呈现，MUST NOT 写入未加密凭证

#### Scenario: 关联数据参与认证标签

- **WHEN** 密文的 AAD 被换成另一账号 ID 后尝试解密
- **THEN** 解密失败（GCM tag 校验不通过），MUST NOT 返回任何凭证内容

### Requirement: 登录态不得跨设备传播

系统 MUST 在把云端账号恢复到本机时把 `status` 强制写为 `unverified`，并把 `last_validated` 记为恢复时刻且不参与超龄兜底计算；随后 MUST 自动为该账号排队一次本机登录检测，由本机证据决定最终状态。云端传来的 `active` MUST NOT 直接写入本地真源。

#### Scenario: 恢复出的账号不冒充已登录

- **WHEN** 设备 B 首次从云端恢复一个在设备 A 上显示已登录的账号
- **THEN** 设备 B 上该账号显示「未确认」，且已排入检测队列；本轮检测给出有效结论后才显示已登录

#### Scenario: 旧时间戳不得触发超龄降级

- **WHEN** 云端记录的 `last_validated` 是 30 天前，被恢复到本机
- **THEN** 本机不把该时间戳当作宽限期锚点，账号不因恢复时刻即判失效

#### Scenario: 无定论不得抹除既有结论

- **WHEN** 恢复后自动检测返回 `CHECK_LOGIN_INCONCLUSIVE`
- **THEN** 真源 `status` 保持本轮之前的值，MUST NOT 被改写（沿用 `loginStatusTransition` 单向证据规则）

### Requirement: 凭证冲突由本机实测裁决

系统 MUST 在本机与云端凭证指纹不一致时进入冲突分支：先取时间戳较新的一份凭证做一次本机登录检测，有效则采纳；无效则对另一份重复；两份均无效时 MUST 保留本机原凭证并把账号标为需重新登录。系统 MUST NOT 在未检测的情况下按纯时间戳覆盖本机凭证。

#### Scenario: 较新但失效的云端凭证不得覆盖有效本机凭证

- **WHEN** 本机凭证有效、云端凭证时间戳更新但已失效
- **THEN** 同步保留本机凭证，结果标为 `conflict-resolved-local`，MUST NOT 用云端凭证覆盖

#### Scenario: 两份都失效

- **WHEN** 本机与云端凭证检测都判失效
- **THEN** 保留本机凭证原样，过程区显示该平台账号「凭证已失效，需重新登录」，MUST NOT 静默丢弃

### Requirement: 删除只阻止复活不反向删除

系统 MUST 在本机删除账号时向云端写入 `(platform, platform_uid)` 墓碑，并在后续同步中据墓碑 MUST NOT 把该账号拉回本机。云端存在的墓碑 MUST NOT 触发删除本机账号或本机加密凭证文件。

#### Scenario: 已删账号不复活

- **WHEN** 账号在设备 A 被删除并同步，随后在设备 B 执行同步
- **THEN** 设备 B 不会从云端恢复该账号，结果计数中该键计为 `skipped-tombstone`

#### Scenario: 云端墓碑不得删本机

- **WHEN** 云端存在某键的墓碑而本机仍有该账号（本机尚未同步过删除）
- **THEN** 本机账号与本机凭证均保持不变，过程区如实报告该键存在云端删除标记

### Requirement: 同步入口受运营 feature flag 控制且默认关闭

系统 MUST 仅在运营中心下发的 `account_cloud_sync` feature flag 为真时渲染【同步云端】按钮；flag 缺失、未同步过运营配置或网络不可用时 MUST 按关闭处理。未登录用户触发时 MUST 复用既有登录门（已登录放行 / 身份服务不可用 fail-closed / 未登录引导登录后续做原操作）。

#### Scenario: flag 关闭时入口不可见

- **WHEN** `featureFlags.account_cloud_sync` 缺失或为 false
- **THEN** 账号管理页命令栏不出现【同步云端】按钮

#### Scenario: flag 开启但未登录

- **WHEN** flag 为真、用户未登录并点击按钮
- **THEN** 弹出登录引导；用户完成登录后同步流程自动继续，用户取消则流程不启动且无云端请求发出

### Requirement: 弹窗先给云端摘要再确认

系统 MUST 在点击按钮后先拉取并展示云端摘要（账号总数与按平台分布），并 MUST 以"共 xx 个，是否同步"的确认形态呈现；用户取消时 MUST NOT 发起任何写请求。摘要获取失败时 MUST 展示可区分于"云端为空"的错误态。

#### Scenario: 云端为空

- **WHEN** 认证成功但云端账号数为 0
- **THEN** 摘要显示共 0 个并说明这是首次同步，确认按钮文案为同步而非"合并"

#### Scenario: 摘要请求失败不伪装成空

- **WHEN** 摘要请求超时或返回 5xx
- **THEN** 弹窗显示"无法获取云端账号信息"与重试入口，MUST NOT 显示"共 0 个"

#### Scenario: 用户取消

- **WHEN** 用户在摘要确认后点击取消
- **THEN** 弹窗关闭，无 PUT/POST 云请求发出，账号列表状态不变

### Requirement: 同步过程逐条可观测

系统 MUST 在一次同步期间以事件形式向渲染层推送逐条结果，每条至少含账号身份、结果枚举（`created`/`updated`/`unchanged`/`skipped-tombstone`/`conflict-resolved-local`/`conflict-resolved-cloud`/`invalid-credential`/`failed`）与失败原因码；并 MUST 在每条开始之前推送 in-flight 进度。过程 MUST 声明并发上限与单账号硬超时，超时结果语义 MUST 如实上报。

#### Scenario: 长任务不静止

- **WHEN** 某个账号的检测耗时接近硬超时上限
- **THEN** 过程区在该账号进入执行时已收到 start 事件并显示为进行中，MUST NOT 等到终态才首次出现

#### Scenario: 汇总如实区分部分成功

- **WHEN** 8 个账号中 6 个成功、2 个失败
- **THEN** 汇总显示成功与失败计数各为 6 与 2 并列出失败原因，MUST NOT 报告"同步完成"而无失败信息

#### Scenario: 中途退出

- **WHEN** 用户在过程区关闭窗口
- **THEN** 后续账号不再发起新请求，已完成的结果保留，弹窗与按钮状态回到可再次同步

### Requirement: 断开云端须提供用户侧退路

系统 MUST 提供"断开云端"操作，二次确认后删除该登录身份在云端的**全部**账号记录与墓碑，且 MUST NOT 删除或改动本机真源与本机加密凭证。断开后再次同步 MUST 视为首次同步。

#### Scenario: 云端清空本机保留

- **WHEN** 用户确认断开云端
- **THEN** 云端该用户账号与墓碑计数归零，本机 `accounts.json` 与 `credentials/**` 逐字节不变

#### Scenario: 断开失败如实报告

- **WHEN** 断开请求失败或部分删除未生效
- **THEN** 界面显示失败并保留入口，MUST NOT 显示"已断开"

### Requirement: 同步数据字段校验与上限

系统 MUST 对上行账号做白名单字段校验：平台枚举合法、字符串长度上限、`followers` 为非负有限数、时间戳为 ISO 8601；MUST 拒绝任何不在白名单的键（fail closed，非忽略）。凭证体积 MUST 有上限，超限账号 MUST 以明确原因码失败而非静默截断。

#### Scenario: 未知字段被拒

- **WHEN** 上行体里出现白名单外的键
- **THEN** 该账号以 `ACCOUNT_FIELD_NOT_ALLOWED` 失败，其余账号继续处理

#### Scenario: 凭证超限

- **WHEN** 某账号凭证序列化后超过声明上限
- **THEN** 该账号以 `CREDENTIAL_TOO_LARGE` 失败并在过程区显示，MUST NOT 截断后上传
