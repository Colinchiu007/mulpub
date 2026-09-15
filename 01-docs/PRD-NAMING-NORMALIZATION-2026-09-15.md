# PRD — 应用命名空间规范化（去品牌化）v1.0

> **立项日期**：2026-09-15
> **类型**：重构（命名/文案规范化），零功能变更
> **复杂度**：L（跨全仓 271 文件）｜ **风险**：中（大面积文本改动 + 文件改名，靠自动化管线与门禁兜底）
> **关联**：`CHANGELOG.md`「chore(naming): 应用命名空间去品牌化」、`01-docs/learnings.md`「全仓命名清理三道防线」、`scripts/check-no-brand-residue.js`

---

## 0. 术语与写法约定

本仓库已建立**品牌残留门禁**（`scripts/check-no-brand-residue.js`）：参考产品品牌词的任何字面形式（中文名称、全拼大小写变体、三字母缩写变体）不得出现在任何 tracked 文本文件中，**包括本文档自身**。因此本文用占位符指代：

| 占位符 | 指代 |
| --- | --- |
| `<brand>` / `<Brand>` / `<BRAND>` | 参考产品品牌词的全拼小写 / 首字母大写 / 全大写形式 |
| `<abbr>` / `<Abbr>` / `<ABBR>` | 同一品牌词的三字母缩写（取三个音节首字母）的小写 / 首字母大写 / 全大写形式 |
| `<中文品牌名>` | 该参考产品的中文名称 |
| `<signer-host>` | 第三方远程签名服务域名（`qianming.` + 全拼小写 + `.cn`），本仓唯一保留的功能性依赖 |

---

## 1. 背景与目标

### 1.1 背景

代码库早期以「参考某个成熟多平台发布产品」的方式推进 UE 与发布链路建设，命名空间、注释、文档、任务归档中残留了大量指向该参考产品的品牌词。品牌词会让阅读者误判代码来源，也不利于仓库以中立形态对外呈现。

存量盘点（基于 `git ls-files` 全量扫描，2026-09-15）：

| 维度 | 数量 |
| --- | --- |
| 含品牌词的 tracked 文件 | **271** |
| 命中总次数 | **1662** |
| 分布最多目录 | `apps/desktop`（72 文件 / 549 处）、`.ccg/tasks`（69 / 257）、`01-docs`（35 / 227）与 `01-docs/<brand>-reverse/`（25 / 211） |
| 文件名 / 目录名带品牌词 | **56** 项（含 2 个组件 + 2 个组件测试、12 个 `.ccg` 任务目录、13 个脚本、1 个逆向资料目录、1 个 openspec 规格目录） |

### 1.2 目标

1. **零品牌残留**：全仓 tracked 文本文件中不再出现品牌词（`<中文品牌名>`、`<brand>`/`<Brand>`/`<BRAND>`、`<abbr>`/`<Abbr>`/`<ABBR>`），路径同样清零。
2. **命名空间统一**：应用层 DOM/CSS 命名空间统一为 `mp-`（与既有 `mp-skeleton-*` 一致），组件命名为 `Mp*`，常量为 `MP_*`。
3. **零行为变更**：不改变任何业务逻辑、接口契约、视觉呈现（唯一例外见 §3.1）。
4. **可验证、可回归**：残留校验、编码安全校验、全量单测、CI 门禁四层验收，并把残留校验固化为可重复执行的门禁脚本。

### 1.3 非目标（Out of Scope）

- 不重写任何注释的表达结构（只做品牌词级替换，保留注释原有技术信息）。
- 不清理 **二进制资产**（`.mp4`/`.png` 等）内部的**随机字节巧合命中**——压缩数据中的字节匹配改写会损坏文件，且不构成可读品牌痕迹。
- 不迁移本地磁盘上的外部逆向资料目录（如 `D:/Data/mp-extracted/`），仅处理仓库内内容。

---

## 2. 命名规范（映射表）

### 2.1 标识符与 DOM

