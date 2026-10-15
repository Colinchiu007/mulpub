---
record: ccg-explicit-mode
task: 把 diff 区间接进 CCG 判定器 —— 补完「带显式路径补跑」时模式判定静默不执行
date: 2026-10-15
---

## 本次执行记录：补完缺陷 C 的另一半（ccg-explicit-mode，2026-10-15）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 含 `scripts/`
  ⇒ **混合 PR**，走完整质量节拍。
- decider 判定：**DUAL**（`变更 354 行 > 200 行阈值`）⇒ 必须双模型深度审查。

## 一、缺陷陈述（为什么这不是新扩张，而是 C 的另一半）

上一个 PR（#3640，已合并 `5952d38c2`）修了**缺陷 C**：`ccg-gate.js` 原来忽略位置参数，
写错门禁名（typo）会被当「幽灵路径」静默放行。修完之后门禁**能对显式路径执行**了。

但那条链上还有一半没修——**模式判定仍读暂存区**：

| 取证点 | 事实 |
| --- | --- |
| `scripts/ccg-gate.js:337`（修前） | `spawnSync(process.execPath, [decider], …)` —— **一个参数都不传** |
| `scripts/ccg-review-decider.js:471-474`（修前） | 暂存区为空 → 打印「暂存区无变更，跳过审查模式判定」→ `return 0` |
| 补跑时的实际状态 | 改动**已进 commit**，index 通常是空的 |

⇒ 事后补跑（`node scripts/ccg-gate.js verify-quality <file>`）时：
门禁对文件跑了，**而「需不需要 CCG 审查」这个判据从未执行**，
输出「暂存区无变更，跳过审查模式判定」**读起来像「无需审查」**。

这与缺陷 D/F/G 同类：**判据静默不执行，而输出读起来像「不需要」**。

## 二、修法（三处）

### 2.1 decider：抽出 `collectFromDiff`，新增 `collectRange(base)`

解析逻辑**一行未改**，只把两条 git 命令变成参数（`collectStaged` = `--cached`，
`collectRange(base)` = `${base}...HEAD`）。切段 / 重命名解析 / 读取缺口记账全部复用同一套。

**为什么三点 `base...HEAD` 而不是两点**：两点会把 base 之后主干自己的改动也算进来，
判出的规模虚高。三点与 PR 的 diff 语义一致，并有测试锁定（见 §4 测试 13）。

### 2.2 decider `main()`：支持 `--base`，并把「未判定」说出来

三种「拿不到输入」的情形原来都打印**读起来像「无需审查」**的话，现在统称 **「未判定」**
并给出补救命令（仍然是 `return 0`，不阻断提交 —— pre-commit 阶段暂存区为空是常态，
把它变成红会误伤所有提交）：

| 情形 | 修前措辞 | 修后措辞 |
| --- | --- | --- |
| 读不到暂存区 | 「判定器无法读取 git 暂存区，跳过（不影响提交）」 | 「⚠ 未判定：读不到 git 暂存区…**这≠无需审查**」 |
| 暂存区为空、无 `--base` | 「暂存区无变更，跳过审查模式判定」 | 「⚠ 未判定：**这不是「无需审查」，是「没判」**。补跑：`--base origin/main`」 |
| `--base` 区间为空/取不到 | （不存在此路径） | 「⚠ 未判定：`<base>...HEAD` 为空/读不到…**这≠无需审查**」 |

### 2.3 `ccg-gate.js`：有显式目标时把 `--base` 传下去

base 三级回退：`CCG_DECIDER_BASE` → `origin/main` → `main`。
都取不到时**出声告警**「⇒ **未做审查模式判定**；请用 CCG_DECIDER_BASE=<rev> 指定基准后重跑」
（fail-closed + 可执行补救，不静默）。

### 2.4 顺带修残余 3：decider 加 `require.main` 守卫并导出

