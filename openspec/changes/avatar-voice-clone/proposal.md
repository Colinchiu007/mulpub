# Proposal: avatar-voice-clone（HeyGen 数字人形象 + 声音克隆）

## Why

用户要「上传真人照片/视频 → 克隆出长期保存、可反复使用的新角色形象 + 配套声音」。

阻碍有三：

1. **产品层明确不做**：`PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19.md` §八不做清单第 2 条、`openspec/records/avatar-heygen-wiring.md`、`01-docs/user-manual.md` §9.3.1 三处都写着不做克隆。
2. **适配层只有公共目录**：`heygen.js` 的 `listAvatars()`/`listVoices()` 只能读账号下已有形象/音色，无创建入口；`tts-voice-catalog.js` 未给 HeyGen 登记克隆能力。
3. **克隆基础设施已成熟**（可行性依据）：`tts-voice-clone-service.js` 已实现 owner 隔离、registry 持久化、样本落盘、远端删除补偿、重命名、voice_id 失效自愈、ffprobe 探测、样本魔数嗅探；IPC 六通道已落地；ElevenLabs / MiniMax 两家已按此范式实现 `cloneVoice`。

**结论：难度可控。** 声音克隆是「照既有范式接第三家」；形象克隆是「从该范式派生新 service」。

## 已查证的 API 形态

用户提问「声音是否随视频一起生成」——**结论：独立，不一起生成。** 视频生成只传 `voice_id` 引用，不传则用该 look 默认声音。

证据（`developers.heygen.com` 本机 DNS 解析失败，以下为检索所得官方文档原文摘录）：

| 能力 | 端点 | 官方原文摘录 |
|---|---|---|
| 声音克隆 | `POST /v3/voices/clone` | *"Returns a `voice_clone_id` that can be polled via `GET /v3/voices/` until the status is 'complete'. The resulting voice can be used with `POST /v3/voices/speech` and `POST /v3/videos`."* |
| 声音克隆（Voice 模型） | `POST /v3/models/audio/voices`，`"mode": "instant"` | *"returns a `voice_id` that is usually `ACTIVE` within..."*；`professional` 为多录音高保真 |
| 创建形象 | `POST /v3/avatars` | *"Creates a new avatar from an image, video footage, or a text prompt. Supports **photo, digital_twin, and prompt** types. Avatar training is asynchronous."* |
| 形象 look 查询 | `GET /v3/avatars/looks/{look_id}` | *"...including supported engines, preferred orientation, preview URLs, and **training status**"* |
| 视频生成引用 | `POST /v2/video/generate`（#4194 已实现） | *"A look is one outfit/pose/style... **It's the value you pass as `avatar_id` to video creation**."* / *"**When `voice_id` is omitted, the look's default voice is used**."* |

两条实现约束：

1. **版本段分裂**：克隆 `/v3`、视频生成 `/v2`（#4194）、状态查询 `/v1`。adapter 必须按端点取版本段，**不得硬拼前缀**（复用 `_apiRoot()` 模式）。
2. **「照片或视频」是 `type` 二选一**：`photo`（单张，最快，官方明言 *"no footage, no consent step"*）、`digital_twin`（视频训练）。正对上需求。

## What Changes

### ADDED Capabilities

- `avatar-voice-clone`：HeyGen 形象与声音克隆契约。形象：上传照片/视频 → 创建 → 轮询训练 → 持久化 look id；声音：上传录音 → 克隆 → 持久化 `voice_id`。均支持列出、重命名、删除。数字人配置区下拉 = 官方公共目录 ∪ 用户克隆目录，克隆项带来源标识。

### MODIFIED Requirements

- `heygen-adapter-contract`：adapter 新增 5 个方法（见 Impact）。
- `avatar-spokesperson`：preflight 与 generate 的三要素来源扩展到克隆产物（复用 `resolveDigitalHumanInputs` 已有的 params > stage.options > 前序产出 优先级）。

## 设计决策

