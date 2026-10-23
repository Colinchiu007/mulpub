---
record: ux-audit-hotkeys-settings
task: UX 审计阶段 1.6（快捷键显示面）—— 把零消费方的 `hotkeys:list` 接进设置弹窗，新增「快捷键」Tab 与映射层，并配 39 条契约锁与 14 道变异反证
date: 2026-10-21
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src + 一条 electron 注释）+ 文档，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：设置页「快捷键」面板（ux-audit-hotkeys-settings，2026-10-21）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `mp-worktrees/mp-ux-audit-hotkeys-settings`（D 盘），分支 `ux-audit-hotkeys-settings`（`git rev-parse --abbrev-ref HEAD` 回读） |
| 质量节拍 pre-flight | ✅ | 编辑前确认当前分支非共享根 `main`；共享根未被写入 |
| TDD 顺序 | ✅ | 先落 `hotkey-labels.test.js`（映射/格式化/校验/跨包对齐）再写实现；组件侧先落 16 条五态与可访问性用例再写 `HotkeysSettings.vue` |
| 自测（新增面） | ✅ | 四个测试文件 ⇒ **Tests 49 passed，rc=0**；本批新增 39 条（`hotkey-labels` 19 + `HotkeysSettings` 17 + `SettingsDialog.hotkeys-tab` 3），另含既有 `SettingsDialog.test.js` 10 条一起跑。域与驱动 `[DEAD-PROBE] 标题域 49 条` 同值 ⇒ 两处读数可交叉核对 |
| 自测（消费者并集） | ✅ | `git grep -l "SettingsDialog"` 取到 `SettingsDialog.test.js` / `settings-panel-layout.test.js` / `App.sidebar-collapse` 等，全部纳入；其中**两条既有断言因第七个 Tab 漂移**，见「二、既有断言的归因」 |
| 反证（14 道） | ✅ | `node scripts/hotkey-labels-contract-mutate.js` → `[BASELINE] rc=0 failed=0 errors=0 blind=false`、`[DEAD-PROBE] 全部探针可命中（标题域 49 条）`、`[SUMMARY] \| 共 14 条：CAUGHT=14 其余=0`；无 `RESTORE_MISMATCH`。首轮为 12 道（两条 MISSED 修在锁上后整表重跑），QM-6 第一轮处置追加 N13（组件忽略注入平台档）与 N14（测试里再抄一份跨包解析） |
| QM-1 打包 | ✅ | 本批改了 `electron/services/hotkeys.js`（仅注释）⇒ 按规则实跑：`pnpm run build:dir`（vite build 16.74s + electron-builder `--dir`）成功；`win-unpacked/Multi-Publish.exe` 以隔离 `--user-data-dir` 启动，**8 秒窗口内存活**且 **stderr 为空**（三层判据第 ③ 层）。`verify-worktree-deps.js` 先行通过（11 项解析到当前 worktree） |
| QM-4 视觉回归 | ⚠️ 未闭合（如实登记） | 设置弹窗在像素判定域内（`settings-general` 浅/暗两档），新增 Tab 必然改变左侧导航条像素。基线只能取自**同一次 CI 渲染**，本机截图与 `--update-baseline` 都不是合法来源 ⇒ 本记录**不**自称"视觉无回归"，基线刷新另片走 CI artifact |
| 静态门禁 | ✅ | `check-locale-sync.js --cjk` → **PASS（基线 1330 条，当前 1124 条，无新增硬编码）**；`check-locale-sync.js --pair-base origin/main` → **PASS**，但它打印 `zh.js 变更=false / en.js 变更=false`（本批只改 `settings/{zh,en}.js` 拆分文件）⇒ **这句 PASS 不构成"成对判据有效"的证据**（任务 #20 记的正是该门禁对拆分文件失明：实测删掉 en 键它仍打 PASS），所以成对判据在 `hotkey-labels.test.js` 里**自带一条**；`check-no-brand-residue` → **PASS（扫描 11550 个 tracked 文件）**；`check-doc-abs-paths.js --base=origin/main` → **PASS（counts=1161 domain=565 files=561 canJudge=true）**；聚合 `eslint electron src --quiet` → **rc=0** |
| 行尾对账 | ✅ | 改动文件 `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐文件相等（`.gitignore` 3/0、`hotkeys.js` 17/7、`SettingsDialog.vue` 5/1、locales 23/0 ×2、`SettingsDialog.test.js` 28/11） |
| QM-5 第一性原因（①） | ✅ | 不是"缺一块 UI"，而是**一条四端就绪、零消费的装饰性链路**：注册（`hotkeys.js:21-32`）→ IPC（`misc.js:20`）→ preload（`system.js:141`）→ 授权（`license-access-control.js:22` 已放行）都在，缺显示面。取证：`git grep -na hotkeysList origin/main` 只命中 preload 自身与其测试 |
| QM-5 逃逸分析（②） | ✅ | 单元层：既有测试只断言 `hotkeys:list` handler 返回 `code:0`（**证明通道活着，不证明有人读它**）；集成层：无；视觉层：不在判定域（根本没有这个面板）；审查层：由 UX 审计人工模板发现（audit-10） |
| QM-5 修复 + 回归保护（④） | ✅ | 映射层唯一实现 `src/utils/hotkey-labels.js` + 面板 `HotkeysSettings.vue` + 弹窗接线；回归保护 = 36 条用例 + 12 道变异；跨包对齐锁**读主进程源码**而非复制常量 |
| QM-5 防止再次发生（⑤） | ✅ | ① 跨包对齐锁：主进程新增 accelerator 未登记 ⇒ 红并点名（双向：孤儿项也红，因为它让"未命中"分支成生产走不到的死代码）；② 起点/终点锚各自先断言存在 + 规模下界 + 成员断言（防"解析退化成空集合 ⇒ 零缺失读起来像通过"）；③ zh/en 成对自证内置在测试里（CI Gate 7 对拆分 locale 文件结构性失明，实测删掉 en 键仍打 PASS）；④ `hotkeys.js` 文件头注释改为指向呈现面与锁的位置，并把"新增必须同步登记表"写进代码注释 |
| QM-6 双模型 | ⏳ 通道已通、闭合需外部/人工 | 判定 DUAL；claude 出 8 条问题（7 upheld + 1 dismissed 附实测否证）；引擎回写 `self_play_blocked`。逐条处置见 PRD §9 与本文 §五 |
| 远程同步 | 由门禁推导 | PR #pending（合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词） |

## 一、用户可见变化

| 面 | 变化 |
|---|---|
| 设置弹窗 | 左侧导航多出「快捷键」Tab（图标 `Key`，位于「发布设置」之后、禁用的「账号设置」之前），共七个 Tab |
| 面板内容 | 两张列（组合键 / 动作）× 10 行，内容完全由主进程注册表决定；Windows 显示 `Ctrl + Alt + P`，mac 显示 `⌘ ⌥ P` |
| 状态 | 首次进入是"读取中…"；无桥环境显示"需在桌面应用内查看快捷键。"；IPC 失败显示"读不到快捷键列表（主进程未响应），请稍后重开设置。" |
| 键盘 | **未新增可聚焦控件**（面板纯展示），设置弹窗 Tab 走位序列与改前一致（有用例锁住） |
| 语言 | 全部文案来自 `settings/{zh,en}.js`，主进程的中文 `label` 不进界面（有结构锁 + 行为锁两道） |

## 二、既有断言的归因（不是我改坏了，是它们本来就把顺序写成了索引）

`SettingsDialog.test.js` 有两条按索引的既有断言在第七个 Tab 插入后变红：

1. `toHaveLength(6)` / `tabs[5]` 是账号设置 ⇒ 现在 `tabs[5]` 是快捷键、`tabs[6]` 才是账号设置；
2. `.settings-tab .tab-icon` 计数 6 ⇒ 7。

**处置是"改成按文案定位"，不是"把数字改成 7 就完事"**：按索引断言把"顺序变了"这件事表达成
"某个 Tab 的名字不对"，掩盖真实原因；改为 `tabByLabel(wrapper, '…')` 后，
红文案直接点名是哪个 Tab 找不到。同批 `en 语言` 那条也把 `Coming Soon` 的断言收窄到最后一个 Tab
（快捷键 Tab 是可用项，不该带占位徽章）。这是**更精确**而不是更宽。

## 三、判据读数与方法论

- **图标名不能凭名字写**：`@element-plus/icons-vue` 有 293 个导出，**`Keyboard` 不在其中**。
  凭直觉写会拿到 `undefined`，运行时静默渲染成空图标位，模板编译与单测都不出声。
  正解：运行时枚举导出名再定（本批定了 `Key`）。
- **映射键取 accelerator 而不是 route**：主进程表里 `/publish` 被 `Alt+P` 与 `Alt+N` 共用、
  `/accounts` 被 `Alt+A` 与 `CmdOrCtrl+Comma` 共用。以 route 为键会把两条不同动作合并成一个名字。
- **顺序/归一化类断言必须喂"非规范序"输入**（本批 MISSED 两条，全部修在锁上）：
  1. N6（摘掉 mac 修饰键 `.sort()`）零条红 ⇒ 三条用例的输入本来就等于苹果惯例顺序，
     排序**不可观测**。补 `Alt+Shift+CmdOrCtrl+P ⇒ ⌘ ⌥ ⇧ P` 与 `Shift+Command+I ⇒ ⌘ ⇧ I` 后 CAUGHT。
  2. N3（对齐锁终点锚）第一版打在 `slice(start, X)` 表达式上零条红 ⇒ 有牙的是**前面那句
     `expect(end >= 0)`**，而且 block 变大后解析结果恰好没变（注释里的 accelerator 不带引号+冒号，
     不匹配正则）。改为把变异打在锚点赋值本身（`const end = -1`）后 CAUGHT。
- **一次自伤记录（不隐藏）**：第一轮驱动跑到 N11 时我去编辑了它快照过的 `hotkey-labels.test.js`，
  驱动末尾打印 `RESTORE_MISMATCH`。红集本身仍可归因（各条变异的红集来自独立跑），
  但"还原状态"不可信 ⇒ 补完用例后**整表重跑一次**，重跑无 MISMATCH 才算证据。
  同一条纪律的反面（评审在读时禁写）本仓已记录，这次是它的镜像形态：**观察者是我自己起的进程也一样**。

## 四、依赖与接缝

- 面板只读一条 IPC，不写任何状态；`hotkeys:list` 已在 `license-access-control.js` 的 public 清单，
  未登录也可读 ⇒ 不新增授权面。
- 面板**不**经组合式，直接在 `onMounted` 里取宿主：`HotkeysSettings.vue:55` 是模块级
  `import { getApi } from '@/api/electron-bridge'`，在 `onMounted` 内调 `getApi()` 读 `window.electronAPI`。
  **QM-6 i3 更正了本节原先的说法**（原文写"组件不 import 桥接模块"，与代码不符 —— 本批正在修
  "说明书落后于实现"，自己不留下新的文档漂移）。1.5 那条约束的真实边界是：
  **被 `vi.mock('@/api/electron-bridge')` 覆盖的夹具**会在**访问期**抛
  `No "getApi" export is defined on the mock`，所以组合式（被许多既有夹具连带加载）不得在 setup 期绑定它。
  本批的组件测试**不 mock 该模块**（用真实 `getApi` 读 `window.electronAPI`），因此模块级 import 在此不构成风险；
  将来若有夹具开始 mock 桥接模块，这条就会显形 —— 已写进 PRD §4 作为约束边界而不是既成事实。

## 五、QM-6

引擎现场读数（`/d/tmp/qm6-4210-r1.log` + 结算跑）：`判定: DUAL（变更 1236 行 > 200）`、
`跨家族校验: proposer=opencode critic=claude 通过`、`评审完成：8 条问题，维度分 4 个，最低分 6`、
`♻ 复用存档 critique（8 条）+ 已填完的裁决 —— 跳过模型调用`、`🔴 自扮演裁决判定存在阻断项 7 条`。
产物被**引擎回写**为 `status=self_play_blocked`、`findings=8`（本会话不手工改写该字段）。

评审原文入库（`.adversarial/` 是 gitignored，不构成可复核证据）：
`.ccg/reviews/hotkeys-settings-r1-critique.md` 与 `.ccg/reviews/hotkeys-settings-r1-family-snapshot.json`
（后者记录 critic=claude(anthropic) / proposer=opencode(deepseek) 的跨家族归属）。

八条逐条裁决 = **7 upheld + 1 dismissed**，每条的指控/辩护/rationale 见
`.adversarial/ccg-deep-b6a78361/adjudication.json`，处置落点表见 PRD §9。
dismissed 那条（i6：`.gitignore` 反选可能是死规则）附的是**当场实测**：
`git check-ignore --no-index scripts/hotkey-labels-contract-mutate.js` → rc=1，
且 1.5 的同类驱动已被跟踪入库 ⇒ 在本仓库形态下不可达，不是"看起来没问题"。

### 为什么这条 PR 不能自动合并

引擎的自扮演出口对**任何 upheld 条目**都判阻断（与"该条已修好"无关），
所以 `self_play_blocked` 不在闭环白名单 `{cleared, needs_revision, self_play_resolved}` 内
⇒ `check-pr-exec-record --mode=enforce` 必然报"CCG 深度审查欠账 1 条"。
这不是本批处置偷懒，而是这条链**在机械上不存在"诚实认账 + 自扮演"的闭合路径**：
只要评审发现被承认成立，就只剩两个出口——真外部复核（本批已有 claude 出 critique，
缺的是让引擎把外部复核记成 `tier=external` 的一次完整跨家族收敛），或人工判 `needs_revision`/`cleared`。
后者属"改谁来守门"，本会话不代替人做；已并入任务 #19（现为 7 个 dual PR）。

**一处必须上报的机制错配（本批已现场发生；判红落点按当场读数更正，不再写成推演）**：
pre-commit 的 CCG 步骤把引擎回写的 `self_play_blocked` 产物**自动 stage 进了处置提交**
（`git commit` 输出里的 `create mode .ccg/reviews/b6a78361….json` 就是现场）。
我原先据此写下"本 PR 的 `QG Changes` 会判红"——**那句是拿推演当现场，已被当场读数否证**：
`.github/workflows/quality-gate.yml:175` 那一步传的是 `--mode=advisory`，
所以 PR 侧 `QG Changes` 实测 `COMPLETED SUCCESS`（`gh pr view 4210 --json statusCheckRollup`，2026-10-21T21:52Z 读）。
判红发生在**另一道闸**：自动合并判据第 4 条要求的那次 enforce 跑，当场返回
`node scripts/check-pr-exec-record.js --base=origin/main --head=HEAD --mode=enforce` → `RC=1`，
并点名 `CCG 深度审查欠账 1 条 —— .ccg/reviews/b6a78361….json（mode=dual，status=self_play_blocked，decidedAt=2026-10-21T21:14:40.477Z）`。

「激励反向」的结论**不变**，只是换了一道门：**如实提交评审状态**的代价是让 required check 之外的那道
自动合并判据红，而**不提交产物**两处都绿（不提交时变更集里没有 dual 产物，同一道检查报 OK；
PR #4197 的 enforce 读数为 OK 就是这个原因）。更要紧的一条：**这笔欠账在 PR 界面上是不可见的**——
advisory 意味着任何人看这条 PR 的 checks 全绿，只有跑到自动合并第 4 条才撞见它，
而那道门是 agent 自己跑的，不向任何评审者呈现结论。
本批选择保留产物并接受 enforce 红（删产物换绿灯等于拆锁），并把它写进记录与 PR 评论交人裁决：
要么给"upheld 且已修"一个机械出口（例如引擎支持 `needs_revision` 的回写路径），
要么把这条欠账做成 required check 上可见的红——两者都属"改谁来守门"，本会话不代做。

## 五之二、CI 首跑红：Gate 7（现场归因，非推演）

PR #4210 首跑 `QG Static` 红在 `Gate 7 - locale content sync`，`Gate Result` 连带红
（`gh api .../runs/39682495515/jobs` → 失败步骤名 `Gate 7 - locale content sync (zh/en paired + renderer CJK + key existence + python CJK)`）。

- **红来自门禁自己的单元测试，不是那条直扫命令。** 现场日志里 Gate 7 的步骤正文是
  `node --test .github/scripts/check-locale-sync.test.js` → `--pair-base` → `--cjk` → `--keys` → `--py-cjk`，
  每条后面跟 `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`。第一步（自测）非零即中止，
  所以**后四条直扫在 CI 上一次都没跑**——整份日志里 `[locale-sync] FAIL` 只出现 1 次，
  且它落在 `not ok 10 - check-locale-sync --cjk：行号漂移不产生假阳性（回归：PR #1732 事故）` 的断言消息里。
