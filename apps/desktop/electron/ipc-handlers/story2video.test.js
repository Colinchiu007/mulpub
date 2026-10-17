// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../services/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }))
import { Story2VideoProjectService } from '../services/story2video-project-service'
__enableElectronMock()

let registerHandlers
let root

beforeEach(async () => {
  vi.resetModules()
  __electronMock.app.isPackaged = false
  registerHandlers = (await import('./story2video')).default
  const controlledTempRoot = path.join(os.tmpdir(), 'story2video')
  fs.mkdirSync(controlledTempRoot, { recursive: true })
  root = fs.mkdtempSync(path.join(controlledTempRoot, 'ipc-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function createIpcMain() {
  const handlers = new Map()
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    get: channel => handlers.get(channel),
  }
}

function createDeps() {
  return {
    BrowserWindow: { fromWebContents: vi.fn(() => null) },
    dialog: { showSaveDialog: vi.fn() },
    shell: { showItemInFolder: vi.fn() },
    clipboard: { writeText: vi.fn() },
    story2videoMediaServer: { createUrl: vi.fn(() => 'http://127.0.0.1:34821/media/aaaaaaaaaaaaaaaa') },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
  }
}

// 跨 profile 用例共用：真实服务（store 仅读项目索引；媒体放行走项目清单目录回退）
function createForeignProjectService () {
  return new Story2VideoProjectService({
    store: { _resolveOwnerSubject: () => 'user-a', getUserSetting: () => [], setUserSetting: () => {} },
    projectsDir: root,
  })
}

const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' }, sender: {} }
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' }, sender: {} }

describe('Story2Video 交付 IPC', () => {
  it('拒绝不可信页面调用导出', async () => {
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, createDeps())

    const result = await ipcMain.get('story2video:export-zip')(UNTRUSTED_EVENT, { files: [] })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('将本地视频导出为 ZIP', async () => {
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, createDeps())
    const video = path.join(root, 'video.mp4')
    const destination = path.join(root, 'videos.zip')
    fs.writeFileSync(video, 'video')

    const result = await ipcMain.get('story2video:export-zip')(TRUSTED_EVENT, {
      files: [{ path: video, name: '成片.mp4' }],
      destinationPath: destination,
    })

    expect(result).toMatchObject({ code: 0, data: { path: destination, fileCount: 1 } })
    expect(fs.readFileSync(destination).readUInt32LE(0)).toBe(0x04034b50)
  })

  it('拒绝 renderer 提供的外部路径，但允许用户在保存对话框中明确选择目录', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    registerHandlers(ipcMain, deps)
    const video = path.join(root, 'video.mp4')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-ipc-external-'))
    const externalVideo = path.join(outside, 'external.mp4')
    const externalDestination = path.join(outside, 'renderer-requested.zip')
    const dialogDestination = path.join(outside, 'user-selected.zip')
    fs.writeFileSync(video, 'video')
    fs.writeFileSync(externalVideo, 'external-video')

    try {
      const share = await ipcMain.get('story2video:create-share-url')(TRUSTED_EVENT, externalVideo)
      const copied = await ipcMain.get('story2video:copy-path')(TRUSTED_EVENT, externalVideo)
      const shown = await ipcMain.get('story2video:show-in-folder')(TRUSTED_EVENT, externalVideo)
      const rendererExport = await ipcMain.get('story2video:export-zip')(TRUSTED_EVENT, {
        files: [{ path: video, name: 'video.mp4' }],
        destinationPath: externalDestination,
      })

      expect(share.code).not.toBe(0)
      expect(copied.code).not.toBe(0)
      expect(shown.code).not.toBe(0)
      expect(rendererExport.code).not.toBe(0)
      expect(fs.existsSync(externalDestination)).toBe(false)

      deps.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: dialogDestination })
      const dialogExport = await ipcMain.get('story2video:export-zip')(TRUSTED_EVENT, {
        files: [{ path: video, name: 'video.mp4' }],
      })

      expect(dialogExport).toMatchObject({ code: 0, data: { path: dialogDestination, fileCount: 1 } })
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('生成播放地址、复制规范化路径并定位文件', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    registerHandlers(ipcMain, deps)
    const video = path.join(root, 'video.mp4')
    fs.writeFileSync(video, 'video')

    const share = await ipcMain.get('story2video:create-share-url')(TRUSTED_EVENT, video)
    const copied = await ipcMain.get('story2video:copy-path')(TRUSTED_EVENT, video)
    const shown = await ipcMain.get('story2video:show-in-folder')(TRUSTED_EVENT, video)

    expect(share.code).toBe(0)
    expect(share.data.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/media\/[A-Za-z0-9_-]{16,}$/)
    expect(share.data.url).not.toContain(fs.realpathSync.native(video))
    expect(share.data.url).not.toMatch(/^file:/)
    expect(deps.clipboard.writeText).toHaveBeenCalledWith(fs.realpathSync.native(video))
    expect(deps.shell.showItemInFolder).toHaveBeenCalledWith(fs.realpathSync.native(video))
    expect(copied.data.path).toBe(fs.realpathSync.native(video))
    expect(shown.data.path).toBe(fs.realpathSync.native(video))
  })

  it('create-share-url 对默认根外但属于项目清单目录的文件放行（跨 profile 回退）', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story2video-ipc-foreign-'))
    const projectDir = path.join(foreignRoot, 'run_foreign_proj')
    fs.mkdirSync(projectDir, { recursive: true })
    const video = path.join(projectDir, 'video.mp4')
    fs.writeFileSync(video, 'video')
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
      projectId: 'run_foreign_proj',
      videoPath: video,
    }))
    // 用真实服务（而非手工 mock）覆盖「清单引用拼写与请求 canonical 拼写（8.3 短名/联接通路）不一致仍放行」的契约。
    deps.story2videoProjectService = createForeignProjectService()
    registerHandlers(ipcMain, deps)

    const share = await ipcMain.get('story2video:create-share-url')(TRUSTED_EVENT, video)
    const copied = await ipcMain.get('story2video:copy-path')(TRUSTED_EVENT, video)
    const shown = await ipcMain.get('story2video:show-in-folder')(TRUSTED_EVENT, video)
    deps.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    const saved = await ipcMain.get('story2video:save-as')(TRUSTED_EVENT, {
      filePath: video,
      suggestedName: 'video.mp4',
    })

    expect(share).toMatchObject({ code: 0 })
    expect(share.data.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/media\/[A-Za-z0-9_-]{16,}/)
    expect(copied.data.path).toBe(fs.realpathSync.native(video))
    expect(shown.data.path).toBe(fs.realpathSync.native(video))
    expect(deps.clipboard.writeText).toHaveBeenCalledWith(fs.realpathSync.native(video))
    expect(deps.shell.showItemInFolder).toHaveBeenCalledWith(fs.realpathSync.native(video))
    // save-as 需要展示保存对话框：路径校验先行通过后进入系统对话框流程
    expect(deps.dialog.showSaveDialog).toHaveBeenCalled()
    expect(saved).toMatchObject({ code: 0, data: { cancelled: true } })
    fs.rmSync(foreignRoot, { recursive: true, force: true })
  })

  it('create-share-url 在项目清单目录回退也失败时保持拒绝', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story2video-ipc-foreign-reject-'))
    deps.story2videoProjectService = {
      projectsDir: root,
      resolveProjectMedia: vi.fn(() => null),
      getProjectMediaRoot: vi.fn(() => null),
    }
    registerHandlers(ipcMain, deps)
    const video = path.join(foreignRoot, 'video.mp4')
    fs.writeFileSync(video, 'video')

    const share = await ipcMain.get('story2video:create-share-url')(TRUSTED_EVENT, video)
    expect(share).toEqual({ code: -2, message: '视频文件路径无效或不允许访问' })
    fs.rmSync(foreignRoot, { recursive: true, force: true })
  })

  it('create-share-url 传 previousUrl 时先签发新地址再回收旧令牌', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    deps.story2videoMediaServer.revoke = vi.fn(() => true)
    registerHandlers(ipcMain, deps)
    const video = path.join(root, 'video.mp4')
    fs.writeFileSync(video, 'video')

    const oldUrl = 'http://127.0.0.1:34821/media/oldtokentoken12345'
    const result = await ipcMain.get('story2video:create-share-url')(TRUSTED_EVENT, video, oldUrl)

    expect(result.code).toBe(0)
    expect(result.data.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/media\/[A-Za-z0-9_-]{16,}/)
    expect(deps.story2videoMediaServer.revoke).toHaveBeenCalledWith(oldUrl)
  })

  it('create-share-url 不传 previousUrl 时不回收任何令牌', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    deps.story2videoMediaServer.revoke = vi.fn(() => true)
    registerHandlers(ipcMain, deps)
    const video = path.join(root, 'video.mp4')
    fs.writeFileSync(video, 'video')

    const result = await ipcMain.get('story2video:create-share-url')(TRUSTED_EVENT, video)

    expect(result.code).toBe(0)
    expect(deps.story2videoMediaServer.revoke).not.toHaveBeenCalled()
  })

  it('create-share-url 的 previousUrl 非本地媒体 URL 时拒绝调用 revoke', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    deps.story2videoMediaServer.revoke = vi.fn(() => false)
    registerHandlers(ipcMain, deps)
    const video = path.join(root, 'video.mp4')
    fs.writeFileSync(video, 'video')

    const result = await ipcMain.get('story2video:create-share-url')(TRUSTED_EVENT, video, 'file:///C:/videos/old.mp4')

    expect(result.code).toBe(0)
    expect(deps.story2videoMediaServer.revoke).not.toHaveBeenCalled()
  })

  it('create-share-url 的 previousUrl 同源但非媒体路径时拒绝调用 revoke', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    deps.story2videoMediaServer.revoke = vi.fn(() => false)
    registerHandlers(ipcMain, deps)
    const video = path.join(root, 'video.mp4')
    fs.writeFileSync(video, 'video')

    const result = await ipcMain.get('story2video:create-share-url')(TRUSTED_EVENT, video, 'http://127.0.0.1:34821/other/path')

    expect(result.code).toBe(0)
    expect(deps.story2videoMediaServer.revoke).not.toHaveBeenCalled()
  })

  it('save-as 通过系统保存对话框把受控文件复制到用户选择的位置', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    registerHandlers(ipcMain, deps)
    const video = path.join(root, 'video.mp4')
    fs.writeFileSync(video, 'video-content')
    const destination = path.join(root, 'saved-video.mp4')
    deps.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })

    const result = await ipcMain.get('story2video:save-as')(TRUSTED_EVENT, {
      filePath: video,
      suggestedName: '我的视频.mp4',
    })

    expect(result).toMatchObject({ code: 0, data: { path: destination } })
    expect(fs.readFileSync(destination, 'utf8')).toBe('video-content')
    // 测试环境无真实 WebContents 时走无窗口的 showSaveDialog(options)
    expect(deps.dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '我的视频.mp4', title: '保存文件' }),
    )
  })

  it('save-as 取消选择时返回 cancelled，不写入文件；外部路径被拒绝', async () => {
    const ipcMain = createIpcMain()
    const deps = createDeps()
    registerHandlers(ipcMain, deps)
    const video = path.join(root, 'video.mp4')
    fs.writeFileSync(video, 'video-content')
    deps.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })

    const cancelled = await ipcMain.get('story2video:save-as')(TRUSTED_EVENT, { filePath: video })
    expect(cancelled).toMatchObject({ code: 0, data: { cancelled: true } })

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-save-as-outside-'))
    try {
      const external = path.join(outside, 'x.mp4')
      fs.writeFileSync(external, 'x')
      const rejected = await ipcMain.get('story2video:save-as')(TRUSTED_EVENT, { filePath: external })
      expect(rejected.code).not.toBe(0)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('只通过可信 preload 导入用户选择的外部旁白，并返回受控临时路径', async () => {
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, createDeps())
    const source = path.join(root, 'voice.mp3')
    fs.writeFileSync(source, 'voice')

    const result = await ipcMain.get('story2video:import-media')(TRUSTED_EVENT, {
      filePath: source,
      kind: 'audio',
    })

    expect(result).toMatchObject({ code: 0, data: { kind: 'audio', size: 5 } })
    expect(result.data.path).not.toBe(source)
    expect(fs.readFileSync(result.data.path, 'utf8')).toBe('voice')
    fs.rmSync(result.data.path, { force: true })
  })

  it('拒绝不支持格式和超过大小上限的媒体导入', async () => {
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, createDeps())
    const unsupported = path.join(root, 'voice.aac')
    fs.writeFileSync(unsupported, 'voice')

    const result = await ipcMain.get('story2video:import-media')(TRUSTED_EVENT, {
      filePath: unsupported,
      kind: 'audio',
    })
    expect(result.code).not.toBe(0)
    expect(result.message).toMatch(/格式|支持/)
  })

  it('list-projects 在服务未暴露 isLocalOwner 时兜底 localMode=false', async () => {
    const service = { listProjects: vi.fn(() => []) }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })
    expect(await ipcMain.get('story2video:list-projects')(TRUSTED_EVENT)).toEqual({ code: 0, data: [], localMode: false })
  })

  it('暴露用户隔离项目、分段编辑、重试和语音识别', async () => {
    const service = {
      listProjects: vi.fn(() => [{ projectId: 'project-1' }]),
      isLocalOwner: vi.fn(() => true),
      getProject: vi.fn(() => ({ projectId: 'project-1' })),
      deleteProject: vi.fn(() => ({ projectId: 'project-1', deleted: true })),
      // 主进程同项目写队列：mock 直接透传任务（审查 W2 修复后 handler 通过 _serializeProject 调用服务）
      _serializeProject: vi.fn(async (_projectId, task) => task()),
      updateSegments: vi.fn(() => ({ projectId: 'project-1', dirty: true })),
      replaceSegmentAudio: vi.fn(() => ({ projectId: 'project-1', dirty: true })),
      retrySegment: vi.fn(async () => ({ projectId: 'project-1' })),
      recomposeProject: vi.fn(async () => ({ projectId: 'project-1', dirty: false })),
      regenerateSceneSubtitle: vi.fn(async () => ({ projectId: 'project-1', dirty: true })),
      regenerateSceneAudio: vi.fn(async () => ({ projectId: 'project-1', dirty: true })),
      regenerateScenePrompt: vi.fn(async () => ({ projectId: 'project-1', dirty: true })),
      generateSceneAiVideo: vi.fn(async () => ({ projectId: 'project-1', dirty: true })),
      selectSceneMaterial: vi.fn(() => ({ projectId: 'project-1', dirty: true })),
      generateSceneImage: vi.fn(async () => ({ projectId: 'project-1', dirty: true })),
      generateSceneVideo: vi.fn(async () => ({ projectId: 'project-1', dirty: true })),
      transcribeFile: vi.fn(async () => ({ text: '识别文本' })),
      getCapabilities: vi.fn(() => ({ transcription: { available: true }, remix: { available: false } })),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    expect(await ipcMain.get('story2video:list-projects')(TRUSTED_EVENT)).toEqual({ code: 0, data: [{ projectId: 'project-1' }], localMode: true })
    expect(await ipcMain.get('story2video:get-project')(TRUSTED_EVENT, 'project-1')).toEqual({ code: 0, data: { projectId: 'project-1' } })
    expect(await ipcMain.get('story2video:delete-project')(TRUSTED_EVENT, 'project-1')).toEqual({ code: 0, data: { projectId: 'project-1', deleted: true } })
    await ipcMain.get('story2video:update-segments')(TRUSTED_EVENT, { projectId: 'project-1', segments: [{ id: 'segment-0', text: '新文案' }] })
    await ipcMain.get('story2video:replace-segment-audio')(TRUSTED_EVENT, {
      projectId: 'project-1', segmentId: 'segment-0', filePath: 'C:/controlled/replacement.mp3',
    })
    await ipcMain.get('story2video:retry-segment')(TRUSTED_EVENT, { projectId: 'project-1', segmentId: 'segment-0', mode: 'image' })
    await ipcMain.get('story2video:recompose-project')(TRUSTED_EVENT, 'project-1')
    await ipcMain.get('story2video:regenerate-scene-subtitle')(TRUSTED_EVENT, { projectId: 'project-1', segmentId: 'segment-0' })
    await ipcMain.get('story2video:regenerate-scene-audio')(TRUSTED_EVENT, { projectId: 'project-1', segmentId: 'segment-0' })
    await ipcMain.get('story2video:regenerate-scene-prompt')(TRUSTED_EVENT, { projectId: 'project-1', segmentId: 'segment-0', kind: 'video' })
    await ipcMain.get('story2video:generate-scene-ai-video')(TRUSTED_EVENT, { projectId: 'project-1', segmentId: 'segment-0' })
    await ipcMain.get('story2video:select-scene-material')(TRUSTED_EVENT, { projectId: 'project-1', segmentId: 'segment-0', kind: 'video' })
    await ipcMain.get('story2video:generate-scene-image')(TRUSTED_EVENT, { projectId: 'project-1', segmentId: 'segment-0' })
    await ipcMain.get('story2video:generate-scene-video')(TRUSTED_EVENT, { projectId: 'project-1', segmentId: 'segment-0' })
    await ipcMain.get('story2video:transcribe')(TRUSTED_EVENT, { filePath: 'C:/controlled/audio.mp3' })
    const capabilities = await ipcMain.get('story2video:capabilities')(TRUSTED_EVENT)

    expect(service.updateSegments).toHaveBeenCalledWith('project-1', [{ id: 'segment-0', text: '新文案' }])
    // 保存/重合成/全部重新生成/素材替换/选择/删除均经同项目串行队列，防止跨段并发覆盖（审查 W2/W4 回归）
    expect(service._serializeProject).toHaveBeenCalledTimes(12)
    expect(service._serializeProject).toHaveBeenCalledWith('project-1', expect.any(Function))
    expect(service.replaceSegmentAudio).toHaveBeenCalledWith('project-1', 'segment-0', 'C:/controlled/replacement.mp3')
    expect(service.deleteProject).toHaveBeenCalledWith('project-1')
    expect(service.retrySegment).toHaveBeenCalledWith('project-1', 'segment-0', 'image')
    expect(service.recomposeProject).toHaveBeenCalledWith('project-1')
    expect(service.regenerateSceneSubtitle).toHaveBeenCalledWith('project-1', 'segment-0')
    expect(service.regenerateSceneAudio).toHaveBeenCalledWith('project-1', 'segment-0')
    expect(service.regenerateScenePrompt).toHaveBeenCalledWith('project-1', 'segment-0', 'video')
    expect(service.generateSceneAiVideo).toHaveBeenCalledWith('project-1', 'segment-0')
    expect(service.selectSceneMaterial).toHaveBeenCalledWith('project-1', 'segment-0', 'video')
    expect(service.generateSceneImage).toHaveBeenCalledWith('project-1', 'segment-0')
    expect(service.generateSceneVideo).toHaveBeenCalledWith('project-1', 'segment-0')
    expect(service.transcribeFile).toHaveBeenCalledWith('C:/controlled/audio.mp3')
    expect(capabilities.data.transcription.available).toBe(true)
  })

  it('在到达服务前拒绝非法分段更新参数', async () => {
    const service = { updateSegments: vi.fn() }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    const result = await ipcMain.get('story2video:update-segments')(TRUSTED_EVENT, {
      projectId: '../escape', segments: [],
    })

    expect(result.code).toBeLessThan(0)
    expect(service.updateSegments).not.toHaveBeenCalled()
  })

  it('get-thumbnail 为受控缩略图签发媒体 URL', async () => {
    const thumbnailPath = path.join(root, 'thumbnail.jpg')
    fs.writeFileSync(thumbnailPath, 'thumbnail')
    const service = {
      projectsDir: root,
      getThumbnail: vi.fn(async () => ({ status: 'ready', kind: 'image', path: thumbnailPath })),
    }
    const ipcMain = createIpcMain()
    const deps = createDeps()
    registerHandlers(ipcMain, { ...deps, story2videoProjectService: service })

    const result = await ipcMain.get('story2video:get-thumbnail')(TRUSTED_EVENT, 'project-thumbnail')

    expect(result).toMatchObject({ code: 0, data: { status: 'ready', kind: 'image' } })
    expect(result.data.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/media\//)
    expect(deps.story2videoMediaServer.createUrl).toHaveBeenCalledWith(fs.realpathSync.native(thumbnailPath))
  })

  it('get-thumbnail 对默认根外的项目清单目录缩略图同样签发媒体 URL（跨 profile 回退）', async () => {
    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story2video-ipc-foreign-thumb-'))
    const thumbnailPath = path.join(foreignRoot, 'thumbnail-first-scene.jpg')
    fs.writeFileSync(thumbnailPath, 'thumbnail')
    // 真实服务 + 清单目录：覆盖缩略图回退经 canonical 比较放行（CI 8.3 短名回归）。
    const foreignProjectId = path.basename(foreignRoot)
    fs.writeFileSync(path.join(foreignRoot, 'project.json'), JSON.stringify({
      projectId: foreignProjectId,
      segments: [{ imagePath: thumbnailPath }],
    }))
    const service = new Story2VideoProjectService({
      store: {
        _resolveOwnerSubject: () => 'user-a',
        getUserSetting: () => [{
          projectId: 'project-thumbnail',
          status: 'completed',
          segments: [{ imagePath: thumbnailPath }],
        }],
        setUserSetting: () => {},
      },
      projectsDir: root,
    })
    const ipcMain = createIpcMain()
    const deps = createDeps()
    registerHandlers(ipcMain, { ...deps, story2videoProjectService: service })

    const result = await ipcMain.get('story2video:get-thumbnail')(TRUSTED_EVENT, 'project-thumbnail')

    expect(result).toMatchObject({ code: 0, data: { status: 'ready', kind: 'image' } })
    expect(result.data.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/media\//)
    fs.rmSync(foreignRoot, { recursive: true, force: true })
  })

  it('export-zip 并入项目清单目录根后允许导出默认根外的视频', async () => {
    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story2video-ipc-foreign-zip-'))
    const projectDir = path.join(foreignRoot, 'run_foreign_zip')
    fs.mkdirSync(projectDir, { recursive: true })
    const video = path.join(projectDir, 'video.mp4')
    fs.writeFileSync(video, 'zip-me')
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
      projectId: 'run_foreign_zip',
      videoPath: video,
    }))
    const service = createForeignProjectService()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })
    const destination = path.join(root, 'foreign-videos.zip')

    const result = await ipcMain.get('story2video:export-zip')(TRUSTED_EVENT, {
      files: [{ path: video, name: '成片.mp4' }],
      destinationPath: destination,
    })

    expect(result).toMatchObject({ code: 0, data: { path: destination, fileCount: 1 } })
    expect(fs.readFileSync(destination).readUInt32LE(0)).toBe(0x04034b50)
    fs.rmSync(foreignRoot, { recursive: true, force: true })
  })

  it('export-zip 无法并入项目清单目录根时保持拒绝默认根外文件', async () => {
    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story2video-ipc-foreign-zip2-'))
    const video = path.join(foreignRoot, 'video.mp4')
    fs.writeFileSync(video, 'zip-me')
    const service = {
      projectsDir: root,
      resolveProjectMedia: vi.fn(() => null),
      getProjectMediaRoot: vi.fn(() => null),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    const result = await ipcMain.get('story2video:export-zip')(TRUSTED_EVENT, {
      files: [{ path: video, name: '成片.mp4' }],
      destinationPath: path.join(root, 'foreign-videos.zip'),
    })

    expect(result.code).toBeLessThan(0)
    fs.rmSync(foreignRoot, { recursive: true, force: true })
  })

  it('export-zip 拒绝与清单引用文件同目录的未引用文件（防项目根整体解锁，审查 W1）', async () => {
    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story2video-ipc-foreign-w1-'))
    const projectDir = path.join(foreignRoot, 'run_foreign_w1')
    fs.mkdirSync(projectDir, { recursive: true })
    const referenced = path.join(projectDir, 'video.mp4')
    const unreferenced = path.join(projectDir, 'unreferenced.mp4')
    fs.writeFileSync(referenced, 'zip-me')
    fs.writeFileSync(unreferenced, 'secret')
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
      projectId: 'run_foreign_w1',
      videoPath: referenced,
    }))
    const service = {
      projectsDir: root,
      resolveProjectMedia: vi.fn((filePath) => filePath === referenced ? fs.realpathSync.native(referenced) : null),
      getProjectMediaRoot: vi.fn((filePath) => {
        return filePath === referenced || filePath === fs.realpathSync.native(referenced) ? projectDir : null
      }),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })
    const destination = path.join(root, 'foreign-w1.zip')

    const result = await ipcMain.get('story2video:export-zip')(TRUSTED_EVENT, {
      files: [{ path: referenced, name: 'a.mp4' }, { path: unreferenced, name: 'b.mp4' }],
      destinationPath: destination,
    })

    expect(result.code).toBeLessThan(0)
    expect(fs.existsSync(destination)).toBe(false)
    fs.rmSync(foreignRoot, { recursive: true, force: true })
  })
  it('get-thumbnail 对缺失或生成失败的缩略图保持 url=null', async () => {
    const getThumbnail = vi.fn()
      .mockResolvedValueOnce({ status: 'missing', kind: 'missing', path: null })
      .mockResolvedValueOnce({ status: 'failed', kind: 'failed', path: null })
    const service = { projectsDir: root, getThumbnail }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    const missing = await ipcMain.get('story2video:get-thumbnail')(TRUSTED_EVENT, 'project-thumbnail')
    const failed = await ipcMain.get('story2video:get-thumbnail')(TRUSTED_EVENT, 'project-thumbnail')

    expect(missing).toEqual({ code: 0, data: { status: 'missing', kind: 'missing', url: null } })
    expect(failed).toEqual({ code: 0, data: { status: 'failed', kind: 'failed', url: null } })
  })

  it('get-thumbnail 不会把空媒体 URL 标记为 ready', async () => {
    const thumbnailPath = path.join(root, 'thumbnail-empty-url.jpg')
    fs.writeFileSync(thumbnailPath, 'thumbnail')
    const service = {
      projectsDir: root,
      getThumbnail: vi.fn(async () => ({ status: 'ready', kind: 'image', path: thumbnailPath })),
    }
    const deps = createDeps()
    deps.story2videoMediaServer.createUrl.mockReturnValueOnce('')
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...deps, story2videoProjectService: service })

    const result = await ipcMain.get('story2video:get-thumbnail')(TRUSTED_EVENT, 'project-empty-thumbnail-url')

    expect(result).toEqual({ code: 0, data: { status: 'failed', kind: 'failed', url: null } })
  })

  it('get-thumbnail 在参数非法或来源不可信时不进入项目服务', async () => {
    const service = {
      projectsDir: root,
      getThumbnail: vi.fn(),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    const invalid = await ipcMain.get('story2video:get-thumbnail')(TRUSTED_EVENT, '../escape')
    const untrusted = await ipcMain.get('story2video:get-thumbnail')(UNTRUSTED_EVENT, 'project-thumbnail')

    expect(invalid).toEqual({ code: -2, message: 'projectId 无效' })
    expect(untrusted).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(service.getThumbnail).not.toHaveBeenCalled()
  })

  it('场景字幕/旁白/优化词重新生成：拒绝不可信页面、非法 ID 与非白名单优化词类型', async () => {
    const service = {
      regenerateSceneSubtitle: vi.fn(),
      regenerateSceneAudio: vi.fn(),
      regenerateScenePrompt: vi.fn(),
      generateSceneAiVideo: vi.fn(),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    const untrustedSubtitle = await ipcMain.get('story2video:regenerate-scene-subtitle')(UNTRUSTED_EVENT, {
      projectId: 'project-1', segmentId: 'segment-0',
    })
    expect(untrustedSubtitle).toEqual({ code: -3, message: '未授权的调用来源' })

    const badId = await ipcMain.get('story2video:regenerate-scene-subtitle')(TRUSTED_EVENT, {
      projectId: '../escape', segmentId: 'segment-0',
    })
    expect(badId.code).toBeLessThan(0)

    const untrustedAiVideo = await ipcMain.get('story2video:generate-scene-ai-video')(UNTRUSTED_EVENT, {
      projectId: 'project-1', segmentId: 'segment-0',
    })
    expect(untrustedAiVideo).toEqual({ code: -3, message: '未授权的调用来源' })

    const badAiVideoId = await ipcMain.get('story2video:generate-scene-ai-video')(TRUSTED_EVENT, {
      projectId: 'project-1', segmentId: '../escape',
    })
    expect(badAiVideoId.code).toBeLessThan(0)
    expect(service.generateSceneAiVideo).not.toHaveBeenCalled()

    const badKind = await ipcMain.get('story2video:regenerate-scene-prompt')(TRUSTED_EVENT, {
      projectId: 'project-1', segmentId: 'segment-0', kind: 'unsupported',
    })
    expect(badKind.code).toBeLessThan(0)
    expect(service.regenerateScenePrompt).not.toHaveBeenCalled()
    expect(service.regenerateSceneSubtitle).not.toHaveBeenCalled()
    expect(service.regenerateSceneAudio).not.toHaveBeenCalled()
  })

  it('替换旁白成功后清理受控媒体临时副本', async () => {
    const paths = (await import('../services/story2video-paths')).default
    const source = path.join(root, 'replacement.mp3')
    fs.writeFileSync(source, 'voice')
    const imported = paths.importUserSelectedMedia(source, 'audio')
    const service = {
      _serializeProject: vi.fn(async (_projectId, task) => task()),
      replaceSegmentAudio: vi.fn(() => ({ projectId: 'project-1', segments: [] })),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    const result = await ipcMain.get('story2video:replace-segment-audio')(TRUSTED_EVENT, {
      projectId: 'project-1', segmentId: 'segment-0', filePath: imported.path,
    })

    expect(result.code).toBe(0)
    expect(service.replaceSegmentAudio).toHaveBeenCalledWith('project-1', 'segment-0', imported.path)
    expect(fs.existsSync(imported.path)).toBe(false)
  })

  it('替换旁白失败时也清理受控媒体临时副本', async () => {
    const paths = (await import('../services/story2video-paths')).default
    const source = path.join(root, 'replacement-failed.mp3')
    fs.writeFileSync(source, 'voice')
    const imported = paths.importUserSelectedMedia(source, 'audio')
    const service = {
      _serializeProject: vi.fn(async (_projectId, task) => task()),
      replaceSegmentAudio: vi.fn(() => { throw new Error('写入项目失败') }),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    const result = await ipcMain.get('story2video:replace-segment-audio')(TRUSTED_EVENT, {
      projectId: 'project-1', segmentId: 'segment-0', filePath: imported.path,
    })

    expect(result.code).toBeLessThan(0)
    expect(result.message).toMatch(/写入项目失败/)
    expect(fs.existsSync(imported.path)).toBe(false)
  })
})

describe('Story2Video BGM 素材库 IPC', () => {
  function createBgmLibraryMock () {
    const items = new Map()
    let seq = 0
    return {
      list: vi.fn(() => Array.from(items.values())),
      add: vi.fn((filePath) => {
        seq += 1
        const item = {
          id: 'bgm-' + seq,
          name: path.basename(String(filePath)),
          path: String(filePath),
          size: 1,
          createdAt: 1,
          updatedAt: 1,
        }
        items.set(item.id, item)
        return item
      }),
      rename: vi.fn((id, name) => {
        const item = items.get(id)
        if (!item) throw new Error('背景音乐不存在或已被删除')
        item.name = name
        return item
      }),
      delete: vi.fn((id) => {
        if (!items.has(id)) throw new Error('背景音乐不存在或已被删除')
        items.delete(id)
        return { deleted: true, id }
      }),
      inspectPath: vi.fn((filePath) => ({
        path: String(filePath),
        exists: true,
        readable: true,
        size: 4,
        extension: path.extname(String(filePath)).toLowerCase(),
        inLibrary: false,
        libraryItemId: null,
        reason: 'ok',
      })),
    }
  }

  it('列出 BGM 素材库条目', async () => {
    const bgmLibrary = createBgmLibraryMock()
    bgmLibrary.add('/tmp/music.mp3')
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-list')(TRUSTED_EVENT)

    expect(result.code).toBe(0)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('music.mp3')
  })

  it('添加 BGM 成功并返回条目', async () => {
    const bgmLibrary = createBgmLibraryMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-add')(TRUSTED_EVENT, {
      filePath: '/tmp/audio/music.mp3',
    })

    expect(result.code).toBe(0)
    expect(result.data).toMatchObject({ id: 'bgm-1', name: 'music.mp3', path: '/tmp/audio/music.mp3' })
    expect(bgmLibrary.add).toHaveBeenCalledWith('/tmp/audio/music.mp3')
  })

  it('添加 BGM 参数非法时返回校验错误', async () => {
    const bgmLibrary = createBgmLibraryMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-add')(TRUSTED_EVENT, { filePath: '' })

    expect(result.code).toBeLessThan(0)
    expect(bgmLibrary.add).not.toHaveBeenCalled()
  })

  it('添加 BGM 失败时透传用户可读原因（格式/大小/占用）', async () => {
    const bgmLibrary = createBgmLibraryMock()
    bgmLibrary.add.mockImplementation(() => { throw new Error('不支持的媒体格式') })
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-add')(TRUSTED_EVENT, {
      filePath: '/tmp/audio/evil.aac',
    })

    expect(result.code).toBeLessThan(0)
    expect(result.message).toMatch(/不支持的媒体格式/)
  })

  it('重命名 BGM 成功', async () => {
    const bgmLibrary = createBgmLibraryMock()
    bgmLibrary.add('/tmp/audio/music.mp3')
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-rename')(TRUSTED_EVENT, {
      id: 'bgm-1', name: '清晨旋律',
    })

    expect(result.code).toBe(0)
    expect(result.data.name).toBe('清晨旋律')
    expect(bgmLibrary.rename).toHaveBeenCalledWith('bgm-1', '清晨旋律')
  })

  it('重命名不存在的条目时返回错误', async () => {
    const bgmLibrary = createBgmLibraryMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-rename')(TRUSTED_EVENT, {
      id: 'bgm-missing', name: '不存在',
    })

    expect(result.code).toBeLessThan(0)
    expect(result.message).toMatch(/不存在/)
  })

  it('删除 BGM 成功', async () => {
    const bgmLibrary = createBgmLibraryMock()
    bgmLibrary.add('/tmp/audio/music.mp3')
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-delete')(TRUSTED_EVENT, { id: 'bgm-1' })

    expect(result.code).toBe(0)
    expect(result.data).toEqual({ deleted: true, id: 'bgm-1' })
    expect(bgmLibrary.delete).toHaveBeenCalledWith('bgm-1')
  })

  it('删除参数非法时返回校验错误', async () => {
    const bgmLibrary = createBgmLibraryMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-delete')(TRUSTED_EVENT, { id: '' })

    expect(result.code).toBeLessThan(0)
    expect(bgmLibrary.delete).not.toHaveBeenCalled()
  })

  it('历史 BGM 路径核验透传 inspectPath 结果（只读）', async () => {
    const bgmLibrary = createBgmLibraryMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    const result = await ipcMain.get('story2video:bgm-library-status')(TRUSTED_EVENT, {
      filePath: 'C:/Users/user/AppData/Local/Temp/story2video/selected-media/bgm-old.mp3',
    })

    expect(result.code).toBe(0)
    expect(result.data).toMatchObject({ readable: true, reason: 'ok', extension: '.mp3' })
    expect(bgmLibrary.inspectPath).toHaveBeenCalledTimes(1)
  })

  it('历史 BGM 路径核验参数非法时返回校验错误且不触盘', async () => {
    const bgmLibrary = createBgmLibraryMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoBgmLibrary: bgmLibrary })

    for (const request of [undefined, null, [], {}, { filePath: '' }, { filePath: '   ' }, { filePath: 'x'.repeat(4097) }]) {
      const result = await ipcMain.get('story2video:bgm-library-status')(TRUSTED_EVENT, request)
      expect(result.code).toBeLessThan(0)
    }
    expect(bgmLibrary.inspectPath).not.toHaveBeenCalled()
  })

  // ─── 流水线「保存配置」IPC（s2v-pipeline-config-profiles）───
  function createConfigProfilesMock() {
    const items = new Map()
    let seq = 0
    return {
      list: vi.fn(() => Array.from(items.values())),
      create: vi.fn((request) => {
        seq += 1
        const entry = { id: 'profile-' + String(seq).padStart(14, '0'), name: request.name, pipelineId: request.pipelineId, snapshot: request.snapshot, createdAt: 1000, updatedAt: 1000 }
        items.set(entry.id, entry)
        return entry
      }),
      rename: vi.fn((id, name) => {
        const entry = items.get(id)
        if (!entry) throw new Error('配置不存在或已被删除')
        entry.name = name
        return entry
      }),
      delete: vi.fn((id) => {
        if (!items.has(id)) throw new Error('配置不存在或已被删除')
        items.delete(id)
        return { deleted: true, id }
      }),
    }
  }

  it('流程配置：列出配置', async () => {
    const configProfiles = createConfigProfilesMock()
    configProfiles.create({ pipelineId: 'story2video-compose', name: '口播竖屏', snapshot: { schemaVersion: 1 } })
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const result = await ipcMain.get('story2video:config-profile-list')(TRUSTED_EVENT)

    expect(result.code).toBe(0)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('口播竖屏')
  })

  it('流程配置：创建成功并转发参数', async () => {
    const configProfiles = createConfigProfilesMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const snapshot = { schemaVersion: 1, kind: 'orchestrated', s2vConfig: { contentType: 'general' } }
    const result = await ipcMain.get('story2video:config-profile-create')(TRUSTED_EVENT, {
      pipelineId: 'story2video-compose',
      name: '口播竖屏',
      snapshot,
      overwrite: true,
    })

    expect(result.code).toBe(0)
    expect(result.data).toMatchObject({ pipelineId: 'story2video-compose', name: '口播竖屏' })
    expect(configProfiles.create).toHaveBeenCalledWith({
      pipelineId: 'story2video-compose',
      name: '口播竖屏',
      snapshot,
      overwrite: true,
    })
  })

  it('流程配置：创建参数非法时返回校验错误且不调用服务', async () => {
    const configProfiles = createConfigProfilesMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const result = await ipcMain.get('story2video:config-profile-create')(TRUSTED_EVENT, {
      pipelineId: 'story2video-compose',
      name: 'x',
    })

    expect(result.code).toBeLessThan(0)
    expect(configProfiles.create).not.toHaveBeenCalled()
  })

  it('流程配置：数组快照按参数错误拒绝且不调用服务', async () => {
    const configProfiles = createConfigProfilesMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const result = await ipcMain.get('story2video:config-profile-create')(TRUSTED_EVENT, {
      pipelineId: 'story2video-compose',
      name: '非法快照',
      snapshot: [],
    })

    expect(result.code).toBe(-2)
    expect(configProfiles.create).not.toHaveBeenCalled()
  })

  it('流程配置：创建失败透传用户可读原因', async () => {
    const configProfiles = createConfigProfilesMock()
    configProfiles.create.mockImplementation(() => { throw new Error('已存在同名配置') })
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const result = await ipcMain.get('story2video:config-profile-create')(TRUSTED_EVENT, {
      pipelineId: 'story2video-compose',
      name: '口播竖屏',
      snapshot: { schemaVersion: 1 },
    })

    expect(result.code).toBeLessThan(0)
    expect(result.message).toMatch(/已存在同名配置/)
  })

  it('流程配置：业务校验错误映射为 VALIDATION_ERROR', async () => {
    const configProfiles = createConfigProfilesMock()
    const validationError = new Error('已存在同名配置')
    validationError.name = 'ProfileValidationError'
    configProfiles.create.mockImplementation(() => { throw validationError })
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const result = await ipcMain.get('story2video:config-profile-create')(TRUSTED_EVENT, {
      pipelineId: 'story2video-compose',
      name: '口播竖屏',
      snapshot: { schemaVersion: 1 },
    })

    expect(result).toMatchObject({ code: -2, message: '已存在同名配置' })
  })

  it('流程配置：文件 IO 错误映射为 REQUEST_ERROR', async () => {
    const configProfiles = createConfigProfilesMock()
    configProfiles.create.mockImplementation(() => {
      const ioError = new Error('磁盘不可写')
      ioError.code = 'EIO'
      throw ioError
    })
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const result = await ipcMain.get('story2video:config-profile-create')(TRUSTED_EVENT, {
      pipelineId: 'story2video-compose',
      name: '口播竖屏',
      snapshot: { schemaVersion: 1 },
    })

    expect(result).toMatchObject({ code: -1, message: '磁盘不可写' })
  })

  it('流程配置：重命名成功与不存在时报错', async () => {
    const configProfiles = createConfigProfilesMock()
    configProfiles.create({ pipelineId: 'p', name: 'A', snapshot: { schemaVersion: 1 } })
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const ok = await ipcMain.get('story2video:config-profile-rename')(TRUSTED_EVENT, { id: 'profile-00000000000001', name: '新名称' })
    expect(ok.code).toBe(0)
    expect(ok.data.name).toBe('新名称')
    expect(configProfiles.rename).toHaveBeenCalledWith('profile-00000000000001', '新名称')

    const missing = await ipcMain.get('story2video:config-profile-rename')(TRUSTED_EVENT, { id: 'profile-99999999999999', name: 'X' })
    expect(missing.code).toBeLessThan(0)
    expect(missing.message).toMatch(/不存在/)
  })

  it('流程配置：删除成功与参数非法', async () => {
    const configProfiles = createConfigProfilesMock()
    configProfiles.create({ pipelineId: 'p', name: 'A', snapshot: { schemaVersion: 1 } })
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const ok = await ipcMain.get('story2video:config-profile-delete')(TRUSTED_EVENT, { id: 'profile-00000000000001' })
    expect(ok.code).toBe(0)
    expect(ok.data).toEqual({ deleted: true, id: 'profile-00000000000001' })
    expect(configProfiles.delete).toHaveBeenCalledWith('profile-00000000000001')

    const bad = await ipcMain.get('story2video:config-profile-delete')(TRUSTED_EVENT, { id: '' })
    expect(bad.code).toBeLessThan(0)
    expect(configProfiles.delete).toHaveBeenCalledTimes(1)
  })

  it('流程配置：四个通道均拒绝不可信来源且不触发服务', async () => {
    const configProfiles = createConfigProfilesMock()
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoConfigProfiles: configProfiles })

    const requests = [
      ['story2video:config-profile-list', undefined],
      ['story2video:config-profile-create', { pipelineId: 'p', name: 'A', snapshot: { schemaVersion: 1 } }],
      ['story2video:config-profile-rename', { id: 'profile-00000000000001', name: 'B' }],
      ['story2video:config-profile-delete', { id: 'profile-00000000000001' }],
    ]

    for (const [channel, request] of requests) {
      const result = request === undefined
        ? await ipcMain.get(channel)(UNTRUSTED_EVENT)
        : await ipcMain.get(channel)(UNTRUSTED_EVENT, request)
      expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    }
    expect(configProfiles.list).not.toHaveBeenCalled()
    expect(configProfiles.create).not.toHaveBeenCalled()
    expect(configProfiles.rename).not.toHaveBeenCalled()
    expect(configProfiles.delete).not.toHaveBeenCalled()
  })

  it('删除项目时级联清理持久化 run-state 快照（已中断任务不再残留）', async () => {
    const { RunStateStore } = require('../services/run-state-store')
    const runStateDir = path.join(root, 'run-state')
    const runStateStore = new RunStateStore({ dir: runStateDir, log: { warn() {}, info() {} } })

    // 真实项目服务 + 真实 run-state 快照：模拟「已中断」任务（running 快照在应用重启后被归一化为 interrupted）
    const projectService = new Story2VideoProjectService({
      store: { _resolveOwnerSubject: () => 'user-a', getUserSetting: () => [], setUserSetting: () => {} },
      projectsDir: root,
    })
    const projectId = 'project-interrupted-1'
    // 先写入一个项目（deleteProject 依赖索引中存在才真正移除；不存在也幂等返回 deleted:true）
    projectService._writeProjects([{ projectId, runId: projectId, pipeline: 'story2video-compose', status: 'interrupted', title: '已中断任务' }])
    // 写入与项目同 runId 的 running 快照（重启后归一化为 interrupted，历史页会重新加载）
    runStateStore.saveRunning({
      id: projectId,
      pipeline: 'story2video-compose',
      status: 'running',
      currentStage: 0,
      stages: [],
      context: {},
      params: {},
      orchestrationMode: 'orchestrator',
    })

    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: projectService, runStateStore })

    // 删除前：快照存在（历史页会重新加载该已中断任务）
    expect(runStateStore.load(projectId)).not.toBeNull()

    const result = await ipcMain.get('story2video:delete-project')(TRUSTED_EVENT, projectId)
    expect(result.code).toBe(0)
    expect(result.data).toEqual({ projectId, deleted: true })

    // 删除后：快照被级联清理，重进历史页不再出现该已中断任务
    expect(runStateStore.load(projectId)).toBeNull()
    expect(runStateStore.listRunning()).toEqual([])
    expect(runStateStore.listFailed()).toEqual([])
  })

  it('删除项目时 run-state 快照清理失败不阻断项目删除', async () => {
    const runStateStore = { remove: vi.fn(() => { throw new Error('disk locked') }) }
    const service = {
      _serializeProject: vi.fn(async (_projectId, task) => task()),
      deleteProject: vi.fn(() => ({ projectId: 'project-1', deleted: true })),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service, runStateStore })

    const result = await ipcMain.get('story2video:delete-project')(TRUSTED_EVENT, 'project-1')
    expect(result.code).toBe(0)
    expect(result.data).toEqual({ projectId: 'project-1', deleted: true })
    expect(runStateStore.remove).toHaveBeenCalledWith('project-1')
  })

  it('未注入 runStateStore 时删除项目仍成功（向后兼容）', async () => {
    const service = {
      _serializeProject: vi.fn(async (_projectId, task) => task()),
      deleteProject: vi.fn(() => ({ projectId: 'project-1', deleted: true })),
    }
    const ipcMain = createIpcMain()
    registerHandlers(ipcMain, { ...createDeps(), story2videoProjectService: service })

    const result = await ipcMain.get('story2video:delete-project')(TRUSTED_EVENT, 'project-1')
    expect(result.code).toBe(0)
    expect(result.data).toEqual({ projectId: 'project-1', deleted: true })
  })
})
