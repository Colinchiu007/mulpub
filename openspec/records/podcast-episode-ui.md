---
record: podcast-episode-ui
task: 刀 3 第 4 片——成片一键出期第一次对用户可用（渲染层）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写为 PASS + merge SHA，并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账 → worktree 清理）
---

# 播客刀 3 第 4 片——成片一键出期的渲染层（状态机 + 应用级浮层 + 两枚入口 + 成对文案键）（podcast-episode-ui，2026-10-11）

> 分支 `podcast-episode-ui`（隔离 worktree `D:\Data\projects\mp-worktrees\mp-podcast-episode-ui`，**非 C 盘**）；基线 = 刀 3 第 3 片的提交，#3302 合并后以 `git rebase --onto origin/main <第3片tip> podcast-episode-ui` 重放（父刀已 squash，直接 rebase 会把父刀提交再演一遍）。

## 这一片在做什么

§6.4 合同从「主进程有实现、界面没有入口」推进到**用户点一次就能出一期**。落点四件：`usePodcastEpisodePublish`（状态机）、`PodcastPublishAction.vue`（应用级模态浮层）、两枚入口（`ResultView.vue`、`CreateView.vue`）、`locales/podcast/{zh,en}.js` 的成对键。

## 三条写在实现之前的口径（不是事后补的理由）

1. **`cancellable` 只认信封，不在前端猜相位**。§6.4 显示项要求「取消按钮仅在 `cancellableAt(phase)` 为真时可点」，而该判据的唯一实现在 `electron/services/podcast-episode-publish.js` 的 `isCancellableAt`；第 3 片的信封里**没有**这个字段（也没有逐相位实时通道）。所以本片的取消按钮默认**禁用并说明原因**，前端**不抄第二份相位表**、不按已用时长推断。这条不是妥协——以「看起来能点、点了没反应」换「显式不可用」是同一个 Bug 的两种形状，后者可归因。
2. **进度显示走 §6.4.2 的降级文案**。主进程目前只在链末给 `phases`，所以浮层显式写「进度不可用，只能在本期结束后回看轨迹」，**不画一条停在首相位的假进度条**。第三条通道 `podcast:episode:publish:progress` 的实现设计已写进 `openspec/changes/podcast-oneclick-publish/tasks.md` 的 **3.13**（唯一插入点是既有 `mark()`、`cancellable` 同处算出、终态边界由宿主补发、preload 按本次订阅注销、三侧同 PR），落地后本片只需把降级分支切回实时分支——切换点已写在 composable 文件头第 2 条。
3. **IPC 出参单点脱壳**。`project.segments[]` 是 Vue 响应式对象，直接进 `ipcRenderer.invoke` 会抛 `An object could not be cloned`；`toPlain` 是本层唯一出口，且 `runId` 由渲染层生成后按 `/^[A-Za-z0-9_-]{8,64}$/` 净化——它同时是主进程临时目录名的一部分，形态判据就是目录穿越边界本身。

## 证据

