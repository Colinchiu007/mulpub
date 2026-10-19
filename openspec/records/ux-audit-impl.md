---
record: ux-audit-impl
task: 按 UX-AUDIT-2026-10-17 §5 落地阶段 0 全部 + 阶段 1 批次 A（导航/快捷键/404/离线/陈旧看门狗/两条新门禁）+ 批次 B（试用横幅挂载、死全局注册清理、首运向导接回启动判定、帮助页可用化）+ 批次 C（1.1 暗色主题入口）+ 批次 D（1.2 公告横幅挂载与 top-inset 通道）；阶段 1 至此除 3.3 类产品决策外全部收口
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
| QM-1 打包 | ✅ 本批重跑并回读 | 本批只改渲染端（`src/**`）与视觉 runner 注释，不在 QM-1 触发面（`apps/desktop/electron/`、`packages/rpa-engine/`）内；但为使产物反映分支最终状态仍跑完整链：`node scripts/verify-worktree-deps.js` OK（11 项）→ `pnpm run build:vue` **VUE_EXIT=0** → `electron-builder --win --dir --publish never --config.electronDist=<worktree>/node_modules/electron/dist` **BUILDER_EXIT=0**（离线；唯一非致命告警 `.playwright-browsers` 缺 ⇒ 本产物不含捆绑 Chromium，如实记录为"安装包可用"证据的不完整）→ asar 产物判据 **13 条全 PASS**（`extractFile` 逐条读，不整树解包）：`dist\index.html` 可读、66 个 js chunk、命中 `dist\assets\index-pM5yYaCP.js` 含 `appearance-mode-`、打包 renderer 含「跟随系统」与 `ui:theme`、不含 `LoadingState`、preload bundle 含 `firstRunComplete` 且不含 `onFirstRunStatus`、`misc.js` 含 `first-run:complete`、`first-run.js` 含 `markDone` 且无 `function runSetup`、`electron/services/onboarding.js` 不在产物内 → 隔离 userData（`%TEMP%\mp-qm1-launch-c2`）启动：**ALIVE=true、STDERR_BYTES=0**（三层判据第③层）、`ELECTRON/ MULTI-PUBLISH` 进程计数 `0→0`、`PARENT_ENV_DEFECT=none`；只杀自己 PID |
| QM-1 现场副产（stdout，非本批引入，如实登记） | ⚠️ 发现两条真实缺陷 | 判据本体在 stderr（本次为 0 字节），但把子进程 stdout 落盘回读得 22490 字节，其中两类**既有**问题：① `Renderer [Unhandled Rejection]: 许可证权限不足，无法调用 onProgress` / `onTabEvent`（第 236/237 行）—— preload 的 `createPermissionError` 对 `authenticated` 级方法**同步 throw**，而订阅类调用点不 catch ⇒ 未激活态下标签系统的订阅静默失败并把错误演成 unhandled rejection（与 AGENTS.md「electron-bridge 权限错误同步 throw 变 rejected promise」同族）；② `sqlite-wrapper all() error: no such column: external_id | SQL: SELECT platform, external_id ... FROM viral_library` —— 建表与查询列不同源。两者都不在本批改动面内，本批不顺手修，已登记为后续任务 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相同（`CHANGELOG.md 41/0`、`PRD 166/6`、`spec.md 37/0`、`tasks.md 1/1`）。`CHANGELOG.md` 仍为 `i/lf w/crlf attr/text=auto`，工作副本的 LF 警告属 checkout 转换，非内容改动 |
| 门禁读数（本批当场） | ✅ | `check-max-lines` domain=10148 ⇒「无新增超大文件，挂账清单与现实一致」；`check-locale-sync --cjk` 1175（基线 1331，无新增硬编码）、`--keys` 2173 全部存在于 zh/en、`--pair-base` PASS；`check-no-brand-residue` PASS（10145 tracked 文件）；`openspec-sync-check` OK: 387 tasks；`vite build` rc=0 |
| 本批未做（不冒充已做） | ⚠️ | 1.2（`AnnouncementBanner` 挂载 + top-inset 通道）仍待做，见上一节「本批未做」；阶段 2–5 全部待办 |

