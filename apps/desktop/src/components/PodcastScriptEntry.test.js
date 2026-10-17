/**
 * 文本出期浮层行为锁（tasks 4.3②-b，PRD §7.10.3 / §7.10.4.1 判据 3、4、6）
 *
 * 锁的是几件「不报错但骗人」的事：
 * 1. 显示值只能来自预览返回——前端算出来的块数会与 planChunks 漂移，而用户按块付费。
 * 2. **缺失必须整块不显示**，不得回落 0：「0 块」会被读成「这一期不用调用服务商」。
 * 3. 预览被拒要显示**原因句**，且发起按钮**仍可用**：闸门在主进程①层，前端没资格替它决定能不能发。
 * 4. billingConfirmed 必须是**用户按了确认**这件事的产物，不是前端默认值。
 * 5. 取消确认框不得留下任何调用——此时主进程连一次磁盘写都没有。
 *
 * owner 的挂起/释放登记在 src/overlay-view-suspension.test.js；本文件另测两条现场行为。
 */
import { mount } from '@vue/test-utils'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import i18n from '@/i18n'
import zh from '@/locales/zh'
import PodcastScriptEntry from '@/components/PodcastScriptEntry.vue'

const api = vi.hoisted(() => ({
  episodePlanPreview: vi.fn(),
  episodePublishFromScript: vi.fn(),
  onEpisodePublishProgress: vi.fn(),
}))
const suspension = vi.hoisted(() => ({ suspend: vi.fn(), release: vi.fn() }))

vi.mock('@/api/podcast-channel', async (importOriginal) => Object.assign({}, await importOriginal(), api))
vi.mock('@/composables/useEmbeddedViewSuspension', () => ({
  suspendEmbeddedViewsForOverlay: suspension.suspend,
  releaseEmbeddedViewsForOverlay: suspension.release,
}))

const ok = (data) => ({ available: true, result: data })
const PLAN_OK = { ok: true, plan: { totalBlocks: 7, totalCodepoints: 12345 }, voice: { providerId: 'prov_x', model: 'mdl_y', voiceId: 'voice_z', origin: 'preference', resolvedBy: 'capability' } }

function makeProps (over = {}) {
  return Object.assign({ visible: true, channelId: 'ch_a', script: '正文'.repeat(60), title: '一期文本' }, over)
}
async function open (over) {
  const w = mount(PodcastScriptEntry, { props: makeProps(over), global: { plugins: [i18n] } })
  await nextTick(); await Promise.resolve(); await nextTick()
  return w
}

afterEach(() => { vi.clearAllMocks(); api.onEpisodePublishProgress.mockReturnValue(ok(() => {})) })

describe('PodcastScriptEntry · 预览是显示值的唯一来源', () => {
  it('打开即现取预览，入参只有 {channelId, script} 且是 plain object', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(PLAN_OK))
    const w = await open()
    expect(api.episodePlanPreview).toHaveBeenCalledTimes(1)
    const arg = api.episodePlanPreview.mock.calls[0][0]
    expect(Object.keys(arg).sort()).toEqual(['channelId', 'script'])
    expect(arg.channelId).toBe('ch_a')
    expect(w.find('[data-testid="podcast-script-plan"]').exists()).toBe(true)
  })

  it('块数与码点用**真实 locale 值**渲染（键存在但取不到时 vue-i18n 会把键名打到界面上，门禁照样绿）', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(PLAN_OK))
    const w = await open()
    const txt = w.find('[data-testid="podcast-script-plan"]').text()
    expect(txt).toContain(zh.podcast.episode.planBlocks.replace('{n}', '7'))
    expect(txt).toContain(zh.podcast.episode.planCodepoints.replace('{n}', '12345'))
    expect(w.find('[data-testid="podcast-script-voice"]').text()).toContain('prov_x')
  })

  it('两次打开取两次，不缓存（音色偏好可能在别处改过 —— §7.10.4.1 判据 6）', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(PLAN_OK))
    const w = await open({ visible: false })
    await w.setProps({ visible: true }); await nextTick(); await Promise.resolve()
    await w.setProps({ visible: false }); await nextTick()
    await w.setProps({ visible: true }); await nextTick(); await Promise.resolve()
    expect(api.episodePlanPreview.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('PodcastScriptEntry · 缺失与拒绝的形状', () => {
  it('plan 缺席时整块不显示，界面上一个 0 都不许出现（回落 0 是假的「不用调用服务商」）', async () => {
    api.episodePlanPreview.mockResolvedValue(ok({ ok: true, plan: null, voice: null }))
    const w = await open()
    expect(w.find('[data-testid="podcast-script-plan"]').exists()).toBe(false)
    expect(w.find('[data-testid="podcast-script-voice"]').exists()).toBe(false)
    expect(w.text()).not.toMatch(/0\s*块/)
  })

  it('预览被拒：显示主进程给的原因句，且发起按钮**仍然可用**（闸门在①层，判据 3 + 4）', async () => {
    api.episodePlanPreview.mockResolvedValue({ available: true, result: { ok: false, subCode: 'PODCAST_TTS_COPY_TOO_SHORT', message: '正文 12 码点，短于一期口播的下限 80' } })
    const w = await open()
    const reason = w.find('[data-testid="podcast-script-reason"]')
    expect(reason.exists()).toBe(true)
    expect(reason.text()).toContain('80')
    expect(w.find('[data-testid="podcast-script-confirm"]').attributes('disabled')).toBeUndefined()
  })

  it('预览整段抛错只降级为「不显示计数」，不得把发起路径毁掉', async () => {
    api.episodePlanPreview.mockRejectedValue(new Error('IPC 桥断了'))
    const w = await open()
    expect(w.find('[data-testid="podcast-script-plan"]').exists()).toBe(false)
    expect(w.find('[data-testid="podcast-script-confirm"]').attributes('disabled')).toBeUndefined()
  })
})

describe('PodcastScriptEntry · 确认与取消', () => {
  it('确认发出 billingConfirmed:true + copy.content + 形态合法的 runId，载荷是 plain object', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(PLAN_OK))
    api.episodePublishFromScript.mockResolvedValue(ok({ state: 'success', feedUrl: 'https://cdn/feed.xml' }))
    const w = await open()
    await w.find('[data-testid="podcast-script-confirm"]').trigger('click')
    await Promise.resolve(); await nextTick()
    expect(api.episodePublishFromScript).toHaveBeenCalledTimes(1)
    const p = api.episodePublishFromScript.mock.calls[0][0]
    expect(p.billingConfirmed).toBe(true)
    expect(p.copy.content).toBe('正文'.repeat(60))
    expect(p.runId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype)
    expect(w.emitted('published')).toBeTruthy()
  })

  it('取消确认框只关窗：一次 publish 都不发，也不发 cancel（此时主进程还没有任何磁盘写）', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(PLAN_OK))
    const w = await open()
    await w.find('[data-testid="podcast-script-cancel"]').trigger('click')
    expect(api.episodePublishFromScript).not.toHaveBeenCalled()
    expect(w.emitted('update:visible').at(-1)).toEqual([false])
  })

  it('未同意闸门在宿主：主进程抛 PODCAST_TTS_BILLING_UNCONFIRMED 时原样显示其 message，前端不替它圆场', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(PLAN_OK))
    const err = new Error('文本出期会逐块调用 TTS 服务商并产生计费，请先确认用量与费用')
    err.code = 'PODCAST_TTS_BILLING_UNCONFIRMED'
    api.episodePublishFromScript.mockRejectedValue(err)
    const w = await open()
    await w.find('[data-testid="podcast-script-confirm"]').trigger('click')
    await Promise.resolve(); await nextTick()
    expect(w.find('[data-testid="podcast-script-result"]').text()).toContain('确认用量与费用')
  })
})

