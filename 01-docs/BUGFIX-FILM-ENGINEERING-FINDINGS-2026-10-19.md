# 影视工程（film-engineering）功能缺陷清单

> **发现方式**：2026-10-19 编写《影视工程流水线完整使用手册》时的代码取证
> **取证基线**：`main@bd73e4d53`
> **处置流程**：按 `AGENTS.md`「Bug 处理 SOP」五步执行（根因溯源 → 逃逸分析 → 系统性漏洞定位 → 修复+回归保护 → 预防措施）
> **本文档性质**：**只做根因溯源、逃逸分析与修复方案，未改任何运行时代码**（缺陷 1、3、4 涉及运行时行为，需走 worktree 隔离 + 质量节拍；缺陷 5 为纯文档口径，可走 docs-only 通道）

---

## 缺陷总览

| # | 缺陷 | 严重度 | 影响 | 引入 commit | 根因类型 |
|---|---|---|---|---|---|
| 1 | 一键复制 `geo`/`characters`/`blocks` 模式在真实数据上退化 | 🔴 CRITICAL | 三个按钮基本无输出 | `a3a93913` (2026-08-15) | 实现与真实数据形态不匹配 |
| 2 | 自动模式进度阶段名显示英文 id | 🟠 MAJOR | 界面显示 `film_auto_plan` 等英文 | `b3ee1579` (2026-10-10) | 国际化登记遗漏 |
| 3 | 画布所有失败都归因为「影视引擎不可用」 | 🟠 MAJOR | provider 未配置被误报 | `15ad0e16` (2026-09-24) | 错误分支兜底过宽 |
| 4 | 画布「已注入 N 张参考」提示永不显示 | 🟢 MINOR | 连线成功无视觉反馈 | `15ad0e16` (2026-09-24) | 字段只渲染不写入 |
| 5 | 方法论 7 块 vs 切块 5 块口径不一致 | 🟢 MINOR | 文档与实际不符 | `a3a93913` (2026-08-15) | 两处硬编码未同源 |

---

## 缺陷 1 【CRITICAL】一键复制后三种模式在真实数据上退化

### 1.1 现象

分镜详情抽屉提供四种复制模式：`full`（完整提示词）、`blocks`（提示词块）、`characters`（角色行）、`geo`（GEO 布局）。

实测（用主进程同一套切块逻辑跑真实 kit 的 153 个分镜）：

| 指标 | 命中数 / 总数 |
|---|---|
| 能切出任意块的分镜 | **3 / 153** |
| `GEO SPATIAL LAYOUT` 精确命中 | **0 / 153** |
| 含 `[CHARACTER:` 行 | **0 / 153** |

即：点「复制 GEO 布局」几乎恒得到「（无 GEO SPATIAL LAYOUT 块）」，点「复制角色行」恒得到「（无角色行）」。`full` 模式不受影响，正常工作。

### 1.2 根因溯源（第一性原因）

**切块判定用的是整行精确比较**：

```js
// apps/desktop/electron/services/film-engineering/shot-library.js:38-45
for (const rawLine of lines) {
  const line = rawLine.trim()
  if (BLOCK_HEADINGS.includes(line.toUpperCase())) {   // ← 整行精确相等才认
```

而**真实提示词里的块标题带后缀/修饰**，不是纯标题。实测样本中的实际标题形如：

```
GEO SPATIAL LAYOUT (locked across every CO shot — pure spatial map):
```

带括号说明与结尾冒号，与 `BLOCK_HEADINGS` 中的 `'GEO SPATIAL LAYOUT'` 不相等 ⇒ 判不出来。

`BLOCK_HEADINGS` 只有 5 项（`shot-library.js:16-22`），且**引入时即为如此**，从未针对真实语料校准。

**引入点**：`git log -L 16,22` 定位到 `a3a93913ed117ee6955fcaf8ffea31064ce29067`（2026-08-15，PR「影视工程流水线《Hell Grind》复刻」，该 commit 中 `shot-library.js` 为新增文件，此逻辑**自诞生起即如此**，非后续回归）

### 1.3 逃逸分析（为什么测试没拦住）

逃逸链逐层：

