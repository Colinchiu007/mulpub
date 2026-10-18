# BUGFIX — 发布失败 6 平台归因：上游失败不再「尽力继续」+ 发布前置门禁

- 日期：2026-10-18
- 分支：`publish-failures-6`
- 关联：`01-docs/PRD-PUBLISH-FAILURE-ATTRIBUTION-2026-10-18.md`、`openspec/records/publish-failures-6.md`

---

## 1. 用户看到的现象

一条视频发 9 平台，进度浮层「**成功 3/9 · 6 个失败**」：

```
微信公众号  ✗ 失败  微信公众号草稿保存结果无法…（截断）
知乎        ✓ 成功
抖音        ✗ 失败  publish timeout
小红书      ✗ 失败  小红书仅允许保存到平台草稿箱…
视频号      ✗ 失败  tencent_video not logged in
快手        ✗ 失败  publish verification timeout
今日头条    ✗ 失败  publish btn not found
Bilibili    ✓ 成功
baijiahao   ✓ 成功
```

---

## 2. 取证

日志：`shared-user-data/logs/app-2026-10-17.log`（批次 12:47–14:59）
快照：`<%TEMP%>/mp-rpa-diag/kuaishou-verify-1792241775440.png`

### 2.1 头条：能力声明与能力实现分叉

```
13:00:04 [toutiao] file input hasVideo=true selectorCount=0      ← 上传入口一个都没有
13:00:04 [toutiao] title input hasTitle=true titleType=string selectorCount=4
13:00:14 … waitForElement timeout textarea[placeholder*="文章标题"]
13:01:46 [toutiao] publish btn: publish btn not found
13:01:46 [toutiao] publish click failure visibleActionCount=12
页面 URL：https://mp.toutiao.com/profile_v4/xigua/upload-video   ← 西瓜视频上传页
```

代码事实：
- `packages/api-publish-engine/src/platform-entries.js`：`videoPublishUrls.toutiao = https://mp.toutiao.com/profile_v4/xigua/upload-video`（注释自述「提取自参考产品 videoPublishUrls」）。
- `packages/rpa-engine/src/platform-selectors.js`：`PLATFORM_PUBLISH_SELECTORS.toutiao` 只有 `write_btn / title_input / editor / publish_btn`，**没有 `file_input`**，且那四组都是图文文章页（`graphic/publish`）的 DOM。

⇒ 视频路径「入口有、选择器没有」：上传整段被跳过，标题/正文/发布按钮全部落空，最后一轮才炸在「找不到发布按钮」。

### 2.2 抖音：best-effort 放行把真因吞掉

```
13:02:11 [douyin] video upload-complete signal not detected (preview/url), continuing best-effort
13:02:11 [douyin] video uploaded
13:02:13 douyin title: fill not applied (readback=0)
13:03:18 [douyin] publish timeout
```

`_waitForVideoUploadComplete(...)` 返回 `false`（besteffort），**返回值被丢弃**，只打一条 warn 继续；
标题 `readback=0` 只写进 `fillReport.title.ok=false`，**没有任何消费者**在发布前检查它。

### 2.3 公众号：两种不同处境共用一条文案

```
12:59:09 [wechat_mp] save done without mediaId (saved=false url=…appmsg_edit_v2&isNew=1&… xhr=200)
12:59:09 [wechat_mp] save draft result unverifiable: missing mediaId
```

`saved=false`（保存动作**没被平台确认**：30s 内既未跳转也无「保存成功」提示）与
「保存成功但采集不到 mediaId」被合并成同一句「缺少媒体 ID」。

### 2.4 快手：验证正确，文案误导

12:56:15 的诊断快照显示页面是**作品管理 / 已发布**列表，「共45个作品」，最新一条 `2026-10-12 15:45`；
截图确认本次批次**没有新增作品**。⇒ 快手这条确实没发出去，`publish verification timeout` 是**正确判定**，
但用户读到的是「超时」，无法区分「没发出」与「发了没验证到」。

### 2.5 视频号：真阳性

```
13:48:00 [tencent_video] not logged in url=https://channels.weixin.qq.com/login.html
```

页面被重定向到登录页 —— 登录态确实失效。这条**不是代码缺陷**（且 `not logged in` 已在
`publish-not-submitted.js` 的「可确证未送出」封闭词表里，会回滚间隔窗口）。

### 2.6 小红书：明确的功能缺口

```
12:50:25 小红书仅允许保存到平台草稿箱（用户硬约束：不得真实发布）；视频草稿链尚未实现，已拒绝真实发布。
```

主动拒绝，不是 bug。文案本身可操作。

---

## 3. 第一性原因

**六条里四条同源**：上游关键步骤失败后没有 fail-fast，而是「尽力继续」，
最终在「发布/验证」阶段以一条与根因无关的错误收尾。

三个后果：

