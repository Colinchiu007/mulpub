# Tasks: api-publish-engine-w1

## 1. 隔离与门禁前置

- [x] 1.1 `scripts/session-init.sh api-publish-w1` 建 D 盘 worktree（分支 `codex/api-publish-w1`）（实际等价落地：隔离 worktree `D:/Data/projects/mp-worktrees/mp-api-w1-ui-fe`，分支体系按本仓惯例用 `local/api-publish-w1-*` 系列逐切片推进，每切片独立分支+PR+autoMerge，隔离语义相同）
- [x] 1.2 worktree 依赖就绪（`pnpm install --frozen-lockfile` + `ensure-electron.js` + `verify-worktree-deps.js` 均已完成；2026-09-24 QM-1 打包前复验 `verify-worktree-deps` OK：消费方解析 11 项、全部 @multi-publish/* 解析到当前 worktree）
- [x] 1.3 确认 Write Guard watcher 运行、共享根停 main clean、expected-branch 声明（切片开工时逐项核验；pre-commit 分支守卫全程生效，各 commit 均在隔离 worktree 分支上通过钩子）

## 2. 签名注册表 + 远程通道拆除

- [x] 2.1 红测：`signer/registry` 注册/查找/未知 command fail-closed；Tier-A 本地算法回归（对齐现 signer-local.js）
- [x] 2.2 实现 registry + 收编 local 实现；**删除** `signer.js` 的 `MP_SIGNER_BASE`/`getRemoteSign`/`SIGNER_PORTS`
- [x] 2.3 绿测 + grep 门禁脚本：`packages/api-publish-engine`、`apps/desktop` 无 `MP_SIGNER_BASE`/`getRemoteSign`/`refpub`

## 3. publish/core 基座

- [x] 3.1 契约测试基建：127.0.0.1:0 假 HTTP 服务器 + 请求序列/headers/body/Range 断言器（PromptBridge 模式）
- [x] 3.2 HTTP 基座：axios 工厂、60s timeout、`retryCondition=!isJson` ≤3、代理注入
- [x] 3.3 分片器（8388608 + 三边界）、UploadEmitGate 节流、publishStatus 进度事件、错误码/BadRequest 等价物

## 4. 视频号 / B站 / 百家号 发布链（TDD 逐平台）

- [x] 4.1 视频号：红测契约（authKey→applyuploaddfs→uploadpartdfs→complete→post）→ 实现 → 绿
- [x] 4.2 B站：红测契约（preupload/X-Upos-Auth→upos PUT→/x/vu/web/add，csrf=bili_jct）→ 实现 → 绿
- [x] 4.3 百家号文章：红测契约（自域 token→uploadproxy→save/publish）→ 实现 → 绿
- [x] 4.4 三平台 adapters 改为委托新链；AI 声明字段平移（B站 ✅ + 视频号 ✅ 委托链+去重纯函数，见 PRD §12.4；百家号 ✅ re-point：457 行旧视频链整体下线改薄委托 BaijiahaoArticleChain，AI 声明 aigc_bjh_status 平移到 buildArticleFormData，钉视频测试重写（api-chain 10 例 + e2e 委托 4 例），见 PRD §12.8）
- [x] 4.5 数据校验 fail-closed：缺 Cookie/UA、空签名、文件不存在的零请求单测（2026-09-24 收口核实：三要素全覆盖——缺 cookie/UA 与文件不存在由各链契约测试显式标注 §4.5 fail-closed 零请求：bilibili-video-chain「缺 cookie → 抛错且零请求」、shipinhao-video-chain「缺 cookie、文件不存在、authKey 缺失 → 零（写）请求」+ shipinhao-adapter SPH_NO_FILE、baijiahao-article-chain「缺 cookie/UA、baseToken 提取失败 → 零请求」；空签名由 signer 层双侧防护：registry.sign 空 buffer 拒绝（signer-registry「non-empty buffer」）+ getDouyin/getKuaishouSignature 缺参返回空签名由上层 fail-closed 拦截（signer.test），W1 三平台链不消费签名服务，空签名场景在 W2 抖音链接入时随该波补端到端用例）

## 5. 双轨路由 + 频控 + 风控停止

- [x] 5.1 `config/platforms.yaml` 逐平台增 `publishMode`（三态 `api-only\|api-then-dom\|dom-only`，W1=api-then-dom、未入波=dom-only，独立于 has_api）+ `api-router.getPublishMode` 读取器（字段优先→has_api 派生→normalizeMode 归一）；publish-mode-config.test.js TDD，见 PRD §12.6
- [x] 5.2 `publishWithMode()`：api-then-dom 降级落 DOM、risk/login 不降级；结构化日志 `degraded+reasonCode`（§5.2 执行包装 publish-mode-runner.js 已交付，19 例 TDD，见 PRD §12.5；与 §4 链/index.publishViaApi 接线成产品入口随 §5.1/§5.4 落地；§5.1/§5.4 已交付，且 §5 服务入口已在 index.js 组装为 publishWithMode 单例（publish-service.js），四件套统一入口收口完成，见 PRD §12.7）
- [x] 5.3 18min 频控（虚拟时钟边界单测 17:59 拒 / 18:01 放）
- [x] 5.4 risk_blocked 挂起该平台/账号 + 通知（恢复/停止），不影响其他平台/账号（`risk-suspender.createRiskSuspender` 纯内存、账号级默认、幂等单次通知、显式 resume；与 `publishWithMode` 联动：入口挂起守卫零请求、风控命中即挂起、login 不挂起；risk-suspender.test.js 14 例 TDD，见 PRD §12.6）
- [x] 5.5 桌面端 enforcement 实现切片（2026-09-24，设计 §12.14 四点 decided → 实现确认 PRD §12.15）：桌面 `riskSuspender` DI 单例（`electron/services/risk-suspender-store.js` 复用引擎纯逻辑 + store 键 `publish.riskSuspended` 持久化懒水合）；`bootstrap.js` setExecutor 派发前置守卫命中挂起 → 抛 `RiskSuspendedError`（noRetry=true → shared-utils task-queue 跳过重试直接 failed）、`createPublisher` 零调用；`phase4-events.js` 风控命中即 suspend（platform+accountId 复合键，accountId 缺失降平台级）+ `publish:risk-suspended` 全量清单权威广播；IPC `publishRisk.{listSuspended,resume,isSuspended}` + preload `onRiskSuspended`（bundle 重建同 commit）；渲染层 `risk-suspended-tracker.js`（纯 DI，onChange 单向镜像）+ `stores/risk.js`（Pinia）+ 账号页 `RiskSuspendedBanner.vue`（仅挂起时渲染，恢复必经 notifyConfirm 人工确认，绝不自动恢复/换号）；i18n `publish.riskHold.*` 5 键（zh/en 成对）。全绿：合并回归 710 + tracker 14 + store 8 + banner 3 + ipc 5 + store服务 16 + task-queue 23；Gate7 --keys/--cjk、Gate11、Gate12 PASS。端到端真实风控验收绑 §7

## 6. UI 显示项 + i18n

- [ ] 6.1 发布记录「发布方式」徽标三态 + 详情分片历史；locale 成对 `publish.api.*`（zh/en）
> §5.4 桌面风控挂起信号生产端已落地（随本波 §6.1 后端 PR，见 PRD §12.12）：`publish-risk.js` `isRiskBlocked(task.error)` + `phase4-events.js` `task:failed` 命中发 `publish:risk-hold`（{platform,accountId,taskId,error}），为 §6.1 通知中心消费契约。待办：渲染层通知 UI（恢复/停止）+ preload onRiskHold + 桌面 riskSuspender 接队列派发前置守卫（真正挂起后续发布，端到端验收绑定 §7 真实风控触发）。
> §6.1 风控挂起通知「消费端」已落地（随本波，见 PRD §12.13）：`preload.onRiskHold` → `api/publisher.onRiskHold` → `risk-hold-notifier.js`（纯 DI，规整事件 + 近端列表上限 50）→ `main.js` 经统一通知通道 `useNotify.notifyWarning('publish.riskHold.body')` 弹 warning toast；i18n `publish.riskHold.body`（zh/en 成对）。仅信息提示（不声明已暂停/自动恢复）。待办：桌面 `riskSuspender` 接发布队列派发前置守卫（真正挂起后续发布）+ 通知内「恢复/停止」action（§5 架构切片，端到端验收绑定 §7 真实风控触发）。
> §5 enforcement 实现切片已收口上述待办（2026-09-24，见任务 5.5 与 PRD §12.15）：桌面 riskSuspender 已接发布队列派发前置守卫（命中挂起零请求直接 failed 不重试）、渲染层已交付挂起横幅与「恢复发布」人工确认 action；真实风控触发的端到端挂起验收随 §7 活体轮执行。

> §6.1 徽标三态已落地（随本波 §6.1 PR，见 PRD §12.10）：`PublishHistory.vue` 记录卡按 `record.result.mode` 渲染「发布方式」徽标 api/dom/fallback 三态 + `publish.api.*` locale（zh/en 成对，i18n.test.js 校验）；无 mode 向后兼容不渲染。待办：本项「详情分片历史」（详情弹窗按平台分片展示子结果与 mode）随 §7 活体轮一并落地。
> §6.1 详情分片增强已落地（随本波 §6.1 PR，见 PRD §12.11）：详情弹窗按 `record.result` 展示发布方式（api/dom/fallback）、作品 ID（`postId`）、作品链接（`url`，外链 `target=_blank rel=noopener`）；无对应字段则该行隐藏（旧记录向后兼容）。多平台「一记录多子结果」的完整分片列表待平台适配器把子结果数组写入 `result.subResults` 后扩展（随 §7）。
- [x] 6.2 IPC 参数 `JSON.parse(JSON.stringify())` 脱壳；渲染端无中文字面量（Gate 扫描）（2026-09-24 收口核实：前半 `publish:batch` 已做 `JSON.parse(JSON.stringify(article))` 脱壳（ipc-handlers/publish.js，见 PRD §12.9），§5 enforcement 新增 `publishRisk.*` 三通道传参均为纯 JSON 基本类型（字符串）无 reactive 包装风险；后半由 CI Gate 7 `check-locale-sync.js --cjk` 基线扫描强制执行（渲染端 src/ 非 locales 新增中文字符串字面量即拦截），W1 各 PR CI 持续 PASS）

> §6 后端基座已落地（随本波§6 PR，见 PRD §12.9）：`publisher-router.js` `ApiPublisher` 图文/视频分流（修复 §4.4 百家号 article-only 桌面抛「缺少视频文件路径」）+ `ApiPublisher`/`RpaVmPublisher` 返回 `mode:'api'`/`'dom'` 作为 6.1 徽标数据源；`publish:batch` 已做 `JSON.parse(JSON.stringify(article))` 脱壳（ipc-handlers/publish.js，6.2 前半）。待办：6.1 发布记录「发布方式」徽标三态渲染 + 分片历史 + `publish.api.*` locale（需桌面应用活体视觉验收）。

## 7. 质量门禁与交付

- [x] 7.1 若触 `apps/desktop/electron/`：QM-1 打包三件套（2026-09-24 本地完成于 §5 enforcement 合并后收口轮，worktree 内 apps/desktop：① `electron-builder --win --dir` EXIT_0（先裸打包验 asar 覆盖，再 `pnpm build:dir` 含 vite renderer 构建全量重打包 EXIT_0）；② asar list 验证本切片新文件全部纳入：`electron/services/risk-suspender-store.js`、`publish-risk.js`、`bootstrap/phase4-events.js`、`ipc-handlers/publish.js` + 依赖闭包 `shared-utils/src/task-queue.js`、引擎 `publish/core/risk-suspender.js`；③ asar extract 后 node require 链加载四个关键入口 `REQUIRE_CHAIN_OK`；④ win-unpacked/Multi-Publish.exe 独立 `--user-data-dir` 启动 9 秒进程存活（ALIVE_AFTER_8S=True）且 stderr 零输出。dist\fonts 与 .playwright-browsers 缺失仅为 worktree 开发产物警告，生产 CI 打包含之）
- [x] 7.2 `pnpm test`（api-publish-engine + 受影响）全绿、离线可跑；`.quality-gates.md` 自检（本地：engine 各链/registry/双轨/频控/风控定向 suites 全绿 + desktop 合并回归 710 + 全量 vitest 640 passed/1 skipped EXIT=0 + shared-utils task-queue 23；CI：head commit 33df792d 上 Build & Release / Electron CI / GUI Tests 三大 workflow conclusion=success（engine 全量 `node scripts/run-tests.js` 在 CI 覆盖面内）。离线可跑：全部测试仅用 127.0.0.1 假 HTTP 服务器/mock/注入依赖，零真实外发，Gate 12 品牌与零外发纪律持续 CI 强制）
- [x] 7.3 品牌 grep 门禁 + Gate 7 locale-sync 本地预跑通过（§5 enforcement 切片本地预跑：Gate12 品牌残留 grep PASS；Gate7 `check-locale-sync.js --keys` PASS（147 键 zh/en 成对）/`--cjk` PASS（基线无新增），随后 CI 同门禁复核通过；Gate11 ESLint exit 0、Gate16 font-size scale token 化修复后 PASS）
- [x] 7.4 commit（关联本 change）→ push → 开 PR → CI 通过 → autoMerge squash（W1 各切片交付链已全部经此路径合并 main：#2307/#2323/#2335/#2337/#2338/#2340/#2348 等，逐 PR CI 绿 → autoMerge squash；本收口 commit 自身亦经同链开 PR 合并。剩余：§7.5 活体验收（用户在场门槛）→ 7.6 证据回写 → 7.7 openspec archive，按波次收尾顺序执行）
- [ ] 7.5 活体验收：3 平台真实内容、间隔≥18min、私密优先回查；证据 `01-docs/rpa-api-publish/evidence/api-w1-<platform>/`（`git add -f`）随证据 PR 进仓
- [ ] 7.6 证据回写 PRD 附录 + 技术方案修订记录；经验入内置记忆 + EverOS
- [ ] 7.7 `openspec archive api-publish-engine-w1`（+ CCG task 归档 + 质量节拍复盘，`scripts/openspec-sync-check.js` 核对）
