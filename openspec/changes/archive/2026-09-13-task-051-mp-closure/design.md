## 设计

### 阶段 A：基线和测试收口

1. 保持当前 worktree 隔离；远端同步失败时记录认证阻塞，不在本地伪造 origin/main 状态。
2. 先修复/补充回归测试，再调整实现。标题提示采用 locale 归一化，避免测试锁死旧中文字符串。
3. isPlatformCookieDomain 使用注册域边界匹配：允许 baijiahao.baidu.com 及其子域，允许明确列出的 passport.baidu.com，拒绝裸 baidu.com 和无关兄弟域。

### 阶段 B：真实 Electron 验证

1. 使用 scripts/start-desktop.ps1 -Worktree ... -Profile D:\tmp\mp-kuaishou-task-051 -NoSync -CheckIdentity。
2. 先验证启动契约、CDP 页面 URL、账号列表和快手登录入口；不复用其他 worktree profile。
3. 登录恢复验证通过后，准备 D:\01.mp4，确认视频文件、标题、描述、封面和目标账号，再由人工确认最终发布。
4. 保存脱敏日志、阶段时间线、页面 URL、结果截图和失败阶段；任何 selector 缺失或页面仍在登录态时停止发布。

### 阶段 C：第一批 UX 收口

- 发布页操作区采用 position: sticky，保留现有事件和按钮契约；桌面端固定在次级面板底部，移动端回到正常流，避免遮挡。
- 账号页连接状态只显示经过 bridge/账号数据确认的状态；未知状态显示中性文案，不把页面加载成功等同于平台登录成功。
- 所有新增文案通过 zh.js/en.js 成对维护；不在 .vue 中新增中文字符串。

### 风险控制

- 不扩大 cookie 域 allowlist 来“修复”登录。
- 不把网络启动成功、二维码可见或发布按钮可点写成发布成功。
- renderer 改动后执行组件/路由测试、CJK locale 检查；主进程改动触发 QM-1 打包。
