# film-kit 数据资产 Schema（影视项目案例）

> 本目录由 `scripts/film-engineering/` 下的导入脚本从公开语料重建（可复现）。
> 加载与校验实现：`apps/desktop/electron/services/film-engineering/kit-loader.js`（fail-closed）。
> 校验不通过 → 整体返回 `FILM_KIT_UNAVAILABLE`，不允许部分降级。
>
> **v7（2026-10-20）变更**：新增三份数据资产（`shot-grammar.json` / `compliance-checklist.json` /
> `palette.json`）与一个任务化提示词目录（`prompts/tasks/`），并把 `prompt-doctrine.json` 从
> 7 blocks / 10 rules / 6 glossary 扩展到 **11 blocks / 14 rules / 2 recipes / 8 failureLedger / 10 glossary**。
> 新增资产的**缺失**与**损坏**按两种形态处理，见「零、失败形态」。

## 零、失败形态（v7 引入的精确边界）

`kit-loader` 对资产区分「缺失」与「损坏」，两者结局不同：

| 形态 | 判定 | 结局 | 理由 |
|------|------|------|------|
| **核心 4 件缺失/损坏** | `film-manifest` / `shot-library` / `reference-registry` / `prompt-doctrine` | **整级不可用** | 缺了就不是一部可用的影视工程 |
| **v7 增强资产损坏** | `shot-grammar` / `compliance-checklist` / `palette` / `prompts/tasks` 存在但非法 | **整级不可用** | 绝不允许拿半份数据继续跑（fail-closed 的真正含义） |
| **v7 增强资产缺失** | 同上但文件/目录不存在 | **可用 + `kit.assetWarnings` 记一条** | 旧版 kit 属正常升级态，不该让整套影视工程瘫痪 |
| **严格模式** `requireAssets: true` | 增强资产缺失 | **整级不可用 → 触发回退链降级** | 导入校验与运行期读盘用同一函数，只是严格度不同 |

`kit.assetWarnings` 是**可见面而非静默面**：调用方必须能读到「你的 kit 是旧版，缺了哪几件」。
`loadFilmKitChain` 支持透传 `requireAssets`，严格模式下缺失会回退到下一级（asar 内置包）。

## 文件清单

| 文件 | 必填 | 导入 | 说明 |
|------|------|------|------|
| `film-manifest.json` | ✅ | ✅ | 电影元数据 + 162 场景树 |
| `shot-library.json` | ✅ | ✅ | 153 个分镜（每场景代表性真实提示词） |
| `reference-registry.json` | ✅ | ✅ | token → 参考素材索引（332 条，100% 解析） |
| `prompt-doctrine.json` | ✅ | ✅ | 提示词架构（v7：11 blocks / 14 rules / 2 recipes / 8 失败台账 / 10 glossary，中英双语） |
| `shot-grammar.json` | v7 增强 | ✅ | 镜头语言枚举（10 景别 / 12 运镜 / 8 机位 / 6 光线 / 8 特效 / 3 情绪档 / 4 时长档） |
| `compliance-checklist.json` | v7 增强 | ✅ | 剧本合规审核清单（12 条，blocker 5 / warn 7） |
| `palette.json` | v7 增强 | ✅ | 剧组色盘（4 主色 + 2 扩展色 + 情绪色彩映射 + 漂移治理四步） |
| `prompts/tasks/**` | v7 增强 | ✅ | 任务化中英成对提示词库（目录即契约；实际形状 `prompts/tasks/<task>/{zh,en}/{system,user}.md`，4 个任务 × 2 语种 × 2 文件） |
| `prompt-doctrine.zh.md` | 否 | ✅ | 方法论文档（人类可读版，随包交付） |
| `images/` | 否 | ❌ | 精选参考图（4 角色定妆 + 6 场景缩略，512px webp）+ `images-manifest.json`；**无消费方 ⇒ 不在导入白名单** |

体积目标：< 6MB（当前约 2.8MB；v7 新增文本资产合计 < 60KB）。

**导入白名单** = 上表「导入」列标 ✅ 的行（**9 项**）。
**排除项清单**：`images/`（**全仓无消费方** ⇒ 不导入、不校验、不进镜像表；随包资产里的它**不受影响**）。
**镜像断言的归一化与排序**（`kit-mirror-check.js`）：代码白名单与本表都走 `path.posix.normalize` → 去尾斜杠 → **按字典序（`localeCompare`）排序** → 再逐行 `===` ⇒ 不同实现不会漂移。

## 一、film-manifest.json

```jsonc
{
  "schemaVersion": 1,                       // 必须 === 1
  "filmMeta": {
    "title": "Film Project Case",           // 非空字符串（中性中文案，界面按 locale 本地化）
    "durationSec": 5706,                    // 正数
    "logline": "…",                         // 非空字符串
    "characters": [{ "name": "ROKO", "descriptor": "…" }],  // 非空数组，每项含非空 name
  },
  "scenes": [
    { "id": "<uuid>", "name": "…", "count": 3, "parentId": "<uuid|null>", "level": 0 }
  ]
}
```

