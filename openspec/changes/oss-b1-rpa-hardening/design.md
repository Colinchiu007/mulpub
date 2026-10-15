# Design: oss-b1-rpa-hardening

> 完整设计（含 spike 实测矩阵、接口契约、测试计划、manifest、体积账、UI/i18n、回滚、跟踪项）以 **`01-docs/PRD-OSS-RPA-HARDENING-2026-10-14.md`** 为单一真源，本文只记录设计决策与理由，不复制 PRD 内容（防止双源漂移）。

## 关键设计决策

> 状态标注（处置 plan-review i8）：`[已落地]` = 本 change 提交 1–5 已实现且测试 GREEN；`[待落地]` = 归 PR-2（F3/F4）或跟踪项。

### D1：注入通道选 preload 而非 debugger [已落地]

spike（2026-10-14，RPA 同构 webPreferences）实测：sandbox preload 暴露 `require('electron').webFrame`，`executeJavaScriptInIsolatedWorld(0, [{code}], true)` 在主世界 document_start 注入且**早于页面脚本**（页面 `atScriptStart` 已见 marker）。debugger 通道虽同效，但有四类失败模式（fresh window Page.enable HUNG 实测/需 about:blank bootstrap/CDP 命令挂起需超时竞速/与上传 per-op attach 冲突），且 attach→注入→detach 生命周期与 rpa-view-helpers.js:268 的单 debugger 实例制冲突。**preload 方案零 attach 生命周期，每文档自动运行**。风险：preload 未执行=注入缺失——以页面 marker 读回观测 + 降级 warn 兜底。

**与 D3 的职责边界（处置 plan-review i7）**：两条注入机制各司其职、刻意不共用同一 world——
- **D1（主世界，`executeJavaScriptInIsolatedWorld(0)`）**：evasions 必须在主世界，因为它们要覆写页面可访问的 `navigator.webdriver`/`chrome.runtime` 等属性；放进 isolated world 页面脚本读不到，等于没装。
- **D3（isolated world，`Page.createIsolatedWorld`）**：DOM 自动化 evaluate（查元素/读状态）放隔离域，页面脚本无法探测或篡改自动化代码的执行，反侦察方向与 D1 相反。
- worldName 约定：isolated world 统一用 `mp-rpa-automation`，主世界注入无 worldName（worldId=0）。
- 页面探测可见性差异：主世界注入物可被 `Function.prototype.toString`/property descriptor 探测（见下 i2 缓解），isolated world 内容对页面完全不可见。

**evasions 指纹化缓解（处置 plan-review i2）**：evasions 以主世界注入确可被 toString/行为探测指纹化。缓解分三层：① `evasions-bundle.js` 内每个覆写点安装后删除自身引用（自清理，不留可枚举钩子）；② 覆写属性一律 `Object.defineProperty` 非枚举 + 冻结 descriptor（页面无法通过 getOwnPropertyDescriptor 拿到安装痕迹做差分）；③ 与 D3 配合——检测方能看见的只是「主世界多了一批不可枚举属性」，这与真实浏览器扩展/CDP 宿主的属性面同形，不构成独立检测面。残余风险记 R3（evasion hash 检测面，跟踪项 3），首批取证后再评估按平台拆分子集。

### D2：行为层传输无关接口先行 [已落地]

移植源是 Playwright Python（`locator.bounding_box()`）与 CloakBrowser Python（`page.mouse`）形状，直接落到 BrowserWindow+CDP 环境缺适配层；且 camofox driver 要复用。故先定 `dispatch/getBounds/typeText` 三方法接口（纯 CDP Input/DOM 域词汇），`cdp-input.js` 与 camofox driver 各实现一版，RED 测试锁接口层。（评审 H3）

### D3：isolated world 用 createIsolatedWorld+cache，不动通信 binding [已落地]

spike 实测 `Page.createIsolatedWorld({frameId})→executionContextId→Runtime.evaluate({contextId})` 隔离语义成立。SPA 导航后 frameId/contextId 失效——did-navigate 失效重建进 RED。迁移范围限 DOM 自动化 evaluate；`exposeBinding`/localStorage 恢复脚本留痕面（patchright 同点）v1 不动，控风险。

### D4：sidecar-host 通用契约四件套 [待落地：PR-2]

`start(manifest)/health()/stop()/onExit`，manifest 含 vendor 版本/sha256/license/监听约束。满足：F3 camoufox、F4 ddddocr、B2 STT/clone 复用。完整性校验在下载后与 spawn 前两次（禁 TOFU + 防篡改）。

