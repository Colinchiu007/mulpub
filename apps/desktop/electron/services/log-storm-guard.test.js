import { describe, expect, it } from 'vitest'

const { createLogSampler } = require('./log-sampler')

describe('createLogSampler 日志风暴护栏（T7.1/T7.2）', () => {
  it('默认配置：100 次重试下 notify 调用数被硬上限约束', () => {
    const shouldLog = createLogSampler() // 默认 sampleEvery=10, maxBurst=50
    let logged = 0
    for (let attempt = 1; attempt <= 100; attempt++) {
      if (shouldLog(attempt, { isLast: attempt === 100 })) logged++
    }
    // 首(1) + 中间每 10 抽一次(10,20,...,90) + 末(100) = 11，远小于 maxBurst=50
    expect(logged).toBeLessThanOrEqual(50)
    expect(logged).toBe(11)
  })

  it('首条与末条在合理 burst 下必记', () => {
    const shouldLog = createLogSampler({ sampleEvery: 10, maxBurst: 5 })
    expect(shouldLog(1, {})).toBe(true) // 首条
    expect(shouldLog(100, { isLast: true })).toBe(true) // 末条（burst 未耗尽）
  })

  it('maxBurst 硬上限：中间抽样永不超过 maxBurst', () => {
    const burst = 3
    const shouldLog = createLogSampler({ sampleEvery: 1, maxBurst: burst })
    let logged = 0
    for (let attempt = 1; attempt <= 1000; attempt++) {
      if (shouldLog(attempt, { isLast: attempt === 1000 })) logged++
    }
    // burst 优先：第 3 次已占满 burst，第 1000 次（末条）因硬上限被丢弃
    expect(logged).toBeLessThanOrEqual(burst)
  })

  it('中间按 sampleEvery 步长抽样', () => {
    const shouldLog = createLogSampler({ sampleEvery: 5, maxBurst: 100 })
    const hits = []
    for (let attempt = 1; attempt <= 20; attempt++) {
      if (shouldLog(attempt, {})) hits.push(attempt)
    }
    expect(hits).toEqual([1, 5, 10, 15, 20])
  })

  it('非法参数回退默认（sampleEvery 非正 / maxBurst 非数字）', () => {
    const shouldLog = createLogSampler({ sampleEvery: 0, maxBurst: -1 })
    let logged = 0
    for (let attempt = 1; attempt <= 100; attempt++) {
      if (shouldLog(attempt, { isLast: attempt === 100 })) logged++
    }
    expect(logged).toBe(11) // 回退默认 sampleEvery=10 → 1,10,...,90,100
  })
})
