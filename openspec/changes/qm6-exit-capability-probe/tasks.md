# Tasks: qm6-exit-capability-probe

> 顺序即依赖：1 的谓词是 2 的结论生成器的输入；3 的契约锁必须读 1 的导出面。
> 每条勾上都带"当场跑出来的那条读数"，不写"应该没问题"。
> **落点与动笔时的两处偏差**（写在勾旁边，不改 §1/§2 的原意）：
> ① 三格谓词不住在探针本体，而是独立模块 `scripts/qm6-exit-capabilities.js`（理由见 design §1）；
> ② 行为真跑取 `require(vendorDriver)` 而不是 `vm` 编译（理由见 design §1.2）。

## 1. 三格出口的现读谓词（`scripts/qm6-exit-capabilities.js`）

- [x] 1.1 恢复 #4067 被撤销的那一格：导出纯谓词 `externalReviewCapable(src)`
      —— **两条同时成立**才算在位：解除谓词被 `function` 定义（注释里提一句不算）+ 驱动把期望后端写进裁决模板
      读数 `externalReview=true`（A1 两版夹具答案不同；n4 把判据放宽成"文本里出现过名字"时 A1 指名红）
- [x] 1.2 新增 `upheldExitCapable(src)`：`verdict === 'upheld'` 那条 push 之前有没有解除臂
      读数 `upheld=false`（A2 无守卫判 false/有守卫判 true；A3 对注释行数不敏感；A4 别处的 `return` 不得替它顶罪）
- [x] 1.3 新增 `toolSignatureCapable(src)`：`ccg-review-writeback.js` 里除 `performedBy === expected` 之外
      有没有第二条通往"写"的路径 —— 读数 `toolSignature=false`（A5 两版夹具；n5 恒 true 时 A5 红）
- [x] 1.4 三个谓词（含行为档 `upheldExitBehavioral`、交叉比较 `crossCheckUpheld`、聚合 `readCapabilities`、
      生成器 `conclusionLine`）都从 `module.exports` 出去；A12 按名字逐个问，不接受"文件还在所以没事"
      （n6 重演 #4062 那种"从导出面摘掉一个名字"，实测 A12 指名红）
- [x] 1.5 仓内写回器源码的读取入口在探针侧是 `readWritebackSource()`，读不到 ⇒ rc=2 并点名
      "工具署名出口取不到数"；聚合层对越界返回值（`undefined`/`null`）当场抛错（A7、n9）

## 2. 结论行由读数生成

- [x] 2.1 `conclusionLine(caps)` 按 design §2 的三档拼接；探针 stdout 那句由它生成
      现场整句：`验证层三个停止出口里只有 ③(maxRounds→self-play) 可达（要把分数抬到 8 才另有出口）；`
      `高危域条目：填齐外部复核三格后可解除（vendor 已能表达）；诚实标 upheld ⇒ 永久阻断（机制缺口，非本 PR 缺陷）；`
      `工具署名：自扮演收口永拿不到 tier=external（须人工补字段或全驳回）`
      （n8 把生成器改成无视入参 ⇒ A8 红；n10 把句子写死回旧文案 ⇒ A10 红）
- [x] 2.2 `--json` 档的 stdout 只能是 JSON（人读行改道 stderr），新增 `exitCapabilities`（含
      `upheldBehavioral`）、`capabilitySource`、`upheldCrossCheck`、`conclusion` 四组读数（P1 走 `--json` 解析）
- [x] 2.3 行为真跑档：`require(vendorDriver)` 后拿 `blockingFromAdjudication` 喂两份合成裁决各调一次
      —— A 份无凭证必须计阻断（不阻断即抛错，n16 摘掉这道防呆时 A13 红）；B 份**同时**带
      `externalReview`（vendor 今天真读的那份）与 `resolution`（假想未来臂会读的那份）两形状 ⇒ 读数 `false`。
      ⚠ 本条第一版只写了 `resolution`，而 vendor 从不消费它 —— 是 QM-6 第一轮评审 i2/i5 逼出来的形状错误，
      读数虽对但不是量出来的（见 design §1.2b）
- [x] 2.3b 正控 `externalReviewReceiptLive(fn)`：高危域条目 + 那份 `externalReview` 凭证必须**真的**被 vendor 解除；
      正控不成立 ⇒ 行为档返回 `'unavailable'` 而不是 `false`（拒绝在空夹具上给结论）。
      本机读数 `正控(凭证是否被 vendor 消费)=true`；锁 A16（含键名逐个点名、`performedBy` 不得是 self-play、
      `evidenceRef` 必须过 vendor 的形状判据）；变异 n19/n20 各指名红一条
- [x] 2.3c 结构谓词的解除臂词表加上 `externalReview`（vendor 今天唯一的凭证词汇）；
      A2 因此加第三种"在位"夹具（`if (i.externalReview) { return; }`），n21 摘掉该词项时 A2 指名红
      —— 没有这条夹具，词表里那一项就是"写了但没人量"的装饰
