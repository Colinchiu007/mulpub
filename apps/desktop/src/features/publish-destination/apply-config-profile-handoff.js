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
 *    生命周期状态无关。
 *
 * 依赖注入而非直接摸 Vue 实例（QM-6 评审 i4 采纳）：
 *  - 本模块**不认识 Vue**：入参是普通数据 + 普通函数，由调用方（CreateView）把实例方法
 *    适配成函数传进来。原先的写法是整个 `this` 塞进来，于是模块内部出现
 *    `host.$route` / `host.showS2VOptionsToast` 这类「宿主专属」调用，模块只能被
 *    CreateView 用、也测不了。
 *  - **决策**与**副作用**分开：`resolveConfigProfileTarget()` 是纯函数（不碰任何 IO），
 *    四个分支（跳过 / 无流水线 / 已删除 / 跨流水线 / 可套用）可被单测穷举；
 *    `applyConfigProfileFromRoute()` 只负责把决策翻译成副作用（读库、套用、提示）。
 *
 * 与「恢复上次选项」的竞态（design.md D6）：两者写同一份表单，并发时**后写者胜**。
 * 配置档案是用户显式选择，必须后写，故套用前先等恢复跑完（awaitRestore 入参）。
 */

/**
 * 决策：这条配置档案能不能套用到当前流水线。
 *
 * @param {{ profileId?: unknown, pipelineId?: unknown, profiles?: unknown }} input
 * @returns {{ status: 'skipped'|'no-pipeline'|'not-found'|'wrong-pipeline'|'apply', profile?: object }}
 */
export function resolveConfigProfileTarget (input) {
  const source = input && typeof input === 'object' ? input : {}
  const profileId = typeof source.profileId === 'string' ? source.profileId.trim() : ''
  if (!profileId) return { status: 'skipped' }
  const pipelineId = typeof source.pipelineId === 'string' ? source.pipelineId.trim() : ''
  if (!pipelineId) return { status: 'no-pipeline' }
  const list = Array.isArray(source.profiles) ? source.profiles : []
  const profile = list.find(item => item && item.id === profileId)
  if (!profile) return { status: 'not-found' }
  if (profile.pipelineId !== pipelineId) return { status: 'wrong-pipeline' }
  return { status: 'apply', profile }
}

/** 各失败分支对应的 locale key（提示文案统一走 locale，不在渲染层硬编码）。 */
const STATUS_MESSAGE_KEYS = Object.freeze({
  'no-pipeline': 'create.story2video.configProfile.pipelineUnresolved',
  'not-found': 'create.story2video.configProfile.notFound',
  'wrong-pipeline': 'create.story2video.configProfile.wrongPipeline',
  'apply-failed': 'create.story2video.configProfile.applyFailed',
  'load-failed': 'create.story2video.configProfile.handoffLoadFailed',
})

/**
 * 套用 URL 带来的配置档案。
 *
 * @param {object} deps
 * @param {string} deps.profileId URL 带来的配置档案 id
 * @param {string} deps.pipelineId 当前选中的流水线 id
 * @param {() => Array} [deps.getProfiles] 取当前已载入的配置档案列表（**取函数而非值**：
 *   载入配置库会整体替换宿主那份数组快照，模块必须在载入**之后**重新取一次）
 * @param {Array} [deps.profiles] 列表的静态兜底（纯函数测试用）
 * @param {() => Promise<void>|void} [deps.loadProfiles] 列表为空时载入配置库
 * @param {(profile: object) => Promise<boolean>} deps.applySnapshot 套用快照（既有实现）
 * @param {(name: string) => void} [deps.setActiveProfile] 记录已应用的配置名
 * @param {(key: string, ms?: number) => void} deps.showToast 顶部提示（入参是 locale key）
 * @param {() => Promise<void>|void} [deps.awaitRestore] 等「恢复上次选项」跑完
 * @returns {Promise<boolean>} 是否真的套用了（未套用时各失败分支已给出可见提示）
 */
export async function applyConfigProfileFromRoute (deps) {
  const d = deps && typeof deps === 'object' ? deps : {}
  const profileId = typeof d.profileId === 'string' ? d.profileId.trim() : ''
  if (!profileId) return false

  // 先等「恢复上次选项」跑完：两者写同一份表单，配置档案必须后写（design.md D6）
  if (typeof d.awaitRestore === 'function') {
    const restorePromise = d.awaitRestore()
    if (restorePromise) {
      try { await restorePromise } catch (_) { /* 恢复失败不阻断配置套用 */ }
    }
  }

  const readProfiles = () => {
    if (typeof d.getProfiles === 'function') {
      const list = d.getProfiles()
      return Array.isArray(list) ? list : []
    }
    return Array.isArray(d.profiles) ? d.profiles : []
  }
  if (!readProfiles().length && typeof d.loadProfiles === 'function') {
    // 载入失败必须被吞掉并给出**独立**提示（QM-6 round 2 i2 采纳）：
    // 抛出去会变成 mounted 链里的未捕获拒绝；直接当成「没找到配置」则是误导
    // —— 配置可能好好地存在，只是这次没载入成功。
    try {
      await d.loadProfiles()
    } catch (_) {
      if (typeof d.showToast === 'function') d.showToast(STATUS_MESSAGE_KEYS['load-failed'], 2600)
      return false
    }
  }
  const profiles = readProfiles()

  const target = resolveConfigProfileTarget({
    profileId,
    pipelineId: d.pipelineId,
    profiles,
  })
  if (target.status !== 'apply') {
    if (target.status === 'no-pipeline' || target.status === 'not-found' || target.status === 'wrong-pipeline') {
      const key = STATUS_MESSAGE_KEYS[target.status]
      if (key && typeof d.showToast === 'function') d.showToast(key, 2600)
    }
    return false
  }

  const applied = typeof d.applySnapshot === 'function'
    ? await d.applySnapshot(target.profile)
    : false
  if (!applied) {
    if (typeof d.showToast === 'function') d.showToast(STATUS_MESSAGE_KEYS['apply-failed'], 2600)
    return false
  }
  if (typeof d.setActiveProfile === 'function') d.setActiveProfile(target.profile.name || '')
  if (typeof d.showToast === 'function') d.showToast('create.story2video.configProfile.applied')
  return true
}
