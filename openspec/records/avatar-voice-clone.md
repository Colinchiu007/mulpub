---
record: avatar-voice-clone
task: HeyGen 数字人形象克隆（上传照片/视频 → 长期可复用形象）
date: 2026-10-22
delivered_by_pr: PENDING
---

## 本次执行记录：HeyGen 数字人形象克隆（avatar-voice-clone，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `<仓库父目录>/mp-worktrees/mp-avatar-voice-clone`，裸分支 `avatar-voice-clone`；`scripts/start-mp-task.ps1` 创建，依赖 11 项解析 OK |
| 需求与方案 | ✅ | `openspec/changes/avatar-voice-clone/proposal.md` + `tasks.md`；先查证「声音是否随视频一起生成」再动手（见提案「已查证的 API 形态」） |
| TDD | ✅ | 新增 3 个测试文件共 45 例；heygen adapter 契约锁先 RED（15 例失败）后 GREEN |
| 回归零破坏 | ✅ | 14 个相关测试文件 **242/242** 全绿（含通用 preflight 28 例、暴露面契约 20 例、既有数字人 UI 9 例） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS |
| locale 成对 | ✅ | zh/en 各新增 32 键；`check-locale-sync.js --keys` PASS（2220 keys）、`--cjk` PASS（1125 条，无新增硬编码） |
| 超大文件门禁 | ✅ | `check-max-lines.js` → 无新增超大文件（service 经 4 次拆分：628 → 498 行） |
| QM-1 打包 | ✅ | `pnpm run build:win` exit 0；asar 内含 heygen-clone 与 avatar-clone 模块；启动烟测存活 8s |
| QM-6 CCG 决策层 | ⚠️ 未闭环（如实记录） | 两轮 `plan-review.sh` 均未收敛：轮 1 因提案超 opencode 7800 字符上限中断；轮 2 同样因 proposer 输出超限中断。两轮 11 条 Critical/Warning **全部已处置并落码**（见下） |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导；本行不手写状态词 |

### 已查证的关键事实（动手前）

用户提问「声音克隆是独立的还是生成视频时一起做」——**结论：独立，不一起生成**。三条官方文档证据（本机 DNS 解析不到 `developers.heygen.com`，以下为检索所得原文摘录）：

- `reference/clone-a-voice`：*"Returns a `voice_clone_id` that can be polled via `GET /v3/voices/` until the status is 'complete'. The resulting voice can be used with `POST /v3/voices/speech` and `POST /v3/videos`."*
- `docs/avatar-looks`：*"A look is one outfit/pose/style... **It's the value you pass as `avatar_id` to video creation**."*
- 第三方概念说明：*"**When `voice_id` is omitted, the look's default voice is used**."*

推论：版本段分裂（克隆 `/v3`、视频生成 `/v2`、状态查询 `/v1`），adapter 用 `_v3Url()` 按端点取版本段；「照片或视频」是 `type` 二选一（`photo` / `digital_twin`）。

### QM-6 两轮 11 条问题的处置

| # | 级别 | 处置 | 落点 |
|---|---|---|---|
| i1 | Critical | 采纳 | 形象三方法**不登记** `KNOWN_METHODS`，`callAdapter` 的 `supports()` 闸门会拦下 ⇒ 本轮是预期内 fail-closed（不产生半截状态）；首跑核对字段后才登记 |
| i2 | Critical | 采纳 | 同上；提案「Impact」补了可调用性表 |
| i3 | Critical | 采纳 | 原提案写「删本地记录不影响审计」是**错的**（attestation 放 registry 会随删除丢失）⇒ 改为 append-only 审计日志独立落盘 `userData/audit/avatar-voice-clone.log` |
| i4 | Warning | 采纳 | 补附录划清「视频对标复刻（不做）」与「用户自克隆（做）」的作用域 |
| i5 | Warning | 采纳 | 首跑检查清单写进 `tasks.md` T11 |
| i6 | Warning | 采纳 | 轮询/重试封顶：15 分钟到期标 `failed`（不删远端）；删除重试 TTL 30 天 + 最多 5 次 |
| i7 | Warning | 采纳 | 服务边界表：两 service 不互相调用 |
| i8 | Warning | 采纳 | 目录合并键与优先级（self > third_party_authorized > 公共） |
| i9-i11 | — | 采纳 | 同步落入代码与提案 |

### 新增文件

| 文件 | 行数 | 职责 |
|---|---|---|
| `electron/services/avatar-clone-registry.js` | ~250 | 纯逻辑：安全校验、registry 形状、失效标记、入参归一、训练状态映射 |
| `electron/services/avatar-clone-storage.js` | ~130 | 样本落盘 + append-only 审计日志 |
| `electron/services/avatar-clone-selection.js` | ~175 | 素材两段式中间态（读文件/TTL/过期清理） |
| `electron/services/avatar-clone-remote.js` | ~215 | 远端调用 + 创建/删除编排（含全部补偿路径） |
| `electron/services/avatar-clone-service.js` | 498 | service 主体：owner 隔离、registry 锁、训练轮询 |
| `electron/services/adapters/heygen-clone.js` | ~200 | 5 个克隆方法（prototype mixin，从 heygen.js 拆出以满足 max-lines） |
| `electron/ipc-handlers/avatar-clone.js` | ~175 | 5 通道 IPC |
| `electron/preload/avatar-clone.js` + `src/api/avatar-clone.js` | 20 + 60 | 暴露面 |
| `src/views/video-creation/composables/useAvatarClone.js` | ~230 | 前端状态 |
| 测试 3 个文件 | ~1050 | 45 例 |

