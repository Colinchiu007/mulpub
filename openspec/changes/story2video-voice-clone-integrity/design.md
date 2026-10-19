# 设计：克隆样本完整性对账 + 生成前置守卫

## 1. 问题拆解

| # | 问题 | 本质 | 本次做法 |
|---|------|------|---------|
| P1 | registry 有 active 记录，但本地样本目录已被删 | 「有记录」被当成「可用」；持久化缺少存在性对账 | `listClones` 只读对账 + `invalidReason`；`getCloneVoiceStatus` 供守卫消费 |
| P2 | 失效克隆仍出现在可选音色里 | 失效判定只有 voice_id 格式一个来源 | 在 `listClones` 打标，catalog 既有 `invalidVoices` 通道自动继承 |
| P3 | 生成阶段零前置检查，9 条 TTS 白跑 | 可预判的失败被推给运行期 | `generate_assets` / `finalize_assets` 前置守卫，零资源调用即失败 |
| P4 | 9 条相同英文错误逐条拼接 | 失败聚合按条输出，无去重/无聚合 | 相同错误去重 + 场景区间；全同因时聚合为单条 |
| P5 | 用户只看到不可操作英文 | 渲染层模式未覆盖「没有访问权」 | 新增 pattern + 通知键 + zh/en 文案，且顺序早于通用素材失败 |

## 2. 方案选择与备选方案

### D1（采纳）在 `listClones` 打标，而不是在 catalog 过滤

- `listClones` 是 registry 记录进入应用语义层的唯一入口，也是唯一同时持有 owner 与 `userData`
  上下文的位置；在这里做对账，`invalid` 能同时被 catalog（`invalidVoices`）、前端克隆列表
  （徽标/禁用「设为默认」）与流水线守卫消费。
- 备选 A：在 `_buildCatalogResponse` 过滤。拒绝理由：catalog 只服务「音色下拉」，克隆列表
  与流水线拿不到失效信息；且 catalog 会为了展示而读取文件系统，职责越界。
- 备选 B：独立后台巡检任务定期清理 registry。拒绝理由：需要调度与写操作，超出只读修复；
  且「巡检间隔内」仍会失败——守卫仍是必需的。

### D2（采纳）打标但不自动修复/不自动删除

- 失效记录保持原样（registry 不动），让用户显式删除或重新克隆。
- 拒绝「自动删除失效记录」：样本目录可能只是临时不可见（外接盘/同步延迟），自动删用户数据
  风险高于收益；且删除会同时清偏好，用户可能只想改选音色。

### D3（采纳）三态 `ok / missing / unknown` 的 fail-open 边界

| 状态 | 触发 | 是否判失效 |
|---|---|---|
| `ok` | `sampleStorage` 合法、userData 可解析、目录存在且非符号链接、目录内至少一个音频扩展名文件 | 否 |
| `missing` | `sampleStorage` 形状不安全、目录 ENOENT、非目录、符号链接、目录内无音频扩展名文件 | 是（`sample_storage_missing`） |
| `unknown` | 无 `sampleStorage`（历史记录）、userData 不可解析、`lstat`/`readdir` 抛非 ENOENT 错误 | 否（不判失效） |

**为什么 `unknown` 不判失效**：本能力是「增强可发现性」，不是安全边界。`userData` 不可解析
（测试/浏览器/旧主进程）与「样本真的丢了」在证据上不同；把前者判失效会造成假阻断，而假阻断
会逼用户删除有效记录。失败方向选「放行」——运行期仍有守卫之外的聚合兜底。

**输入侧相反**：`sampleStorage` 形状不安全（非三段、owner 不匹配、含 `..`/分隔符/超长）时
不做任何文件系统探测，直接判 `missing`。这是安全方向：不越权探测、不跟随可疑路径。

### D4（采纳）`getCloneVoiceStatus` 返回 code/data 信封、永不 null

- 与 `listClones` / `deleteClone` 等服务方法保持同一信封风格；调用方（守卫）可以统一用
  `status.code === 0 && status.data` 判定。
- 错误码复用既有：`VOICE_CLONE_INVALID_ARGUMENTS` / `VOICE_OWNER_UNAVAILABLE` /
  `VOICE_CLONE_STORE_UNAVAILABLE`。
- **只读**：不写 registry/偏好，不清理样本；这样守卫可以在每次生成前调用而不产生副作用。
- 模型候选回退与 `findCloneSamples` 同风格：恢复任务的 `voiceModel` 可能缺失或已变化，
  仅按精确 model 查会漏掉有效记录。

### D5（采纳）守卫放在「资源调用之前」，且 fail-open

- `generate_assets`：位于 `writeAssetsProgress()` 之后（保持既有同步进度写入与测试锁定）、
  任何 image/video/TTS Promise 创建之前。