| 层 | 是否拦住 | 为什么没拦住 |
|---|---|---|
| 单元测试 | ❌ | `shot-library.test.js:148/159/167` 三个用例（blocks/characters/geo）用的都是**自造的理想化夹具**——提示词是测试作者手写的干净文本，块标题就是纯 `GEO SPATIAL LAYOUT`。**从未用真实 kit 的提示词跑过** |
| 集成测试 | ❌ | 无「复制模式 × 真实 kit 数据」的组合用例 |
| 端到端 | ❌ | 复制功能无 E2E 覆盖 |
| 视觉回归 | ❌ | 复制产出的是剪贴板文本，不产生可截图状态，视觉门禁天然盲区 |
| 代码审查 | ❌ | 审查时看到「按块标题切分」的**意图**正确，未验证**真实语料**是否匹配 |

**系统性漏洞定位**：**测试场景缺失**——测试只覆盖「算法逻辑正确」，未覆盖「算法对真实输入有效」。这是典型的「夹具理想化」盲区：用符合实现的假数据测实现，永远测不出实现与真实数据的错配。

### 1.4 修复方案

**方案 A（推荐，最小改动 + 保留语义）**：把整行精确比较改为**前缀/正则匹配**，容忍标题后缀。

```js
// 改为：行首匹配标题，后接可选的括号说明与冒号
const BLOCK_HEADING_RE = /^(GEO SPATIAL LAYOUT|ACTION TIMING|AUDIO|CHARACTER ACTING|POSITIVE CONSTRAINTS)\b/
// 判定：if (m = line.match(BLOCK_HEADING_RE))
```

同时 `BLOCK_HEADINGS` 保留为「标题本体」用于输出渲染，新增正则常量用于识别，**两者同源**（从同一数组生成正则，避免再次漂移）。

**方案 B（更彻底）**：从 `prompt-doctrine.json` 的 `blocks[].label` 动态生成识别集，消除硬编码（同时修复缺陷 5）。代价是引入对 kit 的运行时依赖，需评估 fail-closed 行为。

**建议**：先做方案 A 止血（本次），方案 B 作为后续重构。

### 1.5 回归保护测试

**新增文件**：`apps/desktop/electron/services/film-engineering/shot-library.real-kit.test.js`

```js
// 核心断言：用真实 kit 数据跑，而非自造夹具
it('真实 kit 语料：GEO 模式必须能提取出内容（防整行精确比较回归）', () => {
  const kit = loadRealKit()            // 读 electron/film-kit/shot-library.json
  const hit = kit.shots.filter(s => extractBlocks(s.prompt).some(b => b.heading === 'GEO SPATIAL LAYOUT'))
  assert.ok(hit.length > 0, '真实语料中 GEO 块命中数必须 > 0，当前为 0 说明又退化了')
})

it('块标题带后缀/冒号时仍应识别', () => {
  // 夹具刻意复刻真实形态
  const p = 'GEO SPATIAL LAYOUT (locked across every CO shot — pure spatial map):\n...'
  assert.equal(extractBlocks(p).length, 1)
})
```

**为什么这样写**：现有三个用例用的是理想夹具，改实现后它们**仍会全绿**（因为理想夹具两种实现都能过）——那正是它们拦不住这次缺陷的原因。新用例必须锚定**真实语料的统计特征**（命中数 > 0），才能反向锁住退化。

---

## 缺陷 2 【MAJOR】自动模式进度阶段名显示英文 id

### 2.1 现象

自动模式进度区复用 `StageProgress.vue`，三行阶段名显示为：

```
film_auto_plan
film_auto_generate
film_auto_render
```

旁边状态标签（已完成/运行中/等待中）是正常中文，唯独阶段名是英文。

### 2.2 根因溯源

阶段名在 `useFilmAutoRun.js:52,54,59` 定义为 `film_auto_plan` / `film_auto_generate` / `film_auto_render`。

`StageProgress.vue:117-119` 调 `getPipelineStage(t, name)` 翻译；该函数查 `src/i18n/pipeline-labels.js` 的 STAGES 表，**这三个 id 未登记**（已 grep 确认零命中），`translate()` 走 fallback 返回原始 id（`pipeline-labels.js:203-210`）。

