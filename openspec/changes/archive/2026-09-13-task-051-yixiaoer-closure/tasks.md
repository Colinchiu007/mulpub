# Tasks — task-051-yixiaoer-closure

## 1. 基线与测试

- [x] 1.1 完成当前分支相对 origin/main 的差异审计并记录远端认证状态
- [x] 1.2 为快手二维码按钮、视频模式、封面提取和进度展示补齐回归测试
- [x] 1.3 修复发布标题文案断言与平台 cookie domain 契约测试

## 2. 真实 Electron 验收

- [x] 2.1 启动并通过 START_CONTRACT_OK / CDP / identity 检查
- [x] 2.2 快手 passport 打开、二维码就绪与同 profile 重启恢复（扫码登录入库待用户扫码）
- [ ] 2.3 D:\01.mp4 快手视频发布；记录成功或失败阶段证据（最终点击待用户明确确认）
- [x] 2.4 复核百家号/快手视频发布证据边界：严格平台拒绝 localStorage、旧链接与当前 URL 的历史 ID，仅接受本次响应或标题/时间核验 artifact（`rpa-view-platforms.test.js`）
- [x] 2.5 发布网络证据脱敏与监听清理：原始 body 不进入 diagnostics/IPC，点击异常必 stop capture（`rpa-view-helpers.test.js`、`publisher-router.test.js`）

## 3. UE 收口

- [x] 3.1 发布页 sticky 主操作区与移动响应式回归（结构/CSS/组件回归已通过，真实 viewport 截图仍为补充项）
- [x] 3.2 账号页连接状态真实来源/中性未知态
- [x] 3.3 快手二维码登录接入唯一虚拟登录标签，覆盖创作者中心隐藏、关闭恢复、切换、resize 与容器接线回归
- [x] 3.4 locale、PRD、CHANGELOG 同步

## 4. 交付

- [x] 4.1 运行受影响单测、集成测试和 CJK locale 检查
- [x] 4.2 Electron QM-1 打包与启动验证
- [x] 4.3 双模型审查：Claude 有界审查完成（2026-08-29，无 Critical；W1 端口回退测试真实性已补真实 exit 回归、W2 理论窗口判定 Info）；OpenCode 本轮复跑仍不可消费报告（首轮 300s 超时、隔离轮被回收，再次确认模型参数 opencode-go/deepseek-v4-flash 真实解析但无产出），按机制降级记录，未阻塞交付
- [x] 4.4 推送分支并创建 PR：codex/real-publish-e2e-followup → main（PR #1224，head ee66c3961，mergeStateStatus=CLEAN，CI 全绿）
- [x] 4.5 OpenSpec tasks（4.3/4.4/4.5 已勾选）、CCG task.json（分支/工作树/remoteStatus 已更新）、质量节拍同步完成；快手真实发布（2.3）仍待用户明确确认后单独推进
