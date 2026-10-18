import { describe, expect, it } from 'vitest'
import { RESTART_HINT, RESTART_HINT_DURATION, RESTART_HINT_HOW, RESTART_HINT_WHEN } from '../constants/runtime-delivery'
import { composeSaveMessage } from './AppMenu.save-message'
import {
  DEFAULT_LIMITS,
  DEFAULT_MAX_CHARS,
  DEFAULT_RANGES,
  DEFAULT_WARN_PERCENT,
  EFFECT_NOTICE_SAVE,
  MAX_CHARS_ERROR,
  MAX_CHARS_MAX,
  MAX_CHARS_MIN,
  NOTE_ERROR,
  NOTE_MAX_LEN,
  RESET_DONE_MESSAGE,
  WARN_PERCENT_ERROR,
  WARN_PERCENT_MAX,
  WARN_PERCENT_MIN,
  collectRowErrors,
  formatUpdatedAt,
  normalizeItems,
  pageDescription,
  parseLimitsEnvelope,
  resetDoneMessage,
  toSavePayload,
  validateMaxChars,
  validateNote,
  validateRow,
  validateWarnPercent,
} from './story-text-limit-utils'

/**
 * 「字数控制」纯逻辑用例。
 *
 * 锁住五件容易静默漂移的事：
 * 1. **前后端字段风格**：管理接口是 snake_case（`max_chars` / `warn_percent` / `label` /
 *    `updated_at` / `updated_by`），读入按 snake_case，提交也必须产出 snake_case ——
 *    写成 camelCase 后端会当缺字段直接 400，是「保存永远失败」的形态；
 * 2. 区间与默认值（1000~50000 / 10000、50~99 / 90）以**后端下发的 defaults / ranges**为准，
 *    本地常量只兜底；
 * 3. 用户可见提示文案逐字（Lead 要写进 PRD，措辞不得随手改）；
 * 4. 越界值**不被静默纠正**：校验只返回提示，绝不改写/夹取输入值（60000 不得变成 50000）；
 * 5. **生效时机文案来自单一真源** RESTART_HINT_*（桌面端只在启动时同步一次）：
 *    页面里不得再出现「定时同步 / 手动同步 / 最长 24h」这类与实现不符的说法。
 */

/** 后端 GET /api/v1/story-text-limits 的真实响应（ops-center/backend/routers 已落地形状） */
function backendEnvelope(overrides = {}) {
  return {
    items: [{
      scope: 'story2video',
      label: '故事讲述',
      max_chars: 10000,
      warn_percent: 90,
      enabled: true,
      note: '',
      updated_at: '2026-10-18T01:05:00Z',
      updated_by: 'admin',
    }],
    count: 1,
    defaults: { max_chars: 10000, warn_percent: 90 },
    ranges: {
      max_chars: { min: 1000, max: 50000 },
      warn_percent: { min: 50, max: 99 },
      note_max_len: 200,
    },
    ...overrides,
  }
}

describe('story-text-limit 常量与用户可见文案', () => {
  it('兜底默认值与后端契约一致（10000 字 / 90%）', () => {
    expect(DEFAULT_MAX_CHARS).toBe(10000)
    expect(DEFAULT_WARN_PERCENT).toBe(90)
    expect(DEFAULT_LIMITS).toEqual({ maxChars: 10000, warnPercent: 90 })
  })

  it('兜底区间与后端契约一致', () => {
    expect(MAX_CHARS_MIN).toBe(1000)
    expect(MAX_CHARS_MAX).toBe(50000)
    expect(WARN_PERCENT_MIN).toBe(50)
    expect(WARN_PERCENT_MAX).toBe(99)
    expect(NOTE_MAX_LEN).toBe(200)
    expect(DEFAULT_RANGES).toEqual({
      maxChars: { min: 1000, max: 50000 },
      warnPercent: { min: 50, max: 99 },
      noteMaxLen: 200,
    })
  })

  it('校验提示与恢复默认提示逐字锁定', () => {
    expect(MAX_CHARS_ERROR).toBe('字数上限需为 1000~50000 的整数')
    expect(WARN_PERCENT_ERROR).toBe('预警阈值需为 50~99 的整数')
    expect(NOTE_ERROR).toBe('备注最多 200 字')
    expect(RESET_DONE_MESSAGE).toBe('已恢复默认（10000 字 / 90%）')
    // 提示里的数字必须与默认值常量同步，防止改了默认值却没改文案
    expect(RESET_DONE_MESSAGE).toBe(`已恢复默认（${DEFAULT_MAX_CHARS} 字 / ${DEFAULT_WARN_PERCENT}%）`)
  })

  it('页面说明逐字锁定（默认 10000 字 / 历史 6000 字 / 生效时机用 RESTART_HINT）', () => {
    expect(pageDescription(DEFAULT_LIMITS)).toBe(
      '控制视频创作页各文案输入框的字数上限。故事讲述流水线的默认上限为 10000 字（历史为 6000 字）。'
        + `修改后的配置${RESTART_HINT_WHEN}；${RESTART_HINT_HOW}。`,
    )
  })
})

