---
record: podcast-episode-ipc-impl-s2
task: 刀 3 第 3 片——成片一键出期的真实宿主接线层 + publishFromVideo/取消两条 IPC 通道（含 3.8 W1–W3 与两条 Info 处置）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR（#3302）尚未合并，merge SHA 还不存在；合并后由回填 PR 改写为 PASS + merge SHA，并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（同一 agent 收尾链：合并 → 回填 → 销账 → worktree 清理）
---

# 本次执行记录：播客刀 3 第 3 片——出期真实宿主接线 + publishFromVideo 双通道（podcast-episode-ipc-impl-s2，2026-10-11）

> 分支：`podcast-episode-ipc-impl-s2`（隔离 worktree `D:\Data\projects\mp-worktrees\mp-podcast-episode-publish`，**非 C 盘**）；共享根 `D:\Data\projects\mulpub` 保持 `main` 且未被本会话改动。
> 范围：🛠 运行时代码 ⇒ 完整质量节拍；`classify-docs-only.js` 判 false（混合 PR）。
> PR：#3302（原承载「出期适配层」单块，本片把适配层与 IPC 接线**合成一个 PR**——一次 CI、一次回填。单个 30+ 分钟的 CI 窗口几乎必然撞上别人对顶部追加型文件的合并，把两片分开发只会把同一场冲突买两次）。

## 提交构成（origin/main..HEAD）

| SHA | 内容 |
| --- | --- |
| 以 main 为底重建的前序提交 | `podcast-episode-adapters.js` + 行为锁（出期编排四个注入实现的真实落点），CHANGELOG / `.quality-gates.md` / ledger 以 main 的 blob 为底前插并通过多重集断言核对 main 每行都保留 |
| 本片代码提交 | 新增 `podcast-episode-host.js`（入参形状层 / 整链持忙标记 / 主进程算 `outBase` / kill 贯穿 / 临时目录逐个点名删除）、`podcast-episode-cancel.js`（按 `runId` 键控的取消登记处，accepted/too_late/unknown 三态 + `killRunning` 与用户取消分离）、`podcast-public-url.js`（https 单一谓词）；两条 IPC 通道 + preload 两方法 + 桥接层两导出同 PR 落地；五处生产修复（见下）；新增 5 份测试文件 58 例；更新 4 处计数锁与 1 处错误码改名 |
| 本片文档提交 | PRD §6.4 的 `cancelToken` 合同纠正 + 新增 §6.4.1 八条硬约束 + §7 刀 3 状态改写 + §14 落地增量与欠账更新；spec 新增 Requirement「成片出期必须整链持频道忙标记，且取消经第二条通道」（5 个 Scenario）；tasks 勾选 3.8 / 3.6a2 并新开 3.9–3.12；CHANGELOG；`.quality-gates.md` 顶部记录与前一片两行的如实改写；ledger 登记；本记录 |

## 修掉的五处（都带回归锁，且都先红过）

1. **整条链此前完全不持频道忙标记**（QM-6 后端 ① W1）。`podcast-hosting-service.publishAudio` 的头写着「锁归整条出期链」——那句话当时是假的。取锁点落在宿主进入时、放锁在 `finally`；`publishFeed` 改为凭**持锁凭证**再入（只认 `publishHolder(id).token === heldBy`，不接受调用方自述「我已持锁」，否则任何人都能绕过忙标记；再入分支不放锁，放掉会把「音频已传、feed 未更」的中间态暴露给手工写者）。
2. **`publishAudio` 不判 `channelId` 形态就拼进对象 key**（② W2）。`stem` 洗得很干净、id 反而没洗，少这一条 `../` 就能把对象抬出 `audio/<channelId>/` 这一层，表现是「A 频道某期覆盖 B 频道某期」而两侧本地看起来都正确。判据复用 `podcast-channel-registry` 的 `CHANNEL_ID_RE` 唯一实现，非法回 `PODCAST_CHANNEL_ID_INVALID`（该码 zh/en 文案刀 1 已有）且**零出站**。
3. **抛出的错误相位字段名不统一**（③ W3）：取消与音频 https 两支挂 `.phases`、其余挂 `.publishPhases`，排障脚本按一个键取就漏。统一为 `publishPhases`，并给**抽取段**补上轨迹（原先抽取失败完全不带相位，而那正是最需要「卡在哪一站」的失败）。
4. **partial 的底层成因在有 message 时丢掉 HTTP status**（④）：`String(e.message || e.status)` 让真 adapter 的 403 永远进不了结果契约，上层无法区分「被拒绝」与「暂时失败」。改为 message 与 status 同时带、且不重复（message 里已含该状态码时不再追加）。
5. **`feedSink` 把「取可写服务」写在 `channelPublishPass` 外面**——**这条是新锁当场抓出来的真实缺陷，不是评审提出**。前两片没人持锁所以无害；第 3 片整链持锁后，`assertChannelWritable` 就在 `channelServiceOf(id, {writable:true})` 这一站发生，每次出期都会稳定停在 buildFeed 报 `PODCAST_CHANNEL_BUSY`。

