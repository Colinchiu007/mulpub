---
record: podcast-stock-summary
task: 落 PRD §7.9.4 的最后一条显示项——频道页存量固化摘要（扫描 / 补齐 / 待人工），并把「缺席」与「0」这两种事实在代码里分开
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 合并后由后续 docs PR 按既有 PASS 口径回填 merge SHA 与时间，并在同一次提交删除 frontmatter 三字段与本记录对应的 ledger 登记项
sync_backfill_owner: agent 收尾链（回填 = 合并后第一笔 docs PR）
---

# 频道页固化摘要（podcast-stock-summary，2026-10-15）

> 分支 `podcast-stock-summary`（worktree `D:/Data/projects/mp-worktrees/mp-podcast-stock-summary`，非 C 盘），起点 `5b4adbcf2` = 当时 origin/main；**基线演进链**：5b4adbcf2 → 8e9109a55 →（#3620 判据改造落地后）b7a0b34d1 → 58256ffc8，最终树按一次性重放落在 58256ffc8（非载体整取 tip、三个顶部追加载体以主干为底插回自己那块；重放后 `git diff --name-status origin/main` 的 D 计数为 **0**，主干记录块与 26 个 ledger 键全在）。合同 = PRD §7.9.4；对应 `openspec/changes/podcast-oneclick-publish/tasks.md` 的 **4.4b③**。

## 这一片要解决的不是排版

存量 `mime` 固化（§7.9）早就落地了，但它把结论写进 `index.json` 之后**没有任何地方把它说给用户听**。§7.9.4 要求的摘要行看起来只是"加一段文案"，真正要决定的是：**当固化发生过、但我读不懂它的计数时，界面上该出现什么。**

三个候选里只有一个是诚实的：

- 回落 `0` ⇒ 界面写「扫描 0 期，补齐 0 期」。用户读成"没有存量需要处理"，而事实是"这份凭据我不认识"。**把未知伪装成结论**，且方向恰好是让人不再去查。
- 报错 ⇒ 一条纯展示旁路把整份单集列表判失败，违反 §8.2.3「主路不得被旁路毁掉」。
- **整行不显示 + 一条 warn** ⇒ 用户看不到假结论，排障的人在日志里看得到"凭据在位但计数不齐"。本片取这一条。

同理，`unresolved === 0` 时只省略「待人工」那一段（§7.9.4 原话：避免制造不存在的待办），摘要主体照显示——0 在这里是**实测值**，必须显示；缺席才是不能显示。这两件事在类型上必须分开，所以 `stock` 的取值是 `{scanned,filled,unresolved} | null`，没有第三种，也不允许出现 `{scanned: 0, filled: 0}` 这种由缺席伪造出来的对象。

## 落点与唯一实现

| 落点 | 文件 | 承担什么 |
| --- | --- | --- |
| 凭据 | `services/podcast-episode-compliance.js` `readStockStampRecord()` | 读整份 `stockStamp`；`at` 不在位即 `null`；返回解析产物的拷贝 |
| 投影 | 同上 `readStockStamp()` | 刻意做成上面那一次的 `.at` 投影，**不是**第二份读路径 |
| 摘要 | 同上 `toFreezeSummary()` + `isMeasuredCount()` | 只投影三个非负安全整数；任一不齐即 `null` |
| 组装 | `ipc-handlers/podcast.js` `episode:list` | 读**一次** index 喂两个消费者；返回值增 `stock` 键；计数不齐时 warn |
| 状态 | `src/composables/usePodcastChannel.js` `stockSummary` | 成功/失败两条出口都赋值，不留上一个频道的残值 |
| 显示 | `src/views/PodcastChannelView.vue` 区块二 | `podcast-stock-summary` 一行；`unresolved > 0` 才渲染 `podcast-stock-unresolved` |
| 文案 | `src/locales/podcast/{zh,en}.js` | `podcast.stock.{freezeSummary,unresolved}` 两对成对 |

**故意不落的那一对**：`podcast.compliance.stock` 在 §7.9.4 的表里与上面两对并列，但它的消费方是 §8.2.5 的三态徽标（tasks 4.5）。现在写进 locales 就是一段没有任何调用点的文案，AGENTS.md 明令禁止为不可达路径建 locale 键，`src/locales/podcast-error-codes.test.js` 那类清点式守卫也会把死键判红。这条偏差已写进 PRD §7.9.4 的落地增量，不是遗漏。