校验规则（kit-loader）：
- `scenes` 非空；`id` 唯一非空；`name` 非空；`count >= 0`；`level >= 0`。
- 树校验：`parentId` 必须指向已存在场景或为 `null`；禁止自引用（环）。

## 二、shot-library.json

```jsonc
[
  {
    "shotId": "<uuid>",          // 唯一非空
    "sceneId": "<uuid>",         // 必须存在于 manifest.scenes
    "prompt": "EXACT 3 CHARACTERS…",  // 非空；上限 50000 字符（真实提示词最高约 39470）
    "imagePrompt": "…",          // 可选；首帧图提示词；缺省由加载器归一化为 prompt
    "videoPrompt": "…",          // 可选；视频运动提示词；缺省归一化为空串（**不回落 prompt**）
    "endFramePrompt": "…",       // 可选；尾帧约束；缺省归一化为空串
    "model": "seedance_2_0",     // 非空
    "refTokens": ["<uuid>", …],  // 可选；数组，每项字符串 ≤64 字符
    "resultUrl": "https://…",    // 可选；https URL
    "thumbnailUrl": "https://…", // 可选；https URL
    "width": 1920,               // 可选；正数或 null
    "height": 1080               // 可选；正数或 null
  }
]
```

- 每个场景取最后一个 `completed` 的视频类 job（按 `created_at` 升序）作为代表分镜。
- **v7 计划新增字段**（尚未写入本语料，由 `shot-duration.js` 在运行时派生）：
  `durationMs` / `durationSec` / `durationSource`。见「七、时长来源优先级链」。

### 2.1 提示词三分（影视工程 v2 · F-A）

| 字段 | 语义 | 缺省（加载期归一化） | 消费方 |
|------|------|--------------------|--------|
| `imagePrompt` | **首帧图**提示词：静态画面（主体 / 场景 / 光线 / 构图 / 风格） | `??= prompt`（**逐字等于旧 prompt**） | 图片生成（`film-engineering-service.generateSelected`） |
| `videoPrompt` | **视频运动**提示词：只保留运镜 + 主体 + 时长内的变化，**不含**静态画面全量 | `??= ''`（**空**，**不回落 prompt**） | 视频生成（`video-gen.buildShotSubmitPayload`） |
| `endFramePrompt` | **尾帧约束**：末帧应当是什么（衔接下一镜的起点） | `??= ''` | 本批次**只产出不消费**（消费前置见 OpenSpec spec） |

**加载期归一化口径**（`shot-prompts.normalizeShotPrompts`）：`imagePrompt ??= prompt`、`videoPrompt ??= ''`、`endFramePrompt ??= ''`。
归一化后下游**不再有 `?? prompt` 分支**；消费侧回落链是 `videoPrompt → imagePrompt → prompt`（视频）与 `imagePrompt → prompt`（图片）。

**为什么 `videoPrompt` 回落空串而不是 `prompt`**：回落 `prompt` 会让「存量分镜的视频提示词过长」这件事
**被掩盖成已解决**（字段非空、长度不减）。留空 ⇒ 消费侧回落 `imagePrompt`，**边界在数据上可见**。
存量长提示词的真正治理是后续项（一次性重算 + 人工审核），不在本批次。

### 2.2 分镜提示词的字段校验

单字段长度上限仍是 `FILM_PROMPT_MAX_LEN = 50000`（**未放宽**），三分各自都受它约束。

**没有「三分合计上限」**：早期草案曾设 `FILM_PROMPT_BUNDLE_MAX_LEN = 50000`，但该值与单字段上限相同 ⇒ 三段各自顶格的**合法**资产会被误判死；而三段各自已被单字段上限约束，合计上限**永远不会触发**（除非法输入），是个装饰性判据。**已删除**（验证层评审 i4）。

真正起作用的护栏是**字段类型与长度校验**（`validateShotPromptFields`）：三分字段存在即必须是字符串且不超单字段上限。

## 三、reference-registry.json

```jsonc
{
  "<uuid-token>": {
    "kind": "character | scene | prop | unknown",
    "name": "REIN | museum | crystal_sword | null",  // 若存在必须非空
    "category": "character | auto:character | environment | prop …",  // 可选
    "folder": "<来源文件夹名>",       // 可选（job-id 兜底解析时才有）
    "imageUrls": ["https://…"]      // 可选；仅允许 https
  }
}
```

- **key 必须是 UUID**（36 字符）；非 UUID key（如统计占位）一律非法。
- 解析顺序：`params.reference_elements[].id` 主索引 → job id 兜底 → `unknown`。
- `unknown` 条目允许存在（保留少量样例），但分镜 refTokens 应尽量全部解析为 known。
- **身份锚点约定（v7）**：同一角色有多张参考图时，**第一张为身份锚点**，其余只提供环境与光影。
  该约定由 `prompt-doctrine.json` 的 glossary `identity anchor` 与 `failureLedger` FL-01 共同表达。

