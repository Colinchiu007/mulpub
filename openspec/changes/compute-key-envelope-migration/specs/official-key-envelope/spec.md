# official-key-envelope Specification

## Purpose

定义官方 Key 池（平台自有的模型供应商凭据）的信封加密存储与解密契约，使 Node 侧（`api-publish-engine`）与 Python 侧（`ops-center`）都能读取，且安全性质不弱于被替换的 Fernet 方案（行级绑定、明文不落地、错误不降级）。

## ADDED Requirements

### Requirement: 信封存储格式与归属绑定

官方 Key 的明文 SHALL 以信封密文存储：每行一份随机数据密钥 `DK`（32 字节），以 AES-256-GCM 加密（`iv` 12 字节、`tag` 16 字节）；`DK` SHALL 经 KMS 以 `keyId = official:<provider>` 包裹为 `encryptedDataKey`。外层密文的 AAD SHALL 为 `official|<provider>|<keyRowId>`，即 `provider` 与行 id 都参与认证。格式族标识 `v` SHALL 与云端凭证信封（`ENVELOPE_VERSION`）取**不同值**；算法名 `alg` 与算法原语常量（IV/tag/DK 长度）SHALL 与云端凭证信封共用同源定义。

#### Scenario: 封印与解封往返
- **WHEN** 用合法 provider 与行 id 封印一段凭据，再以同一元组解封
- **THEN** 得到与原值逐字节相同的明文

#### Scenario: 跨 provider 替换密文
- **WHEN** 把 A provider 的 `encryptedDataKey` 或 `ciphertext` 换到 B provider 的行上再解封
- **THEN** GCM 认证失败并抛出领域错误，SHALL NOT 返回半成品或空串

#### Scenario: 跨行替换密文
- **WHEN** 把同一 provider 下 A 行的密文换到 B 行（行 id 不同）再解封
- **THEN** 认证失败并抛错（行级绑定由外层 AAD 承担，不得依赖 KMS 密钥环 id）

#### Scenario: 格式族标识不匹配
- **WHEN** 解封时 `v` 不等于官方 Key 信封的格式族标识
- **THEN** 一律拒绝，SHALL NOT 尝试"猜格式"或退化为按其他格式解包

### Requirement: fail-closed 与 KMS 选择唯一口径

KMS 抽象缺失、形状不合规、`wrap`/`unwrap` 抛错或返回非 Buffer 时，封印与解封 SHALL 抛出领域错误；SHALL NOT 降级为明文入库、固定密钥或不加密。KMS 的选择 SHALL 复用仓库既有的唯一口径 `createKmsFromEnv`（配置 `MP_CLOUD_KMS_KEYRING` ⇒ 密钥环；否则本地单密钥；两者都未配 ⇒ 配置错误），SHALL NOT 在官方 Key 路径另写第二处"用哪个 KMS"的判断。"已配置但值为空白"与"未配置" SHALL 被区分，前者 SHALL 判为配置事故而非静默降级。

#### Scenario: KMS 不可用
- **WHEN** KMS 抽象未注入或 `unwrap` 抛错
- **THEN** 封印/解封抛错，且调用方据此把该面报为 503；库中不产生任何明文记录

#### Scenario: 配置事故不被伪装成开发模式
- **WHEN** `MP_CLOUD_KMS_KEYRING` 已配置但值为空白
- **THEN** 判为配置错误并当场失败，SHALL NOT 回落到 `MP_CLOUD_KMS_LOCAL_KEY`

#### Scenario: 两条链路取到同一 KMS 口径
- **WHEN** 云端凭证链路与官方 Key 链路在同一进程内各自获取 KMS
- **THEN** 两者得到相同的 `provider` 取值（`keyring` 或 `local`）

### Requirement: 过渡期双格式与读取顺序

过渡期官方 Key SHALL 同时具备信封密文与 Fernet 密文（双写）。读取 SHALL 以**信封优先、Fernet 兜底**；读旧格式 SHALL 出声（warn 级日志 + 可观测计数），不得静默。两格式不一致时 SHALL 以信封为准，并 SHALL 将该行计入巡检报告的"漂移"栏，SHALL NOT 静默覆盖。

#### Scenario: 仅有 Fernet 的行仍可读
- **WHEN** 某行尚未迁移（只有 Fernet 密文）
- **THEN** 读取成功，且产生一条"读取了旧格式"的告警与计数

#### Scenario: 两格式不一致
- **WHEN** 同一行的信封明文与 Fernet 明文不相等
- **THEN** 以信封明文为准并记录漂移，管理面 SHALL 可见该行处于异常状态

### Requirement: 存量迁移的幂等、可续跑与失败语义

存量迁移 SHALL 以 admin 触发的 CLI 承载（不依赖任务宿主）。迁移 SHALL 幂等（以"该行已有可解开的信封"为跳过判据）、SHALL 可续跑（只处理缺少信封的行）、SHALL 在启动前做一次 KMS `wrap`/`unwrap` 往返自检。单行 SHALL 原子（解密 → 封印 → 写入 → 回读校验明文一致，同一事务）。默认行为 SHALL 为 fail-fast（首个失败即停机）；"继续跑完并汇总失败行" SHALL 只能作为显式可选开关。

#### Scenario: 重复运行安全
- **WHEN** 对已完成迁移的库再次运行迁移
- **THEN** 全部行被跳过，无写入、无错误

#### Scenario: 续跑判据含"解不开的行"
- **WHEN** 某行存在信封但该信封解不开（例如误用另一密钥环封印的残留）
- **THEN** 续跑 SHALL 处理该行（重新封印或报告），SHALL NOT 因"已有信封"而跳过；幂等判据与续跑查询的判据 SHALL 一致

