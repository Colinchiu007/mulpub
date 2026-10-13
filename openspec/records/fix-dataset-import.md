---
record: fix-dataset-import
task: 补入被 .gitignore 静默吞掉的数据提取物（133 文件）—— data/ → platform-data/
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：补入被 .gitignore 吞掉的数据提取物（fix-dataset-import，2026-10-13）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | **纯文档/资料**：仅 `01-docs/research/competitor-reverse-2026-10-13/` 下的目录改名与补入。在隔离 worktree `mp-reuse-rollout`（分支 `fix-dataset-import`，基线 `origin/main`=`f3328eb81`）完成 |
| 判定（单一真源） | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 后取证）|
| 保留门禁：行尾对账 | PASS | 新增文件均为原始字节拷贝（含 GBK 编码文本与 1 个 GIF），不经任何转换 |
| 保留门禁：品牌残留 | PASS | `node scripts/check-no-brand-residue.js` → PASS。数据文件为平台分类表，不含品牌词 |
| 保留门禁：文档同步 | PASS | `check-text-encoding-integrity` / `check-unwired-tests` / `check-gate-record-debt` 均 exit=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面 |
| QM-6 CCG 双模型外部评审 | 未执行（如实登记）| 本机无 `codeagent-wrapper` |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin fix-dataset-import` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

### 缺陷：上一 PR（#3487）静默漏掉了用户明确要求纳入的数据

**用户明确选择「连原始数据提取物一起入」**，但 #3487 实际入库的是 **47 个文件（25 个 `.cjs` + 22 个 `.md`）**，**数据提取物的 133 个文件一个都没进去**。

**第一性原因（QM-5 ①）**：
`.gitignore:12` 是一条**裸 `data/` 规则**，gitignore 的目录模式**匹配任意层级**同名目录 —— 于是 `01-docs/research/competitor-reverse-2026-10-13/data/` 整棵子树被忽略。

**逃逸分析（QM-5 ②）**：
| 层 | 为什么没拦住 |
|---|---|
| `git add 01-docs/` | 被忽略的文件**不进索引**，且**不出现在 `git status`**（`??` 也不显示）⇒ 暂存数偏小无任何提示 |
| `git status --porcelain` | 同样是静默 —— 我当时看到的「工作区干净」是**假干净** |
| 四道质量门禁 | 全绿 —— 它们检查的是「已入库内容是否合规」，**不检查「该入库的是否都入了」** |
| 人工核对 | 我核对了「提交文件数 60」，但**没有与「导入时的 180」对账** |

**这是一个新的同族错误**：与 `方法论-度量工具的五次同族错误.md` 里的第 1、2 类同源 —— **把「我看不到」当成「没有」**。区别在于这次的对象是 **git 索引**而非正则匹配。

**处置（QM-5 ④⑤）**：
1. **不改 `.gitignore`**（那是改守门人，且 `data/` 规则本身合理 —— 它要忽略的是应用运行时数据目录）。改用**目录改名** `data/` → `platform-data/` 规避。先验证 5 个候选名均不被忽略再落盘。
2. **回归保护**：本条记录的「导入文件数 = 已入库文件数 + 被忽略文件数」对账口径，写入下方遗留项，后续同类导入必须做**总数对账**，不得只看提交数。

### 缺陷之二：导入脚本把 78 个 GBK 文件**解坏了**（同一 PR 内自查发现）

补齐文件后编码门禁变红，顺查发现**更严重的问题**：`import-reverse-research.cjs` 用
`buf.toString('utf8')` 读**所有**文本文件，而该数据集的 **78/131 个 `.txt`/`.ini` 是 GBK** ——
对 GBK 字节做 UTF-8 解码会产出 **U+FFFD 替换字符**，文件被**静默损坏**（体积还变大了）。

**实证**：`media_url_list.txt` 源 **7186 B**（GBK，按 GBK 解码首行为 `//微信公众号`）
→ 导入后 **7509 B 且含 164 处 U+FFFD**，门禁报「U+FFFD × 157」。

**处置**：
1. 写一次性修复脚本，**从源目录字节级重取**（源是解 zip 时原样落盘的，未经任何解码），
   再对**非合法 UTF-8** 的文件按 GBK 解码后写为 UTF-8。结果：**54 个原生 UTF-8 字节级保留 /
   78 个 GBK 正确转码 / 1 个二进制原样 / 0 个无法解码** —— 78 与素材报告的「78/130」吻合。
2. 编码门禁恢复 **exit=0**；`media_url_list.txt` 首行现为 `#EMEDIATYPE_WEIXIN, //微信公众号`，
   残留 U+FFFD **0 处**（转码后 7312 B 属正常：UTF-8 汉字 3 字节 vs GBK 2 字节）。
3. 在 `platform-data/README.md` 写明：**本副本文本已统一 UTF-8，不是字节级原件**，
   需要原件的用随包的 `extract-wemedia-datazip.cjs` 对产品原 `data.zip` 重解。

**归因**：这与「缺陷之一」是**同一条根因的两个面** —— 导入脚本对**编码**和**忽略规则**都做了
「默认情况成立」的假设，两个假设各破坏了一批文件，而**每一步的表面产物都是"成功"**。
可复用判据：**导入类脚本必须对每个文件显式判定编码，且结束时对「源数 == 目标数」断言**。

### 遗留（不假装已闭合）

1. **对账口径尚未机械化**：本次靠人工发现。可做的机械防线是「导入脚本在结束时断言 `git status --ignored` 里没有本次目标路径」，但该脚本已按纪律删除（其自身含品牌词，不可入库）。**登记为待补**。
2. **`escape-mojibake-evidence.cjs`**（一次性工具）仍留在 worktree，随 worktree 清理带走；`safe-delete` 因本机缺 `mavis-trash` 而拒绝，未绕过（R0）。
3. `01-docs/research/competitor-reverse-2026-10-13/` 现共 **180 个文件**；主干在本次合并后应与之一致 —— **合并后须核对总数**，这正是本次缺陷的对账口径。
