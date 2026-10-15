---
record: zhihu-api-settings
task: 知乎 Access Secret 设置化（设置页新增「知乎 API」分区 + 按用户隔离 + safeStorage 加密 + 旧版明文兼容迁移）
date: 2026-10-15
branch: zhihu-api-settings
sync_status: PENDING
sync_reason: PR 尚未合并（记录随代码 PR 落地，合并后回填 merge SHA）
sync_backfill_owner: zhihu-api-settings 会话（回填 PR）
---

## 本次执行记录：知乎 API 凭据设置化（zhihu-api-settings，2026-10-15）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`apps/desktop/electron/**` + `apps/desktop/src/**`）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-zhihu-api-settings`，裸分支 `zhihu-api-settings`，基线 `origin/main`=`a42ed9e19`。**入口偏差如实登记**：官方入口 `scripts/start-mp-task.ps1` 与 `gwm-task.sh start` 均被拒（主工作区 `clean:false`——并发会话正在共享根暂存 docs-only 回填），改为 PowerShell 原生 `git worktree add -b zhihu-api-settings <worktree 绝对路径> origin/main`（不触碰共享根 index/工作树），并以 `git worktree list` + `rev-parse --abbrev-ref HEAD` 实证落盘、`pre-code-edit-guard` 放行。依赖就绪：`pnpm install --frozen-lockfile` rc=0 + `ensure-electron.js` v43.7.7 + `verify-worktree-deps.js` OK（打包前复跑） |
| 第一性原因 | PASS | **用户问「密钥是不是写死的」——核查结论是否**：全仓检索无密钥字面量、无配置携带，live 库（`shared-user-data/multi-publish.db` 23 行设置、`%APPDATA%\@multi-publish\desktop\multi-publish.db` 7 行）均**无**该键。真实缺陷是另外三条：①明文落盘（全局 `settings.zhihu_access_secret`）；②设备级共享不按用户隔离；③保存后不回填且无状态/无自检/无出口（每次开页面都要重粘，而密钥其实早在库里）。证据与逐条判据见 PRD §0.1 |
| TDD（先红后绿） | PASS | 先写测试 ⇒ `zhihu-credential.test.js`+`zhihu-settings.test.js` 两文件 **33 红**（`Cannot find module './zhihu-settings'`，模块不存在）；补实现 ⇒ 同两文件 **33 绿**（服务 20 + handler 13）。后续 4 文件合计 **63 绿**：`zhihu-credential`(20)/`zhihu-settings`(14)/`zhihu-favlist-service`(18)/`zhihu-favlist`(12) |
| 实现 | PASS | ①`electron/services/zhihu-credential.js`（唯一真源：validate/readConfig/resolveSecret/saveConfig/markVerified/clearConfig，密文经 `services/crypto` safeStorage，写后读回校验，保存即销账旧明文）；②`electron/ipc-handlers/zhihu-settings.js`（4 通道，`withSenderCheck` + 错误码 -2/-1 分档）；③`ipc-handlers/index.js` 注册；④`zhihu-favlist.js` 改用同一真源；⑤`license-access-control.js` 写明 4 条配置通道 authenticated 的**有意不对称**；⑥`zhihu-favlist-service.testConnection` 复用收藏夹列表这一条真实鉴权调用；⑦`preload/aggregation.js` 暴露 4 绑定 + 重打包两份 bundle；⑧`components/ZhihuSettingsTab.vue`；⑨`SettingsDialog` Tab 顺序（知乎**紧邻飞书之下**）+ `initialTab`；⑩`stores/settings-dialog.requestSettingsDialog(tab)`（带 seq，同 Tab 连点两次仍触发）+ `App.vue` 接线；⑪`BatchCollectPanel` 移除就地输入改状态条 + 前往设置 + 可用性判据 `source!=='none'`；⑫locales zh/en 成对（删已无消费者的 `secretPlaceholder`/`secretRequired`） |
| 单测（定向 + 消费者并集） | PASS（含一次 CI 抓红） | 渲染端：`ZhihuSettingsTab`(14)/`SettingsDialog`(9)/`stores/settings-dialog`(4)/`features/collection` 全量（18 文件 **215 绿**）/`overlay-view-suspension`/`settings-panel-layout` 全绿。Electron：`ipc-contract`+`build-preload`+`license-access-control`+`preload/access-control`+4 个 zhihu 测试 = **121 绿**。**消费者并集漏项（CI 抓红）**：`App.vue` 新增的 `settingsDialogRequest` 让两个**以 mock 消费该模块**的既有测试红（`publish-draft-keepalive`、`publish-tab-state-keepalive` 的 `vi.mock('@/stores/settings-dialog')` 只导出 `notifySettingsDialogClosed` ⇒ `watch(undefined)` 抛错，CI 5 例红）。修法：mock 与真实模块**被消费面**同形（补 `settingsDialogRevision`/`settingsDialogRequest`）；教训是「按 import 找消费者」漏掉了「按 mock 消费」的一类，此后对改动的 store 模块一律加跑 `grep -l "vi.mock('<模块路径>'"` |
| 门禁（静态） | PASS | `check-locale-sync --keys` PASS（2047 key 全存在；**本次实测抓到一次漏配** `collection.zhihuFavlist.configNotConfigured`，补入 zh/en 后转绿）；`--cjk` PASS（基线 1374→当前 1224，无新增硬编码中文）；`check-max-lines.js` ✅ 无新增超大文件；`check-unwired-tests.js` OK |
| QM-2 必检项 | PASS（含一次 CI 抓红） | 无硬编码密钥（新代码只读取存储值）；IPC 参数纯 JSON（渲染端只传 string）；新模块 `require` 路径逐条核对存在；preload 改动后重打包两份 bundle 且 `ipc-contract.test.js` 断言每个 preload 通道都有主进程 handler；无 `console.log` 污染；无同步 CPU 密集原语（凭据读写在保存/测试这类低频路径）。**ESLint 教训（如实登记）**：本地只跑了 vitest、**没跑 eslint** ⇒ CI `QG Static` 的 Gate 11 抓到两处 error（`zhihu-credential.js` 的 `no-control-regex` 与一处未使用赋值）；已改为码点比较 + 结构调整，本地按 CI 同口径 `pnpm exec eslint electron/ src/ --quiet` 复跑 **rc=0**，并重跑受影响的两个变异（M2/M5 仍指名红、还原字节一致） |
| 视觉 token | PASS | `collection-tokens.test.js` **实测抓到硬编码** `#67c23a` ⇒ 改语义令牌 `--color-success/-soft`；同时把 `ZhihuSettingsTab` 的状态/徽标/危险按钮全部改 token（`--color-success`/`--color-danger`/`--color-success-soft`/`--color-danger-soft`），暗色模式随令牌生效 |
| 变异反证 | PASS | 8 个变异全部**指名红 + 字节级还原**（`ESCAPED=0/8`）：M1 不销账旧明文→2 红；M2 密文解不开冒充未配置→2 红；M3 优先级反转→2 红；M4 未保存值也写 verifiedAt→**首跑逃逸**（见下）；M5 去掉读回校验→1 红；M6 保存后不清空输入→1 红；M7 Tab 顺序对调→4 红；M8 可用性判据收窄为 readable→2 红。还原用整文件字节快照写回，逐个 `restored=true` |
| M4 逃逸复盘（本次最有价值的一条） | PASS（已修） | 首跑 M4 **red=0 逃逸**：原断言只观察「未保存值测试后 `setUserSetting` 未被调用」，而库里本来没有配置行时 `markVerified` 会因「无行可更新」而 no-op ⇒ 变异体照样通过。**逃逸的是测试的观察通道，不是实现**：真伤害场景是「已有配置 A，用户拿未保存的 B 去测」——此时写 verifiedAt 等于给 A 盖上它从未通过的章。补 `zhihu-settings.test.js` 专锁该格（存 A → 测 B → 配置字节不变且 `verifiedAt` 仍为 null），复跑 M4 变红。同因修正：M7 首跑 `ANCHOR_MISS` 暴露出驱动未归一化行尾（本仓 `core.autocrlf=true`，**git 检出文件在工作区是 CRLF，新建文件是 LF**），补 CRLF 变体匹配后 M7 报 4 红 |
| QM-1 打包 | PASS | 见下方「QM-1 取证」小节：rc=0 + 9/9 模块在场 + **8/8 逐文件 sha256 与工作区相等** + 两份 preload 产物含 4 绑定 + 启动 8s 存活且 stderr 长度 0 |
| QM-4 视觉回归 | PASS（含一次假红证伪） | 见下方「QM-4 取证」小节：首轮 collection 1.44% 系**端口被另一会话 dev server 占用**（量错对象）；对本 worktree 自起 5199 后单视图 PASS（0.000%）；**去掉本次改动的对照组同样 1.44%** ⇒ 该差异与本次改动无因果，未动基线 |
| 执行记录取证 | PASS | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` ⇒ OK（本记录随代码 PR 携带；`.quality-gates.md`/ledger 按 2026-10-15「旧载体冻结」新规**不再新增块与键**） |
| 门禁（CCG） | PASS（含一次被拦） | CCG 判定层：本次改动 2253 行 > 200 ⇒ `mode=dual`。`verify-security` **首轮拦下本次 amend**：报 `publish-tab-state-keepalive.test.js`/`publish-draft-keepalive.test.js` 各 1 处高危 —— 根因是这两个文件里**既有的** `document.body.innerHTML = ''`（XSS sink 形态）。处置：两处改为等价的 `document.body.replaceChildren()`（jsdom 实测支持、5 例仍绿），既解阻又消掉一笔真实存量债，**不用** `SKIP_CCG_GATE=1` |
| QM-6 双模型评审 | PASS（发现 2 MAJOR + 3 MINOR，已修 4 条） | 跨家族双模型在真实 worktree 上对 PR diff 做只读审查：`claude` 2.1.296 + `opencode` 1.18.34（后端体检 `deep-review.sh --check-deps` 通过）。**claude 收敛出 5 条**（见下），**opencode 未在合理时间内收敛**（详见「未闭合」）。发现与处置见「QM-6 评审取证」小节 |

| 远程同步 | PENDING | PR 未开（记录先落地）。合并后本次**同一次提交**改写为 `PASS` + merge SHA 并删除 frontmatter `sync_*` 三字段 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅（`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径各自 20 行，一致）| 品牌残留 随 CI | 文档同步 ✅（PRD + openspec change + 上游 PRD 指针 + 主 PRD 索引）| 执行记录 ✅ | 远程同步 PENDING

