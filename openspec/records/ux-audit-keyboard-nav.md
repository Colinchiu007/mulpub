---
record: ux-audit-keyboard-nav
task: UX 审计阶段 1.5（快捷键与鼠标共用一段可见导航）—— 把「该跳到哪一面」的三段判断收敛为单一 composable，App.vue 的 app:navigate 与 MpSidebar.onNavClick 同时改为消费它，并配 45 条契约锁与 18 条变异反证
date: 2026-10-21
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src）+ 文档，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：快捷键与鼠标共用一段可见导航（ux-audit-keyboard-nav，2026-10-21）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-keyboard-nav`（D 盘），分支 `ux-audit-keyboard-nav`（回读 `git rev-parse --abbrev-ref HEAD` = 该值），由 `scripts/start-mp-task.ps1 -TaskName ux-audit-keyboard-nav` 创建 |
| 质量节拍 pre-flight | ✅ | 编辑前确认当前分支非共享根 `main`；共享根未被写入（本轮所有落盘都在 worktree 内） |
| TDD 顺序 | ✅ | 先写 `App.visible-navigation.test.js`，实现前实测 **6 failed \| 3 passed**（三条红点名「先切回首页标签，再跳目标路由」「定向让它自己跳，主窗口隐藏路由不动」「键盘入口必须调用共享实现」），再改实现转绿 |
| 自测（新增面） | ✅ | `vitest run src/composables/useVisibleNavigation.test.js src/App.visible-navigation.test.js src/layouts/MpSidebar.sidebar-focus-nav.test.js` → **Tests 45 passed**（组合式 31 + App 10 + 侧边栏既有 4）、无 `Errors` 行、rc=0 |
| 自测（消费者并集） | ✅ | 改造前先 `git grep -l "navigateActiveHomeShell\|onNavClick"` 取并集 ⇒ `MpSidebar.sidebar-focus-nav.test.js` / `App.sidebar-collapse` / `App.dispatch-failed` / `shell-mode-6b` / `overlay-view-suspension` / `publish-tab-state-keepalive` 全部纳入验证域 |
| 自测（全域） | ✅ | `vitest run src`（dot reporter）→ **Test Files 405：2 failed \| 403 passed；Tests 6432：2 failed \| 6428 passed \| 2 skipped**（第四轮 i7 拆分后重跑的全域读数）。两条红见「二、两条红的归因」 |
| 反证（18 条） | ✅ | `node scripts/visible-navigation-contract-mutate.js` → `[BASELINE] rc=0 failed=0 errors=0 blind=false`、`[DEAD-PROBE] 全部探针可命中（标题域 45 条）`、`[SUMMARY] 共 18 条：CAUGHT=18 其余=0`，rc=0。还原后逐文件 `git diff --numstat` 与变异前**逐字相等**（App.vue 7/3、MpSidebar.vue 6/24）——不采信驱动自报 |
| 静态门禁 | ✅ | `check-locale-sync.js --cjk` → **PASS（基线 1330 条，当前 1124 条，无新增硬编码）**：本批无任何新用户可见文案 ⇒ 不改 locales（Gate 7 无触发面）；`check-no-brand-residue` → **PASS（扫描 11514 个 tracked 文件）**；`check-doc-abs-paths.js --base=origin/main` → **PASS（counts=1161 domain=562 files=561 canJudge=true）**；聚合 `eslint electron/ src/ --quiet` → **rc=0** |
| 行尾对账 | ✅ | 五个改动文件 `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐文件相等**（App.vue 7/3、MpSidebar.vue 6/24、sidebar-focus-nav 10/1、审计文档 61/1、.gitignore 4/0） |
| QM-1 打包 | N/A | 只改 `apps/desktop/src/**`（渲染端）与 `scripts/`，未触碰 `apps/desktop/electron/**` 与 `packages/rpa-engine/**` ⇒ 打包判据不触发；`.gitignore` 反选与新增驱动均非运行时依赖 |
| QM-4 视觉回归 | N/A（如实登记） | 本批零视觉变更：不新增节点/样式/locale，不改盒模型与颜色；判定域不含本批改动面（`check-visual-coverage` 的域是注册表 × 两档主题，本批未动注册表）。像素门禁由 `QG Visual` 在 CI 上以 CI 渲染为准执行 |
| QM-6 双模型 | 见「五、QM-6」 | 本机 CCG 判定链已跑（`ccg-review-decider` 由 pre-commit 落产物）；外部模型评审结果与处置如实登记，不伪造 `cleared` |
| 第一性原因（QM-5 ①） | ✅ | 不是「App.vue 漏了一个 if」，而是**同一段判断被抄了两遍**：三段式只存在于 `MpSidebar.onNavClick`，`app:navigate` 回调只做裸 `router.push`。取证：改造前 `git grep -n "navigateActiveHomeShell" -- apps/desktop/src` 只命中 `MpSidebar.vue` 一个文件 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：既有 `MpSidebar.sidebar-focus-nav.test.js` 4 条**只测鼠标侧**，壳层没有任何一条断言「快捷键也走这段判断」；集成层：`App.dispatch-failed` / `App.sidebar-collapse` 挂载 App 但不断言导航；视觉层：结构上失明（覆盖层背后的路由变化不改一个像素）；审查层：audit-1.5 是人工读模板发现的。四类原因同时命中：无测试 / 断言不精确（只测一条入口）/ 环境差异（`WebContentsView` 是原生图层）/ 审查盲区 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单一实现 `src/composables/useVisibleNavigation.js`（A 定向 / B 切回首页标签 / C 推主窗口路由 + 三条降级纪律）；回归保护 = `useVisibleNavigation.test.js`（31 条，含装配锁与全仓调用点集合断言）+ `App.visible-navigation.test.js`（10 条，真 tab store + 假桥 + 顺序账本 + 3 条「两处入口同源」结构锁） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 结构锁禁止任一处再出现 `navigateActiveHomeShell` / `switchToTab(home…)` 形态（扫描域排除注释行）；② **全仓调用点集合断言** —— 新增入口未登记即红，防「下一个入口重演」；③ 反证驱动把「调用点漏传注入参数」单列一条（M3），因为该类失败在类型层与编译期都不出声；④ 方法论写入 PRD §4：在 setup 期绑定 `getApi` 会让 mock 桥接层的 3 个文件 26 条用例整片变红 —— 依赖注入的**求值时机**也是契约 |

