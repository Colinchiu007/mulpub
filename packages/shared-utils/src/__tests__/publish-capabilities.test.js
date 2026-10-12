/**
 * publish-capabilities.test.js — 发布能力注册表回归测试
 *
 * 注册表是 15 平台发布提交内容项的单一真源（openspec/changes/publish-capability-registry）：
 *   - titleMode（title | caption）：无标题平台标题必须合并进描述首行
 *   - limits：渲染层内容限制的唯一数据源（publish-contract.js 派生消费）
 *   - overrideFields：差异化面板数据驱动渲染的字段定义
 *   - commonFormFields：通用主表单字段支持矩阵
 *   - 分类规则：语义能力 ≥3 平台 → common；=2 → semiCommon；=1 → unique（用户 2026-10-08 确认阈值）
 */
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import {
  PLATFORM_PUBLISH_META,
  getPlatformPublishMeta,
  isNoTitlePlatform,
  getNoTitlePlatforms,
  getPlatformOverrideFields,
  classifyPublishFields,
  getFieldSupport,
  composeNoTitleDescription,
  getCommonFormFields,
  getPlatformContentLimit,
  validateRegistry,
  getVisibilityField,
  mapVisibilitySemantic,
  resolveVisibilityOverride,
  getVisibilitySemanticSupport,
} from '../publish-capabilities.js'
import * as browserModule from '../publish-capabilities.browser.js'

const ALL_PLATFORMS = [
  'wechat_mp', 'zhihu', 'weibo', 'douyin', 'xiaohongshu', 'tencent_video',
  'kuaishou', 'toutiao', 'bilibili', 'baijiahao', 'youtube', 'tiktok',
  'twitter', 'instagram', 'facebook',
]

describe('publish-capabilities — 平台元数据完整性', () => {
  it('覆盖全部 15 个支持平台，无缺失无多余', () => {
    expect(Object.keys(PLATFORM_PUBLISH_META).sort()).toEqual([...ALL_PLATFORMS].sort())
  })

  it('每个平台都有合法 titleMode 与内容限制', () => {
    for (const platform of ALL_PLATFORMS) {
      const meta = PLATFORM_PUBLISH_META[platform]
      expect(['title', 'caption']).toContain(meta.titleMode)
      expect(meta.limits).toBeDefined()
      expect(Number.isFinite(meta.limits.contentMax)).toBe(true)
      expect(meta.limits.contentMax).toBeGreaterThan(0)
    }
  })

  it('isNoTitlePlatform 与 titleMode=caption 等价', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(isNoTitlePlatform(platform)).toBe(PLATFORM_PUBLISH_META[platform].titleMode === 'caption')
    }
  })

  it('无标题平台清单精确等于 6 个（用户 2026-10-08 确认）', () => {
    expect(getNoTitlePlatforms().sort()).toEqual([
      'instagram', 'kuaishou', 'tencent_video', 'tiktok', 'twitter', 'weibo',
    ])
  })

  it('getPlatformPublishMeta 返回副本，调用方修改不污染全局', () => {
    const meta = getPlatformPublishMeta('wechat_mp')
    meta.limits.titleMax = 999
    meta.titleMode = 'caption'
    expect(PLATFORM_PUBLISH_META.wechat_mp.limits.titleMax).toBe(64)
    expect(PLATFORM_PUBLISH_META.wechat_mp.titleMode).toBe('title')
  })

  it('未知平台返回 null 而非崩溃', () => {
    expect(getPlatformPublishMeta('nonexistent')).toBeNull()
    expect(isNoTitlePlatform('nonexistent')).toBe(false)
    expect(getPlatformOverrideFields('nonexistent')).toEqual([])
  })
})

