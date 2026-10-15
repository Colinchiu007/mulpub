---
record: oss-b1-rpa-hardening
task: B1 RPA 反检测加固 PR-1（F1 evasions/行为层/captcha 相位/preload 变体 + F2 isolated world + 接线）
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 不存在
sync_backfill_owner: 合并后由后续 docs PR 回填并删除本段三个 sync_* 字段
---

## 本次执行记录：B1 RPA 反检测加固 PR-1（oss-b1-rpa-hardening，2026-10-14）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码：worktree `D:\Data\projects\mp-worktrees\mp-oss-rpa-hardening`（D 盘，非 C 盘），裸分支 `oss-rpa-hardening`，5 个实现提交 291865a10→53a3a71df |
| 第一性原因（QM-5 ①） | N/A | 新功能（非 bug 修复），无第一性原因溯源需求 |
| 逃逸分析（QM-5 ②） | N/A | 新功能，无逃逸链 |
| 修复 + 回归保护（QM-5 ④） | PASS | 每模块 RED→GREEN + 结构锁：evasions 提取 8/8、stealth-preload 7/7、behavior-engine 6/6、cdp-input 5/5（变异反证 Step C 7/7 CAUGHT）；isolated-world 11 条契约 + 反证 7/7；接线结构锁 3 条 + 行为接线 10 条 + 反证 9/9；captcha 相位反证 1/1；消费者并集 93/93 GREEN |
| 防止再次发生（QM-5 ⑤） | PASS | 结构锁防主世界泄漏（`_isoEval` 接线断言）；`preload-variant-failclosed.test.js` 锁 fail-closed 回落；`evasions.test.js` 锁提取保真（源码 diff 逐字节比对） |
| 行尾与 diff 对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐行一致（9 个文档文件）；三个生成 bundle（index.bundle.js / home-shell-preload.bundle.js / card-paginator.iife.js）被 build:preload/build:paginator 重写后两口径 numstat 均为空 → 内容与 HEAD 一致，无需提交 |
| 接线棘轮 | PASS | 新增测试均在 `apps/desktop` workspace 内（vitest workspace 自动收集）；`scripts/extract-evasions.js` 无新增测试文件（一次性提取工具，产物由 evasions.test.js 保真锁覆盖） |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1：首次直接 `electron-builder --win --dir` 被三层判据抓出 `ERR_FILE_NOT_FOUND dist/index.html`（跳过 build:vue 缺 renderer 产物）→ 改走 `pnpm run build:dir`（= build:vue + electron-builder --dir）EXIT=0；asar 清单含 `\dist\index.html` + 5 个 stealth 模块（behavior-engine/cdp-input/evasions-bundle/isolated-world/stealth-preload-enhanced）；asar 抽取后 require 链 rpa-engine + 4 stealth 模块全 OK；启动测试 10 秒存活、LAYER1 红线零命中、stderr 仅 `DEP0180 fs.Stats constructor` Node 核心弃用警告（两次运行均出现、与本变更文件无交集，人工判定 benign → PASS）。**QM-6 修复后重跑（2026-10-15）再次全过**：`pnpm run build:dir` EXIT=0；asar 清单含 `\dist\index.html` + 6 个 stealth 文件（5 模块 + 新增 `stealth-preload-enhanced.bundle.js` 94.9kb——正是 Critical ①/Warning ② 修复的产物，缺它则增强 preload 回落 baseline）；抽取后 `require('@multi-publish/rpa-engine')` OK；启动 10s 存活、stderr 仅 DEP0180（与首跑同）。QM-4 N/A（无 UI 可见变更，captcha 相位复用既有面板） |
| QM-6 CCG 双模型外部评审 | PASS（backend 轴完成；frontend 轴 3 次有效失败按协议跳过，见下节） | backend=claude 全量 findings 已取回并逐条核实处置（1 Critical + 2 Warning + 2 Info，全部落码修复 + 变异反证 5/5 CAUGHT，见「后端轴 findings 与处置」节）；frontend=opencode 3 次尝试全败 → 按协议跳过（尝试史见「前端轴尝试史与跳过决定」节）；跨家族对抗性由 CCG plan-review（opencode↔claude DUAL、converged cleared，见下行）承重；前端轴视角缺失记为残余风险。路由真源 `~/.claude/.ccg/config.toml` |
| CCG 决策层 plan-review | PASS | decider `--input design.md` 建 plan 记录（mode=SINGLE，plannedFiles 40）→ `plan-review.sh` 跨家族 DUAL 对抗（proposer=opencode / critic=claude）：第 1 轮 converged，8 findings（Critical 0 / High 0 / Warning 5 / Info 3），裁定 **cleared 放行**；8 条全部逐条处置进 design.md（i1→D4 token 生命周期、i2→D1 evasions 三层缓解、i3→D6 配置完整性威胁模型、i4→风险表 R2/R3 阈值量化、i5→D5 captcha 超时/取消/放弃三出口、i6→Specs 段小写统一、i7→D1/D3 world 边界、i8→决策状态标注）；记录 JSON `.ccg/reviews/53a3a71df….json`（deepReview.status=cleared） |
| 远程同步 | PENDING | 合并后回填 merge SHA 与时间；`git ls-remote --heads origin oss-rpa-hardening` 0 行证分支删除 |

