## Why

上一轮修复（`c9937925`）为「机器抓错的网页标题不再冒充账号名」给展示层加了噪声守卫，但系统**没有任何字段能区分「这个名字是机器抓的」和「这个名字是人写的」**，于是同一层守卫把两者一起过滤。独立评审实测确认：用户把账号改名为 `阿飞 - 自由职业`、`Rhythm · 音乐厅`、`小美…的厨房` 后，卡片仍显示平台名，且编辑框回填的也是平台名 —— 用户输入的名字在 UI 上不可达。这是我们这次**引入**的显示回归，不是既有缺陷。

同时暴露第二处：`AccountGroupsPanel.vue` / `AccountGroupManager.vue` 直接渲染 `account_name || name` 而**不过**守卫，所以「展示端回落平台名」这一收口在账号管理页之外并不成立，6 条存量脏值在「分组管理」界面原样可见。

仅靠收窄规则无法同时满足「藏掉机器抓错的标题」与「绝不藏用户写的字」—— 二者需要的是同一个判断的两个相反答案，必须引入来源标记。

**规划期新查实的第三处（改变本 change 的必要范围）**：`renameAccount`（`apps/desktop/src/stores/accounts.js:435`）经 `accountUpdate` → `store:update-account`（`electron/preload/account.js:39`）写入 **Electron SQLite**，而账号列表读的是 **python-backend `accounts.json`** —— `apps/desktop/src/api/publisher.js:103` 已有明文注释「不得改回 accountUpdate：那条通道写 Electron SQLite，而账号列表根本不从那里读，写了也不显示」。即**用户改名至今是空操作**。因此「来源为 `manual`」这个状态在当前代码里根本无法产生，`name_source` 必须连同这条写链路一起修，否则本 change 的核心能力不可达。这属 `01-docs/learnings.md` 记录的「装饰性链路」第四次复发。


## What Changes

- 账号记录新增 **`name_source`** 字段，取值 `auto`（机器：DOM 采集 / 平台 API / 登录捕获的网页标题 / 平台显示名回落）或 `manual`（用户在卡片上显式改名）。存量行一律按 `auto` 处理。
- **BREAKING（数据契约，非用户可见）**：`/api/accounts` 的 POST/PATCH 请求体与响应体新增 `name_source`；渲染层 `renameAccount` 从「只写 `name`、且写进了不被读取的 Electron SQLite」改为「写后端 `accounts.json` 真源，同时带 `name` + `name_source='manual'`」。
- 展示层统一为**一个**账号名解析入口（新共享 helper）：`name_source === 'manual'` 时**原样显示、不过任何噪声规则**；否则按噪声守卫过滤，命中即回落平台显示名。
- 卡片、`AccountGroupsPanel`、`AccountGroupManager` 以及其余消费账号显示名的渲染点全部改走该 helper，消除「有的过守卫、有的不过」的口径漂移。
- 写回侧维持既有保护语义：`manual` 的名字不得被 `refreshProfileFromHttpApi` / `refreshProfileFromPage` 的回填覆盖（现状靠「非噪声即保护」间接达成，改为按 `name_source` 显式判定）。

## Capabilities

### New Capabilities
- `desktop/account-display-name`: 账号显示名的来源标记、解析优先级与展示口径 —— 规定 `name` / `account_name` / `name_source` 三字段的语义边界，机器抓取值与用户显式命名各自的可见性规则，改名必须落到读取真源，以及所有展示消费点必须共用同一解析入口。

### Modified Capabilities
（无。既有 119 个 capability 中不存在覆盖账号数据模型或账号显示名的规格，本 change 不修改任何既有需求。）

## Impact

- **后端持久化**：`packages/python-backend` 的 accounts 存储（`accounts.json`，由 `MULTI_PUBLISH_DATA_DIR` 定位）需新增字段与**存量行缺字段的默认值补齐**；PATCH/POST 的 pydantic 请求模型与响应投影需放行该字段。具体表/模型位置与既有「加列」先例在 `design.md` 落实。
- **桌面主进程**：`apps/desktop/electron/publishers/account-manager.js`（`resolveAccountDisplayName` 创建/重登入口、`profileForCreate`、`buildProfilePatch`、`refreshProfileFromHttpApi`）需按 `name_source` 决定「可否覆盖」。`apps/desktop/electron/services/store/*` 若存在第二份 accounts 真源需同步。
- **渲染层**：`apps/desktop/src/stores/accounts.js`（`renameAccount`）、`AccountManagementCard.vue`、`AccountGroupsPanel.vue`、`AccountGroupManager.vue` 及其余显示消费点。
- **共享包**：`packages/shared-utils/src/account-name-guard.js` 与 `.browser.js` 孪生 —— 判定入口需支持「按来源短路」，两侧行为必须继续逐字一致（已有 parity 回归锁定）。
- **测试**：python-backend pytest（注意既有「测试库状态必须按模块确定化」的坑）、desktop vitest（卡片/分组面板/store/主进程写回）、shared-utils 守卫与孪生 parity。
- **不受影响**：本次不动采集器 `accountInfoCollector` 的选择器表与已删除的标题兜底；不动噪声守卫的 5 条形态规则本身（它们对 `auto` 值仍然正确）。
