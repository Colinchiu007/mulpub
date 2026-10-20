# PRD：影视工程五条功能缺陷修复（2026-10-19）

> **变更标识**：`fix-film-engineering-defects`
> **取证基线**：`main@bd73e4d53`
> **严重度分布**：CRITICAL ×1、MAJOR ×2、MINOR ×2
> **关联文档**：
> - [BUGFIX-FILM-ENGINEERING-FINDINGS-2026-10-19.md](./BUGFIX-FILM-ENGINEERING-FINDINGS-2026-10-19.md)（根因溯源 + 逃逸链 + 回归保护方案）
> - [USER-MANUAL-FILM-ENGINEERING-COMPLETE-2026-10-19.md](./USER-MANUAL-FILM-ENGINEERING-COMPLETE-2026-10-19.md)（完整使用手册，同步修订）
> - `openspec/specs/film-engineering/spec.md`（既有规格）

---

## 一、背景与目标

2026-10-19 编写《影视工程流水线完整使用手册》时，对四个模块做代码取证，发现 5 处「文档/预期」与「代码实际行为」不一致的缺陷。其中 1 处影响用户主要功能预期（复制模式退化），2 处导致用户可见的错误信息或界面文本不正确。

**目标**：修复 5 条缺陷，并为每条补上**能反向锁住退化**的回归测试——重点不是「补测试」，而是补**既有测试拦不住的那一类**断言。

**非目标**：不重构影视工程架构，不改动 kit 数据资产，不新增功能。

---

## 二、缺陷清单与修复方案

### 缺陷 1【CRITICAL】一键复制 `blocks`/`characters`/`geo` 模式在真实数据上退化

#### 2.1.1 现象

分镜详情抽屉提供四种复制模式。实测（用主进程同一套切块逻辑跑真实 kit 的 153 个分镜）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 能切出任意块的分镜 | **3 / 153（2.0%）** | **66 / 153（43.1%）** |
| `GEO SPATIAL LAYOUT` 命中 | **0** | 1 |
| `AUDIO` 命中 | 3 | 71 |
| `SCENE CONTEXT` 命中 | 0（未识别该块） | 26 |
| `STYLE` 命中 | 0（未识别该块） | 38 |

点「复制 GEO 布局」几乎恒得到「（无 GEO SPATIAL LAYOUT 块）」，点「复制角色行」恒得到「（无角色行）」。`full` 模式不受影响。

#### 2.1.2 根因

**两处叠加**：

1. **切块判定用整行精确比较**（`shot-library.js:40` 原实现 `BLOCK_HEADINGS.includes(line.toUpperCase())`）。真实提示词的块标题**带括号后缀与结尾冒号**，例如：
   ```
   GEO SPATIAL LAYOUT (locked across every CO shot — pure spatial map):
   ```
   与纯标题 `'GEO SPATIAL LAYOUT'` 不相等 ⇒ 判不出来。
2. **`BLOCK_HEADINGS` 只有 5 项**，缺 `SCENE CONTEXT` 与 `STYLE`（方法论标签页展示 7 块）。即便匹配修好，这两个块也永远切不出。

**引入点**：`git log -L 16,22` → `a3a93913`（2026-08-15，PR「影视工程流水线《Hell Grind》复刻」）。该 commit 中 `shot-library.js` 为**新增文件**，此逻辑自诞生起即如此，**非后续回归**。

#### 2.1.3 修复方案

**（a）块标题集合补齐为 7 项**，与方法论同源：
```js
const BLOCK_HEADINGS = [
  'SCENE CONTEXT', 'GEO SPATIAL LAYOUT', 'ACTION TIMING', 'AUDIO',
  'CHARACTER ACTING', 'STYLE', 'POSITIVE CONSTRAINTS',
]
```

**（b）判定改为行首前缀匹配，正则从 `BLOCK_HEADINGS` 单一真源生成**：
```js
function buildBlockHeadingRe (headings) {
  const body = headings.slice()
    .sort((a, b) => b.length - a.length)      // 长标题优先，避免 AUDIO 抢在 AUDIO X 前匹配
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return new RegExp('^[ \\t]*(' + body + ')\\b[ \\t]*(?::|—|-|\\(|$)', 'i')
}
const BLOCK_HEADING_RE = buildBlockHeadingRe(BLOCK_HEADINGS)

/** 从任意形态的标题行还原规范化标题（大写、去后缀） */
function canonicalHeading (line) { ... }
```