## 一、这次到底改了什么（用户可见口径）

| 用户此刻聚焦在 | 改造前按快捷键 | 改造后按快捷键 |
|---|---|---|
| 首页标签 | 可见跳转 | 不变（不多发一次切标签 IPC） |
| 普通网页标签 | 主窗口路由在覆盖层背后变了，**屏幕无反应** | 先切回首页标签，再显示目标页 |
| 内嵌主页实例（home-shell） | 该实例没动，且主窗口多出一条看不见的路由（从此漂移） | 定向让该实例自己跳，主窗口隐藏路由不动 |

无新增文案、无新增可聚焦元素、无样式变化 ⇒ 不刷视觉基线、不改 locales。
诊断痕迹沿用改造前同款 `console.warn` 前缀（`[sidebar] navigate home-shell failed` /
`[sidebar] switch home failed` / `[sidebar] navigate failed`），历史日志检索不断链。

## 二、两条红的归因（不认领、也不放行）

`overlay-view-suspension.test.js > preload index.bundle.js 已重打包` 与
`shell-mode-6b.test.js > preload index.bundle.js 已重打包`：两者读的是
`apps/desktop/electron/preload/index.bundle.js`，该文件**不是 git 受管文件**
（`git ls-files --error-unmatch` → "did not match any file(s) known to git"），
由构建步骤生成。本 worktree 是新建的、没跑过打包步骤 ⇒ 文件不存在即红。
本批 diff 不含 `electron/preload/**` 任何文件，且这两条断言的输入只有一个构建产物路径，
因此归因为「fresh worktree 缺构建产物」这一既有类（同 [[project-mulpub-known-test-failures]]），
非本 PR 引入；CI 侧由 `electron-ci` 的打包步骤先产出该 bundle 再跑桌面全量。

## 三、两条关于「反证自身」的实测更正（不写下来就会被重抄）

1. **M6 第一版零条红。** 它摘的是 `if (tabStore.isHomeTab) return`，而紧随其后的
   `activeTabId === homeTab.tabId` 比较把同一种状态又挡了一遍 —— 前者是冗余防御，
   **有牙的是 id 比较**。把变异打在后者上才打通。教训：写变异前先问「这一格真的决定行为吗」。
2. **M7 第一版是 `PROBE_BLIND`。** 多行片段替换留下了悬空的 `} catch {}`，vitest 在解析期失败，
   汇总行整体缺失 ⇒ 既不能判 CAUGHT 也不能判 MISSED。改为**整函数体替换**保证可编译。
   由此驱动新增两档：`RUN_UNCLEAN`（零具名红但 `Errors>0`）与基线不干净一律拒跑（rc=2）。

## 四、依赖注入的求值时机（本轮实测踩出）

组合式不 import `@/api/electron-bridge`；调用点写 `apiGetter: () => getApi()`。
两种"更省事"的写法都被实测否证：

