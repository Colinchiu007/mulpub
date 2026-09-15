## ADDED Requirements

### Requirement: 快手二维码登录入口可验证

快手在账号添加弹窗中 SHALL 显示可用的二维码登录模式；按钮可用不等于登录成功，登录成功必须由账号事件和凭证恢复共同确认。

#### Scenario: 快手 QR 模式可选择

- **WHEN** 用户在账号添加弹窗选择 kuaishou 且平台 QR capability 未从 IPC 返回
- **THEN** QR 模式按钮仍可选择，提交按钮不因空 capability 被禁用

#### Scenario: 非 QR 平台仍被禁用

- **WHEN** 用户选择不支持二维码的平台且 capability 不可用
- **THEN** QR 模式按钮和提交动作保持禁用

### Requirement: 扫码登录以单一虚拟标签呈现

二维码扫码登录 SHALL 与普通网页登录共用 auth-login 虚拟标签生命周期；任一时刻只允许一个登录 WebContentsView 可见，不能以固定尺寸浮层覆盖已经打开的创作者中心。

#### Scenario: 已打开快手创作者中心时启动扫码

- **WHEN** 快手创作者中心浏览器标签已经打开，用户启动快手二维码登录
- **THEN** 原创作者中心 View 被隐藏，二维码 View 从 TabBar 与 NavBar 下方占满内容区显示，并以 auth-login 作为当前活动标签

#### Scenario: 扫码会话结束后恢复原标签

- **WHEN** 二维码登录成功、用户取消或发生超时
- **THEN** 仅清理二维码 View 并移除 auth-login 虚拟标签，恢复打开扫码前的创作者中心标签；不得关闭或叠加原标签

#### Scenario: 扫码在后台结束时保留用户当前标签

- **WHEN** 用户在二维码登录期间主动切换到另一个浏览器或首页标签，随后二维码会话成功、取消或超时
- **THEN** 系统移除 auth-login 虚拟标签但保持用户当前选择，不得强制切回打开扫码前的标签

### Requirement: 平台 cookie 域隔离

平台 cookie 过滤 SHALL 只接受明确平台域名或其子域，不能接受公共注册域本身作为平台 cookie 域。

#### Scenario: 百家号拒绝公共百度域

- **WHEN** 百家号 cookie domain 是 .baidu.com
- **THEN** isPlatformCookieDomain('baijiahao', domain) 返回 false

#### Scenario: 百家号接受创作者域及明确认证域

- **WHEN** cookie domain 是 .baijiahao.baidu.com、其子域或 .passport.baidu.com
- **THEN** 返回 true

### Requirement: 发布页主操作可见

单篇发布页 SHALL 在桌面长表单滚动时保持发布/保存草稿主操作区可见，并在窄屏下不遮挡表单内容。

#### Scenario: 桌面滚动

- **WHEN** 发布页次级面板内容超过视口高度
- **THEN** 主操作区 sticky 定位，按钮仍可操作

#### Scenario: 移动窄屏

- **WHEN** 视口宽度小于等于 720px
- **THEN** 主操作区回到正常流或使用安全底部间距，页面无横向溢出

### Requirement: 连接状态不得伪造成功

账号页面 SHALL 使用真实 bridge/账号状态确认连接状态；状态未知时 SHALL 显示中性文案。

#### Scenario: 未确认连接

- **WHEN** bridge 状态尚未返回或账号状态不可确认
- **THEN** 页面不显示“客户端已连接”作为确定成功状态

### Requirement: 发布取消不因单个失败中断

发布取消 SHALL 使用 allSettled 语义处理并发取消；成功取消的 ID 从活动列表移除，失败或被拒绝的 ID 保留供再次重试，取消请求本身不得抛出未处理 rejection。

#### Scenario: 单个取消请求被拒绝

- **WHEN** activeTaskIds 包含任务且 cancelTask rejected
- **THEN** cancelPublish 正常 resolve，活动任务保留，返回 pending 大于 0

#### Scenario: 部分取消成功

- **WHEN** 多个任务中部分成功、部分业务失败
- **THEN** 成功 ID 移除、失败 ID 保留，结果展示部分取消失败

### Requirement: 视频封面通过同源媒体通道提取

封面提取器 SHALL 通过 loopback HTTP 同源媒体通道加载本地视频；不得依赖跨 file/data scheme 访问。每次提取后 SHALL 销毁隐藏窗口并关闭临时服务。

#### Scenario: 本地视频可提取封面

- **WHEN** 输入存在的本地 mp4 文件
- **THEN** extractVideoCover 返回 JPEG 临时文件路径

#### Scenario: 临时服务生命周期

- **WHEN** 提取完成或失败
- **THEN** 隐藏 BrowserWindow 被销毁且 loopback HTTP 服务被关闭

### Requirement: 严格平台发布证据必须脱敏且关联本次动作

百家号与快手的发布成功 SHALL 只接受本次点击后捕获的明确发布响应 ID，或经标题与时间窗口共同核验的作品列表 artifact；不得从 localStorage、当前页面 URL、旧链接或页面正文推断成功。网络响应原文只可在主进程内瞬时解析，diagnostics 与上游发布结果只能包含去 query 的 endpoint、状态、MIME 类型、数量和 artifact 是否命中。

#### Scenario: 原始响应不离开网络捕获边界

- **WHEN** 发布点击后的响应中包含 token、Cookie 相关 query、用户正文或作品 ID
- **THEN** 仅将解析出的受限 ID 作为内存证据；records、日志、diagnostics 和 IPC 结果均不包含响应 body、query、token 或用户正文

#### Scenario: 历史状态不能证明本次发布成功

- **WHEN** 百家号或快手发布页面的 localStorage、当前 URL 或旧作品链接中含有作品 ID，但本次发布响应与标题/时间窗口作品回查均未命中
- **THEN** 发布结果返回缺少平台作品 ID 的失败，不得把历史 ID 声明为本次发布成功

#### Scenario: 发布点击异常后释放网络监听

- **WHEN** 发布按钮或草稿按钮在网络捕获已启动后抛出异常
- **THEN** 当前 capture 停止、Network 域监听解除且后续重试不会复用遗留 debugger listener
