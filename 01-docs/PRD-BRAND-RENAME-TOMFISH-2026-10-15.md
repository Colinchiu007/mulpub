# PRD — 产品中文名统一为「汤姆鱼」（brand-rename-tomfish）

> **日期**：2026-10-15 | **分支**：`brand-rename-tomfish` | **类型**：品牌改名 + i18n 收敛 + 机械防线
> **触发**：用户决定「以后项目和产品的中文名就叫『汤姆鱼』」，要求把项目代码中所有中文产品名（UI 上大量显示为「社媒管家」）改为「汤姆鱼」，并要求持久化到记忆体系与文档。
> **关联**：`openspec/changes/brand-rename-tomfish/`（proposal / design / spec / tasks）、`01-docs/i18n-glossary.md`

---

## 1. 背景与问题定义

产品的中文名长期停留在「社媒管家」（英文 `Social Media Manager`），在仓库中**散落在 24 个文件、66 处命中**，且横跨四个互不相干的层次：

| 层次 | 典型位置 | 后果 |
|---|---|---|
| locale 文案 | `locales/tabs/zh.js` 的 `brandTitle` | 标签页标题、未知路由回退 |
| HTML 首帧 | `src/index.html` 的 `<title>` | 应用窗口标题、Chromium `page-title-updated` |
| Vue 模板 | `views/FirstRun.vue` 的 `<h2>` **硬编码中文** | 首次运行欢迎页；且被 CJK 门禁判为新增硬编码 |
| 主进程常量 | `system-tray.js` / `identity-auth-window.js` / `onboarding.js` | 托盘 tooltip、登录窗标题、引导步骤 |
| 测试断言 | E2E / 视觉 / GUI 门禁共 11 个文件 | 漏改即 CI 红 |

三个结构性问题：

1. **无单一来源**：同一个名字写五份，任何一处漏改就造成「一个产品两个名字」同时出现在 UI 上；
2. **用户可见文案硬编码**：FirstRun 欢迎语不在 locale 内，en 用户与 zh 用户看到的是同一份中文，且违背 i18n 纪律；
3. **无机械防线**：既有 `check-no-brand-residue.js` 查的是**竞品**品牌词（参考产品），与自家产品名口径不同，漏改只能靠人眼 grep。

---

## 2. 目标与非目标

### 2.1 目标

- G1：所有**用户可见**的产品中文名统一为「汤姆鱼」，英文随之为 `Tomfish`；
- G2：品牌名收敛到 locale 单一来源，HTML/模板/主进程不再写字面量；
- G3：建立机械防线，漏改一处即被测试拦下（含变异反证）；
- G4：术语表登记 + PRD/CHANGELOG/执行记录同步，决定持久化到三路记忆。

### 2.2 非目标（明确不做）

- N1：**不改** `package.json` 的 `productName: Multi-Publish`、安装包名 `Multi-Publish.Setup.*`、`@multi-publish/*` workspace 包名、`--user-data-dir` 兼容目录名、UA fallback 中的 `Multi-Publish/1.2.3` —— 这些是**工程标识与兼容性坐标**（改 user-data 目录名会丢用户登录态；改包名会破坏 pnpm-lock 与 CI；改 UA 影响平台风控判定），不是用户可见产品名；
- N2：**不改** `01-docs/` 与 `openspec/records/` 既有文档中的旧品牌名 —— 属历史事实记录（取证现场、启动证据），改了会伪造历史；
- N3：不做 Logo/图标等视觉资产更换（本次仅文案层）；
- N4：不改英文营销定位「AI 内容工作站」等既有品牌叙事。

---

## 3. 数据校验规则

> 判据一律取**源码事实 / 产物事实**，不取命名直觉。

