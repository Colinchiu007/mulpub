# B 站审核回查真机取证（2026-10-07，一次真实投稿 + 全程回查）

> 承接 `docs/audit-requery-evidence-bilibili-2026-10-05.md`。10-05 那轮是**只读**，其 §四.1 记「审核中/不通过的 `state` 取值本机无现场」，并判定「需要一次真实投稿才能观测」。
> 本轮把那次投稿花掉了，**§四.1 的「审核中」那一格已填上**，并额外跑出一条真实断链。
> 落位在 `docs/`（doc-gate 代码 PR 白名单只认 `docs/**`、`openspec/**`、`.ccg/**`、根 `*.md`）。

- 取证时刻：2026-10-07T08:31:49Z ～ 08:32:33Z（投稿 → 回查收敛，共 44 秒）
- 账号：`bilibili / ca681b37`（`mid=3747542357510297`，`status=active`）
- 运行态：本仓应用，worktree `mp-bilibili-audit-buckets`（含分桶查询实现），共享 profile `shared-user-data`
- 触发方式：经 CDP 在渲染层调 `window.electronAPI.publishBatch(platforms, article)` → `publish:batch` → 队列 → API 轨发布
- **授权口径**：用户 2026-10-07 明确「要发，接受公开」；投稿后进一步指示「已发的内容就不用删了」⇒ **稿件保留，未删除**（见 §六）

---

## 一、投稿载荷与结果

载荷（最小、可识别为测试稿）：

```
title      = 自动化取证测试稿 请忽略 稍后删除
content    = 这是发布链路自动化取证用的临时稿件，用于验证发布后审核状态回查，取证后即删。
video_path = .ccg/tasks/archive/2026-09/video-clone-real-url-e2e/multi-scene-src.mp4
             （640x360 / h264+aac / 6.0s / 76,657 B —— 账号内已有 9s 稿件，短视频可投）
category   = 21    copyright = 1（自制）    aiGenerated = false
```

`aiGenerated` 显式传 `false`：素材来自仓库既有 E2E 产物，是否 AI 生成**未经核实**，不主动声明以避免不实标注。实测该选择不阻断投稿。

队列结果（`getQueueHistory()` 现场）：

```json
{"id":"task_1_1791361909906","platform":"bilibili","status":"success",
 "startedAt":"2026-10-07T08:31:49.912Z","completedAt":"2026-10-07T08:31:52.294Z",
 "result":{"success":true,"url":"https://www.bilibili.com/video/BV1HyHC6mExS",
           "postId":"BV1HyHC6mExS","platform":"bilibili","mode":"api"}}
```

## 二、① 提交后落点 URL —— 已确证

```
https://www.bilibili.com/video/BV1HyHC6mExS
```

- 承载形态是**路径段** `/video/<BV…>`，不是 query `vid=`，也不是只靠响应体。
- `postId` 与 URL 同步产出且一致 ⇒ #2968 补的 path 段采集**在真机上确实被用上**（不是只在单测里成立）。
- `mode: "api"`：本次走的是 API 轨（`publishMode: api-then-dom`），**未产生浏览器导航**。
  ⇒ 「DOM/RPA 轨提交后落在哪里」这一格**本轮仍未观测**，不得由 API 轨外推。
- 耗时 2.4 秒 ⇒ 不是「上传+转码后同步返回」的形态；稿件真实性由 §三 的独立回查证实，**不采信 result 自己的说法**。

## 三、② 审核中的 `state` 取值 —— 已确证（10-05 §四.1 该格填上）

投稿后应用日志里 `PublishMonitor poll-progress` 的四轮现场（原文，未截断字段）：

| 轮 | 时刻 | `reason` | `bucket` | `state` | `primary_state` | `state_desc` | `class` 计数 | `bucketsProbed` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 08:32:02.701 | `in-review-bucket` | `is_pubing` | **-30** | **-30** | **审核中** | `{pubed:7,not_pubed:0,is_pubing:1}` | `pubed,is_pubing` |
| 2 | 08:32:13.082 | `in-review-bucket` | `is_pubing` | **-1** | **-1** | **审核中** | `{pubed:7,not_pubed:0,is_pubing:1}` | `pubed,is_pubing` |
| 3 | 08:32:23.358 | `not-in-list` | — | — | — | — | `{pubed:8,not_pubed:0,is_pubing:0}` | `pubed` |
| 4 | 08:32:33.631 | → `monitor-result status:"published"` | | | | | | |

