# PRD：限流自检功能迁移至运营中心（桌面端入口下线 · 真机执行端隐藏保留）

- 文档编号：PRD-RATE-LIMIT-SELFCHECK-MIGRATE-OPS-CENTER-2026-09-23
- 状态：待评审（Draft，待 CEO/CTO 签字）
- 作者：PM
- 关联：
  - `01-docs/design/model-provider-module-design.md` §9.5「限流自检弹窗功能规格与布局规范」
  - `ops-center/docs/PRD.md` §12A.23「限流与调度验证」
  - 已合并 PR #2225（限流自检弹窗布局修复）

---

## 1. 背景与问题

### 1.1 功能现状
「限流自检」当前是**桌面端 Electron 渲染层的一级功能**，位于「设置 → 模型设置」页：
- 用户点「限流自检」按钮 → 打开弹窗 → 调 6 个参数（rpm / 并发上限 / 请求数 / 单请求耗时 / 429 注入位置 / 5h 限额 / 冷却）→「运行自检」→ 看断言与时间线 → 可「上报运营后台」。
- 原理：用**真实调度网关 `ApiUsageGovernor`**（独立实例，与生产同一套限流/排队/冷却实现）+ **本地假 adapter**（仅内存 sleep，零网络、零额度消耗）构造并发请求，验证并发上限/排队/429 冷却/5h 限额四类机制。
- 上报链路：桌面 IPC `rate-limit:report` → `POST {ops-center}/api/v1/scheduler/verify`（`simulated=0`）。

### 1.2 运营中心已有承载
运营中心**已经是这个功能设计上的主家**，不是缺失：
- `ops-center/frontend/src/views/RateLimitVerifier.vue`「限流与调度验证」页已存在；
- 后端 `SchedulerVerificationRun` 表（`models.py`）**同时存储** 运营后台 Python 模拟器记录（`simulated=1`）与 桌面端真实自检上报（`simulated=0`）；
- §12A.23 已定义完整闭环：**契约校验 → 参数模拟（Python）→ 真实观测 → 真实自检（桌面端对拍上报）**。

### 1.3 核心问题：功能定位与暴露面错配
- **用户画像错位**：桌面端目标用户是多平台内容创作者，关心「发布会不会失败/被限流」，不关心 governor 调度机制是否正确、`clamp(rpm/10,1,4)` 公式、`inject429At` 等工程参数。
- **认知负担**：它挤在用户真正用来配 API Key / 选模型的「模型设置」页，是近期 UI「布局混乱」反馈的根源之一——本质是入口放错位置。
- **闭环割裂**：一条验证流程的两端（执行 in 桌面 / 汇总对比 in 运营中心）跨两个应用，割裂。

---

## 2. 目标与非目标

### 2.1 目标
- **G1**：桌面端「限流自检」**用户可见入口全部下线**（按钮、弹窗、6 参数表单、上报按钮、相关文案与样式），模型设置页回归纯配置职责。
- **G2**：运营中心 `RateLimitVerifier.vue` 成为限流/调度验证的**唯一正门**（契约校验 + Python 模拟 + 历史对比 + 真实上报浏览）。
- **G3**：**保留桌面端真机执行能力（隐藏/开发态）**——`rate-limit-self-check.js` 服务、`rate-limit:self-check`/`rate-limit:report` IPC、`simulated=0` 上报通道代码全部保留，仅在 dev/feature-flag 下可达。理由：只有桌面端能跑到用户机器上真实打包发布的 `ApiUsageGovernor`，运营中心 Python 模拟器无法替代这条对拍（`simulated=0`）。
- **G4**：为终端用户保留正确的价值出口——「我的限流配置会不会导致发布被限流」应被**吸收进运营中心的契约校验**，输出「绿灯/红灯 + 结论」，而非让用户读裸 timeline/断言。

