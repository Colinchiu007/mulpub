# BUGFIX — `config_hash` 白名单内两个块自带 `synced_at`，导致「内容没变、指纹每次都变」

- **状态**：已修复（待 CI 合并）
- **分支**：`config-hash-purity`
- **worktree**：`D:\Data\projects\mp-worktrees\mp-config-hash-purity`
- **发现日期**：2026-10-18（在 `story-text-limit-control` 合入前的跨端对账中顺手查出）
- **严重级别**：P1（**不损坏配置内容**，但让整条「配置生效链路」的观测面永久失真：版本号无限增长、生效看板永远显示未确认）
- **影响面**：运营中心「生效看板」（`RolloutView.vue`）全部指标、`RuntimeConfigVersion` 表体积、以及任何依赖「hash 变没变」判断是否需要重推的下游逻辑

---

## 0. 现象与量化

`ops-center/backend/services/config_fingerprint.py` 的注释第 1 条早就写着：

> 只取 RUNTIME_BLOCKS 白名单——synced_at 每次请求都变，纳入则 hash 永远变、客户端每次都发 ACK，直接变成推送地狱。

**注释写对了，实现对不上。** 实测（修复前，同一库连续两次请求 `/api/v1/runtime/bootstrap`）：

| 观测项 | 第 1 次 | 第 2 次 | 期望 |
|---|---|---|---|
| `config_hash` | `f8a5b99df879ac71` | `dd3dfca7ccd2e587` | **两次相同** |
| `config_version` | 1 | 2 | **两次相同** |
| `RuntimeConfigVersion` 落行 | 1 行 | 又 1 行 | 只有内容真变才落行 |
| 数据库内容 | 未改动 | 未改动 | — |

业务数据一个字节都没改，指纹却变了 ⇒ 这条链路上所有「是否已生效」的判断全部失真。

---

## 1. ① 根因溯源（追到第一性引入点）

### 1.1 直接原因

两个 service 的**下发载荷构造函数**各自返回了一个块内时间戳：

```python
# ops-center/backend/services/app_menu_service.py:306（修复前）
return {"items": items, "synced_at": _now()}

# ops-center/backend/services/content_category_service.py:343（修复前）
return {"items": items, "count": len(items), "synced_at": _now()}
```

而 `appMenu` 与 `contentCategories` **都在** `config_fingerprint.RUNTIME_BLOCKS` 白名单里，
`compute_config_hash()` 对白名单内每个块取 canonical JSON 后算 SHA-256 ⇒ 块内 `_now()`
每次请求都不同 ⇒ hash 每次不同。

顶层挡住 ≠ 块内干净：`runtime_service.get_runtime_bootstrap()` 里
`"synced_at": _now()` 是**信封顶层**字段，本来就不在白名单内、不参与 hash；
问题全出在**块内部**又各带了一份。

### 1.2 第一性引入点

| 引入变更 | 日期 | 贡献 |
|---|---|---|
| `ops-center-resilience`（2026-10-08） | 2026-10-08 | 建立 `RUNTIME_BLOCKS` 白名单与 `config_hash`，注释第 1 条明确「synced_at 纳入则 hash 永远变」——但只约束了**顶层** |
| `app-menu-runtime-config`（2026-09-15） | 2026-09-15 | `get_bootstrap_app_menu()` 首次下发，返回体带 `synced_at`，**当时还没有 hash 机制**，无害 |
| `content-categories`（2026-10-03） | 2026-10-03 | 同上，照抄了 appMenu 的返回形态（`{items, count, synced_at}`），同样当时无害 |
| 两者相遇（2026-10-08） | 2026-10-08 | 无害的字段进入 hash 输入集，缺陷成立。**没有任何测试覆盖「同库连构两次 hash 相等」**，所以一直没被发现 |

**归类**：不是某一次写错，而是「两个各自无害的决定在第三次变更里组合成缺陷」，
且守门测试只验证了顶层排除、没验证块内纯净。