**结论（本轮实测确立）**：

1. **B 站「审核中」的 `state` 不是单一值**：同一次投稿的 20 秒窗口内先后观测到 `-30` 与 `-1`，两者 `state_desc` 均为 `"审核中"`，且 **`primary_state` 与 `state` 同值**。
   ⇒ 任何按「`state === 某个固定值` 判审核中」的写法都会漏；判据要么取集合，要么取 `state_desc`。
2. **`is_pubing` 桶确实是真过滤**：投稿瞬间 `class.is_pubing` 从 0→1，且稿件**只**出现在该桶、不在 `pubed` 桶；审核结束后 `class.is_pubing` 回到 0、`pubed` 变 8。与 10-05/10-07 的只读复测三方一致。
3. **`not_pubed` 桶本轮仍无现场**（始终为 0）⇒ 「审核不通过」的 `state` 取值**依旧未观测**，不得由「审核中」的两个值外推。
4. 第 3 轮是一个**真实的中间态**：`class.pubed` 已经是 8（计数上稿件已归入已发布桶），但 `pubed` 列表第一页**还查不到它** ⇒ `not-in-list`。
   这正好实测印证了 10-05 写进实现的那条硬约束「**不得拿 `page.count`/`class` 计数当命中证据**」——计数与列表内容之间存在约 10 秒的不一致窗口。若当初按 `count` 判命中，第 3 轮就会误报 `published`（且拿不到 `raw`）。

⇒ 分桶查询改动**被真机证明是必要的**：不改桶，第 1、2 轮只会是 `not-in-list`，这两个 `state` 值永远取不到。

## 四、③ 徽标与回查联动 —— 负面结果，跑出一条真实断链

回查**确实跑了**（此前我按 `AUDIT_REQUERY_VERIFIED_PLATFORMS` 不含 bilibili 推断「不会跑」，**该推断被本轮实测否证**：该名单管的是另一处门禁，`phase4-events` 的 `requery.decide` 对本平台放行了）。第 4 轮拿到 `published` 终态，但紧接着：

```
[08:32:33.631] PublishMonitor monitor-result   {"platform":"bilibili","postId":"BV1HyHC6mExS","status":"published"}
[08:32:33.634] PublishMonitor audit-update-skipped {"taskId":"task_1_1791361909906"}
```

回读发布历史（`historyGet('muxumprdxpwj')`）：

```json
{"id":"muxumprdxpwj","platform":"bilibili","taskId":"task_1_1791361909906","status":"success",
 "result":{"success":true,"url":"https://www.bilibili.com/video/BV1HyHC6mExS","postId":"BV1HyHC6mExS",...},
 "timestamp":"2026-10-07T08:31:52.297Z"}
```

记录里**没有** `auditStatus` / `monitorStatus` / `auditedAt` —— 回查结论从未落到记录上。

**根因（读码定位，非推测）**：调用点与被调方的键不同源。

```js
// electron/bootstrap/phase4-events.js:91
const { updated } = history.updateRecordAudit(task.id, patch, ownerSubject)
//                                    ↑ 传的是队列任务 id  task_1_1791361909906

// electron/services/publish-history.js:187,207-208
function updateRecordAudit (id, patch, ownerSubject) { ...
  String(record.id || '') === targetId && matchesOwner(record, owner)
//                   ↑ 按历史记录主键匹配，该记录是 muxumprdxpwj
```

历史记录的队列任务 id 存在 **`taskId`** 字段里，而函数匹配的是 **`record.id`** ⇒ 永远不相等 ⇒ 恒 `updated:false` ⇒ 恒走 `audit-update-skipped`。

**影响面**：不止 B 站 —— 所有走回查的平台，其审核结论都写不回发布历史。表现为「历史列表的审核徽标永远不出现」，且日志里只有一条 `audit-update-skipped`，无异常栈，属**静默失效**。

**为什么四层测试都没拦住**：`phase4-events` 的用例断言的是「调用了 `updateRecordAudit`」，而不是「调用后被调方真的改到了那条记录」。这是本仓已记过的「装饰性链路」同族第四次 —— 断言停在「我调过」，键对不对没人管。

