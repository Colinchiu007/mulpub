# 本次执行记录：头条全链真机预演 + wrapper/CRC 回归修复（toutiao-cover-integration 分支追加，2026-10-20）

- 分支：`toutiao-cover-integration`（同分支第三、四提交）
- 前序：#4038（接线 `b7ca111d`）

## 一、全链真机预演（当前代码、活 cookie）——每层都真实可复现

| 层 | 真机读数 |
| --- | --- |
| ① 提交前闸门（#3977） | `identityVerified=false` → **ACCOUNT_NOT_VERIFIED 拦截**（预演模式跳过继续） |
| ② 封面五步链（#4038 代码） | PUT 204（带 CRC32）→ `GetImageUploadInfos` 登记 → `result_uri=tos-cn-i-e874c6/oEfq3xZDRID1gWuEQgFGkEAaANA4IgCeoSANDT`（1280×720 jpeg md5=2028…） |
| ③ 视频 VOD | 新 `Vid=v0dd16g10004dbb839fog65j3kns2lb0` |
| ④ PublishVideo | `Code 21000 未实名认证/帐号不可用` + **`accountGate=true` 被 parsePublishResponse 正确识别**（#4019 提交时兜底真机验证通过） |

**终态：账号墙(21000)——技术链全通。** 账号一实名，同一套代码直接出 `ItemId`。

### 1.1 回归复跑（2026-10-21，main tip `1c473767`）

在之后又合入多个 PR（#4050/#4055/#4057/#4110/#4112/#4113）**之后**重跑同一预演，验证无回归：

| 层 | 复跑读数 |
| --- | --- |
| ① 闸门 | `identityVerified=false` → ACCOUNT_NOT_VERIFIED 拦截（不变） |
| ② 封面五步链 | 登记 `uri=tos-cn-i-e874c6/oIAAbnIQIBAVJpreToLavcG5ywMDeimbGE6zAf`（1280×720 jpeg，md5=2028…）✅ |
| ③ 视频 VOD | 新 `Vid=v03d16g10004dbbt31fog65ob914fst0` ✅ |
| ④ PublishVideo | `Code 21000` + `accountGate=true` ✅（与首次预演同构） |

⇒ **技术链在多次合并后无回归**；唯一阻塞仍且仅是账号实名。

## 二、预演抓到并修复的两个真 bug（都在 #4038 引入的代码里）

### 2.1 wrapper 变量名/透传 bug（Critical）

`uploadLocalCoverFor` 里 L198 用 `o.vasClient` 但形参解构名是 `opts`，且 `axiosLike: chain.mp` 硬编码、
`tosBaseUrl` 未透传 —— **第三参省略（生产路径）时必崩**（`o` 为 undefined）。测试没覆盖这条路径所以 #4038 漏网。

修复：`opts.vasClient || createHttpClient(...)` / `opts.axiosLike || chain.mp` / `tosBaseUrl: opts.tosBaseUrl` 三处透传。
回归锁：cover.test 新增「第三参省略（生产路径）」用例（不带 onProgress/vasBase，仅注入测试域）。

### 2.2 PUT 缺 CRC32（Critical，真机才暴露）

真 tos 服务端校验 `Content-CRC32`：缺失 → `4007 MismatchChecksum`（HTTP 400）。
单测的假服务器不校验 CRC 所以 8 例全绿 —— **单测绿 ≠ 真机通**，预演第一次跑就抓到。
修复：`uploadCoverImage` 内置 `crc32hex()` 并在 PUT 头加 `Content-CRC32`。

## 三、读数

| 项 | 读数 |
| --- | --- |
| `toutiao-video-cover.test.js` | **9 passed**（8+1 回归锁） |
| `packages/api-publish-engine` 全量 | rc=0（45 文件） |
| `check-max-lines` | ✅ |
| 真机预演 | 全链四层全通，终点 21000（预期） |

## 四、远程同步

| 远程同步 | 由门禁推导 |
