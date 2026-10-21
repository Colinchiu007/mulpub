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

// 采集层固定时钟。这几个视图把墙上时钟渲染进了像素：时段问候（晚上好/下午好）、
// 日历的「今天」高亮、关键词监测的 ISO 毫秒戳。它们的基线在数学上不可复现 ——
// 任何跨自然日的两次 run 必然不同（实测同日差 441 px、跨日差 24578 px）。
// 用 clock 钉死 Date 比给每张图登记「漂移预算」更可取：预算上界取决于两次 run 隔多久，本身不可知。
// setFixedTime 只改 Date.now/new Date()，计时器照常跑（见 playwright-core d.ts 原文），
// 因此 settleForCapture 的 rAF/setTimeout 不受影响。
const DEFAULT_CAPTURE_FIXED_TIME_ISO = '2026-01-01T00:00:00.000Z';

// 跨视图会「活下来」的瞬时浮层：Element Plus 把 ElMessage / ElNotification / MessageBox
// 挂到 body 上，而本仓是 hash 路由 ⇒ 跨路由 goto **不重载文档**，上一个视图弹的东西
// 会留在 DOM 里进下一个视图的截图。
// 清单刻意只收这三类「由代码主动弹出、不属于任何页面结构」的容器：
// 收 `[role="alert"]` 之类泛化选择器会把页面自身的错误区块一起抹掉，那是被拍对象的真实状态。
const INHERITED_OVERLAY_SELECTORS = ['.el-message', '.el-notification', '.el-message-box__wrapper'];

/**
 * 页内执行体：必须是**自包含**函数（Playwright 只序列化它自己的源码，闭包里的模块变量到不了页面），
 * 同时又要能在 Node 侧直接调用 —— 否则「清除是否真的生效」这件事只能靠读源码字符串断言，
 * 那是装饰性锁。故导出，测试用假 document 真跑一遍这个函数体。
 */
