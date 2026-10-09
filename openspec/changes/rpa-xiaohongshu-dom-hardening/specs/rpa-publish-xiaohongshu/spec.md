## ADDED Requirements

### Requirement: 小红书 DOM 轨以"存入草稿箱"为验收目标

小红书 RPA 发布器 SHALL 以"内容成功保存进创作者中心草稿箱"为可验收的成功终态，MUST NOT 执行真实公开发布作为默认验收路径。成功判定 SHALL 基于正面确认信号（草稿保存 API 响应经 `ResponseMonitor` 捕获、显式 success URL 跳转，或重载草稿箱后「草稿箱(N)」计数相对**写入前基线**增长），MUST NOT 依赖固定 `sleep` 后无条件报成功，MUST NOT 伪造 `url`。采用计数判据时，基线 SHALL 在向页面写入任何内容之前读取——平台自动保存会把已开始编辑的内容计入晚读的基线，使"相对基线增长"永不成立。两处计数读取 SHALL 以**条件轮询**等待（基线等节点挂载、回查等增量本身），MUST NOT 单次读取后即定论：创作者中心是 SPA，面板挂载与自动保存落库都有延迟，单次读会把"还没挂上/还在写"读成"没写"；时限内仍读不到时 SHALL 留一条可诊断告警，MUST NOT 静默放弃判据。自动保存路径（无显式存草稿按钮）SHALL 先做草稿箱回查，未确认才补等 XHR，且单次确认中承载整页重载的回查 MUST NOT 执行超过一次。

#### Scenario: 草稿保存确认后才报成功
- **WHEN** 发布器填写标题/正文/图片并触发草稿保存
- **AND** `ResponseMonitor` 捕获到草稿保存端点返回成功响应
- **THEN** 返回 `success=True`，且 `url` 为真实草稿箱/条目地址而非硬编码占位

#### Scenario: 计数节点晚挂载时判据不被静默关掉
- **WHEN** 草稿面板在 `domcontentloaded` 之后才挂载，首次读数为空
- **THEN** 发布器在等待上限内轮询直至读到计数并以此建立基线
- **AND** 若上限内仍读不到，则日志出现一条指明"判据本身不可用"的告警，结论仍按未确认处理

#### Scenario: 无正面确认绝不报成功
- **WHEN** 触发草稿保存后在超时窗口内既无成功响应、也无显式 success URL 跳转、且重载草稿箱后「草稿箱(N)」计数未增长、条目标题也未命中
- **THEN** 返回 `success=False` 且带可诊断 error，MUST NOT 报 `success=True`

### Requirement: 草稿意图 fail-closed，禁止误公开发布

当调用方传入 `draft=True`（草稿意图）时，发布器 MUST NOT 点击"发布/发布笔记"等任何会造成公开发布的按钮；保存成功的判定 SHALL 依赖正面确认信号（成功响应、显式 success URL 跳转，或重载后「草稿箱(N)」计数增长），MUST NOT 因"找不到某个按钮"就报成功。活体取证（2026-10-08）表明图文编辑器**不存在**显式存草稿按钮、草稿由平台自动保存，因此"按钮存在"既不是保存的前置条件，也不是失败的判据——fail-closed 的锚点是**确认信号缺席**，不是控件缺席。

#### Scenario: 无草稿按钮但计数增长即确认
- **WHEN** `draft=True` 且页面不存在存草稿按钮（平台自动保存），重载草稿箱后计数由基线增长
- **THEN** 返回 `success=True`，且未点击任何公开发布按钮

#### Scenario: 既无按钮也无确认信号时拒绝公开发布
- **WHEN** `draft=True`、草稿保存按钮不命中，且重载后计数未增长、条目标题也未命中
- **THEN** 返回 `success=False` 且 error 指明未获正面确认，且未点击任何公开发布按钮

### Requirement: 选择器多候选回退与富文本可靠填写

发布器 SHALL 对关键控件（标题、正文、发布/草稿按钮、上传完成标志）使用多候选选择器回退链而非单一脆弱选择器；对 contenteditable 标题/正文 SHALL 通过事件派发（input/change）填写以触发前端框架状态更新；多标签 SHALL 逐个输入并选择下拉建议，MUST NOT 用覆盖式 fill 导致仅保留最后一个。

#### Scenario: 主选择器不命中时回退
- **WHEN** 首选标题选择器在页面结构中不存在
- **THEN** 发布器按回退链尝试候选选择器，命中即继续

#### Scenario: contenteditable 正文生效
- **WHEN** 正文控件为 contenteditable div 而非原生 textarea
- **THEN** 填写后触发 input 事件，前端状态含该正文，草稿保存后正文非空

### Requirement: DOM 轨错误归一到 outcome 且不越合规红线

发布器 SHALL 将登录过期、风控弹层、上传失败分别归一为对应 outcome 类别；命中 risk / login 类别时 SHALL 停止上报，MUST NOT 自动降级或更换账号；运行时 MUST NOT 请求任何外部签名/求签服务。

#### Scenario: 登录过期归一为 login 类
- **WHEN** 导航后 URL 落在 /login 或认证恢复失败
- **THEN** 返回 login_expired 类 outcome，不重试发布、不换号

#### Scenario: 风控弹层归一为 risk 类
- **WHEN** 页面出现风控/验证弹层
- **THEN** 返回 risk_blocked 类 outcome 并停止，不绕过

### Requirement: 发布流程逻辑可注入假页面做单测

发布器 SHALL 将发布步骤逻辑与真实 playwright 启动解耦（可注入 `page` 与 `ResponseMonitor` 工厂），使核心分支（草稿 fail-closed、确认才成功、选择器回退、错误归一）可在无真实浏览器的假对象下单元测试。

#### Scenario: 假页面驱动草稿 fail-closed 单测
- **WHEN** 单测注入一个"无草稿按钮且草稿箱计数不增长"的假 page 调用发布流程
- **THEN** 断言未点击公开发布按钮且返回 failure 类结果
