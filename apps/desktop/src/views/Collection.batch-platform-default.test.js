// @ts-check
/**
 * 采集页批量「平台」默认值必须等平台目录到位后补上（UX 审计 2.3 复核时发现的真缺陷）
 *
 * 审计项 2.3 原本写的是「Collection.vue 的 onMounted 改 allSettled」。复核结论要如实分开：
 * 采集页的 onMounted **已经**是 fire-and-forget 形态（前批完成），但正因为"不阻塞首屏"被
 * 做成了「不等待 + 同帧读派生值」，留下了这条后果：
 *
 *   if (!platformStore.loaded) { Promise.resolve(platformStore.load()).catch(() => {}) }   // 不 await
 *   ...
 *   if (!batchPlatformScope.value && batchPlatformOptions.value.length) {                   // 同帧就读
 *     batchPlatformScope.value = batchPlatformOptions.value[0].id
 *   }
 *
 * `batchPlatformOptions` 是 `computed(() => batch.usablePlatforms(...))`，其数据来自
 * `platformStore.platforms`。冷启动**直接落在采集页**时（刷新停在 `#/collection`、
 * 从兜底页/外链/快捷键直达），目录此刻还没到 ⇒ options 为空数组 ⇒ 这个 if 不成立，
 * 而它是唯一给 `batchPlatformScope` 赋默认值的地方 —— 之后目录到了也没人再补，
 * 用户看到的是「图文/视频批量发布的目标平台是空的，必须手选一次」。
 *
 * 契约（修后）：默认值必须由**平台目录这条数据流**驱动，而不是由"挂载那一刻"这个时机驱动；
 * 且不得为了拿到默认值把 `load()` 改回 await（那会把这条重新变成阻塞首屏，
 * 违反 AGENTS QM-2「首屏渲染不得阻塞在 IPC 返回之后」）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
  ElDialog: { template: '<div class="el-dialog"><slot></slot></div>' },
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// 平台目录用一个"可延迟兑现"的桩：先挂在 pending，用例自己决定什么时候让它 resolve，
// 以此复现冷启动那一帧（platformStore.loaded === false 且请求在飞）。
const catalog = vi.hoisted(() => {
  /** @type {{promise: Promise<any>, resolve: (v:any)=>void} | null} */
  const box = {}
  box.promise = new Promise((resolve) => { box.resolve = resolve })
  return box
})

// 只覆盖"平台目录"这一个出口，其余保持真实实现（无桥时走各自的 code:-1 兜底）。
// 手写全量 stub 是这条路的老坑：漏一个导出（实测 storeGetSetting）就让 onMounted 当场抛，
// 而抛错发生在平台加载之前 ⇒ 看起来像"没触发加载"，其实是夹具自己把用例打断了一半。
vi.mock('@/api/publisher', async () => {
  const actual = await vi.importActual('@/api/publisher')
  return { ...actual, getPlatformDefinitions: () => { catalog.calls += 1; return catalog.promise } }
})

import CollectionView from './Collection.vue'
import i18n from '@/i18n'

const TWO_PLATFORMS = {
  code: 0,
  data: {
    names: { douyin: '抖音', bilibili: 'B站', xiaohongshu: '小红书' },
    icons: {},
    loginUrls: {},
    dashboardUrls: {},
    qrCodePlatforms: [],
    // 类别真源是 content_categories（store 把 platforms 建成 {id,label}，
    // 类别经 getContentCategory 查这张表 —— 缺席就不算任何形态的可用平台）
    // 三个里放一个 VIDEO 形态，是为了让"视频清单"那条用例**非空可断**，
    // 而不是走进 else 分支变成恒真的装饰断言。
    content_categories: { douyin: 'IMAGE_TEXT', bilibili: 'IMAGE_TEXT', xiaohongshu: 'VIDEO' },
    // 两个可发图文，顺序即"默认值"的判据（第一个应当被选中）
    definitions: [
      { id: 'douyin', name: '抖音', contentCategory: 'IMAGE_TEXT' },
      { id: 'bilibili', name: 'B站', contentCategory: 'IMAGE_TEXT' },
      { id: 'xiaohongshu', name: '小红书', contentCategory: 'VIDEO' },
    ],
  },
}

async function settle () {
  await flushPromises()
  await nextTick()
  await flushPromises()
  await nextTick()
}

