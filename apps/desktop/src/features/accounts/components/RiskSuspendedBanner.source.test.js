// @vitest-environment node
/**
 * RiskSuspendedBanner 源级契约（与 accounts-grid.source.test.js 同风格）：
 * 锁定消费端接线 —— 从 useRiskStore 取清单、恢复走 store.resume、文案走 i18n key（禁止硬编码中文）。
 *
 * fix-risk-hold-false-positive（P1-4）追加三个显示项的接线锁：
 *   粒度（scopeAllAccounts）、检测时间（detectedAt）、判定依据（evidenceStrong/Weak），
 *   以及平台级挂起时的标题分流（suspendedAllAccounts）。
 * 这些断言是「显示项存在」的锁；文案真值本身由 locales 的 zh/en 成对与 Gate 7 保证。
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
    expect(src).toMatch(/'publish\.riskHold\.suspended'/)
    expect(src).toMatch(/'publish\.riskHold\.suspendedAllAccounts'/)
    expect(src).toMatch(/t\('publish\.riskHold\.resume'\)/)
    expect(src).toMatch(/'publish\.riskHold\.resumed'/)
    expect(src).toMatch(/'publish\.riskHold\.resumeFailed'/)
    // 模板/脚本主体不含裸中文字符串字面量（i18n-content-sync）
    const withoutComments = src.split(String.fromCharCode(10)).filter((l) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(l)).join(String.fromCharCode(10))
    expect(/['"`][^'"`\n]*[\u4e00-\u9fa5][^'"`\n]*['"`]/.test(withoutComments)).toBe(false)
  })

  it('仅在存在挂起项时渲染（v-if items.length）', () => {
    expect(src).toMatch(/v-if="items\.length"/)
  })

  it('P1-4 粒度显示项：平台级挂起（accountId==null）显示「全平台账号」标签', () => {
    expect(src).toMatch(/v-if="it\.accountId == null"/)
    expect(src).toMatch(/'publish\.riskHold\.scopeAllAccounts'/)
    expect(src).toMatch(/data-testid="risk-suspended-scope-all"/)
  })

  it('P1-4 标题分流：全部为平台级时用 suspendedAllAccounts，否则用 suspended', () => {
    expect(src).toMatch(/allPlatformScope/)
    expect(src).toMatch(/suspendedAllAccounts' : 'publish\.riskHold\.suspended'/)
  })

  it('P1-4 时间显示项：走 detectedAt + formatTime，且非法时间不渲染', () => {
    expect(src).toMatch(/'publish\.riskHold\.detectedAt'/)
    expect(src).toMatch(/v-if="formatTime\(it\.at\)"/)
    expect(src).toMatch(/data-testid="risk-suspended-at"/)
    // 非法/缺失时间必须返回空串（模板据此不渲染），不得抛错或显示 Invalid Date
    expect(src).toMatch(/Number\.isFinite\(n\)/)
    expect(src).toMatch(/Number\.isNaN\(d\.getTime\(\)\)/)
  })

  it('P1-4 判定依据显示项：strong/weak 两档 i18n；无 strength 的老记录不渲染（不猜结论）', () => {
    expect(src).toMatch(/'publish\.riskHold\.evidenceStrong'/)
    expect(src).toMatch(/'publish\.riskHold\.evidenceWeak'/)
    expect(src).toMatch(/if \(!it \|\| !it\.strength\) return ''/)
    expect(src).toMatch(/v-if="evidenceKey\(it\)"/)
    expect(src).toMatch(/data-testid="risk-suspended-evidence"/)
  })

  it('P1-4 平台级提示：scope 标签 title 走 guidanceAllAccounts（而非单账号 guidance）', () => {
    expect(src).toMatch(/'publish\.riskHold\.guidanceAllAccounts'/)
  })
})
