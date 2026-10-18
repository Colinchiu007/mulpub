# PRD：克隆音色本地样本完整性核验与生成前置守卫（2026-10-18）

| 项 | 内容 |
|----|------|
| 文档编号 | `PRD-S2V-VOICE-CLONE-INTEGRITY-2026-10-18` |
| 状态 | 已实现（随分支 `fix-s2v-voice-clone-integrity` 落地）【已实现】 |
| 关联 OpenSpec change | `openspec/changes/story2video-voice-clone-integrity/` |
| 关联执行记录 | `openspec/records/fix-s2v-voice-clone-integrity.md` |
| 实现特性标识 | `feat_story2video_voice_clone_integrity`（Gate 9 PR 正文声明用） |
| 修复前代码基线 | `c4f140419`（事故时点；本分支 rebase 后基线 `5f2e21770`，本文「修复前」行号均指事故时点基线） |
| 主 PRD 合同 | `01-docs/PRD.md` §7.1.16.4（两处副本逐字节相同） |

> 本文是**事故驱动**的合同文档：先还原 2026-10-18 真实故障（含日志/SQLite/磁盘三方证据），
> 再定义修复后的数据校验、判定规则、交互与验收判据。所有判据都要求「可证伪」——
> 能写出一条会让它变红的输入，才算判据。

---

## 1. 背景与真实事故

### 1.1 一句话

「registry 里有这条克隆音色」被当成了「这个音色还能用」：本地样本目录已被删除、
供应商也已拒绝该 `voice_id`，但音色列表仍把它当可选项，生成阶段没有任何前置守卫，
于是 9 条旁白全部失败、失败聚合把同一句英文原样重复 9 次，用户拿到一条不可操作的英文错误。

### 1.2 事故时间线（本地 2026-10-18 22:32–22:44 / 日志 UTC 14:32–14:44）

证据文件：`shared-user-data/logs/app-2026-10-18.log`（下文缩写为 `app.log`）。
项目：`mvdxd21s_o1ws`，流水线 `story2video-compose`（故事讲述），阶段 5/7 `generate_assets`。

| # | 时刻（UTC / 本地） | 日志行 | 事件 |
|---|---|---|---|
| 1 | 14:32:39.333Z / 22:32:39 | `app.log:29882` | `ExecutionRecorder Started recording for project mvdxd21s_o1ws`，本次运行开始 |
| 2 | 14:32:39.342Z / 22:32:39 | `app.log:29883` | `stage start ... stage=split (1/7)`，7 阶段编排正常启动 |
| 3 | 14:32:39.353Z / 22:32:39 | SQLite `story2video.lastOptions.v1` | 保存选项落盘：`voiceId=MiniMaxMiniMaxCloneVoice_00jngz_0qrltk`、`voiceProvider=minimax-multimodal`、`voiceModel=speech-2.8-turbo` |
| 4 | 14:33:31.481Z / 22:33:31 | `app.log:30077` | `stage start ... stage=generate_assets (5/7)`，进入图片/视频/旁白生成 |
| 5 | 14:33:31.790Z / 22:33:31 | `app.log:30080` | `ApiGovernor retry-attempt {"key":"minimax-multimodal:tts:speech-2.8-turbo","attempt":1}`，TTS 首次被拒 |
| 6 | 14:33:31.793Z / 22:33:31 | `app.log:30082` | `AssetGenerator TTS provider minimax-multimodal failed: you don't have access to this voice_id`（第 1 条，共 9 条） |
| 7 | 14:33:31.795Z / 22:33:31 | `app.log:30083` | `[Story2Video] cloned voice unavailable, attempting re-clone [object Object]`，进入重克隆回退；`[object Object]` 是日志取对象未序列化的既有缺陷 |
| 8 | 14:33:31.798Z / 22:33:31 | `app.log:30084` | `re-clone fallback failed Error: ENOENT: no such file or directory, scandir '.../voice-clone-samples/<ownerHash>/47f825cb-634e-4c5f-8d90-cc904e547411'`，样本目录不存在，重克隆必然失败 |
| 9 | 14:33:31.793Z–14:33:55.642Z | `app.log:30082/30087/30092/30097/30104/30109/30116/30122/30129` | 9 条 TTS 失败，间隔约 3 秒（受并发 3 收敛），原文均为 `you don't have access to this voice_id` |
| 10 | 14:35:48.485Z / 22:35:48 | `app.log:30175` | `stage end ... stage=generate_assets success=false duration_ms=137004 error=Asset scene generation failed: 0/9 scenes have both image and audio. TTS #1: you don't...; TTS #2: ...; ...; TTS #9: ...` |
| 11 | 14:35:48.502Z / 22:35:48 | `app.log:30176` | `PipelineEngine [run] finalize ... status=failed`，整条运行失败 |
| 12 | 14:43:37.016Z / 22:43:37 | `app.log:30309` | 用户重试：`stage start ... stage=generate_assets (5/7)`（第二次） |
| 13 | 14:44:01.356Z / 22:44:01 | `app.log:30364` | 第二次 `stage end ... success=false duration_ms=24340`，仍是 `0/9` + 9 条重复英文 |
| 14 | 14:44:01.376Z / 22:44:01 | `app.log:30365` | 第二次 `finalize ... status=failed`，事故窗口结束 |

**同类前兆**：同一日志文件更早还有一次同形态失败——`app.log:27241`（12:46:27.759Z / 20:46:27）
`run=mvdthpjy_mnte` 进入 `generate_assets`，`app.log:27245` 起同样的
`you don't have access to this voice_id` 与同一 `47f825cb-...` 目录的 ENOENT，
`app.log:27498`（12:52:58.552Z）以 `0/22 scenes have both image and audio` 收尾。
即：这不是偶发抖动，而是**从 2026-08-13 克隆创建后、样本目录被清理起就长期存在的失效形态**。

### 1.3 现场三方证据（只读核对）

**① SQLite registry（`shared-user-data/multi-publish.db` 的 `settings` 表，只读查询）**

键：`user:<ownerHash>:tts-voice-clones:v2:minimax-multimodal:speech-2.8-turbo`

```json
{
  "version": 2,
  "providerId": "minimax-multimodal",
  "model": "speech-2.8-turbo",
  "voices": [{
    "id": "MiniMaxMiniMaxCloneVoice_00jngz_0qrltk",
    "name": "音色001",
    "source": "user_clone",
    "createdAt": 1786586213776,
    "deletionState": "active",
    "sampleStorage": {
      "relativeDir": "voice-clone-samples/<ownerHash>/47f825cb-634e-4c5f-8d90-cc904e547411",
      "sampleCount": 1
    }
  }]
}
```

- `createdAt=1786586213776` ⇒ 2026-08-13 01:56:53.776Z（本地 09:56），即该克隆创建时间。
- `deletionState=active` ⇒ registry 认定记录仍然有效，这是「registry 说存在」的直接证据。

**② 偏好（同一张表）**

- `tts-voice-preference:v1:minimax-multimodal:speech-2.8-turbo` →
  `{"voiceId":"MiniMaxMiniMaxCloneVoice_00jngz_0qrltk","selectedAt":1786586213788}`，偏好在失效后仍指向该音色。

**③ 磁盘（`shared-user-data/voice-clone-samples/<ownerHash>/`）**

- 只剩 `e39cae19-3438-448a-af7f-aa802eaa7fc9` 一个目录；
  它属于 **另一个** MiMo 克隆（registry `tts-voice-clones:v2:mimo-tts:mimo-v2.5-tts-voiceclone` 的记录指向它），与本次事故音色无关。
- 事故音色的 `47f825cb-634e-4c5f-8d90-cc904e547411` 目录**不存在**，与 `app.log:30084` 的 ENOENT 一致。

