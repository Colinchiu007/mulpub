/**
 * 视觉测试运行器
 * 使用方式：
 *   const runner = new TestRunner({ headless: true });
 *   await runner.launch();
 *   await runner.testAllViews();
 *   await runner.close();
 */

// 加载 .env 配置
try { require('dotenv').config({ path: __dirname + '/.env' }); } catch (_) {}

const { chromium } = require('playwright');
const { OCRProvider } = require('./providers/ocr');
const { PixelDiffProvider } = require('./providers/pixel-diff');
const fs = require('fs');
const path = require('path');
const { buildInitScript } = require('../e2e/helpers/fixture-loader');

const DEFAULT_READY_TIMEOUT = 15000;
const MIN_READY_TIMEOUT = 1000;
const MAX_READY_TIMEOUT = 30000;

function resolveReadyTimeout(explicitTimeout) {
  const configuredTimeout = explicitTimeout ?? process.env.VISUAL_READY_TIMEOUT;
  const timeout = Number(configuredTimeout);
  if (!Number.isSafeInteger(timeout) || timeout < MIN_READY_TIMEOUT || timeout > MAX_READY_TIMEOUT) {
    return DEFAULT_READY_TIMEOUT;
  }
  return timeout;
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || /timeout .* exceeded/i.test(error?.message || '');
}

class VisualTestRunner {
  constructor(options = {}) {
    this.url = options.url || process.env.TEST_URL || 'http://127.0.0.1:5174';
    this.headless = options.headless ?? (process.env.HEADLESS !== 'false');
    this.screenshotDir = options.screenshotDir || 'tests/visual-testing/screenshots';
    this.reportDir = options.reportDir || 'tests/visual-testing/reports';
    this.metaDir = options.metaDir || 'tests/visual-testing/meta';
    this.baselineDir = options.baselineDir || 'tests/visual-testing/base-screenshots';
    this.readyTimeout = resolveReadyTimeout(options.readyTimeout);
    this.useFixtures = options.useFixtures !== false;
    
    this.browser = null;
    this.context = null;
    this.page = null;
    
    // 初始化提供器
    this.ocr = new OCRProvider();
    this.pixelDiff = new PixelDiffProvider({
      outputDir: `${this.reportDir}/pixel-diff`,
      threshold: options.pixelThreshold ?? 0.01,
    });
    
    this.results = [];
    this.testMeta = {}; // 存储每个测试的元数据
    this.consoleErrors = [];
    this.pageErrors = [];
  }

