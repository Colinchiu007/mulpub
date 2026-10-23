# Tasks: 官方 Key 池迁入 Postgres

> 实现进度以本文件 checkbox 为**唯一来源**（`openspec status --change official-keys-postgres-migration`）。
> 依赖关系：1 → 2 → 3 → 4 → 5 → 6 → 7；第 8 组随各步同步。
> 配套 change：`compute-key-envelope-migration`（本 change 是其第 3 组的硬前置）。

## 1. 前置固化（本 change 的规格层）

- [ ] 1.1 **落库前现查迁移编号**：`ls migrations/postgresql/` 确认目标编号未被占，并与
      `compute-key-envelope-migration` 的编号分配对齐（本 change 优先占低位号，信封表顺延）。
      **编号不得凭规格写下时的印象决定**（2026-10-23 起 AGENTS.md「迁移编号的唯一性纪律」）。
- [ ] 1.2 写明「**加文件与执行必须同批部署**」：`assertReady` 用 `allowPending:false`，
      拆成两个 PR 中间每次启动都硬失败（design.md D8）。
- [ ] 1.3 定案 **OQ3**（SQLite 侧 `ensure_official_key_columns` 的处置）：
      保留函数但不再调用（design.md D7）。
- [ ] 1.4 定案 **OQ2**（第二个连接用 `asyncpg` 还是 `psycopg[binary]`）——
      倾向 `asyncpg`（无 C 扩展依赖，Windows 部署不需编译工具链）。
- [ ] 1.5 定案 **OQ1**（Postgres 访问控制清单）：谁能读 `official_keys` 表、备份链路怎么管、
      只读副本是否脱敏、审计日志是否会出现 Fernet 密文本身（design.md D9）。
      **本项需部署方确认，不能由实现方代答。**
- [ ] 1.6 迁移前置：**确认生产 `OPS_ENCRYPTION_KEY` 已固定**。
      `key_service.py:22-36` 有一条 `OPS_ALLOW_EPHEMERAL_KEY` 分支会在 key 缺失时
      **每次重启 generate 新密钥** ⇒ 已加密的 Key 永久不可解（design.md D10 第 2 层）。
      **未确认前不得开始迁移。**

## 2. 迁移文件与建表

- [ ] 2.1 新增 `migrations/postgresql/<号>_official_keys.sql`：建表 `official_keys`，
      15 列与 SQLite 侧同构（`ops-center/backend/models.py:116-136`），
      含 `provider` / `name` / `api_key` / `base_url` / `models` / `priority` / `is_active` /
      `tier_access` / `cost_per_1k_tokens` / `expires_at` / `rate_per_minute` / `daily_limit` /
      `alert_threshold_cost` / `note` / `created_at` / `updated_at`。
- [ ] 2.2 **补齐 SQLite 侧运行时 ALTER 补过的那 4 列**：`rate_per_minute` / `daily_limit` /
      `alert_threshold_cost` / `note`（`key_service.py:140-166`）——
      新表必须直接含这 4 列，**不得依赖运行时 ALTER**。
- [ ] 2.3 选 Key 索引：`CREATE INDEX ON official_keys (is_active, tier_access, priority DESC)`。
      （`tier_access` 语义见 `models.py:127`：1=all tiers / 2=standard+ / 3=pro only）
- [ ] 2.4 **表结构与 SQLite 侧逐列对照**：列名、默认值、空值性、CHECK 约束逐列核对，
      写一份对照表进执行记录。**不允许「大体一样」**——列名大小写/默认值差异会在
      Python 侧 `KeyRow` 映射时静默变成 `None`。
- [ ] 2.5 迁移单测：`discoverMigrations` 能识别该文件名（匹配 `MIGRATION_PATTERN`）；
      对已应用台账做一次 checksum 校验通过。
- [ ] 2.6 迁移幂等：`CREATE TABLE IF NOT EXISTS` + `INSERT ... ON CONFLICT DO NOTHING`，
      重复执行零副作用（data 段必须幂等，否则重跑会炸）。

## 3. ops-center 双库连接

- [ ] 3.1 `requirements.txt` 加 Postgres 驱动（依 1.4 的定案）。
- [ ] 3.2 `database.py`：新增第二个 `create_async_engine`（Postgres）+ `async_sessionmaker`，
      **与现有 SQLite engine 并列，不替换**。
- [ ] 3.3 **两个 `Base` 必须分开**：一个 ORM 类不能绑两个库 ⇒ Postgres 侧建独立
      `DeclarativeBase` / `metadata`，`OfficialKey` 挂到它下面。
      `database.py:31` 的 `Base.metadata.create_all` 需按库分别调用，
      **否则会把 Postgres 的表顺手建到 SQLite 里**。
- [ ] 3.4 新增 `get_pg_db()`（FastAPI `Depends`），与 `get_db()` 并列。
- [ ] 3.5 启动顺序：两个 engine 都在 startup 建好；
      **Postgres 连接失败时的行为依 design.md D6 定义（fail-closed）**，并出声。

## 4. ORM 与 CRUD 切库

- [ ] 4.1 `models.py`：`OfficialKey` 换绑 Postgres Base（**不删 SQLite 侧声明**——
      存档期还要读它做回滚核对）。
