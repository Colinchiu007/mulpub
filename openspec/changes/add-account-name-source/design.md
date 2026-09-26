## Context

动机见 `proposal.md` - Why；行为契约见 `specs/desktop/account-display-name/spec.md`。此处只记录决定方案所依赖的现状事实（均已在规划期逐条核实）。

**基线 vs 现状差异审计**（`openspec/config.yaml:10` 要求）：本 change 建立在 `c9937925`（昵称噪声三层修复）之上。该提交已交付「采集端删标题兜底 + 选择器收窄 + 守卫形态化 + `resolveAccountDisplayName` 写入口收敛」，本 change **不重复规格化**这些已交付内容，只承载它暴露出而未解决的两件事：来源区分缺失、改名写错存储。既有 119 个 capability 中无任何覆盖账号名字段语义的规格（已搜 `account_name`、`账号`，仅 `desktop/account-login-capture`（管凭证捕获 IPC）、`credential-store-safe-storage-recovery`、`ops-center/local-login` 命中且均不涉及名字列），故本能力为全新，无 MODIFIED。

现状事实：

1. **账号读取真源是 JSON 不是 SQLite**：`packages/python-backend/src/server.py` 的 `/api/accounts` 读写 `ACCOUNTS_FILE = DATA_DIR / "accounts.json"`（`:336`），结构为 `dict[account_id, dict]`，无 `CREATE TABLE`。`apps/desktop/electron/services/store-schema.js:23-41` 另有一张 `accounts` 表（含 `account_name`），但 `login-status-monitor.js:67` 明确它「只用于就绪门禁」，不是读源。
2. **改名写链路是断的**：`stores/accounts.js:435` → `publisher.js:94 accountUpdate` → `preload/account.js:39 'store:update-account'` → `ipc-handlers/store.js:257` → Electron SQLite。`publisher.js:103` 已有注释承认「写了也不显示」。
3. **两道字段白名单会滤掉新字段**：后端投影 `server.py:405-420 _account_to_dict`，IPC 投影 `ipc-handlers/account.js:159-164 publicAccountFields`。且 `ipc-handlers/account.js:295` 硬编码 `account_name: safeAccount.account_name || safeAccount.name || ''` —— 这正是「机器值与用户值被一视同仁」的实际发生位置。
4. **`AccountUpdateRequest` 是 `extra="forbid"`**（`server.py:290-307`，尤其 `:293`），未声明的字段直接 422 而非被忽略；PATCH 语义为「缺席=不修改、空串=显式清空」（`:555-576`），该语义由 `tests/test_server_account_profile_patch.py:89-110` 锁定。
5. **回填侧现在用启发式猜「是不是手改名」**：`account-manager.js:712-713` 用 `isNoiseAccountName(curName)` 判断是否放弃覆盖 —— 这正是要被 `name_source` 取代的猜测。
6. **python-backend 缺 accounts 的测试确定化 fixture**：`packages/python-backend/tests/conftest.py` 全文 47 行无相关 fixture，各测试文件自行 `monkeypatch.setattr(server, "ACCOUNTS_FILE", ...)`。`AGENTS.md:534` 的 MUST 要求「测试库/配置状态必须按模块确定化，不得依赖导入顺序」在此适用，先例见 `ops-center/backend/tests/conftest.py:49,78` 与其配套反证对。

## Goals / Non-Goals

**Goals**
- 让「来源」成为一等数据，而不是靠文本形态反推。
- 改名成为真正可用的功能（写入读取真源）。
- 全仓账号名展示口径收敛到唯一解析入口，含排序、搜索、发布页选择器。

**Non-Goals**
- 不改 `accountInfoCollector` 的选择器表、不恢复任何标题兜底、不改守卫的 5 条形态规则本身（它们对 `auto` 值仍然正确）。
- 不引入「用户可把名字改回 auto」的反向操作 —— 改名即 `manual`，无 UI 出口回退。
- 不合并 Electron SQLite 与后端 JSON 两份存储（那是独立的架构议题）。SQLite 侧加列只为与读源保持字段对齐、避免门禁路径读到缺列行。
- 不做 `accounts.json` 的整文件重写式迁移。

## Decisions

