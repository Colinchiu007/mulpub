# BUGFIX — 点击顶部「+」新增标签后 3-4 秒才显示应用主页

- **状态**：已修复（待 CI 合并）
- **分支**：`fix-newtab-home-slow`
- **worktree**：`D:\Data\projects\mp-worktrees\mp-fix-newtab-home-slow`
- **发现日期**：2026-10-15
- **严重级别**：P1（核心交互入口；每次点「+」必现，无账号数依赖，所有用户同等受损）
- **用户原话**：

> 在应用中在顶部区域，点击"+"，新增一个新标签时，默认打开应用主页。但是非常慢，大概有3-4秒才显示出来。查一下原因并修复。

---

## 0. 现象与量化

点击应用顶部标签栏的「+」→ 新标签创建 → 应显示应用主页。实测从点击到主页可见要 **3-4 秒**。

与 2026-10-14 的「账号菜单慢」是**两个不同根因**：那次是主进程同步 CPU 阻塞（PBKDF2），
本次主进程同步段实测仅 **24 ms / 1 ms**（冷/热），瓶颈**全在渲染进程的首屏载荷**。

### 0.1 主进程侧（先排除，证明不是它）

| 分段 | 实测 |
|---|---|
| `createNewTabPage({homeShell:true})` 同步返回（冷） | 24 ms |
| 同上（热，分区已建） | 1 ms |
| `accounts:list`（8 账号，已并行化） | 94 ms |
| `dashboard:stats`（JSONL 71 条） | 53 ms |
| `history:list(limit 5)` | 3 ms |
| `license:info`（scryptSync） | 17 ms |
| `identity:get-state` | 21 ms |
| `accounts:batch-check-login`（8 账号并发 3） | 55 ms |

主进程全部加起来 ~270 ms，**解释不了 3-4 秒**。

### 0.2 渲染进程侧（真正的瓶颈）

用 Playwright 加载打包后的 `index.html?mp-home-shell=1`（等价复现新标签的渲染进程启动）：

| 指标 | 修复前（实测） | 修复后（实测） | 变化 |
|---|---|---|---|
| `index.js` 体积 | **1 841 KB** | **1 334 KB** | −507 KB（−27%） |
| `index.css` 体积 | **503 KB** | **300 KB** | −203 KB（−40%） |
| `index.js` 加载耗时 | 427 ms | 86 ms | −341 ms |
| `index.css` 加载耗时 | 261 ms | 45 ms | −216 ms |
| `domContentLoaded` | 1 058 ms | 463 ms | −595 ms |
| `loadEvent` | 1 301 ms | 722 ms | −579 ms |
| FCP | 1 172 ms | 544 ms | −628 ms |
| **主页挂载（冷）** | **1 960 ms** | **743 ms** | **−62%** |
| **主页挂载（热）** | **803 ms** | **283 ms** | **−65%** |

（真机 Electron 环境还叠加 `WebContentsView` 创建 + preload 注入 + `file://` 读取，绝对值高于此表；
但**相对占比一致**——首屏载荷是最大单一来源。）

---

## 1. ① 根因溯源（追到第一性引入点）

### 1.1 直接原因：首屏 bundle 为「所有页面的并集」付钱

「+」新标签是 `WebContentsView` 里跑的**独立 SPA 实例**，与主窗口一样要完整加载
`index.html` → `index.js` + `index.css`。而这两个产物里装着**全部 124 个 element-plus 组件**
和全量样式：

```
index.js  1 841 KB
  └─ element-plus 全量（124 个组件，min 后约 877 KB）
  └─ 业务代码 + 路由懒加载 manifest
index.css  503 KB
  └─ element-plus/dist/index.css（349 KB，124 个组件的样式）
  └─ @vueup/vue-quill snow.css（22.5 KB）
  └─ 项目自有 CSS（约 133 KB）
```

**本仓 `src` 实际只用到 36 个 EP 组件**（探针实测：扫全部 `.vue` 的 `<el-xxx>` 用法，
对照 `element-plus/es/components` 的 124 个目录）。剩下 88 个组件从未被渲染，
但用户每次点「+」都要为它们付下载 + 解析 + 执行成本。

