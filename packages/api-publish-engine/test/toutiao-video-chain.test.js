/**
 * toutiao-video-chain.test.js — 头条视频 API 轨契约（toutiao-video-api，2026-10-18）
 *
 * ## 证据来源（不是猜测）
 *
 * 本文件的每一处 method / URL / 查询参数 / 头，都对照 2026-10-18 的**实网抓包**：
 * 用可读的 `rpa-toutiao-<accountId>` 分区 cookie 起 Playwright，
 * `input[type=file].setInputFiles(video)` 真实上传，`page.route` 记录逐字请求，
 * 并对 `PublishVideo|create_v2|/publish$|article/publish` **硬 abort**（保证不发稿）。
 * 抓包产物与协议说明见内置记忆 `toutiao-video-api-protocol.md`。
 *
 * ## 与抖音链的关系（复用而非重写）
 *
 * 抖音 `douyin-video.js` 的 vod 上传段本来就动态读 `UploadHost` / `StoreUri`，
 * 头条的 `tos-lf-x.snssdk.com/upload/v1/<StoreUri>` 与之同形 ⇒ 抽成
 * `publish/core/bytedance-vod.js` 单一实现，两条链共用。
 * 头条**独有**的只有三处：getAuthKey 端点与响应形状、apply 的 SpaceName/app_id/EnOID、
 * 发稿端点 PublishVideo。
 *
 * creator / vod / 上传 三类 base 全部注入本机假 HTTP 服务器（127.0.0.1），零外发。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { startFakeServer, methodPathList } = require('./helpers/fake-http')
const { createHttpClient } = require('../src/publish/core/http-base')
const { ToutiaoVideoChain, ToutiaoVideoError, TT_APP_ID, TT_SPACE_NAME_FALLBACK } = require('../src/publish/platforms/toutiao-video')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/** 造一个"已登录头条号"的 cookie 串（只需 sessionid/uid 类，签名在服务端） */
function makeCookie (o = {}) {
  const parts = []
  if (!o.omitSession) parts.push('sessionid=' + (o.sessionId || 'SESSIONID_ABC'))
  if (!o.omitUid) parts.push('uid_tt=' + (o.uid || '1342958645023752'))
  parts.push('tt_webid=7000000000000000000')
  return parts.join('; ')
}

function tmpVideo (bytes = 4096) {
  const p = path.join(os.tmpdir(), 'tt-video-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mp4')
  fs.writeFileSync(p, Buffer.alloc(bytes, 7))
  return p
}

/** getAuthKey 的真实响应形状（取自实网抓包，字段名逐字一致） */
function authKeyResp (o = {}) {
  return {
    data: {
      spaceName: o.spaceName || TT_SPACE_NAME_FALLBACK,
      accessKey: '10fbf8e9c44d4a329162bc374eb4d820',
      uploadToken: {
        CurrentTime: '2026-10-18T14:26:05.926Z',
        ExpiredTime: '2026-10-18T17:26:05.926Z',
        SessionToken: o.sessionToken || 'STS2FAKE_SESSION_TOKEN',
        AccessKeyId: 'AKTPFAKE',
        SecretAccessKey: 'SECRETFAKE',
      },
    },
    status: 0,
    message: 'success',
  }
}

/** ApplyUploadInner 的真实响应形状（UploadHost 由 startSrv 就地注入真实 host） */
function applyResp (host, o = {}) {
  return {
    ResponseMetadata: { RequestId: 'req-apply', Action: 'ApplyUploadInner', Version: '2020-11-19', Service: 'vod', Region: 'cn-north-1' },
    Result: {
      InnerUploadAddress: {
        UploadNodes: [{
          Vid: o.vid || 'v02d16g10004dbaddvnog65g7omjevjg',
          Vids: [o.vid || 'v02d16g10004dbaddvnog65g7omjevjg'],
          StoreInfos: [{ StoreUri: 'tos-cn-v-e874c6/oE7FBpeGEEA3zuVif1VnbqfaUCvmGI3MLQB9EA', Auth: 'SpaceKey/middlevideo_toutiao/0/:version:v2:FAKEJWT' }],
          UploadHost: host,
          UploadHeader: {},
          SessionKey: 'SESSIONKEY_FAKE',
        }],
      },
    },
  }
}

