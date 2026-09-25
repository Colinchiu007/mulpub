# 应用菜单（运营中心 → 应用端侧边栏）

> 版本：v1.2 · 日期：2026-09-15 · 最近更新：2026-09-25（跨端同步收敛修复，见 §16）
> 分支：`app-menu-config` · worktree：`D:\Data\projects\mp-worktrees\mp-app-menu-config`
> 关联：`01-docs/PRD.md`（应用菜单章节）、`CHANGELOG.md`、`openspec/changes/app-menu-sync-convergence/`
>
> ⚠️ 阅读提示：本文档 v1.0 的目录表（19 项、含「监控」）与「不支持跨组」「需重启才生效」等表述
> 已被后续变更（#1840 移除分屏监控、2026-09-16 撤销 D-GRP、2026-09-19 新增文案库、
> 2026-09-25 同步收敛）取代。以 §2.1 / §3.2 / §6 的当前版本为准。

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
| ~~跨组穿插排序~~ | **已撤销（2026-09-16）**：上线「一级导航 ↔ 更多」跨组移动管理，`group` 成为下发契约字段；强制项仍锁定在一级导航。 |
| 按用户/版本差异化 | 本期为全量下发；按用户群灰度由后续 feature flag 叠加。 |
| 服务端主动推送 | 沿用既有 bootstrap 拉取模型。**2026-09-25 起**：客户端每次同步成功即广播并即时刷新侧边栏，无需重启；但运营端保存本身仍不触达客户端，需客户端下次同步（自动或手动「立即同步」）。 |

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

### 2.1 菜单目录（契约，共 20 项）

真源两处，必须同序同名：`apps/desktop/src/config/route-registry.js` 的 `SIDEBAR_MENU_KEY_ORDER`
+ 各项 `navEntry.group`，与 `ops-center/backend/services/app_menu_service.py` 的 `CATALOG`。

| # | key | 展示名 | 分组 | 强制显示 | 应用端路由 |
|---|-----|--------|------|:--------:|-----------|
| 1 | `home` | 主页 | primary | | `/` |
| 2 | `publish` | 发布 | primary | ✅ | `/publish/history` |
| 3 | `accounts` | 账号 | primary | ✅ | `/accounts` |
| 4 | `dashboard` | 数据 | primary | | `/dashboard` |
| 5 | `create` | 视频创作 | primary | ✅ | `/create` |
| 6 | `collection` | 采集 | primary | ✅ | `/collection` |
| 7 | `copy-library` | 文案库 | primary | | `/copy-library` |
| 8 | `rewrite` | 文案改写 | primary | | `/rewrite` |
| 9 | `calendar` | 发布日历 | more | | `/calendar` |
| 10 | `comments` | 私信评论 | more | | `/comments` |
| 11 | `cloud-publish` | CLI | more | | `/cloud-publish` |
| 12 | `library` | 素材库 | more | | `/library` |
| 13 | `keywords` | 关键词监控 | more | | `/keywords` |
| 14 | `viral` | 爆款分析 | more | | `/viral-analysis` |
| 15 | `prompt-eval` | 提示词评估 | more | | `/prompt-eval` |
| 16 | `hot-topics` | 热门选题 | more | | `/hot-topics` |
| 17 | `model-providers` | 模型提供商 | more | | `/model-providers` |
| 18 | `knowledge-base` | 知识库 | more | | `/knowledge-base` |
| 19 | `performance-insights` | 数据洞察 | more | | `/performance-insights` |
| 20 | `member-center` | 会员中心 | more | | `/member-center` |

> 目录演进历史：#1840（2026-09-15 前后）移除 `monitor`（分屏监控），目录 20 → 19；
> 2026-09-15 `rewrite` 由 more 提级到 primary；
> 2026-09-19 `copy-library`（文案库）新增到 primary，目录 19 → 20；
> 2026-09-25 修复「新增项不落库」缺陷（§3.2、§16）。
>
> **契约规则**：`key` 一旦发布**不得改名**（改名 = 旧配置失效）。应用端新增菜单项时，
> 运营端由 `_provision_from_catalog` 自动补齐该项（可见 + 目录序号 + 目录分组），
> 无需人工干预；未及补齐的极端情况下应用端仍按「可见 + 本地定义位置」处理，不会消失。

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

