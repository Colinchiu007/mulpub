// @ts-check
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import path from 'path'
import { Readable } from 'stream'

const mod = require('./podcast-hosting-upload.js')
const {
  HOSTING_PROVIDERS,
  HOSTING_PROVIDER_INPUT_VALUES,
  DEFAULT_PATH_PREFIX,
  validateHosting,
  safeFileStem,
  normalizePathPrefix,
  deriveObjectKey,
  objectPublicUrl,
  ossCanonicalizedResource,
  ossV1StringToSign,
  buildOssPutHeaders,
  buildEngineUploadToken,
  audioContentTypeFromPath,
  putObject
} = mod

const AK = 'LTAI-test-accesskey-id'
const SECRET = 'super-secret-value-should-never-leak'
const DATE = 'Wed, 09 Oct 2026 00:00:00 GMT'

/** 只用于构造断言期望值的编码串，不参与实现复用。 */
function sign (stringToSign) {
  return crypto.createHmac('sha1', SECRET).update(stringToSign).digest('base64')
}

describe('podcast-hosting-upload · 托管配置资格判定（fail closed）', () => {
  it('未配置托管时只报一个必需码，不猜 provider', () => {
    expect(validateHosting(null).map((i) => i.code)).toEqual(['PODCAST_HOSTING_REQUIRED'])
    expect(validateHosting('oss').map((i) => i.code)).toEqual(['PODCAST_HOSTING_REQUIRED'])
    expect(validateHosting([]).map((i) => i.code)).toEqual(['PODCAST_HOSTING_REQUIRED'])
  })

  it('provider 取值分三档：不合法 / 合法但本期未接入 / 已接入', () => {
    expect(HOSTING_PROVIDER_INPUT_VALUES).toEqual(['oss', 'cos'])
    expect(HOSTING_PROVIDERS).toEqual(['oss'])
    const cos = validateHosting({ provider: 'cos' })
    expect(cos.map((i) => i.code)).toEqual(['PODCAST_HOSTING_PROVIDER_UNSUPPORTED'])
    expect(cos[0].message).toContain('外链')
    expect(validateHosting({ provider: 'ftp' }).map((i) => i.code)).toEqual(['PODCAST_HOSTING_PROVIDER_INVALID'])
    expect(validateHosting({ provider: '' }).map((i) => i.code)).toEqual(['PODCAST_HOSTING_PROVIDER_INVALID'])
  })

  it('endpoint / bucket / 凭证三项各自独立报码（排查方向不同不得合并）', () => {
    expect(validateHosting({ provider: 'OSS' }).map((i) => i.code)).toEqual([
      'PODCAST_HOSTING_ENDPOINT_REQUIRED',
      'PODCAST_HOSTING_BUCKET_REQUIRED',
      'PODCAST_HOSTING_CREDENTIAL_REQUIRED'
    ])
    expect(validateHosting({
      provider: 'oss',
      endpoint: ' oss-cn-hangzhou.aliyuncs.com ',
      bucket: 'mybucket',
      accessKeyId: AK,
      accessKeySecret: SECRET
    })).toEqual([])
  })

  it('凭证只缺一侧也算未配置', () => {
    const onlyId = validateHosting({ provider: 'oss', endpoint: 'e', bucket: 'b', accessKeyId: AK })
    expect(onlyId.map((i) => i.code)).toEqual(['PODCAST_HOSTING_CREDENTIAL_REQUIRED'])
    expect(onlyId[0].field).toBe('hosting.accessKeyId')
  })

  it('路径前缀含 . / .. / 前导斜杠 ⇒ 出声拒绝，不得静默清洗成另一个前缀', () => {
    const base = { provider: 'oss', endpoint: 'e', bucket: 'b', accessKeyId: AK, accessKeySecret: SECRET }
    for (const bad of ['feeds/../secret', '/feeds', 'feeds/./x']) {
      const codes = validateHosting({ ...base, pathPrefix: bad }).map((i) => i.code)
      expect(codes, bad).toContain('PODCAST_HOSTING_PREFIX_UNSAFE')
    }
    // 合法值与留空（走默认前缀）都不得被这条判据误伤
    expect(validateHosting({ ...base, pathPrefix: 'feeds' })).toEqual([])
    expect(validateHosting({ ...base, pathPrefix: '' })).toEqual([])
    expect(validateHosting(base)).toEqual([])
  })
})

