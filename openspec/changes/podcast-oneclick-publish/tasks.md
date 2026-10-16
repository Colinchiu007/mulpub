# 任务：播客 RSS 频道接入一键发布

## 1. 刀 1 多频道数据模型与迁移（本 PR 交付）

- [x] 1.1 `podcast-channel-locks.js`：两把按记录键的串行锁（index / channel）+ 发布防重入标记 `publishInFlight`；四条口径：缺键即抛、不同键互不阻塞、超时等待者不得执行临界区且仍推进序位、临界区抛错必须放行后来者
- [x] 1.2 `podcast-channel-registry.js`：`index.json` 读写（原子 rename + Windows 有界退避）、`ch_<16hex>` 不可变 id、create/rename/setDefault/list、`{cap,count}`、hosting 只存 `credentialRef`
- [x] 1.3 迁移 `ensureMigratedOnce()`：内容哈希三态判定、`migrationStatus: conflict|error` 持久化、`resolveMigration(keep_legacy|keep_existing)` 幂等、legacy 不删、**不改写 guid**
- [x] 1.4 服务层：`channelDir`/`channelId` 作用域化、`channel.json` 拆 `meta`/`feedSync`、`readFeedSync`/`writeFeedSync`、`episodeCap()`、`saveEpisode(…, {strict})` 预校验**合并结果**（strict 拒绝 / 非 strict 出声）
- [x] 1.5 IPC：6 条通道加必填 `channelId`、`endpoints:list` 保持无参、新增 `channel:list|create|rename|setDefault|migrate:resolve`、`episode:list` 回 `{episodes,cap,count}`、`episode:save` 透传 `strict`
- [x] 1.6 preload + 两个 bundle 重生成 + 渲染层桥 5 个新导出（字面量方法名）
- [x] 1.7 渲染层：composable 集中注入 `channelId`（`CHANNEL_SCOPED` 单点，禁止 7 处各写一份）+ `loadChannels/createChannel/renameChannel/setDefaultChannel/resolveMigration/switchChannel/refreshQuota`
- [x] 1.8 视图：频道目录区块（切换器、新建、设为默认、迁移冲突两个处置按钮、配额提示、空态）+ zh/en 成对 `podcast.picker.*` 20 键
- [x] 1.9 测试：registry 13 例、locks 9 例、service 22 例、ipc 10 例、preload 通道名 13、view 行为、单轨制结构锁；播客全域 158 例绿
- [x] 1.10 静态门禁：`check-ipc-bridge`（447 handlers / 465 preload / 0 缺口）、`check-locale-sync --pair-base/--cjk`（无新增硬编码）、`glossary.test.js`
- [x] 1.11 QM-1 打包 + 启动 8 秒 + asar 清单 + `verify-worktree-deps`（刀 1 已随 PR #3279 交付：build:dir rc=0、asar 清单含新模块、asar 内 require 通过；启动存活由 CI `gui-test`=pass 闭合）
- [x] 1.12 QM-6 双模型外部评审（实现 diff）+ 逐条处置（后端 claude 8 条：i1–i4、i6–i8 upheld 已修，i5 partially_accepted；前端 opencode 未产出 JSON 产物，如实记为部分完成。裁决 `.adversarial/ccg-deep-9ce8fdbf/adjudication.json`，i3 高危域走外部复核未自扮演豁免）
- [x] 1.13 QM-4 视觉：`podcast-channel` 浅/暗基线按同一次 CI run 重取并逐项归因（run `38073491010` Gate 7b：43 张中违规恰好 2 张且均属本 PR，其余 41 张 0 px；逐字节自证 sha256 `f41cc163…`/`7ca6f9d0…`）

## 2. 刀 2 托管直传接线（后续 PR）

