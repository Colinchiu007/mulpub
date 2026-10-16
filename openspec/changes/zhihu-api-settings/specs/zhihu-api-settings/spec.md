# zhihu-api-settings 变更

## ADDED Requirements

### Requirement: 知乎 Access Secret 归口设置页

知乎开放平台 Access Secret MUST 在「设置 → 知乎 API」分区配置，位置 MUST 紧邻「飞书 API」之下；采集页 MUST NOT 再提供就地密钥输入。

#### Scenario: 分区位置与可达性
- **WHEN** 用户打开「设置」
- **THEN** 左侧 Tab 依次为 模型设置 / 通用设置 / 飞书 API / 知乎 API / 发布设置 / 账号设置，且「知乎 API」的下标恰为「飞书 API」下标 + 1

#### Scenario: 就地入口
- **WHEN** 采集页知乎收藏文章分组未配置凭据，用户点击「前往设置」
- **THEN** 设置弹窗打开并直接定位到「知乎 API」分区；同一按钮连点两次仍能再次触发（请求带自增 seq）

### Requirement: 凭据加密存储且按用户隔离

Access Secret MUST 经操作系统凭据保护（Electron `safeStorage`）加密后以 base64 存储于**用户域**设置键 `zhihu_api_config`；`safeStorage` 不可用时 MUST 拒绝保存且 MUST NOT 降级为明文存储。

#### Scenario: 加密落盘
- **WHEN** 用户保存一个合法的 Access Secret
- **THEN** 落盘行的密文不含明文，且 `zhihu:get-config` 返回体（含遮罩）经 JSON 序列化后不含明文

#### Scenario: 凭据保护不可用
- **WHEN** 系统凭据保护不可用（`isEncryptionAvailable()` 为假）
- **THEN** 保存返回错误「系统凭据保护不可用，无法加密保存知乎 Access Secret」，且不写入任何设置行

#### Scenario: 按用户隔离
- **WHEN** 已登录用户 A 保存密钥后切换为已登录用户 B
- **THEN** B 的 `zhihu:get-config` 不显示 A 的配置（读取走用户域命名空间）

### Requirement: 旧版明文密钥的兼容与迁移

系统 MUST 保留对历史全局明文键 `zhihu_access_secret` 的**只读**兼容（加密配置优先），并在保存或清除时将其销账。

#### Scenario: 存量用户升级后仍可用
- **WHEN** 机器上只有旧版全局明文密钥、没有加密配置
- **THEN** 采集链仍能取到密钥出站（解析来源为 `legacy`），且 `zhihu:get-config` 上报 `legacyDetected=true` 供界面提示迁移

#### Scenario: 保存即完成迁移与销账
- **WHEN** 用户在设置页保存密钥
- **THEN** 加密配置就位且全局明文键被置空，此后解析来源变为 `config`

### Requirement: 状态三态与明文不回显

界面 MUST 区分「已配置可用 / 已保存但无法读取 / 未配置」三态；已存明文 MUST NOT 回填到任何输入控件；保存成功后输入框 MUST 立即清空。

#### Scenario: 密文解不开时不冒充未配置
- **WHEN** 用户域存在密文但当前无法解密
- **THEN** 状态徽标显示「已保存但无法读取」并给出重新保存的提示，而不是显示「未配置」

#### Scenario: 明文不留驻界面
- **WHEN** 用户保存成功后停留在该分区
- **THEN** 输入框为空，页面上只显示形如 `zhih****7890` 的遮罩

### Requirement: 连通性测试与验证证据

`zhihu:test-connection` MUST 复用收藏夹列表这一条真实鉴权调用；传入未保存的明文时 MUST NOT 落盘，也 MUST NOT 记录验证时间；无参测试已存配置成功时 MUST 记录 `verifiedAt` 与收藏夹数量。

#### Scenario: 未保存值只测不存
- **WHEN** 用户在输入框填入密钥后直接点「测试连接」
- **THEN** 用该值发起一次真实调用，设置中不新增/不更新任何配置行

#### Scenario: 已存配置留下验证证据
- **WHEN** 用户保存后（输入框留空）点「测试连接」并成功
- **THEN** 状态行显示最近验证时间与收藏夹数量

#### Scenario: 错误归一可执行
- **WHEN** 平台返回频率限制（Code 30001）/ 配额用尽（Code 30002）/ 网络异常
- **THEN** 界面分别显示「知乎 API 频率限制，请稍后重试」「知乎 API 每日配额已用完，请明天再试」「网络连接失败: <原因>」，且不显示「保存成功」这类误导文案

### Requirement: 采集页凭据状态可见且可用性判据与解析同源

采集页知乎收藏文章分组 MUST 显示凭据状态（徽标 + 遮罩），其「获取收藏夹」按钮的可用性 MUST 依据「凭据解析来源非 none」而不是「密文是否可读」；设置弹窗关闭后 MUST 重新读取凭据状态。

#### Scenario: 只有旧版明文的用户不被误伤
- **WHEN** 凭据解析来源为 `legacy`
- **THEN** 「获取收藏夹」可用，并提示去设置中重新保存以完成加密迁移

#### Scenario: 未配置时给出出口
- **WHEN** 凭据解析来源为 `none` 且未配置
- **THEN** 分组内显示「请先在「设置 → 知乎 API」中配置 Access Secret」且**不**发起任何收藏夹请求，同时提供「前往设置」按钮

#### Scenario: 设置关闭后即时生效
- **WHEN** 用户在设置中保存密钥并关闭弹窗
- **THEN** 采集页重新读取状态，徽标变为「已配置」且按钮解禁

### Requirement: 配置通道的访问级别

4 条配置通道（`zhihu:get-config` / `zhihu:save-config` / `zhihu:test-connection` / `zhihu:clear-config`）MUST 按 `authenticated` 处理（与 `feishu:*` 同级），而采集通道保持 `public`；该不对称 MUST 在访问控制实现处写明理由。

#### Scenario: 未登录调用被拒且提示可读
- **WHEN** 当前访问级别为 public 时渲染端调用 `zhihuGetConfig`
- **THEN** 调用被权限层拒绝，设置页显示「当前账号无权修改知乎 API 配置，请先登录或激活许可证」而不是抛出未捕获异常

### Requirement: 清除配置需二次确认

「清除配置」MUST 为两步内联确认：首次点击 MUST NOT 发出任何请求，确认后 MUST 同时清除加密配置行与旧版明文行。

#### Scenario: 首次点击不发请求
- **WHEN** 用户点击「清除配置」
- **THEN** 界面进入确认态（出现【确认清除】与【取消】），且未调用 `zhihu:clear-config`

#### Scenario: 清除后回到未配置
- **WHEN** 用户点「确认清除」
- **THEN** 状态回到「未配置」，遮罩消失，`legacyDetected` 亦为假
