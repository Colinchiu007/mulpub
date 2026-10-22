# CCG 深度评审记录：main-red-run-baseline

> 产物来源：验证层 `sh scripts/deep-review.sh`（判定记录 `.ccg/reviews/b198c599d23619f2f81224d36fd84ac7bf12f7755a413f9983ed7d2355bb0c95.json`，
> mode=dual，变更 449 行 > 200 行阈值）。原始评审产物在 `.adversarial/ccg-deep-25739c94/`
> （该目录被 `.gitignore` 排除，**不入库**；本文是该轮评审的可入库留档）。
> 引擎原始裁决模板：`.adversarial/ccg-deep-25739c94/adjudication.json`（同不入库）。

## 评审配置

| 项 | 值 |
|----|-----|
| HEAD | `25739c944` |
| 判定 | DUAL（变更 449 行 > 200 行阈值，对齐 §12.6 Red Team） |
| 请求后端 | critic=`claude` / proposer=`opencode`（`scripts/ccg-review-backends.list`） |
| 实际评审 | critic=`claude` 产出 7 条；proposer 侧**未参与**（opencode 单次输入上限 7800 字节，见「遗留」第 1 条） |
| 维度分 | correctness 5 / security 6 / performance 4 / maintainability 5（最低 4） |
| 收敛判定 | `status=self_play`（minScore=4）→ 引擎第三档出口：自扮演裁决 |
| 外部复核要求 | 引擎判 `高危域必须外部复核 0 条`（6 条争议项的 `highRiskDomains` 均为空） |

## 逐条裁决（第 1 轮，共 7 条）

### i1 · Critical · correctness — **成立（upheld，已修）**

**指控**：`judge()` 的 `mainMoved` 分支硬编码 `counts(0,0)` 并强制 `newRed=[]`，
即使 PR 侧有已确认失败也被压制；这把「不可归因的差集」等同于「没有差异」，
下游自动化无法区分「基准不稳」与「PR 无红」。

**辩护**：`counts()` 从闭包取 `prFail`/`mainFail`/`pending`/`unknown`，**不是**硬编码零；
`newRed` 置空在语义上正确（基准作废时差集确实算不出来）；
`verdict=INCOMPLETE` 与 `prFail=N` 已足以让下游区分「基准不稳」与「PR 无红」。

**裁决**：`upheld`（部分成立）。指控的**结论**方向对——`newRed=[]` 确实会被读成「零新增红」；
辩护只证明了 counts 内部是真值，没解决「`newRed` 这个键本身没有表达『未计算』」。

**处置（已修）**：`scripts/lib/main-red.js` 的 `mainMoved` 档新增
- `prFailNames`：PR 侧**已证实**的失败名（机器可读，不靠解析 reason 散文）；
- `newRedComputed: false`：明示「本档的新增红是**未计算**，不是零」；
- `counts` 仍走 `counts(0,0)`，其中 `prFail`/`mainFail` 本来就是真值（`counts()` 从闭包取）。
- 回归锁：`scripts/check-main-red.test.js` 新增用例「基准作废档必须把 PR 侧已证实的失败名单交出来」。

### i2 · Critical · maintainability — **不成立（dismissed，登记为工具链遗留）**

**指控**：`proposal.md` 自述修订环节被 opencode 后端因输入 >7800 字节同步拒绝
（exit 1、无错误信息），导致「挑完刺但没人回应」；提案机制依赖外部后端的**静默**长度闸门，
缺乏分块或显式错误协议。

**辩护**：这是 **CCG 引擎侧**的容量限制（`scripts/deep-review.sh` / `ccg-deep-review.js`），
不是本片判据的缺陷；本片已用「把现场读数拆到 `evidence.md`」把方案正文压到 6865 字节 < 7800，
让后续评审正常产出。引擎的输出里**已经**给出了这一条对策（「把方案拆小后分轮评审」）。

**裁决**：`dismissed`——**对本片不成立**（指出的对象是工具链，不是本片的判据或提案内容）。
但指控描述的「静默拒绝」是真实的工具链缺陷，登记为遗留（见下「遗留」第 1 条），
本片**不在此修**：改 CCG 引擎的输入协议属「改谁来守门」的邻域。

### i3 · Critical · security — **成立（upheld，已修）**

**指控**：`.ccg/reviews/<sha>.json` 中 `deepReview.required=true` 且 `status=pending`，
但提案仍作为最终方案输出；必要的深度评审未完成，变更可能绕过评审进入执行。

