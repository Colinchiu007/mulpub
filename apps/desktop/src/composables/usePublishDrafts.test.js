import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

const {
  mockDraftSave,
  mockDraftList,
  mockDraftDelete,
  mockMessage,
  mockConfirm,
} = vi.hoisted(() => ({
  mockDraftSave: vi.fn(),
  mockDraftList: vi.fn(),
  mockDraftDelete: vi.fn(),
  mockMessage: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  // ElMessageBox.confirm：resolve = 确认（清除定时并保存）；reject = 取消/关闭（保留定时保存）
  mockConfirm: vi.fn(),
}))

vi.mock('@/api/publisher', () => ({
  draftSave: mockDraftSave,
  draftList: mockDraftList,
  draftDelete: mockDraftDelete,
}))

vi.mock('element-plus', () => ({ ElMessage: mockMessage, ElMessageBox: { confirm: mockConfirm } }))

import { usePublishDrafts } from './usePublishDrafts'
import { messageIs, messageContains } from './../utils/toast-assert-helpers'

describe('usePublishDrafts', () => {
  let article
  let selectedPlatforms
  let selectedAccounts
  let platformOverrides

  beforeEach(() => {
    vi.clearAllMocks()
    article = reactive({
      title: '标题',
      content: '正文',
      author: '作者',
      cover_url: 'https://img.test/cover.jpg',
      cover_path: 'D:/cover.png',
      cover_file: { path: 'D:/cover.png', name: 'cover.png', type: 'image/png' },
      video_path: 'D:/video.mp4',
      images: ['D:/image-1.png'],
      image_files: [{ path: 'D:/image-1.png', name: 'image-1.png', type: 'image/png' }],
      tags: ['AI', '效率'],
      topics: ['内容创作'],
      mentions: [{ name: '邱里奥谈认知', text: '@邱里奥谈认知' }],
      publishTime: '2026-07-21T10:00',
    })
    selectedPlatforms = ref(['wechat_mp'])
    selectedAccounts = ref({ wechat_mp: ['wx-1', 'wx-2'] })
    platformOverrides = reactive({ wechat_mp: { title: '微信标题', content: '' } })
    mockDraftSave.mockResolvedValue({ code: 0 })
    mockDraftList.mockResolvedValue({ code: 0, data: [] })
    mockDraftDelete.mockResolvedValue({ code: 0 })
    // 默认「保留定时保存」（confirm 取消侧），需要清除侧的用例单独 mockResolvedValue
    mockConfirm.mockRejectedValue(new Error('cancel'))
  })

  function createDrafts () {
    return usePublishDrafts({ article, selectedPlatforms, selectedAccounts, platformOverrides })
  }

  it('保存完整文章、账号、平台和差异内容的纯 JSON 快照', async () => {
    const drafts = createDrafts()

    await drafts.saveDraft()

    // publishTime 已设置 → 互斥确认弹出（默认取消=保留定时保存）
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockDraftSave).toHaveBeenCalledTimes(1)
    const payload = mockDraftSave.mock.calls[0][0]
    expect(payload).toMatchObject({
      title: '标题',
      content: '正文',
      author: '作者',
      cover_url: 'https://img.test/cover.jpg',
      cover_path: 'D:/cover.png',
      cover_file: { path: 'D:/cover.png', name: 'cover.png', type: 'image/png' },
      video_path: 'D:/video.mp4',
      images: ['D:/image-1.png'],
      image_files: [{ path: 'D:/image-1.png', name: 'image-1.png', type: 'image/png' }],
      tags: ['AI', '效率'],
      topics: ['内容创作'],
      mentions: [{ name: '邱里奥谈认知', text: '@邱里奥谈认知' }],
      publishTime: '2026-07-21T10:00',
      platforms: ['wechat_mp'],
      accounts: { wechat_mp: ['wx-1', 'wx-2'] },
      platformOverrides: { wechat_mp: { title: '微信标题', content: '' } },
    })
    expect(() => structuredClone(payload)).not.toThrow()
  })

  it('加载草稿时替换而不是叠加账号与差异内容', async () => {
    const drafts = createDrafts()
    platformOverrides.zhihu = { title: '残留标题', content: '' }
    selectedAccounts.value.zhihu = ['zh-1']
    drafts.drafts.value = [{
      id: 'draft-1',
      title: '新标题',
      content: '新正文',
      platforms: ['wechat_mp'],
      accounts: { wechat_mp: ['wx-3'] },
      platformOverrides: { wechat_mp: { title: '新微信标题', content: '' } },
    }]

    await drafts.loadDraft('draft-1')

    expect(article.title).toBe('新标题')
    expect(selectedAccounts.value).toEqual({ wechat_mp: ['wx-3'] })
    expect(platformOverrides).toEqual({ wechat_mp: { title: '新微信标题', content: '' } })
  })

  // ─── Bug 回归：缺失数组字段的草稿不得把 images 设为空字符串 ───
  // E2E 2026-09-11 发现：热门选题等纯文字草稿无 images 字段，
  // applyDraft 的 `draft[field] || ''` 把 images 设为 ''，
  // 触发 publish-contract 的「images 文件引用无效」，阻断一键发布。
  it('加载无 images 字段的草稿时数组字段保持空数组而非空字符串', async () => {
    const drafts = createDrafts()
    drafts.drafts.value = [{
      id: 'draft-hot-topics',
      title: '热门选题标题',
      content: '热门选题内容',
      // 故意缺失 images/image_files/tags/topics/mentions/publishTime
    }]

    await drafts.loadDraft('draft-hot-topics')

    expect(article.title).toBe('热门选题标题')
    expect(article.images).toEqual([])      // 不再是 ''
    expect(article.image_files).toEqual([]) // 不再是 ''
    expect(article.tags).toEqual([])        // 不再是 ''
    expect(article.topics).toEqual([])      // 不再是 ''
    expect(article.mentions).toEqual([])    // 不再是 ''
    expect(article.publishTime).toBe('')    // 字符串字段仍为 ''
  })

  it('草稿带有效数组字段时正常保留', async () => {
    const drafts = createDrafts()
    drafts.drafts.value = [{
      id: 'draft-with-images',
      title: '有图草稿',
      content: '内容',
      images: ['D:/pic.png'],
      tags: ['标签'],
    }]

    await drafts.loadDraft('draft-with-images')

    expect(article.images).toEqual(['D:/pic.png'])
    expect(article.tags).toEqual(['标签'])
  })

  it('草稿 API 失败时显示错误且不抛出未处理异常', async () => {
    mockDraftList.mockRejectedValueOnce(new Error('读取失败'))
    mockDraftSave.mockResolvedValueOnce({ code: -1, message: '保存失败' })
    const drafts = createDrafts()

    await expect(drafts.loadDrafts()).resolves.toEqual([])
    await expect(drafts.saveDraft()).resolves.toEqual({ ok: false, draftId: null })

    expect(mockMessage.error).toHaveBeenCalledWith(messageIs('读取失败'))
    expect(mockMessage.error).toHaveBeenCalledWith(messageIs('保存失败'))
  })

  it('空草稿不提交', async () => {
    article.title = ' '
    article.content = ''
    const drafts = createDrafts()

    await drafts.saveDraft()

    expect(mockDraftSave).not.toHaveBeenCalled()
    expect(mockMessage.warning).toHaveBeenCalledWith(messageIs('标题和内容不能都为空'))
  })

  // ─── P1-4 定时×草稿互斥（2026-10-08 发布页优化 roadmap 第一项）───
  // 本地草稿是静态快照不会自动发布；带定时保存 → 确认「清除定时并保存」或「保留定时保存」；
  // 加载过期定时 → 清除并提示，避免下一次发布被 validateScheduleEntries 静默拒绝。
  it('P1-4：带定时时间保存草稿弹出互斥确认，确认后清除定时再保存', async () => {
    article.publishTime = '2099-06-01T09:00'
    mockConfirm.mockResolvedValue(undefined) // 确认 = 清除定时并保存
    const drafts = createDrafts()

    await drafts.saveDraft()

    expect(mockConfirm).toHaveBeenCalledTimes(1)
    const confirmArgs = mockConfirm.mock.calls[0]
    expect(confirmArgs[0]).toContain('2099-06-01T09:00')
    expect(confirmArgs[0]).toContain('不会在定时时间自动发布')
    expect(article.publishTime).toBe('')
    expect(mockDraftSave.mock.calls[0][0].publishTime).toBe('')
  })

  it('P1-4：互斥确认取消（保留定时保存）时定时字段原样入快照', async () => {
    article.publishTime = '2099-06-01T09:00'
    const drafts = createDrafts()

    await drafts.saveDraft()

    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(article.publishTime).toBe('2099-06-01T09:00')
    expect(mockDraftSave.mock.calls[0][0].publishTime).toBe('2099-06-01T09:00')
  })

  it('P1-4：未设置定时时保存草稿不弹互斥确认', async () => {
    article.publishTime = ''
    const drafts = createDrafts()

    await drafts.saveDraft()

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockDraftSave).toHaveBeenCalledTimes(1)
  })

  it('P1-4：加载含过期定时时间的草稿时清除定时并提示', async () => {
    const drafts = createDrafts()
    drafts.drafts.value = [{
      id: 'draft-stale-schedule',
      title: '过期定时草稿',
      content: '内容',
      publishTime: '2026-07-21T10:00', // 已过去（相对机器时钟 2026-09-28）
    }]

    await drafts.loadDraft('draft-stale-schedule')

    expect(article.title).toBe('过期定时草稿')
    expect(article.publishTime).toBe('')
    expect(mockMessage.warning).toHaveBeenCalledWith(messageContains('已过期'))
  })

  it('P1-4：加载含未来定时时间的草稿时保留定时且不提示', async () => {
    const drafts = createDrafts()
    drafts.drafts.value = [{
      id: 'draft-future-schedule',
      title: '未来定时草稿',
      content: '内容',
      publishTime: '2099-06-01T09:00',
    }]

    await drafts.loadDraft('draft-future-schedule')

    expect(article.publishTime).toBe('2099-06-01T09:00')
    expect(mockMessage.warning).not.toHaveBeenCalledWith(expect.stringContaining('已过期'))
  })
  it('saveDraft 返回 { ok: true, draftId }（copy-library-detail-entry：供创作视频跳转使用）', async () => {
    mockDraftSave.mockResolvedValue({ code: 0, data: { draftId: 'draft_ab12', reused: false } })
    const drafts = createDrafts()

    const result = await drafts.saveDraft()

    expect(result).toEqual({ ok: true, draftId: 'draft_ab12' })
  })

  it('saveDraft 指纹命中复用时返回既有 draftId', async () => {
    mockDraftSave.mockResolvedValue({ code: 0, data: { draftId: 'draft_old', reused: true } })
    const drafts = createDrafts()

    const result = await drafts.saveDraft()

    expect(result).toEqual({ ok: true, draftId: 'draft_old' })
  })

  it('saveDraft 失败时返回 { ok: false, draftId: null } 且不抛异常', async () => {
    mockDraftSave.mockResolvedValue({ code: -1, message: 'save boom' })
    const drafts = createDrafts()

    const result = await drafts.saveDraft()

    expect(result).toEqual({ ok: false, draftId: null })
    expect(mockMessage.error).toHaveBeenCalled()
  })

  it('saveDraft 空内容早退返回 { ok: false, draftId: null }', async () => {
    article.title = ' '
    article.content = ''
    const drafts = createDrafts()

    const result = await drafts.saveDraft()

    expect(result).toEqual({ ok: false, draftId: null })
    expect(mockDraftSave).not.toHaveBeenCalled()
  })

  // ── 归因链（PRD-PUBLISH-REWRITE-LINEAGE-2026-10-05）─────────────────────────
  // 草稿是「改写页 → 发布页」唯一的载体。这一跳漏了，前面接得再好也到不了 payload。
  describe('归因链：rewriteHistoryId 随草稿存取', () => {
    it('saveDraft 快照带出关联 id（有值时）', async () => {
      article.rewriteHistoryId = 'md0kx9a1b2c3'
      article.publishTime = ''
      const drafts = createDrafts()
      await drafts.saveDraft()
      expect(mockDraftSave.mock.calls[0][0].rewriteHistoryId).toBe('md0kx9a1b2c3')
    })

    it('无关联时快照写 null，绝不写空串（string|null 语义，QM-6 前端轴 F3）', async () => {
      article.publishTime = ''
      const drafts = createDrafts()
      await drafts.saveDraft()
      // 钉三件事：键存在、值是 null、不是 ''/undefined 混用
      const snapshot = mockDraftSave.mock.calls[0][0]
      expect(Object.prototype.hasOwnProperty.call(snapshot, 'rewriteHistoryId')).toBe(true)
      expect(snapshot.rewriteHistoryId).toBe(null)
    })

    it('article 上被塞进脏值（空串/数字/超长）⇒ 快照落 null，不把脏值带进草稿库', async () => {
      article.publishTime = ''
      article.rewriteHistoryId = '   '
      const drafts = createDrafts()
      await drafts.saveDraft()
      expect(mockDraftSave.mock.calls[0][0].rewriteHistoryId).toBe(null)
    })

    it('loadDraft 把关联恢复到 article（改写页存的草稿，发布页取出来还能接上）', async () => {
      mockDraftList.mockResolvedValue({
        code: 0,
        data: [{ id: 'd1', title: 'T', content: 'C', rewriteHistoryId: 'md0kx9a1b2c3' }],
      })
      const drafts = createDrafts()
      await drafts.loadDrafts()
      article.rewriteHistoryId = null
      expect(await drafts.loadDraft('d1')).toBe(true)
      expect(article.rewriteHistoryId).toBe('md0kx9a1b2c3')
    })

    it('载入一份无关联的草稿 ⇒ 必须清掉 article 上的旧关联（跨草稿串关联 = 假归因）', async () => {
      mockDraftList.mockResolvedValue({
        code: 0,
        data: [{ id: 'd2', title: 'T', content: 'C' }],
      })
      const drafts = createDrafts()
      await drafts.loadDrafts()
      article.rewriteHistoryId = 'stale-from-previous-draft'
      expect(await drafts.loadDraft('d2')).toBe(true)
      expect(article.rewriteHistoryId, '旧 id 跟着新正文进 payload 就是假关联；且必须是 null 不是 ""（空串会被 != null 的读法当成有关联）').toBe(null)
    })

    it('接线守卫：ARTICLE_FIELDS 必须含该键（漏键即整条链断，且两侧单测都会绿）', async () => {
      const fs = require('fs')
      const path = require('path')
      const src = fs.readFileSync(path.resolve(__dirname, 'usePublishDrafts.js'), 'utf8')
      const block = src.slice(src.indexOf('const ARTICLE_FIELDS'), src.indexOf(']', src.indexOf('const ARTICLE_FIELDS')))
      expect(block).toContain("'rewriteHistoryId'")
    })
  })
})
