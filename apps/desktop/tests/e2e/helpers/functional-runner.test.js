const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { FunctionalRunner } = require('./functional-runner');

function createRunner({ navigationResults }) {
  const runner = new FunctionalRunner({ url: 'http://127.0.0.1:5174' });
  const pendingResults = [...navigationResults];
  const calls = [];
  const readyCalls = [];

  runner.page = {
    goto: async (...args) => {
      calls.push(args);
      const result = pendingResults.shift();
      if (result instanceof Error) throw result;
      return result;
    },
  };
  runner.waitForAppReady = async (...args) => {
    readyCalls.push(args);
  };

  return { runner, calls, readyCalls };
}

describe('FunctionalRunner 导航瞬时故障恢复合同', () => {
  it('仅对 ERR_NO_BUFFER_SPACE 重试一次，第二次成功后才等待应用就绪', async () => {
    const transientError = new Error('page.goto: net::ERR_NO_BUFFER_SPACE at http://127.0.0.1:5174/#/accounts');
    const { runner, calls, readyCalls } = createRunner({
      navigationResults: [transientError, undefined],
    });

    await runner.goto('/accounts');

    assert.equal(calls.length, 2);
    assert.deepEqual(readyCalls, [['/accounts']]);
    assert.deepEqual(runner.actions.map((action) => action.kind), ['navigationRetry', 'goto']);
  });

  it('不重试其他导航错误', async () => {
    const error = new Error('page.goto: net::ERR_CONNECTION_REFUSED');
    const { runner, calls, readyCalls } = createRunner({
      navigationResults: [error],
    });

    await assert.rejects(() => runner.goto('/accounts'), (received) => received === error);

    assert.equal(calls.length, 1);
    assert.equal(readyCalls.length, 0);
    assert.equal(runner.actions.length, 0);
  });

  it('瞬时错误在一次重试后仍失败时抛出最后一次错误', async () => {
    const firstError = new Error('page.goto: net::ERR_NO_BUFFER_SPACE at first attempt');
    const finalError = new Error('page.goto: net::ERR_NO_BUFFER_SPACE at retry');
    const { runner, calls, readyCalls } = createRunner({
      navigationResults: [firstError, finalError],
    });

    await assert.rejects(() => runner.goto('/accounts'), (received) => received === finalError);

    assert.equal(calls.length, 2);
    assert.equal(readyCalls.length, 0);
    assert.deepEqual(runner.actions.map((action) => action.kind), ['navigationRetry']);
  });

  it('resetToRoute 复用相同恢复逻辑，并且只在成功导航后等待目标路由', async () => {
    const order = [];
    const transientError = new Error('page.goto: net::ERR_NO_BUFFER_SPACE at reset');
    const { runner, calls, readyCalls } = createRunner({
      navigationResults: [transientError, undefined],
    });
    const originalGoto = runner.page.goto;
    runner.page.goto = async (...args) => {
      order.push('goto');
      return originalGoto(...args);
    };
    runner.waitForAppReady = async (...args) => {
      order.push('ready');
      readyCalls.push(args);
    };

    await runner.resetToRoute('/create', { readyTimeout: 1234 });

    assert.deepEqual(order, ['goto', 'goto', 'ready']);
    assert.equal(calls.length, 2);
    assert.deepEqual(readyCalls, [['/create', 1234]]);
    assert.deepEqual(runner.actions.map((action) => action.kind), ['navigationRetry', 'resetToRoute']);
  });
});

/**
 * 回归保护：waitForAppReady 的就绪判据必须真的等到「路由内容挂载」。
 *
 * 事故原型（2026-09-26）：QG Browser E2E 随机误红 —— #2410 挂在 /dashboard 的
 * 「页面标题渲染」（期望字面量「数据看板」，consoleErrors=0，13/14），而紧随其后的
 * 「平台数据卡片渲染」却通过。原因：旧判据用 `#app.textContent` 非空表示就绪，但 #app
 * 常驻侧边栏（主页/发布/账号…），该条件**恒为真**，等于没等懒加载路由 chunk 挂载
 * （Vite 按需编译）。于是导航后第一条断言只剩 CONDITION_TIMEOUT=5s 去等 chunk，
 * CI 满载时超时；而它烧掉的这 5s 恰好让后面的卡片断言赶上加载完成 —— 于是
 * 「标题红、卡片绿」且落点路由随机。
 */
