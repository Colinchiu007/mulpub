## 1. 失败原因日志（video-gen.js）

- [x] 1.1 在 `video-gen.test.js` 新增红测：`generateShotVideo` 各失败分支（提交 code≠0 / 内层 code<0 / 无 taskId / 轮询超时 / 抛异常）均调用 `log.warn('FilmVideoGen', <含 shotId 与原因的串>)`，且不影响返回结构
- [x] 1.2 改 `generateShotVideo` 五个失败 return 前统一 `log.warn('FilmVideoGen', 'shot N (shotId) failed: <reason>')`（`log && typeof log.warn === 'function'` 守卫），跑 1.1 转绿

## 2. 进度事件与台账 error 通道（production-driver.js）

- [x] 2.1 在 `production-driver.test.js` 新增红测：注入的 `runBatch` 调 `onShotProgress(i, 'failed', 'boom')` 后，`batch.shots[i].status==='failed'`、`batch.shots[i].error==='boom'`，且 `production:shot-progress` 事件携带 `reason`；不传第三参时 `error` 归 null（向后兼容旧调用）
- [x] 2.2 改 `production-driver.js` 的 `onShotProgress` 签名为 `(shotIndex, status, reason)`，写 `batch.shots[shotIndex].error`（截断 ≤500 字符、null 缺省）并在 emit 的事件中带上原因，跑 2.1 转绿

## 3. 透传失败原因（ipc-handlers/film-engineering.js）

- [x] 3.1 在 `film-engineering.e2e-int.test.js` 新增红测：经真实 `production-run-batch` IPC 通道，用 `_testGenerateShotVideo` 令某镜返回 `{success:false, error:'provider 拒绝'}`、另一镜 `getShot` 抛异常，断言响应/事件/台账可读到对应失败原因（不再是裸 'failed'）
- [x] 3.2 改 `runBatchViaVideoGen`：`getShot` 的 `catch (e)` 取 `e.message` 经 `log.warn` 记录并以 `onShotProgress(job.i, 'failed', reason)` 上报；生成失败分支透传 `r && r.error` 作第三参，跑 3.1 转绿

## 4. 质量门禁与收口

- [x] 4.1 运行受影响测试全绿：`apps/desktop` 下 vitest 跑 `video-gen.test.js`、`production-driver.test.js`、`film-engineering.e2e-int.test.js`、`film-engineering.test.js`
- [x] 4.2 全量回归 `story-context-engine.test.js` 等 film 相关套件无劣化；确认 ledger.json 旧数据读取不报错（缺 error 字段视为 null）
- [x] 4.3 QM-1 打包验证（改动落在 electron 主进程）：`pnpm exec electron-builder --win --dir --publish never` 通过且 asar require 链完好
- [x] 4.4 更新 CHANGELOG；`.quality-gates.md` 自检；Bug 反哺记录（逃逸链：为何既有测试没抓到——seam 只测成功路径、无 error 断言）写入 learnings
