/**
 * usePodcastHosting 行为合同（刀 2 渲染层）
 *
 * 这里锁的是「secret 的驻留边界」与「失败形状不被压平」两件事：
 * - 空凭证字段**不得进 payload**（缺席 = 保持不变这条规则有渲染层的一半，主进程猜不到用户是没填还是清空）；
 * - 保存后无论成功失败，表单里的 AK/SK 必须立刻被清（状态树会进 DevTools 与错误上报）；
 * - 主进程回的是掩码，渲染层任何时刻都拿不到明文，因此也就无处泄漏；
 * - 发布结果保留 state 分层（success / failed / busy），不得在中间层变成 true/false。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))

let api = null

// 必须是**部分** mock：本 composable 经 usePodcastChannel 复用 toPlain/issueText，
// 那条链还会 import 整个 api 面。整体替换会让 ESM 具名导出校验在 link 期就炸
// （症状是「No "channelGet" export is defined on the mock」，与本次要测的行为无关）。
vi.mock('@/api/podcast-channel', async (importOriginal) => {
  const actual = await importOriginal()
  api = {
    hostingGet: vi.fn(),
    hostingSave: vi.fn(),
    hostingCheck: vi.fn(),
    feedPublish: vi.fn(),
  }
  return Object.assign({}, actual, api)
})

const ok = (data) => ({ available: true, result: { ok: true, ...data } })
const fail = (code, extra) => ({ available: true, result: Object.assign({ ok: false, code }, extra || {}) })

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => { vi.clearAllMocks() })

async function load () {
  const mod = await import('./usePodcastHosting')
  return mod
}

describe('usePodcastHosting', () => {
  it('导出完整性：卡片模板消费的每个键都必须在', async () => {
    const { usePodcastHosting, makeHostingForm } = await load()
    const s = usePodcastHosting()
    for (const k of [
      'hosting', 'hostingLoaded', 'hostingError', 'hostingIssues', 'savingHosting', 'checking',
      'publishing', 'checkResult', 'publishResult', 'configured', 'formFromHosting',
      'loadHosting', 'saveHosting', 'checkHosting', 'publishFeed',
    ]) expect(s).toHaveProperty(k)
    expect(Object.keys(makeHostingForm()).sort()).toEqual(['accessKeyId', 'accessKeySecret', 'bucket', 'endpoint', 'pathPrefix', 'provider'])
  })

  it('留空的凭证字段根本不进 payload（缺席=保持不变的渲染层一半）', async () => {
    const { usePodcastHosting, makeHostingForm } = await load()
    api.hostingSave.mockResolvedValue(ok({ hosting: { configured: true, maskedAccessKeyId: '***ghij' } }))
    const s = usePodcastHosting()
    const form = Object.assign(makeHostingForm(), { endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'pod', pathPrefix: 'feeds' })
    await s.saveHosting(form)
    const sent = api.hostingSave.mock.calls[0][0]
    expect('accessKeyId' in sent).toBe(false)
    expect('accessKeySecret' in sent).toBe(false)
    expect(sent.bucket).toBe('pod')
  })

  it('填了才提交，且保存后表单里的明文立刻被清空（成功与失败两条路都必须清）', async () => {
    const { usePodcastHosting, makeHostingForm } = await load()
    api.hostingSave.mockResolvedValue(ok({ hosting: { configured: true } }))
    const s = usePodcastHosting()
    const form = Object.assign(makeHostingForm(), { accessKeyId: 'AKIDabcdefghij', accessKeySecret: 'SECRETxyz' })
    await s.saveHosting(form)
    const sent = api.hostingSave.mock.calls[0][0]
    expect(sent.accessKeySecret).toBe('SECRETxyz')
    expect(form.accessKeySecret).toBe('')
    expect(form.accessKeyId).toBe('')

    const form2 = Object.assign(makeHostingForm(), { accessKeySecret: 'SECRET2' })
    api.hostingSave.mockResolvedValue(fail('PODCAST_HOSTING_CRYPTO_UNAVAILABLE'))
    await s.saveHosting(form2)
    expect(form2.accessKeySecret).toBe('')
    expect(s.hostingError.value).toBe('PODCAST_HOSTING_CRYPTO_UNAVAILABLE')
  })

  it('渲染层状态树任何时刻不含 secret：hosting 只有掩码字段', async () => {
    const { usePodcastHosting, makeHostingForm } = await load()
    api.hostingGet.mockResolvedValue(ok({ hosting: { provider: 'oss', endpoint: 'e', bucket: 'b', pathPrefix: 'p', maskedAccessKeyId: '***ghij', configured: true, credentialRef: 'podcast-hosting', updatedAt: '', provider_: null } }))
    api.hostingSave.mockResolvedValue(ok({ hosting: { maskedAccessKeyId: '***ghij', configured: true } }))
    const s = usePodcastHosting()
    await s.loadHosting()
    const form = Object.assign(makeHostingForm(), { accessKeySecret: 'SECRETzzz' })
    await s.saveHosting(form)
    expect(JSON.stringify(s.hosting.value)).not.toContain('SECRETzzz')
    expect(s.configured.value).toBe(true)
    // 回填表单时 secret 一律留空（主进程不回显，回填了就等于要覆写）
    expect(s.formFromHosting().accessKeySecret).toBe('')
  })

  it('失败信封带 subCode → 错误位用领域码（否则新增校验码只能落到兜底文案）', async () => {
    const { usePodcastHosting, makeHostingForm } = await load()
    api.hostingSave.mockResolvedValue({ available: true, result: { ok: false, code: -2, subCode: 'PODCAST_HOSTING_SECRET_MISSING', issues: [{ code: 'X', path: 'hosting.bucket', message: 'm' }] } })
    const s = usePodcastHosting()
    const res = await s.saveHosting(Object.assign(makeHostingForm(), { bucket: 'b' }))
    expect(res.code).toBe('PODCAST_HOSTING_SECRET_MISSING')
    expect(s.hostingError.value).toBe('PODCAST_HOSTING_SECRET_MISSING')
    expect(s.hostingIssues.value).toHaveLength(1)
  })

  it('IPC 不可用与本轮失败分两档（不得把环境问题说成用户没填对）', async () => {
    const { usePodcastHosting } = await load()
    api.hostingGet.mockResolvedValue({ available: false })
    const s = usePodcastHosting()
    const r = await s.loadHosting()
    expect(r.code).toBe('PODCAST_IPC_UNAVAILABLE')
    expect(s.hostingError.value).toBe('PODCAST_IPC_UNAVAILABLE')
    expect(s.hostingLoaded.value).toBe(false)
  })

  it('发布结果保留分层状态；busy 不会被吞成「失败」', async () => {
    const { usePodcastHosting } = await load()
    api.feedPublish.mockResolvedValue(ok({ state: 'success', url: 'https://x/feed.xml', itemCount: 3, backupCreated: false }))
    const s = usePodcastHosting()
    const r = await s.publishFeed('ch_a0000001')
    expect(r.state).toBe('success')
    expect(s.publishResult.value.backupCreated).toBe(false)
    expect(s.publishing.value).toBe(false)

    api.feedPublish.mockResolvedValue(fail('PODCAST_CHANNEL_BUSY'))
    const r2 = await s.publishFeed('ch_a0000001')
    expect(r2.code).toBe('PODCAST_CHANNEL_BUSY')
    expect(s.publishResult.value).toBe(null)
  })

  it('checkHosting 的「未探测」原样带出，不在中间层伪装成成功', async () => {
    const { usePodcastHosting } = await load()
    api.hostingCheck.mockResolvedValue(ok({ checked: false, reason: 'PODCAST_HOSTING_CHECK_SKIPPED', hosting: {} }))
    const s = usePodcastHosting()
    const r = await s.checkHosting()
    expect(r.checked).toBe(false)
    expect(s.checkResult.value.reason).toBe('PODCAST_HOSTING_CHECK_SKIPPED')
  })

  it('信封归一不得有第二份：本文件必须引用 normalizeIpcEnvelope 且不再自带 subCode 规则', async () => {
    // 「领域码优先」这条规则被抄成两份时，只更新一份的症状是新增码只显示成通用失败，
    // 而两边的单测都会绿——因为各自只测自己那份。锁在源码形态上才拦得住。
    const src = fs.readFileSync(path.join(__dir, 'usePodcastHosting.js'), 'utf8')
    expect(src).toContain('normalizeIpcEnvelope(')
    // 结构锁必须**先剥注释再判**：本文件里有解释「为什么不重写归一」的注释，
    // 不剥注释的判据会把说明文字当成违规代码打红（本仓踩过同一型坑），
    // 反过来只判"注释里出现过"也不等于归一规则没被抄——所以按代码形态断言。
    const codeOnly = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(codeOnly).not.toContain('subCode')
    expect(codeOnly).not.toMatch(/const res = envelope\.result/)
    const channelSrc = fs.readFileSync(path.join(__dir, 'usePodcastChannel.js'), 'utf8')
    const channelCode = channelSrc.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    // 「归一只在这一处」的可执行形态：剥注释后**只允许一行**提到 subCode，且那一行属于
    // normalizeIpcEnvelope。按行数而不是按出现次数——同一条规则里 `res.subCode` 出现两次是正常的。
    const lines = channelCode.split('\n').filter((l) => l.includes('subCode'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('res.subCode')
    expect(channelCode).toContain('export function normalizeIpcEnvelope')
  })
})
