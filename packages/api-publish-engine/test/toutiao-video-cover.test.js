/**
 * toutiao-video-cover.test.js — 封面五步链契约（零外发，全部打本机假服务器）
 *
 * ## 证据来源
 * 每一步的 method / URL / 头 / body 都对照 2026-10-19 真机实捕
 * （记录 PR #4008 `openspec/records/toutiao-imagex-cover-chain.md` §二 与
 * 内置记忆 `toutiao-cover-chain-solved.md`），不是照文档猜的。
 *
 * ## 重点锁
 * 1. 头缺 `X-TT-Access` ⇒ 服务端 `10413`（真机踩过）——纯函数/编排都要锁；
 * 2. PUT 的 Authorization 必须是 **完整 tos_sign**（截断 401，真机踩过）；
 * 3. **不调 GetImageUploadInfos ⇒ 不算上传成功**（21084 的教训）；
 * 4. 登记 result_uri 与请求 uri 不一致 ⇒ fail closed（防串号）。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startFakeServer } = require('./helpers/fake-http')
const {
  VAS_BASE, AUTH_KEY_TYPE,
  pickImageTempCreds, pickUploadTarget, pickRegisteredImage,
} = require('../src/publish/platforms/toutiao-video-cover')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140'

function makeImage (bytes = 4096) {
  const p = path.join(os.tmpdir(), 'tt-cover-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jpg')
  fs.writeFileSync(p, Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(bytes, 0x7F), Buffer.from([0xFF, 0xD9])]))
  return p
}

function makeClients (srv) {
  const { createHttpClient } = require('../src/publish/core/http-base')
  return {
    mpClient: createHttpClient({ baseURL: srv.url, timeout: 5000 }),
    vasClient: createHttpClient({ baseURL: srv.url, timeout: 5000 }),
    axiosLike: createHttpClient({ timeout: 5000 }),
    tosBaseUrl: srv.url, // PUT 也打到本机假服务器（零外发）
  }
}

const OK_AUTHKEY = { data: { accessKey: 'AK_TEST', uploadToken: 'HMAC-SHA1:1.0:1792401548:AK_TEST:QQ==' } }
const OK_PARAMS = {
  code: 2000, message: 'ok',
  data: {
    tos_host: 'tos.test.local', tos_sign: 'SpaceKey/x:version:v2:JWT.JWT.JWT',
    bucket: 'tos-cn-i-e874c6', object_ids: ['tos-cn-i-e874c6/oTEST'], access_key: '',
  },
}
const OK_INFOS = (uri) => ({
  code: 2000, message: 'ok',
  data: [{ uri, result_uri: uri, info: { width: 1280, height: 720, size: 4096, format: 'jpeg', md5: 'a'.repeat(32) }, custom: '' }],
})

describe('toutiao-video-cover：纯函数判据', () => {
  it('pickImageTempCreds：形状不对返回 null（不伪造凭证）', () => {
    expect(pickImageTempCreds({ accessKey: 'A', uploadToken: 'T' })).toEqual({ accessKey: 'A', uploadToken: 'T' })
    for (const bad of [null, undefined, {}, { accessKey: 'A' }, { uploadToken: 'T' }, { accessKey: '', uploadToken: 'T' }, { accessKey: 1, uploadToken: 'T' }]) {
      expect(pickImageTempCreds(bad)).toBeNull()
    }
  })

  it('pickUploadTarget：缺 object_ids/tos_host/tos_sign 任一都返回 null', () => {
    expect(pickUploadTarget({ object_ids: ['u'], tos_host: 'h', tos_sign: 's' })).toEqual({ objectId: 'u', tosHost: 'h', tosSign: 's', bucket: '' })
    for (const bad of [null, {}, { tos_host: 'h', tos_sign: 's' }, { object_ids: [], tos_host: 'h', tos_sign: 's' }, { object_ids: ['u'], tos_sign: 's' }, { object_ids: ['u'], tos_host: 'h' }]) {
      expect(pickUploadTarget(bad)).toBeNull()
    }
  })

  it('pickRegisteredImage：无 info.md5 = 未登记；result_uri 与请求不一致 = 拒收（防串号）', () => {
    const ok = OK_INFOS('tos-cn-i-e874c6/oA')
    expect(pickRegisteredImage(ok, 'tos-cn-i-e874c6/oA')).toEqual({ uri: 'tos-cn-i-e874c6/oA', info: ok.data[0].info })
    // 未登记（无 md5）
    const noMeta = { data: [{ uri: 'u', result_uri: 'u', info: {} }] }
    expect(pickRegisteredImage(noMeta, 'u')).toBeNull()
    // 串号
    expect(pickRegisteredImage(ok, 'tos-cn-i-e874c6/oB')).toBeNull()
    // 空响应
    expect(pickRegisteredImage(null, 'u')).toBeNull()
    expect(pickRegisteredImage({ data: [] }, 'u')).toBeNull()
  })
})

describe('toutiao-video-cover：五步编排（假服务器逐断言）', () => {
  it('五步全通：authKey/params 头齐全、PUT 带完整 JWT、登记 body=[{uri}]、返回登记 uri', async () => {
    const srv = await startFakeServer([
      { match: /getAuthKey/, body: OK_AUTHKEY },
      { match: /GetImageUploadParams/, body: OK_PARAMS },
      { match: /tos-cn-i-e874c6\/oTEST/, method: 'PUT', body: { success: 0, error: { code: 200 } } },
      { match: /GetImageUploadInfos/, body: OK_INFOS('tos-cn-i-e874c6/oTEST') },
    ])
    const img = makeImage()
    const { uploadCoverImage } = require('../src/publish/platforms/toutiao-video-cover')
    const c = makeClients(srv)
    try {
      const out = await uploadCoverImage(Object.assign({ imagePath: img, headers: { 'User-Agent': UA, Cookie: 'x=1' }, userAgent: UA }, c))
      expect(out.uri).toBe('tos-cn-i-e874c6/oTEST')
      expect(out.info.md5).toBe('a'.repeat(32))

      const akReq = srv.requests.find((r) => /getAuthKey/.test(r.url))
      expect(decodeURIComponent(akReq.url)).toContain('"type":"image_temp"')
      expect(decodeURIComponent(akReq.url)).toContain('"useStsToken":false')
      const gpReq = srv.requests.find((r) => /GetImageUploadParams/.test(r.url))
      expect(gpReq.headers.authorization).toBe(OK_AUTHKEY.data.uploadToken)
      expect(gpReq.headers['x-tt-access']).toBe('AK_TEST')
      const putReq = srv.requests.find((r) => r.method === 'PUT')
      expect(putReq.headers.authorization).toBe(OK_PARAMS.data.tos_sign) // 完整 JWT
      expect(putReq.headers['content-type']).toBe('image/jpeg')
      expect(putReq.byteLength).toBeGreaterThan(8)
      const giReq = srv.requests.find((r) => /GetImageUploadInfos/.test(r.url))
      expect(giReq.method).toBe('POST')
      expect(giReq.body).toEqual([{ uri: 'tos-cn-i-e874c6/oTEST' }])
      expect(giReq.headers['x-tt-access']).toBe('AK_TEST')
    } finally { fs.unlinkSync(img); await srv.close() }
  })

  it('① credentials 形状不对 → fail closed（不发起后续任何请求）', async () => {
    const srv = await startFakeServer([{ match: /getAuthKey/, body: { data: { accessKey: 'A' } } }])
    const img = makeImage()
    const { uploadCoverImage } = require('../src/publish/platforms/toutiao-video-cover')
    try {
      await expect(uploadCoverImage(Object.assign({ imagePath: img, headers: {} }, makeClients(srv))))
        .rejects.toThrow(/getAuthKey\(image_temp\)/)
      expect(srv.requests.filter((r) => /GetImageUploadParams/.test(r.url)).length).toBe(0)
    } finally { fs.unlinkSync(img); await srv.close() }
  })

  it('② params code!=2000（如 10413 缺 X-TT-Access 的服务端回显）→ fail closed', async () => {
    const srv = await startFakeServer([
      { match: /getAuthKey/, body: OK_AUTHKEY },
      { match: /GetImageUploadParams/, body: { code: 10413, message: 'X-TT-Access does not match access_key in Authorization' } },
    ])
    const img = makeImage()
    const { uploadCoverImage } = require('../src/publish/platforms/toutiao-video-cover')
    try {
      await expect(uploadCoverImage(Object.assign({ imagePath: img, headers: {} }, makeClients(srv))))
        .rejects.toThrow(/10413/)
      expect(srv.requests.filter((r) => r.method === 'PUT').length).toBe(0)
    } finally { fs.unlinkSync(img); await srv.close() }
  })

  it('④ 登记未返回 md5（= 服务端没入库）→ 视为失败，**不返回 uri**（21084 教训）', async () => {
    const srv = await startFakeServer([
      { match: /getAuthKey/, body: OK_AUTHKEY },
      { match: /GetImageUploadParams/, body: OK_PARAMS },
      { match: /tos-cn-i-e874c6\/oTEST/, method: 'PUT', body: { success: 0, error: { code: 200 } } },
      { match: /GetImageUploadInfos/, body: { code: 2000, data: [{ uri: 'tos-cn-i-e874c6/oTEST', result_uri: 'tos-cn-i-e874c6/oTEST', info: {} }] } },
    ])
    const img = makeImage()
    const { uploadCoverImage } = require('../src/publish/platforms/toutiao-video-cover')
    try {
      await expect(uploadCoverImage(Object.assign({ imagePath: img, headers: {} }, makeClients(srv))))
        .rejects.toThrow(/GetImageUploadInfos/)
    } finally { fs.unlinkSync(img); await srv.close() }
  })

  it('③ PUT 非 2xx（如 401 截断 JWT 的回显）→ fail closed', async () => {
    const srv = await startFakeServer([
      { match: /getAuthKey/, body: OK_AUTHKEY },
      { match: /GetImageUploadParams/, body: OK_PARAMS },
      { match: /tos-cn-i-e874c6\/oTEST/, method: 'PUT', status: 401, body: { success: -1, error: { code: 401 } } },
    ])
    const img = makeImage()
    const { uploadCoverImage } = require('../src/publish/platforms/toutiao-video-cover')
    try {
      await expect(uploadCoverImage(Object.assign({ imagePath: img, headers: {} }, makeClients(srv))))
        .rejects.toThrow(/PUT 图未落盘/)
      expect(srv.requests.filter((r) => /GetImageUploadInfos/.test(r.url)).length).toBe(0)
    } finally { fs.unlinkSync(img); await srv.close() }
  })
})
