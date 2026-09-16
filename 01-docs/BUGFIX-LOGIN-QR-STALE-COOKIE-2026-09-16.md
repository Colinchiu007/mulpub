# BUGFIX: 登录页必须以干净会话打开（失效账号旧 Cookie 导致微信二维码加载失败）

> 日期: 2026-09-16 | 分支: `fix-login-clean-session` | 基点: main `909e391`
> 同日排查链: BUGFIX-LOGIN-CHECK-FALSE-EXPIRED-2026-09-16.md（横幅误报）→ FEATURE-LOGIN-NETWORK-DIAG-2026-09-16.md（诊断日志）→ 本篇（真因修复）

---

## 1. 问题现象

应用内【批量登录】打开微信公众号登录页（https://mp.weixin.qq.com/）：**外层页面正常渲染，二维码位置显示「二维码加载失败」，点击刷新无效**。同一 URL 在 Chrome 浏览器打开，二维码正常出现（略慢）。

## 2. 根因（CDP 活体取证定案，证据链完整）

### 2.1 排除过程（对运行中实例 CDP attach，端口 `--remote-debugging-port`）

| 探测 | 结果 | 结论 |
|---|---|---|
| 全部请求 remoteIPAddress | `117.185.x` / `111.32.x` 等微信真实 IP，直连 h2，全 200 | ❌ 排除网络/代理 |
| UA + Client-Hints **全套**伪装成 Chrome 150 后刷新 | 仍失败，getqrcode 仍空体 | ❌ 排除 UA 指纹 |
| `bizlogin?action=startlogin` | 200，`{"ret":0,"uuid":"1a81df..."}` 正常发 uuid | 会话建立正常 |
| `Storage.getCookies`（不带 browserContextId） | 返回 0 | **误报**：它查的是默认上下文，查分区必须用 `Network.getCookies(urls)` |
| `Network.getCookies(urls)` 正确枚举 | **8 个 Cookie**：`wxuin`（微信账号标识）、`ua_id`、`xid`、`mm_lang`（exp 2027）、`uuid`（session）等 | ✅ 元凶 |
| `scanloginqrcode?action=getqrcode` | **HTTP 200 + 空响应体**（真码 ~7.6KB）；页面因此显示「二维码加载失败」并把 iframe 缩为 0x0 | 服务端静默拒绝 |
| **`Network.clearBrowserCookies` 全清后刷新** | getqrcode 返回 **7632 字节**，`hasQrFailText:false`，二维码立即出现 | ✅ **定案** |

### 2.2 根因机制

【批量登录】/【打开登录页】的设计是「自动恢复该账号保存的 Cookie」（免登录）。但对**已失效**账号，恢复的恰是失效的身份 Cookie（`wxuin` 等，有效期 2027 年）——微信服务端校验「身份 Cookie ↔ 登录态」不一致，在二维码获取环节**返回 200 空体**（无错误 JSON、无跳转），页面 JS 拿不到二维码数据 → 显示「二维码加载失败」。Chrome 是干净 profile、无这套 Cookie，故正常。

> 教训：**恢复 Cookie 的免登录设计，对「登录已失效」的账号恰好是反效果**——登录页需要的是干净身份，不是旧身份。

### 2.3 请求链路（失效账号 + 旧 Cookie 时的实际表现）

```
GET mp.weixin.qq.com/                              → 200（外层正常渲染）
GET /cgi-bin/bizlogin                              → 200 ok
GET /cgi-bin/bizlogin?action=startlogin            → 200 {"ret":0,"uuid":"..."}   ← 会话建立正常
GET open.weixin.qq.com/cgi-bin/mpqrconnect          → 200（但返回本地客户端探测桩页，非二维码页）
GET /cgi-bin/scanloginqrcode?action=getqrcode      → 200 + 空体  ← 服务端静默拒绝（携带 wxuin）
GET res.wx.qq.com/.../default_qrcode_2x.png        → 200（占位图，页面降级）
→ 页面判定二维码加载失败，iframe 缩为 0x0
```

## 3. 修复方案

### 3.1 设计

**登录页 = 重新认证场景，失效账号一律以干净会话打开**：跳过凭证恢复 + 清空分区残留 Cookie。active 账号行为完全不变。

新增透传选项 `cleanSession`：渲染端 `tabStore.createTab({ ..., cleanSession: true })` → 既有 IPC `page-manager:create-new-tab-page` **payload 整体透传**（零契约变更、零 preload 改动）→ `createNewTabPage(opts)`。

### 3.2 改动明细

**① `electron/services/webview-manager.js`（createNewTabPage）**

- 新增 `cleanSession` 选项（仅 `useAccountSession` 时生效）：
  - **跳过凭证 Cookie 恢复**（credCookies 注入循环整体门控）
  - **跳过凭证 localStorage 恢复**（旧 localStorage 同样可能让平台按已登录态走异常流程）
  - **清空分区残留 Cookie**：`cookies.get({})` → 逐个 `cookies.remove(url, name)`；清除 Promise 挂入 `cookieRestorations`，由 `navigateAfterCookies` 等待——**保证清空在首个导航请求前完成**
  - 日志：`[platform:accountId] clean login session: skipped credential restore, cleared N stale cookies`
