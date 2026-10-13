// douyin-image-chain.test.js — 抖音图文 API 直连链契约（D 方案，publish-throughput-optimization）
//
// 设计边界（design.md 决策 D4 取证纪律）：
// - 图文 create v2 的请求体字段**无真机取证切片**（W2 切片只覆盖视频链），字段按 douyin-video
//   同构 + 命名推断书写，代码注释标 UNVERIFIED；本测试**只锁结构同构 + dry-run + fail-closed 边界**，
//   不把未取证字段值钉成契约（如 media_type 的具体数值断言）。
// - 上传单元复用视频链的 imagex 语义（apply → 单 POST → commit → Uri），经本机假 HTTP 服务器验证请求形状。
// - 全用例零外发（本仓网络出站守卫生效；假服务器 127.0.0.1:0 临时端口）。
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { startFakeServer } = require('./helpers/fake-http')
const { DouyinImageChain } = require('../src/publish/platforms/douyin-image')
const { errorCode } = require('../src/error-codes')

// —— 构造含合法 EC 私钥与四类签名材料的 security-sdk cookie（clientSign 可签出）——
// 与 douyin-video-chain.test.js 的 makeCookie 同款（测试夹具不跨文件 import，复制并锚定来源）
// keyStyle: 'legacy'（历史假设，默认）| 'live'（2026-07 真实账号实测形态）
function encField (inner) { return encodeURIComponent(JSON.stringify({ data: JSON.stringify(inner) })) }
function encB64 (jsonStr) { return encodeURIComponent(Buffer.from(jsonStr, 'utf-8').toString('base64')) }
function securityKeyNames (keyStyle, gen) {
  if (keyStyle === 'live') {
    return { crypt: `__security_mc_${gen || 1}_s_sdk_crypt_sdk`, sign: `__security_mc_${gen || 1}_s_sdk_sign_data_key_web_protect` }
  }
  return { crypt: 'security-sdk/s_sdk_crypt_sdk', sign: 'security-sdk/s_sdk_sign_data_key/web_protect' }
}
function makeCookie (o = {}) {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const kn = securityKeyNames(o.keyStyle, o.gen)
  const parts = []
  if (!o.omitCrypt) parts.push(kn.crypt + '=' + encField({ ec_privateKey: pem }))
  if (!o.omitSign) parts.push(kn.sign + '=' + encField({ ticket: o.ticket || 't_' + Date.now(), ts_sign: o.tsSign || 'TSSIGN' }))
  if (!o.omitRee) parts.push('bd_ticket_guard_client_data=' + encB64(JSON.stringify({ 'bd-ticket-guard-ree-public-key': o.ree || 'REE_PUB_KEY' })))
  if (!o.omitSid) parts.push('sid_tt=SESSID123')
  if (o.msToken) parts.push('msToken=' + o.msToken)
  parts.push('sessionid=abc')
  return parts.join('; ')
}

// apply 响应里的 UploadHost 由 startSrv 启动后就地注入真实 host（假服务器按引用读 route.body）
function baseRoutes () {
  return [
    { method: 'HEAD', match: /\/web\/api\/media\/aweme\/create\/$/, status: 200, raw: true, body: '', headers: { 'x-ware-csrf-token': 'PREPART,THETOKEN' } },
    { method: 'GET', match: /upload\/auth\/v5/, body: { auth: JSON.stringify({ AccessKeyID: 'AKID', SecretAccessKey: 'ASecret', SessionToken: 'ASToken' }), status_code: 0 } },
    { method: 'GET', match: /Action=ApplyImageUpload/, body: { Result: { InnerUploadAddress: { UploadNodes: [{ SessionKey: 'ISK', UploadHost: 'HOST', StoreInfos: [{ Auth: 'IAUTH', StoreUri: 'istore.png' }] }] } } } },
    { method: 'POST', match: /Action=CommitImageUpload/, body: { Result: { Results: [{ Uri: 'image-cn/istore.uri' }] } } },
    { method: 'POST', match: /\/upload\/v1\/istore\.png/, body: { crc32: 'imgcrc' } },
    { method: 'POST', match: /create_v2/, body: { status_code: 0, aweme_id: 'IMG999' } },
  ]
}