describe('publish-capabilities — 内容限制对齐表（design §5）', () => {
  it.each([
    ['wechat_mp', { titleMax: 64, contentMax: 20000 }],
    ['zhihu', { titleMax: 50, contentMax: 100000 }],
    // 2026-10-02 修正：微博客服中心官方 FAQ（kefu.weibo.com/faqdetail?id=21510，
    // 2024-09-04 更新）原文「最多可以发布5000汉字」——注册表旧值 2000 与
    // platforms.yaml(5000)/引擎表 均不一致，属三源漂移中本表落后，与官方口径对齐。
    ['weibo', { titleMax: 0, contentMax: 10000 }],
    // 修复项：渲染层旧值 contentMax=0（不校验）→ 1000（platforms.yaml + 引擎一致）
    // 2026-10-01 修正：这三项原为 1000（无平台依据），平台真实上限更高
    // （抖音长图文实测可 8000 字），故放宽到 5000。
    ['douyin', { titleMax: 55, contentMax: 5000 }],
    ['xiaohongshu', { titleMax: 20, contentMax: 5000 }],
    // 补齐项：渲染层旧表缺条目回落默认 5000 → 1000（platforms.yaml）
    ['tencent_video', { titleMax: 0, contentMax: 5000 }],
    // 2026-10-01 修正：与 platforms.yaml 的实测值对齐（快手发布页计数器 x/500，
    // 921 字即被平台红字阻断；取 480 留 20 字边距）。此前 json 写 1000 属两源漂移，
    // 导致按其裁剪后仍超平台上限而被静默拒绝。
    ['kuaishou', { titleMax: 0, contentMax: 480 }],
    ['toutiao', { titleMax: 30, contentMax: 100000 }],
    ['bilibili', { titleMax: 80, contentMax: 2000 }],
    ['youtube', { titleMax: 100, contentMax: 5000 }],
    // 修复项：旧表 title 2200/content 0 → caption 语义 contentMax 2200
    ['tiktok', { titleMax: 0, contentMax: 2200 }],
    ['twitter', { titleMax: 0, contentMax: 280 }],
    ['instagram', { titleMax: 0, contentMax: 2200 }],
    // 补齐项：渲染层旧表缺条目 → platforms.yaml 真实值
    ['facebook', { titleMax: 100, contentMax: 63206 }],
  ])('%s 限制 = %j', (platform, expected) => {
    const meta = getPlatformPublishMeta(platform)
    expect(meta.limits.titleMax).toBe(expected.titleMax)
    expect(meta.limits.contentMax).toBe(expected.contentMax)
  })

  it('百家号按 UTF-8 字节数校验标题（titleMaxBytes=149）', () => {
    const limit = getPlatformContentLimit('baijiahao')
    expect(limit.titleMaxBytes).toBe(149)
    expect(limit.contentMax).toBe(100000)
  })

  it('getPlatformContentLimit 对无条目平台不再回落 5000 默认（注册表全覆盖）', () => {
    for (const platform of ALL_PLATFORMS) {
      const limit = getPlatformContentLimit(platform)
      expect(limit.contentMax).toBeGreaterThan(0)
    }
  })
})

