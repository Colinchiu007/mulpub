# 设计 · 播客 RSS 频道接入一键发布（文案 → 音频 → 出期 → 分发）

- 日期：2026-10-10
- 状态：**待评审**（本文是 CCG 双模型评审与对抗性评审的评审对象）
- 上游：`01-docs/PRD-PODCAST-RSS-CHANNEL-2026-10-09.md`、`docs/adr/0008-podcast-rss-is-protocol-channel-not-platform.md`、openspec change `podcast-rss-channel`（已归档，PR #3193 → `06737f999`）
- 复杂度：**M+**（跨主进程/IPC/preload/渲染层/存储层 4 层以上，含不可逆数据迁移）→ 必经 OpenSpec change + QM-6 双模型外部评审
- 本文只定"设计与契约"，不含实现；实现刀次见 §2.3

---

## 0. 问题陈述：不是"每个入口都加一个按钮"

### 0.1 现状事实（全部经代码取证，非推断）

| 事实 | 证据 |
|---|---|
| 真正执行发布的 IPC 只有 2 条主通道 | `electron/ipc-handlers/publish.js:248` `publish:batch`（→ `:298-307` 逐 target `taskQueue.add`）、`electron/services/batch-manager.js:562` `batch:create`；`CloudPublish.vue:215` 走独立引擎 |
| 其余 11 处是"造内容 → 跳 `/publish` 预填"，不是执行体 | `Collection.vue:1459/1503/1507/2143/2161/2212/2270`、`RewriteView.vue:812-820`、`HotTopics.vue:85/563/675/677`、`CopyLibraryView.vue:174`、`CreateView.vue:4519`、`ResultView.vue:726`、`PublishHistory.vue:764/769`、`Home.vue:7/67/78/134`、`CreateHistory.vue:50`、`FirstRun.vue:115` |
| 发布 payload **没有内容种类字段**，靠形状侧写 | `usePublishFlow.js:204-245 buildArticleData()` 无 `contentType`；`publish.js:305` 以 `video_path` 有值判视频；`publish-helpers.js:42-52 summarizeArticle` 只认 title/video/cover/accountId/tags |
| 品类枚举与能力注册表均无 audio 位 | `stores/platforms.js:40-45` 仅 `VIDEO/IMAGE_TEXT/MIXED`；`publish-capabilities.json:23-90` 语义键含 `video`/`images`，`audio` 0 命中 |
| 成片项目目录内**已有旁白音频** | `story2video-project-service.js:920-921` 落 `narration.m4a`；`ResultView.vue:153` 已消费 `audioPath` |
| 旁白存在 **degraded（静音占位）态** | `ResultView.vue:652` `segment?.audioMeta?.degraded === true → kinds.add('silent_narration')` |
| TTS 能力已具备但只为视频旁白服务 | `services/ai-generator.js:19/22` 映射 `tts|audio → 'synthesize'`；6 家适配器 `adapters/{openai,minimax,doubao,google,mimo,elevenlabs}-tts.js` 统一返回 `{audio: Buffer, format}`；`tts-voice:*` 4 通道只做音色目录/克隆，**不合成** |
| `podcast-repurpose-stages.js` 方向是**音频 → 视频**，不产出音频 | `:3` 注释、`:96` 入参 `params.audio`、`:106` ffprobe 探时长、`:204-212` ffmpeg 切 `.m4a` |
| 托管直传**只有规则层** | `podcast-hosting-upload.js:31` `HOSTING_PROVIDERS=['oss']`（cos 占位并如实拒绝 `:56`）、`:15` 用户自带长期 AK、`:47 validateHosting`；无凭证落盘/IPC/上传调用/入口 |
| 播客侧已支持按 guid 幂等原地合并 | `podcast-channel-service.js:280-281` 先按 id 再按 guid 命中即原地更新；`:296` `ITEMS_MAX` 上限；`:301` 新 id 走 `crypto.randomUUID()` |
| 单集白名单**无来源回链字段** | `podcast-rss.js:142-167` 白名单无 `sourceContentId`；`saveEpisode` 用 `Object.assign` 不过滤未知键 ⇒ 私有字段"可存不可见"，`buildItem` 永不输出 |

