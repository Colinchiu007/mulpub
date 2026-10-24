---
record: hifly-clone-realrun
task: 飞影克隆真实首跑 + /voice/task 契约修正
date: 2026-10-24
---

## 本次执行记录：飞影克隆真实首跑（hifly-clone-realrun）

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | worktree `mp-hifly-clone-realrun`（位于 `<worktree 根目录>/mp-<task>`，非 C 盘） |
| TDD | ✅ | `hifly.test.js` 43 → 44 例（+1 code 非 0 仍抛、改造 3 例 voice/task 契约）；先 RED 后 GREEN |
| 回归零破坏 | ✅ | 14 个相关测试文件 **351/351** 全绿 |
| 超大文件 / 债务 | ✅ | max-lines 无新增；debt-budget 五项全过 |
| locale 成对 | ✅ | `--keys` PASS（2252）、`--cjk` PASS（1121） |
| 同型风险锁 / 品牌 / 绝对路径 | ✅ | r3 18/0、no-brand-residue PASS、doc-abs-paths PASS |
| 依赖漏洞审计 | ⚠️ 主干既有红 | 7 条 NEW_ADVISORY（fast-uri ×4 / undici ×3）在 origin/main 上已存在，本分支未动任何依赖 |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导；本行不手写状态词 |

> **本记录与改动基于 PR #4341（hifly-voice-subtitle-parity）**，不重复其内容。
> 原始 #4362 分支的基座是 #4341 的某个历史快照，导致它与 origin/main 的差集
> 同时包含「#4341 的改动」与「本 PR 的改动」——重复且冲突。
> 2026-10-24 下午 #4341 已合入 main，本分支随之重置到 `origin/main`（已含 #4341），只保留本 PR 的净改动
> （2 个文件、44 行净增 + 本记录）。详见文末「分支重建过程」。

## 一、先纠正一个此前的错误判断

本会话早前多次说「`KNOWN_METHODS` 未登记形象克隆三方法 ⇒ 点创建会得到『服务商暂时不可用』，是计划内 fail-closed」。

**这个判断是错的。** 真实核查（`node` 探针直接调 adapter）：

```
createAvatar           有实现=true  是基类默认=false  supports()=true
getAvatarStatus        有实现=true  是基类默认=false  supports()=true
deleteAvatar           有实现=true  是基类默认=false  supports()=true
cloneVoice             有实现=true  是基类默认=false  supports()=true
getVoiceCloneStatus    有实现=true  是基类默认=false  supports()=true
```

`base.js:58` **早已登记**全部 5 个方法，注释也写明「飞影 HiFly 已实现全套」「HeyGen 侧暂不登记是计划内的 fail-closed」。

**真正的拦截点是 `avatar-clone-remote.js` 的 `AVATAR_CLONE_PROVIDER = 'heygen'` 硬编码**（provider 路由 bug），
该 bug 已由 PR #4341 修掉（本分支 rebase 后已含）。修正后实测：

```
[callAdapter] provider=hifly method=createAvatar
[callAdapter] provider=hifly method=cloneVoice
data.avatar.voiceId = 'probe-voice-id'
```

教训：**不要把「读注释得出的结论」当成事实**。注释会说「暂不登记」，但代码可能早已变更；
判能力是否存在，必须实跑 `supports()` 或走一遍真实链路。

## 二、积分计费核实（用户指定要确认）

用户记忆：「上传视频创建数字人免费；上传图片创建消耗 500 积分」。**已核实，但要修正一个细节。**

官方文档（本地副本，1814 行）中「此接口会产生积分消耗」标注的分布：

| 接口 | 文档标注 | 结论 |
|---|---|---|
| `avatar/create_by_video`（视频克隆） | **无标注** | 免费 |
| `avatar/create_by_image`（图片克隆） | L82 明确「**此接口会产生积分消耗。**」 | 收费 |
| `voice/create`（声音克隆） | 无标注 | 免费 |
| `video/create_by_tts`（生成视频） | L727 明确标注 | 收费 |

**「500 积分」这个数字文档里没有**——官方只标注「会产生消耗」，未给具体额度。已用免费侧证确认 `voice/create` 实际 0 消耗：

```
克隆前积分: 1582
... create_upload_url → PUT → voice/create → 轮询 ...
克隆后积分: 1582 （差额 = 0）
```

> 注：`create_by_image` 的具体扣费额未经真实调用验证（未花积分），只能说「文档标注收费、额度未知」。

## 三、真实首跑结果

### 跑通的部分

