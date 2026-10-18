# PRD — 发布失败归因与前置门禁（publish-precondition-gate）

- 版本：v1（2026-10-18）
- 状态：已实现并合入（PR 见执行记录 `openspec/records/publish-failures-6.md`）
- 关联：`01-docs/BUGFIX-PUBLISH-FAILURES-6PLATFORMS-2026-10-18.md`、`01-docs/PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md`（间隔窗口）、`01-docs/ARCH-PUBLISH-FREQUENCY-AND-QUEUE-2026-10-16.md`

---

## 1. 问题定义

2026-10-17 12:47–14:59 一次「一条视频发 9 平台」的批量发布，进度浮层显示 **成功 3/9 · 6 个失败**：

| 平台 | 浮层文案（用户所见） | 日志真因（本轮取证） | 定性 |
| --- | --- | --- | --- |
| 微信公众号 | 微信公众号草稿保存结果无法验证：缺少媒体 ID… | `save done without mediaId (saved=false … xhr=200)` —— 保存动作**未被平台确认**（30s 内既未跳转也无「保存完成」提示） | 文案错分层 + 保存未确认 |
| 抖音 | publish timeout | `upload-complete signal not detected … continuing best-effort` + `title: fill not applied (readback=0)` | **上游失败未 fail-fast** |
| 小红书 | 小红书仅允许保存到平台草稿箱…视频草稿链尚未实现… | 主动拒绝（用户硬约束：视频不得真实发布） | 功能缺口（诚实拒绝） |
| 视频号 | tencent_video not logged in | 页面被重定向到 `channels.weixin.qq.com/login.html` —— 登录态确实失效 | 账号态（真阳性） |
| 快手 | publish verification timeout | 作品管理列表「共45个作品」，最新 10-12 15:45，本次无新增 ⇒ **确实没发出去** | 验证正确、文案误导 |
| 今日头条 | publish btn not found | `file input hasVideo=true selectorCount=0` ⇒ 上传整段被跳过 | **能力未实现被伪装成失败** |

### 第一性问题（不是六个独立 bug）

六条里 **四条同源**：**上游关键步骤失败后没有 fail-fast，而是「尽力继续」，最终在「发布/验证」阶段以一条与根因无关的错误收尾。**

三个直接后果：

1. **归因错**：用户看到「超时/找不到按钮」，无法据此做任何正确动作（换平台？重试？重新登录？）。
2. **副作用白付**：发布按钮点击是**真实提交尝试**（平台风控面），每一轮无效点击都在消耗账号风险额度。
3. **吃掉发布间隔窗口**：失败落进「已提交」分类，视频号 60′ 账号档被一次假失败全额消耗（与 v4/v5 间隔策略直接冲突）。

---

## 2. 目标与非目标

### 目标

- G1 每一条发布失败，**首要文案必须是真因**（哪个环节、为什么），不得是下游症状。
- G2 在**点发布按钮之前**判定「内容是否真的进去了」；不成立则**不发车**。
- G3 前置门禁拦下的失败，**显式声明「可确证未送出」**，由队列回滚发布间隔窗口。
- G4 平台**能力未实现**（如头条视频）与**发布失败**在文案与数据上区分开，不再混为一谈。

### 非目标

- 不实现小红书的视频草稿链（能力缺口，见 §7 未闭合）。
- 不实现头条视频页的选择器集（需要真机 DOM 取证，见 §7）。
- 不改视频号登录态失效后的自动重登（属账号域）。
- 不改动平台侧频率档位（v5 产品决策）。

---

## 3. 功能逻辑

### 3.1 前置门禁四判据（P1–P4）

在 `_publish_generic` 中、**点击发布按钮之前**执行一次纯函数判定
（`apps/desktop/electron/services/publish-precondition.js`）：

| 判据 | 触发条件 | 判据含义 | reason |
| --- | --- | --- | --- |
| **P1** 上传入口存在 | 有 `article.video_path` 且平台 `selectors.file_input` 为空数组/未登记 | 该平台**视频发布未实现**（不是「失败」） | `upload-selector-missing` |
| **P2** 上传被确认 | 有视频且 `fillReport.upload.ok !== true`（含「没有 upload 记录」） | 视频没传完，发布必然被平台拒绝 | `upload-not-completed` |
| **P3** 标题已写入 | 有标题、平台非 no-title、且 `fillReport.title.ok !== true` | 必填项为空 | `title-not-filled` |
| **P4** 正文已写入 | 有正文且 `fillReport.content.ok !== true` | 必填项为空 | `content-not-filled` |

