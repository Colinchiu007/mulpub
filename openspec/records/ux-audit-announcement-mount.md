---
change: ux-audit-announcement-mount
branch: ux-audit-announcement-mount
date: 2026-10-21
task: UX 审计阶段 1.2 —— 把运营公告横幅接回应用外壳（组件与数据源都已存在，全仓零渲染方）
sync_status: PENDING
---

# 执行记录：公告横幅接线（ux-audit-announcement-mount，2026-10-21）

## 门禁表

| 项 | 状态 | 读数与判据 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | 运行时代码变更（`src/App.vue` + 组件 + composable + locales）⇒ 隔离 worktree `mp-ux-audit-announcement-mount`，裸分支 `ux-audit-announcement-mount`，非 C 盘 |
| TDD | ✅ | 先写 3 个测试文件（组件 13 条 + 接线锁 4 条 + locale 成对 5 条 = **新增 22 条**），首跑 **14 条红**（12 条组件/接线断言 + `announcement-copy.test.js` 因 `locales/announcement/*` 尚不存在而整份收集失败）。实现后定向四文件（含既有的 `useOpsCenterRuntime.test.js` 3 条）`--reporter=json` 读数 **25 passed / 0 failed**；再把 `locales/structure-lock.test.js`（4 条）一起跑为 **29 passed / 0 failed** |
| 自测（全域） | ✅ | 全域 `vitest run src` **两跑**：第一跑 **407 files passed / 6420 passed / 2 skipped，但 `Errors 5 errors` + rc=1** —— 五条全是 Unhandled Rejection（`No "invokeWithFallback" export is defined on the "@/api/electron-bridge" mock`），是**本批接线自己引入的真实回归**（横幅 `onMounted(() => loadRuntime())` 是浮空 promise，而 mount App.vue 的测试对桥做部分 mock）。修法落在边界：`useOpsCenterRuntime.loadRuntime()` 改成**永不 reject**，以 `{code:-1, message, data:null}` 表达失败，并加 2 条行为锁（失败必须可读、失败态与空态必须可区分）。第二跑 **407 files / 6422 passed / 2 skipped / 0 failed，无 Errors 行，rc=0**。 前置：先跑 `pnpm run build:preload`，否则 bundle 新鲜度断言会因 gitignored 产物缺失报 ENOENT。聚合 eslint 见下
| 反证（7 道） | ✅ | `node scripts/announcement-mount-contract-mutate.js` ⇒ `[BASELINE] rc=0 failed=0 passed=22 collected=22 errors=0 blind=false`；`[SUMMARY] 共 7 条：CAUGHT=7 其余=0`，驱动 rc=0，且每条打 `RESTORE_OK`（还原后独立 md5 回读一致）。C1 摘掉挂载 / C2 挂载搬进壳态分支 / C3 空列表也渲染 / C4 维护档给了关闭按钮 / C5 关闭记忆退化成常量键 / C6 未知 severity 产出空档位 / C7 可访问名退回硬编码中文
| 静态门禁 | ✅ | `check-unwired-tests.js` → 检查域内测试文件 119 个 / OK；`check-no-brand-residue.js` → PASS（11564 个 tracked 文件）；`check-doc-abs-paths.js` → PASS（counts=1161 domain=5130 files=561 canJudge=true）；`check-locale-sync.js --cjk` → PASS（基线 1330 条 → 当前 1120 条，本批净减硬编码）；locale 成对由本批自锁 `src/locales/announcement-copy.test.js` 承担（Gate 7 对拆分文件实测失明，见任务 #20）；聚合 eslint 限定 10 个改动文件 rc=0；另跑 `check-locale-sync.js --pair-base origin/main` 打 PASS 但报两个根装配文件 `变更=false`，而该次跑是在**未提交态**取的——提交后复测一次，按复测读数判断它到底看不看得到本批改动的成对面
| 行尾对账 | ✅ | 暂存后 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径逐字一致：add 1223 / del 31**（不一致即说明行尾被改）。新建文件一律 LF；改既有 CRLF 文档（CHANGELOG / 审计文档）由补丁脚本逐行保留各自行尾 |
| QM-1 打包 | N/A | 本批不改 `electron/` 主进程代码（挂载点方案 C 的定义：不动几何契约） |
| QM-4 视觉 | ⏳ | `announcements` 为空时组件不渲染任何节点 ⇒ 预期零像素回归；若 CI 报回归，只允许按"同一次 CI 渲染"刷新，禁止本机截图与 `--update-baseline`
| QM-6 双模型 | ⏳ | `node scripts/ccg-review-decider.js --base origin/main --head HEAD` 判定与处置回填本节；未闭合前本条 PR **不自动合并**（且须知：enforce RC=0 只说明"没有可查的产物"，不说明"评审过了"）
| 远程同步 | 由门禁推导 | PR #pending —— 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词、不另开回填 PR |

