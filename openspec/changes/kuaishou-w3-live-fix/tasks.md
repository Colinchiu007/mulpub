# Tasks: kuaishou-w3-live-fix

## 1. D1 — API-first 凭证 auth 分区兜底（TDD 先红后绿）

- [x] 1.1 红测 `apps/desktop/electron/services/rpa-view-manager-api-cookie-fallback.test.js`：四个 Scenario 全覆盖（store 空+分区有→publishViaApi 收到分区拼串；双空→空串 fail-closed 现状；跨平台域过滤不串味；store 非空不读分区）
- [x] 1.2 红测：`findAuthPartitionDir` 抽取后 `_restoreAuthPartitionCookies` 行为不变（rpa-view-session.test.js 既有用例全绿即为回归）
- [x] 1.3 实现：`rpa-view-session.js` 抽出 `findAuthPartitionDir(platform, accountId)` 纯函数（fs 定位，兼容 auth-auth-/auth-/account- 前缀）；`rpa-view-manager.js` API-first 分支空串时经 `session.fromPartition` 只读分区 cookie，`isPlatformCookieDomain` 过滤后拼串；warn 日志含分区名与计数
- [x] 1.4 回归面：rpa-view-manager / publisher-router / kuaishou-chain / kuaishou-adapter / douyin 相关 suites 全绿

## 2. D2 — 快手发布按钮选择器（活体取证门）

- [x] 2.1 活体只读侦察（CDP auth 视图，零发布副作用）：已登记 `01-docs/rpa-api-publish/evidence/api-w3-kuaishou/selector-probe-20260926.md`。**结论：快手登录态已失效（/profile 渲染登出营销页），发布页不可达；D2 定性从"选择器漂移"修正为"登录态失效阻断"，选择器刷新需重登后复测才能定夺**
- [ ] 2.1b （解锁项，需用户扫码）快手重登后复跑 probe-d2-diag.js 枚举发布页真实按钮 DOM，再判定 2.2/2.3 是否需要改动
- [ ] 2.2 红测：`platform-selectors` kuaishou publish_btn 新文案命中 + 旧文案尾部兜底 + 负例（登录页/未就绪不误命中），对齐 platform-definitions.test.js 负例形态
- [ ] 2.3 实现：按 2.1 取证刷新 `packages/rpa-engine/src/platform-selectors.js` kuaishou `publish_btn` 候选序列
- [ ] 2.4 rpa-engine run-tests 全绿

## 3. 门禁与交付

- [x] 3.1 全量：桌面 vitest 受影响 suites（5 suites 83 tests 绿，含 publisher-router 回归）+ api-publish-engine run-tests（31 files 258 tests 绿）+ Gate 7 locales（--pair-base origin/main PASS，无新增文案）+ Gate 17 IPC 守卫（PASS，注册点 428/显式守卫 66.8%/不可判定 0）+ ESLint（0 error，5 warning 均为 HEAD 既有代码）
- [x] 3.2 QM-1 打包三件套：首轮仅 `electron-builder --dir` 漏 renderer（asar 无 `\dist\index.html`，exe 启动报 ERR_FILE_NOT_FOUND）→ 改用 `pnpm run build:dir`（vite build + builder）重打；复测三件套全过（asar 含 dist/index.html + auth-partition.js；asar extract 后 require 链 rpa-engine OK、相对依赖 fs 核实存在；exe 10s 存活 stderr 零输出）。fonts/.playwright-browsers 缺失警告为 worktree 无可选资源，预期内
- [x] 3.3 commit 404fce4e95 + push + PR #2444 + CI 17 项全绿（16 pass + release skipping），squash merge de65abdbf0 已合并
- [x] 3.4 证据收编：`live-verdict-20260926.md`、`live-run-20260926-applog.txt`、`live-run-20260926-progress.json` 已从共享根收编入 `01-docs/rpa-api-publish/evidence/api-w3-kuaishou/` 随本 PR 提交；D2 侦察证据 `selector-probe-20260926.md`/`-authview.png`（.md/.png 被 gitignore，按 spike-verdict.md 先例 `git add -f`）+ `-shell.json` 一并登记
- [ ] 3.5 （用户在场）6.3 活体重跑：D1 后 API 链可达 + D2 后 DOM 兜底可点；通过后回写 W3 tasks 6.1/6.3 收口
