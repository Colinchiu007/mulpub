/**
 * creator-dependency-probe.test.js — 正文（字幕）腿依赖探测的降级契约
 *
 * ⛔ 本文件 2026-10-12 重写。旧版本测的是一个**不可能成立**的实现：
 *   `probeDependency()` 用 `require('content_aggregator.sources.collectors.youtube_collector')`
 *   去探测依赖——`content_aggregator` 是 **Python** 包，Node 的 `require` 永远解析不到，
 *   于是该函数**恒返回 ready:false**。它当时没有任何生产调用点，所以只烂在测试里：
 *   测试通过（因为桩里假装 require 能返回构造器），生产恒报缺失。
 *   这正是「夹具按调用方想象的形状收参数」的同族——**桩让一个假前提全绿了一整个版本**。
 *
 * 现在的判据只问 Node 侧真能回答的事：Python 后端桥在不在跑。
 * 「桥不在跑」与「没装 content-aggregator」在 Node 侧不可区分，所以本模块
 * **不假装能区分**：installHint 是「如果确实是缺包，可以这样装」的提示，
 * 不声称已确诊。语义边界：字幕缺失不阻塞采集，只降内容质量（PRD §7.6/§16）。
 */
const { probeTranscriptDependency, TRANSCRIPT_INSTALL_HINT, CREATOR_INPUT_ERRORS } = require('./creator-collector')

describe('creator-collector · 正文腿依赖探测', () => {
  it('桥在跑 → ready=true 且不带安装指引（免得 UI 显示无意义的命令）', () => {
    const r = probeTranscriptDependency({ pythonBridge: { isRunning: () => true } })
    expect(r.ready).toBe(true)
    expect(r.installHint).toBeUndefined()
  })

  it('桥不在跑 → ready=false，reason 如实写桥的状态', () => {
    const r = probeTranscriptDependency({ pythonBridge: { isRunning: () => false } })
    expect(r.ready).toBe(false)
    expect(r.reason).toBe('python-backend-not-running')
  })

  it('根本没有桥（未接线）→ 与"没在跑"区分开，便于定位是哪一层缺', () => {
    const r = probeTranscriptDependency({})
    expect(r.ready).toBe(false)
    expect(r.reason).toBe('python-bridge-unavailable')
  })

  it('永远标记为可选腿 —— 调用方据此 MUST NOT 禁用采集功能', () => {
    expect(probeTranscriptDependency({}).optional).toBe(true)
    expect(probeTranscriptDependency({ pythonBridge: { isRunning: () => true } }).optional).toBe(true)
  })

  it('安装命令带国内镜像源写法，且是 pip 而不是 npm', () => {
    const r = probeTranscriptDependency({})
    expect(r.installHint).toContain('pip install content-aggregator')
    expect(r.installHint).toMatch(/pypi\.tuna\.tsinghua\.edu\.cn/)
    expect(r.installHint).toBe(TRANSCRIPT_INSTALL_HINT)
  })

  it('探测本身永不抛异常（状态面板/列表加载路径都会调它）', () => {
    expect(() => probeTranscriptDependency()).not.toThrow()
    expect(() => probeTranscriptDependency({ pythonBridge: {} })).not.toThrow()
    // isRunning 自己抛也不能上抛：那只是"问不出结果"，按未就绪处理
    const r = probeTranscriptDependency({ pythonBridge: { isRunning: () => { throw new Error('boom') } } })
    expect(r.ready).toBe(false)
  })
})

describe('creator-collector · 依赖缺失错误码可被 IPC 层识别', () => {
  it('DEPENDENCY_MISSING 是约定的错误码（UI 据此显示安装指引而非泛化失败）', () => {
    expect(CREATOR_INPUT_ERRORS.DEPENDENCY_MISSING).toBe('creator:dependency_missing')
  })

  it('缺依赖应映射到 DEPENDENCY_MISSING 而不是 INVALID_INPUT', () => {
    // 两者 UI 表现完全不同：前者给安装命令，后者让用户改输入
    expect(CREATOR_INPUT_ERRORS.DEPENDENCY_MISSING).not.toBe(CREATOR_INPUT_ERRORS.INVALID_INPUT)
  })
})
