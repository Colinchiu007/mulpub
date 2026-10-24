## 0. 前置取证（根因与责任归属）

- [x] 0.1 应用侧是否背锅：逐条查登录会话的代理、请求拦截、UA、preload、节流状态。
      **→ 落点：design D1 表第 2 行**：代理 `DIRECT`（未走账号代理）、无 `onBeforeRequest` 拦截
      （噪声 cancel 默认关且只针对微信域）、UA 已净化成标准 Chrome UA、preload 惰性、
      `drawn=true bgThrottle=true`（未被后台节流）⇒ 应用侧无责
- [x] 0.2 浏览器对照：用**完全无关**的浏览器（桌面端内嵌浏览器，独立 profile）打开同一登录页。
      **→ 落点：导航耗时 23812ms**（应用侧同场景 28370ms）⇒ 不是应用特有
- [x] 0.3 元凶定位：该浏览器的网络面板。**→ 落点：`s3a.bytecdn.cn/ta/resource/v0/analytics.js`
      → `net::ERR_BLOCKED_BY_ORB`，durationMs=18315**
- [x] 0.4 是本机线路还是字节侧故障：① 直连真实 CDN IP；② 外部网络拉同一文件。
      **→ 落点：① `curl --resolve s3a.bytecdn.cn:443:111.13.110.60` → 504，TTFB 9.33s；
      ② Jina Reader → 同样 504** ⇒ 字节侧故障（外部网络对照是决定性的一格）
- [x] 0.5 验证码组件归因：登录页 bundle 提取主机名 + 逐个计时。
      **→ 落点：`webmssdk.js` 520KB/1.29s、`captcha.js` 784KB/1.07s（冷缓存）** ⇒ 「灰显几秒」的来源
- [x] 0.6 本机代理形态：DNS / 控制口。**→ 落点：DNS=<路由 IP>，显式查 223.5.5.5 仍返回
      `fake-ip 保留段` fake-ip；`<路由 IP>:<控制台端口>` 返回 `{"message":"未授权"}`** ⇒ 路由器上跑着 Clash/OpenClash
- [x] 0.7 用户侧绕行可行性：头条号登录页自带「扫码登录」tab，扫码轮询端点健康。
      **→ 落点：页面文本含「扫码登录」「二维码已失效点击刷新」；`sso.toutiao.com/check_qrconnect/`
      实测 80~600ms/次** ⇒ 扫码是当下最稳的绕行

## 1. 槽位命名与回收面（先写用例再改实现）

- [x] 1.1 用例：槽位分区名按平台固定（同一平台恒定、不同平台不同、非法平台返回 null）。
      **→ 落点：`auth-partition-reclaim.test.js`「登录槽位」组第 1~2 条**
- [x] 1.2 用例：槽位落在 `auth-auth-<platform>-` 前缀下且字典序排在时间戳目录之后。
      **→ 落点：同组第 3 条**（读取端零改动即可读到，且先探槽位）
- [x] 1.3 用例：槽位不是一次性分区，回收端永不把它当 victim。
      **→ 落点：同组第 4~5 条 + 端到端真目录用例**（反向对照：一次性目录仍被删）
- [x] 1.4 实现：`loginSlotAccountIdOf` / `loginSlotPartitionNameOf` / `isLoginSlotPartitionName` +
      `isThrowawayPartitionName` 显式豁免。**→ 落点：`auth-partition-reclaim.js`**

## 2. 保留缓存的清理与开局清（凭证隔离）

- [x] 2.1 用例：`keepHttpCache` 时只调 `clearStorageData`、不调 `clearCache`。
      **→ 落点：`auth-partition-reclaim.test.js`「清凭证保留 HTTP 缓存」条**
- [x] 2.2 用例：空槽位零 IO；有 Cookie 时清存储保留缓存。**→ 落点：同组两条**
- [x] 2.3 用例：清理带硬上限（卡死时返回 `timeout` 且不抛）；失败只留日志。
      **→ 落点：同组两条 + 超时预算取值表**
- [x] 2.4 实现：`wipeSessionStorage(…, {keepHttpCache})` + 新增 `wipeLoginSlotCredentials`（带超时）。
      **→ 落点：`auth-partition-reclaim.js`**
- [x] 2.5 用例：导航前先清槽位凭证（断言调用顺序 `['wipe','load']`）；空槽位直接导航；清理失败不阻断。
      **→ 落点：`auth-view-manager-partition-reclaim.test.js`「登录槽位」组三条**
