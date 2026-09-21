# 应用菜单（运营中心 → 应用端侧边栏）

> 版本：v1.0 · 日期：2026-09-15 · 状态：已实现（待合并）
> 分支：`app-menu-config` · worktree：`D:\Data\projects\mp-worktrees\mp-app-menu-config`
> 关联：`01-docs/PRD.md`（应用菜单章节）、`CHANGELOG.md`

---

## 1. 背景与目标

### 1.1 问题

应用端（桌面端）左侧边栏的菜单项此前**完全硬编码**在 `apps/desktop/src/layouts/MpSidebar.vue` 中：

- 无法按客户/客户群灰度调整可见菜单；
- 无法调整菜单顺序以突出业务重点；
- 每次调整都需要改代码 → 发版 → 用户升级，链路长。

### 1.2 目标

在**运营中心**新增「应用菜单」页面，用于管理应用端左侧边栏菜单项的：

1. **显示 / 隐藏**
2. **组内排序**

其中「发布、账号、采集、视频创作」四项为系统核心入口，**强制显示**，运营端开关灰显不可关闭。

### 1.3 非目标（明确不做）

| 项目 | 说明 |
|------|------|
| 自定义菜单项（新增/删除） | 菜单项集合由应用端代码定义，运营端只能调显隐与顺序。避免运营端下发不存在的路由。 |
| 重命名菜单文案 | 文案涉及 i18n 与品牌一致性，不在本期范围。 |
| 跨组穿插排序 | 一级导航（平铺）与「更多」（折叠面板）结构不同，无法跨组穿插。仅支持组内排序。 |
| 按用户/版本差异化 | 本期为全量下发；按用户群灰度由后续 feature flag 叠加。 |
| 实时推送 | 沿用既有 bootstrap 拉取模型，修改后需重新同步或重启才生效。 |

---

## 2. 名词与范围

| 名词 | 定义 |
|------|------|
| 菜单项（item） | 侧边栏中一个可点击入口，由 `key` 唯一标识 |
| 分组（group） | `primary` = 一级导航（平铺在侧边栏）；`more` = 「更多」折叠面板内 |
| 强制显示项（forced） | 运营端不可关闭的菜单项：发布 / 账号 / 采集 / 视频创作 |
| 下发（bootstrap） | 运营中心 → 应用端的只读配置分发，走 `GET /api/v1/runtime/bootstrap`（Ed25519 签名） |
| fail-open | 应用端在配置缺失/异常时回退本地默认（全部可见 + 定义顺序），不阻塞导航 |
| fail-closed | 运营端在写入非法数据时拒绝请求（400），不落库 |

### 2.1 菜单目录（契约，共 19 项）

| # | key | 展示名 | 分组 | 强制显示 | 应用端路由 |
|---|-----|--------|------|:--------:|-----------|
| 1 | `home` | 主页 | primary | | `/` |
| 2 | `publish` | 发布 | primary | ✅ | `/publish/history` |
| 3 | `accounts` | 账号 | primary | ✅ | `/accounts` |
| 4 | `dashboard` | 数据 | primary | | `/dashboard` |
| 5 | `create` | 视频创作 | primary | ✅ | `/create` |
| 6 | `collection` | 采集 | primary | ✅ | `/collection` |
| 7 | `monitor` | 监控 | more | | `/monitor` |
| 8 | `calendar` | 发布日历 | more | | `/calendar` |
| 9 | `comments` | 私信评论 | more | | `/comments` |
| 10 | `cloud-publish` | CLI | more | | `/cloud-publish` |
| 11 | `library` | 素材库 | more | | `/library` |
| 12 | `keywords` | 关键词监控 | more | | `/keywords` |
| 13 | `viral` | 爆款分析 | more | | `/viral-analysis` |
| 14 | `prompt-eval` | 提示词评估 | more | | `/prompt-eval` |
| 15 | `rewrite` | 文案改写 | more | | `/rewrite` |
| 16 | `hot-topics` | 热门选题 | more | | `/hot-topics` |
| 17 | `model-providers` | 模型提供商 | more | | `/model-providers` |
| 18 | `knowledge-base` | 知识库 | more | | `/knowledge-base` |
| 19 | `performance-insights` | 数据洞察 | more | | `/performance-insights` |
| 20 | `member-center` | 会员中心 | more | | `/member-center` |

> **契约规则**：`key` 一旦发布**不得改名**（改名 = 旧配置失效）。应用端新增菜单项时，运营端未同步前该项按「可见 + 排在组内最后」处理，不会消失。

---

## 3. 数据模型

### 3.1 新增表 `app_menu_items`（ops-center 侧）