**匹配规则（数据校验口径）**：

| 形态 | 是否识别为块标题 | 说明 |
|---|---|---|
| `GEO SPATIAL LAYOUT` | ✅ | 纯标题 |
| `GEO SPATIAL LAYOUT (locked ...):` | ✅ | 带括号后缀 + 冒号 |
| `ACTION TIMING:` | ✅ | 带结尾冒号 |
| `  geo spatial layout :` | ✅ | 前导空白 + 小写 + 冒号 |
| `Roko says: the AUDIO in this scene` | ❌ | **行中出现的标题字样不误判** |
| `AUDIOX` | ❌ | `\b` 词边界，不匹配更长单词 |

**（c）`extractBlocks` 改用 `canonicalHeading`**，标题输出规范化为大写纯标题（保证 `blocks` 模式输出稳定）。

**（d）补导出** `extractCharacterLines`、`extractGeoBlock`（原未导出，测试无法直接验证）。

#### 2.1.4 回归保护测试

**文件**：`apps/desktop/electron/services/film-engineering/shot-library.real-kit.test.js`（新建，9 条）

**为什么既有测试拦不住**：`shot-library.test.js` 的 blocks/characters/geo 三个用例用的是**自造的理想化夹具**（块标题就是纯 `GEO SPATIAL LAYOUT`）。那种夹具在「整行精确比较」和「行首前缀匹配」两种实现下**都会通过**——它测的是算法意图，不是算法对真实输入的有效性。改实现后它们仍全绿，所以必须新写断言。

**新断言锚定真实语料**：
- 形态锁：带括号后缀 / 小写 / 前导空白 / 结尾冒号的标题必须识别；行中字样不得误判
- 统计锁：真实 kit 上带内容的 GEO 块命中数 **> 0**；切块率 **> 10%**
- 同源锁：`BLOCK_HEADINGS` 必须等于 `prompt-doctrine.json` 的块标签集合（防 5/7 漂移）
- 行为锁：角色行提取、无块时回退全文

---

### 缺陷 2【MAJOR】自动模式进度阶段名显示英文 id

#### 2.2.1 现象

自动模式进度区三行阶段名显示为 `film_auto_plan` / `film_auto_generate` / `film_auto_render`。旁边状态标签（已完成/运行中/等待中）是正常中文，唯独阶段名是英文。

#### 2.2.2 根因

阶段名定义在 `useFilmAutoRun.js:52,54,59`。`StageProgress.vue:117-119` 调 `getPipelineStage(t, name)` 查 `src/i18n/pipeline-labels.js` 的 STAGES 表，**这三个 id 未登记**（grep 确认零命中），`translate()` 走 fallback 返回原始 id（`pipeline-labels.js:203-210`）。

**引入点**：`git log -S 'film_auto_generate'` → `b3ee1579`（2026-10-10，PR #3234「三标签重组 + 自动模式」）。新增自动模式时只定义阶段 id，**忘了登记翻译**。

#### 2.2.3 修复方案

在 STAGES 表补三条，并在 `locales/pipelines/{zh,en}.js` 补成对文案（**用词与自动模式步骤条 `zh.js:46-49` 保持一致**）：

| key | zh | en |
|---|---|---|
| `film_auto_plan` | 分镜规划 | Shot Planning |
| `film_auto_generate` | 逐镜生成 | Shot Generation |
| `film_auto_render` | 收口合成 | Final Composition |

#### 2.2.4 回归保护测试

**文件**：`apps/desktop/src/i18n/pipeline-labels.stage-coverage.test.js`（新建，3 条）

**为什么既有门禁拦不住**：三道文案门禁（`check-locale-sync` 成对、渲染端硬编码中文扫描、i18n-glossary）**都只管字面量中文**，管不到「代码生成的动态 key」是否登记。属结构性盲区。

**新断言（通用锁，防未来任何新流水线漏登记）**：
1. STAGES 表登记的 key 必须在 zh/en 两侧都有文案
2. 源码里出现的阶段 id 字面量（`film_auto_*`）必须全部登记
3. 本缺陷的三个 id 直接断言已登记且两侧有文案

---

### 缺陷 3【MAJOR】画布所有失败都归因为「影视引擎不可用」

#### 2.3.1 现象

画布点「生成所选」失败时，除「超过 10 镜」「未选分镜」外，**其余全部**弹同一条：

> 影视引擎不可用

