# changelog-ledger-integrity Specification

## Purpose
定义 append-only 台账 `CHANGELOG.md` 的完整性由哪几把锁共同持有、它们的口径如何保持单一、
以及「在不削弱既有不变量的前提下清理历史污染」这条通路必须满足什么条件才可被接受。
目标是让"清理"与"误删"在机器判据上是**可区分**的，且区分依据不是数量阈值而是**是否经过书面授权**。
## Requirements
### Requirement: 台账条目模型 MUST 只有一份实现

系统 SHALL 由单一模块持有「什么是一条条目」的定义（一级标题、排除节标题 `# CHANGELOG`）与
条目切块、按标题分组、保留份选择、去重这些操作；`check-changelog-growth.js` 与
`check-changelog-duplicate-entries.js` MUST 复用该模块，MUST NOT 各自维护第二份口径。

#### Scenario: 两把锁在同一份 blob 上数出同一条目总数

- **WHEN** 对同一份 `CHANGELOG.md` blob 分别询问两把锁"这里有多少条条目"
- **THEN** 两者报数的条目总数必须相等；不等即为口径分裂，判为缺陷（本仓实测曾为 1,184 与 1,158 并存）

#### Scenario: 无括号形条目不得被任一把锁漏掉

- **WHEN** 台账里存在形如 `# fix(自检门禁): …（#2648）` 的**无方括号前缀**一级标题条目（「无括号形」是本仓历史叫法，指的是**不带 `# [类型]` 方括号前缀**——旧判据 `/^# \[/` 对这种一级标题完全失明，见 `openspec/records/changelog-growth-gate.md`；示例里的圆括号 `(自检门禁)` 与全角括号 `（#2648）` **不是**此处所指的括号）
- **THEN** 两把锁都必须把它算作条目，删除它都必须能被检测到。本条的现状：两把锁已**都** `require` `scripts/changelog-entries.js`（`HEADING_RE` / `splitEntries` / `pickKeeper` 等口径各只有一份实现），所以这条场景测的是"接线仍然在"而非"仍有两套口径要收敛"

### Requirement: 减少副本 MUST 经一次性书面授权，默认判据不得放宽

系统 SHALL 在 `check-changelog-growth.js` 的默认路径上保持「base 标题多重集被 head 包含」这一既有不变量
逐字不变（含「同题副本删到一份仍报丢」这一档）；仅当被检查的 head **相对 base 新增**了
`scripts/changelog-dedup-authorization.json`，且其 `applies_to_base` **等于本次 merge-base**（清理形状）**或为其祖先**（那次清理已落 main ⇒ 授权按**已消费**退休，改核消费后形状——**退休不放宽任何校核**：`titlesReduced == expected_titles_reduced`、`headEntries == expected_entries_after` 与块级形状判据照旧对**当前 base** 成立，`collect` 对两种 granted 走的是同一段下游核对）时，
才 MAY 额外接受「清理形状」，且该接受 MUST 同时满足下列全部条件。

#### Scenario: 无授权文件时行为与现状逐字相同

- **WHEN** 一个 PR 的 head 里没有 `scripts/changelog-dedup-authorization.json`
- **THEN** 门禁判据与本 change 之前完全一致，删除任意一份副本一律报红

#### Scenario: 授权清理形状被接受

- **WHEN** head 新增授权文件且 `applies_to_base` 等于本次 merge-base，并且台账满足：每个被减少的标题在 head 恰好剩 1 份、该份逐字节等于 base 中同标题的某一块、head 的不同标题集合包含 base 的全部不同标题
- **THEN** 门禁通过，并在输出中打印「例外由授权触发」以及被减少的标题数与份数。**本场景只列台账侧三条，完整通过条件还包括**（缺任一条一律 `FAIL(授权)`，不得读成"上面三条过了就过"）：实测的 `titlesReduced` 与 `headEntries` MUST 分别等于授权声明的 `expected_titles_reduced` / `expected_entries_after`；head 独有（base 没有）的标题 MUST 最多 1 份；preamble MUST 逐字节不变；被削减标题的保留份 MUST 是 `pickKeeper` 选的那一份。后三条的判据出处见 `checkDedupShape`，本 change 的 R4 与下一条 Requirement 各覆盖一部分

#### Scenario: 借授权之名改写内容仍须报红

- **WHEN** 授权成立，但某个被保留的块与 base 中同标题的任何一块都不逐字节相同
- **THEN** 门禁报红 —— 授权只覆盖"删重复副本"，不覆盖"顺便改正文"

#### Scenario: 少一个标题即事故，授权也救不了

- **WHEN** 授权成立，但 base 里某个标题在 head 里一份都不剩
- **THEN** 门禁报红（这是 #2884 整份删空形态的兜底，不得被任何例外绕过）

#### Scenario: 只削一半不算清理

