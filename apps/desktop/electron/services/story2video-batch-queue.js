// @ts-check
/**
 * story2video-batch-queue.js — Story2Video 批量创作队列（2026-08-14）
 *
 * 职责：
 *   - 接收批量创作请求（输入文案 / 本地文件），逐项校验（fail closed，不部分入队）
 *   - 按队列依次调度：批量任务最大并行 BATCH_MAX_CONCURRENT(=2)；
 *     存在运行中的手动流水线任务时，批量任务同一时间仅运行 1 个；
 *     批量 + 手动共同遵守引擎全局并发预算（pipelineEngine.maxConcurrentRuns）
 *   - 每个批量任务复用 pipelineEngine.startOrchestrated 执行链路（自动推进、后台运行），
 *     完成后按引擎既有机制进入历史记录（run 携带 source=batch/batchId/batchItemId）
 *   - 取消仅支持排队中（pending）任务；运行中任务不提供批量取消（引擎编排 run 无按 runId 取消接口）
 *   - 队列为内存态：应用重启后排队/运行中的批量项丢失；运行中 run 由引擎退出兜底落盘为
 *     paused 快照（历史可见可续跑）
 *
 * 调度事件源：
 *   - pipelineEngine Backlot 事件 pipeline:complete / pipeline:fail（编排模式完成/失败路径均发出）
 *   - 入队、取消、事件回调均触发 _drain()；引擎并发预算拒绝（PIPELINE_CONCURRENCY_LIMIT）
 *     视为瞬时状态，退避重试（BATCH_RETRY_DELAY_MS）
 */

'use strict'

const fs = require('fs')
const path = require('path')
const {
  countStory2VideoTextCharacters,
  resolveMaxStory2VideoTextChars,
} = require('./story2video-text-config')

const BATCH_MAX_CONCURRENT = 2
const BATCH_MAX_TEXTS = 10
const BATCH_MAX_FILES = 20
const BATCH_FILE_MAX_BYTES = 2 * 1024 * 1024
const BATCH_RETRY_DELAY_MS = 1000
const BATCH_FILE_EXTENSIONS = ['.txt', '.md']
const STORY2VIDEO_PIPELINE = 'story2video-compose'

const BATCH_ITEM_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
})

const BATCH_ERROR_CODES = Object.freeze({
  NO_ITEMS: 'BATCH_NO_ITEMS',
  ITEMS_LIMIT: 'BATCH_ITEMS_LIMIT',
  TEXT_EMPTY: 'BATCH_TEXT_EMPTY',
  TEXT_TOO_LONG: 'BATCH_TEXT_TOO_LONG',
  FILE_EXT_UNSUPPORTED: 'BATCH_FILE_EXT_UNSUPPORTED',
  FILE_TOO_LARGE: 'BATCH_FILE_TOO_LARGE',
  FILE_UNREADABLE: 'BATCH_FILE_UNREADABLE',
  FILE_CONTENT_EMPTY: 'BATCH_FILE_CONTENT_EMPTY',
  FILE_CONTENT_TOO_LONG: 'BATCH_FILE_CONTENT_TOO_LONG',
  NOT_FOUND: 'BATCH_NOT_FOUND',
  INVALID_MODE: 'BATCH_INVALID_MODE',
  INVALID_PAYLOAD: 'BATCH_INVALID_PAYLOAD',
})

function isNonEmptyText(text) {
  return typeof text === 'string' && text.trim().length > 0
}

function readTextFile(filePath) {
  let buf
  try {
    buf = fs.readFileSync(filePath)
  } catch (_) {
    return { ok: false, errorCode: BATCH_ERROR_CODES.FILE_UNREADABLE }
  }
  let content
  try {
    content = buf.toString('utf8')
  } catch (_) {
    return { ok: false, errorCode: BATCH_ERROR_CODES.FILE_UNREADABLE }
  }
  return { ok: true, content }
}

