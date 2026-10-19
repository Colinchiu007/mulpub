/**
 * check-sidecar-parity.test.js — 跨仓对账脚本自测
 *
 * 为什么这份测试必须存在：本仓最贵的失守形态是「判据本体没被 CI 跑到，而人以为它在跑」
 * （`.gitignore:106 scripts/*.js` 静默忽略 + CI 上 MODULE_NOT_FOUND 一族已有多次先例）。
 * 所以既测比较核心（纯函数，喂构造数据，不读真实 checkout），也端到端跑 main()，
 * 证明它能对两棵目录树给出 0/1/2 三档退出码。
 *
 * 用法：node --test scripts/check-sidecar-parity.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

const { compareParity, lfSha256, main } = require('./check-sidecar-parity.js');

const sha = (s) => createHash('sha256').update(s, 'utf-8').digest('hex');

function side(label, { rules = 'R', vectors = 'V', lockText = 'L', lock = null } = {}) {
  return {
    label,
    lock: lock ?? JSON.parse(lockText),
    lockText,
    // 与实现同口径：锁文件的比较同样只抹平 CRLF（两仓检出行为不同，原字节比必假红）。
    lockTextLf: String(lockText).replace(/\r\n/g, '\n'),
    rulesSha: rules,
    vectorsSha: vectors,
  };
}

const LOCK = { rulesLfSha256: 'hR', vectorsLfSha256: 'hV' };
const LOCK_TEXT = JSON.stringify(LOCK);

test('compareParity：两侧完全一致 ⇒ 无问题', () => {
  const l = side('mulpub', { rules: 'hR', vectors: 'hV', lockText: LOCK_TEXT, lock: LOCK });
  const r = side('sidecar', { rules: 'hR', vectors: 'hV', lockText: LOCK_TEXT, lock: LOCK });
  assert.deepEqual(compareParity(l, r), []);
});

test('compareParity：跨仓规则表漂移（各自内部自洽）⇒ 必须报', () => {
  // 这正是单仓判据看不见的那一格：两边「数据和自己的锁一致」，但跨仓已经不同。
  const l = side('mulpub', { rules: 'hA', vectors: 'hV', lockText: 'L', lock: { rulesLfSha256: 'hA', vectorsLfSha256: 'hV' } });
  const r = side('sidecar', { rules: 'hB', vectors: 'hV', lockText: 'R', lock: { rulesLfSha256: 'hB', vectorsLfSha256: 'hV' } });
  const problems = compareParity(l, r);
  assert.ok(problems.some((p) => p.includes('跨仓规则表已漂移')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('锁文件两仓不一致')), problems.join('\n'));
});

test('compareParity：跨仓向量漂移 ⇒ 必须报', () => {
  const l = side('mulpub', { rules: 'hR', vectors: 'hV1', lockText: 'L', lock: { rulesLfSha256: 'hR', vectorsLfSha256: 'hV1' } });
  const r = side('sidecar', { rules: 'hR', vectors: 'hV2', lockText: 'R', lock: { rulesLfSha256: 'hR', vectorsLfSha256: 'hV2' } });
  assert.ok(compareParity(l, r).some((p) => p.includes('跨仓向量已漂移')));
});

test('compareParity：单侧「数据与本仓锁不一致」⇒ 必须点名该侧', () => {
  const l = side('mulpub', { rules: 'hR', vectors: 'hV', lockText: 'same', lock: LOCK });
  const r = side('sidecar', { rules: 'hX', vectors: 'hV', lockText: 'same', lock: LOCK });
  const problems = compareParity(l, r);
  assert.ok(problems.some((p) => p.includes('sidecar') && p.includes('规则表')), problems.join('\n'));
});

test('compareParity：锁文件无法解析 ⇒ 必须报，不得当成一致', () => {
  const l = { label: 'mulpub', lock: null, lockText: 'not json', rulesSha: 'h', vectorsSha: 'h' };
  const r = { label: 'sidecar', lock: null, lockText: 'not json', rulesSha: 'h', vectorsSha: 'h' };
  assert.ok(compareParity(l, r).some((p) => p.includes('无法解析')));
});

test('compareParity：跨仓语料/金标漂移 ⇒ 必须报', () => {
  // 这两份是后加的第三、四份共享产物：sidecar 侧不读金标、mulpub 侧不看 sidecar，
  // 所以漂移在单仓里完全不可见，只能靠本判据。
  const lock = { rulesLfSha256: 'hR', vectorsLfSha256: 'hV' };
  const l = side('mulpub', { rules: 'hR', vectors: 'hV', lockText: 'same', lock });
  const r = side('sidecar', { rules: 'hR', vectors: 'hV', lockText: 'same', lock });
  l.corpusSha = 'cA'; r.corpusSha = 'cB';
  l.goldenSha = 'gA'; r.goldenSha = 'gA';
  const problems = compareParity(l, r);
  assert.ok(problems.some((p) => p.includes('跨仓语料已漂移')), problems.join('\n'));
  assert.ok(!problems.some((p) => p.includes('跨仓金标已漂移')), problems.join('\n'));
});

test('compareParity：共享产物只在一侧存在 ⇒ 必须报（不得读成一致）', () => {
  const lock = { rulesLfSha256: 'hR', vectorsLfSha256: 'hV' };
  const l = side('mulpub', { rules: 'hR', vectors: 'hV', lockText: 'same', lock });
  const r = side('sidecar', { rules: 'hR', vectors: 'hV', lockText: 'same', lock });
  l.corpusSha = 'cA'; r.corpusSha = null;
  l.goldenSha = null; r.goldenSha = null; // 两侧都缺 ⇒ 不判
  const problems = compareParity(l, r);
  assert.ok(problems.some((p) => p.includes('只在一侧存在')), problems.join('\n'));
  assert.ok(!problems.some((p) => p.includes('金标')), problems.join('\n'));
});

test('compareParity：锁文件只差行尾 ⇒ 不得报（两仓检出行为不同，原字节比必假红）', () => {
  // 真实踩过的形态：mulpub 的 .gitattributes 是 text=auto（Windows 工作树 CRLF），
  // sidecar 检出为 LF。用原字节比 ⇒ 稳定假红，而且四条数据哈希明明全等。
  const lockObj = { rulesLfSha256: 'hR', vectorsLfSha256: 'hV' };
  const lfText = JSON.stringify(lockObj, null, 2) + '\n';
  const crlfText = lfText.replace(/\n/g, '\r\n');
  const l = side('mulpub', { rules: 'hR', vectors: 'hV', lock: lockObj, lockText: crlfText });
  const r = side('sidecar', { rules: 'hR', vectors: 'hV', lock: lockObj, lockText: lfText });
  assert.deepEqual(compareParity(l, r), []);
});

test('compareParity：锁文件内容真的不同 ⇒ 必须报', () => {
  const l = side('mulpub', { rules: 'hR', vectors: 'hV', lock: { rulesLfSha256: 'hR', vectorsLfSha256: 'hV' }, lockText: 'A' });
  const r = side('sidecar', { rules: 'hR', vectors: 'hV', lock: { rulesLfSha256: 'hR', vectorsLfSha256: 'hV' }, lockText: 'B' });
  assert.ok(compareParity(l, r).some((p) => p.includes('锁文件两仓不一致')), compareParity(l, r).join('\n'));
});

test('lfSha256：对行尾不敏感，但对内容敏感', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'));
  try {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    const c = join(dir, 'c.json');
    writeFileSync(a, '{\n"k": 1\n}\n', 'utf8');
    writeFileSync(b, '{\r\n"k": 1\r\n}\r\n', 'utf8');
    writeFileSync(c, '{\n"k": 2\n}\n', 'utf8');
    assert.equal(lfSha256(a), lfSha256(b));
    assert.notEqual(lfSha256(a), lfSha256(c));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTrees(dir) {
  const rules = '{\n  "word_split": {}\n}\n';
  const vectors = '{\n  "vectors": []\n}\n';
  const corpus = '{\n  "schema": "subtitle-parity-corpus/1", "cases": []\n}\n';
  const golden = '{\n  "schema": "subtitle-python-golden/1", "cases": []\n}\n';
  const lock = JSON.stringify({
    schema: 'sidecar-parity-lock/1',
    rulesLfSha256: sha(rules),
    vectorsLfSha256: sha(vectors),
  }, null, 2) + '\n';

  const roots = [join(dir, 'a'), join(dir, 'b')];
  for (const root of roots) {
    mkdirSync(join(root, 'packages/story2video-engine/src'), { recursive: true });
    mkdirSync(join(root, 'packages/story2video-engine/tests/fixtures'), { recursive: true });
    mkdirSync(join(root, 'src/splitter/scene_subtitle'), { recursive: true });
    mkdirSync(join(root, 'tests/vectors'), { recursive: true });
    writeFileSync(join(root, 'packages/story2video-engine/src/subtitle-rules.json'), rules, 'utf8');
    writeFileSync(join(root, 'packages/story2video-engine/tests/fixtures/subtitle_segmentation_vectors.json'), vectors, 'utf8');
    writeFileSync(join(root, 'packages/story2video-engine/tests/fixtures/sidecar-parity.lock.json'), lock, 'utf8');
    writeFileSync(join(root, 'packages/story2video-engine/tests/fixtures/subtitle_parity_corpus.json'), corpus, 'utf8');
    writeFileSync(join(root, 'packages/story2video-engine/tests/fixtures/subtitle_python_golden.json'), golden, 'utf8');
    writeFileSync(join(root, 'src/splitter/scene_subtitle/subtitle_rules.json'), rules, 'utf8');
    writeFileSync(join(root, 'tests/vectors/subtitle_segmentation_vectors.json'), vectors, 'utf8');
    writeFileSync(join(root, 'tests/vectors/sidecar-parity.lock.json'), lock, 'utf8');
    writeFileSync(join(root, 'tests/vectors/subtitle_parity_corpus.json'), corpus, 'utf8');
    writeFileSync(join(root, 'tests/vectors/subtitle_python_golden.json'), golden, 'utf8');
  }
  return roots;
}

test('main()：两树一致 ⇒ 退出码 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-e2e-'));
  try {
    const [a, b] = makeTrees(dir);
    assert.equal(main(['node', 'x', '--sidecar', b, '--mulpub', a]), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main()：缺文件 ⇒ 退出码 2（不得读成一致）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-missing-'));
  try {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    assert.equal(main(['node', 'x', '--sidecar', b, '--mulpub', a]), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main()：跨仓数据漂移 ⇒ 退出码 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-drift-'));
  try {
    const [a, b] = makeTrees(dir);
    // 只改 sidecar 侧的规则表内容（不改锁）⇒ 本仓对账 + 跨仓对账都应报。
    writeFileSync(join(b, 'src/splitter/scene_subtitle/subtitle_rules.json'), '{\n  "word_split": { "x": 1 }\n}\n', 'utf8');
    assert.equal(main(['node', 'x', '--sidecar', b, '--mulpub', a]), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
