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
// Windows runner 临时网络缓冲耗尽时，文档导航与子资源请求都可能出现该错误码。
const TRANSIENT_NETWORK_ERROR = 'net::ERR_NO_BUFFER_SPACE';
const MAX_NAVIGATION_ATTEMPTS = 2;
const MAX_APP_READY_RELOADS = 2;
// 严格就绪判据超时后，回退到旧宽松判据的重试预算（只在超时情形触发，不吞其他错误）。
const ROUTE_OUTLET_FALLBACK_TIMEOUT = 3000;

// 「等待就绪超时」的两种来源：Playwright 自己的等待超时，以及本 runner 在预算被
// 前序步骤耗尽时抛出的错误。两者都必须能被重载路径识别，否则该路径永远不触发。
function isAppReadyTimeout(error) {
  const message = String((error && error.message) || error || '');
  return /Timeout \d+ms exceeded|waiting for function|TimeoutError|等待应用就绪超时/i.test(message);
}

function isTransientNavigationError(error) {
  return String(error?.message || error).includes(TRANSIENT_NETWORK_ERROR);
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
    // 本次导航期内失败的子资源（用于识别瞬时网络故障，不作为失败判据）
    this.resourceFailures = [];
    // 已从 consoleErrors 移出留痕的瞬时噪音（发生过，但已随重载恢复）
    this.recoveredTransientErrors = [];
    // navigate() 前的 resourceFailures 长度：证据只算本次导航新产生的
    this.resourceFailureMark = 0;
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
    this.attachPageObservers(this.page);

    // 确保输出目录存在
    [this.reportsDir, this.screenshotDir, path.join(this.screenshotDir, this.specName)].forEach((d) => {
      fs.mkdirSync(d, { recursive: true });
    });
  }

  /**
   * 绑定页面级观测事件。单独成方法是为了能在不启动真实浏览器的前提下测试挂载：
   * requestfailed 是「文档导航自己没抛错、但子资源被打断」的唯一信号，
   * 缺它就只能把应用永不挂载当成硬故障。
   */
  attachPageObservers(page) {
    // 收集 console error / pageerror
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // 过滤已知的 vite hmr 噪音
        if (text.includes('[vite]')) return;
        if (text.includes('HMR')) return;
        this.consoleErrors.push({ text: text.slice(0, 500), at: Date.now() });
      }
    });
    page.on('pageerror', (err) => {
      this.pageErrors.push({ message: err.message.slice(0, 500), at: Date.now() });
    });
    page.on('requestfailed', (request) => {
      this.resourceFailures.push({
        url: String(request.url && typeof request.url === 'function' ? request.url() : '').slice(0, 300),
        errorText: String((request.failure() || {}).errorText || ''),
        at: Date.now(),
      });
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
    // 光标必须在 goto 之前落位：本次导航期间的资源失败才算证据，上一次导航残留的不算。
    this.resourceFailureMark = this.resourceFailures.length;
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
          reason: TRANSIENT_NETWORK_ERROR,
          at: Date.now(),
        });
        await waitForNavigationRetry();
      }
    }
  }

  /**
   * 等待 Vue 完成挂载并切换到目标路由（含瞬时故障重载）。
   *
   * 「文档导航成功、子资源（模块 chunk / CSS）被瞬时网络故障打断」时 page.goto 不抛错，
   * 应用壳子永远挂不起来 —— #2423 的导航重试覆盖不到这条路。此处只在
   * 「超时 + 本次导航期内确有该错误码的资源失败」时给有限次重载；
   * 无瞬时证据 / 非超时错误 / 预算耗尽一律原样抛出，避免把真实挂载故障藏进重试。
   */
  async waitForAppReady(route, timeout = DEFAULT_APP_READY_TIMEOUT) {
    for (let reload = 0; reload <= MAX_APP_READY_RELOADS; reload += 1) {
      try {
        await this._waitForReadyOnce(route, timeout);
        return;
      } catch (error) {
        const transient = this.resourceFailures
          .slice(this.resourceFailureMark)
          .filter((failure) => failure.errorText.includes(TRANSIENT_NETWORK_ERROR));
        if (!isAppReadyTimeout(error) || transient.length === 0 || reload === MAX_APP_READY_RELOADS) {
          throw error;
        }
        this.actions.push({
          kind: 'appReadyReload',
          attempt: reload + 1,
          reason: TRANSIENT_NETWORK_ERROR,
          failedResources: transient.slice(0, 5).map((failure) => failure.url),
          at: Date.now(),
        });
        this._discardTransientConsoleNoise();
        await waitForNavigationRetry();
        // 恢复动作必须是会**重新拉取子资源**的原语。实测（Edge + 本机 vite）：对完全相同的
        // URL 再 page.goto 一次属于 same-document 导航 —— window 状态存活、JS 子资源 0 次重请求，
        // 于是"重载"只是白烧 2×15s 后再抛同一个超时；只有 page.reload() 会重新取 chunk。
        this.resourceFailureMark = this.resourceFailures.length;
        try {
          await this.page.reload({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });
        } catch (reloadError) {
          // 文档导航本身又被同一个瞬时码打断：这本身就是一条瞬时观测，记进同一份证据账 ——
          // 否则下一轮会因"没有新证据"而放弃剩余预算，而故障条件明明还在。
          if (!isTransientNavigationError(reloadError)) throw reloadError;
          this.resourceFailures.push({
            url: 'page.reload',
            errorText: TRANSIENT_NETWORK_ERROR,
            at: Date.now(),
          });
        }
      }
    }
  }

  /** 单次就绪等待（不含重载）。 */
  async _waitForReadyOnce(route, timeout) {
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
      if (!isAppReadyTimeout(error)) throw error;
      await this.page.waitForFunction((hash) => {
        const app = document.querySelector('#app');
        return window.location.hash === hash &&
          app &&
          app.hasAttribute('data-v-app') &&
          (app.textContent || '').trim().length > 0;
      }, expectedHash, { timeout: ROUTE_OUTLET_FALLBACK_TIMEOUT });
    }
  }

  /**
   * 重载会丢弃本次尝试的页面状态，因此属于瞬时网络故障的 console 噪音不再作为
   * 失败判据 —— 但它必须留在 recoveredTransientErrors 里进产物（发生过什么可查），
   * 不得伪造成「没发生过」。非瞬时的 console 错误一律留在清单，重载成功也照样红。
   */
  _discardTransientConsoleNoise() {
    const kept = [];
    for (const entry of this.consoleErrors) {
      if (entry.text.includes(TRANSIENT_NETWORK_ERROR)) this.recoveredTransientErrors.push(entry);
      else kept.push(entry);
    }
    this.consoleErrors = kept;
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
      transientRecoveries: this.actions.filter((action) => action.kind === 'appReadyReload'),
      recoveredConsoleErrors: this.recoveredTransientErrors,
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
