/**
 * 改写页策略选择（composable）——rewrite-view-decompose（2026-10-21）。
 *
 * 为什么独立：`RewriteView.vue` 触到 max-lines 登记容差（1430/1630），再增 200 行即红。
 * 「策略」自成一块：启用策略列表的加载、自动匹配预览（含竞态守卫与防抖）、以及
 * auto/manual 两种模式下的下发契约。它的数据源是 IPC（`aiListRewriteStrategies` /
 * `aiGetRecommendedStrategies`），与视图渲染无关。
 *
 * 语义边界（务必保持，拆出去不等于可以改）：
 * - **预览必须与 startRewrite 下发同一套 userSettings**，否则预览名与实际命中策略会漂移。
 * - **竞态守卫**（`previewSeq`）：快速切换平台时只保留最后一次请求的结果。守卫只保证
 *   「过期结果不渲染」，**拦不住请求本身** —— 所以正文输入另配 300ms 防抖合并请求。
 * - **失败降级**：列表加载失败 ⇒ 策略列表为空（改写仍可用，走自动匹配）；预览失败 ⇒
 *   预览名降级为 `--`（不阻塞改写）。两者都不得把改写主流程带崩。
 * - **监听有主人**：watch 与防抖定时器都收进本 composable 自建的 effectScope
 *   （见下方 scope 段）。组件里调用 ⇒ 随组件 scope 自动回收；组件外调用 ⇒
 *   调用方必须调 `dispose()`（CCG 外部评审 i1：早先那版把 watch 留在无主作用域里）。
 */
import { ref, watch, effectScope, onScopeDispose } from 'vue'
import { aiListRewriteStrategies, aiGetRecommendedStrategies } from '@/api/publisher'

/** 正文连续键入的预览合并窗口（毫秒）—— 离散的下拉选择不受影响，可即时刷新 */
const CONTENT_PREVIEW_DEBOUNCE_MS = 300

/**
 * @param {{
 *   platform: import('vue').Ref<string>,
 *   industry: import('vue').Ref<string>,
 *   purpose: import('vue').Ref<string>,
 *   tone: import('vue').Ref<string>,
 *   content: import('vue').Ref<string>,
 *   rewriting: import('vue').Ref<boolean>,
 * }} deps - 参与匹配的设置项与正文（由调用方持有，本文件只读不改）
 * @returns {{
 *   strategyMode: import('vue').Ref<'auto'|'manual'>,
 *   rewriteStrategyId: import('vue').Ref<string>,
 *   rewriteStrategies: import('vue').Ref<Array>,
 *   previewStrategyName: import('vue').Ref<string>,
 *   loadRewriteStrategies: () => Promise<void>,
 *   refreshStrategyPreview: () => Promise<void>,
 *   dispose: () => void,
 * }}
 */
