/**
 * 运营中心「保存后提示需重启应用生效」测试（2026-10-17）
 *
 * PRD：ops-center/docs/PRD-ops-center-restart-hint.md
 *
 * 背景（实测复盘）
 * ----------------
 * 桌面端 OpsCenterSync 只在应用启动时同步一次（ops-center-sync.js:748 autoSyncOnStart，
 * setTimeout 3000ms，仅此一次；全文件无 setInterval）。因此运营中心改完配置后，
 * 已启动的应用**不会**重拉，运营者看到「改了没反应」便反复保存、甚至回滚正确配置。
 *
 * 「需重启才生效」是当前实现的预期行为（MpSidebar.vue:126-127 注释已写明
 * 「下次启动同步后自动可见」），但界面上没有任何地方告诉运营者。
 *
 * 本 PRD 的做法：保存成功后加一句诚实的提示。**不**加定时同步、**不**加手动同步按钮
 * （理由见 PRD §1.4：单站点场景加轮询是过度设计，且破坏「运营同步对用户透明」契约）。
 *
 * 契约
 ----
 * C1 文案单一真源：字面量「重启桌面应用」在整个 src 下**只出现一次**（常量定义处）。
 *    六个页面共用同一常量；各写一遍必然漂移，且无法统一测试。
 * C2 成功路径必现：saveAll 成功后 success/warning 必须含 RESTART_HINT。
 * C3 失败路径不现：API 抛错时 success/warning **都不得**被调用。
 * C4 不遮挡保存结果：提示不得取代项数（N 项）与 corrections 列表。
 * C5 时长可读：duration 必须 >= 6000ms（约 40 汉字，默认 3000ms 读不完）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '..', 'src')

const { RESTART_HINT, RESTART_HINT_WHEN, RESTART_HINT_HOW, RESTART_HINT_DURATION, shouldShowRestartHint } =
  await import('../src/constants/runtime-delivery.js')

describe('RESTART_HINT 常量（C1 单一真源）', () => {
  it('「何时生效」段是精确等值', () => {
    // 同 MR3 教训：子串匹配会被同词掩盖，故用精确等值。
    expect(RESTART_HINT_WHEN).toBe('将在应用下次启动时生效')
  })

  it('「如何立刻生效」段是精确等值（含「重启」动作词与「桌面应用」宾语）', () => {
    // ★ MR3 变异暴露：写成 toMatch(/重启/) 时，把「重启」换成「查看」会得到
    // 「如需立即查看请重启桌面应用」—— 句子后半仍有「重启」，断言照绿。
    // 即「动作词是否在正确位置」这个语义被子串匹配掩盖了。
    // 与 MR2 同源：**用「子串存在」断言语义，子串会被同词掩盖**。
    // 故这里改为精确等值：文案是契约的一部分，改一个字都要显式过测试。
    expect(RESTART_HINT_HOW).toBe('如需立即生效请重启桌面应用')
  })

  it('完整提示 = 两段拼接（任一段被删都能被上面两条分别抓到）', () => {
    // MR2 变异暴露的缺口：两个语义挤在一句里时，删掉前半句的「生效」
    // 会被后半句的「生效」掩盖，断言抓不到。拆段后各自独立可断言。
    expect(RESTART_HINT).toBe(RESTART_HINT_WHEN + '；' + RESTART_HINT_HOW)
  })

  it('字面量「重启桌面应用」在整个 src 的**代码**里只出现一次（C1 结构锁）', () => {
    // 判据必须只扫代码、不扫注释：JSDoc 里引用该字面量是合理的说明性文字
    // （首版扫全文，结果被自己文件里的注释判红 —— 那是判据过宽，不是代码有问题）。
    // 剥注释用最朴素的「逐字符状态机」：跟踪单/双/反引号与块注释，
    // 与 ops-center 无三方解析依赖的约束一致（该目录只能 require node 内置模块）。
    const strip = (s) => {
      let out = ''
      let st = 'code'
      for (let i = 0; i < s.length; i++) {
        const c = s[i]
        const n = s[i + 1]
        if (st === 'code') {
          if (c === '/' && n === '/') { st = 'line'; i++; continue }
          if (c === '/' && n === '*') { st = 'block'; i++; continue }
          if (c === "'" || c === '"' || c === '`') { st = c; out += c; continue }
          out += c; continue
        }
        if (st === 'line') { if (c === '\n') { st = 'code'; out += c } ; continue }
        if (st === 'block') { if (c === '*' && n === '/') { st = 'code'; i++ } ; continue }
        // 引号内
        if (c === '\\') { out += c + (n ?? ''); i++; continue }
        if (c === st) { st = 'code' }
        out += c
      }
      return out
    }

    const hits = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
        else if (/\.(vue|js)$/.test(e.name)) {
          const n = (strip(fs.readFileSync(p, 'utf8')).match(/重启桌面应用/g) || []).length
          if (n) hits.push([path.relative(SRC, p), n])
        }
      }
    }
    walk(SRC)
    // 路径分隔符随平台（Windows 为 '\'），故只比「文件名」与次数，不比分隔符形态。
    const normalized = hits.map(([f, n]) => [f.split(path.sep).join('/'), n])
    expect(normalized).toEqual([['constants/runtime-delivery.js', 1]])
  })
})

describe('shouldShowRestartHint（C3 失败路径不现）', () => {
  it('保存成功 ⇒ 要提示', () => {
    expect(shouldShowRestartHint({ ok: true })).toBe(true)
  })

  it('保存失败 ⇒ 不提示', () => {
    expect(shouldShowRestartHint({ ok: false })).toBe(false)
  })

  it('未给结果 ⇒ 不提示（fail-closed：不确定就不说）', () => {
    expect(shouldShowRestartHint(null)).toBe(false)
    expect(shouldShowRestartHint(undefined)).toBe(false)
  })
})

describe('时长（C5）', () => {
  it('duration >= 6000ms（约 40 汉字，默认 3000ms 读不完）', () => {
    expect(RESTART_HINT_DURATION).toBeGreaterThanOrEqual(6000)
  })
})

describe('AppMenu.vue 保存路径（C2/C4）', () => {
  beforeEach(() => { vi.resetModules() })

  it('保存成功（无纠正）→ success 含项数 + RESTART_HINT', async () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const { saveMessageFor } = await import('../src/views/AppMenu.save-message.js')
    const r = saveMessageFor({ ok: true, count: 21, corrections: [] }, ElMessage)
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    const msg = ElMessage.success.mock.calls[0][0]
    expect(msg).toMatch(/21 项/)          // C4 不遮挡项数
    expect(msg).toContain(RESTART_HINT)   // C2
  })

  it('保存成功（有纠正）→ warning 含 key 列表 + RESTART_HINT', async () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const { saveMessageFor } = await import('../src/views/AppMenu.save-message.js')
    saveMessageFor({ ok: true, count: 21, corrections: ['publish', 'accounts'] }, ElMessage)
    expect(ElMessage.warning).toHaveBeenCalledTimes(1)
    const msg = ElMessage.warning.mock.calls[0][0]
    expect(msg).toMatch(/publish/)        // C4 不遮挡纠正列表
    expect(msg).toContain(RESTART_HINT)
  })

  it('保存失败 → success/warning 都不得被调用（C3）', async () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const { saveMessageFor } = await import('../src/views/AppMenu.save-message.js')
    saveMessageFor({ ok: false, detail: '保存失败' }, ElMessage)
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledTimes(1)
  })

  it('duration 必须显式传入且 >= 6000（C5 接线）', async () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const { saveMessageFor } = await import('../src/views/AppMenu.save-message.js')
    saveMessageFor({ ok: true, count: 21, corrections: [] }, ElMessage)
    // MR11 变异暴露的缺口：这里原写成 `opts.duration ?? RESTART_HINT_DURATION`，
    // 于是「不传 duration」会被兜底掩盖、断言照绿。现在要求第二参**必须存在**，
    // 且其 duration 必须达到下界 —— 兜底等于把接线锁降级成常量锁。
    const opts = ElMessage.success.mock.calls[0][1]
    expect(opts).toBeTruthy()
    expect(opts.duration).toBeGreaterThanOrEqual(6000)
  })

  it('reset 路径（带 prefix）同样含 RESTART_HINT', async () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const { saveMessageFor } = await import('../src/views/AppMenu.save-message.js')
    saveMessageFor({ ok: true, count: 21, corrections: [] }, ElMessage, '已恢复默认')
    const msg = ElMessage.success.mock.calls[0][0]
    expect(msg).toMatch(/^已恢复默认；/)
    expect(msg).toContain(RESTART_HINT)
  })

  it('reset 失败路径：不提示重启，走 error 且用调用方 detail', async () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const { saveMessageFor } = await import('../src/views/AppMenu.save-message.js')
    saveMessageFor({ ok: false, detail: '恢复默认失败' }, ElMessage, '恢复默认失败')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith('恢复默认失败')
  })
})
