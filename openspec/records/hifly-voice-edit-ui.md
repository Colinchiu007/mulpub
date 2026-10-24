---
record: hifly-voice-edit-ui
task: 飞影声音参数编辑接入 UI 链路（service / IPC / preload / renderer API）
date: 2026-10-24
---

## 本次执行记录：声音参数编辑的四层接线（hifly-voice-edit-ui）

| 门禁 | 状态 |
|---|---|
| 变更类型与隔离 | ✅ worktree `mp-hifly-voice-edit-ui`（`<worktree 根目录>/mp-<task>`，非 C 盘） |
| docs-only 判定 | 由门禁推导 |
| TDD | ✅ 每层先写 RED 再实现：service 9 例、IPC 5 例、新增测试文件 1 个 |
| 回归零破坏 | ✅ 5 个相关测试文件 **73/73** 全绿；preload/契约面 407/407 |
| 超大文件 | ✅ `check-max-lines.js` 通过（service 1780 ≤ target 1783） |
| locale 成对 | ✅ `--keys` PASS（2280）、`--cjk` PASS（1115） |
| 同型风险锁 / 品牌 / 绝对路径 | ✅ r3 18/0、no-brand-residue PASS、doc-abs-paths PASS |
| 依赖漏洞审计 | ✅ `check-dep-audit.js` rc=0 |
| 远程同步 | 由门禁推导 |

- 保留门禁：品牌残留 ✅ | doc-abs-paths ✅ | 远程同步 PR #NNNN

> **分支重建说明（2026-10-24 下午）**：本 PR 最初基于一个 `hifly-voice-edit` 分支（只含 adapter 层），
> 但那条分支**从未开过 PR**（当时误把一个别人的 PR 号当成了自己）。
> 于是把 adapter 层的 `editVoice` 一并并入本 PR，使这条能力**在一个 PR 内自包含**：
> adapter → service → IPC → preload → renderer api → UI。
>
> 重建时踩到三次同类问题并逐一修正：用「整文件替换」的方式搬改动会**丢掉 main 上别人的新改动**——
> `hifly.test.js` 丢了分页断言更新、`hifly-clone.js` 丢了 `ensureFileId`、
> `locales/create/{zh,en}.js` 丢了 #4374 的 `visualMode` 键组。
> 正解是「以 main 版为底、只追加本 PR 的增量」，三处均已按此重做。

## 一、这轮补什么

上一轮（PR #4372）只在 **adapter 层**实现了飞影 `POST /voice/edit`（修改已克隆声音的语速/音量/语调），
UI 拿不到——渲染层没有 IPC 通道、没有 preload 方法、没有 renderer API。

本轮把**整条链路接通**，四层：

```
Vue 组件
  └─ src/api/tts-voice-clone.js       editTtsVoiceCloneParams()   ← 本轮
       └─ preload/tts-voice-clone.js  editParams 方法              ← 本轮
            └─ ipc-handlers/tts-voice-clone.js  "tts-voice-clone:editParams"  ← 本轮
                 └─ services/tts-voice-clone-service.js  editCloneParams()    ← 本轮
                      └─ adapters/hifly-clone.js  editVoice()                  ← 上一轮 PR #4372
```

## 二、四层各自的设计点

### 1. service 层（`tts-voice-clone-params.js`，mixin）

**为什么抽成独立文件**：`tts-voice-clone-service.js` 在 `check-debt-budget.js` 的点名还账清单上
（target 1783 行、**零增长容差**）。直接堆进去实测 1938 行 ⇒ `TARGET_GREW` 红。
按 avatar-clone 的成熟做法拆成 prototype mixin：
`Object.assign(TtsVoiceCloneService.prototype, editParamsMethods)`。

service 只留 3 处最小改动（require / `params` 白名单 + 校验 / prototype 挂载），
并顺带把 `publicVoice` 也移进 mixin（service 因此从 1787 降到 **1780**，落回 target 以内）。

**五层校验顺序（从便宜到贵）**：

| 层 | 检查 | 代价 |
|---|---|---|
| 1 | 入参归一（类型 + 范围 + 至少改一项） | 无 IO |
| 2 | adapter 是否支持 `editVoice` | 无网络 |
| 3 | registry 命中（**只允许改自己克隆的**） | 本地读 |
| 4 | 远端调用 | 网络 |
| 5 | 参数持久化 | 本地写 |

**第 3 层是产品约束而非技术约束**：真实 Token 侧证发现飞影对**公共音色**返回通用
「声音编辑失败」，与其它失败无法区分 ⇒ 只能在入口（本地 registry 命中）区分，
不能在失败时猜原因。

**参数合并而非覆盖**：只改一项时其余保留（`{...clone.params, ...request.params}`），
否则用户改语速会把之前设的音量清掉。

### 2. IPC 层

- 通道 `tts-voice-clone:editParams`，走 `withSenderCheck`（与其它克隆通道同型）；
- `normalizeEditParamsArgs`：白名单键 + `isSafeIdentifier(voiceId)` + 三参数范围校验，
  **三参数一个都不给即拒**（空操作视为非法）；
- 同步更新了测试里的**通道白名单锁**（`toEqual` 逐项列通道名，加通道必须改它）。

