/**
 * 许可证动态权限回归测试
 *
 * 验证同一个已注册 IPC handler 不依赖窗口重载，始终读取最新许可证状态。
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const {
  CHANNEL_FEATURE_MAP,
  LOGIN_ONLY_FEATURE_MAP,
  createAccessControlledIpcMain,
  getAccessLevel,
  requiredLevelForChannel,
  requiredFeatureForChannel,
  isLoginOnlyFeatureChannel,
} = require('./license-access-control')

const trustedEvent = { senderFrame: { url: 'app://localhost/index.html' } }

function createIpcMainHarness() {
  const handlers = {}
  return {
    handlers,
    ipcMain: {
      handle(channel, handler) {
        handlers[channel] = handler
      },
    },
  }
}

describe('主进程许可证动态鉴权', () => {
  afterEach(() => {
    __disableElectronMock()
  })

  it('受限 IPC 在升级后立即放行，降级后立即拒绝', async () => {
    let isPro = false
    const licenseManager = { isPro: vi.fn(() => isPro) }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      licenseManager,
      { NODE_ENV: 'production' },
    )
    const publish = vi.fn(async () => ({ code: 0, data: '已发布' }))

    controlledIpcMain.handle('publish:wechat', publish)

    await expect(handlers['publish:wechat'](trustedEvent, { title: '免费版' }))
      .resolves.toMatchObject({ code: -3 })
    expect(publish).not.toHaveBeenCalled()

    isPro = true
    await expect(handlers['publish:wechat'](trustedEvent, { title: '专业版' }))
      .resolves.toEqual({ code: 0, data: '已发布' })
    expect(publish).toHaveBeenCalledTimes(1)

    isPro = false
    await expect(handlers['publish:wechat'](trustedEvent, { title: '已降级' }))
      .resolves.toMatchObject({ code: -3 })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(licenseManager.isPro).toHaveBeenCalledTimes(3)
  })

  it('公开 IPC 不要求专业许可证', async () => {
    const licenseManager = { isPro: vi.fn(() => false) }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      licenseManager,
      { NODE_ENV: 'production' },
    )
    const getVersion = vi.fn(async () => '1.0.0')

    controlledIpcMain.handle('app:get-version', getVersion)

    await expect(handlers['app:get-version'](trustedEvent)).resolves.toBe('1.0.0')
    expect(getVersion).toHaveBeenCalledTimes(1)
    expect(licenseManager.isPro).not.toHaveBeenCalled()
  })

  it('访问级别每次查询都读取当前许可证状态', () => {
    let isPro = false
    const licenseManager = { isPro: vi.fn(() => isPro) }

    expect(getAccessLevel(licenseManager, { NODE_ENV: 'production' })).toBe('public')
    isPro = true
    expect(getAccessLevel(licenseManager, { NODE_ENV: 'production' })).toBe('authenticated')
    isPro = false
    expect(getAccessLevel(licenseManager, { NODE_ENV: 'production' })).toBe('public')
  })

  it('Logto 已登录时以身份为准，不能被本地 license 状态降级', () => {
    const licenseManager = { isPro: vi.fn(() => false) }
    const identityService = { getState: () => ({ status: 'authenticated' }) }
    expect(getAccessLevel(licenseManager, { NODE_ENV: 'production' }, { isPackaged: true }, identityService))
      .toBe('authenticated')
    identityService.getState = () => ({ status: 'signed_out' })
    expect(getAccessLevel(licenseManager, { NODE_ENV: 'production' }, { isPackaged: true }, identityService))
      .toBe('public')
  })

  it('Logto 已启用时开发环境也不能把退出登录提升为 admin', () => {
    const identityService = { getState: () => ({ status: 'signed_out' }) }
    expect(getAccessLevel(
      { isPro: () => true },
      { NODE_ENV: 'development' },
      { isPackaged: false },
      identityService,
    )).toBe('public')
  })

  it.each(['publish:wechat', 'publish:batch'])(
    'Logto 已登录但缺少 cloud_publish 权益时拒绝 %s 且不执行 handler',
    async (channel) => {
      const identityService = {
        getState: () => ({ status: 'authenticated' }),
        requireEntitlement: vi.fn(async () => { throw new Error('ENTITLEMENT_REQUIRED') }),
      }
      const { ipcMain, handlers } = createIpcMainHarness()
      const controlledIpcMain = createAccessControlledIpcMain(
        ipcMain,
        { isPro: () => true },
        { NODE_ENV: 'production' },
        { isPackaged: true },
        identityService,
      )
      const protectedHandler = vi.fn(async () => ({ code: 0 }))
      controlledIpcMain.handle(channel, protectedHandler)

      await expect(handlers[channel](trustedEvent, {})).resolves.toMatchObject({ code: -3 })
      expect(identityService.requireEntitlement).toHaveBeenCalledWith('cloud_publish', { onlineOnly: false })
      expect(protectedHandler).not.toHaveBeenCalled()
    },
  )

  it('有效权益放行本地发布，离线权益不被强制在线刷新', async () => {
    const identityService = {
      getState: () => ({ status: 'offline_authenticated' }),
      requireEntitlement: vi.fn(async () => true),
    }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      null,
      { NODE_ENV: 'production' },
      { isPackaged: true },
      identityService,
    )
    const publish = vi.fn(async () => ({ code: 0 }))
    controlledIpcMain.handle('publish:wechat', publish)

    await expect(handlers['publish:wechat'](trustedEvent, {})).resolves.toEqual({ code: 0 })
    expect(identityService.requireEntitlement).toHaveBeenCalledWith('cloud_publish', { onlineOnly: false })
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('云端发布通道要求在线 cloud_publish 权益', async () => {
    const identityService = {
      getState: () => ({ status: 'authenticated' }),
      requireEntitlement: vi.fn(async () => true),
    }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      null,
      { NODE_ENV: 'production' },
      { isPackaged: true },
      identityService,
    )
    controlledIpcMain.handle('cloud-publisher:submit', vi.fn(async () => ({ code: 0 })))

    await handlers['cloud-publisher:submit'](trustedEvent, {})

    expect(identityService.requireEntitlement).toHaveBeenCalledWith('cloud_publish', { onlineOnly: true })
  })

  it('显式 feature map 覆盖本地和云端发布写通道', () => {
    expect(CHANNEL_FEATURE_MAP).toMatchObject({
      'publish:wechat': 'cloud_publish',
      'publish:batch': 'cloud_publish',
      'cloud-publisher:submit': 'cloud_publish',
    })
  })

  it('IPC 参数不能伪造许可证或访问级别', async () => {
    const licenseManager = { isPro: vi.fn(() => false) }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      licenseManager,
      { NODE_ENV: 'production' },
    )
    const publish = vi.fn(async () => ({ code: 0 }))

    controlledIpcMain.handle('publish:wechat', publish)

    await expect(handlers['publish:wechat'](trustedEvent, {
      accessLevel: 'admin',
      isPro: true,
      license: { isPro: true },
    })).resolves.toMatchObject({ code: -3 })
    expect(publish).not.toHaveBeenCalled()
  })

  it('专业许可证不能伪装成开发管理员权限', async () => {
    const licenseManager = { isPro: vi.fn(() => true) }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      licenseManager,
      { NODE_ENV: 'production' },
    )
    const completePayment = vi.fn(async () => ({ code: 0 }))

    controlledIpcMain.handle('payment:complete', completePayment)

    await expect(handlers['payment:complete'](trustedEvent, {
      accessLevel: 'admin',
    })).resolves.toMatchObject({ code: -3 })
    expect(completePayment).not.toHaveBeenCalled()
  })

  it('拒绝未登录时返回结构化 errorCode，message 不含内部通道名', async () => {
    const identityService = { getState: () => ({ status: 'signed_out' }) }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      null,
      { NODE_ENV: 'production' },
      { isPackaged: true },
      identityService,
    )
    const protectedHandler = vi.fn(async () => ({ code: 0 }))
    controlledIpcMain.handle('store:list-publish-history', protectedHandler)

    const result = await handlers['store:list-publish-history'](trustedEvent, {})
    expect(result).toMatchObject({ code: -3, errorCode: 'AUTH_REQUIRED' })
    expect(result.message).not.toContain('store:list-publish-history')
    expect(result.message).not.toContain(':')
    expect(result.messageParams).toEqual({ channel: 'store:list-publish-history' })
    expect(protectedHandler).not.toHaveBeenCalled()
  })

  it('缺少业务权益时返回 ENTITLEMENT_REQUIRED，message 不含通道名', async () => {
    const identityService = {
      getState: () => ({ status: 'authenticated' }),
      requireEntitlement: vi.fn(async () => { throw new Error('no entitlement') }),
    }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      null,
      { NODE_ENV: 'production' },
      { isPackaged: true },
      identityService,
    )
    const publish = vi.fn(async () => ({ code: 0 }))
    controlledIpcMain.handle('publish:wechat', publish)

    const result = await handlers['publish:wechat'](trustedEvent, {})
    expect(result).toMatchObject({ code: -3, errorCode: 'ENTITLEMENT_REQUIRED' })
    expect(result.message).not.toContain('publish:wechat')
    expect(result.message).toContain('权益')
    expect(result.messageParams).toEqual({ channel: 'publish:wechat' })
    expect(publish).not.toHaveBeenCalled()
  })

  it.each([
    'payment:create-order',
    'payment:list-orders',
    'payment:get-order',
    'payment:cancel',
  ])('免费用户可调用升级订单通道 %s', (channel) => {
    expect(requiredLevelForChannel(channel)).toBe('public')
  })

  it.each([
    'payment:complete',
    'payment:simulate',
  ])('完成支付能力 %s 仍仅限管理员', (channel) => {
    expect(requiredLevelForChannel(channel)).toBe('admin')
  })

  it.each([
    { NODE_ENV: 'development' },
    { ELECTRON_IS_DEV: '1' },
  ])('打包应用不能通过环境变量获得管理员权限：%j', (env) => {
    const app = { isPackaged: true }
    const licenseManager = { isPro: vi.fn(() => false) }

    expect(getAccessLevel(licenseManager, env, app)).toBe('public')
  })

  it('打包应用中的专业许可证也只能获得 authenticated 权限', () => {
    const app = { isPackaged: true }
    const licenseManager = { isPro: vi.fn(() => true) }

    expect(getAccessLevel(licenseManager, { ELECTRON_IS_DEV: '1' }, app))
      .toBe('authenticated')
  })

  it('回装受控 handle 后不递归且仍动态读取许可证权限', async () => {
    let isPro = false
    const handlers = {}
    const ipcMain = {
      handle(channel, handler) {
        handlers[channel] = handler
      },
    }
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      { isPro: () => isPro },
      { NODE_ENV: 'production' },
      { isPackaged: true },
    )

    ipcMain.handle = controlledIpcMain.handle
    const publish = vi.fn(async () => ({ code: 0 }))
    expect(() => ipcMain.handle('publish:recursion-contract', publish)).not.toThrow()

    await expect(handlers['publish:recursion-contract'](trustedEvent))
      .resolves.toMatchObject({ code: -3 })
    isPro = true
    await expect(handlers['publish:recursion-contract'](trustedEvent))
      .resolves.toEqual({ code: 0 })
    isPro = false
    await expect(handlers['publish:recursion-contract'](trustedEvent))
      .resolves.toMatchObject({ code: -3 })
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('免费用户可通过真实支付依赖创建、查询并取消升级订单', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-payment-'))
    const originalGetPath = __electronMock.app.getPath
    __electronMock.app.getPath = () => dataDir
    __enableElectronMock()

    try {
      delete require.cache[require.resolve('../services/payment-manager')]
      delete require.cache[require.resolve('./payment')]

      const { ipcMain, handlers } = createIpcMainHarness()
      const controlledIpcMain = createAccessControlledIpcMain(
        ipcMain,
        { isPro: () => false },
        { NODE_ENV: 'production' },
        { isPackaged: true },
      )
      require('./payment')(controlledIpcMain, {})

      const created = await handlers['payment:create-order'](trustedEvent, {
        plan: 'pro',
        method: 'alipay',
      })
      expect(created).toMatchObject({
        code: 0,
        data: { amount: 99, method: 'alipay', status: 'pending' },
      })

      await expect(handlers['payment:list-orders'](trustedEvent))
        .resolves.toMatchObject({ code: 0, data: [{ id: created.data.id }] })
      await expect(handlers['payment:get-order'](trustedEvent, created.data.id))
        .resolves.toMatchObject({ code: 0, data: { status: 'pending' } })
      await expect(handlers['payment:cancel'](trustedEvent, created.data.id))
        .resolves.toMatchObject({ code: 0, data: true })
      await expect(handlers['payment:get-order'](trustedEvent, created.data.id))
        .resolves.toMatchObject({ code: 0, data: { status: 'cancelled' } })

      await expect(handlers['payment:complete'](trustedEvent, {
        orderId: created.data.id,
        txnId: 'forged',
      })).resolves.toMatchObject({ code: -3 })
      await expect(handlers['payment:simulate'](trustedEvent, {
        orderId: created.data.id,
      })).resolves.toMatchObject({ code: -3 })
    } finally {
      __electronMock.app.getPath = originalGetPath
      __disableElectronMock()
      fs.rmSync(dataDir, { recursive: true, force: true })
      delete require.cache[require.resolve('../services/payment-manager')]
      delete require.cache[require.resolve('./payment')]
    }
  })

  it('拒绝不可信来源，即使许可证有效或通道公开', async () => {
    const licenseManager = { isPro: vi.fn(() => true) }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      licenseManager,
      { NODE_ENV: 'production' },
    )
    const publish = vi.fn(async () => ({ code: 0 }))
    const getVersion = vi.fn(async () => '1.0.0')

    controlledIpcMain.handle('publish:wechat', publish)
    controlledIpcMain.handle('app:get-version', getVersion)

    const untrustedEvent = { senderFrame: { url: 'https://evil.example/' } }
    await expect(handlers['publish:wechat'](untrustedEvent, {}))
      .resolves.toMatchObject({ code: -3, message: '未授权的调用来源' })
    await expect(handlers['app:get-version'](untrustedEvent))
      .resolves.toMatchObject({ code: -3, message: '未授权的调用来源' })
    expect(publish).not.toHaveBeenCalled()
    expect(getVersion).not.toHaveBeenCalled()
  })

  it.each([
    'auth:complete-login',
    'auth:open-qrcode-login',
    'auth:qrcode-close',
    'oauth:start',
    'oauth:close',
    'oauth:get-configs',
    'webview:set-layout',
    'webview:open-tab',
    'webview:close-tab',
    'webview:close-all',
    'webview:list-tabs',
  ])('preload 公开方法对应的 %s 通道也必须公开', (channel) => {
    expect(requiredLevelForChannel(channel)).toBe('public')
  })

  it('本地只读历史通道对未登录开放（list-projects / get-project / pipeline:history）', async () => {
    expect(requiredLevelForChannel('story2video:list-projects')).toBe('public')
    expect(requiredLevelForChannel('story2video:get-project')).toBe('public')
    expect(requiredLevelForChannel('pipeline:history')).toBe('public')
    // 写/删除通道仍要求登录，不扩大未登录权限面
    expect(requiredLevelForChannel('story2video:delete-project')).toBe('authenticated')

    const identityService = { getState: () => ({ status: 'signed_out' }) }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      null,
      { NODE_ENV: 'production' },
      { isPackaged: true },
      identityService,
    )
    const listProjects = vi.fn(async () => ({ code: 0, data: [], localMode: true }))
    const getProject = vi.fn(async () => ({ code: 0, data: { projectId: 'project-1' } }))
    const pipelineHistory = vi.fn(async () => ({ code: 0, data: [] }))
    const deleteProject = vi.fn(async () => ({ code: 0, data: {} }))
    controlledIpcMain.handle('story2video:list-projects', listProjects)
    controlledIpcMain.handle('story2video:get-project', getProject)
    controlledIpcMain.handle('pipeline:history', pipelineHistory)
    controlledIpcMain.handle('story2video:delete-project', deleteProject)

    // 未登录：三个只读通道放行（本地历史/项目可用）
    await expect(handlers['story2video:list-projects'](trustedEvent)).resolves.toEqual({ code: 0, data: [], localMode: true })
    expect(listProjects).toHaveBeenCalledTimes(1)
    await expect(handlers['story2video:get-project'](trustedEvent, 'project-1')).resolves.toEqual({ code: 0, data: { projectId: 'project-1' } })
    expect(getProject).toHaveBeenCalledTimes(1)
    await expect(handlers['pipeline:history'](trustedEvent)).resolves.toEqual({ code: 0, data: [] })
    expect(pipelineHistory).toHaveBeenCalledTimes(1)
    // 未登录：删除通道仍被拒
    await expect(handlers['story2video:delete-project'](trustedEvent, 'project-1')).resolves.toMatchObject({ code: -3 })
    expect(deleteProject).not.toHaveBeenCalled()
  })

  it('采集回退通道 url-collect:fetch 与主路径 aggregation:collect 同为纯本地操作，未登录必须开放', () => {
    // 回归：url-collect:fetch 此前不在 PUBLIC_CHANNELS，未登录时回退层被 license
    // 拦截返回 -3，与 aggregation:collect（公开）行为不一致，导致「采集失败」。
    expect(requiredLevelForChannel('url-collect:fetch')).toBe('public')
    expect(requiredLevelForChannel('aggregation:collect')).toBe('public')
  })

  it('本地媒体导入通道 story2video:import-media 对未登录开放（设备本地操作）', async () => {
    expect(requiredLevelForChannel('story2video:import-media')).toBe('public')
    // 写/删除等敏感通道不扩大
    expect(requiredLevelForChannel('story2video:delete-project')).toBe('authenticated')
    expect(requiredLevelForChannel('story2video:export-zip')).toBe('authenticated')
    expect(requiredLevelForChannel('story2video:generate-scene-ai-video')).toBe('authenticated')

    const identityService = { getState: () => ({ status: 'signed_out' }) }
    const { ipcMain, handlers } = createIpcMainHarness()
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      null,
      { NODE_ENV: 'production' },
      { isPackaged: true },
      identityService,
    )
    const importMedia = vi.fn(async () => ({ code: 0, data: { path: 'C:/controlled/bgm.mp3', kind: 'bgm' } }))
    const deleteProject = vi.fn(async () => ({ code: 0, data: {} }))
    controlledIpcMain.handle('story2video:import-media', importMedia)
    controlledIpcMain.handle('story2video:delete-project', deleteProject)

    // 未登录：import-media 放行（背景音乐/旁白/视频素材选择可用）
    await expect(handlers['story2video:import-media'](trustedEvent, { filePath: 'C:/music/bgm.mp3', kind: 'bgm' }))
      .resolves.toEqual({ code: 0, data: { path: 'C:/controlled/bgm.mp3', kind: 'bgm' } })
    expect(importMedia).toHaveBeenCalledTimes(1)
    // 未登录：删除通道仍被拒
    await expect(handlers['story2video:delete-project'](trustedEvent, 'project-1')).resolves.toMatchObject({ code: -3 })
    expect(deleteProject).not.toHaveBeenCalled()
  })

  it('模型服务商配置写操作需登录，只读操作未登录可用', async () => {
    // 通道级分类：写操作 authenticated，读操作 public
    for (const writeChannel of [
      'model-provider:create',
      'model-provider:update',
      'model-provider:delete',
      'model-provider:set-default',
      'model-provider:clean-logs',
    ]) {
      expect(requiredLevelForChannel(writeChannel)).toBe('authenticated')
    }
    for (const readChannel of [
      'model-provider:list',
      'model-provider:get',
      'model-provider:get-default',
      'model-provider:test',
      'model-provider:presets',
      'model-provider:is-configured',
      'model-provider:logs',
    ]) {
      expect(requiredLevelForChannel(readChannel)).toBe('public')
    }

    // 行为：未登录（public）写操作被拒且 handler 不执行；登录后放行
    const identityService = { getState: () => ({ status: 'signed_out' }) }
    const create = vi.fn(async () => ({ code: 0, data: { id: 'openai' } }))
    const list = vi.fn(async () => ({ code: 0, data: [] }))
    {
      const { ipcMain, handlers } = createIpcMainHarness()
      const controlledIpcMain = createAccessControlledIpcMain(
        ipcMain,
        null,
        { NODE_ENV: 'production' },
        { isPackaged: true },
        identityService,
      )
      controlledIpcMain.handle('model-provider:create', create)
      controlledIpcMain.handle('model-provider:list', list)

      await expect(handlers['model-provider:create'](trustedEvent, { id: 'openai', name: 'OpenAI' }))
        .resolves.toMatchObject({ code: -3 })
      expect(create).not.toHaveBeenCalled()
      // 只读放行
      await expect(handlers['model-provider:list'](trustedEvent)).resolves.toEqual({ code: 0, data: [] })
      expect(list).toHaveBeenCalledTimes(1)
    }
    {
      const { ipcMain, handlers } = createIpcMainHarness()
      const loggedInIdentity = { getState: () => ({ status: 'authenticated' }) }
      const controlledIpcMain = createAccessControlledIpcMain(
        ipcMain,
        null,
        { NODE_ENV: 'production' },
        { isPackaged: true },
        loggedInIdentity,
      )
      controlledIpcMain.handle('model-provider:create', create)
      await expect(handlers['model-provider:create'](trustedEvent, { id: 'openai', name: 'OpenAI' }))
        .resolves.toEqual({ code: 0, data: { id: 'openai' } })
      expect(create).toHaveBeenCalledTimes(1)
    }
  })

  it('发布历史/队列/流水线/视频处理/Story2Video 写操作必须登录（authenticated）', () => {
    const LOGIN_REQUIRED_CHANNELS = [
      // 发布历史 / 队列 / 进度
      'history:list', 'history:get', 'history:delete',
      'queue:status', 'queue:history', 'queue:cancel', 'queue:retry',
      'dashboard:stats',
      // 流水线写操作 / 运行控制
      'pipeline:start', 'pipeline:pause', 'pipeline:resume', 'pipeline:cancel',
      'pipeline:status', 'pipeline:advance', 'pipeline:fetch',
      // 视频处理 / 渲染
      'video:status', 'video:process', 'video:analyze', 'video:mix-audio',
      'video:search-stock', 'video:generate-subtitle', 'video:list-process-types',
      'render:start', 'render:cancel', 'render:validate-props',
      // Story2Video 写操作
      'story2video:delete-project', 'story2video:transcribe', 'story2video:recompose-project',
      'story2video:export-zip', 'story2video:save-as', 'story2video:create-share-url',
      'story2video:update-segments', 'story2video:replace-segment-audio',
      'story2video:retry-segment', 'story2video:capabilities',
      'story2video:copy-path', 'story2video:show-in-folder',
    ]
    for (const channel of LOGIN_REQUIRED_CHANNELS) {
      expect(requiredLevelForChannel(channel), channel + ' 必须登录').toBe('authenticated')
    }

    // 只读/设备本地通道保持 public（离线可用语义）
    for (const channel of [
      'pipeline:list', 'pipeline:get', 'pipeline:history',
      'story2video:list-projects', 'story2video:get-project',
      'render:status',
    ]) {
      expect(requiredLevelForChannel(channel), channel + ' 保持 public').toBe('public')
    }
  })

  it('LOGIN_ONLY_FEATURE_MAP：登录即可，不强制服务端 feature，且全部为 authenticated 通道', () => {
    for (const channel of Object.keys(LOGIN_ONLY_FEATURE_MAP)) {
      expect(requiredLevelForChannel(channel), channel + ' 必须登录').toBe('authenticated')
      expect(requiredFeatureForChannel(channel), channel + ' 不应强制服务端 feature').toBeNull()
      expect(isLoginOnlyFeatureChannel(channel), channel + ' 应命中 login-only 映射').toBe(true)
    }
    // cloud_publish 严格权益不受影响（服务端权威）
    expect(requiredFeatureForChannel('publish:wechat')).toBe('cloud_publish')
    expect(requiredFeatureForChannel('cloud-publisher:submit')).toBe('cloud_publish')
  })
})
