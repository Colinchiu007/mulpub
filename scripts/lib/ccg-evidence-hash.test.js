'use strict';
/**
 * scripts/lib/ccg-evidence-hash.js 的回归锁。
 * 跑法：node --test scripts/lib/ccg-evidence-hash.test.js
 * 接线：quality-gate.yml 的 changes 作业 Gate 2b4（与写入侧 ccg-record-ledger.test.js 同步点名）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const lib = require('./ccg-evidence-hash.js');

const SHA64 = 'ab'.repeat(32);

function newRepo () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-ev-'));
  const git = (a) => cp.execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main', '.']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(dir, 'openspec/records'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'openspec/records/b.md'), '---\nrecord: b\n---\n\n正文\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  git(['rev-parse', 'HEAD']);
  return { dir, git };
}

test('缺 base ⇒ 抛错，不得返回「空 diff 的哈希」（那会把取证失败写成取到了）', () => {
  assert.throws(() => lib.computeReviewPayloadSha({ repo: process.cwd(), base: '', head: 'HEAD' }), /缺 base/);
  assert.throws(() => lib.computeReviewPayloadSha({ repo: process.cwd(), base: '   ' }), /缺 base/);
});

test('载荷必须排除 openspec/records 与 .ccg/reviews —— 否则「写下哈希」会改变被哈希的内容，判据永远红', () => {
  const { dir, git } = newRepo();
  const base = git(['rev-parse', 'HEAD']).trim();
  const sha0 = lib.computeReviewPayloadSha({ repo: dir, base, head: 'HEAD' });
  // 只动台账（证据 URL 与哈希正是写在这里）⇒ 载荷哈希 MUST 不变
  fs.writeFileSync(path.join(dir, 'openspec/records/b.md'),
    '---\nrecord: b\nccg_status: self_play_resolved\nccg_payload_sha256: ' + sha0 + '\n---\n\n正文\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'ledger-only']);
  const sha1 = lib.computeReviewPayloadSha({ repo: dir, base, head: 'HEAD' });
  assert.strictEqual(sha1, sha0, '改台账就改哈希 ⇒ 自指：写完的哈希永远不等于重算值，判据无解');
  // 只动 .ccg/reviews（钩子每笔提交重写）同理
  fs.mkdirSync(path.join(dir, '.ccg/reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ccg/reviews/x.json'), JSON.stringify({ mode: 'dual' }));
  git(['add', '-A']); git(['commit', '-q', '-m', 'record-only']);
  assert.strictEqual(lib.computeReviewPayloadSha({ repo: dir, base, head: 'HEAD' }), sha0, '判定记录变更不得算作代码变更');
  // 动真实源码 ⇒ 必须变（上面两条负控不成立时，这条正控证明哈希不是恒定的死值）
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 2;\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'code']);
  assert.notStrictEqual(lib.computeReviewPayloadSha({ repo: dir, base, head: 'HEAD' }), sha0,
    '源码变了而哈希不变 ⇒ 载荷根本没在测代码，两条负控全是假绿');
});

test('upsertFrontmatterFields：只动目标键，其余行逐字保留；同一输入重复写必须幂等', () => {
  const src = '---\nrecord: b\ntask: 旧值\n# 注释行别动\n---\n\n## 段落\n正文一行\n';
  const r1 = lib.upsertFrontmatterFields(src, { ccg_status: 'cleared', ccg_evidence: 'https://github.com/o/r/pull/1#discussion_r2' });
  assert.ok(r1.changed > 0);
  const lines = r1.text.split('\n');
  assert.ok(lines.includes('task: 旧值'), '未点名的键不得被碰');
  assert.ok(lines.includes('# 注释行别动'), 'frontmatter 里的注释必须原样保留');
  assert.ok(lines.includes('正文一行'), '正文不得被改写');
  assert.ok(lines.includes('ccg_status: cleared'));
  const r2 = lib.upsertFrontmatterFields(r1.text, { ccg_status: 'cleared', ccg_evidence: 'https://github.com/o/r/pull/1#discussion_r2' });
  assert.strictEqual(r2.changed, 0, '第二次写必须无变化（幂等），否则每次收口都会造一次假 diff');
  assert.strictEqual(r2.text, r1.text);
});

test('upsertFrontmatterFields：CRLF 夹具必须保持 CRLF（统一回写会造出整文件幽灵 diff）', () => {
  const crlf = ['---', 'record: b', '---', '', '正文'].join('\r\n') + '\r\n';
  const r = lib.upsertFrontmatterFields(crlf, { ccg_status: 'cleared' });
  const cr = (r.text.match(/\r/g) || []).length;
  const lf = (r.text.match(/\n/g) || []).length;
  assert.strictEqual(cr, lf, '行尾被混写 cr=' + cr + ' lf=' + lf);
  assert.ok(cr > 3, '输出应当仍是 CRLF');
  // 纯 LF 文件不得被引入 CR
  const lf2 = lib.upsertFrontmatterFields(['---', 'record: b', '---', '', '正文'].join('\n') + '\n', { ccg_status: 'cleared' });
  assert.ok(!lf2.text.includes('\r'), 'LF 文件被写入 CR');
});

test('upsertFrontmatterFields：没有 frontmatter / 未闭合 ⇒ 拒绝写入（不许猜结构）', () => {
  assert.throws(() => lib.upsertFrontmatterFields('# 标题\n\n正文\n', { ccg_status: 'cleared' }), /没有 frontmatter/);
  assert.throws(() => lib.upsertFrontmatterFields('---\nrecord: b\n\n正文\n', { ccg_status: 'cleared' }), /没有闭合/);
});

test('证据评论必须写出两个完整 sha、钉死说明，并明写它不是密码学签名', () => {
  const body = lib.buildEvidenceComment({
    recordFile: '.ccg/reviews/abc.json', mode: 'dual', status: 'self_play_resolved', rounds: 3,
    fingerprint: '7cc60bf646efdbf8', payloadSha: SHA64, baseSha: 'cd'.repeat(20), headSha: 'ef'.repeat(20),
  })
  assert.ok(body.includes(SHA64), '没有载荷哈希 ⇒ 判据无从复核「裁决是否描述这份代码」')
  assert.ok(body.includes('cd'.repeat(20)), '必须写出 base 的具体 sha：' + body.slice(0, 200))
  assert.ok(body.includes('ef'.repeat(20)), '必须写出 head 的具体 sha（内部评审 I6：只钉 base 等于范围仍有一半是移动指针）')
  assert.ok(!body.includes('..HEAD'), '范围里不得再出现字面量 HEAD')
  assert.match(body, /不是密码学签名/, '不写清强度边界 ⇒ 下一个读者会把它当强证明')
  assert.match(body, /diff\.context=3|--no-ext-diff/, '必须说明 diff 参数已被钉死，否则换机不等会被当噪声')
})

// ── 刀1 补：base 口径与字段清单（2026-10-16 自引入缺陷纠正后新增）──

test('LEDGER_FIELDS 必须含 ccg_payload_base —— 锚不记 base 就没法在主干移动后被复核', () => {
  assert.ok(lib.LEDGER_FIELDS.includes('ccg_payload_base'), JSON.stringify(lib.LEDGER_FIELDS));
  // 顺序也是合同：写入按这个顺序落盘，两次运行字节必须相同（否则回填 PR 会造出无意义的重排 diff）
  assert.deepStrictEqual(lib.LEDGER_FIELDS,
    ['ccg_mode', 'ccg_status', 'ccg_rounds', 'ccg_evidence', 'ccg_payload_sha256', 'ccg_payload_base', 'ccg_payload_head', 'ccg_written_by']);
});

test('resolveBaseSha：ref 名解析成完整 sha；解析不到必须抛错，不得返回空串', () => {
  const { dir, git } = newRepo();
  const sha = git(['rev-parse', 'HEAD']).trim();
  assert.strictEqual(lib.resolveBaseSha({ repo: dir, base: 'HEAD' }), sha);
  assert.strictEqual(lib.resolveBaseSha({ repo: dir, base: sha }), sha, '已经是 sha 必须原样返回（幂等）');
  assert.throws(() => lib.resolveBaseSha({ repo: dir, base: 'no-such-ref-xyz' }), /解析不到提交/);
  assert.throws(() => lib.resolveBaseSha({ repo: dir, base: '' }), /缺 base/);
});

test('assertPayloadNonEmpty：0 字节载荷必须抛（空提交/取错 base 的形态与「已审完」在哈希上无法区分）', () => {
  assert.throws(() => lib.assertPayloadNonEmpty({ sha: SHA64, bytes: 0 }), /0 字节/);
  assert.throws(() => lib.assertPayloadNonEmpty({ sha: SHA64 }), /0 字节/, 'bytes 缺席不得被当成「有载荷」');
  assert.throws(() => lib.assertPayloadNonEmpty({ sha: 'zz', bytes: 10 }), /64hex/);
  assert.strictEqual(lib.assertPayloadNonEmpty({ sha: SHA64, bytes: 7 }).bytes, 7);
});

test('computeReviewPayload 的 bytes 必须真的反映改动量（base==head ⇒ 0，改一笔 ⇒ >0）', () => {
  const { dir, git } = newRepo();
  const base = git(['rev-parse', 'HEAD']).trim();
  assert.strictEqual(lib.computeReviewPayload({ repo: dir, base, head: base }).bytes, 0, '与自己比必须是空 diff');
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 2;\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'code']);
  assert.ok(lib.computeReviewPayload({ repo: dir, base, head: 'HEAD' }).bytes > 0, '改了源码而字节仍为 0 ⇒ 载荷根本没读到 diff');
});

test('EVIDENCE_URL_RE 必须认 gh pr comment 的真实产出，并拒绝「只给 PR 链接」这种自证', () => {
  for (const good of [
    'https://github.com/o/r/pull/1234#issuecomment-5474171300',
    'https://github.com/o/r/pull/1234#discussion_r9876543210',
  ]) assert.ok(lib.EVIDENCE_URL_RE.test(good), '应接受：' + good);
  for (const bad of [
    'https://github.com/o/r/pull/1234',
    'https://github.com/o/r/pull/1234#issuecomment-',
    'https://example.com/o/r/pull/1234#issuecomment-1',
    'https://github.com/o/pull/1234#issuecomment-1',
    'http://github.com/o/r/pull/1234#issuecomment-1',
    '',
  ]) assert.ok(!lib.EVIDENCE_URL_RE.test(bad), '应拒绝：' + bad);
});



// ── lib 第二轮（内部评审处置）──

test('upsertFrontmatterFields：混合行尾文件里**未被点名的行必须逐字节不动**（曾统一回写行尾，changed 还谎报 1）', () => {
  // 这条是两份独立评审各自复现的那一格：旧实现先 replace(/\r\n/g,'\n') 再 join(探测到的多数派)，
  // 于是「纯 LF 且未被点名」的行被补上 \r（实测 CR 2→8），而 changed 只报 1。
  // 那既是 AGENTS.md 明文禁止的"探测多数派后统一回写"，又让 changed 与真实改动面不一致。
  const mixed = ['---', 'record: x\r', 'reason: keep me', '---', '', '正文'].join('\n') + '\n'
  const before = mixed.split('\n')
  const r = lib.upsertFrontmatterFields(mixed, { ccg_status: 'cleared' })
  const after = r.text.split('\n')
  assert.strictEqual(after[2], before[2], 'LF-only 的 reason 行被改了行尾：' + JSON.stringify(after[2]))
  assert.strictEqual(after[1], before[1], 'CRLF 的 record 行被动了')
  assert.ok(after.includes('ccg_status: cleared'), '新键必须落到 frontmatter 里')
  assert.strictEqual(r.changed, 1, 'changed 必须等于真实变动行数（插一行算一行），不得谎报也不得漏报')
  // 未点名行的行尾档必须原样保留：文件仍然是"混合"，而不是被抹成单一档
  const crOf = (s) => (s.match(/\r/g) || []).length
  assert.strictEqual(crOf(r.text), crOf(mixed) + 0, '插入行的行尾跟随闭合行；未点名行不得被改写：'
    + 'before=' + crOf(mixed) + ' after=' + crOf(r.text))
})

test('diff 生成参数被钉死：本机 [diff] 配置改写时，同一份代码的载荷 sha MUST 仍相等', () => {
  // 内部评审 C2 实测：default / diff.noprefix=true / diff.context=9 三个 sha 互不相等
  // （bytes 180943 / 180693 / 210397）。写入侧跑在开发者机器、判据跑在 ubuntu runner，
  // 不钉死就等于把判据的可复核性交给"这台机器的全局配置"。
  const { dir, git } = newRepo()
  const base = git(['rev-parse', 'HEAD']).trim()
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 2;\n')
  git(['add', '-A']); git(['commit', '-q', '-m', 'code'])
  const sha = lib.computeReviewPayloadSha({ repo: dir, base, head: 'HEAD' })
  const withEnv = (k, v) => {
    const prev = Object.assign({}, process.env)
    process.env.GIT_CONFIG_COUNT = '1'
    process.env.GIT_CONFIG_KEY_0 = k
    process.env.GIT_CONFIG_VALUE_0 = v
    try { return lib.computeReviewPayloadSha({ repo: dir, base, head: 'HEAD' }) } finally {
      for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) delete process.env[key]
    }
    void prev
  }
  assert.strictEqual(withEnv('diff.noprefix', 'true'), sha, '本机开了 diff.noprefix 就得到另一个 sha ⇒ 判据跨机必假红')
  assert.strictEqual(withEnv('diff.context', '9'), sha, 'diff.context 同理')
  // 负控：真的改了代码，sha 必须变（钉参数不等于把 diff 算死）
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const a = 3;\n')
  git(['add', '-A']); git(['commit', '-q', '-m', 'code2'])
  assert.notStrictEqual(lib.computeReviewPayloadSha({ repo: dir, base, head: 'HEAD' }), sha)
})

test('空 diff 常量哈希必须被拒（sha256("") 人人可算，记录-only 的变更集会让它自动"同源"）', () => {
  assert.match(lib.EMPTY_DIFF_SHA256, /^[0-9a-f]{64}$/)
  assert.throws(() => lib.assertPayloadNonEmpty({ sha: lib.EMPTY_DIFF_SHA256, bytes: 0 }), /0 字节/)
  // bytes 谎报非零也不放行：常量本身就该拒
  assert.throws(() => lib.assertPayloadNonEmpty({ sha: lib.EMPTY_DIFF_SHA256, bytes: 99 }), /0 字节|空 diff/)
  assert.doesNotThrow(() => lib.assertPayloadNonEmpty({ sha: SHA64, bytes: 3 }))
})

test('非字符串的 ref（未取值的旗标变成的 true）必须当场抛，不得静默算出一个哈希', () => {
  assert.throws(() => lib.resolveBaseSha({ repo: process.cwd(), base: true }), /缺 base/)
  assert.throws(() => lib.computeReviewPayload({ repo: process.cwd(), base: true, head: 'HEAD' }), /缺 base|ref/)
  assert.throws(() => lib.resolveCommitSha({ repo: process.cwd(), ref: false }), /缺 base|ref/)
})

test('payloadArgs 的钉参数位置必须对（`-c` 在子命令前、`--no-ext-diff` 在子命令后）', () => {
  const a = lib.payloadArgs('/r', 'b'.repeat(40), 'c'.repeat(40))
  const di = a.indexOf('diff')
  assert.ok(di > 0, '必须有 diff 子命令：' + JSON.stringify(a))
  assert.ok(a.indexOf('-c') < di, '-c 必须在 diff 之前（它是 git 的全局选项）')
  assert.ok(a.indexOf('--no-ext-diff') > di, '--no-ext-diff 必须在 diff 之后（它是 diff 自己的选项）')
  assert.ok(a.indexOf('--no-textconv') > di, '同上；实测放错位置时 git 直接 unknown option，判据一次都没跑起来')
  assert.ok(a.includes(':(exclude)openspec/records'), '排除面必须在 -- 之后作为 pathspec：' + JSON.stringify(a))
})
