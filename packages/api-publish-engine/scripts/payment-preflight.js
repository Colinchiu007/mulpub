#!/usr/bin/env node
'use strict';

/**
 * 支付上线预检：把「配置对不对」从猜变成一条命令。
 *
 * ## 为什么需要它
 *
 * 2026-10-22/23 实测，支付"配了却不能用"有两类缺口，**都不会在启动时报错**：
 *   ① `docker-compose.yml` 没透传 → 容器里读到空 → 按 `PAYMENT_PROVIDER=none` 处理 → 前端恒 503；
 *   ② `WeChatNativeProvider` 从未被构造 → provider 恒 null → 前端恒 503。
 * 两者都表现为「前端功能不存在」，而 `validate-production-config` 只查环境变量的**存在性**，
 * 既不验凭据能不能解析，也不验装配能不能成功、迁移有没有应用。
 *
 * 本命令把四件事一次全查：
 *   1. 环境变量（复用 `validateProductionConfig` 的 PAYMENT_* 结论）
 *   2. 商户私钥 / 平台公钥**能被 crypto 解析**（不是只看非空）
 *   3. **provider 真的能被构造出来**（这条直接对应缺口 ②）
 *   4. 数据库 schema 就绪（`identity_payment_customers` 等；对应「不迁移则整站不可用」）
 *
 * ⛔ 它不访问微信服务器：本命令证明的是「我们这边准备好了」，不证明「微信会接受」。
 *    后者只能靠真机 E2E（PRD §11.4）。
 *
 * 用法：
 *   node packages/api-publish-engine/scripts/payment-preflight.js
 *   node packages/api-publish-engine/scripts/payment-preflight.js --skip-db
 *   node packages/api-publish-engine/scripts/payment-preflight.js --json
 */

const { validateProductionConfig } = require('../src/auth/production-config');
const { createWeChatNativeProvider } = require('../src/auth/payment-providers/wechat-native-factory');

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

// 只要这些变量里**任意一个**有值，就说明有人填过支付配置。
// 用来识别「凭据填了但开关是 none」这种半配置（最常见成因：漏了第二个 --env-file）。
const PAYMENT_SECRET_KEYS = [
  'WECHAT_PAY_APPID',
  'WECHAT_PAY_MCH_ID',
  'WECHAT_PAY_API_V3_KEY',
  'WECHAT_PAY_CERT_SERIAL_NO',
  'WECHAT_PAY_CERT_PATH',
  'WECHAT_PAY_CERT_CONTENT',
  'WECHAT_PAY_PLATFORM_PUBLIC_KEY',
  'WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH',
  'WECHAT_PAY_PUBLIC_KEY_ID',
  'WECHAT_PAY_NOTIFY_URL',
];

function parseArgs (argv = process.argv.slice(2)) {
  const result = { json: false, skipDb: false, databaseUrl: null, help: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') result.json = true;
    else if (arg === '--skip-db') result.skipDb = true;
    else if (arg === '--database-url') {
      // 值不能是另一个 flag：--database-url --json 若照收，会把 '--json' 当连接串，
      // 后续建连接失败 ⇒ 退出码 2，而操作者以为自己在要 JSON 输出。
      const next = argv[i + 1];
      if (!next || String(next).startsWith('-')) result.error = 'PAYMENT_PREFLIGHT_ARGUMENT_INVALID: --database-url 缺少取值';
      else result.databaseUrl = argv[++i];
    }
    else if (arg === '--help' || arg === '-h') result.help = true;
    else result.error = 'PAYMENT_PREFLIGHT_ARGUMENT_INVALID: ' + arg;
  }
  return result;
}

/**
 * 跑完全部检查，返回结构化结果（**纯逻辑，不读 process.env、不建连接**，便于单测）。
 *
 * @param {object} options
 * @param {object} options.env 环境变量
 * @param {object} [options.deps] 注入：readFile / createRepository / validate
 * @param {boolean} [options.skipDb]
 * @param {string} [options.databaseUrl]
 * @returns {Promise<{ok:boolean, checks:Array<{id:string,status:string,detail:string}>}>}
 */