- 在组合式里 `import { getApi }` ⇒ 每个 mock 桥接层的夹具被迫补出该具名导出；
- 在 setup 期绑定函数本身（`apiGetter: getApi`）⇒ **同样是访问**，实测把
  `MpSidebar.more-keyboard` / `.appmenu` / `.more-active` 三个文件共 26 条无关用例整片打红
  （`No "getApi" export is defined on the "@/api/electron-bridge" mock`）。

代价是"调用点漏传"不会编译失败 ⇒ 用装配锁补（M3 变异 + 逐调用点参数面断言 + 全仓调用点集合断言）。

## 五、QM-6（第一轮已处置，闭合未达成）

判定链实跑：`node scripts/ccg-review-decider.js --base origin/main --head HEAD`
⇒ **mode=DUAL**（变更 960 行 > 200 行阈值；敏感命中 0 路径 + 2 内容），
产物 `.ccg/reviews/a9dd314e5ed2705525882aa7a4202740fcc2e1ca.json` 随提交入库。
引擎实跑（critic=claude，proposer=opencode，rounds=2）现场读数：

- `评审完成：8 条问题，维度分 4 个（correctness/security/performance/maintainability），最低分 6`
- `收敛判定: status=self_play reason=selfPlay minScore=6`
- `待裁决 6 条；其中高危域必须外部复核 0 条` ⇒ `requiresExternalReview: []`
- 裁决模板 `.adversarial/ccg-deep-a9dd314e/adjudication.json` 已逐条填写（6/6，verdict 全部 **upheld**），
  引擎回写状态停在 `self_play_pending` ⇒ 机械闸门 `check-pr-exec-record.js --mode=enforce`
  仍报 1 条深度审查欠账（闭环白名单是 `{cleared, needs_revision, self_play_resolved}`）。

**逐条处置**（指控 / 辩护 / 落点，完整版见 PRD §8 的表）：

| # | 成立的部分 | 本批实际改了什么 | 由哪条反证钉住 |
|---|---|---|---|
| i1 | 静默丢弃本身（不是"应当支持对象描述符"） | 非法入参改为动作为零 **+ 出声**；刻意不新增对象透传通路 | M12 |
| i2 | 表述自相矛盾 + 域声明缺失 | V9 结论改写为"已归因的既有红 + 判据"；PRD §6 顶部明写驱动只覆盖 3 个文件 | 文档判据 |
| i3 | 死探针 + 「≥1 命中即 CAUGHT」 | 驱动加**死探针预筛**（标题域取 JSON reporter，取不到读数即 rc=2）与**严格命中**（新增 `PARTIAL_RED` 档） | 判据本体 + 预筛实测抓到 1 条死探针 |
| i4 | 「找不到 home 标签」静默同形 + V1 把调用序当可见性 | 该分支加告警 + 对称双锁（缺则有告警 / 有则不得误报）；V1 措辞收窄 | M11 |
| i5 | 前提经检索为假，但"一次 grep 不保未来"成立 | 三条**集合锁**：发送方 / 渲染层订阅方 / 定向 IPC 消费方，各带扫描域规模下界与构建产物排除 | 集合锁本身 + M13 |
| i6 | 字面形态可绕过 + 复制者不触发调用点集合锁 | 取体改**括号配对 + 跳字符串**并配自证用例；探测面换成"是否引用定向 IPC" | M14 / M13 |

严格判据上线后**当场暴露 3 处过度声明**（M2/M6/M7 声明了本不该由该变异打红的锁）：
处置是把声明收窄到真覆盖的锁，并**另开 M13/M14** 去打红那些沉默的锁 ——
不是删锁，也不是放宽判据。**变异条数与红集一律以驱动自己的 `[BASELINE]`/`[DEAD-PROBE]`/`[SUMMARY]`
读数为准**（本文件不写死数字：写死就是下一次漂移的开始）；首轮为 10，i5/i6 扩到 14，
第二轮 i1/i2/i7 追加 M15–M18。本轮实跑读数登记在下表的「反证」行与门禁表里。

### 第二轮（引擎评审 c61a925e，critic=claude / proposer=opencode，8 条全部 upheld）

产物：`.adversarial/ccg-deep-c61a925e/{critique-v1.md,adjudication.json,family-snapshot.json}`；

**评审原文已入库**（`.adversarial/` 是 gitignored，落在里面就不构成可复核证据）：
`.ccg/reviews/visible-nav-r1-critique.md` 与 `.ccg/reviews/visible-nav-r2-critique.md`，
另有两份 `.ccg/reviews/visible-nav-r{1,2}-family-snapshot.json` —— 后者记录
critic=claude(anthropic) / proposer=opencode(deepseek) 的跨家族归属（"跨家族"这句的现场出处）。

