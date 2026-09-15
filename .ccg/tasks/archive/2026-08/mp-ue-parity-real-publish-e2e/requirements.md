# 需求与背景（2026-08-26）

## 用户目标（原始指令摘要）
1. 对标参考产品：深挖其 UE 与代码，把 Multi-Publish 前端框架与账号管理/内容发布的交互、UE 改成和参考产品一致
2. 真实发布 E2E：用本地已登录 profile（快手+百家号测试账号），把 D:/01.mp4 通过真实流程发布到两个平台；标题/标签/介绍随意写；封面=视频首帧截图裁剪（无此功能则实现）
3. 过程中缺什么补什么，发现问题就修，最终以发布成功为准
4. 修改代码须新建 worktree + 分支；更新记忆；推送 GitHub 合并分支；PRD/文档详细补充（数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字）；应用质量节拍

## 关键事实（已验证）
- 代码已更新至 origin/main (bb41987ea)；worktree: D:/Data/projects/mp-ue-real-publish，分支 feat/mp-ue-real-publish，依赖已装齐（verify-worktree-deps OK）
- Profile: D:/tmp/Multi-Publish-debug-profile；accounts 表：d39af89b baijiahao "baijiahao账号" active；9d5ef9b7 kuaishou "kuaishou账号" expired（2026-08-21）
- 凭据：credentials/owners/<sha>/<accountId>.json.enc (AES-256-GCM)；快手分区 Partitions/auth-auth-kuaishou-1787294676286
- 视频 D:/01.mp4：47.99s 1920x1080 h264 30fps 13.5MB
- 启动：根 pnpm dev → vite:5174 + electron --user-data-dir=D:/tmp/Multi-Publish-debug-profile

## 参考产品架构真相（逆向确认）
- 客户端=Electron 定制浏览器壳（React19 壳层+WebContentsView 标签页），发布页/账号管理是参考产品云端控制台（本地无表单 DOM）
- 发布双轨：主轨 Cookie+直调平台创作者 HTTP API（快手 cp.kuaishou.com works/v2/video/pc/* 分片上传+签名 __NS_sig3 本地算；百家号 rsbjh.baidu.com uploadVideo 分片+远程签名机 qianming.yixiaoer.cn）；辅轨真 RPA（远端混淆脚本 vm 执行）
- 封面：本地无 ffmpeg/截帧；云端下发；快手 API 限 512KB；默认封面=自动裁剪视频首帧（云端编辑器裁剪）
- 登录态：cookies+localStorage 整包上传参考产品云端登录态服务；本地分区 persist:auth-*
- 结论：Multi-Publish 的 RPA 浏览器自动化路线与参考产品架构不同但已实现且更通用；本次不重写发布引擎，聚焦 UE 对齐 + 真实发布打通 + 封面裁剪

## 参考产品 UE 参考（2026-08-26 实机截图，存 01-docs/ui-reference/screenshots/mp-live-20260826/）
- mp-full-nav.png：左侧主导航 主页/发布/账号/数据/CLI/私信评论/更多(AI创作/小蚁/团队/素材/数字人/重置导航)；右上"客户端已连接"
- mp-publish-history.png：发布模块 Tab 发布记录/草稿箱(2)/待审核；搜索"搜索作品描述或任务标题..."；右侧 列表/日历切换+批量管理+导出+新增发布(黑主钮)；筛选 发布人/作品类型/发布状态/发布模式；卡片=封面缩略图+标题+发布人+时间+平台图标+成功状态+账号数/任务数/失败+播放/评论/点赞/收藏/分享统计列+"立即发布"
- mp-publish-type-modal.png：选择发布类型弹窗：视频发布(35)/图文发布(10)/文章发布(19)/公众号 四卡片带平台图标
- mp-publish-video-batchtask.png：发布视频页：顶栏 保存到草稿/⚠️浏览器发布/?/一键发布(黑主钮)；左侧 发布账号&任务 共N账号+新增账号+批量设置卡片；主区双Tab 批量设置任务/批量设置表单；任务视图=上传视频卡片+选择账号卡片+底部固定栏(☐生成任务时同步视频文件名为标题+创建发布任务钮)
- mp-publish-video-batchform.png：表单视图=复选框字段列表（视频/封面…），封面含"默认封面/自定义封面"子Tab，默认封面提示"请在上方添加视频，系统将自动裁剪视频首帧为封面"；底部 同步设置/应用到账号

## 环境注意
- D:\Data\projects 下禁用 Write/Edit 工具（FUSE 截断），一律 bash python heredoc 写文件，写后 ast.parse/node --check 验证
- 用户在 actively 使用电脑：禁止全局鼠标点击/置顶抢焦点方式操作 GUI；GUI 自动化一律走 CDP（参考产品已带 --remote-debugging-port=9222 重启）或应用内机制
- QM-1 门禁：改 electron/ 代码后必须 pnpm exec electron-builder --win --dir 打包验证

## 素材观察（2026-08-26）
- D:/01.mp4 第0帧非黑帧（mean_lum 93.3），首帧语义可用 t≈0；画面 1920x1080，底部有字幕（"清晨，阳光穿过薄雾"）→ 封面裁剪（避开字幕/构图调整）有真实价值
- 参考产品客户端已以 --remote-debugging-port=9222 重启（CDP 可连，Playwright NODE_PATH=D:/Data/projects/Multi-Publish/node_modules）；其云端控制台登录态在客户端 partition，CDP 新开标签无登录态；客户端壳层为原生 browser chrome，左侧导航无法经 CDP 页面操作