原来本文件以无条件的 `process.exit(main());` 结尾且不导出，测试只能
「读源码 → 剥掉末尾那行 → 注入 `module.exports` → `_compile`」。
那种做法**依赖源码文本**：本 PR 正好要改这个结尾（改成 `if (require.main === module)`），
剥离正则不再匹配 —— 幸好当时留了 `assert.notEqual(stripped, src)` 守卫，
否则测试会**静默地**加载一个仍会执行 `main()` 的版本。
现在测试走正路 `require`，两个加载点（主加载 + collectStaged 子进程夹具）都已改。

## 三、★ 本轮最有价值的发现：我自己的锁是假绿的

**第一次写的接线锁断言的是 gate 打印的那行日志**（「审查模式判定基准：」）。
变异 M2（摘掉 `deciderArgs.push("--base", candidate)`）后它**仍然 16/16 全绿** ——
因为那行 `console.log` 与 `push` 是**相邻但无因果**的两条语句，摘掉 push 日志照打。

这与本仓登记的「反证纪律」完全同型：**只证「业务改动变红」不能证明锁在跑；
必须做一次「把锁本身改成 no-op 必须立刻变红」的变异。**

改法：断言**效果**而不是日志 ——
① 输出里必须出现模式判定结论 `审查模式判定 [验证层…]: (SKIP|SINGLE|DUAL)`；
② **不得**出现 `未判定`。
并且夹具要造出**非空区间**的仓库（本工作区 HEAD == origin/main，区间为空时
即使 `--base` 正确传下去也只会打印「未判定」，无法区分真伪）。

夹具还踩了一个坑并已修正：`git init` 在本机默认分支是 **master**，而 gate 的候选是
`origin/main` / `main` ⇒ 永远找不到 base（此时 gate 会**正确地**出声告警并保持未判定）。
夹具改为 `git symbolic-ref HEAD refs/heads/main`。

## 四、测试与变异反证（判据只取产物）

新增 8 条测试（`ccg-review-decider.test.js`：11 → **19**）：其中 12–16 出自本 PR 的首次实现，
**17/18/19 出自深度审查 i1/i3/i6 的处置**。

| # | 测试 | 变红于 | 出自 |
| --- | --- | --- | --- |
| 12 | `collectRange` 真实覆盖：判的是 `base...HEAD` 那批改动，且能读到变更行 | **M1** | 首次实现 |
| 13 | 三点语义：base 之后主干自己的改动不得算进本次 | **M1** | 首次实现 |
| 14 | `--base` 不存在时必须说「未判定」，不得说旧措辞 | **M5** | 首次实现（i4a 修后才可证伪）|
| 15 | 空暂存区且无 `--base` 时，必须点明「这不是无需审查，是没判」并给补救命令 | — | 首次实现 |
| 16 | **接线锁**：带显式路径补跑时 gate 必须把 `--base` 传下去（断言效果） | **M2** | 首次实现 |
| 17 | **i1 锁**：暂存区非空时，带显式目标也必须仍判暂存区 | **M3** | 深度审查 i1 |
| 18 | **i3 锁**：区间为空时提示必须给出**可用**基准 | — | 深度审查 i3 |
| 19 | **i6 锁**：坏 `CCG_DECIDER_BASE` 必须被拒并告警，不得先印基准行 | **M4** | 深度审查 i6 |

| 变异 | 施加内容 | 结果 |
| --- | --- | --- |
| **M1** | `collectRange` 退化为 `collectStaged()`（base 被忽略） | **not ok 12 / 13**（16 连带）|
| **M2** | 摘掉 `deciderArgs.push("--base", candidate)` | **not ok 16** |
| **M3** | 判据退回「只看显式目标」（i1 复现） | **not ok 17** |
| **M4** | 取消 `CCG_DECIDER_BASE` 校验（i6 复现） | **not ok 19** |
| **M5** | 让 decider 重新打印「跳过」（旧措辞回流） | **not ok 14** |
| 基线 / 还原后复验 | — | **19/19 全绿** |

变异脚本落在仓库外（`D:\Temp\mut-r2.cjs` / `mut-r2b.cjs`），**行尾无关**：先归一为 LF 匹配、
再按原文行尾写回（第一版按 LF 拼目标串，而工作区当时是 CRLF ⇒ 两处目标都「0 次命中」，
脚本**拒绝盲改**）。