- [x] 2.1 凭证加密落盘（`credential-store`）+ `:save` 的 secret 缺席=保持、拒空覆写（`podcast-hosting-service.saveHosting` 单点判定；`index.json` 只存 `credentialRef`；行为锁 + 18 例服务层用例）
- [x] 2.2 `podcast:hosting:get|save|check`（check 注入 `httpClient`，缺省零出站并如实回 `checked:false`+理由；通道名为源码字面量，ipc-contract 对账通过）
- [x] 2.3 `podcast:feed:publish`：先建回滚点（本地 `feed.prev.xml` + OSS 时间戳副本）→ 覆盖主键 → `writeFeedSync`；`backupCreated` 进结果态与界面标注；一键退回本期不做，已明写为边界（§13 第 6 条）
- [x] 2.4 行为锁⑦（重启后 partial 仍在）+ 结构锁⑫：刀 2 另落 ⑱–㉓ 七条（读流 error 监听 / 2xx 不掩盖读体失败 / clearSecret 在 payload 内 / 未接入 provider 不可选 / 文案接线取真实 locale 值 / `@published` 父绑定 / 发布形状按 handler 返回体断言），每条做过独立变异反证
- [x] 2.5 QM-6 后端（claude）结构化 JSON 6 条逐条处置（1 Warning + 5 Info，**6 upheld / 0 拒绝**）：凭证成对守卫 b2-1、`toIpcError` 空数组归类 b2-2、**回滚点快照挪到 `buildFeed` 之前** b2-3（本刀影响最大：`backupCreated:true` 曾说的是假话）、失败态写盘抛错顶掉返回形状 b2-4、`pathPrefix` 双层边界对齐 b2-5、探测键唯一化 b2-6（采纳判据、否掉 HEAD 建议并给理由）。7 条变异各自把守卫改回「修复前形态」，用 json reporter 核对红的正是指名那条；产物 `.adversarial/ccg-deep-84c3413a/`（adjudication b2-1..b2-6 + critique-backend-v1.md + family-snapshot 的 secondRound）
- [x] 2.6 处置增量的跨家族复核（opencode 续会话审 `64f38c7ca..HEAD`）再命中 2 条：**d-1** `prevExists` 被写成 `snapshotted`，「有旧版但拷贝失败」会显示「首次发布」（改为 `hadPrevious`，两维正交；日志同时记 `prev=` / `snap=`）；**d-2** 备份文件用 `copyFileSync` 直接覆写，中途被杀会留下撕裂的 prev（改为临时文件 + 复用 `podcast-channel-service` 导出的 `atomicRenameSync` 唯一实现，并把它显式导出）。各 1 条行为锁先红后绿，变异反证 M8/M9 指名变红

## 3. 刀 3 成片一键出期 + 共用手柄（后续 PR）

- [x] 3.1 `readDegradedFlags`（与 `ResultView.vue` 的降级徽标**同真源同判据**，判据只认 `degraded === true`）——落 `podcast-episode-source.js`，命中即 `PODCAST_AUDIO_DEGRADED_SOURCE` 且在**任何出站与写盘之前**拒绝
- [x] 3.2 `extractMix`（ffmpeg 抽**完整混音**，无音轨/抽取失败/编码器缺失三种成因分别给码并 fail closed，不回退旁白）+ `probe`（ffprobe 实测 `durationSec`/`sizeBytes`，容器→显式 `mime`，不靠 URL 猜）——落 `podcast-episode-extract.js`，宿主调用经 `spawnImpl` 注入（**真实进程接线在第 3 片**）
- [x] 3.3 三处一致校验（`fs.stat` == ffprobe == `putObject` 返回 size）在 `podcast-episode-publish.js` 挂期之前收口，不等即 `PODCAST_AUDIO_SIZE_MISMATCH` 并阻断后续相位；**存储侧损坏在默认零出站路径不覆盖**仍是欠账（见 PRD §13 与 records）
- [ ] 3.3a 下半片合同已落规格（PRD §6.4 入参/返回/错误码映射表/显示项/取消交互/校验三层 + spec 新增 Requirement）：代码实现按该节做，任何偏离必须先改本节再改代码，不得在实现里另立口径
- [x] 3.8 **刀 3 上半（#3291）的 QM-6 后端补审结论处置清单（0 Critical / 3 Warning / 3 Info，评审在合并之后才落，见 `.adversarial/ccg-episode-publish-slices/critique-backend-v2.md`）**：① W1 `createEpisodePublisher.publish()` 全程不调 `tryBeginPublish`/`endPublish`，出期链**实际不持频道忙标记**——而 `publishAudio` 的注释与适配层模块头都写着「锁归整条出期链」，那句话现在是假的（合并前未跑完评审的代价，正是本条要记的债）；修法=编排入口取锁、`finally` 放锁，并把注释改成与实现一致。② W2 `publishAudio` 不做 `channelId` 清洗就拼进 objectKey，可逃逸出 `audio/<channelId>/` 这一层（`stem` 清洗得很干净，id 反而没洗）——修法=复用同一段白名单清洗并配一条「id 带 `../` 必须被拒或洗净」的锁。③ W3 抛出错误的相位字段名不一致（音频 https 失败与取消用 `.phases`，其余用 `.publishPhases`），排障脚本按一个键取会漏。④ I 两处：https 判据在三个文件里各写一份正则（应收成单一谓词，与仓内 `safe-http-url` 的收敛先例同源）；`partial.errorMessage` 在有 message 时丢掉 status，真 adapter 的 403 永远进不了结果契约。⑤ I 一条：`podcast-hosting-audio.test.js` 把 `_put` 整体 mock 掉，真实 `_put` 的 URL 守卫从未被真路径覆盖（「拼不出 https」那条测的是 publishAudio 自有判据）。
- [x] 3.4 `usePodcastEpisodePublish` 状态机（相位闭集 + 逐格驱动全部结果态）+ `PodcastPublishAction.vue` 浮层 + 挂起合同登记
  - 证据（2026-10-14，读 origin/main blob 现查）：`src/composables/usePodcastEpisodePublish.js`（435 行，相位闭集 + `livePhase` / `liveTrail` 逐格驱动，`progressAvailable=false` 时走「进度不可用」显式降级文案而非画停在首相位的假进度条）+ `src/components/PodcastPublishAction.vue`（浮层本体）+ `src/overlay-view-suspension.test.js` 已登记该 owner 的挂起/释放接入断言（AGENTS.md「应用级浮层弹窗互斥合同」）。配套 `usePodcastEpisodePublish.test.js` 亦在主干。