⇒ 修复属独立变更（键对齐 + 一条注入**真** `publish-history` 的跨模块契约锁 + 反证），不在分桶查询 PR 内顺手做。

## 五、对 10-05 取证文档的更正

| 10-05 的表述 | 本轮实况 |
| --- | --- |
| §四.1「审核中/不通过的 `state` 取值本机无现场」 | **「审核中」已观测：`state` ∈ {-30, -1}，`state_desc="审核中"`，`primary_state` 同值。「不通过」仍无现场** |
| §四.1「`AUDIT_STATUSES` 的 `inAudit` 在 B 站没有实测映射依据」 | 现在有了（两个值 + `state_desc` 佐证），但**尚未据此改实现**（见 §七） |
| §五.5「需要一次真实投稿才能观测审核中/被拒态」 | 投稿已花，**审核中已观测、被拒未观测**（该账号投稿后 20 秒内即过审，未进入 `not_pubed`） |
| 本轮另纠正：10-05 的 `code:-302` 曾被转述为「端点会风控」 | 系**站外 node 客户端**产物；同账号在应用分区内同源 fetch 稳定 `code:0` |

## 六、稿件处置实况

- 用户指示：「已发的内容就不用删了」⇒ **`BV1HyHC6mExS`（aid `117398686406005`）保留在账号上，未删除**。
- 删除动作**未执行**。过程中我曾按猜测调用 `POST https://api.bilibili.com/x/web/archive/delete`，返回 **HTTP 404**（路径不存在），未产生任何写入；该猜测脚本已作废，未再探测其他端点。
- 一处需要知情的不一致：稿件**标题写着「稍后删除」但实际不会删**。改标题需另一次写操作，未擅自执行。

## 七、据本轮取证**尚未**落地的改动（明确留白）

1. **未**把 `-30`/`-1` 写进 `BILIBILI_OBSERVED_ONLINE_STATES` 之类的审核中映射 —— 本轮只观测了**一次**投稿，两个值是否覆盖全部「审核中」形态未知；且 `AUDIT_REQUERY_VERIFIED_PLATFORMS` 仍要求 published/inAudit/deny/无定论四类齐备，deny 仍缺。
2. **未**改 `phase4-events.js:91` 的键错配 —— 独立变更，需 PRD + 注入真实现的契约锁 + 反证。
3. **未**据「20 秒即过审」推断该账号免审或审核时长上界 —— 单次样本，不足以外推。

## 八、真机端到端复验（2026-10-07 晚，`keyfix-live-verify`）—— 修复确实生效，且带一个天然对照组

#3083 合并后补的这一次复验。**同一账号、同一条链路、同一份 profile**，只有一处不同：这次的运行代码含键对齐修复。于是上一次那篇稿子自然成了对照组。

- 运行态：worktree `mp-audit-writeback-key-fix`（分支 `audit-writeback-key-fix` @ `aa196aba0`，同时含 #3065 分桶查询与 #3083 键修复），userData 用共享锚点 `D:\Data\projects\mulpub\shared-user-data`，vite 6511 / CDP 10559（`MP_CDP_ALLOW_ALL_ORIGINS=1`）
- **跑的虽不是 main tip，但等价于 main 的这条链路**（这条判据比"落后几个提交"硬）：`git rev-parse <tree>:<path>` 逐个比 blob，`publish-history.js` / `publish-monitor.js` / `bilibili-audit-check.js` / `phase4-events.js` **四个文件在 `aa196aba0` 与 `origin/main` 上逐字节相同**。中间那 14 个提交含一处 `fix(desktop)` 权限修复，但它不碰这四个文件 —— 所以本轮结论对 main 成立，不需要另跑一次。（当时的错误写法是"逐条查过均为无关功能/文档"，那没量 blob；已按实测改成 blob 同一性。）
- 触发：经 CDP 在渲染层调 `publishBatch([{platform:'bilibili',accountId:'ca681b37'}], {title, content, video_path, category:21, copyright:1, aiGenerated:false})`
- 载荷素材沿用上轮那份仓库内 E2E 产物（640×360 / h264+aac / 6.0s / 76,657 B），**`aiGenerated` 仍显式传 `false`**（素材是否 AI 生成未经核实，不主动声明）

