// @vitest-environment node
/**
 * T6.1 结构锁：发布可观测性迁移契约
 *
 * 本测试对四个已迁移子域做静态分析，锁定 notify 契约，防止回归：
 *   - phase4-events.js
 *   - publish-impact-tracker.js
 *   - publish-monitor.js
 *   - risk-suspender-store.js
 *
 * 锁规则：
 *   1. 每个 notify 调用必须是 `module, 'subdomain-event'` 形式（messageKey 含 '-'）；
 *      禁止遗留 `log.warn/info/error/debug('Module', 'bare tag')` 这种裸标签调用。
 *   2. messageKey 必须为 `子域-事件` 命名，且出现在下方允许清单内（按实际迁移结果登记）。
 *   3. 允许清单非空，且规模有下界断言，避免解析退化成空集而假绿。
 */
const fs = require('fs')
const path = require('path')

const SERVICES_DIR = __dirname

const TARGET_FILES = [
  path.join(SERVICES_DIR, '..', 'bootstrap', 'phase4-events.js'),
  path.join(SERVICES_DIR, 'publish-impact-tracker.js'),
  path.join(SERVICES_DIR, 'publish-monitor.js'),
  path.join(SERVICES_DIR, 'risk-suspender-store.js'),
  // 波次-1 新增迁移域
  path.join(SERVICES_DIR, '..', 'bootstrap', 'phase1-context.js'),
  path.join(SERVICES_DIR, '..', 'bootstrap', 'phase2-bridges.js'),
  path.join(SERVICES_DIR, '..', 'bootstrap', 'phase3-services.js'),
  path.join(SERVICES_DIR, '..', 'window.js'),
  // 波次-2 刀-1 新增迁移域
  path.join(SERVICES_DIR, 'url-collector.js'),
  path.join(SERVICES_DIR, 'auth-partition.js'),
  path.join(SERVICES_DIR, 'batch-rate-controller.js'),
  // 波次-2 刀-2 新增迁移域（注入型 sink）
  path.join(SERVICES_DIR, 'ops-center-sync.js'),
  path.join(SERVICES_DIR, 'login-network-diagnostics.js'),
  path.join(SERVICES_DIR, 'auth-partition-reclaim.js'),
  // 断连韧性（ops-center-resilience）：快照模块纳入登记域 —— 它用的是字面量 notify。
  //
  // 刻意**不**纳入 ops-resilience-reporter.js：它把 notify 收敛到 `this._notify(event, params)`
  // 辅助函数里统一加 `OpsResilienceReporter` 前缀，调用点一律是变量事件名。
  // 本门禁按**字面量** `notify('Module','key')` 扫描，硬纳入只会得到
  //「文件应有至少一个 notify 调用」的反退化守卫误报，或者逼人写一个假调用来骗过它 ——
  // 两者都是把「有门禁」变成「有门禁的样子」。真正的缺口是「间接调用的键无人登记」，
  // 那是本文件规则 1/2 的适用范围问题，不该靠把文件塞进清单掩盖。
  path.join(SERVICES_DIR, 'ops-runtime-snapshot.js'),
]

