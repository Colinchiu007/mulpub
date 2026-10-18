---
record: podcast-voice-origin-tristate
task: 补 PRD §8.2.9 判据 2「① 命中不显示」与判据 1 的闭集外出声（tasks 4.5b① 的渲染层那一半）
date: 2026-10-19
---

## 本次执行记录：音色来源三态标注的抑制与闭集外出声（podcast-voice-origin-tristate，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码任务，隔离 worktree `mp-podcast-voice-origin-tristate`（分支 `podcast-voice-origin-tristate`，`scripts/start-mp-task.ps1` 创建，`node scripts/verify-worktree-deps.js` OK）。改动集：`apps/desktop/src/components/PodcastScriptEntry.vue` + 同目录 `.test.js` + 本记录 + `CHANGELOG.md`。**未触 `electron/`**（无 IPC/preload/主进程改动）⇒ 分层上仍属运行时代码（渲染层产物），故走 worktree + 完整 CI。 |
| 第一性原因（QM-5 ①） | ✅ | 引入点是 4.5 的 UI 半片：`originLabel` 被写成 `ORIGIN_KEYS[voice.origin]` 的直接查表（旧 `:73-74`），而那张表同时承担了两件不同的事——「有哪些档位」（闭集）与「哪些档位要出声」（标注资格）。§8.2.9 判据 2 要的正是后者：① 命中时**不**告诉用户来源。一张表兼两个语义，结果就是三档全出声。同一次落地还漏了判据 1 要求的"闭集外取值的 warn"——闭集外取值走的是同一条查表路径，`key` 为假 ⇒ 静默返回空串，既不显示也不出声，与"按判据 1 拒绝伪造"看起来一模一样。 |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：`PodcastScriptEntry.test.js` 落地时**一条断言都没看过那句标注**——`PLAN_OK` 夹具（`:38`）里 `origin: 'preference'` 是唯一被渲染过的取值，而用例只断言 `[data-testid="podcast-script-voice"]` 段里含 `prov_x`，从没找过那个 `<span>`；于是"三档全出声"与"只有该出声的档出声"在这套用例下**完全同形**。②选择器层：那个 span 当时**没有 `data-testid`**，只有 class——不是"测试没写"而是"没有稳定锚点可写"，这属本仓「可键盘访问/可断言性」那条纪律的同一格：没有 testid 的节点，断言成本会被读成"不值得测"。③审查层：§8.2.9 的七条判据在 4.5 落地时只被逐条实现了一部分，没有东西在数"哪几条有对应指名用例"，所以第 2 条与第 1 条的后半安静地缺失。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 实现：`ORIGIN_KEYS`（闭集，三把键）与新增 `ANNOTATED_ORIGINS = ['preference','providerDefault']`（标注资格白名单）**分成两张表**，注释明写"这张是要不要出声，不是有哪些档——判据 1 的闭集仍是上面那三把键，别把这里当闭集用"；`originLabel` 收敛为三段：无 origin → 空、闭集外 → `console.warn` + 空（**不得兜底成 `channel`**）、非白名单 → 空。模板给 span 补 `data-testid="podcast-script-voice-origin"`。回归保护 4 条：②/③ 各一条"标注必须出现且等于真实 locale 值"（用 `zh.podcast.episode.origin*` 的**值**断言，键存在取不到时 vue-i18n 会把键名打到界面上而门禁照绿，这条沿用同文件既有写法）、`origin=channel` 一条"标注不出现 + **三段照常显示**"、闭集外一条"不出现 + 不兜底成频道文案 + warn 恰好一次"。末态：`PodcastScriptEntry.test.js` **17 passed**（原 13 + 新 4）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **把"有哪些档"与"哪些档要出声"拆成两张表**——这是本片唯一的结构性动作，M1（往白名单里塞 `channel`）与 M2（清空白名单）因此打在不同格子上、红的是不同的用例，说明两轴真的分开了；同族反例是本仓「枚举式黑名单必须配结构化正向契约」。② **新增的可见元素必须同时有稳定锚点**：本片把 span 补上 `data-testid` 才写得出断言——顺序应该是"要测的东西先给锚点"，而不是"没锚点就先不测"。③ 判据类规格（§8.2.9 的七条）在实现时**逐条绑一条指名用例**，没绑的要在记录里点名——本片的 4.5b① 就是 §8.2.9 判据 1/2 之前没绑造成的静默缺失，这一条与 5.1b②/3.6b② 一起进 PRD 的落地状态段。 |
| 行尾与 diff 对账 | ✅ | `PodcastScriptEntry.vue` 工作副本 `i/lf w/crlf attr/text=auto`（`git ls-files --eol` 现读）。变异驱动因此按 `(line, sep)` 成对切分回写、锚点匹配前剥 `\r`；提交后 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相等（读数在下「判定读数」）。 |
| 接线棘轮 | N/A | 不新增测试文件；两条新锁落在既有 `PodcastScriptEntry.test.js` 内，`check-unwired-tests.js` 扫描域无新命中。跑测证据是 runner 的通过清单（17 passed），不是 `node --check`。 |
| QM-1 打包 / QM-4 视觉 | ✅ | QM-1：未触 `apps/desktop/electron/` 与 `packages/rpa-engine/` ⇒ 不触发本地打包判据（判据原文的触发面是这两处）。QM-4：改动只落在**打开浮层之后**才出现的元素（`v-if="voice"` 段内的 span），像素基线取的是各视图的初始态，不含该浮层；本片因此不产生基线漂移，`QG Visual` 由 CI 全量复核（该 check 是本 PR 的 required 项之一，读数合并前现取）。 |
| QM-6 CCG 双模型外部评审 | ✅ | 判定产物由 pre-commit 落 `.ccg/reviews/<sha>.json`：改动集小（渲染层两文件）⇒ `mode` 非 `dual`，**未调用外部模型**；本行必须被读成"外部评审未做"。替代证据是五条变异反证各自指名红（见下行）与逐条锚定的 §8.2.9 判据。下一片若把 `voiceRef` 写侧（4.5b②）接进主进程，届时触 `ipc-handlers`/`preload` ⇒ QM-1 必跑且变更规模大概率进 `dual` 档，不得沿用本片"已审过"的说法。 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。合并后的 main push 回读证据写进 PR 评论，不写回本文件。 |

