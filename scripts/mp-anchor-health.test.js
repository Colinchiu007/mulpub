// Regression locks for scripts/mp-anchor-health.ps1 -- hot-backup freshness selection.
//
// Why this file exists (2026-10-18): the freshness check picked the "newest" backup by
// sorting directory NAMES as plain strings, descending:
//
//   Get-ChildItem -Directory | Sort-Object Name -Descending | Select-Object -First 1
//
// That silently assumes every child directory is named with a sortable timestamp
// (yyyyMMdd-HHmmss). The anchor genuinely contains a second naming family -- the
// one-shot baseline `seed-20260923-001516` -- and 's' (0x73) sorts above '2' (0x32),
// so the seed directory won every comparison and the lint reported
// "newest backup is 25.9 days old (limit 7)" on every single run, including runs
// that had just written a fresh snapshot seconds earlier. A lint that is always
// yellow is a lint nobody reads, which is the same failure mode as a decorative gate.
//
// Two independent defects had to line up, and both are pinned here:
//   1. selection used raw name ordering instead of PARSING the timestamp;
//   2. age was derived from the directory's LastWriteTime, which is not the backup
//      time at all (copying/restoring a snapshot rewrites mtime), so even a correct
//      selection could report a wrong age.
//
// The behavioural tests run the real script against a throwaway fixture, because a
// source-shape lock alone cannot tell "picks the right directory" from "picks any
// directory" -- and a mutation probe that only greps for `Sort-Object` survives an
// equally broken rewrite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'mp-anchor-health.ps1');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

// The lint is Windows PowerShell 5.1 in this repo; node:test would otherwise report a
// confusing "powershell ENOENT" on other hosts.
const isWindows = process.platform === 'win32';

// ── fixture helpers ───────────────────────────────────────────────────────────
function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}
function hoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000);
}

// A fixture is a temp RepoRoot holding a healthy anchor (critical files pass) plus a
// caller-chosen set of backup directory NAMES.
function makeFixture(backupNames) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-anchor-health-'));
  const anchor = path.join(repo, 'shared-user-data');
  fs.mkdirSync(anchor, { recursive: true });
  fs.mkdirSync(path.join(anchor, 'backend-data'), { recursive: true });
  fs.writeFileSync(path.join(anchor, 'multi-publish.db'), Buffer.alloc(2048, 1));
  fs.writeFileSync(path.join(anchor, 'backend-data', 'accounts.json'), '{"accounts":[]}');
  fs.writeFileSync(path.join(anchor, 'identity-session.json'), '{"token":"fixture"}');
  fs.mkdirSync(path.join(anchor, 'session'), { recursive: true });
  fs.mkdirSync(path.join(anchor, 'credentials'), { recursive: true });

  const backups = path.join(repo, 'shared-user-data.backups');
  fs.mkdirSync(backups, { recursive: true });
  for (const name of backupNames) {
    fs.mkdirSync(path.join(backups, name), { recursive: true });
  }
  return repo;
}

