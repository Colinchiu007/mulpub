# PRD-OSS-RPA-HARDENING — 开源强化 B1：RPA 反检测与验证码

> **版本**：v1.1（2026-10-14）｜ **change**：`openspec/changes/oss-b1-rpa-hardening/`
> **v1.1 = CCG 双轴评审（后端 8 条 + 前端 8 条，全部采纳）修订版**；评审与回应见 `.adversarial/b1-prd-review/`
> **依据**：《实施计划 v3.2》F1-F4 + 《决策点 v3.2》+ spike 实测（2026-10-14，`spike-evidence.md`）
> **范围**：F1（stealth 三层）+ F2（isolated world）+ F3（camofox 通道）+ F4（ddddocr sidecar）

---

## 1. 背景与目标

G1/G2 差距：RPA 发布窗口反检测仅 JS 表层且**经 spike 运行证实现有 `stealth-preload.js` 的 patch 全部不达主世界（存量缺陷，§3.1 E4b）**；验证码零能力。

目标：①RPA 窗口 stealth 拉到 social-auto-upload 同级（evasions 主世界注入+真人行为层+isolated world 执行）；②高风险平台（抖音/小红书/视频号）独立隐身通道；③验证码旁路识别+人工兜底闭环。

**非目标**：协议轨 TLS（F11 探针后置）、本地媒体（B2）、内容理解（B3）。

## 2. 合规与风险基线

| 项 | 状态 |
|----|------|
| 法务线 | **⚠️ 经产品负责人决策豁免**（2026-10-14，风险已知会并接受） |
| 能力默认姿态 | stealth evasions **默认开**（定位=还原正常浏览器环境）；**验证码自动破解默认关**（白名单显式开启+人工兜底为默认路径） |
| ToS 风险 | PRD 如实记录：产品向第三方提供规避风控能力的法务暴露由产品方承担；多账号矩阵+代理轮换信号化风险已知会 |
| AV 误报预案 | camofox/ddddocr 新 exe 纳入签名/AV 白名单台账；误报 FAQ 进支持文档 |

## 3. 架构设计（spike 结论 + 评审修订）

### 3.1 F1-c 注入通道：选型与契约

**Spike 实测矩阵**（2026-10-14，Electron 43，RPA 同构 webPreferences：`contextIsolation:true + sandbox:true`）：

| 证据 | 结论 |
|------|------|
| E4b `preloadRanSeenInMain: null`、主世界 webdriver 不被隔离世界 patch 污染 | **H1 确证**：isolated world 的 navigator patch 主世界不可见——现有 stealth-preload.js 对页面无效（存量缺陷，同 PR 修正头注） |
| E4c `preloadIsoPatchSeenInMain: "yes-injected-into-main-world"` + E6 页面 `atScriptStart` 已存在 | sandbox preload 的 `webFrame.executeJavaScriptInIsolatedWorld(0, …)` 注入主世界且**早于页面脚本** |
| E5 `require('electron').webFrame: available`（sandbox:true 实测） | sandbox preload 暴露 webFrame |
| E2/E4a `cdpInjected:'yes'` | debugger 通道亦生效（Page.enable 缺失则静默 no-op——utils.js 教训复现） |
| E1 fresh window `Page.enable` **HUNG**，about:blank 引导 362-389ms 后 RESOLVED | debugger 通道必须 blank bootstrap + 超时竞速 |
| rpa-view-helpers.js:268 上传 per-op `attach('1.3')`+finally detach | Electron 单 debugger 实例：F1-c 若常驻 attach 会与上传 attach 抛「Another debugger is already attached」 |

**选型：preload 为主通道，debugger 通道不实现**（零 attach 生命周期 vs 四类失败模式：HUNG/bootstrap/挂起竞速/单例冲突）。

