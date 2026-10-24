// 回归锁：scripts/lib/pr-checks.js —— PR 侧 CI 检查的**取数器**（两个合并入口共用的唯一真源）
// 动因（2026-10-24 实测）：`gh pr checks --json` 是后加的 flag，老 gh（实测 2.46.0）不认
//   ⇒ `unknown flag: --json` ⇒ 合并脚本把取数失败回落成「0 条检查」⇒ break 条件永不满足
//   ⇒ 在「CI 其实早就全绿」的状态下**空转到 120 分钟超时**，日志却一直打「runner 可能离线」。
// 本文件锁住三件事：
//   ① 状态映射落在真 gh 的同一取值域（降级路径与原生路径的判定不得分叉）；
//   ② 同名多次 run 取**最新**（与真 gh 的 rollup 语义一致，不取「最严」）；
//   ③ **取数失败与「真的没有检查」必须是两个值**（失败 ⇒ ok=false，绝不回落成空数组当成功）。
// 本文件用 node --test 跑，必须被 quality-gate.yml 的 changes job 显式点名（否则等于没写），
// 且只能 require node 内置模块（该 job 没有 Install deps，引第三方包当场 MODULE_NOT_FOUND）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mod = require('./pr-checks.js');

// ---------------------------------------------------------------- 状态映射
test('conclusion → 真 gh 的 state：逐个取值都要落在真 gh 的取值域里', () => {
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'success' }), 'SUCCESS');
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'failure' }), 'FAILURE');
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'cancelled' }), 'CANCELLED');
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'timed_out' }), 'TIMED_OUT');
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'skipped' }), 'SKIPPED');
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'neutral' }), 'NEUTRAL');
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'action_required' }), 'ACTION_REQUIRED');
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'stale' }), 'STALE');
  // 未完成态
  assert.equal(mod.mapCheckRunToState({ status: 'queued' }), 'QUEUED');
  assert.equal(mod.mapCheckRunToState({ status: 'in_progress' }), 'IN_PROGRESS');
});

test('未知 conclusion / 空 conclusion 归 ERROR（失败档），不得落进「既非未完成也非失败」的空洞', () => {
  // ⚠️ 这条是安全边界：未知值若落进空洞 ⇒ 合并脚本会当成「已完成且没红」⇒ **放行坏 PR**。
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: 'weird_new_value' }), 'ERROR');
  assert.equal(mod.mapCheckRunToState({ status: 'completed', conclusion: '' }), 'ERROR');
  assert.equal(mod.mapCheckRunToState({ status: 'completed' }), 'ERROR');
  assert.ok(mod.FAILED_STATES.has(mod.mapCheckRunToState({ status: 'completed', conclusion: 'weird_new_value' })));
});

test('未知 status 归未完成档（宁可多等一轮，不可把未跑完的当跑完）', () => {
  assert.ok(mod.INCOMPLETE_STATES.has(mod.mapCheckRunToState({ status: 'brand_new_status' })));
  assert.ok(mod.INCOMPLETE_STATES.has(mod.mapCheckRunToState({ status: 'queued' })));
  assert.ok(mod.INCOMPLETE_STATES.has(mod.mapCheckRunToState({ status: 'in_progress' })));
});

// ---------------------------------------------------------------- 同名取最新
test('同名多次 run 取最新一次（不是最严）——先红后绿的重跑不得让脚本永远判红', () => {
  const rows = [
    { name: 'QG Changes', status: 'completed', conclusion: 'failure', started_at: '2026-10-24T10:00:00Z', id: 1 },
    { name: 'QG Changes', status: 'completed', conclusion: 'success', started_at: '2026-10-24T10:05:00Z', id: 2 },
  ];
  const picked = mod.pickLatestPerName(rows);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].state, 'SUCCESS', '必须取最新那次（绿），不是最严那次（红）');
});

test('started_at 相同则取 id 大的那次', () => {
  const rows = [
    { name: 'X', status: 'completed', conclusion: 'failure', started_at: '2026-10-24T10:00:00Z', id: 7 },
    { name: 'X', status: 'completed', conclusion: 'success', started_at: '2026-10-24T10:00:00Z', id: 9 },
  ];
  assert.equal(mod.pickLatestPerName(rows)[0].state, 'SUCCESS');
});

test('无名行被跳过（不产出无名状态行）', () => {
  const picked = mod.pickLatestPerName([
    { name: '  ', status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'success' },
    { name: 'Keep', status: 'completed', conclusion: 'success' },
  ]);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].name, 'Keep');
});

test('空输入 ⇒ 空输出（不抛）', () => {
  assert.deepEqual(mod.pickLatestPerName([]), []);
  assert.deepEqual(mod.pickLatestPerName(null), []);
});

