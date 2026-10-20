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

| 文件 | 必填 | 说明 |
|------|------|------|
| `film-manifest.json` | ✅ | 电影元数据 + 162 场景树 |
| `shot-library.json` | ✅ | 153 个分镜（每场景代表性真实提示词） |
| `reference-registry.json` | ✅ | token → 参考素材索引（332 条，100% 解析） |
| `prompt-doctrine.json` | ✅ | 提示词架构（v7：11 blocks / 14 rules / 2 recipes / 8 失败台账 / 10 glossary，中英双语） |
| `shot-grammar.json` | v7 增强 | 镜头语言枚举（10 景别 / 12 运镜 / 8 机位 / 6 光线 / 8 特效 / 3 情绪档 / 4 时长档） |
| `compliance-checklist.json` | v7 增强 | 剧本合规审核清单（12 条，blocker 5 / warn 7） |
| `palette.json` | v7 增强 | 剧组色盘（4 主色 + 2 扩展色 + 情绪色彩映射 + 漂移治理四步） |
| `prompts/tasks/<task>/{zh,en}/{system,user}.md` | v7 增强 | 任务化中英成对提示词库（目录即契约，4 个任务 × 2 语种 × 2 文件） |
| `prompt-doctrine.zh.md` | 否 | 方法论文档（人类可读版，随包交付） |
| `images/` | 否 | 精选参考图（4 角色定妆 + 6 场景缩略，512px webp）+ `images-manifest.json` |

体积目标：< 6MB（当前约 2.8MB；v7 新增文本资产合计 < 60KB）。

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

## 十一、生成与重建

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
