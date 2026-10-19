// @ts-check
'use strict'
/**
 * shot-duration 契约测试（v7 批次一 F2 + F34）
 * 覆盖：语速折算（中/英/混排）/ 档位吸附（只向上不向下）/ 上限溢出 /
 *       来源优先级链（user > tts > formula > tier）/ 非法值降级并出声 /
 *       批量解析与来源分布 / 纯函数无 IO
 */
const {
  DURATION_SOURCES, DEFAULT_TIERS, DEFAULT_MAX_SEC, MIN_SHOT_SEC,
  ZH_CHARS_PER_SECOND, EN_WORDS_PER_SECOND,
  countSpeechUnits, extractDialogueText, snapToTier, estimateShotSeconds, resolveShotDurationMs, resolvePlanDurations,
} = require('./shot-duration')

describe('shot-duration / 常量与优先级声明', () => {
  it('来源优先级是高到低（user 最高）', () => {
    expect(DURATION_SOURCES).toEqual(['user', 'tts', 'formula', 'tier'])
  })

  it('默认档位与上限自洽（maxSec 等于最大档位）', () => {
    expect(DEFAULT_MAX_SEC).toBe(Math.max(...DEFAULT_TIERS))
  })

  it('三类情绪语速齐备且争吵 > 常规 > 深情', () => {
    expect(ZH_CHARS_PER_SECOND.argument).toBeGreaterThan(ZH_CHARS_PER_SECOND.normal)
    expect(ZH_CHARS_PER_SECOND.normal).toBeGreaterThan(ZH_CHARS_PER_SECOND.tender)
    expect(EN_WORDS_PER_SECOND.argument).toBeGreaterThan(EN_WORDS_PER_SECOND.normal)
    expect(EN_WORDS_PER_SECOND.normal).toBeGreaterThan(EN_WORDS_PER_SECOND.tender)
  })
})

describe('shot-duration / countSpeechUnits', () => {
  it('中文按字计', () => {
    expect(countSpeechUnits('你好世界').cjkChars).toBe(4)
  })

  it('英文按词计', () => {
    const u = countSpeechUnits('I will never let you go')
    expect(u.latinWords).toBe(6)
    expect(u.cjkChars).toBe(0)
  })

  it('中英混排分别计数', () => {
    const u = countSpeechUnits('他说 OK 然后走了')
    expect(u.cjkChars).toBe(6) // 他 说 然 后 走 了
    expect(u.latinWords).toBe(1)
    expect(u.total).toBe(7)
  })

  it('括号内舞台提示不计入（不占说话时长）', () => {
    const withCue = countSpeechUnits('（转身看向窗外）你好')
    const without = countSpeechUnits('你好')
    expect(withCue.total).toBe(without.total)
  })

  it('标点与空白不计入', () => {
    expect(countSpeechUnits('，。！？  \n\t').total).toBe(0)
  })

  it('空串 / 非字符串安全返回 0', () => {
    expect(countSpeechUnits('').total).toBe(0)
    expect(countSpeechUnits(null).total).toBe(0)
    expect(countSpeechUnits(undefined).total).toBe(0)
    expect(countSpeechUnits(123).total).toBe(0)
  })
})

describe('shot-duration / snapToTier（默认向上，容差内就近）', () => {
  it('明显超出档位时向上取（不向下，否则会切掉台词尾巴）', () => {
    expect(snapToTier(3).sec).toBe(5)
    expect(snapToTier(5).sec).toBe(5)
    expect(snapToTier(6).sec).toBe(8)
    expect(snapToTier(7.9).sec).toBe(8)
    expect(snapToTier(9).sec).toBe(10)
  })

  it('容差内（默认 0.3s）取该档而非跳三秒——v7 对抗评审 i5', () => {
    // 40 字 → 5.0s 用 5s 档；41 字 → 5.125s，只超出 0.125s，不该跳到 8s（+60%）
    const r41 = snapToTier(5.125)
    expect(r41.sec).toBe(5)
    expect(r41.toleranceUsed).toBe(true)
    // 超出容差才向上
    const over = snapToTier(5.4)
    expect(over.sec).toBe(8)
    expect(over.toleranceUsed).toBe(false)
  })

  it('容差可注入，0 表示严格向上', () => {
    expect(snapToTier(5.1, undefined, { toleranceSec: 0 }).sec).toBe(8)
    expect(snapToTier(5.1, undefined, { toleranceSec: 0.5 }).sec).toBe(5)
  })

  it('超过最大档时取最大档并置 overflow', () => {
    const r = snapToTier(20)
    expect(r.sec).toBe(12)
    expect(r.overflow).toBe(true)
  })

  it('非法输入回落到最小档且不 overflow', () => {
    expect(snapToTier(0).sec).toBe(5)
    expect(snapToTier(-1).sec).toBe(5)
    expect(snapToTier(NaN).sec).toBe(5)
    expect(snapToTier(0).overflow).toBe(false)
  })

  it('可注入自定义档位', () => {
    expect(snapToTier(6, [4, 6, 9]).sec).toBe(6)
    expect(snapToTier(7, [4, 6, 9]).sec).toBe(9)
  })
})

