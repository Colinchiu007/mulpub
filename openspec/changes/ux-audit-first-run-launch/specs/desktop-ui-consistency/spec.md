# desktop-ui-consistency — 启动期判定必须可达且由用户完成（UX 审计 1.4）

## ADDED Requirements

### Requirement: 首启向导必须在"真的需要"时被到达，且完成判定只能由用户动作产生

系统 MUST 在全新 `userData`（无完成标记）启动时进入首启向导，
MUST NOT 在窗口创建路径上替用户写下"已完成"标记 —— 自动落标记等于把该功能永久关掉。
完成标记 MUST 只能由向导上的显式动作（完成 / 跳过）写入。

#### Scenario: 全新 userData 首启

- **WHEN** `userData` 下不存在完成标记，应用启动
- **THEN** 渲染端 MUST 被导航到首启向导，MUST NOT 直接停在主界面

#### Scenario: 老用户升级后不得被拦进向导

- **WHEN** `userData` 下已有完成标记（升级用户）
- **THEN** MUST NOT 导航到向导；MUST NOT 因为"新逻辑上线"而抹掉既有标记

#### Scenario: 向导中途关窗

- **WHEN** 用户进了向导但没点完成 / 跳过就退出应用
- **THEN** 标记 MUST 仍不存在，下次启动 MUST 再次进入向导

#### Scenario: 标记落盘必须是原子替换（QM-6 i10）

- **WHEN** 写标记的进程在写入中途被杀（断电、崩溃、杀毒软件占用）
- **THEN** 最终名 MUST NOT 出现半写或 0 字节内容 —— 实现 MUST 先写临时名再 `rename` 替换，
  失败路径 MUST 清掉临时名。理由不是性能而是**读法**：判定侧只看 `existsSync`，
  一份损坏的最终名会被读成「已完成」，向导从此永久消失且日志零痕迹（与自动落标记同形，换了成因）
- **AND** 并发写者抢先落成时 `rename` 失败 MUST 如实返回「已存在」语义，MUST NOT 冒报本次写入

#### Scenario: 导航被拒绝不得升级为「本会话永久跳过」（QM-6 i2）

- **WHEN** 判定已决定进向导，但 `router.push` 被导航守卫拒绝或重定向失败
- **THEN** 一次性闩 MUST 被放开（下次挂载可重判），MUST 出声并返回可归因的失败档；
  对全新 `userData` 的用户，"一次失败"不得等价于"该功能从未存在"

#### Scenario: 向导出口的异常不得逃逸成未处理 rejection（QM-6 i3）

- **WHEN** 出口动作里标记写成功但随后的导航被拒绝
- **THEN** 该异常 MUST 在点击处理函数内收口并出声，MUST NOT 变成 Unhandled Rejection

### Requirement: 向导的显示项必须反映真实发生的检查，不得保留装饰性步骤行

向导里每一行"检测状态" MUST 对应一个真实会跑的检查；
若主进程已不再做该类检查（本仓 P2-E 移除了 Playwright 浏览器检查），
该行 MUST 改为如实说明当前会做什么，或整行撤下，
MUST NOT 保持"由外部一次性点亮成 ✅"的形态 —— 那给用户的是"检查过了"的假证据。

#### Scenario: 主进程不再检查依赖

- **WHEN** 主进程的首启流程只做"标记 + 广播"，不检查 Python / 浏览器资源
- **THEN** 向导 MUST NOT 显示「Python 依赖 ✅」「Playwright 浏览器 ✅」这类从未跑过的检测结论

#### Scenario: 重试按钮不得承诺它做不到的事

- **WHEN** 某个按钮的处理函数只调用只读检查、不会重跑任何检测
- **THEN** 其文案与注释 MUST NOT 写成"重新触发安装/检测"；要么给它真的重跑出口，要么改掉语义

### Requirement: 新增 IPC 通道必须同批登记授权白名单

主进程新增的任何渲染端可调用通道，MUST 在同一个变更集里出现在 `PUBLIC_CHANNELS`（或明确的授权档），
且 MUST 有一条锁证明"handler 存在 ⇒ 白名单里有它"。
只注册 handler 不登记白名单的症状是"点了没反应且无错误"，属静默失效。

#### Scenario: 只加 handler 不加白名单

- **WHEN** 实现了 `first-run:complete` 的 handler，但 `PUBLIC_CHANNELS` 里没有它
- **THEN** 该锁 MUST 变红并点名缺失的通道

#### Scenario: 预载导出与通道成对

- **WHEN** 通道已登记而 preload 未导出对应方法（或反之）
- **THEN** 同一条锁 MUST 变红（三处任一缺失即不可用）

#### Scenario: PUBLIC 档位必须写明理由，不得默默继承（QM-6 i9）

- **WHEN** 一条新通道登记进 `PUBLIC_CHANNELS`（即不做授权校验，应用内任何持有桥的
  `webContents` 都可调用，含内嵌 `WebContentsView`）
- **THEN** 规格 MUST 显式声明该档的正当理由与影响面。`first-run:complete` 与既有
  `first-run:check` 同档：其唯一后果是「引导是否还会显示」，**不提升任何数据权限、不触碰凭证**，
  因此限 `isTrustedSender` 的收益不抵它与同族通道口径分裂的代价
- **AND** 若将来该通道开始承载任何权限、凭证或发布语义，本条理由即失效，MUST 改走授权档
