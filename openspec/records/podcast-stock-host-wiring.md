---
record: podcast-stock-host-wiring
task: 把 §7.9 的存量 mime 固化接到真实调用路径（ipc-handlers/podcast.js 的 getService），并守住"旁路不伤人"
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账 → worktree 清理）
---

# 播客存量 mime 固化的宿主接线（podcast-stock-host-wiring，2026-10-12）

> 分支 `podcast-stock-host-wiring`（worktree `D:Dataprojectsmp-worktreesmp-podcast-stock-host-wiring`，非 C 盘）。合同 = PRD §7.9；判据实现 = #3382 的 `podcast-episode-stock-mime.js`（本片把它接上）。

## 触发点为什么选这里

`ipc-handlers/podcast.js` 的 `getService(channelId)` 是「首个需要该频道数据的调用」在本仓的真实落点——所有读写 `episodes.json` 的通道都先经它取服务。不新造定时器：定时器会引入「什么时候算首个」的第二个答案。

## 三条口径（各对应一种静默故障）

1. **旁路**：装配或固化失败只 `warn`。让一次历史数据补齐把用户的频道列表读请求打挂，是把两个不相关问题绑成同一个故障。
2. **进程内一份实例 + 落盘幂等**：跨进程的"已做过"只看 `index.json` 的 `stockStamp.at`（由 `freezeStockMime` 自己判）。这里再判一次，两处判据下次改动必漂移成「一处说做过、一处说没做」。
3. **不 await、不阻塞关键路径**：固化补的是历史数据；列表请求不该为它排队。写盘走 `tmp + rename` 原子替换（用户状态不允许半份文件），真实宿主若要接既有 rename 重试策略，在装配点注入 `writeJsonAtomic` 即可——本层不复制第二份重试。

## 证据

| 项 | 值 |
| --- | --- |
| 行为锁 | 7 条（真 fs 落盘补齐 + 进程内恰好一次 + 已固化静默跳过不写文件 + 抛错旁路只 warn 不外冒 + 缺 registry 即抛 + 结构锁接线在位 + 缺省写盘必须是 tmp+rename） |
| 消费者回归 | `electron/ipc-handlers/podcast.test.js` 20 passed（接线未破坏既有通道行为） |
| 合计 | 27 passed / 0 failed |
| 真实网络/进程 | 零 |
| QM-1 打包 | PASS | 本机 `pnpm exec electron-builder --win --dir --publish never` rc=0（耗时 333s，electron 43.7.7 / electron-builder 25.1.8）；打包前 `node scripts/verify-worktree-deps.js` OK（11 项消费方解析到本 worktree），旧产物目录改名挪走而非递归删除，故 `dist-electron` 为空 ⇒ asar 命中只能来自本分支；`asar list app.asar` 逐条命中：`podcast-stock-freeze-host`=1、`podcast-episode-stock-mime`=1（同表内 `podcast-episode-tts-run`=0、`podcast-episode-tts-adapters`=0，因二者属 #3376/#3377 不在本分支 diff 内，0 命中反向证明产物归属）；`Multi-Publish.exe --user-data-dir=<临时目录>` 9 秒存活、`Get-Process Multi-Publish` 计数=1、stderr 64 字节且四类致命模式（Failed to load platform config / PluginLoader mkdir failed / ENOTDIR app.asar / Cannot find module）命中数=0 |
| QM-6 双模型 | **未拿到后端轴 findings**（派发失效，形态见 `podcast-episode-tts-entry.md` 的 QM-6 段）。按使用者 2026-10-14 逐片裁决**免除本片外部评审**（原话「这两片（存量播客单集 mime 固化 + 它的宿主接线）要免外部评审直接合」，范围只给 #3382 / #3387，不外推 #3376），物证 `D:/Temp/qm6-3387-acked.txt`；不自扮演豁免——成立依据是裁决不是“评审通过”。**重建时的第二处处置**：本分支 tip 自带的 `podcast-episode-stock-mime.js` 是 #3382 接受 QM-6 前端评审**之前**的旧副本（用 `[planAudioCodec("libmp3lame"), planAudioCodec("aac")]` 反推容器表；评审后正解是一等导出 `ttsAudioContainers()` 直读表）。本层只 require 其中的 `freezeStockMime`，两版同名同形 ⇒ 编译与测试对这类回退完全失明；正解是重建时把 stock-mime 与 source **两份一起排除**，判据取「`git diff HEAD` 对这两个文件为空」，且磁盘版本必须命中 `ttsAudioContainers`。 |

## 与合同的差集（不虚报）

任务勾账说明：4.4/4.4b 两条行由 **#3382**（未合并）引入，本分支基线里没有，因此**不在此处勾**——rebase 到 #3382 之后再把 4.4b 的 ① 打上 ✅ 并补证据行（避免把不存在于行上的项凭空新增一份，造成两条并存的 4.4b）。

未做项照旧：PRD §7.9.5 第 4 条（`compliance` 的 `stock` 档）、频道页摘要与 locale 三对键、以及 §7.9.7 里记的 M2 变异反证仍未做——**4.4b 的 ① 已完成、②③④ 未动**，因此 4.4b 整条保持未勾。

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写为 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