**辩护**：本仓的出口设计就是「填完自扮演裁决 → 把 status 置为闭环值」；
`status=pending` 本身不是「可以跳过」，`check-pr-exec-record.js` 会把它判成欠账并拦合并。

**裁决**：`upheld`——这条指出的是**本轮当时的真实状态**（`self_play_pending` = 公开承认未闭环）。
本片若不收口，`check-pr-exec-record.js --mode=enforce` 会判红，PR 合不进去；
但「先把方案定稿再说」确实是这个出口的误用形态。

**处置（已修）**：本轮即完成收口：
- 6 条争议项逐条填 `prosecution` / `defense` / `verdict` / `rationale`（本文即留档，
  原始模板 `.adversarial/ccg-deep-25739c94/adjudication.json` 同址改写）；
- 判定记录的 `deepReview.status` 置为闭环值 `needs_revision`，`tier=external`，
  `evidence` 指向本文（可入库、可解析），`closureNote` 写明轮次与逐条处置。

### i4 · Warning · performance — **成立（upheld，已修）**

**指控**：稳定窗默认 `attempts=3`、`retry-seconds=90`，引入最高 270 秒休眠；
在 CI 合并闸门场景中直接增加墙钟，且**无上限保护**防止重试风暴。

**辩护**：270 秒相对合并入口自身的 120 分钟预算是小头；
「默认 3 次 × 90 秒」是有界重试，不是风暴。

**裁决**：`upheld`（后半段成立）。前半段（墙钟）可接受；后半段「无上限保护」是**真洞**：
`--attempts` 与 `--retry-seconds` 都是调用方可传的旗标，
`--attempts 100 --retry-seconds 3600` 就是 100 小时——「有界重试」在参数层并不有界。

**处置（已修）**：新增 `--max-wait-seconds`（默认 300，**总**等待上限）：
累计等待将要超过上限 ⇒ 立即停止重试、判「未证实」(3) 并打印「因上限停手」的事实，
不静默延长。配套：参数校验（非法值抛错）+ 回归锁
（`--max-wait-seconds 0` 时只尝试一次，不得进入第二轮）+ spec 新增 Requirement「稳定窗的总等待必须有上限」。

### i5 · Warning · correctness — **不成立（dismissed，补注释）**

**指控**：`selectMainRuns` 对缺失 `event` 字段直接抛错，不区分「字段缺失」与「新事件类型」；
若 GitHub 改投影形状，闸门将恒定 SELF_FAULT 而非优雅降级。

**辩护**：① 仓库纪律明写「形状不认识 = 探针失明，**不得**按『无红』放行」——
把缺 `event` 的 run「优雅降级」为「不是 workflow_run」放行，
等于把「没读到事件类型」读成「它是主干自己的验证」，那是**把未知读成安全**；
② 「新事件类型」的情形并不被丢弃——过滤器是「排除 `workflow_run`，其余全进基准」，
GitHub 将来新增任何事件类型（`merge_group` 等）都会**自动进基准**，是安全侧；
③ 恒定 SELF_FAULT 不会让合并「偷偷通过」：它会拦下并要求人处理，这正是失明时该有的行为。

**裁决**：`dismissed`——指控建议的修法（默认跳过未知形状）**违反本仓的失明纪律**，
且它要防的「新事件类型被丢弃」在本实现里不存在。

**处置（补注释）**：在 `selectMainRuns` 的注释里把这两类情形写明：
「字段缺失 = 形状不认识 ⇒ 抛错（失明不放行）」与「未知事件类型（非 `workflow_run`）⇒ 自动进基准」。

### i6 · Warning · maintainability — **不成立（dismissed，登记为已知局限）**

**指控**：代码与文档分裂到 `openspec/` 下，但 `.github/workflows` 和 `scripts/` 中仅通过字符串引用；
无自动化验证确保文档与行为锁同步，文档漂移风险高。

**辩护**：① 本仓已有两道既有机制覆盖这件事的一半：
`openspec validate --strict`（本 change 实测 **valid**）与 quality-gate 的 **Gate 2b2**
（spec 镜像契约，接在 `changes` 作业里，docs-only 短路也跑）；
② 本片每条 spec Scenario 都有**逐条对应**的行为锁用例（判据侧 46 例、
契约侧 46 例），Scenario 与用例是一一对应关系，不是散文引用。

**裁决**：`dismissed`——「完全无自动化验证」与事实不符；
但「spec ↔ 代码的**逐条自动**同步」确实**没有**通用机制，登记为已知局限。

