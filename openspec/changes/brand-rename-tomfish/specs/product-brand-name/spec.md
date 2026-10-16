# Delta Spec: product-brand-name

## ADDED Requirements

### Requirement: 产品品牌名 locale 单一来源

产品的中文品牌名 SHALL 为「汤姆鱼」，英文品牌名 SHALL 为 `Tomfish`；所有用户可见的品牌名 SHALL 取自 locale 文案，渲染端与主进程 SHALL NOT 再以字面量形式写入品牌名。

单一来源键位（zh/en 成对，`apps/desktop/src/locales/`）：

| 键 | zh | en | 用途 |
|---|---|---|---|
| `tabs.brandTitle` | 汤姆鱼 | Tomfish | 标签页标题、未知路由回退标题（`useTabDocumentTitle`） |
| `onboarding.welcome` | 欢迎使用汤姆鱼 | Welcome to Tomfish | 首次运行欢迎页标题 |
| `sidebar.brandLogoAlt` | 汤姆鱼 | Tomfish | 侧边栏 logo 的 alt |
| `memberCenter.notLoggedInHint` / `memberCenter.login` | 登录汤姆鱼（账号）… | Sign in to Tomfish … | 会员中心登录提示与按钮 |

`apps/desktop/src/index.html` 的 `<title>` SHALL 逐字等于 `tabs.brandTitle` 的 zh 值（它是渲染进程首帧标题，先于 locale 装配完成）。

#### Scenario: 未知路由回退品牌名

- **WHEN** `resolveRouteTabTitle()` 收到未登记或空的 path
- **THEN** 返回 `t('tabs.brandTitle')`，即「汤姆鱼」，且 `document.title` 与 `pageManager.reportTabTitle` 上报同一字符串

#### Scenario: 首次运行欢迎页

- **WHEN** 用户首次启动并进入 `/first-run` 路由
- **THEN** Step 0 的 `h2.fr-step-title` 渲染 `$t('onboarding.welcome')`，即「欢迎使用汤姆鱼」，模板中 SHALL NOT 出现品牌名硬编码

#### Scenario: 主进程窗口与托盘

- **WHEN** 应用启动完成
- **THEN** 主窗口标题为「汤姆鱼」（源自 `index.html` `<title>`），系统托盘 tooltip 为「汤姆鱼 — 多平台内容发布」，登录授权窗标题为「登录汤姆鱼」

### Requirement: 旧品牌名零残留与工程标识白名单

渲染端 `apps/desktop/src/` 与主进程 `apps/desktop/electron/` 下的源码文件 SHALL NOT 含旧中文品牌名「社媒管家」；`Multi-Publish` 字面量 SHALL 只保留工程标识与兼容性用途，不得作为用户可见产品名。

白名单判据（命中任一即豁免，均为「与用户可见文案无关」的位置）：

| 模式 | 用途 |
|---|---|
| `user-data` / `userData` | 旧 user-data 目录名，改即丢用户登录态 |
| `User-Agent` / `Mozilla/5.0` / `userAgentFallback` | UA fallback 与其测试夹具 |
| `@multi-publish/` | workspace 包名（锁文件/CI 依赖） |
| `multi-publish.exe` | 旧安装包与进程名 |
| `multi-publish.com` | 历史 API 域名 |
| `Multi-Publish StealthHelper` | 上游 stealth 适配注释 |
| `debug-profile` | 本地调试 profile 路径 |
| `watermarkText:` | ffmpeg 水印夹具文本 |

#### Scenario: 漏改一处即被锁拦下

- **WHEN** 任一源码文件（含 `.js` / `.vue` / `.html` / `.json` / `.cjs`，排除 `.bundle.js` 构建产物与锁自身）含「社媒管家」
- **THEN** `brand-single-source.test.js` 的「渲染端与主进程源码零残留旧中文品牌名」用例失败，并列出文件相对路径

#### Scenario: 用户可见产品名不再泄漏 Multi-Publish

- **WHEN** 某行代码含 `Multi-Publish` 但不命中白名单任一模式（且非注释行、非锁自身）
- **THEN** 同一测试的「仅保留工程标识用途」用例失败，并给出 `文件:行号` 与行内容

### Requirement: 品牌名机械防线（回归锁）

品牌名 SHALL 由 `apps/desktop/src/i18n/brand-single-source.test.js` 机械锁定，判据 SHALL 取源码事实而非命名直觉，且 SHALL 通过变异反证（把任一被锁行为改坏必须立刻变红）。

锁覆盖四条：

1. locale 单一来源值正确（zh=汤姆鱼 / en=Tomfish，welcome 含品牌名）；
2. 渲染端与主进程零残留旧中文品牌名；
3. `Multi-Publish` 仅存于白名单位置；
4. `index.html` 的 `<title>` 与 `FirstRun.vue` 的欢迎语绑定 locale（无硬编码中文）。

#### Scenario: 锁自身可证在跑

- **WHEN** 把 `FirstRun.vue` 的欢迎语临时改回旧品牌名
- **THEN** 用例 2 与用例 4 同时失败（变异反证，2026-10-15 已实测）

### Requirement: i18n 术语表登记产品名词

`01-docs/i18n-glossary.md` SHALL 登记产品名词条目（zh=汤姆鱼 / en=Tomfish / 机器 ID=`tabs.brandTitle`），使 `glossary.test.js` 的「术语在 zh/en locale 出现状态必须一致」判据覆盖品牌名；修改任一品牌名 locale 值时 SHALL 成对修改 zh 与 en。

#### Scenario: 只改中文不改英文

- **WHEN** 仅修改 `locales/tabs/zh.js` 的 `brandTitle` 而未修改 `en.js`
- **THEN** `glossary.test.js` 判定该术语在 zh 出现而 en 未出现，测试失败（i18n-content-sync L3）
