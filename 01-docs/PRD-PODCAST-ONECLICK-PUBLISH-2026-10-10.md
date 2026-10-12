# PRD · 播客 RSS 频道一键发布（文案/成片 → 一期 → 分发）

- 编号：PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10
- 上游：`01-docs/PRD-PODCAST-RSS-CHANNEL-2026-10-09.md`（P0 已合并 PR #3193 → `06737f999`）、`docs/adr/0008-podcast-rss-is-protocol-channel-not-platform.md`
- 设计真源：`.adversarial/podcast-oneclick-publish/proposal-v5.md`（本文与 v5 冲突时以 v5 为准，二者不得并存两说）
- 复杂度：**M+** · 必经 OpenSpec change `podcast-oneclick-publish` + QM-6 双模型外部评审
- 评审事实：5 轮跨家族对抗评审共 38 条（9/9/11/9，第 5 轮 critic 进程异常无结论）+ 外部 CCG 10 条；分数 min 轨迹 4→6→7→6；**未自称 converged**，v5 残留项的闭合改由实现期测试锁逐条钉死（§10）

---

## 1. 目标与非目标

**目标**：在所有"产出成稿"的位置，用户点一次即可把该份内容变成播客频道里的**一期**并让聚合端抓到——即一键完成「取音频 → 上传托管 → 追加/合并单集 → 重建 feed → 覆盖上传 feed」。

**非目标（本 PR 一律不做，做了即违规）**：
- 不把播客登记为第 16 个平台：`config/platforms.yaml`、`publish-capabilities.json`、`platform-definitions.js`（含四张表）、rpa-engine DOM 选择器**零改动**；`podcast-endpoints.test.js` 的「与平台契约面隔离」describe 必须持续绿。
- 不给 `publishMode` 加第四态（三态闭集回答的是"API 轨还是 DOM 轨"，RSS 是另一种通道种类）。
- 不接 `publish:batch` / `batch:create` / `taskQueue` / **`task-queue-frequency.js`（发布频率策略 v2 的日配额与紧急放行）** / `publish:progress` 相位枚举 / 发布历史。**播客一键发布不占任何平台日配额**。
- 不逆向聚合端私有写接口（违反 ToS，且无发布 API 可对接）。
- 不做跨频道音频对象去重（引用计数复杂度不值）。
- 不打包本地大模型 TTS（AGPL 的 ChatTTS、许可 NOASSERTION 的 IndexTTS 一律不进安装包）。

---

## 2. 已锁决策（用户逐条确认）

| # | 决策 | 否决掉的备选 |
|---|---|---|
| D-1 | 一键 = 端到端出一期，**音频与 feed.xml 两个对象都更新** | 只落草稿（feed 不更新则聚合端永看不到新期） |
| D-2 | **多频道**（单份 `channel.json` 改数据模型） | 单频道（多节目场景无解） |
| D-3 | 重复点击 = **原地更新同一期**（稳定 guid 命中 `saveEpisode` 合并） | 每次新建一期；弹窗问用户 |
| D-4 | 托管凭证 **全局一份 + 按频道路径前缀** | 每频道一份；全局+频道覆写 |
| D-5 | 成片取 **全混音**（ffmpeg 抽完整音轨） | 纯旁白；全混音回退旁白 |
| D-6 | 入口 = **共用手柄 + 正交执行链** | 统一交付通道抽象层；进平台勾选 |
| D-7 | 合成引擎 = **云端 TTS 适配器**（复用既有 6 家） | 打包本地模型；piper/kokoro 离线兜底（本期不做） |
| D-8 | 到 `ITEMS_MAX` **保留 `EPISODES_FULL` 报错，绝不自动挤出**；`{cap,count}` 暴露给渲染层做事前禁用 | 自动挤出最老一期（会静默下掉已发布内容） |
| D-9 | **共用手柄前置到刀 3**，刀 4 复用 | 刀 5 才收敛（入口返工 + 多走一轮像素基线） |

---

## 3. 架构：单元与边界

| 单元 | 位置 | 职责 | 注入依赖（测试零出站） |
|---|---|---|---|
| `podcast-channel-registry` | 主进程 | 多频道目录、默认频道、迁移、`{cap,count}`；持**两把锁** | `fs` |
| `podcast-hosting-service` | 主进程 | 凭证落盘、上传音频与 feed、备份与回滚 | `clientImpl` |
| `podcast-episode-assembler` | 主进程 | degraded 读取、抽混音/分块合成、拼接、ffprobe 实测、三处一致校验 | `ttsImpl`、`ffmpeg/ffprobe` |
| `usePodcastEpisodePublish` + `PodcastPublishAction.vue` | 渲染层 | 共用手柄与浮层 | `src/api/podcast-channel.js` |
| `podcast:episode:publishFromSource` | IPC | 编排上述三层，幂等 | — |

---
**单元划分（实现态，逐文件行数门禁 NEW_OVER_LIMIT 逼出来的一次真拆分，不是为拆而拆）**：

- `usePodcastChannel.js`（页面态：频道元信息 / 单集列表 / feed 产物 / 分发端目录）与 `usePodcastChannelPicker.js`（频道目录域：当前频道是谁、目录里有什么、迁移处于什么态、配额现算）分家。分界判据是**各自持有的不变量不同**：目录域的不变量是「activeChannelId 必须指向目录里存在的频道」，页面域的不变量是「切换频道必须把列表与 feed 产物一起清掉」。后者由页面域通过 `onChannelActivated` 注入 —— 目录模块不知道也不该知道列表与 feed 的存放形状。

- `PodcastChannelView.vue`（排版与绑定）与 `usePodcastChannelActions.js`（表单态 + 提交动作）分家。判据是可测性：留在 `.vue` 里时「保存失败要把哪一批校验码留在界面上」只能靠 mount 整页覆盖；拆出后可直接对行为断言。**模板与 `<style scoped>` 一行未动** ⇒ 像素基线不因这次拆分漂移。


## 4. 数据模型（存储层）

```
<userData>/podcast/
  index.json        { version, defaultChannelId, migratedAt, migrationStatus?, stockStamp?,
                      channels:[{id,name,createdAt,updatedAt}],
                      hosting:{ provider,endpoint,bucket,pathPrefix,credentialRef } }
  channel.json      legacy（迁移后保留不删，仅作回滚依据）
  channels/<channelId>/
    channel.json    { meta:{…validateChannel 白名单逐字不变…},
                      feedSync:{ result, attemptedAt, errorCodes[], hostingSnapshot } }
    episodes.json   { version, episodes:[…] }（ITEMS_MAX 按频道计）
    feed.xml        本地构建缓存
```

**四条不可破**：
1. **`channelId` = 不可变短 id `^ch_[a-z0-9]{4,16}$`**，唯一载体是 `index.json` 的 `channels[].id`（目录名与之相等，落盘校验与对象 key 派生共用同一判据）。托管路径含 channelId ⇒ 改名会打断**已提交给 Apple/小宇宙的 feed URL**，故 `default` 只能作 UI 显示名。
2. **`feedSync` 与 `meta` 两段分离**：`saveChannel:247` 用 `Object.assign({}, channel, {createdAt,updatedAt})` 整写，若把发布状态平铺进 channel 对象，**用户改一次频道名就把发布状态抹掉**（评审 #19）。`feedSync` 仅由发布流程写。
3. **guid 作用域含 channelId**：`mpub:<channelId>:<sourceKind>:<sourceId>`，`sourceKind ∈ {project,draft,copy,rewrite,manual}`；不含 channelId 时"发到 B 频道"会搅浑 A 频道那期（合并只在单文件内发生）。播客页手工单集仍走 `crypto.randomUUID()`。
4. **迁移绝不改写既有 guid**：legacy 单集无 `guid` 值，`buildItem:238` 回退成 `audioUrl`；补写成新形态会让聚合端**把每一期认成新节目**（听众看到节目单重复一遍）。

---

## 5. 迁移（含硬失败出口）

- 落在 `ensureMigratedOnce()`，由**首个需要频道数据的调用**（读或写均可）触发；**恰好一次**靠 `index.lock` 文件锁 + `migratedAt` 双保险。
- `registerHandlers` 仍**绝不触碰 userData**（守 `ipc-handlers/podcast.js:69` 既有约束；v2 的"注册期单飞"已撤销）。
- **完整性按内容哈希三态判定**（§3 与 §8.6 同一判据，出现第二套即结构锁⑬变红）：全量一致=已完成；不一致且**来源仍完整**=静默续传；来源与目标各为不同合法内容才落 `migrationStatus:"conflict"`。复制中途 IO 失败落 `migrationStatus:"error"` + `PODCAST_MIGRATION_IO_FAILED`。
- 冲突/错误态：**只读通道保留**，写路径与一键入口 fail-closed；读写分档的判据只在 registry 一处 —— `assertChannelExists()`（读：id 形态 + 频道存在）与 `assertChannelWritable()`（写：再查 `migrationStatus`），IPC 的 `getService(channelId, { writable })` 按入口声明二选一，禁止在 handler 里另写第三判据；`podcast:channel:migrate:resolve`（`keep_legacy | keep_existing`，两分支均幂等）。
- ⚠️ 冲突/硬失败必须在**发现它的那一次调用**就返回可读状态（`ensureMigratedOnce` 捕获 `PODCAST_MIGRATION_CONFLICT` / `PODCAST_MIGRATION_IO_FAILED` 后返回错误上挂的 `index`），不得让首访 `podcast:channel:list` 直接 reject：读路径一抛错，界面就渲染不出横幅与两个处置按钮，用户只剩「反复重启应用排障」一条路（QM-6 评审 i3，高危域 datamigration，外部复核后成立）。
- legacy `channel.json` 与旧文件**一律不删**（R0 删除守卫 + 回滚依据）。

---

## 6. 接口契约

### 6.1 逐通道（**不是一律必填**）

| 域 | 通道 | channelId |
|---|---|---|
| 频道 | `podcast:channel:list`（返 `channels/defaultChannelId/empty/migrationStatus`）/ `:create`（只分配 id 与骨架）/ `:rename` / `:setDefault` / `:migrate:resolve` | 无参 / 各自见参数 |
| 既有 8 | `channel:get` / `episode:list` / `episode:save` / `episode:remove` / `feed:build` / `feed:verify` | **必填**，主进程不猜默认 |
| 既有 8 | `endpoints:list` | **保持无参**，且 handler 直取共享层 `listPodcastEndpoints()`——不得借用需要 channelId 的 service 构造，否则该通道在生产路径恒抛 `PODCAST_CHANNEL_ID_REQUIRED`（QM-6 评审 i2：注入假 service 的单测对此结构性免疫） |
| 托管 | `podcast:hosting:get` / `:save` / `:check` | 全局 |
| 发布 | `podcast:feed:publish` / `podcast:episode:publishFromSource` | 必填 channelId |
| 事件 | `podcast:publish:progress`（`start`/`done` 双边界）；`onPodcastPublishProgress(cb)` 返回取消函数 | — |

- IPC 一律写字面量 `ipcMain.handle('podcast:…')`，**禁止** map 循环注册（`ipc-contract.test.js` 靠字面量 harvest）；注释中不得出现示例字面量（结构锁不剥注释）。
- 事件名必须新，**不得复用 `publish:progress`**（`stores/publishProgress.js` 是发布进度唯一承载）；`on…` 形态同构先例见 `preload/aggregation.js:38-39`；改 preload ⇒ 重打 `index.bundle.js` 并过 `check-ipc-bridge.js`。

### 6.2 错误体契约

```
{ code, subCode?, message, issues?: [{ code, path, message }] }
```
`PODCAST_FEED_INVALID` **必须透传** `err.issues`（`podcast-rss.js:273` 已挂载，`path` 形如 `episodes[3].audioUrl`）。刀 1 已落：`toIpcError` 白名单含 issues 透传并统一带 `subCode`；改 preload ⇒ 重打 `index.bundle.js` 与 `home-shell-preload.bundle.js`（`pnpm run build:preload`），并由「失败信封带 subCode 必须原样透出」的行为锁钉住（`preload/podcast.test.js` 与 `usePodcastChannel-ipc.test.js` 各一条）。
- `code` 是 EC 数字（决定「往哪查」：未找到 / 校验 / 请求错误），`subCode` 是领域码（决定「给用户哪句话」）。两者不得互相顶替：`toIpcError` 一律带 `subCode: err.code || ''`，preload 原样透出，`usePodcastChannel.call()` **只在 `ok === false` 且带 `subCode` 时**把 `code` 换成领域码——归一发生在这一处，视图与其余分支继续看 EC 数字。没有这一步，新增校验码只能落到兜底文案，用户看到的永远是「调用失败，请重试」。

### 6.3 托管 `:save` 的分区合并

`secret` **缺席 = 保持不变**（先从 `credential-store` 取旧值回填再 `validateHosting`）；仅显式 clear 动作才覆写；落盘层**拒绝以空 secret 静默覆写已有 secret**（`validateHosting` 要求 AK/SK 非空，`:get` 永不回显 secret）。**「只有空白的串」也算缺席**（刀 2 由 QM-6 后端评审命中并修正）：`accessKeySecret` 必须先 trim 再判缺席。漏掉 trim 的后果不是报错而是**静默销毁已存凭证**——`validateHosting` 里那条 `PODCAST_HOSTING_CREDENTIAL_REQUIRED` 正是被单独过滤出去、交给「缺席即拒绝」那道判据处理的，所以过滤之后已无人在管空白；结果是 `configured` 仍为 true、签名 403、用户看不出凭证被换过。回归锁两条（`podcast-hosting-service.test.js`「secret 传空白串 = 缺席：不得把已存凭证静默换成空白」「AK 只有空白且无旧凭证 → 仍判缺席并拒绝」），变异「去掉 trim」实测只有第一条变红。

---

### 6.4 下半片合同：`podcast:episode:publishFromVideo`（2026-10-11 定，先于代码写死）

上半片（#3291）落了 `publishAudio` 与编排层的收口，但它**没有调用者**。下半片要接的是「一次点击 → 一条完整出期链」，
所以这里先把合同钉死：形状、错误码到文案的映射、显示项、禁用条件、校验层次。**代码必须服从本节，不是反过来**。

**入参**（渲染层传出的必须是纯 JSON——Vue ref 包出来的 reactive proxy 直接进 `ipcRenderer.invoke` 会抛 `An object could not be cloned`，取用时先 `JSON.parse(JSON.stringify(...))` 脱壳）：

| 字段 | 必填 | 判据 | 不满足时 |
|---|---|---|---|
| `channelId` | 是 | 非空且存在于 registry | `PODCAST_CHANNEL_ID_REQUIRED` → `podcast.errors.PODCAST_CHANNEL_ID_REQUIRED` |
| `project` | 是 | 含 `segments[]`；降级判定读 `segments[].audioMeta.degraded` | `PODCAST_EPISODE_INVALID`（缺项目等于没有音轨来源，不许猜） |
| `videoPath` | 是 | 成片绝对路径且 `existsSync` | `PODCAST_VIDEO_NOT_FOUND`（**新增码**，不得复用 EXTRACT_FAILED——「找不到成片」与「ffmpeg 失败」是两个排查方向） |
| `outBase` | 是 | 临时目录基名（主进程算，不接受渲染层给路径） | `PODCAST_EPISODE_INVALID`（路径由主进程持有是防越界的唯一办法） |
| `title` | 是 | 非空、≤200 码点 | `PODCAST_EPISODE_INVALID` 并带 issues |
| `meta` | 否 | 只允许引擎白名单键 | 非白名单键**丢弃并出声**，不得静默落盘 |
| `runId` | 是 | 形态 `/^[A-Za-z0-9_-]{8,64}$/`，**由渲染层生成** | `PODCAST_EPISODE_INVALID`（它同时是主进程临时目录名的一部分，所以形态判据就是目录穿越边界本身，不是装饰） |
| ~~`cancelToken`~~ | — | ⛔ **合同纠正（2026-10-11 第 3 片实做时命中）**：`ipcRenderer.invoke` 走结构化克隆，「渲染层持有引用」这句话在 IPC 上不成立——`{ cancelled: false }` 到主进程就已经是**快照**，渲染层随后改的是另一个内存对象。照原话实现的后果是「取消」按钮点下去永不起作用、不报错、进度条照走。取消因此改由**第二条通道** `podcast:episode:publish:cancel` 承载，主进程按 `runId` 持有活引用并交给编排层 | 缺席视为不取消 |

**返回**（成功信封 `{ code: 0, data }`，`data` 逐字为）：
`{ state, phases, audioUrl, episodeId, itemCount, feedUrl, message, errorCode, errorMessage }`——
`state ∈ {success, partial, cancelled}` 三态**不得压平**：`partial` 表示这一期已在本地频道、公网 feed 未更新，
压成失败会诱导用户删掉重来（而本地是对的）；`cancelled` 只在 `uploadAudio` 之前可达。
`phases` 是逐相位轨迹（含每相位的 `durationSec`/`sizeBytes`/`mime` 标记），排查时它是唯一能说「卡在哪一站」的东西。

**失败信封**：`{ code: <EC 数字>, subCode: <领域码>, message, issues? }`。领域码到文案的映射表（渲染层按 `subCode` 取，缺键回落 `podcast.errors.fallback`）：

