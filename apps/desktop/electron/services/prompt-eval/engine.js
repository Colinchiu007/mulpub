// @ts-check
/**
 * PromptEval 评估引擎（编排）
 * 输入校验（fail closed）→ 读图 → 构造提示词 → 调用评估器 → 解析校验 → 报告 → 持久化
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { buildImageEvaluationPrompt, buildVideoEvaluationPrompt, normalizeContextSnapshot } = require('./prompt-builder')
const { parseAndValidate, normalizeParsed } = require('./llm')
const { buildRecord, toMarkdown } = require('./report')

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_ITEMS = 20
const MAX_OPTIMIZED_PROMPT_CHARS = 5000
const MAX_SOURCE_TEXT_CHARS = 20000
const MAX_CONTEXT_CHARS = 20000
const MAX_NEGATIVE_PROMPT_CHARS = 5000
const MAX_RETRIES = 2
const RETRY_DELAYS = [50, 100]

const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
// 魔数签名：PNG / JPEG / WebP(RIFF....WEBP) / GIF / BMP
const MAGIC_SIGNATURES = [
  { ext: ['.png'], bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { ext: ['.jpg', '.jpeg'], bytes: [0xFF, 0xD8, 0xFF] },
  { ext: ['.webp'], bytes: [0x52, 0x49, 0x46, 0x46], tail: 'WEBP' },
  { ext: ['.gif'], bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: ['.bmp'], bytes: [0x42, 0x4D] },
]

function makeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

function isRetryable (error) {
  const code = error && error.code
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') return true
  return typeof code === 'number' && (code === 429 || code >= 500)
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function assertImageFile (imagePath) {
  if (!fs.existsSync(imagePath)) throw makeError('EVAL_IMAGE_NOT_FOUND', '图片文件不存在: ' + imagePath)
  let stat
  try {
    stat = fs.statSync(imagePath)
  } catch (_) {
    throw makeError('EVAL_IMAGE_UNREADABLE', '图片文件无法读取: ' + imagePath)
  }
  if (!stat.isFile()) throw makeError('EVAL_IMAGE_UNREADABLE', '图片路径不是文件: ' + imagePath)
  if (stat.size > MAX_IMAGE_BYTES) throw makeError('EVAL_IMAGE_TOO_LARGE', '图片过大（>8MB），请压缩后重试: ' + imagePath)
  const ext = path.extname(imagePath).toLowerCase()
  if (!ALLOWED_IMAGE_EXT.has(ext)) throw makeError('EVAL_IMAGE_INVALID', '不支持的图片格式: ' + ext + '（允许 png/jpg/jpeg/webp/gif/bmp）')
  // 魔数校验：拒绝伪装成图片的任意文件（防本地文件外带）
  const fd = fs.openSync(imagePath, 'r')
  try {
    const head = Buffer.alloc(16)
    const read = fs.readSync(fd, head, 0, head.length, 0)
    const sig = MAGIC_SIGNATURES.find(s => s.ext.includes(ext))
    if (!sig) throw makeError('EVAL_IMAGE_INVALID', '无法识别的图片签名: ' + imagePath)
    const headOk = sig.bytes.every((b, i) => i < read && head[i] === b)
    if (!headOk) throw makeError('EVAL_IMAGE_INVALID', '图片内容与扩展名不符，已拒绝: ' + imagePath)
    if (sig.tail && head.toString('latin1', 8, 12) !== sig.tail) {
      throw makeError('EVAL_IMAGE_INVALID', '图片内容与扩展名不符，已拒绝: ' + imagePath)
    }
  } finally {
    try { fs.closeSync(fd) } catch (_) { /* ignore */ }
  }
  return true
}