### 1.3 为什么逃了 10 天

见 §2 逃逸分析。

---

## 2. ② 逃逸分析（按测试层级逐层）

| 层级 | 本该拦住它的判据 | 为什么没拦住 |
|---|---|---|
| 单元测试 | `test_runtime_resilience_api.py::test_config_hash_excludes_volatile_fields` | **只构造了合成 payload**：手工往顶层塞 `synced_at`，断言 hash 不变。它验证的是「顶层字段被排除」这条**已经成立**的性质，从未走过 `get_runtime_bootstrap()` 真实装配路径 ⇒ 块内的字段它根本看不到 |
| 集成测试 | `test_app_menu_api.py` | 只断言 `isinstance(app_menu.get("synced_at"), str)`——**把缺陷本身当成了期望行为**（断言它存在，而不是断言它不存在） |
| 种子校验 | `ops-runtime-snapshot.js` 的 7 项 CI 判据 | 只查结构/类型/体积/词库残留，不查「块里有没有 volatile 字段」。且种子里 `appMenu` 是 `null`、`contentCategories` 没有 `synced_at`，种子这条路天生干净 |
| 端到端/视觉 | — | 无 UI 表现：菜单照常渲染、类别照常渲染，用户侧零感知 |
| 代码审查 | — | `compute_config_hash` 的注释把规则说得很清楚，读代码的人会认为「已经处理过了」——**注释与实现互相矛盾时，注释反而成了掩护** |

**系统性漏洞定位**（具体到文件）：

`ops-center/backend/tests/test_runtime_resilience_api.py` 缺少一条
**「真实装配路径下的 hash 稳定性」**判据。现有 volatile 测试全部建立在
**手工合成的 payload** 之上，而缺陷只会在**真实 service 装配**时出现。
这是「测试场景缺失」+「Mock/合成数据过度」的复合：合成数据绕过了出问题的那段代码。

---

## 3. 修复方案（选 A：把字段挪出 hash 输入集）

三个候选方案对比：

| 方案 | 做法 | 判定 |
|---|---|---|
| A | 把 `synced_at` 从两个块的载荷里删掉，只保留 bootstrap 信封顶层的 `synced_at`（顶层本来就不参与 hash） | ✅ **采用**：根治；时间戳信息零丢失，只是换了承载位置 |
| B | `compute_config_hash()` 序列化前剔除这两个块的 `synced_at` | ❌ 在 hash 层做特例，等于给「块内可以带 volatile 字段」开一个合法口子；下次新增带时间戳的块还会再犯 |
| C | 不动，只在看板注明「hash 会抖」 | ❌ 放弃指标 |

用户已确认：项目仍在开发期，**不需要考虑老客户端兼容**。

### 3.1 改动清单

**服务端（`ops-center/backend`）**

| 文件 | 改动 |
|---|---|
| `services/app_menu_service.py` | `get_bootstrap_app_menu()` 返回 `{"items": items}`，删除块内 `synced_at`，加注释说明为什么 |
| `services/content_category_service.py` | `get_bootstrap_content_categories()` 返回 `{"items": ..., "count": len(items)}`，删除块内 `synced_at`。`count` 是内容的纯函数（`len(items)`），保留 |
| `services/config_fingerprint.py` | `compute_config_hash` docstring 的三条约束扩为**四条**，新增第 4 条明确「白名单内每个块的载荷本身也不得含每请求变化的字段」，并指向回归锁 |
| `tests/test_app_menu_api.py` | 原断言 `isinstance(app_menu.get("synced_at"), str)`（**把缺陷当期望**）改为 `assert "synced_at" not in app_menu` + 顶层仍在 |
| `tests/test_config_hash_stability.py` | **新增**，4 条判据，见 §4 |

**桌面端（`apps/desktop`）**

