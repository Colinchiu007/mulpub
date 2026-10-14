# Proposal: oss-b1-rpa-hardening（开源强化 B1——RPA 反检测与验证码）

## Why

PROJECT-003 的 RPA 发布链存在两个已取证差距，且其一为**存量缺陷**：

1. **反检测仅 JS 表层且实际不达主世界（G1-a）**：`rpa-view-session.js:169` 的 BrowserWindow 为 `contextIsolation:true + sandbox:true`，`stealth-preload.js` 的 `Object.defineProperty(navigator,'webdriver')` 等 patch 作用于**隔离世界**。2026-10-14 spike 运行时确证：主世界读不到 preload 的 `window.__preloadRan`、`navigator.webdriver` 不被隔离世界 patch 污染——**现有 stealth preload 对页面指纹修改全部无效**（头注「等价 Playwright addInitScript」为错误声明）。对照 social-auto-upload（MIT）的 `add_init_script` 主世界注入 + patchright 的 isolated world 工程，差距是系统性的。
2. **验证码零能力（G2）**：RPA 遇滑块/点选验证码只能人工介入；ddddocr（MIT，14.8k⭐，自带 FastAPI+MCP）提供零改代码集成路径。
3. **高风险平台无独立通道（G1-c）**：抖音/小红书/视频号风控最强，需按平台切换隐身浏览器通道（camofox-browser，MIT+MPL 许可链已三件套核验）。

高 frenzy 风险经评审建立基线：反检测+验证码作为商业产品能力的法务暴露已知会（产品负责人 2026-10-14 决策豁免法务线，风险接受）；stealth 默认开（还原正常浏览器环境）、验证码破解默认关（白名单+人工兜底）。

## What Changes

### ADDED Capabilities

- **evasions 主世界注入（F1-c）**：sandbox preload 经 `webFrame.executeJavaScriptInIsolatedWorld(0, …)` 在 document_start 前注入主世界（spike 实测早于页面脚本）；evasion 最小集从 puppeteer-extra-plugin-stealth 提取（MIT，npm 版本+提取脚本 sha256+产物快照三重锁）；平台→preload 变体映射表（kill-switch）；注入 marker 读回与失败降级
- **真人行为层（F1-a/b）**：传输无关接口 `dispatch/getBounds/typeText` + 贝塞尔轨迹引擎（CloakBrowser 算法移植，MIT）+ 真人事件序列（social-auto-upload `_native_click` 移植，MIT）+ `cdp-input.js` Electron 驱动
- **isolated world 执行（F2）**：`Page.createIsolatedWorld + Runtime.evaluate(contextId)`（spike 实测隔离语义成立；命令名以 `Runtime.evaluate+contextId` 为准，纠正计划文档的 `Runtime.evaluateInWorld` 错误写法）；DOM 自动化 evaluate 迁移，通信类 binding 不动；降级回落 main world
- **camofox 隐身通道（F3）**：`sidecar-host.js` 通用宿主（版本钉定+sha256 强制校验+完整性校验+127.0.0.1+token）+ `stealth-channel-camofox.js` 驱动（复用行为层接口）+ rpa-view-manager `channel:'stealth'` 路由 + 映射表配置化
- **ddddocr 验证码 sidecar（F4）**：python-backend 托管 ddddocr HTTP 服务（自带 8 端点）；检测→截图→识别→行为层轨迹派发→人工兜底全链；默认关+白名单；publishProgress `PHASE_ENUM` captcha 相位（三处同步）+ zh/en 文案

### MODIFIED Capabilities

- `stealth-preload.js`：头注修正为真实语义（isolated world 无效声明），指向增强变体
- `rpa-view-session.js`：preload 挂载改为映射表选变体；`_click/_fill` 改调行为层；自动化 evaluate 评估迁移 isolated
- `publish-progress-events.js` / `stores/publishProgress.js`：风控拦截相位计数（B1 数据口径数据源）+ captcha 相位
- `publish-capabilities.json`：平台风控标记（preload 变体/stealth 通道/captcha 白名单三张映射表的配置化载体）

## Impact

- **代码面**：`apps/desktop/electron/`（services×4 新增、rpa-view-session/rpa-view-manager/publish-progress-events 修改、stealth-preload 头注）+ `packages/shared-utils`（行为引擎可放 shared）+ locales zh/en + python-backend（captcha 托管路由）
- **体积**：PR-1 ≈0；PR-2 ddddocr python 栈 +150-250MB（超预算则改按需下载，PRD §6.2）
- **安全面**：127.0.0.1+token 绑定、sha256 强制校验、受控路径 spawn、captcha 默认关——四道已入 PRD
- **数据面**：B1 数据口径契约七要素（PRD §4）作为灰度判定唯一依据

## 决策留痕（评审收敛态）

- F3 选型 camofox-browser（决策 1：CloakBrowser OEM 条款不触）
- F1-c 注入通道选 preload 方案（spike 双通道对比：A debugger 有四类失败模式，B 零生命周期）
- 验证码破解默认关（法务基线）
- 法务线经产品负责人决策豁免（2026-10-14）
