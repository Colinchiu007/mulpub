/**
 * Test: chunked-uploader.js — 通用分片上传器
 * 测试: 文件分片、逐块上传、进度回调、取消、事件
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const ChunkedUploader = require('../src/chunked-uploader')

describe('ChunkedUploader', () => {
  let uploader
  let tmpDir
  let testFilePath

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunked-uploader-test-'))
    // Create a test file of ~12MB (3 chunks of 5MB)
    testFilePath = path.join(tmpDir, 'test-video.mp4')
    const buf = Buffer.alloc(12 * 1024 * 1024, 'A')
    fs.writeFileSync(testFilePath, buf)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    uploader = new ChunkedUploader()
  })

  // ── Constructor ─────────────────────────────────────────────────

  test('uses default chunk size of 5MB', () => {
    expect(uploader.chunkSize).toBe(5 * 1024 * 1024)
  })

  test('extends EventEmitter', () => {
    expect(typeof uploader.on).toBe('function')
    expect(typeof uploader.emit).toBe('function')
  })

  test('accepts custom chunk size', () => {
    const custom = new ChunkedUploader({ chunkSize: 2 * 1024 * 1024 })
    expect(custom.chunkSize).toBe(2 * 1024 * 1024)
  })

  test('accepts custom concurrency', () => {
    const custom = new ChunkedUploader({ concurrency: 3 })
    expect(custom.concurrency).toBe(3)
  })

  // ── splitFile ───────────────────────────────────────────────────

  test('splitFile returns correct number of chunks for exact division', () => {
    const uploader5 = new ChunkedUploader({ chunkSize: 4 * 1024 * 1024 }) // 4MB
    const chunks = uploader5.splitFile(testFilePath)
    // 12MB / 4MB = 3 chunks
    expect(chunks).toHaveLength(3)
  })

  test('splitFile returns extra chunk for remainder', () => {
    const uploader5 = new ChunkedUploader({ chunkSize: 5 * 1024 * 1024 }) // 5MB
    const chunks = uploader5.splitFile(testFilePath)
    // 12MB / 5MB = 2 full + 1 partial = 3 chunks
    expect(chunks).toHaveLength(3)
  })

  test('splitFile chunk sizes sum to total file size', () => {
    const uploader5 = new ChunkedUploader({ chunkSize: 5 * 1024 * 1024 })
    const chunks = uploader5.splitFile(testFilePath)
    const total = chunks.reduce((sum, c) => sum + c.length, 0)
    expect(total).toBe(12 * 1024 * 1024)
  })

  test('splitFile throws on non-existent file', () => {
    expect(() => uploader.splitFile('/nonexistent/path.mp4')).toThrow()
  })

  // ── upload ──────────────────────────────────────────────────────

  test('upload calls uploadChunkFn for each chunk', async () => {
    const uploader5 = new ChunkedUploader({ chunkSize: 6 * 1024 * 1024 }) // 2 chunks
    const uploadChunkFn = vi.fn().mockResolvedValue({ success: true })
    const onProgress = vi.fn()

    const result = await uploader5.upload(testFilePath, uploadChunkFn, onProgress)

    expect(uploadChunkFn).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(true)
    expect(result.chunksTotal).toBe(2)
  })

  test('upload passes chunk data, index, and total to uploadChunkFn', async () => {
    const uploader5 = new ChunkedUploader({ chunkSize: 12 * 1024 * 1024 }) // 1 chunk
    const uploadChunkFn = vi.fn().mockResolvedValue({ success: true })

    await uploader5.upload(testFilePath, uploadChunkFn, vi.fn())

    expect(uploadChunkFn).toHaveBeenCalledWith(
      expect.any(Buffer),
      0,        // index (0-based)
      1,        // total
      expect.any(String)  // uploadId
    )
  })

  test('upload calls onProgress with 0% and 100%', async () => {
    const uploader5 = new ChunkedUploader({ chunkSize: 12 * 1024 * 1024 })
    const onProgress = vi.fn()

    await uploader5.upload(testFilePath, () => ({ success: true }), onProgress)

    expect(onProgress).toHaveBeenCalledWith(0, 0, 12 * 1024 * 1024)
    expect(onProgress).toHaveBeenCalledWith(100, 12 * 1024 * 1024, 12 * 1024 * 1024)
  })

  test('upload emits chunk:uploaded for each chunk', async () => {
    const uploader5 = new ChunkedUploader({ chunkSize: 6 * 1024 * 1024 })
    const emitted = []
    uploader5.on('chunk:uploaded', (data) => emitted.push(data))

    await uploader5.upload(testFilePath, () => ({ success: true }), vi.fn())

    expect(emitted).toHaveLength(2)
    expect(emitted[0].index).toBe(0)
    expect(emitted[1].index).toBe(1)
  })

  test('upload emits upload:complete on success', async () => {
    const emitted = []
    const u = new ChunkedUploader({ chunkSize: 12 * 1024 * 1024 })
    u.on('upload:complete', (data) => emitted.push(data))

    await u.upload(testFilePath, () => ({ success: true }), vi.fn())

    expect(emitted).toHaveLength(1)
    expect(emitted[0].bytesUploaded).toBe(12 * 1024 * 1024)
  })

  test('upload emits upload:error and returns failed result on chunk failure', async () => {
    const errors = []
    uploader.on('upload:error', (data) => errors.push(data))

    const result = await uploader.upload(
      testFilePath,
      () => { throw new Error('upload failed') },
      vi.fn()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('upload failed')
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  // ── cancel ──────────────────────────────────────────────────────

  test('cancel stops upload and returns partial result', async () => {
    const uploader5 = new ChunkedUploader({ chunkSize: 4 * 1024 * 1024 })
    let callCount = 0

    const result = await uploader5.upload(
      testFilePath,
      async () => {
        callCount++
        if (callCount === 2) {
          uploader5.cancel()
        }
        return { success: true }
      },
      vi.fn()
    )

    expect(result.success).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(callCount).toBe(2)  // 1st + 2nd (which triggers cancel)
  })

  test('cancel resets cancelled flag', () => {
    uploader.cancel()
    expect(uploader._cancelled).toBe(true)
  })

  // ── cancelUpload (static/reset) ─────────────────────────────────

  test('cancelUpload generates unique upload ID', () => {
    const id1 = ChunkedUploader.generateUploadId()
    const id2 = ChunkedUploader.generateUploadId()
    expect(id1).not.toBe(id2)
  })

  // ── getMD5 ────────────────────────────────────────────────────

  describe('getMD5', () => {
    test('returns correct MD5 hash for a file', () => {
      const hash = ChunkedUploader.getMD5(testFilePath)
      expect(hash).toHaveLength(32)
      expect(hash).toMatch(/^[a-f0-9]{32}$/)
    })

    test('returns different MD5 for different files', () => {
      const otherPath = path.join(tmpDir, 'test-other.bin')
      fs.writeFileSync(otherPath, Buffer.alloc(100, 'B'))
      const hash1 = ChunkedUploader.getMD5(testFilePath)
      const hash2 = ChunkedUploader.getMD5(otherPath)
      expect(hash1).not.toBe(hash2)
    })

    test('throws on non-existent file', () => {
      expect(() => ChunkedUploader.getMD5('/nonexistent/file.bin')).toThrow()
    })
  })

  // ── uploadWithRetry ────────────────────────────────────────────

  describe('uploadWithRetry', () => {
    test('retries on chunk failure and succeeds on retry', async () => {
      const uploader1 = new ChunkedUploader({ chunkSize: 12 * 1024 * 1024 }) // 1 chunk
      let attempts = 0
      const uploadChunkFn = vi.fn(async () => {
        attempts++
        if (attempts === 1) throw new Error('第一片失败')
        return { success: true }
      })
      const onProgress = vi.fn()

      const result = await uploader1.uploadWithRetry(testFilePath, uploadChunkFn, {
        maxRetries: 2,
        retryDelay: 10,
        onProgress,
      })

      expect(attempts).toBe(2) // 1st fails, 2nd succeeds
      expect(result.success).toBe(true)
      expect(result.retries).toBe(1)
    })

    test('fails after exhausting maxRetries', async () => {
      const uploader4 = new ChunkedUploader({ chunkSize: 12 * 1024 * 1024 }) // 1 chunk
      const uploadChunkFn = vi.fn(async () => { throw new Error('总是失败') })
      const onProgress = vi.fn()

      const result = await uploader4.uploadWithRetry(testFilePath, uploadChunkFn, {
        maxRetries: 2,
        retryDelay: 10,
        onProgress,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('总是失败')
      expect(result.retries).toBe(2) // 2 retries attempted
    })

    test('respects cancel during retry', async () => {
      const uploader4 = new ChunkedUploader({ chunkSize: 6 * 1024 * 1024 })
      let callCount = 0
      const uploadChunkFn = vi.fn(async () => {
        callCount++
        if (callCount === 2) uploader4.cancel()
        throw new Error('失败')
      })
      const onProgress = vi.fn()

      const result = await uploader4.uploadWithRetry(testFilePath, uploadChunkFn, {
        maxRetries: 5,
        retryDelay: 10,
        onProgress,
      })

      expect(result.success).toBe(false)
      expect(result.cancelled).toBe(true)
    })
  })

  // ── UploadEmitGate ─────────────────────────────────────────────

  test('UploadEmitGate throttles large files by time (5s interval)', () => {
    const gate = new ChunkedUploader.UploadEmitGate(200 * 1024 * 1024, 10) // 200MB, 10 parts
    expect(gate.shouldEmit(0)).toBe(true) // first emit always
    expect(gate.shouldEmit(1)).toBe(false) // too soon
    // should not crash
  })

  test('UploadEmitGate throttles small files by percentage (10% change)', () => {
    const gate = new ChunkedUploader.UploadEmitGate(50 * 1024 * 1024, 20) // 50MB, 20 parts
    expect(gate.shouldEmit(0)).toBe(true) // first
    expect(gate.shouldEmit(1)).toBe(false) // 5% not enough
    expect(gate.shouldEmit(2)).toBe(true) // 10% reached
    expect(gate.shouldEmit(3)).toBe(false) // 5% again
  })

  test('UploadEmitGate always emits on last chunk', () => {
    const gate = new ChunkedUploader.UploadEmitGate(50 * 1024 * 1024, 10)
    gate.shouldEmit(0) // consume first
    // last part should always emit
    expect(gate.shouldEmit(9)).toBe(true)
  })

  // ── concurrency ────────────────────────────────────────────────

  test('respects concurrency option for parallel uploads', async () => {
    const uploader2 = new ChunkedUploader({ chunkSize: 4 * 1024 * 1024, concurrency: 2 }) // 3 chunks
    const running = new Set()
    const maxConcurrent = { value: 0 }
    const uploadChunkFn = vi.fn(async () => {
      running.add(true)
      maxConcurrent.value = Math.max(maxConcurrent.value, running.size)
      await new Promise(r => setTimeout(r, 20))
      running.delete(true)
      return { success: true }
    })
    const onProgress = vi.fn()

    const result = await uploader2.upload(testFilePath, uploadChunkFn, onProgress)

    expect(result.success).toBe(true)
    // At least 2 chunks ran concurrently
    expect(maxConcurrent.value).toBeGreaterThanOrEqual(2)
  })

})