describe('FunctionalRunner 应用就绪判据合同', () => {
  function captureReadyPredicate(hash, app) {
    const runner = new FunctionalRunner({ url: 'http://127.0.0.1:5174' });
    let captured = null;
    runner.page = {
      waitForURL: async () => {},
      locator: () => ({ waitFor: async () => {} }),
      waitForFunction: async (fn) => { captured = fn; },
    };
    const prevWindow = global.window;
    const prevDocument = global.document;
    global.window = { location: { hash } };
    global.document = { querySelector: (sel) => (sel === '#app' ? app : null) };
    return runner.waitForAppReady('/dashboard')
      .then(() => captured('#dashboard'))
      .finally(() => {
        global.window = prevWindow;
        global.document = prevDocument;
      });
  }

  function fakeApp({ outletText, shellText = '主页发布账号数据视频创作采集文案库' }) {
    return {
      hasAttribute: (name) => name === 'data-v-app',
      textContent: shellText + outletText,
      querySelector: (sel) => (
        sel.includes('mp-workspace') || sel.includes('fullscreen-view')
          ? { textContent: outletText }
          : null
      ),
    };
  }

  it('侧边栏有文字但路由内容尚未挂载时，不得判为就绪（旧判据在此恒真是为 Bug）', async () => {
    const ready = await captureReadyPredicate('#dashboard', fakeApp({ outletText: '' }));
    assert.equal(ready, false, '空出口必须未就绪');
  });

  it('路由内容出口渲染出文字后才判就绪', async () => {
    const ready = await captureReadyPredicate('#dashboard', fakeApp({ outletText: '数据看板各平台发布数据与趋势分析' }));
    assert.equal(ready, true);
  });

  it('登录标签用的 fullscreen-view 出口同样被认作路由内容', async () => {
    const runner = new FunctionalRunner({ url: 'http://127.0.0.1:5174' });
    let captured = null;
    runner.page = {
      waitForURL: async () => {},
      locator: () => ({ waitFor: async () => {} }),
      waitForFunction: async (fn) => { captured = fn; },
    };
    const prevWindow = global.window;
    const prevDocument = global.document;
    global.window = { location: { hash: '#/first-run' } };
    global.document = {
      querySelector: (sel) => (sel === '#app'
        ? {
            hasAttribute: () => true,
            textContent: '欢迎使用',
            querySelector: (inner) => (inner.includes('fullscreen-view') ? { textContent: '欢迎使用社媒管家' } : null),
          }
        : null),
    };
    try {
      await runner.waitForAppReady('/first-run');
      assert.equal(captured('#/first-run'), true);
    } finally {
      global.window = prevWindow;
      global.document = prevDocument;
    }
  });

  it('两个路由出口都不存在时不得判就绪（避免把挂载失败当成功）', async () => {
    const runner = new FunctionalRunner({ url: 'http://127.0.0.1:5174' });
    let captured = null;
    runner.page = {
      waitForURL: async () => {},
      locator: () => ({ waitFor: async () => {} }),
      waitForFunction: async (fn) => { captured = fn; },
    };
    const prevWindow = global.window;
    const prevDocument = global.document;
    global.window = { location: { hash: '#/dashboard' } };
    global.document = {
      querySelector: (sel) => (sel === '#app'
        ? { hasAttribute: () => true, textContent: '主页发布账号', querySelector: () => null }
        : null),
    };
    try {
      await runner.waitForAppReady('/dashboard');
      assert.equal(captured('#/dashboard'), false);
    } finally {
      global.window = prevWindow;
      global.document = prevDocument;
    }
  });

  it('hash 不匹配时一律未就绪（防止残留内容造成假就绪）', async () => {
    const ready = await captureReadyPredicate('#accounts', fakeApp({ outletText: '数据看板' }));
    assert.equal(ready, false);
  });

  it('严格判据超时时回退到旧的宽松判据，不新增确定性硬失败', async () => {
    const runner = new FunctionalRunner({ url: 'http://127.0.0.1:5174' });
    const seen = [];
    runner.page = {
      waitForURL: async () => {},
      locator: () => ({ waitFor: async () => {} }),
      waitForFunction: async (fn) => {
        seen.push(fn);
        if (seen.length === 1) {
          // 模拟 Playwright 的等待函数超时
          throw new Error('page.waitForFunction: Timeout 30000ms exceeded.');
        }
        return undefined;
      },
    };
    await runner.waitForAppReady('/dashboard');
    assert.equal(seen.length, 2, '应触发一次宽松判据回退');
    // 第二次传入的必须是旧的宽松判据：#app 有文字即就绪（无出口场景）
    const prevWindow = global.window;
    const prevDocument = global.document;
    global.window = { location: { hash: '#/dashboard' } };
    global.document = {
      querySelector: () => ({ hasAttribute: () => true, textContent: '主页发布账号', querySelector: () => null }),
    };
    try {
      assert.equal(seen[1]('#/dashboard'), true, '回退判据应容忍无出口路由');
    } finally {
      global.window = prevWindow;
      global.document = prevDocument;
    }
  });

  it('非超时的等待错误必须原样抛出（不得被兜底吞掉）', async () => {
    const runner = new FunctionalRunner({ url: 'http://127.0.0.1:5174' });
    const realError = new Error('page.waitForFunction: ReferenceError: app is not defined');
    let calls = 0;
    runner.page = {
      waitForURL: async () => {},
      locator: () => ({ waitFor: async () => {} }),
      waitForFunction: async () => { calls += 1; throw realError; },
    };
    await assert.rejects(() => runner.waitForAppReady('/dashboard'), (received) => received === realError);
    assert.equal(calls, 1, '非超时错误不得触发回退重试');
  });
});

