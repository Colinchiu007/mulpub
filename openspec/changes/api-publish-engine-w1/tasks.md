# Tasks: api-publish-engine-w1

## 1. 隔离与门禁前置

- [ ] 1.1 `scripts/session-init.sh api-publish-w1` 建 D 盘 worktree（分支 `codex/api-publish-w1`）
- [ ] 1.2 worktree 依赖就绪：`pnpm install --frozen-lockfile` + `node scripts/ensure-electron.js` + `node scripts/verify-worktree-deps.js`
- [ ] 1.3 确认 Write Guard watcher 运行、共享根停 main clean、expected-branch 声明

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
- [ ] 4.5 数据校验 fail-closed：缺 Cookie/UA、空签名、文件不存在的零请求单测

## 5. 双轨路由 + 频控 + 风控停止

- [x] 5.1 `config/platforms.yaml` 逐平台增 `publishMode`（三态 `api-only\|api-then-dom\|dom-only`，W1=api-then-dom、未入波=dom-only，独立于 has_api）+ `api-router.getPublishMode` 读取器（字段优先→has_api 派生→normalizeMode 归一）；publish-mode-config.test.js TDD，见 PRD §12.6
- [x] 5.2 `publishWithMode()`：api-then-dom 降级落 DOM、risk/login 不降级；结构化日志 `degraded+reasonCode`（§5.2 执行包装 publish-mode-runner.js 已交付，19 例 TDD，见 PRD §12.5；与 §4 链/index.publishViaApi 接线成产品入口随 §5.1/§5.4 落地；§5.1/§5.4 已交付，且 §5 服务入口已在 index.js 组装为 publishWithMode 单例（publish-service.js），四件套统一入口收口完成，见 PRD §12.7）
- [x] 5.3 18min 频控（虚拟时钟边界单测 17:59 拒 / 18:01 放）
- [x] 5.4 risk_blocked 挂起该平台/账号 + 通知（恢复/停止），不影响其他平台/账号（`risk-suspender.createRiskSuspender` 纯内存、账号级默认、幂等单次通知、显式 resume；与 `publishWithMode` 联动：入口挂起守卫零请求、风控命中即挂起、login 不挂起；risk-suspender.test.js 14 例 TDD，见 PRD §12.6）

## 6. UI 显示项 + i18n

- [ ] 6.1 发布记录「发布方式」徽标三态 + 详情分片历史；locale 成对 `publish.api.*`（zh/en）

> §6.1 徽标三态已落地（随本波 §6.1 PR，见 PRD §12.10）：`PublishHistory.vue` 记录卡按 `record.result.mode` 渲染「发布方式」徽标 api/dom/fallback 三态 + `publish.api.*` locale（zh/en 成对，i18n.test.js 校验）；无 mode 向后兼容不渲染。待办：本项「详情分片历史」（详情弹窗按平台分片展示子结果与 mode）随 §7 活体轮一并落地。
- [ ] 6.2 IPC 参数 `JSON.parse(JSON.stringify())` 脱壳；渲染端无中文字面量（Gate 扫描）

> §6 后端基座已落地（随本波§6 PR，见 PRD §12.9）：`publisher-router.js` `ApiPublisher` 图文/视频分流（修复 §4.4 百家号 article-only 桌面抛「缺少视频文件路径」）+ `ApiPublisher`/`RpaVmPublisher` 返回 `mode:'api'`/`'dom'` 作为 6.1 徽标数据源；`publish:batch` 已做 `JSON.parse(JSON.stringify(article))` 脱壳（ipc-handlers/publish.js，6.2 前半）。待办：6.1 发布记录「发布方式」徽标三态渲染 + 分片历史 + `publish.api.*` locale（需桌面应用活体视觉验收）。

## 7. 质量门禁与交付

- [ ] 7.1 若触 `apps/desktop/electron/`：QM-1 打包三件套（electron-builder --win --dir + asar list + require 链 + 8s 启动无 stderr）
- [ ] 7.2 `pnpm test`（api-publish-engine + 受影响）全绿、离线可跑；`.quality-gates.md` 自检
- [ ] 7.3 品牌 grep 门禁 + Gate 7 locale-sync 本地预跑通过
- [ ] 7.4 commit（关联本 change）→ push → 开 PR → CI 通过 → autoMerge squash
- [ ] 7.5 活体验收：3 平台真实内容、间隔≥18min、私密优先回查；证据 `01-docs/rpa-api-publish/evidence/api-w1-<platform>/`（`git add -f`）随证据 PR 进仓
- [ ] 7.6 证据回写 PRD 附录 + 技术方案修订记录；经验入内置记忆 + EverOS
- [ ] 7.7 `openspec archive api-publish-engine-w1`（+ CCG task 归档 + 质量节拍复盘，`scripts/openspec-sync-check.js` 核对）