function validateBatchText(text) {
  if (!isNonEmptyText(text)) return { ok: false, errorCode: BATCH_ERROR_CODES.TEXT_EMPTY }
  const trimmed = text.trim()
  // 生效上限随运营中心 storyTextLimit 运行时下发变化（story-text-limit-control）；
  // 未接线时为内置默认 10000，与渲染端批量面板占位符同一来源。
  const maxChars = resolveMaxStory2VideoTextChars()
  if (countStory2VideoTextCharacters(trimmed) > maxChars) {
    return {
      ok: false,
      errorCode: BATCH_ERROR_CODES.TEXT_TOO_LONG,
      errorParams: { max: maxChars },
    }
  }
  return { ok: true, text: trimmed }
}
class Story2VideoBatchQueue {
  /**
   * @param {object} deps
   * @param {object} deps.pipelineEngine - PipelineEngine 实例
   * @param {object} [deps.log] - 日志模块
   */
  constructor(deps) {
    deps = deps || {}
    this.pipelineEngine = deps.pipelineEngine
    this.log = deps.log || require('./logger')
    /** @type {Map<string, object>} batchId → batch */
    this._batches = new Map()
    this._draining = false
    this._retryTimer = null
    this._sequence = 0
    if (!this.pipelineEngine) {
      throw new Error('Story2VideoBatchQueue requires pipelineEngine')
    }
    // 调度事件订阅：编排 run 完成/失败均发出（批量 run 在 _runs Map 中，事件必然到达）。
    // 构造时订阅（先于任何 run 启动），无事件丢失窗口。
    if (typeof this.pipelineEngine.on === "function") {
      this._unsubscribes = [
        this.pipelineEngine.on('pipeline:complete', (data) => this._onRunTerminal(data, false)),
        this.pipelineEngine.on('pipeline:fail', (data) => this._onRunTerminal(data, true)),
      ]
    } else {
      this._unsubscribes = []
    }
  }

  /**
   * 校验单个文件项（扩展名/大小/可读/内容）。
   * @param {{ path: string, name?: string }} file
   * @returns {{ ok: true, label: string, text: string } | { ok: false, label: string, errorCode: string, errorParams?: object }}
   */
  _validateFileItem(file) {
    const label = typeof file?.name === "string" && file.name ? file.name : (typeof file?.path === "string" ? path.basename(file.path) : "")
    if (typeof file?.path !== "string" || !file.path.trim()) {
      return { ok: false, label, errorCode: BATCH_ERROR_CODES.FILE_UNREADABLE }
    }
    const ext = path.extname(file.path).toLowerCase()
    if (!BATCH_FILE_EXTENSIONS.includes(ext)) {
      return { ok: false, label, errorCode: BATCH_ERROR_CODES.FILE_EXT_UNSUPPORTED }
    }
    let stat
    try {
      stat = fs.statSync(file.path)
    } catch (_) {
      return { ok: false, label, errorCode: BATCH_ERROR_CODES.FILE_UNREADABLE }
    }
    if (!stat.isFile()) return { ok: false, label, errorCode: BATCH_ERROR_CODES.FILE_UNREADABLE }
    if (stat.size > BATCH_FILE_MAX_BYTES) {
      return {
        ok: false,
        label,
        errorCode: BATCH_ERROR_CODES.FILE_TOO_LARGE,
        errorParams: { maxMB: BATCH_FILE_MAX_BYTES / 1024 / 1024 },
      }
    }
    const read = readTextFile(file.path)
    if (!read.ok) return { ok: false, label, errorCode: read.errorCode }
    const text = read.content.trim()
    if (!text) return { ok: false, label, errorCode: BATCH_ERROR_CODES.FILE_CONTENT_EMPTY }
    const maxChars = resolveMaxStory2VideoTextChars()
    if (countStory2VideoTextCharacters(text) > maxChars) {
      return {
        ok: false,
        label,
        errorCode: BATCH_ERROR_CODES.FILE_CONTENT_TOO_LONG,
        errorParams: { max: maxChars },
      }
    }
    return { ok: true, label, text }
  }

  /**
   * 创建批量创作批次（校验失败整体拒绝，不部分入队）。
   * @param {object} payload
   * @param {"text"|"files"} payload.mode
   * @param {string[]} [payload.texts] - mode=text 时必填，1-10 条文案
   * @param {{ path: string, name?: string }[]} [payload.files] - mode=files 时必填，1-20 个文件
   * @param {object} [payload.story2videoTextConfigTemplate] - renderer 构建的配置模板（不含 prompt；prompt 按每条注入）
   * @param {string} [payload.uiLocale]
   * @returns {{ success: true, batchId: string, items: object[] } | { success: false, error: string, errorCode?: string, errorParams?: object, failedItems?: object[] }}
   */
  async createBatch(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { success: false, error: "批量创作参数必须为对象", errorCode: BATCH_ERROR_CODES.INVALID_PAYLOAD }
    }
    if (payload.mode !== "text" && payload.mode !== "files") {
      return { success: false, error: "批量创作模式必须为 text 或 files", errorCode: BATCH_ERROR_CODES.INVALID_MODE }
    }
    const template = payload.story2videoTextConfigTemplate && typeof payload.story2videoTextConfigTemplate === "object" && !Array.isArray(payload.story2videoTextConfigTemplate)
      ? payload.story2videoTextConfigTemplate
      : null

