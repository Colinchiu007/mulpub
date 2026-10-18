---
record: config-hash-purity
task: 修复 config_hash 白名单内两个块自带 synced_at 导致的「内容没变、指纹每次都变」（含跨端契约修订与回归锁）
date: 2026-10-18
---

## 本次执行记录：`config_hash` 白名单块内 `synced_at` 污染（config-hash-purity，2026-10-18）

> 需求来源：用户在 `story-text-limit-control` 合并后追问「appMenu/contentCategories 两个块自带 synced_at 是什么意思」，
> 确认要修，选 **方案 A**（把字段挪出 hash 输入集），并明确「项目还在开发期，不用考虑老客户端」。
> 根因/逃逸/方案对比/数据校验/流程/交互/显示项/提示文字/边界/验收/风险全文见
> `01-docs/BUGFIX-CONFIG-HASH-SYNCED-AT-2026-10-18.md`。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR（运行时代码 + 文档） | 隔离 worktree `D:\Data\projects\mp-worktrees\mp-config-hash-purity`（**D 盘，非 C 盘**）+ 裸分支 `config-hash-purity`；共享根全程停在 `main` 且未落任何改动（`git status --porcelain` = 0）。入口 `scripts/start-mp-task.ps1 -TaskName config-hash-purity`，`verify-worktree-deps.js` 11 项消费方解析通过 |
| 第一性原因（QM-5 ①） | ✅ | 两个 service 的下发载荷构造函数各带一个块内 `_now()`：`app_menu_service.py:306` `{"items": items, "synced_at": _now()}`、`content_category_service.py:343` `{"items": items, "count": n, "synced_at": _now()}`，而 `appMenu` / `contentCategories` **都在** `config_fingerprint.RUNTIME_BLOCKS` 内、参与 `compute_config_hash`。**顶层挡住 ≠ 块内干净**：`runtime_service.get_runtime_bootstrap()` 的信封顶层 `synced_at` 本来就不在白名单内，问题全出在块内又各带一份。**引入链**（三个各自无害的决定组合成缺陷）：2026-09-15 `app-menu-runtime-config` 首次下发带 `synced_at`（当时无 hash 机制，无害）→ 2026-10-03 `content-categories` 照抄该形态（同样无害）→ 2026-10-08 `ops-center-resilience` 建立白名单与 hash，无害字段进入输入集，缺陷成立 |
| 逃逸分析（QM-5 ②） | ✅ | ① 单元层：`test_config_hash_excludes_volatile_fields` 只构造**合成 payload**，手工往顶层塞 `synced_at` 断言 hash 不变——验证的是一条**已经成立**的性质，从未走过 `get_runtime_bootstrap()` 真实装配路径；② 集成层：`test_app_menu_api.py` 那条 `assert isinstance(app_menu.get("synced_at"), str)` **把缺陷本身当成了期望行为**；③ 种子层：种子里 `appMenu` 是 `null`、`contentCategories` 没有 `synced_at`，7 项 CI 判据天生干净；④ E2E/视觉：无 UI 表现，用户侧零感知；⑤ 审查层：`compute_config_hash` 的 docstring 把规则写得很清楚，读代码的人会认为「已处理」——**注释与实现矛盾时，注释反而成了掩护**。系统性漏洞：缺少「真实装配路径下的 hash 稳定性」判据 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复见下；回归锁 `ops-center/backend/tests/test_config_hash_stability.py`（**新增，4 条**）：判据刻意**不枚举字段名**而直接断言不变量——① 真库 + 真 ASGI 连请求两次 bootstrap，顶层 `synced_at` **必须不同**（证明两次跨过时钟刻度、不是同一时刻的假稳定），而 `config_hash` 与 `config_version` **必须逐字相等**；② 遍历 `RUNTIME_BLOCKS`，对象形态块都不得含 `synced_at` 键，同时顶层必须仍在；③ 两个 service 直调两次，`canonical_json` 逐字节相等；④ `storyTextLimit` 块纳入同一把尺子。**变异反证**：把修复临时回退（重新注入块内 `synced_at`），实测当场红 `assert '6f384242bb0386f9' == 'c3f0a53f660d6043'`，还原后 4 条全绿 ⇒ 锁不是装饰 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① `config_fingerprint.compute_config_hash` 的约束从 3 条扩为 **4 条**，新增「白名单内每个块的载荷本身也不得含每请求变化的字段」并点名本次事故的文件与行号；② 桌面端 hash 真源 `ops-runtime-snapshot.js` 的 `SEED_BLOCK_TYPES` 推导注释同步标注同一契约；③ 把「缺陷当期望」的那条断言改为**反向断言**（`assert "synced_at" not in app_menu`）；④ 桌面端 `ops-runtime-snapshot.test.js` 新增 describe（4 条，含**反向锁**：`updated_at` 等内容属性字段变化时 hash **必须**改变）；⑤ `01-docs/learnings.md` 改写 1 条 + 新增 3 条；⑥ 外部记忆 JSONL 4 条 + EverOS 知识文件 |
| 跨端契约一致性 | ✅ | 删的是**块内**字段，`RUNTIME_BLOCKS` 白名单**数量与成员不变（14）**，两端无需同步改；三个固定 hash 向量（`f559cffbd7fc2bcf` / `301dd86b76646d9f` / `b0d4bb463f2b9776`）均为**合成 payload**、不含这两个块的真实内容 ⇒ **无需重算**，`test_runtime_resilience_api.py` 全绿佐证；随包种子 `runtime-bootstrap.json` 里这两个块本来就没有 `synced_at`（`appMenu: null`、`contentCategories: {items,count}`）⇒ **种子 `_meta.config_hash` 无需重算**，7 项种子判据全绿 |
| 桌面端消费面收口 | ✅ | 全仓 `git grep synced_at` 核对：块内该键的消费方**只有** `app-menu-config.js`（已改为 `normalizeAppMenu(raw, fallbackSyncedAt)`：块内优先 → 信封顶层回落 → 空串，**向后兼容旧服务端**）；`contentCategories` 的 `normalizeContentCategories` 只读 `raw.items`，删键零影响；`ops-center-sync.js:362` 读的是**信封顶层** `synced_at`（本就正确）；`diagnostics-reporter.js:228` 的 `synced_at` 是诊断快照自产字段、不在白名单内 |
| TDD / 测试实测 | ✅ | 后端全量 `python -m pytest -q` → **676 passed / 0 failed**（原 672 + 新增 4，8:53）；桌面端受影响面 6 个 service 测试文件 → **275 passed**（app-menu-config 8 / ops-runtime-snapshot 52 / ops-center-sync 90 / ops-resilience-reporter 40 / story2video-text-config 85 / story2video-batch-queue）；ESLint 改动文件 0 error |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐行相同；无删除文件 |
| 接线棘轮 | ✅ | 新增 2 个测试文件（`test_config_hash_stability.py`、桌面端新增 describe 内嵌既有文件）均被既有 glob 覆盖；`node scripts/check-unwired-tests.js` → OK |
| QM-1 打包 | ✅ | 改了 `apps/desktop/electron/` 下 3 个文件 ⇒ 跑 `pnpm run build:dir`；asar 清单含新主进程模块；**启动验证三层判据**：存活断言 + stderr 判读（父环境带 `ELECTRON_RUN_AS_NODE` 时用 `scripts/lib/qm1-child-env.js::buildChildEnv()` 剔除并出声告警） |
| QM-4 视觉 | N/A | **零 UI 改动**：不新增/修改任何 `.vue`、样式、主题色、字号。受影响的是运营中心「生效看板」既有页面的**读数语义**（修复前它的已确认率名不副实，修复后才与既有文案一致）⇒ 视觉基线无需重捕，`check-baseline-freshness` 不受影响 |
| QM-6 CCG 双模型外部评审 | ✅ 已执行并逐条闭环（`self_play_resolved`） | `sh scripts/deep-review.sh`（`mode=dual`，变更 327 行 > 200 阈值）：跨家族校验 proposer=opencode / critic=claude **通过**，产出 5 条问题、4 个维度评分（correctness/security/performance/maintainability，**最低分 7**），收敛后进入自扮演裁决。**3 条争议逐条填 verdict**（`.adversarial/ccg-deep-<sha>/adjudication.json`，含每条的最强指控/最强辩护/裁决/可验证理由）：<br>🟠 **i1（crypto 高危域，upheld 已修）**：`config_fingerprint.py` 第 4 条把 `updated_at` 与 `synced_at` 并列称为 volatile，与桌面端回归锁「`updated_at` 变化必须改变 hash」直接矛盾 ⇒ 后人照它扩 `VOLATILE_KEYS` 会把「内容变更升版」这条正确语义一起判死。已改为「不得含每请求变化的**时钟产物**」并新增「时钟产物 vs 内容属性」的区分段。<br>🟠 **i2（upheld 已修）**：测试原断言两次请求顶层 `synced_at` 必须不同，同毫秒执行会偶发假失败（flake CI）⇒ 删前置断言，改注释说明「守的是 hash 与 version 相同」。<br>🟢 **i3（dismissed）**：测试改全局 `os.environ` + `sys.path.insert` 被指污染 pytest 套件 ⇒ 辩护成立：照抄 `test_runtime_resilience_api.py` 既有约定、`conftest.py` 已 `setdefault` 兜底、后端全量 **676 passed / 0 failed** 即无污染经验证据；已在测试 docstring 写明来历。复跑 `test_config_hash_stability` + `test_runtime_resilience_api` + `test_app_menu_api` = **81 passed** |
| locale 成对 | ✅ | 本轮**零 locale 改动**（无新增用户可见文案；看板既有文案在修复前名不副实、修复后才与之一致，无需改文案） |
| 文档门禁 | ✅ | `check-no-brand-residue.js` PASS；`check-doc-abs-paths.js` PASS（无新增本机绝对路径）；`check-max-lines.js` ✅ 无新增超大文件（`config_fingerprint.py`、`ops-center-sync.js` 均**零行增长**——后者挂账 570+200 已顶格，本次靠「只在既有行内加参数」保持） |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（squash 尾注 `(#NNNN)`）推导归属；合并前本文件不在基线上，判 byDesign 不红。**不得**预写成 `PASS`（会判 `prematureClaim` 红） |

