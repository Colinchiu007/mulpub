'use strict';
/**
 * aggregate-changelog.test.js — 台账聚合器的行为锁（change: changelog-record-carrier，tasks 2.4）
 *
 * 口径（AGENTS「测试文件必须显式接进 CI」+ check-unwired-tests.js）：本文件由
 * quality-gate.yml 的 changes 作业 `Gate 2b8 - Changelog aggregator` 点名执行。
 * changes 作业无 Install deps ⇒ 被测模块只允许 require node 内置模块，由 T8 机械守住。
 *
 * 三条锁的存在理由，都写成可被证伪的断言而不是"函数存在"：
 *  · 幂等键取 **record 名**（T4：同标题两条记录 MUST 各落一次；实现退回按标题判重即红）
 *  · 小节边界按**语义位置**（T2：代码围栏内与表格单元内的同名串 MUST NOT 成为边界）
 *  · 重跑 MUST 字节幂等且**出声**（T3：静默跳过与漏搬在输出上必须可区分）
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ac = require('./aggregate-changelog.js');

const tmpDirs = [];
function mkTmp () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-agg-'));
  tmpDirs.push(dir);
  return dir;
}
function write (dir, rel, text) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
  return p;
}
function read (dir, rel) { return fs.readFileSync(path.join(dir, rel), 'utf8'); }

/** 一篇带两个可聚合小节的记录。 */
function record (name, task, changelogBlock, learningsBlock) {
  const parts = [
    `---\nrecord: ${name}\ntask: ${task}\ndate: 2026-10-20\n---\n\n`,
    `## 本次执行记录：${task}（${name}，2026-10-20）\n\n| 门禁 | 状态 |\n|---|---|\n| 变更类型与隔离 | ✅ |\n\n`,
  ];
  if (changelogBlock) parts.push(`## CHANGELOG 条目\n\n${changelogBlock}\n`);
  if (learningsBlock) parts.push(`\n## learnings\n\n${learningsBlock}\n`);
  return parts.join('');
}

test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// ---------------------------------------------------------------- 解析层

test('T1 取出变更说明小节：逐字节等于原文那一段，不含门禁表', () => {
  const text = record('demo-a', '演示', '# fix(x): 标题（#1）\n\n- 第一条\n- 第二条');
  const p = ac.parseRecordSections(text);
  assert.strictEqual(p.changelog, '# fix(x): 标题（#1）\n\n- 第一条\n- 第二条\n');
  assert.ok(!p.changelog.includes('| 门禁 | 状态 |'), '取证表不得被当成变更说明');
  assert.strictEqual(p.learnings, null);
  assert.strictEqual(p.learningsShapeError, false);
});

test('T2 小节边界按语义位置切：代码围栏内的同名行 MUST NOT 成为边界', () => {
  // 围栏里那两行是"文档里抄的规范示例"（本仓多条门禁的注释就是这么写的），不是小节起点。
  const text = [
    '## CHANGELOG 条目',
    '',
    '# fix(b): 标题',
    '',
    '- 围栏之前的正文',
    '',
    '```markdown',
    '## CHANGELOG 条目',
    '## learnings',
    '```',
    '',
    '- 围栏之后的正文必须仍属于本小节',
    '',
    '## learnings',
    '',
    '### lesson: b',
    '',
    '**现场**：围栏内的两行是示例。',
  ].join('\n');
  const p = ac.parseRecordSections(text);
  assert.ok(p.changelog.includes('- 围栏之后的正文必须仍属于本小节'), '围栏内的同名行把小节截断了');
  assert.ok(p.changelog.includes('```markdown'), '围栏本体既不得被吞、也不得被当成边界');
  assert.ok(p.learnings && p.learnings.includes('### lesson: b'), '围栏之后真正的小节必须被认出来');
});

test('T2b 表格单元里的同名串不得成为边界（判据锚定行首整行，不做 substring 搜索）', () => {
  const cell = [
    '## CHANGELOG 条目',
    '',
    '# fix(y): 标题',
    '',
    '| 引用 | 值 |',
    '|---|---|',
    '| 本小节名 | ## CHANGELOG 条目 |',
    '',
    '- 这条仍在同一小节内',
  ].join('\n');
  const p = ac.parseRecordSections(cell);
  assert.ok(p.changelog.includes('- 这条仍在同一小节内'));
  assert.ok(p.changelog.includes('| 本小节名 | ## CHANGELOG 条目 |'), '同名串所在行本身就是小节内容，不得被切除');
});

