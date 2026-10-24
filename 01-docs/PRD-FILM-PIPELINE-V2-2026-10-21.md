# PRD — 影视工程流水线 v2（提示词三分 / 生成就绪度 / 单镜锁定 / 出站安全 / 身份锚点）

> **文档编号**：PRD-FILM-PIPELINE-V2-2026-10-21
> **分支**：`film-pipeline-prompt-triple-and-guards` ｜ **依据**：`01-docs/RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md`（19 个 AI 影视开源项目调研）§4.2 梯队 + §5.2 批次二/三
> **前序**：`01-docs/PRD-FILM-PROMPT-ASSETS-2026-10-20.md`（批次一，PR #4052）
> **OpenSpec**：`openspec/changes/film-pipeline-prompt-triple-and-guards/`
> **状态**：方案已定稿（CCG 决策层评审中），实现按 PR-1 ~ PR-5 分批落地
> **分层判定**：混合 PR（改 `apps/desktop/electron/` 运行时代码）→ 走完整质量节拍，隔离 worktree 实施

---

## 一、为什么要做（问题陈述）

批次一（2026-10-20 落地）把**提示词资产层**补齐了：镜头语法枚举、剧本合规清单、剧组色盘、任务级提示词库、方法论扩容、单镜时长来源链。

**但资产层只是"弹药"，流水线本身仍有 8 处实测确认的缺口**。本 PRD 只处理其中落在「自动」标签与「提示词优化」阶段的那几处。

| # | 缺口 | 实测证据 | 用户能感知到的后果 |
|---|------|---------|------------------|
| G-1 | 分镜提示词一段到底 | `shot-library.json:5` 只有单一 `prompt`；`kit-loader.js:121` 校验该字段 ≤50000；全目录 grep `imagePrompt\|videoPrompt\|endFramePrompt` **零命中** | 单镜提示词最长 **13,922 字符**。模型注意力衰减 → **画面"看着对却不对味"，重试也没用**。用户只能自己删提示词试错 |
| G-2 | 成本闸是全批次级，无逐镜就绪度 | `video-gen.js:279-307`；`costCheck.shots[]` 仅 `{index, shotId, title, aspect, seconds}`（`:297-303`） | 有一镜提示词是空的/参考图坏了，**用户先勾选确认、然后等生成失败**才知道。白等一轮，还可能白扣一次费 |
| G-3 | 成片下载出站完全裸奔 | `video-gen.js:116-145 downloadToFile`：**允许 http**、3xx **无限递归跟随**、**无私网段拦截**、**无 DNS 校验**、**无大小上限**、**直接写目标文件** | 恶意/异常 provider 返回内网地址会**打穿本机网络**；下载中断会**留下半成品 mp4 被当成品** |
| G-4 | 缺 ffmpeg 到合成期才暴露 | `film-render.js:278-279` `findFfmpeg()` 失败 → 到合成阶段才返回「FFmpeg 不可用，无法合成成片」 | 用户跑完 8 镜才发现环境缺件，**全部白跑** |
| G-5 | 重跑覆盖人工精修过的镜 | `auto-project.js:295` patch 白名单仅 `prompt/refPaths/seconds/title`；全目录无 `locked` | 手动调好的那一镜，**下次批量重跑被冲回默认值** |
| G-6 | 并发写无版本保护 | `auto-project.js:246-259 writeProject` 直接覆盖；`auto-plan-fingerprint.js` 是**审计指纹**不是锁 | 两个窗口同时改同一任务，**后写的把先写的抹掉**，且无提示 |
| G-7 | 提示词优化阶段无身份锚点 | `story2video-stages.js:1747-1798` 只有 `negativeAnchors`/`characters` 文本锚点；story2video 主管线**不传参考图** | **角色跨镜漂移、多人同框串脸**——业界唯一没解决的连续性难题（报告 §3.21 武器 2） |
| G-8 | 逐镜时长断在项目文件 | `auto-project.js:209-221` 的 shot 结构**不落** `durationMs`/`durationSource` | 规划阶段算好的台词时长，**续跑/重生成时丢失**，回落全局固定秒数 |

---

## 二、目标与非目标

### 2.1 目标

1. **提示词按用途分离**：首帧图 / 视频运动 / 尾帧约束三份，各有职责；**存量 153 条分镜零迁移**。
2. **生成前就能看出哪一镜不行**：成本闸内联逐镜就绪度，不新增第二道闸。
3. **人工精修结果受保护**：`locked` 镜不被批量重跑覆盖，但单镜重生成仍可用。
4. **并发写有版本保护**：`expectedRevision` 乐观锁，冲突 fail-closed。
5. **出站下载有合同**：复用本仓既有原片下载合同 + 补 IP pinning。
6. **环境缺件提前说**：出片前体检 ffmpeg/ffprobe。
7. **角色跨镜不漂**：提示词优化阶段注入角色身份锚点与参考图优先级。

### 2.2 非目标（明确不做）

- ❌ 不做 VLM 质检闭环（本仓无视觉适配器，自动重试会绕过被测试锁死的成本闸）。
- ❌ 不做 Scene 视角变体 `viewpointId`（**无消费方 = 死代码**）。
- ❌ 不做剪映草稿导出（需前置 spike）。
- ❌ 不做音频三件套（需 `tpad`/`loudnorm`，打包滤镜白名单仅 11 个）。
- ❌ 不做场次并发 / 跨集 Series Bible / 组级多镜头提示词 / 时长双向归一 / 分片渲染 / checkpoint。
- ❌ 不动 `packages/python-backend/`。
- ❌ 不动「画布」「快速渲染」「历史记录」标签。

---

## 三、数据模型

### 3.1 Shot 三分提示词

| 字段 | 类型 | 必填 | 默认 | 语义 | 长度上限 |
|------|------|------|------|------|---------|
| `prompt` | string | 是（存量） | — | **保留不动**。存量分镜的原始提示词 | 50000（既有 `FILM_PROMPT_MAX_LEN`） |
| `imagePrompt` | string | 否 | `??= prompt` | **首帧图**提示词：静态画面描述（主体/场景/光线/构图/风格） | 单字段 50000 |
| `videoPrompt` | string | 否 | `??= ''`（**空**，不回落 prompt） | **视频运动**提示词：只保留「运镜 + 主体 + 时长内的变化」，**不含**静态画面全量。**实测**（153 个真实模板，beat=3 行剧本段落）：首帧图提示词平均 **349** 字符、运动子集平均 **72** 字符，聚合比 **0.207**（beat 越短比值越低：单行 7 字符 beat 实测 **0.146**）。其中 **124 个模板没有任何可剔除的静态块**，此时运动子集与首帧图**逐字相同**——属正常态，不是缺陷 | 单字段 50000 |
| `endFramePrompt` | string | 否 | `??= ''` | **尾帧约束**：末帧应当是什么（衔接下一镜的起点） | 单字段 50000 |

**没有「三分合计上限」**：早期草案曾设 FILM_PROMPT_BUNDLE_MAX_LEN = 50000，但它与单字段上限同值 ⇒ 三段各自顶格的**合法**资产会被误判死；且三段各自已被单字段上限约束，合计上限**永不触发**，是装饰性判据。**已删除**（验证层评审 i4）。

真正起作用的护栏是**字段类型与长度校验**：三分字段存在即必须是字符串、且各自不超 FILM_PROMPT_MAX_LEN = 50000。
> 为什么保留 `prompt` 字段：它是既有消费方（分镜库 UI、剧本套用）的读取面，删掉会让存量分镜库整片失读。归一化消掉的是**分支**（`?? prompt`），不是字段。
>
> **就绪度判定的分层**（防"纯函数却要读文件"的自相矛盾）：**IO 探测层**（调用侧）先产出事实入参 `facts`——参考图可解析性、provider 画幅/秒数能力**在调用侧读文件与能力表后填入**；`shot-readiness.js` **只对 `facts` 做纯函数判决**（零 IO、可单测）。入参形状：`{ shotId, index, prompt, durationMs, aspect, seconds, locked, facts: { referenceResolvable, aspectSupported, secondsSupported } }`。
>
> **存量与新分镜的区别（重要，不要误读）**：
> - **自动模式新规划的分镜**：`videoPrompt` 是**重算**出来的（显著短于 `imagePrompt`），这才是本字段的主战场。
> - **存量 153 条分镜**：`videoPrompt` 归一化为空串，视频请求回落到 `imagePrompt`，**行为与本次变更前逐字一致**。实测块标记分布：`AUDIO` 命中 **62** 条（其中 **29** 条真正成块、可被运动子集剔除），`GEO SPATIAL LAYOUT` / `ACTION TIMING` / `CHARACTER ACTING` / `POSITIVE CONSTRAINTS` 在存量 kit 中命中 **0** 条 ⇒ **124** 条模板的运动子集与首帧图逐字相同。
> - **既有拼装的已知缺口（本次不修）**：`shot[0].prompt` 原文 13,922 字符，但**改造前既有**的 `buildTemplatePrompt` 只取五类块标记内容，散文正文（角色外观描述等）本就不在拼装结果里 —— 与本次变更无关（本次对首帧图拼装**逐字不变**）；治理路径（一次性 LLM 重算 + 人工审核）列为后续项，**不阻塞本批次**。

#### 3.1b 方法论接线字段（PR-3 · F-I）

规划期把「方法论资产」接到每镜上，字段分**三级**落点 —— **长文本一律不落用户项目文件**（design D22）。

| 字段 | 落点 | 类型 | 语义 |
|------|------|------|------|
| `promptContext.taskId` | plan 级（项目文件 + 计划文件） | string | 任务模板 id（`generate_shot_prompt`） |
| `promptContext.locale` | plan 级 | string | 渲染语种（`zh` / `en`） |
| `promptContext.promptAssetHash` | plan 级 | string（sha256 64 hex） | **提示词资产面**哈希：doctrine + 任务 system/user 原文 + locale + 回退事实。**域有边界**：**不含**色盘行 / 角色描述 / 逐镜时长与模型（那些由逐镜 `promptRenderHash` 覆盖）⇒ 「换色盘 ⇒ 提示词资产哈希变」是**假命题** |
| `promptContext.frameConstraint` | plan 级 | object | 尾帧约束**只留哈希与长度**：`{ hash, length, locale, fallback, truncated, source, originalHash, originalLength }`；**不含原文**。`hash`/`length` 取**截断后**文本（上限 50000），`originalHash`/`originalLength` 取**截断前**原文（否则截断点之后的改动不可见） |
| `promptContext.frameConstraintPending` | plan 级 | boolean | 本批次**不逐镜派生**尾帧文本（要 LLM）⇒ 规则已接入、逐镜待派生 |
| `promptContext.fallbackLocales` | plan 级 | object | **按来源分组**的回退事实：`{ doctrine: {}, palette: {}, task: {} }` |
| `promptContext.assetsIncomplete` | plan 级 | boolean | **只覆盖 kit 结构性缺失**（缺 doctrine / 缺 promptLibrary）；`style_prefix` 与 `geo_block` 走 `blockedVars`（计入它会恒为 true，且重导资产也解决不了） |
| `promptContext.taskAvailable` | plan 级 | boolean | 任务模板库是否真的接上了（缺库时 taskId 仍在，但没有可渲染的原文） |
| `shot.promptVars` | 逐镜（项目文件） | object（string→string） | 该镜的 7 个任务变量**已填**的值（不含长文本） |
| `shot.promptMissing` | 逐镜（项目文件） | array | 缺失清单：`{ name, reason }`，reason ∈ `byDesign` / `assetMissing` / `templateVar` / `badVarName` |
| `shot.promptRenderHash` | 逐镜（项目文件） | string（sha256 64 hex） | **渲染面**哈希：固定键序的该镜 vars + locale ⇒ 同镜同资产 ⇒ 渲染**逐字相同** |
| `shot.endFramePrompt` | 逐镜（项目文件） | string | **本批次仍为 `''`**（逐镜尾帧文本要 LLM 派生）⇒ 留空即「不发送」，不会把规则原文当正文喂给模型 |
| `methodology`（规划结果） | **仅 IPC 返回值，不落盘** | object | 只读面板的数据源：`{ taskId, locale, promptAssetHash, totalVars, hitVars, deliverable, blockedVars, assetsIncomplete, frameConstraintPending, frameConstraintHash }` |

