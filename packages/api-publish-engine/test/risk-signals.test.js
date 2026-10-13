// fix-risk-hold-false-positive 回归锁：风控信号单一真源的强/弱分档与边界
//
// 本文件是本次「误判修复」的主回归锁。三组断言各自对应一个真实缺陷：
//   ① 误判面（旧裸子串词表命中、必须不再命中）
//   ② 真风控召回（收紧后必须仍然命中且为 strong）
//   ③ suspends 不变量（弱信号永不挂起 —— 由单一真源给出，调用方不得自行推导）
const {
  classifyRisk,
  isRiskText,
  RISK_STRONG_RE,
  RISK_WEAK_RE,
  RISK_ANY_RE,
} = require('../src/publish/core/risk-signals')

describe('risk-signals.classifyRisk — 结构化信号优先', () => {
  it('显式 riskBlocked / risk_blocked 声明 → strong + suspends，完全不看文本', () => {
    for (const flag of [{ riskBlocked: true }, { risk_blocked: true }]) {
      const v = classifyRisk(Object.assign({ error: '完全无关的普通错误' }, flag))
      expect(v.hit).toBe(true)
      expect(v.strength).toBe('strong')
      expect(v.signal).toBe('flag')
      expect(v.suspends).toBe(true)
    }
  })

  it('平台风控码族（BILI_RISK_601 / 601 / 10000015 / -1e7）→ strong，即便文本无关', () => {
    for (const code of ['BILI_RISK_601', 601, 10000015, -1e7, 'RISK_BLOCKED']) {
      const v = classifyRisk({ code, error: 'upstream returned 500' })
      expect(v.hit).toBe(true)
      expect(v.strength).toBe('strong')
      expect(v.suspends).toBe(true)
      expect(v.signal).toContain('code:')
    }
  })

  it('结构化信号优先于文本：显式 flag 不会被"文本看着无害"推翻', () => {
    const v = classifyRisk({ riskBlocked: true, error: '网络超时' })
    expect(v.strength).toBe('strong')
    expect(v.suspends).toBe(true)
  })
})

describe('risk-signals.classifyRisk — ① 误判面回归（旧词表命中、现在必须不挂起）', () => {
  // 每一条都来自实测取证：旧 RISK_RE 会命中并把账号/平台冻结
  const FALSE_POSITIVES = [
    ['HTTP 状态码 601', 'Request failed with status code 601'],
    ['ID 含 601', 'publish id 6019 not found'],
    ['时间戳含 601', 'gateway timeout ts=1601846521'],
    ['风控码的邻居', 'errno 100000159: bad request'],
    ['英文子串 infrequent', 'infrequent login detected'],
    ['英文普通词 low-risk', 'low-risk content flagged'],
    ['英文前缀 derisk', 'derisk pipeline unavailable'],
    ['英文 verified', 'verified badge missing'],
    ['普通「验证」', '身份验证失败'],
    ['普通「验证」', '请先完成实名验证'],
    ['普通「频繁」', '请求过于频繁，请稍后重试'],
  ]

  for (const [label, msg] of FALSE_POSITIVES) {
    it(label + ' ⇒ 不挂起（suspends=false）: ' + msg, () => {
      const v = classifyRisk({ error: msg })
      expect(v.suspends).toBe(false)
    })
  }

  it('以上误判样例即使判为 hit，其 strength 也只能是 weak（不是 strong）', () => {
    for (const [, msg] of FALSE_POSITIVES) {
      const v = classifyRisk({ error: msg })
      if (v.hit) expect(v.strength).toBe('weak')
    }
  })

  it('普通发布失败应当完全不命中（hit=false）', () => {
    const plain = [
      '平台 Cookie 缺失（账号 acc-1 未登录或凭证不可用）',
      '缺少视频文件路径',
      '网络超时',
      '服务异常请稍后重试',
      'publish btn not found',
      'element not found in iframe',
      'No file input found (JS fallback)',
      'File not found: D:/x.mp4',
      'API publish failed for wechat_mp',
      'No API adapter for platform: xiaohongshu',
      'timeout of 20000ms exceeded',
      'ECONNRESET',
      '',
    ]
    for (const m of plain) {
      const v = classifyRisk({ error: m })
      expect(v.hit, m).toBe(false)
      expect(v.suspends, m).toBe(false)
    }
  })

  it('守卫自身标记 risk_suspended 不构成平台信号（自触发防线）', () => {
    for (const m of ['publish blocked: risk_suspended for weixin/acc1', 'risk_suspended']) {
      const v = classifyRisk({ error: m })
      expect(v.hit, m).toBe(false)
      expect(v.suspends, m).toBe(false)
    }
  })

  it('非字符串输入安全返回 not-hit', () => {
    for (const bad of [null, undefined, {}, 601, [], true]) {
      const v = classifyRisk({ error: bad })
      expect(v.hit).toBe(false)
      expect(v.suspends).toBe(false)
    }
    expect(classifyRisk().hit).toBe(false)
    expect(classifyRisk({}).hit).toBe(false)
  })
})