| # | 规则 | 判据 | 失败行为 |
|---|---|---|---|
| V1 | zh locale `tabs.brandTitle` 逐字等于「汤姆鱼」 | 字符串相等 | `brand-single-source.test.js` 用例 1 失败 |
| V2 | en locale `tabs.brandTitle` 逐字等于「Tomfish」 | 字符串相等 | 同上 |
| V3 | `onboarding.welcome`（zh/en）含品牌名 | 子串包含 | 同上 |
| V4 | `index.html` `<title>` 逐字等于 zh `brandTitle` | 源码含 `<title>汤姆鱼</title>` | 用例 4 失败 |
| V5 | `FirstRun.vue` 含 `$t('onboarding.welcome')`，且 `fr-step-title` 无硬编码中文 | 源码正则 | 用例 4 失败 |
| V6 | 渲染端 + 主进程源码零「社媒管家」 | 全量扫描（`.js`/`.vue`/`.html`/`.json`/`.cjs`，排除 `.bundle.js` 与锁自身） | 用例 2 失败并**列出文件相对路径** |
| V7 | `Multi-Publish` 仅在白名单位置 | 逐行正则 + 注释行豁免 + 锁自身豁免 | 用例 3 失败并给出 `文件:行号` 与行内容 |
| V8 | glossary 术语「汤姆鱼/Tomfish」在 zh/en 出现状态一致 | 既有 `glossary.test.js` 判据 | `glossary.test.js` 失败（i18n L3） |
| V9 | locale 文件 zh/en 成对提交 | 既有 `check-locale-sync --pair-base` | CI Gate 7 失败 |
| V10 | 渲染端无新增硬编码中文 | 既有 `check-locale-sync --cjk`（基线增量式） | CI 失败（本次 FirstRun 收敛后 0 新增） |
| V11 | 使用的 i18n key 均存在于 zh/en | 既有 `check-locale-sync --keys` | CI 失败 |
| V12 | 打包产物 `<title>` 与窗口标题一致 | asar 内 `<title>` + 运行时 `MainWindowTitle` | QM-1 判红 |

**`Multi-Publish` 白名单（V7 判据）**：命中任一即豁免 —— `user-data`/`userData`（旧 user-data 目录名）、`User-Agent`/`Mozilla/5.0`/`userAgentFallback`（UA 与夹具）、`@multi-publish/`（包名）、`multi-publish.exe`（安装包/进程名）、`multi-publish.com`（历史 API 域名）、`Multi-Publish StealthHelper`（上游 stealth 注释）、`debug-profile`（调试 profile）、`watermarkText:`（ffmpeg 水印夹具）。

---

## 4. 功能逻辑与流程

### 4.1 品牌名解析链路（改后）

```
路由变化
  → useTabDocumentTitle.resolveRouteTabTitle(path)
      ├─ 精确命中 ROUTE_TITLE_KEYS        → t(<页面 key>)
      ├─ 前缀命中 ROUTE_PREFIX_KEYS       → t(<页面 key>)
      └─ 未命中 / 空 / null               → t('tabs.brandTitle')   ← 「汤姆鱼」
  → document.title = 该文案
  → Chromium page-title-updated（自动）
  → pageManager.reportTabTitle(title)（显式兜底，非 Electron 环境降级为只改 title）
  → 主进程 _tabStates.title → tab-title-updated 广播 → TabBar/NavBar 刷新
```

应用首帧：`index.html` `<title>汤姆鱼</title>` → 主窗口标题（QM-1 实测 `MainWindowTitle=汤姆鱼`）。

### 4.2 首次运行欢迎页流程

```
首次启动（onboarding-done 不存在）
  → 路由 /first-run
  → FirstRun.vue Step 0 渲染 <h2 class="fr-step-title">{{ $t('onboarding.welcome') }}</h2>
      zh：「欢迎使用汤姆鱼」  en：「Welcome to Tomfish」
  → 副标题「三步完成配置，即可开始多平台一键发布」（既有，未改）
  → 步骤 ① 环境检测 → ② 添加账号 → ③ 首次发布
```

### 4.3 主进程品牌名触点