**引入点**：`git log -S 'film_auto_generate'` → `b3ee1579fd64582c44491038ebd548f573017920`（2026-10-10，PR #3234「三标签重组 + 自动模式」）。即**新增自动模式时只定义了阶段 id，忘了登记翻译**。

### 2.3 逃逸分析

| 层 | 是否拦住 |
|---|---|
| 单元测试 | ❌ `FilmAutoPanel.test.js` 断言的是 `testid-prefix` 与 percent 透传（`:216-221`），**不断言阶段名文本** |
| 集成/E2E | ❌ 无 |
| 视觉回归 | ❌ 自动模式不在像素基线覆盖清单（`01-docs/PRD-VISUAL-READINESS-GATE-2026-10-11.md:159` 提到「影视工程 Hub 是否需要纳入像素基线」是**未决事项**） |
| 文案门禁 | ❌ 门禁只查「新增中文文案是否进 locales」（`check-locale-sync`）与「渲染端硬编码中文」，这里是**漏登记 key** 而非硬编码，不在扫描面内 |

**系统性漏洞定位**：**审查盲区 + 门禁盲区叠加**。阶段名是「代码生成的 key」而非「字面量中文」，现有三道文案门禁（locale 成对、硬编码扫描、i18n-glossary）都只管字面量，管不到动态 key 的登记完整性。

### 2.4 修复方案

在 `src/i18n/pipeline-labels.js` 的 STAGES 表补三条（zh/en 成对）：

| key | zh | en |
|---|---|---|
| `film_auto_plan` | 分镜规划 | Shot planning |
| `film_auto_generate` | 逐镜生成 | Shot generation |
| `film_auto_render` | 收口合成 | Final composition |

（命名参考 `zh.js:46-49` 的步骤条文案：填写文案/确认清单/自动生成/收口合成，保持用词一致）

### 2.5 回归保护测试

**新增断言**于 `FilmAutoPanel.test.js` 或新建 `pipeline-labels.stage-coverage.test.js`：

```js
it('所有被视图消费的 pipeline 阶段 id 必须在 STAGES 表登记（防漏登记回归）', () => {
  // 从源码提取所有 name: 'film_auto_*' / 各阶段 id 字面量
  // 逐条断言 STAGES[id] 存在，缺失即红
})
```

**更通用的锁（推荐）**：写一条**全仓扫描**判据——扫描 `src/**` 中所有传给进度/阶段组件的字符串字面量，断言其在翻译表中有登记。这能一并防住未来任何新流水线的同类遗漏。

---

## 缺陷 3 【MAJOR】画布所有失败都归因为「影视引擎不可用」

### 3.1 现象

画布点「生成所选」失败时，除「超过 10 镜」「未选分镜」两种情况外，**其余全部**弹同一条错误：

> 影视引擎不可用

**真实原因可能是没配视频模型**，但用户看到的是「引擎不可用」——会以为安装坏了，而不是去配模型。

### 3.2 根因溯源

```js
// apps/desktop/src/views/FilmCanvasView.vue:115-117
if (r.errorCode === 'tooManyShots') { ... }
else if (r.errorCode === 'noShots') { ... }
else ElMessage.error(t('filmEngineering.canvas.engineUnavailable'))   // ← 兜底吞掉所有其他原因
```

精准文案其实**已存在**于 locales 但画布未引用：`filmEngineering.video.noModel`（`zh.js:149`）「尚未配置默认视频模型。请在模型设置中配置视频 Provider（如 Seedance / Kling / Veo）并设为默认后重试。」

对比：经典视图/全量出片面板**有**精准分流与「前往模型设置」按钮（`FilmEngineeringView.vue:385,440,443`）——说明这是画布视图的实现疏漏，而非全局设计。

**引入点**：`git log -S 'engineUnavailable'` → `15ad0e1681936a51134d9456b4271da6d373b6c2`（2026-09-24，PR #2342「影视工程短剧画布（Vue Flow）替换三栏 UI」）。画布是**新写的视图**，错误分支照抄了 kit 不可用那一条，未做多分支分流。

### 3.3 逃逸分析