describe('risk-signals.classifyRisk — ② 真风控召回（收紧后必须仍为 strong）', () => {
  // 覆盖仓内全部真实风控来源：抖音 / B站 / 快手 / 百家号 / 小红书 / 参考产品取证词
  const REAL_RISK = [
    ['抖音 x-tt-verify', '抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号）'],
    ['抖音 110', '抖音验证失败(110)，请手动完成验证后重试'],
    ['B站 601', 'B站风控(601)：请先在创作者中心完成滑块验证后重试'],
    ['快手验证页', '快手返回验证页/非 JSON 应答，疑似风控拦截，请在创作者中心手动确认后再试（不自动验证、不换号）'],
    ['百家号 10000015', '百家号风控拦截：您所在网络环境异常，请完成验证（30天内注册的百家号作者弹码），请先在浏览器中登录百家号完成验证'],
    ['小红书弹层', '检测到风控/验证弹层，已停止'],
    ['参考产品 canvas illegal', 'canvas illegal'],
    ['参考产品 canvas illegal 变体', 'Canvas Illegal: 请先到创作者中心发布一篇内容'],
    ['参考产品 账号存在风险', '官方检测到您的账号存在风险，请先前往创作者中心发布作品'],
    ['英文 risk control', 'risk control detected'],
    ['操作频繁', '操作频繁，请 60 分钟后再试'],
    ['滑块', '需要滑块验证'],
    ['captcha', 'captcha required'],
    ['安全验证', '安全验证未通过'],
    ['码族文本', 'code 10000015 verify'],
    ['规范化 B 站码名', 'BILI_RISK_601'],
  ]

  for (const [label, msg] of REAL_RISK) {
    it(label + ' ⇒ strong + suspends', () => {
      const v = classifyRisk({ error: msg })
      expect(v.hit, msg).toBe(true)
      expect(v.strength, msg).toBe('strong')
      expect(v.suspends, msg).toBe(true)
      expect(v.signal).not.toBe('')
    })
  }

  it('「抖音安全 verify 拦截」是弱信号（hit 但 weak）：路由仍按风控停报，挂起需更强证据', () => {
    // 该文案是 douyin-risk.test.js 的合成夹具，不是生产文案（生产为「触发安全验证」/「验证失败(110)」，
    // 两者都在强档）。裸 verify 与 confirmed/verify 类普通英文错误无法区分 ⇒ 只提示不挂起。
    const v = classifyRisk({ error: '抖音安全 verify 拦截' })
    expect(v.hit).toBe(true)
    expect(v.strength).toBe('weak')
    expect(v.suspends).toBe(false)
    // 但「像不像风控」的并集判据必须仍然为真，否则引擎会把它降级到 DOM（契约见 douyin-risk.test.js）
    expect(isRiskText('抖音安全 verify 拦截')).toBe(true)
  })

  it('signal 是封闭词表记号（可安全持久化），不含原始错误全文', () => {
    const long = 'B站风控(601)：请先在创作者中心完成滑块验证后重试' + 'x'.repeat(500)
    const v = classifyRisk({ error: long })
    expect(v.signal.length).toBeLessThan(40)
    expect(v.signal).not.toContain('x'.repeat(50))
  })
})

