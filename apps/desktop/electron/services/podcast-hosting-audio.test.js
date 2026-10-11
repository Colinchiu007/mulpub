/**
 * PodcastHostingService.publishAudio 的行为锁（刀 3 第 3 片：真实上传面）
 *
 * 为什么单独立一个文件：`publishAudio` 是这条链上**第一次真的把用户的音频写到公网**的地方，
 * 它的四个拒绝条件（缺频道 / contentType 不合格 / 未配置托管 / 凭证读不出）任何一个被放宽，
 * 后果都是不可逆的外发或一个订阅端永远下载坏掉的对象。上一轮实测就是证据：把 size 判据与
 * mime 判据分别改成 no-op 时，本目录其它 136 条用例**一条都不会红**——守卫没有锁等于没写。
 *
 * 接缝纪律：只假宿主（registry / credentialStore / httpClient / `_put`），
 * key 拼接、mime 门禁、https 门禁、缺字节拒绝全部走真实实现。
 */
import { describe, it, expect, vi } from 'vitest'
import os from 'os'
import PodcastHostingService from './podcast-hosting-service'

function makeService () {
  const puts = []
  const svc = new PodcastHostingService({
    registry: { channelDir: () => '/tmp/ch', tryBeginPublish: () => true, endPublish () {} },
    channelOf: () => ({}),
    ownerSubject: () => 'sub_test_owner',
    logger: { info () {}, warn () {}, error () {} },
    credentialStore: { loadCredential: () => null, saveCredential: () => false },
    httpClient: async () => ({ status: 200 }),
    fsImpl: { existsSync: () => true, readFileSync: () => '', createReadStream: () => ({ on () {} }), statSync: () => ({ size: 1 }) },
    dateImpl: (d) => d.toUTCString(),
    userDataDir: () => os.tmpdir(),
  })
  svc.getHosting = () => ({
    configured: true,
    endpoint: 'oss-cn-hangzhou.aliyuncs.com',
    bucket: 'my-bucket',
    pathPrefix: 'podcast',
    credentialRef: 'ref_test',
  })
  svc._readSecret = () => ({ accessKeyId: 'AK', accessKeySecret: 'SK', securityToken: '' })
  svc._put = vi.fn(async (snapshot, objectKey, filePath, contentType) => {
    puts.push({ objectKey, filePath, contentType })
    return { size: 2048, status: 200 }
  })
  return { svc, puts }
}

const AUDIO = { filePath: '/tmp/ep001.mp3', mime: 'audio/mpeg' }

describe('podcast-hosting-service · publishAudio（真实上传面）', () => {
  it('正常路径：key 带 channelId 分层、contentType 用实测 mime、回 https 地址与可校验字节数', async () => {
    const { svc, puts } = makeService()
    const r = await svc.publishAudio('ch_aaaaaaaaaaaa', AUDIO)
    expect(puts.length).toBe(1)
    expect(puts[0].objectKey).toContain('/audio/ch_aaaaaaaaaaaa/')
    expect(puts[0].contentType).toBe('audio/mpeg')
    expect(r.size).toBe(2048)
    expect(/^https:\/\//i.test(r.url)).toBe(true)
    expect(r.url).toContain('my-bucket')
  })

  it('缺 channelId 一律拒绝，且一次 PUT 都不发（缺它就等于把两期写进同一层）', async () => {
    const { svc, puts } = makeService()
    await expect(svc.publishAudio('', AUDIO)).rejects.toMatchObject({ code: 'PODCAST_CHANNEL_ID_REQUIRED' })
    expect(puts.length).toBe(0)
  })

  it('contentType 不是实测音视频类型 ⇒ 拒绝（不得沿用 feed 的 xml 把音频发出去）', async () => {
    for (const mime of ['', undefined, 'application/rss+xml', 'text/plain', 'AUDIObogus']) {
      const { svc, puts } = makeService()
      await expect(svc.publishAudio('ch_aaaaaaaaaaaa', { filePath: '/tmp/a.bin', mime })).rejects.toMatchObject({ code: 'PODCAST_HOSTING_INVALID' })
      expect(puts.length).toBe(0)
    }
  })

  it('putObject 不回传字节数 ⇒ 拒绝而不是 success（三处一致校验的第三处缺了就是放过坏对象）', async () => {
    const { svc } = makeService()
    svc._put = async () => ({ status: 200 })
    await expect(svc.publishAudio('ch_aaaaaaaaaaaa', AUDIO)).rejects.toMatchObject({ code: 'PODCAST_HOSTING_UPLOAD_FAILED' })
    const { svc: svc2 } = makeService()
    svc2._put = async () => ({ status: 200, size: '2048' })
    await expect(svc2.publishAudio('ch_aaaaaaaaaaaa', AUDIO)).rejects.toMatchObject({ code: 'PODCAST_HOSTING_UPLOAD_FAILED' })
  })

  it('拼不出 https 公网地址 ⇒ 拒绝（明文直链在聚合端等同没发布）', async () => {
    const { svc } = makeService()
    svc.getHosting = () => ({ configured: true, endpoint: '', bucket: '', pathPrefix: 'podcast', credentialRef: 'ref_test' })
    await expect(svc.publishAudio('ch_aaaaaaaaaaaa', AUDIO)).rejects.toMatchObject({ code: 'PODCAST_HOSTING_UPLOAD_FAILED' })
  })

  it('未配置托管 ⇒ PODCAST_HOSTING_REQUIRED 且不 PUT；凭证读不出 ⇒ SECRET_MISSING 且不 PUT（两条排查方向不得合并）', async () => {
    const { svc, puts } = makeService()
    svc.getHosting = () => ({ configured: false })
    await expect(svc.publishAudio('ch_aaaaaaaaaaaa', AUDIO)).rejects.toMatchObject({ code: 'PODCAST_HOSTING_REQUIRED' })
    expect(puts.length).toBe(0)

    const s2 = makeService()
    s2.svc._readSecret = () => null
    await expect(s2.svc.publishAudio('ch_aaaaaaaaaaaa', AUDIO)).rejects.toMatchObject({ code: 'PODCAST_HOSTING_SECRET_MISSING' })
    expect(s2.puts.length).toBe(0)
  })

  it('stem 里的路径分隔与遍历序列必须被清洗（对象 key 不接受调用方给的目录）', async () => {
    const { svc, puts } = makeService()
    await svc.publishAudio('ch_aaaaaaaaaaaa', Object.assign({}, AUDIO, { stem: '../../etc/passwd' }))
    expect(puts[0].objectKey).not.toContain('..')
    expect(puts[0].objectKey.split('/').filter(Boolean).join('/')).toContain('audio/ch_aaaaaaaaaaaa/')
    await svc.publishAudio('ch_aaaaaaaaaaaa', Object.assign({}, AUDIO, { stem: '第一期 · 上（终稿）' }))
    // 只判 stem 那一段：对象 key 本身按设计就有 `/` 与 `.`（扩展名），拿整串去判「无非法字符」是断言写错，
    // 不是守卫漏了——这条曾经假红过一次，记在这里免得下一个人把判据放宽。
    const seg = puts[1].objectKey.slice(puts[1].objectKey.indexOf('/audio/') + '/audio/'.length)
    expect(seg.startsWith('ch_aaaaaaaaaaaa/')).toBe(true)
    const stemSeg = seg.split('/')[1]
    expect(/[\u4e00-\u9fa5\s·（）]/.test(stemSeg)).toBe(false)
    expect(stemSeg.length).toBeGreaterThan(0)
  })
})
