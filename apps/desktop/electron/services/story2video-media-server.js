// @ts-check
'use strict'

const crypto = require('crypto')
const { MIME_TO_EXT: IMAGE_MIME_TO_EXT, EXT_TO_MIME: IMAGE_EXT_TO_MIME } = require('@multi-publish/shared-utils/src/image-mime')
const fs = require('fs')
const http = require('http')
const path = require('path')

const STORY2VIDEO_MEDIA_HOST = '127.0.0.1'
const STORY2VIDEO_MEDIA_PATH = '/media/'
const DEFAULT_MAX_ENTRIES = 128
const MAX_REGISTRY_ENTRIES = 256
const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

const CONTENT_TYPES = Object.freeze({
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  // 图片类型缺失会导致响应带 X-Content-Type-Options: nosniff 时
  // <img> 拒绝渲染 octet-stream 内容（分段编辑区图片显示不出来的根因）
  // R7：图片三族引自单一真源（@multi-publish/shared-utils/image-mime）；audio/video/gif 保持本表
  ...IMAGE_EXT_TO_MIME,
  '.gif': 'image/gif',
})

function positiveInteger (value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function defaultTokenFactory () {
  return crypto.randomBytes(24).toString('base64url')
}

function mediaContentType (filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function tokenFromPath (value) {
  if (typeof value !== 'string' || !value.startsWith(STORY2VIDEO_MEDIA_PATH)) return null
  const token = value.slice(STORY2VIDEO_MEDIA_PATH.length)
  return TOKEN_PATTERN.test(token) ? token : null
}

function parseRange (value, size) {
  if (!value) return null
  if (typeof value !== 'string' || !/^bytes=\d*-\d*$/.test(value)) return false
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return false
  let start
  let end
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false
  return { start, end: Math.min(end, size - 1) }
}

class Story2VideoMediaServer {
  constructor (options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    this.tokenFactory = typeof options.tokenFactory === 'function' ? options.tokenFactory : defaultTokenFactory
    this.maxEntries = Math.min(positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES), MAX_REGISTRY_ENTRIES)
    this.tokenTtlMs = positiveInteger(options.tokenTtlMs, DEFAULT_TOKEN_TTL_MS)
    this.host = options.host || STORY2VIDEO_MEDIA_HOST
    this.serverFactory = typeof options.serverFactory === 'function' ? options.serverFactory : http.createServer
    this.entries = new Map()
    this.server = null
    this.origin = ''
    this.startPromise = null
  }

  get size () {
    this._pruneExpired()
    return this.entries.size
  }

  async start () {
    if (this.origin) return this.origin
    if (this.startPromise) return this.startPromise

    const server = this.serverFactory((request, response) => { this.handleRequest(request, response) })
    this.server = server
    this.startPromise = new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string' || !Number.isInteger(address.port)) {
          reject(new Error('Story2Video 媒体服务端口不可用'))
          return
        }
        this.origin = 'http://' + this.host + ':' + address.port
        resolve(this.origin)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, this.host)
    }).catch((error) => {
      if (this.server === server) this.server = null
      this.startPromise = null
      throw error
    })
    return this.startPromise
  }

  async stop () {
    this.clear()
    const pendingStart = this.startPromise
    if (pendingStart && !this.origin) {
      try { await pendingStart } catch { return }
    }
    const server = this.server
    this.server = null
    this.origin = ''
    this.startPromise = null
    if (!server) return
    await new Promise((resolve) => { server.close(() => resolve()) })
  }

  createUrl (filePath) {
    if (!this.origin) throw new Error('Story2Video 媒体服务未启动')
    if (typeof filePath !== 'string' || !filePath.trim() || !path.isAbsolute(filePath)) {
      throw new Error('Story2Video 媒体路径必须是绝对路径')
    }
    const canonicalPath = fs.realpathSync.native(filePath)
    const stat = fs.lstatSync(canonicalPath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Story2Video 媒体文件不可读')
    this._pruneExpired()
    this._enforceCapacity()
    const token = this._createToken()
    this.entries.set(token, { filePath: canonicalPath, expiresAt: this.now() + this.tokenTtlMs })
    return this.origin + STORY2VIDEO_MEDIA_PATH + token
  }

  revoke (value) {
    let token
    if (TOKEN_PATTERN.test(value)) token = value
    else {
      try {
        token = tokenFromPath(new URL(value).pathname)
      } catch {
        return false
      }
    }
    return token ? this.entries.delete(token) : false
  }

  clear () {
    const count = this.entries.size
    this.entries.clear()
    return count
  }

  async handleRequest (request, response) {
    response.setHeader('Cache-Control', 'no-store, private')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (!request || !['GET', 'HEAD'].includes(request.method || '')) return this._notFound(response)
    let requestUrl
    try { requestUrl = new URL(request.url || '', this.origin || 'http://' + this.host) } catch { return this._notFound(response) }
    if (requestUrl.search || requestUrl.hash) return this._notFound(response)
    const token = tokenFromPath(requestUrl.pathname)
    if (!token) return this._notFound(response)
    const entry = this.entries.get(token)
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry) this.entries.delete(token)
      return this._notFound(response)
    }

    let stat
    try {
      const linkStat = await fs.promises.lstat(entry.filePath)
      const canonicalPath = await fs.promises.realpath(entry.filePath)
      if (!linkStat.isFile() || linkStat.isSymbolicLink() || canonicalPath !== entry.filePath) return this._notFound(response)
      stat = await fs.promises.stat(canonicalPath)
      if (!stat.isFile() || stat.size <= 0) return this._notFound(response)
    } catch {
      return this._notFound(response)
    }

    const range = parseRange(request.headers.range, stat.size)
    if (range === false) {
      response.writeHead(416, { 'Content-Range': 'bytes */' + stat.size })
      response.end()
      return
    }
    const start = range ? range.start : 0
    const end = range ? range.end : stat.size - 1
    const contentLength = end - start + 1
    response.writeHead(range ? 206 : 200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': mediaContentType(entry.filePath),
      ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size } : {}),
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const stream = fs.createReadStream(entry.filePath, { start, end })
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  }

  _notFound (response) {
    response.statusCode = 404
    response.end()
  }

  _pruneExpired () {
    const now = this.now()
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token)
    }
  }

  _enforceCapacity () {
    while (this.entries.size >= this.maxEntries) {
      const oldestToken = this.entries.keys().next().value
      if (!oldestToken) return
      this.entries.delete(oldestToken)
    }
  }

  _createToken () {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = this.tokenFactory()
      if (typeof token === 'string' && TOKEN_PATTERN.test(token) && !this.entries.has(token)) return token
    }
    throw new Error('无法创建 Story2Video 媒体访问令牌')
  }
}

let sharedMediaServer = null

function getStory2VideoMediaServer (options = {}) {
  if (!sharedMediaServer) sharedMediaServer = new Story2VideoMediaServer(options)
  return sharedMediaServer
}

module.exports = {
  STORY2VIDEO_MEDIA_HOST,
  STORY2VIDEO_MEDIA_PATH,
  DEFAULT_MAX_ENTRIES,
  MAX_REGISTRY_ENTRIES,
  DEFAULT_TOKEN_TTL_MS,
  Story2VideoMediaServer,
  getStory2VideoMediaServer,
  parseRange,
  tokenFromPath,
}
