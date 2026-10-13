---
# 用法：复制本文件为 `openspec/records/<分支名或任务 slug>.md`。
record: gate9-annot-bracket
task: PRD 状态标注匹配形态修复 —— 裸词假阳性会静默缩小审计面
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：PRD 状态标注匹配形态修复——裸词假阳性（gate9-annot-bracket，2026-10-13）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | scripts/ 判据 + packages/ 解析器运行时改动 → 混合 PR；隔离 worktree `mp-gate9-annot-bracket`（D 盘）+ 裸分支；共享根保持 main clean |
| 第一性原因（QM-5 ①） | PASS | **实现与自身文档不符**：`01-docs/PRD.md` §二 约定的是**方括号标注**（`【已实现】`/`[implemented]`），而 `scripts/gate9-prd-status.js` 的 `parseItemStatus` 用的是**裸子串匹配** `s.includes(tag)`。于是含「历史」「不做」等**功能名词**的真实条目被判为排除项。`git blame` 指向 PR #3439（本机制初版，同日）|
| 逃逸分析（QM-5 ②） | PASS | ① 单测只测「合规标注被识别」与「未标注→unknown」，**没有一条**测「含功能名词但无标注」的输入——假阳性整类无人覆盖；② 集成测试用的是自造夹具（`一键发布【已实现】`），夹具天然合规，永远复现不了真实 PRD 的裸词；③ 文档与实现的**形态差异**没有任何一致性锁（表 `STATUS_TAGS` 被 deepEqual 比过，但「匹配形态」不比）；④ 事故当时 PRD 内合规标注数=0，分层机制实际只在制造假阴性，而这种「什么都没排除掉」的表象看起来无害 |
| 修复 + 回归保护（QM-5 ④） | PASS | 判据改为**只认独立方括号单元**且括号内与标注词完全相等（英文大小写不敏感）；ASCII 方括号排除 markdown 链接/图片/引用式链接（收尾 `]` 后紧跟 `(` 或 `[` 即跳过）。新增 5 组共 30+ 断言的回归锁：假阳性防线（12 条事故原文）、独立方括号单元、markdown 语法、大小写、事故现场钉死。内联兜底副本（`multi-doc-parser.js`）同步修，一致性锁扩到 `extractAnnotations` 行为等价 |
| 防止再次发生（QM-5 ⑤） | PASS | ① PRD §二 增「匹配形态」判定表（8 行输入→判定→说明）并把事故写进正文，§三 增第 5 条「标注形态是判据的一部分」；② 两份判据（真源 + 包内兜底）的行为等价由测试逐输入比对，改一处不改另一处必红；③ 内联副本新增 `INLINE_EXTRACT_ANNOTATIONS()`，抽取算法本身也进一致性比对 |
| 行尾与 diff 对账 | PASS | 变更 6 文件（M=4 A=2）；新文件 LF，与仓库既有约定一致 |
| 逐文件行数门禁 | PASS | `.github/scripts/check-max-lines.js` rc=0「无新增超大文件，挂账清单与现实一致」（`packages/ai-autonomous-tester` 在 SCAN_DIRS 内但未越限/容差 200） |
| 品牌残留 | PASS | `check-no-brand-residue.js` PASS（扫描 8499 个 tracked 文件） |
| 接线棘轮（Gate 2c） | PASS | `check-unwired-tests.js` OK（检查域 79 个测试文件全部接线）；本次未新增测试文件，只在既有已接线文件内加用例 |
| 测试 | PASS | `scripts/gate9-prd-status.test.js` **12 passed**（原 7 + 新 5）；`packages/ai-autonomous-tester` 全量 **186 passed**（原 185 + 1）；`scripts/gate9-classify.test.js` 11 passed（回归）；`node --check` 4 文件 OK |
| 真实数据复核 | PASS | 用真实 `01-docs/PRD.md`（227 条目）：**修复前** 11 个非 unknown（逐条核对至少 6 个假阳性）→ **修复后** 非 unknown = **0**，227 条全部进审计；8 条假阳性探针全部归为 unknown |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron`、`packages/rpa-engine`、渲染层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA；`git ls-remote --heads origin gate9-annot-bracket` 返回 0 行证远端分支已删；回填后删除三个 `sync_*` 字段与 ledger 登记项 |

### 实现要点（值得留存的判断）

**1. 「实现与文档不符」是一类无人看守的缺陷。** 本仓已有 `STATUS_TAGS` 常量表的 deepEqual 一致性锁，
但它只锁住「表内容」，锁不住「匹配形态」。文档写方括号、实现做子串，两边各自都"对"，
只有把两者放在一起看才暴露。**凡文档规定了输入形态的判据，测试必须覆盖"形态本身"。**

**2. 假阴性的方向性比假阴性本身更重要。** 放宽匹配 → 真实功能被排除 → 覆盖率虚高（危险）；
收紧匹配 → 标注没生效 → 条目照旧进审计（安全）。故括号内做**完全相等**比较，
不放宽前后缀；补充说明一律写在括号外。这个取舍写进了 PRD §二「偏保守的取舍」。

**3. "什么都没排除掉"看起来无害，其实是失效信号。** 事故当时 PRD 里合规标注数=0，
分层机制一条都没排除——表象上"机制没在乱排除"，实际是**判据与数据脱节**：
11 个非 unknown 全来自误判。**当分层机制的命中数全部来自可疑来源时，要先怀疑判据而不是庆祝。**

**4. 复核必须用真实的 cwd。** 第一次复核用 `node D:\Temp\probe.js`，cwd 落在共享根，
判据解析器（优先 `process.cwd()`）**加载了共享根的旧模块**，输出与修复前一模一样——
差点把"没生效"当成"没问题"。在 worktree 内重跑才拿到真实结论（227 全 unknown）。
**跨 worktree 验证时必须先确认判据来源**（报告里的 `statusCriteriaInline` / `resolvedFrom` 就是为这类事留的）。

### 遗留（不假装已闭合）

- **PRD 227 项仍无任何状态标注**：本次只修复匹配形态。修复后真实 PRD 的非 unknown = 0，
  即分层机制目前对存量**零作用**（这是**诚实**状态：全部进审计，不存在被误排除的条目）。
  要让分层真正减债，需要按章节给「规划中/不做/历史」条目补**合规方括号标注**——
  这是产品判断（哪些是规划、哪些是真欠账），不宜由 agent 批量猜测：
  把真实欠账标成「规划中」正是"让门禁变绿"而非"让欠账变少"。
- **审计面恢复后，桌面端 PR 的分母稀释问题回到原样**：227 条全进分母（修复前是 216 条）。
  只改 ops-center 的 PR 仍受作用域分流保护（Layer 1），但真正改 `apps/desktop` 的 PR
  仍会面对"规划项计入分母"的老问题，直到上面那条回填完成。
- **LLM 判分随机性未消除**（上一任务遗留）：同 PR 两次结论相反，本次未涉及。
- **`/rollout` 补锁的影响面**（上一任务遗留）：仍待确认是否有非 admin 用户在用该页面。
- **改密未接入审计日志**（上一任务遗留）：仍未做。
