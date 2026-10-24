---
record: podcast-episode-tts-run
task: 刀 4 第 3 片·下半——把音色/口语化/分块/合成四层串成一次出期（零出站 prepare + 计费二次确认的显示量）
date: 2026-10-22
---

## 本次执行记录：播客刀 4 第 3 片·下半——出期编排层（podcast-episode-tts-run，2026-10-22）

> 分支 `podcast-tts-wiring`，隔离 worktree `mp-podcast-tts-wiring`（仓库同级 `mp-worktrees/`，非共享根）。
> 本片 2026-10-12 落地，2026-10-22 随主干音色契约改判做对齐（见「音色契约改判」段）。
>
> **契约真源声明**（2026-10-22 QM-6 第 5 轮 i8 补注）：本层对外的接口契约**唯一真源是 PRD §7.4.8**
> （入参表 / 校验表 / 返回形状 / `estimate` 键集 / `colloquial` 与 `estimate` 平级关系）。
> 本记录与代码注释都只**引用**它，不另立第二份描述；下文的 QM-6 各轮表格描述的是「当时发现了什么、
> 怎么处置」，是**过程记录**，不是契约。若两者看起来不一致，以 PRD §7.4.8 为准。

### 这一片在做什么

新增 `apps/desktop/electron/services/podcast-episode-tts-run.js`：`prepareEpisodeTtsRun`（零出站：
依赖校验 → 音色解析 → 分块计划 → 展示量估算）与 `runEpisodeTts`（确认后：取消采样 → 口语化 → 逐块合成）。
规格见 PRD §7.4.8。

三条写在实现之前的口径：

1. **本层不新立任何错误码**：空文案的码归分块层（`PODCAST_TTS_COPY_TOO_SHORT`）、音色归解析层
   （`PODCAST_TTS_VOICE_UNRESOLVED`）、注入缺失复用 `PODCAST_EPISODE_INVALID`。理由与 §7.4.1.1 同源——
   两层各有一个码，UI 就不知道显示哪条提示。层间区分靠 `issues[].path`。
2. **顺序 = 计费顺序**：音色解析排在口语化之前。先花 LLM 的钱再发现根本合成不了，是替用户做了一次
   不可撤回的花费。
3. **`estimate` 是文案不是判据**：时长区间由常量 `ESTIMATE_CP_PER_SEC = {low:3.5, high:5.5}` 粗估；
   结果里的 `durationSec` / `sizeBytes` 只认合成层实测。键集由结构锁钉为恰好四条
   （`codepoints` / `blocks` / `estimatedSecLow` / `estimatedSecHigh`）。

### 音色契约改判（本片真正要解的那道题）

本片原实现按**三层**音色回退链写成（① 频道 `voiceRef` → ② 用户偏好 → ③ capability `defaultVoiceId`）。
主干已改判：2026-10-19 用户裁决撤掉第 ① 档（`#4065`，写侧从未存在——全仓 `git grep voiceRef` 只剩
请求载荷路径与测试夹具，没有任何一处给 `meta.voiceRef` 赋值），回退链收敛为
**① 用户偏好 → ② capability `defaultVoiceId` → ③ 都拿不到就拒绝出期**（`VOICE_ORIGIN` 随之由三态
收敛为 `preference` / `providerDefault` 两态）。唯一真源是 PRD §7.4.1.2。

处置：

- 本层**不再消费频道 `voiceRef`**：`resolveEpisodeVoice` 调用里删掉 `channelRef` 透传。
  留着不可达的档位比少一条更坏——下一个读者会以为「频道可以配音色」，于是永远不去补真正需要的入口。
- 定位键改为**必填**的 `input.defaultProvider`（`providerId` + `model`）：缺它就没有 ①② 的查询键，
  音色层直接拒发（`path='voice'`）。本层不代为猜 provider。
- PRD §7.4.8 的入参表与校验表按此改写（无默认 provider ⇒ `voice`；偏好读异常 ⇒ `voice.preference`；
  capability 读异常 ⇒ `voice.capability`；两层全缺 ⇒ `voice` 且两个读取实现各被调用一次）。
- 回归锁新增「撤档不变量」两条：带频道 `voiceRef` 但无默认 provider ⇒ 仍然拒绝（频道档不是回退）；
  实现源码里不得出现 `channelRef` / `input.channel` 任何一个。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：隔离 worktree `mp-podcast-tts-wiring` + 裸分支 `podcast-tts-wiring`（`rev-parse --abbrev-ref HEAD` 实证）；共享根保持 main 且本次未在其落盘 |
