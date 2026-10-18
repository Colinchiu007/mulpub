# 故事讲述流水线配置面板 — 声音区子分区布局与默认收缩（Spec Delta）

## ADDED Requirements

### Requirement：声音折叠区 MUST 分为三个可寻址子分区

故事讲述流水线详情页的「声音」折叠区 SHALL 在内部划分为三个子分区，每个子分区
SHALL 是独立的 DOM 容器，携带稳定的 `data-testid`，且 SHALL NOT 与其它子分区共享
同一个字段栅格。

子分区顺序与内容 SHALL 为：

1. `s2v-subgroup-voiceNarration`（旁白设置）：语音生成器、语音模型、语音 / 音色 ID；
2. `s2v-subgroup-voiceBgm`（背景音乐）：背景音乐选择与管理、历史路径核验状态、背景音乐音量；
3. `s2v-subgroup-voiceClone`（音色复制 / 克隆）：克隆面板、个人音色槽位说明、
   「尚未接入克隆能力」提示。

#### Scenario：三个子分区按序渲染且互不渗透

- **WHEN** 用户展开「声音」折叠区
- **THEN** 页面 SHALL 自上而下渲染 `voiceNarration` → `voiceBgm` → `voiceClone` 三个子分区
- **AND** 每个子分区 SHALL 有独立的 `.s2v-field-grid`
- **AND** `voiceClone` 子分区内 SHALL NOT 出现 `s2v-bgm-volume`（背景音乐音量）

#### Scenario：克隆能力三态全部归入克隆子分区

- **WHEN** `s2vVoiceCapability` 为 `provider_personal_slot`
- **THEN** 「个人音色槽位」说明 SHALL 渲染在 `voiceClone` 子分区内
- **WHEN** `s2vVoiceCapability` 为 `user_clone` 且 `clone.enabled === true`
- **THEN** 克隆面板（toggle + 样本选择 + 克隆列表）SHALL 渲染在 `voiceClone` 子分区内
- **WHEN** `s2vVoiceCapability` 为 `user_clone` 且克隆能力未启用
- **THEN** 「当前服务商尚未接入可用的音色克隆能力」提示 SHALL 渲染在 `voiceClone` 子分区内

### Requirement：子分区 MUST 在视觉上可辨认为独立单元

每个子分区 SHALL 具备可区别于相邻分区与外壳的视觉特征：卡片式背景、边框、圆角与内边距，
以及带虚线下边框的节标题。子分区 SHALL NOT 引入新的折叠交互层。

#### Scenario：子分区呈卡片态且整行满宽

- **WHEN** 「声音」折叠区处于展开态
- **THEN** 每个子分区 SHALL 有非透明的卡片背景色与可见边框
- **AND** 每个子分区 SHALL 占满所属折叠区的内容宽度（不得与其它子分区并排）
- **AND** 页面 SHALL NOT 出现横向溢出

#### Scenario：「高级」区子分区获得同款卡片样式

- **WHEN** 用户展开「高级」折叠区
- **THEN** `splitTiming` 与 `templateOutput` 两个子分组 SHALL 与声音区子分区呈现同款卡片样式
  （共用同一 CSS 类，不建第二套并行样式）

### Requirement：除「基础」外所有折叠区 MUST 默认收缩

`s2vOpenSections` 的默认值 SHALL 为仅 `basic` 展开。该默认态 SHALL 同时适用于
快照恢复路径：恢复时 SHALL 先显式复位到默认态，再仅打开快照 `ui.expandedGroups`
中列出的分组。

#### Scenario：首次进入流水线时仅基础区展开

- **WHEN** 用户进入故事讲述流水线详情页且无上次选项快照
- **THEN** 「基础」折叠区 SHALL 展开
- **AND** 「画面」「视频增强」「声音」「高级」「发布」折叠区 SHALL 全部收缩

#### Scenario：恢复快照后仅快照列出的分组展开

- **WHEN** 存在 `ui.expandedGroups` 快照且其中列出 `["voice","advanced"]`
- **THEN** 恢复后 SHALL 仅「基础」「声音」「高级」展开，其余分组收缩
- **AND** 恢复结果 SHALL NOT 依赖 data() 默认值恰好全关这一隐含前提

### Requirement：本次变更 MUST NOT 改变配置契约

分区重构 SHALL NOT 改变任何 `optionKey`、`data-testid`、`s2vConfig` 字段、
持久化 payload 形状或 IPC 通道。

#### Scenario：既有标识符与持久化字段不变

- **WHEN** 完成分区重构
- **THEN** `voice.voiceProvider` / `voice.bgm` / `voice.bgmVolume` 等 optionKey SHALL 保持原值
- **AND** `s2v-bgm-select` / `s2v-bgm-volume` / `s2v-bgm-manage-button` / `s2v-voice-clone-toggle`
  等 `data-testid` SHALL 保持原值
- **AND** `s2vConfig` / `s2vOutputConfig` schema 与 `buildS2VLastOptions` payload SHALL 逐字段不变

#### Scenario：运营隐藏字段不影响子分区容器渲染

- **WHEN** `s2vOptionVisible('voice.bgmVolume')` 返回 false
- **THEN** 「背景音乐音量」控件 SHALL NOT 渲染
- **AND** 其所在子分区容器 SHALL 仍然渲染（不得因内部字段被隐藏而消失）
