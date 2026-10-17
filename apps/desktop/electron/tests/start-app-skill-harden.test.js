/**
 * start-app-skill-harden.test.js —— start-app skill 的「入口选择铁律」结构锁
 *
 * 为什么需要：2026-10-17 实测事故 —— agent 面对「重启应用」时读了 skill 的
 * 「流程（备选长流程）」一节，用 `start-desktop.ps1 -Profile '<debug-profile>'`
 * 手工包了一层 WMI 启动器，结果 ① `-Profile` 盖掉 `shared-user-data` 锚点 ⇒ 用户看不到账号；
 * ② 重复实现一键启动内部已有的 WMI 脱离会话逻辑。
 *
 * 这三条不是"文风"问题，是**路由规则**：SKILL.md 同时写了"一键启动（首选）"和
 * "备选长流程"两节，agent 无法从文字判断哪个是默认。因此用机械锁把"硬路由"钉住：
 *   ① 入口铁律必须存在且点名 sync-app.ps1；
 *   ② 「三种场景」表不得再把读者指向长流程；
 *   ③ `-Profile` 必须带警告（防锚点被盖）；
 *   ④ preload 排查必须存在（这次第二个真坑：窗口在但 electronAPI 缺失）。
 */
import { describe, it, expect } from 'vitest'
const fs = require('fs')
const path = require('path')

const SKILL = path.resolve(__dirname, '../../../../.agents/skills/start-app/SKILL.md')
const read = () => fs.readFileSync(SKILL, 'utf8')

describe('start-app skill：入口选择铁律（2026-10-17 复盘）', () => {
  it('SKILL.md 必须存在（否则本锁失去测量对象，须当场红而非静默通过）', () => {
    expect(fs.existsSync(SKILL)).toBe(true)
  })

  it('① 必须存在「入口选择铁律」小节，并点名 sync-app.ps1 为默认入口', () => {
    const src = read()
    expect(src, '缺少「入口选择铁律」小节').toContain('入口选择铁律')
    expect(src).toContain('scripts/sync-app.ps1')
    // 铁律必须写清"默认且几乎唯一入口"这个定性，不能只写"优先"
    expect(src).toMatch(/默认且几乎唯一入口/)
  })

  it('② 「三种场景」表不得再把读者指向长流程（A/B 场景都应走一键启动）', () => {
    const src = read()
    const seg = src.slice(src.indexOf('## 三种场景'), src.indexOf('## 核心目标'))
    expect(seg).toContain('一键启动')
    // 旧写法「正常走完整启动流程（见下）」正是把读者送去长流程的措辞，必须绝迹
    expect(seg, '场景表仍在把读者指向长流程').not.toContain('正常走完整启动流程')
  })

  it('③ 「不得手动传 -Profile」警告必须存在（判据取警告句式本身，不取散落词）', () => {
    const src = read()
    // ⚠️ 判据宽度的教训（2026-10-17 探针实测）：若只匹配 `-Profile`/`AUTH_REQUIRED`
    // 这些**词**，删掉整段警告后仍能命中事故描述句里的同批词 ⇒ 锁假绿。
    // 正确做法：锁**警告句式本身**（`不得手动传` 是唯一措辞），再要求句式附近有后果词。
    expect(src, '缺少「不得手动传 -Profile」警告').toMatch(/不得手动传\s*`-Profile`/)
    const at = src.search(/不得手动传\s*`-Profile`/)
    const window = src.slice(at, at + 400)
    expect(window, '警告附近没有说清后果').toMatch(/shared-user-data/)
    expect(window).toMatch(/AUTH_REQUIRED|看不到已登录的账号|数据分裂/)
  })

  it('④ 必须记录「窗口在但 electronAPI 缺失 = preload 未构建」的排查', () => {
    const src = read()
    expect(src).toContain('build:preload')
    expect(src).toMatch(/electronAPI/)
    // 必须点明"不是登录问题"这个反误判锚点
    expect(src).toMatch(/不是登录问题|与登录态/)
  })

  it('⑤ 铁律必须记录事故日期与后果（可追溯，防止被当成泛泛最佳实践而删掉）', () => {
    const src = read()
    expect(src).toContain('2026-10-17')
    expect(src).toMatch(/复盘/)
  })

  it('⑥ 不得出现「手工包 WMI 外壳」被当作首选路径的表述', () => {
    const src = read()
    // 允许在"降级路径"语境提及，但不许出现教人主动手工包的措辞
    expect(src, '出现了教人主动手工包 WMI 的措辞').not.toMatch(/手工包.{0,12}WMI.{0,20}(即可|应该|首选)/)
  })
})
