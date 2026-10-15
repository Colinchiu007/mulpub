# PRD：内嵌浏览器主世界反检测（browser-stealth-main-world）

> 版本：v1.0（2026-10-15）｜ 分支：`zhihu-stealth-browse` ｜ worktree：`mp-zhihu-stealth-browse`
> 触发问题：应用内点击已保存账号 → 打开知乎平台页面 → 浏览 → 知乎提示「你的网络环境或行为异常」，要求短信验证
> 根因分析：`01-docs/INVESTIGATE-ZHIHU-RISK-CONTROL-2026-10-15.md`
> 原始取证：`01-docs/evidence/zhihu-stealth-mainworld-2026-10-15/`

---

## 1. 背景与目标

### 1.1 问题

用户在应用内嵌浏览器（浏览标签 / 账号标签）访问平台时被平台风控拦截。分析定位到**两个互相独立的应用侧缺陷**：

| # | 缺陷 | 性质 |
|---|------|------|
| D1 | `stealth-preload.js` 的 patch 在 `contextIsolation:true + sandbox:true` 下改的是**隔离世界**的 `navigator`，页面主世界毫无感觉 | 通道错误（存量，spike 已证） |
| D2 | 账号标签/浏览标签**根本没加载**任何反检测脚本（挂的是 `monitor-preload.js`，只暴露两个只读 IPC） | 接线缺失 |

此外探查中发现 **D3**：即便把旧补丁修好通道，它的**内容也是错的**——实测证明它对 3 项本就正常的信号动手，反而制造出比原状更明显的自动化特征（详见 §3）。

### 1.2 目标

1. 让内嵌浏览器在**页面主世界**呈现与真实 Chrome 一致的指纹（只修实测确认不一致的项）。
2. 账号标签（用户点开平台页面的路径）真正接上反检测。
3. 修正 `stealth-preload.js` 的错误头注与有害补丁，消除「文档说做了、实际没做且做错」的状态。

### 1.3 非目标

- ❌ 不伪造本就正常的指纹项（`webdriver` / `plugins` / `mimeTypes` / `vendor` / WebGL / `chrome.runtime`）。
- ❌ 不做行为层拟人（鼠标轨迹/打字节奏）——见 `PRD-OSS-RPA-HARDENING-2026-10-14.md` §3.2，属另一批。
- ❌ 不做验证码识别 / camofox 隐身通道（同 PRD §3.4/§3.5）。
- ❌ 不改变 IP/代理环境——openclash 分流属用户侧配置，见分析文档 §4。
- ❌ 本次**不收紧实际权限授予**（只改报告值），理由见 §9。

---

## 2. 术语与单一真源

| 名称 | 含义 | 单一真源位置 |
|------|------|-------------|
| 主世界 | 页面自身脚本运行的 JS 世界（`worldId=0`） | — |
| 隔离世界 | `contextIsolation:true` 下 preload 所在的独立 JS 世界 | — |
| evasion | 一条具体的环境还原补丁 | `electron/stealth/evasions.js` |
| 标记（marker） | 注入源码在页面主世界写的状态对象 `__mpStealthInj` | 同上 `MARKER_KEY` |
| bundle | esbuild 打包出的单文件 preload | `apps/desktop/scripts/build-preload.js` |

**单一真源纪律**：evasion 源码、注入通道、bundle 解析三者各只有一处实现；
`monitor-preload`（浏览/账号标签）与 `stealth-preload`（RPA 窗口）**共用同一份源码**。

---

## 3. 取证基线（本 PRD 的全部技术判断都以此为准）

方法：同机、同一 GPU、同一时段，用**真实 Electron 43.7.7** 与**真实 Chrome 155**逐项对照。
Raw 产物见 `01-docs/evidence/zhihu-stealth-mainworld-2026-10-15/`。

### 3.1 关键对照表

