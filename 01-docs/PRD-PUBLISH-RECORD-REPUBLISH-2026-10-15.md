# PRD：发布记录「再次发布」+ 作品链接生效修复 + 多平台记录口径

- 文档编号：PRD-PUBLISH-RECORD-REPUBLISH-2026-10-15
- 分支：`pub-record-republish`
- 日期：2026-10-15
- 需求来源：用户报障 + 需求（发布记录页）
- 关联文档：
  - `01-docs/PRD-PUBLISH-HISTORY-PUBLIC-LINK-2026-10-07.md`（作品链接目的地判据，已合并）
  - `01-docs/PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12.md`（作品互动数据）
  - `01-docs/PRD-COLLECTION-DRAFTS-TAB-2026-10-12.md`（草稿箱形态）
  - `openspec/specs/openspec-integration/spec.md`（分层分支策略）
- 状态：待实现（本 PR 落地 P0；P1/P2 见 §8）

---

## 1. 背景与原始诉求

用户在「发布记录」页提出三件事：

| # | 原话 | 类型 |
| --- | --- | --- |
| R1 | 每条发布记录增加按钮「再次发布」；点击后进入相应发布页，**把原始的发布内容信息和选项设置仍然保留**，便于直接发布。并质疑「现在这些信息是不是没有固态后保存到数据库中？」 | 新功能 + 数据落库 |
| R2 | 发布成功的记录，卡片应带内容链接，点击后**打开新标签**展示该内容在自媒体平台的公开链接。「我记得之前做过这个功能，怎么一直没生效」 | Bug 修复 |
| R3 | 发布到多个平台时，这条发布记录的逻辑是「显示集合的一条记录」还是「分成多个平台的独立记录」 | 设计决策 |

---

## 2. 现状核查（先给结论，再给证据）

### 2.1 R1：发布内容与选项**确实没有落库**（用户判断正确）

发布记录的唯一写入口是主进程 `apps/desktop/electron/bootstrap/phase4-events.js` 的
`task:success`（:111）与 `task:failed`（:215），两处都只写：

```
platform / title / taskId / status / result / error / 封面键（cover_path|cover_url）
/ publishMode（有才写）
```

**没有写入**：正文 `content`、图片 `images`/`image_files`、视频 `video_path`、
话题/标签/提及（`tags`/`topics`/`mentions`）、`platformOverrides`（分平台字段覆盖）、
`accountId`、`contentFormat`、`aiGenerated`、`visibilitySemantic`、`rewriteHistoryId`。

活体证据（`shared-user-data/publish-history.jsonl`，72 条记录，2026-10-15 采样）——
顶层键频次：

```
id 72 | platform 72 | title 72 | taskId 72 | status 72 | result 72
owner_subject 72 | timestamp 72 | error 11 | publishMode 4
cover_path 4 | cover_url 4
```

⇒ **除标题外，用户写的正文与选项一个字节都没存**。所以「再次发布」当前**无从还原**：
`result` 里只有发布结果（`{success,url,postId,platform,mode}`），不含内容。

> 结论：R1 不是「按钮没做」，而是**上游数据没有落库**，必须先补落库再谈按钮。

### 2.2 R2：作品链接功能代码在，但**写入侧拿不到真锚点**，于是 79% 的成功记录没有任何链接

读取侧早就做完了（`apps/desktop/src/composables/usePublishHistoryContentLink.js`，
PRD-PUBLISH-HISTORY-PUBLIC-LINK-2026-10-07）：卡片点击 → 应用内新标签 → 兜底 `window.open`。
解析层 `packages/shared-utils/src/published-content-url.js` 也做了正向白名单 + 作品 ID 六重闸门。

问题在**写入侧**。同一份活体数据里，57 条 `status=success` 记录的锚点分布：

