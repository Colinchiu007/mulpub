/**
 * useFirstRunGate — 首运向导的启动判定（UX-AUDIT 阶段 1.4 / audit-4）
 *
 * 判据只有一条方向是安全的：**「没读到证据」不等于「还没做过引导」**。
 * 本仓 `firstRunCheck()` 在桥接缺失（浏览器开发态）时回 `{code:0,data:{setupDone:false}}`，
 * 若照字面把 `setupDone === false` 当"未引导"，就会出现：
 *   - 无 electronAPI 的开发态每次进首页都跳向导；
 *   - 主进程 IPC 抖动/读失败时把正常用户推进向导。
 * 因此导航只在**读到成功信封且 setupDone 严格为 false** 时发生，其余一律不动。
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { getApi } from '@/api/electron-bridge'

const FIRST_RUN_PATH = '/first-run'

/**
 * 纯判据（不含副作用），便于逐个分支测试。
 * @param {{api?: any, currentPath?: string}} deps
 * @returns {Promise<{navigate: boolean, reason: string}>}
 */
export async function evaluateFirstRunGate ({ api, currentPath = '/' } = {}) {
  const check = api && api.firstRunCheck
  if (typeof check !== 'function') return { navigate: false, reason: 'BRIDGE_UNAVAILABLE' }

  let res
  try {
    res = await check()
  } catch {
    return { navigate: false, reason: 'READ_FAILED' }
  }
  if (!res || res.code !== 0 || !res.data || typeof res.data !== 'object') {
    return { navigate: false, reason: 'NO_EVIDENCE' }
  }
  if (res.data.setupDone === true) return { navigate: false, reason: 'ALREADY_DONE' }
  if (res.data.setupDone !== false) return { navigate: false, reason: 'UNKNOWN_SHAPE' }
  if (currentPath === FIRST_RUN_PATH) return { navigate: false, reason: 'ALREADY_ON_WIZARD' }
  return { navigate: true, reason: 'PENDING' }
}

export function useFirstRunGate () {
  const router = useRouter()
  onMounted(async () => {
    const decision = await evaluateFirstRunGate({
      api: getApi(),
      currentPath: router.currentRoute.value.path,
    })
    if (decision.navigate) await router.replace(FIRST_RUN_PATH)
    return decision
  })
}