| 信号 | Electron 实测 | 真实 Chrome 实测 | 本片处置 |
|------|--------------|-----------------|---------|
| `navigator.webdriver` | `false` | `false` | ⛔ **不处理**（本就一致） |
| `navigator.plugins.length` | 5 | 5 | ⛔ 不处理 |
| `navigator.plugins[*].name` | PDF Viewer / Chrome PDF Viewer / Chromium PDF Viewer / Microsoft Edge PDF Viewer / WebKit built-in PDF | **逐字相同** | ⛔ 不处理 |
| `navigator.mimeTypes.length` | 2 | 2 | ⛔ 不处理 |
| `navigator.pdfViewerEnabled` | `true` | `true` | ⛔ 不处理 |
| `navigator.vendor` | `Google Inc.` | `Google Inc.` | ⛔ 不处理 |
| `navigator.hardwareConcurrency` | 12 | 12 | ⛔ 不处理 |
| `navigator.deviceMemory` | 32 | 32 | ⛔ 不处理 |
| WebGL vendor/renderer | 同机同值 | 同机同值 | ⛔ 不处理 |
| `typeof chrome.runtime` | `undefined` | **`undefined`** | ⛔ 不处理 |
| **`Object.keys(window.chrome)`** | **`[]`（空数组）** | **`['loadTimes','csi','app']`** | ✅ **补** |
| **`navigator.userAgentData.brands`** | 缺 `Google Chrome` | 含 `Google Chrome` | ✅ **补** |
| **`Notification.permission`** | **`granted`** | **`default`** | ✅ **修** |
| **`permissions.query(5 项)`** | **全 `granted`** | **全 `prompt`** | ✅ **修** |
| `navigator.languages` | `['zh-CN','zh-Hans-CN']` | `['zh-CN','zh']` | ⛔ 不处理（见 §9.2） |
| UA 含 `Electron/43.7.7` | 净化前含 / **净化后不含** | 不含 | ✅ 已由既有代码修好（本片仅补真机证据） |

### 3.2 A/B 对照（同一生产 preload，`MP_BROWSER_STEALTH` 开/关）

| 信号 | 关闭（基线） | 开启（本片） | Chrome 基线 |
|------|------------|------------|------------|
| `chromeKeys` | `[]` | `app,csi,loadTimes` | `loadTimes,csi,app` |
| `uaDataBrands` | 2 项（无 Google Chrome） | 3 项（含 Google Chrome/150） | 3 项（含） |
| `notificationPermission` | `granted` | `default` | `default` |
| `permissions.*` | 全 `granted` | 全 `prompt` | 全 `prompt` |
| `permissionStatus instanceof PermissionStatus` | true | **true** | — |
| 标记 `done/applied/failed` | 不存在 | `1 / 4 / 0` | — |
| 隔离世界标记在主世界可见 | `undefined` | `undefined` | — |
| `plugins` / `webdriver` / `vendor` / `chrome.runtime` | **未改动** | **未改动** | — |

---

## 4. 架构设计

### 4.1 注入通道选型（为什么是 `webFrame.executeJavaScriptInIsolatedWorld(0, …)`）

真机实测结论（`injection-channel-raw.txt`）：

| 实测项 | 结果 | 含义 |
|--------|------|------|
| sandbox preload 内 `require('electron').webFrame` | 可用 | 通道宿主存在 |
| `require('./probe-require-target.js')` | `module not found` | **sandbox preload 无法 require 相对路径文件** ⇒ 必须 bundle |
| `executeJavaScriptInIsolatedWorld(0, …)` 后页面读到标记 | `done=1` 且早于页面脚本 | worldId=0 即主世界、document-start 语义成立 |
| 隔离世界写的标记在主世界可见性 | `undefined` | 隔离语义成立（旧实现无效的直接证据） |

**未选 CDP/debugger 通道的原因**：RPA 上传链路已对同一 webContents 做 per-op `debugger.attach`，
第二个常驻 attach 会抛「Another debugger is already attached」；且 fresh window 上 Page 域命令会挂起，
须 blank bootstrap + 超时竞速。preload 通道零 attach 生命周期，失败面小得多。

