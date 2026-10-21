# tt-squash — 头条/视频号视频发布修复（2026-10-22 汇总）

> 本 PR 是 `tt-upload-signal-fix`（22 个提交、长期 CONFLICTING）的 **squash 重建**：
> 代码整取、PRD 做 union、记录合并，以便通过门禁并正常触发 CI。

## 变更范围

| 模块 | 内容 |
| --- | --- |
| 上传完成信号 | `doneCopy` 正向判据；`doneStrong` / `uploadingText` 单列；P3.5 决策；探测 15s 硬超时；文本取值 `innerText \|\| textContent` |
| 翻译层 | `_probeUploadSignal` 白名单补 `uploadingText` / `doneStrong` / `textLen`（此前被静默丢弃） |
| 预算 | `PLATFORM_MIN_BUDGET_MS = { toutiao: 600000 }` |
| 标题 | `title-fill-verify.js`：等值回读 + 不一致重填 + 优先命中可见元素（页面有隐藏同名副本） |
| 封面 | `toutiao-cover.js`：头条无 image input，走「上传封面 → 本地上传 tab（动态创建 image input）→ 纯 CDP 设文件 → 下一步 → 二次确认」 |
| 门禁 | `publish-precondition` 增 `noBodyPlatform`；封面无选择器时必须 warn |
| 选择器 | `toutiao_video` 补 `cover_input` / `cover_trigger`；`tencent_video` 补 `editor` / `cover_input` |

## 证据强度

| 结论 | 强度 |
| --- | --- |
| 翻译层白名单丢字段是真因（修后 textLen 125 vs undefined，147s vs 600s 命中上传成功） | 实测 |
| 标题被平台填成文件名、可见元素优先修好后截图标题 18/30 正确 | 实测 |
| 头条封面无 image input、切 tab 后动态创建 4 号 input | 实测（DOM dump） |
| 视频号 create 页空壳、编辑器未渲染 | 实测 |
| 头条/视频号**是否已真正发布成功** | **未证实** |

## 质量节拍

| 项 | 读数 |
| --- | --- |
| rpa-engine | 285 passed |
| desktop（toutiao-cover / title-fill-verify / 头条信号 / rpa-view-platforms） | 7 + 6 + 24 + 105 passed |
| 静态门禁 | 6 个 rc 全 0 |

## 远程同步

| 项 | 状态 |
| --- | --- |
| 远程同步 | 由门禁推导 |
