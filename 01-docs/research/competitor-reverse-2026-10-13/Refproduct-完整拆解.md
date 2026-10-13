# 参考产品 4.0 完整拆解报告

> 目标：`D:\Program Files\refproduct\参考产品4.0.exe`（196.4 MB）+ `resources\app.asar`（9.5 MB）
> 分析工具：REA 6.4.0（`analyze-javascript-application` / `extract-artifact`）+ 自研拆解脚本
> 分析日期：2026-10-13
> 结论依据：asar 完整解包（44 文件 / 9.5 MB 稳定副本于 `analysis/refproduct-asar/`）

---

## 0. 一句话结论

**参考产品是一个「浏览器外壳 + 平台内嵌页 + 本地签名」的多平台分发工具。**
它的技术护城河不在架构（Electron 标准架构），而在 **36 个平台的本地签名实现** 与
**CDP 响应体拦截**这两套对抗平台改版的手段。

---

## 1. 基本信息

### 1.1 二进制

| 项 | 值 |
|---|---|
| exe 大小 | 205,909,632 字节（196.4 MB）|
| SHA-256 | `fa6d1b485a4a8671e52958bd8200b5c19410e17f346e36812ef939d6e5d1540c` |
| PE 格式 | PE32+（x64，`0x8664`）|
| 段数 | 14 |
| `.text` | **165,480,636 字节（165.5 MB）** |
| 特殊段 | **`LZMADEC` / `malloc_h` / `prot` / `CPADinfo` / `_RDATA`** |
| 保护 | **LZMA 自解压壳**（导入表不可读）|
| Go 构建信息 | 无（非 Go 程序）|

> **exe 里没有业务代码**：165 MB 的 `.text` 是压缩后的 Electron 运行时。
> 业务代码全部在 `resources/app.asar`（9.5 MB）。

### 1.2 应用元数据（来自 asar 内 `package.json`）

```json
{
  "name": "refproduct",
  "productName": "参考产品4.0",
  "version": "4.14.20",
  "main": "packages/main/dist/index.cjs"
}
```

**依赖清单**（体现技术选型）：

| 依赖 | 版本 | 用途 |
|---|---|---|
| `react` / `react-dom` | 19.1.0 | 渲染层 |
| `socket.io` / `socket.io-client` | 4.8.1 | **实时通信**（主进程与渲染层/服务端）|
| `axios` | 1.x | HTTP |
| `zod` | 4.3.5 | 运行时校验 |
| `dayjs` | 1.x | 日期 |
| `@hello-pangea/dnd` | 18.x | 拖拽（标签/分屏排序）|
| `lucide-react` | 0.517 | 图标 |
| `nanoid` | 3.x | ID 生成 |
| `lodash.debounce` / `lodash.throttle` | — | 防抖节流 |
| `tailwind-merge` | — | Tailwind 类名合并 |

`pnpm.onlyBuiltDependencies` 含 `@nestjs/core`、`tos-crc64-js`
→ 说明服务端用 NestJS、且用到**字节跳动的 CRC64**（用于 OSS/TOS 上传校验）。

### 1.3 目录结构

```
resources/app.asar (9.5 MB)
├── package.json
├── packages/
│   ├── main/dist/index.cjs          7.1 MB / 108,243 行 / 566 webpack 模块
│   ├── preload/dist/index.cjs       2.5 KB（完整 IPC 契约）
│   └── renderer/dist/               9 个 HTML 窗口 + React 打包产物
└── client-dist/
    ├── socket.io.js / .min.js / .esm.min.js / .msgpack.min.js
    └── 对应的 .map 源映射
```

---

## 2. 架构总览：它其实是个「浏览器」

### 2.1 关键证据：渲染层的中文字符串

渲染层主包 `main-BTf-V4ZI.js`（124.7 KB）**只包含 17 条中文**，全部是浏览器操作：

```
保存账号 | 更新账号 | 复制当前 | 复制失败 | 更多 | 更新
关闭标签页 | 新建标签页 | 后退 | 前进 | 刷新
恢复为普通标签页 | 切换垂直标签栏 | 切换水平标签栏
收藏 | 搜索或输入网址
```

**这不是一个表单式应用，而是一个浏览器外壳。** 用户在应用内直接打开平台网站、
登录、浏览、发布；应用在外层提供标签页/分屏管理与自动化注入。

### 2.2 视图技术

| API | 出现次数 | 说明 |
|---|---|---|
| `WebContentsView` | 3 | **现代 Electron 视图 API** |
| `BrowserView` | 5 | 旧 API 残留 |
| `contentView` | 15 | 视图容器 |
| `webContents` | **285** | 核心操作对象 |
| `executeJavaScript` | **38** | 脚本注入 |
| `fromPartition` | 3 | 会话隔离（账号隔离）|
| `session.` | 48 | 会话操作 |
| `setBounds` / `setVisible` | 4 / 1 | 布局与显隐 |

**评估**：已迁移到 `WebContentsView`（Electron 30+ 的推荐方案），但仍有 `BrowserView` 残留。
本项目 `apps/desktop/electron/services/webview-manager/` 同样用 `WebContentsView`，
且额外实现了 **overlay view suspension**（浮层互斥挂起）——本项目更完整。

