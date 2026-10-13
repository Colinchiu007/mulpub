# Rebuttal v1 — 对抗评审第一轮回应

> 出方案方：opencode-hosted（step-5-preview）
> 评审方：CCG 前端轴（opencode，见 `reviews/ccg-frontend-opencode.md`，编码已修复）
> 回应规则：接受 / 部分接受 / 拒绝；附证据等级（L1 反例 / L2 约束 / L3 权衡）；拒绝须给证据
> 后端轴（claude）评审尚在运行，其 findings 将并入 rebuttal-v2 或补充回应节

---

## 前端轴 findings 逐条回应

### H1. F1-c preload 注入机制不成立（sandbox+contextIsolation 隔离世界碰不到主世界）

**回应：接受（L1 级问题，且已被本仓代码实证）。**

证据（当场取证，非推测）：
1. `apps/desktop/electron/services/rpa-view-session.js:169`——RPA 窗口 `webPreferences:{ contextIsolation:true, nodeIntegration:false, sandbox:true, preload:'.../stealth-preload.js' }`。Electron 语义（d.ts 与官方文档）：`contextIsolation:true` 时 preload 运行在**独立 JS context**，无法直接改页面主世界 `window`；`sandbox:true` 时 preload 仅有 polyfill 子集 API。
2. `apps/desktop/electron/stealth-preload.js` 全部 patch（`Object.defineProperty(navigator,'webdriver')` 等）在隔离世界执行——**对页面主世界 navigator 无感**。该文件头注「等价 Playwright context.addInitScript()」在当前 webPreferences 组合下是**错误注释**（旧代码遗留认知缺陷，非本方案引入，但方案原样继承了该错误前提）。
3. 本仓存在已验证的正确模式：`apps/desktop/electron/services/webview-manager/utils.js:143` 用 `webContents.debugger` → `Page.addScriptToEvaluateOnNewDocument` 做 document_start 主世界注入；回归锁 `webview-manager-ls-document-start.test.js`（断言 sendCommand 参数与顺序）。

**修正措施（写入实施计划 F1-c）**：
- 注入通道改为 **`webContents.debugger` + `Page.addScriptToEvaluateOnNewDocument`**（document_start、main world），与 `webview-manager/utils.js` 同基建同锁模式；preload 保留为降级路径（sandbox 关闭可行性进 spike）
- spike 验证项：①RPA 窗口 debugger attach 生命周期（`rpa-view-helpers.js:283` 现为上传时 attach——导航前常驻 attach 的时序）②attach 时 `Page.enable` 与目标建立时序（`webview-manager/constants.js:25` 已有同类注释：Page 目标未建立时 addScript 会永久挂起——必须复用其就绪等待）
- PRD 必含注入通道结构锁 + 「注入了什么、何时注入、失败降级」三要素；现有 stealth-preload.js 头注释的错误声明同步修正

### H2. evasion bundle 自身就是检测面

**回应：接受（评审引用的正是本报告 2.1 节自己引用 patchright 的论证——内部矛盾成立）。**

修正措施：报告 2.1/实施计划 F1-c 增加风险登记——180KB minified blob 的 hash 可枚举检测面；缓解方向三选一并写入 PRD 风险节：①按平台/会话拆分注入子集（只注入该平台未暴露的 evasion）②注入顺序随机化以破坏 hash 稳定性 ③论证目标平台未使用 script 内容 hash 判据（取证后结论）。与 F2「main-world 痕迹收敛」方向合并论述。

### H3. F1-a/F1-b 函数签名是 Python Playwright 形状，缺传输抽象层

**回应：接受。**评审指出的适配层真空属实：`humanizeClick(page, locator)` 的移植源 `locator.bounding_box()`/`page.mouse` 在 `rpa-view-session.js`（BrowserWindow+CDP）不存在，落点需经 CDP `DOM.getBoxModel`/`Input.dispatchMouseEvent`；且「camofox CDP 同名 API 零改」的预期建立在错误抽象上。

修正措施（F1-a/F1-b 增加设计约束）：
- 先定义**传输无关行为层接口**：`dispatch(kind: 'move'|'click'|'down'|'up'|'wheel', x, y, opts)` / `getBounds(target)` / `typeText(text)`，纯 CDP Input/DOM 域词汇
- 两个实现：`cdp-input.js`（Electron debugger 通道，包 `Input.dispatchMouseEvent` + `DOM.getBoxModel`）与 camofox CDP-WebSocket client 复用同接口
- RED 测试锁在接口层（假 driver 断言事件序列），实现层各锁各的——评审指出的「在错误抽象上锁行为」确认为测试设计缺陷，采纳

### H4. 决策 5 启停判断链空洞（风控拦截率无口径）

**回应：接受。**「风控拦截率」当前是无定义指标：无分子分母、无对照组、无样本量、无分层。publish-monitor 只查发布后状态，拿它当数据源会得出不可比数字。