### 0.2 判据：三条同时成立，该位置才该有入口

① 产出是**成稿**（有标题 + 可连续读完的正文），非选题/碎片/统计；② 该位置**已经或能够**获得一个音频形态；③ 用户在此的意图是**交付这份内容**，不是"重跑上次那次交付"。

| 位置 | 结论 | 依据 |
|---|---|---|
| `ResultView.vue:726`、`CreateView.vue:4519`（成片） | ✅ 最该放且最便宜 | 音轨已在盘，零 TTS |
| `CopyLibraryView.vue:174`（文案库） | ✅ 放 | 成稿 + 交付意图最强 |
| `RewriteView.vue:812`（AI 改写） | ✅ 放 | 同上，`rewriteHistoryId` 回链先例可仿 |
| `Publish.vue:358/1152`（页内 AI 写作、标题助手） | ✅ 放 | 本就在执行页 |
| `Collection.vue`（文本类采集） | ⚠️ 有条件放 | `:1740/1907` 产 `mediaType:'video'` 的转载视频分支不放 |
| `FilmEngineeringView.vue` / `FilmCanvasView.vue` | ⚠️ 本期不放 | 两页发布挂载点 0 命中，先补既有交付动词是另一件事 |
| `HotTopics.vue`、`KeywordMonitorView` | ❌ 不放 | ①②不成立，合成一期必产垃圾单集 |
| `PublishHistory.vue:764`（重发） | ❌ 不放（**危险**） | ③不成立；重发带同 guid ⇒ `:280` 原地合并 = "重发"静默覆盖正在播那期 |
| `Home.vue` / `CreateHistory.vue:50` / `FirstRun.vue:115` | ❌ 不放 | 裸跳转无内容 |

### 0.3 开源参照（2026-10-10 `gh api` 实测 star 与 license）

| 段 | 参照 | ★ / License | 采纳什么 |
|---|---|---|---|
| 文稿化 | `souzatharsis/podcastfy` | 6,590 / Apache-2.0 | 先转带说话人标签的 transcript，再逐句分派 voice |
| 文案→音频 | `DrewThomasson/ebook2audiobook` | 20,320 | **禁止整篇喂 TTS**：按句段切块逐块合成再拼接；块间显式静音（`[break]` 0.3–0.6s / `[pause]` 1.0–1.6s）；中间产物放独立 process 目录 |
| | `santinic/audiblez` / `denizsafak/abogen` | 8,717 / 6,099 | abogen 产同步字幕 ⇒ 未来对应 `podcast:transcript` |
| 引擎选型 | `QwenAudio/CosyVoice` 23,910 / **Apache-2.0**；`SWivid/F5-TTS` 15,366 / MIT；`rhasspy/piper` 11,298 / MIT；`hexgrad/kokoro` 9,236 / Apache-2.0；`k2-fsa/sherpa-onnx` 15,196 / Apache-2.0 | | 许可干净、CPU 可行的本地兜底候选（本期不引入） |
| 引擎否决 | `2noise/ChatTTS` 39,894 / **AGPL-3.0**；`index-tts/index-tts` 24,397 / **NOASSERTION**；`RVC-Boss/GPT-SoVITS` 62,614（需训练） | | AGPL 对分发桌面应用是开源义务；同族门禁见 AGENTS.md「GPL 媒体二进制发布约束」 |
| feed 生成 | `advplyr/audiobookshelf` 14,602（唯一高 star 的自托管播客 RSS 生成）；`podcast rss generator` 类全部 **0–20★** | | 无高 star 先例 ⇒ 本仓 `podcast-rss.js` 已是最完整一份，继续自持 |
| 分发 | Apple 官方：提交新节目 = 交 RSS 地址；刷新靠手动触发抓取；视频播客同样走 RSS | | **无逐期发布 API** ⇒ "一键发布到播客"的唯一正确语义 = 一键更新「音频对象 + feed 对象」 |

---

## 1. 七条已锁决策（用户逐条确认，2026-10-10）