### 3.2 目录供给规则（`_provision_from_catalog`）

- **触发时机**：`list_items` / `upsert_items` / `reset_items` / `get_bootstrap_app_menu` 任一个被调用时（四个入口共用同一函数）。
- **语义**：**增量补齐**，不是"仅空表播种"。
  - 空表 → 按 `CATALOG` 全量播种；
  - 非空表 → 只对 `CATALOG` 中存在而 DB 中缺行的 key 插入新行；
  - **已存在的行一律不读取、不修改**（运营者的显隐 / 排序 / 分组必须存活）。
- **新行初值**：`visible=1`；`sort_order` = 该项在 `CATALOG` 中的序号；`group` / `label` / `description` 取目录值；`forced_visible` 按 `FORCED_VISIBLE_KEYS` 置位；`updated_by` 置空串（系统供给，非人工编辑）。
- **幂等**：多次调用结果一致；无缺失项时不产生写事务。
- **为什么不删脏 key**：DB 中存在但不在 `CATALOG` 内的历史 key 仍保留在表里（下发侧按 `CATALOG` 过滤，不会到达应用端）。删除是不可逆的破坏性操作，且会使"运营端看得到、应用端不认"的排障线索消失。
- **历史缺陷**：2026-09-25 之前本规则为 `_seed_if_empty`（记录数为 0 才播种），导致 `copy-library` 在已部署实例上永久缺席 → 运营端配不了、两端顺序漂移。详见 §16。

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
  "count": 20,
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
  "count": 20
}
```

- **语义**：
  - **部分提交**允许：只提交需要改动的项；未提交项的 `visible` / `sort_order` 保持不变。
  - **整体原子**：任一条校验失败 → 400，**整批不写入**（不做部分成功）。
  - `corrections`：被服务端强制纠正为可见的强制显示项 key 列表（正常流程为空）。

### 4.3 `POST /api/v1/app-menu/reset`

恢复默认：全部可见 + 目录默认顺序。

- **鉴权**：`require_admin`
- **响应 200**：`{ "items": [...], "count": 20 }`

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
- **DB 缺行项的兜底（2026-09-25 修正）**：遍历 `CATALOG` 生成载荷，若某项在 DB 中无行（理论上不应再出现，`_provision_from_catalog` 会先补齐），兜底值为
  `visible=true` / `group=` 目录分组 / **`sort_order=` 该项的目录序号**。
  修复前兜底为 `0`，会让该项在应用端被顶到一级导航第 2 位（紧跟 `home`），与运营端页面显示的目录位置错位。
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
| V5 | `item_key` 合法性 | 必须存在于目录（当前 20 项） | 400 | `未知菜单项：<key>` |
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
  → GET /api/v1/app-menu（自动供给 20 项，含缺失项补齐）
  → 页面按 primary / more 两组渲染
  → 管理员切换开关（强制项灰显）/ 点击 ↑↓ 调整组内顺序
  → 标记「有未保存的修改」
  → 点击「保存」→ PUT /api/v1/app-menu（全量 20 项）
  → 服务端校验 → 强制项纠正 → 落库
  → 返回全量列表 + corrections
  → 页面刷新为服务端返回数据，清除脏标记
  → Toast 提示「已保存 20 项」
```

### 6.2 下发流程（2026-09-25 起：两条通道并行且互不门控）

```
应用端主进程启动（延时 3s）或用户在「设置 → 模型服务」点「立即同步」
  → 鉴权决策：零配置态用 Logto JWT（Bearer）；手填 URL 态用 X-Catalog-Key
  → Promise.allSettled 并行发起：
      ├─ GET /api/v1/model-presets/catalog   （模型目录）
      └─ GET /api/v1/runtime/bootstrap       （运行时策略，含 appMenu）
  → runtime 分支：
      verifyRuntimeSignature() 验签
        ├─ 失败 → 整体拒绝，不应用任何运行时策略（fail-closed，保留上一次快照）
        └─ 成功 → normalizeAppMenu(payload.appMenu)
                    → this._runtime.appMenu
                    → 写入 settings.opsCenterRuntime（含 appMenu）
                    → 广播 ops-center:runtime-updated（见 §6.4）
  → catalog 分支：applyCatalog → 写模型服务商配置 → 更新 lastSyncedAt
  → 返回 { code, updated, syncedAt, runtimeApplied, runtimeSyncedAt }
```