### 方法学教训（本次实测，值得复用）

**「变异反证」与「打包」绝不可并发**：本次首轮把变异驱动与 `pnpm run build:dir` 同时启动，M4 的变异窗口（约 20:35–20:38）恰好被 electron-builder 读取 `electron/` 目录撞上 ⇒ **asar 里收录的是变异体**（`zhihu-settings.js` 少了 `if (!explicit)`），而工作区已被驱动还原成正确版本。
它的危险形态是「**验证会给出假绿**」：若只做「asar 里有这个文件吗」（本次首个探针就是这么写的，还先被自己的路径分隔符 bug 挡住），结论会是 PASS；本次是靠**逐文件 sha256 与工作区对账**才暴露出 5085 vs 5100 字节的差异。
口径：① 变异/注入类实验与打包、截图、真机跑**串行**，不并行；② 交付产物的验收判据必须包含**内容同一性**（sha256 逐文件对账），「文件在场」不构成证据；③ 一旦发现产物来自被污染的时间窗，判据作废、**重新打包重验**，不得沿用旧产物数据。

**视觉门禁必须核对「目标是谁的服务」**：`test:visual:pixel` 默认打 `127.0.0.1:5174`，而本机多 worktree 并发时该端口**常被别的会话占着**（本次实测：`mp-fix-newtab-home-slow` 的 vite `--port 5174 --strictPort`）。此时整轮跑出的 19 绿 1 红，量的全是**别人的代码** —— 绿是假绿、红也是假红，而报告里没有任何一栏记录"目标是谁"。口径：① 跑像素门禁前后一律看开头那行 `目标:`，并核对它与本 worktree 自起服务的端口一致；② 本 worktree 自起服务用非默认端口（本次 5199）+ `TEST_URL` 指过去，避免与任何并发会话抢端口；③ 判「本次改动是否引入回归」的**决定性**证据是**去掉本次改动的对照组**（同机、同套件、同轮次），而不是"我这轮是绿的"。

