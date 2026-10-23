# PRD：发布队列频控与发布判据（2026-10-23）

> 本文沉淀 2026-10-22~23 真机排查结论，补齐「发布频率控制」「发布成功判据」「用户可见反馈」三块的规格。

## 1. 背景与要解决的问题

真机出现「`publish:batch ok` 有 taskId，但任务从不执行、无报错、无日志」的现象，累计误导排查 20+ 轮。
最终定位：**任务在 `TaskQueue._executeTask` 内被发布频率守卫拦截，进入 `_delayed` 长等待**，而该分支原本**不写任何日志**。

## 2. 频控机制（数据校验与流程）

### 2.1 两档校验

| 档位 | 键 | 含义 | 判定字段 |
|---|---|---|---|
| `platform` | `platform` | 同一平台全局最小间隔 | `platformMinMs` |
| `account` | `platform:accountId` | 同一账号最小间隔（优先） | `accountMinMs` |

### 2.2 日配额

| 字段 | 说明 |
|---|---|
| 表 | `publish_daily_count(owner_subject, key, day_key, count, rollback_count, updated_at)` |
| `count` | 已**实际提交到平台**的次数；未提交失败会幂等回补（下限 0） |
| `rollback_count` | 回滚尝试次数，只增不减（防风上限） |
| `day_key` | 本机运营日 `YYYY-MM-DD` |
| 保留 | 最近 7 天 |

### 2.3 拦截时的判定对象

```js
const verdict = guard.check(platform, accountId)
// => { allowed:false, bucket:'account'|'platform'|'daily', reason:'interval'|'daily_quota',
//      remainingMs:number, daily:{used,max,dayKey} }
```

**数据校验要求**：`remainingMs` 必须为正整数；异常（负值/非有限数/超过 24h）一律按 0 处理并记 warn，避免任务无限等待。

## 3. 流程（一次发布的完整链路）

```
publish:batch
  → taskQueue.add(task)                 // 入队
  → _processNext()                      // 驱动
      → _executeTask(task)
          → 占槽 _running.set / _runningByChannel++
          → guard.check(...)            // 同步判定
              ├─ allowed=false ⇒ 写 _delayed + setTimeout(remainingMs) ⇒ return（不调 executor）
              └─ allowed=true  ⇒ 调用 executor
                  → [exec] enter → register → emit → createPublisher
                  → RPA 填表 → 点击发布 → 判据核验
```

## 4. 可观测性（强制）

每条关键分支**必须**输出结构化日志，字段名固定：

| 场景 | 日志 |
|---|---|
| 驱动入口 | `[queue] enter paused=<bool> queue=<n> running=<n> delayed=<n>` |
| 开始执行 | `[queue] exec task=<id> platform=<p>` |
| 被频控拦截 | `[queue] blocked bucket=<b> reason=<r> remainingMs=<n> daily={"used":n,"max":n,"dayKey":"..."}` |
| 进入延迟队列 | `[queue] delayed task=<id> waitMs=<n>` |
| 执行器分步 | `[exec] enter / register / emit / publisher task=<id>` |

> 只允许用项目 logger（`require('./services/logger').info/warn/error`）。**`console.*` 不会写入 `app-YYYY-MM-DD.log`**，用它打点等于没有打点。

## 5. 交互逻辑与提示文字

### 5.1 入队前预检（新增要求）

`publish:batch` 在返回 taskIds 之前必须检查守卫：

| 情况 | 返回 | 提示文字 |
|---|---|---|
| 可用 | `code:0` | — |
| 账号间隔未到 | `code:2001` | 「该账号距上次发布不足 N 分钟，预计 HH:mm 后可再次发布」 |
| 日配额用尽 | `code:2002` | 「该账号今日发布次数已达上限（N/N），将于次日 00:00 恢复」 |

**禁止**接受任务后再静默等待——用户会以为已发布。

### 5.2 等待中状态显示

任务列表行需显示：`等待频控 · 剩余 MM:SS · 原因：账号间隔`

### 5.3 失败提示

`publish verification timeout` 必须区分两种：
- 判据不命中（页面已重置但列表未见作品）⇒ 「发布结果待确认，请到平台作品列表核对」
- 平台明确拒绝 ⇒ 展示平台原文

## 6. 发布成功判据（按平台）

