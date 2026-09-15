# 交接报告：参考产品 UE 对齐 + 百家号 API 直调 + 快手/百家号真实发布 E2E（任务已收尾）

> 生成时间：2026-08-29。接手前请先读本报告 + 归档任务 `.ccg/tasks/archive/2026-08/mp-ue-parity-real-publish-e2e/task.json`。

## 0. 核心结论（先读这个）

1. **不需要在新 worktree / 新分支继续**。本任务的 worktree `mp-ue-parity-real-publish-e2e` 已不存在，任务已归档（completed），相关 PR 全部合并到 main。本次会话已按你指示清理残留分支与 stash（见第 3 节）。
2. **接手工作 = 在 main 最新代码上续做「真实发布 E2E 验证」即可**，无需重建隔离环境。
3. **完成度**：代码功能已全部落地并合并；唯一未闭环的是「在两个测试账号上真实发布成功」的最终验证——之前因 profile 凭证过期/DPAPI 绑定、页面风控、发布终态判定等阻塞。当前 profile `D:/tmp/Multi-Publish-debug-profile` 中 baijiahao=active、kuaishou=expired，需要在本机重新扫码登录后再跑一次真实发布。

## 1. 任务背景与目标

- 目标（用户原始需求）：完全复用参考产品的多平台内容发布 RPA，把图文和视频发布到多个自媒体平台；代码完成后用真实环境 E2E 验证：用已登录 profile 把本地视频 `D:/01.mp4` 真实发布到快手 + 百家号测试账号；封面用视频首帧裁剪（无则实现）。
- 参考产品逆向分析资料：`D:/Data/mp-extracted/`、`D:/Data/projects/_逆向工程_参考产品4.0`（安装目录 `D:/Program Files/mp`）；关键逆向实物：`packages/main/dist/index.cjs`（8.4MB 主进程，含完整发布引擎）。
- 项目私规：运行时代码必须走 `scripts/start-mp-task.ps1 -TaskName <kebab-case>` 隔离 worktree；测试先于代码；完成后推送 GitHub 合并分支；详细 PRD；质量节拍。

## 2. 已完成并合并的内容（截至 2026-08-29）

| PR # | 内容 | 状态 |
|---|---|---|
| #1174 | 封面裁剪 Phase A：cover-cropper 服务 + CoverCropDialog UI + 发布表单接入 | 已合并 |
| #1195 | 账号管理/内容发布 IPC 详细日志 + 真实发布 E2E 脚本 | 已合并 2026-08-27 |
| #1201 | **百家号视频发布切换为参考产品 API 直调链（Phase C）——核心** | 已合并 2026-08-28（b00e0bb6） |
| #1215 | 真实发布 E2E 收尾修复：账号选择/终态判定/封面验收/指纹头收敛/UI 修复 | 已合并 2026-08-28 |
| #1224 | python-bridge 进程生命周期竞态修复收尾 | 已合并 |

main 头部含归档提交 e3c147af9（#1204）。全部 PR 经 GitHub 核实为 MERGED，mergeCommit 与实际提交一致。

## 3. 现场清理结论（本次会话已执行）

经只读核验后，本次会话已清理以下残留：

- worktree：`D:/Data/projects/mp-worktrees/mp-ue-parity-real-publish-e2e` 本身已不存在（此前会话已清理），`git worktree list` 仅剩共享主目录。
- 已删除本地分支（均无 main 上没有的独有内容，`git cherry main..` 只剩归档/杂项提交）：
  - `codex/real-publish-e2e-followup`（PR #1215 的 head 分支，已合并）
  - `codex/mp-ue-parity-v2`（并行 PR #1116 已合并）
  - `feat/mp-ue-real-publish`（unique 仅 1 个归档提交）
- 已删除 stash@{0}（pre-cleanup:mp-ue-parity-real-publish-e2e-202608292249，本任务清扫产物）。其中 8 行 `real-video-publish.js` 增强（judge 窗口 URL 过滤）与 3 个 CDP 诊断脚本的 diff 已在下文附录保留，如接手真实发布多窗口调试需要可据此恢复。
- remote：origin 仅 main，远端无 mp/followup 分支（无需远端删除）。

保留未动：`retired/*` tags（归档惯例）、其他任务的分支/stash/stash 项、主工作区 AGENTS.md 未提交改动（并发会话产物，与本任务无关）。

## 4. 接手者必读（避免重复踩坑）

### 4.1 架构关键结论（参考产品百家号 = API 直调，非浏览器 RPA）

百家号视频发布已切换为参考产品 API 直调链（Phase C，PR #1201），完整 API 序列：

