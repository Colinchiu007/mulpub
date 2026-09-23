# PRD：模型列表排序逻辑调整（已配置/全部 双规则 + 运营中心自定义排序）

- 日期：2026-09-23
- 状态：已批准（用户直接需求）
- 影响范围：apps/desktop（渲染端模型设置页、electron 主进程同步链路）、ops-center（后端 ModelPreset、前端预设模型页）
- 关联文档：`01-docs/PRD-sync-zero-config.md`（目录同步契约）、`01-docs/PRD-AGNES-MULTIMODAL-CAPABILITY-DISPLAY-FIX-2026-09-19.md`（applyCatalog config 合并语义）

## 1. 背景与目标

「设置 → 模型配置」（ModelProviders 页）的模型卡片列表目前没有任何排序逻辑，实际顺序为主进程 SQL 的 `ORDER BY category, is_default DESC, is_preset DESC, name ASC`，两个标签页（「已配置」/「全部」）共用同一顺序，用户无法快速找到最近调整的模型，也无法把运营侧希望置顶的模型排在前面。

目标：

1. **「已配置」标签**：默认按最新修改（含新添加）的次序倒序排列；其中「设为默认」的模型优先置顶。
2. **「全部」标签**：默认按字母与中文拼音次序升序排列；运营中心可为每个预设模型配置自定义排序，自定义排序优先于拼音序。
3. **运营中心「预设模型」页**：为所有模型（含隐藏项）提供自定义排序功能，用图标按钮实现 上移 / 下移 / 移到首位 / 移到末位，点击即时保存。

## 2. 名词与数据模型

| 名词 | 含义 |
| --- | --- |
| `updated_at` | 桌面端 `model_providers` 表列，sqlite `datetime('now')` 字符串（UTC）。添加、编辑、设默认、删除均更新 |
| `is_default` | 桌面端某类别下的默认模型标记（每类别至多 1 个） |
| `is_configured` | 渲染端判断「已配置」的依据（`p.is_configured === true`，即已填 api_key） |
| `sort_order` | 本次新增字段：运营中心 `model_presets.sort_order`（INTEGER，可空）。NULL=未参与自定义排序 |
| catalog | 运营中心 `/api/v1/model-presets/catalog` 只读同步端点，桌面端 `applyCatalog` 消费 |

### 2.1 ops-center 数据变更

- `ModelPreset` 新增列 `sort_order INTEGER NULL`（默认 NULL）。
- 迁移方式：沿用 `ensure_model_preset_columns` 幂等模式，PRAGMA table_info 检查后 `ALTER TABLE model_presets ADD COLUMN sort_order INTEGER`，无需 Alembic。
- 语义：NULL 表示「运营人员从未手动排过序」；非 NULL 为 0..n-1 的连续整数（服务端每次重排后归一化，保证无空洞、无重复）。

### 2.2 桌面端数据变更

- 不新增数据库列。`sort_order` 经 catalog 同步写入 `model_providers.config` JSON 的 `sort_order` 键（与 `rate_per_minute`/`limit_per_5h` 同模式：目录权威——catalog 项带数字则写入，带 null/缺失则删除该键）。

## 3. 排序规则（功能逻辑）

### 3.1 「已配置」标签（viewMode === 'configured'）

比较器（依次短路）：

1. `is_default === true` 的排在最前（默认模型置顶，多个默认——不同类别各一个——都置顶，相互之间按规则 2/3）；
2. 按 `updated_at` 倒序（最新修改/新添加在前）；sqlite datetime 字符串 `YYYY-MM-DD HH:MM:SS` 字典序即时间序，直接字符串比较；`updated_at` 缺失按最旧处理；
3. `updated_at` 相同（同秒批量导入）时按 `name` 拼音升序兜底，保证顺序稳定。

实现位置：渲染端 `useModelProviderCrud.js` 的 `filteredProviders` computed（`viewMode` 分支），不在主进程 SQL 排序中实现（「全部」需要拼音序，SQL 侧无法可靠做 zh 拼音，且两 Tab 共用同一 IPC 数据源）。

### 3.2 「全部」标签（viewMode === 'all'）

比较器（依次短路）：

1. 有自定义排序值的在前：`config.sort_order` 为**非负整数**时参与，按其升序；两者都有且值相同（理论不应出现，防御）按名称拼音兜底；
2. 无自定义排序值的在后：按 `name` 使用 `localeCompare(other, 'zh-Hans-CN')` 排序（字母 A-Z 与中文拼音 a-z 混排，ICU 默认排序权重：标点→数字→字母/拼音）；
3. 名称比较结果为 0 时按 `id` 字典序兜底，保证全序稳定（幂等渲染，不抖动）。

校验规则（渲染端解析 `config.sort_order`）：仅接受 `typeof === 'number' && Number.isFinite && >= 0`；字符串数字、负数、NaN、null、undefined 一律视为「无自定义排序」。

### 3.3 与类别筛选（filterCategory）的关系

