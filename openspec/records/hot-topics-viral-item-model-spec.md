---
record: hot-topics-viral-item-model-spec
task: 把 PRD §6.1 的条目数据模型扩展固化为 OpenSpec change（只落合同，不落实现）
date: 2026-10-18
# ↓ 三字段只在「远程同步」无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（hot-topics-viral-item-model-spec）尚未合并，merge SHA 尚不存在，无法取证收口
sync_backfill_owner: 下一个会话（同一次提交内改写表格行 + 删这三个字段）
---

## 本次执行记录：热门选题条目模型 OpenSpec change（hot-topics-viral-item-model-spec，2026-10-18）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=<本分支 tip>` → 预期 `docs-only=true`（差量仅 `openspec/changes/hot-topics-viral-items/**` 4 个文件 + 本记录），实际读数与两口径 numstat 于下方表格行取证
- 保留门禁：变更类型与隔离 ✅ | 行尾对账 PENDING | 品牌残留 PENDING | 文档同步 PENDING | 执行记录取证 PENDING | 远程同步 PENDING

## 0. 变更类型与隔离声明

| 项 | 内容 |
|---|---|
| 变更类型 | **纯文档/规格**（OpenSpec change 四件套 + 本记录）。零运行时代码、零依赖、零 CI 改动、零平台请求 |
| 分层判定 | 按 AGENTS.md「分层判定只看是否影响运行行为」⇒ 不影响，属 docs-only；但**未**在共享根落盘（见下行） |
| 隔离方式 | **plumbing 路线**：文件写在仓库外 `%TEMP%`，`git hash-object -w` → `GIT_INDEX_FILE=<临时> read-tree origin/main` → `update-index --add --cacheinfo` → `write-tree` → `commit-tree -p origin/main` → `update-ref refs/heads/<分支>`。共享根的工作树、`main` 与他人 ref 全程零接触 |
| 为什么不走既有的「main 上 commit → branch → reset --keep」 | 本轮实测该路径在并发共享根上两次失效：① `--keep` 被他人未提交的 `01-docs/learnings.md` 挡住（`Entry … not uptodate`）；② 退成 `--mixed origin/main` 时 `origin/main` 已前进，工作树留下 69 条幽灵 `D`，需按 `git status --porcelain -z` 精确清单 `git restore --pathspec-from-file=` 逐路径恢复（他人的 `learnings.md`/`CHANGELOG.md` 一行未动）。plumbing 是唯一同时满足分层规则与并发铁律的出口 |
| CCG 判定产物 | 本 PR 变更集内**不含** `.ccg/reviews/*.json`（未走 pre-commit）。`check-pr-exec-record` 的深审欠账只要求 `mode=dual` 产物收口，docs-only 判 SKIP ⇒ 不构成欠账；同型先例为回填 PR（同样走 plumbing、CI 全绿） |
| 决策来源 | 用户 2026-10-18 在两选中明确：「先只把 §6.1 的条目模型扩展做成一份 OpenSpec change」 |

## 1. 门禁结果

| 门禁项 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离声明 | PASS | 见 §0：docs-only + plumbing，未进共享根工作树 |
| 规格先行（先文档再代码） | PASS | 本 change 即"先文档"那一步；实现切片在 `tasks.md` §2/§3 全部未勾并声明阻塞关系（2.3 被 2.1 的取证门禁阻塞） |
| 锚点自证（引用必须可落点） | PASS | 引用的 `### 6.1 前置：条目数据模型扩展` 在 `01-docs/PRD-HOT-TOPICS-SHORTVID-VIRAL-ITEMS-2026-10-17.md` 命中；`channels.js`/`hot-topics-service.js`/`classifier.js`/`scorer.js`/`HotTopics.vue`/`locales/hot-topics/{zh,en}.js`/`01-docs/i18n-glossary.md` 均核实存在（逐个 `-e` / `grep` 读数，不靠记忆） |
| 未核实项处理 | PASS | 抖音官方接口字段/权限/配额/计费登记为 OPEN O-1，并写明取证方法；规格里**没有**任何凭想象写的字段表（对应 spec 的 Requirement 8） |
| 行尾两口径对账 | PENDING | 提交后取 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径；新增文件一律 LF（`hash-object` 前已确认 CR 计数为 0，避免把 CRLF 存进 blob） |
| 品牌残留 / Gate 12c 绝对路径 / doc-gate / exec-record | PENDING | 合并前逐条实跑并回填读数；本记录为唯一强制载体（未往 `.quality-gates.md` 插块、未往 ledger 加键） |
| CHANGELOG 收口 | N/A（如实登记） | 本 PR 只落规格，用户可见行为零变化；适用时机是 `tasks.md` §2 的实现片 |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填会话在同一次提交内改写 PASS + merge SHA 并删除 `sync_*` 三字段 |