## 四、prompt-doctrine.json（v7 扩展）

```jsonc
{
  "schemaVersion": 2,                                    // v7 起为 2
  "blocks": [
    { "key": "scene_context", "label": "SCENE CONTEXT", "zh": "…", "en": "…" }  // 非空
  ],
  "rules": [{ "key": "assets-first", "title": "…", "zh": "…", "en": "…" }],     // 非空
  "recipes": [                                          // 可选；声明则非空
    { "key": "full", "label": "FULL", "zh": "…", "en": "…", "blockKeys": ["style", "scene_context", …] }
  ],
  "failureLedger": [                                    // 可选；声明则非空
    { "id": "FL-01", "symptom": "…", "cause": "…", "fix": "…", "tags": ["consistency"] }
  ],
  "glossary": [{ "term": "…", "zh": "…", "en": "…" }]    // 数组
}
```

校验规则（`validateDoctrine`）：
- `blocks` / `rules` 非空；每项 `key` 非空；`blocks` 每项 `label` 非空。
- `recipes` 若声明：必须非空数组；每项含非空 `key` 与非空 `blockKeys`；
  **`blockKeys` 引用的每个 key 必须真实存在于 `blocks`**（防止配方指向不存在的块）。
- `failureLedger` 若声明：必须非空数组；每项含非空且唯一的 `id`，且 `symptom` / `cause` / `fix` 三者皆非空。

**为什么「声明为空」也算失败**：半张台账比没有台账更危险——它会让人以为踩过的坑都有记录。
所以要么完整维护，要么整块省略。

### v7 新增的 4 个块

| key | label | 内容要点 | 来源 |
|-----|-------|---------|------|
| `long_dialogue_split` | LONG DIALOGUE HANDLING | 长台词 7 手法 T1-T7 + 单镜台词上限（中文 40 字 / 英文 25 词） | short-drama-skills（MIT） |
| `action_choreography` | ACTION CHOREOGRAPHY | 动作戏 17 条要点（一镜一动作、终点姿态、避免肢体交叠…） | short-drama-skills（MIT） |
| `frame_constraint` | FIRST / LAST FRAME CONSTRAINT | 首尾帧强约束 21 条（静止构图、可继续姿态、单一物理事件…） | story2video 参考产品（自撰结构） |
| `transition_medium_cover` | AI TRANSITION — MEDIUM COVER | 形变必须有介质掩护 + 介质时序 2-4 帧 + 四类难度对 | FireRed-OpenStoryline（Apache-2.0） |

### v7 新增的 4 条规则

`no-pronoun-visual`（视觉描述禁代词）、`duration-from-text`（时长由台词推算）、
`single-physical-event`（首尾帧之间只允许一个物理事件）、`medium-cover-on-morph`（形变必须有介质）。

### v7 新增的 recipes（分端配方）

| key | 用途 | blockKeys |
|-----|------|-----------|
| `full` | 关键镜、开场镜、情绪转折镜 | 7 个基础块全量 |
| `firstline` | 批量过镜、预演、快速试错（**不用于终版**） | `style` + `scene_context` |

### v7 新增的 failureLedger（失败模式台账 8 条）

`FL-01` 角色串脸 / `FL-02` 长台词嘴型对不上 / `FL-03` 转场融化粘连 / `FL-04` 首尾帧中间段脑补 /
`FL-05` 同场次空间关系错乱 / `FL-06` 动作戏糊成一团 / `FL-07` 风格跨集漂移 / `FL-08` 看着对却不对味。

**用法**：改提示词之前先查台账——症状对上了就直接用 `fix`，不要重新试错。

## 五、shot-grammar.json（v7 新增）

```jsonc
{
  "schemaVersion": 1,
  "shotSizes":      [{ "key": "wide", "zh": "远景", "en": "Wide shot", "abbr": "WS", "zhUsage": "…", "enUsage": "…", "chain": "wide" }],
  "cameraMoves":    [{ "key": "dolly_in", "zh": "推镜", "en": "Dolly in", "zhUsage": "…", "enUsage": "…", "risk": "medium" }],
  "cameraAngles":   [{ "key": "low_angle", "zh": "仰拍", "en": "Low angle", "zhUsage": "…", "enUsage": "…", "emotion": "power" }],
  "lightingSetups": [{ "key": "key_light", "zh": "…", "en": "…", "zhUsage": "…", "enUsage": "…" }],
  "vfxPresets":     [{ "key": "light_flare", "zh": "镜头光斑", "en": "Lens flare", "zhUsage": "…", "enUsage": "…", "risk": "low" }],
  "emotionTiers":   [{ "key": "normal", "zh": "常规", "en": "Normal", "zhCharsPerSecond": 8, "zhNote": "…", "enNote": "…" }],
  "durationTiers":  { "supportedSec": [5, 8, 10, 12], "maxSec": 12, "zhRule": "…", "enRule": "…" },
  "notes":          { "zhPriority": "…", "enPriority": "…", "zhChainRule": "…", "enChainRule": "…", "zhRiskScale": "…", "enRiskScale": "…" }
}
```