describe('PodcastScriptEntry · 浮层互斥合同', () => {
  it('打开即挂起内嵌视图，owner 是稳定字面量（overlay-view-suspension 的对账按它抓）', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(PLAN_OK))
    await open()
    expect(suspension.suspend).toHaveBeenCalledWith('podcast-script-entry-overlay')
  })

  it('父组件直接销毁浮层（visible 不经过 false）时也必须释放，否则是残留挂起计数', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(PLAN_OK))
    const w = await open()
    w.unmount()
    await Promise.resolve()
    expect(suspension.release).toHaveBeenCalledWith('podcast-script-entry-overlay')
  })
})

// §7.10.3.4 验收判据 3 的机械版：入口越多，越容易有人在前端「顺手」算一份块数或音色
//（那正是本 PRD 反复禁止的两份口径必然漂移）。这条锁覆盖整个渲染层，
// 所以新加一枚入口不需要动它 —— 但把分块逻辑抄进渲染层会当场变红。
// ⚠️ 判据范围相对 PRD 字面**刻意收窄**（QM-6 评审 QM6-3807-3 点名未记录，现补）：
//   PRD 写的是 `git grep -c planChunks|resolveEpisodeVoice -- apps/desktop/src` 必须为 0，
//   但那条按字面永远不可能成立 —— 本锁自己的 FORBIDDEN 数组就含这两个字面量。
//   要防的是**渲染层生产代码**里的第二份实现，所以这里只扫非测试的 .vue/.js。
describe('PodcastScriptEntry · 渲染层不得出现第二份分块/音色实现', () => {
  const SRC_ROOT = path.resolve(__dirname, '..')
  const FORBIDDEN = ['planChunks', 'resolveEpisodeVoice']

  const collect = () => {
    const acc = []
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        if (fs.statSync(full).isDirectory()) walk(full)
        else if (/\.(vue|js)$/.test(name) && !/\.test\.js$/.test(name)) acc.push(full)
      }
      return acc
    }
    return walk(SRC_ROOT)
  }

  const scan = () => {
    const hits = []
    for (const f of collect()) {
      const text = fs.readFileSync(f, 'utf8')
      for (const sym of FORBIDDEN) if (text.includes(sym)) hits.push(path.relative(SRC_ROOT, f) + ':' + sym)
    }
    return hits
  }

  it('扫描域非空（域塌成空集合时「零命中」读起来完全像通过）', () => {
    expect(collect().length).toBeGreaterThan(200)
  })

  it('src 下没有任何渲染层文件引用主进程的分块/音色实现', () => {
    const hits = scan()
    console.log(`[second-impl-guard] domain=${collect().length} hits=${hits.length}`)
    expect(hits).toEqual([])
  })
})
