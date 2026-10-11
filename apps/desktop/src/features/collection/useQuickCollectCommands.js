/**
 * useQuickCollectCommands — 快捷采集指令的加载 / CRUD / 落盘
 *
 * 内置指令来自主进程（`quick-collect:list-presets`），自定义指令来自 store 设置键
 * （与 collected_items 同通道）。落盘只写自定义指令 —— 内置词条以主进程为真源，
 * 落盘副本会在版本升级后盖住新词条（PRD §5.2）。
 *
 * 读失败与"确实没有"必须区分：`storeGetSettingResult` 保留信封，读失败时置 `readFailed`
 * 让界面出声（否则用户会以为自己的指令被清空了）。
 */
import { ref, computed } from 'vue'
import { storeGetSettingResult, storeSetSetting } from '@/api/publisher'
import { quickCollectListPresets } from '@/api/quick-collect'
import {
  QUICK_COLLECT_COMMANDS_KEY,
  buildCommandFromForm,
  decodeCommands,
  encodeCommands,
  mergeCommands,
  sortCustomCommands,
} from './quick-collect-commands'

export function useQuickCollectCommands () {
  /** @type {import('vue').Ref<object[]>} */
  const presets = ref([])
  /** @type {import('vue').Ref<object[]>} */
  const customs = ref([])
  const loading = ref(false)
  const skipped = ref(0)
  const presetsFailed = ref(false)
  const readFailed = ref(false)

  const allCommands = computed(() => mergeCommands(presets.value, customs.value))

  /** 内置 id 集合：编辑/删除必须按「是不是内置」拒绝，而不是按"没找到"（两者原因不同） */
  const presetIds = computed(() => new Set(presets.value.map((c) => c && c.id).filter(Boolean)))

  /** 加载内置目录 + 自定义指令 */
  async function load () {
    loading.value = true
    try {
      const res = await quickCollectListPresets()
      const ok = res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0
      presets.value = ok ? res.data : []
      presetsFailed.value = !ok
    } catch (_) {
      presets.value = []
      presetsFailed.value = true
    } finally {
      loading.value = false
    }

    try {
      const res = await storeGetSettingResult(QUICK_COLLECT_COMMANDS_KEY)
      if (res && res.code === 0) {
        const decoded = decodeCommands(res.data)
        customs.value = sortCustomCommands(decoded.commands)
        skipped.value = decoded.skipped
        readFailed.value = false
      } else {
        customs.value = []
        skipped.value = 0
        readFailed.value = true
      }
    } catch (_) {
      customs.value = []
      skipped.value = 0
      readFailed.value = true
    }
  }

  /** 落盘（只写自定义） */
  async function persist () {
    return storeSetSetting(QUICK_COLLECT_COMMANDS_KEY, encodeCommands(customs.value))
  }

  /**
   * 新增自定义指令。
   * @returns {Promise<{ ok: boolean, command?: object }>} 校验不通过返回 `{ ok: false }`
   */
  async function addCommand (form) {
    const command = buildCommandFromForm(form, { existing: customs.value })
    if (!command) return { ok: false }
    customs.value = sortCustomCommands([...customs.value, command])
    await persist()
    return { ok: true, command }
  }

  /**
   * 编辑自定义指令（内置不可编辑）。
   * @returns {Promise<{ ok: boolean, code?: string, command?: object }>}
   */
  async function updateCommand (id, form) {
    if (presetIds.value.has(id)) return { ok: false, code: 'QC_BUILTIN_READONLY' }
    const target = customs.value.find((c) => c.id === id)
    if (!target) return { ok: false, code: 'QC_NOT_FOUND' }
    if (target.builtin === true) return { ok: false, code: 'QC_BUILTIN_READONLY' }
    const command = buildCommandFromForm(form, { existing: customs.value, excludeId: id, preset: target })
    if (!command) return { ok: false }
    customs.value = sortCustomCommands(customs.value.map((c) => (c.id === id ? command : c)))
    await persist()
    return { ok: true, command }
  }

  /**
   * 删除自定义指令（内置不可删除；不影响已采集结果）。
   * @returns {Promise<{ ok: boolean, code?: string }>}
   */
  async function removeCommand (id) {
    if (presetIds.value.has(id)) return { ok: false, code: 'QC_BUILTIN_READONLY' }
    const target = customs.value.find((c) => c.id === id)
    if (!target) return { ok: false, code: 'QC_NOT_FOUND' }
    if (target.builtin === true) return { ok: false, code: 'QC_BUILTIN_READONLY' }
    customs.value = customs.value.filter((c) => c.id !== id)
    await persist()
    return { ok: true }
  }

  return {
    presets,
    customs,
    allCommands,
    loading,
    skipped,
    presetsFailed,
    readFailed,
    load,
    persist,
    addCommand,
    updateCommand,
    removeCommand,
  }
}
