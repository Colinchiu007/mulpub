---
record: qm6-critic-dispositions
task: 补跑 QM-6 critic 轴并处置其对 #3949 的两条 findings（合法清空不再被钉成禁态 + 退出码接线锁）
date: 2026-10-19
---

## 本次执行记录：critic 轴补跑与处置（qm6-critic-dispositions，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（`scripts/` 测试文件 + CHANGELOG + 本篇），但**运行行为零改动**（未动 `apps/`、`packages/` 与任何 UI）；隔离走 `%TEMP%` 下的 detached 工作树（`git worktree add --detach <唯一名> origin/main` + `checkout -B qm6-critic-dispositions`）。两条正规入口本日仍被他人现场挡住：`start-mp-task.ps1` 因标准根之外注册着 2 个 worktree 判 `ok:false`（`clean`/hooks/`writeGuard` 三项全绿），`session-init.sh` 因共享根有他人未跟踪文件拒绝 —— 均为机器卫生欠账，已在前一刀记录「遗留」点名，本刀不代删 |
| 第一性原因（QM-5 ①） | ✅ | 两条读**真实账本**的用例把「账本非空」写成不变量（`assert.ok(keys.length > 0)`），而该账本的设计终态是空（每条登记项的原因都写着"回填后删除本条"）。根因与我上一刀的注释自相矛盾：我在 design 里刚论证过「数量下限会腐烂，所以不钉 23」，却在另两条用例里钉了 `> 0` —— **同一个道理在两个位置不一致，说明它没被当成判据而是被当成了措辞** |
| 逃逸分析（QM-5 ②） | ✅ | 四层都没拦：本机用例当下全绿（账本此刻非空）；CI 同理；变异集测的是"下限能不能被绕过"而不是"下限会不会误伤合法终态"；自审把它当"反失明断言"没追问其适用域。**抓到它的是外部模型**（critic=claude F1），这也是本刀存在的理由——上一轮那笔"缺第二双眼睛"的欠账在这里兑现 |
| 系统性漏洞（QM-5 ③） | ✅ | 属"测试质量不足"：反失明断言写成与仓库现状耦合的常量下限，而非写成"函数丢条目即红"的等值关系。同族先例见记忆「清点式门禁的前缀失明」「测不出差异的形态不许写成锁」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 摘掉两处下限，反失明的活交给已有的**等值**断言（`键数 == 文件条数`）与夹具机制锁 `清空账本不得变绿`。四组证据：**C-F1** 真实账本临时置 `{}` 时两条用例 GREEN-AS-DESIGNED；**M-F1** 装回旧下限在同输入下当场假红（缺陷现场复现）；**M6** `loadLedger` 静默丢条目仍被等值断言抓红（下限不是牙）；**M7** 机制锁的牙独立验证（空账本时不再报欠账 ⇒ 指名红）。新增 1 条接线锁用例，套件 115 → **116 全绿** |
| 防止再次发生（QM-5 ⑤） | ✅ | F2 落地为结构接线锁：`main()` 里 `hasBlocking ⇒ process.exit(1)` 那行被断言覆盖，M-F2（摘掉映射）实测指名变红。并写下边界：`main()` 无 `--root` 注入点 ⇒ 造不出"夹具里确有阻断"的行为态，把 root 做成可注入属改判据形态（改谁来守门，须人工过目），本刀不擅自改 |
| 外部评审轴的产物判据 | ✅ | 只认「能不能从产物里切出可 `JSON.parse` 的 findings」。派发的**前一拍**先跑解析器正控（已知 2 条样本必须切出 2 条）—— 因为本会话上一轮就是用"只认行首 `[`"的解析器把 63,796 字节真交付（数组在偏移 56,481）读成"零交付"的；这次改成逐起点平衡扫描（尊重字符串与转义），F1/F2 才被拿到 |
| 规格自洽（本刀追加的一格） | ✅ | 归档后的主规格自相矛盾：正文「键数本身不设数字下限」 vs 末个 Scenario「键数为 0 ⇒ MUST 红（规模下界）」，两串在 `origin/main` 的该 blob 里**各命中恰 1 次且同处一个 Requirement 块**（当场数出来的，不是推断）。`openspec validate <spec> --type spec --strict` 判 `is valid` ⇒ **校验器不查条目内自洽**，这类"正文与 Scenario 互斥"是可复发形状，只能靠人核对。修法是同批带一道 `MODIFIED` delta（change `align-shape-lock-empty-ledger-scenario`）：4 条原 Scenario 标题逐字保留、末条正文重写、另加一条"防清空由与真实条数无关的行为判据承担"。`openspec validate <change> --strict` 通过；**改标题会被拒**（MODIFIED 是整块替换，实测报 `omits scenario(s) the current spec still has`）——那条拒绝是防丢场景的真判据，不要绕过它 |
| 行尾与 diff 对账 | ✅ |CHANGELOG 这次是**以主干 blob 为底重建**（分支重放到新的 `origin/main`），不再走"把旧块并进来"的并集；落点实测 `cr=0 lf=22940 titles=562` ⇒ 主干那份 blob 是**纯 LF**（工作副本呈 CRLF 是 checkout 转换，与提交内容无关），插入体 9 行逐行剥 CR 后置顶。写盘前四项自检：标题块计数恰 +1（562→563）、`cr` 守恒为 0、`lf` = 主干 + 9、主干全文原样落在尾部且其原标题仍在插入体之后。两口径 numstat（`--numstat` 与 `--ignore-cr-at-eol`）在 commit 后取并写进 PR 正文；本篇与测试文件按各自档位（CRLF）逐行原样写回，**未做整份行尾归一** |
| 接线棘轮 | ✅ | 未新增测试**文件**，用例并入已接线的 `scripts/check-gate-record-debt.test.js`（`quality-gate.yml` Gate 2b 已点名 `node --test`）；`check-unwired-tests` rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | **PARTIAL（本刀即其产物）** | critic=claude 本日均活（探针 rc=0/17.6s/265B）并已交付 2 条；proposer=opencode 换档为 **IP 级封禁**：`opencode run hi` rc=1、357B stderr，原文 `OpenCode's free models aren't available from your current network because we've detected abusive traffic from this IP address … turn off VPN/proxy or subscribe` —— 不是额度、不是重试可解，处置权在人（网络侧）。⇒ 本行仍不得读作"双模型通过" |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导；`HAND-CLOSURE 人工改写=0 … 触碰记录=<n>` 与 `MERGE-LEDGER … byDesign=<n>` 给现场读数 |