文件：`ops-center/backend/models.py` → `class AppMenuItem`

| 字段 | 类型 | 约束 | 默认 | 说明 |
|------|------|------|------|------|
| `id` | Integer | PK, autoincrement | — | 主键 |
| `item_key` | String(64) | **UNIQUE, NOT NULL** | — | 与桌面端 `sidebar-menu.js` 的 key 对齐 |
| `label` | String(100) | | `""` | 运营端展示名（目录冗余，便于列表展示） |
| `group` | String(16) | NOT NULL | — | `primary` \| `more` |
| `visible` | Integer | | `1` | 1 = 显示，0 = 隐藏 |
| `forced_visible` | Integer | | `0` | 1 = 强制显示（运营端开关灰显） |
| `sort_order` | Integer | | `0` | 组内排序值，越小越靠前 |
| `description` | String(200) | | `""` | 运营端「说明」列内容 |
| `updated_at` | String | | utcnow ISO | 最后修改时间 |
| `updated_by` | String(100) | | `""` | 最后修改人（运营账号 username） |

### 3.2 种子数据规则

- **触发时机**：首次调用 `list_items` / `upsert_items` / `reset_items` / `get_bootstrap_app_menu` 时任一个（`_seed_if_empty`）。
- **幂等**：仅当表内记录数为 0 时播种。
- **初始值**：`visible=1`（全部可见）；`sort_order` = 目录中的全局序号（0..19）；`forced_visible` 按 `FORCED_VISIBLE_KEYS` 置位。

### 3.3 应用端存储（不新增表）

应用端**不新增数据表**。运营配置随运行时策略快照一起落在既有 `settings` 表中：

| setting key | 内容 |
|-------------|------|
| `opsCenterRuntime` | 运行时策略快照 JSON，新增 `appMenu` 字段：`{ items: [{key, visible, sort_order}], syncedAt }` |

---

## 4. API 契约

前缀：`/api/v1/app-menu` · 实现：`ops-center/backend/routers/app_menu.py`

### 4.1 `GET /api/v1/app-menu`

列出全部菜单项。

- **鉴权**：`get_current_user`（登录即可，与 `/pipeline-options` 同口径）
- **响应 200**：

```json
{
  "items": [
    {
      "id": 2, "item_key": "publish", "label": "发布", "group": "primary",
      "visible": true, "forced_visible": true, "sort_order": 1,
      "description": "强制显示：核心发布入口",
      "updated_at": "2026-09-15T04:00:00Z", "updated_by": "admin"
    }
  ],
  "count": 19,
  "forced_visible_keys": ["publish", "accounts", "create", "collection"],
  "max_items": 200
}
```

> `forced_visible_keys` 供前端对开关做灰显；服务端仍会二次强制纠正，前端灰显只是体验层。

### 4.2 `PUT /api/v1/app-menu`

批量保存显示 / 隐藏与排序。

- **鉴权**：`require_admin`（非管理员 → **403**）
- **请求体**：

```json
{
  "items": [
    { "item_key": "home", "visible": false, "sort_order": 0 },
    { "item_key": "publish", "visible": true, "sort_order": 1 }
  ]
}
```

- **响应 200**：

```json
{
  "items": [ /* 保存后的全量列表，同 GET */ ],
  "corrections": ["publish"],
  "count": 19
}
```

- **语义**：
  - **部分提交**允许：只提交需要改动的项；未提交项的 `visible` / `sort_order` 保持不变。
  - **整体原子**：任一条校验失败 → 400，**整批不写入**（不做部分成功）。
  - `corrections`：被服务端强制纠正为可见的强制显示项 key 列表（正常流程为空）。

### 4.3 `POST /api/v1/app-menu/reset`

恢复默认：全部可见 + 目录默认顺序。

- **鉴权**：`require_admin`
- **响应 200**：`{ "items": [...], "count": 19 }`

### 4.4 下发：`GET /api/v1/runtime/bootstrap`（既有端点扩展）

- **鉴权**：header `X-Catalog-Key`（错误 → **401**；未配置签名私钥 → **404**）
- **新增字段** `appMenu`：

```json
{
  "...其他策略...": "...",
  "appMenu": {
    "items": [
      { "key": "home", "visible": false, "sort_order": 0 }
    ],
    "synced_at": "2026-09-15T04:00:00Z"
  },
  "signature": "<base64 Ed25519>"
}
```

