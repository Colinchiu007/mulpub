'use strict'

/**
 * 回归锁（2026-10-23）：_runningByChannel 泄漏自愈
 *
 * 真机现象：publish:batch ok 有 taskId，但执行器不跑、running=0、队列非空、无报错，
 * 重启应用后能跑一次。根因是某任务异常退出时未递减通道计数 ⇒ 该通道被永久判忙。
 */
const TaskQueue = require('../src/task-queue')

describe('task-queue 通道泄漏自愈', () => {
  it('无任务运行但通道计数残留时，_processNext 会清掉残留', () => {
    const q = new TaskQueue({ maxConcurrent: 2 })
    q._runningByChannel.set('tencent_video:acc1', 1) // 模拟泄漏
    expect(q._running.size).toBe(0)
    q._processNext()
    expect(q._runningByChannel.size).toBe(0)
  })

  it('有任务在跑时不得误清通道计数', () => {
    const q = new TaskQueue({ maxConcurrent: 2 })
    q._running.set('t1', { id: 't1' })
    q._runningByChannel.set('douyin:acc2', 1)
    q._processNext()
    expect(q._runningByChannel.get('douyin:acc2')).toBe(1)
  })
})
