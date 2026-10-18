# 执行记录：gyread-ai-source

- 分支：`gyread-ai-source` ｜ 日期：2026-10-19

## 结论

**解析器与测试落地，但源不启用。** `CATEGORY_BOOSTS.ai` 不含 gyread；源定义保留为
`GYREAD_SOURCE` 常量作技术储备。依据是合规裁决（见下）。

## 远程同步

| 远程同步 | 由门禁推导 |
|---|---|

收口由 `scripts/lib/merge-ledger.js` 按主干历史推导（PR 合并后自动收口，不手写状态词）。
本篇记录随 PR #3943 落地。

## 变更类型与隔离声明

- 运行时代码变更（apps/desktop/electron/**、apps/desktop/src/locales/**）→ 已在隔离 worktree
  `D:\Data\projects\mp-worktrees\mp-gyread-ai-source` 完成；共享主目录未落运行时代码。
- 文档/规格变更（openspec/changes/、01-docs/research/、CHANGELOG.md）→ 同分支就地编辑，随 PR 落地。

## 合规裁决（本 change 的决定性事件）

对抗评审（决策层，codex 后端）提出 BLOCKING-1，已复核属实：

- gyread `robots.txt`：`User-agent: *` 组有 **`Disallow: /news/`**；
  `/news/` 的 `Allow` **只**存在于具名检索 UA 组（OAI-SearchBot / ChatGPT-User / PerplexityBot）。
- 本应用 `DESKTOP_UA` 是伪装 Chrome 的通用浏览器 UA ⇒ 落在 `*` 组 ⇒
  `search-index.json` 与全部 edition 页抓取都在被禁路径上。
- **服务器返回 200 不等于被许可**；伪装 UA 还主动放弃了「我是检索代理」的身份主张。
- `Content-Signal: ai-input=yes` 不覆盖这一条（robots 按 UA 组判定）。

用户裁决：**摘除该源**。已执行 —— 实现与测试保留，启用路径移除。

重新启用前置条件（写进 `GYREAD_SOURCE` 注释）：① 站点运营方新增自报身份 UA 组并获许可；
② 抓取 UA 改为自报身份；③ 挂回 `CATEGORY_BOOSTS.ai.sources` 并补 locales 文案。

## 质量节拍门禁

| 门禁 | 结果 | 证据 |
|---|---|---|
| 会话隔离 | ✅ | `pre-code-edit-guard.ps1` 在共享根 rc=1 正确阻断；`start-mp-task.ps1` 建 worktree + `verify-worktree-deps` OK |
| TDD 先红后绿 | ✅ | 首跑 23 failed / 5 passed → 末态 32 passed |
| 决策层对抗评审 | ✅ | `plan-review.sh` 判定 SINGLE；`codeagent-wrapper.exe` ETIMEDOUT 后改 codex 后端完成评审（6 BLOCKING + 6 MINOR） |
| 定向测试 | ✅ | `hot-topics-gyread.test.js` 32/32 |
| 既有回归 | ✅ | hot-topics 全套 178/178；`content-categories` 14/14 |
| Lint | ✅ | `cd apps/desktop && pnpm run lint` rc=0 |
| locale 成对 | ✅ | `check-locale-sync --keys`（2123 key）PASS；`--pair-base origin/main` PASS |
| 品牌残留 | ✅ | `check-no-brand-residue` PASS（10282 文件） |
| 行尾/编码 | ✅ | CHANGELOG CRLF=22296、裸 LF=0；新增文件已统一 CRLF；`--numstat` 两口径一致 |
| QM-1 打包 | ✅ | `electron-builder --win --dir --publish never` rc=0 |

## 评审修正项（逐条落地）

| # | 评审发现 | 处置 |
|---|---|---|
| B1 | robots 合规边界不成立 | **摘除源**（用户裁决）；依据与启用条件写进代码注释与 design.md §2.4 |
| B2 | enrich 绕过限流/熔断、无 URL 去重 | 已加按 `url` 去重；全失败出声 + 回归锁。独立配额键登记为遗留（源已不启用，暂不需要） |
| B3 | 补拉路径缺「空列表记失败」 | 登记为遗留（源不启用则无该路径）；若启用须一并落地 |
| B4 | `editions[0]` 兜底制造张冠李戴 | **已删除**；匹配不上即不挂链接 + 回归锁 |
| B5 | 双字歧义词单词即成类（全渠道） | strong 只收 ≥3 字；双字歧义词降 weak；补 6 条非 AI 负例 |
| B6 | interval 60min 与「极保守」自相矛盾 | 登记为遗留；若启用应对齐更新节奏（≥6h）或做条件请求 |

## 未完成项 / 遗留

- gyread 源**未启用**，等合规许可。
- 独立配额键 `gyread-edition`、补拉路径空列表检查：启用时一并落地。
- 「来源可信度自动判废」（实测存在出处张冠李戴）登记为后续迭代。
- `entryUrl` 的前端呈现属 UI 决策，本期不动（避免动视觉回归基线）。
- 建议补运行时 kill-switch（评审 MINOR-3），便于合规问题即时止血。

## 远程同步

由门禁推导（PR 合并后 `MERGE-LEDGER` 自动收口，不手写状态词）。