**实施契约**：
1. **注入了什么**：evasion 最小集（webdriver/chrome.runtime/permissions.query/plugins/languages/iframe.contentWindow/hairline/outerDimensions），从 puppeteer-extra-plugin-stealth 提取的 MIT 版；**单一真源 = npm 包版本**，sha256+产物快照为防回归冗余（评审 F8，杜绝「三重无权威」）
2. **何时注入**：preload 顶层同步 `executeJavaScriptInIsolatedWorld(0, [{code}], true)`——document_start 语义（E6 实测早于页面脚本）
3. **注入顺序与三态观测（v1.1，评审 F1）**：
   - **首行先做最小 navigator patch**（单处 defineProperty，独立 try/catch，失败不阻断后续），其后才是完整 evasions（每项独立 try/catch）——最高价值 evasion 的暴露窗口最小化
   - `__mpStealthInj-start` marker 首行同步写入 → 读回三态：无 start=preload 未执行 / 有 start 无 done=首行失败 / start+done 但清单缺项=evasions 部分失败
   - **诚实边界**：marker 是观测不是预防——注入缺失时页面已读原生 navigator 的损害在 marker 之前发生；预防=同步注入+顺序最小化
   - 三态异常 → warn + 正常发布不阻断
4. **变异反证**：「延迟注入」变异（推迟 500ms）必须红（锁 document_start 语义）
5. **kill-switch**：`rpa-view-session.js:169` preload 挂载改按映射表选变体（`stealth-preload.js` 现状 / `stealth-preload-enhanced.js` 增强版），douyin/xiaohongshu/shipinhao 默认增强；映射表配置化（publish-capabilities.json）——配置改一行即回滚
6. **H2 风险登记**：minified init script 内容 hash 可枚举——v1 缓解=按平台拆分子集注入（①）+ 首批发布后检测面取证（③）；会话级随机化（②）留作后备
7. **存量修正（同 PR）**：stealth-preload.js 头注错误声明改为真实语义说明+指向增强版

### 3.2 F1-a/b 行为层（传输无关接口）

```js
// electron/stealth/behavior-engine.js（纯算法）
export function planMove(from, to, cfg)     // 三次贝塞尔+垂直随机控制点(±0.3dist)+ease-in-out+burst+sin wobble（CloakBrowser 算法移植 MIT）
export function planClickSequence()        // move→sleep150→click→sleep200→9 字段 pointer/mouse 序列（social-auto-upload 移植 MIT）
export function planType(text)
// electron/services/cdp-input.js（Electron 驱动）
export function createCdpInput(win) → { dispatch(kind,x,y,opts), getBounds(sel) /*DOM.getBoxModel*/, typeText }
// camofox driver（F3）实现同一接口
```
- 落点：`rpa-view-session.js` `_click/_fill` 改调行为层；**RED 锁接口层**（假 driver 断言事件序列），实现层各锁各的
- 测试：确定性 seed 轨迹断言（起终点/单调/步数/单步位移上限）+ 变异反证（摘 wobble/改线性/摘 sleep）

### 3.3 F2 isolated world 执行

**Spike 定案（E3b-E3e）**：`Page.getFrameTree → frameId` → `Page.createIsolatedWorld({frameId})` → `executionContextId` → **`Runtime.evaluate({contextId})`**（注：`Runtime.evaluateInWorld` 非真实 CDP 命令，实测 `wasn't found`——研究文档该写法以此为准更正）；隔离语义成立（iso 写主不可读）。

