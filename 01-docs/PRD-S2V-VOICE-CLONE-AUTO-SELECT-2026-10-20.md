# PRD：克隆音色成功后「语音 / 音色 ID」下拉自动切换选中项（2026-10-20）

| 项 | 内容 |
|----|------|
| 文档编号 | `PRD-S2V-VOICE-CLONE-AUTO-SELECT-2026-10-20` |
| 状态 | 已实现（随分支 `s2v-voice-clone-auto-select` 落地）【已实现】 |
| 关联 OpenSpec change | 无（M 级 UI/UX + 缺陷修复，未建 change；执行记录为唯一强制载体） |
| 关联执行记录 | `openspec/records/s2v-voice-clone-auto-select.md` |
| 实现特性标识 | `feat_s2v_voice_clone_auto_select`（Gate 9 PR 正文声明用） |
| 修复前代码基线 | `74dd83ede`（`origin/main`） |
| 主 PRD 合同 | `01-docs/PRD.md` §7.1 音色域（本分支已同步补充：数据校验 3 行 / 流程 2 步 / 交互 2 行 / 不变式 3 行） |
| 影响面 | `apps/desktop/src/views/video-creation/composables/` 渲染层 3 文件 + 1 测试文件；**未改**任何模板、样式、DOM、主进程、locale 文件 |

> 本文是**缺陷修复 + 合同补全**文档。用户诉求的「克隆成功后自动切换下拉选中项」这一主路径
> **在基线里就已实现**（`tts-voices-clone.js` 的 `addS2VVoiceClone`），但有三个缺陷让它在
> 普通使用中失效或给出错误反馈。本文逐个定义缺陷、修复后的数据校验、流程、交互逻辑、
> 显示项与提示文字，并给出可证伪的验收判据。

---

## 1. 需求与现状判定

### 1.1 用户原话（诉求）

> 视频创作-故事讲述流水线页，声音选项区域，在音色复制/克隆区域，如果新添加了本地的音色文件
> （被克隆的样本）后，也就是有了新的自定义音色后，默认语音 / 音色 ID 的下拉列表中所选的 ID
> 自动切换为新添加的自定义音色。这样更符合用户的想法。

### 1.2 页面定位

| 项 | 值 |
|---|---|
| 页面 | 视频创作 → 故事讲述流水线（`story2video-compose`）配置详情 |
| 壳组件 | `apps/desktop/src/views/CreateView.vue`（`S2vConfigPanels` 仅在 `isOrchestratedPipeline(selectedPipeline?.name)` 为真时渲染） |
| 配置面板 | `apps/desktop/src/views/video-creation/S2vConfigPanels.vue` |
| 折叠区 | 「声音」（`s2v-section-voice`）→ 子分区「旁白设置」（`s2v-subgroup-voiceNarration`）+「背景音乐」+「音色复制 / 克隆」（`s2v-subgroup-voiceClone`） |
| 目标控件 | 「语音 / 音色 ID」下拉（`UiSelect`，`id="s2v-voice-catalog"`，`v-model="s2vConfig.voiceId"`，模板 `S2vConfigPanels.vue:363-386`） |
| 触发区 | 「音色复制 / 克隆」面板（`voice-clone-panel`，模板 `S2vConfigPanels.vue:459-533`）：选择本地音频文件 → 自动入库 |

### 1.3 现状判定（不是从零实现）