### 遗留（不假装已闭合）
- **F2 的那道锁目前是结构锁不是行为锁**：它证明"映射还在源码里"，不证明"真造出一次阻断时 CLI 真退 1"。补成行为锁需要给 `main()` 加 `--root` 注入点，那属改判据形态，须人工过目后再做。
- **#3949 的 dual 判定形态没修**：触发它的仍是我自己散文里的敏感字样（`sensitiveContentHits=1`），`check-pr-exec-record --mode=enforce` 的欠账读数原样在案；`.ccg` 产物 status 一字未改。
- **proposer 轴要等网络侧处置**（关代理/VPN 或订阅），不由本刀判定为"永久不可得"；下次引用本行前先重跑两字探针。

### 上游债务熔断阻塞的归因（2026-10-20 重放时补记；用户裁决＝报给当事人、先别动）

- **现象**：#4001 在飞期间，required 的 `债务熔断检查` 红，并连带把 `QG Changes` / `Gate Result` 拖红（后者会 spawn 消费者套件）。红因全在主干，与本 PR 差量无关。
- **读数**（在只检出 `origin/main`、**不含我任何内容**的临时工作树里跑消费者套件取得，用完按 R1–R7 移除）：`MAX_FILE_LINES: 5359 > baseline 5239 (apps/desktop/src/views/CreateView.vue)`、`FILES_OVER_1000: 29 > 28`。
- **时间线（全部 UTC，逐条取自 `git show -s --format=%cI` 与 `gh pr checks`）**：`9c55d8025`（#3980）**收紧**基线 5657→5239，落 main = `2026-10-19T06:19:44Z`；`7d8716056`（#3969，把 `CreateView.vue` 长到 5358）的 `债务熔断检查` **起跑于 `05:55:32Z`、判 pass**，合入 main = `07:14:18Z`。⇒ 一笔带着**收紧之前**那次绿 run 的 PR，在收紧之后合入，main 当场进入违规态。
- **阻塞时长**：`07:14:18Z → 08:42:46Z` = **88 分 28 秒**，由 `47826594f`（#4012）re-sync 基线收口（5239→5359、28→29，其文案如实写「接受漂移不是清理」）。窗口内另有 4 笔合入：#3968（熔断起跑 `06:34:56Z`）、#4004（`06:19:01Z`）、#4008（`06:52:05Z`）、#4009（`07:17:46Z`）。**#4009 那笔的起跑在 breach 之后 3 分半却照判 pass，我没做对照实验，不写成结论**；前三个都早于 `07:14:18Z`，与 #3969 同一形态。
- **这不是新洞察，是既有注释已经预言的形态**：`debt-guard.yml` 头部就写着「只在 `pull_request` 上跑时…不会让任何人的 CI 变红，反而让 main 长期处于违规态；**之后每个无关 PR 都会被这条红卡住**（audit-2026-09-22 实测因此逃逸 3 次）」。那一刀解决的是"债在谁身上变红"，本次暴露的是另一半：**required check 的绿绑在 head SHA 的旧 run 上，基线变动不会作废它**。
- **本刀的处置**：**不动基线、不拆 `CreateView.vue`**。re-sync 基线属「改谁来守门」，已由 #4012 那刀做过，我再动就是并发写同一热面；拆他人正在增长的运行时代码文件属另一条任务线。我这边只付了重放成本：`git tag retire/qm6-critic-dispositions-2026-10-20 <旧 head>` 留可恢复出口 → `checkout -B` 到新 main → 非热面文件逐个从退役 tip 取回 → 热面 CHANGELOG 以主干 blob 为底重建。