| 领域码 | 触发站 | 用户文案要点（zh/en 成对，键名如下） |
|---|---|---|
| `PODCAST_AUDIO_DEGRADED_SOURCE` | 降级判定 | 检测到静音占位旁白，已阻止上传——不是生成失败，是**素材本身不可用**（`episode.audioDegraded`） |
| `PODCAST_VIDEO_NOT_FOUND` | 抽取前 | 找不到成片文件，请回结果页重新生成或重选路径（`episode.videoMissing`） |
| `PODCAST_AUDIO_EXTRACT_FAILED` | 抽混音 | 抽取失败（附退出码；`stage=encoders` 时文案改口为「打包的 ffmpeg 无法执行」，见 §13 第 11 条 F2）（`episode.extractFailed` / `episode.encoderBroken`） |
| `PODCAST_AUDIO_ENCODER_UNAVAILABLE` | 编码器探测 | 打包的 ffmpeg 不含 mp3/aac 编码器（`episode.encoderMissing`） |
| `PODCAST_AUDIO_MEASURE_FAILED` | ffprobe 实测 | 无法实测时长或字节，已停止（**不得**用申报值或分段求和代替）（`episode.measureFailed`） |
| `PODCAST_AUDIO_SIZE_MISMATCH` | 三处一致校验 | 上传回来的字节与本地实测不符，这一期没有挂上（`episode.sizeMismatch`） |
| `PODCAST_HOSTING_REQUIRED` / `..._UPLOAD_FAILED` / `..._SECRET_MISSING` / `..._CRYPTO_UNAVAILABLE` | 上传 | 沿用 §6.3 已有四条文案，不在本通道重复造键 |
| `PODCAST_EPISODES_FULL` / `PODCAST_EPISODE_INVALID` | 挂期 / 校验 | 已达上限或字段不合格，逐条列出 issues（`episode.capFull` / `episode.invalid`） |
| `PODCAST_FEED_BUILD_FAILED` | 重建 feed | 这一期已登记到本地频道，公网 feed 尚未更新（**永不**说成本地坏了）（`episode.feedBuildFailed`） |
| `PODCAST_CHANNEL_BUSY` | 全程 | 该频道有一次发布正在进行，请等它结束（立即拒绝不排队）（沿用 §8 既有键） |
| `PODCAST_PUBLISH_CANCELLED` / `PODCAST_CANCEL_TOO_LATE` | 取消 | 前者为已取消且临时文件已回滚；后者必须明说**为什么不能取消**（`episode.cancelled` / `episode.cancelTooLate`） |

**显示项**（浮层 `PodcastPublishAction`）：相位进度条（七相位 + `cancelled`，逐相位文案走 `episode.phase.*`）、
当前相位的实测值（时长 / 字节 / mime——用户要能看见「量到了什么」而不是只看见转圈）、
结果三态各自一句话（success 含 `feedUrl` 与「聚合端下次抓取后生效（通常数小时至数天）」，**不得写"已即时生效"**；
partial 含「这一期已登记到本地频道」+ 一个只重试 feed 的出口；cancelled 含回滚说明）、
取消按钮仅在 `cancellableAt(phase)` 为真时可点（判据来自编排层，界面不得自己猜相位）。

**交互与挂起合同**：浮层是应用级模态，必须经 `src/composables/useEmbeddedViewSuspension.js` 挂起内嵌视图并在
`overlay-view-suspension.test.js` 登记 owner（释放穷尽：`finally` 或 `watch(visible)` false 分支 + `onBeforeUnmount` 兜底）。
关闭浮层**不取消**本次发布（链在主进程，跨 await 的中间态由主进程负责收尾）——这句必须写在界面上，否则用户会用关窗口来「停止」。

**数据校验三层**：① 入参形状（本节表，主进程入口，缺任一必填即拒且在任何出站与任何磁盘写之前）；
② 素材与实测（降级判定 → ffmpeg → ffprobe → stat，全在 `uploadAudio` 之前）；
③ 落盘前预校验打在**合并结果**上（读 `list[index]` → 按同一合并语义 merge → `validateEpisode(merged)`），不合规整次拒绝不落盘。

**preload 与桥接层**：通道名 `podcast:episode:publishFromVideo` 必须以**字面量**出现在 `ipcMain.handle(...)` 注册点
（`check-ipc-bridge` 的 harvest 只认字面量，变量派发会造出「451 handlers / 0 缺口」的假账），且注册形态沿用
`withSenderCheck(handlerFor(...))` 以保证 sender-guard 比例不被稀释；preload 侧新增同名方法，桥接层 `src/api/podcast-channel.js`
加一个 `episodePublishFromVideo` 导出并走既有 `envelope()` 单点剥壳。**少任何一侧 = CI 红，不允许「先合主进程后补 preload」。**
渲染层两个导出为 `episodePublishFromVideo` 与 `episodePublishCancel`，都走 `envelope()` 单点，不自建第二处剥壳。

#### 6.4.1 第 3 片实做时新增的四条硬约束（实现已落，改任何一条必须同 PR 改本节）

1. **整条出期链自持一个频道忙标记**。临界区横跨「音频 PUT → 挂期 → 重建 feed → feed PUT」四次跨 await 的写，取锁点在宿主 `publishFromVideo` 进入时、放锁在 `finally`。命中即 `PODCAST_CHANNEL_BUSY` **立即拒绝不排队**（排队等于用户以为按钮没生效）。这条同时是那句曾经过期的注释的兑现：前两片 `publishAudio` 的头写着「锁归整条出期链」，而当时实现一次都没取锁（QM-6 后端 ① W1）。把锁下放到 `publishAudio` 是错的：那会把一次发布切成两段互斥，段间仍能插进手工单集写。
2. **链内的 `publishFeed` 凭持锁凭证再入**。它自带取锁，整链已持有时必须认得「锁在手上」，否则一次出期死于自己的忙标记。判据**只认 `registry.publishHolder(id).token === heldBy`**，不接受调用方口头声明「我已持锁」——那等于任何人都能绕过忙标记；凭证不匹配或未传一律照常取锁（忙则拒）。再入时**不放锁**：放掉会把「音频已传、feed 未更」的中间态暴露给手工写者。
3. **适配层每一次取「可写服务」都必须在 `channelPublishPass` 的同步作用域内**。`assertChannelWritable` 就是在 `channelServiceOf(id, { writable: true })` 这一站发生的，把它留在通行证外面（`feedSink` 原先正是这么写的）等于每次出期都停在 buildFeed。三个取用点（assertWritable / episodeSink / feedSink）一条都不能漏。
4. **取消窗口与 kill**。`cancellableAt(phase)` 的唯一实现在编排层，宿主登记取消时注入的是同一个函数（不在宿主另写相位表）。`too_late` **不置位**（置位等于把既成事实说成「用户不要了」，而它已无法回滚）；`unknown` 不得被界面读成「已取消」（那会对一次已经发布成功的出期说「已取消，临时文件已回滚」）。用户取消在抽取在途时必须真的 `child.kill()`；**宿主超时只杀进程、不置位**——否则同一个 token 的下一个采样点会把「等太久」读成「用户取消了」，两件事排查方向相反。被 kill 后的非 0 退出在抽取层转成 `PODCAST_PUBLISH_CANCELLED` 而不是 `EXTRACT_FAILED`（真因是用户按下的按钮）。**映射必须覆盖抽取链上的每一次 spawn**（`-codecs` 编码器探测 / 抽混音 / ffprobe 实测三站）——宿主是给每次 spawn 都挂了 kill，只挂一站等于把另两站的取消误报成「打包产物崩坏」或「实测失败」。每处判据还必须带「这一站确实没成功」的合取，**且合取要加括号**：`cancelled === true && !x || x.code !== 0` 因 `&&` 先于 `||`，会把映射变成「任何失败都算取消」的绕过口（本片实测踩过，反面对照用例抓红，见 M17）。
5. **`channelId` 进对象 key 前必须过形态判据**（QM-6 ② W2）。判据复用 `podcast-channel-registry` 的 `CHANNEL_ID_RE` 唯一实现，失败即 `PODCAST_CHANNEL_ID_INVALID`（该码的 zh/en 文案刀 1 已存在）。`stem` 早就在洗，id 反而没洗是不对称漏项；不洗的后果是「A 频道的某期覆盖 B 频道的某期」，而两侧本地看起来都正确。
6. **抛出的错误只挂一个相位字段：`publishPhases`**（QM-6 ③ W3）。成功/部分结果里的 `phases` 是逐相位轨迹；抽取段的失败此前完全不带轨迹，现在由宿主在 `extractMix` 的 catch 里补上——「卡在哪一站」在现场只有这一份证据。
7. **错误码改名**：`PODCAST_AUDIO_NO_COMPOSE_OUTPUT` → `PODCAST_VIDEO_NOT_FOUND`（本节表原本就定名后者，代码服从本节）。
8. **临时目录**：`outBase = <userData 外暂存根>/episode-<runId>/episode<ext>`，由主进程算；链结束时按目录内**列出的文件名**逐个删除再删目录本身，绝不递归到父级。抽取中途被 kill 会留下截断文件，而编排层此刻并不持有它，所以收尾归宿主。

#### 6.4.2 第 4 片必须补的第三条通道：`podcast:episode:publish:progress`（2026-10-11 定，先于代码写死）

**为什么这是规格自己的洞，不是实现漏项**：§6.4「显示项」要求实时七相位进度条 + 当前相位的实测值（时长/字节/mime）+「取消按钮仅在 `cancellableAt(phase)` 为真时可点」，而 §6.4 的 preload 段只承诺两条导出。实测第 3 片交付的 `podcast:episode:publishFromVideo` 是**一次性 resolve**——`phases` 只在链结束时随信封返回，链内主进程**不发任何**进度事件（`ipc-handlers/podcast.js:28` 的信封注释、`podcast-episode-host.js:171` 的返回路径）；`cancellableAt` 只作为宿主内部参数传给 `episodeCancelRegistry.begin()`（`podcast-episode-host.js:137`），渲染层无从取得。**照 §6.4 字面写界面的产物是一条永远停在第一个相位的进度条，而且不报错**——这是本仓「装饰性链路」的反向形态（不是代码没接，是显示项从未被任何通道喂过数据，且既有测试全绿，因为它们断的是链结束后的信封形状）。

**裁决：补第三条通道，不降级显示项。** 三条硬口径：

| 口径 | 内容 | 少了它会怎样 |
|---|---|---|
| ① 事件形状 | 通道名 `podcast:episode:publish:progress`，载荷 `{ runId, phase, state, cancellable, durationSec?, sizeBytes?, mime?, message?, errorCode?, subCode? }`；`phase` 取值**只能**是编排层导出的 `PHASES` 闭集**再并上取消终态那一站 `cancelled`**（§6.4「显示项」的相位条本来就画「七相位 + cancelled」，本节早期只写闭集与 §6.4 自相矛盾；2026-10-11 按后端评审 Info 纠正，并同 PR 给一条能变红的闭集锁），`state ∈ {start, done, skipped, failed, cancelled}`
| ② `cancellable` 由主进程算 | 发送前用编排层那份**唯一实现** `cancellableAt(phase)` 求出布尔并随事件下发；渲染层**只读**该位。**禁止**在前端抄相位表、也**禁止**按"已用时长"猜相位 | §6.4.1 第 4 条禁止的事在前端重演一次；且取消按钮会在 `uploadAudio` 之后仍可点，用户以为停了其实没停 |
| ③ 双边界与单点发射 | 每个相位必须有 `start`（执行**前**）与 `done` 两个边界；发射点唯一在 `podcast-episode-host.js`，宿主外的任何一层（适配层、编排层）**不得**再发；链结束时最后一条必须是终态边界 | 只在完成时发会让遮罩静止在视觉上等同卡死（本仓既有纪律「批量 IPC 进度双边界」）；多点发射会造出两份互相矛盾的进度真相 |

**刻意不复用 `publish:progress`**：`electron/services/publish-progress-events.js` 的 `emit(taskId, platform, phase, extra)` 是 **TaskQueue 形状**，其 `PHASE_ENUM` 与 `KNOWN_STAGE_MAP` 封闭清单服务于「平台发布任务」，而 `task:failed` 还承担「落发布历史」的副作用。出期链不是 TaskQueue 任务，塞进去要么污染历史、要么逼 `KNOWN_STAGE_MAP` 登记与平台无关的播客相位串。因此播客进度是**另一条独立通道**，相位→文案映射走 `episode.phase.*` 的 locales 键（这属播客专属映射，不违反「渲染层不得维护第二份**平台**阶段映射」——那条禁的是平台发布链的 `KNOWN_STAGE_MAP` 口径）。

**三侧同 PR**：`ipcMain.handle`/发送侧字面量 + preload 订阅方法 + `src/api/podcast-channel.js` 的 `onEpisodePublishProgress`，`check-ipc-bridge` 少一侧当场红。订阅必须按 `subscriberId` 精确注销（既有跨实例订阅纪律，禁止无 id 时 `clear()` 全清）。

**显示项与降级路径**：主进程若在 `progress` 之外只给到链末信封（例如事件订阅失败），界面必须**显式**显示「进度不可用，仅在本次结束后回看轨迹」，**不得**画一条停在首相位的假进度条。取消按钮在拿不到 `cancellable` 时的默认态是**禁用并说明原因**，不是「点了试试」。

##### 6.4.2.1 实做落点（第 4 片，2026-10-11 已接线——改任何一条必须同 PR 改本节）

- **发射点**：`ipc-handlers/podcast.js` 的出期 handler 里，`event.sender.send('podcast:episode:publish:progress', evt)` 是全仓唯一发送调用；
  闭包按**每次调用**注入宿主（`publishFromVideo(payload, { emitProgress })`），不缓存在宿主上——缓存等于把「谁订阅」变成进程级状态，多窗口下会串台。
- **边界来源**：编排层 `podcast-episode-publish.js` 的既有 `mark()` 就是相位边界点，观察者 `onPhase` 在这里回调（上一站补 `done` 并带出
  `durationSec/sizeBytes/mime`，本站发 `start`）；编排层自身**不发事件**，所以口径③的「唯一发射点」与「双边界」同时成立，且没有新增第二套相位游标。
- **终态边界由宿主补**：`success → done`、`partial → skipped`（公网 feed 未更新，既不得画成 done 也不得说成失败）、取消 `→ cancelled`、
  其余异常 `→ failed` 并带 `subCode`。缺了这条界面会停在最后一个 `start` 上，视觉上等同卡死。
- **`cancellable` 只在宿主算**：`publisher.cancellableAt(phase)`，随每条事件下发；渲染层 `usePodcastEpisodePublish` 只读这个位，
  通道不可用时退回链末信封的 `cancellable`，两者都没给即 `false`（禁用并说明原因，不是「点了试试」）。
- **订阅与注销**：preload `onEpisodePublishProgress` 返回**只删自己那一个 handler** 的注销函数（`removeAllListeners` 一律禁止）；
  渲染层在 `start()` 内**先订阅后调用**（晚一步就丢第一个 `start`），并在 `finally` 注销。事件按 `runId` 过滤——别的窗口/别的链的边界不得动本遮罩。
- **降级面**：`progressAvailable=false` 时浮层显式显示 `podcast.episode.progressUnavailable`，轨迹改从链末信封 `phases` 回看；不得画假进度条。
- **浮层按需挂载（实施中新发现的硬约束）**：入口与浮层成对装配在 `components/PodcastEpisodeEntry.vue`，浮层 `v-if="openedOnce"`——
  首次打开后常驻（关闭只隐藏，因为**关闭浮层不取消发布**，销毁会带走进行中的进度）；而**未打开前不得构造**，否则宿主视图（结果页/创作页）
  在没有播客 preload 面的测试环境里会被浮层 setup 的抛错整片拖红。这条是本节没写、实施才暴露的约束，落点写在这里而不是留在记忆里。
- **宿主侧行数**：结果页只留 1 行装配 + 1 行 import（原本抄两份状态会 +8），`max-lines-baseline.json` 的点名目标随之内调 1888 → 1890，
  理由与本次接线一并在此记录，属「接受漂移」而非「清理」。

#### 6.4.3 第 4 片提示文字逐字对照（**由脚本从 locales/podcast/{zh,en}.js 生成，改文案必须重新生成，禁止手工维护本节**）

- 生成口径：解析两个 locale 文件的 `export default` 对象后按 `podcast.` 前缀扁平化，只收录 `episode.*` 与本片新增的 `podcast.errors.*`；本节列出的每一条都是**渲染层实际取用的键**，与 `check-locale-sync.js --pair-base` 的成对判据同源。
- 「没这条文案会怎样」写在 §6.4 的映射表里；本节只回答**逐字长什么样**，两处不一致时以本节（即代码）为准并回改 §6.4。