// ---------------------------------------------------------------- 降级识别
test('只把「flag 不认」当版本问题；网络/权限错误不降级', () => {
  assert.equal(mod.isJsonFlagUnsupported('unknown flag: --json'), true);
  assert.equal(mod.isJsonFlagUnsupported('Unknown option --json'), true);
  assert.equal(mod.isJsonFlagUnsupported('flag provided but not defined: --json'), true);
  // ⚠️ 这些**不是**版本问题：降级会把「网络抖动」误当成「版本不够」而走上另一条取数路。
  assert.equal(mod.isJsonFlagUnsupported('error connecting to api.github.com'), false);
  assert.equal(mod.isJsonFlagUnsupported('HTTP 403: Resource not accessible'), false);
  assert.equal(mod.isJsonFlagUnsupported(''), false);
});

// ---------------------------------------------------------------- 取数主流程
function runnerOf (handlers) {
  return (args) => {
    const key = args.join(' ');
    for (const [pattern, res] of handlers) {
      if (key.includes(pattern)) return res;
    }
    return { status: 1, stdout: '', stderr: 'no handler for ' + key };
  };
}

test('原生路径可用 ⇒ 直接用 gh pr checks 的行（不降级）', () => {
  const res = mod.collectPrChecks({
    pr: 1,
    run: runnerOf([
      ['pr checks', { status: 0, stdout: '[{"name":"A","state":"SUCCESS"},{"name":"B","state":"PENDING"}]', stderr: '' }],
    ]),
  });
  assert.equal(res.ok, true);
  assert.equal(res.via, 'gh-pr-checks');
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[1].state, 'PENDING');
});

test('★ 取数失败与「真的没有检查」必须是两个值：失败 ⇒ ok=false（绝不回落成空数组当成功）', () => {
  // 模拟网络故障（**不是** flag 不认）⇒ 不得降级、不得当成 0 条
  const res = mod.collectPrChecks({
    pr: 1,
    run: runnerOf([
      ['pr checks', { status: 1, stdout: '', stderr: 'error connecting to api.github.com' }],
    ]),
  });
  assert.equal(res.ok, false, '取数失败必须 ok=false');
  assert.ok(res.error && res.error.includes('不降级'), '应说明「不是 --json 不被支持的问题」');
  // 真的没有检查 ⇒ ok=true 且 rows 为空
  const empty = mod.collectPrChecks({
    pr: 1,
    run: runnerOf([
      ['pr checks', { status: 0, stdout: '[]', stderr: '' }],
    ]),
  });
  assert.equal(empty.ok, true, '「没有检查」是合法状态，不是失败');
  assert.deepEqual(empty.rows, []);
});

test('老 gh（unknown flag）⇒ 降级到 check-runs，且同名取最新', () => {
  const res = mod.collectPrChecks({
    pr: 7,
    repo: 'o/r',
    run: runnerOf([
      ['pr checks', { status: 1, stdout: '', stderr: 'unknown flag: --json' }],
      ['pr view', { status: 0, stdout: 'abc123', stderr: '' }],
      ['check-runs', { status: 0, stdout: [
        '{"name":"A","status":"completed","conclusion":"failure","started_at":"2026-10-24T10:00:00Z","id":1}',
        '{"name":"A","status":"completed","conclusion":"success","started_at":"2026-10-24T11:00:00Z","id":2}',
        '{"name":"B","status":"queued","conclusion":null,"started_at":"2026-10-24T11:00:00Z","id":3}',
      ].join('\n'), stderr: '' }],
    ]),
  });
  assert.equal(res.ok, true);
  assert.equal(res.via, 'check-runs');
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows.find((r) => r.name === 'A').state, 'SUCCESS');
  assert.equal(res.rows.find((r) => r.name === 'B').state, 'QUEUED');
});

test('降级路径缺 slug ⇒ 明确失败（不得去猜仓库）', () => {
  const res = mod.collectPrChecks({
    pr: 7,
    run: runnerOf([
      ['pr checks', { status: 1, stdout: '', stderr: 'unknown flag: --json' }],
      ['pr view', { status: 0, stdout: 'abc123', stderr: '' }],
    ]),
  });
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('slug'));
});

test('降级路径的 check-runs 输出解析不了 ⇒ 明确失败（不回落成 0 条）', () => {
  const res = mod.collectPrChecks({
    pr: 7,
    repo: 'o/r',
    run: runnerOf([
      ['pr checks', { status: 1, stdout: '', stderr: 'unknown flag: --json' }],
      ['pr view', { status: 0, stdout: 'abc123', stderr: '' }],
      ['check-runs', { status: 0, stdout: 'not json at all', stderr: '' }],
    ]),
  });
  assert.equal(res.ok, false);
});

