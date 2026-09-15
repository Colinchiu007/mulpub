# 实施计划：参考产品 UE 对标 + 真实视频发布 E2E

> Worktree: D:\Data\projects\mp-ue-real-publish | Branch: feat/mp-ue-real-publish
> 硬目标：D:\01.mp4 通过真实 UI 流程发布到快手+百家号测试账号，封面用首帧截图裁剪

## 背景结论（探索汇总）

1. 前端已是 Vue3+ElementPlus+Pinia，参考产品壳层（MpSidebar/ModuleNav）Round1/2 已收敛，像素审计曾通过。
2. 参考产品4.0 本体=浏览器式标签壳+云端 Web 控制台（需短信登录，无法实拍编辑页）；其发布实现=Cookie直调平台API + 真RPA 双轨；快手封面限 512KB。
3. 本项目发布链路为真实浏览器自动化（rpa_vm）：publish:batch IPC → TaskQueue → RpaViewManager 隐藏窗口+Cookie恢复+DOM自动化。快手/百家号选择器、发布前准备、产物回查均已存在。
4. 封面提取已存在（cover-extractor.js，loopback+offscreen截帧，seekTime=0.5s），**无裁剪 UI**。
5. Profile=D:\tmp\Multi-Publish-debug-profile：baijiahao(d39af89b, active)、kuaishou(9d5ef9b7, **expired**)。
6. 百家号 V2 视频发布：标题从视频文件名生成（无标题输入框）→ 需以标题命名上传文件副本。
7. 已关闭残留旧实例（旧 worktree 的 electron 进程占用 profile）。

## Phase A：封面裁剪功能（E2E 前置）
- A1 主进程：cover-cropper.js（offscreen canvas 裁剪，复用 cover-extractor 模式）；IPC `cover:crop`；preload `cropVideoCover`；纯函数（rect校验/比例计算）单测。输出控制 ≤512KB（快手限制）。
- A2 渲染层：CoverCropDialog.vue（预览+拖拽裁剪框+比例预设 16:9/1:1/4:3/自由）→ Publish.vue 封面行接「裁剪」按钮；提取后可一键进入裁剪。组件测试。
- A3 i18n（zh/en）。

## Phase B：真实应用启动验证
- worktree 内 `pnpm dev`（默认挂 debug profile）→ 截图账号页确认两账号 → 检查快手登录态（expired 可能需重新扫码，若需人工扫码则记录为环境阻断并先跑百家号）。

## Phase C：真实发布 E2E
- C1 驱动脚本 tests/e2e/real-video-publish.js（Playwright _electron 模式仿 film-engineering-real.js）：/publish 视频模式 → D:\01.mp4 → 标题/标签/简介 → 勾选两账号 → 提取+裁剪封面 → 发布 → 监听进度至终态 → 报告+截图。
- C2 百家号标题修复：rpa-view-platforms.js 上传前以 article.title 命名视频副本（复制失败回退原路径）。
- C3 迭代修复（选择器/时序/登录态），直到双平台发布成功（产物回查+发布记录验证）。

## Phase D：UE 对标修补（实证驱动 Round 3）
- 依据 C 中实测差距 + PRD-mp-features.md 编辑页描述修补发布页交互；跑视觉像素回归（publish 单视图）确认无回归。

## Phase E：闭环
- 定向 vitest + build:vue + QM-1 打包验证 + 8s 启动检查。
- 文档：PRD 详细增补（封面裁剪数据校验/交互/流程、快手百家号真实发布链路、E2E 结论）；CHANGELOG。
- 双模型审查（wrapper 探测，不可用则本地双视角+留证）；合入 main；push；记忆；归档。

## 风险
- 快手 cookie 实际失效 → 需用户扫码（阻断上报）
- 平台页面改版 → C3 现场修选择器
- 封面 >512KB → cropper 质量自适应压缩
