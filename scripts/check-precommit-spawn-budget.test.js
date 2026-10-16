'use strict';
/**
 * scripts/check-precommit-spawn-budget.js 的回归锁。
 * 跑法：node --test scripts/check-precommit-spawn-budget.test.js
 *
 * 每条负控都要问"它抓的是哪一格"，且红集互不相同；正控必须包含
 * 「禁词只出现在注释里 ⇒ 不得变红」——否则判据会把文档示例当违规（本仓同族假红教训）。
 *
 * 预算按**暂存段**计（QM-6 第三轮 i3），因此本文件同时锁两个方向：
 *   - 无关段落新增 git add ⇒ 不得红（否则假红逼人放宽棘轮，棘轮自弱）
 *   - 段内新增 git add     ⇒ 必须红（否则"作用域"变成了"关掉检查"）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const checker = require('./check-precommit-spawn-budget.js');

// 真实旧实现（HEAD blob 形态）的压缩等价体：三种禁止形态齐备，且不含任何 required 写法
const OLD_BODY = [
  '#!/bin/bash',
  'set -u',
  'if [ -f "scripts/ccg-gate.js" ]; then',
  '    node scripts/ccg-gate.js || exit 1',
  '    for rec in .ccg/reviews/*.json; do',
  '        [ -e "$rec" ] || continue',
  '        if [ -z "$(git ls-files -- "$rec")" ] || ! git diff --quiet -- "$rec" 2>/dev/null; then',
  '            git add -- "$rec" || true',
  '        fi',
  '    done',
  'fi',
  'exit 0',
].join('\n');

function filler() {
  // 让 code 长度越过 SOURCE_TOO_SMALL 的下界，避免"太小"掩盖真正的判据
  return Array.from({ length: 40 }, (_, i) => '# filler line ' + i).join('\n') + '\n' +
    'git rev-parse --git-dir\n'.repeat(12);
}

const END_LINE = '    rm -f "$rev_tmp.u" "$rev_tmp.m"';

function compliant() {
  return [
    '#!/bin/bash',
    'set -u',
    "RECORD_PATHSPEC=':(glob).ccg/reviews/*.json'",
    'rev_tmp="/tmp/mp-ccg-reviews-$$"',
    'scan_untracked_ok=1',
    'scan_modified_ok=1',
    '    git ls-files --others --exclude-standard -z -- "$RECORD_PATHSPEC" > "$rev_tmp.u" || scan_untracked_ok=0',
    '    git diff --name-only -z -- "$RECORD_PATHSPEC" > "$rev_tmp.m" || scan_modified_ok=0',
    'if [ -s "$rev_tmp.u" ] || [ -s "$rev_tmp.m" ]; then',
    '    if ! { cat "$rev_tmp.u"; cat "$rev_tmp.m"; } | git add --pathspec-from-file=- --pathspec-file-nul; then',
    '        echo "   [reviews] 批量 git add 失败，已回退逐条暂存"',
    '        while IFS= read -r -d "" rec; do',
    '            git add -- "$rec" || true',
    '        done < <( cat "$rev_tmp.u"; cat "$rev_tmp.m"; )',
    '    fi',
    'fi',
    END_LINE,
    filler(),
  ].join('\n');
}

/** 把 extra 插进暂存段内（终点锚之前）——预算测的是段内调用点，插到段外等于没测。 */
function inSection(src, extra) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l === END_LINE);
  if (i < 0) throw new Error('夹具终点锚丢失');
  return [...lines.slice(0, i), ...extra.split('\n'), ...lines.slice(i)].join('\n');
}

test('合规正文通过，且 required 四项各有命中（命中数为 0 时不得算过）', () => {
  const r = checker.analyze(compliant(), {});
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
  assert.ok(r.metrics.hits.UNTRACKED_SCAN >= 1);
  assert.ok(r.metrics.hits.MODIFIED_SCAN >= 1);
  assert.ok(r.metrics.hits.BATCH_ADD_VIA_STDIN >= 1);
  assert.ok(r.metrics.hits.GLOB_SCOPED_PATHSPEC >= 1);
});