| 键 | zh（逐字） | en（逐字） |
| --- | --- | --- |
| `podcast.episode.entry` | 发布为播客单集 | Publish as podcast episode |
| `podcast.episode.title` | 一键发布播客单集 | One-click podcast episode |
| `podcast.episode.running` | 发布进行中… | Publishing… |
| `podcast.episode.progressUnavailable` | 本次发布未提供逐相位实时进度，进度条只在本次结束后按轨迹回看；这不表示卡住。 | No per-phase live progress is provided for this publish; the bar is only a trail you can read after it finishes. That does not mean it is stuck. |
| `podcast.episode.closeNotCancel` | 关闭本浮层不会取消本次发布；要停止请点「取消出期」。 | Closing this dialog does not cancel the publish; press "Cancel this episode" to stop it. |
| `podcast.episode.cancel` | 取消出期 | Cancel this episode |
| `podcast.episode.cancelDisabled` | 本次发布未回传「是否还可取消」，取消按钮暂不可用（关闭本浮层同样不会停止发布）。 | This publish did not report whether it can still be cancelled, so the cancel button is unavailable (closing this dialog does not stop the publish either). |
| `podcast.episode.cancelAccepted` | 取消请求已登记，链会在下一个采样点停下；最终状态以下方结果为准。 | Cancel request recorded. The chain stops at the next sampling point; the result below is the authoritative state. |
| `podcast.episode.cancelUnknown` | 取消未生效：这次发布已结束或未曾登记，不要读成「已取消」。 | The cancel did not take effect: this publish already finished or was never registered. Do not read it as cancelled. |
| `podcast.episode.success` | 已出期：公网 RSS 订阅源已更新（{feedUrl}），聚合端下次抓取后生效（通常数小时至数天）。 | Episode published: the public RSS feed is updated ({feedUrl}). Aggregators pick it up on the next crawl (usually hours to days). |
| `podcast.episode.partial` | 这一期已登记到本地播客频道，公网 feed 尚未更新。 | This episode is registered on the local podcast channel; the public feed is not updated yet. |
| `podcast.episode.cancelled` | 已在上传前取消，临时文件已回滚。 | Cancelled before upload; the temporary file has been rolled back. |
| `podcast.episode.measured` | 实测：时长 {duration} 秒 · 字节 {bytes} · 类型 {mime} | Measured: {duration}s duration · {bytes} bytes · {mime} |
| `podcast.episode.detail` | 详情：{detail} | Details: {detail} |
| `podcast.episode.audioDegraded` | 检测到静音占位旁白，已阻止上传——这不是生成失败，是素材本身不可用。 | Silent placeholder narration detected, so the upload was blocked. This is unusable source material, not a generation failure. |
| `podcast.episode.videoMissing` | 找不到成片文件，请回结果页重新生成或重选路径。 | The final video file cannot be found. Regenerate it on the result page or pick the file again. |
| `podcast.episode.extractFailed` | 从成片抽取音轨失败，已停止出期。 | Extracting the audio track from the final video failed, so the episode publish stopped. |
| `podcast.episode.encoderBroken` | 打包的 ffmpeg 无法执行（疑似交付产物缺依赖或架构不符），已停止出期。 | The bundled ffmpeg could not be executed (missing dependency or wrong architecture), so the episode publish stopped. |
| `podcast.episode.encoderMissing` | 打包的 ffmpeg 不含 mp3/aac 编码器，已停止出期。 | The bundled ffmpeg has no mp3/aac encoder, so the episode publish stopped. |
| `podcast.episode.measureFailed` | 无法实测音频的时长或字节，已停止出期（不得用申报值代替）。 | The audio duration or size could not be measured, so the episode publish stopped (declared values are not accepted instead). |
| `podcast.episode.sizeMismatch` | 上传回来的字节与本地实测不一致，这一期没有挂上。 | The bytes returned by the upload do not match the local measurement, so this episode was not attached. |
| `podcast.episode.capFull` | 该播客频道单集数已达上限，请先删除不再需要的旧期再出这一期。 | This podcast channel already reached its episode limit. Remove an older episode before publishing this one. |
| `podcast.episode.invalid` | 单集字段不合格，已停止出期，请按下方逐条修正。 | The episode fields are not valid, so the publish stopped. Fix each issue listed below. |
| `podcast.episode.feedBuildFailed` | 这一期已登记到本地播客频道，公网 feed 尚未更新（本地数据没有坏）。 | This episode is registered on the local podcast channel, but the public feed was not rebuilt (the local data is not broken). |
| `podcast.episode.cancelTooLate` | 已进入上传阶段，现在取消会留下「音频已传、feed 未更新」的半态，因此不能取消；请等本次发布跑完。 | The upload has started, so cancelling now would leave the half state "audio uploaded, feed not updated". This publish cannot be cancelled; let it finish. |
| `podcast.episode.phase.pickChannel` | 选择频道 | Pick channel |
| `podcast.episode.phase.extractMix` | 抽取完整音轨 | Extract full audio track |
| `podcast.episode.phase.probe` | 实测时长与字节 | Measure duration and size |
| `podcast.episode.phase.uploadAudio` | 上传音频 | Upload audio |
| `podcast.episode.phase.attach` | 登记单集 | Attach episode |
| `podcast.episode.phase.buildFeed` | 重建 feed | Rebuild feed |
| `podcast.episode.phase.uploadFeed` | 上传 feed | Upload feed |
| `podcast.episode.phase.cancelled` | 已取消 | Cancelled |
| `podcast.errors.PODCAST_VIDEO_NOT_FOUND` | 找不到成片文件，请回结果页重新生成或重选路径 | The final video file cannot be found; regenerate it on the result page or pick the file again |
| `podcast.errors.PODCAST_PUBLISH_CANCELLED` | 本次播客出期已在上传前取消，临时文件已回滚 | This podcast episode publish was cancelled before upload and the temporary file was rolled back |
| `podcast.errors.PODCAST_CANCEL_TOO_LATE` | 已进入上传阶段，现在取消会留下半态，因此不能取消；请等本次发布跑完 | The upload has started, so cancelling now would leave a half-published state; please let this publish finish |
| `podcast.errors.PODCAST_FEED_BUILD_FAILED` | 这一期已登记到本地频道，公网 feed 尚未更新 | This episode is registered on the local channel, but the public feed is not updated yet |
| `podcast.errors.PODCAST_AUDIO_EXTRACT_FAILED` | 从成片抽取音轨失败，已停止出期 | Failed to extract the audio track from the final video; the episode publish stopped |
| `podcast.errors.PODCAST_AUDIO_ENCODER_UNAVAILABLE` | 打包的 ffmpeg 不含 mp3/aac 编码器，已停止出期 | The bundled ffmpeg has no mp3/aac encoder; the episode publish stopped |
| `podcast.errors.PODCAST_AUDIO_MEASURE_FAILED` | 无法实测音频时长或字节，已停止出期 | The audio duration or size could not be measured; the episode publish stopped |
| `podcast.errors.PODCAST_AUDIO_SIZE_MISMATCH` | 上传回来的字节与本地实测不一致，这一期没有挂上 | The bytes returned by the upload do not match the local measurement, so this episode was not attached |
| `podcast.errors.PODCAST_FEED_INVALID` | Feed 校验未通过，请先按下列问题解决 | Feed validation failed. Fix the issues below first |
| `podcast.errors.PODCAST_FEED_NOT_BUILT` | 该频道还没有可用的 Feed 产物，请先生成 Feed 再发布 | This channel has no usable feed file yet. Build the feed before publishing. |
| `podcast.errors.PODCAST_EPISODE_INVALID` | 单集信息不合法，请按下方逐条修正 | Episode data is invalid. Fix the items listed below. |
| `podcast.errors.PODCAST_EPISODES_FULL` | 该频道单集数已达上限，请先删除不再需要的旧期再登记新的 | This channel reached its episode limit. Remove an old episode before adding a new one. |

共 45 键；zh/en 逐键成对且均为非空串（另有同文件内的既有键不在本表范围）。


## 7. 功能逻辑（按刀次）

### 刀 1 多频道 + 迁移 + 锁 + 契约
registry（index.json + 两段 channel.json）、迁移三态（首访即可读）、`withPodcastIndexLock()` 收口 `index.json` 全部写者、`episodes.json` 手工写者由**进程内共享的发布忙标记**挡在发布窗口外（`channelBusyGate`，命中即 `PODCAST_CHANNEL_BUSY` 立即拒绝；口径唯一出处是 §11「并发与锁」）、`{cap,count}` 透出、8→6 通道加必填 channelId、`endpoints:list` 改走频道无关路径、`toIpcError` 透传 issues 并带 `subCode`、播客页频道切换器 + 重命名 + 迁移横幅与处置反馈、`{cap,count}` 透出、8→6 通道加必填 channelId、`toIpcError` 透传 issues、播客页频道切换器与迁移横幅。

### 刀 2 托管直传接线
凭证加密落盘（`credential-store`，`index.json` 只存 `credentialRef`）→ `podcast:hosting:*` → `putObject`（`podcast-hosting-upload.js:201-226`，返回 `{status,size}`）→ `podcast:feed:publish` 覆盖上传 **feed.xml**（含本地 `feed.prev.xml` + OSS 时间戳副本）→ 页面入口与【回滚上一版 feed】。独立价值：手工加的单集也能一键托管出去。

**刀 2 实际落地形态（2026-10-11）**：`podcast:hosting:get` / `podcast:hosting:save` / `podcast:hosting:check` / `podcast:feed:publish` 四条通道已接（通道名一律写成源码字面量，`ipc-contract` 按字面量双向对账，间接注册会让整条通道从对账里消失）；渲染层是独立子组件 `PodcastHostingCard.vue` + `usePodcastHosting.js`（凭证全局一份、发布按频道触发，两者状态生命周期不同，且播客页已贴着逐文件行数门禁上限）。发布顺序按本刀次承诺实现为**先建回滚点、再覆盖主键**，而「先」的判据是**相对 `buildFeed()` 之前**：快照取的是磁盘上当前的 `feed.xml`（= 上一次发布成功的版本），拷完才生成新版本并覆盖主键。若把顺序写成「先 `buildFeed` 再拷 `feed.prev.xml`」，拷到的就是本次刚生成的那份，回滚点与主键内容相同——表单上看 `backupCreated:true`，实际把「上一版」静默换成了「当前版」，属于不可见的失真。首次发布磁盘上没有 `feed.xml`，此时 `prevExists:false`，既不建本地 `feed.prev.xml` 也不发 OSS 时间戳副本（发一份"上一版"上去就是发布本次内容两次，且会把上一轮的真实副本覆盖掉）；`prevExists` 与 `backupCreated` 一起进 IPC 信封，渲染层据此二选一显示 `noPrevious` / `backupMissing`。`writeFeedSync` 失败**不得**改变返回形状：它抛错会让整次发布以异常退出，用户拿不到 `{state:'failed'}` 也就拿不到「公网未更新」这句结论，因此两处调用各包一层 try/catch，失败时返回 `feedSync:null`（状态仍如实）。连通性探测的对象 key 取 `_podcast-probe/probe-<ISO 时刻>.txt`，**不可用固定名**：固定名会让第二次探测覆盖第一次的对象，「探测成功后对象被人为删除」这类负向用例在 OSS 侧根本不可表示。凭证侧新增一条配对守卫：表单带了**新的** AccessKeyId 但未带 Secret 时直接 `PODCAST_HOSTING_SECRET_MISSING` 拒绝，不做「新 AK 配旧 Secret」的静默组合——那种组合签名必然 403，而 403 的报错方向会把用户引向「Bucket 权限」而非「刚才那半个表单」。**`prevExists` 的语义是「这一版之前有没有得退」，不是「快照有没有成功」**（跨家族增量评审命中）：两者原先都取 `snapshotted`，于是「本地确有旧版但拷贝失败」会走 `noPrevious` 文案，等于对着一个真有历史的频道说「首次发布」。现在 `prevExists = hadPrevious`（磁盘上有没有旧 `feed.xml`），`backupCreated` 才表示存档是否真的传上去了，两个正交事实各自可见；日志同时记 `prev=` 与 `snap=` 两维，否则排障时无法区分「本来没旧版」与「有旧版但没拷上」。上一版存档的落盘同样走**临时文件 + `atomicRenameSync`**（复用 `podcast-channel-service` 导出的唯一实现，Windows 上只对 `EPERM/EACCES/EBUSY` 有界退避）——备份文件存在的唯一理由是「出事时有一份能退回的」，直接覆写若被中途杀掉就留下一份撕裂的 prev，比没有备份更坏（看着能退，退回去是坏的）；拷贝失败清掉临时文件、只落 warn，不阻断发布。本地回滚点 `feed.prev.xml` 已落盘、可人工核对；OSS 侧时间戳副本的 key **当前不落 `feedSync`**，因此**不提供一键退回**——那属刀 3 与成片链路一起收口的范围，见 §13。

### 刀 3 成片一键出期（含共用手柄）
1. `readDegradedFlags`：从项目持久化数据读 `segments[].audioMeta.degraded`（与 `ResultView.vue:648-657` **同真源同判据**，判据只认 `degraded === true`，**不得**拿 `source` 字符串当第二判据）；命中即 `PODCAST_AUDIO_DEGRADED_SOURCE`，**不上传**。
2. `extractMix`：ffmpeg 从成片抽**完整音轨**；无音轨/抽取失败 → fail closed 指名原因，**不回退旁白**。
3. `probe`：ffprobe 实测 `durationSec` / `sizeBytes` / 容器 → 显式写 `mime`（不得依赖 `buildItem:237` 的 URL 猜测）。
4. `uploadAudio`：用发布开始时锁定的 **hosting 快照**（全程不二次读配置）。
5. **三处一致校验**：`fs.stat` 字节 == ffprobe `sizeBytes` == `putObject` 返回 `size`；不等即 `PODCAST_AUDIO_MEASURE_FAILED` 并**阻断 `uploadFeed`**。存储侧损坏在默认零出站路径**不覆盖**（如实记欠账，不得声称已闭合）。
6. `attach`：**预校验打在合并结果上**（读 `list[index]` → 按 `saveEpisode:285` 同一合并语义 merge → `validateEpisode(merged)`），不合规整次拒绝不落盘；再走 guid 幂等合并。
7. `buildFeed` + `uploadFeed`（feed 本身已在 `engineBuildFeed:269` 前置 `validateFeed`，不过即抛码列表并透传 issues）。


**分片交付状态（2026-10-11）**：上面 1–5 的**判据与收口**已由刀 3 前两片落地（`podcast-episode-source.js` 降级判定 / `podcast-episode-extract.js` 抽取与实测 / `podcast-episode-publish.js` 相位闭集 + 取消窗口 + 三处一致校验 + partial 分层），全部依赖注入、零真实出站、零真实进程。**6–7 与真实宿主已在第 3 片接线（2026-10-11，见 §6.4.1 与 §14）；`usePodcastEpisodePublish` 状态机、浮层与两枚入口仍在第 4 片。** 前两片当时**没有生产调用者**——那是刻意的中间态，第 3 片之后这条已闭合：`podcast:episode:publishFromVideo` 有了唯一调用者 `podcast-episode-host.js`。

### 刀 4 文案一键出期
口语化分段（**新建 prompt，不复用 `rewrite-engine` 的去 AI 味链路**——语义不同）→ 分块云端 TTS（每块 ≤ 引擎上限，块间显式静音 0.3–0.6s，禁止整篇喂）→ 拼接 → 归一 → `probe`/`uploadAudio`/`attach`/`buildFeed`/`uploadFeed` 同刀 3。**只换数据源与触发条件，不得改手柄状态机**（结构锁⑪）。音色默认值取**两层**（capability 级 `defaultVoiceId` → 按 provider+model 的用户偏好）——⚠️ 本节原先写「未配置时回退全局默认音色」，而仓内**不存在**跨 provider 的全局默认音色，照原话实现等于由代码替用户猜一个音色；权威口径见 §7.4.0 第 1 条，两层都落空时必须**出声提示并停止**，不得静默选音色。

### 7.4 刀 4 详细规格：文案 → 一期播客音频（2026-10-11 定，先于代码写死）

> 与 §6.4 同一条规矩：**代码服从本节，不是反过来**；任何偏离先改本节再改代码，并在 PR 里点名这条偏离。
> 本节的事实底稿是 2026-10-11 对现有 TTS / 拼接 / 打包媒体工具链的只读调研（每条判据都带路径:行号出处，见本节末「取证出处」）。

#### 7.4.0 两处合同纠正（写在实现之前，因为它们会改变可实现形态）

1. **「音色默认值属频道级（未配置时回退全局默认音色并提示）」这句里，"全局默认音色"在本仓不存在**（取证：默认音色只有两层——capability 级 `defaultVoiceId`（`services/tts-voice-catalog.js:64,93,99`）与用户偏好 `tts-voice-preference:v1:${providerId}:${model}`（`tts-voice-service.js:117,301-306`），跨 provider 的全局默认无处可查；`model-provider-manager.js:1089-1098` 的 `getDefault('tts')` 选的是 **provider** 不是音色）。
   纠正后的形态：**频道只存 `voiceRef = { providerId, model, voiceId }` 三段，任一缺失即整段视为未配置**；未配置时的回退顺序固定为 ① 频道 voiceRef → ② 用户偏好（当前默认 provider 的那条）→ ③ capability 的 `defaultVoiceId` → ④ 三者都拿不到就**拒绝出期**（`PODCAST_TTS_VOICE_UNRESOLVED`），不得静默用「某个 provider 的第一个音色」猜——猜错的用户听感是「我的播客怎么换了个人说话」，且一旦发进 feed 就是对外可见的错。
   ② 与 ③ 命中时界面上必须写明**用的是哪一层回退**（显示项见 7.4.6），否则用户无法区分「我配过」与「系统替我选了」。
2. **本刀不得依赖 `loudnorm` 做响度归一**（取证：打包媒体工具的已验证滤镜清单 `REQUIRED_FILTERS` 不含 `loudnorm`，`scripts/stage-media-tools.js:10-21`；`anullsrc`/`amix`/`acrossfade` 在列）。AGENTS.md「Story2Video 媒体工具资源闭包」要求"打包前按锁校验编码器/滤镜、打包后真实检查"，所以引入 `loudnorm` 必须同时改锁 + 改 `before-pack` 校验 + 重打包实测，那是另一条混合 PR 的体量。
   替代方案（写死，不许临场发挥）：**同一期内所有块使用逐字相同的 `voiceId / rate / pitch / audio_format` 参数**，块间衔接用 `concat=n=N:v=0:a=1`（已验证的 `aac` 编码路径），不做归一、也不做跨块音量补偿。
   后果必须如实写进 §13：**跨 provider 降级时各块响度可能不一致**，本期接受这个不一致，不接受「为了归一而去碰未验证的滤镜」。

#### 7.4.1 数据源与真源（刀 4 只换数据来源，不换手柄）

| 项 | 值 | 判据与后果 |
|---|---|---|
| 文案真源 | 渲染层 settings 键 `copy_library_rewrites`（`src/composables/useCopyLibrary.js:23`，上限 200 条 :29） | 主进程**没有** copy service（已搜 `copy_library_rewrites` 于 `apps/desktop/electron` = 0 命中）。因此刀 4 的入参必须把**正文本体**传进主进程，不能只传 id——只传 id 等于要求主进程去读渲染层 settings，那是第二个真源 |
| 记录字段 | `{id, fromKey, fromTitle, title, content, wordCount, platform, sourceUrl, createdAt}`（:159-170） | 只有 `content` 与 `title` 参与出期；`platform` **不得**影响口语化 prompt（同一份文案出期与发布到哪个平台无关） |
| 分段结构 | `content` 只 `trim()` 首尾，内部换行原样保留（:151），显示端 `white-space: pre-line`（`CopyLibraryView.vue:312`） | ⛔ 分块逻辑**禁止**压缩空白：`\s+ → ' '` 会把语义换行一起压掉（AGENTS.md「文本空白归一化 MUST NOT」+ `readable-text.js:139-143` 的 `[^\S\n]+` 唯一口径）。段落边界就是 `\n` |
| 改写链 | `rewrite-handoff.js:23` 的 `{content 必填, title, platform, sourceUrl, fromKey, fromTitle}` | RewriteView 入口沿用该形状，不在刀 4 另造第二种 handoff |