| 环节 | 基线状态 | 证据 |
|---|---|---|
| 新克隆音色成为下拉候选 | ✅ 已实现 | `tts-voices-state.js:179-186` `s2vVoiceOptions` 合并 `s2vVoiceCatalog` + `s2vVoiceClones` 并按 id 去重 |
| 克隆成功后选中项切换 | ✅ 已实现（happy path） | `tts-voices-clone.js:98-99`：`voiceId = voice.id` → `selectS2VVoice(voice.id)` |
| 偏好持久化 | ✅ 已实现 | `tts-voices-shared.js` `selectS2VVoice` → `selectTtsVoice` IPC → 主进程 `tts-voice-preference:v1:<providerId>:<model>` |
| MiMo TTS 克隆音色特例 | ✅ 已实现 | `tts-voices-shared.js:203-205`：`mimo-clone-*` 音色偏好落到 `mimo-v2.5-tts-voiceclone` 键域 |
| **偏好失败时回滚** | ❌ **空操作（R1）** | `tts-voices-shared.js:231` 锚点捕获时机晚于 `tts-voices-clone.js:98` 的写入 |
| **失败文案兜底分支** | ❌ **死代码（R2）** | `tts-voices-shared.js:213-215 / 240-242` 的 `a \|\| b ? a : c` 三元 |
| **目录刷新失败时保留选中项** | ❌ **被抹掉（R3）** | `useTtsVoices.js:158-160` 无条件 `voiceId = ''` |
| 克隆路径失败分支测试覆盖 | ❌ 零覆盖 | 既有 `useTtsVoices.test.js` 20 例无一条驱动 `addS2VVoiceClone` / `selectS2VVoice` |

---

## 2. 数据校验、判定规则与边界

### 2.1 音色条目归一（既有，本次不改）

| 字段 | 校验 | 非法时 |
|---|---|---|
| `id` | 非空字符串（`toS2VVoiceOption` trim 后） | 返回 `null`，从列表剔除 |
| `name` | 非空字符串 | 返回 `null`，从列表剔除 |
| `invalid` | `=== true` 才为真 | 视为可用；`invalid` 项在下拉中 `:disabled` 展示，克隆行显示「已失效，请重新克隆」徽标且「设为默认」禁用 |

### 2.2 自动切换的前置条件（必须全部满足）

| # | 条件 | 不满足时的行为 |
|---|---|---|
| 1 | 克隆 IPC `addTtsVoiceClone` 返回 `code === 0` 且 `data.voice` 可归一为非空 `{id, name}` | 走克隆失败路径：清空选择令牌与占位行、显示 `cloneAddFailed`，**不写** `voiceId` |
| 2 | 克隆请求上下文仍是最新的（`isCurrentS2VVoiceCloneRequest(requestId, context)` 为真） | 过期结果**整体丢弃**，不写 `s2vVoiceClones`、不写 `voiceId`、不弹 toast |
| 3 | 语音上下文可解析（`getS2VVoiceContext()` 非空，即 provider 已注册且运营默许模型可解析） | `selectS2VVoice` 直接 `return false`，`voiceId` 保持在切换前的值 |
| 4 | 目标音色在当前 `s2vVoiceOptions` 集合内 | `selectS2VVoice` 报 `selectionNotInCatalog` 并 `return false` |

> 条件 2 是本次修复**特意加测试锚定**的一条：用户中途切换语音生成器时，
> `handleS2VVoiceProviderChange` 会把 `voiceId` 清空并让 `loadS2VVoiceData` 自增两个 requestId，
> 此时克隆结果必须被丢弃，不得把旧 provider 的克隆音色写成新上下文的选中项。

### 2.3 选中项归一规则（`loadS2VVoiceData` 收尾，本次改 R3）

| 分支 | 条件 | 动作 |
|---|---|---|
| A | 目录返回的 `selectedVoiceId` 非空且 ∈ 可用集合 | `voiceId = selectedVoiceId`；`s2vPersistedVoiceId = selectedVoiceId` |
| B | 已配置 `voiceId` 非空且 ∈ 可用集合 | 保留 `voiceId`；`s2vPersistedVoiceId = configuredVoiceId` |
| **C（新增）** | 已配置 `voiceId` 非空 **且 `catalogData` 为空**（目录本次没返回） | **不清空** `voiceId`（克隆音色独立于 catalog 存在；刷新失败不得抹掉用户刚克隆的音色） |
| D | 其它（目录返回了但音色不在其中 / 无已配置值） | `voiceId = ''` |

