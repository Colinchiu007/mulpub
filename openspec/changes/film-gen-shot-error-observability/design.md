## Context

真实批量出片的单镜失败当前被三层静默吞掉（见 proposal.md - Why）：
- `video-gen.js#generateShotVideo` 五个失败分支只 `return {success:false, error}`，仅成功路径 `log.info`，失败无日志。
- `ipc-handlers/film-engineering.js#runBatchViaVideoGen` 的 `getShot` 用空 `catch` 吞异常，`onShotProgress(job.i, r && r.success ? 'done' : 'failed')` 丢弃 `r.error`。
- `production-driver.js` 的 `onShotProgress: (shotIndex, status) => {...}` 签名无 error 通道，台账每镜条目仅 `{shotId, status}`。

约束：批收口的磁盘复核是权威裁决（不信自报），不得改动；ledger.json 是磁盘持久化产物，须向后兼容；`onShotProgress` 是跨三处（driver↔handler↔测试 seam）的回调解耦点。

## Goals / Non-Goals

**Goals:**
- 单镜失败原因在「日志 / 进度事件 / 台账」三处各自可读，任一处缺失不影响另两处。
- 改动行为保持（behavior-preserving）：既有 done/failed 判定、失败隔离、幂等续跑、成本闸、磁盘复核裁决完全不变。

**Non-Goals:**
- 不改批内并发度、重试预算、轮询超时时长。
- 不引入新的 IPC 通道或前端页面（前端错误清单展示留作后续 story，本 change 只保证数据侧可读）。
- 不改 ledger 已有字段的语义。

## Decisions

**D1：`onShotProgress` 扩展为可选第三参 `(index, status, reason?)` 而非新增独立回调。**
理由：调用点集中且少（handler 两处 + driver 一处 + e2e 测试 seam），加可选参数是最小侵入；旧调用（不传第三参）行为不变，向后兼容。备选：新增 `onShotError` 回调——被否，会让 seam 签名翻倍、driver 与测试全要改。

**D2：失败原因来源以「provider 返回的 error/message 字符串」为准，driver 层不重新生成文案。**
理由：`generateShotVideo` 已产出分类清晰的中文原因串（提交拒绝/双层 code/无 taskId/超时/异常），透传即可辨识；driver 只做「落字段 + 落事件」的搬运，避免文案二义。`getShot` 异常则在 handler 侧 `catch (e)` 取其 message 作为 reason。

**D3：台账逐镜 `error` 字段 append-only，缺省 null。**
理由：旧 ledger 无该字段，读取时 `s.error ?? null` 即可，不需迁移脚本；写盘时新增字段不影响 `resolveResumePlan`/`buildRenderManifest`（它们只看 status 与磁盘）。

**D4：日志用 `log.warn('FilmVideoGen', ...)`，与成功路径 `log.info('FilmVideoGen', ...)` 同 module 名。**
理由：保持既有 logger 约定；warn 级别便于生产过滤告警。`log` 可能为 undefined（单测注入），沿用成功路径的 `if (log && typeof log.warn === 'function')` 守卫。

## Risks / Trade-offs

- [日志放大：987 镜大批量若多镜失败会产生多条 warn] → 失败本是少数且每条一行，可接受；不做聚合以免丢 per-shot 精度。
- [error 字符串含 provider 原文，可能含敏感/超长内容] → 截断至合理长度（如 500 字符）后落日志与台账，避免撑爆 ledger 与事件负载。
- [e2e 测试的 `_testGenerateShotVideo` seam 需返回带 error 的失败对象] → 复用现有 seam 签名（已含 index/shotId），补 success:false+error 返回即可，不破坏既有绿测。
