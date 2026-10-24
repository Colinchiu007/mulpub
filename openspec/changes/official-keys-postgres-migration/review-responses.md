# Review Responses: official-keys-postgres-migration

> 评审来源：`Verifier` 对抗评审（2026-10-24）｜评审后修订：2026-10-24
> **CCG 跨家族双模型评审在本环境无法执行**（引擎 `ccg-deep-review.js` 全盘不存在；
> 后端 `claude` / `opencode` / `codex` / `codeagent-wrapper` 四者全不可用）。
> 本轮由 `Verifier` 子 Agent 承担对抗角色并**实测复现**核心缺陷，**属降级替代**。
>
> 评审总评：**VERDICT = FAIL，10 CRITICAL**。下列回应逐条给出「接受 / 部分接受 / 拒绝」及处置。

---

## 总体判断

**思路对，落地错。** 四个核心决策被接受并保留：

| 决策 | 处置 |
|---|---|
| 搬表与重加密**解耦**（D3） | ✅ 保留 |
| **双写 → 切读 → 停写**（D2） | ✅ 保留，但补 SQLite 镜像失败方向 |
| **熔断即时性优先于可用性**（D6） | ✅ 保留，但拆成「选 Key 路径」与「管理面路径」两档 |
| **不建 key-broker**（D1③） | ✅ 保留 |

**但有 5 条我写错的事实、2 处方案自相矛盾、1 处落地对象搞错**，全部已修：

- **落地对象搞错**（评审 C5）：生产跑的是**独立仓 `Colinchiu007/ops-center`**，monorepo 只是镜像 ⇒ 新增 **D13**。
- **D1 的前提被自己证伪**（C1/C2）：`pool_summary` / `test_provider_connection` 是本 change 制造的跨库读点 ⇒ 新增 **D14**。
- **编号纪律的机制描述错了**（C4）：不是「撞号 ⇒ 硬失败」，是「**FK 建表顺序 = 文件名 localeCompare 序**」⇒ 新增 **D15**。
- **`create_all` 归属未定**（C3）⇒ 新增 **D16**。
- **密钥前置漏了 SHA-256 派生回退**（C6）⇒ 新增 **D17**。
- **D10 缺「跨库表示等价」第四层**（C8）⇒ 新增 **D18**。
- **验收 5/6 与 D12 打架**（C9）⇒ 验收 5/6 移出本 change。
- **tasks 4.1 自相矛盾**（换 Base vs 不删 SQLite 声明）⇒ 已拆为两个明确动作。
- **双写只定义了 PG 失败方向**（C10）⇒ 已补 SQLite 镜像失败方向。
- **列数 15→17、`rotate` 不存在、DSN 键名违反 `OPS_` 前缀、`priority` 排序方向与现状相反** ⇒ 全部更正（见 D18）。
- **6 个既有测试文件必红**（C7）⇒ 已认领为 tasks 4.7。
- **OQ1 的「现有权限模型」不存在**（全仓零 GRANT）⇒ 定案重写为三条可核对判据。
- **OQ2 的理由是假的** ⇒ 理由更正为「官方维护 + 版本上下界 + 门禁兼容」。

---

## 逐条回应

### C1 · `pool_summary` 跨库不可实现 —— **接受**，D14
`key_service.py:210`（`OfficialKey`）+ `:219-223`（`ModelUsageDaily`）同 session。
⇒ **`ModelUsageDaily` 一并迁入 Postgres**（它本就是成本台账，官方算力上线后必须在 PG）。
`ModelPreset` 不迁，`test_provider_connection` 改两段独立 session。

### C2 · `test_provider_connection` 跨库，tasks 4.4 不可实施 —— **接受**，D14
`model_preset_service.py:1097` + `:1114-1119`；`routers/model_presets.py:160` 注入 SQLite session。
⇒ 改为**两段独立 session + 显式比对**，不要求跨库事务。

### C3 · `create_all` 归属未定，照写必炸 —— **接受**，D16
`database.py:31` + `:24-26` 的 `PRAGMA` 是 SQLite 专属。
⇒ Postgres 侧**不跑** `create_all`（否则有表无台账 ⇒ `MIGRATION_PENDING`）；
`database.py` **拆成两个模块**（`database.py` 留 SQLite / 新增 `database_pg.py`），不在一个文件塞两个 engine。

### C4 · 迁移编号的真实约束被误诊 —— **接受**，D15
评审实测：同前缀不同名**共存不报错**（台账锁全文件名 + checksum）；真正硬失败是 FK 顺序。
⇒ 编号分配改为 `006_official_keys.sql`（与 `006_payment_orders.sql` 同前缀不同名，
`'o' < 'p'` ⇒ 先执行）+ `007_official_key_envelopes.sql`。
⇒ **并作废我在 AGENTS.md 写错的那条纪律**（PR #4315），另开 PR 订正。