| # | 决策 | 理由 |
|---|---|---|
| Q1 | 形象与声音分两个独立 service | HeyGen 侧本就是两条链路（端点/轮询/配额/失败语义全不同），合成一个 service 会让校验分支爆炸 |
| Q2 | 持久化走 `store.getUserSetting`（账号隔离），不动 ops-center | 用户明确「跟着账号走」且 ops-center 是平台运营人员用的。仓内已有 `tts-voice-clones:<ver>:<provider>:<model>` registry 键范式，克隆产物天然随账号迁移 |
| Q3 | 样本落盘 userData，目录规范同 TTS 克隆 | 复用已验证的符号链接防护、路径 containment、大小限制逻辑 |
| Q4 | 合规：一次性提示 + attestation + **append-only 审计日志** | 用户不要求强制勾选。但仅靠 `userSetting`「已阅」可绕过（改设置即失效），且 attestation 放 registry 会随删除丢失（第二轮评审抓到的真错误）。故三层：① 每条克隆记录带 `attestation: { acknowledgedAt, sourceKind: 'self' \| 'third_party_authorized' }`；② 审计日志独立落盘（Q10）；③ 一次性提示文案含肖像权/声音权归属声明 |
| Q5 | 生命周期：本地为权威，远端为可失副本 | 见下节 |
| Q6 | 删除 = 先远端后本地；远端失败标 `pending`，**带 TTL 与重试上限** | 避免「远端删不掉 → 本地永远删不掉」死锁，同时避免远端资产无限期残留 |
| Q7 | 训练轮询由 service 负责，不走流水线 | 「提交→训练→可用」是长任务，与 `avatar_select`/`generate` 阶段语义不同 |
| Q8 | 目录合并键 = `provider:model:id`，owner 隔离，冲突时克隆项优先 | 同一 id 不会跨 owner 出现（registry 按 owner 读）；克隆 > 公共的优先级让用户看到自己那份 |
| Q9 | **来源优先级：`self` > `third_party_authorized` > 公共目录** | 用户自己上传的克隆项优先于授权代传的，两者都优先于官方公共目录；`resolveDigitalHumanInputs` 的候选键按此顺序取 |
| Q10 | **审计日志 append-only，独立于 registry** | attestation 若只放 registry，删记录即丢审计（第二轮评审 i3 抓到的真错误）。改落 `userData/audit/avatar-voice-clone.log`，记录 create/delete/attestation 三类事件，删 registry 条目不清审计 |
| Q11 | **轮询/重试都有明确封顶** | 训练轮询 15 分钟到期标 `failed`（**不删远端**，远端可能实际成功）；轮询间隔 10s、失败退避 30s；远端删除重试 = TTL 30 天 + 最多 5 次，超时后审计删除并清理本地样本 |

### 服务边界（Q1/Q3/Q7 展开）

| 职责 | avatar-clone-service | tts-voice-clone-service |
|---|---|---|
| registry | 形象（look id） | 声音（voice_id） |
| 素材校验 | 图片/视频：魔数、尺寸、时长上限 | 音频：魔数、ffprobe 时长 |
| 远端生命周期 | 创建 + 训练轮询 + 删除 | 创建 + 删除 |
| 样本目录 | `avatar-clone-samples/` | `voice-clone-samples/` |

**两者不互相调用**；`avatar-catalog-service` 与 `tts-voice-catalog` 各自合并公共目录与克隆目录。

### 生命周期（Q5/Q6 展开）

| 阶段 | 行为 |
|---|---|
| 创建 | 上传 → adapter 提交 → 拿 id → 落 registry（`deletionState: active`，含 attestation）+ 样本落盘 |
| 训练中 | 轮询（形象 look training status / 声音 `complete`），间隔 10s、失败退避 30s，**上限 15 分钟**；到期标 `failed` 并**不自动删远端**（远端可能实际成功，避免误删付费产物） |
| 可用 | 出现在下拉，带「我的」来源标识 |
| 换账号 | registry 按 owner 隔离，各账号看各自一套；同账号换 Key 不影响（HeyGen 资源属于账号不属于 Key） |
| 删除 | 先远端后本地；远端失败标 `pending`，保留样本，**TTL 30 天 + 最多 5 次重试**，超时后审计删除并清理本地样本 |
| 远端已失效 | 列表时标记失效，UI 提示「远端已不存在，可删除本地记录」 |

## Impact