> **M5 是本轮第二次「假绿锁」教训**：测试 14 原本断「不得出现 `<已删除的旧措辞>`」——
> 那串字在本次提交后已从源码消失 ⇒ 断言**永真**。只给「新加的锁」做变异反证**不足以**发现
> 存量断言的措辞漂移腐化；M5 的作用就是让这条断言重新变成**可证伪**的。

**同场修掉的工具坑（值得记账）**：用 PowerShell `Set-Content -Encoding utf8` 还原文件，
在 PS 5.1 下会把文件写成带 BOM / 换行的形态；本轮实测把 3 个文件**全量转成 CRLF**
（`CRLF=625 / 总LF=625`）。已用 `[System.IO.File]::WriteAllText` + 显式 LF 归一，
并复验 **BOM=False / CRLF=0 / 两口径 numstat 一致**。
注：本机 `text=auto` + `core.eol=native` ⇒ **全新检出本来就是 CRLF**，而**入库 blob 恒为 LF**
（已验 `HEAD:scripts/ccg-gate.js` 无 CR）—— 所以两种工作区形态都不影响仓库内容。

## 五、保留门禁

| 项 | 结果 |
| --- | --- |
| `ccg-review-decider.test.js` | **19/19**（11 → 16 → 19，新增 8 条）|
| `check-pr-exec-record.test.js` | **48/48** |
| `ccg-bash-entry.test.js` | **9/9** |
| 变异反证 | **M1–M5 全部实测变红后还原复绿**（详见 §五之二）|
| `node --check`（3 个文件） | 全部 exit=0 |
| `check-unwired-tests.js` | exit=0 |
| `check-gate-record-debt.js` | exit=0 |
| 行尾/编码对账 | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **一致** |
| 品牌残留 | PASS |
| 深度审查（DUAL） | **已跑**：critique 6 条 → 逐条裁决 **6/6 upheld** → 全部处置（见 §五之二）|
| 远程同步 | PASS | PR #3662 已合并 → `f940edd8380a94dfc973880c85c27d3281f6a40f`（2026-10-16T01:27:08+08:00）；远端分支已删（`git ls-remote --heads origin ccg-explicit-mode` = 0 行）|

- 保留门禁：decider 19/19 ✅ | exec-record 48/48 ✅ | bash-entry 9/9 ✅ | 变异反证 M1–M5 全部实测变红 ✅ | 深度审查已跑并逐条裁决 6/6 ✅ | 行尾对账 ✅ | unwired ✅ | 债务熔断 ✅ | 品牌 ✅ | 远程同步 PASS

## 五之二、深度审查（DUAL）

**判定触发**：`mode=dual`，理由「变更 > 200 行阈值（对齐 §12.6 Red Team）」。
**两次判定的规模不同，因为时点不同（深度审查 i5 要求写明）**：

| 时点 | 范围 | 规模 | 权威引用 |
| --- | --- | --- | --- |
| 写记录前（staged） | 3 个脚本 | **354 行** | — |
| commit 时（pre-commit） | 4 个源文件（多出本次新增的记录文件等） | **380 行** | `.ccg/reviews/0da7f0dc6….json` |

> 以 `.ccg` 判定记录为权威；354 那次是同一批改动的早期时点。**不是矛盾，是两个时点。**

**执行**：`sh scripts/deep-review.sh` → critic=claude 出 **6 条 finding**；
维度分 correctness 4 / security 8 / performance 9 / maintainability 7，最低分 4（无高危域）；
收敛判为 `self_play` → 引擎第三档**自扮演裁决** → 状态 `self_play_pending`。

**裁决（`.adversarial/ccg-deep-f993602e/adjudication.json`）**：
`adjudicatedBy: agent-adjudication`，**6 条逐条填 prosecution / defense / verdict / rationale**。
**★ 引擎侧终审 verdict 未取得 —— 不得据此声称已获引擎裁定。**

