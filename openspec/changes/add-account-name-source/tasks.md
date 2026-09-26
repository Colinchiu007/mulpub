## 1. 前置确认（不动代码）

- [ ] 1.1 确认实现分支基线含 `c9937925`（`resolveAccountDisplayName`、守卫 5 条形态规则、`account-name-guard.browser.js` 孪生均存在）；不含则以 `account-nickname-noise-fix` 分支为基线重开
- [ ] 1.2 只读核实 `login-status-monitor.js` 与就绪门禁不读取 Electron SQLite 的 `accounts.name`（决定 D3 回滚风险面），把结论写进本 change 目录备注
- [ ] 1.3 跑 `packages/python-backend` 全量 pytest 与 `apps/desktop` 全量 vitest 取**改动前基线红名单**，供后续判定「是否本 PR 引入」

## 2. 后端：字段、归一与投影（TDD）

- [ ] 2.1 RED：在 `packages/python-backend/tests/test_server_account_name_source.py` 新建用例 —— ① POST 不带 `name_source` → 响应投影为 `auto`；② PATCH `name_source="manual"` 后 GET 返回 `manual`；③ PATCH 缺席 → 不修改（对齐 `test_server_account_profile_patch.py:89-110` 语义）；④ PATCH 非法值（如 `"foo"`、`123`）→ 归一为 `auto` 且不 500；⑤ 未知字段仍 422（保住 `extra="forbid"` 价值）。实测确认全部变红
- [ ] 2.2 GREEN：`server.py` 四处 —— `AccountCreateRequest`(~`:282`) 与 `AccountUpdateRequest`(`:290-307`) 加 `name_source: Literal["auto","manual"] | None = None`；新增 `_normalize_account_name_source()`（与 `:251-273` 两个既有归一函数同风格）；create 落盘(`:515-529`)、PATCH 分支(`:555-576`)、投影 `_account_to_dict`(`:405-420`) 各接入
- [ ] 2.3 修正因新增字段而红的既有断言：`test_server_account_lifecycle.py:36`（全等比较）、`test_server_logto_auth.py:98`；逐条确认是「字段增加」导致的预期变化，不是行为回归
- [ ] 2.4 反证：临时把 `_normalize_account_name_source` 改成恒返回 `"manual"`，确认 2.1 的 ①④ 立刻变红（证明断言有鉴别力，非恒真）

## 3. 后端：测试确定化（AGENTS.md:534 MUST）

- [ ] 3.1 在 `packages/python-backend/tests/conftest.py` 增加 autouse fixture：按模块把 `ACCOUNTS_FILE` 指向 `tmp_path` 下唯一路径并重置 `server` 模块级状态（照 `ops-center/backend/tests/conftest.py:49,78` 模式）
- [ ] 3.2 配套反证对 `test_zz_conftest_isolation_a_wrecker.py` / `..._b_consumer.py`：制造方写入并推进状态、消费方不清库不建状态并断言初始值；把 3.1 的 fixture 改成 no-op 必须**立刻变红**，否则视为装饰性锁不予接受
- [ ] 3.3 全量 pytest 复跑，确认无跨文件共享 `accounts.json` 残留（单跑绿、全量红即未收口）

## 4. 主进程：透传与回填保护

- [ ] 4.1 RED：`apps/desktop/electron/ipc-handlers/account.test.js` 新增断言 —— 后端返回 `name_source="manual"` 时，IPC 投影结果**同时保留** `name`、`account_name`、`name_source` 三个原始字段，且 `account_name` 不再被 `account_name || name` 提前合并覆盖（`account.js:295`）
- [ ] 4.2 GREEN：`ipc-handlers/account.js` 的 `publicAccountFields`(`:159-164`) 加 `name_source`；撤掉 `:295` 的提前合并，改为如实透传
- [ ] 4.3 RED：`account-manager-profile.test.js` 新增 —— ① `name_source="manual"` 且现值为噪声形态（如 `阿飞 - 自由职业`）时，HTTP 回填**不得**覆盖 `account_name`；② `auto` 且现值合格时，采集到 `首页 - 知乎` 不得覆盖；③ `auto` 且现值为空时，合格昵称正常回填
- [ ] 4.4 GREEN：`refreshProfileFromHttpApi`(`account-manager.js:701-725`，尤其删掉 `:712-713` 的 `isNoiseAccountName(curName)` 启发式) 与 `refreshProfileFromPage`(`:672-691`) 改按 `name_source` 短路；`buildProfilePatch` 写回时同步维护 `name_source='auto'`
- [ ] 4.5 若 1.2 判定 SQLite 需字段对齐：`store-schema.js` 按 `migrateAccountCredentialSchema`(`:390-402`) 先例加 `ALTER TABLE accounts ADD COLUMN name_source TEXT`（`PRAGMA table_info` 预判，SQLite 不支持 `ADD COLUMN IF NOT EXISTS`），并同步 `account-store.js:78-88` 与 `OWNER_COLUMN_DEFAULTS`(`:274-279`)

## 5. 端到端字段穿透（防两道白名单漏改）

- [ ] 5.1 新增一条从「后端 PATCH 落盘」到「渲染层 store 拿到的账号对象」的穿透断言用例（可用临时 HTTP 服务 + 真实 `toPublicAccount`/`publicAccountFields`，不得两侧都 mock），断言 `name_source` 全程不丢
- [ ] 5.2 反证：临时从 `publicAccountFields` 删掉 `name_source`，5.1 必须变红

## 6. 渲染层：唯一解析入口