| 第一性原因（QM-5 ①） | ✅ | 本片按**三层**音色回退链写成（① 频道 `voiceRef` → ② 用户偏好 → ③ capability `defaultVoiceId`），而主干 2026-10-19 用户裁决撤掉了第 ① 档（`#4065`），回退链收敛为两层、`VOICE_ORIGIN` 由三态收敛为 `preference` / `providerDefault` 两态。本片 10-12 落地后一直 open 未合，**没有人把这条改判同步给它**；rebase 后 9/17 用例红，根因即「依赖层的契约变了，而依赖它的片还停在旧契约上」 |
| 逃逸分析（QM-5 ②） | ✅ | ① **单元层**：本片未合入主干 ⇒ 主干侧零消费者，没人被旧契约伤到，缺陷没有暴露面；② **CI 层**：本片 CI 在 10-12 跑过且当时契约一致 ⇒ 那次绿是**当时**的绿，不是现在的绿；③ **rebase 层**：合并冲突只落在 PRD / 台账 / 记录三类**文本**文件上，新增的代码文件**无冲突** ⇒ 「rebase 成功」的表象掩盖了「语义已过期」；④ **流程层**：没有任何一条判据检查「本片依赖的层契约是否还是主干当前那一版」——冲突解决与契约核对被当成了两件事 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 实现改为两层契约（删 `channelRef` 透传，`defaultProvider` 改必填定位键）；测试夹具改为 `defaultProvider` + capability 命中；用例 **20 passed / 0 failed**；变异 M1（不透传 `defaultProvider`）⇒ **12 条指名红**，变异 M2（把撤掉的 `channelRef` 档位塞回实现）⇒ **恰好 1 条指名红**（撤档结构锁）；`podcast-episode-synth.test.js` 等播客全量 **29 文件 / 464 例全绿** |
| 防止再次发生（QM-5 ⑤） | ✅ | 新增「撤档不变量」结构锁：实现源码（剥注释后）不得出现 `channelRef` / `input.channel` 任何一个 ⇒ 把已撤档的档位请回来会当场红；PRD §7.4.8 的入参表与校验表同步改写，规格层不再留「频道 voiceRef」的字样；本篇记录点名「rebase 无冲突 ≠ 契约未过期」，rebase 后必须跑全量测试而不是只看冲突 |
| 行尾与 diff 对账 | ✅ | 两口径一致：改动为「新增 3 文件 + 改 1 文件」，无删除；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 对账无差异（新增文件 `core.autocrlf` 归一，提交前工作区 CRLF、库内 LF） |
| 接线棘轮 | ✅ | 新增 `apps/desktop/electron/services/podcast-episode-tts-run.test.js` 落在 `apps/desktop/vitest.config.js` 的 `electron/services/**/*.test.{js,ts}` 白名单内（无需新增登记即被采集）；`node scripts/check-unwired-tests.js` ⇒ 域内 126 个测试文件、**OK: 全部测试均已接线或按欠账登记**（exit=0） |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | 打包：`pnpm exec electron-builder --win --dir --publish never` **rc=0、日志无 error 行**、asar integrity 已写入；产物 `apps/desktop/dist-electron/win-unpacked/Multi-Publish.exe` = **239,075,328 字节**；asar 内 `electron/services/podcast-episode-tts-run.js` 条目 size=**7364** 与本地源码逐字节相等，且其 SHA-256（`ea767db3eaac…cab762a`）**与本次改后的本地源码哈希完全相同** ⇒ 进入交付产物的正是改后的那一版，不是 10-12 的旧版。视觉：本片不改 UI（纯主进程服务层 + 文档），QM-4 N/A |
| QM-6 CCG 双模型外部评审 | ✅ | 后端轴（claude）3 条 CONFIRMED 全采纳：① `runEpisodeTts` 成功路径必然 ReferenceError（TDZ）——根因是变异还原脚本用「首个匹配替换」把同形的两行**对调**；② 108/117 两行文本对调（口语化输入应是 `prepared.content`、合成输入应是 `coll.content`）；③ 记录结论与提交代码矛盾（写 12 passed 实为 9/3）。前端轴（opencode）命中 **C3**：未透传 `defaultProvider` ⇒ ②③ 两级定位键为空、回退链成死代码；处置为入参透传 + 补校验表 + 补回归锁。2026-10-22 追加一轮：两层契约改判的对齐复评与 M1/M2 变异反证，结论与处置逐条见「音色契约改判」段 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

### QM-6 第 1 轮（2026-10-22，真跑双家族）

- **后端与口径**：critic=claude、proposer=opencode，**两个后端都真跑过**（不是自审冒充），跨家族校验通过；
  评审对象 = 本次改后的代码差量（判定域 420 行 / 2 个源文件，只算代码文件）。
- **产出**：8 条问题，4 个维度（correctness 4 / security 8 / performance 7 / maintainability 5），最低分 4；
  **高危域 0 条**（本片不触判据本体 / workflow / 凭证登录态），故自扮演裁决的适用范围成立。
- **逐条处置**（8 条全部落定）：

| id | 严重度 | 指控 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Critical | 判定记录里 `sha` 指向父提交、与提案 head 不一致，是陈旧元数据 | **不成立** | 判定记录**按内容寻址命名**：pre-commit 时新提交尚未生成、记录写在父 sha 上——这是引擎写明的预期行为（评审输出原文：「pre-commit 时新 commit 尚未生成，判定记录写在父 sha 上——这是预期行为」），不是陈旧元数据 |
| i2 | Critical | 提案说 682 行、判定记录说 420 行、实际 diff ~589 行，三处对不上 | **不成立** | 三处是**三个不同的域**：682 = 全差量（含 PRD/记录等文档），420 = 判定域（只算代码文件，2 个源文件），589 ≈ 代码+文档的差量估算。判定器按自己的域算、提案按自己的域报，本来就不该相等；把不同域的数字当同一口径才是误读 |
| i3 | Critical | 提交里带着 `deepReview.status=pending` 的记录，等于宣称「已完成的深度审查」 | **成立** | 这正是本轮要闭合的：评审跑完后由引擎回写真实状态（不手写状态词），读数留在本记录与 PR 评论里；评审未跑完前该记录不进提交 |
| i4 | Warning | 旁路断言 `expect(original).toContain(call[0].text)` 力度不够——块文本本就是原文子串，「原文包含块」几乎恒真，证明不了合成层拿到的是原文 | **成立** | 已改：改为「逐块拼回去必须**逐字等于**原文」（`calls.map(c => c[0].text).join('') === original`），并保留 `applied === false` / `reason === 'invoke_failed'` 两条断言。变异 **M3**（让合成层收到被截断的文本）⇒ **恰好 1 条指名红**，证明新断言不是空锁 |
| i5 | Warning | 合成层入参名 `voiceRef` 与已撤档的「频道 voiceRef」同名，易被读成同一概念 | **部分成立（不改名）** | `voiceRef` 是**合成层自己的契约名**（`podcast-episode-synth.js:77` 的入参，并由它原样透传给 `generateTTS` 的适配层契约）；已撤档的是**频道 meta 里的音色字段**（数据来源概念），两者不是一回事。改名会同时打断两层契约，故**保留原名**并在该调用点写明「同名不同义」的注释（已加） |
| i6 | Warning | 记录里明说本片未完成（未接 IPC/浮层确认步、生产三实现零消费点），却以「完成」的形态交付，残余工作会丢 | **成立** | 提交信息与 PR 正文补「未闭合项」清单（IPC/浮层确认步 ⇒ 刀 4 第 5 片；生产三实现零消费点 ⇒ 主干 tasks 4.5b⑤；`podcast:transcript` 未决），本记录的「遗留」段同步列出 |
| i7 | Info | `ESTIMATE_CP_PER_SEC.low = 3.5` 在 PRD 写明的 4-5 常态区间之外，理由未写进注释 | **成立** | 原注释写「取常态区间两侧」不准确（3.5 不是 4-5 的侧）。已改为写明取值口径：`low` 是常态下界 4 **往下**留的一档余量（预计时长是给用户看的**上界**，宁可估长不可估短），`high` 是常态上界 5 往上留一档；并写明它仍然只是文案、永不参与判据 |
| i8 | Info | 未发现安全问题；建议把「哪些 deps 必填、哪些可选」的注入契约写清 | **部分成立** | 注入契约已写在 `prepareEpisodeTtsRun` 的 JSDoc（`readPreference` / `getCapability` 必填，缺席即 `PODCAST_EPISODE_INVALID`；出站实现全部由宿主注入，本层不 require provider / `node:http`）。本轮随 i7 一并把该段入参说明收紧，不新增字段 |

