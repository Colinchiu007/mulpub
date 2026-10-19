---
record: wemedia-verdict
task: WEMedia.exe 反编译可行性结案 —— 2 小时档 provider_timeout，撤回「加壳」保留下「2h 内不可行」
date: 2026-10-19
---

## 本次执行记录：WEMedia.exe 反编译可行性结案（wemedia-verdict，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**（2 个研究 md），隔离 worktree `mp-wemedia-verdict` / 裸分支 `wemedia-verdict` |
| 第一性原因（QM-5 ①） | ✅ | 前文把「三档超时失败」记为「结论待定/不可行」但最高只测到 60 分钟，**不足以支撑结论**。本轮补齐 2 小时档实测，把推断变事实 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸在「60 分钟失败被写成不可行，而 60 分钟不是判定性预算」。无门禁能核对「结论的证据强度是否够」——它是散文结论 |
| 修复 + 回归保护（QM-5 ④） | ✅ | §7.4 补实测表 + 三条口径分清表（加壳仍错 / 不可反编译已实测 / 永远不可能不能说）；`derived/DLL-MediaTaskMgr-接口契约.md` §1 第 1 条与 §8 第 8 条同步结案 |
| 防止再次发生（QM-5 ⑤） | ✅ | 新增 §7.4.1「成本超线性」对照表（8.24MB→1830s vs 12.4MB→>7206s），明确写「不要按体积线性外推 Ghidra 耗时」；§7.4.3 记 Ghidra 残留目录 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致；删除行全部是「结论待定」原文，无意外删除 |
| 接线棘轮 | N/A | 未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 纯研究文档 |
| QM-6 CCG 双模型外部评审 | 未执行 | docs-only 快速通道，**不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

**判定**：`node scripts/classify-docs-only.js --base=origin/main` → 预期 docs-only=true（files=2，均在 `01-docs/research/`）

### 实测数字（可复算）

| 项 | 读数 |
|---|---|
| `WEMedia.exe` 体积 / `.text` | 18,114,584 B / **12,405,533 B** |
| 超时设置 | `REA_GHIDRA_STARTUP_TIMEOUT_MS = 7200000` |
| **实测耗时** | **7,206 s = 120.1 分钟** |
| `primary_error.code` | **`provider_timeout`** |
| `primary_error.details.operation` | **`list_documents`**（会话第一个探针）|
| `primary_error.details.timeout_ms` | `7200000` |
| `retryable` | `true` |
| 函数级产物 | **0 字节**（仅 3,642 B 错误 JSON）|
| 对照：`MediaTaskMgr.dll` 8.24 MB | 1,832 / 1,859 / 1,910 s（三次）|

### 遗留（不假装已闭合）
1. **4–8 小时档未测** —— `retryable: true` 说明未被判死。
2. **超线性归因未验证** —— 三条可能原因（函数数爆炸 / 跳转表 / no-return 修复关闭）均为方向性假设。
3. **`<TMP>\rea-ghidra-<hash>` 残留未清理** —— 需人工确认。
4. **换机器未测**。
