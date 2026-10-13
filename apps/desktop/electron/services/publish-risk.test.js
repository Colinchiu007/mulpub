// @vitest-environment node
const { isRiskBlocked, classifyRisk, isRiskText } = require('./publish-risk')

describe('publish-risk.isRiskBlocked（兼容签名 = 强弱并集「像不像风控」）', () => {
  it('识别常见风控信号为命中', () => {
    const hits = ['触发风控，请稍后再试', 'risk control detected', '需要滑块验证', 'captcha required', '操作频繁，请 60 分钟后再试', 'code 10000015 verify', '安全验证未通过']
    for (const m of hits) expect(isRiskBlocked(m)).toBe(true)
  })

  it('P0-2 词表增强：识别参考产品取证的风控特征串', () => {
    // 参考产品 4.13.19 -110 码族的触发条件（canvas illegal 为抖音/西瓜特征串）
    const hits = ['canvas illegal', 'Canvas Illegal: 请先到创作者中心发布一篇内容', '官方检测到您的账号存在风险，请先前往创作者中心发布作品']
    for (const m of hits) expect(isRiskBlocked(m)).toBe(true)
  })

  it('普通发布失败判为非命中', () => {
    const misses = ['平台 Cookie 缺失（账号未登录）', '缺少视频文件路径', '网络超时', '服务异常请稍后重试', '']
    for (const m of misses) expect(isRiskBlocked(m)).toBe(false)
  })

  it('非字符串输入安全返回 false', () => {
    expect(isRiskBlocked(null)).toBe(false)
    expect(isRiskBlocked(undefined)).toBe(false)
    expect(isRiskBlocked(601)).toBe(false)
    expect(isRiskBlocked({})).toBe(false)
  })
})

describe('publish-risk — fix-risk-hold-false-positive 误判面回归', () => {
  // 旧裸子串词表会把这七类普通失败判成风控并**挂起**；现在必须连挂起资格都没有。
  const MUST_NOT_SUSPEND = [
    ['HTTP 601', 'Request failed with status code 601'],
    ['ID 含 601', 'publish id 6019 not found'],
    ['时间戳含 601', 'gateway timeout ts=1601846521'],
    ['风控码邻居', 'errno 100000159: bad request'],
    ['英文子串', 'infrequent login detected'],
    ['英文普通词', 'low-risk content flagged'],
    ['普通验证', '身份验证失败'],
    // CCG 深度审查 i1：`captcha` 曾无边界，`recaptcha`/`hcaptcha`（浏览器自动化常见报错）会判 strong
    ['验证码组件名', 'recaptcha failed to load'],
    ['验证码组件名', 'hcaptcha widget error'],
  ]

  for (const [label, msg] of MUST_NOT_SUSPEND) {
    it(label + ' ⇒ suspends=false（不得挂起）: ' + msg, () => {
      expect(classifyRisk({ error: msg }).suspends).toBe(false)
    })
  }

  it('守卫自身标记不构成平台信号（自触发防线仍在）', () => {
    const v = classifyRisk({ error: 'publish blocked: risk_suspended for weixin/acc1' })
    expect(v.hit).toBe(false)
    expect(v.suspends).toBe(false)
    expect(isRiskBlocked('publish blocked: risk_suspended for weixin/acc1')).toBe(false)
  })

  it('真风控仍为 strong 且允许挂起（收紧不损召回）', () => {
    const strong = [
      '抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号）',
      '抖音验证失败(110)，请手动完成验证后重试',
      'B站风控(601)：请先在创作者中心完成滑块验证后重试',
      '快手返回验证页/非 JSON 应答，疑似风控拦截',
      '百家号风控拦截：您所在网络环境异常，请完成验证',
      '检测到风控/验证弹层，已停止',
      'canvas illegal',
      '账号存在风险',
    ]
    for (const m of strong) {
      const v = classifyRisk({ error: m })
      expect(v.strength, m).toBe('strong')
      expect(v.suspends, m).toBe(true)
    }
  })

  it('结构化信号优先：无文本也判定 strong', () => {
    expect(classifyRisk({ riskBlocked: true }).suspends).toBe(true)
    expect(classifyRisk({ risk_blocked: true }).suspends).toBe(true)
    expect(classifyRisk({ code: 10000015 }).suspends).toBe(true)
    expect(classifyRisk({ code: 'BILI_RISK_601' }).suspends).toBe(true)
    expect(classifyRisk({ code: 500, error: 'server error' }).suspends).toBe(false)
  })

  it('单一真源：桌面侧与引擎侧共用同一判定（此处断言导入的是引擎模块）', () => {
    const engine = require('@multi-publish/api-publish-engine/src/publish/core/risk-signals')
    expect(classifyRisk).toBe(engine.classifyRisk)
    expect(isRiskText).toBe(engine.isRiskText)
  })
})