| 文件 | 改动 |
|---|---|
| `electron/services/app-menu-config.js` | `normalizeAppMenu(raw, fallbackSyncedAt)`：时间戳优先取块内（向后兼容旧服务端），回落信封顶层 `fallbackSyncedAt`，再回落空串 |
| `electron/services/ops-center-sync.js` | 两个调用点传入信封顶层时间戳：`_loadRuntimeState()` 传 `state.syncedAt`（L2 快照恢复）、`applyRuntime()` 传 `payload.synced_at`。**零行增长**（该文件行数已顶挂账，见 §8） |
| `electron/services/ops-runtime-snapshot.js` | `SEED_BLOCK_TYPES` 的推导注释里补一条契约说明：非 null 块都是 hash 输入，块内不得含每请求变化的字段 |
| `electron/services/app-menu-config.test.js` | 新增 4 条：新形态取顶层 / 顶层也没有则空串 / 旧形态优先块内 / 块内非字符串回落 |
| `electron/services/ops-runtime-snapshot.test.js` | 新增 4 条种子与 payload 纯净锁，见 §4 |
| `electron/services/ops-center-sync.test.js` | 「空 items 是合法配置」的期望值 `syncedAt: ''` → `'t'`（夹具顶层就是 `'t'`），并把原因写进注释 |

**`contentCategories` 无需改桌面端**：`normalizeContentCategories(raw)` 只读 `raw.items`，
从不读块内 `synced_at`，删掉该键对桌面端零影响。

---

## 4. ④ 修复 + 回归保护测试

### 4.1 服务端：`ops-center/backend/tests/test_config_hash_stability.py`（新增）

判据刻意**不枚举字段名**，而是直接断言我们真正想要的不变量：

| # | 测试 | 模式 | 断言 |
|---|---|---|---|
| 1 | `test_bootstrap_config_hash_is_stable_across_identical_requests` | 集成（真实 ASGI + 真实库） | 同库连请求两次 bootstrap：**顶层 `synced_at` 必须不同**（证明两次确实跨过时钟刻度，不是同一时刻的假稳定），而 `config_hash` 与 `config_version` **必须逐字相等** |
| 2 | `test_no_whitelisted_block_carries_volatile_timestamp_key` | 集成 | 遍历 `RUNTIME_BLOCKS`，每个对象形态块的载荷都**不得含 `synced_at` 键**；同时顶层 `synced_at` 必须仍在 |
| 3 | `test_appmenu_and_contentcategories_blocks_are_pure_functions_of_content` | 单元（直调 service） | 两个 service 连调两次，`canonical_json` 结果逐字节相等，且块内无 `synced_at` |
| 4 | `test_story_text_limit_block_also_stays_pure` | 单元 | 顺手把本轮新加的 `storyTextLimit` 块纳入同一把尺子 |

**为什么 1 与 2 都要**：不变量测试抓「值在变」，静态锁抓「键还在」。
若某块只在特定条件下才写入 `synced_at`（例如库里没有目录行时走了另一条分支），
不变量测试可能恰好漏过，静态锁则不管条件如何都查得到。

### 4.2 变异反证（证明锁真的能抓到这个缺陷）

把修复临时回退（重新注入块内 `synced_at`），实测：

```
断言失败：内容未变而 config_hash 变了 ⇒ RUNTIME_BLOCKS 里有块掺了每请求变化的字段
E       AssertionError: assert '6f384242bb0386f9' == 'c3f0a53f660d6043'
```

还原后 4 条全绿。**锁不是装饰**：注回缺陷当场红。

### 4.3 桌面端：`ops-runtime-snapshot.test.js` 新增 describe