### C5 · 生产跑的不是这个仓的 ops-center —— **接受问题存在，但结论判反了；二次订正**（D13）

**评审采信了 `docs/ops-center-ecs-deployment.md:35`「ECS 克隆自独立仓」这句，但它已经过时。**

二次取证（2026-10-25）推翻「部署源是独立仓」：

| 证据 | 内容 |
|---|---|
| 独立仓 `README.md` 首行 | 「**归档说明（2026-08-10）**：已通过 git subtree 正式并入 Multi-Publish（PR #475）。此后开发/PR/CI 统一在 Multi-Publish 内进行；**本仓库冻结为只读归档**。已打 tag：`archived-into-multi-publish`」 |
| `ops-center/deploy/deploy.sh:14-16` | 「**曾 clone `Colinchui007/ops-center`** —— 该仓库 2026-08-10 已并入 mulpub（git subtree）并归档，**从它 clone 会把 2026-08 的归档快照部署上线**。现统一从 mulpub 取 `ops-center/` 子目录」 |
| `deploy.sh:17-25` | `REPO_URL=mulpub.git` + `sparse-checkout set ops-center` |
| 独立仓 `pushed_at` | 2026-08-10，此后未动 |

⇒ **落地对象一直是 monorepo，每次部署拉最新代码，不存在同步问题。**
**⇒ 评审的结论「生产跑的不是这个仓的 ops-center」不成立**；**它唯一对的是「那句部署文档确实过时」**。

**但 P1 阻断项本身不撤销，只是换了内容**：真正的难点不是「落地对象」，而是
**`official_keys` / `model_usage_daily` 在 ops-center 的 SQLite，而目标在 api-publish-engine 的 Postgres**
⇒ **跨服务、跨数据库迁移**（两个进程都要读同一张表）⇒ D13 已按此重写。

**教训**：**评审引用的证据本身可能过时**。「评审说了」不等于「证据成立」——
必须回到原始代码/文件复核（本例是 `deploy.sh` 与独立仓 README，而不是那份部署文档）。

### C6 · 密钥前置漏了 SHA-256 派生回退 —— **接受**，D17
`key_service.py:41-48` `except (ValueError, Exception)` ⇒ 静默 sha256 派生并**改写** `settings.encryption_key`。
⇒ 迁移前置从「key 已配置」升级为「**用这个 key 能解出现存密文**」（round-trip）。

### C7 · 6 个既有测试文件必红 —— **接受**
`tests/test_key_service.py:19-27` 等 fixture 用 `Base.metadata.create_all` + `from models import OfficialKey`。
⇒ 新增 tasks 4.7：认领既有测试文件，fixture 拆双 Base。

### C8 · D10 缺「跨库表示等价」第四层；tasks 2.4 漏「列类型」 —— **接受**，D18
评审实测三种类型选错的爆炸（`jsonb` ⇒ `json.loads(dict)` TypeError；`date` vs str ⇒ TypeError；
`timestamptz` ⇒ naive 静默偏移 ⇒ 漂移巡检永红）。
⇒ 第四层校验：除 `api_key` 外**全部列原始值逐列比对**；tasks 2.1 给出完整 PG DDL。

### C9 · 验收 5/6 与 D12 直接打架 —— **接受**
`proposal.md` 验收 5/6 要求 reserve 行为；`design.md` D12 明说「不得包含 reserve」。
⇒ **验收 5/6 移出本 change**（属信封 change），本 change 的验收收口到「Key 状态在 PG 且可读」。

### C10 · 双写只定义 PG 失败方向，SQLite 镜像失败方向未定义 —— **接受**
`key_service.py:285/344/356` 服务层自己 commit；SQLite 存档是**回滚退路**。
⇒ 补：SQLite 镜像写失败时**主写已成功** ⇒ 记 warn + 计数，**不回滚主写**（回滚会丢真实更新），
并把「两库一致」纳入漂移巡检。

### 其余 MAJOR / MINOR（摘要处置）