**为什么不落方法论原文**：`system` 原文已被判定「属提示词资产，导出面需单独权限评审」；同理，尾帧约束原文落进**用户项目文件**也多出一条外发/日志面（项目文件会随分享、日志、备份流出去）。原文本来就在用户**本地的 kit** 里，需要时按 kit 读 ⇒ 用户项目文件里**不含任何方法论原文**。

### 3.2 Project 修订号

| 字段 | 类型 | 语义 |
|------|------|------|
| `revision` | integer ≥ 0 | 项目文件每次写入 +1 |
| （入参）`expectedRevision` | integer，可选 | 调用方读到的修订号；缺省 ⇒ **不比对**（向后兼容） |

### 3.3 就绪度（内联在既有 `costCheck`）

```jsonc
costCheck: {
  totalShots, maxBatch, aspect, seconds, providerId, model,
  references: { /* 既有，不动 */ },
  readiness: {
    readyCount: 7,
    notReadyCount: 1,
    shots: [
      { "index": 0, "shotId": "S001", "ready": true,  "reason": null, "reasonCode": null },
      { "index": 1, "shotId": "S002", "ready": false,
        "reason": "本镜提示词为空，请补写或删除该镜",
        "reasonCode": "SHOT_PROMPT_EMPTY" }
    ]
  }
}
```

### 3.4 角色身份锚点

```jsonc
{
  "characterAnchors": [
    { "name": "老张", "bone": "方脸 · 下颌宽", "features": "单眼皮 · 鹰钩鼻 · 厚唇",
      "hair": "花白短发 · 深褐瞳", "lip": "暗红唇" }
  ],
  "anchorTruncated": false,          // 被截断时为 true
  "anchorTruncatedNames": ["王五"],   // 被截断的角色名
  "referencePriority": [
    { "index": 0, "role": "identity", "note": "身份锚" },
    { "index": 1, "role": "environment", "note": "仅场景/光线/构图/情绪" }
  ]
}
```

**硬上限 4 条**（提示词越长模型越容易丢约束）。超限时取前 4 条并显式回传 `anchorTruncated` + 被截角色名。

---

## 四、数据校验（逐条）

### 4.1 规划期（`auto-plan`）

| 校验项 | 判据 | 失败形态 |
|--------|------|---------|
| 剧本非空 | `trim()` 后长度 ≥ 1 | `AUTO_SCRIPT_EMPTY` |
| 剧本长度 | ≤ 10000 字 | `AUTO_SCRIPT_TOO_LONG` |
| 参考图数量 | 人物 ≤ 8、场景 ≤ 8 | `AUTO_REFS_TOO_MANY` |
| 参考图单张 | ≤ 10MB | `AUTO_REF_TOO_LARGE` |
| 参考图格式 | PNG/JPEG/WEBP（**主进程以魔数嗅探为准**） | `AUTO_REF_BAD_TYPE` |
| 画面方向 | `16x9` \| `9x16` | `AUTO_BAD_PARAM` |
| 目标时长 | 10–600 整数秒 | `AUTO_BAD_PARAM` |
| 单镜秒数 | `5` \| `8` \| `10`（默认 5） | `AUTO_BAD_PARAM` |

> **本次新增**：派生三分后，若 `imagePrompt` 为空 ⇒ 该镜 `ready=false`（不阻断规划，规划本身仍出预览）。

#### 4.1b 方法论接线的校验（PR-3 · F-I）

| # | 校验点 | 判据 | 失败时 |
|---|--------|------|--------|
| V-M1 | 变量名合规 | 提供的变量名必须匹配 `^[a-z][a-z0-9_]*$` | 计入 `promptMissing`（reason=`badVarName`）⇒ `deliverable=false` |
| V-M2 | 模板要但没给的变量 | `renderTemplate` 返回的 `missing` | 计入 `promptMissing`（reason=`templateVar`）⇒ `deliverable=false` |
| V-M3 | 空串语义 | **已提供的空串** ⇒ 渲染为空串（不留占位符）；**未提供** ⇒ 保留 `{{var}}` 原样 | 两者分别锁进用例 |
| V-M4 | 尾帧约束长度 | `frameConstraint.length ≤ FILM_PROMPT_MAX_LEN(50000)` | 超长截断并 `truncated=true`（**不放宽**上限）；`originalLength` 记**截断前**长度，`originalHash` 记**截断前**原文的指纹（否则截断点之后的改动**不可见**） |
| V-M5 | 尾帧约束语种 | doctrine 的 `zh`/`en`；缺该语种回退 `zh` | 回退记进 `fallbackLocales.doctrine` |
| V-M6 | 资产缺失可见 | 缺 doctrine ⇒ W10；缺 promptLibrary ⇒ W11 | 规划**仍出结果**，但 `assetsIncomplete=true` 且面板可见 |
| V-M7 | 可直送判据 | `deliverable === true`（`missing` 为空）才允许把渲染文本直送模型 | false ⇒ 消费方**必须**拒绝直送（机器可判字段 + 测试锁死） |
| V-M8 | 确定性 | 同 kit + 同 locale ⇒ `promptAssetHash` 与 `promptRenderHash` 相同 ⇒ 重渲染**逐字相同** | 哈希变了 ⇒ 必须重渲染并**显式记录**，不静默沿用 |
| V-M9 | 碰撞防护 | 哈希拼接用**长度前缀**（`len:key=len:value`） | 杜绝 `a=bc` 与 `ab=c` 碰撞 |
| V-M10 | 体积口径 | 项目文件里**不含**方法论原文（尾帧约束只留哈希与长度） | 用例直接断言「逐镜没有原文副本」 |
| V-M11 | **kit 自由文本长度上限** | `palette_line` / `character_descriptors` 超过 **20,000 字符** ⇒ **不提供该变量** | 进 `promptMissing`（reason=`assetMissing`）⇒ `deliverable=false`；**不静默截断**（截断会把「资产异常」伪装成「资产正常」）。角色描述超限时**整个变量**不提供（部分提供会产出「看着完整、其实缺角色」的提示词） |
| V-M12 | **尾帧约束截断两态** | `frameConstraint.hash`/`length` 取**截断后**文本；`originalHash`/`originalLength` 取**截断前** | 两段「前 50000 字相同、后半不同」的文本：截断后哈希**相同**、`originalHash` **不同** ⇒ 截断点之后的改动**可检测** |
| V-M13 | **哈希域边界** | `promptAssetHash` 覆盖 doctrine / 任务 system / user；**不**覆盖色盘与角色描述 | 后两者由逐镜 `promptRenderHash` 覆盖；旧名 `assetHash` 在实现代码里**零残留** |
| V-M24 | **截断名唯一** | 截断后的名字加 **6 位哈希后缀** | 两个前 63 字相同的长名字截断后**同名** ⇒ 面板按 name+reason 去重会把两条并成一条 |
| V-M23 | **kit 自由文本净化** | `palette_line` / `character_descriptors` 剥除 C0/C1 控制字符与零宽字符（U+200B-200F、U+202A-202E、U+2060-2064、U+FEFF），**净化先于**长度判定 | 控制字符能破坏提示词结构、零宽字符能**藏**内容；长度上限按**净化后**的文本计 |
| V-M14 | **逐镜字段长度上限** | `shot_json` 的 `title` / `characterNames` / `model` 超过 **2,000 字符**（`MAX_SHOT_FIELD_LEN`）；kit 自由文本用 `MAX_KIT_VAR_LEN` = **20,000**（`palette_line` 整行；`character_descriptors` **多角色拼接后的合计**） ⇒ **不提供** `shot_json` | 进 `promptMissing`（reason=`oversizeVar`）⇒ `deliverable=false`；**不静默截断** |
| V-M17 | **超长是独立一类** | 超长的变量 reason = `oversizeVar`（**不是** `assetMissing`） | 「资产**有**，只是太大」与「资产**没有**」是两回事，混在一起会让面板显示错因 |
| V-M18 | **哈希的域分层** | `promptAssetHash` 吃**完整** doctrine（**不截断**）；`frameConstraint.hash`/`length` 吃**截断后**文本；`originalHash` 吃**截断前** | 截断点之后的改动：`promptAssetHash` **变**、`frameConstraint.hash` **不变**、`originalHash` **变** |
| V-M20 | **变量名封顶** | 清单里的变量名 ≤ **64 字符** | 名字来自**不可信**的 kit 模板 ⇒ 不封顶会让 1MB 的变量名进逐镜项目文件 |
| V-M21 | **缺失态进哈希** | 逐镜渲染哈希覆盖**缺失清单**（`name + reason`） | 「变量超限」与「变量没有」**不同哈希**（否则两者都只是「不在 vars 里」⇒ 同哈希） |
| V-M22 | **计数单位** | 长度与截断按 **UTF-16 code unit**（JS `.length` / `.slice` 语义） | 截断**不切开代理对**（回退一个 code unit）—— 跨实现一致 + 不留半个 emoji |
| V-M21 | **缺失态进哈希** | 逐镜渲染哈希覆盖**缺失清单**（`name + reason`） | 「变量超限」与「变量没有」**不同哈希**（否则两者都只是「不在 vars 里」⇒ 同哈希） |
| V-M22 | **计数单位** | 长度与截断按 **UTF-16 code unit**（JS `.length` / `.slice` 语义） | 截断**不切开代理对**（回退一个 code unit）—— 跨实现一致 + 不留半个 emoji |
| V-M19 | **哈希的负向域** | 改色盘 / 角色描述**不改** `promptAssetHash`（不在它的域里），改的是**逐镜** `promptRenderHash` | 光有正向断言时，「把色盘也塞进哈希」这种过度覆盖**不会**被发现 |
| V-M15 | **缺失分类判据** | `byDesign` = **产品里没有这个资产的形态** 或 **本批次不取**；`assetMissing` = **有资产形态、当前取不到** | `style_prefix` = byDesign（doctrine 的 `style` 块是规则描述，示例值不是资产）；`geo_block` = **byDesign**（第 17 轮 i3 改判：跨模板取 GEO 块的**选取规则未定义** ⇒ 本批次**不取** ⇒ 缺的不是资产，是「我们决定不取」） |
| V-M16 | **清单计数只算任务变量**（非任务变量条目 **≤ 8**，**实现里强制**：超出部分不落清单、`deliverable` 仍为 false；单镜 `promptMissing` 序列化 **≤ 8 KiB（按 UTF-8 字节数）** —— 两条**自洽**：总条目 ≤ 15 × (64 字符 × **6 字节**（JSON 转义最坏）+ ~30 B) ≈ 6.2 KB ≤ 8 KB） | 「命中数 + 清单条数 == 7」中的清单条数**只统计 7 个任务变量** | `templateVar` / `badVarName`（模板多要的变量、我们给错的名字）**不在 7 个之内** ⇒ 一并计数会让该断言在模板多要变量时**必然为假** |

**不做的事**：规划期**不调 LLM**（`planAutoShots` 的契约是「零 provider 调用、零落盘」，且成本闸 F-B 在 PR-5 才落地 ⇒ 此刻调 LLM 就是「没有闸的花钱」）。

### 4.2 Kit 加载期（`kit-loader`）

| 校验项 | 判据 | 失败形态 |
|--------|------|---------|
| 三分归一化 | `imagePrompt ??= prompt`；`videoPrompt ??= prompt`；`endFramePrompt ??= ''` | — |
| 单字段长度 | ≤ 50000 | `FILM_KIT_UNAVAILABLE` |
| **三分合计长度** | ≤ 50000 | `FILM_KIT_UNAVAILABLE`（**不截断**） |
| 尾帧格式 | 空串或非空字符串 | `FILM_KIT_UNAVAILABLE` |

### 4.3 生成前

就绪度为**三态**：`ready`（可生成）/ `notReady`（必然失败，**阻止**）/ `skipped`（本次不参与、**不阻止**）。

