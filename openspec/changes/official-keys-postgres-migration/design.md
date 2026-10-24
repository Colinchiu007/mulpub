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
| 驱动 | **`psycopg[binary]`**（PostgreSQL 官方维护，**无需编译工具链** —— `binary` extra 即为此准备；原提案「psycopg 需编译」的表述有误，已更正，见 proposal OQ2） |
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
- `ensure_official_key_columns`（`key_service.py:140-166`）**保留函数但不再调用**
  （**OQ3 已定案**）：它只 ALTER SQLite 表；停写后 SQLite 的 schema 漂移已无实际影响。
  **但不能直接删函数** —— 存量 SQLite 库若缺列，删了函数就再没人补，运维工具会踩。
  保留一个**不调用的**函数零成本；删掉后想恢复只能改代码发版。

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

**⇒ 这些必须写进部署文档。**

**OQ1 已定案（2026-10-24）**：
1. **数据导出必须剔除 `official_keys` 表** —— 任何定期导出/分析用快照都不得含该表
   （导出通常没有细粒度权限管控，是最容易外流的一路）；
2. **表级读权限沿用现有 Postgres 权限模型**，不为此新建高权限账号；
3. **备份与只读副本按现有 Postgres 库的统一策略走**，但**必须在部署文档登记**
   「本库含密钥材料密文」这一事实。

**注意这不是新增攻击面**：密文从 SQLite 挪到 Postgres，两者都是「密文 + 主密钥 = 明文」；
差别只在**数据流向变多**（备份 / 副本 / 导出 / 日志）。
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

---

## D13 · 落地对象是 **monorepo**（唯一真源）；真正的难点是**跨服务跨库**（评审 C5 订正 + 二次订正）

> ⚠️ **本节经历过两次判反，两次都靠实测推翻**：
> ① 初次结论「生产跑的是独立仓 `Colinchui007/ops-center`，monorepo 只是镜像」；
> ② 评审 C5 采信了它，并引用 `docs/ops-center-ecs-deployment.md:35` 作证。
> **两次都不对。** 下面是实测结论。

### 同步机制：单向、一次性、此后不需要

| 证据 | 内容 |
|---|---|
| 独立仓 `README.md` 首行 | 「**归档说明（2026-08-10）**：本项目已通过 git subtree 正式并入 `Colinchui007/Multi-Publish`（`Multi-Publish/ops-center/`，PR #475）。此后开发/PR/CI 统一在 Multi-Publish 内进行；**本仓库冻结为只读归档**（完整历史保留可追溯）。已打 tag：`archived-into-multi-publish`」 |
| `ops-center/deploy/deploy.sh:14-16` | 「**曾 clone `Colinchui007/ops-center`** —— 该仓库 2026-08-10 已并入 mulpub（git subtree）并归档，**从它 clone 会把 2026-08 的归档快照部署上线**。现统一从 mulpub 取 `ops-center/` 子目录」 |
| `deploy.sh:17-25` | `REPO_URL=mulpub.git`；已存在则 `fetch --depth 1 origin main` + `checkout --force FETCH_HEAD`；否则 `clone --sparse` + `sparse-checkout set ops-center` |
| 独立仓 `pushed_at` | **2026-08-10**（此后未动） |

⇒ **同步方向 = 独立仓 → monorepo，一次性 git subtree 并入；此后独立仓冻结；monorepo 是唯一开发源；
每次部署从 `mulpub` 的 `main` 稀疏检出 `ops-center/` ⇒ 部署的永远是最新代码。**
**没有持续同步机制，因为不需要。**

> ⚠️ **但 `docs/ops-center-ecs-deployment.md:35` 仍写着旧话**（「`deploy.sh` 从 `/root/ops-center`
> （克隆自独立仓 `github.com/Colinchui007/ops-center.git`）拉取部署，而本 monorepo 的 `ops-center/` 目录是其镜像。
> 把本仓的 ops-center 后端改动推上 ECS 前，**必须确认两者同步机制**」）⇒ **部署文档未跟上 `deploy.sh` 的修正，是真漂移**，
> 本 change 一并订正。

### 真正的难点：表要**跨进程、跨数据库**共享

上面澄清了「落地对象」，但**本 change 的核心难度没有消失，只是换了形态**：

| | 位置 | 库 |
|---|---|---|
| `official_keys` | `ops-center/backend/models.py:116` | **ops-center 的 SQLite** |
| `model_usage_daily` | `ops-center/backend/models.py:217` | **ops-center 的 SQLite** |
| `identity_entitlement_usage` / `identity_schema_migrations` / `identity_orders` | `packages/api-publish-engine/` | **api-publish-engine 的 Postgres** |

**ops-center 进程只有 SQLite**：`ops-center.service:11` 只有 `OPS_DB_PATH=/data/ops-center/config.db`；
`config.py:47` 只有 `db_path`；`setup-service.sh:29-33` 写的 env 只有 `OPS_ENCRYPTION_KEY` / `OPS_JWT_SECRET` /
`OPS_SECRET_KEY` / `OPS_CORS_ORIGINS` / `OPS_ADMIN_PASSWORD`；**`.env.example` 只有 `OPS_DB_PATH`**。
⇒ **零 Postgres 配置，ops-center 不连 Postgres。**

