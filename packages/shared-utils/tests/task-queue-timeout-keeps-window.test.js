/**
 * Test: task-queue 超时/中止竞态下的频控窗口归属（publish-frequency-policy-v3，缺陷 D1）
 *
 * 事故形态（v2 起存在，v3 把间隔从 20′/10′/3′ 下调到 5′/3′/1′ 后**更早触发**）：
 *   `Promise.race([执行器, 超时])` 被**超时**判输时，平台请求仍在飞。此时
 *   `_maybeRollback` 的判据是 `!attempted || definitelyNotSent`，而传输层的
 *   `markSubmitAttempted` 按 `this._running.get(taskId)` 查任务 —— 超时后 finally
 *   已把任务从 `_running` 删除，迟到的打点**永久落空**。于是"仍在飞"被读成"从未发起"
 *   ⇒ 释放窗口 ⇒ 同账号下一条任务立刻可发 ⇒ **重复发布**，且下一次提交不受任何限制。
 *
 * 本文件锁的是判据的方向：**"不知道送出去了没有"必须占窗口**（方向恒为多等），
 * 而"确证没送出去"仍然必须照常释放（见文件末的四条正向对偶 —— 否则免等重试的收益
 * 整体消失，那是另一个方向的失守）。
 */
const TaskQueue = require('../src/task-queue')
const PublishIntervalGuard = require('../src/publish-interval-guard')

const WINDOW = 60_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeQueue (queueOptions = {}) {
  const guard = new PublishIntervalGuard({ minInterval: WINDOW, jitterRatio: 0 })
  const queue = new TaskQueue({ defaultRetry: 1, publishIntervalGuard: guard, ...queueOptions })
  return { guard, queue }
}

/** 任务在超时重试后会落入 _queue 或 _delayed；两处都要能取到（同一实例，非副本） */
function findLiveTask (queue, id) {
  const delayed = queue._delayed.get(id)
  return queue._running.get(id)
    || (delayed && delayed.task)
    || queue._queue.find((t) => t.id === id)
    || queue._history.find((t) => t.id === id)
}

