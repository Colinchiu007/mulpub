# api-publish-chain (delta: kuaishou-w3-live-fix)

## MODIFIED Requirements

### Requirement: 生产路由 API-first 凭证解析（auth 分区兜底）

`RpaViewManager.publish()` 的 API-first 分支 SHALL 在 `authData.cookies` 拼接结果为空串时，从该账号的 Electron auth 分区（`persist:auth-auth-{platform}-*` / `persist:auth-{platform}-*` / `persist:account-{accountId}` 等既有命名，定位逻辑与 DOM 轨 `_restoreAuthPartitionCookies` 同源单一实现）只读直取 cookie，按 `isPlatformCookieDomain(platform)` 过滤后拼串继续走 API 链。分区兜底仍取不到 cookie 时 MUST 保持既有 fail-closed 语义（adapter 报「账号信息缺失」），MUST NOT 发出无凭证请求、MUST NOT 写凭证 store。分区读取失败（分区目录不存在、session 异常）MUST 记 warn 并降级 DOM 轨，行为与现状一致。

#### Scenario: 凭证 store 为空但 auth 分区有登录态（D1 回归）
- **WHEN** kuaishou 账号 `authData.cookies` 为空数组，auth 分区存在含平台域 cookie 的登录态
- **THEN** API-first 分支以分区 cookie 串调用 `publishViaApi`，九步链可执行；DOM 轨不被触发

#### Scenario: 双源皆空保持 fail-closed
- **WHEN** `authData.cookies` 为空且 auth 分区不存在或无平台域 cookie
- **THEN** 行为与修复前一致：空串传入 adapter，fail-closed 报「账号信息缺失」并降级 DOM 轨

#### Scenario: 跨平台 cookie 不串味
- **WHEN** auth 分区含非本平台域（如 xiaohongshu 域）的 cookie
- **THEN** 拼入 API 请求的 cookie 串仅含 `isPlatformCookieDomain(platform)` 通过的项

#### Scenario: 凭证 store 有 cookie 时不读分区（既有行为不变）
- **WHEN** `authData.cookies` 非空
- **THEN** 直接使用 store 凭证，不触发分区兜底读取（douyin 等 W2 已通路由零行为变化）

### Requirement: 快手 DOM 兜底轨发布按钮选择器与活体 DOM 对齐

`platform-selectors.js` kuaishou `publish_btn` 候选序列 SHALL 以 cp.kuaishou.com 发布页活体取证为准刷新；刷新后 MUST 保留旧候选作尾部兜底，MUST 补「未就绪/登录页不误命中」负例回归（对齐 platform-definitions 负例形态）。

#### Scenario: 当前页面按钮文案命中
- **WHEN** 发布页渲染完成且主按钮为活体取证到的文案/结构
- **THEN** 候选序列在有限轮询内命中该按钮并触发点击

#### Scenario: 旧版页面不回退破坏
- **WHEN** 页面仍为旧版「发布」按钮
- **THEN** 尾部旧候选仍可命中（选择器刷新不减少既覆盖形态）
