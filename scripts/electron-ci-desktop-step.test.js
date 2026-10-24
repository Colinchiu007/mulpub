/**
 * `scripts/electron-ci-desktop-step.js` 的回归锁 —— electron-ci 桌面全量步骤的「一步内两片并行 + 单一共享预算
 * + 超时现场计数」实现。
 *
 * 动因（2026-10-21 实测，全部为现取读数，不是推断；复测入口 `node scripts/electron-ci-shard-audit.js`）：
 * - `electron-ci.yml` 的 `Unit tests (Vitest…)` 步骤在 **main push 最近 12 趟里 8 趟非绿**，且逐趟
 *   下作业日志核对后 **8/8 都是预算墙**（`rc=124` 命中 1 次、`TIMEOUT_BUDGET_EXCEEDED` 命中 2 次、
 *   **断言红=0**）。成功趟作业墙钟 1511/1542/1820/1934s，红趟 2177–2215s ⇒ 贴脸逼近 2100s 步骤预算。
 * - 同一次失败趟还打印 `已完成测试行数: 0`，而日志里明明有上万行 ` ✓ …` —— 那是一处**计数器失明**：
 *   vitest 的行首是 ANSI 颜色序列（`od -c` 实测 `033[32m✓033[39m ␣electron/…`），Actions 日志还要再剥
 *   每行的时间戳前缀，而旧计数的锚是 `^[[:space:]]+[✓×↓-]`，第一个字符是 ESC 不是空白 ⇒ 恒 0。
 *   按修好的锚重读那 8 趟：**✓×行=18156–18929、摘要=0**（跑了近一万九千条然后被掐断）。
 *   其中 `摘要行数(应为 2): 0` **不是失明**，那趟被杀在半程、vitest 确实没打摘要行。
 * - 分片数取 2 的依据是本仓已有的同套件同旗标读数：`QG Desktop Shards` 最近 7 趟 main push 的 14 个
 *   成功分片样本 = 11.2–23.2 min（p50 18.6），慢的一片**方向翻转过**（7 趟里 1 趟是 2/2 更慢）。
 *   但这批样本是**每片独占一个 runner** 测的，本步是同 runner 两片并行 ⇒ 争用倍数未测。
 *   `max × 1.5 = 2091s` 对旧墙 2100s 只剩 **9 秒**（贴脸），按本仓口径正解是**先量再定数**而不是
 *   接受零余量 ⇒ 取 `2700s ≈ max × 1.94`，给争用留约一倍空间；仍受 job 级 70 min 约束不倒挂，
 *   且属**单调放宽**（不会让任何原本通过的运行变红）。第一次真跑后按打印的逐片 `elapsed=` 重定数。
 *
 * 三条主张各由一条**独立**的用例守，不合并计一条：并行确实发生 / 预算是共享而非各自 / 计数先剥 ANSI。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mod = require('./electron-ci-desktop-step.js');

const ESC = String.fromCharCode(27);

/** 样本量下限的单一出处：顶部读数与「新档够格扶正」两处必须用同一个数，抄两份必然漂移。 */
const MIN_GOVERNING_SAMPLES = 10;

test('分片参数：两片各自独立且必须带齐既有旗标，--shard 不得落在独立 "--" 之后', () => {
  const a1 = mod.buildShardArgs(1, 2);
  const a2 = mod.buildShardArgs(2, 2);
  assert.deepEqual(a1.filter((a) => /^--shard=/.test(a)), ['--shard=1/2']);
  assert.deepEqual(a2.filter((a) => /^--shard=/.test(a)), ['--shard=2/2']);
  // 旗标集合与改动前逐项一致（本片只改"怎么跑"，不改"跑什么"）
  for (const flag of ['--maxWorkers=1', '--no-file-parallelism', '--reporter=verbose',
    '--testTimeout=10000', '--hookTimeout=10000', '--teardownTimeout=10000']) {
    assert.ok(a1.includes(flag), '分片参数丢了 ' + flag + ' ⇒ 与 quality-gate 分片不再同形，比对失去意义');
  }
  // ⛔ 本仓实测过的 argv 陷阱（#3315）：独立 "--" 之后的参数会被转发层吃掉对选择集的影响。
  const dash = a1.indexOf('--');
  const shardIdx = a1.findIndex((x) => /^--shard=/.test(x));
  assert.ok(shardIdx >= 0);
  assert.ok(dash === -1 || shardIdx < dash,
    '--shard 落在独立 "--" 之后 ⇒ 按 #3315 的形态它会被当成"转发给任务命令的参数"，两片都跑全量');
});