| 校验项 | 判据 | 就绪度 reasonCode | 状态 |
|--------|------|------------------|------|
| 提示词非空 | `imagePrompt.trim()` 非空 | `SHOT_PROMPT_EMPTY` | `notReady` |
| 参考图可解析 | 声明了参考图的镜能解析出 provider 参数 | `SHOT_REFERENCE_UNRESOLVED` | `notReady` |
| 时长合法 | `0 < durationMs ≤ 单镜上限` | `SHOT_DURATION_OUT_OF_RANGE` | `notReady` |
| 画幅支持 | provider 支持该 aspect | `SHOT_ASPECT_UNSUPPORTED` | `notReady` |
| 秒数支持 | provider 支持该秒数档位 | `SHOT_SECONDS_UNSUPPORTED` | `notReady` |
| 锁镜 | 该镜 `locked` ⇒ 本次批量不参与、**沿用已有产物** | `SHOT_LOCKED` | `skipped`（**不阻止**，且**不计入成本汇总**——预计调用次数与费用只统计 `ready` 的镜） |

### 4.4 出站下载（`egress-guard`）

| 校验项 | 判据 | 失败文案要点 |
|--------|------|------------|
| 协议 | 仅 `https` | 「下载通道仅允许 https 协议」 |
| 端口 | 仅**可信清单声明的端口**（`assetDownloadPorts`，缺省 `{443}`；省略端口按 443） | 「下载通道仅允许 {ports} 端口」 |
| 主机名 | 非空 | 「URL 缺少主机名」 |
| **可信主机**（缺省 fail-closed） | 可信集合 = { provider **API base URL 主机（自动派生）** } ∪ { `assetDownloadHosts`（运营可配） }；不在集合内且**未显式授权** ⇒ 拒绝 | 「素材域名 {host} 不在可信清单内。请在『模型提供商 → {provider}』中配置『素材下载可信域』，或本次显式允许外部素材域名。」 |
| 显式授权 | 只能来自用户在成本确认卡勾选「本次允许从外部素材域名下载」；产生**运行期一次性令牌**（**不落盘**，任务结束失效）；审计只记「发生过授权」的事实，**不存放行位** | 未勾选 ⇒ 拒绝（不弹权限框） |
| 内网段 | `isPrivateAddress` 覆盖面：IPv4 私网段（`10./8`、`172.16/12`、`192.168/16`）、`127/8`、`0.0.0.0/8`、`100.64/10`（CGNAT）、链路本地 `169.254/16`；IPv6 `::1`、`fc00::/7`、`fe80::/10`；**IPv4-mapped IPv6**（`::ffff:10.x` 先还原再判）；**纯十进制/八进制 IP 字面量**（`http://2130706433/`）先**规范化**再判 | 「不允许访问内网地址（SSRF 防护）」——**即使已显式授权也拒绝** |
| DNS 解析结果 | **全部**解析结果均非内网 | 「主机解析到内网地址，拒绝下载（SSRF/DNS 重绑定防护）」 |
| IP pinning | socket 的 `lookup` 被覆写为**已校验的解析结果**（消除「校验用 A 解析、连接用 B 解析」的 TOCTOU 窗口） | （失败时表现为连接错误） |
| 重定向跳数 | ≤ `MAX_REDIRECTS` | 「跳转次数超过上限」 |
| 每跳重校验 | 每一跳重过协议/端口/主机/内网/DNS 五项 | 「跳转目标未通过下载合同校验」 |
| 文件体积 | ≤ `MAX_DOWNLOAD_BYTES`（500MB） | 「下载超过体积上限」 |
| 落盘目录 | 位于受控媒体根内 | 「落盘目录不在受控媒体根内」 |
| 临时文件 | 先写 `.part`，ffprobe 通过才 `rename`；失败清理 `.part` | 「视频下载失败，探测未通过」 |

> **为什么缺省 fail-closed 而不是"任意公网主机"**：成片 URL 来自 provider 响应，域名会漂移；但"仅在文案上提示"挡不住一次真实的越权下载。同源 provider **零配置可用**（API 主机自动进可信集合），非同源 provider 运营配一次 `assetDownloadHosts` 即可——宁可首次失败并给可操作指引，也不默认放开出站面。

### 4.5 外部工具

| 校验项 | 判据 | 是否阻断 |
|--------|------|---------|
| ffmpeg 存在 | `findFfmpeg()` 非空 | ✅ **阻断**（出片前） |
| ffprobe 存在 | 同上 | ✅ **阻断**（出片前） |
| 版本号 | 解析 `ffmpeg -version` 首行 | ❌ **不阻断**，仅提示 |

### 4.6 项目文件写入

| 校验项 | 判据 | 失败形态 |
|--------|------|---------|
| `expectedRevision` 比对 | 与当前 `revision` 相等 | 冲突错误，**原文件逐字不变** |
| `revision` 递增 | 每次写入 +1 | — |

---

## 五、功能逻辑

### 5.1 三分派生（规划期）

```
输入：kit 模板分镜（shot-library）+ 本镜 beat 文本 + 角色映射 + 角色/场景参考图
  │
  ├─ imagePrompt  = 模板「首帧块」+ 本镜静态画面描述 + 角色名 + 场景 + 风格行（色盘）
  ├─ videoPrompt  = 模板「动作/运镜块」+ 本镜动作描述
  │                 **只保留运镜 + 主体 + 时长内的变化，不复制 imagePrompt 的静态画面全量**
  │                 ⇒ 长度显著小于 imagePrompt（验收逐镜断言）
  └─ endFramePrompt = 模板「尾帧约束块」(frame_constraint 21 条) + 本镜末帧衔接描述
  │
  └─ 三者合计 ≤ 50000，否则本镜标记 SHOT_PROMPT_BUNDLE_TOO_LARGE（不进 kit，视为资产损坏）
```

**参考图优先级声明**（自动模式侧）：同一镜绑定多张参考图时，**最早的一张 = 身份锚**，其余仅用于场景/光线/构图/情绪。该声明随 `imagePrompt` 一同派生。

#### 5.1b 方法论接线的流程（PR-3 · F-I）

**触发点**：自动模式的**规划**（`film-engineering:auto-plan`）。客户端只传剧本/参考图/画幅/时长/语种；
**方法论资产由服务端从 kit 取**（客户端不得回传资产，也不得回传分镜）。

```
IPC auto-plan
  ├─ service.getKitContext()  → { doctrine, palette, promptLibrary, manifest }（只给方法论接线要用的四样）
  ├─ planAutoShots({ ..., kit, locale })
  │    ├─ buildPlanPromptContext({ kit, locale })       ← plan 级，只做一次
  │    │    ├─ 尾帧约束：doctrine.frame_constraint → { hash, length, locale, fallback, truncated }
  │    │    ├─ 任务模板：getTaskPrompts(library, 'generate_shot_prompt', locale)（en 缺失 → 回落 zh）
  │    │    ├─ promptAssetHash = sha256(v1 + locale + 回退事实 + doctrine + system + user)
  │    │    └─ 产出 W10 / W11（缺资产时）+ assetsIncomplete
  │    └─ 逐镜：buildShotTaskVars({ shot, kit, locale, durationSec })
  │         ├─ 填 7 个变量（固定键序的 shot_json / palette_line / character_descriptors / duration_sec / model）
  │         ├─ style_prefix ⇒ byDesign（**不提供** ⇒ 渲染保留 {{style_prefix}}）
  │         ├─ geo_block ⇒ assetMissing（提供空串 ⇒ 渲染为空串）
  │         └─ promptRenderHash = sha256(v1 + locale + 固定键序的 vars)
  ├─ writePlan（计划文件：含 plan 级 promptContext 与逐镜 vars/missing/hash）
  └─ 返回 { ..., methodology }（只读面板的数据源；**不落盘**）
```

**消费侧（本批次不消费）**：`endFramePrompt` **只产出不发送**（消费路径的前置条件未落地，见 C2）；
`promptTask` 的渲染文本**只留在规划结果**，后续接 LLM 时直接消费，届时必须先校验 `deliverable`。

**降级路径**：kit 缺 doctrine / promptLibrary ⇒ 规划**照常出结果**（老 kit 也能用），只是方法论没接上，
面板显示「资产不完整，请重新导入」⇒ **缺失可见，不静默**。

### 5.2 成本闸 + 就绪度

```
用户点「生成」
  │
  ├─ 未勾选确认
  │    └─ 零 provider 调用 → 返回 { awaitingConfirmation: true, costCheck: { ..., readiness } }
  │       前端渲染「就绪度」分区：7 镜可生成 / 1 镜暂不可生成（附可操作文案）
  │       → 用户可选择「只生成就绪的 7 镜」或「补写后重试」
  │
  └─ 已勾选确认
       └─ 仍按既有闸执行（**不新增第二道闸**），就绪度只影响"哪些镜实际提交"
```

**关键口径**：就绪度**不是新闸门**——它不产生 checkpoint、不改变"未确认即零调用"的既有契约（`film-video-checkpoint-integration.test.js:140-172` 锁死）。它只是**让用户在确认之前就看到问题**。

### 5.3 锁镜（`locked`）

| 场景 | `locked` 镜的行为 |
|------|------------------|
| 批量重跑 | **跳过**（不重生成、不覆盖 `outputPath`、不改提示词） |
| 单镜重生成（用户显式点击） | **照常执行**（保留逃生口） |
| 成本闸就绪度 | 标 `ready=false` + `reasonCode=SHOT_LOCKED`，文案「该镜已锁定，本次批量不参与」 |
| 续跑 | 已产出成品的锁镜视为 `done`（磁盘为真优先） |

> **口径澄清（回应评审）**：`SHOT_LOCKED` 放进就绪度**不与"锁镜只挡批量重跑"冲突**——就绪度里的 `ready` 语义是「**本批次能否被提交**」，锁镜的语义是「**不被批量重跑覆盖**」。两者层次不同。锁镜**仍可被单镜重生成**这一条独立于就绪度。

### 5.4 乐观锁

```
auto-start / auto-regenerate-shot
  │
  ├─ 读当前 project.json → revision = R
  ├─ 入参带 expectedRevision = E
  │    ├─ E 缺省 → 直接写（向后兼容，单会话串行路径不受影响）
  │    └─ E ≠ R → 冲突，**不写**，返回可操作错误：
  │          「项目文件已被其他会话修改（修订号 E ≠ R），本次操作未写入。请刷新后重试。」
  └─ 取**独占锁**（`fs.open(lock, 'wx')`，项目目录下的锁文件）
  └─ **旧项目文件缺 `revision` ⇒ 读作 0**（不判损坏）；首次并发写由**锁内自增**保证
  └─ 持锁期间：把「revision = R + 1」与新内容写进**同一份临时文件** → fsync → **一次 rename 覆盖**
  └─ 释放锁（正常与异常路径都释放）

> **为什么必须有锁**：rename 只保证**单次写**的原子性，**不提供 compare-and-swap 语义**——两个进程可各自读到 `revision=5`、都通过比对、再先后 rename，后写仍覆盖先写。**互斥靠锁，原子靠 rename，两者不可互换。**
> **陈旧锁**：锁文件带进程 PID；进程崩溃后残留的锁（PID 不存在）可被清理。锁只在单次写入事务内持有，不跨事务。
```

**与 `needsReconfirm` 并存不合并**：`needsReconfirm` 答「用户确认是否仍作数」（计划/内容改过），乐观锁答「有没有并发写覆盖」。合并会稀释任一语义。

### 5.5 出站下载

```
provider 轮询 → videoUrl
  │
  ├─ 合同校验：https / 端口（可信清单声明集，缺省 443）/ 主机名 / 可信主机（缺省 fail-closed）/ 私网段 / 体积 / 目录
  ├─ DNS 解析一次 → 全部结果非内网 → **pin 进 socket lookup**
  ├─ 请求（redirect: 'manual'）
  │    └─ 3xx → 每跳重过全部校验（含重新 DNS + pin）
  ├─ 流式写 shot_NNN.mp4.part，体积超限即中止
  ├─ ffprobe 探测通过 → rename 为 shot_NNN.mp4
  └─ 任一失败 → 清理 .part，**不留半成品**
```

**与原片下载的差异（显式取舍）**：原片下载 URL 来自 kit 元数据，域名有限 ⇒ 施加 `allowedHosts` 精确白名单。成片下载 URL 来自 provider 响应，域名不固定 ⇒ **可信主机集合 = provider API 主机（自动派生）∪ `assetDownloadHosts`（可配）**，缺省 fail-closed；用户可在确认卡**显式勾选**「本次允许从外部素材域名下载」放宽一次（留痕 `project.json`），**其余合同项（https / 端口 / 私网段 / DNS 校验 / pinning / 逐跳重校验 / 体积 / 落盘目录）全部无条件生效**。

