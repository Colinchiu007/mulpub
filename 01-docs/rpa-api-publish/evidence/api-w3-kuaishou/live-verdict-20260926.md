# 6.3 快手 API 发布链 — 活体验收结论（2026-09-26）

## 结论：❌ 未通过（链路被两个真实缺陷卡死，未产生任何公开发作品）

活体验收的价值正是暴露静态门禁/单测拦不住的真实断裂。本次真实发射 1 条（用户裁决：真实发、内容不带「测试」字样），
3 次尝试（1 初始 + 应用内置 2 次重试）全部失败，且证据显示**发布请求从未真正发出**，账号 `a4505f45` 无残留公开作品。

## 载体与环境
- worktree `mp-w3-live-check` @ local/w3-live-check = origin/main（HEAD 1202567204）
- electron pid 68968（窗口「社媒管家」）、vite :6083（pid 56752）、cdp :10131
- 平台账号：kuaishou `a4505f45`（命运石），登录态 active（6.3-3 只读探测确认）
- 素材：`shared-user-data/story2video-projects/6c90…7630/mud6t754_wwcm/video.mp4`
  （1920×1080 横版 / 246.8s / 103.4MB，「凌晨四点的工厂」题材，无真实人物/政治/事实断言）
- 载荷：`publishBatch([{platform:'kuaishou',accountId:'a4505f45'}], {title, content, tags:[制造业,工匠精神], video_path, video:{path}, cover:{path:cover-3bc1f833.jpg}, aiGenerated:true, precheck:false})`
- 发射时间：2026-09-26T08:19:21Z，taskId `task_1_1790410761499`

## 失败链路（证据见同目录 live-run-20260926-applog.txt / live-run-20260926-progress.json）

每次尝试顺序固定：`using API publish engine...` →（≈1ms）→ `API publish kuaishou: kuaishou: 账号信息缺失`
→ `API failed, falling back to RPA` → DOM 轨 `navigating → uploading file → file uploaded → filling title → publishing → verifying`
→ `publish signal lacked platform ID; endpoint=…/article/publish/video responses=0` → `发布结果缺少平台作品 ID` → 重试。

## 🔴 缺陷 D1：生产 API-first 分支拿不到 cookie，九步链 0 步未跑
- 现象：`[ERROR] RpaView API publish kuaishou: kuaishou: 账号信息缺失，请重新授权此账号再试`（发射后 ≈1ms 抛出）。
- 根因：`rpa-view-manager.publish()` API-first 分支（L60-64）用 `authData.cookies` 拼 cookie 串。
  kuaishou 的 `rpa_vm` 路由经 `publisher-router.loadAuthForTask()` 得到的 `authData.cookies` 为空数组
  （快手登录态只落在 Electron auth 分区 `persist:…account-a4505f45`，未同步进凭证 store）。
  `[].map().join('; ')` 得空串 → adapter `execute()` L62 `if (!cookie)` fail-closed。
- 对照：DOM 轨能拿到 cookie，是因为它走 `_restoreAuthPartitionCookies()`（L94）从分区补 16/16——即 cookie 在分区里，
  但 API-first 分支不读分区。
- 影响：**W3 验收标的（九步 API 链：upload/pre→fragment→complete→finish→cover→submit→photo/list）在生产路由下完全不可达**，
  活体无法验证。此即前置会话已预判的「API 轨实际不可达」结构缺陷的活体确证。

## 🟠 缺陷 D2：DOM 兜底轨发布按钮选择器在当前 cp.kuaishou.com 全 timeout
- 现象：`waitForElement timeout sel=button:has-text("发布")` / `button:has-text("发表")` / `span:has-text("发 布")` 三连 timeout 后直接进 verifying；
  `publish signal lacked platform ID … responses=0`（发布端点无任何 2xx 响应被 networkCapture 捕获）。
- 根因：`platform-selectors.js` kuaishou 段 publish_btn 选择器与当前快手创作页按钮 DOM/文案不匹配（DIAG 见 pubBtn=7 个候选但选择器未命中）。
- 影响：发布点击从未触发 → 视频仅上传到快手临时存储（未提交），会由快手侧自然过期，**无公开发内容残留**。

## 安全与风控
- 未触发风控：应用内置重试上限 2 次，共 3 次尝试，未手动硬刷；未换号（遵守「即停绝不换号」）。
- 未产生公开作品：D2 使发布请求从未发出，historyList 中无任何 kuaishou 记录佐证。
- 后续：停止发布尝试；D1 属 W3 落地必修（否则验收标的不可达），D2 属快手 DOM 轨选择器漂移。

## 对 W3 验收的影响
- 6.3「活体验收九步 API 链」在当前 build **无法通过**：链路在进入 API 前即因 cookie 缺失降级。
- 建议：先修 D1（让 API-first 分支从 auth 分区取 cookie，或把 kuaishou 登录 cookie 同步进 authData），
  再重跑活体才能真正验证九步链；D2 修复后 DOM 兜底轨方可作为降级路径可信。
- QM-1 最终打包验证仍受阻（缺 dist/fonts、.playwright-browsers），与本结论独立。