describe('publish-capabilities — 语义分类（3+ 阈值）', () => {
  it('合集语义 5 平台 → common（B站/YouTube/百家号 implemented + 快手/视频号 platform-capable）', () => {
    const support = getFieldSupport('collection')
    expect(support.count).toBe(5)
    expect(support.platforms.sort()).toEqual(['baijiahao', 'bilibili', 'kuaishou', 'tencent_video', 'youtube'])
    expect(classifyPublishFields().common.map(f => f.semantic)).toContain('collection')
  })

  it('可见性语义 5 平台 → common（参考产品证据：抖音/快手/微博也支持）', () => {
    const support = getFieldSupport('visibility')
    expect(support.count).toBe(5)
    expect(support.platforms.sort()).toEqual(['douyin', 'kuaishou', 'tiktok', 'weibo', 'youtube'])
    expect(classifyPublishFields().common.map(f => f.semantic)).toContain('visibility')
  })

  it('位置语义 3 平台 → common（百家号 implemented + 快手/视频号 platform-capable）', () => {
    expect(getFieldSupport('location').count).toBe(3)
    expect(classifyPublishFields().common.map(f => f.semantic)).toContain('location')
  })

  it('商品语义 4 平台 → common（抖音/小红书 implemented + 快手/视频号 platform-capable）', () => {
    expect(getFieldSupport('goods').count).toBe(4)
    expect(classifyPublishFields().common.map(f => f.semantic)).toContain('goods')
  })

  it('平台活动语义 3 平台 → common（抖音/快手/视频号 platform-capable）', () => {
    expect(getFieldSupport('activity').count).toBe(3)
    expect(classifyPublishFields().common.map(f => f.semantic)).toContain('activity')
  })

  it('评论控制语义 3 平台 → common（公众号/知乎 implemented + B站 platform-capable）', () => {
    expect(getFieldSupport('comment-control').count).toBe(3)
    expect(classifyPublishFields().common.map(f => f.semantic)).toContain('comment-control')
  })

  it('下载权限语义 2 平台 → semiCommon（抖音/快手 platform-capable）', () => {
    expect(getFieldSupport('download').count).toBe(2)
    expect(classifyPublishFields().semiCommon.map(f => f.semantic)).toContain('download')
  })

  it('配乐语义 2 平台 → semiCommon（抖音/视频号 platform-capable）', () => {
    expect(getFieldSupport('music').count).toBe(2)
    expect(classifyPublishFields().semiCommon.map(f => f.semantic)).toContain('music')
  })

  it('分类语义 2 平台 → semiCommon（B站/YouTube）', () => {
    expect(getFieldSupport('category').count).toBe(2)
    expect(classifyPublishFields().semiCommon.map(f => f.semantic)).toContain('category')
  })

  it('原创声明语义 2 平台 → semiCommon（B站版权/百家号原创）', () => {
    expect(getFieldSupport('originality').count).toBe(2)
    expect(classifyPublishFields().semiCommon.map(f => f.semantic)).toContain('originality')
  })

  it('摘要语义 1 平台 → unique（公众号）', () => {
    expect(getFieldSupport('digest').count).toBe(1)
    expect(classifyPublishFields().unique.map(f => f.semantic)).toContain('digest')
  })

  it('标题/正文/定时为通用语义（15 平台）', () => {
    expect(getFieldSupport('title').count).toBe(15)
    expect(getFieldSupport('content').count).toBe(15)
    expect(getFieldSupport('schedule').count).toBe(15)
  })

  it('AI 声明恰好 3 平台（快手/B站/百家号）→ common', () => {
    expect(getFieldSupport('ai-declaration').count).toBe(3)
    expect(getFieldSupport('ai-declaration').platforms.sort()).toEqual(['baijiahao', 'bilibili', 'kuaishou'])
    expect(classifyPublishFields().common.map(f => f.semantic)).toContain('ai-declaration')
  })

  it('草稿语义 5 平台 → common（知乎/抖音/B站/视频号/公众号）', () => {
    expect(getFieldSupport('draft').count).toBe(5)
    expect(classifyPublishFields().common.map(f => f.semantic)).toContain('draft')
  })

  it('分类是计算属性：每个语义恰好归入一类', () => {
    const { common, semiCommon, unique } = classifyPublishFields()
    const all = [...common, ...semiCommon, ...unique]
    const semantics = all.map(f => f.semantic)
    expect(new Set(semantics).size).toBe(semantics.length) // 无重复
    for (const field of all) {
      expect(field.count).toBe(getFieldSupport(field.semantic).count)
    }
  })

  it('分类条目携带 status 汇总（P1-5 后 visibility 五平台全部 implemented）', () => {
    const visibility = classifyPublishFields().common.find(f => f.semantic === 'visibility')
    // P1-5（2026-10-09）打通 douyin/kuaishou/weibo 的 resolver→引擎链路后，
    // visibility 语义五平台（youtube/tiktok/douyin/kuaishou/weibo）全部转 implemented；
    // 此前为 ['implemented','implemented', 三个 'platform-capable']。
    expect(visibility.statuses).toEqual(['implemented', 'implemented', 'implemented', 'implemented', 'implemented'])
  })
})

