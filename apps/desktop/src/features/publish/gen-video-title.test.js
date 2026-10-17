// @ts-check
/**
 * gen-video-title — 热门选题「生成视频 → 去发布」的标题降级链纯函数测试
 * （fix-hot-topics-genvideo-title，2026-10-17）。
 *
 * 为什么必须是纯函数模块：降级链的每一格都要在无 IPC、无 Vue、无 LLM 的环境下
 * 穷举测试（本期修复的第一性问题是「标题=正文切片」，而旧测试夹具恰好把这条
 * 缺陷路径伪装成正确行为 —— 见 PRD §2.4 逃逸分析）。
 *
 * prompt 构造与 LLM 输出清洗在主进程侧（electron/ipc-handlers/gen-video-title.js），
 * 其测试在同目录 gen-video-title.test.js —— 渲染层 src/ 受 --cjk 门禁扫描，
 * 中文 prompt 指令不能放在这里。
 */
import { describe, expect, it } from 'vitest'
import {
  GEN_VIDEO_TITLE_MAX,
  resolveGenVideoTitle,
} from './gen-video-title'

describe('resolveGenVideoTitle', () => {
  it('aiAvailable=false → 用原始选题（不调 AI 的降级）', () => {
    const out = resolveGenVideoTitle({ topicText: 'AI大模型最新突破进展', aiAvailable: false, aiTitle: '某个AI标题' })
    expect(out).toEqual({ title: 'AI大模型最新突破进展', source: 'topic' })
  })

  it('aiAvailable=true 且 AI 标题有效 → 用 AI 标题', () => {
    const out = resolveGenVideoTitle({ topicText: 'AI大模型最新突破进展', aiAvailable: true, aiTitle: '打工人醒醒！AI又抢活了' })
    expect(out).toEqual({ title: '打工人醒醒！AI又抢活了', source: 'ai' })
  })

  it('AI 标题首尾空白被 trim', () => {
    const out = resolveGenVideoTitle({ topicText: '原始选题', aiAvailable: true, aiTitle: '  标题  ' })
    expect(out).toEqual({ title: '标题', source: 'ai' })
  })

  it('aiAvailable=true 但 AI 标题为空串 → 降级原始选题', () => {
    const out = resolveGenVideoTitle({ topicText: 'AI大模型最新突破进展', aiAvailable: true, aiTitle: '' })
    expect(out).toEqual({ title: 'AI大模型最新突破进展', source: 'topic' })
  })

  it('aiAvailable=true 但 AI 标题为纯空白 → 降级原始选题', () => {
    const out = resolveGenVideoTitle({ topicText: '原始选题', aiAvailable: true, aiTitle: '   \n\t ' })
    expect(out).toEqual({ title: '原始选题', source: 'topic' })
  })

  it('AI 标题非字符串（null/number/object/array）→ 降级且不抛错', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      const out = resolveGenVideoTitle({ topicText: '原始选题', aiAvailable: true, aiTitle: bad })
      expect(out).toEqual({ title: '原始选题', source: 'topic' })
    }
  })

  it('原始选题为空 / 纯空白 → source=none 且标题空（不注入 query）', () => {
    expect(resolveGenVideoTitle({ topicText: '', aiAvailable: true, aiTitle: 'AI标题' })).toEqual({ title: '', source: 'none' })
    expect(resolveGenVideoTitle({ topicText: '   \n ', aiAvailable: false, aiTitle: null })).toEqual({ title: '', source: 'none' })
  })

  it('原始选题超长按 max 截断', () => {
    const topic = '选'.repeat(300)
    const out = resolveGenVideoTitle({ topicText: topic, aiAvailable: false, aiTitle: null, max: 100 })
    expect(out.title.length).toBe(100)
    expect(out.source).toBe('topic')
  })

  it('AI 标题也按 max 硬截断（主进程已清洗，这里是第二道闸）', () => {
    const out = resolveGenVideoTitle({ topicText: '原始选题', aiAvailable: true, aiTitle: '标'.repeat(200), max: 100 })
    expect(out.title.length).toBe(100)
    expect(out.source).toBe('ai')
  })

  it('max 非法（0 / -1 / NaN / Infinity / 空串）回退默认上限', () => {
    const topic = '选'.repeat(150)
    for (const bad of [0, -1, NaN, Infinity, '', null, undefined, {}]) {
      const out = resolveGenVideoTitle({ topicText: topic, aiAvailable: false, aiTitle: null, max: bad })
      expect(out.title.length).toBe(GEN_VIDEO_TITLE_MAX)
    }
  })

  it('数字字符串 max 被转换为对应上限', () => {
    const topic = '选'.repeat(150)
    const out = resolveGenVideoTitle({ topicText: topic, aiAvailable: false, aiTitle: null, max: '30' })
    expect(out.title.length).toBe(30)
  })

  it('缺省 aiAvailable（undefined）按不可用处理 → 保守降级', () => {
    const out = resolveGenVideoTitle({ topicText: '原始选题', aiTitle: 'AI标题' })
    expect(out).toEqual({ title: '原始选题', source: 'topic' })
  })

  it('aiAvailable 为 truthy 非 true 值（1/"yes"）也按不可用处理', () => {
    // 保守口径：只有严格 true 才走 AI 分支，避免把「查到了但结构异常」当成可用
    for (const bad of [1, 'yes', {}]) {
      const out = resolveGenVideoTitle({ topicText: '原始选题', aiAvailable: bad, aiTitle: 'AI标题' })
      expect(out).toEqual({ title: '原始选题', source: 'topic' })
    }
  })

  it('无参调用不抛错', () => {
    const out = resolveGenVideoTitle()
    expect(out).toEqual({ title: '', source: 'none' })
  })

  it('emoji 标题按 Unicode 码点截断（不产生孤立代理）', () => {
    const out = resolveGenVideoTitle({ topicText: '😀'.repeat(120), aiAvailable: false, aiTitle: null, max: 10 })
    expect([...out.title].length).toBe(10)
    expect(out.title).toBe('😀'.repeat(10))
  })
})
