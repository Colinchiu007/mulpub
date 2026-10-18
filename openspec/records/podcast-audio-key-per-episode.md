---
record: podcast-audio-key-per-episode
task: 修掉"同频道每一期的音频写到同一个对象键上"的覆盖缺陷（第二期原地覆盖第一期的音频），并补跨期唯一性的行为锁
date: 2026-10-19
---

## 本次执行记录：播客出期音频对象键跨期唯一性（podcast-audio-key-per-episode，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码任务：`apps/desktop/electron/services/podcast-episode-host.js`（主进程服务）+ 其测试。隔离 worktree `mp-podcast-audio-key-per-episode`（`scripts/start-mp-task.ps1` 创建，`node scripts/verify-worktree-deps.js` OK）。发现途径不是排期，是另一片（#3955 的 5.1b② 取证）顺带照出来的——见"第一性原因"。 |
| 第一性原因（QM-5 ①） | ✅ | 引入点 `46736edf5`（PR #3302，2026-10-11，刀 3 第 3 片"出期真实宿主接线"）。当时为"临时产物归拢"定了两件事：`runDir = <tmpRoot>/episode-<runId>` 与 `outBase = <runDir>/episode`。**目录名带 runId，文件名不带**；而下游 `podcast-episode-adapters.js` 的对象键是 `stem = path.basename(filePath, ext)`，`podcast-hosting-service.publishAudio` 拼的是 `<prefix>/audio/<channelId>/<stem>.<ext>` ⇒ 目录里的唯一性在进 key 的那一步被丢干净，同频道每一期都算出 `episode.mp3`。存续 8 天。**这条不是"没想到"，是没把自家写下的判据跑通**：`publishAudio` 的头注释原文就写着「key 必须带 channelId，**两期写进同一层＝后一次发布静默覆盖前一期**」，实现只挡住了跨频道那一半（channelId 进了 key），跨期那一半没人接。 |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：`podcast-hosting-audio.test.js:51,103` 的断言是 `expect(objectKey).toContain('/audio/ch_aaaaaaaaaaaa/')` ——**前缀断言对 stem 恒为常量完全免疫**（前缀对、文件名错也照绿）。②集成层：宿主/编排的每条用例都只发一期，从来没有"同频道连续两期"的形状，所以覆盖不是"漏了一种输入"而是**漏了一个实体维度**。③产物层：真 OSS 才有键冲突语义，本机零出站纪律下没人看得到 PUT 落点。④审查层：#3302 的 QM-6 后端评审盯的是持锁/取消/降级那几格，对象键唯一性不在它的清单里。**归因方法记一条**：这三层里前两层是"断言写宽"，不是"没断言"——本仓同族已第 N 次，`toContain` 对结构/身份类判据的免疫性在 AGENTS「文本结构断言」里已写过，这条是它在**对象键**上的落点。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复取最小落点：`outBase = <runDir>/episode-<runId>`（键的身份跟着这一次发起走；同一次发起重发仍是同一个键，这是对的——重试不该新开对象）。**不取标题当身份**（标题是用户可改的显示量，拿它当身份会让"改标题再发一期"凭空新开对象，而真正该分开的两期反而可能撞）。回归保护 2 条行为锁（视频链 + 文本链各一条：`两期不得写进同一个音频对象键`，并断言 `stem` 含本次 `runId`）；两条都**先见证红**（改前 `expected 'episode' not to be 'episode'`）。消费者并集全跑：`podcast-episode-host.test.js` **53 passed**（51 原有 + 2 新）+ 两份 IPC 契约 13 passed + `podcast-episode-publish/adapters/plan-preview/public-url` 合跑 110 passed。变异反证：把 `outBase` 退回固定基名 ⇒ `collected=53 failed=2` 且红的**恰好**是这两条新锁、零旁路红（驱动 `mutate-audio-key.cjs`，含 `collected>=53` 下界与"红集必须逐条命中预期标题"的判据；第一版把它写成只匹配「对象键」三字，而第二条锁的标题里没有这个词，于是 CAUGHT 被误报成 CHECK——**驱动的过滤器也是探针，写窄了就是自盲**）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | 三条，都落到文件：① **AGENTS.md「代码审查必检项」新增一条**：凡"身份由多个字段拼成的外部键"（对象键、缓存键、文件名、幂等指纹），必须有一条"两个不同实体 ⇒ 两个不同键"的行为锁，且**禁止只用前缀 `toContain` 断言**（前缀断言对"最后一格恒定"完全免疫）；② 本文件这条记录 + `podcast-hosting-service.publishAudio` 的头注释补一句"channelId 只挡跨频道，跨期靠调用方给唯一 stem"——把散落的判据写回它守的那段代码旁边；③ 两条新锁进了 CI 已覆盖的 `electron/services/**` 收集域（`check-unwired-tests.js` 无新文件，无需新接线）。 |
| 行尾与 diff 对账 | ✅ | 改动的两个文件工作副本均为 `i/lf w/crlf attr/text=auto`。驱动按 `(line, sep)` 成对切分回写、锚点匹配前剥 `\r`；提交后两口径 `git diff --numstat` / `--ignore-cr-at-eol --numstat` 逐文件相等（读数在下）。 |
| 接线棘轮 | N/A | 不新增测试文件；两条锁落在既有 `podcast-episode-host.test.js`（已被 vitest 的 `electron/services/**/*.test.js` 收集，且 `QG Desktop Shards` / `electron-tests` 覆盖）。 |
| QM-1 打包 / QM-4 视觉 | ✅ | 改了 `apps/desktop/electron/services/` ⇒ QM-1 触发。本地 `pnpm exec electron-builder --win --dir --publish never` 产物已生成，验证按三层判据跑（stderr 红线 / 非空需人工 / 空才通过），读数与归属自证见下「QM-1 读数」。未触任何 `.vue`/样式 ⇒ QM-4 N/A（浮层显示项不在本 PR）。 |
| QM-6 CCG 双模型外部评审 | ✅ | pre-commit 判定产物落 `.ccg/reviews/<sha>.json`；改动集小 ⇒ 判定档位非 `dual`，**未调用外部模型**，本行不得被读成"已复核"。替代证据：缺陷本体由 2 条先见证红的行为锁 + 1 条精确变异承载；且**这是一条会静默改变用户已发布内容的外部效应**，任何后续改这条链的会话都必须重跑那两条锁。 |
| 远程同步 | 由门禁推导 | 不需要事后改写：收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。合并后的 main push 回读写进 PR 评论，不写回本文件。 |