**处置（登记）**：写进 `openspec/records/main-red-run-baseline.md` 的「遗留」：
本片**不加**新的 CI 门禁——加一条「spec 与实现逐条比对」的自动检查属「改谁来守门」，
按 AGENTS 必须人工过目，不在本片的自动合并范围内。

### i7 · Info · security — **已满足（无需处置）**

**指控**：runner 迁移缺少回滚保护；建议在 workflow 顶部加不可修改的注释标记，
并在契约测试中增加对文件内容的直接断言（已做，已足够）。

**辩护与裁决**：建议的两项**本片已做**：
① `.github/workflows/ci-failure-handler.yml` 的 `runs-on` 旁已写明「⛔ 必须 ubuntu-latest」
及其实测依据（排队 46.6/51.5 分）；
② `.github/scripts/workflow-contract.test.js` 新增契约锁直接断言 `runs-on === 'ubuntu-latest'`
（把它改回 `windows-latest` 当场变红）。**无需处置。**

## 决策层第二轮（2026-10-22，方案压缩后重跑，critic=claude）

> 触发：方案正文原 10165 字节 > opencode 后端 7800 字节上限 ⇒ 修订环节被同步拒绝。
> 处置：把现场读数拆到 `evidence.md` 后把方案压到 6865 字节重跑。
> 再次撞上**产物目录碰撞**（引擎 slug 只取方案文件名，`proposal.md` 已被别的 change 用过）⇒
> 按引擎给的出路 ①，用唯一名副本 `plan-main-red-run-baseline.md`（内容与方案逐字相同）跑，
> **不动别人的产物目录**。

| 项 | 值 |
|----|-----|
| 判定 | 轮 1：8 条问题（**Critical 0**），最低维度分 **6**（completeness 7 / consistency 8 / clarity 8 / feasibility 6 / security 8） |
| 停止原因 | **converged**（无 Critical、无未解决的 High） |
| 决策层裁决 | **cleared** |
| 判定记录 | `.ccg/reviews/ef571cd84ce6b03144e0482050f73cd6a8eae673.json`（`deepReview.status=cleared`，`performedBy=claude`） |

> 最低分从第一轮的 **4** 升到 **6**、Critical 从 2 降到 0 —— 升的正是第一轮那两条 Critical
> （档位表述自相矛盾、「两端口径完全一致」与换 API 矛盾）被改掉的结果。

### 8 条的处置

| # | 严重度 | 意见（摘要） | 处置 |
|---|--------|--------------|------|
| i3 | Warning | 迁移到 ubuntu 只锁了显式 pwsh，未审计**隐式** Windows 依赖（路径 / shell / 命令） | **已修**：契约锁加三条断言——不得含 Windows 盘符路径、不得引用 `.ps1`、不得用 cmd 专有命令（`cmd.exe`/`where.exe`/`setlocal`）；另核实 `.github/scripts/classify-ci-failure.js` 无 `win32`/`windows`/`powershell` 命中 |
| i1 | Warning | 未说明**怎么**取作业级终态（缺端点路径与终态映射） | **已修**：spec 与提案写明端点 `actions/runs/{run_id}/jobs`、取 `jobs[].name/status/conclusion`；并说明作业名 == check-run 名 ⇒ 名字对齐天然成立 |
| i2 | Warning | 未定义分页中断 / 429 / 5xx / token 超时的处理 | **已修**：spec 与提案写明「任一 API 失败 ⇒ 采集层抛错 ⇒ 判自身故障(4)，不得读成『无检查』」；实现上 gh 非零 rc 已由采集层抛错 |
| i4 | Warning | 稳定窗的**比较对象**未写明（tip SHA 还是完整数据集） | **已修**：写明「比较对象是 tip SHA（`origin/main` 的 rev-parse 结果）；SHA 相同即稳定、继续判读、不重试」 |
| i6 | Warning | 过滤只排除 `workflow_run`，未说明 `schedule` / `release` / `pull_request` 是否计入 | **已修**：写明「基准 = 该 tip 上的全部非 `workflow_run` run（含 push / schedule / workflow_dispatch）；`pull_request` 事件的 run 只有在其 `head_sha` 恰好等于 tip 时才落进集合，计入安全」 |
| i5 | Info | 「运行时代码无」与实际改了 `scripts/` 不一致，易误导范围判定 | **已修**：改为「**不触 `apps/`、`packages/`**（QM-1 N/A）；改的是 `scripts/` 下的**门禁运行时**（合并入口与判据本体，PR 侧必跑）与 `.github/workflows/` 的 CI 配置」 |
| i7 | Info | 换端点后的 token 权限要求未说明（权限不足会静默返回空） | **已修**：写明「与读 check-runs 同一份 gh 凭据、scope 相同、**无需新增授权**；权限不足 ⇒ 403/404 ⇒ gh 非零 rc ⇒ 抛错 ⇒ 判自身故障(4)，**不会静默返回空**」 |
| i8 | Info | 「AGENTS 口语的四档」这个外部引用降低可审计性 | **已修**：删掉口语引用，直接定义五档并逐档说明 |