| 平台 | 成功数 | 有 postId | postId 形态 | result.url | 解析结果 |
| --- | --- | --- | --- | --- | --- |
| baijiahao | 11 | 11 | 真数字 ID（其中 2 条是 `task_1_…` 垃圾值） | 创作者后台 `/pcui/article/<id>` | **derived 可用**（9 条） |
| bilibili | 1 | 1 | `BV187pF63EtD` | `www.bilibili.com/video/BV…` | **recorded 可用** |
| kuaishou | 11 | 11 | `published-<时间戳>`（**本仓自己造的合成值**） | `cp.kuaishou.com/article/manage/…`（后台） | **none** |
| xiaohongshu | 12 | 0 | — | `creator.xiaohongshu.com/publish/publish`（后台） | **none** |
| douyin | 4 | 0 | — | `creator.douyin.com/creator-micro/content/manage`（后台） | **none** |
| toutiao | 9 | 0 | — | 空串 | **none** |
| wechat_mp | 9 | 0 | — | `mp.weixin.qq.com/cgi-bin/appmsg?…`（后台编辑页） | **none** |

⇒ **45/57 ≈ 79% 的成功记录解析为 `none`**，卡片 `isCardClickable` 为 false、
详情弹窗显示「未记录作品链接」。用户感受就是「功能一直没生效」——**它确实没生效，
但不是渲染层坏了，而是没有可点开的东西**。

两条写入侧缺陷是可直接定性的：

1. **kuaishou 把「成功信号」当成作品 ID 存了**。`published-<ts>` 是发布成功判定用的合成值
   （`SYNTHETIC_ID_PREFIXES` 里 `published-` 正是为它登记的），它必然拼不出公开页。
2. **toutiao / xiaohongshu / douyin 从未捕获任何作品锚点**（postId 缺席、URL 是后台页或空）。

### 2.3 R3：现状**已经是「每平台独立记录」**，但批次信息被丢掉了

- `publish:batch`（`electron/ipc-handlers/publish.js:298`）对每个 target 各 `taskQueue.add()`
  一次，`task:success`/`task:failed` 是**任务级**事件 ⇒ 一次「3 平台发布」落 **3 条记录**。
- 但 `batchId` **没有进任务、也没进记录**：`taskQueue.add({platform, article, accountId})`
  没传 `batchId`；`addRecord` 也没写 `batchId`（只在进度事件里 `batchId: task.batchId || null`，
  而该字段几乎恒为 null）。⇒ 历史页无法回答「这几条是同一次发布」。

---

## 3. 设计决策

### D1（R1）：新增「再次发布快照」，**与历史记录分表存放，按记录 ID 惰性读取**

**为什么不把正文塞进 `publish-history.jsonl` 的那一行**

- `publish-history.js` 的 `readRecords()` 是「整文件 `readFileSync` + 逐行 `JSON.parse`」，
  而 `listRecords()` **每次分页都重读整文件**；历史页还有「筛选补页扫描」（`useFilterScan`，
  上限 40 页）会连续调用它。把 10 KB 级的正文写进每一行，等于把一次筛选从
  ~0.5 MB 解析放大到 5 MB×40 量级 —— 直接违反 QM-2「高频路径不得随数据量线性放大成本」。
- 记录行还会被 `updateRecordAudit` 整文件重写，写放大同样不可接受。

**方案（选定）**：新增主进程模块 `services/publish-republish-snapshot.js`，
落 **owner 作用域的 SQLite `settings` 表**（与草稿箱同基础设施，`getUserSetting`/`setUserSetting`）：

| settings key（owner 命名空间内） | 值 |
| --- | --- |
| `publish-republish-snapshot:<recordId>` | 快照对象（白名单字段，见 §4.1） |
| `publish-republish-snapshot:index` | 记录 ID 数组，新→旧，上限 200（超出即淘汰最旧并清掉其快照键） |

- **不在历史记录里加任何正文**，记录行体积零增长。
- 历史页需要知道「这条能不能再次发布」：`history:list` / `history:get` 读一次 index
  （单行 settings，O(1)），把 `hasRepublishSnapshot: boolean` 附在返回的记录上。
  该标志**不是**落库字段，永远由快照存储现算 ⇒ 不会与真实存储漂移（淘汰后自动变 false）。

**被否决的备选**

