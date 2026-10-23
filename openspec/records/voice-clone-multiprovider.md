---
record: voice-clone-multiprovider
task: 数字人声音克隆能力打通（catalog 声明 + 克隆面板能力提示）
date: 2026-10-23
---

## 本次执行记录：数字人声音克隆能力打通（voice-clone-multiprovider）

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `mp-voice-clone-multiprovider`，分支 `voice-clone-multiprovider` |
| TDD | ✅ | `tts-voice-catalog.test.js` 新增 3 例先 RED（2 失败）后 GREEN；`CreateView.avatar-clone.test.js` 新增 3 例 |
| 回归零破坏 | ✅ | 16 个相关测试文件 **362/362** 全绿 |
| 超大文件 | ✅ | `check-max-lines.js` 无新增 |
| locale 成对 | ✅ | zh/en 各 +2 键；`--keys` PASS（2238）、`--cjk` PASS（1125，无新增硬编码） |
| 品牌残留 | ✅ | `check-no-brand-residue.js` PASS |
| 文档绝对路径 | ✅ | `check-doc-abs-paths.js` PASS |
| QM-1 打包 | ✅ | `vite build` exit 0 |
| 债务基线 | ✅ 经人工授权 | `CreateView.vue` 5495 → 5528（+33），**经用户明确授权**抬升，理由见下 |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导；本行不手写状态词 |

## 一、先纠正一个此前的错误判断

上一轮（digital-human-multiprovider）的执行记录把「**声音克隆前端入口未做**」列为遗留。
本轮读码后发现**该判断是错的**：

- `tts-voice-clone-service.js` **早已完全 provider 化**（registry 键 `tts-voice-clones:v2:<providerId>:<model>`、锁键含 providerId、补偿按 providerId 调 `deleteVoice`）；
- 前端入口也在 `S2vConfigPanels.vue`（`s2v-voice-clone-toggle`），含选样本 / pending 态 / 列表 / 重命名 / 删除 / 失效标记，一应俱全；
- `tts-voice-catalog.js` 里 **heygen 也已声明** `USER_CLONE` + `DESKTOP_UPLOAD_CLONE`。

所以缺口不是「没有入口」，而是两件具体的事：
1. `tts-voice-catalog.js` 里 **hifly 没声明**克隆能力 ⇒ 切到飞影后，音色克隆面板对这家根本不渲染；
2. 数字人面板克隆了形象，但**没有任何地方告诉用户「本服务商还支持配自己的声音」**，
   声音克隆入口在另一个面板（配音 → 音色复制/克隆），用户找不到。

## 二、改动

### 1. 给飞影补声音克隆能力声明

`electron/services/tts-voice-catalog.js`：

```js
hifly: Object.freeze({
  'hifly-video': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, clone: DESKTOP_UPLOAD_CLONE }),
}),
```

依据（飞影官方文档本地版）：`POST /api/v2/hifly/voice/create`，`voice_type` 必填且目前
只支持 8；素材 mp3/m4a/wav、≤20MB、5 秒～3 分钟；同账号 API 创建上限 200 个。

### 2. 克隆面板补「配套声音」能力提示

`AvatarClonePanel.vue` 新增 `voiceCloneSupported` prop 与 `avatar-clone-voice-hint` 提示：

| 探测结果 | 文案 |
|---|---|
| 支持 | 「本服务商还支持克隆你自己的声音：在下方「数字人音色」旁的「音色复制 / 克隆」里上传录音即可…」 |
| 不支持 | 「当前服务商不支持克隆声音，只能使用它提供的现成音色。」 |

**刻意不重复造上传入口**：声音克隆的 UI 与样本存储已在配音面板存在，再造一份会有
两套选择器、两套样本目录，且用户要在两个地方各传一次录音。

### 3. 能力探测（CreateView）

`probeAvatarVoiceCloneSupport(providerId, model)` 走 `getTtsVoiceCloneRequirements` IPC：

- **为什么不能在渲染端直接判**：能力目录在主进程，且「支持克隆」还要看该 provider
  当前是否已配置可用 Key，IPC 是唯一权威来源；
- **拿不到时保守判 false**：显示「不支持」比谎称支持好——用户点了才发现不能克隆更糟；
- **调用时机在 `loadS2VProviders` 里 provider 定下之后**，不在 `selectPipeline` 里：
  后者执行时 `avatarProviderId` 可能还是空（provider 列表异步拉），
  探测会拿到空 provider 而保守判「不支持」（第一版就是这么写的，被测试当场抓出）。

## 三、债务基线未抬（如实记录）

## 四、债务基线抬升说明（maxFileLines 5495 → 5528）

**触发**：`CreateView.vue` 增至 5528 行，越基线 33 行。

**先做的压缩**：压紧 `probeAvatarVoiceCloneSupport` 的 JSDoc（去掉 `@param` 两行）、
data 字段注释并为单行、压缩调用点注释——共省 5 行。增量构成：

| 块 | 行数 |
|---|---|
| `probeAvatarVoiceCloneSupport` 方法（含注释） | 20 |
| `loadS2VProviders` 里的探测调用 + 注释 | 6 |
| `switchAvatarProvider` 里的重探测 | 2 |
| data 字段 `avatarVoiceCloneSupported` | 2 |
| 模板 prop `:voice-clone-supported` | 1 |
| 删除 `selectPipeline` 里那次误置的探测（净变动） | -2 |
| 注释压缩 | +4 |

**授权**：已向用户明示增量构成与三个选项，用户选择「授权抬到 5528」。
这是同一文件连续第三次因数字人功能抬基线（5423 → 5495 → 5528），
**下一轮涉及 CreateView 的新增应优先考虑抽组件**，不要再走抬基线这条路。

## 四、遗留

- **真实飞影 Token 首跑仍未执行**：`voice/create` 的字段与 `languages` 字典未经真实
  响应核对。首跑 checklist 在 `openspec/changes/digital-human-multiprovider/tasks.md` §7.1。
- **`avatarCloneErrProvider` 文案仍写死 HeyGen**（`'HeyGen 暂时不可用，请稍后重试'）：
  应改为「当前数字人服务商暂时不可用」。属文案修正，改动小但会影响既有 locale 基线，
  单独一轮处理。

## CHANGELOG 条目

# feat(video): 飞影数字人支持克隆自己的声音，克隆面板补配套声音指引

- 飞影 HiFly 接入声音克隆：在「配音 → 音色复制 / 克隆」上传录音即可克隆，克隆成功后可在数字人音色下拉中选择。此前只有 HeyGen 支持。
- 数字人「管理克隆形象」面板新增能力提示：当前服务商支持克隆声音时告知入口位置，不支持时明确说明只能用现成音色，不再让用户以为形象和声音必须捆绑。