## 阶段 1 批次 D：1.2 公告横幅挂载 + top-inset 通道（ux-audit-impl-d，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 本批范围 | 1.2 + 两条 CI 收红 | `view-bounds.js`（新增 4 个导出）、`webview-manager/{index,layout,ipc-handlers}.js`、`preload/page-manager.js`、`auth-view-manager.js`、`AnnouncementBanner.vue` 重写、`App.vue` 挂载、`locales/announcement/{zh,en}.js` 新建、`useOpsCenterRuntime.{js,test.js}` 收敛、`tests/e2e/helpers/{ipc-mock,route-functional-suite}.js` 收红、`views/NotFound.vue` 字体档 |
| 第一性原因（QM-5 ①） | ✅ | 不是"少挂一个组件"，而是**架构缺一层**：内嵌 `WebContentsView` 的位置由主进程镜像常量决定，渲染层从来没有"我多占了顶部多少"的通道。审计 §9 对 1.2 的原估算是"挂上去 + 登记 owner"，实测该写法会把常驻横幅当成模态浮层处理（挂起内嵌视图＝永久隐藏网页内容），因此本批按 PRD §9 已修正的口径实现 top-inset 通道 |
| 逃逸分析（QM-5 ②） | ✅ | ①**流程缺失**：没有任何判据看"渲染层新增常驻 chrome 是否同步了内嵌视图位置"（阶段 5.3 `check-ui-wired.js` 只覆盖组件引用面）；②**夹具不形**：E2E 的 `ipc-mock.js` 给 `firstRunCheck` 造了一个真实响应里**从来不存在的字段** `isFirstRun`，并把 `setupDone` 写成 `false` ⇒ 阶段 1.4 的引导判定按契约正确工作，却把 22 条路由全部重定向到 `/first-run`，E2E 因此在测"每一环都对、合起来全错"的东西；③**门禁时差**：`NotFound.vue` 的 `font-size: 40px` 是本 PR 阶段 1.7 新建，而 Gate 16 是合并 origin/main 之后才第一次被执行 ⇒ "我的文件早就绿过"不是证据 |
| 系统性漏洞定位（QM-5 ③） | ✅ | 具体到文件：`tests/e2e/helpers/ipc-mock.js` 的 mock 与被 mock 的真桥**不同形**（多字段 + 语义取反），属 AGENTS.md「契约夹具不得替对方剥壳」家族的**第四种落点：夹具凭空多带一个字段**。同批已把该通道改为逐字同形并按场景语义取值 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 4 个测试文件共 46 条：`view-bounds-top-inset.test.js` 18（数值口径，含"0 合法"这条与侧边栏方向相反的判据）、`webview-manager-top-inset.test.js` 17（接线 + 通道三处同步源锁 + "扫码视图不得收到"反向锁 + 挂起态不得写 bounds）、`AnnouncementBanner.test.js` 9、`App.announcement-inset.test.js` 2（装配锁）；既有强制面全跑：`overlay-view-suspension`/`shell-mode-6a`/`shell-mode-6b`/`webview-manager`/`auth-view-manager`/`view-bounds` = 164 条，另 33 条（`NotFound`/`SettingsDialog`/两条 App 装配锁） |
| 变异反证 | ✅ | **M4** 摘掉 `App.vue` 的 `<AnnouncementBanner @inset="onChromeInset" />` ⇒ 装配锁 **2 条全红**（`Tests 2 failed (2)`）；还原后 `md5sum` 与备份逐字节相同（`da61287e…`）、`grep -c "MUT-START"` = 0。本批累计四条（M1/M2/M3 见批次 C 行） |
| 防再犯（QM-5 ⑤） | ✅ | ①通道三处同步的源锁（ipc / preload / layout 任一缺失或改名不一致即红）；②"只有真的内嵌在主窗口的承载才接收下移"写进规格与代码注释，并用**反向锁**（断 `_qrCodeLogin` 上没有 `setTopInset`）而不是只写散文；③E2E 夹具改为与真桥同形后，`ipc-mock` 的注释里写明"取 true 的是场景语义"，防止下一次有人当默认值抄 |
| QM-1 打包 | ✅ 本批重跑 | 触发面命中（改 `apps/desktop/electron/` 下 6 个文件）：`verify-worktree-deps` OK → `build:vue` rc=0 → `electron-builder --win --dir` rc=0（唯一非致命告警 `.playwright-browsers` 缺 ⇒ 产物不含捆绑 Chromium）→ asar 产物判据 **12 条全 PASS**（layout/view-bounds/ipc/preload/auth 五处内容逐个读回 + renderer chunk 含 `announcement-banners`、`ui:theme`，每条前都先跑通路自证）→ 隔离 userData 启动 10 秒 **ALIVE=true、STDERR_BYTES=0、红线命中 0、进程计数 0→0、PARENT_ENV_DEFECT=none**；子进程 stdout 22461 字节按 §12.9 新口径一并回读 |
| 既有缺陷登记（不认领不掩盖） | ⚠️ 未修 | ①未激活许可证 + 全新 userData 首启时 `Renderer [Unhandled Rejection]: 许可证权限不足，无法调用 onProgress / onTabEvent`（同步权限错误无人 catch，标签系统订阅静默失败）；②`sqlite-wrapper … no such column: external_id`（`viral_library` 查询列与建表列不同源）。两条都不是本批引入（批次 C 已登记），修法需各自走 QM-5，本批不顺手改 |
| 门禁读数（本批当场） | ✅ | `check-font-size-scale` PASS（当前 32 / 基线 790）；`check-locale-sync --keys` 2178 全存在、`--cjk` **1171**（基线 1175，`SEVERITY_LABELS` 下线）、`--pair-base` 待提交后由 CI Gate 7 复验；`check-max-lines` 无新增超大文件；`check-css-var-defined` 当前 0 / 基线 64；`openspec-sync-check` OK 387 tasks；`vite build` rc=0 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相同（`CHANGELOG.md 50/0`）；`CHANGELOG.md` 仍 `i/lf w/crlf attr/text=auto`，LF 警告属 checkout 转换 |