## 变异反证（5 条，全部 CAUGHT；驱动 `<本机临时目录>/mutate-voice-origin.cjs`）

判据一律"failed≥1 **且**失败用例名含预期的那一条"——只数条数会把"旁路用例被撞红"读成"这条锁有牙"。

- `M1` 白名单放进 `channel`（判据 2 的标准错法）⇒ `collected=17 failed=1`，红的是「origin=channel ⇒ 整行不显示标注…」，断言原文 `① 命中还告诉用户来源 ⇒ §8.2.9 判据 2: expected true to be false`。
- `M2` 白名单清空（恒不标注）⇒ `failed=2`，红的正是 ②③ 两条正控。**M1 与 M2 红集不同**这一事实本身就是"两轴拆开了"的证据；若两张表仍合一，这两条变异会打在同一格上。
- `M3` 摘掉 warn ⇒ `failed=1`，红在闭集外那条（`expected "warn" to be called 1 times, but got 0 times`）。
- `M4` 闭集外兜底成 `channel` 文案（伪造来源）⇒ `failed=1`，红的也是闭集外那条。**M3/M4 的红集重合**（同一条用例内的两个断言：一个测出声、一个测不伪造），如实写成"同一格的两个方向"，不报成两道独立的闸。
- `M5` 撤标注时把三段音色一起撤掉 ⇒ `failed=1`，红在 `origin=channel` 那条的第二组断言（`撤标注时把三段也一起撤掉了: expected false to be true`）——这条变异的存在理由就是判据 2 常被写过头：撤的是那句来源说明，不是那一段。
- 还原：每条 `finally` 按字节写回并核 md5（`8ab85cfb`），不等即抛错。

## 判定读数（commit 之后现取，禁止预写）

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（含 `.vue` 运行时改动）。
- `node .github/scripts/check-max-lines.js` → OK；`PodcastScriptEntry.vue` 现为 178 行以下的非点名文件，读数由判据自己打印。
- `node scripts/check-record-qm5-rows.js --base=<merge-base> --head=HEAD` → OK（①②④⑤ 齐）。
- `node scripts/check-doc-abs-paths.js --base=<merge-base> --head=HEAD` → PASS；`scripts/doc-abs-paths-baseline.json` 未改动。
- `node scripts/check-changelog-growth.js --base=<merge-base> --head=HEAD` → PASS。
- `node scripts/check-locale-sync.js`（Gate 7 域）→ 本片**未新增任何 locale 键**，三把 `podcast.episode.origin*` 是既有键；zh/en 成对由既有键保证，无新增面。

## 本 PR 故意没做（写出来，不当遗漏）

- **§8.2.9 判据 7「视频那枚落点也标注」没做，另立 `tasks 4.5b③`**。实测：`PodcastEpisodeEntry.vue`（`ResultView.vue` / `CreateView.vue` 用的视频出期浮层）里 `voice|origin` 命中 0，它整段不消费 `podcast:episode:planPreview`——给那里加一行来源标注，等价于把"块数/码点/音色三段"整条读路径也搬进视频浮层，属新增跨层消费面而不是本片的"改一句显示判据"。已登记，随下一次动视频浮层时一起做。
- **没有把 `ANNOTATED_ORIGINS` 改成从主进程返回值派生**。标注资格是产品判据（"要不要告诉用户"），不是解析结果；让它跟 `origin` 一起从 IPC 下发会把一条 UI 决策搬到主进程，且 §8.2.9 判据 4 明令"回退顺序不得有两份实现"之外并没有要求"出声与否"由后端给。
- **没顺手把 `origin` 的闭集校验搬到渲染层做拒绝**。渲染层只负责"取到闭集外的值时不伪造、要出声"；真拒绝发生在主进程解析层（`podcast-tts-voice.js` 的四档链），那里已有自己的锁。
