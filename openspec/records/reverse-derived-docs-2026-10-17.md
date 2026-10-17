---
record: reverse-derived-docs-2026-10-17
task: 把 REA 逆向后三项未落地成果做成项目文档（DLL 接口契约 / 平台能力矩阵 / 竞品缺陷同型风险清单）+ 完整成果清单大全集
date: 2026-10-17
branch: reverse-derived-docs-2026-10-17
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：逆向衍生文档三件套 + 成果大全集（reverse-derived-docs-2026-10-17，2026-10-17）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=6：
  `01-docs/REVERSE-ENGINEERING-RESULTS-MASTER-INDEX.md`、
  `01-docs/research/competitor-reverse-2026-10-13/derived/` 下 3 份、
  `openspec/records/reverse-derived-docs-2026-10-17.md`、`.ccg/reviews/*.json`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING
### 写了什么

| 文档 | 内容 | 为什么值得单独成文 |
| --- | --- | --- |
| `derived/DLL-MediaTaskMgr-接口契约.md` | 5 个导出 + 调用时序 + 类层次 + 伪代码实证 + 能力面 + 未闭合 | 原来这些只散在 `原生层分析报告.md` 的 646 行里，没人会为「拿一份 C 接口契约」去读全篇 |
| `derived/平台能力矩阵.md` | 本仓 15 平台 × (发布档/分类节点/双段指标) + 竞品 1,339 端点 + 能力缺口 | 把「该走 API 还是 DOM」「分类缺口多大」变成**数据驱动** |
| `derived/竞品缺陷同型风险清单.md` | 8 CRITICAL → 12 类同型风险 × 我们的现状 + 4 条建议锁 | 竞品缺陷的价值是「我们是否犯同样的错」，不是记住他们写错了 |
| `REVERSE-ENGINEERING-RESULTS-MASTER-INDEX.md` | 7 类成果 + 9 个 PR + 6 篇记录 + 15 条未闭合 + 复核命令 | 用户要「完整成果清单大全集」，须给出**每个数字怎么复核** |

### 本轮写入时**被自己抓住的三处错**（都已修正，不留在文档里）

1. **`--platforms` 参数不存在**：初稿写「导入器支持 `--platforms` 按需导入」，核查 `scripts/import-platform-taxonomy.js` 后发现它只有
   `--source/--out/--check`，平台选择靠**硬编码** `PLATFORM_PREFIXES`（6 个）+ `PLATFORMS_WITHOUT_ID_DATA`（3 个）⇒ 已改写为真实机制。
2. **误把研究数据当成运行时配置**：早期口头结论说「`config/platform-taxonomy.json` 是 31 平台 / 11,623 节点」，
   实测 `stats = {platforms: 6, nodes: 1601}` ⇒ 已在能力矩阵与大全集里写明 **13.8% 的差额与原因**。
3. **`derived/` 里一条 PowerShell 复核命令写成了非法语法**（`({1} = …)`）⇒ 已改成逐份打印的真命令。

### 由此登记的两条新未闭合（进大全集 §11）

- `xiaohongshu` 既不在 `PLATFORM_PREFIXES` 也不在 `PLATFORMS_WITHOUT_ID_DATA` ⇒ 读取层无法区分「无数据」与「漏导入」。
- 竞品端点总览**逐行相加 1,338**，而文档头写 1,339（差 1，未追）。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 本 PR 只改 `01-docs/` 与 `openspec/records/`（无运行时代码）|
| QM-2 代码必检项 | **N/A** | 无代码变更（docs-only 已判）|
| QM-4 视觉 | **N/A** | 无 UI 变更 |
| QM-6 双模型评审 | 未执行（如实登记）| docs-only 通道按 `AGENTS.md` 跳过；本机亦无 `codeagent-wrapper` |
| 远程同步 | PENDING | 待本 PR 合并后回填 merge SHA 与时间 |