| 方案 | 否决理由 |
| --- | --- |
| 正文写进历史 JSONL 行 | 见上：分页/筛选/回写三重写放大 |
| 复用草稿箱：发布即写一条草稿，`/publish?draft=<id>` 打开 | 语义污染：草稿箱 = 未发布 WIP，把已发布内容塞进去会让「草稿箱」失去含义；且需要给 `draftList` 加过滤，漏改一处就泄漏到用户可见列表 |
| 只存 `taskId`，点击时回队列重发 | 用户要的是「进发布页、可改后再发」，不是静默重发；且失败记录重发必然再失败 |
| 不落库，靠「最近一次表单」内存态 | 跨会话/重启即失效，正是当前报障的形态 |

### D2（R2）：分三步，**先让数据不撒谎，再让能拿到的拿到，最后让拿不到的说明白**

1. **写入侧去伪**：合成值不再是「作品 ID」（见 §5.2，落地范围以并行调查结论为准）。
2. **写入侧补真**：在发布链**已有**的数据里提取真实公开锚点（不新增平台请求、不改成功判定语义）。
3. **读取侧说明白**：解析为 `none` 时，卡片与详情必须给出**可区分的原因**，而不是笼统的
   「暂无平台公开链接」；视频号这类**结构性无公开页**的平台要有专属文案。

> ⛔ 红线：本 PR **不修改**任何平台的「发布成功判定」语义（那需要真机对照，超出本 PR 可验证范围）。
> 拿不到锚点的平台**如实留白**，不构造、不猜测、不用后台页兜底。

### D3（R3）：保留「每平台独立记录」，补一条**批次标注**

- **保留独立记录**：状态、审核结论、作品链接、互动数据、重试、删除全部是**平台级**动作；
  合并成一条「集合记录」会把 8 个平台的状态压成一个字段，必须再引入子表才能表达，
  是纯粹的复杂度增加。
- **补批次标注**：`publish:batch` 生成一个 `batchId` 传给该批全部任务；`task:success`/`task:failed`
  把它写进记录（仅在有值时写键，与 `publishMode` 同风格）。历史页据此渲染
  「同批 N 个平台」徽标 + 悬停列出平台名。

---

## 4. 数据模型

### 4.1 再次发布快照（`PublishRepublishSnapshot`）

**白名单字段（唯一真源：`services/publish-republish-snapshot.js` 的 `SNAPSHOT_FIELDS`）**：

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `title` | string | `article.title` | |
| `content` | string | `article.content` | 正文全文，不截断 |
| `author` | string | `article.author` | |
| `cover_url` / `cover_path` / `cover_file` | string | `article.*` | 三键同存（与草稿箱一致） |
| `video_path` | string | `article.video_path` | |
| `images` / `image_files` | string[] | `article.*` | 缺失回落 `[]`（**不得回落 `''`**） |
| `tags` / `topics` / `mentions` | string[] | `article.*` | 同上 |
| `contentFormat` | string | `article.contentFormat` | `markdown` / `html` |
| `aiGenerated` | boolean | `article.aiGenerated` | AI 声明，缺失按 `true`（与 `usePublishFlow.buildArticleData` 同口径） |
| `visibilitySemantic` | string | `article.visibilitySemantic` | 有才写键 |
| `platformOverrides` | object | `article.platformOverrides` | 分平台字段覆盖，按白名单键过滤 |
| `rewriteHistoryId` | string \| null | `article.rewriteHistoryId` | 归因链；**不得折成 `''`** |
| `accountId` | string | `article.accountId \|\| task.accountId` | 原发布账号 |
| `platform` | string | `task.platform` | 该记录的平台 |
| `publishMode` | string | `task.publishMode` | 有才写键 |
| `batchId` | string | `task.batchId` | 有才写键 |
| `savedAt` | string(ISO) | 写入时刻 | |

**明确不写入快照的字段（安全红线）**

- `cookies`、`accountId` 之外的任何凭证/会话字段：任务载荷里 `article.cookies` **真实存在**
  （`publish-audit-requery.js` 读它），快照**必须按白名单逐字段提取，禁止整体展开 `...article`**。