## QG Visual 排红与基线重建（2026-10-18，人工批准后执行）

`QG Visual` 在 head `4a582f9c5` 红。像素六套全部 rc=0（`pixel=0 views=0 views-supplement=0 dark=0 workflows=0 workflows-supplement=0`），红在 **Gate 7b 基线新鲜度**：`first-run.png 10753 px (0.519%)`、`first-run-dark.png 11389 px (0.549%)`、`create-editor.png 78638 px (3.792%)`。

**逐条归因（不合并处理）**：

| 基线 | 判读 | 证据 |
|---|---|---|
| `first-run.png` / `first-run-dark.png` | **确定性漂移，且确为本 PR 引入**（批次 B 把向导四步改三步、删「自动安装 Python 依赖和 Playwright」的假承诺） | ① diff 图人工核对：红块正好是被删的第③步与旧大按钮、步骤圆点 4→3，无意外改动；② 两轮采集渲染**逐字节相同**（浅 `0a53363f…`、暗 `a62a53a9…`，`screenshots/` 与 `screenshots-round1/` 两目录 md5 一致）⇒ 不是抖动；③ 门禁自己的两轮甄别也把它判为「两轮都红」 |
| `create-editor.png` | **采集抖动，不由本 PR 负责，也不得借机重建** | 两轮渲染 md5 **不同**（`8358788d…` vs `b6284f58…`），且以 round1 渲染跑同一判据时 create-editor **不违规**（本地实测：round1 目录 40 张全等、0 违规）。CI 侧同样记为 `flake-confirmed（仅 round2 红）`，未计入阻断集 |

**处置**：经用户批准，只用**同一次 CI run 的渲染**重建 `first-run` 浅/暗两张（来源 run `39108747330` / job `117620328650` / artifact `quality-gate-visual-reports`，取 `screenshots/first-run.png` 与 `screenshots/first-run-dark-current.png`，`cp` 逐字节复制、不走 `test:visual:update-baseline` 本机重捕）。自证：`node scripts/check-baseline-freshness.js --renders=<artifact screenshots> --partial` 由「违规 3 张」降为**违规 1 张（仅 create-editor，抖动）**，first-run 两张已从违规集消失。`create-editor.png` **保持原基线不动**。

**登记一条残留**：`create-editor` 的采集抖动是既有的（AGENTS QM-4 排障顺序里「同态连拍互比」那一格），本批不修，但每次跑 Gate 7b 都可能随机红一张 —— 遇到时先做跨轮 md5 对照再决定是排红还是重建，**不得因为"红过"就顺手换基线**。