describe('publish-capabilities — 差异化字段定义', () => {
  it('每平台字段定义结构合法（key/semantic/status/type/label）', () => {
    const validTypes = ['text', 'textarea', 'select', 'checkbox', 'tags', 'collection', 'object', 'object-list', 'image']
    for (const platform of ALL_PLATFORMS) {
      for (const field of getPlatformOverrideFields(platform)) {
        expect(typeof field.key).toBe('string')
        expect(field.key.length).toBeGreaterThan(0)
        expect(typeof field.semantic).toBe('string')
        expect(['implemented', 'platform-capable']).toContain(field.status)
        expect(validTypes).toContain(field.type)
        expect(typeof field.label).toBe('string')
        expect(field.label.length).toBeGreaterThan(0)
        expect('default' in field).toBe(true)
        expect(typeof field.uiExposed).toBe('boolean')
      }
    }
  })

  it('platform-capable 字段必须带证据说明（note）', () => {
    for (const platform of ALL_PLATFORMS) {
      for (const field of getPlatformOverrideFields(platform)) {
        if (field.status !== 'platform-capable') continue
        expect(typeof field.note).toBe('string')
        expect(field.note.length).toBeGreaterThan(0)
      }
    }
  })

  it('select 字段必须带 options 且 default 在 options 值集内', () => {
    for (const platform of ALL_PLATFORMS) {
      for (const field of getPlatformOverrideFields(platform)) {
        if (field.type !== 'select') continue
        expect(Array.isArray(field.options)).toBe(true)
        expect(field.options.length).toBeGreaterThan(0)
        const values = field.options.map(o => o.value)
        expect(values).toContain(field.default)
      }
    }
  })

  it('UI 未暴露能力全量收录：抖音商品/任务/可见性/合作投稿、小红书商品标记 uiExposed=false', () => {
    const douyinKeys = getPlatformOverrideFields('douyin').map(f => f.key)
    expect(douyinKeys).toContain('goods')
    expect(douyinKeys).toContain('taskId')
    expect(douyinKeys).toContain('visibilityType')
    expect(douyinKeys).toContain('cooperationInfo')
    const goods = getPlatformOverrideFields('douyin').find(f => f.key === 'goods')
    expect(goods.uiExposed).toBe(false)
    const xhsGoods = getPlatformOverrideFields('xiaohongshu').find(f => f.key === 'goods')
    expect(xhsGoods.uiExposed).toBe(false)
  })

  it('参考产品证据字段未打通前必须标 platform-capable 且不进 UI 渲染集', () => {
    // P1-5 后 visibility 已打通（见下方专项断言），此处用仍未实现的取证字段守锁：
    // 未接线的取证字段不得混进 UI 渲染集，否则用户会看到「设置了不生效」的假控件。
    const weiboVote = getPlatformOverrideFields('weibo').find(f => f.key === 'vote')
    expect(weiboVote.status).toBe('platform-capable')
    expect(weiboVote.uiExposed).toBe(false)
    const biliDanmu = getPlatformOverrideFields('bilibili').find(f => f.key === 'upCloseDanmu')
    expect(biliDanmu.status).toBe('platform-capable')
    expect(biliDanmu.uiExposed).toBe(false)
    const douyinGoods = getPlatformOverrideFields('douyin').find(f => f.key === 'goods')
    expect(douyinGoods.status).toBe('implemented')
    expect(douyinGoods.uiExposed).toBe(false)
  })

  it('P1-5：visibility 字段五平台均已 implemented 且进 UI 渲染集（可单平台细调）', () => {
    for (const platform of ['youtube', 'tiktok', 'douyin', 'kuaishou', 'weibo']) {
      const field = getPlatformOverrideFields(platform).find(f => f.semantic === 'visibility')
      expect(field, platform + ' 缺 visibility 字段').toBeTruthy()
      expect(field.status, platform + ' visibility 应已实现').toBe('implemented')
      expect(field.uiExposed, platform + ' visibility 应进 UI 渲染集').toBe(true)
      // 进 UI 渲染集 ⇒ uiOnly 查询必须能取到（否则控件不渲染，映射无入口）
      const uiFields = getPlatformOverrideFields(platform, { uiOnly: true }).map(f => f.key)
      expect(uiFields).toContain(field.key)
    }
  })

  it('既有 8 平台差异化字段零丢失（重构快照，按 uiExposed 过滤）', () => {
    const keysOf = platform => getPlatformOverrideFields(platform).filter(f => f.uiExposed).map(f => f.key)
    // wechat-mp-publish-track：新增 freePublish（发布，不推送粉丝），与 massSend 互斥、群发优先
    expect(keysOf('wechat_mp').sort()).toEqual(['digest', 'freePublish', 'massSend', 'openComment'])
    expect(keysOf('zhihu').sort()).toEqual(['commentPermission', 'declare', 'draft', 'topics'])
    // P1-5：抖音/快手/微博的 visibility 打通后进 UI 渲染集（此前为空）
    expect(keysOf('douyin').sort()).toEqual(['draft', 'visibilityType'])
    expect(keysOf('bilibili').sort()).toEqual(['category', 'collectionId', 'copyright'])
    expect(keysOf('youtube').sort()).toEqual(['categoryId', 'playlistId', 'privacy'])
    expect(keysOf('tiktok')).toEqual(['privacyLevel'])
    expect(keysOf('baijiahao').sort()).toEqual(['collectionIdText', 'locationName', 'original'])
    expect(keysOf('weibo')).toEqual(['visible'])
    expect(keysOf('tencent_video')).toEqual([])
    expect(keysOf('kuaishou')).toEqual(['visibilityType'])
  })

  it('getPlatformOverrideFields 返回副本', () => {
    const fields = getPlatformOverrideFields('zhihu')
    fields.push({ key: 'injected' })
    expect(getPlatformOverrideFields('zhihu').length).toBe(6)
  })

  it('CCG W5 回归：副本深拷贝——突变 options/default 不污染注册表', () => {
    const first = getPlatformOverrideFields('zhihu')
    const declareField = first.find(f => f.key === 'declare')
    const topicsField = first.find(f => f.key === 'topics')
    // 突变返回副本的 options 选项对象与 default 数组
    declareField.options[0].value = 999
    declareField.options.push({ value: 888, label: '注入' })
    topicsField.default.push('注入话题')
    // 后续调用不得看到任何突变（浅拷贝会经共享引用泄漏）
    const second = getPlatformOverrideFields('zhihu')
    expect(second.find(f => f.key === 'declare').options[0].value).toBe(0)
    expect(second.find(f => f.key === 'declare').options.length).toBe(6)
    expect(second.find(f => f.key === 'topics').default).toEqual([])
    // 双版本同口径（ESM 侧同样不得泄漏）
    const browserFields = browserModule.getPlatformOverrideFields('zhihu')
    browserFields.find(f => f.key === 'declare').options[0].value = 777
    expect(browserModule.getPlatformOverrideFields('zhihu').find(f => f.key === 'declare').options[0].value).toBe(0)
  })
})