### 1.4 影响面

| 维度 | 影响 |
|---|---|
| 用户可见结果 | 项目 `mvdxd21s_o1ws` 两次运行均失败，`0/9` 场景同时具备图片与旁白；用户无法得到成片 |
| 额度/时间 | 9 条 TTS 调用 + 2 次生成阶段（137 s + 24 s）+ 图片生成全部消耗；重克隆回退每条失败都白跑一次 |
| 可操作性 | 错误正文是 9 次重复的英文供应商原文，既没说明「音色已失效」，也没给出「重新克隆/改选音色」的动作 |
| 可见性 | 音色下拉仍显示该音色为可选项（只校验了 `voice_id` 格式），用户直到运行失败才知道它不可用 |
| 数据面 | registry / 偏好 / 历史快照都继续引用失效 `voice_id`，形成自洽的「幽灵记录」 |

### 1.5 复现条件（最小复现）

同时满足以下 4 条即必现（缺一不可）：

1. 当前 owner 的 registry 中存在 `deletionState=active` 的克隆记录，且其 `sampleStorage.relativeDir`
   指向的目录**已被删除**（手工清理、磁盘迁移丢失、其它工具误删、多设备同步缺失等）；
2. 供应商侧已不再受理该 `voice_id`（用户在供应商控制台删除音色、克隆过期、或换了无该音色的账号）；
3. 保存选项（`story2video.lastOptions.v1`）或音色偏好仍指向该 `voiceId`；
4. 以 auto 模式运行 `story2video-compose` 到 `generate_assets` 阶段。

修复前的程序对第 1 条**完全不可见**：`listClones` 只做 `voice_id` 格式校验（`isProviderCloneVoiceIdValid`），
从不把 registry 与磁盘样本对账；`generate_assets` 也没有任何音色前置校验。

---

## 2. 目标与非目标

### 2.1 目标

| # | 目标 | 可证伪判据 |
|---|---|---|
| O1 | 克隆列表能区分「registry 有记录但本地样本已不可用」的失效态 | 删除样本目录后 `listClones` 返回 `invalid:true, invalidReason:'sample_storage_missing'` |
| O2 | 提供只读、owner 隔离的音色可用性查询，供流水线生成前判定 | `getCloneVoiceStatus` 对有效/失效/未注册分别返回 `registered/invalid/invalidReason`，且不改 registry/偏好 |
| O3 | 音色目录选择器在启动前就把失效克隆标出来（禁用 + 徽标 + 禁用「设为默认」） | UI 下拉 option 禁用且带「（已失效，请重新克隆）」；克隆列表显示徽标；「设为默认」禁用 |
| O4 | 生成阶段在**任何**资源调用之前对失效克隆 fail fast，错误可操作 | 前置守卫命中时 `generateImage/generateTTS` 调用次数为 0，错误以 `VOICE_CLONE_UNAVAILABLE` 开头 |
| O5 | 运行期真的全部 TTS 失败且均属克隆音色不可用时，聚合成一条可操作提示（不重复原始英文） | 9 条失败 → 错误中 `VOICE_CLONE_UNAVAILABLE` 与「供应商拒绝访问」各出现 1 次，不含 `TTS #` |
| O6 | 失败聚合对相同错误去重并输出场景区间 | `TTS #1-#3: <msg>` / `TTS #1, #3: <msg>` / `TTS #3: <msg>` |
| O7 | 失效原因在运行期/日志里可定位（voiceId/provider/reason），但不记录音频、密钥、绝对路径 | 日志字段白名单；无音频内容/密钥/本机绝对路径 |
| O8 | 不改变阶段数量与顺序、不新增 checkpoint 类型、不静默替换用户音色 | 7 阶段编排与既有合同测试不变；失效时失败而非换默认音色 |

### 2.2 非目标

- **不做自动重建**：样本目录都不在了，程序无法凭空重建克隆；本 PR 明确引导用户「重新克隆或改选音色」。
- **不做静默替换**：不得把失效克隆自动换成供应商官方音色（延续 PRD §7.1.16.2 合同）。
- **不改 registry schema / 数据库结构 / 不迁移历史数据**：只做只读对账与失效标记，不改写用户记录。
- **不在生成前校验供应商侧撤销**：provider 是否仍受理该 `voice_id` 只能在真实调用时得知；样本完好的
  provider 侧撤销仍由运行期「重克隆回退 + 聚合错误」兜底（见 §14 风险）。
- **不新增 UI 文案结构**：`invalidReason` 是内部字段，不直接展示给用户；仅通过既有「已失效」通道与
  新增的 `story2video.voice_clone_unavailable` 文案呈现。
- **不改阶段实现、不加 checkpoint 类型、不调整并发/预算**。
- **不修复既有「配置页徽标/设为默认中文字面量」的 i18n 存量债务**（见 §14）。

---

## 3. 用户故事

1. **作为故事讲述用户**，我在「声音」设置里看到某个克隆音色被标成「已失效，请重新克隆」且不可选，
   这样我不会把一条注定失败的运行跑上去。
2. **作为故事讲述用户**，如果我沿用了上次保存的选项（失效音色仍在 `lastOptions`），启动时程序
   会先告诉我「所选克隆音色已失效（本地样本已丢失…）」，并提示我重新克隆或改选音色，
   而不是让我等两分钟后收到 9 条英文报错。
3. **作为故事讲述用户**，如果供应商在运行中途才撤销该音色（启动时样本还在），失败信息会聚合成
   一条中文可操作提示，且历史记录里显示同样可读的原因，而不是原始英文拼接。
4. **作为故事讲述用户**，失效音色不会被程序偷偷换成官方默认音色；我的选择被尊重，
   失败就是失败，恢复动作由我显式完成。
5. **作为维护者**，我能从日志一行 `[Story2Video] cloned voice blocked by preflight {voiceId, provider, reason}`
   直接定位是哪个音色、哪个原因，而不必翻 9 条重复英文。

---

## 4. 术语表

| 术语 | 定义 |
|---|---|
| registry | 克隆音色记录表，存于 `settings` 表，键为 `tts-voice-clones:v2:<providerId>:<model>`；当前 `version=2`，顶层 `{version, providerId, model, voices}` |
| registry 记录 | `voices[]` 中的一条：`{id, name, source, createdAt, deletionState, sampleStorage?}`；`source` 恒为 `user_clone` |
| sampleStorage | registry 记录上的样本存储描述：`{relativeDir, sampleCount}`；`relativeDir` 为**三段式相对路径** |
| owner / ownerHash | 当前用户主体（`store.getOwnerSubject()`）及其 SHA-256；样本目录按 owner 隔离 |
| catalog | 音色目录：供应商预置音色 + 本地克隆音色合并后的可选项集合（`tts-voice-service`） |
| invalidVoices | catalog 响应里的失效克隆数组，只供前端展示/禁用，不进入可选 `voices` |
| invalidReason | 本次新增的内部失效原因枚举：`invalid_voice_id` \| `sample_storage_missing`；不直接展示 |
| 前置守卫 | `generate_assets` 在创建任何图片/视频/TTS 调用**之前**执行的只读音色可用性检查；命中即整阶段失败 |
| 运行期聚合 | TTS 已实际失败后，若失败集合全部属于「克隆音色不可用」，把 N 条失败聚合成一条 `VOICE_CLONE_UNAVAILABLE` 错误 |
| 三层降级 | PRD §7.1.16.1 的跨账号失效降级：① 用本地样本重克隆并重试；② 保留已有音频；③ 正常报错 |
| fail-open（守卫侧） | 判定所需的数据源不可用（服务缺失/方法缺失/查询抛错/userData 不可解析）时**不阻断**，保持改造前行为 |
| fail-closed（输入侧） | 输入/路径/记录形状不合法时直接拒绝，不做任何文件系统探测 |
| resume | `context.generate_assets.resume`：断点续传上下文，记录每场景已完成的 imagePath/videoPath/audioPath |