| # | 决策 | 备选与否决理由 |
|---|---|---|
| D-1 | 一键动作 = **端到端出一期**：合成/抽取音频 → 直传托管 → 追加单集 → 重建 feed → **覆盖上传 feed.xml** | 否决"只落草稿再统一生成"：不满足"一键"直觉，且 feed 不上传则聚合端永远看不到新期 |
| D-2 | **多频道**（P0 的单份 `channel.json` 必须改数据模型） | 用户场景是多个播客节目；单频道下"这一期进哪个频道"无解 |
| D-3 | 重复点击 = **原地更新同一期**（稳定 guid ⇒ `saveEpisode:280-281` 现有幂等路径） | 否决"每次新建一期"（同稿堆出重复节目）与"弹窗问用户"（一键变两击且需在 4 个入口重复实现） |
| D-4 | 托管凭证 **全局一份 + 按频道路径前缀** `{pathPrefix}/{channelId}/…` | 否决"每频道一份完整配置"（凭证管理面翻倍）与"全局默认 + 频道可覆写"（两套解析优先级、测试面翻倍） |
| D-5 | 成片取 **全混音**（ffmpeg 从成片抽完整音轨，含 BGM/音效） | 显式否决"全混音回退旁白"：回退会把"一期听感不一致"变成静默行为；抽取失败一律 fail closed |
| D-6 | 入口形态 = **共用手柄 + 正交执行链** | 否决"先建统一交付通道抽象层"（抽象先行、改动面大、易被误用为平台也走这层）；**明确否决"进 Publish 页平台勾选"**——见 §1.1 |
| D-7 | 合成引擎 = **云端适配器**（复用既有 6 家 TTS，走模型供应商体系） | 否决打包本地大模型（体积与 GPU 现实）；否决引入 AGPL/自定义许可模型；本地 piper/kokoro 作未来离线兜底候选，本期不做 |

### 1.1 为什么"进平台勾选"必须否决（评审时不得重开这条）

1. 违反已锁定 ADR-0008 与 D2/D3：`publishMode` 三态闭集回答的是"走 API 轨还是 DOM 轨、失败是否回退"，RSS 属另一种**通道种类**（范畴错误）。
2. 机械后果一：误配的 `rss` 会被 `rpa-view-manager.js` 的 `mode != 'dom-only'` 判据**静默归入 API 轨**，不报错。
3. 机械后果二：`podcast-endpoints.test.js` 的「与平台契约面隔离」describe 会当场红（分发端 id 出现在任一平台表中即红）——这条锁本身就是架构不变量的回归保护。
4. 语义后果："追加一期"被塞进 `publish:progress` 的成功/失败/取消终态与发布历史。**播客没有"发布失败"，只有"这期还没进 feed"**。

---

## 2. 架构

### 2.1 五个新单元

| 单元 | 位置 | 职责 | 注入依赖（测试零出站） |
|---|---|---|---|
| `podcast-channel-registry` | 主进程 | 多频道目录、默认频道、存量迁移、单集归属、按频道键串行锁 | `fs` |
| `podcast-hosting-service` | 主进程 | 凭证落盘（走 `credential-store`）、上传音频与 feed 两个对象、回公网 URL | `clientImpl` |
| `podcast-episode-assembler` | 主进程 | 稿/成片 → 一期音频：分块合成、块间静音、拼接、ffprobe 实测、degraded 判定 | `ttsImpl`、`ffmpeg/ffprobe` |
| `usePodcastEpisodePublish` + `PodcastPublishAction.vue` | 渲染层 | 共用手柄与状态机 | `src/api/podcast-channel.js` |
| `podcast:episode:publishFromSource` | IPC | 幂等主通道，编排上三层 | — |

### 2.2 硬边界（一条都不越）

不碰 `publish:batch`、`batch:create`、`taskQueue`、**`packages/shared-utils/src/task-queue-frequency.js`（发布频率策略 v2 的日配额/紧急放行，PR #3260 刚合并）**、`publish:progress` 相位枚举、`publish-capabilities.json`、`platform-definitions.js`、`publishMode`。播客一键发布不占任何平台日配额，因为它不是平台发布——此边界必须写进 PRD，防未来被"顺手接进频控"。

