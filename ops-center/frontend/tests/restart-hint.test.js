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
 * C1 文案单一真源：字面量「重启桌面应用」在**常量定义文件的代码里**只出现一次。
 * C2 成功路径必现：composeSaveMessage 的 text 必含 RESTART_HINT。
 * C3 失败路径不现：ok=false 时 kind 必为 error，text 不含 RESTART_HINT。
 * C4 不遮挡保存结果：提示不得取代项数与 corrections 列表。
 * C5 时长可读：duration >= 6000ms（约 40 汉字，默认 3000ms 读不完）。
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 静态 import（QM-6 评审 i3：原用顶层 await import()，依赖 vitest 的 ESM/顶层 await
// 配置，配置不匹配整个测试文件无法加载。静态 import 无此依赖）。
import {
  RESTART_HINT,
  RESTART_HINT_WHEN,
  RESTART_HINT_HOW,
  RESTART_HINT_DURATION,
  shouldShowRestartHint,
} from '../src/constants/runtime-delivery'
import { composeSaveMessage, emitSaveMessage } from '../src/views/AppMenu.save-message'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('RESTART_HINT 常量', () => {
  it('「何时生效」段是精确等值', () => {
    // MR2 教训：子串匹配会被同词掩盖（删掉本段「生效」后 HOW 段仍有「生效」），
    // 故用精确等值。文案是契约一部分，改一个字都要显式过测试。
    expect(RESTART_HINT_WHEN).toBe('将在应用下次启动时生效')
  })

  it('「如何立刻生效」段是精确等值（含「重启」动作词与「桌面应用」宾语）', () => {
    // MR3 教训：toMatch(/重启/) 会把「重启」换成「查看」的变异放过去
    // （得到「如需立即查看请重启桌面应用」，后半仍有「重启」）。
    expect(RESTART_HINT_HOW).toBe('如需立即生效请重启桌面应用')
  })

  it('完整提示 = 两段拼接（任一段被删都能被上面两条分别抓到）', () => {
    expect(RESTART_HINT).toBe(RESTART_HINT_WHEN + '；' + RESTART_HINT_HOW)
  })

  it('duration >= 6000ms（约 40 汉字，默认 3000ms 读不完）', () => {
    expect(RESTART_HINT_DURATION).toBeGreaterThanOrEqual(6000)
  })
})

