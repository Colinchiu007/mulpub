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

/**
 * 音色来源两态标注（PRD §8.2.9 判据 1；2026-10-19 撤掉频道档后闭集只剩两态）。
 *
 * 撤销频道档后这一族只剩一条：闭集外的 origin 一律「不显示那句来源」，但三段音色照常显示——
 */
describe('PodcastScriptEntry · 音色来源两态标注', () => {
  const voiceWith = (origin) => ({
    ok: true,
    plan: { totalBlocks: 7, totalCodepoints: 12345 },
    voice: { providerId: 'prov_x', model: 'mdl_y', voiceId: 'voice_z', origin, resolvedBy: 'preference' },
  })

  it('origin=preference ⇒ 标注出现，且用的是真实 locale 值（不是键名打到界面上）', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(voiceWith('preference')))
    const w = await open()
    const tag = w.find('[data-testid="podcast-script-voice-origin"]')
    expect(tag.exists(), '② 命中却不标注 ⇒ 用户分不清"我配过"与"系统替我选了"').toBe(true)
    expect(tag.text()).toBe(zh.podcast.episode.originPreference)
  })

  it('origin=providerDefault ⇒ 标注出现（③ 命中同样要写来源）', async () => {
    api.episodePlanPreview.mockResolvedValue(ok(voiceWith('providerDefault')))
    const w = await open()
    const tag = w.find('[data-testid="podcast-script-voice-origin"]')
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toBe(zh.podcast.episode.originProviderDefault)
  })

  it('origin=channel ⇒ 该档已于 2026-10-19 撤销，历史值/伪造值都不得再被标注', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.episodePlanPreview.mockResolvedValue(ok(voiceWith('channel')))
    const w = await open()
    expect(w.find('[data-testid="podcast-script-voice-origin"]').exists(), '频道档已撤仍标出来源 ⇒ 等于伪造来源').toBe(false)
    const line = w.find('[data-testid="podcast-script-voice"]')
    expect(line.exists(), '撤标注时把三段也一起撤掉了 ⇒ 用户看不到本期真正用的音色').toBe(true)
    expect(line.text()).toContain('prov_x')
    expect(line.text()).toContain('voice_z')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('origin 取闭集外的值 ⇒ 不标注也不得兜底成"取自频道"，并留一条 warn（判据 1）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.episodePlanPreview.mockResolvedValue(ok(voiceWith('fromTheChannelProbably')))
    const w = await open()
    expect(w.find('[data-testid="podcast-script-voice-origin"]').exists()).toBe(false)
    // 锚点必须是整行等值，不是「不含某个词」：planVoice 的文案将来合法含「频道」时，not.toContain 会误红（QM6 i6）。
    const voiceLine = w.find('[data-testid="podcast-script-voice"]').text().replace(/\s+/g, ' ').trim()
    expect(voiceLine, '多出的任何后缀都是凭空标注的来源；toBe 抓得住，toContain 对「整行被加了尾巴」反着免疫').toBe(
      zh.podcast.episode.planVoice.replace('{provider}', 'prov_x').replace('{model}', 'mdl_y').replace('{voice}', 'voice_z'))
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('频道音色档撤销后不得留死键与死映射', () => {
  it('zh 与 en 两侧都不再定义 podcast.episode.originChannel', async () => {
    const en = (await import('@/locales/en')).default
    expect(zh.podcast.episode.originChannel).toBeUndefined()
    expect(en.podcast.episode.originChannel).toBeUndefined()
  })

  it('组件源码不得再引用已撤档的映射或那张出声表', () => {
    const vuePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'PodcastScriptEntry.vue')
    const src = fs.readFileSync(vuePath, 'utf8')
    expect(src).not.toMatch(/ANNOTATED_ORIGINS/)
    expect(src).not.toMatch(/originChannel/)
  })
})

describe('主进程音色档位枚举 ↔ 渲染层标注键表必须集合相等（第五轮 P8）', () => {
  // 两张表分别住在主进程（VOICE_ORIGIN 的值集）与渲染层（ORIGIN_KEYS 的键集），本片同时改过它们。
  // 没有集合相等锁时，漂移方向是「新档在 UI 静默不标注」：主进程如实回 origin，渲染层走
  // 「闭集外」支只 console.warn，界面上那句来源标注凭空消失，而全量测试仍全绿（4.5b④ 接上后
  // 新增第三档就是这个形状）。两侧读数都带 >0 下界，防「解析退化让集合变空 ⇒ 相等成立」。
  const readSet = (txt, re) => {
    const out = []
    for (const m of txt.matchAll(re)) out.push(m[1])
    return out.sort()
  }
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../../electron/services/podcast-tts-voice.js'), 'utf8')
  const vueSrc = fs.readFileSync(path.resolve(__dirname, 'PodcastScriptEntry.vue'), 'utf8')
  const origins = readSet(mainSrc, /^\s+[A-Z_]+:\s*'([a-zA-Z]+)',\s*$/gm)
  const keys = readSet(vueSrc, /^\s+([a-zA-Z]+):\s*'podcast\.episode\.origin[a-zA-Z]*',\s*$/gm)
  it('两侧都取到非空读数（反失明下界）', () => {
    expect(origins.length, '主进程 VOICE_ORIGIN 取值取到 ' + JSON.stringify(origins)).toBeGreaterThan(1)
    expect(keys.length, '渲染层 ORIGIN_KEYS 键名取到 ' + JSON.stringify(keys)).toBeGreaterThan(1)
  })
  it('值集与键集逐字相等', () => {
    expect(keys, '渲染层标注表必须与主进程档位枚举同集合').toEqual(origins)
  })
})