| 类别 | 旧 | 新 | 影响面 |
| --- | --- | --- | --- |
| CSS 类名 | `<brand>-sidebar`、`<brand>-home-*`、`<brand>-service-*`、`<brand>-tool-*`、`<brand>-module-*`、`<brand>-primary-*` 等 | `mp-sidebar`、`mp-home-*`、`mp-service-*`、`mp-tool-*`、`mp-module-*`、`mp-primary-*` | `MpSidebar.vue`、`MpModuleNav.vue`、`Home.vue`、`SidebarServiceStatus.vue`、`ProfileMenu.vue`、`App.vue` 及对应测试/视觉选择器 |
| `data-testid` | `<brand>-workspace`、`<brand>-home*`、`<brand>-profile*`、`<brand>-service*` | `mp-workspace`、`mp-home*`、`mp-profile*`、`mp-service*` | 同上 + E2E/视觉测试脚本 |
| CSS 自定义属性 | `--<brand>-nav-height`、`--<brand>-sidebar-width` | `--mp-nav-height`、`--mp-sidebar-width` | `cohere-design-system.css` 定义 + 全部消费点（如 `ResultView.vue` 固定操作条） |
| 组件 | `<Brand>Sidebar.vue` / `<Brand>ModuleNav.vue`（含 `.test.js`） | `MpSidebar.vue` / `MpModuleNav.vue` | `App.vue` 导入、`main.js` 注册、测试、文档 |
| 布尔判定 | `is<Brand>Workspace` | `isMpWorkspace` | `App.vue` 及文档 |
| 常量 | `<BRAND>_MANIFEST`、`<BRAND>_CAPTURE_LAYOUT`、`<ABBR>_PID` | `MP_MANIFEST`、`MP_CAPTURE_LAYOUT`、`MP_PID` | 逆向/截图脚本 |
| 内部工具类 | `<Abbr>Cap` / `<Abbr>Helper` / `<Abbr>Capture` / `<Abbr>Window` | `MpCap` / `MpHelper` / `MpCapture` / `MpWindow` | 截图捕获脚本 |

### 2.2 数据字段（模型契约）

| 旧字段 | 新字段 | 语义 | 影响面 |
| --- | --- | --- | --- |
| `collection.<brand>Id` | `collection.sourceId` | 合集在来源侧的 id（百家号映射 `bjhtopic_id`、B 站映射 `season_id`） | `packages/api-publish-engine/src/adapters/baijiahao.js`、`bilibili.js`、`apps/desktop/electron/services/publisher-router.js` |
| `collection.<brand>Name` | `collection.sourceName` | 合集来源侧名称 | 同上（`bjhtopic_info.topic_name` 取值链） |
| 用户信息返回形态 `<brand>Id` / `<brand>Name` / `<brand>ImageUrl` | `userId` / `userName` / `userAvatarUrl` | 仅抽象方法 docstring 描述（无实现消费） | `packages/python-backend/src/multi_publish/core/query_worker.py` |

> **字段重命名的兼容性说明**：`collection.sourceId` 只在本仓内部生产与消费（渲染层 → IPC → 发布路由 → 适配器），不存在以旧字段名落盘的持久化数据，也不存在第三方以旧字段名回传的接口，因此重命名无迁移成本。字段读取仍保留 `collection.id || collection.sourceId` 的回退顺序。

### 2.3 路径与目录