### 2.3 多窗口架构：9 个独立窗口

| 窗口 | `<title>` | 入口 JS | 用途 |
|---|---|---|---|
| `index.html` | （空）| `main-BTf-V4ZI.js` | 主窗口（标签页 + 分屏浏览器）|
| `collect.html` | **加载错误** ⚠️ | `collect-CRh-pEpX.js` | 采集窗口 |
| `error.html` | 加载错误 | `error-DSGktFUz.js` | 错误页 |
| `notice.html` | （空）| `notice-3DOZPZSS.js` | 通知窗口 |
| `online.html` | 在线状态 | `online-D5HJKZAH.js` | 在线状态指示 |
| `placeholder.html` | 新标签页 | `placeholder-C3yQyJfc.js` | 新标签占位 |
| `splitPlaceholder.html` | 新标签页 | `splitPlaceholder-BzUxLLqP.js` | 分屏占位 |
| `tool.html` | **Tool** ⚠️ | `tool-BHbYCDPK.js` | 工具页 |
| `update.html` | **Tool** ⚠️ | `update-BtqyzxYt.js` | 更新页 |

**每个窗口都是独立的 React SPA**，统一声明 CSP：
```html
<meta content="script-src 'self' blob:" http-equiv="Content-Security-Policy" />
```

**评估**：`script-src 'self' blob:` 阻止内联/外部脚本，是合理加固；
但未见 `object-src` / `base-uri` / `frame-ancestors`，属**部分加固**。

---

## 3. IPC 契约

### 3.1 preload 暴露的完整接口（`packages/preload/dist/index.cjs`，2.5 KB）

**4 个枚举，25 + 6 + 3 + 3 个成员**：

```javascript
// ① 事件通道（2）
shortcutKeyRegisterFailed = "SHORTCUTKEYREGISTERFAILED"
autoUpdate                = "AUTOUPDATE"

// ② 业务类型（3）
Voice = "voice" | Preview = "preview" | Forward = "forward"

// ③ IPC 通道（6）
WindowMaximize           = "ipc-window-max-and-min"
Public                   = "ipc-public"
RenderScreenshotsSrouce  = "render-screenshots-source"   ← 原文拼写 Srouce（Source 拼错）
Notice                   = "ipc-notice"
NoticeClick              = "ipc-notice-click"
NoticeRender             = "ipc-notice-render"

// ④ 窗口控制（3）
WindowMin = "windowsMin" | WindowMax = "windowsMax" | WindowClose = "windowsClose"

// ⑤ 主 API 枚举（25，索引 0-24）
0  SetIsVertical              13 Quit
1  GetIsVertical              14 NativeDialog
2  CheckUpdate                15 MacosSendNotification
3  GetToolPath                16 isFocus
4  GetCollectPath             17 SaveAsFile
5  ShowMoreMenu               18 RegistrationShortcutDisplayWindow
6  Hide                       19 SystemPreferences
7  Logout                     20 UpdateVersion
8  Login                      21 UpdateAppMenu
9  OpenDir                    22 GetUserInfo
10 OpenExternal               23 SaveUserInfo
11 Logger                     24 CreateMainWindow
12 SetTheme
```

**可读出的产品能力**：
- **标签栏方向可持久化**（`SetIsVertical` / `GetIsVertical`）→ 用户可切换垂直/水平标签栏
- **工具与采集目录**（`GetToolPath` / `GetCollectPath`）→ 有「采集」功能，产物落本地目录
- **快捷键注册失败要通知**（`SHORTCUTKEYREGISTERFAILED`）→ 全局快捷键
- **`RegistrationShortcutDisplayWindow`** → 快捷键设置窗口
- **`MacosSendNotification`** → 有 macOS 版本（跨平台）
- **`SystemPreferences`** → 系统偏好
- **`CreateMainWindow`** → 窗口由渲染层驱动创建

### 3.2 主进程 IPC handler（47 个通道）

按前缀分组：

| 前缀 | 数量 | 说明 |
|---|---|---|
| **`page-manager:`** | **29** | **标签页 + 分屏浏览器管理器** |
| `app-notice:` | 2 | 应用通知 |
| `autoUpdate` / `checkUpdate` | 3 | 自动更新 |
| `rpaChannel.*` | 3 | **RPA 通道**（`publishBulk` / `sendEvent` / `sendEntryEvent`）|
| `window.focusWindow` / `focusWindow` | 2 | 窗口聚焦 |
| 其他（单通道） | 8 | `client:getState`、`getDeviceId`、`read-file-buffer`、`dev-tools`、`electron-store-get-data`、`showDesktopNotification`、`serverSocket:getState`、`IpcChannelEnum.Public` |

**`page-manager` 的 29 个通道**（完整清单）：

```
标签页        create-tab / close-tab / switch-tab / get-all-tabs / get-active-tab
             get-home-tab / create-new-tab-page / restore-all-splits
导航         navigate / go-back / go-forward / reload / search-or-navigate
分屏(Split)  create-split-tab / close-split-tab / close-split-view
             add-tab-to-split / remove-tab-from-split / get-split-info
             is-split-tab / is-tab-in-split / get-all-split-tabs / get-split-focused-view
事件         subscribe-events / unsubscribe-events
采集/发布    add-collect / cancel-collect / save-cookies / rpa-publish-bulk
```

