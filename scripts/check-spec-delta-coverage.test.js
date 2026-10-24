#!/usr/bin/env node
'use strict';
/*
 * check-spec-delta-coverage.test.js —— 判据本身的回归 + 接线锁
 *
 * 三组：
 * ① 判据单元（parseSpec / collectDeltaDeclarations）——纯函数，逐条钉住边界
 * ② 夹具仓库端到端 —— 在临时 git 仓库里造 base/head 两态，跑真门禁，断言退出码
 * ③ 接线锁 —— 门禁必须被点在**不被 docs-only 短路**的 job 里（QG Changes），
 *    否则「输入 openspec/** 命中 docs-only 白名单 + 挂在 docs-only 门控的 job」= 给自己关掉校验
 *    （本仓同族先例 #2718 / #2745 / #3000 / #3114 / Gate 12d / Gate 12e）
 *
 * 用法：node --test scripts/check-spec-delta-coverage.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const GATE = path.join(__dirname, 'check-spec-delta-coverage.js');
const { parseSpec, collectDeltaDeclarations } = require('./check-spec-delta-coverage');

// ---------------------------------------------------------------- ① 判据单元

test('parseSpec：Requirement 与 Scenario 归属正确（Scenario 留在所属块内）', () => {
  const m = parseSpec([
    '## Purpose',
    '随便写点什么。',
    '',
    '### Requirement: 甲需求',
    '甲的正文',
    '',
    '#### Scenario: 甲-场景一',
    '- **WHEN** a',
    '- **THEN** b',
    '',
    '#### Scenario: 甲-场景二',
    '- **WHEN** c',
    '',
    '### Requirement: 乙需求',
    '乙的正文',
    '',
    '#### Scenario: 乙-场景一',
    '',
  ].join('\n'));
  assert.deepEqual([...m.keys()], ['甲需求', '乙需求']);
  assert.deepEqual([...m.get('甲需求')].sort(), ['甲-场景一', '甲-场景二']);
  assert.deepEqual([...m.get('乙需求')], ['乙-场景一']);
});

test('parseSpec：1~3 级标题结束 Requirement 块，4 级标题不结束', () => {
  const m = parseSpec([
    '### Requirement: 甲',
    '#### Scenario: 属于甲',
    '',
    '## 另一个二级标题',
    '#### Scenario: 不属于任何块',
    '',
  ].join('\n'));
  assert.deepEqual([...m.get('甲')], ['属于甲']);
  assert.equal(m.size, 1, '二级标题后的 Scenario 不该挂到甲上');
});

test('parseSpec：同标题重复出现时并集合并，不因重名误报', () => {
  const m = parseSpec([
    '### Requirement: 甲',
    '#### Scenario: 一',
    '',
    '### Requirement: 甲',
    '#### Scenario: 二',
    '',
  ].join('\n'));
  assert.equal(m.size, 1);
  assert.deepEqual([...m.get('甲')].sort(), ['一', '二']);
});

test('parseSpec：Windows 换行不破坏解析', () => {
  const m = parseSpec('### Requirement: 甲\r\n#### Scenario: 一\r\n');
  assert.deepEqual([...m.get('甲')], ['一']);
});

test('collectDeltaDeclarations：REMOVED 收集标题、RENAMED 收集 FROM', () => {
  const d = collectDeltaDeclarations([
    '## RENAMED Requirements',
    '',
    '- FROM: ### Requirement: 旧名',
    '- TO: ### Requirement: 新名',
    '',
    '## REMOVED Requirements',
    '',
    '### Requirement: 要删的',
    '**Reason**: xx',
    '',
    '## MODIFIED Requirements',
    '',
    '### Requirement: 改的',
    '#### Scenario: 某场景',
    '',
  ].join('\n'));
  assert.deepEqual([...d.renamedFrom], ['旧名']);
  assert.deepEqual([...d.removed], ['要删的']);
  assert.equal(d.removed.has('改的'), false, 'MODIFIED 段里的标题不该被当成删除声明');
});

test('collectDeltaDeclarations：标题里出现 Requirement 字样不会被误收', () => {
  const d = collectDeltaDeclarations([
    '## MODIFIED Requirements',
    '',
    '### Requirement: 保留这条',
    '',
  ].join('\n'));
  assert.equal(d.removed.size, 0);
  assert.equal(d.renamedFrom.size, 0);
});

// ------------------------------------------------------- ② 夹具仓库端到端

function gitIn(dir, args, env) {
  return execFileSync('git', ['-C', dir].concat(args), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {}),
  });
}

/** 造一个含主规格的临时 git 仓库，base 与 head 两态。 */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-delta-cov-'));
  const env = {
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e',
    GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e',
  };
  gitIn(dir, ['init', '-q', '-b', 'main'], env);
  const specDir = path.join(dir, 'openspec', 'specs', 'demo');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), [
    '## Purpose',
    '演示能力。',
    '',
    '### Requirement: 甲需求',
    '甲的正文',
    '',
    '#### Scenario: 基线场景一',
    '- **WHEN** a',
    '',
    '#### Scenario: 基线场景二',
    '- **WHEN** b',
    '',
    '### Requirement: 乙需求',
    '乙的正文',
    '',
    '#### Scenario: 乙场景',
    '- **WHEN** c',
    '',
  ].join('\n'), 'utf8');
  gitIn(dir, ['add', '-A'], env);
  gitIn(dir, ['commit', '-q', '-m', 'base'], env);
  // PR 是两条分支：base=main，head=feature。缺了这条，merge-base(main, HEAD) 会等于 HEAD
  // ⇒ diff 恒空 ⇒ 夹具测的就不是 PR 场景了。
  gitIn(dir, ['checkout', '-q', '-b', 'feature'], env);
  return { dir, env, specRel: 'openspec/specs/demo/spec.md' };
}