## 为什么"只读一次"值得单独一条锁

`compliance` 只要 `at`，摘要要三个计数。各读一遍 `index.json` 在稳态下行为完全相同，所以它对"两次读之间有人固化完落盘"这一类缺陷**结构性免疫**：一处判出 `stock` 档、另一处报出上一轮的计数，界面就同时显示"存量沿用"和一组对不上号的数。锁的写法是**按路径过滤**的调用计数（`reads.filter(f => f === indexFile)` 长度必须为 1），且同一条用例同时断言两个消费者都有产物——否则"谁都没读到"也能让计数为 1（M6 实测：让两个消费者各读一遍，只有这条变红）。

## 测试与反证（全部实跑数字）

- TDD 两段：基线 **66 passed / 0 failed**（`podcast-episode-compliance.test.js` + `ipc-handlers/podcast.test.js` + `PodcastChannelView.test.js`）⇒ 只改测试 **17 条指名红 / 0 LOADFAIL** ⇒ 补实现后 80 ⇒ 「符号放宽」「多读一次」各拆独立用例后 **88 passed / 0 failed**。
- 随合同改写的既有锁三处（不是放宽，是让新键在账上现形）：成功信封逐字对账增 `stock: null`、`Object.keys(res.data)` 增第四键、两处 `complianceMod` 夹具从"只抄 `annotateEpisodes`"改为与真模块同面（否则"旁路炸了"那条测的会变成 TypeError 而不是装配抛错）。
- 消费者并集（**按 import 限定符取，不按"我改的文件"、也不按裸词**）：最终基线现值 **17 文件 346 passed / 0 failed**（演进：旧基线 15 文件 215→220 passed；本轮把取法从裸词 podcast 收紧为"stem 紧跟限定符收尾引号"（如 'stem'），因为裸词会把"提到过 podcast 的测试"全算成消费者，实测虚报 30+ 个）。
  含 `electron/preload/podcast.test.js`、`electron/tests/ipc-exposure-contract.test.js`、`src/locales/podcast-error-codes.test.js`、`src/i18n/glossary.test.js`。另两个 stem 零命中（`usePodcastChannelEndpoints` 只被 view 引用、`PodcastChannelView` 的测试按 .vue 后缀 import）——驱动对"全部零命中"抛错而非放行，所以这次是逐个报出的可信零。，含 `electron/preload/podcast.test.js`、`electron/tests/ipc-exposure-contract.test.js`、`src/locales/podcast-error-codes.test.js`、`src/i18n/glossary.test.js`。
