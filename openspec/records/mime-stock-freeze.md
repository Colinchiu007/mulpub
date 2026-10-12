---
record: mime-stock-freeze
task: 把 tasks 4.4 存量 mime 一次性固化写成可实现的合同（PRD §7.9），并明写这不是实现
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 docs PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

# 存量 mime 一次性固化的合同（mime-stock-freeze，2026-10-12）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（提交后取证）→ 结果见下表
- 做了什么：PRD 新增 §7.9（六小节：事实前提 / 固化动作 / 数据校验与失败语义 / 交互与显示项 + 提示文字 zh-en 三条 / 七条回归锁清单 / 故意不做项）。
- **这不是实现**：`episodes.json` 的固化代码、`compliance` 的 `stock` 档、locale 三对键都**尚未落地**，tasks 4.4 仍挂未勾。本节的作用是把「下一片不能再重新讨论的口径」先钉死，避免实现时另立判据。
- 为什么现在写合同：§7.6 严格校验与 `compliance` 已在主干生效，存量被整批读成不合规的风险是**当下的**；而本片的实现在另一条在飞链（刀 4）之后。合同先行可以让实现片一到即按表施工。

## 本地门禁

| 项 | 值 |
| --- | --- |
| 行尾对账 | 见下表实跑（两口径必须一致） |
| 品牌残留 | `node scripts/check-no-brand-residue.js` 见下 |
| 文档同步 | 随 CI doc-gate |
| 远程同步 | PENDING |

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写为 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

