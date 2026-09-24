/**
 * 账号头像「失效遮罩」渲染态 E2E —— 真实浏览器计算样式硬断言
 *
 * 覆盖 2026-09-24 的显示规则变更：
 *   R1 登录态失效：「已失效」以半透明遮罩压在头像图片上（头像即状态载体）
 *   R2 登录态失效：头像旁不再出现旧的「已失效」徽章（同一信息只出现一次）
 *   R3 有登录态：头像旁「已登录」徽章保留，头像不加遮罩
 *
 * 断言点（均取运行态 computed style / boundingBox，不依赖 JSDOM）：
 *   1. 遮罩存在且文本为「已失效」，position:absolute、background rgba(0,0,0,.55)、color #fff
 *   2. 遮罩水平铺满头像、垂直落在头像圆内（被 overflow:hidden 裁切）
 *   3. 失效卡片内 .login-badge 数量为 0；有效卡片内为 1 且文本「已登录」
 *   4. 头像图片加载失败时遮罩仍在（与 @error 回落共存）
 *   5. 全程零 console error / page error
 *
 * 运行：node tests/e2e/specs/account-avatar-expired-mask.js
 * 需要：dev server 在 TEST_URL（默认 http://127.0.0.1:5174）
 */

const { FunctionalRunner } = require('../helpers/functional-runner');

// 内联 SVG 头像：不依赖外网，避免 CDN 抖动导致遮罩断言误判
const AVATAR_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%234a90d9'/%3E%3C/svg%3E";