describe('publish-capabilities — 通用主表单字段支持矩阵', () => {
  it('通用字段全部 ≥3 平台支持（阈值自洽）', () => {
    for (const field of getCommonFormFields()) {
      expect(field.platforms.length).toBeGreaterThanOrEqual(3)
      for (const platform of field.platforms) {
        expect(ALL_PLATFORMS).toContain(platform)
      }
    }
  })

  it('标题字段覆盖 15 平台（无标题平台走合并口径）', () => {
    const title = getCommonFormFields().find(f => f.key === 'title')
    expect(title.platforms.length).toBe(15)
    expect(title.noTitleBehavior).toBe('caption-first-line')
  })

  // 2026-10-06 定时发布验证发现：注册表 schedule.note 曾声称「平台原生定时：抖音 timing、
  // 2026-10-07 架构变更：定时发布改为「平台侧定时」——创建时把排期提交给平台，
  // 由平台服务器到点发布（不再由本地定时器到点触发）。
  // 逐平台能力真源改由 platform-schedule-capability.js 承担（api / rpa / unsupported 三态）；
  // 本字段的 platforms 列表只表示「这些平台的发布链路接入定时」，不再表示定时触发方式。
  it('schedule 字段说明反映平台侧定时语义，且不再声称本地定时器到点触发', () => {
    const schedule = getCommonFormFields().find(f => f.key === 'schedule')
    expect(schedule).toBeTruthy()
    expect(schedule.note).toContain('平台侧定时')
    expect(schedule.note).not.toContain('本地 setTimeout')
    expect(schedule.note).not.toMatch(/平台原生定时：/)
  })

  it('平台侧定时能力注册表存在且自检通过（逐平台三态，禁止缺省为支持）', () => {
    const {
      validateScheduleCapabilityRegistry,
      getPlatformScheduleCapability,
      resolveScheduleMode
    } = require('../platform-schedule-capability')
    expect(validateScheduleCapabilityRegistry()).toEqual([])
    // 未取证的平台一律 unsupported —— 绝不静默立即发布
    expect(getPlatformScheduleCapability('zhihu').mode).toBe('unsupported')
    expect(getPlatformScheduleCapability('some-unknown').mode).toBe('unsupported')
    expect(resolveScheduleMode('some-unknown')).toBe('blocked')
  })

  // 旧锁（本地调度方案下的实证锁）已随架构变更加重写：平台侧定时的正确形态是
  // 「调度器把 publishTime 透传给 publisher，publisher 组装平台字段」，
  // 而不是 publisher 内部硬编码某个竞品的字段名。下列锁改为检查这条透传链存在。
  it('publisher 链路已具备 publishTime 透传（平台侧定时装配的前置条件）', () => {
    const fs = require('fs')
    const path = require('path')
    const routerFile = path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'desktop', 'electron', 'services', 'publisher-router.js')
    expect(fs.existsSync(routerFile), 'publisher-router.js 应存在').toBe(true)
    const src = fs.readFileSync(routerFile, 'utf8')
    // buildPublishArticle 必须把 task.publishTime 搬进 article，否则各 publisher 收不到时间
    expect(src).toMatch(/publishTime:\s*task\?\./)
  })
})