## 决策层第三轮（2026-10-22，方案补完 i1–i8 澄清后，critic=claude）

> 触发：第二轮收敛后，我把 8 条澄清补进方案（事件范围 / 权限 / 端点 / 比较对象 / 影响面措辞），
> 方案体量涨到 7642 字节 ⇒ proposer 侧再次撞上 7800 字节上限（7976 字符），
> **critic 侧仍正常产出 6 条**（含 2 条 Critical，最低分 5）。
> 这 2 条 Critical 正是**新补的文字引入的**——补澄清会引入新矛盾，这是本轮最值得记的一条。

| # | 严重度 | 意见（摘要） | 裁决与处置 |
|---|--------|--------------|------------|
| i1 | Critical | 「作业名 == check-run 名 ⇒ 差集对齐天然成立」**没有**覆盖复合/可重用工作流；同一作业多检查时差集行为未定义 | **成立（已修）**：① 实现层加**同名多行取最严格的一格**（`fail` > `unknown` > `pending` > `skipped` > `pass`，`scripts/lib/main-red.js` 的 `aggregateRows`）——不聚合的话同名「一红一绿」会同时落进 fail 集与 pass 集，差集行为不确定；② 文档层把「天然对齐」改写为「行粒度一致」，并把「跨 workflow 同名作业（如 `Changes` 三处各一份）按同名合并」写成**已知局限**（消歧到 workflow 级要两侧都改取数方式，本片不做）。回归锁 1 例 |
| i2 | Critical | C4 迁 ubuntu 释放 Windows 额度的**因果未经验证**——未证明 handler 与 `electron-tests` 共享同一 runner 池 | **成立（已改口径）**：观测事实只有「Windows 作业排队 46.6/51.5 分、同批次 ubuntu 零排队」；「handler 占了 electron-tests 的位置」**未被证实**（托管池实时占用不可观测）。故 C4 的收益一律写成**预期释放**，并在 spec 与提案里明写「MUST NOT 把『Windows 排队会因此缩短』写成已证事实」，另留观测点（迁移后复跑 `electron-tests` 排队读数，E3 同口径） |
| i3 | Warning | 契约锁只测 C4；C1 的 event 过滤、分页中断、C2 重试无对应 CI 锁 | **前提不成立（已核）**：`node --test scripts/check-main-red.test.js` 就在 `quality-gate.yml:458`（Gate 2b 系列）执行，判据侧 49 例的行为锁**确实接在 CI 里**。仍**补了一条**：分页中断 / 429 ⇒ 采集层抛错 ⇒ 判自身故障(4) 的回归锁（原来只有「缺 mainRowsAt」与「prHeadSha 抛错」两处） |
| i4 | Warning | `actions/runs` 需 `actions:read`、`check-runs` 只需 `checks:read`；「同一凭据」的说法掩盖了新增授权失败模式 | **成立（已改）**：原文写的「scope 相同、**不需要新增授权**」是**错的**——两者 scope 不同，只授 `checks:read` 的 PAT 读 `actions/runs` 会得 **403**。改为：scope 不同 + 403 ⇒ gh 非零 rc ⇒ 采集层抛错 ⇒ 判自身故障(4)，**不会静默返回空**（本机凭据实测可用） |
| i5 | Warning | C2 耗尽时「点名两个 sha」未指是首尝/末尝的 before/after | **成立（已改）**：措辞改为「最后一次尝试：读数时的 tip X → 读数后的 tip Y」 |
| i6 | Info | `event` 缺失抛错未覆盖 null / 空字符串 | **成立（已补）**：实现上 `null` / `''` / `undefined` 都走「缺 event 字段 ⇒ 抛错」；补了回归锁一例逐个验证三种空值 |

## 决策层第四轮（2026-10-22，方案补完 i1–i8 澄清后，critic=claude）