describe('生效时机文案（单一真源 RESTART_HINT，防「定时/手动同步」说法回流）', () => {
  // 事实：桌面端 OpsCenterSync 只在应用启动时同步一次（无 setInterval、无手动同步入口），
  // 所以「最长 24h」「可手动同步」是**不存在的入口**，写进页面会误导运营者。
  // 本组同时锁两件事：① 两个语义段都在；② 不得出现与实现不符的关键词。
  const pageCopy = [pageDescription(DEFAULT_LIMITS), EFFECT_NOTICE_SAVE]

  it('页面说明与第 ③ 条都含「何时生效」与「如何立即生效」两段', () => {
    for (const text of pageCopy) {
      expect(text).toContain(RESTART_HINT_WHEN)
      expect(text).toContain(RESTART_HINT_HOW)
    }
  })

  it('不得出现「手动同步」「定时同步」「最长 24」「配置同步时」等与实现不符的说法', () => {
    for (const text of pageCopy) {
      expect(text).not.toContain('手动同步')
      expect(text).not.toContain('定时同步')
      expect(text).not.toContain('轮询')
      expect(text).not.toContain('24 小时')
      expect(text).not.toContain('24h')
      expect(text).not.toContain('下一次配置同步')
      expect(text).not.toContain('配置同步时生效')
    }
  })

  it('第 ③ 条逐字锁定', () => {
    expect(EFFECT_NOTICE_SAVE).toBe(`保存后${RESTART_HINT_WHEN}；${RESTART_HINT_HOW}。`)
  })

  it('保存成功提示 = 项数 + RESTART_HINT，时长 ≥ 6000ms（复用既有装配层）', () => {
    const m = composeSaveMessage({ ok: true, count: 1, corrections: [] })
    expect(m.kind).toBe('success')
    expect(m.text).toBe(`已保存 1 项；${RESTART_HINT}`)
    expect(m.duration).toBeGreaterThanOrEqual(6000)
    expect(m.duration).toBe(RESTART_HINT_DURATION)
  })

  it('恢复默认提示 = 默认值 + RESTART_HINT，时长 ≥ 6000ms', () => {
    const m = composeSaveMessage({ ok: true, count: 1, corrections: [] }, resetDoneMessage())
    expect(m.kind).toBe('success')
    expect(m.text).toBe(`已恢复默认（10000 字 / 90%）；${RESTART_HINT}`)
    expect(m.text).toContain(RESET_DONE_MESSAGE)
    expect(m.duration).toBeGreaterThanOrEqual(6000)
  })

  it('失败路径不得带重启提示（在失败时说「重启后生效」是最严重的误导）', () => {
    const m = composeSaveMessage({ ok: false, detail: '保存失败' })
    expect(m.kind).toBe('error')
    expect(m.text).not.toContain(RESTART_HINT)
  })
})