## QM-1 读数（打包产物，最终树上现取）

- 构建：`cd apps/desktop && pnpm exec electron-builder --win --dir --publish never`。
- 归属自证：`asar extract dist-electron/win-unpacked/resources/app.asar` 后取包内 `podcast-episode-host.js` 与工作树逐字节比（**归属最高一级是包内 blob 等于工作树**，见 [[qm1-packaging-artifact-ownership]]）；`asar list` 里该文件在位。
- 启动：`win-unpacked/Multi-Publish.exe` 隔离实例 8 秒窗口，stderr 按三层判据判；存活单独断言（进程提前退出即 FAIL，不得只看 stderr 为空）。
- 子进程 env 经 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE`，父环境带它时 `envDefectNotice()` 出声。
- 逐项读数在提交后现取并写进本文件（禁止预写"通过"）。

## 顺带照出来的两件事（不在本 PR 修，各自有名）

- `podcast-episode-publish.js:16` 那句「kill 贯穿属第 3 片再做」已过期（`4172a34d0` 已做），与 `tasks 3.7` 的账一起由 #3950 记过，本 PR 不再动它。
- **文本链的 `stem` 与音频的键来源不同**：文本出期是合成器写 `outBase` 再 concat，视频出期是 ffmpeg 抽取——两条都从 `outBase` 取名，所以一处修复覆盖两链；这也是本 PR 给两条链各写一条锁而不是写一条的理由（共用一个字段名不等于共用一次派生路径）。
- feed 的键固定成 `feed.xml` 是**对的**（一个频道一份 feed，本来就该被覆盖），音频固定成 `episode.mp3` 是**错的**（一期一份）。同一形状两种语义，别在下一个会话里被"顺手统一"。