### 4.2 模块划分

```
apps/desktop/electron/
├── stealth/                     ← 新增：反检测单一真源
│   ├── evasions.js              源码生成 + 实测对照表 + PROVENANCE
│   ├── inject.js                注入通道 + 开关 + 三态读回
│   └── index.js                 入口
├── core/preload-path.js          ← 新增：sandbox preload「bundle 优先」解析（公用）
├── monitor-preload.js            ← 改：注入 + 保留既有受限 IPC 桥
├── stealth-preload.js            ← 改：改为装载器；删除有害补丁；修正错误头注
├── services/webview-manager/
│   ├── tab-lifecycle.js          ← 改：浏览/账号标签改用 _monitorPreloadPath()
│   └── utils.js                  ← 改：新增 _monitorPreloadPath()
└── services/rpa-view-session.js  ← 改：RPA 窗口改用 resolveRpaPreloadPath()
apps/desktop/scripts/
├── build-preload.js              ← 改：新增 monitor / RPA stealth 两个 bundle 入口
├── probe-main-world-injection.js ← 新增：通道 + 指纹取证 harness
└── probe-browser-fingerprint.js  ← 新增：生产 preload A/B 验收 harness
```

### 4.3 时序

```
主进程 createNewTabPage / RpaViewManager._createWindow
  └─ 解析 preload 路径（bundle 优先，缺 bundle 出声告警）
       └─ new WebContentsView / BrowserWindow(sandbox:true, contextIsolation:true)
            └─ 渲染进程启动 → preload 顶层**同步**执行
                 ├─ installMainWorldEvasions({ webFrame })
                 │    ├─ resolveStealthEnabled()   ← MP_BROWSER_STEALTH 开关
                 │    └─ executeJavaScriptInIsolatedWorld(0, [{code: 源码}], true)   ← 不 await
                 │         └─ 主世界：写标记 → 逐项 apply → done=1
                 ├─ readBack() 异步读回三态 → 异常出声告警（不阻断）
                 └─ contextBridge.exposeInMainWorld('multiPublishMonitor', …)
            └─ 页面脚本执行（此时主世界已还原完毕）
```

---

## 5. 数据校验

| # | 校验点 | 判据 | 失败行为 |
|---|-------|------|---------|
| V1 | 开关解析 | `MP_BROWSER_STEALTH` ∈ {`0`,`false`,`off`,`no`}（去空白 + 小写归一）⇒ 关闭 | 未知值按**开启**并保留原值供日志；关闭时出声告警 |
| V2 | 注入宿主 | `webFrame.executeJavaScriptInIsolatedWorld` 为函数 | 跳过注入 + 告警，**不抛错**（不阻断 preload 其余职责） |
| V3 | 注入同步性 | 命令在 preload 顶层同步发出（不得包 `then`/`setTimeout`） | 结构锁 `inject.test.js` 断言「未 await 即已调用」 |
| V4 | 三态标记 | 无标记⇒`preload-not-run`；有标记无 `done`⇒`partial-first-line-failed`；`done` 但 `failed` 非空⇒部分失败 | 三种异常均出声告警；`unreadable` 单独区分 |
| V5 | 读回可解析 | 读回值是 JSON 对象 | 不可解析 ⇒ `state='unreadable'` + 告警，不抛错 |
| V6 | 读回失败语义 | 读回通道异常 ≠ 注入失败 | 分别措辞（`readback-failed` vs 注入失败），不得互相冒充 |
| V7 | bundle 解析 | `*.bundle.js` 存在则用之，否则回退源文件 | 回退时出声告警（sandbox 下相对 require 必失败 ⇒ 反检测不可用） |
| V8 | 品牌版本自洽 | `Google Chrome` 的 version 取自自身 UA 的 `Chrome/(\d+)` | UA 无该 token ⇒ **不插入**（不猜版本） |
| V9 | 品牌幂等 | 已含 `Google Chrome` ⇒ 不重复插入 | 幂等 |
| V10 | 高低熵一致 | `getHighEntropyValues().brands` 必须等于低熵 `brands` | 同源替换，避免「低熵说 Chrome、高熵说 Chromium」矛盾 |
| V11 | 权限原型 | 替换对象须 `instanceof PermissionStatus` | 原型设置失败则降级为普通对象（值仍正确）+ 不抛错 |
| V12 | 权限覆盖范围 | 只覆盖实测被误报的 5 项 | 其余权限**原样透传**（未知权限不猜） |
| V13 | 逐项隔离 | 每项 evasion 独立 try/catch | 单项失败进 `failed`，不阻断其余项 |
| V14 | 宿主缺失 | 宿主对象不存在 ⇒ 提前 return（跳过） | 记为**跳过而非失败**（缺能力属正常，避免真机刷无意义告警） |