---

## 5. 数据模型与数据校验

### 5.1 registry 记录 schema（既有，不改）

```json
{
  "version": 2,
  "providerId": "<providerId>",
  "model": "<model>",
  "voices": [
    {
      "id": "<voiceId>",
      "name": "<displayName>",
      "source": "user_clone",
      "createdAt": 1786586213776,
      "deletionState": "active | pending | remote_deleted",
      "sampleStorage": {
        "relativeDir": "voice-clone-samples/<ownerHash>/<storageId>",
        "sampleCount": 1
      }
    }
  ]
}
```

校验沿用 `isSafeCloneRegistry` / `isSafeCloneVoice` / `isSafeCloneSampleStorage`：

| 字段 | 校验 | 违规处理 |
|---|---|---|
| `version` | 必须 `=== 2` | 整个 registry 视为不可读（既有错误码） |
| `providerId` / `model` | 与请求键一致 | 同上 |
| `voices[].id` | `safeIdentifier`：1–256、`[a-zA-Z0-9._-]`、去空白后非空 | 记录不可信，registry 读取失败（既有行为） |
| `voices[].name` | 1–128、无控制字符 | 同上 |
| `voices[].source` | 必须 `user_clone` | 同上 |
| `voices[].createdAt` | 有限数值 | 同上 |
| `voices[].deletionState` | `active/pending/remote_deleted` 之一（缺省 `active`） | 同上 |
| `voices[].sampleStorage` | 缺省允许；存在时必须通过 `isSafeCloneSampleStorage` | 同上 |
| `voices[].id` 唯一性 | 同 registry 内不得重复 | 同上 |

### 5.2 sampleStorage 三段式相对路径不变量

`relativeDir` 必须严格是 3 段：

```
voice-clone-samples / <ownerHash> / <storageId>
```

| 位置 | 约束 |
|---|---|
| 第 1 段 | 必须字面等于 `voice-clone-samples`（样本根目录常量） |
| 第 2 段 | 必须字面等于**当前 owner** 的 64 位小写十六进制 SHA-256（owner 隔离） |
| 第 3 段 | `safeIdentifier(…, 128)`：1–128、`[a-zA-Z0-9._-]`；即 `<uuid>` 形态的 storageId |
| 段数 | 必须恰好 3；多一段/少一段/空段一律拒绝 |
| 额外键 | `sampleStorage` 只允许 `relativeDir`、`sampleCount` 两个键 |
| `sampleCount` | 安全整数且 `1 ≤ sampleCount ≤ 10` |

> `isSafeCloneSampleStorage` 是唯一判据（既有实现，路径穿越防护见 §5.6），本次不新增第二套校验。

### 5.3 磁盘对账规则（本次新增）

`listClones` 与 `getCloneVoiceStatus` 对每条记录执行只读对账。判定顺序固定（先廉价、先安全后 IO）：

| 步 | 判定 | 结论 |
|---|---|---|
| 1 | `voice_id` 是否满足 provider 约束（`isProviderCloneVoiceIdValid`，MiniMax 家族调用 `isValidMiniMaxCloneVoiceId`） | 不满足 ⇒ `invalid:true, invalidReason:'invalid_voice_id'`，**不再做磁盘探测** |
| 2 | 记录是否带 `sampleStorage` | 不带 ⇒ **不判失效**（历史记录/无样本记录，保持既有表现）；`getCloneVoiceStatus` 视为有效 |
| 3 | `sampleStorage` 是否通过 `isSafeCloneSampleStorage` | 不通过 ⇒ `invalidReason:'sample_storage_missing'`（记录形状已不可信，按缺失处理，**不做任何文件系统访问**） |
| 4 | 解析 `userData` 路径（`app.getPath('userData')`，或注入的 `userDataPath`） | 无法解析 ⇒ **`unknown`（不判失效，fail-open）**，见 §5.5 |
| 5 | `<userData>/voice-clone-samples/<ownerHash>/<storageId>` 的 `lstat` | `ENOENT` ⇒ `sample_storage_missing`；符号链接 / 非目录 ⇒ `sample_storage_missing`；其它 IO 错误 ⇒ `unknown`（fail-open） |
| 6 | `readdir` 后筛「文件名扩展名属于 `ALLOWED_AUDIO_EXTENSIONS`」 | 命中 ≥1 ⇒ 有效；命中 0 ⇒ `sample_storage_missing` |
| 7 | `readdir` 抛错 | `unknown`（fail-open，不判失效） |

允许音频扩展名（`ALLOWED_AUDIO_EXTENSIONS` 单一真源，**不按 model 级 `allowedExtensions` 收窄**）：

| 集合 | 扩展名 |
|---|---|
| `ALLOWED_AUDIO_EXTENSIONS` | `.aac` `.flac` `.m4a` `.mp3` `.ogg` `.opus` `.wav` `.webm` |

> 对账 helper 为服务层薄封装 `_sampleStorageStatus(owner, sampleStorage)`，实现主体在 `tts-voice-clone-integrity.js` 的 `inspectSampleStorage`，返回 `'ok' | 'missing' | 'unknown'` 三态；
> `listClones` 与 `getCloneVoiceStatus` 共用它，避免两处判定漂移。
>
> 为什么用全局集合而不是 model 级白名单：`ALLOWED_AUDIO_EXTENSIONS` 是「这是不是一个音频文件」的
> 单一真源；model 级 `allowedExtensions` 是「该模型接受什么样本」的上传约束，两者语义不同。
> 用 model 级集合判「本地是否还有材料」会把「目录里有音频但模型不收这种格式」误判成「样本丢失」，
> 从而把可诊断的克隆失败提前变成不可恢复的失效标记（见 §14 R11）。
>
> 样本「至少一个音频文件」只做文件名扩展名判定：不解析音频内容、不做 ffprobe、不计算时长、
> 不逐文件 `lstat`——本判据只回答「是否还具备重克隆的本地材料」，不回答「音频是否仍然可解码」。

### 5.4 invalidReason 枚举与优先级

| 值 | 含义 | 触发 | 优先级 |
|---|---|---|---|
| `invalid_voice_id` | `voice_id` 不满足供应商约束（历史版本生成过 `"01"` 这类非法 id） | §5.3 步 1 | **1（最高）** |
| `sample_storage_missing` | 本地样本目录缺失、非目录、符号链接、无合格音频，或 `sampleStorage` 形状不安全 | §5.3 步 3/5/6 | 2 |
| （无） | 有效 | 全部通过 | — |
| （无，`unknown`） | 无法判定（fail-open） | §5.3 步 4/5/7 的不可判定错误 | — |

- **只输出一个** reason：两者同时命中取 `invalid_voice_id`（与既有 §7.1.16 行为一致，且该原因对用户更根本）。
- 有效记录**不输出** `invalidReason` 字段（保持既有响应形状最小化；新增字段只在失效时出现）。
- `invalidReason` 是内部字段，**不新增用户可见文案**；用户可见的仍是「已失效，请重新克隆」与新增的
  `story2video.voice_clone_unavailable`。

### 5.5 `unknown` 的 fail-open 边界

以下情形**不得**判失效：