test('T13 存量真实形态：带后缀的小节名不认，且必须被点名而不是静默跳过', () => {
  // 出处 openspec/records/member-tier-contract.md:130（PR #4051）——作者被热文件冲突逼到把条目
  // 记在「## CHANGELOG 条目（暂移到执行记录：热文件冲突说明）」里。合同取逐字精确，所以这一形态
  // 不认；但**必须进 missingSection 出声**，否则下一个人在同一处写后缀时会被读成"一条都没有"。
  const root = mkTmp();
  write(root, 'openspec/records/suffixed.md', '---\nrecord: suffixed\ntask: 后缀\n---\n\n## CHANGELOG 条目（暂移到执行记录：热文件冲突说明）\n\n- 原文如下\n');
  write(root, 'CHANGELOG.md', '# CHANGELOG\n');
  const r = ac.aggregate({ root, dryRun: true });
  assert.strictEqual(r.landed.length, 0);
  assert.deepStrictEqual(r.missingSection, ['suffixed'], '后缀变体必须被点名，不得静默当成没有条目');
  assert.match(ac.formatReport(r), /missing=1/);
});

test('T14 小节存在但首行不是条目标题 ⇒ malformed，不得搬一个无标题块进台账', () => {
  const root = mkTmp();
  write(root, 'openspec/records/nohead.md', '---\nrecord: nohead\ntask: 无标题\n---\n\n## CHANGELOG 条目\n\n- 只有一段流水账，没有 `# ` 标题\n');
  write(root, 'CHANGELOG.md', '# CHANGELOG\n');
  const r = ac.aggregate({ root, dryRun: true });
  assert.deepStrictEqual(r.malformed, ['nohead']);
  assert.strictEqual(r.landed.length, 0);
  assert.ok(!r.text.includes('流水账'), 'malformed 的内容不得被搬进台账');
});

test('T3 `##` 后多空格与行尾 CR 都认（同 changelog-entries 的实测口径）', () => {
  const p = ac.parseRecordSections('##   CHANGELOG 条目\r\n\r\n# z\r\n');
  assert.strictEqual(p.changelog, '# z\r\n');
});

test('T4 幂等键是 record 名：同标题的两条记录各落一次', () => {
  const root = mkTmp();
  const same = '# fix(dup): 完全相同的标题（#9）\n\n- 同一句话';
  write(root, 'openspec/records/alpha.md', record('alpha', 'A', same));
  write(root, 'openspec/records/beta.md', record('beta', 'B', same));
  write(root, 'CHANGELOG.md', '# CHANGELOG\n');
  const r = ac.aggregate({ root, dryRun: true });
  assert.strictEqual(r.landed.length, 2, '按标题判重的实现会在这里只落 1 条');
  assert.strictEqual(new Set(r.landed).size, 2);
});

test('T5 缺小节的记录跳过并点名，且计数能与"本轮没搬"区分', () => {
  const root = mkTmp();
  write(root, 'openspec/records/no-sec.md', record('no-sec', '无小节', null));
  write(root, 'openspec/records/with-sec.md', record('with-sec', '有小节', '# fix(c): c'));
  write(root, 'CHANGELOG.md', '# CHANGELOG\n');
  const r = ac.aggregate({ root, dryRun: true });
  assert.deepStrictEqual(r.missingSection, ['no-sec'], '缺小节必须被点名，不是静默略过');
  assert.strictEqual(r.landed.length, 1);
  assert.ok(!r.text.includes('无小节'));
  const form = ac.formatReport(r);
  assert.match(form, /records=2/, '首行读数必须含候选数，否则"零候选"与"全跳过"同形');
  assert.match(form, /missing=1/);
});

test('T6 重跑字节幂等，且第二趟出声报跳过', () => {
  const root = mkTmp();
  write(root, 'openspec/records/run1.md', record('run1', '跑一遍', '# fix(r): r\n\n- 内容'));
  write(root, 'openspec/records/learn.md', record('learn.md', '带教训', '# fix(l): l', '### lesson: k\n\n**现场**：x'));
  write(root, 'CHANGELOG.md', '# CHANGELOG\n');
  write(root, '01-docs/learnings.md', '# LEARNINGS\n');

  const a = ac.aggregate({ root, dryRun: false });
  const first = read(root, 'CHANGELOG.md');
  const firstLearn = read(root, '01-docs/learnings.md');
  assert.ok(first.includes('# fix(r): r'), '第一次必须落地');

  const b = ac.aggregate({ root, dryRun: false });
  assert.strictEqual(read(root, 'CHANGELOG.md'), first, '第二次必须逐字节不动');
  assert.strictEqual(read(root, '01-docs/learnings.md'), firstLearn);
  assert.strictEqual(b.landed.length, 0);
  assert.ok(b.skipped.includes('run1') && b.skipped.includes('learn'), '跳过必须可枚举，不能只报 0');
});

