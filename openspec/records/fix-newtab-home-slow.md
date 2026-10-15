---
record: fix-newtab-home-slow
task: 点击顶部「+」新增标签后 3-4 秒才显示应用主页——element-plus 全量引入改按需 + 首页数据并行化
date: 2026-10-15
sync_status: PENDING
sync_reason: 代码 PR 已开（#3631），CI 全绿后由 agent 按 AGENTS.md「PR 自动合并」小节自动 squash 合并
sync_backfill_owner: agent
---

## 本次执行记录：「+」新标签主页慢（fix-newtab-home-slow，2026-10-15）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`src/main.js`、新增 `src/plugins/element-plus.js`、`src/components/ArticleEditor.vue`、`src/views/Home.vue`）+ 文档 ⇒ `classify-docs-only` 判 false（混合 PR）；隔离 worktree `<worktree-root>/mp-fix-newtab-home-slow`（D 盘），裸分支 `fix-newtab-home-slow`，基线 `origin/main` = `8e9109a55`；共享根保持 main、`git status --porcelain` 空 |
| 第一性原因（QM-5 ①） | ✅ | **先排除主进程**：Node 直驱真实模块逐段计时 —— `createNewTabPage({homeShell:true})` 同步段 **24 ms（冷）/ 1 ms（热）**，`accounts:list` 94 ms、`dashboard:stats` 53 ms、`history:list` 3 ms、`license:info` 17 ms、`identity:get-state` 21 ms、`batch-check-login`（8 账号并发 3）55 ms ⇒ 合计 ~270 ms，**解释不了 3-4 秒**。矛头转向渲染进程首屏载荷：`main.js` 全量 `app.use(ElementPlus)` + `element-plus/dist/index.css` 把 **124 个 EP 组件全部打进 `index.js`/`index.css`（1 841 KB / 503 KB）**，而扫 `src` 全部 `.vue` 的 `<el-xxx>` 用法对照 `element-plus/es/components` 目录清单，实测**只用 36 个**；另 `QuillEditor` 在 `main.js` 全局注册，把 `@vueup/vue-quill` 拉进首屏闭包。次要原因：`Home.vue` `onMounted` 5 项串行 `await`，最重的逐账号登录态批量检测（单账号最坏 60 s 超时）把统计与近期动态一并挡在后面 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：`main.js` **从未被任何测试读取** —— 全量/按需在 vitest 里完全等价（都让 `<el-button>` 正常渲染、全部同绿）；集成层：无「加载打包产物并计时」用例；E2E/视觉层：**慢而不错** —— 画面完全正常只是迟到，像素对比天然免疫（本仓第二次踩同一条，前次 2026-10-14 账号页 PBKDF2）；审查层：QM-2 清单无 bundle 维度；构建层：vite 打印 `Some chunks are larger than 500 kB` 但**只是 warning，CI 不因此失败** |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①新增 `src/plugins/element-plus.js`：`element-plus/es` 具名导入 34 个真用组件 + 只导这 34 个的 `theme-chalk/el-*.css` 与 3 个共享底座（`el-var`/`el-reset`/`base`），导出标准 Vue 插件；`main.js` 改 `app.use(elementPlusOnDemand)` 并删全量 JS/CSS。**未新增任何依赖**（不引 unplugin-vue-components / auto-import）。②`QuillEditor` 改 `ArticleEditor.vue` 本地注册（Quill 只随 `/publish` 懒加载 chunk 下载，实测 148 KB 独立 chunk 不进 `index.js`）。③`Home.vue` 首屏数据分三档：统计/近期动态/账号数/平台元数据 `Promise.allSettled` 并行 + 各自独立 try/catch；失效账号横幅 `setTimeout(0)` 懒触发 + `onUnmounted` 清定时器；`statsLoaded` 语义不变（无 `electronAPI` 时**不**置位，避免误进全 0 引导态） |
| 实测效果（判据） | ✅ | `index.js` **1 841 → 1 334 KB（−27%）**、`index.css` **503 → 300 KB（−40%）**；`index.js` 加载 427 → 86 ms、CSS 261 → 45 ms；`domContentLoaded` 1 058 → 463 ms；FCP 1 172 → 544 ms；**主页挂载冷 1 960 → 743 ms（−62%）、热 803 → 283 ms（−65%）**。测量法：Playwright + 本地 HTTP 托管 `dist/`（`file://` 撞 CORS 必须起 http），以 `mp-home` testid 出现为界，冷/热各 3 轮 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`src/main.bundle-contract.test.js` 7 条源码契约（禁全量 JS/CSS、必须接按需插件、按需样式不得含 `dist/index.css`、Quill 不得全局注册）；②`src/plugins/element-plus.test.js` 3 条行为契约，其中 **P3 是漏登记机械锁**（扫 `src` 全部 `<el-xxx>` 逐个核对注册表）；③`src/views/Home.first-paint.test.js` 4 条首屏时序契约（首帧不等 IPC、统计/历史并行、单点失败不扩散、批量校验懒触发）；④`AGENTS.md` QM-2 新增两条检查项；⑤`01-docs/learnings.md` 顶部 5 条；⑥`everos/data/knowledge/ui-framework-full-import-is-first-paint-landmine/index.md`（外部记忆）；⑦PRD-TAB-INDEPENDENT-HOME 新增 F7 首屏性能需求 + 数据校验 4 行 + 验收 2 条 + 风险 2 行 + 测试计划 3 行；⑧CHANGELOG 条目 |
| TDD 与相关域全量 | ✅ | 先写测试后写实现：`main.bundle-contract.test.js`（7 红）→ `Home.first-paint.test.js`（4 红，含 pinia/router 装配修正）→ 实现 → **全绿**。本 PR 新增 14 条 + 改 1 处既有测试（`Home.test.js` 的 `flushMounted` 多等两轮 `setTimeout(0)` 适配懒触发）。相关域：`src/plugins/` + `src/views/Home*` + `src/main*` + `src/components/ArticleEditor*` 全绿；`src/**` 全量见下「相关域全量」行 |
| 变异反证（4/4 指名红） | ✅ | M1 把 `main.js` 改回 `import ElementPlus from 'element-plus'` ⇒ B1/B2/B5/B6 同时判红；M2 从 `COMPONENTS` 删 `ElTable` ⇒ P3 报 `以下 EP 组件在 src 中被使用但未在按需清单注册: table`；M3 `Promise.allSettled([...])` 改回串行 `await` ⇒ H2 报 `expected -1 to be less than -1`（history 被 dashboard 挡死）；M4 `setTimeout(...,0)` 改成直接 `await refreshExpiredAccounts()` ⇒ H4 报 nextTick 时已发起批量校验。四条均「把锁/业务改坏必须立刻变红」，不是只证业务改动变红的假绿 |
| **QG Visual 真实红 → 样式闭包修复** | ✅ 已修并留下机械锁 | 首轮 CI 的 `QG Visual` 红 3 处：`podcast-channel` 21.63% / `create-editor` 9.48% / `create-pipeline` 9.47%（阈值 6%）。**这是 P3 锁不到的维度**：P3 只锁「组件注册」，第一版按需 CSS 只导了「模板用到的组件」，漏掉 EP 的**纯样式依赖内部组件**。取证到权威判据 = `element-plus/es/components/<name>/style/index.mjs`（**裸 import 形态**，写成 `/from\s+…/` 会匹配 0 条并算出「闭包 = 已导入」的假结论）。重算闭包后发现漏 7 个：`el-scrollbar` / `el-popper` / `el-overlay` / `el-option-group` / `el-text` / `el-radio`（本体——我上一轮只补了 radio-button/radio-group，而 `radio-group` 的 style 依赖里就有 `radio`）/ `el-config-provider`（0 字节占位，renderless）。补齐后：`index.css` 300.4 → **309.5 KB**（仍远低于基线 503 KB），产物内 12 项关键选择器实测全部命中，本地复跑 `podcast-channel` **21.63% → 2.05%**。新增 **P4 样式闭包锁**（按 style/index.mjs 重算闭包，断言不缺）与 **P5 重复 import 锁**（本轮真出过重复行） |
| **三处红的真根因（第二步）：多导了 `el-reset.css`** | ✅ 已修 + 留 P6 锁 | 补完样式闭包后 `podcast-channel` 由 21.63% 降到 2.05%，但 `create-editor`/`create-pipeline` 仍 9.48%/9.26%。用**逐元素计算样式对比**（遍历全 DOM，为 348 个元素各打一份计算样式签名，两态逐项 diff）定位到**唯一差异**：`input,textarea,button` 的 `font-family` 在我的分支是「继承应用字体栈」、在 main 是浏览器默认 **`Arial`** —— 命中 32 个元素（**全部是 BUTTON 及其子节点**）。根因：`element-plus/theme-chalk/el-reset.css` 含 `input,textarea,button{font-family:inherit}`（还改了 `a`/`h1~h6`/`p`/`hr`/`sup,sub,small`），而 **EP 自己的全量产物 `theme-chalk/index.css` 里根本没有这个文件**（实测在其内搜不到该规则）⇒ 我多导它 = 悄悄改变原生元素默认样式，而这些在全量引入下**从未被改变过**。移除后三处全部归零：**create-editor 0.21% / create-pipeline 0% / podcast-channel 0%**，与 `origin/main` 逐位一致（同态重复渲染实测 0.00%，排除抖动）。新增 **P6 全量产物包含性锁**：断言插件导入的每个主题文件都存在于 `index.css` 中，并显式禁止 `el-reset` |
| **两次错误结论的更正（留证，不删）** | ⚠️ 已推翻 | 我先后给过两个**错误**判断并写进了已提交的文档：① 「`create-editor`/`create-pipeline` 与本次改造无关，是存量漂移/抖动」——当时的依据是「临时加回 `element-plus/dist/index.css` 后数字逐位不变」；② 「`podcast-channel` 21.63% 属环境差异」。**两者均被后续对照推翻**：把**整套改动**还原成 `origin/main` 后三者是 0.21% / 0% / 0%，而我的分支是 9.48% / 9.26% / 2.05%；同一状态连拍 3 次，两两差异 **0.00%**（0 px / 14 px），彻底排除抖动。①的实验设计有缺陷：它**只还原了 CSS**、没还原 JS 装配，而真根因虽在 CSS 侧，却必须在「完整变更集 vs main」的对照下才暴露 ⇒ 得出「无关」的假结论。**教训**：A/B 必须还原**完整变更集**；只还原其中一层，会把另一层的因果误判成「无关」。两条错误结论已在 BUGFIX / learnings / CHANGELOG 同批更正 |
| 机械锁当场抓到的真实漏项 | ✅ | P3 首次运行即报 `radio-button, radio-group` missing。取证：`element-plus/es/components/{radio-button,radio-group}/` **只有 `style/`，无 `index.mjs`** —— 实现放在 `radio/` 目录，由 `ElRadio` 以 `withNoopInstall` 挂成子组件，**不占全局注册表**。修法：只注册 `ElRadio`（把它们写进 `app.use` 是无效劳动，其 install 是 no-op）+ 单独 import `el-radio-button.css` / `el-radio-group.css`（**样式不走 install，必须单独导**）。这正是该锁存在的理由 |
| 六路由真实产物冒烟 | ✅ | 本地 HTTP 托管 `dist/` + 注入最小 `electronAPI` 桩，逐路由加载并统计 `[class*="el-"]` 元素：`/` `/publish` `/accounts` `/dashboard` `/publish/history` `/collection` 全部 `bodyLen > 2000`、无 "Failed to resolve component"；实测 EP 类名 `el-upload`/`el-icon`/`el-overlay`/`el-modal-dialog` 与 Quill `ql-editor` 均在 DOM 中出现 ⇒ 按需注册真的生效。（`accounts`/`member-center` 两页 `el-类=0` 经 `git grep` 取证为**页面本就只用自定义 `.mp-*` 组件**，非注册失败） |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐值相等（无幽灵行） |
| 静态门禁（本地已跑） | ✅ | `eslint` 对 8 个改动/新增文件 `--quiet` **exit 0**；`check-no-brand-residue.js` 未跑（无竞品名新增，文案全部复用既有 locale key）；locale **未改**（无新增用户可见文案，CI Gate 7 无成对校验需求） |
| QM-1 打包 | **N/A（未触及触发路径）** | AGENTS.md QM-1 的触发条件是「修改 `apps/desktop/electron/` 或 `packages/rpa-engine/` 下代码」。本 PR 的代码改动**全部在 `apps/desktop/src/**`（渲染层）**，`git show --stat HEAD` 可核：无任何 `electron/` 文件 ⇒ QM-1 不适用。渲染层对应的构建验证是 `vite build`（见下），非 electron-builder。**不为凑证据跑无关打包**。 |
| QM-4 视觉 | ✅ | 有渲染端样式变更 ⇒ 跑了视觉判据。首轮 CI 的 `QG Visual` **红 3 处**，经**两步**定位并全部修复（① 样式闭包漏 7 个纯样式依赖内部组件；② 多导 `el-reset.css` 改变了原生元素默认字体）。**本地完整像素套件 19/20 通过**（阈值 1%；CI 用 6%），三处从 9.48%/9.26%/21.63% 全部归零，与 `origin/main` 逐位一致；唯一失败的 `collection` 1.44% 经两态单跑均为 **0%** ⇒ 抖动（且 1.44% < CI 阈值 6%）。六路由冒烟亦实测无组件解析失败 |
| QM-6 CCG 双模型深度审查 | ⚠️ **判定 DUAL / required=true，但未完成——如实登记不假装通过** | `pre-commit` 的 `ccg-review-decider` 判定：`mode=dual`、`reason=变更 593 行 > 200 行阈值`、`deepReview.required=true`、`status=pending`、`performedBy=null`、`findings=null`（取证：`.ccg/reviews/8e9109a556630fb4d0ad0cb714f737191a4914cd.json`）。**尝试补跑失败**：`scripts/deep-review.sh` 读 `HEAD` 的判定记录，而记录**以提交前的 HEAD sha 命名**（`.git/hooks/pre-commit` 第 148-155 行注释明说这是刻意设计），因此 commit 之后 `HEAD` 永远查不到自己的记录；改用驱动 `ccg-deep-review.js --sha <记录名>` 则 `base..head` 恒为空（该 sha 已是 main 的祖先），驱动报「取不到 diff」退出 0。改传真正的改动 sha `d3959096a` 又会被同名记录（那份是 docs 提交的 `mode=skip`）短路。**四路都试过，均无法在「记录名 = 父 sha」的设计下完成评审** ⇒ 本行如实记 `pending`，不编造 findings。这是**流程性问题**（评审记录命名与提交 sha 错位），值得独立切片修正，不属于本 PR 的代码范围 |
| OpenSpec change | 判定不建（如实记录） | 单点根因修复、无方案级取舍、无新增 IPC 通道/存储/接口/依赖；同域先例（2026-10-11 账号标签首屏登录态）同样只产出 PRD + 执行记录 |
| 远程同步 | PENDING | 开 PR 时登记；合并后就地改写为 PASS + merge SHA，并同一次提交删除 frontmatter `sync_*` 三字段与 `scripts/gate-record-debt-ledger.json` 登记项 |