### 8.1 时间线（全部取自应用自记日志 `shared-user-data/logs/app-2026-10-07.log`）

```
13:53:34.186Z  队列 task_1_1791381214184 started
13:53:35.617Z  success → url https://www.bilibili.com/video/BV1hhH16NEAZ  postId 同  mode:"api"
13:53:45.988Z  poll-progress retries=1  status:pending  reason:"in-review-bucket"   ← 分桶扇出在真机上走到了
13:53:56 / 13:54:06 / 13:54:17 / 13:54:27   retries=2..5 同上
13:54:38.318Z  monitor-result {"platform":"bilibili","postId":"BV1hhH16NEAZ","status":"published"}
               （此后本条任务没有任何 audit-update-skipped）
```

**对照（同一份日志、同一账号、修复前那次投稿）**：

```
08:32:33.631Z  monitor-result {"postId":"BV1HyHC6mExS","status":"published"}
08:32:33.634Z  audit-update-skipped {"taskId":"task_1_1791361909906"}   ← 3 毫秒后就被判"键没命中"
```

### 8.2 落库回读（`historyList`，不看返回值看真源）

| | 修复前那条 | 修复后这条 |
| --- | --- | --- |
| 记录 `id` / `taskId` | `muxumprdxpwj` / `task_1_1791361909906` | `muy64gaqnqg6` / `task_1_1791381214184` |
| `auditStatus` | **缺席** | `published` |
| `monitorStatus` | **缺席** | `published` |
| `platformWorkId` | **缺席** | `BV1hhH16NEAZ` |
| `auditedAt` | **缺席** | `2026-10-07T13:54:38.318Z` |

四个字段恰好是 `AUDIT_PATCH_KEYS` 白名单的全集，且**值与日志里那次 `monitor-result` 的时间逐毫秒一致** —— 证明写回来自回查链路本身，不是别处填的。

### 8.3 界面上真的看得见（DOM 层）

导航到 `#/publish/history` 后读 `document.body.innerText`：

- 整页徽标集合 `badgesPresent = ["已上线"]`（候选词表是 `已上线/审核中/待发布/审核未通过/未公开/已下线/转码失败` 七项），**只命中一项**；
- 它出现在新稿那一行：`… 审核回写复验稿 请忽略 … 全部发布成功 | 已上线 | API 直连 | Bilibili …`；
- 旧稿那一行是 `… 自动化取证测试稿 请忽略 稍后删除 … 全部发布成功 | API 直连 | Bilibili …`，**没有徽标位**。

即 PRD 里那条“修完这条链才第一次真正通”在用户可见层面成立。注意口径：**只核到 DOM 文本层，没做像素级核对**，本轮不新增视觉基线（小控件徽标对像素门禁本就双向失明）。

### 8.4 本轮仍不能下结论的四件事（不把单次样本外推）

1. **审核时长**：上一轮投稿→收敛 44 秒，本轮 64 秒。两个样本不构成上界，也不支持“该账号免审”——事实上本轮前 5 轮轮询都在 `is_pubing` 桶里拿到了 `pending`，说明确实经过程审核中态。
2. **`-30` / `-1` 仍不写进任何“审核中”映射**：本轮观测到的是“最终 published”，未新增不通过现场；10-05 §四.1 的“不通过”那一格仍空。
3. **"未验证 main tip 的其余改动"**：本轮运行树与 main 的等价性只覆盖那四个链路文件（blob 逐字节相同，见 §八开头那条），不等于验证了 main 上的其它 14 个提交；那些由各自 PR 的 CI 覆盖。
4. **没验证“不通过/驳回”分支的真机形态**：需要一条真会被驳回的稿件，本轮未做（也不拿“造一条违规内容”去换）。

### 8.5 稿件处置与收尾

- 本轮两篇稿件均**保留未删**（沿用上轮“已发的内容不用删”的指示）；标题已写明“请忽略”。
- 上一轮那篇标题写着“稍后删除”但实际保留 —— 那是**已发布内容上的不实措词**，改标题要再写一次账号数据，**未擅自处理**，在此登记。
- 收尾：停掉本实例后按“本实例独有端口标记”反查残留，`MINE_FOUND=0`、端口 6511 / 10559 `LISTENERS=0`；**未按镜像名 `taskkill`**（机器上常有别人会话的同一个 exe）。