---

## 6. 功能逻辑

### 6.1 evasion 逐项规格（源码见 `electron/stealth/evasions.js`）

| id | 前提条件 | 行为 | 取值来源 |
|----|---------|------|---------|
| `chrome.keys` | `window.chrome` 为对象 | 缺失时补 `app` / `csi` / `loadTimes` | `performance.timing` 派生（毫秒→秒），与真实 API 同形 |
| `navigator.userAgentData.brands` | `navigator.userAgentData.brands` 存在且 UA 含 `Chrome/<major>` | 在**首位**插入 `{brand:'Google Chrome', version:major}`，冻结数组，原 GREASE 品牌原样保留 | 自身 UA + 内核已有品牌 |
| `notification.permission` | `Notification.permission` 是访问器 | `granted` → `default`；`denied` 保留 | 常量（Chrome 全新站点态） |
| `permissions.query` | `window.Permissions.prototype.query` 存在 | 5 项权限 `granted` → `prompt`（保原型） | 常量（Chrome 全新站点态） |

**已存在则不覆盖**：`chrome.csi` / `chrome.app` / 已含的 `Google Chrome` 品牌一律保留宿主真实实现（幂等）。

### 6.2 双消费方

| 消费方 | preload | 作用范围 |
|--------|---------|---------|
| `webview-manager/tab-lifecycle.js` | `monitor-preload.bundle.js` | 浏览标签 + 账号标签（用户点开平台页面的路径） |
| `rpa-view-session.js` | `stealth-preload.bundle.js` | RPA 发布窗口 |

内嵌主页（home-shell）标签**不注入**：它加载的是本应用自己的 UI，注入既无意义又有破坏风险（`tab-lifecycle.js` 中 homeShell 分支覆盖 preload，本片未改动该分支）。

---

## 7. 交互逻辑（用户可见行为）

| 场景 | 本片前 | 本片后 |
|------|--------|--------|
| 点开账号标签浏览平台 | 主世界是「空 `window.chrome` + 全权限 granted + 无 Google Chrome 品牌」的伪 Chrome | 与真实 Chrome 一致 |
| 页面调用 `navigator.permissions.query` | 一律 `granted` | `prompt`（全新站点态） |
| 站点读取 `window.chrome.csi()` | `undefined` ⇒ 抛错（部分站点据此判非 Chrome） | 返回与 `performance.timing` 同源的对象 |
| 用户关闭反检测 | 无此能力 | `MP_BROWSER_STEALTH=0` 一次性回滚（改配置不改代码） |
| 反检测注入失败 | 静默 | 主进程日志 + 渲染进程 console.warn 各留痕，**页面功能不受影响** |

**零新增交互**：本片不新增按钮、开关、弹窗、向导或设置项。

---

## 8. 显示项与提示文字

### 8.1 用户界面

**零新增、零修改。** 本片不触碰任何 `.vue` / locale 文件，因此：

- 不涉及 i18n（`zh.js` / `en.js` 成对修改门禁不受影响）；
- 不涉及视觉回归（QM-4 无新增基线）；
- 用户界面上看不到任何变化。

