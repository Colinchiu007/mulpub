'use strict'
/**
 * 刀 4 · tasks 4.4b 第①项：**宿主接线**——把 §7.9 的固化判据接到真实调用路径上。
 *
 * 触发点选在 `ipc-handlers/podcast.js` 的 `getService(channelId)`：那是「首个需要频道数据的调用」
 * 在本仓的真实落点（所有读写 episodes.json 的通道都先经过它取服务），因此不需要新造一个定时器
 * 或后台任务——定时器会引入「什么时候算首个」的第二个答案。
 *
 * 三条不可让：
 * 1. **旁路，不得影响读**：固化失败（解析失败、写盘被锁、磁盘满）一律 `warn` 后继续返回服务。
 *    让一次历史数据补齐把用户的频道列表读请求打挂，是把两个不相关的问题绑成同一个故障。
 * 2. **进程内恰好一次 + 落盘幂等**：进程内一个 `Set` 防同一频道被反复触发；跨进程的"已做过"
 *    只看 `index.json` 的 `stockStamp.at`（由 `freezeStockMime` 自己判），**不在这里再判一次**——
 *    两处判据会在下次改动时漂移成「一处说做过、另一处说没做」。
 * 3. **写盘必须走原子替换**：`episodes.json` / `index.json` 是用户状态。Windows 上直接
 *    `writeFileSync` 覆盖会在崩溃时留下半份文件；本层的 `writeJsonAtomic` 由宿主注入，
 *    缺省实现只做 `tmp + rename`（重试策略由宿主那一份既有实现持有，本层不复制）。
 */
const path = require('node:path')

const EPISODES_FILE = 'episodes.json'
const INDEX_FILE = 'index.json'

function defaultWriteJsonAtomic (fsImpl, file, value) {
  const tmp = file + '.tmp-' + process.pid
  fsImpl.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fsImpl.renameSync(tmp, file)
}

/**
 * @param {object} deps
 * @param {{channelDir:(id:string)=>string, resolveRoot:()=>string}} deps.registry 只取这两个出口
 * @param {(fn:Function)=>Promise|void} [deps.settle] 测试用：把异步副作用变成可 await 的点
 */
function createStockFreezeHost (deps = {}) {
  const registry = deps.registry
  const fsImpl = deps.fsImpl || require('node:fs')
  const log = deps.logger || { warn () {}, info () {} }
  const writeJsonAtomic = typeof deps.writeJsonAtomic === 'function' ? deps.writeJsonAtomic
    : (file, value) => defaultWriteJsonAtomic(fsImpl, file, value)
  if (!registry || typeof registry.channelDir !== 'function' || typeof registry.resolveRoot !== 'function') {
    const e = new Error('固化宿主必须注入 registry（需 channelDir 与 resolveRoot 两个出口）')
    e.code = 'PODCAST_EPISODE_INVALID'
    throw e
  }
  const { freezeStockMime } = require('./podcast-episode-stock-mime')
  const attempted = new Set()
  let inFlight = null

  function episodesFileFor (channelId) {
    return path.join(registry.channelDir(channelId), EPISODES_FILE)
  }

  async function runOnce (channelId) {
    const root = registry.resolveRoot()
    const indexFile = path.join(root, INDEX_FILE)
    const episodesFile = episodesFileFor(channelId)
    const readJson = (f) => {
      if (!fsImpl.existsSync(f)) return null
      const parsed = JSON.parse(fsImpl.readFileSync(f, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : null
    }
    return freezeStockMime({
      listChannels: () => [{ channelId, episodesFile }],
      readEpisodes: (f) => readJson(f),
      writeEpisodes: (f, store) => writeJsonAtomic(f, store),
      readIndex: () => readJson(indexFile) || {},
      writeIndex: (i) => writeJsonAtomic(indexFile, i),
      withChannelLock: (id, section, fn) => Promise.resolve().then(fn),
      logger: log,
    })
  }

  /**
   * 非阻塞：调用方拿到的永远是"继续可用"，固化结果只进日志。
   * @returns {Promise<object|null>} 已完成的固化结果（供测试 await），跳过或失败时为 null
   */
  function freezeChannel (channelId) {
    const id = String(channelId || '').trim()
    if (!id || attempted.has(id)) return Promise.resolve(null)
    attempted.add(id)
    const p = Promise.resolve()
      .then(() => runOnce(id))
      .then((r) => {
        if (!r || r.skipped !== true) {
          log.info('[podcast-stock] 频道 ' + id + ' 固化 ' + (r && r.skipped ? '跳过' : '完成')
            + ' scanned=' + (r ? r.scanned : 0) + ' filled=' + (r ? r.filled : 0)
            + ' unresolved=' + (r ? r.unresolved : 0))
        }
        return r && r.skipped ? null : r
      })
      .catch((e) => {
        log.warn('[podcast-stock] 固化旁路失败，不影响本次读取：' + ((e && e.message) || String(e)))
        return null
      })
      .finally(() => { inFlight = null })
    inFlight = p
    return p
  }

  return {
    freezeChannel,
    hasAttempted: (id) => attempted.has(String(id || '').trim()),
    pending: () => inFlight,
    episodesFileFor,
  }
}

module.exports = { createStockFreezeHost, EPISODES_FILE, INDEX_FILE }
