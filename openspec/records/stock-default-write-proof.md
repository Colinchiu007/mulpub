---
record: stock-default-write-proof
task: 给 PRD §7.9.5 第 5 条「不猜」补一条真的落进实现文件的变异反证，并收口它当场暴露的按值失明
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 合并后由后续 docs PR 按既有 PASS 口径回填 merge SHA 与时间，并在同一次提交删除 frontmatter 三字段与本记录对应的 ledger 登记项
sync_backfill_owner: 本会话（本片作者）
---

# 存量 mime 固化「不猜」的变异反证与按值快照（stock-default-write-proof，2026-10-14）

> 分支 `stock-default-write-proof`（worktree `D:/Data/projects/mp-worktrees/mp-stock-default-write-proof`，非 C 盘），起点 `fd369f3d0` = 当时 origin/main。合同 = PRD §7.9.5；判据本体 = `apps/desktop/electron/services/podcast-episode-stock-mime.js` 与同名测试。本片对应 `openspec/changes/podcast-oneclick-publish/tasks.md` 的 **4.4b④**。

## 为什么这一条要单独做一次

§7.9.7 原文记着：「第 5 条的变异反证（『派生不出即填默认值』必须变红）**两次尝试均未把变异真正落进文件**（锚点少写了 `extOf(`），所以这条锁目前没有变异证据，只有行为证据。」

「变异没落进文件」是这一类反证最隐蔽的失效形态：锚点 `indexOf` 返回 -1 时字符串替换是 no-op，写回的文件与原件逐字节相同，测试照样全绿，于是「跑了三条变异都没红」会被读成「锁没用」，而真相是「锁根本没被 test 过」。所以本片每条变异都带两道自证：**锚点命中数必须等于 1**，且**写回后必须能从磁盘读回 `to` 串**；每条跑完立刻还原并断言整文件 md5 与开工前一致。

## 九条变异的落点与实测（基线 12 passed / 0 failed，还原后 0 红、md5 一致）

§7.9.5 第 5 条（不猜）——猜可以发生在四个不同位置，逐个打：

| 变异 | 打在哪儿 | 结果 |
| --- | --- | --- |
| D1 | 派生出口：`byExt.get(extOf(...))` 后加 `\|\| 'audio/mpeg'` | 指名红「派生不出 ⇒ 保持原状并计入 unresolved，绝不填默认值」（红 2 条，另一条是跨用例状态锁） |
| D2 | 派生不出的分支里**就地**给同一个对象补 `mime` + `mimeSource` | 补快照断言前 **12 条全绿**；补后**指名红**（红 1 条） |
| D3 | 派生不出的分支返回**补了默认值的新对象**（计数仍按未补报） | 指名红（同一条用例） |
| D4 | 把猜上移到 `extOf`：认不出即返回 `'.mp3'` | 指名红「§7.9.5-6/7 … 扩展名解析覆盖 query/fragment 与超长后缀误判」（`expected '.mp3' to be ''`）——**由 `extOf` 自己的锁收住，不是「不猜」那条** |
| D5 | **只在 `mime` 为空/缺失时**才兜默认值 | 指名红（新增的空串/缺键夹具收住；这条正是外部评审两条 Warning 独立命中的形态） |
| D6 | 不动 `mime`，只就地追加一个来源键 | 指名红 |

§7.9.5 第 1/2 条（真库往返与幂等）此前同样只有行为证据，一并补上：

| 变异 | 打在哪儿 | 结果 |
| --- | --- | --- |
| W1 | 落盘写的仍是**未派生**的原 store（`writeEpisodes(file, store)` 而非 `r.episodes`） | 指名红「固化后关闭再重开同一文件读回：脏值被派生、戳记落盘」 |
| W2 | 干脆不写 episodes 文件（`filled` 照常返回） | 指名红（红 2 条） |
| W3 | 不写 `index.stockStamp`（幂等判据失去凭据） | 指名红（红 2 条） |

