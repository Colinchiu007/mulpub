## ADDED Requirement: 视频提示词中文翻译

项目详情（ResultView 分段编辑）中每个分段的「视频优化词」文本域下方 SHALL 展示只读的本国语言翻译文本，当且仅当：界面语言 `getAppLocale() !== 'en'` 且该分段存在非空 `videoPromptTranslation`。翻译块 MUST 只读、不可编辑，与可编辑 textarea 视觉区分，并带稳定 testid（`segment-prompt-translation`）。

### Scenario: 视频提示词存在译文

- **WHEN** 界面语言为 zh、分段存在非空 `videoPromptTranslation`
- **THEN** 视频优化词文本域下方展示只读中文翻译，内容等于该分段的 `videoPromptTranslation`
- **AND** 翻译块紧邻其对应的视频优化词文本域（上下相邻，中间无其他编辑控件）

### Scenario: 视频提示词无译文

- **WHEN** 分段无 `videoPromptTranslation`（旧项目、翻译失败或未重新生成）
- **THEN** 视频优化词文本域下方仍渲染翻译块，内容为占位文案（复用 `story2video.sceneMaterial.emptySlot`）
- **AND** 不得渲染空白块或抛错

### Scenario: 图片与视频翻译成对且可区分

- **WHEN** 分段同时存在 `promptTranslation` 与 `videoPromptTranslation`
- **THEN** 页面渲染两个翻译块：图片提示词下方一个、视频优化词下方一个
- **AND** 两个翻译块各带归属标签（`promptTranslationLabel` / `videoPromptTranslationLabel`），用户可判断该译文描述哪一个提示词

### Scenario: en 界面不展示任何翻译块

- **WHEN** 界面语言为 en
- **THEN** 图片提示词与视频优化词下方均不渲染可见译文（两个 `show*Translation` 判定返回 false）

## ADDED Requirement: 重新生成视频优化词时生成中文译文

Story2Video 历史记录重新生成视频优化词（`regenerateScenePrompt` kind=video）成功后 SHALL 为新生成的 `videoPrompt` 生成本国语言译文并持久化到 `videoPromptTranslation`。

### Scenario: 重新生成视频优化词产出译文

- **WHEN** 用户重新生成某场景视频优化词且引擎返回有效 `videoPrompt`
- **THEN** 分段 `videoPrompt` 更新为新值
- **AND** 主进程调用默认 LLM 生成译文（严格 JSON 协议、目标语言跟随 `uiLocale`）
- **AND** 译文非空且不等于原文时写入 `videoPromptTranslation`（≤2000 字符）

### Scenario: 重写后旧译文被清空

- **WHEN** 重新生成视频优化词前该分段已有 `videoPromptTranslation`
- **THEN** 旧译文 MUST 被清空后再写新译文
- **AND** 翻译失败时 `videoPromptTranslation` 为 null（不得保留上一轮陈旧译文）

### Scenario: 翻译失败不阻塞优化词本身

- **WHEN** LLM 不可用、返回非法内容、超时或抛错
- **THEN** 分段 `videoPrompt` 仍为新值，`status` 仍为 `completed`
- **AND** `videoPromptTranslation` 为 null，不得抛错、不得改分段状态

### Scenario: 译文与原文相同视为未翻译

- **WHEN** LLM 返回的译文与视频提示词原文相同（引擎直出中文或回显原文）
- **THEN** `videoPromptTranslation` 为 null，结果页不展示冗余译文

### Scenario: 图片分支不触碰视频译文

- **WHEN** 用户重新生成图片优化词（kind=image）
- **THEN** `videoPromptTranslation` 保持原值不被改写
- **AND** 不发起任何翻译调用

### Scenario: 译文字段前端只读

- **WHEN** 渲染端保存分段（`updateSegments`）并携带 `videoPromptTranslation`
- **THEN** 该字段 MUST 被白名单丢弃，不得覆盖服务端译文

## ADDED Requirement: 分段编辑区默认折叠

ResultView 分段编辑区的可编辑主体 SHALL 默认折叠（紧凑态），用户点击分段卡片头部的展开开关后才渲染。

### Scenario: 默认紧凑态

- **WHEN** 用户打开项目详情页且未主动展开任何分段
- **THEN** 分段卡片只渲染分段序号、状态、素材区概览与展开开关
- **AND** 不渲染旁白文字/字幕/提示词/翻译/语音设置等编辑控件

### Scenario: 展开态互斥

- **WHEN** 用户展开分段 A 后再展开分段 B
- **THEN** 分段 A 自动收起，同时只有一个分段处于展开态

### Scenario: 删除已展开分段时收起

- **WHEN** 用户删除当前处于展开态的分段
- **THEN** 编辑区收起为紧凑态，不得残留指向已删除分段 id 的展开态

### Scenario: 重新生成失败不改变展开态

- **WHEN** 分段处于展开态且「重新生成提示词」失败
- **THEN** 该分段保持展开态（失败通知不得连带收起编辑区）

## MODIFIED Requirement: 提示词翻译块位置

项目详情（ResultView 分段编辑）中「画面提示词」的只读翻译文本 MUST 紧邻该提示词文本域下方（而非位于两个提示词文本域与重新生成按钮之后）。

### Scenario: 图片翻译块紧邻图片提示词

- **WHEN** 界面语言非 en 且分段存在非空 `promptTranslation`
- **THEN** 画面提示词文本域下方紧邻渲染只读中文翻译块
- **AND** 翻译块与视频优化词文本域之间不得插入其他编辑控件
