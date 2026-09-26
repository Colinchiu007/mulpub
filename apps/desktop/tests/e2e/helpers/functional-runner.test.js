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