> 一处修正：最初写了个「缺 `sender.id` 时 fail closed」的用例，实测**失败**——
> `withSenderCheck` 只看 `senderFrame.url`，owner 校验在 service 的 `_captureOwner()`。
> 该用例设计错了，已删除并留注释说明归 service 层覆盖。

### 3. preload 层

`editParams: (input) => ipcRenderer.invoke('tts-voice-clone:editParams', input)`。
`access-control.js` 是「不在 PUBLIC_METHODS 名单内 ⇒ 默认 authenticated」，
所以新方法自动与 `rename` 同级（未登录不可用），无需登记。

### 4. renderer API 层

`editTtsVoiceCloneParams(input)`，与 `renameTtsVoiceClone` 同型：
`invokeNamespace(NS, 'editParams', input)` + `unavailable()` 兜底信封。

## 三、测试拆分（门禁驱动的结构调整）

`tts-voice-clone-service.test.js` 原本 1846 行，塞进 7 个新用例后膨胀 224 行 ⇒
`TEST_LEDGER_GREW` 红（容差 200）。已把新用例拆到独立文件
`tts-voice-clone-service.edit-params.test.js`（9 例，自包含 fixtures），
原文件恢复原状。

新文件额外补了一条**持久化面**的锁：registry 里写出越界参数（如 `rate: "9.9"`）会让
`isSafeCloneVoice` 判整条音色非法 ⇒ 该音色从列表消失。用例断言此时拒绝且不调 adapter。

## 四、UI 入口（本轮已接）

`S2vConfigPanels.vue` 的克隆音色行新增「参数」按钮（`data-testid="s2v-voice-clone-params-open"`），
点击进入行内编辑态（与「重命名」同型的 `v-else-if` 分支），三个输入框 + 范围提示 + 保存/取消。

| 文件 | 改动 |
|---|---|
| `composables/tts-voices-state.js` | +4 字段：`s2vVoiceCloneParamsEditingId` / `ParamsRate` / `ParamsVolume` / `ParamsPitch`（初始值 + reset 两处） |
| `composables/tts-voices-clone.js` | +3 方法：`startS2VVoiceCloneParams` / `cancelS2VVoiceCloneParams` / `saveS2VVoiceCloneParams` |
| `composables/tts-voices-shared.js` | `toS2VVoiceOption` 保留 `params`（否则编辑后回显丢失） |
| `composables/useTtsVoices.js` | 导出三个新方法 |
| `S2vConfigPanels.vue` | 参数分支 + 「参数」按钮 + 三个 `fns` 转发 |
| `locales/create/{zh,en}.js` | 11 个键（成对） |

### 三个设计决定

**1. 用三个独立字符串而非嵌套对象**
state 里是 `s2vVoiceCloneParamsRate` 等三个字段，不是 `paramsDraft: { rate, volume, pitch }`。
理由：reset 只需置空（`resetS2VVoiceState` 里逐个置空，无嵌套对象引用问题），
且模板 `v-model` 能直接绑（嵌套对象要写 `v-model="draft.rate"`，而 draft 若为 reactive 内的普通对象需谨慎）。

**2. 留空表示「不改这一项」**
三个输入框都可留空；保存时只收「有填」的项。这与 service 的「合并而非覆盖」对齐——
用户只改语速时，音量和语调保持原值。一个都没填则本地就拒（`cloneParamsEmpty`），不发请求。

**3. 失败提示不直出服务端文案**
服务端 `message` 是开发者向技术文案（如「Voice不正确」「声音编辑失败」），
UI 统一显示 `cloneParamsFailed`（「无法修改音色参数，请稍后重试。」），
与 `avatar-clone` 的 `resolveMediaImportFailure` 同型处理。

### 同步更新的契约锁

`useTtsVoices.test.js` 的「导出面完整」用例逐项数导出数量（21 ref / 5 computed / 27 methods）。
新增 4 个 state + 3 个 method ⇒ 已改为 **25 / 5 / 30**，并把三个新方法加进「关键名称在位」断言，
同时在三处注释里写明增量来源（否则下次读的人不知道 25 是怎么来的）。
## 五、验证读数

| 项 | 读数 |
|---|---|
| service 层 | `tts-voice-clone-service.test.js` 52/52 + `edit-params.test.js` 9/9 |
| IPC 层 | `tts-voice-clone.test.js` 9/9 |
| preload / 契约 | `preload.test.js` + `ipc-exposure-contract.test.js` 等 407/407 |
| UI 层 | `src/views/video-creation` + `CreateView.test.js` + i18n 等 **19 个文件 565/565** |
| 门禁 | max-lines ✅（1780 ≤ 1783）/ debt ✅ / dep-audit rc=0 / locale keys 2282 + cjk ✅ / brand ✅ / r3 18/0 |

## CHANGELOG 条目

# feat(video): 声音参数编辑接入主进程与渲染层链路

- 克隆音色的**语速 / 音量 / 语调**修改能力已从适配器层一路接通到渲染层：新增 IPC 通道、preload 方法与 renderer API，任何界面都能直接调用。
- 参数校验分三层落地（IPC / service / adapter），越界或不合法会在最便宜的一层就被拒绝，不会白打一次远端请求。
- 仅对**自己克隆的**音色可用——服务商对公共音色返回的是通用失败、无法区分原因，因此入口处就按本地记录区分。
- 只改一项时其余参数保留，不会互相清空。