**落地形态**：先由 PR-5 把 `downloadToFile` 原样抽成独立模块 `film-video-downloader.js`（**行为零变化**），PR-6a 再零行为抽出 `egress-guard` 并让 `shot-downloader` 改调它，PR-6b 才在 `egress-guard` 上加 pinning / 端口 / 主机策略并让 `film-video-downloader` 改走——避免「换实现」与「改成本闸」落在同一文件相邻位置、回归面重叠，也避免抽取方向变成循环依赖。

### 5.6 工具体检

```
视频生成阶段入口
  │
  ├─ 体检 ffmpeg / ffprobe 存在性
  │    ├─ 缺失 → 返回可操作错误（指明缺哪个、去哪装），**零 provider 调用**
  │    └─ 存在 → 解析版本号（仅提示），继续
  └─ 进入既有成本闸流程
```

**时机前移**：原为合成期（`film-render.js:278-279`）才暴露，现在出片前暴露。

### 5.7 身份锚点注入（提示词优化阶段）

```
split → scene_context（已有）
  │
  └─ optimize 阶段
       ├─ 从 scene_context 的角色识别结果 + 参考图元数据，提取角色身份锚点
       │    （骨相 / 五官 / 发色瞳色 / 唇色；硬上限 4 条；截断显式标记）
       ├─ 构造参考图优先级声明（最早=身份锚，其余=环境）
       └─ 注入 prompt-engine context
            + 多人同框防串脸约束（禁止交换身份/肢体/说话归属/动作归属）
```

**验证闭环（不依赖视觉模型）**：① 断言 context 含锚点与优先级声明；② 对参考图**内容哈希**排序，"最早参考图"判定与实际注入序号一致，不一致时**报错而非静默**。

---

## 六、交互逻辑

### 6.1 自动标签 · 规划确认卡

```
① 剧本输入区（既有）
② 人物参考图 / 场景参考图（既有）
③ 横竖屏 / 目标时长 / 单镜秒数（既有，高级折叠）
④ 【规划】按钮 → 预览卡（既有）
⑤ 预览卡新增：
   ├─ 「就绪度」行：✅ 7 镜可生成 · ⚠️ 1 镜暂不可生成
   ├─ 逐镜清单新增一列：状态（可生成 / 暂不可生成 / 已锁定）
   └─ 未就绪镜下方展开可操作提示（不弹窗打断）
⑥ 【生成】按钮（既有，勾选确认）
```

**交互约束**：
- 未就绪镜**不阻止**用户确认（用户可能就是要跑能跑的）；但确认卡上必须**可见**。
- 提供「只生成可生成的 N 镜」次级操作（默认**关闭**，避免用户误以为全部生成）。
- 就绪度为**只读**展示，不提供就地编辑。

#### 6.1b 方法论接入状态面板（PR-3 · F-I · 只读）

**位置**：自动标签 → 规划确认卡（预览态）内，**分镜清单上方**，plan 级（**不逐镜铺开**）。

**显示什么**：① 任务模板（缺失时显示「任务模板库缺失（未接入）」）② 变量命中 `N/7` ③ 未接入的变量（代码标识符，逗号分隔）
④ 存在未接入变量时提示「这份提示词不能直送模型」⑤ 资产不完整时提示「请重新导入」⑥ 尾帧规则已接入、逐镜待派生 ⑦ 资产版本戳（`promptAssetHash` 前 8 位）。

**交互**：**纯只读**，无复制/导出/编辑入口（提示词资产的导出面需单独权限评审）。
**为什么要有这个面板**：`promptTask` 在本批次**没有消费方**（接 LLM 是后续 PR），
若只落在测试里，它就是「只有测试没有生产消费方」——面板让它在**用户路径上可见**，
回答「我的自动分镜到底接上了多少方法论」，并如实显示「5/7」而不是假装「7 个变量都接上了」。

### 6.2 自动标签 · 运行中逐镜表

| 状态 | 显示 | 可用操作 |
|------|------|---------|
| 就绪待跑 | 「待生成」 | — |
| 不就绪 | 「暂不可生成」+ 原因 | 「查看原因」（展开行内文案） |
| 已锁定 | 锁图标 + 「已锁定」 | 「解锁」（二次确认后） |
| 生成中 / 失败 / 完成 | 既有 | 既有 |

### 6.2b 成本确认卡 · 素材域名显式授权

当成片下载的域名**不在可信集合**（provider API 主机 ∪ `assetDownloadHosts`）时，成本确认卡出现一个**默认不勾选**的勾选项：

| 项 | 文案 | 行为 |
|----|------|------|
| 勾选项 | 「本次允许从外部素材域名下载（{host}）」 | 勾选 ⇒ 产生**运行期一次性令牌**（**只存内存、不落盘**；任务结束失效），该域名的下载放行到私网段检查；**私网地址即使勾选也拒绝**。审计只记「发生过一次外部域名授权」的事实 |
| 辅助链接 | 「在模型设置中配置素材下载可信域」 | 跳转到「模型提供商 → {provider}」的配置项 |
| 不勾选 | — | 出片时该域名**被拒绝**，错误文案指明去哪儿配置 |

> 勾选是**逐次授权**、**留痕**、**默认拒绝**三件事的组合：既不打死正常出片（同源 provider 根本不需要它），也不默认放开出站面。

### 6.3 视频创作 · 提示词优化阶段

- 阶段进度条与既有 `optimize_progress` **一致**，不新增用户可见阶段。
- 锚点与优先级声明**不单独展示**（对用户是内部机制），仅在"优化词"详情里提供**只读**的「角色锚点」折叠区，便于用户核对。
- 锚点被截断时，该折叠区显示「另有 N 个角色未纳入锚点（上限 4）」，**不静默**。

---

## 七、显示项

| 位置 | 新增/变更项 | 数据来源 |
|------|------------|---------|
| 自动标签 · 规划确认卡 | 「就绪度」汇总行 | `plan.readiness`（规划期即可给出） |
| 自动标签 · 规划确认卡 | 逐镜清单「状态」列 | `plan.shots[].readiness` |
| 自动标签 · 逐镜行 | 状态徽标（可生成/暂不可生成/已锁定） | `project.shots[].status` + `locked` |
| 自动标签 · 逐镜行 | 锁图标（可点，解锁需二次确认） | `project.shots[].locked` |
| 自动标签 · 逐镜行 | 未就绪原因（行内展开，非弹窗） | `readiness.reason` |
| 自动标签 · 确认卡 | 「只生成可生成的 N 镜」次级按钮 | `readiness.readyCount` |
| 视频创作 · 优化词详情 | 「角色锚点」只读折叠区 | `characterAnchors` + `anchorTruncated` |
| 出片前（错误态） | 缺工具提示（含工具名与安装指引） | `tool-doctor` 错误码 |

**不新增的显示项**：不新增顶部导航项、不新增标签页、不改既有「自动/画布/项目案例」三标签结构。

---

### 7.b 方法论接入状态面板的显示项（PR-3 · F-I）

| 显示项 | 数据源 | 形态 | 缺数据时 |
|--------|--------|------|----------|
| 任务模板 | `methodology.taskId` / `taskAvailable` | 文本（代码标识符） | `taskAvailable === false` ⇒ 显示「任务模板库缺失（未接入）」 |
| 变量命中 | `methodology.hitVars` / `totalVars` | `N/7` | 无上下文 ⇒ **整个分区不渲染**（老 kit 兼容） |
| 未接入的变量 | `methodology.blockedVars[].name` + `.reason` | 每项「变量名（原因文案）」 | 空 ⇒ 该行不渲染 |
| 可否直送 | `methodology.deliverable === false` | 一行提示（**按 reason 分流两态**，见 §8.b 的 15/16 号 key） | true ⇒ 该行不渲染 |
| 资产完整性 | `methodology.assetsIncomplete` | 一行提示（**不指向导入入口** —— 产品里没有该功能） | false ⇒ 该行不渲染 |
| 尾帧约束状态 | `methodology.frameConstraintPending` | 一行提示 | false ⇒ 该行不渲染 |
| 资产版本戳 | `methodology.promptAssetHash.slice(0, 8)` | 8 位十六进制 | 无 ⇒ 显示空 |
| **资产已变** | `methodology.stale` | **区块级**警告（不是一行字段） | false ⇒ 不显示 |

**每一行的行标签必须互不相同**（第 9 轮 i6）：本分区共 7 行，行标签分别是
「任务模板 / 变量命中 / 未接入的变量 / 可否直送 / 资产完整性 / 尾帧约束 / 资产版本戳」——
此前「可否直送 / 资产完整性 / 尾帧约束」三行**复用了「任务模板」**（key 都在、但标签错位）。

**分区在两种状态下都可见**（第 9 轮 i4）：
- 刚规划完 ⇒ 数据来自规划结果；
- **重开一个已规划的项目** ⇒ 规划结果不在内存里，数据来自**落盘**的
  `promptContext` + 逐镜 `promptMissing`（由服务端用**同一个**汇总实现重新算）。
⇒ 面板读一个**计算属性**（规划结果优先、其次项目投影），**不是**直接读 `plan.methodology`。

**方法论分区（F-H）新增的两个只读分区**（项目案例标签 → 提示词方法论）：

| 分区 | 数据源 | 字段显示 |
|------|--------|----------|
| 配方 | `doctrine.recipes[]` | `label`（粗体）、`zh`、`blockKeys`（「包含块」行，斜杠分隔） |
| 失败台账 | `doctrine.failureLedger[]` | `id · 症状`、成因、修法、标签（`el-tag` 列表） |

**只读**：两个分区不含任何写操作（无点击、无输入框、无按钮）⇒ 方法论只能看，改法一律走「自动」标签。

## 八、提示文字（可直接使用的文案表）

> i18n 键一律成对提交（`apps/desktop/src/locales/film-engineering/{zh,en}.js`）。

### 8.1 就绪度

| 键 | 中文 | English |
|----|------|---------|
| `auto.readiness.title` | 生成就绪度 | Generation readiness |
| `auto.readiness.summary` | {ready} 镜可生成，{notReady} 镜暂不可生成 | {ready} shots ready, {notReady} not ready |
| `auto.readiness.ready` | 可生成 | Ready |
| `auto.readiness.notReady` | 暂不可生成 | Not ready |
| `auto.readiness.locked` | 已锁定 | Locked |
| `auto.readiness.onlyReady` | 只生成可生成的 {n} 镜 | Generate only the {n} ready shots |

### 8.2 未就绪原因（`reason` 文案）

| reasonCode | 中文 | English |
|-----------|------|---------|
| `SHOT_PROMPT_EMPTY` | 本镜提示词为空，请补写或删除该镜 | This shot has no prompt; fill it in or remove the shot |
| `SHOT_REFERENCE_UNRESOLVED` | 本镜的参考图无法读取，将以纯文本生成 | A reference image for this shot could not be read; it will be generated from text only |
| `SHOT_DURATION_OUT_OF_RANGE` | 本镜时长 {value} 秒超出可用范围（{min}–{max} 秒） | Shot duration {value}s is out of range ({min}–{max}s) |
| `SHOT_ASPECT_UNSUPPORTED` | 当前模型不支持 {aspect} 画幅 | The selected model does not support {aspect} |
| `SHOT_SECONDS_UNSUPPORTED` | 当前模型不支持 {seconds} 秒时长 | The selected model does not support {seconds}s |
| `SHOT_LOCKED` | 该镜已锁定，本次批量不参与 | This shot is locked and will be skipped in this batch |

### 8.3 锁镜

| 键 | 中文 | English |
|----|------|---------|
| `auto.lock.lock` | 锁定该镜 | Lock this shot |
| `auto.lock.unlock` | 解锁该镜 | Unlock this shot |
| `auto.lock.confirmUnlock` | 解锁后，批量重跑会覆盖该镜的当前结果。确定解锁？ | Unlocking means a batch rerun will overwrite this shot. Unlock anyway? |
| `auto.lock.lockedBadge` | 已锁定 | Locked |

### 8.4 并发冲突