**实现契约（v1.1，评审 F2/F3；2026-10-14 实现期按 spike 实测修正，见下）**：
1. **缓存双键**：`contextId` 按 `frameId + documentId` 双键缓存；`did-navigate` / `did-navigate-in-page` 触发清理重建
   - **⚠️ 实现期勘误（2026-10-14，spike round2 实证）**：`Page.Frame` 对象**没有 `documentId` 字段**（该字段在 `Page.getFrameTree` 的响应中不存在于 frame 节点），双键缓存第二键实际采用 **`loaderId`**（`getFrameTree.topFrame.loaderId`，随导航更换）。最终实现：`frameId + loaderId` 双键 + `did-navigate`/`did-navigate-in-page` 事件置 `stale`（stale 优先于双键比对）+ execute 前 probe 探活 + `Cannot find context with specified id` → 清缓存重建重试一次。对应代码 `services/stealth/isolated-world.js`；**任务清单 tasks 4.1/11.4 中的 `documentId` 表述以本勘误为准**。
   - **`Page.enable` 可省**：spike round2 实证 `Page.getFrameTree` / `Page.createIsolatedWorld` 在未显式 `Page.enable` 的 debugger 会话上直接可用（与 E1 的 `Page.addScriptToEvaluateOnNewDocument` 需要 enable 不同类）；实现不调用 `Page.enable`。
2. **v1 范围显式声明**：仅 top frame。检测到多 frame DOM 作用域（iframe 内选择器）→ warn + 回落 main world；`window.open` 弹窗新 renderer 不在通道内（RPA 发布流无弹窗依赖，如出现按未覆盖 warn）
3. **悬挂恢复**：execute 前探活（一次性 `Runtime.evaluate` 空表达式），失败即重建
4. **exposeBinding 白名单守卫（评审 F3）**：`BINDING_ISOLATED_ALLOWLIST`（空或明确列举的通信 API 可入 isolated 路径）+ 测试断言「allowlist 外 API 走 isolated 必须抛错」——范围从文字声明升格为机械锁，后人无法静默扩范围
5. **迁移范围**：v1 只迁 DOM 自动化 evaluate（`_click/_fill` 等）；通信类 binding 不动（白名单守卫兜底）
   - **4.4 留痕：通信类 binding 留主世界的理由（v1 决策）**：
     ① `exposeBinding` / `exposeInMainWorld` 注册的回调与页面侧 `window.*` 通信面耦合，其调用方（发布结果回传、进度上报、探针读回）按 **main world 语义**写就，迁移即改变页面可见的全局名空间，属行为变更而非等价搬迁；② 通信面**不是**反检测暴露面（检测脚本针对的是 `navigator`/`webdriver`/UA 指纹，不读应用 binding），迁移无收益、有回归风险；③ 空 allowlist + 抛错守卫使「未来有人想迁通信面」必须先改白名单并连带补测试，把 v1 的范围声明变成机械约束（tasks 11.3 已落地）。
   - **落点修正（实现期）**：evaluate 通道实现为独立模块 `services/stealth/isolated-world.js` 的 `createIsolatedEvaluator(win)`（per-webContents 缓存 evaluator），`rpa-view-helpers.js` 的 `_isoEval` 作为唯一消费入口（WeakMap 缓存）；`_click`/`_fillInput` 迁移清单 v1 = 这两个方法，probe 与通信 binding 留主世界。
6. **降级**：任一步骤不可用 → 回落 main world + warn（禁静默）；真机取证：发布导航期间 main world 无自动化脚本痕迹

### 3.4 F3 camofox 隐身通道

- 组件：`@askjo/camofox-browser@<pinned-version>`（MIT wrapper + MPL camoufox-js + MPL Firefox fork，2026-10-13 三件套已核验；MPL 未自分发场景我方非分发者，自托管分发才会触发源码提供义务）
- **版本与完整性（评审 F4）**：npm 版本钉定 → `BUNDLED_CAMOUFOX_RELEASE` bundle 版本锁定；**hash 信任链三层**：①官方带签名（PGP/证书）渠道优先验签 ②GitHub Releases API 官方 metadata 与 npm 锁文件**两路独立交叉**取 hash，不一致即拒 ③manifest 明示「spawn 前复检防磁盘篡改、不防首次下载污染」，信任锚=两路未被同时攻破
- **监听安全（评审 F5 同款）**：CDP/WebSocket 仅绑 `127.0.0.1` + 一次性 token；构建期断言无 `--remote-debugging-port` 非回环
- 落点：`electron/services/sidecar-host.js`（start/health/stop/onExit；下载校验+受控路径复制后 spawn——Windows DLL 劫持防护）+ `stealth-channel-camofox.js`（CDP-WebSocket 驱动，复用 §3.2 行为层接口第二 driver）；rpa-view-manager `channel:'stealth'` 路由；映射表配置化
- **降级提示语义（评审 FE3）**：一次性事件（按 `channel+runId` 去重）；toast + 进度面板常驻行双承载；发布结果带 `stealthChannelFallback` reason 留痕；run 内不回切
- 回滚：映射表移除平台/整体下架 sidecar 不影响 PR-1

