// @ts-check
/**
 * publish-progress-events.js — 发布进度事件富化层（publish-progress-ux 单一实现）
 *
 * 契约（01-docs/PRD-PUBLISH-PROGRESS-UX-2026-09-28 §5.1/§6.1/§6.3）：
 * - `mapStageToKey`：两引擎（rpa-view-platforms / rpa-view-manager / base-adapter）
 *   的已知阶段串 → 9 值稳定 stageKey 封闭清单；前缀规则优先；未知串 → 'detail'。
 * - `createPublishProgressEmitter`：publish:progress payload 统一组装
 *   （既有字段保留 + phase/stageKey/percent/batchId/timestamp 富化，向后兼容加法）。
 * - `createTaskProgressRouter`：platform→taskId 归属路由（修并发单槽回调跨归属，
 *   同平台并发 last-write-wins 为已知近似，见 PRD §14）。
 *
 * 纪律：新增引擎阶段串必须同步登记 KNOWN_STAGE_MAP（封闭清单，
 * publish-stage-map.test.js 锁全量已知串与规模下界）。
 */
'use strict'

const log = require('./logger')

/** stageKey 稳定枚举（渲染层 i18n 按此渲染步骤标签） */
const STAGE_KEY_ENUM = [
  'prepare', 'upload', 'fill', 'submit', 'verify', 'waiting', 'done', 'failed', 'detail',
]

/** 事件相位（生命周期边界，对齐账号批量检测 start/done 双边界先例）。
 * cancelled（publish-progress-panel-refine）：取消终态——TaskQueue 取消任务时发
 * task:cancelled，经 phase4-events 转发；渲染层以中性「已取消」态呈现（非失败红态）。 */
const PHASE_ENUM = ['start', 'progress', 'success', 'failed', 'retry', 'blocked', 'cancelled']

/**
 * 已知阶段串 → stageKey 封闭映射表。
 * 前缀规则（✓/✗/⏳/⟳/Failed:/Error:）在 mapStageToKey 内优先于本表。
 */
const KNOWN_STAGE_MAP = {
  // ── 准备（引擎启动/导航/声明准备） ──
  '准备发布...': 'prepare',
  'starting browser...': 'prepare',
  'cookies restored': 'prepare',
  'using API publish engine...': 'prepare',
  'navigating...': 'prepare',
  'navigating to draft...': 'prepare',
  'navigating to Studio...': 'prepare',
  'navigating to write page...': 'prepare',
  'waiting for editor...': 'prepare',
  'preparing declaration...': 'prepare',
  'preparing AI declaration...': 'prepare',
  'preparing category & copyright...': 'prepare',
  // ── 上传 ──
  'uploading file...': 'upload',
  'file uploaded': 'upload',
  'uploading video...': 'upload',
  'waiting upload...': 'upload',
  'waiting for upload...': 'upload',
  'video uploaded': 'upload',
  'upload complete': 'upload',
  'uploading cover...': 'upload',
  'Uploading video...': 'upload',
  'Uploading cover...': 'upload',
  // ── 填写（表单/草稿/协议） ──
  'filling title...': 'fill',
  'filling content...': 'fill',
  'filling desc...': 'fill',
  'filling description...': 'fill',
  'adding tags...': 'fill',
  'checking agreement...': 'fill',
  'saving draft...': 'fill',
  // ── 提交 ──
  'publishing...': 'submit',
  'Publishing...': 'submit',
  'clicking Create...': 'submit',
  'mass sending...': 'submit',
  'next step (elements)...': 'submit',
  // ── 校验 ──
  'verifying...': 'verify',
  // ── 完成（终态串） ──
  'published!': 'done',
  'Published!': 'done',
  'done': 'done',
  'draft saved': 'done',
  'API success': 'done',
}

/** 前缀规则：优先于精确串表（动态拼接串的稳定判定） */
const STAGE_PREFIX_RULES = [
  ['✓', 'done'],
  ['✗', 'failed'],
  ['⏳', 'waiting'],
  ['⟳', 'waiting'],
  ['Failed: ', 'failed'],
  ['Error: ', 'failed'],
]