- 调用方显式提供的 `opts.cookies` 不受影响（显式意图优先）。

**② `src/views/Home.vue`（handleBatchLogin）**

- 批量登录目标全部是失效账号 → `createTab({ ..., cleanSession: true })`。

**③ `src/views/Accounts.vue`（openLoginPage）**

- 账号管理页「打开登录页」：`cleanSession = account?.status === 'expired'`——失效账号干净会话；有效账号仍恢复 Cookie（保留免登录便利）。

### 3.3 闭环说明

干净会话登录成功后，标签页**关闭时回写**机制（既有：关闭账号标签把 session Cookie 写回加密凭证库）会把扫码登录后的新 Cookie 保存 → 下次 `checkLocalCredentials` 命中 → 账号自愈。无需额外改动。

## 4. 数据校验

| 环节 | 校验 | 说明 |
|---|---|---|
| `cleanSession` 透传 | 仅 `=== true` 生效；非账号分区（`useAccountSession=false`）无意义（browse 分区本就全新） | 防脏值 |
| Cookie 清除 | `cookies.remove(url, name)` 逐个构造 url（secure→https、domain 去前导点、path 兜底 `/`）；单条失败静默 catch 不阻断 | 与主流程隔离 |
| 清除时机 | 挂入 `cookieRestorations`，`Promise.all` 后才 `loadURL` | 保证先清后导航 |
| 凭证库 | **不动**：旧凭证仍保留（清 Cookie 只影响本次登录页会话；登录成功后由关闭回写覆盖） | 可回滚 |

## 5. 流程（修复后）

```
批量登录（失效账号）/ 账号管理页打开登录页（status=expired）
  → createTab({..., cleanSession: true})
  → IPC page-manager:create-new-tab-page（payload 透传）
  → createNewTabPage:
      useAccountSession && cleanSession
        ├─ 跳过凭证 Cookie/localStorage 恢复
        ├─ 清空分区残留 Cookie（get → remove 逐条）
        └─ 清空完成后才加载登录 URL
  → 平台登录页以干净身份加载 → 二维码正常出现
  → 用户扫码登录 → 关闭标签 → 新 Cookie 回写凭证库 → 账号自愈
```

## 6. 交互逻辑 / 显示项 / 提示文字

- **零 UI 新增、零文案变更**（zh/en 无变化）：登录页本身是平台页面；「已失效」横幅与账号卡片行为不变
- 用户可感知变化：失效账号打开登录页后**二维码能正常出现**（此前空白报错）；有效账号打开登录页仍自动免登录进入
- 日志可观测：`WebviewManager` tag 输出 clean session 行为与清除数量；`LoginNetDiag`（#1887）持续记录登录页网络细节

## 7. 测试

### 7.1 单元测试（webview-manager.test.js 37→40 例，全绿）

| 新增用例 | 断言 |
|---|---|
| cleanSession:true 跳过凭证 Cookie 并清空残留 | `setCalls == []`；`removeCalls` 覆盖全部残留（wxuin/ua_id）；`loadURL` 在清除后执行 |
| cleanSession:true 跳过 localStorage 恢复 | `executeJavaScript` 不含旧 token |
| 未传 cleanSession 回归保护 | 凭证照常恢复、`removeCalls == []` |

Home.test.js 批量登录用例断言扩展：`createTab` 收到 `cleanSession: true`。合计 **63/63 全绿**（双跑）。

### 7.2 静态门禁

- eslint 5 个改动文件 **0 error**（存量风格 warning 不变）
- `check-locale-sync --cjk` PASS（1410 < 基线 1644，无新增硬编码中文）
- 无 i18n 键/新增 IPC 通道/preload 变更 → 契约门禁 4 处连锁零涉及

## 8. 手动验证（用户侧）

重启应用（或 dev 重载主进程）→ 主页横幅【批量登录】→ 微信登录页二维码应正常出现 → 扫码 → 关闭标签 → 账号管理页该账号恢复「已登录」。

## 9. 已知边界

- 账号管理页「打开登录页」对 **status 恰为 active 但实际已死**的账号不启用干净会话（沿用免登录恢复）——这类账号的状态会被 30 分钟周期检测/一键检测修正为 expired，之后自动进入干净会话路径
- 一次性实验（CDP 清 Cookie）已让当前打开的登录页出码，无需用户额外操作

## 10. QM-5 五步（Bug 反思循环）

| 步骤 | 内容 |
|---|---|
| 根因溯源 | CDP 活体取证：直连全 200 + getqrcode 空体 + 分区 8 个陈旧身份 Cookie + 清除后立即出码 |
| 逃逸分析 | 无任何测试覆盖「失效账号打开登录页」场景；恢复 Cookie 的行为从未被质疑 |
| 系统性漏洞 | 「恢复 Cookie」对所有平台登录页生效——微信已证实，其他平台（抖音 creator 等）登录页同样可能被旧身份 Cookie 干扰；cleanSession 是通用机制，可按需扩大使用面 |
| 回归测试 | 3 个新用例 + Home 断言扩展，40+23=63 例全绿双跑 |
| 预防措施 | 判定语义写入代码注释 + 本文档作为权威参考；FEATURE-LOGIN-NETWORK-DIAG 的 LoginNetDiag 日志持续观测 |