排序发生在类别筛选之后（对过滤结果排序），规则不变；「已配置」Tab 内部同样适用 3.1。

## 4. 运营中心「预设模型」页交互逻辑

### 4.1 显示项

- 表格新增「排序」列（宽约 70，居中）：显示当前 `sort_order` 数字；NULL 显示 `-`。
- 操作列新增 4 个图标按钮（Element Plus 图标，`el-button link`，带 `title` 悬浮提示）：
  - ⤒ 移到首位（`Top` 图标）
  - ↑ 上移一位（`ArrowUp` 图标）
  - ↓ 下移一位（`ArrowDown` 图标）
  - ⤓ 移到末位（`Bottom` 图标）
- 首行禁用「移到首位/上移」，末行禁用「移到末位/下移」（`:disabled`，按钮置灰）。边界以**当前可见序列**为准；任意分类筛选/含隐藏开关下按钮均可用（所见即所得，见 §4.5，初版灰显锁 sortLocked 已移除）。
- 页面说明文字追加：排序决定桌面端「全部」标签的展示次序（拼音序为未自定义时的默认），调整后桌面端需同步（重启或手动同步）才生效。

### 4.2 排序语义与 API

- 排序对象是**所见即所得的当前可见序列**（2026-09-23 refinement 后语义，初版为「全局列表 + 筛选视图灰显锁」，见 §4.5；与 AppMenu 不同，不分类别组）：服务端以「当前列表显示顺序」为基准做移动。显示顺序 = `ORDER BY sort_order IS NULL, sort_order ASC, name ASC`（与桌面端「全部」Tab 规则一致，NULLS LAST + 拼音兜底由 Python 侧以名称自然序近似，SQL 层用 `name` 兜底）。
- 新增端点：`POST /api/v1/model-presets/{preset_id}/reorder`（**admin-only**，`require_admin`）。
  - 请求体：`{ "action": "top" | "up" | "down" | "bottom", "visible_ids": [id, ...]? }`（`visible_ids` 为前端当前可见/筛选序列按显示序的 id 列表，可选；语义见 §4.5）
  - 校验：`preset_id` 不存在 → 404；action 不在枚举内 → 400；
  - 处理：取全量预设（含隐藏）按上述显示序排成列表 → 将目标行移动到对应位置 → 全列表归一化 `sort_order = 0..n-1`（一次事务批量 UPDATE，含原本 NULL 的行也一并赋值？——**否**：仅对「参与过排序」的语义做最小扰动，采用简单方案：移动后整个可见列表归一化赋值 0..n-1，即一次 reorder 后所有预设都获得显式 sort_order。这是可接受的：用户一旦开始排序，列表即为权威顺序。）
  - 响应：`{ "presets": [...], "count": n }`（同 GET 列表结构，前端直接刷新表格）。
- 边界：目标行已在首位点「上移/移到首位」→ 幂等返回 200（不报错，不写库）；列表仅 1 行时同理。

### 4.3 提示文字（ops-center 前端，中文硬编码与该页面现状一致）

- 成功：`ElMessage.success('排序已更新')`
- 失败：`ElMessage.error(e.response?.data?.detail || '排序更新失败')`
- 按钮 title：`移到首位` / `上移` / `下移` / `移到末位`
- 说明段落补充文案：「可通过操作列的排序按钮调整桌面端【全部】列表的展示次序：⤒ 移到首位、↑ 上移、↓ 下移、⤓ 移到末位，点击即时保存。未设置排序的模型按名称拼音/字母序排在已排序模型之后。」

### 4.4 catalog 契约扩展

`_to_catalog_item` 新增字段 `"sort_order": row.sort_order`（int 或 null）。桌面端 `applyCatalog` 将其写入 provider `config.sort_order`；null/缺失时删除该键（目录权威，运营清空排序后桌面端回退拼音序）。

### 4.5 Refinement（2026-09-23）：所见即所得排序作用域

用户报告缺陷：初版实现的灰显锁 `sortLocked = Boolean(filterCategory) || !includeHidden` 在默认视图（`includeHidden` 默认关闭）下恒为真，4 个排序按钮进入页面即全部灰显不可用。修复为「所见即所得」语义：

- 请求携带 `visible_ids`（前端当前可见/筛选序列，按显示序）时：服务端只在「可见行原本占据的顺序槽」内移动目标行（slots = 全量显示序中可见行的位置集合，在槽位集合内 pop/insert 后原位写回），序列外行（隐藏项、其它类别）**绝对位置不变**；
- `visible_ids` 缺省（None）时退化为全量列表内移动（向后兼容旧调用）；传**空列表**视为空作用域，一律 not-found → 404（CodeReview 修复：不得因真值判断误落全量分支静默改写全表顺序）；
- 目标 id 不在作用域内 → 404（fail closed，杜绝「点了没变化」的错位写入）；`visible_ids` 非数组 → 400；
- 两种模式移动后仍对全列表 `sort_order` 归一化 0..n-1（首次排序物化 NULL）；
- 前端 `reorderModelPreset(id, action, visibleIds)` 提交 `presets.value.map(p => p.id)`；删除 sortLocked computed、灰显 title 与警告文案，按钮 `:disabled` 仅保留可见序列首末行边界与 busy 态；
- 前端表格 `presets` 直绑服务端列表结果且无客户端排序/分页，`$index` 与服务端槽位序一致；服务端以自身 `_display_order()` 重取交集为准（忽略前端传入顺序），天然防篡改。
- 回归测试（`test_model_presets_api.py`）：不连续可见序列 `[0,2,3]` 判别槽位置换语义（作用域外行绝对位置不动）、序列内边界 noop、目标越界 404、空序列 404。