| 触点 | 改后文案 | 来源 |
|---|---|---|
| 主窗口标题 | 汤姆鱼 | `index.html` `<title>` |
| 系统托盘 tooltip | 汤姆鱼 — 多平台内容发布 | `system-tray.js` 常量 |
| 登录授权窗标题 | 登录汤姆鱼 | `identity-auth-window.js` `title` |
| onboarding 引导欢迎步 | 欢迎使用汤姆鱼 | `onboarding.js` `ONBOARDING_STEPS[0].title` |
| 侧边栏 logo alt | 汤姆鱼 | `sidebar.brandLogoAlt`（locale） |
| 会员中心未登录提示 | 登录汤姆鱼账号后，可查看云端会员权益、资源配额与账号信息。 | `memberCenter.notLoggedInHint`（locale） |
| 会员中心登录按钮 | 登录汤姆鱼 | `memberCenter.login`（locale） |
| 用户菜单未登录展示名 | 汤姆鱼 | `ProfileMenu.vue` 兜底字面量 |

### 4.4 改名执行流程（本次 SOP，供未来复用）

```
① pre-code-edit-guard 拦截共享主目录（exit 1 才合规）
② 全量清点：grep 旧名（中文 + 英文 + 缩写三类形态），按「用户可见 / 测试 / 历史记录 / 工程标识」四类分拣
③ session-init.sh 建隔离 worktree（D 盘）
④ TDD 先红：改全部测试断言 → 跑一次确认红
⑤ 改源码（locale 成对优先，其次 HTML/模板，最后主进程）
⑥ 新增回归锁 + 变异反证
⑦ 门禁：locale-sync 三件套 + eslint + build:vue + electron-builder
⑧ QM-1：打包启动，取窗口标题 + stderr 三层判据
⑨ 文档：专项 PRD + PRD.md 索引 + CHANGELOG + .quality-gates.md + openspec 五件套
⑩ PR → CI 绿 → 自动合并 → 回填销账 → worktree 清理
⑪ 记忆三路沉淀 + 回读验证
```

---

## 5. 交互逻辑

### 5.1 标签页标题交互（行为不变，仅文案变）

- 用户切换路由 → 标签标题实时更新；未登记路由回退「汤姆鱼」而非「新标签页」残留；
- `+` 新建标签（home-shell 实例）同样走该链路；
- IPC 上报失败静默降级：`document.title` 仍更新，rejection 被吞，不产生 unhandled rejection（既有契约不变）。

### 5.2 首次运行引导交互（行为不变，仅文案变）

- Step 0 展示欢迎语 + 三步说明 + 「开始配置 →」按钮；
- 点击「开始配置 →」进入 Step 1（环境检测）；引导完成后写 `onboarding-done` 标记，不再进入。

### 5.3 登录授权窗交互（行为不变，仅标题变）

- 未登录态点用户菜单头像 → 直接触发登录，弹出授权窗（标题「登录汤姆鱼」）；
- 授权窗 `backgroundThrottling: false`（隐藏期不节流，既有节流口径不变）。

---

## 6. 显示项（全量清单）

| # | 界面位置 | 显示项 | 改前 | 改后 | 来源 |
|---|---|---|---|---|---|
| 1 | 应用窗口标题栏 | 主窗口标题 | 社媒管家 | 汤姆鱼 | `index.html` |
| 2 | 标签栏（未知路由回退） | 标签标题 | 社媒管家 | 汤姆鱼 | `tabs.brandTitle` |
| 3 | 首次运行 Step 0 | 欢迎标题 | 欢迎使用社媒管家 | 欢迎使用汤姆鱼 | `onboarding.welcome` |
| 4 | 侧边栏顶部 | logo alt（无障碍） | Multi-Publish | 汤姆鱼 | `sidebar.brandLogoAlt` |
| 5 | 系统托盘 | 悬停 tooltip | Multi-Publish — 多平台内容发布 | 汤姆鱼 — 多平台内容发布 | `system-tray.js` |
| 6 | 登录授权窗 | 窗口标题 | 登录 Multi-Publish | 登录汤姆鱼 | `identity-auth-window.js` |
| 7 | onboarding 引导 | 欢迎步标题 | 欢迎使用 Multi-Publish | 欢迎使用汤姆鱼 | `onboarding.js` |
| 8 | 会员中心（未登录） | 提示文案 | 登录 Multi-Publish 账号后… | 登录汤姆鱼账号后… | `memberCenter.notLoggedInHint` |
| 9 | 会员中心（未登录） | 登录按钮 | 登录 Multi-Publish | 登录汤姆鱼 | `memberCenter.login` |
| 10 | 用户菜单（未登录） | 展示名 | Multi-Publish | 汤姆鱼 | `ProfileMenu.vue` |

