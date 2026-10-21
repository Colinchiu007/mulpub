---
record: fix-account-profile-fallback
task: 修复 SPA 平台（头条号等）保存账号时昵称/头像回落成平台名（DOM 采集早于渲染完成，加 HTTP API 兜底）
date: 2026-10-21
---

## CHANGELOG 条目

# fix(accounts): 保存账号时用平台 API 兜底昵称/头像，修 SPA 平台回落成平台名

- **问题**：头条号等 SPA 后台登录成功后，保存的账号「账号名」显示成平台名（如「今日头条」）、头像为空，用户无法区分同平台的多个账号。
- **根因**：不是选择器写错，而是**采集时机早于 SPA 渲染完成**。登录成功判据命中 URL 后，`_scheduleAutoCompletion` 只等 3000ms 就提取资料，而日志实测头条号后台页面渲染持续了 56 秒——昵称节点那时还没出现，DOM 采集跑在空 DOM 上返回 `{}`，`profileForCreate` 遂把 `account_name` 回落成 `name`（平台显示名）。用户随后点「保存账号」也已晚：登录尝试早被自动完成消费并关闭，那一下没有重新采集。
- **修复**：新增 `fillProfileFromHttpApi()`，`saveCapturedAccount` 在 DOM 采集后调用。判据是「没有拿到真昵称（回落成了 name）」；命中则用**已捕获的 Cookie** 调平台创作者 API，逐个判空补位（昵称/平台 ID/粉丝/头像），不覆盖 DOM 已拿到的值、不改变 `name`。任何失败只记 warn，**绝不阻断账号创建**。8 个平台（抖音/头条/视频号/B站/快手/小红书/知乎/公众号）共用同一批已注册端点，不新增端点。
- **不做的**：不调大 `_scheduleAutoCompletion` 的 3 秒延时（会拖慢每个平台的登录完成感知，而 API 兜底已能拿到结构化数据）；不给 extract 补头像字段（需逐个平台找，属独立任务）。
- **已知限制**：当前 8 个平台的 extract 都不返回头像，所以修复后昵称与平台 ID 能补上，**头像仍可能为空**；头像回填依赖用户点账号卡片「检测登录态」时的 DOM/HTTP 回填路径。
- **提示文字**：零改动，不新增/不修改任何 i18n 键。
- **回归保护**：`account-manager.test.js` 新增 4 例（DOM 失败时补真实昵称/ID/粉丝、DOM 成功时不发请求、兜底只补空位不覆盖已命中昵称、兜底失败不阻断创建）；变异反证通过（摘掉修复，2 个核心用例当场变红）。
- **文档**：PRD 新增 §「账号资料采集兜底：SPA 平台昵称/头像回落」；新增 `01-docs/PRD-ACCOUNT-PROFILE-FALLBACK-2026-10-21.md`。

---