**真实原因可能是没配视频模型**，但用户看到「引擎不可用」会以为安装坏了，不会去配模型。

#### 2.3.2 根因

**两处叠加**：

1. **视图层兜底过宽**（`FilmCanvasView.vue:115-117`）：`else` 分支吞掉所有其他原因。
2. **composable 丢弃真实 errorCode**（`useFilmVideoGen.js:165-170`）：第 166 行确实捕捉了 `res.errorCode`，但第 169 行**恒返回硬编码 `'startFailed'`**，导致调用方拿不到真实原因，无法分流。

精准文案其实**已存在**于 locales 但画布未引用：`filmEngineering.video.noModel`。对比：经典视图/全量出片面板**有**精准分流与「前往模型设置」按钮（`FilmEngineeringView.vue:385,440,443`）——说明是画布视图的实现疏漏，非全局设计。

**引入点**：`git log -S 'engineUnavailable'` → `15ad0e16`（2026-09-24，PR #2342「短剧画布替换三栏 UI」）。画布是新写的视图，错误分支照抄了 kit 不可用那一条。

#### 2.3.3 修复方案

**（a）`useFilmVideoGen.start` 如实透传 errorCode**：
```js
return { ok: false, errorCode: errorCode.value || 'startFailed', error: errorText.value }
```

**（b）视图按 errorCode 分流**：

| errorCode | 提示文案 | 用户动作 |
|---|---|---|
| `tooManyShots` | `video.tooManyShots`（单批最多 {max} 个分镜…） | 减少选择 |
| `noShots` | `canvas.generate.none`（请先选择要生成的分镜节点） | 选分镜 |
| **`VIDEO_MODEL_NOT_CONFIGURED`** | **`video.noModel`（尚未配置默认视频模型…）** | **去配模型** |
| `FILM_KIT_UNAVAILABLE` | `canvas.engineUnavailable`（影视引擎不可用） | 检查安装 |
| 其余 | `canvas.engineUnavailable` 兜底（不吞掉、不静默） | — |

#### 2.3.4 回归保护测试

**文件**：`apps/desktop/src/views/FilmCanvasView.actions.test.js`（扩展 3 条）
- `VIDEO_MODEL_NOT_CONFIGURED` → 必须显示 `video.noModel`，且**不得**显示 `engineUnavailable`
- `FILM_KIT_UNAVAILABLE` → 仍归因为 `engineUnavailable`
- 未识别错误码 → 仍落兜底

---

### 缺陷 4【MINOR】画布「已注入 N 张参考」提示永不显示

#### 2.4.1 现象

`ShotNode.vue:46` 渲染「已注入 {n} 张参考」，文案存在（`zh.js:209`）。但**全仓没有任何代码写入 `refCount` 字段**（grep 仅命中渲染处）。连线成功后用户看不到任何视觉反馈。

#### 2.4.2 根因

参考图注入的实际数据流：`collectShotReferences` → `buildLocalReferences` → 随 `initialContext` 发给引擎。这条链路**不回写节点 `data.refCount`**——渲染侧期望的字段与写入侧的通道未接上。

**引入点**：`15ad0e16`（2026-09-24，同 PR #2342）。组件写了展示逻辑，但落边时未同步更新目标节点。

#### 2.4.3 修复方案

在 `useFilmCanvas.js` 新增 `recomputeRefCount(shotNodeId)`，**真源仍是 `collectShotReferences`**（与实际参与生成的参考同源，不引入第二套计数）：

```js
function recomputeRefCount (shotNodeId) {
  const node = nodeById(shotNodeId)
  if (!node || node.type !== 'shot') return
  const refs = collectShotReferences(shotNodeId, nodes.value, edges.value)
  const count = refs.character.length + refs.scene.length
  if (node.data.refCount === count) return
  nodes.value = nodes.value.map((n) => (
    n.id === shotNodeId ? { ...n, data: { ...n.data, refCount: count } } : n
  ))
}
```

**调用点**：
- `addEdge` 落边成功后 → `recomputeRefCount(connection.target)`
- `removeNodes` 删节点/边后 → 对**受影响的**分镜节点重算（先收集 affected，删完再重算，避免读到已被过滤掉的边）

#### 2.4.4 回归保护测试

**文件**：`apps/desktop/src/views/FilmCanvasView.actions.test.js`（扩展 2 条）
- 连一条人物参考到分镜 → 该节点 `refCount === 1`
- 删掉该连线 → `refCount` 回到 0（不留残留计数）

