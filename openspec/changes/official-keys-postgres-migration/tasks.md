# Tasks: 官方 Key 池迁入 Postgres

> 实现进度以本文件 checkbox 为**唯一来源**（`openspec status --change official-keys-postgres-migration`）。
> 依赖关系：1 → 2 → 3 → 4 → 5 → 6 → 7；第 8 组随各步同步。
> 配套 change：`compute-key-envelope-migration`（本 change 是其第 3 组的硬前置）。

## 1. 前置固化（本 change 的规格层）

- [x] 1.1 **编号规则定死（评审 C4 订正）**：真正的硬约束不是「撞号」，而是
      **「被 FK 引用方的文件名字典序必须小于引用方」**（`postgres-migrations.js:28` 的 `localeCompare` 排序
      + `:102` 按序执行）。同前缀不同名**共存不报错**（台账锁的是全文件名 + checksum）。
      **本 change 用 `006_official_keys.sql`**（与 `006_payment_orders.sql` 同前缀不同名，
      且 `'o'(official) < 'p'(payment)` ⇒ 先执行 ✅）；信封表用 `007_official_key_envelopes.sql`。
      ⚠️ **我写进 AGENTS.md 的那条纪律（PR #4315「撞号 ⇒ 启动期硬失败」）是误诊，需另开 PR 订正。**
- [ ] 1.2 写明「**加文件与执行必须同批部署**」：`assertReady` 用 `allowPending:false`，
      拆成两个 PR 中间每次启动都硬失败（design.md D8）。
- [x] 1.3 **OQ3 已定案（2026-10-24）**：SQLite 侧 `ensure_official_key_columns` **保留函数但不再调用**
      （design.md D7）。保留一个不调用的函数零成本；删掉后想恢复只能改代码发版。
- [x] 1.4 **OQ2 已定案（2026-10-24）**：第二个连接用 **`psycopg[binary]`**（PostgreSQL 官方维护，
      **无需编译工具链** —— `binary` extra 即为此准备）。⚠️ 原提案「psycopg 需编译工具链」的表述**有误，已更正**。
- [x] 1.5 **OQ1 已定案（2026-10-24）**（design.md D9）：
      ① **数据导出必须剔除 `official_keys` 表**（导出无细粒度权限管控，最易外流）；
      ② **表级读权限沿用现有 Postgres 权限模型**，不新建高权限账号；
      ③ **备份与只读副本按现有库的统一策略走**，但**必须在部署文档登记**「本库含密钥材料密文」。
      注：这不是新增攻击面（密文 + 主密钥 = 明文，SQLite 与 Postgres 同理），差别只在数据流向变多。
- [x] 1.7 **落地对象确认（评审 C5，P1 阻断项）**：`docs/ops-center-ecs-deployment.md:35` 明写 ECS
      克隆自**独立仓 `Colinchiu007/ops-center.git`**，monorepo 的 `ops-center/` 只是镜像。
      **动手前必须确认**：① monorepo ↔ 独立仓 单向还是双向同步？② 谁负责同步、什么节奏？
      ③ 两边的迁移台账 `identity_schema_migrations` 是不是同一个 Postgres 库？
      **未确认前，本 change 的任何实现都是空转。**
- [ ] 1.6 迁移前置（**阻断项**）：**确认生产 `OPS_ENCRYPTION_KEY` 已固定**。
      `key_service.py:22-36` 有一条 `OPS_ALLOW_EPHEMERAL_KEY` 分支会在 key 缺失时
      **每次重启 generate 新密钥** ⇒ 已加密的 Key 永久不可解（design.md D10 第 2 层）。
      **未确认前不得开始迁移。**
      ⚠️ **判据升级（评审 C6）**：`key_service.py:41-48` 的 `except (ValueError, Exception)` 会**静默 sha256 派生**
      一个新 key 并**改写** `settings.encryption_key` ⇒ 「key 存在」**不等于**「key 正确」。
      **必须核对：用这个 key 能解出现存至少一条 Fernet 密文**（round-trip），而不是只看它配没配。

## 2. 迁移文件与建表

