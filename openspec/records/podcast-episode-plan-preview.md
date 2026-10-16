---
record: podcast-episode-plan-preview
task: 落地 tasks 4.3②-a —— 出期前计费二次确认框的只读预览接口（PRD §7.10.4.1 的唯一读路径）
date: 2026-10-16
# ↓ 远程同步尚未收口 ⇒ 按 scripts/check-gate-record-debt.js 的第二源判据必须显式登记原因与回填责任人；回填时整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 与合并时间还不存在；合并后由本会话开回填 PR，把「远程同步」行改成 PASS + merge SHA，并在同一次提交删除本段三个字段
sync_backfill_owner: podcast-episode-plan-preview 会话（本节作者）
---

## 本次执行记录：出期前只读预览接口（podcast-episode-plan-preview，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree 在仓库父目录下的 `mp-worktrees/mp-podcast-episode-plan-preview`（非 C 盘），裸分支 `podcast-episode-plan-preview`，由 `scripts/start-mp-task.ps1 -TaskName podcast-episode-plan-preview` 建立（非 C 盘）；`pnpm install --frozen-lockfile` + `node scripts/ensure-electron.js`（v43.7.7）+ `node scripts/verify-worktree-deps.js` 三步均 rc=0，解析通过 11 个 `@multi-publish/*` 指向本工作树 |
| 第一性原因（QM-5 ①） | ✅ | 不是「浮层没做」，是**它要显示的数在渲染端 0 可达**：分块判据只在 `electron/services/podcast-tts-compose.js` 的 `planChunks`，音色回退只在 `podcast-tts-voice.js` 的 `resolveEpisodeVoice`，而后者**零生产调用方**（`git grep` 实测：非测试文件里只有它自己）。缺这条读路径时先做浮层只能显示 0，或让前端另抄一份切分/推断 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层没测「渲染端能不能取到」——`planChunks`/`resolveEpisodeVoice` 各自测试全绿，**判据存在 ≠ 有人能读到它**；视觉层对本次改动无感（本片不动 UI）；审查层此前只盯「代码是否调了判据」，没盯「显示项反查喂它的通道」（同 §6.4.2 那七相位那次）。本片的三条锁就是补这一格 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 判据之家：`electron/services/podcast-episode-plan-preview.test.js` **17 例** + `electron/ipc-handlers/podcast-plan-preview-ipc.test.js` **9 例**（后者含「副作用缺席」三件同断言：目录未创建 + `tryBeginPublish`/`endPublish` 0 次 + 宿主两个入口 0 次）；用真 `planChunks`/`resolveEpisodeVoice`（不 mock 判据本体），夹具只喂数据 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 清点式守卫同 PR 喂齐**三处**（`ipc-handlers/podcast.test.js` 通道清单 19→20、`src/composables/usePodcastChannel-ipc.test.js` 暴露面 20→21 + METHODS 登记、`electron/preload/podcast.test.js` 方法名清单）；② 「改 preload 必须重生两个 tracked bundle」升级为**可执行判据**（IPC 测试里直接断言两个 bundle 含通道名，M-E 实测会红），并同步写进 PRD §7.10.4.1；③ 本条记录 + CHANGELOG |
| 行尾与 diff 对账 | ✅ | 两口径 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 逐行相同；改动规模：`ipc-handlers/podcast.js` +68/-0、`preload/podcast.js` +1、两个 bundle 各 +1、`src/api/podcast-channel.js` +6、`podcast.test.js` 2 行改写、PRD +12/-2、tasks +5/-1、CHANGELOG +12（新增一个标题块，标题计数 478→479）。三个由构建器重写但**内容与 HEAD 逐字节相同**的产物（`monitor-preload.bundle.js`、`stealth-preload-enhanced.bundle.js`、`generated/card-paginator.iife.js`）不入本 PR 暂存清单 |
| 接线棘轮 | ✅ | 两个新测试都在 `apps/desktop/electron/**`，由 vitest workspace 既有 include 收集（不属 `check-unwired-tests.js` 的 scripts/.github 域）；该判据实跑 rc=0（域内 89 个文件全部已接线或按欠账登记） |
| QM-1 打包 | ✅ | `pnpm exec electron-builder --win --dir --publish never` rc=0（先 `pnpm run build:vue` 出渲染层，否则启动验证必假失败）。三层判据：① 红线四条（与 `scripts/qm1-scheduled-publish-verify.cjs` 同源逐字）不命中；② stderr 为空 ⇒ 直落第③层；③ 存活断言独立于 stderr（`exitCode=null` 且 `Multi-Publish.exe` 进程数 0→4，只 kill 自己 PID，收尾后回 0）。**归属自证取最高一级**：包内 blob 与工作树**逐字节相同** —— 新模块 6051B、handler 20827B、`preload/index.bundle.js` 90001B、`home-shell-preload.bundle.js` 91321B，另带一个本次未改动文件 `podcast-tts-voice.js`（6974B）当对照组证明比对方法本身有效；解包后真 `require` 通过（导出 `createEpisodePlanPreview, PREVIEW_ERRORS, REQUIRED_DEPS`） |
| QM-4 视觉 | N/A | 本片不动任何渲染面与样式（只加主进程 IPC + preload 桥），无新像素用例；浮层的视觉回归随 ②-b 一并跑 |
| QM-6 CCG 双模型外部评审 | ⛔ **后端轴今日不可执行（如实记，不以自审冒充）** | 前端轴 `--backend opencode` 已发起（18:02，PID 37748，workdir 传 `.` 且 cwd 在 worktree 内以避开 `external_directory` 自动拒绝）。后端轴按 `~/.claude/.ccg/config.toml` 的 `[routing.backend].primary = "claude"` 起，实测被上游拒绝，现场文案逐字：`Failed to authenticate. API Error: 403 今日免费订阅额度已用尽（次日 00:00 CST 自动重置）…`；换路也试过——`--backend codex` 起进程后 `codex exited with status 1`（日志现场是 `401 Unauthorized … Provider: OpenRouter; model: nvidia/nemotron-3-ultra-550b-a55b:free … Missing Authentication header`），`--backend gemini` 是 `gemini command not found in PATH`。**结论：本片不具备「两个不同家族模型」的外部交叉评审条件 ⇒ 不开自动合并、不宣布交付闭合**，等额度重置（次日 00:00 CST）补跑后端轴或由人明确豁免。前端轴结果到达后逐条处置并追加到本节下方 |
| 远程同步 | PENDING | 本 PR 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间、`git ls-remote --heads origin podcast-episode-plan-preview` 返回 0 行证远端分支已删，并在同一次提交删除本段三个 sync_* 字段 |