- [x] 2.6 实现：登录视图与扫码登录都用槽位 + 导航前清理。**→ 落点：`auth-view-manager.js`
      `_navigateAfterSlotCleanup`、`qrcode-login.js` `_navigateAfterSlotCleanup`**

## 3. 「本轮是否取到凭证」按轮次判定

- [x] 3.1 现象：槽位同名导致 `capturedPartitions` 把上一轮成功误当本轮成功 ⇒ 三条既有用例当场变红
      （超时终态 / 取消但有平台 Cookie / 跨会话不串）。
      **→ 落点：实测红集 `auth-view-manager-partition-reclaim.test.js` 三条，均为
      `expected 1 times, but got 0 times` / `not to have been called at all, but actually been called 1 times`**
- [x] 3.2 修法：登录承载方显式传本轮 `captured`；回收端显式给出时以它为准，未给出才回落登记表。
      **→ 落点：`auth-partition-reclaim.js` `reclaimLoginSession` + `auth-view-manager.js`
      `_currentAttemptCaptured`**
- [x] 3.3 既有三条用例按新语义改写（开局清理先落定再断言关闭行为），意图不变。**→ 落点：同上文件**

## 4. 头条号登录期观测

- [x] 4.1 用例：头条号用自己的监测域过滤面；微信平台过滤面一字不变。
      **→ 落点：`login-network-diagnostics.test.js`「头条号登录期观测」组前两条**
- [x] 4.2 用例：监测域内的失败请求与 HTTP≥400 各留一条。**→ 落点：同组两条**
- [x] 4.3 用例：慢请求（≥阈值）留耗时与阈值；未达阈值不记；监测域外不记。
      **→ 落点：同组三条**
- [x] 4.4 用例：图形验证码组件加载完成单独留痕（含耗时与字节数）。**→ 落点：同组两条**
- [x] 4.5 用例：监测域内请求失败留痕。**→ 落点：同组一条**
- [x] 4.6 用例：隐私边界（头条号永不 `getResponseBody`）。**→ 落点：同组一条**
- [x] 4.7 用例：代理解析探针指向头条自己的站点。**→ 落点：同组一条**
- [x] 4.8 实现：`PLATFORM_MONITORED_HOSTS` + `urlFiltersFor` + `isMonitoredHost` +
      `TIMING_OBSERVE_PLATFORMS` 计时层。**→ 落点：`login-network-diagnostics.js`**

## 5. 文档

- [x] 5.1 PRD（写到可直接照着实现的粒度：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 / 不做什么 /
      取舍与已知限制）。**→ 落点：`01-docs/PRD-LOGIN-SLOT-REUSE-2026-10-21.md`**
- [x] 5.2 用户侧排障手册（OpenClash 规则与 fake-ip-filter 的具体写法 + 验证步骤 + 边界）。
      **→ 落点：`01-docs/TROUBLESHOOT-TOUTIAO-LOGIN-SLOW-2026-10-21.md`**
- [x] 5.3 规格增量。**→ 落点：`specs/desktop/spec.md`（4 条 Requirement）、
      `specs/desktop-logging/spec.md`（3 条 Requirement）**

## 6. 收尾（按 AGENTS 合并与收尾清单）

- [x] 6.1 回归锁全绿（既有用例不退化 + 本刀新增），点名跑电子进程相关测试。
      **→ 落点：7 个相关测试文件 246 passed（首轮）；CCG 修订后 247 passed**
- [x] 6.2 变异反证：把槽位豁免、保留缓存、开局清理、计时层各改坏一次，确认对应用例变红。
      **→ 落点：M1~M6 全 CAUGHT，跑后源文件 md5 与跑前逐一相等**
      （M1/M3 首轮因锚点失配被 SKIP——不是漏网：改坏 `isThrowawayPartitionName` 的豁免行、
      把开局清理恒判为空，改用 CRLF 归一 + 新锚点重跑后两条均 CAUGHT）
- [x] 6.3 CCG 双模型外部评审（QM-6），Critical 全部修掉并写进执行记录。
      **→ 落点：见 §7**
- [x] 6.4 执行记录 `openspec/records/login-partition-reuse.md`。
      **→ 落点：已建（状态列「由门禁推导」）**
- [x] 6.5 `classify-docs-only` 在 commit 后取证。
      **→ 落点：`docs-only=false files=20` ⇒ 混合 PR，走完整质量节拍，不借道 docs-only 通道**

## 7. QM-6 外部双模型评审（critic=claude / proposer=opencode，跨家族校验通过）

