/**
 * useContentCategories.js — 统一内容类别的渲染层单一消费口（2026-10-03）
 *
 * 为什么要有这个文件：热门选题分类、采集库类别标签、账号分组预设标签三处必须
 * 显示同一套类别。此前热门选题的分类名写死在 `locales` 与 `HotTopics.vue` 的
 * `CATEGORY_KEYS` 里，运营改不了；三处各写一份必然漂移。
 *
 * 复用既有 runtime 链路（不新建 IPC、不改 preload）：
 *   `opsCenterSyncRuntime()` → `{ code, data: { contentCategories } }`
 *   消费先例：`src/composables/useFeatureFlag.js`
 *
 * ⚠️ 口径与 feature flag **相反**，是刻意的：
 *   feature flag 是权限边界 ⇒ 读不到按**关闭**（fail-closed）；
 *   内容类别是**展示资产** ⇒ 读不到按**内置 11 类**（fail-open）。
 *   若这里也 fail-closed，运营中心没配过时热门选题会变成零分类、采集库打不了标签，
 *   离线用户直接不可用 —— 分类不是权限，不该被"读不到"惩罚。
 *
 * 三条硬语义（对应 useContentCategories.test.js）：
 * ① 读不到 / 空数组 / 结构非法 → 一律回退内置 11 类，且 `usingDefault=true` 出声。
 * ② 全应用共享一个 ref（模块级单例）：三处不可能出现两套类别。
 * ③ 运营下发变化时经 `onOpsCenterRuntimeUpdated` 重拉，不必重启应用。
 */
import { readonly, ref } from 'vue'
import {
  defaultItems,
  normalizeContentCategories,
  resolveCategoryLabel,
  defaultCategoryKeys,
  resolveDefaultCategoryName,
} from '@/features/content/content-categories'
import { opsCenterSyncRuntime, onOpsCenterRuntimeUpdated } from '@/api/ops-center-sync'

/** 全应用共享的类别列表（只读暴露，避免调用方就地改） */
const categories = ref(defaultItems())
/** 是否正在使用内置回退（true = 运营没下发/下发不可用） */
const usingDefault = ref(true)
/** 最近一次加载丢弃的非法项（逐条出声用，界面不强制消费） */
const dropped = ref([])
let loaded = false
let loading = null
let unsubscribe = null

/**
 * 加载统一内容类别。重复调用复用同一个 in-flight promise。
 * @returns {Promise<Array<{category_key:string,name:string,sort_order:number}>>}
 */
export async function loadContentCategories () {
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await opsCenterSyncRuntime()
      const payload = res && res.code === 0 ? res.data : null
      const normalized = normalizeContentCategories(
        payload && payload.contentCategories ? payload.contentCategories : null,
      )
      categories.value = normalized.items
      usingDefault.value = normalized.usingDefault
      dropped.value = normalized.dropped
      if (normalized.dropped.length) {
        // 出声但不静默改写：逐条原因进日志，界面按 usingDefault 决定要不要提示
        console.warn(
          '[content-categories] dropped items, count=' + normalized.dropped.length +
          ' reasons=' + [...new Set(normalized.dropped.map((d) => d.reason))].join(','),
        )
      }
      loaded = true
      return categories.value
    } catch (e) {
      // 调用抛错（非 Electron 环境 / IPC 缺失）→ 保持内置回退，不得清空
      console.warn('[content-categories] load failed, keeping defaults:', e && e.message ? e.message : e)
      categories.value = defaultItems()
      usingDefault.value = true
      loaded = true
      return categories.value
    } finally {
      loading = null
    }
  })()
  return loading
}

/**
 * 订阅运营配置变更 → 重拉类别。返回取消订阅函数。
 * 重复调用只订阅一次（全应用单例），避免每个页面各挂一个监听器。
 */
export function watchContentCategories () {
  if (unsubscribe) return unsubscribe
  unsubscribe = onOpsCenterRuntimeUpdated(() => {
    loading = null // 允许立即重拉，不等上一次
    loadContentCategories().catch(() => {})
  })
  return () => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
  }
}

/** 当前类别列表（只读） */
export function contentCategoriesRef () {
  return readonly(categories)
}

/** 是否使用内置回退 */
export function contentCategoriesUsingDefault () {
  return readonly(usingDefault)
}

/** 是否已加载过（首帧前为 false，界面可据此显示骨架） */
export function contentCategoriesLoaded () {
  return loaded
}

/**
 * 取类别显示名：运营下发值优先 → 内置本地化名 → key 本身。
 *
 * 为什么内置名要走 i18n 而不是写死中文：`src/` 非 locales 文件不得新增中文字符串
 * （CI Gate 7 --cjk 拦截），且英文界面下必须显示对应的英文类别名。
 *
 * @param {string} key
 * @param {(key: string) => string} [t] vue-i18n 的 t 函数；不传时退回 key
 */
export function categoryLabel (key, t) {
  const fromRemote = resolveCategoryLabel(key, categories.value)
  // resolveCategoryLabel 对「下发里没有」的 key 会回退到 DEFAULT_NAME_MAP，
  // 而 DEFAULT_NAME_MAP 现在是 key 本身 ⇒ 这里再经 i18n 解析出本地化名
  if (fromRemote !== key) return fromRemote
  return t ? resolveDefaultCategoryName(key, t) : key
}

/** 内置类别 key（抓取侧分类基准；分类器只认这些 key） */
export { defaultCategoryKeys }

export { normalizeContentCategories, resolveCategoryLabel, defaultItems }
