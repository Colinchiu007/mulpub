---
record: engine-redeem-codes-complete
task: 系统 A 补齐兑换码运营能力（列表/吊销/碰撞补足），ops-center 恢复查询与吊销 UI
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 不存在；合并后由 docs-only 回填 PR 收口
sync_backfill_owner: 下一会话的回填 PR
---

## 本次执行记录：engine 兑换码运营能力补齐（engine-redeem-codes-complete，2026-10-13）

> 分支：`engine-redeem-codes-complete`；规模：11 文件 ⇒ 🌳 大型（跨模块）⇒ CCG 判定 L+
> CCG 双模型后端在沙箱不可用 ⇒ **降级 SELF-REVIEW**（如实记录，不冒充外部评审）
> 前序：A1（`consolidate-redeem-codes`，PR #3457，SHA `ce24fc8a8`）已收敛签发真源，
> 但明确留了三项给 A2：列表、吊销、碰撞补足。本轮即执行这三项。

## 用户拍板的决策（实现不得偏离）

| 编号 | 议题 | 决策 | 理由 |
|---|---|---|---|
| D1 | 列表是否脱敏 | **B：默认掩码 + 显式 `reveal=true`** | 列表一次就能捞走全库未兑换码，而这类码的价值随时间衰减。`admin:users` 本就能调 `/grant` 给自己发权益，但那条路**有日志可查**；批量导出若无痕就没有归属。reveal 必须写审计。 |
| D2 | 吊销幂等语义 | 已 disabled → 200 `idempotent:true`；已 used → 409；不存在 → 404 | 与 #3293 建立的 `/redeem` 幂等约定对齐。已 used 必须区分：权益已发放，回滚会留下已享受服务却无记录的账。 |
| D3 | 碰撞补足补不满 | **B：补 10 轮，仍差则 409 `REDEEM_BATCH_INCOMPLETE` 并带回已签成的码** | 报错但不丢弃。一路到底补（A）会在 RNG 故障时死循环；静默少发（B 的反面）让运维看不见差额。 |
| D4 | UI 恢复范围 | 恢复 list + revoke；**delete 继续下线** | engine 无 delete 能力，做软删除会造出第三套状态语义。 |
| D5 | desktop 孤儿模块 | **仍不做** | 与 A1 同一道覆盖率门禁，解法只能是盲写测试。如实记为已知债务。 |

## 实现

### engine（`packages/api-publish-engine`）

| 层 | 变更 |
|---|---|
| store | `listRedeemCodes` / `countRedeemCodes` / `getRedeemCode` / `disableRedeemCode`；`_redeemCodeFilter` 统一 WHERE 拼装 |
| service | `listRedeemCodes`（默认掩码，`reveal === true` 才放行）、`disableRedeemCode`（幂等语义）、`createRedeemBatch` 碰撞补足 |
| router | `GET /api/v1/admin/member/redeem-codes`、`POST /api/v1/admin/member/redeem-codes/disable` |
| mixin | 新增 `publish-api-redeem-code-admin.js`，承接 `/admin/member/*` 全块 |

**碰撞补足算法**：`seen` 以已入库码打底，每轮只补缺口；`done` 集合保证本批内不重复投递；
最多 `REDEEM_TOPUP_MAX_ROUNDS = 10` 轮，耗尽则抛 409 并挂上 `created`。

**词表映射**：ops 旧契约用 `revoked`，engine 只有 `disabled`——在 ops 转发层映射，
不让前端拿 `revoked` 打过去吃 400。

### ops-center

- service：新增 `list_redeem_codes` / `disable_redeem_code`；抽出 `_call_engine` 统一出口
- router：恢复 `GET ""` 与 `POST /disable`；`REDEEM_BATCH_INCOMPLETE` 的已签发码经
  `HTTPException` detail 原样到达前端
- 前端：恢复列表表格（筛选/分页/掩码开关）、作废操作、`REDEEM_BATCH_INCOMPLETE` 专用提示

## 关键实现决策：为什么 `REDEEM_BATCH_INCOMPLETE` 要单独出口

