---
record: ccg-record-content-addressing
task: 判定记录改用内容寻址命名，消除同基线分叉的 add/add 撞名与 amend 孤儿
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；远程同步这一行的证据只能在合并后取
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」回填并删除本段三个字段）
---

## 本次执行记录：判定记录改用内容寻址命名（ccg-record-content-addressing，2026-10-16）【混合 PR（门禁代码）】

### 问题（三个症状，同一根因）

CCG 判定记录写在 `.ccg/reviews/<sha>.json`，其中 `<sha>` 是 **pre-commit 时的 HEAD**，即**新提交的父提交**。
由此产生三个症状，本轮**各实测到**：

1. **同基线分叉必然撞名（实测 3 次）**：父 sha 被同基线的所有分支共享。两个从同一基线分叉的会话，
   各自提交**不同**变更，却写到**同一个文件名** ⇒ rebase 时 add/add 冲突。而冲突的任何单侧取法都有损失
   （取 ours 丢掉本 PR 的记录，取 theirs 覆盖他人产物 —— 仓规明令禁止「后推覆盖」）。
   本轮三次现场：`2bcce6833….json`（与另一会话 add/add）、`5c7b3c127….json`、`56e34b56b….json`。
2. **amend 产生孤儿**：名字指向父提交，`amend` 后该父提交可能不再是历史中的任何提交 ⇒ 键悬空。
3. **不收敛倾向**：闭环需再提交、再提交又按新父 sha 生成新名字。

> ⚠️ **自我更正（重要）**：上一轮我在 `learnings.md` 与 `harden-runtime-endpoints-auth.md` 里把症状 3
> 写成「本笔靠最后一次提交只动文档路径被判 skip **侥幸**越过」。**这个归因是错的。**
> 实测 `check-pr-exec-record.js:398-407`：门禁**只看 `mode === 'dual'`**，且注释里已记载该收窄正是
> 2026-10-15 为修掉「初版对 single 也要求闭环 ⇒ 每次提交都要跑 15 分钟双模型审查，而写完审查结果
> 再提交时又生成新的 single 记录 ⇒ 无法闭合的循环」（缺陷 G）而做的。**所以「single 被判 skip 而不欠账」
> 是既有设计，不是侥幸。** 本 PR 只修正我自己的错误陈述，不改门禁那段判据。

### 方案

记录名由 `${sha}.json` 改为 **`${stagedDiffHash}.json`**（sha256 ⇒ 64 位小写十六进制）。
`stagedDiffHash` 是**排除 `.ccg` 的暂存 diff** 的哈希 —— 这个键判定器本来就在记录里存着，
且引擎 `ccg-deep-review.js::readDecision()` 的内容寻址兜底**用的就是同一个键**，所以改名对引擎透明。

| 症状 | 改名后 |
|---|---|
| 撞名 | 变更不同 ⇒ 哈希不同 ⇒ 文件名不同 |
| 孤儿 | 同一变更 amend ⇒ 哈希相同 ⇒ 同名覆盖，不产生悬空键 |
| 不收敛 | 同上，同一变更反复提交覆盖同一个文件 |

边界：`stagedDiffHash` 为空（例如只改 `.ccg/` 的提交，diff 排除 `.ccg` 后为空）时**回落**到
既有的 40 位父 sha 形态 —— 保持门禁 `AUDIT_ARTIFACT_RE` 可识别，且不产生空名。

### 改动清单（6 个源文件 + 1 个新记录 + 1 篇执行记录）

