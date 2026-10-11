'use strict'

/**
 * podcast-episode-adapters.js — 出期编排的**真实实现层**（刀 3 下半片第一块）
 *
 * 为什么单独一层：`podcast-episode-publish.js` 的四个注入实现（uploadImpl / episodeSink /
 * feedSink / channelGate）此前只有测试夹具在满足它们——「形状对不对」全靠想象，真接线时最容易
 * 在这里漂（外部评审 F8 点名的正是这条）。本文件把合同落到真服务上，并且是**唯一**落点：
 * 编排层不许直接 require 频道服务或托管服务。
 *
 * 四条不可让的口径：
 * 1. `kind` 必须显式。`feed` 走 `publishFeed`（内含重建 + 回滚点 + writeFeedSync），`audio` 走
 *    `publishAudio`。缺 kind 或未知 kind 一律拒绝，**不得**「没有 kind 就当音频」——那是把两次
 *    语义不同的外发压成一条分支，feed 会被静默跳过而用户看到 success。
 * 2. `publishFeed` 回 `{state:'failed'}` 时**不抛错**（刀 2 的设计：失败形状要如实带出）。
 *    编排层的 partial 分层靠 `.catch` 触发，所以这里必须把非 success 转成带领域码的 throw；
 *    否则「feed 没传上去」会被读成成功——本层是这个压平风险的唯一堵点。
 * 3. `episodeSink` 一律 strict。手工页可以「先登记后补直链」，一键发布不行：那一期马上要进
 *    公网 feed，不合格的字段一旦落盘就成了对外可见的坏数据。
 * 4. `channelGate.assertWritable` 每次现算服务实例，不缓存。配额与忙态跨动作会漂（评审 #17 同源）。
 * 5. 取**可写**服务必须包在 `channelPublishPass` 里。第 3 片起整条链自持频道忙标记，
 *    而通行证是「发布自己写自己的状态」的唯一放行口；少了它，一次出期会死在自己的锁上
 *    （表现为每次都在 attach 报 PODCAST_CHANNEL_BUSY，而用户从没并发过第二次）。
 */

const path = require('path')
const { channelPublishPass } = require('./podcast-channel-locks')

const ADAPTER_ERRORS = {
  KIND_REQUIRED: 'PODCAST_HOSTING_INVALID',
  NOT_CONFIGURED: 'PODCAST_HOSTING_REQUIRED',
  UPLOAD_FAILED: 'PODCAST_HOSTING_UPLOAD_FAILED',
}

function adapterErr (code, message, extra) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}

/**
 * @param {{channelServiceOf:(id:string, options?:object)=>object,
 *          hostingService:{getHosting:Function,publishFeed:Function,publishAudio:Function},
 *          logger?:object}} deps
 */
function createEpisodeAdapters (deps = {}) {
  const { channelServiceOf, hostingService, logger, heldBy } = deps
  const log = logger || { info () {}, warn () {}, error () {} }
  if (typeof channelServiceOf !== 'function' || !hostingService
    || typeof hostingService.publishFeed !== 'function' || typeof hostingService.publishAudio !== 'function') {
    throw adapterErr(ADAPTER_ERRORS.KIND_REQUIRED, '适配层必须注入 channelServiceOf 与托管服务的两个上传实现')
  }

  async function uploadImpl (options = {}) {
    const channelId = String(options.channelId || '').trim()
    const kind = String(options.kind || '')
    if (kind === 'audio') {
      const filePath = String(options.filePath || '')
      const res = await hostingService.publishAudio(channelId, {
        filePath,
        mime: options.mime,
        stem: path.basename(filePath, path.extname(filePath)),
      })
      return { url: res.url, size: res.size }
    }
    if (kind === 'feed') {
      // heldBy 是宿主那把整链锁的凭证：不传则 publishFeed 会自己取锁、并在链内被自己拒掉
      const r = await hostingService.publishFeed(channelId, { heldBy })
      if (!r || r.state !== 'success') {
        log.warn('[podcast-adapters] feed 未更新：' + ((r && r.code) || (r && r.state) || 'no-result'))
        throw adapterErr((r && r.code) || ADAPTER_ERRORS.UPLOAD_FAILED, '公网 feed 未更新', { status: (r && r.status) || null })
      }
      return { url: r.url, size: r.bytes }
    }
    throw adapterErr(ADAPTER_ERRORS.KIND_REQUIRED, '上传必须声明 kind=audio 或 kind=feed（缺它等于把两种外发压成一条分支）')
  }

  /** 取可写服务 + 立刻在同一步里落笔：通行证只在**同步作用域**内放行（见 podcast-channel-locks 的理由）。 */
  async function episodeSink (channelId, episode) {
    const id = String(channelId || '').trim()
    return channelPublishPass.run(id, () => channelServiceOf(id, { writable: true }).saveEpisode(episode, { strict: true }))
  }

  async function feedSink (channelId) {
    const id = String(channelId || '').trim()
    // 取服务与重建必须**同在通行证内**：整条链持锁时，assertChannelWritable 就在
    // channelServiceOf 这一站发生，把它留在外面等于每次出期都死在自己的忙标记上。
    return channelPublishPass.run(id, () => channelServiceOf(id, { writable: true }).buildFeed())
  }

  return {
    uploadImpl,
    episodeSink,
    feedSink,
    channelGate: {
      assertWritable (channelId) {
        const id = String(channelId || '').trim()
        channelPublishPass.run(id, () => channelServiceOf(id, { writable: true }))
      },
    },
    host: {
      assertConfigured () {
        const view = hostingService.getHosting()
        if (!view || view.configured !== true) throw adapterErr(ADAPTER_ERRORS.NOT_CONFIGURED, '未配置对象存储托管，无法使用本地音频')
      },
    },
    ADAPTER_ERRORS,
  }
}

module.exports = { createEpisodeAdapters, ADAPTER_ERRORS }