| 情形 | 处理 | 理由 |
|---|---|---|
| `userData` 路径不可解析（无 app、非法值、根目录） | `unknown` | 判失效会把「环境不可判定」变成「用户音色被删」，造成假阻断 |
| 磁盘探测抛非 `ENOENT` 错误（权限、IO、并发删除竞态） | `unknown` | 同上 |
| 非 Electron 环境（单测/浏览器）无 `app.getPath` | `unknown`/不介入 | 保持改造前行为 |
| 旧版主进程没有 `getCloneVoiceStatus` | 守卫不阻断 | 版本兼容 |
| 守卫查询自身抛错 | 不阻断 | 守卫故障不得变成任务失败 |

对称地，**输入侧 fail-closed**：`sampleStorage` 形状不合法、`relativeDir` 越界/段数不对/owner 不匹配时，
不进入文件系统探测，直接按 `sample_storage_missing` 处理（安全方向：宁可少判有效，不做越权探测）。

### 5.6 owner 隔离与路径穿越防护

- **owner 隔离**：读取 registry 用 `store.getUserSetting(key, null, owner.subject)`；对账时使用
  `this._captureOwner()` 的 hash 比对 `relativeDir` 第 2 段。另一个 owner 的 registry 与目录**不可见**：
  `getCloneVoiceStatus` 在 owner 切换后返回 `registered:false`。
- **路径穿越防护**（沿用 `isSafeCloneSampleStorage` + 目录解析双重约束）：
  1. `relativeDir` 段数必须 3，且各段通过 `safeIdentifier`（拒绝 `..`、`/`、`\`、盘符、空段）；
  2. 第 2 段必须与 owner hash 字面相等；
  3. 解析目标路径后再次校验其位于 `<userData>/voice-clone-samples/<ownerHash>` 之下；
  4. `lstat` 发现符号链接即拒绝（不跟随）；
  5. 只读：对账过程不创建/删除/改写任何文件，也不读写音频内容。
- `getCloneVoiceStatus` 为**只读**方法：不写 registry、不写偏好、不触发样本清理。

### 5.7 偏好与 catalog 合并（既有 7.1.16 合同，本次直接复用）

`tts-voice-service._buildCatalogResponse` 的既有行为**无需修改**，只要 `listClones` 正确标出失效：

1. 克隆 `source=user_clone` 且 `invalid===true` ⇒ push 到 `invalidVoices`（带 `invalid:true`），**不加入** `voices`；
2. 失效克隆不出现在可选 `voices` ⇒ `isSafePreference` 不命中 ⇒ `selectedVoiceId` 回退 `defaultVoiceId(voices, capability)`；
3. 偏好存在且发生回退时，既有逻辑会把回退后的默认音色**写回偏好**（7.1.16 已实现）；
4. 前端同时消费 `voices` 与 `invalidVoices`：前者可选，后者仅展示/禁用。

> 结论：新增的 `sample_storage_missing` 失效来源**自动继承**既有「移出可选项 + 偏好回退」合同，
> 无需在 catalog 层加分支——这是选择「在 `listClones` 打标」而不是「在 catalog 过滤」的原因。

---

## 6. 端到端流程

### 6.1 流程表

| # | 环节 | 行为 | 失败/边界 |
|---|---|---|---|
| 1 | 应用启动 / 打开「声音」设置 | 前端请求 catalog | — |
| 2 | catalog 构建 | 拉供应商预置音色 + `listClones` 合并本机克隆 | 克隆读取失败：catalog 仍可返回预置音色（既有容错） |
| 3 | **完整性标记**（新增） | `listClones` 对每条记录做 §5.3 对账；失效 ⇒ `invalid` + `invalidReason` | `unknown` 不标失效 |
| 4 | `invalidVoices` / 偏好回退 | 失效克隆移入 `invalidVoices`；偏好不命中 ⇒ 回退默认并写回 | 偏好指向未注册音色同样回退（既有） |
| 5 | 用户确认选项 | `lastOptions` 保存（可能仍含失效 `voiceId`，用于下次复现提示） | — |
| 6 | **启动前置守卫**（新增） | `generate_assets` 在创建任何资源调用前查询 `getCloneVoiceStatus` | 命中 `registered && invalid` ⇒ 立即失败（零调用） |
| 7 | 图片 / 视频 / TTS 并行 | 既有三路并行编排 | 单个失败按既有语义汇总 |
| 8 | TTS 失败 → `tryReCloneVoice` | 识别「克隆音色不可用」后尝试本地样本重克隆并重试 | 样本缺失 ⇒ 返回 null，透传原始错误（不换官方音色） |
| 9 | **运行期聚合**（新增） | 若全部 TTS 失败且错误均属克隆音色不可用 ⇒ 单条 `VOICE_CLONE_UNAVAILABLE` 错误；先写 `context.generate_assets.resume` | 部分失败/混合原因 ⇒ 走既有 `summarizeAssetFailures`（已去重） |
| 10 | 失败聚合 `summarizeAssetFailures`（增强） | 相同错误合并为场景区间 | 单条/连续/非连续三种形态 |
| 11 | 渲染层归一化（新增） | `VOICE_CLONE_UNAVAILABLE` 错误码或「没有访问权」原文 ⇒ `story2video.voice_clone_unavailable` | 必须早于 `VOICE_INVALID` / `asset_generation_failed` 规则 |
| 12 | 用户提示 / 改选路径 | 错误弹窗、历史记录、结果页展示 zh/en 文案；用户去「声音」设置重新克隆或改选后重启 | — |

### 6.2 流程（文本图）

```
[启动/打开声音设置]
        │
        ▼
[tts-voice-service 构建 catalog]
        │  ├── 供应商预置音色
        │  └── listClones ──► 逐条磁盘对账（§5.3）
        │                         ├─ invalid_voice_id / sample_storage_missing ──► invalid:true
        │                         └─ unknown/有效 ────────────────────────────────► 不标失效
        ▼
[invalidVoices 收集] ──► 移出可选 voices ──► 偏好不命中 ──► 回退默认音色（写回）
        │
        ▼
[用户选项 lastOptions/偏好] ──► 启动 story2video-compose
        │
        ▼
[generate_assets]
        │
        ├─► 【前置守卫】getCloneVoiceStatus({providerId, model, voiceId})
        │        └─ registered && invalid ──► 立即失败 VOICE_CLONE_UNAVAILABLE（零图片/零TTS）
        │
        ├─► 图片/视频生成（并行）
        └─► TTS 生成（并行）
                 └─ 单条失败 ──► tryReCloneVoice（本地样本重克隆，失败则透传）
        │
        ▼
[失败聚合]
        ├─ 全部 TTS 失败且均为克隆音色不可用 ──► 单条 VOICE_CLONE_UNAVAILABLE（先写 resume）
        └─ 其它 ──► summarizeAssetFailures（相同错误去重 + 场景区间）
        │
        ▼
[渲染层]
        ├─ errorCode=VOICE_CLONE_UNAVAILABLE 或「没有访问权」原文 ──► story2video.voice_clone_unavailable
        └─ 其它 ──► 既有规则（VOICE_INVALID / asset_generation_failed / ...）
        │
        ▼
