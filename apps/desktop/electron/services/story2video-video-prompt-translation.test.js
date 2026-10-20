// @ts-check
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { Story2VideoProjectService } = require('./story2video-project-service')
const { withAssetTransientRetry } = require('./story2video-stages')
const { cleanupImportedMediaPaths, importUserSelectedMedia } = require('./story2video-paths')

vi.mock('electron', () => {
  throw new Error('纯 Node 服务测试不应加载 Electron 运行时')
})

function writeFile (filePath, content = 'media') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  return filePath
}

function imageOptimizationResponse (optimizedPrompt = '新画面提示词', overrides = {}) {
  return {
    results: [{
      optimized_prompt: optimizedPrompt,
      strategy_used: 'llm',
      key_source: 'caller',
      cache_hit: false,
      model_used: 'SenseNova',
      caller: 'multi-publish-desktop',
      ...overrides,
    }],
  }
}

describe('Story2VideoProjectService — 视频提示词中文翻译（2026-10-19）', () => {
  let root
  let store

  beforeEach(() => {
    const controlledTempRoot = path.join(os.tmpdir(), 'story2video')
    fs.mkdirSync(controlledTempRoot, { recursive: true })
    root = fs.mkdtempSync(path.join(controlledTempRoot, 'project-service-'))
    // 忠实模拟 settings-store：owner 未显式传入时按 _resolveOwnerSubject 二次解析（未登录→null→丢弃），
    // 显式传入时按 owner 分桶（__legacy__ → 原 key，其他 → user:<hash>: 键空间）。
    const buckets = new Map()
    const normalizeOwner = (value) => {
      if (typeof value !== 'string') return null
      const subject = value.trim()
      return subject ? subject : null
    }
    store = {
      _resolveOwnerSubject: vi.fn(() => 'user-a'),
      getUserSetting: vi.fn((key, fallback, ownerSubject) => {
        const owner = ownerSubject !== undefined ? normalizeOwner(ownerSubject) : normalizeOwner(store._resolveOwnerSubject())
        if (!owner) return fallback
        return buckets.get(owner) === undefined ? fallback : buckets.get(owner)
      }),
      setUserSetting: vi.fn((key, value, ownerSubject) => {
        const owner = ownerSubject !== undefined ? normalizeOwner(ownerSubject) : normalizeOwner(store._resolveOwnerSubject())
        if (!owner) return
        buckets.set(owner, value)
      }),
    }
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('regenerateScenePrompt video 成功后翻译成中文写入 videoPromptTranslation', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizeVideoPrompt = vi.fn(async () => ({ results: [{ prompt: 'Cinematic shot of a red apple' }] }))
    const aiGenerator = {
      generateWithDefault: vi.fn(async () => ({ content: '{"0":"红苹果的电影镜头"}' })),
    }
    const service = new Story2VideoProjectService({
      store,
      projectsDir: projectRoot,
      aiGenerator,
      serviceBus: { optimizeVideoPrompt },
    })
    service._writeProjects([{
      projectId: 'project-video-trans', status: 'completed', options: {},
      segments: [{
        id: 'segment-0', index: 0, text: '你好', prompt: '旧画面词',
        videoPrompt: null, videoPromptTranslation: null,
      }],
    }])

    const updated = await service.regenerateScenePrompt('project-video-trans', 'segment-0', 'video')

    expect(updated.segments[0].videoPrompt).toBe('Cinematic shot of a red apple')
    expect(updated.segments[0].videoPromptTranslation).toBe('红苹果的电影镜头')
    expect(updated.segments[0].status).toBe('completed')
    // 翻译调用：默认 LLM + 严格 JSON 系统提示
    expect(aiGenerator.generateWithDefault).toHaveBeenCalledTimes(1)
    const [type, params] = aiGenerator.generateWithDefault.mock.calls[0]
    expect(type).toBe('llm')
    expect(params.messages[0].content).toContain('简体中文')
    expect(params.messages[0].content).toContain('JSON')
  })

  it('regenerateScenePrompt video 翻译失败时也返回最新项目（避免陈旧快照回滚并发编辑，QM-6 i2）', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizeVideoPrompt = vi.fn(async () => ({ results: [{ prompt: 'Cinematic shot' }] }))
    let concurrentEditDone = false
    const service = new Story2VideoProjectService({
      store,
      projectsDir: projectRoot,
      aiGenerator: {
        generateWithDefault: vi.fn(async () => {
          if (!concurrentEditDone) {
            concurrentEditDone = true
            service.updateSegments('project-video-trans-fail-latest', [
              { id: 'segment-0', text: '用户改过的旁白' },
            ])
          }
          throw new Error('LLM down')
        }),
      },
      serviceBus: { optimizeVideoPrompt },
    })
    service._writeProjects([{
      projectId: 'project-video-trans-fail-latest', status: 'completed', options: {},
      segments: [{ id: 'segment-0', index: 0, text: '你好', videoPrompt: null, videoPromptTranslation: null }],
    }])

    const updated = await service.regenerateScenePrompt('project-video-trans-fail-latest', 'segment-0', 'video')

    // 失败路径返回值必须是重读后的最新项目（含窗口期内的并发编辑），而非 await 前的陈旧快照
    expect(updated.segments[0].videoPrompt).toBe('Cinematic shot')
    expect(updated.segments[0].text).toBe('用户改过的旁白')
    expect(updated.segments[0].videoPromptTranslation).toBe(null)
  })

  it('regenerateScenePrompt video 翻译窗口内项目被删除时 fail-open 不抛错（QM-6 i3）', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizeVideoPrompt = vi.fn(async () => ({ results: [{ prompt: 'Cinematic shot' }] }))
    let deleteDone = false
    const service = new Story2VideoProjectService({
      store,
      projectsDir: projectRoot,
      aiGenerator: {
        generateWithDefault: vi.fn(async () => {
          if (!deleteDone) {
            deleteDone = true
            service.deleteProject('project-video-trans-deleted')
          }
          return { content: '{"0":"电影镜头"}' }
        }),
      },
      serviceBus: { optimizeVideoPrompt },
    })
    service._writeProjects([{
      projectId: 'project-video-trans-deleted', status: 'completed', options: {},
      segments: [{ id: 'segment-0', index: 0, text: '你好', videoPrompt: null, videoPromptTranslation: null }],
    }])

    // 不得抛 TypeError（latest.segments of null）；IPC 正常返回
    const updated = await service.regenerateScenePrompt('project-video-trans-deleted', 'segment-0', 'video')
    expect(updated).toBeTruthy()
    expect(updated.segments[0].videoPrompt).toBe('Cinematic shot')
    // 项目已从索引删除
    expect(service._findProject('project-video-trans-deleted')).toBe(null)
  })

  it('regenerateScenePrompt video 翻译失败时 videoPromptTranslation 为 null（fail-open 不阻塞）', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizeVideoPrompt = vi.fn(async () => ({ results: [{ prompt: 'Cinematic shot' }] }))
    const service = new Story2VideoProjectService({
      store,
      projectsDir: projectRoot,
      aiGenerator: { generateWithDefault: vi.fn(async () => { throw new Error('LLM down') }) },
      serviceBus: { optimizeVideoPrompt },
    })
    service._writeProjects([{
      projectId: 'project-video-trans-fail', status: 'completed', options: {},
      segments: [{
        id: 'segment-0', index: 0, text: '你好', prompt: '旧画面词',
        videoPrompt: null, videoPromptTranslation: null,
      }],
    }])

    const updated = await service.regenerateScenePrompt('project-video-trans-fail', 'segment-0', 'video')

    // 翻译失败不得影响视频优化词本身
    expect(updated.segments[0].videoPrompt).toBe('Cinematic shot')
    expect(updated.segments[0].videoPromptTranslation).toBe(null)
    expect(updated.segments[0].status).toBe('completed')
  })

  it('regenerateScenePrompt video 翻译返回包装/非法内容时不写入垃圾译文', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizeVideoPrompt = vi.fn(async () => ({ results: [{ prompt: 'Cinematic shot' }] }))
    const service = new Story2VideoProjectService({
      store,
      projectsDir: projectRoot,
      // LLM 回显 markdown 包裹 + 示例再给最终译文：应取到真实译文而非包裹文本
      aiGenerator: { generateWithDefault: vi.fn(async () => ({ content: '```json\n{"0":"示例"}\n```\n{"0":"真实译文"}' })) },
      serviceBus: { optimizeVideoPrompt },
    })
    service._writeProjects([{
      projectId: 'project-video-trans-junk', status: 'completed', options: {},
      segments: [{ id: 'segment-0', index: 0, text: '你好', videoPrompt: null, videoPromptTranslation: null }],
    }])

    const updated = await service.regenerateScenePrompt('project-video-trans-junk', 'segment-0', 'video')

    expect(updated.segments[0].videoPromptTranslation).toBe('真实译文')
  })

  it('regenerateScenePrompt video 翻译超时时 videoPromptTranslation 为 null（有界，不无限挂起 IPC）', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizeVideoPrompt = vi.fn(async () => ({ results: [{ prompt: 'Cinematic shot' }] }))
    // LLM 永久 pending：有界超时必须让翻译路径自行放弃，否则整个 IPC 响应挂死。
    // 用假计时器推进 25s（PROMPT_TRANSLATION_BATCH_TIMEOUT_MS），避免测试真等 25 秒。
    vi.useFakeTimers()
    try {
      const service = new Story2VideoProjectService({
        store,
        projectsDir: projectRoot,
        aiGenerator: { generateWithDefault: vi.fn(() => new Promise(() => {})) },
        serviceBus: { optimizeVideoPrompt },
      })
      service._writeProjects([{
        projectId: 'project-video-trans-timeout', status: 'completed', options: {},
        segments: [{ id: 'segment-0', index: 0, text: '你好', videoPrompt: null, videoPromptTranslation: null }],
      }])

      const pending = service.regenerateScenePrompt('project-video-trans-timeout', 'segment-0', 'video')
      await vi.advanceTimersByTimeAsync(25000)
      const updated = await pending

      // 超时不阻塞：videoPrompt 与 status 正常落库，译文为 null（2026-10-19 QM-6 i3）
      expect(updated.segments[0].videoPrompt).toBe('Cinematic shot')
      expect(updated.segments[0].videoPromptTranslation).toBe(null)
      expect(updated.segments[0].status).toBe('completed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('regenerateScenePrompt video 翻译窗口内 videoPrompt 被改则放弃旧词译文（QM-6 i1）', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizeVideoPrompt = vi.fn(async () => ({ results: [{ prompt: 'Cinematic shot' }] }))
    // 翻译期间用户改写了 videoPrompt（updateSegments 会先清空译文）
    let concurrentEditDone = false
    const service = new Story2VideoProjectService({
      store,
      projectsDir: projectRoot,
      aiGenerator: {
        generateWithDefault: vi.fn(async () => {
          if (!concurrentEditDone) {
            concurrentEditDone = true
            service.updateSegments('project-video-trans-identity', [
              { id: 'segment-0', videoPrompt: '用户改写后的新视频词' },
            ])
          }
          return { content: '{"0":"电影镜头"}' }
        }),
      },
      serviceBus: { optimizeVideoPrompt },
    })
    service._writeProjects([{
      projectId: 'project-video-trans-identity', status: 'completed', options: {},
      segments: [{ id: 'segment-0', index: 0, text: '你好', videoPrompt: null, videoPromptTranslation: null }],
    }])

    await service.regenerateScenePrompt('project-video-trans-identity', 'segment-0', 'video')

    const persisted = service.getProject('project-video-trans-identity')
    // videoPrompt 是用户改写后的新词，旧词译文「电影镜头」不得被写回（译文须对应当前提示词）
    expect(persisted.segments[0].videoPrompt).toBe('用户改写后的新视频词')
    expect(persisted.segments[0].videoPromptTranslation).toBe(null)
  })

  it('regenerateScenePrompt video 翻译窗口内的并发修改不被译文二次落盘覆盖（QM-6 i2）', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizeVideoPrompt = vi.fn(async () => ({ results: [{ prompt: 'Cinematic shot' }] }))
    // 翻译调用期间同步执行一次 updateSegments（模拟用户在 25s 窗口内编辑并保存）
    let concurrentEditDone = false
    const service = new Story2VideoProjectService({
      store,
      projectsDir: projectRoot,
      aiGenerator: {
        generateWithDefault: vi.fn(async () => {
          if (!concurrentEditDone) {
            concurrentEditDone = true
            service.updateSegments('project-video-trans-race', [
              { id: 'segment-0', text: '用户改过的旁白' },
              { id: 'segment-1', text: '用户改过的第二段' },
            ])
          }
          return { content: '{"0":"电影镜头"}' }
        }),
      },
      serviceBus: { optimizeVideoPrompt },
    })
    service._writeProjects([{
      projectId: 'project-video-trans-race', status: 'completed', options: {},
      segments: [
        { id: 'segment-0', index: 0, text: '你好', videoPrompt: null, videoPromptTranslation: null },
        { id: 'segment-1', index: 1, text: '第二段原文', videoPrompt: null, videoPromptTranslation: null },
      ],
    }])

    await service.regenerateScenePrompt('project-video-trans-race', 'segment-0', 'video')

    const persisted = service.getProject('project-video-trans-race')
    // 译文写入成功
    expect(persisted.segments[0].videoPromptTranslation).toBe('电影镜头')
    // 窗口期内的并发修改必须保留（不得被陈旧引用整段覆盖回滚）
    expect(persisted.segments[0].text).toBe('用户改过的旁白')
    expect(persisted.segments).toHaveLength(2)
    expect(persisted.segments[1].text).toBe('用户改过的第二段')
  })

  it('_resolveUiLocale 归一化主语言子标签（en-US/en/zh/垃圾值，QM-6 i2）', () => {
    const projectRoot = path.join(root, 'projects')
    const service = new Story2VideoProjectService({ store, projectsDir: projectRoot })
    const localeOf = (optimizeLocale, optionsLocale) => service._resolveUiLocale({
      story2videoTextConfig: { config: { optimize: { uiLocale: optimizeLocale } } },
      options: { uiLocale: optionsLocale },
    })

    // 带地区后缀归一化到主语言：与展示侧 getAppLocale()（只认 en/zh）对齐
    expect(localeOf('en-US', 'zh')).toBe('en')
    expect(localeOf('zh-CN', 'en')).toBe('zh')
    expect(localeOf('EN', 'zh')).toBe('en')
    // 垃圾值不再直接注入翻译 LLM，回落缺省 zh
    expect(localeOf('garbage', 'zh')).toBe('zh')
    expect(localeOf('---', 'zh')).toBe('zh')
    expect(localeOf('', 'zh')).toBe('zh')
    // optimize 缺省时回落 options，再缺省回落 zh
    expect(localeOf(undefined, 'en-US')).toBe('en')
    expect(localeOf(undefined, undefined)).toBe('zh')
    // 项目整体缺省
    expect(service._resolveUiLocale(null)).toBe('zh')
  })

  it('regenerateScenePrompt image 分支不写 videoPromptTranslation（不动视频翻译）', async () => {
    const projectRoot = path.join(root, 'projects')
    const optimizePrompt = vi.fn(async () => ({
      results: [{ optimized_prompt: '新画面词', strategy_used: 'llm', key_source: 'caller', cache_hit: false }],
    }))
    const aiGenerator = { generateWithDefault: vi.fn(async () => ({ content: '{"0":"x"}' })) }
    const service = new Story2VideoProjectService({
      store,
      projectsDir: projectRoot,
      aiGenerator,
      serviceBus: { optimizePrompt },
    })
    service._writeProjects([{
      projectId: 'project-image-no-video-trans', status: 'completed', options: {},
      segments: [{ id: 'segment-0', index: 0, text: '你好', prompt: '旧', videoPrompt: 'v', videoPromptTranslation: '旧视频译文' }],
    }])

    const updated = await service.regenerateScenePrompt('project-image-no-video-trans', 'segment-0', 'image')

    expect(updated.segments[0].videoPromptTranslation).toBe('旧视频译文')
    expect(updated.segments[0].promptTranslation).toBe(null)
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('updateSegments 不接收 videoPromptTranslation（只读字段，禁止前端写入）', async () => {
    const projectRoot = path.join(root, 'projects')
    const service = new Story2VideoProjectService({ store, projectsDir: projectRoot })
    service._writeProjects([{
      projectId: 'project-video-trans-ro', status: 'completed', options: {},
      segments: [{
        id: 'segment-0', index: 0, text: '你好', prompt: '旧', videoPrompt: '旧视频词',
        videoPromptTranslation: '后端译文',
      }],
    }])

    // 只改 text 不改 videoPrompt → 服务端译文保留；同时携带的伪造译文必须被丢弃
    const kept = service.updateSegments('project-video-trans-ro', [
      { id: 'segment-0', text: '你好改', videoPromptTranslation: '前端伪造' },
    ])
    expect(kept.segments[0].videoPrompt).toBe('旧视频词')
    expect(kept.segments[0].videoPromptTranslation).toBe('后端译文')

    // 改写 videoPrompt → 旧译文失效被清空（与「重新生成先清后写」同语义，2026-10-19 审查 i1）
    const changed = service.updateSegments('project-video-trans-ro', [
      { id: 'segment-0', videoPrompt: '新视频词', videoPromptTranslation: '前端伪造' },
    ])
    expect(changed.segments[0].videoPrompt).toBe('新视频词')
    expect(changed.segments[0].videoPromptTranslation).toBe(null)
  })

  it('saveRun 回填视频译文：recompose 路径保留、流水线新词路径清空（QM-6 i1 / 第九轮 i1 复核）', () => {
    const source = path.join(root, 'video-trans-source')
    const image = writeFile(path.join(source, 'image.png'))
    const audio = writeFile(path.join(source, 'audio.mp3'))
    const output = writeFile(path.join(source, 'output.mp4'))

    // 场景 A（recomposeProject 的真实形态）：compose 段落**不带** videoPrompt，
    // 落地值来自 fallback（= 项目自身分段，同一份 videoPrompt）⇒ 等值成立 ⇒ 译文保留。
    const sameService = new Story2VideoProjectService({ store, projectsDir: path.join(root, 'projects') })
    const same = sameService.saveRun({
      id: 'run_video_trans_same',
      pipeline: 'story2video-compose',
      status: 'completed',
      createdAt: '2026-10-19T00:00:00.000Z',
      params: { text: '第一段' },
      context: {
        generate_assets: {
          scenes: [{
            index: 0, text: '第一段', prompt: '画面', videoPrompt: '项目自身的视频词',
            videoPromptTranslation: '项目自身视频词的中文译文',
            imagePath: image, audioPath: audio,
          }],
        },
        compose: {
          videoPath: output,
          // recompose：_scenesForCompose 不回传 videoPrompt，落地值只能来自 fallback
          segments: [{
            index: 0, text: '第一段', prompt: '画面',
            imagePath: image, audioPath: audio, duration: 2,
          }],
        },
      },
    })
    expect(same.segments[0].videoPrompt).toBe('项目自身的视频词')
    expect(same.segments[0].videoPromptTranslation).toBe('项目自身视频词的中文译文')

    // 场景 B（流水线 saveRun 的真实形态，QM-6 第九轮 i1）：generate_assets 的 pairedScenes
    // 携带 optimizeVideoScenePrompts **刚优化的新词**（不带译文），fallback（项目既有分段）
    // 持旧词与旧译文。落地值 = 新词 ≠ fallbackVideoPrompt = 旧词 ⇒ 等值不成立 ⇒ 译文置空。
    // （原测试场景 B 构造的是「compose 自带不同 videoPrompt」，而 normalizeComposeScenes
    //  白名单根本不下发该字段——那个输入生产不可达，等值门拦不住它。）
    const changedService = new Story2VideoProjectService({ store, projectsDir: path.join(root, 'projects') })
    const changed = changedService.saveRun({
      id: 'run_video_trans_changed',
      pipeline: 'story2video-compose',
      status: 'completed',
      createdAt: '2026-10-19T00:00:00.000Z',
      params: { text: '第一段' },
      context: {
        generate_assets: {
          scenes: [{
            index: 0, text: '第一段', prompt: '画面', videoPrompt: '优化后的新视频词',
            imagePath: image, audioPath: audio,
          }],
        },
        compose: {
          videoPath: output,
          segments: [{
            index: 0, text: '第一段', prompt: '画面',
            imagePath: image, audioPath: audio, duration: 2,
          }],
        },
      },
    })
    expect(changed.segments[0].videoPrompt).toBe('优化后的新视频词')
    expect(changed.segments[0].videoPromptTranslation).toBe(null)
  })
})