| # | 测试 | 断言 |
|---|---|---|
| 1 | 真实种子（`resources/ops-seed/runtime-bootstrap.json`） | 白名单内每个对象形态块都不得含 `synced_at`/`syncedAt` |
| 2 | 合成 payload 掺入块内 `synced_at` | hash **必须**改变（证明该字段确实参与计算，锁的不是空话） |
| 3 | 只有顶层 `synced_at` 变化 | hash **不得**改变（信封字段不参与计算） |
| 4 | 内容属性字段（`updated_at`）变化 | hash **必须**改变——防止后人把判据写宽、把「内容变更升版」这条正确语义一起判死 |

第 4 条是这次实测踩出来的：初版判据把 `updated_at` 也列进 `VOLATILE_KEYS`，
被 `content_policy` 块里的 `updated_at`（**内容属性**，运营改策略时它跟着变，hash 该变）
当场判红。`synced_at` 是「每次请求现生成」的时钟产物，`updated_at` 是「内容何时被改」——
只有前者有害。

---

## 5. ⑤ 预防措施（落地到具体文件）

| 措施 | 落点 |
|---|---|
| 契约文档从 3 条约束扩到 4 条，并**点名这次事故的两个文件与行号** | `ops-center/backend/services/config_fingerprint.py` `compute_config_hash` docstring |
| 桌面端 hash 真源处同步标注同一契约 | `apps/desktop/electron/services/ops-runtime-snapshot.js` `SEED_BLOCK_TYPES` 推导注释 |
| 「把缺陷当期望」的那条断言改为反向断言 | `ops-center/backend/tests/test_app_menu_api.py` |
| 经验沉淀（仓库内） | `01-docs/learnings.md`：2 条（顶层挡住 ≠ 块内干净；合成数据绕过真实装配路径） |
| 经验沉淀（仓库内） | `01-docs/BUGFIX-CONFIG-HASH-SYNCED-AT-2026-10-18.md`（本文件） |
| 经验沉淀（外部） | `~/.gstack/projects/multi-publish/learnings.jsonl` |
| 经验沉淀（EverOS） | `everos/data/knowledge/config-hash-purity-*/index.md` + `/api/v1/memory/add` + `/flush` |

### 5.1 写给后人的一条规则

> **往 `RUNTIME_BLOCKS` 里加新块时，先问一句：这个块的载荷里有没有「每次请求都会变」的字段？**
> 有 ⇒ 挪到 bootstrap 信封顶层（那里不参与 hash），或者干脆别下发。
> 判据：`ops-center/backend/tests/test_config_hash_stability.py` 会替你记住这件事。

---

## 6. 数据校验

### 6.1 下发载荷形状（修复后）

| 块 | 类型 | 形状 | 说明 |
|---|---|---|---|
| `appMenu` | `object-or-null` | `{ items: [{ key, visible, sort_order, group }] }` | **无 `synced_at`**；`group ∈ {primary, more}`；`sort_order ∈ [0, 9999]` |
| `contentCategories` | `array-or-object` | `{ items: [{ category_key, name, sort_order }], count: n }` | **无 `synced_at`**；`count === len(items)` 恒成立 |
| 信封顶层 `synced_at` | string | ISO-8601 | **不参与 hash**，仅用于「配置何时同步」的展示与诊断 |

### 6.2 校验判据（谁在守）

| 判据 | 位置 | 挡住什么 |
|---|---|---|
| `compute_config_hash` 只取白名单 + 缺失键补 null + 拒绝非整数 | `config_fingerprint.py` | 顶层 volatile 字段、删块静默不升版、跨端序列化漂移 |
| 白名单块内不得含 `synced_at`（新增第 4 条契约） | `config_fingerprint.py` docstring + `test_config_hash_stability.py` | 本次这类缺陷复发 |
| 种子 7 项 CI 判据（结构/类型/体积/BOM/词库/hash/新鲜度） | `ops-runtime-snapshot.js` | 坏种子被打包发布 |
| `normalizeAppMenu` 类型/长度/白名单/原型污染 | `app-menu-config.js` | 坏配置打挂侧边栏（fail-open 回退本地菜单） |

---

## 7. 流程与功能逻辑