### QM-1 取证

判据脚本：本会话 `D:\Temp\qm1-zhihu-verify.cjs`（判据形态与仓内 `scripts/qm1-scheduled-publish-verify.cjs` 同源：产物在场 → **内容同一性** → 启动存活 + stderr 三层）。执行前先跑 `verify-worktree-deps.js` OK（11 项解析、9 个 workspace 全指向本 worktree）。

- 打包：`cd apps/desktop && pnpm run build:dir` ⇒ **rc=0**（vite built in 2m 04s；electron-builder 25.1.8 完成 packaging/asar integrity）。产物：`app.asar` 144.9 MB（sha256 `6053527f632a2966…`，mtime 2026-10-15T12:48:25Z）、`Multi-Publish.exe` 228.0 MB。
- 验证 1（清单）：asar 15 003 条目；9/9 必查模块在场（新增 `zhihu-credential.js`/`zhihu-settings.js` + 改造的 `zhihu-favlist.js`/`zhihu-favlist-service.js`/`index.js`/`license-access-control.js`/`aggregation.js` + 两份 preload 产物）。
- 验证 2（**内容同一性**）：8/8 逐文件 sha256 与工作区相等 —— 其中 `zhihu-settings.js` = `a376f98069d2…`（含 `if (!explicit)`），即**首轮被污染的那份已被替换**。
- 验证 2b：`index.bundle.js` 同时含 `zhihuGetConfig`/`zhihuSaveConfig`/`zhihuTestConnection`/`zhihuClearConfig`；`home-shell-preload.bundle.js` 含 `zhihuGetConfig`（证「改了 aggregation.js 也重打包了」）。
- 验证 3（启动 8s）：**进程存活**（单独断言，未提前退出）+ **stderr 完全为空**（长度 0）⇒ 三层判据第 ③ 层通过；stdout 7286 字节。
- `ELECTRON_RUN_AS_NODE`：父环境实测 **=1**（本机宿主为「用 Electron 二进制跑 Node 脚本」而设，会随 shell 继承）。本次 spawn 显式 `delete env.ELECTRON_RUN_AS_NODE` 后再启动，并**单独断言存活** —— 与 2026-10-15 新规（`fix-qm1-electron-run-as-node`：存活是三层判据的隐含前提、必须单独断言；子进程 env 必须剔除该变量；父环境带着它时要出声）同口径。之所以强调：该变量会让任意 Electron 可执行文件以纯 Node 模式静默退出（rc=0、零输出、不建窗口），与「启动干净」完全同形。

