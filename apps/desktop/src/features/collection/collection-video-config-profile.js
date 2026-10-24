// @ts-check
/**
 * collection-video-config-profile — 采集页「去发布 → 视频创作」**就地执行**时的
 * 配置档案解析（fix-collection-rewrite-publish-flow，2026-10-21）。
 *
 * ## 为什么需要这个模块
 * 主干的 publish-config-picker 让「去发布」弹窗可以选**配置档案**，采集页原先是
 * **跳转**创作页、由创作页读 `?configProfile=` 套用。本刀把该入口改成「就地启动
 * 流水线 + 进度浮层」（用户明确要求不跳页），于是「用户在弹窗里选中的配置」必须
 * 在采集页**自己兑现** —— 否则就是主干在热门选题页修过的同一个坑：**选了等于没选**
 * （HotTopics 的批注原文：「修复前这里只带 draft，弹窗里选的流水线被静默丢弃」）。
 *
 * ## 三条口径
 *  1. **不复制第二份「能不能套用」的规则**：判据直接复用主干的纯函数
 *     `resolveConfigProfileTarget`（features/publish-destination/apply-config-profile-handoff.js
 *     ——创作页套用 URL 带来的配置档案时用的就是它），
 *     失败分支的提示文案也**复用**主干 create 命名空间里既有的 locale key
 *     ——本仓明令「不另写一份同义句」。
 *  2. **只有编排型快照能直接喂给启动参数**：`buildGenVideoStartParams` 消费的
 *     是 `snapshot.s2vConfig` / `snapshot.s2vOutputConfig` 两个键，而编排型配置档案的
 *     快照（kind=orchestrated）正是这个形状。legacy 形态（kind=legacy）结构不同，
 *     硬塞进去会被**静默忽略**（回落到默认参数）⇒ 判为不可用并如实告知。
 *  3. **不可用时不阻断生成**：用户点的是「生成视频」，不是「套用配置」，
 *     视频照常出；但必须留一条**可见提示**（见口径 1 的 key），
 *     否则就退化成「静默丢配置」。
 */
import { resolveConfigProfileTarget } from '@/features/publish-destination/apply-config-profile-handoff'

/**
 * 失败分支 → 主干既有 locale key（key 路径与 CreateView 用的完全一致，
 * 保证「同一个失败在两个入口说的是同一句话」）。
 */
const WARNING_KEYS = Object.freeze({
  'not-found': 'create.story2video.configProfile.notFound',
  'wrong-pipeline': 'create.story2video.configProfile.wrongPipeline',
  'no-pipeline': 'create.story2video.configProfile.pipelineUnresolved',
  'not-applicable': 'create.story2video.configProfile.snapshotInvalid',
  'load-failed': 'create.story2video.configProfile.handoffLoadFailed',
})

/**
 * 快照能不能直接当启动参数用：必须带 `s2vConfig` / `s2vOutputConfig` 之一。
 *
 * 判据与 `buildStory2VideoTextConfigFromSnapshot` 的消费口径一致
 * （story2video/s2v-config-snapshot.js 读的就是这两个键）。
 */
function isApplicableSnapshot (snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
  const hasConfig = snapshot.s2vConfig && typeof snapshot.s2vConfig === 'object' && !Array.isArray(snapshot.s2vConfig)
  const hasOutput = snapshot.s2vOutputConfig && typeof snapshot.s2vOutputConfig === 'object' && !Array.isArray(snapshot.s2vOutputConfig)
  return Boolean(hasConfig || hasOutput)
}

/**
 * 解析「去发布」弹窗带过来的配置档案。
 *
 * @param {{ profileId?: unknown, pipelineId?: unknown, profiles?: unknown }} input
 * @returns {{ snapshot: object|null, warningKey: string }}
 *   - `snapshot` 非 null ⇒ 可直接作为 `buildGenVideoStartParams` 的 snapshot 入参；
 *   - `warningKey` 非空 ⇒ 套用失败，值是可直接交给 `t()` 的 locale key。
 */
export function resolveCollectionVideoConfigProfile (input) {
  const source = input && typeof input === 'object' ? input : {}
  const profileId = typeof source.profileId === 'string' ? source.profileId.trim() : ''
  const pipelineId = typeof source.pipelineId === 'string' ? source.pipelineId.trim() : ''
  if (!profileId) return { snapshot: null, warningKey: '' }

  // 复用主干的判据（不复制「能不能套用」的规则）
  const target = resolveConfigProfileTarget({ profileId, pipelineId, profiles: source.profiles })
  if (target.status !== 'apply') {
    return { snapshot: null, warningKey: WARNING_KEYS[target.status] || WARNING_KEYS['not-found'] }
  }
  const snapshot = target.profile ? target.profile.snapshot : null
  if (!isApplicableSnapshot(snapshot)) {
    return { snapshot: null, warningKey: WARNING_KEYS['not-applicable'] }
  }
  return { snapshot, warningKey: '' }
}

/**
 * 解析本次启动用的配置快照（含 IO，故与纯函数分开）。
 *
 *  - 选了配置档案 ⇒ 用档案的快照；
 *  - 没选 ⇒ 沿用「上次选项」快照（既有行为，不变）；
 *  - 选了但套不上 ⇒ 回退到「上次选项」，并留下一条**可见提示**的 locale key。
 *
 * IO 以函数入参注入（不直接摸 publisher API）：这样本模块可脱离 Vue 与
 * Electron 单测，也与仓库「编排层不直接依赖具体传输」的既有做法一致。
 *
 * @param {object} input
 * @param {string} input.profileId 用户选中的配置档案 id（空串 = 不套用）
 * @param {string} input.pipelineId 本次要启动的流水线（配置档案必须属于它）
 * @param {() => Promise<any>} input.listConfigProfiles 读配置档案列表
 * @param {() => Promise<any>} input.readLastOptions 读「上次选项」快照
 * @returns {Promise<{snapshot: unknown, warningKey: string}>}
 */
export async function resolveCollectionVideoStartSnapshot (input) {
  const source = input && typeof input === 'object' ? input : {}
  const profileId = typeof source.profileId === 'string' ? source.profileId.trim() : ''
  const pipelineId = typeof source.pipelineId === 'string' ? source.pipelineId.trim() : ''
  const readLastOptions = typeof source.readLastOptions === 'function' ? source.readLastOptions : async () => null

  const fallback = async () => {
    try {
      return await readLastOptions()
    } catch (_e) {
      return null
    }
  }

  if (!profileId) {
    return { snapshot: await fallback(), warningKey: '' }
  }
  let res = null
  try {
    res = typeof source.listConfigProfiles === 'function' ? await source.listConfigProfiles() : null
  } catch (_e) {
    res = null
  }
  if (!res || res.code !== 0) {
    return { snapshot: await fallback(), warningKey: WARNING_KEYS['load-failed'] }
  }
  const resolved = resolveCollectionVideoConfigProfile({
    profileId,
    pipelineId,
    profiles: Array.isArray(res.data) ? res.data : [],
  })
  if (resolved.warningKey) {
    return { snapshot: await fallback(), warningKey: resolved.warningKey }
  }
  return { snapshot: resolved.snapshot, warningKey: '' }
}

export { WARNING_KEYS as COLLECTION_VIDEO_CONFIG_PROFILE_WARNING_KEYS }