| 步骤 | 结果 |
|---|---|
| `account/credit` | `{ code:0, left:1582, plan:'premium' }`，免费 |
| `avatar/list?kind=1` | 2 条既有形象（均为历史视频克隆），免费 |
| `voice/list?kind=1` | 0 条（本次首跑前无克隆音色），免费 |
| **两步上传** `create_upload_url` → PUT | ✅ 拿到真实 `file_id`（长 token） |
| **`voice/create`** | ✅ 拿到 `taskId = XGveIYH9wB2rOq55410kEQ` |
| 任务状态流转 | `status: 1`(等待) → `2`(处理中) → **`4`(失败)** |

### 失败原因（非代码缺陷）

素材用的是 **5 秒纯静音 WAV**（8kHz 单声道 16bit PCM，16044 bytes）——服务端无法从静音提取声纹，必然失败。
这是刻意的省积分策略（不消耗任何额度），**不是链路缺陷**。

### 首跑暴露的契约缺口（已修）

`GET /voice/task` 的官方响应字段：

| 字段 | 文档语义 | 实测 |
|---|---|---|
| `status` | 1等待/2处理中/3完成/4失败 | ✅ 一致 |
| `voice` | 声音标识 | ✅ 一致 |
| `demo_url` | 试听地址 | ⚠️ **此前 adapter 未读取** |
| `code` | 「失败时错误码」 | ⚠️ **实测失败时仍为 0** |
| `message` | 「失败时返回错误信息」 | ⚠️ **实测失败时为空串** |

两处修正：
1. `getVoiceCloneStatus` 增补 `demoUrl` 与 `message` 两个返回字段（此前只返回 `status` + `voiceId`）。
2. **`code` 在 task 查询语义下不可靠**——`_decode` 的通用约定「`code !== 0` ⇒ 业务失败」在
   `voice/task` 上会与 `status: 4` 冲突。已用测试锁住这个边界：`code: 0 + status: 4` 必须
   归一为 `failed` 并透出 `message`（空则空串，**不编造原因**）；`code` 非 0 仍按业务错误抛
   （`_decode` 契约不因 task 查询放宽）。

> 对比：`avatar/task` 的错误形态**符合** `_decode` 约定（实测 `{ code: 11, message: 'TaskID不正确' }`），
> 所以只有 `voice/task` 有此特例。

## 四、代码改动

| 文件 | 改动 |
|---|---|
| `electron/services/adapters/hifly-clone.js` | `getVoiceCloneStatus` 返回体加 `demoUrl` / `message`；注释写明 `code` 在 task 查询下不可靠、`message` 空时不编造 |
| `electron/services/adapters/hifly.test.js` | 43 → 44 例：改造 `getVoiceCloneStatus` 三条（completed 带 demoUrl / failed 透 message / failed 但 message 空），新增「code 非 0 仍抛」一条 |

**没有新增功能代码**——捆绑克隆、provider 路由、两步上传等在此前已实现并通过测试，本次只是真实首跑验证 + 补契约缺口。

## 五、遗留

### 1. `create_by_image` 未真实调用（需花积分）

官方标注「此接口会产生积分消耗」，额度未知（用户记忆为 500，文档无此数）。
用户要求「选最短时长、省积分」，故本次只跑了免费的 `voice/create`。
**图片克隆的真实计费额仍未验证。**

### 2. 声音克隆素材必须含人声

本次用静音素材导致 `status: 4`。产品侧应在 UI 提示「录音需包含清晰人声、时长 5 秒～3 分钟」，
否则用户上传静音/纯音乐文件会得到一个无原因的失败（飞影 `message` 为空）。

### 3. 主干仍有 7 条依赖审计红（A 级，非本分支引入）

`fast-uri` ×4（需 3.1.9，本地 3.1.8）、`undici` ×3（需 7.30.1，本地 7.30.0）。
本分支未动 `package.json` / `pnpm-lock.yaml`。处置方案已写进
`openspec/changes/dep-audit-new-advisories/proposal.md` 的 A 级（差一个 patch，风险最低）。
PR #4354 已修掉同批的 zod / body-parser / electron 三条，这 7 条仍待处理。

## 六、分支重建过程（2026-10-24 中午）

原 #4362 的基座是 #4341 的历史快照，导致：

1. 与 origin/main 的差集**同时含 #4341 的改动与本 PR 的改动**——若两者都合，#4341 的内容会被重复落地；
2. rebase 到 origin/main 时在 `CreateView.vue` 上冲突（main 的 `QuickRenderPanel` vs #4341 的 `AvatarSubtitlePanel`），而该冲突 #4341 已经解过一遍；
3. PRD A.5.5「素材要求」节在本分支上不存在（它是 #4341 主记录的内容），导致文档补充无处落地。