**桌面端分别连这两个服务**（`config/identity-public.json`）：

| 配置 | 指向 | 拥有 |
|---|---|---|
| `businessApiUrl = https://auth.iart.work` | api-publish-engine | 会员/权益/订单/兑换码（**Postgres**） |
| `opsCenterUrl = https://www.iart.work/api/ops` | ops-center | 模型目录/配置/密钥/用量看板（**SQLite**） |

⇒ **这不是「同仓换库」，是「把两个进程都要用的表，从一个进程的库搬到另一个进程的库」。** 三个新问题：

1. **谁执行搬运？** 迁移文件与台账（`identity_schema_migrations`）在 api-publish-engine，**数据在 ops-center 的 SQLite**
   ⇒ 需要一条**跨服务通道**：ops-center 导出 → api-publish-engine 落库 + 写台账。
   ⚠️ **密钥材料不得进 git**（迁移文件里只写 schema，数据走受控通道）——本仓既有迁移文件全是纯 schema，无先例可抄。
2. **迁完 ops-center 怎么读？** 官方 Key 的**写**只有 ops-center 一处（`/api/v1/secrets/*`），
   **读**有两处（ops-center 管理页 + api-publish-engine 的服务端代理选 Key）⇒ **两个进程都要能读**。
3. **`model_usage_daily` 同样在 ops-center 的 SQLite**，而成本台账要供 api-publish-engine 的代理写
   ⇒ **它也必须迁**（与信封 change 第 5 组的成本台账同源）。

### 两条路（新的架构决策，需拍板）

| | **路 A：ops-center 直连 Postgres（双库）** | 路 B：ops-center 经 HTTP 调 api-publish-engine 读写（单库） |
|---|---|---|
| 单真源 | ✅ Postgres | ✅ Postgres |
| 原子性 | 天然（同库同事务） | 天然（写入经同一个 API） |
| ops-center 改动 | 加第二个 engine + 两套 Base + **两个跨库读点拆两段** | 改用 HTTP client，**不引入第二个数据库** |
| 与既有设计 | **与 D14③「不建 key-broker」一致，不推翻已有决策** | **推翻 D14③** |
| 失效面 | Postgres 挂 ⇒ ops-center 密钥管理页也挂 | api-publish-engine 挂 ⇒ 同上 |

**⇒ 推荐路 A（双库）**：① 与已定的 D14③ 一致，**不推翻已有决策**；② 官方 Key 的读是**低频管理面操作**；
③ 双库让「Key 列表」这类只读操作有本地副本，api-publish-engine 挂时 ops-center 仍能看（配合 D6 的
`source:"stale-archive"` 降级读）。

**⇒ 代价**：ops-center 引入第二个数据库连接（**这正是 D16 已经写下的 `database_pg.py`**），
且 `pool_summary` / `test_provider_connection` 两个跨库读点必须拆两段（**D14 已写**）。
**⇒ D14 / D16 的技术设计方向成立，但「为什么需要双库」的理由必须从「表在另一个仓」改成「表要跨进程共享」。**

## D14 · D1 的「只搬一张表」被本 change 自己制造的跨库读点证伪（评审 C1/C2）

**取证**：

| 跨库读点 | 证据 | 冲突 |
|---|---|---|
| `pool_summary(db)` | `key_service.py:210` 查 `OfficialKey`（要迁 PG）+ `:219-223` 查 `ModelUsageDaily`（留 SQLite），**同一 session** | **必然跨库** |
| `test_provider_connection` | `model_preset_service.py:1097` 读 `ModelPreset`（SQLite）+ `:1114-1119` 读 `OfficialKey`（PG） | **必然跨库** |

**⇒ D1 那句「其余表**不需要**跨库事务」在本 change 落地后会变成假话。**

**修正**：**`ModelUsageDaily` 一并迁入 Postgres**（它本来就是成本台账，官方算力上线后它必须在 PG，
和 `official_keys` 在同一个库才能做 `pool_summary` 的单 session 聚合）。
`ModelPreset` **不迁**（它是模型目录，属于配置面），但 `test_provider_connection` 改为
**两段独立 session + 显式比对**（PG 侧查 Key、SQLite 侧查 Preset），**不要求跨库事务**。

**⇒ 跨库事务禁令的准确表述**：*「不得设计任何需要**同时写** PG 表与 SQLite 表的操作」*
（读可以分两段，**写不行**）。`pool_summary` / `test_provider_connection` 改为分两段读。

---

## D15 · 迁移编号的真实约束是「**FK 建表顺序 = 文件名 localeCompare 序**」，不是「撞号」（评审 C4）

**取证**：`postgres-migrations.js:28` `.sort((left, right) => left.name.localeCompare(right.name))`，
`:102` `for (const migration of migrations)` 按该序执行。

**实测结论（评审探针）**：