// 实际迁移登记的 (module, event) 清单，按紧凑 key "module:event" 锁。
const ALLOWED_KEYS = new Set([
  // 波次-1 迁移登记：phase1-context.js / phase2-bridges.js / phase3-services.js / window.js
  'UsageReporter:get-client-id-failed',
  'UsageReporter:get-scheduler-metrics-failed',
  'DiagnosticsReporter:hook-error',
  'SignalCollector:startup-cleanup-failed',
  // publish-frequency-unwired-surfaces：日计数启动期裁剪（phase3-services.js，store.init() 之后）。
  // 三条各对一个调用点——本文件末尾断言「登记键总数 === notify 调用总数」，
  // 所以既不能漏登记（红在"未在清单登记"），也不能登记没有调用点的键（红在总数不等）。
  'PublishDailyCount:startup-prune',
  'PublishDailyCount:startup-prune-skipped',
  'PublishDailyCount:startup-prune-failed',
  'PromptMemory:memory-load-failed',
  'App:platform-config-load-failed',
  'App:bridge-start-failed',
  'App:bridge-stop-failed',
  'App:phase3-rollback-failed',
  'App:callback-server-start-failed',
  'App:keyword-monitor-persist-error',
  'App:login-status-monitor-start-failed',
  'App:analytics-providers-register-failed',
  'Identity:identity-service-disabled',
  'BatchManager:scheduled-batches-restore-failed',
  'Automation:automation-scheduler-start-failed',
  'CommentManager:comment-polling-stop-failed',
  'window:open-external-failed',
  'window:failed-window-cleanup-error',
  'window:running-task-check-failed',
  'window:running-publish-check-failed',
  'window:window-ref-cleanup-error',
  'window:autoupdater-init-failed',
  'window:untrusted-navigation-blocked',
  'window:show-event-missing-fallback',
  'App:python-backend-start-failed',
  'App:bridge-started',
  'App:login-status-monitor-started',
  'App:analytics-providers-registered',
  'Scheduler:pending-tasks-restored',
  // 2026-10-06 休眠唤醒守卫接线（phase3-services.js）：resume 后强制重算定时任务。
  // resume-guard.js 内部那 4 个键不在本测试的 TARGET_FILES 扫描域内，故不在此登记；
  // 其 messageKey 同样按「子域-事件」命名，与本清单约定一致。
  'Scheduler:resume-guard-attached',
  'Scheduler:resume-guard-attach-failed',
  'BatchManager:scheduled-batches-restored',
  'App:tasks-recovered-from-queue',
  'window:main-window-shown',
  'window:main-window-load-failed',
  'window:renderer-gone',
  'window:dev-cache-guard-install-result',
  'window:publish-running-hide-to-tray',
  'window:pipeline-running-hide-to-tray',
  // 波次-2 刀-1 迁移登记：url-collector.js / auth-partition.js / batch-rate-controller.js
  'url-collect:collect-blocked-budget',
  'url-collect:collect-blocked-cooldown',
  'url-collect:collect-blocked-circuit',
  'url-collect:collect-blocked-rate',
  'url-collect:collect-cache-hit',
  'url-collect:collect-start-browser',
  'url-collect:collect-start-http',
  'url-collect:collect-ok',
  'url-collect:collect-failed',
  'AuthPartition:no-partition-candidate',
  'AuthPartition:fallback-unusable',
  'AuthPartition:cookies-read',
  'AuthPartition:cookie-read-failed',
  'batch-rate:batch-cancelled',
  'batch-rate:circuit-open-stop',
  'batch-rate:retry-backoff',
  // 波次-2 刀-2 迁移登记：ops-center-sync.js / login-network-diagnostics.js / auth-partition-reclaim.js
  'OpsCenterSync:store-missing-empty-config',
  'OpsCenterSync:get-setting-object-missing',
  'OpsCenterSync:setting-read-failed',
  'OpsCenterSync:last-synced-at-persist-failed',
  'OpsCenterSync:catalog-synced',
  'OpsCenterSync:runtime-apply-error',
  'OpsCenterSync:runtime-sync-skipped',
  'OpsCenterSync:runtime-policy-persist-failed',
  'OpsCenterSync:update-policy-consumer-error',
  'OpsCenterSync:platform-defs-applied',
  'OpsCenterSync:platform-defs-apply-error',
  'OpsCenterSync:content-templates-applied',
  'OpsCenterSync:content-templates-apply-error',
  'OpsCenterSync:keyword-watchlist-applied',
  'OpsCenterSync:keyword-watchlist-apply-error',
  'OpsCenterSync:rewrite-strategies-applied',
  'OpsCenterSync:rewrite-strategies-apply-error',
  'OpsCenterSync:hard-constraints-applied',
  'OpsCenterSync:rewrite-cache-invalidated-hard-constraints',
  'OpsCenterSync:hard-constraints-apply-error',
  'OpsCenterSync:ai-taste-map-applied',
  'OpsCenterSync:rewrite-cache-invalidated',
  'OpsCenterSync:ai-taste-map-apply-error',
  'OpsCenterSync:runtime-applied',
  'OpsCenterSync:runtime-updated-callback-error',
  'OpsCenterSync:auto-sync-skipped',
  'OpsCenterSync:auto-sync-error',
  'OpsCenterSync:auto-sync-init-error',
  'LoginNetDiag:request-failed',
  'LoginNetDiag:qr-response',
  'LoginNetDiag:http-status-warning',
  'LoginNetDiag:http-status-info',
  'LoginNetDiag:proxy-resolved',
  'LoginNetDiag:resolve-proxy-failed',
  'LoginNetDiag:resolve-proxy-failed-outer',
  'LoginNoise:noise-cancelled',
  'LoginRespDiag:key-endpoint-request-failed',
  'LoginRespDiag:qr-bytes',
  'LoginRespDiag:key-endpoint-rejected',
  'LoginRespDiag:diag-self-error',
  'AuthReclaim:partition-readdir-failed',
  'AuthReclaim:delete-outside-root-refused',
  'AuthReclaim:partition-remove-failed',
  'AuthReclaim:reclaim-scanned',
  'AuthReclaim:reclaim-threw',
  'AuthReclaim:session-wipe-skipped',
  'AuthReclaim:session-wipe-failed',
  'AuthReclaim:session-wipe-skipped-fallback',
  'AuthReclaim:kept-as-publish-fallback',
  'AuthReclaim:cookie-probe-failed-kept',
  'AuthReclaim:no-partition-to-reclaim',
  // phase4-events.js
  'PublishMonitor:audit-requery-cookie-resolution-failed',
  'PublishMonitor:audit-requery-skipped',
  'PublishMonitor:monitor-result',
  'PublishMonitor:audit-status-inconclusive',
  'PublishMonitor:audit-update-skipped',
  'PublishMonitor:audit-update-failed',
  'PublishMonitor:audit-requery-gating-failed',
  'PublishMonitor:monitor-start-failed',
  'ImpactTracker:impact-tracking-started',
  'ImpactTracker:impact-tracking-start-failed',
  'PerformanceLoop:register-tracked-content-failed',
  'PerformanceLoop:tracked-content-unlinked',
  'PerformanceLoop:tracked-content-backfill-skipped',
  'FailureDraftSaver:auto-draft-save-rejected',
  'FailureDraftSaver:auto-draft-save-failed',
  // 2026-10-15「再次发布」快照旁路（bootstrap/phase4-events.js）：快照落库失败绝不影响
  // 发布结果，但「这条记录为什么不能再次发布」必须能从日志回答，故两个失败出口都出声。
  'RepublishSnapshot:snapshot-skipped',
  'RepublishSnapshot:snapshot-save-failed',
  'RiskSuspender:suspend-failed',
  // fix-risk-hold-false-positive：弱信号「不挂起」这个决定本身必须可观测，
  // 否则事后无法回答「为什么这次没暂停」。新增 notify 必须同步登记本清单（本文件断言
  // 全仓登记键总数 === 四文件 notify 调用总数，漏登记会以「未在清单登记」直接红）。
  'RiskSuspender:weak-signal-not-suspended',
  // publish-impact-tracker.js
  'ImpactTracker:schedule-missing-article-id',
  'ImpactTracker:schedule-no-keywords',
  'ImpactTracker:schedule-ok',
  'ImpactTracker:snapshot-capture-start',
  'ImpactTracker:snapshot-saved',
  'ImpactTracker:snapshot-error',
  'ImpactTracker:get-active-error',
  'ImpactTracker:get-recent-snapshots-error',
  // publish-monitor.js
  'PublishMonitor:check-url-missing',
  'PublishMonitor:monitor-timeout',
  'PublishMonitor:poll-progress',
  'PublishMonitor:poll-error',
  // risk-suspender-store.js
  'RiskSuspender:persist-failed',
  'RiskSuspender:hydrate-read-failed',
  // 断连韧性（ops-center-resilience）：三层降级水合 + L2 快照落盘
  'OpsCenterSync:runtime-hydrated-from-snapshot',
  'OpsCenterSync:runtime-hydrated-from-seed',
  'OpsCenterSync:runtime-hydrated-fallback',
  'OpsCenterSync:runtime-snapshot-skipped',
  'OpsCenterSync:runtime-report-error',
  'OpsRuntimeSnapshot:snapshot-read-failed',
  'OpsRuntimeSnapshot:snapshot-persist-failed',
  'OpsRuntimeSnapshot:seed-rejected',
  'OpsRuntimeSnapshot:seed-parse-failed',
])

