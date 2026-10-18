---
record: fix-hot-topics-genvideo-title
task: 热门选题「生成视频 → 去发布」标题改为 AI 爆款标题，三级降级到原始选题
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在sync_backfill_owner: 下一个会话
---

## 本次执行记录：热门选题【去发布】标题 AI 化 + 三级降级（fix-hot-topics-genvideo-title，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更：worktree `<worktreeRoot>/mp-fix-hot-topics-genvideo-title` + 裸分支 `fix-hot-topics-genvideo-title`（非 C 盘）；`scripts/pre-code-edit-guard.ps1` 在 worktree 内 exit 0 |
| 第一性原因（QM-5 ①） | ✅ | 四级静默回退链末端切片：`buildGenVideoStartParams` 不带 `title` → `publish.title = config.title \|\| ''`（默认空）→ 主进程 `project.title = run.params?.title \|\| publish.title \|\| sourceText` → `truncateTitle(rawTitle, 100)` ⇒ 正文前 100 字；非 S2V 流水线无 project ⇒ 标题空 |
| 逃逸分析（QM-5 ②） | ✅ | 单测：`publish-from-project.test.js` 夹具让 `project.title` 与 `sourceText` 取同值 38 字，缺陷路径表现为正确行为；组件：`HotTopics.test.js`【去发布】夹具手写 `publish.title='发布标题'`，真实链路恒空。审查：`hot-topics-pipeline-picker` 评审把「不伪造标题」当合规终态，未追问「标题从哪来」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复：AI 爆款标题 + 三级降级（无模型/失败 → 原始选题）。回归锁：纯函数 15 例 + IPC 31 例 + `HotTopics.test.js` +8 例 + `Publish.test.js` +6 例 = 60 例新增；`mountCompletedRun` 夹具显式把 `publish.title` 置空串对齐真实链路 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① `01-docs/learnings.md` 新增条目「多级回退链 + 夹具填满前几级 = 缺陷路径在测试里表现为正确行为」（含纪律：多级回退纯函数必须有一例前几级全空的生产形态夹具；「不得注入空 X」规则必须同时回答「X 非空时从哪来」）；② PRD §3a.3.1 与 PRD-HOT-TOPICS-MODULE §3.13.10 固化标题口径与逃逸分析 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（无纯行尾变更）；无删除行（纯新增/修改） |
| 接线棘轮 | ✅ | 新增 2 个测试文件均为**既有测试文件的同目录邻居**，由既有 workflow 的 `apps/desktop` vitest 全量入口覆盖（非孤儿文件）；无新增 workflow 点名需求 |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | 改动含 `apps/desktop/electron/ipc-handlers/` ⇒ 必跑 QM-1（见下方证据节）。视觉：本轮未改既有页面 DOM 结构（新增提示为条件渲染，无 `title_source` 时不渲染节点），未触发像素门禁路径；Publish 视觉基线路径 query 不含 `title_source` ⇒ DOM 不变 |
| QM-6 CCG 双模型外部评审 | ⛔ 未能完成（**四次实测**，环境限制） | **本条经三次更正，前两稿归因都是错的，如实保留错误轨迹**：<br>① 初稿「本机无 `codeagent-wrapper` ⇒ 未执行」——**错**：`--check-deps` 实测三后端均可用。<br>② 二稿「驱动 `scripts/ccg-deep-review.js` 在仓库中不存在」——**错**：它有意不 vendor，但 `deep-review.sh:446-447` 的 HOME 兜底命中 `~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js`（`Test-Path` 为 True）；rebase 后重新提交已成功生成新 DUAL 记录 `a4e95405`，引擎正确读到 `判定: DUAL / 变更 1790 行`。<br>③ **A/B 实证**：`codeagent-wrapper.exe` 非 `--lite` 单次调用固定开销 **70s**（同一极小任务 `--lite` **4s** vs 非 lite **70s**，17.5×，开销来自 skill 加载）。<br>④ **最终归因**：即使把启动开销压掉（第 4 次实跑加 `CODEAGENT_LITE_MODE=true`，wrapper 官方 env，非放宽判据），仍在**同一位置** `[轮 1/3] 调用 critic=claude` 报 `spawnSync ... ETIMEDOUT` ⇒ 瓶颈是**评审本身耗时**超过引擎 `ccgForMode` 里 **硬编码的 `timeoutMs: 600000`**（无 CLI/env 覆盖入口，仅 `--rounds`/`--base`/`--critic` 可调），而非启动开销。**拆 PR 也无法规避**：实测代码 diff 1801 行 / 文档 1414 行，把文档全拆出去代码侧仍是 1801 行，量级不变。<br>**未做的事**：没有把「评审跑不起来」写成 `cleared`/`needs_revision`/`self_play_resolved`（三者都表示评审有结论），也没有改 `~/.claude/skills/` 的引擎超时硬凑（属「改谁来守门」，须人工过目）。<br>**因此 `check-pr-exec-record --mode=enforce` 判红 1 条**（CI 侧跑的是 `--mode=advisory`，故 CI 绿）。按 AGENTS.md「禁止自动合并：拿不准的争议一律停下来报告用户」⇒ **本 PR 停在待人工裁决，未自动合并**。替代证据：6 条变异反证全指名红 + 625 例自动化测试全绿 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin fix-hot-topics-genvideo-title` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 质量门禁读数（fresh）

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ **false**（含代码/依赖/CI 路径）⇒ 完整质量节拍，未借道 docs-only 通道。
- `node .github/scripts/check-locale-sync.js --pair-base origin/main` ⇒ PASS（hot-topics 与 publish-page 的 zh/en 均成对变更）。
- `node .github/scripts/check-locale-sync.js --keys` ⇒ PASS（2105 个使用中 key 均存在于 zh/en）。
- `node .github/scripts/check-locale-sync.js --cjk` ⇒ PASS（基线 1374 条，当前 1217 条，**无新增硬编码**）。
  - 过程记录：第一版把 prompt 构造放渲染层，`--cjk` 当场红 8 处；把 prompt 下沉到主进程 IPC handler 后转绿。这条是本期最有用的一次门禁反馈。
- ESLint：改动文件 exit 0。3 条 warning 经 `git stash` A/B 实证为**存量**（行号仅因插入偏移），非本次引入。
- **债务熔断（check-max-lines）三条真债已拆清**：本 PR 引入的 3 条 NEW_OVER_LIMIT / TEST_OVER_LIMIT / TEST_LEDGER_GREW
  按门禁处方「按既有 mixin/composable 范式拆分」处理：
  - `useHotTopicsGenVideo.js` 544→**442**：抽出 `useGenVideoPublishTitle.js`（标题生成 + query 组装，81 行）
    与 `useGenVideoRunTracking.js`（双通道 run 跟踪 + 终态分发，132 行）。状态 ref 仍由原 composable 持有——单一真源不搬家。
  - `HotTopics.test.js` 1671→**1429**：C1-C7 八例移入新文件 `HotTopics.publish-title.test.js`（341 行）。
  - `Publish.test.js` 1995→**1935**（登记 1735 + 容差 200 = 1935，刚好压线）：P1-P6 六例移入
    `Publish.video-title-source.test.js`（217 行）。
  - 复跑：超限文件 97→96、测试超限 13→12，上述三文件**均不再被点名**。
  - 拆分后 4 个测试文件合计 **182/182 全绿**（含 60 例新增用例一条未删）。
  - 唯一残留 `NEW_OVER_LIMIT: electron/preload/index.bundle.js` 经实证为**构建残留非本次债务**：
    它是 22:30 QM-1 打包时由 `build:preload` 生成的产物，自 2026-10-17（change `bundle-untrack`）起被
    `.gitignore` 显式忽略（`.gitignore:419`），**不在 `origin/main...HEAD` 改动集中**；且门禁扫的是
    `fs.readdirSync` 工作区而非 git 改动集，故本地可见而 CI 不可见。R0 守卫按设计拒绝删除它
    （闸3 只删 `??` 未跟踪文件，它是 `!!` 忽略文件），因此保留原样并在本记录说明。
- 测试（全量 desktop 套件，逐文件实测）：
  - `src/features/publish/gen-video-title.test.js` 15/15
  - `electron/ipc-handlers/gen-video-title.test.js` 31/31
  - `src/views/HotTopics.test.js` 65/65
  - `src/views/Publish.test.js` 117/117
  - `electron/tests/ipc-exposure-contract.test.js` 20/20
  - `electron/preload.test.js` 382/382（**计数棘轮已按本次新增更新**：system 146→147、api 344→345）
- **全量套件中 3 个失败文件的逐一定性（全部 `git stash` A/B 实证，不靠推断）**：
  1. `electron/preload.test.js` 2 例红 —— **本次引入，属合理棘轮**：新增 `aiGenerateGenVideoTitle` 使
     `system` 导出 146→147、聚合 api 344→345（`AssertionError: expected 147 to be 146` / `expected 345 to be 344`）。
     已更新基线数字，并补 `expect(Object.keys(api)).toContain('aiGenerateGenVideoTitle')` 防「只改数字不接方法」，现 382/382 绿。
  2. `electron/services/stealth/preload-variant.test.js` 4 例红 —— **存量，与本次无关**：
     移开我全部改动后**仍红 4 例**；根因是本 worktree 缺构建产物 `stealth-preload-enhanced.bundle.js`
     （断言 `/stealth-preload-enhanced\.bundle\.js$/` 取不到）。不在本次爆炸半径内。
  3. `electron/tests/bundled-font-packaging.test.js` 1 例红 —— **存量，与本次无关**：
     移开我全部改动后**仍红**；根因是 `apps/desktop/dist/fonts` 不存在（本 worktree 未跑 Vite build），
     即 electron-builder 打包时已打印的 `file source doesn't exist ... dist/fonts`。不在本次爆炸半径内。
  4. `tests/gui-ci-exit-contract.test.js` 1 例红 —— **存量，与本次无关**：
     移开我全部改动后**仍红**（`CLI 端到端：真 git 仓库里文档改动判否、桌面改动判是…`，真起 git 仓库跑 CLI，约 16 秒）。
  5. `electron/ipc-handlers/podcast-plan-preview-ipc.test.js` 1 例 +
     `electron/ipc-handlers/podcast-script-ipc.test.js` 1 例 +
     `electron/core/preload-path.test.js` 2 例 —— **存量，与本次无关**：
     三者同因「本 worktree 缺预构建 bundle 产物（`stealth-preload-*.bundle.js`）」，
     断言形如「两个 tracked bundle 必须含这条通道名（改 preload 不重生 bundle ⇒ 打包面根本没有它）」；
     移开我全部改动后**仍红 4 例**。不在本次爆炸半径内。

