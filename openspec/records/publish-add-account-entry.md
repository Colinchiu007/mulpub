---
record: publish-add-account-entry
---

# 执行记录：发布页「请先添加账号」补上「添加」与「点击刷新」出口

> 变更 ID: publish-add-account-entry | 分支: `publish-add-account` | 日期: 2026-10-15
> Worktree: `D:/Data/projects/mp-worktrees/mp-publish-add-account`（起点 `8e9109a55` = origin/main）
> 关联: `01-docs/PRD-PUBLISH-ADD-ACCOUNT-ENTRY-2026-10-15.md`

## 一、需求

图文/视频发布页右侧「发布目标」区，当某平台已勾选但没有任何账号时，原来只有一句灰字「请先添加账号」——看得到平台、选不了账号、页面上没有任何出口。补两个出口：

1. 「添加」按钮：点击直接打开该平台登录页（应用内新标签），不必先跳去账号页；
2. 「已经添加成功？点击刷新」链接：用户在新标签登录并保存账号、切回发布页后，一键重拉账号列表。

附带要求：切回发布页时用户已编辑的内容不能丢。

## 二、实现（分层：哑组件 + composable 接线）

沿用 `usePublishGroupTargets` 的既有范式。**关键约束**：`Publish.vue` 被 `check-max-lines` 的
点名还账 `targets` 盯着（`max-lines-baseline.json` → `Publish.vue: 1773`，容差 0），
故本刀在视图侧做到**净零行**（实测 `5 added / 5 removed`，门禁 rc=0）。

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/features/publish/components/PublishTargetSelector.vue` | 空态从单个 `<span>` 升级为「提示 + 添加按钮（同行）+ 刷新链接（次行）」；新增可选 prop `refreshingAccounts` 与 emits `add-account` / `refresh-accounts`；不碰 store、不 import tabStore |
| `apps/desktop/src/features/publish/usePublishAddAccount.js` | **新增**（判据层）。校验 + `tabStore.createTab` + `accountStore.load()` + 播报；依赖全部注入，可单测 |
| `apps/desktop/src/composables/usePublishAddAccountTargets.js` | **新增**（接线层）。接 `tabStore`、注入 `platformLabel`、收编 `loadAccounts`，返回 `addAccountBindings` 供 `v-bind` |
| `apps/desktop/src/views/Publish.vue` | 1 行 import + 1 行调用 + 1 行 `v-bind`，并移除已搬迁的 `loadAccounts`（4 行）⇒ 净零行 |
| `apps/desktop/src/locales/publish-page/{zh,en}.js` | 新增 7 键 `publishPage.addAccount.*`（成对） |
| `apps/desktop/src/composables/usePublishGroupTargets.js` | 仅注释：把"行数预算只剩约 30 行"更正为"`targets` 点名后实际为 0 行" |
| `01-docs/PRD-PUBLISH-ADD-ACCOUNT-ENTRY-2026-10-15.md` | **新增** PRD（§5.4 视觉门禁实测取证、§5.5 行数棘轮、§九.1 展开） |
| `01-docs/PRD.md` | §18.2 验收表 + 独立小节（纯追加） |
| `01-docs/learnings.md` | 顶部新增 6 条（热点载体隔离 / rebase 方向 / 过期 ref / 钩子成本 / 宿主已保证 / 视觉门禁可达性） |
| `CHANGELOG.md` | 顶部 `# [未发布]` 块 |
| `.agent_context/everos-*.md` | 2 篇 EverOS 知识条目（已写入 EverOS 服务并 flush） |

### 2.1 视图净零行的做法（`targets` 零增长容差的唯一正解）

`01-docs/learnings.md:17959` 已把处置写死：**「接线逻辑抽独立 composable…结构性拆分才是正解」**
（同族先例 `hot-topics-publish-handoff` 面对 `TARGET_GREW: Publish.vue 1896 > 1773` 时也是真实拆分，
而非上调 targets）。三步：

1. 接线抽进 `composables/usePublishAddAccountTargets.js` ⇒ 视图只剩 1 行调用（内联需 13 行，必红）；
2. 三个模板属性合并为 1 行 `v-bind="addAccountBindings"`；
3. 把既有 `loadAccounts()`（3 行 + 注释）搬进同一 composable ⇒ −4 行，抵消 1/2 的增量。