### 2.3 刀次（每刀独立可交付）

1. **刀 1** 多频道数据模型 + 迁移 + 默认频道 + 既有 8 通道加必填 `channelId`（纯主进程 + 播客页频道切换器）
2. **刀 2** P1 托管直传接线：凭证落盘、`podcast:hosting:*`、`podcast:feed:publish`、页面入口（独立价值：手工加的单集也能一键托管）
3. **刀 3** 成片一键出期（`ResultView` / `CreateView`）：抽全混音 → 上传 → 挂期 → 重建并上传 feed
4. **刀 4** 文案一键出期（`CopyLibrary` / `Rewrite` / `Publish` 内写作）：口语化分段 + 分块云端 TTS + 装配
5. **刀 5** 入口收敛为共用手柄 + 文档/门禁/记忆收口

---

## 3. 数据模型与迁移

```
<userData>/podcast/
  index.json                      { version, defaultChannelId, migratedAt,
                                    channels:[{id,name,createdAt,updatedAt}],
                                    hosting:{provider,endpoint,bucket,pathPrefix,credentialRef} }
  channels/<channelId>/channel.json    沿用 validateChannel 白名单，逐字不变
  channels/<channelId>/episodes.json   沿用 saveEpisode 语义（ITEMS_MAX 按频道计）
  channels/<channelId>/feed.xml        本地构建缓存 + lastFeedPublicUrl + lastFeedPublishedAt
```

- 凭证**不进** `index.json` 明文：`accessKeySecret` 走 `credential-store`（AES-256-GCM），`index.json` 只存 `credentialRef` 与非敏感字段。
- **`channelId` 是不可变短 id `^ch_[a-z0-9]{4,16}$`，绝不用频道名**：托管路径含 channelId，改名会打断**已提交给 Apple/小宇宙的 feed URL**（对外不可逆承诺）。
- **`guid` 作用域含 channelId**：`mpub:<channelId>:<sourceKind>:<sourceId>`，`sourceKind ∈ {project,draft,copy,rewrite,manual}`；播客页手工加的单集仍走 `crypto.randomUUID()`。代价（用户已接受）：跨频道同内容 ⇒ 两条单集、两份音频对象；**不做跨频道对象去重**（YAGNI，且会把"删一期"变成引用计数问题）。
- **迁移幂等 + 冲突不猜**：首次访问时若有 legacy `channel.json` 且 `index.json` 无 `migratedAt` ⇒ 建 `channels/default/` 并**复制**（不移动、不删 legacy，留作回滚依据，符合 R0 删除守卫）。目标已存在且内容不同 ⇒ 报 `PODCAST_MIGRATION_CONFLICT` 交用户处置，**绝不静默选一份**。
- `getChannel` 等全部改 `(channelId, …)` 签名；默认值由渲染层选中态决定，**主进程不猜**。

---

## 4. 接口契约

| 域 | 通道 | 刀次 |
|---|---|---|
| 频道 | `podcast:channel:list` / `:create` / `:rename` / `:setDefault` | 1 |
| 既有 8 | 一律加必填 `channelId` | 1 |
| 托管 | `podcast:hosting:get`（永不回显 secret，只回 masked + `configured`）/ `:save` / `:check`（注入 `clientImpl`） | 2 |
| 发布 | `podcast:feed:publish` / `podcast:episode:publishFromSource` | 2/3/4 |
| 进度 | **新事件名 `podcast:publish:progress`** | 3/4 |

