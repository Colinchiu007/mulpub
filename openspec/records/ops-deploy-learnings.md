---
record: ops-deploy-learnings
task: ops-center 上线部署复盘 —— 三处记忆沉淀 + OPERATIONS §13 子路径托管章节
date: 2026-10-18
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（按 AGENTS.md 合并后收尾清单回填并删除本段三字段）
---

## 本次执行记录：ops-center 上线部署复盘（ops-deploy-learnings，2026-10-18）

### 为什么这个 PR 单独存在（隔离动机）

共享根开工时是 `main` + 8 行脏 + behind=4，脏项含 `CHANGELOG.md`（-21879 行）、
`.ccg/reviews/` 删改、`openspec/records/learnings-add1.md` 删除 —— **全部属其他会话正在进行的工作**。

仓规明确：「共享根被并发会话占用时**不得**在其上 commit，也不得 `merge --ff-only`」。
故本 PR 走 worktree，共享根**保持原样未动**（收尾复查仍为 8 行脏、branch=main）。

### 第一性原因：这批经验从哪来

2026-10-17～18 把运营中心真正上线到 `https://www.iart.work/ops/`，连踩三个
**症状相同（HTTP 200 但白屏）、根因不同**的坑。值得沉淀是因为：

- 状态码完全查不出来（200 是**失败信号**而非成功信号）；
- 每一条都有实证（error log / 字节数 / content-type），不是推测；
- 下一任运维照现有文档做会**必然**再踩一遍。

### 三条最关键的结论（都有实证）

1. **`try_files` 的 fallback 是 URI 不是文件路径**。写 `/ops/index.html` ⇒
   `rewrite or internal redirection cycle` ⇒ 500（error log 实证）；改 `/index.html` ⇒
   不以 `/ops/` 开头而重新走 location 匹配 ⇒ 落到主站 `location /` ⇒ 返回**主站 HTML**
   （实测 `/ops/` 与 `/ops/assets/*.js` 都返回 67787 字节「汤姆鱼」页）。
   ⇒ **判据必须取字节数而非状态码**：「200 + 主站字节数」是白屏的完美伪装。

2. **404 可能是刻意 fail-closed**。`/api/v1/runtime/bootstrap` 恒 404 而 openapi 里明确存在、
   同 router 的 `/runtime/rollout` 返回 401。根因在代码注释里（签名私钥未配置即 404）。
   本次连中两格（签名私钥 + `OPS_CATALOG_API_KEY`），补齐后才 200 且含 `appMenu` 21 项。

3. **用「子串存在」断言语义，子串会被同词掩盖**。文案挤在一句里时删掉前半句的「生效」
   后半句仍有 ⇒ 断言抓不到（变异 MR2/MR3 实证）。正解：拆 WHEN/HOW 两段 + 精确等值断言。
   同类：断言里的兜底（`opts.duration ?? CONST`）会把「接线锁」降级成「常量锁」。

### 交付内容

| 载体 | 内容 | 量 |
|---|---|---|
| `01-docs/learnings.md` | 内置记忆（部署复盘 14 条 + 重复犯的流程坑 1 条） | 31 行 |
| `ops-center/docs/OPERATIONS.md` | 新增 **§13 子路径托管（/ops/）与运行时签名**（8 小节） | 159 行 |
| 外部记忆 `learnings.jsonl` | 11 条（type/pitfall/pattern 分列，含 id 便于检索） | 已追加 |
| EverOS | 7 条（`/api/v2/memory/add` + `flush`，后者 `status=extracted`） | 已沉淀 |

### 交付状态

| 项 | 状态 |
|---|---|
| 远程同步 | PENDING | 合并后取 merge SHA 回填，并删除 frontmatter 三个 `sync_*` 字段 |

### 数据校验

| # | 校验 | 判据 | 结果 |
|---|---|---|---|
| V1 | 共享根未被污染 | 全程在 worktree；收尾复查共享根仍 8 行脏、branch=main | ✅ |
| V2 | 行尾两口径一致 | `--numstat` vs `--ignore-cr-at-eol --numstat` | ✅ |
| V3 | 品牌残留 | `check-no-brand-residue` | ✅ PASS |
| V4 | 绝对路径 | `check-doc-abs-paths`（CI 同款 merge-base 口径） | ✅ PASS |
| V5 | 执行记录门禁 | `check-gate-record-debt` | ✅ rc=0 |
| V6 | 文档未被重复插入 | 幂等检查（已存在即跳过） | ✅ |

### 取证

- `classify-docs-only --base=origin/main --head=HEAD` → **`docs-only=false`**
  （含 `ops-center/docs/`，不在文档白名单）⇒ 走完整节拍，不借道文档快通道
- `pre-code-edit-guard` rc=0（worktree 隔离有效）
- `check-no-brand-residue` PASS；`check-doc-abs-paths` PASS
- 行尾两口径一致

### 过程教训（本 PR 自身踩的，一并记账）

1. **执行记录只写 frontmatter 的 `sync_status` 而未写正文表格行** ⇒ `QG Changes` 判红。
   **同一天连续两篇记录踩同一格**，说明靠自觉不可靠 —— 已把「写完记录立刻本机跑
   `check-gate-record-debt.js` 确认 rc=0」写进 learnings 固化。
2. **分支落后主干 6 个提交时 rebase 会撞上他人对 `01-docs/learnings.md` 的并发修改**。
   本 PR 的处理是 `git rebase --abort` 后**基于最新 `origin/main` 重建 worktree** 再重放
   （脚本幂等），而不是用「后推覆盖」消解冲突 —— 后者会把他人的记录一起抹掉。

### 遗留（不假装已闭合）

1. **桌面端端到端未验证**：无头环境起不了 GUI，「重启应用看到菜单」需人工确认。
2. **`X-Catalog-Key` 未配进桌面端**：属运行时凭据，按设计不入库，需在应用设置里填一次。
3. **EverOS 的 API 契约是探出来的**（`session_id` + `messages[{role,content,sender_id,timestamp}]`），
   该服务无 `/docs`、`/openapi.json`；字段若变需重新探。
4. 引擎高危域误判（QM-6 i5 被标 `crypto`）未修，见 PR #3841 记录。