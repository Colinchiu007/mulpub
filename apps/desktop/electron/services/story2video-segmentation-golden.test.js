// @vitest-environment node
/**
 * Story2Video JS 镜像 × Python sidecar 金标对账。
 *
 * 直接比 JS 与 sidecar 的输出，而不是只靠「JS↔TS parity + TS↔sidecar 金标」传递。
 * 理由：传递证明只在两条判据都真的跑过时才成立，而 parity 的语料是共享向量（44 条），
 * 本对账的语料是另一批（18 条含真实文案）。两条链各自独立，少一条就留一个盲区。
 *
 * 金标来源：smart-sentence-splitter `scripts/gen_subtitle_python_golden.py`，禁止手改。
 * 详见 packages/story2video-engine/tests/sidecar-golden.test.ts 顶部的分工说明。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { splitTextToSubtitles } from './story2video-segmentation-engine'

const FIXTURES = resolve(
  import.meta.dirname,
  '../../../../packages/story2video-engine/tests/fixtures',
)

const load = (name) => JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf-8'))

const corpus = load('subtitle_parity_corpus.json')
const golden = load('subtitle_python_golden.json')
const lock = load('sidecar-parity.lock.json')

describe('JS 镜像 × Python sidecar 金标', () => {
  it('金标与对账锁的数据版本一致', () => {
    expect(golden.provenance.rulesLfSha256).toBe(lock.rulesLfSha256)
    expect(golden.provenance.vectorsLfSha256).toBe(lock.vectorsLfSha256)
  })

  it('语料与金标用例集一一对应', () => {
    const a = corpus.cases.map((c) => c.id).sort()
    const b = golden.cases.map((c) => c.id).sort()
    expect(b).toEqual(a)
  })

  for (const c of corpus.cases) {
    it(`用例 ${c.id} 与 sidecar 输出逐字一致`, () => {
      const expected = golden.cases.find((g) => g.id === c.id)
      expect(expected, `金标里缺少用例 ${c.id}`).toBeDefined()
      expect(splitTextToSubtitles(c.text)).toEqual(expected.blocks)
    })
  }
})