| 平台 | 判据 | 证据字段 |
|---|---|---|
| 抖音 | DOM 成功态 | `mode:'dom'` |
| 小红书 | 草稿箱出现该标题（IndexedDB `draft-database-v1`） | `evidence:'idb-title-match'` |
| 视频号 | **作品列表出现该标题**（`channels.weixin.qq.com/platform/post/list`） | `evidence:'post-list-dom'` |
| 今日头条 | 作品列表接口命中 | `mode:'artifact'` |

**原则**：判据必须是「用户可见结果」，不是「页面发生了什么变化」。视频号发布后页面会重置为壳页，任何基于 URL/文案变化的判据都必然超时。

## 7. 验收标准

1. 频控拦截时日志出现 `[queue] blocked …`，含 `bucket/reason/remainingMs/daily`
2. 频控等待上限 15 分钟，超时强制重新判定
3. `publish:batch` 对不可发状态返回明确错误码与提示文字
4. 四平台判据按上表实现，且失败时不误报成功

## 8. 视频上传类平台的「先点后选」约束（2026-10-23 真机补充）

头条与视频号都属于「上传控件延迟出现」的形态，实现上必须遵循同一顺序：

| 步骤 | 头条 | 视频号 |
| --- | --- | --- |
| 1 | 打开视频上传页 `profile_v4/xigua/upload-video` | 打开 `platform/post/create` |
| 2 | **点「添加视频」**（否则页面上没有 `input[type=file]`） | 点封面区触发选择器 |
| 3 | `setFileViaCdp` 设视频文件 | `setFileViaCdp` 设封面图 |
| 4 | 等上传完成信号（进度消失/出现文件名） | 等缩略图出现 |
| 5 | 填标题正文 → 点「发」 | 填描述 → 点「发表」 |

**禁止**：跳过步骤 2 直接查 `input[type=file]`。查不到时会静默跳过整段上传，后续所有步骤落空，最终只报一个与根因无关的错误（头条：`发布结果缺少平台作品 ID`；视频号：`publish verification timeout`）。

**判据**：日志必须出现 `[toutiao] add-video CLICKED` / 视频号封面设置成功；若为 `NO_BTN` 或无日志，视为上传未发生，应立即 fail-fast，不得继续点击发布按钮。

**为什么重要**：发布按钮点击是**副作用动作**，白点一轮就是一次真实提交尝试，会消耗账号的发布间隔窗口（60–80 分钟）。

### 8.2 视频方向决定发布轨（2026-10-23 真机定论）

头条视频的 API 轨**明确拒绝竖版**，真机日志（23:29:09）原文：

```
phase-failed error="竖版视频暂不支持 API 发布，请使用 RPA 发布"
```

因此发布轨的选择必须以**视频方向**为一等输入：

| 视频方向 | 头条发布轨 | 依据 |
| --- | --- | --- |
| 竖版（9:16，height > width） | **RPA** | API 轨硬拒绝；RPA 已跑通「上传 → 填表 → 发布 → 确认」全流程 |
| 横版（16:9，width >= height） | 可走 API | 抓包实证的 5 步链路（getAuthKey → apply → 分片 → commit） |

**产品约束**：

1. 路由层不得按「平台 + 有视频」二元判断，必须结合 `probeVideoInfo` 的 `width/height`；
2. 若方向未知（探测失败），**默认 RPA**（fail-safe：RPA 两条方向都能走，API 只接受横版）；
3. 用户可见提示文案沿用平台原文语义：「竖版视频暂不支持 API 发布，请使用 RPA 发布」，并在任务详情里注明已自动改走 RPA。

**反面教材**：曾按「平台有视频 ⇒ 走 API」一刀切路由，结果竖版任务 100% 在 prepare 阶段失败，且失败被记成「发布失败」而非「轨选择错误」。

### 8.4 点击后校验（防「点了但不是那个按钮」）

**背景（2026-10-23 两次真机事故）**：

| 平台 | 日志表现 | 真因 | 用户可见结果 |
| --- | --- | --- | --- |
| 视频号 | `publishing...` 有日志、`verifying...` 也有 | 选择器 `button:has-text("发表")` 是**子串匹配**，先命中首页「发表视频」入口 | 创作者中心与草稿箱**均为空** |
| 今日头条 | `publishing...` + `confirm dialog clicked: 确定` 都有 | 封面弹窗 `no-next` 失败后**未关闭**，发布点击命中遮罩 | 作品列表**无新内容** |

⇒ 共同点：**日志证明「发生了点击」，不证明「点到了正确元素」**。

**强制规则**：

