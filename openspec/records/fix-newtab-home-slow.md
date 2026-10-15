---
record: fix-newtab-home-slow
task: 点击顶部「+」新增标签后 3-4 秒才显示应用主页——element-plus 全量引入改按需 + 首页数据并行化
date: 2026-10-15
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
| 机械锁当场抓到的真实漏项 | ✅ | P3 首次运行即报 `radio-button, radio-group` missing。取证：`element-plus/es/components/{radio-button,radio-group}/` **只有 `style/`，无 `index.mjs`** —— 实现放在 `radio/` 目录，由 `ElRadio` 以 `withNoopInstall` 挂成子组件，**不占全局注册表**。修法：只注册 `ElRadio`（把它们写进 `app.use` 是无效劳动，其 install 是 no-op）+ 单独 import `el-radio-button.css` / `el-radio-group.css`（**样式不走 install，必须单独导**）。这正是该锁存在的理由 |
| 六路由真实产物冒烟 | ✅ | 本地 HTTP 托管 `dist/` + 注入最小 `electronAPI` 桩，逐路由加载并统计 `[class*="el-"]` 元素：`/` `/publish` `/accounts` `/dashboard` `/publish/history` `/collection` 全部 `bodyLen > 2000`、无 "Failed to resolve component"；实测 EP 类名 `el-upload`/`el-icon`/`el-overlay`/`el-modal-dialog` 与 Quill `ql-editor` 均在 DOM 中出现 ⇒ 按需注册真的生效。（`accounts`/`member-center` 两页 `el-类=0` 经 `git grep` 取证为**页面本就只用自定义 `.mp-*` 组件**，非注册失败） |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐值相等（无幽灵行） |
| 静态门禁（本地已跑） | ✅ | `eslint` 对 8 个改动/新增文件 `--quiet` **exit 0**；`check-no-brand-residue.js` 未跑（无竞品名新增，文案全部复用既有 locale key）；locale **未改**（无新增用户可见文案，CI Gate 7 无成对校验需求） |
| QM-1 打包 | 见「QM-1 打包」行 | `cd apps/desktop && pnpm exec vite build` exit 0（产物即上表实测依据）；`electron-builder --win --dir --publish never` 与启动测试见下 |
| QM-4 视觉 | ✅ | 有渲染端文件变更 ⇒ 跑了视觉判据：按需样式 = 全量 `dist/index.css` 中对应组件规则的**同一份文件**（`theme-chalk/el-*.css` 就是 `index.css` 的构成单元），只是少了 88 个不用的组件；项目自有 `ep-theme.css` 的 `--el-*` 变量桥接依赖由 `el-var.css` + `base.css` 提供，未受影响。六路由冒烟（上一行）实测无组件解析失败 |
| QM-6 CCG 双模型深度审查 | ✅ | 变更 > 200 行阈值 ⇒ 提交钩子判定 **DUAL**；`sh scripts/deep-review.sh`（critic=claude / proposer=opencode，跨家族）轮 1 产出 6 条，逐条在当前 HEAD 上重放后处置：i1（MAJOR，`COMPONENTS` 与样式 import 可能漂移）**upheld** → 插件内两条清单改为同序并加「逐行比对」注释 + P3 机械锁；i2（MAJOR，`withNoopInstall` 组件会被误加进清单）**upheld** → 正是本次 radio 漏项的成因，已在代码注释写明判据（先看 `index.mjs` 是 `withInstall` 还是 `withNoopInstall`）；i3（MINOR，`statsLoaded` 语义可能被并行化打翻）**upheld** → 保住「无 API 不置位」并由既有测试 `handles missing electronAPI gracefully` 锁定；i4/i5/i6（Info）→ 登记遗留（`index.js` 仍 1.33 MB 的 vendor 分包方向、vite 500 kB warning 未进 CI、`/publish` chunk 221 KB 的秒开优化），均属独立切片，不塞进本 PR |
| OpenSpec change | 判定不建（如实记录） | 单点根因修复、无方案级取舍、无新增 IPC 通道/存储/接口/依赖；同域先例（2026-10-11 账号标签首屏登录态）同样只产出 PRD + 执行记录 |
| 远程同步 | PENDING | 开 PR 时登记；合并后就地改写为 PASS + merge SHA，并同一次提交删除 frontmatter `sync_*` 三字段与 `scripts/gate-record-debt-ledger.json` 登记项 |

### QM-1 打包

- `cd apps/desktop && pnpm exec vite build` → **exit 0**（`✓ built in 1m 59s`），产物 `dist/assets/index-BRBtaWwK.js` = 1 365.69 kB（gzip 447.83 kB）、`dist/assets/index-3R81qx42.css` = 307 595 B；`quill-Dj69494F.js` = 148.45 kB 为**独立 chunk**（证明 Quill 已退出首屏闭包）。
- `electron-builder --win --dir --publish never` 与 8 秒启动测试：见「遗留」第 1 条（本机并发会话占用，按项目既有口径以 CI 的 QM-1 job 为判据，不在本记录假装已跑）。

### 相关域全量（`src/**`）

命令：`cd apps/desktop && pnpm exec vitest run`（`vitest.config.js` 为 `maxWorkers:1 / fileParallelism:false`，串行，渲染端 8000+ 用例约 1–2 小时）。

- 结果：**见 CI 的 QG Desktop Shards**；本地跑完整串行集受并发会话 CPU 占用影响不可靠，故以 CI 为判据。本 PR 触达的域（`src/plugins/`、`src/views/Home*`、`src/main*`、`src/components/ArticleEditor*`）本地全绿。
- 本次改动**无 IPC 契约变更**（`page-manager:create-new-tab-page` 入参/返回形状不变，主进程零改动）。

### 遗留（不假装已闭合）

1. **`electron-builder --win --dir` + 8 秒启动测试未在本地跑完**：本机运行中的应用实例属另一 worktree/会话（`mp-app-live2` + `shared-user-data`），启动测试需接管临时 profile 且受并发 CPU 占用影响，stderr 判据（三层）不可靠。按项目既有口径交 CI 的 QM-1 job；若 CI 报第②层 NEEDS_REVIEW，按 `scripts/qm1-scheduled-publish-verify.cjs` 同源判据人工裁决。
2. **`index.js` 仍有 1.33 MB**：本次只砍了 element-plus。剩余业务代码（`@element-plus/icons-vue`、各 view 共享依赖）未拆。进一步方向是 `build.rollupOptions.output.manualChunks` 做 vendor 分包，属独立切片。
3. **vite 的 500 kB chunk 警告仍未进 CI 失败条件**：改 `.github/workflows/` 属「改谁来守门」，按 AGENTS.md 必须人工过目，不在本 PR 范围。
4. **`/publish` chunk 221 KB**：若将来要求发布页也秒开，可评估 toolbar 精简或进一步拆分；当前不在验收判据内。
5. **失效账号横幅在账号多时仍可能慢**：懒触发只保证它不阻塞首屏，不保证它自己快；其性能属 `accounts:batch-check-login` 的既有议题（并发 3 / 单账号 60 s 超时）。
6. **按需清单需手工维护**：新增 `<el-xxx>` 必须同步登记组件 + 样式两处。P3 机械锁保证漏登记会红，但**红在 CI 而不是写代码的当下** —— 若将来装 unplugin-vue-components 可消除此成本，但本次刻意不新增依赖（QM-2「生产依赖闭包」审计成本）。
