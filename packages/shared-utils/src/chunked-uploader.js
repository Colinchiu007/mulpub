/**
 * ChunkedUploader — 通用分片上传器
 *
 * 平台无关的文件分片上传基础类。
 * 各平台提供 uploadChunkFn 实现具体上传协议。
 *
 * 功能:
 * - 文件自动分片（可配置片大小）
 * - 逐块上传（可配置并发数，真实并行）
 * - 进度回调 + EventEmitter 事件
 * - 支持取消
 * - 文件 MD5 哈希（去重/断点续传标识）
 * - 分片级重试（uploadWithRetry，借鉴蚁小二 uploadWithRetry 模式）
 * - 上传进度门控（UploadEmitGate，借鉴蚁小二：大文件时间门控 / 小文件百分比门控）
 */
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const EventEmitter = require('events')

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024  // 5MB
const DEFAULT_CONCURRENCY = 1
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024  // 100MB（与蚁小二一致）

/**
 * 上传进度门控 — 避免过于频繁的上报
 * 大文件 (>100MB): 每 5 秒上报一次
 * 小文件: 每 10% 变化上报一次；分片数 ≤10 时每片都上报
 */
class UploadEmitGate {
  constructor (fileSize, totalParts) {
    this.fileSize = fileSize || 0
    this.totalParts = totalParts || 1
    this.lastEmitTime = 0
    this.lastEmitPercent = -100
  }

  shouldEmit (currentPart) {
    const now = Date.now()

    // 大文件：时间门控 (5秒)
    if (this.fileSize > LARGE_FILE_THRESHOLD) {
      if (now - this.lastEmitTime >= 5000) {
        this.lastEmitTime = now
        return true
      }
      return false
    }

    // 小文件：百分比门控（整数运算避免浮点误差）
    const percent = Math.round((currentPart + 1) * 100 / this.totalParts)
    if (this.totalParts <= 10) return true
    if (percent - this.lastEmitPercent >= 10 || percent >= 100) {
      this.lastEmitPercent = percent
      return true
    }
    return false
  }
}

class ChunkedUploader extends EventEmitter {
  constructor (options = {}) {
    super()
    this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE
    this.concurrency = Math.max(1, options.concurrency || DEFAULT_CONCURRENCY)
    this._cancelled = false
  }

  /**
   * 将文件拆分为 Buffer 分片
   * @param {string} filePath
   * @returns {Buffer[]}
   */
  splitFile (filePath) {
    const fd = fs.openSync(filePath, 'r')
    try {
      const stat = fs.fstatSync(fd)
      const chunks = []
      let offset = 0

      while (offset < stat.size) {
        const size = Math.min(this.chunkSize, stat.size - offset)
        const buf = Buffer.alloc(size)
        fs.readSync(fd, buf, 0, size, offset)
        chunks.push(buf)
        offset += size
      }

      return chunks
    } finally {
      fs.closeSync(fd)
    }
  }

  /**
   * 计算文件 MD5（用于上传去重 / 断点续传标识）
   * @param {string} filePath
   * @returns {string} 32 位小写 hex
   */
  static getMD5 (filePath) {
    return crypto.createHash('md5')
      .update(fs.readFileSync(filePath))
      .digest('hex')
  }

  /**
   * 执行分片上传（支持真实并发）
   *
   * @param {string} filePath - 本地文件路径
   * @param {Function} uploadChunkFn - async (chunk, index, total, uploadId) => { success }
   * @param {Function} onProgress - (percent, bytesUploaded, totalBytes) => void
   * @param {object} [options]
   * @param {number} [options.maxRetries=0] - 每片最大重试次数
   * @param {number} [options.retryDelay=2000] - 重试间隔 ms
   * @returns {Promise<{success, bytesUploaded, chunksTotal, error?, cancelled?, retries?}>}
   */
  async upload (filePath, uploadChunkFn, onProgress, options = {}) {
    return this.uploadWithRetry(filePath, uploadChunkFn, {
      maxRetries: options.maxRetries || 0,
      retryDelay: options.retryDelay || 2000,
      onProgress,
      emitGate: true,
    })
  }

