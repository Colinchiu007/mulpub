// @ts-check
/**
 * avatar-clone-lock.js — registry 写锁（按 key 串行化）
 *
 * 从 avatar-clone-service.js 抽出（max-lines 门禁：service 主体 537 → 510 行）。
 *
 * 为什么需要它：克隆创建是「远端创建 → 样本落盘 → 写 registry」的多步编排，
 * 任一步失败都要补偿（删远端 / 清样本）。若两个请求并发跑同一份 registry，
 * 后写的会覆盖先写的（read-modify-write 竞态），用户会看到「克隆成功了但列表里没有」。
 *
 * 语义：
 *  - 同一个 key 的 work() **串行**执行（FIFO，按入队顺序）；
 *  - 不同 key 互不阻塞（不同 provider / 不同账号并行）；
 *  - work() 抛错不影响后续入队者（前一个的 catch 在 await previous 时就已吞掉）；
 *  - 锁map 自清：没有等待者时删掉 key，避免 Map 无限增长。
 */
'use strict'

class RegistryLock {
  constructor () {
    /** @type {Map<string, Promise>} */
    this._locks = new Map()
  }

  /**
   * 在持锁状态下执行 work()。
   *
   * @param {string} key 锁粒度（registry 存储键）
   * @param {() => Promise<any>} work
   */
  async run (key, work) {
    const previous = this._locks.get(key) || Promise.resolve()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    this._locks.set(key, previous.then(() => gate))
    // 前一个持锁者的失败不得堵死后来者
    await previous.catch(() => {})
    try {
      return await work()
    } finally {
      release()
      if (this._locks.get(key) === previous.then(() => gate)) {
        this._locks.delete(key)
      }
    }
  }

  /** 当前持锁数（测试/诊断用） */
  get size () {
    return this._locks.size
  }
}

module.exports = { RegistryLock }
