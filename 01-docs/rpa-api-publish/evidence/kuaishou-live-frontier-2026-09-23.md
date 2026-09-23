# 快手 RPA 第二平台活体推进证据（2026-09-23）

账号 `a4505f45`（is_active=true），720p 小体积视频，经应用内 RpaView（浏览器自签名，合规）实测。

## 关键日志（app-2026-09-23.log，节选，按阶段）

```
[kuaishou] cookies restored
[kuaishou] supplemented 16/16 cookies from auth partition account-a4505f45
[kuaishou] post-nav dialogs dismissed: 放弃
[kuaishou] uploading file...  ->  [kuaishou] file uploaded
[kuaishou] no dedicated title field, title falls back to editor sel=#work-description-edit
[kuaishou] content already composed into editor caption, skip separate fill
[kuaishou] AI declaration result: NO_DECLARATION_FOUND
[kuaishou] DIAG[publish2] pubBtn=7 cfgHasApi=false prePublishHook=
[kuaishou] publishing...
RpaView waitForElement timeout sel=button:has-text("发布") timeoutMs=3000 url=.../article/publish/video?tabType=1
RpaView waitForElement timeout sel=button:has-text("发表") timeoutMs=3000 url=.../article/publish/video?tabType=1
RpaView waitForElement timeout sel=span:has-text("发 布") timeoutMs=3000 url=.../article/publish/video?tabType=1
[kuaishou] verifying...
[WARN] [kuaishou] publish signal lacked platform ID; endpoint=https://cp.kuaishou.com/article/publish/video responses=0
[WARN] publish failed platform=kuaishou error=发布结果缺少平台作品 ID
[ERROR] Executor Publish failed for kuaishou: 发布结果缺少平台作品 ID
```

## 结论

- 上传 / 标题 / 封面 / 表单填充全部通过；发布按钮被点击（pubBtn=7 命中配置专用候选）。
- **决定性证据 = `responses=0`**：发布网络捕获（relevant 覆盖 publish/submit/create/video/work）在点击发布→停止捕获窗口内记录 0 条相关响应，说明点击为**空操作、从未发出提交 XHR**。失败真身在「点击→提交」环节，而非回查匹配。
- 2 次尝试均止于未提交，未向账号公开发布任何内容；重传风暴经 cancelTask 清空队列止住（pending=0 running=0）。
- 合规墙：除 B站外视频平台官方 API 发布依赖被禁的第三方远程签名，本地近似签名必被服务端拒；唯一合规杠杆为应用内 RPA。

## 下一步（证据化，勿盲改选择器）

- 在「仅上传成草稿、不公开提交」前提下 dump 发布按钮清单（text/disabled/class/offsetParent）+ 点击后是否出现确认弹层，定位 (a) 按钮 disabled 过早点击 / (b) 缺二次确认步 / (c) 选择器错元素，再 TDD 修复 `_verifyPublishSuccess`/发布点击。
