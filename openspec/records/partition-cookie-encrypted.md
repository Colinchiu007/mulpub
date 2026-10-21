# 本次执行记录：分区 cookie 外部可读性验证（partition-cookie-encrypted，2026-10-21）【docs-only】

- 分支：`partition-cookie-encrypted`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（含 openspec/records 载体 + PRD）
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动机

Round 51（PR #4162）已证明信封库凭据无法绕开 GUI 取得。
本轮补一条**独立证据源**：分区 cookie 是否可读？若可读，就能不启 GUI 验证发布链。

## 二、实测（两个事实）

抖音分区 `rpa-douyin-01ab122e`：

| 观察 | 读数 |
| --- | --- |
| `Cookies` 文件大小 | **53248 字节** |
| mtime | 05:15（本轮前不久，说明应用在写） |
| `ctx.cookies()`（全部域） | **0 条** |
| `ctx.cookies('https://creator.douyin.com')` | 0 条 |
| 关键键 `sessionid`/`sessionid_ss`/`sid_tt`/`odin_tt`/`msToken`/`passport_csrf_token` | 全部 false |

⇒ **文件在增长，但外部读不出内容**。

## 三、结论与确定性边界

**结论**：分区 cookie 也无法在应用外读取 ⇒ 与信封库（#4162）双点支撑
"无法绕开 GUI 取凭据"，唯一可行途径是经 GUI 应用自身（`publish:batch` IPC）。

⚠ **成因的确定性边界**（CCG i1 裁决后降级表述）：只确证上述两个**事实**；
"Chromium 凭据加密导致读不出"是**解释之一**，未排除的其他解释包括：
Playwright 不认 Electron 分区结构、cookie 为 session-only 随进程退出即消失、
或 domain 落在 Electron partition 命名空间。**不要把这条成因当定论。**

## 四、顺带修正一处此前的解读

§16.18.2 里我用分区 cookie 调 `auth_data` 得 300330，当时解读为
"分区凭据与信封库不同步"；现在看更可能是**分区 cookie 本身就读不出来**
（那次有反应是因 Playwright 自起 profile，某些未加密字段仍在）。

⇒ 教训：**外部探测拿不到有效凭据时，不要把"探测失败"归因成"凭据失效"，
   应先确认"凭据是否真的取到了"。**

## 五、读数

| 项 | 读数 |
| --- | --- |
| `check-doc-abs-paths` | PASS |
| `check-text-encoding-integrity` | OK |
| `check-no-brand-residue` | PASS |
| `classify-docs-only` | false（含 openspec/records 载体） |
| `check-pr-exec-record` | 首跑**不通过**（漏写本记录）→ 补写后 OK |
| CCG 深度审查 | self_play_resolved（i1 指出成因表述过强 ⇒ **已按裁决降级文档表述**） |

## 六、远程同步

| 远程同步 | 由门禁推导 |