**第 2 步的风险已被实测钉住**：`v-bind` 的对象键必须是驼峰 `on*` 形态才能命中 kebab 事件名。
新增的 v-bind 合同用例（`PublishTargetSelector.test.js`）把 `{ refreshingAccounts, onAddAccount,
onRefreshAccounts }` 作为 props 传入并断言两个回调真被调用——键名漂移会直接变红，而不是让事件静默失效。

## 三、三条核心语义与为什么它们不可移动

1. **刷新必须走 `load()` 而不是 `ensureLoaded()`**：`stores/accounts.js:104-109` 的 `ensureLoaded()` 幂等 + in-flight 缓存，发布页 `onMounted` 调过一次之后再调它就是空操作。写成 `ensureLoaded` 会让「刷新」点击有反应（`refreshing` 翻转）但账号列表永不变。
2. **登录标签必须带合法 `accountId` 占位值**：主进程 `webview-manager/tab-lifecycle.js:34` 的 `SAFE_IDENTIFIER.test(accountId)` 决定分区是 `persist:account-<id>` 还是 `persist:browse-<tabId>`。后者随标签关闭即消失 ⇒ 用户完整走完「添加→登录→保存→刷新」仍看不到账号，且无任何报错。取 `mp-new-<platform>`（同平台复用同一分区；每次随机会让同一平台两次登录落在互不相通的分区）。
3. **`cleanSession` 必须显式 `true`**：与 `Accounts.vue:1196` / `Home.vue:304` 同口径，并顺带把 `credentialSaveState` 置为 `'unsaved'`（`tab-lifecycle.js:201`），NavBar 的「保存账号」按钮才会出现。

「切回发布页内容不丢」**不需要新代码**：`App.vue:72-76` 的 `v-show` + `keep-alive :include="['Publish']` 已保证切标签只是 `display:none`（行为锁 `publish-tab-state-keepalive.test.js`，含 `setupCalls===1` 反证）；`accountStore.load()` 只写 `accounts.value`，不触发任何发布页状态重置。

## 四、测试与变异反证

- **TDD 两段驱动**：先写测试 ⇒ 2 红（`usePublishAddAccount` 1 红 = title 期望值硬编码平台 label，暴露「平台显示名未注入」的真实设计缺口；`PublishTargetSelector` 1 红 = L8 用例误用 `zhihu`，而它在 `groups` 常量里 `accounts: []` 本就是空态平台）⇒ 两处修的都是**测试自身的取据错误**，未放宽断言。
- **末态**：三个新/改测试文件 **40 passed / 0 failed**（`usePublishAddAccount` 14、`PublishTargetSelector` 22（含 v-bind 合同锁）、`usePublishAddAccountTargets` 4）。
- **消费者并集**（按 `git grep -l` 取，非"我改过的文件"）：**363 passed / 0 failed**（含 `Publish.test.js`、`views-deep2.test.js`、`src/features/publish/**` 20 文件、`Accounts.test.js` 119、`locales/structure-lock.test.js` 4）。重构后复跑：`Publish.test.js` + `views-deep2.test.js` + `locales/structure-lock.test.js` + `src/composables/**` 全绿（见下「重构后复跑」）。
- **行数棘轮**：`node .github/scripts/check-max-lines.js` **rc=0**（超限 97 / 挂账 97 / 墓碑 3 / 点名还账 20，无 `TARGET_GREW`）；`Publish.vue` 相对 origin/main `5 added / 5 removed` = **净零**。
- **变异反证四道，全部指名红、红集互不相同，`RESTORED_BYTE_EXACT=true`、`MISSED=0`**：

| ID | 变异 | 红集 |
|---|---|---|
| M1 | 刷新改 `ensureLoaded()` | 4 条（L4/L5/L6 + 不清空列表） |
| M2 | 去掉 `accountId` 占位值 | 2 条（入参精确断言 + 占位值互异） |
| M3 | 去掉 `cleanSession: true` | 1 条（入参精确断言） |
| M4 | 去掉 `refreshing` 守卫 | 1 条（L5 重复点击） |

## 五、视觉门禁：一处被实测推翻的初始判断