| 文件 | 改动 |
|---|---|
| `scripts/ccg-review-decider.js` | ① 新增纯函数 `recordFileName(stagedDiffHash, sha)` 并导出；`saveRecord` 把 `stagedDiffHash` 从内联 IIFE 提为变量（**名字与键同源**，避免两处各算一次而漂移），再由它取名 ② **QM-6 i2**：`collectStaged` 的两条命令（`--numstat` 与 `-U0`）都加 `-- . :(exclude).ccg`，与 hash 同口径 ③ **QM-6 i3**：`saveRecord` 写前检查同名文件，若其 `deepReview.status` 在闭环白名单内则拒写并另存 `<name>-again-<sha8>.json` ④ 导出 `CLOSED_DEEP_REVIEW_STATUSES`（与门禁同源，有等价锁） |
| `scripts/check-pr-exec-record.js` | `AUDIT_ARTIFACT_RE` 由只认 40 位放宽为 **40 或 64** 位 |
| `scripts/deep-review.sh` | ① 新增内容寻址查找段，位置在早退**之前** ② **QM-6 i1**：早退前新增告警段，点名 `git commit -a` 这一实测故障形态并给出两条口径的自检命令 ③ **QM-6 i7**：抽出 `_read_mode`，记录存在但读不出 mode 时显式告警，不再与「没跑判定器」混为一谈 |
| `scripts/ccg-review-decider.test.js` | +7 条：命名契约、收敛、撞名反向锁、空 diff 回落、结构锁、白名单同源锁、已闭环不覆盖锁 |
| `scripts/check-pr-exec-record.test.js` | +7 条：新形态放行、邻近形态仍拒、fail-open 反向锁、口径不倒退、i1 告警锁、i2 口径锁、i7 解析锁 |
| `scripts/deep-review-deps.test.js` | +4 条：存在哈希计算、查找早于早退、配方同源、`_read_mode` 定义唯一 |

### 为什么必须同时改三处（漏一处就失效或 fail-open）

- 只改判定器不改门禁：新名字**不被** `AUDIT_ARTIFACT_RE` 认 ⇒ 被判「夹带」，每次提交恒红。
- 只改门禁正则不改判定器：40 位仍然工作，撞名依旧。
- 只改前两处不改 `deep-review.sh`：脚本按 `<HEAD>.json` / `<HEAD^>.json` 找 ⇒ 双双落空 ⇒
  **早退 exit 0**，深度审查永远不跑。这正是 2026-10-15「缺陷 E」修过一次的同型失效
  （引擎本有内容寻址兜底，却被脚本里一行早退挡在门外，兜底成了死代码）。

### QM-6 双模型评审（7 条，最低分 correctness 5）

评审判 **DUAL**（变更 241 行 > 200 行阈值）。引擎自扮演出口对 i1（Critical upheld）与
i2/i3（高危域 crypto/auth）判阻断 ⇒ 按用户已批准的 **(a) 口径**委托**外部复核**
（明确要求「允许否定提案方」），三条修复均已落实并有回归锁。逐条裁定见
`.adversarial/ccg-deep-ae83768d/adjudication.json`，摘要：

| id | 严重度 | 裁决 | 处置 |
|---|---|---|---|
| i1 | Critical | **upheld** | 已修：早退前加告警段（点名 `git commit -a` + 两条自检命令）。**受控实验证实**：`commit -a` 时 A(--cached)=`8b02f61d34a9e858` ≠ B(HEAD^..HEAD)=`29140567e3fb2604`；`commit --only` 时 A==B |
| i2 | Warning(crypto) | **upheld** | 已修：`collectStaged` 两条命令都排除 `.ccg`（首版只改一条，锁的文案即写明「口径要对齐的是两条」） |
| i3 | Warning(auth) | **upheld** | 已修：写前检查已闭环 ⇒ 拒写并另存 `-again-`，闭环状态不被抹掉 |
| i4 | Warning | dismissed | plan 层记录是方案期快照，不参与提交后闭环；i1 告警已覆盖「找不到记录」表象。登记为残留风险 |
| i5 | Warning | dismissed | 「配方等价」已由端到端实证钉住（A==B 逐字节相同、两层寻址命中同一文件），非仅靠字符串互锁 |
| i6 | Info | — | 40/64 位形态判据重复定义；已抽出 `CLOSED_DEEP_REVIEW_STATUSES` 等价锁，`AUDIT_ARTIFACT_RE` 仍留两处（门禁与 decider 各自需要） |
| i7 | Info | **upheld** | 已修：`_read_mode` 抽出，解析失败显式告警（同型于 i1 的 fail-open 收口） |

