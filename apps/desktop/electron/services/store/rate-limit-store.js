// @ts-check
/**
 * rate-limit-store — 发布频率控制功能域 mixin
 *
 * 表：publish_timeline (key, last_publish_at)
 * key 格式："${platform}:${accountId}"
 */
const log = require('../logger')

/** 未来时间戳容差（ms）：容忍 recordPublish 的注入时钟与 store 层 Date.now 的毫秒级时差 */
const FUTURE_TOLERANCE_MS = 60 * 1000

module.exports = {
  /**
   * 获取指定平台+账号的最后发布时间
   * @param {string} key - "${platform}:${accountId}"
   * @returns {number|null} 时间戳(ms)，null 表示从未发布
   */
  getPublishTimeline (key, ownerSubject) {
    if (!this._ready) return null
    const owner = this._resolveOwnerSubject(ownerSubject)
    if (!owner) return null
    const row = this.db.prepare(
      'SELECT last_publish_at FROM publish_timeline WHERE owner_subject = ? AND key = ?'
    ).get(owner, key)
    return row ? row.last_publish_at : null
  },

  /**
   * 设置指定平台+账号的最后发布时间
   * @param {string} key - "${platform}:${accountId}"
   * @param {number} timestamp - 时间戳(ms)
   */
  setPublishTimeline (key, timestamp, ownerSubject) {
    if (!this._ready) return
    // 未来时间戳写入闸（fix-account-interval-ghost-wait）：本机时钟快进期间落盘的
    // 时间戳会成为间隔守卫的幽灵窗口（账号 10+ 小时未发布仍被「本账号间隔」阻塞）。
    // fail-closed：拒收不落盘并出声；60s 容差防临界竞态误伤正常写入。
    if (typeof timestamp === 'number' && timestamp > Date.now() + FUTURE_TOLERANCE_MS) {
      log.warn('Store', `拒绝写入未来时间戳 publish_timeline[${key}]=${timestamp}（时钟疑似异常，容差 ${FUTURE_TOLERANCE_MS}ms）`)
      return
    }
    const owner = this._resolveOwnerSubject(ownerSubject)
    if (!owner) return
    this.db.prepare(
      'INSERT OR REPLACE INTO publish_timeline (owner_subject, key, last_publish_at) VALUES (?, ?, ?)'
    ).run(owner, key, timestamp)
  },
}