- `publishTime`：**刻意不还原**。历史定时时间是一个绝对时刻，静默沿用它会让用户在
  「过去的时间」上发布并报错（与草稿箱 `clearStaleDraftSchedule` 同一判断）。
- `precheck`、`accountId` 之外的 `task.*` 内部字段、`images` 里的临时对象。

**数据校验（写入侧）**

| 判据 | 不通过时的行为 |
| --- | --- |
| `recordId` 为非空字符串且 ≤ 64 字符 | 不写，返回 `{saved:false, reason:'invalid_record_id'}` |
| 快照 JSON 序列化后 ≤ 512 KB | 不写，`warn` 日志出声；记录仍照常落库（快照属旁路） |
| `ownerSubject` 可解析（非 `null`） | 不写（fail-closed，绝不写 legacy 全局命名空间） |
| 快照归一后至少含 `title` 或 `content` 之一非空 | 不写（空快照对「再次发布」无价值） |

**数据校验（读取侧）**

- `recordId` 非空字符串；owner 可解析；读回值必须是「对象」（`settings` 读回是**解析后的值**，
  兼容历史字符串形态则 `JSON.parse` 一次，解析失败视为不存在）。
- 读回后再过同一个白名单归一（纵深防御：存储被污染也不能把任意键注回表单）。
- 任何一步失败 ⇒ 返回 `null`，UI 走「无快照」分支，**不抛错**。

**生命周期**

| 事件 | 行为 |
| --- | --- |
| 发布成功 / 失败落库后 | 写快照 + index 前插该 recordId |
| index 超过 200 | 淘汰最旧，清掉其快照键 |
| 用户删除历史记录（`history:delete`） | 同步删除这些 recordId 的快照并从 index 摘除 |
| 快照键写入失败 | 只 `warn`，**绝不冒泡**，不影响发布主流程与记录落库 |

### 4.2 历史记录新增字段

| 字段 | 写入点 | 说明 |
| --- | --- | --- |
| `batchId` | `phase4-events` 的 `task:success` / `task:failed`，`task.batchId` 有值才写 | 同批多平台关联键 |
| `hasRepublishSnapshot` | **不落库**，由 `history:list` / `history:get` 现算附加 | 快照存在性 |

---

## 5. 功能逻辑

### 5.1 「再次发布」（R1）

**入口**：发布记录页每张卡片与详情弹窗，新增次要按钮「再次发布」。

**显示项与状态**

| 记录状态 | 按钮 | 悬停提示 |
| --- | --- | --- |
| 有快照（成功/失败均可） | 可点 | 「用这次发布的内容与选项打开发布页」 |
| 无快照（本功能上线前的历史记录、或快照已被淘汰） | 禁用（`disabled` + `aria-disabled`） | 「这条记录未保存原始内容（早期记录或快照已清理），无法再次发布」 |

**流程**

```
点击「再次发布」
  → 前端不做二次确认（无损操作，不写库）
  → router.push('/publish?republish=<recordId>')
  → Publish.vue 监听到 query.republish 变化
      → 调 republishSnapshotGet(recordId)（IPC: history:get-republish-snapshot）
      → 命中：
          · 归一后写入 article / selectedPlatforms / selectedAccounts / platformOverrides
            （与草稿箱 applyDraft 共用同一实现，见 §5.1.1）
          · 顶部提示（toast）："已载入该次发布的内容与选项，请确认后发布"
          · 平台账号不可用时：清空该平台账号并提示"原发布账号已不可用，请重新选择账号"
      → 未命中：错误提示 "该记录未保存原始内容，无法再次发布"（不改变当前表单）
      → 读取失败（IPC 异常）：错误提示 "载入发布内容失败，请稍后重试"
```

**5.1.1 与草稿箱的单一实现**

`usePublishDrafts.applyDraft` 已经定义了「快照 → 表单」的字段口径（含 `tags` 合并
`topics` 的历史归一、`rewriteHistoryId` 的 `string|null` 语义、数组字段回落 `[]`）。
本次把这段逻辑抽成纯函数 `applyPublishSnapshot(snapshot, target)`（`src/features/publish/publish-snapshot.js`），
`applyDraft` 与「再次发布」**同调它**，禁止第二份实现（口径漂移的后果是「从草稿恢复」与
「再次发布」行为不一致，而两者用户看到的都是「还原内容」）。