describe('podcast-hosting-upload · object_key 派生（禁止标题与路径穿越进公网 URL）', () => {
  it('文件名只取 basename，穿越与非法字符被吃掉，扩展名限 1~8 位', () => {
    expect(safeFileStem('../../etc/passwd')).toEqual({ stem: 'passwd', ext: '' })
    expect(safeFileStem('a/b/我的节目 第3期.mp3')).toEqual({ stem: '3', ext: '.mp3' })
    expect(safeFileStem('evil.exe')).toEqual({ stem: 'evil', ext: '.exe' })
    expect(safeFileStem('x.tar.gz')).toEqual({ stem: 'x.tar', ext: '.gz' })
    // 超长尾巴（>8 位）不会被当成扩展名：ext 为空，余部并入 stem（点号本身是合法字符）。
    expect(safeFileStem('x.toolongextension')).toEqual({ stem: 'x.toolongextension', ext: '' })
    expect(safeFileStem('')).toEqual({ stem: 'audio', ext: '' })
    expect(safeFileStem('   ')).toEqual({ stem: 'audio', ext: '' })
    expect(safeFileStem(`-${'z'.repeat(120)}.mp3`).stem).toHaveLength(80)
  })

  it('pathPrefix 逐段清洗后为空必须回落默认前缀', () => {
    expect(normalizePathPrefix(null)).toBe(DEFAULT_PATH_PREFIX)
    expect(normalizePathPrefix('')).toBe(DEFAULT_PATH_PREFIX)
    expect(normalizePathPrefix('/../../')).toBe(DEFAULT_PATH_PREFIX)
    expect(normalizePathPrefix(' a / b c ')).toBe('a/b-c')
    expect(DEFAULT_PATH_PREFIX).toBe('podcast')
  })

  it('object_key 形态精确锁定：<prefix>/<channelId>/<stem>-<episodeId><ext>', () => {
    expect(deriveObjectKey({ pathPrefix: 'podcast', channelId: 'ch1', episodeId: 'ep2', fileName: 'show.mp3' }))
      .toBe('podcast/ch1/show-ep2.mp3')
    expect(deriveObjectKey({ channelId: 'ch1', episodeId: 'ep2', fileName: 'show.mp3' }))
      .toBe('podcast/ch1/show-ep2.mp3')
  })

  it('object_key 不得含用户标题，且穿越尝试不会跳出前缀层', () => {
    const key = deriveObjectKey({ pathPrefix: 'a/../../etc', channelId: '../../x', episodeId: '../ep', fileName: '../name.mp3' })
    expect(key).toBe('a/etc/x/name-ep.mp3')
    // 判据按「路径段」而不是「子串」：'-..-' 形态的残留不是穿越，真正的 '..' 段才是。
    expect(key.split('/')).not.toContain('..')
    expect(key.split('/')).toHaveLength(4)
    expect(deriveObjectKey({ channelId: '..', episodeId: '..', fileName: 'a.mp3' }).split('/'))
      .not.toContain('..')
  })

  it('同名的两次上传（不同 episodeId）不得互相覆盖', () => {
    const base = { pathPrefix: 'podcast', channelId: 'ch1', fileName: 'same.mp3' }
    expect(deriveObjectKey({ ...base, episodeId: 'e1' })).not.toBe(deriveObjectKey({ ...base, episodeId: 'e2' }))
  })
})

describe('podcast-hosting-upload · 公网 URL 拼接（不得拼出 bucket.bucket）', () => {
  it('endpoint 已带 bucket 前缀时不重复拼', () => {
    expect(objectPublicUrl({ endpoint: 'mybucket.oss-cn-hz.aliyuncs.com', bucket: 'mybucket', objectKey: 'podcast/ch1/a.mp3' }))
      .toBe('https://mybucket.oss-cn-hz.aliyuncs.com/podcast/ch1/a.mp3')
  })

  it('endpoint 写成完整 URL 或带尾斜杠时得到同一个 host', () => {
    expect(objectPublicUrl({ endpoint: 'https://oss-cn-hz.aliyuncs.com/', bucket: 'mybucket', objectKey: 'k.mp3' }))
      .toBe('https://mybucket.oss-cn-hz.aliyuncs.com/k.mp3')
    expect(objectPublicUrl({ endpoint: 'OSS-CN-HZ.aliyuncs.com', bucket: 'MyBucket', objectKey: '/k.mp3' }))
      .toBe('https://MyBucket.OSS-CN-HZ.aliyuncs.com/k.mp3')
  })

  it('key 逐段编码，空格与中文不得原样进 URL', () => {
    expect(objectPublicUrl({ endpoint: 'e.com', bucket: 'b', objectKey: 'podcast/第 1 期/a b.mp3' }))
      .toBe('https://b.e.com/podcast/%E7%AC%AC%201%20%E6%9C%9F/a%20b.mp3')
  })

  it('三项任一缺失一律不产出 URL（不得拼出半截 enclosure）', () => {
    expect(objectPublicUrl({ endpoint: '', bucket: 'b', objectKey: 'k' })).toBeNull()
    expect(objectPublicUrl({ endpoint: 'e', bucket: '', objectKey: 'k' })).toBeNull()
    expect(objectPublicUrl({ endpoint: 'e', bucket: 'b', objectKey: '' })).toBeNull()
    expect(objectPublicUrl()).toBeNull()
  })
})

