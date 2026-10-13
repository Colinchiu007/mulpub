---
record: podcast-mime-stock-freeze
task: 实现 PRD §7.9 的存量 mime 固化判据与回归锁（不接宿主，不建 compliance 档）
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账 → worktree 清理）
---

# 播客存量 `mime` 一次性固化：判据与锁（podcast-mime-stock-freeze，2026-10-12）

> 分支 `podcast-mime-stock-freeze`（隔离 worktree `D:Dataprojectsmp-worktreesmp-podcast-mime-stock-freeze`，**非 C 盘**）。合同 = PRD §7.9，落地状态 = §7.9.7。

## 这一片做了什么、故意不做什么

做：`freezeStockMimeInArray`（纯派生：合法值原样返回、缺席/非法按扩展名派生、派生不出计入 unresolved）+ `freezeStockMime`（恰好一次、幂等、按 channelId 走注入锁、单频道抛错跳过并 warn、六实现缺任一即抛）+ `stockMimeTable`（容器判据**由抽取层 `planAudioCodec` 派生**，不留第二份字面量集合）。

不做（拆进 tasks 4.4b）：宿主接线、`compliance` 的 `stock` 档、频道页摘要与 locale 三对键。判据先行的理由与 §7.9 相同——存量被整批判死的风险是当下的，而 UI 那半边依赖尚未合并的链路。

## 证据

| 项 | 值 |
| --- | --- |
| 行为锁 | 12 passed / 0 failed（`podcast-episode-stock-mime.test.js`，含真实 `os.tmpdir()` 落盘 + 关闭重开同一文件的往返） |
| 变异 M1 | 「合法值不再原样返回」⇒ **2 条指名红**（只补不改 / 键序），还原后 12 passed |
| 变异 M2 | **未建立**：两次尝试因锚点少写 `extOf(` 而没落进文件，脚本当场断言 `M2落盘: false` 并如实弃用；「不猜」这条目前只有行为证据，已写进 §7.9.7 与 4.4b 第④项 |
| 恒真断言自查 | 「判据同源」那条初稿写成 `[...legal].sort()).toEqual(X && [...legal].sort()`（自比自，恒真），已改为与 `planAudioCodec` 两条计划逐字相等 + `ext` 双向断言 |
| QM-6 前端评审（opencode）两条 | **均已处置**：① 悬空引用——§7.9 引用了并不存在的 §7.6 / §7.7（实测 `compliance` 与严格校验的真实锚点是 §9 与 §8 + openspec 契约 Requirement，锁的唯一实现是 `podcast-channel-locks.js` 的 `createKeyedLocks`），已全部改指真实锚点，改完后**全仓 §7.6/§7.7 引用数 = 0**；② `stockMimeTable` 用「喂单一编码器清单」的方式**重载式复用选型 API** 反推容器表（源层一改判据顺序就会静默少一条）——正解是把表提为一等导出：`podcast-episode-source.js` 新增 `AUDIO_CONTAINER_PLANS` + `ttsAudioContainers()`（只读副本），`planAudioCodec` 与固化层**同读这一张表**，并加漂移锁逐条断言两个 API 对同一 codec 返回 `codec/ext/mime/args` 全等、且调用方改副本不污染源表 |
| 消费者回归（改源层必跑并集） | `podcast-episode-source` + `podcast-episode-extract` + 本片 = **43 passed / 0 failed**；eslint 三个改动文件 rc=0 |
| 真实进程 / 网络 | 零（`listChannels` 等六个实现全注入；本层不 require `node:fs` 也不起进程） |
| QM-1 打包 | ✅ 已实测（2026-10-12 本机 `pnpm exec electron-builder --win --dir --publish never`）：日志 0 条 error、asar integrity 已写入；产物 `apps/desktop/dist-electron/win-unpacked/Multi-Publish.exe` = 239,075,328 字节；`asar list` 命中 `\electron\services\podcast-episode-stock-mime.js`（本片新增服务确已进入交付产物）；构建前 `node scripts/verify-worktree-deps.js` = OK（解析到当前 worktree，不借别人分支的链接）；构建副产物 `preload/index.bundle.js` 已按精确文件清单回退，不在 PR 文件集内 |
| QM-6 双模型 | **未拿到后端轴的 findings**（派发失效，失效形态已逐条记在 `openspec/records/podcast-episode-tts-entry.md` 的 QM-6 段，本处不重复抄）；前端轴的两条发现**已处置**（见上一行）。按使用者逐片裁决**免除本片外部评审并直接合并**——2026-10-14 原话「这两片（存量播客单集 mime 固化 + 它的宿主接线）要免外部评审直接合」，裁决范围**只给 #3382 / #3387**，不得外推到其他 PR（含 #3376）；裁决物证 `D:/Temp/qm6-3382-acked.txt`。不自扮演豁免：这一行的成立依据是使用者裁决，不是"评审通过"。 |

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写为 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

