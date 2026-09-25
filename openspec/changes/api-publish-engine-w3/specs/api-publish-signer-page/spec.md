# api-publish-signer-page (delta)

## ADDED Requirements

### Requirement: 浏览器辅助签名页基建（Tier-B）
桌面应用主进程 SHALL 提供按平台懒建的常驻隐藏签名页（`BrowserWindow({show:false})`，加载该平台创作者域真实已登录页面，session partition 与登录会话同源以保证 Cookie/UA 一致），并 SHALL 以 `will-navigate`/`setWindowOpenHandler` 将导航与弹窗硬锁死在该平台域白名单内。签名函数 MUST 经 webpack 模块抽取（`window.webpackChunk*` push 劫持 + 特征码扫描）获得，函数句柄仅存页面内存槽位；MUST NOT 将句柄序列化回传主进程、落盘、入库或入 git。求签 SHALL 仅经白名单 IPC（`{signCommand, payload} → signature`）进行，renderer 侧不存在任意 JS 求值通道。

#### Scenario: 域锁拒绝
- **WHEN** 签名页尝试导航到非本平台域
- **THEN** 导航被拒绝且事件被记录，页面停留在白名单域

#### Scenario: 句柄不落盘
- **WHEN** 任一求签或抽取路径执行
- **THEN** 主进程/引擎侧只收到字符串签名值，注入脚本不含函数源码回传路径（`Function.prototype.toString`/`JSON.stringify(fn)` 零命中）

### Requirement: 拦截法一致性双验证
抽取出的签名函数 MUST 经拦截法验证后方可登记为 `verified`：hook 页面 `XMLHttpRequest`/`fetch`，对页面自身发出的带签请求以同 payload 本地复算比对，一致才允许该 `signCommand` 对外服务；不一致 MUST 废弃槽位、重扫模块并报告。

#### Scenario: 比对不一致
- **WHEN** 复算值与页面真发签名值不一致
- **THEN** 该 command 不进入 `verified`，白名单 IPC 对其求签请求被拒绝

### Requirement: 自愈限流与降级
求签异常或特征码失配时签名页 SHALL reload 并重抽取，每平台每小时不超过 3 次；超限置 `signer.degraded=true`，该平台发布 MUST 落到 DOM RPA 轨并上报事件，MUST NOT 无限重试刷签名。

#### Scenario: 超限降级
- **WHEN** 一小时内第 4 次触发重抽取
- **THEN** `signer.degraded=true`，后续发布按 publishMode 双轨走 DOM 且降级事件进发布日志

### Requirement: M3 spike 三步门禁与止损阀
快手 `__NS_sig3` 入链 MUST 以 spike 门禁为前置（时间盒 1 个工作日，逐序短路）：S0 本地近似公式活体探针裁决 → S1 假页面离线自测 → S2 真页抽取+拦截比对 → S3 复算签名直发活体（私密/草稿优先）。任一步失败 MUST 止步：快手/小红书保持 DOM RPA、platforms.yaml 不翻转、业务链代码不合并；裁决结论与比对记录 MUST 入文档域 `evidence/api-w3-kuaishou/`。⛔ 失败时不得换号、不得自动验证、不得改用远程签名服务。

#### Scenario: S2 抽取失败
- **WHEN** 时间盒内无法从 `cp.kuaishou.com` 页面抠出可复算一致的 sig3 函数
- **THEN** M3 记 no-go，快手发布仍走既有 DOM RPA，签名页基建单独评审是否保留

#### Scenario: S0 探针通过
- **WHEN** 最低风险已认证查询端点接受本地公式 `MD5(api_ph|JSON(body))` 产出的 sig3
- **THEN** sig3 判定为 Tier-A 本地路径，S2/S3 短路跳过，基建仅作为小红书 x-s 备胎进入评审