- **第 1 轮的方法论教训**（同样写进 learnings）：自扮演裁决的判定模型是「`upheld` 即阻断」，
  所以**不能靠填表把真问题收口**——i4/i7 是真问题，填 `dismissed` 才是撒谎。正确顺序是
  「先按发现改代码 → 让评审跑在改后的代码上 → 再裁决仍然存在的争议」。本记录据此在改后重跑了一轮。

### QM-6 第 2 轮（2026-10-22，改后重跑）

- 同样 critic=claude / proposer=opencode 双家族真跑；判定域 432 行。产出 **7 条**、4 个维度
  （correctness 4 / security 7 / performance 8 / maintainability 3），最低分 3；高危域 0 条。
- **第 1 轮的真问题已消失**：i4（旁路断言力度不够）与 i7（估时取值理由）**不再出现**——说明第 1 轮的
  修正确实咬住了（M3 变异反证是这一条的独立佐证）。
- 逐条处置（7 条）：

| id | 严重度 | 指控 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Critical | 判定记录用父 sha、`status=pending`，是陈旧审计产物 | **不成立** | 与第 1 轮 i1 同一事实：判定记录**按内容寻址命名**，pre-commit 时新提交尚未生成 ⇒ 记录写在父 sha 上是引擎写明的预期行为；`status` 由评审跑完后引擎回写为准，不靠手写 |
| i2 | Critical | PRD 把 `colloquial.reason` / `usesOriginal` 列在 `estimate` 表**里面**，而代码里 `colloquial` 是 `estimate` 的**兄弟**，契约写反了 | **成立** | 已改 PRD §7.4.8：`colloquial` 移出 `estimate` 表，改为独立说明块并写明「两者平级」；`estimate` 的键集回到结构锁钉死的四条。此前该表与结构锁「`estimate` 恰好四个键」直接矛盾 |
| i3 | Critical | 手工构造 `voiceRef {providerId,model,voiceId}` 丢掉了 `origin`/`resolvedBy`，且名字与已撤档的频道 voiceRef 撞 | **部分成立（补注释）** | 「丢掉」是有意的：`origin`/`resolvedBy` 是**显示位**（界面据此标注来源），生成器不消费；完整形状原样挂在返回值的 `voice` 上给界面用，不在合成层再复制一份。已在调用点写明这两点（2026-10-22 第 2 轮） |
| i4 | Warning | `prepareEpisodeTtsRun` 不看 `cancelToken`，与「确认前零出站」的说法不一致 | **不成立** | `prepare` **零出站**（不调 provider、不发请求），那里**没有可取消的东西**；取消检查固定落在 `prepare` 之后、第一次出站之前，两者之间无副作用。已在 PRD §7.4.8 写死这一点，免得下次再被读成缺陷 |
| i5 | Warning | `colloquializeCopy` 的结果没校验，缺 `.content` 会把 `undefined` 传给合成 | **不成立** | `colloquializeCopy` 的出口契约是 `{content:string, applied:boolean, reason:string}`，且**每个旁路分支都返回原文**（`no_provider` / `invoke_failed` / `empty_output` / `structure_rejected` 一律 `{content: original, …}`）⇒ `coll.content` 恒为字符串 |
| i6 | Warning | 测试用 ESM 语法却 `await import()` 一个 CJS 模块，两套模块系统混用 | **不成立（仓内既有风格）** | `apps/desktop/electron/services/` 下两种风格并存：`podcast-episode-synth.test.js` 用 vitest ESM 语法，`podcast-tts-colloquialize.test.js` 用 CJS。vitest 的 ESM↔CJS 互操作让 `await import()` 拿到与 `require` 同一个纯函数模块实例，不是缺陷 |
| i7 | Info | 提案说 740 行、判定记录说 432 行、diff 约 450 行，口径不一 | **不成立** | 与第 1 轮 i2 同一事实：三个数分属**三个不同的域**（全差量 / 判定域只算代码文件 / 代码+文档估算），判定器按自己的域算、提案按自己的域报，不该相等 |

### QM-6 第 3 轮（2026-10-22，再次改后重跑）

双家族真跑（critic=claude / proposer=opencode），判定域 435 行，产出 8 条、4 维度，最低分 4，高危域 0 条。
逐条处置：

