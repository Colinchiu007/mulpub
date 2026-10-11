'use strict'
/**
 * desktop-shards 分片旗标送达判据的锁（node --test，接在 QG Static 的 Gate 3）。
 * 每一条都要求"能测到它声称测的东西"：负控与合规形态都必须跑，否则只是把缺陷钉成契约。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const checker = require('./check-desktop-shard-forwarding.js')

const ROOT = path.resolve(__dirname, '..')
const WF = path.join(ROOT, checker.WORKFLOW)

test('结构层：workflow 的 shard 实参里没有裸 "--"，且 --shard 还在', () => {
  const argv = checker.parseShardArgv(fs.readFileSync(WF, 'utf8'))
  assert.ok(argv.length >= 4, '解析到的实参太少（' + argv.length + '），判据可能读错了数组：' + JSON.stringify(argv))
  assert.ok(argv.some((t) => t.startsWith('--shard=')), '分片旗标不见了：' + JSON.stringify(argv))
  assert.ok(!argv.includes('--'), '裸 "--" 又回到 -ArgumentList 里 ⇒ pnpm 会原样交给脚本，vitest 到此停止解析选项')
})

test('行为层：真的跑一次 pnpm，被调用方自己承认收到了 --shard', () => {
  const r = checker.check({ root: ROOT })
  assert.ok(r.received, '行为层探针没拿到 argv ⇒ 判据失明，不得当通过：' + JSON.stringify(r.problems))
  assert.ok(r.received.some((t) => String(t).startsWith('--shard=')),
    'vitest 侧实际没收到 --shard ⇒ 分片仍然失效。实收=' + JSON.stringify(r.received))
  assert.ok(!r.received.includes('--'), '被调用方收到了裸 "--" ⇒ 它后面所有旗标都会被 vitest 当成位置参数。实收=' + JSON.stringify(r.received))
  // check() 现在可注入 probe；这条钉住"默认档走的是真链路"——matrix 占位符必须已被替换成实值。
  // 反证（变异 F）：把默认值改成 (a)=>a 原样回吐时，本断言必须变红。
  assert.ok(r.received.includes('--shard=1/2'),
    'check() 的默认探针没有真的执行 matrix 替换 + pnpm 转发（实收里没有 --shard=1/2）：' + JSON.stringify(r.received))
  assert.ok(r.ok, '整体判据不成立：\n  ' + r.problems.join('\n  '))
})

test('负控：把坏形态塞进去，探针必须真的看见那个 "--"（否则上一条断言是恒真的）', () => {
  const broken = ['--filter', checker.WORKFLOW && '@multi-publish/desktop', 'test', '--', '--shard=${{ matrix.shard }}']
  const got = checker.runArgv(broken)
  assert.ok(got.includes('--'), '负控失效：手工插入的裸 "--" 没被送到被调用方 ⇒ 行为层探针没有眼睛')
  assert.ok(got.some((t) => t === '--shard=1/2'), '负控里连 --shard 都没传到，说明探针根本没在跑这条链路')
})

test('合规形态必须为绿：七个 vitest 旗标全部原样送达，不得被 pnpm 吃掉任何一个', () => {
  const argv = checker.parseShardArgv(fs.readFileSync(WF, 'utf8')).filter((t) => t !== '--')
  const got = checker.runArgv(argv).slice(1)
  const want = argv.map((t) => t.split('${{ matrix.shard }}').join('1/2')).filter((t) => t !== '@multi-publish/desktop' && t !== '--filter' && t !== 'test')
  for (const w of want) assert.ok(got.includes(w), '旗标 ' + w + ' 没送达；被调用方实收=' + JSON.stringify(got))
  assert.equal(got.length, want.length, '送达的实参数量与发出的不一致（有被吞或被注入）：want=' + JSON.stringify(want) + ' got=' + JSON.stringify(got))
})

test('负控失效必须出声：探针不再把 "--" 送进去时 check() 必须判红（否则行为层两条断言是恒真的）', () => {
  // 这条锁的是"负控自身失效"这一状态 —— 它无法用真 pnpm 构造（真链路现在是好的），
  // 所以 check() 暴露 probe 注入缝。反证：把 check() 里的 `if (control && !control.includes('--'))`
  // 改成 `if (false && …)`，本用例必须变红（变异 C）。
  const swallowing = (argv) => argv.filter((t) => t !== '--')
  const r = checker.check({ root: ROOT, probe: swallowing })
  assert.ok(r.problems.some((p) => /负控失效/.test(p)),
    '探针变盲却没有任何问题被报告 ⇒ 行为层那两条断言无从成立：' + JSON.stringify(r.problems))
  assert.equal(r.ok, false, '负控失效时整体判据不得为绿')
})

test('第二落点：全仓 workflow 里"反引号续行的下一行是注释"必须 0 命中', () => {
  // 本轮改这个步骤时我自己就踩了一次：注释插在 Start-Process 的续行之后，
  // pwsh 解析器**一个错都不报**（三态实测：A/B/C 都是 PARSE_ERRORS=0），
  // 但 CommandAst 的 extent 从 334 字符塌成 34，-ArgumentList 整块掉队 ⇒ 进程带着 0 个参数被拉起来。
  // 所以"语法能过"不是证据，判据只能是文本级的相邻性。
  const r = checker.checkContinuations({ root: ROOT })
  assert.ok(r.files >= 10, '只扫到 ' + r.files + ' 个 workflow，扫描域可疑（判据可能读错了目录）')
  assert.deepEqual(r.problems, [], '续行被注释吃掉的形态又回来了：\n  ' + r.problems.join('\n  '))
})

test('第二落点的判据本身：坏形态必须命中，散文里的行内代码闭合不得命中', () => {
  const broken = ['          $p = Start-Process -FilePath "pnpm.cmd" `', '          # 一句说明', '            -ArgumentList @(', '            -NoNewWindow'].join('\r\n')
  assert.equal(checker.findContinuationSevers(broken).length, 1, '坏形态没命中 ⇒ 判据是恒假的')
  // 合规形态必须为绿：注释行自身以反引号收尾（本仓散文里大量这样写行内代码），不得算续行。
  const prose = ['# 命令 `pnpm --filter x test:e2e`', '# 下一行说明'].join('\r\n')
  assert.deepEqual(checker.findContinuationSevers(prose), [], '散文里的行内代码闭合被误判 ⇒ 这条锁会打红合规 PR')
})

test('锚点不得被说明文字劫持：注释里原样写出 -ArgumentList @(...) 时，判据仍取真实代码块', () => {
  // 本轮实测：我在 workflow 里加的那句"位置纪律"注释原样写了 `-ArgumentList @(...)`，
  // 惰性正则当场从注释起锚，把 -FilePath "pnpm.cmd" 也当成实参收进来 —— 锁没报错，只是开始测错的东西。
  const wf = fs.readFileSync(WF, 'utf8')
  const argv = checker.parseShardArgv(wf)
  assert.ok(!argv.includes('pnpm.cmd'), '解析把 -FilePath 的实参当成了分片旗标 ⇒ 起锚落到了注释上：' + JSON.stringify(argv))
  assert.equal(argv.filter((t) => t.startsWith('--shard=')).length, 1, 'shard 旗标应当恰好一个：' + JSON.stringify(argv))
  const CODE = '            -ArgumentList @('
  const HINT = '          # 说明文字里原样写了 `-ArgumentList @(...)` 这种代码字样\r\n' + CODE
  assert.ok(wf.split(CODE).length - 1 >= 1, '锚点行不见了，这条对照失效')
  const withExtraHint = wf.split(CODE).join(HINT)
  assert.deepEqual(checker.parseShardArgv(withExtraHint), argv, '多加一行含同样字样的注释后解析结果漂移 ⇒ 注释没有被抹空')
})

test('反失明：解析不到步骤 / 数组 / 空数组时一律抛错，不得返回空当"没问题"', () => {
  assert.throws(() => checker.parseShardArgv('jobs:\n  other:\n    steps: []\n'), /SHARD_STEP_NOT_FOUND/)
  assert.throws(() => checker.parseShardArgv('- name: "Desktop tests shard x"\n  run: |\n    nothing here\n'), /ARGUMENT_LIST_NOT_FOUND/)
})

test('不重复造判据：Gate 4 的 "--" 由 workflow-contract 那条 doesNotMatch 守着，且它必须还在', () => {
  const contract = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'workflow-contract.test.js'), 'utf8')
  assert.ok(/test:\(affected\|all\)[^)]*"--"/.test(contract),
    'workflow-contract 里那条"exclude 不得落回 nx 转发区"的反向锁不见了 —— 那正是 #3315 的防线，别两边都以为对方在守')
  assert.ok(/check-gate4-selection/.test(contract), 'Gate 4 选择集自检的接线锁也不见了')
})
