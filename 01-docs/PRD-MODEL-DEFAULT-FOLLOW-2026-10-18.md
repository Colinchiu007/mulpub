# PRD — 流水线生成器默认值跟随「模型设置」默认（图片 / 视频 / 语音）

> **版本**：v1.0
> **日期**：2026-10-18
> **分支**：`fix-model-default-follow`
> **状态**：待合并
> **关联**：`01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §4.3.2 / §9.10、`01-docs/PRD.md` §7.1.4 与 §7.1.5、`openspec/records/fix-model-default-follow.md`

---

## 1. 背景与问题

### 1.1 用户诉求（原话）

> 当用户在设置中，把某个类别模型设为默认，或把多模态模型的某些能力设为默认。
> 在视频创作的所有流水线页中出现的，相应的模型的下拉列表，如果有多项可选的模型，
> 应该默认为应用设置中默认的那个类别的模型。

> 我的设置中，原来的 TTS 模型默认是设置为 Mimo TTS，但我刚才在设置中，修改成了默认为
> MiniMax 多模态中的 TTS 模型能力，所以用到 TTS 的时候，默认就应该是 MiniMax 多模态的 TTS
> 才对。可以在故事讲述流水线中，声音参数选项区域中，「语音模型生成器」，仍然默认为 Mimo TTS。
> 检查一下并修复。

### 1.2 复现路径（用户实测）

1. 「模型服务商」页：TTS 类别默认 = `mimo-tts`（MiMo TTS）。
2. 用户在设置中把默认改为 MiniMax 多模态模型的 **TTS 能力**（`minimax-multimodal`，`config.capability_defaults` 含 `tts`）。
3. 进入「视频创作 → 故事讲述」流水线，展开「声音参数」折叠区。
4. **预期**：「语音模型生成器」默认 `minimax-multimodal`，「语音模型」默认 `speech-2.8-turbo`。
5. **实际**：「语音模型生成器」仍默认 `mimo-tts`（MiMo TTS）。

### 1.3 根因（第一性原因）

`apps/desktop/src/views/CreateView.vue` 的 `loadS2VProviders()` 在「用户无显式选择」时解析默认值，但**从未读取「谁是默认」这个事实**，只依赖两种间接信号：

| 生成器 | 修复前代码 | 缺陷 |
|---|---|---|
| 语音生成器 | `nextVoiceProviders.find(p => p?.category === 'multimodal' && typeof p?.capability_models?.tts === 'string')` | 只看「是不是多模态」，**不看「是不是默认」**。默认落在普通单能力 TTS 上时依然挑中多模态 |
| 图片生成器 | `this.s2vImageProviders[0].id` | 直接取列表首项，**完全不读默认** |
| 视频生成器 | `this.s2vVideoProviders[0].id` | 同上 |

后两者唯一的「正确」来源是 `listProviders()` 的 `ORDER BY is_default DESC, is_preset DESC, name ASC` —— 这是**排序副作用**，不是契约。它要求默认项恰好排在第一，而该排序在同分时按 `name ASC` 字典序，默认项很容易落到第二及以后。

**真源早已存在但前端没问**：`ModelProviderManager.getDefault(category)`（IPC `model-provider:get-default`，preload 已暴露 `modelProviderGetDefault`）内部 `_multimodalProviderFor()` 已完整实现双默认语义：

```js
// apps/desktop/electron/services/model-provider-manager.js:1186
const isDefault = (Array.isArray(config.capability_defaults) && config.capability_defaults.includes(category)) || !!row.is_default
```

桌面端缺的是**前端调用**，不是主进程能力。因此本次修复**不改主进程、不改 IPC、不改数据库 schema**，只补前端读取与判定。

---

## 2. 目标与非目标

### 2.1 目标

| 编号 | 目标 | 可度量判据 |
|---|---|---|
| G1 | 三类生成器（图片 / 视频 / 语音）在用户无显式选择时，默认值 = 模型设置里该类别的默认 | 见 §7 验收标准 ①②③ |
| G2 | 默认判定口径与主进程 `_multimodalProviderFor` 逐条一致，不出现「设置显示默认 A、下拉默认 B」 | 同一份纯函数单测 9 例覆盖全部形态 |
| G3 | 用户显式选择（含显式「自动 Edge TTS」）永远优先于默认解析 | 验收标准 ④ |
| G4 | 主进程 `getDefault` 不可用时不退化成首项，仍按列表内默认标记解析 | 验收标准 ⑤ |
| G5 | 全链路 fail-closed 不抛错：IPC 失败 / 空列表 / 脏数据 / 悬空 id 均有确定行为 | 验收标准 ⑥⑦ + §6 数据校验表 |
| G6 | 不引入行为漂移：MiMo TTS 隐藏模型下拉、空态占位、locale 文案等既有合同不变 | 既有 313 例 CreateView 测试全绿 |

### 2.2 非目标

- **不改主进程 / IPC / 数据库**：`getDefault`、`_multimodalProviderFor`、`setCapabilityDefault`、`model_providers` 表均不动。
- **不引入 `getS2VDefaultImageModel`**：图片侧原本只解析 provider id、`imageModel` 由既有链路解析；新增该方法属于无需求的行为扩张，本次明确不做（见 §5.4）。
- **不改运营中心 `PipelineOptions.vue`**：其 `visual.imageProvider` / `voice.voiceProvider` 的 `default_value` 仍为空串 —— 运营中心不持有桌面本地 provider id，该契约不是本需求的解决路径。
- **不改「已保存快照」的恢复优先级**：lastOptions 快照回填仍按既有语义优先（显式选择 > 默认），本次只改「无显式选择」那一档。
- **不改其他页面**（影视工程、播客等）的模型选择器 —— 它们不走 `loadS2VProviders()`，属独立链路，本次不扩大爆炸半径。

---

## 3. 术语

| 术语 | 含义 |
|---|---|
| 类别默认 | 「模型服务商」页对某类别（tts/image/video/llm/speech_recognition）点「设为默认」，落为 `model_providers.is_default = 1` |
| 能力默认 | 对多模态模型点某个能力的默认标记（如 MiniMax 的「TTS」），落为 `config.capability_defaults = ['tts']` |
| 多模态整体默认 | 旧版「多模态整体设为默认」，`is_default = 1` 且 `capability_defaults` 为空；语义等价于其**所有已声明能力**均为默认 |
| 显式选择 | 用户在本页下拉里手动选过 provider，或 lastOptions 快照回填过 provider，或显式选过「自动 Edge TTS」 |
| 候选列表 | `enabled === true && is_configured === true && id && name` 过滤后的 provider 列表 |

---

## 4. 判定口径（单一真源）

新增纯函数 `resolveS2VDefaultProviderId(providers, category, preferredId)`，位于
`apps/desktop/src/views/video-creation/create-view-module-utils.js`（该文件是 CreateView 的模块级纯函数集中地，无组件实例依赖，便于单测）。

### 4.1 谁是「该能力的默认」

| 候选形态 | 视为该能力默认的条件 |
|---|---|
| 普通 provider（`category !== 'multimodal'`） | `is_default === true` |
| 多模态 provider | `config.capability_defaults` 包含该能力，**或** 整体 `is_default === true` |
| 多模态 provider（能力声明校验） | 还必须 `capabilities` 包含该能力，否则其「默认」不适用于本下拉 |

第三条是必要的：一个 `is_default` 的多模态模型可能只声明了 `image` 能力，若不校验，它会抢走 tts 下拉的默认位。这与主进程 `_multimodalProviderFor` 的 `config.capabilities.includes(category)` 逐条对齐。

### 4.2 优先级（自上而下，取第一个命中）

```
1. preferredId —— 主进程 getDefault(category) 返回的 id
   ├─ 须在候选列表内
   └─ 须通过 §4.1 口径校验
   （任一不满足 → 忽略该 id，继续向下，绝不返回悬空 id）