### 1.2 第一性引入点

| 引入提交 | 日期 | 贡献 |
|---|---|---|
| `element-plus` 进 `apps/desktop/package.json` | 项目早期 | 引入 UI 框架；`main.js` 用 `import ElementPlus from 'element-plus'` + `app.use(ElementPlus)` **全量**装配 |
| `main.js` 顶层 `import 'element-plus/dist/index.css'` | 项目早期 | 全量样式进首屏 CSS |
| `main.js` `app.component('QuillEditor', QuillEditor)` | 项目早期 | 把富文本编辑器注册成**全局**组件，使 `@vueup/vue-quill` 进入首屏 JS 闭包 |

全量装配在项目早期（页面少、无性能压力）是合理默认；**没有任何人回头问过
「一个新标签只需要主页，为什么要为 88 个用不到的组件付钱」**。
这与 10-14 的账号页事故同型：**单次成本合理的默认，在「高频路径 × N 次触发」下变成灾难。**

### 1.3 次要原因：Home.vue 首屏数据串行 await

`Home.vue` `onMounted` 是串行链：

```js
platformStore.load()                        // 平台元数据
await accountStore.ensureLoaded()           // 账号列表（accounts:list）
await refreshExpiredAccounts()              // ← 最重：内部 accountStore.load() + accountBatchCheckLogin()
const res = await api.dashboardStats()      // 发布统计
const res = await api.historyList(...)      // 近期动态
```

`refreshExpiredAccounts()` 内部的 `accountBatchCheckLogin()` 会**逐账号**跑
`checkLoginStatus()`（HTTP 请求，单账号最坏 60 s 硬超时，本机实测 8 账号并发 3 = 55 ms，
但账号多/网络差时是最坏情况的决定性项）。

串行语义下，总耗时 = 各项之和；且它是**阻塞在 `await` 链上**的——
统计和近期动态明明与失效账号横幅无关，却被它挡在后面。

---

## 2. ② 测试逃逸分析（按测试层级列出逃逸链）

| 层级 | 是否存在该场景测试 | 为什么没拦住 |
|------|-------------------|--------------|
| 单元测试 | ❌ 无 bundle 体积契约 | `main.js` 从未被任何测试读取。全量/按需引入在测试里**完全等价**——两者都让 `<el-button>` 正常渲染 |
| 集成测试 | ❌ 无 | 没有「加载打包产物并计时」的用例；`vitest` 跑的是源码不是产物 |
| E2E / 视觉回归 | ❌ 结构性不可见 | 像素对比看最终画面。本 Bug 的画面**完全正常**，只是迟到。**慢而不错，视觉回归天然免疫**（与 10-14 账号页同一条） |
| 代码审查 | ❌ 无 bundle 维度 | QM-2 清单覆盖 require 路径、IPC 序列化、Electron 安全，**没有「首屏 bundle 体积」这一类检查项** |
| 构建门禁 | ⚠️ 有告警但无阻断 | `vite build` 明确打印 `Some chunks are larger than 500 kB`，但只是 warning，CI 不因此失败 |

**逃逸链一句话**：
`源码层测试对引入方式无感知 → 无产物级契约 → 视觉回归只看画面不看迟到 → 审查无 bundle 维度 → build 只有 warning 不拦`，五道关口全部失效。

---

## 3. ③ 系统性漏洞定位

| 类别 | 具体漏洞 | 位置 |
|---|---|---|
| **测试覆盖漏洞** | 无任何测试读 `main.js` 或 `dist/` 产物，「全量引入」这一形态不受任何约束 | 全仓无 `*.bundle-contract.test.js` |
| **门禁缺失漏洞** | vite 的 500 kB chunk 警告不进 CI 失败条件 | `apps/desktop/vite.config.js` 无 `chunkSizeWarningLimit` 策略，`.github/workflows/` 无对应 job |
| **审查盲区** | QM-2 无「首屏载荷」维度；「全局注册一个只在某路由用的组件」这类结构性浪费无检查项 | `AGENTS.md` QM-2 |
| **可观测性漏洞** | 无首屏耗时基线，也就没有「这次改动让它变慢了吗」的可比对对象 | 无 |