| # | 评审发现 | 处置 |
|---|---|---|
| 双库六维度漏项（启动顺序 / 连接池 / 健康检查 / 关停） | 接受 | tasks 3.7–3.10 补齐 |
| `db.refresh()` 静默返回全 None 字段 | 接受 | tasks 4.6 补断言：session 绑错库必须显式失败 |
| `setattr` 字段名驱动 ⇒ 任意 body 字段被静默丢弃 | 接受 | tasks 2.4 增「哪些字段允许写入」为显式清单 |
| 两种读混为一谈 | 接受 | D6 拆两档：选 Key 路径 fail-closed 到 PG；管理面读允许降级到 SQLite 存档，响应标 `source:"stale-archive"` |
| `/health` 静态 + `check_db` 只探 SQLite ⇒ 部署自检误判 | 接受 | tasks 3.9 补 PG 探针 |
| OQ1「现有权限模型」不存在（全仓零 GRANT） | 接受 | 定案重写为可核对判据（见下） |
| OQ2 理由错（Node 用 `pg` 非 asyncpg；ECS 是 pip install 非打包） | 接受 | 理由更正；补版本上下界 + `check-dep-audit.js` 门禁兼容 |
| OQ3 缺落地动作（`main.py:15/45` 是唯一调用点） | 接受 | tasks 3.11 补「删除调用点」任务 |
| Non-Goals 8.3 被自己证伪 | 接受 | 8.3 改为「不迁 `ModelPreset` 等配置面表」；`ModelUsageDaily` **迁**（D14） |
| X3 `priority` 排序方向与现状相反 | 接受 | D18 更正；tasks 2.3 索引按现状 ASC，方案里的 DESC 必须说明理由 |
| X2 `get_active_keys_for_tier` 生产引用数为 0 | 接受 | 不得作索引依据 |
| R15 / R16 未闭合 | 接受 | `expires_at` 列类型与 `model_usage_daily` 的 key 维度在本 change 一并定死 |
| R20 新增 3 处漂移 | 接受 | 见 D18 与 tasks 2.1 / 2.3 |

---

## 三个 OQ 的最终定案（2026-10-24）

| # | 定案 | 依据 |
|---|---|---|
| **OQ1** | ① **数据导出必须剔除 `official_keys` 表**（导出无细粒度权限管控，最易外流）<br>② **表级读权限**：只允许 ops-center 的 Key 管理面账号 SELECT `official_keys`；**禁止**为其新建 superuser 或超出表 owner 的宽权限账号<br>③ **属主**：该表 owner 与 ops-center 服务账号同权限级，不额外提权<br>④ **备份链路**：按现有 Postgres 库策略走，但**部署文档必须登记**「本库含密钥材料密文」<br>⑤ **SQLite 侧现状补测**：`stat -c %a data/config.db` 取当前实际权限并登记（评审指出 `ops-center.service` 无 `UMask=`、无 chmod 600） | 全仓 `.sql` **零条 GRANT / CREATE ROLE** ⇒「沿用现有模型」**无可沿用之物**，故改为可核对判据 |
| **OQ2** | **`psycopg[binary]`**，理由改为：① **PostgreSQL 官方维护**，长期无兼容风险；② SQLAlchemy 文档默认推荐；③ **`[binary]` extra 带预编译 wheel，ECS 上 `pip install` 免编译**（实测部署形态是 pip install，不是打包 ⇒「免编译」仍是要点，但它是 psycopg 的加分项而非 asyncpg 的专属优势）<br>④ **补版本上下界**（`requirements.txt:1-7` 的约定）+ **确认 `check-dep-audit.js` 门禁兼容**<br>⑤ **`psycopg` 与 `psycopg-binary` 两个包都要写入**（前者含源码声明，后者提供 wheel） | ⚠️ 原理由「asyncpg 无 C 扩展依赖、psycopg 需编译工具链」**有误**；且「与 Node 侧生态一致」也是错的（Node 侧用的是 `pg`，不是 asyncpg） |
| **OQ3** | **保留函数，但迁移完成后不再调用** | 保留一个不调用的函数零成本；删掉后想恢复只能改代码发版。Postgres 侧 4 个补列由**迁移文件**直接含在表定义里（tasks 2.2），不依赖运行时 ALTER |

---

## 评审后的阻断项清单（动手前必须全绿）

| # | 前置 | 关联 |
|---|---|---|
| **P1** | ~~确认 ops-center 生产代码来源与同步机制~~ **→ 已澄清：monorepo 是唯一开发源，部署从 `mulpub.git` sparse-checkout，独立仓 2026-08-10 已冻结归档。**<br>**P1 改为**：确认**跨服务搬运通道**的形态（ops-center 导出 → api-publish-engine 落库 + 写台账），以及**密钥材料不过 git** 的通道设计 | D13 |
| **P2** | 编号规则定死并**改正机制描述**（FK 顺序 ≠ 撞号） | D15 |
| **P3** | 拆掉两个跨库读点（`pool_summary` / `test_provider_connection`） | D14 |
| **P4** | 17 列类型逐列定死 + D10 第四层校验 | D18 |
| **P5** | `create_all` 归属 + 启动顺序 + 独立 `database_pg.py` | D16 |
| **P6** | 有效密钥前置（**能解出现存密文**，非「key 存在」） | D17 |

**建议 P1–P6 先单独走一轮，再进实现。**