**5.1.2 发布页交互细节**

- 载入后**不自动发布**，用户仍需点「一键发布」。
- 载入不改变当前「发布类型」（图文/视频）；若快照带 `video_path` 而当前是图文模式，
  由用户自行切换（提示文案说明）。
- 载入会**清空**当前表单草稿态——若有未保存内容，先弹确认（沿用 `confirm-danger` 同族交互）；
  用户取消则停留原页且表单不变。
- URL 参数在载入完成后从地址栏移除（`router.replace`，与既有 `?draft=` 处理一致），
  避免刷新重复载入。

### 5.2 作品链接生效（R2）

**5.2.1 去伪（写入侧）**

- `services/**` 中把合成值写进 `postId` 的位置改为**不写 `postId`**，把成功信号留在它原本的字段
  （`published-*` 继续作为「发布成功」判定的内部标记，不再冒充作品 ID）。
- 回归锁：解析器对 `published-`/`task_`/`tmp` 前缀仍然一律拒绝（既有测试保持绿）。

**5.2.2 补真（写入侧，范围由并行调查结论收口）**

在**不新增平台请求、不改成功判定**的前提下，把发布链已经拿在手里的真实公开锚点写进
`result.postId` / `result.url`。落地清单与逐平台结论见 §7 与 `openspec/records/pub-record-republish.md`；
**无法确证可获得的平台一律不动**（宁可不给链接，也不给错链接——沿用 PRD-PUBLISH-HISTORY-PUBLIC-LINK §6.2 口径）。

**5.2.3 说明白（读取侧）**

`usePublishHistoryContentLink` 增加「无链接原因」三态，替换笼统文案：

| 情况 | 判定 | 文案（zh） |
| --- | --- | --- |
| 草稿记录（`result.draft === true`） | 既有 | 「这条记录只存进了平台草稿箱，还没有公开作品」 |
| 平台结构性无公开页（`tencent_video`，规则表 `contentPathRe === null && template === null`） | **新增** | 「该平台不提供网页端公开链接（内容仅在客户端内可见）」 |
| 其余（后台页 + 无作品 ID） | **新增** | 「本次发布未获取到作品 ID，无法定位公开链接」 |

卡片悬停提示同步三态；详情弹窗「作品链接」行的未记录占位文案同步。

### 5.3 多平台记录口径（R3）

- 一次「N 平台发布」= N 条独立记录（现状保持），每条各自带 `batchId`。
- 历史页在 `platform` 徽标旁渲染批次徽标：`同批 N 个平台`（N ≥ 2 时才渲染）。
- 悬停列出该批平台名（按记录顺序去重）。
- 徽标**不参与筛选**（P2 再评估「按批次筛选」）。

---

## 6. 提示文字（i18n 键，zh/en 成对）

命名空间 `historyPage`（`src/locales/history-page/{zh,en}.js`）：

| 键 | zh | en |
| --- | --- | --- |
| `republish` | 再次发布 | Publish again |
| `republishHint` | 用这次发布的内容与选项打开发布页 | Open the editor with this record's content and options |
| `republishUnavailable` | 这条记录未保存原始内容（早期记录或快照已清理），无法再次发布 | This record has no saved content snapshot, so it cannot be published again |
| `republishLoaded` | 已载入该次发布的内容与选项，请确认后发布 | Loaded the content and options from that publish; review before publishing |
| `republishMissing` | 该记录未保存原始内容，无法再次发布 | This record has no saved content; it cannot be published again |
| `republishLoadFailed` | 载入发布内容失败，请稍后重试 | Failed to load the saved content. Please retry. |
| `republishAccountUnavailable` | 原发布账号已不可用，请重新选择账号 | The original account is unavailable; please pick another |
| `republishDiscardConfirmTitle` | 放弃当前未保存的内容？ | Discard unsaved content? |
| `republishDiscardConfirmMessage` | 载入这次发布的内容会覆盖当前表单中未保存的内容。 | Loading this record will overwrite the unsaved content in the form. |
| `republishDiscardConfirmButton` | 放弃并载入 | Discard and load |
| `batchBadge` | 同批 {count} 个平台 | {count} platforms in one batch |
| `batchTooltip` | 与 {platforms} 属于同一次发布 | Published together with {platforms} |
| `noLinkStructural` | 该平台不提供网页端公开链接（内容仅在客户端内可见） | This platform has no public web link (content is client-only) |
| `noLinkNoPostId` | 本次发布未获取到作品 ID，无法定位公开链接 | No work ID was captured for this publish, so the public link is unknown |