- `finalize_assets`：位于 voice provider/model 解析之后、任何 TTS 任务创建之前。
- 两处复用同一共享 helper `resolveVoiceCloneGuard`（`story2video-voice-guard.js`，返回错误串或 null），错误串由 `buildVoiceCloneUnavailableError` 构造，形状逐字一致。
- **为什么 manual 候选阶段不阻断**：manual 的 `generate_assets` 只生成候选图片/视频，不生成 TTS；
  此时阻断会让用户「连素材都不能选」，而失效影响的只是旁白。TTS 在 `finalize_assets` 生成，
  在那里守卫即可保证「不浪费任何 TTS 调用」。
- **fail-open**：服务缺失/方法缺失/查询抛错/非 0 信封一律放行。守卫是增强，不是可用性依赖；
  把守卫故障变成任务失败会放大故障面。

### D6（采纳）运行期聚合以「全部 TTS 失败且全部同因」为条件

- 只有 `failedTts.length > 0 && failedTts.every(isClonedVoiceUnavailableMessage)` 才聚合；
  混合原因（网络/额度/内容政策）继续走既有 `summarizeAssetFailures`（已去重），
  避免把不同原因掩盖成一条。
- 聚合前**先写** `context.generate_assets.resume`：用户仍可「从断点继续」，不会因为聚合错误
  丢掉已完成的图片/视频断点。
- 聚合文案不包含原始英文、不含 `TTS #N`：原始英文对用户零信息增量，且重复会稀释可操作提示。

### D7（采纳）失败聚合去重格式

- 归一化：`trim` + 连续空白压成一个空格 + 截断 500 字符（沿用旧实现）。
- 分组：按归一化后的 message，`Map` 保持首次出现顺序。
- 索引：已知索引排序后判断连续；连续 ≥2 输出 `#1-#3`，否则 `#1, #3`；单条 `#3`；
  含缺失索引追加 `, #?`；全部缺失 `#?`。
- Image/TTS 共用同一实现与格式，避免两套说辞。

### D8（采纳）渲染层：新增更具体的模式，且顺序优先

- `VOICE_CLONE_UNAVAILABLE_PATTERN` 同时匹配后端稳定前缀与供应商原文
  （`don't/do not/cannot/can't have access ... voice` 等）。
- `resolveMessageKey` 中必须早于 `VOICE_INVALID_PATTERN`：后者只覆盖「音色本身无效/不存在」，
  匹配不到「没有访问权」这一更具体语义。
- `pipeline-error-formatter` 中必须早于 `asset_generation_failed`：事故原始错误以
  `Asset scene generation failed:` 开头，落到后者会被误判成素材/API 配额问题（不可操作）。
- 文案只在 locale 维护（zh/en 成对），服务层不硬编码用户文案（既有约定；守卫错误串是
  「机器可读前缀 + 中文诊断」，最终展示走 locale）。

## 3. 判定顺序（单一实现）

```
getCloneVoiceStatus(input):
  1. 入参校验（providerId/model 安全标识符；voiceId 安全且 ≤256）→ 失败 VOICE_CLONE_INVALID_ARGUMENTS
  2. owner 解析 → 失败 VOICE_OWNER_UNAVAILABLE
  3. store 可用性 → 失败 VOICE_CLONE_STORE_UNAVAILABLE
  4. 候选模型列表：精确 model + 已知 TTS 模型（去重）
  5. 对每个候选 registry：
       a. 读失败 → VOICE_CLONE_STORE_UNAVAILABLE
       b. 找 id 相同且 deletionState=active 的记录；未命中继续下一个候选
       c. voice_id 合法性 → invalid_voice_id
       d. _sampleStorageStatus → ok / missing / unknown
          - missing → sample_storage_missing
          - ok / unknown → 有效
       e. 返回 registered:true
  6. 全部候选未命中 → registered:false
```

`listClones` 对每条记录执行 5c–5d，输出 `invalid`/`invalidReason`（有效记录不带 reason）。

## 4. 数据契约

### 4.1 `getCloneVoiceStatus`

请求：`{providerId: string, model: string, voiceId: string}`

| 情形 | 响应 |
|---|---|
| 有效 | `{code:0, data:{registered:true, name, invalid:false, invalidReason:null}}` |
| 失效 | `{code:0, data:{registered:true, name, invalid:true, invalidReason:'invalid_voice_id'\|'sample_storage_missing'}}` |
| 未命中 | `{code:0, data:{registered:false}}` |
| 非法入参 | `{code:-1, message:'VOICE_CLONE_INVALID_ARGUMENTS'}` |
| owner 不可解析 | `{code:-1, message:'VOICE_OWNER_UNAVAILABLE'}` |
| store 不可用 | `{code:-1, message:'VOICE_CLONE_STORE_UNAVAILABLE'}` |

### 4.2 守卫错误串

```
VOICE_CLONE_UNAVAILABLE: 所选克隆音色「<name>」已失效（<原因>），请在「声音」设置中重新克隆或改选其它音色后重新启动；本次未生成任何图片与旁白。
```

