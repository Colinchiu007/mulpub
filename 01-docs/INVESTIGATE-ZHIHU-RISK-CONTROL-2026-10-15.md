# 知乎「网络环境或行为异常」短信验证 — 根因分析与可解决性评估

> 版本：v2.0（2026-10-15）｜ **v2.0 为实测修正版**，v1.0 的部分推断被真机对照证伪，见 §3.0
> 触发场景：应用内点击已保存账号 → 打开知乎平台页面 → 浏览 → 知乎提示「你的网络环境或行为异常」，要求短信验证才能继续
> 修复 PRD：`01-docs/PRD-BROWSER-STEALTH-MAIN-WORLD-2026-10-15.md`
> 原始取证：`01-docs/evidence/zhihu-stealth-mainworld-2026-10-15/`

---

## 1. 结论摘要

| 问题 | 结论 |
|------|------|
| **是否是应用的锅？** | **部分是。** 应用内嵌浏览器有 2 个独立的应用侧缺陷（通道错误 + 接线缺失），修好后**仍有 4 项实测确认的指纹异常**已在本片修掉。但**指纹不是唯一原因**。 |
| **是否与路由器 openclash VPN 有关？** | **高度相关，可能单独就足以触发。** 提示语前半句「网络环境」直接指向 IP 维度；代理出口 IP 与账号历史登录地不符是平台风控的经典判据。 |
| **能不能解决？** | **应用侧可显著改善（本片已做），网络侧可修（用户配置），平台侧不可控。** 见 §5。 |

---

## 2. 复现路径与代码定位

```
Accounts.vue 卡片「创作者中心」
  └─ openCreatorCenter(account)                       [apps/desktop/src/views/Accounts.vue:1160]
       └─ url = PLATFORM_CREATOR_HOME_URLS.zhihu || PLATFORM_DASHBOARD_URLS.zhihu
              → 知乎未登记 CREATOR_HOME ⇒ 回退 'https://www.zhihu.com/'   [packages/shared-utils/src/platform-definitions.js:41]
       └─ tabStore.createTab({ url, platform:'zhihu', accountId, title })  [apps/desktop/src/stores/tab.js:255]
            └─ page-manager:create-new-tab-page                             [webview-manager/ipc-handlers.js:26]
                 └─ WebviewManager.createNewTabPage(opts)                   [webview-manager/tab-lifecycle.js:24]
                      ├─ session.fromPartition('persist:account-<id>', {cache:true})
                      ├─ 凭证 Cookie / localStorage 恢复
                      └─ new WebContentsView({ preload, contextIsolation:true, sandbox:true, … })
```

**关键定位**：账号标签的 preload 是 `monitor-preload.js`（只暴露两个只读 IPC），
`stealth-preload.js` 只在 RPA 发布窗口被引用——**用户「点开账号浏览」这条最高频路径从未接入反检测**。

---

## 3. 应用侧：实测对照（v2.0 的核心修正）

### 3.0 v1.0 被证伪的推断（如实记录）

v1.0 在**未做真机对照**的情况下按通用风控经验列了 5 项「疑似指纹」，2026-10-15 用真实 Electron 43.7.7
与真实 Chrome 155（同机、同 GPU、同时段）逐项对照后，**三项被证伪**：

| v1.0 的推断 | 实测结果 | 性质 |
|------------|---------|------|
| 「`navigator.plugins` 为空是极高权重指纹」 | Electron **已是 5 项且名称与 Chrome 逐字相同** | ❌ 证伪 |
| 「WebGL 软件渲染/SwiftShader 是强指纹」 | 同机同 GPU 下取值**与真实 Chrome 完全一致** | ❌ 证伪 |
| 「`window.outerWidth/Height` 比例异常」 | Electron 报有效值；Chrome 无头态报 `0/0`，**不可比** | ❌ 无法成立 |
| 「`navigator.webdriver` 需处理」 | 两边都是 `false` | ❌ 无需处理 |
| 「`chrome.runtime` 缺失是异常」 | 真实 Chrome 在普通网页上**也是 `undefined`** | ❌ 证伪 |

**更严重的连带发现**：既有 `stealth-preload.js` 若通道修好反而会**加重破绽**——
它把真实的 5 个插件换成含 `Native Client` 的 3 项假列表（现代 Chrome 早已移除 Native Client）、
凭空造 `chrome.runtime`、强行覆盖 `navigator.languages` 与 `clipboard-read` 权限。
即：**「没做对照就补」本身就是缺陷来源**。

