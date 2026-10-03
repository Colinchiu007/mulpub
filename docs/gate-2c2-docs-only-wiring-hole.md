# Gate 2c2 的接线位置：吃白名单输入的门禁不能住在被短路的 job

对应 issue #2745，落地 PR 见本文件末尾「复跑命令」。记录载体 `openspec/records/fix-gate-2c2-docs-only-hole.md`。

## 1. 症状（在合并前是看不见的）

`Gate 2c2 - Execution-record presence` 每次 quality-gate 运行都"通过"。它对 docs-only PR **一次都没有执行过**，
而 docs-only PR 恰是"整篇没写执行记录"最高发的一类。

判据不是被写坏了，是被短路了：

- 它校验的输入是 `openspec/records/**`（执行记录）与 `openspec/records/_exempt/**`（带原因的豁免）；
- 这两个路径命中 `scripts/classify-docs-only.js` 的 `CI_IGNORED_PATHS` 里的 `openspec/**`
  （实测 `isDocsOnly(['openspec/records/some-branch.md']) === true`）；
- 判纯文档的 PR 会跳过 `if: needs.changes.outputs.docs-only != 'true'` 门控的重型 job，
  而 Gate 2c2 原本就住在 `static-gates` 里。

短路真实发生过，不是推演：PR #2732 判 `docs-only=true`，rollup 里 `QG Static` 与另 10 个重型 job 全部
SKIPPED，且照样合并（required check 由 skipped 满足）。

## 2. 为什么这是机制问题，不是某次疏忽

docs-only 快速通道的成立前提写在 AGENTS.md 与 openspec 规格里：

> 进白名单的路径，它自己的校验门禁必须先接线到不会被 docs-only 短路的 job。

第一个落点是 `scripts/gate-record-debt-ledger.json`（PR #2718）——它当初也住在 `static-gates` 里，
修法是**先把门禁搬进 `changes` job、再放开白名单**。Gate 2c2 是同一形态的第二个落点，
而且那条前提锁当时是"账本 JSON 专用"的，所以泛化不到新来的数据文件。

## 3. 修法（两处同时动，缺一处就还是洞）

| 位置 | 改动 |
|------|------|
| `.github/workflows/quality-gate.yml` | Gate 2c2 两条命令从 `static-gates` 搬到 `changes` job，插在 `Detect docs-only changes`（含非 PR 早退 `exit 0`）**之前**；原处只留指针注释，接线保持**只有一处真源** |
| `scripts/classify-docs-only.test.js` | 把 #2718 的专用前提锁泛化成 `(白名单路径 → 门禁命令)` 清单：新增 `openspec/**` 一项，每项仍要求"命令出现在 changes job 正文且早于早退"；清单只能扩大，任何一项退化为空白即红 |

放在早退之前，是为了让 main push 那一档同样覆盖（push 事件 `EXEC_BASE` 为空，脚本自己走
"非 PR 事件不适用"分支，不会把每个 push run 判红）。

## 4. 记录判据的同步放宽（#2745 末尾那条口径漂移）

原判据只认 `A`（新增）`openspec/records/<分支名>.md`。实测 origin/main first-parent 120 个提交里
59 个纯文档 PR，其中按旧判据"没写记录"的 45 个中：**31 个写的是历史载体 `.quality-gates.md`**、
5 个修订的是自己那篇 `openspec/records/*.md`、9 个交了 `_exempt`；真正**任何记录源都没有**的是 14 个。

所以本次只按**分支名**这一维放宽：`M` 掉 `openspec/records/<本分支名>.md` 视为携带记录
（回填/修订是同一条记录的正常演进）；`M` 别人的记录仍不算；矛盾判定（同分支既交记录又交豁免）同步跟上，
输出里的出路从两条改为三条。

## 5. 明确未做：转阻断

`--mode=advisory` 保留。issue 自己要求"搬接线与转阻断必须同 PR"，但按实测影响面直接转阻断会把上面
14/59 这一类（含并发会话的在途形态）当场拦红，且 31 个历史 PR 走的是旧载体。
**转阻断的硬前提**：① 14 这个数有归属清单（谁在没写记录）；② 旧载体 `.quality-gates.md` 的去留有明确结论。
这两条没做之前，删掉 `--mode=advisory` 等于把一个"看着拦、实际靠不住"的判据登记为已阻断。

