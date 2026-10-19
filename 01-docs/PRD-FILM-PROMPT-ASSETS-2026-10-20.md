# PRD — 影视工程提示词资产层（批次一落地）

> **文档编号**：PRD-FILM-PROMPT-ASSETS-2026-10-20
> **分支**：`film-batch1` ｜ **依据**：`01-docs/RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md` §5.2 批次一 + §3.22.3 修订排期
> **状态**：已实施（含 QM-1 打包验证证据）
> **分层判定**：混合 PR（改动 `apps/desktop/electron/` 运行时代码）→ 走完整质量节拍，已在隔离 worktree 完成

---

## 一、为什么要做这一层（问题陈述）

研究报告实测发现的三个具体缺口：

| 缺口 | 实测证据 | 后果 |
|------|---------|------|
| **单镜提示词一段到底** | `shot-library.json` 单条 prompt 最长 **13,922 字符** | 模型注意力衰减，中段约束被忽略；「看着对却不对味」且重试无效 |
| **没有单镜时长维度** | 只有全局三档 `AUTO_SHOT_SECONDS=[5,8,10]` | 「8 个字」与「80 个字」拿到同一时长；四方对照里 mulpub 是唯一完全没有该维度的实现 |
| **提示词资产只有 1 个文件** | `prompt-doctrine.json` 单文件 | 对比：FireRed 14 个、waoowaoo 33 个；任务级提示词无处存放，只能硬编码进代码 |

外加两个「已经踩过但没留记录」的问题：长台词在单镜内塞不下、跨集色调漂移。

---

## 二、目标与非目标

### 目标（本批次交付）

1. **数据资产层补齐**：镜头语言枚举、剧本合规清单、剧组色盘、任务级提示词库——四份新资产，全部随包分发、fail-closed 校验。
2. **方法论扩容**：`prompt-doctrine.json` 从 7 blocks / 10 rules / 6 glossary 扩到 **11 / 14 / 2 recipes / 8 失败台账 / 10 glossary**。
3. **单镜时长可算**：给 Shot 补 `durationMs` 并定义来源优先级链（user > tts > formula > tier）。
4. **零行为回归**：既有 `seconds` 语义、`plannedDurationSec` 语义、既有 407 个影视工程测试全部不变。

### 非目标（明确不做）

- ❌ **不做 Shot schema 的提示词三分**（`imagePrompt`/`videoPrompt`/`endFramePrompt`）——那是研究报告的 F8，涉及 153 条语料迁移，属批次二
- ❌ **不做身份锚点强制逻辑**（F15）——只把约定写进方法论与台账，不强制运行时校验
- ❌ **不做模型能力外置目录**（F3b 能力表）——与本批次的数据资产不同源
- ❌ **不改 TTS、不改渲染、不改生产驱动**
- ❌ **不做 Skill 沉淀机制**（F33）——新建目录属独立 PR

---

## 三、交付物清单

### 3.1 新增数据资产（`apps/desktop/electron/film-kit/`）

| 文件 | 规模 | 作用 |
|------|------|------|
| `shot-grammar.json` | 10 景别 / 12 运镜 / 8 机位 / 6 光线 / 8 特效 / 3 情绪档 / 4 时长档 | 让「景别/运镜/机位」成为**可校验的枚举**而非自由文本 |
| `compliance-checklist.json` | 12 条（blocker 5 / warn 7） | 生成前逐条过剧本合规，含「不通过怎么改」 |
| `palette.json` | 4 主色 + 2 扩展色 + 5 情绪映射 + 漂移治理 4 步 | 跨集色彩一致性靠**机械注入同一字符串** |
| `prompts/tasks/**` | 4 任务 × 2 语种 × 2 文件 = 16 个 `.md` | 任务级提示词外置，加任务只建目录不改代码 |

### 3.2 扩充既有资产

`prompt-doctrine.json`（`schemaVersion` 1 → 2）：

