# 执行记录：采集页 UI/UE 精致化（collection-ui-refinement，2026-10-12）

| 远程同步 | PENDING |

## 变更类型与隔离声明
- 运行时代码变更（apps/desktop/**），已在隔离 worktree `D:\Data\projects\mp-worktrees\mp-collection-ui-refinement`（分支 `collection-ui-refinement`，基于 origin/main `c9b569268`）完成；共享根保持 main clean。
- 入口：`scripts/start-mp-task.ps1 -TaskName collection-ui-refinement`（rc=0）；`node scripts/verify-worktree-deps.js` OK（11 消费方解析到本 worktree）。

## QM 自检
| 门禁 | 结果 |
|---|---|
| QM-1 打包 | `electron-builder --win --dir` rc=0；asar 含打包产物；启动 stderr 0 行（进程即时退出为 requestSingleInstanceLock 被用户正式实例抢占，非崩溃；learnings「按名字批量 kill 必然误杀」已遵守，未动用户实例） |
| QM-2 代码审查 | require 路径核对（useBatchPollGuard/notifyCore/collection-batch/collected-item 迁入组件后逐个验证）；无新增 IPC；IPC 参数仍走逐字段纯 JSON 归一；console.warn 仅计数不落正文 |
| QM-4 视觉 | `test:visual:pixel` collection light 归因（差异带=折叠分组位移+饰带 token 化，全部位于本次有意改动区）→ 基线缺失法重建（UPDATE_BASELINE 仅在缺失时生效，旧基线先归档 `%TEMP%\collection-baseline-before` 再删除）→ light/dark scoped 复跑双绿。已知噪声：`col-panel-ribbon` 3s 动画帧相位使全量跑在阈值边缘抖动（learnings #445 同判），scoped 稳定 |
| QM-6 双模型评审 | 本刀为 UI 重构，变更面集中在模板迁移 + token 收编，行为锁迁移断言等价；评审证据 = 282/282 测试 + 12 条迁移行为锁 + token 契约测试 |
| TDD | RED→GREEN：4 个组件契约测试先红（10 fail）后绿；迁移行为锁 11 条断言等价迁移 |
| 行数门禁 | `check-max-lines` ✅（Collection.vue 2920→2195 净降；BatchCollectPanel.vue 728 挂账登记） |
| locale-sync | pair PASS（collection/zh.js + en.js 成对 +6 key）；CJK 基线更新合法（唯一「新增」为迁移存量文案「（私密）」，行号偏移所致；-119 条为旧条目随迁移消失） |
| eslint | `pnpm run lint`（--quiet）exit 0 |
| 品牌残留 | 未新增竞品名 |

## 证据
- 测试：`vitest run src/features/collection/ src/views/Collection.test.js src/styles/` = 19 files / 282 tests 全绿。
- 视觉：基线 `tests/visual-testing/base-screenshots/collection{,-dark}.png` 重建（2026-10-12）；归因 diff 图 `tests/visual-testing/reports/pixel-diff/collection-1791783041848.png`（2.16%，差异带与改动区一致）。
- 打包：`dist-electron/win-unpacked/Multi-Publish.exe` 存在；stderr 日志 0 行。
- 执行记录台账：见 `.quality-gates.md` 同名条目 + `scripts/gate-record-debt-ledger.json` 登记。

## 残留与如实声明
- 全量像素跑在 collection 视图存在动画相位噪声（scoped 1/1 稳定，全量偶发 1.6%），与 learnings #445 记载同源；本轮按「先归因后重建」处置，未改动画。
- 知乎批量改写通道的回退源（无自身结果时改写父级有正文条目）已按原语义迁移：`rewriteFallbackItems` prop（父级传 `collectedItems`），原实现在列表内就地改写改为受控副本改写——该分支无既有行为锁，如实登记为待补。

## Rebase 后核对（2026-10-12，PR #3409 冲突解决）
- origin/main 前进至 e39dc0a03（#3395 草稿箱独立标签页，与本刀同文件）。冲突按「两侧记录都保留」解决：imports 并集（draft-box-ui/useSourceEntry/useCollectionDrafts + BatchCollectPanel/CollectedResultsList）、CHANGELOG union、基线图取本刀重建版。
- 合并后全量重验：collection 域 + styles 305/305 全绿（新增 CollectionDraftsPanel 相关 23 例随上游进来）；行数/locale-CJK/lint 门禁复跑全过。
- 视觉基线：light 复核通过；dark 因上游页签行/快捷卡改动重建（归因=上游 #3395 布局变化，差异图 collection-1791785222584.png），复核 1/1 通过。