/**
 * 回归保护：应用就绪等待超时后，必须能从不敌时的「瞬时子资源故障」中有界恢复。
 *
 * 事故原型（2026-09-26，main 861cc66d 的 QG Browser E2E）：/accounts 挂在
 * 「spec 未抛出异常」——`locator('#app')` 15000ms 内从未变为可见，且诊断里
 * `34 × locator resolved` 说明节点一直存在（index.html 的挂载点）却零高度，
 * 也就是 Vue 从未挂载；同一次 run 的产物 consoleErrors 记着
 * `Failed to load resource: net::ERR_NO_BUFFER_SPACE`。
 *
 * #2423 的瞬时重试只包住了「page.goto 自己抛错」那条路径。文档导航成功、
 * 而子资源（模块 chunk / CSS）被 Windows 临时网络缓冲耗尽打断时，goto 不抛错，
 * 应用壳子永远挂不起来 —— 同一个错误码在「导航」上已被认可为可恢复，
 * 在「子资源」上却只能硬红。
 */
describe('FunctionalRunner 应用就绪超时后的有界重载合同', () => {
  const TRANSIENT_CONSOLE_TEXT = 'Failed to load resource: net::ERR_NO_BUFFER_SPACE';
  const TRANSIENT_READY_TIMEOUT = 'page.waitForFunction: Timeout 15000ms exceeded.';

  function createReadyHarness(options = {}) {
    const runner = new FunctionalRunner({ url: 'http://127.0.0.1:5174' });
    const navCalls = [];
    let attempt = 0;
    runner.page = {
      goto: async (url) => {
        navCalls.push(url);
      },
      waitForURL: async () => {
        attempt += 1;
        if (options.onAttempt) options.onAttempt(attempt, runner);
      },
      locator: () => ({ waitFor: async () => {} }),
      waitForFunction: async () => {
        if (options.readyError) throw options.readyError;
        if (attempt >= (options.succeedFromAttempt ?? Infinity)) return undefined;
        throw new Error(options.readyTimeoutMessage || TRANSIENT_READY_TIMEOUT);
      },
    };
    return { runner, navCalls, attemptOf: () => attempt };
  }

  function transientFailure(errorText = 'net::ERR_NO_BUFFER_SPACE') {
    return { url: 'http://127.0.0.1:5174/src/main.js', errorText, at: Date.now() };
  }

  it('资源失败 + 就绪超时时重载一次并记账 appReadyReload', async () => {
    const { runner, navCalls } = createReadyHarness({
      succeedFromAttempt: 2,
      onAttempt: (n, r) => { if (n === 1) r.resourceFailures.push(transientFailure()); },
    });

    await runner.goto('/accounts');

    assert.deepEqual(navCalls, ['http://127.0.0.1:5174/#/accounts', 'http://127.0.0.1:5174/#/accounts']);
    assert.deepEqual(runner.actions.map((a) => a.kind), ['appReadyReload', 'goto']);
    assert.equal(runner.actions[0].reason, 'net::ERR_NO_BUFFER_SPACE');
  });

  it('没有瞬时资源证据时就绪超时必须原样抛出，不得重载（不得把真故障藏进重试）', async () => {
    const { runner, navCalls } = createReadyHarness({ succeedFromAttempt: Infinity });
    const before = runner.actions.length;

    await assert.rejects(
      () => runner.goto('/accounts'),
      (received) => received instanceof Error && received.message === TRANSIENT_READY_TIMEOUT,
    );

    assert.equal(navCalls.length, 1, '无证据不得重载');
    assert.equal(runner.actions.length, before, '无证据不得记账重载');
  });

  it('非超时的就绪错误即使伴随资源失败也不重载', async () => {
    const realError = new Error('page.waitForFunction: ReferenceError: outlet is undefined');
    const { runner, navCalls } = createReadyHarness({
      readyError: realError,
      onAttempt: (n, r) => { if (n === 1) r.resourceFailures.push(transientFailure()); },
    });

    await assert.rejects(() => runner.goto('/accounts'), (received) => received === realError);
    assert.equal(navCalls.length, 1);
  });

  it('重载预算上限 2 次：耗尽后抛出最后一次超时，且保留最后一次尝试的 console 证据', async () => {
    const { runner, navCalls } = createReadyHarness({
      succeedFromAttempt: Infinity,
      onAttempt: (n, r) => {
        r.resourceFailures.push(transientFailure());
        r.consoleErrors.push({ text: TRANSIENT_CONSOLE_TEXT, at: Date.now() });
      },
    });

    await assert.rejects(
      () => runner.goto('/accounts'),
      (received) => received.message === TRANSIENT_READY_TIMEOUT,
    );

    assert.equal(navCalls.length, 3, '1 次导航 + 2 次重载');
    assert.deepEqual(
      runner.actions.filter((a) => a.kind === 'appReadyReload').map((a) => a.attempt),
      [1, 2],
    );
    assert.equal(
      runner.consoleErrors.filter((e) => e.text === TRANSIENT_CONSOLE_TEXT).length,
      1,
      '末次尝试仍未恢复，其错误证据必须留在清单里',
    );
  });

  it('上一次导航留下的陈旧资源失败不得作为本次重载证据', async () => {
    const { runner, navCalls } = createReadyHarness({ succeedFromAttempt: Infinity });
    runner.resourceFailures.push(transientFailure());

    await assert.rejects(() => runner.goto('/accounts'));
    assert.equal(navCalls.length, 1);
    assert.equal(runner.actions.filter((a) => a.kind === 'appReadyReload').length, 0);
  });

  it('成功恢复后把已恢复的瞬时 console 噪音移出错误清单并留痕，真实错误仍判失败', async () => {
    const { runner } = createReadyHarness({
      succeedFromAttempt: 2,
      onAttempt: (n, r) => {
        if (n > 1) return;
        r.resourceFailures.push(transientFailure());
        r.consoleErrors.push({ text: TRANSIENT_CONSOLE_TEXT, at: Date.now() });
        r.consoleErrors.push({ text: 'TypeError: cannot read x', at: Date.now() });
      },
    });

    await runner.goto('/accounts');

    assert.deepEqual(runner.consoleErrors.map((e) => e.text), ['TypeError: cannot read x']);
    assert.deepEqual(runner.recoveredTransientErrors.map((e) => e.text), [TRANSIENT_CONSOLE_TEXT]);
    assert.equal(await runner.expectNoConsoleError(), false, '真实错误仍须让门禁变红');
  });

  it('瞬时资源故障以外的资源失败不得被移出 console 清单', async () => {
    const { runner } = createReadyHarness({
      succeedFromAttempt: 2,
      onAttempt: (n, r) => {
        if (n > 1) return;
        r.resourceFailures.push(transientFailure());
        r.consoleErrors.push({
          text: 'Failed to load resource: the server responded with a status of 500',
          at: Date.now(),
        });
      },
    });

    await runner.goto('/accounts');

    assert.equal(runner.consoleErrors.length, 1, '非瞬时错误不得被清掉');
    assert.equal(runner.recoveredTransientErrors.length, 0);
  });

  it('runner 自身预算耗尽的错误也要按超时识别（否则重载路径永不触发）', async () => {
    const { runner, navCalls } = createReadyHarness({
      succeedFromAttempt: 2,
      readyTimeoutMessage: '等待应用就绪超时（15000ms）：/accounts',
      onAttempt: (n, r) => { if (n === 1) r.resourceFailures.push(transientFailure()); },
    });

    await runner.goto('/accounts');

    assert.equal(navCalls.length, 2, '预算耗尽同样应触发一次有界重载');
  });

  it('产物必须暴露重载记账与已恢复的瞬时噪音（不得伪造成没发生过）', async () => {
    const { runner } = createReadyHarness({
      succeedFromAttempt: 2,
      onAttempt: (n, r) => {
        if (n > 1) return;
        r.resourceFailures.push(transientFailure());
        r.consoleErrors.push({ text: TRANSIENT_CONSOLE_TEXT, at: Date.now() });
      },
    });

    await runner.goto('/accounts');
    const report = runner.generateReport();

    assert.equal(report.transientRecoveries.length, 1);
    assert.equal(report.transientRecoveries[0].kind, 'appReadyReload');
    assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.recoveredConsoleErrors.map((e) => e.text), [TRANSIENT_CONSOLE_TEXT]);
  });
});