### 2.2 非目标
- **N1**：不改动 `ApiUsageGovernor` 生产调度逻辑本身（本次纯入口/暴露面调整）。
- **N2**：不删除真机执行/上报代码（保留隐藏能力，区别于「彻底移除」）。
- **N3**：不新增运营中心模拟器算法（§12A.23 已实现，本次仅确认为唯一承载并补文档口径）。
- **N4**：不改数据库结构（`SchedulerVerificationRun` 表沿用，`simulated=0/1` 语义不变）。

---

## 3. 用户与场景

| 角色 | 迁移前 | 迁移后 |
|------|--------|--------|
| 终端创作者 | 误入模型设置看到技术弹窗，看不懂 | 不再看到；如需了解限流影响，在运营中心看「契约校验」红绿灯结论 |
| 运营/管理员 | 在运营中心跑 Python 模拟 + 浏览上报 | 不变，且明确为唯一入口 |
| 研发/QA | 桌面端 UI 直接跑真机自检 | 经 dev/feature-flag（DevTools 调 `rateLimitSelfCheck` IPC 或隐藏诊断面板）跑真机对拍并上报 |
| 客服 | 让用户开弹窗操作 | 引导远程诊断场景保留能力，UI 不再暴露 |

---

## 4. 目标架构（职责重划）

```
运营中心 RateLimitVerifier.vue（唯一正门）
  ├─ ① 契约校验：给定 rate_per_minute/limit_per_5h，判合法/合理 → 红绿灯结论（面向终端可懂）
  ├─ ② 参数模拟：Python 模拟器（与桌面同契约，确定性），simulated=1 落库
  ├─ ③ 真实观测：用量上报的排队/冷却指标
  └─ ④ 历史记录浏览：simulated=1（运营模拟）+ simulated=0（桌面真机上报）统一列表/对比
              ▲
              │ POST /api/v1/scheduler/verify (simulated=0, client_id, engine=real-governor)
              │
桌面端（隐藏执行端，dev/feature-flag gated）
  └─ IPC rate-limit:self-check → rate-limit-self-check.js（真实 ApiUsageGovernor + 假 adapter）
     IPC rate-limit:report → 上报运营中心
```

---

## 5. 功能需求（P0/P1/P2）

### P0（必须，本 PR 交付）
- **P0-1 桌面入口下线**：移除 `ModelProviders.vue` 的 `.selfcheck-entry` 按钮、`showSelfCheckDialog` 弹窗（含 6 参数 `selfcheck-form`/`selfcheck-row`）、运行/上报按钮、结果展示区；移除随之失效的 `openSelfCheck/runSelfCheck/reportSelfCheck` 方法与仅服务弹窗的 `.selfcheck-*` 样式。
- **P0-2 桌面文案清理**：移除**用户可见**的 `selfCheck*` locale 键（`modelProviders.selfCheck`、`selfCheckTitle`、`selfCheckDialogTitle`、`selfCheckHint`、`selfCheckRunning`、`runSelfCheck`、`reportSelfCheck`、`selfCheckDone`、`selfCheckFailed*`、`noElectronApiSelfCheck`、参数 label 等），zh/en **成对删除**（CI Gate 7 locale-sync 拦截）。
- **P0-3 真机执行端隐藏保留**：`services/rate-limit-self-check.js`、其单测、`ipc-handlers/rate-limit.js`（`rate-limit:self-check`+`rate-limit:report`）、`preload` `rateLimitSelfCheck` 通道**全部保留且功能不变**；渲染层不再有常规调用点。执行端调用改为仅经 DevTools IPC 或隐藏诊断面板触发（见 P0-6）。
- **P0-4 运营中心为唯一正门**：确认 `RateLimitVerifier.vue` 已覆盖 6 参数（含 429 注入、5h、冷却）与 `simulated=0` 真实上报浏览；桌面下线后运营中心不产生功能缺口（如有缺口在本 PR 或后续小 PR 补齐，见 §6）。
- **P0-5 回归保护**：迁移后桌面端「模型设置」页既有用例零回归；`rate-limit-self-check.test.js` + `ipc-handlers/rate-limit.test.js` 仍全绿（执行端能力未破坏）；删除 `selfcheck-dialog-layout.test.js`（其守护的 UI 已下线）。
- **P0-6 桌面黑盒一键诊断入口（③，生产可见）**：在「设置 → 高级/诊断」提供一个「诊断网络与调度」按钮，**不暴露 6 参数**，内部按运营下发的当前配置跑默认自检（真实 governor + 假 adapter，零额度零网络），只回显红绿灯结论（✓/⚠/✗ + 一句人话），可静默上报（`simulated=0`）。完整 6 参数工程面板仅 feature-flag `MP_RATE_LIMIT_SELFCHECK=1` 或 `!app.isPackaged` 可达（供研发/QA/客服）。
- **P0-8 发布失败被动附带诊断（②）**：发布/调用命中限流类错误（`RATE_LIMITED`/`QUOTA_EXCEEDED`/429 冷却超时等）时，自动跑一次轻量真机自检，把结论码附到既有报错弹窗/日志（如「本地调度诊断：正常 · 码 D-12」），**不新增独立入口**。需与发报错误链路集成，默认失败不阻断主报错（自检异常静默降级）。
- **P0-7 运营中心契约校验红绿灯（原 P1-2，经决策提升到 P0）**：`RateLimitVerifier.vue` 契约校验区对给定 rpm/limit_per_5h 输出「✓ 合理 / ⚠ 偏紧 / ✗ 易触发限流」结论 + 一句人话解释，替代裸断言；面向运营且可转述给终端。