**关键约束**：

- 任一分支失败**不得**阻断另一分支。修复前 catalog 失败会直接 `return`，导致 `appMenu` 永不被拉取（§16 缺陷 3）。
- 整体超时预算保持**单请求 10 秒**（`SYNC_TIMEOUT_MS`），不因两条请求叠加为 20 秒。
- `lastSyncedAt` 仍随 catalog 成功写入；runtime 自身的落库时间由 `settings.opsCenterRuntime.syncedAt` 承载，两者不混用。
- `模型服务未就绪`（manager 未注入）时 catalog 分支跳过，但 runtime 分支仍执行一次。

### 6.3 应用端生效流程

```
侧边栏组件挂载（App.vue → MpSidebar.vue）
  → onMounted → loadAppMenu()
                → IPC invoke 'ops-center-sync:appMenu'
                → 主进程返回 { code: 0, data: { items, syncedAt } | null }
                → 仅当 data 为有效对象时整体替换 appMenuConfig（见下方"保留上一份"）
  → 订阅 onOpsCenterRuntimeUpdated(cb) → cb 内再次 loadAppMenu()
  → onUnmounted → 取消订阅（与订阅成对，避免窗口重建后监听器累积）
  → computed resolvedMenu = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, appMenuConfig)
      ├─ 可见性：强制项 → true；其他 → 下发值；缺失 → true
      └─ 排序：组内按 sort_order 升序重排
  → primaryItems / moreItems 过滤 visible 后渲染
```

**生效时机**：客户端启动后自动同步一次；此后每次同步成功即广播刷新侧边栏，**无需重启应用**。
运营端保存本身不触达客户端（无服务端推送），需等客户端下次同步（自动或手动「立即同步」）。

**保留上一份（2026-09-25）**：`loadAppMenu` 仅在取到有效配置时替换状态。
首帧失败 → 保持 `null` → fail-open 本地默认菜单（行为不变）；
已有生效配置后的重拉失败（网络抖动、服务不可达）→ **保留上一份**，
避免用户菜单瞬时坍回默认再弹回。

### 6.4 运营配置变更通知链

```
applyRuntime 成功（ops-center-sync.js）
  → this._onRuntimeUpdated(next)          # 经 setOnRuntimeUpdated 由 phase3 注入
  → getMainWin() 存活校验 → win.webContents.send('ops-center:runtime-updated', { syncedAt })
  → preload onOpsCenterRuntimeUpdated(cb) → MpSidebar 重拉
```