### CCG pre-commit 放行证据（SKIP_CCG_GATE=1，提交 5）

verify-security 对 `rpa-view-helpers.js` 报 5 high（L104/107/140/145/219，XSS/innerHTML 模式）。对照实验：`git show HEAD:apps/desktop/electron/services/rpa-view-helpers.js`（本 PR 之前的 blob）跑同一扫描器同为 5 high，行号位移恰等于本 PR 插入行数 → 全部既有 finding。语义为 2026-07-16 安全净化回写（innerHTML 赋值前有 script/iframe/on* 清洗），删改即回归，本 PR 不改既有语义。故用钩子自带放行阀 `SKIP_CCG_GATE=1`（非 `--no-verify`），证据写入 commit message 53a3a71df。

### QM-6 后端轴 findings 与处置（backend=claude，2026-10-15）

共 5 条（1 Critical / 2 Warning / 2 Info），全文取自 `D:\Temp\opencode\qm6-backend-b1.log`，逐条核实后处置如下；两决策点答复见 ①②。

| # | 严重度 | 现场 | 处置 | 回归锁 + 变异反证 |
|---|--------|------|------|-------------------|
| ① | **Critical** | `rpa-view-session.js:205` `_resolvePreloadPath` enhanced 分支 `path.join(__dirname,'..','stealth',…)` 解析到**不存在的** `electron/stealth/`（实际在 `electron/services/stealth/`）→ Electron 遇到不存在的 preload 不报错、只是不加载 → 三平台增强 evasions 永不生效 | **决策①：文件留在 `services/stealth/`（不迁移）**，改 join 为 `path.join(__dirname,'stealth','stealth-preload-enhanced.bundle.js')` + `fs.existsSync`（新增 `const fs = require('fs')`）fail-closed 回落 baseline + `_logPreloadFallback(platform, new Error('enhanced preload bundle missing: '+p))` 出声。不迁移的理由：迁移会扩大 diff、牵动 build-preload/文档/测试多处路径断言，而 bug 本体是 join 拼错 | `preload-variant.test.js`「路径真实存在」用例（字符串 + `existsSync` 双断言）；反证 **M1**（回退 `..` 路径）4 红、**M2**（摘 existsSync 守卫）1 红，均红在指名用例 |
| ② | Warning | `stealth-preload-enhanced.js:70` sandbox:true 下 `require('./evasions-bundle.js')` 受限 polyfill 必失败 → bundle=null → evasions 全跳但 INJ_DONE 照标 → **三态假成功** | **决策②：esbuild 内联成单文件 bundle**（非运行时 fallback——fallback 会把假成功降级成"静默少做"，仍不可观测）：照 `buildHomeShellPreload` 先例新增 `buildStealthEnhancedPreload`（entry 同目录源文件 → `stealth-preload-enhanced.bundle.js`，bundle/platform node/format cjs/target node22/external electron），接入 `main()` 与 `module.exports`；bundle 随仓提交（eslint 已 ignore `electron/**/*.bundle.js`，`git check-ignore` 已验未被 git 忽略；`build:vue` 链路自动生成，不改 before-pack.js） | `preload-variant.test.js`「bundle 契约」（`window.outerdimensions` 内联特征 + 无残留 `require('./evasions-bundle` + marker 齐全 + 源文件仍单一来源引用）；反证 **M4**（指向源文件）与 **M5**（externalize 后重建 bundle）各 1 红 |
| ③ | Warning | `cdp-input.js:29-36` `withDebugger` attach 失败仍无条件 `finally` detach → 拆掉上传路径/网络取证持有的 CDP 通道 | 对齐 `isolated-world.js:163-179` owned 模式：`isAttached()` 已附着则复用；否则 attach 成功才 `owned=true`；`finally if(owned) detach`。同时删 `getBounds` `.catch` 里冗余的无条件 detach（finally 已覆盖） | `cdp-input.test.js` 两个「他方已附着」用例（attach 拒 → 操作照发且不 detach；attach 拒 + 命令失败 → getBounds null 且不 detach）；反证 **M3**（`owned\|\|true`）2 红 |
| ④ | Info | `publish-capabilities.js:344` 无消费者 | F3/F4 占位预期（PR-2 消费），本记录注明即可 |
| ⑤ | Info | `MP_RPA_DRIVER` 默认值全平台生效；`_fillInput` ≤10 字符走 `Input.insertText` | 有意设计（任务 5.1 驱动选型决策）；**tasks 5.3 真机取证追加 wechat_mp/youtube 标题填充冒烟项** |

