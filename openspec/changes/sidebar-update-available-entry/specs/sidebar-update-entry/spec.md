# sidebar-update-entry Specification

## Purpose
应用运行期间检测到新版本时，在侧边栏底部登录菜单按钮上方常驻显示「新版本」入口；点击后退出应用并安装新版本（未下载则先下载，下载完成后自动退出安装），取代启动即弹的更新模态框，使更新可达但不打扰。

## Requirements

### Requirement: 入口显隐与位置
侧边栏 footer 子元素顺序为 `[0] 服务连接信息` → `[1]「新版本」入口（仅在 badgeMode !== 'hidden' 时渲染）` → `[2] 登录 banner` → `[3] 升级弹窗（条件渲染）`。无可用更新时该入口不存在于 DOM，原顺序契约（`[0] 服务连接信息 → [1] 登录 banner`）保持不变。

#### Scenario: 无可用更新
- **WHEN** 状态为 `hidden`（初始 / `not-available` / `skipped-by-policy`）
- **THEN** 不渲染「新版本」入口

#### Scenario: 检测到新版本
- **WHEN** 主进程推送 `available`
- **THEN** 入口渲染在登录 banner 正上方，文案「新版本」

### Requirement: 入口四态
`badgeMode` 为唯一真相源：`available`「新版本」→ `downloading`「下载中 N%」（禁用，`aria-busy=true`）→ `ready`「重启安装」→ `error`「重试安装」。

#### Scenario: 下载中
- **WHEN** 收到 `installing` 或 `downloading`
- **THEN** 显示百分比且不可点击

#### Scenario: 安装包已下载
- **WHEN** 收到 `downloaded`
- **THEN** 文案「重启安装」，点击直接安装

#### Scenario: 点击后失败
- **WHEN** 用户已请求安装后收到 `error`
- **THEN** 文案「重试安装」，再次点击可重试

#### Scenario: 后台静默失败
- **WHEN** 用户未点击（无安装请求）时收到 `error`
- **THEN** 入口不切换为 `error`，不打扰用户

### Requirement: 点击即退出并安装
点击入口 → 非阻塞提示「正在下载新版本，完成后将自动退出应用并安装」→ IPC `update:install-now` → 主进程 `installNow()`：已下载直接 `quitAndInstall()`；未下载则下载并在 `update-downloaded` 后自动 `quitAndInstall()`（用户点击即视为同意退出）。

#### Scenario: 幂等
- **WHEN** 下载期间重复点击（渲染层或主进程）
- **THEN** 只触发一次下载

#### Scenario: 强制策略已在后台下载
- **WHEN** `autoDownload = true`（force_version 策略）
- **THEN** 点击不重复触发下载，仅登记安装意图

#### Scenario: 无可用更新
- **WHEN** 调用 `installNow()` 时无可用新版本
- **THEN** 返回 `false` 并推送 `not-available`（入口隐藏）

#### Scenario: 并发复查不中断安装
- **WHEN** 安装请求进行中收到 `update-not-available`
- **THEN** 不清空待安装状态，下载完成后仍自动退出安装

### Requirement: 安全与合同
`update:install-now` 经 `withSenderCheck` 校验来源（不可信 → `{code:-3}`），与既有 `update:*` 同为「无需登录 + 要求可信来源」；异常返回统一 `{code:-1, message}` envelope；preload 暴露面与主进程 handler 一一对应。

#### Scenario: 不可信来源
- **WHEN** 外部网页 sender 调用 `update:install-now`
- **THEN** 返回 `{code:-3, message:'未授权的调用来源'}`，不调用 autoUpdater

### Requirement: 视觉与无障碍
图标为实心圆（`fill: var(--primary)`）+ 白色向上箭头；文字与图标同主色，不使用参考截图的绿色；窄屏（≤900px）隐藏文字标签但保留 `aria-label`；不引入 `@keyframes`、不引用 `--skeleton-*`；原生 `<button>` + `:focus-visible` 主色描边。

#### Scenario: 设计标准配色
- **WHEN** 检查组件源码
- **THEN** 图标与文字使用 `var(--primary)`，且无绿色硬编码