- IPC 一律写字面量 `ipcMain.handle('podcast:…')`，**禁止**收成 map 循环注册：`ipc-contract.test.js` 靠字符串字面量 harvest，间接注册会让新通道从契约面静默隐身。注释中**不得出现示例字面量**（本仓有过结构锁不剥注释、把注释示例读成真实注册的事故）。
- 渲染层新导出仍逐个写字面量方法名（`src/api/podcast-channel.js` 头部注释已锁该形态），调用必须包成 thunk 交给 `envelope`（`invokeNamespace` 非 async，权限错误在参数求值期同步抛出）。
- 进度事件必须满足**双边界**：`start` 在检测/执行体之前发、`done` 在完成时发；慢任务不得让遮罩钉死在第一阶段。
- **两处本仓门禁会当场打红，先写进设计**：
  1. 浮层挂起合同：一键发布的浮层若是应用级模态，必须经 `src/composables/useEmbeddedViewSuspension.js` 挂起/恢复内嵌视图，并在 `src/overlay-view-suspension.test.js` 登记 owner（`WebContentsView` 是原生图层，CSS z-index 无效）。
  2. 像素面：入口默认**收进各页既有"发布"动作的次级项**，点击后才在浮层内出现播客频道区 ⇒ 默认态不改一个像素。否则 6 个页面浅色 + 暗色共 12 张基线全部漂移。

---

## 5. 数据流与失败语义

```
pickChannel → extractMix(ffmpeg 抽全混音) → probe(ffprobe 实测 durationSec/sizeBytes/mime)
→ uploadAudio(OSS) → saveEpisode(幂等合并 by guid) → buildFeed + validateFeed
→ uploadFeed(覆盖 {prefix}/{channelId}/feed.xml)
```

### 5.1 五条不变量

1. **"成功"只有一种：两个对象都已落地。** 音频成功但 feed 上传失败 ⇒ 状态 `partial`，界面显示"这一期已挂到本地频道，公网 feed 尚未更新"并提供【只重试上传 feed】，**不得**报成功。
2. **degraded / 无音轨一律 fail closed**：`silent_narration`（degraded 旁白）与"成片无音轨/抽取失败"都不进上传，错误文案指名是哪一种；不回退纯旁白。
3. **同一频道两次一键必须串行**：新增 `withPodcastChannelLock(channelId, …)`，键必须是 `channelId`（不得退化成全局单键）；等待有硬上限；**超时的排队者不得执行其临界区**（迟到者补写过期结论正是这把锁要消灭的形态）；临界区抛错必须放行后来者。同族口径见 `account-state-lock.js` 七条。
4. **`durationSec` / `sizeBytes` / `mime` 只能来自 ffprobe 实测**；实测字节、feed `length`、OSS `Content-Length` 三处任一漂移即 Apple 拒收或进度条错乱；ffmpeg 参数受 `media-tools-lock.json` 门禁约束。
5. **写 `index.json` / `feed.xml` 保持临时文件 + 原子 rename 语义**；Windows 只对 `EPERM/EACCES/EBUSY` 短退避重试，超预算原样抛错。

### 5.2 降级矩阵（每格一句具体的话，不得合并成"发布失败请重试"）

| 场景 | 结果态 | 文案要点 |
|---|---|---|
| 无凭证 / 凭证不完整 | `blocked` | 「未配置对象存储托管」+ 跳转托管配置 |
| provider=cos | `blocked` | 沿用 `PODCAST_HOSTING_PROVIDER_UNSUPPORTED` 原文 |
| 无音轨 / 抽取失败 | `failed` | 指名是"成片无音轨"还是"ffmpeg 失败"，不回退旁白 |
| degraded 旁白 | `failed` | 「检测到静音占位旁白，已阻止上传」 |
| TTS 超时/超预算 | `retryable` | 「本轮合成未完成，这一期仍是草稿，不会出现在 feed 中」；单任务硬超时（env 可覆盖，非法值回落默认并出声告警） |
| OSS 403/签名失败 | `retryable` | 只给错误码与计数，**日志禁记 AK/secret** |
| `validateFeed` 不过 | `blocked` | 本地已挂期、公网 feed 未动，逐条列 issue |
| feed 上传失败 | `partial` | 「这一期已挂到本地频道，公网 feed 尚未更新」+【只重试上传 feed】 |
| 挤出最老一期 | `confirm` | 点击前预告「将挤出最早的 N 期」 |

### 5.3 两处用户可见后果必须显式预告

