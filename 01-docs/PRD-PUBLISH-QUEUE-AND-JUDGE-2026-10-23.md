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

## 8.7 登录态双存储：凭证库 vs 浏览器 session（2026-10-23 实测）

### 现象

用户重新扫码登录视频号后，程序仍报未登录。四次测量：

| # | 测量 | 读数 |
| --- | --- | --- |
| 1 | App 侧凭证库 cookie 长度 | `cookieLen 142 → 284`（**登录已生效**） |
| 2 | CDP 页面 URL | `https://channels.weixin.qq.com/login.html` |
| 3 | CDP `context.cookies(...)` | **0 条** |
| 4 | 页内 `POST helper_upload_params` | `errCode=300334`（登录前为 `300342`） |

### 结论（数据校验）

- 登录态写入**应用凭证库**（加密存储 / 账号分区），而 RPA 发布页读取的是 **Electron 浏览器 session 的 cookie**。
- 二者之间没有同步桥 ⇒ 页面永远判定未登录，API 轨的 Step1 也拿不到 `authKey`。
- 错误码变化（`300342 → 300334`）本身即是「登录确实落在别处」的反证。

### 修复（PR #4321）

- 在 `rpa-view-manager.js` 解析出 cookie 字符串后，按 cookie 名逐条调用
  `session.defaultSession.cookies.set({ url, name, value, domain, path })`。
- 域名映射：`tencent_video → .weixin.qq.com`；`toutiao → .toutiao.com`。
- 成功日志：`cookie inject -> browser session: N cookies platform=… domain=…`。
- 失败仅 warn，不阻塞发布（fail-open：注入失败时退回原有行为，不应让整条发布中止）。

### 交互与提示文字

- 成功：INFO 级一行，含注入条数、平台、域名。
- 失败：内部 warn，不向用户提示，避免把内部通道问题暴露为产品错误。
- 用户侧无新增按钮或文案；登录仍走既有「账号管理 → 重新登录」。

### 为什么头条当时不加此修复

- 头条 14:24 的运行已达成 `file uploaded` + `title input hasTitle=true`，说明其会话有效。
- 验证窗口前 15 分钟内不引入变量，是今天确立的纪律。

## 8.11 视频号：真正卡点是「视频没有附上」（截图实证，2026-10-23）

### 截图证据

`D:\Temp\mp-rpa-diag\tencent_video-verify-*.png`（代码自动留存）：

| 区域 | 画面 |
| --- | --- |
| 页面 | 「视频管理 / 发表动态」，左下头像 + 退出登录 ⇒ **已登录** |
| 短标题 | 「被误解的明朝：西方史料里的另一个」 ⇒ **已写入** |
| 视频描述 | 显示占位符「添加描述」 ⇒ **空** |
| 视频上传区 | 虚线框 + 「+」+ 上传说明 ⇒ **没有视频** |
| 弹窗 | **没有任何可见弹窗** |

### 由此推翻的两个错误判断

1. **「切换视频号」不是遮挡层**：它是左下账号菜单里的**隐藏项**，被探针按 `[class*=modal]` 采集到。
   ⇒ 之前三轮针对它的补丁（点取消 / 强制隐藏 / 程序化点击）**目标不存在**。
2. **「desc filled readback=189」不可信**：真实输入框仍为空，说明写入作用在了非真实编辑器节点上。

### 真正的阻塞

`upload-waiter` 的日志序列是：

```
uploading file...   →   uploading file...   →   uploading file...
（然后直接跳到 title input / desc filled）
```

⇒ `_resolveSelector` **没有匹配到可用的 file input**，循环重试后（retry 用尽）继续往下走，因此
`_setFileInput` 与拖拽回退**从未被调用**。发布按钮不存在（`programmatic publish click: not-found`）
也正因如此。

### 已加的诊断

```
[tencent_video] file inputs on page: <accept>|<class> ; …   或  NONE
```

### 判据与对应修法

| 诊断结果 | 修法 |
| --- | --- |
| `NONE` | 页面无 `input[type=file]` ⇒ 走「点击上传框触发原生选择器」或纯 `DragEvent('drop')` |
| 有 `accept=.mp4` 但 class 不匹配 | 放宽/修正选择器 |
| 多个候选 | 按 `accept` 过滤出视频那个 |

### 产品侧提示文字建议

当上传步骤未获得「视频已附上」的证据时，应提示用户：
「视频未能上传成功，请重试或改用网页端发布」，而不是继续走发布流程并报「缺少作品 ID」。

## 8.12 与逆向成果对照：视频号端点集差异（2026-10-23）