## 5. applyCatalog 的 updated_at 污染修复（关键前置）

现状隐患：`applyCatalog` 每次同步对**所有** catalog 行执行 `UPDATE ... updated_at = datetime('now')`，导致「已配置按最新修改排序」被每次后台同步重置，语义失效。

修复规则：UPDATE 前先比对实际要写入的列值（`config` JSON 语义比较——解析后 deep-equal、`base_url`、`models`、`capabilities` 等本次会写的字段）。**内容无实质变化则跳过该行 UPDATE（不 bump updated_at）**；有变化（含首次插入、sort_order 变更、限流变更）才更新并 bump `updated_at`。新增行 INSERT 照常 bump（新添加=最新修改，符合 3.1 语义）。

## 6. 桌面端文案（i18n）

- 「已配置」Tab 排序变化无新增用户可见文案；helper 文案不新增，`zh.js`/`en.js` 无需改动（如实现中发现需要，必须成对提交，CI Gate 7 拦截）。

## 7. 验收标准

1. 「已配置」Tab：新添加/编辑某模型后它排第一；设为默认的模型始终排最前；同默认模型之间按更新时间倒序。
2. 「全部」Tab：无任何 sort_order 时，列表按名称拼音/字母升序（中文「阿里」排在「百度」前，英文字母按 A-Z 穿插）；运营中心把某模型「移到首位」并同步后，该模型排第一，其余保持拼音序。
3. 运营中心预设模型页：4 个按钮功能正确、边界禁用正确、点击即保存、刷新后顺序保持；隐藏项同样可参与排序。
4. 同步稳定性：连续两次执行「同步运营中心」后，「已配置」Tab 顺序不变（updated_at 未被无变化行污染）。
5. 回归：既有 filteredProviders、applyCatalog、model-presets API 测试全绿；新增测试覆盖本 PRD 第 8 节矩阵。

## 8. 测试矩阵（TDD 先行）

| 层 | 文件 | 用例 |
| --- | --- | --- |
| 渲染端单元 | `useModelProviderCrud.test.js` | 已配置：默认置顶/updated_at 倒序/缺失兜底/同秒按名；全部：拼音序（中文+英文混排）/sort_order 优先/非法 sort_order（字符串/负数/NaN）忽略/稳定性（同输入同输出） |
| 主进程单元 | `model-provider-apply-catalog.test.js` | sort_order 写入/删除（null 目录权威）；无变化跳过 UPDATE 不 bump updated_at；有变化 bump；新增行 bump |
| ops-center 后端 | `test_model_presets_api.py` | reorder 四动作正确性+归一化 0..n-1；404/400/403（非 admin）；幂等边界（首位上移）；列表排序 NULLS LAST；catalog 响应含 sort_order（int 与 null） |
| ops-center 前端 | build 门禁 | `npm run build` 通过 |

## 9. 非功能需求

- 排序为纯内存比较，O(n log n)，n≈百级，无性能影响。
- 不改变既有 IPC 契约（`_safeRow` 已返回 `updated_at`/`config`/`is_default`）。
- 数据库迁移幂等，老库升级自动加列，无数据回填（NULL=未排序，行为向后兼容）。

## 10. 决策记录

| 决策 | 理由 | 被否方案 |
| --- | --- | --- |
| 排序放渲染端 computed | 两 Tab 共用数据源；拼音排序需 ICU localeCompare（JS 侧最可靠）；改动面最小 | 主进程 SQL ORDER BY（sqlite 无拼音 collation） |
| sort_order 存 config JSON 而非新列 | 复用 applyCatalog 既有 config 合并/目录权威模式，零桌面端 schema 迁移 | model_providers 加列（需迁移+改 _safeRow） |
| 运营中心即时 reorder API 而非拖拽批量保存 | 表格有类别筛选/隐藏开关，脏状态跨筛选不可靠；AppMenu 批量模式不适配 | vuedraggable 拖拽+保存按钮（与表格分页/筛选冲突） |
| reorder 后全列表显式赋值 0..n-1 | 简单、无空洞、语义清晰；「一旦开始排序即全量权威」 | 只动相邻两行（NULL 混排时产生负数/小数序，复杂） |
| applyCatalog 无变化跳过 UPDATE | 「最新修改」必须只反映真实修改，否则被后台同步周期性打乱 | 保持现状（语义不可用） |
