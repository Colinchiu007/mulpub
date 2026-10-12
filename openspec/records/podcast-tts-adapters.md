---
record: podcast-tts-adapters
task: 刀 4 第 3 片·接线——TTS 生产适配层四个工厂（generateTTS / voice readers / concat / probe）
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写为 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账 → worktree 清理）
---

# 播客刀 4 第 3 片·接线：TTS 生产适配层（podcast-tts-adapters，2026-10-12）

> 分支 `podcast-tts-adapters`（隔离 worktree `D:Dataprojectsmp-worktreesmp-podcast-tts-adapters`，**非 C 盘**）。规格见 PRD §7.4.9。

## 证据

| 项 | 值 |
| --- | --- |
| 行为锁 | 22 passed / 0 failed（含 C1/H1/M1 的三条新增回归锁；数字为修复后在当前工作树实跑） |
| 变异 M1 | 把 `degraded: data.degraded !== false` 改成 `=== true`（未知形状当成功）⇒ 恰好 1 条指名红；已还原并断言在位 |
| 真实进程 / 出站 | 零（spawnImpl / fsImpl / assetGenerator 全注入；结构锁断言本文件不含 node:child_process） |
| QM-1 打包 | 已实测（2026-10-12 本机 pnpm exec electron-builder --win --dir --publish never）：日志 0 条 error、asar integrity 已写入；产物 apps/desktop/dist-electron/win-unpacked/Multi-Publish.exe = 239,075,328 字节；asar list 命中 electron/services/podcast-episode-tts-adapters.js（本片新增适配层确已进入交付产物）；打包前 verify-worktree-deps = OK（11 项解析到当前 worktree）；构建副产物 preload/index.bundle.js 不在 PR 文件集内 |
| QM-6 双模型 | 后端评审（claude）3 条全部采纳并已修复，逐条如下（前端 opencode 报告另计）：

| # | 级别 | 发现 | 处置 | 反证 |
| --- | --- | --- | --- | --- |
| C1 | Critical | `createConcatBlocks` 收了 `gapSec` 却从不使用，块间静音**整段是 no-op**——本层声称的核心行为实际没发生 | 先用 `anullsrc` 预物化与块同容器的静音片段，列表按 `块/静音/块…` 交错；生成失败即 `PODCAST_TTS_CONCAT_FAILED` 拒绝整次（不得退化成无间隔）；单块或 `gapSec` 缺失/为 0 时不生成，返回 `gapInserted:false` | 新增 4 条锁（交错与 `-t` 值、单块不生成、生成失败拒绝且**列表一次都没写**、gapSec 缺失不插） |
| H1 | High | `createGenerateTTS` 只给 `providerId`/`provider`/`model`，而 `AssetGenerator` 认的是 `voice_provider`/`voiceProvider`（`getConfiguredProvider`，`:1027`）与 `voice_model`/`voiceModel`（`:1072`）⇒ provider 恒 `null`，静默落到 edge 兜底，配置的 provider **从不生效且无日志** | 六个键一起给（音色 2 + provider 2 + model 2）；PRD §7.4.9 第 2 条补 2b 小节，把"键名按调用方契约"显式扩到**路由键** | 新增锁逐键断言 `opts.voice_provider` 等在位 |
| M1 | Medium | concat 列表没归一 Windows 反斜杠，`C:\...` 会被 demuxer 当转义序列（仓内既有 `_plainConcat` 是归一的） | 写列表前 `split(BSL).join("/")` 再做单引号转义 | 新增锁：反斜杠路径断言列表内不出现 `\tmp`，且带单引号的文件名转义仍正确 |

当前行为锁实跑：**22 passed / 0 failed**（原 16 条 + C1 四条 + H1 一条 + M1 一条）。评审同时确认无问题的部分（降级 fail-closed、`invoke_failed` 不外冒、偏好键逐字一致、零出站与结构锁、probe 只认实测）已在报告内逐项复核，未采信"看起来正确"以外的推断。 |

## 与 #3376 / #3372 / #3368 的关系

本层是 §7.4.8 编排层四个注入参数的生产实现，**尚未接 `podcast-episode-host.js`**（宿主选择 producer 的分支属下一片 4.3），因此本片不改任何既有行为、不新增 locale 键。

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写为 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