### 实现中被测试逼出来的 3 个真缺陷

1. `callAvatarMethod` 用 `result.data` 真值判成功 → 删除类响应体本就没数据，**成功被当失败**（`remoteDeleted` 恒 false）。
2. `_safeExtension` 抽到 storage 模块后 service 调用点没跟着改 → ReferenceError。
3. `avatarClonePanelOpen` / `avatarCloneNameDraft` 误写在 `computed` 块 → Vue 3 无 setter，写入被静默拒绝，面板永远打不开。

### 遗留（不假装已闭合）

- **真实 HeyGen Key 首跑未执行**：`/v3/avatars` 的字段名未经真实响应核对（DNS 解析不到官方站）。首跑 checklist 在 `tasks.md` T11：上传素材 → `avatar_id` → 训练完成 → 用于生成 → 下载成片。
- **QM-6 决策层未收敛**（工具链限制：proposer 输出超 7800 字符上限），不以自审冒充通过。
- **声音克隆的 adapter 侧未接 service**：`cloneVoice`/`deleteVoice` 已在 adapter + `tts-voice-catalog` 登记，但前端没有上传录音的入口（本轮只做形象）。声音克隆需另行立项接 `tts-voice-clone-service` 的第三家 provider。

## CHANGELOG 条目

# feat(video): 数字人形象克隆 —— 上传照片/视频生成可长期复用的 HeyGen 形象（avatar-voice-clone）

- 视频创作「数字人口播」新增「管理克隆形象」：上传一张照片或一段视频，克隆出属于自己的数字人形象，训练完成后直接进形象下拉（带「我上传的」标识），可反复使用。
- 克隆形象按账号隔离存在本地 registry，跟着账号走；删除时同步删 HeyGen 侧资源，远端删除失败会保留本地记录并标记待删、下次重试。
- 首次使用展示一次性法律提示（肖像权/声音权归上传者所有），不强制勾选；创建/删除/重命名/训练状态变更全部落 append-only 审计日志。
- 修正 HeyGen adapter 的克隆端点族：克隆走 `/v3`（`POST /v3/avatars`、`POST /v3/voices/clone`、`DELETE /v3/avatars/looks/{id}`），与视频生成的 `/v2`、状态查询的 `/v1` 分段取值，不再硬拼前缀。

## learnings

### lesson: 查证「是否一起生成」这类语义问题，能省掉整个错误实现

**现场**：用户问「用 heygen 克隆形象并生成数字人视频时，声音克隆是独立分开的，还是 heygen 生成视频时一起生成的」。动手前查证，结论是**独立**——官方文档明言视频生成只传 `voice_id` 引用，不传就用 look 的默认声音。

**根因**：如果没查就按「一起生成」实现，会把 `cloneVoice` 塞进 `generateVideo` 的请求体，整个 service 的边界（两段式、两个 registry、两条轮询）都会建错。

**可复用的 3 条**：

1. 涉及「A 和 B 是否同一次调用」的语义问题，先查官方文档再设计——这类假设错了会让上层架构整体歪掉，且后期很难看出哪里歪。
2. 查证时优先找「请求体里有没有那个字段」的直接证据（`video_inputs` 只有 `character`/`voice` 引用），比找「支持什么能力」的能力清单更准。
3. 官方站 DNS 不可达时，第三方文档摘录可作**方向性**证据，但必须在提案里标注「未经真实响应核对」，并配首跑 checklist——不能把摘录当既定契约。

### lesson: Vue 3 里把可变状态写进 computed 块，写入会被静默拒绝

**现场**：`avatarClonePanelOpen` / `avatarCloneNameDraft` 写在 `computed` 块里，测试报 `Cannot call trigger on an empty DOMWrapper`，Vue warn 只说 `computed property is readonly`——面板按钮始终不出现，但没有任何报错指向真正原因。

**根因**：Vue 3 的 computed 没有 setter 时写入被静默忽略（dev 模式只 warn）。把「本地 UI 状态」和「派生状态」混在一个块里，编译器也不会拦。

**可复用的 2 条**：

1. 可变 UI 状态（开关、草稿输入）一律进 `data`；`computed` 只放派生值。两者混放时，写完 state 要跑一次「点一下按钮」的测试，光看模板存在抓不到这类问题。
2. `_` 前缀是 Vue 保留键（`vue/no-reserved-keys` 会拦），自定义标志位别用 `_` 开头。