### 8.2 日志文案（唯一新增的可见文本，均在日志域）

| 位置 | 级别 | 文案（zh，逐字） |
|------|------|-----------------|
| `inject.js` | warn | `[stealth] webFrame.executeJavaScriptInIsolatedWorld 不可用，主世界反检测未注入（页面功能不受影响）` |
| `inject.js` | warn | `[stealth] 主世界注入同步抛错，页面功能不受影响：<message>` |
| `inject.js` | warn | `[stealth] 主世界反检测未完整生效：state=<s> applied=<…> failed=<…>` |
| `inject.js` | warn | `[stealth] 主世界反检测部分项失败：<failed>` |
| `inject.js` | warn | `[stealth] 主世界标记读回失败（注入结果未知）：<message>` |
| `inject.js` | warn | `[stealth] 主世界标记读回结果不可解析，反检测状态未知` |
| `inject.js` | warn | `[stealth] 主世界反检测已被 MP_BROWSER_STEALTH=<v> 关闭（平台风控误判概率上升）` |
| `utils.js` | warn | `monitor-preload.bundle.js 不存在，已回退源文件；sandbox 下相对 require 会失败 ⇒ 主世界反检测将不可用（页面功能不受影响）。修复：在 apps/desktop 执行 pnpm run build:preload` |
| `rpa-view-session.js` | warn | （同形，替换为 `stealth-preload.bundle.js`） |
| `monitor-preload.js` / `stealth-preload.js` | warn | `[stealth] 主世界反检测装载失败（页面功能不受影响）：<message>` |

**文案纪律**：
- 一律显式声明「页面功能不受影响 / 发布流程不受影响」——避免运维把它误读为故障；
- 不出现「已保护」「已隐身」这类无法验证的承诺；
- 不出现平台名以外的品牌名（Gate 12 品牌残留会打红）。

---

## 9. 不修项与理由（诚实边界）

### 9.1 本就正常、**禁止**触碰的项

`webdriver` / `plugins` / `mimeTypes` / `pdfViewerEnabled` / `vendor` / `hardwareConcurrency` /
`deviceMemory` / WebGL vendor+renderer / `chrome.runtime`——实测与真实 Chrome 一致。
**旧 `stealth-preload.js` 对前三项动手**：把 5 个真实插件换成含 `Native Client` 的 3 项假列表
（现代 Chrome 早已没有 Native Client）、凭空造 `chrome.runtime`（真实 Chrome 网页上也是 `undefined`）。
`evasions.test.js` 有专门 describe 锁死「源码不得出现这些改写」，防止后人"顺手补全"。

### 9.2 `navigator.languages` 不修

Electron 报 `['zh-CN','zh-Hans-CN']`、Chrome 报 `['zh-CN','zh']`。
只改 JS 读数会与请求头 `Accept-Language` 不一致，制造**新**破绽；正确取值取决于本机语言配置，
属未取证项。**宁可保留已知小差异，也不引入未知矛盾。**

### 9.3 权限「实际授予」未收紧

实测：Electron 未安装权限处理器时对**所有**权限请求一律放行（`setPermissionRequestHandler` 未设即 granted）。
本片只改**报告值**。残留矛盾：报告 `prompt`，但页面真去请求仍可拿到。

未一并收紧的原因：需要按 Electron 权限名逐项白名单（`fullscreen` / `pointerLock` 等若被一并拒绝
会真实破坏站点功能），是独立于指纹修复的另一处变更，应各自取证与回归。
**登记为后续项**（§12），不假装已闭合。

### 9.4 未取证项

`Sec-CH-UA` 请求头品牌列表、DNS/QUIC/TLS 指纹（JA3）、IP 归属与代理链路——本片未取证，
故未做任何"优化"。分析文档 §6 如实登记。

---

## 10. 测试计划与证据

### 10.1 单测（TDD，含"不许碰"的反向锁）

