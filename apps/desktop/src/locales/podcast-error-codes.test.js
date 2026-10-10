'use strict'

/**
 * 领域码 → 文案的**反方向**接线守卫（QM-6 前端评审命中）
 *
 * 为什么方向要紧：`check-locale-sync.js` 的 pair check 只判「zh 有而 en 没有」这类**成对性**，
 * 键级成对全绿时，一个界面根本取不到文案的码照样可以存在；而我自己的第一版自检做错了方向
 * （逐个 locale 键反查有没有生产者），那个方向对「有码无文案」完全失明。
 * `issueText()` 未命中键时落 `podcast.errors.fallback`，把**裸码**显示给用户——
 * 用户看到的是 `PODCAST_HOSTING_ENDPOINT_REQUIRED` 这种字符串，不是「Endpoint 不能为空」。
 *
 * 判据只认「主进程以字符串字面量产出的码」，因为那才是真的会走到渲染层的东西；
 * 例外表必须逐条写理由，且**只能缩小**（新增例外即红），防止把漏写的码当成"设计如此"。
 */
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = ['src/locales/podcast/zh.js', 'src/locales/podcast/en.js']
const PRODUCERS = [
  'electron/services/podcast-hosting-upload.js',
  'electron/services/podcast-hosting-service.js',
  'electron/services/podcast-channel-service.js',
  'electron/services/podcast-channel-registry.js',
  'electron/services/podcast-channel-locks.js',
  'electron/ipc-handlers/podcast.js',
]

/**
 * 不面向用户的码：要么是**编程错误断言**（构造期即抛，用户走不到），
 * 要么已经有**专用渲染键**（不是靠 errors.* 出文案）。逐条给证据，不许笼统豁免。
 */
const EXEMPT_WITH_REASON = {
  PODCAST_HOSTING_REGISTRY_REQUIRED: '构造期断言（缺 registry 直接抛），没有任何用户路径能触发',
  PODCAST_HOSTING_CHANNEL_RESOLVER_REQUIRED: '构造期断言（缺频道解析器直接抛），同上',
  PODCAST_GATE_KEY_REQUIRED: '锁的编程断言：缺 channelId 不得静默降级成不串行',
  PODCAST_LOCK_TASK_REQUIRED: '锁的编程断言：临界区必须是函数',
  PODCAST_HOSTING_NOT_CONFIGURED: 'check.reason，走 podcast.hosting.checkNotConfigured 专用键渲染',
  PODCAST_HOSTING_CHECK_SKIPPED: 'check.reason，走 podcast.hosting.checkSkipped 专用键渲染',
}

function errorsKeys (rel) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const i = s.indexOf('errors: {')
  if (i < 0) throw new Error(rel + ' 找不到 errors 块（拆结构后必须同步本判据）')
  const j = s.indexOf('\n    },', i)
  return new Set([...s.slice(i, j).matchAll(/^\s{6}([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
}

function producedCodes () {
  const found = new Map()
  for (const rel of PRODUCERS) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) throw new Error('生产者文件不存在，判据的扫描域已失效：' + rel)
    const s = fs.readFileSync(p, 'utf8')
    for (const m of s.matchAll(/['"](PODCAST_[A-Z0-9_]+)['"]/g)) {
      if (!found.has(m[1])) found.set(m[1], rel)
    }
  }
  return found
}

describe('播客领域码必须都能取到文案（反方向接线守卫）', () => {
  const produced = producedCodes()
  const zh = errorsKeys('src/locales/podcast/zh.js')
  const en = errorsKeys('src/locales/podcast/en.js')

  it('扫描域非空（否则本文件会假绿）', () => {
    expect(produced.size).toBeGreaterThan(20)
    expect(zh.size).toBeGreaterThan(60)
  })

  it('每个会走到渲染层的码，zh 与 en 都有文案', () => {
    const missing = [...produced.keys()].filter((k) => !EXEMPT_WITH_REASON[k] && (!zh.has(k) || !en.has(k)))
    expect(missing, '缺文案的码：\n' + missing.map((k) => '  ' + k + ' ← ' + produced.get(k)).join('\n')).toEqual([])
  })

  it('例外表里的码必须真的存在于生产者且确实没有文案（防止例外表变成垃圾桶）', () => {
    const stale = Object.keys(EXEMPT_WITH_REASON).filter((k) => !produced.has(k))
    expect(stale, '例外表已陈旧（生产者不再产出这些码），必须删除：' + stale.join(',')).toEqual([])
    const textedButExempt = Object.keys(EXEMPT_WITH_REASON).filter((k) => zh.has(k) && k.startsWith('PODCAST_HOSTING_') && !k.includes('NOT_CONFIGURED') && !k.includes('CHECK_SKIPPED'))
    expect(textedButExempt, '这些码已有文案却仍挂例外，必须摘掉例外：' + textedButExempt.join(',')).toEqual([])
  })

  it('文案不许反向成为死键：每个非 fallback 的 errors 键，生产者或渲染层至少一处引用', () => {
    // 扫描域必须覆盖**所有**会产出这些码的层：校验器在 shared-utils（EPISODE_* 一类码在那儿生成），
    // 让域缺一层就会把"确实有人产出的文案"误判成死键——那比漏判更糟，因为它会诱导下一个人删键。
    const corpus = [
      ...PRODUCERS,
      '../../packages/shared-utils/src/podcast-rss.js',
      '../../packages/shared-utils/src/podcast-endpoints.js',
      'src/components/PodcastHostingCard.vue',
      'src/composables/usePodcastChannel.js',
      'src/composables/usePodcastChannelActions.js',
      'src/composables/usePodcastChannelPicker.js',
      'src/composables/usePodcastHosting.js',
      'src/views/PodcastChannelView.vue',
    ].map((rel) => {
      const p = path.resolve(ROOT, rel)
      if (!fs.existsSync(p)) throw new Error('死键判据的扫描域文件缺失（改动结构必须同步这里）：' + rel)
      return fs.readFileSync(p, 'utf8')
    }).join('\n')
    const dead = [...zh].filter((k) => k !== 'fallback' && !corpus.includes(k))
    expect(dead, '无人引用的文案键：' + dead.join(',')).toEqual([])
  })
})