修复后消费者并集重跑 GREEN：`electron/services/stealth/` 全目录 + `build-preload.test.js` + `rpa-view-window-pool.test.js` 共 9 文件 70 例，另 `rpa-view-session.test.js` 6 例、`scripts/build-paginator.test.js`（node:test）8 例——并集 11 文件 84 例；修复走完整 TDD（RED 7 failed → GREEN 29/29 → 还原后全绿）。

### QM-6 前端轴尝试史与跳过决定（frontend=opencode，2026-10-15）

| # | 启动方式 | 结果 |
|---|---------|------|
| 1 | 首次派发（resume 默认路由） | 失败——止于会话摘要，无 findings JSON |
| 2 | 重试 1 | 失败——同上，无 findings 输出 |
| 3 | 显式 `codeagent-wrapper resume ses_ec4299ac5ffe50jPGq2lSef9x9 --backend opencode --lite`（2026-10-15 03:26 启动，wrapper 日志 `D:\Temp\codeagent-wrapper-13200.log`） | 失败——7200s 超时被杀（05:26:31 `opencode execution timeout`），stdout 仅启动头（`D:\Temp\opencode\qm6-frontend-b1-retry3.log`），零 findings |

**决定**：3 次有效失败，触发 AGENTS.md QM-6「前端模型失败最多重试 2 次、3 次全败才跳过」条款 → **跳过前端轴，backend 单轴完成放行**。backend=claude 的 Critical 已修复并经变异反证 M1–M2 锁死、两条 Warning 已修复（M3–M5 锁死）；跨家族（opencode↔claude）对抗性由 CCG plan-review DUAL 环节承重（converged cleared，8 findings 全处置）。**残余风险如实记**：前端轴（模式/可维护性/集成视角）对实现 diff 无独立外部意见，该视角由 plan-review critic 与本地消费者并集测试部分覆盖，但不等价于外部复核。

### 实现摘要（提交 1–5）

| 提交 | 内容 | 对应任务 |
|------|------|---------|
| 291865a10 | evasions 提取（`scripts/extract-evasions.js`，源码 diff 保真）+ 增强 preload（`stealth-preload-enhanced.js`，自清理+非枚举 descriptor）+ 行为层引擎（`behavior-engine.js` 轨迹算法 + `cdp-input.js` CDP Input 适配） | F1-c / F1-ab |
| cba20c74f | captcha 相位双侧同步（emitter `PHASE_ENUM` + store `PHASE_ENUM`/`TERMINAL_PHASES` 派生）+ preload 变体选择接线（`publish-capabilities.json` riskControl 段 + `_resolvePreloadPath` fail-closed） | F1-d / F2 前置 |
| b3b7214a4 | `_acquireWindow` 传 platform + stealth-preload 头注修正 | 3.1 / 3.2 |
| 6aa754288 | isolated-world 求值模块（`isolated-world.js`：双键缓存 frameId+loaderId、stale 失效、probe 探活、context-gone 重建）+ binding allowlist 空表守卫 | 4.1–4.3 / 11.3 / 11.4 |
| 53a3a71df | `_click`/`_fillInput` 接线（`resolveRpaDriver`→`_behaviorClick`→`_isoEval`→`_probeClickState` 主世界豁免；fill 1..40 字符限长+读回校验） | 4.4 / 5.x / Step D |

### spike 实证要点（F2，两轮）

`D:\Temp\opencode\f2-spike*.json`：Page.Frame 无 documentId → 双键第二键取 loaderId；Page.enable 可省；同 worldName 二次 createIsolatedWorld 幂等；导航后旧 contextId 命令级 reject（据此设计 stale 失效）；`exceptionDetails` 必须显式检查；`window.__ocLog` 属主世界不可迁；CDP 参数 `grantUniveralAccess: true`。PRD §3.3 勘误已落盘。

### 迁移清单 v1（留痕）

仅 `_click`/`_fillInput` 迁 isolated world 行为路径；probe 与通信 binding 留主世界（tasks 4.4 + PRD §3.3 契约5 留痕）。

### 遗留（不假装已闭合）

- captcha 兜底三出口（超时/取消/放弃）与 sidecar 四件套归 PR-2（F3+F4），本 PR 只落相位接线与设计决策
- PRD 跟踪项 1（灰度 n≥15 方差校验）、3（evasion hash 首批取证）——阈值已在 design.md 风险表量化
- debugger 通道不实现（F1-c 选型决策，helpers 既有 `_clickViaCdp` 为 2026-10-01 旧代码非本 PR 引入）
