# gate-record-carrier-freeze

## Purpose

规定「旧载体 `.quality-gates.md` 作为只读存档」的判据形态：什么算漂移、什么算合法关账、基线从哪来、读不到基线时必须怎样。目标是让"每个 PR 都要挤一次全仓共用追加型文件"这件事从惯例变成**机械不可行**，同时不把历史欠账的关闭通道一起封掉。

## ADDED Requirements

### Requirement: 旧载体的记录块集合必须等于冻结基线

系统 SHALL 以 `scripts/gate-carrier-freeze.json`（排序后标题的 sha256 + 条数）为基线，在门禁中比对 `.quality-gates.md` 当前记录块集合：**加块与删块皆判红**，输出逐条点名的 added / removed 与一条合法出路（改写进 `openspec/records/<分支名>.md`）。基线 MUST 由脚本 `scripts/freeze-gate-carrier.js` 生成，标题口径 MUST 复用判据自身的规范化实现（禁止生成器与判据两套切法）。

#### Scenario: 新 PR 往旧载体顶部加一块

- **WHEN** 提交在 `.quality-gates.md` 里新增一个记录块
- **THEN** 门禁必须判红，点名该块标题，并给出"改写进 `openspec/records/`"的出路；仅打印不拦截 MUST 被测试当场抓住（判据降级为只打印时 `hasBlocking` 断言变红）

#### Scenario: 只就地改写已有块的状态行

- **WHEN** 提交只把某个既有记录块里的 `| 远程同步 | PENDING | … |` 改成 `PASS` + merge SHA，未增删任何块
- **THEN** MUST NOT 报漂移。理由必须可验证：ledger 现存 25 条未收口欠账多为 2026-08 老记录、只存在于旧载体，封掉这条路等于把旧账永远钉红

#### Scenario: 冻结判据按档落点

- **WHEN** 同一次运行处于 `pull_request` 事件（GitHub 检出 `main ⊕ 本分支` 的合并预览，其中含主干在基线之后新增的记录块）
- **THEN** 状态-等于-基线判据 MUST 降为可见项并说明"这不是有人违规"；MUST NOT 因上游新增块阻断该 PR
- **AND** 处于 main push / dispatch 档时 MUST 按严格相等阻断；`--carrier-mode` 取非法值或裸旗标 MUST 当场抛错，**不得静默回落**

#### Scenario: 净零漂移（加一块同时删一块）

- **WHEN** 记录块条数不变但标题集合改变
- **THEN** 仍 MUST 判红（哈希不等），且 added 与 removed 两个清单同时非空——此为已知代价，MUST 在 design 里写明"需人读"，不得声称能自动定位肇事提交

### Requirement: 基线不得有"读不到就当没漂移"这条路

判据 MUST 在基线文件缺失或字段不合法（`headingCount <= 0` 或缺 `headingSha256`）时**抛错**，SHALL NOT 静默跳过、SHALL NOT 以"零条待比对"判通过。基线 MUST 由调用方**注入**给判据函数，仅 CLI 入口允许读生产文件。

#### Scenario: 浅克隆环境取不到历史 commit

- **WHEN** CI 上无法访问"冻结那一刻"的 commit
- **THEN** 判据仍必须正常工作——这正是基线入库为数据文件、而不用 `git show <sha>:` 现算的理由；实现 MUST NOT 依赖 git 历史可达性

#### Scenario: 夹具不得静流量到生产基线

- **WHEN** 测试用临时目录调用判据函数且不注入基线
- **THEN** 该调用 MUST 不参与漂移判定（返回不报漂移），且 MUST 有一条用例断言这一行为——否则"给了夹具目录却读真仓状态"会成为假绿通道

### Requirement: 顶部记录棘轮退役后必须保留可见性与新载体的等价强度

「最顶部那篇执行记录必须带 `远程同步` 行」SHALL 从拦截面移入可见面，且旧的 `❌ 最顶部…` 打印 MUST 一并删除（不拦截却打 `❌` 会把读者引向不存在的失败）。"哪篇是最新的"SHALL 由记录文件源的逐篇硬判据承担：整块缺行与两形态矛盾 MUST 留在拦截面上。

#### Scenario: 顶部记录缺行

- **WHEN** 旧载体最顶部的记录块没有 `远程同步` 行
- **THEN** 门禁 MUST 打可见项、MUST NOT 判红，且不得再出现 `❌ 最顶部` 字样

#### Scenario: 记录文件缺行或两形态矛盾

- **WHEN** `openspec/records/` 里某篇整块没有状态行，或表行已 `PASS` 而同篇 bullet 仍写未收口
- **THEN** 两种情形 MUST 都判红（这是顶部棘轮退役后"最新一篇一定有行"的等价保障）

#### Scenario: 真仓自检不得因识别退化而假绿

- **WHEN** 对真实仓库跑冻结自检
- **THEN** MUST 同时断言识别到的记录块数超过规模下界（实测 613，下界 500），否则"解析退化 → 集合为空 → 零漂移"会读起来像通过
