---
record: quick-collect-preset-refresh
task: 快捷采集内置词条按用户真实需求重排（替换 2 条 agent 推演词条 + 新增 provenance 来源标注）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个动这些文档的会话（回填时**同一次**改：本文件表格行 + `.quality-gates.md` 同名记录的表格行与 bullet，并整段删除本 frontmatter 的三个 sync_* 字段，同时删 `scripts/gate-record-debt-ledger.json` 的本标题登记项）
---

## 本次执行记录：快捷采集内置词条按用户真实需求重排（quick-collect-preset-refresh，2026-10-11）

> 分支 `quick-collect-preset-refresh`，隔离 worktree `D:\Data\projects\mp-worktrees\mp-quick-collect-preset-refresh`（**非 C 盘**）。

### 一、问题：agent 推演的内容被当成了用户要求

用户明确指出他的提示词原话是「AI 与新技术领域的真实动态」，而不是"内容平台规则/审核口径/AIGC 标识/限流封禁"。
复核证据（全部可查）：

| 证据 | 出处 |
| --- | --- |
| 6 条内置词条里**只有** `AI 领域动向` 标注"提示词逐字采用用户给定文本" | `openspec/changes/quick-collect/proposal.md` |
| 用户原话对照串全文不含"平台规则/审核/AIGC 标识/限流封禁"任何字样 | `quick-collect-presets.test.js` 顶部独立手录常量 |
| "我关心平台规则有没有变化"出自 PRD §1 场景 2 —— 会话自己写的产品推演 | `01-docs/PRD-QUICK-COLLECT-2026-10-11.md`（原 L16） |

**代价**：这条错认给「S3 政策/合规类源」整片扩展提供了理由；S3 实测 7 个候选全不可用，只能以证据收口 ——
一整片工作量花在非用户要求的方向上。

### 二、修法

1. **替换 2 条词条**（总数仍 6，交互/校验/存储不变）：`builtin-platform-policy` → `builtin-ai-papers`（论文速览，
   吃 S2 已接入的 `arxiv_cs_ai`/`hf_papers`，此前无专属词条）；`builtin-risk-alert` → `builtin-ai-howto`
   （实操技巧与工作流，用户要求"换成其他实用的"）。
2. **根因修补：新增 `provenance`**。文档里的"用户要求"与"agent 推演"原先无法机械区分 —— 这就是漏洞本身。
   现在每条词条必须声明 `'user' | 'agent'`，并有一条断言锁死「恰好一条是 user」，把归属标错当场 CI 红。
3. **用户原话词条一个字都不动**（AC-10 继续锁着）。

### 三、门禁表

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---- |
| TDD | PASS | 特性域 **14 文件 276 passed / 0 failed**；新增/加强 3 处断言：旧 id 不再存在（负向）、来源锁"恰好一条 user"、新词条源闭集与专属源 + 渲染端面板夹具随词条改名 |
| 变异反证（3 条） | PASS（逐条实测指名变红后回滚） | ① 用户给定词条标成 `agent` ⇒ **1 红**；② 新词条吃到闭集外源 ⇒ **2 红**；③ 用户给定提示词改一个字 ⇒ AC-10 **1 红**；回滚后 8 绿、文件字节数复原 |
| 静态门禁 | PASS | `check-max-lines` / `check-locale-sync`（pair+cjk+keys）/ `check-ipc-bridge` / `check-frontend-consistency` / `check-no-brand-residue` / ESLint（改动文件零报错） |
| QM-1 打包 | PASS | `verify-worktree-deps` OK → `pnpm run build:dir` **rc=0**；asar 解包 `require` 后：词条 = 新 6 条、`provenance==='user'` 恰好 1 条、旧两个 id **不存在**、papers 源 = `arxiv_cs_ai,hf_papers,qbitai,reddit,hackernews,github` |
| QM-4 视觉 | 待 CI 判定 | 只改主进程产品内容（词条）与文案来源提示，无 UI 结构变化；以 PR 的 `QG Visual` 为准 |
| 渲染端一致性 | PASS | 面板测试夹具与选择器随词条改名（全局替换 3 处）；渲染端仍只读展示主进程词条 |
| 文档同步 | PASS | 新建 change `quick-collect-preset-refresh`（proposal/design/tasks/spec）+ 更新 quick-collect 的 spec/proposal + 两篇 PRD 的对应段 + cn-sources tasks 标注 S3 作废 + CHANGELOG |
| 未闭合（诚实记录） | — | ① 两条新词条本身也是 agent 编写（所以标 `agent`）——机制不假装新内容变成了用户要求；② 已跑过的历史结果不迁移：结果里的 `quickCollect` 溯源字段存的是**指令标题文本**（仅展示用），不存在"词条被删导致结果打不开"；③ S3 的证据表保留但目标作废，三条后续路径 A/B/C 一并作废 |

| 记忆沉淀 | PASS | ① 仓库文档：本记录 + `.quality-gates.md` 同名记录 + 新 change 五件套 + 两篇 PRD + CHANGELOG；② `01-docs/learnings.md` 新增章节「文档里的『用户要求』与『agent 推演』必须机械可分」（17322 行，append-only）；③ gstack `learnings.jsonl` 追加 1 条 `doc-claims-must-mark-who-said-it-user-vs-agent-inference`（148 → **149 行**，逐行 JSON 合法）；④ **EverOS**：session `mp-quick-collect-preset-refresh-20261011` 走 `add` → `flush`（首次 flush 客户端超时但服务端已完成，重试回 `no_extraction`），落盘 `~/.everos/default_app/default_project/users/agent/episodes/episode-2026-10-11.md`（**12773 B**，22:32:35）中 grep 到哨兵词 `builtin-ai-papers`、`builtin-ai-howto`、`quick-collect-preset-refresh`、`provenance` 各命中 ⇒ 判据取产物；⑤ 内置记忆：DSH 会话档由 harness 自动落盘（无对外写 API），未手工伪造 |

### 四、远程同步

| 项目 | 状态 | 取证与回填要求 |
| ---- | ---- | ---- |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后同一次回填本行、`.quality-gates.md` 同名记录的表格行与 bullet、本文件 frontmatter 的 `sync_*` 三字段，并删除 `scripts/gate-record-debt-ledger.json` 的本标题登记项 |
