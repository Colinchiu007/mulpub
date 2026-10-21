/**
 * usePublishProgressStaleness —— 发布进度「无更新」看门狗（ux-audit-progress-watchdog，阶段 1.8）
 *
 * 职责边界（与 usePublishProgressAutoCollapse 同源）：
 * - **判据本体**在 `utils/publish-progress-staleness.js`（阈值、锚点、相位域），本文件不重复实现；
 * - **计时器归组件所有**：store 保持纯状态，不在主 store 里挂 interval；
 * - 时钟只在「运行中有任务」时轮询，空闲即停——不给一个没有任何发布的应用留一个 15 秒常驻定时器。
 *
 * 为什么需要它：`task.lastEventAt` 早已被 store 写入，但渲染层没有任何读者（死观测字段）。
 * 任务在主进程侧卡住后不再发事件，面板就永远停在「进行中」、关闭按钮永远 disabled，
 * 用户被自己的进度面板锁死，只能等或重开应用。本 composable 把那份观测接成可见的结论。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { computeStaleInfo } from '@/utils/publish-progress-staleness.js'

/**
 * 陈旧状态的界面刷新间隔。
 * 这是「多久重算一次已经多久没动静」的采样周期，**不是**陈旧阈值本身
 * （阈值只有共享实现里那一个）。取 15s 的量级依据：面板文案粒度是「分钟」，
 * 15s 采样最坏让分钟数落后 15 秒，肉眼不可见；再密只是白烧定时器。
 */
export const STALE_TICK_INTERVAL_MS = 15_000

/**
 * @param {object} deps
 * @param {import('vue').Ref<boolean>|import('vue').ComputedRef<boolean>} deps.hasRunning 是否有运行中任务
 * @param {() => Array<object>} deps.sessions 取当前会话数组（在 computed 内调用以保持响应性）
 * @returns {{staleness: import('vue').ComputedRef<{stale: boolean, minutes: number, lastEventAt: number|null}>}}
 */
export function usePublishProgressStaleness({ hasRunning, sessions }) {
  const nowTick = ref(Date.now())
  let timer = null

  function stopTick() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function startTick() {
    // 每次开表都先取一次当前时刻：否则挂载即陈旧的场景要等满一个周期才出声
    nowTick.value = Date.now()
    if (timer !== null) return
    timer = setInterval(() => { nowTick.value = Date.now() }, STALE_TICK_INTERVAL_MS)
  }

  watch(hasRunning, (running) => {
    if (running) startTick()
    else {
      stopTick()
      // 收尾也要刷一次：hasRunning 落 false 后不再有轮询，此时的读数必须是当下的
      nowTick.value = Date.now()
    }
  }, { immediate: true })

  onBeforeUnmount(stopTick)

  const staleness = computed(() => computeStaleInfo(sessions(), nowTick.value))

  return { staleness }
}