- 新增 blocks：`long_dialogue_split`（长台词 7 手法 T1-T7）、`action_choreography`（动作戏 17 条）、`frame_constraint`（首尾帧 21 条）、`transition_medium_cover`（介质掩护铁律）
- 新增 rules：`no-pronoun-visual`、`duration-from-text`、`single-physical-event`、`medium-cover-on-morph`
- 新增 `recipes`：`full`（7 块全量）/ `firstline`（首行精华，仅用于试错）
- 新增 `failureLedger`：8 条「症状 → 原因 → 修法」

### 3.3 新增代码模块

| 模块 | 行数规模 | 职责 |
|------|---------|------|
| `services/film-engineering/prompt-library.js` | ~290 行 | 任务化提示词库加载 + 模板渲染 + 路径穿越防护 |
| `services/film-engineering/shot-duration.js` | ~250 行 | 时长推算（F2）+ 来源优先级链（F34），纯函数零 IO |

### 3.4 修改既有代码

| 文件 | 改动 |
|------|------|
| `kit-loader.js` | `KIT_FILES` 4 → 7；新增 3 个校验器；区分「缺失/损坏」两种失败形态；`requireAssets` 严格模式；`kit.grammarIndex` 枚举索引 |
| `auto-plan.js` | 每镜派生 `durationMs`/`durationSec`/`durationSource`；新增 `estimatedDurationSec`/`durationSourceCount`/W8 警告 |

---

## 四、功能逻辑

### 4.1 数据校验（逐文件）

#### 4.1.1 `shot-grammar.json`

| 校验项 | 规则 | 失败结局 |
|--------|------|---------|
| 六组齐全 | `shotSizes`/`cameraMoves`/`cameraAngles`/`lightingSetups`/`vfxPresets`/`emotionTiers` 每组非空数组 | 硬失败 |
| key 非空 | 每项 `key` 非空字符串 | 硬失败 |
| key 组内唯一 | 同组内 key 不重复 | 硬失败 |
| 中英成对 | 每项 `zh` 与 `en` 均非空 | 硬失败 |
| 时长档合法 | `supportedSec` 非空且每项正数 | 硬失败 |
| 上限自洽 | `maxSec > 0` 且 **≤ `supportedSec` 最大值** | 硬失败 |

> **为什么上限要 ≤ 最大档**：若 `maxSec=20` 而档位最高 12，则「12-20 秒」这一段是无档可取的死区，
> 上限写成 20 只是给人一个不存在的承诺。

#### 4.1.2 `compliance-checklist.json`

| 校验项 | 规则 | 失败结局 |
|--------|------|---------|
| items 非空 | `items` 非空数组 | 硬失败 |
| id 唯一 | 每项 `id` 非空且清单内唯一 | 硬失败 |
| severity 闭集 | 必须为 `blocker` 或 `warn` | 硬失败 |
| 六字段齐备 | `zhQuestion`/`enQuestion`/`zhPass`/`enPass`/`zhFix`/`enFix` 全部非空 | 硬失败 |
| 分类已声明 | 每项 `category` 必须引用 `categories` 中已存在的 key | 硬失败 |

> **为什么 fix 必填**：只报问题不给修法的清单，用户读完仍然不知道下一步做什么——等于没清单。

#### 4.1.3 `palette.json`

| 校验项 | 规则 | 失败结局 |
|--------|------|---------|
| 主色上限 | `primary.length ≤ limits.maxPrimary`（默认 4） | 硬失败 |
| 扩展色上限 | `extended.length ≤ limits.maxExtended`（默认 2） | 硬失败 |
| key 唯一 | primary 与 extended **共用命名空间**，不许重名 | 硬失败 |
| hex 格式 | 必须 `#RRGGBB`（6 位，不接受 3 位缩写与 alpha） | 硬失败 |
| 名称非空 | 每项 `zhName` 与 `enName` 非空 | 硬失败 |
| 注入串成对 | `paletteLine.zh` 与 `paletteLine.en` 均非空 | 硬失败 |
| **注入串含全部主色** | `paletteLine.<locale>` 必须包含每个 `primary[].hex` | 硬失败 |

