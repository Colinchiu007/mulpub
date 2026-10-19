---
record: podcast-test-seam-debt
task: 还清播客出期链的两笔测试侧债——fixture 尺寸常量收敛为单一真源（3.11/F9）+ 忙标记的公开出口观察与单例取源防回潮锁（3.12）
date: 2026-10-19
---

## 本次执行记录：播客出期链测试侧两笔债（podcast-test-seam-debt，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码任务，隔离 worktree `mp-podcast-test-seam-debt`（分支 `podcast-test-seam-debt`，由 `scripts/start-mp-task.ps1` 创建；`node scripts/verify-worktree-deps.js` OK，11 项消费方解析指向本工作区）。改动只落在两个测试文件 + 本记录 + CHANGELOG；**生产代码零改动**（变异跑的是被测文件，跑完按字节还原，见变异行）。 |
| 第一性原因（QM-5 ①） | ✅ | 两笔债同源：**夹具与被测方各拿一份"自己想象中的对方"**。① `podcast-episode-publish.test.js` 的音频字节数在六处手写同一个数（写盘 / 申报 / 上传回显 / 下游断言 / 两处旁路夹具），改动尺寸要记起六处，而这条链上唯一的兜底 `assertUploadSizeMatches` 测的是**生产判据**，不是"这份夹具自己是否同源"——它红了也只说"两处不一样"，不指哪一处是错的。② `podcast-hosting-service.test.js` 的"发布结束忙标记已释放"是对协作方内部状态的白盒读取（`channelBusyGate.isBusy()===false`），而用户侧那件事是"下一次还能不能发出去"；两者在"释放了但把通行证也一起丢了""失败后占位没清但下一次恰好换了频道"这类错法上并不同形。另记一条被本轮否证的旧归因：tasks 3.12 原文写"直接 `import` 拿到另一份实例"——**取源那一半早在上一刀已改 `require`**（该文件 `:24`），真正的残留只有观察面，所以本片没有把它当新发现再修一遍。 |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：六处手写常量之间没有任何东西在数，改成五处一致、一处不一致时，只有恰好走到那处断言的用例会红，其余照绿——本轮 M1 实测退回一处手写即"只有那条新锁红"，反证旧形态下确实无人看。②断言层：白盒 `isBusy()` 断言把"协作方状态干净"断言成正确行为本身，测试通过≠用户能再发一次（同类教训见 AGENTS「测试断言不得反向固化错误行为」）。③门禁层：`check-max-lines`/ESLint 都看不出夹具内部抄了几个数；`check-unwired-tests.js` 只管新文件接线，管不到既有文件里的耦合。④审查层：F9/F8 由 QM-6 后端评审登记成编号欠账（tasks 3.7 ①–⑧），登记之后**没有任何机械东西在等这笔账**，与"装饰性门禁"同型。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 3.11：`podcast-episode-publish.test.js` 新增模块级 `const AUDIO_BYTES = 1000`，六处全部改从它派生，其中 SIZE_MISMATCH 那条改成显式的 `AUDIO_BYTES - 1`（把"故意差一点"的意图写进表达式，而不是留一个看不出关系的 999）；同文件末尾加一条接线锁——数本文件的 `\b1000\b` 字面量，必须恰好 1 处，并带两条反失明正控（读到行数 > 50、`const AUDIO_BYTES =` 必须在位，否则"0 命中"会被读成"通过"）。3.12：新增一条走**公开出口**的行为锁「主键 PUT 失败之后，下一次发布必须能正常发出」；新增一条单例取源的防回潮锁（必须 `require('./podcast-channel-locks')`，且不得出现 `from './podcast-channel-locks'`）。末态读数：`podcast-episode-publish.test.js` **13 passed**（12 原有 + 1 新锁）、`podcast-hosting-service.test.js` **30 passed**（28 原有 + 2 新锁），两者合跑零失败。 |
| 防止再次发生（QM-5 ⑤） | ✅ | 三条落地，不靠自觉：① **夹具里的常量按"谁派生谁引用"收敛，并由一条数自己的锁守住**——这类锁的形态是"读自己的源码数一个模式"，因此必须同时带"读到了没"与"锚点基准在位"两条正控，否则判据退化为恒真（本轮就是这么写的，且 M1 实测指名红）。② **白盒状态断言旁边补一条同义的黑盒行为断言**，而不是替换：`isBusy()` 保留（它给精确归因），新增"下一次真能发出去"（它给用户侧那件事）；两者红集在 MA 下重合，这条重合被如实记进变异行而不是写成两道独立的闸。③ 把"跨模块单例只能经 `require` 取"从散文注释升级为机械锁，并让它对**本文件自己的取源行**负责——下一个人在同文件里改回 `import` 会当场红，而不需要读过这段注释。 |
| 行尾与 diff 对账 | ✅ | 两个被测 `.js` 与记录文件在工作副本里都是 CRLF（变异驱动打印的产物里直接读到 `'/**\r\n * podcast-hosting-service 行为合…'` 自证）。驱动侧两条相应约束：锚点匹配前先剥 `\r`（否则带 `$` 的锚点 0 命中，会被读成"这行不存在"），回写用 `split(/(\r?\n)/)` 保留每个分隔符原样、绝不做整份 `\n` 规范化。提交后按 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径对账，要求逐文件相等（读数记在下「判定读数」）。 |
| 接线棘轮 | N/A | 本 PR **不新增任何测试文件**，两条新锁落在既有被测文件同目录的既有测试文件内（`check-unwired-tests.js` 的扫描域按文件计，无新命中）。既有 runner 实跑证据见上一行的 passed 读数——不是 `node --check`。 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 之外的运行时产物面：改动集只有 `.test.js`（生产文件零改动），不新增 require 目标、不动 `package.json` 的 `files`、不动任何 `.vue`/样式 ⇒ 打包与像素门禁无适用面。判据依据是 `git diff --name-only <base> HEAD` 的实际文件集，不是"看起来像测试改动"。 |
| QM-6 CCG 双模型外部评审 | ✅ | pre-commit 的判定产物按变更规模落 `.ccg/reviews/<sha>.json`：本次改动集为两个测试文件、行数在 `mode=single` 档 ⇒ **未调用外部模型**，本行必须被读成"外部评审未做"，不是"已复核"。风险由两条替代证据承担：两条新锁各有指名红的变异反证（MA/MB），以及每条断言都绑定到具体文件行号。若下一个会话要在此链上动生产代码，不得沿用"这条链已双模型审过"的说法。 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。合并后的 main push 回读证据写在 PR 评论里，不写回本文件（merge SHA 只在合并之后存在）。 |