## CI 两处红的归因与处置（commit `0805c705c`，run `39115415826`）

**红 1 — `QG Desktop Shards (1/2)`：`Cannot find module '../electron/services/onboarding'`**
现场：`tests/onboarding.test.js:15` require 的模块由批次 B（`fc0ae40e7`）为收敛「第二个引导真源」
删除，专用测试未同步删除 ⇒ 悬空消费者，必红。处置：删该测试文件（AGENTS 既有口径「组件被删除时
同步删除其专用测试」），并在**同一次提交**删除 `scripts/check-blanket-fs-mock.js` 的欠账登记项
（销账与收敛必须同一次发生；本地实测这条门禁确实会同时报「陈旧登记」与「键指向不存在的文件」）。
连带：登记面由 9 → 8 触发该门禁自测的「判据域 ≥12 样本」下界报警，处置是补一个**真实存在且
tracked 已核实**的样本（`electron/services/first-run.test.js`），**没有**把下界从 12 降到 11。

**红 2 — 9 次 unhandled rejection：`No "invokeWithFallback" export is defined on the "@/api/electron-bridge" mock`**
链路：`App.vue` → `AnnouncementBanner`（onMounted **不 await**）→ `useOpsCenterRuntime.loadRuntime`
→ `opsCenterSyncRuntime` → `invokeWithFallback`。实测有 19 个套件把该桥 mock 成部分形状，
读缺失导出即抛 ⇒ 凡挂载壳层的套件各收到一次无人处理的拒绝。处置收在**共用出口**而非逐个补夹具：
`loadRuntime` 自带 try/catch，按其文档头既有语义「未拉取到即为空（静默）」返回
`{code:-1, message:'runtime_read_failed'}`，并 `console.warn` 一次（静默 ≠ 不出声）。
回归锁判据是 **promise 必须 resolves**（不是"有没有日志"），见 `useOpsCenterRuntime.test.js` 新增那条。

**取证（当场实跑，非引用）**：`node --test scripts/check-blanket-fs-mock.test.js` → tests 21 / pass 21 / fail 0；
`node scripts/check-blanket-fs-mock.js` → PASS；`node scripts/check-unwired-tests.js` → OK（107 个文件）；
`vitest useOpsCenterRuntime + AnnouncementBanner` → 13 passed。
控制对照按「备份 → `git checkout HEAD -- 单文件` → 同一条命令 → 还原」执行，两侧 md5 唯一值 1；
HEAD 版红「真实仓库棘轮」、修改后红「域样本 ≥12」，两轮红**互不相同**这一点本身定位了下界问题。

## 第 4 轮 re-sync（origin/main 落后 49 个提交，merge `9048ae428`）

冲突 7 个文件：`CHANGELOG.md`、`01-docs/learnings.md`（两块都是**追加型写面** ⇒ 取并集）
与 5 个代码文件（`preload/page-manager.js`、`auth-view-manager.js`、
`webview-manager/{index.js,ipc-handlers.js,layout.js}`）。

**代码文件没有用并集解，改走「取 main 为底 + 重放我这侧的小改动」**。判据是本 PR 在这 5 个文件里
只写了 2/19/4/9/31 行，而 main 写了 25/27/34/8/109 行——把大的一侧当底、把小的一侧重新落上去，
结构由人一次核过；反过来做要核对的是 109 行那一侧，漏检面积大一个量级。
这一点是**上一轮实测逼出来的**：追加型解冲器在 `ipc-handlers.js` 把 main 的
`set-sidebar-collapsed` handler **整块插进了我这侧 `set-top-inset` handler 的 `try` 里**
（函数体中途出现另一个 `ipcMain.handle(...)` 调用 + 悬空的 `} catch`），
`node --check` 之前它长得完全像一段合法代码。此后凡两侧都在同一函数体内追加的冲突，
一律手工合成，不接受机械并集。