| 旧 | 新 | 说明 |
| --- | --- | --- |
| `01-docs/<brand>-reverse/` | `01-docs/ui-reference/` | 逆向分析资料（analysis / prd / scripts / screenshots / test-cases / manifest） |
| `01-docs/PRD-<brand>-reuse.md`、`TEST-CASES-<brand>-reuse.md`、`<BRAND>-REUSABLE-*.md` | `PRD-mp-reuse.md`、`TEST-CASES-mp-reuse.md`、`MP-REUSABLE-*.md` | 复用分析文档 |
| `01-docs/archive/<brand>-*.md` | `01-docs/archive/mp-*.md` | 归档报告 |
| `.ccg/tasks/archive/**/<brand>-*`（12 个任务目录） | `mp-*` | 任务归档 slug |
| `.ccg/handover-<brand>-ue-parity-20260829.md` | `.ccg/handover-mp-ue-parity-20260829.md` | 交接报告 |
| `apps/desktop/src/layouts/<Brand>{Sidebar,ModuleNav}{,.test.js}` | `Mp{Sidebar,ModuleNav}{,.test.js}` | 组件 |
| `apps/desktop/electron/tests/<brand>-pixel-audit.test.js` | `mp-pixel-audit.test.js` | 像素审计 |
| `apps/desktop/tests/e2e/<brand>-*.js`（4 个） | `mp-*.js` | E2E 诊断脚本 |
| `apps/desktop/tests/visual-testing/{compare,capture}-<brand>*` | `*-mp*` | 视觉比对/捕获脚本与测试 |
| `scripts/<brand>-*.ps1`、`scripts/<abbr>.cs`、`run_<brand>_screenshots.ps1` | `mp-*` / `run_mp_screenshots.ps1` | 捕获/修复脚本 |
| `docs/plans/2026-07-20-<brand>-account-publish-parity.md` | `2026-07-20-mp-account-publish-parity.md` | 计划文档 |
| `openspec/specs/<brand>-ue-closure/`、`openspec/changes/archive/2026-09-13-task-051-<brand>-closure/` | `mp-ue-closure` / `task-051-mp-closure` | 规格与归档 change |

### 2.4 文案表述

| 旧 | 新 | 场景 |
| --- | --- | --- |
| `<中文品牌名>逆向工程` | `参考产品逆向分析` | 注释/文档中的来源描述 |
| `<中文品牌名>逆向` | `参考产品逆向分析` | 同上（长匹配优先） |
| `参考<中文品牌名>` | `参考同类产品` | 避免「参考同类产品」叠词（替换后二次修正） |
| `<中文品牌名>` | `参考产品` | 其余全部中文语境 |
| `www.<brand>.cn/web` / `lj.<brand>.cn` | `参考产品云端控制台` / `参考产品云端登录态服务` | 文档描述（非代码依赖） |

---

## 3. 功能逻辑（不变式）

以下**全部保持不变**，替换只作用于名称与文案：

1. **发布链路**：API 直调 / RPA 双轨、CancelToken 阶段级取消、任务并行池、上传分片与合并、封面裁剪、发布后状态查询。
2. **账号链路**：登录检测（HTTP 快速路径）、凭证存储（CookieContainer 双层）、账号状态恢复（restoreCookies / restoreLocalStorage / openSavedAccount）。
3. **壳层交互**：`MpSidebar` 固定首页标签、虚拟登录标签（全屏标签式登录）、window.open 拦截、侧边栏宽度同步（`setSidebarWidth` IPC）。
4. **模块导航**：tab 切换、工具面板展开/收起、Esc/外部点击关闭。
5. **视觉呈现**：仅类名与 CSS 变量名改变，声明值与选择器一一对应更新，计算后样式不变。

### 3.1 唯一行为变化

`packages/api-publish-engine/src/signer.js`：

```js
const SIGNER_BASE = process.env.MP_SIGNER_BASE || "http://<signer-host>";
```

- **动机**：`<signer-host>` 是第三方远程签名服务（外部 HTTP 服务），属发布链路硬依赖（百家号签名无本地回退），无法随品牌清理移除；将其收敛为「可覆盖的环境变量 + 默认值」后，注释改为中性的「第三方远程签名服务」，代码归属表述不再指向参考产品。
- **兼容性**：未设置 `MP_SIGNER_BASE` 时行为与改动前完全一致；自建签名服务时可通过环境变量切换。
- **降级路径**：远程不可用时抖音 / 快手 / 小红书自动回退 `signer-local.js` 本地实现（既有逻辑，未改动）。

---

## 4. 交互逻辑、显示项与提示文字

### 4.1 交互逻辑