校验规则（`validateShotGrammar`）：
- 六个数组组（`shotSizes` / `cameraMoves` / `cameraAngles` / `lightingSetups` / `vfxPresets` / `emotionTiers`）
  **每组非空**；每项 `key` 非空且在**组内唯一**；每项 `zh` 与 `en` 均非空（中英成对是硬契约）。
- `durationTiers.supportedSec` 非空且每项为正数；`durationTiers.maxSec` 为正数
  且 **不得超过 `supportedSec` 的最大档位**（否则上限形同虚设）。

### 时长档的单一真源（v7 对抗评审第二轮 i3）

档位在仓库里只有**两个合法出处**，不得再有第三份字面量：

| 出处 | 用途 |
|------|------|
| `shot-duration.js` 的 `DEFAULT_TIERS` | **运行时能力表**（缺省档位）。`auto-plan` 直接复用它，不再自带一份 |
| 本文件 `durationTiers.supportedSec` | **资产声明**。必须与 `DEFAULT_TIERS` 一致；要放宽档位就同时改两处并加测试 |

`auto-plan.js` 的 `AUTO_SHOT_SECONDS=[5,8,10]` 是**用户输入白名单**（`validateAutoInputs` 用），
与能力表语义不同，**不得**兼当档位表——初版就是把它兼当档位表，导致资产承诺 12s 而自动模式
最高只有 10s（第二轮 i3）。

设计要点：
- `chain`（宽/中/近 三组）用于「相邻景别跨度 ≤ 两级」的链式校验；
- `risk`（low/medium/high）用于批量生成的风险分流：**high 档必须单独试镜，不进批次**。
  该字段是**闭集**，`validateShotGrammar` 会拒绝拼错的值（如 `hihg`）——否则「high 必须试镜」
  这条安全规则会被一个拼写错误静默架空（v7 对抗评审第二轮 i6）。`chain` 与 `emotion` 同理；
- `emotionTiers.zhCharsPerSecond` **不是**自动生效的运行时事实源：`shot-duration.js` 有内置默认档，
  资产值必须经 `estimateShotSeconds(..., { zhCharsPerSecond })` 或 `planAutoShots({ durationTiers })`
  的注入路径才会覆盖（v7 对抗评审第二轮 i2 —— 原表述写「直接驱动」，与实现不符，属「假同源」）。
  接入方应把本字段读出来传进去，而不是假定改了 JSON 就生效。

## 六、compliance-checklist.json（v7 新增）

```jsonc
{
  "schemaVersion": 1,
  "severityScale": { "blocker": { "zh": "…", "en": "…" }, "warn": { "zh": "…", "en": "…" } },
  "categories": [{ "key": "content", "zh": "内容合规", "en": "Content compliance" }],
  "items": [{
    "id": "CC-01", "category": "content", "severity": "blocker",
    "zhQuestion": "…", "enQuestion": "…",
    "zhPass": "…", "enPass": "…",
    "zhFix": "…", "enFix": "…"
  }],
  "workflow": { "zh": ["1. …", "2. …"], "en": ["1. …", "2. …"] }
}
```

校验规则（`validateComplianceChecklist`）：
- `items` 非空；每项 `id` 非空且在**清单内唯一**。
- `severity` 必须为 `blocker` 或 `warn`（闭集，不接受自定义档位）。
- 六个文案字段（`zhQuestion` / `enQuestion` / `zhPass` / `enPass` / `zhFix` / `enFix`）**全部非空**——
  只报问题不给修法等于没清单。
- `categories` 非空；每项 `category` 必须引用已声明的分类 key（不许悬空引用）。

12 条覆盖：内容合规 5（CC-01/04/11/12 + CC-02 IP）、真实身份 1（CC-03）、结构完整性 1（CC-05）、
连续性 2（CC-06/07）、技术可行性 3（CC-08/09/10）。

## 七、palette.json（v7 新增）

```jsonc
{
  "schemaVersion": 1,
  "limits": { "maxPrimary": 4, "maxExtended": 2 },
  "primary":  [{ "key": "primary_1", "hex": "#0E1A24", "zhName": "夜色近黑", "enName": "Night near-black", "zhRole": "…", "enRole": "…" }],
  "extended": [{ "key": "extended_1", "hex": "#4A5D4E", "zhName": "灰绿", "enName": "Grey green", "zhRole": "…", "enRole": "…" }],
  "paletteLine": { "zh": "色盘：#0E1A24 / #1F4E5F / …", "en": "Palette: #0E1A24 / #1F4E5F / …" },
  "emotionColorMap": [{ "emotion": "calm", "zhEmotion": "平静", "zhColor": "…", "enColor": "…" }],
  "drift": { "zh": ["1. 声明 …", "2. 复用 …"], "en": ["1. Declare …", "2. Reuse …"] }
}
```