## 一、用户可见变化

1. 运营中心下发公告后，应用外壳顶部（NavBar 之下、页面内容之上）出现一条横幅：
   左侧档位标签、中间标题 + 正文、右侧关闭按钮。
2. 三档样式：`提示`（蓝）/ `重要提醒`（黄）/ `系统维护`（红），浅暗两档各有取值。
   **`系统维护` 档没有关闭按钮**（维护通告不可被用户消音）。
3. 关闭某条后该条不再出现，且**新增公告不会让已关闭的那条复活**（记忆键归因到具体一条）。
4. 英文界面下区域名、关闭名与档位名全为英文（此前 `SEVERITY_LABELS` 是写死的中文表）。
5. 无公告时顶部不出现任何空条（`v-if` 而非占位）。

## 二、关键取舍（详见 design.md D1/D6）

审计行原本只给了两个出口：登记 `useEmbeddedViewSuspension` owner，或"布局避让"。
本批**有意选了第三条**（挂在内容列顶部，接受被内嵌视图遮住），理由是当场读到的：

- 内嵌视图矩形来自主进程常量 `BROWSER_CHROME_TOP = 76`，渲染端不上报内容矩形；
- `computeEmbeddedViewBounds` 的 `topOffset` 参数虽已存在，但**四个消费点没有一个传过非默认值**
  ⇒ 真做"布局避让"需要新增一条渲染端→主进程的横幅高度通道 + preload + IPC，并让四处同源取值，
  且改动落进 `electron/` ⇒ 触发 QM-1。

这条偏离不是遗漏，代价与后续批都写在 PRD §8 与本文 §四。若评审认为该偏离不可接受，
正解是把 §8.1 那一批提上来做，而不是把横幅改成浮动层（z-index 对原生图层无效）。

## 三、判据自身的注意点

- 接线锁的三个锚点（`<AnnouncementBanner` / `<NavBar` / `<main class="mp-workspace`）
  **必须先断言各自存在**再比顺序：`indexOf` 返回 -1 时参与大小比较会静默得出"顺序正确"。
  另注意 `<main class="mp-workspace">` 在 App.vue 里出现两次（壳态与工作台），
  取第一个会把"横幅在 NavBar 之后"判成假 ⇒ 判据用"从 NavBar 往后找"。
- locale 成对判据不能借 Gate 7：`check-locale-sync.js` 只比根级 zh/en，对本仓拆分文件
  实测"删掉 en 键仍打 PASS"（任务 #20）。本批在自己的测试里锁键集合相等 + 两侧非空 +
  组件模板/脚本零硬编码中文。
- 测试 mock `useOpsCenterRuntime` 时用 `importOriginal()` 保留真 `SEVERITIES`：
  若在夹具里另造一份词表，"改了真源白名单"这件事对测试结构性隐形。

## 四、QM-6

待补。判定读数与逐条处置回填在本节，评审产物入库到 `.ccg/reviews/`（gitignored 的
`.adversarial/` 不构成可复核证据）。

## 五、遗留

1. 浏览器/登录标签前台时公告被内嵌视图遮住 ⇒ 需几何双向通道（PRD §8.1）。
2. 公告只在挂载时拉一次，不推送 ⇒ 长时间开着不会自动获得新公告。
3. `announcement-banner-dismissed` 无上限累积。
4. 反证驱动接进 CI（任务 #23）。
5. 暗色档入口（1.1）未合并 ⇒ `[data-theme="dark"]` 分支在用户侧仍不可达，本批不声称暗色已验证。