function commitAll(dir, env, msg) {
  gitIn(dir, ['add', '-A'], env);
  gitIn(dir, ['commit', '-q', '-m', msg], env);
}

function runGate(dir, base, head) {
  const r = spawnSync(process.execPath, [
    GATE, '--base=' + base, '--head=' + head, '--repo=' + dir,
  ], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('端到端：head 保留全部基线内容 ⇒ 通过（rc=0）', () => {
  const f = makeFixture();
  // 只改正文，不动 Requirement/Scenario 标题
  const p = path.join(f.dir, f.specRel);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('甲的正文', '甲的正文（修订）'), 'utf8');
  commitAll(f.dir, f.env, 'head');
  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /基线内容无丢失/);
});

test('端到端：合并后抹掉一条基线 Scenario ⇒ 红（rc=1）且点名是哪一条', () => {
  const f = makeFixture();
  const p = path.join(f.dir, f.specRel);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
    .replace('#### Scenario: 基线场景二\n- **WHEN** b\n\n', ''), 'utf8');
  commitAll(f.dir, f.env, 'head');
  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /基线场景二/);
  assert.match(r.out, /Scenario 在合并后消失/);
});

test('端到端：合并后整个 Requirement 消失 ⇒ 红（rc=1）', () => {
  const f = makeFixture();
  const p = path.join(f.dir, f.specRel);
  const txt = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, txt.slice(0, txt.indexOf('### Requirement: 乙需求')), 'utf8');
  commitAll(f.dir, f.env, 'head');
  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /整个 Requirement 在合并后消失/);
  assert.match(r.out, /乙需求/);
});

test('端到端：delta 声明了 REMOVED ⇒ 合法删除不红', () => {
  const f = makeFixture();
  // 删掉「乙需求」整块，同时在 change delta 里声明 REMOVED
  const p = path.join(f.dir, f.specRel);
  const txt = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, txt.slice(0, txt.indexOf('### Requirement: 乙需求')), 'utf8');
  const deltaDir = path.join(f.dir, 'openspec', 'changes', 'demo-change', 'specs', 'demo');
  fs.mkdirSync(deltaDir, { recursive: true });
  fs.writeFileSync(path.join(deltaDir, 'spec.md'), [
    '## REMOVED Requirements',
    '',
    '### Requirement: 乙需求',
    '**Reason**: 退役',
    '',
  ].join('\n'), 'utf8');
  commitAll(f.dir, f.env, 'head');
  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 0, r.out);
});

