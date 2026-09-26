## 1. 前置确认（不动代码）

- [x] 1.1 确认实现分支基线含 `c9937925`（`resolveAccountDisplayName`、守卫 5 条形态规则、`account-name-guard.browser.js` 孪生均存在）；不含则以 `account-nickname-noise-fix` 分支为基线重开
- [x] 1.2 只读核实 `login-status-monitor.js` 与就绪门禁不读取 Electron SQLite 的 `accounts.name`（决定 D3 回滚风险面），把结论写进本 change 目录备注
- [x] 1.3 跑 `packages/python-backend` 全量 pytest 与 `apps/desktop` 全量 vitest 取**改动前基线红名单**，供后续判定「是否本 PR 引入」
  - 后端：43 条红项（清单 `%TEMP%/f2-pytest-baseline.txt`），账号面零命中。桌面：`653 passed | 1 failed | 1 skipped`，唯一红项 `electron/services/feedback.test.js:32`（本机 symlink EPERM 既有环境项）。

## 2. 后端：字段、归一与投影（TDD）

- [x] 2.1 RED：在 `packages/python-backend/tests/test_server_account_name_source.py` 新建用例 —— ① POST 不带 `name_source` → 响应投影为 `auto`；② PATCH `name_source="manual"` 后 GET 返回 `manual`；③ PATCH 缺席 → 不修改（对齐 `test_server_account_profile_patch.py:89-110` 语义）；④ PATCH 非法值（如 `"foo"`、`123`）→ 归一为 `auto` 且不 500；⑤ 未知字段仍 422（保住 `extra="forbid"` 价值）。实测确认全部变红
  - 实测：`5 failed, 1 passed`。唯一通过的 ⑤ 是既有 `extra="forbid"` 行为，作为「不许回退」护栏保留。
  - 对 ④ 的一处修正：`"MANUAL"` 我最初列为非法，但本模块既有约定是大小写不敏感归一（对齐 `_normalize_account_status` 的 `strip().lower()`），故改为**显式断言 `"MANUAL"` → `manual`**，防止后来者「顺手收紧」把手改名判成非法。非法集改为 `foo` / `""` / `"auto "` / `unknown` / `"0"`。
- [x] 2.2 GREEN：`server.py` 四处 —— `AccountCreateRequest`(~`:282`) 与 `AccountUpdateRequest`(`:290-307`) 加 `name_source: str | None = None`；新增 `_normalize_account_name_source()`（与 `:251-273` 两个既有归一函数同风格）；create 落盘(`:515-529`)、PATCH 分支(`:555-576`)、投影 `_account_to_dict`(`:405-420`) 各接入
  - 实现注：字段类型取 `str | None` 而非 `Literal[...]`，因为 spec 要求非法值**归一为 auto**（不是 422）；`Literal` 会把 `"foo"` 直接拒掉，语义不符。与 `status` 的既有处理同构。
- [x] 2.3 修正因新增字段而红的既有断言：`test_server_account_lifecycle.py:36`（全等比较）、`test_server_logto_auth.py:98`；逐条确认是「字段增加」导致的预期变化，不是行为回归
  - **实测结论：一条都没破。** `test_server_account_lifecycle.py:31-36` 断言的是 `_load_accounts()` 读**手写夹具文件**（`b'\xef\xbb\xbf{"account-a": {"id": "account-a"}}'`），不是新建行，加 create 字段碰不到它。design.md 的这条预测有误，已回改。
  - 证据：`test_server_account_profile_patch.py + test_server_account_lifecycle.py + test_e2e_api.py + test_server_logto_auth.py` → `71 passed`。
- [x] 2.4 反证：临时把 `_normalize_account_source` 改成恒返回 `"manual"`，确认 2.1 的 ①④ 立刻变红（证明断言有鉴别力，非恒真）
  - 实测：`2 failed, 4 passed` —— 红的正是 ① 与 ④。
  - **① 为什么红（已追清，非偶发）**：mutation 让「已存储的合法字符串 `auto`」在 GET 投影时被改写成 `manual`，所以该用例实际锁住的是**投影侧对存量值的归一**，不只是 create 默认值。
  - 其余 4 条在 mutation 下仍绿属预期：它们显式写入 `manual`，走的就是被改写成 `manual` 的那条分支。
  - 已还原并复核：`grep -rn COUNTERPROOF packages/python-backend/src/` → 无残留；还原后 `6 passed`。

