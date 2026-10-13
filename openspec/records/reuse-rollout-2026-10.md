---
record: reuse-rollout-2026-10
task: 竞品逆向研究成果入库 + 可复用资产目录/集成设计/实施计划三件套 + 8 份旧复用计划归档
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：竞品逆向研究成果入库与应用文档三件套（reuse-rollout-2026-10，2026-10-13）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | **纯文档**：改动全部落在 `01-docs/`（新增 4 份应用文档 + 导入 180 个研究成果文件 + 归档 8 份旧计划）。按分层策略文档层不需 worktree，但因**共享根被并发会话的 26 项未提交改动占用**（`git status --porcelain` 实测），在隔离 worktree `mp-reuse-rollout`（裸分支 `reuse-rollout-2026-10`，基线 `origin/main`=`1a6871355`）中完成，共用独立 index 避免连带他人改动 |
| 判定（单一真源） | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=true，files=60**（在 **commit 之后**取证——提交前 `HEAD==base` 会得 `files=0`，属已知取证顺序陷阱）|
| 保留门禁：行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；提交时 LF→CRLF 警告属本仓既有行为（Windows），不计入差异 |
| 保留门禁：品牌残留 | PASS | `node scripts/check-no-brand-residue.js` → **PASS（扫描 8653 个 tracked 文件，无品牌残留）**。**导入前用探针实测确认过门禁会拦**：向 `01-docs/research/` 放入一份含品牌词的文件 ⇒ `FAIL：发现 1 处品牌残留`。脱敏按 `PRD-NAMING-NORMALIZATION-2026-09-15` §8 映射表执行，共处理 **46 处** + **8 个含品牌词的文件名** |
| 保留门禁：文档同步 | PASS | `check-text-encoding-integrity` / `check-unwired-tests` / `check-gate-record-debt` 三项均 exit=0 |
| 附带修复：编码门禁 | PASS | 5 个文件里**作为证据展示**的字面 U+FFFD（演示 Expand-Archive 乱码、GBK 误解码）触发 `check-text-encoding-integrity` 判据「U+FFFD = 解码失败被写回」。处置：改为 `⟨U+FFFD×N⟩` 转义写法（17 个乱码段 / 38 个字符）——语义不变且**比原写法更精确**（标出确切个数），**不改门禁、不加基线** |
| 附带修复：gitignore | PASS | `.gitignore:335` 的 `/01-docs/*analysis*.md` 命中初版文件名 `ANALYSIS-COMPETITOR-REVERSE-2026-10-13.md`（**Windows 下 gitignore 大小写不敏感**，小写 `analysis` 命中大写 `ANALYSIS`；`git check-ignore -v` 实证）。改名 `RESEARCH-*` 规避，并同步修正 8 份归档横幅里的指向 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（未改 `apps/` `packages/` `config/`）|
| QM-6 CCG 双模型外部评审 | 未执行（如实登记）| 本机无 `codeagent-wrapper`。pre-commit 判定器全程覆盖（判定落盘 `.ccg/reviews/70ad3bd31….json`），首次提交判定为 DUAL、补提交判定为 SKIP（复杂度低）|
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin reuse-rollout-2026-10` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

### 交付内容

**新增 4 份应用文档（3,279 行）**

| 文档 | 行数 | 内容 |
|---|---:|---|
| `01-docs/RESEARCH-COMPETITOR-REVERSE-2026-10-13.md` | 433 | 本轮逆向成果总览，覆盖 22 份报告 |
| `01-docs/REUSE-CATALOG-2026-10-13.md` | 902 | **29 项可复用资产逐项登记 + mulpub 代码现状核实** |
| `01-docs/ARCH-REUSE-INTEGRATION-2026-10-13.md` | 1353 | 7 项逐项集成设计（数据模型/接口签名/集成点/测试/验收/回滚）|
| `01-docs/PLAN-REUSE-ROLLOUT-2026-10-13.md` | 592 | P0–P3 四阶段 18 个任务（依赖图/里程碑/风险/工时/明确不做）|

**成果入库**：`01-docs/research/competitor-reverse-2026-10-13/`，180 文件 / 2.57 MB（22 份报告 + 25 个取证脚本 + 数据提取物 31 平台 / 11,623 分类节点）。

**归档**：8 份旧复用计划 → `01-docs/archive/LEGACY-*.md`（文件名加 `LEGACY-` 前缀 + 移入 `archive/` + 文内说明横幅），并修正 9 处指向已改名素材的引用。

### 核心结论：先核实代码，11/29 项本就存在

**本轮最重要的产出不是「发现了什么」，而是「核实了哪些其实不用做」。** 前一轮同类计划（`archive/LEGACY-MP-REUSABLE-ACTUAL-PLAN.md`）记录过一次教训：**假设 7 项缺失，实测 6 项本就存在**。本次 29 项里 **11 项已存在**，其中三项若不做核实必被写成「待做」：

- `account-metrics/adapters.js` 的 `toCount()` **已实现**「缺失显式为 null、不补 0」⇒ 指标能力矩阵的目标本仓已达成
- `scene-builder.ts` + `segment.ts` **已有两套秒制绝对时间拍平** ⇒ 时间轴的真实工作是收敛而非新建
- `CancelToken` 桥接**已落地**（`rpa-view-manager.js:24-25`，注释即写着「参考产品复用」）

**真缺失 9 项**，Top 3：平台分类 ID 通路、素材组合三级降级算法、测量驱动卡片分页引擎。

### 遗留（不假装已闭合）

1. **三处对已入库报告的修正，由子代理在写方案时发现，我尚未独立复核** —— 已写入 PR 正文，不得当作已确认结论：
   - `mediadatamgr.ini` / `tencentvideocategortmap.txt` 可能是**声称为 GBK 的 UTF-8 文件** ⇒ 编码判定必须**逐文件双解码试探**，不能按扩展名批量判定
   - 分类映射形态**至少 6 种**（非报告所写的 5 种）
   - `平台覆盖差距分析.md` 把「微信视频号」列为缺口**疑为误读**（`config/platforms.yaml` 的 `tencent_video` 即视频号）—— 教训：**字段名相同 ≠ 语义相同**，按平台名做集合差不成立
2. **两份文档超出原定篇幅目标**（ARCH 1353 vs 500–800；CATALOG 902 vs 450–700）：子代理选择保留全部检索证据与接口签名，未悄悄删减。是否压缩待用户裁决。
3. **未跟踪的 `escape-mojibake-evidence.cjs`**（本次一次性的转义工具，其自身含品牌词故不可入库）留在 worktree，随 worktree 清理带走；`safe-delete` 因本机缺 `mavis-trash` 而拒绝，未绕过（R0）。
4. **提交期观察到一处良性假失败**：`git commit` 后报 `fatal: cannot lock ref 'HEAD': is at <new> but expected <old>`，但**提交实际已落盘**（两次均如此）。根因是 CCG post-commit 钩子会重写 HEAD（自动 stage `.ccg/reviews/<sha>.json` 并 amend），与后续 git 操作产生锁竞争。**判成败一律取产物（`git log`），不取 rc** —— 与本仓既有纪律一致。
