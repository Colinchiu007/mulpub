# Design: oss-b1-rpa-hardening

> 完整设计（含 spike 实测矩阵、接口契约、测试计划、manifest、体积账、UI/i18n、回滚、跟踪项）以 **`01-docs/PRD-OSS-RPA-HARDENING-2026-10-14.md`** 为单一真源，本文只记录设计决策与理由，不复制 PRD 内容（防止双源漂移）。

## 关键设计决策

### D1：注入通道选 preload 而非 debugger

spike（2026-10-14，RPA 同构 webPreferences）实测：sandbox preload 暴露 `require('electron').webFrame`，`executeJavaScriptInIsolatedWorld(0, [{code}], true)` 在主世界 document_start 注入且**早于页面脚本**（页面 `atScriptStart` 已见 marker）。debugger 通道虽同效，但有四类失败模式（fresh window Page.enable HUNG 实测/需 about:blank bootstrap/CDP 命令挂起需超时竞速/与上传 per-op attach 冲突），且 attach→注入→detach 生命周期与 rpa-view-helpers.js:268 的单 debugger 实例制冲突。**preload 方案零 attach 生命周期，每文档自动运行**。风险：preload 未执行=注入缺失——以页面 marker 读回观测 + 降级 warn 兜底。

### D2：行为层传输无关接口先行

移植源是 Playwright Python（`locator.bounding_box()`）与 CloakBrowser Python（`page.mouse`）形状，直接落到 BrowserWindow+CDP 环境缺适配层；且 camofox driver 要复用。故先定 `dispatch/getBounds/typeText` 三方法接口（纯 CDP Input/DOM 域词汇），`cdp-input.js` 与 camofox driver 各实现一版，RED 测试锁接口层。（评审 H3）

### D3：isolated world 用 createIsolatedWorld+cache，不动通信 binding

spike 实测 `Page.createIsolatedWorld({frameId})→executionContextId→Runtime.evaluate({contextId})` 隔离语义成立。SPA 导航后 frameId/contextId 失效——did-navigate 失效重建进 RED。迁移范围限 DOM 自动化 evaluate；`exposeBinding`/localStorage 恢复脚本留痕面（patchright 同点）v1 不动，控风险。

### D4：sidecar-host 通用契约四件套

`start(manifest)/health()/stop()/onExit`，manifest 含 vendor 版本/sha256/license/监听约束。满足：F3 camoufox、F4 ddddocr、B2 STT/clone 复用。完整性校验在下载后与 spawn 前两次（禁 TOFU + 防篡改）。

### D5：captcha 人工兜底走既有发布进度面板

不建新组件——publishProgress store 是发布进度唯一承载（项目铁律），`PHASE_ENUM` 加 `captcha` 相位并三处同步（emitter/store/TERMINAL_PHASES）。

### D6：映射表配置化而非硬编码

preload 变体、stealth 通道、captcha 白名单三张表都进 `publish-capabilities.json`（平台内容能力单一真源的邻居），运营可调、kill-switch 改配置即回滚。

## Specs（能力规格）

- `specs/rpa-stealth-injection/spec.md`：注入契约三要素、kill-switch、marker 观测、H2 缓解
- `specs/rpa-behavior-layer/Spec.md`：行为层接口、轨迹算法不变量、变异反证要求
- `specs/rpa-isolated-execution/spec.md`：isolated world 路径、缓存失效重建、降级
- `specs/stealth-channel-sidecar/spec.md`：sidecar-host 契约、版本钉定+sha256、127.0.0.1+token、回退
- `specs/captcha-solver/Spec.md`：链路、默认关+白名单、频控、人工兜底、PHASE_ENUM 同步

## 风险与未决

| # | 项 | 处置 |
|---|----|------|
| R1 | ddddocr python 栈体积 150-250MB 超预算 | PRD 评审定：按需下载备选 |
| R2 | n≥15 样本量统计依据 | 灰度首批校方差（跟踪项 1） |
| R3 | evasion hash 检测面 | 按平台拆分子集+首批后取证（跟踪项 3） |
| R4 | camofox A/B 不达 Electron 通道 | 决策 1 改判链：降级 F3 |
