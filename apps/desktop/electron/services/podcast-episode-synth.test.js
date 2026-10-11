import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MOD = path.resolve(__dirname, 'podcast-episode-synth.js')

/**
 * 刀 4 第 2 块的行为锁（PRD §7.4.2 第 3-5 步、§7.4.3 第 ② 层、§7.4.4 取消窗口）。
 * 一律注入假实现：真实出站由 network-egress-guard 拦死，且 provider 计费不允许在测试里发生。
 */
async function load () { return import(MOD) }

function tmpDir () {
  const d = path.join(os.tmpdir(), 'mp-synth-' + process.pid + '-' + Math.random().toString(36).slice(2))
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** 夹具必须让「成功」与「降级」两种产物在**形状上可区分**（都只返回 path 就无法断言降级门禁）。 */
function fakeTts (results) {
  const calls = []
  return {
    calls,
    fn: async ({ text, index }) => {
      calls.push({ text, index })
      const r = results[index == null ? calls.length - 1 : index] || results[results.length - 1]
      return typeof r === 'function' ? r() : r
    },
  }
}

function concatOk (bytes = 4096) {
  return async ({ outPath, paths, gapSec }) => {
    fs.writeFileSync(outPath, Buffer.alloc(bytes, 7))
    return { path: outPath, blocks: paths.length, gapSec }
  }
}

const probe = (durationSec) => async () => ({ durationSec })

describe('块间静音取值（闭集内才可信）', () => {
  it('0.2 / 0.9 越界一律钳进 [0.3,0.6] 并出声，不得静默采纳调用方给的数', async () => {
    const { normalizeGap, GAP_MIN_SEC, GAP_MAX_SEC } = await load()
    const warn = vi.fn()
    expect(normalizeGap(0.2, warn)).toBe(GAP_MIN_SEC)
    expect(normalizeGap(0.9, warn)).toBe(GAP_MAX_SEC)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(normalizeGap(0.45, warn)).toBe(0.45)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('gapSec=0 是「块间不加静音」的仓内既有形态，必须出声纠正而不是当成用户明确要求', async () => {
    const { normalizeGap, GAP_DEFAULT_SEC } = await load()
    const warn = vi.fn()
    expect(normalizeGap(0, warn)).toBe(GAP_DEFAULT_SEC)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('连读')
  })
})

describe('逐块合成：降级、失败与取消（五类拒绝态不得合并）', () => {
  const chunks = [{ text: '第一块口播文本。', para: 0, index: 0 }, { text: '第二块口播文本。', para: 1, index: 1 }]

  it('成功路径：返回实测三件套，mime 显式给出，块间静音按归一后的值传给拼接', async () => {
    const { synthesizeEpisodeAudio } = await load()
    const dir = tmpDir()
    const tts = fakeTts([{ path: dir + '/b0.mp3' }, { path: dir + '/b1.mp3' }])
    let seen = null
    const out = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/episode', generateTTS: tts.fn,
      concatBlocks: async (o) => { seen = o; return concatOk()(o) }, probeImpl: probe(12),
      gapSec: 0.5,
    })
    expect(out).toMatchObject({ durationSec: 12, sizeBytes: 4096, mime: 'audio/mpeg', blocks: 2, gapSec: 0.5 })
    expect(seen.paths).toEqual([dir + '/b0.mp3', dir + '/b1.mp3'])
    expect(seen.gapSec).toBe(0.5)
    // 逐块**串行**：一次一个，且本层不再套第二层重试 ⇒ 每块恰好一次调用
    expect(tts.calls.length).toBe(2)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('任一块 degraded ⇒ 拦在 probe 之前，且逐块列出块号（probe 一次都不能被调用）', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS } = await load()
    const dir = tmpDir()
    const probeSpy = vi.fn(probe(12))
    const tts = fakeTts([{ path: dir + '/b0.mp3' }, { path: dir + '/b1.mp3', degraded: true }])
    const err = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/episode', generateTTS: tts.fn,
      concatBlocks: concatOk(), probeImpl: probeSpy,
    }).catch((e) => e)
    expect(err.code).toBe(SYNTH_ERRORS.BLOCK_DEGRADED)
    // 块号从 1 开始（面向用户的说法），且必须把是第几块点名
    expect(err.issues[0].blocks).toEqual([2])
    expect(err.issues[0].message).toContain('第 2 块')
    expect(probeSpy).not.toHaveBeenCalled()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('部分块失败没有「跳过坏块继续」这个出口', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS } = await load()
    const dir = tmpDir()
    const tts = fakeTts([{ path: dir + '/b0.mp3' }, { error: 'rate limited' }])
    const err = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/episode', generateTTS: tts.fn,
      concatBlocks: concatOk(), probeImpl: probe(6),
    }).catch((e) => e)
    expect(err.code).toBe(SYNTH_ERRORS.PARTIAL_FAILED)
    expect(err.issues[0].blocks).toEqual([2])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('全部块失败 → ALL_FAILED（与 PARTIAL_FAILED 是两个码，排查方向不同）', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS } = await load()
    const tts = fakeTts([null, null])
    const err = await synthesizeEpisodeAudio({
      chunks, outBase: tmpDir() + '/episode', generateTTS: tts.fn,
      concatBlocks: concatOk(), probeImpl: probe(6),
    }).catch((e) => e)
    expect(err.code).toBe(SYNTH_ERRORS.ALL_FAILED)
  })

  it('取消点落在块与块之间：token 置位后不再发起下一块，也不拼接', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS } = await load()
    const dir = tmpDir()
    const token = { cancelled: false }
    const tts = fakeTts([
      () => { token.cancelled = true; return { path: dir + '/b0.mp3' } },
      { path: dir + '/b1.mp3' },
    ])
    const concatSpy = vi.fn(concatOk())
    const err = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/episode', generateTTS: tts.fn,
      concatBlocks: concatSpy, probeImpl: probe(6), cancelToken: token,
    }).catch((e) => e)
    expect(err.code).toBe(SYNTH_ERRORS.CANCELLED)
    expect(concatSpy).not.toHaveBeenCalled()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('拼接后实测（不得用 provider 申报值）', () => {
  const chunks = [{ text: '一段足够长的口播文本用来推导出时长下限。', para: 0, index: 0 }]

  it('拼接产物不存在 → CONCAT_FAILED，不进 probe', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS } = await load()
    const probeSpy = vi.fn(probe(9))
    const err = await synthesizeEpisodeAudio({
      chunks, outBase: tmpDir() + '/episode',
      generateTTS: fakeTts([{ path: 'x' }]).fn,
      concatBlocks: async () => ({ path: 'D:/不存在的产物.mp3' }), probeImpl: probeSpy,
    }).catch((e) => e)
    expect(err.code).toBe(SYNTH_ERRORS.CONCAT_FAILED)
    expect(probeSpy).not.toHaveBeenCalled()
  })

  it('时长实测为 0 → AUDIO_TOO_SHORT（provider 申报值再高也不作数）', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS } = await load()
    const dir = tmpDir()
    const err = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/episode', generateTTS: fakeTts([{ path: dir + '/b0.mp3' }]).fn,
      concatBlocks: concatOk(), probeImpl: probe(0),
    }).catch((e) => e)
    expect(err.code).toBe(SYNTH_ERRORS.AUDIO_TOO_SHORT)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('实测字节与磁盘不一致 → 拦下（三处一致校验的第一处就在本层）', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS } = await load()
    const dir = tmpDir()
    const err = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/episode', generateTTS: fakeTts([{ path: dir + '/b0.mp3' }]).fn,
      concatBlocks: concatOk(5000), probeImpl: async () => ({ durationSec: 30, sizeBytes: 4096 }),
    }).catch((e) => e)
    expect(err.code).toBe(SYNTH_ERRORS.AUDIO_TOO_SHORT)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('时长按码点下限拦「整段被静音替换」，但不得误杀合法的短块', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS, MIN_SEC_PER_CODEPOINT } = await load()
    expect(MIN_SEC_PER_CODEPOINT).toBeLessThan(1)
    const dir = tmpDir()
    // 该块实测 20 码点 ⇒ 下限 20 × 0.1 = 2.0s；给 5s 合法，给 1.5s 必须拦
    const ok = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/ok', generateTTS: fakeTts([{ path: dir + '/b0.mp3' }]).fn,
      concatBlocks: concatOk(), probeImpl: probe(5),
    })
    expect(ok.durationSec).toBe(5)
    // 误杀负控：20 码点念成 3.4s（约 5.9 码点/秒，比常态口播还快）必须放行
    const fast = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/fast', generateTTS: fakeTts([{ path: dir + '/b0.mp3' }]).fn,
      concatBlocks: concatOk(), probeImpl: probe(3.4),
    })
    expect(fast.durationSec).toBe(3.4)
    const err = await synthesizeEpisodeAudio({
      chunks, outBase: dir + '/bad', generateTTS: fakeTts([{ path: dir + '/b0.mp3' }]).fn,
      concatBlocks: concatOk(), probeImpl: probe(1.5),
    }).catch((e) => e)
    expect(err.code).toBe(SYNTH_ERRORS.AUDIO_TOO_SHORT)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('注入合同（本层不得自己走出站）', () => {
  it('缺任一注入实现即 fail closed，并且发生在任何块调用之前', async () => {
    const { synthesizeEpisodeAudio, SYNTH_ERRORS } = await load()
    const spy = vi.fn()
    for (const miss of [{}, { generateTTS: spy }, { generateTTS: spy, concatBlocks: spy }]) {
      const err = await synthesizeEpisodeAudio(Object.assign({ chunks: [{ text: 'a', para: 0, index: 0 }], outBase: 'x' }, miss)).catch((e) => e)
      expect(err.code).toBe(SYNTH_ERRORS.INVALID_ARGS)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('未给计划而给整篇文案时，分块判据仍只有 planChunks 一份（超限句必须被拒而不是硬切）', async () => {
    const { synthesizeEpisodeAudio } = await load()
    const err = await synthesizeEpisodeAudio({
      content: '无句号的一整句'.repeat(400), outBase: 'x',
      generateTTS: vi.fn(), concatBlocks: vi.fn(), probeImpl: vi.fn(),
    }).catch((e) => e)
    expect(err.code).toBe('PODCAST_TTS_CHUNK_UNSAFE')
  })
})