- **WHEN** 授权成立，但某个标题从 base 的 4 份变成 head 的 2 份
- **THEN** 门禁报红 —— 例外只承认"削到恰好 1 份"这一种减少方式

#### Scenario: 授权不可被后续 PR 白蹭

- **WHEN** base 里已经存在同名授权文件（即本次 head 并未新增它）
- **THEN** 例外不生效，判据退回默认路径

#### Scenario: 坐标系错位或授权损坏一律 fail closed

- **WHEN** 授权文件的 `applies_to_base` 与本次 merge-base 不相等，或其 JSON 不可解析 / 缺必填字段
- **THEN** 门禁以非零码失败并点名原因，MUST NOT 退化成"当作没有授权"后静默通过

#### Scenario: 坐标系被越过（祖先）不叫错位，改核「消费后形状」

- **WHEN** 授权仍是 head 相对 base 的新增，其 `applies_to_base` 与本次 merge-base **不相等**，但**是**本次 merge-base 的祖先（`git merge-base --is-ancestor` 成立）
- **THEN** 门禁 MUST NOT 报「坐标系错位」，而 MUST 把该授权判为**已消费**（返回值 `{granted:true, retired:true, retiredReason}`，`retiredReason` 里 MUST 含「已消费」，并把两个坐标系 sha 带在文案里。按**实测强度**写清谁被钉住：`scripts/check-changelog-growth-retire.test.js` 第一条锁断言的是 `retiredReason.includes('已消费')`（按真 git 祖先关系 `23822b73` → `f210f191` 构造），两个坐标系 sha 也 MUST 出现在该行输出里，并由 `scripts/check-changelog-growth.test.js` 的退休用例用**夹具仓库**（真 git 祖先关系、非硬编码真仓 sha）逐个断言。该用例同时钉住一条前提：**祖先探测必须走调用方注入的坐标系**——旧实现把 repo root 写死成脚本所在仓，于是退休分支在单元层根本无法到达（临时仓 sha 在真仓不存在 ⇒ 恒判「坐标系错位」），CI 侧只是侥幸同仓才对得上（变异 M2 实测：把 root 写死回去，该锁立刻点名红）。该文件共 5 条锁，覆盖：祖先⇒`granted+retired`、非祖先⇒维持坐标错位 fatal、base 已存在同名授权⇒维持防白蹭 fatal、同坐标⇒`granted` 且 MUST NOT 标 `retired`，以及「额度数字对不上时仍在下游卡」——注意最后这条**只钉到 `evaluateAuthorization` 层放行**（其用例名暗示下游 fatal，实际断言是 `granted:true`，下游 fatal 由同坐标通路共享的那组 collect 级用例覆盖，不是退休路径专属））；随后照旧走同一段额度与形状校核，因此退休分支**不会**让后续 PR 白蹭一份旧授权（它的实际作用是把"误导性的坐标错位红"换成"如实的数字不符红"）；此后新增条目只能经正常追加进入台账，不得借退休复活已被清掉的副本（PR #3151 落地）。**退休形态必须可区分**：`collect` MUST 把 `retired` 与 `retiredReason` 带进结果对象（`--json` 下机读可分），且 stdout MUST **单独成行**打出「授权坐标系已消费退休」——不得拼在「例外由授权触发…」那一行的尾巴上，CI 日志按行 grep，混在一行等于没出声（动因：本仓一度是两种 granted 形态在输出上逐字相同，人无法归因）

### Requirement: 清理结果 MUST 由一个独立对账器核对，且核对的是「块」而非「行」

系统 SHALL 提供 `scripts/changelog-dedup-reconcile.js`，以 base/head 两个 blob 为输入，独立核对**六条**与顺序无关的性质：A1「标题守恒——base 里每个标题在 head 至少还剩一份、head 独有标题最多一份、已有标题的副本数不得变多」（它没有专属场景，因为三种失效形态都被下面场景 1 的两个等式子集化），A2「逐字节同源」、A3「留的是 `pickKeeper` 那份」、A4「幂等」、A5「每标题恰好一块且标题集闭合」五块级性质 + **A6「第一条标题之前的 preamble 逐字节不变」**——A6 由 QM-6 后端 MAJOR-3 补上，动因是"块级判据看得见条目、看不见文件头"；它与授权通路的 `checkDedupShape` 里那条 preamble 校核**是同一处审查发现的两处落点**，两条通路各自 fail-closed，文案不同但判据同向），
并 MUST NOT 复用产生清理的那个脚本（`--dedup`）自己的结论来充当证据。
判据层面必须承认：去重会把幸存块挪到该标题首次出现的槽位，因此**行级** `+/-` 必然包含重排噪声，
把"新增行为 0"写成判据是错的（第一版就是这么写的，并被真实数据当场判红）。

#### Scenario: 每标题恰好一块且标题集闭合

- **WHEN** 对清理结果跑独立对账
- **THEN** 必须满足 `head 块数 == head 标题数`，且 `head 标题数 == base 标题数 + 本次新增标题数`