## 变异反证（两条，各自指名红；驱动 `mutate-312.cjs` / `mutate-f9.cjs` 落在本机临时目录）

- **MA（生产侧精确变异）**：把 `podcast-hosting-service.js` 的 `finally { if (!reentrant) this._registry.endPublish(id) }` 摘掉，改为只在成功路径释放——这正是"失败后占位没清"这一缺陷本体，而不是"整块不释放"那种会把无关条目卷进红集的粗变异。读数：`collected=30 passed=28 failed=2`，红的两条逐字是「主键 PUT 403 → failed，feedSync 记下错误码…」与本片新增的「主键 PUT 失败之后，下一次发布必须能正常发出（公开出口观察，不留占位）」。**红集重合如实写出**：新增那条没有带来一道"互不相同"的闸，它把同一件事改成了用户可观察的形态；原有的白盒断言继续提供精确归因。
- **MB（取源回潮）**：把测试文件的 `require('./podcast-channel-locks')` 换成 ESM `from`。读数：`collected=30 passed=27 failed=3`，其中一条红是**新加的防回潮锁本身**，另两条红（「同频道已有发布在飞 → 立即拒绝」「发布自己写 feedSync 不得被自己的忙标记挡住…」）证明两份实例不是理论担忧——回潮真的会让跨模块断言失效。
- **M1（F9 派生退回手写）**：只把一处 `size: AUDIO_BYTES` 改回字面量 ⇒ `collected=13 passed=12 failed=1`，红的正是那条接线锁，其余 12 条全绿（证明这条锁是唯一的看守者）。**M2（把锁改成恒真 + 同一处手写）**⇒ `failed=0`（证明 M1 的红来自这条判据本身，而不是顺带撞上的别的东西）。
- 三条驱动自坏与处置，都属"探针瞎了被读成数据坏了"：① filter 路径与 cwd 不同源（`apps/desktop/...` 传给以 `apps/desktop` 为 cwd 的 vitest ⇒ `No test files found`、`collected=0`，形态完全像"变异没被抓住"）⇒ 文件路径与 vitest filter 拆成两个常量；② 汇总正则按 `passed\s+N` 找，而 vitest 的产物是「1 failed | 12 passed」——数字在词**前面** ⇒ 改成 `(\d+)\s+passed`；③ 只滤控制字符会留下 `[39m` 残片让正则永不命中 ⇒ 改成按 ESC 转义序列整条摘除。三条都补了**下界断言**（`collected>=13/30`）与「汇总行 / `Failed Tests N` 头部 / `× ` 清单三者互证」的一致性断言，任一不符即判驱动自身故障并原样抛出。
- 还原：每个用例 `finally` 里按字节写回原文件并核 md5（`svc=d6be8dca`、`test=da74501a`、F9 那份终态 `36138a40`（中途一次读数 `550bbce4` 是**被污染的快照**，见下一条）），还原不等即抛错——驱动自己报错时不得留一个被改坏的被测文件给下一个会话。
- **⛔ 但"按快照还原"只证明还原到了驱动启动时读到的那一份，不证明那一份是干净的（本轮被自己的锁抓到一次）**：F9 的 M1 变异目标恰好是 `insecure.example.com` 那一行，而该行的"退回手写"在某一次驱动崩溃后的重跑里被 `ORIG = readFileSync(F)` **当成了基线**——于是后续每次"还原"都忠实地把污染态写回去，md5 自检每次都通过（它比的是"和刚才读到的一样"）。提交后重放到主干再跑，那条接线锁当场变红 `expected 2 to be 1`，才把 `size: 1000` 这一处漏网抓出来。**口径**：变异驱动跑完之后必须**重跑一次被测锁本身**作为收尾判据，不能只信驱动打印的 `restored md5=…`；更稳的做法是让驱动在 mutate 前断言"工作树文件 == `git show HEAD:<path>`"（或与索引 blob 比），把"基线本身已被污染"变成驱动自红的条件而不是靠下游测试偶然发现。本条与 [[self-lock-implementation-and-mutation-proof]]、[[feedback-evidence-recount-on-final-base]] 同族，但落点不同：那两条讲"读数没重取"，这条讲**还原的基线可以是错的**。

