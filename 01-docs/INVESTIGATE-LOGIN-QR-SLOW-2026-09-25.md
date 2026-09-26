# INVESTIGATE: 公众号登录页二维码「刷很久才显示」—— 排除项定案 + 出码计时插桩

> 日期: 2026-09-25 | 分支: `auth-qr-instrument` | 基点: origin/main `4f2cf3cf`→`4fbc1835`
> 性质: **诊断插桩**，行为零变更、零新增用户可见文案（locales zh/en 无变化）
> 同日相关链: BUGFIX-LOGIN-QR-STALE-COOKIE-2026-09-16.md（#1888）→ FEATURE-LOGIN-NETWORK-DIAG-2026-09-16.md（#1887）→ 本篇

---

## 1. 症状与入口

账号管理 → 「添加账号」选微信公众号 → 内嵌全屏登录标签加载 `https://mp.weixin.qq.com/` →
**二维码区域反复刷新，很久之后才显示出来**（不是「加载失败」，最终能出现）。

入口确认为 `mode='browser'` 的 `auth:open-login`，即 **AuthViewManager.openLogin** 路径。
这一条与 #1888 修的「打开登录页 / 批量登录」（`persist:account-*`）**不是同一条链路**。

## 2. 调用链（带行号）

```
Accounts.vue:796  addAccountForPlatform → selectedLoginMode='browser'
Accounts.vue:771  waitForAuthorizationGuide()（首次未确认时是硬阻断）
Accounts.vue:774  accountActions.openLogin → publisher.js:109 → preload/account.js:44
ipc-handlers/account.js:367  authViewManager.openLogin(platform)
auth-view-manager.js:248  accountId = `auth-${platform}-${Date.now()}`   ← 每次点击全新分区
auth-view-session.js:17   persist:auth-${accountId}（cache:true）
auth-view-session.js:186  createAuthView —— 未设 backgroundThrottling:false
auth-view-manager.js      loadURL(PLATFORM_LOGIN_URLS['wechat_mp'])
```

## 3. 已用实测排除的假设

| 假设 | 实测证据 | 结论 |
|---|---|---|
| **本机代理（Clash Verge 127.0.0.1:7897）拖慢微信链路** | CN 站点出口 IP 直连与走代理**完全相同**（111.167.202.75 天津联通）→ CN 规则命中 DIRECT；`tun.enable: false`，fake-ip 不在路径上 | ❌ 排除 |
| **代理隧道掐断二维码长轮询** | `l/qrconnect` hold 时长：走代理 **15.183s** vs 直连 **15.180s**，均返回 `wx_errcode=408`（微信「继续等」信令，本就 15s 一轮） | ❌ 排除 |
| **`res.wx.qq.com` 静态资源被代理拖慢** | 真实 200 资源：代理 33–100ms vs 直连 43–106ms。曾观测到 8–9s，A/B 复核确认只发生在 **404 路径**且直连同样 1–8s → 微信 CDN 对 miss 自身限速 | ❌ 排除 |
| **浏览器层差异（app 比 Chrome 慢）** | Edge headless 系统代理 vs 强制直连渲染登录页，**DOM 字节完全一致**（均 41788B） | ❌ 排除 |
| **#1888 旧身份 Cookie 导致 getqrcode 空体** | 本入口分区名带 `Date.now()`，每次点击都是**全新空分区**，结构上不可能携带 `wxuin` | ❌ 排除（且 #1888 的 cleanSession 本就未覆盖此路径） |
| **`networkidle` 30s 卡顿**（account-manager.js:115） | 该 Playwright 路径只被 `FirstRun.vue:216` 的 `account:add` 调用，账号管理页不走 | ❌ 排除 |

## 4. 剩余两个 app 侧嫌疑（本次插桩即为判定它们）

1. **一次性冷分区**：`auth-view-manager.js:248` 每次点击新建 `persist:auth-auth-<platform>-<ts>`，
   零 HTTP 缓存 / 零 TLS 会话复用，且全仓无 `persist:auth-*` 清理逻辑（仅
   `identity-auth-window.js:263` 清自己的），分区目录永久堆积。
2. **后台节流**：`createAuthView`（`auth-view-session.js:186`）未设 `backgroundThrottling:false`，
   而 `tab-lifecycle.js:107`、`rpa-view-session.js:30`、`playwright-manager.js:125` 三处都显式关了。
   若出码窗口落在视图 hidden 时段，iframe 定时器与重绘被节流。

## 5. 插桩内容与日志读法