### P1（本次无 —— 原 P1-1/P1-2 已按决策提升到 P0）
- 无。保留编号段以免与既有引用错乱。

### P2（可选，增强）
- **P2-1 远程触发桌面自检**：运营中心「限流与调度验证」页对在线桌面客户端下发一次真机自检任务（需长连接/轮询通道）。**默认不做**（与「仅移 UI、保留一键上报」为不同路线，本次经决策选「保留隐藏执行端」，不含远程触发）。
- **P2-2 对拍差异可视化**：simulated=1 vs simulated=0 指标并排对比图。

### 5.1 生产打包用户的「真机自检」可达形态（待决策 #3）

> 硬约束：真实 `ApiUsageGovernor` 只存在于桌面端，运营中心只能跑 Python 模拟器。因此「生产用户跑到自己机器的真机」**必然只能在桌面侧触发**，运营中心至多展示上报结果。以下 4 种均为「桌面侧呈现方式」：

| 形式 | 呈现 | 是否又把 UI 搬回来 | 成本 |
|------|------|------|------|
| **① 不开放（默认）** | 生产用户无任何真机入口，一切看运营中心；执行端仅 `!app.isPackaged`/dev-flag 可达 | 否 | 最低 |
| **② 失败即附带（被动）** | 发布/调用命中限流类错误时自动跑一次轻量自检，把结论码附到报错弹窗/日志（如「本地调度诊断：正常 · 码 D-12」），无独立入口 | 否（寄生在既有报错弹窗） | 低 |
| **③ 黑盒一键诊断** | 「设置→高级」一个「诊断网络与调度」按钮，不暴露 6 参数，内部按运营下发的当前配置跑默认自检，只回显红绿灯 | 是（黑盒、非工程面板） | 中 |
| **④ 客服授权解锁** | 保持隐藏，客服给一次性 token/深链临时解锁完整参数面板 | 是（需授权通道） | 高 |

**已定（D3）**：生产可达形态取 **③ 黑盒一键诊断 + ② 发布失败被动附带** 的组合。即：生产用户在「高级/诊断」有一个**不暴露参数、只看红绿灯**的黑盒诊断按钮（③）；同时发布/调用命中限流类错误时**自动附带**一句结论码（②）。完整 6 参数工程面板仍仅 feature-flag/未打包态可达（供研发/QA/客服）。

---

## 6. 运营中心能力核对（迁移后不留缺口）

