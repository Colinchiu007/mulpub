# 「+」新标签主页 3-4 秒修复 · 实施计划（fix-newtab-home-slow）

> **文档性质说明（诚实声明）**：本文件是**动手后补写**的范围对账单，不是"动手前的方案"。
> CCG pre-commit 判定的「范围漂移」项（11 个改动文件不在方案声明范围内）由本文件闭合：
> 把实际改动的文件、动机、边界逐条写明，供事后审计比对。
> 决策层对抗评审（`scripts/plan-review.sh`）**未在动手前执行**——本次是用户报障后的
> Bug 修复，走的是「先定位根因再动手」路径（先排除法定位瓶颈，再写测试后写实现）；
> 决策层缺失这一点在此如实登记，不假装走过。

**Goal:** 消除点击顶部「+」新增标签后 3-4 秒才显示应用主页的等待。

**根因（一句话）:** 「+」新标签 = 一个全新渲染进程完整加载本应用 SPA，
而首屏 bundle 为**所有页面的并集**付钱 —— `main.js` 全量
`app.use(ElementPlus)` + `element-plus/dist/index.css` 把 124 个 EP 组件
全部打进 `index.js`（1841 KB）/ `index.css`（503 KB），而本仓 `src` 只用 **36** 个。

**先排除主进程（这一步决定了整个方向）:**

| 分段 | 实测 |
|---|---|
| `createNewTabPage({homeShell:true})` 同步段 | 24 ms 冷 / 1 ms 热 |
| `accounts:list`（8 账号，已并行化） | 94 ms |
| `dashboard:stats`（JSONL 71 条） | 53 ms |
| `history:list(limit 5)` | 3 ms |
| `license:info`（scryptSync） | 17 ms |
| `identity:get-state` | 21 ms |
| `accounts:batch-check-login`（8 账号并发 3） | 55 ms |
| **合计** | **~270 ms** |

⇒ 主进程解释不了 3-4 秒。**瓶颈在渲染进程首屏载荷**。

**第一性引入点:**
- `element-plus` 进 `apps/desktop/package.json`（项目早期）—— `main.js` 用
  `import ElementPlus from 'element-plus'` + `app.use(ElementPlus)` **全量**装配，
  且顶层 `import 'element-plus/dist/index.css'`。全量装配在项目早期（页面少、
  无性能压力）是合理默认；**没有人回头问过「一个新标签只需要主页，为什么要为
  88 个用不到的组件付钱」**。
- `main.js` `app.component('QuillEditor', QuillEditor)`（项目早期）——
  把富文本编辑器注册成**全局**组件，使 `@vueup/vue-quill` 进入首屏 JS 闭包。
- `Home.vue` `onMounted` 的 5 项**串行** `await` 链（次要原因）——
  最重的逐账号登录态批量检测（单账号最坏 60 s 硬超时）把发布统计与近期动态一并挡在后面。

**Tech Stack:** Vite 6（`element-plus/es` ESM 具名导入 + `theme-chalk` 单文件 CSS）、
Vue 3 插件形态装配、vitest（源码契约 + 行为契约 + 时序契约）、Playwright（产物时间线探针）。

---

## 方案对比（为什么选按需引入 + 并行化）

| 方案 | 结论 | 判据 |
|---|---|---|
| A 只做 Home.vue 并行化 | ❌ 不够 | 只解掉串行等待（次要原因），bundle 仍是 1.84 MB ⇒ 首屏仍要解析执行全量 EP |
| B 上 `unplugin-vue-components` + `unplugin-auto-import` 自动按需 | ⚠️ 放弃 | 收益与 C 相同，但**新增两个构建期依赖**（QM-2「生产依赖闭包」审计成本）+ 改动面扩大到全仓模板风格；本 PR 刻意不加依赖 |
| C 显式清单按需（采用） | ✅ | 零新增依赖；用一份清单 + **三条机械锁**把「漏登记」从「线上白屏」变成「CI 红」 |
| D `manualChunks` vendor 分包 | ⚠️ 部分 | 只影响并行下载与缓存命中，不减少总字节；EP 全量仍会被解析。留作下一步（已登记遗留） |
| E 把 Quill 从 `main.js` 挪走（采用，随 C 一并） | ✅ | `ArticleEditor.vue` 本就本地 import，只需去掉全局注册；实测 Quill 已是 148 KB 独立 chunk |

**方案 C 的代价（如实登记）**：新增 `<el-xxx>` 必须手工登记组件清单 + 样式清单两处。
用 `element-plus.test.js` 的 P3 机械锁（扫 `src` 全部 `<el-xxx>` 逐个核对注册表）
把代价变成「漏登记会红」——**红在 CI 而不是写代码的当下**，这是本方案的已知短板。

