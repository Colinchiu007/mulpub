/**
 * Functional E2E Runner
 *
 * 提供 per-spec 测试运行基类，封装：
 *   - 浏览器启动
 *   - IPC mock 注入
 *   - 路由导航 + 等待
 *   - 按钮点击 / 表单填写 / 链接跳转
 *   - 模态弹出 / 关闭
 *   - console error 捕获
 *   - 截图保存
 *   - 测试报告生成
 *
 * 使用：
 *   const { FunctionalRunner } = require('./functional-runner');
 *   const r = new FunctionalRunner({ specName: 'home', viewport: { width: 1920, height: 1080 } });
 *   await r.launch();
 *   await r.goto('/');
 *   await r.expectText('社媒管家');
 *   await r.expectNoConsoleError();
 *   await r.close();
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { buildInitScript } = require('./fixture-loader');

const DEFAULT_APP_READY_TIMEOUT = 15000;
const RESET_APP_READY_TIMEOUT = 15000;
const NAVIGATION_TIMEOUT = 20000;
const NAVIGATION_RETRY_DELAY_MS = 100;
const TRANSIENT_NAVIGATION_ERROR = 'net::ERR_NO_BUFFER_SPACE';
const MAX_NAVIGATION_ATTEMPTS = 2;
// 严格就绪判据超时后，回退到旧宽松判据的重试预算（只在超时情形触发，不吞其他错误）。
const ROUTE_OUTLET_FALLBACK_TIMEOUT = 3000;

function isPlaywrightTimeout(error) {
  const message = String((error && error.message) || error || '');
  return /Timeout \d+ms exceeded|waiting for function|TimeoutError/i.test(message);
}

function isTransientNavigationError(error) {
  return String(error?.message || error).includes(TRANSIENT_NAVIGATION_ERROR);
}

function waitForNavigationRetry() {
  return new Promise((resolve) => setTimeout(resolve, NAVIGATION_RETRY_DELAY_MS));
}

class FunctionalRunner {
  constructor(options = {}) {
    this.specName = options.specName || 'unnamed';
    this.url = options.url || process.env.TEST_URL || 'http://127.0.0.1:5174';
    this.headless = options.headless !== false;
    this.viewport = options.viewport || { width: 1920, height: 1080 };
    this.reportsDir = options.reportsDir || path.join(__dirname, '..', 'reports');
    this.screenshotDir = options.screenshotDir || path.join(this.reportsDir, 'screenshots');
    this.initPro = options.initPro === true;
    this.initOffline = options.initOffline === true;

    this.browser = null;
    this.context = null;
    this.page = null;
    this.consoleErrors = [];
    this.pageErrors = [];
    this.actions = [];
    this.checks = [];
    this.resetSequence = 0;
  }

  async launch() {
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.context = await this.browser.newContext({
      viewport: this.viewport,
      // 设为中文，避免 locale 差异导致的断言失败
      locale: 'zh-CN'
    });

    // 注入 IPC mock + fixtures（每个页面加载前都注入）
    await this.context.addInitScript({
      content: buildInitScript()
    });
    // 允许在 mock 初始化后再调整 Pro / offline 默认状态
    await this.context.addInitScript({
      content:
        'window.__proDefault = ' + (this.initPro ? 'true' : 'false') + ';\n' +
        'window.__offlineDefault = ' + (this.initOffline ? 'true' : 'false') + ';\n' +
        'if (window.__proDefault && window.__mockState) window.__mockState.licensed.isPro = true;\n' +
        'if (window.__offlineDefault && window.__mockState) window.__mockState.offline = true;'
    });

    // 功能 E2E 不依赖远程字体；屏蔽外网字体请求，避免 reset 时重复网络等待和资源耗尽。
    await this.context.route(/https:\/\/(?:api\.fontshare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, async (route) => {
      await route.fulfill({ status: 204, body: '' });
    });

    this.page = await this.context.newPage();

    // 收集 console error / pageerror
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // 过滤已知的 vite hmr 噪音
        if (text.includes('[vite]')) return;
        if (text.includes('HMR')) return;
        this.consoleErrors.push({ text: text.slice(0, 500), at: Date.now() });
      }
    });
    this.page.on('pageerror', (err) => {
      this.pageErrors.push({ message: err.message.slice(0, 500), at: Date.now() });
    });

    // 确保输出目录存在
    [this.reportsDir, this.screenshotDir, path.join(this.screenshotDir, this.specName)].forEach((d) => {
      fs.mkdirSync(d, { recursive: true });
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  /** 导航到指定路由（hash 模式） */
  async goto(route, options = {}) {
    const expectedRoute = options.expectedRoute || route;
    const url = this.url + '/#' + route;
    await this.navigate(url);
    await this.waitForAppReady(expectedRoute);
    this.actions.push({ kind: 'goto', route, expectedRoute, at: Date.now() });
  }

  /** 完整刷新当前路由，隔离前一个交互留下的弹窗和响应式状态 */
  async resetToRoute(route, options = {}) {
    const expectedRoute = options.expectedRoute || route;
    const resetUrl = `${this.url}/?__e2e_reset=${++this.resetSequence}#${route}`;
    await this.navigate(resetUrl);
    const readyTimeout = options.readyTimeout ?? RESET_APP_READY_TIMEOUT;
    await this.waitForAppReady(expectedRoute, readyTimeout);
    this.actions.push({ kind: 'resetToRoute', route, expectedRoute, readyTimeout, at: Date.now() });
  }

  /**
   * Windows runner 偶发耗尽临时网络缓冲时，给同一导航一次短暂恢复机会。
   * 其他错误和第二次失败必须原样抛出，避免隐藏真实路由或应用启动故障。
   */
  async navigate(url) {
    for (let attempt = 1; attempt <= MAX_NAVIGATION_ATTEMPTS; attempt += 1) {
      try {
        return await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });
      } catch (error) {
        if (!isTransientNavigationError(error) || attempt === MAX_NAVIGATION_ATTEMPTS) {
          throw error;
        }
        this.actions.push({
          kind: 'navigationRetry',
          attempt,
          reason: TRANSIENT_NAVIGATION_ERROR,
          at: Date.now(),
        });
        await waitForNavigationRetry();
      }
    }
  }

  /** 等待 Vue 完成挂载并切换到目标路由 */
  async waitForAppReady(route, timeout = DEFAULT_APP_READY_TIMEOUT) {
    const expectedHash = '#' + route;
    const deadline = Date.now() + timeout;
    const remainingTimeout = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`等待应用就绪超时（${timeout}ms）：${route}`);
      }
      return remaining;
    };

    await this.page.waitForURL((currentUrl) => currentUrl.hash === expectedHash, { timeout: remainingTimeout() });
    await this.page.locator('#app').waitFor({ state: 'visible', timeout: remainingTimeout() });
    // 就绪判据：必须等「路由内容出口」渲染出文字。旧判据用 `#app.textContent` 非空表示就绪，
    // 但 #app 常驻侧边栏（主页/发布/账号…），该条件恒为真 —— 等于没等懒加载路由 chunk 挂载
    // （Vite 按需编译）。后果是导航后第一条断言只剩 CONDITION_TIMEOUT 去等 chunk，CI 满载时
    // 随机超时；而它烧掉的时间又让紧随的断言恰好赶上加载完成，表现为「标题红、紧随的卡片绿」
    // 且落点路由不固定。出口见 App.vue：data-testid="mp-workspace" / "fullscreen-view"。
    const strictReady = (hash) => {
      const app = document.querySelector('#app');
      if (!(window.location.hash === hash && app && app.hasAttribute('data-v-app'))) return false;
      const outlet = app.querySelector('[data-testid="mp-workspace"], [data-testid="fullscreen-view"]');
      return !!outlet && (outlet.textContent || '').trim().length > 0;
    };
    try {
      await this.page.waitForFunction(strictReady, expectedHash, { timeout: remainingTimeout() });
    } catch (error) {
      // 兜底：极少数路由可能不往出口渲染文字（如 isLoginTab 分支）。判据收紧不该把原本的
      // 间歇误红变成确定性硬失败，故退回旧的宽松判据再给一次短预算。
      if (!isPlaywrightTimeout(error)) throw error;
      await this.page.waitForFunction((hash) => {
        const app = document.querySelector('#app');
        return window.location.hash === hash &&
          app &&
          app.hasAttribute('data-v-app') &&
          (app.textContent || '').trim().length > 0;
      }, expectedHash, { timeout: ROUTE_OUTLET_FALLBACK_TIMEOUT });
    }
  }

  /** 等待指定选择器出现 */
  async waitFor(selector, timeout = 5000) {
    try {
      await this.page.waitForSelector(selector, { timeout });
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 等待文字出现 */
  async waitForText(text, timeout = 5000) {
    try {
      await this.page.locator(`text=${text}`).first().waitFor({ timeout });
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 通用检查：断言文字出现 */
  async expectText(text, opts = {}) {
    const visible = await this.waitForText(text, opts.timeout || 3000);
    this.checks.push({ kind: 'expectText', text, passed: visible });
    return visible;
  }

  /** 通用检查：断言选择器存在 */
  async expectVisible(selector, opts = {}) {
    const visible = await this.waitFor(selector, opts.timeout || 3000);
    this.checks.push({ kind: 'expectVisible', selector, passed: visible });
    return visible;
  }

  /** 通用检查：断言无 console error */
  async expectNoConsoleError(allowed = []) {
    const blocked = this.consoleErrors.filter(function (e) {
      return !allowed.some(function (a) { return e.text.includes(a); });
    });
    const passed = blocked.length === 0;
    this.checks.push({
      kind: 'expectNoConsoleError',
      passed,
      errors: blocked.map(function (e) { return e.text; })
    });
    return passed;
  }

  /** 通用检查：断言无 page error */
  async expectNoPageError() {
    const passed = this.pageErrors.length === 0;
    this.checks.push({
      kind: 'expectNoPageError',
      passed,
      errors: this.pageErrors.map(function (e) { return e.message; })
    });
    return passed;
  }

  /** 列出页面所有按钮 */
  async listButtons() {
    return await this.page.$$eval('button', function (els) {
      return els.map(function (el, i) {
        return {
          index: i,
          text: (el.textContent || '').trim().slice(0, 50),
          visible: el.offsetParent !== null,
          disabled: el.disabled,
          ariaLabel: el.getAttribute('aria-label'),
          testid: el.getAttribute('data-testid')
        };
      });
    });
  }

  /** 列出页面所有输入字段 */
  async listInputs() {
    return await this.page.$$eval('input, textarea, select', function (els) {
      return els.map(function (el, i) {
        return {
          index: i,
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          placeholder: el.placeholder || '',
          name: el.name || '',
          visible: el.offsetParent !== null,
          testid: el.getAttribute('data-testid')
        };
      });
    });
  }

  /** 列出页面所有链接 */
  async listLinks() {
    return await this.page.$$eval('a', function (els) {
      return els.map(function (el, i) {
        return {
          index: i,
          text: (el.textContent || '').trim().slice(0, 50),
          href: el.getAttribute('href'),
          visible: el.offsetParent !== null
        };
      });
    });
  }

  /** 点击按钮（按索引或文字） */
  async clickButton(by, value) {
    if (by === 'text') {
      await this.page.locator(`button:has-text("${value}")`).first().click({ timeout: 3000 });
    } else if (by === 'index') {
      const handles = await this.page.$$('button');
      if (value >= handles.length) throw new Error(`button index ${value} out of range`);
      await handles[value].click();
    } else if (by === 'selector') {
      await this.page.click(value);
    } else {
      throw new Error('clickButton: by must be text|index|selector');
    }
    this.actions.push({ kind: 'clickButton', by, value, at: Date.now() });
  }

  /** 点击链接 */
  async clickLink(href) {
    const link = this.page.locator(`a[href="${href}"]`).first();
    await link.waitFor({ state: 'visible', timeout: 3000 });
    const target = await link.getAttribute('target');
    const shouldNavigateCurrentPage = target !== '_blank' &&
      !href.startsWith('javascript:') &&
      !href.startsWith('mailto:');

    if (shouldNavigateCurrentPage) {
      const expectedUrl = new URL(href, this.page.url()).href;
      await Promise.all([
        this.page.waitForURL(expectedUrl, { timeout: 5000 }),
        link.click(),
      ]);
    } else {
      await link.click();
    }
    this.actions.push({ kind: 'clickLink', href, at: Date.now() });
  }

  /** 点击 router-link */
  async clickRouterLink(path) {
    const expectedHash = '#' + path;
    const link = this.page.locator(`a[href="#${path}"], a[href="/#${path}"]`).first();
    await Promise.all([
      this.page.waitForURL((currentUrl) => currentUrl.hash === expectedHash, { timeout: 5000 }),
      link.click(),
    ]);
    await this.waitForAppReady(path);
    this.actions.push({ kind: 'clickRouterLink', path, at: Date.now() });
  }

  /** 填写表单字段 */
  async fillInput(selector, value) {
    await this.page.fill(selector, value);
    await this.page.waitForFunction(({ inputSelector, expectedValue }) => {
      const input = document.querySelector(inputSelector);
      return input && input.value === expectedValue;
    }, { inputSelector: selector, expectedValue: String(value) }, { timeout: 3000 });
    this.actions.push({ kind: 'fill', selector, value: String(value).slice(0, 50), at: Date.now() });
  }

  /** 截图 */
  async screenshot(name) {
    const filename = path.join(this.screenshotDir, this.specName, name + '.png');
    await this.page.screenshot({ path: filename, fullPage: true });
    this.actions.push({ kind: 'screenshot', filename, at: Date.now() });
    return filename;
  }

  /** 检查模态是否打开（按选择器） */
  async expectModalOpen(selector) {
    const visible = await this.page.isVisible(selector);
    this.checks.push({ kind: 'expectModalOpen', selector, passed: visible });
    return visible;
  }

  /** 关闭模态（按 ESC 或点击遮罩） */
  async closeModal(method) {
    if (method === 'escape') {
      await this.page.keyboard.press('Escape');
    } else if (method === 'overlay') {
      await this.page.locator('.el-overlay, .ui-modal-overlay, [data-modal-overlay]').first().click({ timeout: 3000 });
    } else if (method === 'close-btn') {
      await this.page.locator('[data-modal-close], .el-dialog__close, .ui-modal-close').first().click({ timeout: 3000 });
    }
    await this.page.waitForFunction((selector) => {
      return Array.from(document.querySelectorAll(selector)).every((element) => {
        const style = window.getComputedStyle(element);
        return style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0' ||
          element.getClientRects().length === 0;
      });
    }, '[role="dialog"], .el-dialog, .ui-modal, [data-modal], .el-overlay, .ui-modal-overlay, [data-modal-overlay]', { timeout: 3000 });
  }

  /** 获取当前路由 */
  async currentRoute() {
    return await this.page.evaluate(() => window.location.hash.replace(/^#/, ''));
  }

  /** 触发 IPC mock 失败 */
  async failNextIpc(method, message) {
    await this.page.evaluate(
      ([m, msg]) => window.__failNext(m, msg),
      [method, message]
    );
  }

  /** 读取 IPC 调用历史 */
  async getIpcCalls(method) {
    return await this.page.evaluate((m) => {
      if (m) return window.__ipcCallsByMethod[m] || 0;
      return window.__ipcCalls.slice();
    }, method);
  }

  /** 读取 mock 状态 */
  async getMockState() {
    return await this.page.evaluate(() => window.__mockState);
  }

  /** 生成报告 */
  generateReport() {
    const passed = this.checks.filter((c) => c.passed).length;
    const failed = this.checks.length - passed;
    return {
      specName: this.specName,
      url: this.url,
      timestamp: new Date().toISOString(),
      actions: this.actions.length,
      checks: { total: this.checks.length, passed, failed },
      consoleErrors: this.consoleErrors,
      pageErrors: this.pageErrors,
      details: this.checks
    };
  }

  /** 保存报告到 JSON */
  saveReport(report) {
    const reportToSave = report || this.generateReport();
    const filename = path.join(this.reportsDir, this.specName + '.json');
    fs.writeFileSync(filename, JSON.stringify(reportToSave, null, 2));
    return filename;
  }
}

/**
 * 简单的断言工具
 */
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

module.exports = { FunctionalRunner, assert };