- [x] 3.5① 入口两枚之**第一篇**：`CreateView.vue` 已挂 `PodcastPublishAction`（原 3.5 拆出来才看得见只落了一半）
  - 证据（2026-10-14）：`git show origin/main:apps/desktop/src/views/CreateView.vue` 命中 `PodcastPublishAction`。
- [x] 3.5② 入口两枚之**第二篇**：`ResultView.vue` 也**已挂**出期入口——它用的是 `PodcastEpisodeEntry.vue`（`ResultView.vue:65` 挂点、`:448` import、`:479` 注册），该组件渲染 `t('podcast.episode.entry')` 并带 `project / segments / videoPath` 三个入参。**本条曾被我判成「尚未挂」**：当时只 `grep PodcastPublishAction` 一个组件名就下了结论，而同一能力在两个视图里用了两个不同的承载组件（创建页 `PodcastPublishAction` 浮层本体、结果页 `PodcastEpisodeEntry` 入口件）。教训已写进本次记录，判入口是否在位必须**按能力字面量**（`podcast.episode.entry`）而非按某个组件名扫。
  - 证据（2026-10-14 更正）：`git show origin/main:apps/desktop/src/views/ResultView.vue` 命中 `<PodcastEpisodeEntry ` 3 处；`git show origin/main:apps/desktop/src/components/PodcastEpisodeEntry.vue` 第 4 行 `{{ t('podcast.episode.entry') }}`。