- [ ] 2.1 新增 `migrations/postgresql/006_official_keys.sql`：建表 `official_keys`，
      **共 17 列**（`ops-center/backend/models.py:116-136`；原提案写 15 列是错的——
      `rate_per_minute` / `daily_limit` / `alert_threshold_cost` / `note` 是运行时补的），
      **必须给出完整 PG DDL：每列的类型 + DEFAULT + NOT NULL**（评审 C8）。
      ⚠️ **`models` 列必须用 `TEXT`（存 JSON 字符串），不得用 `jsonb`** —— `key_service.py` 走
      `json.loads(key.models)`，传 dict 会 TypeError ⇒ 列表页 100% 500。
      ⚠️ **`expires_at` 必须用 `TEXT`**（现状是字符串字典序比较），不得用 `date`/`timestamp`。
      ⚠️ **`created_at` / `updated_at` 必须用 `TEXT`**（现状是 naive ISO 字符串），
      不得用 `timestamptz`（naive 值按会话 TimeZone 静默偏移 ⇒ 漂移巡检永红）。
      ⚠️ **所有 `default=` 是应用层默认值，DB 侧没有 DEFAULT 且列 nullable** ⇒
      迁移时若不显式给值，这些列会变 NULL，而选 Key 的谓词
      `is_active == 1` / `tier_access <= tier_access` 在 NULL 下是 NULL ⇒ **一行都选不中且不报错**。
      **⇒ 迁移文件必须为这 10 列显式写 DEFAULT + NOT NULL。**
      原始 15 列表述：
      含 `provider` / `name` / `api_key` / `base_url` / `models` / `priority` / `is_active` /
      `tier_access` / `cost_per_1k_tokens` / `expires_at` / `rate_per_minute` / `daily_limit` /
      `alert_threshold_cost` / `note` / `created_at` / `updated_at`。
- [ ] 2.2 **补齐 SQLite 侧运行时 ALTER 补过的那 4 列**：`rate_per_minute` / `daily_limit` /
      `alert_threshold_cost` / `note`（`key_service.py:140-166`）——
      新表必须直接含这 4 列，**不得依赖运行时 ALTER**。
- [ ] 2.3 选 Key 索引：`CREATE INDEX ON official_keys (is_active, tier_access, priority)`。
      ⚠️ **`priority` 现状排序是 ASC**（`key_service.py:306` 与 `:373`）⇒ 索引按现状来，
      **不要**写成 DESC（原提案写 DESC 且未说明理由，评审 X3 判定与现状相反）。
      ⚠️ **不得**以 `get_active_keys_for_tier`（`key_service.py:360`）作索引依据——
      该函数**生产引用数为 0**（只有测试引用），评审 X2 已复核。
      （`tier_access` 语义见 `models.py:127`：1=all tiers / 2=standard+ / 3=pro only）
- [ ] 2.4 **表结构与 SQLite 侧逐列对照**：列名、默认值、空值性、CHECK 约束逐列核对，
      写一份对照表进执行记录。**不允许「大体一样」**——列名大小写/默认值差异会在
      Python 侧 `KeyRow` 映射时静默变成 `None`。
- [ ] 2.5 迁移单测：`discoverMigrations` 能识别该文件名（匹配 `MIGRATION_PATTERN`）；
      对已应用台账做一次 checksum 校验通过。
- [ ] 2.6 迁移幂等：`CREATE TABLE IF NOT EXISTS` + `INSERT ... ON CONFLICT DO NOTHING`，
      重复执行零副作用（data 段必须幂等，否则重跑会炸）。

## 3. ops-center 双库连接

- [ ] 3.1 `requirements.txt` 加 **`psycopg[binary]`**（OQ2 定案）。
- [ ] 3.2 **新增 `database_pg.py`**（专管 Postgres）：`create_async_engine` + `async_sessionmaker` + `get_pg_db()`，
      **与现有 SQLite engine 并列，不替换**。**不在一个文件里塞两个 engine**（`create_all` 的归属会含混，见 3.3）。