describe('C1 单一真源（结构锁）', () => {
  it('「重启桌面应用」在常量定义文件的**代码**里只出现一次', () => {
    // QM-6 评审 i4：首版扫整个 src 并手写逐字符状态机剥注释，对正则字面量、
    // 含引号的模板字符串会误判，元测试脆弱。现收窄为只扫常量定义文件，
    // 且该文件刻意保持「无行内 // 注释」——剥注释只需处理 // 行注释与 /** */ 块注释
    // 两种形态，不碰字符串与正则，状态机不会误判。
    const file = path.resolve(__dirname, '..', 'src', 'constants', 'runtime-delivery.js')
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')
    const n = (code.match(/重启桌面应用/g) || []).length
    expect(n).toBe(1)
  })

  it('其它源码文件不得出现该字面量（防绕过常量直接写死）', () => {
    const SRC = path.resolve(__dirname, '..', 'src')
    const offenders = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
        else if (/\.(vue|js)$/.test(e.name)) {
          if (p.includes('constants' + path.sep + 'runtime-delivery.js')) continue
          const code = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .map((l) => l.replace(/\/\/.*$/, ''))
            .join('\n')
          if (/重启桌面应用/.test(code)) offenders.push(path.relative(SRC, p))
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})

describe('shouldShowRestartHint（C3 fail-closed）', () => {
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

describe('composeSaveMessage —— 纯函数（C2/C3/C4/C5）', () => {
  it('保存成功（无纠正）→ success，含项数 + RESTART_HINT，duration 达下界', () => {
    const m = composeSaveMessage({ ok: true, count: 21, corrections: [] })
    expect(m.kind).toBe('success')
    expect(m.text).toMatch(/21 项/)        // C4 不遮挡项数
    expect(m.text).toContain(RESTART_HINT) // C2
    expect(m.duration).toBeGreaterThanOrEqual(6000) // C5
  })

  it('保存成功（有纠正）→ warning，含 key 列表 + RESTART_HINT，duration 达下界', () => {
    const m = composeSaveMessage({ ok: true, count: 21, corrections: ['publish', 'accounts'] })
    expect(m.kind).toBe('warning')
    expect(m.text).toMatch(/publish/)      // C4 不遮挡纠正列表
    expect(m.text).toContain(RESTART_HINT)
    // MR14 变异暴露：原只对 success 分支断言 duration，warning 分支的
    // duration 被改成 3000 也照绿 ⇒ 每条成功路径都要单独断时长。
    expect(m.duration).toBeGreaterThanOrEqual(6000)
  })

  it('保存失败 → error，用调用方 detail，且**不含** RESTART_HINT', () => {
    const m = composeSaveMessage({ ok: false, detail: '保存失败' })
    expect(m.kind).toBe('error')
    expect(m.text).toBe('保存失败')
    expect(m.text).not.toContain(RESTART_HINT) // C3 失败路径不得出现重启提示
  })

  it('保存失败且无 detail → 兜底文案，仍不含 RESTART_HINT', () => {
    const m = composeSaveMessage({ ok: false })
    expect(m.kind).toBe('error')
    expect(m.text).toBe('保存失败')
    expect(m.text).not.toContain(RESTART_HINT)
  })

  it('reset 路径（带 prefix）→ 前缀为动作名，仍含 RESTART_HINT', () => {
    const m = composeSaveMessage({ ok: true, count: 21, corrections: [] }, '已恢复默认')
    expect(m.kind).toBe('success')
    expect(m.text).toMatch(/^已恢复默认；/)
    expect(m.text).toContain(RESTART_HINT)
  })
})

describe('emitSaveMessage —— 适配层（kind → ElMessage 方法映射）', () => {
  it('成功 → 调 ElMessage.success，且第二参 duration 显式达下界', () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const kind = emitSaveMessage({ ok: true, count: 21, corrections: [] }, ElMessage)
    expect(kind).toBe('success')
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    // MR14 教训：原断言写 `opts.duration ?? RESTART_HINT_DURATION`，兜底会把
    // 「不传 duration」掩盖 ⇒ 接线锁被降级成常量锁。现要求第二参必须存在。
    const opts = ElMessage.success.mock.calls[0][1]
    expect(opts).toBeTruthy()
    expect(opts.duration).toBeGreaterThanOrEqual(6000)
    expect(ElMessage.warning).not.toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('有纠正 → 调 ElMessage.warning，且第二参 duration 显式达下界', () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const kind = emitSaveMessage({ ok: true, count: 21, corrections: ['publish'] }, ElMessage)
    expect(kind).toBe('warning')
    expect(ElMessage.warning).toHaveBeenCalledTimes(1)
    expect(ElMessage.success).not.toHaveBeenCalled()
    // MR19 变异暴露：适配层 warning 路径原先没断言 duration，
    // 把 { duration } 去掉也照绿 ⇒ 接线锁要覆盖每一条派发路径。
    const opts = ElMessage.warning.mock.calls[0][1]
    expect(opts).toBeTruthy()
    expect(opts.duration).toBeGreaterThanOrEqual(6000)
  })

  it('失败 → 只调 ElMessage.error，success/warning 都不得被调用', () => {
    const ElMessage = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    const kind = emitSaveMessage({ ok: false, detail: '保存失败' }, ElMessage)
    expect(kind).toBe('error')
    expect(ElMessage.error).toHaveBeenCalledWith('保存失败')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })
})
