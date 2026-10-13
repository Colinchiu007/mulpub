---
slug: podcast-episode-tts-entry
branch: podcast-episode-tts-entry
date: 2026-10-13
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 后续 docs PR（回填链）
sync_pr: pending
---

# 文本出期主进程层（podcast-episode-tts-entry）

## 变更类型与隔离

- 运行时代码：`apps/desktop/electron/services/podcast-episode-host.js`（新增 `publishFromScript`，`probe` 及之后逐字复用同一条编排链）与其测试。
- 文档：PRD 新增 §7.10（入参三层判据 / 流程 / 交互 / 显示项 / 逐字提示文字 / 故意不做）；tasks 4.3 拆为 4.3①（本片，已落）与 4.3②（IPC/preload + 三入口 + locale 成对键，未落）。
- 隔离：worktree `D:/Data/projects/mp-worktrees/mp-podcast-episode-tts-entry`（D 盘），分支裸名 `podcast-episode-tts-entry`；未动 CI workflow、分支保护、`CI_IGNORED_PATHS`。

## 数据校验与判据

- 三层判据顺序固定：① 计费同意闸门（只认 `=== true`）→ ② `podcast-tts-compose.validateComposeInput` 逐字转发码与 `issues` → ③ 三个注入实现齐备。
- ③ 必须发生在取锁与任何磁盘写**之前**；合成层自己有同名兜底码，因此「码相同」不构成证据，判据是副作用缺席（`mkdir` 次数为 0、忙标记未被占用）。
- 块级 `degraded` 由合成层汇总成整期拒绝 `PODCAST_TTS_CHUNK_DEGRADED`；文本链零真子进程（concat/probe 皆注入）。

## 测试

- `vitest run` 5 个播客套件 123 passed（host 51 / publish / synth / tts-adapters / compose），证明把 `publishFromVideo` 重构进 `runChain` 未回归成片链。
- 变异反证 M10–M14：M10 计费闸门、M11 未真正换站、M12 注入缺席检查失效、M13 宿主自写内容判据、M14 finally 收尾摘掉；各自让**指名**用例变红，还原后重跑全绿。
- M12 首轮曾报「红 0 条」：原因是宿主与合成层用**同一个码** `PODCAST_EPISODE_INVALID`，只断言码无法区分两层 ⇒ 加副作用缺席两条断言后才可分辨（防重叠不可分辨，非放宽断言）。

## QM-1 打包证据

| 远程同步 | PENDING | 待本 PR 合并后就地改写为 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

- `node scripts/verify-worktree-deps.js` OK（11 项解析到本 worktree）。
- `pnpm exec electron-builder --win --dir` rc=0；产物 `dist-electron/win-unpacked/resources/app.asar` 内 `index.bundle.js` 命中 1，且 `publishFromScript` 在产物中出现 **4** 次（主进程代码落 bundle，先例同「QM-1 文案落 index chunk」）。
- 致命模式 `Failed to load platform config` / `mkdir failed` / `app.asar` / `ENOENT.*resources` 各 0 命中。
- **启动存活已闭合（根因不是代码）**：首跑 `alive_processes=0` 的真因是**全新 worktree 里没有渲染层产物** —— stderr 实录 `Failed to load URL: .../app.asar/dist/index.html with error: ERR_FILE_NOT_FOUND`，而 `apps/desktop/dist` 是 gitignore 的构建残留，`--dir` 打包只是把它捆进去。补跑 `pnpm run build`（rc=0，`dist/index.html` 991 B，并顺带产出 `Multi-Publish.Setup.0.2.0.exe`）后重新打包启动：**约 90 秒后 `Multi-Publish` 进程数 = 4**，stderr 仅一条 `DEP0180 fs.Stats` 弃用告警，四类致命模式与 `ERR_FILE_NOT_FOUND` 均 **0 命中**；验证完成后按 PID 逐个停止本 worktree 自有实例（`total_before=4 → total_after=0`，未批量杀名）。附带一条 QM-1 现场教训：**遗留的 app 实例会锁死产物目录**，`pnpm run build` 曾在 `app-builder.exe ... ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` 上失败一次，先按路径判归属再逐个停止后才能重打包。

## QM-6

- 双模型外部评审本会话共派 4 次，**均未拿到 findings**，两种失效形态各记现场：① 后端 claude 跑到结束报 `claude completed without agent_message output`（wrapper 日志随完成被删，stdout 只剩启动横幅）；② 前端 opencode 三次——其中一次是我自己的prompt 里带了管道符 `Critical|Warning|Info`，被 cmd 当成「管道给名为 Warning 的命令」，`opencode exited with status 255`（教训：**送给 wrapper 的提示词不得含 shell 元字符**，一律落文件再 `tr` 去引号读入）；另两次 opencode 读完文件后输出的是 `Work State / Next Move / Continue if you have next steps` 交接文本而非 findings JSON，属第 3 种形态。opencode 唯一实质量的一条：`TTS_COMPOSE_ERRORS.RUN_ID_INVALID` 的值就是 `PODCAST_EPISODE_INVALID`，所以 runId 这一码同样不能只凭码区分层。
- **不自扮演豁免**：以上如实记为「未拿到外部评审」。本片已获使用者逐片裁决（被告知「CI 全绿只差 QM-6 ack」后回复「给你授权 推进」，2026-10-13），据此免外部评审并挂 GitHub 原生 auto-merge（SQUASH）；裁决物证在 `D:/Temp/qm6-3480-acked.txt`，其中**明写范围只给 #3480**，#3382 / #3387 / #3376 未点名、不得复用本标记。
- CI 侧：本片 10 条 `publishFromScript` 用例在 CI 上逐条 ✓；`QG Desktop Shards (1/2)` 的红**不属本片**，失败的是 `全部初始可编辑表单字段完成输入扫描` / `Flow3.3 重读列表仅有目标唯一默认服务商` / `Flow3.5 AI 服务商配置 IPC 已调用 {count:0}` 三条与模型预设相关的用例，和 #3434（只改 `scripts/check-pr-exec-record.js`）当时红的是**同三条** ⇒ 主干既有缺陷，两个互不相关的 PR 各自复现，判据取失败用例名而非「谁最后改的」。
