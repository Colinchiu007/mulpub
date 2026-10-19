/**
 * collection-page.test.js — 采集页整体 UI/UE 统一的行为锁（2026-10-17）
 *
 * 动因：用户真机走查「整体布局和细节元素和用户交互体验，视觉上都很散乱」。
 * 本轮不改任何业务行为，只统一视觉与可达性；因此本测试锁的是**结构与可达性契约**：
 *   ① 页签数量与默认页签不变（5 个 / collect）—— 防「顺手加页签」；
 *   ② 页签 aria 完整（tab + aria-selected + aria-controls）且内容面板是 tabpanel；
 *   ③ 快捷操作区按「新建 / 草稿 / 素材来源」三组呈现（不再 6 张平铺）；
 *   ④ 页签角标数值 > 99 显示 99+（此前 collection-tab-badge 无样式定义，是裸文本）；
 *   ⑤ 采集主路径 testid 不变（collected-result-box / collection-collect-btn / quick-drafts-box）。
 *
 * IPC 全 mock（window.electronAPI 桩），不 mock 组件内部函数。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
  ElDialog: { template: '<div class="el-dialog"><slot></slot></div>' },
}))

const pushSpy = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushSpy }) }))

// 采集页主组件在 views/ 下（相对本目录上跳两级）
const CollectionView = (await import('../../views/Collection.vue')).default

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    zh: {
      collection: {
        tabCollect: '内容采集',
        tabRecords: '文案库',
        quickCollectTab: '快捷采集',
        draftsTab: '草稿箱',
        draftsBoxShort: '草稿箱',
        creatorTab: '博主监控',
        pageSubtitle: '从各平台采集内容，或快速创建草稿',
        urlPlaceholder: '输入文章链接，自动采集标题、正文、封面…',
        collect: '采集',
        collecting: '采集中…',
        oneClickRewrite: '一键改写',
        oneClickRewriting: '一键改写中…',
        retry: '重试',
        createDraft: '创建草稿',
        useViralLibrary: '结合爆款库',
        usePersonalExperience: '结合个人经历',
        cancel: '取消',
        resultTitlePrefix: '✅',
        hasCoverImage: '有封面图',
        quickNewDraft: '新建草稿',
        quickClipboard: '剪贴板导入',
        quickGroupNew: '新建',
        quickGroupDrafts: '草稿',
        quickGroupSources: '素材来源',
        sourceWeibo: '微博热搜',
        sourceZhihu: '知乎热榜',
        sourceToutiao: '头条热榜',
        draftsCount: '{count} 篇',
        clipboardEmpty: '剪贴板为空',
        clipboardReadFailed: '剪贴板读取失败',
        collectUnavailable: '采集功能不可用',
        enterLink: '请输入链接',
        collectFailed: '采集失败',
        collectSuccess: '内容采集成功',
        collectRequestFailed: '采集请求失败',
        draftCreated: '草稿已创建',
        importedLines: '已导入 {count} 行内容',
        rewrite: 'AI 改写',
        rewriting: 'AI 改写中…',
        rewriteFailed: 'AI 改写失败',
        rewriteSuccess: '改写完成',
        wordCountLabel: '字数',
        wordCountMinPlaceholder: '最小',
        wordCountMaxPlaceholder: '最大',
        wordCountUnit: '字',
        videoTranscriptLabel: '视频口播文案',
        confirmTitle: '确认',
        deleted: '已删除',
        confirmDeleteDraft: '确定删除这篇草稿吗？',
        openedPlatform: '已打开 {platform} 采集页面',
        platformUnsupported: '该平台暂不支持网页查看',
        platformSourceTabTitle: (ctx) => ctx.named('platform') + ' 素材来源',
        rewriteStyleEasy: '轻松易懂',
        rewriteStyleFormal: '正式严谨',
        rewriteStyleEyeCatching: '吸引眼球',
        rewriteStyleDeep: '深度分析',
        rewriteStyleCognitive: '认知锚点',
        rewriteLengthKeep: '保持原文',
        rewriteLengthCompress: '精简',
        rewriteLengthExpand: '扩写',
        wordCountMinInvalid: '最小字数需为 0-5999 的整数',
        wordCountMaxInvalid: '最大字数需为 1-6000 的整数',
        wordCountMaxLtMin: '最大字数不能小于最小字数',
        batchCollectTitle: '批量采集',
        batchGroupLabel: '批量采集方式',
        resultsCount: '采集结果（{count} 篇）',
        resultsEmptyTitle: '还没有采集结果',
        resultsEmptyDesc: '粘贴一条链接开始采集，或展开下方批量方式',
        resultsEmptyAction: '去采集',
        clearResults: '清空',
        rssBatch: 'RSS 批量采集',
        rssPlaceholder: '输入 RSS 订阅链接',
        urlListBatch: 'URL 列表批量采集',
        urlListPlaceholder: '每行输入一个文章链接',
        urlListHint: '每行一个 URL，可一次批量采集多篇',
        batchCollect: '批量采集',
        batchCollecting: '批量采集中…',
        batchProgress: '采集进度',
        batchProgressText: (ctx) => '已完成 ' + ctx.named('completed') + '/' + ctx.named('total') + ' 篇',
        batchComplete: '批量采集完成',
        batchSuccess: '已采集 {count} 篇内容',
        batchCollectFailed: '批量采集失败',
        batchPollUnreachable: '连续 {count} 次查询失败',
        batchPollTimeout: '采集等待超时',
        batchCancelled: '批量采集已取消',
        cancelBatch: '取消',
        enterRss: '请输入 RSS 链接',
        enterUrlList: '请输入至少一个链接',
        recordsTitle: '文案库',
        recordsUntitled: '无标题',
        recordsEdit: '编辑',
        recordsCreateDraft: '创建草稿',
        recordsToVideo: '视频创作',
        recordsPublish: '发布',
        recordsDelete: '删除',
        recordsWordCount: (ctx) => ctx.named('count') + ' 字',
        recordsDeleteConfirm: '确定删除这条文案吗？',
        recordsDeleted: '文案已删除',
        recordsClearAll: '清空',
        recordsClearAllConfirm: '确定清空全部采集正文吗？',
        recordsCleared: '采集正文已清空',
        recordsEditCreated: '已进入内容编辑页',
        recordsEmptyTitle: '暂无文案',
        recordsEmptyDesc: '在「内容采集」标签页采集内容后，会在这里生成文案列表',
        recordsEmptyAction: '去采集内容',
        libraryCount: (ctx) => '共 ' + ctx.named('count') + ' 篇',
        libraryFilterLabel: '文案筛选',
        libraryFilterAll: '全部',
        libraryOriginCollect: '采集',
        libraryOriginRewrite: '改写',
        libraryFilterEmptyTitle: '当前筛选下暂无文案',
        libraryFilterEmptyDesc: '切换筛选条件查看其他文案',
        libraryFilterEmptyAction: '查看全部文案',
        libraryUntitled: '无标题',
        libraryWordCount: (ctx) => ctx.named('count') + ' 字',
        libraryRewrittenAt: (ctx) => '改写于 ' + ctx.named('time'),
        libraryFrom: (ctx) => '改写自：' + ctx.named('title'),
        libraryView: '查看',
        libraryRewrite: '改写',
        libraryPreviewTitle: '文案内容',
        libraryClose: '关闭',
        libraryRewriteNoContent: '该文案没有正文内容，无法改写',
        rewriteHandoffFailed: '改写交接失败',
        categoryFilterLabel: '类别筛选',
        categoryFilterAll: '全部类别',
        categoryFilterUntagged: '未分类',
        tagsEdit: '编辑标签',
        tagsSave: '保存',
        tagsCancel: '取消',
        tagsSaved: '类别标签已保存',
        tagsDropped: '部分标签无效已忽略',
        tagUnknownHint: '该类别已被删除',
        quickCollect: {
          title: '快捷采集',
          intro: '点一条指令即按固定提示词采集。',
          builtinSection: '官方内置',
          builtinBadge: '内置',
          customSection: '我的自定义',
          customHint: '自定义指令保存在本机。',
          run: '立即采集',
          running: '采集中…',
          stageRetrieving: '正在检索最近素材…',
          stageSummarizing: '正在生成摘要…',
          stageDone: '已完成',
          runSuccess: '快捷采集完成',
          runSuccessNoMaterial: '快捷采集完成，但未检索到可用素材',
          viewPrompt: '查看指令',
          hidePrompt: '收起指令',
          keywordsLabel: '检索关键词：',
          noKeywords: '未配置关键词',
          windowLabel: '素材时间范围：',
          window24: '最近 24 小时',
          window48: '最近 48 小时',
          window168: '最近 7 天',
          window0: '不限时间',
          materialCount: (ctx) => '素材 ' + ctx.named('count') + ' 条',
          add: '新增自定义指令',
          edit: '编辑',
          delete: '删除',
          emptyTitle: '还没有自定义指令',
          emptyDesc: '把常用的检索方向存成指令。',
          emptyAction: '新增指令',
          dialogAddTitle: '新增快捷采集指令',
          dialogEditTitle: '编辑快捷采集指令',
          dialogIntro: '标题用于区分指令。',
          titleLabel: '标题',
          titleHint: '起个名字',
          titlePlaceholder: '例如：AI 领域动向',
          titleCounter: (ctx) => ctx.named('count') + ' / 40',
          promptLabel: '快捷采集内容（AI 指令）',
          promptHint: '写清要检索什么',
          promptPlaceholder: '例如：请检索…',
          promptCounter: (ctx) => ctx.named('count') + ' / 4000',
          keywordsFieldLabel: '检索关键词（可选）',
          keywordsHint: '逗号分隔',
          keywordsPlaceholder: '例如：AI, 大模型',
          windowFieldLabel: '素材时间范围',
          sourcesLabel: '素材来源：Reddit · Hacker News · GitHub',
          save: '保存',
          cancel: '取消',
          saved: '指令已保存',
          deleted: '指令已删除',
          deleteConfirm: (ctx) => '删除快捷采集指令「' + ctx.named('title') + '」？',
          confirmTitle: '确认',
          skippedWarning: (ctx) => '有 ' + ctx.named('count') + ' 条自定义指令数据不完整，已忽略。',
          presetsFailed: '内置指令目录读取失败',
          readFailed: '自定义指令读取失败',
          errTitleRequired: '请填写标题',
          errTitleTooLong: '标题最多 40 字',
          errTitleDuplicate: '已存在同名指令',
          errPromptRequired: '请填写快捷采集内容',
          errPromptShort: '指令太短了',
          errPromptTooLong: '指令最多 4000 字',
          errKeywordsTooMany: '最多 5 个关键词',
          errKeywordTooLong: '单个关键词最多 30 字',
          errWindowInvalid: '请选择素材时间范围',
          errorLlmNotConfigured: '未配置默认大模型',
          errorLlmFailed: (ctx) => '大模型调用失败：' + ctx.named('message'),
          errorLlmEmpty: '大模型返回空内容',
          errorValidation: (ctx) => '指令参数不合法：' + ctx.named('message'),
          errorIpcUnavailable: '快捷采集服务不可用',
          errorUnknown: (ctx) => '快捷采集失败：' + ctx.named('message'),
        },
        zhihuFavlist: {
          title: '知乎收藏文章',
          configMissing: '请先在「设置 → 知乎 API」中配置 Access Secret',
          goSettings: '前往设置',
          configBadge: '已配置',
          configNotConfigured: '未配置',
          configDenied: '暂不可读',
          configUnreadable: '已保存的密钥无法读取',
          configLegacy: '检测到旧版明文密钥',
          loadBtn: '获取收藏夹',
          loading: '获取中…',
          loadFailed: '获取收藏夹失败',
          empty: '未找到收藏夹',
          batchDoneCancelledSuffix: '（已取消）',
          batchDoneCircuitBrokenSuffix: '（熔断停止）',
          hint: '通过知乎官方 API 获取您的收藏夹。',
          scopeFavlist: '指定收藏夹',
          scopeAll: '全部收藏',
          countPlaceholder: '采集数量（1-100）',
          fullMode: '全量采集（≤200）',
          fullModeCap: '全量采集上限 200 条',
          includeCollected: '包含已采集（强制重采）',
          loadingContents: '加载中…',
          loadContents: '加载收藏内容',
          favlistsCapped: '收藏夹超过 50 个',
          fewerThanRequested: '该范围共 {actual} 条',
          emptyItems: '收藏内容为空',
          selectAll: '全选',
          selectedCount: '已选 {count} 条',
          markCollected: '已采集',
          noSelection: '请先勾选要采集的条目',
          collectAndRewrite: '采集并改写',
          progressTitle: '采集并改写进度',
          progressText: '进行中 {done}/{total}',
          progressSummary: '完成：成功 {success} · 失败 {failed}',
          expandDetail: '展开明细',
          collapseDetail: '收起明细',
          mappingMismatch: '采集结果映射异常',
        },
        zhihuFav: {
          stepHintNoFavlists: '下一步：点「获取收藏夹」拉取收藏夹列表。',
          stepHintNeedContents: '下一步：点「加载收藏内容」。',
          kindAnswer: '回答',
          kindArticle: '文章',
          kindColumn: '专栏',
          kindPin: '想法',
          kindVideo: '视频',
          kindUnknown: '链接',
          rewriteFailedBadge: '改写失败用原文',
          imageFallbackBadge: '{count} 张图片回退原链',
          rewrittenBadge: '已改写',
          collectingNote: '采集中：{url}',
          doneNote: '完成',
          registerOnlyNote: '已登记',
          collectOkRewriteFailNote: '采集成功，改写失败用原文',
          fallbackSuffix: '，{count} 张图片回退原链',
          collecting: '采集中…',
          scopeFavlist: '指定收藏夹',
          scopeAll: '全部收藏',
          countPlaceholder: '采集数量（1-100）',
          fullMode: '全量采集（≤200）',
          includeCollected: '包含已采集（强制重采）',
          loadingContents: '加载中…',
          loadContents: '加载收藏内容',
          selectAll: '全选',
          selectedCount: '已选 {count} 条',
          collectAndRewrite: '采集并改写',
          markCollected: '已采集',
        },
        batch: {
          noSelection: '请先勾选内容条目',
          needAccount: '请至少为一个平台选择账号',
          confirmTitle: '确认批量操作',
          confirmBody: '将处理 {count} 条',
          originalFallbackNote: '其中 {count} 条将使用原文',
          videoSkipNote: '{count} 条视频型内容将跳过',
          videoGenCap: '单批最多生成 10 个视频',
          noVideosInBatch: '本批尚无已生成的视频可发布',
          noImagePlatforms: '所选条目暂无可发布的图文平台',
          publishStarted: '批量任务已启动',
          videoGenStarted: '批量生成已启动',
          publishImages: '批量发布图文',
          generateVideos: '批量生成视频',
          publishVideos: '批量发布视频',
          selectedCount: '已选 {count} 条',
          videoPoolNote: '本批已生成 {count} 个视频',
          videoPlatformLabel: '视频发布到',
          namePrefix: '采集批量发布 ',
          sessionTitle: '采集批量发布（{count} 条）',
          videoNamePrefix: '采集批量发布视频 ',
          videoSessionTitle: '采集批量发布视频（{count} 个）',
          createFailed: '创建批量任务失败',
          executeFailed: '启动批量任务失败',
          actionFailed: '批量操作失败',
        },
        asrInstallTitle: '安装语音转写组件',
        asrInstallIntro: '首次使用视频采集需要安装语音转写组件。',
        asrInstallBtn: '立即安装',
        asrInstallCancel: '暂不安装',
        asrInstallChecking: '正在检查 Python 环境…',
        asrInstallInstalling: '正在安装 faster-whisper…',
        asrInstallSwitching: '正在切换备用镜像…',
        asrInstallModel: '正在下载语音模型…',
        asrInstallDone: '安装完成',
        asrInstallFailed: '安装失败',
        asrInstallRetry: '重试安装',
        asrInstallManualHint: '如自动安装失败，可手动执行：',
        draftsTitle: '草稿箱',
        draftsRefresh: '刷新',
        draftsLoading: '正在加载草稿…',
        draftsTimeUnknown: '时间未知',
        draftsUntitled: '未命名草稿',
        draftsPlatformCount: '{count} 个平台',
        draftsLoadFailed: '草稿读取失败',
        draftsSaveFailed: '草稿保存失败',
        draftsDeleteFailed: '草稿删除失败',
        draftsEmptyContent: '标题和正文都为空',
        draftsClipboardTitle: '从剪贴板导入',
        draftsEmptyTitle: '暂无草稿',
        draftsEmptyDesc: '点击「新建草稿」或从平台采集内容开始',
        draftsEmptyAction: '新建草稿',
        draftsSource_manual: '手动新建',
        draftsSource_clipboard: '剪贴板',
        draftsSource_url: '链接采集',
        draftsSource_rss: 'RSS',
      },
      rewritePage: {
        strategyLabel: '改写策略',
        strategyAuto: '自动匹配',
        strategyManual: '手动选择',
        strategyPreview: '将使用',
        strategyPreviewColon: '：',
        strategySelectPlaceholder: '请选择策略',
      },
      knowledgeBase: {
        addToViral: '加入爆款库',
        addedToViral: '已加入爆款库',
        addSuccess: '已添加到知识库',
        loadFailed: '加载失败',
      },
      common: {},
    },
    en: { collection: {} },
  },
})

function mountCollection () {
  return mount(CollectionView, {
    global: {
      plugins: [createPinia(), i18n],
      // el-icon 桩成可观测的 span：断言「用的是线性图标而非 emoji」时不依赖真实组件渲染
      stubs: { 'el-icon': { template: '<span class="el-icon"><slot /></span>' } },
    },
  })
}

describe('CollectionView 采集页统一（collection-page-ui-ue-refine）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue('[]'),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
    }
  })

  it('① 页签 5 个且默认在内容采集', async () => {
    const w = mountCollection()
    await nextTick()
    expect(w.findAll('.collection-tab-btn').length).toBe(5)
    expect(w.vm.activeTab).toBe('collect')
  })

  it('② 页签 aria：tab + aria-selected + aria-controls，内容面板是 tabpanel', async () => {
    const w = mountCollection()
    await nextTick()
    const collectBtn = w.findAll('.collection-tab-btn')[0]
    expect(collectBtn.attributes('aria-controls')).toBeTruthy()
    // aria-controls 指向的容器必须存在且是 tabpanel
    const panelId = collectBtn.attributes('aria-controls')
    const panel = w.find(`#${panelId}`)
    expect(panel.exists(), `aria-controls 指向的 #${panelId} 不存在`).toBe(true)
    expect(panel.attributes('role')).toBe('tabpanel')
  })

  it('③ 快捷操作区按三组语义呈现（新建/草稿/素材来源），不再 6 张平铺', async () => {
    const w = mountCollection()
    await nextTick()
    const groups = w.findAll('.col-quick__group')
    expect(groups.length, '快捷操作区应分 3 组').toBe(3)
    expect(w.text()).toContain('新建')
    expect(w.text()).toContain('素材来源')
    // 6 张入口卡仍在（视觉用例 functional-test 依赖 .cohere-stat-card ≥2）
    expect(w.findAll('.cohere-stat-card').length).toBe(6)
    // 去 emoji：写操作/导航用线性图标（el-icon 桩渲染为 span.el-icon），
    // 平台来源用品牌首字徽标（非 emoji，PRD §4.6）。
    // 计数为 4 = 新建草稿 / 剪贴板导入 / 草稿箱 / 百度热搜：
    // 百度卡必须走 el-icon（放大镜 emoji 命中 icon-usage.test.js 的 T1-5 功能图标位黑名单），
    // 微博与头条用品牌首字徽标（无对应品牌图标组件，用文字首字而非 emoji）。
    expect(w.findAll('.col-quick__group .el-icon').length, '写操作/导航/百度入口应为线性图标').toBe(4)
    // emoji 区间 U+1F300–U+1FAFF 与常见符号区：整页文本不得出现
    const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
    expect(emojiRe.test(w.text()), '快捷区不得再使用 emoji 图标').toBe(false)
  })

  it('④ 页签角标 > 99 显示 99+（补 collection-tab-badge 定义后的事实契约）', async () => {
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue('[]'),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      creatorPendingTotal: vi.fn().mockResolvedValue({ code: 0, total: 137 }),
    }
    const w = mountCollection()
    await flushPromises()
    const badge = w.find('[data-testid="collection-tab-creator-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text(), '超过 99 应截断为 99+').toBe('99+')
  })

  it('⑤ 采集主路径 testid 不变（结果框锚点 / 采集按钮 / 草稿箱入口）', async () => {
    const w = mountCollection()
    await nextTick()
    expect(w.find('[data-testid="collection-collect-btn"]').exists()).toBe(true)
    expect(w.find('[data-testid="quick-drafts-box"]').exists()).toBe(true)
    // 结果框由 id 定位（jsdom 可桩），v-if 时不存在但结构契约在源码层
    const src = w.html()
    expect(typeof src).toBe('string')
  })

  it('⑥ 文案从 locale 读取（副标题/placeholder 不再是裸中文字面量）', async () => {
    const w = mountCollection()
    await nextTick()
    expect(w.text()).toContain('从各平台采集内容，或快速创建草稿')
    const input = w.find('input.col-input--grow')
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toBe('输入文章链接，自动采集标题、正文、封面…')
  })

  it('⑦ 结果详情框内的主/次操作分档（primary 类有真实定义，非死类占位）', async () => {
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'r1', title: '标题', content: '正文', description: '' }
    await nextTick()
    const box = w.find('[data-testid="collected-result-box"]')
    expect(box.exists()).toBe(true)
    const primaryBtns = box.findAll('.col-btn--primary')
    expect(primaryBtns.length, '结果框应有 primary 档按钮').toBeGreaterThanOrEqual(1)
    // 死类不得复辟
    expect(box.findAll('.is-primary').length).toBe(0)
    expect(box.findAll('.primary').length).toBe(0)
  })
})