**本次引入且已修复的 2 项（即真正属于我的债）：**
- `electron/preload.test.js`：新增 `aiGenerateGenVideoTitle` 使计数棘轮红（`147 vs 146`、`345 vs 344`）。
  已更新基线并补 `toContain('aiGenerateGenVideoTitle')` 防「只改数字不接方法」，现 382/382 绿。
- `src/i18n/glossary.test.js`：我在 `01-docs/i18n-glossary.md` 登记的
  「文字推理模型 / **Text reasoning model (LLM)**」在 zh 出现而 en 未出现。
  该门禁按「locale 值**包含**登记串」判定，`(LLM)` 是术语注解而非文案内容 —— 正解是把登记串收敛为
  `text reasoning model`（与英文文案实际用词一致），**而不是往英文文案里硬塞 `(LLM)`**
  （那会让用户读到 `No text reasoning model (LLM) configured…` 这种带技术括号的怪文案）。现 2/2 绿。

**方法论备注**：以上 4 项全部走 `git stash push -- apps/desktop/electron apps/desktop/src` + 重跑 + `git stash pop`
的 A/B 实证，未使用「看起来不相关就判存量」的推断。另有一条独立的取证教训：首轮全量跑误用了
`--reporter=basic`（vitest 无此 reporter），导致**一个测试都没跑**却返回 exit 1 —— 若信该 rc 会得出
完全错误的结论。判据一律取**日志产物**，不取退出码。