### QM-4 取证

结论：**本次改动在像素套件覆盖面上无引入回归**（证据链如下，含一次被证伪的假红）。

- 首轮整轮跑（light，20 视图）：19 通过 / 1 失败 —— `collection` misMatch 1.44%（阈值 1%）。
- **假红证伪（方法学关键）**：该轮 `TEST_URL` 未生效时目标落在 `127.0.0.1:5174`，而该端口**不是本 worktree 的服务** —— 实测监听者命令行为 `D:\Data\projects\mp-worktrees\mp-fix-newtab-home-slow\...\vite.js --port 5174 --strictPort`（**另一个会话正在跑的 dev server**）。即首轮量的是别人的 WIP 代码。
- 归因实验（两步，均对本 worktree 自起服务 `127.0.0.1:5199`）：
  1. `PIXEL_ONLY=collection` ⇒ **PASSED（misMatch 0.000%）** —— 单视图下本次改动零像素差异（新增状态条位于默认折叠的「知乎收藏文章」分组内，折叠态 DOM 不参与布局）；
  2. **去掉本次改动的对照组**：临时把 `BatchCollectPanel.vue` 还原成 HEAD 版本（备份 + sha256 记账，跑完按字节快照还原并校验 `RESTORED_BYTE_EXACT=OK`），整轮跑 ⇒ `collection` **仍然失败且 misMatch 完全相同（1.44%）** ⇒ 该差异与本次改动**无因果关系**，是套件整轮跑时的既有状态依赖（同浏览器上下文跨视图残留），本次不动它、如实登记。