`_commerceFailure` 只回 `{error, message}`，会丢掉服务层挂在异常上的 `created`——
**已签发的码等于白签**，调用方既不知道拿到了多少、也拿不到可交付的那部分。
这是本仓库唯一需要携带业务载荷的 commerce 错误，故在路由层单独出口，
并穿过 ops 代理层原样透传（三条测试锁这条链）。

## 测试

| 套件 | 数量 | 结果 |
|---|---|---|
| `test/redeem-codes-admin.test.js`（新） | 11 | 全绿 |
| `test/redeem-code-admin-routing.test.js`（新） | 10 | 全绿 |
| `test/subscription-service.test.js`（改造 2 例） | 24 | 全绿 |
| `test/member-commerce-repository.test.js` | 30 | 全绿 |
| `tests/test_redeem_codes_admin_api.py`（新） | 38 | 全绿 |
| `tests/test_redeem_batch_api.py`（改造 fixture） | 15 | 全绿 |
| ops-center 全量 | 609 passed / 1 failed | 唯一失败为沙箱缺 ffmpeg，与改动无关 |

**13 个变异全部变红**：掩码退化、reveal 宽松化、幂等误报 409、status 白名单放宽、
格式校验短路、补足轮数退化为 1、回到静默少发、异常丢弃已签发码、代理层强制 reveal、
revoked 不映射、上游响应体整包透传、丢弃已签发码、本地格式校验短路。

## 重构中发现并修复的真实回归

`/admin/member/*` 整块因 `publish-api-server.js` 逐文件行数点名目标（1574 行）被抽进 mixin。
抽出后**守卫里的裸 `return;` 语义变了**：原本从整个请求处理函数返回，重构后只退出 mixin 方法，
返回 `undefined`（falsy）⇒ 调用方以为"本块没管这件事"而继续往下走 ⇒ **对同一个 req 发出第二个响应**。

全部改为 `return true;`（`return false` 只保留在前缀不匹配处）。

**首版修复不彻底，CI 打回。** 我先改了 6 处，但遗漏了 `USER_ID_REQUIRED` 分支那一处
**行内** 形态的 `{ ...; return; }`——此前的三次替换分别要求"整行只有 `return;`"
或按特定错误码匹配，恰好都跳过了它。残留导致 grant 缺 `userId` 的 400 请求
返回 `undefined`，调用方继续走到兜底 404，再抛 `ERR_HTTP_HEADERS_SENT` 打挂进程。

**判据要点**：本地跑 `member-commerce-api.test.js` 一直是红的，但那是我沙箱缺
`signal-exit@3` 导致的环境失败，与真实回归混在一起。真正定位靠的是
**同一沙箱切 `origin/main` 做对照**（main 通过 / 我的分支 fail，差集即我的锅），
以及插桩打出 `ret=undefined headersSent=true` 这一行——不是靠推理。

修复后新增 2 条回归测试锁住 400 与 503 分支（此前只测了成功分支与鉴权守卫，
恰好漏掉校验失败分支）。两个变异（把 400 / 503 分支退回裸 `return`）确认变红。

| 项 | 状态 |
|---|---|
| 远程同步 | PENDING —— 本 PR 尚未合并，merge SHA 不存在；合并后由回填 PR 收口 |
| 门禁复核 | 本地 5 项全绿；U+FFFD 0；engine 75/75；ops-center 609 passed / 1 failed（沙箱缺 ffmpeg） |

## 已知债务（不在本轮）

1. `apps/desktop/electron/services/redemption-codes.js` 孤儿模块未删——
   全仓零引用、`license:activate` 自 #3085 起在 packaged 被拒收，但删除会拉低
   desktop 全局覆盖率门禁（该模块覆盖率高于均值）。本地无法跑 desktop coverage，
   盲写测试违反仓库规范。如实挂账。
2. `MAX_BATCH` 仍为 200。收窄原本是为压住"碰撞静默少发"，该风险已消除；
   现作为运营侧保守上限保留，可后续放宽至 engine 的 500。
