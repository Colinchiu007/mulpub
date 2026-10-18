# 执行记录：gyread-ai-source

- 分支：`gyread-ai-source` ｜ 日期：2026-10-18

## 变更类型与隔离声明

- 运行时代码变更（apps/desktop/electron/**、apps/desktop/src/locales/**）→ 已在隔离 worktree
  `D:\Data\projects\mp-worktrees\mp-gyread-ai-source` 完成；共享主目录未落运行时代码。
- 文档/规格变更（openspec/changes/、01-docs/research/、CHANGELOG.md）→ 同分支就地编辑，随 PR 落地。

## 质量节拍门禁

| 门禁 | 结果 | 证据 |
|---|---|---|
| 会话隔离 | ✅ | `scripts/pre-code-edit-guard.ps1` 在共享根返回 rc=1 并正确阻断；`start-mp-task.ps1` 建 worktree 并 `verify-worktree-deps` OK |
| TDD 先红后绿 | ✅ | 首跑 23 failed / 5 passed（RED）→ 末态 28 passed（GREEN） |
| 定向测试 | ✅ | `hot-topics-gyread.test.js` 28/28 |
| 既有回归 | ✅ | `new-sources` 19 + `boost-classify` 6 + `classifier` 32 + `service` 56 = 113/113 |
| Lint | ✅ | `cd apps/desktop && pnpm run lint` rc=0 |
| locale 成对 | ✅ | `check-locale-sync --keys`（2123 key）PASS；`--pair-base origin/main` PASS |
| 品牌残留 | ✅ | `check-no-brand-residue` PASS（10282 tracked 文件） |
| 行尾/编码 | ✅ | CHANGELOG 追加后 CRLF=22297、裸 LF=0 |
| 全量测试 | 🔄 | `pnpm test` 后台运行中（结果见 PR 正文回读） |
| QM-1 打包 | ⬜ | 本次改动在 `apps/desktop/electron/services/**`（主进程，非 `electron/` 根），按仓库口径 QM-1 触发条件是 `apps/desktop/electron/` 下代码变更 —— 命中。待全量测试后补跑 `electron-builder --win --dir` |

## 保留门禁（docs 口径不适用：本次是混合 PR，含运行时代码）

- 行尾/编码对账：`--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（CHANGELOG 零裸 LF）
- 品牌残留扫描：PASS
- 文档同步：研究报告 + openspec 五件套 + CHANGELOG 已同分支落地
- 远程同步：由门禁推导（PR 合并后 `MERGE-LEDGER` 自动收口，不手写状态词）

## 关键决策（供评审对照）

1. **挂 `CATEGORY_BOOSTS.ai` 而非 `CHANNEL_CONFIGS`** —— gyread 是日报不是热度榜，
   进主渠道会污染 scorer 的热度归一 / 名次兜底 / `sourceBonus`。
2. **`enrichWithEdition` 必须 fail-open** —— 站点 2026-10-17 刚换过版式，
   一次版式变动丢掉全部 AI 选题的代价远高于部分条目缺原文链接。
3. **分类器不收单站私活用语** —— `日报`/`情报`/`信号` 无判别力，收录等于为单个信源开后门。
4. **合规边界明示** —— 检索/引用（用户点回原文）而非训练语料，写进代码注释与 design.md。

## 未完成项 / 遗留

- 全量测试与 QM-1 打包结果随 PR 回读补记。
- 「来源可信度自动判废」（实测存在出处张冠李戴）登记为后续迭代，本期只透出链接。
- `entryUrl` 的前端呈现（是否加「查看当日日报」入口）属 UI 决策，本期不动（避免动视觉回归基线）。