/**
 * 资源失败采集必须真的挂在 page 上：launch() 需要真实浏览器，无法在单测里跑，
 * 因此把挂载逻辑收敛为 attachPageObservers(page)，用假 page 验证注册的事件与采集形状，
 * 并用源码锁保证 launch() 确实走这个方法（而不是另起一套内联监听）。
 */
describe('FunctionalRunner 页面观测挂载合同', () => {
  function createFakePage() {
    const handlers = {};
    return {
      on: (event, fn) => { handlers[event] = fn; },
      handlers,
      emit: (event, ...args) => handlers[event](...args),
    };
  }

  it('注册 console / pageerror / requestfailed 三类监听并采集资源失败', () => {
    const runner = new FunctionalRunner({});
    const page = createFakePage();

    runner.attachPageObservers(page);

    assert.deepEqual(Object.keys(page.handlers).sort(), ['console', 'pageerror', 'requestfailed']);
    page.emit('requestfailed', {
      url: () => 'http://127.0.0.1:5174/node_modules/.vite/deps/chunk.js?v=1',
      failure: () => ({ errorText: 'net::ERR_NO_BUFFER_SPACE' }),
    });
    page.emit('requestfailed', {
      url: () => 'http://127.0.0.1:5174/src/ok.js',
      failure: () => null,
    });
    assert.deepEqual(runner.resourceFailures.map((f) => f.errorText), [
      'net::ERR_NO_BUFFER_SPACE',
      '',
    ]);
    assert.equal(runner.resourceFailures[0].url.includes('chunk.js'), true);
  });

  it('保留既有 console 过滤口径（vite/HMR 噪音不入清单）', () => {
    const runner = new FunctionalRunner({});
    const page = createFakePage();
    runner.attachPageObservers(page);

    page.emit('console', { type: () => 'error', text: () => '[vite] hot updated' });
    page.emit('console', { type: () => 'warning', text: () => 'deprecated' });
    page.emit('console', { type: () => 'error', text: () => 'TypeError: boom' });
    page.emit('pageerror', { message: 'Uncaught ReferenceError: x is not defined' });

    assert.deepEqual(runner.consoleErrors.map((e) => e.text), ['TypeError: boom']);
    assert.deepEqual(runner.pageErrors.map((e) => e.message), ['Uncaught ReferenceError: x is not defined']);
  });

  it('launch 必须复用 attachPageObservers，不得再内联监听', () => {
    const source = require('fs').readFileSync(require.resolve('./functional-runner'), 'utf8');
    const launchBody = source.slice(source.indexOf('async launch()'), source.indexOf('async close()'));

    assert.match(launchBody, /this\.attachPageObservers\(this\.page\)/);
    assert.doesNotMatch(launchBody, /this\.page\.on\(/, '监听应全部收敛到 attachPageObservers');
  });
});