`<原因>`：`sample_storage_missing` → `本地克隆样本已丢失，供应商也可能已不再受理该音色`；
`invalid_voice_id` → `音色 ID 不合法`；其它 → `音色已不可用`。

### 4.3 运行期聚合错误串

```
VOICE_CLONE_UNAVAILABLE: 所选克隆音色已不可用（供应商拒绝访问，且本地样本无法用于重新克隆）。请在「声音」设置中重新克隆或改选其它音色后重新启动。
```

### 4.4 失败聚合格式

| 形态 | 输出 |
|---|---|
| 单条 | `TTS #3: <message>` |
| 连续 2 条及以上 | `TTS #1-#3: <message>` |
| 非连续 | `TTS #1, #3: <message>` |
| 索引缺失 | `TTS #?: <message>` |
| 部分缺失 | `TTS #1, #3, #?: <message>` |

## 5. 改动面

| 层 | 文件 | 说明 |
|----|------|------|
| 主进程 | `apps/desktop/electron/services/tts-voice-clone-integrity.js` | 纯逻辑：`inspectSampleStorage`、`computeCloneInvalidReason`、`buildPublicCloneEntries`、`readCloneVoiceStatus`、`findCloneSamplesWithRuntime`（fs/store 依赖注入） |
| 主进程 | `apps/desktop/electron/services/tts-voice-clone-service.js` | 薄封装：`listClones` / `getCloneVoiceStatus` / `findCloneSamples` 注入 store/owner；`_sampleStorageStatus` 委托纯逻辑模块 |
| 主进程 | `apps/desktop/electron/services/story2video-voice-guard.js` | `resolveVoiceCloneGuard`、`buildVoiceCloneUnavailableError`、`buildVoiceCloneAggregateError`、`isClonedVoiceUnavailableMessage`、`summarizeAssetFailures` |
| 主进程 | `apps/desktop/electron/services/story2video-stages.js` | 接入保留字段并重导：`generate_assets` / `finalize_assets` 守卫、运行期聚合分支 |
| 渲染层 | `apps/desktop/src/story2video/notification-error-patterns.js` | 新增 `VOICE_CLONE_UNAVAILABLE_PATTERN` |
| 渲染层 | `apps/desktop/src/story2video/story2video-notifications.js` | 新通知键 + `resolveMessageKey` 顺序 |
| 渲染层 | `apps/desktop/src/utils/pipeline-error-formatter.js` | 新规则（早于 `asset_generation_failed`） |
| 文案 | `apps/desktop/src/locales/story2video/{zh,en}.js` | `voice_clone_unavailable` 成对 |
| 测试 | 上述模块对应 `.test.js` | 服务层 8 例、阶段层 10 例、渲染层若干 |
| 文档 | 新 PRD / PRD.md / PRD-video-creation / change / record / CHANGELOG / learnings | — |

**不改**：`tts-voice-service.js`（catalog 既有合同自动继承）、数据库 schema、IPC 既有通道、
阶段数量与顺序、checkpoint 类型。

## 6. 测试策略

- **服务层**（`electron/services/tts-voice-clone-integrity.test.js`，8 例）：真实临时目录 + 注入 userData；覆盖目录缺失/完好/空目录/符号链接/无 sampleStorage/非法 id 优先级/owner 隔离/模型回退/错误码。用 `vi.spyOn` 断言对账只读（不改 registry/偏好）。
- **服务层回归**（`tts-voice-clone-service.test.js`）：既有增删改查/样本读取/非法 voice_id 行为与信封形状不变。
- **阶段层**（`electron/services/story2video-voice-guard.test.js`，10 例 + `story2video-stages.test.js` 回归）：替身 clone service 返回三态；断言守卫命中时 `generateImage/generateVideo/generateTTS` 零调用、错误串前缀与关键片段；fail-open 三种（服务缺失/方法缺失/抛错）；不误伤两种；运行期 9 条同因失败聚合且 resume 写入；manual finalize 守卫；`summarizeAssetFailures` 四形态。
- **渲染层**：错误码与供应商原文都归一化到新键；zh/en 逐字；顺序锁（新规则早于
  `VOICE_INVALID` / `asset_generation_failed`）。
- **变异反证**：见详细 PRD §12.3（去对账、反转优先级、fail-closed、守卫 warn-only、聚合条件
  改 `some`、不去重、删/移动渲染规则、守卫放到 Promise 之后）。

## 7. 兼容性

- `listClones` 的既有返回字段不变，只在失效时**新增** `invalid`/`invalidReason`。
- `getCloneVoiceStatus` 是纯新增方法；旧主进程没有它时守卫 fail-open。
- `summarizeAssetFailures` 输出格式对「单条失败」与旧格式一致；多条相同错误从「重复 N 条」
  变成「一条 + 区间」，属预期改进。
- 不改 `lastOptions` 字段：失效 `voiceId` 仍会被保存（用于下次复现提示），由 catalog 回退与
  守卫共同消化。