| 键 | 中文 | English |
|----|------|---------|
| `auto.conflict.title` | 项目文件已被其他会话修改 | The project file was changed in another session |
| `auto.conflict.detail` | 期望修订号 {expected}，实际 {actual}。本次操作未写入，请刷新后重试。 | Expected revision {expected}, found {actual}. Nothing was written; refresh and try again. |

### 8.5 环境缺件

| 键 | 中文 | English |
|----|------|---------|
| `auto.tools.missing` | 缺少 {tool}，无法出片。请先安装 {tool} 后重试（提示词与参数已保留）。 | {tool} is missing, so the video cannot be rendered. Install {tool} and retry; your script and settings are preserved. |
| `auto.tools.oldVersion` | {tool} 版本 {version} 较旧，可能影响合成质量 | {tool} {version} is old and may affect output quality |

### 8.6 素材域名与授权

| 键 | 中文 | English |
|----|------|---------|
| `auto.egress.allowExternal` | 本次允许从外部素材域名下载（{host}） | Allow downloads from an external media host this time ({host}) |
| `auto.egress.allowExternalHint` | 勾选后本次任务可从该域名下载素材，并会在项目文件中留痕。私网地址始终拒绝。 | When checked, this task may download media from that host and the choice is recorded in the project file. Private addresses are always rejected. |
| `auto.egress.untrustedHost` | 素材域名 {host} 不在可信清单内。请在「模型提供商 → {provider}」中配置「素材下载可信域」，或在上方显式允许。 | Media host {host} is not in the trusted list. Add it under Model Providers → {provider}, or allow it explicitly above. |
| `auto.egress.portNotAllowed` | 下载通道仅允许 {ports} 端口 | The download channel only allows port {ports} |
| `auto.egress.trustedHosts` | 素材下载可信域 | Trusted media hosts |

### 8.7 锚点（只读折叠区）

| 键 | 中文 | English |
|----|------|---------|
| `auto.anchor.title` | 角色锚点 | Character anchors |
| `auto.anchor.truncated` | 另有 {n} 个角色未纳入锚点（上限 {max}） | {n} more characters were left out (limit {max}) |
| `auto.anchor.empty` | 本场景未识别到角色锚点 | No character anchors were detected for this scene |

---

### 8.b 方法论接线的文案（PR-3 · F-I · 27 个 key，zh/en 成对）

| # | key | zh | en |
|---|-----|----|-----|
| 1 | `filmEngineering.doctrine.recipes` | 配方 | Recipes |
| 2 | `filmEngineering.doctrine.recipeBlocks` | 包含块 | Blocks |
| 3 | `filmEngineering.doctrine.failureLedger` | 失败台账 | Failure ledger |
| 4 | `filmEngineering.doctrine.failureSymptom` | 症状 | Symptom |
| 5 | `filmEngineering.doctrine.failureCause` | 成因 | Cause |
| 6 | `filmEngineering.doctrine.failureFix` | 修法 | Fix |
| 7 | `filmEngineering.doctrine.failureTags` | 标签 | Tags |
| 8 | `filmEngineering.auto.methodology` | 方法论接入状态 | Methodology wiring |
| 9 | `filmEngineering.auto.methodologyTask` | 任务模板 | Task template |
| 10 | `filmEngineering.auto.methodologyHit` | 变量命中 | Variables filled |
| 11 | `filmEngineering.auto.methodologyBlocked` | 未接入的变量 | Variables not wired |
| 12 | `filmEngineering.auto.methodologyDeliverable` | 可否直送 | Ready to send to the model |
| 13 | `filmEngineering.auto.methodologyAssets` | 资产完整性 | Asset completeness |
| 14 | `filmEngineering.auto.methodologyFrame` | 尾帧约束 | Tail-frame constraint |
| 15 | `filmEngineering.auto.methodologyNotDeliverable` | 存在未接入变量，这份提示词不能直送模型（请先人工补齐未接入的变量） | Some variables are not wired, so this prompt cannot be sent to the model as is (fill in the unwired variables first) |
| 16 | `filmEngineering.auto.methodologyNotDeliverableAssets` | 存在未接入变量，这份提示词不能直送模型（请先人工补齐未接入的变量，或补齐对应资产） | Some variables are not wired, so this prompt cannot be sent to the model as is (fill in the unwired variables, or supply the missing assets) |
| 17 | `filmEngineering.auto.methodologyAssetsIncomplete` | 影视工程资产不完整（缺少提示词方法论或任务模板库），相关能力未接入 | Film engineering assets are incomplete (prompt doctrine or task template library missing); the capability is not wired |
| 18 | `filmEngineering.auto.methodologyFramePending` | 尾帧约束规则已接入（plan 级），逐镜尾帧文本待模型派生 | Tail-frame rules are wired (plan level); per-shot tail-frame text awaits model derivation |
| 19 | `filmEngineering.auto.methodologyAssetHash` | 资产版本戳 | Asset version |
| 20 | `filmEngineering.auto.methodologyNoLibrary` | 任务模板库缺失（未接入） | Task template library missing (not wired) |
| 21 | `filmEngineering.auto.methodologyReasonByDesign` | 设计上不填（该变量没有资产源） | Not filled by design (this variable has no asset source) |
| 22 | `filmEngineering.auto.methodologyReasonAssetMissing` | 资产缺口（该资产尚未提供） | Asset gap (this asset is not provided yet) |
| 23 | `filmEngineering.auto.methodologyReasonTemplateVar` | 模板需要但未提供 | Required by the template but not provided |
| 24 | `filmEngineering.auto.methodologyReasonBadVarName` | 变量名不合法（实现缺陷） | Invalid variable name (implementation defect) |
| 25 | `filmEngineering.auto.methodologyReasonOversizeVar` | 变量内容过长（资产装不进提示词） | Variable content is too long (the asset does not fit the prompt) |
| 26 | `filmEngineering.auto.methodologyStale` | 资产已变（哈希不一致），这份接入状态已过期，请重新规划 | Assets have changed (hash mismatch); this wiring status is out of date, please re-plan |
| 27 | `filmEngineering.auto.methodologyTruncated` | 另有未接入的变量未显示（清单已按上限截断） | More unwired variables are not shown (the list was truncated at its cap) |

**新增的警告文案（服务端，不进 i18n 渲染端）**：

| code | 文案 |
|------|------|
| W10 | 影视工程资产缺少提示词方法论（prompt-doctrine）⇒ 尾帧约束未接入，逐镜尾帧提示词仍为空。资产补齐入口尚未提供（见 PR-3b）。 |
| W11 | 影视工程资产缺少任务级提示词库（prompts/tasks）⇒ 任务模板未接入。资产补齐入口尚未提供（见 PR-3b）。 |

**清单与计数必须对账**：方案里写「27 个 key」，测试就**逐条断言这 27 个 key 的字面量在 zh / en 都存在**
（**不按命名空间计数** —— 那两个命名空间还有大量既有 key），另断言「清单条数 == 27」与「zh / en 命中数一致」；**再加一条「三处计数同源」**（本 PRD §8.b、方案简报、测试清单长度，出现的每一个 N 都必须等于 25）。
**再加一条**：扫面板源码里的**行标签**，每一行的 `<dt>` 必须是**互不相同**的 key ——
「key 存不存在」查不出「行标签被复用」这类缺口。

> 计数从 16 → 20 → 24 → 25 → 26 → **27** 的来由：
> ① 第 6 轮对抗评审 i2：阻断原因是机器枚举 ⇒ 面板会渲染出原始英文标记 ⇒ 补 4 个 `methodologyReason*` key；
> ② 第 9 轮对抗评审 i6：面板的**三行行标签**（可否直送 / 资产完整性 / 尾帧约束）**复用了「任务模板」**
>    ⇒ 补 3 个行标签 key（`methodologyDeliverable` / `methodologyAssets` / `methodologyFrame`）；
> ③ 第 9 轮对抗评审 i7：聚合提示要**按 reason 分流**（有真·资产缺口时要说「或补齐对应资产」，
>    只剩 byDesign 时只说「人工补齐」）⇒ 补 1 个第二态 key（`methodologyNotDeliverableAssets`）；
> ④ 第 10 轮对抗评审 i4：超长的变量（色盘行 / 角色描述 / 逐镜字段）**不是**「资产缺口」
>    （资产**有**，只是太大）⇒ 独立一类 `oversizeVar` ⇒ 补 1 个原因文案 key（`methodologyReasonOversizeVar`）；
> ⑤ 第 12 轮对抗评审 i6：重开项目时要校验「资产有没有被换过」⇒ 补 1 个「资产已变」key（`methodologyStale`）；
> ⑥ 第 17 轮对抗评审 i7：清单被闸门截断时**要说出来**（不静默丢弃）⇒ 补 1 个 key（`methodologyTruncated`）。
>
> 这条链路的教训：**新增一类用户可见枚举值、或新增一行面板行，就等于新增一组 i18n key**，
> 计数必须同步三处（本 PRD §8.b、方案简报 §四末、测试断言）**并同次改完**。
> 另注：第 9 轮 i1 指出「请重新导入完整资产」**指向了一个不存在的功能**（产品里没有资产导入入口，
> 那是 PR-3b）⇒ 文案改为如实说明「缺什么 + 能力未接入」。

## 九、验收标准

| # | 标准 | 命令 / 判据 |
|---|------|------------|
| V-1 | 存量 153 条加载后三分齐备、`prompt` 原值不变 | `kit-loader.test.js` 新增用例；`git diff --stat apps/desktop/electron/film-kit/shot-library.json` 为空 |
| V-2 | 三分字段非法（非字符串 / 超单字段上限 50000）→ fail-closed，不截断；**无「三分合计上限」** | `kit-loader.test.js` |
| V-3 | 图片用 `imagePrompt`、视频用 `videoPrompt`、缺则回落 | `video-gen.test.js` |
| V-4 | 未确认时仍零 provider 调用，`costCheck` 带 `readiness` | `video-gen.test.js`；`film-video-checkpoint-integration.test.js` **不改且仍绿** |
| V-5 | 空提示词镜在确认前被标出 | `video-gen.test.js` |
| V-6 | 成片下载拒绝 `169.254.169.254` / `10.x` / `172.16-31.x` / `192.168.x` | `egress-guard.test.js` |
| V-7 | 成片下载拒绝明文 `http://` | `egress-guard.test.js` |
| V-8 | 跳转目标为内网时**在第二跳发起前**被拒 | `egress-guard.test.js` |
| V-9 | 下载中断不留半成品 | `egress-guard.test.js` |
| V-10 | 下载体积超限中止并清理 | `egress-guard.test.js` |
| V-11 | socket 连接到**已校验的 IP**（pinning 生效） | `egress-guard.test.js`：注入两组不同 IP，断言连接用第一组 |
| V-12 | 原片下载行为逐字不变 | `shot-downloader.test.js` 既有 23 例全绿 |
| V-13 | 缺 ffmpeg 在出片前给可操作提示 | `tool-doctor.test.js` + `video-gen.test.js` |
| V-14 | 锁镜不被批量重跑覆盖 | `auto-runner.test.js` |
| V-15 | 锁镜仍可单镜重生成 | `auto-runner.test.js` |
| V-16 | 陈旧 `expectedRevision` 写入被拒且原文件不变 | `auto-project.test.js` |
| V-17 | 缺省 `expectedRevision` 不阻断 | `auto-project.test.js` |
| V-18 | 逐镜时长落进项目文件 | `auto-project.test.js` |
| V-19 | 锚点硬上限 4 条 + 截断显式标记 | `story-context-engine` 相关测试 |
| V-20 | 参考图优先级声明进入优化上下文且序号一致 | `story2video-stages` 相关测试 |
| V-21 | 三类提示词未内联进 `.js` | 机械核对（`.js` 内零命中） |
| V-22 | i18n zh/en 成对 | `node scripts/check-locale-sync.js --keys` / `--cjk` |
| V-23 | 品牌残留 | `node scripts/check-no-brand-residue.js` rc=0 |
| V-24 | 门禁记录完整（两形态） | `node scripts/check-gate-record-debt.js` rc=0 |
| V-25 | 打包可用 | QM-1：`electron-builder --win --x64` exit 0 + asar 清单核对 |
| V-27 | 素材域名缺省拒绝 | `egress-guard.test.js`：① 主机 = provider API 主机 ⇒ 放行（零配置）；② 不在可信集合且未显式授权 ⇒ **拒绝**；③ 已显式授权 ⇒ 放行到私网段检查；④ 私网地址**即使显式授权也拒绝** |
| V-28 | 放宽授权是**运行期令牌**，不落盘 | 勾选 ⇒ 内存中产生一次性令牌；**机械核对：`project.json` 中不存在任何 `egressAllow` 类可放行字段**；任务结束令牌失效 |
| V-29 | 新分镜视频提示词不含静态块 | `auto-plan.test.js`：① `imagePrompt === prompt`（**逐字不变**，零回归锁）；② 派生镜 `videoPrompt.length < imagePrompt.length`；③ **全体真实模板聚合比 ≤ 0.6×**（实测 **0.177**）；④ `videoPrompt` 非空且不含静态块标记 |
| V-30 | 存量 videoPrompt 为空（不假装已解决） | `kit-loader.test.js`：存量 153 条 `videoPrompt === ''`、`imagePrompt === prompt`；视频请求回落 `imagePrompt`，行为与变更前一致 |
| V-30b | 逐镜比例阈值不成立（实测修正） | 真实 kit 模板是**散文自由文本**，153 个模板里 **123 个无可剔除静态块** ⇒ 运动子集与首帧图逐字相同（比值 1.0）⇒ 逐镜固定比例会必然失败。改判为「派生镜严格短于 + 全体聚合 ≤ 0.6×」 |
| V-31 | 乐观锁写入原子 | `auto-project.test.js`：并发写用例断言无半写文件；`revision` 自增与内容替换在同一次 rename 内 |
| V-32 | 就绪度三态 | `shot-readiness.test.js`：锁镜 `skipped`（不阻断）；空提示词等 `notReady`（阻断） |
| V-33 | 端口随可信域声明 | `egress-guard.test.js`：声明含 8443 ⇒ `:8443` 放行；未声明 ⇒ 拒绝；`:443`/省略 ⇒ 放行 |
| V-34 | 尾帧只读行有真实承载 | `apps/desktop/src/views/film-auto/ShotTailFrameRow.vue` 存在且被规划确认卡渲染；**并断言 `.js` 中不存在把 `endFramePrompt` 送入 provider 的读取点** |
| V-26 | 文档与实现同源 | `SCHEMA.md` ↔ `kit-loader` 校验器；本 PRD 字段表 ↔ 代码字段 |

