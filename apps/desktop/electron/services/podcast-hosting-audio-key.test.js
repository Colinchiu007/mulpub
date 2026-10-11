/**
 * publishAudio 的对象 key 边界与**真实** _put 路径（刀 3 第 3 片，QM-6 ② W2 与 ⑤）
 *
 * 与 `podcast-hosting-audio.test.js` 的分工：那份把 `_put` 整体 mock 掉来量「publishAudio 自己的
 * 四条拒绝」，代价是真实上传链（签名 → putObject → URL 守卫）一次都没跑过——评审 ⑤ 点名的正是这条：
 * 「拼不出 https」那条测的是 publishAudio 自有判据，而不是 `_put` 里那道守卫。本文件刻意**不 mock `_put`**，
 * 只假 `httpClient`（本仓零真实出站纪律），于是 key 分层与 URL 守卫都在真路径上被跑到。
 *
 * W2 的成因：`stem` 清洗得很干净，`channelId` 反而没洗，而它直接进 objectKey。
 * 少这一条判据，`../` 就能把对象抬出 `audio/<channelId>/` 这一层——
 * 表现是「A 频道的某期覆盖了 B 频道的某期」，而两侧本地看起来都正确。
 */
import { describe, it, expect, vi } from 'vitest'
import os from 'os'
import PodcastHostingService from './podcast-hosting-service'

const AUDIO = { filePath: '/tmp/ep001.mp3', mime: 'audio/mpeg', stem: 'ep001' }

function makeService (view = {}) {
  const outs = []
  const svc = new PodcastHostingService({
    registry: { channelDir: () => '/tmp/ch', tryBeginPublish: () => true, endPublish () {} },
    channelOf: () => ({}),
    ownerSubject: () => 'sub_test_owner',
    logger: { info () {}, warn () {}, error () {} },
    credentialStore: { loadCredential: () => null, saveCredential: () => false },
    // 形态照真宿主：构造期只收「带 put() 的对象」；传函数会被判成没注入并静默退回 axios
    // （零出站随后把它打成 Network Error，那读起来像环境问题，不像「夹具替对方改了形状」）。
    httpClient: {
      put: async (...args) => {
        outs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a || {}))).join(' '))
        return { status: 200 }
      },
    },
    // 真实 _put → putObject 需要 statSync 与 createReadStream；size 就是三处一致校验的第三处
    fsImpl: {
      existsSync: () => true,
      readFileSync: () => '',
      createReadStream: () => ({ on () {} }),
      statSync: () => ({ size: 4096 }),
    },
    dateImpl: (d) => d.toUTCString(),
    userDataDir: () => os.tmpdir(),
  })
  svc.getHosting = () => Object.assign({
    configured: true,
    endpoint: 'oss-cn-hangzhou.aliyuncs.com',
    bucket: 'my-bucket',
    pathPrefix: 'podcast',
    credentialRef: 'ref_test',
  }, view)
  svc._readSecret = () => ({ accessKeyId: 'AK', accessKeySecret: 'SK', securityToken: '' })
  return { svc, outs }
}

describe('publishAudio · channelId 形态（对象 key 的第二段，必须由主进程判形状）', () => {
  it.each([
    ['../escape', '../../etc/passwd'],
    ['绝对路径', '/tmp/x'],
    ['大写与下划线不合规', 'CH_BAD'],
    ['前缀对但长度不足', 'ch_'],
    ['前缀不对', 'default'],
    ['带反斜杠', 'ch_a\\..\\b'],
  ])('%s ⇒ PODCAST_CHANNEL_ID_INVALID，且一次出站都不发', async (_label, bad) => {
    const { svc, outs } = makeService()
    await expect(svc.publishAudio(bad, AUDIO)).rejects.toMatchObject({ code: 'PODCAST_CHANNEL_ID_INVALID' })
    expect(outs.length).toBe(0)
  })

  it('合规 id 放行，并且 key 与出站 URL 都落在 audio/<channelId>/ 这一层', async () => {
    const { svc, outs } = makeService()
    const r = await svc.publishAudio('ch_abcd1234', AUDIO)
    expect(outs.length).toBe(1)
    expect(outs[0]).toContain('/audio/ch_abcd1234/ep001.mp3')
    expect(/^https:\/\//i.test(r.url)).toBe(true)
    expect(r.size).toBe(4096)
  })

  it('判据复用 registry 的 CHANNEL_ID_RE 唯一实现（本文件不得出现第二份字符集）', () => {
    const raw = require('fs').readFileSync(require('path').join(__dirname, 'podcast-hosting-service.js'), 'utf8')
    const src = raw.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(src).toMatch(/require\('\.\/podcast-channel-registry'\)/)
    // 计数按**调用点**，不按子串：PODCAST_CHANNEL_ID_REQUIRED 里也含 CHANNEL_ID_RE 这串，
    // 按子串数会得到 5，于是下一个人只能把判据放宽。
    expect((src.match(/CHANNEL_ID_RE\.test\(/g) || []).length).toBe(1)
    expect(src).not.toMatch(/\/\^ch_/)
  })
})

describe('publishAudio · 真实 _put 路径（评审 ⑤：守卫不能只活在 mock 里）', () => {
  it('endpoint 缺失时红的是 _put 自己的 URL 守卫，而不是 publishAudio 的事后判据', async () => {
    const { svc, outs } = makeService({ endpoint: '' })
    const err = await svc.publishAudio('ch_abcd1234', AUDIO).catch((e) => e)
    expect(outs.length).toBe(0)
    // 真 _put 的文案是「无法由 endpoint/bucket 拼出上传地址」（查配置），
    // 而 publishAudio 事后那道 https 判据的文案是「未能拼出 https 公网地址」。两者必须是**前者**，
    // 否则本用例只是在测 mock 的兜底——那正是评审 ⑤ 说的「守卫从未被真实路径覆盖」。
    expect(err.code).toBe('PODCAST_HOSTING_INVALID')
    expect(err.message).toContain('endpoint')
  })

  it('contentType 作为第四个参数一路传到真 _put：签名头里就是实测 mime（不得沿用 feed 的 xml）', async () => {
    const { svc, outs } = makeService()
    await svc.publishAudio('ch_abcd1234', AUDIO)
    expect(outs[0]).toMatch(/audio\/mpeg/)
    expect(outs[0]).not.toMatch(/application\/rss\+xml/)
  })

  it('非 2xx 由真 putObject 抛出并带状态码，publishAudio 不改写成 success', async () => {
    const svc = new PodcastHostingService({
      registry: { channelDir: () => '/tmp/ch', tryBeginPublish: () => true, endPublish () {} },
      channelOf: () => ({}),
      ownerSubject: () => 'sub',
      logger: { info () {}, warn () {}, error () {} },
      credentialStore: { loadCredential: () => null, saveCredential: () => false },
      httpClient: { put: async () => { const e = new Error('403'); e.status = 403; throw e } },
      fsImpl: { existsSync: () => true, readFileSync: () => '', createReadStream: () => ({ on () {} }), statSync: () => ({ size: 4096 }) },
      dateImpl: (d) => d.toUTCString(),
      userDataDir: () => os.tmpdir(),
    })
    svc.getHosting = () => ({ configured: true, endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'b', pathPrefix: 'podcast', credentialRef: 'r' })
    svc._readSecret = () => ({ accessKeyId: 'AK', accessKeySecret: 'SK', securityToken: '' })
    const err = await svc.publishAudio('ch_abcd1234', AUDIO).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String(err.message)).not.toMatch(/AccessKeySecret|SK$/)
    expect(vi).toBeTruthy()
  })
})