// 解析单个文件中的 notify 调用：log.notify('Module', 'subdomain-event', {...})
// 波次-2：扩展支持 this._log.notify（注入型 sink，batch-rate-controller/url-collector 先例）
const NOTIFY_RE = /(?:^|[^.\w])(?:this\.)?(?:_log|log)\s*\.\s*notify\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g
// 遗留裸标签调用（迁移前形态）：log.{warn,info,error,debug}('Module', 'tag')
const LEGACY_RE = /(?:^|[^.\w])(?:this\.)?(?:_log|log)\s*\.\s*(?:warn|info|error|debug)\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g

function readSource (file) {
  const abs = path.resolve(file)
  if (!fs.existsSync(abs)) throw new Error('lock target missing: ' + abs)
  return fs.readFileSync(abs, 'utf8')
}

describe('T6.1 发布可观测性 notify 契约结构锁', () => {
  for (const file of TARGET_FILES) {
    const rel = path.relative(SERVICES_DIR, file).replace(/\\/g, '/')
    describe(rel, () => {
      const src = readSource(file)

      it('禁止遗留裸标签日志调用（log.warn/info/error/debug 后接模块+标签）', () => {
        const legacy = []
        let m
        LEGACY_RE.lastIndex = 0
        while ((m = LEGACY_RE.exec(src))) legacy.push(`${m[1]} / ${m[2]}`)
        expect(legacy, `发现遗留裸标签调用: ${legacy.join('; ')}`).toEqual([])
      })

      it('所有 notify 的 messageKey 均含 "-" 且命中允许清单', () => {
        const found = []
        let m
        NOTIFY_RE.lastIndex = 0
        while ((m = NOTIFY_RE.exec(src))) {
          const [/* full */, module, key] = m
          found.push([module, key])
          expect(key, `messageKey 必须含 '-': ${module} / ${key}`).toContain('-')
          const compact = `${module}:${key}`
          expect(ALLOWED_KEYS.has(compact), `不在允许清单: ${compact}`).toBe(true)
        }
        // 每个文件至少要有 notify 调用，避免解析退化假绿
        expect(found.length, '该文件应有至少一个 notify 调用').toBeGreaterThan(0)
      })
    })
  }

  it('允许清单规模有下界（防止 Set 退化成空集而假绿）', () => {
    expect(ALLOWED_KEYS.size).toBeGreaterThanOrEqual(126)
  })

  it('全仓登记键总数与四文件 notify 调用总数一致', () => {
    let total = 0
    for (const file of TARGET_FILES) {
      const src = readSource(file)
      let m
      NOTIFY_RE.lastIndex = 0
      while ((m = NOTIFY_RE.exec(src))) {
        const compact = `${m[1]}:${m[2]}`
        expect(ALLOWED_KEYS.has(compact), `未在清单登记: ${compact}`).toBe(true)
        total++
      }
    }
    expect(total).toBe(ALLOWED_KEYS.size)
  })
})