## 一条**合同纠正**（必须先改文档再改代码）

PRD §6.4 原文把取消写成「`cancelToken`：`{ cancelled: boolean }`，由渲染层持有引用」。这句话在 IPC 上不成立：`ipcRenderer.invoke` 走结构化克隆，载荷到主进程就已经是**快照**，渲染层随后改的是另一个内存对象。照原话实现的产物是「取消」按钮**静默失效**——不报错、不提示、进度条照走，用户只能等它跑完。这与 AGENTS.md 记的「装饰性链路」（改名功能自引入起就是空操作）同族。

改后的形态是**两条通道 + 引用只在一侧**：发起带 `runId`，主进程按它登记活引用交给编排层；取消是对同一个 `runId` 的一次 invoke。`runId` 同时是临时目录名的一部分，所以它的形态判据（8–64 位 `[A-Za-z0-9_-]`）就是目录穿越边界本身，不是装饰。

## 关键判断

1. **取消窗口判据不许有第二份**：`cancellableAt(phase)` 的唯一实现在编排层，宿主登记取消时注入的是同一个函数。在宿主另抄一张相位表，等于给下一次改枚举留一条漂移路径。
2. **`too_late` 不置位**：置位就是把既成事实说成「用户不要了」，而它已无法回滚；`unknown` 不得被读成「已取消」，否则界面会对一次已经发布成功的出期说「已取消，临时文件已回滚」。
3. **超时与用户取消必须分道**：`killRunning` 只杀进程、不置 `cancelled`。同一个 token 上如果顺手置了位，下一个采样点会把「等太久」读成「用户取消了」——两件事的排查方向相反。
4. **被 kill 后的非 0 退出在抽取层转成 `PODCAST_PUBLISH_CANCELLED`**：真因是用户按下的按钮，报成 `EXTRACT_FAILED` 会让人去查磁盘和编码器。
5. **`cancelled` 是结果态而不是异常**：门面捕获 CANCELLED 后回 `state:'cancelled'` 的结构体（含相位与回滚说明），三态不压平；`partial` 与 `failed` 的行动方向不同（删掉重来 vs 只重试 feed），压平会诱导用户做出错的那一个。
6. **临时目录收尾归宿主**：抽取中途被 kill 会留下截断文件，而编排层此刻并不持有它。收尾按目录内**列出的文件名**逐个删除再删目录本身，绝不递归到父级。

## QM-6 处置（2026-10-11：评审在合并前返回）

- 后端 claude：0 Critical / 1 Warning / 3 Info（含一条合规确认）。**Warning 已修**：三站（encoders / 混音 / ffprobe）各自做「被 kill ⇒ CANCELLED」映射，判据一律带「这一站确实没成功」的合取并**加括号**；extract 层 4 条（2 正 2 反）+ 宿主层 3 条锁 + 变异 M16–M19 双向钉住。
- 过程自省：修这条时我引入了运算符优先级 Bug（串接条件未加括号，`&&` 先于 `||`），症状恰是评审警告的那类误导（真实崩坏被读成用户取消），由本次新增的**反面对照**用例抓红（M17 指名 2 条）。没有那条反向锁，它会带着全绿进主干。
- 前端 opencode 三次（含两次重试）均未产出 findings（两次 exit 0 只复述范围、一次 status 255），记为部分完成。
- 数字：`podcast-episode-extract.test.js` + `podcast-episode-host.test.js` 共 52 passed / 0 failed；`pnpm exec eslint electron/ src/ --quiet` 全树 0 error。

