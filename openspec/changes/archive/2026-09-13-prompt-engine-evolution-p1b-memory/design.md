# Design — P1b 记忆库 + 治理（PromptMemory + Governance）

> 关联：`01-docs/prompt-engine-evolution-design.md` §3.4/§4.3/§4.5；`ARCH-PROMPT-ENGINE-EVOLUTION-FINGERPRINT-2026-08-13.md`（检索模块，本 change 是其消费方）
> 审查修订（2026-08-13，Codex 双模型审查「需修改后通过」+ 主代理复核）：C1 save 补 mode；C2/M6 模板补 fingerprint+sourceText；M1 list 保留 P0 envelope；M2 V0 仅人工确认；M3/M7 statsProvider 依赖声明；M5 dedup V0 仅 checksum；m1-m9 全部纳入

## 1. 模块结构

```
apps/desktop/electron/services/prompt-evolution/
  fingerprint.js        # 已有：主题指纹 + findSimilarTemplates（检索）
  signal-collector.js   # 已有：P0 采集（generation/feedback 日志 + getStats）
  prompt-memory.js      # 新增：记忆库（库文件 + 版本化模板 + 状态查询/流转入口）
  governance.js         # 新增：门禁 6 规则 + 滑窗回滚 + 配额
  prompt-memory.test.js / governance.test.js   # 新增
```

- `prompt-memory.js` 与 `governance.js` 均零外部依赖、纯同步（回滚监控为同步轮询接口），不引入异步/LLM。
- 检索数据源契约：`prompt-memory.listActive({engine})` 返回 `[{id, fingerprint, stats}]`，直接喂给 `fingerprint.findSimilarTemplates(concept, activeTemplates, {rand})`——记忆库是检索的上游，检索逻辑零改动。
- 边界：生成主路径消费（`optimizedBy=learnt-template` / `librarySource` 写入）归 P2 Optimizer 接线，本 change 不接入生成流程。

## 2. 数据模型

### 2.1 目录布局（opts.libraryRoot，默认 `userData/prompt-library/`）

```
prompt-library/
  library.json                       # 索引（items 按 id 组织）
  templates/<id>@<version>.json      # 单模板完整记录
```

### 2.2 library.json（索引）

```jsonc
{
  "schemaVersion": 1,
  "dictVersion": "2026-08-13",       // 与 fingerprint.DICT_VERSION 对齐；不匹配→以 sourceText 重算/标 stale
  "items": {
    "tpl_<16hex>": {
      "id": "tpl_...",
      "engine": "image" | "video",
      "mode": "story2video" | "standalone" | "storyboard",
      "type": "composition" | "style" | "keyword" | "metaphor" | "full",
      "versions": [1, 2],             // 版本列表
      "latestVersion": 2,
      "state": "draft" | "active" | "deprecated" | "disabled",
      "createdAt": "ISO", "updatedAt": "ISO"
    }
  }
}
```

### 2.3 templates/<id>@<version>.json（完整模板，对齐设计 §3.4 + 审查 C2/M6）

```jsonc
{
  "id": "tpl_...", "version": 1, "engine": "image", "mode": "storyboard", "type": "full",
  "content": {
    // full：storyboard 结构化 {structure, 视觉隐喻, color, constraints, ...}
    // fragment：仅 compositionType/action/object/creativeLevel 四类可控参数
    "compositionType": "前后对比", "action": "放大", "object": "书本",
    "creativeLevel": 7
  },
  "sourceText": "AI 改变教育",        // 生成概念原文 ≤2000 字符（M6：dictVersion 变更重算输入）
  "fingerprint": { "schemaVersion": 1, "dictVersion": "2026-08-13", "domains": ["tech","education"], "compositionIntents": ["前后对比"], "topics": [], "tone": "peaceful" },
  "source": "learnt",
  "provenance": { "learnedFrom": "evt_<hex>", "acceptedEvents": [] },
  "stats": { "uses": 0, "acceptRate": 0, "avgScore": null, "avgCost": 0, "lastUsedAt": null },
  "state": "draft",
  "guard": { "checksum": "sha256...", "validatedAt": "ISO", "gateRules": ["structure","compliance","length","noSecrets","dedup"], "evaluatorVersion": "rule-v0" },
  "createdAt": "ISO", "updatedAt": "ISO", "confirmedBy": "<userHash 加盐 HMAC>"   // m4：不落明文 userId
}
```

- fingerprint 由 save 入参 `concept` 经 `buildFingerprint(concept)` 计算并落盘；sourceText 存 concept 原文供 dictVersion 变更后重算（C2/M6）。
- 加载防御（C2）：fingerprint 缺失/不可解析 → 该模板 fail-close 不参与检索，告警且不影响其余模板。
- `stats` 是滑窗聚合结果（非存储原始信号），由注入的 `statsProvider` 实时计算（见 §5），低频字段（lastUsedAt）可写回。
- 版本化（m9 优先级定死）：(1) content checksum 与库内 active 模板完全碰撞 → 拒绝；(2) 同 `provenance.learnedFrom` 且指纹相似（非完全碰撞）→ 升版（versions.push，latestVersion+1）；(3) 否则新 id。