### 5.1 补齐 #1887 §7 遗留项：auth 分区挂诊断

`auth-view-manager.openLogin` 在 `createSession` 之后、`loadURL` 之前挂
`attachLoginNetworkDiagnostics(authSession, { platform, accountId })`。
此前 `attachLoginNetworkDiagnostics` 全仓只有 `tab-lifecycle.js:43` 一个调用点，
只覆盖 `persist:account-*`，因此「添加账号」路径是**日志黑洞**。
挂接为旁路：try/catch 包裹，失败只 warn，不得成为新故障点。

### 5.2 出码计时（新增，`login-network-diagnostics.js`）

只跟踪 `getqrcode`（二维码字节本体的获取端点），**刻意不含 `l/qrconnect`**
——那是 15s 一轮的长轮询，计入会无限刷屏并掩盖「首码到底几秒到达」这个问题。

```
[LoginNetDiag] [wechat_mp/auth-wechat_mp-<ts>] qr response #1 after 8420ms status=200 contentLength=0
[LoginNetDiag] [wechat_mp/auth-wechat_mp-<ts>] qr response #2 after 11033ms status=200 contentLength=7632
```

- `after Nms`：相对**挂接点**（≈ loadURL 前一刻）的耗时
- `contentLength=0` + `status=200`：即 #1888 记录的微信**静默拒绝**特征
- `#n` 递增：反复刷新的次数本身就是症状
- 上限 6 条（`QR_IMAGE_LOG_LIMIT`），防长时间停留刷屏

### 5.3 首屏与可见性（`auth-view-manager.js`）

```
[AuthView] login page finished after 3120ms platform=wechat_mp visibility=visible
[AuthView] login view setVisible=false platform=wechat_mp visibility=hidden
```

### 5.4 判定规则（复现后按日志读）

| 观察 | 结论 | 对应修法 |
|---|---|---|
| `login page finished` 很快（<1.5s）但 `qr response #1` 在 8s+ | 首屏不慢，**出码迟到** | 查 `#n` 与 `contentLength`；=0 则属服务端拒绝方向 |
| `qr response #1 after` 小但 `contentLength=0`，之后多次 #n 才出真码 | 身份/会话被服务端静默拒绝（#1888 同族） | 登录视图也走干净会话/清 Cookie |
| 出码窗口内出现 `setVisible=false visibility=hidden` | **后台节流**成立 | `createAuthView` 补 `backgroundThrottling:false` |
| 第二次点击（本应仍冷）与首次耗时一致，且 `login page finished` 就慢 | 冷分区成本成立 | 分区改稳定复用名 + 生命周期清理 |

复现取证命令：

```bash
grep -E "LoginNetDiag|login page finished|login view setVisible" \
  "$LOCALAPPDATA/Temp/multi-publish-logs/app-$(date +%F).log"
```

## 6. QM-5 五步