---

## 7. 提示文字（zh/en 成对）

| 键 | zh | en |
|---|---|---|
| `tabs.brandTitle` | 汤姆鱼 | Tomfish |
| `onboarding.welcome` | 欢迎使用汤姆鱼 | Welcome to Tomfish |
| `sidebar.brandLogoAlt` | 汤姆鱼 | Tomfish |
| `memberCenter.notLoggedInHint` | 登录汤姆鱼账号后，可查看云端会员权益、资源配额与账号信息。 | Sign in to Tomfish to view cloud membership, quota and account info. |
| `memberCenter.login` | 登录汤姆鱼 | Sign in to Tomfish |
| 托盘 tooltip（主进程） | 汤姆鱼 — 多平台内容发布 | —（tooltip 未本地化，既有形态） |
| 登录窗标题（主进程） | 登录汤姆鱼 | —（窗口标题未本地化，既有形态） |

---

## 8. 测试覆盖

| 层 | 文件 | 覆盖 |
|---|---|---|
| 单元（新增） | `src/i18n/brand-single-source.test.js` | 4 例：locale 单一来源 / 旧中文名零残留 / Multi-Publish 白名单 / HTML+模板 locale 绑定 |
| 单元（改） | `src/composables/useTabDocumentTitle.test.js` | 13 例，3 处品牌断言 |
| 单元（改） | `src/layouts/MpSidebar.test.js` | 15 例，logo alt 断言 |
| 单元（既有） | `src/i18n/glossary.test.js` | 2 例，术语 zh/en 出现状态一致 |
| 单元（既有） | `src/i18n/i18n.test.js` | 17 例，占位符与消息函数一致性 |
| E2E（改） | `tests/e2e/**` 5 文件 | 欢迎语/标题断言 |
| 视觉（改） | `tests/visual-testing/**` 4 文件 | `first-run` 视图等待选择器 |
| GUI 门禁（改） | `tests/electron-gui-v8.js`、`tests/server-gui-test.js` | 首页标题断言 |
| 打包（QM-1） | `electron-builder --win --dir` + 启动取证 | 窗口标题 + stderr 三层判据 |

**变异反证**：把 `FirstRun.vue` 欢迎语临时改回旧品牌名 → 用例 2 与用例 4 同时失败（2 failed）→ 恢复后 4/4 绿。证明锁本身在跑，而非只对业务改动敏感。

---

## 9. 验收标准

| # | 判据 | 状态 |
|---|---|---|
| A1 | 定向测试 5 文件 51/51 通过 | ✅ |
| A2 | `check-locale-sync --pair-base` PASS | ✅ |
| A3 | `check-locale-sync --cjk` PASS（0 新增硬编码） | ✅ |
| A4 | `check-locale-sync --keys` PASS（2011 key） | ✅ |
| A5 | eslint 改动文件 0 error | ✅ |
| A6 | `build:vue` exit 0 | ✅ |
| A7 | `electron-builder --win --dir` exit 0 | ✅ |
| A8 | QM-1 启动：stderr 空 + 窗口标题「汤姆鱼」+ handle 非 0 + 进程存活 | ✅ |
| A9 | asar 内 `<title>` = 汤姆鱼 | ✅ |
| A10 | 变异反证通过（锁可证在跑） | ✅ |
| A11 | glossary 术语登记并通过 L3 校验 | ✅ |
| A12 | PRD / CHANGELOG / .quality-gates.md / openspec 五件套齐备 | ✅ |
| A13 | 品牌残留门禁 PASS + 记录债门禁 OK | ✅ |
| A14 | CI 视觉渲染直接取证：浅/暗两档均显示「欢迎使用汤姆鱼」 | ✅ |
| A15 | 视觉基线按 CI artifact 同源重建 + SHA-256 自证逐字节一致 | ✅ |
| A16 | PR 合并 + 回填销账 | 待办 |
| A17 | 记忆三路沉淀 + 回读验证 | 待办（EverOS 已完成并读回） |