describe('Collection.vue — 批量平台默认值不得被"挂载那一帧"锁死（审计 2.3 复核）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
    // 每个用例都要新的延迟 promise（上一例兑现过的不能留给下一例）
    catalog.promise = new Promise((resolve) => { catalog.resolve = resolve })
    catalog.calls = 0
  })

  it('目录晚到（冷启动直达采集页）⇒ 平台目录到位后默认值必须自动补上', async () => {
    const w = mount(CollectionView, { global: { plugins: [createPinia(), i18n] } })
    await settle()

    // ① 请求确实在挂载时发起了，且**没有被 await**（首屏不阻塞）
    expect(catalog.calls, '挂载必须自己触发目录加载').toBeGreaterThanOrEqual(1)
    const batch = w.vm.batch
    expect(batch.batchSelection.value.imageText.platforms, '目录未到时应为空是合理的').toEqual([])

    // ② 目录到了 —— 默认值必须由数据流补上，而不是等下一次挂载
    catalog.resolve(TWO_PLATFORMS)
    await settle()
    await settle()

    const options = w.vm.batchPlatformOptions
    expect(options.length, '平台目录应已就位').toBe(2)
    expect(w.vm.batchPlatformScope, '默认目标平台必须自动取目录首项').toBe('douyin')
    expect(batch.batchSelection.value.imageText.platforms, 'scope 必须经 watch 落到批量选择里').toEqual(['douyin'])
  })

  it('用户已经手选过 ⇒ 目录后到不得把他的选择冲掉', async () => {
    const w = mount(CollectionView, { global: { plugins: [createPinia(), i18n] } })
    await settle()

    w.vm.batchPlatformScope = 'bilibili'
    catalog.resolve(TWO_PLATFORMS)
    await settle()
    await settle()

    expect(w.vm.batchPlatformScope, '默认值只在"还没有选过"时补位').toBe('bilibili')
  })

  it('默认值只能有一个写者：数据流 watcher 之外不得再出现赋值（防"顺手补一行"）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const url = await import('node:url')
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    const src = fs.readFileSync(path.resolve(here, 'Collection.vue'), 'utf8')
    const writers = src.split(/\r?\n/).filter((line) => /batchPlatformScope\.value\s*=/.test(line))
    // 扫到 0 行同样要红（那是"我改丢了"，不是"没有第二写者"）
    expect(writers.length, 'batchPlatformScope 的赋值点必须恰好 1 处').toBe(1)
    expect(writers[0], '唯一赋值点必须在 watch(batchPlatformOptions) 里，不在 onMounted').toMatch(/list\[0\]\.id/)
    expect(src, '必须保留数据流驱动这一维').toMatch(/watch\(\s*batchPlatformOptions\s*,/)
    expect(src, '不得为了拿默认值把目录加载改回 await（那会重新阻塞首屏）').toMatch(
      /if \(!platformStore\.loaded\) \{ Promise\.resolve\(platformStore\.load\(\)\)\.catch\(\(\) => \{\}\) \}/,
    )
  })

  it('视频形态的平台默认值同一条契约（两个形态各自一份清单）', async () => {
    const w = mount(CollectionView, { global: { plugins: [createPinia(), i18n] } })
    await settle()
    catalog.resolve(TWO_PLATFORMS)
    await settle()
    await settle()

    const videoOptions = w.vm.batchVideoPlatformOptions
    if (videoOptions.length > 0) {
      expect(w.vm.batchVideoPlatformScope, '视频清单非空时默认值也必须补上').toBe(videoOptions[0].id)
    } else {
      // 该 fixture 里没有可发视频的形态时，必须"什么都不选"而不是选到图文那一项
      expect(w.vm.batchVideoPlatformScope).toBe('')
    }
  })

  // QM-6（claude 轴，SINGLE 评审）i1：上面三例都从「挂载时目录仍 pending」出发，
  // 于是 `{ immediate: true }` 那一支一次都没被走过 —— 摘掉它 4/4 照绿（实测）。
  // 而"目录已在场"不是边角场景，它正是**被本批删掉的那段 onMounted 代码原本唯一覆盖得住的场景**
  // （热 store 下同帧读派生值本来就拿得到），所以漏掉这一支 = 修复把老场景重新弄坏。
  it('目录已在场（从别的路由切回采集页，store 是热的）⇒ 挂载当帧就必须有默认值（immediate 那一支）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    // 第一趟只负责把 store 焐热；**前提是它真的热了**，所以这一步要自己断言，不能假设
    const warm = mount(CollectionView, { global: { plugins: [pinia, i18n] } })
    await settle()
    catalog.resolve(TWO_PLATFORMS)
    await settle()
    await settle()
    expect(warm.vm.batchPlatformOptions.length, '前提：第一趟结束时目录已就位').toBe(2)
    warm.unmount()

    // 第二趟：同一个 pinia ⇒ setup 时 options 就非空，此后 source 不会再变，
    // 只有 watch 的 immediate 会让默认值出现；非 immediate 写法在这里必须红。
    catalog.calls = 0
    const w = mount(CollectionView, { global: { plugins: [pinia, i18n] } })
    expect(catalog.calls, '前提：热目录不得再发一次请求（发了就说明本用例走的还是冷启动那一支）').toBe(0)
    expect(w.vm.batchPlatformScope, '热目录必须在挂载当帧就补上图文默认值').toBe('douyin')
    expect(w.vm.batchVideoPlatformScope, '热目录必须在挂载当帧就补上视频默认值').toBe('xiaohongshu')
  })
})