describe('parseLimitsEnvelope（以服务端 defaults / ranges 为准）', () => {
  it('读取后端信封的 defaults / ranges', () => {
    expect(parseLimitsEnvelope(backendEnvelope())).toEqual({
      ranges: DEFAULT_RANGES,
      defaults: DEFAULT_LIMITS,
    })
  })

  it('后端调整区间时前端跟随（不在前端另抄一份数字）', () => {
    const parsed = parseLimitsEnvelope(backendEnvelope({
      ranges: {
        max_chars: { min: 2000, max: 60000 },
        warn_percent: { min: 60, max: 95 },
        note_max_len: 300,
      },
      defaults: { max_chars: 20000, warn_percent: 80 },
    }))
    expect(parsed.ranges).toEqual({
      maxChars: { min: 2000, max: 60000 },
      warnPercent: { min: 60, max: 95 },
      noteMaxLen: 300,
    })
    expect(parsed.defaults).toEqual({ maxChars: 20000, warnPercent: 80 })
  })

  it('响应缺 defaults / ranges（或畸形）时逐字段回落兜底常量', () => {
    expect(parseLimitsEnvelope(null)).toEqual({ ranges: DEFAULT_RANGES, defaults: DEFAULT_LIMITS })
    expect(parseLimitsEnvelope({ items: [] })).toEqual({ ranges: DEFAULT_RANGES, defaults: DEFAULT_LIMITS })
    expect(parseLimitsEnvelope({ ranges: { max_chars: { min: 'x' } }, defaults: { max_chars: null } }))
      .toEqual({ ranges: DEFAULT_RANGES, defaults: DEFAULT_LIMITS })
  })

  it('服务端区间生效后，校验提示随之变化（不会出现「提示写 1000~50000、实际卡 2000~60000」）', () => {
    const { ranges } = parseLimitsEnvelope(backendEnvelope({
      ranges: { max_chars: { min: 2000, max: 60000 }, warn_percent: { min: 60, max: 95 } },
    }))
    expect(validateMaxChars(1500, ranges)).toBe('字数上限需为 2000~60000 的整数')
    expect(validateWarnPercent(55, ranges)).toBe('预警阈值需为 60~95 的整数')
  })
})

describe('normalizeItems（snake_case 后端响应 → 页面行模型）', () => {
  it('后端 snake_case 字段正确映射（label → scopeLabel、max_chars → maxChars …）', () => {
    const [row] = normalizeItems(backendEnvelope().items)
    expect(row).toEqual({
      scope: 'story2video',
      scopeLabel: '故事讲述',
      maxChars: 10000,
      warnPercent: 90,
      enabled: true,
      note: '',
      updatedAt: '2026-10-18T01:05:00Z',
      updatedBy: 'admin',
    })
  })

  it('缺省 enabled 视为启用，label 缺省回退 scope', () => {
    const [row] = normalizeItems([{ scope: 'story2video', max_chars: 12000, warn_percent: 85 }])
    expect(row.enabled).toBe(true)
    expect(row.scopeLabel).toBe('story2video')
    expect(row.note).toBe('')
    expect(row.updatedAt).toBe('')
  })

  it('enabled 显式 false / 0 都视为关闭', () => {
    expect(normalizeItems([{ scope: 's', enabled: false }])[0].enabled).toBe(false)
    expect(normalizeItems([{ scope: 's', enabled: 0 }])[0].enabled).toBe(false)
  })

  it('兼容 camelCase 写法（上游契约措辞漂移时不至于整页空白）', () => {
    const [row] = normalizeItems([{
      scope: 'story2video', scopeLabel: '故事讲述', maxChars: 10000, warnPercent: 90,
      updatedAt: 'x', updatedBy: 'y', enabled: true, note: 'n',
    }])
    expect(row).toMatchObject({ scopeLabel: '故事讲述', maxChars: 10000, warnPercent: 90 })
  })

  it('非数组入参返回空数组（页面走空态而非崩溃）', () => {
    expect(normalizeItems(null)).toEqual([])
    expect(normalizeItems({ items: [] })).toEqual([])
  })
})