- `ITEMS_MAX` 挤出最老一期（用户可见后果，不得静默）。
- 覆盖更新一期 ⇒ 聚合端缓存导致听众短时仍见旧音频。文案**不得**写"已即时生效"，只写"feed 已更新，聚合端下次抓取后生效（通常数小时至数天）"。

---

## 6. 校验与错误码

三层校验位：输入层（`validateChannel` / `validateEpisode` 白名单逐字不变，`validateHosting` **直接复用** `podcast-hosting-upload.js:47`，禁止第二份）→ 落盘层（registry 写前校验 channelId 形态与目录存在性）→ 出站层（`validateFeed` 前置于 uploadFeed，**校验不过绝不上传**，公网 feed 永不变脏）。

| 字段 | 判据 | 拒绝码 |
|---|---|---|
| `channelId` | `^ch_[a-z0-9]{4,16}$`，不可变 | `PODCAST_CHANNEL_ID_INVALID` |
| `hosting.endpoint` | `^https://oss-[a-z0-9-]+\.aliyuncs\.com$` 形态 | `PODCAST_HOSTING_ENDPOINT_INVALID` |
| `hosting.pathPrefix` | 不得为空、不得以 `/` 开头、不得含 `..`（防跨频道路径逃逸） | `PODCAST_HOSTING_PREFIX_UNSAFE` |
| 音频 | mime ∈ {`audio/mpeg`,`audio/mp4`} 且与 ffprobe 实测容器一致 | `PODCAST_AUDIO_FORMAT_MISMATCH` |
| 时长/大小 | ffprobe 实测；`durationSec ≥ 1`；`sizeBytes` 与真实字节一致 | `PODCAST_AUDIO_MEASURE_FAILED` |
| guid | 含 channelId 作用域，跨频道不撞 | `PODCAST_GUID_SCOPE_INVALID` |

每个 `PODCAST_*` 码必须有 zh/en 成对文案；PRD 逐字抄录，并**从 `locales/{zh,en}.js` 脚本生成全量对照表**（不得手工维护——先例：135 条里曾有 89 条在 PRD 查不到逐字值）。新增用户可见文案必须成对进 locales（Gate 7），且术语必须进 `01-docs/i18n-glossary.md` **并被 UI 实际采用**（`src/i18n/glossary.test.js` L3 术语锁，`check-locale-sync --pair-base` 判不到它）。

---

## 7. 测试策略与反证

| 层 | 内容 |
|---|---|
| 单元 | registry 用真实 fs（`os.tmpdir()` 隔离，禁止固定仓库内路径）；assembler 注入假 tts/ffmpeg/ffprobe；hosting 注入假 client；guid 派生表（含跨频道不撞车负例）；迁移：幂等重跑 + **从非空 legacy 出发** + 冲突不猜 |
| 契约 | `ipc-contract.test.js` 双向对账（既有 8 改签名 + 新增 7 通道）；`ipc-exposure-contract` 从调用点抽首参字面量与 preload 暴露面比 |
| 结构锁 | 字面量注册锁；`envelope` thunk 形态负向锁（沿用）；浮层 owner 登记锁；`channelId` 传递链单一实现锁；`validateHosting` 单一实现锁 |
| 行为锁（各配一次"把锁本身改成 no-op 必须立刻变红"的变异反证） | ① feed 上传失败报 `partial` 而非成功；② 摘掉 degraded 判定必红；③ 锁超时的迟到排队者不得补写；④ `validateFeed` 不过时 uploadFeed 一次都不能被调用；⑤ `durationSec` 不得来自常量或 LLM 估计 |
| 视觉 QM-4 | 新增浮层用例浅色 + 暗色（首跑必红 → 同一次 run 的 `quality-gate-visual-reports` artifact 回填，逐张 SHA-256 自证）；未触碰视图必须 0 px；漂移按「本 PR / 上游传染」两类分别记账；不动 `PIXEL_THRESHOLD`、不加 mask、`KNOWN_DYNAMIC` 保持空 |
| QM-1 | 改 `electron/` ⇒ 完整打包 + 启动 8 秒 + asar 清单 + `verify-worktree-deps.js`；`Access is denied` 先按命令行定位本 worktree 遗留进程逐个 kill（前后 `Get-Process electron` 计数必须相等），禁递归删产物 |
| 全量回归 | 由 CI 代跑；本地跑法必须与该包自己的 runner 一致（先例：`node --test test/*.test.js` 造出 35 条假红） |
| 测试不出站 | `clientImpl` / `ttsImpl` 一律注入；`podcast:hosting:check` 缺省跳过真实探测（与 `podcast:feed:verify` 的 `headImpl` 同口径）；`network-egress-guard` 全仓化，真实出站即红 |

