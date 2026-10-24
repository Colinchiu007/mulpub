# Proposal: official-keys-postgres-migration（官方 Key 池迁入 Postgres —— 让信封表的外键能成立）

> **状态**：待评审（Phase 1 决策层产物，**未动手**）
> 关联：`openspec/changes/compute-key-envelope-migration`（本 change 是它的第 3 组前置）
> 关联文档：`01-docs/HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md` §附录 B（Key 池物理归属，运营方 2026-10-11 拍板 D1 = A）
> 取证基线：`Colinchui007/mulpub` @ `1af2b43dd565`（main，2026-10-23）

---

## Why

`compute-key-envelope-migration` 的第 3 组（表结构与迁移文件）**卡在一个硬前提上**：

> 它的 tasks 3.1 要求建表 `official_key_envelopes(key_id UNIQUE **FK → official_keys.id
> ON DELETE CASCADE**, ...)`，
> **而 `official_keys` 这张表不在 Postgres 里。**

| 事实 | 证据 |
|---|---|
| `official_keys` 定义在 ops-center | `ops-center/backend/models.py:116-136`（`class OfficialKey(Base)`，`__tablename__ = "official_keys"`） |
| ops-center 用 **SQLite** | `ops-center/backend/database.py:8-11` `sqlite+aiosqlite:///{settings.db_path}`；`config.py:47` `db_path = "data/config.db"` |
| ops-center **无 Postgres 驱动** | `ops-center/backend/requirements.txt:11` 只有 `sqlalchemy[asyncio]`，无 `asyncpg` / `psycopg` |
| Postgres 侧**无该表** | `packages/api-publish-engine/src/auth/postgres-identity-repository.js` 的 `SCHEMA` 数组共 11 张表（`identity_users` / `identity_entitlement_snapshots` / `identity_subscriptions` / `identity_entitlement_usage` / `identity_webhook_events` / `identity_user_sessions` / `identity_orders` / `identity_redeem_codes` / `identity_notifications` / `cloud_accounts` / `cloud_account_tombstones`），**无 `official_keys`** |
| 迁移目录同样没有 | `migrations/postgresql/` 只有 `002`–`006`，无 `official_keys` 建表语句 |

**⚠️ 另有一处更根本的事实（2026-10-25 实测订正）**：
`official_keys` 与 `model_usage_daily` 住在 **ops-center 进程的 SQLite**
（`ops-center/backend/models.py:116` / `:217`；`ops-center.service` 只有 `OPS_DB_PATH`，**零 Postgres 配置**），
而权益/订单/迁移台账在 **api-publish-engine 进程的 Postgres**；桌面端**分别连这两个服务**
（`config/identity-public.json` 的 `businessApiUrl` 与 `opsCenterUrl`）。
⇒ **这不是「同仓换库」，是「把两个进程都要用的表，从一个进程的库搬到另一个进程的库」**（design.md D13）。

> **同步机制已澄清（此前两次都判反了）**：独立仓 `Colinchui007/ops-center` 已于 **2026-08-10 通过 git subtree
> 并入 mulpub（PR #475）并冻结为只读归档**（tag `archived-into-multi-publish`）；
> `deploy.sh:17-24` 现在从 `mulpub.git` **sparse-checkout `ops-center/`** 部署 ⇒ **落地对象一直是 monorepo，
> 每次部署都是最新代码，不存在同步问题**。
> ⚠️ 但 `docs/ops-center-ecs-deployment.md:35` 仍写着旧话（要求「必须确认两者同步机制」）⇒ **部署文档是真漂移**，本 change 一并订正。
**⇒ 现在落那个信封迁移文件会在部署时炸**：
`relation "official_keys" does not exist` ⇒ 迁移失败 ⇒
`postgres-identity-repository.js` 的 `assertReady`（`allowPending:false`）硬失败 ⇒
`publish-api-server.js` 打 `MEMBERSHIP_UNAVAILABLE` ⇒ **会员中心整体降级**。

**本 change 解决的就是这一步**：把 `official_keys` 搬进 Postgres，成为**单真源**，
让「服务端原子读 Key 状态」与「信封表的外键」两个需求同时成立。

---

## What Changes

