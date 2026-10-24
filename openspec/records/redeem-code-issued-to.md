---
record: redeem-code-issued-to
task: 激活码「发放对象」落库 + 兑换失败限流（温和档）+ 运营侧档位名与时长预设
date: 2026-10-24
branch: redeem-code-issued-to
---

# 激活码：发放对象 + 失败限流 + 运营侧语义化

## 1. 三个决策（本轮由运营方拍板）

| 决策 | 结论 | 落地位置 |
|---|---|---|
| 档位显示名 | **沿用仓内命名**（标准版 / 专业版） | 运营中心前端 `PLAN_LABELS` 显示映射；`plan` 值不变（仍是服务端契约 `standard`/`pro`） |
| `issued_to`（发放对象） | **做** | 迁移 009 + 运行时 SCHEMA + 仓储 + 服务层 + 运营 API + ops 转发层 + 运营前端 |
| 限流严格程度 | **先上温和档** | 同一用户 60 秒内失败 ≥ 5 次 / 同一 IP 10 分钟内失败 ≥ 30 次 ⇒ 429 |

## 2. 为什么要「发放对象」

兑换码是 bearer token。一旦泄漏（例如渠道方二次转卖），没有发放对象就**无从回答「这批码发给了谁」**，
运营只能靠记忆排查。`issued_to` 记录这件事。

⚠️ **能力边界（不要把作用说大）**：仓里**只有单码吊销**，**没有批量作废端点**。
⇒ 泄漏后的处置流程是：按 **batch** 列出该批次的码 → **逐个吊销**；
`issued_to` 供人工判断优先级。
⚠️ `issued_to` **当前不是列表筛选条件**（列表只支持 `plan`/`status`/`batch` 过滤）。
「批量作废」与「按发放对象筛选」列入下一轮。

## 3. 改动清单

### 新增

| 文件 | 内容 |
|---|---|
| `migrations/postgresql/009_redeem_code_issued_to.sql` | `ALTER TABLE identity_redeem_codes ADD COLUMN IF NOT EXISTS issued_to TEXT` |
| `packages/api-publish-engine/src/auth/subscription-redeem-batch.js` | 批量签发（mixin），含 `issued_to` 透传与归一化 |
| `packages/api-publish-engine/src/auth/redeem-rate-limit.js` | 兑换失败限流器（端点级 + 失败计数） |
| `packages/api-publish-engine/src/auth/publish-api-redeem.js` | 兑换路由（mixin）+ 限流门 |
| `packages/api-publish-engine/test/redeem-issued-to-and-rate-limit.test.js` | 11 个用例 |

### 修改

| 文件 | 改动 |
|---|---|
| `packages/api-publish-engine/src/auth/subscription-service.js` | 摘出 `createRedeemBatch`；`listRedeemCodes` 映射 `issuedTo`；挂载新 mixin |
| `packages/api-publish-engine/src/auth/postgres-commerce-store.js` | `createRedeemCodes` INSERT 加第 6 个 unnest 数组；`listRedeemCodes` SELECT 加 `issued_to` |
| `packages/api-publish-engine/src/auth/postgres-identity-repository.js` | SCHEMA 数组加与迁移**逐字成对**的 ALTER |
| `packages/api-publish-engine/src/auth/publish-api-redeem-code-admin.js` | 运营签发端点透传 `issuedTo` |
| `packages/api-publish-engine/src/publish-api-server.js` | 兑换路由搬进新 mixin，主文件换成一行调用 |
| `ops-center/backend/services/redeem_batch_service.py` | `issuedTo` 转发 + 前置校验（类型错 400） |
| `ops-center/frontend/src/views/RedemptionCodes.vue` | 中文档位名、时长预设（1 个月 / 3 个月 / 自定义）、发放对象输入与列表列 |

## 4. 三处「必须这么写」的理由

### 4.1 迁移编号用 009，刻意跳过 007 与 008

`migrations/postgresql/` 已有 002–006。**008 已被在飞 PR #4322 占用**；
**007 预留给尚未开 PR 的 compute-key-envelope-migration change**。