| id | 严重度 | 指控 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Critical | 估时区间算反了：`low` 秒数应取 `codepoints/low`，代码把两个分母对调了；且 `estimate` 键集缺结构锁 | **不成立** | 代码 `estimatedSecLow = codepoints / 5.5`（快语速 ⇒ 秒数少）、`estimatedSecHigh = codepoints / 3.5`（慢语速 ⇒ 秒数多）——**分母对调才是对的**：按指控改会让 `Low > High`、区间反转。键集也早有结构锁：`expect(Object.keys(r.estimate).sort()).toEqual(['blocks','codepoints','estimatedSecHigh','estimatedSecLow'])` |
| i2 | Critical | 判定记录指向父提交、`status=pending` 却随提交入库 | **不成立** | 与前两轮同一事实：判定记录**按内容寻址命名**（pre-commit 时新提交尚未生成 ⇒ 写在父 sha 上，引擎写明的预期行为）；`status` 由评审跑完后引擎回写，不靠手写 |
| i3 | Critical | 未校验 `defaultProvider` 形状就传给 `resolveEpisodeVoice`；`await import(MOD)` 混用 ESM/CJS 可能加载错模块 | **不成立** | 形状判据**归音色层**：§7.4.1.1 的判据是「`providerId` 与 `model` 都要有」，缺任一即 `PODCAST_TTS_VOICE_UNRESOLVED`（`path='voice'`）。本层再写一份就是第二份口径——本仓反复踩过「两层反向结论由调用顺序决定」。`await import()` 部分同第 2 轮 i6（仓内既有风格，vitest 互操作拿到的是同一个纯函数模块实例） |
| i4 | Warning | 手工构造 `voiceRef` 丢掉 `origin`/`resolvedBy`，与返回的完整 `voice` 形状不一致，消费者易混两源 | **成立** | 已改：截断后的三段提成具名局部 `synthVoice`，并在注释里写明「为什么截断、完整形状在返回值 `voice` 上」，让两处消费者的边界在代码里可读，而不只在注释里 |
| i5 | Warning | 逐块合成无超时/取消传播，长文案可能累积无限计费调用 | **不成立** | 取消**有**传播：本层把 `cancelToken: input.cancelToken` 传给 `synthesizeEpisodeAudio`，块间取消沿用合成层（§7.4.7），且合成层另有单块级降级/时长门禁。本层不新造计时器（那是合成层与 provider 适配层的职责），「逐块超时上限」不在本片范围 |
| i6 | Warning | `COLLOQUIALIZE_REASONS.APPLIED` 未在文件内定义，可能 ReferenceError | **不成立** | 本文件第 23 行即 `const { colloquializeCopy, COLLOQUIALIZE_REASONS } = require('./podcast-tts-colloquialize')`——是**导入**而非本地定义；真缺导入的话 21 条用例第一条就红 |
| i7 | Info | 新增文件无与前片的集成点说明，接口契约仅靠注释维护 | **不成立** | 接口契约在 PRD 写全：§7.4.8（入参表 / 校验表 / 返回形状 / `estimate` 键集）、§7.4.1.1（音色层）、§7.4.2（分块）、§7.4.7（合成）、§7.4.9（适配层）；注释只是实现的旁注，不是契约真源 |
| i8 | Info | 旁路只锁了「调用失败」，没锁「结构不合格」时合成输入是否仍为原文 | **成立** | 已补用例：改写稿多出一段 ⇒ `structure_rejected` ⇒ 仍出一期且**逐块拼回逐字等于原文**。用例数 20 → **21**，两条旁路（`invoke_failed` / `structure_rejected`）各锁一遍 |

### QM-6 第 4 轮（2026-10-22，再次改后重跑）

双家族真跑（critic=claude / proposer=opencode），判定域 459 行，产出 8 条、4 维度，最低分 4，高危域 0 条。

| id | 严重度 | 指控 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Critical | 提案 815 行 / 判定记录 459 行 / diff ≈599 行，口径冲突 | **不成立** | 与前三轮同一事实：三个数分属**三个不同的域**（全差量 / 判定域只算代码文件 / 代码+文档估算），本就不该相等 |
| i2 | Critical | 判定记录指向父提交、`status=pending` 却随提交入库 | **不成立** | 同一事实：判定记录**按内容寻址命名**（pre-commit 时新提交尚未生成 ⇒ 写在父 sha 上，引擎写明的预期行为）；`status` 由评审跑完后引擎回写 |
| i3 | Critical | 测试用 ESM 语法却 `require('node:fs')`，若 vitest 视其为 ESM 会抛 ReferenceError、锁全废 | **成立** | 已改：与同族同目录的 `podcast-episode-synth.test.js`（刀 4 同系列）完全同构——node 内置走 `import fs from 'node:fs'`，CJS 依赖走 `await import(MOD_COMPOSE)`，**全文件不再有 `require`**。实跑 21/21 绿 |
| i4 | Warning | 判定记录里引用的是改前 PRD 文本（`colloquial` 嵌在 `estimate` 里），与结构锁矛盾 | **不成立** | 逐字核过：记录里 `docSensitiveContentSample` 引的那一行是**本记录自己**第 3 轮表格里的 `i5` 行（讲取消传播），不是 PRD 文本；PRD 的 `colloquial` 兄弟关系已在第 2 轮改完 |
| i5 | Warning | `input.cancelToken` 未经形状校验就透传，非对象入参可能导致合成层行为异常 | **成立（改文档不改码）** | 形状判据**归合成层**（`podcast-episode-synth.js`），本层只读 `cancelled` 布尔位；本层再写一份形状校验就是第二份口径。已在 `runEpisodeTts` 的 JSDoc 写死取消契约（透传、只读 `cancelled`、检查点在 prepare 之后第一次出站之前） |
| i6 | Warning | 新文件与 `podcast-episode-tts-adapters.js` 重复了编排顺序，改一处要改两处 | **不成立** | 逐字核过：适配层里**没有** `colloquialize` / `prepare` / `planChunks` / `resolveEpisodeVoice` 任何一处——它是**生产侧四个工厂**（把宿主实现映射成注入实现），不含编排。编排只在本层一处 |
| i7 | Info | 源码里嵌了「QM-6 i4 / 2026-10-22」这类历史评审标注，会变陈旧，应放审计产物 | **不成立（仓内既有惯例）** | 本仓的代码注释**惯例**就是标注评审出处（例：`scripts/ccg-review-decider.js` 的「2026-10-20（change: ccg-decider-exclude-self-artifacts，critic 轴 Critical#2）」、`podcast-tts-voice.js` 的「2026-10-19 经用户裁决删除」）。这类标注是「这条不变量为什么存在」的出处说明，去掉它等于让下一个读者重新踩一遍 |
| i8 | Info | `prepare` 在整篇文案上同步执行，长输入会阻塞事件循环 | **成立（改文档不改码）** | 已在 `prepareEpisodeTtsRun` 的 JSDoc 写明：纯同步、不 await、不发请求 ⇒ 没有「让出事件循环」这一步；超长文案应由调用方在**调用前**按上游长度上限挡住，本层不设整篇上限（分块层有块上限） |