## 3. PromptMemory API

```js
createPromptMemory({ libraryRoot, config, statsProvider, log })
```

| 方法 | 行为 |
|---|---|
| `load()` | 读 library.json + 全部模板文件到内存索引；校验 dictVersion；损坏文件 fail-close 重建空库并告警 |
| `list({state?, engine?, type?})` | 返回匹配模板摘要（供 `prompt-library:list`，包装为 `{templates, evolution}` envelope） |
| `listActive({engine})` | 返回 `[{id, fingerprint, stats}]`（仅 active + fingerprint 有效），供 fingerprint 检索 |
| `get(id, version?)` | 单模板详情（供 `prompt-library:get`）；不存在返回 null |
| `saveLearnt({engine, mode, type, content, concept, eventId})` | 入库主入口：归一化 → fingerprint=buildFingerprint(concept) → 门禁（governance.runGates）→ 通过则写 draft；返回 `{ok, id, version, state}` 或 `{ok:false, code}` |
| `activate(id, {confirmedBy})` | draft→active（**人工确认**入口；数据确认阈值归 P2） |
| `deprecate(id, {reason})` | active→deprecated（治理回滚调用；无 IPC，P2 治理 UI） |
| `disable(id)` | deprecated→disabled（手动，终态；无 IPC，P2） |
| `refreshFingerprints()` | dictVersion 变更时以 sourceText 重算；sourceText 缺失标 stale |

- 关键约束：**learnt fragment 四类参数白名单**——`saveLearnt` 里对 fragment 类模板做 content 键校验：仅允许 `compositionType/action/object/creativeLevel`，含 `color/keywords/metaphor/...` 越界键直接拒绝（门禁 structure 前置检查）。
- 写盘原子性：临时文件 + rename（Windows 原子替换语义，参照 QM 铁律），单 writer，写失败不阻断生成主流程。

## 4. Governance API

```js
createGovernance({ config, memory, statsProvider, log })
```

| 方法 | 行为 |
|---|---|
| `runGates(template)` | 门禁 6 规则，返回 `{pass, results{rule: ok|fail, detail}, checksum}` |
| `transition(id, to, {reason})` | 状态机校验（见 §4.2）后委托 memory 流转 |
| `checkRollback(now)` | 滑窗回滚扫描（见 §5），返回本次变更列表 |
| `isAutoEvaluationAllowed(engine, today)` | 配额检查（见 §6），超限返回 false |

### 4.1 门禁 6 规则

| 规则 | 判定 |
|---|---|
| structure | 按 engine/mode 分档必填字段完整；fragment 仅四类参数 + **compositionType 值域校验**（∈ COMPOSITION_PATTERNS keys，parity 测试锁死；action/object 与生成器 `customAction/customObject` 映射表归一，m3） |
| compliance | content 不含 config 合规词表命中项 |
| length | storyboard 中文 50..2000 字符；英文 prompt 50..200 词（按 engine 分档） |
| noSecrets | 疑似指令注入模式（分隔符逃逸/越权指令，config 预编译 token 表，**只查找不 eval、不把用户输入拼进正则**，m8） |
| dedup | **V0：content checksum 精确去重**（近重复聚类淘汰归 P2，M5）；完全碰撞 → 拒绝；同源语义相似 → 升版（m9） |
| evaluatorVersion | 记录本次 gate 的 evaluator 版本（V0 固定 `rule-v0`） |

- checksum = sha256(canonical content JSON)，写入 guard.checksum。
- 全部规则纯函数、可注入配置、无 LLM。

### 4.2 状态机

```
learnt ──gates 通过──▶ draft ──activate(人工确认)──▶ active ──rollback/manual──▶ deprecated ──manual──▶ disabled
builtin ───────────────▶ (不落库；回退直接走生成器内置池)      ← m6：内置池不落库，builtin 边为未来 manual 导入预留
```

- 合法边：`draft→active`、`active→deprecated`、`deprecated→disabled`；非法边一律拒绝并返回错误码。
- **V0 仅人工确认激活**（M2）：数据确认阈值（图片 llm≥7.0 / accepted≥3、视频平台 valid_positive≥5）依赖 P1a score-log 与 P2 平台回灌，spec 明示不在 V0，实现不得自行发明。
- 检索边界由 memory.listActive 保证（仅 active + fingerprint 有效），deprecated 即使高分不命中（沿用指纹 §3.2/状态变更钩子）。

## 5. 滑窗回滚（指标化可测）