test('端到端：delta 声明了 RENAMED（FROM）⇒ 旧标题消失不红', () => {
  const f = makeFixture();
  const p = path.join(f.dir, f.specRel);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('乙需求', '乙需求（新名）'), 'utf8');
  const deltaDir = path.join(f.dir, 'openspec', 'changes', 'demo-change', 'specs', 'demo');
  fs.mkdirSync(deltaDir, { recursive: true });
  fs.writeFileSync(path.join(deltaDir, 'spec.md'), [
    '## RENAMED Requirements',
    '',
    '- FROM: ### Requirement: 乙需求',
    '- TO: ### Requirement: 乙需求（新名）',
    '',
  ].join('\n'), 'utf8');
  commitAll(f.dir, f.env, 'head');
  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 0, r.out);
});

test('端到端：未声明的标题改名 ⇒ 红（逼作者用 RENAMED 显式声明）', () => {
  const f = makeFixture();
  const p = path.join(f.dir, f.specRel);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('乙需求', '乙需求（新名）'), 'utf8');
  commitAll(f.dir, f.env, 'head');
  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /整个 Requirement 在合并后消失/);
});

test('端到端：本 PR 没碰主规格 ⇒ rc=0 且明说"无对象可判"（不是"通过"）', () => {
  const f = makeFixture();
  fs.writeFileSync(path.join(f.dir, 'README.md'), 'hello\n', 'utf8');
  commitAll(f.dir, f.env, 'head');
  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /无对象可判/);
});

test('端到端：新增主规格（无基线）⇒ rc=0，不误报', () => {
  const f = makeFixture();
  const dir2 = path.join(f.dir, 'openspec', 'specs', 'newcap');
  fs.mkdirSync(dir2, { recursive: true });
  fs.writeFileSync(path.join(dir2, 'spec.md'), '### Requirement: 新需求\n\n#### Scenario: 新场景\n', 'utf8');
  commitAll(f.dir, f.env, 'head');
  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 0, r.out);
});

test('端到端：base 分支前进（他人先合了新 Scenario）⇒ 不得误报', () => {
  // 构造：base 在 PR 打开后又前进了一个提交（他人给主规格加了新 Scenario），
  // PR 分支不含它。此时若拿 base 的当前 HEAD 当基线，那个新 Scenario 会被
  // 误判成"本次丢失"⇒ 假红。本门禁用 merge-base 口径 ⇒ 不误报。
  const f = makeFixture();
  const p = path.join(f.dir, f.specRel);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('甲的正文', '甲的正文（PR 改的）'), 'utf8');
  commitAll(f.dir, f.env, 'pr-head');
  // base 前进：切回 main，加一条新 Scenario
  gitIn(f.dir, ['checkout', '-q', 'main'], f.env);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
    + '\n#### Scenario: 他人后加的场景\n- **WHEN** d\n', 'utf8');
  commitAll(f.dir, f.env, 'base-moved');
  gitIn(f.dir, ['checkout', '-q', 'feature'], f.env);

  const r = runGate(f.dir, 'main', 'HEAD');
  assert.equal(r.code, 0, 'base 前进不该造成假红：\n' + r.out);
});

test('端到端：--base 不可解析 ⇒ rc=2（判据自身故障，不当通过）', () => {
  const f = makeFixture();
  const r = runGate(f.dir, 'no-such-branch', 'HEAD');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /取证失败/);
});

test('端到端：--head 显式为空 ⇒ rc=2（不回落 HEAD）', () => {
  const f = makeFixture();
  const r = runGate(f.dir, 'main', '');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /显式为空/);
});

test('端到端：缺 --base ⇒ rc=2（不静默通过）', () => {
  const f = makeFixture();
  const r = spawnSync(process.execPath, [GATE, '--repo=' + f.dir], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match((r.stdout || '') + (r.stderr || ''), /缺 --base/);
});

// ------------------------------------------------------------------ ③ 接线锁

test('接线锁：门禁必须带 if: pull_request 事件条件（push 事件下 base.sha 为空会 exit 2）', () => {
  const wf = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'quality-gate.yml'), 'utf8');
  const changesIdx = wf.indexOf('\n  changes:');
  assert.ok(changesIdx > 0);
  const rest = wf.slice(changesIdx);
  const nextJobIdx = rest.search(/\n  [a-z0-9-]+:\n/);
  const changesJob = nextJobIdx > 0 ? rest.slice(0, nextJobIdx) : rest;
  const gateIdx = changesJob.indexOf('Gate 12f - Spec delta coverage');
  assert.ok(gateIdx > 0, 'QG Changes job 里应能找到 Gate 12f');
  const step = changesJob.slice(gateIdx, changesJob.indexOf('\n      - ', gateIdx + 10));
  assert.match(step, /if: github\.event_name == 'pull_request'/,
    '本 workflow 还有 push:branches[main] 与 workflow_dispatch 触发；'
    + '那两种事件下 pull_request.base.sha 为空 ⇒ 门禁 exit 2 ⇒ main 的 push 会红');
});