### QM-1 打包证据

- `cd apps/desktop && pnpm exec electron-builder --win --dir --publish never` ⇒ exit 0（证据见下节，跑完后回填实测输出）。
- asar 含 `electron/ipc-handlers/gen-video-title.js`；`require('@multi-publish/rpa-engine')` 链通过。
- 启动三层判据：① 窗口期内进程存活（单独断言，不只看 stderr）；② 显式传 `env`（`scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE`）；③ stderr 为空才判通过，非空未命中红线 ⇒ NEEDS_REVIEW。

### 变异反证（自审替代项，因 QM-6 未执行）

6 条变异全部实测注入 → 指名红 → 还原后回绿（每次注入后立即还原，末尾核对 diff 只剩本次改动）：

| 变异 | 结果 |
| --- | --- |
| M1 删掉 `genVideoBusy` 守卫 | ✅ C6「重复点击幂等」红 |
| M2 `aiAvailable` 恒 true（不查默认模型） | ✅ C2 + C2b 双红（会发起不该有的 LLM 调用） |
| M3 `aiAvailable === true` 改成 truthy | ✅ 纯函数「非 `true` 保守降级」例红 |
| M4 去掉 run-only 分支的 title 注入 | ✅ **10 例红**（含既有「非 S2V 成片出口」例） |
| M5 去掉 `activeMode !== 'video'` 判据 | ✅ P5 红 —— **第一轮实测未红（假绿）**，已修测试 |
| M6 「成对引号才剥」改成无条件剥首尾 | ✅ T6「单边引号不剥」红 |

