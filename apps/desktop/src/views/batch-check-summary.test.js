// @ts-check
/**
 * batch-check-summary.test.js — 「一键检测」结果提示装配器的单元测试
 *
 * 被测性质（不是字符串存在性，而是**装配行为**）：
 *  - 一次操作只产出**一个** { level, message } 对象（不得返回数组让调用方循环弹）；
 *  - 段序恒为 计数 → 下一步 → 固化失败；
 *  - 空段不留下悬空分隔符（「；；」「，」空挂一律不允许）；
 *  - 级别只由三态结论决定：全部有定论 → success；有失效/未定论 → warning；
 *    固化失败**不参与定级**（原实现为它单独弹红色 error，是用户报「功能坏了」的来源）；
 *  - 结果集为空时返回 null（不弹空洞提示）。
 *
 * 用假 t 而不是真实 locales：本测试锁的是**装配逻辑**，文案内容由
 * accounts-batch-check-copy.test.js 逐字面量锁定，两边不重复。
 */
import { describe, expect, it } from 'vitest'
import { buildBatchCheckSummary, SEGMENT_SEPARATOR } from './batch-check-summary'

/** 假 t：把 key + params 变成可读的稳定串，便于断言段序与空段 */
function makeT () {
  const seen = []
  const t = (key, params) => {
    seen.push({ key, params })
    switch (key) {
      case 'accountsPage.batchCheckAllAllValid':
        return `ALL_VALID(${params.count})`
      case 'accountsPage.batchCheckAllDone':
        return `DONE(v=${params.valid},i=${params.invalid},u=${params.unconfirmed})`
      case 'accountsPage.checkHintsSummaryInline': {
        const parts = []
        if (params.relogin > 0) parts.push(`RELOGIN(${params.relogin})`)
        if (params.retry > 0) parts.push(`RETRY(${params.retry})`)
        return parts.length ? `HINT[${parts.join(';')}]` : ''
      }
      case 'accountsPage.checkHintsPersistFailedInline':
        return `PERSIST_FAIL(${params.count})`
      default:
        return `UNKNOWN(${key})`
    }
  }
  return { t, seen }
}

describe('buildBatchCheckSummary — 一次操作只产出一条提示', () => {
  it('返回单个对象（不是数组）：调用方无从循环弹多条', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 1, invalidCount: 1, unconfirmedCount: 1, reloginCount: 1, retryCount: 1, persistFailedCount: 1, t })
    expect(Array.isArray(out)).toBe(false)
    expect(out).toBeTypeOf('object')
    expect(out.level).toBeTypeOf('string')
    expect(out.message).toBeTypeOf('string')
  })

  it('最坏形态：三段齐全且段序为 计数 → 下一步 → 固化失败', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 4, invalidCount: 0, unconfirmedCount: 6, reloginCount: 5, retryCount: 1, persistFailedCount: 1, t })
    expect(out.level).toBe('warning')
    expect(out.message).toBe(
      `DONE(v=4,i=0,u=6)${SEGMENT_SEPARATOR}HINT[RELOGIN(5);RETRY(1)]${SEGMENT_SEPARATOR}PERSIST_FAIL(1)`
    )
  })

  it('段序不可交换：下一步段必须紧接计数段、固化失败必须在最后', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 1, invalidCount: 1, unconfirmedCount: 0, reloginCount: 0, retryCount: 2, persistFailedCount: 1, t })
    const idxCount = out.message.indexOf('DONE(')
    const idxHint = out.message.indexOf('HINT[')
    const idxPersist = out.message.indexOf('PERSIST_FAIL(')
    expect(idxCount).toBeGreaterThanOrEqual(0)
    expect(idxHint).toBeGreaterThan(idxCount)
    expect(idxPersist).toBeGreaterThan(idxHint)
  })
})

