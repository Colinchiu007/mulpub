// @ts-check
/**
 * 视频克隆 assetGenerator adapter（切片 4c）
 * - createVideoCloneAssetGenerator：走既有 AssetGenerator.generateImage（provider 或离线占位）
 * - createPlaceholderImageGenerator：无服务时的离线占位（ffmpeg 纯色图，degraded=true，诚实标注）
 * 错误：无服务 → VIDEOCLONE_PROVIDER_UNAVAILABLE；生成失败 → VIDEOCLONE_ASSET_GENERATION_FAILED
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { resolveBinary, runCommand } = require('@multi-publish/video-clone-engine')

function providerError(reason) {
  const e = new Error(reason || '生成服务不可用')
  e.code = 'VIDEOCLONE_PROVIDER_UNAVAILABLE'
  return e
}
function genError(message) {
  const e = new Error(message || '素材生成失败')
  e.code = 'VIDEOCLONE_ASSET_GENERATION_FAILED'
  return e
}

/** 走 AssetGenerator 服务（data.path；离线占位透传 degraded/source 供下游诚实展示） */
function createVideoCloneAssetGenerator({ assetGenerator, optimizeVideoPromptsBatch } = {}) {
  return async (spec, report) => {
    if (!assetGenerator) throw providerError()
    const aspect = (report && report.platformParams && report.platformParams.aspect) || '16:9'
    // 真实视频模型生成动态片段（2026-09-05）：spec.kind === 'video' 时走 generateVideo
    if (spec.kind === 'video') {
      // 优先真实视频模型生成；失败时降级到静态图 + degraded 标记（诚实降级，不阻断流水线）
      let videoError // 初值在 if/else 与 catch 路径都会被赋值，无需初始化（no-useless-assignment）
      if (typeof assetGenerator.generateVideo === 'function') {
        try {
          // 生成前统一经 prompt-engine 优化视频提示词（PRD §2 generate 链路，2026-09-05）
          let prompt = spec.promptSeed
          if (typeof optimizeVideoPromptsBatch === 'function') {
            const parts = await optimizeVideoPromptsBatch([prompt], { model: 'agnes-video-v2.0' })
            if (!Array.isArray(parts) || parts.length !== 1) {
              throw genError('视频提示词优化结果数量异常（expected 1, got ' + (Array.isArray(parts) ? parts.length : '非法响应') + '）')
            }
            const optimized = parts[0] && typeof parts[0].optimized_prompt === 'string' && parts[0].optimized_prompt.trim()
              ? parts[0].optimized_prompt.trim()
              : ''
            if (!optimized) throw genError('视频提示词优化返回空提示词')
            prompt = optimized
          }
          const result = await assetGenerator.generateVideo(prompt, {
            index: spec.index,
            aspect_ratio: aspect,
            // 默认使用已配置的 Agnes Video；可通过 report/options 覆盖
            video_provider: 'agnes-video',
            video_model: 'agnes-video-v2.0',
          })
          if (!result || result.code !== 0 || !result.data || typeof result.data.path !== 'string') {
            videoError = (result && result.message) || '视频生成失败'
          } else {
            const degraded = result.data.degraded === true
              ? { degraded: true, source: result.data.source || 'video-provider' }
              : {}
            return { path: result.data.path, kind: 'video', ...degraded }
          }
        } catch (e) {
          videoError = (e && e.message) || String(e)
        }
      } else {
        videoError = '视频模型不可用'
      }
      // 降级：静态图 + degraded 标记（诚实标注视频生成未成功）
      if (typeof assetGenerator.generateImage !== 'function') throw providerError()
      const fallback = await assetGenerator.generateImage(spec.promptSeed, {
        style: 'cinematic', index: spec.index, aspect_ratio: aspect,
      })
      if (!fallback || fallback.code !== 0 || !fallback.data || typeof fallback.data.path !== 'string') {
        throw genError(fallback && fallback.message)
      }
      return { path: fallback.data.path, kind: 'image', degraded: true, source: 'video-fallback:' + (videoError || 'unavailable') }
    }
    if (typeof assetGenerator.generateImage !== 'function') throw providerError()
    const result = await assetGenerator.generateImage(spec.promptSeed, {
      style: 'cinematic', index: spec.index, aspect_ratio: aspect,
    })
    if (!result || result.code !== 0 || !result.data || typeof result.data.path !== 'string') {
      throw genError(result && result.message)
    }
    const degraded = result.data.degraded === true
      ? { degraded: true, source: result.data.source || 'ffmpeg-placeholder' }
      : {}
    return { path: result.data.path, kind: 'image', ...degraded }
  }
}

/** 离线占位（无 AssetGenerator 服务时的诚实降级）：ffmpeg 纯色 PNG */
function createPlaceholderImageGenerator({ outputDir = null } = {}) {
  const dir = outputDir || path.join(os.tmpdir(), 'vc-assets')
  fs.mkdirSync(dir, { recursive: true })
  const colors = ['0x1a1a2e', '0x2d4a2d', '0x4a90d9', '0xe91e63', '0x6a1b9a', '0x7aa7b8']
  return async (spec, report) => {
    const bin = resolveBinary('VC_FFMPEG_PATH', 'FFMPEG_PATH', 'ffmpeg')
    const out = path.join(dir, 'shot_' + spec.index + '.png')
    const color = colors[Math.abs(spec.index) % colors.length] // 防御：负索引在 JS 取模为负 → colors[-1] undefined
    const ratio = (report && report.platformParams && report.platformParams.aspect) || '16:9'
    const size = ratio === '9:16' ? '540x960' : ratio === '1:1' ? '720x720' : '960x540'
    try {
      await runCommand(bin, ['-y', '-f', 'lavfi', '-i', 'color=c=' + color + ':s=' + size + ':d=1', '-frames:v', '1', out], { timeoutMs: 60000 })
    } catch (err) { throw genError('占位图生成失败: ' + (err && err.message)) }
    return { path: out, kind: 'image', degraded: true, source: 'ffmpeg-placeholder' }
  }
}

module.exports = { createVideoCloneAssetGenerator, createPlaceholderImageGenerator }
