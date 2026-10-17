---
record: fix-qm1-verify-path
task: 修 QM-1 打包验证脚本的路径解析——脚本住在仓库根 scripts/ 却把 __dirname 当 apps/desktop，自 #2985 引入起从未跑通
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并；merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：QM-1 打包验证脚本的路径解析缺陷（fix-qm1-verify-path，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 工具脚本（`scripts/`）+ CI 接线（`.github/workflows/quality-gate.yml`）+ 流程文档（AGENTS）+ 执行记录，**未触运行时代码**（`apps/desktop/**`、`packages/**` 零改动），仍按混合 PR 走完整质量节拍。worktree：`<仓库父目录>/mp-worktrees/mp-fix-qm1-verify-path`（D 盘），裸分支 `fix-qm1-verify-path`，起点 `origin/main` `3a941d311`；`pre-code-edit-guard` rc=0；依赖 `pnpm install --frozen-lockfile` rc=0 + `ensure-electron` v43.7.7 + `verify-worktree-deps` 11 项 OK；Write Guard 计划任务状态 Running。**偏离与授权**：共享根 main 上有另一会话的未提交跟踪文件（`01-docs/learnings.md`、`openspec/records/hot-topics-viral-item-sources.md`），`session-init.sh`/`gwm-task.sh` 按设计 fail-closed 拒绝建 worktree；等待约 50 分钟（其间对方 `gh run watch` 已结束、文件自 22:36 起无写入）后仍被挡，**经用户明确授权**改用 PowerShell 原生 `D:\` 路径手工 `git worktree add`（只写 git 元数据，未触碰对方工作树/索引/HEAD；按铁律 B 不在 Git Bash 下用 `/d/` 路径做 git 写）。共享根始终保持 main、对方文件原样 |
| 第一性原因（QM-5 ①） | ✅ | `scripts/qm1-scheduled-publish-verify.cjs` 由 **#2985**（commit `da94f55c3`）引入，第 12 行原为 `const DESKTOP = path.resolve(__dirname)`。脚本位于**仓库根** `scripts/`，而 electron-builder 产物在 `<repo>/apps/desktop/dist-electron/...` —— `__dirname` 在这里不是应用目录，四个验证步骤全落在 `<repo>/scripts/dist-electron/...`。本轮在本机复现（shared root main，未改任何文件）：`node scripts/qm1-scheduled-publish-verify.cjs` → 验证 0 报 `FAIL app.asar 缺失` / `FAIL Multi-Publish.exe 缺失`，验证 1 `asar list 失败` 并以 `Error: ENOENT ... scripts\dist-electron\win-unpacked\resources\app.asar` 退出，rc=1。后果不是「少一个便利脚本」：**AGENTS.md 把它写成「三层判据的脚本侧同源实现」**，即一个从未跑通过、无 CI/包脚本调用方的脚本被当成判据真源引用（本仓反复出现的「装饰性门禁」同型） |
| 逃逸分析（QM-5 ②） | ✅ | 按测试层级逐层：① **单元测试**：该脚本零测试；`scripts/qm1-child-env.test.js` 只有结构锁（grep 源码断言 spawn 传 env），结构锁锁得住「有没有那个调用」，锁不住「路径从哪儿来」。② **集成**：无 CI/包脚本调用方 —— 仓库内除本记录外，引用只有 `AGENTS.md:457`、`scripts/qm1-child-env.test.js` 与两篇历史记录的「观察」段。③ **E2E**：脚本从未在真实产物上运行过，`check-unwired-tests.js` 只收集 `*.test.js`，**非 test 型判据脚本没有任何「必须被执行过一次」的机制**。④ **审查**：AGENTS 的「同源实现」措辞让人以为它在被使用；两篇记录（#3565 的 `remove-dead-redemption-codes.md`、#3815 的 `s2v-bgm-legacy-repair.md` 遗留第 3 条）都如实观察到「该脚本自引入起跑不起来」但按超范围搁置 —— 同一缺陷被观察三次、零次变红，逃逸链末端是「系统性失明」 |
| 系统性漏洞（QM-5 ③） | ✅ | 具体机制：`scripts/check-unwired-tests.js` 的检查域是测试文件（`*.test.js`/`*.test.mjs`/`.sh`），其判据是「测试是否被 workflow 点名执行」。**判据脚本本体（非 test）不在域内**，于是「脚本存在但永不执行」没有任何门禁能看见。本 PR 的堵法不是给它加一个 CI 调用（端到端要 ~1GB 产物，代价过高），而是把**可测的那部分**（路径解析）抽成纯函数并让真机脚本接线，使「脚本的哪一半是死代码」这类问题在毫秒级单测里可见 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 新增 `scripts/lib/qm1-paths.js`：`resolveDesktopDir(startDir)` 从脚本所在目录**向上**找第一个含 `apps/desktop/package.json` 的祖先（不依赖 cwd、不依赖脚本深度），找不到**抛错 fail closed**（绝不静默退回脚本目录 —— 静默退回正是本缺陷的成因）；`artifactPaths(desktopDir)` 单点派生 asar/exe；`assertDesktopDir()` 用 package.json name 把「找错目录」与「产物缺失」分开报。② 脚本改为 `DESKTOP = assertDesktopDir(resolveDesktopDir(__dirname))` 并先打印解析结果；验证 0 的 FAIL 信息补上**完整路径**（原实现只写「app.asar 缺失」，把路径错误伪装成产物缺失）；验证 2 的 rearm 源码读取先探存在性（原实现 node_modules 被 external 化时会抛未捕获异常）。③ 新增 `scripts/qm1-paths.test.js` 9 例：真实布局夹具解析、深度不敏感、不依赖 cwd、fail-closed、入参校验、产物路径结构、name 校验、真仓自证、**接线锁**。④ Gate 2c 点名该测试（`quality-gate.yml`）。⑤ AGENTS QM-1 段补「脚本自身可运行」两条机械约束与动因。**TDD 记录**：先落测试（`Cannot find module './lib/qm1-paths.js'` RED）→ 落 helper 后 8 pass / 1 fail（接线锁 RED，脚本尚未接线）→ 改脚本后 9/9 GREEN |
| 变异反证 | ✅ **2/2 CAUGHT** | M1：把真机脚本的 `DESKTOP = assertDesktopDir(resolveDesktopDir(__dirname))` 改成 `path.resolve(__dirname)`（即 #2985 原写法）→ 接线锁 **not ok 9**（1 failed / 8 passed）。M2：把 helper 的 `path.join(dir, ...DESKTOP_SEGMENTS)` 改成 `dir`（模拟「脚本目录 = 应用目录」）→ **4 failed / 5 passed**（用例 1/2/3/8 全红）。两次均原位还原，还原后 9/9 + 既有 `qm1-child-env.test.js` 7/7 复绿，`git diff --numstat` 仅含本 PR 预期改动（见下行） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **机械锁**：`scripts/qm1-paths.test.js` 9 例已在 `quality-gate.yml` Gate 2c 常驻执行 —— 把真机脚本改回 `path.resolve(__dirname)` 或把解析器退回「脚本目录 = 应用目录」，单测当场红（变异 2/2 已证）；② **契约单一来源**：路径换算只在 `scripts/lib/qm1-paths.js` 一处，脚本与测试都从它取值，禁止在脚本里手抄 `dist-electron/...` 片段；③ **流程文本**：AGENTS.md QM-1 段写明两条约束与动因原话「引用一个从不执行的判据等于没有判据」；④ 刻意不另写 learnings —— 本条防复发面是机械锁而非记忆（R0 的教训原话：写进文档拦不住第 5 次，依赖临场自觉的防线不算防线） |
| 行尾与 diff 对账 | ✅ | 提交后取两口径逐值相等：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 均为 `.github/workflows/quality-gate.yml` 4/0、`AGENTS.md` 5/0、`scripts/qm1-scheduled-publish-verify.cjs` 39/18；新增两文件 `scripts/lib/qm1-paths.js`、`scripts/qm1-paths.test.js` 为 LF 新建（`git add` 时 `LF will be replaced by CRLF` 是 checkout 转换告警，非内容改动）。删除数 18 全部来自 `qm1-scheduled-publish-verify.cjs` 内被替换的旧路径块与 rearm 读取块，无其他文件删除 |
| 接线棘轮 | ✅ | `node --test scripts/check-unwired-tests.test.js` = **30 passed / 0 failed**；`node scripts/check-unwired-tests.js` = `检查域内测试文件 98 个` + `OK: 全部测试均已接线或按欠账登记`。新测试已在 `quality-gate.yml` Gate 2c 显式点名（未被通配收集，故必须点名） |
| workflow 契约 | ✅ | `node --test .github/scripts/workflow-contract.test.js .github/scripts/check-workflow-structure.test.js` = **48 passed / 0 failed**；`check-workflow-structure.js` = `violations=0`；`scripts/check-step-failfast.js` = `含 ≥2 条受管命令的 run 步骤：38 个` + `OK`。**首跑真实抓到一个连带效应**：Gate 2c 是 `shell: bash` 的 `run: \|` 块，块内注释属于脚本文本，我最初在注释里写了 `apps/desktop` 字样，`workflow-contract.test.js` 的「桌面测试作业清单自动收集」把 `static-gates` 误判成跑桌面测试的作业（`actual` 多出 static-gates）⇒ 48 项里 1 项红。改写注释措辞去掉该字面量后复绿。这不是判据失灵，而是它按设计扫描 run 正文（注释也是正文）；记录在此以免下一个人重踩 |
| QM-1 打包 / 端到端实证 | ✅ | 本 PR **未改运行面**，按规则 QM-1 非必需；但修复的正是 QM-1 脚本本身，故做了自有 worktree 的真实打包 + 端到端实跑（这是「脚本终于能跑」的唯一硬证据）：`apps/desktop` 下 `pnpm run build:vue` rc=0（vite `✓ built in 56.09s`）→ `pnpm exec electron-builder --win --dir --publish never` rc=0（`win-unpacked/Multi-Publish.exe` 239,075,328 B；`resources/app.asar` 153,625,149 B；`.playwright-browsers` 缺失仅告警不失败）→ `node scripts/qm1-scheduled-publish-verify.cjs` **rc=0**：验证 0 打印 `PASS 桌面应用目录：<worktree>/apps/desktop` 且两产物路径均指向该目录；验证 1 六个模块全部命中 asar；验证 2 `resumeGuardExports=createResumeGuard`、`schedulerInstanceApi=cancel,create,list,rearm,restore,setOwnerSubjectProvider,setTaskQueue,stopAll`；验证 3 存活 8 秒 + `stderr 长度=0` ⇒ 走三层判据第③层 PASS；汇总 `QM-1 全部通过`。同一次运行里 `ELECTRON_RUN_AS_NODE=1` 告警被打印并剔除，证明前一片（#3648）的修复与本片共存 |
| QM-4 视觉 | N/A | 未触 `apps/desktop/src/**`，无渲染层改动；默认像素态不变，未使用 `--update-baseline` |
| QM-6 CCG 双模型外部评审 | 见判定器 | 以 `.ccg/reviews/<sha>.json` 产物为准（pre-commit 生成）；本片为脚本+文档改动，若判定器判 `skip` 则如实按产物登记，不以自审冒充通过 |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后按同一提交完成「表格行改 PASS + merge SHA + 删 frontmatter 三个 `sync_*` 字段」 |

### 关键决策（design 摘要）

- **向上找仓库根，而不是固定 `path.resolve(__dirname, '..', ...)`**：固定层级要求脚本永远放在 `scripts/` 顶层；一旦挪进 `scripts/lib/` 就会再次静默错位，而错了同样不会报错。向上找 `apps/desktop/package.json` 对深度不敏感，且自带「找错就抛错」的判定点。
- **fail closed，不做「找不到就退回脚本目录」的兜底**：兜底会让同类错位重新变成「产物缺失」的二手症状 —— 本缺陷正是这样活了 11 天（#2985 2026-10-06 引入 → 2026-10-17 修复）。
- **不把端到端接进 CI**：一次要 ~1GB 打包产物 + 8 秒启动窗口，接进每个 PR 是拿全仓 CI 时间换一个低频脚本的覆盖。可测的路径解析进单测与 Gate 2c，端到端保留为 PR 证据并在此如实登记代价。
- **不顺手改脚本汇总行**：见「遗留 2」，属另一条独立缺陷，强行混入会让本 PR 的变异反证与判据对账失去单一焦点。

### 遗留（不假装已闭合）

1. **端到端仍靠手工**：路径解析已被机械锁住，但「脚本能完整跑完四步」仍需要本地 ~1GB 打包产物，未接 CI。本次实跑证据留在本记录，下一次改动脚本仍可能需要人工重跑。
2. **脚本汇总行仍把 `NEEDS_REVIEW` 读成「全部通过」**（新发现，属另一条缺陷）：本轮第一次端到端用的是从 `mp-remove-buyout-license` worktree 复制来的既有构建，其 `app.asar` **缺 renderer 的 `dist/`**（该 worktree 自身没有 `apps/desktop/dist`），启动后 stderr 为 `Failed to load URL: .../app.asar/dist/index.html ... ERR_FILE_NOT_FOUND`。三层判据**正确**打出 `NEEDS_REVIEW`（没有误判 PASS），但脚本末尾仍打印 `QM-1 全部通过` 且 rc=0 —— 与 AGENTS「不得据此判 PASS」相反。它不在本 PR 的根因链上（本 PR 修的是路径解析），且修它需要改判据输出语义与配套锁，建议单独任务。
3. **验证 2/3 的其余隐含前提未系统审计**：probe 仍假定 shared-utils 被打进 asar、resume-guard 可被纯 Node require；启动验证仍假定「本机无其它 Multi-Publish 实例」（单实例锁会让子进程提前退出、与「崩溃」同形）。本 PR 只把「scheduler.js 缺席」从崩溃改成明确 FAIL，其余前提未逐条断言。
4. **共享根并发**：另一会话的未提交文件在整个执行窗口内一直存在（本 PR 未触碰、未提交、未回滚）；worktree 经用户授权手工创建，若后续有会话复用本记录作为「可以手工建 worktree」的先例，须同样先取证「入口为何被挡 + 授权来源」。
5. **CHANGELOG 不适用**：门禁工具脚本修复，用户可见行为零变化；与 `fix-qm1-electron-run-as-node`（#3648）的先例一致，不写 CHANGELOG，此处如实登记为「判定不适用」而非遗漏。
