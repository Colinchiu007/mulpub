// @ts-check
/**
 * useFilmKitImport — 影视工程「资产导入」（PR-3b · F-J 写路径）的渲染端状态
 *
 * 从 `useFilmEngineering.js` 拆出（**按职责**：导入是独立写路径，混在浏览 composable 里
 * 会把那个文件顶过 `check-max-lines` 的 500 行硬限）。
 *
 * 契约：
 *   - **无参数**调用导入：路径只能由主进程的原生对话框返回（renderer 不能指定替换内容）；
 *   - 失败时主进程回传 `errorCode`（= 方案 §五 的 reason 闭集值）⇒ 渲染端**分桶本地化**
 *     （不把裸 code 甩给用户），并按 `recoveryState` 给出**可执行的恢复步骤**；
 *   - **取消不算失败**：不弹错误提示。
 */
import { ref, computed } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { formatUserError } from '@/utils/user-facing-error'
import i18n from '@/i18n'
import { useNotify } from './useNotify'

const t = (key) => i18n.global.t(key)

/** 失败原因（主进程 reason 闭集）→ i18n 桶（6 个） */
const IMPORT_REASON_BUCKETS = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION',
  NOT_A_DIRECTORY: 'VALIDATION',
  PATH_ESCAPE: 'VALIDATION',
  SYMLINK_REJECTED: 'VALIDATION',
  HARDLINK_REJECTED: 'VALIDATION',
  HIDDEN_NAME_REJECTED: 'VALIDATION',
  EXT_NOT_ALLOWED: 'VALIDATION',
  MAGIC_MISMATCH: 'VALIDATION',
  SIZE_EXCEEDED: 'VALIDATION',
  SOURCE_OVERLAPS_TARGET: 'VALIDATION',
  LOCK_CREATE_FAILED: 'LOCK',
  LOCK_HELD: 'LOCK',
  AUDIT_UNAVAILABLE: 'AUDIT',
  SWAP_FAILED: 'SWAP',
  ROLLBACK_FAILED: 'SWAP',
  PARENT_NOT_WRITABLE: 'PERM',
  UNAUTHORIZED_SENDER: 'UNAUTHORIZED',
})

/** 残留档位 → 恢复指引 i18n 键 */
const RECOVERY_KEYS = Object.freeze({
  PRE_SWAP: 'recoverLock',
  MISSING_KIT: 'recoverMissing',
  BAK_LEFT: 'recoverBak',
  LOCK_LEFT: 'recoverLock',
})

export function useFilmKitImport (options) {
  const opts = options || {}
  const onImported = typeof opts.onImported === 'function' ? opts.onImported : () => {}
  const { notifyWarning, notifySuccess } = useNotify()

  /** 导入中（入口禁用 + 不可中断模态） */
  const importing = ref(false)
  /** 最近一次失败的原因（reason 闭集值） */
  const kitImportReason = ref('')
  /** 最近一次失败的恢复路径（主进程回传，可能为空） */
  const kitImportRecoveryPath = ref('')
  /** 最近一次失败的残留档位（PRE_SWAP / MISSING_KIT / BAK_LEFT / LOCK_LEFT） */
  const kitImportRecoveryState = ref('')

  /** 失败原因 → 本地化桶文案 */
  function importReasonText (reason) {
    const bucket = IMPORT_REASON_BUCKETS[reason] || 'VALIDATION'
    return t('filmEngineering.filmKitImport.reason.' + bucket)
  }

  /** 恢复指引文案（按残留档位；无 ⇒ 空串） */
  const kitImportRecoveryHint = computed(() => {
    const key = RECOVERY_KEYS[kitImportRecoveryState.value]
    if (!key) return ''
    return t('filmEngineering.filmKitImport.' + key, { path: kitImportRecoveryPath.value || '' })
  })

  /**
   * 执行导入。
   * @returns {Promise<boolean>} 是否导入成功（取消 ⇒ false，且**不算失败**）
   */
  async function importKitAssets () {
    const api = (getApi() || {}).filmEngineering
    if (!api || typeof api.importKit !== 'function') {
      notifyWarning('filmEngineering.filmKitImport.failed', {
        message: t('filmEngineering.noDesktopWarning'),
      })
      return false
    }
    importing.value = true
    kitImportReason.value = ''
    kitImportRecoveryPath.value = ''
    kitImportRecoveryState.value = ''
    try {
      const res = await api.importKit()
      if (res && res.code === 0) {
        if (res.data && res.data.cancelled) {
          // 取消**不算失败**（不弹错误提示）
          return false
        }
        notifySuccess('filmEngineering.filmKitImport.success', {
          message: t('filmEngineering.filmKitImport.success', { count: (res.data && res.data.fileCount) || 0 }),
        })
        await onImported()
        return true
      }
      const reason = (res && res.errorCode) || 'VALIDATION_ERROR'
      kitImportReason.value = reason
      kitImportRecoveryPath.value = (res && res.data && res.data.recoveryPath) || ''
      kitImportRecoveryState.value = (res && res.data && res.data.recoveryState) || ''
      notifyWarning('filmEngineering.filmKitImport.failed', {
        message: t('filmEngineering.filmKitImport.failed', { reason: importReasonText(reason) }),
      })
      return false
    } catch (e) {
      notifyWarning('filmEngineering.filmKitImport.failed', {
        message: formatUserError(e, {
          fallback: t('filmEngineering.filmKitImport.failed', { reason: importReasonText('VALIDATION_ERROR') }),
        }).message,
      })
      return false
    } finally {
      importing.value = false
    }
  }

  return {
    importing,
    kitImportReason,
    kitImportRecoveryPath,
    kitImportRecoveryState,
    kitImportRecoveryHint,
    importKitAssets,
    importReasonText,
  }
}