## 3. 后端：测试确定化（AGENTS.md:534 MUST）

- [x] 3.1 在 `packages/python-backend/tests/conftest.py` 增加 autouse fixture：按模块把 `ACCOUNTS_FILE` 指向 `tmp_path` 下唯一路径并重置 `server` 模块级状态（照 `ops-center/backend/tests/conftest.py:49,78` 模式）
  - 实现注：用**函数级**而非模块级 —— 成本只是路径赋值，隔离度更高。用例内自己的 `monkeypatch` 仍生效（后设先还原，交还给本 fixture 的值再交还模块原值）。
- [x] 3.2 配套反证对 `test_zz_conftest_isolation_a_wrecker.py` / `..._b_consumer.py`：制造方写入并推进状态、消费方不清库不建表断言初始值；把 3.1 的 fixture 改成 no-op 必须**立刻变红**，否则视为装饰性锁不予接受
  - **安全修正（偏离原任务措辞，理由如下）**：不能把 fixture 改成彻底 no-op 来做反证 —— 那会让制造方把行写进 `server` 的模块默认 `ACCOUNTS_FILE`，本机即真实的 `userData/backend-data/accounts.json`，等于污染用户数据。改为「有指向、但不隔离」（全部用例共用一个固定临时目录）来做反证，同样证明 per-test 唯一性承重。
  - 实测：共用路径下 `1 failed, 1 passed`，红的正是消费方，报错内容为 A 泄漏的那一行 `{'zz-conftest-isolation-probe': ...} == {}`。还原后 `2 passed`，`grep -c COUNTERPROOF conftest.py` = 0。
  - 另一处修正：`tests/` 含 `__init__.py` 是包，跨文件 `from test_zz_..._a_wrecker import PROBE_ID` 在 pytest prepend 导入模式下会解析失败，故 B 内改为重复定义常量并注释说明。
- [x] 3.3 全量 pytest 复跑，确认无跨文件共享 `accounts.json` 残留（单跑绿、全量红即未收口）
  - 实测：排除 4 个环境性不可收集模块后，红项 43 条，与 Group 1 基线 `diff` **完全一致（零新增、零消失）**；账号测试面仍全绿。

## 4. 主进程：透传与回填保护

- [x] 1 RED：`apps/desktop/electron/ipc-handlers/account.test.js` 新增断言 —— 后端返回 `name_source="manual"` 时，IPC 投影结果**同时保留** `name`、`account_name`、`name_source` 三个原始字段，且 `account_name` 不再被 `account_name || name` 提前合并覆盖（`account.js:295`）
- [x] 2 GREEN：`ipc-handlers/account.js` 的 `publicAccountFields`(`:159-164`) 加 `name_source`；撤掉 `:295` 的提前合并，改为如实透传
- [x] 3 RED：`account-manager-profile.test.js` 新增 —— ① `name_source="manual"` 且现值为噪声形态（如 `阿飞 - 自由职业`）时，HTTP 回填**不得**覆盖 `account_name`；② `auto` 且现值合格时，采集到 `首页 - 知乎` 不得覆盖；③ `auto` 且现值为空时，合格昵称正常回填
- [x] 4 GREEN：`refreshProfileFromHttpApi`(`account-manager.js:701-725`，尤其删掉 `:712-713` 的 `isNoiseAccountName(curName)` 启发式) 与 `refreshProfileFromPage`(`:672-691`) 改按 `name_source` 短路；`buildProfilePatch` 写回时同步维护 `name_source='auto'`
- [x] 5 若 1.2 判定 SQLite 需字段对齐：`store-schema.js` 按 `migrateAccountCredentialSchema`(`:390-402`) 先例加 `ALTER TABLE accounts ADD COLUMN name_source TEXT`（`PRAGMA table_info` 预判，SQLite 不支持 `ADD COLUMN IF NOT EXISTS`），并同步 `account-store.js:78-88` 与 `OWNER_COLUMN_DEFAULTS`(`:274-279`)