1. **选择器必须精确**：可点击控件一律用 `:text-is`（精确文案），禁止 `:has-text`（子串）。确需包含匹配时，必须同时排除同前缀的兄弟控件（如「发表视频」「定时发布」）。
2. **弹窗必须先于点击关闭**：任何「打开弹窗 → 失败 → 返回」的路径，返回前必须执行关闭（取消/关闭/×），并在日志中记录 `closed=<文案|none>`。
3. **点击后立即校验落点**：点击发布后 1.5 秒内读取 `win.webContents.getURL()`；若 URL 偏离预期（如视频号应在 `post/create`，却变成通知中心/首页），立即记录 `publish click may have hit the wrong element url=<实际>`，不得静默进入验证阶段。
4. **验收只认用户可见结果**：创作者中心 / 作品列表 / 草稿箱。HTTP 2xx、`publishing...` 日志、确认弹窗点击**都不构成发布成功证据**。

**反例（必须记住）**：曾以「捕获到 3 条 HTTP 201」推断发布成功，用户核对创作者中心与草稿箱**均为空**，证明该推断错误。2xx 只能证明「某个请求被受理」，不能证明「作品已发布」。

## 8.5 视频号 API 链：与竞品实现的逐项对照（2026-10-23）

竞品实现取自 `00-vendor-originals/refproduct/main-dist-index.cjs`（压缩代码，以下为原文摘录）。

| 步骤 | 竞品 | 本项目 | 一致性 |
| --- | --- | --- | --- |
| 1 取鉴权 | `POST channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params`，body `{timestamp,_log_finder_id,rawKeyBuff}` | 同 | ✅ |
| 2 申请上传 | `PUT finderassistancea.video.qq.com/applyuploaddfs`，`X-Arguments: apptype=251&filetype&weixinnum&filekey&filesize&taskid&scene=2` | 同 | ✅ |
| 3 分片 | `PUT finderassistanced.video.qq.com/uploadpartdfs?PartNumber&UploadID`，`scene=0` | 同 | ✅ |
| 4 完成 | `POST finderassistancea.video.qq.com/completepartuploaddfs?UploadID`，body `{TransFlag:'0_0',PartInfo}`，`scene=2` | 同 | ✅ |
| 5a 视频登记 | `POST .../post/post_clip_video`，body 含 `clipOriginVideoInfo{width,height,duration,fileSize}`、`traceInfo{traceKey,uploadCdnStart,uploadCdnEnd}`、`targetWidth/targetHeight`、`type:4`、`scene:7` | **缺** | ❌ |
| 5b 发布 | `POST .../post/post_create` 或 `post_draft` | 同 | ✅ |

### 数据校验（本条链路的判定口径）

- Step1 成功判据：`errCode===0` 且 `data.authKey` 非空；**响应不含 `cdnHost`**（实测），故主机必须用常量。
- Step2/4 成功判据：HTTP 2xx 且响应可 JSON 解析；失败时错误信息须带 `[host=…]` 以便归因。
- Step3 成功判据：每片 2xx；分片大小 8 MiB。
- Step5 成功判据：`errCode===0` 且返回体含 `postId/contentId/id` 之一；**仅有 2xx 不算成功**（见 8.1/8.4）。

### 待验证与后续

- 2026-10-23 13:52 起验证「主机修正后 Step5 是否可直接成功」。
- 若 Step5 因缺少视频登记而失败，则补 `post_clip_video`：其 `traceInfo` 需记录上传开始/结束时间戳（`getTimeStamp(10)`），`targetWidth/Height` 在竖版时按 `width<=height` 分支取 1080 或 1920 上限。

## 8.6 今日头条：上传已通、提交被封面阻断（2026-10-23 14:24 真机）

### 实测时间线（账号 7ae99805，真文案《被误解的明朝》）

| 时间 | 事件 | 判读 |
| --- | --- | --- |
| 14:24:25 | `add-video NO_BTN` | 「添加视频」按钮未出现，改走 file input 直传 |
| 14:26:52 | `file uploaded` | **视频确实上传成功**（历史首次在该分支达成） |
| 14:26:52 | `title input hasTitle=true selectorCount=4` | 标题框已出现并填写成功 |
| 14:27:16 | `cover dialog closed after failure: none` | 封面弹窗被尝试关闭（未找到取消键） |
| 14:27:17 | `cover path failed: no-next` | **「下一步」持续不可点** |
| 14:27:17 | `publishing...` | 执行了发布点击 |
| 14:27:19 | `publish confirm dialog clicked: CONFIRMED_IN_MODAL:确定` | 点到的是**弹窗内的「确定」**，非发布确认 |
| 14:27:46 | `artifact 未命中：no-endpoint-hit` | **没有任何发布请求发出** |
| 14:28:00 | `publish failed … 缺少平台作品 ID` | 判定失败 |