- **关键约束**：`appMenu` 位于**签名覆盖范围内**（`sign_runtime_payload` 对整个 payload 的 canonical JSON 签名），因此无法被中间人单独篡改。
- **下发前二次纠正**：即使数据库被直接改坏（`publish.visible=0`），`get_bootstrap_app_menu` 也会把强制项纠正为 `visible=true` 再下发。
- **载荷含 `group`（2026-09-16 撤销 D-GRP）**：下发项含 `key` / `visible` / `sort_order` / `group` 四个字段。
  原 D-GRP（仅下发三者、剥离 group）于 2026-09-15 落地，理由是避免「被签名但被忽略」字段诱导跨分组穿插；
  但 2026-09-16 上线「一级导航 ↔ 更多 跨组移动」管理后，group 成为跨端契约的必要字段，故撤销该限制，
  `get_bootstrap_app_menu` 现随载荷下发 `group`，由应用端 `sidebar-menu-merge` 据下发值决定菜单项归属
  （配置 group 非法/缺失时 fail-open 回退本地定义）。守卫测试：
  `test_bootstrap_app_menu_items_include_group`。

---

## 5. 数据校验规则

### 5.1 服务端（写入，fail-closed）

| # | 校验项 | 规则 | 失败响应 | 中文提示 |
|---|--------|------|----------|----------|
| V1 | `items` 类型 | 必须为数组 | 400 | `items 必须为数组` |
| V2 | 条目数量 | 长度 ≤ 200 | 400 | `菜单项数量超过上限 200` |
| V3 | 条目类型 | 每项必须为对象 | 400 | `items 中的每一项都必须是对象` |
| V4 | `item_key` 非空 | 去空格后非空 | 400 | `item_key 不能为空` |
| V5 | `item_key` 合法性 | 必须存在于目录（19 项） | 400 | `未知菜单项：<key>` |
| V6 | 重复提交 | 同批内 `item_key` 不可重复 | 400 | `菜单项重复提交：<key>` |
| V7 | `sort_order` 非法 | 空 / 非数字 / 负数 → **保留原值**（不归零） | — | 无（静默保留，避免误改排序） |
| V8 | `sort_order` 上限 | > 9999 → 截断为 9999 | — | 无 |
| V9 | `visible` 解析 | 白名单为真：`true` / `1` / `"1"` / `"true"`；其余（含 `"false"`、`null`、对象）视为隐藏 | — | 无 |
| V10 | 强制项保护 | 强制项被提交 `visible=false` → **纠正为可见** + 记入 `corrections` | 200 | 前端提示（见 §10） |

### 5.2 应用端主进程（读取，结构净化）

文件：`apps/desktop/electron/services/app-menu-config.js` → `normalizeAppMenu()`（2026-09-16 债务熔断拆分：已从 ops-center-sync.js 迁出）

| # | 校验项 | 规则 | 结果 |
|---|--------|------|------|
| N1 | 整体结构 | 非对象 / `items` 非数组 → **返回 `null`** | 渲染端 fail-open |
| N2 | 条目数量 | > 200 → 整体拒绝返回 `null` | 渲染端 fail-open |
| N3 | 原型污染 key | `__proto__` / `constructor` / `prototype` → 丢弃该条 | 其余保留 |
| N4 | 空 key / 非对象条目 | 丢弃该条 | 其余保留 |
| N5 | `sort_order` | 非有限数 / 负数 → `null`（渲染端视为未配置）；> 9999 → 截断 | — |
| N6 | `visible` | 同 V9 白名单 | — |
| N7 | `group` 透传（2026-09-21 契约修复） | 仅白名单原文 `'primary'` / `'more'` 透传；其余（含大小写变体/缺失）归一化为 `null` | 渲染端按本地定义分组 fail-open |

> ⚠️ 2026-09-21 修复：净化层此前只保留 `key/visible/sort_order`，静默丢弃 `group`，导致运营中心「一级导航 ↔ 更多」跨组配置在应用端永远不生效（后端下发与渲染端 C5 均已支持 group，属三端契约漂移）。回归测试：`app-menu-config.test.js`。

### 5.3 应用端渲染层（合并算法）

文件：`apps/desktop/src/config/sidebar-menu-merge.js`

| # | 契约 | 规则 |
|---|------|------|
| C1 | fail-open | 未下发 / 结构非法 / 超限 → 全部可见 + 定义顺序 |
| C2 | 强制项保护 | `SIDEBAR_FORCED_VISIBLE_KEYS` 中的项**永远** `visible=true`，忽略下发值（防御纵深） |
| C3 | 未知 key 忽略 | 下发里本地定义不存在的 key 静默丢弃（不新增菜单项） |
| C4 | 缺失 key 兜底 | 本地有、下发无 → 可见 + `sortOrder=null` |
| C5 | 组内排序 | 两组各自排序：`sort_order` 升序 → 相同按定义顺序 → 无值排在最后并按定义顺序 |
| C6 | 输入不可变 | 不修改传入的 definition / rawConfig |

