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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
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