校验规则（`validatePalette`）：
- `primary` 非空且 **≤ `limits.maxPrimary`（4）**；`extended` **≤ `limits.maxExtended`（2）**。超限即判「色盘失控」。
- 每项 `key` 非空且**全文件唯一**（primary 与 extended 共用命名空间）。
- `hex` 必须是 `#RRGGBB`（6 位，不接受 3 位缩写与 alpha）。
- 每项 `zhName` / `enName` 非空。
- `paletteLine.zh` 与 `paletteLine.en` 均非空，且 **每个主色 hex 都必须出现在注入串里**——
  否则「机械注入」会漏色，而这是跨集一致性的唯一保证。

**为什么注入串要校验 hex 出现**：色盘的价值不在「文件里写了 4 个颜色」，而在
「每次生成都原样粘贴同一串」。若注入串漏掉一个色，模型就会自行补一个，漂移从这一刻开始。

## 八、prompts/tasks/**（v7 新增，目录即契约）

```
prompts/tasks/<task>/zh/system.md
prompts/tasks/<task>/zh/user.md
prompts/tasks/<task>/en/system.md
prompts/tasks/<task>/en/user.md
```

契约（`prompt-library.js`）：
- `<task>` 必须匹配 `^[a-z][a-z0-9_]*$`（小写字母开头的 snake_case）；不匹配的目录被 `listTasks` 忽略。
- 每个任务**必须同时具备** zh 与 en，且各自**必须同时具备** `system.md` 与 `user.md`。
- 文件内容 `trim()` 后必须非空（空 prompt 比缺 prompt 更危险）。
- 单文件 ≤ 64KB（`MAX_PROMPT_FILE_BYTES`）。
- 路径穿越防护：任务名与语种先过白名单，再断言解析后的绝对路径仍在 `tasksRoot` 之内
  （`resolveInside`）；`..` 与越界符号链接一律拒绝。

模板渲染（`renderTemplate`）：
- 占位符形如 `{{var}}`，`var` 必须匹配 `^[a-z][a-z0-9_]*$`（大写或含符号的占位符**不被替换**）。
- **未提供的变量保留原样**并列入 `missing`——不静默替换为空串。漏填要能被看见。
- `null` / `undefined` 替换为空串；对象与数组序列化为 JSON；数字与布尔转字符串。

当前 4 个任务：

| task | 用途 | 关键约束 |
|------|------|---------|
| `adapt_script` | 剧本 → 分镜表 | 不丢字 / 一镜一事件 / 首镜广角 / 台词上限 / 禁代词 / 景别跨度 ≤2 |
| `generate_shot_prompt` | 分镜 → image/video/endFrame 提示词 | 七块结构 / 禁代词 / 尾帧约束 / 介质掩护 / 高风险运镜须试镜 |
| `generate_ai_transition` | 相邻镜 → AI 转场 | **介质掩护铁律** + 形变难度四档 + 介质时序 2-4 帧 |
| `filter_clips` | 成片判定 | 七维度 / 五档处置（pass / retry / revise / split / drop）/ 置信度 |

## 九、时长来源优先级链（v7 新增，`shot-duration.js`）

`Shot.durationMs` 是**一个字段**，由四个来源按优先级填充（高 → 低）：

| 优先级 | source | 含义 | 何时使用 |
|--------|--------|------|---------|
| 1 | `user` | 用户在分镜表里显式设定 | 最高权威，不再推算 |
| 2 | `tts` | TTS 实测时长 | 有音频时的物理事实 |
| 3 | `formula` | 按台词字数与情绪档推算 | 无 TTS 时的最佳估计 |
| 4 | `tier` | 全局档位默认 | 兜底，保证永远有值 |

推算口径（`formula`）：
- 中文按**字**计，英文按**词**计，**中英混排分别折算后相加**（单一语速乘总数会系统性低估英文、高估中文）；
- 语速档：常规 8 字/秒、争吵 10 字/秒、深情 5 字/秒（英文 2.6 / 3.4 / 1.7 词/秒）；
- 括号内的舞台提示不计入（不占说话时长）；
- 原始秒数**向上**吸附到 `supportedSec`（只向上不向下——向下会切掉台词尾巴）；
- 超过 `maxSec` 时取 `maxSec` 并置 `overflow`，同时给出「必须按 long_dialogue_split 拆解」的警告。