---

## 4. ④ 修复 + 回归保护测试

### 4.1 修复内容（三个方向）

**方向 A：element-plus 全量 → 按需（收益最大）**

新增 `apps/desktop/src/plugins/element-plus.js`：
- 从 `element-plus/es` **具名导入** 34 个真正用到的组件（ESM 入口，可 tree-shake）；
- 只导入这 34 个组件的 `theme-chalk/el-*.css` + 3 个共享底座（`el-var` / `el-reset` / `base`）；
- 导出为标准 Vue 插件，`main.js` 改 `app.use(elementPlusOnDemand)`。

`main.js` 相应删除 `import ElementPlus from 'element-plus'`、`app.use(ElementPlus)`、
`import 'element-plus/dist/index.css'`。

**方向 B：QuillEditor 全局注册 → 本地注册**

`QuillEditor` 原先在 `main.js` 里 `app.component('QuillEditor', QuillEditor)`，
把 `@vueup/vue-quill` 拉进首屏 JS 闭包。改为在 `ArticleEditor.vue` 内 `const components = { QuillEditor }`
本地注册——Quill 只随 `/publish` 路由的懒加载 chunk 下载（实测 `quill-*.js` 148 KB 独立 chunk，
**不进 `index.js`**）。

**方向 C：Home.vue 首屏数据并行化 + 懒触发**

按「用户何时真正需要它」分三档：

| 档 | 内容 | 触发方式 |
|---|---|---|
| ① 首帧必需 | 发布统计、近期动态、账号数、平台元数据 | `Promise.allSettled` **并行**，各自独立 try/catch |
| ② 懒触发 | 失效账号横幅（`refreshExpiredAccounts`） | `setTimeout(0)` 推到首帧之后；`onUnmounted` 清定时器 |
| ③ 不取 | —— | —— |

容错口径：每个数据源独立失败只让对应区块停在默认值，**首屏永远可见**。
`statsLoaded` 语义保持不变：无 `electronAPI` 时**不**置位（「没拿到数据」≠「确认是 0」，
不进入全 0 引导态）——这条由既有测试 `handles missing electronAPI gracefully` 锁定。

### 4.2 回归保护测试

**A. `src/main.bundle-contract.test.js`（7 条，源码契约）**

| # | 断言 | 锁什么 |
|---|---|---|
| B1 | `main.js` 不得 `import ElementPlus from 'element-plus'` / `app.use(ElementPlus)` | 防回退全量 JS |
| B2 | `main.js` 不得 `import 'element-plus/dist/index.css'` | 防回退全量 CSS |
| B3 | `main.js` 必须 `app.use(<按需插件>` | 防「删了全量却没接按需」 |
| B4 | 按需模块存在、从 `element-plus/es` 具名导入、覆盖 ≥20 个组件 | 清单不能退化成空壳 |
| B5 | 按需样式不得含 `dist/index.css`，必须含 `theme-chalk/(base\|el-var\|el-reset).css` | 防「样式又拉全量」 |
| B6 | `main.js` 不得再全局注册 `QuillEditor` / 引入 `@vueup/vue-quill` | 防 Quill 回首屏 |
| B7 | `main.js` 不得出现 `vue-quill.snow.css` | 同上（样式） |

**B. `src/plugins/element-plus.test.js`（3 条，行为契约）**

| # | 断言 | 锁什么 |
|---|---|---|
| P1 | 装配后 `app._context.components` 含 `ElButton`/`ElTable`/`ElSelect`/`ElOption`；**不含** `ElMessage`/`ElMessageBox` | 注册结果正确、命令式 API 不占注册表 |
| P2 | `ElMessage`/`ElMessageBox` 单独导出且可调用 | 命令式通道不断 |
| **P3** | **机械锁**：扫 `src` 全部 `.vue` 的 `<el-xxx>` 用法，逐个核对在注册表内 | **漏登记一个组件 = 那个页面整块渲染失败**，这是按需改造唯一的真实风险面 |