### QM-6 第 5 轮（2026-10-22，再次改后重跑）

双家族真跑（critic=claude / proposer=opencode），判定域 459 行，产出 8 条、4 维度，最低分 4，高危域 0 条。
本轮的 Critical 出现了「把 `.ccg/reviews` 与 `openspec/records` 从提交里删掉」的建议——**未采纳**，理由见下。

| id | 严重度 | 指控 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Critical | `.ccg/reviews` 把评审后端名、`status=pending`、父 sha 写进源码树，建议删掉 | **不成立** | 判定记录**按设计**随提交入库：pre-commit 钩子自动暂存它（`scripts/hooks/pre-commit` 的 `RECORD_PATHSPEC`），`check-pr-exec-record.js --mode=enforce` 正是靠**读 PR 自己的** `.ccg/reviews` 文件来判定深度审查是否闭合。**删掉它等于让这道门禁读不到任何东西**——即评审建议的正是「关掉正在跑的检查」。父 sha 是内容寻址命名的预期行为（引擎原文），`status` 由引擎回写 |
| i2 | Critical | `openspec/records/` 把 201 行评审过程写进源码树，「泄露内部评估过程」，建议只留代码文件 | **不成立** | `openspec/records/` 是本仓**强制**的执行记录载体：`check-pr-exec-record.js --mode=enforce` 要求运行时代码 PR 必须带记录；主干上已有 600+ 篇；`openspec/records/_TEMPLATE.md` 是它的模板。删掉它 PR 直接不过门禁，也违反 AGENTS.md「所有变更必须 commit、不允许未跟踪代码」与记录载体那套规矩 |
| i3 | Critical | `RUN_ERRORS` 引用合成层的 `SYNTH_ERRORS`，契约一断错误就静默传播；建议 `RUN_ERRORS` 独立定义 | **不成立** | **复用**合成层的码是本层的设计前提（PRD §7.4.8：「本层不新立任何错误码」——各层各一个码，UI 才知道显示哪条提示；层间区分靠 `issues[].path`）。独立定义会造出第二份码表，正是本仓反复踩的「两层反向结论由调用顺序决定」。另「静默传播」不成立：`require` 契约一断是**加载期直接抛**，不是静默 |
| i4 | Warning | `ESTIMATE_CP_PER_SEC` 的 low/high 与时长方向看着是反的，名字有误导 | **部分成立（改措辞不改名）** | 轴向问题：`low`/`high` 指**语速**（码点/秒），不是时长——慢语速 ⇒ 秒数多，所以 `estimatedSecLow` 取 `high` 那个分母，看着像对调其实是对的。已在常量注释里加「⛔ 轴向」段写死这一点；**不改名**（改名要动导出面、PRD 与用例，收益不抵成本） |
| i5 | Warning | 用 `fs.readFileSync` + 正则扫源码文本做「不得出现某串」的结构锁，格式一改就脆 | **不成立** | 这是本仓的既有锁法，且**同一个文件里本来就有**三条同形结构锁（`not.toMatch(/function\s+plan[A-Z]/)`、`not.toMatch(/defaultVoiceId\s*\|\|/)`、`not.toMatch(/require\(['"]node:http['"]\))`）。「某串不得出现在源码里」这件事除了读文本没有别的可靠办法——改用 mock 反而锁不住「代码里没写这句话」 |
| i6 | Warning | 注释里嵌了日期、PR 号、QM-6 轮次、评审者别名等过程信息，耦合过紧 | **不成立（仓内既有惯例）** | 与第 4 轮 i7 同一事实：本仓注释惯例就是标注评审出处（`scripts/ccg-review-decider.js` 的「2026-10-20（change: …，critic 轴 Critical#2）」、`podcast-tts-voice.js` 的「2026-10-19 经用户裁决删除」）。这类标注是「这条不变量为什么存在」的出处说明 |
| i7 | Warning | `prepare` 全同步、无取消，长内容未缓解 | **不成立** | 与第 4 轮 i8 同一事实，已在 JSDoc 写明：纯同步、零出站 ⇒ **没有可取消的东西**；缓解边界在**调用方**（调用前按上游长度上限挡住），本层不设整篇上限——分块层的 `MAX_CHUNK_CODEPOINTS` 是块上限、整篇上限是 UI/调用方的职责 |
| i8 | Info | PRD 与记录对 `colloquial`/`estimate` 关系的描述不一致（嵌套 vs 兄弟），跨文件契约仍脆 | **部分成立（补真源声明）** | 事实：契约真源只有 PRD §7.4.8，记录里第 2 轮那行是**过程描述**（「当时发现 PRD 写成了嵌套，已改」），不是契约声明——但快速扫读确实可能误读。已在记录开头加「**契约真源声明**」：本层对外契约唯一真源是 PRD §7.4.8，本记录与代码注释只引用它；两者看起来不一致时以 PRD 为准 |

### QM-6 第 6 轮（2026-10-22，再次改后重跑）

双家族真跑（critic=claude / proposer=opencode），判定域 479 行，产出 8 条、4 维度，最低分 4，高危域 0 条。

