# Requirements：CCG 双模型审查修复

来源：`C:\tmp\mp-ccg-dual-review-20260808.md`（2026-08-08）

## W1（Claude）脱敏正则覆盖下划线/驼峰/中文键
`toPublicErrorValue` 原 `\b` 词边界对 `access_token`、`refreshToken` 等不成立。修复为正则 `(^|[^\w])(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|access[_-]?key|app[_-]?secret|session[_-]?id|pwd|passwd|token|cookie|password|secret|authorization|令牌|密钥|密码)\s*[:=：]\s*[^\s,;]+(?:,[^\s,;]+)*`；保留 Bearer 脱敏。补 `access_token`、`refreshToken`、`api_key`、中文键、逗号值反例测试。

## W2（Claude）二维码预览生命周期
验证 `useAccountEvents` 在 reopen/completed/closed/stop 清空 `qrImage`（代码已满足），补充 reopen 与 closed 清空测试；二维码 img 增加 `referrerpolicy="no-referrer"`。

## W3（GPT-5.6）双 IPC 路径契约
`accounts:list`（后端）与 `account:list`（本地）都经 `toPublicAccount`。新增契约测试：同一 raw account 走两条路径输出完全一致且字段脱敏。

## W4（GPT-5.6）publishers 复数键
`publicAccountAliases.publisher` 增加 `publishers`、`publisher_list`；`toPublicMetadataValue` 支持数组元素归一化，renderer 复数分支不再死代码。

## Info 修复
- I2：`status?.configured` 判空。
- I3：字符串代理端口归一化（`Number(port)` + 1..65535 校验）。
- I4：二维码 img 加 `referrerpolicy="no-referrer"`。
- I1：核实 `AccountManager.setAccountProxy` 已返回 `toPublicProxyConfig` 脱敏结构，无需改动。