分支 C 是空实现分支（只写注释不写代码），刻意如此：它的语义是「不要做 D」。

### 2.4 回滚锚点契约（本次新增，R1 的修复本体）

```
selectS2VVoice(voiceId, rollbackVoiceId?)
  ├─ rollbackVoiceId 缺省        → 锚点 = 进入函数时的 s2vConfig.voiceId（旧行为，向后兼容）
  └─ rollbackVoiceId 显式传入    → 锚点 = 入参值
```

| 调用方 | 进入函数前是否已写 `voiceId` | 是否必须传锚点 |
|---|---|---|
| 下拉 `@change` → `handleS2VVoiceSelection` | 否（`v-model` 已写，但值与目标相同，锚点取到目标值无副作用） | 否 |
| 克隆列表「设为默认」→ `selectS2VVoice(id)` | 否 | 否 |
| **克隆成功自动切换**（`addS2VVoiceClone`） | **是**（`voiceId = voice.id` 在调用前一行） | **是**，必须传克隆前的值 |

**为什么必须传**：`selectS2VVoice` 内部先乐观同步 `voiceId = normalizedVoiceId`（为了让并发守卫
命中本次请求、让「默认」徽标即时反馈），失败时再把 `voiceId` 写回锚点。若调用方在进入前已把
目标值写进 `voiceId`，默认锚点就成了目标值本身 ⇒ 回滚写回同一个 id ⇒ **空操作** ⇒ 下拉停留
在一个从未持久化的音色上。

### 2.5 失败文案映射（本次改 R2）

```
friendlyVoiceCatalogError(message)
  ├─ 命中映射表（26 个已知错误码）  → 取该码对应的 locale 文案
  └─ 未命中                        → 取调用点指定的兜底键
```

| 调用点 | 兜底键 | 中文文案 |
|---|---|---|
| `clearTtsVoicePreference` 失败 | `create.story2video.voice.defaultVoiceRestoreFailed` | 恢复默认音色失败 |
| `selectTtsVoice` 失败 | `create.story2video.voice.selectionSaveFailed` | 默认音色保存失败 |

**禁止写法**：`friendlyVoiceCatalogError(m) || X ? friendlyVoiceCatalogError(m) : d.t('兜底键')`。
`||` 优先级高于 `?:`，条件恒为真（未命中映射时 `X` 也返回非空 message），冒号后分支永不可达。

### 2.6 边界与异常

| 场景 | 行为 |
|---|---|
| 克隆 IPC 抛异常（未知 reject） | 清空选择令牌与占位行，显示 `cloneAddFailed`；`voiceId` 不被写入 |
| 偏好 IPC 失败 | 回滚到克隆前选中项；**不弹**成功 toast；错误文案显示在下拉旁 |
| 用户中途切换语音生成器 | 克隆结果整体丢弃；新上下文从空 `voiceId` 开始 |
| 用户中途删除该克隆音色 | `deleteS2VVoiceClone` 的回退逻辑接管（回退到首个可用音色） |
| 新克隆音色被标记 `invalid` | 理论上不可达（样本刚写入、`listClones` 对账在入库前完成）；若发生，主进程返回 `VOICE_NOT_IN_CATALOG` ⇒ 走偏好失败路径回滚 |
| 目录请求进行中（`s2vVoiceCatalogLoading === true`） | 下拉 `:disabled`，但**选中值不变**（新音色已在 `s2vVoiceOptions` 中，不依赖 catalog） |
| MiMo TTS | 克隆 ID 形如 `mimo-clone-<uuid>`；`selectS2VVoice` 自动把偏好写到 `mimo-v2.5-tts-voiceclone` 键域；「语音模型」下拉隐藏，模型由音色类型驱动 |

---

## 3. 流程（功能逻辑）

### 3.1 主流程：克隆成功后自动切换