async function runPreflight (options = {}) {
  const env = options.env || {};
  const deps = options.deps || {};
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  // 1) provider 种类
  const kind = String(env.PAYMENT_PROVIDER || 'none').trim().toLowerCase();
  if (kind === 'none') {
    // ⛔ 半配置检测：凭据填了、开关却是 none。
    // 最典型的成因是**漏了第二个 --env-file**（微信支付凭据在 deploy/payment/wechat-pay.env，
    // 与 deploy/logto/api.env 分开）。若这里只报 SKIP，操作者会看到"通过"，
    // 而前端其实是「支付通道暂未开放」—— 这正是拆分 env 文件后最容易踩的坑。
    const strayKeys = PAYMENT_SECRET_KEYS.filter((key) => String(env[key] || '').trim());
    if (strayKeys.length) {
      add('provider-kind', FAIL,
        `检测到 ${strayKeys.length} 个支付变量（${strayKeys.join(', ')}）但 PAYMENT_PROVIDER=none —— ` +
        '多半是漏了第二个 --env-file（deploy/payment/wechat-pay.env），' +
        '或填了凭据却忘了把 none 改成 wechat_native');
      add('database', SKIP, '支付未启用，未检查迁移');
      return { ok: false, checks };
    }
    add('provider-kind', SKIP, 'PAYMENT_PROVIDER=none —— 支付入口处于关闭状态（fail-closed）。' +
      '要启用请设 wechat_native 后重跑本命令');
    // 即使支付关闭也要显式留一行：否则结果里完全没有 database 项，
    // 操作者会以为「查过了」，而实际上是根本没走到。
    add('database', SKIP, '支付未启用，未检查迁移');
    return { ok: true, checks };
  }
  if (kind !== 'wechat_native') {
    add('provider-kind', FAIL, `PAYMENT_PROVIDER=${kind} 非法，只接受 none / wechat_native`);
    return { ok: false, checks };
  }
  add('provider-kind', PASS, 'PAYMENT_PROVIDER=wechat_native');

  // 2) 环境变量（只看 PAYMENT_*，其它必填项由 validate-production-config 负责）
  const validate = deps.validate || validateProductionConfig;
  const validation = validate(env, { phase: 'shadow' });
  const paymentErrors = (validation.errors || []).filter((e) => /PAYMENT/.test(String(e.code)));
  if (paymentErrors.length) {
    const detail = paymentErrors.map((e) => `${e.code}(${e.variable || '?'})`).join(', ');
    add('env', FAIL, `支付环境变量有 ${paymentErrors.length} 个问题：${detail}`);
  } else {
    add('env', PASS, '支付相关环境变量齐全且形状合法');
  }

  // 3) 凭据能不能解析 + 4) provider 能不能构造 —— 一次构造同时验两件事
  const factory = deps.createProvider || createWeChatNativeProvider;
  let provider = null;
  try {
    provider = factory(env);
    add('credentials', PASS, '商户私钥与平台公钥均可解析（crypto.createPrivateKey / createPublicKey 通过）');
    add('provider', PASS, 'provider 已成功构造（/me/checkout 不会再因 provider=null 返回 503）');
  } catch (error) {
    const code = (error && error.code) || 'UNKNOWN';
    // code 未必带 CERT（Node crypto 的原生错误通常没有 code）：再用 message 兜一层，
    // 否则「PEM 粘错」会被报成 provider 装配失败，把人引去查装配而不是查密钥。
    const looksLikeCert = /CERT/.test(code) || /key|cert|crypto|pem|asn1|decoder|der routines|unsupported|wrong tag|no start line/i.test(String((error && error.message) || ''));
    if (looksLikeCert) {
      add('credentials', FAIL, `${code}: ${(error && error.message) || error}`);
      add('provider', SKIP, '凭据不合法，未继续构造');
    } else {
      add('credentials', SKIP, '未单独判定（构造在凭据校验之前失败）');
      add('provider', FAIL, `${code}: ${(error && error.message) || error}`);
    }
  }

  // 5) 数据库 schema
  if (options.skipDb) {
    add('database', SKIP, '--skip-db：未检查迁移（上线前必须查一次）');
  } else {
    const databaseUrl = options.databaseUrl || env.BUSINESS_DATABASE_URL;
    if (!databaseUrl) {
      add('database', SKIP, '未提供 BUSINESS_DATABASE_URL / --database-url，跳过迁移检查');
    } else if (typeof deps.createRepository !== 'function') {
      add('database', SKIP, '注入的 deps 未提供 createRepository，跳过迁移检查');
    } else {
      const repo = deps.createRepository(databaseUrl);
      try {
        await repo.assertReady();
        add('database', PASS, 'schema 就绪（identity_payment_customers 等必需关系都在）');
      } catch (error) {
        add('database', FAIL, `${(error && error.code) || 'DB_NOT_READY'}: ${(error && error.message) || error}` +
          ' —— 先跑 scripts/migrate-postgres.js（见 PRD §15.1）');
      } finally {
        // ⛔ 必须 try/catch 而不是 .catch()：close() 若**同步**抛错，.catch 还没挂上就炸了，
        //    异常会顶掉刚算出来的 database 结论 ⇒ 操作者看到退出码 2、看不到「迁移有没有过」。
        if (typeof repo.close === 'function') {
          try { await repo.close(); } catch (_) { /* 关闭失败不该改写检查结论 */ }
        }
      }
    }
  }

  return { ok: checks.every((c) => c.status !== FAIL), checks };
}

function formatText (result) {
  const lines = ['=== 支付上线预检 ==='];
  for (const check of result.checks) {
    lines.push(`[${check.status}] ${check.id.padEnd(12)} ${check.detail}`);
  }
  lines.push(result.ok
    ? '✅ 本机配置就绪。注意：这只证明「我们这边准备好了」，不证明微信会接受 —— 仍需真机 E2E（PRD §11.4）'
    : '❌ 有失败项，先按上面的提示修完再上线');
  return lines.join('\n');
}

async function main (argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('用法: payment-preflight [--json] [--skip-db] [--database-url URL]');
    return 0;
  }
  if (args.error) {
    console.error(args.error);
    return 2;
  }
  const createRepository = deps.createRepository
    || ((url) => new (require('../src/auth/postgres-identity-repository').PostgresIdentityRepository)({ connectionString: url, production: true }));
  const result = await runPreflight({
    env: deps.env || process.env,
    deps: { ...deps, createRepository },
    skipDb: args.skipDb,
    databaseUrl: args.databaseUrl,
  });
  console.log(args.json ? JSON.stringify(result, null, 2) : formatText(result));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error('PAYMENT_PREFLIGHT_FAILED: ' + ((error && error.message) || error));
    process.exitCode = 2;
  });
}

module.exports = { FAIL, PASS, SKIP, formatText, main, parseArgs, runPreflight };