describe('toSavePayload（必须产出后端读取的 snake_case）', () => {
  it('页面行模型 → snake_case，且不带展示/只读字段', () => {
    const payload = toSavePayload([{
      scope: 'story2video',
      scopeLabel: '故事讲述', // 展示字段不得进入请求体
      maxChars: '12000',
      warnPercent: '88',
      enabled: 1,
      note: '长篇小说',
      updatedAt: '2026-10-18T00:00:00Z', // 后端只读字段不得回传
      updatedBy: 'admin',
    }])
    expect(payload).toEqual([{
      scope: 'story2video',
      max_chars: 12000,
      warn_percent: 88,
      enabled: true,
      note: '长篇小说',
    }])
    // 反证：一旦有人把字段改回 camelCase，后端会按缺字段 400（这里钉住键名集合）
    expect(Object.keys(payload[0]).sort()).toEqual(
      ['enabled', 'max_chars', 'note', 'scope', 'warn_percent'],
    )
  })

  it('直接喂后端原始行（snake_case）也能正确产出；enabled 缺省按启用提交', () => {
    expect(toSavePayload([{ scope: 'story2video', max_chars: 10000, warn_percent: 90 }])).toEqual([{
      scope: 'story2video', max_chars: 10000, warn_percent: 90, enabled: true, note: '',
    }])
    expect(toSavePayload([{ scope: 'story2video', max_chars: 10000, warn_percent: 90, enabled: false }])[0].enabled)
      .toBe(false)
  })

  it('note 缺省给空串（后端列为字符串，null 会被 _validate_note 兜成空串，但显式更清晰）', () => {
    expect(toSavePayload([{ scope: 'story2video', maxChars: 10000, warnPercent: 90 }])[0].note).toBe('')
  })
})

describe('validateMaxChars', () => {
  it('区间内整数合法（含边界 1000 / 50000）', () => {
    for (const value of [1000, 6000, 10000, 30000, 50000]) {
      expect(validateMaxChars(value), `应合法：${value}`).toBe('')
    }
  })

  it('越界整数不合法', () => {
    expect(validateMaxChars(999)).toBe(MAX_CHARS_ERROR)
    expect(validateMaxChars(50001)).toBe(MAX_CHARS_ERROR)
    expect(validateMaxChars(0)).toBe(MAX_CHARS_ERROR)
    expect(validateMaxChars(-1000)).toBe(MAX_CHARS_ERROR)
  })

  // PRD §11 E5：组件 clamp 会让「运营配错了」看起来像生效了。
  // 输入框已去掉 :min/:max，越界值原样保留并在这里被判不合法（而不是变成 50000 后照样保存）。
  it('60000 不会被夹成 50000，而是给出中文提示', () => {
    expect(validateMaxChars(60000)).toBe('字数上限需为 1000~50000 的整数')
    expect(validateMaxChars(60000)).toBe(MAX_CHARS_ERROR)
  })

  it('合法值 12000 通过校验', () => {
    expect(validateMaxChars(12000)).toBe('')
  })

  it('非整数（小数 / null / 空串 / NaN）不合法，且不静默取整', () => {
    for (const value of [1000.5, 9999.999, null, undefined, '', '  ', NaN]) {
      expect(validateMaxChars(value), `应不合法：${String(value)}`).toBe(MAX_CHARS_ERROR)
    }
  })

  it('数字字符串按数值校验（后端若回显字符串形式）', () => {
    expect(validateMaxChars('12000')).toBe('')
    expect(validateMaxChars('999')).toBe(MAX_CHARS_ERROR)
    expect(validateMaxChars('abc')).toBe(MAX_CHARS_ERROR)
  })
})

describe('validateWarnPercent', () => {
  it('区间内整数合法（含边界 50 / 99）', () => {
    for (const value of [50, 75, 90, 99]) {
      expect(validateWarnPercent(value), `应合法：${value}`).toBe('')
    }
  })

  it('越界与非整数不合法', () => {
    expect(validateWarnPercent(49)).toBe(WARN_PERCENT_ERROR)
    expect(validateWarnPercent(100)).toBe(WARN_PERCENT_ERROR)
    expect(validateWarnPercent(90.5)).toBe(WARN_PERCENT_ERROR)
    expect(validateWarnPercent(null)).toBe(WARN_PERCENT_ERROR)
    expect(validateWarnPercent('90')).toBe('')
  })
})