**两个特性的交汇点（本次唯一有语义合并量的地方）**：`computeEmbeddedViewBounds`
的第三参（本 PR 的 top-inset，决定 y）与第四参（main 的 `sidebarCollapsed`，决定 x）正交，
但两侧各自写的调用行**长得不同**，并集会留下"同一个 view 连着 `setBounds` 两次、
第二次覆盖第一次"的形状。三处收成一次调用同时传两参：
`layout.js:_repositionAll`、`auth-view-manager.js:_positionView`；
`view-bounds.js` 的 4 参签名由 main 与本地自动合并得到，实测
`grep -n 'function computeEmbeddedViewBounds'` = 单一定义。

**双向行级包含校验**（`mw-merge-verify.cjs`，两侧各自的新增行必须都出现在结果里）：
5 个代码文件中 3 个报 missing，逐条核对**全部是"两侧都改过的同一行被合成为一行"**
（import 行合成超集、`setBounds` 调用合成一次、`undefined` 实参换成
`contentTopWithInset(this._topInset)`），不是丢失；`CHANGELOG.md`/`learnings.md`
两侧 95/187/57/380 行全部命中。校验脚本把「缺失」打印出来而不静默放行，
是因为"合成"与"丢失"在这一格里同形——只有逐条读才能分开，所以必须逐条打印。

**re-sync 暴露的两处本 PR 自己的问题**（不与清理混做，但必须本轮修掉才能过门禁）：

1. `App.vue` 合并后 **509 行 > 500** ⇒ `check-max-lines` 报 `NEW_OVER_LIMIT`。
   main 那侧 479 行是登记内的，我这侧新增的装配代码（横幅 `@inset` 上报 + 折叠多窗口同步）
   把它推过线。**没有**调高阈值、**没有**把 `App.vue` 加进挂账清单，
   而是按 AGENTS 的正解抽成 `src/composables/useAppShellChrome.js`（壳层 483 行）。
   抽出后行为逐字不变，由真挂 `App.vue` 的 `App.announcement-inset.test.js` 与
   `App.sidebar-collapse.test.js` 守住——这两条用例是"抽出没抽坏"的唯一证据，
   读源码的结构性断言在这里证明不了任何东西。
2. `App.announcement-inset.test.js` 的 `window.electronAPI.pageManager` 夹具**缺**
   `onTabEvent` / `subscribeEvents` / `unsubscribeEvents`：main 侧 `App.vue` 现在在
   `onMounted` 里 `tabStore.init()`，而 `stores/tab.js:154` 走的就是这三个方法。
   症状是 **`Test Files 5 passed` 与 `Errors 4` 同屏**、用例名里完全没有它们
   ——只数通过数就会把它读成通过。夹具按真实桥同形补齐（对齐 main 的
   `App.sidebar-collapse.test.js` 已有形状），并在使用处写明这条教训。

**连带**：`useOpsCenterRuntime.js:29` 的 `console.warn` 中文文案被
`check-locale-sync.js --cjk` 判为"渲染端新增硬编码中文"（本 PR 上一批刚把同类问题
收成 ASCII，这一条漏跑判据）。改为 ASCII 文案，日志语义不变。

**取证（当场实跑）**：`node .github/scripts/check-max-lines.js` → PASS（超限 95 / 挂账 95，无新增）；
`check-locale-sync.js --keys` → PASS（2180 key 成对）；`--cjk` → PASS（基线 1331 / 当前 1168）；
`check-css-var-defined.js` → PASS；`check-font-size-scale.js` → PASS；
`check-no-brand-residue.js` → PASS；`check-doc-abs-paths.js` → PASS；
`check-unwired-tests.js` → OK（110 个文件）；`check-no-conflict-markers.js` → PASS
（8 处标记行全部带原因登记且不超基线）；
`node scripts/verify-worktree-deps.js` → OK；
`vitest run` 受影响的 14 个文件（webview-manager-top-inset / webview-manager / auth-view-manager /
oauth-manager / qrcode-login / page-manager.sidebar-collapse / window / view-bounds /
view-bounds-top-inset / App.announcement-inset / App.sidebar-collapse / sidebar-collapse-chain /
stores.sidebar-collapse / **新增 useAppShellChrome**）
→ **354 passed / 14 files，零 unhandled error**。

**抽出这一步的反证（两条，红集互不相同，还原后 md5 与备份逐字节一致 `app=c7bee979` / `chrome=f4d74198`）**：