### 7.1 修复后的数据流

```
运营在运营中心改菜单 / 内容类别
   ↓ 写库
桌面端启动 → OpsCenterSync.autoSyncOnStart()（setTimeout 3000，一次）
   ↓ GET /api/v1/runtime/bootstrap
服务端 get_runtime_bootstrap()
   ├─ appMenu            ← get_bootstrap_app_menu()          {items}            （无 synced_at）
   ├─ contentCategories  ← get_bootstrap_content_categories(){items,count}      （无 synced_at）
   ├─ storyTextLimit     ← get_bootstrap_story_text_limit() {story2video:{...}}
   ├─ …其余 11 个块…
   └─ synced_at          ← _now()    ← 信封顶层，不参与 hash
   ↓ compute_config_hash(白名单 14 块)  ← 内容纯函数：内容不变 ⇒ hash 不变
   ↓ resolve_config_version()           ← hash 未变则版本不动，不再每次 +1
   ↓ Ed25519 签名覆盖整个 payload（含 config_version / config_hash）
   ↓ 响应
桌面端 applyRuntime(payload)
   ├─ appMenu ← normalizeAppMenu(payload.appMenu, payload.synced_at)  ← 时间戳取自信封顶层
   └─ contentCategories ← normalizeContentCategories(payload.contentCategories)
   ↓ 写 L2 快照（settings）+ 广播 ops-center:runtime-updated
运营中心生效看板（RolloutView）收到 ACK ⇒ 已确认率真实反映铺开进度
```

### 7.2 `config_version` 的分配逻辑（不变，但现在才真正按设计工作）

`runtime_service.resolve_config_version(db, config_hash)`：

1. 取最新一行 `RuntimeConfigVersion`；
2. 若其 `config_hash` 与本次相同 ⇒ **直接返回该版本号**（不落新行）；
3. 否则 `version = latest.version + 1`，落一行新记录。

修复前第 2 步几乎永不命中（hash 每次都变），于是每次都走第 3 步 ⇒ 表无限增长。
修复后「运营没改配置」的重复启动全部命中第 2 步，**零新增行**。

---

## 8. 交互逻辑与显示项

本次**不新增任何 UI**。受影响的是既有页面的读数语义：

| 页面 / 组件 | 显示项 | 修复前 | 修复后 |
|---|---|---|---|
| 运营中心「生效看板」`RolloutView.vue` | 已确认率（`ack_rate`） | 永远上不去（客户端确认的是 v100，「最新版」已涨到 v101/v102） | 真实反映铺开进度 |
| 同上 | 已确认（其中降级中 N） | 虚高 | 真实 |
| 同上 | 分块确认率 | 长期低位 | 真实 |
| 同上 | 未确认客户端明细（`v{{row.config_version}}`） | 长期挂着大量记录 | 只有真正滞后的设备才出现 |
| 应用端侧边栏 `MpSidebar.vue` | 菜单项显隐/排序/分组 | 无变化 | 无变化 |
| 应用端「内容类别」选择器 | 类别列表 | 无变化 | 无变化 |

**提示文字**：无需改动。看板既有文案「查看每版配置在多少客户端真实生效」在修复前是
**名不副实**的（永远显示未生效），修复后才与文案一致。

---

## 9. 边界与异常

