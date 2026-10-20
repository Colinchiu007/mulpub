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
| 1 | `grant` 幂等（PRD N9） | `subscription-service.grant()` 新增 `idempotencyKey`；拼进 `provider_reference`(UNIQUE)，撞约束转重放视图，不叠加时长/不重复通知；`IDEMPOTENCY_KEY_CONFLICT`(400) fail closed | `subscription-service.test.js` +4 例（33 通过） |
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