非法值处理：**降级并出声**，不静默。
- `user` 超过上限 → 截到上限 + 警告「请改用拆镜而不是压缩时长」；
- `user` 低于下限 → 抬到下限 + 警告；
- `user` / `tts` 非法值 → 记警告「用户设定时长非法 / TTS 实测时长非法」后降级到下一来源。

## 十、images/images-manifest.json

```jsonc
{
  "char_1.webp": { "name": "ROKO" },                          // 角色定妆图
  "scene_1.webp": { "shotId": "<uuid>", "sceneId": "<uuid>" } // 场景缩略图
}
```

- 所有图片统一 `512px` 最长边 webp（q82），单张 < 20KB，合计 < 120KB。
- 角色图按 `ROKO / JAXX / LULU / REIN` 优先，缺失时取其他 character 条目兜底。

## 十一、导入契约（PR-3b · F-J 资产导入写路径）

> 本节是**用户导入自己的资产包**时的契约（`kit-import.js` 实现）。
> ⚠ **本文件不用于运行时解析**（首节声明）：运行时代码**禁止**解析它做判据；
> `kit-mirror-check.js` / `kit-schema-contract.test.js` 是**构建期/测试期工具**（不在运行路径上）⇒ 不违反该声明。
> `SCHEMA.md` 是**提交进仓的普通文件**（不是生成物）⇒ CI「检出 ⇒ 跑测试」顺序天然成立。

### 11.1 白名单与形状

- **白名单**：见上表「导入」列（9 项）；**唯一真源 = 代码**（`kit-import.js` 的 `WHITELIST_PATTERNS` 导出），
  本表是它的**人读镜像** ⇒ `kit-mirror-check.js` 逐行 `===` 断言（归一化 + 字典序规则见上节）。
- ⚠ **导入（严格模式）下「v7 增强」那几项是必填的**：上表「必填」列写的是**运行期**口径
  （运行期缺 v7 资产 ⇒ 记告警、仍可用）；**导入走严格模式**（`loadFilmKit({requireAssets:true})`）
  ⇒ `shot-grammar` / `compliance-checklist` / `palette` / `prompts/tasks` 缺一即**整包拒绝**
  （与 `kit-loader.js` 的 `requireAssets` 语义一致）⇒ 旧版资产包会被拒，这是**有意的**。
- **深度**：`prompts/tasks/**` 的**基准 = `prompts/tasks`**（代码常量 `BASE_PROMPT_PATH`）⇒ 恰 **3 层**
  （`<task>/<lang>/<file>`），少一层即拒。
  ⚠ **层级不符一律拒，不静默跳过**（`VALIDATION_ERROR`）：`prompts/tasks/**` 是**白名单内**路径，
  深度错乱属「形状不对」⇒ 跳过会让一个缺任务/深度错的包「导入成功」。
- **非普通文件一律拒**：任务库任一层出现**软链 / 联接点 / 设备文件** ⇒ 拒
  （`SYMLINK_REJECTED` / `VALIDATION_ERROR`）—— 同样**不静默跳过**。
- **隐藏名**：**候选路径**的任何组件以 `.` 开头 ⇒ 拒（`.` / `..` 由**枚举阶段先跳过**，不计入层数）。
- **扩展名**：根文件 ∈ `{json}`；`prompts/tasks/**` ∈ `{md}`。
- **白名单外**的条目（**含 `images/`**）**不拷入、不记审计事件、不算失败**（跳过是正常态）。

### 11.2 链、越界与魔数

- **软链/断链** ⇒ 拒（`SYMLINK_REJECTED`）；**`realpath` 越出源目录** ⇒ 拒（`PATH_ESCAPE`）。
- **同目录硬链**：`(dev, ino)` 相同 ⇒ 拒（`HARDLINK_REJECTED`）—— **与 `nlink` 无关**，任何文件系统都成立。
  ⚠ 去重键**必须带父目录**（`<父目录>\0<dev>:<ino>`）⇒ 判据只覆盖**同一目录内**的重复条目；
  跨目录的同 inode **不拒**（那超出本契约声明的边界，见下一条）。
- ⚠ **跨目录硬链 = 非防篡改边界**：`nlink` 在 FAT/exFAT/网络盘恒为 1 ⇒ 跨目录硬链**永远漏判**
  ⇒ 审计行固定记 `hardlink_check=best-effort`（**不虚报已防护**）；本机主人对目标文件本就有读权限
  ⇒ 该维度是**防误含**措施，不是安全边界。
- **魔数**：`*.json` 头须 `{` / `[`（去 BOM/空白）⇒ 不匹配即拒（`MAGIC_MISMATCH`），**不写盘**。

### 11.3 体积上限

单文件 **32 MB**、整包 **256 MB**（`MAX_KIT_FILE_BYTES` / `MAX_KIT_TOTAL_BYTES`；**数值以代码导出为唯一真源**）。
**祖父条款**：上限**仅作用于用户选定的源目录**（kitDir）；目标 `userData/film-kit` 在成功时**整体替换**、**不参与**上限判定。

