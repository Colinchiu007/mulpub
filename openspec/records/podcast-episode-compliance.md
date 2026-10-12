---
record: podcast-episode-compliance
task: 把单集 compliance 标记（含 §7.9.5 第 4 条要的 stock 档）写成可实现合同 PRD §8.2
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 docs PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

# 单集 `compliance` 标记的合同（podcast-episode-compliance，2026-10-12）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（提交后取证）→ 见下
- 变更类型与隔离声明：纯规格/文档；走隔离 worktree `mp-podcast-episode-compliance`（分支同名，非 C 盘）经 PR 落地
- 保留门禁：行尾两口径对账 ✅ | 品牌残留 ✅ | 文档同步 PENDING（随 CI） | 远程同步 PENDING

## 为什么先写合同

实测 `compliance` 在播客域**完全不存在**（`git grep -l compliance` 只命中 `prompt-evolution` 与 `tag-suggest`）。
§7.9.5 第 4 条要的是"给 compliance 增设 stock 档"，但本体没有可加——先加就是只有一档的半成品。
本节把本体合同钉死：闭集三态、旁路降级为"键缺席"、判据只读重跑不自写、显示项与 zh/en 提示文字四条、七条回归锁、故意不做三项。

**这不是实现**：`episode:list` 未加 `compliance` 键、locale 四对键未写，§7.9.5 第 4 条与 tasks 4.4b② 均保持未完成。

## 锚点自证（上一片刚因悬空引用被评审命中，这次先验证再引用）

- `## 9. 数据校验（三层）`：PRD 内命中（本节的插入锚点就是它，未命中即抛）；
- `§8.1 频道目录域、托管域与错误码的提示文字`：命中，故新节编号取 §8.2；
- openspec Requirement「单集写入必须按内容校验且区分严格模式」：命中于 `specs/podcast-oneclick-publish/spec.md`；
- `podcast:episode:list`：命中于 `ipc-handlers/podcast.js`；
- `podcast-error-codes.test.js`：文件存在（其 PRODUCERS 清单即第 7 条锁要同步的那一份）。

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写为 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