- 变异十二条（M1–M12），全部被抓、各有**指名**红、逐条 md5 还原一致、还原后重跑 83/0：M1 缺席回落 0（2–3 红，其中 ipc「计数不齐 ⇒ null 且出声」独属它）/ M2 负数当计数（独属「负数计数不是实测值」）/ M3 原对象直传（独属「只投影三个计数」）/ M4 待人工 0 也显示（独属「unresolved 为 0 不显示」）/ M5 失败轮不清摘要（独属同一实例三轮转那一条）/ M6 各读一遍 index（独属「只被读一次」）/ M7 `readStockStamp` 自己再解析（独属结构锁）。
- 两条流程教训当场改掉：① **第一跑 M2 的红集被 M1 包含、M6 被 M3 包含**——多种形态压在一条按表用例里，红读起来互相包含，等于"锁没牙"；拆成独立用例才分格。② **变异还原不能用反向替换**：M5 的反向锚点 `episodesError.value = res.code || IPC_EXCEPTION` 在该文件有 3 处命中，还原当场抛错、把变异留在文件里；改成"变异前存字节快照、还原即整文件写回并回读校验 md5"。
- QM-1（最终基线 58256ffc8 上重取，**两段分开报，不合并成一句"通过"**）：
  1. **构建与归属：已复证。** `pnpm run build` + `electron-builder --win --dir` 成功，asar 151,246,627 字节；包内 blob 与工作树源码**逐字节相同**三条全 true（compliance 10,568 / ipc-handlers podcast 22,710 / 未改动对照组 stock-mime 7,738），本切片独有符号命中 1/1/1 与 1/1/3，包内测试文件 **0** 条。
     这一条是**修好探针之后**的数：第一次实跑所有符号计数为 0，我一度据此判"产物里没有"，实为 `extractFile` 的条目名以**反斜杠**开头而我只剥了正斜杠 ⇒ 探针没落到坐标上。v2 探针的次序改成「先列出包内条目名证明坐标、再读 blob 比字节、最后才数符号」，并在坐标全空时直接判 FAIL。
  2. **启动存活：本轮不可重取，未判通过。** 干净读数要求 `proc_count_before=0`，而本机此刻有 **7 个其它 `Multi-Publish.exe` 实例**在跑（路径不等于本 worktree ⇒ 属别的 worktree 或用户自己开着的应用，**不 kill、不据此判定**；脚本对这种情况 exit 3 拒绝启动验证，而不是跳过）。我自己遗留的 8 个实例已按 PID 精确清掉。
     同一轮内还有一次 `alive_after_12s=no` + LIVE stderr 0 字节——按主干新写进 AGENTS 的那条（存活是三层判据的隐含前提；进程提前退出时 stderr 必然为空 ⇒ 只看 stderr 会把"根本没启动"读成"启动干净"）**判不成立**，我没有把它记作第③层。另：我先怀疑过是继承的 `ELECTRON_RUN_AS_NODE`，实测本 shell 该变量未设，这个归因当场否证。
  3. 前一基线上那次完整第③层证据（LIVE stderr 0 字节、四类红线 0、DEP0180 0、12 秒存活、stdout 22,299 字节业务日志、POST 增量 270 字节全额归因于我自己的 SIGTERM）仍然有效，但它不是最终基线的读数，**不拿来顶替**。
  4. 三个被打包重生的 tracked bundle 已按精确单文件还原（禁宽目录）。
- 顺带修的生成器缺陷与它的三条反证（G1 越界当场抛错且 PRD 未变 / G2 摘掉区间判据就真的吞掉 §8.2 / G3 摘掉段外判据输出逐字节相同并证幂等）同见 `.quality-gates.md`。

## 与合同的差集（不虚报）

- `podcast.compliance.stock` 未落，归 tasks 4.5（理由见上）。
- 摘要只在 `episode:list` 成功时更新；`stockStamp` 的**历史序列**（多次固化）不在本期范围，`index.json` 也只保留最后一份——这与 §7.9.2「恰好一次」是同一条决定的两个面，未扩。
- 视觉基线未重取：本片的 `<p>` 挂在 `v-if="stockSummary"` 上，而在无 `window.electronAPI` 的 dev-server 渲染里 `stock` 恒为 `null`（由「没有 stockStamp → 整行不渲染」那条用例实测覆盖），DOM 逐字不变 ⇒ 不给 `podcast-channel*.png` 制造漂移；真正的像素证据归 CI 的 `QG Visual`。
- QM-6 双模型外部评审：见下一节逐条处置。

## QM-6 双模型外部评审（逐条处置）

**轴状态如实报**：后端 `claude` 与本片实现 diff 并行派发（结论见下一小节，未按时长判成败）；前端 `opencode` 属**第六种"跑完但没 findings"**——stdout 里只有 `## Objective / ## Work State / ## Next Move` 就停在 `SESSION_ID:`，没有任何 JSON findings。因此本片**不写成"双模型通过"**；前端轴的替代证据是它留下的 6 条线索被逐条取证并处置：