- [x] 3.6a feedSync 读侧接线（`channel:get` 带 `feedSync` + 横幅 + 重试复用同一条 `podcast:feed:publish`）；评审后追加：切频道与 `feedSync` 同进同退、`FEED_SYNC_STATUSES` 闭集与三向对账锁、`retryFeed` 文案名实相符
- [x] 3.6a2 刀 3 第 3 片：真实宿主接线（ffmpeg/ffprobe spawn + OSS `putObject` + `episodeSink`/`feedSink` 复用 `channelPublishPass` 与 `writeFeedSync` 忙锁口径）+ `podcast:episode:publishFromVideo` 通道 + preload 暴露；第 4 片：`usePodcastEpisodePublish` 状态机 + 浮层 + 两枚入口（3.4/3.5 不变）
- [x] 3.6a1 修刀 1 遗留 Critical：`usePodcastChannelPicker.switchChannel` 引用页面域标识符必抛 `ReferenceError`（切频道整条路径不可用）→ 改走 `onChannelActivated` 回调；回归锁 `src/composables/usePodcastChannel-switch.test.js`，根因与逃逸链见 `01-docs/BUGFIX-PODCAST-CHANNEL-SWITCH-2026-10-11.md`
- [ ] 3.6b 按相位取消 + 崩溃对账提示（**原 3.6 的剩余部分**：`getChannel` 目前只回 `meta`、渲染层零消费点，刀 2 只落了写侧——见 PRD §13 第 9 条与 spec「feedSync 只有写侧没有读侧」的口径纠正；不接就是让那条横幅永远是文档里的）
- [ ] 3.7 **第 3 片必修清单（刀 3 前两片的后端评审遗留，逐条带成因，不得当可选优化）**：① F1/W1 `episodeSink` / `feedSink` / `buildFeed` 抛错时无人收尾——临时文件与远端对象都留下、错误不带 `publishPhases` 与领域码，直接违背模块头「中间态由主进程负责收尾」；修法＝attach/buildFeed 段加 bail 收口（cleanup + 补 code + 挂相位），并给 `feedSink` 返回值加形状判据（`built.path` 缺席现在是同步 TypeError 而不是 partial）。② F2/W2 编码器探测丢弃 exit code 与 stderr——打包 ffmpeg 崩坏（Windows 缺 DLL／架构不符）会被错报成 `ENCODER_UNAVAILABLE`，把用户引向重装编解码器；ffprobe 同理从不看 `probe.code`。③ F3/W3 取消不打断在途抽取（见本模块头注释的如实说明），kill 信号须贯穿到 `spawnImpl`。④ F4/I partial 的底层失败原因被结果契约丢掉（只剩 `state/feedUrl/message`），上层无法区分「被拒绝」与「暂时失败」；`feed` 上传返回的 URL 也不做 https 校验，`http://` 会直接进 success。⑤ F5/I `assertUploadSizeMatches` 未进构造期四项校验：漏注入得到裸 TypeError、注入恒真 stub 则三处一致校验被静默绕过。⑥ F7/I 音频上传不标 `kind:'audio'`（`feed` 标了）——隐性契约；⑦ F8/I 四个注入实现的返回契约没有任何类型或校验面（`putObject` 实际只回 `{status,size}`，而 success 假设 `feedRes.url` 存在）——**第 3 片写真 adapter 时必须同 PR 钉死，否则切片之间最容易在这里漂**。⑧ F9/I `publish` 测试 fixture 三处 1000 常量手写耦合。
- [x] 3.7 上半（2026-10-11 本 PR）：① F1 中间态收口（`bail`：清临时文件 + 保留底层领域码 + 挂 `publishPhases`）；② F2 编码器与 ffprobe 都看 exit code（二进制崩坏不再被报成缺编码器）；④ F4 `feedSink` 形状判据 + partial 带 `errorCode`/`errorMessage`；⑤ F5 `assertUploadSizeMatches` 进构造期五项校验；⑥⑦ F7 两次上传标 `kind` + feed 直链 https 门禁。另新增公开上传面 `PodcastHostingService.publishAudio`（四条拒绝 + key 分层 + stem 清洗）配 7 条行为锁。**仍留**：③ F3（kill 贯穿到在途 spawn，需真实子进程）、⑧ F9（fixture 三处常量耦合）、F8 的 `episodeSink`/`feedSink` 真实实现半边——随 3.7 下半（IPC + preload + 入口）一并闭合
  为什么这些不在本片就改完：本分支**全仓没有生产调用者**（grep 只有模块自身与测试），上述 ①–⑧ 全部落在「注入形状尚未被真实实现钉死」的接缝上；此刻改形状，第 3 片接真物时要在同一处再改一遍（#3286 评审刚批评过这种「二次触碰同一组文件」）。处置方式是把它们写成**带编号、有承接片的欠账**，而不是留在评审日志里；判据与 PRD §13 第 11 条同批。