2. 候选列表内第一个满足 §4.1 口径的
3. 候选列表首项（保持 2026-08-12 起的旧兜底，保证「无任何默认」时行为不回退）
4. 候选列表为空 → ''
```

### 4.3 为什么保留 `preferredId` 这一层

`modelProviderGetDefault` 是主进程的真源，但它与前端候选列表**不是同一个集合**：

- 主进程 `getDefault` 会返回 `enabled = 1` 且有可用 Key 的 provider，但**不要求 `name` 非空**（前端 `enabledProviders` 要求 `id && name`）；
- 主进程 `listProviders('tts')` 与前端过滤条件也可能因 `is_configured` 计算差异而不一致。

因此 `preferredId` 必须经过「在列表内 + 是默认」双重校验才能采用；校验不过就地在列表内重新解析。这保证前端永不选中一个下拉里不存在的项（空白选中项是本仓反复出现过的 UI 缺陷形态）。

---

## 5. 实现合同

### 5.1 纯函数（新增）

`resolveS2VDefaultProviderId(providers, category, preferredId)` → `string`

- 入参 `providers`：候选数组（可为 `null`/`undefined`/非数组）。
- 入参 `category`：能力字符串（`'tts'` / `'image'` / `'video'`）。
- 入参 `preferredId`：主进程默认 id（可为空串/非字符串）。
- 返回：provider id 或 `''`。
- **不抛错**（§6 全部分支均为降级，无 throw）。

### 5.2 数据流（`CreateView.vue: loadS2VProviders()`）

```
loadS2VProviders()
  │
  ├─ 卸载守卫：_s2vAlive === false → return
  ├─ ++s2vVoiceProviderRequestId
  │
  ├─ Promise.allSettled([ modelProviderList('image'), modelProviderList('tts'), modelProviderList('video') ])
  │
  ├─ 请求序号 + 卸载守卫二次校验
  │
  ├─ Promise.allSettled([ modelProviderGetDefault('image'), modelProviderGetDefault('tts'), modelProviderGetDefault('video') ])
  │     └─ defaultProviderId(result)：fulfilled && code===0 && data?.id → String(data.id)，否则 ''
  │
  ├─ 请求序号 + 卸载守卫第三次校验
  │
  ├─ 每类 enabledProviders 过滤（enabled && is_configured && id && name）
  │
  ├─ 陈旧 provider 清空（含对应 *Model 字段），避免下拉空白选中项
  │
  ├─ 图片：!imageProvider → resolveS2VDefaultProviderId(s2vImageProviders, 'image', defaultImageId)
  ├─ 视频：!videoProvider → resolveS2VDefaultProviderId(s2vVideoProviders, 'video', defaultVideoId)
  │           └─ 随后 getS2VDefaultVideoModel(...) 带出默认模型
  └─ 语音：explicitEdge ? ''
             : configuredProvider?.id || resolveS2VDefaultProviderId(s2vVoiceProviders, 'tts', defaultVoiceId)
             └─ 随后 getS2VDefaultVoiceModel(...) 带出默认模型
