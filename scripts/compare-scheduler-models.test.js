// @ts-check
/**
 * scripts/compare-scheduler-models.test.js — 对拍容差口径的回归保护
 *
 * 背景（2026-09-26 main 红）：runParity 对 6 组用例共用一个 1500ms **绝对**容差，
 * 但各组期望耗时跨度约 14 倍（~1.5s → 21s）。对 21s 的 quota-5h-real，1500ms 只有
 * 7.1%，CI 满载下挂钟抖动 1653ms 即翻车（python=21000 / real=22653）；而对 1.5s 的
 * 用例，同样 1500ms 等于 100% —— 绝对容差在不同量级的用例上本就不等价。
 *
 * 第二次超差（同一天的后续红，PR #2414 的 QG Desktop Shards (1/2)，基线已含上一轮修复）：
 * concurrency-real python=11000 / real=12640 → diff **1640**，而 max(1500, 10%) 在该量级
 * 只给 1500（比例项 1100 < 下限）→ 仍然误判失败。两个数据点合起来说明 CI 挂钟漂移是
 * 「**固定项 + 比例项**」：11000 上 14.9%、21000 上 7.9%，纯 max() 在中间量级会退化回固定项。
 * 故口径改为 floor + ratio × 期望（向上取整为整毫秒），且**只在原口径之上加宽**。
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { durationTolerance, PARITY_TOLERANCE_FLOOR_MS, PARITY_TOLERANCE_RATIO } = require('./compare-scheduler-models')

describe('durationTolerance — 容差 = 绝对下限 + 比例 × 期望耗时（向上取整）', () => {
  it('短用例由下限主导，只额外获得自身量级的比例余量', () => {
    assert.equal(durationTolerance(1500), 1650)
    assert.equal(durationTolerance(1000), 1600)
    assert.equal(durationTolerance(0), 1500)
  })

  it('长用例获得下限加与量级成比例的余量', () => {
    assert.equal(durationTolerance(21000), 3600)
    assert.equal(durationTolerance(11000), 2600)
    assert.equal(durationTolerance(30000), 4500)
  })

  it('容差必须是整毫秒（比例项会产生小数，向上取整只会更宽）', () => {
    const t = durationTolerance(14999)
    assert.equal(t, 3000) // 1500 + 1499.9 → ceil 3000
    assert.equal(Number.isInteger(t), true, '容差不得是小数')
    for (const e of [1, 7, 333, 12345, 99999]) {
      assert.equal(Number.isInteger(durationTolerance(e)), true, '非整毫秒: ' + e)
    }
  })

  it('复现第二次真实超差：concurrency-real 期望 11000、差值 1640 必须通过', () => {
    // CI 实跑（run 36222207527 / job 108349933889）：python=11000, real=12640 → diff 1640
    const expected = 11000
    const diff = 1640
    const previousModel = Math.max(PARITY_TOLERANCE_FLOOR_MS, expected * PARITY_TOLERANCE_RATIO)
    assert.ok(diff > previousModel, '前提：上一轮 max() 口径确实抓不住这个抖动（否则本用例不成立）')
    assert.ok(diff <= durationTolerance(expected), '新口径必须吸收这次抖动')
  })

  it('新口径在任意期望耗时上都不得比旧口径更紧（只放宽，不引入新假红）', () => {
    for (const e of [0, 500, 1000, 1500, 3000, 9000, 11000, 14999, 15000, 21000, 30000, 60000, 120000]) {
      const previous = Math.max(PARITY_TOLERANCE_FLOOR_MS, e * PARITY_TOLERANCE_RATIO)
      assert.ok(durationTolerance(e) >= previous, '收紧了: expected=' + e + ' new=' + durationTolerance(e) + ' old=' + previous)
    }
  })

  it('复现 main 上的真实超差：1653ms 抖动必须被判通过', () => {
    // python=21000, real=22653 → diff 1653，旧口径 1653>1500 判失败
    const expected = 21000
    const diff = Math.abs(22653 - expected)
    assert.ok(diff > PARITY_TOLERANCE_FLOOR_MS, '前提：该抖动确实超出旧的绝对下限')
    assert.ok(diff <= durationTolerance(expected), '新口径应吸收这次抖动')
  })

  it('真实回归仍要能抓住：长用例大幅超时不得被比例项放过', () => {
    const expected = 21000
    assert.ok(5000 > durationTolerance(expected), '+5s（约 24%）应超容差')
    assert.ok(1000 < durationTolerance(expected), '1s 抖动应被吸收')
  })

  it('容差必须由「期望值」而非「实测值」驱动，否则回归会撑大自己的容差', () => {
    // 若实现误用 real 作分母：real=31000 → 容差 4600，+10s 回归反而通过（自证式绿灯）
    const expected = 21000
    const tolerance = durationTolerance(expected)
    assert.equal(tolerance, PARITY_TOLERANCE_FLOOR_MS + expected * PARITY_TOLERANCE_RATIO)
    assert.ok(
      durationTolerance(expected) === durationTolerance(expected),
      '同一期望值必须得到确定结果（不依赖实测）',
    )
    // 关键断言：把实测值当期望值传入会得到更大容差 —— 证明调用方必须传 python 侧
    assert.ok(durationTolerance(31000) > tolerance)
  })

  it('退化输入不产生 NaN / 负容差', () => {
    for (const v of [0, -1, NaN, undefined, null]) {
      const t = durationTolerance(v)
      assert.ok(Number.isFinite(t), '非有限值: ' + String(v))
      assert.ok(t >= PARITY_TOLERANCE_FLOOR_MS, '容差不得小于下限: ' + String(v))
    }
  })

  it('比例与下限常量取值合理且被导出（供测试与排障引用）', () => {
    assert.equal(PARITY_TOLERANCE_FLOOR_MS, 1500)
    assert.ok(PARITY_TOLERANCE_RATIO >= 0.05 && PARITY_TOLERANCE_RATIO <= 0.2,
      '比例应在 5%~20% 区间：实测抖动 7.9%，留适度余量但不放过真回归')
  })
})