- **adapter**：`heygen.js` 新增 `createAvatar()`（`POST /v3/avatars`，`type: photo\|digital_twin`）、`getAvatarStatus()`（`GET /v3/avatars/looks/{id}`）、`deleteAvatar()`、`cloneVoice()`（`POST /v3/voices/clone`，`mode: instant\|professional`）、`deleteVoice()`。
- **KNOWN_METHODS 分期登记**（第二轮评审 i1/i2 的处置）：本轮**只开放 `cloneVoice`/`deleteVoice`**（TTS mixin 已有登记，端点与 ElevenLabs/MiniMax 同构，签名风险低）；三个形象方法的 `/v3/avatars` 字段名未经真实响应核对，**暂不登记进 `KNOWN_METHODS`**，由 service 经 `modelProviderManager.getAdapter(providerId)` 直取 adapter 调用（提案明确记录这条替代路径）。首跑核对通过后才登记，避免签名错误被 `callAdapter` 闸门永久拦截（#3969 同型坑）。

| 方法 | 本轮可调用性 | 条件 |
|---|---|---|
| `cloneVoice` / `deleteVoice` | ✅ 走 `callAdapter` | 已在 TTS mixin 登记 |
| `createAvatar` / `getAvatarStatus` / `deleteAvatar` | ⚠️ 仅 service 直取 adapter | 不暴露给流水线；首跑核对 `/v3/avatars` 字段后登记 |

## 明确不做

- 不做多形象同屏/对话视频（延续 #3969 不做清单第 3 条）。
- 不做声音克隆的「专业级多录音训练」UI 分流——只暴露一个上传入口，`mode` 由素材数量自动决定（单条 → instant，多条 → professional），不在 UI 上让用户选。
- 不做克隆形象预览图下载与展示（延续 #3969 不做清单第 1 条）。
- 不同步 ops-center（用户明确）。
- 不做 `type: prompt`（文字生成形象）——需求只覆盖照片与视频两种真实素材。

## 附录：与既有「不克隆」决策的边界（第二轮评审 i4 要求）

`RESEARCH-VIDEO-CLONE-REFERENCE-2026-08-12.md` 与 `PRD-VIDEO-CLONE-2026-08-12.md` 的「不克隆声音/人脸」，作用域是**视频对标复刻**这条流水线：拿他人的视频拆解后复刻，红线是「不得复刻他人身份」。其原文为「不克隆真人声音与人脸；形象风格相似即可」「深伪红线规避」。

本 change 是**用户克隆自己的形象与声音**（`sourceKind: 'self'`），两者是不同产品场景：

| | 视频对标复刻（2026-08-12，不做） | 用户自克隆（本 change，做） |
|---|---|---|
| 素材来源 | 他人视频 | 用户上传自己的照片/视频/录音 |
| 身份归属 | 复刻他人身份 ⇒ 深伪红线 | 用户本人 ⇒ 无身份冒用 |
| 既有决策 | 明确不做 | 未被该决策覆盖 |

因此本 change **不是推翻** 2026-08-12 的结论，而是把「不克隆」的作用域收窄到「克隆他人」；`sourceKind: 'third_party_authorized'` 保留「经授权的代传」这一档，提示文案必须声明授权责任。
- **新 service**：`avatar-clone-service.js`（**范式派生，非直接复制**——分歧点见服务边界表）+ 纯逻辑拆分文件。
- **能力登记**：`tts-voice-catalog.js` 给 HeyGen 音色补 `clone: DESKTOP_UPLOAD_CLONE` + 样本限制表；`avatar-catalog-service.js` 合并克隆项。
- **IPC**：新 `ipc-handlers/avatar-clone.js`、`preload/avatar-clone.js`、`src/api/avatar-clone.js`（照 `avatar-catalog.js` + `tts-voice-clone.js`）。
- **前端**：`CreateView.vue` 克隆管理入口 + 上传 + 一次性提示；`useAvatarCatalog.js` 合并逻辑；locales zh/en 成对。
- **文档**：`user-manual.md` §9.3.1 重写；PRD #3969 不做清单修订；补附录区分「视频对标复刻（不做）」与「用户自克隆（做）」（Warning i4 的处置）。

## 验证边界（如实声明）

- **无真实 HeyGen Key**：本轮只做到契约级正确性与单测。
- **官方端点未逐字核对**：`developers.heygen.com` 本机 DNS 解析到非公网 IP。端点族与字段名来自第三方文档摘录，与 #4194 修 `heygen.js` 时的处境相同（先按公开资料对齐、留待实跑）。adapter 测试按「官方契约锁」写，不照实现回写。
- **首跑前检查清单**（Warning i5 的处置，写入 `tasks.md`）：捕获端点真实响应 → 字段名逐字确认 → 训练轮询间隔与超时实测 → 通过后才开放给流水线。