### 构建验证（QM-1 不适用时的渲染层对应验证）

- `cd apps/desktop && pnpm exec vite build` → **exit 0**（`✓ built in 1m 33s`）。
- 补齐样式闭包后的最终产物：`dist/assets/index-B7fPdJs9.js` = **1 333.7 KB**（gzip 447.82 kB）、`dist/assets/index-B2bBdTOG.css` = **309.5 KB**；`quill-Cn-14qpl.js` = 148.45 kB 为**独立 chunk**（证明 Quill 已退出首屏闭包）。
- 产物内 12 项关键选择器实测全部命中（`.el-scrollbar`/`.el-scrollbar__wrap`/`.el-popper`/`.el-overlay`/`.el-select-group`/`.el-text`/`.el-radio{`/`.el-radio__input`/`.el-radio-button`/`.el-fade-in`/`--el-color-primary`；`el-config-provider.css` 是 0 字节占位、renderless，无选择器属预期）。

### 相关域全量（`src/**`）

命令：`cd apps/desktop && pnpm exec vitest run`（`vitest.config.js` 为 `maxWorkers:1 / fileParallelism:false`，串行，渲染端 8000+ 用例约 1–2 小时）。

- 结果：**见 CI 的 QG Desktop Shards**；本地跑完整串行集受并发会话 CPU 占用影响不可靠，故以 CI 为判据。本 PR 触达的域（`src/plugins/`、`src/views/Home*`、`src/main*`、`src/components/ArticleEditor*`）本地全绿。
- 本次改动**无 IPC 契约变更**（`page-manager:create-new-tab-page` 入参/返回形状不变，主进程零改动）。

