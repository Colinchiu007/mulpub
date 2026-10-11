---
record: podcast-episode-synth
task: 刀 4 第 2 块——逐块云端 TTS 合成 + 块间显式静音 + 拼接后实测（extractMix 的等价替身）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写为 PASS + merge SHA，并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（同一 agent 收尾链：合并 → 回填 → 销账 → worktree 清理）
---

# 本次执行记录：播客刀 4 第 2 块：逐块 TTS 合成与块间静音（podcast-episode-synth，2026-10-11）

> 分支 `podcast-episode-synth`（隔离 worktree `D:Dataprojectsmp-worktreesmp-podcast-episode-synth`，**非 C 盘**）。

## 做了什么

- 新增 `apps/desktop/electron/services/podcast-episode-synth.js`：`synthesizeEpisodeAudio`（串行逐块、降级逐块记账、块间静音闭集、拼接后实测三件套、时长下限）；分块判据仍只有 `planChunks` 一份，本层不另写切分。
- 新增 `podcast-episode-synth.test.js` **13 条**：全部注入假实现，零真实出站；关键锁包括「degraded 必须拦在 probe 之前（probe 一次都不能被调用）」「每块恰好一次调用＝本层不得二次重试」「失败块没有跳过出口」「取消发生在块之间且不拼接」「短块合法但整段静音必被拦」。
- PRD 新增 §7.4.7：实做落点 + 一处**时长下限的合同偏离**（原句 `块数 × 3s` 会误杀合法短块），按 §7.4 的规矩先改规格再改代码并在 PR 点名。

## 门禁与证据

- `vitest run electron/services/podcast-episode-synth.test.js`：13 passed / 0 failed（本机实跑，日志见 PR 评论）
- `eslint electron/services/podcast-episode-synth.{js,test} --quiet`：0 error（两条 `no-useless-assignment` 已修）
- `scripts/verify-worktree-deps.js`：OK（新 worktree 依赖已就绪，11 项消费方解析指向本 worktree）
- QM-1 打包 **PASS**（本机实跑，2026-10-11）：`pnpm exec electron-builder --win --dir --publish never` → `BUILD_DIR_EXIT=0`；
  产物 asar 清单含本层文件（`asar list app.asar | grep podcast-episode-synth` → `\electron\services\podcast-episode-synth.js`，与 `podcast-episode-publish.js`/`podcast-tts-compose.js` 同目录并列）；
  `asar extract` 后从**解包产物** `require` 本层成功，导出 9 项（`synthesizeEpisodeAudio`/`normalizeGap`/`degradedIssue`/`SYNTH_ERRORS`/`GAP_MIN_SEC`/`GAP_MAX_SEC`/`GAP_DEFAULT_SEC`/`MAX_CHUNK_CODEPOINTS`/`MIN_SEC_PER_CODEPOINT`），
  `SYNTH_ERRORS` 八个码逐字可读（`PODCAST_TTS_CHUNK_DEGRADED` 等），证明 `files` 数组 glob 覆盖到位、无 require 链断裂；
  打包应用真机启动 12s 存活，stderr 中 `Failed to load platform config` / `ENOTDIR.*app.asar` / `PluginLoader.*mkdir failed` **命中 0**；
  现场仅有未登录态的预期 `许可证权限不足`（渲染层环境前置，非本层）与 auto-updater `not-available`（既有静默合同）。启动实例已按 PID 全部终止，`tasklist Multi-Publish.exe` 复测为 0 行。
- QM-6 **PASS（单模型如实记账）**：后端 claude 实跑约 65 分钟，findings = **Critical 0 / Warning 2 / Info 4**（原文固化于 `D:/Temp/qm6-synth-backend-findings.txt`）。
  两条 Warning 均已在**本 PR 内修复并配锁**：① 时长下限 `MIN_SEC_PER_CODEPOINT` 由 0.2 下调为 0.1（0.2 = 5 码点/秒，恰等于常态口播语速上界、零余量，会误杀念得快的合法整期；且与注释自述的「3 码点/秒、留近一倍余量」直接矛盾），同时新增「20 码点念成 3.4s 必须放行」的误杀负控——把常数退回 0.2 该条立刻变红；② `sizeBytes` 的回退写法 `Number(measured.sizeBytes) || stat.size` 让「拼接后字节三处一致校验」在 probe 不报大小时**退化为恒等式**（等于该路没有校验），现改为磁盘实测唯一权威、申报值仅在「它申报了且非 0」时参与对账，异常文案同步改成「申报 vs 磁盘」。
  Info 处置：末块产出后 concat/probe 期间收到取消会白跑一次拼接与实测（真正的拦截在宿主 `podcast-episode-publish.js` 于 uploadAudio 前再次采样并丢弃，已产出块文件由宿主按 §7.4.4 统一清理），已在本层注释言明，属有意取舍而非漏判；测试注释「24 码点 ⇒ 4.8s」失真（实测 20 码点 ⇒ 下限 2.0s）已改真，反例时长 2s→1.5s。
  **前端 opencode 三次实跑均未产出结构化 findings**（第 1 次零输出、第 2 次只交计划并停在 SESSION_ID、第 3 次 `completed without agent_message output`）⇒ 本片记为 **critic-only（后端 1 个外部模型）+ 主代理逐条处置**，不冒充「双模型通过」；AGENTS 的「前端失败最多重试 2 次、3 次全败才跳过」已用满。
  修复后本层测试实跑 **13 passed / 0 failed**（含新增负控）。
- 尚未做：真实 provider 往返与真机端到端（需凭证，属刀 4 第 3 片接线时一并交付）；该项**未闭合**，不做自我豁免

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后回填 PASS + merge SHA，并在同一次提交删除 ledger 登记项与本文件 frontmatter 的三个 sync_ 字段 |