> **为什么注入串要校验 hex 出现**：色盘的价值不在「文件里存了 4 个颜色」，而在「每次生成都原样粘贴
> 同一串」。注入串漏一个色，模型就自行补一个，漂移从这一刻开始。

#### 4.1.4 `prompts/tasks/**`

| 校验项 | 规则 | 失败结局 |
|--------|------|---------|
| 任务名白名单 | `^[a-z][a-z0-9_]*$`；不匹配的目录被忽略（不算错误） | 忽略 |
| 语种成对 | 每个任务必须同时有 `zh/` 与 `en/` | 硬失败 |
| 文件齐备 | 每个语种必须同时有 `system.md` 与 `user.md` | 硬失败 |
| 内容非空 | `trim()` 后非空 | 硬失败 |
| 单文件上限 | ≤ 64KB | 硬失败 |
| 路径不越界 | 解析后的绝对路径必须仍在 `tasksRoot` 之内 | 硬失败 |
| 至少一个任务 | `tasksRoot` 下至少一个合法任务目录 | 硬失败 |

#### 4.1.5 `prompt-doctrine.json` 的 v7 增补校验

| 校验项 | 规则 | 失败结局 |
|--------|------|---------|
| recipes 非空 | 声明了就必须非空数组 | 硬失败 |
| recipes.blockKeys 有值 | 每项非空数组 | 硬失败 |
| **blockKeys 指向真实块** | 每个 key 必须存在于 `blocks` | 硬失败 |
| failureLedger 非空 | 声明了就必须非空数组 | 硬失败 |
| 台账 id 唯一 | 每项 `id` 非空且唯一 | 硬失败 |
| 台账三字段 | `symptom`/`cause`/`fix` 全部非空 | 硬失败 |

> **为什么「声明为空」也算失败**：半张台账比没有台账更危险——它会让人以为踩过的坑都有记录。

### 4.2 缺失 vs 损坏（v7 的精确边界）

这是本次实现中最重要的一个设计决定。

| 形态 | 判定 | 结局 |
|------|------|------|
| 核心 4 件缺失/损坏 | `film-manifest` / `shot-library` / `reference-registry` / `prompt-doctrine` | 整级不可用 |
| 增强资产**损坏** | 新 3 件 JSON 或 `prompts/tasks` 存在但非法 | 整级不可用 |
| 增强资产**缺失** | 文件/目录不存在 | 可用 + `kit.assetWarnings` 记一条 |
| 严格模式 `requireAssets: true` | 增强资产缺失 | 整级不可用 → 触发回退链降级 |

**设计理由**：fail-closed 的真正含义是「**绝不用半份损坏的数据**」，而不是「任何文件不在就全盘拒绝」。
一份旧版 kit 缺了新资产，是正常的升级态——让它整级瘫痪会连带废掉用户已有的 153 镜语料。
但缺失必须**可见**（`assetWarnings`），不能静默。

严格模式给导入校验用：`loadFilmKitChain({ requireAssets: true })` 在缺失时会回退到 asar 内置包，
所以老用户升级后实际拿到的是随包的新资产。

### 4.3 时长推算与来源优先级链

```
                    ┌─────────────┐
                    │  Shot 输入  │
                    └──────┬──────┘
                           ▼
        ┌──────────────────────────────────┐
        │ 1. userDurationMs 有且为正数？    │──是──→ user（最终权威，超限截断+警告）
        └──────────────┬───────────────────┘
                       │否（有值但非法 → 记警告后继续）
                       ▼
        ┌──────────────────────────────────┐
        │ 2. ttsDurationMs 有且为正数？     │──是──→ tts（实测物理事实）
        └──────────────┬───────────────────┘
                       │否
                       ▼
        ┌──────────────────────────────────┐
        │ 3. 有台词（dialogue/text）？      │──是──→ formula（按字数+情绪推算）
        └──────────────┬───────────────────┘
                       │否
                       ▼
                    tier（defaultSec 兜底，必有一值）
```

推算公式（`formula`）：