### 3.1 🔴 缺陷 D1：反检测脚本全部不达主世界（存量）

`contextIsolation:true` 下 preload 运行在**隔离世界**，其中 `delete navigator.__proto__.webdriver` /
`Object.defineProperty(navigator,'plugins',…)` 改的是隔离世界的原型，页面主世界毫无感觉。

- 文档已记录：`01-docs/PRD-OSS-RPA-HARDENING-2026-10-14.md` §3.1 E4b（`preloadRanSeenInMain: null`）
- 本机复测一致：`isoMarkerVisibleInMain: "undefined"`（见 `01-docs/evidence/…/injection-channel-raw.txt`）

### 3.2 🔴 缺陷 D2：账号标签根本没挂反检测

见 §2。`tab-lifecycle.js` 的 `viewWebPreferences.preload` 指向 `monitor-preload.js`。

### 3.3 🔴 实测确认的指纹异常（本片已修）

| 信号 | Electron 实测 | 真实 Chrome 实测 | 为何是异常 |
|------|--------------|-----------------|-----------|
| `Object.keys(window.chrome)` | `[]` | `['loadTimes','csi','app']` | 空对象等于宣告"我不是 Chrome"；`chrome.csi()` 缺失还会让部分站点直接抛错 |
| `navigator.userAgentData.brands` | 缺 `Google Chrome` | 含 `Google Chrome` | 品牌列表缺自家品牌，一行 `some(b=>b.brand==='Google Chrome')` 即识破 |
| `Notification.permission` | `granted` | `default` | "所有权限已授予"对全新站点在任何真实浏览器上都不可能 |
| `permissions.query(notifications/geolocation/camera/microphone/clipboard-read)` | 全 `granted` | 全 `prompt` | 同上，且是**系统性**异常（5/5 项） |

### 3.4 ✅ 已由既有代码修好（本片仅补真机证据）

UA 净化的 A/B 实测（`--probe-no-ua-sanitize` 对照）：

```
净化前：… Chrome/150.0.7871.250 Electron/43.7.7 Safari/537.36
净化后：… Chrome/150.0.7871.250 Safari/537.36
```

`configureUserAgentFallback`（`startup-compat.js:161-186`）确实生效——此前它曾因读错宿主属性
（`app.userAgent` 不存在，Electron 只在 `WebContents` 上有）而**从未执行过一次**（`learnings.md:1497`）。
本片把它从"单测绿"升级为"真机 A/B 有证据"。

### 3.5 ⛔ 刻意不碰的项

`webdriver` / `plugins` / `mimeTypes` / `pdfViewerEnabled` / `vendor` / `hardwareConcurrency` /
`deviceMemory` / WebGL / `chrome.runtime`——与真实 Chrome 一致。`evasions.test.js` 有反向锁防止后人改坏。

---

## 4. 网络侧：openclash VPN 的关系分析

### 4.1 结论：**高度相关，可能单独触发**

提示语原文「你的**网络环境**或行为异常」前半句即 IP 维度。

| 风险点 | 说明 | 权重 |
|--------|------|------|
| 出口 IP 与账号历史登录地不符 | 账号通常在国内住宅 IP 下登录；openclash 若把 `zhihu.com` 分流到境外节点，出口 IP 归属地突变 | 🔴 极高 |
| 机房/IDC IP 段 | 常见节点是 VPS 机房 IP，各平台普遍对其降权 | 🔴 极高 |
| 多账号共享同一出口 | 路由器代理是**全局**的：本机所有账号、家里所有设备都走同一出口 IP，可能触发"账号矩阵"关联 | 🟠 高 |
| 代理出口 TLS 指纹与 IP 归属不一致 | 服务端可见 JA3 | 🟡 中 |
| 节点切换导致会话内 IP 变化 | 负载均衡/故障转移 | 🟡 中 |
| DNS 泄露/污染 | DNS 解析 IP 与连接 IP 不一致 | 🟡 中 |

### 4.2 判定方法（A/B，各做 ≥3 次）

