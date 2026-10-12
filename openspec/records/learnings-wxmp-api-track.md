---
record: learnings-wxmp-api-track
task: 沉淀微信公众号 API 轨一役的七条教训（含一条仓库级门禁缺陷）
date: 2026-10-12
---

## 本次执行记录：沉淀微信公众号 API 轨七条教训（learnings-wxmp-api-track，2026-10-12）【docs-only】

- **变更类型**：纯文档（`01-docs/learnings.md`）⇒ 共享主工作区就地编辑，仍经 PR 落地。
- **来源**：`wechat-mp-api-track`（PR #3375 → merge SHA `305f3851c782882ec589dbd886df3f4388e53127`）一役的复盘。
  该 PR 已合并；本文只补经验沉淀，不改任何运行时行为。

### 为什么单独一个 PR

`check-pr-exec-record` 对「纯回填（定义④）」的要求是**变更集全部为记录/台账载体**
（`openspec/records/*.md`、`.quality-gates.md`、`scripts/gate-record-debt-ledger.json`），
而 `01-docs/learnings.md` **不属载体** —— 把它夹带回填 PR 会当场失去该豁免（本轮实测：
回填 PR 被 `check-pr-exec-record` 判「未携带执行记录」）。因此按标准路径单独开：
learnings + 本记录 + 台账登记，合并后由回填 PR 收口。

### 沉淀的七条（正文见 `01-docs/learnings.md`）

| # | 教训 | 为什么值得记 |
| --- | --- | --- |
| 1 | `ret === 0` 是「请求被受理」不是「业务完成」 | 假成功**同月第二次**出现（上一轮是「保存成功但草稿没内容」） |
| 2 | 登记表里有 ≠ 配置可用：可达性逐调用方清点 | 同一份代码，桌面路径不可达而 HTTP 发布 API 可达 ⇒ 「死代码」结论会写错 |
| 3 | **门禁的红分两种**：「业务红了」与「判据没跑起来」 | 定位三步（读日志原因 + 本机同参复现 + **横向对照其他 PR**）；缺第三步会把门禁缺陷误判成基础设施抖动 |
| 4 | 门禁扫「变更文件」⇒ 改既有高危文件被连坐的处置口径 | `git show origin/main:<file>` 复现同样高危 + 显式豁免留证；**不得改不相关老代码** |
| 5 | 朴素正则误报的正解是换更好的写法 | `URLSearchParams` 取代手拼 query；**不要**用 `excludePattern` 的噪声词骗过门禁 |
| 6 | 判定「偶发失败」需要两条证据 | 隔离下通过 + 主干基线通过；只凭重跑一次就写「抖动」与把一次观测当定律同型 |
| 7 | `git add -A` 会吞会话产物 | `.ccg/reviews/<sha>.json` 在该目录**历史确有被托管文件**，直觉不成立 |

### 门禁表

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 判定：`classify-docs-only.js --base=origin/main --head=HEAD` | docs-only=true | files=2（`01-docs/learnings.md`、本记录） |
| 变更类型与隔离声明 | PASS | 纯文档就地编辑 + PR 落地，不进 worktree |
| 行尾 / 编码对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相等；`check-text-encoding-integrity.js` 无新增损坏 |
| 品牌残留 | PASS | `check-no-brand-residue.js`（文档只写「参考产品」） |
| 文档同步 | PASS | 新增本记录；learnings 属文档，doc-gate 由 `01-docs/` 命中 |
| CHANGELOG | N/A | 纯经验沉淀，无用户可见行为变化 |
| 远程同步 | PASS | PR #3386 已 squash 合并，merge SHA `6daf48bd26ed2114ffd317064d6bd6ed8ca011a6`（committer 2026-10-12T09:37:11+08:00）；取证 `git log origin/main --grep='(#3386)$' --format=%H|%cI` **唯一 1 行**命中；`git ls-remote --heads origin learnings-wxmp-api-track` 返回 **0 行**，证远端分支已删；`sync_*` 三字段已在同一次回填提交中删除（本条无台账登记项：记录文件的 `sync_*` 字段本身即该源的登记机制，本轮实测额外加台账键会被判陈旧项） |

### 遗留

无。本 PR 不含运行时改动，也不改变任何门禁判据。