- [x] 3.9 **刀 3 第 3 片（2026-10-11 本 PR）**：真实宿主接线层 `podcast-episode-host.js`（入参形状层 / 整链持忙标记 / 主进程算 outBase / kill 贯穿 / 临时目录收尾）+ 两条 IPC 通道与 preload、桥接层同 PR 落地 + §6.4 的 cancelToken 合同纠正（IPC 传不了引用 → 取消改第二条通道）+ 3.8 的 W1（取锁并放，注释同步改为与实现一致）、W2（`channelId` 形态判据复用 `CHANNEL_ID_RE`）、W3（相位字段统一为 `publishPhases`，抽取失败也带轨迹）、④（`podcast-public-url.js` 收成单一谓词 + partial 成因同时带 message 与 status）、⑤（真 `_put` 路径的 URL 守卫锁）；另闭合前一片自记的弱断言：`feedSink` 取「可写服务」原本在通行证**外面**，新锁当场把它抓红（这是实做缺陷，不是评审提出）。
- [ ] 3.10 **第 4 片必须同 PR 补齐的文案键**（现在写会造出 AGENTS.md 禁止的死键，故按编号留账）：`podcast.errors.` 下 `PODCAST_VIDEO_NOT_FOUND` / `PODCAST_PUBLISH_CANCELLED` / `PODCAST_CANCEL_TOO_LATE` / `PODCAST_FEED_BUILD_FAILED` / `PODCAST_AUDIO_DEGRADED_SOURCE` / `PODCAST_AUDIO_EXTRACT_FAILED` / `PODCAST_AUDIO_ENCODER_UNAVAILABLE` / `PODCAST_AUDIO_MEASURE_FAILED` / `PODCAST_AUDIO_SIZE_MISMATCH`，以及 §6.4 表里的 `episode.*` 全部键（zh/en 成对，Gate 7 与 glossary 锁各跑一次）。
- [ ] 3.11 F9 仍留：`podcast-episode-publish.test.js` 的 fixture 三处常量手写耦合。
- [ ] 3.12 跨模块单例断言的接缝债：既有 `podcast-hosting-service.test.js` 直接 `import` `channelBusyGate` 做断言，而生产侧走 CJS `require`——vitest 下可能是两份实例，那几条的证据强度低于表面。后续单列 PR 把它们改成「经被测对象的公开出口观察」（本片的四条锁一开始就踩在这条坑上，改 require 后才测到真源）。

## 4. 刀 4 文案一键出期（后续 PR）

- [ ] 4.1 口语化分段 prompt（**独立于** `rewrite-engine` 的去 AI 味链路：那是"读起来像人写的"，这是"听起来像人说的"）；输出必须保持输入的换行/分段结构、终止标点原样、段尾无标点不得追加（AGENTS.md「后处理结构不变量」）
- [ ] 4.2 分块 TTS 装配：块上限 **2000 码点**（⛔ 不是 provider 的 4000——`asset-generator.js:1031` 是 `slice(0,4000)` 的**静默截断**，超上限整篇喂进去会丢内容且不报错）；块边界只落在段落或句末终止标点，切不开即 `PODCAST_TTS_CHUNK_UNSAFE` 拒绝而非硬切；唯一合成出口 `AssetGenerator.generateTTS(text, opts)`（禁止直调各家 `synthesize`，入参键名三家不同）；逐块**串行** + 沿用 `withAssetTransientRetry` 3/4 次退避；块间 0.3–0.6s 静音由**预物化的 `anullsrc` 片段**参与 concat（`adelay`/`loudnorm` 都不在 `REQUIRED_FILTERS`，不得用）；逐块 `degraded` 汇总门禁：任一块退化为静音即整次拒绝（`PODCAST_TTS_CHUNK_DEGRADED`，块号进 issues），全失败给 `PODCAST_TTS_ALL_FAILED`
- [x] 4.3① 复用刀 3 手柄（**只换 `extractMix` 这一站的实现**，`probe` 及之后逐字复用；不得改 `PHASES` 闭集，改枚举必须与逐格结果态测试同 PR）的**主进程层**：`createEpisodeHost().publishFromScript` 落三层判据（计费同意闸门 → `validateComposeInput` 逐字转发码 → 三个注入实现齐备）、`runChain` 单点持忙标记/取消登记/临时目录收尾，合同与显示项、提示文字见 PRD §7.10。5 条变异（M10–M14）各自让**指名**用例变红，其中 M12 需靠副作用缺席（`mkdir` 次数与忙标记）才能与合成层自身的拒绝区分——只看错误码相同不构成证据
- [ ] 4.3② 接入 `CopyLibraryView.vue:174`、`RewriteView.vue:812`、`Publish.vue:358` 三枚入口 + `podcast:episode:publishFromScript` 的 IPC/preload 通道 + §7.10.3 的计费二次确认浮层与 `episode.*` 显示项键（zh/en 成对，Gate 7 与 glossary 锁各跑一次）；**不得先开通道再补入口**（无消费者的通道属装饰性链路）。**已闭合的一半**：`PODCAST_TTS_BILLING_UNCONFIRMED` 的 zh/en 文案随 4.3① 落地（领域码收割锁 `src/locales/podcast-error-codes.test.js` 要求码一出现就得有成对文案，不能等入口）。入口判据与刀 5 同表（HotTopics/KeywordMonitor/PublishHistory/Home/FirstRun/FilmEngineering 不放）
- [x] 4.4 存量 `mime` 一次性固化（`stockStamp` 标记），不得把存量整体打成 blocked
  - 证据（2026-10-12）：判据与锁落 `apps/desktop/electron/services/podcast-episode-stock-mime.js`（12 条锁实跑；变异 M1 两条指名红）；规格与落地状态见 PRD §7.9.1-§7.9.7