### 结论（数据校验）

- **上传链路已修通**：`file uploaded` + `title input hasTitle=true` 两条同时成立，可证明视频已附着。
- **提交未发生**：`_startPublishNetworkCapture` 已启用（禁用模式 0 处），但捕获到 **0 条**发布请求 ⇒ 不是判定器抓不到，是请求没发出。
- **最可能的阻断点**：封面未设置成功（`no-next`）。头条很可能要求封面必填，缺封面时发布按钮为禁用态，点击不产生请求。
- **`CONFIRMED_IN_MODAL:确定` 不可作为提交证据**：该「确定」来自弹窗作用域（`modals[s].querySelectorAll`），而上一行正是封面弹窗失败，二者时间相邻（1 秒内）。

### 下一步取证（已排程 15:45）

- 新增 `cover dialog shape: <控件清单> :: <弹窗文字>` 日志：在「下一步」不可点时 dump 弹窗内全部 `button/div[role=button]/span/a` 的文本与 `disabled` 态，以及弹窗整体文案。
- 判据：若出现 `请上传封面/请选择封面/尺寸不符` 等文案 ⇒ 按提示补输入；若按钮全为 `dis=true` ⇒ 需先完成前置选择；若无按钮 ⇒ 弹窗结构与预期不符，需重新采集选择器。

### 交互与提示文字（当前实现）

- 失败提示：`封面设置失败，已关闭弹窗继续发布`（warn 级，不阻塞主流程）
- 关窗尝试顺序：`取消` → `关闭` → `×`，均未命中时记录 `none`
- 关窗后固定等待 800ms 再继续，避免点击落在遮罩上。
### 8.1 完成证据分级（2026-10-23 真机教训）

判定「上传完成」时，证据必须按强度分级，**弱证据不得单独作为完成依据**：

| 级别 | 例子 | 可作为完成依据 |
| --- | --- | --- |
| 语义完成文案 | 上传成功 / 上传完成 / 上传完毕 / 检测为高清 | ✅ |
| 强结构 | `video` 元素可见且 `currentSrc` 为 blob/https，或时长 > 0 | ✅ |
| 弱 DOM 形状 | `[class*=progress]`、容器类名、进度条残留 | ❌ 单独不可用 |
| **静态 UI 文案** | 设置封面 / 添加视频 / 重新上传 | ❌ **上传前就存在** |

**失败案例**：`doneCopy` 正则里混入「设置封面」，该按钮在上传前即渲染 ⇒ 恒真 ⇒ `upload.ok=true` ⇒ 前置门禁放行 ⇒ 在视频未附加的情况下点击发布，白耗 60–80 分钟账号窗口。

**自查问句**：这个信号在**上传开始之前**会不会已经存在？若会，它就不能作为完成证据。
### 8.3 响应证据判定（页面判据失效时的兜底）

**适用场景**：发布动作已执行、平台已受理，但作品列表页读不到结果（导航不生效、内容在子 iframe、页面结构变更）。

**判据定义**：发布点击后捕获到的网络响应中，存在**同时满足**下列三条的记录，即判定发布成功，`evidence='publish-response'`、`mode='network'`：

| 条件 | 规则 |
| --- | --- |
| 状态码 | `200 <= status < 300` |
| 端点语义 | 命中 `publish` / `submit` / `create` |
| 端点排除 | **不得**命中 `media` / `upload` / `chunk` / `part` / `authkey` / `getauth` |

**为什么必须排除上传类端点**：视频发布会先做分片上传，每个分片都可能返回 201。若不加排除，第一个分片就会把任务判成「发布成功」——这是**假成功**，比失败更危险。

**真机依据（2026-10-23）**：视频号一次发布捕获 `n=3` 条响应，状态全为 `201`；同期页面判据始终 `post-list-timeout`（`url` 停在 `/platform/post/create`）。

**优先级**：页面判据命中时优先用页面证据（可拿到列表可见性）；页面判据超时才走响应判定。

**记录要求**：命中时必须打印 `publish 响应证据命中 endpoint=<前120字> status=<码>`，便于事后核对是哪一条请求被采信。