**D1：`name_source` 落在后端 `accounts.json`，取值 `auto` / `manual`，缺失一律归一为 `auto`。**
新增 `_normalize_account_name_source()`，与既有 `_normalize_account_status`（`:251-258`）、`_normalize_account_active`（`:261-273`）同风格，在投影（`:405-420`）与 PATCH（`:555-576`）两处各调一次。
*实现期修正*：字段类型用 `str | None` 而非 `Literal["auto","manual"] | None`。因为 spec 要求非法值**归一为 auto**，而 `Literal` 会让 `"foo"` 直接 422，语义不符；`status` 也是同样的 `str | None` + 显式处理。同理大小写不敏感（`"MANUAL"` → `manual`）以对齐 `_normalize_account_status` 的 `strip().lower()` 约定。
*备选*：启动时遍历补齐所有行的该字段并回写文件 —— 否决：需要在启动路径做整文件原子重写，Windows 上引入 `renameSync` 冲突面（`AGENTS.md` 的「Windows 原子文件替换重试」条目），且读时归一已能给出确定语义，写盘补齐不增加正确性。
*备选*：不加字段、继续用 `isNoiseAccountName` 猜 —— 否决：这正是本 change 要消除的根因，猜错的方向是「藏掉用户的字」。

**D2：展示解析集中到新的渲染层共享 helper，而不是在 IPC 层预先合并。**
`ipc-handlers/account.js:295` 的 `account_name || name` 合并改为**如实透传两个字段 + `name_source`**；「显示什么」的决策全部下沉到 helper，供卡片、`AccountGroupsPanel.vue:118`、`AccountGroupManager.vue:63`、`PlatformAccountGroup.vue:126`、`PublishTargetSelector.vue:35,76`、`stores/accounts.js:138`（排序）、`:166-167`（搜索）、`usePlatformAccounts.js:44` 共用。
*备选*：在 IPC 层直接把 `name_source` 应用掉、给渲染层一个算好的 `displayName` —— 否决：会让编辑框回填值与显示值分家（评审实测的「编辑框回填的是平台名」正是这种提前合并的后果），且排序/搜索需要同一口径却拿不到原始字段。
**排序与搜索 MUST 用解析后的显示名**，否则用户搜不到、排不到自己起的名字。

**D3：改名改走后端 PATCH 真源，并同批写 `account_name` + `name_source='manual'`。**
`renameAccount` 不再使用 `accountUpdate`（SQLite 通道）。沿用 `publisher.js` 中已被验证可用的后端通道形态（`batchSetActive` 即因同类问题被明确要求「不得改回 accountUpdate」，见 `publisher.js:102-103`、`stores/accounts.js:398-401`）。改名失败 MUST 保留旧值并提示，不得出现界面与存储分裂。

**字段语义（实现期修正，原 D3 有误）**：`name_source` 描述的是 **`account_name`**，不是 `name`。理由：卡片 `AccountManagementCard.vue:227` 的读取顺序是 `account_name || name`，`account_name` 是优先显示位。若按原 D3 把手改名写进 `name`，则凡是 `account_name` 已有合法机器昵称的账号（例：微信公众号 `数字生命丘丘`）改名后仍显示 `account_name`，`manual` 永远不可见 —— 本 change 的核心目标直接落空。故：
- `account_name` = 显示名主体，机器回填写它（`auto`）、用户改名也写它（`manual`）；`name_source` 记录它的来源。
- `name` = 平台显示名 / 历史兼容字段，不再参与优先显示位，仅作为 `account_name` 为空时的兜底候选之一。
- 连带收益：`refreshProfileFromHttpApi` 现有的「`account_name` 非噪声 ⇒ 不覆盖」启发式，升级为「`name_source === 'manual'` ⇒ 不覆盖」，判据从猜文本形态变成读显式意图。

*备选*：把 `name` 从显示链彻底移除（单一显示字段）—— 否决：`PublishTargetSelector.vue:35,76` 等核心发布路径目前只读 `name`，一并改动会把回归面从账号页扩大到发布页，超出本 change 边界。
*备选*：卡片改为优先读 `name` —— 否决：实测 7 条存量的 `name` 全部是网页标题（`首页 - 知乎`、`公众号`、`快手，记录世界 记录你`），等于让标题盖住真实昵称，比现状更糟。

