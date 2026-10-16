# Design: brand-rename-tomfish

## 1. 决策记录

| # | 决策 | 理由 | 备选定案 |
|---|---|---|---|
| D1 | 品牌名走 locale 单一来源，不做「全局常量模块」 | 项目既有 i18n 体系（`locales/<ns>/{zh,en}.js` + CI Gate 7 成对校验 + glossary L3）已是唯一真源；再造一个 `brand.js` 常量等于第二份真源，与 DRY 冲突 | 备选：`src/config/brand.js` 导出 `BRAND_ZH`。否决：渲染端模板要用 `$t` 才符合 i18n 纪律，常量还得再桥接一次 |
| D2 | FirstRun.vue 欢迎语改为 `$t('onboarding.welcome')`，不做局部硬编码 | 原为中文字面量，被 `check-locale-sync --cjk` 判为新增硬编码（exit 1）；按项目纪律用户可见文案必须走 locale，**不得用 `--update-baseline` 掩盖** | 备选：保留硬编码 + `--update-baseline`。否决：那等于把存量债务洗成基线，违反「禁止掩盖新增」 |
| D3 | `Multi-Publish` 保留为工程标识（包名/exe/UA/user-data） | 改 user-data 目录名会丢用户登录态；改 `@multi-publish/*` 包名会破坏 pnpm-lock 与 CI；改 UA 影响平台风控判定 | 备选：全量改名。否决：属破坏性变更，与「用户可见产品名」不是同一件事 |
| D4 | 新增回归锁取「源码事实」而非命名直觉 | 命名会漂移（`brandTitle` 明天可能叫 `productName`）；源码扫描（文件内容 + 行号）与改名解耦 | 备选：断言某个具体 key 的值。否决：key 重构即失效，且覆盖不到散落硬编码 |
| D5 | 锁必须做变异反证 | AGENTS.md 纪律：只证「业务改动变红」不能证明锁在跑；本案已实测（FirstRun 改回旧名 → 2 例同时红） | — |
| D6 | `01-docs/` 既有文档中的旧品牌名**不改** | 属历史事实记录（取证现场、启动证据、PRD 表格）；改了会伪造历史。新文档一律用新名 | 备选：全局替换。否决：会让「窗口标题实测『社媒管家』」这类证据变成假话 |

## 2. 影响面清单（实测清点，非估算）

改名前 `社媒管家` 在仓库共 **66 处命中 / 24 个文件**，按处置分三类：

### 2.1 改（用户可见产品名，14 文件）

| 文件 | 位置 |
|---|---|
| `apps/desktop/src/locales/tabs/zh.js` | `brandTitle` |
| `apps/desktop/src/locales/tabs/en.js` | `brandTitle` |
| `apps/desktop/src/locales/onboarding/zh.js` | `welcome` |
| `apps/desktop/src/locales/onboarding/en.js` | `welcome` |
| `apps/desktop/src/locales/sidebar/zh.js` | `brandLogoAlt` |
| `apps/desktop/src/locales/sidebar/en.js` | `brandLogoAlt` |
| `apps/desktop/src/locales/member-center/zh.js` | `notLoggedInHint` / `login` |
| `apps/desktop/src/locales/member-center/en.js` | 同上 |
| `apps/desktop/src/index.html` | `<title>` |
| `apps/desktop/src/views/FirstRun.vue` | 欢迎语（改绑 locale） |
| `apps/desktop/src/components/ProfileMenu.vue` | 未登录态展示名 |
| `apps/desktop/electron/services/system-tray.js` | 托盘 tooltip |
| `apps/desktop/electron/services/identity/identity-auth-window.js` | 登录窗标题 |
| `apps/desktop/electron/services/onboarding.js` | 引导欢迎标题 |

### 2.2 改（测试断言，11 文件）