#### Scenario: 保留块逐字节可溯且必须是 pickKeeper 选定的那份

- **WHEN** 对账器检查 head 里的每一个块
- **THEN** 该块必须与 base 中同标题的某一块**在原始字节上完全相等**（不得是"剥掉 CR 后相等"），且当该标题**被削减到恰好 1 份**时（`base 份数 > 1 ∧ head 份数 == 1`），留下的那一份必须就是 `pickKeeper` 会选定的那一份。两个边界必须写出来，否则这条判据会被读成无条件适用：① A3 **不**对"未削减、head 仍多份并存"的标题生效——拿 `pickKeeper` 去要求每一份会把"什么都没清理"误报成"留错了份"（代码注释记为实测踩过）；② 对被削减的标题，A3 在逻辑上**蕴含** A2（`pickKeeper` 选的那份本身就是 base 的一块），A2 保留不是为了更强而是为了报错可读——"与 base 任何一份都不逐字节相同"比"留下的不是选定那份"更贴近人真正做的事，因此变异反证不能拿"保留份被改写过"当 A2 的隔离用例（A3 会先兜住），它唯一能隔离 A2 的样本是"只差一个 CR"那条

#### Scenario: 幂等

- **WHEN** 对已经清理过的文本再跑一次去重
- **THEN** 必须报告 `removed=0`

#### Scenario: 行级规模只作信息打印

- **WHEN** 对账器输出结果
- **THEN** 必须打印 `added_lines` / `deleted_lines` / 字节变化，但它们**不参与**通过与否的判定；被判定的是 A1–A6（本 Requirement 上面各场景分别覆盖 A5、A2+A3、A4；A1 无专属场景、A6 见本 Requirement 正文）

#### Scenario: 取数失败不得读成"没问题"

- **WHEN** base 或 head 的 blob 读不出来，或其中一方**一条条目都没有**
- **THEN** 对账器必须以非零码失败并点名，MUST NOT 把"零条目"当成"零丢失"通过

### Requirement: 一次性授权 MUST 有生命周期，不得作为常驻文件留在仓库

系统 SHALL 由 `scripts/check-changelog-growth.test.js` 内的生命周期锁守住授权件的**存在形态**。判据 MUST 取
**base ∧ head**（两侧清单同时成立才算违规），MUST NOT 写成「任何地方存在就红」——后者会把自己提示语推荐的
修复路径（退役 PR：base 有 / head 无）一起打红，使通路代码还在而流程层已死。两条清单 MUST 取自 git
（`git ls-files` 与 `git ls-tree -r --name-only <base>`），不是工作树，且各带规模下界断言，防解析退化成空集合造成恒真。
base 坐标系可用 `MP_CHANGELOG_BASE_REF` 注入（反证与本地复现用）；取不到 MUST 当场红，MUST NOT 读成「没有 base」放行。

#### Scenario: 已落 main 还被继续携带即红

- **WHEN** **本次判据坐标系**（CI 用的 `git merge-base HEAD origin/main`，可用 `MP_CHANGELOG_BASE_REF` 注入以便反证与本地复现——**不是** `origin/main` 本身）的清单里有 `changelog-dedup-authorization*.json`，head 的 tracked 清单里也有
- **THEN** 锁点名红并给出两种出路（本次 PR 删掉它 / 或确认正在借一份已消费的授权混过门禁）

#### Scenario: 退役 PR 形态必须放行

- **WHEN** base 有、head 无（即本次 PR 正在删除它）
- **THEN** 锁 MUST 通过 —— 这条是锁自己的恢复路径，不是漏洞

#### Scenario: 未来合规的一次性新增必须放行

- **WHEN** base 无、head 有规范路径那一份（未来某次清理在同一 PR 内用 `changelog-dedup-regen.js` 现生成）
- **THEN** 锁 MUST 通过，豁免通路在流程层仍然可用

#### Scenario: 改名或换目录不放行

- **WHEN** head 清单里的授权件路径不等于规范常量 `AUTH_PATH`
- **THEN** 锁红。判据按 `assert.deepEqual(atHead, [AUTH_PATH])` 实现——**与实现保持逐字一致，不改成"仅含一项且等于 AUTH_PATH"这种更宽的写法**：head 里只要出现规范路径之外的任何一个授权件形态（改名、换目录、或同时并存多份）就红，这是刻意的 fail-closed，宽松写法会把"并存两份"这种明显异常读成合规

#### Scenario: 退的是授权件，不是通路

- **WHEN** 有人为了消除上一条的红而删掉 `AUTH_PATH` 常量、`changelog-dedup-regen.js` 的 `regenerate` 或门禁的 `evaluateAuthorization` / `checkDedupShape`
- **THEN** 另一条锁 MUST 红（断言四样仍在且 `regen.AUTH_PATH === AUTH_PATH`）—— 把门禁拆掉不算修门禁