describe('shot-duration / estimateShotSeconds（F2 主函数）', () => {
  it('常规情绪：40 字 → 5 秒（40/8）', () => {
    const text = '一'.repeat(40)
    const r = estimateShotSeconds(text, 'normal')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rawSec).toBeCloseTo(5, 5)
    expect(r.durationSec).toBe(5)
    expect(r.source).toBe('formula')
  })

  it('争吵情绪同字数更短：40 字 → 4 秒 → 吸附到 5', () => {
    const r = estimateShotSeconds('一'.repeat(40), 'argument')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rawSec).toBeCloseTo(4, 5)
    expect(r.durationSec).toBe(5)
  })

  it('深情情绪同字数更长：40 字 → 8 秒', () => {
    const r = estimateShotSeconds('一'.repeat(40), 'tender')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rawSec).toBeCloseTo(8, 5)
    expect(r.durationSec).toBe(8)
  })

  it('80 字深情 → 16s 超过 12s 上限 → 取 12 并给出拆解警告', () => {
    const r = estimateShotSeconds('一'.repeat(80), 'tender')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rawSec).toBeCloseTo(16, 5)
    expect(r.durationSec).toBe(12)
    expect(r.overflow).toBe(true)
    expect(r.warnings.join()).toContain('long_dialogue_split')
  })

  it('无台词 → 最小档并提示交给画面动作决定', () => {
    const r = estimateShotSeconds('', 'normal')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.units.total).toBe(0)
    expect(r.warnings.join()).toContain('无台词')
  })

  it('情绪档非法时回落 normal（不抛）', () => {
    const r = estimateShotSeconds('一'.repeat(40), 'furious')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.emotion).toBe('normal')
  })

  it('中英混排按各自语速分别折算后相加', () => {
    // 中文 8 字 / 8 + 英文 26 词 / 2.6 = 1 + 10 = 11
    const text = '一二三四五六七八' + ' ' + Array.from({ length: 26 }, () => 'word').join(' ')
    const r = estimateShotSeconds(text, 'normal')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.units.cjkChars).toBe(8)
    expect(r.units.latinWords).toBe(26)
    expect(r.rawSec).toBeCloseTo(11, 3)
  })

  it('返回 durationMs 与 durationSec 自洽', () => {
    const r = estimateShotSeconds('一'.repeat(40), 'normal')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.durationMs).toBe(Math.round(r.durationSec * 1000))
  })

  it('可注入自定义档位与上限', () => {
    const r = estimateShotSeconds('一'.repeat(40), 'normal', { tiers: [3, 6], maxSec: 6 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.durationSec).toBe(6)
  })
})

