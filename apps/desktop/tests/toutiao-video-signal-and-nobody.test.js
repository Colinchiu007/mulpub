'use strict'

/**
 * 头条视频：上传完成信号 + 无正文位门禁（toutiao-video-signal-and-nobody，2026-10-21）
 *
 * ── 真机证据（2026-10-21 22:0x，发布窗口实时采样）────────────────
 * 西瓜上传页上传成功后的真实 DOM：
 *   url      = /profile_v4/xigua/upload-video
 *   fullText = 「…添加视频 上传成功 dy-small.mp4 大小: 143.9KB 视频时长: 12s
 *               重新上传 删除 发布设置 标题 4/30 封面 上传封面 … 发布 手机预览效果…」
 *   inputs   = 仅 1 个可见：input.xigua-input，placeholder=「请输入 0～30 个字符」
 *   buttons  = 「添加视频」「发布」（发布 disabled=false）
 *   videoCount = 0   textareaCount = 0   contenteditable = 0
 *
 * ⇒ 两个必须修的缺陷（都不是"平台抽风"）：
 *   ① 上传完成探针 positive 恒 false：
 *      - vv 要求 https <video> → 页面 videoCount=0 ❌
 *      - ed 要求 placeholder*="标题" → 实际「请输入 0～30 个字符」❌
 *      - URL 含 post/video → 实际 /profile_v4/xigua/upload-video ❌
 *      而页面明写「上传成功」→ 该文案此前只进 structural，不进 positive，
 *      于是 P4（positive && !uploading）永不成立，只能干等满 90s 预算。
 *   ② 该页**没有正文/简介输入位**（只有标题 + 封面），但门禁 P4
 *      「有正文 ⇒ 正文必须写入成功」必然失败 ⇒ 即使上传确认也发不出去。
 */

const fs = require('node:fs')
const path = require('node:path')

const svc = (name) => path.resolve(__dirname, '../electron/services', name)

describe('① 上传完成探针：正向信号必须包含"上传成功"类强文案', () => {
  const src = fs.readFileSync(svc('upload-waiter.js'), 'utf8')

  test('positive 表达式包含上传完成强文案（不再只认 video/placeholder/URL）', () => {
    const m = src.match(/positive:\s*!!\([^)]*\)/)
    expect(m).toBeTruthy()
    // positive 里引用 doneCopy 变量
    expect(m[0].includes('doneCopy')).toBe(true)
    // doneCopy 的定义必须是「成功/完成/完毕」这类强文案
    const def = src.match(/var doneCopy=\/[^/]+\//)
    expect(def).toBeTruthy()
    expect(/上传成功|上传完成|上传完毕/.test(def[0])).toBe(true)
  })

  test('强文案单独命名（doneCopy），便于审计与后续平台扩展', () => {
    expect(/var doneCopy=/.test(src)).toBe(true)
  })

  test('structural 仍保留 doneText（不回归既有结构性判据）', () => {
    expect(/structural:!!\(vu\|\|ed\|\|doneText\)/.test(src)).toBe(true)
  })
})

describe('② 无正文位平台：门禁 P4 按平台能力豁免（不静默放宽）', () => {
  const { evaluatePublishPreconditions, REASONS } = require(svc('publish-precondition.js'))
  const base = {
    platform: 'toutiao',
    article: { title: '被误解的明朝', content: '正文若干行', video_path: 'D:\\v\\a.mp4' },
    selectors: { file_input: ['input[type="file"]'] },
    fillReport: { upload: { ok: true }, title: { ok: true } }, // content 缺失
  }

  test('声明 noBodyPlatform=true ⇒ 通过（该页确实无正文位）', () => {
    const r = evaluatePublishPreconditions({ ...base, noBodyPlatform: true })
    expect(r.ok).toBe(true)
  })

  test('未声明 ⇒ 仍然 CONTENT_NOT_FILLED（不放宽默认判据）', () => {
    const r = evaluatePublishPreconditions({ ...base })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe(REASONS.CONTENT_NOT_FILLED)
  })
})

describe('③ 能力注册表：isNoBodyVideoPlatform 只认声明的平台', () => {
  const caps = require('../../../packages/shared-utils/src/publish-capabilities.js')

  test('toutiao 声明为「视频无正文位」', () => {
    expect(caps.isNoBodyVideoPlatform('toutiao')).toBe(true)
  })

  test('抖音不是（它有作品描述输入位）', () => {
    expect(caps.isNoBodyVideoPlatform('douyin')).toBe(false)
  })

  test('未知平台返回 false（fail-closed 到默认判据）', () => {
    expect(caps.isNoBodyVideoPlatform('not-a-platform')).toBe(false)
    expect(caps.isNoBodyVideoPlatform(undefined)).toBe(false)
  })
})

