---
record: reuse-taxonomy-browser
task: P0-3 后半段(1/2) —— 渲染端 ESM 分类表孪生 + parity 锁
date: 2026-10-14
branch: reuse-taxonomy-browser
---

## 本次执行记录：P0-3 后半段(1/2) 渲染端分类表孪生（reuse-taxonomy-browser，2026-10-14）

### 变更类型与隔离

运行时代码变更（`packages/shared-utils/` + `apps/desktop/vite.config.js`），已在隔离 worktree 完成：
`D:\Data\projects\mp-worktrees\mp-reuse-browser`（D 盘），分支 `reuse-taxonomy-browser`，
**从 `origin/main` 直接切出**（不堆叠 —— `platform-taxonomy.js` 与 `config/platform-taxonomy.json`
已随 PR #3496 进主干）。
依赖就绪：`pnpm install --frozen-lockfile` + `node scripts/ensure-electron.js` +
`node scripts/verify-worktree-deps.js`（三项 exit=0）。

### 做了什么

PRD §15 定案：把「中文分类名 → 平台侧 ID」的解析放**渲染端分类选择处**。本 PR 落地第 1 步：

1. `packages/shared-utils/src/platform-taxonomy.browser.js` —— ESM 孪生（数据构建期静态引入）
2. `packages/shared-utils/src/__tests__/platform-taxonomy-browser.test.js` —— parity 锁 **18 例**
3. `apps/desktop/vite.config.js` —— 登记第 10 项 alias（未登记会被 `check-renderer-cjs-boundary` 拦）

### 与 CJS 版的差异**只在数据来源**

CJS 版用 `fs` + `path` 运行期读文件，为此设计了路径解析链、mtime 缓存、`__loadError` 空壳、
三个测试注入口。这些在浏览器里既不可用也不必要 —— 渲染端数据是**构建期静态引入**：
JSON 缺失/损坏 ⇒ **打包当场失败**，而非运行期返回空表。**这是比 CJS 版更强的保证。**
故刻意不实现路径解析/缓存/`__loadError`/测试注入口，函数层则逐字对齐。

### ★ parity 锁首轮即抓出 7 处漂移 —— 全部源于「按假设写」而非「照 CJS 读」

| 我假设的 | CJS 真实 |
| --- | --- |
| 第二参是位置参数 `contentType` | 是 `opts = {}` |
| `getTaxonomyCoverage` 判据 = 指定 contentType 有数据 | 是 `anyBlock`（**任一** contentType）|
| —（**完全漏了**）| `blockOf` 有 `article:xxx` 多来源表键的前缀匹配分支 |
| `searchCategories` 也匹配 ID | 只匹配**名称** |
| `resolveCategoryId` 返回 `depth` | 返回 `path`（parentId 上溯，8 层上限）|
| `not-found` 的 available = 其他 contentType 的名字 | = **当前** nodes 的名字（`slice(0,50)`）|
| 歧义靠 Set 自行推断 | 先看 `n.ambiguous` 预标，再看精确匹配 `hit.length > 1` |

逐条照 CJS 重写后 18/18。**这条锁若不存在，渲染端会给出与主进程不同的判定，
而两边各自的单测都看不出来（各自自洽）。**

### 验证

| 项 | 结果 |
| --- | --- |
| parity 锁 | **18/18**（真实样本 60 个、全部失败路径、`blockOf` 多来源表分支、深拷贝语义）|
| **变异反证** | 把 `not-found` 的 `slice(0, 50)` 改成 `slice(0, 49)` ⇒ **2 用例立刻变红**（证明锁在跑）|
| 结构锁 | ESM 不得出现 `fs`/`path`/`require(` —— **只对代码行判据**（首轮被自己注释里的 `setTaxonomyPathForTest` 误伤）|
| 渲染端 CJS 边界门禁 | **PASS**（`alias 登记 10 项`，本 PR 为第 10 个）|
| 品牌残留 / 编码完整性 | exit=0 |
| shared-utils 全量 | `network-egress-guard-child` 3 个失败属**预先存在**（Round 4 已在 `origin/main` 上对照证伪：改动前后同为 `3 failed \| 18 passed`）|

### 一处显式登记的例外（不是遗漏）

ESM **故意不实现** `validateTaxonomy`（结构性自检）。理由：渲染端表是构建期引入，
结构错会打包失败或被 CI 的真实产物契约测试拦住；复刻一份只增 bundle 体积、不增保障。
测试里以 `KNOWN_ESM_ABSENT` 白名单登记 —— **不改成宽过滤**，否则「忘了同步新函数」
会重新沦为静默漂移。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 适用范围是 `apps/desktop/electron/` 与 `packages/rpa-engine/`；本 PR 变更全在 `packages/shared-utils/`（vite alias 已移入选择器 PR）。曾执行过打包，结论作为**旁证**保留在下 |
| QM-2 代码必检项 | ✅ | 新文件无 `require` 路径问题；无新第三方依赖；`export` 语法已核；注释 `/* */` 成对 |
| QM-4 视觉 | N/A | 无 UI 变更（选择器组件在下一 PR）|
| QM-6 双模型评审 | 未执行（如实登记）| 本机无 `codeagent-wrapper` |
| 远程同步 | PASS | PR #3509 已合并，merge SHA `a7f0c53e9e2d681550abce639e89286771c605e5`（2026-10-14）|

#### QM-1 实测（本 PR 动了 `apps/desktop/vite.config.js`，属渲染端打包配置）

| 步骤 | 结果 |
| --- | --- |
| `vite build` | exit=0（25.3s）|
| `electron-builder --win --x64 --publish never` | **exit=0**，产出 `Multi-Publish.Setup.0.2.0.exe` + blockmap |
| asar 清单含 `@multi-publish/shared-utils` | ✅ |
| **`config/platform-taxonomy.json` 入包** | ✅（`asar list` 命中 True）|
| require 链：`@multi-publish/api-publish-engine` | ✅ OK |
| require 链：`@multi-publish/shared-utils` | ✅ OK，且 `platformTaxonomy` 为 object |
| 启动 8 秒存活 | ❌ **未存活**（0.4s、ExitCode=0、stderr 空）|
| **启动项对照证伪** | ✅ 见下 —— **预先存在的环境行为，非本 PR 引入** |

**启动项如何处理（不假装通过）**：按 AGENTS.md「判据一律取产物」与「对照先于归因」，
拿一个**已合并的** worktree 产物（`mp-podcast-oneclick-publish`）跑同一测试：

| | 15s 内退出 | 退出码 | 耗时 | stderr | exe 大小 | 文件数 |
| --- | --- | --- | --- | --- | --- | --- |
| 本 PR | 是 | 0 | 0.4s | 空 | 228 MB | 12088 |
| 对照（已合并）| 是 | 0 | 0.6s | 空 | 228 MB | 12085 |

两者行为**完全相同** ⇒ 结论：**「启动约 0.5 秒即优雅退出」是本机环境行为，与本次改动无关。**
同时已排除单实例锁假设（全仓 grep `requestSingleInstanceLock` **零命中**；
机上 6 个 `electron` 进程属 `mp-app-live2` 且用了**不同的 `--user-data-dir`**）。

**如实登记的残余**：本机无法完成「窗口真正起来」的端到端启动验证。
本 PR 对渲染端的影响面是「新增一个 alias + 新增一个当前**尚无消费方**的 ESM 模块」——
alias 目标文件存在性已单独验过，且边界门禁确认登记无误。
真正的端到端视觉验证应在分类选择器组件落地（下一 PR）时补做。


- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS