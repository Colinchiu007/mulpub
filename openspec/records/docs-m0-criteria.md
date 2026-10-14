---
record: docs-m0-criteria
task: M0 判据按实测修订（4 条原判据与交付不符）
date: 2026-10-14
branch: docs-m0-criteria
---

## 本次执行记录：M0 判据按实测修订（docs-m0-criteria，2026-10-14）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=2：
  `01-docs/PLAN-REUSE-ROLLOUT-2026-10-13.md`、`.ccg/reviews/e3e8157aff…json`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS
### 为什么改的是判据而不是实现

P0 全部落地后跑 PLAN §7 的 M0 验收，8 条里 **4 条不通过**。逐条核实后确认：**不通过的是判据，不是实现**。

原则：**先分辨是「实现错」还是「判据错」，再改判据并写明理由 —— 绝不默默改实现去凑一条写错的判据。**

| # | 原判据 | 实测 | 修订为 | 理由 |
|---|---|---|---|---|
| M0-1 | `<src> <out>` 连跑两次 SHA 相同 | ✅ 且与已提交产物**字节完全相同** | 补上真实 `--source` 路径 | 原写法缺 `--source`，且未指明数据源；项目实际用**仓库内**副本 |
| M0-2 | `nodeCount===11623` / `platformCount>=20` | **1601 / 6** | 锁实测三元组 `6 / 1601 / 53` | 原数字假设导入竞品全量数据；用户明确要求只覆盖本项目支持的平台。原判据**意图**（防解析退化成空集合）保留 |
| M0-4 | `resolveCategoryId('douyin','动植物')` 无 contentType | **article 链上 id='117'**；video 链上不存在 | 显式传 `{contentType:'article'}` | 图文/视频是两套独立命名空间（B站 id=21 图文「萌宠」/视频「日常」），读取层要求显式传、缺省即抛错（有意设计） |
| M0-5 | 返回 `=== null` | 恒返回结构体 | `ok===false && reason==='platform-name-only'` | `null` 会让调用方无法区分「平台无分类 ID」（该隐藏控件）与「名字写错」（该报错）|
| M0-8 | 含 `categoryName` | `key='category'` | 断言存在 `semantic==='category'` 的字段 | ① 适配器读 `taskData.category`；② bilibili 原本就用 `category`、youtube 用 `categoryId`；③ PRD §15.3 已冻结「article.category = 平台侧数字 ID」。再加 `categoryName` 会让同一概念有**第三个名字**——正是该注册表要修的债 |

M0-3 / M0-6 / M0-7 原样通过。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 本 PR 只改 `01-docs/` 与 `.ccg/`，未触及 `apps/desktop/electron/` 或 `packages/rpa-engine/` |
| QM-2 代码必检项 | **N/A** | 无代码变更（docs-only 已判） |
| QM-4 视觉 | **N/A** | 无 UI 变更 |
| QM-6 双模型评审 | 未执行（如实登记）| 本机无 `codeagent-wrapper` |
| 远程同步 | PASS | PR #3522 已合并，merge SHA `5695459f3944da207a8d4d0a9c0f11937ef10557`（2026-10-14）|

### 一处附带说明

本轮曾一度判定「产物血缘元数据系统性错标」与「产物以 CRLF 入库」，**两次均系误判并已完全回退**
（详见 EverOS 会话 `mp-reuse-p0p3-rounds17` 与 `01-docs/learnings.md` 第 17 轮）。根因是用 PowerShell 管道做
字节级判据 —— 它在管道/`Out-String`/重定向环节会改写字节与行尾。**计数、哈希、编解码判定一律走 Node。**