```

三个 `getDefault` 与三个 `list` 分两批 `Promise.allSettled` 并行，**不增加串行延迟**；任一路失败不影响其余。

### 5.3 交互优先级（用户显式选择 > 模型设置默认）

| 状态 | 默认选中项 | 实现位置 |
|---|---|---|
| 用户在本页下拉**手动改过** provider（本次会话内） | 该选择 | 当前值 ≠ `s2v*AutoProviderId` |
| 用户显式选过「自动 Edge TTS」 | 自动 Edge TTS | `s2vVoiceProviderExplicitEdge === true && !voiceProvider` |
| 当前值是上次由默认**自动填入**的 | 重新解析当前默认 | 当前值 === `s2v*AutoProviderId` |
| 用户从无显式选择（首次进入 / 重置选项） | `resolveS2VDefaultProviderId(...)` | 本次新增 |

#### 5.3.1 「自动应用值」跟踪（修复主路径的关键设计）

**为什么必须有**：只判「当前是否为空」会让旧默认永远钉住。用户在「模型设置」把 TTS 默认从 A 改为 B 并关闭弹窗后，`settingsDialogRevision` watcher 触发 `loadS2VProviders()` 重跑，此时 `s2vConfig.voiceProvider` 已是 A（上次自动填入）。若把它当成「用户显式选择」，新默认 B 永远不生效 —— 这正是用户报告的现象（「我刚才在设置中修改成了…仍然默认为 Mimo TTS」）。

**做法**：新增三个**不持久化**的组件状态 `s2vImageAutoProviderId` / `s2vVideoAutoProviderId` / `s2vVoiceAutoProviderId`，记录「上一次由默认解析自动填入的值」。

| 时机 | 动作 |
|---|---|
| 解析默认并写入配置 | 同步登记到对应 `AutoProviderId` |
| 重拉列表 | `当前值 === AutoProviderId` ⇒ 非显式，按当前默认重新解析；`≠` ⇒ 显式，不介入 |
| 陈旧 provider 清空 | 同时清空对应 `AutoProviderId` |
| `resetS2VLastOptions()` | 三者一并清空，回到「未选择」态 |
| `_applyS2VSnapshotObject()`（快照恢复） | 恢复出的 provider 值**登记为自动应用值**（见 §5.3.2） |

#### 5.3.2 快照（lastOptions）的处理与旧合同收窄

`_applyS2VSnapshotObject` 恢复出的 provider 值**登记为自动应用值**，即「上次的起点」而非显式选择。

**理由**：快照是自动保存的，无法区分「用户当初手选」与「当初由默认填入」。若一律当显式选择，用户改了设置默认后重启仍看到旧默认。

**旧合同收窄**：2026-08-12 合同为「用户显式保存过的选择（lastOptions 快照回填）始终优先于多模态默认」。本次收窄为：**同一次编辑会话内**的显式选择优先；**跨会话的快照值跟随当前设置默认**。

**代价（明确接受）**：用户上一次会话手选的 provider 在重启后会被当前设置默认取代，需重新手动选择。

**正解方向（不在本次范围）**：若后续需要「跨会话记住手选」，给快照增加显式的 `*ProviderExplicit` 布尔位，而不是靠「等值猜测」。

### 5.4 明确不做的事

- **不新增 `getS2VDefaultImageModel`**：图片侧原本只设 `imageProvider` 不设 `imageModel`（`imageModel` 由 `_applyS2VSnapshot` / restore 链路与 `applyS2VPipelineDefaults` 处理）。新增该方法会改变图片模型的默认解析路径，属无需求的行为扩张，且会引入新的回归面。本次只改 provider 选择。
- **不改 `s2vVoiceProviderOptions` 的计算**：首项「自动 Edge TTS」与「（多模态）」后缀展示逻辑不动。
- **不改 `handleS2VVoiceProviderChange`**：用户手动切换时的 `voiceProviderExplicitEdge` 记录逻辑不动。

---

## 6. 数据校验与边界（全部 fail-closed，无 throw）

| 输入形态 | 行为 |
|---|---|
| `providers` 为 `null` / `undefined` / 字符串 / 数字 | 返回 `''` |
| `providers` 为空数组 | 返回 `''`（上游渲染「自动 Edge TTS」/「无」占位） |
| `category` 非字符串 / 空串 | trim 后为空；`capability_defaults.includes('')` 恒 false，降级到首项兜底 |
| provider 缺 `id` / `id` 非字符串 / `id` 为空串 | 该候选不参与判定（`candidates` 过滤） |
| `provider.config` 为数组 / 标量 / `null` | 视为无 `capability_defaults`，不参与能力默认判定 |
| `config.capability_defaults` 非数组 | 视为未声明能力默认 |
| `capabilities` 非数组或不含该能力（多模态） | 该多模态不算该能力的默认 |
| `is_default` 为 `1` / `"1"` 等非严格 `true` | **不视为默认**。主进程 `_safeRow` 已把 `is_default` 转成布尔，IPC 列表理论上只会有布尔；此处要求严格 `true` 是为了不在前端复制主进程的宽松真值判断 |
| `preferredId` 不在候选列表内 | 忽略，继续向下判定 |
| `preferredId` 在列表内但未通过默认口径 | 忽略，继续向下判定 |
| `modelProviderGetDefault` 三次全部失败（IPC 未注册 / store 未初始化） | `defaultProviderId()` 返回 `''`，走 §4.2 第 2 档（列表内默认标记） |
| `modelProviderGetDefault` 抛错（非 fallback 语义） | `Promise.allSettled` 的 `rejected` 分支被 `status === 'fulfilled'` 判否，同样降级 |

**为什么 `getDefault` 失败不能阻断**：它是「读默认」的优化查询，不是「读列表」的必要查询。阻断它会把「默认查询故障」升级成「整个生成器下拉失效」，与 AGENTS.md「失败开放、不阻塞创作」的高频路径原则冲突。

---

## 7. 验收标准

| # | 场景 | 期望 |
|---|---|---|
| ① | 模型设置把 TTS 默认设为 MiniMax 多模态的 TTS 能力（`capability_defaults: ['tts']`，`is_default: false`） | 故事讲述流水线「语音模型生成器」默认 `minimax-multimodal`，「语音模型」默认 `speech-2.8-turbo` |
| ② | 模型设置把 TTS 默认改为普通 TTS 服务商（`is_default: true`），多模态 `capability_defaults: []` | 默认选中该普通服务商，**不是**多模态 |
| ③ | 图片 / 视频生成器 | 同样跟随各自类别默认（`image` / `video`） |
| ④ | **已打开页面上改设置即时生效**：旧默认 A 自动填入后，把默认改为 B 并关闭设置弹窗（watcher 重拉） | 切到 B |
| ⑤ | 同一次会话内用户手动改过下拉后重拉列表 | 保留该显式选择，不被新默认覆盖 |
| ⑥ | 快照（lastOptions）恢复 provider 后重拉 | 跟随当前设置默认（快照值不算显式选择） |
| ⑦ | 用户显式选过「自动 Edge TTS」 | 默认解析不覆盖该选择 |
| ⑧ | 主进程 `getDefault` 不可用（`delete window.electronAPI.modelProviderGetDefault`） | 仍按列表内默认标记（`capability_defaults`）解析为 `minimax-multimodal`，不退回首项 |
| ⑨ | 默认 provider 被删除 / 停用 / 未配置 | 回退到新的默认；无空白选中项 |
| ⑩ | 无任何默认标记（全 `is_default: false`、无 `capability_defaults`） | 保持首项兜底（旧行为不回退） |
| ⑪ | 多模态只声明 `image` 能力且 `is_default: true`，TTS 下拉另有普通 TTS 候选 | TTS 下拉默认该普通 TTS，**不**被 image 多模态抢走 |
| ⑫ | MiMo TTS 为默认时 | 「语音模型」下拉仍隐藏（§4.3.1 合同不变），音色 ID 下拉正常 |

**回归基线**：`create-view-module-utils`（9 例新增，全绿）、`CreateView.test.js`（316 例全绿）、`src/views/video-creation` + `s2v-options-autosave` + `CreateView.voice-clone-delete-guard`（136 例全绿）。

---

## 8. 测试设计

### 8.1 单元测试（纯函数，9 例）

文件：`apps/desktop/src/views/video-creation/create-view-module-utils.test.js`

| 用例 | 断言 |
|---|---|
| 默认 = 多模态 TTS 能力 | 返回该多模态 id，而非列表首项 Mimo |
| 默认 = 普通 TTS 服务商 | 返回该服务商，而非多模态 |
| 多模态整体默认（`is_default`） | 视为该能力默认 |
| 图片 / 视频类别同样跟随 | 不只修 TTS |
| 无任何默认 | 回退首项（旧行为） |
| 默认 id 不在候选列表 | 回退首项，不返回悬空 id |
| 空列表 | 返回 `''` |
| 多模态未声明该能力 | 不算默认（防 image 抢 tts） |
| 非字符串 / 空入参 | 不抛错 |

### 8.2 集成测试（CreateView，9 例新增 + 1 例改写）

文件：`apps/desktop/src/views/CreateView.test.js`

| 用例 | 断言 |
|---|---|
| 多模态 TTS 能力为默认（新） | `voiceProvider === 'minimax-multimodal'`、`voiceModel === 'speech-2.8-turbo'` |
| 普通 TTS 为默认（新） | `voiceProvider === 'elevenlabs'` |
| `getDefault` 不可用（新） | 仍按 `capability_defaults` 解析为多模态 |
| 图片默认（新） | `imageProvider === 'img-default'` |
| 视频默认（新） | `videoProvider === 'vid-default'` |
| 用户显式选过 Mimo（新） | `voiceProvider === 'mimo-tts'` 不被覆盖 |
| **设置改了默认后重拉列表（新，主路径）** | 第一次 A → 改默认为 B → 重拉后切到 B 与 `speech-2.8-turbo` |
| **同会话手改下拉后重拉（新）** | 手切到 mimo → 重拉 → 仍是 mimo |
| **快照恢复后重拉（新）** | 快照给 mimo → 重拉 → 跟随当前默认 minimax |
| 原「语音生成器默认选择已配置的多模态 TTS 模型」（**改写**） | 原夹具两者都无默认标记，旧代码因「第一个多模态」规则选中 minimax；新口径回退首项 elevenlabs。该断言锁定的正是本次要纠正的行为，故改写为「默认为模型设置里设为默认的多模态 TTS 模型」 |

### 8.3 逃逸分析（为什么旧测试没拦住）

| 层级 | 为什么没拦住 |
|---|---|
| 单元测试 | `create-view-module-utils.test.js` 只覆盖 stage/snapshot/字段挑选，**没有**默认 provider 解析的纯函数可测 |
| 集成测试 | `CreateView.test.js:848` 的夹具里 elevenlabs 与 minimax-multimodal **都无默认标记**，旧代码的「第一个多模态」规则恰好让断言通过 —— 测试忠实实现了错误需求 |
| E2E / 视觉 | 无覆盖「改默认 → 下拉默认跟随」的跨页场景 |
| 代码审查 | 2026-08-12 审查聚焦「多模态要出现在下拉里」，未质疑「默认该由谁决定」 |

**系统性漏洞**：`ORDER BY is_default DESC` 的排序副作用被当成了「默认契约」，而没有任何测试固定「默认项必须在第一位」或「默认值来自 getDefault」。属**测试场景缺失** + **审查盲区**复合。

**预防措施**（本次落地）：把「谁是默认」从排序副作用提升为显式契约 —— 纯函数 + 主进程真源双测，并在 PRD §9.10 固化口径。

---

## 9. 影响面与风险

### 9.1 改动文件

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/views/video-creation/create-view-module-utils.js` | 新增 `resolveS2VDefaultProviderId` 纯函数 + 导出 |
| `apps/desktop/src/views/video-creation/create-view-module-utils.test.js` | 新增 9 例单测 |
| `apps/desktop/src/views/CreateView.vue` | `loadS2VProviders()` 增补 `getDefault` 查询与三类默认解析；import 两个新符号 |
| `apps/desktop/src/views/CreateView.test.js` | 新增 6 例 + 改写 1 例 |
| `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` | 新增 §9.10、§4.3.2 |
| `01-docs/PRD.md` | 修订 §7.1.4「语音生成器默认」条目（两处重复段同步） |
| `01-docs/CHANGELOG.md` | 追加本次变更 |

