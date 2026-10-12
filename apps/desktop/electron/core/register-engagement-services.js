// @ts-check
/**
 * 效果闭环三个服务的容器注册（从 container.setup.js 抽出）
 *
 * 抽出理由：`core/container.setup.js` 是已逼近 500 行门禁阈值的文件
 * （`.github/scripts/check-max-lines.js`，limit=500、`lines >= limit` 即阻断）。
 * 本次新增账号级采集服务时把它顶成 `NEW_OVER_LIMIT`，遂把这一组同域装配整体外移 ——
 * 三个服务同属「发布 → 追踪 → 回采 → 互动数据」这条链，放在一起比散在 setup 里更好读。
 *
 * 依赖口径：
 *   - 账号列表 / 凭证：`publishers/account-manager`（listAccounts 走 Python 后端 /api/accounts）
 *   - 发布历史：JSONL 真源（services/publish-history），归因的二级判据需要 title + 时间
 *   - HTTP：account-metrics/http（最小传输层，失败返回状态码而不抛错）
 *   - 签名：account-metrics/signer-bridge（fail-closed，取不到签名器就报 unsupported）
 *   - 归属解析器：**不在这里注入** —— identityService 挂在 bootstrap 的 servicesResult 上，
 *     容器装配期拿不到。由 bootstrap 在启动调度器前调 `setResolveOwner(...)`；
 *     未注入时调度轮按 legacy 档处理（与全仓 `resolveIpcOwnerSubject` 的三态口径一致）。
 *
 * @param {{register: Function, get: Function}} container
 */
function registerEngagementServices (container) {
  container.register('performanceRecrawlService', function (c) {
    const { PerformanceRecrawlService } = require('../services/performance-recrawl-service')
    return new PerformanceRecrawlService({ store: c.get('store') })
  })
  container.register('patternAttributionService', function (c) {
    const { PatternAttributionService } = require('../services/pattern-attribution-service')
    return new PatternAttributionService({ store: c.get('store') })
  })
  container.register('accountMetricsService', function (c) {
    const { AccountMetricsService } = require('../services/account-metrics')
    const { httpRequest } = require('../services/account-metrics/http')
    const { createSignerBridge } = require('../services/account-metrics/signer-bridge')
    const accountManager = require('../publishers/account-manager')
    const publishHistory = require('../services/publish-history')
    return new AccountMetricsService({
      store: c.get('store'),
      listAccounts: function () { return accountManager.listAccounts() },
      loadCredential: function (accountId, platform) {
        return accountManager.loadSavedCredentials(accountId, platform)
      },
      listPublishRecords: function (ownerSubject) {
        return publishHistory.listRecords({ limit: 500 }, ownerSubject).records
      },
      httpRequest: httpRequest,
      signer: createSignerBridge(),
    })
  })
}

module.exports = { registerEngagementServices }