export function useRewriteStrategy (deps) {
  const { platform, industry, purpose, tone, content, rewriting } = deps

  // 策略选择（2026-09-15 改为默认「手动选择」展开下拉，降低发现成本；未选时仍传 null 走引擎自动匹配）
  // 注：AiWriterPanel / Collection 采集页保持默认 auto，不受影响
  const strategyMode = ref('manual')
  const rewriteStrategyId = ref('')
  const rewriteStrategies = ref([])
  const previewStrategyName = ref('--')

  /** 加载启用策略（内置 + 远程下发）；失败静默降级为空列表，改写仍可用自动匹配 */
  async function loadRewriteStrategies () {
    try {
      const res = await aiListRewriteStrategies()
      if (res && res.code === 0) rewriteStrategies.value = res.data || []
    } catch (_e) {
      // 策略列表为空时改写仍可用（走自动匹配）
    }
  }

  /** 预览请求序列号：快速切换平台时只保留最后一次请求的结果（竞态防护） */
  let previewSeq = 0

  /** 刷新自动匹配预览：取推荐列表第一名；失败降级为 --，不阻塞改写 */
  async function refreshStrategyPreview () {
    if (rewriting.value) return
    const seq = ++previewSeq
    try {
      // 预览必须与 startRewrite 下发同一套 userSettings，否则预览名与实际命中策略会漂移
      const res = await aiGetRecommendedStrategies({
        platform: platform.value || undefined,
        industry: industry.value || undefined,
        purpose: purpose.value || undefined,
        tone: tone.value || undefined,
      }, content.value.trim())
      if (seq !== previewSeq) return // 已有更新的请求，丢弃本次过期结果
      if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
        previewStrategyName.value = res.data[0].name || '--'
      } else {
        previewStrategyName.value = '--'
      }
    } catch (_e) {
      if (seq === previewSeq) previewStrategyName.value = '--'
    }
  }

  // 目标平台/行业/目的/语气变化 → 预览随新 userSettings 刷新（refreshStrategyPreview 内含竞态守卫）
  // rewrite-default-strategy-fix：行业/目的/语气同样参与匹配，变化也需刷新预览。
  // ⚠ content 必须一起监听（CCG 深度审查 i3）：启发式兜底依赖原文形态，
  //   只监听设置项会导致「粘贴长文但没动下拉」时预览名不刷新，
  //   而实际改写会用新的 content 重新匹配 ⇒ 预览名与实际命中策略漂移。
  // ⚠ content 走 300ms 防抖（CCG 二轮 i3）：正文逐字输入会高频触发预览请求，
  //   previewSeq 只保证「过期结果不渲染」，拦不住请求本身。下拉选择是离散低频
  //   动作可即时刷新；正文连续键入合并到停顿后一次，交互上无感知差异。
  let contentPreviewTimer = null
  function scheduleContentPreview () {
    if (contentPreviewTimer) clearTimeout(contentPreviewTimer)
    contentPreviewTimer = setTimeout(() => {
      contentPreviewTimer = null
      refreshStrategyPreview()
    }, CONTENT_PREVIEW_DEBOUNCE_MS)
  }

  // 监听与定时器统一收进**本 composable 自带的 effectScope**（CCG 外部评审 i1）。
  //
  // 为什么不能只靠「组件卸载时自动清理」：Vue 确实会在组件卸载时停掉组件 scope 里的
  // watch —— 但那是**组件 scope** 的行为。本 composable 若在组件外被调用（独立单测、
  // 未来可能的工具函数），watch 会落进一个**没人负责**的作用域 ⇒ 监听器永不停止。
  //
  // 修法：把 watch 与 onScopeDispose 都注册进本 composable 自建的 scope。
  //   · 在组件 setup 里调用 ⇒ effectScope() 默认挂在**当前 scope**（= 组件 scope）下
  //     ⇒ 组件卸载时 scope 树被停 ⇒ watch 与定时器一并回收，无需任何手工清理；
  //   · 在组件外调用 ⇒ 当前 scope 为空，scope 归本 composable 所有，
  //     调用方用返回的 dispose() 显式停掉（单测里就是这么用的）。
  //
  // ⚠ 早先那版用 `if (getCurrentInstance()) onUnmounted(...)` 只清了定时器，
  //   watch 仍留在无主作用域里 —— 正是 i1 指出的缺口，本版一并修掉。
  const scope = effectScope()
  scope.run(() => {
    watch([platform, industry, purpose, tone], refreshStrategyPreview)
    watch(content, scheduleContentPreview)
    onScopeDispose(() => { if (contentPreviewTimer) clearTimeout(contentPreviewTimer) })
  })
  /** 停止本 composable 的全部监听与定时器（组件外调用时由调用方负责） */
  function dispose () {
    scope.stop()
  }

  return {
    strategyMode,
    rewriteStrategyId,
    rewriteStrategies,
    previewStrategyName,
    loadRewriteStrategies,
    refreshStrategyPreview,
    dispose,
  }
}
