// @ts-check
'use strict'
/**
 * auto-runner 契约测试（openspec change: film-auto-mode，design D15/D21/D30/D31）
 *
 * 锁定：
 *  - 提示词真源是 **project.json**（片段编辑后生效），且逐字符传给生成函数；
 *  - 单镜秒数按 project.shots[i].seconds 覆盖（允许逐镜调整）；
 *  - 参考图映射来自 project.refPaths；派发前计数（onDispatched）先于生成调用；
 *  - 批后以**磁盘为真**同步状态（文件在 → done+outputPath；缺失 → failed）；
 *  - 单镜重生成按「全局镜号 → 批号/批内号」定位，且走「临时目录 → ffprobe 校验 → rename」原子覆盖；
 *    ffprobe 失败时**不得**破坏既有产物；
 *  - 未配置视频 Provider 一律 VIDEO_MODEL_NOT_CONFIGURED（fail-closed，零调用）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  autoRunIdFor, locateShot, shotFileName, buildRefMap, syncProjectFromDisk,
  runAutoBatch, regenerateOneShot, collectMissingShots,
} = require('./auto-runner')

const MEDIA_ROOT = path.join(os.tmpdir(), 'film-engineering')
const refPath = (n) => path.join(MEDIA_ROOT, 'references', 'ref-' + n + '.png')

function tmpRoot () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'auto-runner-test-'))
}

function fakeAiGenerator () {
  return {
    _modelProviderManager: {
      getDefault: (cap) => (cap === 'video' ? { id: 'minimax' } : null),
    },
  }
}

function makeProject (shotCount = 3, overrides = {}) {
  return {
    schemaVersion: 1,
    taskId: 'auto-1',
    runSeq: 1,
    planId: 'plan-x',
    aspect: '16x9',
    seconds: 5,
    providerId: 'minimax',
    mediaRoot: MEDIA_ROOT,
    shots: Array.from({ length: shotCount }, (_, i) => ({
      index: i,
      shotId: 'auto-' + String(i).padStart(3, '0'),
      title: '第' + (i + 1) + '场',
      prompt: 'PROMPT-' + i,
      characterNames: [],
      refPaths: i === 0 ? [refPath('a')] : [],
      seconds: i === 0 ? 8 : 5,
      status: 'pending',
      outputPath: null,
      error: null,
    })),
    confirmations: [],
    counters: { providerCalls: 0 },
    warnings: [],
    ...overrides,
  }
}

describe('auto-runner · 定位与映射', () => {
  it('runId 与「全局镜号 → 批号/批内号」映射', () => {
    expect(autoRunIdFor('auto-1', 0)).toBe('auto/auto-1/b0')
    expect(autoRunIdFor('auto-1', 2)).toBe('auto/auto-1/b2')
    expect(locateShot(0)).toEqual({ batchIndex: 0, inBatchIndex: 0 })
    expect(locateShot(9)).toEqual({ batchIndex: 0, inBatchIndex: 9 })
    expect(locateShot(12)).toEqual({ batchIndex: 1, inBatchIndex: 2 })
    expect(locateShot(-1)).toEqual({ batchIndex: 0, inBatchIndex: 0 })
  })

  it('buildRefMap 只收录有参考图的镜', () => {
    const map = buildRefMap(makeProject(3))
    expect(map.size).toBe(1)
    expect(map.get('auto-000')).toEqual([refPath('a')])
  })

  it('collectMissingShots 按批复核并回填 shotId', () => {
    const project = makeProject(12)
    const probe = (runId, count) => ({ missing: runId.endsWith('b1') ? [0, 1] : [] })
    const missing = collectMissingShots({ project, probe })
    expect(missing).toHaveLength(2)
    expect(missing[0]).toEqual({ batchIndex: 1, shotIndex: 0, shotId: 'auto-010' })
    expect(missing[1].shotId).toBe('auto-011')
  })
})

describe('auto-runner · 批执行（提示词来自项目文件）', () => {
  it('逐镜把 project.json 的 prompt/seconds 与参考图映射传给生成函数', async () => {
    const root = tmpRoot()
    const calls = []
    const project = makeProject(3)
    const batch = { runId: 'auto/auto-1/b0', shotIds: project.shots.map((s) => s.shotId) }
    const gen = async ({ shot, index, runDir, seconds, refMap }) => {
      calls.push({ index, prompt: shot.prompt, seconds, refs: refMap.get(shot.shotId) || null, runDir })
      const p = path.join(runDir, shotFileName(index))
      fs.writeFileSync(p, 'FAKE')
      return { index, shotId: shot.shotId, success: true, path: p }
    }
    const persisted = []
    await runAutoBatch({
      batch, project, aiGenerator: fakeAiGenerator(), log: null,
      deps: { _testGenerateShotVideo: gen, _testRunDir: (runId) => path.join(root, runId) },
      onShotProgress: () => {},
      persist: (p) => persisted.push(JSON.parse(JSON.stringify(p.shots))),
    })
    expect(calls).toHaveLength(3)
    const sorted = calls.slice().sort((a, b) => a.index - b.index)
    expect(sorted[0].prompt).toBe('PROMPT-0')
    expect(sorted[0].seconds).toBe(8) // 逐镜覆盖
    expect(sorted[1].seconds).toBe(5)
    expect(sorted[0].refs).toEqual([refPath('a')])
    expect(sorted[2].refs).toBeNull()
    // 磁盘为真：三镜都完成并写入 outputPath
    expect(project.shots.every((s) => s.status === 'done')).toBe(true)
    expect(project.shots[0].outputPath).toContain(path.join('auto', 'auto-1', 'b0', 'shot_000.mp4'))
    // 批后持久化被调用一次
    expect(persisted).toHaveLength(1)
  })

  it('提示词为空 → 该镜失败且不调用生成函数', async () => {
    const root = tmpRoot()
    let calls = 0
    const project = makeProject(2)
    project.shots[1].prompt = '   '
    const batch = { runId: 'auto/auto-1/b0', shotIds: project.shots.map((s) => s.shotId) }
    const reported = []
    await runAutoBatch({
      batch, project, aiGenerator: fakeAiGenerator(), log: null,
      deps: {
        _testRunDir: (runId) => path.join(root, runId),
        _testGenerateShotVideo: async ({ index, runDir, shot }) => {
          calls += 1
          const p = path.join(runDir, shotFileName(index))
          fs.writeFileSync(p, 'FAKE')
          return { index, shotId: shot.shotId, success: true, path: p }
        },
      },
      onShotProgress: (i, status, reason) => reported.push({ i, status, reason }),
    })
    expect(calls).toBe(1)
    const failed = reported.find((r) => r.i === 1)
    expect(failed.status).toBe('failed')
    expect(String(failed.reason)).toContain('提示词')
    expect(project.shots[1].status).toBe('failed')
  })

  it('派发前计数先于生成调用（D30 观测计数）', async () => {
    const root = tmpRoot()
    const order = []
    const project = makeProject(1)
    const batch = { runId: 'auto/auto-1/b0', shotIds: ['auto-000'] }
    await runAutoBatch({
      batch, project, aiGenerator: fakeAiGenerator(), log: null,
      deps: {
        _testRunDir: (runId) => path.join(root, runId),
        _testGenerateShotVideo: async ({ index, runDir, shot }) => {
          order.push('gen')
          const p = path.join(runDir, shotFileName(index))
          fs.writeFileSync(p, 'FAKE')
          return { index, shotId: shot.shotId, success: true, path: p }
        },
      },
      onDispatched: () => order.push('count'),
      onShotProgress: () => {},
    })
    expect(order).toEqual(['count', 'gen'])
  })

  it('生成失败 → 该镜 failed 且记录原因（不抛出）', async () => {
    const root = tmpRoot()
    const project = makeProject(1)
    const batch = { runId: 'auto/auto-1/b0', shotIds: ['auto-000'] }
    await runAutoBatch({
      batch, project, aiGenerator: fakeAiGenerator(), log: null,
      deps: {
        _testRunDir: (runId) => path.join(root, runId),
        _testGenerateShotVideo: async ({ index, shot }) => ({ index, shotId: shot.shotId, success: false, error: 'provider 超时' }),
      },
      onShotProgress: () => {},
    })
    expect(project.shots[0].status).toBe('failed')
    expect(project.shots[0].error).toContain('provider 超时')
  })

  it('未配置视频 Provider → 抛 VIDEO_MODEL_NOT_CONFIGURED（零调用）', async () => {
    const project = makeProject(1)
    const batch = { runId: 'auto/auto-1/b0', shotIds: ['auto-000'] }
    await expect(runAutoBatch({
      batch, project, aiGenerator: { _modelProviderManager: { getDefault: () => null } }, log: null,
      deps: { _testGenerateShotVideo: async () => { throw new Error('不该被调用') } },
    })).rejects.toThrow(/VIDEO_MODEL_NOT_CONFIGURED/)
  })

  it('syncProjectFromDisk：文件缺失 → failed 且保留既有原因', () => {
    const root = tmpRoot()
    const project = makeProject(2)
    project.shots[1].error = '生成失败（既有原因）'
    const batch = { runId: 'auto/auto-1/b0', shotIds: project.shots.map((s) => s.shotId) }
    const runDir = path.join(root, batch.runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, shotFileName(0)), 'FAKE')
    syncProjectFromDisk({ project, batch, runDirOf: (runId) => path.join(root, runId) })
    expect(project.shots[0].status).toBe('done')
    expect(project.shots[1].status).toBe('failed')
    expect(project.shots[1].error).toBe('生成失败（既有原因）')
  })
})

describe('auto-runner · 单镜重生成（原子覆盖）', () => {
  it('按全局镜号定位到正确批次目录与批内文件名，并在校验通过后覆盖', async () => {
    const root = tmpRoot()
    const project = makeProject(13)
    let seen = null
    const gen = async ({ index, runDir, shot }) => {
      seen = { index, runDir, prompt: shot.prompt }
      const p = path.join(runDir, shotFileName(index))
      fs.mkdirSync(runDir, { recursive: true })
      fs.writeFileSync(p, 'NEW')
      return { index, shotId: shot.shotId, success: true, path: p }
    }
    const r = await regenerateOneShot({
      project, shotIndex: 12, aiGenerator: fakeAiGenerator(), log: null,
      deps: {
        _testRunDir: (runId) => path.join(root, runId),
        _testTmpRoot: () => root,
        _testGenerateShotVideo: gen,
        _testProbeClip: async () => ({ codec: 'h264' }),
      },
    })
    expect(r.ok).toBe(true)
    expect(seen.index).toBe(2) // 12 → 批 1、批内 2
    expect(seen.runDir).toContain(path.join('.regen'))
    const dest = path.join(root, 'auto', 'auto-1', 'b1', shotFileName(2))
    expect(r.path).toBe(dest)
    expect(fs.readFileSync(dest, 'utf8')).toBe('NEW')
    expect(project.shots[12].status).toBe('done')
    expect(project.shots[12].outputPath).toBe(dest)
  })

  it('ffprobe 校验失败 → 不覆盖既有产物（原子性）', async () => {
    const root = tmpRoot()
    const project = makeProject(1)
    const dest = path.join(root, 'auto', 'auto-1', 'b0', shotFileName(0))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, 'OLD-GOOD')
    const r = await regenerateOneShot({
      project, shotIndex: 0, aiGenerator: fakeAiGenerator(), log: null,
      deps: {
        _testRunDir: (runId) => path.join(root, runId),
        _testTmpRoot: () => root,
        _testGenerateShotVideo: async ({ index, runDir, shot }) => {
          const p = path.join(runDir, shotFileName(index))
          fs.mkdirSync(runDir, { recursive: true })
          fs.writeFileSync(p, 'HALF-WRITTEN')
          return { index, shotId: shot.shotId, success: true, path: p }
        },
        _testProbeClip: async () => { throw new Error('moov atom not found') },
      },
    })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_REGENERATE_INVALID_CLIP')
    expect(fs.readFileSync(dest, 'utf8')).toBe('OLD-GOOD')
  })

  it('生成失败 / 越界 / 未配 Provider 的错误码', async () => {
    const root = tmpRoot()
    const project = makeProject(2)
    const deps = {
      _testRunDir: (runId) => path.join(root, runId),
      _testTmpRoot: () => root,
      _testProbeClip: async () => ({}),
      _testGenerateShotVideo: async ({ index, shot }) => ({ index, shotId: shot.shotId, success: false, error: 'provider 500' }),
    }
    const fail = await regenerateOneShot({ project, shotIndex: 0, aiGenerator: fakeAiGenerator(), deps, log: null })
    expect(fail.errorCode).toBe('AUTO_REGENERATE_FAILED')

    const oob = await regenerateOneShot({ project, shotIndex: 99, aiGenerator: fakeAiGenerator(), deps, log: null })
    expect(oob.errorCode).toBe('AUTO_SHOT_INVALID')

    const noProvider = await regenerateOneShot({
      project, shotIndex: 0, deps, log: null,
      aiGenerator: { _modelProviderManager: { getDefault: () => null } },
    })
    expect(noProvider.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
  })

  it('空白提示词的镜头不允许重生成', async () => {
    const project = makeProject(1)
    project.shots[0].prompt = '  '
    const r = await regenerateOneShot({ project, shotIndex: 0, aiGenerator: fakeAiGenerator(), log: null })
    expect(r.errorCode).toBe('AUTO_SHOT_INVALID')
  })
})

/**
 * 回归保护（2026-10-23）：自动模式的批次产物目录必须**按轮次隔离**。
 *
 * Bug：同一 taskId 用 overwrite 重新 plan 时，`createProject` 递增 `runSeq` 并把旧的
 * project.json / ledger.json 归档到 `archive/<runSeq>/`，但**产物目录原地不动**
 * （`archiveTaskRun` 只搬那两个文件）。而 `autoRunIdFor` 不含轮次 ⇒ 新旧轮次的
 * `b.runId` 完全相同 ⇒ `resolveResumePlan` 的磁盘复核看到上一轮的 `shot_NNN.mp4` 还在
 * ⇒ **整批跳过、零 provider 调用**，而清单声称的是新分镜
 * ⇒ 完全静默的假成功（已实跑复现：轮次 2 零调用、收口 ok、产物是上一轮的视频）。
 *
 * 为什么带**轮次**而不是分镜集指纹：自动模式的 `project.shots` 是活状态
 * （`updateShot` 可改提示词/参考图/时长），按分镜集派生目录会让用户改一个字就丢光
 * 已生成产物。轮次只在新 plan 时变，编辑不动它 —— 两个语义各归其位。
 *
 * 反证纪律：把 runSeq 从 autoRunIdFor 里去掉，本组必须变红。
 */