| 桌面端下线的能力 | 运营中心是否已具备 | 处置 |
|------------------|--------------------|------|
| 6 参数设置（rpm/并发/请求数/耗时/429注入/5h/冷却） | 是（`RateLimitVerifier.vue` + `/api/v1/scheduler/verify` 请求体已含） | 无需补 |
| 运行验证 / 出断言与时间线 | 是（Python 模拟器 simulated=1） | 无需补 |
| 真实引擎对拍（simulated=0） | 上报入库已具备；触发端由桌面隐藏执行端提供 | G3 保留执行端即可 |
| 结果浏览/历史对比 | 是（GET `/api/v1/scheduler/verify`，simulated 过滤） | 无需补 |
| 终端可懂的「会不会被限流」结论 | 部分（当前偏工程视图） | P1-2 补红绿灯结论 |

结论：**运营中心已具备承接条件，桌面迁移不产生功能缺口**；唯一增强项是 P1-2 的终端可读结论。

---

## 7. 数据契约（不变项，须与实现一致）

真机自检与 Python 模拟器共用契约，`scheduler_verification_runs` 落库；桌面 IPC `_validate` 边界（保留，供隐藏执行端调用）：

| 参数 | 边界 | 留空语义 |
|------|------|----------|
| rpm | [1, 100000] | 必填 |
| requestCount | [1, 1000] | 必填 |
| requestDurationMs | [0, 60000] | 默认 0 |
| maxConcurrent | [1, 8] 或留空 | 留空 = `clamp(round(rpm/10),1,4)` |
| limitPer5h | [1, 1e7] 或留空 | 留空 = 不设 5h 窗口 |
| inject429At | [1, requestCount] 或留空 | 留空 = 不注入 429 |
| cooldownMs | [100, 60000] | 默认（现有实现值） |

- 变更守则：以上任一边界变更须同步 `rate-limit-self-check.js._validate`、运营中心模拟器契约、§9.5 与 §12A.23 文档三处。

---

## 8. 交互与显示项（迁移后）

### 8.1 桌面端「模型设置」页
- 移除右上角「限流自检」按钮；页面仅保留模型/凭证配置与（如有的）运营同步卡片。
- （P1-1）「高级/诊断」区在 feature-flag/未打包态下显示「运行真机自检并上报」，默认对打包生产用户隐藏。

### 8.2 运营中心「限流与调度验证」页
- 保持 §12A.23 既有四段式；新增/确认：`simulated` 标识区分「运营模拟」与「桌面真机上报」，历史列表可按 `simulated`/`preset_id` 过滤。
- （P1-2）契约校验区顶部给红绿灯结论 + 解释文案。

### 8.3 提示文字（新增/保留）
- 桌面（若做 P1-1）：`高级诊断 · 限流自检：用真机调度网关验证并发/排队/429/5h，零额度零网络，结果上报运营中心`。
- 运营中心结论示例：`✓ 当前 rpm=20、5h 限额合理，按典型发布批量不易触发平台限流` / `⚠ rpm=120 接近该 provider 上限，突发批量可能触发 429 冷却`。

---

## 9. 验收标准

- **AC1**：桌面端「设置 → 模型设置」无任何限流自检可见入口；打包生产应用不暴露自检 UI。
- **AC2**：`ModelProviders.vue` 不再引用 `selfCheck*`；`grep -rn "selfcheck-entry\|showSelfCheckDialog\|selfCheckForm" apps/desktop/src/views` 无用户可见命中。
- **AC3**：locale zh/en `selfCheck*` 用户可见键成对移除，`check-locale-sync`（Gate 7）PASS，非 locales 渲染源无新增中文字面量。
- **AC4**：真机执行端能力完好——`rate-limit-self-check.test.js`、`ipc-handlers/rate-limit.test.js` 全绿；经 DevTools/flag 触发 `rateLimitSelfCheck` 仍能出 metrics/assertions 并 `report` 出 `run_id`。
- **AC5**：运营中心 `RateLimitVerifier.vue` 覆盖 6 参数与 simulated=0 浏览，无功能缺口。
- **AC6**：桌面既有测试（icon-usage / model-providers-copy / settings-panel-layout 等）零回归；删除 `selfcheck-dialog-layout.test.js` 后套件全绿。
- **AC7**：文档同步——§9.5 更新为「已迁移运营中心 + 桌面保留隐藏执行端」；CHANGELOG 记录入口下线与执行端保留。

