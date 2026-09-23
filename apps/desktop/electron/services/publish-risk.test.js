// @vitest-environment node
const { isRiskBlocked } = require('./publish-risk')

describe('publish-risk.isRiskBlocked', () => {
  it('识别常见风控信号为命中', () => {
    const hits = ['触发风控，请稍后再试', 'risk control detected', '需要滑块验证', 'captcha required', '操作频繁，请 60 分钟后再试', 'code 10000015 verify', '安全验证未通过']
    for (const m of hits) expect(isRiskBlocked(m)).toBe(true)
  })

  it('普通发布失败判为非命中', () => {
    const misses = ['平台 Cookie 缺失（账号未登录）', '缺少视频文件路径', '网络超时', '']
    for (const m of misses) expect(isRiskBlocked(m)).toBe(false)
  })

  it('非字符串输入安全返回 false', () => {
    expect(isRiskBlocked(null)).toBe(false)
    expect(isRiskBlocked(undefined)).toBe(false)
    expect(isRiskBlocked(601)).toBe(false)
    expect(isRiskBlocked({})).toBe(false)
  })
})