function validateRequest (request) {
  if (!request || typeof request !== 'object') throw makeError('EVAL_INVALID_REQUEST', '评估请求必须是对象')
  if (request.mediaType !== 'image') {
    if (request.mediaType === 'video') throw makeError('EVAL_MEDIA_TYPE_NOT_SUPPORTED', '视频评估暂未实现，请使用图片进行评估')
    throw makeError('EVAL_MEDIA_TYPE_NOT_SUPPORTED', '不支持的媒体类型: ' + String(request.mediaType))
  }
  if (!Array.isArray(request.items) || request.items.length === 0) throw makeError('EVAL_EMPTY_ITEMS', '请至少提供 1 张图片')
  if (request.items.length > MAX_ITEMS) throw makeError('EVAL_TOO_MANY_IMAGES', '单次最多评估 ' + MAX_ITEMS + ' 张图片')
  const language = request.options && request.options.language
  if (language !== undefined && language !== null && language !== 'zh' && language !== 'en') {
    throw makeError('EVAL_LANGUAGE_INVALID', '不支持的语言: ' + language)
  }
  let temperature = 0
  if (request.options && request.options.temperature !== undefined && request.options.temperature !== null) {
    const t = Number(request.options.temperature)
    if (!Number.isFinite(t)) throw makeError('EVAL_TEMPERATURE_INVALID', 'temperature 必须是数字')
    temperature = Math.min(2, Math.max(0, t))
  }
  const items = []
  for (let i = 0; i < request.items.length; i++) {
    const raw = request.items[i]
    if (!raw || typeof raw !== 'object') throw makeError('EVAL_INVALID_ITEM', '第 ' + (i + 1) + ' 项评估输入无效')
    const { snapshot, sanitizedKeys } = normalizeContextSnapshot(raw.context)
    if (sanitizedKeys.length > 0) throw makeError('EVAL_SENSITIVE_CONTEXT', '上下文中包含敏感字段，已拒绝: ' + sanitizedKeys.join(','))
    if (snapshot && JSON.stringify(snapshot).length > MAX_CONTEXT_CHARS) {
      throw makeError('EVAL_CONTEXT_TOO_LONG', '文案上下文不能超过 ' + MAX_CONTEXT_CHARS + ' 字符')
    }
    const optimizedPrompt = typeof raw.optimizedPrompt === 'string' ? raw.optimizedPrompt.trim() : ''
    if (!optimizedPrompt) throw makeError('EVAL_OPTIMIZED_PROMPT_INVALID', '优化后的提示词不能为空')
    if (optimizedPrompt.length > MAX_OPTIMIZED_PROMPT_CHARS) throw makeError('EVAL_OPTIMIZED_PROMPT_INVALID', '优化后的提示词不能超过 ' + MAX_OPTIMIZED_PROMPT_CHARS + ' 字')
    const sourceText = typeof raw.sourceText === 'string' ? raw.sourceText.trim() : ''
    if (sourceText.length > MAX_SOURCE_TEXT_CHARS) throw makeError('EVAL_SOURCE_TOO_LONG', '原始文案不能超过 ' + MAX_SOURCE_TEXT_CHARS + ' 字符')
    if (!sourceText && !snapshot) throw makeError('EVAL_SOURCE_MISSING', '请填写原始文案或文案上下文')
    const negativePrompt = typeof raw.negativePrompt === 'string' ? raw.negativePrompt.trim() : ''
    if (negativePrompt.length > MAX_NEGATIVE_PROMPT_CHARS) throw makeError('EVAL_NEGATIVE_TOO_LONG', '负向提示不能超过 ' + MAX_NEGATIVE_PROMPT_CHARS + ' 字符')
    const imagePath = typeof raw.imagePath === 'string' && raw.imagePath.trim() ? raw.imagePath.trim() : ''
    if (!imagePath) throw makeError('EVAL_IMAGE_NOT_FOUND', '图片路径不能为空')
    assertImageFile(imagePath)
    items.push({
      imagePath,
      sourceText,
      context: snapshot,
      optimizedPrompt,
      negativePrompt,
      imageIndex: Number.isInteger(raw.imageIndex) ? raw.imageIndex : i,
      sanitizedKeys,
    })
  }
  return { mediaType: 'image', items, options: { ...(request.options || {}), temperature } }
}