---

## 10. 影响面与风险

- **影响文件（移除）**：`apps/desktop/src/views/ModelProviders.vue`（按钮+弹窗+方法+样式）、`apps/desktop/src/locales/zh.js`/`en.js`（selfCheck* 键）、删除 `apps/desktop/src/views/selfcheck-dialog-layout.test.js`。
- **保留不动（隐藏能力）**：`apps/desktop/electron/services/rate-limit-self-check.js` + 单测、`ipc-handlers/rate-limit.js` + 单测、`preload/index.js` `rateLimitSelfCheck`、bundle 内相应通道。
- **运营中心**：`RateLimitVerifier.vue` 视 P1 决定是否补红绿灯（可能零改动即满足 P0）。
- **风险**：
  - R1 locale 删除不彻底 → Gate 7 拦（交流水按行首核对）。
  - R2 误删执行端 → AC4 兜底；只删渲染层不删 electron 层。
  - R3 bundle 文件（`home-shell-preload.bundle.js`/`index.bundle.js`）与源 preload 一致性 → 走既有构建流程重生成，不手改 bundle。
  - R4 「保留隐藏执行端」若无任何触发路径则形同死代码 → 用 P0-6 黑盒入口/工程面板（flag）给出可达路径，避免僵尸能力。
  - **R5（P0-8 新增、最高风险）**：发布失败附带诊断需侵入发布/调用错误链路，风险在于（a）自检拖慢报错弹窗 → 必须异步/限时（如 ≤500ms 否则不附）且失败静默降级，绝不能阻断或掩盖主报错；（b）误判限流类错误码。建议 P0-8 单独一个 PR 并优先评审；可考虑降级为仅写日志不改进弹窗。

---

## 11. 交付与流程（质量节拍）

- **变更分层**：含运行时代码（`apps/desktop/`）→ **必须 worktree 隔离**（D 盘 `mp-<task>`，基于 origin/main），经 PR + CI（ruleset 六项 required）后 squash 合并。
- **TDD**：先写/改测试（移除弹窗布局测试、新增「模型设置页不再含自检入口」源码契约断言、执行端能力保留断言）→ 红 → 实现 → 绿。
- **门禁**：eslint 改动文件 0 error；locale 成对；定向桌面单测；QM-1 若动 electron 层则打包验证（本 PR 保留 electron 层不改，预计不触发 QM-1，但 `ModelProviders.vue` 属渲染层需过既有套件）。
- **文档**：§9.5 回写 + CHANGELOG + 本 PRD 归档。
- **记忆沉淀**：孤儿入口下线/职责重划经验入 learnings + 内置记忆 + EverOS。

### 分期建议
> 因 D3 选定 ②+③，P0 不再是纯减法；建议拆 2 个 PR 保证可评审性：
- **PR-1（减法 + 隐藏能力 + 运营增强）**：P0-1 入口下线 + P0-2 locale 清理 + P0-3 执行端保留 + P0-4 运营正门 + P0-5 回归 + P0-6 黑盒诊断入口 + P0-7 运营红绿灯。以桌面减法为主，风险可控。
- **PR-2（② 错误链路附带，需重点评审）**：P0-8 发布失败被动附带诊断（附 R5 异步/降级保护）。因触及发布主链路，单独 PR 便于回滚。
- P2（远程触发/对拍可视化）另议。

---

## 12. 决策记录与待决策

**已定（本轮）**
- D1：隐藏诊断入口随 P0 一起做 → 已落 P0-6。
- D2：运营中心红绿灯结论放 P0 → 已落 P0-7。
- D3：生产可达形态 = ③ 黑盒一键诊断 + ② 发布失败附带 → P0-6（黑盒入口）+ P0-8（失败附带）。

**待决策**：无。P0 范围已锁（P0-1~P0-8），可进入实施。
