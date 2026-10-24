// @ts-check
'use strict'
/**
 * M0′：台词-镜长契约（**相对用户所选档位**）的契约测试
 *
 * 背景（2026-10-24，PR「影视工程自动模式长篇化 · M0′」）：
 *   PRD `01-docs/PRD-FILM-AUTO-LONGFORM-2026-10-24.md` 的 R3 指出——
 *   「推算档位 > 用户所选档位」今天**完全静默**（70 字 + 5 秒档：逐镜警告为空、plan 级无 W9），
 *   而 100 字那档 W9 明说「不得截断」**却不阻断**，照样出 5 秒的片 ⇒ 警告与执行脱节。
 *
 * 本文件锁三件事：
 *   M0′.1  逐镜必须产出「装不下用户所选档位」的警告（今天为空）；
 *   M0′.2  装不下 ⇒ **规划失败**（fail-closed）并点名该镜 + 给出两个可执行出口；
 *   M0′.4  规划完备性：镜数达不到目标时必须说清原因（今天只有一条 W3）。
 *
 * ⚠️ 判据口径（与 PRD R3.3 一致，用 PRD 给的**等价表述**）：
 *   `rawSec > 用户所选档位` —— **不能**用 `snapToTier(rawSec) > 用户所选档位`
 *   （吸附会把溢出值吸到最大档，从而漏判「用户选 10 秒 + 100 字」）；
 *   也**不能**用现状的 truncation 判据 `rawSec*1000 > durationMs+1`
 *   （它拿**吸附后**的档位比，于是「用户选 8 秒、内容 5.125 秒被吸附到 5 秒」被误判成截断）。
 *
 * ⚠️ 容差：沿用 `snapToTier` 既有的 0.3s 吸附容差（`DEFAULT_SNAP_TOLERANCE_SEC`）——
 *   「内容比档位多 0.3 秒以内」是**既有设计明确接受**的形态，
 *   若 fail-closed 不认这个容差，则 41 字（5.125s）在 5 秒档下会被拦，
 *   而吸附本身却把它当合法 ⇒ 判据与实现自相矛盾。
 */
const { planAutoShots } = require('./auto-plan')
const { DEFAULT_SNAP_TOLERANCE_SEC } = require('./shot-duration')

// 足长的连续汉字样本（不能用 slice 越界的短串 —— 那样几个用例会跑出同一个结果）
const HAN = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地人和风雷水火山泽乾坤'
function charsOf (n) {
  let out = ''
  while (out.length < n) out += HAN
  return out.slice(0, n)
}

/** 单段引号台词（无句末标点 ⇒ 拆不动 ⇒ 恒为 1 镜，便于逐镜断言） */
function plan (charCount, seconds, extra = {}) {
  return planAutoShots({
    script: 'INT. 街角 - 雨夜\n\n「' + charsOf(charCount) + '」',
    characterRefs: [],
    sceneRefs: [],
    aspect: '16x9',
    seconds,
    targetDurationSec: 10,
    templateShots: [{ prompt: 'T1' }],
    ...extra,
  })
}

/** 把逐镜警告拼成一段文本，便于断言「含某关键片段」 */
function shotWarningText (res) {
  const shots = (res && res.shots) || []
  return shots.map((s) => (s.durationWarnings || []).join(' | ')).join('\n')
}

describe('M0′.1：台词装不下用户所选档位 ⇒ 必须逐镜告警', () => {
  it('70 字 + 5 秒档：逐镜产出该类警告（今天为空）', () => {
    const r = plan(70, 5)
    const text = shotWarningText(r)
    expect(text).toMatch(/用户|档位|秒/)
    expect(text).toMatch(/8\.\d|8\.8/) // 需时约 8.75s
  })

  it('40 字 + 5 秒档：不产出该类警告（防误伤）', () => {
    const r = plan(40, 5)
    expect(shotWarningText(r)).not.toMatch(/用户所选/)
  })

  it('逐镜警告必须给出两个可执行出口（R3.5）', () => {
    const r = plan(70, 5)
    const text = shotWarningText(r)
    expect(text).toMatch(/秒数|档位|改大|改到/)
    expect(text).toMatch(/拆|两句/)
  })
})

