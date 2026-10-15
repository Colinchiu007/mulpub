---
record: ccg-explicit-mode
task: 把 diff 区间接进 CCG 判定器 —— 补完「带显式路径补跑」时模式判定静默不执行
date: 2026-10-15
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
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

新增 5 条测试（`ccg-review-decider.test.js`：11 → **16**）：

| # | 测试 | 变红于 |
| --- | --- | --- |
| 12 | `collectRange` 真实覆盖：判的是 `base...HEAD` 那批改动，且能读到变更行 | **M1** |
| 13 | 三点语义：base 之后主干自己的改动不得算进本次 | **M1** |
| 14 | `--base` 不存在时必须说「未判定」，不得说「暂存区无变更，跳过审查模式判定」 | — |
| 15 | 空暂存区且无 `--base` 时，必须点明「这不是无需审查，是没判」并给补救命令 | — |
| 16 | **接线锁**：带显式路径补跑时 gate 必须把 `--base` 传下去（断言效果） | **M2** |

| 变异 | 施加内容 | 结果 |
| --- | --- | --- |
| **M1** | `collectRange` 退化为 `collectStaged()`（base 被忽略） | **not ok 12 / 13**（16 连带）⇒ 3 红 |
| **M2** | 摘掉 `deciderArgs.push("--base", candidate)` | **not ok 16** ⇒ 1 红 |
| 基线 | — | **16/16 全绿** |
| 还原后复验 | — | **16/16 全绿** |

变异脚本落在仓库外（`D:\Temp\mut-r2.cjs`），**行尾无关**：先归一为 LF 匹配、再按原文行尾写回
（第一版按 LF 拼目标串，而工作区当时是 CRLF ⇒ 两处目标都「0 次命中」，脚本**拒绝盲改**）。

**同场修掉的工具坑（值得记账）**：用 PowerShell `Set-Content -Encoding utf8` 还原文件，
在 PS 5.1 下会把文件写成带 BOM / 换行的形态；本轮实测把 3 个文件**全量转成 CRLF**
（`CRLF=625 / 总LF=625`）。已用 `[System.IO.File]::WriteAllText` + 显式 LF 归一，
并复验 **BOM=False / CRLF=0 / 两口径 numstat 一致**。
注：本机 `text=auto` + `core.eol=native` ⇒ **全新检出本来就是 CRLF**，而**入库 blob 恒为 LF**
（已验 `HEAD:scripts/ccg-gate.js` 无 CR）—— 所以两种工作区形态都不影响仓库内容。

## 五、保留门禁

| 项 | 结果 |
| --- | --- |
| `ccg-review-decider.test.js` | **16/16** |
| `check-pr-exec-record.test.js` | **48/48** |
| `ccg-bash-entry.test.js` | **9/9** |
| `node --check`（3 个文件） | 全部 exit=0 |
| `check-unwired-tests.js` | exit=0 |
| `check-gate-record-debt.js` | exit=0 |
| 行尾/编码对账 | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **一致** |
| 品牌残留 | PASS |
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：decider 16/16 ✅ | exec-record 48/48 ✅ | bash-entry 9/9 ✅ | 变异反证 M1+M2 均实测变红 ✅ | 行尾对账 ✅ | unwired ✅ | 债务熔断 ✅ | 品牌 ✅ | 远程同步 PENDING

## 五之二、深度审查（DUAL，判定理由：变更 354 行 > 200 行阈值）

## 六、残余（未闭合，不假装）

| # | 项 | 说明 |
| --- | --- | --- |
| R1 | gate 的 base 候选只有 `origin/main` / `main` | 默认分支是 `master` 的仓库取不到 base。此时**出声告警并保持未判定**（fail-closed），补救靠 `CCG_DECIDER_BASE`。是否自动补 `master` 属产品判断，本轮不做 |
| R2 | `--base` 只覆盖「验证层」 | 决策层（`--input` 方案文件）不受影响，本来就不读 diff |
| R3 | 上一 PR 的残余 1–9 仍在 | 见 `openspec/records/fix-ccg-decider-defects.md`；其中残余 9（记录名 = 父 sha）已开 **issue #3643** |
