/**
 * 看板新增区块的数据转换纯函数锁（dash-full-entitlement）。
 *
 * 这些函数存在的理由：三个新区块的取数都要做「IPC 信封 → 视图模型」的转换，
 * 而这类转换最容易把三种状态混为一谈：
 *   「没有数据」/「取数失败」/「不认识我（未登录）」
 * 前两种在界面上都是空，但含义相反：渲染成同一个空态，用户会把
 * 「功能坏了」读成「我还没发过东西」。所以转换层必须把三态显式分开，
 * 且每态都有对应的单测断言。
 */
import { describe, it, expect } from 'vitest'
import {
  toAccountHealthModel,
  toQueueStatusModel,
  toPatternBoardModel,
  AUTH_GATE,
} from './dashboard-panels-model'

describe('toAccountHealthModel（账号健康度）', () => {
  it('统计三态计数', () => {
    const res = {
      code: 0,
      data: [
        { accountId: 'a1', status: 'ok' },
        { accountId: 'a2', status: 'ok' },
        { accountId: 'a3', status: 'failed' },
        { accountId: 'a4', status: 'unknown' },
      ],
    }
    const m = toAccountHealthModel(res)
    expect(m.state).toBe('ready')
    expect(m.ok).toBe(2)
    expect(m.bad).toBe(1)
    expect(m.unknown).toBe(1)
    expect(m.badAccounts).toEqual(['a3'])
  })

  it('空数组是合法空态，不是错误', () => {
    const m = toAccountHealthModel({ code: 0, data: [] })
    expect(m.state).toBe('empty')
    expect(m.ok).toBe(0)
  })

  it('错误信封 → error，不渲染成 0（否则用户读成"全都没问题"）', () => {
    const m = toAccountHealthModel({ code: -1, message: 'boom' })
    expect(m.state).toBe('error')
  })

  it('未登录门禁 → auth，不渲染成 0', () => {
    const m = toAccountHealthModel({ code: -3, errorCode: 'AUTH_REQUIRED' })
    expect(m.state).toBe(AUTH_GATE)
  })

  it('data 缺失/非数组时降级 empty，不崩', () => {
    expect(toAccountHealthModel({ code: 0 }).state).toBe('empty')
    expect(toAccountHealthModel({ code: 0, data: 'oops' }).state).toBe('empty')
    expect(toAccountHealthModel(null).state).toBe('empty')
  })

  it('异常账号最多保留 5 个，多余计入 overflow', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({ accountId: `a${i}`, status: 'failed' }))
    const m = toAccountHealthModel({ code: 0, data })
    expect(m.bad).toBe(8)
    expect(m.badAccounts).toHaveLength(5)
    expect(m.badOverflow).toBe(3)
  })
})

describe('toQueueStatusModel（发布队列）', () => {
  it('统计运行中/排队中/最近失败', () => {
    const status = { code: 0, data: { running: 2, pending: 3 } }
    const history = {
      code: 0,
      data: [
        { id: 1, status: 'failed' },
        { id: 2, status: 'success' },
        { id: 3, status: 'failed' },
      ],
    }
    const m = toQueueStatusModel(status, history)
    expect(m.state).toBe('ready')
    expect(m.running).toBe(2)
    expect(m.pending).toBe(3)
    expect(m.failed).toBe(2)
  })

  it('队列为空是合法空态', () => {
    const m = toQueueStatusModel({ code: 0, data: { running: 0, pending: 0 } }, { code: 0, data: [] })
    expect(m.state).toBe('empty')
  })

  it('有任务在跑就不算空态（哪怕历史为空）', () => {
    const m = toQueueStatusModel({ code: 0, data: { running: 1, pending: 0 } }, { code: 0, data: [] })
    expect(m.state).toBe('ready')
  })

  it('status 失败但 history 成功 → 仍 error（不允许半套数据）', () => {
    const m = toQueueStatusModel({ code: -1 }, { code: 0, data: [] })
    expect(m.state).toBe('error')
  })

  it('未登录门禁优先于其它态', () => {
    const m = toQueueStatusModel({ code: -3, errorCode: 'AUTH_REQUIRED' }, { code: 0, data: [] })
    expect(m.state).toBe(AUTH_GATE)
  })

  it('history data 非数组时按 0 计，不崩', () => {
    const m = toQueueStatusModel({ code: 0, data: { running: 0, pending: 0 } }, { code: 0, data: null })
    expect(m.state).toBe('empty')
    expect(m.failed).toBe(0)
  })
})

describe('toPatternBoardModel（题材表现榜，full 专属）', () => {
  it('按分数降序取 Top N', () => {
    const res = {
      code: 0,
      data: {
        items: [
          { value: '悬念开头', engagement_score: 30 },
          { value: '数字列表', engagement_score: 90 },
          { value: '故事引入', engagement_score: 60 },
        ],
      },
    }
    const m = toPatternBoardModel(res, 2)
    expect(m.state).toBe('ready')
    expect(m.rows.map(r => r.value)).toEqual(['数字列表', '故事引入'])
  })

  it('items 为空 → empty（归因断链是已知合法空态）', () => {
    expect(toPatternBoardModel({ code: 0, data: { items: [] } }).state).toBe('empty')
  })

  it('错误信封 → error', () => {
    expect(toPatternBoardModel({ code: -1, message: 'boom' }).state).toBe('error')
  })

  it('未登录门禁 → auth', () => {
    expect(toPatternBoardModel({ code: -3, errorCode: 'AUTH_REQUIRED' }).state).toBe(AUTH_GATE)
  })

  it('分数缺失按 0 处理且不崩', () => {
    const m = toPatternBoardModel({ code: 0, data: { items: [{ value: 'x' }] } })
    expect(m.state).toBe('ready')
    expect(m.rows[0].score).toBe(0)
  })

  it('value 缺失显示占位而非留白', () => {
    const m = toPatternBoardModel({ code: 0, data: { items: [{ engagement_score: 5 }] } })
    expect(m.rows[0].value).toBeTruthy()
  })
})
