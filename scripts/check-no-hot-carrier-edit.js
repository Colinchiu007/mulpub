#!/usr/bin/env node
'use strict';
/*
 * check-no-hot-carrier-edit.js — 热写面禁改门禁（change: changelog-record-carrier，tasks 3.x）
 *
 * 拦什么：`CHANGELOG.md` 与 `01-docs/learnings.md` 这两个「每 PR 在第 1 行插块」的共享写面。
 * 多 PR 并发时它们结构上必撞（实测 4/4 个可判定的 CONFLICTING PR，冲突文件只有这两个），
 * CI 全绿也合不进去，还要再跑一轮 25–30 分钟。条目真源已收敛到 `openspec/records/<分支>.md`
 * （按分支名一份 ⇒ 路径唯一），台账改由 `scripts/aggregate-changelog.js` 在发版时聚合。
 *
 * ⛔ 判据的输入必须是 **PR 差量**（merge-base..head），不是文件现状。
 * 按现状写会把「别人刚并入 main 的台账行」算到我头上 —— 本仓实测全树比较 5 例里 3 例是这种假阳性。
 * 回归锁 T4 专门站在这个错位上：夹具里 CHANGELOG.md 确实含他人的新行，而我这个 PR 必须判 PASS。
 *
 * 分两档，且档位由判据自己打印（不能靠文案措辞猜）：
 *   · advisory —— 点名不阻断。在飞 PR 绝大多数已按旧规改了台账，直接拦会把它们全判红，
 *     而那不是它们的错。窗口长度是已知欠账（记录里点名）。
 *   · enforce —— 阻断。转档前置条件见 tasks 4.3。
 *
 * 授权出口：只有**本次差量新增**的 `scripts/hot-carrier-write-authorization.json` 生效，
 * 且 `applies_to_base` 必须等于本次实际 merge-base。沿用 `changelog-dedup-authorization.json`
 * 那条已验证的形态 —— base 已存在的授权文件不生效，否则它变成常驻通行证，后续每个 PR 白蹭。
 *
 * 退出码：0 = 无命中 / advisory 档命中（仍出声）/ 授权放行；1 = enforce 档命中；
 * 2 = 判据自身故障（git 取证失败、mode 非法、--root 不可读）。把工具的失明读成"没有违规"
 * 是本仓「装饰性门禁」的同型错误，所以 2 与 0 严格分开。
 *
 * CI 落点：quality-gate.yml 的 `changes` 作业 `Gate 2b9`（无 job 级 if）。台账与记录路径全部
 * 命中 CI_IGNORED_PATHS，接在会被 docs-only 短路的 job 里等于给自己关掉校验。该作业无
 * Install deps ⇒ 只允许 require node 内置模块（由 scripts/check-no-hot-carrier-edit.test.js T10 守）。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 显式登记表，不做"看着像共享写面就拦"的启发式 —— T11 钉住 AGENTS.md 不在表内。
// 新增条目必须同 PR 给出撞车证据，否则就是把假阳性写进门禁。
const HOT_CARRIERS = Object.freeze(['CHANGELOG.md', '01-docs/learnings.md']);
const AUTH_FILE = 'scripts/hot-carrier-write-authorization.json';
const MODES = new Set(['advisory', 'enforce']);

function gitOrThrow (root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch (e) {
    const detail = String((e.stderr && String(e.stderr)) || e.message || '').trim().split('\n')[0];
    throw new Error(`GIT_FAILED: git ${args.join(' ')} ⇒ ${detail}`);
  }
}

/** merge-base 取不到时回落 base ref 本身（回落方向是"更严"，不是更松 —— 与 Gate 2c3 同口径）。 */
function resolveRange (root, baseRef, headRef) {
  const head = gitOrThrow(root, ['rev-parse', headRef]);
  let base = null;
  try {
    base = gitOrThrow(root, ['merge-base', baseRef, headRef]);
  } catch (e) {
    base = null;
  }
  const used = base || gitOrThrow(root, ['rev-parse', baseRef]);
  return { head, base: used, mergeBaseResolved: Boolean(base) };
}

function diffNameStatus (root, base, head) {
  const out = gitOrThrow(root, ['diff', '--name-status', `${base}..${head}`]);
  const entries = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = (parts[0] || '')[0];
    const file = parts[parts.length - 1];
    entries.push({ status, file });
  }
  return entries;
}

/** 读授权文件（只认 head 那份 blob，不读工作树 —— 工作树可能被别人会话的未提交内容污染）。 */
function readAuth (root, head) {
  let raw;
  try {
    raw = execFileSync('git', ['show', `${head}:${AUTH_FILE}`], { cwd: root, encoding: 'utf8' });
  } catch (e) {
    return { ok: false, reason: 'AUTH_ABSENT' };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: 'AUTH_UNREADABLE（不是合法 JSON ⇒ 按未授权处理，不静默放行）' };
  }
  return { ok: true, json };
}

