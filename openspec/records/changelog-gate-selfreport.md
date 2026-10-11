---
record: changelog-gate-selfreport
task: 让退休授权放行在 CI 输出里可区分，并清掉 changelog 门禁工具链的三处「自述与实际不一致」（含一条让退休分支在单元层无法被测的写死路径）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后按 `git log origin/main --grep='(#NNNN)$'` 取证回填
sync_backfill_owner: 本会话（若被压缩则由下一个会话接手本 slug）
---

## 本次执行记录：changelog 门禁自述与实际一致（changelog-gate-selfreport，2026-10-11）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🔧 配置/工具 + 🧪 测试变更（混合 PR，权威计数由 `classify-docs-only.js --base=origin/main --head=HEAD` 给：**files=12**）＝ `scripts/**` 三个非测试脚本 + 两个测试文件 + 主规格 + 本记录 + CHANGELOG + 四个 QM-6 评审原件（`.ccg/reviews/brief-*` 与 `selfreport-{logic,maint}.json`，本轮起随 PR 入库）⇒ 按 AGENTS.md 必须隔离：`bash scripts/session-init.sh changelog-gate-selfreport` ⇒ `D:/Data/projects/mp-worktrees/mp-changelog-gate-selfreport`，裸分支 `changelog-gate-selfreport`；实证用 `git worktree list`（1 命中）+ `rev-parse --abbrev-ref HEAD` + `rev-list --count HEAD..origin/main` = **0**（对齐 `3a4c70311`），不采信脚本自述 |
| 为什么这一笔（动因） | 已定位 | #3277 归档时 QM-6 抓到两处「规格写了、实现没有」的**已知出声缺口**，当时按纪律没混进归档交付，登记为任务 #29/#30。本 PR 就是那两笔的合并执行 —— 判据本身未动，改的是**自述与可测性** |
| 第一性原因（QM-5 ①） | 已定位到行 | `check-changelog-growth.js:155` `const RETIRE_REPO_ROOT = path.resolve(__dirname, '..')` + `:159` `cwd: RETIRE_REPO_ROOT` —— 这条探测是全模块里**唯一**不走注入 `root`/`git` 的取数点。它不是"CI 上算错"，而是**退休分支根本无法在单元层到达**：夹具仓的 sha 在真仓里不存在 ⇒ `merge-base --is-ancestor` 必失败 ⇒ 恒判「坐标系错位」。写它的人（#3151）当时只能用手写真仓 sha 的夹具绕开，这也是 `check-changelog-growth-retire.test.js` 里那两个硬编码 sha（`23822b73` / `f210f191`）的来源 |
| 逃逸分析（QM-5 ②） | 逐层给因 | ①单元层：`retire.test.js` 五条锁全部只测 `evaluateAuthorization`（纯函数层），**没有一条测 `collect`**，所以"退休进不进返回值/进不进日志"在测试里不可表示；②集成层：无 —— 门禁本体的 CI 现场只看 rc，输出内容没人比对；③审查层：#3277 之前没有任何东西检查「工具自述 vs 实际行为」（reconcile 自称五项而实跑六项、regen 指向已归档路径），因为**没有一条锁去读它们说的话**；④对账层：`grep` 这些字符串看起来"机制在"，实际指向性已经失效 |
| 系统性漏洞（QM-5 ③） | 具体到文件 | 分类=**门禁缺失**。缺的不是测试而是"有一条锁去读自述"：`scripts/changelog-dedup-reconcile.js:152`（OK 行）与 `scripts/changelog-dedup-regen.js:75`（reason 里的路径）此前**零断言** —— 它们错了不会有任何东西变红 |
| 修复 + 回归保护（QM-5 ④） | PASS | ①`evaluateAuthorization` 收 `root`，探测 `cwd: root \|\| RETIRE_REPO_ROOT`（不传时保持旧行为，`retire.test.js` 五条硬编码 sha 的锁不受影响）；`collect` 传 `root: root \|\| process.cwd()`。②结果对象 `authorization` 加 `retired` / `retiredReason`，`main` 在 `a.retired` 时**单独成行**打「授权坐标系已消费退休：…」。③regen 的 reason 指向 `openspec/changes/archive/2026-10-10-dedup-changelog-history/`。④reconcile OK 行列全 A1–A6 并改「六项全过」。锁三条，**全部加在已接线的测试文件里**（不新建测试文件 ⇒ 不触发 `check-unwired-tests` 的接线义务，也不动 workflow）：`check-changelog-growth.test.js` 两条（退休可区分含两个 sha + reason 路径存在性含规模下界）、`check-changelog-duplicate-entries.test.js` 一条（OK 自述覆盖实际性质集合 + 条数一致） |
| 防止再次发生（QM-5 ⑤） | PASS | ①退休锁改用**夹具仓库**造真 git 祖先关系，从此"写死坐标系"这类缺陷会在到达退休分支时当场暴露（M2 实测）；②`implemented` 集合从**源码里真正 `failures.push(\`A…` 的位置**取，不是手写清单 —— 加新性质忘了同步 OK 行会直接红；③主规格 `changelog-ledger-integrity` R2 祖先场景的两处「已知缺口」措辞改为"已被夹具锁钉住"，规格不再描述一个"门禁不说自己做了什么"的世界 |
| TDD 红→绿 | PASS（原始输出留档） | 先写锁：`node --test scripts/check-changelog-growth.test.js scripts/check-changelog-duplicate-entries.test.js` ⇒ `tests 54 / pass 51 / fail 3`，三条各以预期理由红（A6 未列、退休通路报「坐标系错位」、`regen 的 reason 指向不存在的路径 openspec/changes/dedup-changelog-history`）；实现后 ⇒ 同两文件 `54 / 54 / 0`。**红必须是"预期的那三条"**，多一条就是碰到了别人的东西 |
| 变异反证（7 条，全实测） | PASS | M1 摘掉单独成行 + 把 `retired` 写死 false ⇒ 退休锁红；M2 `cwd` 退回写死 ⇒ 同一条锁红（证 root 注入是可测前提）；M3 路径改回归档前 ⇒ regen 锁红；M4 OK 自述退回「五项全过」⇒ 自述锁红；M5 把取集合的正则改成恒空 ⇒ 锁靠**规模下界**红（不退化成恒真）。收尾：`MUTATION_BAD=0`、四个文件与备份 **`Buffer.compare===0` 逐字节相同**、终态 `34/34` + `20/20`。**QM-6 maint 轴另补 M6/M7，并先实测否证了首版锁自身**：M6 = 把退休文案拼回「例外由授权触发」行尾并摘掉独立成行，M7 = 从退休行删掉授权声明方的 sha；两条在首版「对整体输出做子串匹配」的锁上**都 34/34 全绿**（即规格那条 MUST 当时在锁层面根本不可表示），改成按行断言后各自点名变红，终态仍 `34/34`、`git status` 只剩预期的三个文件 |
| 消费者并集（不是只跑 diff 里的文件） | PASS | 对三个被改模块逐个 `git grep -l "require('./<stem>'"` 取并集 ⇒ `check-changelog-growth.test.js` / `check-changelog-growth-retire.test.js` / `check-changelog-duplicate-entries.test.js`，三文件合跑 **59 pass / 0 fail**；另跑门禁本体：`check-changelog-growth.js --base=<merge-base> --head=HEAD` ⇒ 本 PR 的不变量是**差值**而不是绝对值：`head 条目数 == base 条目数 + 本 PR 新增条数(=1)`。绝对值会随每次 re-sync 前进，把它写死进记录就是在制造下一处"自述与实际不一致"（本行在本次 PR 内就动了三次：`386→387` 提交前 / `条目=387` 首版权威行 / **合并 `origin/main`@`942506fe9` 后为 `base 387 → head 388`、`条目=388 去重后应为=388 冗余份数=0 最坏重复=1x`**，均为当场实跑）。差值两侧同数即成立。`check-changelog-duplicate-entries.js` 读工作树、`check-changelog-growth.js` 读两个 blob，两者必须同数 |
| openspec 对账 | PASS | 主规格 `openspec/specs/changelog-ledger-integrity/spec.md` 规模仍 **4 Requirement / 20 Scenario**、行尾保持均匀；`node scripts/check-spec-purpose.js` ⇒ 153 份 / 违规 0；同一门禁以注入 root 的方式对 **pristine `origin/main` 抽出的 `openspec/` 树**独立跑一遍 ⇒ 也是 **153 / 0**（`check({root,minSpecs:0})` 的 `total=153, ok=true, bad=[]`）—— 本 PR 只改一份既有主规格的内容，不新增规格文件，两侧份数必须相等；`openspec validate --all` 本侧与**从 `origin/main` 单独抽出的 pristine 基线**均为 **174 passed / 7 failed / 181 items**，失败集合逐条同名（他人未完成的 change）⇒ 新增失败 0，不认领别人的红 |
| 其余门禁 | PASS | `check-spec-purpose.test.js` + `quality-rhythm-spec-mirror.test.js` ⇒ **31 pass / 0 fail**；`check-unwired-tests.js` ⇒ OK；`check-gate-record-debt.js` ⇒ OK（本记录走新载体三字段，**未**往 ledger 加键）；`check-no-brand-residue.js` ⇒ PASS；`check-step-failfast.js` ⇒ OK；`classify-docs-only.js --base=origin/main --head=HEAD` ⇒ **`docs-only=false`**（动了 `scripts/`）⇒ 混合 PR，按完整门禁走，不借道 |
| 行尾与 diff 对账 | PASS（含一次自纠） | 动手前逐文件实测均匀性（两个测试文件 572/572 与 294/294、三个脚本与 CHANGELOG 均 `lf_only=0 / loneCR=0`）。**实现脚本第一次把 `check-changelog-growth.js` 写成了混行尾**：JS 里 `.replace(/\n/g,'\r\n')` 绑定在拼接的**最后一个字面量**上（`.` 优先级高于 `+`），只有末段转了 CRLF ⇒ 引入 5 行 LF-only，`git diff --numstat` 两口径当场不一致。按"改前实测均匀"这一前提做归一，并断言 `content_unchanged=true`（剥 CR 后逐字相同）与 `lf_only=0` 才继续。**教训**：`--numstat` 两口径对账不是仪式，它是这次唯一抓到混行尾的东西 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/**`、`packages/rpa-engine/**` 与任何前端文件 |
| QM-6 CCG 双模型外部评审 | PASS（两轴均已执行并处置） | 本 PR 改了门禁的**输出与可测性**（未改判据），按 AGENTS.md 属建议执行项且我判定要做——已实际执行两轴并落结论。逻辑/后端轴 `.ccg/reviews/selfreport-logic.json`：1 Warning + 3 Info；可维护性/前端轴 `.ccg/reviews/selfreport-maint.json`：3 Warning + 1 Info，**0 Critical**。**逐条自己取证后的处置**：① 逻辑轴 Warning 的事实部分经逐字回读**否证**（规格第 69 行当场已同时点名两个测试文件并写明「非硬编码真仓 sha」，它读的是我上一版措辞），但其结构信号成立——「该文件共 5 条锁」指代不明，已拆为**函数层 5 条 / collect 层 1 条**并写清各自钉住什么；② 该轴三条 Info 全部落地（root 兜底的注释不再与代码互相打脸、M5 锚点的排版敏感性与「规模下界才是主守」写进现场、collect 侧 `root \|\| process.cwd()` 无测试覆盖登记为遗留）；③ maint 轴两条 Warning 经本机变异**实测成立**并已修（见上一行 M6/M7），第三条是记录里的 `条目=388`（见 B1 那条），第四条是「QM-6 判定要做却未做」——即本行，按补跑并落结论的方式收口；④ 评审与写型变异**串行**：所有变异跑完才派两轴，处置在两份产物都落盘后才动盘 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin changelog-gate-selfreport` 返回 0 行证远端分支已删；回填与删除上面三个 `sync_*` 字段必须同一次提交 |

### 取代 #3277 记录里的两条遗留（历史快照不改写，本行是最新锚点）

`openspec/records/archive-dedup-changelog-history.md` 的「遗留」登记了两笔待办：①`changelog-dedup-regen.js:75` 的归档后失效路径；②退休放行在 stdout 不可区分 + `reconcile` OK 文案自称五项而实跑 A6 + `retiredReason` 两个 sha 无独立断言。**三条现在全部落地并有锁**（本 PR），对应任务 #29 / #30 关闭。该记录本身按「历史是事实快照」不动。

### 遗留（不假装已闭合）

- `check-changelog-growth-retire.test.js` 里那两个硬编码真仓 sha（`23822b73` / `f210f191`）仍在。本 PR 让**新的**退休锁不再依赖它们（改夹具仓真祖先关系），但没有把旧的五条也迁过来 —— 旧锁依赖仓库历史里的具体提交，理论上会被未来的 gc/重写影响，属已知脆弱性，未在本次范围内。
- `collect` 侧 `evaluateAuthorization({…, root: root || process.cwd() })` 的兜底**没有测试覆盖**（M2 只证退休路径的注入是活的）：若将来新增一个不传 root 的调用点，退休分支会退回「按 ambient cwd 判祖先」，与旧缺陷同形。正解是把 root 变成必填并在缺失时当场抛，但那会让函数层那 5 条不传 root 的锁一起改夹具，本次未做。
- 门禁输出的「可区分」目前只有测试与日志两个出口，CI 侧没有东西去**断言一次退休真的发生过**（它是一次都不会自然发生的分支）。我没有为它造假现场，也没有把「CI 里出现过退休放行」当验收条件——那需要一个真的晚于清理的 base。