describe('publish-capabilities — composeNoTitleDescription', () => {
  it('标题与正文都有：标题为首行', () => {
    expect(composeNoTitleDescription('标题', '正文')).toBe('标题\n正文')
  })

  it('仅标题：即描述全文', () => {
    expect(composeNoTitleDescription('标题', '')).toBe('标题')
  })

  it('仅正文：原样返回', () => {
    expect(composeNoTitleDescription('', '正文')).toBe('正文')
  })

  it('两者皆空：空字符串', () => {
    expect(composeNoTitleDescription('', '')).toBe('')
  })

  it('null/undefined 输入安全', () => {
    expect(composeNoTitleDescription(null, undefined)).toBe('')
    expect(composeNoTitleDescription('T', null)).toBe('T')
  })

  it('超长截断：标题优先存活', () => {
    const composed = composeNoTitleDescription('十个字标题十个字标题', '正文'.repeat(20), { maxLen: 15 })
    expect(composed.length).toBeLessThanOrEqual(15)
    expect(composed.startsWith('十个字标题')).toBe(true)
  })

  it('maxLen 缺省或非正数：不截断', () => {
    expect(composeNoTitleDescription('T', 'C')).toBe('T\nC')
    expect(composeNoTitleDescription('T', 'C', { maxLen: 0 })).toBe('T\nC')
    expect(composeNoTitleDescription('T', 'C', { maxLen: -1 })).toBe('T\nC')
  })

  it('截断不切断代理对（emoji）', () => {
    const composed = composeNoTitleDescription('😀😀😀', '😀'.repeat(10), { maxLen: 4 })
    expect(Array.from(composed).length).toBeLessThanOrEqual(4)
  })
})

describe('publish-capabilities — 注册表结构自检与双版本 parity', () => {
  it('validateRegistry 无问题', () => {
    expect(validateRegistry()).toEqual([])
  })

  it('浏览器版（ESM）导出与 CJS 版同名同构', () => {
    const exports = [
      'PLATFORM_PUBLISH_META',
      'NO_TITLE_PLATFORMS',
      'getPlatformPublishMeta',
      'isNoTitlePlatform',
      'getNoTitlePlatforms',
      'getPlatformContentLimit',
      'getPlatformOverrideFields',
      'getCommonFormFields',
      'getFieldSupport',
      'classifyPublishFields',
      'composeNoTitleDescription',
      'validateRegistry',
      // P1-5 语义级可见性
      'getVisibilityField',
      'mapVisibilitySemantic',
      'resolveVisibilityOverride',
      'getVisibilitySemanticSupport',
    ]
    for (const name of exports) {
      expect(browserModule).toHaveProperty(name)
    }
    expect(Object.keys(browserModule.PLATFORM_PUBLISH_META).sort())
      .toEqual(Object.keys(PLATFORM_PUBLISH_META).sort())
    expect(browserModule.getNoTitlePlatforms().sort()).toEqual(getNoTitlePlatforms().sort())
    expect(browserModule.validateRegistry()).toEqual([])
  })

  it('双版本函数行为一致（分类 / 合成 / 限制）', () => {
    expect(browserModule.classifyPublishFields()).toEqual(classifyPublishFields())
    expect(browserModule.composeNoTitleDescription('T', 'C', { maxLen: 3 })).toBe(composeNoTitleDescription('T', 'C', { maxLen: 3 }))
    expect(browserModule.getPlatformContentLimit('tiktok')).toEqual(getPlatformContentLimit('tiktok'))
    expect(browserModule.getFieldSupport('visibility')).toEqual(getFieldSupport('visibility'))
    expect(browserModule.getPlatformOverrideFields('zhihu', { uiOnly: true }))
      .toEqual(getPlatformOverrideFields('zhihu', { uiOnly: true }))
  })

  it('CCG codex Info2：双版本全平台穷举 parity（防 ESM 孪生局部漂移）', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(browserModule.getPlatformPublishMeta(platform)).toEqual(getPlatformPublishMeta(platform))
      expect(browserModule.isNoTitlePlatform(platform)).toBe(isNoTitlePlatform(platform))
      expect(browserModule.getPlatformContentLimit(platform)).toEqual(getPlatformContentLimit(platform))
      expect(browserModule.getPlatformOverrideFields(platform)).toEqual(getPlatformOverrideFields(platform))
      expect(browserModule.getPlatformOverrideFields(platform, { uiOnly: true }))
        .toEqual(getPlatformOverrideFields(platform, { uiOnly: true }))
    }
    expect(browserModule.getCommonFormFields()).toEqual(getCommonFormFields())
  })
})

