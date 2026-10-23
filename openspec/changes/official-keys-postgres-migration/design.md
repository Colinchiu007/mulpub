# Design Note: official-keys-postgres-migration（DN-OFFICIAL-KEYS-PG-001）

> **创建**：2026-10-23 ｜ **状态**：**提案（待评审）**
> **触发问题**：`compute-key-envelope-migration` 第 3 组的信封表外键指向 `official_keys(id)`，
> 而该表在 ops-center 的 SQLite 里 ⇒ **FK 建不出来 ⇒ 落迁移文件会在部署时炸**
> （`relation "official_keys" does not exist` ⇒ `assertReady` 硬失败 ⇒ 会员中心整体降级）。
> **关联**：`openspec/changes/compute-key-envelope-migration/`（design.md D1–D12、tasks 3.1）；
> `01-docs/HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md` §附录 B（运营方 2026-10-11 拍板 D1 = A）。

---

## D1 · 迁到 Postgres，但**只搬这一张表**（ops-center 保持双库）

| 方案 | 做法 | 判断 |
|---|---|---|
| ① 整体迁 ops-center | ops-center 的 SQLite → Postgres | ❌ **否决**。其余表（`config` / `feature_flag` / `model_presets` / `content_policy` / `licenses` / `redeem_codes` …）**不需要跨库事务**，整体迁把爆炸半径从一张表放大到整个管理面 |
| ② **只搬 `official_keys`，ops-center 双库** | SQLite 保留给其余表，Postgres 承载 Key 池 | ✅ **选此**。`official_keys` 是**唯一一个需要被 Node 原子读**的表；其余表的跨库需求为零 |
| ③ Key 池拆独立密钥服务 | Node 通过 HTTP 要 Key | ❌ **否决**。这正是交接文档附录 B 花整段论证要排除的跨服务依赖：原子性永久降级为最终一致，且熔断要等一个此前不存在的在线依赖 |

**双库的代价要说清楚**：ops-center 从此有两个连接、**跨库事务不可用**。
⇒ 写死约束：**今后不得设计任何「同时写 `official_keys` 与 SQLite 表」的操作**。
当前无此类操作（`key_service.py` 的写路径是单表 CRUD），故不构成现实缺口。

## D2 · 迁移形态：建表 → 双写 → 切读 → 停写（**不是一次性切换**）

| 阶段 | 动作 | 可回滚性 |
|---|---|---|
| **S1** | Postgres 建 `official_keys` 表 + 迁移文件；数据 COPY（Fernet 密文**原样**） | ✅ 删表即可 |
| **S2** | ops-center **双写**：Postgres 主写 + SQLite 镜像写 | ✅ 回滚代码即恢复单写 |
| **S3** | ops-center **切读**：读 Postgres，SQLite 只写不读 | ✅ 回滚代码即恢复读 SQLite |
| **S4** | **停 SQLite 写**，该表标记只读存档；**不删表** | ✅（表还在，数据没丢） |

**为什么不一次性切换**：S2/S3 期间若发现数据不一致，可以只回滚代码而不用重建数据。
**S4 之后 SQLite 表必须保留** —— 它是回滚路径的唯一退路（删了就只能从备份恢复）。

## D3 · Fernet 密文原样 COPY（本 change **不动密码学**）

**重加密是 `compute-key-envelope-migration` 的第 4/5 组。**

本 change 只搬家 ⇒ 密文原样 ⇒ **ops-center 的解密能力全程不变**（Python 侧 `key_service.py` 的
`decrypt_key()` 照常工作）。

**这不是省事，是解耦**：两个 change 各自有独立的失败模式与回滚路径。
若把搬家与重加密混在一个 PR 里，一旦出问题，无法判断是「搬错了」还是「加错了」。

> ⛔ **不得**在本 change 里「顺手」把 Fernet 换成信封格式 —— 那会与
> `compute-key-envelope-migration` 的第 5 组（存量迁移 CLI）撞车，两处都在改同一批数据。

## D4 · Fernet 解密能力**留在 Python 侧**（本 change 不解决 F3）

`key_service.py:57` 的 `decrypt_key()` 是**全仓唯一的 Fernet 实现**。
本 change 完成后：

- ops-center（Python）继续能解开 Fernet ✅
- **Node 侧仍然解不开** ❌ —— 这正是 `compute-key-envelope-migration` 要解决的

**⇒ 本 change 只解决「表在哪个库」，不解决「谁能解密」。** 两者必须分开表述，
否则评审会误以为本 change 闭合了 F3。

## D5 · ops-center 的双库连接管理

| 动作 | 细节 |
|---|---|
| 新增第二个 engine | `create_async_engine(BUSINESS_DATABASE_URL, ...)`，与现有 SQLite engine **并列**，不替换 |
| 新增 session 工厂 | `async_sessionmaker(pg_engine)`，与现有 `get_db()` 并列 |
| 新增依赖注入 | `get_pg_db()`（FastAPI `Depends`），与 `get_db()` 并列 |
| **`OfficialKey` 必须换 DeclarativeBase** | 一个 ORM 类**不能绑两个库**。需为 Postgres 侧建独立 Base（或独立 metadata），`OfficialKey` 挂到它下面 |
| `Base.metadata.create_all` 的归属 | `database.py:31` 那句会**把 Postgres 的表顺手建到 SQLite 里** ⇒ 必须把两边的 metadata 分开，`create_all` 各自只对自己的 engine |
| 驱动 | `asyncpg`（倾向，见 proposal OQ2） |
| 启动顺序 | 两个 engine 都要在 startup 建好；**Postgres 连接失败时的行为需定义**（fail-closed 还是回落 SQLite？）⇒ 见 D6 |