- **新增**：Postgres 侧的 `official_keys` 表（15 列，与 SQLite 侧同构）+ 迁移文件。
- **新增**：ops-center 的**双库连接**（SQLite 保留给其余配置表，Postgres 承载 `official_keys`）。
- **修改**：ops-center 的 `OfficialKey` ORM 类改绑 Postgres 的 `DeclarativeBase`；CRUD 与
  `/model-presets/{id}/test` 的 Key 回退路径改走 Postgres session。
- **修改**：api-publish-engine 的 `SCHEMA` 数组与 `REQUIRED_SCHEMA_RELATIONS` 增列，
  使本地开发环境与启动门禁都能看见这张表。
- **删除**：SQLite 侧 `official_keys` 的**写入路径**（表保留为只读存档，不删）。
- **不改变**：对外 API 契约（`GET /api/v1/secrets/*` 仍只返回掩码，客户端依旧拿不到官方 Key）。
- **不改变**：**加密形态**。Fernet 密文**原样 COPY**，本 change 不做任何重加密。

---

## 为什么「只搬表、不重加密」

重加密是 `compute-key-envelope-migration` 的职责（它的第 4/5 组）。

**把两件事解耦，各自可独立验证**：

```
① official-keys-postgres-migration（本 change）
   纯搬家：表 + 数据 + 连接管理 + 双写切读。Fernet 密文不动 ⇒ ops-center 解密能力不变。
        ↓
② compute-key-envelope-migration 的第 3/4/5 组
   建信封表 + 存量重加密 Fernet → AES-256-GCM + 跨语言对拍。
        ↓
③ 服务端代理用 Node 侧信封模块解开 Key（F3 死结闭合）
```

**顺序不能反**：信封表带 FK ⇒ `official_keys` 必须先在 Postgres。

---

## 影响面

| 层 | 影响 |
|---|---|
| **api-publish-engine** | `postgres-identity-repository.js`：`SCHEMA` 数组 + `REQUIRED_SCHEMA_RELATIONS` 增 `official_keys`；新增迁移文件 |
| **ops-center** | `models.py`（`OfficialKey` 换 Base）、`database.py`（第二个 engine + session 工厂 + `get_pg_db()`）、`services/key_service.py`（CRUD 换 session）、`services/model_preset_service.py`（Key 回退换 session）、`routers/secrets.py`（7 处注入点）、`requirements.txt`（加驱动） |
| **迁移** | 新增 `migrations/postgresql/00X_official_keys.sql`（编号见 tasks 1.1） |
| **部署** | 主密钥 `OPS_ENCRYPTION_KEY` 位置不变；**Postgres 的访问控制清单需扩充**（见 D9） |
| **客户端** | 零改动 |
| **落地对象** | **monorepo 的 `ops-center/`**（唯一开发源；`deploy.sh` 从 `mulpub.git` sparse-checkout 部署，design.md D13） |
| **跨库边界** | `official_keys` / `model_usage_daily` 从 **ops-center 的 SQLite** 迁到 **api-publish-engine 的 Postgres** ⇒ 需跨服务搬运通道 + ops-center 引入第二个库连接（D16 的 `database_pg.py`） |

---

## 与 compute-key-envelope-migration 的编号协调

**本 change 与它都要在 `migrations/postgresql/` 里加文件，编号会撞。**

- 本 change 需要一个号给 `official_keys` 建表；
- `compute-key-envelope-migration` 需要一个号给 `official_key_envelopes` 建表。

**本 change 优先**（它是前置），信封表顺延。**具体编号不得凭规格写下时的印象决定** ——
按 2026-10-23 起生效的 AGENTS.md「迁移编号的唯一性纪律」，
**落库前必须 `ls migrations/postgresql/` 现查**，且**加文件与执行必须同批部署**。

---

## 明确不做（Non-Goals）

- **不做重加密**（Fernet → AES-256-GCM）：属 `compute-key-envelope-migration`。
- **不改对外密钥 API 契约**：仍只返回掩码。
- **不删 SQLite 侧的 `official_keys` 表**：保留为只读存档，是回滚的唯一退路。
- **不把 ops-center 整体迁到 Postgres**：其余配置表不需要跨库事务。
- **不做 Key 轮换 / 池化调度**：属供给链路另一条线。
- **不改桌面端**：客户端始终拿不到官方 Key。

