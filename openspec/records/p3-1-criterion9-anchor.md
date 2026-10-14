---
record: p3-1-criterion9-anchor
task: 修 P3-1 判据⑨ 的假绿（正则缺 m 标志）+ 链名别名（视频号 shipinhao）
date: 2026-10-15
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：修 P3-1 判据⑨ 假绿（p3-1-criterion9-anchor，2026-10-15）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 含 `scripts/`
  ⇒ **混合 PR**，走完整质量节拍。

## 现场：判据⑨ 对 6/15 个平台是**假绿**

上一轮（P3-2 方案 A）我在逐条定性 11 个失败时注意到一件怪事：
**`tencent_video` 的 `has_api: true`，且 `publish/platforms/` 下没有 `tencent_video-*.js`，
却**通过**了判据⑨「has_api 与发布链/登记表一致」。**

写探针复刻判据后找到根因 —— `scripts/verify-platform-onboarding.js:165`：

```js
const hasApi = /^[ \t]{4}has_api:[ \t]*true/.test(block)   // ← 缺 m 标志
```

**⇒ 没有 `m` ⇒ `^` 只锚**字符串开头** ⇒ 该判据**只在「块的第一行恰好是 `has_api`」时才真正执行**；
其余一律走 `if (!hasApi) return { ok: true, detail: 'has_api 非 true ⇒ 无需发布链' }` ⇒ **判通过**。**

实测 15 个平台（探针输出，逐平台对照「现用判据」与「应有判据」）：

| slug | 块首行 | 现用(无`m`) | 应有(带`m`) | 链数 |
| --- | --- | --- | --- | --- |
| `douyin` | `# 2026-10-06 修正…` | false | **true** | 2 |
| **`tencent_video`** | `id: 21` | false | **true** | **0** |
| `kuaishou` | `id: 35` | false | **true** | 1 |
| `bilibili` | `id: 23` | false | **true** | 1 |
| `baijiahao` | `id: 4` | false | **true** | 1 |
| **`facebook`** | `id: 104` | false | **true** | **0** |
| `youtube` | `has_api: true`（恰好首行）| true | true | 0 |
| `twitter` | `has_api: true`（恰好首行）| true | true | 0 |

**⇒ 6 个平台从未被检查；其中 `tencent_video` 与 `facebook` 是 `has_api: true` 却 0 个链
—— 真缺口被这条假绿藏住了。**

**⇒ 只有恰好把 `has_api` 写在块首行的 `youtube` / `twitter` 被正确抓到
（所以我上一轮在 B 类里只看见了这两个）。**

## 这是「假绿」母题的第 N 次同型实例

| # | 形态 | 实例 |
| --- | --- | --- |
| ① | 判据被改宽 | 黑名单枚举之外一律放行 |
| ② | 判据空转 | `structure-lock` 的 `assert([]).toContain(k)` 空循环 |
| ③ | 判据未被激活 | 遍历式判据 + 新增文件 |
| ④ | 判据在该环境无能力 | `check-doc-abs-paths` 在无盘符的 CI 上跳过逐文件核对 |
| **⑤** | **判据只在多数输入的少数上执行** | **本条：一个正则标志位的缺失** |

**★ ⑤ 的隐蔽性最高**：逻辑读起来完全正确（「若 has_api 为真则查链」），
只有**正则标志位**这一个字符决定了它是否执行。**代码审查看不出，只有跑数据才显形。**

## 修法（两处）

| # | 改动 | 依据 |
| --- | --- | --- |
| ① | 正则加 `m`：`/^[ \t]{4}has_api:[ \t]*true/m` | 无争议：让判据做它字面声明的事 |
| ② | 新增 `CHAIN_NAME_ALIASES = { tencent_video: 'shipinhao' }` | 视频号的链叫 `shipinhao-video.js` / `shipinhao-music.js`；**证据**：`config/platforms.yaml` 的 tencent_video 块自带注释「使视频号完整链（src/publish/platforms/shipinhao-video.js，分片 + Content-MD5 + post_draft/post_create 双分支，带链级测试）从未被触发」。**没有这张表时，判据因命名差异误报「无链」——那是判据错，不是平台错。** |

**★ 为什么别名要写进判据而不是改平台配置**：`has_api: true` 对视频号是**事实**
（链确实存在），错的是判据对「链文件名 = slug 前缀」的假设。

## 修好后新暴露的（如实登记，不代改）

| slug | `has_api` | `publishMode` | 链 | 定性 |
| --- | --- | --- | --- | --- |
| **`youtube`** | true | **dom-only** | 无 | ⚠️ 三个字段互相矛盾 |
| **`twitter`** | true | **dom-only** | 无 | ⚠️ 同上 |
| **`facebook`** | true | **dom-only** | 无 | ⚠️ 同上 |

**⇒ 「声明有 API 能力」+「只走 DOM」+「无实现」三者不可能同时为真。**

**⇒ 处置：登记为待裁定项（`STEP9_CHAIN_GAPS`），由平台 owner 决定「补链」还是「改 `has_api`」。
本 PR 不代改 —— 与上一轮处理 B 类的原则一致。**

## 验证

| 项 | 结果 |
| --- | --- |
| P3-1 脚本自测 | **16/16**（无回归）|
| `FULLY_COMPLIANT` 快照 | 未变（`douyin`/`xiaohongshu`/`kuaishou`/`bilibili` 仍全 PASS）|
| `tencent_video` 判据 ⑨ | **PASS**（别名生效）|
| 判据 ⑨ 失败集合 | `youtube` / `twitter` / `facebook`（3 个，如实报到）|

## 教训

**一个正则标志位可以让整条判据在多数输入上不执行，且逻辑读起来完全正确。**

**⇒ 处方：写「条件式判据」时，凡是 `^` / `$` / `.` 这类**锚定与跨行**语义，
  必须在测试里用**真实数据**覆盖「条件为真但不在首行」的输入 ——
  本条的 `facebook` 恰好就是这种输入（`has_api: true` 不在首行 + 无链 ⇒ 应 FAIL），
  把它钉成回归锁即可：**去掉 `m` 就当场变红。**