| # | 场景 | 期望行为 |
|---|---|---|
| B1 | 运营连续保存同一份配置 | 第 2 次起 `config_hash` 不变、`config_version` 不变、不落新行 |
| B2 | 运营真的改了菜单可见性 | hash 变、版本 +1、看板正常升版 |
| B3 | 桌面端重启但运营没改任何配置 | hash 与上次完全相同 ⇒ 客户端 ACK 命中同一版本 ⇒ 看板「已确认」 |
| B4 | 服务端返回的 `appMenu` 为 `null` | 桌面端 fail-open 回退本地默认菜单，不崩 |
| B5 | 旧服务端（块内仍带 `synced_at`）与新桌面端混跑 | `normalizeAppMenu` 优先读块内，时间戳不为空；hash 由服务端自己算，桌面端只验签 |
| B6 | 块内 `synced_at` 是非字符串（如数字） | 不透传；回落信封顶层，再回落空串 |
| B7 | 信封顶层也没有 `synced_at` | `syncedAt` 为空串；**不得**用 `new Date()` 伪造（`applyRuntime` 的 `replay` 分支已有此纪律，此处保持一致） |
| B8 | `content_policy` 块含 `updated_at` | **不算** volatile：内容属性，内容变则 hash 该变（回归锁第 4 条专门守这个方向） |
| B9 | `compute_config_hash` 遇到非整数数字 | 抛 `ValueError`，由调用方兜底降级为 hash 空串 + version 0（既有行为，不变） |

---

## 10. 验收标准

| # | 判据 | 验证方式 |
|---|---|---|
| A1 | 同库连构两次 bootstrap，`config_hash` 逐字相等 | `pytest tests/test_config_hash_stability.py` 4 passed |
| A2 | 注回缺陷，上述测试当场红 | 变异反证实测 `6f384242bb0386f9 != c3f0a53f660d6043` |
| A3 | `appMenu` / `contentCategories` 载荷无 `synced_at`，信封顶层有 | 静态锁 + `test_app_menu_api.py` |
| A4 | 桌面端 `syncedAt` 不为空且来自信封顶层 | `app-menu-config.test.js` 4 条 + `ops-center-sync.test.js` |
| A5 | 后端全量 pytest 无回归 | `python -m pytest -q` |
| A6 | 桌面端受影响面全绿 | `vitest run` 6 个 service 测试文件 |
| A7 | QM-1 打包 + 启动三层判据 | `electron-builder --win --dir` + 存活/stderr 断言 |

---

## 11. 迁移与回滚

**数据迁移**：无。`RuntimeConfigVersion` 是派生表（读时推导），历史行留着不影响正确性；
若嫌体积大，可在部署后单独 `DELETE FROM runtime_config_version WHERE version < <当前>`——
**不必做**，它只是每次一行的小表，修复后不再增长。

**回滚**：纯代码回滚即可，无 schema 变更、无数据变更。回滚后缺陷复现（hash 恢复每次变化），
但不会损坏任何配置内容——最坏就是看板读数重新失真。

---

## 12. 风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| 桌面端有别的消费方在读块内 `synced_at` | 已全仓 grep 确认：只有 `app-menu-config.js` 读它，已改 | `git grep synced_at` 全仓核对 |
| 删字段导致签名验证失败 | 不会：签名覆盖整个 payload，删一个键只是 payload 变了，签名是同一把钥匙对变化后的内容签的 | 端到端 bootstrap 请求 200 + `signature` 非空 |
| 固定 hash 向量需要重算 | 不需要：`test_runtime_resilience_api.py` 的三个向量都是**合成 payload**（不含这两个块的真实内容），与本次改动无关 | 全量 pytest 复核 |
| 种子 `_meta.config_hash` 需重算 | 不需要：种子里这两个块本来就没有 `synced_at`，删服务端字段不影响种子内容 | 种子校验 7 项判据全过 |
| 后人把判据写太宽（禁掉 `updated_at`） | 有反向锁第 4 条专门守 | `ops-runtime-snapshot.test.js` |

---

## 13. 关联文档

- 契约单一真源：`openspec/changes/ops-center-resilience/design.md` §1（本次修订其第 1.2 节约束清单）
- 桌面端对等实现：`apps/desktop/electron/services/ops-runtime-snapshot.js`
- 门禁执行记录：`openspec/records/config-hash-purity.md`
- 前序变更（新增长度控制块，同一套契约）：`01-docs/PRD-STORY-TEXT-LIMIT-CONTROL-2026-10-18.md`