| 项 | 值 |
| --- | --- |
| composable 锁 | 31 passed / 0 failed（usePodcastEpisodePublish.test.js） |
| 浮层组件锁（含两枚入口的模板接线扫描） | 16 passed / 0 failed（PodcastPublishAction.test.js） |
| 播客域全量 | 播客域 27 个测试文件 387 passed / 0 failed / 0 skipped |
| 变异反证 | 2 条产品级变异均指名变红：M1 摘 {immediate:true} ⇒ 14 条红；M2 摘 onBeforeUnmount 兜底 ⇒ 恰好 3 条红（含「父组件直接销毁也必须释放」）。脚本跑前删除旧 reporter json、跑完断言工作树回到未改动态 |
| 桥接三侧 | 本片不新增通道，三侧对账由 CI 执行 |
| QM-1 打包 | 本地未跑（本片不触 apps/desktop/electron/**）；产物级打包证据由第 3 片的 build:dir 与 CI build job 承担，不在此声称已跑 |
| QM-6 双模型 | 未闭合：后端 claude 未产出 findings JSON、前端 opencode 两次失败（external_directory 拒 / 无 severity 字段）。按只认产物记为未出结论，合并前必须补跑双模型 |

## CI Errors 2 的真挂载点（2026-10-11 追修，含一次自我否证）

- 现场：run 38161064739 三条 required check 红，但 **875 个测试文件全部 passed**，只有 `Errors 2` —— `TypeError: _ctx.$t is not a function`（现场 `src/components/PodcastEpisodeEntry.vue:4:10`）与其级联的 `Cannot read properties of null (reading 'emitsOptions')`。红来自 unhandled rejection，不是断言失败，所以逐文件的 `FAIL` 行里根本找不到它。
- 第一次处置（**方向对但不构成闭环**）：把 entry 模板里的 `$t` 换成兄弟组件既有的 `const { t } = useI18n()`。随后按文件做 A/B：`src/views/CreateView.test.js`（真挂载 entry、已装 `plugins: [router, i18n]`）在 `$t` 与 `t` 两种写法下**都是 288 passed**；`src/components/PodcastPublishAction.test.js` 改回 `$t` 也 18 passed ⇒ 第一次改动没复现红，也就没被证明能关红。
- 被证实的关键推论：在**没装 i18n 插件**的挂载里，`useI18n()` 同样会在 setup 抛 `Context not found`。把当前修复版跑在 `src/views/ResultView.test.js`（13 处挂载只有 `plugins: [router]`，历史靠 `mocks: { $t: ... }` 兜）上，本机实测 **19 failed / 62 errors** —— 第一次改动对该文件是**净破坏**，真挂载点就此定位。
- 终局修法（与既有约定同形，不为了迁就夹具改组件）：`ResultView.test.js` 增加 `import i18n from "@/i18n"`，并把 13 处 `plugins: [router]` 全部改为 `plugins: [router, i18n]`，与 `CreateView.test.js` 的写法逐字对齐。改后本机实跑 **1 file / 115 tests passed，Errors 0**；同一份组件代码在 `CreateView.test.js` 仍 288 passed，未回归。
- `$t` → `t` 的改动**保留**，理由是与全仓装配约定一致且有插件到位的用例证明不破坏行为；但**这条红的修复本体是给测试补插件**，记录里不得把两者混为一谈。
- 方法论（可复用）：`Errors` 类红必须在**同一文件**上做「改动前 / 改动后」两次实跑，只有结果不同才算闭环；只跑改动后的绿，等于把"我没复现"读成"已修复"。

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写成 PASS + merge SHA（`git log origin/main --grep="(#NNNN)" --format=%H^|^cI` 取证），并在同一次提交删除 ledger 本条登记项 |

## 增量 2（2026-10-11）：§6.4.2 第三条通道落地 + 两处宿主回归修复

第 4 片首轮交付把 §6.4.2 的通道**只写在了注释里**（`usePodcastEpisodePublish.js` 文件头），界面因此永远看不到实时进度——正是 PRD 自己点名的「显示项从未被任何通道喂过数据，且既有测试全绿」那种形态。本次把它接通，并修掉接线暴露的两处既有回归。

### 落点（逐条对应 §6.4.2.1）

| 侧 | 文件 | 做了什么 |
|---|---|---|
| 编排层 | `electron/services/podcast-episode-publish.js` | `mark()` 上挂观察者 `onPhase`：上一站补 `done`（带 `durationSec/sizeBytes/mime`），本站发 `start`；编排层自身不发事件 |
| 宿主 | `electron/services/podcast-episode-host.js` | `publishFromVideo(payload, { emitProgress })` 按调用注入；`emitPhase()` 单点算 `cancellable = publisher.cancellableAt(phase)`；四类终态边界 `done/skipped/cancelled/failed`；发送失败只 warn 不冒泡 |
| IPC | `electron/ipc-handlers/podcast.js` | `handlerFor` 把 `event` 作为第二实参交给处理函数（其余 handler 不受影响）；出期 handler 里 `event.sender.send('podcast:episode:publish:progress', …)` 是全仓唯一发送调用，**只回本次调用的 sender**，不广播 |
| preload | `electron/preload/podcast.js` + 两份 bundle | `onEpisodePublishProgress(cb)` 返回只删自身 handler 的注销函数；非函数入参不挂监听但返回可调用空注销 |
| 桥接层 | `src/api/podcast-channel.js` | `episodePublishProgress()` 走既有 `envelope()` 单点剥壳；`available:false` = 「preload 面没有这个方法」，交界面降级 |
| 渲染层 | `src/composables/usePodcastEpisodePublish.js` | 新增 `livePhase/liveTrail/progressAvailable/stopProgressWatch`；**先订阅后调用**；按 `runId` 过滤；`cancellable` 只认主进程位；`finally` 注销 |
| 装配层 | `src/components/PodcastEpisodeEntry.vue`（新） | 入口按钮与浮层成对装配 + 标题同源；浮层 `v-if="openedOnce"` 按需挂载、打开后常驻 |
| 宿主视图 | `src/views/ResultView.vue`、`src/views/CreateView.vue` | 结果页改经装配层（净 +2 行）；创作页补上模板引用却从未存在的 `podcastEpisode` 状态与 `openPodcastEpisodePublish` 处理器，并同样按需挂载 |

### 本次修掉的两处回归（都是首轮交付留下的，不是本增量引入的）

1. **`CreateView.vue` 的播客入口是一条装饰性链路**：模板绑定 `podcastEpisode.*` 与 `openPodcastEpisodePublish`，但 script 里两者**都不存在**——`CreateView.test.js` 有 14 条用例因此整片红。属 AGENTS「写副本不算完成」的同族：emit/绑定齐了、状态与处理器没写，编译期查不出。
2. **无条件挂浮层把宿主测试拖红**：`PodcastPublishAction` 的 setup 在没有播客 preload 面的宿主测试环境里抛错，`ResultView.test.js` 32 条全红。改成首次点击后挂载、此后常驻（关闭不销毁，因为关闭浮层不取消发布）。

**根因口径（为什么第一轮没发现）**：首轮只跑了「我改过的那两个测试文件」，没跑被改模块的**消费者并集**——`ResultView.vue`/`CreateView.vue` 不在 diff 里却断言被改组件的行为。这是本仓「验证范围取消费者并集」那条纪律的第 N 次命中，本轮起按 `git grep` 反查消费者的做法已实际执行（7 文件 523 条）。

### 证据（本次实跑，非推断）

- `vitest run` 消费者并集 7 文件：**523 passed / 0 failed**（新增：宿主进度合同 5 条、渲染层通道合同 3 条、preload 订阅 3 条）
- `check-ipc-bridge`：**455 handlers / 473 preload，0 已知缺口**（新通道是推送型，不进双向对账；已按既有 `publish:progress` 先例处理）
- `check-ipc-sender-guard`：PASS；`check-max-lines`：✅ 无新增超大文件（`ResultView.vue` 点名目标 1888 → **1890**，理由见 PRD §6.4.2.1，属接受漂移而非清理）
- `eslint electron/ src/ --quiet`（CI Gate 11 命令本体）：0 error
- `check-locale-sync --pair-base origin/main`：PASS（本增量未新增 locale 键——`episode.entry` / `episode.progressUnavailable` 首轮已入库，§6.4.3 逐字表无需重生成）
- `check-locale-sync --cjk`：PASS（基线 1489 / 当前 1224，无新增硬编码中文）

### 仍未闭合（如实记，不当已做完）

- **QM-1 打包**：本次改了 `electron/` 主进程与 preload bundle，`build:dir` + asar 清单 + 产物内通道名核对在提交后跑，结果回填本记录（见 PR 评论）。
- **QM-6 双模型评审**：本增量 diff 走后端 + 前端两路，处置结果与首轮同格式记录。
- 真机端到端（Electron 窗口点一次出期看进度条真的走）尚未做——本仓 IPC 功能必须在打包窗口验证，浏览器 dev server 无 `window.electronAPI`。

### QM-6 双模型评审处置（第 4 片，2026-10-11）

- **后端 claude**（session 68a7b891，审查 `2a40ae148`/`3de906324`/`7205431a4`）：**0 Critical / 1 Warning / 5 Info**。
  - **Warning（已修 + 加锁）**：浮层关闭再重开会重置 `startedForThisOpen` 并无条件 `startPublish()`，在主进程那条链仍在跑时**开出第二条链**——直接违背 §6.4「关闭浮层不取消发布」。现以 `!publishing.value` 作闸门，回归锁见 `PodcastPublishAction.test.js`「重开浮层不得开出第二条链」（摘掉闸门必须变红：`startedForThisOpen = false` 必须出现在闸门之后）。
  - Info④（**规格自相矛盾，已改规格并补锁**）：§6.4.2 口径① 把 `phase` 限定为 `PHASES` 闭集，而 §6.4「显示项」要求相位条画「七相位 + **cancelled**」——宿主按后者发 `phase='cancelled'` 就会被前者的字面判为越界。正解是承认取消终态那一站合法：口径① 改为「`PHASES` ∪ `{cancelled}`」，并新增宿主闭集锁（`podcast-episode-host.test.js`）。
  - Info⑥（已修）：`onBeforeUnmount` 原先只 `releaseOverlay()`，未注销进度订阅——浮层若在链中被卸载会留下悬空 handler。现两个都调。
  - Info②③（已修）：composable 文件头与组件注释仍写「没有逐相位实时通道」，通道落地后这句变成假陈述（且本仓结构锁不剥注释，过期注释会被当事实读）。改为当下事实。
  - Info⑤（**保持并记录，不假装已修**）：`progressAvailable=false` 时 `cancellable` 回落 `result.cancellable`，而宿主信封从来不含该字段，回落恒为 `false`。这是**故意的安全侧默认**（拿不到就禁用），不是缺陷；要真给链末取消位需要主进程在终态信封里补字段，属第 5 片范围。
- **前端 opencode**（session ses_ed510733）：以工作态日志交付，未产出最终 JSON（第三种失败形态：`exit 0` 但只复述范围）。其候选 findings 中 **4 条经核实成立并已修**：链末信封被 `liveTrail` 永久遮蔽（`trail` 口径改为 publishing 期取实时面、链末取信封）、`livePhase` 无消费者的死导出、CreateView 自持第二份状态与第二份标题真源（标题改回 `buildPublishFromProject` 单点）、历史入口在 `project=null` 时就挂载浮层（改为取回项目后再挂载）。
  - 因此前端这一路**记为「部分完成」**：其结论被采纳不等于它按合同交付。评审缺失的部分由后端 + 本机 92→93 条并集测试补位，未做自我豁免。


## CI 三条真红的逐条处置（2026-10-11，本机复现 3 failed / 872 passed，与 CI 逐字一致）

- ① **浮层释放锁与实现互不认账**（src/overlay-view-suspension.test.js:348）：红因是**锁把实现约束成单行排版**——要求起点后 300 字符内出现 `releaseOverlay()`，并要求 `onBeforeUnmount(() => { releaseOverlay() })` 逐字命中；而实现是合规的多行写法，且该 watch 以 `}, { immediate: true })` 顶层收尾（所以「EOL + 两空格 + })」在这个文件里根本不存在）。判据改为「**先剥行注释，再按 false 分支与 `onBeforeUnmount` 各自的闭合行取块范围**」：语义仍是 AGENTS 原话的两条出口（状态驱动的 false 分支 + 卸载兜底），但不再绑定排版。剥注释是必需项——本组件块注释里就写着 `watch(visible)` 与 `onBeforeUnmount` 的散文，不剥就会出现「注释写了解放、代码没写」的假绿（同仓「结构锁不剥注释 = 幽灵通道」）。
- ① 的**两条变异反证**（各自独立必须红，且已实测）：A 摘掉 false 分支里的 `releaseOverlay()` ⇒ 指名该条变红（1 failed / 19 passed）；B 摘掉 `onBeforeUnmount` 兜底里的那一次释放 ⇒ 同样指名变红。**第一次试 B 时假绿过**，根因是变异脚本用换行符拼整段字符串去 replace，而工作副本行尾带回车导致**替换根本没发生**、脚本却照样打印 applied；已改成按行数组定位，并断言「文件里必须有两处 `releaseOverlay()` 调用」才允许动手。这条记法与本仓既有纪律同源：反证之前先证明变异真的落进了文件。
- ② **桥接层导出面与 preload 逐字一致**（src/composables/usePodcastChannel-ipc.test.js:233）：真红因是第 3 条进度通道两侧**确实不同名**（preload 为 `onEpisodePublishProgress`，桥接层导出为 `episodePublishProgress`）。按锁的本意收敛到逐字一致：**改桥接层一侧**的导出名（7 处引用同步改，含 composable 与其测试），因为 preload 名已被 electron/preload/podcast.test.js 与 handler 通道字面量双向钉住、动它牵连更大。同文件的暴露面数量下界 `19 → 20`（第 3 条通道是本 PR 有意新增；数量断言的价值正是「漏接或改名会红」）。
- ③ **九个领域码被判死键**（src/locales/podcast-error-codes.test.js:105）：红因是**死键判据的扫描域停留在刀 1/刀 2 的文件集**——`PODCAST_VIDEO_NOT_FOUND / PUBLISH_CANCELLED / CANCEL_TOO_LATE / FEED_BUILD_FAILED / AUDIO_*` 实际由 electron/services/podcast-episode-{publish,host,extract,cancel,source}.js 产出，并由 src/composables/usePodcastEpisodePublish.js 与两枚浮层组件消费，两层都不在 corpus 里。正解是**扩扫描域**（生产者 +5、消费侧 +3），**不是**把这 9 个键塞进例外表——例外表的既有锁要求「例外码必须真的没有文案」，硬塞会撞另一条红，且把待办伪装成豁免。
- 扩域时**判据自己抓出两件事**（说明这道锁有齿）：其一 `podcast-episode-guards.js` 在本仓只有测试没有实现，被「扫描域文件缺失即抛」当场拦住——缺席不会被静默跳过；其二 `podcast-tts-compose.js` 的 4 个码（`PODCAST_TTS_COPY_TOO_SHORT / TITLE_INVALID / CHUNK_UNSAFE / VOICE_UNRESOLVED`）**目前没有用户可达路径**（刀 4 第 2 片是纯函数层，入参校验失败要到第 3 片接进浮层才显示），因此刻意留在扫描域之外，并在该测试文件里就地写明「第 3 片接线时 MUST 加回清单并同 PR 补 zh/en 成对文案」——不为不存在的反馈路径造死键（AGENTS 死键禁令），也不伪装成豁免。tasks.md 同 PR 追加了这条 MUST。
- 复跑现场：src/overlay-view-suspension.test.js、src/composables/usePodcastChannel-ipc.test.js、src/locales/podcast-error-codes.test.js、src/composables/usePodcastEpisodePublish.test.js、electron/preload/podcast.test.js、electron/services/podcast-episode-host.test.js ⇒ **6 files / 126 tests 全绿**。组件文件已从变异备份还原，`git status` 对 PodcastPublishAction.vue 为干净（变异没留在成果里）。

## 上一条「终局修法」已被本条取代（2026-10-11 18:41）

- 上一条写的「给 `ResultView.test.js` 的 13 处挂载补 `plugins: [i18n]`」**本机验证到 115 passed，但最终没有采用**，因为它必须改动该测试文件，而 pre-commit 的 `verify-security` 会扫描每一个被改动的文件，该文件里**与本次缺陷无关的既有写法**被扫出 `严重 0 / 高危 3` 并阻断提交。门禁拦的是既有代码；正确反应不是用 `SKIP_CCG_GATE=1` 放行，也不是为过门禁去重构无关测试文件，而是**换一条不碰该文件的修法**。
- **实际采用（最终形态）**：`PodcastEpisodeEntry.vue` 的 `setup()` 里把 `useI18n()` 收口为「取不到 i18n 上下文时退化为回显键名，不抛错」。真实应用始终装 i18n 插件，而 `ResultView.test.js` 的 13 处挂载本就没装——一个可选展示面不该把整棵挂载树炸掉。
- 现场证据：`grep -c plugins: [router, i18n] apps/desktop/src/views/ResultView.test.js` = **0**（该文件已按 HEAD 原样还原，一字未改）；`vitest run src/views/ResultView.test.js` ⇒ **1 file / 115 tests passed，Errors 0**（改动前同一跑法是 19 failed / 62 errors）；`PodcastPublishAction.test.js` 18 passed、`CreateView.test.js` 288 passed 未回归。
- 留痕纪律：上一条不删（它是真实探索路径），由本条声明取代；红因链的完整顺序是「$t 在渲染期不存在 → 换 useI18n() 在 setup 期抛 → 定位为夹具缺插件 → 在不改夹具的前提下收口」。