function clearInheritedOverlays(sels) {
  let removed = 0;
  for (const sel of sels) {
    const nodes = document.querySelectorAll(sel);
    for (let i = 0; i < nodes.length; i += 1) {
      nodes[i].remove();
      removed += 1;
    }
  }
  let left = 0;
  for (const sel of sels) left += document.querySelectorAll(sel).length;
  return { removed, left };
}

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
    await this._installCaptureClock();
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
      // 「选择器等不到」有三种完全不同的成因，只看前五项分不开：
      // ① 页面根本没渲染 ② 渲染了但目标控件所在容器没渲染 ③ 控件本该渲染却被业务开关挡住
      accountsPagePresent: 'unavailable',
      commandBarTestids: 'unavailable',
      flagParamInUrl: 'unavailable',
      entryScripts: 'unavailable',
      channelState: 'unavailable',
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
        ...await this.page.evaluate(async () => {
          const app = document.querySelector('#app');
          // 让应用自己回答「通道开着吗、参数解析成了什么」—— 这是唯一能区分
          // "环境变量没进 vite 进程" 与 "进了但判定没通过" 两种情况的手段。
          // 两条踩过的坑：① 不能用 import.meta（page.evaluate 是经典脚本上下文，会直接语法错）；
          // ② 必须**先 await 再放进返回对象** —— 把 async IIFE 直接当属性值，Playwright 序列化
          //    时它就是个 Promise，日志里会变成没用的 [object Object]（本地实测抓到过）。
          let channelState = 'unavailable';
          try {
            const m = await import('/composables/useFeatureFlag.js');
            const raw = (window.location.hash || '').split('?')[1]
              || (window.location.search || '').replace(/^\?/, '');
            const got = [...m.parseDevFlagOverrides(raw).entries()]
              .map(([flagKey, on]) => `${flagKey}=${on}`).join(',');
            channelState = `enabled=${m.devFlagChannelEnabled()} parsed=[${got}]`;
          } catch (error) {
            channelState = `unavailable (${error.message})`;
          }
          return {
            hash: window.location.hash,
            appPresent: Boolean(app),
            appMounted: Boolean(app?.hasAttribute('data-v-app')),
            appTextLength: (app?.textContent || '').trim().length,
            // 页面是否真渲染 + 命令栏里实际存在哪些按钮：直接区分「整条命令栏没渲染」与
            // 「只有这一个按钮没渲染」（后者才说明是业务开关没开）
            accountsPagePresent: Boolean(document.querySelector('.accounts-page')),
            commandBarTestids: [...document.querySelectorAll('.account-controls [data-testid]')]
              .map((el) => el.getAttribute('data-testid')).join('|') || '(none)',
            flagParamInUrl: /mpFlag=/.test(window.location.hash) ? 'in-hash'
              : /mpFlag=/.test(window.location.search) ? 'in-search' : 'absent',
            channelState,
            // 直接回报页面加载了哪些脚本入口（不做启发式猜测）：dev 服务下是 `/main.js` +
            // `/@vite/client`，构建产物下是 `./assets/*.js`。这决定 import.meta.env.DEV 的取值，
            // 没有这一项就只能靠猜 CI 当时在服务什么。
            entryScripts: [...document.querySelectorAll('script[src]')]
              .map((el) => el.getAttribute('src')).join('|').slice(0, 160) || '(none)',
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
        + `；accountsPagePresent=${diagnostics.accountsPagePresent}`
        + `；flagParamInUrl=${diagnostics.flagParamInUrl}`
        + `；entryScripts=${diagnostics.entryScripts}`
        + `；channelState=${diagnostics.channelState}`
        + `；commandBarTestids=${diagnostics.commandBarTestids}`
        + (diagnostics.diagnosticsError ? `；diagnosticsError=${diagnostics.diagnosticsError}` : ''),
      );
      timeoutError.code = stage === 'Vue 挂载'
        ? 'ERR_VISUAL_APP_READY_TIMEOUT'
        : 'ERR_VISUAL_READY_SELECTOR_TIMEOUT';
      timeoutError.cause = error;
      throw timeoutError;
    }
  }

  /**
   * 目标 URL 与当前 URL 是否"只有 fragment 里的 query 在变、路由 path 不变"。
   * 这种导航会被 vue-router 复用组件实例，挂在 onMounted 上的读取不会再跑。
   * 只在能确定判定为 true 时才触发 reload —— 判不出来一律返回 false（保持既有行为）。
   */
  _isSameRouteQueryOnlyNav (targetUrl) {
    if (typeof this.page?.url !== 'function') return false;
    let current;
    let next;
    try {
      current = new URL(this.page.url());
      next = new URL(targetUrl);
    } catch (_) {
      return false;
    }
    if (current.protocol !== next.protocol || current.host !== next.host) return false;
    if (current.pathname !== next.pathname) return false;
    const split = (hash) => {
      const raw = String(hash || '').replace(/^#/, '');
      const at = raw.indexOf('?');
      return at < 0 ? { path: raw, query: '' } : { path: raw.slice(0, at), query: raw.slice(at + 1) };
    };
    const a = split(current.hash);
    const b = split(next.hash);
    if (!a.path || a.path !== b.path) return false;
    return a.query !== b.query;
  }

  async _navigateToRoute(route, readySelector, expectedRoute = route, destinationUrl = null) {
    const normalizedBase = this.url.replace(/\/$/, '');
    const expectedHash = '#' + expectedRoute;
    await this._resetBrowserState();
    const targetUrl = destinationUrl || `${normalizedBase}/#${route}`;
    // 同一路由只改 query ⇒ vue-router **复用组件实例** ⇒ onMounted 不再跑第二遍。
    // 本仓是 hash 路由，pathname 恒为 /，所以判据只能落在 fragment 的 path 段上。
    // 症状（实测）：accounts-list 跑完之后紧跟 accounts-list-flag-on，按钮永不出现、就绪超时；
    // 单独跑同一条则通过 —— 纯函数说"该开"，但组件根本没重新读参数。
    const reusedComponent = this._isSameRouteQueryOnlyNav(targetUrl);
    await this.page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    if (reusedComponent) {
      // 强制一次真实文档加载，让这条用例拍到的是"该路由首次加载"的样子，
      // 而不是上一条用例留下的组件实例状态。
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    }
    await this._dismissInheritedOverlays();
    await this._waitForApplicationReady(expectedHash, readySelector);
    await this.settleForCapture();
  }

  /**
   * 清除「继承自上一个视图」的瞬时浮层。判据是**清除 + 回读断言**，不是"截图前一律抹掉浮层"：
   * 它挂在导航缝上（goto 之后、当前页自己的异步之前），所以当前页真出错时它弹出的东西
   * 照样进图 —— 那是该页的真实状态，本来就该被拍到。
   *
   * 动因（实测 CI）：views 套件第 19 位是 hot-topics，它在 CI 里必然取不到外部热搜，
   * 于是 `HotTopics.vue` 弹「选题获取失败，请稍后重试」；紧随其后拍的 publish-form **浅档**
   * 带着这条 toast（差 32500 px），而像素套件顺序里没有 hot-topics，同一页**暗档**干净
   * （差 29734 px，且那部分差异是新增的「创作视频」按钮）。若照此重建基线，
   * 等于把别人页面的错误态烤成"发布页应该长这样"。
   */
  async _dismissInheritedOverlays() {
    if (!this.page || typeof this.page.evaluate !== 'function') return 0;
    const verdict = await this.page.evaluate(clearInheritedOverlays, INHERITED_OVERLAY_SELECTORS);
    const removed = verdict && Number(verdict.removed);
    const left = verdict && Number(verdict.left);
    if (!Number.isSafeInteger(removed) || !Number.isSafeInteger(left)) {
      // 读不到结论时不得当成"没有浮层"放行：那正是把污染静默放过的形状
      throw new Error(`[visual] 继承浮层清除未取得计数 removed=${verdict && verdict.removed} left=${verdict && verdict.left}`);
    }
    if (left > 0) {
      throw new Error(`[visual] 清除后仍有 ${left} 个瞬时浮层在 DOM 里（remove() 未生效或被重建），本次渲染不可作为基线`);
    }
    if (removed > 0) {
      console.log(`[visual] 导航前清除继承自上一视图的瞬时浮层 ${removed} 个`);
    }
    this.inheritedOverlaysRemoved = (this.inheritedOverlaysRemoved || 0) + removed;
    return removed;
  }

  /**
   * 截图前的确定性渲染收口：等字体与稳定帧、把动画/过渡归零、回到顶部、等网络空闲。
   * 视图用例经 _navigateToRoute 调用；工作流用例必须在**每一步截图之前**调用 ——
   * 否则拍到的是入场过渡的中间态（实测 CI 上 dashboard-benchmark-title-reset 末态
   * 与 CI 渲染的默认视图差 10.84%，整页半透明且下半屏区块尚未出现）。
   */
  async settleForCapture() {
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

/**
   * 把页面时钟钉到固定时刻，使含实时值的视图可复现。
   * VISUAL_CAPTURE_FIXED_TIME_ISO=off 显式关闭；写了非法值一律抛错 ——
   * 静默退回"不固定"会把基线重新变成跨日必漂，而没人会去查门禁为什么红。
   */
  async _installCaptureClock() {
    const raw = process.env.VISUAL_CAPTURE_FIXED_TIME_ISO;
    const v = raw === undefined ? DEFAULT_CAPTURE_FIXED_TIME_ISO : String(raw).trim();
    if (v === '' || v === 'off') {
      this.captureFixedTime = null;
      return null;
    }
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) {
      throw new Error(
        `VISUAL_CAPTURE_FIXED_TIME_ISO 不是合法时间：${JSON.stringify(raw)}` +
        `（期望 ISO 串或 off；不得静默退回未固定）`
      );
    }
    if (!this.page || !this.page.clock || typeof this.page.clock.setFixedTime !== 'function') {
      // 宿主不提供该 API 时必须出声：否则门禁红了没人知道是采集没钉住
      console.warn('[visual] page.clock.setFixedTime 不可用，采集时间未固定，含实时值的基线不可复现');
      this.captureFixedTime = null;
      return null;
    }
    await this.page.clock.setFixedTime(new Date(t));
    this.captureFixedTime = t;
    return t;
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
   * 主题 → 基线文件名后缀（批次 1：暗色基线通道）
   * 浅色沿用历史命名（既有 22 条基线不受影响），暗色用独立后缀，二者互不覆盖。
   */
  static themeSuffix(theme) {
    return theme === 'dark' ? '-dark' : ''
  }

  /**
   * 把主题写到 DOM（批次 1：暗色基线通道）
   *
   * - `data-theme` 是应用唯一的主题开关。**⚠ 接线状态在 2026-10-21（UX 审计 1.1）之前与之后不同**：
   *   此前生产代码里没有任何 `useTheme()` 消费方，运行期只有**本 runner** 在写这个属性 ——
   *   即"暗色可用"这件事的全部证据都来自测试侧，用户侧永远不可达。
   *   现在写入者是 `src/composables/useTheme.js`（应用级单例，入口在设置页「外观」+ `main.js` 的首帧落色）；
   *   本 runner 的注入**只用于拍摄暗档**：它不改用户偏好、不落持久层，因此
   *   "runner 能把界面拍成暗色" 不等于 "用户能切暗色" —— 判后者要看生产代码里的调用点。
   * - **每个用例都必须显式设置**：runner 全用例复用同一个 page，hash 导航不重载文档，
   *   上一用例残留的 `data-theme="dark"` 会让下一个浅色用例拍出暗色图并与浅色基线比红
   * - 浅色显式写 `"light"` 与「属性缺失」在样式上等价：全仓 77 处 `[data-theme=...]` 选择器
   *   **全部是 `dark`**，且不存在 `:not([data-theme])` / `[data-theme=""]` / `html:not(...)`
   *   这类依赖属性存在性的写法（2026-09-29 实测）。因此本改造**不会改写既有浅色基线的拍摄条件**。
   * - 非法值一律归一为 `light`（fail-safe：不产出第三套命名）
   */
  async _applyTheme(theme) {
    const normalized = theme === 'dark' ? 'dark' : 'light'
    await this.page.evaluate((value) => {
      document.documentElement.setAttribute('data-theme', value)
    }, normalized)
    // 主题改的是 CSS 变量求值结果 → 等两个稳定帧再截图（与字体/动画稳定帧同源手法）
    await this.page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))
    return normalized
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
    // 主题在截图前显式落地（暗色通道）；顺序在 prepare 之后，保证页面态与主题一致
    const theme = await this._applyTheme(options.theme);
    const themeSuffix = VisualTestRunner.themeSuffix(theme);
    // 等待视口图片就绪，避免懒加载/异步解码导致截图不稳定
    await this._waitForImagesSettled();
    
    const currentPath = path.join(this.screenshotDir, `${testName}${themeSuffix}-current.png`);
    const baselinePath = path.join(this.baselineDir, `${testName}${themeSuffix}.png`);
    
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
          theme,
        });
        throw error;
      }

      await this.pixelDiff.updateBaseline(currentPath, baselinePath);
      // 保存 meta 信息（key 含主题后缀：同一视图的浅/暗两态不得互相覆盖 meta）
      this.testMeta[`${testName}${themeSuffix}`] = { route, theme, createdAt: new Date().toISOString() };
      this._saveMeta();
      this.results.push({ test: testName, status: 'BASELINE_CREATED', route, theme });
      return { status: 'BASELINE_CREATED', baselinePath, theme };
    }
    
    // 对比
    const result = await this.pixelDiff.compare(baselinePath, currentPath, testName);
    
    // 保存 meta 信息（包括真实 misMatchPercentage）
    this.testMeta[`${testName}${themeSuffix}`] = { 
      route, 
      theme,
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
      route,
      theme
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

module.exports = { VisualTestRunner, clearInheritedOverlays, INHERITED_OVERLAY_SELECTORS };