- [ ] 3.3 **两个 `Base` 必须分开，且 `database.py` 拆成两个模块**（评审 C3）：
      一个 ORM 类不能绑两个库 ⇒ Postgres 侧建独立 `DeclarativeBase` / `metadata`。
      **`database.py` 保持只管 SQLite**（它有 `PRAGMA journal_mode=WAL` 等 SQLite 专属语句，
      `database.py:24-26`），**新增 `database_pg.py`** 专管 Postgres —— 不在一个文件里塞两个 engine。
      ⚠️ **Postgres 侧不得跑 `create_all`**：那会让表被建出来却**没有迁移台账记录** ⇒
      `assertReady`（`allowPending:false`）看到「有表无台账」⇒ `MIGRATION_PENDING` 行为诡异。
      **Postgres 侧只认迁移文件。**
- [ ] 3.4 新增 `get_pg_db()`（FastAPI `Depends`），与 `get_db()` 并列。
- [ ] 3.5 启动顺序：两个 engine 都在 startup 建好；
      **Postgres 连接失败时的行为依 design.md D6 定义（fail-closed）**，并出声。
- [ ] 3.6 **连接池参数显式化**：SQLite 侧是默认 `pool_size=5 / max_overflow=10`；
      Postgres 侧 SHALL 显式给 `pool_size` / `max_overflow` / `pool_pre_ping` / `pool_recycle`，
      **不得**沿用默认值（默认值是给 SQLite 那种轻量场景调的）。
- [ ] 3.7 **关停清理**：`main.py:66-67` 现在只有一行日志、**无 `engine.dispose()`** ⇒
      两个 engine 都要在 shutdown 时 dispose，否则连接池泄漏（长跑进程才显形）。
- [ ] 3.8 **`/health` 必须加 PG 探针**（评审 MAJOR）：`main.py:150-152` 的 `/health` 是**静态**
      `{"status":"ok"}`，`health_service.py:200` 的 `check_db(db)` 只探 SQLite ⇒
      **Postgres 挂了两个健康面都绿**；而 `docs/ops-center-ecs-deployment.md:110` 的部署自检
      就是 `curl /health` ⇒ **「连不上库」会被判成「部署成功」**。
- [ ] 3.9 **SQLite 侧权限基线补测**：`ops-center.service` **无 `UMask=`、无 chmod 600** ⇒
      `stat -c %a data/config.db` 取当前实际权限并登记进部署文档（OQ1⑤）。
- [ ] 3.10 **删除 `ensure_official_key_columns` 的调用点**（OQ3 的落地动作，评审指出缺失）：
      `main.py:15`（import）+ `main.py:45`（启动调用）是**唯二**调用点 ⇒
      删掉这两处，**函数本身保留**（存量 SQLite 库缺列时运维仍可手工调用）。

## 4. ORM 与 CRUD 切库

- [ ] 4.1 `models.py`：`OfficialKey` 换绑 Postgres Base（**不删 SQLite 侧声明**——
      存档期还要读它做回滚核对）。
- [ ] 4.2 `services/key_service.py`：CRUD（`create_key` / `update_key` / `delete_key` /
      `get_key` / `list_keys`）改走 Postgres session。
      ⚠️ **无 `rotate` 方法**（原提案写错，`key_service.py` 里不存在该函数）。
      ⚠️ **`pool_summary` 单独处理**（评审 C1）：它查 `OfficialKey`(PG) + `ModelUsageDaily`
      同一 session ⇒ 拆两段读（PG 段 + SQLite 段），**不要求跨库事务**。
- [ ] 4.3 **加密写入路径唯一性维持**：全仓对 `api_key` 的 `encrypt_key(...)` 写入
      **仍只允许出现在 `key_service.py` 一处**（结构锁 `official-key-envelope.test.js`
      的「结构锁 2.4」会扫描全仓并判红——**本改动不得破坏它**）。
- [ ] 4.4 `services/model_preset_service.py:1112-1122` 的 Key 回退查询改走 **Postgres session**，
      而同函数 `:1097` 读 `ModelPreset` 仍走 **SQLite session** ⇒ **两段独立 session**（评审 C2）。
      **禁止**试图用一个 session 跨两个库。
      **注意**：该回退当前是**死代码**（用 `preset_id` 匹配 `OfficialKey.provider`，
      而 `ModelPreset` 没有 `provider` 列，`models.py:68-87` 逐列确认）⇒
      **本次只改 session 来源，不修这个逻辑缺陷**（属另一条线），但要如实记录。