describe('podcast-hosting-upload · OSS V1 待签串（结构断言，不得用 toContain）', () => {
  it('CanonicalizedResource 恒为 /bucket/key，与 URL 编码无关', () => {
    expect(ossCanonicalizedResource({ bucket: 'mybucket', objectKey: '/podcast/ch1/a b.mp3' }))
      .toBe('/mybucket/podcast/ch1/a b.mp3')
  })

  it('无 STS 时 CanonicalizedOSSHeaders 只含 x-oss-date 一项（以换行结尾）', () => {
    // 注意：Date 槽位与 x-oss-date 头同时携带同一时间戳是本实现的既有口径，
    // 真实 bucket 的 SignatureDoesNotMatch 取证尚未做过（见 PRD「形态 B 待真机验证」）。
    // 这条精确断言的作用是让任何后续改动都必须是一次有意识的变更，而不是顺手漂移。
    expect(ossV1StringToSign({
      method: 'put',
      contentType: 'audio/mpeg',
      date: DATE,
      canonicalizedResource: '/mybucket/podcast/ch1/e1.mp3'
    })).toBe(`PUT\n\naudio/mpeg\n${DATE}\nx-oss-date:${DATE}\n/mybucket/podcast/ch1/e1.mp3`)
  })

  it('带 STS 时两个 x-oss 头按字典序排列且以换行结尾', () => {
    expect(ossV1StringToSign({
      method: 'PUT',
      contentType: 'audio/mpeg',
      date: DATE,
      canonicalizedResource: '/b/k.mp3',
      securityToken: 'STS'
    })).toBe(`PUT\n\naudio/mpeg\n${DATE}\nx-oss-date:${DATE}\nx-oss-security-token:STS\n/b/k.mp3`)
  })

  it('Content-MD5 槽位恒为空行（本期不做 MD5，槽位不得被挪用）', () => {
    const s = ossV1StringToSign({ method: 'PUT', contentType: 'audio/wav', date: DATE, canonicalizedResource: '/b/k' })
    expect(s.split('\n')).toEqual(['PUT', '', 'audio/wav', DATE, `x-oss-date:${DATE}`, '/b/k'])
  })
})

describe('podcast-hosting-upload · 签名头（凭证不得出现在返回值里）', () => {
  it('Authorization 为 OSS <ak>:<hmac>，且逐字节等于按待签串手算的结果', () => {
    const headers = buildOssPutHeaders({
      endpoint: 'oss-cn-hz.aliyuncs.com',
      bucket: 'mybucket',
      objectKey: 'podcast/ch1/e1.mp3',
      contentType: 'audio/mpeg',
      accessKeyId: AK,
      accessKeySecret: SECRET,
      date: DATE
    })
    const expected = sign(`PUT\n\naudio/mpeg\n${DATE}\nx-oss-date:${DATE}\n/mybucket/podcast/ch1/e1.mp3`)
    expect(headers.Authorization).toBe(`OSS ${AK}:${expected}`)
    expect(headers['x-oss-date']).toBe(DATE)
    expect(headers['Content-Type']).toBe('audio/mpeg')
  })

  it('长期 AK 形态不得出现 x-oss-security-token 头', () => {
    const headers = buildOssPutHeaders({
      bucket: 'b', objectKey: 'k', contentType: 'audio/mpeg',
      accessKeyId: AK, accessKeySecret: SECRET, date: DATE
    })
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type', 'x-oss-date'])
  })

  it('STS 形态才带 security token 头', () => {
    const headers = buildOssPutHeaders({
      bucket: 'b', objectKey: 'k', contentType: 'audio/mpeg',
      accessKeyId: AK, accessKeySecret: SECRET, securityToken: 'STS-TOKEN', date: DATE
    })
    expect(headers['x-oss-security-token']).toBe('STS-TOKEN')
  })

  it('AccessKeySecret 绝不出现在返回的头部集合里（只以签名摘要形态出现）', () => {
    const headers = buildOssPutHeaders({
      bucket: 'b', objectKey: 'k', contentType: 'audio/mpeg',
      accessKeyId: AK, accessKeySecret: SECRET, date: DATE
    })
    expect(JSON.stringify(headers)).not.toContain(SECRET)
    expect(headers.Authorization.split(':')[1]).not.toBe(SECRET)
  })

  it('缺省 date 时自行生成 RFC1123 时间（不得留空导致签出坏串）', () => {
    const headers = buildOssPutHeaders({ bucket: 'b', objectKey: 'k', accessKeyId: AK, accessKeySecret: SECRET })
    expect(new Date(headers['x-oss-date']).toString()).not.toBe('Invalid Date')
  })

  it('Content-Type 缺省回落 octet-stream', () => {
    const headers = buildOssPutHeaders({ bucket: 'b', objectKey: 'k', accessKeyId: AK, accessKeySecret: SECRET, date: DATE })
    expect(headers['Content-Type']).toBe('application/octet-stream')
  })
})