| 实验 | 操作 | 判定 |
|------|------|------|
| **A** | openclash 把 `zhihu.com` / `www.zhihu.com` / `static.zhihu.com` 加入**直连**（或临时关闭），应用内重开知乎账号标签 | 不再提示 ⇒ **主因是 VPN** |
| **B** | openclash 保持开启，用**系统安装的 Chrome/Edge** 登录同一账号浏览 | Chrome 也提示 ⇒ **主因是 VPN**；Chrome 正常 ⇒ 主因在应用侧指纹 |
| C | 观察应用日志中 `attachLoginNetworkDiagnostics` 的 `resolveProxy` 结果 | 透明代理下通常显示 `DIRECT`（应用感知不到路由器层代理），故**不能**用 C 替代 A/B |

**A/B 各 5 分钟，就能把嫌疑收敛到主要方向。** 注意：本片修的是应用侧指纹，若 A 实验证明主因是 VPN，
仍需单独调整 openclash 分流（属用户侧配置，非代码）。

---

## 5. 可解决性评估

| 层 | 问题 | 可解决性 | 状态 |
|----|------|---------|------|
| 应用层 | 反检测不达主世界（D1） | ✅ 完全可解决 | **本片已修**（`webFrame.executeJavaScriptInIsolatedWorld(0,…)`） |
| 应用层 | 账号标签未接线（D2） | ✅ 完全可解决 | **本片已修** |
| 应用层 | 4 项实测指纹异常（§3.3） | ✅ 完全可解决 | **本片已修**，A/B 实测与 Chrome 一致 |
| 应用层 | UA 净化 | ✅ 已有且生效 | 本片补真机证据 |
| 应用层 | 权限**实际授予**收紧 | 🟡 可解决但需独立取证 | 未做，见 PRD §9.3/§12 |
| 应用层 | `navigator.languages` | 🟡 需先取证语言配置链 | 未做，见 PRD §9.2 |
| 应用层 | `Sec-CH-UA` 请求头 | 🟡 需抓包取证 | 未做 |
| 网络层 | openclash 出口 IP | ✅ 可解决 | **用户侧配置**（知乎域名走直连） |
| 平台层 | 知乎风控策略 | ❌ 不可解决 | 持续对抗；任何方案都有失效周期 |

### 5.1 残留风险（不假装已闭合）

1. **本片只改报告值，未收紧实际权限授予**：报告 `prompt`，页面真去请求仍可能拿到。
   仅当页面「主动请求并比较返回值」时可观测。
2. **平台风控不可控**：若账号已被历史标记，即使环境全修好也可能仍需一次短信验证。
3. **单次现象**：用户报告是一次观测，未做重复实验；A/B（§4.2）应各做 ≥3 次。

---

## 6. 待取证项

1. 知乎具体采集哪些指纹字段——未对 `zse-asset/v4/main.js` 做逆向，§3.3 的排序是「实测差异 + 通用实践」的推断。
2. `Sec-CH-UA` 请求头品牌列表是否缺失/异常。
3. 应用是否真的走了路由器代理（透明代理下应用层 API 看不出来，需抓包看真实出口 IP）。
4. `navigator.languages` 在 Electron 的取值链（为何是 `zh-Hans-CN` 而非 `zh`）。

---

## 7. 附录：关键代码位置

| 文件 | 说明 |
|------|------|
| `electron/stealth/evasions.js` | evasion 源码 + 实测对照表（v2.0 结论的落点） |
| `electron/stealth/inject.js` | 主世界注入通道 + 开关 + 三态读回 |
| `electron/core/preload-path.js` | sandbox preload「bundle 优先」解析 |
| `electron/monitor-preload.js` | 浏览/账号标签 preload（注入 + 受限桥） |
| `electron/stealth-preload.js` | RPA 窗口 preload（装载器；已删除有害补丁） |
| `electron/services/webview-manager/tab-lifecycle.js` | 标签创建（preload 接线点） |
| `electron/services/rpa-view-session.js` | RPA 建窗（preload 接线点） |
| `apps/desktop/scripts/probe-main-world-injection.js` | 通道 + 指纹取证 harness |
| `apps/desktop/scripts/probe-browser-fingerprint.js` | 生产 preload A/B 验收 harness |
| `electron/services/startup-compat.js` | UA 净化（已生效，本片补证据） |
| `01-docs/PRD-OSS-RPA-HARDENING-2026-10-14.md` | §3.1 注入通道 spike（D1 的原始记录） |
| `01-docs/learnings.md` | UA 净化读错宿主属性的逃逸教训 |