> **Group 4 实现期收口记录**
> 4.1 / 4.3 均先实测 RED 再 GREEN（分别 `3 failed|1 passed`、`3 failed|12 passed`）。
> - **新发现第 6 处「测试反向固化错误行为」**：既有 5 条 `toEqual` 精确断言（`account.test.js:255/740/791/942/990`）的 mock **只给 `name`、从未提供 `account_name`**，却断言 `account_name === name` —— 把 D2 要删除的 IPC 提前合并钉成了正确行为。撤掉合并后必然变红，已同步为 `account_name: ''` + `name_source: 'auto'`。
> - 4.3 第 2 条的报错把旧缺陷钉死：`expected { account_name: '平台返回的昵称', … } to not have property "account_name"` —— 旧启发式在用户手改的名字**恰好长得像噪声**时会直接冲掉改名。即「按形态猜」不是不够精确，而是主动破坏用户意图。
> - mock 手法要点（否则假绿）：`account-manager.js:13` 在 require 期就把 `fetchAccountInfoViaHttpApi` 解构为本地绑定，`vi.spyOn(accountManager, …)` 拦不住；必须「先给仍被 `require.cache` 保留的 `http-login-checker` 装 spy，再清 account-manager 缓存重新 require」。
> - 4.4 落地为共享判据 `guardProfilePatchBySource(patch, current)`，两条回填路径同一处收口；且只有**真的**写 `account_name` 时才下发 `name_source='auto'`，避免昵称被保护住时顺带把 `manual` 降级。
> - 4.5 **判定不做**：依 1.2 结论，SQLite 非读源（`login-status-monitor.js:63` 只取 `_store._ready`），`store:*` 的读消费者不驱动展示；改名改走后端后 SQLite 的 `name` 成为陈旧副本但无消费者，属可接受残留。若将来 SQLite 被提升为读源，必须回补本项。
> - 验证：`electron/publishers/ + ipc-handlers/account.test.js + src/features/accounts/ + Accounts + stores/accounts + auth-view-manager` → **18 files / 469 passed | 1 skipped**。

## 5. 端到端字段穿透（防两道白名单漏改）

- [x] 5.1 新增一条从「后端 PATCH 落盘」到「渲染层 store 拿到的账号对象」的穿透断言用例（可用临时 HTTP 服务 + 真实 `toPublicAccount`/`publicAccountFields`，不得两侧都 mock），断言 `name_source` 全程不丢
- [x] 5.2 反证：临时从 `publicAccountFields` 删掉 `name_source`，5.1 必须变红

## 6. 渲染层：唯一解析入口

