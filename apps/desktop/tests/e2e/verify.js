/**
 * 验证 IPC mock 是否正确注入并工作
 */
const { FunctionalRunner } = require('./helpers/functional-runner');

(async () => {
  const r = new FunctionalRunner({ specName: 'phase0-verify' });
  await r.launch();
  await r.goto('/');
  await r.expectText('社媒管家');
  await r.expectVisible('nav');
  await r.expectNoConsoleError(['vite', 'HMR']);

  const calls = await r.getIpcCalls();
  console.log('IPC calls count:', calls.length);
  const methodCounts = await r.getIpcCalls(null);
  console.log('Method counts:', JSON.stringify(r.getIpcCalls ? r.getIpcCalls.length : 'na'));
  // 验证关键 IPC 被调用
  for (const m of ['licenseInfo', 'accountList', 'getVersion', 'dashboardStats']) {
    const count = await r.getIpcCalls(m);
    console.log('  ' + m + ': ' + count);
  }

  const report = r.generateReport();
  console.log('\n=== REPORT ===');
  console.log(JSON.stringify(report, null, 2));

  await r.close();
  process.exit(report.consoleErrors.length === 0 && report.pageErrors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FAIL:', e.message);
  console.error(e.stack);
  process.exit(1);
});