[用户提示] ──► 去「声音」设置：重新克隆该音色 / 改选其它可用音色 ──► 重新启动
```

---

## 7. 功能逻辑与判定规则

### 7.1 `TtsVoiceCloneService.listClones`（增强）

- 输入/输出形状不变：`{ providerId, model }` → `success({ providerId, model, voices })`。
- 每条记录先做 `voice_id` 合法性判断；再做 §5.3 的样本对账。
- 失效记录额外输出 `invalid:true` 与 `invalidReason`；有效记录**不输出** `invalidReason`。
- 无 `sampleStorage` 的历史记录不判失效（保持既有表现）。
- 只读：不改 registry、不清理样本、不写偏好。
- 实现主体在 `tts-voice-clone-integrity.js`（`buildPublicCloneEntries` / `inspectSampleStorage` / `computeCloneInvalidReason`，纯逻辑 + 依赖注入）；服务方法只注入 store/owner 并保留既有错误信封。

### 7.2 `TtsVoiceCloneService.getCloneVoiceStatus`（新增，只读）

签名：`getCloneVoiceStatus({ providerId, model, voiceId })`。实现主体在 `tts-voice-clone-integrity.js` 的 `readCloneVoiceStatus`（模型候选回退与失效判定），服务方法只注入 store/owner。

返回 code/data 信封（**永不返回 null**）：

| 情形 | 返回 |
|---|---|
| 命中 active 记录且有效 | `{code:0, data:{registered:true, name, invalid:false, invalidReason:null}}` |
| 命中但失效 | `{code:0, data:{registered:true, name, invalid:true, invalidReason:'invalid_voice_id'\|'sample_storage_missing'}}` |
| 未命中（含其它 owner、非 active） | `{code:0, data:{registered:false}}`（不带 name/invalid） |
| 非法入参（缺 voiceId、provider/model 非法） | `{code:-1, message:'VOICE_CLONE_INVALID_ARGUMENTS'}` |
| owner 不可解析 | `{code:-1, message:'VOICE_OWNER_UNAVAILABLE'}` |
| store 不可用（缺 get/setUserSetting 或读取抛错） | `{code:-1, message:'VOICE_CLONE_STORE_UNAVAILABLE'}` |

- **owner 隔离**：按当前 owner 的 registry 查询，绝不跨 owner。
- **模型候选回退**与 `findCloneSamples` 同风格：先精确 `model`，再依次
  `speech-2.8-turbo`、`speech-02-hd`、`speech-2.8-hd`、`speech-2.6-hd`、`speech-2.6-turbo`、
  `mimo-v2.5-tts-voiceclone`、`mimo-v2.5-tts`；首个命中的键即结果。
- **只读**：不写 registry、不写偏好、不清理样本。

### 7.3 `tts-voice-service._buildCatalogResponse`（不改）

既有 7.1.16 合同直接消费 `invalid`：移入 `invalidVoices`、移出可选 `voices`、偏好回退默认。
本 PR **不修改**该文件；「新增失效来源自动继承」由 `listClones` 打标实现（见 §5.7）。

### 7.4 生成前置守卫（`generate_assets` / manual `finalize_assets`）

**位置**：

- `generate_assets`：在 `writeAssetsProgress()` 之后、**创建任何 image/video/TTS Promise 之前**
  （前置进度写入需保持同步，既有测试锁定）；守卫失败时整阶段立即返回，不产生任何资源调用。
- manual 模式：`generate_assets` 的候选生成路径**不**生成 TTS（只生成候选图片/视频），因此不在此路径
  前置阻断；manual 的 TTS 由 `finalize_assets` 在开始生成旁白**之前**用同一 helper 守卫。
- 两处复用**同一个**共享 helper `resolveVoiceCloneGuard({pipelineEngine, voiceId, providerId, model})`（`story2video-voice-guard.js`），
  错误串由 `buildVoiceCloneUnavailableError` 构造，两个阶段逐字一致。

**判定**：

```
status = getCloneVoiceStatus({ providerId, model, voiceId })
若 status.code === 0 且 status.data.registered === true 且 status.data.invalid === true
    ⇒ 立即失败，error = "VOICE_CLONE_UNAVAILABLE: 所选克隆音色「<name>」已失效（<原因>），
       请在「声音」设置中重新克隆或改选其它音色后重新启动；本次未生成任何图片与旁白。"
否则 ⇒ 放行
```

**原因映射**：

| invalidReason | `<原因>` 文案 |
|---|---|
| `sample_storage_missing` | `本地克隆样本已丢失，供应商也可能已不再受理该音色` |
| `invalid_voice_id` | `音色 ID 不合法` |
| 其它/未知 | `音色已不可用` |

**允许条件（必须放行）**：

| 条件 | 理由 |
|---|---|
| `registered === false` | 不是本机克隆（默认音色/供应商预置音色/非克隆 provider），不归本守卫管 |
| `invalid === false` | 记录有效 |
| 克隆服务未注册、缺少 `getCloneVoiceStatus`、或查询抛错 | 守卫故障 fail-open，不得把任务变成失败 |
| `voiceId` 为空 / `'default'` | 用户未选克隆音色 |
| `providerId` 为空 | 未解析出 provider，交由既有链路报错 |
| `status.code !== 0` | 查询失败 ⇒ 不阻断（fail-open） |

**日志**：命中时固定 warn：`[Story2Video] cloned voice blocked by preflight` + `{voiceId, provider, reason}`
（不记录音频、密钥、绝对路径）。

### 7.5 运行期聚合（新增）

触发条件（必须同时满足）：

1. `failedTts.length > 0`；
2. `failedTts.every(r => isClonedVoiceUnavailableMessage(r.error))`。

动作：

1. **先**按既有逻辑写入 `context.generate_assets.resume`（每场景已完成的 imagePath/videoPath/audioPath），
   保证用户可「从断点继续」；
2. 返回失败，错误为单条聚合文案：

```
VOICE_CLONE_UNAVAILABLE: 所选克隆音色已不可用（供应商拒绝访问，且本地样本无法用于重新克隆）。
请在「声音」设置中重新克隆或改选其它音色后重新启动。
```

约束：错误中不得出现原始供应商英文（如 `you don't have access`）、不得出现 `TTS #N`、前缀只出现一次。
若失败集合是「部分克隆不可用 + 其它原因」，不满足 `every`，走既有 `summarizeAssetFailures`（已去重）。

### 7.6 `summarizeAssetFailures`（增强）

- 保持既有函数名与调用方（Image/TTS 共用）。
- 按「归一化后的相同 message」分组（`trim` + 连续空白压成一个空格 + 截断 500 字符，沿用旧净化），
  组内按首次出现顺序输出。
- 索引形态：
  - 单条：`TTS #3: <msg>`（与旧格式一致）；
  - 连续且 ≥2 条：`TTS #1-#3: <msg>`；
  - 非连续：`TTS #1, #3: <msg>`；
  - 索引缺失：`TTS #?: <msg>`。
- Image 侧共用同一实现、同一格式。
- 该函数新增到 `module.exports` 供单元测试直接断言（additive，不改调用方）。

### 7.7 渲染层错误归一化（新增）

- `notification-error-patterns.js`：新增 `VOICE_CLONE_UNAVAILABLE_PATTERN`，覆盖
  `VOICE_CLONE_UNAVAILABLE`、`(don't|do not|cannot|can't) have access to (this) voice`、
  `voice_id ... no access/not found/not accessible`。
- `story2video-notifications.js`：新增通知键 `VOICE_CLONE_UNAVAILABLE → 'story2video.voice_clone_unavailable'`；
  `resolveMessageKey` 中**必须早于** `VOICE_INVALID_PATTERN` 与通用 TTS/素材失败规则判定；
  同时接受 `notification.errorCode === 'VOICE_CLONE_UNAVAILABLE'`。
- `pipeline-error-formatter.js`：新增规则 `voice_clone_unavailable`（key 前缀 `story2video.`），
  位置必须**早于** `asset_generation_failed`——事故原始错误以 `Asset scene generation failed:` 开头，
  落到后者会被误判成素材/API 配额问题。
- locale：`apps/desktop/src/locales/story2video/zh.js` / `en.js` 成对新增 `voice_clone_unavailable`。

### 7.8 不变量与边界