补充：P2 若 `fillReport.upload.error` 存在，判 `upload-exception`（文案带原始错误）。

**「没有记录」不等于「成功」**：`fillReport.upload` 缺省时按 `upload-not-completed` 处理。这是本次修复的核心口径——
旧代码里上传块被整段跳过时，`fillReport` 里连字段都没有，而后续逻辑默认「没报错就是成功」。

### 3.2 判据顺序与短路

1. P1（能力）先于 P2（执行）——「未实现」不该被报成「上传失败」。
2. 上传（P2）先于字段（P3/P4）——视频没进去时，字段填了也没意义。
3. 任一不成立 ⇒ **立即返回**，不进入发布按钮、不进入验证阶段。

### 3.3 与间隔窗口的接线（G3）

发布器返回 `{ success:false, error, definitelyNotSent:true, preSubmitBlocked:true, reason }`；
`publisher-router.js` 在把结果转成 `Error` 时**优先采信显式标记**：

```js
if (result.definitelyNotSent === true) rpaErr.definitelyNotSent = true
else markDefinitelyNotSent(rpaErr, result.error)   // 封闭词表兜底
```

**为什么不用文本匹配**：`publish-not-submitted.js` 的封闭词表要求每条都能论证「必然发生在平台写之前」，
中文短语（如「未登录」）被明确拒绝收录（可能发生在动作之后）。前置门禁在**点击之前**返回，
是比任何文本更强的结构性证据，因此走显式标记通道，两条通道互不放宽。

### 3.4 公众号「保存未被确认」与「采集不到 mediaId」分层

`saveWechatMpDraft` 返回 `saved`（保存是否被页面确认）与 `mediaId`（草稿 ID）两个独立事实：

| `saved` | `mediaId` | 判定 | 文案函数 |
| --- | --- | --- | --- |
| `false` | 空 | **保存动作本身没被确认** | `describeUnconfirmedSave()` |
| `true` | 空 | 保存成功但采集通道全失败 | `describeSaveFailure()`（含平台提示） |
| 任意 | 非空 | 进入后续（群发/发表/只存草稿） | — |

旧实现把前两种合并成「缺少媒体 ID」，把用户引向错误方向（去找媒体 ID）。

---

## 4. 流程

```
批量发布派发
  └─ _publish_generic(platform)
       ├─ 导航 + 登录态早退（返回 `<platform> not logged in`）
       ├─ 视频上传
       │    ├─ 无 file_input 选择器 → fillReport.upload = {ok:false, reason:'upload-selector-missing'}
       │    ├─ 上传等待 → fillReport.upload = {ok:true} / {ok:false, detail}
       │    └─ 重试用尽仍无结论 → {ok:false, detail:'重试已用尽'}
       ├─ 标题 / 正文 / 标签填写 → fillReport.title|content|tags
       ├─ ★ 前置门禁 evaluatePublishPreconditions()
       │    ├─ ok:false → 立即返回（preSubmitBlocked=true, definitelyNotSent=true）
       │    └─ ok:true  ↓
       ├─ 点发布按钮（+ 二次确认）
       └─ 验证（URL / 响应 / DOM / 产物列表兜底）
```

---

## 5. 交互逻辑与显示项

### 5.1 进度浮层

- 前置门禁拦截时，该平台条目的**阶段**直接落到「失败」，**不经过** `publishing...`/`verifying...`（因此不会出现「验证超时」）。
- 拦截不产生任何网络写请求，用户可在浮层直接点「重试失败项」。

### 5.2 失败文案的固定四段结构

每条失败文案必须同时回答四件事（缺一不可，测试已锁）：

1. **哪个平台**（显示名，如「今日头条」）
2. **哪个环节**（上传未完成 / 标题未写入 / 视频发布尚未支持 …）
3. **本次是否发出**（一律写明「本次未向平台提交任何内容，也未占用发布间隔」）
4. **下一步做什么**（重试 / 去后台草稿箱核对 / 改用图文 / 检查视频文件）

### 5.3 提示文字（权威文案，实现即此）

