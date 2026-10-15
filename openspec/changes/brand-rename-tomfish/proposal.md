# Proposal: brand-rename-tomfish（产品中文名统一为「汤姆鱼」）

## Why

产品的中文名长期停留在「社媒管家」（英文 `Social Media Manager`），散落在 **20+ 个互不相干的位置**：locale 文案、`index.html` 的 `<title>`、FirstRun 欢迎页硬编码、主进程托盘 tooltip、登录窗标题、onboarding 服务步骤文案，以及十余个测试断言（E2E / 视觉 / GUI 门禁）里。

用户 2026-10-15 决定：**产品与项目的中文名统一改为「汤姆鱼」**（英文随之为 `Tomfish`），并要求该决定持久化到记忆体系与文档，后续一律以此为准。

这次改名暴露了三个结构性问题：

1. **没有单一来源**：同一个名字在 locale、HTML、Vue 模板、主进程常量里各写一份，任何一处漏改就造成「一个产品两个名字」同时出现在 UI 上；
2. **用户可见文案硬编码**：FirstRun.vue 的欢迎语是中文字面量（`欢迎使用社媒管家`），既不在 locale 里，也被 `check-locale-sync --cjk` 判为「新增硬编码」——存量债务，本次一并收敛；
3. **无机械防线**：改名前没有任何锁能发现「漏改一处」，只能靠人眼 grep；`check-no-brand-residue.js` 查的是**竞品**品牌词（蚁小二），与自家产品名口径不同，互不替代。

## What Changes

### ADDED Capabilities

- `product-brand-name`：产品品牌名的单一来源契约——中文名「汤姆鱼」/ 英文 `Tomfish` 一律取自 locale（`tabs.brandTitle` / `onboarding.welcome` / `sidebar.brandLogoAlt` 等），任何渲染端与主进程位置不得出现旧品牌名字面量；含「旧名零残留」与「新名来自 locale」两条机械判据。

### MODIFIED Requirements

- `i18n-content-sync`（locales 成对）：`tabs` / `onboarding` / `sidebar` / `member-center` 四个命名空间的 zh/en 文案随品牌名同步变更，仍遵守「同目录 zh.js ↔ en.js 成对」既有口径。
- `i18n-glossary`（术语表 L3）：新增产品名词条目「汤姆鱼 ↔ Tomfish ↔ tabs.brandTitle」，使 `glossary.test.js` 的「zh/en 出现状态一致」判据覆盖品牌名。

## Impact

- **渲染端（`apps/desktop/src/`）**：
  - `locales/tabs/zh.js` + `en.js`：`brandTitle` 社媒管家 → 汤姆鱼 / Social Media Manager → Tomfish（标签页标题与未知路由回退的单一来源）；
  - `locales/onboarding/zh.js` + `en.js`：`welcome` 欢迎使用 Multi-Publish → 欢迎使用汤姆鱼 / Welcome to Tomfish；
  - `locales/sidebar/zh.js` + `en.js`：`brandLogoAlt` Multi-Publish → 汤姆鱼 / Tomfish（侧边栏 logo alt）；
  - `locales/member-center/zh.js` + `en.js`：登录提示与登录按钮里的产品名；
  - `index.html`：`<title>` 社媒管家 → 汤姆鱼；
  - `views/FirstRun.vue`：欢迎语由硬编码中文改为 `$t('onboarding.welcome')`（消除硬编码 + 纳入 locale 单一来源）；
  - `composables/useTabDocumentTitle.js`：仅注释中的品牌名同步；
  - `components/ProfileMenu.vue`：未登录态的展示名。
- **主进程（`apps/desktop/electron/`）**：`services/system-tray.js` 托盘 tooltip、`services/identity/identity-auth-window.js` 登录窗标题、`services/onboarding.js` 引导步骤欢迎标题。
- **测试**：`useTabDocumentTitle.test.js` / `MpSidebar.test.js` 的品牌名断言；`tests/e2e/{verify,specs/b1-core-publish,helpers/route-functional-suite,helpers/functional-runner,helpers/functional-runner.test}.js`、`tests/electron-gui-v8.js`、`tests/server-gui-test.js`、`tests/visual-testing/**` 共 11 个文件的欢迎语/标题断言。
- **新增回归锁**：`src/i18n/brand-single-source.test.js`（4 例，含变异反证）。
- **不涉及**：
  - `package.json` 的 `productName: Multi-Publish`、安装包名 `Multi-Publish.Setup.*`、`@multi-publish/*` workspace 包名、`--user-data-dir` 兼容目录名、UA fallback 里的 `Multi-Publish/1.2.3`——这些是**工程标识与兼容性坐标**（改 user-data 目录名会丢用户登录态；改包名会破坏锁文件与 CI），不是用户可见产品名，按白名单保留；
  - `01-docs/` 下既有文档中的历史品牌名（属历史事实记录，改它会伪造取证现场；本 PRD 与执行记录如实登记）。