## 判定读数（commit 之后取证）

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（含 `.test.js` 运行面改动）⇒ 走完整质量节拍，不借 docs-only 通道。
- `node .github/scripts/check-max-lines.js` → OK（两个测试文件都在 `DEFAULT_TEST_LIMIT` 内，读数由判据自己打印）。
- `node scripts/check-record-qm5-rows.js --base=<merge-base> --head=HEAD` → OK（必需步骤 ①②④⑤ 齐）。
- `node scripts/check-doc-abs-paths.js --base=<merge-base> --head=HEAD` → PASS；账本 `scripts/doc-abs-paths-baseline.json` **未改动**（驱动路径按 AGENTS 用 `<本机临时目录>` 占位写，不写盘符）。
- `node scripts/check-changelog-growth.js --base=<merge-base> --head=HEAD` → PASS（一条变更一个标题块，未吃掉上一条标题）。

## 本 PR 故意没做（写出来，避免下一个会话当遗漏顺手补）

- **没有把三处白盒 `isBusy()` 断言删掉换成黑盒**。理由：本仓**不存在**忙标记的公开只读出口（`podcast-hosting-service.js` 只在 `tryBeginPublish` 失败时抛 `PODCAST_CHANNEL_BUSY`，`podcast-channel-service.js` 的 `:276` 是内部判据），为测试新增一个 accessor 属 test-only API 反模式；而"再发一次看能不能发出去"与"isBusy 为 false"测的不是同一格——前者是用户语义、后者是精确归因。MA 的红集重合已经把这件事变成可见证据，不是口头理由。
- **没有顺手把 `durationSec: 37.5 / durationText: '00:37'` 也收敛成常量**。F9 点名的只有尺寸那一处；这一对确实也同源，但把它卷进本 PR 会让"测试侧两笔债"变成"夹具大扫除"，且它没有对应的行为判据在看。登记在此，随下一次动这个文件时一并收。