### 11.4 失败原因闭集（18 值）

`VALIDATION_ERROR` / `NOT_A_DIRECTORY` / `PATH_ESCAPE` / `SYMLINK_REJECTED` / `HARDLINK_REJECTED` /
`HIDDEN_NAME_REJECTED` / `EXT_NOT_ALLOWED` / `MAGIC_MISMATCH` / `SIZE_EXCEEDED` / `PARENT_NOT_WRITABLE` /
`LOCK_CREATE_FAILED` / `SWAP_FAILED` / `ROLLBACK_FAILED` / `CANCELLED` / `UNAUTHORIZED_SENDER` /
`SOURCE_OVERLAPS_TARGET` / `AUDIT_UNAVAILABLE` / `LOCK_HELD`。

### 11.5 审计契约

- 文件 `userData/film-kit-import.log`（与目标 kit **同父**）。
- **行格式**：UTC ISO8601 时间戳 + **制表符分隔** + UTF-8 + `\n`（本节给一行**示例行**供测试断言）。
- **字段（顺序固定）**：时间 / sender URL / sender 路由 / 触发组件 / 所选目录 / 结果 / reason /
  post_check / recovery_state / 恢复路径（空值一律写 `-`）。
- **写入时机**：
  - **进入导入流程**的调用 ⇒ **两条**（`开始` + 结果）；
  - **未进入流程**的调用（未授权 / 对话框不可用 / 对话框失败 / 用户取消 / 所选路径非法）⇒ **一条结果行**
    （`reason` 落在 §11.4 的闭集内：`UNAUTHORIZED_SENDER` / `CANCELLED` / `NOT_A_DIRECTORY` /
    `VALIDATION_ERROR`；`DIALOG_UNAVAILABLE` / `DIALOG_FAILED` 是 **IPC 层**错误码、不在闭集内，
    审计行记 `VALIDATION_ERROR`，**精确错误码仍回传渲染端**）；
  - ⚠ **目标目录不可用**（`USERDATA_UNAVAILABLE`）⇒ 审计文件**物理上无处可写** ⇒ 该行不存在
    （这是「没有可写的审计文件」，不是「漏写」）。
- **写入失败 ⇒ 不得静默**：
  - **开始行**写失败 ⇒ **拒绝导入**（此时一个字节都还没写进目标目录）；
  - **结果行**写失败 ⇒ 导入**已生效**（资产已换入）但**审计不完整** ⇒ 必须**显式上报**
    （响应带 `auditWritten=false` + 渲染端给出提示），**不得**当成普通成功静默返回。
- **保留**：单文件追加；**> 10,000 行或 > 10 MB ⇒ 拒绝写入并拒绝新的导入**（**不追加、不截断** ⇒ 旧内容不丢）。
  **阈值判法**：大小以 `fs.stat` 读（追加前一次）；行数**启动时一次计数 + 之后按追加增量累加**（不每次全量读）。
  ⚠ **增量计数只在写成功时 +1**（写失败不计数）—— 否则计数单调偏高 ⇒ 正常导入被误判成 `AUDIT_UNAVAILABLE`。
- **权限**：可追加、不可改写（`fs.open({flags:'a'})`）；**互斥**由 `.import-lock` 的独占创建（`wx`）实现
  ⇒ 第二个导入进程建锁失败即拒（`LOCK_CREATE_FAILED`），不会行间交错。
- ⚠ **诚实边界**：审计防「**静默**」，**不防恶意篡改**（本机主人能改自己的文件）。

**示例行**（`SCHEMA.md` 供测试断言；制表符分隔）：

```
2026-10-23T08:00:00.000Z	app://localhost/#/film-engineering	/film-engineering	FilmEngineeringView	D:/my-kit	ok	-	PASS	-	-
```

### 11.6 `reason` × `post_check` × `recovery_state` 对应表（**由规则生成**）

- `post_check=PASS` ⇔ 导入成功且 staging 严格校验通过、**且无残留**；
- `post_check=FAIL_WITH_RECOVERY` ⇔ 发生回滚或留有残留 ⇒ `recovery_state` 按下列四档填；
- `post_check` 不出现 ⇔ 导入在换入前被拒（`reason` 直接给出原因，无恢复动作）。

> ⚠ 换入顺序（**崩溃点编号以此为准**）：⓪a 残留/重叠 → ⓪b 严格校验 → ⓪c 审计可写 →
> ⓪d 落开始行 → ⓪e 建锁 → ① 置标记 → ② 两遍扫描+拷贝+staging 复验 → ③ 清缓存 →
> **④ 旧 kit → `.bak`** → **⑤ staging → `film-kit`** → **⑥ 删 `.bak`** → **⑦ 删锁**。