function commitResp (vid) {
  return {
    ResponseMetadata: { RequestId: 'req-commit', Action: 'CommitUploadInner', Version: '2020-11-19', Service: 'vod', Region: 'cn-north-1' },
    Result: { Results: [{ Vid: vid, VideoMeta: { Uri: 'tos-cn-v-e874c6/x', Height: 1080, Width: 1920, Duration: 5.12 } }] },
  }
}

describe('ToutiaoVideoChain — 头条视频 API 轨', () => {
  let srv
  let chain
  let vodSrv

  async function bootChain (opts = {}) {
    srv = await startFakeServer([
      { method: 'GET', match: /^\/xigua\/api\/upload\/getAuthKey\//, body: authKeyResp(opts.auth || {}) },
      { method: 'POST', match: /^\/xigua\/api\/upload\/PublishVideo/, body: opts.publishBody || { status: 0, data: { item_id: 'ITEM_123' }, message: 'success' } },
    ])
    vodSrv = await startFakeServer([])
    const uid = opts.uid || '1342958645023752'
    // apply/commit 路由按需注册（要在拿到 host 后）
    vodSrv.routes = []
    chain = new ToutiaoVideoChain({
      cookie: opts.cookie || makeCookie(),
      mpBase: srv.url,
      vodBase: vodSrv.url,
      userAgent: UA,
      uid,
      httpClientFactory: (cfg) => createHttpClient(cfg),
    })
    return chain
  }

  afterEach(async () => {
    if (srv) await srv.close()
    if (vodSrv) await vodSrv.close()
    srv = null; vodSrv = null
  })

  it('Step1 getAuthKey：GET /xigua/api/upload/getAuthKey/?params=<编码 JSON>，params 四字段逐字', async () => {
    await bootChain()
    const creds = await chain.getAuthKey()

    const req = srv.requests.find((r) => /getAuthKey/.test(r.url))
    expect(req, 'getAuthKey 必须被请求').toBeTruthy()
    expect(req.method).toBe('GET')

    const q = req.url.split('?')[1] || ''
    const params = JSON.parse(decodeURIComponent((q.match(/params=([^&]*)/) || [])[1] || '%7B%7D'))
    // 实网抓包逐字：{"type":"video","column":false,"ugc":false,"useImageX":true,"useStsToken":true}
    expect(params).toEqual({ type: 'video', column: false, ugc: false, useImageX: true, useStsToken: true })

    expect(creds).toMatchObject({
      spaceName: TT_SPACE_NAME_FALLBACK,
      sessionToken: 'STS2FAKE_SESSION_TOKEN',
    })
  })

  it('Step2 apply：SpaceName 取自 getAuthKey 响应、app_id=1231、EnOID=1（三处头条独有差异）', async () => {
    await bootChain({ auth: { spaceName: 'middlevideo_toutiao' } })
    const creds = await chain.getAuthKey()
    // 注册 apply 路由
    vodSrv.requests.length = 0
    const host = vodSrv.url.replace(/^http:\/\//, '')
    const srv2 = await startFakeServer([
      { method: 'GET', match: /Action=ApplyUploadInner/, body: applyResp(host) },
    ])
    await srv2.close()

    // 用 chain 内部方法直接构造 apply 查询，断言三处常量
    const q = chain._applyQueryFor({ size: 1251787, spaceName: creds.spaceName, uid: '1342958645023752' })
    expect(q).toContain('Action=ApplyUploadInner')
    expect(q).toContain('Version=2020-11-19')
    expect(q).toContain('SpaceName=middlevideo_toutiao')
    expect(q).toContain('FileType=video')
    expect(q).toContain('IsInner=1')
    expect(q).toContain('FileSize=1251787')
    // 头条独有：EnOID=1 与 app_id=1231（抖音是 app_id=2906、无 EnOID）
    expect(q).toContain('EnOID=1')
    expect(q).toContain('app_id=' + TT_APP_ID)
    expect(TT_APP_ID).toBe(1231)
    expect(q).toContain('user_id=1342958645023752')
    expect(q).toMatch(/[?&]s=[0-9a-f]{16}/)
  })

  it('Step3/4 二进制上传与 CommitUploadInner 复用抖音同款 tos 形态（<UploadHost>/upload/v1/<StoreUri>）', async () => {
    await bootChain()
    const creds = await chain.getAuthKey()
    vodSrv.requests.length = 0

    // apply 响应里的 UploadHost 必须指向**承载路由的那台**服务器（启动后才知道端口）
    const uploadSrv = await startFakeServer([
      { method: 'GET', match: /Action=ApplyUploadInner/, body: null }, // 占位，下面回填
      { method: 'GET', match: /\/upload\/v1\//, body: 'ok', raw: true },
      { method: 'POST', match: /\/upload\/v1\//, body: 'ok', raw: true },
      { method: 'POST', match: /Action=CommitUploadInner/, body: commitResp('v02d16g10004dbaddvnog65g7omjevjg') },
    ])
    const host = uploadSrv.url.replace(/^http:\/\//, '')
    uploadSrv.replaceRouteBody(/Action=ApplyUploadInner/, applyResp(host))

    chain.vodBase = uploadSrv.url
    // 假服务器是 http；线上 UploadHost 走 https。uploadScheme 是既有注入点（抖音链同款）
    chain.uploadScheme = 'http:'
    chain.vod = createHttpClient({ baseURL: uploadSrv.url, timeout: 20000, headers: { 'User-Agent': UA } })
    chain.upload = createHttpClient({ baseURL: uploadSrv.url, timeout: 20000, headers: { 'User-Agent': UA } })

    const f = tmpVideo(4096)
    try {
      const vid = await chain.uploadVideo(f, creds, '1342958645023752')
      expect(vid).toBe('v02d16g10004dbaddvnog65g7omjevjg')

      // 注意：不能用 methodPathList —— 它按 '?' 截断，apply/commit 的 action 在 query 里会被剥掉。
      const reqs = uploadSrv.requests
      const raws = reqs.map((r) => r.method + ' ' + r.url)
      expect(raws.some((u) => /^GET \/\?Action=ApplyUploadInner/.test(u))).toBe(true)
      expect(raws.some((u) => /^POST \/upload\/v1\//.test(u))).toBe(true)
      expect(raws.some((u) => /^POST \/\?Action=CommitUploadInner/.test(u))).toBe(true)

      const bin = reqs.find((r) => /\/upload\/v1\//.test(r.url) && r.method === 'POST')
      // tos 上传必带头：Authorization(来自 StoreInfos[0].Auth) / Content-CRC32 / X-Storage-U
      expect(String(bin.headers.authorization)).toContain('SpaceKey/')
      expect(bin.headers['content-crc32']).toMatch(/^[0-9a-f]{8}$/)
      expect(String(bin.headers['x-storage-u'])).toBe('1342958645023752')
      expect(bin.byteLength).toBe(4096)
    } finally { fs.unlinkSync(f) }
  })

  it('Step5 publish：POST /xigua/api/upload/PublishVideo，成功以 status=0 + data.item_id 判定', async () => {
    await bootChain()
    const r = await chain.publish({ title: 'T', abstract: 'A', vid: 'v123' })
    expect(r).toMatchObject({ success: true, platform: 'toutiao', publishId: 'ITEM_123' })

    const req = srv.requests.find((x) => /PublishVideo/.test(x.url))
    expect(req.method).toBe('POST')
    expect(req.body).toMatchObject({ title: 'T', abstract: 'A' })
  })

  it('publish 失败：status!=0 时透出平台 message，不谎报成功', async () => {
    await bootChain({ publishBody: { status: 1001, data: {}, message: '内容含违规信息' } })
    const r = await chain.publish({ title: 'T', vid: 'v123' })
    expect(r.success).toBe(false)
    expect(r.platform).toBe('toutiao')
    expect(String(r.error)).toContain('违规')
  })

  it('fail-closed：缺 sessionid ⇒ 抛错且零请求（不发任何外网调用）', async () => {
    await bootChain({ cookie: 'uid_tt=1342958645023752; tt_webid=1' })
    await expect(chain.getAuthKey()).rejects.toBeInstanceOf(ToutiaoVideoError)
    expect(srv.requests.length).toBe(0)
  })

  it('fail-closed：视频文件不存在 ⇒ 抛错且零请求', async () => {
    await bootChain()
    await expect(chain.run({ video: { path: 'D:/nope/not-here.mp4' }, title: 't' }))
      .rejects.toBeInstanceOf(ToutiaoVideoError)
    expect(srv.requests.length).toBe(0)
  })

  it('uid 优先取 cookie 的 uid_tt，缺失时用注入值兜底', async () => {
    await bootChain({ cookie: 'sessionid=S; uid_tt=999888777' })
    expect(chain.resolveUid()).toBe('999888777')

    const c2 = new ToutiaoVideoChain({ cookie: 'sessionid=S', mpBase: 'http://127.0.0.1:1', vodBase: 'http://127.0.0.1:1', uid: '555' })
    expect(c2.resolveUid()).toBe('555')
  })

  // —— 自扮演裁决补测（deep-review 后端超时后由 agent 对抗自查发现的两处）——

  it('标题按**码点**截断：emoji 不被切成孤立代理对（头条上限 30 字）', async () => {
    await bootChain()
    // 前 29 个 emoji + 若干汉字，总长超过 30 码点
    const emoji = '😀'
    const title = emoji.repeat(31) + '尾巴'
    const body = chain.buildPublishBody({ title, content: 'x' }, { vid: 'v1' })
    expect(Array.from(body.title).length).toBe(30)
    // 关键：不得出现孤立代理（String#slice 会造出来）
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(body.title)).toBe(false)
    expect(/^[\uDC00-\uDFFF]/.test(body.title)).toBe(false)
    expect(body.title).toBe(emoji.repeat(30))
  })

  it('标题不超限时原样保留（快路径不改变内容）', async () => {
    await bootChain()
    const body = chain.buildPublishBody({ title: '正常标题😀', content: 'x' }, { vid: 'v1' })
    expect(body.title).toBe('正常标题😀')
  })

  it('串起来：run() 走完 getAuthKey → apply → 上传 → commit → PublishVideo，顺序不乱', async () => {
    // 同一个假服务器同时充当 mp 与 vod（base 相同），按 URL 精确路由
    const all = await startFakeServer([
      { method: 'GET', match: /^\/xigua\/api\/upload\/getAuthKey\//, body: authKeyResp({}) },
      { method: 'GET', match: /Action=ApplyUploadInner/, body: null }, // 先占位，稍后用真实 host
      { method: 'POST', match: /\/upload\/v1\//, body: 'ok', raw: true },
      { method: 'POST', match: /Action=CommitUploadInner/, body: commitResp('VID_RUN') },
      { method: 'POST', match: /^\/xigua\/api\/upload\/PublishVideo/, body: { status: 0, data: { item_id: 'ITEM_RUN' } } },
    ])
    const host = all.url.replace(/^http:\/\//, '')
    // 把 apply 路由的响应体替换成携带真实 host 的版本
    all.replaceRouteBody(/Action=ApplyUploadInner/, applyResp(host))

    const c = new ToutiaoVideoChain({
      cookie: makeCookie(), mpBase: all.url, vodBase: all.url,
      userAgent: UA, uid: '1342958645023752', uploadScheme: 'http:',
    })

    const f = tmpVideo(2048)
    try {
      const r = await c.run({ title: 'T标题', content: '正文内容', video: { path: f } })
      expect(r).toMatchObject({ success: true, platform: 'toutiao', publishId: 'ITEM_RUN' })

      // 同样不能用 methodPathList（会剥掉 query）
      const raws = all.requests.map((x) => x.method + ' ' + x.url)
      const iAuth = raws.findIndex((p) => /getAuthKey/.test(p))
      const iApply = raws.findIndex((p) => /Action=ApplyUploadInner/.test(p))
      const iUpload = raws.findIndex((p) => /^POST \/upload\/v1\//.test(p))
      const iCommit = raws.findIndex((p) => /Action=CommitUploadInner/.test(p))
      const iPublish = raws.findIndex((p) => /PublishVideo/.test(p))
      // 顺序不变量：auth < apply < 二进制上传 < commit < publish，且每一步都真实发生
      for (const [name, i] of [['auth', iAuth], ['apply', iApply], ['upload', iUpload], ['commit', iCommit], ['publish', iPublish]]) {
        expect(i, name + ' 必须发生').toBeGreaterThan(-1)
      }
      expect(iAuth).toBeLessThan(iApply)
      expect(iApply).toBeLessThan(iUpload)
      expect(iUpload).toBeLessThan(iCommit)
      expect(iCommit).toBeLessThan(iPublish)

      // PublishVideo 的 body 必须带 apply 阶段拿到的 vid
      const pub = all.requests.find((x) => /PublishVideo/.test(x.url))
      expect(pub.body).toMatchObject({ vid: 'VID_RUN' })
      expect(pub.body.title).toBe('T标题')
    } finally { fs.unlinkSync(f); await all.close() }
  })
})