| # | 严重度 | 指控要点 | 处置（可验证落点） | 反证 |
|---|---|---|---|---|
| i1 | Warning | 默认告警出口不分 arity，生产打出尾随 `undefined`；且默认实现被所有用例的 `vi.fn()` 替身挡在测量域外 | 默认值按 arity 分派 + 两条**不打桩直接调默认实现**的用例 | M16 |
| i2 | Warning | `navigateVisibly` 无串行化：连发两次都判定"需要切回首页"，多发一次 `switchToTab` 且 push 完成顺序可与输入相反；V6/顺序账本只覆盖单次调用内部 | 同实例尾部串接 + 连发只切一次 + 后一个目标最终生效两条用例 | M15（摘链头）/ M17（链进退空链） |
| i3 | Warning | M7 的注入体同时改变两个变量（新增一次 push + 换序），红的原因可归因到"多一次 push"而非"顺序不可反" | M7 改为整块换序，注入体 push 恰好一次 | M7 自身 |
| i4 | Warning | tasks/record/PRD 的条数彼此矛盾（19/9/10/28 对 14/39），而这些文档的用途就是防下一会话重抄 | 全部改到当场实测读数；**文档不再写死变异条数**，一律指向驱动的 `[SUMMARY]`/`[DEAD-PROBE]` | — |
| i5 | Warning | PRD §3.3 说"三条 `[sidebar]`"，实现是六条两前缀；鼠标路径非法入参由静默变出声是未登记的可观测变化 | §3.3 改为逐条枚举 + 前缀分工理由 + 明写该延伸 | — |
| i6 | Warning | 结构锁/集合锁以 `process.cwd()` 定位被扫描文件，换 cwd 时六条锁一次性 ENOENT；驱动把 `spawnSync` 的 cwd 钉死掩盖了它 | 锚点改 `import.meta.url` → `DESKTOP_ROOT`，并加"chdir 到盘符根仍成立"的坐标无关用例 | — |
| i7 | Info | 空串与非字符串共用一条文案，载荷 `{type:'string'}` 与"不是字符串"自相矛盾 | 拆两条文案 + 断言互不混用 | M18 |
| i8 | Info | 探针与用例标题纯子串耦合，"全部可命中"这句读数无法从 diff 独立复核 | 预筛逐条打印 `[PROBE-MAP] needle → 完整标题` | — |

**八条全部 upheld，没有一条被"看起来没问题"打发**；其中 i4/i5/i8 是文档与判据可读性问题，
仍按"处置必须有落点"的要求改到文件里，不接受只在对话里承认。

**关于 i7 的一条方法论**：合并两条被拒原因到一句文案，危害不是"少一条日志"，而是
**日志自相矛盾**（载荷说 `type=string`，文案说"不是字符串"）。可诊断性的判据是"能不能区分"，
不是"有没有出声"——这与 i1（出声了但形态错）是同一格的两面。

### 为什么这条 PR 现在不能自动合并

`check-pr-exec-record.js --mode=enforce` 仍读到 `.ccg/reviews/a9dd314e5….json` 的
`deepReview.status=self_play_pending`（引擎回写值，**本会话不手工改写**）。可达的闭合出口有两个，
都需要人的判断或外部后端：① 让引擎在**真跨家族**（非自扮演）下收敛并回写记录；
② 由人确认这些处置足够并改写审计产物状态 —— 后者属"改谁来守门"。
评审轮次与逐条处置已齐备（本文 §五 两轮 + PRD §8/§9），缺的只是记录状态字段的生产方回写。

## 六、遗留

1. 反证驱动仍未接进 CI（与 `publish-staleness` / `offline-live` 等同批 `contract-mutate` 一起欠账，任务 #23）：
   落点必须避开 30 分钟预算墙，本批不擅自决定。
2. 仍在裸 `router.push` 的其它入口（`TabBar` 新建标签、`ProfileMenu` 里的跳转等）未收敛。
   调用点集合锁只在有人新增 `useVisibleNavigation(` 而未登记时红，**不会**把旧入口拉进来；
   清点那条属阶段 3.2 / 5.x 的域。
3. 「覆盖层背后跳转看不见」的最终观测需要真机或像素级证据；本批只有行为锁，未做真机验证。

## 远程同步

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`，PR 号为 #4209）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红。**本行的存在本身就是判据**：`check-gate-record-debt.js` 对「整块缺 远程同步 行」的新记录当场判红 —— 本 PR 第一次 CI 就是这样拦下的（只写了 frontmatter 的 `sync_pr/sync_status` 不够，那几个键是**意图声明**，不能替代这一行；main push 回读证据写在 PR 评论里，不写回本文件）。|