| 步骤 | 内容 |
|---|---|
| ① 根因溯源 | 追溯到 `d28cabaa`(#1887) 引入诊断时把 auth 分区挂接列为「未来扩展」未做；`645b8668` 把认证视图改内嵌时未沿用 tab-lifecycle 的 `backgroundThrottling:false` |
| ② 逃逸链 | **单元测试**：无「auth 分区是否挂上诊断」的断言，`auth-view-manager.test.js` 从未断言可观测性 → 缺口不可见；**集成/E2E**：登录页二维码是第三方 iframe，无任何用例；**视觉回归**：只比对外层 DOM，二维码 iframe 迟到表现为「空白区域」，基线对比不判失败；**代码审查**：QM-2 清单无「登录视图分区可观测性/节流口径」条目 |
| ③ 系统性漏洞 | 类型=**流程缺失 + 测试场景缺失**。新链路（`persist:auth-*`）接入时，既有观测机制默认「沿用」，实际从未验证；三处 `backgroundThrottling:false` 与一处缺失并存，说明该口径无单一来源 |
| ④ 回归保护 | `auth-view-manager.test.js` 新增 4 例（诊断挂接+filter 精确断言、首屏耗时+可见性、可见性切换、挂接失败不阻断）；`login-network-diagnostics.test.js` 新增 5 例（出码计时格式、200 空体特征、无响应头边界、6 条上限与序号序列、长轮询不刷屏）。均走真实诊断模块，仅 electron 被桩替 |
| ⑤ 预防措施 | 见 §8 |

## 7. 测试桩变更（需注意）

`test-setup.js` 的 `session.fromPartition` 原为**恒返回同一个 `defaultSession`**。
诊断模块的幂等标记写在 session 实例上（`ses.__loginNetDiagAttached`），
共享单例会让「监听注册恰好一次」的断言依赖用例顺序 —— 属假红/假绿温床。
改为每次返回新 session 对象（贴近真实 Electron：分区即独立 session），
并补 `webRequest`/`resolveProxy` spy 容器与 `getVisibilityState`。
经确认仓库内 0 个测试引用 `defaultSession`，该改动无既有依赖。

## 8. 预防措施落地

- [ ] `AGENTS.md` QM-2 增条目：**新增登录承载方式必须同步挂 `attachLoginNetworkDiagnostics`，
      并显式声明 `backgroundThrottling` 取值**（口径要求见 §4.2）
- [ ] `01-docs/learnings.md` 记录 pitfall：诊断类旁路机制被标注为「未来扩展」时，
      必须在同一 PR 覆盖全部承载路径，否则新路径长期是日志黑洞
- [ ] 全量单测纳入 CI（既有 vitest 流水线自动覆盖新增用例）

## 9. 未覆盖 / 边界

- 本机无已登录 profile，无法在此复现「真实出码」，本文判定规则待应用侧复现后回填。
- `waitForAuthorizationGuide`（`Accounts.vue:771`）在首次未确认授权指引时会**硬阻断**登录视图创建，
  用户感知也可能是「很久才出来」——属另一条独立成因，本次未插桩。
- `qrcode-login.js`（对话框「扫码」模式）未改动：本次入口不涉及，避免扩大爆炸半径。
  该路径另有 `did-finish-load` 后才开始检测 + 2s 轮询无首扫的结构性延迟。

---

## 10. 真机首次取证结果（2026-09-26，插桩上线后）

插桩随 `#2394`（squash `48ffcafc`）进 main 后，`mp-app-live` 实例（11:52 启动）产出第一条真实数据：

| 时间 (UTC) | 事件 |
|---|---|
| 03:53:52.620 | `auth:open-login enter platform=wechat_mp` |
| 03:53:52.634 | `LoginNetDiag ... proxy for open.weixin.qq.com → PROXY 127.0.0.1:7897` |
| 03:53:53.280 | `AuthView login page finished after 656ms` |
| 03:53:53.694 | `LoginNetDiag ... qr response #1 after 1072ms status=200` |

**结论一：本次不慢。** 首屏 656ms、二维码字节 1072ms 到达 → §4 的两个 app 侧嫌疑（冷分区、后台节流）在该次复现中都不成立；按 §5.4 判定表属于「首屏与出码都快」一档。

**结论二：修正 §3 的代理表述。** 应用内 auth 分区解析出的代理是 `PROXY 127.0.0.1:7897`，即 **Clash Verge 确实在路径上**；此前"CN 出口 IP 与直连相同"证明的是它对 CN 域名**直通**，不等于"不在路径上"。定性不变（未增加可测延迟），措辞以本节为准。

**结论三：「刷了很久」的观感来源另有其项。** 该次登录窗口内每约 5 秒重复一轮失败请求，全部是微信登录页**自身探测本机微信 PC 客户端**：

```
https://localhost.weixin.qq.com:13013|13014|13015|14013|14014|14015/api/check-login
https://support.weixin.qq.com/cgi-bin/mmsupportmesh
https://mp.weixin.qq.com/mp/fereport?action=csp_report
```

6 个端口逐个试、失败即重来，页面在此期间持续转圈。属微信页自身行为，应用侧无法改变，也不应为此改代码。

**结论四：本次修复的由来。** 同一行里的 `visibility=unknown` 暴露出 §4.2 的探针读的是宿主上不存在的 `getVisibilityState()`（Electron 43 d.ts 中出现 0 次），故节流维度**当时无法判定**；已由 `auth-login-visibility-fix` 改为 `drawn=` / `bgThrottle=` 并补三条宿主 API 归属契约锁（详见 CHANGELOG 同节与 learnings `dead-probe-green-mock-blindness`）。§4.2 在拿到新数据前保持未决。

**读日志的正确姿势（补 §5.4）**：判定"慢不慢"只看 `login page finished after Nms` 与 `qr response #1 after Mms` 两个数；`localhost.weixin.qq.com` 的批量失败是微信自身探测，不要当成本应用的故障。日志落在 `D:\tmp\Multi-Publish-debug-profile\logs\app-YYYY-MM-DD.log`（调试 profile），而 `%LOCALAPPDATA%\Temp\multi-publish-logs\` 那份是**单测**写的，二者不要混。