### 7.1 第 1 轮（对 `e098fb1e3`）出 6 条（最低分 4）⇒ 自扮演裁决出口

| id | 级别 | 评审结论 | 处置 |
| --- | --- | --- | --- |
| i1 | Critical | `cookies.get({})` 探针异常时会把「隔离」直接跳过 | **成立 → 已修**：开局清改为**一律清理**，取消探针（不再有「探失败即当空」的分支） |
| i2 | Critical | 「有没有 Cookie」判据漏掉用 localStorage/sessionStorage 存登录态的平台（知乎 `z_c0`） | **成立 → 已修**：同上，一律清理；PRD/规格同步改口径 |
| i3 | Warning | 3000ms 硬超时可能给用户最多 3 秒可感知卡顿 | **成立 → 已改**：上限降到 **1200ms**（安全网不是常态延迟；正常路径 ms 级），并在代码注释写明取舍；「完全异步化」不采纳——清理必须先于导航，否则隔离不成立 |
| i4 | Warning | 槽位逻辑分散四文件、缺独立模块 | **成立 → 已修（比第 1 轮更进一步）**：槽位规则独立成 `auth-login-slot.js`、观测口径独立成 `login-network-monitor.js`；`auth-view-manager.js` 的「打开已保存账号」平移成 `auth-view-saved-account.js`（**行数门禁是硬要求**：登记值 553、容差 200，本刀把它推到 771 ⇒ 必须拆） |
| i5 | Warning | `isCaptchaSdkUrl` 用 `indexOf` 匹配整条 URL，易误匹配 | **成立 → 已修**：改为只匹配 **pathname**，第 2 轮再收紧为版本目录锚点（`/webmssdk/`）并补负例 |
| i6 | Info | 建议补断言确保计时路径永不调 `getResponseBody` | **已在位**：`login-network-diagnostics.test.js`「头条号永不 getResponseBody」用例已覆盖 ⇒ 驳回（附证据） |

### 7.2 第 2 轮（对 `f2500c955`）出 8 条（最低分 5）

| id | 级别 | 评审结论 | 处置 |
| --- | --- | --- | --- |
| i1 | Critical | `withSlotWipeTimeout` 把底层返回 false 映射成 `reason:'wiped'` ⇒ 失败被读成成功 | **成立 → 已修**：映射改为按 true/false 分别落 `wiped`/`failed`；顺带修掉同源坑（`clearStorageData()` resolve 的是 **undefined** 不是 true，直接交给 race 会被判成失败）——现由槽位模块显式折成 true/false |
| i2 | Critical | 隐私边界只靠测试断言，代码里无运行时结构防护 | **成立 → 已修**：在 `attachAuthResponseDiagnostics` 的响应分支加**显式闸门**「未登记端点匹配器的平台一律不碰 `getResponseBody`」（此前只是靠匹配器为空隐式成立） |
| i3 | Warning | 验证码组件标记仍是 pathname 子串匹配（`/proxy/webmssdk.js` 会误中） | **成立 → 已修**：标记改用版本目录锚点 `/webmssdk/` + `/secsdk-captcha/`，并补三条负例（查询串带名、域名带名、同尾异目录） |
| i4 | Warning | 回收模块新增 9 个导出符号、模块表面膨胀 | **成立 → 已修**：槽位符号全部移出回收模块（`auth-login-slot.js`），回收模块只保留「槽位不得进回收面」这一条豁免 |
| i5 | Warning | 平台非法时静默退回一次性分区名 | **成立 → 已修**：退回时记一条 `log.warn` 留痕（两个登录承载都加了） |
| i6 | Warning | `isMonitoredHost` 每请求线性扫域数组 | **成立 → 已修**：按平台编译正则并缓存（`hostMatcherOf`） |
| i7 | Info | `.ccg/reviews/*.json` 的 `deepReview.findings` 为 null | 属引擎产物：评审未闭合前本就是 pending；本轮走完自扮演裁决 + 修复后重跑 |
| i8 | Warning | 监测域清单硬编码、无扩展机制 | **驳回**：本仓的平台级清单一律是代码级注册表（`PLATFORM_LOGIN_URLS` / `PLATFORM_COOKIE_DOMAINS` / `PLATFORM_SESSION_COOKIE_MARKERS` 皆如此），改配置反而多一份真源 |

### 7.3 第 3 轮（对压成单提交后的 `1ced2ea5`）出 5 条（最低分 8）

