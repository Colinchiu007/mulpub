# PRD — 故事讲述文案字数上限控制（6000 → 10000 + 运营中心「字数控制」）

> **版本**：v1.0
> **日期**：2026-10-18
> **分支**：`story-text-limit-control`
> **状态**：待合并
> **关联**：`01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §4、`openspec/records/story-text-limit-control.md`

---

## 1. 背景与问题

### 1.1 用户诉求

视频创作页「故事讲述」流水线（pipelines 内部 key：`story2video-compose`）的**文案输入框**，
当前字数上限为 **6000 字符**。运营侧提出上限不够用：一篇中等长度的中文脚本常常在
6500～9000 字符之间，用户被迫手动删减后才能启动流水线，且删减会破坏脚本结构
（分镜提示词依赖原文的段落与人物/事件顺序）。

诉求有两条：

1. **把上限从 6000 提高到 10000。**
2. **让运营中心能自己调这个数字**，不要每次都发版。若运营中心没有对应设置，
   就在运营中心菜单里增加一项「字数控制」。

### 1.2 现状核查结论：运营中心**没有**任何可控入口

逐项排查（本轮实测，均为代码级证据）：

| 候选入口 | 实际控制什么 | 能否控制故事讲述字数上限 | 证据 |
|---|---|---|---|
| 选项控制（`/pipeline-options`） | 视频创作**选项字段**的显示/隐藏与默认值，key 形如 `basic.speechRate`，服务端有 `^[a-z]+\.[a-zA-Z_][a-zA-Z0-9_]*$` 与 group 白名单双重校验 | ❌ 不能。它是「表单字段字典」，没有也放不进「一个全局数值上限」 | `ops-center/backend/services/pipeline_option_service.py`、`ops-center/frontend/src/views/PipelineOptions.vue` |
| 项目参数（`/parameters`） | `config_items` 表里按项目存的参数，经 `/api/v1/sync/{project}/params` **写 YAML 文件** | ❌ 不能。这条链**不参与**运行时下发，桌面端读不到 | `ops-center/backend/routers/sync.py`、`ops-center/frontend/src/views/Parameters.vue` |
| 功能开关（`/feature-flags`）/ 桌面端功能开关（`/runtime-flags`） | 布尔/枚举型开关，走 `feature_flags` 运行时块 | ⚠️ 技术上能塞，但语义错位（这不是开关是数值），且会让「开关」块承载非开关数据 | `ops-center/backend/services/feature_flag_service.py` |
| 内容模板库 / 平台元数据 / 关键词监测… | 各自领域数据 | ❌ 不能 | — |

**结论：必须新增。** 本 PRD 定义新增的「字数控制」页面与它对应的跨端下发契约。

---

## 2. 目标与非目标

### 2.1 目标

| 编号 | 目标 | 可度量判据 |
|---|---|---|
| G1 | 故事讲述文案上限默认值由 6000 提升到 **10000** | 未配置任何运营项时，计数分母显示 `10000`，10000 字符可启动、10001 字符被截断 |
| G2 | 运营中心新增「字数控制」设置页，可改上限与预警阈值 | 页面保存后，`GET /api/v1/runtime/bootstrap` 的 `storyTextLimit` 块反映新值 |
| G3 | 配置经**签名运行时下发**到桌面端，篡改不可能被应用 | 该块纳入 `config_hash` 白名单（13 → 14 块）与 Ed25519 签名覆盖范围 |
| G4 | 全链路降级安全：任何一环缺失/脏数据都不影响创作者可用性 | 运营中心不可达、块为 `null`、字段越界/非整数 → 回落 10000 / 90%，创作流程不阻塞 |

### 2.2 非目标

- 不改「文案改写」「AI 写作」等其它入口的字数限制（那些是 `rewrite` 域，与本需求无关）。
- 不做「按用户分级」或「按会员等级」差异化上限（当前只需一个全局值；表结构预留 `scope` 便于将来扩展）。
- 不改流水线引擎侧的分镜切分/语音合成参数。
- 不实现「保存后立即推送」（沿用既有「下次配置同步生效」模型，最长 24h）。

---

## 3. 用户故事

| 角色 | 故事 | 验收 |
|---|---|---|
| 内容创作者 | 我有一篇 8000 字的脚本，希望能直接粘进文案框启动故事讲述，不被 6000 字卡住 | 粘贴 8000 字后计数显示 `8000/10000`，可启动 |
| 内容创作者 | 我在接近上限时希望被提醒，而不是粘贴完才发现被截断 | 达到预警阈值时计数变警示色 + tooltip「接近字数上限」 |
| 运营人员 | 我想在不发版的前提下把上限调成 12000（比如大促长脚本） | 运营中心保存后，客户端下一次同步（或手动同步）即生效 |
| 运营人员 | 我想把上限调低但不想让用户莫名丢文案 | 调低后客户端只对**新进入页面**的文本生效；已在框内的文本超限时给出明确截断提示，不静默丢弃 |
| 运维/开发 | 运营中心挂了或下发了脏值，应用必须还能正常创作 | 断网/非法值下计数分母仍是 10000，启动链路不报错 |

---

## 4. 功能需求

### 4.1 FR-1：默认上限 6000 → 10000

- 内置默认常量 `MAX_STORY2VIDEO_TEXT_CHARACTERS` 由 `6000` 改为 `10000`。
- **语义收窄（重要）**：该常量自此是「**内置默认值**」，不再是「硬上限」。真实生效上限由
  运行时配置 `storyTextLimit.story2video.maxChars` 决定，缺省即用该常量。
- 所有原先引用该常量的位置（计数分母、超限截断、启动前校验、批量创作占位符、
  流水线切换时的预填截断）**统一改为引用「生效上限」**，不得留任何一处写死 6000。

### 4.2 FR-2：运营中心新增「字数控制」页面

- 菜单：运营中心左侧菜单新增一项 **`字数控制`**，路径 `/story-text-limit`，仅管理员可见（`adminOnly`）。
- 页面按 `scope` 列表展示；本轮只有一行：`故事讲述`（`story2video`）。
- 可编辑字段见 §6 数据校验表；支持「保存」与「恢复默认」。
- 保存即写库；页面顶部说明「保存后桌面端在下一次配置同步时生效（最长 24 小时，可手动同步）」。

### 4.3 FR-3：跨端签名下发契约 `storyTextLimit`

新增运行时数据块（与 `announcements` / `feature_flags` / `pipelineOptions` 同级）：

```json
{
  "storyTextLimit": {
    "story2video": { "maxChars": 10000, "warnPercent": 90 }
  }
}
```

三条不可破的约束：

1. **只能整数。** 两端 `config_hash` 的 canonical 序列化都会对非整数/非有限数 **抛错**
   （服务端 `assert_integer_numbers`、客户端 `assertNoFractionalNumbers`）——
   一旦混入 `0.9` 这类值，`config_hash` 降级为空串、`config_version` 归零，
   全量客户端永远判「hash 未变」，运营看板上的「是否生效」从此失真。
2. **必须进 `RUNTIME_BLOCKS` 白名单（两端各一份，13 → 14）。**
   漏一侧 → 两端 `config_hash` 不同 → 客户端 ACK 永不被认可。
3. **必须落在 Ed25519 签名覆盖范围内**（即放在 `sign_runtime_payload` 的 `payload` 里，
   不是放在签名之后追加）。否则该值可被中间人改写而客户端不察。

### 4.4 FR-4：桌面端生效与降级

- 渲染端通过既有 `opsCenterSyncRuntime()` 通道读取 `data.storyTextLimit`。
- **生效优先级**：运营下发（合法）> 内置默认 `{ maxChars: 10000, warnPercent: 90 }`。
- **降级链**（任一步失败都不抛错、不阻塞创作）：
  1. 运营中心不可达 / IPC 通道未就绪 → 内置默认；
  2. 块为 `null` / 非对象 → 内置默认；
  3. `maxChars` 非整数或越界 → 仅 `maxChars` 回落默认（其余字段独立判定）；
  4. `warnPercent` 非整数或越界 → 仅 `warnPercent` 回落默认。
- 解析成功后，`source` 标记为 `ops-center` 或 `default`，供排查与将来的 UI 展示使用。

---

## 5. 数据设计

### 5.1 运营中心表 `story_text_limits`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `scope` | TEXT | 主键 | 作用域，本轮只有 `story2video` |
| `max_chars` | INTEGER | NOT NULL，默认 10000 | 字数上限（Unicode 码点计数） |
| `warn_percent` | INTEGER | NOT NULL，默认 90 | 预警阈值百分比 |
| `enabled` | BOOLEAN | NOT NULL，默认 true | 关闭后该 scope 不下发（桌面端回落内置默认） |
| `note` | TEXT | 可空 | 运营备注 |
| `updated_at` | TEXT | NOT NULL | ISO8601 UTC，`Z` 结尾 |
| `updated_by` | TEXT | 可空 | 操作人 |

**目录供给（防「新 scope 在运营端永久消失」）**：读取/写入/下发前对目录内 scope
做「只补欠账、不覆盖运营者已有值」的 provision——同 `app_menu_service._provision_from_catalog` 语义。

### 5.2 下发块形状

```jsonc
{
  "storyTextLimit": {
    "story2video": { "maxChars": 10000, "warnPercent": 90 }
  }
}
```

- `enabled=false` 的 scope **不出现在块里**（而不是出现并带 false）——
  保持「块里没有这个 key = 用内置默认」这一条单一判据。
- 库内无行时，provision 出默认行，因此正常状态下块里一定有 `story2video`。
- 极端情形（读库异常）→ 整块为 `null`，桌面端回落内置默认。

### 5.3 字段校验表

| 字段 | 类型 | 合法区间 | 默认 | 越界/非法行为（写入侧） | 越界/非法行为（下发/消费侧） | 中文报错 |
|---|---|---|---|---|---|---|
| `maxChars` | 整数 | 1000 ～ 50000 | 10000 | 400 拒绝，不写库 | 该项回落 10000，其余字段照常 | `字数上限需为 1000~50000 的整数` |
| `warnPercent` | 整数 | 50 ～ 99 | 90 | 400 拒绝，不写库 | 该项回落 90 | `预警阈值需为 50~99 的整数` |
| `enabled` | 布尔 | - | true | 非布尔按 400 拒绝 | 缺失按 true | `启用标记需为布尔值` |
| `note` | 字符串 | 长度 ≤ 200 | 空 | 超长按 400 拒绝 | 超长截断后下发不参与计算 | `备注最多 200 字` |
| `scope` | 字符串 | 必须在目录内 | - | 未知 scope 400 拒绝（fail-closed 写入口） | 未知 scope 忽略（fail-open 读出口） | `未知的作用域：xxx` |

> **为什么写入口严、读出口宽**：与 `app_menu_service` 的既有决策一致——
> 运营端拒绝脏数据免得「保存成功但实际失效」，客户端忽略不认识的键免得
> 「运营端未升级时新键让老客户端整体崩」。

### 5.4 为什么 `warnPercent` 用整数而不是 `0.9`

`config_hash` 两端序列化对浮点不一致（JS `1.5e-7` vs Python `1.5e-07`），
本项目已用 `assertNoFractionalNumbers` / `assert_integer_numbers` **显式拒绝非整数**。
因此阈值用**百分比整数**表达，规避跨端序列化漂移。这是本轮选型里唯一被否决的
「更直观」方案。

### 5.5 上界 50000 为什么能端到端成立（`publish.content` 耦合的处理）

主进程 `story2video-text-config.js` 的字段级 `textValue()` 默认上限是 **20000**，而
`publish.content` 的默认值就是**脚本正文**（`fallback = prompt`，`prompt` 即 `text`）。
于是存在一个耦合陷阱：若脚本上限被放到 20000 以上，脚本会先过字数闸，然后在
`publish.content` 被 `Story2Video publish.content 超过 20000 字符` **抛出**（`textValue` 是
throw 而非截断）——表现为「运营配置合法、启动失败」。

处理口径（最小且不松绑）：

```js
content: textValue(..., prompt, 'publish.content', Math.max(20000, textLimit))
```

- **默认配置（10000）下 `Math.max(20000, 10000) === 20000`**，行为与本次改动前逐字节一致
  ⇒ 不构成对「发布描述字段」的策略松绑；
- 只有在运营显式把 `maxChars` 调过 20000 时，该字段才跟随放宽——此时它继承的是脚本正文，
  不放宽就无法成立；
- 该处置有两条测试锁定：上界 50000 时 20001 字正文可过；默认 10000 时 20001 字的
  **显式**发布描述仍被 20000 拦。

---

## 6. 流程

### 6.1 运营配置流程（运营中心 → 库）

```
运营人员打开 运营中心 → 字数控制
   → GET /api/v1/story-text-limits      （provision 补齐 scope 目录）
   → 表格渲染（scope / 字数上限 / 预警阈值 / 启用 / 备注 / 更新时间）
   → 行内编辑 → 点「保存」
   → 前端逐字段区间校验（不静默纠正，越界即提示并且不发请求）
   → PUT /api/v1/story-text-limits  { items: [...] }
   → 后端二次校验（400 中文原因）→ 写库 → 返回最新 items
   → ElMessage.success('已保存，桌面端将在下次配置同步时生效')