**评估**：这是一套**完整的浏览器标签管理器**（含分屏），命名统一在 `page-manager:` 命名空间下。
本项目 `WebviewManager` 的能力分散在多个 handler 文件，**没有这样统一的命名空间**——
这是本项目可以借鉴的组织方式（纯组织层面，非功能缺失）。

---

## 4. 平台矩阵

### 4.1 36 个平台类（`AuthorizeConfig`）

通过扫描 `class XxxAuthorizeConfig extends PlatformAuthorizeConfig` 得到：

```
AI_DouBao | AiQiYi | AZhan | BaiJiaHao | Bilibili | CheJiaHao | CSDN | DaYuHao
DeWu | DouBan | DouYin | DuoDuoShiPin | FengWang | JianShu | KuaiChuanHao
KuaiShou | MeiPai | MeiYou | PiPiXia | QiEHao | SouHuHao | SouHuShiPin
TengXunShiPin | TengXunWeiShi | TouTiaoHao | WangYiHao | WeiXinGongZhongHao
WeiXinShiPinHao | WifiWanNengYaoShi | XiaoHongShu | XiaoHongShuShangJiaHao
XinLangWeiBo | XueQiuHao | YiCheHao | YiDianHao | ZhiHu
```

配套 **34 个 `Worker` 类**（`XxxWorker extends BaseWorker`）。

### 4.2 ⭐ 架构模式：AuthorizeConfig + Worker 双类

```
PlatformAuthorizeConfig（基类）
  ├─ authorizeUrl   授权页 URL
  ├─ entryUrl       登录后入口 URL
  └─ waitForLoginFinish(views, params, abortSignal)   平台特定的登录完成判定
        ↓
BaseWorker（基类）
  └─ 平台特定的发布逻辑
```

**职责分离**：`AuthorizeConfig` 管「登录态」，`Worker` 管「发布」。

**对本项目的启示**：
本项目 `platform-definitions.js` 是**纯数据源**（URL + 检测模式），
登录逻辑集中在 `auth-view-manager.js`。15 个平台下数据驱动更简洁；
**若平台数增长到 30+，参考产品的「每平台一类」更容易承载平台特有逻辑**。

**推荐混合方案**：保留数据源作为默认，但把「登录完成判定」抽成可插拔策略对象
（如 `platform-definitions.js` 增加 `loginStateProbe` 字段指向策略）。

---

## 5. ⭐⭐ 登录态检测

> ⚠️ **本节的评估已在第 5 轮深挖中修正**（详见 [深挖补充报告-第5轮.md](深挖补充报告-第5轮.md) §3.2）。
>
> **原文错误地写成「36 个平台每平台独立 `waitForLoginFinish`」。核实后：只有 2 个平台有自定义判定。**
>
> | 类别 | 数量 | 平台 |
> |---|---:|---|
> | 自定义 `waitForLoginFinish` | **2** | **DouYin**、**WangYiHao**（网易号）|
> | 需 `needHandleSessionCookie` | 13 | AiQiYi、BaiJiaHao、Bilibili、DaYuHao、KuaiShou、QiEHao、SouHuHao、TengXunWeiShi、TouTiaoHao、WeiXinShiPinHao、XiaoHongShu、XinLangWeiBo、ZhiHu |
> | 其余 URL 判定即可 | 34 | — |
>
> **含义**：参考产品对 **34/36 平台用的是通用 URL 判定**——与本项目是**同一路线**。
> 真正需要平台特化的只有 **2 个**。本项目要补的工作量从「36 套」降到「2 套」。
>
> 下面 §5.1 的抖音实现仍然是**本项目最值得借鉴的一段**（它正是那 2 个特化平台之一）。

### 5.1 抖音：双 key 判定 + 基线快照

```javascript
class DouYinAuthorizeConfig extends PlatformAuthorizeConfig {
  constructor() {
    super(...arguments);
    this.authorizeUrl = "https://creator.douyin.com/";
    this.entryUrl = "https://creator.douyin.com/creator-micro/home";
  }

  waitForLoginFinish(views, params, abortSignal) {
    return Promise.allSettled(views.map(async (view, idx) => {
      // ① 先读取当前值作为「基线」
      const baseline = await view.webContents.executeJavaScript(
        "localStorage.getItem('security-sdk/s_sdk_sign_data_key/web_protect')");

      // ② 正常检测：等 key 出现 + 值相对基线发生变化
      const normalCheck = (async () => {
        await waitForLocalStorage(view, ["security-sdk/s_sdk_crypt_sdk"], abortSignal);
        await waitForLocalStorageDifferentFrom(
          view,
          { "security-sdk/s_sdk_sign_data_key/web_protect": baseline },
          abortSignal
        );
      })();

      // ③ 硬超时兜底：10 秒后直接检查两个 key 是否都存在
      const timeoutRace = new Promise((resolve, reject) =>
        setTimeout(async () => {
          if (abortSignal.aborted) return;
          const sdk  = await view.webContents.executeJavaScript(
            "localStorage.getItem('security-sdk/s_sdk_crypt_sdk')");
          const sign = await view.webContents.executeJavaScript(
            "localStorage.getItem('security-sdk/s_sdk_sign_data_key/web_protect')");
          if (sdk && sign) resolve();
          else reject(new Error(`视图 ${idx} 超时：10秒内未找到 key`));
        }, 10000)
      );

      return Promise.race([timeoutRace, normalCheck]);
    }));
  }
}
```