// ---------------------------------------------------------------- REST 输出的包装形态
// ⚠️ 这三条是**实测踩出来的**：单测最初用「逐行一个对象」的 fixture，
//    而真实 REST/CLI 输出是**带包装层**的 ⇒ 解析器漏剥包装层 ⇒ 得到「0 行」的空结果
//    ⇒ **静默假绿**（读起来像「没有 CI 检查」）。fixture 必须照抄真接口的输出形态。
test('REST 包装形态①：{total_count, check_runs:[...]} ⇒ 剥出真行', () => {
  const rows = mod.parseCheckRunsOutput(JSON.stringify({
    total_count: 2,
    check_runs: [
      { name: 'A', status: 'completed', conclusion: 'success' },
      { name: 'B', status: 'queued', conclusion: null },
    ],
  }));
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'A');
});

test('REST 包装形态②：包装对象被套在数组里（实测某 CLI 的分页实现）⇒ 仍要剥出真行', () => {
  const rows = mod.parseCheckRunsOutput(JSON.stringify([{
    total_count: 2,
    check_runs: [
      { name: 'A', status: 'completed', conclusion: 'success' },
      { name: 'B', status: 'queued', conclusion: null },
    ],
  }]));
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 2, '剥不掉包装层就会得到 0 行（静默假绿）');
  assert.equal(rows[0].name, 'A');
});

test('REST 包装形态③：每页一个数组直接拼接 ⇒ 逐页剥出真行', () => {
  const rows = mod.parseCheckRunsOutput('[{"name":"A","status":"completed","conclusion":"success"}][{"name":"B","status":"queued","conclusion":null}]');
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].name, 'B');
});

test('REST 包装形态④：逐行一个对象 ⇒ 原样认出', () => {
  const rows = mod.parseCheckRunsOutput('{"name":"A","status":"completed","conclusion":"success"}\n{"name":"B","status":"queued","conclusion":null}');
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 2);
});

test('REST 输出解析不了 ⇒ null（**不等于**「没有检查」）', () => {
  assert.equal(mod.parseCheckRunsOutput('not json at all'), null);
  // ⚠️ 数组比**内容**不用 equal（strict 模式下 equal 比引用 ⇒ 数组必假红）
  assert.deepStrictEqual(mod.parseCheckRunsOutput(''), []);
});

// ---------------------------------------------------------------- CLI 出口
// ⚠️ 这两条用**显式注入点**（`main(argv, {run})`）而不是 mock `require('child_process').spawnSync`：
//   `spawnSync` 在 pr-checks.js 的**加载期**就被解构绑定 ⇒ 事后改 `require('child_process').spawnSync`
//   永远追不上（绑定早已固化）⇒ 那种 mock 会给出「碰巧对」的结果，测的不是想测的东西。
test('CLI：取数失败 ⇒ rc≠0 且 stderr 明说「这不是没有检查」', () => {
  const errs = [];
  const prevWrite = process.stderr.write;
  process.stderr.write = (c) => { errs.push(String(c)); return true; };
  let rc;
  try {
    rc = mod.main(['--pr', '1', '--repo', 'o/r'], {
      run: () => ({ status: 1, stdout: '', stderr: 'error connecting to api.github.com' }),
    });
  } finally { process.stderr.write = prevWrite; }
  assert.notEqual(rc, 0, '取数失败必须非 0 退出');
  const text = errs.join('');
  assert.ok(text.includes('取数失败'), 'stderr 须说明取数失败');
  assert.ok(text.includes('不是'), 'stderr 须明说「这不是没有 CI 检查」');
});

test('CLI：正常路径 ⇒ stdout 是 JSON 数组且 rc=0', () => {
  const chunks = [];
  const errs = [];
  const prevWrite = process.stdout.write;
  const prevErr = process.stderr.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  process.stderr.write = (c) => { errs.push(String(c)); return true; };
  let rc;
  try {
    rc = mod.main(['--pr', '1'], {
      run: (args) => (args[0] === 'pr' && args[1] === 'checks')
        ? { status: 0, stdout: '[{"name":"A","state":"SUCCESS"}]', stderr: '' }
        : { status: 1, stdout: '', stderr: 'unexpected' },
    });
  } finally { process.stdout.write = prevWrite; process.stderr.write = prevErr; }
  assert.equal(rc, 0);
  const parsed = JSON.parse(chunks.join('').trim());
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].name, 'A');
  assert.equal(parsed[0].state, 'SUCCESS');
});
