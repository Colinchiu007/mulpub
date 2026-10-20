/**
 * 采集页「AI 改写 → 去发布 → 视频创作」链路回归锁
 * （fix-collection-rewrite-publish-flow，2026-10-20）。
 *
 * 三个用户可见事故，一条一锁：
 *  ① **字数区间不生效**：用户把字数设成 0-6000，改写结果却非常少、像没写完。
 *     根因：采集页把区间传成 `userSettings.targetWordCount`（Python 聚合层旧契约），
 *     而桌面改写引擎读 `userSettings.wordCountRange` ⇒ 既不注入字数指令，
 *     又把输出按**默认 3000 码点**硬砍尾。附带：`Number(0) || 800` 把用户填的 0 吞成 800。
 *  ② **截断不可见**：引擎的 outputTruncated / modelTruncated / segmented 三个信号
 *     在采集页被静默丢弃，用户只看到「像是没有结束」。
 *  ③ **二次改写带旧文案 + 跳页**：一键改写后再 AI 改写，然后「去发布 → 视频创作」，
 *     带进去的是**第一次**改写的文案，而且还要再跳一次视频创作页。
 *
 * 本文件是**组件级**锁（纯函数层见 features/collection/rewrite-word-count.test.js，
 * 编排状态机层见 composables/useCollectionVideoCreation.test.js）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
  ElDialog: { template: '<div class="el-dialog"><slot></slot></div>' },
}))

const pushSpy = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushSpy }) }))

import CollectionView from './Collection.vue'
import i18n from '@/i18n'

const ARTICLE_URL = 'https://example.com/article'
const FIRST_REWRITE = '第一次改写文案'
const SECOND_REWRITE = '第二次改写文案'

function mountCollection () {
  return mount(CollectionView, { global: { plugins: [createPinia(), i18n] } })
}

/** 采集 + 改写 + 草稿 + 流水线所需的最小 electronAPI 面 */
function makeApi (overrides = {}) {
  return {
    aggregationCollect: vi.fn().mockResolvedValue({
      code: 0,
      title: '采集标题',
      content: '采集到的原文正文',
      word_count: 8,
    }),
    aiRewrite: vi.fn().mockResolvedValue({ code: 0, data: { success: true, result: FIRST_REWRITE } }),
    draftSave: vi.fn().mockResolvedValue({ code: 0, data: { draftId: 'draft-1' } }),
    draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
    storeGetSetting: vi.fn().mockResolvedValue(null),
    storeSetSetting: vi.fn().mockResolvedValue({ code: 0 }),
    pipelineStartOrchestrated: vi.fn().mockResolvedValue({
      code: 0,
      data: { runId: 'run-1', success: true, stages: [{ name: 'script', status: 'running' }] },
    }),
    pipelineGetRunContext: vi.fn().mockResolvedValue({
      code: 0,
      data: { runId: 'run-1', status: { status: 'running', progress: 0 } },
    }),
    pipelineCancelRun: vi.fn().mockResolvedValue({ code: 0 }),
    ...overrides,
  }
}

/** 走到「已采集 + 已改写」的状态 */
async function collectAndRewriteOnce (w) {
  w.vm.linkUrl = ARTICLE_URL
  await w.vm.collectAndRewrite()
  await nextTick()
}

describe('采集页 — 字数区间契约（fix-collection-rewrite-word-count）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  it('0-6000 原样送达引擎（wordCountRange），旧键 targetWordCount 不再出现', async () => {
    const api = makeApi()
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)

    w.vm.rewriteWordCountMin = 0
    w.vm.rewriteWordCountMax = 6000
    await w.vm.rewriteCollected()

    const calls = api.aiRewrite.mock.calls
    const params = calls[calls.length - 1][0]
    expect(params.userSettings.wordCountRange).toEqual({ min: 0, max: 6000 })
    // 旧键是 Python 聚合层的死字段：留着只会让人误以为引擎认它
    expect(params.userSettings.targetWordCount).toBeUndefined()
  })

  it('min=0 不会被 `|| 800` 吞成 800（下限不设限的语义要保住）', async () => {
    const api = makeApi()
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)

    w.vm.rewriteWordCountMin = 0
    w.vm.rewriteWordCountMax = 6000
    await w.vm.rewriteCollected()

    const calls = api.aiRewrite.mock.calls
    expect(calls[calls.length - 1][0].userSettings.wordCountRange.min).toBe(0)
  })

  it('引擎砍尾时显示「已按字数上限截断」横幅（此前静默丢弃）', async () => {
    const api = makeApi({
      aiRewrite: vi.fn().mockResolvedValue({
        code: 0,
        data: { success: true, result: '被砍尾的正文', outputTruncated: true, outputLength: 3000 },
      }),
    })
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)

    expect(w.find('[data-testid="collection-rewrite-output-truncated"]').exists()).toBe(true)
  })

  it('模型侧截断与分段改写各有独立横幅', async () => {
    const api = makeApi({
      aiRewrite: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          success: true,
          result: '正文',
          modelTruncated: true,
          outputLength: 1200,
          truncatedSegments: [2],
          segmented: { enabled: true, segmentCount: 3 },
        },
      }),
    })
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)

    expect(w.find('[data-testid="collection-rewrite-model-truncated"]').exists()).toBe(true)
    expect(w.find('[data-testid="collection-rewrite-segmented"]').exists()).toBe(true)
  })

  it('未截断时不显示任何截断横幅（不制造噪音）', async () => {
    const api = makeApi()
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)

    expect(w.find('[data-testid="collection-rewrite-output-truncated"]').exists()).toBe(false)
    expect(w.find('[data-testid="collection-rewrite-model-truncated"]').exists()).toBe(false)
    expect(w.find('[data-testid="collection-rewrite-segmented"]').exists()).toBe(false)
  })
})

