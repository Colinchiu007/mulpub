## ADDED Requirements

### Requirement: 官方 Key 池的物理归属

官方 Key 池 SHALL 存放在 api-publish-engine 的 Postgres 业务库中，
成为该数据的**单一真源**；ops-center 的 SQLite 侧同名表 SHALL 降级为只读存档。

ops-center SHALL 同时持有两个数据库连接（SQLite 承载其余配置表，Postgres 承载官方 Key 池），
两个连接 SHALL 各自独立管理连接池与会话工厂。

#### Scenario: ops-center 的官方 Key CRUD 走 Postgres

- **WHEN** 运营方通过 `/api/v1/secrets/*` 新增 / 修改 / 删除一条官方 Key
- **THEN** 该变更写入 Postgres 的 `official_keys` 表
- **AND** 对外 API 响应形状不变（仍只返回掩码，客户端拿不到明文）

#### Scenario: Fernet 密文在迁移中保持不变

- **WHEN** 迁移把存量行从 SQLite 搬到 Postgres
- **THEN** `api_key` 列**原样 COPY**，不做任何重加密
- **AND** ops-center（Python 侧）在迁移全程保持能解开 Fernet 密文

#### Scenario: 迁移期不做重加密

- **WHEN** 本 change 的任一步骤被实现
- **THEN** 不得修改 `api_key` 的加密形态
- **AND** 不得出现第二处 `encrypt_key(...)` 写入点（全仓加密写入唯一性由结构锁守护）

### Requirement: 切换期的失败语义

切换期的读与写 SHALL **fail-closed**：Postgres 不可用时，操作失败并出声，
**不得静默回落到 SQLite**。

#### Scenario: 切读后 Postgres 不可用

- **WHEN** ops-center 处于「读 Postgres」阶段，且 Postgres 连接不可用
- **THEN** 官方 Key 的读取 SHALL 返回明确错误
- **AND** SHALL NOT 回落到 SQLite 读取
- **AND** 理由：回落会让已被 `is_active=0` 熔断的 Key 重新被选中，
  后果是真实的上游调用与真实支出

#### Scenario: 双写阶段 Postgres 写失败

- **WHEN** ops-center 处于「双写」阶段，且写入 Postgres 失败
- **THEN** 该次写入 SHALL 整体失败
- **AND** SHALL NOT 仅写入 SQLite

### Requirement: 迁移编号的唯一性

Postgres 迁移文件的编号 SHALL 是跨 change 共享的单调序列。
任何迁移 change 在落库前 SHALL 现查 `migrations/postgresql/` 确认目标编号未被占，
且 SHALL 与并行中的其他迁移 change 对齐编号分配。

#### Scenario: 目标编号已被占用

- **WHEN** 拟落库的迁移文件编号已被另一个迁移文件占用
- **THEN** SHALL 改用下一个可用编号，SHALL NOT 复用或覆盖既有编号
- **AND** 规格文档中写下的旧编号 SHALL 一并更正

#### Scenario: 加文件与执行不同批部署

- **WHEN** 一个 PR 只新增迁移文件而不执行它
- **THEN** 业务库启动 SHALL 失败（`assertReady` 用 `allowPending:false`）
- **AND** 因此「加文件」与「执行」SHALL 同批部署

### Requirement: 数据校验

迁移 SHALL 提供三层可独立失败的校验：行数一致、逐行可解密、抽样明文一致。

#### Scenario: 任一行无法解密

- **WHEN** 存量行中有任意一行在当前 `OPS_ENCRYPTION_KEY` 下解密失败
- **THEN** 迁移 SHALL 停止并报告该行 id
- **AND** SHALL NOT 跳过该行继续

#### Scenario: 迁移前置未确认

- **WHEN** 生产环境的 `OPS_ENCRYPTION_KEY` 尚未确认固定
- **THEN** 迁移 SHALL NOT 开始
- **AND** 理由：该 key 缺失且开启 `OPS_ALLOW_EPHEMERAL_KEY` 时，每次重启都会生成新密钥，
  已加密的 Key 将永久不可解

### Requirement: 回滚路径

SQLite 侧的 `official_keys` 表 SHALL 在迁移完成后**保留为只读存档，不得删除**，
作为「读 Postgres」阶段之后的回滚退路。

#### Scenario: 切换后需要回滚

- **WHEN** 切读阶段发现数据不一致，需要回退到 SQLite 读取
- **THEN** 运维方 SHALL 能通过代码回滚恢复读 SQLite
- **AND** SQLite 侧的表 SHALL 仍保有完整数据