> 轮 1：7 条 / **Critical 2**，最低维度分 **7**（四轮轨迹：4 → 6 → 5 → **7**）。
> proposer 侧再次撞上 7800 字节上限（8885 字符 = 方案 7470 + 7 条意见 + 提示词），
> **critic 侧正常产出**——又是同一个机械瓶颈，不是评审没发生。

| # | 严重度 | 意见（摘要） | 裁决与处置 |
|---|--------|--------------|------------|
| i1 | Critical | C1 选最新 run 用 `run_attempt` 但**没有缺失兜底**，选错 run 会污染基准 | **成立（已修）**：`isLaterRun` 判定序改为 `run_number` → `run_attempt`（**缺失按 1 计**）→ **时间戳兜底**（`updated_at` 优先、其次 `created_at`），不再依赖 API 返回顺序的隐含假设；回归锁 1 例（覆盖 attempt 缺失/同级/重跑/新推送四种形态） |
| i2 | Critical | C4 的影响里把「已改」与「因果只是预期」混在一起 | **成立（已改）**：Impact 段拆成**已验证的影响**（本片改了什么）与**预期的影响**（因果未证实）；C4 的收益一律写「预期释放」 |
| i3 | Warning | 换端点引入 `actions:read`，但没提 token 轮换 / scope 审计 | **成立（已改）**：写明「CI 侧用默认 `GITHUB_TOKEN`（默认权限已含 `actions:read`），**本片不新增任何仓库 secret**；本地 PAT 实测已具备，不具备则 403 ⇒ 判自身故障(4)」 |
| i4 | Warning | 引用契约锁但没点名断言，验证路径不清 | **成立（已改）**：spec 与提案都点名用例名「CI Failure Handler 必须让出 Windows 并发额度（2026-10-22，change: main-red-run-baseline）」 |
| i5 | Warning | C2 的重试条件没说「同一 SHA 下 pending 的 job 会不会再触发重试」 | **成立（已改）**：写明「重试的**唯一触发条件是 tip SHA 变化**；同一 SHA 上的未完成 job **不**触发重试（由判据的「未证实」档 rc=3 处理）」 |
| i6 | Info | 分页中断时「已读到的部分页」怎么处理未定义 | **成立（已改）**：写明「分页中断 ⇒ gh 非零 rc ⇒ 抛错 ⇒ **整次读数作废**，MUST NOT 合并部分页」 |
| i7 | Info | C5 的环境变量如何变成参数未说明 | **成立（已改）**：写明「入口读环境变量 → **转成 CLI 参数** `--attempts` / `--retry-seconds` 传给 `check-main-red.js`（判定层只认参数，不读环境变量）」 |

### 第四轮之后：为什么改用 codex/claude 做真跨家族收敛

`opencode` 后端的**单次输入上限 7800 字节**让「proposer 逐条回应 critic 意见」这一环
在方案 + 意见总量超过限额时**必然**停摆——四轮里出现三次。本仓已有先例：
`.ccg/reviews/be84f449a192c39709178963be6cee9a848654d8.json` 的 `closureNote` 写着
「第 1 轮 proposer（opencode）因该后端 7800 字符单次输入上限同步拒绝……**随后改用无长度上限的
codex/claude 组合重跑 4 轮，全部正常产出**」。本片照该先例，在最终方案上用
`--critic codex --proposer claude` 重跑，让跨家族回路真的跑起来。

## 决策层第五轮（2026-10-22，critic=codex / proposer=claude —— 真跨家族回路跑通）

> 按本仓先例（`.ccg/reviews/be84f449a192c39709178963be6cee9a848654d8.json` 的 closureNote）
> 改用**无长度上限**的 codex/claude 组合：critic=codex 产出 **8 条 / Critical 2**（最低分 5）；
> proposer=claude **逐条给出了决策**（accepted / partially_accepted + 修订建议）——
> **跨家族回路第一次真的跑起来了**（前四轮 proposer 侧都被 opencode 的 7800 字节上限挡掉）。
> 引擎的**自动改写应用**随后失败（`edits[0].before` 逐字匹配不上 ⇒ 方案原封不动），
> 于是本片按引擎模板**人工逐条落**（同深度评审的裁决做法）。

