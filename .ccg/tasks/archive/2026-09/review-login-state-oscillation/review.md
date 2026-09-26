# Review: 登录态状态机修复

## Findings

1. **major** — `apps/desktop/electron/ipc-handlers/account.js:77-100`
   - `readAccountSnapshot()` 失败时返回 `null`，`persistCheckOutcome()` 随后把 `currentStatus` 当成缺失并落 `unverified`。
   - 这与“无证据不得改写既有结论”的核心不变量冲突：读不到真源不等于账号没有结论。单账号检测在真源 GET 瞬时失败时，仍可能把 active 降级。
   - 建议：真源读不到时返回“本轮不改写/无法判定”或失败结果，不要用 `unverified` 猜测。

2. **warning** — `apps/desktop/electron/publishers/account-manager.js:1040-1044`
   - `loginStatusFromCheckResult()` 仍是独立的旧三态映射，且把无定论映射成 `unverified`。
   - 虽然当前生产链路已改用 `loginStatusTransition()`，但该公开出口和测试仍在固化旧语义，削弱“唯一实现”的收敛效果。
   - 建议：删除该出口，或让它转发/适配新规则，并同步更新测试，避免第四份口径回潮。

3. **warning** — `apps/desktop/electron/services/login-status-monitor.js:77-80`
   - 监控层仍把 `online` 当作可检测的既有状态，但 `packages/shared-utils/src/login-state.js:62` 会把非 `active`/`expired` 的状态（含 `online`）在无定论时落成 `unverified`。
   - 后端当前会把 `online` 归一化为 `unverified`，所以生产影响有限，但这是同一状态机内的兼容口径不一致。
   - 建议：统一 `online` 的兼容策略，或在监控层移除 `online` 分支并补一条回归说明。

4. **major** — `apps/desktop/electron/ipc-handlers/account.js:637-650`
   - `statusChanged` 实际语义是“真源是否被改写”，不是“status 值是否变化”。例如现状 `unverified` + 无定论时，状态仍是 `unverified`，但 `statusChanged` 为 `true`，并且会刷新 `last_validated`。
   - 这会让无定论检查继续污染“最近检查/定论时间”，违背“无新证据不改写真源”的意图；新增的未提交测试 `批量：无定论且现状本就是 unverified → 不发冗余 PATCH，也不伪造 last_validated` 当前正好失败。
   - 建议：在规则层把 `currentStatus === 'unverified'` 且无定论的情况返回 `null`，或在 `persistCheckOutcome()` 中先比较 `next` 与 `currentStatus`，值未变且无新证据时直接跳过写库。

5. **minor** — `packages/python-backend/src/server.py:515-527`
   - 新建账号在 `status=unverified` 时就写入 `last_validated=now`，而 `persistLoginState()` 也会在任意状态固化时更新该字段。
   - 新规则只在 `active` 分支消费它，因此当前不会直接破坏 7 天兜底，但字段名与“最近一次有效验证”的直觉不一致。
   - 建议：在契约文档中明确 `last_validated` 的真实语义，或后续迁移为 `last_status_at` / `last_conclusion_at`。

6. **minor** — `apps/desktop/electron/ipc-handlers/account.test.js:1151-1237`
   - 测试覆盖了 active/expired/超龄/异常/超时，但缺少“现状 unverified + 无定论”时是否应改写、`statusChanged` 应为何值的集成断言。
   - 建议补一条 IPC 层用例，锁住 unverified 分支的落库与返回体语义。

## Verification

- 相关 5 个测试文件：192 passed。
- 桌面端全量测试：11639 passed，1 failed（`feedback.test.js` 因 Windows 临时目录 `EPERM symlink` 失败，属环境问题，与本 diff 无关）。
- 双模型审查入口不可用（`codeagent-wrapper.exe` 不存在），已按项目降级规则由主代理完成审查。