### 5.2 为什么这个设计好（4 个要点）

| # | 设计 | 解决的问题 |
|---|---|---|
| 1 | **双 key 判定** | `s_sdk_crypt_sdk`「出现即登录」+ `web_protect`「值变化才算完成」。单 key 会在页面加载中途误判 |
| 2 | **基线快照** | 登录前先读一次值。否则「页面本来就有旧值」会被当成登录成功 |
| 3 | **`Promise.race` 硬超时** | 10 秒兜底，避免轮询无限等待 |
| 4 | **`Promise.allSettled`** | 多视图并发，任一成功即算完成（不因个别视图失败整体失败）|

### 5.3 ⭐ 它真正在读什么（关键）

`s_sdk_crypt_sdk` / `s_sdk_sign_data_key/web_protect` **不是普通的登录标记**——
它们是**字节跳动 security-sdk 下发给页面的密钥材料**：

```javascript
// 从 cookie 中解析出的结构（参考产品 clientSign 的输入）
security-sdk/s_sdk_crypt_sdk
  → JSON.parse(JSON.parse(decodeURIComponent(...)).data).ec_privateKey     // ★ EC 私钥

security-sdk/s_sdk_sign_data_key/web_protect
  → JSON.parse(JSON.parse(decodeURIComponent(...)).data)                    // { ticket, ts_sign, ... }
```

**所以 `waitForLoginFinish` 等的不是「登录成功」，而是「security-sdk 已下发签名密钥」**
——即在等**具备签名能力**的那一刻。这比等 URL 跳转精确得多，
因为抖音登录后不一定立刻跳转，但 security-sdk 一定会注入密钥。

### 5.4 快手的对应实现

`KuaiShouAuthorizeConfig`：
- `authorizeUrl` = `https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api`
- `entryUrl` = `https://cp.kuaishou.com`

### 5.5 对本项目的建议

**现状**：本项目 `auth-view-manager.js` 的 `_checkLoginCompleted(url)` **基于 URL 模式匹配**
（`PLATFORM_LOGIN_SUCCESS_PATTERNS`），并有 `waitForPostLoginSession` 补充。

**问题**：抖音登录成功后 URL 会回到 `creator.douyin.com/`，
**但 URL 变化 ≠ 登录态建立**（可能只是打开了登录页）。

**建议**（工作量约 100-150 行 + 测试）：

1. `platform-definitions.js` 增加可选字段：
```javascript
const PLATFORM_LOGIN_STATE_PROBES = {
  douyin: {
    appearKeys: ['security-sdk/s_sdk_crypt_sdk'],              // 出现即视为就绪
    changeKeys: ['security-sdk/s_sdk_sign_data_key/web_protect'], // 值变化才算完成
    timeoutMs: 10000
  },
  // kuaishou: {...}
}
```

2. `auth-post-login-redirect.js` 实现 `waitForLoginStateProbe(view, probe, signal)`

3. 与现有 URL 检测**并行竞速**（`Promise.race`），任一成功即算完成

> ⚠️ **风控提示**：本项目的 AGENTS.md 有「风控即停、绝不自动换号绕过」的红线。
> 读 localStorage 判定登录态是**只读观测**，不触发风控；但要确保：
> ① 探测失败时**不重试**（避免高频轮询被识别）；② 记录探测耗时用于诊断。

---

## 6. ⭐⭐ 自动化机制：CDP 响应体拦截

### 6.1 通用拦截工具

主进程里有一套基于 **`webContents.debugger`（Chrome DevTools Protocol）** 的通用拦截器：

```javascript
// 拦截指定 URL 模式的 XHR 响应体，解析 JSON 后交给 processor
async function interceptResponse({ view, urlPatterns, processor, callback }) {
  const patterns = Array.isArray(urlPatterns) ? urlPatterns : [urlPatterns];

  if (!view.webContents.debugger.isAttached()) {
    try { view.webContents.debugger.attach(); } catch { return; }   // 静默失败
  }

  // 三种 resourceType × requestStage: "Response"
  const fetchPatterns = patterns.flatMap((pattern) => [
    { urlPattern: `*${pattern}*`, resourceType: "XHR",   requestStage: "Response" },
    { urlPattern: `*${pattern}*`, resourceType: "Fetch", requestStage: "Response" },
    { urlPattern: `*${pattern}*`, resourceType: "Other", requestStage: "Response" },
  ]);

  await view.webContents.debugger.sendCommand("Fetch.enable", { patterns: fetchPatterns });

  const messageListener = async (_, method, params) => {
    if (method !== "Fetch.requestPaused") return;
    const { requestId, request } = params;
    const matched = getMatchedPattern(request?.url || "");
    if (!matched) return;
    const { body, base64Encoded } = await view.webContents.debugger.sendCommand(
      "Fetch.getResponseBody", { requestId });
    const responseBody = base64Encoded ? Buffer.from(body, "base64").toString() : body;
    // → 解析 JSON → processor
  };
}
```

### 6.2 CDP 命令使用统计