---

## 6. 流程

### 6.1 运营侧配置流程

```
管理员进入 运营中心 → 应用菜单
  → GET /api/v1/app-menu（首次自动播种 19 项）
  → 页面按 primary / more 两组渲染
  → 管理员切换开关（强制项灰显）/ 点击 ↑↓ 调整组内顺序
  → 标记「有未保存的修改」
  → 点击「保存」→ PUT /api/v1/app-menu（全量 19 项）
  → 服务端校验 → 强制项纠正 → 落库
  → 返回全量列表 + corrections
  → 页面刷新为服务端返回数据，清除脏标记
  → Toast 提示「已保存 19 项」
```

### 6.2 下发流程

```
应用端主进程启动（延时 3s）或用户手动「立即同步」
  → GET /api/v1/runtime/bootstrap（header X-Catalog-Key）
  → ops-center 组装 payload（含 appMenu）
  → Ed25519 签名（canonical JSON）
  → 应用端 verifyRuntimeSignature() 验签
      ├─ 失败 → 整体拒绝，不应用任何运行时策略（fail-closed，保留上一次快照）
      └─ 成功 → normalizeAppMenu(payload.appMenu)
                  → 写入 settings.opsCenterRuntime（含 appMenu）
```

### 6.3 应用端生效流程

```
侧边栏组件挂载（App.vue → MpSidebar.vue）
  → onMounted → loadAppMenu()
  → IPC invoke 'ops-center-sync:appMenu'
  → 主进程返回 { code: 0, data: { items, syncedAt } | null }
  → appMenuConfig = data（null 表示无有效配置）
  → computed resolvedMenu = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, appMenuConfig)
      ├─ 可见性：强制项 → true；其他 → 下发值；缺失 → true
      └─ 排序：组内按 sort_order 升序重排
  → primaryItems / moreItems 过滤 visible 后渲染
```

**生效时机**：桌面端启动后同步一次；运营侧修改后需在桌面端手动「立即同步」或重启应用才生效（当前无实时推送）。

---

## 7. 功能逻辑

### 7.1 可见性合并

```
visible(item) =
  item.key ∈ FORCED_VISIBLE_KEYS         → true              （C2，无条件）
  下发配置存在 item.key                   → 下发值           （白名单解析后的布尔）
  下发配置不存在 item.key                 → true              （C4，向后兼容新增项）
  下发配置整体不可用（null）              → true              （C1，fail-open）
```

### 7.2 排序合并

分组独立排序，比较器：

```
compare(a, b):
  a.sortOrder === null && b.sortOrder === null → a.index - b.index   （保持定义顺序）
  a.sortOrder === null                        → 1                   （无值排最后）
  b.sortOrder === null                        → -1
  a.sortOrder !== b.sortOrder                 → a.sortOrder - b.sortOrder
  否则                                        → a.index - b.index   （稳定排序）
```

- **组间无耦合**：调整 `more` 组顺序不影响 `primary` 组。
- **保存时归一化**：运营端点击 ↑↓ 后，该组 `sort_order` 被重写为 `0..n-1`，避免历史上出现重复值导致排序不确定。

### 7.3 强制项保护（三层）

| 层 | 位置 | 行为 |
|---|------|------|
| L1 体验层 | 运营中心 UI | 开关 `disabled`，Tooltip 说明「系统核心入口，强制显示，不可关闭」 |
| L2 服务层 | `app_menu_service.upsert_items` / `get_bootstrap_app_menu` | 强制纠正为 `visible=true`，写入时记入 `corrections` |
| L3 渲染层 | `sidebar-menu-merge.resolveSidebarMenu` | 强制项无视任何下发值，永远 `visible=true` |

> L2 与 L3 同时存在是刻意的：即使运营中心被绕过或被入侵（下发 `publish.visible=false`），应用端也不会丢失核心入口。

### 7.4 兜底规则

| 场景 | 行为 |
|------|------|
| 未下发 / 下发失败 / 结构非法 | 全部菜单项可见 + 定义顺序（fail-open） |
| 「更多」组全部隐藏 | 侧边栏不渲染「更多」按钮与折叠面板（避免空面板） |
| 一级导航全部隐藏 | **不会发生**：4 个强制项恒可见，最少保留 4 项 |
| 用户当前所在路由被隐藏 | 页面仍可直接访问（隐藏 ≠ 禁用）；当前路由不再高亮菜单项 |
| 隐藏了「主页」 | 应用启动仍进入主页（`/` 为默认路由）；菜单中不再出现「主页」入口 |