```
中文字数 / 语速(字/秒)  +  英文词数 / 语速(词/秒)  =  原始秒数
      ↑                          ↑
  常规 8 / 争吵 10 / 深情 5     常规 2.6 / 争吵 3.4 / 深情 1.7

原始秒数 ──向上吸附──→ supportedSec ∈ [5, 8, 10, 12]
```

**为什么中英分别折算**：用单一语速乘总单位数，会系统性低估英文（词比字长）并高估中文。

**为什么只向上不向下**：向下吸附会切掉台词尾部——宁可多给一秒，不可少给半句。

**为什么括号内不计**：`（转身看向窗外）` 是舞台提示，不占说话时长；计入会虚增时长。

### 4.4 自动模式下的接入方式（`auto-plan.js`）

自动模式下没有 TTS 实测，故每镜走 `formula`（按本镜文案推算）→ `tier`（`o.seconds` 兜底）。

**纯增量原则**：

| 字段 | 语义 | 是否改变 |
|------|------|---------|
| `shot.seconds` | 全局档位（原有） | **不变** |
| `plannedDurationSec` | 镜数 × 档位（原有） | **不变** |
| `shot.durationMs` | 逐镜推算毫秒（新增） | 新增 |
| `shot.durationSec` | 逐镜推算秒（新增） | 新增 |
| `shot.durationSource` | 该镜时长来源（新增） | 新增 |
| `estimatedDurationSec` | 逐镜 durationMs 之和（新增） | 新增 |
| `durationSourceCount` | 各来源镜数分布（新增） | 新增 |

**为什么保留两套时长**：`seconds` 是用户输入的档位意图，`durationMs` 是按台词的物理估计。
两者都有信息量，且现有 5 个消费方只读 `seconds`——替换它会造出一次不必要的破坏性变更。

---

## 五、交互逻辑

### 5.1 何时触发（当前批次）

本批次的四份资产是**数据层**，不新增 UI 交互。触发点如下：

| 触发点 | 行为 |
|--------|------|
| 应用启动 / 进入影视工程 | `loadFilmKitChain` 加载 kit；增强资产缺失时把 `assetWarnings` 暴露到诊断入口 |
| 自动模式规划（`planAutoShots`） | 每镜派生时长字段；差异 > 20% 时追加 W8 警告 |
| 用户重新导入 kit | 应使用 `requireAssets: true` 路径（本批次已提供能力，导入 IPC 的接线属批次二） |
| 手动查阅方法论 | `prompt-doctrine.zh.md` + 新增四份资产的 `zh` 字段 |

### 5.2 W8 警告的触发条件与文案

**触发条件**：`|estimatedDurationSec - plannedDurationSec| / plannedDurationSec > 0.2`

**提示文字（中文，直接面向用户）**：

> 按台词推算总时长 {estimated} 秒，与档位基线 {planned} 秒相差超过 20%（推算 {n1} 镜 / 档位 {n2} 镜）。
> 最终以 TTS 实测为准；若差异过大请调整单镜秒数或拆分长台词镜头。

**为什么是 20%**：低于 20% 的差异在成片里感知不到，报警会变成噪音；超过 20% 说明剧本的长短句分布
与用户选的档位已经错配，需要用户自己决定是改档位还是拆台词。

### 5.3 失败时的用户可见形态

| 场景 | 用户看到 |
|------|---------|
| 核心资产损坏 | `FILM_KIT_UNAVAILABLE: 所有 kit 级均不可用 — [userData-full] 损坏: …`（沿用既有文案） |
| 增强资产缺失（非严格） | 影视工程可用；诊断面板出现「旧版 kit，缺 {文件名}，请重新导入以启用」 |
| 增强资产损坏 | `FILM_KIT_UNAVAILABLE` + 点名具体文件与校验失败原因 |
| 提示词库缺语种/文件 | `prompts/tasks: PROMPT_LIBRARY_UNAVAILABLE: <task>/<locale>/<file>: 缺失或不可读` |
| 单镜时长被截断 | `用户设定时长 30.00s 超过单镜上限 12s，已截到上限（请改用拆镜而不是压缩时长）` |
| 单镜时长低于下限 | `用户设定时长 0.10s 低于下限 1s，已抬到下限` |
| 推算超上限 | `推算时长 16.0s 超过单镜上限 12s，必须按 long_dialogue_split 拆解台词，不得截断` |
| 无台词 | `无台词：按最小档处理，建议由画面动作决定时长` |