**D4：回填保护由「非噪声即保护」改为「`name_source === 'manual'` 即不覆盖」。**
`refreshProfileFromHttpApi`（`account-manager.js:701-725`）与 `refreshProfileFromPage`（`:672-691`）读 `name_source` 短路；`auto` 值仍走噪声判定 + 「新值合格才覆盖」。噪声守卫本身不动。

**D5：CJS/ESM 孪生守卫新增「按来源短路」的入参形态。**
短路逻辑放在**调用方 helper**，而不是给 `isNoiseAccountName` 加第二个参数 —— 保持判定函数签名不变，避免 CJS/ESM 两份签名漂移（既有 parity 回归只比常量与行为，不比签名）。

**D6：python-backend 补 accounts 的按模块 autouse 确定化 fixture。**
在 `packages/python-backend/tests/conftest.py` 增加 autouse fixture，统一把 `ACCOUNTS_FILE` 指向 per-test 临时路径并重置 `server` 模块级状态；配套「把该 fixture 改成 no-op 必须立刻变红」的反证对，照 `ops-center` 的 `test_zz_conftest_isolation_a_wrecker.py` / `..._b_consumer.py` 模式。

## Risks / Trade-offs

- **[存量行被一律归为 `auto`，历史上用户改过的名可能被藏]** → 实测生产 7 条的 `name` 全部是网页标题（`公众号`、`首页 - 知乎`、`快手，记录世界 记录你`、`头条号`…），归 `auto` 对现状是正确的；且被藏的唯一后果是回落平台名，用户重新改名一次即永久生效（`manual` 不再被任何规则过滤）。在 `01-docs` 复盘里显式写明该一次性成本。
- **[D3 改变改名落盘位置，可能影响依赖 SQLite `name` 的门禁/就绪路径]** → 实现时先跑 `store.test.js:364-377` 与 `login-status-monitor` 相关用例确认无读依赖；SQLite 侧仍保留 `name` 写入（best-effort），只是不再作为唯一写入点。
- **[D2 会让发布页显示值发生变化（`PublishTargetSelector` 此前只读 `name`，即网页标题）]** → 属修正而非回归，但**是用户可见变化**，必须写进 CHANGELOG 并在 PR 描述里点名。
- **[两道白名单漏改任意一道 → 字段静默丢失，表现为「改了没反应」** → 加一条从后端响应到渲染层 store 的端到端字段穿透断言（`tasks.md` T5），不能只测单侧。
- **[`extra="forbid"` 下漏声明字段 → 422 而非忽略]** → 后端契约测试显式断言 `name_source` 被接受、且未知字段仍 422（保住 forbid 的原有价值）。
- **[本 change 依赖 `c9937925` 已合入 main]** → 若 `c9937925` 的 PR 未先合并，本 change 的实现分支必须以 `c9937925` 所在分支为基线，否则 `resolveAccountDisplayName` 等锚点不存在。

## Migration Plan

1. 后端先行（向后兼容）：`AccountUpdateRequest` 加可选字段 + `_normalize_account_name_source` + 投影放行。**旧客户端不发送该字段 → 行为完全不变**，可独立部署与回滚。
2. 主进程：`publicAccountFields` 透传 + 撤掉 `:295` 的提前合并；回填两处改读 `name_source`。
3. 渲染层：新增共享 helper → 逐个消费点接入 → 改名改走后端 PATCH。
4. 测试与门禁：后端契约/穿透断言、accounts 确定化 fixture + 反证对、渲染层 helper 与各组件用例。
5. 文档：CHANGELOG（含发布页显示值变化）、`01-docs/learnings.md`（装饰性链路第四次复发）、`AGENTS.md` QM-2（「加字段必须同时改投影白名单」+「写入点必须落在读取真源」两条）、归档三同步（`openspec archive` + CCG task + 质量节拍复盘，`scripts/openspec-sync-check.js` 检查）。

**回滚策略**：步骤 1 独立可回滚（字段缺席即回到旧语义）。步骤 2-3 若需回滚，恢复 `ipc-handlers/account.js:295` 的提前合并与 `accountUpdate` 通道即可，`accounts.json` 中已写入的 `name_source` 属**只增不改**的多余键，旧代码不读它、不会报错，无需数据回迁。

## Open Questions

（无。D3 是否同时提供「恢复自动获取」按钮属产品决策，不影响本 change 的规格、方案与任务拆分，留待后续 change。）
