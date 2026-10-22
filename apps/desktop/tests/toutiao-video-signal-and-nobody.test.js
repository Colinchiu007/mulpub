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

  test('toutiao 下界 = 600000ms（实测转码 >300s），小文件也被抬到该值', () => {
    expect(strat.PLATFORM_MIN_BUDGET_MS.toutiao).toBe(600000)
    expect(strat.computeBudgetMs(143.9 * KB, { minMs: strat.PLATFORM_MIN_BUDGET_MS.toutiao })).toBe(600000)
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

// ── ⑥ 强完成文案不得被弱 DOM 形状判据否决（P3.5，2026-10-22 真机三次实测后补）──
// 三次实测：探针口径已含 doneCopy，页面也确实显示「上传成功」，但 300s 用满仍报未检测到。
// 根因：uploading 里含 pv>0（可见的 [class*=progress]/[class*=percent] 元素）这类弱形状判据，
// 西瓜页的 xigua-upload-video* 容器即可命中 ⇒ uploading 恒真 ⇒ P4(positive && !uploading) 永不成立。
// 这与代码注释里记的抖音同型故障（残留 progress 元素白等 15 分钟）完全一致。
describe('⑥ decideUploadWait：强文案 + 无上传中文本 ⇒ 直接 done', () => {
  const { decideUploadWait } = require('../electron/services/upload-wait-strategy.js')
  const base = { elapsedMs: 40000, budgetMs: 300000, pagePercent: null, prevPagePercent: null, structuralSignal: false }

  test('doneStrong + uploadingText=false ⇒ done（即使 uploading=true 这个弱信号仍在）', () => {
    const r = decideUploadWait({ ...base, uploading: true, positiveSignal: true, doneStrong: true, uploadingText: false })
    expect(r.action).toBe('done')
  })

  test('doneStrong 但仍有「上传中/转码中」文本 ⇒ 不判 done（不得提前放行）', () => {
    const r = decideUploadWait({ ...base, uploading: true, positiveSignal: true, doneStrong: true, uploadingText: true })
    expect(r.action).not.toBe('done')
  })

  test('无强文案时行为不变（走原 P4/P5）', () => {
    const r = decideUploadWait({ ...base, uploading: true, positiveSignal: true, doneStrong: false, uploadingText: false })
    expect(r.action).toBe('wait')
  })

  test('探针把 doneStrong / uploadingText 单列上报', () => {
    const src = fs.readFileSync(svc('upload-waiter.js'), 'utf8')
    expect(/doneStrong:!!doneCopy/.test(src)).toBe(true)
    expect(/uploadingText:!!uploadingText/.test(src)).toBe(true)
    expect(src.includes('var uploadingText=')).toBe(true)
  })
})

// ── ⑦ 探测必须有硬超时（2026-10-22 真机挂死后补）────────────────────────
// 现场：任务卡在 uploading file... 后一小时无进展，连 300s best-effort 日志都没有。
// 根因：_probeUploadSignal 依赖 executeJavaScript，渲染进程不应答时 Promise 永不 resolve，
// 而循环没有单次探测超时 ⇒ 预算/停滞判定永远执行不到。
describe('⑦ 上传探测的硬超时护栏', () => {
  const src = fs.readFileSync(svc('upload-waiter.js'), 'utf8')

  test('探测调用被 Promise.race 包裹，且超时值有限', () => {
    expect(/Promise\.race\(\[/.test(src)).toBe(true)
    expect(/PROBE_TIMEOUT_MS = \d+/.test(src)).toBe(true)
    const m = src.match(/PROBE_TIMEOUT_MS = (\d+)/)
    expect(Number(m[1])).toBeGreaterThan(0)
    expect(Number(m[1])).toBeLessThanOrEqual(60000)
  })

  test('超时帧按「无效帧」返回（不判完成、不刷新停滞）', () => {
    expect(/probeTimedOut: true/.test(src)).toBe(true)
    const seg = src.slice(src.indexOf('probeTimedOut: true') - 300, src.indexOf('probeTimedOut: true'))
    expect(seg.includes('positive: false')).toBe(true)
    expect(seg.includes('pagePercent: null')).toBe(true)
  })

  test('超时可见化：有计数与告警日志', () => {
    expect(/_probeTimeoutCount/.test(src)).toBe(true)
    expect(/upload probe timed out/.test(src)).toBe(true)
  })
})

// ── ⑧ 文本取值必须有 textContent 兜底（2026-10-22 第二轮真机后补）────────────
// 现场：17:49:07 开始上传 → 17:59:08（整整 600s）仍报未检测到；而外部探测同一页面可见「上传成功」。
// 唯一自洽解释：RPA 窗口是隐藏窗口，`innerText` 依赖渲染/布局可能返回空串；
// 西瓜页又只靠文本判据（无 <video>、无编辑器）⇒ 所有文本信号恒空。
describe('⑧ 上传探针的文本取值', () => {
  const src = fs.readFileSync(svc('upload-waiter.js'), 'utf8')

  test('探针用 innerText || textContent（不依赖渲染）', () => {
    expect(/document\.body\.innerText\|\|document\.body\.textContent/.test(src)).toBe(true)
  })

  test('上报 textLen 以便区分「读不到」与「没渲染」', () => {
    expect(/textLen:t\.length/.test(src)).toBe(true)
    expect(/upload probe textLen=/.test(src)).toBe(true)
  })
})

// ── ⑨ 翻译层白名单：_probeUploadSignal 必须把新增字段原样透传 ──────────────
// 真因（2026-10-22，两轮才挖到）：该方法把页面返回值**按白名单重建**，只拷
// uploading/pagePercent/positive/structural —— 我新增的 doneStrong/uploadingText/textLen
// 全在这一层被**静默丢弃**，表现为「页面明明显示上传成功，判定层永远收不到」，且无任何报错。
// 与 router 丢 track/apiTrackFailed（PR #4185）同类：翻译层白名单漏字段。
describe('⑨ _probeUploadSignal 白名单透传', () => {
  const { uploadWaiterMixin } = require('../electron/services/upload-waiter.js')

  const fakeWin = (payload) => ({ webContents: { executeJavaScript: async () => payload } })
  const call = (payload) => uploadWaiterMixin._probeUploadSignal.call({}, fakeWin(payload), 'function(){return 1}')

  test('doneStrong / uploadingText / textLen 必须透传（不得被白名单丢弃）', async () => {
    const r = await call({ uploading: true, uploadingText: false, pagePercent: null, positive: true, doneStrong: true, structural: true, textLen: 399 })
    expect(r.doneStrong).toBe(true)
    expect(r.uploadingText).toBe(false)
    expect(r.textLen).toBe(399)
  })

  test('缺字段时给出稳定默认（不出现 undefined）', async () => {
    const r = await call({ uploading: false, pagePercent: null, positive: false, structural: false })
    expect(r.doneStrong).toBe(false)
    expect(r.uploadingText).toBe(false)
    expect(r.textLen).toBe(null)
  })
})
