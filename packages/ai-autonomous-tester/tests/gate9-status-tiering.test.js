'use strict'
/**
 * 状态分层接进审计链路的集成锁（2026-10-12，Gate 9 第 3 层）。
 *
 * 锁三件事：
 *   ① parser 出口带 statusStats，条目带 status/auditScope；
 *   ② requirements-runner 只把 auditScope=true 的条目交给 LLM（分母口径）；
 *   ③ 被分层的条目在结果里显式可见（excludedDetails），防止「覆盖率上升」
 *      被误读成「实现变多了」。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PKG = path.resolve(__dirname, '..', 'src')
const { MultiDocParser } = require(path.join(PKG, 'parsers', 'multi-doc-parser.js'))

function makeDoc(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate9-prd-'))
  const p = path.join(dir, 'PRD.md')
  fs.writeFileSync(p, lines.join('\n'), 'utf8')
  return { path: p, dir }
}

test('parser 给条目附加 status/auditScope，并汇总 statusStats', async () => {
  const { path: docPath, dir } = makeDoc([
    '# 产品需求',
    '## 功能列表',
    '- 一键发布【已实现】',
    '- 播客托管【规划中】',
    '- 深色模式【不做】',
    '- 旧版发布链路【历史】',
    '- 未标注的功能项',
  ])
  try {
    const parser = new MultiDocParser()
    const res = await parser.parseAll([docPath])
    const byName = Object.fromEntries(res.items.map((i) => [i.name, i]))
    assert.equal(byName['一键发布【已实现】'].status, 'implemented')
    assert.equal(byName['一键发布【已实现】'].auditScope, true)
    assert.equal(byName['播客托管【规划中】'].status, 'planned')
    assert.equal(byName['播客托管【规划中】'].auditScope, false)
    assert.equal(byName['深色模式【不做】'].auditScope, false)
    assert.equal(byName['旧版发布链路【历史】'].auditScope, false)
    // 未标注 → unknown 且仍进审计（既有行为不缩小）
    assert.equal(byName['未标注的功能项'].status, 'unknown')
    assert.equal(byName['未标注的功能项'].auditScope, true)
    // 统计口径唯一
    assert.ok(res.statusStats, 'parseAll 必须返回 statusStats')
    assert.ok(res.statusStats.implemented >= 1)
    assert.ok(res.statusStats.planned >= 1)
    // 分层必须生效（2026-10-12 CI 事故回归锁）：无论判据来自仓库根真源还是包内兜底，
    // status 都必须是 implemented 而非 unknown —— CI 上正是加载不到判据导致全 unknown。
    // statusCriteriaInline 只回答「用了哪份」，不影响分层结果。
    assert.equal(typeof res.statusCriteriaInline, 'boolean', '必须报告判据来源')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('判据一致性：包内兜底判据与仓库根单一真源逐项相同', () => {
  // 2026-10-12 CI 事故后的根本解：判据内联一份进包里（CI 上 nx 布局加载不到仓库根），
  // 两份必须一致，否则「本地用真源、CI 用兜底」会得出不同分层结果。
  // 真源可加载时逐项比对；加载不到时跳过（由上面的分层锁兜底）。
  const path = require('node:path')
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
  let truth = null
  try {
    truth = require(path.join(repoRoot, 'scripts', 'gate9-prd-status.js'))
  } catch {
    truth = null
  }
  if (!truth) {
    // 本机/CI 都加载不到真源：内联兜底是唯一判据，无一致性可校
    return
  }
  const { MultiDocParser } = require(path.join(__dirname, '..', 'src', 'parsers', 'multi-doc-parser.js'))
  assert.deepEqual(
    MultiDocParser.INLINE_STATUS_TAGS(),
    truth.STATUS_TAGS,
    '内联判据表与单一真源不一致：改判据必须同时改 scripts/gate9-prd-status.js 与本文件'
  )
  assert.deepEqual(MultiDocParser.INLINE_STATUS_ORDER(), truth.STATUS_ORDER)

  // 行为等价：同一批输入两种实现必须给出相同 status
  const probes = [
    '一键发布【已实现】', '播客托管【规划中】', '深色模式【不做】', '旧版链路【历史】',
    '未标注项', '【已实现】与【规划中】并存', 'Dark mode [implemented]', 'x [planned] y',
    '历史【历史】项', "won't do 项",
  ]
  for (const p of probes) {
    assert.deepEqual(
      MultiDocParser._inlineParseItemStatus(p),
      truth.parseItemStatus(p),
      `判据行为不一致: ${p}`
    )
    assert.equal(MultiDocParser._inlineShouldAudit('implemented'), truth.shouldAudit('implemented'))
    assert.equal(MultiDocParser._inlineShouldAudit('planned'), truth.shouldAudit('planned'))
  }
})

test('剥离仓库根后分层仍生效（内联兜底路径）', async () => {
  // 复现 CI 形状：把包复制到没有 scripts/ 同级的位置，此时仓库根真源必然加载不到，
  // 必须靠内联兜底让分层继续生效（而不是退化成全 unknown）。
  const path = require('node:path')
  const fs = require('node:fs')
  const os = require('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate9-inline-'))
  try {
    fs.cpSync(path.join(__dirname, '..', 'src'), path.join(tmp, 'src'), { recursive: true })
    const doc = path.join(tmp, 'PRD.md')
    fs.writeFileSync(doc, '# 产品需求\n## 功能列表\n- 一键发布【已实现】\n- 播客托管【规划中】\n', 'utf8')
    const prevCwd = process.cwd()
    process.chdir(tmp) // cwd 也无 scripts/
    try {
      const { MultiDocParser } = require(path.join(tmp, 'src', 'parsers', 'multi-doc-parser.js'))
      const parser = new MultiDocParser()
      const res = await parser.parseAll([doc])
      const byName = Object.fromEntries(res.items.map((i) => [i.name, i]))
      assert.equal(byName['一键发布【已实现】'].status, 'implemented', '内联兜底未生效：分层退化')
      assert.equal(byName['播客托管【规划中】'].status, 'planned')
      assert.equal(byName['播客托管【规划中】'].auditScope, false)
      assert.equal(res.statusCriteriaInline, true, '此场景必须报告用了内联兜底判据')
    } finally {
      process.chdir(prevCwd)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('requirements-runner：分层条目不进 LLM 输入、且在 excludedDetails 可见', async () => {
  const { RequirementsTestRunner } = require(path.join(PKG, 'runners', 'requirements-runner.js'))
  const { path: docPath, dir } = makeDoc([
    '# 产品需求',
    '## 功能列表',
    '- 一键发布【已实现】',
    '- 播客托管【规划中】',
  ])
  try {
    const seen = {}
    const runner = new RequirementsTestRunner({
      llmFn: async (prompt) => {
        // 记录交给 LLM 的条目名（factsBlock 会列出 prdItems）
        seen.prompt = prompt
        return JSON.stringify({
          task: 'coverage',
          decision: 'PASS',
          score: 1,
          items: [{ prdFeature: '一键发布【已实现】', status: 'COVERED', matchedImpl: 'publish', evidence: 'x', reasoning: 'y' }],
          summary: { covered: 1, partial: 0, missing: 0, coverageRate: 1 },
        })
      },
    })
    const res = await runner.runTests({ docPaths: [docPath], srcDir: path.join(__dirname, 'fixtures-empty-src') })
    // ① 规划项不得出现在 prompt 里（未交给 LLM）
    assert.ok(!String(seen.prompt).includes('播客托管'), '分层条目被交给了 LLM（分母口径失效）')
    assert.ok(String(seen.prompt).includes('一键发布'), '应审计条目未交给 LLM')
    // ② 分母用审计后子集
    assert.equal(res.totalPrdFeatures, 1, 'totalPrdFeatures 应为审计后条数')
    assert.equal(res.totalPrdFeaturesRaw, 2, 'totalPrdFeaturesRaw 保留原始条数')
    // ③ 分层条目显式可见
    assert.equal(res.excludedCount, 1)
    assert.equal(res.excludedDetails[0].testName, '播客托管【规划中】')
    assert.equal(res.excludedDetails[0].itemStatus, 'planned')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