## D6 · 迁移期与切换期的**失败语义**（必须显式定义，不能靠默认）

| 场景 | 必须的行为 | 理由 |
|---|---|---|
| S2 双写时 Postgres 不可用 | **写 Postgres 失败 ⇒ 整笔写失败**，不静默只写 SQLite | 否则 Postgres 与 SQLite 漂移，且熔断在 Postgres 侧失效 |
| S3 切读后 Postgres 不可用 | **读 Postgres 失败 ⇒ 明确报错**，**不回落 SQLite** | 回落会让「已熔断的 Key 又被选中」——熔断失效是安全问题，不是可用性问题 |
| S4 停写后 Postgres 不可用 | 同上 | 同上 |

> **熔断的即时性优先于可用性。** 一个被 `is_active=0` 熔断的 Key 因为 Postgres 抖动被重新选中，
> 后果是**真实的上游调用 + 真实的钱**。这是本 change 唯一一处**主动选择 fail-closed** 的地方，
> 必须写进运维文档。

## D7 · SQLite 侧旧表的处理：**只读存档，不删**

- **不删表**：它是 S4 之后的回滚退路。
- `ensure_official_key_columns`（`key_service.py:140-166`）**保留函数但不再调用**：
  它只 ALTER SQLite 表；停写后 SQLite 的 schema 漂移已无实际影响。
  **但不能直接删函数** —— 存量 SQLite 库若缺列，删了函数就再没人补，运维工具会踩。

## D8 · 迁移编号：**本 change 优先占号**

本 change 与 `compute-key-envelope-migration` 都要在 `migrations/postgresql/` 加文件。

**分配**：本 change（前置）先占低位号，信封表顺延到下一号。

**但具体号不得凭规格写下时的印象决定** —— 按 2026-10-23 起生效的 AGENTS.md
「迁移编号的唯一性纪律」：
1. 落库前 `ls migrations/postgresql/` **现查**；
2. **加文件与执行必须同批部署**（`allowPending:false` 的直接推论，拆成两个 PR 中间每次启动都硬失败）；
3. 编号分配要写进 tasks 1.x，并**在两个 change 之间对齐**。

## D9 · 安全：Fernet 密文进 Postgres ⇒ **暴露面扩大**

| 变化 | 前 | 后 |
|---|---|---|
| 密钥材料所在 | 一个 SQLite 文件（`data/config.db`） | 一个 Postgres 库（外加其备份 / 只读副本 / 快照） |
| 读权限 | 该文件的读权限 | **该表的读权限 + 该库的备份链路** |

**这不等于"更不安全"**（两者都是"拿到就能解密"），但**需要显式的访问控制清单**：

- 谁能读 `official_keys` 表？（最小化：仅 ops-center 的 Key 管理面 + 迁移作业）
- Postgres 的备份谁保管、加密与否？
- 只读副本 / 逻辑导出是否需要脱敏？
- 审计日志里会不会出现 Fernet 密文本身？（不应）

**⇒ 这些必须写进部署文档，并在 OQ1 里由部署方确认。**
本 change **不新增任何明文落点**（Fernet 密文在 Postgres 里仍是密文）。

## D10 · 迁移的数据校验（三层，逐层可独立失败）

1. **行数**：`count(Postgres) == count(SQLite)`
2. **逐行可解密**：用**当前** `OPS_ENCRYPTION_KEY` 对每行 `decrypt` 成功
   （**迁移前置**：先确认该 key 已固定 —— `key_service.py:22-36` 有一条
   `OPS_ALLOW_EPHEMERAL_KEY` 分支会在 key 缺失时**每次重启 generate 新密钥**，
   那样"已加密的 Key 永久不可解"）
3. **抽样明文比对**：抽样行解密后逐字节比对（不落盘）

## D11 · api-publish-engine 侧要改什么（**不多**）

| 位置 | 改动 | 为什么 |
|---|---|---|
| `postgres-identity-repository.js` 的 `SCHEMA` 数组 | 增 `official_keys` 建表语句 | 非生产环境走 `initialize()` 建库（`:273`），不补则本地开发环境缺表 |
| 同文件 `REQUIRED_SCHEMA_RELATIONS`（`:8-21`） | 增 `official_keys` | 启动门禁要看见这张表，否则缺表时启动不报错、到运行时才炸 |
| `migrations/postgresql/` | 新增迁移文件 | 建表 + 索引 |

**不涉及**：权益扣减、快照形状、任何 feature 名。`official_keys` 不是权益维度。

## D12 · 与 compute-key-envelope-migration 的**验收边界**

| 需求 | 由谁满足 |
|---|---|
| 「信封表有 FK 可指」 | **本 change**（`official_keys` 进 Postgres） |
| 「信封表能建」 | 信封 change 第 3 组 |
| 「Node 能解开官方 Key」 | 信封 change 第 2 组（已落地）+ 第 5 组（存量重加密） |
| 「reserve 能原子读 Key 状态」 | 两边都到位后成立（**本 change 单独不成立**） |

⇒ **本 change 的验收不得包含「reserve 选到 Key」** ——
`reserve` 还不存在（信封 change 的第 3 组才有）。
本 change 的验收只到「**Key 状态在 Postgres 里，且 Node 侧可读（未被熔断的能查到）」**。