```
用户点击「选择本地音频文件」
  → chooseS2VVoiceCloneSamples()
      → chooseTtsVoiceCloneSamples IPC（主进程弹系统文件选择器）
      → 返回 { selectionId, samples[] }
      → 记入 state.s2vVoiceCloneSelection
      → 释放「选择中」加载态
      → 自动调 addS2VVoiceClone(nextS2VVoiceCloneName())
          → state.s2vVoiceClonePending = { id: 'pending-<requestId>', name, sampleCount }   // 占位行
          → addTtsVoiceClone IPC（consent: true）
          → 成功：
              a. state.s2vVoiceClones = [...去掉同 id 的旧项, 新音色]      // 立刻成为下拉候选
              b. state.s2vVoiceCloneSelection = null
              c. state.s2vVoiceClonePending = null
              d. const previousVoiceId = s2vConfig.voiceId                // ★ 必须在 e 之前
              e. s2vConfig.voiceId = voice.id                             // 乐观同步
              f. const ok = await selectS2VVoice(voice.id, previousVoiceId)
              g. ok === true  → 弹 cloneSuccessToast（含新音色名）
                 ok === false → 不弹 toast；错误文案已在 selectS2VVoice 内写入 s2vVoiceCatalogError
          → 失败：
              → 清空 selection / pending，显示 cloneAddFailed；不写 voiceId
```

### 3.2 `selectS2VVoice(voiceId, rollbackVoiceId?)` 内部流程

```
1. voiceId 缺省 → 取 s2vConfig.voiceId
2. context = getS2VVoiceContext()；为空 → return false
3. MiMo 且 voiceId 以 'mimo-clone-' 开头 → selectContext.model = 'mimo-v2.5-tts-voiceclone'
4. normalizedVoiceId = trim(voiceId)
5. normalizedVoiceId 为空（恢复默认）:
     → clearTtsVoicePreference IPC
     → 失败：s2vVoiceCatalogError = friendlyVoiceCatalogError(msg) || defaultVoiceRestoreFailed；return false
     → 成功：voiceId = data.selectedVoiceId；s2vPersistedVoiceId 同步；清错误；return true
6. normalizedVoiceId 不在 s2vVoiceOptions 内 → selectionNotInCatalog；return false
7. previousVoiceId = rollbackVoiceId ?? s2vConfig.voiceId       // ★ 锚点
8. s2vConfig.voiceId = normalizedVoiceId                        // 乐观同步
9. selectTtsVoice IPC
10. 并发守卫不过 → return false（不写任何状态）
11. code !== 0:
      → s2vConfig.voiceId = previousVoiceId                     // 回滚
      → s2vVoiceCatalogError = friendlyVoiceCatalogError(msg) || selectionSaveFailed
      → return false
12. 成功：s2vPersistedVoiceId = data.selectedVoiceId ?? normalizedVoiceId；清错误；return true
```

### 3.3 删除当前选中音色的回退（既有，本次补 composable 层测试）

```
deleteS2VVoiceClone(id)
  → confirmDanger 二次确认（标题/正文点名音色名 + 不可恢复后果）
  → deleteTtsVoiceClone IPC
  → 成功：从 s2vVoiceClones 与 s2vVoiceCatalog 双删
  → 若被删的是当前选中项：
        fallback = s2vVoiceOptions[0]?.id || ''
        s2vConfig.voiceId = fallback
        s2vPersistedVoiceId = ''
        fallback 非空 → await selectS2VVoice(fallback)
```

---

## 4. 交互逻辑