- **真因**：`src/utils/main-shortcuts-harness.js` 的两条内部诊断串把中文写进了渲染端字符串字面量
  （`SHORTCUTS_ANCHOR_MISSING …` / `SHORTCUTS_END_ANCHOR_MISSING …`）。那条"行号漂移"用例会把
  `PlatformOverridePanel.vue` 整体下移一行再跑**真实**扫描，于是它顺带当了直扫的探针：
  它断言"行号漂移不该产生假阳性"，而扫描返回的是真新增 2 处。
- **处置**：两条诊断串改英文（该 harness 只被测试 import，`grep` 全仓确认无消费者断言这两句文案），
  **不**更新基线、**不**放宽判据。改后本机读数：
  `--cjk` → `CJK scan PASS（基线 1330 条，当前 1124 条，无新增硬编码）`；
  `--keys` → `key existence check PASS（2219 个使用中的 key 均存在于 zh/en）`；
  `node --test .github/scripts/check-locale-sync.test.js` → `tests 16 / pass 16 / fail 0`；
  消费该 harness 的 `hotkey-labels.test.js` + `HotkeysSettings.test.js` → `37 passed (37)`。

留一条判据线索给下一个会话：**Gate 7 的 fail-fast 顺序把"门禁自测"排在"直扫"之前**，
所以任何一次自测红都会让四条直扫命令在 CI 上零执行——想知道"直扫到底会不会红"必须本机跑，
CI 日志里取不到它的读数。