describe('buildBatchCheckSummary — 空段不得留下悬空分隔符', () => {
  it('无下一步、无固化失败：只有计数段，句尾无「；」', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 5, invalidCount: 1, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 0, t })
    expect(out.message).toBe('DONE(v=5,i=1,u=0)')
  })

  it('只有下一步：首尾都不是分隔符', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 5, invalidCount: 0, unconfirmedCount: 2, reloginCount: 2, retryCount: 0, persistFailedCount: 0, t })
    expect(out.message.startsWith(SEGMENT_SEPARATOR)).toBe(false)
    expect(out.message.endsWith(SEGMENT_SEPARATOR)).toBe(false)
    expect(out.message).toBe(`DONE(v=5,i=0,u=2)${SEGMENT_SEPARATOR}HINT[RELOGIN(2)]`)
  })

  it('只有固化失败：拼在计数段之后', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 5, invalidCount: 1, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 3, t })
    expect(out.message).toBe(`DONE(v=5,i=1,u=0)${SEGMENT_SEPARATOR}PERSIST_FAIL(3)`)
  })

  it('任何形态都不得出现连续两个分隔符（空段泄漏的指纹）', () => {
    const { t } = makeT()
    const combos = [
      { validCount: 1, invalidCount: 0, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 0 },
      { validCount: 1, invalidCount: 1, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 1 },
      { validCount: 0, invalidCount: 0, unconfirmedCount: 6, reloginCount: 0, retryCount: 0, persistFailedCount: 0 },
      { validCount: 0, invalidCount: 0, unconfirmedCount: 6, reloginCount: 5, retryCount: 1, persistFailedCount: 1 },
      { validCount: 4, invalidCount: 0, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 1 },
    ]
    for (const combo of combos) {
      const out = buildBatchCheckSummary({ ...combo, t })
      if (!out) continue
      expect(out.message.includes(SEGMENT_SEPARATOR + SEGMENT_SEPARATOR), `连续分隔符: ${out.message}`).toBe(false)
      expect(out.message.trim(), 'message 不得为纯空白').not.toBe('')
    }
  })
})

describe('buildBatchCheckSummary — 定级只由三态结论决定', () => {
  it('全部有定论 → success，且走短句（不带计数细节与下一步段）', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 7, invalidCount: 0, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 0, t })
    expect(out.level).toBe('success')
    expect(out.message).toBe('ALL_VALID(7)')
    expect(out.message).not.toContain('DONE(')
    expect(out.message).not.toContain('HINT[')
  })

  it('有失效 → warning', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 4, invalidCount: 1, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 0, t })
    expect(out.level).toBe('warning')
  })

  it('有未定论 → warning（未取到定论同样需要用户知道）', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 4, invalidCount: 0, unconfirmedCount: 6, reloginCount: 0, retryCount: 0, persistFailedCount: 0, t })
    expect(out.level).toBe('warning')
  })

  it('固化失败不把 success 抬成 warning：全正常 + 固化失败仍是 success', () => {
    // 原实现为固化失败单独弹红色 error；再早一版把整条汇总抬成 warning。
    // 正确形状：它是尾段，级别跟着它所在那句走。
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 7, invalidCount: 0, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 2, t })
    expect(out.level).toBe('success')
    expect(out.message).toBe(`ALL_VALID(7)${SEGMENT_SEPARATOR}PERSIST_FAIL(2)`)
  })

  it('固化失败也不把 warning 抬成 error：本模块永远不产出 error 级', () => {
    // error 级只留给「整个操作失败」（IPC reject），那在 Accounts.vue 的 catch 分支，
    // 不经本模块。这里锁死：装配器不可能产出 error。
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 0, invalidCount: 3, unconfirmedCount: 0, reloginCount: 3, retryCount: 0, persistFailedCount: 3, t })
    expect(out.level).not.toBe('error')
  })
})

describe('buildBatchCheckSummary — 边界输入', () => {
  it('结果集为空（无任何账号）→ null，调用方不弹 toast', () => {
    const { t } = makeT()
    expect(buildBatchCheckSummary({ validCount: 0, invalidCount: 0, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 0, t })).toBeNull()
  })

  it('三态计数全 0 但有固化失败 → 仍要提示（可见性不降）', () => {
    // 例如全部账号都被跳过、只有一条 persisted.ok===false。沉默会让用户以为检测成功了。
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 0, invalidCount: 0, unconfirmedCount: 0, reloginCount: 0, retryCount: 0, persistFailedCount: 1, t })
    expect(out).not.toBeNull()
    expect(out.level).toBe('success')
    expect(out.message).toContain('PERSIST_FAIL(1)')
  })

  it('缺 t 函数 → null（绝不抛异常到 UI 层）', () => {
    expect(buildBatchCheckSummary({ validCount: 1, invalidCount: 0, unconfirmedCount: 0 })).toBeNull()
    expect(buildBatchCheckSummary(null)).toBeNull()
    expect(buildBatchCheckSummary(undefined)).toBeNull()
  })

  it('计数缺省按 0 处理（不产生 NaN 段）', () => {
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: 1, t })
    expect(out).not.toBeNull()
    expect(out.message).not.toContain('NaN')
    expect(out.message).not.toContain('undefined')
  })

  it('负数/非法计数不得产生空 head 却又非 null 的形状', () => {
    // 防御：调用方传错时，宁可返回 null 也不要弹一句只有分隔符的提示
    const { t } = makeT()
    const out = buildBatchCheckSummary({ validCount: -1, invalidCount: -1, unconfirmedCount: -1, t })
    if (out) {
      expect(out.message.trim()).not.toBe('')
      expect(out.message).not.toBe(SEGMENT_SEPARATOR)
    }
  })
})
