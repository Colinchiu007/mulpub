/**
 * creator-collector-runtime.js — 真正发起网络调用的采集器
 *
 * 与 `creator-collector.js`（纯解析，无网络）分工：
 *   · creator-collector      把用户输入解析成 canonical channelId
 *   · creator-collector-runtime  用 canonical ID / videoId 去取真实数据
 *
 * 依赖全部注入，便于在无网络、无凭证环境完整测试。
 */

'use strict'

const { CREATOR_INPUT_ERRORS, YOUTUBE_API_BASE, resolveChannelId: resolveChannelIdImpl } = require('./creator-collector')
const { DEFAULT_COLLECT_PAGE_SIZE, classifyContentQuality } = require('./creator-content-quality')

/** 默认注入实现：仅用 Node 内置 https，避免为一次 GET 引入依赖 */
function defaultHttpGet (url, params) {
  // eslint-disable-next-line global-require
  const https = require('https')
  const qs = Object.entries(params || {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const full = `${url}${url.includes('?') ? '&' : '?'}${qs}`
  return new Promise((resolve, reject) => {
    https.get(full, (res) => {
      let raw = ''
      res.on('data', (d) => { raw += d })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(raw) } catch (_) { /* 非 JSON 留给上层按状态码分级 */ }
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode}`)
          err.response = { status: res.statusCode, data: json }
          reject(err)
          return
        }
        resolve(json)
      })
    }).on('error', reject)
  })
}

function createCreatorCollector (deps = {}) {
  const {
    credentialProvider,          // () => { apiKey, pythonBridge } | null
    httpGet = defaultHttpGet,
    listPostsImpl,               // 可覆盖（测试/未来自实现）
    bodyImpl,                    // 可覆盖
    log,
  } = deps

  function credentials () {
    const c = typeof credentialProvider === 'function' ? credentialProvider() : null
    if (!c || !c.apiKey) {
      const e = new Error('未配置 YouTube API Key')
      e.code = CREATOR_INPUT_ERRORS.CREDENTIAL_MISSING
      throw e
    }
    return c
  }

  /**
   * 用户输入 → canonical channelId。
   *
   * ⛔ 2026-10-12 补齐：`ipc-handlers/creator.js` 的 `creator:follow` 调的是
   *   `creatorCollector.resolveChannelId(input)`，而本工厂**从来没返回过这个方法**
   *   （只返回 listPosts / collectBody）⇒ 真实装配下那是 `undefined is not a function`，
   *   也就是「添加博主」在第三个点上同样不可用（前两个是 phase5 的取值路径与
   *   未注册的凭证提供者）。e2e 测试之所以没抓到：它的 `stubCollector` 手搓了一个
   *   `resolveChannelId` —— **夹具按调用方想象的形状收参数**，真实装配里并不存在。
   *   现在把真实现暴露出来，并让 e2e 的替身与真实采集器做方法集对账。
   */
  async function resolveChannelId (raw) {
    const { apiKey } = credentials()
    return resolveChannelIdImpl(raw, { apiKey, httpGet })
  }

  /** 取频道 uploads 播放列表里的最新作品（探测阶段不取正文） */
  async function listPosts (channelId) {
    if (typeof listPostsImpl === 'function') return listPostsImpl(channelId)
    const { apiKey } = credentials()
    // uploads 播放列表 ID = 'UU' + channelId.slice(2)。**只在输入确为 UC 形式时**才允许这么拼：
    // 拿非 UC 的串去切前两字符会得到一个语法合法但指向别的播放列表的 ID，
    // 而 YouTube 对不存在的播放列表返回 200 + 空 items —— 表现为「该博主没有新作品」，
    // 是典型的静默错误（监控看起来正常，实际永远采不到东西）。故这里 fail-closed。
    const cid = String(channelId || '')
    if (!/^UC[\w-]{22}$/.test(cid)) {
      const e = new Error('频道 ID 非法，拒绝拼接 uploads 播放列表')
      e.code = CREATOR_INPUT_ERRORS.NOT_A_CHANNEL
      throw e
    }
    const uploads = 'UU' + cid.slice(2)
    const json = await httpGet(`${YOUTUBE_API_BASE}/playlistItems`, {
      // contentDetails 是 videoId 的**唯一**来源：playlistItems 的 id 字段是
      // 「播放列表条目 id」而非视频 id，漏掉 contentDetails 就会把它误当 externalId，
      // 于是 (platform, external_id) 去重键与 watch URL 双双写错且无法自证。
      part: 'snippet,contentDetails', playlistId: uploads, maxResults: DEFAULT_COLLECT_PAGE_SIZE, key: apiKey,
    })
    const items = Array.isArray(json && json.items) ? json.items : []
    return items.map((it) => {
      const sn = it.snippet || {}
      // 刻意**不做** `|| it.id` 回退：见上，it.id 是播放列表条目 id，
      // 拿它当 external_id 会让去重键与 URL 同时错掉。取不到 videoId 就丢弃该条。
      const vid = (it.contentDetails && it.contentDetails.videoId) || ''
      return {
        externalId: vid,
        title: sn.title || '',
        url: vid ? `https://www.youtube.com/watch?v=${vid}` : '',
        thumbnailUrl: (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default || {}).url) || '',
        publishedAt: sn.publishedAt || null,
        contentQuality: classifyContentQuality(null, sn.description || ''),
        description: sn.description || '',
      }
    }).filter((x) => x.externalId)
  }

  /** 取正文：有字幕走字幕，无字幕回落描述，并给出内容质量等级 */
  async function collectBody (externalId) {
    if (typeof bodyImpl === 'function') return bodyImpl(externalId)
    const creds = credentials()
    const bridge = creds.pythonBridge
    let content = ''
    let transcriptSource = 'description'
    if (bridge && typeof bridge.requestBackend === 'function') {
      try {
        const r = await bridge.requestBackend('POST', '/aggregation/collect', { url: `https://www.youtube.com/watch?v=${externalId}` })
        if (r && r.content) {
          content = String(r.content)
          transcriptSource = (r.metadata && r.metadata.transcript_source) || 'description'
        }
      } catch (e) {
        // 字幕抓取失败**不算博主级故障**：降级到描述即可，不该把监控停掉
        if (log && log.warn) log.warn('[creator] 字幕获取失败，降级为描述', (e && e.message) || e)
      }
    }
    return {
      content,
      transcriptSource,
      contentQuality: classifyContentQuality(transcriptSource, content),
    }
  }

  return { resolveChannelId, listPosts, collectBody }
}

module.exports = { createCreatorCollector, defaultHttpGet }