| 文件 | 用例数 | 锁什么 |
|------|-------|-------|
| `electron/stealth/evasions.test.js` | 21 | 源码可求值/无模块系统调用；**执行真实源码本体**；标记三态；4 项 evasion 行为；幂等；高熵一致；原型保持；未覆盖权限透传；宿主缺失安全降级；**源码不得改写 webdriver/plugins/mimeTypes/chrome.runtime/languages** |
| `electron/stealth/inject.test.js` | 22 | worldId=0 + userGesture；**同步发起**；开关解析（含大小写/未知值）；失败不抛错；三态读回四分支；读回失败与注入失败措辞区分 |
| `electron/core/preload-path.test.js` | 7 | bundle 优先/回退/异常降级；**三个 bundle 均已产出**；bundle 内确实内联 stealth 源码 |
| `electron/monitor-preload.test.js` | 7 | 注入先于桥；使用真实 webFrame；stealth 装载失败不阻断桥；**能力面回归锁**（暴露名与成员集合逐字不变） |

既有回归锁更新 1 处：`webview-manager.test.js` 的 preload 断言由逐字 `monitor-preload.js`
放宽为 `monitor-preload(\.bundle)?\.js$` 并**新增**「不得是 home-shell preload」断言——意图不变、判据更严。

### 10.2 真机取证（harness 已入库，可复现）

| harness | 证明 |
|---------|------|
| `scripts/probe-main-world-injection.js` | 注入达主世界且早于页面脚本；隔离世界标记主世界不可见；sandbox 无法 require 相对文件；逐项指纹取值 |
| `scripts/probe-browser-fingerprint.js` | 生产 preload A/B（`MP_BROWSER_STEALTH` 开/关）与真实 Chrome 逐项对照 |

Raw 产物：`01-docs/evidence/zhihu-stealth-mainworld-2026-10-15/`（4 个文件）。

**harness 使用前置**：必须清掉 `ELECTRON_RUN_AS_NODE`（该变量会让 electron 退化成纯 Node，
表现为 `require('electron')` 返回可执行文件路径字符串、`app` 为 `undefined`）。

### 10.3 复跑命令

```powershell
cd apps/desktop
pnpm run build:preload                         # 重建 4 个 bundle（必须，源码改动后）
npx vitest run electron/stealth electron/monitor-preload.test.js electron/core/preload-path.test.js
Remove-Item Env:\ELECTRON_RUN_AS_NODE
../node_modules/electron/dist/electron.exe scripts/probe-browser-fingerprint.js
```

---

## 11. 回滚

| 粒度 | 动作 |
|------|------|
| 关反检测（不打回滚代码） | `MP_BROWSER_STEALTH=0`（一次性、进程级、出声告警） |
| 只回滚某消费方 | 移除该处 preload 接线（`tab-lifecycle.js` / `rpa-view-session.js` 各一行） |
| 完全回滚 | 恢复 `monitor-preload.js` / `stealth-preload.js` 原内容并删 `electron/stealth/`（4 个文件 + 3 处接线，无数据迁移、无持久化状态） |

**无数据面影响**：不写数据库、不改凭证、不动 Cookie 分区。

---

## 12. 后续项（不在本片闭合）

1. **权限实际授予收紧**（§9.3）：按 Electron 权限名建白名单，需先枚举权限名并逐项验证不破坏站点功能。
2. **`navigator.languages` 与 `Accept-Language` 一致性**（§9.2）：需先取证 Electron 语言配置传递链。
3. **`Sec-CH-UA` 请求头品牌**（§9.4）：需 `webRequest.onBeforeSendHeaders` 抓包取证。
4. **openclash 分流**（网络侧，非代码）：知乎域名走直连，属用户侧配置，见分析文档 §4。
5. **`_homeShellPreloadPath` 与本片新增的 `resolveBundledPreloadPath` 合并**：现存两份同形实现，
   合并需同步 `home-shell-preload` 相关锁，属清理项。
