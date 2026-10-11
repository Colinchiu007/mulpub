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


**分片交付状态（2026-10-11）**：上面 1–5 的**判据与收口**已由刀 3 前两片落地（`podcast-episode-source.js` 降级判定 / `podcast-episode-extract.js` 抽取与实测 / `podcast-episode-publish.js` 相位闭集 + 取消窗口 + 三处一致校验 + partial 分层），全部依赖注入、零真实出站、零真实进程。**6–7 与真实宿主（ffmpeg/ffprobe spawn、OSS `putObject`、`episodeSink`/`feedSink` 复用 `channelPublishPass` 通行证）在第 3 片接线；`usePodcastEpisodePublish` 状态机、浮层与两枚入口在第 4 片。** 前两片**没有生产调用者**——这是刻意的中间态，判据见 §13 末尾新增条目。

### 刀 4 文案一键出期
口语化分段（**新建 prompt，不复用 `rewrite-engine` 的去 AI 味链路**——语义不同）→ 分块云端 TTS（每块 ≤ 引擎上限，块间显式静音 0.3–0.6s，禁止整篇喂）→ 拼接 → 归一 → `probe`/`uploadAudio`/`attach`/`buildFeed`/`uploadFeed` 同刀 3。**只换数据源与触发条件，不得改手柄状态机**（结构锁⑪）。音色默认值属**频道级**（未配置时回退全局默认音色并提示）。

### 刀 5 入口收敛
刀 3 已建好的 `<PodcastPublishAction>` 挂到 `CopyLibraryView.vue:174`、`RewriteView.vue:812`、`Publish.vue:358`（采集页仅文本类分支）。**不放**：`HotTopics`、`KeywordMonitor`、`PublishHistory:764`（重发会带同 guid 原地覆盖正在播那期）、`Home`/`FirstRun`（裸跳转无内容）、`FilmEngineering`（本页无发布挂载点）。

---

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