**外部复核结论**（按用户已批准的 (a) 口径委托，明确要求「允许否定提案方」）：
三条 upheld 全部 **fix_verified=true / confidence=high**。复核者逐段核对了源码位置与语义
（`deep-review.sh:551-569` 的告警段、`ccg-review-decider.js:225-230` 的两条 pathspec、
`ccg-review-decider.js:501-512` 的拒写分支），并独立指出一条**残余**（已登记，见残留风险第 6 条）。

**锁的形态升级（本轮自查抓到，比评审更早）**：首版 i1/i3/i7 用的是「grep 源码字面」的**结构锁**，
变异反证立即抓到缺口 —— 把 `if (cond)` 改成 `if (false && cond)`、把 say 内容换掉（字面仍在注释里）、
把 `process.exit(3)` 改成 `exit(0)`，三种变异下**结构锁全绿而行为已失效**。故升级为**行为锁**：

- i3：抽出纯函数 `shouldPreserveClosedRecord(prev)`，测试直接调用它对 12 种输入断言
  （3 个闭环态 / 4 个未闭环态 / 5 个畸形输入 / 1 个白名单外自造值）；
- i1/i7：在**临时 git 仓库**里造场景真跑 `deep-review.sh --dry-run`，断言 stdout
  （无记录 ⇒ 必须输出 `commit -a` + 两条自检命令；记录损坏 ⇒ 必须输出「读不出 mode」+ 原因）。

升级后再跑同三条变异，**全部变红**（见变异表 M7/M8/M9）。

### 风险与防线（**这是本 PR 最需要人看的点**）

改 `AUDIT_ARTIFACT_RE` 是**放宽门禁的识别面**：若放宽过宽，`scripts/evil.js` 一类真·功能新增
就能借「审计产物」这条白名单混进纯回填变更集。因此：

1. 形态收得很紧：`/^\.ccg\/reviews\/(?:[0-9a-f]{40}|[0-9a-f]{64})\.json$/` —— 只多认一种位宽，
   大写/短/长/多后缀/子目录/换目录一律仍拒（既有负例锁 + 本次新增负例锁双重覆盖）。
2. **fail-open 反向锁**：64 位命名的 `mode: dual` + `pending` 记录**仍必须**判欠账
   （`check-pr-exec-record.test.js` 的「fail-open 反向锁」）。若无此锁，放宽正则最坏会让新记录
   **对门禁隐形** —— 从「看得见但撞名」退化成「完全看不见」。
3. 变异反证 5/5 全红（见下）。

### 质量节拍取证

**TDD**：先写测试 ⇒ RED ⇒ 实现 ⇒ 全绿。RED 的预测与实测逐条吻合
（首轮预测 decider 5 红 / gate 3 红，实测正是 5/3；QM-6 复审追加锁时预测 decider 2 红 / gate 1 红，
实测 2/1）。其中 gate 的「邻近形态仍被拒」**原本就绿**，作为负向对照证明当前正则确实不收 64 位。
终态：decider 26/26、gate 54/54、deps 16/16。

**变异反证（9/9 RED + 字节级还原 + 还原后复验 0 红）**：

| # | 变异 | 指名的红 |
|---|---|---|
| M1 | 记录名改回父 sha | 命名契约 3 条红 |
| M2 | 门禁正则退回只认 40 位 | fail-open 反向锁等 3 条红 |
| M3 | 门禁正则放宽成「任意 .json」 | 邻近形态仍拒 2 条红 |
| M4 | 整体删掉 `deep-review.sh` 内容寻址段 | 存在性锁 2 条红 |
| M5 | 在查找段**之前**插一个早退 | 位置锁红 |
| M6 | 删掉 `collectStaged` 的 `.ccg` 排除（i2） | 口径锁红 |
| M7 | 去掉写前已闭环检查（i3） | 已闭环不覆盖锁红 |
| M8 | 删掉早退前的 `commit -a` 告警段（i1） | i1 告警锁红 |
| M9 | 把 `_read_mode` 改回裸 try-catch（i7） | i7 解析锁红 |