- [ ] 4.5 `routers/secrets.py` 的 7 处注入点改用 `get_pg_db()`。
- [ ] 4.6 **Fernet 解密能力留在 Python 侧**（design.md D4）：`decrypt_key()` 不动，
      `key_service.py` 读 Postgres 里的 Fernet 密文照常解密。
      ⚠️ **session 绑错库必须显式失败**（评审 MAJOR）：`key_service.py:286,345` 的 `db.refresh()`
      在库绑错时**不报错，只静默返回全 None 字段** ⇒ 补断言：写后回读若关键字段为 None 即失败。
      ⚠️ **可写字段须为显式清单**：`key_service.py:341` 的 `setattr(item, field, value)` 由 HTTP body
      的字段名驱动（`routers/secrets.py:108`）⇒ 任意 body 字段会被静默丢弃。
      **必须有一份「允许写入的字段」白名单**（tasks 2.4）。
- [ ] 4.7 **认领既有测试文件**（评审 C7）：`tests/test_key_service.py:19-27` 等 **6 个** fixture
      用 `Base.metadata.create_all` + `from models import OfficialKey` ⇒ 换 Base 后必红。
      **本 change 必须同时改这些 fixture**（拆双 Base / 显式建表），不得留红。

## 5. 双写 → 切读 → 停写

- [ ] 5.1 **S1**：Postgres 建表 + 数据 COPY（Fernet 密文**原样**）。
- [ ] 5.2 **S2 双写**：写 Postgres 主 + SQLite 镜像写。
      **写 Postgres 失败 ⇒ 整笔写失败**，不静默只写 SQLite（design.md D6）。
      **SQLite 镜像写失败 ⇒ 主写已成功 ⇒ 记 warn + 计数，不回滚主写**（回滚会丢真实更新，
      且 SQLite 存档是**回滚退路**，不能被主写的失败反向污染）——评审 C10 要求补这一方向。
      「两库一致」纳入 6.5 的漂移巡检。
- [ ] 5.3 **S3 切读**：读 Postgres；SQLite 只写不读。
      **读 Postgres 失败 ⇒ 明确报错，不回落 SQLite**（回落会让已熔断的 Key 被重新选中）。
- [ ] 5.4 **S4 停写**：SQLite 侧 `official_keys` 停写、标记只读存档，**表不删**。
- [ ] 5.5 切换窗口：S2/S3 各留 ≥1 个完整业务周期，**期间不得合并任何改动这两条写路径的 PR**。

## 6. 数据校验与巡检

- [ ] 6.1 **行数校验**：`count(Postgres) == count(SQLite)`，不一致即停。
- [ ] 6.2 **逐行可解密**：用当前 `OPS_ENCRYPTION_KEY` 对每行 `decrypt` 成功；
      任一行失败即停，**不得跳过**（"跳过失败行"就是数据丢失）。
- [ ] 6.3 **抽样明文比对**：抽样行解密后逐字节比对（**明文不落盘**）。
- [ ] 6.4 **跨库表示等价校验（第四层，评审 C8）**：除 `api_key` 外**全部 17 列**
      在两库间做**原始值逐列比对**（不是语义比对）⇒ 类型选错（`jsonb` / `date` / `timestamptz`）
      会在这一步被抓住，而不是等到运行时 500。
- [ ] 6.5 **漂移巡检**：每日比对两库的 `id` 集合与 `updated_at`；
      差异列表可点名行 id。S4 之后改为「Postgres 单源 + SQLite 只读存档」的自洽检查。
- [ ] 6.6 **访问控制清单落地验证**（OQ1 定案）：
      ① 验证**数据导出链路**确实剔除了 `official_keys` 表（**要有可复现的验证命令，不接受「已配置」这种描述**）；
      ② 确认部署文档已登记「本库含密钥材料密文」；
      ③ 表级读权限沿用现有模型，**只做核对不新建权限**。

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