| 交互 | 行为（修复后） |
|---|---|
| 选择本地音频文件 | 弹系统文件选择器；按钮禁用但文案保持「选择本地音频文件」（不提前显示「正在添加…」） |
| 选定文件返回 | 按钮文案切「正在添加…」；克隆列表顶部出现占位行（新音色名 + 「创建中…」+ spinner）；状态行显示「已选择 N 个样本，正在上传并克隆音色…（通常 10-60 秒，请稍候）」 |
| **克隆成功** | 占位行替换为真实行；**「语音 / 音色 ID」下拉选中项自动切到新音色**；克隆行显示「默认」徽标；弹出轻提示「已添加克隆音色「音色001」」 |
| **偏好持久化失败** | 克隆行仍显示（克隆事实成立）但**无**「默认」徽标；**下拉回滚到克隆前的选中项**；下拉旁以 `inline-error` 显示失败原因（如「默认音色保存失败…」）；**不弹**成功轻提示 |
| 克隆 IPC 失败 | 占位行消失；克隆区显示 `inline-error`（如「音色克隆服务暂时不可用，请稍后重试」）；下拉选中项不变 |
| 中途切换语音生成器 | 克隆结果整体丢弃；新 provider 上下文从空 `voiceId` 重新加载 |
| 点击「刷新音色列表」 | 下拉进入 disabled；**刷新失败时不清空当前选中项**（分支 C），仅显示错误与「刷新音色列表」入口 |
| 删除被选中的克隆音色 | 二次确认 → 删除 → 回退到首个可用音色并重新持久化 |
| 重命名 | 回车保存 / Esc 取消；空名称禁用保存；重命名保留 `invalid` 标记 |

---

## 5. 显示项与提示文字

### 5.1 显示项

| 元素 | 位置 | 说明 |
|---|---|---|
| 「语音 / 音色 ID」下拉 | 声音区 → 旁白设置子分区 | 首项「使用服务商默认音色」+ 目录音色 + 克隆音色；失效音色 option `:disabled` 并附「（已失效，请重新克隆）」 |
| 音色目录骨架 | 下拉下方 | `s2vVoiceCatalogLoading` 时显示 `UiSkeleton`（text，宽 120px） |
| 「刷新音色列表」按钮 | 下拉下方 | 仅瞬时/未知错误时出现（`s2vVoiceCatalogRefreshable`） |
| 克隆占位行 | 克隆列表顶部 | 新音色名 + 「创建中…」徽标 + spinner |
| 克隆行「默认」徽标 | 克隆列表行内 | `isS2VDefaultVoice(voice.id)` 为真时显示（判据是 `s2vConfig.voiceId === voice.id`） |
| 「已失效，请重新克隆」徽标 | 克隆列表行内 | `voice.invalid === true` 时显示 |
| `inline-error` | 音色下拉旁 / 克隆区内 | 目录错误、选择失败、克隆错误共用通道 |

### 5.2 提示文字（键位全部在 `create.story2video.voice.*`，zh/en 成对；**本次未新增/修改任何 locale 键**）

| 场景 | 键 | 中文（既有值，逐字不变） |
|---|---|---|
| 克隆成功轻提示 | `cloneSuccessToast` | 已添加克隆音色「{name}」 |
| 克隆进行中状态 | `cloneStatusPending` | 已选择 {count} 个样本，正在上传并克隆音色…（通常 10-60 秒，请稍候） |
| 按钮：选择文件 | `cloneSelectButton` | 选择本地音频文件 |
| 按钮：重新选择 | `cloneReselectButton` | 重新选择音频文件 |
| 按钮：进行中 | `cloneInProgressButton` | 正在添加… |
| 占位行徽标 | `clonePendingLabel` | 创建中… |
| **恢复默认失败（R2 修复后可达）** | `defaultVoiceRestoreFailed` | 恢复默认音色失败 |
| **保存默认失败（R2 修复后可达）** | `selectionSaveFailed` | 默认音色保存失败 |
| 音色不在当前目录 | `selectionNotInCatalog` | 所选音色不在当前音色列表中，请重新选择 |
| 克隆入库失败 | `cloneAddFailed` | 添加克隆音色失败 |
| 克隆服务不可用 | `VOICE_CLONE_PROVIDER_UNAVAILABLE` 等 | 音色克隆服务暂时不可用，请稍后重试 |