## 一、这一刀到底解决了什么（不是「多一个接口」）

`tasks 4.3②` 的字面范围是「三枚入口 + IPC/preload 通道 + §7.10.3 计费二次确认浮层」。合同片（#3714/#3715）先量出一件事：浮层要按 §7.10.4 显示**块数、总码点、服务商/模型/音色三段并标注命中来源**，而这三个数**在渲染端一个都取不到**。于是本片只接这一条读路径，且它的正确性判据不是「能返回数」，而是三件事同时成立：

1. **只读**（本层拿不到写能力 + 接线处行为缺席可证）；
2. **一份口径**（块数与码点来自 `planChunks` 那一份，音色来自 `resolveEpisodeVoice` 那一份，拒绝态沿用既有领域码，没为预览新造任何码）；
3. **不显示假来源**（`origin` 闭集外 ⇒ 计数照给、音色整段不给看并出声）。

## 二、落地面

| 文件 | 内容 |
| --- | --- |
| `apps/desktop/electron/services/podcast-episode-plan-preview.js`（新，132 行） | `createEpisodePlanPreview(deps).previewEpisodePlan({channelId, script})`；四个注入实现缺任一即 `PODCAST_EPISODE_INVALID` 拒绝；不 require `fs`/`child_process`/`net`/宿主链 |
| `apps/desktop/electron/ipc-handlers/podcast.js` | 惰性工厂 `getPlanPreview()`（注册阶段不构造）+ 字面量注册 `podcast:episode:planPreview`（`withSenderCheck(handlerFor(...))` 显式守卫形态）；文件头通道合同清单补该条 |
| `apps/desktop/electron/preload/podcast.js` + 两个 tracked bundle | 扁平键 `episodePlanPreview`；`pnpm run build:preload` 已重生 `preload/index.bundle.js` 与 `home-shell-preload.bundle.js` |
| `apps/desktop/src/api/podcast-channel.js` | 桥接转发 `episodePlanPreview`，方法名写成字面量（`ipc-exposure-contract` 按字面量抽名） |
| `openspec/changes/podcast-oneclick-publish/tasks.md` | 勾 `4.3②-a` + 就地补证据行；**把 locale 那一半拆成新的未勾项 ②-a-l** |
| `01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md` | §7.10.4 表那行的「数据来源」改成现路并标注浮层未消费；§7.10.4.1 标题状态由「合同，尚未实现」改为「主进程与 preload 已落地，浮层与文案键未落地」；追加「落地现场」四条 |

## 三、两处偏差（就地明写，不等下一个会话来发现）

- **三把 `podcast.episode.plan*` 键不在本片**。tasks ②-a 原文把它们列在本片范围内，但本片没有任何渲染层消费者——先落键就是 AGENTS 明禁的死键。处置：拆出未勾项 **②-a-l**，随 ②-b 的浮层同 PR 落地，并要求同次把新渲染层文件加进 `podcast-error-codes.test.js` 的死键扫描域（加键不加域比漏判更糟，PR #3332 的既有口径）。
- **验收判据 3 / 4 未闭合**：那两条量的是浮层怎么显示拒绝态、怎么在预览失败时不毁掉发起按钮，落点 `PodcastEpisodeEntry.vue`，属 ②-b。本片只闭合 1 / 2 / 5 / 6 / 7。§7.10.4.1 的「落地现场」把这件事写在合同旁边，而不是留在本记录里。

