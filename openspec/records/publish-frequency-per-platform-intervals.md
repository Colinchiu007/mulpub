---
record: publish-frequency-per-platform-intervals
task: 同账号发布间隔改为逐平台真源（视频号 3′→60′，其余 14 平台零变化）+ 五级优先级链 + 一条 JSON env + 设置页逐平台覆盖
date: 2026-10-16
---

## 本次执行记录：逐平台同账号发布间隔（publish-frequency-per-platform-intervals，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🏗️ 运行时代码变更（`packages/shared-utils` + `apps/desktop/electron/ipc-handlers` + 渲染层 `.vue` + locales）⇒ 隔离 worktree `<worktree 根>/mp-publish-frequency-per-platform-intervals`、裸分支 `publish-frequency-per-platform-intervals`，起点 `HEAD == origin/main`；依赖就绪 `node scripts/verify-worktree-deps.js` 实测 `消费方解析通过 11 项 … OK`。共享根全程 main + clean，未触碰。变更规模 M+（跨模块 11 个文件）⇒ 走完整质量节拍，不走 docs-only 快速通道（`classify-docs-only` 判 `false`，含代码/配置面） |
| 第一性原因（QM-5 ①） | PASS | 不是"数值选错"。根因是**维度归属选错**：v2 把 15 个平台压成三档来消灭"15 份手抄数值"，代价是账号间隔这一维 thereafter **只能整档同变**。用户诉求是"只有视频号严格一些"，在档位模型里无法表达 ⇒ 只有两种坏出路（开第四档牵动 `TIER_ENV`/分组文案/单调锁，或写 `if (platform===…)` 造出第二份真源）。第三条独立成因：一个量被换来源时，把它当**界**用的落点会一起漂移——回落基线的定义就是"已登记里最严的那个值" |
| 逃逸分析（QM-5 ②） | PASS | ①**单元层**：既有「全域账号档 ≤ 5 分钟」锁会把产品决策判成回归 ⇒ 若照锁行事就得放弃需求；②**结果 vs 来源层**：`resolveIntervals` 若继续从档位取账号档，新表就成了"存在但没人读"的死面——本仓「注册≠注入≠生效」一族，靠"新写一张表"永远不会红；③**审查层**：`PLATFORM_FREQUENCY_POLICY` 与逐平台表各持一份账号档时，读哪张取决于调用点，而两张表各自的单测都只测自己；④**展示层**：组件按"三维元组"分组，元组里含账号档 ⇒ 视频号自成一条 `clip（1 个平台）`，每个字段单独看都真实、合起来是假陈述，而组件测试只断言"三档各有一行"，结构性看不见；⑤**声明层**：新增三个导出若不跑既有双向声明锁，TS 消费者拿 `any`、永远不会问 |
| 修复 + 回归保护（QM-5 ④） | PASS | 逐平台表 `PLATFORM_ACCOUNT_MIN_INTERVAL_MS`（15 键，视频号 60′，其余沿用档位值）为账号档唯一数值真源；`PLATFORM_FREQUENCY_POLICY` 的账号档替换为逐平台值、另两维仍按档；`BASELINE_INTERVALS.accountMinMs` 改为**引用表**；新增 `parseAccountMinIntervalEnv` + `resolveAccountMinIntervalMs`（五级链，未登记平台回落基线且仍走 env）；`resolveIntervals` 账号档改走解析器；`resolvePolicyOverrides` 新增 `accountMinMsByPlatform`（值非法整体作废 / 未知键只忽略 / 全未知视为无效）；IPC `getPolicy` 下发 `accountMinDefaults`；设置页逐平台区（默认／生效／已覆盖／输入框）+ `buildPolicy` 与回填；locales zh/en 成对新增 5 键；`index.d.ts` 补 3 条声明。**回归锁 12 条**：策略侧新文件 8 条（表覆盖与偏离集合、五级链逐条、`resolveIntervals` 真走解析器、env 两档严格度与钳位、设置页校验、兜底不绕过覆盖链、两函数不得互调 + 基线 ≥ 全域最大、派生表 == 逐平台表）+ 改写既有 2 条（全域上界改写成"偏离显式枚举"、档间单调收窄到代表平台）+ 组件侧 5 条（清单渲染／覆盖行与回填／留空不提交／分钟→毫秒／缺下发时显示 `—` 且结构锁只扫代码行）+ IPC 1 条（下发 == 真源且键数 == 15）。TDD 顺序可复核：策略层实测 **9 条红**→实现后转绿，组件侧实测 **6 条红**→23/23 绿 |
| 防止再次发生（QM-5 ⑤） | PASS | ①delta 规格挂在**主干 capability** `publish-frequency-control`（4 条 ADDED：逐平台真源、五级链、两档严格度、展示面不得持有第二份数字），`openspec validate --strict` valid；②"改来源必查谁把它当界用"写进 `01-docs/learnings.md` 置顶一节（含注入夹具那条：红的是夹具不是判据，放宽判据是此刻最省事的错法）；③"分组标签的语义必须由分组键自己保证"写进 ARCH §7 与 learnings（并为"同一标签出现两行"补一条用例）；④变异驱动入库 `.ccg/reviews/freq-v5-mutate.driver.js`（M1–M8 可复跑）；⑤AGENTS 无需改条文——本片恰好是既有"单一真源"条款的一次执行，不是新增例外 |
| 行尾与 diff 对账 | PASS | 动手前当场测 `i/lf w/crlf attr/text=auto`（`CHANGELOG.md` / `01-docs/learnings.md`）。置顶脚本**不碰既有字节**、新增行跟随该文件既有行尾：CHANGELOG `CR 21597→21607`（+10 == 新增行数）、`numstat` 与 `--ignore-cr-at-eol numstat` 两口径逐字相同（`10/0`）；learnings 两口径同为 `38/0`。`git status` 里 `LF will be replaced by CRLF` 的告警按 AGENTS 不当噪声处理——它出现的位置是 `index.d.ts` / `.vue` / `learnings.md`，均为工作副本 eol 转换而非内容改写。**顺带清理构建副作用**：`build:dir` 重写了 5 个 `*.bundle.js` / generated iife，`git diff --numstat` 为空（eol-only 索引产物），按**精确路径** `git checkout HEAD --` 还原、不进本 PR（禁用宽目录恢复） |
| 接线棘轮 | PASS | 新增 `packages/shared-utils/tests/publish-frequency-account-interval.test.js` 由 `packages/shared-utils` 的 vitest workspace 收集（实测 `Test Files 1 passed`，在 52 文件全量里出现），非"写了没跑"；入库的 `.ccg/reviews/freq-v5-mutate.driver.js` 不是测试文件名形态。实测 `node scripts/check-unwired-tests.js` 见下方"本地门禁"行 |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1（触 `apps/desktop/electron/ipc-handlers/` ⇒ 必跑）：`pnpm run build:dir` rc=0（两条 `file source doesn't exist`＝`dist/fonts`、`.playwright-browsers`，与既有记录同形态、非本次引入）。产物内容判据经 `@electron/asar` 的 `extractFile`：`entries=15022（拆分后重跑那一轮）；三个模块 16135/8476/5190 B 全在 asar 内且判据串齐`（过规模下界）、`dist/` 125 条含 `index.html`、打包后的策略文件内**逐平台表 + 视频号 60′ + env 名 + 解析函数**四项全命中、IPC 内含 `accountMinDefaults`、渲染端 chunk 内 `perPlatformTitle`/`pubfreq-per-platform`/中文标题各命中 1 个文件。启动第③层：12 秒**存活**、**stderr 0 字节**、本 worktree `electron`/`Multi-Publish` 计数 **0→0**（无残留）。两处探针自纠写进判据本体：① `extractFile` 的键必须是**清单原形态（反斜杠）**——归一成斜杠会让 64 个 js 全部取不到，而"新串 0 命中"读起来完全像"没打进产物"，故同一段代码必须先能在**既有** testid 上命中（正控）；② `asar.listPackage` 返回值带前导 `\`，不去前导则 `dist/` 计数为 0。QM-4 视觉 N/A：变更集不含 `.css/.less/.scss` 与基线 PNG；`.vue` 新增的是一个 `div` 区块与 15 行既有 `el-input-number`（沿用已登记的组件与样式，不引入新 `el-*` 类型 ⇒ 不需改 `element-plus.js` 清单），像素门禁对该类"新增一列行"的改动双向失明，故判据走组件断言 + 结构锁 |
| QM-6 CCG 双模型外部评审 | **未跑成**（如实登记，不以自审冒充） | 本会话开工前已实测三条通道同日不可用（CC Switch `127.0.0.1:15721` CLOSED、`opencode` `-free` 通道对长任务零产物、第三通道同），且本片未获得新的通道可用性证据。按既有口径**登记为未建立**，不以本会话自审替代；同时按用户此前指示做了**一次双轴自审**（后端＝正确性/边界/规格合规，前端＝模式/可维护性/集成风险），其发现与处置见下表——**这条自审不等价于独立模型交叉审查**，合并决定仍按 AGENTS「禁止自动合并的情形」第 5 条处理 |
| 远程同步 | PASS | PR #3753 已 squash 合并为 29e5a60cdcedec8eadeccb3ad1f14061b6010e73（2026-10-17T09:40:33Z）；双源同 SHA：`git log origin/main --grep='(#3753)$' --format=%H|%cI` 与 `gh pr view 3753 --json state,mergeCommit,mergedAt`；远端分支 `publish-frequency-per-platform-intervals` 经 `git ls-remote --heads origin` 返回 0 行（`--delete-branch` 已生效）。合并判定只认产物，不采信 `gh pr merge` 的返回信息（本仓有已登记的假失败先例）。 |
### QM-6 自审发现处置（非独立模型；外部通道未跑成）

| # | 轴 | 严重度 | 发现 | 判据（当场取证） | 处置 |
|---|---|---|---|---|---|
| S-1 | 后端 | Warning | 逐平台表落地后，`PLATFORM_FREQUENCY_POLICY` 若仍留档位值，同一平台在两张表里有两个账号档，读哪张取决于调用点 | 实现初稿即如此（派生表未替换）；`calibrate-publish-frequency.js` 直接读派生表，而守卫读 `resolveIntervals` | 派生表账号档替换为逐平台值 + **新增锁**「派生表与逐平台表必须是同一个账号档」（另两维仍按档，参照值由测试自己写出）；变异 **M5** 取被禁形态（退回 `...TIER_PRESETS[tier]`）⇒ 恰好 1 条指名红 |
| S-2 | 前端 | Warning | 组件按三维元组分组会把视频号自成一条 `clip（1 个平台…）`，是同屏假陈述 | 逐行读 `currentTierText`，并按 v5 表手工推演分组数（long 1 + clip 2 + short 1 = 4 行、其中两行同名） | 分组键改回 `tier`、账号档给区间；新增用例断言"同一档位标签只出现一次"且含 `3–60 min` |
| S-3 | 后端 | Info（未采纳） | 初判"应把 `accountMinMsByPlatform` 的 env 也做进 `resolvePolicyOverrides` 共用一份校验" | 两条入口的合法域**刻意不同**（env 侧接受非整数并 floor、超界钳位；覆盖侧要求整数且超界作废），共用一份会把差异抹平 | 不改；把"为什么两档严格度不同"写进 PRD §4 与代码注释，供下一个会话复核而非重查 |
| S-4 | 前端 | 撤回（我读错） | 初判"渲染层已有 `0.4` 抖动字面量属本片引入的第二份真源" | 该字面量在 v2 既有代码里（`form.jitterOn ? 0.4 : 0`），本片未触碰；把它算成本片缺陷是错认领 | 撤回；不顺手改（改它属另一片：`DEFAULT_JITTER_RATIO` 应由 `getPolicy` 下发） |
| S-5 | 规格轴 | Warning | 主规格「间隔维度与策略单一真源」原文写"按平台返回两档"，v5 之后账号档**逐平台**这一维的归属必须在规格里可判 | `openspec/specs/publish-frequency-control/spec.md:33-55` | delta 以 4 条 ADDED 补齐（不新造 capability）；`openspec validate --strict` 转 valid |

**变异反证（拆文件后共 9 道 M1–M9）：8 道 CAUGHT 且各自指名，M2 报 `ANCHOR_NOT_FOUND`**：M1 优先级链翻转 / M2 env 一半生效（`return null`→`continue`）/ M3 兜底直接返回基线常量 / M4 两解析函数互调 / M5 派生表不采用逐平台档 / M6 渲染层提交空 map / M7 渲染层自带 `tencent_video: 60 * 60000` / M8 IPC 不下发默认表；**M2 的锚点是整行 warn 文案，拆文件后与源码漂移 ⇒ 命中 0，不掩成 CAUGHT**（它要打的判据「env 值非法整条作废」本身由行为锁 L4 覆盖，两次全量跑绿）。每道还原后与原文件 md5 逐字节相同。驱动第一版把测试路径写成仓库相对路径（对被调 cwd 不存在），8 道全被判 `PROBE_BLIND`——"驱动没跑成"与"变异没被抓到"必须分档，已改为盲窗出声并打印原始输出前 600 字。

### 遗留（不假装已闭合）

- **视频号 60′ 是拍的**：没有任何平台公布过量化间隔；它应被运营数据（发布成功率／限流投诉）推翻或确认。代码注释、PRD §2、表内注释三处都写作"暂定"，就是为了让下一次改它不需要先论证"为什么可以改"。
- **60′ 与日配额 350 不对称**：单账号按间隔一天最多 24 条，配额远未触及；运营口径的"日发 1–5 条"两者都没覆盖。是否为视频号单独收配额属产品拍板项（PRD v5 §9）。
- **定时发布表单仍是 5 分钟输入期校验**（`publish-schedule-contract.js`）：可对视频号排两条相隔 5 分钟的定时任务，表单放行、发布时由守卫推迟——"能提交但会等"。改成逐平台要先决定"冲突时拒填还是自动顺延"。
- **吞吐影响未实测**：批量发布在视频号通道会显著变慢；回退成本是一行数据。
- **渲染层仍有 `0.4` 抖动字面量**（S-4，既有）：真源应是 `DEFAULT_JITTER_RATIO` 经 `getPolicy` 下发，另片处理。

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 PASS（6a2ea303e 上 `node scripts/check-no-brand-residue.js` rc=0，扫描 9806 个 tracked 文件无残留） | 文档同步 PASS（6a2ea303e 上 `node scripts/openspec-sync-check.js` rc=0：387 tasks / 57 active changes / 231 archives） | 远程同步 PASS

| 合并后 main push 回读（收尾第 7 条） | PASS | run `39022030228`（event=push, workflow=quality-gate.yml, head=29e5a60cd）conclusion=`success`，取证命令 `gh run list -R Colinchiu007/mulpub --workflow=quality-gate.yml --commit 29e5a60cdcedec8eadeccb3ad1f14061b6010e73 --json databaseId,conclusion,event`。PR 侧全绿不等于改动在 main 上成立，故本行只认该 merge SHA 上的 push run 实测结论。 |