- [x] 4.4b **4.4 的剩余落点（拆出来才看得见没做完的部分）**：① 宿主接线——`podcast-channel-service.js` 构造 `listChannels/readEpisodes/writeEpisodes/readIndex/writeIndex` 并在首个需要频道数据的调用处触发一次；② `compliance` 增设 `stock` 档（合同 §7.9.5 第 4 条，本片未做）；③ 频道页摘要「扫描 N · 补齐 M · 待人工 K」与 locale 三对键 `podcast.stock.*` zh/en 成对；④ 给「缺失即填默认值」补一条**真的落进文件**的变异反证（**2026-10-15 四个子项全部落地**：① #3387、② #3589、③ 本 PR、④ #3595；行内那句「本片未做」是 ② 落地前的原文，保留只作现场）
  - 证据（2026-10-14，stock-default-write-proof）：**④ 真的落进文件的变异反证已落**——九条变异（第 5 条 D1–D6、第 1/2 条 W1–W3）每条先自证锚点命中=1 且写回后可从磁盘读回，跑完逐条还原 + 整文件 md5 一致，基线 12 passed / 0 failed，**全部指名红**。其中 D2（就地给同一个对象补默认 mime）第一次实跑全绿，暴露既有身份断言 `toBe(odd)` 对就地改字段免疫；同 PR 把夹具扩到「非法已有值 / 空串 / 键完全缺失」三种并把断言改为调用前快照 `toEqual`，补后转指名红。父项仍未勾：只剩 ③ 频道页摘要与 `podcast.stock.*` 三对键 zh/en 成对
  - 进度（2026-10-14，podcast-episode-compliance-impl）：**② compliance 的 stock 档已落**——主进程只读重跑引擎 `validateEpisode`、闭集 `ok|invalid|stock`（第四态在出口抛）、`stock` 需 `mimeSource` + `index.stockStamp.at` 双凭据、旁路失败只回落成「没有这个键」不丢期不让列表报错、非对象元素原样透传不伪造渲染行；§8.2.6 七条锁逐条有用例（40 passed），10 道变异逐条指名红，QM-1 按新三层 stderr 判据实测 stderr 为空。**父项保持未勾**：③ 频道页摘要与 `podcast.stock.*` 三对键、④ 落进文件的变异反证仍未做；§8.2.5 四个 `podcast.compliance.*` UI 键刻意不加（渲染层无消费者即死键，随 4.5 UI 片同 PR 落）
  - 进度（2026-10-14，#3387）：**① 宿主接线已落**——`podcast-stock-freeze-host.js` 用注入的 registry / listChannels / readEpisodes / writeEpisodes / readIndex / writeIndex 构造，`ipc-handlers/podcast.js` 的 `getService` 在首个需要频道数据的调用处触发一次（进程内恰好一次，抛错走旁路只 warn 不外冒）。父项保持未勾：② `compliance` 的 `stock` 档、③ 频道页摘要与 `podcast.stock.*` 三对键 zh/en 成对、④ 真的落进文件的变异反证 仍未做
  - 进度（2026-10-15，podcast-stock-summary）：**③ 频道页固化摘要已落**——`episode:list` 增键 `stock`（`{scanned,filled,unresolved}` 或 `null`），`compliance` 与摘要共用**同一次** `index.json` 读取；视图 `unresolved === 0` 时只省略「待人工」段。第三对 `podcast.compliance.stock` **有意不落**——它属 §8.2.5 的三态徽标（4.5），现在写进 locales 就是无人消费的键，AGENTS.md 禁止为不可达路径建文案。证据：基线 66 passed → 只改测试 17 条指名红 → 补实现后 83 passed / 0 failed（3 文件）；消费者并集 15 文件 215 passed / 0 failed；变异 M1–M7 全部被抓且**各有指名红**（M2/M6 的红集起初被 M1/M3 包含，把「符号放宽」与「多读一次」各拆成独立用例后才分格），逐条断言还原后整文件 md5 一致、还原后重跑 83 passed / 0 failed