// P1-5 语义级可见性（通用控件）：5 平台字段名/取值各不相同，用户不应逐平台理解
// 平台取值；semanticValues 声明 public/friends/private → 平台值的映射，本层是单一真源。
describe('publish-capabilities — P1-5 语义级可见性映射', () => {
  const VISIBILITY_PLATFORMS = ['youtube', 'tiktok', 'douyin', 'kuaishou', 'weibo']

  it('5 平台各有一个 visibility 语义字段，带 semanticValues', () => {
    for (const platform of VISIBILITY_PLATFORMS) {
      const field = getVisibilityField(platform)
      expect(field, platform + ' 缺少 visibility 字段').toBeTruthy()
      expect(field.semanticValues, platform + ' 缺少 semanticValues').toBeTruthy()
      expect(Object.keys(field.semanticValues)).toEqual(expect.arrayContaining(['public', 'private']))
    }
  })

  it('公开/私密两档 5 平台全支持且映射到各自平台值', () => {
    expect(mapVisibilitySemantic('youtube', 'public')).toBe('public')
    expect(mapVisibilitySemantic('youtube', 'private')).toBe('private')
    expect(mapVisibilitySemantic('tiktok', 'public')).toBe('PUBLIC')
    expect(mapVisibilitySemantic('tiktok', 'private')).toBe('PRIVATE')
    expect(mapVisibilitySemantic('douyin', 'public')).toBe(0)
    expect(mapVisibilitySemantic('douyin', 'private')).toBe(1)
    expect(mapVisibilitySemantic('kuaishou', 'public')).toBe(1)
    expect(mapVisibilitySemantic('kuaishou', 'private')).toBe(2)
    expect(mapVisibilitySemantic('weibo', 'public')).toBe(0)
    expect(mapVisibilitySemantic('weibo', 'private')).toBe(1)
  })

  it('好友档仅三平台支持（tiktok/douyin/weibo）；快手与 YouTube 返回 null（fail-closed）', () => {
    expect(mapVisibilitySemantic('tiktok', 'friends')).toBe('FRIENDS')
    expect(mapVisibilitySemantic('douyin', 'friends')).toBe(2)
    expect(mapVisibilitySemantic('weibo', 'friends')).toBe(6)
    expect(mapVisibilitySemantic('kuaishou', 'friends')).toBeNull()
    expect(mapVisibilitySemantic('youtube', 'friends')).toBeNull()
  })

  it('非法档位/未知平台一律 null（不抛错，调用点据此跳过）', () => {
    expect(mapVisibilitySemantic('youtube', 'secret')).toBeNull()
    expect(mapVisibilitySemantic('youtube', '')).toBeNull()
    expect(mapVisibilitySemantic('youtube', null)).toBeNull()
    expect(mapVisibilitySemantic('unknown_platform', 'public')).toBeNull()
    expect(mapVisibilitySemantic(null, 'public')).toBeNull()
    expect(resolveVisibilityOverride('unknown_platform', 'public')).toBeNull()
  })

  it('resolveVisibilityOverride 返回写 override 模型所需的 fieldKey+value', () => {
    expect(resolveVisibilityOverride('youtube', 'private')).toEqual({ fieldKey: 'privacy', value: 'private' })
    expect(resolveVisibilityOverride('tiktok', 'friends')).toEqual({ fieldKey: 'privacyLevel', value: 'FRIENDS' })
    expect(resolveVisibilityOverride('douyin', 'public')).toEqual({ fieldKey: 'visibilityType', value: 0 })
    expect(resolveVisibilityOverride('kuaishou', 'private')).toEqual({ fieldKey: 'visibilityType', value: 2 })
    expect(resolveVisibilityOverride('weibo', 'friends')).toEqual({ fieldKey: 'visible', value: 6 })
    // 快手无好友档 → 不产出写入指令
    expect(resolveVisibilityOverride('kuaishou', 'friends')).toBeNull()
  })

  it('getVisibilitySemanticSupport 给出各档位支持平台清单', () => {
    const support = getVisibilitySemanticSupport()
    expect(support.public.sort()).toEqual([...VISIBILITY_PLATFORMS].sort())
    expect(support.private.sort()).toEqual([...VISIBILITY_PLATFORMS].sort())
    expect(support.friends.sort()).toEqual(['douyin', 'tiktok', 'weibo'])
  })

  it('规模下界：映射表不得退化成空集（空表会让上述断言恒真）', () => {
    const support = getVisibilitySemanticSupport()
    expect(support.public.length).toBeGreaterThanOrEqual(5)
    expect(support.friends.length).toBeGreaterThanOrEqual(3)
  })

  it('ESM 孪生与 CJS 同结论（穷举平台 × 档位）', () => {
    for (const platform of [...VISIBILITY_PLATFORMS, 'zhihu', 'unknown']) {
      for (const semantic of ['public', 'friends', 'private', 'bogus']) {
        expect(browserModule.mapVisibilitySemantic(platform, semantic)).toEqual(mapVisibilitySemantic(platform, semantic))
        expect(browserModule.resolveVisibilityOverride(platform, semantic)).toEqual(resolveVisibilityOverride(platform, semantic))
      }
      expect(browserModule.getVisibilityField(platform)).toEqual(getVisibilityField(platform))
    }
    expect(browserModule.getVisibilitySemanticSupport()).toEqual(getVisibilitySemanticSupport())
  })

  it('validateRegistry 拦截 semanticValues 指向不存在 options 值的漂移', () => {
    // 反证：注册表当前干净
    expect(validateRegistry()).toEqual([])
    // 该断言由 validateRegistry 的 semanticValues 校验实现；
    // 变异验证方式见 .quality-gates.md 本轮记录（把 youtube private 改成 'nope' 必红）
  })
})

