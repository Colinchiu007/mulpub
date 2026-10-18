---
record: ux-audit-impl
task: 按 UX-AUDIT-2026-10-17 §5 落地阶段 0 全部 + 阶段 1 批次 A（导航/快捷键/404/离线/陈旧看门狗/两条新门禁）+ 批次 B（试用横幅挂载、死全局注册清理、首运向导接回启动判定、帮助页可用化）+ 批次 C（1.1 暗色主题入口）
date: 2026-10-18
sync_status: PENDING
sync_reason: 本片为混合 PR（运行时代码 + 门禁 + 文档），合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR（2026-10-17 起回填通道已取消）
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：UX 审计落地 —— 阶段 0 全部 + 阶段 1 批次 A（ux-audit-impl，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR（运行时代码），走隔离 worktree | `scripts/start-mp-task.ps1 -TaskName ux-audit-impl` → worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-impl`（非系统盘）+ 裸分支 `ux-audit-impl`，基线 `fd6e9cc4a`（与 `origin/main` 同日实测对齐）。依赖就绪：`pnpm install --frozen-lockfile` + `node scripts/ensure-electron.js`（electron dist v43.7.7）+ `node scripts/verify-worktree-deps.js` ⇒ `消费方解析通过 11 项 … OK`。共享根未被触碰（本片全部写入均在该 worktree） |
| 第一性原因（QM-5 ①） | ✅ | 三类缺陷的共同第一性原因是**「机制已建、最后一公里未接线」没有任何东西在检测**：`confirmDanger` 注释自称契约而实测 4 个消费点（`audit-12`）；`lastEventAt` 写 4 读 0；`hotkeys:list` IPC/preload/白名单三层齐备而渲染端零调用；`useTheme()` 唯一非测试命中是它自己的定义。逐条引入点已按审计 §4 的 `文件:行号` 核实，未追溯到的历史改动不外推 |
| 逃逸分析（QM-5 ②） | ✅ | ①**测试场景缺失**：无「注册≠注入≠生效」的 UI 层判据（阶段 5.3/5.4 补）；②**Mock 过度**：`SettingsDialog.test.js` 按交互规范 §11.3 用 Proxy 兜底 mock `@element-plus/icons-vue`，于是图标名写错（实测 `Keyboard` 不存在）**组件测试全绿而只有 `vite build` 才炸** —— 本片补 `src/icon-imports-exist.test.js` 用未 mock 的真模块核对；③**断言不精确**：`publishProgress` 既有 38 例测的是事件路由，没有任何一例读 `lastEventAt`，所以"只写不读"在两层测试下静默存活；④**审查盲区**：暗色对比度六轮修复全部投向视觉测试注入 `data-theme` 才进得去的状态，用户不可达（1.1 单独成包处理） |
| 系统性漏洞定位（QM-5 ③） | ✅ | **门禁缺失**（具体到文件）：`scripts/check-frontend-consistency.js` 等 6 个既有前端门禁量字面量/行数/变量定义，不量接线与可达性 ⇒ 新增 `scripts/check-danger-confirm.js`（确认接线）与 `scripts/check-css-var-concat.js`（`var(--x)hex` 死声明，`check-css-var-defined.js` 对该形态结构性失明）。**测试接缝**：跨层确认（薄封装 + 上游确认）无法由单文件判据分辨 ⇒ 以「作用域判据 + 带 `confirmed_by` 的登记表」收敛，不假装能静态证明 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增/扩展回归锁共 9 个文件：`usePublishDrafts.test.js(+5)`、`CacheCleanupSection.test.js(+1)`、`ProfileMenu.test.js(+1)`、`member-center/AccountSecurity.test.js(新建 5)`、`UiModal.destructive.test.js(新建)`、`scripts/check-css-var-concat.test.js(新建 8)`、`scripts/check-danger-confirm.test.js(新建 9)`、`useHomeShellNavigation.test.js(新建 10)`、`HotkeysSettings.test.js(新建 7)`、`accelerator-format.test.js(新建 9)`、`NotFound.test.js(新建 4)`、`useOfflineStatus.test.js(+4)`、`offline-manager.test.js(新建 6)`、`publishProgress.stale.test.js(新建 6)`、`icon-imports-exist.test.js(新建 3)`、`unsaved-leave-contract.test.js(新建 4)`、`SettingsDialog.test.js(改 3 项 + 新 1 项)` |
| 防止再次发生（QM-5 ⑤） | ✅ | ①两条新门禁接进 `quality-gate.yml` **Gate 2b7**（`changes` 作业、`shell: bash` fail-fast、只 require node 内置模块 —— 该 job 无 Install deps，实测口径见 AGENTS.md）；②`scripts/check-unwired-tests.js` 现场核对：`检查域内测试文件 102 个 … OK: 全部测试均已接线或按欠账登记`，新加的 `node --test scripts/check-*.test.js` 两行就是它们的接线证据；③路由兜底同步登记 `route-registry`，由 `check-route-registry.js` 继续强制；④AGENTS.md 未改（本片不新增流程条款），规范落点为 `openspec/changes/ux-audit-implement/specs/desktop-ui-experience/spec.md` 的 9 条 Requirement |
| TDD | ✅ | 判据先写、实现后跑的顺序对两条新门禁成立（`check-css-var-concat` 首跑即抓到"扫描域下界取 400 而实测只有 200"的自造红，据此把下界改为按当场实测 150 并注明可重取）；对 UI 行为锁为「实现 + 同批行为锁 + 取消分支」。变异反证见 PRD §8.1，已实跑：`var(--surface)3e0` 复原 ⇒ 该锁红；`Keyboard` 名字不存在性由 `icon-imports-exist` 的区分力断言当场验证 |
| 行尾与 diff 对账 | ✅ | 每批提交前对账 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat`：批次 A `741 == 741`，批次 B `1019`（提交后回读）、批次 C `1500 == 1500`。新建文件均为 LF，`git` 警告 `LF will be replaced by CRLF` 属 checkout 转换（`i/lf w/crlf attr/text=auto`），非内容改动。**未触碰** `CHANGELOG.md` / `01-docs/learnings.md` / `.quality-gates.md` 等多写者面（本片把它们留到收口批次单独改，见下方 CHANGELOG 行） |
| 品牌残留 | PENDING | 本文件与本片代码不引入竞品实名；`node scripts/check-no-brand-residue.js` 在提交批次统一跑（pre-commit 亦含密钥/敏感扫描）。执行时机记录于此，不预写结论 |
| 受管文档绝对路径 | ⚠️ 见说明 | 本片新增文档只在 `01-docs/PRD-*` / `openspec/changes/*` / 本记录，路径一律相对仓库根书写（worktree 绝对路径以 `D:\Data\projects\mp-worktrees\...` 形式出现在**执行记录**里，属既有取证惯例；`Gate 12c` 按文件计存量，本片新文件的绝对路径条数在本机 `check-doc-abs-paths.js` 跑批时如实暴露，不调宽账本）。上一轮实测：该门禁只看 tracked 文件，且本地红点可能是**他人未跟踪文件**，届时按归因处理不代改 |
| 接线棘轮 | ✅ | 本片新增 15 个测试文件，其中 `scripts/check-css-var-concat.test.js`、`scripts/check-danger-confirm.test.js` 已点名进 `quality-gate.yml` Gate 2b7；其余为 vitest workspace（`apps/desktop`）自动收集面。`check-unwired-tests.js` 实跑 OK（见上一行证据） |
| 文档门禁 | ✅ | 本记录**自带** `\| 远程同步 \|` 表格行与声明式 bullet 两形态；按 2026-10-15 旧载体冻结**未**往 `.quality-gates.md` 插块、**未**往 `scripts/gate-record-debt-ledger.json` 加键。按 2026-10-17 `gate-record-sync-derived-status`：状态列不手写 `PASS`（合并前写 PASS 会判 `prematureClaims`），收口由 `scripts/lib/merge-ledger.js` 推导，**不另开回填 PR** |
| QM-1 打包 | ✅ | 改 `apps/desktop/electron/`（`services/hotkeys.js`、`services/offline-manager.js`、`preload/system.js`、`preload/access-control.js`）⇒ 执行完整打包链：`pnpm run build:vue` **VUE_EXIT=0**（第一跑为 1：`"Keyboard" is not exported by @element-plus/icons-vue`，据此改 `Key` 并补存在性锁）→ `electron-builder --dir --publish never --config.electronDist=<worktree>/node_modules/electron/dist` **BUILDER_EXIT=0**（离线，未联网）→ 产物级判据用 `@electron/asar.extractFile`（**不用整树 extract**）：asar 含 `\dist\index.html`（15041 键）、`electron\services\offline-manager.js` 含 `offline:lost` 与 `function notifyOfflineLost`、`preload\system.js` 含 `onOfflineLost`、`access-control.js` 含 `'onOfflineLost'` → 隔离 userData 启动：`ELECTRON_USER_DATA_DIR=%TEMP%\mp-qm1-launch-p0`，10 秒后 `ALIVE=True`、**stderr 0 字节**（AGENTS.md 三层判据第③层）、`ELECTRON_BEFORE=0 AFTER=0`（只杀自己 PID）。两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）为已知非致命警告，但如实记录：`.playwright-browsers` 缺 ⇒ 本产物不含捆绑 Chromium，不构成"安装包可用"的完整证据 |
| QM-4 视觉 | PENDING（本片阶段 0/1 只跑浅档） | 审计 §里程碑：1.1 之前暗色不是用户可达态，暗档自 1.1 合并后起算，且暗色基线重建须人工审核、**禁止 `--update-baseline` 消化**。本片刻意把 1.1（暗色入口）拆到后续 PR。已核对 4 处畸形 CSS 修复点均不在像素注册视图的默认可见区（`settings-general` 等视图不含 `.feedback-error` 的常态渲染），最终以 CI `QG Visual` 现场为准；如排红按 AGENTS.md 顺序（选择器命中数 → 同态连拍 → 逐元素计算样式签名）归因 |
| QM-6 CCG 双模型外部评审 | ⚠️ 未达成双模型闭环（如实登记） | 模型名不写死，取自 `~/.claude/.ccg/config.toml` 的 `[routing]`。pre-commit 现场打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁` ⇒ 机械链上 `deepReview` 未被强制。已按 AGENTS.md「未跑成不得记为达成」处理：本记录的结论有效性依据是**逐条实测 + 15 个回归锁 + 两条新门禁自带反证**，不是外部模型背书。上游方案（`01-docs/UX-AUDIT-2026-10-17.md` §7/§8/§9）已含 codex 轴三轮 rc=0 的实质否证成果（本片的 0.3/0.5 判据改写正是采纳其 w7 与 audit-3 更正） |
| 远程同步 | PENDING | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口（不另开回填 PR）；merge SHA 不在本表手写 |

- 保留门禁：变更类型与隔离 ✅ | 行尾与 diff 对账 ✅ | 文档门禁 ✅ | 接线棘轮 ✅ | 远程同步 PENDING

## 与上游审计稿的三处实测差异（不回改历史快照，登记于此）

1. **`audit-29` 的"点遮罩即消失＝默认同意"不成立**：逐点核查三处承载破坏性动作的 `UiModal`（`AccountGroupManager`、`AccountProxyDialog`、`CreateView` 项目删除对话框），其遮罩/Esc/X 三条关闭路径全部路由到 cancel，不触发破坏动作。因此 `closeOnOverlay` 默认值**不翻**（与评审 w7 一致），判据改写为"破坏性动作不得绑在关闭路径上"的逐点结构锁。
2. **阶段 0.5 写「CreateView/Publish/RewriteView 三页挂离开拦截」与其自身 finding 矛盾**：`audit-3` 已把 Publish 从范围里撤回（`keep-alive` 保活）。本批按 finding 级结论执行 —— Publish **不**挂拦截，并把"哪些编辑视图在范围内"交扫描锁枚举（实测 8 个视图，本批挂 1 个，7 个带逐条实测理由登记）。
3. **畸形 CSS 实测是 4 处不是 3 处**：漏计的是 `components/OptimalTimeTip.vue:42`（内联 `style` 里的 `linear-gradient(...,var(--surface)3e0,...)`），说明既有扫描只看了 `<style>` 块。新锁因此把内联 `style="..."` 属性纳入域，并做引号感知抽取（值里的 `>` 会截断朴素正则）。

## 阶段 1 批次 B 追加记录（ux-audit-impl-b，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 本批范围 | 1.3 / 1.4 / 1.10 + 三条 CI 收红 | `TrialBanner` 挂载、`LoadingState` 删除、首运向导接回启动判定、帮助页可用化；另修 `QG Static` 的 Gate 7（两处开发者诊断文案改英文）、`Gate 12e`（tasks 编号断档）、`check-max-lines`（`publishProgress.js` 557→498，看门狗抽 `publish-progress-stall.js`） |
| 第一性原因（QM-5 ①） | ✅ | 首运向导不可达的第一性原因是**写侧**：`first-run.js:34` 在每次启动无条件 `writeFileSync('first-run-done')`，使 `first-run:check` 恒真，而非"少写一行跳转"。审计稿 §audit-4 的更正（"疑似已被有意退役"）成立，故本批按"重新设计引导并接回"实施，未按"接一行跳转"估算 |
| 逃逸分析（QM-5 ②） | ✅ | **本批最重要的逃逸**：阶段 0 的 `member-center/AccountSecurity.test.js` 因 `vi.hoisted` 工厂内引用顶部 `import { ref }` 触发 TDZ ⇒ 整文件集合失败 ⇒ **0 条用例被执行**。它在四层证据里全部隐身：①`Tests 5677 passed` 不含任何计数（集合错误不贡献测试数）；②我看的是 Tests 行而不是 `Test Files` 行；③`check-unwired-tests.js` 只扫 `scripts/`、`.github/scripts/`，`src/**` 由 vitest workspace 收集，因此"文件在收集期死亡"无人看；④CI 侧 `QG Desktop Shards` 当时仍 pending。**这次是它自己变红才被抓到**（改判据方向后跑出 6 条），不是自审想到 |
| 连带暴露的两个真实缺陷 | ✅ | ①`AccountSecurity.vue:14,17` 判据方向写反：`pending` 初值 `null` 而按钮 `:disabled="loading \|\| pending !== 'switch'"` ⇒ **空闲态恒禁用**，用户从会员中心点不动「切换账号 / 退出登录」。改为与同文件 `revoking` 同向（只在自己那次请求进行中禁用），并补一条"空闲必须可点 + 加载中必须禁用"的行为锁。②夹具同形性：`useMemberStore` 的 mock 给裸 `ref`，组件按 Pinia 解包语义读 `memberStore.sessions.length` ⇒ 取到 `undefined` ⇒ 按钮再被禁用，`confirmDanger` "没被调用"看起来像守卫失效（AGENTS.md「契约夹具不得替对方剥壳」的第三种落点：**替对方解包**） |
| 防再犯（QM-5 ⑤） | ⚠️ 部分 | 已落地：把"集合失败"变成可见判据（本记录与 PRD §11.6 均要求以 `Test Files` 行而非 `Tests` 行为通过证据）。**未落地**：`scripts/` 域外没有一条静态门禁检测「`vi.hoisted` 同步工厂引用顶部 import」；本批已验证过一条可用探针（正控命中坏形态、负控放过异步 hoisted 修复形态，全仓实测命中数 0），但把它接成 CI 门禁属新增"谁来守门"，留待阶段 5 一并处理，不在此预写达成 |
| 引导真源收敛 | ✅ | 删除 `electron/services/onboarding.js` 与 `onboarding:complete/get-steps/status` 三条通道、preload 三方法、两处白名单、`ipc-handlers/index` 注册及其测试。保留 `first-run` 的判据是**存量数据事实**：`first-run-done` 每次启动都在写（所有老安装都有），若换成 `onboarding-done` 则每个老用户下次启动都被推进向导 —— 升级面全员可见回归且不会出现在任何单测里。同时删除 `first-run:status` 推送（窗口创建即发、SPA 挂载前无人监听，状态可由 `first-run:check` 随时读） |
| 门禁与棘轮的如实改数 | ✅ | `preload.test.js` 三条计数：`check-danger-confirm` `files=372 … unregistered=0 missing_evidence=0 stale=0`；`check-css-var-concat files=201 violations=0`；`openspec-sync-check OK: 387 tasks`；`check-route-registry 37/37`；`check-locale-sync --cjk` 1175（删向导死文案与 LoadingState 后下降）、`--keys` 2156 全部存在。**既有假红记录**：把 `system.js` 精确还原到 HEAD 后同一测量得 **140** 而断言写 139 ⇒ 该棘轮在本批动手前已差 1，控制对照与逐字节还原（md5 相等）过程见 PRD §11.6 |
| QM-1 打包 | 本批收尾重跑 | 本批改了 `electron/{window.js,ipc-handlers/*,preload/*,services/first-run.js}` ⇒ 属 QM-1 触发面；批次 A 的打包证据（`build:vue` rc=0 → `electron-builder --dir` rc=0 → asar `extractFile` 三查 → 隔离 userData 启动 10s 存活且 stderr 0 字节）已在上方表格登记，本批推送前按同三层判据重跑并回读 |
| 本批未做（不冒充已做） | ⚠️ | 1.1（暗色入口，单独成包）与 1.2（`AnnouncementBanner` 挂载）未包含在本批：1.2 的正确实现需要先给内嵌 `WebContentsView` 加 top-inset 通道（`view-bounds.js` + `webview-manager/layout.js` + `webview-manager/ipc-handlers.js:246` + `preload/page-manager.js:40` 四处同步，仿 `setSidebarWidth`），否则原生图层会盖住横幅；本批不把它伪装成"挂一行" |

## 阶段 1 批次 C：1.1 暗色主题入口（ux-audit-impl-c，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 本批范围 | 1.1（单独成包） | `useTheme.js` 模块级单例改造 + `components/AppearanceSettings.vue` 新建 + `SettingsDialog.vue` 插「外观」Tab（7→8）+ `App.vue` 启动引导 + `tests/visual-testing/test-runner.js` 主题注释更正 |
| 第一性原因（QM-5 ①） | ✅ | 不是"少写一行跳转"，而是**状态模型少一态**：原 `useTheme` 每次调用新建一份 `theme` ref 且只有 `light⇄dark`。照原样接一个开关的话"跟随系统"无处可存 —— 持久化**解析结果**会让用户每次改系统偏好都被上一次手工选择覆盖，两个方向的覆盖在用户侧同形为"设置没生效"。故真源改为**存模式（system/light/dark）、主题只是派生值** |
| 逃逸分析（QM-5 ②） | ✅ | ①**测试场景缺失**：全仓没有任何"某 UI 状态是否用户可达"的判据，`useTheme.test.js` 测的是纯函数，模块 0 调用点也能全绿；②**视觉层结构性失明**：暗色对比度六轮修复全部发生在视觉测试手工 `setAttribute` 出来的状态里，"用户进不去这个状态"对像素门禁不可见；③**断言不精确**：`SettingsDialog.test.js` 4 处硬编码下标点击对"插入一个 Tab"完全免疫（位移后照样通过，只是悄悄改测别的 Tab）——本批顺手改为按用户可见文案定位 |
| 系统性漏洞定位（QM-5 ③） | ✅ | AGENTS.md 已把「注册≠注入≠执行」写成纪律，但 UI 层没有机械判据（阶段 5.3 `check-ui-wired.js` 才是它的执行体）。本批的处理是把这条**下沉成装配锁**（`App.theme-boot.test.js` 以生产方式挂 `App.vue`，断 `storeGetSetting('ui:theme')` 被调 + `data-theme` 落值），而不是再造一条静态门禁；未落地的那条仍如实留给阶段 5，不预写达成 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `useTheme.test.js` 重写 25 条（含"两个消费者共享同一份状态""多次 `useTheme` 只读一次偏好、只注册一次系统监听"）；`AppearanceSettings.test.js` 新建 8 条（禁用期与 `role="status"` / 脏值回落且不回写 / 持久化的是模式 / 生效主题行 / 存储 reject 不变砖）；`App.theme-boot.test.js` 新建 2 条装配锁；`SettingsDialog.test.js` Tab 顺序与图标位计数改 8 + 新增「点击外观切换到外观面板」 |
| 变异反证（三条全部实跑） | ✅ | M1 摘 `App.vue` 的 `useTheme()` ⇒ 装配锁 **2 条全红**（`Tests 2 failed (2)`）；M2 摘面板渲染行、**留 Tab** ⇒ `SettingsDialog.test.js` **只有指名那条红**（`1 failed \| 10 passed (11)`）；M3 摘 `setThemeMode` 的非法值拒绝 ⇒ `useTheme.test.js` 的 `it.each` **三条红**（`3 failed \| 30 passed (33)`）。三处还原后 `md5sum` 与被变异前备份逐字节相同（`App.vue` `6c11fd67…`、`useTheme.js` `84d083f1…`），`grep -c "MUT-"` = 0 |
| 反证取的是被禁形态本身 | ✅ | M2 不是"删掉整个 Tab"（那会让首条计数锁一起红、失去归因力），而是只摘面板渲染行 —— 这正是"Tab 在、点进去是占位符"这一用户可见故障形态本身；M3 是注释掉整条 `if`，不是把白名单改宽 |
| 已知边界（不掩盖） | ⚠️ | `storeGetSetting` / `storeSetSetting` 不在 preload `PUBLIC_METHODS` 内 ⇒ 权限级别 `authenticated`。未激活态下主题切换**本次会话生效但不跨启动持久化**（读被拒按"无偏好"处理；写被拒静默且本地不回滚）。这与 `drafts`、`story2video.lastOptions` 等既有本地设置同源（同一对通道）；单独为暗色开一条 public 通道属改"谁来守门"，本批不做，已在 PRD §12.5 登记 |
| QM-4 视觉（起算点变更） | ⚠️ | 本批合并后，`src/styles/*.css` 实测 **72 处** `[data-theme=…]`（2026-10-18 当场重取；旧值 77 已撤回）与 **20 张** `*-dark` 基线首次成为真实用户可达的回归面。**基线重建必须人工审核 diff 图，禁止 `--update-baseline` 自动收编**；本 PR 不含任何基线改动，暗档门禁读数留待合并后第一次 CI 现场 |
| QM-1 打包 | ✅ 推送前重跑 | 本批只改渲染端（`src/**`）与视觉 runner 注释，不在 QM-1 触发面（`apps/desktop/electron/`、`packages/rpa-engine/`）内；但 `vite build` 是 `.vue` 模板编译的必需判据，实测 `✓ built in 9.58s` rc=0。推送前仍按批次 A/B 的三层判据重跑打包链，使产物反映分支最终状态 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相同（`CHANGELOG.md 41/0`、`PRD 166/6`、`spec.md 37/0`、`tasks.md 1/1`）。`CHANGELOG.md` 仍为 `i/lf w/crlf attr/text=auto`，工作副本的 LF 警告属 checkout 转换，非内容改动 |
| 门禁读数（本批当场） | ✅ | `check-max-lines` domain=10148 ⇒「无新增超大文件，挂账清单与现实一致」；`check-locale-sync --cjk` 1175（基线 1331，无新增硬编码）、`--keys` 2173 全部存在于 zh/en、`--pair-base` PASS；`check-no-brand-residue` PASS（10145 tracked 文件）；`openspec-sync-check` OK: 387 tasks；`vite build` rc=0 |
| 本批未做（不冒充已做） | ⚠️ | 1.2（`AnnouncementBanner` 挂载 + top-inset 通道）仍待做，见上一节「本批未做」；阶段 2–5 全部待办 |

## 关联

- 上游审计：`01-docs/UX-AUDIT-2026-10-17.md`（merge `c57616b61`）
- 本批 PRD：`01-docs/PRD-UX-AUDIT-IMPLEMENT-2026-10-18.md`（显示项 / 交互 / 校验 / 提示文字全清单）
- 规格：`openspec/changes/ux-audit-implement/specs/desktop-ui-experience/spec.md`（9 条 Requirement）
- 设计取舍：`openspec/changes/ux-audit-implement/design.md`（D1 门禁先于复用、D2 作用域判据、D4 遮罩语义、D7 图标名）
- 进度：`openspec/changes/ux-audit-implement/tasks.md`（阶段 1 批次 B 与阶段 2–5 待办）