---

## 六、显示项（新增字段的展示建议）

本批次只**提供数据**，不强制改 UI。以下为下游可直接消费的展示项：

### 6.1 分镜表（建议新增列）

| 列 | 数据源 | 展示形态 | 说明 |
|----|--------|---------|------|
| 时长 | `shot.durationSec` | `5s` / `10s` | 悬停显示来源：`按台词推算` / `TTS 实测` / `用户设定` / `档位默认` |
| 时长来源标记 | `shot.durationSource` | 小徽章：推 / TTS / 用户 / 档 | 让用户一眼看出哪些镜是「猜的」 |
| 段落 | `shot.beatIndex` | `#3` | 已有字段 |

### 6.2 规划确认卡（建议新增两行）

| 行 | 数据源 | 文案 |
|----|--------|------|
| 档位基线时长 | `plannedDurationSec` | `按时长档位：约 {n} 秒` |
| 台词推算时长 | `estimatedDurationSec` | `按台词推算：约 {n} 秒`（差值 >20% 时高亮 + W8 文案） |

### 6.3 方法论标签页（建议新增分区）

| 分区 | 数据源 | 展示 |
|------|--------|------|
| 提示词块 | `doctrine.blocks` | 由 7 块增至 11 块（4 个新块归入「进阶」分组） |
| 失败模式台账 | `doctrine.failureLedger` | 可搜索表格：症状 / 原因 / 修法 / 标签 |
| 配方 | `doctrine.recipes` | 两档切换：完整版 / 首行精华版 |
| 镜头语言 | `shotGrammar.*` | 六组枚举，中英对照 + 风险标记 |
| 合规清单 | `compliance.items` | 12 条勾选表，blocker 项未勾选时禁用「开始生成」 |
| 色盘 | `palette` | 色块 + hex + 角色说明 + 注入串预览（可复制） |

### 6.4 诊断面板（建议新增）

| 显示项 | 数据源 |
|--------|--------|
| kit 来源 | `kit.source`（`userData-full` / `asar-bundled`） |
| 资产告警 | `kit.assetWarnings`（逐条列出缺失的增强资产） |
| 提示词库任务数 | `kit.promptLibrary.taskNames.length` |
| 枚举规模 | `shotSizes/cameraMoves/…` 各组长度 |

---

## 七、提示文字（可直接使用的文案表）

### 7.1 资产缺失告警

| key | 中文文案 | 英文文案（建议） |
|-----|---------|-----------------|
| `shot-grammar.json` | 镜头语言枚举缺失：景别/运镜/机位不可选，仅能手填。请重新导入影视工程资产以启用。 | Shot grammar missing: shot size / camera move / angle unavailable. Re-import the film kit to enable. |
| `compliance-checklist.json` | 剧本合规清单缺失：生成前无法做合规检查。请重新导入影视工程资产。 | Compliance checklist missing: pre-generation checks unavailable. Re-import the film kit. |
| `palette.json` | 剧组色盘缺失：跨集色彩一致性无法保证。请重新导入影视工程资产。 | Palette missing: cross-episode color consistency cannot be guaranteed. Re-import the film kit. |
| `prompts/tasks` | 任务化提示词库缺失：只能使用内置提示词模板。请重新导入影视工程资产。 | Task prompt library missing: only built-in templates are available. Re-import the film kit. |

### 7.2 校验失败提示（面向导入流程）