- 载荷**只含时间戳**，不含配置内容 → 配置读取仍走受验签保护的 IPC 路径，不新增数据面。
- 通知器经 **setter 注入**：`OpsCenterSync` 在 bootstrap phase1 构造，那时主窗口尚不存在。
- 窗口未创建 / 已销毁 → 静默跳过，不抛错（广播是装饰性通知，配置已落盘）。
- preload 通道注册于 `access-control.js` 的 `PUBLIC_METHODS`：订阅动作不返回运营数据，
  而事件到达后的 `opsCenterSyncAppMenu` 仍受 `authenticated` 门控。

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
| 未下发 / 下发失败 / 结构非法（首帧） | 全部菜单项可见 + 定义顺序（fail-open） |
| 已有生效配置后重拉失败 | **保留上一份配置**，不瞬时坍回本地默认（2026-09-25） |
| DB 缺目录新增项 | 读取/写入/下发前自动补齐该行（只补不改已有行） |
| 模型目录同步失败 | 不影响运行时策略（含菜单）拉取与应用；结果如实上报目录原因 |
| 运行时策略拉取失败 | 不影响模型目录同步；侧边栏保留已应用配置 |
| 「更多」组全部隐藏 | 侧边栏不渲染「更多」按钮与折叠面板（避免空面板） |
| 一级导航全部隐藏 | **不会发生**：4 个强制项恒可见，最少保留 4 项 |
| 用户当前所在路由被隐藏 | 页面仍可直接访问（隐藏 ≠ 禁用）；当前路由不再高亮菜单项 |
| 隐藏了「主页」 | 应用启动仍进入主页（`/` 为默认路由）；菜单中不再出现「主页」入口 |
| 运营端与桌面端目录漂移 | 页面集合与下发集合恒等于 `CATALOG`（守卫测试 `test_list_and_bootstrap_never_diverge_on_item_set_and_order`） |

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
| 保存 | 工具栏 | 收集全量 20 项 → PUT → 用响应覆盖列表 | 保存中 |
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
| T1 | 页面说明段落 | 管理应用端（桌面端）左侧边栏的菜单项：控制显示 / 隐藏，调整顺序，并可在**「一级导航」与「更多」之间互相拖动**（跨组移动）。「发布、账号、采集、视频创作」为系统核心入口，**强制显示且锁定在一级导航**，不可关闭、不可移出（但可在一级导航内拖动排序）。拖动即自动重排顺序；修改后点「保存」生效。组内排序：把菜单项拖到同组另一项上即可；**跨组移动（一级导航 ↔ 更多）需拖到目标分组的空白处**，拖到具体菜单项上不会跨组。本列表与桌面端菜单目录（应用端 `route-registry`）自动对齐：应用端新增菜单项后，本页会在下次打开时自动补齐该项，**无需点「恢复默认」**；「恢复默认」只用于把显隐与顺序整体回退到目录默认值。<br />生效时机：配置随运行时 bootstrap 下发到桌面端。桌面端启动后自动同步一次，之后**在「设置 → 模型服务」点「立即同步」即可下发生效，无需重启应用**（同步成功后侧边栏会即时刷新；当前仍无服务端主动推送，运营端保存本身不会自动触达客户端）。 |
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

### 10.1 桌面端「设置 → 模型服务 → 立即同步」结果提示（2026-09-25 新增）

i18n 键位于 `modelProviders` 组，zh/en 成对维护（CI Gate 7 `check-locale-sync.js --keys` 拦截漏配）。

| 编号 | i18n key | 触发条件 | 中文文案 | 级别 |
|------|----------|----------|----------|------|
| T19 | `modelProviders.syncSuccess` | `code=0` | `同步成功：更新 {count} 个服务商（{time}）` | success |
| T20 | `modelProviders.syncPartialSuccess` | `code=-1` 且 `runtimeApplied=true` | `模型目录同步未完成；运营配置（菜单/公告等）已更新。原因：{reason}` | **warning** |
| T21 | `modelProviders.syncFailed` | `code=-1` 且 `runtimeApplied=false` | `同步失败`（状态区展示 `formatUserError` 映射后的原因） | error |
| T22 | `modelProviders.syncError` | 调用抛异常 | `同步异常` | error |

> **为什么必须有 T20**：两条通道解耦后，「目录失败 + 运营配置已成功」成为常态组合。
> 若仍统一报「同步失败」，运营者会认为改动没生效而反复重启应用——这恰好是本次要消灭的现象。
> `{reason}` 取 `formatUserError` 映射后的用户可读句（而非原始堆栈/英文 error），
> 因此文案把原因后置到句尾，避免与原因自带句号相连产生「。；」这类断裂。
> 守卫测试：`src/composables/useOpsCenterSync.test.js`（断言取 i18n 键渲染结果，不写字面量）。

---

## 11. 非功能需求

