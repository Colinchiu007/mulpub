// @ts-check
'use strict'
/**
 * film-engineering video-gen 单镜失败可观测性回归（change: film-gen-shot-error-observability）
 * 契约：generateShotVideo 的每个失败分支在返回前 SHALL 经 log.warn('FilmVideoGen', ...)
 *       记录镜头序号、shotId 与可辨识的失败类别，MUST NOT 只在成功时记日志、失败时静默返回。
 * 规格：openspec/specs/film-engineering/spec.md「分镜视频生成阶段」Scenario「单镜失败即时留痕」
 */
const { generateShotVideo } = require('./video-gen')

const shot = (i) => ({ shotId: 'shot-' + i, prompt: 'EXT. SCENE ' + i })

/**  recording logger：收集 info/warn 调用 */
function makeLog () {
  const infos = []
  const warns = []
  return {
    infos,
    warns,
    info (m, msg) { infos.push([m, msg]) },
    warn (m, msg) { warns.push([m, msg]) },
    error () {},
  }
}

/** providerCfg：callAdapter 行为由 opts 注入 */
function makeCfg (opts = {}) {
  const manager = {
    callAdapter: async (providerId, method) => {
      if (method === 'generateVideo') {
        if (opts.throwOnSubmit) throw new Error('boom-submit')
        return opts.submit
      }
      if (method === 'getVideoStatus') {
        if (opts.throwOnPoll) throw new Error('boom-poll')
        return opts.poll
      }
      return { code: -1 }
    },
  }
  return { manager, providerId: 'mock-video', model: 'mv-1' }
}

function base (extra) {
  return {
    shot: shot(7), index: 7, runDir: require('os').tmpdir(),
    aspect: '16x9', seconds: 5, sleep: async () => {}, download: async () => {},
    ...extra,
  }
}

describe('generateShotVideo - 单镜失败即时留痕（log.warn）', () => {
  it('提交被拒（外层 code≠0）：warn 记录 shotId 与原因，返回结构不变', async () => {
    const log = makeLog()
    const r = await generateShotVideo(base({
      providerCfg: makeCfg({ submit: { code: -1, message: 'submit rejected by provider' } }), log,
    }))
    expect(r.success).toBe(false)
    expect(r.error).toContain('submit rejected')
    expect(log.warns.length).toBeGreaterThanOrEqual(1)
    const [mod, msg] = log.warns[0]
    expect(mod).toBe('FilmVideoGen')
    expect(msg).toContain('shot-7')
    expect(msg).toContain('submit rejected')
    // 成功日志不应出现在失败路径
    expect(log.infos.length).toBe(0)
  })

  it('provider 返回错误（内层 code<0）：warn 记录', async () => {
    const log = makeLog()
    const r = await generateShotVideo(base({
      providerCfg: makeCfg({ submit: { code: 0, data: { code: -1, message: 'inner provider err' } } }), log,
    }))
    expect(r.success).toBe(false)
    expect(log.warns.length).toBeGreaterThanOrEqual(1)
    expect(log.warns[0][0]).toBe('FilmVideoGen')
    expect(log.warns[0][1]).toContain('shot-7')
    expect(log.warns[0][1]).toContain('inner provider err')
  })

  it('未返回任务 ID：warn 记录', async () => {
    const log = makeLog()
    const r = await generateShotVideo(base({
      providerCfg: makeCfg({ submit: { code: 0, data: {} } }), log,
    }))
    expect(r.success).toBe(false)
    expect(r.error).toContain('未返回任务 ID')
    expect(log.warns.length).toBeGreaterThanOrEqual(1)
    expect(log.warns[0][1]).toContain('shot-7')
  })

  it('轮询超时或失败：warn 记录', async () => {
    const log = makeLog()
    const r = await generateShotVideo(base({
      providerCfg: makeCfg({
        submit: { code: 0, data: { taskId: 't1' } },
        poll: { code: 0, data: { status: 'failed' } },
      }), log,
    }))
    expect(r.success).toBe(false)
    expect(r.error).toContain('超时或失败')
    expect(log.warns.length).toBeGreaterThanOrEqual(1)
    expect(log.warns[0][1]).toContain('shot-7')
  })

  it('异常兜底（submit throw）：warn 记录且返回 error', async () => {
    const log = makeLog()
    const r = await generateShotVideo(base({
      providerCfg: makeCfg({ throwOnSubmit: true }), log,
    }))
    expect(r.success).toBe(false)
    expect(r.error).toContain('boom-submit')
    expect(log.warns.length).toBeGreaterThanOrEqual(1)
    expect(log.warns[0][1]).toContain('shot-7')
    expect(log.warns[0][1]).toContain('boom-submit')
  })

  it('成功路径仍只 info、不 warn（行为保持回归锚）', async () => {
    const log = makeLog()
    const r = await generateShotVideo(base({
      providerCfg: makeCfg({
        submit: { code: 0, data: { taskId: 't1' } },
        poll: { code: 0, data: { status: 'completed', videoUrl: 'mock://v' } },
      }),
      log,
      download: async (_u, dest) => { require('fs').writeFileSync(dest, 'x') },
    }))
    expect(r.success).toBe(true)
    expect(log.warns.length).toBe(0)
    expect(log.infos.length).toBe(1)
    expect(log.infos[0][0]).toBe('FilmVideoGen')
  })

  it('log 缺失/无 warn 时不崩溃（守卫向后兼容）', async () => {
    const r = await generateShotVideo(base({
      providerCfg: makeCfg({ submit: { code: -1, message: 'x' } }),
    }))
    expect(r.success).toBe(false)
    expect(r.error).toContain('x')
  })
})