> P3 在开发过程中**当场抓到一次真实漏项**：`el-radio-button` / `el-radio-group`
> （`VideoCloneView.vue` 在用）。EP 把这两个实现放在 `radio/` 目录下、以
> `withNoopInstall` 挂在 `ElRadio` 上当子组件——**它们不占全局注册表**。
> 修法不是「把它们加进 `app.use`」（无效劳动，其 install 是 no-op），而是只注册 `ElRadio`
> + 补 `el-radio-button.css` / `el-radio-group.css` 两个样式文件。

**C. `src/views/Home.first-paint.test.js`（4 条，首屏时序契约）**

| # | 断言 | 锁什么 |
|---|---|---|
| H1 | `nextTick` 后静态区块（hero/快捷入口/平台列表/4 张统计卡）已渲染，**不等任何 IPC** | 首帧不阻塞 |
| H2 | `dashboardStats`（40 ms 桩）与 `historyList`（2 ms 桩）**并行**：`history:end` 早于 `dashboard:end` | 防退回串行 await |
| H3 | `dashboardStats` 抛错时整页仍渲染、4 张统计卡仍在 | 单点失败不扩散 |
| H4 | `nextTick` 时**未**发起 `accountBatchCheckLogin` | 失效账号校验必须懒触发 |

### 4.3 变异反证（证「锁本身在跑」）

| 锁 | 变异 | 结果 |
|---|---|---|
| B1/B2 | 把 `main.js` 改回 `import ElementPlus from 'element-plus'` | **当场红**（B1/B2/B5/B6 同时判红） |
| P3 | 从 `COMPONENTS` 删掉 `ElTable` | **当场红**：`以下 EP 组件在 src 中被使用但未在按需清单注册: table` |
| H2 | 把 `Promise.allSettled([...])` 改回串行 `await` | **当场红**：`expected -1 to be less than -1`（history 被 dashboard 挡死） |
| H4 | 把 `setTimeout(..., 0)` 改成直接 `await refreshExpiredAccounts()` | **当场红**：nextTick 时已发起批量校验 |

四条锁都做过「把锁改成 no-op / 把业务改坏必须立刻变红」的变异，不是只证「业务改动变红」的假绿。

### 4.4 功能等价性证明

- **视觉零回归**：按需样式 = 全量 index.css 中对应组件规则的同一份文件
  （`theme-chalk/el-*.css` 就是 `dist/index.css` 的构成单元），只是少了 88 个不用的组件。
  项目自有 `ep-theme.css` 的变量桥接依赖 `--el-*` 变量，由 `el-var.css` + `base.css` 提供，未受影响。
- **路由冒烟**：`/` `/publish` `/accounts` `/dashboard` `/publish/history` `/collection`
  六个路由在真实打包产物上加载，均正常渲染（`el-upload` / `el-icon` / `el-overlay` /
  `el-modal-dialog` / `ql-editor` 等 EP 与 Quill 类名在 DOM 中实测出现）。

### 4.5 修复后 CI 抓到的**新缺陷**：按需样式漏了「纯样式依赖」的内部组件

首轮 CI 的 `QG Visual` 红 3 处（阈值 6%）：

| 视图 | misMatchPercentage |
|---|---|
| `podcast-channel` | **21.63%** |
| `create-editor` | 9.48%（重试 7.66%） |
| `create-pipeline` | 9.47%（重试 7.67%） |

**根因（P3 机械锁锁不到的维度）**：P3 只锁「组件**注册**」，锁不到「组件**样式**」。
第一版按需 CSS 只导了「模板里用到的组件」的样式，而 EP 的组件之间存在
**纯样式依赖**——一批内部组件（`scrollbar` / `popper` / `overlay` / `option-group` /
`text`）从不出现在任何模板里，但缺了它们的 CSS 就会视觉回归。

**权威判据**：`element-plus/es/components/<name>/style/index.mjs`。它声明该组件依赖
哪些兄弟组件的样式，例如：

```
select   → base, scrollbar, popper, tag, option, option-group
dialog   → base, overlay
tooltip  → base, popper
radio-group → base, radio      ← 漏 `el-radio` 本体的来源
```