---

## 8. 交互逻辑（运营中心「应用菜单」页）

页面文件：`ops-center/frontend/src/views/AppMenu.vue` · 路由 `#/app-menu` · 菜单入口「应用菜单」（adminOnly）

### 8.1 页面结构

```
h1  应用菜单
说明段落（多行，见 §10 文案 T1）
el-card
  ├─ 工具栏（左）：共 N 项 · 已隐藏 M 项 [● 有未保存的修改]
  │  （右）：[刷新] [恢复默认] [保存]
  └─ 分组卡片 ×2
       ├─ h3 组标题
       ├─ 组说明
       └─ el-table（列见 §9）
```

### 8.2 控件行为

| 控件 | 位置 | 行为 | 禁用条件 |
|------|------|------|----------|
| 刷新 | 工具栏 | 重新 GET，覆盖当前编辑（脏数据静默丢弃） | 保存中 / 恢复中 |
| 恢复默认 | 工具栏 | 弹出确认框 → 确认后 POST `/reset` → 刷新列表 | 保存中 / 加载中 |
| 保存 | 工具栏 | 收集全量 19 项 → PUT → 用响应覆盖列表 | 保存中 |
| 显示开关 | 表格「显示」列 | 切换 `row.visible`，置脏标记 | **强制项始终 disabled** |
| 上移 ↑ | 表格「顺序」列 | 与上一行交换位置并归一化 `sort_order`，置脏标记 | 组内第一行 |
| 下移 ↓ | 表格「顺序」列 | 与下一行交换位置并归一化 `sort_order`，置脏标记 | 组内最后一行 |
| 强制显示 Tag | 表格「菜单项」列 | 仅展示，不可点击 | — |

### 8.3 脏数据提示

- 任一修改（开关切换 / 上移 / 下移）后，工具栏左侧出现橙色 `● 有未保存的修改`。
- 点击「刷新」或成功保存后清除。
- 页面**不拦截**未保存离开（与「选项控制」页保持一致，避免引入 beforeunload 阻塞）。

### 8.4 加载与错误状态

| 状态 | 表现 |
|------|------|
| 加载中 | 表格 `v-loading`，工具栏按钮 disabled |
| 加载失败 | `ElMessage.error`：`加载应用菜单失败` 或后端 `detail` |
| 保存成功 | `ElMessage.success`：`已保存 N 项` |
| 保存有纠正 | `ElMessage.warning`：`已保存。以下强制显示项被系统纠正为「显示」：<keys>` |
| 保存失败 | `ElMessage.error`：后端 `detail` 或 `保存失败` |
| 恢复默认 | 确认弹窗（见 §10 T5）；成功 → `已恢复默认`；失败 → `恢复默认失败` |

---

## 9. 显示项

### 9.1 运营中心「应用菜单」表格列

| 列名 | 宽度 | 对齐 | 内容 |
|------|------|------|------|
| 顺序 | 110 | 居中 | ↑ / ↓ 两个按钮 |
| 显示 | 90 | 居中 | 开关；强制项为 disabled 开关（含 Tooltip） |
| 菜单项 | min 150 | 左 | 名称；隐藏时灰化 + 删除线；强制项后跟橙色 `强制显示` Tag |
| 标识 | 150 | 左 | `item_key`（等宽字体，便于排查） |
| 说明 | min 220 | 左 | `description`，超长省略 + Tooltip |

### 9.2 应用端侧边栏

| 位置 | 内容 |
|------|------|
| 一级导航（平铺） | 可见的 `primary` 项，按运营顺序 |
| 设置按钮 | 固定在 primary 组末尾，**不可配置**（功能入口，非路由菜单项） |
| 更多按钮 | 仅当 `more` 组存在可见项时渲染；顺序在设置按钮之后 |
| 更多折叠面板 | 可见的 `more` 项，按运营顺序 |

---

## 10. 提示文字清单（可直接复制进代码）

