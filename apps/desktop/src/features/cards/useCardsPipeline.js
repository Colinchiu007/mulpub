/**
 * useCardsPipeline — 把「正文 → 分页 → 渲染」串成一条可观测的流水线（P2-5/P2-6 合流）
 *
 * ## 为什么需要这一层
 *
 * 三块已各自落地，但**互不认识**：
 *
 *   useArticlePagination（P2-6 上游）  正文 → items → pages + warnings
 *   useCardsRender（P2-5 第二批）      pages → PNG 路径 + warnings
 *   CardsRenderPanel（P2-5 第三批）    展示
 *
 * 直接在前端组件里依次调两个 composable 会丢掉三样东西：
 *
 * 1. **两处 warnings 的合并与去重** —— 分页器的 `item-exceeds-page` /
 *    `page-limit-reached` 与渲染侧的告警是**同一类用户必须知情的信息**，
 *    分开展示会让用户漏看；直接拼数组又会重复（同一条可能两边都给）。
 * 2. **失败归属** —— 「分页失败」与「渲染失败」的文案与后续动作不同
 *    （前者是输入问题，后者是环境问题）。混成一个 `failed` 就无法点名阶段。
 * 3. **中间态不可见** —— 分页也是耗时操作（真实 DOM 测量），用户需要知道
 *    「正在分页」而不是只看到「正在渲染」。
 *
 * ## 流水线是**可取消重入**的
 *
 * 用户改一个字就重跑是常态。故每次 run() 先 `generation++`，
 * 任一步完成后校验 generation 是否仍是最新，不是就**丢弃结果**（不写 ref）。
 * 否则旧的分页结果会在新的渲染完成后被写回，用户看到错的那一版。
 */
import { computed, ref } from 'vue'
import { useArticlePagination } from './useArticlePagination'
import { useCardsRender } from './useCardsRender'

/** 流水线阶段（用于点名「卡在哪一步」） */
export const STAGE = {
  IDLE: 'idle',
  PAGINATING: 'paginating',
  RENDERING: 'rendering',
  DONE: 'done',
}

export function useCardsPipeline () {
  const pagination = useArticlePagination()
  const render = useCardsRender()

  /** @type {import('vue').Ref<string>} 当前阶段 */
  const stage = ref(STAGE.IDLE)
  /** @type {import('vue').Ref<{ stage: 'paginate' | 'render', key: string, vars?: object } | null>} 失败归属 */
  const failure = ref(null)
  /** @type {import('vue').Ref<string[]>} 合并去重后的 warnings（**非空即必须展示**） */
  const warnings = ref([])
  /** 重入计数器：旧流水线完成后据此判断结果是否已过期 */
  let generation = 0

  const running = computed(() => stage.value === STAGE.PAGINATING || stage.value === STAGE.RENDERING)

  function reset () {
    generation++
    stage.value = STAGE.IDLE
    failure.value = null
    warnings.value = []
    pagination.reset()
    render.reset()
  }

  /** 合并两处 warnings 并去重（保持首次出现顺序，渲染稳定） */
  function mergeWarnings (a, b) {
    const out = []
    for (const w of [...a, ...b]) {
      if (typeof w === 'string' && w.length > 0 && !out.includes(w)) out.push(w)
    }
    return out
  }

  /**
   * 跑完整流水线。
   *
   * @param {object} args
   * @param {string} args.text 编辑器正文
   * @param {(text: string, item: object) => Promise<number>} args.measure 高度测量（注入）
   * @param {number} [args.availableHeightPx] 页高
   * @param {number} [args.maxPages] 页数上限
   * @param {number} [args.widthPx] 渲染视口宽
   * @param {number} [args.heightPx] 渲染视口高
   * @returns {Promise<boolean>} 是否走通（分页 + 渲染都成功）
   */
  async function run (args) {
    const my = ++generation
    stage.value = STAGE.PAGINATING
    failure.value = null
    warnings.value = []

    // ── 阶段一：分页 ────────────────────────────────────────────────
    const okPage = await pagination.paginate({
      text: args.text,
      measure: args.measure,
      ...(args.availableHeightPx === undefined ? {} : { availableHeightPx: args.availableHeightPx }),
      ...(args.maxPages === undefined ? {} : { maxPages: args.maxPages }),
    })
    if (my !== generation) return false // 已被更新的 run() 取代 ⇒ 丢弃
    if (!okPage) {
      failure.value = { stage: 'paginate', key: pagination.failure.value?.key || 'failed', vars: {} }
      stage.value = STAGE.DONE
      return false
    }

    // ── 阶段二：渲染 ────────────────────────────────────────────────
    stage.value = STAGE.RENDERING
    const okRender = await render.render({
      pages: pagination.pages.value,
      // ★ 过期探针下沉到写 ref 的那一层：resultFiles 是 useCardsRender 写的，
      //   pipeline 自己的 generation 守卫拦不住它的赋值（实测踩过：旧结果写回了）。
      isStale: () => my !== generation,
      ...(args.widthPx === undefined ? {} : { widthPx: args.widthPx }),
      ...(args.heightPx === undefined ? {} : { heightPx: args.heightPx }),
    })
    if (my !== generation) return false // 已被取代 ⇒ 丢弃（不写 warnings/失败）

    // ★ 两处 warnings 合并去重后一次性透出（分开展示会漏看，直接拼会重复）
    warnings.value = mergeWarnings(pagination.warnings.value, render.warnings.value)

    if (!okRender) {
      failure.value = { stage: 'render', key: render.failure.value?.key || 'failedUnknown', vars: render.failure.value?.vars || {} }
      stage.value = STAGE.DONE
      return false
    }

    stage.value = STAGE.DONE
    return true
  }

  return {
    stage,
    running,
    failure,
    warnings,
    // 透出下游状态，供面板直接用
    pages: pagination.pages,
    pageCount: pagination.pageCount,
    resultFiles: render.resultFiles,
    hasResult: render.hasResult,
    hasWarnings: computed(() => warnings.value.length > 0),
    run,
    reset,
  }
}