async function startSrv (mutate) {
  const routes = baseRoutes()
  if (mutate) mutate(routes)
  const srv = await startFakeServer(routes)
  const host = srv.url.replace(/^https?:\/\//, '')
  for (const r of routes) {
    const nodes = r.body && r.body.Result && r.body.Result.InnerUploadAddress && r.body.Result.InnerUploadAddress.UploadNodes
    if (nodes) nodes.forEach((n) => { n.UploadHost = host })
  }
  return srv
}

function newChain (srv, cookie, extra) {
  return new DouyinImageChain(Object.assign({
    cookie, userAgent: 'UA/TEST',
    imagexBase: srv.url, creatorBase: srv.url, uploadScheme: 'http:',
  }, extra || {}))
}

function withTmpImage (fn, count = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-img-'))
  const images = []
  for (let i = 0; i < count; i++) {
    const p = path.join(dir, 'a' + i + '.png')
    fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    images.push({ path: p })
  }
  return Promise.resolve(fn(images)).finally(() => fs.rmSync(dir, { recursive: true, force: true }))
}

describe('publish/platforms/douyin-image — D 方案图文 API 链', () => {
  it('前置校验 fail-closed：无 cookie 抛 data_error 且零请求', async () => {
    const srv = await startSrv()
    try {
      const chain = newChain(srv, '')
      await expect(chain.run({ images: [{ path: 'x.png' }] })).rejects.toMatchObject({ code: errorCode.data_error })
      expect(srv.requests).toHaveLength(0)
    } finally { await srv.close() }
  })

  it('run 缺 images → fail-closed data_error（零请求）', async () => {
    const srv = await startSrv()
    try {
      const chain = newChain(srv, makeCookie())
      await expect(chain.run({})).rejects.toMatchObject({ code: errorCode.data_error })
      await expect(chain.run({ images: [] })).rejects.toMatchObject({ code: errorCode.data_error })
      expect(srv.requests).toHaveLength(0)
    } finally { await srv.close() }
  })

  it('run 图片文件不存在 → fail-closed io_error（零请求）', async () => {
    const srv = await startSrv()
    try {
      const chain = newChain(srv, makeCookie())
      await expect(chain.run({ images: [{ path: 'Z:/no/such/file.png' }] })).rejects.toMatchObject({ code: errorCode.io_error })
      expect(srv.requests).toHaveLength(0)
    } finally { await srv.close() }
  })

  it('签名材料缺失（omitCrypt）→ fail-closed data_error（零请求，与视频链同判据）', async () => {
    const srv = await startSrv()
    try {
      const chain = newChain(srv, makeCookie({ omitCrypt: true }))
      await expect(chain.run({ images: [{ path: 'Z:/no/such/file.png' }] })).rejects.toMatchObject({ code: errorCode.data_error })
      expect(srv.requests).toHaveLength(0)
    } finally { await srv.close() }
  })

  // ── 2026-10-13 新增：真实账号 cookie 命名形态（__security_mc_<N>_*）──────
  // 判据技巧：Step 0 通过后才会走到文件检查。
  //   材料齐备 → io_error（证明已过 Step 0）
  //   材料缺失 → data_error（Step 0 拦截，零请求）
  // 事故回归锁：原实现只认 legacy 形态（含 '/'，而 cookie 名不允许 '/'），
  // 真实账号上 Step 0 恒 fail-closed。
  it('真实命名形态（__security_mc_1_*）→ Step 0 通过（表现为 io_error 而非 data_error）', async () => {
    const srv = await startSrv()
    try {
      const chain = newChain(srv, makeCookie({ keyStyle: 'live', gen: 1 }))
      await expect(chain.run({ images: [{ path: 'Z:/no/such/file.png' }] })).rejects.toMatchObject({ code: errorCode.io_error })
    } finally { await srv.close() }
  })

  it('真实命名形态 + 代际号可变（gen=7）→ Step 0 同样通过', async () => {
    const srv = await startSrv()
    try {
      const chain = newChain(srv, makeCookie({ keyStyle: 'live', gen: 7 }))
      await expect(chain.run({ images: [{ path: 'Z:/no/such/file.png' }] })).rejects.toMatchObject({ code: errorCode.io_error })
    } finally { await srv.close() }
  })

  it('真实命名形态下缺 sign_data → fail-closed data_error（零请求）', async () => {
    const srv = await startSrv()
    try {
      const chain = newChain(srv, makeCookie({ keyStyle: 'live', omitSign: true }))
      await expect(chain.run({ images: [{ path: 'Z:/no/such/file.png' }] })).rejects.toMatchObject({ code: errorCode.data_error })
      expect(srv.requests).toHaveLength(0)
    } finally { await srv.close() }
  })

  it('全链成功：N 张图逐个 imagex 上传（apply→POST→commit）→ create 提交', async () => {
    await withTmpImage(async (images) => {
      const srv = await startSrv()
      try {
        const progress = []
        const r = await newChain(srv, makeCookie({ msToken: 'MS1' })).run(
          { title: '图文标题', content: '正文 #测试', tags: ['测试'], images },
          { onProgress: (p, m) => progress.push([p, m]) },
        )
        expect(r.success).toBe(true)
        expect(r.mode).toBe('api')
        expect(r.platform).toBe('douyin')
        expect(r.publishId).toBe('IMG999')
        // 每张图 3 个请求（apply/POST/commit）+ csrf HEAD + auth + create
        const imgCount = images.length
        expect(srv.requestsFor(/ApplyImageUpload/)).toHaveLength(imgCount)
        expect(srv.requestsFor(/CommitImageUpload/)).toHaveLength(imgCount)
        expect(srv.requestsFor(/\/upload\/v1\//)).toHaveLength(imgCount)
        // create 提交体含图文结构（同构视频链 item.common 形状；未取证字段值不锁——见 PRD §D）
        const createCall = srv.requestsFor(/create_v2/)[0]
        expect(createCall).toBeTruthy()
        expect(createCall.body.item.common.item_title).toBe('图文标题')
        expect(createCall.body.item.common.content_desc).toBe('正文 #测试')
        expect(Array.isArray(createCall.body.item.common.image_ids)).toBe(true)
        expect(createCall.body.item.common.image_ids).toHaveLength(imgCount)
        // bd-ticket-guard 头组与视频链同款（本地签名，非远程签名通道）
        expect(createCall.headers['bd-ticket-guard-client-data']).toBeTruthy()
        expect(createCall.headers['x-secsdk-csrf-token']).toBe('THETOKEN')
        // 进度回调覆盖上传段与提交段
        expect(progress.some(([p]) => p === 90)).toBe(true)
      } finally { await srv.close() }
    }, 2)
  })

  it('正文承载形态：HTML 正文（Quill 富文本）→ content_desc 纯文本，不含标签字面量', async () => {
    await withTmpImage(async (images) => {
      const srv = await startSrv()
      try {
        const r = await newChain(srv, makeCookie({ msToken: 'MS1' })).run(
          { title: '图文标题', content: '<p>第一段</p><p>第二段</p>', tags: [], images },
        )
        expect(r.success).toBe(true)
        const createCall = srv.requestsFor(/create_v2/)[0]
        // 抖音描述是纯文本语义：HTML 进描述会以字面量 `<p>` 出现在作品简介里
        expect(createCall.body.item.common.content_desc).toBe('第一段\n第二段')
      } finally { await srv.close() }
    }, 1)
  })

  it('create 返回风控裁决（x-tt-verify-passport-decision）→ risk_blocked 与视频链同口径', async () => {
    await withTmpImage(async (images) => {
      const srv = await startSrv((routes) => {
        const create = routes.find(r => r.match.toString().includes('create_v2'))
        create.headers = { 'x-tt-verify-passport-decision': 'block' }
        create.body = { status_code: 9 }
      })
      try {
        const r = await newChain(srv, makeCookie()).run({ title: 'T', content: 'C', images })
        expect(r.success).toBe(false)
        expect(r.risk_blocked).toBe(true)
      } finally { await srv.close() }
    })
  })

  it('create 返回 status_code 110 → risk_blocked（与视频链同口径）', async () => {
    await withTmpImage(async (images) => {
      const srv = await startSrv((routes) => {
        const create = routes.find(r => r.match.toString().includes('create_v2'))
        create.body = { status_code: 110 }
      })
      try {
        const r = await newChain(srv, makeCookie()).run({ title: 'T', content: 'C', images })
        expect(r.success).toBe(false)
        expect(r.risk_blocked).toBe(true)
        expect(r.error).toContain('110')
      } finally { await srv.close() }
    })
  })

  it('imagex apply 无 UploadNodes → data_error（上传中断，不提交 create）', async () => {
    await withTmpImage(async (images) => {
      const srv = await startSrv((routes) => {
        const apply = routes.find(r => r.match.toString().includes('ApplyImageUpload'))
        apply.body = { Result: { InnerUploadAddress: { UploadNodes: [] } } }
      })
      try {
        const chain = newChain(srv, makeCookie())
        await expect(chain.run({ title: 'T', content: 'C', images })).rejects.toMatchObject({ code: errorCode.data_error })
        expect(srv.requestsFor(/create_v2/)).toHaveLength(0)
      } finally { await srv.close() }
    })
  })
})

describe('douyin adapter — 图文分支接线（D 方案）', () => {
  const DouyinAdapter = require('../src/adapters/douyin')

  it('图文 taskData（images 非空）走图文链，不再 fail-closed on video.path', async () => {
    const a = new DouyinAdapter()
    let imageChainUsed = false
    a._imageChainOverride = {
      run: async () => { imageChainUsed = true; return { success: true, mode: 'api', publishId: 'IMG9' } },
    }
    const r = await a.execute({ title: 'T', content: 'C', images: [{ path: 'a.png' }] }, 'cookie=x', {})
    expect(imageChainUsed).toBe(true)
    expect(r.success).toBe(true)
    expect(r.publishId).toBe('IMG9')
  })

  it('视频 taskData 仍走视频链（不回归）', async () => {
    const a = new DouyinAdapter()
    let videoChainUsed = false
    a._chainOverride = { run: async () => { videoChainUsed = true; return { success: true, publishId: 'VID1' } } }
    try {
      await a.execute({ title: 'T', video: { path: 'D:\\x.mp4' } }, 'cookie=x', {})
      expect(videoChainUsed).toBe(true)
    } finally { delete a._chainOverride }
  })

  it('图文与视频皆缺 → fail-closed（错误信息含 images or video.path）', async () => {
    const a = new DouyinAdapter()
    const r = await a.execute({ title: 'T' }, 'cookie=x', {})
    expect(r.success).toBe(false)
    expect(r.code).toBe(errorCode.data_error)
    expect(r.error).toContain('images or video.path')
  })

  it('dryRun 对图文任务同样短路返回', async () => {
    const a = new DouyinAdapter()
    const r = await a.execute({ title: 'T', images: [{ path: 'a.png' }] }, null, { dryRun: true })
    expect(r).toMatchObject({ success: true, dryRun: true, platform: 'douyin' })
  })
})