| reason | 文案 |
| --- | --- |
| `upload-selector-missing`（头条） | `今日头条 视频发布尚未支持：头条视频走西瓜视频上传页，但本仓尚未登记该页的上传入口选择器（图文链路不受影响）。本次未向平台提交任何内容，也未占用发布间隔。请改用图文发布，或改用其他平台。` |
| `upload-selector-missing`（其它平台） | `<平台> 视频发布尚未支持：本仓尚未登记该平台的视频上传入口选择器。本次未向平台提交任何内容，也未占用发布间隔。请改用图文发布，或改用其他平台。` |
| `upload-not-completed` | `<平台> 视频上传未完成（未检测到上传完成信号（页面未出现预览/编辑器/上传完成文案）），已中止，未点击发布。本次未向平台提交任何内容，也未占用发布间隔。请重试；若反复失败请确认视频文件可正常播放、体积未超平台上限。` |
| `upload-exception` | `<平台> 视频上传出错（<原始错误>），已中止，未点击发布。本次未向平台提交任何内容，也未占用发布间隔。请重试。` |
| `title-not-filled` | `<平台> 标题未写入（<读回细节>），已中止，未点击发布。本次未向平台提交任何内容，也未占用发布间隔。请重试；若反复失败请检查标题长度是否超平台上限。` |
| `content-not-filled` | `<平台> 正文未写入（<细节>），已中止，未点击发布。本次未向平台提交任何内容，也未占用发布间隔。请重试；若反复检查正文字数是否超平台上限。` |
| 公众号未确认保存 | `微信公众号草稿保存未被平台确认（点击保存后 30 秒内既未跳转、也未出现「保存完成」提示）。本次未确认发出：请到公众号后台「草稿箱」核对——若草稿已在，可直接在后台群发；若草稿不在，请稍后重试。` |

**措辞禁忌**：文案里不得出现「保存成功／已保存草稿／发布成功」等正向短语（即使是否定句）——
本仓多处按文本正则判成功/失败，否定句里的正向短语会给下游分类器制造假阳（本轮新用例已抓到一次）。

---

## 6. 数据校验

| 编号 | 校验项 | 判据 | 失败后果 |
| --- | --- | --- | --- |
| V1 | 平台是否登记视频入口 | `Array.isArray(selectors.file_input) && length>0` | 判未实现，不点发布 |
| V2 | 上传是否被确认 | `fillReport.upload.ok === true`（缺记录视为 false） | 不点发布 |
| V3 | 标题是否写入 | `fillReport.title.ok === true`（no-title 平台豁免） | 不点发布 |
| V4 | 正文是否写入 | `fillReport.content.ok === true` | 不点发布 |
| V5 | 「未送出」标记 | 发布器返回 `definitelyNotSent:true` → 队列回滚窗口 | 否则吃掉整窗口 |
| V6 | 公众号保存确认 | `saved === false` 与 `mediaId === ''` 分开判定 | 文案指向错误方向 |
| V7 | 文案不变式 | 每条失败文案必含「本次未向平台提交任何内容」+「未占用发布间隔」 | 用户无法判断是否已发出 |

---

## 7. 未闭合（不假装已解决）

1. **头条视频仍未实现**：`videoPublishUrls.toutiao` 指向西瓜上传页，但 `PLATFORM_PUBLISH_SELECTORS.toutiao` 是图文文章页那套且无 `file_input`。
   本轮只做到「明确拒绝 + 说清原因」，**没有**登记视频页选择器——那需要真机 DOM 取证（本仓规则：选择器必须有取证来源，不得猜）。
2. **小红书视频草稿链未实现**：维持主动拒绝，文案已可操作。
3. **视频号登录失效**：真阳性，属账号域；本轮未加「发布前主动刷新登录态」。
4. **快手发布未成**：证据显示确实未发出（列表无新增），但**发布时页面 toast 未被捕获**（验证阶段已导航到列表页）。建议后续在点确认后立刻抓一次页面 toast 再导航。
5. **抖音上传完成后「转码中」竞态**：本轮把 besteffort 放行改为「拦下」，若平台确实需要更久转码，可能出现「本可成功却被拦」。缓解：上传等待预算已按文件大小自适应，且有 180s 停滞检测。

---

## 8. 验收

- 单元：`apps/desktop/electron/services/publish-precondition.test.js`（12 例）
- 接线：`publish-precondition-wiring.test.js`（3 例：头条现场 / 抖音现场 / 全绿放行）
- 文案分层：`wechat-mp-draft-mediaid.test.js` 新增 4 例
- 门禁：`apps/desktop` 全量 + `packages/*` 无回归；QM-1 打包与启动验证；
  失败文案的 `definitelyNotSent` 与间隔窗口回滚（与 `fix-release-window-taken-type-mismatch` 联动）