| 维度 | 要求 | 落实 |
|------|------|------|
| 性能 | 配置项 ≤ 200，页面渲染 < 200ms | 目录 20 项（上限 200）；表格无虚拟滚动需求 |
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
| A1 | Given 运营中心首次打开「应用菜单」, When 页面加载 | 显示 20 项，分 primary / more 两组，全部可见 |
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
| 侧边栏组件（集成） | `apps/desktop/src/layouts/MpSidebar.appmenu.test.js` | 12 | A12–A15、强制项保护、组内排序、「更多」全隐藏、**事件到达免重启、重拉失败保留上一份、卸载取消订阅** |
| 侧边栏既有回归 | `apps/desktop/src/layouts/MpSidebar.test.js` | 15 | 既有菜单渲染 / 服务状态 / 设置按钮 |
| 主进程同步（单元） | `apps/desktop/electron/services/ops-center-sync.test.js` | 68 | N1–N6、持久化、重启恢复、旧版兼容、**目录失败仍应用菜单、未就绪仍拉 runtime、通知器触发与抛错隔离、两条通道并行且各请求一次** |
| 主进程接线（单元） | `apps/desktop/electron/bootstrap/phase3-services.test.js` | 29 | **`setOnRuntimeUpdated` 已接线 + 广播 channel 名 + 窗口未创建/已销毁时静默跳过** |
| 同步结果提示（单元） | `apps/desktop/src/composables/useOpsCenterSync.test.js` | 9 | **部分成功走 warning 且不落 error**（断言取 i18n 键渲染结果） |
| 运营中心 API（集成） | `ops-center/backend/tests/test_app_menu_api.py` | 18 | V1–V10、A3–A11、A18、bootstrap 签名与鉴权、**缺行补齐、回填不覆盖运营者配置、页面与下发项目集合与顺序恒等** |
| 后端全量 | `ops-center/backend` | 445 passed | 无回归 |

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
| L1 | 无服务端主动推送：运营端保存不自动触达客户端 | 运营调整有延迟（需客户端下次同步；手动「立即同步」可主动触发，**已不再需要重启应用**） | 后续可加 WebSocket 或短轮询 |
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
| `src/config/sidebar-menu.js` | 新增 | 菜单定义单一事实源（菜单目录 + 强制项常量） |
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

---

## 16. 跨端同步收敛修复（2026-09-25，Bug 反思循环 5 步产出物）

> 报告现象：「应用的菜单的项目，现在跟运营中心中的应用菜单页的功能中的数据不同步」。
> 用户确认的具体表现为两项：**顺序对不上** + **改了显隐/顺序但应用没变**。
> 规格承载：`openspec/changes/app-menu-sync-convergence/`。

### 16.1 ① 根因溯源（第一性引入点）

三个相互独立的缺陷叠加，缺一不可地造成该现象：

| # | 缺陷 | 第一性引入点 | 当时的意图 |
|---|------|-------------|-----------|
| 1 | 目录新增项永不落库：`_seed_if_empty` 以「表记录数为 0」为唯一播种条件 | `b4dd4eeb` feat(ops-center): 运营中心「应用菜单」（#1839） | 新建功能时只需要初始数据，未考虑目录会演进 |
| 2 | 下发缺行项 `sort_order` 兜底 `0` 而非目录序号 | 同上（#1839） | 当时不存在缺行路径，兜底值取"最省事"的 0 |
| 3 | `appMenu` 随运行时策略一起被**模型目录同步的成功**门控（catalog 失败即 `return`） | `b4dd4eeb`（#1839）引入 catalog→runtime 串行；`9a1994b1`（#1862）把 runtime 改成 catalog 成功后的 best-effort 分支 | 本意是"runtime 失败不要拖累目录"，方向做对了，但反向门控未考虑 |

**触发事件**：`bcd1b663`（2026-09-19，`copy-library` 加入 `CATALOG`）让缺陷 1 从"潜在"变成"现实"。
该提交的 openspec change `copy-library-primary-menu` 的 task 7「ops-center app_menu_service.py CATALOG 同步」被勾选为完成——
**它把"代码里加了 key"当成"运营端可配置"**，缺少"已部署库必须补齐"这一环。

### 16.2 ② 逃逸链（逐层为什么没拦住）