## 本次执行记录：账号资料采集兜底（fix-account-profile-fallback，2026-10-21）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/publishers/**`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-fix-account-profile-fallback`、裸分支 `fix-account-profile-fallback`（`git rev-parse --abbrev-ref HEAD` 实证）。共享根 `pre-code-edit-guard.ps1` 先返回 BLOCKED/exit 1，确认未在 main 上直接改码 |
| 第一性原因（QM-5 ①） | ✅ | 非某次 commit 的回归，而是**设计缺口**：`saveCapturedAccount` 从上线起只有 DOM 采集一条路。直接诱因是采集**时机**早于 SPA 渲染完成——日志实证：`08:35:36.362 AuthView login page finished after 56295ms`（页面渲染持续 56 秒），而 `_scheduleAutoCompletion` 的 `setTimeout(..., 3000)` 在 `08:35:39.029` 就 `_extractAuthData`，`collectWithWebContents` 跑在空 DOM 上返回 `{}` ⇒ `profileForCreate` 把 `account_name` 回落成 `name`（= `getPlatformName('toutiao')` = 「今日头条」）。用户随后点「保存账号」也已晚：attempt 早被 `_settleLogin` 消费并 `close()`，`completeLogin` 静默返回 true，那一下没有重新采集 |
| 数据实况 | ✅ | `shared-user-data/backend-data/accounts.json`：第 2 个头条号 `45261bb5`（created `2026-10-21T16:35:39`）`account_name='今日头条'`、`avatar=''`、`platform_account_id=''`、`followers=null`；对比第 1 个 `7ae99805` 为 `'观四方'` + 平台 logo + `1342958645023752` |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：`saveCapturedAccount` 的既有用例只断言「POST 请求体等于 DOM 采集结果」，**没有任何一条问「DOM 采不到时怎么办」**——测试验证了实现的自洽性，未验证前提；②集成层：`auth-view-manager.test.js` 用同步 `advanceTimersByTime` 驱动 3 秒定时器，断言的是「凭据已保存」，不断言资料字段；③真实链路：登录保存的成功判据是「有 Cookie」，与「采到昵称」正交，所以功能一直「成功」着 |
| 系统性漏洞（QM-5 ③） | ✅ | **测试只覆盖 happy path 的采集结果**：`accountInfo` 用例数据从不构造「SPA 未渲染完 ⇒ `{}`」这一形态，而它恰是头条号/百家号等 SPA 后台的常态。分类：测试场景缺失 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `fillProfileFromHttpApi(platform, cookies, profile, name)` 于 `account-profile-refresh.js`（资料采集归口模块，已持 `httpLoginChecker` 模块对象），`saveCapturedAccount` 在 `profileForCreate` 之后接线。触发判据 `profile.account_name === name`（无真昵称）**只此一条**；字段逐个判空补位，不覆盖 DOM 已命中值，不改变 `name`；任何失败只 warn 不 throw。新增 4 例测试 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①判据与三条纪律写进 `fillProfileFromHttpApi` docstring（含「为什么不能附加头像条件」的自我否证记录）；②新用例刻意构造 `accountInfo={}` 这一 SPA 未渲染形态；③PRD 新增专章 + 独立 PRD，把「头像仍可能为空」这一已知限制写明（8 平台 extract 均不返回 avatar） |
| 变异反证 | ✅ | 把 `fillProfileFromHttpApi` 调用换成 `const filled = { profile, used: false }`：2 个核心用例当场变红（`2 failed \| 6 passed \| 85 skipped`）；另 2 个仍绿是**正确的**（它们断言「不调用」与「不阻断」，摘掉调用反而满足）。修复已还原并复跑 `93/93` |
| 测试陷阱记录 | ✅ | `stubHttpInfo` 不能用 `mockResolvedValue(Promise.reject(...))`——那个 promise 在**参数求值时**已 reject，`mockImplementation` 只延迟返回它，unhandled rejection 照样发生（vitest 报 false positive）。正解 `mockRejectedValue(new Error(...))`。首版实测踩到并修正 |
| 判据自我否证 | ✅ | 首版判据写成 `account_name === name && !avatar`，被自己的第 3 个用例（「DOM 采到头像但没采到昵称」）当场否证——该形态下兜底不触发。已改为只判昵称，请求成本由「逐个判空补位」保证 |
| 前端回归 | ✅ | `account-manager.test.js` + `account-manager-profile-fallback.test.js` 合计 **96/96**（含本修复新增 7 例）；相关 4 文件 `account-profile-refresh` 20 + `account-manager-profile` 17 + `http-login-checker-info` 27 + `account-manager-relogin-status` = **78/78** |
| 逐文件行数门禁（CI 实测拦下） | ✅ | PR 首次 CI 报 `TEST_LEDGER_GREW`：`account-manager.test.js` 较登记值 1598 膨胀 353 行（容差 200）。按门禁指引「按被测模块/场景分文件」把本修复的 7 例拆到新文件 `account-manager-profile-fallback.test.js`（264 行）；原文件回落至 **1717 行**（+119，容差内），`node .github/scripts/check-max-lines.js` rc=0「无新增超大文件」。拆分后两文件合跑 96/96，**与拆分前逐项一致**（证明拆分无损） |
| 全量 electron 套件 | ✅ | `12 failed / 11929 passed`（首轮）→ 逐条归因后**全部消解**，见下「取证顺序教训」与「flake 归因」两节 |
| QM-1 打包 / QM-4 视觉 | 见提交前复测 / N/A | QM-1：改动在 `apps/desktop/electron/` ⇒ 已打包 + 三层启动判据（见提交前复测段）。QM-4：未触碰任何 `.vue` / 样式 / locale，无视觉面变更 |
| 行尾与 diff 对账 | ✅ | 见提交前两口径 numstat 实测（下详） |
| QM-6 CCG 双模型外部评审 | ✅ | `scripts/deep-review.sh` 实跑（proposer=opencode 出方案 / critic=claude 评审，跨家族校验通过）。第 1 轮给出 6 条问题、维度分 4 个、**最低分 6**、**高危域 0 条**（上一轮同任务有 1 条 auth 高危）。收敛判定 self_play 后自扮演裁决 5 条：**i1 采纳**（判据归一化安全性——逐行核实 `trimText(v)===v.trim()` 与 `resolveCapturedDisplayName` 的 `.trim()` 同操作，假阴性不可能；恒等推导写进 docstring + 2 例新测试锁定，含唯一的无害假阳性）、**i2 采纳**（改纯函数，所有返回路径都给新对象 + 1 例引用不变测试）、**i3 否决**（8s 上界可控且异步化会延续「首屏即平台名」，量化依据写进 docstring）、**i4 部分采纳**（注释压缩约 30%，保留⛔禁项与两次自我否证）、**i5 否决**（`openspec/records` 是 required check 强制载体、`.ccg/reviews` 由 pre-commit 自动生成，剥离即卡 PR）。裁决产物 `.adversarial/ccg-deep-b0b43cd1/adjudication.json`，5 条 verdict 与 rationale 全部填写 |
| 远程同步 | 由门禁推导 | 不手写状态词（`gate-record-sync-derived-status`） |