### 遗留（不假装已闭合）

1. **`RuntimeConfigVersion` 历史行未清理**：修复前每次 bootstrap 落一行，表里已积累若干行。它是**读时推导的派生表**，历史行不影响正确性（`resolve_config_version` 只查「hash 是否见过」与「最新版本号」），故**刻意不迁移**；若将来体积成为问题，可单独 `DELETE FROM runtime_config_version WHERE version < <当前版本>`，但那需要一次明确的运维决策，不在本 change 范围内。
2. **判据只锁 `synced_at`，不锁 `updated_at`/`created_at`**：这是**有意的**——`updated_at` 是内容属性（运营改了配置它跟着变，hash 该变），只有 `synced_at` 是每请求时钟产物。已加反向锁守这个方向（`updated_at` 变化时 hash **必须**改变）。将来若出现新的「每请求变化」字段形态（随机数、服务器启动计数等），不变量测试会抓到，但静态锁不会——静态锁的清单**只能按需扩，不能预防性扩**（扩了就会误伤内容属性字段）。
3. **`ops-center-sync.js` 行数顶格未解**：770 行 = 挂账 570 + 容差 200 用满，本次靠合并进既有行保持零增长；下一处任何 +1 行会触发 `LEDGER_GREW`，需先拆分文件。
4. **「块内纯净」目前靠 2 个文件的注释 + 2 处测试锁**，没有上升到 CI 的结构扫描（例如「任何 service 的下发载荷不得含 `_now()`」这类 grep 级判据）。当前判据强度已能抓住实际发生过的形态，暂不加重；若再犯一次，应升级为机械扫描。

## 关联

- 缺陷全文（根因溯源/逃逸分析/方案对比/数据校验表/流程/功能逻辑/交互/显示项/提示文字/边界 9 条/验收 7 条/迁移/风险 5 条）：`01-docs/BUGFIX-CONFIG-HASH-SYNCED-AT-2026-10-18.md`
- 契约单一真源：`openspec/changes/ops-center-resilience/design.md` §1（本次修订其 §1.2 约束清单，3 条 → 4 条）
- 桌面端对等实现：`apps/desktop/electron/services/ops-runtime-snapshot.js`
- 前序变更（同一套契约上新增长度控制块）：`01-docs/PRD-STORY-TEXT-LIMIT-CONTROL-2026-10-18.md`