| # | 严重度 | 意见（摘要） | 处置 |
|---|--------|--------------|------|
| i1 | Critical | PR 侧读 check-runs、主干侧读 run/jobs，**两侧命名空间不同**；rc=1「新增红」靠差集对齐，口径一换差集即失真 | **成立（已改）**：写明「两侧的名字集合都是**作业名**（check-run 名 == 作业名 == `jobs[].name`）⇒ **差集口径未变**」；并补**缺格方向是保守的**这一条：某检查在主干侧缺席（没跑）时，PR 侧同名红**仍判新增红**（不漏判）。proposer 建议的「两侧统一映射到 workflow+job」本片不采纳——那要把 PR 侧也换成 run/jobs 取数，属另一件事（登记为遗留） |
| i2 | Critical | 未规定「该 tip 上零 run / run 尚未创建」的行为；空集合等于零失败 ⇒ 判绿，是闸门最该拦的假绿 | **成立（实现上已闭合，文档补齐）**：既有判据的「主干零读数 ⇒ 未证实」档**已经**判 rc=3（不判绿），且本片有对应回归锁；文档补写该条并点名这条档位 |
| i3 | Warning | 分支保护要的是 check-run 名，改读 run/jobs 后与 required checks 不再一一对应；jobs 全绿但 required check 缺失会被读成绿 | **成立（已改口径）**：写明「required check 在该 tip 上没跑 ⇒ 主干绿」这一面本片**不额外收紧**——那需要引入 required 名单（属「改谁来守门」，须人工过目），登记为遗留；缺格方向对差集是保守的（见 i1） |
| i4 | Warning | C2 写「origin/main 的 rev-parse」**未写 fetch**；本地引用不 fetch 不会变，稳定窗永不触发 | **成立（已改）**：统一写「每次尝试**先 `git fetch origin main` 再 `rev-parse origin/main`**；fetch 失败 ⇒ 抛错 ⇒ rc=4」 |
| i5 | Warning | 读数按 sha 取本身不受 tip 移动影响，稳定窗属冗余，却引入最多 300s 等待；3×90s 与 300s 算术未对齐 | **成立（已改）**：① 写明**稳定窗解决的是「判的是哪棵树」**（不重试就会拿旧 tip 的绿去放行），不是「读数会不会坏」；② 时间预算改成自洽：3 次尝试 ⇒ 最多 **2 次**等待 ⇒ 2 × 90s = **180s**，与 `--max-wait-seconds` 默认值**相等**（代码里默认值已从 300 改成 180） |
| i6 | Warning | 「同一 workflow 取最新」与「同名多行取最严格」两条规则冲突，未定优先级 | **成立（已改）**：写明**两阶段顺序**——**先**按 workflow 取最新一次 run（`selectMainRuns`），**再**按作业名聚合（`aggregateRows` 取最严格的一格） |
| i7 | Warning | 「默认 GITHUB_TOKEN 已含 actions:read」只在未声明 permissions 时成立；需改承载判据的 workflow，而 Impact 未列 | **前提不成立（已核）**：**没有任何 workflow 跑 `scripts/check-main-red.js`**（quality-gate.yml:449 只是注释提到它），判据是**本地工具**（合并入口调用，用 gh CLI 本机凭据），CI 只跑它的**测试**（不联网）⇒ 不需要改任何 workflow 的 `permissions`，Impact 也不必加文件。文档已改写为该形态 |
| i8 | Info | runs 分页后逐 run 取 jobs 是 N+1 请求，还要乘 3 次尝试；限流预算未评估 | **成立（已写明）**：请求预算 = 1（runs 列表，分页）+ N（逐 run 取 jobs，N = 非 workflow_run 的 workflow 数，实测 6–8）⇒ 每次尝试 ≤ 9 次、整次判定 ≤ 27 次；长期 429 ⇒ rc=4（fail-closed，可重跑） |

## 遗留（不假装已闭合）

1. **CCG 引擎的输入长度协议**（i2）：opencode 后端单次输入上限 7800 字节，
   超限时**同步拒绝**（~120ms、exit 1、无任何错误信息）。本片用「拆 `evidence.md`」绕开，
   但引擎侧仍缺显式长度校验与分段重试协议。改它属「改谁来守门」的邻域，本片不动。
2. **spec ↔ 实现的逐条自动同步**（i6）：本片靠 `openspec validate --strict` + Gate 2b2
   + 「Scenario ↔ 行为锁用例一一对应」这三样，缺一条通用的「spec 与实现逐条比对」自动门禁。
3. **proposer 侧本轮未产出**：本轮争议项由 **critic=claude** 产出（7 条），
   proposer=opencode 因上述长度上限未参与逐条回应；裁决由会话按引擎模板逐条填写
   （`confidenceWeight=0.6`，低于真跨家族 1）。这是**自扮演**的诚实标注，不是「跨家族已收敛」。
