const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const { createHarness } = require('./harness');

const harness = createHarness({ successMark: '\u2705', failureMark: '\u274C' });
const t = harness.test;
function eq(a,b){assert.deepStrictEqual(a,b)}

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-cli-'));

// 启动等待上限：CI 上单作业常与 45 个 vitest 文件并发，5s 会假红（2026-10-20 实测）
const BOOT_TIMEOUT_MS = 15000;

function spawnCli(args, keysFile) {
  return spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'publish-api'), ...args], {
    env: { ...process.env, API_KEYS_PATH: path.join(testRoot, keysFile) },
  });
}

async function stopProcess(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  var closed = new Promise(function(resolve) { proc.once('close', resolve); });
  proc.kill();
  await closed;
}

/**
 * 向内核要一个当前空闲的端口。
 *
 * 为什么必须动态取：本文件原先把端口硬编码成 4568 / 4569，而 nx 的
 * `@multi-publish/api-publish-engine:test` 会把 node:test 与 45 个 vitest 文件并发跑；
 * 端口一旦被占，CLI 子进程绑定失败直接退出，`waitForPort` 只会等到超时，
 * 于是报「Timed out waiting for port 4568」而不是「端口被占」——红文案也指错了方向。
 * 2026-10-20 main push 的 `QG Unit Tests` 就红在这一条（同一 job 里 vitest 部分 495 例全过）。
 */
function pickFreePort() {
  return new Promise(function(resolve, reject) {
    var srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', function() {
      var port = srv.address().port;
      srv.close(function() { resolve(port); });
    });
  });
}

/**
 * 轮询 /api/v1/health 直到拿到 JSON。
 * 失败时把子进程 stderr 拼进错误里——否则「端口被占」与「服务起得慢」从外面看不出区别。
 */
function waitForPort(port, timeout, getStderr) {
  return new Promise(function(resolve, reject) {
    var deadline = Date.now() + timeout;
    var lastErr = null;
    function check() {
      var req = http.get('http://127.0.0.1:' + port + '/api/v1/health', function(res) {
        var body = '';
        res.on('data', function(c) { body += c; });
        res.on('end', function() {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('health 返回非 JSON（port ' + port + '）：' + body.slice(0, 200))); }
        });
      });
      req.on('error', function(e) {
        lastErr = e;
        if (Date.now() < deadline) setTimeout(check, 200);
        else {
          var detail = (typeof getStderr === 'function' ? getStderr() : '') || '';
          reject(new Error(
            'Timed out waiting for port ' + port + ' after ' + timeout + 'ms'
            + ' (last error: ' + (lastErr && lastErr.message) + ')'
            + (detail ? '\n--- child stderr ---\n' + detail.trim().slice(-800) : '')
          ));
        }
      });
      req.end();
    }
    check();
  });
}

/** 采集子进程 stderr，供失败诊断使用 */
function collectStderr(proc) {
  var buf = '';
  proc.stderr.on('data', function(d) { buf += d; });
  return function() { return buf; };
}

console.log('--- CLI file ---');
t('bin/publish-api exists',()=>{eq(fs.existsSync(path.join(__dirname,'..','bin','publish-api')),true)});

console.log('\n--- CLI --help ---');
t('--help exits 0', async function() {
  var proc = spawnCli(['--help'], 'help-api-keys.json');
  var out = ''; var err = '';
  proc.stdout.on('data',function(d){out+=d});
  proc.stderr.on('data',function(d){err+=d});
  // 给足启动时间：CI 上同一 job 有 45 个 vitest 文件并发，3s 会假红（实测 code=-1）
  var code = await new Promise(function(r){proc.on('close',r);setTimeout(function(){proc.kill();r(-1)},BOOT_TIMEOUT_MS)});
  eq(code,0);
  eq(out.includes('publish-api'),true);
  // 只要求「没有真实报错」，不要求 stderr 逐字节为空。
  // 原因：nx 会把 FORCE_COLOR 与 NO_COLOR 同时注入子进程，Node 于是往 **stderr** 打
  // `Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`。
  // 这条是环境噪音，不是 CLI 的问题；旧断言 `eq(err,'')` 因此只在 nx target 内红
  // （单跑绿、包级红），2026-10-20 的 main push 即栽在这里。
  eq(stripBenignNodeWarnings(err), '');
});

/**
 * 剔除 Node 的「NO_COLOR 被 FORCE_COLOR 覆盖」类环境警告。
 * 只剔除**已点名**的形态，其余 stderr 一律保留并被断言看见——
 * 不能整段忽略 stderr，否则真报错会被一起吞掉（本仓 QM-1 第②层同一教训）。
 */
function stripBenignNodeWarnings(text) {
  return String(text)
    .split('\n')
    .filter(function(line) {
      if (!line.trim()) return false;
      if (/NO_COLOR' env is ignored due to the 'FORCE_COLOR'/.test(line)) return false;
      if (/Use `node --trace-warnings/.test(line)) return false;
      return true;
    })
    .join('\n');
}

console.log('\n--- CLI start/stop ---');
t('starts server and responds to health', async function() {
  var port = await pickFreePort();
  var proc = spawnCli(['--port', String(port), '--dry-run'], 'health-api-keys.json');
  var stderrOf = collectStderr(proc);
  try {
    var body = await waitForPort(port, BOOT_TIMEOUT_MS, stderrOf);
    eq(body.status,'ok');
  } finally {
    await stopProcess(proc);
  }
});

t('uses custom port', async function() {
  // 刻意与上一条用**不同**的空闲端口：两条用例各自独立，任一条残留进程都不会影响另一条
  var port = await pickFreePort();
  var proc = spawnCli(['--port', String(port), '--dry-run'], 'custom-port-api-keys.json');
  var stderrOf = collectStderr(proc);
  try {
    var body = await waitForPort(port, BOOT_TIMEOUT_MS, stderrOf);
    eq(body.status,'ok');
  } finally {
    await stopProcess(proc);
  }
});

t('pickFreePort 返回可用的动态端口（不复用固定端口）', async function() {
  var a = await pickFreePort();
  var b = await pickFreePort();
  eq(Number.isInteger(a) && a > 1024, true);
  eq(Number.isInteger(b) && b > 1024, true);
  // 不得退回固定端口族（4568/4569 是历史上撞端口的那一对）
  eq(a === 4568 || a === 4569, false);
  eq(b === 4568 || b === 4569, false);
});

// 防回归锁：源码里不允许再出现「'--port' 后面跟 4 位固定端口」这种写法。
// 判据刻意用行扫描而不是正则字面量，避免把本锁自身的文本也算进命中。
t('cli.test.js 不再硬编码端口（防复现 2026-10-20 的 flake）', function() {
  var src = fs.readFileSync(__filename, 'utf8');
  var offenders = src.split('\n').filter(function(line) {
    var mentionsFlag = line.indexOf("'--port'") !== -1;
    var hasFixedPort = /\b4\d{3}\b/.test(line);
    return mentionsFlag && hasFixedPort;
  });
  eq(offenders, []);
  eq(src.indexOf('pickFreePort') !== -1, true);
});

harness.run().finally(function() {
  fs.rmSync(testRoot, { recursive: true, force: true });
});