| 场景 | 文案 |
|------|------|
| 缺语种 | `提示词库不完整：{task} 缺少 {locale} 语种（中英必须成对）。` |
| 缺文件 | `提示词库不完整：{task}/{locale} 缺少 {file}。` |
| 空文件 | `提示词库不完整：{task}/{locale}/{file} 内容为空。` |
| 超限 | `提示词库不完整：{task}/{locale}/{file} 超过 64KB 上限。` |
| 色盘超限 | `色盘失控：主色 {n} 个，超过上限 4 个。色盘最多 4 主色 + 2 扩展色。` |
| 色盘漏色 | `色盘注入串缺少主色 {hex}：机械注入会漏色，跨集一致性无法保证。` |
| 台账半张 | `失败模式台账不完整：{id} 缺少 {field}。要么完整维护，要么整块省略。` |
| 配方悬空 | `配方 {key} 引用了不存在的提示词块 {block}。` |
| 合规缺修法 | `合规清单 {id} 缺少修法（{field} 为空）：只报问题不给修法等于没清单。` |

### 7.3 时长相关提示

见 §5.2 与 §5.3。

---

## 八、验收标准

| # | 标准 | 证据 |
|---|------|------|
| 1 | 四份新资产随包分发 | QM-1：asar 清单含 16 个 prompt `.md` + 3 个新 JSON，film-kit 共 52 条目 |
| 2 | 应用可启动且无 stderr | QM-1：窗口期存活断言通过，stderr 0 字节 |
| 3 | 既有影视工程测试零回归 | 29 个测试文件 456 例全绿（含既有 407 例） |
| 4 | 新代码有契约测试 | `prompt-library.test.js` 28 例 + `shot-duration.test.js` 37 例 |
| 5 | 新校验器有失败路径测试 | `kit-loader.test.js` 51 例（含缺失/损坏/严格模式/回退链） |
| 6 | 时长字段为纯增量 | `auto-plan.test.js` 断言 `seconds` 与 `plannedDurationSec` 不变 |
| 7 | 打包 rc=0 | electron-builder `--win --x64` exit 0 |
| 8 | 文档与代码同源 | `SCHEMA.md` 描述与 `validate*` 实现逐项对齐 |

---

## 九、风险与已知限制

| 风险 | 说明 | 缓解 |
|------|------|------|
| 老用户 kit 无新资产 | 升级后 `assetWarnings` 有 4 条 | 严格模式回退到 asar 内置包；诊断面板可见 |
| 公式时长是估计 | 未接 TTS 时 `formula` 只是最佳猜测 | 优先级链保证 TTS 一旦可用立即覆盖；W8 暴露偏差 |
| 自动模式按「分镜文案」而非「纯台词」推算 | 分镜文案可能含动作描述，会略微高估 | 文档明确；用户可用 `userDurationMs` 覆盖 |
| `prompts/tasks` 正文不参与 CI 语言检查 | 只在加载期校验非空与成对 | 后续可加 CI Gate 7 的 tasks 扩展（非本批次） |
| 新增 4 个方法论块未接入 UI | 方法论标签页目前仍按 7 块渲染 | 属批次二的 UI 接线；数据已就绪 |

---

## 十、后续（批次二起）

| 优先级 | 项 | 依赖本批次 |
|--------|-----|-----------|
| 1 | **F8 提示词三分**（`imagePrompt`/`videoPrompt`/`endFramePrompt`） | ✅ 本批次已提供 `generate_shot_prompt` 的 system/user 与 `frame_constraint` 规则 |
| 2 | F15 身份锚点强制校验 | ✅ glossary `identity anchor` 与 FL-01 已定义约定 |
| 3 | 导入 IPC 接 `requireAssets: true` | ✅ 能力已提供 |
| 4 | F1 的方法论 UI 分区（11 块 + 台账 + 配方） | ✅ 数据已就绪 |
| 5 | F30 的任务级提示词接入规划流程 | ✅ 库与渲染器已就绪 |
| 6 | F34 接通 TTS 实测（`ttsDurationMs`） | ✅ 优先级链已就绪，只需填值 |


---

## 十一、对抗性审查驱动的修订（v7.1，2026-10-20）

本节记录 CCG 双模型对抗审查（critic=claude × proposer=opencode）发现的 8 条问题与处置。
**这些修订改变了 §四、§五 里的若干口径，以本节为准。**

### 11.1 时长推算口径的修正