| id | 严重度 | 指控 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Critical | `.ccg/reviews` 审计产物带 `required:true` + `status=pending` 却入库 | **不成立** | 与第 5 轮 i1 同一事实：判定记录**按设计**随提交入库（pre-commit 钩子自动暂存），`check-pr-exec-record.js` 靠**读 PR 自己的**这些文件判定深度审查是否闭合；删掉它＝让这道门禁读不到东西。`status` 由引擎在评审跑完后回写 |
| i2 | Critical | 审计 JSON 用父 sha、行数口径冲突 | **不成立** | 与第 4/5 轮同一事实：内容寻址命名 + 三域行数（详见第 1 轮 i2） |
| i3 | Critical | `openspec/records/` 222 行评审过程写进源码树，建议移出仓 | **不成立** | 与第 5 轮 i2 同一事实：执行记录是**强制载体**（`check-pr-exec-record.js --mode=enforce` 要求运行时代码 PR 必须带），主干已有 600+ 篇 |
| i4 | Warning | `CP_PER_SEC_BY_SPEED` 的 slow/fast 与时长方向看着反直觉 | **成立（改名）** | 已改名：常量 `ESTIMATE_CP_PER_SEC = {low, high}` → `CP_PER_SEC_BY_SPEED = {slow, fast}`——`low`/`high` 是**语速**轴的名字，放在时长轴上用必然被误读；`slow`/`fast` 一眼可判。PRD §7.4.8 与用例同步改 |
| i5 | Warning | 用源码文本正则做「不得出现某串」的结构锁，格式一改就脆 | **不成立** | 与第 5 轮 i5 同一事实：这是本仓既有锁法，同文件里本来就有三条同形结构锁 |
| i6 | Warning | 注释里嵌了历史评审标注（日期、轮次、评审者别名） | **成立（瘦身）** | 已瘦身：源码注释只保留**不变量与其理由**，轮次/日期/编号这类过程别名**全部移到本记录**（过程痕迹该在审计面，不该在执行面） |
| i7 | Warning | `prepare` 全同步、无取消，长内容未缓解 | **不成立** | 与第 4 轮 i8 同一事实，已在 JSDoc 写明并给出缓解边界（调用方在调用前挡长度） |
| i8 | Info | PRD 与记录对 `colloquial`/`estimate` 关系的描述仍可能不一致 | **部分成立（补真源声明）** | 已在记录开头加「**契约真源声明**」（唯一真源 = PRD §7.4.8，本记录只引用） |

### QM-6 第 7 轮（2026-10-22，再次改后重跑）

双家族真跑（critic=claude / proposer=opencode），判定域 479 行，产出 8 条、4 维度（correctness 6 /
security 7 / performance 5 / maintainability 4），最低分 4，高危域 0 条。

| id | 严重度 | 指控 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Critical | `.ccg/reviews` 带 `pending` 却入库 | **不成立** | 同第 5/6 轮 i1：这是**按设计**的入库方式，删掉＝让 `check-pr-exec-record.js` 读不到证据 |
| i2 | Critical | 审计 JSON 用父 sha、行数与提案冲突 | **不成立** | 同第 4/5 轮：内容寻址命名 + 三域行数 |
| i3 | Critical | `openspec/records/` 把评审过程写进源码树，建议移出仓 | **不成立** | 同第 5/6 轮：执行记录是强制载体，移出去 PR 直接不过门禁 |
| i4 | Warning | `runEpisodeTts` 依赖 `colloquializeCopy` 不抛；若它抛了，「旁路不拒绝」契约就断了 | **成立（但结论是「不加兜底」）** | 实测：口语化层在**公开 API 下不会抛**——它的 provider 侧异常已内部 try/catch（→ `invoke_failed`）、空返回 → `empty_output`、结构不合格 → `structure_rejected`，三条旁路都**用原文出一期且不抛**。试过用 `vi.mock` 让它抛，**mock 对 CJS 模块的 `require` 不生效**（用例跑出来 reason 是 `empty_output`，说明 mock 没插进去）——也就是说这条兜底**造不出可测的用例**。按本仓「不可达的兜底等于没有兜底」的规矩**不加**，改为在调用点写明契约归属（谁拥有这条契约、谁负责它的失败形态），并在 PRD §7.4.8 固化 |
| i5 | Warning | `estimate` 恰好四键只由测试断言保证，没有运行期冻结 | **不成立** | 结构锁**就是**本仓保证这件事的手段（同一个文件里三条同形锁）；再加一层运行期检查等于第二份口径 |
| i6 | Warning | `prepare` 全同步、无取消 | **不成立** | 同第 4/6 轮：已文档化，缓解边界在调用方 |
| i7 | Info | `RUN_ERRORS` 引用 `SYNTH_ERRORS` 无本地断言，上游改了会静默 | **不成立** | 同第 5 轮 i3：**复用**合成层的码是设计前提（PRD §7.4.8「本层不新立任何错误码」）；且 `require` 契约一断是**加载期直接抛**，不是静默 |
| i8 | Info | `outBase` 等路径未经消毒就传给合成 | **部分成立（补职责说明）** | `outBase` 是**宿主给的输出基名、不是用户输入**；路径形状与落盘路径归合成层（`podcast-episode-synth.js` 负责 `outBase` 形状）。已在 `runEpisodeTts` 的 JSDoc 写明「路径职责归合成层、本层原样透传」，不在本层写第二套路径规则 |

### QM-6 第 8 轮（2026-10-22，再次改后重跑）

双家族真跑（critic=claude / proposer=opencode），判定域 479 行，产出 8 条、4 维度，最低分 4，高危域 0 条。
本轮起，评审对「审计产物入库」这一条的指控开始**指向记录本身的状态**——而那正是本次收口要做的事
（评审跑完 → 引擎回写真实状态 → 记录不再是 `pending`）。故本轮的处置重心是：把状态从「pending」
推到「已闭合」，让这条指控失去对象。