---

### 缺陷 5【MINOR】方法论 7 块 vs 切块 5 块口径不一致

方法论标签页展示 7 块（`prompt-doctrine.json`），但 `BLOCK_HEADINGS` 只有 5 项。

**修复**：随缺陷 1 的方案（a）补齐为 7 项，并由**同源锁测试**机械保证两处不再漂移（断言 `BLOCK_HEADINGS` 集合 === `prompt-doctrine.json` 的 blocks 标签集合）。

---

## 三、交互与显示项变更汇总

| # | 位置 | 变更前 | 变更后 |
|---|---|---|---|
| 1 | 分镜详情抽屉 · 复制提示词块 | 多数分镜返回空块/占位 | 43% 分镜可正常切块，含 SCENE CONTEXT / STYLE |
| 2 | 分镜详情抽屉 · 复制 GEO 布局 | 恒「（无 GEO SPATIAL LAYOUT 块）」 | 命中分镜返回真实 GEO 内容 |
| 3 | 自动模式进度区 · 三行阶段名 | `film_auto_plan` 等英文 id | 分镜规划 / 逐镜生成 / 收口合成 |
| 4 | 画布 · 生成失败提示 | 一律「影视引擎不可用」 | 未配模型 → 「尚未配置默认视频模型…」 |
| 5 | 画布 · 分镜节点 | 连线后无任何反馈 | 显示「已注入 {n} 张参考」 |

---

## 四、数据校验口径

| 项 | 校验规则 | 位置 |
|---|---|---|
| 块标题识别 | 行首 + 标题 + 可选后缀（`:` `—` `-` `(` 或行尾）；大小写不敏感；`\b` 词边界 | `shot-library.js` `BLOCK_HEADING_RE` |
| 块标题集合 | 必须等于 `prompt-doctrine.json` 的 `blocks[].label`（7 项） | 同源锁测试 |
| locale 成对 | zh/en 必须成对，Gate 7 `check-locale-sync` | CI |
| errorCode 透传 | `start()` 失败时必须返回服务端原始 errorCode，不得硬编码覆盖 | `useFilmVideoGen.js` |
| refCount | 由 `collectShotReferences` 派生，与实际参与生成的参考同源 | `useFilmCanvas.js` |

---

## 五、测试与验收

| 文件 | 类型 | 条数 | 状态 |
|---|---|---|---|
| `shot-library.real-kit.test.js` | 单元（真实语料） | 9 | ✅ |
| `pipeline-labels.stage-coverage.test.js` | 单元（全仓扫描） | 3 | ✅ |
| `FilmCanvasView.actions.test.js` | 组件集成 | +5（共 14） | ✅ |
| `shot-library.test.js`（既有） | 单元 | 20 | ✅ 无回归 |
| `useFilmCanvas` / `film-canvas-model` / `FilmCanvasView` / `useFilmVideoGen` | 单元+组件 | 41 | ✅ 无回归 |
| ESLint | 静态 | — | ✅ exit 0 |
| locale 成对（Gate 7） | 静态 | — | ✅ PASS |

**验收标准**：
1. 五条缺陷按上表修复，回归测试全绿
2. 既有测试无回归
3. 真实 kit 切块率从 2.0% 提升到 43.1%（可复现实测）
4. 自动模式阶段名显示中文
5. 画布未配模型时提示精准文案

---

## 六、预防措施（系统性漏洞堵法）

| # | 系统性漏洞 | 堵法（已落地） |
|---|---|---|
| S1 | **夹具理想化**：测试用符合实现的假数据，测不出实现与真实数据的错配 | `shot-library.real-kit.test.js` 用真实语料断言统计特征 |
| S2 | **动态 i18n key 无登记完整性检查**：三道文案门禁只管字面量 | `pipeline-labels.stage-coverage.test.js` 全仓扫描阶段 key 差集 |
| S3 | **错误兜底分支无场景覆盖**：`else` 吃掉所有未枚举原因 | 对兜底分支补「非枚举原因」用例断言不误报 |
| S4 | **跨文件字段生产/消费无配对核对** | 对 `refCount` 补写入端单测 |

**Code Review 清单新增两问**（写入 `01-docs/learnings.md`）：
1. 这段逻辑有没有用**真实数据**跑过？测试夹具是不是照着实现写的？
2. 新增的动态 i18n key 登记进翻译表了吗？