| 命令 | 用途 |
|---|---|
| `Fetch.enable` / `Fetch.disable` | 开启/关闭请求拦截 |
| `Fetch.getResponseBody` | **读取响应体**（核心）|
| `Fetch.continueRequest` | 放行请求 |
| `DOMStorage.enable` | 读 localStorage/sessionStorage |
| `Network.enable` | 网络监控 |

统计：`webContents.debugger` 16 处、`debugger.attach` 3 处、
`executeJavaScript` 38 处、`security-sdk` 83 处、`Promise.race` 36 处。

### 6.3 这解决了什么问题（重要技术洞察）

**核心手法**：**让平台页面自己发请求（自带签名/cookie），应用只拦截读取结果。**

对比另外两条路线：

| 路线 | 代表 | 优点 | 缺点 |
|---|---|---|---|
| **A. 搭乘页面请求**（CDP 拦截）| 参考产品 `interceptResponse` | 抗改版强（签名由页面算）；不用逆向签名 | 必须在页面上下文里；页面不开就没数据 |
| **B. 页面内 SDK 调用** | 本项目 `hostSdkAdapter`（头条 `byted_acrawler.sign`）| 不用自己逆向算法 | 依赖页面暴露 SDK；SDK 改名就得跟 |
| **C. 本地签名**（自己构造请求）| 参考产品 `clientSign`；本项目 P1 待做 | 可无人值守、速度快 | 签名算法变了就得跟；风控风险最高 |

**参考产品同时用了 A 和 C**（混合路线），本项目目前是 B 为主。

### 6.4 CDP 的代价（需要注意）

- `debugger.attach()` 会在页面顶部显示「**正在被调试**」提示条（除非打包时禁用），
  **可能被平台的前端反调试检测发现**
- `Fetch.enable` 拦截**所有**匹配请求会**显著拖慢页面**（每个响应都要过一次 JS 回调）
- 参考产品的模式只匹配特定 URL 且只读 Response 阶段，已经是很节制了

> **对本项目的建议**：如果将来要读平台页面内部 API 的响应（例如抓取账号数据），
> 这套模式可参考。但本项目现有的 `account-metrics/adapters.js` 是**直接调用平台 API**
> （带 cookie 请求），比 CDP 拦截更轻量——**优先保持现有路线**，
> 只在平台 API 需要页面上下文签名时才考虑 CDP。

---

## 7. ⭐⭐ 本地签名实现（对本项目 P1 路线最有价值）

### 7.1 抖音 `clientSign` 完整还原

```javascript
clientSign = ($ /* cookie 字符串 */) => {
  try {
    // ① 从 cookie 提取 EC 私钥
    const O = JSON.parse(JSON.parse(decodeURIComponent(
      $.split("security-sdk/s_sdk_crypt_sdk=")[1]?.split(";")[0]?.trim()
    )).data).ec_privateKey;

    // ② 从 cookie 提取 ticket 与 ts_sign
    const M = JSON.parse(JSON.parse(decodeURIComponent(
      $.split("security-sdk/s_sdk_sign_data_key/web_protect=")[1]?.split(";")[0]?.trim()
    )).data);

    // ③ 构造待签串：ticket + path + 秒级时间戳
    const U = crypto.createPrivateKey(O);
    const L = parseInt(String(new Date().getTime() / 1e3));
    const W = `ticket=${M.ticket}&path=/web/api/media/aweme/create_v2/&timestamp=${L}`;

    // ④ SHA256 + EC 私钥签名，base64 输出
    const V = crypto.createSign("SHA256");
    V.update(W);
    V.end();
    const Y = V.sign(U, "base64");

    // ⑤ 组装 bd-ticket-guard-client-data
    return JSON.stringify({
      ts_sign: M.ts_sign,
      req_content: "ticket,path,timestamp",
      req_sign: Y,
      timestamp: L
    });
  } catch { /* ... */ }
}
```

### 7.2 用到的签名头（字节 `bd-ticket-guard` 体系）

```javascript
const headers = {
  cookie: $,
  "User-Agent": HttpConfig.userAgent,
  "Content-Type": "application/json",
  "x-secsdk-csrf-token": S,
  "bd-ticket-guard-web-version": Y,           // "1" 或 "2"（按 ticket 是否 hash 开头判定）
  "bd-ticket-guard-version": "2",
  "bd-ticket-guard-iteration-version": "1",
  "bd-ticket-guard-web-sign-type": "0",
  "bd-ticket-guard-ree-public-key": K,        // 从 bd_ticket_guard_client_data 的 base64 JSON 取
  "bd-ticket-guard-client-data": W,           // ← clientSign() 的产物
  Referer: "https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page",
  Origin: "https://creator.douyin.com/"
};
```

**还额外处理了**：
- `bd_ticket_guard_client_data` / `bd_ticket_guard_client_data_v2` 两个版本 cookie，
  base64 解码后取 `bd-ticket-guard-ree-public-key` / `ree_public_key`
- `msToken` 取不到时兜底生成 `` `a12man123masb${Date.now()}` ``（**伪造值**）

### 7.3 涉及的抖音端点