**token 生命周期（处置 plan-review i1）**：sidecar token 由宿主在 `start()` 时用 `crypto.randomBytes(32)` 生成、经 spawn **env 注入**（不经 argv——argv 同 `/proc/<pid>/cmdline` 可读，env 在 Windows 需 Administrator 提权才可跨进程读，且 POSIX 经 `/proc/<pid>/environ` 同理受限）；TTL 与 sidecar 进程寿命绑定（进程退出即失效，无跨进程重放面）；无轮换需求（单会话单实例，重启=新 token）；撤销=kill sidecar。同机 Administrator 级攻击者不在威胁模型内（其可直接读宿主内存里的凭证库，token 防线无意义）。PR-2 实现时按本节落地并在 `stealth-channel-sidecar/spec.md` 复核。

### D5：captcha 人工兜底走既有发布进度面板 [相位接线已落地；兜底超时路径待落地：PR-2]

不建新组件——publishProgress store 是发布进度唯一承载（项目铁律），`PHASE_ENUM` 加 `captcha` 相位并三处同步（emitter/store/TERMINAL_PHASES）。

**人工兜底超时/取消/放弃路径（处置 plan-review i5）**：用户不干预时发布不得永久停留 captcha 相位（破坏 TERMINAL_PHASES 收敛语义）。三条出口（PR-2 实现，本 PR 已把 `captcha` 相位与中性终态接线备好）：
- **超时**：captcha 相位默认 120s 倒计时（`MP_CAPTCHA_TIMEOUT_MS` 可覆盖，非法值回落默认并出声告警）；倒计时归零 → 任务落 `task:failed`（error=`CAPTCHA_TIMEOUT`），走既有 failed 终态（不新增终态类型）。
- **取消**：发布进度面板提供「跳过此平台」按钮 → 该平台任务落 `task:cancelled`（中性终态，与既有取消语义一致）。
- **放弃**：用户关闭应用 → 重启后该任务按 run-state 快照恢复为 failed（`CAPTCHA_ABANDONED`），不自动重试（验证码跨会话不可复用）。

### D6：映射表配置化而非硬编码 [已落地]

preload 变体、stealth 通道、captcha 白名单三张表都进 `publish-capabilities.json`（平台内容能力单一真源的邻居），运营可调、kill-switch 改配置即回滚。

**配置完整性（处置 plan-review i3）**：`publish-capabilities.json` 随应用打包进 asar，篡改需重打包或解包重封——本地改 JSON 静默绕过不在威胁模型内（攻击者已可改任意代码）。运营层防护已够：① preload 变体映射不可用一律 fail-closed 回落 baseline + warn（`preload-variant-failclosed.test.js` 锁死）；② 配置值非法/越界一律回落默认并出声告警（既有 env 纪律同款）；③ 审计需求走既有 logger（变体选择与回落均有日志）。签名/哈希校验留给远端下发场景（ops-center 同步链路已有独立校验），本地打包配置不加（防不了同权攻击的校验是假门）。

## Specs（能力规格）

> 文件名统一小写 `spec.md`（处置 plan-review i6；下方原 `Spec.md` 写法已纠正，PR-2 落地时按此命名）。

- `specs/rpa-stealth-injection/spec.md`：注入契约三要素、kill-switch、marker 观测、H2 缓解
- `specs/rpa-behavior-layer/spec.md`：行为层接口、轨迹算法不变量、变异反证要求
- `specs/rpa-isolated-execution/spec.md`：isolated world 路径、缓存失效重建、降级
- `specs/stealth-channel-sidecar/spec.md`：sidecar-host 契约、版本钉定+sha256、127.0.0.1+token（生命周期见 D4 补充）、回退
- `specs/captcha-solver/spec.md`：链路、默认关+白名单、频控、人工兜底（超时/取消/放弃见 D5 补充）、PHASE_ENUM 同步

## 本 change 改动文件清单（供 CCG 决策层 plannedFiles 范围比对）

实现代码（提交 1–5，`git diff --name-only main...HEAD` 实测）：

- `apps/desktop/electron/services/stealth/evasions-bundle.js`
- `apps/desktop/electron/services/stealth/evasions.test.js`
- `apps/desktop/electron/services/stealth/stealth-preload-enhanced.js`
- `apps/desktop/electron/services/stealth/stealth-preload-enhanced.test.js`
- `apps/desktop/electron/services/stealth/behavior-engine.js`
- `apps/desktop/electron/services/stealth/behavior-engine.test.js`
- `apps/desktop/electron/services/stealth/cdp-input.js`
- `apps/desktop/electron/services/stealth/cdp-input.test.js`
- `apps/desktop/electron/services/stealth/isolated-world.js`
- `apps/desktop/electron/services/stealth/isolated-world.test.js`
- `apps/desktop/electron/services/stealth/preload-variant.test.js`
- `apps/desktop/electron/services/stealth/preload-variant-failclosed.test.js`
- `apps/desktop/electron/stealth-preload.js`
- `apps/desktop/electron/services/rpa-view-helpers.js`
- `apps/desktop/electron/services/rpa-view-helpers.test.js`
- `apps/desktop/electron/services/rpa-view-session.js`
- `apps/desktop/electron/services/publish-progress-events.js`
- `apps/desktop/src/stores/publishProgress.js`
- `apps/desktop/src/stores/publishProgress.test.js`
- `packages/shared-utils/src/publish-capabilities.json`
- `packages/shared-utils/src/publish-capabilities.js`
- `packages/shared-utils/src/publish-capabilities.browser.js`
- `scripts/extract-evasions.js`
- `.gitignore`