| 层 | 是否拦住 |
|---|---|
| 单元测试 | ❌ 画布测试只覆盖成功路径与两个特定 errorCode，未构造「provider 未配置」场景 |
| 集成/E2E | ❌ 无未配置模型的 E2E |
| 视觉回归 | ❌ 错误 toast 不在截图基线 |
| 代码审查 | ❌ 单看 `else` 兜底是合理防御式写法，除非对照「主进程可能返回哪些 errorCode」才发现问题 |

**系统性漏洞定位**：**测试场景缺失**——「错误分支」只测了枚举出来的两例，没测兜底分支。防御式 `else` 掩盖了原因多样性。

### 3.4 修复方案

在 `FilmCanvasView.vue` 的错误分支补 `VIDEO_MODEL_NOT_CONFIGURED` 分流：

```js
else if (r.errorCode === 'VIDEO_MODEL_NOT_CONFIGURED') {
  ElMessage.error(t('filmEngineering.video.noModel'))
  // 可选：提供「前往模型设置」入口，与经典视图对齐
} else {
  ElMessage.error(t('filmEngineering.canvas.engineUnavailable'))
}
```

**注意**：`useFilmVideoGen` 的失败目前统一落到 `startFailed`/`startError`（`useFilmVideoGen.js:165-186`），**主进程的 `errorCode` 是否透传到渲染端需先确认**——若未透传，需同时修传递链，否则分流判据拿不到值。这是修复前必须先验证的一点。

### 3.5 回归保护测试

`FilmCanvasView.actions.test.js` 新增：

```js
it('provider 未配置时必须显示 noModel 而非 engineUnavailable', async () => {
  // mock start() 返回 { ok:false, errorCode:'VIDEO_MODEL_NOT_CONFIGURED' }
  // 断言 ElMessage.error 收到的文案是 video.noModel 对应的中文
})
```

---

## 缺陷 4 【MINOR】画布「已注入 N 张参考」提示永不显示

### 4.1 现象

`ShotNode.vue:46` 渲染「已注入 {n} 张参考」，文案存在（`zh.js:209`）。但**全仓没有任何代码写入 `refCount` 字段**（grep 仅命中渲染处）。连线成功后用户看不到任何视觉反馈。

### 4.2 根因溯源

参考图注入的实际数据流是：`collectShotReferences` → `buildLocalReferences` → 随 `initialContext` 发给引擎（`film-canvas-model.js:115-144`）。这条链路**不回写节点 `data.refCount`**——渲染侧期望的字段与写入侧的通道根本没接上。

**引入点**：`15ad0e1681936a51134d9456b4271da6d373b6c2`（2026-09-24，同 PR #2342）。组件写了展示逻辑，但连线落边时（`useFilmCanvas.js:179-189` 的 `addEdge`）未同步更新目标节点的 `refCount`。

### 4.3 逃逸分析

| 层 | 是否拦住 |
|---|---|
| 单元测试 | ❌ `useFilmCanvas.test.js` 测的是「边是否落上」，未测「目标节点 refCount 是否更新」 |
| 视觉回归 | ❌ 该提示本就不显示，截图里没有它，基线无从比对 |
| 代码审查 | ❌ 展示与写入分处两个文件，人眼难以发现「写了展示但没人写数据」 |

**系统性漏洞定位**：**审查盲区**——跨文件的「字段生产/消费」配对缺少机械核对。

### 4.4 修复方案

在 `addEdge`（`useFilmCanvas.js:179-189`）落边成功后，对目标分镜节点重算 `refCount`：

```js
// 落边后
const refs = collectShotReferences(target, nodes.value, edges.value)
const node = nodeById(target)
if (node) node.data.refCount = refs.character.length + refs.scene.length
persist()
```

删除节点/边时（`removeNodes`，`useFilmCanvas.js:191-196`）同步重算，避免残留。

### 4.5 回归保护测试

`useFilmCanvas.test.js` 新增：

```js
it('连一条参考图到分镜后，该节点 refCount 必须为 1', ...)
it('删掉该边后，refCount 必须回到 0', ...)
```

---

## 缺陷 5 【MINOR】方法论 7 块 vs 切块 5 块口径不一致

### 5.1 现象

- 方法论标签页展示「**七大**提示词块」：`prompt-doctrine.json` 实测 7 项（`scene_context` / `geo_spatial_layout` / `action_timing` / `audio` / `character_acting` / `style` / `positive_constraints`）
- 但 `shot-library.js:16-22` 的 `BLOCK_HEADINGS` 只有 **5 项**，缺 `SCENE CONTEXT` 与 `STYLE`

