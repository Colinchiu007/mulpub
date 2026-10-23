'use strict'

/**
 * 回归锁（2026-10-23）：身份模式下 add() 必须补写 owner_subject
 *
 * 真机现象：publish:batch ok 有 taskId，但任务从不执行、零日志、零报错、running=0。
 * 根因：_isTaskOwnedByCurrentUser 要求 task.owner_subject === 当前 owner，
 * 而 publish:batch 从不写该字段 ⇒ 任务恒被判「非当前用户」并推回队列。
 */
const TaskQueue = require('../src/task-queue')

describe('task-queue owner 归属', () => {
  it('设置 owner provider 后，add() 仍能执行（自动补 owner_subject）', (done) => {
    const q = new TaskQueue({ maxConcurrent: 1 })
    q.setOwnerSubjectProvider(() => 'user-A')
    const ran = []
    q.setExecutor(async (t) => { ran.push(t.id) })
    q.add({ platform: 'tencent_video', accountId: 'acc1', article: {} })
    q.add({ platform: 'tencent_video', accountId: 'acc1', article: {} })
    setTimeout(() => {
      expect(ran.length).toBe(2)
      const s = q.getStatus()
      expect(s.pending).toBe(0)
      expect(s.history).toBe(2)
      done()
    }, 600)
  })

  it('未设置 provider 时行为不变（单用户模式全部放行）', (done) => {
    const q = new TaskQueue({ maxConcurrent: 1 })
    const ran = []
    q.setExecutor(async (t) => { ran.push(t.id) })
    q.add({ platform: 'douyin', accountId: 'acc2', article: {} })
    setTimeout(() => { expect(ran.length).toBe(1); done() }, 400)
  })
})
