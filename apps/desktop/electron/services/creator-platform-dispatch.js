'use strict'

/**
 * creator-platform-dispatch.js — 按博主 canonical ID 形态把调用分发到对应平台采集器
 *
 * ## 为什么按 ID 形态分发而不是传参
 *
 * `creator-runtime` 的调用面是 `collector.listPosts(external_id)`（YouTube 时代定的形状），
 * 改形状要动 runtime + 失败分级 + 全部既有测试。而三平台的 canonical ID **形态互斥且由
 * 各平台解析器 fail-closed 保证**：
 *   - YouTube   `UC[\w-]{22}`
 *   - 抖音      `MS4wLjABAAAA[\w-]{28,}`（sec_uid）
 *   - 小红书    `[0-9a-f]{24}`（用户 ID）
 * 按 ID 分发 = 零 runtime 改动 + 分发错误不可能静默（形态不匹配会落到 youtube 分支并
 * 被 YouTube 的 UC 前缀校验拒绝 → fail-closed 而非错数据）。
 *
 * ⚠ 新平台接入时 MUST 在 `classify()` 登记 ID 形态，否则会误入 youtube 分支
 * （youtube listPosts 的 UC 校验会拒绝并报 not_a_channel —— 可见失败，可接受）。
 */

const { CREATOR_PLATFORMS } = require('./creator-platforms')

const DOUYIN_SEC_UID_RE = /^MS4wLjABAAAA[\w-]{28,}$/
const XHS_USER_ID_RE = /^[0-9a-f]{24}$/
const YOUTUBE_UC_RE = /^UC[\w-]{22}$/

/** 判定 canonical ID 属于哪个平台；识别不出返回 null（调用方按 unsupported 处理） */
function classifyCreatorId (creatorId) {
  const s = String(creatorId || '')
  if (YOUTUBE_UC_RE.test(s)) return CREATOR_PLATFORMS.YOUTUBE
  if (DOUYIN_SEC_UID_RE.test(s)) return CREATOR_PLATFORMS.DOUYIN
  if (XHS_USER_ID_RE.test(s)) return CREATOR_PLATFORMS.XIAOHONGSHU
  return null
}

/**
 * @param {{youtube: object, multiPlatform?: object}} collectors
 *   youtube = 既有 creator-collector-runtime 产物（listPosts/collectBody）；
 *   multiPlatform = creator-adapters-web 产物。
 */
function createPlatformDispatchCollector (collectors) {
  const { youtube, multiPlatform } = collectors || {}
  if (!youtube) throw new TypeError('createPlatformDispatchCollector 需要 youtube 采集器')

  function pick (creatorId) {
    const platform = classifyCreatorId(creatorId)
    if (platform === CREATOR_PLATFORMS.YOUTUBE) return { collector: youtube, platform }
    if ((platform === CREATOR_PLATFORMS.DOUYIN || platform === CREATOR_PLATFORMS.XIAOHONGSHU) && multiPlatform) {
      return { collector: multiPlatform, platform }
    }
    // 识别不出 = 数据有问题（比如老数据存了非 canonical ID）：可见失败而非猜平台
    const err = new Error(`无法识别博主 ID 的平台形态: ${String(creatorId).slice(0, 8)}…`)
    err.code = 'creator:unsupported_platform'
    throw err
  }

  return {
    /** 与 YouTube 形状一致：listPosts(creatorId) → Post[] */
    async listPosts (creatorId) {
      const { collector, platform } = pick(creatorId)
      if (platform === CREATOR_PLATFORMS.YOUTUBE) return collector.listPosts(creatorId)
      const r = await collector.listPosts(platform, creatorId, { cursor: 0 })
      return r.items || []
    },
    /** 与 YouTube 形状一致：collectBody(externalId)。多平台正文随列表返回，返回占位质量 */
    async collectBody (externalId) {
      const { collector, platform } = pick(externalId)
      if (platform === CREATOR_PLATFORMS.YOUTUBE) return collector.collectBody(externalId)
      return collector.collectBody(platform, externalId)
    },
    // resolveChannelId：只对 YouTube 保留旧语义（多平台走 parseCreatorInput + follow 流程）
    async resolveChannelId (input) {
      const platform = require('./creator-platforms').detectPlatformFromUrl(input)
      if (platform && platform !== CREATOR_PLATFORMS.YOUTUBE) {
        const err = new Error('该链接属于其他平台，请使用对应平台添加')
        err.code = 'creator:wrong_platform'
        throw err
      }
      return youtube.resolveChannelId(input)
    },
    /** 平台能力查询（IPC creator:dependency-status 用） */
    async platformStatus () {
      const out = {}
      out.youtube = { ready: true, supported: true }
      if (multiPlatform) {
        for (const p of [CREATOR_PLATFORMS.DOUYIN, CREATOR_PLATFORMS.XIAOHONGSHU]) {
          let has
          try { has = !!(await multiPlatform.hasSession(p)) } catch (_) { has = false }
          out[p] = { supported: true, hasSession: has }
        }
      }
      return out
    },
    classifyCreatorId,
  }
}

module.exports = { createPlatformDispatchCollector, classifyCreatorId }