  async launch() {
    this.browser = await chromium.launch({ 
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
      // 像素门禁需要确定性渲染：模拟用户「减少动态效果」偏好，
      // 关闭入场/循环动画，避免截图截到动画中间态导致对比不稳定。
      reducedMotion: 'reduce',
    });
    if (this.useFixtures) {
      await this.context.addInitScript({ content: buildInitScript() });
    }
    this.page = await this.context.newPage();
    this.page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.includes('[vite]') || text.includes('HMR')) return;
      this.consoleErrors.push(text.slice(0, 500));
    });
    this.page.on('pageerror', (error) => {
      this.pageErrors.push(error.message.slice(0, 500));
    });
    
    // 确保目录存在
    [this.screenshotDir, this.reportDir, this.metaDir].forEach(d => 
      fs.mkdirSync(d, { recursive: true })
    );
    
    // 加载已有的 meta 数据
    this._loadMeta();
  }

  async _collectReadinessDiagnostics() {
    const diagnostics = {
      url: 'unavailable',
      hash: 'unavailable',
      appPresent: 'unavailable',
      appMounted: 'unavailable',
      appTextLength: 'unavailable',
    };

    try {
      if (typeof this.page.url === 'function') diagnostics.url = this.page.url();
    } catch (error) {
      diagnostics.url = `unavailable (${error.message})`;
    }

    if (typeof this.page.evaluate !== 'function') return diagnostics;

    try {
      return {
        ...diagnostics,
        ...await this.page.evaluate(() => {
          const app = document.querySelector('#app');
          return {
            hash: window.location.hash,
            appPresent: Boolean(app),
            appMounted: Boolean(app?.hasAttribute('data-v-app')),
            appTextLength: (app?.textContent || '').trim().length,
          };
        }),
      };
    } catch (error) {
      diagnostics.diagnosticsError = error.message;
      return diagnostics;
    }
  }

  async _waitForApplicationReady(expectedHash, readySelector) {
    const startedAt = Date.now();
    let stage = 'Vue 挂载';
    try {
      if (typeof this.page.waitForFunction === 'function') {
        await this.page.waitForFunction((hash) => {
          const app = document.querySelector('#app');
          return window.location.hash === hash
            && app
            && app.hasAttribute('data-v-app')
            && (app.textContent || '').trim().length > 0;
        }, expectedHash, { timeout: this.readyTimeout });
      }
      if (readySelector) {
        stage = `业务选择器(${readySelector})`;
        const elapsed = Math.max(0, Date.now() - startedAt);
        const remainingTimeout = this.readyTimeout - elapsed;
        if (remainingTimeout <= 0) {
          const exhaustedBudgetError = new Error(`Timeout ${this.readyTimeout}ms exceeded`);
          exhaustedBudgetError.name = 'TimeoutError';
          throw exhaustedBudgetError;
        }
        await this.page.waitForSelector(readySelector, { timeout: remainingTimeout });
      }
    } catch (error) {
      if (!isTimeoutError(error)) throw error;
      const diagnostics = await this._collectReadinessDiagnostics();
      const timeoutError = new Error(
        `视觉测试就绪超时（${this.readyTimeout}ms）：stage=${stage}；expectedHash=${expectedHash}；`
        + `url=${diagnostics.url}；hash=${diagnostics.hash}；`
        + `appPresent=${diagnostics.appPresent}；appMounted=${diagnostics.appMounted}；`
        + `appTextLength=${diagnostics.appTextLength}`
        + (diagnostics.diagnosticsError ? `；diagnosticsError=${diagnostics.diagnosticsError}` : ''),
      );
      timeoutError.code = stage === 'Vue 挂载'
        ? 'ERR_VISUAL_APP_READY_TIMEOUT'
        : 'ERR_VISUAL_READY_SELECTOR_TIMEOUT';
      timeoutError.cause = error;
      throw timeoutError;
    }
  }

  async _navigateToRoute(route, readySelector, expectedRoute = route, destinationUrl = null) {
    const normalizedBase = this.url.replace(/\/$/, '');
    const expectedHash = '#' + expectedRoute;
    await this._resetBrowserState();
    await this.page.goto(destinationUrl || `${normalizedBase}/#${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await this._waitForApplicationReady(expectedHash, readySelector);
    if (typeof this.page.evaluate === 'function') {
      await this.page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
    }
    // 确定性渲染加固：reducedMotion 仅设置媒体偏好，若业务 CSS 未用
    // @media (prefers-reduced-motion) 响应，入场/循环动画仍会在截图窗口内
    // 动起来，导致像素对比在不同轮次间抖动（实测 /create 在两次运行间
    // misMatch 由 0.026% 摆动到 9%）。此处强制把动画/过渡归零，并等网络
    // 空闲与稳定帧，消除“中间态”截图。VISUAL_CAPTURE_SETTLE_MS 可调（默认 300ms）。
    if (typeof this.page.addStyleTag === 'function') {
      await this.page.addStyleTag({
        content: '*,*::before,*::after{transition:0s!important;animation:0s!important;'
          + 'animation-delay:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}',
      });
    }
    if (typeof this.page.evaluate === 'function') {
      await this.page.evaluate(() => window.scrollTo(0, 0));
    }
    const settleMs = Number(process.env.VISUAL_CAPTURE_SETTLE_MS) || 300;
    if (settleMs > 0) await this.page.waitForTimeout(settleMs);
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (_) { /* 持续轮询的视图（进度等）永不 idle，忽略超时 */ }
  }

  async _resetBrowserState() {
    if (this.context && typeof this.context.clearCookies === 'function') {
      await this.context.clearCookies();
    }
    if (this.page && typeof this.page.evaluate === 'function') {
      const pageUrl = typeof this.page.url === 'function' ? this.page.url() : null;
      if (pageUrl === 'about:blank') return;
      await this.page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
    }
  }

  _throwOnRuntimeErrors(testName, consoleOffset, pageOffset) {
    const errors = [
      ...this.consoleErrors.slice(consoleOffset),
      ...this.pageErrors.slice(pageOffset),
    ];
    if (errors.length === 0) return;
    const error = new Error(`视觉测试 ${testName} 出现页面错误: ${errors.join(' | ')}`);
    error.code = 'ERR_VISUAL_PAGE_RUNTIME';
    throw error;
  }

  /**
   * 加载已有的 meta.json 数据
   */
  _loadMeta() {
    const metaPath = path.join(this.metaDir, 'pixel-tests-meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        this.testMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch (e) {
        this.testMeta = {};
      }
    }
  }

  /**
   * 保存 meta 数据到文件
   */
  _saveMeta() {
    const metaPath = path.join(this.metaDir, 'pixel-tests-meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(this.testMeta, null, 2), 'utf8');
  }

  /**
   * 截图并分析
   */
  async captureAndAnalyze(viewName, prompt, options = {}) {
    const screenshotPath = path.join(this.screenshotDir, `${viewName}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: options.fullPage });
    
    if (options.useOCR) {
      const text = await this.ocr.extractText(screenshotPath);
      return { screenshotPath, text, prompt };
    }
    
    return { screenshotPath, prompt };
  }

  /**
   * 等待视口内图片加载/解码完成，并让绘制提交两帧。
   * 页面使用 loading="lazy" 的装饰背景图时，仅等业务选择器会出现
   * 图片未解码、动画未落定的中间态，导致像素对比在不同机器/轮次间不稳定。
   * 注：整段等待逻辑放在单次 evaluate 内执行，便于单测 mock 兼容。
   */
  async _waitForImagesSettled(timeoutMs = 4000) {
    await this.page.evaluate(async (budget) => {
      const deadline = Date.now() + budget;
      const visibleUnloaded = () => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return Array.from(document.images).filter((img) => {
          const rect = img.getBoundingClientRect();
          const inViewport = rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
          return inViewport && !(img.complete && img.naturalWidth > 0);
        });
      };
      while (Date.now() < deadline) {
        const pending = visibleUnloaded();
        if (pending.length === 0) break;
        await Promise.all(pending.map((img) => new Promise((resolve) => {
          if (typeof img.decode === 'function') {
            img.decode().then(resolve, resolve);
          } else {
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            if (img.complete) done();
          }
        })));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // 再等两帧，确保 decode 完成后的绘制已提交到合成层
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, timeoutMs);
  }

  /**
   * 像素对比测试
   */
  async pixelRegressionTest(testName, route, options = {}) {
    const consoleOffset = this.consoleErrors.length;
    const pageOffset = this.pageErrors.length;
    await this._navigateToRoute(
      route,
      options.waitFor || '#app',
      options.expectedRoute || route,
    );
    // prepare：部分页面状态无法靠路由直达（需先点选卡片 / 展开分组才能渲染目标区域）。
    // 钩子在路由就绪后、图片等待前执行，抛错即视为该视图失败，不做静默跳过。
    if (typeof options.prepare === 'function') {
      await options.prepare(this.page);
    }
    // 等待视口图片就绪，避免懒加载/异步解码导致截图不稳定
    await this._waitForImagesSettled();
    
    const currentPath = path.join(this.screenshotDir, `${testName}-current.png`);
    const baselinePath = path.join(this.baselineDir, `${testName}.png`);
    
    await this.page.screenshot({ path: currentPath });
    this._throwOnRuntimeErrors(testName, consoleOffset, pageOffset);
    
    // 如果没有基准图，创建
    if (!fs.existsSync(baselinePath)) {
      if (process.env.UPDATE_BASELINE !== '1') {
        const error = new Error(`缺少人工审核的视觉基线: ${baselinePath}`);
        error.code = 'ERR_VISUAL_BASELINE_MISSING';
        this.results.push({
          test: testName,
          status: 'FAILED',
          reason: error.message,
          route,
        });
        throw error;
      }

      await this.pixelDiff.updateBaseline(currentPath, baselinePath);
      // 保存 meta 信息
      this.testMeta[testName] = { route, createdAt: new Date().toISOString() };
      this._saveMeta();
      this.results.push({ test: testName, status: 'BASELINE_CREATED', route });
      return { status: 'BASELINE_CREATED', baselinePath };
    }
    
    // 对比
    const result = await this.pixelDiff.compare(baselinePath, currentPath, testName);
    
    // 保存 meta 信息（包括真实 misMatchPercentage）
    this.testMeta[testName] = { 
      route, 
      misMatchPercentage: result.misMatchPercentage,
      threshold: this.pixelDiff.threshold,
      updatedAt: new Date().toISOString()
    };
    this._saveMeta();
    
    this.results.push({
      test: testName,
      status: result.passed ? 'PASSED' : 'FAILED',
      misMatchPercentage: result.misMatchPercentage,
      diffPath: result.diffImagePath,
      route
    });

    // 对比失败: 主动 throw, 让调用方 (run-pixel-tests.js) 记录 failed 并返回非零退出码
    // 始于 2026-07-12 质量节拍: 避免 CI 因容错错误报告通过
    if (!result.passed) {
      throw new Error(
        '像素对比失败 (' + testName + '): misMatchPercentage=' + (Number(result.misMatchPercentage) || 0).toFixed(2) + '% ' +
        '(threshold=' + (this.pixelDiff.threshold * 100) + '%); 差异图: ' + result.diffImagePath
      );
    }

    return result;
  }

  /**
   * AI 视觉测试：导航到路由，截图，对每个 check 做 OCR + 快照记录
   */
  async aiVisionTest(testName, route, checks = [], options = {}) {
    if (checks.length === 0 || checks.some((check) => !check.selector && !check.text)) {
      const error = new Error(`视觉测试 ${testName} 缺少可执行的 selector/text 断言`);
      error.code = 'ERR_VISUAL_CHECK_INVALID';
      throw error;
    }

    const consoleOffset = this.consoleErrors.length;
    const pageOffset = this.pageErrors.length;
    await this._navigateToRoute(
      route,
      options.waitFor || '#app',
      options.expectedRoute || route,
    );

    const screenshotPath = path.join(this.screenshotDir, `${testName}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });

    let pageText = '';
    if (options.useOCR) pageText = await this.ocr.extractText(screenshotPath);

    let failed = 0;
    for (const check of checks) {
      let passed;
      if (check.selector) {
        passed = await this.page.locator(check.selector).first().isVisible();
      } else {
        const textLocator = typeof this.page.getByText === 'function'
          ? this.page.getByText(check.text, { exact: false })
          : this.page.locator(`text=${check.text}`);
        passed = await textLocator.first().isVisible();
      }
      if (!passed) failed += 1;
      this.results.push({
        test: testName,
        check: check.name,
        status: passed ? 'PASSED' : 'FAILED',
        route,
        screenshotPath,
        prompt: check.prompt,
        ocrTextLength: pageText.length,
      });
    }

    this._throwOnRuntimeErrors(testName, consoleOffset, pageOffset);
    if (failed > 0) {
      const error = new Error(`视觉测试 ${testName} 有 ${failed} 项机器断言失败`);
      error.code = 'ERR_VISUAL_CHECK_FAILED';
      throw error;
    }

    return { status: 'PASSED', screenshotPath, checks: checks.length };
  }

  /**
   * 关闭浏览器
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  /**
   * 生成测试报告
   */
  generateReport() {
    const passed = this.results.filter(r => r.status === 'PASSED').length;
    const failed = this.results.filter(r => r.status === 'FAILED').length;
    const total = this.results.length;
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: { total, passed, failed, passRate: `${((passed/total)*100).toFixed(1)}%` },
      results: this.results
    };
    
    const reportPath = path.join(this.reportDir, `report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      视觉测试报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  总计: ${total}
  通过: ? ${passed}
  失败: ? ${failed}
  通过率: ${((passed/total)*100).toFixed(1)}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  报告: ${reportPath}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
    
    return report;
  }
}

module.exports = { VisualTestRunner };