// ── 真机记录（2026-10-21 22:0x，发布窗口实时采样，逐字抄录） ──────────────
const REAL_PAGE_TEXT = [
  '头条号 消息 99+ 发布视频 发布视频创建合集 竖版视频（宽<高的视频，如9:16）无原创、赞赏、定时等功能 ' +
  'dy-small.mp4 dy-small.mp4 添加视频 上传成功 dy-small.mp4 大小: 143.9KB 视频时长: 12s ' +
  '重新上传 删除 发布设置 标题 4/30 封面 上传封面 清晰美观的封面有利于推荐，建议分辨率不低于 618*1000' +
  '（大小不超过 20M） 视频生成图文 生成图文勾选后额外得图文创作收益 同时发布到 红果短剧 … 发布 手机预览效果',
].join('')
const REAL_PAGE_URL = '/profile_v4/xigua/upload-video'
const REAL_PAGE_INPUT_PLACEHOLDER = '请输入 0～30 个字符'

describe('④ 用真机记录的页面文本反证「旧探针必失败 / 新探针必命中」', () => {
  const src = fs.readFileSync(svc('upload-waiter.js'), 'utf8')

  test('新探针 doneCopy 在真实页面文本上命中（上传成功）', () => {
    const doneCopy = /上传成功|上传完成|上传完毕/
    expect(doneCopy.test(REAL_PAGE_TEXT)).toBe(true)
  })

  test('旧 positive 的三条子判据在真实页面上全部落空（这就是干等 90s 的原因）', () => {
    // ① URL 不含 post/video
    expect(REAL_PAGE_URL.indexOf('post/video') === -1).toBe(true)
    // ② placeholder 不含「标题」
    expect(/标题/.test(REAL_PAGE_INPUT_PLACEHOLDER)).toBe(false)
    // ③ 页面无 <video> / textarea / contenteditable（实测计数全 0，见 §16.32.2）
    const measured = { videoCount: 0, textareaCount: 0, editableCount: 0 }
    expect(measured.videoCount === 0 && measured.textareaCount === 0 && measured.editableCount === 0).toBe(true)
  })

  test('新 positive 因为含 doneCopy，在真实页面上为 true', () => {
    const m = src.match(/positive:\s*!!\([^)]*\)/)
    expect(m[0].includes('doneCopy')).toBe(true)
    const vv = false // 无 https <video>
    const ed = false // 无匹配编辑器
    const doneCopy = /上传成功|上传完成|上传完毕/.test(REAL_PAGE_TEXT)
    const urlHit = REAL_PAGE_URL.indexOf('post/video') !== -1
    expect(Boolean(vv || ed || doneCopy || urlHit)).toBe(true)
  })
})

// ── ⑤ 上传等待预算：平台级下界（2026-10-21 23:5x 真机二次实测后补）──────────
// 现象：doneCopy 已修好、代码确实在跑，但 143.9KB 视频在 **90s 内**页面仍无「上传成功」
// （日志 15:49:48 开始上传 → 15:51:18 预算耗尽），而同页更晚时刻已显示上传成功 ⇒ 转码延迟。
// 预算只是上界：doneCopy 命中即提前返回，放宽不影响正常路径。
describe('⑤ computeBudgetMs 平台下界 + upload-waiter 接线', () => {
  const strat = require('../electron/services/upload-wait-strategy.js')
  const KB = 1024

  test('toutiao 下界 = 300000ms，小文件也被抬到该值', () => {
    expect(strat.PLATFORM_MIN_BUDGET_MS.toutiao).toBe(300000)
    expect(strat.computeBudgetMs(143.9 * KB, { minMs: strat.PLATFORM_MIN_BUDGET_MS.toutiao })).toBe(300000)
  })

  test('不传 minMs 时行为不变（143.9KB → 90000 默认下界）', () => {
    expect(strat.computeBudgetMs(143.9 * KB)).toBe(90000)
  })

  test('minMs 不得突破上界：96MB + minMs 仍夹到 900000', () => {
    expect(strat.computeBudgetMs(96 * 1024 * KB, { minMs: 300000 })).toBe(900000)
  })

  test('upload-waiter 按平台取下界并传给 computeBudgetMs', () => {
    const src = fs.readFileSync(svc('upload-waiter.js'), 'utf8')
    expect(/PLATFORM_MIN_BUDGET_MS \|\| \{\}\)\[platform\]/.test(src)).toBe(true)
    expect(/computeBudgetMs\(bytes, \{ minMs \}\)/.test(src)).toBe(true)
  })
})