---

### 9.b 方法论接线的验收（PR-3 · F-I / F-H）

| # | 断言 | 类别 | 测试 |
|---|------|------|------|
| M-1 | 渲染器：7 变量齐备 ⇒ 渲染无 `{{}}` 残留 + `missing` 为空 + `deliverable=true` | 合成 | `shot-prompt-task.test.js` |
| M-2 | 生产路径：`style_prefix` ∈ `blockedVars` + `deliverable=false` | 真实 | 同上 + `auto-plan.test.js` |
| M-3 | byDesign 保留 `{{style_prefix}}`；assetMissing 渲染为空串并进清单 | 合成 | `shot-prompt-task.test.js` |
| M-4 | 模板多出的变量（templateVar）与非法变量名（badVarName）都计入 `missing` 且拦住直送 | 合成 | 同上 |
| M-5 | 尾帧约束取自 `frame_constraint`；超 50000 截断且出声；缺 `en` 回落 `zh` 并记 `fallbackLocales` | 合成 | 同上 |
| M-6 | 同输入两次渲染**逐字相等**；`promptAssetHash` 随 locale/回退变化、同输入稳定；不同镜的 `promptRenderHash` 不同 | 合成 | 同上 |
| M-7 | 缺 doctrine ⇒ W10 + `assetsIncomplete`；缺 promptLibrary ⇒ W11 + `assetsIncomplete` | 合成 | `auto-plan.test.js` |
| M-8 | 不传 kit ⇒ `prompt` 与三分字段**逐字不变**，且不产出任何方法论字段 | 合成 | 同上 |
| M-9 | 项目文件里**方法论原文出现次数 == 0**（`frameConstraint` / `system` / `user` 的原文**一律不落盘**，只落哈希与长度）；单镜 `promptVars` + `promptMissing` 序列化 **≤ 256 KiB** | 合成 | `auto-project.test.js` |
| M-10 | 真实 kit 抽样 20 镜 ⇒ **只断言不变量**（① 每镜「命中数 + **7 个任务变量**在清单里的条数 == 7」；② `style_prefix` 恒 `byDesign`）；**平均命中数只作打印读数，不参与判定**（阈值建在会随资产更新漂移的量上 ⇒ 假红；且与「真实巡检不设阈值」自相矛盾）。CI 无 film-kit ⇒ SKIP 并打印读数格式 | 真实 | `shot-prompt-task.test.js` |
| M-11 | 方法论分区渲染 `recipes` 与 `failureLedger`，且**只读**（无写操作） | 合成 | `film-engineering-methodology.test.js` |
| M-12 | 接入状态面板显示命中数、阻断原因、资产不完整、尾帧待派生；无上下文时不渲染 | 合成 | `FilmAutoPanel.test.js` |
| M-13 | **27 个** i18n key 在 zh/en 均存在，清单条数 == **清单长度**（断言从清单长度取数、**不手写数字**）；且**三处计数同源**（本 PRD §8.b / 方案简报 / 测试清单长度） | 合成 | `film-engineering-methodology.test.js` |
| M-14 | **篡改可检测**：`promptAssetHash` 对**每一个输入**（doctrine / 任务 system / user）敏感 —— 任一被改 ⇒ 哈希必变 ⇒ 资产被换时重算值与 plan 级存的不一致，消费方可据此拒绝直送 | 合成 | `shot-prompt-task.test.js` |
| M-15 | **陈旧字段名回归锁**：实现代码（7 个文件）里 `sourceHash` / `blockedExport` **零出现**；同时现行名（`promptAssetHash` / `computePromptRenderHash` / `promptRenderHash` / `assetsIncomplete`）**确实在用**（防「一起删掉，锁成零命中」） | 合成 | 同上 |
| M-16 | **聚合提示按 reason 分流**：`methodologyNotDeliverable`（只剩 byDesign）**只说「人工补齐」**，不出现「缺失资产」「导入」；`methodologyNotDeliverableAssets`（有 assetMissing）**说「或补齐对应资产」** | 合成 | `film-engineering-methodology.test.js` |
| M-17 | **哈希域限定**：`promptAssetHash` 对 doctrine / system / user **每一个输入**敏感（任一被改 ⇒ 哈希变）；旧名 `assetHash` 在实现代码里**零残留**，同时现行名（`promptAssetHash` / `computePromptRenderHash` / `promptRenderHash` / `assetsIncomplete`）**确实在用** | 合成 | `shot-prompt-task.test.js` |
| M-18 | **截断前后两态**：`frameConstraint.hash`/`length` 取截断后文本、`originalHash`/`originalLength` 取截断前 ⇒ 截断点之后的改动**可检测** | 合成 | 同上 |
| M-19 | **kit 不可信的长度上限**：色盘行 / 角色描述超 20,000 字符 ⇒ **不提供该变量**（进 `promptMissing` ⇒ `deliverable=false`），**不静默截断**；未超限照常提供 | 合成 | 同上 |
| M-20 | **防空集通过**：旧名扫描断言里**被扫描文件数 > 0**（路径写错或列表为空时该判据会恒真） | 合成 | 同上 |
| M-21 | **逐镜清单体积有界**：`promptMissing` 里**7 个任务变量**的条目 ≤ 7（`templateVar` / `badVarName` / `oversizeVar` **另计**且总量有界）、每条只含 `name` + 枚举 `reason`、单镜**清单**序列化 ≤ **8 KiB**（8,192 字节，UTF-8） | 合成 | `auto-project.test.js` |
| M-22 | **生产路径 CI 恒跑**：①b 用**合成夹具**实现（不依赖 film-kit）⇒ `style_prefix` 恒 `byDesign` ⇒ 进清单 + `deliverable=false` + 占位符原样保留 | 合成 | `auto-plan.test.js` |
| M-23 | **不指向不存在的功能**：`methodologyAssetsIncomplete` 文案**不含「导入」**（产品里没有资产导入入口，那是 PR-3b），改为如实说明「缺什么 + 能力未接入」；W10/W11 同步 | 合成 | `film-engineering-methodology.test.js` |
| M-24 | **面板行标签互不相同**：方法论分区每一行的 `<dt>` 是**互不相同**的 key（此前三行复用了「任务模板」）；且每个行标签在 zh/en 都存在 | 合成 | 同上 |
| M-25 | **重开项目也可见**：服务端 `projectView` 用**同一个** `buildMethodologySummary` 从**落盘**的 `promptContext` + 逐镜 `promptMissing` 重新汇总 ⇒ `auto-status` 的项目投影里带 `methodology`；面板从**计算属性**读它（规划结果优先、其次项目投影） | 合成 | `film-engineering-auto.test.js` + `film-engineering-methodology.test.js` |
| M-26 | **逐镜字段长度上限**：`shot_json` 的 `title` / `characterNames` / `model` 超 2,000 字符 ⇒ **不提供** `shot_json`（进 `promptMissing`，reason=`oversizeVar` ⇒ `deliverable=false`），**不静默截断** | 合成 | `shot-prompt-task.test.js` |
| M-27 | **缺失分类判据**：`byDesign` = **产品里没有这个资产的形态**（不是「还没提供」）；`assetMissing` = **有资产形态但当前资产里没有** | 合成 | 同上 + 文档 |
| M-28 | **超长是独立一类**：超长的变量 reason = `oversizeVar`（**不是** `assetMissing`）⇒ 面板有独立文案 | 合成 | `shot-prompt-task.test.js` + `film-engineering-methodology.test.js` |
| M-29 | **三处计数同源**：本 PRD §8.b、方案简报、测试清单长度，出现的每一个「N 个 key / 编号 1-N / 清单条数 == N」的 N **必须都等于 27**；两份文档的 key 清单**逐条编号**都是 1..27；**分组数**也对得上（`doctrine` 7 + `auto.methodology*` 15 + `auto.methodologyReason*` 5 = 27） | 合成 | `film-engineering-methodology.test.js` |
| M-30 | **哈希的域分层**：截断点**之后**的改动 ⇒ `promptAssetHash`（完整 doctrine）**变**、`frameConstraint.hash`（截断后）**不变**、`frameConstraint.originalHash`（截断前）**变** | 合成 | `shot-prompt-task.test.js` |
| M-31 | **哈希的负向域**：改色盘 / 角色描述**不改** `promptAssetHash`（不在它的域里），改的是**逐镜** `promptRenderHash` | 合成 | 同上 |
| M-32 | **巡检断言有内容**：真实 kit 巡检除不变量外，还要断言**每条 `missing` 的 reason ∈ 闭集**、**reason 与渲染行为一致**（byDesign 保留占位符 / assetMissing 不留占位符）、**`deliverable` 与 `blockedVars` 长度与清单一致** | 真实 | 同上 |
| M-33 | **清单里的名字封顶**：`templateVar` / `badVarName` 的名字来自**不可信**的 kit 模板 ⇒ 落盘前截断到 **64 字符** | 合成 | `shot-prompt-task.test.js` |
| M-34 | **重开项目时校验资产**：服务端用**当前** kit 重算 `promptAssetHash`，与落盘值不一致 ⇒ `methodology.stale = true` ⇒ 面板显示**区块级**警告「资产已变」 | 合成 | `film-engineering-auto.test.js` + `film-engineering-methodology.test.js` |
| M-35 | **无任务库态**：缺 `promptLibrary` ⇒ `taskAvailable === false`、`deliverable === false`、`promptAssetHash` 仍按「doctrine + 空模板」算出（**不是**空串）、**不产出** `renderText` | 合成 | `auto-plan.test.js` + `shot-prompt-task.test.js` |
| M-36 | **`shot_json` 缺值逐字段**：`index`/`shotId`/`beatIndex` → `null`；`title`/`model` → 空串；`characterNames` → `[]` | 合成 | `shot-prompt-task.test.js` |
| M-37 | **单镜落盘体积**：单镜 `promptVars` + `promptMissing` 序列化 **≤ 256 KiB**；`promptMissing` 本身 **≤ 8 KiB**（8,192 字节，UTF-8）且**非任务条目 ≤ 8**（**实现里强制**，超出部分不落清单） | 合成 | `auto-project.test.js` |
| M-38 | **缺失态进哈希**：逐镜渲染哈希覆盖**缺失清单** ⇒ 「变量超限」与「变量没有」**不同哈希** | 合成 | 同上 |
| M-39 | **清单条目硬闸门**（条目数 + **字节数**两道）：模板要 100 个变量 ⇒ 清单仍被封住（任务变量 ≤ 7 + 非任务 ≤ 8，且序列化 ≤ 8 KiB），且 `deliverable` **仍为 false**（闸门不放行） | 合成 | 同上 |
| M-40 | **截断不切开代理对**：emoji 截断后长度**必为偶数**，两次截断**逐字相同** | 合成 | 同上 |
| M-41 | **验收编号连续**：简报 §四 验收表的条目编号按出现顺序**连续、无重号**（子项如 ①b 允许同号） | 合成 | `film-engineering-methodology.test.js` |
| M-42 | **无 kit 时逐镜不写方法论字段**：不传 kit ⇒ 逐镜**不出现** `promptVars` / `promptMissing` / `promptRenderHash` | 合成 | `auto-plan.test.js` |
| M-43 | **stale 与 assetsIncomplete 不并列**：`stale === true` ⇒ 面板**只显示**「资产已变」，不并列「资产不完整」（后者说的是**规划时**的事） | 合成 | `FilmAutoPanel.test.js` + `film-engineering-auto.test.js` |

