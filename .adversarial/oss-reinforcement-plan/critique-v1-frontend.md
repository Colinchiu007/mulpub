# 前端轴评审意见 — Multi-Publish 开源强化方案 v3

**评审对象**：4 份 artifacts（以实施计划 v3 + 决策点分析为主）
**总评**：方案整体完成度很高——「测三遍再说」「数据驱动启停」「每个决策带改判条件」都是加分项。但 B1（价值最高的第一批）的三个核心移植存在**源码环境 ✗ 落地环境的形态失配**，且"数据驱动"的判断链**难以证伪**。
**前端轴评分：7.2 / 10**（未达 8.0 阈值，4 个 HIGH 均为 PRD 阶段可闭合的修正项，非根本性路线缺陷）。

---

## HIGH（进 PRD 前必须闭合）

### H1. F1-c「preload 注入 evasions、零接线成本」的注入机制不成立

实施计划宣称把完整 evasions 扩进 `stealth-preload.js` 即可"自动全覆盖，零接线成本"，并以 social-auto-upload「同款注入」为据。但报告 2.2 实证的「同款」是 `context.add_init_script(path=stealth.min.js)`——注入的是**页面 main world**；而 Electron preload 在 contextIsolation 下运行在隔离世界，直接执行 evasion IIFE 改的是隔离世界的 `window`，**够不到页面主世界的 `navigator.webdriver` 等目标**。正确路线应是 preload 内经 `webFrame.executeJavaScript(evasionSource)`（document_start 时机）注入主世界——这是一个需要设计、测试（时机/sandbox 组合）的机制，不是零接线。PRD 必须写明注入通道及对应的结构/行为锁。

### H2. F1-c 的 evasion bundle 自身就是检测面（文档内部证据自相矛盾）

分析报告 2.1 引用 patchright `browserContextPatch` 实证「Playwright 注入的 init script 本身是检测指纹（页面可枚举 script 内容 hash）」，但 F1-c 的方案恰恰是**注入 180KB minified init script**——同一个可枚举 hash 检测面。方案未登记这层风险，也未讨论缓解（按会话随机注入顺序/拆分/或论证平台未使用该判据）。至少进 PRD 风险节；这与 F2 收敛 main-world 痕迹的方向存在张力，需统一说明。

### H3. F1-a/F1-b 的函数签名是 Python Playwright 形状，与宿主语言不匹配

- `humanizeClick(page, locator)`：移植源是 Playwright Python（`locator.bounding_box()`、`page.mouse`）；而落点 `rpa-view-session.js` 环境里没有 locator/boundingBox——它是 BrowserWindow + CDP（`DOM.setFileInputFiles`、`executeJavaScript`）。取 bounding box 得走 CDP/DOM、派发得走 `Input.dispatchMouseEvent`，中间的适配层完全未定义。
- 同理 F3 说 humanize 系列适配 Firefox CDP「API 同名，预期零改」——但如果 humanize 依赖 Electron webContents 或 Playwright page 具体类型，就无法被 camofox 的 CDP-WebSocket client 复用。**建议**：先定义一个传输无关的最小行为层接口（`dispatch(kind, xy, opts)` / `getBounds(target)`），Electron debugger-CDP 与 camofox CDP 各给一个实现。否则 PR1 的 RED 测试「假 page 断言事件序列」会在错误的抽象上锁行为。

### H4. 决策 5 的启停判断链空洞：「风控拦截率」无口径、无对照、无样本量

决策 5 以「B1 灰度数据不及预期（拦截率无统计意义改善）→ 暂停 B2/B3」为核心机制，但实施计划质量门槛没有：F1 真机取证是「可选」；F3 是 A/B（n≥0？），F1（PR1，单独合并）没有定义：风控拦截率的分子分母（成功发布/尝试发布？按平台分层？）、对照组（加固前后同平台？）、统计意义的最小样本量（publish-monitor 只查发布状态——数据回流大概率不可复用）。**口径与看板必须落在 B1 PRD**，否则「数据驱动」没有落地。

---

## MEDIUM（PRD 中说明即可）

| # | 问题 | 说明 |
|---|------|------|
| M1 | F2 isolatedWorld 的 API 钜位 | `webFrame.executeJavaScriptInIsolatedWorld` 是 **preload/webFrame 侧 API**；`rpa-view-session.js` 在主进程，不能直接调。可行路径是：①IPC→preload 转发（改调用面、有开关）②`webContents.debugger` 直接 CDP `Runtime.evaluate` 指定 utility context。Spike 应把这两条路径列为验证对象，而非只验证「语义等价性」。 |
| M2 | F6 onnxruntime-node 的原生 ABI 与线程占用未进风险登记 | nodejieba 的 electron-rebuild 风险被登记为 V7，同为原生模块的 onnxruntime-node 没有对应项；且「Electron 主进程内直跑」350MB 模型推理存在主进程事件循环占用问题——建议 utilityProcess 隔离（防拖累应用），至少 PRD 论证。 |
| M3 | B3 并行声明与 F10 依赖矛盾 | "B3 可与 B1/B2 并行（无代码依赖）"，但 F10 明文"经 F3/F1 通道"抓数据——依赖 B1 产物。要么 F10 改为 B1 后段，要么声明接口 stub 先行。 |
| M4 | 架构总览图未随 v3 同步 | 图中 F6 还标"GPT-SoVITS/piper"（v3 已改 Kokoro 默认档）；F11/F12/F13 未入图。文档彝锅 PRD 引用时放大。 |
| M5 | camofox postinstall 自动下载 vs 通用铁律 #4 | 铁律要求"新二进制 hash 锁定"；postinstall `downloadBundledCamoufox()` 是否锁定到 npm 包版本对应的固定 hash（而非 latest）、失败 warn 是否走 app 级健康检查降级（已有降级锁）——必须对照铁律写明。 |
| M6 | evasion 结构锁对 vendored minified 代码的可维护性 | "evasion 函数清单 ≥ N 项"直接对 180KB minified blob 断言很扯。建议锁上该 npm 包版本 + 提取脚本可复现，结构锁对提取产物做快照校验。 |
| M7 | stealth-preload 全量注入的分寸 | "自动全覆盖"同时意味着全部平台窗口（含低风险）都注入——建议按平台可关的 kill-switch + 失败回退，避免某平台被 evasions 反噬时无法快速停。 |

## LOW

- L1：F1 真机取证「可选」与半 Finding 定位不符（至少与 H4 的口径锁定后升为必须）。
- L2：F4 人工兜底的 UI 归属未定（失败升级到哪里？哪个组件承载？）。
- L3：F3 平台→通道映射表配置化还是硬编码未说明（含默认 douyin/xhs/shipinhao 的可运营性）。
- L4：决策文档 typo "Kokero"；F7 fluent-ffmpeg"替代裸参数拼接"的笼统范围需界定（仅字幕链 vs 全部媒体命令，防重构面过大）。

---

## 亮点（保持）

- 决策 1-5 的「改判条件」设计、CloakBrowser「价值已提取而非三进依赖」、「whisperX」验证器不是组件「、Kokoro 先建共享基建——前端轴全部认同。
- B1 拆两 PR（F1+F2 / F3+F4）与 sidecar-host 通用契约（B2 复用）是正确的模式边界。
- license 三件套教训（API spdx 不可信连续三次命中）没忘写成方法论，很值得。

## 结论

**有条件通过**：H1-H4 属 PRD 阶段可修项，不要求重做方案；修订后前端轴可达 ~8.5。建议 B1 PRD 评审时把 H1/H3（注入机制+行为层接口）作为必选项，H4（数据口径）在决策 5 启动灰度前闭合。