### 一条时间性缺口（用户裁决＝记下来、另起一刀修；本刀不实现）

**收紧债务基线不会作废在飞 PR 的既有绿 run。** 判据本身绑在「这次 run 检出的是哪棵树」，而 GitHub 不会因为基线文件被别人改了就把 required check 重跑一遍。于是「基线 5239 / 内容 5358」这一违反可以在收紧**之后**照样合入主干，并立刻把其后所有 PR 的 required 面钉红。

三条候选修法留给那一刀，各有代价，本刀不预选、不改判据：

1. **棘轮式收紧**：改基线的 PR 必须同批把超出者拆到位（"收紧"与"清偿"同一次发生）。代价：把小 PR 撑成大 PR，且要与「拆分缓存清理卡片」那类既有先例对齐口径。
2. **基线变更触发重算**：`debt-guard.yml` 额外监听 `scripts/debt-baseline.json`，对当时在飞的 PR 主动派发重跑。代价：需要一条能可靠判定「基线变了」的接线，并有队列/额度成本。
3. **判据改为对主干现状负责**：把熔断语义从「我的 head 上绿」改成「我 re-sync 的 main tip 上绿」。代价：混淆「本 PR 是否引入债务」与「main 是否有债务」——本轮那一次拦的正是所有人的 PR。

供那一刀引用的一条取向：**任何"阈值/基线型数据文件"被收紧时，它此前产生的绿 run 有效期应视为零**；收紧动作要么自带清偿，要么自带重算，二者皆无等于把闸门钥匙扔进主干。另附一条取证起点：`gh pr checks <PR> --json name,bucket,startedAt` 的 `startedAt` 与 `git show -s --format=%cI <基线 commit>` 相减，就是这类"绿是不是过期的"的判据现场。

