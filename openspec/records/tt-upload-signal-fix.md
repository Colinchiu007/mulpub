# 本次执行记录：头条视频双缺陷修复（toutiao-video-signal-and-nobody，2026-10-21）【混合 PR】

- 分支：`tt-upload-signal-fix`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动因：把"平台抽风"降级成两个代码缺陷

前两轮头条视频都失败在同一句话：`视频上传未完成（未检测到上传完成信号）`。
本轮改用**发布窗口实时采样**（发布时应用会建专用 RPA 窗口，它作为独立 page target
出现在 CDP `/json/list`，外部脚本每 8s 采样即可拿到真实 DOM，不改产品代码、不加日志）。

## 二、实测：西瓜上传页上传成功后的真实形状

```
url        = /profile_v4/xigua/upload-video
fullText   = 「…添加视频 上传成功 dy-small.mp4 大小: 143.9KB 视频时长: 12s
              重新上传 删除 发布设置 标题 4/30 封面 上传封面 … 发布 手机预览效果…」
inputs     = 仅 1 个可见：input.xigua-input，placeholder=「请输入 0～30 个字符」
buttons    = 「添加视频」「发布」（发布 disabled=false）
videoCount = 0    textareaCount = 0    contenteditable = 0
```

⇒ **上传其实成功了**（页面明写「上传成功」「重新上传 删除」+ 文件名/大小/时长）。

## 三、缺陷 A：上传完成探针 `positive` 对西瓜页恒为 false

旧定义：`positive = https<video> || input[placeholder*="标题"]/textarea[placeholder]/[contenteditable=true] || URL 含 post/video`

| 判据 | 实测 | 结果 |
| --- | --- | --- |
| https `<video>` | `videoCount=0` | ❌ |
| `placeholder*="标题"` | 实际「请输入 0～30 个字符」，不含"标题" | ❌ |
| `textarea[placeholder]` / `[contenteditable=true]` | 一个都没有 | ❌ |
| URL 含 `post/video` | 实际 `/profile_v4/xigua/upload-video` | ❌ |

`decideUploadWait` 的 P4 = `positiveSignal && !uploading` ⇒ **永不成立** ⇒ 只能等满 90s
（实测日志 `13:51:39 video upload-complete signal not detected`，正好是开始上传后 90s）。

**关键**：页面上的「上传成功」此前只进 `structural`（停滞判定辅助），没进 `positive`。

## 四、缺陷 B：该页没有正文输入位，但门禁 P4 强制要求正文写入

实测 `textareaCount=0`、`contenteditable=0`，页面只有「标题」+「封面」+「发布」。
而 `toutiao_video.editor` 登记了 4 个候选，一个都不存在：

```
13:48:42 waitForElement timeout sel=textarea.byte-textarea.abstract
13:48:45 waitForElement timeout sel=[contenteditable="true"]
13:48:48 waitForElement timeout sel=[contenteditable]
13:48:51 waitForElement timeout sel=.ProseMirror
13:48:51 content editor not found among 4 candidates
```

⇒ 门禁 P4「有正文 ⇒ 正文必须写入成功」**必然失败**。**即使上传确认修好，也发不出去。**

## 五、修法

**A. 探针补强完成文案（平台无关语义信号）**
```js
var doneCopy = /上传成功|上传完成|上传完毕/.test(t);   // 只认强文案，不认「重新上传」
positive = !!(vv || ed || doneCopy || location.href.indexOf("post/video") !== -1)
```
不把「重新上传」放进 positive：它可能是上传前的**静态提示**；「上传成功/完成/完毕」只会在真传完后出现。

**B. 新增平台能力 `isNoBodyVideoPlatform`**（不把平台名硬编码进门禁）