| id | 级别 | 评审结论 | 处置 |
| --- | --- | --- | --- |
| i1 | Critical | `withSlotWipeTimeout` 的多步映射脆弱：若有人把 `.then(() => true)` 那层去掉，`clearStorageData()` 的 `undefined` 会被读成失败 | **成立 → 已修**：① 契约写进函数头注释（`pending` MUST resolve 成布尔）；② 调用方显式折成 `true`/`false`；③ **防御性断言**：拿到非布尔即判 `contract-violation`（失败且原因可辨），让这类改动当场可见而不是静默把成功读成失败；④ 新增 `auth-login-slot.test.js` 钉住三种取值 |
| i2 | Critical | 新增的显式隐私闸门（未登记匹配器的平台不碰 `getResponseBody`）**关掉了一个隐式漏洞**，建议固化 | **成立 → 已修**：补一条「闸门按平台判而非按 URL 判」的用例（头条平台收到知乎形状的 URL 也不读体）——若闸门被误改成按 URL 判，这条立刻红 |
| i3 | Warning | `auth-login-slot.js` 没有自己的测试文件，断言全寄生在回收模块的测试里 | **成立 → 已修**：新增 `auth-login-slot.test.js`（命名 / 豁免 / 超时预算 / 返回契约 / 防御断言 / 导航前清理顺序，15 例） |
| i4 | Warning | `navigateAfterSlotCleanup` 传空 opts，导航行为取决于进程里恰好有没有那个环境变量 | **成立 → 已修**：超时预算**显式**给出（默认 1200ms），不让导航被一个被改大的全局值拖住 |
| i5 | Info | 评审记录要在修复后收口 | 由写回器在 status 落进仓内闭环词表时补 `tier=external` + `evidence` |

### 7.4 第 4 轮（对压成单提交后的 `2b06d3e6`）出 6 条

| id | 级别 | 评审结论 | 处置 |
| --- | --- | --- | --- |
| i1 | Critical | **diff 静默回退了已合入的「平台选择器自绘浮层」改动**（AccountPlatformPicker 及其 CSS/测试、locale 键、store 分组逻辑、UI-INVENTORY）——本刀的提交把别的会话的成果带成了回退 | **成立 → 已修**：本刀不再基于旧 main；已 `reset --hard origin/main` 后**只取回本刀自己的文件**（逐路径 `git checkout <commit> -- <本刀文件>`），变更集里不再有别人的文件。根因是 `git add -A` 把「worktree 里没有的新文件」记成了删除 —— 共享 worktree 落后于 main 时必踩 |
| i2 | Critical | `auth-view-manager.js` 里 `openSavedAccount` 的**导入名与方法名同名**，方法体内被遮蔽 | **成立 → 已修**：导入改名为 `runSavedAccountOpen`（并加注释说明「不得同名」） |
| i3 | Warning | 判定记录里带出了本机网络配置片段（fake-ip 规则、控制口地址、代理串） | **成立 → 已修**：排障手册里的**私有路由 IP 换成占位符**（`<你的路由 IP>`）；保留的 `fake-ip 保留段`（fake-ip 公共段）、`127.0.0.1`、OpenClash 默认端口均为公开默认值，不是本机信息 |
| i4 | Warning | `loadStartedAt` 在清理前有孤儿初值（真正赋值在 navigate 闭包里） | **成立 → 已修**：初值删掉，计时起点只在真正发起导航时取并存到 `this._loginLoadStartedAt` |
| i5 | Warning | 槽位模块与回收模块的依赖方向没写明，有成环风险 | **成立 → 已修**：`auth-partition-reclaim.js` 顶部写明**槽位模块是叶子模块、本模块 require 它、它绝不 require 本模块**；两份「auth-<accountId>」实现由回环契约锁钉在一起 |
| i6 | Info | 监测域匹配改成按平台编译正则并缓存（O(1) 取代每请求线性扫）这个改进没写进影响面 | **成立 → 已修**：写进 proposal 的影响面（便于审计追溯） |

### 7.5 第 5 轮（对 Q6b327）出 7 条