| recovery_state | 含义 | 恢复动作 |
|-----------------|------|----------|
| `PRE_SWAP` | 失败发生在 **⓪–③**（kit **仍是旧的**、`.bak` 未动；锁**可能已被自动清理**） | 确认没有导入在进行后，**检查并**手动删除锁文件 |
| `MISSING_KIT` | 崩在 **④ 后 ⑤ 前**（`film-kit` **缺失**、`.bak` = 旧 kit） | 手动把 `.bak` 改名回 `film-kit` |
| `BAK_LEFT` | 崩在 **⑤ 后 ⑥ 前**，或 **⑥ 删 `.bak` 自身失败**（`film-kit` = 新的、`.bak` = 旧 kit） | 可安全删除 `.bak` |
| `LOCK_LEFT` | 崩在 **⑥ 后 ⑦ 前**，或 **⑦ 删锁自身失败**（只剩锁） | 手动删除锁文件 |

⇒ 契约测试**按同一规则生成期望值**再逐行断言（**不手写第二份** ⇒ 不会漂移）。
⚠ **档位不得张冠李戴**：`MISSING_KIT` 的恢复动作是「**改名回来**」，
`BAK_LEFT` 的恢复动作是「**可以删掉**」—— 两者互换会让用户**删掉旧资产仅存的一份**。

### 11.7 崩溃残留的三档恢复（全部**显式手动恢复**，无自动清理）

① `film-kit` 缺失 + `.bak` = 旧 kit ⇒ **必须手动 rename 恢复**（导入器会拒绝并给恢复路径，
   档位 `MISSING_KIT`）；
② `film-kit` = 新的 + `.bak` = 旧 kit ⇒ 锁可自动清（租约过期）⇒ **提示可安全删 `.bak`**（档位 `BAK_LEFT`）；
③ `film-kit` = 新的 + 无 `.bak` + 只剩锁 ⇒ 锁可自动清 ⇒ 资产已就位（档位 `LOCK_LEFT`）。
**清锁条件 = 租约过期 ∧ `film-kit` 存在**（owner 已被判定死亡 ⇒ 不会永久卡在 `LOCK_HELD`）。

### 11.8 取舍（写明以免被误读为遗漏）

① **禁止递归删除目录**（本仓 **R0 铁律**：目录删除一律拒绝、`safe-delete.js` 不接目录）—— staging/`.bak` 的清理
一律**按精确清单逐个 `unlink`** + **按深度从深到浅逐个 `rmdir` 空目录**（不递归）；
⚠ `fs.rm(dir, {recursive:true})` **一律不用**：它把「目录里的东西」放大成「整个目录」，一次误判就抹掉用户资产。
`.bak` 里可能有**白名单外**的文件（如 `images/`）⇒ 先**自走一遍树**取精确清单（不跟随软链/联接点）再删；
② **不做磁盘空间预检** —— ENOSPC 发生在**拷贝阶段** ⇒ 导入失败 + 按清单清 staging + **旧 kit 未动**
⇒ 只是失败得晚一点，**不产生损坏**；
③ **跨目录硬链非防篡改边界**（见 11.2）；
④ **窗口级/组件级授权不在本批** —— 只做 `withSenderCheck` + **sender 授权硬断言**
（只允许主框架 + 路由前缀 `/film-engineering` + 协议白名单）+ 全量审计；**目录只能由用户在原生对话框里选**
（renderer 不能指定替换内容）。

## 十二、生成与重建

导入脚本位于 `scripts/film-engineering/`，该目录下只有一个 `.py`（脚本名保留了历史命名，
含旧项目代号 —— 它不随包、不在去品牌范围内，故未改名；本文档不写它的字面量以免随包泄漏）。

```bash
# 先确认脚本名（目录下唯一的 .py）
ls scripts/film-engineering/*.py

python scripts/film-engineering/<上一步得到的脚本名> \
    --source-dir <全量语料目录> \
    --out-dir apps/desktop/electron/film-kit
```

⚠ 脚本**自带去品牌中性化与写前自检**（`neutralize_manifest` / `neutralize_payload` +
`assert_neutral_payload`）：源语料里的旧项目名、来源 URL、提示词引用锁标签都会被映射成中性值
（片名与根场景名 → `Film Project Case`、来源块整块删除、`…BATTLEFIELD` 之类的环境锁标签 → `PROJECT …`），
写盘前若仍有命中则直接失败、不留半成品。
`apps/desktop/src/i18n/film-debrand.test.js` 在 CI 上兜底（锁 ① 扫随包数据、锁 ⑤ 校验脚本仍有这两段）。

- 语料为公开 API 一次性抓取（155,123 jobs / 161 jsonl），脚本本地离线重建，无需登录。
- **v7 新增的四份资产不由该脚本生成**：它们是人工维护的方法论资产
  （`shot-grammar.json` / `compliance-checklist.json` / `palette.json` / `prompts/tasks/`），
  重建语料时**不得覆盖**它们。若脚本需清空输出目录，必须显式保留这四份。