**编号机制的准确表述**（对抗性审查纠正过初稿的简化说法，实测自 `postgres-migrations.js`）：
- 迁移文件名必须匹配 `^\d{3}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$`；**台账按完整文件名记账**（含 checksum）。
- 因此两个**同号不同名**的迁移（`009_a.sql` / `009_b.sql`）**不会**造成台账冲突，
  但它们的**相对执行顺序会退化为文件名字母序**（`discoverMigrations` 按 `name.localeCompare` 排序），
  若两者存在依赖关系就可能**以错误顺序执行** ⇒ 迁移失败或状态错乱。
- 真正会让 identity 仓储**启动期硬失败**的是另两件事：同名文件内容被改
  （`MIGRATION_CHECKSUM_MISMATCH`）与文件已入库未执行（`MIGRATION_PENDING`）
  —— 两者都让 `assertReady` 抛错、会员中心整体降级。

⇒ 结论不变：**宁可跳号，不可撞号**（避免执行顺序不确定，也避免与尚未开 PR 的 change 抢占）。

### 4.2 加列要**两处同改**（迁移 + 运行时 SCHEMA）

`postgres-identity-repository.js` 的 SCHEMA 数组是**仅非生产环境**执行的 bootstrap 路径，
那张表写的是 `CREATE TABLE IF NOT EXISTS` ⇒ **对已存在的表是 no-op、不会加列**。
⇒ 开发库永远缺这一列 ⇒ INSERT 报 `column "issued_to" does not exist`，
而生产库（走迁移）是好的 ⇒ **只在开发环境复现的诡异差异**。

⇒ 两处都用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
（先例：`006_payment_orders.sql` 与 `src/auth/payment-schema.js` 是内容相同的一对）。

### 4.3 两个大文件都是**抽模块**，不是抬基线

| 文件 | 改前 | 改后 | 门禁 |
|---|---|---|---|
| `subscription-service.js` | 496 行 | **458 行** | 全局 `limit: 500`，未挂账文件 ≥ 500 行即 `NEW_OVER_LIMIT` |
| `publish-api-server.js` | 1573 行 | **1565 行** | `targets` 点名还账 = 1574，**零增长容差**（`lines > ceiling` ⇒ 1575 即红） |

两者都**净减行**。「抬高基线掩盖自己引入的债务是禁止的」——抽模块是正解。

## 5. 限流口径（温和档）

| 维度 | 阈值 |
|---|---|
| 同一用户 | 60 秒内**失败** ≥ 5 次 ⇒ 429 |
| 同一 IP | 10 分钟内**失败** ≥ 30 次，**且最近 60 秒内失败 ≥ 10 次** ⇒ 429 |

- **只计失败**，成功不计数；一次成功还会**清零**该用户的失败计数
- **哪些失败才算**：只有 `REDEEM_CODE_FORMAT`（格式错）与 `REDEEM_CODE_NOT_FOUND`（不存在）。
  `REDEEM_CODE_USED` / `DISABLED` / `EXPIRED` **不算** —— 用户拿着自己的旧码来试是正常业务
- 命中时只回 429，**不透露剩余次数**（否则限流器本身可被探测）
- **诚实边界**：计数是**进程内内存态** ⇒ 多实例部署时实际阈值 = 阈值 × 实例数
  （与仓内既有 `rate-limiter.js` 同一形态）。要跨实例精确需共享存储，本期不做。

### 5.1 对抗性审查抓出的真缺陷（已修）

**⓿ 红队打穿的三条（本轮最后一轮修）**

1. **幂等重放 = 无限清零钥匙**（user 档被完全绕过，实测 12×）：
   幂等重放（自己已用过的码再提交）**也返回 200** ⇒ 路由把它当「成功」⇒ 每次都清零失败计数
   ⇒ 攻击者只要**持有任意 1 张自己兑换过的码**，就能每探测 4 次插入一次重放，把计数压回阈值下。
   ⇒ 修法：只有**真正开通**（`idempotent === false`）才清零；幂等重放只**归还预占额度**。
   ⚠️ 只改前半句会踩第二个坑：pending 只进不出 ⇒ 合法用户反复重放自己的旧码（幂等是**正常**场景）
   也会被限流在门外 —— 写测试时才发现，一并修。