##### 7.4.1.1 音色解析层已落地（2026-10-11，刀 4 第 3 片·上半）

**唯一实现**：`apps/desktop/electron/services/podcast-tts-voice.js` 的 `resolveEpisodeVoice(input)`（纯函数，不 require 任何网络/provider 代码，读偏好与 capability 由调用方注入）。

| 项 | 落地口径 | 少了它会怎样 |
|---|---|---|
| 回退顺序 | ① 频道 `voiceRef` → ② 用户偏好 → ③ capability 的 `defaultVoiceId` → ④ 全空即**拒绝出期** | 猜「provider 的第一个音色」会让同一频道在不同机器解析出不同音色，而 feed 一旦挂上就是对外可见的错 |
| 键名归一 | 频道真源存 `providerId`，本层归一后交 `voiceRefIssues` 判三段；同时接受历史别名 `provider` | 不归一会把「三段齐备但键名叫 providerId」的合法配置判成半配置，**每个正常配置过音色的频道都出不了期** |
| 码表单点 | 半配置与三层全空**共用** `TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE`（其值即用户可见的 `PODCAST_TTS_VOICE_UNRESOLVED`），层间区分靠 `issues[].path`：`voiceRef` / `voice` / `voice.preference` / `voice.capability` | 每层各造一个码会在 locale 里堆无人维护的文案键，而两层的处置对用户是同一句话 |
| 「读异常」≠「没配」 | 偏好或 capability **抛异常**时直接拒绝并出声（`warn`），不得静默降级到下一层；对照组：返回 `null` 才继续回退 | 把一次存储异常变成「系统替你换了个人说话」，且用户在界面上看不出来 |
| 空值不算命中 | 偏好记录存在但 `voiceId` 为空串/纯空白 ⇒ 按没配处理，继续回退（对象形状 `{voiceId}` 与裸字符串形状都支持，覆盖 store 的两种历史形状） | 把空值当命中会让下一层永远点不到，表现为「配过偏好的人反而解析失败」 |
| 无默认 provider | 拿不到 `defaultProvider` 的 providerId+model 时**②③ 无定位键**，直接拒绝且两个读取实现一次都不被调用 | 「随便挑一个 provider」等于把解析结果绑到 provider 列表的顺序上 |
| 注入缺失 | `readPreference` / `getCapability` 任一缺失 ⇒ `PODCAST_EPISODE_INVALID`，且发生在任何读取之前 | 缺依赖时降级成"少一层回退"会让半成品在生产路径上静默生效 |

**显示项 3 的数据来源（§7.4.6 的三态来源标注）**：本层返回 `origin ∈ {channel, preference, providerDefault}` 与 `resolvedBy`（形如 `preference:openai-tts/tts-1`）。渲染层必须按 `origin` 选文案键 `podcast.tts.voice.channel` / `.preference` / `.providerDefault`，措辞要让用户区分「我配的」与「系统替我选的」。**这三条 locale 键与浮层接线属第 3 片下半**（同下半还须把 `podcast-tts-compose.js` 加回 `src/locales/podcast-error-codes.test.js` 的 PRODUCERS 并补 4 组 zh/en 成对文案，见 tasks.md 的 MUST 行）。

**锁**：`podcast-tts-voice.test.js` 16 条——含「①命中时两个读取实现调用数必须为 0」（顺序判据用调用计数而非返回形状）、「半配置不得往下走」、「异常与没配结果必须不同（成对用例）」、三条**注入真 `tts-voice-catalog.getVoiceCapability`** 的跨模块契约锁（`openai-tts/tts-1 → alloy`；`elevenlabs → defaultVoiceId 为 null` 必须拒绝；未知 provider 不算命中），以及一条「本层源码不得出现第二个 `PODCAST_*` 字面量码」的码表单点结构锁。
#### 7.4.2 流程（相位与手柄）

手柄仍是 `podcast-episode-publish.js` 的闭集 `PHASES`（:29-32）与 `CANCELABLE_UNTIL='uploadAudio'`。刀 4 **只在 `extractMix` 这一站换一个实现**（`synthesizeEpisodeAudio` 取代 `extractEpisodeAudio`），`probe` 及其之后逐字复用。结构锁（PRD §8 ⑪）的口径是：**改相位枚举必须与逐格结果态测试同 PR**；刀 4 不改枚举，改的是注入实现。

```
pickChannel → colloquialize → chunk → ttsBlock(逐块，串行) → concatBlocks → probe → uploadAudio → attach → buildFeed → uploadFeed
              └──────────── 这一段是 extractMix 的等价替身 ────────────┘
```

1. `colloquialize`：**新建独立 prompt**，不复用 `rewrite-engine` 的去 AI 味链路（语义不同：那是"读起来像人写的"，这是"听起来像人说的"）。输出必须保持输入的分段结构（AGENTS.md「后处理结构不变量」：不得改换行/分段、终止标点原样、段尾无标点不得追加）。
2. `chunk`：块上限取 **2000 码点**（不是 provider 的 4000 字符——`asset-generator.js:1031` 是 `slice(0, 4000)` 的**静默截断**，整篇喂进去超 4000 就直接丢内容且**不报错**，这是本刀最大的静默失真风险）。块边界只允许落在段落（`\n`）或句末终止标点（。！？；…），不得在句中断开；单段本身超上限时按句号再切，仍无句号则**拒绝出期**（`PODCAST_TTS_CHUNK_UNSAFE`）而不是硬切——硬切会把一句话读成两截。（**该上限只可下调不可上调**：调用方传入更大的值会被钳回 2000——抬高它等于把本条要防的 provider 静默截断重新打开，2026-10-11 按 QM-6 前端评审补上）
3. `ttsBlock`：唯一出口是 `AssetGenerator.generateTTS(text, opts)`（`asset-generator.js:1009`），**禁止**直接调 adapter 的 `synthesize`（各家入参键名不同：minimax `text/voice/speed`、openai `input/voice/response_format`、google `text/speakingRate`，见 `adapters/*-tts.js`；这正是 AGENTS.md「适配器入参键必须与调用方契约键一致」那条事故的同族）。返回取 `data.path`（本地文件路径，:1095-1107）。
   - 逐块**串行**，每块 `withAssetTransientRetry` 语义沿用 Story2Video 的 `maxAttempts=3` / 限流 `4` 次（`story2video-stages.js:1402-1424`）；并发留空是刻意的（多数 TTS provider 按并发计费/限流，且并发会把"哪一块坏了"变成竞态）。
   - 每块产出的 `degraded` 标记必须逐块记账：`generateTTS` 的三级降级最终会返回 `anullsrc` 生成的 **3 秒静音并带 `degraded:true`**（:1224,1320-1332,1346）。
4. `concatBlocks`：`concat=n=N:v=0:a=1` 的既有路径（`story2video-compose-engine.js:1514,1524-1530`），块间显式插入 **0.3–0.6 s** 静音——仓内**现成做法是"块间不加静音"**（§7.4.0 取证），所以这里的静音必须由**预先物化的静音片段**参与 concat（用已验证的 `anullsrc` 生成一份基准静音，再按块数复制），**不得**用 `adelay`（不在 `REQUIRED_FILTERS`）。
5. `probe` 及之后逐字复用刀 3：ffprobe 实测 `durationSec`/`sizeBytes` → 显式 `mime` → 三处一致校验 → attach（strict）→ buildFeed → uploadFeed。**`degraded:true` 的素材永远进不到 probe**：降级门禁在 `podcast-episode-source.js:53` 已经只认 `audioMeta.degraded === true`，刀 4 必须把逐块 degraded 汇成同一条判据（展示端同源 `ResultView.vue:652`），命中即整次拒绝、不上传。

##### 7.4.2.1 口语化层已落地（2026-10-11，刀 4 第 3 片·下半 上）

**唯一实现**：`apps/desktop/electron/services/podcast-tts-colloquialize.js`（零依赖纯函数，`require` 列表为空）。