修正措施（写入 B1 PRD 质量门槛）：**B1 数据口径契约**——
- 指标：`风控拦截率 = 拦截事件数 / 发布尝试数`（拦截=页面出现风控页/验证码/发布失败且原因归类为风控），**按平台分层**（douyin/xiaohongshu/shipinhao/其他）
- 对照组：加固前同平台同期（gate 2 合并前的历史发布记录或灰度期 A/A），A/B 仅用于 F3（camofox 通道 vs Electron 通道，同任务同账号错峰跑）
- 样本量：每平台每臂 ≥15 次尝试（呼应 AGENTS.md 真机 A/B「n=15」先例），不足则延期判定不硬判
- 落点：B1 PRD 的验收节 + `openspec/records/<branch>.md` 记录原始数据
- 决策 5 文档同步改为「按 B1 数据口径契约的判定结果启停」

### M1. F2 isolatedWorld API 钜位（webFrame 是 preload 侧，rpa-view-session 在主进程）

**回应：接受。**补充后 spike 验证对象：①`webFrame.executeJavaScript`（preload 侧，需确认 sandbox 子集是否暴露 webFrame——未验证前不断言）②主进程 `webContents.debugger` → `Runtime.evaluate` 指定 `contextId`（utility context）③本条与 H1 的 `Page.addScriptToEvaluateOnNewDocument` 合并为同一条 CDP 主世界通道设计。计划原文「只验证语义等价性」过窄，采纳扩展。

### M2. F6 onnxruntime-node 原生 ABI 与主进程事件循环占用未进风险登记

**回应：接受。**修正：①风险登记册补 V9「onnxruntime-node 与 nodejieba 同属原生模块，electron-rebuild + ABI 对齐」②采纳 utilityProcess 隔离建议（350MB 模型推理在主进程的事件循环占用论证进 PRD），sidecar-host 契约已预留（F3/F4/F5 共用），Kokoro 走 utilityProcess 进程

### M3. B3 并行声明与 F10 依赖矛盾

**回应：接受。**修正：F10 显式标注「依赖 B1 产物（F3/F1 通道）→ 排 B2 之后」，B3 并行声明收窄为「F8/F9 可与 B1/B2 并行；F10 不可」

### M4. 架构总览图未随 v3 同步（F6 标 GPT-SoVITS/piper、F11/F12/F13 未入图）

**回应：接受。**修订版计划更正架构图：F6 改「Kokoro 本地 TTS（GPT-SoVITS 可选重档）」、补 F11 TLS 层、F12 下载通道、F13 代理池四节点

### M5. camofox postinstall 自动下载 vs 铁律 #4「新二进制 hash 锁定」

**回应：接受。**修正：F3 验收增加「版本钉定」条款——生产消费 `npm install @askjo/camofox-browser@<pinned-version>` 并锁定该版本对应的 camoufox 二进制 bundle version/sha256（BUNDLED_CAMOUFOX_RELEASE 常量就是为此存在），禁 latest 漂移；下载失败走既有 warn→手动 fetch-bin→通道降级三级

### M6. evasion 结构锁对 vendored minified 代码的可维护性

**回应：接受。**修正：结构锁改为「npm 包版本锁定（package.json 精确版本）+ 提取脚本 sha256 + 提取产物快照 hash」三重锁，取代「180KB blob 直接比对」

### M7. stealth-preload 全量注入缺 kill-switch 与失败回退

**回应：接受。**修正：F1-c 增加「按平台 kill-switch（映射表可关）+ 注入失败回退纯 Electron 通道并 warn」条款，纳入映射表默认值设计

### L1. F1 真机取证「可选」与 Finding 定位不符

**回应：接受。**与 H4 修正合并：F1 真机取证改为「必须」并纳入 B1 数据口径契约

### L2. F4 人工兜底 UI 归属未定

**回应：接受。**修订：F4 增加「人工兜底走发布进度统一面板（publishProgress store 承载，PHASE_ENUM 增加 captcha 相位枚举三处同步）」，与项目「发布进度事件单一来源」铁律对齐

### L3. F3 平台→通道映射表配置化还是硬编码

**回应：接受。**修订：F3 明确映射表为配置化（publish-capabilities.json 登记风控标记字段或同级配置），默认 douyin/xiaohongshu/shipinhao 可运营调整

### L4. 决策文档 typo「Kokero」；F7 fluent-ffmpeg 替代范围需界定

**回应：接受。**修订：①typo 修正 ②F7 界定为「txt/etch 命令构造层（滤镜链拼装）替代，不涉音频解码/编码底层」

---

## 待后端轴 findings 汇入后处理

后端轴（claude）评审运行时已完成对 camoufox package.json 等实证读取，预计将覆盖：许可证结论复核、安全/ToS 风险、打包纪律一致性。其 findings 到达后：①并入本文件补充回应节 ②与前端轴重合的合并处理 ③一次性修订 4 份文档 → proposal-v2 → claude 第二轮复核（critique-v2）→ 收敛。

## 当前收敛状态

- 前端轴：4 HIGH + 7 MEDIUM + 4 LOW = 15 条，**全部接受**（无拒绝项——评审质量高，逐条有据）
- 修订动作已全部明确到文件级；等后端轴 findings 一次性落修订