### 3.5 F4 ddddocr 验证码 sidecar

**链路状态机（v1.1，评审 FE1）**：
```
detecting → auto_ocr(超时 T1=15s) → manual(超时 T2=120s + 面板动作) → fail
```
- `detecting`：验证码要素检测（模板/尺寸特征），面板 captcha 相位「检测中」
- `auto_ocr`：截图→HTTP `/slide_match|/object_detection`→轨迹换算→§3.2 行为层 dispatch 派发
- `manual`：面板三动作「重试自动识别 / 我已完成 / 放弃本通道」；用户操作发布窗口完成验证
- `fail`：T2 超时或点放弃 → 该任务失败入历史（不无限挂起）
- T1/T2 环境变量可配（`MP_CAPTCHA_T1_MS`/`T2_MS`，非法值回落默认+出声告警）
- **阻塞语义**：manual 期间该任务阻塞；TaskQueue 同 `(platform,accountId)` 通道天然串行，不阻塞其他平台

**安全契约（评审 F5）**：sidecar **强绑 127.0.0.1 + 随机 token header 鉴权**（Electron 启动时生成持有）；**截图仅内存不落盘**（IPC 直传 base64，sidecar 不写临时文件）；**onnx 权重 LICENSE 核验**入 manifest 流程（common.onnx/common_det.onnx/common_old.onnx 逐件记录许可结论，MIT）。

**组件**：ddddocr（MIT）自带 `api/server.py`（FastAPI 8 端点 + MCP）——python-backend 托管子进程（桌面端拓扑；opencv/onnxruntime wheel 体积计 §6）。

**默认关**：白名单平台显式开启（配置表+开启理由记录）；人工兜底为默认路径；频控同账号 ≥5min/次。

**UI 触点**：publishProgress `PHASE_ENUM` captcha 相位；**未知相位 fallback 渲染**（显示通用相位文案，禁透传 code 原值）；`TERMINAL_PHASES` 由 PHASE_ENUM 派生（防并列维护漂移）；zh/en 成对。

## 4. B1 数据口径契约（灰度判定唯一依据）

| 项 | 定义 |
|----|------|
| 主指标 | 风控拦截率 = 风控拦截事件数 / 发布尝试数 |
| **风控判定（v1.1，评审 F6）** | **分层归类判定器**：平台返回状态码 + 失败模式（风控页 DOM/验证码出现/审核拒绝文案）→ 三分类 风控/非风控/未知；**未知进人工抽检队列**（不猜） |
| 分层 | 按平台（douyin/xiaohongshu/shipinhao/其他） |
| 对照 | 加固前同平台同期 + 灰度期 A/A；F3 双通道：**同账号在 TaskQueue 通道串行语义下天然纵向交替（pair+ctrl），「错峰」实为交替轮次，排他由通道调度保证**（v1.1 勘误） |
| 样本 | 每平台每臂 ≥15 次尝试；不足延期判定；n≥15 统计依据校验证列为跟踪项（首批数据校方差） |
| 数据源 | B1 自产（publish-progress-events 增加风控拦截相位计数），不用 publish-monitor 回查 |
| 落点 | 本 PRD + `openspec/records/oss-b1-rpa-hardening.md` 原始计数 |

## 5. 测试计划