## 6. 反证（9 条，全部实跑）

驱动 `D:/tmp/mp-g2c2-mutate.js`（会话临时，不入库）。每条：备份 → 改一处 → 跑
`node --test scripts/check-pr-exec-record.test.js scripts/classify-docs-only.test.js` →
断言 rc≠0 **且**预期那条测试红 **且**红因文本含预期子串 → 还原 → 断言与备份逐字节相同。

| 变异 | 结果 |
|------|------|
| M1 changes job 里命令名改错 | RED「一处真源」 |
| M2 用结构 apply 函数把步骤真搬回 classify 之前 | RED「必须在 classify 步骤之后」 |
| M3 摘掉 `--mode=advisory` | RED |
| M4 `EXEC_BASE` 不再取 PR base | RED「PR base」 |
| M5 摘掉 `--head-branch` 注入（detached 又当分支名用） | RED「head-branch」 |
| M6 `submitted` 退回只认 A | RED |
| M7 放宽过头（任意 M 记录都算） | RED「改别人的记录不等于自己写了记录」 |
| M8 摘掉保留名守卫 | RED（红因点名 `openspec/records/_TEMPLATE.md`） |
| M9 `headBranch` 退回 `gitBranch` | RED「detached」 |
| M10 把结构锁本身改成 no-op | RED「解析出的 job 数」 |
| M11 给 changes 加 job 级 `if:` | RED「job 级 if」 |
| M12 品牌残留从 changes 摘掉 | RED「出现 0 次」 |
| M13 把真实接线行改成注释 | RED「一处真源」（把"注释掉仍算接线"的假绿形态封死） |
| M14 对账表少登记一项 | RED「不再一一对应」 |

基线（全部还原后）47 tests / 0 failed；四个被变异的文件与备份逐字节相同。
驱动自身两处故障如实记录：初版 M1/M4 用带 `\n` 的多行 find，工作区 CRLF 让它报 `FIND_NOT_FOUND`
（**探针故障不是结论**）；初版 M14 用"删整行"会让测试文件语法炸掉而红错因，改成把 pattern 改瞎。

## 6.5 对账表顺手抓到的第三处（同一形态，已一并修）

把前提锁泛化成「与 `CI_IGNORED_PATHS` 双向对账」之后，`deepEqual` 立刻暴露第三处同型漏洞：

- `Gate 12 - Brand residue`（`scripts/check-no-brand-residue.js`）住在 `static-gates`；
- 而 `*.md`、`01-docs/**`、`docs/**` 全在 docs-only 白名单里；
- AGENTS.md 的 docs-only 快速通道却把「品牌残留」明确列为文档 PR 的**保留门禁**（"一条不省"）。

⇒ 那句承诺在 CI 上不成立。本 PR 把 Gate 12 同样搬进 `changes`：它零第三方依赖
（只 require `child_process/fs/path`），可以在没装 node_modules 的 `changes` job 上跑，
实测 6666 个 tracked 文件 PASS。它原先的消费方契约
`.github/scripts/workflow-contract.test.js` 里「Gate 12 必须在 Gate 11 之后」这条静态次序断言
随迁移改写为位置契约（必须在 changes 正文、不得留在 static-gates）——
这是 AGENTS.md「门禁断言随实现迁移同步」的又一次现场执行，不是把断言删掉。

## 7. 复跑命令

```bash
cd D:/Data/projects/mp-worktrees/mp-fix-gate-2c2-docs-only-hole
node --test scripts/check-pr-exec-record.test.js scripts/classify-docs-only.test.js
node --test .github/scripts/workflow-contract.test.js   # 消费者并集：它也读这份 workflow
node scripts/check-pr-exec-record.js --base="$(git merge-base origin/main HEAD)" --head=HEAD --mode=advisory
node scripts/check-step-failfast.js                      # 新增的多命令 run 步骤必须 shell: bash
```