    const items = []
    const failedItems = []
    if (payload.mode === "text") {
      const texts = Array.isArray(payload.texts) ? payload.texts : []
      if (texts.length === 0) {
        return { success: false, error: "至少输入 1 条文案", errorCode: BATCH_ERROR_CODES.NO_ITEMS }
      }
      if (texts.length > BATCH_MAX_TEXTS) {
        return {
          success: false,
          error: "最多输入 " + BATCH_MAX_TEXTS + " 条文案",
          errorCode: BATCH_ERROR_CODES.ITEMS_LIMIT,
          errorParams: { max: BATCH_MAX_TEXTS },
        }
      }
      for (let i = 0; i < texts.length; i += 1) {
        const check = validateBatchText(texts[i])
        if (!check.ok) {
          failedItems.push({ label: "文案 " + (i + 1), index: i, errorCode: check.errorCode, errorParams: check.errorParams })
          continue
        }
        items.push({
          source: "text",
          label: "文案 " + (i + 1),
          text: check.text,
          configTemplate: template,
        })
      }
    } else {
      const files = Array.isArray(payload.files) ? payload.files : []
      if (files.length === 0) {
        return { success: false, error: "至少选择 1 个文件", errorCode: BATCH_ERROR_CODES.NO_ITEMS }
      }
      if (files.length > BATCH_MAX_FILES) {
        return {
          success: false,
          error: "最多选择 " + BATCH_MAX_FILES + " 个文件",
          errorCode: BATCH_ERROR_CODES.ITEMS_LIMIT,
          errorParams: { max: BATCH_MAX_FILES },
        }
      }
      for (let i = 0; i < files.length; i += 1) {
        const check = this._validateFileItem(files[i])
        if (!check.ok) {
          failedItems.push({ label: check.label, index: i, errorCode: check.errorCode, errorParams: check.errorParams })
          continue
        }
        items.push({
          source: "file",
          label: check.label,
          text: check.text,
          configTemplate: template,
        })
      }
    }

    // fail closed：任一输入项校验失败 → 整体拒绝创建，不部分入队。
    if (failedItems.length > 0) {
      const first = failedItems[0]
      return {
        success: false,
        error: "批量创作输入校验失败：" + (first.label || "未知项"),
        errorCode: first.errorCode || BATCH_ERROR_CODES.NO_ITEMS,
        errorParams: first.errorParams || null,
        failedItems,
      }
    }