- 所有交互**触发条件、状态流转、事件链路均不变**；变化的只是选择器字符串：
  - 组件测试中的 `wrapper.get('[data-testid="<brand>-profile"]')` → `'[data-testid="mp-profile"]'`；
  - 视觉/像素测试的 `waitFor: '.<brand>-workspace .target-selector …'` → `'.mp-workspace …'`；
  - `apps/desktop/tests/visual-testing/selectors.json` 中 3 处选择器同步更新。
- 无新增交互、无删除交互、无禁用态变化。

### 4.2 显示项

- 用户可见的视觉产物（页面布局、组件、颜色、间距）**零变化**；像素级回归依赖同一套视觉基线（截图内容不受类名影响）。
- DOM 结构不变（类名/测试 id 字符串除外），无新增/删除节点。

### 4.3 提示文字

| 项 | 变更前 | 变更后 | 说明 |
| --- | --- | --- | --- |
| 侧边栏主导航 `aria-label` | `<中文品牌名>主导航` | `主导航` | **唯一用户可见文案变更**：去品牌化后不应在无障碍标签中保留参考产品名；语义仍为「主区域导航」，屏幕阅读器播报更准确 |
| 其余用户可见文案 | — | 无变更 | 渲染层无硬编码品牌词（locales zh/en 中 0 处命中，`--keys` 门禁验证 955 个 key 不受影响） |

---

## 5. 数据校验（验收标准）

| # | 校验 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| V1 | 品牌残留扫描（字节级，`scripts/check-no-brand-residue.js`） | 内容命中 = 0，路径命中 = 0 | ✅ |
| V2 | 豁免口径 | 仅允许 `<signer-host>`（第三方服务域名）出现 | ✅ |
| V3 | 编码安全 | 非 UTF-8 原文件不产生 U+FFFD 数据丢失；BOM 保持 | ✅（2 个 GBK 归档文档按 UTF-8 归一，丢失 3 个无效字节，见 §7） |
| V4 | 索引完整性 | `git ls-files` 条目数改动前后一致（5421） | ✅ |
| V5 | i18n 门禁 | `--cjk`（基线 1644）/ `--keys`（955 key）/ `--py-cjk`（91）全部 PASS | ✅ |
| V6 | Lint 门禁 | `pnpm exec eslint electron/ src/ --quiet` 0 error | ✅ |
| V7 | 单测 | 桌面端 vitest 全量 + `api-publish-engine` 测试通过 | 见 CI |
| V8 | 一致性/债务门禁 | `check-frontend-consistency.js`、`check-debt-budget.js` PASS | 见 CI |

---

## 6. 执行流程（自动化管线）

```
① 会话隔离
   git worktree add -b codex/debrand-reference-product mp-worktrees/mp-debrand-reference-product origin/main
        │
② 盘点（只读）
   git ls-files 全量扫描 → 271 文件 / 1662 处 → 提取 201 种标识符形态 + 627 种中文语境
        │
③ 规则化改写（文本通道，UTF-8 读写）
   有序规则表（长匹配优先）：签名域名占位保护 → 云端域名 → 中文品牌词 →
   数据字段 → 目录/复合名 → 通用标识符（全拼三种大小写 / 三字母缩写三种大小写）
   + 路径改名（深度优先后序：先子孙后自身，改名前做碰撞检查）
        │
④ 字节级补漏（latin1 保真通道）
   兜底「含 NUL 字节/超大」被当二进制跳过的文本文件；排除二进制扩展名
        │
⑤ 后置修正
   占位符还原（签名域名）、叠词修正（参考同类产品 → 参考同类产品）、
   aria-label 语义修正（→ 主导航）
        │
⑥ 残留校验 + 编码安全校验 + 索引完整性校验
        │
⑦ 门禁与测试（i18n / eslint / vitest / 一致性 / 债务熔断）→ ⑧ PR → CI → 合并
```

**规则表设计要点**