---

## 8. 评审与门禁排期

| 节点 | 评审 | 对象 | 产物 |
|---|---|---|---|
| 本文完成 | `adversarial-review-loop`（跨家族对抗循环） | 本设计全文 | `.adversarial/<name>/{proposal-v1.md,critique-v1.md,adjudication.json,family-snapshot.json}`（沿用本仓既有四件配对形态） |
| 本文完成 | `/plan-eng-review` → `/plan-design-review` → `/plan-devex-review` → `/cso` | 架构+迁移 / 新浮层+像素面 / IPC 契约面 / OSS 凭证与出站 | `.quality-gates.md` |
| PRD + openspec change 写完 | 差异审计（对已归档 `podcast-rss-channel` 数据模型） | 规格一致性 | `openspec/changes/podcast-oneclick-publish/` |
| **每刀最后一个代码提交之后** | QM-6 CCG 双模型：`codeagent-wrapper --backend claude`（逻辑/安全/规格）+ `--backend opencode`（模式/可维护性）并行审 `git diff origin/main...HEAD` | 实现 diff | `.quality-gates.md` 双模型 PASS + 发现项/修复项逐条 |

已知纪律（本会话实测踩过，写进排期防重演）：`sh scripts/deep-review.sh` 只读 HEAD 的 `.ccg/reviews/<sha>.json`，docs/test-only 提交不生成记录却 rc=0 看似跑过 ⇒ 评审必须排在最后一个**代码**提交之后或显式 `--sha`；`resume` 必须带 `--backend`；后端模型 5–15 分钟属正常，不得用 `timeout` 掐、不得用 `… | tail` 当 rc；高危域争议项不允许自扮演豁免（`.adversarial/*/adjudication.json` 的 `highRiskNote` 已明示）。

---

## 9. 未决项（诚实列出，评审请重点打这里）

1. **口语化分段的边界**：把书面稿转成可播的口语稿，允许改写到什么程度？`rewrite-engine` 的去 AI 味链路**不得**复用为同一条（语义不同）。未定：是否需要"逐字播报模式"作为选项。
2. **TTS 计费预算归谁**：一键发布消耗用户模型额度，是否需要点击前显示预估字符数/费用并二次确认。
3. **音色选择的归属**：频道级默认音色还是全局一份？（多频道下不同节目大概率不同主讲音色。）
4. **feed 公网 URL 的稳定承诺**：`{pathPrefix}/{channelId}/feed.xml` 一旦提交给聚合端就不可改路径——是否在 UI 上把该 URL 标为"已提交地址，改动会导致订阅失效"。
5. **是否输出 `podcast:transcript`**：文字稿是本项目强项，一期带字幕/文字稿是 Podcasting 2.0 域；本期是否做。
6. **刀 3 与刀 4 的先后**：当前按"最便宜先做"排为 3→4，但刀 3 依赖刀 2（托管），意味着首期用户可见价值要等三刀完成。是否存在可先行的、只依赖刀 1 的中间价值（例如"多频道 + 只挂外链单集"）。

## 10. 实现后修正（刀 1 落地实测，不改写上文历史口径）

上文是按设计评审定稿的原始口径，保留不删；以下为实测后的现状锚点，冲突处以本节为准（PRD §11「并发与锁」是口径唯一出处）。