1. `builder/author/video/preuploadVideo?app_id=X` → 拿 upload_key + 分片信息
2. `rsbjh.baidu.com/builder/author/video/uploadVideo?app_id=X`（分片上传 multipart：app_id/md5/id/type/size/name/upload_key/file/chunks/chunk）
3. `compuploadVideo?app_id=X`（完成：upload_key+chunks+name+size+video_type）
4. `pcui/video/process` 轮询（mediaId=...）直到 `editVideo.coverImage` 出现
5. 发布：图文/动态 `pcui/article/publish?type=news&callback=bjhpublish`；视频 `pcui/article/{publish|save}`（pubType==0 ? save : publish）。postData 含 video_duration、type=video、cover_source=upload、title、content(JSON: mediaId/videoName/local)+desc、tag、position_lat_lng（可选，空 {} 也可）、cover_layout/cover_images、original_status（2=原创/0=非原创）、announce_id=0+announce_info、activity_list

其他：图片上传走 `pcui/picture/uploadproxy`（multipart：media+app_id+type+article_type）；快手发布走 `kuaishou.web.cp.api_ph`，位置可选（location.id→poiId，无则空）。

注意：本项目 API 适配器 `packages/api-publish-engine/src/adapters/baijiahao.js` 初始实现简陋（`/builder/rc/publish`+简单参数，与参考产品完整链不匹配），这是当初必须用 RPA 的原因；PR #1201 已按参考产品完整链重做。

### 4.2 真实发布 E2E 的前置条件与已知阻塞

- profile 凭证：DPAPI 绑定原机器 + cookie 过期，需本机重新扫码登录百家号 + 快手。
- 快手 profile 已过期（kuaishou=expired），扫码恢复后重跑；百家号 active。
- E2E 脚本：`apps/desktop/tests/e2e/real-video-publish.js`（stash 中窗口 URL 过滤增强弃用前已记录，见附录；若需多窗口 webview 环境应先把该增强做进脚本再跑——此前 `waitMainWindow` 只按 title 判断，会把平台 webview 当主窗口）。
- 封面：视频首帧裁剪（cover-cropper 服务）已实现，注意横版要求 width>=height（1920x1080 OK）。
- 风控：百度系对频率敏感，建议单账号低频小步发布，避免触发验证码/风控，不要自动化刷量。

### 4.3 已知未完成/可选优化（接手时评估）

- 真实平台侧发布成功尚未被最终确认（profile 阻塞）。
- `real-video-publish.js` 需要窗口 URL 过滤增强（见附录），如继续多窗口场景先合入。
- 分片上传、视频处理轮询等大文件路径未做压力测试。
- 若后续继续：先起应用 → 扫码恢复快手 → 跑 `node apps/desktop/tests/e2e/real-video-publish.js` → 在发布历史确认两个平台终态；不要再重写 API 链。

### 4.4 文档与规范

- 任务已按私规归档，文档齐全。后续若继续真实发布验证，需同步 PRD 第 12 章真实发布 E2E 契约（631c6742b）。
- 所有改动遵守质量节拍：先测试、门禁、双模型审查（>30 行）、语言约定（中文）。

## 5. 下一步建议路径

1. 在 main 最新代码上：`pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`（如新环境）。
2. 启动应用（共享主目录只读；如需改代码则按流程开新 worktree）。
3. 用 `D:/tmp/Multi-Publish-debug-profile` 启动，扫码恢复快手登录。
4. 跑真实发布 E2E，验证快手+百家号两平台终态；补 PRD 第 12 章契约。

## 附录 A：曾被 stash 的 `real-video-publish.js` 增强（2026-08-29 清扫时归档）

`waitMainWindow` 只按 title 判断会把平台 webview 当主窗口；改为按 URL 过滤（仅选中 127.0.0.1:5173 / :5394 主页面）：

```diff
@@ waitMainWindow
   return waitFor(async () => {
     for (const win of app.windows()) {
-      const title = await win.title().catch(() => '')
-      if (title && title !== 'DevTools') return win
+      const rawUrl = win.url()
+      const url = typeof rawUrl === 'string' ? rawUrl : await Promise.resolve(rawUrl).catch(() => '')
+      if (!String(url).includes('127.0.0.1:517') && !String(url).includes('127.0.0.1:5394')) continue
+      return win
     }
     return null
   }, timeoutMs, 500)
```

另 3 个 CDP 诊断脚本（cdp-check-login.cjs / cdp-diag-frames.cjs / cdp-diag-windows.cjs，未跟踪、纯诊断用途）已随 stash@{0} 丢弃；如需要可用 CDP 直连 debug port 重建。