| 项 | 原口径（§4.3） | 修正后 |
|----|---------------|--------|
| 计时的文本 | 整段 `beat.text` 当台词 | **引号优先**：按 `「」『』“”""` 抽取真正会被念出的内容；无引号时退化为整段并标记 `usedQuotes=false`（宁可高估不可低估） |
| 吸附规则 | 纯向上吸附 | 向上吸附 + **容差 0.3s**：`raw` 只超出档位不到容差时仍取该档，消除「40 字→5s、41 字→8s（+60%）」的一字之差跳三秒 |
| 落差可见性 | 只返回档位 | 同时返回 `rawSec` 与 `snapDeltaSec`，`shots[]` 增加 `durationRawSec` |
| 字符集 | 中日韩统一表意（含假名/谚文）按字 | **只认汉字**（`\u4e00-\u9fff`）；假名/谚文单独计数并告警「日韩文案时长会被低估，请手工设定」 |
| 档位上限 | 字面量 `12`，注释称与 kit 同源 | 从档位推导 `Math.max(...AUTO_SHOT_SECONDS)`（=10）；需要更宽档位用 `planAutoShots({ durationTiers })` 注入，**不要改常量**（改它会让 `validateAutoInputs` 接受的输入域与实际能力脱节） |

### 11.2 新增 W9 告警（时长溢出/截断）

**触发条件**（只覆盖两类实质事件，良性提示不报，避免恒真告警退化为噪音）：

| 类别 | 判据 | 含义 |
|------|------|------|
| overflow | `durationRawSec > durationMaxSec` | 台词量超过最高档，不拆解就会丢字 |
| truncation | `durationRawSec * 1000 > durationMs + 1` | 容差吸附把档位压到内容长度以下，尾部可能被切 |

**提示文字（中文）**：

> 有 {n} 个分镜的实际台词长度超出其档位时长；其中 {a} 镜推算时长超过单镜上限 {max} 秒（#1, #3），必须按 long_dialogue_split 拆解台词，不得截断；{b} 镜因容差吸附到了略短的档位（#5），台词尾部可能被切，建议复核或改大单镜秒数。逐镜明细见 shots[].durationWarnings。

**不触发的情形**：无台词、推算低于最小档、含假名/谚文——这些留在 `shots[].durationWarnings` 里，不进 W9。

### 11.3 资产版本号真正生效

新增 `checkSchemaVersion(obj, label, allowed, opts)`：

| 资产 | 要求 |
|------|------|
| `shot-grammar.json` | 必须为 `1` |
| `compliance-checklist.json` | 必须为 `1` |
| `palette.json` | 必须为 `1` |
| `prompt-doctrine.json` | **允许缺失**（历史文件按 v1 兼容）；声明后必须 ∈ `[1, 2]` |
| `film-manifest.json` | 必须为 `1`（原有校验，未变） |

**错误文案**（刻意指向正确的处置方式）：