describe('M0′.2：装不下 ⇒ 规划失败（fail-closed）并点名该镜', () => {
  it('70 字 + 5 秒档：规划失败（今天只告警就放行）', () => {
    const r = plan(70, 5)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_DIALOGUE_OVERFLOW')
  })

  it('失败信息必须点名该镜 + 给出两个出口', () => {
    const r = plan(70, 5)
    expect(r.message).toMatch(/#0|镜 0|第 1 镜|镜号/)
    expect(r.message).toMatch(/秒/)
    expect(r.message).toMatch(/拆|两句/)
  })

  it('失败时仍返回 shots（逐镜明细可断言；消费方按错误处理，不影响）', () => {
    const r = plan(70, 5)
    expect(r.ok).toBe(false)
    expect(Array.isArray(r.shots)).toBe(true)
    expect(r.shots.length).toBe(1)
    expect(shotWarningText(r)).toMatch(/你选择的单镜|念不完/)
  })

  it('100 字 + 10 秒档：规划失败（10 秒也装不下 12.5 秒）', () => {
    const r = plan(100, 10)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_DIALOGUE_OVERFLOW')
  })

  it('70 字 + 10 秒档：规划通过（10 秒装得下 8.75 秒）', () => {
    const r = plan(70, 10)
    expect(r.ok).toBe(true)
  })

  it('45 字 + 5 秒档：规划失败（5.6 秒在 5 秒档下真念不完，且超出吸附容差）', () => {
    const r = plan(45, 5)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_DIALOGUE_OVERFLOW')
  })

  it('41 字 + 5 秒档：在既有吸附容差内 ⇒ 不阻断（判据与 snapToTier 同容差）', () => {
    const r = plan(41, 5)
    expect(r.ok).toBe(true)
  })

  it('容差口径锁：超容差一点点就要拦（5.6s > 5s + 0.3s）', () => {
    expect(DEFAULT_SNAP_TOLERANCE_SEC).toBe(0.3)
    expect(45 / 8).toBeGreaterThan(5 + DEFAULT_SNAP_TOLERANCE_SEC)
  })

  it('无台词的镜不受影响（动作描述镜不该被拦）', () => {
    const r = planAutoShots({
      script: 'INT. 街角 - 雨夜\n\n他站在雨里看着信封没有说话',
      characterRefs: [], sceneRefs: [], aspect: '16x9',
      seconds: 5, targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
  })
})

describe('M0′.4：规划完备性 —— 少产镜数必须说清原因（R14）', () => {
  it('1 段无句末标点 + 目标 2 镜：产出点名段序号与缺句号的警告', () => {
    const r = planAutoShots({
      script: 'INT. 街角 - 雨夜\n\n「他站在雨里把最后一封信塞进信封」',
      characterRefs: [], sceneRefs: [], aspect: '16x9',
      seconds: 5, targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.shots.length).toBe(1)
    const w = r.warnings.find((x) => x.code === 'W10')
    expect(w).toBeTruthy()
    expect(w.message).toMatch(/少产/)
    expect(w.message).toMatch(/1/) // 少产 1 镜
    expect(w.message).toMatch(/句号|句末标点/)
  })

  it('警告必须给出可执行出口（加句号 / 改单镜秒数）', () => {
    const r = planAutoShots({
      script: 'INT. 街角 - 雨夜\n\n「他站在雨里把最后一封信塞进信封」',
      characterRefs: [], sceneRefs: [], aspect: '16x9',
      seconds: 5, targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    const w = r.warnings.find((x) => x.code === 'W10')
    expect(w.message).toMatch(/句号/)
    expect(w.message).toMatch(/秒数|时长|目标/)
  })

  it('能按句末标点拆开时不得报少产（防误报）', () => {
    const r = planAutoShots({
      script: 'INT. 街角 - 雨夜\n\n「他站在雨里。他把信塞进信封。他转身离开。」',
      characterRefs: [], sceneRefs: [], aspect: '16x9',
      seconds: 5, targetDurationSec: 15,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.shots.length).toBe(3)
    expect(r.warnings.find((x) => x.code === 'W10')).toBeFalsy()
  })
})