#### Scenario: 默认拒绝以本地单密钥封印
- **WHEN** 迁移运行时 KMS provider 为本地单密钥（`local`）
- **THEN** CLI 默认拒绝执行并报错；仅当显式传入允许本地密钥的开关（供 CI/开发）时才放行

#### Scenario: 迁移报告登记密钥环身份
- **WHEN** 迁移完成
- **THEN** 报告包含所用密钥环的密钥 id 列表，供与部署文档登记的预期清单比对；不匹配时不得放行

#### Scenario: 挂错密钥环在启动时暴露
- **WHEN** 提供的密钥环无法 `unwrap` 自检用的随机 DK
- **THEN** 整批拒绝启动，且不写任何行

#### Scenario: 单行失败停机且不留半成品
- **WHEN** 某行 Fernet 解密失败
- **THEN** 迁移停机、报告该行，且该行在新表中不存在任何半成品记录

#### Scenario: 中断后的残留无害
- **WHEN** 迁移停机后库中"部分行有信封、部分行只有 Fernet"
- **THEN** 所有行仍可被读取（双读），且回滚只需删除新表记录、不需要恢复数据

### Requirement: 一致性巡检四项判据

系统 SHALL 提供一致性巡检，四项判据各自可独立失败：① 覆盖（每行有且仅有一条信封）；② 可解（用与生产同一模块解封）；③ 一致（信封明文与 Fernet 明文逐字节相等）；④ 绑定（跨行/跨 provider 替换密文必失败）。巡检 SHALL 在 Node 侧解封模块交付之后执行。

#### Scenario: 覆盖缺失变红
- **WHEN** 某行缺少信封记录
- **THEN** 巡检报告该项失败并点名行 id

#### Scenario: 明文不一致变红
- **WHEN** 两格式明文不相等
- **THEN** 巡检报告"漂移"并点名行 id

#### Scenario: 绑定失效变红
- **WHEN** 跨行替换密文后仍能解开
- **THEN** 巡检报告绑定判据失败（该项同时是变异反证的对象）

#### Scenario: 孤儿信封变红
- **WHEN** 信封表中存在没有对应官方 Key 行的记录
- **THEN** 巡检报告孤儿判据失败并点名信封记录

#### Scenario: 写路径遇 KMS 不可用
- **WHEN** 新增或更新官方 Key 时 KMS 不可用
- **THEN** 写入 SHALL 被拒绝并返回明确错误；SHALL NOT 只写旧格式副本、也 SHALL NOT 先存明文待补加密

### Requirement: 两侧读取能力与明文处理纪律

Python 侧 SHALL 具备读取同一信封的能力（因管理面存在三处需要明文的读路径：reveal 查看明文、掩码未变更比对、连通性测试回传上游）。Node 侧 SHALL 具备同一能力。两侧 SHALL 遵守：明文不出解封模块、使用后清零、不入日志（沿用日志脱敏合同）、主密钥与明文 SHALL NOT 出现在返回值与错误信息中。

#### Scenario: 管理面三条读路径可用
- **WHEN** 凭据以信封格式存储，运维执行 reveal / 修改掩码值 / 连通性测试
- **THEN** 三条路径均正常工作

#### Scenario: 明文处置分档
- **WHEN** 常规消费路径（服务端代调）解封凭据
- **THEN** 明文不出解封模块，调用方拿不到可长期持有的明文
- **WHEN** 管理面以 `reveal=True` 读取
- **THEN** 明文可返回，但仅限 admin，且该次读取写入审计记录（不含明文），明文不进日志、不被缓存留存

#### Scenario: 跨语言等价
- **WHEN** Node 侧封印一份密文交由 Python 侧解封（或反向）
- **THEN** 两侧解出的明文逐字节一致；密钥环包裹格式（id 前缀 + iv + tag + 密文）双向解析一致
- **WHEN** 两侧任一侧的 AAD 材料或格式解析被改动一位
- **THEN** 跨语言对拍必须失败（该断言进 CI）

#### Scenario: KMS 选择语义两侧一致
- **WHEN** 以"配了密钥环 / 配了但值为空白 / 都没配 / 只配本地单密钥"四类环境状态分别求取 provider
- **THEN** JS 与 Python 两侧对**同一张判定表**给出相同结论（含错误态），不得各写各的判据
- **WHEN** 对拍注入密钥环包裹格式的**字节样本**（不依赖任何 KMS 环境变量）
- **THEN** 纯函数解析结果两侧一致（使该断言在无密钥环的 CI 中可跑）

#### Scenario: 明文句柄形态
- **WHEN** 常规消费路径需要凭据明文（服务端代调、连通性测试）
- **THEN** 只能经回调式入口在**回调作用域内**使用；明文不得被序列化、不得被赋给回调外的长存活变量、不得进入缓存，回调返回后立即清零

#### Scenario: 明文不泄漏
- **WHEN** 解封后又发生一次日志写入或异常抛出
- **THEN** 日志与错误信息中不含明文或主密钥

### Requirement: 删除旧格式列的前置条件

删除 `official_keys.api_key`（Fernet）列 SHALL 作为独立变更执行，且 SHALL 同时满足：巡检四项全绿；"读取旧格式"的告警计数在一段观察窗口内连续为 0；已备份 `official_keys` 与密钥环文件；运营方显式授权。该步骤 SHALL 被声明为不可逆。

#### Scenario: 前置条件未满足时拒绝删列
- **WHEN** 巡检存在失败项，或"读取旧格式"计数非 0
- **THEN** SHALL NOT 执行删列

#### Scenario: 删列后不再回落到旧格式
- **WHEN** 删列完成
- **THEN** 读取路径中不存在 Fernet 分支；对无信封的行报错而非尝试解密旧格式