function readImage (imagePath) {
  // R7：图片三族引自单一真源；gif/bmp 超出真源范围（image-mime 只登记桌面链落盘格式），保持字面量
  const mimeByExt = { ...IMAGE_EXT_TO_MIME, '.gif': 'image/gif', '.bmp': 'image/bmp' }
  const ext = path.extname(imagePath).toLowerCase()
  const mimeType = mimeByExt[ext] || 'image/png'
  const base64 = fs.readFileSync(imagePath).toString('base64')
  return { imagePath, mimeType, base64 }
}

async function callWithRetry (fn, label) {
  let lastError
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (e && (e.code === 'EVAL_LLM_INVALID_RESPONSE' || e.code === 'EVAL_LLM_UNAVAILABLE')) throw e
      if (!isRetryable(e)) throw e
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAYS[attempt] || 100)
    }
  }
  throw lastError
}

function createPromptEvalEngine ({ store, log }) {
  const logger = log || { info: () => {}, warn: () => {}, error: () => {}, notify: () => {} }

  /**
   * @param {object} request
   * @param {{ evaluator: ((ctx:any)=>Promise<string>)|null, evaluatorModel?: string|null }} opts
   */
  async function evaluateImages (request, opts) {
    let validated
    try {
      validated = validateRequest(request)
    } catch (e) {
      return { success: false, error: { code: e.code || 'EVAL_INVALID_REQUEST', message: e.message } }
    }
    if (!opts || typeof opts.evaluator !== 'function') {
      return { success: false, error: { code: 'EVAL_LLM_UNAVAILABLE', message: '未配置支持视觉评估的模型服务商' } }
    }
    try {
      const images = validated.items.map(item => readImage(item.imagePath))
      const builder = buildImageEvaluationPrompt({
        items: validated.items.map(item => ({
          sourceText: item.sourceText,
          context: item.context,
          optimizedPrompt: item.optimizedPrompt,
          negativePrompt: item.negativePrompt,
          imageIndex: item.imageIndex,
        })),
        imageCount: validated.items.length,
        language: (validated.options && validated.options.language) || 'zh',
      })
      const raw = await callWithRetry(() => opts.evaluator({ prompt: builder.prompt, images, temperature: validated.options.temperature }), 'evaluate')
      const parsed = parseAndValidate(raw, { imageCount: validated.items.length })
      const normalized = normalizeParsed(parsed, { imageCount: validated.items.length })
      const id = 'eval-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(4).toString('hex')
      const record = buildRecord({
        input: validated,
        parsed: normalized,
        meta: {
          id,
          evaluatorModel: (opts.evaluatorModel) || (opts.evaluator && opts.evaluator.lastModelId) || null,
          truncated: builder.truncated,
          sanitizedKeys: builder.sanitizedKeys,
        },
      })
      try {
        if (store) store.save({ record, markdown: toMarkdown(record) })
      } catch (storeError) {
        const wrapped = new Error('EVAL_STORE_WRITE_FAILED: 评估结果保存失败: ' + (storeError && storeError.message ? storeError.message : String(storeError)))
        wrapped.code = 'EVAL_STORE_WRITE_FAILED'
        throw wrapped
      }
      logger.info('PromptEval', 'evaluated ' + validated.items.length + ' image(s) -> ' + record.overallScore)
      return { success: true, report: record }
    } catch (e) {
      logger.warn('PromptEval', 'evaluation failed: ' + (e && e.message ? e.message : String(e)))
      return { success: false, error: { code: e.code || 'EVAL_INTERNAL', message: e.message } }
    }
  }

  return { evaluateImages, validateRequest }
}

module.exports = { createPromptEvalEngine }