| 层 | 结论 | 具体原因 |
|----|------|---------|
| 后端单元/集成测试 | **测试结构上不可能覆盖** | `test_app_menu_api.py` 的 autouse 夹具每例 `drop_all`/`create_all` 重建**空表**，于是每例都走"空表全量播种"分支。「非空库 + 目录新增项」这条路径在测试拓扑里不存在——不是断言太松，是根本没这条边 |
| 桌面端单元测试 | 覆盖不到，且被 mock 掩盖 | `ops-center-sync.test.js` 既有 55 例中，runtime 相关的只有「目录成功时 best-effort 拉 runtime」一条正向；**没有任何一例让 catalog 失败**，因此门控缺陷从不执行 |
| 跨端契约 CI | **只做单侧** | `.github/scripts/check-route-registry.js` 校验"registry 的 navEntry 集合 == `SIDEBAR_MENU_KEY_ORDER`"（桌面端内部自洽），对 Python `CATALOG` 只 `console.error` 提示"请手动同步"，无跨端断言。两侧代码清单当时确实一致，所以 CI 全绿——漂移发生在**数据库**，CI 看不见 |
| 打包/视觉回归 | 不适用 | QM-1 只验产物可运行；视觉基线取的是本地默认菜单（未接运营配置），运营侧变化对基线不可见 |
| 代码审查 | 审查盲区 | QM-2 无"目录演进必须带数据供给"与"两条通道失败不得互锁"条目；#1839 的审查关注点是签名覆盖范围与强制项三层保护（这些都做对了） |
| 文档 | 过期误导 | 本文档 §2.1 长期写「共 19 项」且含 `monitor`，§1.3 写「不支持跨组」，排障时会把人引向"是不是清单没对齐"的错误方向 |

**环境侧证据**（排除"只是配置没生效"）：受影响机器的 profile SQLite `settings` 表只有 2 行
（`identity_device_id`、`user:<hash>:keyword_monitor_state`），**`opsCenterSync` 与 `opsCenterRuntime` 两个键都不存在**
→ 该客户端从未成功完成一次同步，运营配置从未到达。

### 16.3 ③ 系统性漏洞定位（四类分类）

| 类别 | 具体漏洞 | 影响范围 |
|------|---------|---------|
| **测试场景缺失** | 所有"目录/清单类"语义测试都用**每例重建空表**的夹具，天然测不到"存量数据 + 目录演进"。缺一个"从旧目录状态出发"的夹具维度 | 一切"种子/目录/预设"类 API（`_seed_*`、`getAvailablePresets` 家族） |
| **测试质量不足** | 跨通道依赖未被断言：只测"A 成功时 B 也执行"，不测"A 失败时 B 是否还要执行"。缺少失败注入用例 | `ops-center-sync` 及任何多通道串行编排 |
| **审查盲区** | QM-2 无"代码内目录常量 ↔ DB 存量数据必须前向兼容"条目；无"并行通道失败不得互锁"条目 | 主进程服务 + 运营中心后端 |
| **流程缺失** | openspec change 的 task 粒度里，"改目录常量"与"已部署实例的数据供给"不是两个独立可验收项，导致后者被漏掉且不显眼 | 所有涉及运营端下发配置的 change |

### 16.4 ④ 修复 + 回归保护测试

