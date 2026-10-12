## ADDED Requirements

### Requirement: 官方 Key 凭据的存储格式

`official_keys` 的凭据 SHALL 以信封密文存储，格式与归属绑定见能力 `official-key-envelope`。过渡期 SHALL 保留 Fernet 密文作为兼容读取路径（双写）；生产环境 SHALL NOT 以 `OPS_ENCRYPTION_KEY` 作为官方 Key 的**唯一**解密凭据。信封不可解开时，管理面 SHALL 报错，SHALL NOT 返回空串或掩码以掩盖故障。

#### Scenario: 过渡期双写
- **WHEN** 通过管理面新增或更新一条官方 Key
- **THEN** 该行同时具备信封密文与 Fernet 密文，且以信封为读取真源

#### Scenario: 收尾后仅信封
- **WHEN** 旧格式列已删除
- **THEN** 新增/读取官方 Key 均只走信封路径，`OPS_ENCRYPTION_KEY` 不再参与解密

#### Scenario: 信封不可解开时明示故障
- **WHEN** 某行的信封因密钥环不匹配等原因无法解开
- **THEN** 管理面返回明确错误（含该行 id），SHALL NOT 以空串或掩码伪装成"该 Key 未配置"

#### Scenario: 既有配额与告警行为不变
- **WHEN** 存储格式迁移完成
- **THEN** `rate_per_minute` / `daily_limit` / `alert_threshold_cost` / `note` 的校验与 `GET /api/v1/secrets/summary` 的池概览行为保持与本能力既有 Requirement 一致