- [ ] 6.1 RED：新建 `apps/desktop/src/utils/account-display-name.test.js`，逐条覆盖 spec 的场景 —— ① `manual` 原样返回，含 `阿飞 - 自由职业`、`Rhythm · 音乐厅`、`小美…的厨房`、`小红书创作服务平台`（即使用户起的名字恰好等于平台页面名也不过滤）；② `auto` 命中噪声回落平台名，含 `485.9万人看过`、`哔哩哔哩 (゜`、`首页 - 知乎`；③ `auto` 真实昵称 `数字生命丘丘` 正常返回；④ 两字段皆空/缺席 → 平台名；⑤ `name_source` 缺失 → 按 `auto` 处理
- [ ] 6.2 GREEN：实现 `apps/desktop/src/utils/account-display-name.js`，内部复用 `@multi-publish/shared-utils/src/account-name-guard`（走 vite alias 的 ESM 孪生），**不改** `isNoiseAccountName` 签名
- [ ] 6.3 卡片接入：`AccountManagementCard.vue` 的 `accountName()`(`:226-230`) 改调 helper；确认编辑框回填(`:78`) 与 `aria-label`/`:title`(`:6`,`:15`,`:20`) 用的是同一个解析值
- [ ] 6.4 分组接入：`AccountGroupsPanel.vue:118`、`AccountGroupManager.vue:63`、`PlatformAccountGroup.vue:126` 全部改调 helper；补一条「同一账号在卡片与分组面板显示同一个值」的跨组件一致性用例
- [ ] 6.5 排序/搜索/其它接入：`stores/accounts.js:138`（排序键）、`:166-167`（搜索命中）、`usePlatformAccounts.js:44`、`Accounts.vue:836`（改名去重比较）改走解析后的显示名 —— 用户必须能搜到、排到自己起的名字
- [ ] 6.6 发布页接入并确认：`PublishTargetSelector.vue:35,76`、`Publish.vue:128` 此前只读 `account.name`（即网页标题），改走 helper 后显示值会变。跑 `npm run test:visual:pixel` 前先看该页基线是否需人工审核更新，并在 CHANGELOG 显式记为「用户可见变化」

## 7. 改名落到读取真源

- [ ] 7.1 RED：`stores/accounts.test.js` / `Accounts.test.js` 新增 —— `renameAccount(id, '阿飞 - 自由职业')` 必须调用**后端 PATCH 通道**（断言具体 API 与参数 `{ name, name_source: 'manual' }`），且 `load()` 之后卡片显示该名字；失败路径断言界面保留旧值并提示
- [ ] 7.2 GREEN：`stores/accounts.js:434-437` 改走 `publisher.js` 中打后端真源的通道（参照 `batchSetActive` 因同类问题被明确要求的写法，见 `publisher.js:102-103`）；不得再使用写 SQLite 的 `accountUpdate`
- [ ] 7.3 手动验证（不可用测试替代）：真实 Electron 窗口里改名 → 卡片立即生效 → 重启应用后仍生效；同时验证一个含 ` - ` 的名字不被藏

## 8. 守卫孪生与 parity

- [ ] 8.1 确认 `account-name-guard.js` 与 `.browser.js` 在本次改动后仍逐字一致（规则顺序、词表、正则 `source`+`flags`）；若新增导出（如 helper 需要的 `hasUnbalancedBrackets`）则两侧对称导出，并把新导出纳入 `account-name-guard.test.js` parity 断言（评审已指出 ESM 导出该函数而 CJS 未导出，属不对称）
- [ ] 8.2 卡片级回归补网：`AccountManagementCard.test.js` 增加「`manual` 名字不被形态规则过滤」用例（评审指出 5 条形态规则在展示端零覆盖）

## 9. 全量回归与门禁

- [ ] 9.1 `packages/shared-utils`、`packages/python-backend`、`apps/desktop` 三处全量测试通过，红名单逐项对照 1.3 基线，确认无新增失败（既有 `feedback.test.js` symlink EPERM 属环境项）
- [ ] 9.2 `pnpm exec eslint` 覆盖所有改动文件 rc=0；locale 若新增文案必须 zh/en 成对（CI Gate 7）
- [ ] 9.3 视觉回归 `npm run test:visual:pixel`（发布页与账号页显示值变化），基线更新需人工审核 diff 图
- [ ] 9.4 QM-6 CCG 双模型外部评审：本机 `codeagent-wrapper` 不在 PATH 且 `.ccg/config.toml` 缺失，若仍不可用则按 `.quality-gates.md` 既有先例**如实登记未执行 + 环境证据**，并以独立上下文评审替代，不得谎称通过
- [ ] 9.5 `openspec validate add-account-name-source --strict` 通过；`.quality-gates.md` 追加本次执行记录（含反证证据与 fresh 数字）

## 10. 文档与归档三同步

- [ ] 10.1 `CHANGELOG.md` 收口：显式写「改名此前是空操作」「发布页账号显示值变化」两条用户可见影响
- [ ] 10.2 `01-docs/learnings.md` 追加：装饰性链路第四次复发（写入口与读真源不是同一份）+ 「加字段必须同时改投影白名单」的识别手法；用双向校验脚本确认未吞相邻条目标题
- [ ] 10.3 `AGENTS.md` QM-2 新增两条：① 新增持久化字段必须同时改**所有**投影白名单并配端到端穿透断言；② 任何「用户输入落盘」的写入口必须先证明它写的是读取真源（写副本不算完成）
- [ ] 10.4 归档三同步：`openspec archive` + CCG task 归档 + 质量节拍复盘，跑 `scripts/openspec-sync-check.js` 确认无漂移
