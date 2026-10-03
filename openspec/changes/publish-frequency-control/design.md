# 技术设计 — 发布频率控制

## D-1 两档间隔维度（用户决策 D2）

单一策略模块按平台持有两个独立最小间隔：

| 档位 | 键 | 保护的对象 | 反例（不受该档保护的东西） |
| --- | --- | --- | --- |
| 账号档 `accountMinMs` | `${platform}:${accountId}` | 同一账号在同一平台连发 | 同平台换号连发 |
| 平台档 `platformMinMs` | `${platform}:*` | 同一平台**任意两个账号**之间 | 不同平台之间 |

未纳入**同机全局档**（用户 D2 未选）：跨平台同时发布是本产品的核心用途（一键发 5 个平台），
加设备级串行会把核心功能废掉。该取舍如实记入 PRD 的「不做什么」。

`accountId` 缺席（`publish:wechat` 的 `accountId: null`、`publish:batch` 字符串形态 target
归一化出的 `{platform, accountId: null}`）时：**账号档跳过，平台档必须仍生效**。
理由——「没有账号身份」不等于「没有发布行为」，让缺席绕过整道门禁等于把门禁写成可选。

## D-2 默认值：工程保守估计，不是平台规则

数值取「宁慢不险」，按内容形态分三组。**这些数字没有平台官方依据**，代码注释、PRD、
CHANGELOG 三处都必须如实标注为工程保守默认，禁止表述为"符合平台规定"。

| 组 | 平台 | accountMinMs | platformMinMs |
| --- | --- | --- | --- |
| 长文低频 | wechat_mp, zhihu, baijiahao, toutiao | 60 min | 5 min |
| 短视频/图文社区 | douyin, kuaishou, tencent_video, xiaohongshu, bilibili, tiktok, youtube, instagram, facebook | 30 min | 3 min |
| 短内容高频容忍 | weibo, twitter | 10 min | 60 s |

覆盖通道（进程级，仅开发排障与运营调优用，不进 UI）：

- `MP_PUBLISH_MIN_INTERVAL_MS` — 覆盖所有平台的 `accountMinMs`
- `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS` — 覆盖所有平台的 `platformMinMs`
- 特殊值 `0` = 显式关闭该档（不得用"未设置"表达关闭，未设置必须回落默认）
- 非法值（非有限负数、NaN）必须回落默认并**出声**（`console.warn`），
  不得静默按 0 处理——AGENTS.md「静默配置失败必须留日志」。

未知平台（不在 15 平台表内）回落 `BASELINE = {60min, 5min}`，即**按最严档处理未知**，
不得回落 0。新增平台若忘记登记策略表，落入最严档而非无限制。

## D-3 记账时机前移（提交前）

现状（`task-queue.js:463-489` 检查、`:524-530` 记账）的问题不是"晚了一点"，而是
**记账条件与真实世界结果解耦**：

```
现在：submit → await 结果 → 仅 success 才记账
```

三种真实失败形态下，内容已经到达平台但应用不记账：任务超时（`task.timeout`，
视频上传 30 min 预算）、执行器抛错但平台侧已成功、重试环（`task:retry`）重入。
`_publishIntervalGuard` 一旦接上，这三条都会导致**下一次发布不受限**，
而重试会再发一遍。

改为：

```
检查两档 → 任一未满足 = 重排等待并返回；满足 = 立即对两档记账 → 再 submit
```

副作用是记账变成"乐观记账"：**任务失败也会占用一个间隔窗口**。这是正确方向——
限流窗口在平台侧按"请求已发生"计时，不按"应用是否解析到成功"计时。
失败重试因此会等待一个完整间隔，属可接受的保守代价（重试在本产品里是罕见路径，
且 `retry: 2` 已有语义）。此取舍必须在 PRD 明示，否则用户会以为"失败可以立刻重发"。

顺带消除的宿主契约违反：`base-store.js:61-66` 要求异步服务在开始时持有 owner 快照、
不得在回调/定时器中重读登录态。guard 的 store 适配器（`container.setup.js:332-340`）
调 `store.getPublishTimeline(key)` / `setPublishTimeline(key, ts)` **不传 ownerSubject**，
走的是环境登录态。原实现把 `setPublishTimeline` 放在 `await Promise.race(...)` 之后，
正是被禁止的形态；前移后所有 guard 读写都落在 `_executeTask` 顶部
`await` 之前的同一同步段，环境值与 `task.owner_subject` 必然一致。

## D-4 重排等待的生命周期（沿用现有实现，不重写）

`task-queue.js:475-484` 已有正确形态，本次保留并补齐语义：

- 回退 `task.status = 'pending'` + `startedAt = null` + 从 `_running` 移除，
  **不消耗 `retriesLeft`**（等待不是失败）；
- `setTimeout` 句柄登记进 `_pendingTimers` 并 `unref()`，`shutdown()` 统一清理
  （`:49` 已把 `_delayed` 中的任务标为 cancelled，退出时不会留下幽灵等待）；
- 重排回队列头 `_queue.unshift(task)` 保持相对顺序；
- 等待期间 `cancelRequested` 必须被再次检查（`:478` 已有）。

新增要求：**同一 tick 内多个任务并发等待同一窗口时不得互相饿死**。
`_processNext` 的 `inspected` 计数（`:443-446`）已防止无限轮换，
但若两档等待时间不同，需要保证重排后仍能被下一次 `_processNext` 取到——
由 `setTimeout` 回调内显式调用 `_processNext()` 保证（`:480` 已有）。

## D-5 接线修复的最小改动

```js
// container.setup.js:324  —— 从「不注入」改为工厂内引用
container.register("taskQueue", function(c) {
  return new TaskQueue(Object.assign(
    { maxConcurrent: 3 },
    options.taskQueue,
    { publishIntervalGuard: c.get("publishIntervalGuard") }
  ));
});
```

顺序刻意让 `publishIntervalGuard` 排在最后：注入的 guard 是机制本身，
不允许被 `options.taskQueue` 覆盖成 `undefined` 而静默关掉了事。

`phase3-services.js:95` 的死变量**必须删除**而不是"用起来"——
它的全部作用是让下一次审计误以为"已经接线了"。这属于 AGENTS.md 点名的
「装饰性门禁」：存在、被读取、被测试 mock（`phase3-services.test.js:31` 给的是空对象 `{}`），
但对运行行为零贡献。

## D-6 防再犯（本设计的核心诉求）

本次事故的形态是：**两侧实现都对、两侧测试都绿、生产调用点为 0**。
60+ 条 `publish-interval-guard` 与 `task-queue-guard-integration` 测试全绿却守不住任何东西，
因为它们都在测试内部 `new` 出 guard 并手工注入，从不经过生产的装配路径。

因此回归锁必须有第三类：**装配锁**，断言生产容器里 `taskQueue` 拿到的 guard
不是 `null`。且必须做一次把装配改回原样的**反证**（`publishIntervalGuard` 摘掉 ⇒ 必须变红），
否则该锁本身可能就是装饰性的（AGENTS.md「反证纪律」：任何"防再犯锁"必须做一次
把锁本身改成 no-op 必须立刻变红的变异）。