test('退回逐文件循环 ⇒ 三种禁止形态各自指名变红', () => {
  const r = checker.analyze(OLD_BODY + '\n' + filler(), {});
  assert.strictEqual(r.ok, false);
  const ids = r.violations.map(v => v.id);
  assert.ok(ids.includes('GLOB_PER_FILE_LOOP'), 'GLOB_PER_FILE_LOOP 必须命中: ' + ids.join(','));
  assert.ok(ids.includes('PER_FILE_LS_FILES'), 'PER_FILE_LS_FILES 必须命中: ' + ids.join(','));
  assert.ok(ids.includes('PER_FILE_DIFF_QUIET'), 'PER_FILE_DIFF_QUIET 必须命中: ' + ids.join(','));
  // 同时 required 缺席 —— 两把判据都红，说明这不是"只靠缺席"的红
  assert.ok(ids.includes('MISSING_UNTRACKED_SCAN'));
});

test('禁词只出现在注释里 ⇒ 不得变红（剥注释口径的负控）', () => {
  const src = [
    '#!/bin/bash',
    '# 旧写法（已废弃，仅作说明）：for rec in .ccg/reviews/*.json; do git ls-files -- "$rec"; git diff --quiet -- "$rec"; done',
    compliant().split('\n').slice(1).join('\n'),
  ].join('\n');
  const r = checker.analyze(src, {});
  assert.strictEqual(r.ok, true, '注释里的示例不得被判违规: ' + JSON.stringify(r.violations));
  assert.ok(r.metrics.hits.GLOB_PER_FILE_LOOP === 0, '代码命中必须为 0');
  assert.ok(r.metrics.hits.GLOB_PER_FILE_LOOP_commentOnly >= 1, '应记录"只在注释里出现"这一现场');
});