| 线索 | 判定 | 依据与处置 |
| --- | --- | --- |
| L1 结构锁用 `code.slice(i, i + 240)` 硬编码窗口 | **成立，已修** | 窗口截断点是字符数不是语义边界：`readStockStamp` 一旦变长，`seg` 会在读到 `readFileSync` 之前就结束，那条"不得出现 readFileSync / existsSync"的**负断言静默成立**——这是会因实现变长而失效的锁。改法：起点之后按 `/(\r?\n})/` 取该函数自己的闭合括号，并加一条完整性断言（截出来的必须含 `return rec ? rec.at : null`），否则负断言无意义。修完先红过一次：我把 `i + close.index + close[0].length` 误写成 `i + close[0].length`，seg 变成「fu」，完整性断言当场把它抓住——**完整性断言的价值当场兑现了一次**。 |
| L4 `Object.assign({}, stamp, { at })` 的 `__proto__` 面 | **成立，已修** | `Object.assign` 用 [[Set]]，对键名 `__proto__` 会触发 `Object.prototype` 的那个 setter；展开语法用 CreateDataProperty，语义等价且免疫。来源是自家写的 `index.json`，风险等级低，但免疫只要一行，另配一条断言「`Object.getPrototypeOf(rec) === Object.prototype` 且 `rec.polluted` 为 undefined」的行为锁。反证 M8：退回 `Object.assign` 必须变红，已实跑。 |
| L5 畸形 stamp 每轮 list 重复 warn | **成立，已修** | 畸形凭据是**常驻状态**，不去重就每次刷新同一句，刷屏会把真信号冲掉。位点放在 `registerHandlers` 的**闭包**而不是模块作用域——模块级标记是跨用例状态，本仓在 vitest 下已被"测试侧 import 与生产侧 require 是两份实例"反复坑过。行为锁断言的是「去重 ≠ 静默」：三次列表调用后 warn 恰好 1 次，而不是 0 次。反证 M9 实跑。 |
| L2 渲染端不校验 `res.stock` 形状 | **拒绝修法，采纳观察** | 在渲染端再判一次三个计数是不是非负整数，等于把 `toFreezeSummary` 的判据抄第二份，而且抄在另一个运行时（主进程 CJS / 渲染端 ESM），两侧必然漂移——本仓记过多次「谁的判据生效交给了调用顺序」。跨层同结论改由两处共同钉：ipc 侧 `toEqual({scanned, filled, unresolved})` 精确键集 + 视图侧按值插值断言。 |
| L3 赋值的是引用不是拷贝 | **拒绝** | IPC 每次返回结构化克隆后反序列化的新对象，不存在跨轮共享；加一次拷贝等于宣称这道边界不可信，与"生产者单点判据"的设计直接冲突，且没有任何可观测差异支撑它。 |
| L6 返回键扩展 / `dist/` 为旧构建 | **无需动作** | 键扩展是追加式合同本身，既有逐字锁已同步改；`dist/` 是构建产物（gitignored），本片在拆分后已重跑 `pnpm run build` rc=0。 |

## CI 首轮的两条红，以及为什么处置不是"挂账"

① `逐文件行数门禁` 报 `usePodcastChannel.js 507 行 >= 500`——本片 +10 行把这份 composable 推过线。**没有**把它加进 `scripts/debt-baseline.json`：AGENTS.md 对"测试在 CI 红"的处置明确共同禁止放宽断言 / 加 skip / 再登记成欠账，那三种都是拆锁留一盏绿灯。正解是按仓内已有先例（`usePodcastChannelPicker.js` / `usePodcastChannelActions.js`）把**分发端目录域**拆成 `usePodcastChannelEndpoints.js`：这个域本来就是"只读目录 + IPC 不可达时降级本地 ESM 孪生"，与页面写路径各有不变量，拆完 492 行，`pnpm run build` 与全量并集复验。
② `Gate 2c-copy` 报 PRD 逐字表漂移——就是我新增的两把键（`--apply` 后差集为 0、两份 PRD 双 OK）。这条恰好印证逐字表必须脚本生成：手工抄的那两份表就是靠这个门禁发现已经漂了。

## QM-6 后端轴（`claude`）逐条处置

载荷是第三种字段形状（`{file,line,category,verdict,severity,summary,detail}`，`verdict ∈ CONFIRMED|PLAUSIBLE`）；我的解析器按 `issue/fix` 取字段时把 6 条打印成空——**"看着没有内容"是解析器形状不对，不是模型没话说**，解析器必须连"字段命中数"一起打印。

