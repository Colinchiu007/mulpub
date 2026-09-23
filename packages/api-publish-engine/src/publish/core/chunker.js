'use strict'
/**
 * chunker.js — FileChunker 等价物（W1 §3.3）
 *
 * 参考产品上传链路逐字对齐：默认片长 8MiB（8388608），按字节区间切分，
 * 产出可直接填 PUT 分片请求的 Content-Range 头（闭区间，HTTP 规范形态）。
 */
const DEFAULT_CHUNK_SIZE = 8388608 // 8 * 1024 * 1024

/**
 * 纯计算分片计划（不依赖文件实体，实际读取按 start/size 做 slice）。
 * @param {number} totalBytes 文件总字节数（>0，fail-closed）
 * @param {{chunkSize?: number}} [opts]
 * @returns {Array<{index:number,start:number,end:number,size:number,contentRange:string}>}
 */
function chunkTotal (totalBytes, opts = {}) {
  const chunkSize = opts.chunkSize === undefined ? DEFAULT_CHUNK_SIZE : opts.chunkSize
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new Error('chunker: totalBytes must be a positive number, got ' + totalBytes)
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunker: chunkSize must be a positive integer, got ' + chunkSize)
  }
  const parts = []
  for (let start = 0, index = 0; start < totalBytes; start += chunkSize, index++) {
    const size = Math.min(chunkSize, totalBytes - start)
    parts.push({
      index,
      start,
      end: start + size - 1,
      size,
      contentRange: 'bytes ' + start + '-' + (start + size - 1) + '/' + totalBytes,
    })
  }
  return parts
}

module.exports = { chunkTotal, DEFAULT_CHUNK_SIZE }