```
发布:    https://creator.douyin.com/web/api/media/aweme/create_v2/
         ?read_aid=2906&cookie_enabled=true&screen_width=1920&screen_height=1080
         &browser_language=zh-CN&...
验证码:  https://creator.douyin.com/passport/web/send_code/
         ?passport_jssdk_version=5.0.2&passport_jssdk_type=lite
         &is_from_ttaccountsdk=1&aid=2906&language=zh
         &new_authn_sdk_version=1.1.3-web&is_vcd=1&biz_trace_id=...&msToken=&a_bogus=
```

> 注意 `aid=2906` —— 与融媒宝原生层提取到的 `app_id=2906` **完全一致**，
> 说明这是抖音开放平台的公开应用 ID。

### 7.4 ⭐ 对本项目的直接价值

**本项目的 `packages/rpa-engine/src/publish-signer.js` 是骨架**，
只有两类适配器：

| 适配器 | 机制 | 已注册平台 |
|---|---|---|
| `hostSdkAdapter` | 调用页面内的 SDK 函数（`byted_acrawler.sign`）| `toutiao_sdk` |
| `pageSubmitAdapter` | 让页面自身提交 | `toutiao` |

文件注释明确写了：
> 当前内置的是 `page` 适配器（P0 路线）：**签名由平台页面自身完成**，本模块只负责
> "声明该平台走页面内提交"。**后续如需本地签名（P1），在此注册新的适配器即可**，
> 发布流程无需改动。

**参考产品证明了 P1 本地签名可行，并且给出了抖音的完整实现**。要点：

1. 密钥材料来自 cookie（`security-sdk/s_sdk_crypt_sdk` 的 `ec_privateKey`）→ **不需要逆向密钥生成算法**
2. 签名用 Node 内置 `crypto`（`createPrivateKey` + `createSign("SHA256")`）→ **不需要第三方库**
3. 待签串格式简单：`ticket=<ticket>&path=<path>&timestamp=<秒>`
4. 结果放进 `bd-ticket-guard-client-data` 头

**建议**：
在 `publish-signer.js` 注册一个 `douyin_local` 适配器，按上述方式实现。
**但要注意**：
- 本文件注释明确「**不**包含：调用任何第三方签名服务；复制第三方服务端的固定模板常量」——
  上述实现是从平台下发的 cookie 材料推导，**不含固定常量**，符合该约束
- 本地签名绕过了页面，**风控风险高于页面内提交**。本项目 AGENTS.md 要求
  「风控即停」，建议：**默认仍走 `page` 路线，本地签名作为可选/降级路径**，
  且失败时立即回退，不重试

---

## 8. 反爬与风控对抗

| 手段 | 出现次数 | 说明 |
|---|---|---|
| `security-sdk` | **83** | 字节 security-sdk 相关处理 |
| `localStorage` 注入 | 38（`executeJavaScript`）| 读/写页面存储 |
| **风控 sleep/delay** | **65** | 随机延时 |
| `a_bogus` | 31 | 抖音/头条的 `a_bogus` 参数 |
| `bd-ticket-guard` | 29 | 字节 ticket guard 签名头 |
| `_signature` | 20 | 通用签名字段 |
| Cookie 操作 | 13 | `session.cookies.*` |
| **OCR 验证码** | **11** | `tesseract` |
| 滑块验证码 | 2 | `geetest` / 滑块 |
| UA 自定义 | 2 | `setUserAgent` |

### 8.1 与本项目对比

| 能力 | 参考产品 | 本项目 |
|---|---|---|
| UA 池 | 2 处 | ✅ `anti-detect.js`（5 个 UA）|
| Header 随机化 | — | ✅ `randomizeHeaders()` |
| 随机延迟 | ✅ 65 处 | ✅ `randomDelay()` |
| Cookie 操作 | ✅ 13 处 | ✅ `session.cookies` |
| localStorage 读写 | ✅ 38 处 | ⚠️ 有 `restoreLocalStorage`，读写面较窄 |
| **签名实现** | ✅ **本地签名（EC + SHA256）** | ⚠️ 仅页面内 SDK / 页面提交 |
| CDP 拦截 | ✅ `Fetch.getResponseBody` | ❌ 无 |
| 滑块验证码 | 2 处 | ❌ 无 |
| **OCR 验证码** | ✅ 11 处（tesseract）| ❌ 无 |

> ⚠️ **关于验证码对抗**：本项目定位是 AI 内容生产，**不建议做 OCR/滑块验证码对抗**
> （合规风险高于技术价值）。遇到验证码应走「提示用户手动处理」的路径。

---

## 9. 数据存储

| 存储 | 参考产品 | 本项目 |
|---|---|---|
| SQLite | 4 处 | ✅ `sqlite-storage.js` |
| electron-store | 5 处（`Conf` / `ElectronStore extends Conf`）| ✅ `store.js` |
| 文件系统缓存 | 58 处 | ✅ |
| IndexedDB | 1 处 | ✅ |
| OSS 直传 | 2 处 | ✅ `oss-uploader.js` |
| **COS 直传** | **9 处**（`x-cos-security-token`、`myqcloud`）| ✅ `cos-uploader.js` |

### 9.1 各平台上传协议（从代码提取）

**S3 风格通用分片**：
```javascript
// 初始化
/?uploads&prefix=
// 上传分片
%s?key=%s&upload_id=%s&partnumber=%d&_=%s
// 完成（XML）
<CompleteMultipartUpload>...</CompleteMultipartUpload>
```