---

## 文件结构（先读后写）—— 与实际改动逐条对应

| 文件 | 操作 | 职责 | 实际改动行数 |
|---|---|---|---|
| `apps/desktop/src/plugins/element-plus.js` | **新建** | 按需装配插件：34 组件 import + 34 样式 import + 3 共享底座 + 命令式 API 导出 | +180 |
| `apps/desktop/src/main.js` | 修改 | 删全量 EP / 全量 CSS / 全局 QuillEditor；改 `app.use(elementPlusOnDemand)` | 11 |
| `apps/desktop/src/components/ArticleEditor.vue` | 修改 | QuillEditor 改本地注册 `const components = { QuillEditor }` | 7 |
| `apps/desktop/src/views/Home.vue` | 修改 | 首屏数据并行化 + 失效账号校验懒触发 + `onUnmounted` 清定时器 | +108 |
| `apps/desktop/src/main.bundle-contract.test.js` | **新建** | 7 条源码契约（禁全量 JS/CSS、必须接按需、Quill 不得全局注册） | +80 |
| `apps/desktop/src/plugins/element-plus.test.js` | **新建** | 3 条行为契约（含 P3 漏登记机械锁） | +77 |
| `apps/desktop/src/views/Home.first-paint.test.js` | **新建** | 4 条首屏时序契约 | +125 |
| `apps/desktop/src/views/Home.test.js` | 修改 | `flushMounted` 多等两轮 `setTimeout(0)`（适配懒触发） | 5 |
| `01-docs/BUGFIX-NEWTAB-HOME-SLOW-2026-10-15.md` | **新建** | Bug 反思 5 步全文 | +294 |
| `01-docs/PRD-TAB-INDEPENDENT-HOME-2026-09-22.md` | 修改 | 新增 F7 首屏性能需求 + §4 数据校验 4 行 + §8 验收 2 条 + §10 风险 2 行 + §11 测试计划 3 行 | +37 |
| `AGENTS.md` | 修改 | QM-2 新增 2 条检查项（bundle 维度 + 首屏时序维度） | 4 |
| `01-docs/learnings.md` | 修改 | 顶部 +5 条 pitfall/lesson | +22 |
| `CHANGELOG.md` | 修改 | 前插本次条目 | +11 |
| `openspec/records/fix-newtab-home-slow.md` | **新建** | 本次执行记录（QG 表 + 相关域全量 + 遗留） | +48 |
| `.hermes/plans/2026-10-15-fix-newtab-home-slow.md` | **新建** | 本文件（范围对账单） | — |

**边界（明确不动的）:**
- **主进程零改动**（`apps/desktop/electron/**` 一字未动）⇒ 无 IPC 契约变更，
  `page-manager:create-new-tab-page` 入参/返回形状不变。
- **不改 `.github/workflows/`**（属「改谁来守门」，必须人工过目）。
- **不加依赖**（`package.json` / `pnpm-lock.yaml` 未变）。
- **不动 locale**（无新增用户可见文案，CI Gate 7 无成对校验需求）。

---

## 三个有意权衡（诚实标注）

1. **`index.js` 仍剩 1.33 MB**：本次只砍了 element-plus。剩余业务代码
   （`@element-plus/icons-vue`、各 view 共享依赖）未拆。留在「遗留」而非塞进本 PR。
2. **vite 的 500 kB chunk 警告仍未进 CI 失败条件**：只加契约锁（源码文本级），
   不把 build 警告升级为 CI 红 —— 后者要改 workflow，按 AGENTS.md 必须人工过目。
3. **失效账号横幅在账号多时仍可能慢**：懒触发只保证它**不阻塞首屏**，
   不保证它自己快。它的性能属 `accounts:batch-check-login` 的既有议题。

---

## 验收判据（全部实测，非推断）

- **bundle**：`index.js` ≤ 1400 KB、`index.css` ≤ 320 KB（实测 1334 / 300）
- **首屏**：`mp-home` testid 出现 ≤ 1 s（devServer 口径）/ ≤ 1.5 s（打包 file://）
  —— 实测冷 743 ms、热 283 ms（Playwright + 本地 HTTP 托管 `dist/`）
- **功能零回归**：六路由（`/` `/publish` `/accounts` `/dashboard` `/publish/history` `/collection`）
  在真实打包产物上正常渲染，无 "Failed to resolve component"
- **回归锁**：14 条，四条变异反证（改回全量 / 删组件 / 改回串行 / 改回同步 await）**全部当场指名红**
- **静态门禁**：eslint 对 8 个改动/新增文件 `--quiet` exit 0
- **行尾对账**：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐值相等