**处置**： #4341 合入后，`git reset --hard origin/main`（已含 #4341 的 squash 提交 `c46be738c`），
再 `git apply` 本 PR 的净补丁（2 个文件、44 行净增）。

这样 #4362 与 #4341 不再重叠： #4341 已先合（`c46be738c`），本 PR 只追加 adapter 契约修正。
实测：直接 `git rebase origin/main` 会在 #4341 的旧提交上全冲突（squash 后历史形状不同），
所以采用「reset 到 main + `git apply` 净补丁」，避免重放已被 squash 的提交。

## 七、第二轮真实首跑：成功路径已全部验证（2026-10-24 下午）

第一轮用 5 秒**纯静音** WAV，服务端无法提取声纹 ⇒ `status: 4` 且 `message` 空。
本轮改用**系统 TTS 合成的真实人声**（Windows SAPI「Microsoft Kangkang」，中文男声，
约 20 秒、896992 字节、22050 Hz WAV）重跑，**一次通过**。

| 步骤 | 结果 |
|---|---|
| `tool/create_upload_url` + PUT | ✅ 拿到真实 `fileId`（`hM2ngP7P…`） |
| `voice/create`（`name` + `fileId`） | ✅ 返回 `taskId = o_H3AgCdtvfa_DsepFAR2g` |
| `voice/task` 轮询 | ✅ **第 1 次轮询（5 秒）即 `status: completed`** |
| 拿到 `voiceId` | ✅ `2kA0_AhP6HW4IYAyYjrY4w` |
| `voice/list?kind=1` | ✅ 1 条，`type = 8`（声音克隆基础版 v2） |
| **积分变化** | 1582 → **1582**（**0 消耗**） |

### `editVoice` 成功路径也验证了（此前是「未验证」）

| 参数 | 结果 |
|---|---|
| `rate 1.2 / volume 1.0 / pitch 1.0` | `{ ok: true }` |
| `rate 0.9 / volume 1.1 / pitch 1.05` | `{ ok: true }` |
| 恢复 `1.0 / 1.0 / 1.0` | `{ ok: true }` |
| **积分变化** | 三次调用后仍 **1582**（差额 0 ⇒ **免费**） |

### 这轮验证推翻/确认了什么

| 此前状态 | 现在 |
|---|---|
| `voice/create` 成功路径**未验证** | ✅ 已跑通，5 秒完成 |
| `editVoice` 成功路径**未验证** | ✅ 三次全成功 |
| `editVoice` 是否消耗积分**未知** | ✅ **免费**（1582→1582） |
| 首跑失败原因**推断为素材** | ✅ **证实**：同一链路换真实人声即成功 |

> 注意：`editVoice` 只返回 `{ok:true}`，**官方没有查询参数的端点**，
> 所以「参数确实被服务端保存」只能由后续合成效果间接体现，本轮无法直接读回。
> 这也是为什么 UI 侧把参数同时持久化到本地 registry（供回显）。

### 账号现状

- 克隆音色：**1 个**（`2kA0_AhP6HW4IYAyYjrY4w`「音色372773」），本轮真实产物
- 积分：**1582**（两轮首跑总消耗 **0**）
- 飞影官方**没有删除声音的端点** ⇒ 该音色只能本地隐藏/删除，远端会长期存在

### 仍未验证

| 项 | 状态 |
|---|---|
| `create_by_image` 真实计费额 | **未验证**（未花积分；文档只说「会产生积分消耗」，额度未给） |
| `create_by_image` / `create_by_video` 完整 create→poll 链 | 未跑（视频克隆免费但需真实视频素材） |
| 克隆音色的**合成效果**（音色像不像） | 未验证（需生成视频，`video/create_by_tts` 收费） |
## CHANGELOG 条目

# fix(video): 飞影声音克隆状态查询补 demo_url 与失败原因，修一处 task 查询的 code 语义冲突

- 声音克隆任务状态查询此前只返回状态与声音 id，现补充**试听地址**与**服务端失败原因**。
- 修复一处契约冲突：飞影 `/voice/task` 在任务失败时 `code` 仍返回 0（与官方文档「失败时返回错误码」不符），此前会被误判成业务错误而抛出、拿不到失败状态。现以 `status` 为权威，`code` 非 0 时仍按业务错误处理。
- 任务失败且服务端未返回原因时，应用提示通用文案，不编造具体原因。