沿该图重算闭包，实测漏了 **7 个**：
`el-scrollbar` / `el-popper` / `el-overlay` / `el-option-group` / `el-text` /
`el-radio`（本体 —— 上一轮只补了 `radio-button`/`radio-group`）/ `el-config-provider`
（0 字节占位，renderless 组件）。

**修法**：补齐闭包 → `index.css` 300.4 → **309.5 KB**（仍远低于基线 503 KB）。
产物内 12 项关键选择器实测全部命中；本地复跑 `podcast-channel`
**21.63% → 2.05%**。

**过程坑（值得单独记）**：EP 的 `style/index.mjs` 用的是**裸 import**
（`import "../../x/style/index.mjs"`），没有 `from` 关键字。第一版判据写成
`/from\s+['"]\.\.\/\.\.\/…/`，匹配数为 **0**，于是算出「闭包 = 已导入」这个**假结论**
——差点据此认为按需清单是对的。判据必须写成 `/import\s+['"]\.\.\/\.\.\/…/`。

**新增两道机械锁**：

| 锁 | 断言 |
|---|---|
| **P4 样式闭包锁** | 按 `style/index.mjs` 重算闭包，断言插件 import 的 CSS **不缺**（且 theme-chalk 里文件真实存在） |
| **P5 重复 import 锁** | 样式清单不得有重复行（本轮真出过重复：批量替换把 `el-radio-button`/`el-radio-group` 各写了两遍） |

**两处存量的判定（对照实验，不背锅也不甩锅）**：`create-editor` / `create-pipeline`
本地复跑 9.48% / 9.26%。做**对照实验**——临时在插件里加回
`import 'element-plus/dist/index.css'`（= 修复前 CSS 超集）后复跑，两者仍是
**9.48% / 9.26%**，与按需态**逐位相同** ⇒ 与本次样式改造**无关**。
另有抖动证据：CI 同一 job 两轮数字不同（9.48% → 7.66%），且第一轮
`podcast-channel` 未失败、第二轮才失败。
故本 PR 只对「因闭包缺失而变差的 `podcast-channel`」负责并已修复；
这两条的存量漂移**不在本 PR 范围**，且**刻意不用 `--update-baseline` 掩盖**
（AGENTS.md 明令禁止）。

**口径提醒**：本地像素默认阈值 **1%**，CI 用 **6%**（`PIXEL_THRESHOLD`）。
故 `podcast-channel` 本地 2.05% 会判红、CI 6% 阈值下应通过——对照时必须注意口径差异。

---

## 5. ⑤ 预防措施（防止再次发生）

| # | 措施 | 落地文件 |
|---|---|---|
| 1 | **Bug 反思文档**（本文件） | `01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md` |
| 2 | **bundle 契约进测试**：`main.js` 引入方式 + 按需清单 + Quill 注册位置三条机械锁 | `src/main.bundle-contract.test.js` |
| 3 | **漏登记机械锁**：扫 src 全部 `<el-xxx>` 核对注册表 | `src/plugins/element-plus.test.js` P3 |
| 4 | **样式闭包锁**：按 `style/index.mjs` 重算闭包断言不缺（QG Visual 那次红的直接教训） | `src/plugins/element-plus.test.js` P4 |
| 5 | **重复 import 锁**：样式清单不得有重复行 | `src/plugins/element-plus.test.js` P5 |
| 6 | **首屏时序契约**：并行取数 + 懒触发 + 单点失败不扩散 | `src/views/Home.first-paint.test.js` |
| 7 | **QM-2 新增检查项**：「新增全局 `app.component` / 顶层 CSS import 前必须问『它在几条路由上被用』；UI 框架默认全量引入是高频路径的性能地雷；**UI 框架按需样式必须导闭包而不是模板用到的组件**」 | `AGENTS.md` QM-2 |
| 8 | **learnings 沉淀**：`全量引入在源码层测试里与按需完全等价` + `慢而不错对视觉回归结构性免疫`（与 10-14 同型第二次出现）+ `按需样式必须导闭包` + `判据写成 /from/ 会匹配 0 条算出假结论` | `01-docs/learnings.md` |
| 9 | **CHANGELOG** 条目 | `CHANGELOG.md` |