describe('shot-duration / resolveShotDurationMs（F34 优先级链）', () => {
  it('user 最高优先：即使给了 tts 与台词也以 user 为准', () => {
    const r = resolveShotDurationMs({ userDurationMs: 8000, ttsDurationMs: 5000, dialogue: '一'.repeat(80) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('user')
    expect(r.durationMs).toBe(8000)
  })

  it('无 user 时取 tts（实测优于推算）', () => {
    const r = resolveShotDurationMs({ ttsDurationMs: 6500, dialogue: '一'.repeat(80) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('tts')
    expect(r.durationMs).toBe(6500)
  })

  it('无 user/tts 且有台词 → formula', () => {
    const r = resolveShotDurationMs({ dialogue: '一'.repeat(40), emotion: 'normal' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('formula')
    expect(r.durationSec).toBe(5)
  })

  it('无 user/tts/台词 → tier 兜底（用 defaultSec）', () => {
    const r = resolveShotDurationMs({}, { defaultSec: 8 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('tier')
    expect(r.durationSec).toBe(8)
  })

  it('无 defaultSec 时 tier 取最小档', () => {
    const r = resolveShotDurationMs({})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.durationSec).toBe(DEFAULT_TIERS[0])
  })

  it('user 超过上限 → 截到上限并 audible 警告（不静默）', () => {
    const r = resolveShotDurationMs({ userDurationMs: 30000 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.durationSec).toBe(DEFAULT_MAX_SEC)
    expect(r.warnings.join()).toContain('超过单镜上限')
    expect(r.warnings.join()).toContain('拆镜')
  })

  it('user 低于下限 → 抬到下限并警告', () => {
    const r = resolveShotDurationMs({ userDurationMs: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.durationSec).toBe(MIN_SHOT_SEC)
    expect(r.warnings.join()).toContain('低于下限')
  })

  it('tts 非法值 → 记警告后降级到 formula（不静默当成 0）', () => {
    const r = resolveShotDurationMs({ ttsDurationMs: -1, dialogue: '一'.repeat(40) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('formula')
    expect(r.warnings.join()).toContain('TTS 实测时长非法')
  })

  it('user 非法值 → 记警告后降级', () => {
    const r = resolveShotDurationMs({ userDurationMs: 'abc', dialogue: '一'.repeat(40) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('formula')
    expect(r.warnings.join()).toContain('用户设定时长非法')
  })

  it('text 字段在 dialogue 缺失时作为台词来源', () => {
    const r = resolveShotDurationMs({ text: '一'.repeat(40) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('formula')
  })

  it('shot 为 null/undefined 时按空镜处理（tier 兜底）', () => {
    const r1 = resolveShotDurationMs(null, { defaultSec: 5 })
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.source).toBe('tier')
    const r2 = resolveShotDurationMs(undefined)
    expect(r2.ok).toBe(true)
  })
})

describe('shot-duration / resolvePlanDurations（批量）', () => {
  it('汇总来源分布与总时长', () => {
    const r = resolvePlanDurations([
      { userDurationMs: 5000 },
      { ttsDurationMs: 8000 },
      { dialogue: '一'.repeat(40) },
      {},
    ], { defaultSec: 5 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items.length).toBe(4)
    expect(r.distribution).toEqual({ user: 1, tts: 1, formula: 1, tier: 1 })
    expect(r.totalDurationSec).toBe(5 + 8 + 5 + 5)
  })

  it('逐镜警告带索引前缀，便于定位', () => {
    const r = resolvePlanDurations([{ userDurationMs: 99999 }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings[0]).toContain('shots[0]')
  })

  it('空数组返回零分布', () => {
    const r = resolvePlanDurations([])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items).toEqual([])
    expect(r.totalDurationSec).toBe(0)
  })

  it('非数组输入按空处理，不抛', () => {
    expect(resolvePlanDurations(null).ok).toBe(true)
    expect(resolvePlanDurations(undefined).ok).toBe(true)
  })
})

// ===== v7 对抗评审修复的回归锁 =====

describe('shot-duration / extractDialogueText（i1：引号内才是台词）', () => {
  it('中文引号抽取', () => {
    const r = extractDialogueText('他推开门，低声说：「你终于来了。」然后转身')
    expect(r.usedQuotes).toBe(true)
    expect(r.dialogue).toBe('你终于来了。')
  })

  it('直角引号与弯引号都识别', () => {
    expect(extractDialogueText('『走吧』').dialogue).toBe('走吧')
    expect(extractDialogueText('“走吧”').dialogue).toBe('走吧')
    expect(extractDialogueText('"go now"').dialogue).toBe('go now')
  })

  it('多段引号按行合并', () => {
    const r = extractDialogueText('他说：「第一句。」停了一下，又说：「第二句。」')
    expect(r.dialogue).toBe('第一句。\n第二句。')
  })

  it('无引号时退化为整段并标记 usedQuotes=false（宁可高估不可低估）', () => {
    const r = extractDialogueText('他推开门走进屋子')
    expect(r.usedQuotes).toBe(false)
    expect(r.dialogue).toBe('他推开门走进屋子')
  })

  it('空引号不算台词，退化为整段', () => {
    const r = extractDialogueText('他说：「」')
    expect(r.usedQuotes).toBe(false)
  })

  it('空 / 非字符串安全', () => {
    expect(extractDialogueText('').dialogue).toBe('')
    expect(extractDialogueText(null).dialogue).toBe('')
  })
})

describe('shot-duration / 日韩字符不计入语速（i8）', () => {
  it('假名与谚文不计入 total，但被计数并告警', () => {
    const u = countSpeechUnits('こんにちは 세계')
    expect(u.total).toBe(0)
    expect(u.excludedKanaHangul).toBeGreaterThan(0)
    const r = estimateShotSeconds('こんにちは', 'normal')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.join()).toContain('假名/谚文')
  })

  it('汉字仍正常计入', () => {
    expect(countSpeechUnits('你好世界').cjkChars).toBe(4)
  })
})

describe('shot-duration / 吸附落差如实回传（i5）', () => {
  it('estimateShotSeconds 回传 rawSec 与 snapDeltaSec', () => {
    const r = estimateShotSeconds('一'.repeat(41), 'normal')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rawSec).toBeGreaterThan(5)
    expect(r.rawSec).toBeLessThan(5.4)
    expect(r.durationSec).toBe(5)
    expect(r.snapDeltaSec).toBeLessThan(0)
    expect(r.toleranceUsed).toBe(true)
  })

  it('resolveShotDurationMs 透传 rawSec', () => {
    const r = resolveShotDurationMs({ dialogue: '一'.repeat(41) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Number.isFinite(r.rawSec)).toBe(true)
    expect(Number.isFinite(r.snapDeltaSec)).toBe(true)
  })
})

describe('shot-duration / text 走引号抽取（i1 端到端）', () => {
  it('动作 + 长台词混排时，只按台词计时长', () => {
    // 动作描述 40 字 + 引号内台词 8 字：若按整段会算 6s+，按台词只有 1s → 5s 档
    const text = '他缓慢地推开门走进屋子环顾四周然后停在窗前凝视着外面的雨夜' + '「你来了。」'
    const r = resolveShotDurationMs({ text })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('formula')
    expect(r.rawSec).toBeLessThan(2)
  })
})
