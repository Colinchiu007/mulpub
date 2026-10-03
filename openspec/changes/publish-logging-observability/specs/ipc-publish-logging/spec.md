# ipc-publish-logging (delta)

## ADDED Requirements

### Requirement: publish:batch 成功日志保留 platform→accountId 映射
`apps/desktop/electron/ipc-handlers/publish.js` L311 的成功日志必须携带每个 target 的 platform 与 accountId（不丢失，修复 P0-3），并迁移到 `logger.notify` 结构化（P1-1）。

#### Scenario: publish:batch ok 记录完整映射
WHEN `publish:batch` 成功，taskIds 由 normalizedTargets（含 platform/accountId）生成（L301-310）
THEN 落 `notify('PublishIPC','batch-ok',{params:{taskCount,platforms:['baijiahao:acct-1',...],durationMs},level:'INFO'})`，params.platforms 含 `platform:accountId`

### Requirement: publish/account IPC 迁移到结构化 notify
`ipc-handlers/publish.js` 与 `ipc-handlers/account.js` 的 `ipcLog(level,channel,stage,detail)` 字符串拼接改为 `logger.notify(module,messageKey,{params,errorCategory,level})`，messageKey 与既有 gate（account:delete/auth:open-login/accounts:list/cover:extract/publish:batch enter）保持一致。

#### Scenario: publish:batch 错误迁移 notify
WHEN `publish:batch` 进入 catch（L313-315）
THEN 落 `notify('PublishIPC','batch-error',{params:{durationMs},errorCategory:'batch_failed',level:'ERROR',error:sanitized})`（替代 L314 的裸 concat，error 经消毒见 log-injection-sanitization）

#### Scenario: account:delete 既有 gate 仍满足
WHEN `account:delete` 成功
THEN 仍落既有的 `info 'account:delete' 'ok' 'd39af89b'`（QM-3 gate 不回归），且新增等效 `notify('AccountIPC','delete-ok',{params:{accountId:'d39af89b'}})`

QM-3 断言：扩展 `apps/desktop/electron/ipc-handlers/publish-account-logging.test.js`，断言 batch-ok 含 `platform:accountId`、batch-error 走 notify 且 error 经消毒、account:delete/auth:open-login 既有断言不回归。