1. **§5.1.3 的「按 channelId 异步锁收口 episodes.json 全部写者」已被实测否证并修正。** 手工单集增删是**同步**读改写，同一事件循环内两条 IPC 不可能互相交错；会交错的只有跨 await 的一键发布。于是互斥判据收敛为一个问题（该频道此刻有没有发布在飞），实现为 `podcast-channel-locks.js` 的模块级 `channelBusyGate`，registry 与频道服务读同一实例。`withPodcastChannelLock` 在刀 1 没有任何生产消费者 —— 留着就是「只被自身单测覆盖」的死机制，已删除；刀 2/3 若出现确实需要排队的频道级异步临界区，再按「等待有上限、超时者不得执行临界区、前人抛错必须放行后来者」三条重新引入并与忙标记共键。
2. **`podcast:endpoints:list` 不得借道按频道构造的服务。** 设计评审未覆盖此点：`getService()` 缺 channelId 即抛 `PODCAST_CHANNEL_ID_REQUIRED`，注入假 service 的单测对该缺陷结构性免疫，而生产路径上这条通道会恒失败。现由 handler 直取共享层 `listPodcastEndpoints()`（同一份实现，无第二份）。
3. **迁移冲突必须在发现它的那一次调用就可读。** 设计说「报 `PODCAST_MIGRATION_CONFLICT` 交用户处置」，实现若让首访 `channel:list` 直接 reject，界面就渲染不出横幅与处置按钮，用户只剩反复重启排障。现 `ensureMigratedOnce` 捕获冲突/硬失败后返回错误上挂的 `index`；读写分档判据只在 registry 一处（`assertChannelExists` / `assertChannelWritable`）。
4. **领域码必须能到达文案层。** `toIpcError` 的 `code` 是 EC 数字（决定往哪查），新增校验码若只带它，用户永远看到「调用失败，请重试」。现失败信封统一带 `subCode`，preload 原样透出，`usePodcastChannel.call()` 单点归一为领域码后取文案。
5. **落盘层不得只信输入层。** `writeHosting` 在写盘这一站清洗 `pathPrefix`（复用 `normalizePathPrefix` 唯一实现）与 `endpoint`，因为刀 2 会用它派生 OSS 对象 key；防跨前缀逃逸的判据放在输入层等于给下一个入口留洞。

**刀 2 追加（2026-10-11，托管直传接线落地实测）**

- **设计稿承诺的「回滚入口」在刀 2 只兑现一半**：先建回滚点、再覆盖主键的顺序已实现且锁死（顺序反了主键写坏就没有任何一份上次成功的 feed 可退），但**一键退回没做**——上一版本对象的时间戳 key 未持久化到 `feedSync`。这不是遗漏而是边界：退回动作要与刀 3 的成片重出共用同一套状态机，先做会变成第三份发布路径。PRD §13 第 6 条按此明写。
- **新增一条设计稿没预见的失效模式**：`createReadStream` 把 open 排进下一个 tick，`destroy()` 取消不掉它。请求已返回、文件随后被删时那次迟到的 open 会以 `error` 事件落到无人监听的流上——在 Electron 主进程里就是 uncaughtException。刀 2 的实现把它变成两条可锁的行为：⑱ 读流必须带 error 监听；⑲ 请求期内读体失败即便对端回 2xx 也不得报成功。后者是「降级/占位产物不得冒充成功产物」在传输层的落点，设计稿原来只在音频抽取层讨论过同一形状。
- **locales 结构随逐文件行数门禁被迫拆层**：播客命名空间从 `locales/zh.js`/`en.js` 抽到 `locales/podcast/{zh,en}.js`（该路径有「曾还清债务」的墓碑，新代码超限不得重新挂账）。连带要求：`gen-picker-copy-table.js` 的取源路径必须同步迁移，否则 §8.1 的逐字表会解析不到键而抛错——**结构锁的取源站点必须同步迁移** 的又一例（改结构必须同时改所有读结构的工具）。
- **未接入的托管类型做成 `option disabled` 而不是可选**：输入层仍接受 `cos`（保存时不丢用户已填的值），但界面不得诱导一次必然失败的点击。「可选但点了必失败」在设计稿里没被列成需要处置的形态。