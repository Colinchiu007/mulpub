/**
 * useFirstRunGate —— 首启向导的启动判定（UX 审计 1.4）
 *
 * 为什么走"拉"不走"推"：主进程的 `first-run:status` 推送发生在窗口创建时
 * （`electron/window.js` 调 `runSetup`），而渲染端的订阅发生在 `onMounted` ——
 * 推送必然早于订阅，事件丢失且没有重试。所以"进不进向导"只能由渲染端主动问一次决定，
 * 事件通道只保留给向导页内部的状态更新。
 *
 * 三条硬口径：
 *  1. 判定只在 `code === 0 && data.setupDone` 是布尔时生效。兜底档（桥不可用）与读失败
 *     **一律不动导航** —— 把"没读到"读成"还没做过"会让浏览器 dev server 每次访问都跳向导。
 *  2. 一次会话只决定一次（模块级闩）；App 重挂载不得重复 push。
 *  3. 已在 `/first-run` 时不重复 push（vue-router 同路由 push 会抛 NavigationDuplicated）。
 */
import { firstRunCheck } from '@/api/publisher'

const FIRST_RUN_PATH = '/first-run'

let decided = false

export async function maybeEnterFirstRun (opts = {}) {
  // QM-6 i6：默认必须是**真出声**。原先默认 noop + App.vue 不传 warn ⇒ "check 抛错 ⇒ 出声"
  // 这条契约在生产接线里永远不成立（gate 内部已 catch，App.vue 的 .catch 对该情形永不触发），
  // 于是"读不到判定"与"判定说不用导航"在日志里同形。测试仍可注入自己的 sink。
  const { router, check = firstRunCheck, warn = (msg) => console.warn(msg) } = opts

  if (decided) return { action: 'skipped', reason: 'already-decided' }

  let res = null
  let threw = false
  try {
    res = await check()
  } catch (error) {
    threw = true
    warn('[first-run] startup check threw, keeping current route: ' + ((error && error.message) || String(error)))
  }
  if (threw) return { action: 'skipped', reason: 'check-threw' }

  const setupDone = res && res.code === 0 && res.data ? res.data.setupDone : undefined
  if (typeof setupDone !== 'boolean') {
    // 桥不可用 / 结构不符：不导航，也不置闩 —— 下一次挂载还可以再判一次。
    return { action: 'skipped', reason: 'unavailable' }
  }

  decided = true
  if (setupDone) return { action: 'skipped', reason: 'done' }

  if (router && router.currentRoute && router.currentRoute.value && router.currentRoute.value.path === FIRST_RUN_PATH) {
    return { action: 'skipped', reason: 'already-there' }
  }
  if (!router || typeof router.push !== 'function') return { action: 'skipped', reason: 'no-router' }

  try {
    // QM-6 第二轮 i1：vue-router 4 对「被守卫挡下 / 被更新的导航中止 / 同路由重复」是
    // **resolve 一个 NavigationFailure**，不是 reject（本机实测：`beforeEach: () => false`
    // 时 push resolve 出一个 `[object Error]`，`type=4`，`message="Navigation aborted from …"`；
    // 而导航成功时 push resolve 的是 `undefined`）。
    // 因此判别式用与模块实例无关的 `instanceof Error`：宿主的 Error 内建在两份 vue-router
    // 实例下是同一个，而官方谓词 `isNavigationFailure` 要求内部 Symbol 属于**它自己那份**实例 ——
    // 少一层可漂的前提，就少一层将来会误判的依赖。
    // 只看 catch 的后果：`await push` 正常返回、`decided` 已置位且永不释放 ⇒
    // 全新用户本会话静默永久跳过向导，且零日志（与本文件头注释第 1 条的验收标准直接冲突）。
    const failure = await router.push(FIRST_RUN_PATH)
    if (failure instanceof Error) {
      decided = false
      warn('[first-run] navigation to ' + FIRST_RUN_PATH + ' was rejected by the router ('
        + describeFailure(failure) + '), latch released')
      return { action: 'skipped', reason: 'push-failed' }
    }
  } catch (error) {
    // QM-6 i2：导航没成 ⇒ 闩必须放开。置闩在 push 之前意味着"守卫 reject / redirect、
    // router 未就绪"这类一次性失败会把全新用户**永久**挡在向导外，而且无声 ——
    // 验收标准是"全新首启必须进向导"，静默跳过比多判一次严重得多。
    decided = false
    warn('[first-run] navigation to ' + FIRST_RUN_PATH + ' failed, latch released: ' + ((error && error.message) || String(error)))
    return { action: 'skipped', reason: 'push-failed' }
  }
  return { action: 'navigated' }
}

/**
 * 失败的可归因描述。
 *
 * 实测（本机 `node -e` 用**已安装**的 vue-router 跑一次 `beforeEach: () => false` 的导航）：
 * `push` 是 **resolve** 出一个 `[object Error]`，`type=4`（NavigationFailureType.aborted），
 * 并自带 `message`。所以这里直接取宿主写好的 `message`，**不得**手抄一份 type→名字的映射表 ——
 * 该枚举的真实值是 aborted=4 / cancelled=8 / duplicated=16（我第一版凭印象写成
 * `{1:aborted,2:cancelled,4:duplicated,8:guardRejected}`，三个数全错），
 * 抄表等于把日志钉在错数上。兜底只留 `type` 本身：认不出形态也必须出声，
 * 不得读成「导航成功」。
 */
function describeFailure (failure) {
  if (!failure) return 'unknown failure'
  if (typeof failure.message === 'string' && failure.message.trim() !== '') return failure.message
  return 'NavigationFailure type=' + String(failure.type)
}

/** 仅供测试复位模块级闩；生产代码不得调用 */
export function __resetFirstRunGateForTest () {
  decided = false
}