**小红书 COS 直传**（真实代码）：
```javascript
const U = {
  "x-cos-security-token": $.token,
  referer: "https://ark.xiaohongshu.com",
  Origin: "https://ark.xiaohongshu.com",
  Authorization: "",
  "Content-MD5": crypto.createHash("md5").update(O).digest("base64")
};
await $http.post(N, O, { headers: U, responseType: "text" });
```

**得物 OSS 直传**（真实代码）：
```javascript
const U = {
  "x-oss-date": P,
  "x-oss-security-token": S?.data.securityToken,
  "x-oss-user-agent": xUserAgent,
  "Content-Type": `video/${T}`,
  referer: "https://creator.dewu.com/release",
  Origin: "https://creator.dewu.com",
  cookie: $,
  authorization: `OSS ${S?.data.accessKeyId}:${M}`
};
```

**小红书话题拼接**（真实代码）：
```javascript
M?.forEach(Qe => { O += ` #${Qe.name}[话题]#` });
L = $.mentionedUser?.map(Qe => ({
  nickname: Qe.user_nickname, name: Qe.user_nickname, user_id: Qe.user_id
}));
```

---

## 10. 功能模块分布（89 / 566 个模块含业务特征）

### 10.1 功能最密集的模块

| 模块 ID | 大小 | 行数 | 功能数 | 关键功能 |
|---|---:|---:|---:|---|
| **4658** | 3389.7 KB | 342 | **28** | 8 个平台 + AuthorizeConfig + oauth + OSS直传 + 验证码 + UA伪装 + 窗口池化 + 截图 + axios + socket.io + 请求池 + 任务队列 + 重试 + 定时任务 + 日志 + AI调用 + 图片处理 + 加解密 |
| **63474** | 1132.7 KB | **32556** | **21** | 公众号 + localStorage + cookie + oauth + 表单上传 + UA伪装 + **窗口多开/池化/隐藏/后台节流** + 截图 + 剪贴板 + 快捷键 + **IPC通道** + axios + socket.io + 任务队列 + 重试 + 定时 + 日志 + 加解密 |
| 57940 | 304.5 KB | 3160 | 14 | 7 个平台 + localStorage + cookie + **inputFile 上传** + IPC-invoke + 重试 + 定时 + 图片处理 |
| 2713 | 126.6 KB | 4794 | 6 | oauth + 表单上传 + UA伪装 + axios + 任务队列 + 重试 |
| 22087 | 142.9 KB | 7 | 5 | oauth + 表单 + 任务队列 + 定时 + **sqlite** |
| 96685 | 156.7 KB | 7 | 5 | 同上（重复实现）|
| 75219 | 12.5 KB | 454 | 4 | 请求池 + 任务队列 + 重试 + 定时 |
| 77045 | 13.9 KB | 521 | 3 | 窗口池化 + 请求池 + 任务队列 |

### 10.2 全局功能分布（89 个模块中）

```
日志 33 | 任务队列 20 | socket.io 16 | 定时任务 16 | 重试机制 11
UA伪装 9 | oauth 8 | 窗口池化复用 8 | 上传表单 7 | 请求池 7
加解密 4 | localStorage 3 | cookie 3 | axios 3 | 配置存储 3
平台(抖音/快手/B站/小红书/公众号/知乎/微博/头条) 各 2
截图 2 | 图片处理 2 | IPC 2 | 风控sleep 2 | sqlite 2
AuthorizeConfig 1 | OSS直传 1 | 验证码 1 | AI调用 1 | inputFile 1
多开 1 | 隐藏 1 | backgroundThrottling 1 | 剪贴板 1 | 快捷键 1
```

**观察**：`日志 33` 与 `任务队列 20` 占主导，说明这是**重工程基础设施**的产品；
`22087` 与 `96685` 两个模块功能完全相同（oauth+表单+任务队列+定时+sqlite），
是**重复实现**——代码质量问题。

---

## 11. 代码质量观察

| # | 问题 | 证据 |
|---|---|---|
| 1 | **窗口标题模板复制未改** | `collect.html` 标题是「加载错误」；`update.html` 标题是「Tool」（抄自 `tool.html`）|
| 2 | **标题未本地化** | `tool.html` 标题是英文 `Tool`，产品是纯中文 |
| 3 | **拼写错误进入 API 契约** | `ipc-notice-render` 所属枚举成员名是 `RenderScreenshotsSrouce`（Source 拼成 Srouce）|
| 4 | **模块重复实现** | `22087` 与 `96685` 功能完全相同 |
| 5 | **旧 API 残留** | 同时存在 `BrowserView`（旧）与 `WebContentsView`（新）|
| 6 | **无测试** | asar 内无任何 `*.test.js` / `__tests__` |
| 7 | **主进程无 source map** | `index.cjs` 无 `.map`（渲染层与 socket.io 有）|
| 8 | **`mainPagePath = false` 等常量** | 8 个 `*PagePath` 常量编译后为 `false`，可读性差 |

> **对照本项目**：本项目有完整的测试体系（`*.test.js` 大量存在）、
> i18n 成对提交门禁、命名规范门禁、单一实现门禁。**工程质量明显更强**。

---

## 12. 与本项目的架构对比

| 维度 | 参考产品 | 本项目 | 判断 |
|---|---|---|---|
| 应用形态 | Electron 浏览器外壳 + RPA | Electron 应用 + 内嵌 RPA 视图 | **同构** |
| 视图 API | `WebContentsView` + `BrowserView` 残留 | `WebContentsView` + overlay 挂起 | 本项目更完整 |
| 标签管理 | `page-manager:` 29 通道（统一命名空间）| `WebviewManager`（能力分散）| 参考产品组织更好 |
| 窗口池 | 8 处 pool 提及 | ✅ TTL sweeper + LRU + `unref()` + 键语义分离 | **本项目更强** |
| 登录态持久化 | cookie + localStorage | ✅ cookie + localStorage + **IndexedDB** | **本项目更强** |
| 登录态检测 | ✅ 双 key + 基线快照 + 竞速超时（**但仅抖音/网易号 2 个平台特化，其余 34 个用 URL 判定**）| ⚠️ URL 模式匹配 | 差距**远小于**初版评估 |
| 签名 | ✅ 本地签名（EC + SHA256）| ⚠️ 页面 SDK / 页面提交 | **参考产品更强** |
| CDP 拦截 | ✅ `Fetch.getResponseBody` | ❌ 无 | 参考产品独有 |
| 上传 | OSS/COS 直传 | ✅ OSS + COS + **分片** + 进度门控 + 重试 | **本项目更强** |
| 任务调度 | 任务队列 + 重试 + 定时 | ✅ task-pool + rate-limiter + retry + circuit-breaker + cool-down | **本项目更强** |
| 反检测 | UA + sleep + OCR + 滑块 | ✅ UA池 + Header随机化 + 随机延迟 + stealth-preload | 本项目更规范（不做验证码对抗）|
| 平台数 | **36** | 15 | **参考产品更多** |
| 安全 | 部分 CSP | ✅ ipc-security + egress-guard + access-level + safe-http-url | **本项目更强** |
| 测试 | 无 | ✅ 大量 `.test.js` + TDD 流程 | **本项目更强** |
| 文档 | 无 | ✅ PRD / 架构 / 设计规范 | **本项目更强** |

---

## 13. 可复用清单

### 13.1 ⭐ 直接可借鉴（按价值排序）

| 优先级 | 项 | 价值 | 成本 |
|---|---|---|---|
| **P0** | **抖音 `clientSign` 本地签名实现** | 本项目 `publish-signer.js` 的 P1 路线有了完整参考 | 中（约 100 行 + 测试）|
| **P0** | **登录态双 key 检测**（含基线快照 + 竞速超时）| 提升登录成功率，消除静默失败 | 低（100-150 行）|
| P1 | **`page-manager:` 统一命名空间** | 纯组织改进，便于查找与扩展 | 低（重命名 + 转发）|
| P1 | 36 平台清单（补齐缺口）| 见 `平台覆盖差距分析.md` | 中（每平台走完整门禁）|
| P2 | CDP 响应体拦截模式 | 将来需要读页面内部 API 时可用 | 中 |
| P3 | 各平台 OSS/COS 直传头构造 | 本项目已有，可作交叉验证 | 低 |

### 13.2 明确不建议复用

| 项 | 原因 |
|---|---|
| `index.cjs` webpack bundle | 7.1 MB / 108,243 行压缩代码，主进程无 source map，无法安全提取 |
| OCR / 滑块验证码对抗 | **合规风险高于技术价值**，与本项目定位冲突 |
| 自动回复/批量互动 | 平台合规风险 + 本项目 AGENTS.md「风控即停」红线 |
| 默认开启的本地签名 | 风控风险高于页面内提交，应作为可选降级路径 |

---

## 附：分析产物

| 文件 | 说明 |
|---|---|
| `analysis/refproduct-asar/` | asar 完整解包（44 文件 / 9.5 MB 稳定副本）|
| `analysis/refproduct-asar-evidence.json` | REA 完整 Evidence（168 MB）|
| `analysis/refproduct-architecture.txt` | 平台/IPC/285 类/反爬/存储明细 |
| `analysis/refproduct-modules.json` | 89 个模块的功能命中明细 |
| `analysis/refproduct-snippets.txt` | 关键代码片段（8 类）|
| `analysis/refproduct-renderer.md` | 渲染层与多窗口分析 |
| `analysis/deconstruct-refproduct.cjs` | webpack 模块拆解脚本 |
| `analysis/extract-refproduct-arch.cjs` | 架构提取脚本 |
| `analysis/extract-refproduct-renderer.cjs` | 渲染层提取脚本 |

### 复现命令

```powershell
# 1. asar 全量静态分析（约 2 分钟）
rea analyze-javascript-application "D:\Program Files\refproduct\resources\app.asar" --json

# 2. 安全解包（REA 拒绝路径穿越与符号链接逃逸）
rea extract-artifact "D:\Program Files\refproduct\resources\app.asar"

# 3. 拆解 webpack 模块边界（/***/ <id>: 共 566 个）
node analysis/deconstruct-refproduct.cjs

# 4. 提取架构与渲染层信息
node analysis/extract-refproduct-arch.cjs
node analysis/extract-refproduct-renderer.cjs
```