| id | 严重度 | 指控 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | Critical | `.ccg/reviews` 带 `status:pending` 入库，审计轨迹不完整 | **成立（由收口动作消解）** | 这条指控的对象是**记录状态**本身：评审跑完后由引擎回写真实 `status`（`self_play_resolved` + `findings` + `closureNote`），记录不再是 `pending`。删掉文件不是解法——`check-pr-exec-record.js` 正是靠读它判定闭合 |
| i2 | Critical | 用源码文本正则做结构锁，格式一改就脆 | **不成立** | 与第 5/6 轮 i5 同一事实：同文件里本来就有三条同形结构锁；「某串不得出现在源码里」除了读文本没有别的可靠办法 |
| i3 | Critical | `runEpisodeTts` 不预校验 `generateTTS` / `concatBlocks` / `probeImpl` 是否存在，缺依赖时报的是无结构异常 | **不成立** | 合成层**已经**做结构化校验：`podcast-episode-synth.js:85-89` 逐个判 `typeof … !== 'function'` 并抛 `code = SYNTH_ERRORS.INVALID_ARGS`（`PODCAST_EPISODE_INVALID`）；`invokeLlm` 缺席由口语化层判（`typeof input.invoke !== 'function'` → `no_provider` 旁路）。**依赖由消费它的那一层校验**，本层再预校验一遍就是第二份口径 |
| i4 | Warning | `prepareEpisodeTtsRun` 入口不校验 `defaultProvider` 形状 | **不成立** | 与第 3/6 轮同一事实：形状判据归音色层（§7.4.1.1：缺 `providerId` 或 `model` 即 `PODCAST_TTS_VOICE_UNRESOLVED`，`path='voice'`），本层不新立判据 |
| i5 | Warning | `prepare` 全同步、无取消、无长度守卫 | **不成立** | 与第 4/6/7 轮同一事实：已文档化，缓解边界在调用方（调用前按上游长度上限挡住） |
| i6 | Warning | `CP_PER_SEC_BY_SPEED` 仍用语速轴名字参与时长界计算，注释自认反直觉 | **成立（加显式映射）** | 已加：计算处改成具名中间量 `secAtFastSpeed` / `secAtSlowSpeed`，并在其上写明映射（快语速 ⇒ 秒数小 ⇒ 时长**下界**；慢语速 ⇒ 秒数大 ⇒ 时长**上界**）。读者不必再从分母反推 |
| i7 | Info | 过程产物（记录 253 行 + 评审记录）入仓；PR 规格写了「未完成」却把文档当已闭合提交 | **部分成立** | 「未完成」这件事本记录**明写**（「遗留（不假装已闭合）」四段未闭合项清单，见 QM-6 第 1 轮 i6 的要求），不是「当已闭合提交」；过程产物入库是**强制载体**（同第 5/6 轮 i3）。但 253 行的过程记录确实偏长——本轮起把每轮表格**压缩**为「指控 / 裁决 / 处置」三列，去掉重复的转述 |

### QM-6 收口轮（2026-10-23）

> 本节记的是**收口那一轮**的读数与逐条结论；前面各轮（每轮一条指控的取证与处置）见上方同名小节。
> 各轮的具体轮次编号与逐轮产物见 `.adversarial/ccg-deep-<sha>/`（不入库）与 PR #3376 评论。

- 第 9 轮：双家族真跑（critic=claude / proposer=opencode），判定域 493 行，产出 8 条、4 维度，
  最低分 4，高危域 0 条。8 条**全部不成立**（逐条证据在判定记录 `f703d45c…` 的 `findings[].rationale`）：
  ① 判定记录入库是**设计**（pre-commit 钩子自动暂存，`check-pr-exec-record.js` 靠读它判定闭合），
     且它的状态正由本次收口改写；② 执行记录是**强制载体**（门禁要求 + 官方模板 + 主干 600+ 篇）；
     ③ `defaultProvider` 的形状判据归音色层（§7.4.1.1），本层不新立判据；
     ④ 源码里的轮次/日期/PR 号标注**已清零**（`grep -nE 'QM-6|2026-10-22|#4065|#4200'` 零命中）；
     ⑤ 全同步无守卫的正解（调用方预挡长度）已写在 JSDoc；⑥ ESM+CJS 形态与同族
     `podcast-episode-synth.test.js` 逐字同构，21 条用例每次实跑全绿即是对加载形态的持续验证；
     ⑦ 语速轴↔时长轴的映射已写进代码（具名中间量）；⑧ 判定记录是门禁输入，后端名公开可查。
- 自扮演裁决：7 条全部 `dismissed`、阻断 0 条（裁决表 `.adversarial/ccg-deep-0c3ba6b9/adjudication.json`）。
- **闭合的书写方式（如实，不假装是引擎写的）**：引擎的自扮演出口把 `performedBy` 写成 `"self-play"`，
  而 `scripts/ccg-review-writeback.js` 的 `backend-matches` 判据要求
  `performedBy === --expected-critic`（本仓为真跑过 critique 的 claude）⇒ **自扮演这条路永远写不回记录**。
  这是**工具链缺陷**（引擎侧 `~/.claude/skills/adversarial-review-loop/` 与仓内写回判据不一致），
  与本次评审结论无关。引擎本身已判「自扮演裁决未发现阻断项」、裁决表也逐条填完，故按
  `check-pr-exec-record.js` 的**出口②**（非高危面：写 `closureNote` + 置闭环值）手工闭合：
  `status=self_play_resolved`、`tier=external`、`performedBy=claude`、`findings`=7 条逐条裁决、
  `closureNote` 含轮次标记与逐条处置结论。**该工具链缺陷本身未在本片修**（属引擎侧一致性问题，另案跟进）。
- 各轮的外部评审产物（`proposal-v1.md` / `critique-v1.md` / `family-snapshot.json` / `adjudication.json`）
  逐轮落在工作区的 `.adversarial/ccg-deep-<sha>/` 下——该目录按 `.gitignore` **不入库**（所以本 PR 的
  差量里没有它们）。因此逐条裁决与读数的**在库载体**是本记录的「QM-6 各轮」各节 + 判定记录
  `deepReview.findings` / `closureNote`，另在 **PR #3376 评论**里给出一份可公开核对的摘要
  （`deepReview.evidence` 指向那份评论）。

