## Why

量产压力实测（film-full-corpus-production，987 镜）暴露一处观测缺口：真实 A 通道批量出片时，单镜失败在全链路（IPC 事件、批次台账、应用日志）**零留痕**——失败原因被静默丢弃，定位只能靠"删产物重跑"。这直接违反 `film-engineering` 规格「分镜视频生成阶段」既有合同："结果清单 SHALL 逐镜标注成功/失败**与失败原因**"。实测中 `49ba177a` 镜在批内并发下偶发失败，因无错误留痕，只能整批重跑（覆写 4 个已成功镜）才间接归因，浪费一轮真实 provider 调用。

## What Changes

- **打通单镜失败原因通道**：`generateShotVideo` 的每个失败分支在返回前 SHALL 经 `log.warn('FilmVideoGen', ...)` 记录镜头序号、shotId 与失败原因（提交拒绝 / 双层 code 失败 / 无 taskId / 轮询超时 / 异常兜底五类），不再只 log 成功。
- **进度事件携带失败原因**：`onShotProgress` 由 `(index, status)` 扩展为可选第三参 `(index, status, reason)`（向后兼容），`runBatchViaVideoGen` MUST 把 `getShot` 抛出的异常与 `generateShotVideo` 返回的 `error` 透传上报，不再 `catch { /* 视为该镜失败 */ }` 静默吞掉。
- **台账逐镜持久化失败原因**：批次台账每镜条目 SHALL 增加 `error` 字段（append-only、非破坏），断点续跑/重启后仍可读到上次失败原因。
- **不改行为语义**：批收口仍以磁盘复核为权威裁决（不信自报），失败隔离、幂等续跑、成本确认闸等既有合同不变。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `film-engineering`：强化「分镜视频生成阶段」与「全量分批出片驱动」两条 Requirement——把"逐镜标注失败原因"从（仅约束阶段结果清单的）隐含要求，落实为批次进度事件、单镜失败日志、台账逐镜 `error` 字段三处的可观测合同；新增失败原因在批内并发偶发场景下可被直接读取的场景。

## Impact

- 代码：`apps/desktop/electron/services/film-engineering/video-gen.js`（`generateShotVideo` 五个失败分支补日志）、`apps/desktop/electron/ipc-handlers/film-engineering.js`（`runBatchViaVideoGen` 透传 error + getShot 异常记日志）、`apps/desktop/electron/services/film-engineering/production-driver.js`（`onShotProgress` 第三参、逐镜 `error` 落台账与事件）。
- 测试：`video-gen.test.js`（失败分支日志断言）、`production-driver.test.js`（error 透传落台账/事件）、`film-engineering.e2e-int.test.js`（批内单镜偶发失败经真实 IPC 通道可读到失败原因）。
- 无 IPC 通道签名破坏性变更（新增可选参数、新增台账字段）；无依赖变更；ledger.json 结构向后兼容（旧台账缺 `error` 字段读为 null）。
