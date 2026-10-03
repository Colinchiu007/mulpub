# PRD — 作品发布频率控制（publish-frequency-control）

- 日期：2026-10-02
- 状态：已实现，待评审
- 关联：`openspec/changes/publish-frequency-control/`（proposal / design / specs / tasks）
- 决策来源：用户 2026-10-02 会话决策 D1（全部排队等待）、D2（同平台跨账号维度）、D3（工程保守默认 + 可配置）

## 1. 背景与问题

运营侧通过 CDP 自动化测试发布功能时发现：**相邻两次发布的间隔只有 1–2 分钟**，
足以触发平台限流或违规处罚。排查结论不是"间隔配得松"，而是**发布频率控制在运行时完全不存在**。

机制本身早已实现且有 60+ 条单元测试，但从未被装配：

| # | 断点 | 位置 |
| --- | --- | --- |
| 1 | TaskQueue 从未收到守卫 | `apps/desktop/electron/core/container.setup.js` 注册 `taskQueue` 时只传 `{ maxConcurrent: 3 }` |
| 2 | 唯一逃生口也是死的 | `apps/desktop/electron/bootstrap.js:77` 调 `createContainer()` 不带任何参数 |
| 3 | 守卫实例取了没用 | `apps/desktop/electron/bootstrap/phase3-services.js` 读入 `_publishIntervalGuard` 后全文件再无引用 |

实测取证（只读，非推断）：

- `recordPublish` / `canPublish` / `getRemainingWait` 生产调用点 **0**，仅测试引用；
- `publish_timeline` 表在 `shared-user-data/multi-publish.db` 与
  `Multi-Publish-debug-profile/multi-publish.db` 中**均为 0 行**；
- 三条发布入口全部直达队列且无节流：`ipc-handlers/publish.js`（`publish:wechat` / `publish:batch`）、
  `services/batch-manager.js`、`services/offline-manager.js`；
- 队列 `maxConcurrent: 3` ⇒ 一键发布多平台时**最多 3 个发布并发提交，间隔 0**。

**结论**：用户点「一键发布」会复现与 CDP 相同的密集提交，CDP 只是把既有缺陷显性化。

## 2. 目标与非目标

### 目标

- G1 同账号同平台连发被按平台策略错开；
- G2 同平台**跨账号**连发也被错开（平台风控常按设备/平台聚合）；
- G3 无账号身份（`accountId` 缺席）的发布**不得**成为绕过口；
- G4 间隔等待对用户可见（进度面板显示等待与剩余时间），不得表现为"卡死"；
- G5 数值可运营调优，且改一处生效（单一真源）。

### 非目标（明确不做）

- **不做设备/IP 级全局串行**：跨平台并发发布是本产品核心用途（一键发 5 个平台），
  设备级串行会废掉核心功能。代价：同机多平台同时提交时，各平台各自只看到 1 条，
  但同一出口 IP 的总请求速率仍不受本机制约束。
- 不做每日发布条数上限（quota），仅做最小间隔。
- 不做平台规则同步：不声称"符合平台官方规定"。
- 不在设置页暴露间隔配置（本期仅环境变量 + 代码表），避免为无人消费的路径造 UI。

## 3. 功能清单

| 优先级 | 功能 | 说明 |
| --- | --- | --- |
| P0 | 频率守卫装配 | 守卫经 DI 注入 `TaskQueue`，生产调用点 > 0 |
| P0 | 两档最小间隔 | 账号档 `platform:accountId` + 平台档 `platform:*`，取更严一档 |
| P0 | 提交前记账 | 检查通过后、调用执行器**之前**记账；失败/超时不回滚 |
| P0 | 缺席账号仍受控 | `accountId` 为 null/空时跳过账号档、保留平台档 |
| P0 | 等待可见 | 复用既有 `phase:'blocked'` / `stageKey:'waiting'`，不新增相位 |
| P1 | 策略可覆盖 | `MP_PUBLISH_MIN_INTERVAL_MS` / `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS` |
| P1 | 装配回归锁 | 断言真实容器里队列拿到守卫，摘掉注入即红 |

## 4. 间隔策略（单一真源）

真源文件：`packages/shared-utils/src/publish-frequency-policy.js`。

⚠️ **下列数值是工程保守默认（宁慢不险），不是任何平台的官方规则**，
需按真实运营数据校准。刻意**不放进 `publish-capabilities.json`**：
该注册表承载内容能力（titleMode / 字数限制 / 字段矩阵），与调度节奏是两类关注点。

| 组 | 平台 | 账号档 | 平台档（跨账号） |
| --- | --- | --- | --- |
| 长文低频 | wechat_mp, zhihu, baijiahao, toutiao | 60 分钟 | 5 分钟 |
| 短视频 / 图文社区 | douyin, kuaishou, tencent_video, xiaohongshu, bilibili, youtube, tiktok, instagram, facebook | 30 分钟 | 3 分钟 |
| 短内容高频容忍 | weibo, twitter | 10 分钟 | 60 秒 |
| 未登记平台（回落） | 任意未知 | 60 分钟 | 5 分钟 |

规则：

1. 未登记平台回落**最严基线**，不得回落 0（新增平台忘记登记 ⇒ 按最严处理，而非不设防）；
2. 环境变量取 `0` = 显式关闭该档；未设置 = 回落策略表；
3. 非法值（非有限数 / 负数 / 空白）回落默认并**出声告警**，禁止静默当 0
   （否则"配置写错"会静默变成"关掉门禁"）；
4. 除本模块外不得存在第二份间隔常量表。渲染层 `publish-contract.js` 的
   `DEFAULT_MIN_ACCOUNT_INTERVAL_MS` 是**定时发布表单的输入期校验**，
   属另一件事，不得被当作运行期门禁。