- [x] 6.1 RED：新建 `apps/desktop/src/utils/account-display-name.test.js`，逐条覆盖 spec 的场景 —— ① `manual` 原样返回，含 `阿飞 - 自由职业`、`Rhythm · 音乐厅`、`小美…的厨房`、`小红书创作服务平台`（即使用户起的名字恰好等于平台页面名也不过滤）；② `auto` 命中噪声回落平台名，含 `485.9万人看过`、`哔哩哔哩 (゜`、`首页 - 知乎`；③ `auto` 真实昵称 `数字生命丘丘` 正常返回；④ 两字段皆空/缺席 → 平台名；⑤ `name_source` 缺失 → 按 `auto` 处理
- [x] 6.2 GREEN：实现 `apps/desktop/src/utils/account-display-name.js`，内部复用 `@multi-publish/shared-utils/src/account-name-guard`（走 vite alias 的 ESM 孪生），**不改** `isNoiseAccountName` 签名
- [x] 6.3 卡片接入：`AccountManagementCard.vue` 的 `accountName()`(`:226-230`) 改调 helper；确认编辑框回填(`:78`) 与 `aria-label`/`:title`(`:6`,`:15`,`:20`) 用的是同一个解析值
- [x] 6.4 分组接入：`AccountGroupsPanel.vue:118`、`AccountGroupManager.vue:63`、`PlatformAccountGroup.vue:126` 全部改调 helper；补一条「同一账号在卡片与分组面板显示同一个值」的跨组件一致性用例
- [x] 6.5 排序/搜索/其它接入：`stores/accounts.js:138`（排序键）、`:166-167`（搜索命中）、`usePlatformAccounts.js:44`、`Accounts.vue:836`（改名去重比较）改走解析后的显示名 —— 用户必须能搜到、排到自己起的名字。**本项曾被假勾**：独立评审（两位同时指出）实测四处全部未改，卡片显示「今日头条」而列表按脏 `account_name` 排序/命中。本轮真实落地：新增 `stores/accounts.js` 的 `displayNameOf()`（内部即唯一入口 + 平台名回落），排序键、搜索命中、`usePlatformAccounts.getAccountText`（侧栏）、`Accounts.vue` 改名去重比较与删除确认文案全部改走它；`account-name-source-passthrough.test.js` 另加一条**全仓扫描**（非白名单）断言渲染层不再出现 `account_name ||` 手搓回退，并用「把 `Accounts.vue` 那行改回 raw」的变异证明该锁会变红（4 处 → 红，还原后字节一致）
- [x] 6.6 发布页接入并确认：`PublishTargetSelector.vue:35,76`、`Publish.vue:128` 此前只读 `account.name`（即网页标题），改走 helper 后显示值会变。跑 `npm run test:visual:pixel` 前先看该页基线是否需人工审核更新，并在 CHANGELOG 显式记为「用户可见变化」。**本项曾被假勾**：CHANGELOG 用户可见变化第 2 条与 `PublishTargetSelector.vue:35,76` 都按「已接入」写成，而该文件根本不在 diff 里（独立评审发现，实测 10 条显示名场景反证）。本轮真实接入并补 6 条行为用例：`auto` 脏值/标题回落平台名、`manual` 原样显示、合法昵称不被平台名覆盖、平台名也拿不到才用 id 前 8 位、搜索命中显示名而不再命中被隐藏的标题；变异回 raw `account.name` 时其中 4 条立刻变红。视觉基线仍待 9.3 在有 dev server 的环境补跑。

## 7. 改名落到读取真源

- [x] 7.1 RED：`stores/accounts.test.js` / `Accounts.test.js` 新增 —— `renameAccount(id, '阿飞 - 自由职业')` 必须调用**后端 PATCH 通道**（断言具体 API 与参数 `{ name, name_source: 'manual' }`），且 `load()` 之后卡片显示该名字；失败路径断言界面保留旧值并提示
- [x] 7.2 GREEN：`stores/accounts.js:434-437` 改走 `publisher.js` 中打后端真源的通道（参照 `batchSetActive` 因同类问题被明确要求的写法，见 `publisher.js:102-103`）；不得再使用写 SQLite 的 `accountUpdate`
- [ ] 7.3 手动验证（不可用测试替代）：真实 Electron 窗口里改名 → 卡片立即生效 → 重启应用后仍生效；同时验证一个含 ` - ` 的名字不被藏。**未执行**：QM-1 的 8 秒启动因本 worktree 打包未捆 python-backend（`spawn python ENOENT`）→ 账号列表加载不了 → 改名链路根本没走到（见 `.quality-gates.md` 同条自证）。本项此前被勾成 `[x]` 属**假完成**，独立评审指出后改回。须在 `mp-app-live` 同步本分支后于真实窗口补做。

## 8. 守卫孪生与 parity

- [x] 8.1 确认 `account-name-guard.js` 与 `.browser.js` 在本次改动后仍逐字一致（规则顺序、词表、正则 `source`+`flags`）；若新增导出（如 helper 需要的 `hasUnbalancedBrackets`）则两侧对称导出，并把新导出纳入 `account-name-guard.test.js` parity 断言（评审已指出 ESM 导出该函数而 CJS 未导出，属不对称）
- [x] 8.2 卡片级回归补网：`AccountManagementCard.test.js` 增加「`manual` 名字不被形态规则过滤」用例（评审指出 5 条形态规则在展示端零覆盖）

## 9. 全量回归与门禁