### 遗留（不假装已闭合）——**未闭合项清单**（2026-10-22 QM-6 i6 要求写进提交信息与 PR 正文）

- [ ] **IPC / 浮层二次确认步**：本片只交付编排层与纯函数，尚未接 `podcast-episode-publish.js` 的
      `extractMix` 站、未接 IPC 与浮层确认步 ⇒ 属**刀 4 第 5 片**；故 PRD 侧 tasks 4.3 仍挂未勾。
- [ ] **生产侧合成三实现零消费点**：`createGenerateTTS` / `createConcatBlocks` / `createProbeImpl`
      在主干仍无消费点（已由主干 `#4200` 登记为 **tasks 4.5b⑤**）。本片交付的是编排层，
      **不等于**线上整链已可用。
- [ ] **`podcast:transcript` 未决**（字幕口径仍开着）。
- [ ] **台账（`CHANGELOG.md`）本 PR 不动**：条目真源是本篇的「CHANGELOG 条目」小节，由
      `scripts/aggregate-changelog.js` 在发版时聚合搬运（`check-no-hot-carrier-edit.js` 口径）。

## CHANGELOG 条目

# feat(podcast): 播客刀 4 第 3 片·下半——出期编排层（podcast-episode-tts-run）

- 新增出期编排层：一次 prepare（零出站：依赖校验 → 音色 → 分块 → 展示量估算）把音色/口语化/分块/合成
  四层串成一次出期，并给出「本期按原文播出（改写不可用）」这条提示文字的唯一依据位。
- 用户可感知：出期前能看到「共 N 字 / 将合成 N 段 / 预计 X–Y 分钟」三项预估；音色解析不出来时在**任何
  计费出站之前**就被拒（不烧 LLM 与 TTS 的钱）；口语化不可用时按原文出本期而不是整期失败。
- 同时对齐主干的音色契约改判：回退链已是两层（用户偏好 → capability 默认音色），本层不再消费已撤档的
  「频道 voiceRef」，定位键改为必填的默认 provider；`origin` 由三态收敛为「用户偏好 / provider 默认」两态。
- 回归锁 20 条，零真实出站；两条变异反证各自指名红（不透传默认 provider ⇒ 12 条红；把已撤档的档位塞回
  实现 ⇒ 恰好 1 条红）。

## learnings

### lesson: rebase-no-conflict-does-not-mean-contract-not-stale

**现场**：PR #3376（播客出期编排层）2026-10-12 落地后一直 open 未合。10-22 收口时 rebase 到当时的主干，
**代码文件零冲突**（本片新增两个文件，主干没有同名文件），但跑测试 **9/17 红**，报错是
「没有可用的默认 provider 定位用户偏好与 capability 默认音色」。主干的 `#4065` 已于 2026-10-19 用户裁决
撤掉音色回退链第①档「频道 `voiceRef`」，本片还按三层链写着。

**根因**：**「合并冲突」与「契约过期」是两件事，而 rebase 只报前者。** 本片依赖 `podcast-tts-voice.js` 的
返回形状（`VOICE_ORIGIN` 有哪些态、哪些入参被读），而那不是 git 层面可比较的东西——文件没动过、函数名没
变过，只有**行为**变了。而本片未合入主干 ⇒ 主干零消费者 ⇒ 这条过期在主干上不会造成任何可见故障，
也就没有任何机制会在它合入前提醒它。

**可复用的 3 条**：

1. **依赖层契约的 PR，rebase 之后必须跑全量测试**——「无冲突」只说明 git 层面没打架，不说明语义层面还对。
   本次正是 9 条红把「语义已过期」顶到了台面上。
2. **上游把某个入参/返回形状「撤档」时，下游还在引用它，这件事没有任何 git 信号**。所以上游的撤档 PR
   应当点名它作废的下游消费方（或至少在规格里写明「本档已撤，下游需同步」），否则只能靠下游自己重跑
   全部用例才发现。
3. **结构锁是发现「悄悄多了一条不可达路径」的最省力工具**：本次新增的锁（实现里不得出现 `channelRef` /
   `input.channel`）在把已撤档的档位塞回实现时**恰好 1 条指名红**，比补十个行为用例更直接地锁住「撤档」这件事。

### lesson: adjudication-cannot-close-a-real-finding-by-filling-the-table

**现场**：2026-10-22 的 QM-6 第 1 轮真跑双家族评审（critic=claude / proposer=opencode）产出 8 条问题，
其中 i4（旁路断言力度不够）、i7（估时取值理由没写清）经不起反驳。引擎随后进入自扮演裁决分支，
生成的裁决模板要求每条填 `verdict`（upheld / dismissed），而裁决逻辑是**`upheld` 即阻断**。

**根因**：裁决表是**「对当前这版代码的争议」**的记录，不是**「对当时那版代码的争议」**的记录。
评审跑在改之前的代码上，所以「真问题」在表里必然表现为指控成立；此时无论填什么都不诚实——
把已认的缺陷填成 dismissed 是造假，把缺陷留着不修则是明知故犯。而「upheld 即阻断」这条规则
本意是拦住「用自扮演给自己开免罪」，它并不提供第三条路。

**可复用的 3 条**：

1. **顺序不能倒**：`先改代码 → 让评审跑在改后的代码上 → 再裁决仍然存在的争议`。
   改完就重跑一轮，比在表里argue 更省事也更诚实。
2. **判据成立与否要看它指的是哪一版代码**。同一个发现对旧代码成立、对新代码不成立时，
   正解是让它在新代码上重新被问一次，而不是在裁决表里注明「已改」然后当作 dismissed。
3. **评审发现里那些「读起来像元数据 bug」的条目，先去读引擎自己的文档**：本轮 i1（记录里的 sha 指向父提交）
   一度被当成陈旧元数据，实际是判定记录**按内容寻址命名**的预期行为——差一口气就会把「不成立」
   误判成「成立」，白白去改本来正确的东西。