describe('采集页 — 「去发布 → 视频创作」（fix-collection-rewrite-publish-flow）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  it('二次改写后带进流水线的是**第二次**的文案（不是第一次）', async () => {
    const aiRewrite = vi.fn()
      .mockResolvedValueOnce({ code: 0, data: { success: true, result: FIRST_REWRITE } })
      .mockResolvedValueOnce({ code: 0, data: { success: true, result: SECOND_REWRITE } })
    const api = makeApi({ aiRewrite })
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)          // 一键改写 → FIRST_REWRITE
    await w.vm.rewriteCollected()            // 再 AI 改写 → SECOND_REWRITE
    expect(w.vm.rewriteResult).toBe(SECOND_REWRITE)

    await w.vm.goPublishAfterRewrite()       // 打开「去发布」浮层
    w.vm.onPublishVideo('story2video-compose')
    await flushPromises()

    expect(api.pipelineStartOrchestrated).toHaveBeenCalledTimes(1)
    const [, params] = api.pipelineStartOrchestrated.mock.calls[0]
    expect(params.text).toBe(SECOND_REWRITE)
    expect(params.story2videoTextConfig.prompt).toBe(SECOND_REWRITE)
    expect(params.text).not.toBe(FIRST_REWRITE)
  })

  it('不再跳转视频创作页（进度浮层就地弹出）', async () => {
    const api = makeApi()
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)

    await w.vm.goPublishAfterRewrite()
    expect(w.vm.showPublishModal).toBe(true)

    w.vm.onPublishVideo('story2video-compose')
    await flushPromises()

    // ① 发布浮层消失
    expect(w.vm.showPublishModal).toBe(false)
    // ② 执行进度浮层弹出（UiModal 走 Teleport，落在 body 上）
    expect(w.vm.videoModalOpen).toBe(true)
    expect(document.body.innerHTML).toContain('collection-video-create-modal')
    // ③ 不跳视频创作页
    expect(pushSpy.mock.calls.some((call) => String(call[0]).includes('/create'))).toBe(false)
  })

  it('进度浮层展示流水线阶段（不是空壳）', async () => {
    const api = makeApi()
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)
    await w.vm.goPublishAfterRewrite()
    w.vm.onPublishVideo('story2video-compose')
    await flushPromises()

    // 阶段列表非空，且第一个阶段已被标为运行中（证明流水线确实启动，
    // 而不是只弹了个空浮层）
    expect(w.vm.videoStages.length).toBeGreaterThan(0)
    expect(w.vm.videoStages[0].status).toBe('running')
  })

  it('没有改写文案时不启动流水线（如实提示，不静默失败）', async () => {
    const api = makeApi()
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    w.vm.rewriteResult = ''
    w.vm.onPublishVideo('story2video-compose')
    await flushPromises()

    expect(api.pipelineStartOrchestrated).not.toHaveBeenCalled()
  })

  it('引擎信封的正文不是字符串 ⇒ 判失败（不写正文、不挂归因链、不报成功）', async () => {
    // CCG 深审 i3：IPC 是外部输入边界，`result` 正常恒为字符串但不保证。
    // 非字符串真值若直接进 rewriteResult，会让 textarea 的 v-model 拿到非字符串，
    // 且与 lastProgrammaticRewrite 的字符串口径分叉 ⇒ watcher 误判「程序赋值」⇒ 归因链错挂。
    const api = makeApi({
      aiRewrite: vi.fn().mockResolvedValue({
        code: 0,
        data: { success: true, result: { not: 'a string' } },
      }),
    })
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)

    expect(w.vm.rewriteResult).toBe('')
    expect(w.vm.rewriteError).toBeTruthy()
  })

  it('二次改写后「去发布」重存的草稿是**最新**文案（图文发布路径不被旧草稿带偏）', async () => {
    // 这条锁的是「已存草稿作废」这条不变量：改写结果一变，旧草稿 id 必须作废，
    // 否则 goPublishAfterRewrite 会跳过重存，发布图文时带出去的还是第一次改写的稿。
    const aiRewrite = vi.fn()
      .mockResolvedValueOnce({ code: 0, data: { success: true, result: FIRST_REWRITE } })
      .mockResolvedValueOnce({ code: 0, data: { success: true, result: SECOND_REWRITE } })
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: 'draft-1' } })
    const api = makeApi({ aiRewrite, draftSave })
    window.electronAPI = api
    const w = mountCollection()
    await nextTick()
    await collectAndRewriteOnce(w)        // 一键改写 → FIRST_REWRITE

    await w.vm.goPublishAfterRewrite()   // 第一次「去发布」：存草稿（内容 = FIRST_REWRITE）
    expect(draftSave).toHaveBeenCalledTimes(1)
    expect(draftSave.mock.calls[0][0].content).toBe(FIRST_REWRITE)

    await w.vm.rewriteCollected()        // 再 AI 改写 → SECOND_REWRITE
    await w.vm.goPublishAfterRewrite()   // 第二次「去发布」：必须重存（内容 = SECOND_REWRITE）
    expect(draftSave).toHaveBeenCalledTimes(2)
    expect(draftSave.mock.calls[1][0].content).toBe(SECOND_REWRITE)
  })
})