### 5.1 单测与锁（每 F RED→GREEN + 变异反证）

| F | 单测（RED 先行） | 行为/结构锁 | 变异反证 |
|---|----------------|------------|---------|
| F1-c | 假 preload 断言注入调用与 source；marker 三态读回 | npm 版本=单一真源锁；kill-switch 映射表 | **延迟注入变异必须红** |
| F1-a/b | 确定性 seed 轨迹断言；接口层事件序列（9 字段） | 接口层锁 | 摘 wobble/改线性/摘 sleep |
| F2 | 假 debugger 断言双键缓存/失效重建/探活；未知相位 fallback 渲染 | `PHASE_ENUM ⊆ emitter` + `TERMINAL_PHASES` 派生断言；exposeBinding 白名单守卫（allowlist 外抛错） | 白名单扩项必须红 |
| F3 | sidecar-host 五态（spawn 失败/端口冲突/退出清理/sha256 不符拒落地/篡改拒 spawn）；路由映射/降级锁 | 127.0.0.1+token 绑定性断言；降级双承载+reason 留痕 | 摘 token 校验必须红 |
| F4 | solver（sidecar 不可达 fail 人工/置信度阈值/频控/轨迹换算）；状态机 T1/T2 流转；**默认关锁（白名单空=零自动破解）** | PHASE_ENUM 三处同步；i18n reason×键映射完整性 | 默认关改默认开必须红 |

### 5.2 集成/CI/真机（v1.1 补评审 F7/FE6/FE8）

- **PR-2 体积阈值 CI 断言**：ddddocr python 栈 ≤250MB，超限即红（防预算静默失控）
- **sidecar 生命周期进程级单测**：真实 spawn python-backend 子进程测端口冲突/退出清理/健康检查（不 mock 进程本体）
- **i18n 键存在性 CI lint**（PR-2 门禁）：zh/en 成对 + 引用扫描 + 孤儿键检测；reason code 未配置 i18n 键即红
- **像素视觉基线新增**（PR-2，纳入 CI 像素门禁后方可合入）：captcha 三态（detecting/auto_ocr/manual）× zh/en、通道降级提示出现态、风控表单四态（默认/空白名单/校验失败/保存回滚）
- **真机取证**：F1-c/F2/F3 按 B1 口径 n≥15；F4 夹具图 8 张（滑块 5+点选 3）识别率 ≥95%；QM-1 三层 stderr 判定（红线/NEEDS_REVIEW/空）

## 6. manifest 与体积预算

### 6.1 manifest（QM-1 打包逐项锁定）

| 组件 | 来源 | 许可 | 体积 | 锁定 |
|------|------|------|------|------|
| camoufox 二进制 | npm postinstall → 用户机本机 | MPL-2.0 | ~200MB（不进安装包） | npm 版本+BUNDLED_CAMOUFOX_RELEASE+**签名优先/两路交叉 hash**（§3.4） |
| ddddocr + onnx 权重 | pip（requirements 钉版本） | MIT（含 4 个 onnx 权重逐件核验） | wheel ~150-250MB + 权重 ~10MB | requirements 版本 + 权重 sha256 + 许可结论 |
| evasions bundle | npm（puppeteer-extra-plugin-stealth 提取） | MIT | ~180KB | **npm 版本=单一真源** + sha256/快照防回归 |

### 6.2 体积预算总账

| 项 | 增量 | 说明 |
|----|------|------|
| PR-1（F1+F2） | ≈0（180KB） | 纯 preload/JS |
| PR-2（F3） | ≈0（按需下载） | camoufox 用户本机下载 |
| PR-2（F4） | +150-250MB | ddddocr python 栈随包；**CI 断言 ≤250MB**（§5.2）；用户感知=设置页说明行「本地识别组件占用约 XXX MB，随应用安装」（数值取打包实测）+ 更新公告（评审 FE7，不做可选组件） |

## 7. UI/i18n 清单（附录见 §9）