| 编号 | 位置 | 中文原文 |
|------|------|----------|
| T1 | 页面说明段落 | 管理应用端（桌面端）左侧边栏的菜单项：控制显示 / 隐藏，并调整菜单项在所属分组内的顺序。「发布、账号、采集、视频创作」为系统核心入口，**强制显示**，开关灰显不可关闭。配置随运行时 bootstrap 下发；桌面端启动 3 秒后自动同步一次，**修改后需在桌面端重新同步（或重启应用）才会生效**（当前无实时推送）。 |
| T2 | 工具栏统计 | `共 {N} 项 · 已隐藏 {M} 项` |
| T3 | 脏数据标记 | `● 有未保存的修改` |
| T4 | 分组标题 1 | `一级导航（侧边栏平铺显示）` |
| T5 | 分组说明 1 | `常驻侧边栏的入口，建议保留 3-6 项以保证可读性。` |
| T6 | 分组标题 2 | `更多菜单（「更多」折叠面板内）` |
| T7 | 分组说明 2 | `收纳低频入口；若全部隐藏，侧边栏的「更多」按钮将不再出现。` |
| T8 | 强制项提示（Tooltip） | `系统核心入口，强制显示，不可关闭` |
| T9 | 强制项标签 | `强制显示` |
| T10 | 恢复默认确认弹窗 | 标题：`恢复默认` · 正文：`将恢复为默认设置：全部菜单项显示，并恢复默认顺序。此操作会立即覆盖当前配置，是否继续？` · 主按钮：`恢复默认` · 次按钮：`取消` |
| T11 | 保存成功 Toast | `已保存 {N} 项` |
| T12 | 保存含纠正 Toast | `已保存。以下强制显示项被系统纠正为「显示」：{keys}` |
| T13 | 恢复默认成功 Toast | `已恢复默认` |
| T14 | 加载失败 Toast | `加载应用菜单失败` |
| T15 | 保存失败 Toast | `保存失败` |
| T16 | 恢复默认失败 Toast | `恢复默认失败` |
| T17 | 运营中心菜单入口 | `应用菜单` |
| T18 | 后端校验错误 | 见 §5.1 表格「中文提示」列 |

---

## 11. 非功能需求

| 维度 | 要求 | 落实 |
|------|------|------|
| 性能 | 配置项 ≤ 200，页面渲染 < 200ms | 19 项固定目录；表格无虚拟滚动需求 |
| 安全 | 写操作仅管理员 | `require_admin`（非 admin 403） |
| 安全 | 下发不可篡改 | Ed25519 签名，`appMenu` 在签名覆盖范围内 |
| 安全 | 防 payload DoS | 服务端与主进程双侧 200 项上限，超限拒绝 |
| 安全 | 防原型污染 | `__proto__`/`constructor`/`prototype` 双侧丢弃 |
| 安全 | 防越权灰显绕过 | 服务端强制纠正 + 应用端渲染强制（三层） |
| 兼容 | 旧版运营中心（无 `appMenu` 字段） | 应用端 `getAppMenu()` 返回 `null` → fail-open 默认菜单 |
| 兼容 | 旧版应用端（不读 `appMenu`） | 新增 payload 字段被忽略，行为不变 |
| 降级 | 运营中心不可达 / 验签失败 | 保留上次快照；无快照 → 默认菜单 |
| 一致性 | 服务端与前端字段名 | 下发用 `key`，管理接口用 `item_key`；已在 §4 明确 |

---

## 12. 验收标准（Given/When/Then）

| # | 场景 | 期望 |
|---|------|------|
| A1 | Given 运营中心首次打开「应用菜单」, When 页面加载 | 显示 19 项，分 primary / more 两组，全部可见 |
| A2 | Given 「发布」为强制项, When 查看其开关 | 开关 `disabled`，hover 显示「系统核心入口，强制显示，不可关闭」 |
| A3 | Given 管理员隐藏「主页」, When 保存 | 200，返回列表 `home.visible=false` |
| A4 | Given 管理员尝试隐藏「发布」, When 保存 | 200，`corrections` 含 `publish`，返回列表中 `publish.visible=true` |
| A5 | Given 越权直接 PUT `publish.visible=false`, When 请求 | `publish` 被纠正为可见，`corrections` 含 `publish` |
| A6 | Given 数据库被直接改坏 `create.visible=0`, When 拉取 bootstrap | 下发 `create.visible=true` |
| A7 | Given 非管理员账号, When PUT / POST reset | 403 |
| A8 | Given 提交未知 `item_key`, When PUT | 400，提示 `未知菜单项：<key>` |
| A9 | Given 提交 201 项, When PUT | 400，提示 `菜单项数量超过上限 200` |
| A10 | Given 提交负数 `sort_order`, When PUT | 该项 `sort_order` 保持原值不变 |
| A11 | Given 已调整顺序, When 拉取 bootstrap | `appMenu.items` 的 `sort_order` 与运营端一致 |
| A12 | Given 应用端未拿到配置（`data=null`）, When 渲染侧边栏 | 全部菜单项可见，顺序为默认定义顺序 |
| A13 | Given 下发 `home.visible=false`, When 渲染侧边栏 | 「主页」不渲染，其余强制项正常 |
| A14 | Given 下发 `more` 组全部 `visible=false`, When 渲染侧边栏 | 「更多」按钮与折叠面板都不渲染 |
| A15 | Given 下发 201 项（超限）, When 渲染侧边栏 | 整体降级为默认菜单（全部可见） |
| A16 | Given 运营端与桌面端同时运行, When 运营端保存后桌面端重新同步 | 侧边栏顺序/显隐与运营端一致 |
| A17 | Given payload 被篡改, When 应用端验签 | 验签失败，整体拒绝，保留上次快照 |
| A18 | Given 同一 PUT 连续执行两次 | 结果完全一致（幂等） |