  /**
   * 带重试的分片上传（借鉴蚁小二 uploadWithRetry 模式）
   *
   * @param {string} filePath - 本地文件路径
   * @param {Function} uploadChunkFn - async (chunk, index, total, uploadId) => { success }
   * @param {object} [options]
   * @param {number} [options.maxRetries=3] - 每片最大重试次数
   * @param {number} [options.retryDelay=2000] - 重试间隔 ms
   * @param {Function} [options.onProgress] - (percent, bytesUploaded, totalBytes) => void
   * @param {boolean} [options.emitGate=true] - 是否启用进度门控
   * @returns {Promise<{success, bytesUploaded, chunksTotal, error?, cancelled?, retries?}>}
   */
  async uploadWithRetry (filePath, uploadChunkFn, options = {}) {
    const {
      maxRetries = 3,
      retryDelay = 2000,
      onProgress = null,
      emitGate = true,
    } = options

    this._cancelled = false
    const stat = fs.statSync(filePath)
    const totalBytes = stat.size
    const chunks = this.splitFile(filePath)
    const totalChunks = chunks.length
    const uploadId = ChunkedUploader.generateUploadId()
    let bytesUploaded = 0
    let retries = 0
    const gate = new UploadEmitGate(totalBytes, totalChunks)

    // 初始回调
    if (typeof onProgress === 'function') {
      onProgress(0, 0, totalBytes)
    }

    const reportProgress = (index) => {
      if (typeof onProgress !== 'function') return
      const percent = Math.round((bytesUploaded / totalBytes) * 100)
      if (!emitGate || gate.shouldEmit(index)) {
        onProgress(percent, bytesUploaded, totalBytes)
      }
    }

    const uploadOne = async (chunk, index) => {
      let lastError = null
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (this._cancelled) {
          const err = new Error('用户取消')
          err.isCanceled = true
          throw err
        }
        try {
          const result = await uploadChunkFn(chunk, index, totalChunks, uploadId)
          if (result && result.success === false) {
            lastError = new Error(result.error || result.message || '分片上传失败')
          } else {
            return result
          }
        } catch (err) {
          if (err && err.isCanceled) throw err
          lastError = err
        }
        if (attempt < maxRetries) {
          retries++
          this.emit('chunk:retry', { uploadId, index, attempt: attempt + 1, error: lastError ? lastError.message : '' })
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }
      throw lastError || new Error('分片上传失败')
    }

    try {
      const results = new Array(totalChunks)
      let cursor = 0

      const worker = async () => {
        while (cursor < totalChunks) {
          if (this._cancelled) break
          const index = cursor++
          const chunk = chunks[index]
          try {
            await uploadOne(chunk, index)
            results[index] = true
            bytesUploaded += chunk.length
            reportProgress(index)
            this.emit('chunk:uploaded', { uploadId, index, total: totalChunks, bytes: chunk.length })
          } catch (err) {
            if (err && err.isCanceled) {
              this.emit('upload:error', { uploadId, index, error: '用户取消' })
              return { cancelled: true }
            }
            const errorMsg = err.message || '分片上传失败'
            this.emit('upload:error', { uploadId, index, error: errorMsg })
            return { error: errorMsg, index }
          }
        }
        return null
      }

      const workerCount = Math.min(this.concurrency, totalChunks)
      const workerResults = await Promise.all(Array.from({ length: workerCount }, () => worker()))

      const failure = workerResults.find(r => r && r.error)
      const cancelled = workerResults.some(r => r && r.cancelled)
      if (cancelled) {
        return { success: false, bytesUploaded, chunksTotal: totalChunks, cancelled: true }
      }
      if (failure) {
        return { success: false, bytesUploaded, chunksTotal: totalChunks, error: failure.error }
      }

      this.emit('upload:complete', { uploadId, bytesUploaded, chunksTotal: totalChunks })
      return { success: true, bytesUploaded, chunksTotal: totalChunks, retries }
    } catch (err) {
      const errorMsg = err.message || '上传异常'
      this.emit('upload:error', { uploadId, error: errorMsg })
      return { success: false, bytesUploaded, chunksTotal: totalChunks, error: errorMsg }
    }
  }

  /**
   * 取消当前上传
   */
  cancel () {
    this._cancelled = true
  }

  /**
   * 生成唯一上传 ID
   */
  static generateUploadId () {
    return `upload_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }
}

ChunkedUploader.UploadEmitGate = UploadEmitGate

module.exports = ChunkedUploader