describe('risk-signals — ③ suspends 不变量（弱信号永不挂起）', () => {
  it('任何 strength=weak 的判定，suspends 必须为 false', () => {
    const weakCases = [
      '身份验证失败',
      '请先完成实名验证',
      'Request failed with status code 601',
      'low-risk content flagged',
      '请先完成实名验证后重试',
    ]
    for (const m of weakCases) {
      const v = classifyRisk({ error: m })
      expect(v.hit, m).toBe(true)
      expect(v.strength, m).toBe('weak')
      expect(v.suspends, m).toBe(false)
    }
  })

  it('infrequent login detected 连 hit 都不是（标识符边界挡住了英文子串）', () => {
    const v = classifyRisk({ error: 'infrequent login detected' })
    expect(v.hit).toBe(false)
    expect(v.suspends).toBe(false)
  })

  it('verified / verification 也不算命中（verify 的词形边界）', () => {
    for (const m of ['verified badge missing', 'verification email sent']) {
      const v = classifyRisk({ error: m })
      expect(v.hit, m).toBe(false)
    }
  })

  it('不变量恒等式：suspends ⇔ (hit && strength === "strong")', () => {
    const samples = [
      { error: '触发风控' },
      { error: '身份验证失败' },
      { error: '网络超时' },
      { riskBlocked: true, error: 'x' },
      { code: 601, error: 'x' },
      {},
    ]
    for (const s of samples) {
      const v = classifyRisk(s)
      expect(v.suspends).toBe(Boolean(v.hit && v.strength === 'strong'))
    }
  })
})

describe('risk-signals — 边界与并集判据', () => {
  it('数字边界：601 / 10000015 不做子串命中', () => {
    expect(RISK_ANY_RE.test('1601')).toBe(false)
    expect(RISK_ANY_RE.test('6019')).toBe(false)
    expect(RISK_ANY_RE.test('1601846521')).toBe(false)
    expect(RISK_ANY_RE.test('100000159')).toBe(false)
    expect(RISK_ANY_RE.test('code 601')).toBe(true)
    expect(RISK_ANY_RE.test('errno 10000015')).toBe(true)
  })

  it('标识符边界：下划线算边界（BILI_RISK_601 可命中），字母数字不算', () => {
    expect(RISK_ANY_RE.test('BILI_RISK_601')).toBe(true)
    expect(RISK_WEAK_RE.test('derisk')).toBe(false)
    expect(RISK_WEAK_RE.test('infrequent')).toBe(false)
    expect(RISK_WEAK_RE.test('verified')).toBe(false)
    expect(RISK_WEAK_RE.test('low-risk')).toBe(true)
  })

  it('守卫标记的排除发生在判定层而非裸词表：RISK_ANY_RE 是纯并集，classifyRisk/isRiskText 才排除', () => {
    // 裸正则只表达「词表里有这个词」；「这是不是平台信号」的语义判定在函数里。
    // 这条锁钉住分工，避免有人把排除逻辑删掉后以为裸正则还在兜底。
    expect(RISK_ANY_RE.test('risk_suspended')).toBe(true)
    expect(isRiskText('risk_suspended')).toBe(false)
    expect(classifyRisk({ error: 'risk_suspended' }).hit).toBe(false)
  })

  it('isRiskText 是并集判据：强弱都算「像风控」，但排除守卫标记', () => {
    expect(isRiskText('触发风控')).toBe(true)
    expect(isRiskText('身份验证失败')).toBe(true)   // weak 也算「像」
    expect(isRiskText('网络超时')).toBe(false)
    expect(isRiskText('publish blocked: risk_suspended for a/b')).toBe(false)
    expect(isRiskText(null)).toBe(false)
    expect(isRiskText(601)).toBe(false)
  })

  it('并集正则 = 强 ∪ 弱（两者命中集合被覆盖）', () => {
    expect(RISK_ANY_RE.source).toContain(RISK_STRONG_RE.source)
    expect(RISK_ANY_RE.source).toContain(RISK_WEAK_RE.source)
  })
})