- 发布进度面板：captcha 相位 + 未知相位 fallback + 通道降级常驻行
- 设置-发布-风控页：总开关（即时保存+失败整体回滚+禁重复点击）/ 平台白名单表格 / 开启理由（**必填**：预设枚举+备注≤50 字）/ 组件体积说明行；空态/错误/加载三态文案
- 降级提示：一次性 toast + 结果 reason 留痕（§3.4）

## 8. 回滚路径

| F | 回滚 |
|----|------|
| F1-c | 映射表一行回退现状 preload（配置改一行，无需回滚代码） |
| F1-a/b | driver 选择开关回落原生 click/fill |
| F2 | 回落 main world（运行时可观测 warn） |
| F3 | 映射表移除平台 → 回落 Electron 通道；sidecar 整体下架不影响 PR-1 |
| F4 | 白名单清空=零破解（默认关本身即回滚态） |

## 9. 附录 A：reason code × i18n 键映射表（PR-2 验收项）

| reason code | 场景 | i18n 键 |
|---|---|---|
| `captcha_detected` | 检测到验证码 | `publishProgress.captchaDetected` |
| `captcha_manual_fallback` | 自动识别失败转人工 | `publishProgress.captchaManualFallback` |
| `captcha_timeout` | manual 超时失败 | `publishProgress.captchaTimeout` |
| `ocr_sidecar_unavailable` | ddddocr sidecar 不可达 | `publishProgress.ocrSidecarUnavailable` |
| `stealth_channel_fallback` | 隐身通道降级 | `publishProgress.stealthChannelFallback` |
| `stealth_injection_degraded` | evasions 注入三态异常 | `publishProgress.stealthInjectionDegraded` |

渲染纪律：`translate(reason, params)` 未命中 → 通用降级文案 + 上报（禁透传原始英文 code、禁死键）；params 走插值禁拼接。

## 10. 附录 B：i18n 键树（zh/en 成对，CI lint 门禁）

```
publishProgress.captchaDetected / captchaManualFallback / captchaTimeout /
                ocrSidecarUnavailable / stealthChannelFallback / stealthInjectionDegraded   // 6 键
settings.riskControl.enableSwitch / platformWhitelist / reasonPreset / reasonNote /
                emptyWhitelist / saveError / loading / sizeDisclosure /
                switchOnToast / switchOffToast / reasonRequired / sizeNote                 // 12 键
```

## 11. QM 映射与里程碑

| QM | 落点 |
|----|------|
| worktree 隔离 | `mp-oss-rpa-hardening`（start-mp-task.ps1）；PR-1/PR-2 同 worktree 两个分支 PR |
| QM-6 | 每 PR 一次双模型评审（本 PRD 已过双轴 16 findings 收敛）；PR diff 评审 |
| QM-1 | 每 PR 打包+启动 8s+三层 stderr 判定；PR-2 加体积断言 |
| QM-2/视觉 | TDD RED→GREEN；PR-2 像素基线（§5.2） |
| 单一真源 | evasions=npm 版本；PHASE_ENUM；BUNDLED_CAMOUFOX_RELEASE；映射表=publish-capabilities.json |

**里程碑**：PR-1（F1+F2，零外部依赖；含 captcha 枚举+fallback+同步单测——评审 FE2 前移）→ PR-2（F3+F4，依赖 PR-1 行为层；含全部 UI/manifest/基线）。

## 12. 跟踪项（不阻塞本批）

1. n≥15 统计依据校验证（灰度首批校方差）
2. F3 A/B 后 camofox 去留（决策 1 改判链）
3. evasion hash 检测面取证（①+③ 缓解的后验）
4. 研究计划文档 F2 命令名纠正（`Runtime.evaluateInWorld` → `Runtime.evaluate+contextId`）随本文档入库的文档 PR 同步
5. B2 关联注记（GPU 闭包账/Kokoro 质量门槛）进 B2 PRD