（M4/M5 共同证明「位置本身就是判据」：早退在查找之前 ⇒ 兜底变死代码。
M6–M9 是 QM-6 复审后补的，与 M1–M5 同口径：变异后红、还原后 0 红。）

**端到端实证（本 PR 的决定性取证）**：

| 步 | 实测 |
|---|---|
| 提交前算 A = `git diff --cached -- . ':(exclude).ccg' \| sha256sum` | `0ca96713…5ea320` |
| 钩子写出的记录名 | `.ccg/reviews/0ca96713…5ea320.json` —— **与 A 逐字节相同** |
| 提交后算 B = `git diff HEAD^ HEAD -- . ':(exclude).ccg' \| sha256sum` | `0ca96713…5ea320` —— **A == B 逐字节相等** |
| `deep-review.sh` | 「判定记录按内容寻址命中：0ca96713」 |
| 引擎 `readDecision` | 「判定记录按 diff 内容寻址命中」**同一个文件** |

⇒ **负载假设成立**：提交前的暂存 diff 与提交后的 `parent..HEAD` diff 哈希相同（这正是判定器与引擎
两侧内容寻址能对上的前提）；且两层寻址命中同一文件，说明 `deep-review.sh` 的改动与引擎既有兜底
**口径一致**，不是我单方面的假设。

**i1 的分叉实验（QM-6 复审补做，证明指控而非推测）**：

| 提交形态 | A(--cached) | B(HEAD^..HEAD) | 相等 |
|---|---|---|---|
| `git commit --only <单文件>` | `771a37953cfb79c9` | `771a37953cfb79c9` | ✅ |
| `git commit -a` | `8b02f61d34a9e858` | `29140567e3fb2604` | ❌ **分叉** |

⇒ 分叉**确实存在**，且只发生在「提交内容超出 pre-commit 时所见暂存区」的形态。
这正是 i1 判 upheld 的实验依据，也是告警段点名 `git commit -a` 的原因。

**引擎不在 CI 内**（`ccg-deep-review.js` 位于 `~/.claude/skills/adversarial-review-loop/`，不受 git 跟踪），
故端到端只能在**本地**取证；CI 覆盖的是判定器、门禁与脚本三处及其回归锁。

### 残留风险（不假装已闭合）

1. **历史 40 位记录仍会 64 位并存一段时间**（回填/审计 PR 会携带旧记录）。已按「两种位宽都认」处理，
   但 `AUDIT_ARTIFACT_RE` 的形态集合因此变大 —— 负例锁（大写/短/长/子目录/多后缀）是唯一防线。
2. **空 diff 回落仍走父 sha 命名** ⇒ 纯 `.ccg/` 提交之间若同基线，理论上仍会撞名。此类提交多为
   `mode: skip`（不参与 `mode === 'dual'` 的欠账判据），但**未做机械证明**。
3. **未覆盖「两个分支提交完全相同的变更」**：内容相同 ⇒ 哈希相同 ⇒ 仍会同名。语义上这属于
   「同一份工作的两个副本」，判为撞名是否可接受，**未与用户确认**。
4. `deep-review.sh` 的内容寻址段依赖 `HEAD^` 存在（首个提交时会取空）——已加空值守卫，
   但**未实测**「仓库只有一笔提交」的场景。
5. 本 PR 改的是**门禁识别面**（`AUDIT_ARTIFACT_RE`）。虽不属于 AGENTS.md 点名的两类
   「必须人工过目」（`.github/workflows/` 分支保护规则本身、`CI_IGNORED_PATHS` 白名单），
   但性质接近，**已提请用户明确授权后才动手**（用户原话：「修。应用质量节拍」）。
6. **i1 的根因未消除（外部复核独立指出，评级 Info 非阻断）**：记录仍会落空、深度审查仍会被跳过；
   告警只把 fail-open 从「静默」变成「出声」。要根治需让 decider 在提交后**自校验**两种口径一致
   （不一致就拒绝收口），那要动 pre-commit 与提交的时序，属扩大范围，本轮未做。

| 远程同步 | PENDING | 开 PR 时登记；合并后就地改写为 `PASS` + merge SHA（回填 PR 完成，含销账） |