文档与流程（本 PR 内随实现回填）：

- `01-docs/PRD-OSS-RPA-HARDENING-2026-10-14.md`
- `openspec/changes/oss-b1-rpa-hardening/tasks.md`
- `openspec/changes/oss-b1-rpa-hardening/design.md`
- `openspec/changes/oss-b1-rpa-hardening/spike-evidence.md`
- `openspec/records/oss-b1-rpa-hardening.md`
- `.quality-gates.md`
- `CHANGELOG.md`

## QM-6 后端轴修订（2026-10-15，backend=claude 评审后落地）

> 共 5 条 findings（1 Critical / 2 Warning / 2 Info），逐条处置与变异反证见 `openspec/records/oss-b1-rpa-hardening.md`「QM-6 后端轴 findings 与处置」节。设计层三点修订：

1. **enhanced preload 加载物 = bundle 而非源文件**（Warning ② 处置）：`stealth-preload-enhanced.js` 在 sandbox:true 下无法 `require('./evasions-bundle.js')`（受限 polyfill 不支持相对文件 → bundle=null → evasions 全跳但 INJ_DONE 假成功）。修订为 esbuild 预内联单文件 `stealth-preload-enhanced.bundle.js`（照 `buildHomeShellPreload` 先例，新增 `buildStealthEnhancedPreload`，external 仅 `electron`），**运行时实际加载的是 bundle**；源文件仍是 evasions 装配逻辑的单一来源，bundle 是其构建产物（`build:vue` 自动生成、随仓提交）。上清单补：`apps/desktop/scripts/build-preload.js`（接入构建）、`apps/desktop/electron/services/stealth/stealth-preload-enhanced.bundle.js`（产物）。
2. **路径解析锚在 `__dirname`（services/stealth）+ existsSync fail-closed**（Critical ① 处置）：`_resolvePreloadPath` 曾拼出不存在的 `electron/stealth/`（Electron 对不存在 preload 静默不加载）。修订为 `path.join(__dirname,'stealth','stealth-preload-enhanced.bundle.js')` + `fs.existsSync` 显式校验，缺失即回落 baseline preload + `_logPreloadFallback` 出声——加载失败从「静默不生效」变为「可观测回落」。
3. **`withDebugger` owned 模式**（Warning ③ 处置）：attach 失败不得无条件 detach（会拆掉上传路径/网络取证持有的 CDP 通道）。修订为对齐 `isolated-world.js` owned 语义：`isAttached()` 已附着则复用、attach 成功才置 owned、`finally` 仅 owned 时 detach。

## 风险与未决

> R2/R3 阈值量化（处置 plan-review i4）：首批样本量 n≥15（沿用 PRD 统计依据），异常中止与回滚触发条件如下——
> - **检出率下限**：首批 15 次发布中平台风控拦截（验证码强制升级/账号限流/发布拒绝且归因风控）≥3 次（20%）→ 触发回滚：stealth 通道经 kill-switch 配置整体关闭，回落 baseline preload。
> - **误报上限**：行为层导致的发布失败（平台无风控信号但行为层步骤失败）>2 次（13%）→ 中止灰度，行为层降级回原生点击路径（`resolveRpaDriver` 回落主世界路径）。
> - **取证节奏**：首批 15 次逐条记录平台响应特征（跟踪项 1/3 共用），任何一条触发即停，不要求跑满样本量。

| # | 项 | 处置 |
|---|----|------|
| R1 | ddddocr python 栈体积 150-250MB 超预算 | PRD 评审定：按需下载备选 |
| R2 | n≥15 样本量统计依据 | 灰度首批校方差（跟踪项 1）；阈值已量化（见上：风控拦截≥3/15 即回滚） |
| R3 | evasion hash 检测面 | 按平台拆分子集+首批后取证（跟踪项 3）；阈值已量化（见上：行为层失败>2/15 即降级） |
| R4 | camofox A/B 不达 Electron 通道 | 决策 1 改判链：降级 F3 |
