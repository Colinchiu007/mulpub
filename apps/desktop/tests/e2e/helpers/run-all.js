/**
 * 前端功能 E2E 测试统一入口
 *
 * 用法：
 *   node tests/e2e/helpers/run-all.js              # 跑全部 18 路由 + 6 集成流，生成最终报告
 *   node tests/e2e/helpers/run-all.js routes        # 仅跑路由
 *   node tests/e2e/helpers/run-all.js flows         # 仅跑集成流
 *   node tests/e2e/helpers/run-all.js report        # 仅重新生成最终报告
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const ROUTES_JSON = path.join(REPORTS_DIR, 'routes-list.json');

const ROUTE_ORDER = [
  'home', 'comments', 'first-run', 'publish', 'accounts', 'dashboard',
  'collection', 'keywords', 'viral-analysis', 'model-providers',
  'create', 'result', 'pipeline', 'create-history', 'cloud-publish',
  'intelligence', 'calendar'
];

const FLOW_ORDER = ['flow-1', 'flow-2', 'flow-3', 'flow-4', 'flow-5', 'flow-6'];

const VALID_MODES = new Set(['all', 'routes', 'flows', 'report']);

function parseConcurrency(value = process.env.E2E_CONCURRENCY) {
  const rawValue = value == null ? '1' : String(value).trim();
  const concurrency = Number(rawValue);
  if (rawValue === '' || !Number.isFinite(concurrency) || !Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`E2E_CONCURRENCY 必须是正整数，收到: ${String(value)}`);
  }
  return concurrency;
}

function validateMode(mode) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`未知 E2E 模式: ${mode}`);
  }
  return mode;
}

function expectedResultCount(mode) {
  validateMode(mode);
  if (mode === 'routes') return ROUTE_ORDER.length;
  if (mode === 'flows') return FLOW_ORDER.length;
  if (mode === 'all') return ROUTE_ORDER.length + FLOW_ORDER.length;
  return 0;
}

async function runWithConcurrency(items, worker) {
  const limit = parseConcurrency();
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
}

function hasFailures(results, expectedCount) {
  const reports = Object.values(results || {});
  if (Number.isInteger(expectedCount) && reports.length !== expectedCount) return true;
  if (reports.length === 0) return expectedCount !== 0;
  return reports.some((report) => {
    return !report || !report.checks ||
      report.checks.failed > 0 ||
      (report.consoleErrors && report.consoleErrors.length > 0) ||
      (report.pageErrors && report.pageErrors.length > 0) ||
      report.error;
  });
}

async function runRoutes() {
  const { runRouteSpec } = require('./route-functional-suite');
  const results = {};
  await runWithConcurrency(ROUTE_ORDER, async (name) => {
    try {
      const report = await runRouteSpec(name);
      results[name] = report;
      const marker = report.checks.failed === 0 ? '✓' : '✗';
      console.log(`  ${marker} ${name}: ${report.checks.passed}/${report.checks.total}`);
      if (report.checks.failed > 0 || (report.consoleErrors && report.consoleErrors.length > 0) || (report.pageErrors && report.pageErrors.length > 0)) {
        logRouteFailure(name, report);
      }
    } catch (error) {
      console.error(`  ✗ ${name}: ${error.message}`);
      results[name] = { checks: { total: 0, passed: 0, failed: 1 }, error: error.message };
    }
  });
  return results;
}

async function runFlows() {
  const { runFlow } = require('./integration-flows');
  const results = {};
  await runWithConcurrency(FLOW_ORDER, async (key) => {
    try {
      const report = await runFlow(key);
      results[key] = report;
      const marker = report.checks.failed === 0 ? '✓' : '✗';
      console.log(`  ${marker} ${key}: ${report.checks.passed}/${report.checks.total}`);
      if (report.checks.failed > 0 || (report.consoleErrors && report.consoleErrors.length > 0) || (report.pageErrors && report.pageErrors.length > 0)) {
        logRouteFailure(key, report);
      }
    } catch (error) {
      console.error(`  ✗ ${key}: ${error.message}`);
      results[key] = { checks: { total: 0, passed: 0, failed: 1 }, error: error.message };
    }
  });
  return results;
}

/**
 * 路由/流失败时打印详细失败信息（check 名称 + console error + page error），
 * 让 CI 日志可直接定位失败项，而不是只有 passed/total 数量。
 */
function logRouteFailure(name, report) {
  if (!report) return;
  const failedChecks = (report.details || []).filter((c) => !c.passed);
  if (failedChecks.length > 0) {
    console.log(`    ── ${name} 失败检查点 (${failedChecks.length}) ──`);
    for (const c of failedChecks) {
      console.log(`      ✗ ${c.name}${c.details ? ' | ' + JSON.stringify(c.details) : ''}`);
    }
  }
  if (report.consoleErrors && report.consoleErrors.length > 0) {
    console.log(`    ── ${name} console errors (${report.consoleErrors.length}) ──`);
    const seen = new Set();
    for (const e of report.consoleErrors) {
      if (seen.has(e.text)) continue;
      seen.add(e.text);
      console.log(`      [console] ${e.text}`);
    }
  }
  if (report.pageErrors && report.pageErrors.length > 0) {
    console.log(`    ── ${name} page errors (${report.pageErrors.length}) ──`);
    for (const e of report.pageErrors) {
      console.log(`      [page] ${e.message}`);
    }
  }
  if (report.error) {
    console.log(`      [error] ${report.error}`);
  }
}

function buildReport(results) {
  const { main } = require('./final-report');
  return results === undefined ? main() : main({ results });
}

async function main(mode = process.argv[2] || 'all') {
  const arg = validateMode(mode);
  console.log(`\n🚀 前端功能 E2E 测试统一入口 — mode=${arg}\n`);
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const results = {};
  if (arg === 'all' || arg === 'routes') {
    console.log('=== 阶段 A: 18 路由 functional 测试 ===');
    Object.assign(results, await runRoutes());
    console.log('');
  }
  if (arg === 'all' || arg === 'flows') {
    console.log('=== 阶段 B: 6 集成流测试 ===');
    Object.assign(results, await runFlows());
    console.log('');
  }
  if (arg === 'all' || arg === 'report') {
    console.log('=== 阶段 C: 生成最终报告 ===');
    buildReport(arg === 'all' ? results : undefined);
    console.log('');
  }
  const failed = hasFailures(results, expectedResultCount(arg));
  console.log(failed ? '❌ E2E 门禁失败' : '✅ 全部完成');
  return { results, failed };
}

if (require.main === module) {
  main().then(({ failed }) => {
    process.exitCode = failed ? 1 : 0;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  runRoutes,
  runFlows,
  buildReport,
  hasFailures,
  runWithConcurrency,
  parseConcurrency,
  validateMode,
  expectedResultCount
};