- [x] 2.4 行为真跑与结构谓词**互不代替**：`crossCheckUpheld` 不一致 ⇒ 进 `problems` ⇒ rc=1 并点名
      "结构读法失效"，**不自动翻转结论**（design §1.3；n14 把比较改成恒 ok 时 A14 指名红）
- [x] 2.5 vendor 缺席（CI runner 那一档）：结构谓词仍跑（输入换成夹具源码），行为档出声
      `behavioral=skipped(no-vendor)` 且 `ok:true`（缺席不得判偏离，A14）；探针本体仍 rc=2 点名失明（P4）
- [x] 2.6 补一道"两路全瞎"的守卫（动笔时没有这一条，实施中识别出来）：探针走到交叉这步就意味着 vendor 在位，
      此时行为档仍是 `unavailable` ⇒ 记一条 `problems`（rc=1）。
      现场读数：`结构=false 行为=false ⇒ 两路一致：这条出口不在位`；
      P11 用"摘掉导出名"的 vendor 夹具真跑出 rc=1 并点名行为档，n18 摘掉守卫时 P11 指名红

## 3. 撤销检出：独立文件的契约锁（这一组是本刀的立项动机）

- [x] 3.1 新建 `scripts/qm6-exit-capabilities.test.js`（19 条 A1–A19）：`require` 读数器并断言导出面在位（A12）
- [x] 3.2 每条谓词各配一对夹具（design §1.1 表），断言两版实现**答案不同**；同形当场红（A1/A2/A5）
- [x] 3.3 结论生成器两条反方向锁：写死成"可达"要红（n8/n10 两条变异分别覆盖）、写死成"不可达"也要红；
      `unknown` 档必须有独立文案（A6/A8）
- [x] 3.4 接线自检：新锁与探针都必须被 `quality-gate.yml` 的**可执行正文**点名（A11；n12 摘掉那一行时 A11 红）
- [x] 3.5 恢复 `openspec/changes/ccg-convergence-exit/tasks.md` 被 #4062 删掉的 31 行（§9/§10），
      并在文件里补 §10.7 现状补记：该文件曾被整段撤销、现由第 3 组契约锁防复发；历史不改写

## 4. 接线与常驻化

- [x] 4.1 `quality-gate.yml` 的 **Gate 2b6**（原本已跑 `ccg-convergence-probe.test.js`）同批点名新契约锁；
      编号按 `git grep -ho "Gate 2b[0-9]+"` 现读后选定，未新增编号即未新增撞车面
- [x] 4.2 `.gitignore` negation 三个新脚本（`scripts/*.js` 默认忽略面）；`check-unwired-tests` 通过、不新增欠账登记
      （见第 6 组批跑读数）
- [x] 4.3 本机门禁批跑 15 条：`check-workflow-structure`(`files=17 violations=0`) / `check-step-failfast`(OK) /
      `check-test-egress-guard`(面=18 已接=14 欠账=4/4) / `check-test-microtask-spin`(1633 文件 0 处) /
      `check-doc-abs-paths`(counts=1161 domain=5500 canJudge=true PASS) / `check-record-qm5-rows`(358 记录 未登记缺行=0) /
      `check-gate-record-debt`(OK) / `check-text-encoding-integrity`(无新增) / `check-no-brand-residue`(PASS) /
      `check-no-hot-carrier-edit`(advisory 命中=0) / `check-changelog-growth`(598→598) / `openspec-sync-check`(387 tasks) /
      `check-schedule-failure-watch`(判定=OK) / 两个新套件(15、11) —— **14 条 rc=0，1 条 rc=2**：
      `check-schedule-heartbeat.js` 在本地无 `GITHUB_REPOSITORY` 时按设计走采集器不可用档（上一刀定的三档退出码，非本 PR 引入）；
      行尾两口径 numstat 逐文件相同、`drift=0`（13 个文件，读数在执行记录）

## 5. 变异反证驱动 `scripts/qm6-exit-capabilities.mutation.js`

- [x] 5.1 靶子三类：读数器本体（CAPS）/ 探针本体（PROBE）/ workflow 接线行（WF）；
      套件下界 `qm6-exit-capabilities.test.js=19`、`ccg-convergence-probe.test.js=11`
- [x] 5.2 `ALLOWED_MISSED` 留空；每条变异指名要红的用例；`expectGreen` 的声明被否证即 PROBLEM
      现场：`SUMMARY CAUGHT=26 MISSED=0 PROBLEM=0 TOTAL=26 ATTEMPTED=26` / `RESULT=OK`（2026-10-24，本 worktree，干净基线）