2. **X-Forwarded-For 分支是死代码 ⇒ 生产拓扑下 IP 桶退化为全站单桶**：
   生产 nginx 把 `/api/v1/` 反代到 `127.0.0.1:3030`、引擎容器**只绑回环**
   ⇒ 引擎看到的 `req.socket.remoteAddress` **恒为 127.0.0.1**
   ⇒ 若以 socket 为准，**全站所有用户共用一个 IP 桶** ⇒ 攻击者打满它，**所有持有效码的正常用户也换不了**。
   ⇒ 修法：**优先取 X-Forwarded-For 的最右元素**（nginx 的 `$proxy_add_x_forwarded_for`
   把真实客户端 IP 追加在末尾；取最左则客户端自带伪造 XFF 就能把计数打到别人头上），socket 仅作兜底。
   ⚠️ 取舍如实记录：直连（不经反代）时 XFF 可被伪造来绕开 IP 桶 —— 但生产必然经 nginx
   （引擎只绑回环，外网不可直连），且用户维度不受影响。
3. **IP 档两个条件是 AND ⇒ 节流规避永不触发**（实测 30 分钟 1770 次探测、0 次 429）：
   只要把速率压在 60 次/分以下，`burst` 永远不达标 ⇒ 即便 10 分钟累计 500+ 次失败也一条不拦。
   ⇒ 修法：两个条件改为 **OR**（总量达标 **或** 速率达标即拦）。
   ⇒ 共享出口的偶发失败（两个条件都不达标）仍不拦 ⇒ 不误伤。

**①② 并发绕过（上一轮已修）**

**① 并发可绕过限流（TOCTOU）**

原实现是「先看计数 → 执行 → 失败后才计数」⇒ 20 个并发请求在同一瞬间都读到计数为 0
⇒ **全部通过** ⇒ 限流形同虚设。实测确认。

⇒ 修法：请求进入时先**预占**一个「待定失败」额度，失败时转正、成功时释放；
**有效占用 = 失败数 + 待定数**。`acquire()` 内部**同步无 await** ⇒ Node 单线程下
检查与预占是原子的 ⇒ 并发请求无法同时通过判定。
实测：20 个并发 ⇒ 只有 5 个能进，其余 15 个当场 429。

**② IP 桶可能锁死同出口的所有正常用户**

公司 NAT / 校园网 / 家庭网关下，很多正常用户共用同一个出口 IP。
若只按「10 分钟内失败 ≥ 30 次」判定，那些用户**各失败一两次**就足以把同出口的
**所有正常用户**一起锁在门外。

⇒ 修法：IP 档额外要求**「最近 60 秒内失败 ≥ 10 次」**的速率条件。
单 IP 快速探测 ⇒ 速率高 ⇒ 触发；共享出口慢速偶发 ⇒ 速率低 ⇒ 不触发。

**③ 审计的业务字段被 `AuditLog.log` 静默丢弃（契约审查报为 HIGH）**

`AuditLog.log` 只认一组**固定字段**：`id / ownerSubject / type / platform / title / status /
error / publishId / details / createdAt`。⇒ 直接把 `batch`/`plan`/`durationDays`/`issuedTo`/
`count`/`userId`/`code` 放在**顶层**会被**无声丢掉** ⇒ 审计里只剩「发生过」，
看不到「签了多少个、给了谁、每码几天」⇒ 追查时等于没留痕。

⇒ 修法：业务字段全部装进 **`details`**（它是固定字段之一），另加 `title`（人可读摘要）
与 `status: 'success'`。
⇒ **既有的 `redeem_code_reveal` 有一模一样的缺陷**（count/plan/status/batch 被丢）⇒ 一并修。
⇒ 补测试锁住这个约定：顶层**不得**出现这些字段（若有人挪回顶层，用例会红）。

**④ 由 ① 引入的连带缺陷（自己写测试时抓到的）**

预占额度只在「记失败 / 记成功」两条路径上释放。**非探测型**错误
（已用 / 停用 / 过期 / 服务端 500）既不记失败、也不算成功 ⇒ 预占**永不释放**
⇒ 用户只是反复拿自己的旧码来试，也会被限流在门外。