- [ ] 4.5 **音色默认值的两层事实**（PRD §7.4.0 第 1 条）：仓内**不存在**跨 provider 的"全局默认音色"，只有 capability 级 `defaultVoiceId` 与用户偏好 `tts-voice-preference:v1:<providerId>:<model>` 两层；频道 `voiceRef` 三段（providerId/model/voiceId）同存或同缺，回退顺序 ①频道 ②用户偏好 ③capability 默认 ④都无则 `PODCAST_TTS_VOICE_UNRESOLVED` 拒绝，**禁止**用"某个 provider 的第一个音色"猜。②③ 命中时界面必须标注来源三态
  - 进度（2026-10-15，podcast-compliance-badge）：**§8.2.5 的 UI 半片已落**——四把 `podcast.compliance.*` 键 zh/en 成对、频道页单集行三态徽标（`ok` 不渲染 / `stock` 说「沿用」 / `invalid` 计数句加逐条原因加可播出提示），原因逐字走 `issueText`；`compliance` 键缺席整块不显示且绝不写成「0 项不符合」（与 4.4b③ 的 `stock: null` 同一条纪律）。**4.5 父项保持未勾**：本条要求的「②③ 命中时界面标注来源」那半句未做——解析层的 `origin`/`resolvedBy` 还没进任何 IPC 投影，标注它要先改主进程（QM-1），属另一片

  - 进度（2026-10-16，podcast-voice-source-spec）：**本片只写合同，不写实现**——§8.2.9 已在 PRD 落地（只读 IPC `podcast:voice-preview` + `PodcastEpisodeEntry.vue` 落点 + 三把 origin 键的 zh/en 逐字 + 七条验收判据）。动因是当场实测：`voiceRef` 在 `apps/desktop/src` 命中 0 个文件、podcast locales 无任何音色键、`origin`/`resolvedBy` 从未进过 IPC 载荷 ⇒ 落点不存在，直接加文案会造死键。父项 4.5 因此**仍保持未勾**：UI 半片的 compliance 部分已随 #3676 落地，音色来源部分待按 §8.2.9 实现（触主进程 ⇒ QM-1 必跑）

- [ ] 4.6 **不做响度归一**（PRD §7.4.0 第 2 条）：`loudnorm` 不在打包媒体工具的已验证滤镜清单，引入它需同 PR 改 `media-tools-lock.json` + `before-pack` 校验 + 重打包实测，是另一条混合 PR 的体量。本期以"全期同一组 voice/rate/pitch/format 参数"换取块间一致，并在 PRD §13 明写跨 provider 降级时各块响度可能不一致这一接受项

## 5. 刀 5 收口