- [x] 5.3 必含项逐条对上：恒 true（n1）/ 恒 false（n2）/ 结论写死（n10）/ 从导出面摘掉（n6）/
      摘掉 workflow 点名行（n12）/ 把 vendor 缺席伪装成"不在位"这一族（n15+n17+n18：分别覆盖
      "真跑路径整体不执行""调用在位但结果被常数覆盖""两路全瞎时守卫缺失"）
      未做的第 5.3 原句里那一种"把缺席档改成 `skip`"：本刀的缺席档不是 `skip` 而是 rc=2 且仍打印仓内读数（P4 守），
      要把它改成 skip 已由 P4 的产物断言拦住，故不再单列一条变异 —— 这是有意偏差，不是遗漏
- [x] 5.4 终跑读数已写入执行记录（活数，见 `openspec/records/qm6-exit-capability-probe.md`）
- [x] 5.5 **驱动自身的基线卫生**（QM-6 第二轮评审 i2 [Critical] 成立并当场修复，不是驳回）：
      本驱动原地覆盖受 git 管理的源文件，而 `finally` 只覆盖"抛错"这一条路 —— 被信号杀掉时盘上留在
      "改坏的那一份"，下一次运行会把它的字节当成原始内容（本仓实测过一次，见记忆「变异驱动的还原基线可以是脏的」）。
      落三条：① `assertCleanBaseline` 开工前逐个靶子 `git status --porcelain`，脏即拒绝并点名精确路径
      （取不到读数按未证实处理，不得当成"干净"）；② 原始字节写 sidecar 到 `os.tmpdir()` 并**写后回读逐文件比对**，
      新增 `--restore` 作为异常终止后的可执行出口（不是"请自行恢复"这种散文）；
      ③ CLI 解析抽成 `parseCli`：未知旗标与 `--restore` 混用一律拒绝，脏基线只有显式 `--allow-dirty` 一条出口且照旧打警告。
      锁：A17（临时真仓库跑真 git 读数：干净 true / 改过 false / 取不到读数抛错）+ A18（parseCli 五种输入逐档）
      + A19（顺序锁：拿锁 → 证干净 → 存 sidecar → 才动文件，且 finally 必须"先还原再放锁"，锚点缺失即红）
      + A20（单实例锁：并发第二轮当场拒绝、锁内写 pid、释放后能重拿、二次释放幂等、**不自动破锁**）；
      变异 n22/n23/n24/n25/n26/n27 各指名一条红。
      **这一组也是本刀第一次把驱动自己列为靶子（MUT）**，随即被自己的机制咬到两次，都记在案：
      ① 锚点字面量写在 M 表里 ⇒ "命中恰 1 次"读到 2 次（n22 首跑）⇒ 正解是把表里的字面量拆成两段拼接，不放宽命中数；
      ② 同一条理由让 **n26 首跑 MISSED** —— A19 的全文 `indexOf` 先命中 M 表里那串锚点文本，于是"摘掉拿锁"在它眼里仍存在
      ⇒ 正解是把搜索域收敛到 `function runAll` 那一段（A19 现在就这么做），并把该锚点也拆成两段。
- [x] 5.5b 单实例锁的理由与边界：两个驱动并发不只是 sidecar 互相覆盖（固定文件名，后写覆盖先写 ⇒ `--restore` 会还原成
      另一轮的基线），更会同时改写同一批靶子；被 SIGKILL 留下陈旧锁时**一律拒绝而不是自动破锁**——
      自动破锁等于把"两个进程互踩基线"这一整类重新打开，宁可让人先看一眼（拒绝文案里写了归因所需的 pid 与处置）
- [ ] 5.6 已知遗留（不假装已闭合）：`--allow-dirty` 那一支的"忽略旗标、永远证干净"这一变异**没有配**，
      因为 A19 只测顺序、A18 只测解析，两支都看不出"运行期是否真的走了 else 分支"——
      要抓到它必须让驱动在临时仓库里真跑一轮（本仓现有夹具形态不支持）。如实记为未覆盖，不写成"已被其它变异间接覆盖"

## 6. 收尾

- [x] 6.1 执行记录 `openspec/records/qm6-exit-capability-probe.md`：QM-5 ①②④⑤ + 现场读数 + `## CHANGELOG 条目`
      （4.3 的两口径 numstat 与门禁批跑读数补在该记录里）
- [ ] 6.2 QM-6：本刀差量命中 `scripts/ccg-convergence-` 吗？—— `HIGH_RISK_SURFACES` 现读 10 条，
      命中的是 `.github/workflows/`（改了 `quality-gate.yml`）⇒ 按矩阵须 `tier=external` + 可核 `evidence`；
      拿不到工具署名（本刀恰好测的就是"拿不到"这一格）时按 #4234 / #4305 先例人工闭环，
      并在产物里逐字声明"tier 由会话手写"
- [ ] 6.3 合并后回读该 merge SHA 的 `quality-gate.yml` push run，读数写进 PR 评论；再按 R1–R7 清 worktree
