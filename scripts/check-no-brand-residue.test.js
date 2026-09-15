/**
 * check-no-brand-residue.test.js — 品牌残留门禁自测
 *
 * 用临时 git 仓库做 fixture，验证门禁的**检出能力**（而不只是"当前仓库干净"）：
 * - 中文品牌词必须命中（回归：latin1 通道下中文变体曾漏检）
 * - 全拼 / 三字母缩写变体必须命中
 * - 第三方签名服务域名豁免、二进制扩展名跳过、干净仓库通过
 *
 * CI：quality-gate.yml static-gates「Gate 12」先跑本自测再扫描当前仓库。
 * 用法：node --test scripts/check-no-brand-residue.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'check-no-brand-residue.js');

// 品牌词按码点构造（本测试文件自身不得出现字面品牌词）
const BRAND_FULL = String.fromCharCode(0x79, 0x69, 0x78, 0x69, 0x61, 0x6f, 0x65, 0x72);
const BRAND_ZH = String.fromCharCode(0x8681, 0x5c0f, 0x4e8c);
const BRAND_ABBR = BRAND_FULL[0] + BRAND_FULL[2] + BRAND_FULL[6];

/** 建一个临时 git 仓库，写入指定文件（相对路径 → 内容），返回目录路径 */
function makeFixtureRepo (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-fixture-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

function runGate (root) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
}

test('门禁检出中文品牌词（latin1 通道回归）', () => {
  const dir = makeFixtureRepo({ 'a.md': '参考某成熟产品实现\n' + BRAND_ZH + ' 的上传链路\n' });
  const r = runGate(dir);
  assert.equal(r.status, 1, 'stderr: ' + r.stderr);
  assert.match(r.stderr, /FAIL/);
  assert.match(r.stderr, /a\.md/);
});

test('门禁检出全拼大小写变体', () => {
  const dir = makeFixtureRepo({
    'lower.md': 'see ' + BRAND_FULL + ' implementation\n',
    'upper.md': 'uses ' + BRAND_FULL.toUpperCase() + '_MODE\n',
    'pascal.md': 'class ' + BRAND_FULL[0].toUpperCase() + BRAND_FULL.slice(1) + 'Helper {}\n',
    'abbr.md': 'y-token: ' + BRAND_ABBR + '-live\n',
  });
  const r = runGate(dir);
  assert.equal(r.status, 1);
  for (const f of ['lower.md', 'upper.md', 'pascal.md', 'abbr.md']) {
    assert.match(r.stderr, new RegExp(f.replace('.', '\\.')));
  }
});

test('第三方签名服务域名豁免（唯一例外）', () => {
  const dir = makeFixtureRepo({ 'a.md': 'endpoint: qianming.' + BRAND_FULL + '.cn:5012/Sign/GetSign\n' });
  const r = runGate(dir);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('二进制扩展名跳过（压缩数据字节巧合不改写不报错）', () => {
  const dir = makeFixtureRepo({ 'logo.png': 'binary-ish ' + BRAND_FULL + ' bytes' });
  const r = runGate(dir);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('干净仓库通过', () => {
  const dir = makeFixtureRepo({ 'ok.md': '完全中性的说明文档\nmp-* 命名空间约定\n' });
  const r = runGate(dir);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});

test('门禁脚本自身不含品牌词字面量', () => {
  const script = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(script, new RegExp(BRAND_FULL, 'i'));
  assert.doesNotMatch(script, new RegExp(BRAND_ABBR, 'i'));
  assert.doesNotMatch(script, new RegExp(BRAND_ZH));
});