- [x] 9.1 `packages/shared-utils`、`packages/python-backend`、`apps/desktop` 三处全量测试通过，红名单逐项对照 1.3 基线，确认无新增失败（既有 `feedback.test.js` symlink EPERM 属环境项）
- [x] 9.2 `pnpm exec eslint` 覆盖所有改动文件 rc=0；locale 若新增文案必须 zh/en 成对（CI Gate 7）
- [ ] 9.3 视觉回归 `npm run test:visual:pixel`（发布页与账号页显示值变化），基线更新需人工审核 diff 图
- [ ] 9.4 QM-6 CCG 双模型外部评审：本机 `codeagent-wrapper` 不在 PATH 且 `.ccg/config.toml` 缺失，若仍不可用则按 `.quality-gates.md` 既有先例**如实登记未执行 + 环境证据**，并以独立上下文评审替代，不得谎称通过
- [x] 9.5 `openspec validate add-account-name-source --strict` 通过；`.quality-gates.md` 追加本次执行记录（含反证证据与 fresh 数字）
- [x] 9.6 CI `QG Static` 首次真实红（`check-locale-sync`）后收口，两类根因分开处理：
  - **本 PR 真错**：`stores/accounts.js` 的 `renameAccount` 新写了硬编码中文 `'账号不存在'`，违反 AGENTS.md「新增用户可见文案一律写入 locales」。改为 `i18n.global.t('accountsPage.accountNotFound')`，zh/en 成对新增，并把原来只断言 `code: -2` 的用例升级为精确断言本地化后的文案（否则键缺失时静默回落 key 字符串，测试照绿）。
  - **门禁自身的第二份拷贝未修**：`--py-cjk` 基线仍按 `file:line` 存储，而渲染端 `--cjk` 早在 2026-09-12（PR #1732 事故）已迁到 `file||content`。本 PR 在 `server.py` 上方插入约 19 行即让 17 条**既有**中文 `raise` 整体错位、全部报成「新增」。先用 main/branch 逐文件内容集对照证明 `src/server.py` 命中集 11↔11、新增 0 条（即红项纯属行号漂移），再把 `resolveContentBaseline` 抽成两侧共用、`--update-py-baseline` 改吐内容键、基线一次性迁移（79 → 67 条，同文件同文案去重）。
  - **反证**：`check-locale-sync.test.js` 新增 `--py-cjk` 行号漂移回归（插一行必须仍 PASS）与「新增中文 raise 必须变红」两条，后者同时断言 `server.py` 逐字节还原，防止内容基线退化为常绿。9 条自测全绿。
  - 9.2 的「locale 成对」当时是按「我有没有成对新增键」判过的，没跑 `--cjk` 本身；后续把「跑门禁脚本」而非「自查改动」作为 9.2 的完成判据。
- [x] 9.7 QM-6 替代：CCG 双模型外部评审**本机仍不可用**（`.ccg/config.toml` 不存在、`codeagent-wrapper` 不在 PATH，本轮二次核实），按 9.4 约定降级为**两路独立上下文评审**（后端/规格轴 + 前端/可维护性轴，并行派发、互不告知对方结论）。合计 2 条 CRITICAL + 5 条 MAJOR，处置如下：
  - 🔴 **`updateCapturedAccount` 未过 `guardProfilePatchBySource`**：三条「凭证落盘」同族路径里只锁了两条（正是 AGENTS.md 点名的沉默缺陷形态）。用户改名后再登录 → 抓到的昵称覆盖 `account_name` 而 `name_source` 仍为 `manual` → 该行此后再无任何一道会过滤它，**反转本 change 的核心不变量**。已补守卫 + 2 条用例（manual 不覆盖且不顺带降级 / auto 正常覆盖并同步来源）；变异「删掉那行守卫」→ 恰好这 2 条变红。
  - 🔴 **发布页选择器未接入唯一入口**（详见 6.6，并伴随 CHANGELOG / tasks 假完成）。
  - 🟠 **`name` 作为第二显示候选被摘除**（评审 MAJOR：规格从未授权，而 `account-display-name.test.js:49-51` 已把它钉成契约 = 「测试反向固化错误行为」）。定案依据是真实 `accounts.json` 8 条：`name` 全是 `document.title`，4 条合法昵称全在 `account_name`；摘除后唯一受影响的存量行是快手，其 `name` = `快手，记录世界 记录你`（无分隔符/省略号/平台后缀，形态规则判不出）—— 保留即让原 Bug 从第二扇门复发。规格已补 Scenario 钉住，`usePlatformAccounts.getAccountText`（侧栏）同步。
  - 🟠 **两份同名 `resolveAccountDisplayName` 签名不同**（主进程收 `(rawName, platform)`、渲染层收 `(account, options)`）→ 主进程侧改名 `resolveCapturedDisplayName`，并在文件头写明「刻意不同名」的理由（AGENTS.md「禁止第四份映射」防的正是这个形态）。
  - 🟠 **内容键去重弱点**：`file||content` 把同文件同文案的第 2..N 次命中并成一条，「复用一条已入基线的中文串」这条最省事的绕过路径对门禁完全免疫（实测 py 侧 79 处命中 → 67 个键，`server.py||账号不存在` 已出现 5 次而基线只有 1 条）。改为 `file||content||#N` 出现次序键并重生成基线（67 → 79），另加专属反证「复用一条已入基线的中文也必须变红」。渲染端**本轮不同步**：其基线是热文件（近 60 天被 8 个 PR 改过，历史上还有两笔「基线行号随行更新」的手工修线提交），后缀化会产生 1581 行纯格式 churn 并与并发会话必冲突 —— 已登记为债务（见 `.quality-gates.md`「新登记债务项」）。
  - 🟠 **`Accounts.vue:836` 改名去重比较用 raw 字段**：用户输入恰等于被守卫隐藏的那串脏值时，改名静默 no-op 且零反馈。改为与卡片显示值同源。
  - 两条评审点到但**本轮不改**、登记为债务：`ipc-handlers/store.js` 另有第二份 `publicAccountFields`（不含 `name_source`、仍做 `account_name || name` 合并，当前无渲染端消费者）；`src/api/publisher.js` 的 `accountUpdate` 失去最后消费者成为死导出，而它正是「写了不显示」的断链。

