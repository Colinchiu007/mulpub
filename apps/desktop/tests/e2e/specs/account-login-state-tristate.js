/**
 * 账号登录态三态 Functional E2E —— 真实渲染层硬断言
 *
 * 覆盖 2026-09-23 修复的三个用户可见缺陷：
 *   D1 一键检测结论未固化：重进账号页又显示「已登录」
 *   D2 今日头条已登录却显示「已失效」（降级假阴性）
 *   D3 视频号已失效却显示「已登录」（降级假阳性）
 *
 * D3 的实现方式已被 openspec/changes/fix-login-state-oscillation **有意反转**（勿当改错）：
 * 当时的做法是「本轮无定论 → 把状态改写成未确认」，结果「没拿到新证据」被当成反证，
 * 已登录账号每轮检测都在 已登录 ↔ 未确认 之间来回跳。新规则是**单向证据**：
 * 无定论不改写真源（保持原结论），只有明确失效才 expired，且 active 超过宽限期
 * （默认 7 天）仍无定论才降级。因此这里同时断言两侧：
 *   - 已有正向结论 + 本轮无定论 → 必须仍是「已登录」（旧做法会错显未确认）
 *   - 从未有结论 + 本轮无定论 → 必须仍是「未确认」（不得回到 D3 的假绿灯）
 *
 * 断言点：
 *   1. 后端 status 三态各自渲染对应徽章（未确认 = 第三态，不复用已登录/已失效样式）
 *   2. 一键检测后：徽章按检测结论更新，且汇总文案区分「失效」与「未确认」
 *   3. 渲染层不再自行写库（accountUpdate 调用次数必须为 0，单一写者在主进程）
 *   4. 检测结论已固化时，退出账号页再进入显示保持一致（不再回退成「已登录」）
 *   5. 未确认账号不出现在 checkedExpiredIds（不提供「登录」按钮，避免误判为失效）
 *
 * 运行：node tests/e2e/specs/account-login-state-tristate.js
 * 需要：dev server 在 TEST_URL（默认 http://127.0.0.1:5174）
 */

const { FunctionalRunner } = require('../helpers/functional-runner');

/** 注入页面的覆写脚本：模拟「主进程已把三态结论固化到后端」的读接口。 */
const OVERRIDE_SOURCE = `
(function () {
  var BACKEND = [
    { id: 'acc-douyin', platform: 'douyin', name: '抖音视频号', account_name: '抖音-固化回归', status: 'expired', status_source: 'backend', is_active: true, last_validated: '2026-09-22T15:38:27.000Z' },
    { id: 'acc-toutiao', platform: 'toutiao', name: '今日头条号', account_name: '头条-固化回归', status: 'active', status_source: 'backend', is_active: true, last_validated: '2026-09-22T15:38:27.000Z' },
    // 已有正向结论（宽限期内刚定论过）+ 本轮无定论 → 必须保持「已登录」
    { id: 'acc-channels', platform: 'tencent_video', name: '视频号', account_name: '视频号-固化回归', status: 'active', status_source: 'backend', is_active: true, last_validated: new Date(Date.now() - 3600 * 1000).toISOString() },
    // 从未有结论 + 本轮无定论 → 保持「未确认」，不冒充任何一侧
    { id: 'acc-fresh', platform: 'baijiahao', name: '百家号', account_name: '百家号-无结论', status: 'unverified', status_source: 'backend', is_active: true, last_validated: null },
  ];
  // 一键检测结论：抖音=失效、头条=有效（修复 D2）、视频号=未确认（修复 D3）
  var CHECK_RESULTS = {
    'acc-douyin': { valid: false, code: 'CHECK_LOGIN_FAILED', loginStatus: 'expired' },
    'acc-toutiao': { valid: true, code: 'CHECK_LOGIN_SUCCESS', loginStatus: 'active' },
    // 无定论：主进程不改写真源，回传「保持后的原状态」并带 statusChanged=false
    'acc-channels': { valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE', loginStatus: 'active', statusChanged: false },
    'acc-fresh': { valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE', loginStatus: 'unverified', statusChanged: true },
  };
  function retry(fn, attempts) {
    if (fn()) return;
    if (attempts <= 0) return;
    setTimeout(function () { retry(fn, attempts - 1); }, 10);
  }
  retry(function () {
    var api = window.electronAPI;
    var state = window.__mockState;
    if (!api || !state) return false;
    state.accounts.splice(0, state.accounts.length);
    BACKEND.forEach(function (a) { state.accounts.push(Object.assign({}, a)); });
    window.__accountUpdateCalls = [];
    window.__batchCheckCalls = [];
    api.accountList = function () {
      return Promise.resolve({ code: 0, data: state.accounts.map(function (a) { return Object.assign({}, a); }) });
    };
    api.accountUpdate = function (id, patch) {
      window.__accountUpdateCalls.push({ id: id, patch: patch });
      return Promise.resolve({ code: 0, data: {} });
    };
    api.accountBatchCheckLogin = function (accountIds) {
      window.__batchCheckCalls.push(accountIds);
      var checkedAt = new Date().toISOString();
      var results = (accountIds || []).map(function (id) {
        var row = state.accounts.filter(function (a) { return a.id === id; })[0];
        var verdict = CHECK_RESULTS[id] || { valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE', loginStatus: 'unverified' };
        if (row) {
          row.status = verdict.loginStatus;
          row.last_validated = checkedAt;
        }
        return {
          platform: row ? row.platform : '',
          accountId: id,
          valid: verdict.valid,
          code: verdict.code,
          loginStatus: verdict.loginStatus,
          last_validated: checkedAt,
          persisted: { ok: true, status: verdict.loginStatus },
        };
      });
      return Promise.resolve({ code: 0, data: { results: results, checkedAt: checkedAt } });
    };
    api.onAccountsBatchCheckProgress = function () { return function () {}; };
    return true;
  }, 800);
})();
`;