## 5. 交互说明

### 5.1 被间隔挡住时（决策 D1：全部排队等待）

1. 任务回到等待队列，`status='pending'`、`startedAt=null`，从运行集合移除；
2. 发 `publish:blocked`，主进程转发为 `publish:progress` 的 `phase:'blocked'`、
   `stageKey:'waiting'`，携带 `remainingWait`（ms）与 `bucket`（account / platform）；
3. 进度面板该任务行显示时钟图标 + 剩余等待文案（`PublishProgressTaskRow.vue` 既有能力）；
4. `setTimeout` 到点后重新入队头并继续走正常 `start → progress → success`；
5. 等待**不消耗** `retriesLeft`（等待不是失败）；
6. 等待期间用户取消 ⇒ 重排回调发现取消标记后不再入队；
7. 应用退出 ⇒ 所有重排定时器被清理，等待中的任务标记为取消，不留悬挂句柄。

`blocked` 不是终态，任务的终态仍只由 `task:success` / `task:failed` / `task:cancelled` 决定。

### 5.2 已知代价（必须让用户与运营知情）

- **乐观记账**：一次发布无论成败都占用一个间隔窗口。因此**失败后不能立刻重发**，
  需等满窗口。取舍理由：平台按"请求已发生"计窗口，若只在成功路径记账，
  "内容已发到平台但应用判超时/报错"（视频上传 30 分钟预算下并不罕见）
  会既不占窗口又被重试 ⇒ **重复发布**，比"多等一会儿"严重得多。
- **同平台多账号串行化**：一键把同一平台发给 2 个账号时，第二条会等满平台档（3–5 分钟）。
- **运行期档位与定时表单校验是两套口径**：`publish-contract.js` 的
  `DEFAULT_MIN_ACCOUNT_INTERVAL_MS`（5 分钟扁平值）只校验**定时发布表单的输入**，
  不是运行期门禁；运行期账号档按平台为 10/30/60 分钟。因此"排两条 10 分钟后的同平台微博"
  能通过表单，但第二条会在运行期进入 `blocked` 等待。这是有意保留的分层
  （输入期校验管的是"排期是否明显不合理"，运行期管"是否踩平台窗口"），
  代价是用户可能看到"表单放行、运行期排队"，界面用 §7 的归因标签解释这一秒数从哪来。
- **重启后仍受限**：记账落 SQLite `publish_timeline`，跨重启有效（这是设计意图）。
  持久化由 `base-store.js` 的 5 秒 dirty 定时器承担，因此**强杀进程**最多丢失最近 5 秒的写入；
  相对分钟级的间隔窗口不构成有意义的绕过口，故本机制不额外加显式 flush。

## 6. 验收标准

| # | 场景 | 预期 |
| --- | --- | --- |
| A1 | 真实容器构建后取 `taskQueue` | 内部守卫非 null 且与 `publishIntervalGuard` 同一实例 |
| A2 | 同账号同平台连续两次发布 | 第二次被挡，`bucket='account'`，到点后自动发出 |
| A3 | 同平台不同账号连续两次发布 | 第二次被挡，`bucket='platform'` |
| A4 | `accountId` 缺席（wechat / 字符串目标） | 无历史时正常发出；有同平台历史时被挡 |
| A5 | 发布失败或超时 | 该账号/平台窗口仍被占用；后续同窗口提交被挡 |
| A6 | 失败重试 | 重试等满窗口后发生，`retriesLeft` 未被等待消耗 |
| A7 | 等待中取消 | 不再入队、不提交 |
| A8 | 未登记平台 | 回落最严基线，非 0 |
| A9 | 环境变量非法值 | 回落默认且日志出现一次告警 |
| A10 | 摘掉守卫注入 / 记账挪回成功路径 / 缺席跳过检查 / 守卫改 no-op | 四种变异各自让对应回归锁变红（已实跑） |
| A11 | `accountId` 只在任务级（`article` 不带）且平台档窗口已过 | 账号档仍生效并挡住，`bucket='account'`；取错源则任务立即发出且无 blocked 事件（已作为行为锁实跑，变异回旧取值源必红） |
| A12 | 等待中的任务在进度面板 | 除「等待 N 分钟后重试」外，还显示归因（本账号间隔 / 同平台其他账号间隔）；归因缺席时不显示标签，不猜档 |

## 7. 可观测

- 主进程日志沿用 `publish:progress` 单一发射点，渲染层不得自造阶段映射；
- 阻塞归因由 `bucket` 承载（account / platform），从队列一路到界面只有一份投影：
  `task-queue` 发事件 → `phase4-events` 转发 → `publish-progress-events` 投影白名单 →
  `publishProgress` store → `PublishProgressTaskRow` 的等待行文案后缀
  （`（本账号间隔）` / `（同平台其他账号间隔）`，zh/en 成对）。
  字段缺席时如实为 `null` 且不渲染后缀——"没拿到证据"不得渲染成某一档；
- 排查入口：查 `publish_timeline` 表（键 `platform:accountId` 与 `platform:*`）即可看到实际占位。

## 8. 风险与后续

- 数值未经真实运营校准 ⇒ 首期偏保守；若运营反馈"等太久"，
  正解是改策略表并按平台补测，**不得**在调用点各抄一份，也不得用 `--no-verify` 式绕过。
- 未做每日条数上限：突发批量（一次 20 条 × 6 平台）在长间隔下会被拉得很慢，
  属预期行为；若需要"每天 N 条"语义，应另立 change 引入 quota 维度。
- `publish_history` 表无账号列 ⇒ 无法按账号审计历史发布节奏；
  本次未纳入范围（改动面涉及历史数据迁移），记为后续项。