| finding | 严重度 | 裁决 | 处置 |
| --- | --- | --- | --- |
| i1 显式目标 ⇒ 无条件传 `--base`，漏掉已暂存的改动（**回归**） | Critical | **upheld** | 判据改为「**暂存区是否为空**」；锁：测试 17 + 变异 M3 |
| i2 DUAL 审查未跑就把记录留空段 | Warning | **upheld** | 本节即在 PR 内补齐；且门禁当场拦下（见下） |
| i3 空区间的补救示例是不可用的基准 | Warning | **upheld** | 列两个子情形 + 各自可用的基准 + 打印 HEAD/base 短 sha；锁：测试 18 |
| i4a 测试 14 的负向断言断的是**已删除的旧措辞 ⇒ 永真、形同虚设** | Info | **upheld** | 改断「跳过」；**变异 M5 证明它现在可证伪** |
| i4b 未覆盖「pre-commit + 暂存」形态 | Info | **upheld** | 已由测试 17 覆盖 |
| i5 记录 354 行 / .ccg 380 行，未写时点 | Info | **upheld** | 见上方两次判定表 |
| i6 `CCG_DECIDER_BASE` 未校验即当候选 ⇒ 输出自相矛盾 | Info | **upheld** | 先 `rev-parse` 校验，无效则点名忽略且不印基准行；锁：测试 19 + 变异 M4 |

**i4a 值得单独记账**：那是一条**我自己刚写的、还专门做过变异反证的测试文件里**的**永真断言** ——
说明「只给**新加的锁**做变异反证」不够，**存量断言的措辞漂移会静默腐化**。

**i2 的闭环值得单独记账**：拦下「记录不完整」的，正是**上一个 PR 修好的缺陷 D 门禁**
（现场输出：`mode=dual，status=pending` ⇒ 「不通过：1 条理由」⇒ 提示补跑 deep-review.sh）。
若那处没修，这次就会带着空段合入。

**本轮变异反证共 5 次，全部实测变红后还原复绿**：

| 变异 | 施加内容 | 结果 |
| --- | --- | --- |
| M1 | `collectRange` 退化为 `collectStaged()` | not ok **12 / 13**（16 连带）|
| M2 | gate 不传 `--base` | not ok **16** |
| M3 | 判据退回「只看显式目标」（i1 复现）| not ok **17** |
| M4 | 取消 `CCG_DECIDER_BASE` 校验（i6 复现）| not ok **19** |
| M5 | 让 decider 重新打印「跳过」（旧措辞回流）| not ok **14**（证明该断言已可证伪）|
| 基线 / 还原后 | — | 均 **19/19** |

## 六、残余（未闭合，不假装）

| # | 项 | 说明 |
| --- | --- | --- |
| R1 | gate 的 base 候选只有 `origin/main` / `main` | 默认分支是 `master` 的仓库取不到 base。此时**出声告警并保持未判定**（fail-closed），补救靠 `CCG_DECIDER_BASE`（深度审查 i6 后该 env **已加 rev-parse 校验**，坏值会被点名拒绝）。是否自动补 `master` 属产品判断，本轮不做 |
| R2 | `--base` 只覆盖「验证层」 | 决策层（`--input` 方案文件）不受影响，本来就不读 diff |
| R3 | 上一 PR 的残余 1–9 仍在 | 见 `openspec/records/fix-ccg-decider-defects.md`；其中残余 9（记录名 = 父 sha）已开 **issue #3643** |
| R4 | 深度审查的**引擎侧终审未取得** | critique 6 条由 agent 逐条裁决（`adjudicatedBy: agent-adjudication`），第三档自扮演出口。**不得**据此声称已获引擎裁定；若要换更强的结论，须再跑一次并拿到引擎 verdict |
| R5 | 「存量断言措辞漂移」无机械防护 | 测试 14 的永真断言是**人（deep review）发现的**，不是门禁发现的。是否给测试断言的**可证伪性**加一条机械检查（例如：负向断言的目标串必须仍出现在被测源码里）——属新机制，本轮不做 |
