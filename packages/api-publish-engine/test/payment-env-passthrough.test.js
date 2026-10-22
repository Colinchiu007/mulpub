/**
 * 接线锁：`.env.example` 里声明的支付环境变量，必须都被 `docker-compose.yml` 透传进容器。
 *
 * 为什么需要这条锁（2026-10-22 实测）：
 * `docker-compose.yml` 当时传了 20+ 个环境变量，**唯独一个支付变量都没有**。
 * 容器里 `PAYMENT_PROVIDER` 读不到 ⇒ `production-config` 退回 `none`
 * ⇒ `POST /api/v1/me/checkout` 恒返回 503 `PAYMENT_PROVIDER_UNAVAILABLE`
 * ⇒ **前端永远显示「支付通道暂未开放」，用户在宿主机 `.env` 里写什么都没用**。
 *
 * 这个缺口的特点是「配置齐全也会失败」：运维会以为自己配好了，而现象是前端功能不存在。
 * 它不会被任何单元测试抓到（代码是对的），也不会被 `validate-production-config` 抓到
 * （那个校验跑在容器里，读的也是空的）—— 只有跨文件的「声明 vs 透传」比对能提前拦住。
 *
 * 锁的判据刻意是**集合相等**而不是「至少包含」：
 * compose 里多传一个 `.env.example` 没声明的支付变量，说明两份清单开始漂移，也要红。
 *
 * ⚠️ 本锁的**作用域边界**（避免被过度解读）：
 *   - 它比对的是「两份文件声明的键名是否一致」，**不校验运行时的值**。
 *     `.env` 里漏写某个键时本锁仍是绿的 —— 那是 `production-config` 的职责（它按值校验）。
 *   - 它不解析 YAML，只按行匹配 `- KEY=...` 这种 compose `environment` 列表写法。
 *     若将来改成 flow 风格（`- {KEY: v}`）或 `env_file:`，本锁会因解析不到而红（前提断言先拦），
 *     届时需要同步改解析，**不要放宽成「匹配不到就跳过」**。
 *
 * ⚠️ CI 在册性（别把它当孤儿文件）：`scripts/run-tests.js:82` 用
 * `fs.readdirSync(test).filter(f => f.endsWith('.test.js'))` 枚举本目录，本文件不在
 * `VITEST_FILES` 白名单内 ⇒ 由 `node --test` 执行。改动本目录的文件名后缀会让它静默掉出执行面。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');
const COMPOSE = path.join(REPO_ROOT, 'packages/api-publish-engine/docker-compose.yml');

/** `.env.example` 中属于支付的变量名（PAYMENT_PROVIDER + WECHAT_PAY_*）。 */
function paymentKeysFromEnvExample (text) {
  const keys = new Set();
  for (const line of String(text).split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (key === 'PAYMENT_PROVIDER' || key.startsWith('WECHAT_PAY_')) keys.add(key);
  }
  return keys;
}

/** compose `environment:` 列表里 `KEY=${KEY:-...}` 形式的键名。 */
function environmentKeysFromCompose (text) {
  const keys = new Set();
  for (const line of String(text).split('\n')) {
    const m = /^\s*-\s*([A-Z0-9_]+)=/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

test('支付环境变量必须被 docker-compose 透传进容器', async (t) => {
  const envText = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  const composeText = fs.readFileSync(COMPOSE, 'utf8');
  const declared = paymentKeysFromEnvExample(envText);
  const passed = environmentKeysFromCompose(composeText);

  await t.test('前提：两份文件都真的解析出了支付变量（防止正则失配导致空集合恒绿）', () => {
    assert.ok(declared.size >= 7, `.env.example 应至少解析出 7 个支付变量，实际 ${declared.size}`);
    assert.ok(passed.size >= 7, `compose 应至少解析出 7 个环境变量，实际 ${passed.size}`);
    assert.ok(declared.has('PAYMENT_PROVIDER'), '.env.example 必须含 PAYMENT_PROVIDER');
    assert.ok(declared.has('WECHAT_PAY_MCH_ID'), '.env.example 必须含 WECHAT_PAY_MCH_ID');
  });

  await t.test('`docker-compose.yml` 必须透传 `.env.example` 里的每一个支付变量', () => {
    const missing = [...declared].filter((k) => !passed.has(k)).sort();
    assert.deepEqual(missing, [],
      '这些变量在 .env.example 里声明了但 compose 没传 ⇒ 容器读不到 ⇒ 前端恒 503：' + missing.join(', '));
  });

  await t.test('compose 里不得出现 `.env.example` 未声明的支付变量（两份清单不许漂移）', () => {
    const extra = [...passed].filter((k) => (k === 'PAYMENT_PROVIDER' || k.startsWith('WECHAT_PAY_')) && !declared.has(k)).sort();
    assert.deepEqual(extra, [],
      'compose 多传了 .env.example 没声明的支付变量 ⇒ 两份清单已漂移：' + extra.join(', '));
  });

  await t.test('支付变量一律用 `:-` 默认，不得用 `:?` 必填（否则没配支付的环境直接起不来）', () => {
    const offenders = [];
    for (const line of composeText.split('\n')) {
      const m = /^\s*-\s*([A-Z0-9_]+)=\$\{([A-Z0-9_]+)(:[-?])([^}]*)\}/.exec(line);
      if (!m) continue;
      const [, key, , op] = m;
      if (key !== 'PAYMENT_PROVIDER' && !key.startsWith('WECHAT_PAY_')) continue;
      if (op === ':?') offenders.push(key);
    }
    assert.deepEqual(offenders, [],
      '支付是可选能力：没配时必须照常启动并保持入口 fail-closed，不能因为缺支付变量把整个服务卡死：' + offenders.join(', '));
  });
});