| 变异 | 指名变红的用例 | 结果 |
|---|---|---|
| N1 `App.vue` 把 `useAppShellChrome({ isHomeShell })` 的解构换成 `const onChromeInset = () => {}`（**取规则明文禁止的那个形态**："抽出后接线丢失"，而不是随便删一行） | 接线锁 + `App.announcement-inset` 2 条 + `App.sidebar-collapse` 5 条（挂载订阅 / 广播应用 / v-show 跟随 / 卸载退订 / 启动补报） | **CAUGHT**（8 红 / 18，基线同域 18 passed 且 red=0） |
| N2 composable 里 `pm.onSidebarCollapsedChanged(...)` 改成 `void pm.onSidebarCollapsedChanged`（订阅注册被摘掉，其余不动） | `useAppShellChrome` 的"订阅广播落到真实 store"+"卸载必须注销" + `App.sidebar-collapse` 同族 4 条 | **CAUGHT**（6 红） |

两条各证一侧：**N1 证"抽出没把电抽丢"**（App 侧装配锁真有牙），
**N2 证"新模块的订阅不是装饰"**（composable 自己的锁测的是它声称的那一格）。
基线一趟先跑并断言 `red=0` 才允许解读变异结果——否则"红了"分不清是变异造成的还是本来就红。

**新增回归锁 `src/composables/useAppShellChrome.test.js`（9 条）**：导出完整性（模板只需要
`onChromeInset`）、上报值原样透传、**0 必须上报**（0 是收口态不是非法值）、主窗口实例挂载补报
持久化折叠态且不改内存态、`isHomeShell` 实例不得上报、广播落到**真实 store**、
回环防护判据写成「广播后没有**新增**上报调用」而不是「总共为 0」（挂载那一次是合法调用——
这条期望最初写错，读实现后改正期望、没动实现）、老桥未暴露该方法时静默跳过、卸载必须注销，
以及接线锁（`App.vue` 必须 import + 解构，且**不得**再出现 `invokePageManager('setTopInset'` /
`onSidebarCollapsedChanged` / `applyRemoteCollapsed` —— 两份口径必然漂移）。
夹具只 mock `@/api/electron-bridge`，`@/stores/sidebar-collapse` 用真实实现。

## 第 5 轮 re-sync（落后 1 个提交 `9fffea446`，PRD-UI-FLOW-CLARITY S1/S2）

只有 2 个文件冲突，但这一轮是**两个特性抢同一格 chrome** 的语义交汇，不是行尾冲突：

- `App.vue`：本 PR 把 `<AnnouncementBanner>` 插在 NavBar 之下、`<MpModuleNav v-if="isHomeTab">`
  之上；main 的 S1b **整块删掉了 MpModuleNav**（账号域 tab 迁到 `Accounts.vue` 页内 tablist）。
  机械并集会得到「横幅 + 已删组件的引用」并存。合成结果：保留横幅 + 采纳删除说明，
  并把横幅位置的旧措辞「模块导航之上」改成「主内容区之上」（那层已不存在，留着就是假注释）。
  **叠加后果写进注释**：公告横幅占用的正是被删掉的这一格，所以顶部下移量必须由横幅实测后经
  `setTopInset` 如实上报、不得回到镜像常量 —— 两个特性各自成立不代表叠加后仍成立。
- `config/route-registry.js`：本 PR 在 `/publish` 条目前插入 NotFound catch-all；main 就地改写了
  `/publish` 的注释与 `navEntry/internal/entryFrom`（S1d 语义修正）。解法 = **保留我的整条新记录**
  ∧ **整段采纳 main 对 `/publish` 的新语义**（我那句「菜单发布指向 /publish/history，由 T1 处理」
  已被 main 落地，留着就是过期陈述）。

**QM-1 本轮不重跑的判据**（按「昂贵验证要不要重跑＝集合交集」口径）：入站 59 个文件里
`apps/desktop/electron/**` 与 `packages/rpa-engine/**` 命中 **0**
（`git diff --name-only $(git merge-base HEAD MERGE_HEAD) MERGE_HEAD | grep -cE '^apps/desktop/electron/|^packages/rpa-engine/'`
= 0），electron 树与 `ea6271d4a` 那次已实测 PASS 的产物逐字相同 ⇒ 沿用该证据，不做无谓重建。