| 场景 | 结果 |
|---|---|
| 同前缀不同名（`006_official_keys.sql` + `006_payment_orders.sql`） | **共存不报错** —— 台账锁的是**全文件名 + checksum**（`:51-63`），不是数字前缀 |
| `official_keys` 的号**大于**信封表的号 | **硬失败** `42P01 relation "official_keys" does not exist`（FK 在被引用表建好之前就执行了） |
| 已应用文件改内容 | `MIGRATION_CHECKSUM_MISMATCH` |

**⇒ 真正的硬约束只有一条：被 FK 引用方的文件名字典序必须小于引用方。**

**编号分配（修正）**：

```
006_official_keys.sql        ← 与 006_payment_orders.sql 同前缀不同名，共存不报错
                                  且 'o'(official) < 'p'(payment) ⇒ 它先执行 ✅
007_official_key_envelopes.sql ← 信封表，依赖 official_keys，'007' > '006' ✅
```

**⇒ 顺带作废我在 AGENTS.md 里写错的那条纪律**（PR #4315 写的「撞号 ⇒ 启动期硬失败」是误诊），
需另开 PR 订正为「**FK 建表顺序 = 文件名 localeCompare 序**」。

---

## D16 · `create_all` 的归属：Postgres 侧**不得**跑（评审 C3）

**取证**：`database.py:31` `await conn.run_sync(Base.metadata.create_all)`，
且 `:24-26` 里有 `PRAGMA journal_mode=WAL` / `PRAGMA foreign_keys=ON` —— **SQLite 专属**。

**⇒ 两个后果**：

1. **Postgres 侧不能复用 `init_db()`**（`PRAGMA` 在 Postgres 上直接语法错）。
2. **Postgres 侧更不能跑 `create_all`** —— 若跑了，表会被建出来但**迁移台账里没有记录**
   ⇒ `assertReady`（`allowPending:false`）看到「有表无台账」⇒ 行为诡异（`MIGRATION_PENDING`）。
   **Postgres 侧只认迁移文件。**

**⇒ `database.py` 必须拆成两个模块**（`database.py` 留 SQLite / 新增 `database_pg.py`），
而不是在一个文件里塞两个 engine —— 后者会让 `create_all` 的归属继续含混。

---

## D17 · 密钥前置必须核对「**能解出现存密文**」，不是「key 存在」（评审 C6）

**取证**：`key_service.py:41-48`

```python
except (ValueError, Exception):
    derived = hashlib.sha256(key.encode() ...).digest()
    valid = base64.urlsafe_b64encode(derived).decode()
    settings.encryption_key = valid      # ← 静默改写
```

**任何**异常（含 `Fernet(key)` 构造失败）都走 sha256 派生，**且改写 `settings.encryption_key`**。

**⇒ 迁移前置检查必须升级为**：
1. `OPS_ENCRYPTION_KEY` 已配置且**固定**（非 ephemeral）；
2. **用这个 key 能解开现存的至少一条 Fernet 密文**（round-trip 成功）；
3. **禁止**「key 看起来对」就开跑 —— 配错会静默派生成一个**从未加密过任何数据**的新 key。

---

## D18 · 迁移的数据校验补第四层：**跨库表示等价**（评审 C8）

**实测的三种类型选错即炸**：

| 列 | SQLite 现状 | 选错的后果 |
|---|---|---|
| `models`（`models.py:124`，存 JSON 字符串的 TEXT） | `json.loads(key.models)` | 若 PG 用 `jsonb` ⇒ 传入 dict ⇒ `TypeError: the JSON object must be str...` ⇒ **列表页 100% 500** |
| `expires_at`（`models.py:129`，String，**字符串字典序比较**） | `key.expires_at <= in30`（`key_service.py:215`） | 若 PG 用 `date` ⇒ `TypeError: '<=' not supported between 'datetime.date' and 'str'` ⇒ **summary 500** |
| `created_at` / `updated_at`（String，naive ISO） | `datetime.utcnow().isoformat()`（**tzinfo=None**） | 若 PG 用 `timestamptz` ⇒ naive 值按会话 TimeZone 静默偏移 ⇒ **漂移巡检每行都报差异，永红**，真漂移被淹没 |

**⇒ 第四层校验**：除 `api_key` 外**全部列**在两库间做**原始值逐列比对**（不是语义比对），
且 `tasks 2.1` 必须给出**完整 PG DDL**（每个列的类型 + DEFAULT + NOT NULL）。

**⇒ 顺带修正三处我写错的事实**：
- 列数是 **17 列**不是 15（`rate_per_minute` / `daily_limit` / `alert_threshold_cost` / `note` 是运行时补的）
- `rotate` 方法**不存在**（`key_service.py` 无此函数）
- `BUSINESS_DATABASE_URL` 违反本仓 `OPS_` 前缀约定（`requirements.txt:1-7`）⇒ 本 change 的 DSN 键名要按 ops-center 约定定

**⇒ 另修两处「与现状相反」的写法**：
- `priority` 现状排序是 **ASC**（`key_service.py:306` 与 `:373`）⇒ 方案写的 `priority DESC` **与现状相反且未说明**
- `key_service.py:360` 的 `get_active_keys_for_tier` **生产引用数为 0**（只有测试引用）⇒ 不能拿它当索引依据

