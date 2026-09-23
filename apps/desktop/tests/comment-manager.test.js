/**
 * CommentManager — Unit Tests (PRD F13)
 *
 * Tests:
 *   - 构造与基本方法存在
 *   - listComments — ORCHESTRATOR_URL 未配置时返回空数组
 *   - replyComment — ORCHESTRATOR_URL 未配置时返回明确错误
 *   - startPolling / stopPolling — 生命周期管理
 *   - getStatus — 列出活跃轮询
 *   - 重复 startPolling 返回 already running
 *   - stopAll — 停止所有
 *
 * 注意：用 __registerMock 替代 vi.mock，与 content-intelligence.test.js 一致
 */
__enableElectronMock()

const mockLoadCredential = vi.fn()

__registerMock('./logger', {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
})
__registerMock('./credential-store', {
  loadCredential: mockLoadCredential,
})

const CommentManager = require('../electron/services/comment-manager')
const TRUSTED_EVENT = { senderFrame: { url: 'app://localhost/index.html' } }
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }

describe('CommentManager', () => {
  let cm

  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    mockLoadCredential.mockReturnValue({
      cookies: [{ name: 'session', value: 'stored-cookie' }],
    })
    cm = new CommentManager()
  })

  describe('构造与接口', () => {
    it('应导出 CommentManager 类', () => {
      expect(typeof CommentManager).toBe('function')
    })

    it('实例应有所有核心方法', () => {
      expect(typeof cm.listComments).toBe('function')
      expect(typeof cm.replyComment).toBe('function')
      expect(typeof cm.startPolling).toBe('function')
      expect(typeof cm.stopPolling).toBe('function')
      expect(typeof cm.stopAll).toBe('function')
      expect(typeof cm.getStatus).toBe('function')
      expect(typeof cm.registerIpcHandlers).toBe('function')
      expect(typeof cm.setGetMainWin).toBe('function')
      expect(typeof cm.setOwnerSubjectProvider).toBe('function')
    })
  })

  describe('listComments — ORCHESTRATOR_URL 未配置', () => {
    it('应返回空数组（graceful degradation）', async () => {
      // 确保 ORCHESTRATOR_URL 未设置
      delete process.env.ORCHESTRATOR_URL
      const list = await cm.listComments('douyin', 'acc1', { maxDays: 7 })
      expect(Array.isArray(list)).toBe(true)
      expect(list.length).toBe(0)
      expect(mockLoadCredential).toHaveBeenCalledWith('acc1', '/tmp/test-electron-path')
    })
  })

  describe('replyComment — ORCHESTRATOR_URL 未配置', () => {
    it('应返回 success=false + 明确错误信息', async () => {
      delete process.env.ORCHESTRATOR_URL
      const result = await cm.replyComment('douyin', 'acc1', 'cmt-123', '感谢评论')
      expect(result.success).toBe(false)
      expect(result.error).toContain('ORCHESTRATOR_URL')
      expect(mockLoadCredential).toHaveBeenCalledWith('acc1', '/tmp/test-electron-path')
    })
  })

  describe('startPolling / stopPolling 生命周期', () => {
    it('startPolling 返回 key + started=true', async () => {
      delete process.env.ORCHESTRATOR_URL
      const result = await cm.startPolling({
        platform: 'douyin',
        accountId: 'acc1',
        interval: 60000,
      })
      expect(result.key).toBe('douyin:acc1')
      expect(result.started).toBe(true)
    })

    it('重复 startPolling 同 key 返回 started=false', async () => {
      delete process.env.ORCHESTRATOR_URL
      await cm.startPolling({ platform: 'douyin', accountId: 'acc1' })
      const result = await cm.startPolling({ platform: 'douyin', accountId: 'acc1' })
      expect(result.started).toBe(false)
      expect(result.message).toContain('already running')
    })

    it('stopPolling 已运行的 key 返回 stopped=true', async () => {
      delete process.env.ORCHESTRATOR_URL
      const startResult = await cm.startPolling({ platform: 'weibo', accountId: 'acc2' })
      const result = await cm.stopPolling(startResult.key)
      expect(result.stopped).toBe(true)
    })

    it('stopPolling 未运行的 key 返回 stopped=false', async () => {
      const result = await cm.stopPolling('nonexistent:key')
      expect(result.stopped).toBe(false)
    })
  })

  describe('getStatus', () => {
    it('无活跃轮询时返回空数组', () => {
      expect(cm.getStatus()).toEqual([])
    })

    it('有活跃轮询时返回条目', async () => {
      delete process.env.ORCHESTRATOR_URL
      await cm.startPolling({ platform: 'douyin', accountId: 'a1' })
      const status = cm.getStatus()
      expect(status.length).toBe(1)
      expect(status[0].key).toBe('douyin:a1')
      expect(status[0].platform).toBe('douyin')
    })
  })

  describe('stopAll', () => {
    it('停止所有轮询', async () => {
      delete process.env.ORCHESTRATOR_URL
      await cm.startPolling({ platform: 'douyin', accountId: 'a1' })
      await cm.startPolling({ platform: 'weibo', accountId: 'a2' })
      expect(cm.getStatus().length).toBe(2)
      await cm.stopAll()
      expect(cm.getStatus().length).toBe(0)
    })
  })

  describe('startPolling with template', () => {
    it('使用自定义模板生成器', async () => {
      delete process.env.ORCHESTRATOR_URL
      const result = await cm.startPolling({
        platform: 'zhihu',
        accountId: 'a3',
        template: '谢谢 {author}: {content}',
      })
      expect(result.started).toBe(true)
      await cm.stopPolling(result.key)
    })
  })

  describe('主进程凭据边界', () => {
    it('身份服务启用后只从当前用户的加密凭据命名空间读取 Cookie', () => {
      cm.setOwnerSubjectProvider(() => 'user-a')

      expect(cm.resolveCookieHeader('acc1')).toBe('session=stored-cookie')
      expect(mockLoadCredential).toHaveBeenCalledWith('acc1', '/tmp/test-electron-path', 'user-a')
    })

    it('身份服务缺少 sub 时拒绝读取 legacy 凭据', () => {
      cm.setOwnerSubjectProvider(() => null)

      expect(() => cm.resolveCookieHeader('acc1')).toThrow('登录会话缺少用户标识')
      expect(mockLoadCredential).not.toHaveBeenCalled()
    })

    it('缺少加密凭据时拒绝评论请求', async () => {
      mockLoadCredential.mockReturnValue(null)

      await expect(cm.listComments('douyin', 'missing-account', { maxDays: 7 }))
        .rejects.toThrow('未找到账号登录凭证')
    })

    it('过滤非法 Cookie 项并生成请求头', () => {
      mockLoadCredential.mockReturnValue({
        cookies: [
          { name: 'session', value: 'stored-cookie' },
          { name: 'bad\nname', value: 'ignored' },
          { name: 'unsafe', value: 'line\r\nbreak' },
        ],
      })

      expect(cm.resolveCookieHeader('acc1')).toBe('session=stored-cookie')
    })
  })

  describe('IPC 来源与参数合同', () => {
    // P1-14 迁移：registerIpcHandlers 只接受注入的受控 ipcMain（createAccessControlledIpcMain），
    // 用例自带记录器，不再依赖全局 electron mock 的 ipcMain 侧写。
    function createRecordingIpcMain() {
      const handlers = {}
      return {
        handle: (channel, fn) => { handlers[channel] = fn },
        handlers,
      }
    }

    let ipcMainFake

    beforeEach(() => {
      ipcMainFake = createRecordingIpcMain()
      cm.registerIpcHandlers(ipcMainFake)
    })

    it('未注入受控 ipcMain 时 fail-closed（禁止回退全局 ipcMain）', () => {
      expect(() => cm.registerIpcHandlers()).toThrow(/需要注入受控 ipcMain/)
      expect(() => cm.registerIpcHandlers(undefined)).toThrow(/禁止使用全局 ipcMain/)
    })

    it('comment:list 拒绝不可信来源', async () => {
      const handler = ipcMainFake.handlers['comment:list']
      const listComments = vi.spyOn(cm, 'listComments')

      await expect(handler(UNTRUSTED_EVENT, {
        platform: 'douyin',
        accountId: 'acc1',
      })).resolves.toEqual({ code: -3, message: '未授权的调用来源' })
      expect(listComments).not.toHaveBeenCalled()
    })

    it('comment:list 只把 accountId 交给主进程凭据解析', async () => {
      const handler = ipcMainFake.handlers['comment:list']
      const listComments = vi.spyOn(cm, 'listComments').mockResolvedValue([])

      await expect(handler(TRUSTED_EVENT, {
        platform: 'douyin',
        accountId: 'acc1',
        cookie: 'renderer-secret',
        maxDays: 3,
      })).resolves.toEqual({ code: 0, data: [] })
      expect(listComments).toHaveBeenCalledWith('douyin', 'acc1', { maxDays: 3 })
    })

    it('comment:status 拒绝不可信来源', async () => {
      const handler = ipcMainFake.handlers['comment:status']

      await expect(handler(UNTRUSTED_EVENT)).resolves.toEqual({
        code: -3,
        message: '未授权的调用来源',
      })
    })
  })
})
