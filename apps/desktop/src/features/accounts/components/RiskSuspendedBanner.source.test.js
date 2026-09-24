// @vitest-environment node
/**
 * RiskSuspendedBanner 源级契约（与 accounts-grid.source.test.js 同风格）：
 * 锁定消费端接线 —— 从 useRiskStore 取清单、恢复走 store.resume、文案走 i18n key（禁止硬编码中文）。
 */
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(
  path.resolve(__dirname, 'RiskSuspendedBanner.vue'),
  'utf8',
)

describe('RiskSuspendedBanner.vue 契约', () => {
  it('从 useRiskStore 读取权威挂起清单并调用 store.resume', () => {
    expect(src).toMatch(/useRiskStore/)
    expect(src).toMatch(/riskStore\.suspended/)
    expect(src).toMatch(/riskStore\.resume\(/)
  })

  it('展示/反馈文案一律走 publish.riskHold.* i18n key，不硬编码中文', () => {
    expect(src).toMatch(/t\('publish\.riskHold\.suspended'/)
    expect(src).toMatch(/t\('publish\.riskHold\.resume'\)/)
    expect(src).toMatch(/'publish\.riskHold\.resumed'/)
    expect(src).toMatch(/'publish\.riskHold\.resumeFailed'/)
    // 模板/脚本主体不含裸中文字符串字面量（i18n-content-sync）
    const withoutComments = src.split(String.fromCharCode(10)).filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join(String.fromCharCode(10))
    expect(/['"`][^'"`\n]*[\u4e00-\u9fa5][^'"`\n]*['"`]/.test(withoutComments)).toBe(false)
  })

  it('仅在存在挂起项时渲染（v-if items.length）', () => {
    expect(src).toMatch(/v-if="items\.length"/)
  })
})
