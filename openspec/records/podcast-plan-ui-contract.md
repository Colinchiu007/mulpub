---
record: podcast-plan-ui-contract
task: 把 ②-b 未实现一半的合同钉进 PRD §7.10.3.1（浮层落点/组件接口/挂起登记/文案键/验收清单）
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 与合并时间还不存在；合并后由本会话开回填 PR，把「远程同步」行改成 PASS + merge SHA，并在同一次提交删除本段三个字段
sync_backfill_owner: podcast-plan-ui-contract 会话（本节作者）
---

## 本次执行记录：②-b 合同先行（podcast-plan-ui-contract，2026-10-17）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格变更（PRD 新增一节 + 本记录），零运行时代码改动。按分层规则就地编辑 + 经 PR 落地，不进 worktree。 |
| 判定（docs-only） | PENDING | commit 后跑 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD`，结果写回本行。 |
| 行尾/编码对账 | PENDING | 待跑 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径比对；驱动逐行保留行尾并断言 CR 总量守恒（写盘前断言，实测不过即不落盘）。 |
| 品牌残留 | PENDING | 待跑 `node scripts/check-no-brand-residue.js`；本文只写「参考产品」口径。 |
| 文档同步 | PENDING | 待 `openspec-sync-check`；本片只加规格节，不改既有 Requirement。 |
| 远程同步 | PENDING | 本 PR 合并后取 `git log origin/main` 的尾注回填 merge SHA 与时间、`git ls-remote --heads origin podcast-plan-ui-contract` 返回 0 行证远端分支已删，并在同一次提交删除本段三个 sync_* 字段 |

- 保留门禁：判定 docs-only PENDING | 行尾对账 PENDING | 品牌残留 PENDING | 文档同步 PENDING | 远程同步 PENDING

## 一、为什么这一片只写合同不写实现

②-b 的机械半边（主进程通道 `podcast:episode:publishFromScript` + preload 键 + 桥接导出 + bundle 重生 + 三处清点式守卫）已实现并实测 `131 passed / 7 files`（含 `electron/tests/ipc-contract.test.js` 的双向对账），但它按 PRD §7.10.6 **不允许单独合并**（无消费者的通道属装饰性链路）。剩余是计费确认浮层、文案库入口与三把 locale 键，加上 QM-1 打包与 QM-6 双模型评审——本会话额度做不完，且**不能把半片伪装成一片合进去**。按既有实践「额度不够时把下一片合同先写进 PRD/spec，并明写这不是实现」，本节把下一实现者会猜错的四个点钉死：

1. **落点不是新建文件**：`PodcastEpisodeEntry.vue` 已存在且承载成片链（本会话实测：误覆盖后按 `git checkout HEAD -- <精确路径>` 还原，行数回到 80、该路径 status 归零）。实现要么在该族上扩 `mode`，要么换名。
2. **bundle 改动面只有两份**：`build:preload` 重写 4 份产物，但 `monitor` / `stealth` 不含播客面，重建后逐字节等于 HEAD，其 ` M` 是行尾/stat 噪声——产物级锁只该断言真正含播客面的那两份。
3. **文案键的时机**：三把 `podcast.episode.plan*` 的键驱动已写好但故意没跑，因为浮层引用它们之前落键就是死键（AGENTS 明令禁止）。
4. **入口的点击语义**：文案库整卡是 `role=button` + `@click=openDetail`，次级动作必须独立按钮 + `@click.stop`。

## 二、本片不碰的东西（如实写）

- 不动 WIP 分支 `podcast-episode-plan-ui`（commit `9fdec1fd2`）的内容，也不为它开 PR。
- 不改 CHANGELOG：本片是内部规格，未改用户可见行为（docs-only 快速通道的 CHANGELOG 项口径是「如适用」）。这同时把与热点写面的并发冲突面降到两份文件。
- 不勾 tasks 4.3②-b（实现未落），也不动 4.5 的未勾状态。

## 三、写入时间

2026-10-16T17:54:26+00:00