describe('podcast-hosting-upload · 引擎 uv 形状（STS 形态复用 OssUploader）', () => {
  it('endpoint / upload_token / upload_file 三键逐字对齐 token-acquirer 的 vendor 组装', () => {
    expect(buildEngineUploadToken({
      endpoint: 'https://oss-cn-hz.aliyuncs.com/',
      bucket: 'mybucket',
      accessKeyId: AK,
      accessKeySecret: SECRET,
      securityToken: 'STS',
      objectKey: 'podcast/ch1/e1.mp3'
    })).toEqual({
      endpoint: 'mybucket.oss-cn-hz.aliyuncs.com',
      upload_token: { access_id: AK, access_key: SECRET, access_token: 'STS' },
      upload_file: { object_key: 'podcast/ch1/e1.mp3' }
    })
  })

  it('endpoint 已含 bucket 前缀时不重复拼', () => {
    const uv = buildEngineUploadToken({ endpoint: 'mybucket.oss-cn-hz.aliyuncs.com', bucket: 'mybucket', objectKey: 'k' })
    expect(uv.endpoint).toBe('mybucket.oss-cn-hz.aliyuncs.com')
  })
})

describe('podcast-hosting-upload · 音频 MIME 复用共享实现（不得第二份扩展名表）', () => {
  it('按扩展名派生，未知一律 audio/mpeg 而非 octet-stream', () => {
    expect(audioContentTypeFromPath(path.join('tmp', 'a', 'ep.mp3'))).toBe('audio/mpeg')
    expect(audioContentTypeFromPath('C:\\media\\ep.m4a')).toBe('audio/x-m4a')
    expect(audioContentTypeFromPath('/x/ep.wav')).toBe('audio/wav')
    expect(audioContentTypeFromPath('/x/ep.unknownext')).toBe('audio/mpeg')
    expect(audioContentTypeFromPath('')).toBe('audio/mpeg')
  })

  it('源码只引用 shared-utils 的 audioMimeFromUrl，不自带扩展名表', () => {
    const src = require('fs').readFileSync(path.join(__dirname, 'podcast-hosting-upload.js'), 'utf8')
    expect(src).toContain("require('@multi-publish/shared-utils/src/podcast-rss')")
    expect(src).not.toMatch(/endsWith\('\.m4a'\)/)
  })

  it('真实传输层不在模块顶层 require（否则测试加载时就把 axios 装进来了）', () => {
    const src = require('fs').readFileSync(path.join(__dirname, 'podcast-hosting-upload.js'), 'utf8')
    const topLevel = src.split('\n').filter((l) => /^const .*= require\(/.test(l)).join('\n')
    expect(topLevel).not.toContain("require('axios')")
  })
})

describe('podcast-hosting-upload · putObject（注入 fs/httpClient，禁止真实出站）', () => {
  function fakeFs (size = 1234) {
    const streams = []
    return {
      streams,
      statSync: () => ({ size }),
      createReadStream: () => {
        const s = new Readable({ read () { this.push(null) } })
        streams.push(s)
        return s
      }
    }
  }

  it('URL 未解析时立刻失败，不建立任何连接', () => {
    const calls = []
    return expect(putObject({
      filePath: 'a.mp3',
      httpClient: { put: async () => { calls.push(1); return { status: 200 } } },
      fsImpl: fakeFs()
    })).rejects.toThrow('PODCAST_HOSTING_URL_UNRESOLVED').then(() => expect(calls).toEqual([]))
  })

  it('2xx 返回状态与字节数，并带上 Content-Length', () => {
    const seen = {}
    const fs = fakeFs(4321)
    return putObject({
      filePath: 'a.mp3',
      url: 'https://b.e.com/podcast/ch1/a.mp3',
      headers: { Authorization: 'OSS x:y' },
      fsImpl: fs,
      httpClient: { put: async (url, stream, opts) => { seen.url = url; seen.headers = opts.headers; seen.timeout = opts.timeout; return { status: 200 } } }
    }).then((r) => {
      expect(r).toEqual({ status: 200, size: 4321 })
      expect(seen.headers['Content-Length']).toBe('4321')
      expect(seen.headers.Authorization).toBe('OSS x:y')
      expect(Number.isFinite(seen.timeout)).toBe(true)
    })
  })

  it('非 2xx 抛结构化错误：消息只含状态码，不回显凭证或 URL', () => {
    const fs = fakeFs(10)
    return putObject({
      filePath: 'a.mp3',
      url: `https://b.e.com/k.mp3?Signature=${SECRET}`,
      headers: { Authorization: `OSS ${AK}:${SECRET}` },
      fsImpl: fs,
      httpClient: { put: async () => ({ status: 403 }) }
    }).then(() => {
      throw new Error('应当抛错')
    }, (err) => {
      expect(err.code).toBe('PODCAST_HOSTING_UPLOAD_FAILED')
      expect(err.message).toBe('PODCAST_HOSTING_UPLOAD_FAILED(403)')
      expect(err.status).toBe(403)
      expect(err.message).not.toContain(SECRET)
      expect(err.message).not.toContain('b.e.com')
    })
  })

  it('无状态码的响应也算失败（status=null 而非误判成功）', () => {
    return putObject({
      filePath: 'a.mp3',
      url: 'https://b.e.com/k',
      headers: {},
      fsImpl: fakeFs(1),
      httpClient: { put: async () => ({}) }
    }).then(() => {
      throw new Error('应当抛错')
    }, (err) => {
      expect(err.message).toBe('PODCAST_HOSTING_UPLOAD_FAILED(no-status)')
      expect(err.status).toBeNull()
    })
  })

  it('失败路径也必须销毁读流（不得泄漏句柄，Windows 上会锁文件）', async () => {
    const fs = fakeFs(5)
    await expect(putObject({
      filePath: 'a.mp3',
      url: 'https://b.e.com/k',
      headers: {},
      fsImpl: fs,
      httpClient: { put: async () => { throw new Error('ECONNRESET') } }
    })).rejects.toThrow('ECONNRESET')
    expect(fs.streams).toHaveLength(1)
    expect(fs.streams[0].destroyed).toBe(true)
  })

  it('读流必须带 error 监听：迟到的 open 失败不得逃成 uncaughtException', async () => {
    // 现场：createReadStream 把 open 排进下一个 tick，destroy() 取消不掉它。
    // 生产里表现为「请求已返回、文件随后被删/被移动」——那次 open 会以 'error'
    // 事件落到无人监听的流上，直接崩掉 Electron 主进程。
    const fs = fakeFs(8)
    await putObject({
      filePath: 'a.mp3',
      url: 'https://b.e.com/k',
      headers: {},
      fsImpl: fs,
      httpClient: { put: async () => ({ status: 200 }) }
    })
    const stream = fs.streams[0]
    expect(stream.listenerCount('error')).toBeGreaterThan(0)
    expect(() => stream.emit('error', new Error('ENOENT: open'))).not.toThrow()
  })

  it('请求期内读体失败 ⇒ 即便对端回 2xx 也不得报成功', async () => {
    const fsImpl = {
      statSync: () => ({ size: 99 }),
      createReadStream: () => {
        const s = new Readable({ read () {} })
        setImmediate(() => s.destroy(new Error('EACCES')))
        return s
      }
    }
    await expect(putObject({
      filePath: 'a.mp3',
      url: `https://b.e.com/k.mp3?Signature=${SECRET}`,
      headers: { Authorization: `OSS ${AK}:${SECRET}` },
      fsImpl,
      httpClient: { put: async () => { await new Promise((r) => setTimeout(r, 20)); return { status: 200 } } }
    })).rejects.toMatchObject({
      code: 'PODCAST_HOSTING_BODY_READ_FAILED',
      message: 'PODCAST_HOSTING_BODY_READ_FAILED',
    })
  })

  it('validateStatus 恒真：错误判定只由本模块做，不靠 axios 抛栈', () => {
    let opts = null
    const fs = fakeFs(2)
    return putObject({
      filePath: 'a.mp3',
      url: 'https://b.e.com/k',
      headers: {},
      fsImpl: fs,
      httpClient: { put: async (u, s, o) => { opts = o; return { status: 500 } } }
    }).catch(() => {
      expect(opts.validateStatus()).toBe(true)
      expect(opts.maxBodyLength).toBe(Infinity)
    })
  })
})