⇒ 修法：新增 `releasePending()`，在这类路径上归还额度。

**为什么不用仓里既有的 `rate-limiter.js`**：那个是全站粗桶 —— `maxRpm` 缺省为 `null`
⇒ **默认不启用**；不区分端点；**不区分成败**；低速率定向探测抓不到。

## 6. 测试证据

| 验证 | 结果 |
|---|---|
| engine 新增用例 | **16 passed / 0 failed**（11 → 16：新增并发绕过、IP 速率条件、IP 触发、滑窗过期、预占释放） |
| engine 全量（Vitest 47 文件） | **504 passed / 0 failed** |
| engine 全量（node --test 部分） | 2 个文件失败 —— **对照实验证明是 main 级存量红**（见下） |
| ops-center 全量 | **702 passed / 1 failed** —— 同为对照实验证明的存量红（见下） |
| 逐文件行数门禁 | ✅ 无新增超大文件，挂账清单与现实一致 |
| **变异验证** | 短路限流门（`if (false && gate.blocked)`）⇒ **恰好 2 个用例红**（顺序那条 + 并发那条）⇒ 锁有牙齿；恢复后 16/16 绿 |

### 对照实验（两组失败都不是本次改动引入）

| 失败项 | 对照组读数 | 判定 |
|---|---|---|
| `cloud-accounts-keyring-hardening` / `plugin-loader-runtime-path` | 在**干净 origin/main + 同一套依赖**下逐字相同（11 tests / 9 pass / 2 fail） | main 级存量红，与本次无关 |
| `test_generate_video_full_flow` | 在**干净 origin/main** 下同样失败，报「ffmpeg 不可用」 | 沙箱缺 ffmpeg，与本次无关 |

> ⚠️ 第一组对照**第一次做错了**：对照 worktree 没装依赖 ⇒ 加载期就崩 ⇒ 读数是「0 passed」，
> 与我的分支读数不同形。**对照必须同环境**，否则结论无效。

## 7. 门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 逐文件行数（`check-max-lines`） | PASS | 打印「无新增超大文件，挂账清单与现实一致」 |
| 编码完整性 | PASS | 全部改动文件 grep U+FFFD = 0 |
| ops-center 后端测试 | PASS（含 1 个对照实验判定的存量红） | 702 passed / 1 failed |
| engine 测试 | PASS（含 2 个对照实验判定的存量红） | 504 passed（Vitest）+ 11 passed（新增） |
| 变异验证 | PASS | 限流门短路 ⇒ 恰好 1 红 |

## 8. 边界（刻意不做）

- **不给激活码加「加密载荷」**：激活码是**无信息的随机 token**，权益只存在于服务端一行状态。
  把档位与时长加密进码里，就必须把解密密钥放进客户端 ⇒ 密钥可提取 ⇒ 可伪造 ⇒ 回到
  「任意非空串换永久 Pro」的老漏洞（本仓已因此栽过三次）。**本轮不动这一点。**
- **不改档位 id**（`standard`/`pro`）：那是服务端契约与迁移 CHECK 约束的一部分
- **不新增批次统计表**：用 `identity_redeem_codes` 上的 `GROUP BY batch` 聚合即可，
  零迁移、零清单同步（新增表要同步 `REQUIRED_SCHEMA_RELATIONS` 的多处副本）
- **不拆 scope**：`admin:redeem:read/export/write` 的拆分是独立一项，本轮先补审计与限流
- **不改 ops 的 `MAX_BATCH`**：ops 主动收窄到 200（engine 允许 500），更小批量更好追责

## 9. 未纳入（已登记为下一轮）

- 签发 / 作废 / 手动开通三类花钱动作的**审计日志**（当前只有 reveal 有审计）
- 批次交付追踪（本批已兑换多少 / 兑换率）
- 签发结果的一键复制与 CSV 导出（运营签 200 个码目前只能手抄）
- 桌面端兑换卡体验（本地格式前置校验 + 文案「16 位」纠正 + 自动大写分隔）
- 限流观察一周真实数据后再决定是否收紧或上共享存储

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