- 设置弹窗的像素覆盖说明：像素套件 20 视图**不含 settings**（`settings-general.png` 基线由 `tests/visual-testing/autonomous-*.js` 产出，不属本次门禁面）。因此「新增知乎 API Tab」的可见面由 **DOM 级锁**覆盖：`SettingsDialog.test.js` 断言 6 个 Tab、`zhihuIdx === feishuIdx + 1`、点击切换、`initialTab` 只在打开那一刻生效。
- 遗留给套件所有人：`collection` 整轮跑 1.44% 的既有差异（本会话已证伪与本次改动无关，未改基线——**不得**用 `UPDATE_BASELINE` 把它烘进基线，那会把一个真实的状态泄漏洗成"正常"）。

### QM-6 评审取证（跨家族双模型，2026-10-16）

后端：`sh scripts/deep-review.sh --check-deps` ⇒ 体检通过（claude 2.1.296 / opencode 1.18.34）。审查对象 = 本 PR 全部改动（只读，禁止改文件）。

**claude 收敛出 5 条**：

| # | 级别 | 位置 | 问题 | 处置 |
|---|------|------|------|------|
| 1 | MAJOR | `services/zhihu-credential.js` `saveConfig`/`clearConfig` | `zhihu_access_secret` 是**设备级无前缀键**，保存任一用户配置后无条件置 null ⇒ 误删仍依赖兼容档的另一个用户/未登录档的凭据 | **已修**：保存改为「**同值才销账**」；清除改为「只有本用户没有自己的加密行时」才销兼容档。4 条新回归锁（同值销账 / 异值不动 / 清除不动他人 / 兼容档用户清除时一并销） |
| 2 | MAJOR | `features/collection/BatchCollectPanel.vue` `loadZhihuConfig` | 非 0 code（-3 许可证/未登录等）被静默吞掉、状态保持默认「未配置」⇒ 把「已配置但无权读」的用户引向重复配置 | **已修**：新增第四态「暂不可读」+ 原样透出原因；新增 2 条行为锁（非 0 返回值 / 同步抛错） |
| 3 | MINOR | `components/ZhihuSettingsTab.vue` `refresh()` | 同一根因：设置页读侧失败同样静默（badge 显示「未配置」且无提示） | **已修**：非 0 走 `describeError` 写入状态行；新增 1 条用例 + `zhihuConfigReadFailed` 文案（zh/en 成对） |
| 4 | MINOR | `services/zhihu-credential.js` `saveConfig` | 重存**同一把**密钥也把 `verifiedAt`/`favlistCount` 归零 ⇒ 用户手滑重存就从「最近验证：<时间>」退回「尚未验证」 | **已修**：同值重存保留验证证据，异值仍重置；2 条回归锁 |
| 5 | MINOR | `saveConfig` + `settings-store.js` | 身份模式切换（未登录 → 登录）后 scoped 读为空，配置「看上去丢了」 | **未修，如实登记**：需要「设备级配置行回退读」的迁移设计（与第 1 条同源的地盘），属独立小改；已列入「遗留」并在 PRD 未闭合项同步 |