test('两片必须在等待任何一片之前就已启动（退回串行必须变红）', async () => {
  const started = [];
  const calls = [];
  const spawnImpl = (argv) => {
    started.push({ shard: argv.find((a) => /^--shard=/.test(a)), waiting: false });
    calls.push(argv);
    // 第 i 片在"两片都启动之后"才收敛：模拟真并行
    return {
      shard: argv.find((a) => /^--shard=/.test(a)),
      // 并发性的正确观察点是**收敛时**：串行实现在第 1 片收敛时只启动过 1 片，并行实现必须已启动 2 片。
      // 在启动回调里断言是自指 —— 那一刻第 2 片当然还没启动，恒红（本条第一版就是这么写错的）。
      done: new Promise((resolve) => {
        setTimeout(() => {
          assert.equal(started.length, 2,
            '第 1 片收敛时只启动过 ' + started.length + ' 片 ⇒ 这是串行，正是要修的形态');
          resolve({ rc: 0, stdout: 'Test Files 1 passed\nTests 2 passed\n', stderr: '' });
        }, 5);
      }),
    };
  };
  const res = await mod.runStep({ spawnImpl, budgetMs: 60000, now: () => 0, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  assert.equal(res.rc, 0, '两片都 0 ⇒ 整步必须 0，实际 ' + JSON.stringify(res.verdicts));
  assert.equal(calls.length, 2, '必须恰好起两片，起了 ' + calls.length + ' 片');
});

test('预算是整步共享的，不是每片一份（两片各 0.8×预算时总耗时不得超预算）', async () => {
  let clock = 0;
  const kills = [];
  const spawnImpl = (argv, opts) => {
    const shard = argv.find((a) => /^--shard=/.test(a));
    let resolveFn;
    const done = new Promise((r) => { resolveFn = r; });
    // 两片都"慢"：各自在 0.8×预算处才收敛（串行会 1.6×预算 ⇒ 必然被共享预算掐掉）
    setTimeout(() => resolveFn({ rc: 0, stdout: 'Tests 1 passed\n', stderr: '' }), 40);
    return { shard, done };
  };
  const budget = 100;
  const res = await mod.runStep({
    spawnImpl, budgetMs: budget,
    now: () => clock,
    advance: (ms) => { clock += ms; },
    kill: (shard) => { kills.push(shard); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  assert.equal(kills.length, 0, '两片都在 0.8×预算内收敛 ⇒ 不该有片被杀，实际杀了 ' + JSON.stringify(kills));
  assert.equal(res.rc, 0);
  assert.ok(res.elapsedMs <= budget * 1.6, '总耗时必须接近 0.8×预算而不是 1.6×（串行）：' + res.elapsedMs);
});

test('超预算的那一片按 timeout 归档，另一片不得被连坐判失败', async () => {
  const spawnImpl = (argv) => {
    const shard = argv.find((a) => /^--shard=/.test(a));
    const hang = shard === '--shard=1/2';
    return {
      shard,
      done: new Promise((resolve) => setTimeout(
        () => resolve(hang ? { rc: null, signal: 'SIGTERM', timedOut: true, stdout: '', stderr: '' }
          : { rc: 0, stdout: 'Tests 3 passed\n', stderr: '' }), hang ? 400 : 5)),
    };
  };
  const res = await mod.runStep({
    spawnImpl, budgetMs: 60, kill: () => {},
    now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  assert.equal(res.verdicts['--shard=1/2'], 'timeout');
  assert.equal(res.verdicts['--shard=2/2'], 'ok', '好的一片被连坐 ⇒ 会把"哪一片慢"这个唯一线索弄丢');
  assert.equal(res.rc, 124, '整步必须报 timeout 档，不得报成断言失败');
});

test('report 必须打印逐片 elapsed 与复测入口 —— 争用倍数的唯一现场来源', async () => {
  // 这片的关键未知量是"同 runner 两片并行的争用倍数"，它只能从真跑的逐片墙钟里读。
  // 如果只打印整步 elapsed，那 max(两片) 就无从得知，provenance 的"第一次真跑后重定数"
  // 会退化成一句没有取数路径的散文（本仓对 *_PROVENANCE 的口径：常量旁给出处 + 每次真跑留痕 + 入口在仓库里）。
  const spawnImpl = (argv) => ({
    shard: argv.find((a) => /^--shard=/.test(a)),
    done: Promise.resolve({ rc: 0, stdout: 'Tests 1 passed\n', stderr: '' }),
  });
  const res = await mod.runStep({ spawnImpl, budgetMs: 5000, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  const perShard = String(res.report).split(/\r?\n/).filter((l) => /\[electron-ci-step\] shard=/.test(l));
  assert.equal(perShard.length, 2, '每片各一行：' + JSON.stringify(perShard));
  for (const line of perShard) {
    assert.match(line, /elapsed=\d+ms/, '逐片墙钟必须打印出来，否则争用倍数永远无法复测：' + line);
    assert.match(line, /verdict=/);
    assert.match(line, /completed=\d+/);
  }
  assert.ok(res.shardElapsed && Object.keys(res.shardElapsed).length === 2,
    'shardElapsed 必须逐片回填（审计按它取数）：' + JSON.stringify(res.shardElapsed));
  assert.match(String(res.report), /node scripts\/electron-ci-shard-audit\.js/,
    '复测入口必须和读数同屏打印：' + res.report);
});

test('一片断言失败 ⇒ 整步 rc=1；两片都 0 ⇒ rc=0（两种红必须分档）', async () => {
  const mk = (rc) => (argv) => ({
    shard: argv.find((a) => /^--shard=/.test(a)),
    done: Promise.resolve({ rc, stdout: rc === 0 ? 'Tests 1 passed\n' : 'Tests 1 failed\n', stderr: '' }),
  });
  const ok = await mod.runStep({ spawnImpl: mk(0), budgetMs: 5000, now: () => 0, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  assert.equal(ok.rc, 0);
  const bad = await mod.runStep({ spawnImpl: mk(1), budgetMs: 5000, now: () => 0, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  assert.equal(bad.rc, 1, '断言失败必须与 timeout 分开（rc=124 与 rc=1 的修法相反）');
  assert.equal(bad.verdicts['--shard=1/2'], 'failed');
});

test('已完成测试行数：必须先剥 ANSI 再数（不剥就恒 0，就是这次误归因的根）', () => {
  // ⚠ 这行的字节形状是**量出来的**，不是构造的：`vitest run … | od -c` 得
  //   `033 [ 3 2 m ✓ 033 [ 3 9 m ␣␣ electron/…` ⇒ 行首是 ESC，剥完 ANSI 后 ✓ 在**第 0 位**（没有前置空白）。
  const realLine = ESC + '[32m' + '✓' + ESC + '[39m  electron/services/x.test.js > 套件 > 用例 1ms';
  // workflow 里那条 grep 的语义（bash 的 [[:space:]] 在 JS 里写作 [ \t]+）：它要求"行首有空白"，
  // 而真实行的第一个字符是 ESC ⇒ 恒 0。把"锚为什么会瞎"本身写成断言，防止下一个会话把夹具修反。
  const naive = /^[ \t]+/;
  assert.equal(naive.test(realLine), false,
    '前提自证：带 ANSI 的真实行**不该**被行首空白锚匹配；若变成 true，说明夹具没还原现场而不是判据对了');
  assert.equal(naive.test(mod.stripAnsi(realLine)), false,
    '第二重自证：**剥过 ANSI 的真实行仍不以空白开头** ⇒ 旧锚即使剥了 ANSI 也数不到，判据必须允许 0 个空白');
  assert.equal(mod.countCompletedTests(realLine), 1,
    '带 ANSI 的真实 verbose 行必须被计入（旧实现只数 ^[[:space:]]+[✓…] ⇒ 恒 0，把"跑满预算"读成"一条没跑"）');
  assert.equal(mod.countCompletedTests('' + ESC + '[32m✓' + ESC + '[39m a > b > c 1ms'), 1,
    '行首直接是 ESC（无前置空白）也必须计入 —— 锚不得要求行首有空白');
  assert.equal(mod.countCompletedTests('nothing here\n'), 0, '负控：没有 ✓ 行时必须是 0，不是"探针坏"');
  assert.equal(mod.stripAnsi(ESC + '[32mred' + ESC + '[39m'), 'red');
});

test('摘要行计数为 0 必须是「被杀趟的正确读数」，不得与「计数器失明」同形', () => {
  const killed = ' ✓ a.test.js > s > c 1ms\n ✓ b.test.js > s > c 2ms\n';
  assert.equal(mod.countSummaryLines(killed), 0, '被杀趟确实没有 Test Files/Tests 摘要行');
  const finished = killed + ' Test Files  2 passed (2)\n      Tests  5 passed (5)\n';
  assert.equal(mod.countSummaryLines(finished), 2, '正控：跑完的形态必须数到 2，否则"0"是探针坏而不是没摘要');
  const line = mod.formatCounters(killed);
  assert.match(line, /completed=2/, '现场必须把"已跑完多少条"单独报出来：' + line);
  assert.match(line, /summary=0/, '摘要行读数要一起报，并明示它是 0：' + line);
  assert.doesNotMatch(line, /计数器|探针坏|取不到/, '被杀趟的正确读数不得被文案写成工具故障：' + line);
});

test('realSpawn 的接缝必须按「本进程当场能不能解析到 pnpm」选期望，不得假设 PATH', { timeout: 60000 }, async () => {
  // 这一条刻意打真进程：委托形态下"argv 交给谁"是本片唯一没被 mock 覆盖的接缝，
  // 坏掉的现场是 CI 上一句 `spawn pnpm ENOENT` —— 比在这里慢 1 秒贵得多。
  //
  // ⚠ 但它的期望**不能**是"pnpm 一定在 PATH"：本锁接进 `quality-gate.yml` 的 changes job，
  // 那个 job 按既有约定**不装依赖**（AGENTS：接进 changes job 的锁只能 require node 内置模块），
  // 所以 ubuntu runner 上解析不到 pnpm 是**该 job 的环境**，不是被测代码坏。
  // 实测（PR #4192 首跑，run 39612728047 / job 119265564600）：
  //   `not ok 8 - … pnpm --version 必须真的退出 0；实际 {"rc":null,…,"error":"spawn pnpm ENOENT"}`
  // 按本仓口径这是「期望该由实测推导」那一类：先探本进程能不能解析到，再选期望；
  // 两条支路都必须各自成立，且每次跑都打印走的是哪条 + 关键实测值（否则下次没人知道它测了什么）。
  const cp = require('node:child_process');
  const probe = cp.spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pnpm'], { encoding: 'utf8' });
  const resolvable = probe.status === 0;
  const resolvedTo = String(probe.stdout || '').split(/\r?\n/).filter(Boolean)[0] || '<none>';
  console.log(`[realSpawn] platform=${process.platform} pnpmResolvable=${resolvable} resolvedTo=${resolvedTo}`);

  const h = mod.realSpawn(['--version']);
  assert.equal(typeof h.kill, 'function', 'realSpawn 必须自带 kill，否则共享预算到点无人可杀');
  assert.ok(h.shard === undefined || /^--shard=/.test(String(h.shard)),
    'shard 字段只能是 --shard=… 或缺席，实测 ' + String(h.shard));

  if (!resolvable) {
    // 解析不到 ⇒ 这一档仍然必须"响亮地成立"：realSpawn 不得抛，必须以 classifyShard 认得的形态收尾。
    // 负控写在本文件另一条里（argv 拼错 ⇒ rc≠0），这里守的是"环境缺工具时不要把判据炸成不可归因"。
    const r = await h.done;
    assert.ok(r && (r.rc === null || typeof r.rc === 'number'), 'rc 形态必须可读，实测 ' + JSON.stringify(r).slice(0, 160));
    if (process.platform === 'win32') {
      assert.fail('win32 上解析不到 pnpm ⇒ 真实步骤必然 ENOENT，这是被测面而不是环境噪声');
    }
    console.log('[realSpawn] branch=absent（该 job 未装 pnpm，改判形态契约；win32 上这条一律 FAIL）');
    return;
  }
  const r = await h.done;
  console.log(`[realSpawn] branch=present rc=${r.rc}`);
  assert.equal(r.rc, 0, 'pnpm 可解析时 `pnpm --version` 必须真退出 0；实际 ' + JSON.stringify(r).slice(0, 200)
    + ' ⇒ argv/shell 的组合在本机就不成立');
});

test('预算不得倒挂：单片超时 + 两片并行的总上限必须真的落在 STEP_BUDGET_MS 之内', () => {
  assert.ok(mod.SHARD_COUNT === 2, '分片数变了就要重测分布，不得沿用本表');
  assert.ok(mod.STEP_BUDGET_MS >= mod.SHARD_TIMEOUT_MS,
    '单片硬超时必须 ≤ 整步预算（否则单片自己就能把整步拖爆）');
  assert.ok(mod.STEP_BUDGET_MS >= mod.SHARD_TIMEOUT_MS * 1.0
    && mod.SHARD_TIMEOUT_MS <= mod.STEP_BUDGET_MS,
    '共享预算下单片允许跑满整步，但必须显式写出这个关系');
});

test('预算取值必须有实测出处，且判据是「≥ max×倍数」而不是「等于」（低读数不构成收紧理由）', () => {
  const p = mod.STEP_BUDGET_PROVENANCE;
  assert.equal(typeof p.maxObservedShardMin, 'number');
  assert.ok(Number.isFinite(p.maxObservedShardMin) && p.maxObservedShardMin > 0, 'max 必须是正数');
  assert.ok(p.shards >= MIN_GOVERNING_SAMPLES, '样本量下限：' + p.shards + ' 个分片样本不足以定预算');
  assert.ok(p.runs >= 5, 'run 数下限：' + p.runs);
  assert.ok(p.safetyMultiplier >= 1.5, '安全倍数不得低于 1.5（与 gate-budget.js 同源口径）');
  assert.ok(typeof p.collectedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.collectedAt), '必须带采集日期');
  assert.ok(typeof p.source === 'string' && p.source.length > 40, '必须写清取数的命令/窗口');
  assert.ok(mod.STEP_BUDGET_MS >= p.maxObservedShardMin * 60000 * p.safetyMultiplier,
    '预算 < max×倍数 ⇒ 该抬预算或加片数，不是把这条断言改宽');
  // 反收紧：断言必须是 ≥；这里显式允许预算远大于该式右端
  assert.ok(mod.STEP_BUDGET_MS > p.maxObservedShardMin * 60000, '预算必须大于观测最大值本身');
});

test('接线：electron-ci 的那一步必须调用本脚本，且不得再自带第二份计数/预算字面量', () => {
  const root = path.resolve(__dirname, '..');
  const wf = fs.readFileSync(path.join(root, '.github/workflows/electron-ci.yml'), 'utf8');
  const step = wf.slice(wf.indexOf('Unit tests (Vitest'));
  const body = step.slice(0, step.indexOf('\n      - name:', 20) > 0 ? step.indexOf('\n      - name:', 20) : step.length);
  // ⛔ 反向锚必须**只看非注释行**：本 PR 的注释里就原样引用着 `BUDGET_SECONDS=2100` 与那条旧 grep，
  // 按整段文本判会让锁被"解释为什么要删它的那句注释"打红（本仓第五落点，一天内三次命中）。
  const code = body.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(body, /node scripts\/electron-ci-desktop-step\.js/,
    '步骤没有真的调本脚本 ⇒ 脚本变成"只有本地跑过"的装饰实现');
  assert.ok(body.indexOf('node scripts/electron-ci-desktop-step.js') >= 0
    && body.split(/\r?\n/).some((l) => /^\s+node scripts\/electron-ci-desktop-step\.js\s*$/.test(l)),
    '委托必须是**独占一条可执行语句**（写在管道或注释里都不算接线）');
  assert.doesNotMatch(code, /grep -cE '\^\[\[:space\]\]/,
    '步骤里不得再留第二份"已完成测试行数"计数（两份必然口径分裂）');
  assert.doesNotMatch(code, /\bBUDGET_SECONDS=/,
    '预算字面量不得在 workflow 里重复持有 —— 唯一真源是本脚本的 STEP_BUDGET_MS。'
    + '判据按**变量名**而不按数值：写死 2100 的那版，在预算改成 2700 后被 T7 那刀（workflow 退回内联 bash）绕过');
  assert.doesNotMatch(code, /timeout --signal=TERM/,
    '步骤级 `timeout` 包装也不得留第二份：预算由脚本自己按共享预算掐（两处掐 = 谁先到未知）');
  assert.ok(fs.existsSync(path.join(root, 'scripts/electron-ci-desktop-step.test.js')),
    '新写测试文件必须存在于仓库（被 .gitignore 静默吞掉是 scripts/ 的已知陷阱）');
  assert.equal(mod.SHARD_TIMEOUT_MS, mod.STEP_BUDGET_MS,
    '共享预算下允许单片跑满整步；这一格必须显式相等，否则上一条「不倒挂」的断言是空话');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-22（任务 #94 第二件）：审计入口第一次跑通，产出**本步真实形状**的第一批读数
// （同 runner 两片并行，10 趟 / 8 片 / max 23.6min）。它必须进 provenance，
// 但**不得**取代旧读数成为定预算的依据 —— 8 片 < 样本量下限 10，把它扶正当场就该红。
// 所以这里要的不是"多写一段注释"，而是让 append 进来的读数**被门禁读**。
// 三条各自独立成 test：一个 it 里放两条理由 ⇒ 首条失败即中止，第二格证据被藏住（本仓老坑）。
// 原始现场（逐字抄自审计输出，不是手填）：
//   [shard-audit] runs=10 shards=8 minShardMin=19.4 p50ShardMin=22.1 maxShardMin=23.6
//     budgetFloorSec=2122 stepBudgetSec=2700 safetyMultiplier=1.5
//     source=new-shape(per-shard elapsed / 1 runner) verdict=OK
//   [shard-audit] 全部(分钟)=22.9,20.2,23.6,20.6,22.1,19.4,23.3,20.8
test('provenance 是一册 append-only 读数账，顶部的数必须能在册子里对上号', () => {
  const p = mod.STEP_BUDGET_PROVENANCE
  assert.ok(Array.isArray(p.readings), 'readings 必须是数组（单值写回会抹掉历史测量的出处）')
  assert.ok(p.readings.length >= 2, '至少要有"每片独占 runner"与"同 runner 两片并行"两档形状：' + p.readings.length)
  const KEYS = ['collectedAt', 'runnerShape', 'runs', 'shards', 'minShardMin', 'p50ShardMin', 'maxShardMin', 'source']
  for (const r of p.readings) {
    for (const k of KEYS) {
      assert.ok(r[k] != null && r[k] !== '', '某条读数缺字段 ' + k + '：' + JSON.stringify(r).slice(0, 120))
    }
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.collectedAt), '每条读数都要带采集日期（活数没时间戳就没人知道它多旧）')
    assert.ok(r.shards >= 1 && r.runs >= 1, 'shards/runs 必须是正整数，不得用"很多"这种词')
  }
  const hit = p.readings.find((r) => r.maxShardMin === p.maxObservedShardMin && r.shards === p.shards && r.runs === p.runs)
  assert.ok(hit, '顶部的 max/shards/runs 在册子里找不到对应条目 ⇒ 两份事实已经分叉')
});

test('新形状读数参与判据：预算 ≥ max(全部读数) × 倍数，而不只是 ≥ 顶部那一档', () => {
  const p = mod.STEP_BUDGET_PROVENANCE
  const maxAll = Math.max(...p.readings.map((r) => r.maxShardMin))
  assert.ok(mod.STEP_BUDGET_MS >= maxAll * 60000 * p.safetyMultiplier,
    '有一档形状的 max×倍数 已超过预算 ⇒ 该抬预算或加片数；把这条断言改宽就是把预算墙读成用例坏')
  assert.ok(mod.STEP_BUDGET_MS > maxAll * 60000, '预算必须大于**任何一档**观测最大值本身')
});

test('册子里更新的一档要么已被扶正、要么样本量确实更小（既挡悄悄漂移，也让"够了就换"可达）', () => {
  const p = mod.STEP_BUDGET_PROVENANCE
  // 规则（生产方只有一份，写在测试里因为这是"锁自身的可达性"问题）：
  //   最新一档 == 扶正档 **且**其样本量 ≥ 下限 ⇒ 通过（够了才换，换了也须够格）
  //   最新一档样本量 < 扶正档          ⇒ 通过（还没资格换，正是本次 8 片 < 14 片的处境）
  //   否则                              ⇒ 红（有更厚的读数却没扶正 = 悄悄漂移）
  const governingIsCurrent = (prov) => {
    const newest = prov.readings.reduce((a, r) => (r.collectedAt > a.collectedAt ? r : a))
    // r2-i3：「已扶正」这一支必须同时过样本量下限，否则记录里「8 片扶正当场就该红」
    // 那句声称的判据在锁里不存在 —— 任意一片（哪怕 shards=2）写上顶部日期都能全绿。
    const promotedAndEligible = newest.collectedAt === prov.collectedAt
      && newest.shards >= MIN_GOVERNING_SAMPLES
    return promotedAndEligible || newest.shards < prov.shards
  }
  assert.ok(governingIsCurrent(p), '当前读数账的扶正关系不成立 ⇒ 要么换顶部值，要么删掉那条更新读数')

  // 正控（出路可达）：**样本量够**的新档被显式扶正 ⇒ 必须仍然通过。
  // 上一版把它写成「任何扶正都通过」，于是记录里那句「8 片 < 样本量下限 10，把它扶正
  // 当场就该红」在锁里根本没有执行体（外部评审第 2 轮 i3）。
  const thickNewest = {
    collectedAt: '2026-11-05', shards: 12, runs: 6, maxObservedShardMin: 25.0,
    readings: [
      { collectedAt: '2026-10-21', shards: 14 },
      { collectedAt: '2026-11-05', shards: 12 },
    ],
  }
  assert.ok(governingIsCurrent(thickNewest),
    '样本量达标的新档被扶正 ⇒ 必须是允许的动作，否则这条锁在禁止它自己声明的修复路径')

  // 反控 A（记录里那句「当场就该红」的执行体）：不足下限的一档即使被扶正也必须红。
  const thinPromoted = {
    collectedAt: '2026-11-05', shards: 8, runs: 4, maxObservedShardMin: 23.6,
    readings: [
      { collectedAt: '2026-10-21', shards: 14 },
      { collectedAt: '2026-11-05', shards: 8 },
    ],
  }
  assert.equal(governingIsCurrent(thinPromoted), false,
    '把 8 片档写上顶部日期就当成定预算依据 ⇒ 必须红；这里放行就是装饰性锁')

  // 反控：更新一档明显更厚却没扶正 ⇒ 必须判不成立（证明正控不是恒真）
  const drifted = {
    collectedAt: '2026-10-21', shards: 8,
    readings: [
      { collectedAt: '2026-10-21', shards: 8 },
      { collectedAt: '2026-10-30', shards: 20 },
    ],
  }
  assert.equal(governingIsCurrent(drifted), false,
    '更厚的新读数摆在册子里却不扶正 ⇒ 必须红，不然整条锁是装饰')
});


