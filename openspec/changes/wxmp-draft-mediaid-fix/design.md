# Design — wxmp-draft-mediaid-fix

## 1. 根因链（逐条取证）

### 1.1 mediaId 恒空（真因）

`_publish_wechat_mp` 保存段（修复前）：

```js
const saveResp = await saveResponse
const finalUrl = win.webContents.getURL()
const match = finalUrl.match(/appmsgid=(\d+)/)          // 通道 ①
if (match) mediaId = match[1]
if (!mediaId && saveResp && saveResp.url) {              // 通道 ②
  const respMatch = String(saveResp.url).match(/appmsgid=(\d+)/)
  if (respMatch) mediaId = respMatch[1]
}
```

两条通道都要求 **URL 里带 `appmsgid=`**。而编辑器 URL 是
`appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&token=…`（新建态），
保存按钮是 `a#js_sync_save`（公众号「同步保存」，语义即**原地保存不跳转**）。

旁证（本仓既有结论，非本轮实测）：API 轨 `readbackDraft` 要用
`t=media/appmsg_edit&action=edit&appmsgid=<id>&token=…` **单独发一次请求**才能按 ID 回读
—— 说明 ID 只活在「保存响应体 / 回读请求」里，不在页面 URL 里流转。

⇒ 通道 ③（响应体 `appMsgId`）不是优化，是**唯一可达**的那条。

### 1.2 「平台提示」误读（放大镜）

`wechat-mp-dom-guard.js` 的 `readEditorToast`：

```js
const t = (els[j].innerText || '').trim()
if (t) return t.slice(0, 200)
```

无可见性判据。2026-10-12 Playwright 实测（自建 fixture，非公众号页面）：

| 节点 | `innerText` | `offsetParent` | `getClientRects().length` |
| --- | --- | --- | --- |
| `.js_tips` + `display:none` | 返回文本 | `null` | 0 |
| `.video-tips` + `left:-9999px` | 返回文本 | 元素 | 1 |
| `.weui-desktop-toast` + `display:none` | 返回文本 | `null` | 0 |

结论：`innerText` **无法区分隐藏与可见**；`offsetParent` 对 `display:none` 为 null、
对 `position:fixed` 也为 null（Toast 常是 fixed）⇒ 必须与 `getClientRects()` 取**或**。

## 2. 决策与备选方案

### 决策 1：新增独立通道 ③，而非放宽通道 ② 的正则

- **选它**：② 与 ③ 是**不同数据位置**（响应 URL vs 响应体 JSON）。分开实现才能让
  日志与测试回答「ID 是从哪来的」——这是真机复现时最关键的二分信息。
- **不选放宽 ② 的正则**：会把「响应 URL 匹配失败」与「响应体也没 ID」混为一谈，
  二者根因完全不同（前者是 URL 形态变了，后者是平台真没返回）。
- **不选「改判成功条件为页面提示」**：`保存成功|已保存` 文案判据已有（`_waitForCondition`），
  但它不能替代 ID 采集 —— 群发段需要 mediaId 去 `[appmsgid="…"]` 选行。
  ID 是**后续步骤的输入**，不只是成功证据。

### 决策 2：`appMsgId` 键名与 API 轨对齐

- **选它**：`packages/api-publish-engine/src/adapters/wechat-mp/draft.js` 的 `createDraft`
  已经定义了口径（`data.appMsgId || data.app_msg_id || base.appMsgId`，且 `'0'` 视为未创建）。
  DOM 轨照抄同一组键名与同一套「0 不算创建」判据。
- **不选「自造一套键名」**：会出现「API 轨说失败、DOM 轨说成功」的分裂 ——
  这是比当前 bug 更难排查的一类问题。

### 决策 3：可见性判据取「或」，且不缩选择器表

- **选它**：`offsetParent` 对 fixed 为 null；只用它会把 fixed Toast 全判成不可见
  （用户连平台真实错误都看不到）。只用 `getClientRects` 则对部分 `visibility:hidden`
  场景不稳。取或 + 表不缩，是「收紧误报」与「不漏真提示」的唯一交点。
- **不选「删掉 `.js_tips` / `[class*="tips"]` 候选」**：那是用删表换正确性，
  下次真 toast 恰好带 `tips` 类名就又漏了。判据要修在**节点属性**上，不是候选清单上。

### 决策 4：实现拆新文件，不塞进 `rpa-view-platforms.js`

- **选它**：该文件在 `.github/scripts/max-lines-baseline.json` 的 `targets` 里被**点名**
  （登记 1484，容差 0）。内联实现会直接吃掉余量并撞线。
- **顺带正收益**：保存段从 35 行压到 ~10 行，文件从 1483 → 1415 行（**负增长 68 行**）。

## 3. 数据校验规则表

见 PRD §14.1（mediaId 响应体通道 D1–D6）与 §14.2（提示可见性 V1–V4）。

关键两条：

- **D4**：`appMsgId` 为 `0` / 空串 ⇒ 视为未创建。与 API 轨 L149 同口径。
- **V1**：`!!el.offsetParent || el.getClientRects().length > 0` —— 必须取或。

## 4. 交互逻辑与提示文字

见 PRD §16.1（用户可见变化四场景）、§16.2（历史页单行 40 字约束）、§16.3（新增 info 日志）。

## 5. 测试策略

| 层 | 文件 | 模式 | 覆盖 |
| --- | --- | --- | --- |
| 单元 | `wechat-mp-draft-mediaid.test.js` | mock host + mock win | 14 例：三条通道各自命中/全空 fail-closed、`appMsgId=0` 不认、畸形 body 不抛、可见性守卫形态、可操作文案、原创/群发保护不回归 |
| 回归 | `rpa-view-platforms.test.js` / `rpa-view-wechat-publish-judgement.test.js` / `wechat-mp-dom-guard.test.js` / `wechat-mp-article.test.js` | 既有 | 133 例不得破 |
| 变异 | `scripts/mut-check-wxmp-mediaid.cjs` | 4 个变异 | 摘响应体通道 / 不拒 0 / 去可见性守卫 / 去可操作提示 ⇒ 各自变红 |

## 6. 风险与回退

| 风险 | 缓解 |
| --- | --- |
| `_waitForResponse` 当前不返回 `body`，通道 ③ 在真机上可能取不到 | 通道 ③ 对缺失 `body` 静默跳过（不抛）；日志明确区分「响应未匹配」与「响应体无 ID」；若真机确认需要 body，下一刀给 `_waitForResponseExclusive` 补 CDP `Network.getResponseBody`（需评估隐私面） |
| 可见性判据漏掉真 toast | 取「或」覆盖 fixed；选择器表不缩；AC-17 锁形态 |
| 补通道被误读为放宽判据 | AC-16 锁「三条全空仍 fail-closed」；变异 M1 反证 |
