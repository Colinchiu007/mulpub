---
record: fix-s2v-clone-plan-unsupported
task: MiniMax 订阅套餐克隆被拒（token plan not support voice_clone）被折叠成「暂时不可用，请稍后重试」→ 透传为明确的付费方式说明
date: 2026-10-19
---

## 本次执行记录：克隆套餐不支持错误的透传与文案（fix-s2v-clone-plan-unsupported，2026-10-19）

> 本文件为执行记录（唯一强制载体）。状态列不手写远程同步状态词：合并一旦发生，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（`apps/desktop/electron/**` 主进程 + `apps/desktop/src/**` 渲染层）⇒ 隔离 worktree `mp-worktrees/mp-s2v-clone-plan-unsupported` + 裸分支 `s2v-clone-plan-unsupported`（基于 `origin/main` `74a0f5d93`）；共享主仓未做任何写入 |
| 第一性原因（QM-5 ①） | ✅ | 用户 MiniMax 订阅套餐账号克隆被服务端拒绝（`model_provider_logs` id=10030：`your current token plan not support model, voice_clone`，2026-10-19 07:05:53，latency 1125ms——请求真实到达服务端、鉴权通过、参数合规）；adapter `classifyBaseRespError` 把它误判为 QUOTA（`token\s*plan` 分支），service 折叠为 `VOICE_CLONE_PROVIDER_UNAVAILABLE`，前端映射「暂时不可用，请稍后重试」——重试永不成功，文案误导 |
| 逃逸分析（QM-5 ②） | ✅ | adapter 测试只覆盖 2038 禁用原文，未覆盖「plan not support」新原文；service 测试只断言折叠后的 PROVIDER_UNAVAILABLE；渲染层映射表无 plan 类条目；日志虽有 `TtsVoiceClone` warn（2026-08-07 修复后已有），但最终用户面无原话 |
| 系统性漏洞定位（QM-5 ③） | ✅ | ①错误分类依赖原文正则、无 statusCode 短路（2038 有 context 但分类仍走原文）；②service 层把所有 adapter 失败折叠成单一文案（信息丢失点）；③渲染层 map 无 plan/认证类区分 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`provider-error.js` 新增 `PLAN_UNSUPPORTED`（category config，retryable:false）；②`minimax-tts.js` `classifyBaseRespError` 增加 `isPlanUnsupported`（statusCode 2038 短路 + plan not support/clone forbidden 族正则），**置于 isQuota 之前**（否则 `token plan` 被 isQuota 误吃）；③service `cloneFailureFromAdapterError`：PLAN_UNSUPPORTED（throw 或结构化 errorCode）→ `VOICE_CLONE_PLAN_UNSUPPORTED` + `data.detail`=供应商原话；④渲染层 map + zh/en locale 新增 `VOICE_CLONE_PLAN_UNSUPPORTED`（含「另付费 9.9 元购买音色，不能直接使用订阅套餐」）。回归锁：adapter 3 例（plan 归类/2038 归类/balance 不误判）、service 2 例（throw 透传 + 结构化透传 + 不落 registry）、CreateView 映射 2 断言 |
| 防止再次发生（QM-5 ⑤） | ✅ | 本记录 + CHANGELOG 顶部条目 + learnings 追加 |
| 行尾与 diff 对账 | 待提交前实测 | 提交后复跑 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐档相等 |
| 接线棘轮 | ✅ | 无新增测试文件；`node scripts/check-unwired-tests.js` 实跑 OK |
| QM-1 打包 | ✅ | 本刀未改主进程加载面之外的服务（改动在既有 require 图内，无新文件/无新 IPC），打包判据按「改动含 electron/services ⇒ 必须打包」执行：`electron-builder --win --dir --publish never` exit 0（见自测块） |
| QM-2 代码必检项 | ✅ | 无同步 CPU 密集、无新增 IPC、无 v-html、无硬编码等待；正则判定为一次性 O(len) |
| QM-4 视觉回归 | N/A（有据） | 未改模板/样式/DOM；仅错误文案走既有 toast/inline 通道 |
| QM-6 CCG 双模型外部评审 | 待提交前实测（由 Lead 执行） | 判定器按 diff 体量决定；结果回填 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导收口 |

## 自测块（提交前当场跑，禁止预填结论）

```
# 1) 定向测试（2026-10-19 实测）
cd apps/desktop && pnpm exec vitest run electron/services/adapters/minimax-tts.test.js \
  electron/services/adapters/_base electron/services/tts-voice-clone-service.test.js \
  src/views/CreateView.test.js src/views/video-creation
→ Test Files 18 passed (18) / Tests 599 passed (599)

# 2) 门禁
eslint（9 个变更文件）→ rc=0；tsc --noEmit → rc=0
check-locale-sync --keys / --cjk → PASS（2152 keys；无新增硬编码）
check-max-lines → ✅（tts-voice-clone-service.js 1748 行 = target，零增长；零容差文件以等价折叠抵消新增行）
check-unwired-tests → OK（106 文件）

# 3) QM-1 打包（改动含 electron/services，必须执行）
cd apps/desktop && pnpm exec electron-builder --win --dir --publish never → exit 0
asar 命中 minimax-tts（2 条）；解包 require rc=0 且 ERROR_CODES.PLAN_UNSUPPORTED=true；启动 9s 存活 + stderr 0 行
```

## 遗留（不假装已闭合）

- MiniMax 侧仅透传原话 + 明确付费指引；未做「检测到 plan 不支持后自动切换内置音色重试」——按 7.1.16 合同**不得静默替换用户音色**，保持显式失败。
- `clone_prompt`（示例音频增强相似度）仍未使用——官方可选参数，当前产品只有单样本上传流，接入属产品决策非缺陷。
- status_code=0 但缺 voice_id 的异常形态：当前回退本地生成 id 判成功（既有行为），未在本刀收紧（无真实观测样本，避免误伤）。