**claude 明确核对过的非问题**（原文摘要）：密文不回渲染端；safeStorage 不可用时拒绝保存不降级明文；「已保存但读不出」态可区分；旧版明文写入路径已彻底移除（全仓仅剩测试与注释）；采集与设置共用同一真源、无双真源；写后读回校验能拦住静默丢弃。

**opencode 侧**：在本次给予的时间内**未收敛**到最终发现列表（其模型为 `mimo-v2.6-flash-free`，长时间停在探索阶段，输出是计划/状态而非裁决）。**不记成「通过」**：本 PR 的双模型覆盖实际是「claude 收敛 + opencode 未收敛」，已登记为遗留项。

**修复后的验证**：受影响 4 个 electron 测试文件 **69 绿**（credential 20→24、settings 14→15）；渲染端 4 文件 **45 绿**；ESLint（CI 同口径 `--quiet`）**rc=0**；locale keys 2049 PASS、CJK 无新增；tokens/store/overlay 34 绿。

### 深度审查欠账（`.ccg/reviews`）闭环说明

`.ccg/reviews/17ef3cc5….json` 被判 `mode=dual`，触发词是**散文里的中文术语**（该笔改动只有 2 个测试文件 + 1 篇记录）。**处置两条并行**：① 该记录按门禁说明的误报出口闭环（写明原因 + 置闭环值 + 标注非模型评审）；② **PR 整体**（2253 行 > 200 行阈值）按 §12.6 真跑了跨家族双模型审查，结论见上表 —— 即「被判要评审」这件事**确实发生过**，不是靠改状态混过去。判定器对闭环提交复核为 SINGLE，不会再生 dual 欠账。

### 遗留（不假装已闭合）

1. **未做真机验证**：需要用户用**自己的**知乎账号在真实应用里「保存 → 测试连接 → 跑一次收藏夹采集」。本次证据止于单测/集成 + 打包产物级；「用户的 Secret 能否通过平台鉴权」只能由真实密钥证伪。
2. **未登录档仍是设备级**：身份服务未启用时 `_resolveOwnerSubject()` 回落 legacy 档，「按用户隔离」等价设备级——库内既有口径，本片未改。
3. **旧明文可能长期留存**：只在用户主动保存/清除时销账；从不打开设置页的存量用户，其明文行会留到下一次保存或清除。未做后台自动迁移（有意：迁移要读明文再加密落用户域，涉及身份解析，风险高于收益）。
4. **无密钥轮换/过期提醒**：平台侧失效只能靠「测试连接」或采集失败暴露。
5. **XSS 面未收窄**：渲染端仍可调用 `zhihu:test-connection`（明文不回程，但可触发一次出站）。
6. **`FeishuSettingsTab.vue` 仍有硬编码色值**（`#67c23a`/`#d32f2f`/`#f0f9eb`/`#fff3f3`，暗色模式下观感不佳）。本次未动它（超出本任务范围，且 `collection-tokens.test.js` 的扫描域不含 `components/`），登记为同族改进项。
7. **身份模式切换会让配置「看上去丢了」**（QM-6 评审 MINOR #5，未修）：未登录档把配置写进**设备级无前缀**行，之后登录则 scoped 读为空（且兼容档若已销账便无回退）⇒ 采集链显示未配置。正解是读路径增加「设备级配置行回退读 + 一次性迁移」，与 MAJOR #1 属同一片地盘，留作独立小改（本片不夹带）。
8. **双模型评审的 opencode 侧未收敛**：本次实际拿到的是「claude 收敛 + opencode 未收敛」，不是完整双家族交叉验证；若第 7 条要动读路径，建议同时补一次完整双模型评审。