## 四、频道级音色：① 层今天恒空（可执行判据，不是推测）

`voiceRef` 在 `podcast-channel-registry.js` / `podcast-channel-service.js` / `channel.json` 的 meta 里命中 **0**（`git grep -c` 实测），所以生产路径上 `origin` 只会是 `preference` 或 `providerDefault`。接线按「存在则取」写（`getService(channelId).getChannel().voiceRef`），**没有为此新造字段**：频道音色进真源是 4.5 的范围，届时 ① 层自动生效、本预览一行都不用改。反过来，如果谁把 ① 层当"已支持"来标 UI，就是拿一条不可达的分支给用户看假证据。

## 五、变异反证与三条自造事故

变异 7 条，每条只动一个变量、跑指定文件、要求**指名那条用例**变红，跑完按 md5 逐字节还原：M-A 自数块数 / M-B 闭集外 origin 照显示 / M-C 缺实现不拒 / M-D 预览占忙标记 / M-E 改 preload 不重生 bundle / M-F 自算总码点 / M-G 本层去碰 `fs` —— **7/7 CAUGHT**，且每次的红集只有 1 条（说明锁各自独立承重，不是整片 LOADFAIL）。

两条我自己的事故，值得留在记录里（它们比"锁有牙"更能防下一个人重犯）：

- **变异串必须让判据要找的那串真的消失**。第一版 M-E 把 bundle 里的 `podcast:episode:planPreview` 改成 `podcast:episode:planPreviewX` —— 超串仍然包含 needle，`toContain` 照绿，于是这条判据被误报成"没牙"。换成 `podcast:episode:planRemoved` 后当场指名红。**判据无罪，是我的探针没插进去。**
- **备份按 basename 命名会撞名**：`ipc-handlers/podcast.js` 与 `preload/podcast.js` 的 basename 都是 `podcast.js`，驱动的备份目录按 basename 存 ⇒ 后者覆盖前者，还原时把 preload 的内容整份写进了 IPC handler（4302 字节的错文件顶在 17430 字节的位置上）。当场被驱动自己的 md5 断言抓住（`还原后 md5 不一致`），没有扩散成第二次破坏。修复顺序：`git checkout HEAD -- <精确路径>`（只用精确路径，不碰宽目录）→ 两份带断言的重放脚本重建（合同行 + 工厂 + 注册点，全部校验先于写盘）→ 重跑 5 文件 77 例绿 → 驱动改为**备份名带序号 + 开工前自证基线**（注册点/桥接键不在位就拒绝开跑）。同族第 N 次：判据/夹具的"坐标"必须自己会报错，而不是等人去读。
- **探测脚本抛错之后，我照常「git add + rebase --continue」⇒ 把三行冲突标记提交进了 CHANGELOG**（同一次 rebase 里的第二条自造事故，比上一条更该记，因为它骗过了我自己的眼睛）。
  起因是解冲突驱动里一处参数写错：把一个正则的**字面量写法**当字符串交给做精确匹配的查找函数，必然找不到、必然抛错；而我把驱动与后续动作串在同一条命令里跑，**没有单独取驱动的 rc**，于是错着也往前走。
  当场骗人的信号是「Successfully rebased and updated」——**rebase 成功与冲突解得对不对是两件事**，前者只说明索引被接受了。真正判得住的是事后独立跑一次标记计数（本次实测报 3），而不是「驱动没报错」。
  修法（fix-changelog-conflict.cjs）：两侧都是不同的新块 ⇒ 并集（新块在顶，并补回被 git 吃掉的块间空行），且校验必须**先于写盘**，七件缺一不可——标记清零 / 两侧块首行各自命中预期标题 / 块长下界 / 行数等于原行数减三加一 / CRLF 与 LF 分别对账（被删的三行标记自己带行尾，所以不能要求总数相等）/ 行内容与行尾的**多重集**一致 / 新块确在顶部。修完标记计数 0、标题数 482，主干已合并的两块与更早的 docs(prd) 块逐块仍在。
  **收口的规矩（本仓第 N 次同族）**：任何「解冲突 / 打补丁」的驱动，其 rc 必须单独取、单独判，非 0 即禁止接着 git add；判据要问「输出里还有没有标记」，不能问「驱动有没有报错」。

## 六、遗留与不假装闭合的部分

- QM-6 后端轴（claude）今日额度用尽 ⇒ **本片不 arm 自动合并**；前端轴结果到达后逐条处置。补跑命令与现场见上表 QM-6 行。
- ②-a-l（三把 locale 键 + 死键扫描域）与 ②-b（出期通道 `podcast:episode:publishFromScript` + 计费浮层 + `CopyLibraryView` 入口，另两枚入口各留未勾子项）仍未开工。
- 验收 3 / 4 属 ②-b，本片不认领。
- `voiceRef` 在频道真源缺失（4.5 的范围）；`resolveEpisodeVoice` 的 ① 层在生产上不可达这一事实已写进 PRD 落地现场，避免下一个人以为它已经生效。