/**
 * 阶段串 → 规范 stageKey。未知/非字符串输入 → 'detail'（fail-closed 透传，不抛错）。
 * @param {string} stage
 * @returns {string}
 */
function mapStageToKey(stage) {
  if (typeof stage !== 'string' || stage.length === 0) return 'detail'
  for (const [prefix, key] of STAGE_PREFIX_RULES) {
    if (stage.startsWith(prefix)) return key
  }
  const mapped = KNOWN_STAGE_MAP[stage]
  return mapped || 'detail'
}

/** percent 归一：null 或 0-100 有限数，否则 null */
function normalizePercent(value) {
  if (value === null || value === undefined) return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0 || num > 100) return null
  return num
}

/** 相位默认 percent：start=0、终态=100（PRD §6.1；调用方显式传值优先） */
function defaultPercentForPhase(phase) {
  if (phase === 'start') return 0
  if (phase === 'success' || phase === 'failed') return 100
  return null
}

/**
 * 创建发布进度事件发射器（payload 单一组装点）。
 * @param {object} deps
 * @param {Function} deps.getMainWin
 * @returns {{ emit: (taskId: string, platform: string, phase: string, extra?: object) => void }}
 */
function createPublishProgressEmitter({ getMainWin }) {
  function emit(taskId, platform, phase, extra = {}) {
    if (typeof taskId !== 'string' || !taskId || typeof platform !== 'string' || !platform) {
      log.warn('PublishProgress', 'emit skipped: invalid taskId/platform')
      return
    }
    const win = typeof getMainWin === 'function' ? getMainWin() : null
    if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return
    const stage = typeof extra.stage === 'string' && extra.stage ? extra.stage : ''
    const normalizedPhase = PHASE_ENUM.includes(phase) ? phase : 'progress'
    const percent = extra.percent !== undefined
      ? normalizePercent(extra.percent)
      : defaultPercentForPhase(normalizedPhase)
    const payload = {
      platform,
      taskId,
      stage,
      phase: normalizedPhase,
      stageKey: mapStageToKey(stage),
      percent,
      batchId: (typeof extra.batchId === 'string' && extra.batchId) || null,
      timestamp: Date.now(),
    }
    if (extra.result !== undefined) payload.result = extra.result
    if (extra.error !== undefined) payload.error = extra.error
    if (extra.remainingWait !== undefined) payload.remainingWait = extra.remainingWait
    if (extra.retriesLeft !== undefined) payload.retriesLeft = extra.retriesLeft
    if (extra.bucket !== undefined) payload.bucket = extra.bucket
    try {
      win.webContents.send('publish:progress', payload)
    } catch (e) {
      log.warn('PublishProgress', 'send failed: ' + (e && e.message))
    }
  }
  return { emit }
}

/**
 * 创建 platform→taskId 归属路由。
 * executor 开始时 register、finally 时 unregister（仅当仍指向本任务）；
 * 同平台并发 last-write-wins（已知近似，PRD §14）。
 * @returns {{ register: (platform: string, taskId: string) => void, unregister: (platform: string, taskId: string) => void, resolve: (platform: string) => string|undefined }}
 */
function createTaskProgressRouter() {
  const map = new Map()
  return {
    register(platform, taskId) {
      if (typeof platform !== 'string' || !platform || typeof taskId !== 'string' || !taskId) return
      map.set(platform, taskId)
    },
    unregister(platform, taskId) {
      if (map.get(platform) !== taskId) return // stale 注销不误删接任者
      map.delete(platform)
    },
    resolve(platform) {
      return map.get(platform)
    },
  }
}

module.exports = {
  STAGE_KEY_ENUM,
  PHASE_ENUM,
  KNOWN_STAGE_MAP,
  mapStageToKey,
  createPublishProgressEmitter,
  createTaskProgressRouter,
}
