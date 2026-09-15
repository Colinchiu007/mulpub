/**
 * 最终报告生成器（Phase 4 交付期）
 *
 * 汇总：
 *   1. 18 个路由的 functional 测试结果
 *   2. 6 条跨视图集成流结果
 *   3. 输出 functional-final-report.json + 控制台摘要
 *
 * 使用：
 *   node tests/e2e/helpers/final-report.js
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const OUTPUT_JSON = path.join(REPORTS_DIR, 'functional-final-report.json');
const OUTPUT_MD = path.join(REPORTS_DIR, 'functional-final-report.md');

// 18 个路由清单（spec 名 → 路由路径）
const ROUTE_LIST = [
  { spec: 'home', route: '/', title: '首页 / 仪表盘入口' },
  { spec: 'comments', route: '/comments', title: '评论管理' },
  { spec: 'first-run', route: '/first-run', title: '首次运行 / 配置向导' },
  { spec: 'publish', route: '/publish', title: '一键发布' },
  { spec: 'accounts', route: '/accounts', title: '账号管理' },
  { spec: 'dashboard', route: '/dashboard', title: '数据看板' },
  { spec: 'collection', route: '/collection', title: '内容采集' },
  { spec: 'keywords', route: '/keywords', title: '关键词监控' },
  { spec: 'viral-analysis', route: '/viral-analysis', title: '爆款分析' },
  { spec: 'model-providers', route: '/model-providers', title: '模型服务商' },
  { spec: 'create', route: '/create', title: 'AI 创作' },
  { spec: 'result', route: '/create/result', title: '创作结果' },
  { spec: 'pipeline', route: '/create/pipeline', title: '创作流水线' },
  { spec: 'create-history', route: '/create/history', title: '创作历史' },
  { spec: 'cloud-publish', route: '/cloud-publish', title: '云端发布' },
  { spec: 'intelligence', route: '/intelligence', title: '智能助手' },
  { spec: 'calendar', route: '/calendar', title: '排期日历' }
];

const FLOW_LIST = [
  { key: 'flow-1', name: '创建 → 发布 → 看板', spec: 'integration.flow-1' },
  { key: 'flow-2', name: '账号管理 → 侧栏 → 发布', spec: 'integration.flow-2' },
  { key: 'flow-3', name: '模型服务商 → AI 写作', spec: 'integration.flow-3' },
  { key: 'flow-4', name: '监控 → 评论回复', spec: 'integration.flow-4' },
  { key: 'flow-5', name: '设置变更级联', spec: 'integration.flow-5' },
  { key: 'flow-6', name: '错误路径', spec: 'integration.flow-6' }
];

function loadJson(filename, reportsDir = REPORTS_DIR) {
  const filepath = path.join(reportsDir, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function hasRuntimeResults(options) {
  return Object.prototype.hasOwnProperty.call(options || {}, 'results');
}

function resolveReport(options, key, filename) {
  if (hasRuntimeResults(options)) {
    const results = options.results || {};
    return Object.prototype.hasOwnProperty.call(results, key) ? results[key] : null;
  }
  return loadJson(filename, options.reportsDir || REPORTS_DIR);
}

function aggregateRouteCoverage(options = {}) {
  const matrix = [];
  let totalChecks = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalConsoleErrors = 0;
  let totalPageErrors = 0;

  for (const r of ROUTE_LIST) {
    const report = resolveReport(options, r.spec, `${r.spec}.functional.json`);
    if (!report) {
      matrix.push({
        spec: r.spec,
        route: r.route,
        title: r.title,
        status: 'MISSING',
        checks: { total: 0, passed: 0, failed: 0 },
        consoleErrors: 0,
        pageErrors: 0,
        kinds: {}
      });
      continue;
    }
    const checks = report.checks || { total: 0, passed: 0, failed: 0 };
    const consoleErrors = (report.consoleErrors || []).length;
    const pageErrors = (report.pageErrors || []).length;
    const kinds = {};
    for (const c of report.details || []) {
      const k = c.kind || 'unknown';
      if (!kinds[k]) kinds[k] = { total: 0, passed: 0 };
      kinds[k].total += 1;
      if (c.passed) kinds[k].passed += 1;
    }
    totalChecks += checks.total;
    totalPassed += checks.passed;
    totalFailed += checks.failed;
    totalConsoleErrors += consoleErrors;
    totalPageErrors += pageErrors;
    matrix.push({
      spec: r.spec,
      route: r.route,
      title: r.title,
      status: checks.failed === 0 && consoleErrors === 0 && pageErrors === 0 ? '✅ PASS' : '❌ FAIL',
      checks,
      consoleErrors,
      pageErrors,
      kinds
    });
  }

  return {
    matrix,
    totals: {
      totalChecks,
      totalPassed,
      totalFailed,
      totalConsoleErrors,
      totalPageErrors,
      coveredRoutes: matrix.filter((m) => m.status !== 'MISSING').length,
      totalRoutes: ROUTE_LIST.length
    }
  };
}

function aggregateFlowCoverage(options = {}) {
  const flows = [];
  let totalChecks = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalConsoleErrors = 0;
  let totalPageErrors = 0;

  for (const f of FLOW_LIST) {
    const report = resolveReport(options, f.key, `${f.spec}.json`);
    if (!report) {
      flows.push({
        key: f.key,
        name: f.name,
        status: 'MISSING',
        checks: { total: 0, passed: 0, failed: 0 },
        consoleErrors: 0,
        pageErrors: 0
      });
      continue;
    }
    const checks = report.checks || { total: 0, passed: 0, failed: 0 };
    const consoleErrors = (report.consoleErrors || []).length;
    const pageErrors = (report.pageErrors || []).length;
    totalChecks += checks.total;
    totalPassed += checks.passed;
    totalFailed += checks.failed;
    totalConsoleErrors += consoleErrors;
    totalPageErrors += pageErrors;
    flows.push({
      key: f.key,
      name: f.name,
      status: checks.failed === 0 && consoleErrors === 0 && pageErrors === 0 ? '✅ PASS' : '❌ FAIL',
      checks,
      consoleErrors,
      pageErrors
    });
  }

  return {
    flows,
    totals: {
      totalChecks,
      totalPassed,
      totalFailed,
      totalConsoleErrors,
      totalPageErrors
    }
  };
}

function classifySeverity(failures) {
  // 没失败 = 没有 severity item
  if (!failures || failures.length === 0) return [];
  return failures.map((f) => ({
    category: 'CRITICAL',
    location: f.spec,
    issue: f.issue || 'check failed',
    recommendation: f.recommendation || '复跑相关测试、确认 UI 选择器稳定'
  }));
}

function buildIssues(routes, flows) {
  const issues = [];
  for (const r of routes.matrix) {
    if (r.status === 'MISSING') {
      issues.push({
        severity: 'CRITICAL',
        category: '路由覆盖缺失',
        spec: r.spec,
        issue: `路由 ${r.route} (${r.title}) 没有 functional 测试报告`,
        recommendation: '运行 node tests/e2e/helpers/route-functional-suite.js ' + r.spec
      });
    } else if (r.status !== '✅ PASS') {
      issues.push({
        severity: 'CRITICAL',
        category: '路由检查失败',
        spec: r.spec,
        issue: `${r.title} (${r.route}) failed=${r.checks.failed} consoleErrors=${r.consoleErrors}`,
        recommendation: '查看 reports/' + r.spec + '.functional.json 并修复'
      });
    }
  }
  for (const f of flows.flows) {
    if (f.status === 'MISSING') {
      issues.push({
        severity: 'CRITICAL',
        category: '集成流缺失',
        spec: f.key,
        issue: `Flow ${f.name} 没有报告`,
        recommendation: '运行 node tests/e2e/helpers/integration-flows.js ' + f.key
      });
    } else if (f.status !== '✅ PASS') {
      issues.push({
        severity: 'MAJOR',
        category: '集成流失败',
        spec: f.key,
        issue: `${f.name} failed=${f.checks.failed} consoleErrors=${f.consoleErrors} pageErrors=${f.pageErrors}`,
        recommendation: '查看 reports/integration.' + f.key + '.json'
      });
    }
  }
  return issues;
}

function buildCanvasSummary(report) {
  // 简化 canvas 文本摘要（用户在 canvas 中可粘贴）
  const lines = [];
  lines.push('# Multi-Publish 前端功能 E2E 测试报告');
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push(`- 路由覆盖: ${report.routes.totals.coveredRoutes}/${report.routes.totals.totalRoutes} (${Math.round((report.routes.totals.coveredRoutes / report.routes.totals.totalRoutes) * 100)}%)`);
  lines.push(`- 路由检查: ${report.routes.totals.totalPassed}/${report.routes.totals.totalChecks} 通过 (${report.routes.totals.totalFailed} 失败)`);
  lines.push(`- 路由 console errors: ${report.routes.totals.totalConsoleErrors}`);
  lines.push(`- 路由 page errors: ${report.routes.totals.totalPageErrors}`);
  lines.push(`- 集成流: ${report.flows.flows.filter((f) => f.status === '✅ PASS').length}/${report.flows.flows.length} 通过`);
  lines.push(`- 集成检查: ${report.flows.totals.totalPassed}/${report.flows.totals.totalChecks} 通过`);
  lines.push(`- 集成流 console errors: ${report.flows.totals.totalConsoleErrors}`);
  lines.push(`- 集成流 page errors: ${report.flows.totals.totalPageErrors}`);
  lines.push(`- **总计: ${report.totals.totalPassed}/${report.totals.totalChecks} checks 通过, ${report.totals.totalConsoleErrors + report.totals.totalPageErrors} errors**`);
  lines.push('');
  lines.push('## 路由覆盖矩阵');
  lines.push('');
  lines.push('| 路由 | 路径 | 检查 | 通过 | 失败 | Console | 状态 |');
  lines.push('|------|------|------|------|------|---------|------|');
  for (const r of report.routes.matrix) {
    lines.push(`| ${r.title} | \`${r.route}\` | ${r.checks.total} | ${r.checks.passed} | ${r.checks.failed} | ${r.consoleErrors} | ${r.status} |`);
  }
  lines.push('');
  lines.push('## 集成流');
  lines.push('');
  lines.push('| Flow | 名称 | 检查 | 通过 | 失败 | 状态 |');
  lines.push('|------|------|------|------|------|------|');
  for (const f of report.flows.flows) {
    lines.push(`| ${f.key} | ${f.name} | ${f.checks.total} | ${f.checks.passed} | ${f.checks.failed} | ${f.status} |`);
  }
  if (report.issues.length > 0) {
    lines.push('');
    lines.push('## Issue 列表');
    lines.push('');
    for (const i of report.issues) {
      lines.push(`- **${i.severity}** [${i.category}] ${i.spec}: ${i.issue}`);
      lines.push(`  - 修复建议: ${i.recommendation}`);
    }
  }
  return lines.join('\n');
}

function createReport(options = {}) {
  const routes = aggregateRouteCoverage(options);
  const flows = aggregateFlowCoverage(options);
  const issues = buildIssues(routes, flows);
  const totalChecks = routes.totals.totalChecks + flows.totals.totalChecks;
  const totalPassed = routes.totals.totalPassed + flows.totals.totalPassed;
  const totalFailed = routes.totals.totalFailed + flows.totals.totalFailed;
  const totalConsoleErrors = routes.totals.totalConsoleErrors + flows.totals.totalConsoleErrors;
  const totalPageErrors = routes.totals.totalPageErrors + flows.totals.totalPageErrors;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      vite: options.vite || process.env.TEST_URL || 'http://127.0.0.1:5174',
      spec: '前端全量功能 E2E 测试 (task-29a)',
      version: '1.0.0',
      phase: 'Phase 0-4 全部完成'
    },
    summary: {
      totalChecks,
      totalPassed,
      totalFailed,
      totalConsoleErrors,
      totalPageErrors,
      passRate: totalChecks > 0 ? Math.round((totalPassed / totalChecks) * 10000) / 100 : 0,
      coverageRate: Math.round((routes.totals.coveredRoutes / routes.totals.totalRoutes) * 10000) / 100
    },
    routes,
    flows,
    issues,
    totals: {
      totalChecks,
      totalPassed,
      totalFailed,
      totalConsoleErrors,
      totalPageErrors
    }
  };
}

function writeReport(report, options = {}) {
  const reportsDir = options.reportsDir || REPORTS_DIR;
  const outputJson = options.outputJson || path.join(reportsDir, 'functional-final-report.json');
  const outputMd = options.outputMd || path.join(reportsDir, 'functional-final-report.md');
  fs.mkdirSync(reportsDir, { recursive: true });

  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));
  const md = buildCanvasSummary(report);
  fs.writeFileSync(outputMd, md);
  console.log(md);
  console.log(`\n报告已生成：\n  - ${outputJson}\n  - ${outputMd}`);
  return report;
}

function main(options = {}) {
  return writeReport(createReport(options), options);
}

if (require.main === module) {
  main();
}

module.exports = { main, createReport, writeReport, aggregateRouteCoverage, aggregateFlowCoverage };