- 输入：`statsProvider(templateId)` 返回 `{acceptRateSeries: [r1..rN], avgScoreSeries: [s1..sN], uses, lastUsedAt}`。
- **数据源依赖声明（M3/M7）**：`signal-collector.getStats` 目前仅 engine 级聚合，按 templateVersion 维度的生产数据源依赖 P1 recordGeneration 生产接线 + P1a score-log；V0 交付可注入 statsProvider + 回滚判定逻辑，以注入数据验证；真实数据源落地前应缓存/增量窗口聚合（O(active × 日志体积) 预算注明）。
- 触发：`acceptRate 连续 N 期（默认 3）< threshold（默认 0.3）` **或** `avgScore 相对峰值下滑 > dropThreshold（默认 20%）`。
- 动作：`transition(templateId,'deprecated',{reason:'sliding-window-rollback'})`；生成侧回退内置池（沿用既有回退路径，归 P2 接线）。
- 冷却：模板记录 `cooldownUntil`，冷却期（默认 24h）内同一模板不重复回滚；`checkRollback(now)` 幂等、可注入时钟（`opts.now`）供测试。

## 6. 成本配额

- 配置：`evolution.budget = { image: { daily: 2000 }, video: { daily: 0 } }`（视频默认零自动评分）。
- `isAutoEvaluationAllowed(engine, today)`：读 score-log 当日 spend（P1a 写入；V0 无 score-log 时 spend=0，配额只作闸门）；视频 `daily===0` 恒 false。
- 超限语义：评估/入库评估跳过，生成主流程继续（沿用 P0「写失败不阻断」原则），返回降级信号供可观测。

## 7. IPC 与接线

- `ipc-handlers/generation-feedback.js`：
  - `prompt-library:list`：骨架升级为 `memory.list()` 并**保持 P0 envelope** `{code:0, data:{templates:[...], evolution:state}}`（M1：不破坏既有渲染端契约；evolution 字段保留）。
  - 新增 `prompt-library:get` / `prompt-library:save` / `prompt-library:activate`，沿用 `code+data+message`。
  - `save` 入参 `{engine, mode, type, content, concept, eventId}`（C1：mode 必填，供 structure 门禁分档）；eventId 必填且校验 `evt_` 前缀（m2：join 校验标注 P1 接线后补）；concept ≤2000 截断。
- `core/error-codes.js`（m1）：新增 `EC.TEMPLATE_INVALID: -20`、`EC.TEMPLATE_GATE_FAILED: -21`、`EC.TEMPLATE_NOT_FOUND: -22`、`EC.TEMPLATE_BAD_STATE: -23`（避开 -10..-13 既有段），契约测试断言数值。
- `preload/system.js`：保持 `promptLibraryList`，新增 `promptLibraryGet/Save/Activate`；`npm run build:preload` 后同步 `index.bundle.js`（CI 断言 bundle 键数）。
- **接线位置（m5）**：沿用 P0 模式——`bootstrap/phase1-context.js` 中以 env `MP_EVOLUTION_ENABLED === '1'`（默认关）构造 promptM
emory/governance 单例并注入 statsProvider（接 signal-collector）；不用 container.setup.js。开关默认关与 P0 采集器一致（statsProvider 依赖采集器，避免「记忆库开但无数据源」）。
- 前端「存为模板」按钮 UI 属 P2，本 change 只交付 IPC 契约 + 单元/契约测试。

## 8. 兼容性

- `generateCandidates` 同步签名、`COMPOSITION_PATTERNS` 内置池、`generation:feedback` 契约、`PromptBridge` 契约：零改动。
- `prompt-library:list` 响应保持 `{code:0, data:{templates, evolution}}`，空库 `templates:[]`，与 P0 骨架结构一致（M1 修正后）。
- fingerprint.js：零改动（本 change 只提供其 `activeTemplates` 数据源）。
- 测试隔离：全部 `os.tmpdir()` 唯一目录；不触碰真实 userData。

## 9. 测试计划（TDD）

| 层 | 用例 |
|---|---|
| prompt-memory 单元 | 四类参数白名单拒绝；mode 枚举校验；dictVersion stale → sourceText 重算 / 无 sourceText 标 stale；fingerprint 缺失 fail-close；版本升版/新 id/碰撞拒绝优先级；写盘原子性；损坏库 fail-close 重建 |
| governance 单元 | 6 规则逐条（注入/长度/合规/结构含 compositionType 枚举/dedup 碰撞）；状态机合法/非法边；滑窗回滚 + 冷却期幂等（注入 statsProvider 数据）；配额（视频零、图片超限降级） |
| IPC 契约 | list envelope `{templates, evolution}` 与 P0 一致；save 缺/非法 eventId、非法 mode 拒绝；activate 不存在拒绝；EC.TEMPLATE_* 数值 -20..-23 |
| 集成 | memory.listActive → fingerprint.findSimilarTemplates 全链路（active 命中 / deprecated 不命中 / fingerprint 缺失模板不参与） |
| 兼容 | 空库 `prompt-library:list` 返回 `{code:0, data:{templates:[], evolution:...}}`；fingerprint.js 零改动 |