| 不变量 | 说明 |
|---|---|
| 阶段数量/顺序不变 | 仍是 7 阶段编排；`generate_assets` 仍是第 5/7；不新增阶段 |
| 不新增 checkpoint 类型 | 守卫失败是普通失败，不产生 `needs_user_input` 等检查点 |
| 不静默替换用户音色 | 失效时失败并提示；`tryReCloneVoice` 仅允许「用本地样本重克隆后重试」，不得 `retryFn('default')` |
| 与 7.1.16.1 三层降级衔接 | Layer 1（本地重克隆）保持不变：样本在 → 可恢复；样本缺失 → Layer 2/3，最终由本 PR 的聚合/守卫给出可操作提示 |
| 与 7.1.16.2 衔接 | 继续禁止静默替换官方音色；本 PR 只增强「不可用时的可见性与前置性」 |
| 偏好写回 | 只在既有 `_buildCatalogResponse` 回退分支写；`getCloneVoiceStatus`/守卫不写偏好 |
| 数据只读 | 对账/状态查询/守卫均为只读；不改 registry、不改样本目录 |
| resume 语义 | 运行期聚合前必须写入 resume；守卫失败不写 resume（未产生任何素材） |

---

## 8. 交互逻辑

### 8.1 启动前的失效可见性

| 位置 | 现状（沿用） | 本次新增来源后的表现 |
|---|---|---|
| 「语音 / 音色 ID」下拉 | 失效克隆以禁用 option 呈现，文案 `{name}（已失效，请重新克隆）` | `sample_storage_missing` 与 `invalid_voice_id` 走同一通道，均禁用 |
| 「音色复制 / 克隆」列表 | 失效行显示「已失效，请重新克隆」徽标；「设为默认」禁用；「删除」保持可用 | 同上，且删除可用于清理幽灵记录 |
| 偏好 | 失效偏好回退默认音色并写回 | 同上，无需用户操作 |
| 历史结果页音色下拉 | 使用 locale 键 `story2video.sceneMaterial.voiceInvalidSuffix` 展示失效后缀 | 同上 |

### 8.2 启动被阻断

- 用户按「启动流水线」后，`generate_assets` 前置守卫命中 ⇒ 阶段立即失败；
- 进度浮层/历史记录显示 `story2video.voice_clone_unavailable`（zh/en 文案逐字见 §9）；
- **不会**产生任何图片/视频/TTS 调用，也不消耗额度；
- 用户可见恢复动作：去「声音」设置重新克隆该音色，或改选其它可用音色，然后重新启动。

### 8.3 运行期才失效（启动时样本仍在）

- TTS 全部失败且原因均为克隆音色不可用 ⇒ 单条聚合错误（§7.5）；
- 若样本完好、仅供应商撤销 ⇒ `tryReCloneVoice` 会用本地样本重克隆；成功则继续，失败则聚合；
- 历史记录/结果页同样通过渲染层归一化展示可操作文案。

### 8.4 错误后的恢复动作（用户路径）

1. 打开「声音」设置 → 看到失效徽标；
2. 二选一：① 重新选择本地音频文件克隆（生成新 `voice_id` 与样本目录）；② 改选其它可用音色；
3. 重新启动流水线；旧失效记录可删除（清理 registry/偏好）。

---

## 9. 显示项与提示文字逐字表（zh / en）

> 约定：`{}` 为占位符；「现状」表示本次不新增/不改动的既有文案。

| # | 显示项 | 中文（逐字） | 英文（逐字） | 来源 |
|---|---|---|---|---|
| 1 | 音色下拉失效 option（配置页） | `{name}（已失效，请重新克隆）` | 现状硬编码中文（存量 i18n 债务，本 PR 不改） | `S2vConfigPanels.vue` |
| 2 | 音色下拉失效 option（结果页） | `{name}` + `（已失效，请重新克隆）` | `{name}` + ` (invalid, please re-clone)` | locale `story2video.sceneMaterial.voiceInvalidSuffix` |
| 3 | 克隆列表失效徽标 | `已失效，请重新克隆` | 现状硬编码中文（同 #1） | `S2vConfigPanels.vue` |
| 4 | 「设为默认」按钮 | 可用：`设为默认`；已默认：`已设为默认` | 现状硬编码中文（同 #1） | `S2vConfigPanels.vue`，失效时 `:disabled` |
| 5 | 新 locale 键 `story2video.voice_clone_unavailable`（错误弹窗/历史/结果页） | `所选克隆音色不可用：供应商已不再受理该音色，且本地克隆样本缺失，无法自动重建。请在「声音」设置中重新克隆该音色或改选其它可用音色，然后重新启动。` | `The selected cloned voice is unavailable: the provider no longer accepts it and its local clone sample is missing, so it cannot be rebuilt automatically. Re-clone the voice or choose another available voice in Voice settings, then start again.` | `locales/story2video/{zh,en}.js` |
| 6 | 前置守卫错误串（后端，经渲染层归一化后**不直接**展示原始串） | `VOICE_CLONE_UNAVAILABLE: 所选克隆音色「{name}」已失效（{原因}），请在「声音」设置中重新克隆或改选其它音色后重新启动；本次未生成任何图片与旁白。` | 同左（后端固定中文；UI 展示走 #5 的 en 文案） | `story2video-stages.js` 私有 helper |
| 7 | 运行期聚合错误串（后端，经渲染层归一化） | `VOICE_CLONE_UNAVAILABLE: 所选克隆音色已不可用（供应商拒绝访问，且本地样本无法用于重新克隆）。请在「声音」设置中重新克隆或改选其它音色后重新启动。` | 同左（UI 展示走 #5 的 en 文案） | `story2video-stages.js` |
| 8 | 既有音色无效提示（对比参考） | `{provider}模型账号的音色不可用，请在「语音设置」中重新选择音色，或使用该模型账号的默认音色。` | `The {provider} model account voice is unavailable. Choose another voice in Voice Settings or use this model account's default voice.` | locale `story2video.voice_invalid`（本 PR 不改） |

**文案边界**：`invalidReason` 与「本地样本已丢失/音色 ID 不合法」只出现在**后端错误串与日志**中，
不新增独立 UI 文案；用户看到的统一文案是 #5。这样避免「同一失效四种说法」。

---

## 10. 可观测性

### 10.1 新增日志

| 场景 | 级别 | 固定文案 | 字段 |
|---|---|---|---|
| 前置守卫命中 | warn | `[Story2Video] cloned voice blocked by preflight` | `voiceId`、`provider`、`reason`（`invalid_voice_id`/`sample_storage_missing`） |
| 前置守卫 fail-open | 不额外打日志 | — | 服务缺失/方法缺失/查询抛错时静默放行（避免列表页/每次运行刷屏）；由既有错误链路兜底 |
| 运行期聚合命中 | warn | `[Story2Video] all TTS failures are cloned-voice unavailable; aggregating` | `count`、`provider`、`model` |
| 状态查询 | 不单独打 info | — | 由调用方日志覆盖，避免列表页刷屏 |

字段白名单：`voiceId`（音色 ID）、`provider`（providerId）、`model`、`reason`（枚举）、`count`（数量）、
`error`（截断后的错误消息）。**禁止**记录：音频内容/样本路径/绝对路径/API Key/请求头/完整供应商响应体。

### 10.2 错误码/错误前缀