| 项 | 落地口径 | 少了它会怎样 |
|---|---|---|
| 与去 AI 味的边界 | **独立 prompt**（`SYSTEM_PROMPT` 单点常量），不复用 `rewrite-engine` 链路 | 那是「读起来像人写的」，本层要「听起来像人说的」；复用会把改写边界与分段约束一起带错 |
| 分段结构不变量 | **段的定义全链只有一个：单个换行**（与下游分块层的切分逐字同口径；prompt 第 1 条也照这个说「不得增加、删除、合并任何换行」，不再写「空行分段」——2026-10-11 QM-6 后端 F1 命中：判据引用的口径与自己实现不是同一件事，会把模型忠实守约的合法重排整份白拒）。采用前逐条判：段数相等、空段位置保持、**每段最后一个非空白字符逐字相同** | 结构一变，下游 `planChunks` 的段落边界（`\n`）就是错的——块会在句中断开、段尾被追加标点，而听感问题不会在任何日志里留下痕迹 |
| 单条判据取代两份标点表 | 用「末字符逐字相同」一条同时覆盖补标点 / 换标点 / 删标点三种失真，**不**再抄一份终止标点集合 | 两份集合只更新其一时，一次口径改动牵动两层（同仓「同一决策的两端写在两个文件」事故族） |
| 失败方向 = 旁路 | 无 provider、调用异常、空返回、结构不合格 ⇒ **采用原文**并出声（warn 一次，不含用户正文） | 把可选增强做成出期的硬前提，等于让一个不影响正确性的环节决定用户能否发布；原文本身是合法口播 |
| 计费前置 | `enabled=false` 时**一个 LLM 调用都不发起**（锁断言 invoke 未被调用） | 「调了再丢结果」会在用户没要求改写时照样产生 provider 计费 |
| 围栏剥壳 | 只处理「整份输出被 ``` 包住」这一形态，剥壳后仍按原行数比对 | 局部清洗会把正文里合法的三反引号代码引用吃掉；不剥壳则围栏会被当成一个段落念出来 |
| 非字符串返回 | 对象 / undefined / 数字 一律按空处理 | 把 `[object Object]` 喂进分块层会静默产出一期只念占位符的节目 |
| 字段边界 | `buildColloquializePrompt` **只接受 title 与 content**；源码扫描断言 prompt 构造函数不含 `platform` | §7.4.1 明写「同一份文案出期与发布到哪个平台无关」；把 platform 混进 prompt 会让同内容在不同平台出不同期 |
| 出站 | 本层不 require 任何网络/provider 代码，调用通道由宿主注入（宿主绑定 `ai-generator` 的 `chatCompletion`） | 每层各自出站就无法统一超时与计费口径；测试里也会出现真实出站 |

**超时归属**（写明以免下一位重复实现）：口语化的硬超时由**注入侧**（宿主绑定 `chatCompletion` 时）负责，本层不再套第二层超时——两层预算相乘会让一次抖动耗尽整条链的窗口。

**尚未接线**：本层目前只有实现与锁，`podcast-episode-host.js` 仍走「正文直接进 `planChunks`」。host 注入替换（`colloquialize → synthesizeEpisodeAudio`）、三态来源标注的 locale 键（`podcast.tts.voice.*`）、以及把 `podcast-tts-compose.js` 回接 `src/locales/podcast-error-codes.test.js` 的 PRODUCERS，均在同一片的下一节（宿主接线）一并交付。**这是刻意的切片边界，不是遗漏。**
#### 7.4.3 数据校验三层（与 §6.4 同构，逐层给出「少了它会怎样」）

| 层 | 判据 | 少掉的后果 |
|---|---|---|
| ① 入参形状（主进程入口，任何出站之前） | `channelId` 非空且过 `CHANNEL_ID_RE`；`copy.content` 非空且 ≥ 80 码点（短于这个数不可能是一期）；`title` 非空且 ≤ 200 码点（与刀 3 同一 `TITLE_MAX_CODEPOINTS`）；`runId` 形态 8–64 `[A-Za-z0-9_-]`；`voiceRef` 三段同存或同缺 | 空正文会产出一期「纯静音 + 标题」的对外可见单集；缺 `runId` 形态判据等于让渲染层决定主进程往哪写文件 |
| ② 素材与实测 | 逐块 `degraded` 汇总门禁 → 拼接后文件 `existsSync` → ffprobe 实测 `durationSec > 0` 且 `sizeBytes` 与 `stat` 一致 → **总时长 ≥ 块数 × 单块最短时长下限**（防「每块都被替换成 3 秒静音」这种全降级形态） | 只看 `code === 0` 会把静音当成功；只比 stat 会放过 concat 中途截断 |
| ③ 落盘前预校验 | 打在**合并结果**上（读 `list[index]` → 按同一合并语义 merge → `validateEpisode(merged)`），与刀 3 §6.4 第 3 层逐字同实现，不得第二份 | 不合格字段一旦进 feed 就是对外可见的坏数据，且 guid 幂等合并会把它留在原地 |

#### 7.4.4 交互逻辑

- 入口两枚（与刀 3 同一浮层、同一状态机）：`CopyLibraryView.vue` 的单条记录操作区、`RewriteView.vue` 的改写结果区；`Publish.vue` 的文本类分支同样复用（§7 刀 5 的入口判据不变）。
- 浮层仍是应用级模态 ⇒ 必须经 `useEmbeddedViewSuspension` 挂起内嵌视图并在 `overlay-view-suspension.test.js` 登记 owner（AGENTS.md 浮层互斥合同）。
- **关闭浮层不取消本次合成**：链在主进程，跨 await 的中间态由主进程收尾——这句必须显示在界面上。
- 取消窗口：**`uploadAudio` 之前**全程可取消（比刀 3 更宽——TTS 逐块串行，块与块之间天然是安全取消点；已产出的块文件留在 run 目录里由宿主统一删除，无远端对象，所以回滚是纯本地的）。取消判据仍只有一份（`cancellableAt`），界面不得自己猜相位。
- 块级失败的用户侧出口只有两个：**重试整期** 或 **放弃**。不提供"跳过坏块继续"——那会产出一期内容缺失且听感突兀的节目对外发布（与 §7.4.2 第 3 条的 fail-closed 同源，也不同于 `localization-stages.js:305` 那种"跳过缺失段"的既有做法：那是给视频配音、不改变对外契约的东西；播客 feed 是对外长期可见的）。

#### 7.4.5 显示项（浮层内，逐项给出处）

1. 进度：`已完成块数 / 总块数`（总块数在 `chunk` 结束时才确定，之前显示"正在分段…"，**不得**先猜一个总数再改口——数字会变的东西被用户当作进度谎言）。
2. 逐块累计时长（来自每块 ffprobe 实测，不来自 provider 申报值；申报值与本仓「不得用申报值代替实测」纪律冲突）。
3. 音色来源标注：`频道配置` / `沿用上次选择` / `provider 内置默认` 三态之一（对应 §7.4.0 的 ①②③，未配置直接拒绝时不显示本项）。
4. 结果三态各一句话（success / partial / cancelled，语义与 §6.4 逐字一致；success 必须含「聚合端下次抓取后生效（通常数小时至数天）」，**禁止**写"已即时生效"）。
5. 拒绝态必须点名成因类别：素材太短 / 分段不安全 / 某块降级为静音（列出块号）/ 音色无法解析 / provider 全部失败——五类不得合并成"合成失败"。

#### 7.4.6 提示文字（逐字键清单；文案本体在第 4 片与 locales 同 PR 落地）

⛔ 与刀 3 同一条纪律：**唯一消费点存在之前不得把键写进 locales**（AGENTS.md 禁止死键）。本片先落键名与语义，值在实现片成对补齐并跑 Gate 7（`check-locale-sync --pair-base`）与术语锁（`src/i18n/glossary.test.js`）。

| 键 | 触发 | 语义要点（zh） |
|---|---|---|
| `podcast.tts.blocksProgress` | 合成中 | 「已合成 {done} / {total} 段」 |
| `podcast.tts.blocking` | 总块数未定 | 「正在分段…」 |
| `podcast.tts.durationSoFar` | 合成中 | 「累计时长 {duration}」 |
| `podcast.tts.voice.channel` / `.preference` / `.providerDefault` | 显示项 3 | 三态来源标注，措辞必须让用户能区分"我配的"与"系统替我选的" |
| `podcast.errors.PODCAST_TTS_VOICE_UNRESOLVED` | ①层 | 无法确定音色，已停止（不猜音色） |
| `podcast.errors.PODCAST_TTS_COPY_TOO_SHORT` | ①层 | 正文过短，不足以成为一期 |
| `podcast.errors.PODCAST_TTS_CHUNK_UNSAFE` | chunk | 分段边界不安全（无句号可切），已停止而非硬切 |
| `podcast.errors.PODCAST_TTS_CHUNK_DEGRADED` | ②层 | 第 {blocks} 段被替换为静音，已阻止上传（是素材不可用，不是生成失败） |
| `podcast.errors.PODCAST_TTS_ALL_FAILED` | ②层 | 所有段都未取回可用音频 |
| `podcast.tts.cancelHint` | 浮层 | 关闭本窗口不会停止合成；停止请点击"取消出期" |
| `podcast.tts.cancelTooLate` | 取消 | 说明**为什么**不能取消（已进入上传，会留下半态） |

#### 7.4.7 第 2 块实做落点与一处合同偏离（2026-10-11）

落点：`apps/desktop/electron/services/podcast-episode-synth.js` 的 `synthesizeEpisodeAudio`，它是 §7.4.2 里
`extractMix` 的等价替身，返回形状与 `extractEpisodeAudio` 逐字同构（`{outPath, durationSec, sizeBytes, mime}`，三个量都是实测）。
五条实现口径：① 逐块**串行**且**不再套第二层重试**（重试归 `generateTTS` 的 `withAssetTransientRetry`，两层相乘会把一次抖动放大成数十次真实调用）；
② 每块只认 `degraded === true` 这一个事实源，命中即**拦在 probe 之前**并逐块列出块号（`PODCAST_TTS_CHUNK_DEGRADED`）；
③ 块级失败没有「跳过坏块继续」出口（`PODCAST_TTS_BLOCK_FAILED` 与 `PODCAST_TTS_ALL_FAILED` 是两个码，排查方向不同）；
④ 块间静音 `gapSec` 闭集 `[0.3,0.6]`，越界**出声钳制**，`0` 也按"仓内既有不加静音"的形态出声纠正——它不是用户可表达的意图；
⑤ 取消点落在块与块之间（`cancelToken` 在每个块前采样），取消不拼接、已产出的块文件由宿主统一清理。

**一处偏离（按本节规矩点名，先改规格再改代码）**：§7.4.3 第 ② 层原句「总时长 ≥ 块数 × 单块最短时长下限」若按字面取
`块数 × 3s`（3s 正是降级静音的长度），会把「10 块、每块合法 1 秒」的正常口播整期误拒——那是把**防降级**的下限写成了**内容长度**的下限。
现改为按码点推导：`durationSec >= 总码点数 × MIN_SEC_PER_CODEPOINT(0.1)`，即约 10 码点/秒——常态口播（4-5 码点/秒）的两倍宽余量，只有"整段被静音替换 / 严重截断"这种连 10 字/秒都达不到的形状才会命中（2026-10-11 QM-6 后端评审以 Warning 命中后由 0.2 下调；0.2 恰等于常态语速上界，念得快的合法整期会被误杀），
只能抓到「整段被静音替换」而不误杀短块；防"每块都是 3 秒静音"这一原始目的由第 ② 条的 `degraded` 逐块门禁承担。
两条各管一件事，合成一条固定 `×3s` 反而两头都不准。回归锁见 `podcast-episode-synth.test.js`「时长按码点下限拦…但不得误杀合法的短块」。
### 刀 5 入口收敛
刀 3 已建好的 `<PodcastPublishAction>` 挂到 `CopyLibraryView.vue:174`、`RewriteView.vue:812`、`Publish.vue:358`（采集页仅文本类分支）。**不放**：`HotTopics`、`KeywordMonitor`、`PublishHistory:764`（重发会带同 guid 原地覆盖正在播那期）、`Home`/`FirstRun`（裸跳转无内容）、`FilmEngineering`（本页无发布挂载点）。

---

### 7.9 存量 `mime` 一次性固化（tasks 4.4 合同，2026-10-12）

> **这一节是合同，不是实现**。落代码的那一片必须按本节做，任何偏离先改本节再改代码，
> 不得在实现里另立口径。写本合同的原因：§7.6 的严格校验与 `compliance` 标记上线后，
> **存量单集**（早于严格校验写入 `episodes.json` 的记录）会被整批读成「不合规」，
> 用户看到的是自己的老节目一夜之间全部 blocked——那是把校验的代价转嫁给历史数据。

#### 7.9.1 事实前提（先量再写）

- 真源是 `<userData>/podcast/channels/<channelId>/episodes.json`（按频道一份），
  `index.json` 只存频道目录与托管配置，**不存单集**。
- 一条单集的 `mime` 合法集只有两个值：`audio/mpeg`、`audio/mp4`（与 §7.4 抽取层的
  编码器→容器映射逐字同源，唯一实现是 `podcast-episode-source.js` 的编码计划表；
  本节**不得**新增第三种容器，也不得另写一份判据）。
- 存量脏值的**成因有两类且处置不同**，必须先分清：
  ① **缺席**（字段从未写过，历史版本没有这个键）；② **非法**（写过的值不在合法集里，
  例如空串、`audio/mp3`、大小写漂移、带参数 `audio/mpeg;codecs=mpeg3`）。

#### 7.9.2 固化动作（一次性、幂等、只补不改）

- **触发与次数**：与 `index.json` 的 legacy 迁移同一范式——首个需要频道单集数据的调用触发，
  恰好一次（进程内内存位 + 落盘标记 `stockStamp` 双保险）。重复启动不得二次改写。
- **派生规则（唯一判据，按优先级）**：
  1. `mime` 已在合法集内 ⇒ **原样保留，一个字节都不改**；
  2. 缺席或非法 ⇒ 由该期 `enclosureUrl`（无则 `localPath`）的**扩展名**派生：
     `.mp3` ⇒ `audio/mpeg`；`.m4a`/`.aac` ⇒ `audio/mp4`；
  3. 扩展名不在表内 / URL 与本地路径都拿不到 ⇒ **不猜、不填**，保持原状并计入 `unresolved`。
- **标记**：凡本次被派生填上的记录写 `mimeSource: "stock"`；原本合法不动的写 `mimeSource: "measured"`（或保持缺席，
  二者择一并在锁里钉死，禁止同一份库里两种写法并存）。
- **`index.json` 侧**：写 `stockStamp = { at, channels, scanned, filled, unresolved }`（计数必须是本次实测）。
- **不得整体判死**：固化后，`compliance` 对**存量**记录只报「存量沿用，未再校验」这一档，
  **不得**输出 `blocked`；新增/重写路径仍走 §7.6 严格校验（严格性不因存量而放宽）。
- **只补不改的硬界**：固化**不得**触碰 `title`/`guid`/`pubDate`/`url` 等业务字段，也不得重排数组顺序、
  不得改动键序（键序变化会把一次补字段伪装成整文件重写，并让并发写者读到错位快照）。

#### 7.9.3 数据校验与失败语义

| 情形 | 处置 | 出声 |
| --- | --- | --- |
| 某频道 `episodes.json` 读不出/解析失败 | 跳过该频道，其余照常；该频道计入 `unresolvedChannels` | `warn`（不冒泡） |
| 写盘失败（含 Windows 短暂 delete-share） | 走既有 rename 有界退避；超预算 ⇒ **放弃本次固化并保留原文件**，`stockStamp` 不写（下次启动可重试） | `warn` |
| 扩展名派生出合法值但与该期 `durationSec` 明显矛盾 | 仍按派生填（本节不引入跨字段推断），仅在 `compliance` 里如实标「存量」 | 不额外出声 |
| 同一频道被两个写者同时打开 | 固化必须走**按 `channelId` 的串行锁**（§7.7 同一把锁），不得为它新造第二把 | — |
| 已完成固化（`stockStamp` 在位）后又改动代码重跑 | 幂等：不重复填、不重复计数、不追加第二个 `stockStamp` | — |

#### 7.9.4 交互逻辑与显示项

- 固化对用户**透明**：不弹窗、不请求确认（它不改任何用户可见语义，只把「未填」变「按事实派生」）。
- `episode:list` 每期的 `compliance` 新增一档取值 `stock`（存量沿用），与既有 `ok` / 具体不合规原因并列；
  **禁止**用一个笼统的 `blocked` 涵盖存量。
- 频道页显示固化摘要（仅当 `stockStamp` 存在）：`扫描 N 期 · 补齐 M 期 · 待人工 K 期`。
  `K`（unresolved）为 0 时不显示「待人工」这一段，避免制造不存在的待办。

**提示文字（zh / en 成对，落 `locales/podcast/{zh,en}.js`，由实现片一次性写全）**：

| 键 | zh | en |
| --- | --- | --- |
| `podcast.stock.freezeSummary` | `存量音频信息已补齐：扫描 {scanned} 期，补齐 {filled} 期` | `Legacy audio metadata frozen: scanned {scanned}, filled {filled}` |
| `podcast.stock.unresolved` | `{count} 期无法判定音频类型，需重新生成` | `{count} episodes could not be typed; regenerate to resolve` |
| `podcast.compliance.stock` | `存量沿用（未重新校验）` | `Legacy value kept (not re-validated)` |

术语与 `01-docs/i18n-glossary.md` 对齐：「存量」不得写成「历史数据/旧数据」混用；
改词典必须同 PR 跑 `apps/desktop/src/i18n/glossary.test.js`（键级成对锁覆盖不到术语成对）。

#### 7.9.5 实现片必须带的回归锁（缺一条即不算落地）

1. **真库往返**：`os.tmpdir()` 建真实 `episodes.json`，先写入含脏值的存量，跑固化，
   **关闭再重开同一文件**读回断言（不接受「夹具按类型原样回吐」——见 AGENTS 落盘读回条）。
2. **幂等**：连跑两次，第二次的 `filled` 必须为 0 且文件字节不变。
3. **只补不改**：合法 `mime` 那一期在两次快照中逐字段相同（含键序）；变异「对合法值也重写」必须变红。
4. **不得整体判死**：固化后 `compliance` 中 `blocked` 计数为 0，而 `stock` 计数 = 派生成功数。
5. **不猜**：扩展名派生不出的那期保持原状且计入 `unresolved`；变异「缺失即填 audio/mpeg」必须变红。
6. **跨层同结论**：固化用的容器判据必须 `require` 抽取层那一份编码计划表（结构锁：本文件内
   不得出现第二份 `audio/mpeg` 字面量集合），否则两层会在新增容器时漂移。
7. **单例接缝**：若固化经模块级内存位判「恰好一次」，测试必须经被测对象的公开出口观察，
   不得 `import` 该单例（vitest 下与生产 `require` 是两份实例，会恒假绿）。

#### 7.9.6 本节故意不做的

- 不做「重新下载/重探测」来回填 `durationSec`/`sizeBytes`（那是另一刀，且会引入真实出站）。
- 不删除、不合并存量重复期（判据不足，删除不可恢复）。
- 不把固化结果同步到云端账号镜像（§账号云同步只镜像凭证与账号元信息，与单集无关）。

## 8. 状态机、交互逻辑、显示项

**相位闭集（结构锁⑪：变更必须与 §5.2 矩阵逐格测试同 PR，且断言规模下界）**：
`pickChannel → extractMix → probe → uploadAudio → attach → buildFeed → uploadFeed`，外加 `cancelled`。

**交互**：
- 入口收在各页既有"发布"动作的**次级项** ⇒ 默认态不改一个像素（否则 6 页 × 浅/暗 = 12 张基线漂移）。
- 浮层为应用级模态 ⇒ 必须经 `useEmbeddedViewSuspension` 挂起/恢复内嵌视图，并在 `overlay-view-suspension.test.js` 登记 owner；释放必须穷尽（`watch(visible)` false 分支 + `onBeforeUnmount` 兜底）。
- **取消按相位**：`uploadAudio` 之前任一相位可取消（零出站零计费）；之后不可取消并明示原因；关闭浮层**不**取消（浮层内明示）。
- `{cap,count}` 与迁移状态**每次发布动作发起前现算**，禁止跨动作缓存（行为锁⑦）。
- 崩溃/退出中断：启动时以 `feedSync.attemptedAt` 与 episodes 现状对账，**只提示不自动修复**。
- 处置迁移冲突是**不可逆**动作（一份留、一份丢），成功必须出声：`podcast.picker.migrationResolved` 走 `notifySuccess`。静默收口等于让用户以为没生效并重复点击。
- 手工写与发布在飞冲突时**立即拒绝不排队**（`podcast.errors.PODCAST_CHANNEL_BUSY`）：一键发布跨 await 可达分钟级，把同步的「保存单集」拖进等待队列只会让一次点击变成转圈超时。
- **按钮可用性就是交互契约**（`PodcastHostingCard` 逐条锁）：未配置托管时【测试连通】【清除已存凭证】禁用——两者的前置条件都是「已有一份可用凭证」，允许点击只会得到一个必然失败的请求；无活动频道时【发布本频道 Feed】禁用——发布是**频道动作**，全局凭证不足以确定目标对象 key；保存进行中三个动作全部禁用（`savingHosting`），防止把两份不同的表单态叠成一次覆盖写。
- **一次失败的三个承载面是分层，不是重复**（QM-6 前端评审 #2 判定）：toast＝本次动作结果（action result）、卡片内联＝本次结果的细节（`itemCount` / `backupCreated` / `prevExists`）、`feedSync` 横幅＝重启后仍成立的真源（durable status）。两级事实的分层见 §13 第 8 条，横幅与内联**不得**合并（合并就把「这次没发成」和「公网至今没更新」压成同一句话）。**已知的既有重复**是 toast 与内联都渲染 `podcast.hosting.publishFailed` 同一句带 `{status}` 的文案——该重复早于本片存在；判据记为「同一失败不得在两个承载面渲染逐字相同的文案」，收敛动作归刀 3 的发布状态机（它要同时改 toast 语义与相位文案），本片不动，以免在一次 docs 增量里同时改两条已被 QM-6 评审过的链路。
- **横幅与频道归属同进同退**（QM-6 前端评审 #1，Critical）：`feedSync` 必须随 `activeChannelId` 一起置 `null`。反例场景——频道 A 落 `failed`，用户切到从未发布的频道 B，若 A 的旧证据留着，横幅仍显示而重试按钮拿的已是 B 的 `channelId`，点下去就是**对错误目标的一次不可逆外发覆盖**（按 B 的当前单集重建 feed 并 PUT 覆盖 B 的公网主键）。读取失败同样保持 `null`：「本轮没读到」不是「还是上次那样」。清理动作落在页面域的 `onChannelActivated`（形状只有页面域知道），目录域经 `deps.onChannelActivated` 回调，不得自己引用页面态标识符——刀 1 拆分时正是这么写坏了切频道整条路径，详见 `01-docs/BUGFIX-PODCAST-CHANNEL-SWITCH-2026-10-11.md`。
- **重试按钮的语义是「重建」不是「重放」**（QM-6 前端评审 #3）：【按当前单集重新生成并上传 feed】复用同一条 `podcast:feed:publish`，行为＝按**当前**单集列表重建 `feed.xml` → 校验 → PUT 覆盖公网主键（另存时间戳副本与回滚点）→ 写 `feedSync`。若文案写成「只重试上传」，用户会以为自己在失败后新增/删除的单集不受影响，实际会被一并推上公网。重放陈旧字节同样是错的：那会让公网与本地真源长期不一致。
- **本期未接入的托管类型 `option disabled`**：`cos` 在输入层合法（保存时不丢用户已填的值），但落盘会被 `PODCAST_HOSTING_PROVIDER_UNSUPPORTED` 拒。做成「可选但点了必失败」等于给用户一个假出口；不可选 + `title` 说明理由，才能既保留已存值回显又不诱导误操作。
- **发布结果三态不压平**：`success` / `failed` / 其他（带码可见）三句话各不相同——`failed` 明示「公网 feed 未更新，本地 Feed 与已发布内容不受影响，可重试」，把「本地坏了」与「公网没跟上」两种排查方向混成一句会让用户反复点发布。`success` 时**额外**追加一条回滚点标注，且这条标注按**两种成因分两句**，不得合成一句：`prevExists && !backupCreated` → `backupMissing`（本地 `feed.xml` 存在过 ⇒ 上一版是有的，只是没存档到对象存储，云端没有可指回的副本）；`!prevExists` → `noPrevious`（该频道首次发布，本来就没有上一版，「无法退回」是错误归因）。把首次发布写成「未建立回滚点」，用户会去找一份不存在的旧 feed；把存档失败写成「首次发布」，用户会以为一切正常。两条都必须出现在 `success` 之后，不得被成功文案吃掉。
- **留空 = 沿用已存凭证**在渲染层的落法是**该字段根本不进 payload**（缺席与空串是两件事：空串会被落盘层判成覆写请求）。保存动作结束后无论成败都立刻清空表单里的 AK/SK——渲染层状态会进 DevTools 与错误上报，失败路径尤其不能把凭证留在里面。

**显示项**：频道切换器（名称 + `ch_` 短 id）、重命名入口（作用于当前频道，名称为空即前置拒绝并给 `podcast.picker.nameRequired`）、频道目录读取失败横幅（`data-testid="podcast-picker-list-error"`，走 `errorText(channelListError)`——该错误位此前无人渲染，等于「读目录失败时界面静默」）、迁移冲突横幅附**冲突文件名清单**（`data-testid="podcast-migration-files"`，取 `index.json` 的 `migrationConflicts`，用户要靠它判断该保留哪一份）、迁移状态横幅（conflict/error 各一句 + 处置按钮）、每期 `compliance` 徽标（手工路径保存后即时校验，只出声不阻断）、`feedSync` 横幅（`failed` / `partial` 时显示「公网 feed 尚未更新（<状态码或「部分同步」）」+ 【按当前单集重新生成并上传 feed】）、`backupCreated:false` 时标注「本次未建立回滚点」、hosted feed 公网地址标注「已提交地址，改路径会使订阅失效」、`cap` 计数与事前禁用。

**横幅判据**：横幅只认 `podcast:channel:get` 带回的 `feedSync.status ∈ {failed, partial}`，其余一律不显示——`success`、字段缺席、形状破坏（不是对象 / 未知 status）都不喊。写这条的原因见 §13 第 9 条：本条曾经只有写侧、没有读侧，是「写了盘就说用户看得见」的实例。状态码取值口径：`partial` 显示「部分同步」，`failed` 显示 `error.status`（HTTP 码），没有码时显示「无状态码」而不是留空。

**`status` 闭集与 `partial` 预留**：取值闭集 `{success, failed, partial}` 的唯一声明是 `apps/desktop/electron/services/podcast-channel-service.js` 的 `FEED_SYNC_STATUSES`；写侧字面量、读侧判据与 spec 声明三向对账由 `apps/desktop/electron/services/podcast-feed-sync-status.test.js` 强制，越界即红。`partial` **当前暂无生产写入者**（刀 2 的写侧只落 `failed` / `success`），它是刀 3 出期链的 durable 形态；读侧提前支持是为了让刀 3 不再二次触碰同一组文件与 zh/en 成对键。该预留由 spec 里的机器可读标记 `<!-- feedSync-status-reserved: partial -->` 逐字声明，**刀 3 真正写入 `partial` 时必须同 PR 把该值从标记里删掉**——否则对账锁把「声明」判成谎言并变红。

**显示项（刀 2 托管卡片新增）**：托管区标题与说明、配置态一行（已配置显示**掩码后的** AccessKeyId `***`+末 4 位；未配置显示「本地音频需先配置对象存储托管」这句带出口的提示）、六个输入项（托管类型 / Endpoint / Bucket / 路径前缀 / AccessKeyId / AccessKeySecret，其中 SK 是 `type=password` 且 `autocomplete=new-password`，AK 是 `autocomplete=off`——两者都绝不被浏览器代填，也不回显）、留空即沿用的占位提示、逐条校验问题清单（`data-testid="podcast-hosting-issues"`，来自 `issues[]`，不是只给一个错误码）、连通测试结果三态（`checked:false` 的「本轮未做真实探测」/ 成功 / 失败带 HTTP 状态码或「无状态码」）、发布结果三态与回滚点标注（`success` 下按成因二选一：`prevExists && !backupCreated` → `backupMissing`，`!prevExists` → `noPrevious`；`data-state` 供视觉与自动化用例取语义，文案不承载状态）。`data-state` 供视觉与自动化用例取语义，文案不承载状态）。

---

### 8.1 频道目录域、托管域与错误码的提示文字（逐字表，脚本生成）

> ⛔ 本节由 `node openspec/changes/podcast-oneclick-publish/tools/gen-picker-copy-table.js` 从 `apps/desktop/src/locales/podcast/{zh,en}.js` 解析生成，**改文案必须重新生成，不得手工维护**（手工抄录会被后续文案/术语改动打旧；判据同 `01-docs/PRD-PODCAST-RSS-CHANNEL-2026-10-09.md` §11.5）。脚本可重复执行：已有本节则整节替换。
> 取源路径随刀 2 的 locales 结构拆分一起迁移：播客命名空间现在住在 `locales/podcast/`，父文件 `locales/zh.js` 只剩一行 spread。**改这两处任一时先确认本脚本仍能解析出非空表**（解析不到即抛错，不产出空表）。

键路径 `podcast.picker.*`（19 键，zh/en 双向差集为空）：

| 键 | zh（界面逐字） | en |
| --- | --- | --- |
| `sectionTitle` | 播客频道 | Podcast channels |
| `current` | 当前频道 | Current channel |
| `empty` | 还没有频道，先新建一个。 | No channel yet. Create one to get started. |
| `namePlaceholder` | 频道名称 | Channel name |
| `create` | 新建频道 | New channel |
| `setDefault` | 设为默认频道 | Set as default |
| `rename` | 重命名当前频道 | Rename current channel |
| `created` | 频道已创建 | Channel created |
| `renamed` | 频道已重命名 | Channel renamed |
| `defaultSet` | 默认频道已更新 | Default channel updated |
| `switched` | 已切换频道 | Channel switched |
| `switchFailed` | 切换频道失败，请稍后重试。 | Could not switch channel. Please try again. |
| `nameRequired` | 请填写频道名称。 | Enter a channel name. |
| `quotaHint` | 该频道已收录 {count} 期，上限 {cap} 期；达到上限时须先删除旧期。 | This channel holds {count} of {cap} episodes; delete some before adding more. |
| `migrationConflict` | 频道数据迁移未完成：本地已有两份不同的频道配置，请选择保留哪一份。 | Channel migration is incomplete: two different local channel configs were found. Choose which to keep. |
| `migrationError` | 频道数据迁移中途失败，暂时无法写入；请重试或联系支持。 | Channel migration failed midway. Writing is blocked; please retry or contact support. |
| `keepExisting` | 保留当前数据 | Keep current data |
| `keepLegacy` | 保留原有数据 | Keep original data |
| `migrationResolved` | 迁移冲突已处理 | Migration conflict resolved |

键路径 `podcast.hosting.*`（32 键，zh/en 双向差集为空）。托管卡片 `PodcastHostingCard.vue` 的全部可见文案都在此命名空间；`configured` 带 `{key}` 参数，值是**掩码后的** AccessKeyId（`***` + 末 4 位），明文凭证从不出主进程：

| 键 | zh（界面逐字） | en |
| --- | --- | --- |
| `sectionTitle` | 对象存储托管 | Object storage hosting |
| `sectionHint` | 凭证全局一份，跨频道共用；发布时按频道写各自的 feed 路径。 | Credentials are stored once and shared across channels; publishing writes a feed path per channel. |
| `configured` | 已配置（AccessKeyId {key}） | Configured (AccessKeyId {key}) |
| `notConfigured` | 尚未配置托管：单集可以先生成 Feed，但公网 feed 还发不出去。 | Hosting not configured: you can still build the Feed, but it cannot be published yet. |
| `provider` | 托管类型 | Provider |
| `providerOss` | 阿里云 OSS | Aliyun OSS |
| `providerCos` | 腾讯云 COS（本期未接入） | Tencent COS (not supported this release) |
| `providerCosDisabled` | 本期只接了阿里云 OSS，COS 尚未实现，不可选 | Only Aliyun OSS is implemented this release, so COS cannot be selected |
| `endpoint` | Endpoint | Endpoint |
| `endpointPlaceholder` | 如 oss-cn-hangzhou.aliyuncs.com | e.g. oss-cn-hangzhou.aliyuncs.com |
| `bucket` | Bucket | Bucket |
| `pathPrefix` | 路径前缀 | Path prefix |
| `accessKeyId` | AccessKeyId | AccessKeyId |
| `accessKeySecret` | AccessKeySecret | AccessKeySecret |
| `secretKeepPlaceholder` | 留空 = 沿用已存的凭证 | Leave blank to keep the stored credential |
| `secretKeepHint` | 两项凭证留空即保持不变；只有重新填写才会覆写。Secret 不会回显，也不会出现在浏览器里。 | Blank credential fields keep what is already stored; only a re-entered value overwrites. The secret is never echoed back and never reaches the browser. |
| `save` | 保存托管配置 | Save hosting config |
| `check` | 测试连通 | Test connection |
| `publish` | 发布本频道 Feed | Publish this feed |
| `clearSecret` | 清除已存凭证 | Clear stored credential |
| `checkNotConfigured` | 尚未配置凭证，无法测试连通。 | No credential stored, cannot test connectivity. |
| `checkSkipped` | 本轮未做真实探测（默认不发出网络请求）；配置已保存，可在发布时验证。 | No live probe was made (no network by default); the config is saved and can be verified when publishing. |
| `checkOk` | 连通正常。 | Connectivity OK. |
| `checkFailed` | 连通失败（HTTP {status}）。 | Connectivity failed (HTTP {status}). |
| `checkNoStatus` | 无状态码 | no status |
| `publishSuccess` | 已发布：本次共 {count} 期已写入公网 feed，聚合端下次抓取后生效。 | Published: {count} episode(s) are now in the public feed; aggregators pick them up on the next crawl. |
| `publishFailed` | 公网 feed 未更新（{status}），本地 Feed 与已发布内容不受影响，可重试。 | Public feed not updated ({status}); the local feed and what is already published are unchanged. You can retry. |
| `backupMissing` | 注意：本次未能把上一版存档到对象存储，本地回滚点仍在，但云端没有可指回的副本。 | Note: the previous version could not be archived to object storage. The local rollback copy is still there, but there is no cloud copy to point back to. |
| `noPrevious` | 这是该频道首次发布，暂时还没有可退回的上一版。 | This is the first publish for this channel, so there is no previous version to roll back to yet. |
| `feedNotSynced` | 公网 feed 尚未更新（{status}），本地单集与已发布内容都不受影响。 | The public feed is not up to date ({status}). Your local episodes and what is already published are unaffected. |
| `feedPartial` | 部分同步 | partially synced |
| `retryFeed` | 按当前单集重新生成并上传 feed | Rebuild and upload the feed from current episodes |

键路径 `podcast.errors.*`（88 键）。渲染层按**领域码**取键：`toIpcError` 在失败信封里带 `subCode`，preload 原样透出，`usePodcastChannel.call()` 单点把 `code` 归一为领域码；未知码落 `fallback` 且**带码可见**（不得空白吞掉）。刀 2 新增的 8 个托管码必须成对入表，不得长期靠 `fallback` 兜着：

| 键 | zh（界面逐字） | en |
| --- | --- | --- |
| `PODCAST_IPC_UNAVAILABLE` | 播客服务暂不可用（未登录、许可证未激活，或主进程通道未挂载） | Podcast service is unavailable (not signed in, license not activated, or main-process channel not mounted) |
| `PODCAST_IPC_EXCEPTION` | 播客服务调用失败，请重试 | Podcast service call failed, please retry |
| `PODCAST_PAYLOAD_NOT_SERIALIZABLE` | 表单数据无法序列化，请检查后重试 | Form data could not be serialized, please check and retry |
| `PODCAST_FEED_INVALID` | Feed 校验未通过，请先按下列问题解决 | Feed validation failed. Fix the issues below first |
| `PODCAST_CHANNEL_ID_REQUIRED` | 未选择播客频道，请先在上方新建或选择一个频道 | No podcast channel selected. Create or pick one above first. |
| `PODCAST_CHANNEL_ID_INVALID` | 频道标识形态非法，请重新选择频道 | The channel id format is invalid. Please select the channel again. |
| `PODCAST_CHANNEL_NOT_FOUND` | 频道不存在，可能已被删除，请重新选择 | Channel not found, it may have been deleted. Please select another one. |
| `PODCAST_MIGRATION_CONFLICT` | 旧的播客频道数据与新建的频道内容不一致，已停止写入以免覆盖，请在上方选择保留哪一份 | The legacy podcast data and the new channel differ. Writes are blocked to avoid overwriting. Choose which copy to keep above. |
| `PODCAST_MIGRATION_IO_FAILED` | 播客频道数据迁移未完成，已停止写入，可重试；已有内容仍可读取 | Podcast channel migration did not finish. Writes are blocked; existing content stays readable and you can retry. |
| `PODCAST_MIGRATION_DIRECTION_INVALID` | 未知的迁移处置方式，请重新选择 | Unknown migration resolution. Please choose again. |
| `PODCAST_LOCK_WAIT_TIMEOUT` | 播客数据正在被其他操作占用，请稍后重试 | Podcast data is busy with another operation. Please retry shortly. |
| `PODCAST_CHANNEL_BUSY` | 该频道正在一键发布，请等本次发布结束后再修改单集 | This channel is publishing right now. Wait for it to finish before editing episodes. |
| `PODCAST_EPISODE_NOT_FOUND` | 单集不存在，可能已被删除，请刷新列表 | Episode not found, it may have been deleted. Refresh the list. |
| `PODCAST_HOSTING_REQUIRED` | 本地音频需先配置对象存储托管（当前支持阿里云 OSS） | Local audio files need object-storage hosting first (Aliyun OSS is supported today). |
| `PODCAST_HOSTING_INVALID` | 托管配置不合格，请按下方逐条修正 | Hosting configuration is invalid. Fix the items listed below. |
| `PODCAST_HOSTING_PREFIX_UNSAFE` | 路径前缀不得以 / 开头，也不得含 . 或 .. 段（否则发布路径会被改成另一个值） | The path prefix cannot start with / and cannot contain . or .. segments (they would silently rewrite the publish path). |
| `PODCAST_HOSTING_SECRET_MISSING` | 缺少 AccessKeyId / AccessKeySecret，且没有可复用的已存凭证，请重新填写一次 | AccessKeyId / AccessKeySecret is missing and there is no stored credential to reuse. Fill them in once more. |
| `PODCAST_HOSTING_CRYPTO_UNAVAILABLE` | 系统凭据保护不可用或被拒绝，凭证未能加密保存，已停止写入 | OS credential protection is unavailable or denied, so the secret was not encrypted. Saving stopped. |
| `PODCAST_HOSTING_IDENTITY_REQUIRED` | 当前登录态无法确定凭证归属，已阻止保存托管配置 | The current sign-in cannot be resolved as the owner, so hosting credentials were not saved. |
| `PODCAST_FEED_NOT_BUILT` | 该频道还没有可用的 Feed 产物，请先生成 Feed 再发布 | This channel has no usable feed file yet. Build the feed before publishing. |
| `PODCAST_HOSTING_UPLOAD_FAILED` | 上传到对象存储失败，本次发布未生效，请稍后重试或查看发布状态 | Upload to object storage failed. This publish did not take effect. Retry later or check the publish status. |
| `PODCAST_HOSTING_BODY_READ_FAILED` | 读取本地 Feed 文件失败，本次上传并未发出，请检查文件是否被占用或已被移动 | Reading the local feed file failed, so nothing was uploaded. Check whether the file is locked or has been moved. |
| `PODCAST_HOSTING_PROVIDER_INVALID` | 托管类型只能选阿里云 OSS | Hosting provider must be Aliyun OSS |
| `PODCAST_HOSTING_PROVIDER_UNSUPPORTED` | 该托管类型本期未接入，请改用阿里云 OSS，或为单集直接填写音频外链 | This hosting provider is not integrated yet. Switch to Aliyun OSS, or give the episode an audio direct link instead. |
| `PODCAST_HOSTING_ENDPOINT_REQUIRED` | Endpoint 不能为空（形如 oss-cn-hangzhou.aliyuncs.com） | Endpoint is required (e.g. oss-cn-hangzhou.aliyuncs.com) |
| `PODCAST_HOSTING_BUCKET_REQUIRED` | Bucket 名称不能为空 | Bucket name is required |
| `PODCAST_HOSTING_CREDENTIAL_REQUIRED` | AccessKeyId / AccessKeySecret 不能为空 | AccessKeyId / AccessKeySecret is required |
| `PODCAST_HOSTING_URL_UNRESOLVED` | 无法由 Endpoint 与 Bucket 拼出上传地址，请检查这两项是否写全 | The upload URL cannot be built from Endpoint and Bucket. Check that both are filled in. |
| `PODCAST_CHANNEL_INVALID` | 频道信息不完整，请按下方逐条修正 | Channel information is incomplete. Fix the items listed below. |
| `PODCAST_CHANNEL_NAME_REQUIRED` | 频道名称不能为空 | Channel name is required |
| `PODCAST_EPISODE_INVALID` | 单集信息不合法，请按下方逐条修正 | Episode data is invalid. Fix the items listed below. |
| `PODCAST_EPISODES_FULL` | 该频道单集数已达上限，请先删除不再需要的旧期再登记新的 | This channel reached its episode limit. Remove an old episode before adding a new one. |
| `PODCAST_INDEX_BUSY` | 频道目录正被其他操作占用，请稍后重试 | The channel catalog is busy with another operation. Try again shortly. |
| `PODCAST_STORE_CORRUPT` | 播客数据文件读不出来（可能已损坏），已停止写入以免扩大损坏 | The podcast data file cannot be read (it may be corrupted). Writing stopped to avoid making it worse. |
| `PODCAST_STORE_UNAVAILABLE` | 播客数据目录当前不可用（权限或磁盘问题），请稍后重试 | The podcast data directory is unavailable right now (permissions or disk). Try again later. |
| `CHANNEL_MISSING` | 缺少频道配置 | Channel configuration is missing |
| `CHANNEL_TITLE_REQUIRED` | 频道标题不能为空 | Channel title is required |
| `CHANNEL_TITLE_TOO_LONG` | 频道标题超出长度上限 | Channel title exceeds the length limit |
| `CHANNEL_DESC_REQUIRED` | 频道简介不能为空 | Channel description is required |
| `CHANNEL_DESC_TOO_LONG` | 频道简介超出长度上限 | Channel description exceeds the length limit |
| `CHANNEL_SUBTITLE_TOO_LONG` | 频道副标题超出长度上限 | Channel subtitle exceeds the length limit |
| `CHANNEL_LANGUAGE_INVALID` | 语言需形如 zh-CN / en-US | Language must look like zh-CN / en-US |
| `CHANNEL_COVER_REQUIRED` | 封面地址不能为空 | Cover URL is required |
| `CHANNEL_COVER_NOT_HTTPS` | 封面必须使用 https 绝对地址 | Cover must be an absolute https URL |
| `CHANNEL_COVER_SIZE_UNKNOWN` | 需填写封面尺寸（形如 3000x3000）以便校验 | Cover size (e.g. 3000x3000) is required for validation |
| `CHANNEL_COVER_NOT_SQUARE` | 封面必须为正方形 | Cover must be square |
| `CHANNEL_COVER_SIZE_OUT_OF_RANGE` | 封面边长超出允许范围（1400~3000） | Cover side length is out of the allowed range (1400–3000) |
| `CHANNEL_LINK_NOT_HTTPS` | 站点地址必须使用 https 绝对地址 | Site URL must be an absolute https URL |
| `CHANNEL_AUTHOR_REQUIRED` | 作者/主播名不能为空 | Author / host name is required |
| `CHANNEL_OWNER_EMAIL_INVALID` | 所有者邮箱格式不正确 | Owner email format is invalid |
| `CHANNEL_EXPLICIT_INVALID` | 频道分级取值不合法（yes/no/clean） | Channel rating must be yes / no / clean |
| `CHANNEL_FEED_TYPE_INVALID` | feed 类型取值不合法（episodic/serial） | Feed type must be episodic / serial |
| `CHANNEL_CATEGORY_REQUIRED` | 必须选择顶级分类 | A top-level category is required |
| `CHANNEL_CATEGORY_UNKNOWN` | 未知顶级分类 | Unknown top-level category |
| `CHANNEL_SUBCATEGORY_UNKNOWN` | 未知子分类 | Unknown subcategory |
| `CHANNEL_CATEGORY_TOO_DEEP` | 分类最多两级 | Category supports at most two levels |
| `EPISODE_MISSING` | 缺少单集数据 | Episode data is missing |
| `EPISODE_TITLE_REQUIRED` | 单集标题不能为空 | Episode title is required |
| `EPISODE_TITLE_TOO_LONG` | 单集标题超出长度上限 | Episode title exceeds the length limit |
| `EPISODE_DESC_TOO_LONG` | 单集简介超出长度上限 | Episode description exceeds the length limit |
| `EPISODE_SUBTITLE_TOO_LONG` | 单集副标题超出长度上限 | Episode subtitle exceeds the length limit |
| `EPISODE_AUDIO_REQUIRED` | 缺少音频地址：请填写 https 直链，或先配置托管直传 | Audio is missing: provide an https URL or configure hosting |
| `EPISODE_AUDIO_NOT_HTTPS` | 音频必须使用 https 绝对地址 | Audio must be an absolute https URL |
| `EPISODE_HOSTING_NOT_CONFIGURED` | 仅有本地文件，尚未配置托管直传，无法生成公开音频地址 | Only a local file exists; managed upload is not configured, so no public audio URL can be produced |
| `EPISODE_DURATION_INVALID` | 时长须为规定范围内的整数秒 | Duration must be an integer number of seconds within the allowed range |
| `EPISODE_SIZE_INVALID` | 字节数须为正整数 | Size in bytes must be a positive integer |
| `EPISODE_SIZE_REQUIRED` | 必须填写音频字节数（enclosure length） | Audio size in bytes (enclosure length) is required |
| `EPISODE_EXPLICIT_INVALID` | 单集分级取值不合法（yes/no/clean） | Episode rating must be yes / no / clean |
| `EPISODE_TYPE_INVALID` | 单集类型取值不合法（full/trailer/bonus） | Episode type must be full / trailer / bonus |
| `EPISODE_PUBDATE_INVALID` | 发布时间无法解析 | Publish date could not be parsed |
| `EPISODE_COVER_NOT_HTTPS` | 单集封面必须使用 https 绝对地址 | Episode cover must be an absolute https URL |
| `EPISODE_MIME_INVALID` | 音频 MIME 类型不受支持 | Audio MIME type is not supported |
| `EPISODE_GUID_TOO_LONG` | GUID 过长 | GUID is too long |
| `EPISODE_NUMBER_INVALID` | 期号须为正整数 | Episode number must be a positive integer |
| `EPISODE_SEASON_INVALID` | 季号须为正整数 | Season number must be a positive integer |
| `EPISODES_EMPTY` | 还没有单集：feed 至少需要一个单集 | No episodes yet: the feed requires at least one episode |
| `EPISODES_TOO_MANY` | 单集数量超过上限 | Episode count exceeds the limit |
| `EPISODE_DUPLICATE` | 存在重复的 guid 或音频地址 | Duplicate guid or audio URL exists |
| `FEED_NO_ITEMS` | Feed 中没有任何单集 | The feed contains no episodes |
| `FEED_MISSING_ITUNES_NS` | Feed 缺少 itunes 命名空间 | The feed is missing the itunes namespace |
| `FEED_MISSING_XML_DECL` | Feed 缺少 XML 声明 | The feed is missing the XML declaration |
| `ENCLOSURE_MISSING` | 存在缺少 enclosure 的单集 | An episode has no enclosure |
| `ENCLOSURE_NOT_HTTPS` | 存在非 https 的 enclosure | An enclosure is not an https URL |
| `ENCLOSURE_UNREACHABLE` | 音频地址不可达，请检查托管或直链是否过期 | Audio URL is unreachable; check the hosting or whether the link expired |
| `ENCLOSURE_TYPE_MISMATCH` | enclosure 指向的资源不是音频 | The enclosure does not point to an audio resource |
| `ENCLOSURE_LENGTH_MISMATCH` | 声明的字节数与实际大小不一致 | Declared byte size does not match the actual length |
| `DURATION_MISSING` | 有单集缺少时长 | An episode is missing its duration |
| `fallback` | 发生未知问题（{code}） | Unknown issue ({code}) |

成对校验：`node .github/scripts/check-locale-sync.js --pair-base origin/main` PASS；`apps/desktop/src/i18n/glossary.test.js` 绿（口径是 **UI 采用词典 canonical 术语**，不是把词典削到已有裸词）。


## 9. 数据校验（三层）

| 层 | 判据 | 备注 |
|---|---|---|
| 输入 | `validateChannel` / `validateEpisode`（白名单逐字不变，作用域限 `meta` 段）；`validateHosting` **直接复用** `podcast-hosting-upload.js:47`，禁止第二份 | 手工路径新增**保存后即时校验**（只出声不阻断） |
| 落盘 | registry 写前校验 `channelId` 形态与目录存在性；`writeHosting` 在**落盘这一站**清洗 `pathPrefix`（复用 `normalizePathPrefix` 唯一实现，拒绝 `..` 与前导 `/`）与 `endpoint`（剥协议与尾斜杠），不依赖刀 2 输入层（QM-6 评审 i6）；一键路径**预校验合并结果**（§7 刀 3 步骤 6） | 只校验传入对象会被合并语义放过旧脏字段（#24） |
| 出站 | `validateFeed` 前置于 `uploadFeed`（引擎 `buildFeed:269` 已内含）；不过即阻断，公网 feed 永不变脏 | `EPISODE_SIZE_REQUIRED`（`sizeBytes` 非空正整数）与时长整数判据在此层兜住 `length="NaN"` |

新增错误码（zh/en 成对 + 术语进 `i18n-glossary.md`；刀 1 已落 9 条：`PODCAST_CHANNEL_ID_REQUIRED`、`PODCAST_CHANNEL_ID_INVALID`、`PODCAST_CHANNEL_NOT_FOUND`、`PODCAST_MIGRATION_CONFLICT`、`PODCAST_MIGRATION_IO_FAILED`、`PODCAST_MIGRATION_DIRECTION_INVALID`、`PODCAST_LOCK_WAIT_TIMEOUT`、`PODCAST_CHANNEL_BUSY`、`PODCAST_EPISODE_NOT_FOUND`，其余随对应刀次落地时补齐）：`PODCAST_MIGRATION_IO_FAILED`、`EPISODE_MIME_UNDETERMINED`（`audioMimeFromUrl` 未命中改返回 `null`，默认回退仅留给存量一次性固化）、`PODCAST_AUDIO_DEGRADED_SOURCE`、`PODCAST_AUDIO_MEASURE_FAILED`、`PODCAST_CHANNEL_BUSY`、`PODCAST_INDEX_BUSY`、`PODCAST_CHANNEL_ID_INVALID`、`PODCAST_HOSTING_PREFIX_UNSAFE`（`pathPrefix` 不得空/不得以 `/` 开头/不得含 `..`）。

**刀 2 已落地的托管域码表（zh/en 成对，`podcast.errors.*` 单点解析）**：错误码 `PODCAST_HOSTING_REQUIRED`、`PODCAST_HOSTING_INVALID`、`PODCAST_HOSTING_SECRET_MISSING`、`PODCAST_HOSTING_CRYPTO_UNAVAILABLE`、`PODCAST_HOSTING_IDENTITY_REQUIRED`、`PODCAST_FEED_NOT_BUILT`、`PODCAST_HOSTING_UPLOAD_FAILED`、`PODCAST_HOSTING_BODY_READ_FAILED` 共 8 条；校验问题码（`issues[].code`，经 `issueText` 走同一张表）`PODCAST_HOSTING_PROVIDER_INVALID`、`PODCAST_HOSTING_PROVIDER_UNSUPPORTED`、`PODCAST_HOSTING_ENDPOINT_REQUIRED`、`PODCAST_HOSTING_BUCKET_REQUIRED`、`PODCAST_HOSTING_CREDENTIAL_REQUIRED`、`PODCAST_HOSTING_PREFIX_UNSAFE` 共 6 条。`PODCAST_HOSTING_PREFIX_UNSAFE` 的判据是**出声拒绝**而非静默清洗：落盘层的 `normalizePathPrefix` 仍是防逃逸的第二道闸（会把 `..` 段与前后斜杠去掉），但输入层跟着一起改写会让用户填的发布路径与真正生效的路径不是同一个东西——公网地址会变、已提交给聚合端的 Feed 会指错层。**不得有第二份 `validateHosting`**（§12 与结构锁⑫同口径）。**QM-6 前端评审把方向补全**：上面只写了「新码要有文案」，但真正的失效形态是反方向——主进程产出了码而 locale 里没有键，`issueText()` 落 `fallback` 把**裸码**显示给用户。因此除补 14 条成对文案（新增 `PODCAST_CHANNEL_INVALID`、`PODCAST_CHANNEL_NAME_REQUIRED`、`PODCAST_EPISODE_INVALID`、`PODCAST_EPISODES_FULL`、`PODCAST_INDEX_BUSY`、`PODCAST_STORE_CORRUPT`、`PODCAST_STORE_UNAVAILABLE` 等）之外，必须同时存在一道**反方向接线守卫** `apps/desktop/src/locales/podcast-error-codes.test.js`：以「主进程字符串字面量产出的码」为集合逐个查文案，例外表逐条写理由且只能缩小，并自带两条反滥用断言（例外表里的码必须仍在被产出；已配文案却仍挂例外即红）。同一轮还收掉一条同源风险：信封归一（`available` / `result` 形状 / `subCode` 优先）曾被抄成第二份实现在 `usePodcastHosting.call()` 里，现唯一实现是 `normalizeIpcEnvelope()`，并有结构锁断言「剥注释后 `subCode` 只允许出现在该函数那一行」——两份判据只更新其一时，症状正是「新增码显示成通用失败」，而两边单测都会绿。

---

## 10. 测试策略（含反证）

- **行为锁**：① partial 不报成功；② 摘 degraded 判定必红；③ 锁超时排队者不得补写；④ `validateFeed` 不过则 `uploadFeed` 一次都不被调用；⑤ `durationSec` 不得来自常量或 LLM 估计；⑥ **改名不得抹掉 `feedSync`**；⑦ **重启后 partial 横幅仍在** + 删除一期不刷新列表不得解除禁用；⑧ **旧脏字段 + 新合法对象 → 合并产物非法时不落盘**；⑨ **`issues[]` 逐条到达渲染层**（非仅错误码出现过）。每条配"把锁本身改成 no-op 必须立刻变红"的变异反证。
- **结构锁**：字面量注册、`envelope` thunk 负向、浮层 owner 登记、`channelId` 传递链单一实现、`validateHosting` 单一实现、⑩ 发布期内不二次读 hosting、⑪ 相位枚举与矩阵测试同 PR、⑫ `toIpcError` 白名单含 `PODCAST_FEED_INVALID` 且透传、⑬ 迁移判据唯一。
- **行为锁（QM-6 处置新增；每条都做过「把守卫改成 no-op 必须立刻变红」的变异）**：⑭ `endpoints:list` 在**不注入任何替身**的注册路径下也必须返回非空目录；⑮ 写入口只走 `assertChannelWritable`、读入口只走 `assertChannelExists`（按调用序列逐字断言，不是「源码里出现过某个方法名」）；⑯ 发布在飞时四个手工写入口一律 `PODCAST_CHANNEL_BUSY` 且**库里纹丝不动**，`end` 后立即恢复，别的频道不受影响；⑰ 冲突/硬失败在**首次** `listChannels()` 就返回 `migrationStatus`（不得第一次 reject、第二次才可读）。⑯⑰ 的夹具纪律：忙标记必须用 `require` 取——主进程全链 CJS，测试用 ESM `import` 会拿到另一份模块实例，该判据在这类夹具下结构性不可表示（本仓「双模块实例」同源事故）。

**刀 2 新增锁（⑱–㉓，每条都做了「把守卫改成 no-op 必须立刻变红」的变异，且各锁各自独立变红不互相掩盖）**：
- ⑱ **读流必须带 `error` 监听**：`createReadStream` 把 open 排进下一个 tick，`destroy()` 取消不掉它。于是「请求已返回、文件随后被删/被移动」时那次迟到的 open 会发出 `error` 事件，落到无人监听的流上 ⇒ **主进程 uncaughtException**（实测在托管用例的临时目录回收现场命中，症状是「测试全过、vitest 仍报 Errors」）。锁法是拿到注入的流后断言 listener 数 > 0，并直接对该流 emit error 断言不抛出。
- ⑲ **请求期内读体失败 ⇒ 即便对端回 2xx 也不得报成功**（新增码 `PODCAST_HOSTING_BODY_READ_FAILED`）。这是对「降级/占位产物不得冒充成功产物」在传输层的落点：2xx 只证明对端收了请求，不证明体真的读出来过。
- ⑳ **`clearSecret` 是 payload 里的标志位**，不是 IPC 的第二个参数（IPC 只传一个纯 JSON 对象），并且清除动作**不得**顺手把空串当新值提交。
- ㉑ **未接入的 provider 不可选**（`option` 带 `disabled`），合法前缀与留空不得被 ⑱ 之外的判据误伤——`validateHosting` 的正控与负控同批写。
- ㉒ **文案接线**：卡片断言取**真实 locale 值**（`zh.podcast.hosting.*`）而不是子串包含，因此 locales 拆成 `locales/podcast/` 后少写一行 spread 就会变红；`PodcastChannelView.vue` 模板确有 `@published` 绑定由组件测试直接读源码断言（R92：子组件 emit 存在、父方法存在、但缺绑定是编译期不可见的运行时静默失效）。
- ㉓ **发布结果形状**以 `feed:publish` handler 的返回体为准做契约断言（`state`/`backupCreated`/`itemCount`/`code`/`status` 平铺一层），夹具**不得替对方剥壳**——本仓同类事故（跨包信封、恢复收尾形状）的第三种形态是「夹具改形」，已按行为锁而非记录性断言写。
- **单元**：registry 真实 fs（`os.tmpdir()` 隔离）；assembler 注入假 tts/ffmpeg/ffprobe；hosting 注入假 client；guid 派生表含跨频道不撞车负例；迁移含**从非空 legacy 出发** + 幂等重跑 + 三态 + 硬失败。
- **视觉 QM-4**：新浮层用例浅 + 暗各一张，**必须同时登记 `views/all-views.visual.test.js` 的 `viewTests` 与 `scripts/run-pixel-tests.js` 的 `pixelTests`（:10-55）**，通过证据 = CI 日志该用例名出现次数 > 0；首跑必红 → 同一次 run 的 `quality-gate-visual-reports` artifact 回填并逐张 SHA-256 自证；未触碰视图 0 px；不动 `PIXEL_THRESHOLD`、不加 mask、`KNOWN_DYNAMIC` 保持空。
- **QM-1**：改 `electron/` ⇒ 完整打包 + 启动 8 秒 + asar 清单 + `verify-worktree-deps.js`；`Access is denied` 先按命令行定位本 worktree 遗留进程逐个 kill（前后 `Get-Process electron` 计数必须相等）。
- **不出站**：`clientImpl` / `ttsImpl` / `headImpl` 一律注入且缺省跳过；`network-egress-guard` 全仓化，真实出站即红。

---

## 11. 降级矩阵（每格一句具体的话）

| 场景 | 本次动作结果（action result） | 落盘 `feedSync.status`（durable 真源） | 文案要点 |
|---|---|---|---|
| 无凭证/凭证不完整 | `blocked` | —（拒绝发生在任何写之前） | 指名「未配置对象存储托管」+ 跳转托管配置 |
| provider=cos | `blocked` | — | 沿用 `PODCAST_HOSTING_PROVIDER_UNSUPPORTED` 原文 |
| 无音轨/抽取失败 | `failed` | —（刀 3：抽取在任何出站与写盘之前） | 指名"成片无音轨"还是"ffmpeg 失败"，不回退旁白 |
| degraded 旁白 | `failed` | —（同上） | 「检测到静音占位旁白，已阻止上传」 |
| TTS 超时/超预算 | `retryable` | —（刀 4：草稿态不进频道） | 「本轮合成未完成，这一期仍是草稿，不会出现在 feed 中」 |
| OSS 403/签名失败 | `retryable` | `failed`（仅当发生在 feed PUT）；音频 PUT 阶段不写（刀 3） | 只给错误码与计数，**日志禁记 AK/secret** |
| 未配置托管（`:get` 回 `configured:false`） | `blocked` | — | 「本地音频需先配置对象存储托管」+ 指向本页托管区；**不得**让【发布】按钮可点（见 §8） |
| 已存配置但凭证读不出（`credential-store` 解密失败/无归属） | `blocked` | — | `PODCAST_HOSTING_SECRET_MISSING` 「请重新填写一次」；不得凭旧 `index.json` 认为已配置就发一次空签名 |
| 系统凭据保护不可用（加密落盘返回 false） | `blocked` | — | `PODCAST_HOSTING_CRYPTO_UNAVAILABLE`，并明示「已停止保存」——配置半落盘比不落盘更难排障 |
| 登录归属无法确定（owner=`null`） | `blocked` | — | `PODCAST_HOSTING_IDENTITY_REQUIRED`；legacy（`undefined`）沿用旧命名空间不 fail closed，两种情形文案不同 |
| 路径前缀不安全（`..` / 前导 `/`） | `blocked` | — | `PODCAST_HOSTING_PREFIX_UNSAFE` 逐条列出，不静默清洗（§9） |
| PUT 非 2xx / 无状态码 | `failed` | `failed` | 「公网 feed 未更新（HTTP <code> 或 无状态码），本地 Feed 与已发布内容不受影响，可重试」+【按当前单集重新生成并上传 feed】；日志与错误消息只允许出现状态码与长度，**禁记 AK/secret/带签名的 URL** |
| 读体失败（文件被占用/移动/删除） | `failed` | `failed` | `PODCAST_HOSTING_BODY_READ_FAILED`，不得因对端 2xx 报成功（⑲） |
| 回滚点建不出来（本地拷贝失败，或时间戳副本 PUT 失败；`prevExists:true` 表示这一版之前确有旧版） | `success` + 标注 | `success`（回滚点缺失只进 `backupCreated`，不改 `status`） | 仍完成主键覆盖（「因建不出回滚点就拒绝发布」会把用户锁死在原地），但界面必须显示 `backupMissing`——文案必须说清「本地回滚点仍在、云端没有可指回的副本」；本地拷贝失败时那份 prev 确实不在，文案仍走 `backupMissing` 是对的（用户要采取的动作相同：不能一键退回） |
| 失败态 `feedSync` 没写进真源（channel.json 损坏/锁超时） | `failed` + `feedSync:null` | `null`（本轮没写进去；真源可能残留上一轮 `success`，见 §13 第 8 条） | 本轮结果必须显式失败；**真源里可能残留上一轮的 `status:'success'`**，频道页的 feedSync 横幅因此会显示旧状态——这是已知的可接受窗口（结果态与真源态分两级，重启后以真源为准），不做「伪造一条 failed 记录」的补偿，因为那会把「没写进去」演成「写进去了」 |
| 发布进行中用户手工编辑同频道 | `rejected` | — | `PODCAST_CHANNEL_BUSY` 立即拒绝不排队（§8）；跨频道不受影响 |
| `validateFeed` 不过 | `blocked` | —（`buildFeed` 之前即拒） | 逐条列出「第 N 期 · 字段 · 码」并给跳转 |
| 与本内容无关的历史坏集 | `blocked` | — | 「该频道有 N 期不符合规范，导致本期无法发布」并列出是哪些期 |
| feed 上传失败 | `partial` | `partial`（刀 3 计划；**当前暂无生产写入者**，声明见 `podcast-feed-sync-status.test.js`） | 「已挂到本地频道，公网 feed 尚未更新」+【按当前单集重新生成并上传 feed】；永不进成功分桶 |
| 两对象均已落 OSS | `success` | `success` | 「feed 已更新，聚合端下次抓取后生效（通常数小时至数天）」——**不得写"已即时生效"** |
| `uploadAudio` 前取消 | `cancelled` | — | 回滚临时文件，零出站 |
| `uploadAudio` 后要求中止 | `not-cancellable` | — | 明示不可中止 |
| 关闭浮层/切走页面 | 无新终态 | — | 「关闭不会取消本次发布」 |
| 崩溃/退出中断 | `reconcile` | `attemptedAt` 已写而终态缺失（对账判据见 tasks 3.6b） | 「上次发布疑似中断（第 N 期状态未知）」只提示 |
| 已达 `ITEMS_MAX` | `blocked` | — | 「已达上限 {cap} 期，请先删除」（不挤出） |
| 一键发布期间同频道再次点击 | `busy` | — | `PODCAST_CHANNEL_BUSY`「该频道有一次发布正在进行，请等它结束」——立即拒绝不排队 |
| 发布在飞时提交手工增删单集 / 改频道 / 重建 feed | `busy` | — | 同一码同一句话（`PODCAST_CHANNEL_BUSY`），并明确「等本次发布结束后再修改」；拒绝必须留痕——库里纹丝不动，不得显示「已保存」 |
| 备份失败 | `success` + 标注 | `success` | `backupCreated:false` 时按 `prevExists` 二选一：`true` → `backupMissing`，`false` → `noPrevious`（不阻断但必须可见） |
| 首次发布该频道（磁盘上还没有 `feed.xml`） | `success` + 标注 | `success`（`prevExists:false`） | `prevExists:false` + `backupCreated:false` → 显示 `noPrevious`「这是该频道首次发布，暂时还没有可退回的上一版」；此时**不发**时间戳副本 PUT——发上去的就是本次内容，等于把主键传两遍并覆盖掉真正该留的上一位 |
| 表单换新 AccessKeyId 但未重填 Secret | `blocked` | —（保存阶段即拒） | `PODCAST_HOSTING_SECRET_MISSING`，文案点名「更换 AccessKeyId 必须同时重填 AccessKeySecret」；不得静默组「新 AK + 旧 Secret」——该组合签名必然 403，而 403 会把排障方向带向 Bucket 权限而不是「表单只填了半边」 |
| 连通性探测重复执行 | `success` | —（探测不写 `feedSync`） | 每次探测写入 `_podcast-probe/probe-<ISO 时刻>.txt` 独立对象；固定名会把上一次的对象覆盖掉，令「探测成功后对象被人为删除」这类判据在 OSS 侧不可表示 |
| `writeFeedSync` 自身抛错（真源写失败） | `success` / `failed` + `feedSync:null` | `null`（与上一行同形，两种成因分别落 warn） | 返回形状**不得**被异常替换：用户必须拿到 `state`，否则「公网未更新」这句结论连同重试入口一起消失；写失败另落 warn 留痕 |

**并发与锁（刀 1 实况口径；v5 设计的「按 channelId 异步锁收口全部写者」已按实测修正）**

- `index.json` 的每一次读改写都在 `withPodcastIndexLock()` 内（`createChannel` / `renameChannel` / `setDefaultChannel` / `writeHosting` / 迁移落状态）——它是跨频道全局态，按 channelId 加键根本盖不住。
- `episodes.json` 的手工写者（`saveChannel` / `saveEpisode` / `removeEpisode` / `writeFeedSync` / `buildFeed`）本身是**同步**读改写：同一事件循环内两条 IPC 不可能互相交错，所以它们之间不需要锁。真正会交错的是**跨 await 的一键发布**（读列表 → await 上传/TTS → 写列表）。于是互斥判据只需一问：该频道此刻有没有发布在飞。
- 该判据的唯一实现是 `podcast-channel-locks.js` 的模块级 `channelBusyGate`（键 = channelId），**registry 与 service 读同一个实例**：发布侧 `tryBeginPublish / endPublish`，手工侧 `_assertNoPublishInFlight(section)` 命中即 `PODCAST_CHANNEL_BUSY` 立即拒绝、不排队。
- ⛔ 刀 1 **不留**没有生产消费者的按频道异步锁：`withChannelLock` / `_channelLocks` 已删除——留着就是「只被自身单测覆盖」的死机制（QM-6 评审 i1 的第二半）。刀 2/3 若出现确实需要排队的频道级异步临界区，再按「等待有上限、超时者不得执行其临界区、前人抛错必须放行后来者」三条重新引入，并与本条共用同一个键。
- 锁的等待上限 `MP_PODCAST_LOCK_WAIT_MS`（默认 250ms）只作用于 index 键；**不得**复用登录态锁的 30s 默认（发布级临界区不在它的服务范围内）。`index.lock`（迁移文件锁）与运行时内存锁是两套机制、不得跨持。
- Windows 原子替换退避 `[0, 20, 60]`（最坏同步自旋 80ms）由 `REGISTRY_RENAME_RETRY_DELAYS_MS` 单点导出：它是短暂 delete-share 的有界重试，不是排队预算，**不得**放大到秒级——同步自旋冻结的是整个主进程事件循环，量级一变大就变成用户可见的全应用卡死（QM-6 评审 i5 的处置口径）。
- 临界区抛错必须放行后来者；超时排队者不得补写。

---

## 12. 安全

- 长期 AK：界面与文档明示建议使用**仅覆盖该 bucket `PutObject` 的 RAM 子账号最小权限**；STS 形态规则层已支持（`:15-17`），长期 AK 可用但标注风险。
- `credential-store` 存 secret，`index.json` 只存 `credentialRef`；`:get` 永不回显；日志禁记 AK/secret/Cookie 值，只记计数与码。
- 路径：`pathPrefix` 判据防跨频道逃逸（§9）；对象 key 由 `deriveObjectKey:104` 单点派生。
- feed 覆盖：备份 + 回滚入口 + `backupCreated` 可见。
- secret 的驻留边界（刀 2 实测口径）：明文只在主进程的 `saveHosting` 内出现，用于 `credential-store.saveCredential`（AES-256-GCM，按 owner 分区）与一次签名计算；`:get` 与 `:check`/`feed:publish` 的返回体一律是掩码视图（`***`+末 4 位 AK，SK 永不回显）。渲染层表单在每次保存后（成功或失败）清空 AK/SK，Vue 响应式状态与 DevTools 里不留残留；IPC 参数 `toPlain` 脱壳后才发送，避免把 reactive proxy 传进宿主。
- 上传路径不发出真实网络请求的两个前提：`httpClient` 由调用方注入（缺省即「本轮未做真实探测」`checked:false`，测试与默认配置都零出站），且读流失败/非 2xx 都 fail closed。签名只在 `buildOssPutHeaders` 一处算，配置与凭证在发布开始时锁一份，全程不二次读（中途改配置会得到「半新半旧」的签名）。
- 托管配置写进 `index.json` 的只有 `provider/endpoint/bucket/pathPrefix/credentialRef`；`credentialRef` 是指向加密库的键名，不是凭证本身。

---

## 13. 未闭合（诚实记录，不是遗漏）

1. **第 5 轮对抗评审无有效结论**（critic 进程异常）⇒ v5 里 9 条残留项未经独立复核，闭合责任改由 §10 的测试锁承担；实现期每条都必须有指名用例。
2. 存储侧字节损坏在默认零出站路径**不覆盖**（归入注入才跑的巡检）。
3. 口语化分段的改写边界、TTS 计费二次确认、`podcast:transcript` 是否本期做 —— 属刀 4 前的开放项。
4. 外链单集的 `sizeBytes` 是**用户申报值**，界面措辞不得与一键路径共用"实测"二字。
5. P2 代托管、逆向聚合端接口：永久排除。
6. **刀 2 的「回滚」只到可追溯，不到一键**：OSS 时间戳副本的 key 未持久化（只有本地 `feed.prev.xml` 在），也没有 `restoreFeed` 通道与按钮——要退回只能靠本地那份重传——退回动作要与刀 3 的「成片重出」共用同一套状态机，先做会变成第三份发布路径。
7. **`checkHosting` 默认不探测**：未注入 `httpClient` 时如实返回 `checked:false` + 理由，界面文案是「本轮未做真实探测（默认不发出网络请求）」。这不是"检查通过"，UI 与记录都不得把它读成通过；真探测的验收要等对象存储侧有可用测试桶后在同一 PR 里补（§12 的零出站前提）。
8. **失败态没写进真源时，频道页横幅可能显示上一轮状态**：`publishFeed` 的失败结果与 `feedSync` 的真源记录是**两级事实**——前者来自本次动作，后者来自 `writeFeedSync` 落盘。当 `writeFeedSync` 自身抛错（channel.json 损坏、锁超时）时，本轮 `state:'failed'` 如实返回（发布卡片显示失败、可重试），但真源仍留着上一轮的 `status:'success'`，频道页那条基于 `feedSync` 的横幅因此会显示旧状态，直到下一次写入成功才被纠正。刻意**不**做「伪造一条 failed 记录」的补偿：那会把「没写进去」演成「写进去了」，比旧状态更危险。判据看两处：结果态以本次动作为准、真源态以重启后读到的为准。
9. **`feedSync` 只有写侧，没有读侧**（**已闭合，2026-10-11 刀 3 前置片**：`podcast:channel:get` 现在带 `feedSync`，`usePodcastChannel` 存为状态，托管卡片按 `failed`/`partial` 渲染横幅 + 【只重试上传 feed】；下面是当时的原始记录，保留不改写）：跨家族增量复核（opencode 续会话 residual-1）指出 `readFeedSync` 在 `electron/` 内**零生产调用者**、`getChannel` 只回 `meta`、`src/` 内没有任何 `feedSync` 消费点 —— 于是 §8 里那条「partial = 公网 feed 未同步 +【只重试上传 feed】」的横幅**不会出现在界面上**，本刀写进真源的失败态目前只服务「人工核对」与「下一刀的对账输入」。处置：§8 与 spec 的两处 Requirement 已改为「真源可复原」而不是「界面可见」，读侧横幅与崩溃对账（tasks 3.6）一并在刀 3 接线；不在本刀补横幅的理由是它会与刀 3 的发布状态机（partial 重试入口就在其中）共用同一份判据，先做等于把同一件事写两遍。**这条是刻意留的未闭合，不是遗漏**：如果刀 3 顺延，本条必须跟着顺延，不得让它长期读起来像已完成。
10. **刀 3 前两片只有编排，没有入口（刻意中间态，不是遗漏）**（2026-10-11）：`podcast-episode-source/extract/publish` 三个模块已落并通过 89 例测试，但 `electron/ipc-handlers` 与 `preload` 里**没有任何调用者**——也就是「成片一键出一期」这个用户动作此刻**还做不到**。写这条是为了堵住 §13 第 9 条那一类错误的复发面：上一发生的是「写了真源就宣称界面可见」，这一次如果没人记账，就会变成「写了编排就宣称功能可用」。判据统一为一条：**任何一层落地，都必须明写它的消费方在哪一片、是否已存在**；`tasks.md` 3.3 之后紧接的 3.4/3.5（状态机、浮层、入口）就是这一条的读者。第 3 片接真物时，注入边界（`uploadImpl` / `episodeSink` / `feedSink` / `channelGate`）的形状就是合同——若届时必须改形状，必须同 PR 改掉对应测试与 PRD 本节，不得留下「测试说 OK、真物接不上」。
11. **刀 3 前两片带着 3 条 Warning 级收尾缺陷进入主干，已编号登记而不是当场改**（2026-10-11，QM-6 后端 claude 评审 0 Critical / 3 Warning / 6 Info）：`episodeSink`/`feedSink`/`buildFeed` 抛错时无 cleanup 无领域码（F1）、编码器探测丢弃 exit code 与 stderr 会把「打包 ffmpeg 崩坏」错报成「缺编码器」（F2）、取消不打断在途 ffmpeg（F3），其余 6 条 Info 见 `tasks.md` 3.7 的 ①–⑧。三条 Warning 都属于「资源/排查方向」类，按 QM-6 本应修完再合；选择先合的理由是**这三处的形状全部落在没有生产实现钉死的注入接缝上**（本分支 `grep` 除模块自身与测试外零调用者），当场改会在第 3 片写真 adapter 时于同一处再改一遍。风险由两条机制兜住：① `tasks.md` 3.7 是带编号的必修清单，第 3 片的 PR 不过它就不算完成；② 编排层头注释已按 F3 如实改写，不许再把「取消窗口关闭」读成「取消即时生效」。**这条是刻意留的未闭合**：如果第 3 片顺延，本条与 §13 第 10 条一起顺延，不得让它长期读起来像已完成。 **同日处置进展（第 3 片上半，2026-10-11）**：F1 / F2 / F4 / F5 / F7 已闭合并各配行为锁（`podcast-episode-guards.test.js` 8 条 + 新增 `podcast-hosting-audio.test.js` 7 条）；G6/G7 首轮「红=0」暴露出 `publishAudio` 的守卫当时没有锁，补锁后重跑才指名变红——这条判据从此写成：**新增一条拒绝，必须在同 PR 给它一条能变红的锁**，否则等于没写。仍留 F3（取消贯穿）、F9（fixture 耦合）与 F8 的 sink 半边，随第 3 片下半闭合。

## 14. 第 3 片落地增量与欠账更新（2026-10-11）

**本节取代 §13 第 10 条与第 11 条中「编排层没有调用者」「三条 Warning 尚未处置」两笔**（历史记录不改写，以本节为当下状态）：

- **已闭合**：真实宿主接线层 `podcast-episode-host.js`（入参形状层 + 整链持忙标记 + 主进程算 outBase + kill 贯穿 + 临时目录收尾）；两条 IPC 通道（`publishFromVideo` / `publish:cancel`）+ preload 两个方法 + 桥接层两个导出同 PR 落地；取消改走第二条通道（§6.4 的 cancelToken 合同纠正）；3.8 的 W1/W2/W3 与两条 Info（https 单一谓词 `podcast-public-url.js`、partial 成因同时带 message 与 status）与 ⑤（真 `_put` 路径的 URL 守卫锁）逐条处置；适配层 `feedSink` 取服务的通行证漏项（新锁当场抓出的真实缺陷，非评审提出）。
- **回归锁新增五份文件共 63 例**：`podcast-episode-host.test.js`（33 例：形状层、整链持锁、再入凭证、outBase、取消三态、三态不压平）、`podcast-episode-adapters-pass.test.js`（5 例：通行证三处、strict、heldBy 透传）、`podcast-hosting-audio-key.test.js`（11 例：id 形态六项 + 合规放行与 key 分层 + 判据唯一性结构锁 + 真 `_put` 的 URL 守卫/contentType/非 2xx）、`podcast-episode-ipc.test.js`（6 例：九键信封、subCode、取消三态、字面量注册形态）、`podcast-public-url.test.js`（8 例：判定表 + 出期链内不得出现第二份协议判据，扫描前剥注释）。最终基线：podcast 全域 78 个测试文件 **1201 passed / 0 failed**；变异反证 13 条指名变红 + 1 条如实记为防御重叠不可分辨。
- **仍在的欠账（带承接片，不是遗漏）**：① 本节 §6.4 表里的 11 个 `episode.*` 文案键**尚未写入 locales**——它们的第一消费点是第 4 片的浮层与状态机，现在就写会造出 AGENTS.md 明令禁止的死键；第 4 片必须把 `podcast.errors.*`（新码 `PODCAST_VIDEO_NOT_FOUND`、`PODCAST_PUBLISH_CANCELLED`、`PODCAST_CANCEL_TOO_LATE`、`PODCAST_FEED_BUILD_FAILED`、`PODCAST_AUDIO_*` 四码）与 `episode.*` 一并成对补齐。当下这些码走 `podcast.errors.fallback`，不会崩，但文案不具区分度。② F9（`publish` 测试 fixture 三处常量手写耦合）仍留。③ 入口两枚（`ResultView.vue:726`、`CreateView.vue:4519`）与浮层挂起登记仍留第 4 片。
- **一条方法论**（写进 learnings 更合适，这里先记账）：跨「模块级可变单例」做断言时必须用 `require` 而不是 `import`。本仓生产代码是 CJS `require`，vitest 下测试侧的 ESM `import` 会拿到**另一份**实例，于是 `isPassed`/`isBusy` 恒 false，红出来的是「适配层没包通行证」——指错方向的红会把人引去改生产代码。同理，既有 `podcast-hosting-service.test.js` 里直接 import `channelBusyGate` 做断言的那几条，其证据强度**低于看起来的样子**，第 4 片或后续单列 PR 应改为经被测对象的公开出口观察。