    const batchId = "batch_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)
    const now = new Date().toISOString()
    const batch = {
      id: batchId,
      mode: payload.mode,
      createdAt: now,
      uiLocale: typeof payload.uiLocale === "string" ? payload.uiLocale : "en",
      items: items.map((item, index) => ({
        itemId: batchId + "_i" + index,
        source: item.source,
        label: item.label,
        text: item.text,
        configTemplate: item.configTemplate,
        status: BATCH_ITEM_STATUS.PENDING,
        runId: null,
        error: null,
        createdAt: now,
        startedAt: null,
        endedAt: null,
        _terminalFail: false,
      })),
    }
    this._batches.set(batchId, batch)
    this.log.info('Story2VideoBatchQueue', 'batch created id=' + batchId + ' mode=' + payload.mode + ' items=' + batch.items.length)
    await this._drain()
    return {
      success: true,
      batchId,
      items: this._serializeItems(batch.items),
    }
  }
  /**
   * 取消批量任务（仅 pending 排队项；running/终态不可取消）。
   * @param {string} batchId
   * @param {string[]} [itemIds]
   * @returns {{ success: true, cancelled: number } | { success: false, error: string, errorCode?: string }}
   */
  cancelBatchItems(batchId, itemIds) {
    const batch = this._batches.get(batchId)
    if (!batch) {
      return { success: false, error: "批量任务不存在", errorCode: BATCH_ERROR_CODES.NOT_FOUND }
    }
    let targets = batch.items
    if (Array.isArray(itemIds) && itemIds.length > 0) {
      const idSet = new Set(itemIds)
      targets = batch.items.filter((item) => idSet.has(item.itemId))
    }
    let cancelled = 0
    for (const item of targets) {
      if (item.status !== BATCH_ITEM_STATUS.PENDING) continue
      item.status = BATCH_ITEM_STATUS.CANCELLED
      item.endedAt = new Date().toISOString()
      cancelled += 1
    }
    if (cancelled > 0) {
      this.log.info('Story2VideoBatchQueue', 'batch cancel id=' + batchId + ' cancelled=' + cancelled)
      void this._drain()
    }
    return { success: true, cancelled }
  }

  /**
   * 获取全部批次及其任务状态（含运行中 run 的进度快照）。
   * @returns {object[]}
   */
  getBatches() {
    const list = []
    for (const batch of this._batches.values()) {
      const items = this._serializeItems(batch.items)
      const summary = {
        total: items.length,
        pending: items.filter((item) => item.status === BATCH_ITEM_STATUS.PENDING).length,
        running: items.filter((item) => item.status === BATCH_ITEM_STATUS.RUNNING).length,
        completed: items.filter((item) => item.status === BATCH_ITEM_STATUS.COMPLETED).length,
        failed: items.filter((item) => item.status === BATCH_ITEM_STATUS.FAILED).length,
        cancelled: items.filter((item) => item.status === BATCH_ITEM_STATUS.CANCELLED).length,
      }
      list.push({
        id: batch.id,
        mode: batch.mode,
        createdAt: batch.createdAt,
        uiLocale: batch.uiLocale,
        summary,
        items,
      })
    }
    return list
  }

  /**
   * 序列化 item（剔除内部 text/configTemplate，避免大对象经 IPC 回传）。
   * @param {object[]} items
   * @returns {object[]}
   */
  _serializeItems(items) {
    return items.map((item) => {
      const out = {
        itemId: item.itemId,
        source: item.source,
        label: item.label,
        status: item.status,
        runId: item.runId,
        error: item.error,
        // 启动失败的机器可读错误码（如 PIPELINE_MODEL_REQUIREMENTS_MISSING），供 renderer 展示可操作提示
        errorCode: item.errorCode || null,
        errorParams: item.errorParams || null,
        createdAt: item.createdAt,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        progress: null,
        currentStage: null,
      }
      if (item.status === BATCH_ITEM_STATUS.RUNNING && item.runId && this.pipelineEngine && typeof this.pipelineEngine.getRunSnapshot === "function") {
        try {
          const snapshot = this.pipelineEngine.getRunSnapshot(item.runId)
          if (snapshot && snapshot.status) {
            out.progress = Number.isFinite(Number(snapshot.status.progress)) ? Number(snapshot.status.progress) : null
            const stage = snapshot.status.currentStage
            if (typeof stage === "string") out.currentStage = stage
          }
        } catch (_) { /* 快照读取失败不阻断列表 */ }
      }
      return out
    })
  }

  /**
   * run 终态事件回调：更新对应 item 状态并触发调度。
   * @param {{ runId?: string, error?: string }} data
   * @param {boolean} isFail
   */
  _onRunTerminal(data, isFail) {
    const runId = data && typeof data.runId === "string" ? data.runId : null
    if (!runId) return
    for (const batch of this._batches.values()) {
      const item = batch.items.find((it) => it.runId === runId)
      if (!item) continue
      if (item.status !== BATCH_ITEM_STATUS.RUNNING) return
      item.status = isFail ? BATCH_ITEM_STATUS.FAILED : BATCH_ITEM_STATUS.COMPLETED
      item.error = isFail ? (data && data.error ? String(data.error) : "批量任务执行失败") : null
      item.endedAt = new Date().toISOString()
      this.log.info('Story2VideoBatchQueue', 'item terminal itemId=' + item.itemId + ' runId=' + runId + ' status=' + item.status)
      void this._drain()
      return
    }
  }

  /**
   * 调度循环：满足条件时持续启动 pending 任务（一轮可启动多个，直到并行上限）。
   * 规则：
   *   - 批量并行 ≤ BATCH_MAX_CONCURRENT
   *   - 手动任务运行中 → 批量并行 ≤ 1
   *   - 批量 + 手动 < 引擎全局 maxConcurrentRuns
   * 引擎并发预算拒绝（PIPELINE_CONCURRENCY_LIMIT）→ 退避重试，不标记失败。
   */
  async _drain() {
    if (this._draining) return
    this._draining = true
    try {
      for (;;) {
        const pending = this._collectPending()
        if (pending.length === 0 || !this._canStartNow()) return
        const { batch, item } = pending[0]
        const started = await this._startItem(batch, item)
        if (!started.success) {
          if (started.errorCode === "PIPELINE_CONCURRENCY_LIMIT" || /并发|concurrency/i.test(String(started.error || ""))) {
            // 瞬时预算拒绝：退避后重试（事件可能错过启动窗口）
            this._scheduleRetry()
            return
          }
          item.status = BATCH_ITEM_STATUS.FAILED
          item.error = started.error || "批量任务启动失败"
          // 透传启动错误码（如 PIPELINE_MODEL_REQUIREMENTS_MISSING），供 renderer 展示可操作提示
          item.errorCode = started.errorCode || null
          item.errorParams = started.errorParams && typeof started.errorParams === "object"
            ? started.errorParams
            : null
          item.endedAt = new Date().toISOString()
          this.log.warn('Story2VideoBatchQueue', 'item start failed itemId=' + item.itemId + ' error=' + item.error)
          // 失败项不阻塞：继续尝试下一个 pending
          continue
        }
      }
    } finally {
      this._draining = false
    }
  }

  /** 按创建顺序收集全部 pending 任务（批次插入序 + 批内 item 序）。 */
  _collectPending() {
    const pending = []
    for (const batch of this._batches.values()) {
      for (const item of batch.items) {
        if (item.status === BATCH_ITEM_STATUS.PENDING) pending.push({ batch, item })
      }
    }
    return pending
  }

  /** 当前是否允许再启动一个批量任务（并行上限 / 手动互斥 / 全局预算）。 */
  _canStartNow() {
    const runningBatchCount = this._countRunningBatchItems()
    const runningManualCount = typeof this.pipelineEngine._countActiveManualRuns === "function"
      ? this.pipelineEngine._countActiveManualRuns()
      : 0
    const engineBudget = Number.isFinite(Number(this.pipelineEngine.maxConcurrentRuns)) ? Number(this.pipelineEngine.maxConcurrentRuns) : 1
    return runningBatchCount < BATCH_MAX_CONCURRENT
      && (runningManualCount > 0 ? runningBatchCount < 1 : true)
      && (runningBatchCount + runningManualCount < engineBudget)
  }
  /**
   * 启动单个批量任务（复用引擎编排链路）。
   * @param {object} batch
   * @param {object} item
   * @returns {{ success: boolean, runId?: string, error?: string, errorCode?: string }}
   */
  async _startItem(batch, item) {
    if (typeof this.pipelineEngine.startOrchestrated !== "function") {
      return { success: false, error: "PipelineEngine 未配置编排执行器" }
    }
    // 每条任务注入自己的文案；模板克隆（避免跨任务共享引用）
    const config = item.configTemplate
      ? JSON.parse(JSON.stringify(item.configTemplate))
      : { version: 1, mode: "text", prompt: item.text }
    config.prompt = item.text
    config.mode = "text"
    const params = {
      text: item.text,
      inputMode: "text",
      checkpointPolicy: "none",
      autoAdvance: true,
      background: true,
      uiLocale: batch.uiLocale || "en",
      source: "batch",
      batchId: batch.id,
      batchItemId: item.itemId,
      story2videoTextConfig: config,
    }
    let result
    try {
      result = await this.pipelineEngine.startOrchestrated(STORY2VIDEO_PIPELINE, params)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (result && result.success && result.runId) {
      item.status = BATCH_ITEM_STATUS.RUNNING
      item.runId = result.runId
      item.startedAt = new Date().toISOString()
      item.error = null
      this.log.info('Story2VideoBatchQueue', 'item started itemId=' + item.itemId + ' runId=' + result.runId)
      return { success: true, runId: result.runId }
    }
    return {
      success: false,
      error: result && result.error ? result.error : "批量任务启动失败",
      errorCode: result && result.errorCode ? result.errorCode : null,
    }
  }

  /** 退避重试调度。 */
  _scheduleRetry() {
    if (this._retryTimer) return
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null
      void this._drain()
    }, BATCH_RETRY_DELAY_MS)
    if (this._retryTimer && typeof this._retryTimer.unref === "function") this._retryTimer.unref()
  }

  /** 全部批次中运行中的批量任务数。 */
  _countRunningBatchItems() {
    let count = 0
    for (const batch of this._batches.values()) {
      for (const item of batch.items) {
        if (item.status === BATCH_ITEM_STATUS.RUNNING) count += 1
      }
    }
    return count
  }

  /** 测试/退出兜底：清空重试定时器并退订事件。 */
  dispose() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    for (const unsubscribe of this._unsubscribes) {
      try { unsubscribe() } catch (_) { /* 忽略退订错误 */ }
    }
    this._unsubscribes = []
  }
}

module.exports = {
  Story2VideoBatchQueue,
  BATCH_MAX_CONCURRENT,
  BATCH_MAX_TEXTS,
  BATCH_MAX_FILES,
  BATCH_FILE_MAX_BYTES,
  BATCH_RETRY_DELAY_MS,
  BATCH_ITEM_STATUS,
  BATCH_ERROR_CODES,
  readTextFile,
  validateBatchText,
}