| 标识 | 位置 | 含义 |
|---|---|---|
| `VOICE_CLONE_UNAVAILABLE`（错误前缀） | `generate_assets` / `finalize_assets` 返回的 `error` 字符串 | 克隆音色在生成前被判定失效（守卫），或运行期全部 TTS 因克隆音色不可用失败（聚合） |
| `VOICE_CLONE_INVALID_ARGUMENTS` | `getCloneVoiceStatus` 信封 | 入参非法 |
| `VOICE_OWNER_UNAVAILABLE` | `getCloneVoiceStatus` 信封 | owner 不可解析 |
| `VOICE_CLONE_STORE_UNAVAILABLE` | `getCloneVoiceStatus` 信封 | 本地设置存储不可用 |
| `story2video.voice_clone_unavailable` | 渲染层 locale 键/通知键 | 用户可见文案（见 §9 #5） |

> 注意：`create.story2video.voice.VOICE_CLONE_UNAVAILABLE`（克隆服务暂时不可用）是**另一个既有错误码**，
> 语义不同（克隆服务不可用 vs 已选音色失效），不得混用。本 PR 的 `errorCode` 元数据只用于
> `story2video` 通知/格式化路径。

### 10.3 判定与取证建议

- 现场排查顺序：① 日志 grep `cloned voice blocked by preflight` / `re-clone fallback failed`；
  ② SQLite `tts-voice-clones:v2:<provider>:<model>` 记录；③ `shared-user-data/voice-clone-samples/<ownerHash>/<storageId>` 是否存在；
  ④ 偏好键是否仍指向该 `voiceId`。
- 对账结论是「本地可重建性」，不是「供应商可用性」：日志中禁止把二者混写。

---

## 11. 验收标准（可证伪）

> 每条都必须能构造出「不满足即失败」的输入/断言；标注 `【已实现】` 表示本 PR 已落地并有回归锁。

- **G1** `listClones` 对「registry active + 样本目录缺失」的记录输出 `invalid:true` 与 `invalidReason:'sample_storage_missing'`；目录存在且含合格音频时**不**输出 `invalidReason`。【已实现】
- **G2** 样本目录存在但为空、或只有扩展名不在 `ALLOWED_AUDIO_EXTENSIONS` 内的文件时，判 `sample_storage_missing`。【已实现】
- **G3** 样本路径为符号链接或非目录时判失效，且不跟随链接读取内容。【已实现】
- **G4** `invalid_voice_id` 与 `sample_storage_missing` 同时命中时，`invalidReason` 取 `invalid_voice_id`。【已实现】
- **G5** `userData` 不可解析、`lstat`/`readdir` 抛非 ENOENT 错误时**不**判失效（fail-open）。【已实现】
- **G6** 无 `sampleStorage` 的历史记录不因样本状态被判失效。【已实现】
- **G7** `getCloneVoiceStatus` 返回 §7.2 的五种形状（有效/失效/未注册/非法入参/owner/store 错误），且调用前后 registry 与偏好逐字节不变（只读）。【已实现】
- **G8** `getCloneVoiceStatus` 遵守 owner 隔离（另一个 owner 查不到）与模型候选回退（用 `speech-2.8-hd` 查询绑定在 `speech-2.8-turbo` 的记录命中）。【已实现】
- **G9** catalog 在失效来源为 `sample_storage_missing` 时同样把克隆移入 `invalidVoices`、移出可选 `voices`、偏好回退默认音色（既有 7.1.16 合同在新增失效来源下成立）。【已实现】
- **G10** 前置守卫命中时：`generateImage`/`generateVideo`/`generateTTS` 调用次数均为 0；错误以 `VOICE_CLONE_UNAVAILABLE: ` 开头，含音色名、原因文案与「本次未生成任何图片与旁白」。【已实现】
- **G11** 守卫 fail-open：克隆服务缺失、缺少 `getCloneVoiceStatus`、查询抛错时任务继续执行（图片/TTS 正常调用）。【已实现】
- **G12** 守卫不误伤：`registered:false`、`invalid:false`、默认音色/非克隆 provider 均放行。【已实现】
- **G13** 运行期 9 条 TTS 均因克隆音色不可用失败时：错误以 `VOICE_CLONE_UNAVAILABLE: ` 开头、含「所选克隆音色已不可用」与「供应商拒绝访问」、不含原始英文、不含 `TTS #`、前缀仅 1 次；`context.generate_assets.resume` 已写入（`total=9`、`completed` 含图片断点）。【已实现】
- **G14** `summarizeAssetFailures` 对相同错误输出 `TTS #1-#3: <msg>`；非连续输出 `TTS #1, #3: <msg>`；单条输出 `TTS #3: <msg>`；索引缺失输出 `TTS #?: <msg>`。【已实现】
- **G15** 渲染层：`VOICE_CLONE_UNAVAILABLE_PATTERN` 命中供应商原文与错误码；通知键映射到 `story2video.voice_clone_unavailable`；zh/en 文案逐字与 §9 #5 一致；格式化器规则顺序早于 `asset_generation_failed`。【已实现】
- **G16** 阶段数量/顺序不变（仍 7 阶段，`generate_assets` 第 5/7），不新增 checkpoint 类型，不静默替换用户音色（守卫/聚合均为失败路径，`tryReCloneVoice` 不调用 `retryFn('default')`）。【已实现】

---

## 12. 测试计划

### 12.1 单元测试

| 层 | 文件 | 用例（对应验收） |
|---|---|---|
| 服务层 | `apps/desktop/electron/services/tts-voice-clone-integrity.test.js` | 缺失目录 → `sample_storage_missing`（G1）；健康目录不标失效（G1）；非法 id 优先（G4）；无 sampleStorage 不判失效（G6）；`getCloneVoiceStatus` 三态（G7）；owner 隔离（G8）；模型候选回退（G8）；非法入参/owner/store 错误码（G7）（共 8 例） |
| 服务层 | `apps/desktop/electron/services/tts-voice-clone-service.test.js` | 既有能力回归：增删改查/样本读取/非法 voice_id 行为不变（委托纯逻辑模块后信封形状不变） |
| 服务层 | `apps/desktop/electron/services/tts-voice-service.test.js` | 失效克隆（含 `sample_storage_missing`）不进入 `voices`、进入 `invalidVoices`、偏好回退默认（G9） |
| 阶段层 | `apps/desktop/electron/services/story2video-voice-guard.test.js` | 守卫命中零调用 + 错误串（G10）；非法 id 原因（G10）；守卫 fail-open 三种（G11）；不误伤两种（G12）；9 条聚合 + resume（G13）；manual finalize 守卫（G10）；`isClonedVoiceUnavailableMessage` 正反例；`summarizeAssetFailures` 四种形态（G14）（共 10 例） |
| 阶段层 | `apps/desktop/electron/services/story2video-stages.test.js` | 既有阶段编排/失败聚合回归（守卫接入与模块拆分后行为不变） |
| 渲染层 | `apps/desktop/src/story2video/story2video-notifications.test.js` | 错误码/原文归一化到新键；zh/en 逐字；不被 `VOICE_INVALID`/TTS 聚合吞掉（G15） |
| 渲染层 | `apps/desktop/src/utils/pipeline-error-formatter.test.js` | `VOICE_CLONE_UNAVAILABLE: ...` 与 `you don't have access...` 均映射 `story2video.voice_clone_unavailable`；顺序早于 `asset_generation_failed`（G15） |
| 渲染层 | `apps/desktop/src/views/CreateView.test.js` | 失效克隆「设为默认」禁用 + 徽标（既有用例，回归） |

### 12.2 回归

- 克隆服务既有能力：`getRequirements` / `createSampleSelection` / `addCloneFromSelection` / `deleteClone` /
  `replaceCloneVoiceId` / `findCloneSamples` 全量回归（不得因新增对账改变既有返回形状）。
- catalog 既有 7.1.16：非法 `voice_id`（`"01"`）用例保持通过。
- story2video：`generate_assets` 正常路径、allowPartialAssets、content_policy checkpoint、resume 续跑、
  manual 候选/最终化、失败聚合既有格式。
