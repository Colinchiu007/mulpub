---
record: ux-audit-aggregate-progress
task: UX 审计 2.5（audit-14）—— 发布聚合进度条按「终态占比」算导致单任务全程 0%；改为运行中任务贡献软权重，汇总行补「第 N / 共 M 项」
date: 2026-10-21
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src）+ 设计文档/CHANGELOG，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：聚合进度软权重（ux-audit-aggregate-progress，2026-10-21）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-aggregate-progress`（非 C 盘），分支同名；由 `scripts/start-mp-task.ps1 -TaskName ux-audit-aggregate-progress` 创建，判据取产物而非 rc：`git worktree list` 出现该路径 + `rev-parse --abbrev-ref HEAD` = `ux-audit-aggregate-progress` + `rev-parse --show-toplevel` 可进入。依赖就绪三步全部 RC=0（`pnpm install --frozen-lockfile` / `ensure-electron` / `verify-worktree-deps`，末者打印「消费方解析通过 11 项」） |
| 质量节拍 pre-flight | ✅ | 编辑前确认非共享根 `main`；共享根全程未写入 |
| 自测（消费者并集） | ✅ | 判据取「消费者并集」不是「我改过的文件」：对 `publishProgress` / `PublishProgressPanel` 两个 stem 逐个 `git grep -l` 反查测试消费者 ⇒ 12 个测试文件全跑 = **290 passed / 0 failed**。本批三套 = 92 条（纯逻辑 17 / store 39 / 面板 36），其中新增 22 条 |
| 反证（6 道） | ✅ | `node <临时脚本目录>/mw-25-mutate.cjs` → `COUNTERPROOF=ALL_CAUGHT`，控制跑 `rc=0 collected=92 red=0`；六条**红集互不相同**（4/6/1/2/1/2），每条 `还原字节一致=OK`。明细见「三、六道变异」 |
| 静态门禁 | ✅ | `check-locale-sync.js --cjk` → PASS（基线 1330 / 现场 1124）；`check-max-lines.js` → 无新增超大文件且 `publishProgress.js` **净减 8 行**（聚合逻辑外置）；`check-no-brand-residue` → PASS；`check-doc-abs-paths` → PASS（本记录一律 `<仓库父目录>` / `<临时脚本目录>` 占位）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐字相等（文档 62/0、9/0） |
| QM-1 打包 | N/A | 只改 `apps/desktop/src/**`（渲染端），未触碰 `electron/**`、`packages/rpa-engine/**` ⇒ 打包判据不触发 |
| QM-4 视觉回归 | 未跑（如实登记） | 本批改了汇总行**文案**（新增「第 N / 共 M 项」）——这是唯一可能被像素门禁看见的变化，但错误态需要注入真实发布事件才有内容，像素门禁对进度面板的瞬时态结构性失明；且基线只能取 CI 渲染。判定交由 `QG Visual` 在 CI 执行 |
| QM-6 双模型 | 未跑成（见第五节，不伪造） | `ccg-review-decider.js` 读数与两条通道实测病因写在第五节 |
| 第一性原因（QM-5 ①） | ✅ | 不是「面板少渲染了一个数」，而是**聚合进度的语义被定义成"终态占比"**：`aggregate.done` 只在 `success/failed/cancelled` 累加，面板直接 `done/total`。于是「一个任务、跑了 3 分钟、已经传到 90%」与「一个任务、还没开始」在界面上是同一个 0% —— 二者对用户是完全不同的行动指引（等 / 判卡） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：`publishProgress.test.js` 39 条里对 aggregate 的 6 处断言**全部只覆盖全终态场景**（`done: 2/2`、`total: 1`），"运行中"这一档在测试域里根本不存在 ⇒ 旧实现永远绿。集成层：面板测试同样只给全终态/半终态聚合，`percent` 从未被断言。视觉层：进度面板是瞬时态，基线截图里它不出现。审查层：audit-14 靠人工读码发现。**四类逃逸原因同时命中：无测试（该场景）/ 夹具不覆盖该档 / 断言不精确 / 审查盲区** |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单一实现 `apps/desktop/src/stores/publishProgressWeight.js`（零依赖纯函数，与 `publishProgressSessionMerge.js` 同例外置，可脱离 pinia 单测）；store `aggregate = computed(() => summarize(摊平任务))`；面板只读 `aggregate.percent`。回归保护三处：`publishProgressWeight.test.js`（17 条）+ store 接线行为锁（1 条，真实事件驱动真实 store）+ 面板 4 条（条宽/aria 同源、序号段出现与消失两档、en 档、缺字段退化） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 阶段权重表由**单调不减**断言钉住（倒挂 ⇒ 进度条倒退，比"不动"更难解释）；② 「未知 stageKey ⇒ 中位 0.3」把"新增阶段就退化"这条最常见的回归路径变成不可复现；③ 结构锁双向：正向断言面板读 `aggregate.percent`、反向断言模板内不出现 `done / total`（只有反向锁会把"顺手改回旧口径"当违规）；④ **`aria-valuenow` 与条宽必须取同一个 computed**（读屏播报与视觉不得各算一份）；⑤ 10 处 aggregate 夹具补全四个新字段并留注释说明「缺字段 ⇒ 静默 0%」这种假绿的成因 |

## 一、用户可见口径（行为表）

| 场景 | 改前 | 改后 |
|---|---|---|
| 发 1 篇，正在上传（percent 30） | 条子 0%，汇总「成功 0/1」 | 条子 **30%**，汇总「成功 0/1 · 第 1 / 共 1 项」 |
| 发 3 篇，第 1 篇已成功，第 2 篇 percent 40，第 3 篇排队 | 33%（终态占比） | **47%**（(1 + 0.4 + 0) / 3），汇总「第 2 / 共 3 项」 |
| 全部终态 | 100% | 100%，且「第 N / 共 M」**不出现**（那时成功数已够说明问题） |
| 唯一在跑的任务自己报 percent=100 但还没收到终态 | 0% | 98%，**不到 100%**（条满而事未成 会让人以为已经发完） |
| 读屏播报 | `aria-valuenow` 与条宽各算一份的风险 | 两者取同一个 computed，恒相等 |

文案（zh/en 成对新增 `publishPage.publishProgressPanel.summaryPosition`）：`· 第 {index} / 共 {total} 项` / `· item {index} of {total}`。既有键一字未改（含 `pillRunning`/`summarySucceeded` 的 `{done}/{total}` 口径——它们仍按**终态**计数，这是刻意的，见下）。

## 二、三条不变量与为什么

1. **终态计数口径不得被软权重污染。** `done/succeeded/failed/cancelled` 与新增的 `weighted/percent` 分家。汇总行的「成功 N/M」是用户核对结果的依据，换成小数等于毁掉面板上唯一的确定性读数。有专项锁（5 个任务混合态断言 `done:3 succeeded:1 failed:1 cancelled:1 running:2 weighted:3.5 percent:70`）。
2. **还有非终态任务 ⇒ percent 严格 <100，封顶 99；单任务运行中权重封顶 0.95。** 四舍五入自己够到 100 的那一档（99 终态 + 1×0.95 ⇒ 99.95 → 100）必须被夹回，这条有专门用例，不靠"通常算不到"。
3. **单一实现。** 纯逻辑只在 `publishProgressWeight.js`；store 只负责按会话顺序摊平（顺序就是「第 N」的 N 的来源）；面板只读一个数。AGENTS 的「渲染层禁止维护第二份阶段映射」在这里的具体化。

阶段权重表取值口径 = **「用户此刻离结果还有多远」的单调刻度**，不是阶段数量占比：`prepare .05 · detail .1 · upload .35 · fill .55 · submit .8 · verify .85 · waiting .9 · released .92`。`waiting/released` 排在 `submit` 之后是因为频控等待与验证码放行确实发生在提交之后。

## 三、六道变异（各自红集互不相同，跑完 md5 回原值）

| 编号 | 变异 = 取被禁形态本身 | 指名红 | 实测红集 |
|---|---|---|---|
| M1 | 面板 `progressWidth` 退回 `Math.round(done/total*100)` | 条宽取 percent 那条 + 结构锁 | 4 红（含缺字段那条与 aria 同源那条） |
| M2 | `taskWeight` 忽略 `percent`（`if (false)`） | store 接线锁 + percent 优先锁 | 6 红 |
| M3 | 去掉 `Math.min(RUNNING_PERCENT_CEILING, …)` | 99 夹取那条 | 1 红 |
| M4 | 「第 N/共 M」整段 `v-if="false"` | 中文序号那条 + en 档那条 | 2 红 |
| M5 | 去掉 `Number.isFinite` guard | 缺字段退化那条 | 1 红 |
| M6 | `currentIndex` 退回 0-based | 1-based 那条 + store 接线锁 | 2 红 |

控制跑（未变异）`rc=0 collected=92 red=0` —— 不满足即整体不产出结论。还原一律从**内存原始副本**（三份文件都在本次未提交改动集里，`git checkout HEAD --` 会把改动本身抹掉）。

## 四、一条门禁被现场证明是装饰性的（并当场补了有牙的那条）

`check-locale-sync.js --pair-base origin/main` 打印「成对校验覆盖 locale 目录下全部 zh/en 文件」，实测**名不副实**：摘掉 `src/locales/publish-page/en.js` 里的 `summaryPosition` 键后它照打 PASS（它的门控条件是**根级** `zh.js`/`en.js` 是否变更，本批两个根级文件都没动）。真正把这件事拦住的是本批自建的「zh/en 成对」结构锁——摘 en 键时该用例当场红（`AssertionError: expected '/** * publishPage 命名空间文案…' to match /summaryPosition: \(ctx\) =>/`），还原后 17 条全绿。

口径写进设计文档 §8.6.5：**引用一条门禁前必须先做一次"摘掉我新增的东西它是否变红"的反证**，否则会把没有牙的门禁当防线。（这与本仓既有记忆「locale 拆分文件的 zh/en 成对门禁是装饰性的」一致，本轮是同型复发，不是新发现。）

## 五、QM-6 与判定读数（不假装闭合）

- `node scripts/ccg-review-decider.js`（不带 `--base`，判暂存区）现场读数：**DUAL / 变更 452 行 > 200 行阈值 / 8 个源文件 / 无敏感命中**，要求「双模型(claude + opencode) 深度审查」，判定落盘 `.ccg/reviews/4b4a0fb72b2e5b1aff816ff8f5097652f5fc981a0aab126b6ad4d36a7fe3185e.json`，其 `deepReview` 字段原样为 `{required:true, status:"pending", tier:"unknown", performedBy:null, evidence:null, findings:null}`。**该产物按判定原样入库，不手改成 `cleared`。**
- 本机 CCG 未安装 ⇒ pre-commit 实测打印「未找到 CCG（run_skill.js），已跳过 CCG 门禁」⇒ **不产出 dual 产物**，`check-pr-exec-record.js` 的 `evaluateDeepReviewDebt`（只对 `mode === 'dual'` 的产物求闭合）因此**无从判红**。这是"闸门没电"不是"闸门绿"。
- 两条外部通道实测病因（沿用本日早先的复测，未在此重跑即引用会失真）：`codeagent-wrapper` 对 claude 后端固定走 stdin 模式并拼出 `--setting-sources` 空值 ⇒ `exit 1`；opencode 免费档被 IP 信誉拦截。**不伪造 `cleared`，也不写 `self_play_resolved`。**

### 5.1 本 PR 上真跑了四次 `deep-review.sh`（闸门给的出口①），链路与脚本文案不一致 —— 逐次现场读数

| 次 | 调用形态 | 现场读数 | 抓到什么 |
|---|---|---|---|
| 1 | `sh scripts/deep-review.sh --base origin/main` | `✗ 未知旗标：--base（本入口只认 --force / --dry-run / --check-deps / --critic / --proposer / --help）`，rc=2 | 入口**拒绝静默忽略参数**并打印合法清单 —— 这是正例，不是故障 |
| 2 | PowerShell 正规入口 `scripts/ccg-review.ps1 -Mode Deep`（它自己打印 `GitBash: C:\Program Files\Git\usr\bin\bash.exe`） | `✗ 找不到 ccg-deep-review.js`，rc=2 | **脚本文案给的根因被当场否证**：该闸声称病因通常是「裸 bash 解析到 WSL shim」，而这里 shell 就是 Git Bash |
| 3 | `CCG_ARL_DIR=C:/Users/to_co/.qoder-cn/skills/adversarial-review-loop/scripts sh scripts/deep-review.sh` | **引擎找到了**，继续往下跑 | **脚本文案的第二条断言也被否证**：它写「不要去查、不要去设 `CCG_ARL_DIR`，该变量三级作用域都不存在，追它是死路」。实测它是本机**唯一**能定位到引擎的那一格——候选表第 3 项硬编码 `$HOME/.claude/skills/…`，而本机 Qoder 的真实技能根是 `~/.qoder-cn/skills`（这是已知机器事实，不是新发现） |
| 4 | 同第 3 次（引擎已在） | `⚠ 本提交有 799 行非 .ccg 改动，却找不到任何判定记录 … 请先提交一次（pre-commit 会生成 .ccg/reviews/<sha>.json）`，rc=1（fail-closed） | 真正的断点是 **pre-commit 没写 `<HEAD sha>.json`**：本仓 pre-commit 的 CCG 步骤打印「未找到 CCG（run_skill.js），已跳过」。而 `deep-review.sh` 只认 HEAD 键记录，不认我手动跑 `ccg-review-decider.js` 落盘的 **stagedDiffHash 键**记录（`4b4a0fb7….json`，`check-pr-exec-record.js` 判 dual 欠账时读的正是后者） |

**结论（不写成"已闭合"）**：出口① 在本机今天走不通，且断点不是"后端坏了"而是**两把键不同名**——判定器按 `stagedDiffHash` 落盘、评审驱动按 `HEAD sha` 读取，而连接两者的 pre-commit 步骤因 CCG 未安装而整段跳过。三条修法都**不该由 agent 单方面做**：a) `npx ccg-workflow` 装第三方工具链；b) 把引擎 vendor 进本仓 `scripts/`；c) 给候选表加 `~/.qoder-cn/skills/…` 这一格 —— c 是改「谁来守门」，须人工过目。**本 PR 因此停在 enforce 红（CCG 深度审查欠账 1 条）不合并，产物与读数原样入库。**

方法论：这条链上**两次**把工具自己写的「根因」当结论用都会被实测否证（WSL 说、幻影变量说）。口径：**报错文案里的因果句也是主张，引用前要先做一次同探针 A/B**；本文件的第 2、3 次就是那次 A/B（唯一变量分别是 shell 与 `CCG_ARL_DIR`）。


## 六、未覆盖（如实登记，不扩范围）

1. **audit-15（陈旧看门狗）不在本批**：`lastEventAt` 写 4 次读 0 次，需要定「N 分钟无更新」的中性态阈值并解禁关闭按钮 —— 属产品口径，另片处理。
2. 会话内**单任务行**的百分比仍直显 `task.percent`，不参与加权（它本来就是单任务口径）。
3. 权重表是序数校准而非耗时实测分布；将来若主进程带真实 stage 耗时，应改判据而不是只删表。