- [x] 5.1 入口判据落文档（已落 PRD §15：三条判据 + 放/不放全量两张表 + 「新增页面必须追加一行」验收条款）。理由不写成「不合适」：`PublishHistory` 的不放理由 = 同 guid 重发覆盖已上线一期
- [ ] 5.1b 若新增产出文案/成片的页面，必须回 PRD §15.2/§15.3 追加一行（放或不放 + 命中哪条判据），4.3② 落地时同 PR 把 §15.2 状态列改「已落」
- [x] 5.2 PRD 提示文字逐字表由脚本从 locales 生成（`scripts/gen-prd-copy-table.js` + `--check` 已接 quality-gate changes job「Gate 2c-copy」；两份 PRD 的表已按当前 locale 重生成，改文案必须重跑 `--apply`，禁止手工维护本节）
- [x] 5.3 三处记忆同步 + `01-docs/i18n-glossary.md` 术语收口
  - 证据（2026-10-14）：**三处记忆已同步**——内置记忆 4 条新写/改写（叠片旧副本、5.3 现成判据、4.4 闭合现场指针、回填通用驱动口径）且已进 `MEMORY.md` 索引；EverOS 侧 `cascade status` 实测 `pending=0 / lag=0 / done 162→166`（判据取三个产物，不看 rc）；仓库文档 = PRD §7.9.7 更正（#3514）+ 两片执行记录。**术语收口**：`01-docs/i18n-glossary.md` 补 `出期 → Publish as podcast episode`（`podcast.episode.entry`）与 `一键发布 → One-click podcast episode`（`podcast.episode.title`），两条 en 列都取 en.js 里**真实出现的逐字**（L3 判据是「locale 值包含该字面量」，上一轮把 en 写成想象中的标准译法因此当场红）；方向按 AGENTS.md「让 UI 采用 canonical 术语，而不是把词典削到已有裸词」，本片未改任何已上线文案。

## 6. 刀 1 收口：QM-6 双模型评审处置（2026-10-10）

- [x] 6.1 i1｜`episodes.json` 手工写者与一键发布的互斥改为共享忙标记（`channelBusyGate`），删除无生产消费者的 `withChannelLock`；新增 `podcast-channel-write-guard.test.js`（4 例，含键隔离与「库里纹丝不动」）
- [x] 6.2 i2｜`podcast:endpoints:list` 不再经按频道构造的 service；加「不注入任何替身也必须返回非空目录」的行为锁
- [x] 6.3 i3｜迁移冲突/硬失败在**首次**调用即返回可读状态（`ensureMigratedOnce` 捕获后返回 `err.index`）；registry 行为锁改为「第一次就 conflict / error 可读」
- [x] 6.4 i4｜读写分档：`assertChannelExists`（读）与 `assertChannelWritable`（写）；IPC 写入口声明 `{ writable: true }`，按调用序列逐字断言
- [x] 6.5 i5｜Windows 原子替换退避预算单点导出 `REGISTRY_RENAME_RETRY_DELAYS_MS`（最坏 80ms 同步自旋），并注明不得放大到秒级（冻结的是整个主进程事件循环）
- [x] 6.6 i6｜`writeHosting` 在落盘这一站清洗 `pathPrefix`（复用 `normalizePathPrefix` 唯一实现）与 `endpoint`；加跨前缀逃逸负例
- [x] 6.7 i7｜9 条 `PODCAST_*` 领域码补 zh/en 成对文案，并打通 `subCode` 链路（`toIpcError` → preload → `call()` 单点归一），否则新码只能落到兜底文案；同时收掉前端模型报出的两处死键（`podcast.picker.renamed` / `migrationResolved` 现均由界面消费）
- [x] 6.8 i8｜删除 `_indexCache` 死状态；`channelListError`（原 `channelError2`）与 `migrationConflicts` 落到界面（频道目录读取失败横幅、冲突文件名清单）
- [x] 6.9｜重命名入口落到频道切换器（`channelRename` 此前有 IPC、有服务、有测试，但界面不可达）

## 明确不做

- 平台登记面（platforms.yaml / publish-capabilities / platform-definitions / rpa selectors）与 `publishMode` 第四态
- 接入 `publish:batch` / `taskQueue` / `task-queue-frequency` 日配额 / `publish:progress` 相位枚举 / 发布历史
- 自动挤出已发布单集（D-8 撤销）；跨频道音频对象去重；打包 AGPL/未明许可的本地 TTS 模型
- 逆向小宇宙私有写接口

- [x] 4.2 刀 4 第 2 块：`podcast-episode-synth` 逐块串行 TTS + 块间显式静音 + 拼接后实测与降级逐块门禁（含 §7.4.7 的时长下限偏离）
- [x] 刀 4 第 3 片·上半：音色解析层 `podcast-tts-voice.js`（四步回退链 + 三态 origin + 码表单点），16 条行为锁、3 条真 capability 契约锁（2026-10-11）