describe('超时/中止竞态不得释放频控窗口（D1）', () => {
  test('race 输给超时且执行器仍在飞 ⇒ 窗口保持占用（不得释放）', async () => {
    const { guard, queue } = makeQueue()
    queue.setExecutor(() => new Promise(() => {}))
    queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 30 })

    await sleep(150)

    // 判据本体：窗口**未被释放**。释放了就是 D1（仍在飞的请求不再占窗口）。
    expect(guard.check('weibo', 'acc_1').allowed).toBe(false)
    expect(guard.getRemainingWait('weibo', 'acc_1')).toBeGreaterThan(0)

    queue.shutdown()
  })

  test('同窗口的第二条任务不得因为上一条超时而被放行（重复发布的直接后果）', async () => {
    const { guard, queue } = makeQueue()
    const executed = []
    queue.setExecutor((task) => {
      executed.push(task.article.title)
      return new Promise(() => {})
    })
    queue.add({ platform: 'weibo', article: { title: 'A', accountId: 'acc_1' }, timeout: 30 })
    await sleep(150)
    expect(executed).toEqual(['A'])

    // 上一条仍在飞；这条同通道任务必须被频控挡住，而不是紧接着发出去
    const blocked = []
    queue.on('publish:blocked', (p) => blocked.push(p))
    queue.add({ platform: 'weibo', article: { title: 'B', accountId: 'acc_1' } })
    await sleep(150)

    expect(executed).toEqual(['A'])
    expect(blocked.length).toBeGreaterThanOrEqual(1)
    expect(blocked[0].bucket).toBe('account')

    queue.shutdown()
    void guard
  })

  test('任务上必须留下「提交状态未知」的痕迹，且不得自称「未提交」', async () => {
    const { guard, queue } = makeQueue()
    queue.setExecutor(() => new Promise(() => {}))
    const id = queue.add({ platform: 'douyin', article: { title: 'T', accountId: 'acc_1' }, timeout: 30 })

    await sleep(150)

    const seen = findLiveTask(queue, id)
    expect(seen, '任务必须仍可查').toBeTruthy()
    expect(seen.submitUncertain, '超时且执行器未 settle ⇒ 提交状态未知').toBe(true)
    expect(seen.lastAttemptNotSubmitted, '「没送出去」不得被声称（那是危险侧的假证据）').toBe(false)

    // 探针必须可归因：这不是"接线缺陷"，是"在飞未知"
    expect(queue.getProbeCounts().inflightUnknown).toBe(1)

    queue.shutdown()
    void guard
  })

  test('终身锁：任务一旦「在飞未知」，后续任何"确证未送出"也不得回滚', () => {
    // 直接对判据本体下针：跨轮次的时序不可控（窗口 60s），但"同一任务终身禁止回滚"
    // 是一条可以从纯状态推出的规则，必须逐条测而不是靠两轮真跑碰时序。
    const { guard, queue } = makeQueue()
    const hold = guard.recordPublish('weibo', 'acc_1')
    const uncertain = {
      id: 't_uncertain', platform: 'weibo', accountId: 'acc_1',
      submitAttempted: false, submitUncertain: true, _hold: hold,
    }
    const notSent = new Error('凭证缺失')
    notSent.definitelyNotSent = true

    expect(queue._maybeRollback(uncertain, notSent)).toBe(false)
    expect(guard.check('weibo', 'acc_1').allowed).toBe(false)

    // 对偶：同一判据下"从未在飞未知"的任务必须照常回滚，否则终身锁写成了全局锁。
    // 换**平台**而不是换账号：平台档键 `platform:*` 会被上一条的 recordPublish 占住，
    // 换账号时回滚成功也仍然过不了平台档，测的就不是回滚而是平台档了。
    const hold2 = guard.recordPublish('zhihu', 'acc_2')
    const clean = {
      id: 't_clean', platform: 'zhihu', accountId: 'acc_2',
      submitAttempted: false, _hold: hold2,
    }
    expect(queue._maybeRollback(clean, notSent)).toBe(true)
    expect(guard.check('zhihu', 'acc_2').allowed).toBe(true)

    queue.shutdown()
  })

  test('回滚后的退避等待必须仍可观测——任务不得只活在定时器闭包里', async () => {
    // _delayRequeue 原先只登记 _pendingTimers：既不在 _queue 也不在 _delayed，
    // 于是 getStatus/getPendingTasks/serialize 在**整个 grace 期**（默认 60s）里
    // 都看不见这条任务 —— 重启即静默丢失，且 UI 上的"排队中"会凭空少一条。
    const { queue } = makeQueue()
    queue.setExecutor(() => {
      const e = new Error('未登录')
      e.definitelyNotSent = true
      throw e
    })
    const id = queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 5000 })
    await sleep(150)

    expect(queue.getPendingTasks().map((t) => t.id), '退避等待中仍须可查').toContain(id)
    expect(JSON.parse(queue.serialize()).queue.map((t) => t.id)).toContain(id)

    queue.shutdown()
  })

  test('中止（cancel）时执行器仍在飞 ⇒ 同样不得释放，且不得进入重试环', async () => {
    const { guard, queue } = makeQueue()
    let entered = 0
    queue.setExecutor(() => { entered += 1; return new Promise(() => {}) })
    const id = queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 5000 })
    await sleep(30)
    expect(entered).toBe(1)

    expect(queue.cancel(id)).toBe(true)
    await sleep(120)

    expect(guard.check('weibo', 'acc_1').allowed).toBe(false)
    expect(entered).toBe(1)
    queue.shutdown()
  })

  test('真实两轮：超时轮之后再来一轮"确证未送出"，窗口仍不得被释放（QM-6 B8）', async () => {
    // 「终身锁」不能只靠手造 task 对象证明 —— 真链路里第二轮会重新 recordPublish 覆盖 _hold，
    // 那一刻"回滚"还原的是新窗口，看起来无害，实际把第一轮在飞的那次提交彻底移出保护。
    // 用 40ms 的小窗口让第二轮在测试内**真的跑起来**，而不是靠推演。
    // 判据取**release 是否被调用**而非"窗口还占着没"：后者绑时间轴（窗口一小就必然过期，
    // 首跑正是这样假红的），前者与时长无关 —— 两轮真跑完而 release 一次都没被调，才是终身锁成立。
    const guard = new PublishIntervalGuard({ minInterval: 60, jitterRatio: 0 })
    let releaseCalls = 0
    const realRelease = guard.release.bind(guard)
    guard.release = (...args) => { releaseCalls += 1; return realRelease(...args) }
    const queue = new TaskQueue({ defaultRetry: 1, publishIntervalGuard: guard })
    let n = 0
    queue.setExecutor(() => {
      n += 1
      if (n === 1) return new Promise(() => {})          // 第一轮：超时，请求仍在飞
      const e = new Error('凭证缺失')                     // 第二轮：确证未送出
      e.definitelyNotSent = true
      throw e
    })
    const id = queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 20, retry: 1 })
    await sleep(500)

    expect(n, '窗口只有 60ms，第二轮必须真的被执行过').toBeGreaterThanOrEqual(2)
    const seen = findLiveTask(queue, id)
    expect(seen.submitUncertain, '第一轮的在飞未知必须留着').toBe(true)
    expect(seen._hold, '第二轮 recordPublish 确实覆盖了 _hold（"回滚会还原错窗口"的前提）').toBeTruthy()
    expect(releaseCalls, '两轮加起来 release 必须一次都没被调用').toBe(0)
    // 且第一轮那次未知不被撤销：整条任务终态时不得回滚
    expect(queue.getProbeCounts().inflightUnknown).toBe(1)
    expect(queue.getProbeCounts().releaseFailed).toBe(0)

    queue.shutdown()
  })

  test('退避期内可取消（这条能力是本次才给的，必须被测 —— QM-6 B5 的派生）', async () => {
    // _delayRequeue 现在登记 _delayed，用户才可能在 grace 期把它取消掉；
    // 不登记 = 取消不了（旧现实），登记了但 cancel 不覆盖 = 定时器到期后复活（评审主张，实测不成立）。
    // 两种方向都要有产物证据，不能靠"我读过 cancel()"。
    const { guard, queue } = makeQueue()
    queue.setExecutor(() => {
      const e = new Error('未登录')
      e.definitelyNotSent = true
      throw e
    })
    const id = queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 5000 })
    await sleep(150)
    expect(guard.check('weibo', 'acc_1').allowed).toBe(true)   // 回滚成功 ⇒ 进退避
    expect(queue._delayed.has(id)).toBe(true)

    expect(queue.cancel(id)).toBe(true)
    expect(queue.getHistory().find((t) => t.id === id).status).toBe('cancelled')
    await sleep(150)
    expect(queue._delayed.has(id)).toBe(false)
    expect(queue._queue.some((t) => t.id === id)).toBe(false)
    queue.shutdown()
  })

  test('重启恢复的任务不得回滚窗口（_hold 不在投影里 —— QM-6 B3 的派生）', async () => {
    // 评审主张"submitUncertain 不持久化 ⇒ 恢复后可回滚"。核对结论：**该路径不可达** ——
    // 恢复走 `_queue.push({...task})`，而 task-projection 不含 `_hold`，
    // `_maybeRollback` 首行 `if (!guard || !task._hold) return false` 就拦住了。
    // 但"不可达"必须由锁给出，不能由我读代码给出（否则下次有人给投影加 _hold 就静默开门）。
    const guard = new PublishIntervalGuard({ minInterval: WINDOW, jitterRatio: 0 })
    const queue = new TaskQueue({ defaultRetry: 1, publishIntervalGuard: guard })
    queue.setExecutor(() => new Promise(() => {}))
    const id = queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 30 })
    await sleep(120)
    const snapshot = queue.serialize()

    const restored = new TaskQueue({ defaultRetry: 1, publishIntervalGuard: guard })
    restored.setExecutor(() => {
      const e = new Error('凭证缺失')
      e.definitelyNotSent = true
      throw e
    })
    expect(restored.deserialize(snapshot)).toBeGreaterThan(0)
    const task = findLiveTask(restored, id)
    expect(task, '恢复出来的任务必须仍可查（_queue 或 _delayed）').toBeTruthy()
    expect(task._hold, '投影不得带 _hold').toBeFalsy()
    const err = new Error('凭证缺失'); err.definitelyNotSent = true
    expect(restored._maybeRollback(task, err, {})).toBe(false)
    queue.shutdown(); restored.shutdown()
  })

  // ── 正向对偶：不得把「禁止回滚」写成「永不回滚」──────────────────────────
  test('对偶①：执行器**快速抛错**且确证未送出 ⇒ 照常释放（免等重试的收益不能被锁掉）', async () => {
    const { guard, queue } = makeQueue()
    queue.setExecutor(() => {
      const e = new Error('未登录')
      e.definitelyNotSent = true
      throw e
    })
    queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 5000 })
    await sleep(150)

    expect(guard.check('weibo', 'acc_1').allowed).toBe(true)
    expect(queue.getProbeCounts().inflightUnknown).toBe(0)
    queue.shutdown()
  })

  test('对偶②：执行器快速抛错且从未发起写尝试 ⇒ 照常释放', async () => {
    const { guard, queue } = makeQueue()
    queue.setExecutor(() => {
      const e = new Error('媒体文件缺失')
      e.noRetry = true
      throw e
    })
    queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 5000 })
    await sleep(150)

    // 从未发起（且不属于"在飞未知"）——判据与 v2 一致，本变更不得收紧到这里
    expect(guard.check('weibo', 'acc_1').allowed).toBe(true)
    expect(queue.getProbeCounts().inflightUnknown).toBe(0)
    queue.shutdown()
  })

  test('对偶③：执行器**自己**超时后已收敛（promise 已 settle）⇒ 不进入「在飞未知」档', async () => {
    const { guard, queue } = makeQueue()
    queue.setExecutor(() => Promise.reject(new Error('上游 504')))
    queue.add({ platform: 'weibo', article: { title: 'T', accountId: 'acc_1' }, timeout: 5000 })
    await sleep(150)

    expect(queue.getProbeCounts().inflightUnknown).toBe(0)
    expect(guard.check('weibo', 'acc_1').allowed).toBe(true)
    queue.shutdown()
  })

  test('对偶④：无 guard 的队列在超时路径上不得因此新增依赖（保持向后兼容）', async () => {
    const queue = new TaskQueue({ defaultRetry: 0 })
    let started = 0
    queue.setExecutor(() => { started += 1; return new Promise(() => {}) })
    queue.add({ platform: 'weibo', article: { title: 'T' }, timeout: 20 })
    await sleep(120)
    expect(started).toBe(1)
    queue.shutdown()
  })
})