### 遗留（不假装已闭合）

1. **QM-6 深度评审未完成（流程性阻塞，非本 PR 代码问题）**：判定 `deepReview.required=true`，但「记录以父 sha 命名」的设计使 commit 后无法定位自己的记录（详见上表 QM-6 行的四路尝试）。建议独立切片修正 `ccg-review-decider` 的记录命名（改用提交后 sha 或同时写两份），使 `deep-review.sh` 可用。
2. **本地像素套件里的 `collection` 1.44%**：两态**单跑均为 0%**，判为套件内的抖动（同批运行时 dev server 冷/热差异）；且 1.44% 低于 CI 阈值 6%。**刻意不更新基线掩盖**（AGENTS.md 明令禁止用 `--update-baseline` 掩盖问题）。
3. **本地像素阈值与 CI 不同**：本地默认 1%，CI 用 6%（`PIXEL_THRESHOLD`）。故 `podcast-channel` 本地 2.05% 会判红、CI 6% 阈值下应通过。对照时须注意口径差异。
4. **`index.js` 仍有 1.33 MB**：本次只砍了 element-plus。剩余业务代码（`@element-plus/icons-vue`、各 view 共享依赖）未拆。进一步方向是 `build.rollupOptions.output.manualChunks` 做 vendor 分包，属独立切片。
5. **vite 的 500 kB chunk 警告仍未进 CI 失败条件**：改 `.github/workflows/` 属「改谁来守门」，按 AGENTS.md 必须人工过目，不在本 PR 范围。
6. **按需清单需手工维护**：新增 `<el-xxx>` 必须同步登记组件 + 样式闭包。P3/P4/P5 三道机械锁保证漏登记会红，但**红在 CI 而不是写代码的当下**；若将来装 unplugin-vue-components 可消除此成本，但本次刻意不新增依赖。
7. **本会话 D 盘一度写满（ENOSPC）**：由 1 小时级的全量串行测试 + 多次构建累积所致。已用 `pnpm store prune` 释放 **3.54 GB**（移除 31978 个文件 / 1262 个包，均为无引用内容）。未做任何目录递归删除（守 R0）。