function check ({ root = path.resolve(__dirname, '..'), baseRef = 'HEAD^', headRef = 'HEAD', mode = 'advisory' } = {}) {
  if (!fs.existsSync(root)) throw new Error(`SELF_FAULT: --root 指向不存在的路径 ${root}`);
  const { head, base, mergeBaseResolved } = resolveRange(root, baseRef, headRef);
  const entries = diffNameStatus(root, base, head);
  const changed = entries.map((e) => e.file);
  const hits = HOT_CARRIERS.filter((f) => changed.includes(f));

  const r = {
    mode, base, head, mergeBaseResolved,
    changedCount: changed.length,
    hits,
    authState: 'n/a',
    authNotes: [],
    verdict: 'PASS',
  };
  if (!hits.length) return r;

  const addedAuth = entries.some((e) => e.status === 'A' && e.file === AUTH_FILE);
  if (!addedAuth) {
    r.authState = 'off';
    r.authNotes.push(fs.existsSync(path.join(root, AUTH_FILE)) || entries.some((e) => e.file === AUTH_FILE)
      ? '授权文件不是本次差量新增（常驻通行证不生效）'
      : '未携带授权文件');
    r.verdict = 'FAIL';
    return r;
  }

  const read = readAuth(root, head);
  if (!read.ok) {
    r.authState = 'off';
    r.authNotes.push(read.reason);
    r.verdict = 'FAIL';
    return r;
  }
  const a = read.json;
  if (String(a.applies_to_base || '').trim() !== base) {
    r.authState = 'off';
    r.authNotes.push(`AUTH_BASE_MISMATCH：applies_to_base=${String(a.applies_to_base).slice(0, 12) || '<空>'} 实际 merge-base=${base.slice(0, 12)}`);
    r.verdict = 'FAIL';
    return r;
  }
  const allowed = Array.isArray(a.authorizedPaths) ? a.authorizedPaths : [];
  const uncovered = hits.filter((f) => !allowed.includes(f));
  if (uncovered.length) {
    r.authState = 'off';
    r.authNotes.push(`AUTH_PATH_UNCOVERED：${uncovered.join(', ')} 不在 authorizedPaths 里`);
    r.verdict = 'FAIL';
    return r;
  }
  r.authState = 'on';
  r.authNotes.push(`reason=${String(a.reason || '<空>').slice(0, 80)}`);
  r.verdict = 'PASS';
  return r;
}

function formatLine (r) {
  return `HOT-CARRIER MODE=${r.mode} base=${r.base.slice(0, 9)} head=${r.head.slice(0, 9)} `
    + `差量文件=${r.changedCount} 命中热写面=${r.hits.length} 授权=${r.authState} 判定=${r.verdict}`;
}

function printFindings (r) {
  if (!r.mergeBaseResolved) console.log('  注意：merge-base 取不到，已回落 base ref 本身（更严方向）');
  for (const f of r.hits) {
    console.log(`  HOT_CARRIER_EDIT ${f} —— 本 PR 改了「每 PR 顶部追加」的热写面。`);
    console.log('    正解：条目写进 openspec/records/<分支名>.md 的「## CHANGELOG 条目」/「## learnings」小节，');
    console.log('          台账由 scripts/aggregate-changelog.js 在发版时聚合，PR 不动这两个文件。');
  }
  for (const n of r.authNotes) console.log(`  AUTH ${n}`);
}

function parseArgs (argv) {
  const opt = { root: path.resolve(__dirname, '..'), baseRef: 'HEAD^', headRef: 'HEAD', mode: 'advisory' };
  for (const a of argv) {
    if (a.startsWith('--base=')) opt.baseRef = a.slice(7);
    else if (a.startsWith('--head=')) opt.headRef = a.slice(7);
    else if (a.startsWith('--root=')) opt.root = path.resolve(a.slice(7));
    else if (a.startsWith('--mode=')) {
      const m = a.slice(7);
      if (!MODES.has(m)) throw new Error(`SELF_FAULT: --mode 只接受 advisory|enforce，实得 ${m}`);
      opt.mode = m;
    } else throw new Error(`SELF_FAULT: 未知或非法参数 ${a}（接受 --base= --head= --root= --mode=advisory|enforce）`);
  }
  return opt;
}

if (require.main === module) {
  let r;
  try {
    r = check(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`[check-no-hot-carrier-edit] 判据自身故障（按未证实处理，不等于"没有违规"）：${e.message}`);
    process.exit(2);
  }
  console.log(formatLine(r));
  printFindings(r);
  if (r.verdict === 'FAIL' && r.mode === 'enforce') process.exit(1);
  process.exit(0);
}

module.exports = { check, formatLine, parseArgs, HOT_CARRIERS, AUTH_FILE };