### 成果侧（`mtm-platform-apis.md` L468–495，498 端点清单中的视频号部分）

```
/cgi-bin/mmfinderassistant-bin/auth/auth_data
/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params
/cgi-bin/mmfinderassistant-bin/helper/helper_parse_mp_link
/cgi-bin/mmfinderassistant-bin/post/post_create
/cgi-bin/mmfinderassistant-bin/post/post_list
/cgi-bin/mmfinderassistant-bin/post/get-finder-post-trace-key
/cgi-bin/mmfinderassistant-bin/statistic/post_list
```

### 我方现状（`packages/api-publish-engine/src/publish/platforms/shipinhao-video.js`）

| 步骤 | 我方实现 | 成果里是否存在 |
| --- | --- | --- |
| Step1 取 authKey | `helper/helper_upload_params` | ✅ 存在（同一端点） |
| Step2 申请上传 | `PUT {cdn}/applyuploaddfs` | ❌ **清单里没有** |
| Step3 分片 | `{cdn}/uploadpartdfs` | ❌ 没有 |
| Step4 完成 | `{cdn}/completepartuploaddfs` | ❌ 没有 |
| Step5 发布 | `post_create` / `post_draft` | ✅ 存在 |

### 推论

1. `helper_upload_params` 的响应里**没有 `cdnHost`**（真机日志 `step1Keys=errCode,errMsg,data`，`data` 仅含
   `authKey/uin/appType/videoFileType/...`），而三条 `*dfs` 路径在任一候选主机上均 404。
   ⇒ **我方假设的上传协议形状很可能不成立**，不是"主机写错"，是"路径不存在"。
2. 成果清单是参考产品实际调用过的端点集合，`*dfs` 一条都没有 ⇒ 参考产品**不做自拼 `applyuploaddfs`**。

### 可立即改进的一项（不需要新逆向）

`post/post_list` 是**只读**端点，可作为发布校验口。当前校验走作品页（SPA 懒加载，实测
`works-page-timeout`），改用它可以把"作品是否出现"变成一次结构化查询。

### 下一步（需要一次页面侧证据）

在真实浏览器会话里**手动上传一个视频**并抓包，读出页面自己发出的上传请求（host + path + 请求头），
以它为准重写 Step2–4；**不要再用 `applyuploaddfs` 这个猜测**。

### 红线遵守

- 只使用只读端点做验证（`post_list` / `auth_data`）；
- 不在日志/文档中写入任何 cookie、authKey、token 值（本文只写字段名）。

## 8.13 与逆向成果对照：今日头条视频发布端点（2026-10-23）

### 成果侧（`mtm-platform-apis.md` L296–363）

```
https://mp.toutiao.com/ugc/publish/video/v1/get_token/     ← 取上传/发布令牌
https://mp.toutiao.com/ugc/publish/video/v4/commit/       ← 提交发布
https://mp.toutiao.com/profile_v4/xigua/upload-video      ← 发布页
https://mp.toutiao.com/mp/agw/creator_center/list         ← 作品列表（只读）
```

### 我方（`packages/api-publish-engine/src/publish/platforms/toutiao-video-publish.js`）

```
/xigua/api/upload/GetPublishAuth
/xigua/api/upload/PublishVideo
/ixigua/api/upload/GetPosterList/
```

我方这套是**从前端 bundle 逐字抄的**（文件头注释引用了 `a.ZP.requestJsonNew("/xigua/api/upload/PublishVideo", Y, !0)`），
成果那套是**参考产品运行期实际调用的**。两者并存说明平台有新/旧两条链。

### 现状与判据

| 事实 | 含义 |
| --- | --- |
| RPA 轨：`exact 发布 click: clicked` → `NO_DIALOG` → **无 publish 请求** → 无作品 | 点击未触发提交 |
| RPA 轨：两段式恢复后（移除多余首点）仍然 `responses=0` | 两段式假设**也未成立** |
| API 轨：`GetPublishAuth` / `PublishVideo` 未被使用（运行时走了 RPA） | API 轨在头条上**没有启用** |

### 下一步（按判据强度排序）

1. **优先试成果里的 `ugc/publish/video/v4/commit/` 链**：它来自参考产品的真实调用集合，
   比我方从 bundle 推断的 `PublishVideo` 更可信。
2. 校验一律用只读端点 `mp/agw/creator_center/list`（已在 `toutiao-artifact.js` 的 `LIST_ENDPOINTS` 中）。
3. **不要再用「多点几次」的方式尝试**：两段式与精确点击两条路都已证伪。

### 红线

- 只用只读端点做验证；
- 文档/日志只写字段名与路径，不写 cookie/token 值。