| 修复 | 文件 | 回归保护测试（模式） |
|------|------|-------------------|
| 增量补齐缺失行（只补不改已有行） | `ops-center/backend/services/app_menu_service.py` `_provision_from_catalog` | `test_catalog_evolution_backfills_missing_row_in_list`（集成，pytest + 真实 SQLite：`_drop_row` 构造历史库） |
| 回填不得覆盖运营者配置 | 同上 | `test_backfill_does_not_clobber_operator_config`（集成，PUT 隐藏 + `sort_order=42` 后造缺行，校验存活） |
| 页面与下发集合/顺序恒等 | 同上 + `get_bootstrap_app_menu` 兜底改目录序号 | `test_list_and_bootstrap_never_diverge_on_item_set_and_order`（集成，断言两侧 key 集合 == `CATALOG_KEYS`，且 primary 按 `sort_order` 升序 == 目录声明序） |
| 目录失败不得门控运营配置 | `apps/desktop/electron/services/ops-center-sync.js`（`Promise.allSettled` 并行） | `syncNow 目录失败时仍拉取 runtime，appMenu 照样落到缓存`（单元，真实 HTTP 桩返回 500 + 合法签名载荷） |
| 模型服务未就绪仍拉 runtime | 同上 `_syncRuntimeBestEffort` | `模型服务未就绪时仍拉取 runtime`（单元） |
| 并行不得叠加超时预算 | 同上 | `超时（10 秒）→ 明确错误`（单元，**假时钟单次推进 + 断言两个端点各被请求一次**；若实现退化为串行，该用例会挂死） |
| 变更通知与广播 | `applyRuntime` 末尾 + `phase3-services.js` 接线 | `runtime 应用成功后回调 onRuntimeUpdated` / `未接线时照常工作` / `回调抛错不影响应用结果` / `运营配置落地后广播 ops-center:runtime-updated`（单元） |
| 免重启生效 | `MpSidebar.vue` 订阅 + `preload/system.js` + `access-control.js` + `index.bundle.js` | `运营配置变更事件到达 → 免重启重拉并更新一级导航`、`卸载时取消订阅`（组件集成，真实 DOM 顺序断言） |
| 重拉失败不坍回默认 | `MpSidebar.vue` `loadAppMenu` | `重拉失败（IPC 报错）→ 保留上一次可用配置，不清空菜单`（组件集成） |
| 部分成功如实提示 | `useOpsCenterSync.js` + locales | `runSyncNow 目录未完成但运营配置已下发 → 提示部分成功，不落错误态`（单元，断言取 i18n 键渲染结果） |

### 16.5 ⑤ 预防措施（已落地到文件变更）

| # | 措施 | 落地位置 | 状态 |
|---|------|---------|------|
| P1 | 新增 QM-2 条目：**跨端目录常量 ↔ 存量数据必须前向兼容**——改目录常量时必须有"存量库 + 新增项"的回归用例，禁止只用"每例重建空表"的夹具证明正确 | `AGENTS.md` QM-2 | ✅ 本次写入 |
| P2 | 新增 QM-2 条目：**多通道同步编排不得失败互锁**——并行发起、各自 best-effort，且必须有一条"另一通道失败"的注入用例；并行不得叠加超时预算 | `AGENTS.md` QM-2 | ✅ 本次写入 |
| P3 | Bug 反哺记录 + 两份 pitfall（目录演进缺供给 / 门控方向做反） | `01-docs/learnings.md` | ✅ 本次写入 |
| P4 | 本文档过期内容就地修正（目录 20 项、跨组已支持、生效时机、供给规则），并加阅读提示防止再被旧表述误导 | 本文档 §1.3/§2.1/§3.2/§4.4/§6/§7.4/§10/§13/§14 | ✅ 本次写入 |
| P5 | 规格固化为可验收 Requirement（6 条 ADDED Requirement + Scenario） | `openspec/changes/app-menu-sync-convergence/specs/app-menu/spec.md` | ✅ 本次写入 |
| P6 | 文档过期风险：本文档 v1.0 未随 #1840/2026-09-16/2026-09-19 三次目录变更同步 → 已在 §2.1 加"目录演进历史"表，并要求**改目录必须同 PR 更新本文档 §2.1** | 本文档 + `AGENTS.md` P1 条目 | ✅ 本次写入 |

### 16.6 遗留与部署待办

- **线上 `app_menu_items` 需要该修复部署后才补齐**：部署后必须实测「应用菜单」页出现 `copy-library`（共 20 项），
  且**不要**用点「恢复默认」代替（那会连带重置运营者已有的显隐与顺序）。
- **本次修复不改变"无服务端推送"**：运营端保存仍需客户端一次同步（自动或手动）才下发。
- **CI 尚无跨端 CATALOG 一致性断言**：两侧代码清单目前靠 `sidebar-menu.test.js` 冻结基线 + 人工对齐，
  本次未引入跨语言校验脚本（Python 与 JS 清单互校需新工具）。已记入 P6 的文档门禁作为过渡，
  彻底方案另立 change。