---

## 10. 已知边界与风险

1. ~~**运行时欢迎页 DOM 未直接取证**~~ → **像素层已直接取证（2026-10-15 补记）**：文本层（`fr-step-title` 的 DOM 文本）仍以静态证据链（asar `<title>` + locale 值 + 模板绑定）+ 运行时 `document.title`（= 汤姆鱼）为准；而**像素层已拿到 CI 权威渲染**。
   **补记（本 PR 的 Gate 7b round1/round2 渲染，已人工审阅）**：`QG Visual` 首跑判红两张基线（`first-run.png` 1490 px / 0.072%、`first-run-dark.png` 1504 px / 0.073%），两轮均红 ⇒ 判定为**确定性漂移**（正是欢迎语由「欢迎使用社媒管家」改为「欢迎使用汤姆鱼」造成的像素差）。从该 run 的 artifact（`quality-gate-visual-reports`）取权威渲染后：
   - `screenshots-round1/first-run.png` ≡ `screenshots/first-run.png` ≡ `screenshots-round1/first-run-current.png`，SHA-256 同为 `516A661C…F2D0`（**三个来源逐字节相同**）；
   - `screenshots-round1/first-run-dark-current.png` ≡ `screenshots/first-run-dark-current.png`，SHA-256 同为 `E8B55E2F…1210`（**两轮逐字节相同**）；
   - 两张图**人工审阅确认**渲染正常（图标、三步列表、按钮、步骤点齐全，非空白/破损页）且标题显示为「**欢迎使用汤姆鱼**」（浅色与暗色一致）。
   ⇒ **这项边界在像素层已闭合**：UI 上确实显示新品牌名，这是运行时证据，不再只是静态推断。
2. **CI 侧重型用例（E2E / 视觉）未在本地全跑**：需真实 Electron 窗口与 CI 自建 dev server，由 CI 执行（本 PR 的 `QG Visual` / `QG Browser E2E` / `QG Desktop Shards` 即其证据）。
3. **基线来源纪律**：视觉基线**只能取自 CI artifact，禁止用本机渲染**（AGENTS.md QM-4 第 7 条；本仓有 #2685 用本机重捕把 9 张基线漂掉的前例）。本次回填严格走「取 CI artifact → 人工审阅 → 替换 → 自证 SHA-256 与 CI 渲染逐字节一致」，且**只改这两张**（`git status` 仅这两条 M）。
4. **`Multi-Publish` 白名单是当前快照**：若未来某个白名单位置变成用户可见（如 UA 出现在 UI），需同步收紧白名单 —— 这正是用例 3 的存在意义。
5. **用户本机仍跑着旧实例**：`mp-app-live2` worktree 的实例窗口标题还是「社媒管家」（旧代码），需用户重启该实例后才会显示新名。本次不改用户运行态。
6. **`mavis-trash` 缺失**：本机回收后端不在 PATH，`safe-delete.js` 对本次探针脚本恒 FAILED（审计日志已记录）。探针脚本为 untracked 一次性产物，已按 R0「不做目录递归删除」纪律**移出** worktree 至 `F:\Temp\brand-rename-holding-20261015\`（无损可逆），未纳入 PR。

---

## 11. 决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 品牌名走 locale 单一来源，不造 `brand.js` 常量模块 | 既有 i18n 体系（成对校验 + glossary L3）已是唯一真源；再造常量等于第二份真源 |
| D2 | FirstRun 欢迎语改绑 locale，不用 `--update-baseline` 掩盖 | 项目纪律禁止用基线刷新掩盖新增硬编码 |
| D3 | `Multi-Publish` 保留为工程标识 | 改 user-data 目录名会丢登录态；改包名破坏锁文件与 CI |
| D4 | 回归锁取源码事实（内容+行号）而非命名 | 命名会漂移，源码扫描与 key 名解耦 |
| D5 | 锁必须做变异反证 | AGENTS.md 纪律：只证业务改动变红不能证明锁在跑 |
| D6 | 既有文档中的旧品牌名不改 | 属历史事实记录，改了会伪造取证现场 |
