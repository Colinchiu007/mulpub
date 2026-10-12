# wxmp-draft-mediaid-fix：公众号草稿保存 mediaId 采集补通道 + 平台提示可见性判据

## Why

用户报障：发布图文到微信公众号报

```
微信公众号草稿保存结果无法验证：缺少媒体 ID（平台提示：从公众平台上传的非转载视频才能设置弹幕功能）
```

两层原因：

1. **真因（判据漏通道）**：`_publish_wechat_mp` 保存草稿后只从两处取 mediaId ——
   页面 URL 的 `appmsgid`、保存 XHR 响应 URL 的 `appmsgid`。公众号新版后台
   （`appmsg_edit_v2` + `isNew=1`）保存后 **URL 不跳转**，响应 URL 也不带该参数；
   ID 只在**响应体 JSON**（`appMsgId`）里。于是 mediaId 恒空，草稿存进去了也判「无法验证」。
2. **放大镜（提示误读）**：`readEditorToast` 用 `innerText` 读 `.js_tips` /
   `[class*="tips"]` 等候选，而 `innerText` 对 `display:none` / 离屏节点**照样返回文本**
   （2026-10-12 Playwright 实测取证）。编辑器里与本次失败无关的常驻说明
   （视频弹幕规则）被当成「平台提示」拼进 error，把可自愈的重试类问题伪装成平台业务错误。

## What Changes

- **新增** `apps/desktop/electron/services/wechat-mp-draft-mediaid.js`：
  - `saveWechatMpDraft(host, win)` —— 点保存 + 轮询成功标识 + **三条** mediaId 采集通道
    （URL > 响应 URL > **响应体 `appMsgId`**）；
  - `buildVisibleToastScript(selectors)` —— 平台提示只读**可见**节点
    （`offsetParent || getClientRects().length`，取或，覆盖 `position:fixed` 的 Toast）；
  - `describeSaveFailure(raw, fallback)` —— 失败文案必须带**可操作下一步**。
- **修改** `apps/desktop/electron/services/rpa-view-platforms.js`：
  - 保存段整段下沉到新模块（该文件被 `max-lines-baseline.json` 的 `targets` 点名，
    登记 1484 / 容差 0，本次改动后 1415 行，仍在限内）；
  - 新增 `readVisibleEditorToast(win)`；群发/发布段的 toast 读取也切到可见性判据（同族缺陷）。
- **新增** 回归锁 `wechat-mp-draft-mediaid.test.js`（14 例）。
- **新增** 变异反证脚本 `scripts/mut-check-wxmp-mediaid.cjs`（4 个变异）。

## Impact

- **Affected specs**: `wechat-mp-article-publish`（扩展其「草稿保存」语义）
- **Affected code**:
  - `apps/desktop/electron/services/wechat-mp-draft-mediaid.js`（新）
  - `apps/desktop/electron/services/wechat-mp-draft-mediaid.test.js`（新）
  - `apps/desktop/electron/services/rpa-view-platforms.js`（保存段接线 + toast 判据）
  - `scripts/mut-check-wxmp-mediaid.cjs`（新）
- **不涉及**：渲染层、locales、IPC、`platforms.yaml`（公众号仍 `dom-only`）。
- **QM-1**：改 `apps/desktop/electron/**` ⇒ 需本地打包验证。