1. **有序性**：`<signer-host>` 必须最先用占位符保护（否则会被通用规则改坏成 `qianming.mp.cn`，破坏发布链路）；`<中文品牌名>逆向工程` 必须先于 `<中文品牌名>`；`<brand>-reverse` 先于 `<brand>`；数据字段先于通用标识符。
2. **边界保护**：`<abbr>` 采用负向后顾断言 `(?<![A-Za-z])`，避免误伤无关子串（实测命中 `product-manual-feishu.html` 的 `j<abbr>` 与 `pnpm-lock.yaml` 的 `<ABBR>i`）。
3. **锁文件排除**：`pnpm-lock.yaml` 等生成物不改写。
4. **`.gitignore` 命中路径的补暂存**：`.gitignore` 有 `.ccg/tasks/*`，改名后的新路径属「新增 + 被忽略」，`git add -A` 不会收录，必须按删除项推导新路径后 `git add -f --` 精确补齐（否则 86 个文件会以「删除」形态入库）。
5. **占位符必须配对还原**：保护用占位符与还原步骤必须写进同一脚本；漏还原会让端点在仓库里保持损坏态，且残留扫描发现不了（占位符不含品牌词）。

---

## 7. 已知限制与遗留

| 项 | 说明 | 处置建议 |
| --- | --- | --- |
| 第三方签名域名 | `<signer-host>` 保留于 `signer.js`（默认端点）、`01-docs/phase-6-integration-decision.md`、1 份 `.ccg` 归档 | 保留（硬依赖）；如需彻底清除，自建签名服务后设置 `MP_SIGNER_BASE` 并替换默认值 |
| 逆向截图资产 | `01-docs/ui-reference/screenshots/`（目录已改名，文件名无品牌词）内 30 张 PNG 为参考产品实机截图，属二进制无法"改写" | 如需彻底清除痕迹，可整目录删除（不可逆，建议先本地备份） |
| 二进制随机命中 | `.mp4`/`.png` 压缩数据中存在与品牌词相同的字节序列，属巧合，不可改写 | 不处理 |
| GBK 归档文档归一 | 2 份 `.ccg` 归档 md 原为 GBK 编码，按 UTF-8 归一后丢失 3 个无效字节 | 已属改善（原文件在 UTF-8 环境本就乱码） |
| 基线死条目 | `locale-cjk-baseline.json` 重建后清理 45 条含品牌词的死条目（1689 → 1644） | 已完成 |

---

## 8. 回归保护

1. **残留门禁（已落地并接入 CI）**：`scripts/check-no-brand-residue.js`
   - 字节级（latin1 保真）扫描全部 tracked 文本文件，兼容含 NUL 字节与非 UTF-8 文件；
   - 跳过锁文件与二进制扩展名；
   - 品牌词**按码点构造**进正则（门禁脚本自身零字面品牌词，不自证违规）；
   - 唯一豁免 `<signer-host>`；
   - 命中即 `exit 1`，并输出 `文件 @byte 位置 + 上下文` 便于定位；
   - **CI 接线**：`quality-gate.yml` static-gates **Gate 12 - Brand residue (naming normalization)**（`node scripts/check-no-brand-residue.js`，与本地同口径），接线契约由 `.github/scripts/workflow-contract.test.js` 钉死。
   - **交付更正**：该脚本在 #1837 中被 `.gitignore` 的 `scripts/*.js` 白名单型忽略规则静默吞掉（三次 `git add -A` 均未入库，PR 合并而脚本缺席），于随后的 CI 接线 PR 中补齐 `.gitignore` 白名单并入库。
2. **命名空间约定**：应用层 DOM/CSS 命名空间一律 `mp-`，组件 `Mp*`，常量 `MP_*`；禁止再引入第三方产品名作为命名空间。
3. **文档写法约定**：涉及品牌词的文档（PRD/CHANGELOG/learnings）一律用占位符指代（见 §0），不复现字面。
4. **learnings 沉淀**：`01-docs/learnings.md` 新增「全仓命名清理三道防线」（字节级兜底 / 编码安全校验 / 二进制排除 + gitignore 补暂存 + 占位符配对还原）。