PRD 初版写「CI 空 profile ⇒ 每平台都是空态 ⇒ 新增 DOM 必改像素基线，需重建并自证 0 px」。**实测证明前提为假**：

- `apps/desktop/tests/e2e/fixtures/accounts.json` 提供 **8 个账号**，`tests/e2e/helpers/ipc-mock.js` 无清空机制；
- `usePlatformSelection.js:54` 硬编码预勾选 `['wechat_mp']`，而该平台在 fixture 里恰好有账号；
- DOM 探针（独立复跑两次一致）：默认态 `add-account-*` / `refresh-accounts-*` / `.target-accounts__empty` 计数均 **0**；勾选全部 15 平台后均 **8**（`15 - 7 = 8`，fixture 只给 7 个平台配账号）；`pageerror = 0`。

像素对账：`PIXEL_THRESHOLD=0.06`（与 `visual-test.yml:35` / `quality-gate.yml` Gate 7 同值）下 `publish-form` **PASSED**，`misMatchPercentage = 0.58%`；网格分区统计显示变化像素均匀散布在标题/作者/素材/正文/封面（各块 0.5%–2.4%），**右侧「发布目标」面板为 0** —— 属字体抗锯齿噪声。

**边界的如实表述**：该 PASSED 只证明「有账号的正常态无回归」，**不构成空态无回归的证据**。空态在现有视觉基建下不可达（要可达须改 fixture 或给该视图加 prepare 交互，属测试基建改动，超本刀范围）；空态正确性由 `PublishTargetSelector.test.js` 的 DOM 断言（PRD §八 L7–L10）承担。基线与 HEAD 字节级一致，未运行 `UPDATE_BASELINE`。

## 六、locale 与其它门禁

- `check-locale-sync.js --keys` PASS（2018 key 均存在于 zh/en）；`--cjk` PASS（基线 1374 / 当前 1224，无新增硬编码）。
- `pnpm exec vite build` rc=0。
- QM-1 打包：**不触发**（只改 renderer，未改 `apps/desktop/electron/` 与 `packages/rpa-engine/`）。
- ESLint 全量：**未本机执行**（CI Gate 11 覆盖）。

## 七、遗留（明确不在本刀）

1. 保存后的账号 id 是占位值 `mp-new-<platform>`，与账号页 `auth-open-login` 生成的 id 形态不一致。功能上成立，要统一需主进程新增 IPC 返回真实新账号 id。
2. 未提供扫码登录入口（`QR_CODE_PLATFORMS` 只覆盖少数平台）。
3. 不自动轮询账号列表；刷新失败不区分「网络」与「未登录」（账号页也未分级，不建第二份口径）。
4. 不支持多平台同时批量添加（会开多个登录标签，用户易迷失）。
5. 「保存账号」按钮的引导强度不变，靠「刷新后仍无账号 ⇒ 空态仍在」反向兜底。
6. 未做真机 E2E（牵动共享 userData 与真实平台登录），行为面以单测为准。

## 八、远程同步

| 远程同步 | PASS | #3627 squash 合并 merge SHA `df0a7402e68fcde0ce938eb87c0dc38ff80eeb2e`（2026-10-15T17:30:52+08:00）；远端分支 `publish-add-account` 已删（`git ls-remote --heads origin publish-add-account` 0 行）；frontmatter 的 `sync_*` 三字段已在**同一次提交**删除 |

**关于载体的纪律**：本 PR **刻意不把质量记录写进 `.quality-gates.md`**（那是全体会话的共同追加热点，混合 PR 带它必冲突，见 `01-docs/learnings.md`「混合 PR 的结构性活锁」）。本文件自带的 frontmatter 三字段即满足 `check-gate-record-debt` 的登记判据；`.quality-gates.md` 的本刀块由**本次 docs-only 回填 PR** 落地（按「状态列只写当下状态」，该块直接写最终 PASS 形态）。

**本次回填与销账同一次提交**：① `.quality-gates.md` 新增本体 QG 块（40 行纯追加、0 删除）；② 本文件 frontmatter 删三字段 + 本行 PENDING→PASS。因落地时已是 PASS 形态，**本体不产生 `gate-record-debt-ledger.json` 登记项**（登记只服务未收口状态）。