describe('自动模式批次产物：轮次隔离（2026-10-23）', () => {
  it('轮次 1 沿用历史布局 ⇒ 存量项目零影响', () => {
    expect(autoRunIdFor('auto-1', 0)).toBe('auto/auto-1/b0')
    expect(autoRunIdFor('auto-1', 2)).toBe('auto/auto-1/b2')
    // 显式传 1 也必须与缺省一致
    expect(autoRunIdFor('auto-1', 0, 1)).toBe('auto/auto-1/b0')
  })

  it('轮次 ≥2 带上轮次号 ⇒ 与上一轮目录物理隔离', () => {
    expect(autoRunIdFor('auto-1', 0, 2)).toBe('auto/auto-1/r2/b0')
    expect(autoRunIdFor('auto-1', 1, 2)).toBe('auto/auto-1/r2/b1')
    expect(autoRunIdFor('auto-1', 0, 2)).not.toBe(autoRunIdFor('auto-1', 0, 1))
  })

  it('非法/缺失 runSeq 回落轮次 1（不生成可疑目录名）', () => {
    for (const bad of [undefined, null, 0, -1, 1.5, 'x', NaN]) {
      expect(autoRunIdFor('auto-1', 0, bad)).toBe('auto/auto-1/b0')
    }
  })

  it('collectMissingShots 按项目轮次探针 ⇒ 新轮次不会被上一轮产物判为「齐备」', () => {
    const probeCalls = []
    const probe = (runId, count) => { probeCalls.push(runId); return { missing: [] } }
    // 轮次 2 的项目：探针必须打在 r2 目录上，而不是上一轮的裸目录
    collectMissingShots({ project: { taskId: 'tk', runSeq: 2, shots: [{ shotId: 'S1' }] }, probe })
    expect(probeCalls).toEqual(['auto/tk/r2/b0'])
    // 轮次 1 的项目：仍是历史布局
    probeCalls.length = 0
    collectMissingShots({ project: { taskId: 'tk', runSeq: 1, shots: [{ shotId: 'S1' }] }, probe })
    expect(probeCalls).toEqual(['auto/tk/b0'])
  })
})
