---
record: xhs-draft-only-hard-evidence
task: 小红书图文 draftOnly 的成功判据从「页面文本正则」换成硬证据（草稿箱计数增量/保存响应/标题兜底），假成功改真失败
date: 2026-10-15
# 远程同步尚未收口 ⇒ 本行状态是 PENDING，按 scripts/check-gate-record-debt.js 的第二源
# 判据（openspec/records/<slug>.md）必须显式登记原因与回填责任人；回填时整段删除。
sync_reason: 本 PR 尚未合并，无法回填 merge SHA 与合并时间；合并后由本会话开回填 PR，把表格行的 远程同步 改成 PASS + merge SHA，并删除本段三个字段
sync_backfill_owner: xhs-draft-only-hard-evidence 会话（本节作者）
---

## 本次执行记录：小红书草稿硬证据确认链（xhs-draft-only-hard-evidence，2026-10-15）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（Electron 主进程）：worktree `D:\Data\projects\mp-worktrees\mp-xhs-draft-only-hard-evidence`，裸分支 `xhs-draft-only-hard-evidence`，建刀基线 `71e7994e3`＝当时 origin/main |
| 第一性原因（QM-5 ①） | ✅ | **不是「正则写得不够严」，而是「用页面文案当落库证据」这条路本身不成立**。2026-10-15 真机实测：应用报发布成功但草稿箱无新增；日志显示旧正则（`/编辑于\s*\S{1,12}|已保存|保存成功|自动保存/` 匹配 `body.innerText`）3 秒即命中页面静态文案，同一时刻页面控制台连报「获取某个数据失败 / 请求失败」；直接读执行窗口的草稿箱，计数仍是 1（唯一条目是 10-08 人工取证稿），编辑页空白。2026-10-07 的收紧只改了字符形状（去掉恒真的裸「草稿」），没改变本质 |
| 逃逸分析（QM-5 ②） | ✅ | 既有测试**全都只锁「正则的形状」**（`xhs-draft-false-success.test.js` 的 `draftSaved 判定条件不再接受孤立的「草稿」二字` 断言的是源码里出现哪些字符），没有一例断言「草稿箱真的多了东西」——即判据的**有效性**从未被测过。加上真机 E2E 缺失（用户侧才跑得到），缺陷一直活到真机 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 判据换成与 Python 侧 #3469 同构的硬证据链：①草稿箱计数**增量**（主判据）②保存接口**窄路径 + HTTP 200** 的成功响应（次判据）③草稿箱整页重载后的计数增量复核（兜底）。**能单独确认成功的只有 ①②**，③不新增确认权（见下 §CCG 评审）；三者全不可达 ⇒ `success:false` + `errorCode:'PUBLISH_DRAFT_UNCONFIRMED'`。新增 `xhs-draft-only-hard-evidence.test.js`（修订后 8 例：H1 基线未知不报成功/H2 计数未增长不报成功（哪怕列表有同名条目）/H3 增量⇒成功/H4 全不可达 fail-closed/H5 响应 200⇒成功/H6 响应非 200 不得确认/H7 重载增量⇒成功/H8 接线锁），TDD 红灯先行 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①原「锁旧正则形状」的用例改写为「锁新判据已接线」（三个新方法在场 + `innerText` 判据已移除 + `PUBLISH_DRAFT_UNCONFIRMED` 在场）——防止回退回文案判据；②H1/H2 两例专门钉住「基线未知不得拿 0 顶替」「文案说已保存但计数没涨不得报成功」这两个最容易复发的形态；③`draftEvidence` 字段回传哪条通道确认的，真机验证时可直接看判据健康度 |
| 行尾与 diff 对账 | ✅ | 两口径 `numstat` 相等（改写既有测试文件处保持原 CRLF） |
| 接线棘轮 | ✅ | 新增测试文件在 vitest.config.js 既有 include（`electron/tests/**/*.test.{js,ts}`）内，无需改 workflow |
| 债务熔断（逐文件行数） | ✅（修了两次） | ①首版把确认链直接写进 `rpa-view-platforms.js`，CI 报 `TARGET_GREW ... 1739 行已超过点名目标 1484 行（+255）` ⇒ 抽成独立模块；②按第二轮评审加回非小红书分支后又报 `1486 行（+2）`——因门禁量的是 **PR merge ref**（我的分支 + 当时主干，主干 `ffb220925` #3663 也改了该文件），而我本地量的是自己的分支。**最终做法：先 rebase 到最新主干再量**，并把非小红书分支也搬进模块，调用方只剩一行委派 + 一次基线读取 ⇒ 1466 行（余量 18），模块 489 行（上限 500，余量 11）。未去改门禁 target 清单（那是「谁来守门」的配置） |
| 依赖漏洞审计 | ⚠️ 非本刀 | CI 报 `NEW_ADVISORY: pip/PYSEC-2026-4298 (python-jose, 路径 ops-center/backend)` + `RESOLVED_STILL_BASELINED: pip/CVE-2026-85394`。本刀未碰依赖与 ops-center；该工作流上次绿是 2026-10-12。属**新公告**类时间性失败，需人工裁决（升级依赖 or 基线登记 decision+note），不经本 PR 处置 |
| 静态门禁 Gate 11（ESLint） | ✅（已修） | 抽取后的新模块被 ESLint `no-useless-assignment` 报 2 处（`let read = null` 后 try/catch 两条分支都赋值 ⇒ 初值恒不被读）。处置：catch 改为「保持 null」的注释，两条分支不再都赋值；本地 `eslint --quiet` rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触打包配置与视觉面 |
| QM-6 CCG 双模型外部评审 | ✅ | 跨家族深度评审实跑两轮（proposer=opencode / critic=claude）：第一轮 `--sha 8fe885f57` 得 7 条（1 Critical）；第二轮 `--base origin/main`（整分支 diff，因 rebase 重放不跑 hook、按 sha 取不到判定记录）得 5 条、最低分 4→6、无 Critical。**全部 7/7、5/5 已处置**，逐条见下 §CCG 评审与 §第二轮评审。第三份欠账（rebase 重放副本）随同闭合。修订后门禁重跑 `node scripts/ccg-gate.js` = rc 0（0 安全发现） |
| PR 执行记录取证 | ✅（补过一次） | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` 首跑报 **deepReview 欠账 3 条**——三个提交都被判需要双模型深度审查（mode=dual），而记录里的 `deepReview.status` 停在 pending / self_play_pending：**评审跑了、发现修完了，但引擎第三档出口要求的「逐条裁决」表格没填，门禁不认**。处置：按裁决模板逐条填 prosecution/defense/verdict/rationale 并把 status 置为闭环白名单的 `self_play_resolved`（不是改数字，是补真实结论；逐条人读版在 PRD §8/§8.1）。复跑 rc=0 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间；`git ls-remote --heads origin xhs-draft-only-hard-evidence` 返回 0 行证远端分支已删；回填后删除本段三个 sync_* 字段 |

### 判据选址（针对「草稿箱是否分区本地」疑点）

小红书草稿箱页面自述「草稿存储于当前使用的浏览器本地」，一度担心 RPA 独立分区看不到。
实测确认：`DRAFT_BOX_URL`（`xiaohongshu_selectors.py`）与发布页**是同一个 URL**
（`publish/publish?from=menu&target=image`），草稿箱入口就在发布页侧边栏（`.draft-title`）。
⇒ 计数读取与兜底 goto 都落在**同一分区、同一页面**内，不存在跨分区失真；
反过来说，判据**必须**建在同一分区内，换窗口/分区读会因登录态不同而失真。

### 设计取舍

- **不拿 0 顶替基线**：与 Python 侧同口径。「没拿到基线」不是「没增长」的证据。
- **标题匹配不给确认权**：整页 goto 贵；更重要的是标题是**精确匹配**，同名草稿会误命中 ——
  若允许它单独确认成功，「计数没涨（很可能真没保存）」会被历史同名草稿翻案。
  故重载复核的确认权仍归「计数增量」，标题命中只作辅助证据上报（`titleSeen`）。
- **基线在读内容之前取**：平台会在填写阶段自动保存，晚读会把本次草稿吃进基线，
  让主判据恒不增长（评审 i5）。代价是多一次 DOM 读，只在 `draftOnly && xiaohongshu` 路径上发生。
- **端点表宁窄勿宽**：宽词子串能命中页面自身的草稿列表查询/埋点，把无关 200 读成落库证据
  （评审 i1，Critical）。取值直接对齐 Python 侧已真机确认的 `DRAFT_SAVE_RESPONSE_PATTERNS`，
  不自行猜测；宁可这条通道暂时用不上，也不允许它能伪造成功。
- **失败文案不进 i18n**：沿用 `PUBLISH_DRAFT_CONTENT_NOT_FILLED` 的既有做法（主进程直出 `error` 字符串）。多语言会触 i18n-content-sync 门禁，属独立改动，PRD §8 已登记。
- **不动内容填写层判据**：`PUBLISH_DRAFT_CONTENT_NOT_FILLED` 那套（2026-10-07）保留，本 PR 只换「落库确认」这一层。

### 测试读数（当场实跑，不做换算）

- `xhs-draft-only-hard-evidence.test.js`：**5/5**（首跑 4 红 1 绿；实现后全绿）
- `xhs-draft-false-success.test.js`：**9/9**（首跑 4 红：3 例是旧桩缺新方法、1 例是锁旧判据形状——补桩 + 改锁后全绿）
- `douyin-rpa-create-v2-pattern.test.js`：**4/4**（修复隐式耦合后——见下）
- 三者合并跑（首版）：**18/18**
- **CCG 评审后修订版**：`xhs-draft-only-hard-evidence.test.js` 由 5 例扩到 **8 例**
  （新增 ② 200 正例、② 非 200 反例、③ 重载增量正例），三者合并跑 **21/21**。
  修订后用例改为**驱动真实方法**（虚拟时钟 + 桩 `executeJavaScript`），不再把
  `_waitForDraftBoxIncrement` / 兜底复核的实现抄进桩（见下 §CCG 评审 i6）。

### CCG 跨家族深度评审与处置（2026-10-15）

驱动：`node <adversarial-review-loop>/scripts/ccg-deep-review.js --sha 8fe885f57`；
跨家族校准 **proposer=opencode / critic=claude**，引擎第 2 档出口 `self_play`
（minScore=4，置信权重 0.6），产出 7 条发现、4 个维度（correctness 4 / security 9 /
performance 7 / maintainability 5）。**逐条处置如下，全部已修**：

| # | 级别 | 发现（要点） | 处置 |
|---|------|--------------|------|
| i1 | **Critical** | 通道②端点表 `['draft','save']` 是宽子串：主判据超时后，页面任一带 draft/save 字样的 200 响应（草稿列表查询、埋点）即判 save-response 成功 —— **假成功与原缺陷同形** | 端点表换成**窄路径** `['/web_api/sns/v2/note']`（有据：Python 侧 `xiaohongshu_selectors.py` 的 `DRAFT_SAVE_RESPONSE_PATTERNS`，真机确认过是同一个保存端点）；并补 `statusCode === 200` 校验 |
| i1b | **Critical（我方核出的同源第二处）** | 评审未点明：`_waitForResponse` 的超时兜底分支（`rpa-view-helpers.js` 的 `fallbackTimer`）会把**非 200** 的命中也 resolve 出来，而原实现用 `Boolean(resp)` 判定 ⇒ 一次 500/302 会被读成落库证据 | 同上：只有 `resp.statusCode === 200` 才算确认；非 200 只记 warning（与 Python 侧「捕获到响应但非成功码」同形） |
| i2 | Warning | ②的监听在计数 20s 超时**之后**才挂，而 `_waitForResponseExclusive` 只监听注册之后完成的响应、**不回放历史** ⇒ 必然错过真正的保存响应 | 监听**前移到点击之前**（与 Python 侧「先 `watch_patterns` 再点」一致）；窗口 30s 覆盖①的等待 |
| i3 | Warning | 兜底回查硬编码发布页 URL，绕开 `config.publish_url` 单一真源；且 `loadURL` 只等「导航开始」 | 回查 URL 改由调用方传 `config.publish_url`；导航改用既有 `_navigateAndWait`（等 `did-finish-load` + 稳定） |
| i4 | Warning | 标题兜底可**单独**确认成功，PRD 自认「同名草稿会误命中」⇒ 历史同名草稿可把「计数没涨」翻案成成功 | **取消标题匹配的确认权**：重载后仍以「计数增量」确认，标题命中只作辅助证据（`titleSeen`）上报；失败文案在 `titleSeen=true` 时明说「见到了同名条目但不据此判成功」 |
| i5 | Warning | 基线在**内容填写之后**读；平台在填写阶段已自动保存 ⇒ 基线含住本次草稿、此后无增量 ⇒ 主判据常态失效 | 基线**前移到写入任何内容之前**（与 Python 侧「导航后、上传前读」一致）。**并发现一处我方自引入的真缺陷**：存草稿钮被点了**两次**（基线之前一次、之后又一次）——已删成一记 |
| i6 | Warning | 测试桩是生产逻辑的拷贝（生产改桩不改则照绿）；②③无正例；`draftEvidence` 值零断言 | 重写测试：**不再抄生产逻辑**，改为绑定并驱动真实方法（虚拟时钟让轮询立即走完）；补 ②/③ 正例；断言 `draftEvidence` 取值 |
| i7 | Info | 接线锁锚 `/(baseline\|计数基线\|草稿箱计数)/` 会命中**注释词面**，切片按「标记 + 固定 4000 字符」⇒ 注释一改即误红/漏检（锁的是注释不是代码） | 改为：①按**分支边界**切片（`if (config.draftOnly) {` → `if (sel.publish_btn`）；②断言**只看代码行**（先剔除 `//` 开头的行）；③断言具体调用文本与 `statusCode === 200` 等真实形态 |

**评审给本刀带来的实质改变**：能**单独确认成功**的通道从「三条」收敛为「两条」（①计数增量、
②窄路径+200 的保存响应），③降为①的重载复核。这是**主动放弃一个确认源**换取「不与原缺陷同形」——
标题匹配与宽词端点表都能各自伪造出成功，而本刀的验收标准恰恰是「假成功必须报失败」。
与 Python 侧的一处**有意分歧**：Python 的 `recheck_draft_box` 允许标题命中单独返回 True，
本轨按评审 i4 收紧（同名旧草稿在真机场景里并不罕见，而草稿箱计数选择器是单点取证，
两者风险不对称：误报成功会静默丢数据，误报失败用户可重试）。

### 第二轮评审（抽取后按整分支 diff 重跑）与处置

rebase 重放不跑 hook ⇒ 按 sha 查不到判定记录，改用 `--base origin/main`（整分支 841 行）。
读数：发现 **7 → 5 条**、最低分 **4 → 6**、**无 Critical**。八条（含 Info）逐条处置见
PRD §8.1；**修掉五条**、登记三条。其中两条是实质性的：

- **i2（行为回归，本刀引入）**：`runDraftOnly` 没有平台守卫，而调用方只在
  `platform === 'xiaohongshu'` 时读基线 ⇒ **任何其它配了 `draftOnly` 的平台**都会被塞进
  小红书专用链（基线恒 null ⇒ 主判据永久失效 ⇒ 恒失败）。**这不是理论风险**：头条在带
  `publishTime` 时会走 `draftOnly` 的 DOM 轨（`packages/rpa-engine/src/toutiao-direct-bridge.js`
  与 `toutiao-schedule-intent.test.js` 都写明「只存草稿、绝不点发布」）。
  处置：调用方按平台分流，非小红书平台**保留既有行为**（内容闸 + 原页面文本判据），
  接线锁只锁小红书子分支；新增 **H9/H9b** 行为锁（含「内容没写进去仍按内容闸 fail-closed」）。
  它们的判据改造（同样的假成功面）登记为下一刀。
- **i3（与真机缺陷同形）**：基线只对 `null` fail-closed，**低估不设防**——侧边栏异步渲染期
  若读到 `草稿箱(0)`，一条**旧**草稿把计数抬到 1 就会被判成增量 ⇒ 假成功。
  处置：基线**读两次取较大值**（等价于要求更保守的起点），两次不一致时写日志；新增 **H11**。

其余三条：i4（对**真实 helper** 锁返回形状，新增 H10）、i7（采信标题命中前先要求计数节点可读，
新增 H12）、i6（接线锁改锚调用形态与真实代码结构，不再锚日志文案）。
登记不修的三条：i1（②端点需真机抓包核验）、i5（①串行 20s + ③重载时机的耗时取舍，现选
「宁可慢也不误报失败」）、i8（②监听窗口上限 30s 自行清理，成本有界）——均在 PRD §9。

**本轮测试读数**：三套相关测试 **26/26**（新增 H9/H9b/H10/H11/H12 五例）。

### CI 抖动两项（本 PR 无关，已如实取证）

`gh run rerun --failed` 重跑后 **22 项全绿**。此前两项红的取证：

- **QG Coverage → Gate 5**：整个套件带覆盖率跑，失败集中在
  `electron/services/windows-file-lock.test.js` 的 3 例「真跑（仅 Windows）」文件锁握手
  预算断言；**同一个提交**在 `QG Desktop Shards (1/2)` 里通过。且主干今天的失败 run
  （#3619 合入后）失败形态完全相同（QG Coverage → Gate 5 → Gate Result 连坐），
  主干近 30 次 quality-gate 有 5 次失败 ⇒ 仓库级既有抖动，非本刀引入。
- **QG Visual → Gate 7**：日志末尾自报 `[GATE-7] All visual tests passed`、
  `[RESULT] All pixel diff tests passed, no Agent review needed`，步骤却退出 1
  （某个子命令 `exit code 1`）。本 PR 只动 `electron/services` + 测试 + 文档，
  **不触任何界面/样式/视觉基线** ⇒ 归因不可能落在本刀。

结论：两项均为环境抖动，重跑转绿；本刀未以任何方式放宽或绕过这两项门禁。



### 前置修复（本刀内，行为等价）

CCG `verify-security` 的 XSS 判据（「点号 + innerHTML + 等号」模式）**对整个被改动文件生效、无就地豁免机制**。本刀改了 `rpa-view-platforms.js`，于是该文件里**抖音 desc 填写**的一段既有代码（2026-07-16 的安全修复，本已做净化：移除 script/iframe/object/embed 与 on* 属性）被扫出 1 条高危，拦住提交（`RC=1`，提示 `修复后重试；确认可放行时用 SKIP_CCG_GATE=1 git commit（不推荐）`）。

处置：解析改用本文件已有用法的 `DOMParser`、落地改用 `replaceChildren`，不再出现该属性赋值写法；净化步骤与结果 DOM 完全不变。**未使用 SKIP_CCG_GATE 绕过**。

证据：改后扫描**通过（0 发现）**；抖音 + 小红书三套测试 **18/18** 全绿。
坑记：**注释里也不能复述该写法**——正则连注释一起匹配（本刀第二次踩同型坑，第一次是抖音端点数组锁）。

### CI 债务熔断检查：本刀首版触红并已修复（如实登记）

首版把确认链直接写在 `rpa-view-platforms.js` 里，CI 的逐文件行数门禁（点名还账文件、
**零增长容差**）当场变红：

```
❌ TARGET_GREW: apps/desktop/electron/services/rpa-view-platforms.js 共 1739 行
   已超过点名目标 1484 行（+255）
```

处置：把 draftOnly 的**全部判定**（内容写入闸 + 硬证据确认链：基线读取 / 读数 / 等增量 /
重载复核 / 三通道裁定 / 失败文案 + **平台分流**）整体搬进新模块
`apps/desktop/electron/services/draft-only-confirm.js`，调用方只留一行委派 + 一次基线读取。
本文件 **1739 → 1466 行**，模块 489 行（上限 500），门禁转绿
（`node .github/scripts/check-max-lines.js` rc=0）。同源先例：`wechat-mp-draft-mediaid.js`
就是为同一原因从该文件抽出来的。

**这一项红了两次，第二次的因值得单独记**（本刀最贵的教训之一）：第一次抽完到 1467 行、
CI 转绿；随后按第二轮评审加回非小红书分支（+18 行），CI **又**报 `1486 行（+2）`。
差别在**门禁量的是哪个版本**——Actions 检出的是 **PR merge ref**（我的分支 + 当时主干），
而我本地量的是**自己的分支**；两者差 3 行，恰好来自主干在开工后合入的 `ffb220925`（#3663）
也改了同一个文件。所以那一刻**本地 rc=0 与 CI 红都没错，量的不是同一样东西**。
**做法修正**：本地复现「点名还账 / 挂账」这类门禁前，先 `git rebase origin/main`
（或对 merge 结果量），否则本地绿灯对 CI 不具证据力；并把余量留出来（现 18 行 / 11 行），
因为该文件主干也在改，压线等于把下一次主干改动变成本 PR 的红。

**没有**采取的两条路，以及为什么：① 不去改门禁的 target 清单——那是「谁来守门」的配置，
属必须人工过目，且为本 PR 放宽自己文件的额度正是挂账机制要防的事；
② 不去删既有注释凑行数——那会动到与本刀无关的内容。

### 并行会话 stash 误弹事故（如实登记）

定位抖音锁劫持时，我用 `git stash push -m control-check -- <2 路径>` 做控制对照（stash 我的实现 → 跑对照 → pop 回来）。**在这两步之间，另一个会话（分支 `fix-newtab-home-slow`）也执行了 `git stash push`**，把它的条目挤到 `stash@{0}`、我的条目落到 `stash@{1}`。我的 `git stash pop` 因此**弹出了别人的 stash**：把 `apps/desktop/src/plugins/element-plus.js`（该文件在本分支 HEAD 里不存在）带进我的 worktree 并留下未合并索引条目（`DU`），同时我自己的两个文件改动被换走。

处置（全程只读优先、不 drop 他人 stash）：
1. 只读取证：确认 HEAD/分支未污染、`stash@{0}`（他人）与 `stash@{1}`（我的）各自内容清单；
2. `git rm --cached -f -- <该路径>` 解除未合并索引条目（只动索引）；
3. `git checkout stash@{1} -- <我改的两个文件>` 从**我自己的** stash 恢复改动（不 drop）；
4. 磁盘上那个外来文件按 `rm --` 走回收站路由删除；
5. 终验：工作区只剩我的 5 个文件 + 一个 hook 产物；**他人 `stash@{0}` 完好未动**；恢复后三套测试 **18/18** 仍全绿。

教训（与 AGENTS.md「禁止并行 stash/checkout」同源，且这次是**实测发生**而非理论风险）：**多会话共享仓库里，`git stash` 的位置索引（`stash@{0}`）不是私有槽位**；任何依赖「push 后立刻 pop」的写法都会被并发会话插队。本刀此后的控制对照不再使用 stash（改用 `git show <sha>:<path>` 取值 / 复制到临时路径比对）。

### 调试过程自曝的三个问题（当场修）

1. **测试桩与既有约定不一致**：我的 `_resolveSelector` 按 sel 判断返回，而既有测试约定是「无条件返回同一选择器」；导致 H3 在内容填写阶段就 ABORT，报的是 `PUBLISH_DRAFT_CONTENT_NOT_FILLED` 而非判据问题。对齐约定后解决。
2. **断言误伤注释**：新判据的源码锁用 `/已保存\|保存成功/` 查「旧判据是否已移除」，但块内**注释**解释旧判据时会提到这些词 ⇒ 假红。改为匹配「把它当判据用」的代码形态（`innerText` / `_waitForCondition(`）。
3. **劫持了抖音的端点锁（最费时的一处）**：`douyin-rpa-create-v2-pattern.test.js` 用正则抽取**源码中第一处**等待调用的端点数组；我新增的小红书等待调用排在抖音之前 ⇒ 该锁抓到我的数组而变红。**第一轮**只把端点提为命名常量仍红——因为**注释里复述了该调用的字面形状**，正则连注释一起匹配；**第二轮**改写注释（不复述形状）后转绿。处置：命名常量 + 注释只述意图不复述形状 + 常量注释里写明此坑。控制对照（stash 我的实现后跑该文件 4/4 通过）是先确认「这是我这刀引入的」而非既有失败集。

### 遗留（不假装已闭合）

- `DRAFT_BOX_ITEM_SELECTOR`（标题兜底依赖的通配选择器）与 `DRAFT_BOX_COUNTER_SELECTOR`（`.draft-title`）都只有单点取证；平台改显示形态会失明。本轮已把「节点在但解析不出」变成可查现场（info 日志点名 sel 与文本条数），但判据本身需活体取证——不编造结论，只登记排期（与 Python 侧 #3469 登记的同一问题）。
- 真机验证待办：合并后应用内发一条小红书图文草稿，确认草稿箱计数 +1、结果为成功且 `draftEvidence=counter-increment`；再构造「主站不授会话/断网」场景确认报「未确认」失败而非假成功。
