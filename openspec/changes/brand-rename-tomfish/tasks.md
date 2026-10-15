# Tasks: brand-rename-tomfish

## 1. 前置与隔离（已完成）

- [x] 1.1 质量节拍触发 + pre-code-edit-guard 拦截共享主目录（exit 1，符合预期）
- [x] 1.2 品牌名全量清点：`社媒管家` 66 命中 / 24 文件；`Multi-Publish` 129 命中（electron 域）；`Social Media Manager` 2 命中
- [x] 1.3 隔离 worktree：`bash scripts/session-init.sh brand-rename-tomfish` → `D:/Data/projects/mp-worktrees/mp-brand-rename-tomfish`（D 盘），分支 `brand-rename-tomfish`
- [x] 1.4 依赖就绪：`pnpm install --frozen-lockfile` + `ensure-electron` + `verify-worktree-deps`（11 项解析通过）

## 2. TDD —— 先红（已完成）

- [x] 2.1 改品牌断言（14 文件，测试先行）：`useTabDocumentTitle.test.js`（3 处）、`tests/e2e/verify.js`、`tests/e2e/specs/b1-core-publish.js`、`tests/e2e/helpers/route-functional-suite.js`（2 处）、`tests/e2e/helpers/functional-runner.js`、`tests/e2e/helpers/functional-runner.test.js`、`tests/electron-gui-v8.js`、`tests/server-gui-test.js`、`tests/visual-testing/functional-test.js`、`tests/visual-testing/scripts/run-pixel-tests.js`、`tests/visual-testing/views/all-views.visual.test.js`、`tests/visual-testing/views/supplementary-views.visual.test.js`、`tests/visual-testing/workflows/supplementary-workflows.visual.test.js`
- [x] 2.2 红已实测：`useTabDocumentTitle.test.js` 3 failed（expected '社媒管家' to be '汤姆鱼'）

## 3. 实现 —— 后绿（已完成）

- [x] 3.1 locale zh/en 成对：`tabs` / `onboarding` / `sidebar` / `member-center`（8 文件）
- [x] 3.2 `index.html` `<title>` → 汤姆鱼
- [x] 3.3 `FirstRun.vue` 欢迎语改绑 `$t('onboarding.welcome')` + `useI18n` 引入（消除硬编码中文）
- [x] 3.4 `useTabDocumentTitle.js` 注释同步；`ProfileMenu.vue` 未登录态展示名
- [x] 3.5 主进程：`system-tray.js` tooltip、`identity-auth-window.js` 登录窗标题、`onboarding.js` 引导欢迎标题
- [x] 3.6 `MpSidebar.test.js` logo alt 断言同步
- [x] 3.7 绿已实测：定向 5 文件 51/51 通过（i18n 4 + glossary 2 + i18n.test 17 + useTabDocumentTitle 13 + MpSidebar 15）

## 4. 回归锁（已完成）

- [x] 4.1 新增 `src/i18n/brand-single-source.test.js`（4 例：locale 单一来源 / 旧中文名零残留 / Multi-Publish 白名单 / index.html+FirstRun locale 绑定）
- [x] 4.2 变异反证：FirstRun.vue 改回旧名 → 2 failed；恢复 → 4/4 绿（锁可证在跑）
- [x] 4.3 锁自我豁免：锁自身文件名与注释行不计入命中（否则判据文本自触发）

## 5. 术语表（已完成）

- [x] 5.1 `01-docs/i18n-glossary.md` 登记「汤姆鱼 / Tomfish / tabs.brandTitle」

## 6. 门禁验证（已完成）

- [x] 6.1 `check-locale-sync --pair-base origin/main` → PASS
- [x] 6.2 `check-locale-sync --cjk` → PASS（修复 FirstRun 硬编码后 0 新增）
- [x] 6.3 `check-locale-sync --keys` → PASS（2011 key）
- [x] 6.4 eslint（改动文件）→ 0 error（4 warning 均为存量）
- [x] 6.5 `pnpm run build:vue` → exit 0
- [x] 6.6 `electron-builder --win --dir --publish never` → exit 0
- [x] 6.7 QM-1 启动三层判据：stderr 空 + 窗口标题「汤姆鱼」（handle 237502546）+ 进程存活
- [x] 6.8 静态证据链：asar 内 `<title>`=汤姆鱼 + locale zh/en + 模板绑定，4/4 PASS
- [x] 6.9 预先存在失败已隔离确认：`ProfileMenu.test.js` 2 failed 在 stash 掉本次改动后仍复现（与本次无关）

## 7. 文档（进行中）

- [ ] 7.1 专项 PRD：`01-docs/PRD-BRAND-RENAME-TOMFISH-2026-10-15.md`（数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字）
- [ ] 7.2 `01-docs/PRD.md` 索引登记
- [ ] 7.3 `CHANGELOG.md` 置顶条目
- [ ] 7.4 `.quality-gates.md` 执行记录 + `scripts/gate-record-debt-ledger.json` 登记
- [ ] 7.5 本 tasks 勾选收口

## 8. 交付（待办）

- [ ] 8.1 commit（pre-commit 自动声明分支）+ push
- [ ] 8.2 `gh pr create`（正文含 QM-1 证据与 classify-docs-only 取证）
- [ ] 8.3 `gh pr checks` 零 pending/fail → `gh pr merge --squash --delete-branch`
- [ ] 8.4 回填 PR：`.quality-gates.md` 远程同步 PENDING→PASS + merge SHA、删 ledger 登记、删 `sync_*` 三字段
- [ ] 8.5 worktree 清理：`scripts/safe-worktree-remove.ps1 -WhatIf` 干跑 → 实跑 → R7 对账基线

## 9. 记忆三路沉淀（待办）

- [ ] 9.1 内置记忆（DSH 会话档，harness 自动落盘）
- [ ] 9.2 外部记忆：`01-docs/learnings.md` 新章节 + `~/.gstack/projects/multi-publish/learnings.jsonl`
- [ ] 9.3 EverOS：`POST /api/v1/memory/add` → `flush`（判据取 `extracted` + 落盘文件 grep 哨兵词）