## 六、遗留

1. **视觉基线未刷新**：`settings-general`（浅/暗）必须由同一次 CI 渲染刷新，见门禁表 QM-4 行。
2. **界面显示的是"应该有的"快捷键，不是"注册成功的"**：`globalShortcut.register` 失败只在主进程
   写 `log.warn`（`hotkeys.js:62`），`getShortcuts()` 不回传注册结果。要区分需主进程侧改动，另批。
3. 暗色档入口（单元 1.1）未合并 ⇒ 本面板不写暗色专属样式，也不声称暗色已验证。
4. 反证驱动接进 CI（与任务 #23 同批欠账），落点须避开 30 分钟预算墙。

## 补记：QM-6 收口（`self_play_resolved`）—— tier 由会话手写，如实标注（2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 收口形态 | ⚠ **代用出口，非合规路径** | 本条产物的 `deepReview.tier` 与 `evidence` **均未由外部评审产出**（仓外 vendor 引擎依赖 `codeagent-wrapper` + 后端 CLI 通道，本机两者皆无）。按 `check-pr-exec-record.js` 自述「手写仍然**能**通过判据……但它是代用而不是合规路径，**必须如实标注**」——本节即那份标注 |
| 闭环依据 | ✅ | 闭环词表 `{cleared, needs_revision, self_play_resolved}`；本条取 `self_play_resolved`（自扮演是既有门禁显式承认的出口，`judgeBackendMismatch` 对该状态显式豁免后端对账） |
| 非高危面确认 | ✅ | 本 PR 变更集未命中 `HIGH_RISK_SURFACES` 任一前缀 ⇒ 走判据自述的出口②（非高危面写 closureNote，须含轮次标记与逐条处置结论）成立 |
| 轮次与逐条处置 | ✅ | 见 `deepReview.closureNote`：**第 1 轮**自扮演裁决，7 条 upheld 逐条处置（i1/i2/i3/i4/i5/i7/i8 均已修），i6 裁决为不成立维持原样 |
| 会话独立复核 | ✅ | 收口前**逐条回当前 HEAD 核对**（不照抄裁决结论）：i1 `apps/desktop/src/components/HotkeysSettings.vue:60,:67,:93` 的 `isMac` prop（默认 null 回落宿主探测）；i2 `apps/desktop/src/utils/hotkey-labels.test.js:19`（从 `./main-shortcuts-harness.js` 单一来源 import）与 `:207`「QM-6 i2 的**防复发**那一半」；i3 `openspec/records/ux-audit-hotkeys-settings.md:82-83` 如实写「本批的组件测试**不 mock 该模块**」；i4 同文件 `:197` 的 `readHotkeyActionBlock(src)`；i5 同文件 `:174` 的 `expect(new Set(list).size, …).toBe(list.length)`；i7 `scripts/hotkey-labels-contract-mutate.js:8,:231` 的 PARTIAL_RED 与标题全集；i8 `apps/desktop/src/utils/hotkey-labels.js:74` 的 `t.length === 1 ? t.toUpperCase() : t` |
| 判据复跑 | ✅ | `node scripts/check-pr-exec-record.js --base=origin/main --head=HEAD --mode=enforce` → **rc=0**；TIER-COVERAGE 读数 `dual-closed total=1 unknown=1`（tier 字段缺席 ⇒ 可见不拦，诚实反映「外部评审未产出 tier」） |
| 遗留 | ⚠ | `tier=external` + 可核 evidence 这一条合规路径**仍未走**（本机无外部评审通道）。本条收口只解除「欠账挡住合并」，**不冒充外部评审已通过** |