- 渲染层：通知/格式化/历史/结果页既有音色错误用例。
- 门禁：`check-text-encoding-integrity`、`check-no-brand-residue`、`check-spec-purpose`、
  `openspec-sync-check`、`check-doc-abs-paths`。

### 12.3 变异反证建议（防止装饰性测试）

| 变异 | 期望变红的用例 |
|---|---|
| M1：`listClones` 去掉磁盘对账（只保留 id 校验） | G1/G2/G3 的服务层用例 |
| M2：`invalidReason` 优先级反转 | G4 |
| M3：`userData` 不可解析/IO 错误时判失效（fail-closed） | G5/G6 |
| M4：守卫改为仅 warn 不返回失败 | G10（零调用断言） |
| M5：删除 `every(...)` 条件、改为 `some(...)` 或保留原始英文 | G13 |
| M6：`summarizeAssetFailures` 不去重 | G14 |
| M7：渲染层删除 `VOICE_CLONE_UNAVAILABLE_PATTERN`，或把规则移到 `VOICE_INVALID` 之后 | G15 |
| M8：守卫改在创建 Promise 之后执行 | G10（零调用断言） |

> 变异必须实际执行并记录「哪几条变红」；没有变红的变异要么补断言，要么如实标注为「不可分辨」并说明原因。

---

## 13. 实现映射（`feat_story2video_voice_clone_integrity`）

| 合同 | 落点文件 | 函数/符号 | 状态 |
|---|---|---|---|
| 磁盘对账 + `invalidReason` | `apps/desktop/electron/services/tts-voice-clone-integrity.js`（纯逻辑）/ `tts-voice-clone-service.js`（薄封装） | `inspectSampleStorage` / `computeCloneInvalidReason` / `buildPublicCloneEntries` + `listClones` | 【已实现】 |
| 只读状态查询 | 同上 | `readCloneVoiceStatus` + `getCloneVoiceStatus` | 【已实现】 |
| catalog 合并/偏好回退 | `apps/desktop/electron/services/tts-voice-service.js` | `_buildCatalogResponse`（**既有，不改**） | 【已实现】（复用） |
| 生成前置守卫 | `apps/desktop/electron/services/story2video-voice-guard.js`（`resolveVoiceCloneGuard` / `buildVoiceCloneUnavailableError`）+ `story2video-stages.js`（两阶段接入） | 共享 helper + `generate_assets` / `finalize_assets` | 【已实现】 |
| 运行期聚合 | 同上 | `buildVoiceCloneAggregateError` + `generate_assets` TTS 失败分支 | 【已实现】 |
| 失败去重/区间 | 同上 | `summarizeAssetFailures`（新增导出，Image/TTS 共用） | 【已实现】 |
| 克隆不可用谓词 | 同上 | `isClonedVoiceUnavailableMessage`（新增导出，`tryReCloneVoice` 与聚合共用） | 【已实现】 |
| 渲染层归一化 | `apps/desktop/src/story2video/notification-error-patterns.js` | `VOICE_CLONE_UNAVAILABLE_PATTERN` | 【已实现】 |
| 通知键 | `apps/desktop/src/story2video/story2video-notifications.js` | `STORY2VIDEO_NOTIFICATION_KEYS.VOICE_CLONE_UNAVAILABLE` + `resolveMessageKey` | 【已实现】 |
| 流水线格式化 | `apps/desktop/src/utils/pipeline-error-formatter.js` | `RULES` 新增 `voice_clone_unavailable`（早于 `asset_generation_failed`） | 【已实现】 |
| 文案 | `apps/desktop/src/locales/story2video/{zh,en}.js` | `voice_clone_unavailable` | 【已实现】 |
| 文档 | `01-docs/PRD.md` §7.1.16.4（两处副本）、本文、OpenSpec change、执行记录、CHANGELOG、learnings | — | 【已实现】 |

**Gate 9 说明**：PR 正文声明 `feat_story2video_voice_clone_integrity`，把审计面收窄到本特性；
`01-docs/PRD.md` §7.1.16.4 的合同行全部带独立 `【已实现】` 标注，避免被当成未实现欠账。

---

## 14. 风险与遗留

| # | 风险/遗留 | 影响 | 缓解/后续 |
|---|---|---|---|
| R1 | 供应商侧撤销但本地样本完好 | 启动前判不出来（只能判本地样本完整性） | 运行期仍会 `tryReCloneVoice` 用样本重建；失败则聚合为可操作提示。**这是设计边界，不是缺陷** |
| R2 | 启动后、生成前样本被外部删除（竞态窗口） | 守卫通过但 TTS 全失败 | 运行期聚合兜底（G13）；错误文案仍可操作 |
| R3 | 样本目录存在但音频损坏/不可解码 | 对账判「有样本」，重克隆可能失败 | 本判据只回答「是否具备本地材料」；解码/时长由克隆链路自身校验；失败走既有错误 |
| R4 | `invalidReason` 为内部字段，不新增 UI 文案 | 用户只看到统一失效提示 | 有意为之（避免同一失效四种说法）；排障靠日志字段 |
| R5 | 配置页/克隆列表的「已失效，请重新克隆」「设为默认」为既有硬编码中文 | en 界面仍显示中文 | 存量 i18n 债务，**非本 PR 范围**；如需修，另立 i18n 切片并成对补 locale |
| R6 | 历史失效记录仍留在 registry | 列表里长期显示失效项 | 用户可删除（删除会清理样本/偏好）；本 PR 不做自动清理（自动删用户数据风险更高） |
| R7 | `deletionState` 非 `active` 的记录 | `getCloneVoiceStatus` 视为未注册；catalog 仍可能展示 | 既有行为（删除流程最终会移除记录）；本 PR 不改删除语义 |
| R8 | 其它 provider 的克隆约束 | 仅 MiniMax 家族有 id 格式约束；其它 provider 恒视为合法 | 既有行为；新增 `sample_storage_missing` 对所有 provider 生效 |
| R9 | 日志中 `[object Object]`（事故第 7 行） | 旧日志的可读性缺陷 | 本 PR 新增字段以结构化对象 + 白名单记录；既有调用点未强制改造，后续可单独治理 |
| R10 | 失败聚合只在「全部失败且全部同因」时触发 | 混合原因仍输出多条（已去重） | 有意如此：混合原因需要逐条可读，不能被一条聚合掩盖 |
| R11 | 对账扩展名用全局 `ALLOWED_AUDIO_EXTENSIONS`，比个别 model 的 `allowedExtensions` 宽 | 例如 MiMo 上传只收 mp3/wav，但目录里若只剩 `.m4a`，对账会判「有样本」继而放行 | 有意取舍：对账回答「本地是否还有材料」，不回答「该模型是否接受」；重克隆/合成阶段仍会按 model 约束失败，由运行期聚合兜底。若要把对账收紧到 model 级，需同时承担「把可诊断失败提前标记为不可恢复」的代价 |

---

## 15. 关联文档

- `01-docs/PRD.md` §7.1.16 / §7.1.16.1 / §7.1.16.2 / §7.1.16.3 / **§7.1.16.4（本次新增，两处副本）**
- `01-docs/PRD-video-creation.md` §1.6 变更记录（本次追加行）
- `openspec/changes/story2video-voice-clone-integrity/{proposal,design,tasks}.md`
  + `specs/story2video-voice-clone-integrity/spec.md`
- `openspec/records/fix-s2v-voice-clone-integrity.md`（执行记录，含 QM-5 五步）
- `CHANGELOG.md` 顶部条目、`01-docs/learnings.md` 顶部教训
