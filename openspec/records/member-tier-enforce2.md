---
record: member-tier-enforce2
task: 档位硬门禁第二批——grant 幂等 / 设备数上限（进行中：3-6 项未开工）
date: 2026-10-20
type: runtime
---

# 会员档位硬门禁（第二批，进行中）

## 已完成

| # | 项 | 落点 | 证据 |
|---|---|---|---|
| 1 | `grant` 幂等（PRD N9） | `subscription-service.grant()` 新增 `idempotencyKey`；拼进 `provider_reference`(UNIQUE)，撞约束转重放视图（不叠加时长/不重复通知）；`IDEMPOTENCY_KEY_CONFLICT`(400) fail closed。**首版曾推文件到 524 行撞 500 行硬限，已改为行内最小实现，499 行** | `subscription-service.test.js` +3 例（33 通过） |
| 2 | `max_devices` 执行点（PRD N1） | `upsertSession` 接受 `maxDevices`：同设备重登放行、新设备超限抛 `DEVICE_LIMIT_EXCEEDED`(403) 且不写库；`/me` 经 `registerDeviceSession` 判定并把 `membership.deviceLimit` 提示给客户端（不阻断 /me） | `plan-capabilities-wiring.test.js` +1（6 通过） |

## 数据校验

- `maxDevices`：非数字/负数/非有限数 ⇒ 不限（与「缺失即放行」同源）；`0` ⇒ 任何新设备都拒。
- `idempotencyKey`：空串/非字符串视为未提供；与 `providerReference` 同时给 ⇒ 400。

## 未开工（本轮剩余）

3. `max_cloud_accounts` 执行点（云账号 handler 接线）
4. 到期横幅 UI
5. 日发提交前校验（需「今日已发条数」数据源 + 突发日口径）
6. 降级自动裁剪

| 远程同步 | 由门禁推导 |
| --- | --- |

## 追加：第 6 项「降级自动裁剪」已完成（2026-10-20）

- 纯函数 `trimSelection(entitlement, selected)`：保留原顺序前 N 个、上限 0 ⇒ 全清、缺失/-1/非法值 ⇒ 不裁；
- composable 新增 `trimToLimit()`，并在 `togglePlatform` 入口**先裁后判**（不依赖 watch 的触发时机）；
- 测试：`plan-limits.test.js` +5 例、`usePlatformSelection.test.js` +2 例（合计 42 全绿）；
- 实现取舍记录：watch 版本在单测中不触发（依赖链断在测试 getter 上），`flush:'sync'` 亦无效，
  故改为显式方法 + 入口兜底；`Publish.vue`（零增长挂账文件）无需改动。