// 2026-10-01 复查补建：config/platforms.yaml 的 max_content 与注册表 contentMax 历史上存在
// **6 处漂移**（zhihu/weibo/toutiao/bilibili/baijiahao/twitter），而前端校验消费的是**注册表**
// 那份 ⇒ yaml 错值会表现为"某条链路静默失败"。本锁把两份真源钉在一起，任一方单改都变红。
const YAML_PATH = path.resolve(__dirname, '../../../../config/platforms.yaml')
const YAML_PLATFORMS = (yaml.load(fs.readFileSync(YAML_PATH, 'utf-8')) || {}).platforms || {}

describe('publish-capabilities — platforms.yaml 与注册表 max_content 对齐锁', () => {
  it('yaml 的平台段在注册表中都存在（无多余/拼错）', () => {
    expect(Object.keys(YAML_PLATFORMS).filter((id) => !PLATFORM_PUBLISH_META[id])).toEqual([])
  })

  it.each(Object.keys(YAML_PLATFORMS))('%s 的 max_content 与注册表 contentMax 一致', (id) => {
    expect(Number(YAML_PLATFORMS[id].max_content)).toBe(Number(PLATFORM_PUBLISH_META[id].limits.contentMax))
  })

  it('反证与防失明：平台段数下界 15，且 kuaishou 实测值固定 480', () => {
    // 防"解析退化成空集合即假绿"
    expect(Object.keys(YAML_PLATFORMS).length).toBeGreaterThanOrEqual(15)
    expect(Number(YAML_PLATFORMS.kuaishou.max_content)).toBe(480)
  })
})
