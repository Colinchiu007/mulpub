## ADDED Requirements

### Requirement: 登录视图按平台复用同一分区目录

`AuthViewManager.openLogin` 与 `QrCodeLogin.openLogin` SHALL 使用**按平台复用的稳定分区目录**
承载第三方登录页，而不是每次调用新建一个带时间戳的空分区。

- 目录名 SHALL 由 `auth-partition-reclaim` 唯一派生（`loginSlotAccountIdOf(platform)` →
  `partitionNameOf(...)` ⇒ `auth-auth-<platform>-slot`），MUST NOT 在别处另写一份字面量。
- 目录名 SHALL NOT 带时间戳（否则每次仍是新目录，缓存不跨次留存）。
- 目录名 SHALL 落在发布链兜底读取端的既有前缀 `auth-auth-<platform>-` 之下，
  且 SHALL 按字典序排在该前缀的时间戳目录**之后**（数字 < 字母），
  使读取端「从新到旧逐份探」先探槽位、槽位空时自然落到旧目录（回退链不得因此断裂）。
- 清理登录会话时 SHALL **保留 HTTP 缓存**（`clearCache` 不得被调用），只清存储。

复用带来的**唯一**用户可感知收益是：同一平台第二次起打开登录页时，第三方登录页的静态资源与
风控 SDK 命中缓存，不再每次冷下载。用户可见 UI、文案、按钮、弹窗 SHALL 零变化。

#### Scenario: 同一平台两次登录落到同一目录

- **GIVEN** 用户先后两次在同一平台打开登录页
- **WHEN** 两次的分区目录名分别被读出
- **THEN** 两者 MUST 逐字相等
- **AND** 目录名 MUST NOT 匹配 `-<数字时间戳>` 形态

#### Scenario: 关闭登录会话时不得清掉 HTTP 缓存

- **GIVEN** 一次登录会话结束且未取到凭证
- **WHEN** 会话终态清理执行
- **THEN** 存储 SHALL 被清
- **AND** `clearCache` MUST NOT 被调用（缓存正是槽位存在的理由）

#### Scenario: 扫码登录与浏览器登录共用同一槽位

- **GIVEN** 用户用扫码方式打开某平台登录
- **WHEN** 读出该会话的分区目录名
- **THEN** 它 MUST 与同平台浏览器登录的目录名逐字相等

### Requirement: 复用槽位后的凭证隔离必须由开局清理显式保证

平台判定「已登录」看的是 Cookie。复用同一分区目录后，隔离 MUST 由**导航之前**的槽位清理显式保证：
槽位里若留着上一轮的会话 Cookie，第二次打开登录页会直接跳已登录态，用户想加**第二个**同平台账号时
会静默存成**同一个账号**。

- 清理 MUST 发生在**首个导航之前**（页面若先带着旧 Cookie 发出请求，隔离已晚）。
- 清理 SHALL **一律执行**（MUST NOT 按「槽位里有没有 Cookie」分流）：Cookie 判据漏掉用 localStorage
  存登录态的平台（知乎 `z_c0` 即在 localStorage），且探针异常时会把隔离直接跳过
  （2026-10-21 CCG 外部评审两条 Critical 的定稿）。
- 清理 SHALL 只清存储（Cookie/localStorage/IndexedDB 等），MUST NOT 清 HTTP 缓存。
- 清理 MUST 带硬上限（默认 1200ms，可用环境变量覆盖）：超限 MUST 记日志并**照常导航**
  （清理是旁路，MUST NOT 让用户加不了账号）。
- 清理失败 MUST 只留日志，MUST NOT 阻断导航。

#### Scenario: 导航前先清掉槽位里的旧凭证

- **GIVEN** 槽位里存有上一轮的 Cookie
- **WHEN** 打开该平台的登录页
- **THEN** 清理 MUST 先于导航发生（调用顺序可断言）

#### Scenario: 空槽位也照样清理

- **GIVEN** 槽位里没有任何 Cookie
- **WHEN** 打开该平台的登录页
- **THEN** 清理 MUST 照常发生，且 MUST 先于导航
- **AND** 不得因为「看起来是空的」而跳过（用 localStorage 存登录态的平台会漏）

#### Scenario: 清理失败不得阻断登录

- **GIVEN** 槽位清理抛错
- **WHEN** 打开该平台的登录页
- **THEN** 导航 MUST 照常发生

### Requirement: 「本轮是否取到凭证」必须按轮次判定

槽位目录名跨轮次相同，因此「本轮是否取到凭证」MUST 按**轮次**判定，MUST NOT 按分区名判定：
按分区名判会把「上一轮成功」误当成「本轮成功」，导致本轮其实没登录成、槽位里还留着上一轮会话时
被当作已取证而不清理。

- 登录承载方 SHALL 在结算时把**本轮**结果显式传给回收端。
- 回收端在调用方显式给出该值时 MUST 以它为准；未给出时才回落到按分区名记的登记表（保守：宁可留着数据）。

#### Scenario: 本轮未取到凭证时必须清理

- **GIVEN** 上一轮曾成功登录（同一分区名）
- **WHEN** 下一轮登录超时或被取消
- **THEN** 该轮结束时槽位 MUST 走清理路径

### Requirement: 登录槽位不得进入一次性分区回收面

槽位是跨多次登录存活的稳定目录，MUST NOT 被当作「每次调用新建」的一次性分区回收。
识别 MUST 同时满足「以 `auth-auth-` 开头」且「以 `-slot` 结尾」，MUST NOT 放宽到整个前缀族
（放宽会让真正的一次性目录失去回收）。

#### Scenario: 槽位在回收扫描后仍然存在

- **GIVEN** 磁盘上存在一个登录槽位目录与若干一次性目录
- **WHEN** 执行回收扫描
- **THEN** 槽位 MUST NOT 出现在被删清单里，且 MUST 仍在磁盘上
- **AND** 一次性目录 MUST 仍按既有窗口被删（证明回收没有整体失效）