**取证（当场实跑）**：`check-route-registry.js` PASS（37 路由 / 22 菜单 / 12 暗路由）；
9 项静态门禁全 rc=0（max-lines 无新增超限、locale keys 2182 成对、CJK 1144 < 基线 1331、
css-var、font-size、brand-residue 10608 文件、doc-abs-paths、unwired-tests 110 文件、
no-conflict-markers 标记行 8 全部带登记）；
`vitest run` 交汇面 11 个文件 → **394 passed / 11 files**
（App.announcement-inset / App.sidebar-collapse / App.theme-boot / useAppShellChrome /
sidebar-collapse-chain / tab-independent-home（含 S1b「MpModuleNav 不得复活」结构锁）/
Publish / Collection / Accounts / useOpsCenterRuntime / AnnouncementBanner）。

## 第 6 轮 re-sync（origin/main 落后 8 个提交，merge `0c9c6aaab`）

- **为什么用 merge 不用 rebase**：本分支有 20 个提交，`git rebase origin/main` 在第一刀就撞
  `config/route-registry.js` —— 撞的是**注释与路由对象混在同一个 hunk** 的形态（HEAD 侧是主干对
  `/publish` 语义改位的注释，我侧是新增的 `NotFound` 兜底路由 + 旧注释）。逐个提交重放会把同一处冲突
  付 20 遍；`git merge origin/main` 一次就把 68 个主干改动并进来，且 `route-registry.js` 在合并态**自动合上了**
  （rebase 的分叉点不同才撞）。这是本仓「多提交改顶部时用 merge 不用 rebase」同一条判据。
- **唯一冲突是 `CHANGELOG.md` 顶部**：一个 hunk（`mine=128 / theirs=7`，两侧都非空 ⇒ 分桶正确）。
  解法 = 两侧逐字并集（`split('\n')` 保留每行自身 `\r`、只删 3 行标记、`join('\n')`），
  对账 **vs HEAD `34 0` / vs origin/main `128 0`，且 `--numstat` 与 `-w --numstat` 两口径逐字相同**（双向纯插入）。
- **验证范围取「变更集交集」而不是「我改过的文件」**：交集只有 5 个文件
  （`01-docs/learnings.md`、`CHANGELOG.md`、`locales/publish-page/{zh,en}.js`、`stores/publishProgress.js`）
  ⇒ 交汇面跑 `stores/publishProgress.test.js` + `components/PublishProgressPanel.test.js` + `views/Publish.test.js`
  = **180 passed / 3 files**。另有一条**不在交集、但冲突就落在它身上**的：`config/route-registry.js` 虽被自动合上，
  仍跑 `.github/scripts/check-route-registry.test.js` = **14 passed**（登记表与侧边栏一致性由它守）。
  `check-locale-sync --pair-base origin/main` 与 `--cjk` 均 PASS。
- **语义回读（自动合上 ≠ 合对）**：两条不变式当场核 —— ① `NotFound` 兜底路由仍在（`grep -c NotFound` = 2）；
  ② `/publish` 的 `navEntry.to` 仍指 `/publish`（主干的 S1d 语义改位没被我这一侧的旧注释带回去）。
  两个 JS 文件 `node --check` 通过。
- **如实记一条路径差异**：rebase 下 `route-registry.js` 会红，merge 下它自动合上了。我选后者并靠回读断言兜底；
  若主干继续在这个文件上高频变动，下一轮可能换 rebase 更省 —— 判据是「同一处冲突要付几遍」，不是「哪个命令更标准」。

## 关联

- 上游审计：`01-docs/UX-AUDIT-2026-10-17.md`（merge `c57616b61`）
- 本批 PRD：`01-docs/PRD-UX-AUDIT-IMPLEMENT-2026-10-18.md`（显示项 / 交互 / 校验 / 提示文字全清单）
- 规格：`openspec/changes/ux-audit-implement/specs/desktop-ui-experience/spec.md`（9 条 Requirement）
- 设计取舍：`openspec/changes/ux-audit-implement/design.md`（D1 门禁先于复用、D2 作用域判据、D4 遮罩语义、D7 图标名）
- 进度：`openspec/changes/ux-audit-implement/tasks.md`（阶段 1 批次 B 与阶段 2–5 待办）
