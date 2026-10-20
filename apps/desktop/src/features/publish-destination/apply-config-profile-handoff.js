// @ts-check
/**
 * apply-config-profile-handoff — 「去发布」浮窗带过来的配置档案在创作页的套用
 * （publish-config-picker，2026-10-21）
 *
 * 为什么单独成模块（而不是把逻辑写在 CreateView 里）：
 *  - `views/CreateView.vue` 已 5300+ 行，同时受两条行数门禁约束：
 *    `check-max-lines`（逐文件，存量文件允许在登记值基础上再涨 200 行）与
 *    `check-debt-budget`（**单文件最大行数只降不升**）。本片若把交接逻辑整段塞进
 *    CreateView，会把后者顶破——那不是「实现方式不同」，是门禁在如实反映「新代码进大文件」。
 *  - 交接逻辑本身是**一次性操作**（读 query → 校验 → 套用 → 提示），与创作页的
 *    生命周期状态无关，适合做成「显式传入宿主」的纯流程函数。
 *
 * 宿主契约（传入 CreateView 实例；字段名与 CreateView 保持同名，避免二次映射）：
 *   $route.query.configProfile     string | undefined  URL 带来的配置档案 id
 *   selectedPipeline               object | null       当前选中的流水线
 *   s2vConfigProfiles              Array               已载入的配置档案列表
 *   loadS2VConfigProfiles(opts)    Promise             载入配置档案列表
 *   applyS2VConfigProfileSnapshot  Promise<boolean>    套用快照（既有实现，语义全部复用）
 *   s2vActiveConfigProfile         string              已应用的配置名（可写）
 *   showS2VOptionsToast(msg, ms)   void                顶部提示
 *   $t(key)                        string              国际化取值
 *   _s2vRestorePromise             Promise | undefined 「恢复上次选项」的 promise（见下）
 *
 * 与「恢复上次选项」的竞态（design.md D6）：两者写同一份表单，并发时**后写者胜**。
 * 配置档案是用户显式选择，必须后写，故套用前先等恢复跑完。
 */

/**
 * 套用 URL 带来的配置档案。
 *
 * @param {object} host CreateView 实例（见文件头的宿主契约）
 * @returns {Promise<boolean>} 是否真的套用了（未套用时各失败分支已给出可见提示）
 */
export async function applyConfigProfileFromRoute (host) {
  const rawId = host?.$route?.query?.configProfile
  const profileId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!profileId) return false

  const pipelineId = host?.selectedPipeline?.name || ''
  if (!pipelineId) {
    host.showS2VOptionsToast(host.$t('create.story2video.configProfile.pipelineUnresolved'), 2600)
    return false
  }

  // 先等「恢复上次选项」跑完：两者写同一份表单，配置档案必须后写（design.md D6）
  const restorePromise = host?._s2vRestorePromise
  if (restorePromise) {
    try { await restorePromise } catch (_) { /* 恢复失败不阻断配置套用 */ }
  }

  if (!Array.isArray(host.s2vConfigProfiles) || !host.s2vConfigProfiles.length) {
    await host.loadS2VConfigProfiles({ quiet: true })
  }
  const profile = (host.s2vConfigProfiles || []).find(item => item && item.id === profileId)
  if (!profile) {
    host.showS2VOptionsToast(host.$t('create.story2video.configProfile.notFound'), 2600)
    return false
  }
  if (profile.pipelineId !== pipelineId) {
    host.showS2VOptionsToast(host.$t('create.story2video.configProfile.wrongPipeline'), 2600)
    return false
  }
  const applied = await host.applyS2VConfigProfileSnapshot(profile)
  if (!applied) {
    host.showS2VOptionsToast(host.$t('create.story2video.configProfile.applyFailed'), 2600)
    return false
  }
  host.s2vActiveConfigProfile = profile.name || ''
  host.showS2VOptionsToast(host.$t('create.story2video.configProfile.applied'))
  return true
}