| id | 级别 | 评审结论 | 处置 |
| --- | --- | --- | --- |
| i1 | Critical | 判定记录 .ccg/reviews/*.json 带出评审流程与环境细节 | **驳回（附证据）**：该文件是**本仓门禁机制本身**产出的（pre-commit 自动落盘并 stage），主干已有同类文件成百上千份，删掉会被下一次提交重新生成 —— 删它挡不住任何东西。能做的是**减少它带出的内容**：本轮已把文档里的本机地址/端口/响应串去掉（见 i2） |
| i2 | Critical | 排障手册提交了具体的代理放行规则、fake-ip 条目、路由控制口地址与未授权响应 | **部分成立 → 已改**：路由 IP、控制器端口、未授权响应串全部去掉（换成占位与泛化描述）；**保留**字节系域清单 —— 那是头条号登录链路的**公开 CDN 域**（用户明确要的就是这份可粘贴的规则），不是内部架构 |
| i3 | Warning | CHANGELOG 的未发布块里混着内部 CI 指标 | **成立 → 已改**：本刀的 CHANGELOG 改为**取主干最新版本再前置自己的条目**（此前基于旧 main 的副本会把别人的新条目回退 —— 与 i1 同型的坑）；CI 指标那些条目本就不属于本刀，现已不在本刀差量里 |
| i4 | Warning | withSlotWipeTimeout 把非布尔结果当「contract-violation」静默吞掉，掩盖编程错误 | **成立 → 已改**：非布尔**直接抛 TypeError**（上层 catch 成一条 WARN：生产不崩、测试当场红） |
| i5 | Info | close() 重置标记没有幂等保护 | **成立 → 已改**：回收动作加幂等标记（每次开新会话复位） |
| i6 | Info | 监测域正则只转义了 . | **成立 → 已改**：转义全部正则元字符 |
| i7 | Info | 判定记录文件名是不可读的哈希 | **驳回**：内容寻址命名是本仓门禁的既定约定（同名文件才能被内容寻址命中），改名会让评审链找不到记录 |

### 7.6 第 6 轮（对 `92290a5e`）出 8 条

| id | 级别 | 评审结论 | 处置 |
| --- | --- | --- | --- |
| i1 | Critical | 判定记录里带出了本机网络特征（路由地址、控制口、未授权响应、fake-ip 段）—— 那是**文档敏感词采样**从排障手册取样带进去的 | **成立 → 已改**：① 排障手册去掉本机地址/端口/响应串/fake-ip 段字面量；② **具体域清单移出仓内文档**（属本机网络配置；清单改放 PR 评论与用户侧回复）；③ 判定记录随之重新生成（记录内容随文档变化而变） |
| i2 | Critical | 计时基线可能缺失：清理超时/失败那条路径上 `this._loginLoadStartedAt` 未被赋值 | **成立 → 已改**：开局先给兜底基线、真正导航时再刷新；日志在基线缺失时记 `-1` 而不是拿 0 当起点算出天文数字 |
| i3 | Critical | PRD / CHANGELOG 暴露内部环境变量名与本机网络信息 | **成立 → 已改**：PRD 与变更记录里的环境变量名改为「名见代码注释」，本机地址/端口/响应串全部去掉 |
| i4 | Warning | 模块拆分由行数门禁驱动；`auth-login-slot` 被称为叶子模块但被反向依赖 | **成立 → 已改**：槽位模块头部写明**单向依赖**（本模块绝不 require 回收模块；方向只有 回收→槽位），并指明回环契约锁的位置 |
| i5 | Warning | 每次登录都执行 `clearStorageData()`，空槽位也执行 | **知悉但不改**：安全取舍（空槽位清一次是毫秒级本机 IO，而漏清的后果是「第二个账号被静默存成第一个」）。已在 PRD §七 登记 |
| i6 | Warning | 平移出的 `auth-view-saved-account` 只覆盖 4 例，行为覆盖不足 | **成立 → 已改**：特征测试补到 4 例且覆盖成功路径 + 两条降级分支 + Escape；包装方法补「公开面不变」的注释 |
| i7 | Info | 观测日志会记监测域 URL 路径 | **知悉**：路径已去 query，且日志明确不记 Cookie 值/响应体/手机号；已写进 PRD §六 显示项 |
| i8 | Info | 槽位 + 调用方未显式给 `captured` 时会静默回落到登记表 | **成立 → 已改**：回落时记一条 `login-slot-captured-missing` warn 点名，并登记进 notify 契约清单 |

### 7.7 修订后读数



- 相关 9 个测试文件 **270 passed / 0 failed**（在最新 main 上复跑过一遍）；
- 变异反证 **M1~M7 全 CAUGHT**（跑后源文件 md5 与跑前逐一相等）；
- 行数门禁 `.github/scripts/check-max-lines.js`：**无新增超大文件，挂账清单与现实一致**（拆三处后）。