- [x] 9.8 **本 PR 自己造成的静默退化（自查发现，非评审提出）**：合并 `#2414` 后去看它重捕的 `accounts-list.png`，发现 CI 视觉基线里确实渲染着 8 个带名字的账号，顺藤摸到 `tests/e2e/fixtures/accounts.json` —— 它把显示名放在 `name`、完全没有 `account_name`（本 PR 之前的数据模型，当时 IPC 会做 `account_name || name` 合并）。本 PR 撤掉那道合并 + 摘除 `name` 候选，两条叠加会让这 8 张卡片全部退化成平台名，而**三道门禁都不会红**：没有任何测试断言这些名字；该夹具经 `fixture-loader.js` 注入 `window.__fixtures` 走 IPC mock、绕过主进程白名单；Gate 7 `PIXEL_THRESHOLD=0.06` 吸收得掉整页文字变化。
  - 处置：夹具按当前模型补 `account_name`（逐行核对渲染文本 8/8 与既有基线一致，故**不需要重捕 PNG**）；`acc_wechat_001` 标 `name_source=manual`，让 e2e/视觉数据真正覆盖「manual 原样显示、不过守卫」这条分支。
  - 锁：`e2e-quality-infrastructure.test.js` 新增形状断言（每行必须有非空 `account_name`、`name_source` 取值合法、至少一条 manual），49 例全绿；变异「把夹具改回只有 `name`」→ 该锁变红并点名缺失字段，改回后逐字节还原。
  - 可 generalize 的判据：**撤掉一处隐式合并时，必须连喂给测试与视觉的夹具数据形状一起改**。退化若只发生在像素层，那一层恰恰是这套门禁最瞎的（0.06 容差 + 无人断言文案）。
## 10. 文档与归档三同步

- [x] 10.1 `CHANGELOG.md` 收口：显式写「改名此前是空操作」「发布页账号显示值变化」两条用户可见影响
- [x] 10.2 `01-docs/learnings.md` 追加：装饰性链路第四次复发（写入口与读真源不是同一份）+ 「加字段必须同时改投影白名单」的识别手法；用双向校验脚本确认未吞相邻条目标题
- [x] 10.3 `AGENTS.md` QM-2 新增两条：① 新增持久化字段必须同时改**所有**投影白名单并配端到端穿透断言；② 任何「用户输入落盘」的写入口必须先证明它写的是读取真源（写副本不算完成）
- [ ] 10.4 归档三同步：`openspec archive` + CCG task 归档 + 质量节拍复盘，跑 `scripts/openspec-sync-check.js` 确认无漂移