## 验证（数字在最终基线重跑后写入）

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| TDD | PASS | 最终基线 podcast 全域 **78 个测试文件 1201 passed / 0 failed**；本片新增 5 份锁文件 **63 例**（宿主 33 / 通行证 5 / 真 `_put` 与 key 边界 11 / IPC 信封 6 / https 谓词 8）。先前记的 58/1181 偏低，因 audio-key 那份文件一度语法非法、11 例未进跑动 |
| 变异反证 | PASS（13 条指名红 + 1 条不可分辨） | 13 条各自指名变红（通行证拆出 / 不包通行证 / **`channelId` 形态判据摘除 7 条** / 不取锁 / 不放锁 / 取消窗口恒真 / 相位不同步 / 抽取无轨迹 / https 放宽 / heldBy 不透传 / 丢 status / 取消报成抽取失败 / cancelled 压成异常）。归因更正：先前那条 LOADFAIL 不是变异测法的问题，而是该测试文件被补丁脚本写成未闭合括号；修好后同一变异指名变红。M9（runId 校验）failed=0 属宿主与登记处防御重叠不可分辨 |
| 静态门禁 | PASS | `check-ipc-bridge` 453 handlers / 471 preload / 0 缺口；`check-ipc-sender-guard` PASS；`check-max-lines` 无新增超限（生产侧新文件 205/120/25 行，最大测试 516 行 < 1500 测试上限）；`check-gate-record-debt` OK；品牌残留 PASS；行尾两口径对账 raw=ignorecr |
| QM-1 打包 | PASS | `build:dir` rc=0；asar 含 4 个新模块 + handler + preload；解包后核对两条通道名在位、5 个文件 `node --check` 通过；preload 产物改为当前树重生成（相对 main +2/0，保住 #3303 的 quick-collect 段——从旧 tip 恢复会 -31 反向撤销他人行） |
| QM-6 双模型 | 见下节 | 后端 claude + 前端 opencode 对本片 diff；opencode 若复现对外部 worktree 的 `--lite` 拒绝，如实记为部分完成，不自扮演豁免 |

## 仍留的欠账（带承接片，不是遗漏）

1. §6.4 表里的 11 个 `episode.*` 与若干新领域码的 zh/en 文案键**未写入 locales**：唯一消费点是第 4 片的浮层与状态机，现在写就是 AGENTS.md 明令禁止的死键；当下这些码走 `podcast.errors.fallback`，不崩但无区分度。已按编号落在 tasks 3.10。
2. F9（`podcast-episode-publish.test.js` fixture 三处常量手写耦合）仍留，tasks 3.11。
3. 入口两枚（`ResultView.vue:726`、`CreateView.vue:4519`）与浮层挂起 owner 登记在第 4 片。
4. 跨模块单例断言的接缝债（tasks 3.12）：测试侧 `import` 与生产侧 `require` 对模块级可变单例在 vitest 下可能是两份实例。本片四条锁一开始就踩在这条坑上（红成「适配层没包通行证」），改 `require` 后才测到真源；既有 `podcast-hosting-service.test.js` 里直接 `import channelBusyGate` 做断言的那几条，证据强度低于表面，需后续单列 PR 改成「经被测对象的公开出口观察」。
5. **流程债（本片内已补，但值得进 learnings）**：提交前我只跑了点名文件的 `node --check`，没跑门禁命令本体 `pnpm exec eslint electron/ src/ --quiet`，于是一份测试文件的未闭合括号直到 CI 才暴露（`QG Static` + `QG Desktop Shards` 双红）。口径：**门禁命令本体必须本地跑一遍**，点名校验不构成覆盖；且「文件存在 + 单测跑过」不等于「这个文件被执行过」——必须在看板产物里见到该文件名且用例数 > 0。

## 远程同步

| 远程同步 | PENDING |
| --- | --- |