- [ ] 4.2 `services/key_service.py`：CRUD（`create_key` / `update_key` / `delete_key` /
      `get_key` / `list_keys` / `pool_summary` / `rotate`）改走 Postgres session。
- [ ] 4.3 **加密写入路径唯一性维持**：全仓对 `api_key` 的 `encrypt_key(...)` 写入
      **仍只允许出现在 `key_service.py` 一处**（结构锁 `official-key-envelope.test.js`
      的「结构锁 2.4」会扫描全仓并判红——**本改动不得破坏它**）。
- [ ] 4.4 `services/model_preset_service.py:1112-1122` 的 Key 回退查询改走 Postgres session。
      **注意**：该回退当前是**死代码**（用 `preset_id` 匹配 `OfficialKey.provider`，
      而 `ModelPreset` 没有 `provider` 列，`models.py:68-87` 逐列确认）⇒
      **本次只改 session 来源，不修这个逻辑缺陷**（属另一条线），但要如实记录。
- [ ] 4.5 `routers/secrets.py` 的 7 处注入点改用 `get_pg_db()`。
- [ ] 4.6 **Fernet 解密能力留在 Python 侧**（design.md D4）：`decrypt_key()` 不动，
      `key_service.py` 读 Postgres 里的 Fernet 密文照常解密。

## 5. 双写 → 切读 → 停写

- [ ] 5.1 **S1**：Postgres 建表 + 数据 COPY（Fernet 密文**原样**）。
- [ ] 5.2 **S2 双写**：写 Postgres 主 + SQLite 镜像写。
      **写 Postgres 失败 ⇒ 整笔写失败**，不静默只写 SQLite（design.md D6）。
- [ ] 5.3 **S3 切读**：读 Postgres；SQLite 只写不读。
      **读 Postgres 失败 ⇒ 明确报错，不回落 SQLite**（回落会让已熔断的 Key 被重新选中）。
- [ ] 5.4 **S4 停写**：SQLite 侧 `official_keys` 停写、标记只读存档，**表不删**。
- [ ] 5.5 切换窗口：S2/S3 各留 ≥1 个完整业务周期，**期间不得合并任何改动这两条写路径的 PR**。

## 6. 数据校验与巡检

- [ ] 6.1 **行数校验**：`count(Postgres) == count(SQLite)`，不一致即停。
- [ ] 6.2 **逐行可解密**：用当前 `OPS_ENCRYPTION_KEY` 对每行 `decrypt` 成功；
      任一行失败即停，**不得跳过**（"跳过失败行"就是数据丢失）。
- [ ] 6.3 **抽样明文比对**：抽样行解密后逐字节比对（**明文不落盘**）。
- [ ] 6.4 **漂移巡检**：每日比对两库的 `id` 集合与 `updated_at`；
      差异列表可点名行 id。S4 之后改为「Postgres 单源 + SQLite 只读存档」的自洽检查。
- [ ] 6.5 **访问控制清单落地验证**：按 OQ1 的定案，检查
      `official_keys` 表的读权限收敛到位（**这一项要有可复现的验证命令，不接受"已配置"这种描述**）。

## 7. 部署文档与访问控制

- [ ] 7.1 更新部署文档：双库连接的环境变量（Postgres DSN）、`OPS_ENCRYPTION_KEY` 的托管与轮转、
      **Postgres 侧 `official_keys` 的访问控制清单**、备份与只读副本策略、
      9 步部署顺序、回滚步骤（含「S4 之后回滚 = 数据从 SQLite 存档恢复」）。
- [ ] 7.2 更新 `ops-center/docs/PRD.md` 与 `01-docs/PRD-OFFICIAL-COMPUTE-STOPGAP-2026-10-09.md`
      §4.4-1 的「剩余待办」，指向本 change。
- [ ] 7.3 `.quality-gates.md` 执行记录 + `openspec/records/<分支名>.md`
      （**按 2026-10-17 起的现行形态**：状态列写「由门禁推导」、不带 `sync_*` 三字段、不开回填 PR）。
- [ ] 7.4 归档三同步：`openspec archive` + CCG task 归档 + 质量节拍复盘/learnings。

## 8. 明确不做（Non-Goals，防止顺手扩大）

- [ ] 8.1 **不做重加密**（Fernet → AES-256-GCM）：属 `compute-key-envelope-migration` 第 4/5 组。
      两处都改同一批数据，混在一起出问题无法归因。
- [ ] 8.2 **不删 SQLite 侧 `official_keys` 表**：它是 S4 之后的回滚退路。
- [ ] 8.3 **不迁 ops-center 其余表**：它们不需要跨库事务，整体迁会放大爆炸半径。
- [ ] 8.4 **不建 key-broker HTTP 服务**：那会把原子性永久降级为最终一致（design.md D1③）。
- [ ] 8.5 **不改对外密钥 API 契约**：仍只返回掩码。
- [ ] 8.6 **不改客户端**：客户端始终拿不到官方 Key。
- [ ] 8.7 **不修 `model_preset_service.py` 的 Key 回退死代码**（见 4.4）：属另一条线，
      本次只改 session 来源。
- [ ] 8.8 **不在本 change 里做 reserve / settle**：那是 `compute-key-envelope-migration` 的范围，
      且依赖本 change 完成。