test('T7 混行尾原样保留，禁止统一回写', () => {
  const root = mkTmp();
  // 归档本体是 CRLF（本仓热点文档的历史形态），块内两行各自不同行尾。
  write(root, 'CHANGELOG.md', '# CHANGELOG\r\nold line\r\n');
  write(root, 'openspec/records/mixed.md', '---\nrecord: mixed\ntask: m\n---\n\n## CHANGELOG 条目\n\n# fix(m): m\n- LF 行\n- CRLF 行\r\n');
  ac.aggregate({ root, dryRun: false });
  const out = read(root, 'CHANGELOG.md');
  assert.ok(out.includes('- LF 行\n- CRLF 行\r\n'), '块内每行各自的行尾必须原样');
  assert.ok(out.endsWith('old line\r\n'), '既有行的行尾不得被改写');
  const crlfArchiveOnly = out.split('\n').filter((l) => l.endsWith('\r')).length;
  assert.ok(crlfArchiveOnly >= 2, '既有 CRLF 行 + 新写入的 CRLF 行都还在');
});

test('T8 被测模块不得引入第三方依赖（changes 作业无 Install deps），但 MUST 复用仓内条目模型', () => {
  const src = fs.readFileSync(path.join(__dirname, 'aggregate-changelog.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const reqs = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(reqs.length > 0, '解析退化成一空集合时本锁恒真（T8 自身的反失明下限）');
  for (const r of reqs) {
    const ok = /^node:/.test(r) || /^\.{1,2}\//.test(r);
    assert.ok(ok, `第三方或裸模块 ${r} 会让 changes 作业 MODULE_NOT_FOUND`);
  }
  // 台账条目模型只允许一份实现（openspec: changelog-ledger-integrity）——聚合器判"已落"必须走它，
  // 不得自己再写一个 /^# / 的正则；两份口径必然漂移，漂移表现为"该搬的没搬"。
  assert.ok(reqs.includes('./changelog-entries.js'), '必须复用 changelog-entries 的条目模型');
  assert.ok(!/const HEADING_RE\s*=/.test(src), 'MUST NOT 自带第二份条目标题正则');
});

test('T9 learnings 小节缺席不判红，存在但形状非法判红', () => {
  const absent = ac.parseRecordSections('## CHANGELOG 条目\n\n# a\n');
  assert.strictEqual(absent.learnings, null);
  assert.strictEqual(absent.learningsShapeError, false, '缺席是合法状态');

  const bad = ac.parseRecordSections('## CHANGELOG 条目\n\n# a\n\n## learnings\n\n随手写的一段，没有 lesson 子块\n');
  assert.strictEqual(bad.learningsShapeError, true);

  const ok = ac.parseRecordSections('## CHANGELOG 条目\n\n# a\n\n## learnings\n\n### lesson: s\n\n**现场**：b\n');
  assert.strictEqual(ok.learningsShapeError, false);
  assert.ok(ok.learnings.includes('### lesson: s'));
});

test('T10 落地标题必须带 record 名后缀，且已有后缀不重复追加', () => {
  assert.strictEqual(ac.ensureSlugSuffix('# fix(s): 标题\n\n- x', 'slug-a'), '# fix(s): 标题（slug-a）\n\n- x');
  assert.strictEqual(ac.ensureSlugSuffix('# fix(s): 标题（slug-a）\n\n- x', 'slug-a'), '# fix(s): 标题（slug-a）\n\n- x');
  const landed = ac.landedRecordNames('# fix(s): 标题（slug-a）\n\n- x\n');
  assert.deepStrictEqual([...landed], ['slug-a']);
});

test('T11 真仓自证：候选规模有下界，且现存记录不会让解析崩', () => {
  const root = path.resolve(__dirname, '..');
  const files = ac.collectRecords(root);
  assert.ok(files.length > 100, `真仓记录候选数 ${files.length} 低于下界 ⇒ 采集面退化`);
  assert.ok(!files.some((f) => f.name.startsWith('_')), '`_` 开头是占位物（_TEMPLATE/_legacy-absent/_exempt），不是记录');
  let withSection = 0;
  for (const f of files) {
    const p = ac.parseRecordSections(fs.readFileSync(f.path, 'utf8'));
    if (p.changelog) withSection += 1;
  }
  // 迁移期读数：绝大多数记录还没有这个小节，那正是聚合器要出声而不是崩的场景。
  assert.ok(withSection < files.length, '存量记录尚普遍缺小节；若本断言变红说明迁移已完成，应同步收紧本锁');
});

test('T15 参数面：未知旗标与缺值一律出声，MUST NOT 静默按默认跑（默认 dry-run 也得是显式的）', () => {
  assert.throws(() => ac.parseArgs(['--root']), /AGG_ARG/, '`--root` 不带 =<值> 被静默丢弃 = 扫了真仓却以为扫的是夹具');
  assert.throws(() => ac.parseArgs(['--writ']), /AGG_ARG/, '拼错的 --writ 若被放行，dry-run 会静默变成写盘');
  assert.deepStrictEqual(ac.parseArgs([]), { dryRun: true, verbose: false }, '默认必须是 dry-run，不是写盘');
  assert.strictEqual(ac.parseArgs(['--write']).dryRun, false);
  assert.strictEqual(ac.parseArgs(['--verbose']).verbose, true);
});

test('T16 真仓 dry-run 首行读数必须存在且与明细同口径（否则"CI 上跑过"无从证明）', () => {
  const r = ac.aggregate({ root: path.resolve(__dirname, '..'), dryRun: true });
  const line = ac.formatReport(r);
  assert.match(line, /^AGGREGATE records=\d+ missing=\d+ malformed=\d+ learningsShape=\d+ landed=\d+ skipped=\d+ duprisk=\d+ learningsLanded=\d+ mode=dry$/);
  assert.strictEqual(Number(/records=(\d+)/.exec(line)[1]), r.records);
  assert.strictEqual(Number(/missing=(\d+)/.exec(line)[1]), r.missingSection.length);
});

test('T12 --root 指向不存在的目录必须走"判据自身故障"档，不得读成"没有待搬"', () => {
  assert.throws(() => ac.aggregate({ root: path.join(os.tmpdir(), 'mp-agg-not-existing-' + process.pid) }), /AGG_ROOT_MISSING/);
});

// ---------- 外部评审 i1 / i2 的落点锁（QM-6 critic=claude，2026-10-20）----------

test('T17 裸标题已存在于台账（手写条目没带后缀）⇒ 不搬、点名 duprisk，不得静默塞重复块', () => {
  const root = mkTmp();
  // 迁移窗口内的真实形态：上一轮有人把同一条**手写**进了 CHANGELOG，标题没有 record 名后缀。
  write(root, 'CHANGELOG.md', '# CHANGELOG\n# fix(w): 已被手写的标题\n\n- 旧份\n');
  write(root, 'openspec/records/hand-written.md', '---\nrecord: hand-written\ntask: w\n---\n\n## CHANGELOG 条目\n\n# fix(w): 已被手写的标题\n\n- 新份\n');
  const r = ac.aggregate({ root, dryRun: true });
  assert.deepStrictEqual(r.duplicateRisk, ['hand-written'], '裸标题命中必须出声，不能既不算 landed 也不算 skipped');
  assert.strictEqual(r.landed.length, 0);
  assert.ok(!r.text.includes('- 新份'), '不得往人读台账里塞第二个同标题块');
  assert.match(ac.formatReport(r), /duprisk=1/);
});

test('T17b 主键仍是 record 名：裸标题判重只作第二道闸，不得把同标题的两条新记录吃掉一条', () => {
  const root = mkTmp();
  const same = '# fix(dup2): 同标题\n\n- x';
  write(root, 'CHANGELOG.md', '# CHANGELOG\n');
  write(root, 'openspec/records/aa.md', record('aa', 'AA', same));
  write(root, 'openspec/records/bb.md', record('bb', 'BB', same));
  const r = ac.aggregate({ root, dryRun: true });
  assert.strictEqual(r.landed.length, 2, '两条新记录都必须落 —— 若裸标题闸作用在 pending 之间，本断言会红');
  assert.deepStrictEqual(r.duplicateRisk, []);
});

test('T18 写盘必须是原子替换，且重试白名单只有 EPERM/EACCES/EBUSY', () => {
  const src = fs.readFileSync(path.join(__dirname, 'aggregate-changelog.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/fs\.renameSync\(/.test(src), '必须走 rename 替换，不能直写台账');
  assert.ok(!/fs\.writeFileSync\(file,/.test(src), '不得对台账直接 writeFileSync（半截写入不可恢复）');
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) assert.ok(src.includes(`'${code}'`), `重试白名单缺 ${code}`);
  assert.ok(!/RETRYABLE\.has\(e\.code\)\s*\|\|/.test(src.replace(/attempt >= \d+/, '')) || /attempt >= \d+/.test(src), '重试必须有界');
});

test('T18b 真写入不留 .tmp 残骸，且内容与返回值一致', () => {
  const root = mkTmp();
  write(root, 'CHANGELOG.md', '# CHANGELOG\nold\r\n');
  write(root, 'openspec/records/atomic.md', record('atomic', '原子写', '# fix(a): a\n\n- 新块'));
  const r = ac.aggregate({ root, dryRun: false });
  assert.deepStrictEqual(r.landed, ['atomic']);
  assert.strictEqual(fs.readdirSync(root).filter((f) => f.endsWith('.tmp')).length, 0, 'rename 失败路径也必须清掉临时文件');
  assert.strictEqual(read(root, 'CHANGELOG.md'), r.text);
  assert.ok(read(root, 'CHANGELOG.md').endsWith('old\r\n'), '台账原有行的行尾不得被写盘路径改动');
});