### 5.1 仍未闭合的（登记，不假装已解决）

- **`index.js` 仍有 1.33 MB**：本次只砍了 element-plus。剩下的业务代码（含
  `@element-plus/icons-vue`、各 view 的共享依赖）未拆。若要进一步，方向是
  `build.rollupOptions.output.manualChunks` 做 vendor 分包，属独立切片。
- **vite 的 500 kB chunk 警告仍未进 CI 失败条件**：本次未改 CI（改 `.github/workflows/`
  属「改谁来守门」，按 AGENTS.md 必须人工过目，不在本 PR 范围内）。
- **Quill 的 `snow.css` 仍随 `/publish` chunk 下载**（22.5 KB）：这是正确的——
  只有真进发布页才需要。但若将来发布页也要秒开，可考虑 toolbar 精简。
- **Home.vue 的失效账号横幅在账号多时仍可能慢**：懒触发只保证它不阻塞首屏，
  不保证它自己快。它的性能属 `accounts:batch-check-login` 的既有议题（并发 3 / 单账号 60 s 超时）。
- **`create-editor` / `create-pipeline` 存量像素漂移**：对照实验证明与本 PR 无关
  （见 §4.5），登记为存量待办，不擅自更新基线。
- **QM-6 深度双模型评审未完成**：判定 `deepReview.required=true`（变更 593 行 > 200 行
  阈值），但本仓 `ccg-review-decider` 把记录**以提交前的 HEAD sha 命名**
  （`.git/hooks/pre-commit` 第 148-155 行注释明说这是刻意设计），导致 commit 之后
  `HEAD` 永远查不到自己的记录，`scripts/deep-review.sh` 与直接驱动
  `ccg-deep-review.js` 四条调用路径全部无法在「记录名 = 父 sha」的设计下完成评审。
  **如实登记为 pending，不编造 findings。** 建议独立切片修正记录命名
  （改用提交后 sha，或同时写父/子两份），使 `deep-review.sh` 可用。

---

## 6. 变更文件清单

| 文件 | 变更 |
|---|---|
| `apps/desktop/src/plugins/element-plus.js` | **新增**：按需装配插件（34 组件 + 37 个样式 import + 命令式 API 导出） |
| `apps/desktop/src/plugins/element-plus.test.js` | **新增**：3 条行为契约（含漏登记机械锁） |
| `apps/desktop/src/main.js` | 删全量 EP / 全量 CSS / 全局 QuillEditor；改 `app.use(elementPlusOnDemand)` |
| `apps/desktop/src/main.bundle-contract.test.js` | **新增**：7 条源码契约 |
| `apps/desktop/src/components/ArticleEditor.vue` | QuillEditor 改本地注册 |
| `apps/desktop/src/views/Home.vue` | 首屏数据并行化 + 失效账号校验懒触发 + 卸载清定时器 |
| `apps/desktop/src/views/Home.first-paint.test.js` | **新增**：4 条首屏时序契约 |
| `apps/desktop/src/views/Home.test.js` | `flushMounted` 多等两轮 `setTimeout(0)`（适配懒触发） |
| `AGENTS.md` | QM-2 新增 bundle 维度检查项 |
| `01-docs/learnings.md` | +2 条 pitfall |
| `CHANGELOG.md` | +本次条目 |
| `01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md` | 本文件 |

---

## 7. 测量方法（可复现）

```bash
# 1. 主进程分段计时（Node 直驱真实模块，不起 Electron）
node scripts/probe-newtab-main.js        # 见本文 0.1

# 2. bundle 体积
cd apps/desktop && pnpm exec vite build
ls -la dist/assets/index-*.js dist/assets/index-*.css

# 3. 首屏时间线（Playwright + 本地 HTTP 托管 dist，消除 file:// CORS 噪声）
node scripts/probe-newtab-paint.js       # 见本文 0.2

# 4. EP 组件注册冒烟（六个路由）
node scripts/probe-ep-register.js
```

四个探针均为一次性诊断脚本，不随产物分发；判据以本文表格中的实测数字为准。