test('本地锁：工作区里被 gitignore 吞掉的 scripts/*.js ⇒ 红（新增判据本体会静默不进仓）', () => {
  // 家族形态（本仓已发生三次，.gitignore 里逐条记着）：`.gitignore` 有 `scripts/*.js`，
  // 新增的判据本体会被**静默忽略** ⇒ 文件在工作区跑得通（本地全绿）但**没进仓** ⇒
  // CI 上 workflow 点名它时 Cannot find module。本次新增
  // scripts/check-spec-delta-coverage.js 时就撞上了（被 ignore ⇒ 不在变更集里）。
  //
  // 判据形态说明：这条是**本地向**的（看工作区里被 ignore 的文件）。
  // CI 上工作区 = checkout 出来的已提交内容，被 ignore 的文件根本不在工作区 ⇒ 0 命中、无害。
  // CI 上并不需要它兜底：workflow 点名一个不存在的脚本，job 本来就会红（Cannot find module），
  // 危害是「浪费一轮 CI」而不是「静默通过」。这条锁的价值是**本地提前发现**。
  //
  // 前一版曾试图扫 workflow 的引用做全仓完整性检查，误报了两类：
  //   ① `packages/x/scripts/y.js` / `.github/scripts/y.js` —— 路径后半段，不是仓根下的 scripts/；
  //   ② `working-directory: packages/api-publish-engine` 下的 `node scripts/y.js` —— 相对工作目录解析；
  //   ③ `[A-Za-z0-9._-]+` 里的点号贪婪吃掉 `.json` ⇒ `...ledger.json` 被切成 `...ledger.js`。
  // 三类都是匹配器自己的错（逐条查证才发现），故改成下面这个不依赖文本解析的口径。
  const { execFileSync } = require('node:child_process');
  const out = execFileSync('git', ['-C', REPO_ROOT, 'status', '--ignored', '--porcelain', 'scripts/'],
    { encoding: 'utf8' });
  const ignored = out.split('\n')
    .filter(l => l.startsWith('!! '))
    .map(l => l.slice(3).trim())
    .filter(f => /\.js$/.test(f) && !/\.test\.js$/.test(f));
  assert.deepEqual(ignored, [],
    '工作区里这些 scripts/*.js 被 .gitignore 静默忽略了 ⇒ 它们不会进仓，'
    + 'CI 上 workflow 点名时会 Cannot find module。请在 .gitignore 加 `!scripts/<name>.js` 反选：\n  '
    + ignored.join('\n  '));
});

test('接线锁：门禁必须被点在 QG Changes job 里（不被 docs-only 短路的那个）', () => {
  const wf = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'quality-gate.yml'), 'utf8');
  // 定位 changes job 段
  const changesIdx = wf.indexOf('\n  changes:');
  assert.ok(changesIdx > 0, 'quality-gate.yml 里应能定位 changes job');
  const rest = wf.slice(changesIdx);
  const nextJobIdx = rest.search(/\n  [a-z0-9-]+:\n/);
  const changesJob = nextJobIdx > 0 ? rest.slice(0, nextJobIdx) : rest;

  assert.match(changesJob, /check-spec-delta-coverage/,
    '门禁必须被点在 QG Changes job 里 —— 它挂在带 `docs-only != true` 门控的 job 里等于给自己关掉校验');

  // 位置锁：必须排在 classify 之后（否则 docs-only 输出整条消失，下游重型 job 全部跑满）
  const classifyIdx = changesJob.indexOf('classify');
  const gateIdx = changesJob.indexOf('check-spec-delta-coverage');
  assert.ok(classifyIdx > 0 && gateIdx > classifyIdx,
    '门禁必须排在 classify 之后');
});
