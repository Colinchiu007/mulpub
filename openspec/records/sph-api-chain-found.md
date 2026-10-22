# 本次执行记录：视频号首次真机发布 + 探测方法纪律（sph-api-chain-found，2026-10-21）【混合 PR】

- 分支：`sph-api-chain-found`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、视频号第一次完整链路真机尝试

| 项 | 读数 |
| --- | --- |
| 任务 | `task_3_1792579422985` → **failed** |
| error | 「视频号 正文未写入，已中止，未点击发布。本次未向平台提交任何内容，也未占用发布间隔。」 |
| `submitAttempted` | **false** ⇒ fail-closed 生效 |
| 耗时 | startedAt→completedAt **68 秒**（不是超时，填充阶段即失败） |
| 另注 | createdAt→startedAt 隔 **4分17秒**（窗口创建 + cookie 恢复） |

⇒ 失败在 **DOM 轨**（"正文未写入"）⇒ 说明 **API 轨先失败并降级**，但失败原因未留档。

## 二、关键事实：视频号 API 轨早已存在且完整

`config/platforms.yaml`：`has_api: true` + `publishMode: api-then-dom`（2026-10-06 修过矛盾）。

`packages/api-publish-engine/src/publish/platforms/shipinhao-video.js`（288 行）：

| 环节 | 内容 |
| --- | --- |
| 上传 | 分片（`applyuploaddfs` / `uploadpartdfs` / `completepartuploaddfs`） |
| CDN 主机 | **2026-10-18 已修**：旧 `finderassistancea.video.qq.com` 返 404 ⇒ 新 `finder.video.qq.com`（取自创作页自身代码 `finder-helper-web/chunk-common`），旧主机保留兜底 |
| 提交 | `post_create` / **`post_draft`** 双分支 |
| 描述合成 | 无标题平台 ⇒ 标题并入描述 |
| 测试 | `test/shipinhao-video-chain.test.js` 存在 |

## 三、竞品逆向成果（视频号完整 API 链，按用户指示复用）

`05-<参考产品>-materials/RPA分析报告.md` §2.2：

| 功能 | API |
| --- | --- |
| **发布（草稿）** | `/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft` |
| 发布 | `.../post/post_create` |
| 权限数据 | `.../auth/auth_data` |
| 账号状态 | `.../post/check_finder_comm_face` |
| 上传 | 分片（apply/uploadpart/completepart） |
| 数据格式 | **XML**（`<p>` / `<topic>` / `<friend>`） |
| 签名 | `Content-MD5` + `X-Arguments` |

⇒ 与我们 `shipinhao-video.js` **同源**（分片 + Content-MD5 + post_draft/post_create 双分支）
  —— 方向正确，无需重做；差异在 CDN 主机（已按创作页实测更新）。

## 四、探测方法纪律（本轮教训，单列 §16.29）

一开始我用**用户手开的视频号页面**探测，得到 `cookieLen=0` / `auth_data=300330` / 页面空白
—— 差点误判成"视频号未登录"。真因：**那个页面不在应用窗口池里，从未走过 cookie 恢复**
（`rpa-view-manager.js` L222 只在 `!reused` 时执行）。

⇒ 三条纪律：① 判登录态只能用应用管理的页面/链路；② 用户手开页面只能看 HTML 框架可达性；
③ 探测时若改了应用主窗口 URL，**测完必须恢复**（本轮把应用主页导航走了，已恢复）。

⇒ 与 §16.18.2 / §16.21 / §16.25 / §16.23.3 **五条同型**，归纳为一句：
**判据域必须跟着被测性质走；不同源/不同轨/不同管理面的读数不能互相外推。**

## 五、剩余工作

| # | 事项 | 性质 |
| --- | --- | --- |
| 1 | **重启应用**（加载 #4150/#4155 分轨埋点）后重跑视频号 ⇒ 看 `apiTrackFailed` 真实原因 | 前置 |
| 2 | 若 API 轨仍败，按竞品成果核对 `post_draft` 请求体（XML / Content-MD5 / X-Arguments） | 代码 |
| 3 | 修 DOM 轨正文填充（`desc_textarea` 首个候选是裸 `textarea`，可能取错元素） | 代码 |

## 六、读数

| 项 | 读数 |
| --- | --- |
| 5 个静态门禁 | rc 全 0 |
| 代码改动 | **无**（纯 PRD §16.28 + §16.29） |
| 真机 | 视频号首次尝试，fail-closed（未提交未占间隔） |
| 应用主窗口 | 已恢复（title=汤姆鱼，url=5231/#/） |

## 七、远程同步

| 远程同步 | 由门禁推导 |