`useTabDocumentTitle.test.js`、`MpSidebar.test.js`、`tests/e2e/verify.js`、`tests/e2e/specs/b1-core-publish.js`、`tests/e2e/helpers/route-functional-suite.js`、`tests/e2e/helpers/functional-runner.js`、`tests/e2e/helpers/functional-runner.test.js`、`tests/electron-gui-v8.js`、`tests/server-gui-test.js`、`tests/visual-testing/functional-test.js`、`tests/visual-testing/scripts/run-pixel-tests.js`、`tests/visual-testing/views/all-views.visual.test.js`、`tests/visual-testing/views/supplementary-views.visual.test.js`、`tests/visual-testing/workflows/supplementary-workflows.visual.test.js`

### 2.3 不改（历史事实记录 / 工程标识）

`01-docs/**` 与 `openspec/records/**` 中的旧名（历史证据）、`package.json` `productName`、`@multi-publish/*`、`--user-data-dir`、UA fallback。

## 3. 数据校验规则

| # | 规则 | 判据 | 失败行为 |
|---|---|---|---|
| V1 | zh locale `tabs.brandTitle` 逐字等于「汤姆鱼」 | 字符串相等 | 锁用例 1 失败 |
| V2 | en locale `tabs.brandTitle` 逐字等于「Tomfish」 | 字符串相等 | 锁用例 1 失败 |
| V3 | `onboarding.welcome`（zh/en）含品牌名 | 子串包含 | 锁用例 1 失败 |
| V4 | `index.html` `<title>` 逐字等于 zh `brandTitle` | 子串 `<title>汤姆鱼</title>` | 锁用例 4 失败 |
| V5 | `FirstRun.vue` 含 `$t('onboarding.welcome')` 且 `fr-step-title` 无硬编码中文 | 源码扫描 | 锁用例 4 失败 |
| V6 | 渲染端 + 主进程源码零「社媒管家」 | 全量扫描（排除 `.bundle.js` 与锁自身） | 锁用例 2 失败并列出文件 |
| V7 | `Multi-Publish` 仅在白名单位置 | 逐行正则 + 注释行豁免 | 锁用例 3 失败并给出 `文件:行号` |
| V8 | glossary 术语「汤姆鱼/Tomfish」在 zh/en 出现状态一致 | 既有 glossary 判据 | `glossary.test.js` 失败 |
| V9 | locale 文件 zh/en 成对提交 | 既有 `check-locale-sync --pair-base` | CI Gate 7 失败 |

## 4. 测试策略

- **先红后绿**：先改全部品牌断言（红）→ 改源码（绿）。
- **变异反证**：把 FirstRun.vue 改回旧名 → 用例 2/4 同时红（已实测 2 failed），恢复后 4/4 绿。
- **门禁**：`check-locale-sync` 三件套（pair / cjk / keys）+ eslint + `vitest run`（i18n / composables / layouts 定向）+ `build:vue` + `electron-builder --win --dir`。
- **QM-1 三层判据**：stderr 空（第三层）+ 窗口标题 = 汤姆鱼 + handle 非 0 + 进程存活。

## 5. 已知边界（不假装已闭合）

1. **运行时欢迎页 DOM 未直接取证**：CDP 探针受同名单实例锁竞争影响（`/json/list` 偶发返回空），最终取静态证据链（asar 内 `<title>` + locale 值 + 模板绑定）+ 运行时 `document.title`（一次成功抓到 = 「汤姆鱼」）。`fr-step-title` 的运行时渲染值未在本次取证中直接读到，其正确性由 V3/V5 与 `document.title` 间接保证。
2. **CI 的 E2E/视觉断言未在本次全跑**：这些是需要真实 Electron 窗口的重型用例，由 CI 侧执行；本地只跑了可单测部分。
3. **`Multi-Publish` 白名单是「当前合法残留」快照**：未来若某个白名单位置变成用户可见（例如 UA 出现在 UI 上），白名单需同步收紧——这正是用例 3 的存在意义。