> R2 修复的**用户可见变化**：以前这两句从不显示（死代码），用户一律看到「语音列表加载失败」；
> 现在偏好存储类失败会准确显示「默认音色保存失败」，用户能判断该去检查本地存储而非盲目重试。

---

## 6. 回归保护测试

全部位于 `apps/desktop/src/views/video-creation/composables/useTtsVoices.test.js` 的新 describe
「克隆成功后自动切换『语音 / 音色 ID』选中项」（6 例）。

| # | 用例名 | 锁住的缺陷 |
|---|---|---|
| 1 | 克隆成功即写入 `s2vConfig.voiceId` 并持久化偏好（下拉选中项随之切换） | 主路径防回归 |
| 2 | MiMo TTS：克隆音色（`mimo-clone-` 前缀）也切换选中项，偏好落到 voiceclone 键域 | MiMo 特例分支（此前零覆盖） |
| 3 | 偏好持久化失败时回滚到切换前的选中项，不留下从未保存成功的「默认」 | **R1** |
| 4 | 并发上下文变更（切换语音生成器）时，过期克隆结果不覆盖新上下文的选中项 | 并发守卫 |
| 5 | 删除被选中的克隆音色时回退到首个可用音色，不留失效选中项 | 删除回退 |
| 6 | 音色目录本次拉取失败时，不清空仍可用的已保存选中项 | **R3** |

### 6.1 变异反证（2026-10-20 实测）

| 变异 | 结果 |
|---|---|
| M1 删 `rollbackVoiceId` 入参与传参 | 1 failed ⇒ 入参不可省 |
| M2 锚点改回 `d.getS2vConfig().voiceId` | 1 failed ⇒ 锚点来源被锁 |
| M3 删「目录未返回则不清空」分支 | 1 failed ⇒ 分支 C 被锁 |
| M4 把死三元改回原样 | **0 failed（存活）** ⇒ 兜底文案可达性无机械锁，改用 PRD「禁止写法」约束 |
| M5 让成功 toast 无条件弹 | 1 failed ⇒ 「失败不谎报成功」被锁 |

---

## 7. 验收判据

| # | 判据 | 结果 |
|---|------|------|
| A1 | `useTtsVoices.test.js` 全绿（原 16 + 新增 6） | ✅ 22/22 |
| A2 | `src/views/video-creation` 全量 | ✅ 12 文件 145/145 |
| A3 | `CreateView.test.js` + 删除守卫 + 选项自动保存 | ✅ 310/310 |
| A4 | 运行时/批量/UE 契约套件 | ✅ 21/21 |
| A5 | 主进程音色域 4 个套件 | ✅ 115/115 |
| A6 | Gate 7 `--cjk` / `--keys` | ✅ PASS（1331→1146）/ PASS（2152 key） |
| A7 | QM-1 Vite build + electron-builder | ✅ 双 exit 0；bundle 含 `selectionSaveFailed` / `defaultVoiceRestoreFailed` |
| A8 | QM-1 启动测试 | ✅ 9s 存活 + stderr 0 行 |
| A9 | 模板/DOM/样式零改动 | ✅ `S2vConfigPanels.vue` 未进 diff |
| A10 | locale 文件零改动 | ✅ 无 zh/en 新增键，无成对性风险 |

---

## 8. 残留风险

1. **QM-6 双模型外部评审未完成**：本机 LLM CLI 后端（claude/opencode/codex）均超时不可用。CI 侧该判据为 advisory，不阻断合入。
2. **M4 变异存活**：错误文案兜底分支的可达性无机械锁（单测 `deps.t` 为 key 回声，无法断言文案值）。已用 PRD 数据校验表「禁止写法」做流程面约束。
3. **`s2vPersistedVoiceId` 写了没人读**：四处写、零运行时消费方（唯一读者是 `CreateView.test.js` 断言）。本次未删（独立清理，删它会动壳 computed 桥接与 `s2v-panel-contract.js` 白名单），作为后续债务。
