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
]

// 实际迁移登记的 (module, event) 清单，按紧凑 key "module:event" 锁。
const ALLOWED_KEYS = new Set([
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
  'FailureDraftSaver:auto-draft-save-rejected',
  'FailureDraftSaver:auto-draft-save-failed',
  'RiskSuspender:suspend-failed',
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
])

// 解析单个文件中的 notify 调用：log.notify('Module', 'subdomain-event', {...})
const NOTIFY_RE = /(?:^|[^.\w])log\s*\.\s*notify\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g
// 遗留裸标签调用（迁移前形态）：log.{warn,info,error,debug}('Module', 'tag')
const LEGACY_RE = /(?:^|[^.\w])log\s*\.\s*(?:warn|info|error|debug)\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g

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
    expect(ALLOWED_KEYS.size).toBeGreaterThanOrEqual(26)
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