test('正文读不出（空/截断）⇒ 判不通过并点名 SOURCE_TOO_SMALL_OR_EMPTY', () => {
  const r = checker.analyze('', {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.violations.some(v => v.id === 'SOURCE_TOO_SMALL_OR_EMPTY'));
});

test('文件不可读 ⇒ selfFault=true（"门禁瞎了"不得与"发现违规"混档）', () => {
  const r = checker.checkFile(path.join(process.cwd(), 'scripts', '__definitely_missing_' + process.pid + '.sh'), {});
  assert.strictEqual(r.selfFault, true);
  assert.ok(r.violations.some(v => v.id === 'HOOK_UNREADABLE'));
});

test('例外清单是注入参数：allowlist 能压掉指定 id，缺省为空', () => {
  assert.deepStrictEqual(checker.DEFAULTS.allowlist, [], '缺省例外必须为空');
  const blocked = checker.analyze(OLD_BODY + '\n' + filler(), {});
  const waived = checker.analyze(OLD_BODY + '\n' + filler(), { allowlist: ['GLOB_PER_FILE_LOOP', 'PER_FILE_LS_FILES', 'PER_FILE_DIFF_QUIET'] });
  const ids = b => b.violations.map(v => v.id);
  assert.ok(ids(blocked).includes('GLOB_PER_FILE_LOOP'));
  assert.ok(!ids(waived).includes('GLOB_PER_FILE_LOOP'), '注入的 allowlist 必须生效');
});

test('预算是棘轮：段内超出即红，且按注入参数可调', () => {
  const many = inSection(compliant(), '    git add -- "$rec2" || true');
  const strict = checker.analyze(many, { budgets: { gitAddCalls: 2, recordPathspecMentions: 4 } });
  assert.ok(strict.violations.some(v => v.id === 'BUDGET_GIT_ADD_CALLS'), JSON.stringify(strict.violations));
  const loose = checker.analyze(many, { budgets: { gitAddCalls: 99, recordPathspecMentions: 99 } });
  assert.ok(!loose.violations.some(v => v.id === 'BUDGET_GIT_ADD_CALLS'));
});

test('CRLF 输入与 LF 输入判定一致（行尾不得改变判据）', () => {
  const lf = compliant();
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(checker.analyze(crlf, {}).violations, checker.analyze(lf, {}).violations);
});

test('真仓钩子正文必须通过本判据，且规模下界成立', () => {
  const p = path.join(process.cwd(), 'scripts', 'hooks', 'pre-commit');
  const raw = fs.readFileSync(p, 'utf8');
  const r = checker.checkFile(p, {});
  assert.strictEqual(r.ok, true, '主干钩子不该被判违规: ' + JSON.stringify(r.violations));
  // 下界写在"读真仓的这条"，不写进生产函数：低于此说明判据没在看真内容
  assert.ok(r.metrics.codeChars > 3000, 'codeChars 下界: ' + r.metrics.codeChars);
  assert.ok(r.metrics.hits.UNTRACKED_SCAN >= 1 && r.metrics.hits.MODIFIED_SCAN >= 1);
  assert.ok(r.metrics.hits.gitAddCalls <= checker.DEFAULTS.budgets.gitAddCalls);
});

test('CLI 三档退出码互不混档：0 合规 / 1 违规 / 2 读不到', () => {
  const ok = execFileSync(process.execPath, [path.join(process.cwd(), 'scripts', 'check-precommit-spawn-budget.js'), 'scripts/hooks/pre-commit'], { encoding: 'utf8' });
  assert.ok(/OK/.test(ok), '合规应打印 OK');
  const tmpBad = path.join(require('node:os').tmpdir(), 'sb-bad-' + process.pid + '.sh');
  fs.writeFileSync(tmpBad, OLD_BODY + '\n' + filler());
  let code = 0, out = '';
  try {
    out = execFileSync(process.execPath, [path.join(process.cwd(), 'scripts', 'check-precommit-spawn-budget.js'), tmpBad], { encoding: 'utf8' });
  } catch (e) { code = e.status; out = e.stdout || ''; }
  fs.rmSync(tmpBad, { force: true });
  assert.strictEqual(code, 1, '违规必须退 1: ' + out);

  let code2 = 0;
  try {
    execFileSync(process.execPath, [path.join(process.cwd(), 'scripts', 'check-precommit-spawn-budget.js'), 'scripts/__nope_' + process.pid + '.sh'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { code2 = e.status; }
  assert.strictEqual(code2, 2, '读不到必须退 2，不得与 1 混档');
});

// ── 第三轮 QM-6 新增：i1 的结构绊线 / i3 的作用域两个方向 ──────────────────────────

test('pathspec 退回裸串（* 跨 /）⇒ MISSING_GLOB_SCOPED_PATHSPEC 指名变红，其余照旧绿', () => {
  // 一律 split/join，不用 String.replace：替换串里的 `$$`/`$&`/`$'` 会被当模式展开（本仓踩过）
  const src = compliant().split("':(glob).ccg/reviews/*.json'").join("'.ccg/reviews/*.json'");
  const r = checker.analyze(src, {});
  const ids = r.violations.map(v => v.id);
  assert.deepStrictEqual(ids, ['MISSING_GLOB_SCOPED_PATHSPEC'], '必须只红这一条: ' + ids.join(','));
});

test('终点锚被搬走 ⇒ 判 SELF_FAULT 而非「预算达标」，CLI 退 2', () => {
  // 这是本仓有先例的失效形态：切片终点 indexOf 返回 -1，负终点被解释成"从末尾倒数"，
  // 区间静默放大到接近整份文件，守卫继续绿却不再测量它声称的那一段。
  const src = compliant().split(END_LINE).join('    rm -f /tmp/other-qq');
  const r = checker.analyze(src, {});
  assert.strictEqual(r.selfFault, true, JSON.stringify(r.violations));
  assert.ok(r.violations.some(v => v.id === 'SECTION_ANCHOR_UNRESOLVED'));

  const tmp = path.join(require('node:os').tmpdir(), 'sb-anchor-' + process.pid + '.sh');
  fs.writeFileSync(tmp, src);
  let code = 0;
  try {
    execFileSync(process.execPath, [path.join(process.cwd(), 'scripts', 'check-precommit-spawn-budget.js'), tmp], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { code = e.status; }
  fs.rmSync(tmp, { force: true });
  assert.strictEqual(code, 2, '锚点解析不出来必须走「自身故障」档，不得与违规混档');
});

test('无关段落新增 git add ⇒ 不得撑爆预算（假红会逼人放宽棘轮），但全文计数仍出声', () => {
  const src = compliant().split('\n');
  const i = src.findIndex(l => l.startsWith('RECORD_PATHSPEC='));
  src.splice(i, 0, 'git add apps/desktop/package.json   # 版本同步段，与记录暂存无关');
  const r = checker.analyze(src.join('\n'), {});
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
  assert.strictEqual(r.metrics.hits.gitAddCalls, 2, '段内只该有批量 1 + 回退 1');
  assert.ok(r.metrics.hits.gitAddCallsWholeFile > r.metrics.hits.gitAddCalls, '全文计数必须仍可观测，不能悄悄丢掉这一维');
});

test('段内新增 git add ⇒ 必须红（作用域不是「关掉检查」）', () => {
  const r = checker.analyze(inSection(compliant(), '            git add -- "$rec_b" || true'), {});
  assert.ok(r.violations.some(v => v.id === 'BUDGET_GIT_ADD_CALLS'), JSON.stringify(r.violations));
});