```

### 6.2 下发流程（库 → 桌面端）

```
桌面端启动（autoSyncOnStart，延时 3s）或手动「立即同步」
   → GET /api/v1/runtime/bootstrap?since=<config_hash>
   → 服务端组装 payload（含 storyTextLimit）
   → compute_config_hash（14 块 canonical JSON 的 SHA-256 前 16 位）
   → sign_runtime_payload（Ed25519 覆盖整个 payload，含 config_hash/config_version）
   → 桌面端 OpsCenterSync 验签
       ├─ 验签失败 → 整包丢弃（fail-closed），沿用 L2 快照 / L3 种子
       └─ 验签通过 → applyRuntime 归一化 → 写内存 + 落 L2 快照
   → 渲染端 useOpsCenterRuntime / CreateView 读取 storyTextLimit
```

### 6.3 降级链（桌面端）

| 层 | 来源 | 何时命中 |
|---|---|---|
| L1 | 内存 `this._runtime.storyTextLimit` | 本次运行已成功同步过 |
| L2 | `settings.opsCenterRuntimeSnapshot` | 上次成功同步落盘的原始 payload |
| L3 | `resources/ops-seed/runtime-bootstrap.json` | 从未同步成功过的首装/离线 |
| L4 | 内置默认 `{ maxChars: 10000, warnPercent: 90 }` | 以上都为 `null`/非法 |

任一层拿到合法值即停止下降；每层都做同一套 normalize/clamp，**不允许**某一层跳过校验。

---

## 7. 功能逻辑（逐条规则）

### 7.1 计数口径

- 计数单位是 **Unicode 码点（code point）**，不是 UTF-16 `length`。
  实现：`countStory2VideoTextCharacters = countUnicodeCodePoints`（`Array.from(str).length`）。
- 因此：`'中'.repeat(10000)` → 10000；`'😀'.repeat(10000)` → 10000（`length` 会是 20000）。
  这条**改变不了也不能改**：emoji 若按 `length` 计会让用户在半数预算处就被截断。
- 计数为**实时**，无 debounce。输入事件同步计算，纯字符串长度，无 IO。
- 首尾空白不参与“是否为空”的判断（启动校验用 `trim()` 后的文本判定空），
  但**参与**计数（计数反映用户实际粘贴的字符数）。

### 7.2 三档视觉区间（由 `warnPercent` 驱动）

设 `count = 当前码点数`、`max = 生效上限`、`warn = 生效预警百分比`：

| 档位 | 判定 | 样式类 | 语义 |
|---|---|---|---|
| 中性 | `count < floor(max * warn / 100)` | `''` | 正常 |
| 警示 | `floor(max*warn/100) <= count < max` | `is-warning` | 接近上限；`title` 挂「接近字数上限」；`aria-live="polite"` |
| 危险 | `count >= max` | `is-danger` | 已达上限；计数后追加「（已达字数上限）」；`aria-live="polite"` |

- `warnPercent = 90`、`max = 10000` 时，警示起点为 `9000`。
- 边界取 `floor`，与既有实现一致（`Math.floor(max * 0.9)`），保证 `warn=90/max=10000` 时与历史行为逐值一致。
- `max <= 0`（理论不可达，防御）→ 档位视为中性，不抛错。

### 7.3 输入超限处理（`@input` 路径）

- 触发条件：当前选中流水线是编排型（`isOrchestratedPipeline`），且码点数 > 生效上限。
- 行为：把文本**截断到上限**（按码点 `slice`，不会切碎 emoji 的代理对），
  并弹一次错误提示 `story2video.text_too_long`（`{ max }` 用生效上限）。
- **不使用 `<textarea maxlength>`**：`maxlength` 按 UTF-16 计且会静默丢弃粘贴内容，
  与本产品「码点计数 + 显式告知被截断」的既有语义冲突。
- 截断是**幂等**的：截断后再次触发 `@input` 不会重复弹窗（因为长度已 <= 上限）。

### 7.4 启动前校验（`handleStartPipeline` 路径）

- 顺序（短路，先命中先提示）：
  1. 输入模式必须是「文案」（否则 `TEXT_INPUT_ONLY`）；
  2. `trim()` 后非空（否则 `TEXT_REQUIRED`）；
  3. 码点数 `<= 生效上限`（否则 `TEXT_TOO_LONG`，**不启动**）。
- 第 3 步是**最后一道闸**：即使前端截断逻辑被绕过（例如带文案进入的预填路径、
  批量创作路径），也不能把超长文本送进流水线。

### 7.5 带文案进入 / 切换流水线路径

- `/create?draft=xxx` 预填时**不截断**（保留原文，让用户看到完整草稿）。
- 在 `selectPipeline` 选中编排型流水线时**统一截断 + 提示**（此时用户已明确选择该流水线）。
- 截断阈值同样用生效上限。

### 7.6 批量创作路径

- 每条文案的上限 = 生效上限；占位符文案动态拼接生效值：
  `输入第 N 条文案（每条最多 {max} 字）`。
- 上限调低后旧草稿若超限：进入批量面板时按同规则截断 + 提示，不静默丢弃。

### 7.7 生效优先级与刷新时机

| 场景 | 行为 |
|---|---|
| 应用启动、CreateView `mounted` | 拉一次运行时配置，解析出上限 |
| 运营中心在应用运行期间改了值 | **本次运行不生效**（沿用既有「启动时同步一次」模型）；提示语必须让运营者知道这一点 |
| 拉取失败 / 通道未就绪 | 静默回落内置默认，**不弹错、不阻塞**，仅内存标记 `source='default'` |
| 用户切换流水线 | 沿用已解析的上限，不重新拉取（避免每次切换都打 IPC） |

### 7.8 与「错误文案识别」的关系

`TEXT_TOO_LONG_PATTERN` 原先把上限写死在正则里（`超过\s*6000|最多\s*6000`）。
上限可变后，该正则会把「超过 10000」判为**不匹配**，导致错误归因落空。
规则：正则改为**数字通配**（`\d{4,6}` 量级），两档（6000/10000）都必须命中；
新增测试同时锁定这两档，防止下一次调值再次漏改。

---

## 8. 交互逻辑

### 8.1 桌面端（创作者侧）

| 交互 | 触发 | 结果 | 失败/边界 |
|---|---|---|---|
| 输入/粘贴文案 | `input` 事件 | 实时更新计数；达阈值改色 | 超限 → 截断 + 弹窗 |
| 悬停警示态计数 | `mouseenter` | 原生 tooltip「接近字数上限」 | 中性/危险态无 tooltip |
| 点「启动流水线」 | `click` | 依次过 §7.4 三道闸 | 命中即弹窗并保持不启动；按钮 `title` 同步给出首个可修复项 |
| 粘贴超长 | `paste` → `input` | 同上 | 截断部分不进入模型上下文（已裁掉） |
| 切换流水线 | `selectPipeline` | 选中编排型时按生效上限截断 + 提示 | 非按码点截断会切碎 emoji，禁止用 `slice(0,max)` 直接切 UTF-16 |

### 8.2 运营中心（管理员侧）

| 交互 | 触发 | 结果 |
|---|---|---|
| 打开页面 | 路由 `/story-text-limit` | 表格加载；失败给 `ElMessage.error` + 空态文案 |
| 编辑字数上限 | `el-input-number` `change` | 越界/小数即行内红色校验提示，**不静默纠正**（未设 `:min`/`:max`/`:precision`），保存按钮整体禁用 |
| 保存 | `click` | `PUT` → 成功 `emitSaveMessage`（复用 `AppMenu.save-message.js`，含 `RESTART_HINT_DURATION`=6000ms）；失败显示后端中文 `detail` |
| 恢复默认 | `click` | 二次确认 → `POST /reset` → 同样带重启生效提示 |
| 切换启用 | `el-switch` | 随保存一起提交；关闭表示不下发该 scope |

> ⚠️ **生效时机必须说真话**：桌面端 `autoSyncOnStart()` 只在应用启动时 `setTimeout 3000` 同步一次，
> 全文件无 `setInterval`；`opsCenterSyncNow` 已于 2026-10-15 从渲染端删除，**应用端不暴露手动同步入口**。
> 因此所有提示语一律走运营中心既有单一真源 `src/constants/runtime-delivery.js` 的
> `RESTART_HINT_WHEN` / `RESTART_HINT_HOW` / `RESTART_HINT_DURATION`，**禁止**自写「最长 24h」「可手动同步」
> 这类无实现依据的表述（配套结构锁 `tests/restart-hint.test.js` C1 禁止第二份字面量）。

---

## 9. 显示项清单

### 9.1 桌面端 · 创建页（仅编排型流水线可见）

| 位置 | 显示内容 | 显示条件 | 样式/无障碍 |
|---|---|---|---|
| 文案 `textarea` 下方计数行 | `{count}/{max} 字符` | `isOrchestratedPipeline(selectedPipeline.name)` | 三档色阶（§7.2） |
| 同上 · 危险态后缀 | `（已达字数上限）` | `count >= max` | 同色阶 |
| 同上 · 警示态 tooltip | `接近字数上限` | `count >= floor(max*warn/100)` 且 `< max` | `title` |
| 同上 · 无障碍 | `aria-live="polite"` | 非中性档位时 | 读屏器播报档位变化 |
| 批量创作每条输入框占位符 | `输入第 N 条文案（每条最多 {max} 字）` | 批量面板 + 文本模式 | 动态值 |
| 超限弹窗 | `文案最多可输入 {max} 个字符，请缩短后再试。` | 截断或启动校验命中 | 错误对话框 |

> **本轮修掉的存量缺陷**：改动前模板写的是 `{{ story2videoTextCharacterCount }}/{{ MAX_STORY2VIDEO_TEXT_CHARACTERS }} 字符`，
> 而该常量只是模块级 `import`，不在 Vue 实例的 render proxy 上 ⇒ 计数行实际渲染为 `1234/ 字符`、
> 批量占位符渲染为 `每条最多 undefined 字`。现改为渲染 `story2videoTextMaxChars` 计算属性。

### 9.2 运营中心 · 字数控制页

| 位置 | 显示内容 | 说明 |
|---|---|---|
| 页面标题 | `字数控制` | — |
| 顶部说明块 | 「控制视频创作页各文案输入框的字数上限。故事讲述流水线的默认上限为 10000 字（历史为 6000 字）。修改后的配置将在应用下次启动时生效；如需立即生效请重启桌面应用。」 | 含历史值 + 真实生效时机 |
| 行为与生效说明（`el-alert`） | ①实时计数上限取自本页配置；②达预警阈值提示接近上限、超出截断并提示；③`EFFECT_NOTICE_SAVE` | — |
| 表格列 | 范围名称（+ scope 标签）/ 字数上限（字）/ 预警阈值（%）/ 启用 / 备注 / 更新时间（含操作人）/ 操作 | 行内编辑 |
| 卡片头部状态 | `共 N 项`、`● 有未保存的修改`、`● 有不合法的输入，请先修正标红项` | — |
| 允许范围脚注 | 「允许范围：字数上限 1000~50000（整数），预警阈值 50~99（整数）。输入框不会自动纠正取值：越界、小数或非法的值会被原样保留，并以行内提示拦截保存。」 | 区间由后端 `ranges` 驱动 |
| 恢复默认按钮 | `恢复默认` | 二次确认：`将「故事讲述」恢复为默认值：字数上限 10000 字 / 预警阈值 90%。此操作会立即覆盖当前的已保存配置，是否继续？` |
| 空态 | `暂无字数控制配置` | 目录为空时（正常不会出现） |
| 保存成功提示 | `已保存 1 项；将在应用下次启动时生效；如需立即生效请重启桌面应用` | 6000ms |
| 恢复成功提示 | `已恢复默认（10000 字 / 90%）；将在应用下次启动时生效；如需立即生效请重启桌面应用` | 6000ms |

---

## 10. 提示文字清单

### 10.1 桌面端（locales 成对，zh/en 同步）

| 场景 | key | zh | en | 来源 |
|---|---|---|---|---|
| 接近上限 tooltip | `create.story2video.ui.charLimitWarning` | `接近字数上限` | `Close to the character limit` | `apps/desktop/src/locales/create/{zh,en}.js` |
| 已达上限后缀 | `create.story2video.ui.charLimitReached` | `（已达字数上限）` | ` (character limit reached)` | 同上 |
| 超限错误 | `story2video.text_too_long` | `文案最多可输入 {maxFormatted} 个字符，请缩短后再试。` | `Your script can contain up to {maxFormatted} characters. Please shorten it and try again.` | `apps/desktop/src/locales/story2video/{zh,en}.js` |
| 批量占位符 | `create.story2video.batch.textPlaceholder` | `输入第 {index} 条文案（每条最多 {max} 字）` | `Enter text {index} (max {max} chars each)` | `apps/desktop/src/locales/create/{zh,en}.js` |

> **locale 成对**：任何新增/修改用户可见文案必须 zh/en 同时提交（CI Gate 7 拦截），
> 且不得在 `src/` 非 locales 文件里新增中文字面量（CI 基线扫描拦截）。
> 本轮**没有新增 locale 键**——只把既有键里的数字从写死 6000 变成本轮生效值。

### 10.2 运营中心（中文，运营后台单语）

| 场景 | 文案 |
|---|---|
| 区间校验（字数上限） | `字数上限需为 1000~50000 的整数` |
| 区间校验（预警阈值） | `预警阈值需为 50~99 的整数` |
| 区间校验（备注） | `备注最多 200 字` |
| 保存成功 | `已保存 1 项；将在应用下次启动时生效；如需立即生效请重启桌面应用`（6000ms） |
| 恢复默认成功 | `已恢复默认（10000 字 / 90%）；将在应用下次启动时生效；如需立即生效请重启桌面应用`（6000ms） |
| 恢复默认二次确认 | `将「故事讲述」恢复为默认值：字数上限 10000 字 / 预警阈值 90%。此操作会立即覆盖当前的已保存配置，是否继续？` |
| 顶部说明（含真实生效时机） | `控制视频创作页各文案输入框的字数上限。故事讲述流水线的默认上限为 10000 字（历史为 6000 字）。修改后的配置将在应用下次启动时生效；如需立即生效请重启桌面应用。` |
| 保存失败（通用） | `保存失败：{后端 detail}`（如 `字数上限需为 1000~50000 的整数`） |
| 空态 | `暂无字数控制配置` |

> 后端 `_MSG_MAX_CHARS` / `_MSG_WARN_PERCENT` / `_MSG_NOTE_TOO_LONG` 与本表前 3 行**逐字一致**，
> 前后端各留一份会漂移，因此前端单测直接与后端常量做跨语言比对。

---

## 11. 边界与异常

| 编号 | 场景 | 期望行为 |
|---|---|---|
| E1 | 运营中心不可达 / IPC 通道未就绪 | 内置默认 10000/90；不弹错、不阻塞创作 |
| E2 | 块为 `null`（enabled=false 或读库异常） | 内置默认 |
| E3 | `maxChars` 是字符串 `"12000"` | **不**隐式转换（防止 `"12000abc"` 这类脏值），回落默认；`source='default'` |
| E4 | `maxChars = 1.5` / `NaN` / `Infinity` | 回落默认（同时说明：这类值若真进了 bootstrap，服务端 `config_hash` 已先抛错） |
| E5 | `maxChars` 越界（如 100 / 99999999） | 回落默认，不 clamp 到边界（**故意**：clamp 会让「运营配错了」看起来像生效了） |
| E6 | `warnPercent` 越界（如 5 / 150） | 仅 warnPercent 回落 90，maxChars 照常生效 |
| E7 | 运营把上限从 10000 调低到 5000 | 客户端下次同步后：新输入按 5000 截断；已输入但未启动的文本在 `@input` 时被截断并提示 |
| E8 | 用户在输入框中已有 9500 字，运营把上限调成 5000 | 用户不在输入则不变；一旦再次输入触发 `@input` → 截断到 5000 + 提示（**不静默**） |
| E9 | 粘贴 20000 字 | 一次 `@input` 后截断到上限 + 单次提示 |
| E10 | emoji / 组合字符 | 按码点计数与截断，不切碎代理对；`'😀'` 计 1 |
| E11 | 流水线非编排型（图片/视频/录屏） | 不显示计数行、不截断（既有行为不变） |
| E12 | 带文案进入但未选流水线 | 不截断（保留原文）；选中编排型时才截断 |
| E13 | 运营下发值恰好等于区间端点（1000 / 50000 / 50 / 99） | **合法生效**（端点闭区间），有测试锁定 |

---

## 12. 兼容与迁移

- **向后兼容**：老客户端不认识 `storyTextLimit` 块 → 忽略（fail-open），继续用 6000（旧版本行为），不崩。
- **升级后**：新客户端未配置运营项 → 10000（本次目标值）。
- **运营侧迁移**：首次打开「字数控制」页面时自动 provision 出 `story2video` 默认行（10000/90），
  运营者无需手工新增；已存在的值不会被 provision 覆盖。
- **无数据迁移脚本需求**：新表 + 目录 provision 即可，不触碰既有表。

---

## 13. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | `resolveStory2VideoTextLimit` 是纯函数、O(1)、无 IO；只在页面挂载/切换时调用一次，不进改字高频路径 |
| 安全 | 该配置经 Ed25519 签名覆盖；写接口 `require_admin`；不涉及密钥/凭据 |
| 可观测 | 解析回落时记一条 WARN（不刷屏：只在值变化时记） |
| 可测试 | 解析函数 12+ 单测；后端 CRUD/校验/bootstrap 各一组；跨端 `RUNTIME_BLOCKS` 数量有锁（14） |
| 可访问性 | 计数档位 `aria-live="polite"`，警示态 `title` |

---

## 14. 验收标准（可逐条实测）

1. 未配置时，创建页计数分母显示 `10000`。
2. 粘贴 `'中'.repeat(10000)` → 计数 `10000/10000`，可启动。
3. 粘贴 `'中'.repeat(10001)` → 截断到 10000 并弹「文案最多可输入 10000 个字符」。
4. `'😀'.repeat(10000)` 计为 10000（不是 20000）。
5. 计数达 9000 起变警示色并有 tooltip「接近字数上限」。
6. 运营中心「字数控制」页面可保存 12000；`GET /api/v1/runtime/bootstrap` 的
   `storyTextLimit.story2video.maxChars == 12000`。
7. 模拟下发 12000 后重新进入创建页 → 计数分母显示 `12000`，12000 字可启动。
8. 模拟下发非法值（如 `"abc"` / `1.5` / `999999`）→ 分母仍 `10000`，无报错。
9. `RUNTIME_BLOCKS` 两端均为 **14** 项且集合完全一致。
10. `config_hash` 对同一 payload 两端算出同一值（固定向量测试仍绿）。

---

## 15. 测试矩阵

| 层 | 文件 | 覆盖 |
|---|---|---|
| 桌面端 · 纯函数 | `apps/desktop/src/story2video/story-text-limit.test.js` | 合法/`null`/缺键/字符串数字/浮点/越界/负数/端点/警告回调 |
| 桌面端 · 常量与计数 | `apps/desktop/src/story2video/notifications.test.js` | 默认常量 10000、码点计数 6000/10000 两档 |
| 桌面端 · 错误识别 | `apps/desktop/src/story2video/notification-error-patterns.test.js` | `TEXT_TOO_LONG_PATTERN` 命中 6000 与 10000 |
| 桌面端 · 视图 | `apps/desktop/src/views/CreateView.test.js` | 计数分母/截断阈值/启动校验跟随生效值；非法值回落 |
| 桌面端 · 主进程 | `electron/services/ops-runtime-snapshot.test.js` | `RUNTIME_BLOCKS` 14 项、含 `storyTextLimit`、canonical hash 向量 |
| 桌面端 · 主进程 | `electron/services/ops-center-sync.test.js` | `applyRuntime` 归一化 `storyTextLimit`、`getRuntimeState` 透传 |
| 运营中心 · 后端 | `ops-center/backend/tests/test_story_text_limit_api.py` | CRUD、越界 400、provision 语义、bootstrap 形状 |
| 运营中心 · 后端 | `ops-center/backend/tests/test_runtime_resilience_api.py` | `len(RUNTIME_BLOCKS) == 14`、hash 稳定性 |
| 运营中心 · 前端 | `ops-center/frontend/src/**` + `npm run build` | 页面可构建、菜单项存在 |

---

## 16. 风险与未决

| 风险 | 等级 | 缓解 |
|---|---|---|
| 漏改一端 `RUNTIME_BLOCKS` → 两端 hash 不一致 → ACK 永不被认可 | 高 | 两端都有显式数量断言（14）+ 固定向量测试；README/注释写死「必须成对改」 |
| 运营把上限调得很低（如 1000）导致老用户草稿被截断 | 中 | 页面说明 + 截断时**显式弹窗**（不静默）；区间下界 1000 已足够保守 |
| `config_hash` 被非整数污染（若将来有人加浮点字段） | 中 | 两端已有 fail-closed 断言，且本轮明确用百分比整数 |
| 用户以为「保存后立刻生效」 | 中 | 页面与提示语均写明「下次配置同步生效」 |
| 10000 字是否仍不够 | 低 | 上限可配（区间到 50000），无需再发版 |

**未决（后续可做，不在本轮）**：把生效的 `source`（ops-center / default）显示在运营面
「生效看板」上，让运营者能确认某台客户端实际用的是哪一档。

---

## 17. 关联文档

- `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §4（字符计数上限条款，本轮同步更新）
- `openspec/records/story-text-limit-control.md`（门禁执行记录）
- `CHANGELOG.md`（本轮变更条目）
- 既有相邻机制参考：`ops-center/backend/services/app_menu_service.py`（目录供给 +
  fail-closed 写 / fail-open 读）、`apps/desktop/electron/services/ops-runtime-snapshot.js`
  （`config_hash` 与三层降级）