---

## 7. 验收标准

| # | 验收项 | 可验证判据 |
| --- | --- | --- |
| A1 | 发布成功后快照落库 | 单测：`saveSnapshot` 后 `readSnapshot` 逐字段相等；活体：新发布一次后 history 行**体积不变**且 `hasRepublishSnapshot=true` |
| A2 | 快照不含凭证 | 单测：传入含 `cookies`/未知键的 `article`，快照键集合**精确等于**白名单，且 `JSON.stringify(snapshot)` 不含 `cookies` 值 |
| A3 | 空/超长/无 owner 不写 | 单测：四条校验各自的 `reason` |
| A4 | 淘汰与级联删除 | 单测：写 201 条后最旧键被清；`deleteSnapshots` 后 `readSnapshot` 为 null 且 index 摘除 |
| A5 | 按钮三态 | 组件测试：有快照可点并 push 到 `/publish?republish=`；无快照禁用且 `title` = `republishUnavailable` |
| A6 | 发布页还原 | 组件测试：`?republish=` 命中后 `article.title/content/tags/...` 与 `selectedPlatforms/selectedAccounts/platformOverrides` 与快照一致，`publishTime` 为空 |
| A7 | 与草稿箱同实现 | 结构锁：`usePublishDrafts.applyDraft` 与 republish 路径都调用 `applyPublishSnapshot` |
| A8 | 多平台批次 | 单测：`publish:batch` 的 N 个任务 `batchId` 相同且非空；记录写入该字段；N≥2 时渲染徽标 |
| A9 | 链接原因三态 | 单测：草稿/结构性无页/无作品 ID 三条分支各自文案键 |
| A10 | 解析器不回归 | `packages/shared-utils` 既有测试全绿（`published-`/`task_` 仍被拒） |
| A11 | i18n 成对 | `check-locale-sync` 通过；渲染端不得新增中文字面量 |
| A12 | 打包 | QM-1：`electron-builder --win --x64` exit 0 + 启动 8s stderr 判据 |

---

## 8. 范围与优先级

| 优先级 | 内容 | 本 PR |
| --- | --- | --- |
| P0 | 快照落库 + 「再次发布」按钮 + 发布页还原 + 批次字段/徽标 + 链接原因三态 + 去伪 | ✅ |
| P0 | 链接「补真」：在发布链已有数据内可确证获得的平台 | ✅（范围见 openspec 记录） |
| P1 | 链接补真的其余平台（需真机对照） | ⬜ 另行排期 |
| P1 | 「按批次筛选」「整批再次发布」 | ⬜ |
| P2 | 历史定时时间可选还原 | ⬜（需先解决过期时间语义） |
| P2 | 快照去重（同内容多次发布共用一份） | ⬜ |

## 9. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 快照写入拖慢发布主流程 | 旁路：全部 `try/catch` + `warn`；单次写入为两条极小的 SQLite 语句 |
| 快照把凭证写进 settings | 白名单逐字段提取（A2 精确键集合断言） |
| 旧记录没有快照导致「按钮没用」 | 按钮禁用 + 悬停说明；不静默失败、不假装可用 |
| 淘汰策略让老记录突然不能再次发布 | index 上限 200，落在 P0 文档与悬停文案里如实说明 |
| 链接修复面铺太大 | 只做「不新增请求、不改成功判定」的部分；其余如实留白并登记后续 |

## 10. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-15 | 初版：R1/R2/R3 现状取证、三项设计决策、数据模型、校验、交互、i18n、验收标准 |