| 编号 | 主张 | 核实结论 | 处置 |
| --- | --- | --- | --- |
| B1 (medium) | `getService()` 里固化是 fire-and-forget，同一次 `episode:list` 随后同步读 index ⇒ 首次进页摘要几乎必然为空 | **观察成立** | **本片不改**：唯一便宜的改法是把固化 `await` 在列表路径之前，直接违反 §8.2.3「旁路不得成为主路的等待对象」；另一条是新增"固化完成"事件通道（IPC 事件 + preload 暴露面 + store 订阅），是自成一页的跨层改动。当前行为是诚实的 `null`（整行不显示，不会显示 0）。已登记进 PRD §13。 |
| B2 (medium) | `toFreezeSummary` 丢掉 `stockStamp.unresolvedChannels` ⇒ 整频道被跳过时显示成「补齐 M 期」且无待办 | **成立**（且是本 PR 自己那条原则的第二个落点） | 摘要扩成 `{scanned,filled,unresolved,skippedChannels}`；数组缺席/非数组 ⇒ **整份判 null**（不给未知补 0）；视图新增 `podcast-stock-skipped` 段；locales 补第三对键（此时它才有消费方，不是死键）；PRD §7.9.4 显示项与提示文字表同步回写；反证 M10。 |
| B3 (low) | `scanned = 数组长度`，含非对象元素时会大于真正可见的期数 | 观察成立，**落点不在本片** | `scanned` 的口径由 §7.9.5 的既有锁钉在固化层（4.4 那一片），改它要动那片的计数锁，登记为固化层独立欠账（PRD §13）。 |
| B4 (PLAUSIBLE) | `readStockStampRecord` 没走 registry 的 index 锁 | **不成立**（给证据后拒绝） | 写侧走 `tmp + renameSync` 原子替换（`podcast-channel-registry.js:97/102`），并发读者只会看到完整旧文件或完整新文件；读侧 `try/catch` 已把解析失败降级成 `null` + warn。`PLAUSIBLE` 不等于要改，必须先核。 |
| B5 (PLAUSIBLE) | `onChannelActivated` 清了 episodes 却没清 `stockSummary` | **成立** | 补进清理清单，并加一条**结构锁**断言清单里必须有 `stockSummary.value = null` 这个**赋值**（瞬时窗口在行为测试里要挂起 promise 才可表示，成本不成比例；只出现名字不算清理）。反证 M11。 |
| B6 (low) | 渲染端对 `res.stock` 只判 null、不校验形状 | 与前端轴 L2 同一条 | **拒绝修法**：再判一次＝把主进程判据抄第二份且抄在另一个运行时，两侧必漂移；跨层同结论由 ipc 精确 `toEqual` + 视图按值断言两处共同钉住。 |

## QM-1（最终基线重取的读数）

顺序是 **实现稳定 → 打包 → 复测 → 才允许跑变异**；反过来（打包进行中源码被变异写过）会让产物字节来自被污染的副本，后面所有 asar 命中与存活证据整体作废。因此本组读数是拆分与 QM-6 落码**之后**重取的，第一轮读数作废并已如实标注。

- 前置：`node scripts/verify-worktree-deps.js` OK（11 项消费方解析到当前 worktree）；`pnpm run build` rc=0（310s）；`electron-builder --win --dir` rc=0（141s）；`dist-electron` 先经可逆改名挪走并断言不存在，之后 asar 命中才可能来自本分支。
- 产物：asar **151,637,919 字节 / 14993 条**（第三次重取：B2/B5 落码又改了 `podcast-episode-compliance.js`，不重取就等于拿旧树读数给新树作证）。
- 归属两级：路径命中 1 / 1 / 对照 1、测试文件 0；**包内 blob == 工作树源码（去 CR 逐字节相等）**，三对全 true，其中 `podcast-episode-stock-mime.js` 是我没改动的对照组。本切片独有符号各 1；`mod.readStockStamp(` = 0（第二份读路径确实不在产物里）。
- 存活：`proc_count_before=0`、12 秒存活；**LIVE stderr 0 字节 / 0 行**，四类红线、`DEP0180`、`app.asar` 内部路径命中全 0 ⇒ 三层判据落在第③层。POST 增量 270 字节是自己 SIGTERM 的收尾话，留痕不计入；业务日志在 stdout（22,352 字节）。
- 收尾：三个 tracked bundle 按精确单文件路径还原（`git status` 里不再有它们的 M）。
- 探针教训（同型第三次）：第一版脚本用 `asar extract-file` 抽到临时目录再 grep，符号全报 **0** ——`pnpm --dir` 把抽取结果写进 `--dir` 的 cwd、本仓装的是 `@electron/asar`（`asar` 这个名字不存在）、Windows 包内条目用反斜杠。这次"0 命中"如果照抄进记录，就是一条**探针失明被写成产物缺失**的假结论。

## 远程同步

| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在 |
