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

兑换码是 bearer token。一旦泄漏（例如渠道方二次转卖），没有发放对象就**无从定位受影响批次**，
也就无法批量作废止损。`issued_to` 回答「这批码发给了谁」。

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

迁移台账对「文件名 + checksum」双向锁定，**撞号会让 identity 仓储启动期硬失败**
（`MIGRATION_PENDING` / `MIGRATION_CHECKSUM_MISMATCH` ⇒ `MEMBERSHIP_UNAVAILABLE`
⇒ 会员中心整体降级）⇒ **宁可跳号，不可撞号**。

### 4.2 加列要**两处同改**（迁移 + 运行时 SCHEMA）

`postgres-identity-repository.js` 的 SCHEMA 数组是**仅非生产环境**执行的 bootstrap 路径，
那张表写的是 `CREATE TABLE IF NOT EXISTS` ⇒ **对已存在的表是 no-op、不会加列**。
⇒ 开发库永远缺这两列 ⇒ INSERT 报 `column "issued_to" does not exist`，
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
| 同一 IP | 10 分钟内**失败** ≥ 30 次 ⇒ 429 |

- **只计失败**，成功不计数；一次成功还会**清零**该用户的失败计数
- **哪些失败才算**：只有 `REDEEM_CODE_FORMAT`（格式错）与 `REDEEM_CODE_NOT_FOUND`（不存在）。
  `REDEEM_CODE_USED` / `DISABLED` / `EXPIRED` **不算** —— 用户拿着自己的旧码来试是正常业务
- 命中时只回 429，**不透露剩余次数**（否则限流器本身可被探测）
- **诚实边界**：计数是**进程内内存态** ⇒ 多实例部署时实际阈值 = 阈值 × 实例数
  （与仓内既有 `rate-limiter.js` 同一形态）。要跨实例精确需共享存储，本期不做。

**为什么不用仓里既有的 `rate-limiter.js`**：那个是全站粗桶 —— `maxRpm` 缺省为 `null`
⇒ **默认不启用**；不区分端点；**不区分成败**；低速率定向探测抓不到。

## 6. 测试证据

| 验证 | 结果 |
|---|---|
| engine 新增用例 | **11 passed / 0 failed** |
| engine 全量（Vitest 47 文件） | **504 passed / 0 failed** |
| engine 全量（node --test 部分） | 2 个文件失败 —— **对照实验证明是 main 级存量红**（见下） |
| ops-center 全量 | **702 passed / 1 failed** —— 同为对照实验证明的存量红（见下） |
| 逐文件行数门禁 | ✅ 无新增超大文件，挂账清单与现实一致 |
| **变异验证** | 短路限流门（`if (false && gate.blocked)`）⇒ **恰好 1 个用例红**（接线那条）⇒ 锁有牙齿；恢复后 11/11 绿 |

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