### 9.c 资产导入（写路径）· 功能与验收（PR-3b · F-J）

> 方案与决策清单：`openspec/changes/film-pipeline-prompt-triple-and-guards/pr3b-import-design.md`；
> 逐轮评审证据：同目录 `pr3b-import-critiques.md`。
> ⚠ 本节是**写路径**（会整体替换用户当前资产）⇒ 与 §9.b（只读接线）**分节**，不合并。

#### 9.c.1 目标与范围

用户可以导入**自己的一份**完整影视工程资产包；导入后「自动」标签的规划基于**用户的资产**而非随包 min 版。

- **整体替换**，不做增量/合并/差分。
- 目标位置：`userData/film-kit`（与随包 `electron/film-kit` 同级，回退链首级）。
- 来源：**只有本机本地目录**（原生对话框选出来的）；压缩包 / 网络路径 / 扫盘一律不做。
- 本批**不做** `images/`（全仓无消费方 ⇒ 零价值却多一套校验面）；排除项清单写在 `SCHEMA.md`「文件清单」表。

#### 9.c.2 用户流程（七步，逐段可断言）

| 步 | 用户看到 | 系统做什么 | 失败时 |
|----|----------|------------|--------|
| 1 | 「项目案例」标签**顶部**的「导入我的影视工程资产」按钮 | — | 按钮不可用时（未登录）说明未授权 |
| 2 | **确认框**（说明「整体替换、不可撤销」） | 等用户点确认 | 用户点取消 ⇒ **不算失败**，无错误提示 |
| 3 | 操作系统**目录选择框** | 取 `filePaths[0]` | 取消 ⇒ `cancelled`；非目录 / UNC ⇒ 拒 |
| 4 | 「正在导入…」**不可中断模态** | 严格校验源目录 → 审计「开始」行 → 建锁 → 两遍扫描 + 拷贝（逐文件哈希对账）→ staging 再校验 | 失败 ⇒ 旧 kit **逐字未变** |
| 5 | 同上 | 清缓存 → 旧 kit 改名 `.bak-<时间戳>` → staging 改名 `film-kit`（同卷原子） | 换入失败 ⇒ 回滚；回滚也失败 ⇒ 保留 `.bak` 并给恢复路径（档位 `MISSING_KIT`，恢复动作 = **改名回来**） |
| 6 | 同上 | 删 `.bak` → 删锁 → 审计结果行 | 删 `.bak` / 删锁失败 ⇒ **导入已生效但有残留** ⇒ 档位 `BAK_LEFT` / `LOCK_LEFT` + 恢复路径（**成功信封也要带**） |
| 7 | 成功 toast / 失败 toast + 恢复指引告警 / **残留告警** / **审计不完整告警** | 刷新分镜库与状态 | 见 9.c.6 |

#### 9.c.3 数据校验（判据 → 触发 → 失败原因 → 用户看到什么）

| 判据 | 触发条件 | 失败原因（`reason`） | 用户看到 |
|------|----------|----------------------|----------|
| 必填齐备 | 缺 `film-manifest/shot-library/reference-registry/prompt-doctrine` 任一 | `VALIDATION_ERROR` | 「所选目录不符合资产要求」 |
| v7 增强齐备 | 缺 `shot-grammar/compliance-checklist/palette/prompts/tasks` 任一 | `VALIDATION_ERROR` | 同上 |
| 目录形状 | `prompts/tasks` 下**不是** 3 层（基准 `prompts/tasks`） | `VALIDATION_ERROR` | 同上 |
| 任务库非普通文件 | `prompts/tasks/**` 任一层出现软链 / 联接点 / 设备文件 | `SYMLINK_REJECTED` / `VALIDATION_ERROR` | 同上 |
| 隐藏名 | **候选路径**任一组件以 `.` 开头（`.`/`..` 枚举阶段先跳过） | `HIDDEN_NAME_REJECTED` | 同上 |
| 扩展名 | 根文件非 `.json`；`prompts/tasks/**` 非 `.md` | `EXT_NOT_ALLOWED` | 同上 |
| 软链 / 断链 | 白名单条目是软链，或软链指向不存在的目标 | `SYMLINK_REJECTED` | 同上 |
| 越界 | `realpath` 落在源目录之外 | `PATH_ESCAPE` | 同上 |
| 同目录硬链 | **同一目录内**两条目 `(dev, ino)` 相同（去重键带父目录） | `HARDLINK_REJECTED` | 同上 |
| 魔数 | `*.json` 头不是 `{`/`[`（去 BOM/空白） | `MAGIC_MISMATCH` | 同上 |
| 单文件体积 | > **32 MB** | `SIZE_EXCEEDED` | 同上 |
| 整包体积 | > **256 MB** | `SIZE_EXCEEDED` | 同上 |
| 源/目标重叠 | 源目录等于、包含或被包含于目标路径（`film-kit` / `.import-lock` / 审计文件 / `staging-*` / `.bak-*` **前缀目录**）；比较在 Windows 上**大小写不敏感** | `SOURCE_OVERLAPS_TARGET` | 同上 |
| 源不是目录 | 选中的不是目录 | `NOT_A_DIRECTORY` | 同上 |
| 目标不可写 | 父目录不可写 / 建 staging 失败 | `PARENT_NOT_WRITABLE` | 「目标目录不可写」 |
| 审计不可写 | 审计父目录不可写 / 追加失败 | `AUDIT_UNAVAILABLE` | 「审计日志不可写或已满」 |
| 审计超限 | 审计文件 > 10,000 行或 > 10 MB | `AUDIT_UNAVAILABLE` | 同上（附**手动轮转四步**） |
| 有导入在跑 | 锁存在且**租约有效**（mtime ≤ 60 秒） | `LOCK_HELD` | 「已有导入正在进行，或上一次导入的锁还没清理」 |
| 锁内容损坏 | 锁文件不是合法 JSON | `LOCK_HELD` | 同上（**不清锁**） |
| 残留未恢复 | 存在 `.bak-*` 且 `film-kit` **缺失** | `VALIDATION_ERROR` + `recoveryState=MISSING_KIT` | 「上次导入未完成（当前资产缺失）」+ 恢复路径 |
| 换入失败 | staging→`film-kit` 改名失败 | `SWAP_FAILED` | 「替换资产时出错（当前资产未受影响）」 |
| 回滚失败 | `.bak` 改名回 `film-kit` 也失败（⇒ `film-kit` 缺失、`.bak` = 旧 kit） | `ROLLBACK_FAILED` + `recoveryState=MISSING_KIT` | 「上次导入未完成（当前资产缺失）」+ **旧资产路径**（恢复动作 = **改名回来**，**不是**删除） |
| 残留 `.bak` 未删 | ⑥ 删 `.bak` 自身失败（⇒ 导入**已生效**） | — （成功路径） | 残留告警 + 「上次导入留下了备份目录 {path}，可安全删除」 |
| 锁未删 | ⑦ 删锁自身失败（⇒ 只剩锁） | — （成功路径） | 残留告警 + 「检查并手动删除锁文件：{path}」 |
| 审计结果行写失败 | 导入**已生效**，但审计结果行没落盘 | — （成功路径，`auditWritten=false`） | 「导入已生效，但审计结果行未能写入（审计不完整）」 |
| 来源未授权 | 子框架 / 路由前缀不匹配 / 协议不在白名单 | `UNAUTHORIZED_SENDER` | 「调用来源未授权」 |

**两条哈希对账（TOCTOU）**：① 第二遍拷出的**副本 SHA-256** == 第一遍记录的**源 SHA-256**；
② 拷贝完成后**再次 `stat` 源文件**，其 `(dev, ino, size, mtime)` 与第一遍记录一致 ⇒ 任一不符即拒。

**诚实边界（写进界面与文档）**：跨目录硬链在 FAT/exFAT/网络盘**检测不到**（`nlink` 恒为 1）⇒ 非防篡改边界
（⇒ 代码也**不拒**跨目录同 inode，只拒**同一目录内**的重复条目）；审计防「静默」不防恶意篡改；
组件级授权做不了（同文档承载三个标签页）。

**⛔ 删除纪律**：staging 与 `.bak` 的清理**一律**「精确清单逐个 `unlink` + 自底向上 `rmdir` 空目录」，
**禁止** `fs.rm(dir, {recursive:true})` 之类的递归删除原语（本仓 R0 铁律）⇒ 有一条**机械结构锁**盯着
（`kit-tree-clean.test.js` 的「R0 结构锁」用例：导入链路源文件里不得出现 `rm`/`rmdir` + `recursive`）。

#### 9.c.4 交互逻辑

| 元素 | 行为 |
|------|------|
| 入口按钮 | 「项目案例」标签顶部；**导入中禁用**；`filmEngineering.filmKitImport.entry` |
| 入口旁说明 | 一行灰字：`filmEngineering.filmKitImport.hint` |
| 确认框 | 点入口 ⇒ 弹；**必须用户点「确认」才继续**（注入脚本无法代点）；「取消」关闭且**不触发**导入 |
| 导入中模态 | **无关闭按钮 / 点遮罩不关 / ESC 不关 / 没有取消按钮**；文案「导入过程中不可中断，请勿关闭应用」 |
| 失败 toast | 「导入失败：{原因}」；原因按 6 个桶本地化（VALIDATION / LOCK / AUDIT / SWAP / PERM / UNAUTHORIZED） |
| 恢复指引告警 | 失败后**或成功但有残留时**在入口下方常驻 `el-alert`（warning，不自动关）：失败原因 + **可执行的恢复步骤**（按 `recoveryState` 选文案） |
| 成功 toast | 「导入完成（N 个文件）」并**自动刷新**分镜库 / 状态 / 方法论 |
| 残留告警 | 导入**已生效**但 `.bak` / 锁没删干净 ⇒ 额外一条 warning toast（标题 `filmEngineering.filmKitImport.residue`），正文复用对应恢复指引文案 |
| 审计不完整告警 | 导入已生效但审计结果行没落盘 ⇒ 一条 warning toast（`filmEngineering.filmKitImport.auditLost`） |
| 取消 | **不算失败**：无错误提示、无告警 |

#### 9.c.5 显示项

| 显示项 | 来源 | 备注 |
|--------|------|------|
| 导入入口按钮 | 渲染端 | 位于「项目案例」标签顶部（`FilmEngineeringView.vue`），**不在**「自动」标签（那是只读规划区） |
| 入口说明文字 | 渲染端 | 一行灰字，说明「整体替换，不是合并」 |
| 确认框 | 渲染端 | 标题 + 正文 + 取消/确认两按钮 |
| 导入中模态 | 渲染端 | 标题 + 「勿关闭应用」提示；**无取消** |
| 失败 toast | 主进程错误信封 → 渲染端本地化 | `errorCode` = `reason` 闭集值 |
| 恢复指引告警 | 主进程回传 `recoveryState` + `recoveryPath` | 按档位选文案（**成功信封也可能带**） |
| 成功 toast（含文件数） | 主进程回传 `fileCount` | — |
| 审计完整性标记 | 主进程回传 `auditWritten` | `false` ⇒ 追加一条「审计不完整」告警 |
| 导入后的分镜库 / 状态 | 服务端缓存失效后重读 | 导入成功后自动刷新 |

