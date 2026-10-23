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

// ——— 密钥入库防线 ———
//
// 支付凭据（商户私钥 / APIv3 密钥）落在 `deploy/logto/api.env` 里，而 `.gitignore:330` 的 `.env`
// **只匹配名为 `.env` 的文件，匹配不到 `api.env`** —— 2026-10-23 实测它当时确实未被忽略。
// 一旦有人 `git add -A`，私钥就进了仓库。这条锁把"它必须被忽略"变成可执行判据。
test('storefront env 文件必须被 gitignore（防私钥入库）', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const root = path.resolve(__dirname, '../../..');
  // 用 spawnSync 读**显式退出码**，不依赖"有没有抛"：
  //   0 = 命中忽略规则
  //   1 = 未命中（要红）
  //   其它/  null（git 缺失、非 git 仓库）= 判据自身故障，也要红 —— 不能把失明读成通过
  const ignored = (file) => {
    // --no-index 不可省：默认模式下 git 会**跳过已跟踪文件**，于是「模板没被忽略」这条断言
    // 永远不可能失败（模板本来就是 tracked）—— 那是假绿。--no-index 按纯模式匹配判定。
    const r = spawnSync('git', ['check-ignore', '--no-index', '-q', file], { cwd: root, encoding: 'utf8' });
    if (r.error || r.status === null) throw new Error(`git 不可用，无法判定 ${file} 是否被忽略：${r.error && r.error.message}`);
    if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore 异常退出 ${r.status}：${r.stderr}`);
    return r.status === 0;
  };

  assert.equal(ignored('deploy/logto/api.env'), true, 'deploy/logto/api.env 未被忽略 —— 商户私钥会随 git add -A 入库');
  // 编辑器备份同样不能入库（api.env~ / api.env.bak / api.env.swp）
  assert.equal(ignored('deploy/logto/api.env~'), true, '编辑器备份文件未被忽略');
  // 反向锁：模板必须**仍然被跟踪**。只写 `api.env*` 而不取反，会把模板一起忽略掉。
  assert.equal(ignored('deploy/logto/api.env.example'), false, 'api.env.example 被误忽略 —— 模板必须可入库');
});
// 支付凭据已拆到独立模板（deploy/payment/wechat-pay.env.example），与 api.env 分离。
// 但"拆开"不能让接线锁失效：那份模板声明的键，同样必须全部被 compose 透传。
test('deploy/payment/wechat-pay.env.example 的支付键必须与 compose 透传集合相等', () => {
  const PAYMENT_ENV_EXAMPLE = path.join(REPO_ROOT, 'deploy/payment/wechat-pay.env.example');
  assert.equal(fs.existsSync(PAYMENT_ENV_EXAMPLE), true, '支付模板不见了 —— 拆分后必须留下独立模板');

  const declared = paymentKeysFromEnvExample(fs.readFileSync(PAYMENT_ENV_EXAMPLE, 'utf8'));
  const passed = environmentKeysFromCompose(fs.readFileSync(COMPOSE, 'utf8'));

  assert.ok(declared.size >= 10, `前提：模板至少声明 10 个支付键，实测 ${declared.size}`);
  const missing = [...declared].filter((k) => !passed.has(k));
  assert.deepEqual(missing, [], '以下键在模板里声明了，但 compose 没透传 ⇒ 容器读不到');
  // 反方向：compose 不能透传模板里没有的支付键（两份清单漂移同样要红）。
  // 只测一向等于只测一半 —— 模板少一个键时"missing 为空"，假绿。
  const composePaymentKeys = [...passed].filter((k) => k === 'PAYMENT_PROVIDER' || k.startsWith('WECHAT_PAY_'));
  const extra = composePaymentKeys.filter((k) => !declared.has(k));
  assert.deepEqual(extra, [], '以下键 compose 在透传，但支付模板里没声明 ⇒ 两份清单已漂移');
});