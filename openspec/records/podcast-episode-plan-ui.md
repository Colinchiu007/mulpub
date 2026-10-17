---
record: podcast-episode-plan-ui
task: 落地 tasks 4.3②-b —— 文本出期通道 + 计费二次确认浮层 + 文案库入口接线（PRD §7.10.1/§7.10.3/§7.10.4.1/§7.10.5）
date: 2026-10-17
sync_reason: 本 PR 合并后由同线程的回填 PR 收口（回填与销账在同一次提交内完成，只改本篇 `远程同步` 行并删除本 frontmatter 三字段）
sync_backfill_owner: 本会话（podcast-episode-plan-ui 线程）
---

# 本次执行记录：播客文本出期 ②-b（podcast-episode-plan-ui，2026-10-17）【完整流程】

> 分支 `podcast-episode-plan-ui`，worktree `D:/Data/projects/mp-worktrees/mp-podcast-episode-plan-ui`（非 C 盘），起点 `origin/main` `3ff90dfcc`。
> 载体冻结已生效 ⇒ **未写** `.quality-gates.md`、**未加** ledger 键；本篇是本 PR 记录的唯一载体。
> 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 PENDING | 远程同步 PENDING

| 门禁 | 状态 | Fresh 证据（全部当场实测，非记忆） |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更，走 `scripts/start-mp-task.ps1` 建的独立 worktree + 裸分支；`node scripts/verify-worktree-deps.js` 本次实跑 `消费方解析通过 11 项`、9 个被消费 workspace 全部指向本工作树，rc=0 |
| 数据校验（§7.10.1 三层） | ✅ | 闸门顺序未动：`billingConfirmed === true` 只认布尔真，排在 `validateComposeInput` 与任何磁盘写之前；IPC 层**不**预置/补默认该键（`podcast-script-ipc.test.js` 有一条专门断言「不替用户默认同意」）；`runId` 形态判据 `/^[A-Za-z0-9_-]{8,64}$/` 同时是临时目录名 `episode-<runId>` 的穿越边界，浮层侧构造后原样透传 |
| 流程（§7.10.2） | ✅ | 文本链与成片链共用同一条 `runChain`（忙标记与取消窗口闭集不另开一套）；合成实现三件套 `generateTTS/concatBlocks/probeImpl` 缺任一即 `PODCAST_EPISODE_INVALID`，判据是**副作用缺席**（`mkdir` 次数 0 + 忙标记未被占用），不是「返回码相同」 |
| 交互逻辑（§7.10.3 / §7.10.3.1） | ✅ | 入口点击 → 先取只读预览再弹计费二次确认；确认才发 IPC；**关闭浮层不取消发布**（链在主进程），故浮层用 `openedOnce` 常驻而非 `v-if=visible`；`cancellable` 由主进程算，前端不抄相位表；浮层只转发预览值，不自算任何一个显示数 |
| 显示项（§7.10.4 / §7.10.4.1） | ✅ | 块数/总码点/音色三段取自 `podcast:episode:planPreview`；`plan` 缺席**整块不显示**且界面上一个 `0` 都不许出现（用例断言 `not.toMatch(/0\s*块/)`）；`origin` 闭集外不显示并 `console.warn`；来源标注复用 §8.2.9 的三把 `podcast.voice.origin*`，未另写一份 |
| 提示文字（§7.10.5） | ✅ | 本片把主进程侧的逐字提示落成渲染端 locale 键，并在 §7.10.5 追加**三条 2026-10-17 现场**：收割域已扩回且取证顺序不可省；拒绝态取词优先级是「locale 命中即不再回落主进程 message」，**故带数值的码其文案必须自带那个数**；落地 zh 文案逐字与历史 `<N>` 条目的刻意差异（调用点 `t(key)` 不传参，写 `<N>` 会把占位符显示给用户）及将来改回带插值的条件 |
| 测试（TDD） | ✅ | 逐片红→绿：通道半边 `131 passed`（含 `ipc-contract` 双向对账）、浮层 `11 passed`、登记面 `26 passed`、入口 + 浮层回归 `20 passed`、错误码清偿后 `24 passed`（4+11+9）。**清偿欠账的取证顺序**：先只把 `podcast-tts-compose.js` 加进 `PRODUCERS` ⇒ 守卫**当场红并逐条点名 4 个码**；再补 4 把 zh/en ⇒ 转绿。只走第二步就没有东西能证明这条链有牙 |
| 清点式守卫同 PR 喂齐 | ✅ | 三处全喂：`ipc-handlers/podcast.test.js`（通道清单 + `handlers.size` 两处 + `it` 标题中文数目字）、`preload/podcast.test.js`（方法名清单 + 标题）、`usePodcastChannel-ipc.test.js`（**桥接导出面 ≡ preload 暴露面**逐键对账 + 规模下界）；另把新组件路径加进 `podcast-error-codes.test.js` 扫描域、浮层 owner 加进 `overlay-view-suspension.test.js` |
| QM-1 打包 | ✅ | 完整打包 rc=0（产物到 `Multi-Publish.Setup.0.2.0.exe` + blockmap）。**启动三层判据**：存活独立断言 ⇒ `ALIVE_AT=9000ms pid=12296`；`stderr_len=0` 是**读到的 0**（stderr 挂 data 累加，非「没读」）；红线四条不命中 ⇒ 直落第③层 PASS。子进程 env 经 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 显式剔除 `ELECTRON_RUN_AS_NODE`（接线锁既有）。**归属自证取最高一级**：包内三份 blob 与工作树**逐字节相同** —— `ipc-handlers/podcast.js` 28238B、`preload/index.bundle.js` 95002B、`home-shell-preload.bundle.js` 96322B，三者均含本次通道名 `podcast:episode:publishFromScript`；对照组 `preload/index.js` 6533B 可读，证明比对方法本身有效（对照组读不到即整份报告作废）。收尾后 `Multi-Publish.exe` 进程数 0，无残留 |
| QM-4 视觉 | N/A（**已当场量，不是转述**） | 本片的可见改动落在 `copy-library` 视图。实测：该视图**在采集注册表**（`views/all-views.visual.test.js`，37 个之一）但**无基线 PNG**（`base-screenshots/` 内 `grep -i copy` 命中 0），因此不在像素比对域；`node scripts/check-visual-coverage.js` 当场读数 `判定域 112 / 基线 43 / 缺 69（已登记 69，上界 69）/ 无主基线 0` ⇒ 本次改动**既未新增缺口，也无既有基线可漂移**。⚠️ 更正：本线程此前把「浅暗两张基线待从 CI 重取」列为本片欠账，属**沿用未经核实的说法**；真实存量缺口是那 69 条已登记项，不随本片触发，也不得由本片顺手补登（登记上界只能缩小） |
| 行尾与 diff 对账 | ✅ | 两口径逐行相同：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 均为 **23 行 / 23 文件**。规模：`ipc-handlers/podcast.js` +14、`preload/podcast.js` +1、两个 tracked bundle 各 +1、`src/api/podcast-channel.js` +6、`PodcastScriptEntry.vue` +178、其测试 +154、`podcast-script-ipc.test.js` +123、`CopyLibraryView.vue` +60/-10、`locales/podcast/{zh,en}.js` 各 +11、PRD +21、三处守卫小改；`.ccg/reviews/*.json` 为 pre-commit 钩子按父 SHA 生成的判定产物（按类别计数，不写死总数）。由构建器重写但内容与 HEAD 逐字节相同的产物不入暂存清单 |
| 品牌残留 / 文档同步 | ✅ / PENDING | `node scripts/check-no-brand-residue.js` 实跑 `PASS（扫描 9534 个 tracked 文件）`；openspec 同步检查随 CI 的 `openspec-sync-check` 出结果，本机不冒认 |
| QM-6 CCG 双模型外部评审 | ⚠️ **后端轴已交付并通过；前端轴三次尝试未交付判定，按 AGENTS 的「前端最多重试 2 次、3 次全败才跳过」跳过**（不是自扮演豁免） | 后端 `--backend claude`（session `372ecbfd-a97f…`，2026-10-17 02:07 CST 发起，额度重置后实跑）结论逐字：「**无偏差，全部通过**」「无发现需修正」，并逐项对应本片的五个焦点（计费闸门非默认、预览只读无磁盘路径、拒绝态不暴露内部键名、`runId` 形态仍是 `episode-<runId>` 的穿越边界、挂起/释放成对含 `onBeforeUnmount` 兜底）。**采纳前先自核它的一条陈述**：它说 `PodcastScriptEntry.vue:97` 有一道「缺键回落 `message`」的正则——当场读码确认为真（`if (/podcast\.errors\./.test(previewReason.value)) previewReason.value = data.message \|\| …`），这修正了我本线程在对话里「补文案后就不再回落」的**口头转述**（已合入主干的 PRD §7.10.5 那句写的是「缺席才回落 message」，与真实机理一致，无需改动）。一条噪声如实记：日志里出现过 `[claude-code:unrecognized_model] {"model":"thinkingmachines/inkling:free[1m]"}`（其内置 general-purpose 子代理的模型名在本机不可识别），但主会话仍交付了结论。前端轴三次现场：①第一次（`opencode`，PID 37728）交付的是**工作状态**，末尾是「Continue if you have next steps…」，无 findings 无 severity ⇒ 按产物判为未交付；②`codeagent-wrapper resume` 被映射到 **codex**，`codex exited with status 1`，日志满屏 MCP `AuthRequired`（slack/figma/githubcopilot/vercel）；③第三次全新 `opencode` 会话仍以计划态收尾（「汇总产出最终回复…」），仍无 JSON findings。按规则第 3 次全败后可跳过，跳过动作与理由就记在这一行 **dual 产物处置（同一件事的另一半，必须一起看）**：`check-pr-exec-record.js --mode=enforce` 实跑判红一条「CCG 深度审查欠账」——`9fdec1fd2`（机械半边，346 行 > 200 阈值）被判 `mode=dual` 而 `status=pending`。`sh scripts/deep-review.sh` 走不通：它按**当前 HEAD** 的判定记录跑（现场输出「判定记录按父提交 sha 命中：1b2ba518 / 判定: SKIP」），`--force` 也不改变它读的是哪条判定，因此**无法回补一个更早提交的产物**。按该门禁自己给出的补救路径（确认评审已发生后，在记录里写明原因并把 status 置为闭环值）处置：本行的后端 claude 轴评审判据范围是 `git diff origin/main...HEAD`，**覆盖该提交的 346 行全部内容**，故把该产物的 `deepReview.status` 置 `cleared` 并填 `performedBy`/`findings` 现场；改动只做三处定点字符串替换（行数 26 不变、替换后仍可 `JSON.parse`、`mode` 与 `sha` 断言未变）。⚠️ 这不是把 `mode=dual` 降级、也不是假阳性豁免：判据本身是对的，缺的只是「产物按父提交记账、而评审按分支整体验」这一形态错配——留此条给下一个遇到同款的人。 |
| 远程同步 | PENDING | 由本线程后续回填（`git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 取证 + `git ls-remote --heads origin podcast-episode-plan-ui` 返回 0 行），回填与销账同一次提交，并删除本文件 frontmatter 的 `sync_*` 三字段 |

## 一、这一片到底交付了什么（不是「多一个按钮」）

`tasks 4.3②` 的字面范围是「入口 + IPC/preload 通道 + 计费二次确认浮层」。合同片与 ②-a 先量清一件事：浮层要显示的三个数在渲染端**一个都取不到**，于是先落只读预览接口。本片把剩下的三段接成一条**可被用户走通**的链：

1. **机械半边**：通道 `podcast:episode:publishFromScript`（主进程注册 + 两个 tracked bundle 同步重生）+ preload 键 `episodePublishFromScript` + 桥接层导出。三段各有**双向对账**，所以「先合通道、后合消费者」在判据上不成立——本仓把无消费者的通道称作装饰性链路（PRD §7.10.6）。
2. **浮层半边**：`PodcastScriptEntry.vue` 显示预览值、弹计费确认、确认才发 IPC；进度沿用 §6.4.2 那条 `publish:progress` 富化通道（由主进程按发起者单播，不做全窗口广播）。
3. **入口半边**：`CopyLibraryView.vue` 卡片内独立按钮（整卡是 `role="button"`，故必须 `@click.stop`），且**取到正文才挂浮层**。

## 二、两条刻意的「不收敛」，以及为什么

- **`resolveCopyBody` 内部再解析一次 origin**：把 `openDetail` 里的 `sep`/`origin`/`sourceId` 一并搬走会**改动 `sourceId` 的行为**（无 `:` 的 id 下旧码得空串、新写法得整串），而现有用例覆盖不到该分支。为「少三行重复」而静默换语义是错的，故保留三行重复并加一条守卫：驱动断言 `const sourceId = sep > 0 ? … : ''` 必须仍在原位。
- **入口只挂在文案库**：结果页/创作页的成片链已有各自入口（`PodcastEpisodeEntry` 一族），文本链在那两个位置**没有正文来源**。PRD §15 的入口判据（有没有可出期的正文）不成立时，动作不出现，而不是点下去再报错。

## 三、本轮由驱动自己抓到的两类坑（写下来是给下一位省时间）

1. **插入文本与锚点同形 ⇒ 锚点不再唯一**：助手里写了 `let content = entry.content || ''`，与要被替换的那行逐字相同，驱动的「唯一命中才动手」判据拒写。正解是改局部变量名，不是放宽判据。
2. **改声明漏改引用 ⇒ 运行期 `ReferenceError`**：只把 `let content` 改成 `let body`，`content = fullText` 与 `return content` 没跟着改，8 条用例一起红。随后给驱动加了「助手块内不得出现裸 `content`」的字符级判据，把这类漏改钉在写盘之前。

同源教训（已进记忆 [[feedback-script-escaping-traps]]）：含反引号/引号嵌套的内联脚本一律写成文件再跑。

## 四、发现并纠正的一处自身转述错误

本线程连续三轮把「`copy-library` 浅/暗基线待从 CI 重取」列为本片欠账，直到本轮才**当场量**：该视图无基线、不在比对域，缺口属存量登记项。口径与「文件存在 / 函数有测试 / 合同已写 ≠ 有东西在用它」同源——**欠账清单里的每一格也必须有出处**，否则下一个会话会去补一个不存在的需求。