---

## 原未决问题（2026-10-24 已定案）

> 三个问题全部按推荐收口，**不再阻塞实施**。

| # | 问题 | **定案** | 理由 |
|---|---|---|---|
| **OQ1** | **Postgres 的访问控制清单**：Fernet 密文迁进 Postgres ⇒ 密钥材料的暴露面从「一个 SQLite 文件」扩大到「一个库 + 其备份 / 只读副本 / 导出」 | ① **数据导出必须剔除 `official_keys` 表**（导出通常无权限管控，最易外流）<br>② **表级读权限**：只允许 ops-center 的 Key 管理面账号 SELECT；**禁止**新建 superuser 或超出表 owner 的宽权限账号<br>③ **属主**：与 ops-center 服务账号同权限级，不额外提权<br>④ **备份链路**：按现有 Postgres 库策略走，但**部署文档必须登记**「本库含密钥材料密文」<br>⑤ **SQLite 侧现状补测**：`stat -c %a data/config.db` 取实际权限并登记（`ops-center.service` 无 `UMask=`、无 chmod 600） | 密文从 SQLite 挪到 Postgres **不是新增攻击面**（两者都是「密文 + 主密钥 = 明文」）。差别只在**数据流向变多**。<br>⚠️ **评审指出「沿用现有权限模型」无可沿用之物** —— 全仓 `.sql` **零条 GRANT / CREATE ROLE** ⇒ 判据已从「沿用」改为**五条可核对的判据**。 |
| **OQ2** | **ops-center 的第二个连接用 `asyncpg` 还是 `psycopg[binary]`**？ | **`psycopg[binary]`**（PostgreSQL 官方维护） | ⚠️ **原提案写「`asyncpg` 无 C 扩展依赖、psycopg 需编译工具链」是错的** —— `psycopg[binary]` 那个 extra **正是为「不想编译」准备的**，两者都无需编译工具链。<br>且「与 Node 侧生态一致」也错（Node 侧用的是 `pg`，不是 asyncpg）。<br>**真实理由**：① 官方维护，长期无兼容风险；② SQLAlchemy 文档默认推荐；③ `binary` extra 带预编译 wheel，ECS 上 `pip install` 免编译；④ 补版本上下界 + 确认 `check-dep-audit.js` 门禁兼容；⑤ `psycopg` 与 `psycopg-binary` 两个包都要写入。 |
| **OQ3** | **SQLite 侧 `ensure_official_key_columns` 运行时 ALTER 的处置** | **保留函数，但迁移完成后不再调用** | 保留一个**不调用的**函数零成本；删掉后想恢复只能改代码发版。<br>Postgres 侧的表由**迁移文件**建，4 个补列直接含在表定义里（tasks 2.2），**不依赖运行时 ALTER**。 |

## 验收

1. `ls migrations/postgresql/` 确认目标编号未被占，且与 `compute-key-envelope-migration` 的编号分配不冲突；
2. 迁移执行后：Postgres 行数 = SQLite 行数，**逐行 Fernet 解密成功**（用当前 `OPS_ENCRYPTION_KEY`）；
3. ops-center 的 `/api/v1/secrets/*` 全量 CRUD 功能不变（前端零改动即证明）；
4. `/api/v1/model-presets/{id}/test` 的 Key 回退路径功能不变；
5. SQLite 侧 `official_keys` 只读存档完好，**回滚路径可用**；
6. **跨库表示等价**：除 `api_key` 外 17 列在两库间原始值逐列一致（design.md D18 第四层）；
7. **熔断信息确实随表迁移**：`is_active` 在 Postgres 侧可读到且与迁移前一致（这是「不回落 SQLite」这条防线成立的前提）。

> ⚠️ **原验收 5/6（`reserve` 选到 Key / 熔断 ≤1s 生效）已移出本 change**（评审 C9）：
> `reserve` 属信封 change 的第 3 组及之后，本 change 落地时它**还不存在**，
> 把「验收必须包含一个尚不存在的功能」写进本 change 是自相矛盾。
> 这两条验收归到 `compute-key-envelope-migration`。