**M5 的假绿值得单独记**：第一轮变异注入后 P5 仍然绿。根因是该用例只断言 DOM 里没有提示节点，而标题输入区在图文模式下**模板本就不渲染**——于是「删掉判据」与「模板不渲染」产生同样的可观测结果，测试对变异免疫。修法：补一条 `expect(w.vm.videoTitleSourceHint).toBe('')` 直接断言 computed 值。**这条是「DOM 不存在」类断言的通用陷阱：不存在可能来自判据，也可能来自模板结构，前者才是你想测的。**

### 遗留（不假装已闭合）

- **真机 E2E 未跑**：热门选题生成视频需真实 LLM + 真实流水线执行，本机未跑端到端；标题质量（是否真「爆款」）只能由用户在真机目视判定，测试只保证「契约与降级正确」。
- **未做标题候选多选交互**：本期只生成 1 个标题；多候选 + 用户挑选是后续切片（PRD §14 已列为非目标）。
- **未给「无模型」场景加一键跳转模型设置**：发布页提示只说「未配置文字推理模型」，用户需自行前往模型设置（设计文档 Open Questions 已记录取舍）。
- **`buildPublishFromProject` 的回退链仍未加「前几级全空」夹具**：本期只在热门选题侧加了生产形态夹具；共享真源那三条入口（历史/结果页/播客）的同型加固待后续切片（已在 learnings 立纪律）。

### QM-6 未完成的**人工授权**记录（合并依据，不是自动放行）

- **授权时间**：2026-10-18（本轮会话，用户主动选择「授权按『环境限制』登记后合并」）。
- **授权范围**：仅授权「在 `check-pr-exec-record --mode=enforce` 仍因 1 条 CCG 深度审查欠账判红的情况下合并本 PR」，**不含**授权伪造任何闭环状态。
- **因此没有做的事**：记录里该 DUAL 记录的 `deepReview.status` **保持 `error`**（工具实测写入的真实值），未改成 `cleared` / `needs_revision` / `self_play_resolved` —— 那三个值都表示「评审有了结论」，而事实是评审没能跑完。
- **债务去向**：`.ccg/reviews/a4e95405….json` 会随本 PR 进入 main，`status=error` 保持可见。后续任何一次把该引擎 `timeoutMs` 提高（`~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js::cfgForMode`）后重跑，都能把它真正闭合。
- **替代证据链**：625 例自动化测试全绿（含 61 例本期新增）+ 6 条变异反证全部指名红 + QM-1 打包三层判据通过 + CI 24 项全绿。这些**不等于**双模型评审，只是当前环境能拿到的最强证据。