## D2 是这次真正的收获：身份断言对「就地改字段」结构性免疫

那条用例原本四条断言是 `filled=0` / `unresolved=1` / `changed=false` / `episodes[0]` **`toBe(odd)`**。`toBe` 比的是对象引用，而 D2 改的正是**同一个对象**的字段——引用不变、计数不变、`changed` 不变，四条全部照样成立。也就是说第 5 条的锁此前只证明了「返回的是同一个对象」，**没证明「这个对象的内容没被动过」**，而后者才是「不猜」要守的东西。

修法不是放宽断言，而是把「三种派生不出」都请进同一条用例，并按值对账：

- 夹具从一种扩到三种：`mime` 非法但已有值 / `mime: ''` / **`mime` 键完全缺失**——后两种是「缺失即填默认值」这句话的字面对象，此前**整个文件没有任何一条 unresolved 用例走过这条路径**（第 112 行那条空串 mime 用的是可派生的 `.mp3`，走 filled 分支）；
- 断言改成**调用前快照** `before` + `toEqual(before[i])`：任何就地改值、就地加键都会红，而 `toBe(ep)` 继续守住「返回同一个对象」（只补不改）；
- D2 与 D3 的分工由此变成实测结论而非推测：**换对象由身份断言收、就地改由快照断言收**，两条都得在。

**拒绝了一条评审建议**：后端 Info（#2）建议把断言改成 `expect(r.episodes[0]).toEqual(odd)`。这条不采纳并给 L1 反证——`odd` 与 `r.episodes[0]` 是**同一个对象**，`toEqual` 自比恒真，对 D2 完全不设防；把它写进去只是把「已经漏掉的变异」换成「一条看起来更严格的假锁」。采纳的是前端 Info（#2）的快照形态。

## QM-6 双模型外部评审（两轴均实跑成功，逐条处置）

后端 `claude` 4 条、前端 `opencode` 5 条，全部为**可解析的 findings 数组**（不是「跑完但没有 findings」那五种失败形态）。

| 编号 | severity | 主张 | 处置 |
| --- | --- | --- | --- |
| 后端#1 | Warning | 只锁了「mime 非法但已有值」，`if (!ep.mime) ep.mime=default` 这类「仅当空/缺失才兜」的形态双双逃逸；全文件无「空/缺 + 不可派生」的 unresolved 用例 | **采纳**——补空串与缺键两种夹具，并用 D5 实测其指名红 |
| 后端#2 | Info | 改用 `toEqual(odd)` 覆盖一切就地改字段 | **拒绝**（同对象自比恒真，见上节 L1 反证）；其意图由快照形态实现 |
| 后端#3 | Info | `hasOwnProperty` 写法可靠、与 mime 断言不冗余 | 确认；现被快照断言包含，故不再单写 |
| 后端#4 | Info | 该用例走真实派生非 mock；夹具隐性依赖 `audio/mp3` 不在合法集 | 确认。顺带按前端#5 把夹具换成 `application/octet-stream`，消掉「同一字面量在两条用例里两种结局」的歧义 |
| 前端#1 | Warning | `.wav` 那条（跨用例状态锁）对同一盲区失明，且它正是「键完全缺失」形态 | **采纳其推荐落点**——评审自己给的更优解是「把键缺失夹具并入第 5 条那条用例」，避免在标题为「本层无跨用例状态」的用例里堆合同断言；照此落地，`.wav` 那条保持原职责不动 |
| 前端#2 | Info | 新造 `hasOwnProperty` 长写法与全文 `toEqual`/`Object.keys` 风格不一致 | **采纳**——收敛为快照 `toEqual` |
| 前端#3 | Info | 注释里的「变异 D2」是本文件内无定义的外部编号，读者无法自证 | **采纳**——注释改为直接写出变异内容（就地补默认值 / 就地加键），不再依赖 D 编号 |
| 前端#4 | Info | 可追溯性只到 describe 标题一层，应就地补条款锚 | **采纳**——注释首行写 `§7.9.5 第 5 条（不猜）`；describe 的 3/4/5 与 PRD 条款逐位是否对应属更大范围核对，本片不动其它 describe（改动会牵连其它锁的锚点） |
| 前端#5 | Info | 夹具可读性隐患 + 意外把「mime 同义词归一」锁死在不猜用例上 | **采纳**——改夹具值，同义词归一仍由第 112 行那条负责 |

