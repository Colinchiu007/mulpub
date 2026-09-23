// @ts-check
'use strict'
/**
 * 全量出片批执行器（从 ipc-handlers/film-engineering.js 拆出，满足超大文件门禁 QM）。
 *
 * 逐镜 getShot 取原文 prompt → generateShotVideo 子跑（提交→轮询→下载落 runDir/shot_NNN.mp4），
 * 批内并发 PRODUCTION_BATCH_CONCURRENCY=2（design 墙钟口径）；单镜失败经
 * onShotProgress(i, 'failed', reason) 上报可辨识失败原因（film-gen-shot-error-observability），
 * 批收口由 driver 磁盘复核裁决（不信自报）。sleep/download/generateShotVideo 均可经 deps 注入（测试）。
 */
const fs = require('fs')
const { generateShotVideo, resolveFilmVideoProvider, getFilmRunDir } = require('./video-gen')

const PRODUCTION_BATCH_CONCURRENCY = 2

async function runBatchViaVideoGen ({ batch, service, aiGenerator, aspect, seconds, log, deps, onShotProgress }) {
  const providerCfg = resolveFilmVideoProvider(aiGenerator)
  if (!providerCfg) throw new Error('VIDEO_MODEL_NOT_CONFIGURED: 影视工程批量出片需要视频模型，请在模型设置中配置并设为默认视频 Provider 后重试')
  const runDir = getFilmRunDir(batch.runId)
  try { fs.mkdirSync(runDir, { recursive: true }) } catch { /* 目录已存在，忽略 */ }
  const gen = deps._testGenerateShotVideo || generateShotVideo
  const queue = batch.shotIds.map((shotId, i) => ({ shotId, i }))
  const worker = async () => {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) return
      let shot = null
      let shotErr = null
      try { shot = service.getShot(job.shotId) } catch (e) { shotErr = (e && e.message) ? e.message : String(e) }
      if (!shot || typeof shot.prompt !== 'string' || !shot.prompt.trim()) {
        const reason = shotErr || '未取到分镜提示词（原文为空或分镜不存在）'
        if (log && typeof log.warn === 'function') log.warn('FilmVideoGen', 'shot ' + job.i + ' (' + job.shotId + ') failed: ' + reason)
        onShotProgress(job.i, 'failed', reason)
        continue
      }
      const r = await gen({
        shot: { ...shot, shotId: job.shotId }, index: job.i, runDir, aspect, seconds,
        providerCfg, sleep: deps._testSleep, download: deps._testDownload, log,
      })
      if (r && r.success) {
        onShotProgress(job.i, 'done')
      } else {
        onShotProgress(job.i, 'failed', (r && r.error) ? r.error : '视频生成失败（未知原因）')
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PRODUCTION_BATCH_CONCURRENCY, batch.shotIds.length) }, worker))
}

module.exports = { runBatchViaVideoGen, PRODUCTION_BATCH_CONCURRENCY }