function runLint(repoRoot) {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT,
      '-RepoRoot', repoRoot,
    ],
    { encoding: 'utf8', timeout: 120000 },
  );
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function withFixture(backupNames, fn) {
  const repo = makeFixture(backupNames);
  try {
    return fn(repo, runLint(repo));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

// ── lock 1: the actual regression ─────────────────────────────────────────────
// A fresh timestamped snapshot MUST win over a non-timestamped `seed-*` directory.
// Before the fix this reported "days old" purely because 'seed-...' > '2026...'.
test('锁1：新快照必须胜过 seed-* 基线（按名字降序选最新=恒假告警的根因）', { skip: !isWindows && 'Windows PowerShell only' }, () => {
  const fresh = stamp(hoursAgo(1));
  withFixture([ 'seed-20200101-000001', fresh ], (repo, r) => {
    assert.equal(r.status, 0, `退出码应为 0（WARN/OK 都是 0）；实测 ${r.status}\n${r.out}`);
    assert.match(r.out, /backups fresh/, `新鲜快照存在时不得报陈旧：\n${r.out}`);
    assert.ok(
      r.out.includes(fresh),
      `必须点名真正最新的快照 ${fresh}（选错目录=本 bug）：\n${r.out}`,
    );
    assert.doesNotMatch(r.out, /days old/, `不得出现陈旧告警：\n${r.out}`);
    assert.match(r.out, /ANCHOR_OK/, `应判 ANCHOR_OK：\n${r.out}`);
  });
});

// ── lock 2: stale detection must still bite ──────────────────────────────────
// Protects against "fix by always reporting fresh", which would make the lint a
// permanently green decoration.
test('锁2：全部快照都陈旧时必须仍报陈旧（防「改成恒新鲜」）', { skip: !isWindows && 'Windows PowerShell only' }, () => {
  const stale = stamp(hoursAgo(24 * 30));
  withFixture([ stale ], (repo, r) => {
    assert.equal(r.status, 0, `WARN 档退出码应为 0；实测 ${r.status}\n${r.out}`);
    assert.match(r.out, /days old/, `30 天前的快照必须报陈旧：\n${r.out}`);
    assert.doesNotMatch(r.out, /backups fresh/, `不得判新鲜：\n${r.out}`);
    assert.match(r.out, /ANCHOR_WARN/, `应判 ANCHOR_WARN：\n${r.out}`);
  });
});

// ── lock 3: age comes from the NAME, not from mtime ──────────────────────────
// The stale fixture directory is CREATED seconds ago, so its LastWriteTime is "now".
// Deriving age from mtime can therefore never see it as stale.
test('锁3：年龄必须由目录名时间戳推导，不得用 LastWriteTime（复制/还原会改写 mtime）', { skip: !isWindows && 'Windows PowerShell only' }, () => {
  const staleByName = stamp(hoursAgo(24 * 30));
  const staleDir = makeFixture([ staleByName ]);
  try {
    // 前提断言：夹具目录的 mtime 确实是「刚刚」，否则本锁测不到 mtime 误用
    const mtimeAgeHours =
      (Date.now() - fs.statSync(path.join(staleDir, 'shared-user-data.backups', staleByName)).mtimeMs) / 3600000;
    assert.ok(mtimeAgeHours < 1, `夹具 mtime 应接近现在（实测 ${mtimeAgeHours.toFixed(2)}h），否则锁 3 测不到误用`);
    const r = runLint(staleDir);
    assert.match(r.out, /days old/, `名字里是 30 天前就必须报陈旧，与 mtime 无关：\n${r.out}`);
  } finally {
    fs.rmSync(staleDir, { recursive: true, force: true });
  }
});

// ── lock 4: a root holding only non-timestamped dirs must WARN, not lie ──────
// `seed-*` is a one-shot baseline, not a hot snapshot. If there is no timestamped
// snapshot at all, "fresh" is unknowable -- say so instead of guessing an age.
test('锁4：只有非时间戳目录时不得判新鲜（seed-* 是基线不是热快照）', { skip: !isWindows && 'Windows PowerShell only' }, () => {
  withFixture([ 'seed-20200101-000001' ], (repo, r) => {
    assert.equal(r.status, 0, `WARN 档退出码应为 0；实测 ${r.status}\n${r.out}`);
    assert.doesNotMatch(r.out, /backups fresh/, `不得把基线目录当热快照判新鲜：\n${r.out}`);
    assert.match(r.out, /ANCHOR_WARN/, `应判 ANCHOR_WARN：\n${r.out}`);
  });
});

// ── lock 5: source-shape backstop (cheap, catches a rewrite that drops parsing) ─
test('锁5：判据形状——必须按 yyyyMMdd-HHmmss 解析名字，且不得以 LastWriteTime 计龄', () => {
  assert.match(SRC, /yyyyMMdd-HHmmss/, '必须显式解析时间戳格式，而不是依赖目录名的字典序');
  assert.doesNotMatch(
    SRC,
    /\$latest\.LastWriteTime|\$latest\.CreationTime/,
    '不得用目录的 LastWriteTime/CreationTime 当备份时刻（复制/还原会改写它）',
  );
  // 正控：本锁用的正则必须能认出夹具名，否则锁本身是恒真的
  assert.match(stamp(new Date('2026-10-18T22:23:45')), /^\d{8}-\d{6}$/);
});