两条 Warning 与四条 Info 落地后，九条变异（含新增 D5/D6）重跑全部指名红；`audio/mp3` 的同义词归一行为仍由原用例覆盖（12 passed / 0 failed）。

## QM-1 打包验证：**第②层 NEEDS_REVIEW，不自判通过**

- `node scripts/verify-worktree-deps.js` OK（11 项消费方解析到本 worktree）；`pnpm run build:vue` ✓ 2m30s；`pnpm exec electron-builder --win --dir --publish never` **rc=0**，asar `151,591,278` 字节。
- 产物归属（`pnpm exec asar list`，14,990 条目）：`podcast-episode-stock-mime.js`=1、`podcast-stock-freeze-host.js`=1、`podcast-episode-compliance.js`=1、**其测试文件=0**（测试不进包，符合预期）。本 worktree 起手 `dist-electron` 不存在，故命中只能来自本分支。
- 启动存活：`Multi-Publish.exe --user-data-dir=<临时目录>` 9 秒 `alive=yes`；进程计数 `before=0 → after=3 → end=0`（只按自己启动的 PID 收口，未按名字批量 kill）。
- **stderr 全文只有 2 行 / 163 字节**：`(node:…) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated.` 加一行 Node 自带的 trace 提示。四类红线（`Failed to load platform config` / `PluginLoader…mkdir failed` / `ENOTDIR…app.asar` / `Cannot find module`）命中 0，`app.asar` 内部路径命中 0。
- 按 AGENTS.md 现行三层判据，stderr 非空且未命中红线 ⇒ **第②层 NEEDS_REVIEW，不得判通过**。这条告警来自 Node 内核而非本仓代码路径，但它是否可接受属人工裁决，**本片不自判**，已在 PR 里点名为待人工裁决项，CI 全绿也不合。
- 顺带抓到一条**测量方法自身的坑**（值得记进记忆）：先前用 PowerShell `Start-Process -RedirectStandardError` 抓 stderr，`[IO.File]::ReadAllText` 在子进程仍持有句柄时抛「另一进程正在使用」，而脚本里 `$ErrorActionPreference='Continue'` 把异常吞成空串 ⇒ `stderr_bytes=0` ⇒ **三层判据的第③层被虚假满足**。正解是像本次这样用 `>out 2>err` 让子进程自己写、退出后再读；且必须双流分开——本应用的日志走 **stdout**（252 行），只重定向 stderr 时 stdout 会继承控制台句柄，把「日志都在 stdout」误读成「stderr 里有几百行」。

## 与合同的差集（不虚报）

- §7.9.5 第 1/2/3/5/6/7 条现已同时具备**行为 + 变异**两类证据；第 4 条（`compliance` 的 `stock` 档）随 #3589（merge `95b18160a`）落地。
- 仍**未做**的只剩 4.4b③：频道页摘要「扫描 N · 补齐 M · 待人工 K」与 locale 三对键 `podcast.stock.*` zh/en 成对 ⇒ `tasks.md` 的 4.4b 父项继续保持未勾。
- 本片**不改实现**（`podcast-episode-stock-mime.js` 逐字节未变，九条变异各自断言还原后 md5 一致），改的是那条锁——「不猜」的行为本来正确，缺的是「证明它正确的东西有牙」。

## 远程同步

| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在 |