---

## 13. 测试覆盖

| 层 | 文件 | 用例数 | 覆盖 |
|----|------|--------|------|
| 合并算法（单元） | `apps/desktop/src/config/sidebar-menu-merge.test.js` | 34 | C1–C6、V7/V8/V9 渲染侧、原型污染、不可变性 |
| 侧边栏组件（集成） | `apps/desktop/src/layouts/MpSidebar.appmenu.test.js` | 9 | A12–A15、强制项保护、组内排序、「更多」全隐藏 |
| 侧边栏既有回归 | `apps/desktop/src/layouts/MpSidebar.test.js` | 7 | 既有菜单渲染 / 服务状态 / 设置按钮 |
| 主进程同步（单元） | `apps/desktop/electron/services/ops-center-sync.test.js` | 55（+8） | N1–N6、持久化、重启恢复、旧版兼容 |
| 运营中心 API（集成） | `ops-center/backend/tests/test_app_menu_api.py` | 11 | V1–V10、A3–A11、A18、bootstrap 签名与鉴权 |

**本地运行**：

```bash
# 桌面端
cd apps/desktop && ../../node_modules/.bin/vitest run \
  src/config/sidebar-menu-merge.test.js \
  src/layouts/MpSidebar.appmenu.test.js \
  src/layouts/MpSidebar.test.js \
  electron/services/ops-center-sync.test.js \
  --pool=threads --no-file-parallelism

# 运营中心后端
cd ops-center/backend && py -3.12 -m pytest -q
```

---

## 14. 已知局限与后续

| # | 局限 | 影响 | 后续建议 |
|---|------|------|----------|
| L1 | 无实时推送，需重新同步/重启生效 | 运营调整有延迟 | 后续可加 WebSocket 或短轮询 |
| L2 | 无按用户/版本灰度 | 全量生效 | 叠加 feature flag 维度 |
| L3 | 无法重命名菜单文案 | 文案改动仍需发版 | 若确需，需先补 i18n 落地方案 |
| L4 | 隐藏项仍可通过 URL 直达 | 隐藏 ≠ 禁用（预期行为） | 若需真正禁用，需在路由守卫层加拦截 |
| L5 | 运营中心前端无 i18n | 页面文案硬编码中文 | 与既有 ops-center 一致，暂不引入 |
| L6 | 变更无独立审计表 | 仅 `updated_by` / `updated_at` 留痕 | 后续接入 `config_audit_log` |

### 14.1 风险接受记录：D-P0-1（Ed25519 信任锚可被 renderer 覆盖）

> 来源：QA 验证报告 `deliverables/gstack/qa-app-menu-verification-report.md` §6.2.6（定级 🔴 严重）。
> **既有缺陷，非本功能引入**；本节为按 CSO 要求补齐的形式要件（具名签署 + 复核触发点），避免该风险随时间静默消失。

| 项 | 内容 |
|---|------|
| 技术事实 | `opsCenterSyncSave` 位于 `PUBLIC_METHODS`（`apps/desktop/electron/preload/access-control.js`）+ IPC handler 无 sender 校验（`apps/desktop/electron/ipc-handlers/ops-center-sync.js`）+ `saveConfig` 接受并落盘 `runtimePublicKey`（`apps/desktop/electron/services/ops-center-sync.js`）→ 被攻陷的 renderer（XSS / 恶意依赖）可一次性替换验签信任锚，此后**全部运行时策略**（appMenu / pipelineOptions / contentPolicy 词表 / rewriteStrategies / updatePolicy）的验签均可被伪造 |
| 影响边界 | 本功能四层强制保护中的「渲染层无视下发值」**不依赖签名链**，因此对**网络攻击者有效**；但「签名覆盖 appMenu」对**本地 / renderer 攻击者不成立**。此句必须原样保留，防止把"签名已闭合"误读为"菜单不可被本地攻击者控制" |
| 处置 | 本次不修，记为**已接受风险** |
| 具名签署 | **ColinChiu（工程负责人）** · 2026-09-15 · 于会话中确认接受 |
| 复核触发点 | ① 下次涉足运行时下发链路（runtime/bootstrap、签名、preload 桥、access-control）时**强制重估**；② 季度例行复核 |
| 窄修复备忘 | 「`runtimePublicKey` 不允许 renderer 覆盖」：从 `PUBLIC_METHODS` 移除 `opsCenterSyncSave`（或拆分保存通道）+ handler 增加 sender 校验。改动小、风险低；若启动，走独立分支 + PR + CI 全流程 |