describe('validateNote', () => {
  it('空值 / 未超长合法', () => {
    expect(validateNote('')).toBe('')
    expect(validateNote(null)).toBe('')
    expect(validateNote('字'.repeat(200))).toBe('')
  })

  it('超过 200 字给出后端同款提示', () => {
    expect(validateNote('字'.repeat(201))).toBe(NOTE_ERROR)
  })
})

describe('validateRow / collectRowErrors', () => {
  const validRow = { scope: 'story2video', scopeLabel: '故事讲述', maxChars: 10000, warnPercent: 90 }

  it('整行合法时三项提示都为空', () => {
    expect(validateRow(validRow)).toEqual({ maxChars: '', warnPercent: '', note: '' })
  })

  it('全部合法时 collectRowErrors 返回空数组', () => {
    expect(collectRowErrors([validRow])).toEqual([])
  })

  it('只报告有问题的行，并保留 scope / scopeLabel 便于定位', () => {
    const rows = [
      validRow,
      { scope: 'other', scopeLabel: '其他', maxChars: 999, warnPercent: 90 },
    ]
    const errors = collectRowErrors(rows)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      scope: 'other',
      scopeLabel: '其他',
      maxChars: MAX_CHARS_ERROR,
      warnPercent: '',
      messages: [MAX_CHARS_ERROR],
    })
  })

  it('同一行多个字段非法时 messages 按字段顺序包含多条提示', () => {
    const errors = collectRowErrors([{ scope: 's', maxChars: 100, warnPercent: 10, note: '字'.repeat(201) }])
    expect(errors[0].messages).toEqual([MAX_CHARS_ERROR, WARN_PERCENT_ERROR, NOTE_ERROR])
  })

  it('后端原始行（snake_case）也能直接校验', () => {
    const errors = collectRowErrors([{ scope: 'story2video', label: '故事讲述', max_chars: 999, warn_percent: 10 }])
    expect(errors[0]).toMatchObject({ scopeLabel: '故事讲述', messages: [MAX_CHARS_ERROR, WARN_PERCENT_ERROR] })
  })

  it('scopeLabel 缺省回退到 scope', () => {
    const errors = collectRowErrors([{ scope: 'story2video', maxChars: 100, warnPercent: 90 }])
    expect(errors[0].scopeLabel).toBe('story2video')
  })

  it('非数组入参安全返回空数组', () => {
    expect(collectRowErrors(null)).toEqual([])
    expect(collectRowErrors(undefined)).toEqual([])
  })
})

describe('formatUpdatedAt', () => {
  it('按本地时区格式化为 YYYY-MM-DD HH:mm', () => {
    expect(formatUpdatedAt(new Date(2026, 9, 18, 9, 5))).toBe('2026-10-18 09:05')
  })

  it('空值显示破折号', () => {
    expect(formatUpdatedAt('')).toBe('—')
    expect(formatUpdatedAt(null)).toBe('—')
    expect(formatUpdatedAt(undefined)).toBe('—')
  })

  it('无法解析的值原样返回（不抛错、不显示 Invalid Date）', () => {
    expect(formatUpdatedAt('not-a-date')).toBe('not-a-date')
  })

  it('后端 ISO 时间串可解析（尾随 Z 的 UTC 串）', () => {
    expect(formatUpdatedAt('2026-10-18T01:05:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('resetDoneMessage / 页面提示与 defaults 联动', () => {
  it('默认取契约默认值 → 锁定文案', () => {
    expect(resetDoneMessage()).toBe(RESET_DONE_MESSAGE)
    expect(resetDoneMessage(DEFAULT_LIMITS)).toBe('已恢复默认（10000 字 / 90%）')
  })

  it('后端下发不同默认值时文案随之变化（不写死）', () => {
    expect(resetDoneMessage({ maxChars: 20000, warnPercent: 80 })).toBe('已恢复默认（20000 字 / 80%）')
  })
})