#### 9.c.6 提示文字全量（`filmEngineering.filmKitImport.*`，zh/en 成对，**22 键**）

| 键 | zh | en |
|----|----|----|
| `entry` | 导入我的影视工程资产 | Import my film engineering assets |
| `hint` | 用你自己的资产包替换当前影视工程资产（整体替换，不是合并） | Replace the current film engineering assets with your own asset package (wholesale, not merged) |
| `confirmTitle` | 确认导入影视工程资产 | Confirm asset import |
| `confirm` | 导入将整体替换当前的影视工程资产（分镜库 / 提示词方法论 / 任务库），旧资产不可自动找回。要继续吗？ | Importing replaces the current film engineering assets (shot library / prompt doctrine / task library) as a whole; the old ones cannot be restored automatically. Continue? |
| `importing` | 正在导入… | Importing… |
| `importingHint` | 导入过程中不可中断，请勿关闭应用。若应用被强制关闭，下次导入会自动清理残留锁。 | The import cannot be interrupted — please do not close the app. If the app is force-quit, the next import will clean up the leftover lock automatically. |
| `success` | 导入完成（{count} 个文件） | Import finished ({count} files) |
| `failed` | 导入失败：{reason} | Import failed: {reason} |
| `cancelled` | 已取消导入 | Import cancelled |
| `recover` | 导入回滚失败，旧资产在 {path}，请手动恢复 | Import rollback failed; the old assets are at {path} — please restore them manually |
| `recoverLock` | 存在未完成的导入。若确认当前没有导入在进行，请检查并手动删除锁文件：{path} | An unfinished import is present. If no import is running, check and delete the lock file manually: {path} |
| `recoverMissing` | 上次导入未完成（当前资产缺失）。请把备份目录 {path} 手动改回 film-kit 后再试 | The last import did not finish (current assets are missing). Rename the backup directory {path} back to film-kit, then retry |
| `recoverBak` | 上次导入留下了备份目录 {path}，可安全删除 | The last import left a backup directory {path} — it is safe to delete |
| `residue` | 导入已生效，但有残留需要你手动清理 | The import took effect, but there is leftover residue for you to clean up manually |
| `auditLost` | 导入已生效，但审计结果行未能写入（审计不完整）。请检查磁盘空间与目录权限 | The import took effect, but the audit result row could not be written (audit is incomplete). Please check disk space and directory permissions |
| `auditFull` | 审计日志已满，请手动轮转：把 film-kit-import.log 改名为带时间戳的备份，再新建同名空文件 | The audit log is full; please rotate it manually: rename film-kit-import.log to a timestamped backup and create a new empty file with the same name |
| `reason.VALIDATION` | 所选目录不符合资产要求 | the selected directory does not meet the asset requirements |
| `reason.LOCK` | 已有导入正在进行，或上一次导入的锁还没清理 | an import is already running, or the previous import's lock was not cleaned up |
| `reason.AUDIT` | 审计日志不可写或已满 | the audit log is not writable or is full |
| `reason.SWAP` | 替换资产时出错（当前资产未受影响） | something went wrong while replacing the assets (current assets are unaffected) |
| `reason.PERM` | 目标目录不可写 | the target directory is not writable |
| `reason.UNAUTHORIZED` | 调用来源未授权 | the caller is not authorized |

（「确认 / 取消」两按钮复用 `common.confirm` / `common.cancel`，不另计键。）

#### 9.c.7 验收判据（26 条 + 验证层外部评审新增 10 条 = **36 条**）

**A 组（4 条，原 `tasks.md`）**：① 严格模式校验失败 ⇒ 不落盘；② 成功 ⇒ `userData/film-kit` 齐备 + service 缓存已失效；③ 含符号链接 ⇒ 拒；④ 换入中途失败 ⇒ 无半份 kit、旧 kit 逐字未变。

**B 组（17 条）**：⑤ 白名单外文件不被拷入（且不递归进入其子目录）；⑥ 超限 ⇒ 拒且未开始拷；⑦ 没写到 staging/.bak/.import-lock/审计文件 之外；⑧ 换入失败后旧 kit 逐字未变；⑨ 相对路径越界或绝对路径 ⇒ 拒、没写到 staging 之外；⑩ 硬链接 ⇒ 拒（同目录 `(dev,ino)` 相同 ⇒ 拒；跨目录靠 `nlink>1` ⇒ 最佳努力，不构成防篡改保证）；⑪ 隐藏名（含目录名）或 `prompts/tasks/` 深度不符 ⇒ 拒；⑫ 回滚本身失败 ⇒ `.bak` 仍在 + 报错带出恢复路径；⑬ 导入中 `_ensureKit()` 抛可识别错误、不读盘，标记先置后删且 `.import-lock` 同生命周期；⑭ 代码白名单集合 == `SCHEMA.md` 文件清单表**标 ✅ 行**解析集合（排序后逐行 `===`）；⑮ `.json` 魔数不匹配 ⇒ 拒且不写盘；⑯ 父目录不可写或锁文件建不出来 ⇒ 立即退出、旧 kit 逐字未动；⑰ 存在 `.import-lock` ⇒ service 抛可识别错误、导入也拒绝（**不自动清锁**）⇒ 恢复靠手动删锁；⑱ `images/` 不在导入白名单 ⇒ 目标目录里**没有** `images/`（镜像表里也没有 `images/*` 行）；⑲ 可选资产缺失（`prompt-doctrine.zh.md` 不存在）⇒ 导入照常成功；⑳ sender URL 与其 hash 路由段写入审计行（**不作为拒绝依据**）；㉑ 两条对账同时成立（副本哈希 == 源哈希；拷贝后源文件 `(dev,ino,size,mtime)` 未变）⇒ 任一不符即拒。

**C 组（2 条，契约/镜像）**：㉒ `kit-mirror-check.test.js`：代码白名单 == `SCHEMA.md` 标 ✅ 行（归一化 + 字典序后逐行 `===`），且 `images/` 落在**排除项清单**；㉓ `kit-schema-contract.test.js`：`SCHEMA.md`「导入契约」小节存在且**非空**（审计字段 / reason 枚举 / 恢复档位 / 取舍），小节缺失 ⇒ **失败不跳过**。

**win32 专项（3 条）**：① 硬链判定的**可断言部分**：同目录 `(dev,ino)` 相同 ⇒ 拒（**不断言 `nlink>1`**，该维度已声明无判据）⇒ 改为断言审计字段 `hardlink_check=best-effort`；② NTFS 的 `.` / `..` **不得**被当成合法目录项（`basename === "." || basename === ".."` ⇒ 枚举阶段跳过且**不计入层数**）；③ `ERROR_ACCESS_DENIED` 的重试分级：A 类（`copyFile`）套指数退避、B 类（目录 `rename`）只做一次立即重试、审计追加**不重试**。

**D 组（10 条 · 2026-10-23 验证层**双家族**外部评审命中后新增）**：
① **写路径不得登记为 public**：`filmEngineering.importKit` 不在 `PUBLIC_METHODS` 内（未登录不可用），主进程侧 `film-engineering:import-kit` 同样非 public —— claude i1 / codex i1（**两家独立命中**）；
② **禁止递归删除原语**：导入链路源文件里不得出现 `rm`/`rmSync`/`rmdir` + `recursive`（R0 **机械结构锁**）—— codex i2 命中初版 `.bak` 的 `rm(recursive:true)`；
③ 审计**写失败**时行数**不**递增（`lineCount` 与已落盘行一一对应）—— claude i2 / codex i7；
④ 删 `.bak` 失败 ⇒ 导入**仍生效**，但成功信封必须带 `recoveryState=BAK_LEFT` + 恢复路径 —— claude i3 / codex i6；
⑤ 删锁失败 ⇒ 成功信封必须带 `recoveryState=LOCK_LEFT` + 锁路径；
⑥ **回滚失败 ⇒ 档位是 `MISSING_KIT`（不是 `BAK_LEFT`）** —— 两者互换会让用户**删掉旧资产仅存的一份**（数据丢失级误导）；
⑦ 审计**结果行**写失败 ⇒ 成功信封带 `auditWritten=false`，渲染端给出「审计不完整」告警（**不得静默**）—— codex i3；
⑧ 源目录 = `film-kit.staging-*` / `film-kit.bak-*` 残留目录 ⇒ 拒（`SOURCE_OVERLAPS_TARGET`）—— codex i5（初版这条判据**是死的**）；重叠比较在 Windows 上**大小写不敏感**；
⑨ 跨目录同 inode **不拒**（去重键带父目录），**同目录**同 inode 仍拒 —— claude i5；任务库层级不符 / 非普通文件**拒**（不静默跳过）—— codex i8；
⑩ 早退路径（未授权 / 对话框不可用 / 对话框失败 / 用户取消 / 所选路径非法）**各留一行审计**（`reason` 落在 18 值闭集内）—— codex i4。

#### 9.c.8 明确不做

❌ 增量/合并/差分（整体替换）· ❌ 导入历史/多版本 · ❌ 导出 · ❌ 压缩包/网络来源/扫盘 ·
❌ 写 kit 之外的路径 · ❌ 导入 `images/` · ❌ `images-manifest.json` 契约 ·
❌ 自动清理陈旧锁（只按**进程存活**判定）· ❌ 窗口级/组件级授权 · ❌ 磁盘空间预检（失败形态已知且安全）。

## 十、明确不做

见 OpenSpec `proposal.md` §六（D-1 ~ D-13）。本 PRD 不重复列举，只强调三条最容易被误认为"漏做"的：

1. **不做 VLM 质检**：本仓 `adapters/_base/base.js` 无任何视觉方法，且自动重试会绕过被测试锁死的成本闸。
2. **不做 Scene 视角变体**：`viewpointId` 无消费方 ⇒ 死代码。
3. **不做音频三件套**：打包 ffmpeg 滤镜白名单仅 11 个（`apps/desktop/scripts/stage-media-tools.js:10-22`），引入 `tpad`/`loudnorm` 须改 `media-tools-lock.json` + 重打包实测 ⇒ 混合 PR。

---

## 十一、风险与已知限制

| 风险 | 影响 | 缓解 |
|------|------|------|
| 三分后 `prompt` 与 `imagePrompt` 在存量数据上同值 | 冗余 | 靠归一化消除分支而非消除字段；`prompt` 保留不删 |
| ~~合计上限 50000 可能把合法资产判死~~ | 新 kit 导入失败 | **已消解**：该判据与单字段上限同值 ⇒ 永不触发，且会误杀三段各自顶格的合法资产，已删除（验证层评审 i4）；现由单字段上限 + 类型校验把关，最长现有单镜 39,468 字符 ⇒ 余量充足 |
| 就绪度判据过严 → "永远不就绪" | 用户无法出片 | 只取"必然失败"项；每条 `reason` 给可操作文案；`SHOT_LOCKED` 不阻断单镜重生成 |
| 出站合同改造影响既有原片下载 | 回归 | `shot-downloader` 既有 23 例必须全绿；重构只改实现位置不改可观察行为 |
| IP pinning 需改 `shot-downloader` 现有解析逻辑 | 回归面扩大 | pinning 是**增强**（连接用已校验 IP），既有断言不应变化；新增 V-11 专测 |
| 乐观锁在单写路径误报冲突 | 自动模式跑不起来 | `expectedRevision` 缺省即不比对；单会话串行写不产生冲突 |
| 锚点硬上限 4 条截掉重要角色 | 多人同框仍串脸 | 截断显式标记 + 被截角色名回传，供用户知情 |
| **外置提示词的完整性** | 运行时提示词可能被篡改 | 随包 `asar` 内资产由打包链路保证；用户导入目录由用户自持；**不采用"应用内哈希清单"**（与提示词同仓同包，能改其一就能改其二，不构成安全措施） |
| 尾帧提示词短期无消费 | 字段只写不读 | 消费路径与三项前置已写明并排期（provider 参考图支持 / 该镜已绑参考图 / 公网图床 F28） |