### 14.2 载荷卫生修复记录（2026-09-15，QA 复审驱动）

QA 验证报告 §6.2.5（D-7.3 🟠）/ §6.2.7（D-GRP 🟡）的落地修复：

| 编号 | 缺陷 | 修复 | 守卫测试 |
|---|---|---|---|
| D-7.3 | `canonical_json` 无 `allow_nan=False`：历史脏数据（如 pipeline option `default_value="NaN"`）经 json.loads 还原为 float('nan') 后，签名串含裸 `NaN`（非法 JSON）→ 桌面端 `JSON.parse` 整包丢弃 bootstrap，content_policy 等全部运行时策略失效且零告警 | ① `canonical_json` 显式 `allow_nan=False`（合法数据输出逐字节不变，签名兼容）；② `PUT /pipeline-options` 写入侧拒绝裸 NaN/Infinity/-Infinity 字面量（含嵌套）；③ bootstrap 下发侧对历史脏行降级为原字符串（存量数据免清洗即恢复安全） | `tests/test_pipeline_options_nan_guard.py`（8 例：写入 3 / 下发 1 / 序列化 2 / 合法回归 1 / API 端到端 1） |
| D-GRP（已撤销，2026-09-16） | 原 D-GRP 限制 bootstrap 下发的 appMenu 不得含 `group`（PRD §2.4.4）。2026-09-16 因上线「跨组移动」管理，group 成为必要契约字段，撤销该限制 | `get_bootstrap_app_menu` 现随载荷下发 `group`；管理 API 仍返回 group（§4.1）；应用端 `sidebar-menu-merge` 据下发 group 决定归属（fail-open 回退本地） | `test_bootstrap_app_menu_items_include_group`（原 `..._have_no_signed_but_ignored_fields` 已更名反转） |
| 顺带 | `test_app_menu_api.py` 的 `CATALOG_SIZE=20` 未随 #1840（移除 monitor，目录 20→19）同步 → main 上 3 例既有假红 | `CATALOG_SIZE` 改 19，本文档 §2.1/§4/§6 与 PRD 目录表同步 20→19 | `test_seed_catalog_and_forced_flags` 等 3 例转绿 |

---

## 15. 变更文件清单

### 应用端（apps/desktop）

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/config/sidebar-menu.js` | 新增 | 菜单定义单一事实源（19 项 + 强制项常量） |
| `src/config/sidebar-menu-merge.js` | 新增 | 合并算法（C1–C6） |
| `src/config/sidebar-menu-merge.test.js` | 新增 | 34 个单测 |
| `src/layouts/MpSidebar.vue` | 修改 | 改为「定义 + 运营配置叠加」 |
| `src/layouts/MpSidebar.appmenu.test.js` | 新增 | 9 个组件测试 |
| `src/api/ops-center-sync.js` | 修改 | 新增 `opsCenterSyncAppMenu()` |
| `electron/services/ops-center-sync.js` | 修改 | `normalizeAppMenu` + `appMenu` 状态 + `getAppMenu()` |
| `electron/services/ops-center-sync.test.js` | 修改 | +8 个用例 |
| `electron/ipc-handlers/ops-center-sync.js` | 修改 | 新增 `ops-center-sync:appMenu` |
| `electron/preload/system.js` | 修改 | 暴露 `opsCenterSyncAppMenu` |

### 运营中心（ops-center）

| 文件 | 类型 | 说明 |
|------|------|------|
| `backend/models.py` | 修改 | 新增 `AppMenuItem` |
| `backend/services/app_menu_service.py` | 新增 | 目录 + 校验 + CRUD + bootstrap |
| `backend/routers/app_menu.py` | 新增 | GET / PUT / reset |
| `backend/main.py` | 修改 | 注册路由 |
| `backend/services/runtime_service.py` | 修改 | payload 增加 `appMenu` |
| `backend/tests/test_app_menu_api.py` | 新增 | 11 个 API 测试 |
| `frontend/src/views/AppMenu.vue` | 新增 | 管理页面 |
| `frontend/src/api/appMenu.js` | 新增 | API 封装 |
| `frontend/src/router/index.js` | 修改 | 新增 `/app-menu` 路由 |
| `frontend/src/config/menuItems.js` | 修改 | 新增「应用菜单」入口 |
