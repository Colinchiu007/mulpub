# log-injection-sanitization (delta)

## ADDED Requirements

### Requirement: 外部可控文本入日志前必须消毒
任何来自第三方/用户/错误栈的可控文本（如 `e.message`、平台回传 error、用户草稿片段）在写入日志行或经 `logger.notify` params 传递前，必须去除换行符（`\n` `\r`）与控制字符（`< 0x20` 且非 `\t`），防止 log injection 伪造日志行。

- 既有 `logger.notify` 已对 meta 段 `JSON.stringify` + `redact`（脱敏凭证，logger.js L218-222），但**不处理换行/控制符**；本需求补齐控制字符消毒作为 `notify` 的 meta 预处理（新增 `sanitizeLogMetaValue` 或复用 `redact` 增强）。
- 字符串 concat 路径（如 publish.js L314）改为先 `sanitizeControlChars(e.message)` 再拼接，或直接迁移 notify（见 ipc-publish-logging）。

#### Scenario: 含换行的错误消息被消毒
WHEN 记录 `error="line1\nline2"` 到 notify params.error
THEN 落盘 meta 中 `\n` 被替换为空格（或转义），不出现真实换行导致日志行分裂

#### Scenario: 含控制字符的用户文本被消毒
WHEN 记录含 `\x00`/`\x1b` 的第三方回传文本
THEN 控制字符被剥离，不污染日志格式

#### Scenario: 凭证仍被脱敏（不回归）
WHEN 文本含 `Bearer xxx`/`sk-...`/cookie
THEN 仍被 `redact` 脱敏（既有契约，不因消毒改动而失效）

### Requirement: log-injection 回归测试作为 QM-3 风格门禁
新增回归测试，断言：(a) 含注入载荷的错误消息在日志中保持单行且不含伪造的 `[NOTIFY]`/`[timestamp]` 前缀；(b) 既有 QM-3 gate（publish-account-logging.test.js）在注入载荷下仍只匹配预期 messageKey。

#### Scenario: 注入载荷不分裂日志行
WHEN 向 logger 注入 `e.message = "ok\n[NOTIFY] evil module fake"` 并触发 publish:batch error
THEN 该日志行在 recorder 中作为**单一字符串**出现，不含以 `[NOTIFY]` 开头的伪造行

QM-3 断言：新增 `apps/desktop/electron/services/log-injection-sanitization.test.js`（单元级，测 `sanitizeControlChars` + `logger.notify` 输出单行性）+ 扩展 `publish-account-logging.test.js` 注入用例。