> `{file}.schemaVersion={n} 不受支持（本版本支持 {list}）：这通常意味着资产由更新/更旧的应用版本产出，请重新导入配套资产，不要手工改版本号

### 11.4 路径穿越防护补齐符号链接

`resolveInside(root, target, { resolveSymlinks: true })`：

1. 先做词法包含性检查（挡 `..` 与绝对路径）；
2. 再做 `fs.realpathSync`，用**真实路径**二次断言；
3. 真实路径解析失败（悬空链接、无权限）→ **fail-closed 报错，不猜**。

`readPromptFile` 生产路径已启用该选项。原实现的注释宣称「越界符号链接一律拒绝」但未实现——本次补的是实现，不是改小注释。

### 11.5 选择器/校验器的第三态清理

`readOptionalJsonFile` 原对「文件存在、JSON 合法、内容为字面 `null`」判为缺失静默放行（既不算缺失也不报损坏）。现按**损坏**处理：

> `{file} 内容为空值（JSON 为 null）：文件存在但不是有效对象`

### 11.6 本次审查的元数据

| 项 | 值 |
|----|-----|
| 引擎 | `adversarial-review-loop`（`scripts/deep-review.sh`） |
| 后端 | critic=`claude`，proposer=`opencode`（跨家族校验通过） |
| 第一轮 | **失败**——单提交 4058 行 diff 导致 critic 输出被截断（18857 字符），RC=2。处置：不重跑、不降标准，按体积拆成三次 scoped 提交 |
| 第二轮 | 成功：8 条问题 / 4 维度 / 最低分 6；引擎走第三档「自扮演裁决」 |
| 裁决结果 | 6 条争议全部 `upheld` 并已修复；i5 有半条被判 `dismissedPart`（模型档位最小 5s 是客观边界，非实现选择） |
| 产物 | `.adversarial/ccg-deep-01258c7a/`（critique / proposal / adjudication） |
| 测试面变化 | film 相关 456 → **486** 例全绿 |

---

## 十二、第二轮对抗审查（只对修复本身）

第一轮 8 条修完后，用同一套流程**对修复提交再跑一轮**（572 行）。结果又 8 条，其中 4 条是修复时新引入或未修透的——这正是「修完再验一轮」的价值。

### 12.1 对 §四/§五 口径的再次修订

| 项 | §十一 口径 | 第二轮修订后 |
|----|-----------|-------------|
| W9 计数 | `overflow + truncated` 直接相加 | 两组**互斥**（截断判据加 `rawSec <= maxSec` 前置），相加即独立镜数 |
| 自动模式计时 | 无引号时退化为整段按语速折算 | **无引号就不算有台词** → 退 `tier` 档位兜底 + 可操作提示「若含台词请用「」标注」 |
| 缺省档位 | `AUTO_SHOT_SECONDS`（`[5,8,10]`）兼当档位表 | 复用 `shot-duration` 的 `DEFAULT_TIERS`（`[5,8,10,12]`）；`AUTO_SHOT_SECONDS` 回归**纯输入白名单**用途。资产的 12s 档因此真正可达 |
| 语速配置 | 文档称 `emotionTiers.zhCharsPerSecond` 「直接驱动」 | 补注入路径（`zhCharsPerSecond` / `enWordsPerSecond`）并改为如实表述：**不注入就不生效** |
| `shot-grammar` 语义字段 | 只校验 key/zh/en 非空 | `risk` / `chain` / `emotion` 做**闭集校验**（拼错 `hihg` 会被拒——否则「high 必须试镜」被拼写错误架空） |
| `prompts/tasks` 空目录 | 存在但为空 → 整级不可用 | 非严格模式与「缺失」同处置（记 `assetWarnings`）；严格模式仍拦 |

### 12.2 关于容差台阶的公开取舍

容差 0.3s **没有消除**跳变悬崖，只把它挪到 5.3s（`5.3000 → 5s`、`5.3001 → 8s`）。

**不消除的理由**：「按到各档距离取最近档」会引入**向下取档**，从而可能截断台词尾部——用可感知的 3 秒跳变换「绝不丢字」，是刻意的取舍。

**补偿**：`rawSec` 与 `snapDeltaSec` 如实回传，`shots[]` 带 `durationRawSec`；要连续量的调用方用 `rawSec` 而不是 `durationSec`。测试**直接断言这个边界存在**，不回避。

### 12.3 收敛与不收敛

- **收敛判据**：本轮全部发现已修 + 有回归锁 + 506 例测试全绿 → 不再起第三轮（否则无限回归：每轮都会对上一轮的修复提新意见）。
- **不假装闭合的剩余风险**：容差台阶仍在；假名/谚文不计入语速；自动模式的台词/动作分离依赖引号标注（无引号剧本仍需人工复核 W9 与 `durationRawSec`）。

### 12.4 第二轮元数据

| 项 | 值 |
|----|-----|
| 后端 / 基线 | critic=`claude` × proposer=`opencode`；`origin/main`（5119 行） |
| 产出 | 8 条（4 Warning + 4 Info），4 维度，最低分 6 |
| 裁决 | 4 条争议全部 `upheld`，4 条 Info 一并修 |
| 产物 | `.adversarial/ccg-deep-f1734902/` |
| 测试面 | film 相关 486 → **506** 例全绿 |