| 层 | 改动 |
| --- | --- |
| `publish-capabilities.json` | 顶层 `"noBodyVideoPlatforms": ["toutiao"]` |
| `publish-capabilities.js` | 导出 `NO_BODY_VIDEO_PLATFORMS` + `isNoBodyVideoPlatform(id)`（未知平台 false） |
| `publish-precondition.js` | 入参 `noBodyPlatform` ⇒ P4 不适用（与既有 `noTitlePlatform` 对称） |
| `rpa-view-platforms.js` | `noBodyPlatform = isNoBodyVideoPlatform(platform) && !!article.video_path`；跳过正文填充并记 `{ok:true, skipped:'no-body-field'}` |

三条设计纪律：① 只对**视频形态**生效（头条图文有 ProseMirror 正文，不受影响）；
② 未知/未声明平台一律 false ⇒ **fail-closed 到默认判据**；③ 跳过填充仍**显式记账**，不静默丢弃。

## 六、读数

| 项 | 读数 |
| --- | --- |
| 新增测试 `toutiao-video-signal-and-nobody.test.js` | **8 passed**（TDD 先红：6 failed/2 passed → 后绿 8/8） |
| 相关回归 | **56 passed**（5 文件：publish-precondition / .wiring / upload-wait-strategy / publish-upload-order / 本测试） |
| abs-paths / brand / enc / max-lines / unwired | rc=0 / rc=0 / rc=0 / rc=0 / rc=0 |
| **QM-1** | build:vue 44.74s + electron-builder ✅ + 启动 **PASS（stderr 0 字节）** |
| PRD | §16.32（取证方法 + 两缺陷 + 修法 + 验证口径 + 行数门禁实录） |

## 六之二、CI 反馈修复：ESM 孪生漏导出（publish-channel-routing parity 红）

首轮 CI 的 `QG Unit Tests` 红，日志（`actions/jobs/.../logs` 逐行读得）：
```
FAIL src/__tests__/publish-channel-routing.test.js > parity — CJS 与 browser 孪生同构
AssertionError: expected [ 'NO_BODY_VIDEO_PLATFORMS', …(21) ] to deeply equal [ 'NO_TITLE_PLATFORMS', …(19) ]
```

**真因**：我只把 `NO_BODY_VIDEO_PLATFORMS` / `isNoBodyVideoPlatform` 加到了 CJS 版
`publish-capabilities.js`，**没加到 ESM 孪生** `publish-capabilities.browser.js`
（AGENTS.md 孪生纪律：渲染端与主进程两份必须同名同构，数据只从同一份 JSON 来）。

**修法**：孪生版补同名导出（同样从 `registryData.noBodyVideoPlatforms` 派生，不复制数据），
两份各 22 个导出。验证：`publish-channel-routing` + `publish-capabilities` **108 例通过**；
shared-utils 全量 **1094 通过 / 10 skipped**。

**过程中的一次弯路（如实记录）**：我一开始在 `xhs-406-field-forensics`（纯文档分支）上改孪生文件，
该分支没有 CJS 侧的新增导出 ⇒ parity 反向失败（20 vs 22）。根因是**分支选错**，不是修法错；
清理后回到 `tt-upload-signal-fix` 应用，一次通过。
⇒ 教训：**改动要落在承载对应代码的那个分支上**；跨分支改同一份文件会得到反向的"差两个导出"。
## 七、行数门禁实录（零增长容差文件）

`rpa-view-platforms.js` 目标 1484 行、改动前 1482。本次先 +3 行 ⇒ 1485 超线；
把一处 3 行注释压成 2 行（信息不丢失）后回到 **1484** 转绿。
⇒ 在该文件加代码必须**同次**压缩等量注释，不得靠上调 targets 过关。

## 八、未验证项（如实）

- 本轮修的是**代码层两处判据**；真机复跑需先把应用同步到含本改动的代码再发一次。
  **未在本次 PR 前完成真机复跑**（应用当前跑的是 main 上一个提交，不含本分支）。
- 西瓜页「发布」按钮的**提交后成功判据**（`success_mode`）尚未取证；
  若本次修复让流程走到点发布，下一步要确认它落到什么终态。

## 九、远程同步

| 远程同步 | 由门禁推导 |
