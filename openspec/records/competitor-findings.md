---
record: competitor-findings
task: 竞品原生层复核 —— 撤回「加壳」归因、补全 MediaTaskMgr.dll 导出/导入表、确立「先 PE 表后 Ghidra」方法论
date: 2026-10-19
---

## 本次执行记录：竞品原生层复核（competitor-findings，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**（3 个研究 md），在隔离 worktree `mp-competitor-findings` / 裸分支 `competitor-findings` 上完成 |
| 第一性原因（QM-5 ①） | ✅ | 前文把「三档超时失败」归因为「加壳」，但该归因**从未有字节级证据**；本轮直读 PE 头 + 入口字节 + 加壳器字符串，全部否证 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸在「结论被写进 3 篇文档、并因此衍生出『exe 没有代码成果』这个下游判断」；没有任何门禁会核对「归因是否有取证」，因为它是散文结论而非可执行断言 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 三处更正均标注「2026-10-19 更正」并指回补充报告 §7.1；未新增自动判据（这是研究报告，不建门禁），但在 `derived/DLL-MediaTaskMgr-接口契约.md` 新增 **§2ter「先 PE 表后 Ghidra」方法论**，把「符号面不该付 Ghidra 时间」写成可复用步骤 |
| 防止再次发生（QM-5 ⑤） | ✅ | 方法论表把「导出/导入/段表/加壳判据 = 约 10 秒」与「函数体/引用图 = 30–32 分钟」并列，后来者按表走即可避免用 30 分钟换 4 秒就能拿到的东西 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；删除 11 行全部是**被更正的旧断言**（逐条在上表「第一性原因」中列出），无意外删除 |
| 接线棘轮 | N/A | 未新增 `*.test.js`（纯研究文档）|
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（只改 `01-docs/research/` 下的 md）|
| QM-6 CCG 双模型外部评审 | 未执行 | 本 PR 为纯文档 + `docs-only=true`，按 docs-only 快速通道跳过 QM-6；**不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）|

**判定**：`node scripts/classify-docs-only.js --base=origin/main` → `docs-only=true`
（files=3，全部在 `01-docs/research/competitor-reverse-2026-10-13/`）
品牌残留：`check-no-brand-residue.js` → PASS（扫描 10315 个 tracked 文件）

### 本轮实测数字（可复算，全部来自本机实际运行）

| 项 | 读数 | 来源 |
|---|---|---|
| Ghidra 全量分析 `MediaTaskMgr.dll` 耗时 | **1832 / 1859 / 1910 s**（三次） | `rea analyze` 三次独立运行 |
| 同目标函数/字符串规模 | **66,199 函数 / 13,120 字符串 / 8 段** | `binary_overview`（REA Evidence `ev_622ef458…`）|
| 导出表 | **45 个**（业务 C API 7 + CxImage 38） | 直读 `DataDirectory[0]` RVA `0x00948A10` size 1592 |
| 导入表 | **15 DLL / 460 函数** | 直读 `DataDirectory[1]` RVA `0x009459BC` |
| `--snapshot` 产出 | **8,080 字节**（仅概览元数据） | `--snapshot` 落盘实测 |
| 带 snapshot 复查耗时 | **1,910 s**（未省） | `rea search --snapshot` 实测 |
| `WEMedia.exe` PE 结构 | 5 段 / EP `0x005D5B2A` / imageBase `0x00400000` / `.text` `0x00BD4B1D`=12.4 MB | 直读 PE 头 |
| 加壳器字符串命中 | **0**（VMProtect/Themida/ASPack/UPX/PECompact/NsPack/vmp 全无） | 整文件 ASCII 扫描 |

### 遗留（不假装已闭合）

1. **`WEMedia.exe` 2 小时预算重跑在本 PR 提交时仍在运行、无结论**。
   前文三档（330 s / 30 min / 60 min）全失败，只证明「60 分钟内跑不完」，**不等于不可行**。
   文中已显式标注「不要读成已证明不可行」。结果出来后须回补本记录。
2. **7 个业务导出里只有 1 个（`InitMediaTaskMgr`）有反编译证据**；其余 6 个（含新发现的
   `SetLibPostInitParam` / `SetLoginUserInfo`）签名仍属推断，每个需 ~30 分钟。
3. **38 个 CxImage 导出未逐个核对**是否真被宿主使用（可能是链接期未裁剪的副作用）。
4. **`vtable` 布局仍未验证** ⇒ 跨语言直连仍判「不可行」，不得因本轮补了导出表就改口。