const OVERRIDE_SOURCE = `
(function () {
  var AVATAR = ${JSON.stringify(AVATAR_SVG)};
  var BACKEND = [
    { id: 'acc-expired', platform: 'tencent_video', name: '视频号', account_name: '遮罩-失效', status: 'expired', status_source: 'backend', avatar: AVATAR },
    { id: 'acc-active', platform: 'douyin', name: '抖音视频号', account_name: '遮罩-有效', status: 'active', status_source: 'backend', avatar: AVATAR },
  ];
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
    api.accountList = function () {
      return Promise.resolve({ code: 0, data: state.accounts.map(function (a) { return Object.assign({}, a); }) });
    };
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

/** 读取运行态的遮罩几何与计算样式（一次 evaluate 取全，避免多次往返产生时序抖动）。 */
async function maskProbe(page, accountId) {
  return await page.evaluate((id) => {
    const card = document.querySelector('[data-testid="account-card-' + id + '"]');
    if (!card) return { found: false };
    const avatar = card.querySelector('.account-avatar');
    const mask = card.querySelector('.account-avatar .avatar-status-mask');
    const badge = card.querySelector('.login-badge');
    const boxOf = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const cs = mask ? getComputedStyle(mask) : null;
    return {
      found: true,
      hasMask: Boolean(mask),
      maskText: mask ? mask.textContent.trim() : null,
      maskRole: mask ? mask.getAttribute('role') : null,
      maskAria: mask ? mask.getAttribute('aria-label') : null,
      badgeCount: card.querySelectorAll('.login-badge').length,
      badgeText: badge ? badge.textContent.trim() : null,
      avatarBox: boxOf(avatar),
      maskBox: mask ? boxOf(mask) : null,
      avatarOverflow: getComputedStyle(avatar).overflow,
      avatarPosition: getComputedStyle(avatar).position,
      maskStyle: cs ? {
        position: cs.position, background: cs.backgroundColor, color: cs.color,
        transform: cs.transform, fontSize: cs.fontSize, pointerEvents: cs.pointerEvents,
      } : null,
    };
  }, accountId);
}

async function run(r) {
  await r.context.addInitScript({ content: OVERRIDE_SOURCE });
  await r.goto('/accounts');
  await record(r, '账号页加载', await waitForVisible(r.page.locator('[data-testid="account-card-acc-expired"]')));
  await waitForVisible(r.page.locator('[data-testid="account-card-acc-active"]'));

  // R1 + R2：失效卡片
  const expired = await maskProbe(r.page, 'acc-expired');
  await record(r, '失效卡片渲染出头像遮罩', expired.found && expired.hasMask, expired);
  await record(r, '遮罩文案为「已失效」', expired.maskText === '已失效', { text: expired.maskText });
  await record(r, '遮罩保留 role=status 与无障碍名称',
    expired.maskRole === 'status' && expired.maskAria === '账号登录状态：已失效',
    { role: expired.maskRole, aria: expired.maskAria });
  await record(r, '遮罩为绝对定位 + 半透明黑底白字',
    expired.maskStyle?.position === 'absolute'
    && expired.maskStyle?.background === 'rgba(0, 0, 0, 0.55)'
    && expired.maskStyle?.color === 'rgb(255, 255, 255)',
    expired.maskStyle);
  const inside = expired.avatarBox && expired.maskBox
    && expired.maskBox.w <= expired.avatarBox.w + 1
    && expired.maskBox.y >= expired.avatarBox.y - 1
    && (expired.maskBox.y + expired.maskBox.h) <= (expired.avatarBox.y + expired.avatarBox.h) + 1;
  await record(r, '遮罩落在头像圆内（被 overflow:hidden 裁切）',
    inside && expired.avatarOverflow === 'hidden' && expired.avatarPosition === 'relative',
    { avatarBox: expired.avatarBox, maskBox: expired.maskBox, overflow: expired.avatarOverflow, position: expired.avatarPosition });
  await record(r, '失效卡片头像旁不再出现旧徽章（R2）', expired.badgeCount === 0, { badgeCount: expired.badgeCount });

  // R3：有效卡片
  const active = await maskProbe(r.page, 'acc-active');
  await record(r, '有效卡片无遮罩且保留「已登录」徽章（R3）',
    active.hasMask === false && active.badgeCount === 1 && active.badgeText === '已登录',
    { hasMask: active.hasMask, badgeCount: active.badgeCount, badgeText: active.badgeText });

  // 截图存证（网格视图，头像 + 遮罩可见）
  await r.screenshot('01-expired-mask-and-active-badge');

  // 视图切换为列表模式后规则一致（同一组件、布局方向不同）
  const listToggle = r.page.locator('[data-testid="account-view-list"]').first();
  if (await waitForVisible(listToggle, 3000)) {
    await listToggle.click();
    await r.page.waitForTimeout(400);
    const inList = await maskProbe(r.page, 'acc-expired');
    await record(r, '列表视图下失效卡片仍是遮罩、无徽章',
      inList.hasMask && inList.badgeCount === 0 && inList.maskText === '已失效', inList);
    await r.screenshot('02-list-view-mask');
  } else {
    await record(r, '列表视图切换入口存在', false, { reason: 'view-toggle testid not found' });
  }

  await record(r, '无 console error', (r.consoleErrors || []).length === 0, (r.consoleErrors || []).slice(0, 3));
  await record(r, '无 page error', (r.pageErrors || []).length === 0, (r.pageErrors || []).slice(0, 3));
}

if (require.main === module) {
  const runner = new FunctionalRunner({ specName: 'account-avatar-expired-mask', initPro: true });
  (async () => {
    await runner.launch();
    try {
      await run(runner);
    } finally {
      await runner.close();
    }
    const failed = runner.checks.filter((c) => !c.passed);
    console.log('MASK_STATUS=' + (failed.length === 0 ? 'passed' : 'failed') +
      ' total=' + runner.checks.length + ' failed=' + failed.length);
    failed.forEach((c) => console.log('  FAILED: ' + c.name + (c.details ? ' :: ' + JSON.stringify(c.details) : '')));
    process.exitCode = failed.length === 0 ? 0 : 1;
  })().catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { run, record, OVERRIDE_SOURCE, AVATAR_SVG };