**不改**：主进程任何文件、IPC handler、preload、数据库 schema、locale 文件（无新增用户可见文案）。

### 9.2 风险与缓解

| 风险 | 缓解 |
|---|---|
| 新异步查询增加挂载延迟 | 与既有三个 `list` **并行**（两个 `Promise.allSettled`），不增加串行时长；实测无感 |
| 用户在设置里改默认后，本页已选项被切走 | 显式选择优先（§5.3）；只有「从无显式选择」才跟随默认 |
| 「设置弹窗关闭 → 重拉列表」路径行为变化 | 该路径本就调用 `loadS2VProviders()`，本次使其默认值同步刷新，正是需求所要 |
| `is_default` 严格 `true` 判断过严 | 主进程 `_safeRow` 已转布尔；若未来 IPC 直出数字，第 2 档（列表内 `is_default === true`）同样判不上，会退首项 —— 不会白屏，最坏是退回首项（可观测） |
| 旧测试「多模态优先」断言失败 | 已评估为**需求变更**而非回归，改写并留注释说明（§8.2 末行） |

---

## 10. 文档同步清单

- [x] `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §9.10（完整合同）+ §4.3.2（索引）
- [x] `01-docs/PRD.md` §7.1.4「语音生成器默认选择多模态 TTS 模型」条目修订（2026-10-18）
- [x] 本 PRD
- [x] `01-docs/CHANGELOG.md`
- [x] `openspec/records/fix-model-default-follow.md`
- [ ] `openspec/specs/` spec delta（本次为纯前端修复 + 已有主进程契约，按项目规范以 record 承载，不新增 spec 文件）
