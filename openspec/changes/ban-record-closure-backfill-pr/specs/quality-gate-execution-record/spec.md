# Spec 增量（quality-gate-execution-record）

> 写成 **ADDED** 而不是 MODIFIED，理由与 `enforce-gate-record-presence` / `gate-record-sync-derived-status` 同条纪律：`MODIFIED` 需要复述被改 Requirement 的全文，而复述就是第二份真相。本条与既有条目的关系是**补一条独立判据**（"合并后不得把收口行改写成闭合词"），不是修改既有条目（"合并前不得预写证据"）。两条各守一段时间轴：本条守合并后，既有条守合并前。
>
> 附带一个刻意选择的后果：本 change **不改** `openspec/specs/openspec-integration/spec.md`，因此不触发那份规格的 vendored 契约镜像同步（镜像只镜像 openspec-integration）。若日后判定必须把本条并入那条 Requirement，那是**另一个动作**，必须同 PR 同步 `.quality-rhythm/integrations/openspec/spec-contract.md` 并本机复跑镜像锁。

## ADDED Requirements

### Requirement: 收口行被人工改写为闭合词时判红，唯一正解是交给推导

系统 SHALL 强制「`远程同步` 收口不再由人写」这条约束：在本次变更集里，任一篇 `openspec/records/*.md` 的 `| 远程同步 |` 行**从非闭合状态被改成闭合词**（词表 `PASS` / `N/A` / `✅` / `已…` 与既有 Gate 2c 同源，MUST 复用同一份实现）时，判据 MUST 判红并点名该文件。

理由：该行的收口结论已由 `scripts/lib/merge-ledger.js` 按主干历史推导得出，人工改写**不改变判定**，只重新制造"合并后必须再开一次 PR"这个已被取消的结构性成本。实测禁令写入主干后 4 小时内仍有 4 笔此类 PR 合入，成因是并发会话的工作树带着旧口径分支——因此这条 MUST 是机械拦截，MUST NOT 只靠文档与记忆。

三条豁免缺一不可：

1. **迁移方向不拦**：把该行改成派生标记（`由门禁推导`）MUST NOT 判红——那是本机制鼓励的唯一正确改写方向；把锁设在这条路上会逼使用者绕过锁，一条逼绕行的判据比没有判据更糟。
2. **保持不动不拦**：本次 diff 未触碰该行即不参与判定；MUST NOT 因某篇历史记录曾手写闭合词而判红（存量 36 篇原样保留，只能随各自下次自然改动收敛）。
3. **旧载体不在扫描域**：`.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json` 里**已存在**的历史行仍允许就地改写并同次销账——关闭旧账只有这条通道，封掉等于把旧账永远钉红。

判定域 MUST 是「`listRecordFiles` 的结果」∩「本次 diff 触碰的记录文件」，配对 MUST 在**同一文件内**完成（一篇记录只应有一行 `远程同步`，重复行由既有判据拦截），MUST NOT 要求行号对齐。取 diff MUST 用 merge-base 三点式（`base...head`）且 MUST `--unified=0`：两点式会把**别人在 base 之后合入的改写**算进本 PR 的红集，带上下文会让邻行被吸入造成误配。

**取不到读数时 MUST 按未证实处理，MUST NOT 读成"没有回填"**：`baseRef`/`headRef` 不可解析、`git diff` 失败、diff 为空但文件集非空，三种形态都要出声打印原因；CI 档 MUST 非零退出（判据停用不是通过），本机档 MUST 只出声不拦（浅克隆与无 `origin/main` 的本地克隆是合法使用形态）。两档各配独立用例，使"把不可用做成跳过"与"把不可用做成判红"各自指名变红。

红文案 MUST 给出不需要绕行的正解：不动那一行；要清理旧文案就改成派生标记；main push 回读的证据写在 **PR 评论**里而不是写回仓库文件（merge SHA 只在合并后存在，把它的读数要求落进文件会重新造出同一个循环依赖）。

#### Scenario: 合并后手写 PASS 判红

- **WHEN** 某篇记录的 `| 远程同步 | PENDING |` 在本次 diff 中被改成 `| 远程同步 | PASS | <merge SHA> |`
- **THEN** 判据判红并点名该文件，文案写明该行现由主干历史推导、不需要人工改写

#### Scenario: 改成派生标记不红

- **WHEN** 同一行被改成 `| 远程同步 | 由门禁推导 | …`
- **THEN** MUST NOT 判红；这是本机制鼓励的唯一正确改写方向

#### Scenario: 别人合入的改写不得算到我头上

- **WHEN** merge-base 之后有另一个 PR 把**另一篇**记录的该行改成闭合词，而本 PR 只改自己那篇
- **THEN** 本 PR 的红集 MUST 只含自己那篇（若自己那篇未做该跃迁则为空）；该断言 MUST 由构造出"base 之后另有合入"的夹具证明，MUST NOT 由推理放行

#### Scenario: 旧载体销账通道保持可走

- **WHEN** 一个 PR 就地改写 `.quality-gates.md` 里已存在的历史行并同次删除 ledger 登记项
- **THEN** MUST NOT 因本判据判红；若同一 PR 又顺手把某篇新记录的收口行改成闭合词，则红文案 MUST 点名那一篇，让合法部分可被拆出

#### Scenario: 取不到读数不得判绿

- **WHEN** CI 档下 `baseRef` 或 `headRef` 解析失败、或 `git diff` 报错
- **THEN** MUST 非零退出并打印未证实原因；本机档 MUST 只出声不拦
- **AND** 两档各有一条独立用例，实现把"不可用"做成"跳过检查"时 MUST 指名变红

#### Scenario: 打印且阻断

- **WHEN** 本判据产出红项
- **THEN** 结论 MUST 同时出现在打印面与 `hasBlocking` 出口；只打印不参与判定的形态 MUST 被用例拦下
