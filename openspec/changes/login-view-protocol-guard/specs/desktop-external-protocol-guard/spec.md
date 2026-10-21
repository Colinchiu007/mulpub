# desktop-external-protocol-guard Specification

## ADDED Requirements

### Requirement: 内嵌登录视图的外部协议守卫

桌面端所有加载平台真实页面的内嵌视图（账号登录视图、扫码登录视图、OAuth 授权视图、RPA 自动化窗口、静默登录窗口）
SHALL 安装统一的外部协议守卫。守卫 SHALL 仅允许 `http:` / `https:` 协议的导航与新窗口请求；
任何其它协议（`bitbrowser:`、`javascript:`、`data:`、`file:` 等自定义或本地协议）SHALL 在**到达操作系统之前**
被应用内拦截，SHALL NOT 触发操作系统的"选择打开方式"弹窗。

协议判定 SHALL 复用 `packages/shared-utils/src/safe-http-url.js` 的共享实现，守卫模块 SHALL NOT 自带协议正则字面量；
守卫 SHALL 额外拒绝带 userinfo（`username` / `password`）的 URL。

被拦截时，守卫 SHALL 记录一条级别为 WARN 的结构化日志，含视图标识（tag）、拦截通道（`window-open` / `navigation`）
与被拦 URL。守卫安装失败（目标对象不支持相应方法）时 SHALL 静默跳过，SHALL NOT 阻断登录视图的创建。

#### Scenario: 平台页请求未注册协议时不再弹出系统对话框

- **WHEN** 账号登录视图内的平台页请求打开 `bitbrowser://cc/` 这类未注册协议链接
- **THEN** 该请求在应用内被拦截，页面停留在当前登录页
- **AND** 操作系统不弹出「获取打开此'bitbrowser'链接的应用」之类的系统对话框
- **AND** 应用日志出现一条 `external-protocol-blocked` 的 WARN 记录，`params.source` 为 `window-open` 或 `navigation`

#### Scenario: 主框架导航到自定义协议时被拦下

- **WHEN** 登录视图内的平台页把主框架导航到 `bitbrowser://cc/`
- **THEN** 导航被阻止（`will-navigate` 事件被 `preventDefault`）
- **AND** 该次拦截以 `params.source = navigation` 记入 WARN 日志

#### Scenario: http(s) 跳转与新窗口行为不变

- **WHEN** 登录页跳转到 `https://creator.douyin.com/...`，或对 `http(s)` 链接调用 `window.open`
- **THEN** 跳转与新窗口行为与守卫接入前完全一致（http(s) 一律放行）
- **AND** 登录成功判定、Cookie / localStorage / IndexedDB 抓取不受影响

#### Scenario: 带 userinfo 的 URL 被拒绝

- **WHEN** 平台页请求打开 `https://user:secret@example.com/`
- **THEN** 该请求被拦截并记 WARN 日志

#### Scenario: 守卫缺失方法时静默跳过

- **WHEN** 目标 `webContents` 不支持 `setWindowOpenHandler`
- **THEN** 守卫安装返回"未安装"且不抛错
- **AND** 视图创建流程继续完成（登录页仍能打开）

#### Scenario: 重复安装守卫不叠加监听器

- **WHEN** 同一个 `webContents` 上重复调用守卫安装
- **THEN** `will-navigate` 监听器只注册一次，拦截日志每次只写一条
- **AND** 第二次调用返回首次安装的状态对象（幂等）

#### Scenario: 子框架内的协议跳转属排除范围

- **WHEN** 平台页的 **iframe**（广告 / SDK 注入帧）内部发起自定义协议跳转
- **THEN** 本守卫**不拦截**该跳转（Electron 的 `will-navigate` 只对主框架导航触发）
- **AND** 该限制 SHALL 在设计文档中显式声明，不得以"已全覆盖"表述

### Requirement: 守卫接线覆盖面

桌面端 SHALL 在下列视图创建点安装外部协议守卫：账号登录视图、扫码登录视图、OAuth 授权视图、
RPA 自动化窗口、静默登录窗口。普通账号标签页、身份登录窗与签名页已有各自守卫，SHALL NOT 被本守卫重复接管。

#### Scenario: 五个视图创建点均已接线

- **WHEN** 校验登录/扫码/OAuth/RPA/静默登录五处视图创建点
- **THEN** 每处都在视图创建后调用了统一守卫模块，且传入可区分的视图标识（tag）

#### Scenario: 新增同类视图必须同步登记

- **WHEN** 新增一个"加载平台真实页面"的内嵌视图
- **THEN** 该视图 SHALL 装上统一守卫，SHALL 同步登记进接线锁清单
  （`external-protocol-guard-wiring.contract.test.js` 的 `WIRED_SITES`）
- **AND** 接线锁 SHALL 同时覆盖**行为级**断言（真实创建视图并驱动其守卫），
  不接受"只有源码字符串匹配"作为接线证据
- **AND** 接线锁清单 SHALL 只能由显式登记变更，不得从源码启发式推导
  （启发式推导会把"看起来像的路径"混进名单，产生假阳与假阴）