后果：即便缺陷 1 修好，`blocks` 模式也永远切不出这两块。

### 5.2 根因溯源

两处**各自硬编码**，无共同真源。同源于 `a3a93913`（2026-08-15）首次引入。

### 5.3 修复方案

若采纳缺陷 1 的**方案 B**（从 `prompt-doctrine.json.blocks[].label` 动态生成识别集），本缺陷**自动一并修复**，且从结构上杜绝再次漂移——推荐作为该模块的后续重构目标。

若只做方案 A，则需在 `BLOCK_HEADINGS` 补两项，并加一条**同源锁**测试：断言 `BLOCK_HEADINGS` 与 `prompt-doctrine.json` 的 blocks 标签集合相等。

### 5.4 回归保护测试

```js
it('BLOCK_HEADINGS 必须与 prompt-doctrine.json 的块标签同源（防两处漂移）', () => {
  const doctrine = JSON.parse(fs.readFileSync('.../prompt-doctrine.json','utf8'))
  const labels = doctrine.blocks.map(b => b.label.toUpperCase()).sort()
  assert.deepEqual([...BLOCK_HEADINGS].sort(), labels)
})
```

---

## 横向：三条系统性漏洞（跨缺陷共性）

| # | 系统性漏洞 | 命中缺陷 | 堵法 |
|---|---|---|---|
| S1 | **夹具理想化**：测试用符合实现的假数据，测不出实现与真实数据的错配 | 1 | 关键算法必须有一条「真实语料统计特征」断言（如命中数 > 0） |
| S2 | **动态 i18n key 无登记完整性检查**：三道文案门禁只管字面量，不管代码生成的 key | 2 | 全仓扫描阶段/枚举 key 与翻译表的差集 |
| S3 | **错误兜底分支无场景覆盖**：`else` 吃掉所有未枚举原因 | 3 | 对每条兜底分支，至少构造一个「非枚举原因」用例断言其不误报 |
| S4 | **跨文件字段生产/消费无配对核对** | 4 | 对展示用的派生字段，补「写入端」单测 |

## 预防措施（须有具体文件变更落地）

1. **新增测试文件** `shot-library.real-kit.test.js` —— 真实语料断言（堵 S1）
2. **新增测试文件** `pipeline-labels.stage-coverage.test.js` —— 全仓阶段 key 登记完整性扫描（堵 S2）
3. **扩展** `FilmCanvasView.actions.test.js` —— 补 provider 未配置与兜底分支用例（堵 S3）
4. **扩展** `useFilmCanvas.test.js` —— 补 `refCount` 写入/删除用例（堵 S4）
5. **更新** `01-docs/learnings.md` —— 记录「夹具理想化」与「动态 key 漏登记」两类盲区
6. **更新** 质量节拍 Code Review 清单 —— 新增两问：
   - 「这段逻辑有没有用**真实数据**跑过？测试夹具是不是照着实现写的？」
   - 「新增的动态 i18n key 登记进翻译表了吗？」

## 处置建议与优先级

| 顺序 | 缺陷 | 理由 | 通道 |
|---|---|---|---|
| 1 | **缺陷 1** | 唯一 CRITICAL，且影响用户主要功能预期 | worktree 隔离 + 完整质量节拍 |
| 2 | **缺陷 2** | 用户可见英文，改动小（补 3 个 key） | 需注意 zh/en 成对门禁 |
| 3 | **缺陷 3** | 需先验证 errorCode 是否透传 | 同缺陷 1 批次 |
| 4 | **缺陷 4** | MINOR，改动局部 | 可并入同批次 |
| 5 | **缺陷 5** | 依赖缺陷 1 的方案选择 | 随方案 B 一并处理，或加同源锁 |

> ⚠️ **未执行任何代码修改**。上表第 1/3/4 项涉运行时代码，按 `AGENTS.md` 需走 `scripts/start-mp-task.ps1` 建 worktree；缺陷 2 涉及 locales 需过 zh/en 成对门禁。**本文档仅为取证与方案，等你确认后再进实施。**