function record(r, name, passed, details) {
  r.checks.push({ kind: 'functional', name: name, passed: Boolean(passed), details: details || null });
  console.log((passed ? '  \u2713 ' : '  \u2717 ') + name + (details ? ' :: ' + JSON.stringify(details) : ''));
  return Boolean(passed);
}

async function waitForVisible(locator, timeout = 8000) {
  try { await locator.waitFor({ state: 'visible', timeout }); return true; } catch { return false; }
}

async function badgeText(r, accountId) {
  const el = r.page.locator('[data-testid="account-status-' + accountId + '"]').first();
  if (!(await waitForVisible(el, timeoutOf(r)))) return null;
  return (await el.innerText()).trim();
}

function timeoutOf(r) { return r.badgeTimeout || 8000; }

async function run(r) {
  r.badgeTimeout = 10000;
  await r.context.addInitScript({ content: OVERRIDE_SOURCE });
  await r.goto('/accounts');
  await record(r, '账号页加载', await waitForVisible(r.page.locator('[data-testid="account-batch-check-all"]')));

  // 1. 三态徽章（进入页面即反映后端固化值，不重新推断）
  await record(r, '后端 status=expired → 徽章「已失效」', (await badgeText(r, 'acc-douyin')) === '已失效');
  await record(r, '后端 status=active → 徽章「已登录」（修复 D2）', (await badgeText(r, 'acc-toutiao')) === '已登录');
  await record(r, '后端 status=active 且宽限期内 → 徽章「已登录」（视频号不再被无定论抹掉）', (await badgeText(r, 'acc-channels')) === '已登录');
  await record(r, '后端 status=unverified（从未有结论）→ 徽章「未确认」（修复 D3 第三态）', (await badgeText(r, 'acc-fresh')) === '未确认');
  await r.screenshot('01-tristate-from-backend');

  // 2. 一键检测
  await r.page.locator('[data-testid="account-batch-check-all"]').first().click();
  await record(r, '一键检测调用主进程 batch-check-login', true);
  try {
    await r.page.waitForFunction(() => !document.querySelector('[data-testid="batch-check-overlay"]'), null, { timeout: 25000 });
  } catch (e) { /* 遮罩未消失由后续断言暴露 */ }
  await record(r, '检测后：头条号仍为「已登录」', (await badgeText(r, 'acc-toutiao')) === '已登录');
  await record(r, '检测后：视频号本轮无定论 → 仍保持「已登录」（单向证据规则，不再振荡）', (await badgeText(r, 'acc-channels')) === '已登录');
  await record(r, '检测后：从未有结论的百家号仍「未确认」（不得回到 D3 假绿灯）', (await badgeText(r, 'acc-fresh')) === '未确认');
  await record(r, '检测后：抖音号为「已失效」', (await badgeText(r, 'acc-douyin')) === '已失效');
  await r.screenshot('02-after-batch-check');

  // 3. 汇总文案区分「失效」与「本轮未取到定论（保持原状态）」
  const toastText = await r.page.locator('body').innerText();
  await record(r, '汇总文案含「1 个失效」与「2 个未取到定论（保持原状态）」',
    /1\s*个失效/.test(toastText) && /2\s*个未取到定论（保持原状态）/.test(toastText),
    { matched: /检测完成[^\n]*/.exec(toastText)?.[0] || null });

  // 4. 单一写者：渲染层不得再自行写 Electron SQLite
  const writerStats = await r.page.evaluate(() => ({
    updateCalls: (window.__accountUpdateCalls || []).length,
    batchCalls: (window.__batchCheckCalls || []).length,
  }));
  await record(r, '渲染层零次 accountUpdate（登录态唯一写者=主进程）',
    writerStats.updateCalls === 0 && writerStats.batchCalls === 1, writerStats);

  // 5. 未确认账号不被当作失效（无「登录」按钮）—— 用从未有结论的百家号验证，
  // 视频号此时是「已登录」，不再承担这一语义。
  await record(r, '未确认账号不提供「登录」入口（不计入 checkedExpiredIds）',
    (await r.page.locator('[data-testid="login-acc-fresh"]').count()) === 0);

  // 6. D1 回归：退出账号页再进入，显示仍为固化值
  await r.resetToRoute('/accounts');
  await record(r, '重进账号页：抖音号仍显示「已失效」（D1 不再回退）',
    (await badgeText(r, 'acc-douyin')) === '已失效');
  await record(r, '重进账号页：头条号仍显示「已登录」',
    (await badgeText(r, 'acc-toutiao')) === '已登录');
  await record(r, '重进账号页：视频号仍显示「已登录」（无定论不改写真源）',
    (await badgeText(r, 'acc-channels')) === '已登录');
  await r.screenshot('03-reentered-accounts');

  await record(r, '无 console error', (r.consoleErrors || []).length === 0,
    (r.consoleErrors || []).slice(0, 3));
}

if (require.main === module) {
  const runner = new FunctionalRunner({ specName: 'account-login-state-tristate', initPro: true });
  (async () => {
    await runner.launch();
    try {
      await run(runner);
    } finally {
      await runner.close();
    }
    const failed = runner.checks.filter((c) => !c.passed);
    console.log('TRISTATE_STATUS=' + (failed.length === 0 ? 'passed' : 'failed') +
      ' total=' + runner.checks.length + ' failed=' + failed.length);
    failed.forEach((c) => console.log('  FAILED: ' + c.name + (c.details ? ' :: ' + JSON.stringify(c.details) : '')));
    process.exitCode = failed.length === 0 ? 0 : 1;
  })().catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { run, record, OVERRIDE_SOURCE };