1. **归因错**：用户看到「超时/找不到按钮」，无法据此做任何正确动作。
2. **副作用白付**：发布按钮点击是真实提交尝试（平台风控面），无效点击在消耗账号风险额度。
3. **吃掉发布间隔窗口**：失败落进「已提交」分类，视频号 60′ 档被一次假失败全额消耗。

---

## 4. 逃逸分析（为什么一整轮没被发现）

| 层级 | 为什么没拦住 |
| --- | --- |
| 单元测试 | 没有「平台缺 `file_input`」这一形态的用例；`fillReport.upload` 当时根本不存在 |
| 集成测试 | `_publish_generic` 的既有用例都**注入完整 config**，从没测过「选择器缺失」；`_waitForVideoUploadComplete` 全被 mock 成通过 |
| E2E | 头条视频从未成功过，没有可比基线；抖音 besteffort 被当成正常路径打过 warn 就没人追 |
| 代码审查 | `if (sel.file_input && sel.file_input.length>0)` 被读成「防御性写法」，而不是「静默跳过」 |

**系统性漏洞**：`fillReport` 是**只写不读**的字段（修复前 `grep fillReport` 只有赋值 + draftOnly 一处消费）。
「收集了证据但没有消费者」等价于没收集。

---

## 5. 修复

| 层 | 文件 | 改法 |
| --- | --- | --- |
| 判据 | `apps/desktop/electron/services/publish-precondition.js`（新） | 纯函数四判据 P1–P4 + 文案表；`evaluatePublishPreconditions()` 与 `describeFailure()` |
| 接线 | `apps/desktop/electron/services/rpa-view-platforms.js` | ① 记录 `fillReport.upload` 三态；② **接住**上传等待返回值；③ 重试用尽兜底为未完成；④ 发布按钮**之前**跑门禁 |
| 窗口 | `apps/desktop/electron/services/publisher-router.js` | `result.definitelyNotSent === true` ⇒ 显式打标（优先于封闭词表），队列据此回滚间隔窗口 |
| 文案分层 | `apps/desktop/electron/services/wechat-mp-draft-mediaid.js` | 新增 `describeUnconfirmedSave()`；`!mediaId` 分支先判 `saved===false` |

### 为什么必须拦在点击之前

- 发布按钮点击是**副作用**（真实提交尝试，平台风控面）；
- 点完没反应只能得到 `publish timeout` 这类与根因无关的症状；
- 「点击之前」失败 = **平台写操作必然未发生**，是比任何文本匹配更强的结构性证据，可直接标 `definitelyNotSent`。

### 明确不改

视频号 60′ 间隔档（产品决策）、平台选择器（缺真机证据不猜）、小红书视频草稿链、登录态自动重登。

---

## 6. 回归保护

- `publish-precondition.test.js`（12 例）：P1–P4 分支、上传记录缺失≠成功、no-title 豁免、纯图文不看 upload、**文案不变式**。
- `publish-precondition-wiring.test.js`（3 例）：**接线锁** —— 头条现场拦下且 `_click/_clickStable/_clickViaCdp` 零调用；抖音 besteffort 拦下；全绿放行。
- `wechat-mp-draft-mediaid.test.js`（+4 例）：两种处境文案不得合并；不得声称成功；措辞不含正向短语。

**为什么要有接线锁**：判据写得再对，没接在主流程上就一行都不生效，而「没接线」在只有单元测试的仓里看不见——这正是本次两条真因被掩盖一整轮的方式。

---

## 7. 实测读数

见 `openspec/records/publish-failures-6.md` §六/§七（受影响面 46 文件/787 passed；ESLint rc=0；
QM-1 打包 rc=0；启动验证 alive(8s)=true / stderr 0 字节 / PASS）。

---

## 8. 残留风险（不假装已闭合）

1. **头条视频仍未实现**：只做到明确拒绝 + 说清原因；选择器需真机 DOM 取证。
2. **小红书视频草稿链未实现**：维持主动拒绝。
3. **视频号登录失效**：属账号域，未加发布前主动刷新。
4. **快手发布时 toast 未捕获**：验证阶段已导航到列表页，发布瞬间的页面提示丢失。建议后续在点确认后立刻抓一次 toast 再导航。
5. **抖音「转码中」竞态**：besteffort 由「放行」改为「拦下」，若平台确实需要更久转码，可能本可成功却被拦。缓解：上传预算按文件大小自适应 + 180s 停滞检测。

---

## 9. 排查手册（下次遇到同类）

```sql
-- 1. 这批到底发出了几条？看各平台「作品/草稿」列表最新时间，而不是看浮层文案
-- 2. 失败平台的日志按这个顺序读：
--    a. file input hasVideo=… selectorCount=?   ← 0 = 该平台视频入口没登记（未实现）
--    b. upload-complete signal … / waiting upload…  ← 上传是否被确认
--    c. title/content readback=?                ← 必填项是否写入
--    d. publish btn / publish timeout / verification timeout  ← 只有前三步都 OK，这层才有意义
-- 3. 浮层文案是「症状」，日志前四步才是「根因」
```