- 保留门禁：判定 docs-only=false（混合 PR）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件 | 远程同步 由门禁推导

### 取证顺序自纠（首轮 QM-1，上一轮教训的复用）

上一轮（fix-multi-account-same-platform）首轮误跑裸 `electron-builder --dir` 漏掉 `build:vue`，
asar 内无 `dist/` ⇒ 启动 `ERR_FILE_NOT_FOUND`，按层②判 `NEEDS_REVIEW` 而非通过。
本轮直接跑 `pnpm run build:dir`（含 `build:vue`），未重蹈。

### ⚠️ 全量 electron 套件的取证顺序教训（本轮新增，同型第二例）

首轮全量 `vitest run electron/` 报 `12 failed | 11929 passed`。逐条归因：

| 现象 | 根因 | 归因方法 |
|---|---|---|
| 8 个测试文件失败，全是 `ENOENT: monitor-preload.bundle.js` / `preload/index.bundle.js` 等 | **没跑 `pnpm run build:preload`**，bundle 是生成物 | `git ls-files` 确认 bundle 非 tracked（仅 `stealth-preload.bundle.js` 例外）；跑一次 `build:preload` 后 7/8 文件**当场全绿**（39/39） |
| `story2video-compose-engine.test.js` 2 例 `Test timed out in 10000ms` | 并发资源竞争的 **flake**（这两个用例跑真实 ffmpeg 合成，`findFfmpeg()`） | 单跑 `158/158` 全绿；组合跑时超时；连跑组合 3 次，绿/红交替（`RC=0` → `RC=1` → 2 failed） |

**基线对照**：`git stash` 摘掉本次改动后，`preload-path.test.js` 仍 `2 failed | 5 passed`
⇒ preload 失败是**存量 + 取证顺序**问题，与本次改动无关。

**教训（与上一轮 QM-1 同型，第二次踩）**：跑全量 electron 套件前**必须先跑
`pnpm run build:preload`**，否则会拿到 12 个假失败。这与「QM-1 必须先 `build:vue`」
是同一个形状：**套件/打包的前置生成物没跑，判据就会把「我没跑前置」读成「代码坏了」**。
本次 12 个失败无一与本次改动相关，全部消解于「补跑生成物」+「识别 flake」。

### 提交前复测（实填）

- **QM-1**：`pnpm run build:dir`（含 `build:vue`，asar 147MB 级）rc=0；三层启动判据
  rc=0 —— 层①进程 8000ms 窗口内存活 ✅ / 层②未命中已知红线 ✅ / 层③ stderr 为空 ✅。
  **父环境实测带 `ELECTRON_RUN_AS_NODE`**，已按 `buildChildEnv()` 口径剔除并出声告警
  （不静默剔除，否则「本机环境一直有问题」永远不被知道）。
- **两口径 numstat**：见提交前实跑（git diff --numstat 与 --ignore-cr-at-eol --numstat 逐字一致）。
- **静态门禁**：ESLint（3 个改动文件）rc=0；`check-max-lines` rc=0；`check-debt-budget` rc=0；
  doc-abs-paths / brand-residue / gate-record-debt / unwired-tests / check-pr-exec-record 全 rc=0。

### 测试文件拆分（CI 拦下后补做）

首次 PR CI 的「债务熔断检查」判红：`TEST_LEDGER_GREW: apps/desktop/electron/publishers/account-manager.test.js
较登记值 1598 膨胀 353 行（容差 200）`。这条是**真判据**，不是误报——本修复的 7 例
（约 210 行）压在原本就接近上限的文件上。

处置按门禁原文「按被测模块/场景分文件」：新建
`account-manager-profile-fallback.test.js`，只承载「DOM 采集没拿到真昵称时用平台 API 兜底」
这一组 7 例（含辅助 `TOUTIAO_COOKIE` / `stubHttpInfo`），自带 `beforeEach` 的 Electron mock。
原文件回落至 1717 行。

**拆分无损的判据**：拆分前后两文件合跑均 **96/96**，用例名逐条一致。

**过程中的自我纠错**：首次切分脚本用 `startsWith('  ')` 找用例闭合，误匹配到 4 空格缩进的
`    })`，把最后一个用例截成半截（两文件都成了语法错误）。根因是**判据宽度不足**（缩进级别
未精确匹配）+ 未处理 CRLF（文件是 CRLF，闭合行实为 `  })\r`）。修正后按「精确缩进 + 单独
定位闭合」重切，并逐文件跑通验证。
