// @ts-check
/**
 * 弹窗互斥（内嵌视图挂起）守卫测试
 * —— WebContentsView 是原生图层，永远压在主窗口 DOM 之上（z-index 无效）。
 * 浏览器/登录标签（外部网页）活动时打开应用级模态浮层（设置弹窗 / 升级弹窗 /
 * 关闭未保存标签确认框），若不挂起内嵌视图，浮层会被整块盖住：
 * 用户点击后"屏幕闪一下、弹窗没出现"（2026-09-23 Bug 修复）。
 *
 * 完整链路断言：
 *   1. WebviewManager.suspendEmbeddedViewsForOverlay / releaseEmbeddedViewsForOverlay 行为
 *   2. IPC 通道 page-manager:suspend|resume-embedded-views 在 webview-manager 注册
 *   3. _repositionAll / createNewTabPage / switchToTab 尊重挂起态
 *   4. preload（page-manager.js + index.bundle.js）暴露 suspendEmbeddedViews / resumeEmbeddedViews
 *   5. 渲染层 composable + App.vue（设置弹窗、关闭确认护栏）/ MpSidebar（升级弹窗）接入
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

describe('弹窗互斥：静态链路完整性', () => {
  it('webview-manager 注册挂起/恢复 IPC handler 与方法', () => {
    // webview-manager 拆分后合读各子模块
    const src = [
      'electron/services/webview-manager/index.js',
      'electron/services/webview-manager/layout.js',
      'electron/services/webview-manager/ipc-handlers.js'
    ].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    expect(src).toContain("ipcMain.handle('page-manager:suspend-embedded-views'")
    expect(src).toContain("ipcMain.handle('page-manager:resume-embedded-views'")
    expect(src).toContain('suspendEmbeddedViewsForOverlay (owner)')
    expect(src).toContain('releaseEmbeddedViewsForOverlay (owner)')
    expect(src).toContain('isEmbeddedViewsSuspended ()')
    expect(src).toContain('this._overlaySuspensions = new Set()') // 构造器初始化
  })

  it('挂起期间不得恢复可见性：_repositionAll / createNewTabPage / switchToTab 均有守卫', () => {
    const src = [
      'electron/services/webview-manager/index.js',
      'electron/services/webview-manager/layout.js',
      'electron/services/webview-manager/tab-lifecycle.js',
      'electron/services/webview-manager/tab-query.js'
    ].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    // _repositionAll：挂起时隐藏全部标签并直接返回，不 setVisible(true)
    expect(src).toMatch(/_repositionAll \(\) \{[\s\S]*?if \(this\.isEmbeddedViewsSuspended\(\)\) \{\s*this\._hideAllTabs\(\)\s*return\s*\}/)
    // createNewTabPage：挂起时新标签以隐藏态挂载
    expect(src).toMatch(/self\._hideAllTabs\(\)[\s\S]*?view\.setVisible\(!self\.isEmbeddedViewsSuspended\(\)\)/)
    // switchToTab：挂起时切换目标标签不恢复显示
    expect(src).toMatch(/targetView\.setVisible\(!self\.isEmbeddedViewsSuspended\(\)\)/)
  })

  it('preload page-manager.js 暴露 suspendEmbeddedViews / resumeEmbeddedViews 且通道一致', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/preload/page-manager.js'), 'utf8')
    expect(src).toMatch(/suspendEmbeddedViews: \(owner\) => ipcRenderer\.invoke\('page-manager:suspend-embedded-views', owner\)/)
    expect(src).toMatch(/resumeEmbeddedViews: \(owner\) => ipcRenderer\.invoke\('page-manager:resume-embedded-views', owner\)/)
  })

  it('preload index.bundle.js 已重打包（含挂起/恢复通道）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'electron/preload/index.bundle.js'), 'utf8')
    expect(src).toContain('suspendEmbeddedViews')
    expect(src).toContain('page-manager:suspend-embedded-views')
    expect(src).toContain('page-manager:resume-embedded-views')
  })

  it('渲染层 composable 存在且调用 pageManager 挂起/恢复', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/composables/useEmbeddedViewSuspension.js'), 'utf8')
    expect(src).toContain('export async function suspendEmbeddedViewsForOverlay')
    expect(src).toContain('export async function releaseEmbeddedViewsForOverlay')
    expect(src).toContain("invokePageManager('suspendEmbeddedViews', owner)")
    expect(src).toContain("invokePageManager('resumeEmbeddedViews', owner)")
  })

  it('App.vue：设置弹窗打开期间挂起内嵌视图；关闭未保存标签确认框同样挂起', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/App.vue'), 'utf8')
    expect(src).toMatch(/watch\(showSettingsDialog, \(open\) => \{[\s\S]*?suspendEmbeddedViewsForOverlay\('settings-dialog'\)[\s\S]*?releaseEmbeddedViewsForOverlay\('settings-dialog'\)/)
    // 关闭未保存账号标签的三选一确认框（ElMessageBox 居中模态）打开前挂起、结束后释放
    expect(src).toMatch(/await suspendEmbeddedViewsForOverlay\('tab-close-confirm'\)/)
    expect(src).toMatch(/finally \{[\s\S]*?await releaseEmbeddedViewsForOverlay\('tab-close-confirm'\)/)
  })

  it('MpSidebar：升级 Pro 弹窗打开期间挂起内嵌视图', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/layouts/MpSidebar.vue'), 'utf8')
    expect(src).toMatch(/watch\(showUpgradeModal, \(open\) => \{[\s\S]*?suspendEmbeddedViewsForOverlay\('upgrade-modal'\)[\s\S]*?releaseEmbeddedViewsForOverlay\('upgrade-modal'\)/)
  })

  // owner 登记表：AccountCloudSyncDialog（账号云镜像同步弹窗，PRD-CLOUD-ACCOUNT-SYNC-2026-09-27 §10.1）
  // 是居中模态浮层，必须挂起/恢复内嵌视图；owner 唯一且 suspend/release 成对、release 走 finally。
  it('AccountCloudSyncDialog：【同步云端】弹窗接入挂起，owner 为 account-cloud-sync-dialog', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/features/accounts/components/AccountCloudSyncDialog.vue'), 'utf8')
    expect(src).toMatch(/const OVERLAY_OWNER = ['"]account-cloud-sync-dialog['"]/)

    // 逐函数取块（不用跨函数的懒惰匹配，否则锁会在实现被拆开时假绿）
    const suspendBlock = src.match(/async function suspendOverlay \(\) \{[\s\S]*?\n\}/)
    const releaseBlock = src.match(/async function releaseOverlay \(\) \{[\s\S]*?\n\}/)
    const closeBlock = src.match(/async function requestClose \(\) \{[\s\S]*?\n\}/)
    const unmountBlock = src.match(/onBeforeUnmount\(\(\) => \{[\s\S]*?\n\}\)/)
    expect(suspendBlock && suspendBlock[0]).toContain('await suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    expect(releaseBlock && releaseBlock[0]).toContain('await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    // 关闭路径：进行中关闭＝后台继续（只退订、不取消批次），但释放挂起必须在 finally 里
    expect(closeBlock && closeBlock[0]).toMatch(/try \{[\s\S]*?unsubscribeProgress\(\)[\s\S]*?\} finally \{[\s\S]*?releaseOverlay\(\)/)
    // 卸载兜底：组件销毁不得残留挂起计数
    expect(unmountBlock && unmountBlock[0]).toContain('releaseOverlay()')
    // 不得复用其它浮层的 owner（否则 ref-count 会把别人的释放吞掉）
    expect(src).not.toMatch(/suspendEmbeddedViewsForOverlay\(['"](?!account-cloud-sync-dialog)/)
  })

  // owner 登记表：发布页封面流程的三个模态浮层（PRD-PUBLISH-COVER-PREVIEW-2026-09-28 §7.5）。
  // 裁剪弹窗与 AI 封面浮层是本次一并补登记的既有漏项 —— 同一封面行里新浮层守规矩、
  // 旁边的不守，等于把同一个 Bug 留在原地。
  it('发布页封面流程：放大预览 / 裁剪弹窗 / AI 封面浮层各自持唯一 owner 并成对释放', () => {
    const cropSrc = fs.readFileSync(path.join(ROOT, 'src/components/CoverCropDialog.vue'), 'utf8')
    const previewSrc = fs.readFileSync(path.join(ROOT, 'src/components/CoverPreviewDialog.vue'), 'utf8')
    const publishSrc = fs.readFileSync(path.join(ROOT, 'src/views/Publish.vue'), 'utf8')

    expect(cropSrc).toMatch(/const OVERLAY_OWNER = ['"]publish-cover-crop-dialog['"]/)
    expect(previewSrc).toMatch(/const OVERLAY_OWNER = ['"]publish-cover-preview['"]/)
    expect(publishSrc).toMatch(/const AI_COVER_OVERLAY_OWNER = ['"]publish-ai-cover-dialog['"]/)

    // 逐函数取块（不用跨函数的懒惰匹配，否则锁会在实现被拆开时假绿）
    const cropSuspend = cropSrc.match(/async function suspendOverlay \(\) \{[\s\S]*?\n\}/)
    const cropRelease = cropSrc.match(/async function releaseOverlay \(\) \{[\s\S]*?\n\}/)
    expect(cropSuspend && cropSuspend[0]).toContain('await suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    expect(cropRelease && cropRelease[0]).toContain('await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    expect(cropSrc).toMatch(/onBeforeUnmount\(\(\) => \{ releaseOverlay\(\) \}\)/)

    // 放大预览与裁剪弹窗同构：owner 随组件走，开合由 visible 驱动，卸载再兜一层。
    const previewSuspend = previewSrc.match(/async function suspendOverlay \(\) \{[\s\S]*?\n\}/)
    const previewRelease = previewSrc.match(/async function releaseOverlay \(\) \{[\s\S]*?\n\}/)
    expect(previewSuspend && previewSuspend[0]).toContain('await suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    expect(previewRelease && previewRelease[0]).toContain('await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    expect(previewSrc).toMatch(/onBeforeUnmount\(\(\) => \{ releaseOverlay\(\) \}\)/)
    // 开合两条路径必须由同一个 watch 收口，且 immediate 覆盖「以 visible=true 首次挂载」
    expect(previewSrc).toMatch(
      /watch\(\(\) => props\.visible,[\s\S]*?if \(open\) \{[\s\S]*?suspendOverlay\(\)[\s\S]*?\} else \{[\s\S]*?releaseOverlay\(\)[\s\S]*?\}, \{ immediate: true \}\)/,
    )

    const aiSuspend = publishSrc.match(/async function suspendAiCoverOverlay \(\) \{[\s\S]*?\n\}/)
    const aiRelease = publishSrc.match(/async function releaseAiCoverOverlay \(\) \{[\s\S]*?\n\}/)
    expect(aiSuspend && aiSuspend[0]).toContain('await suspendEmbeddedViewsForOverlay(AI_COVER_OVERLAY_OWNER)')
    expect(aiRelease && aiRelease[0]).toContain('await releaseEmbeddedViewsForOverlay(AI_COVER_OVERLAY_OWNER)')

    // 卸载兜底：AI 封面浮层的 owner 由本视图持有，销毁不得残留
    expect(publishSrc).toMatch(/onBeforeUnmount\(releaseAiCoverOverlay\)/)

    // 三处一律经命名常量传 owner：出现字面量即意味着有人绕过登记直接塞了个 owner
    expect(cropSrc).not.toMatch(/EmbeddedViewsForOverlay\(['"]/)
    expect(previewSrc).not.toMatch(/EmbeddedViewsForOverlay\(['"]/)
    expect(publishSrc).not.toMatch(/EmbeddedViewsForOverlay\(['"]/)
  })

  // owner 登记表：常用话题标签管理弹窗（topic-tag-unify，2026-10-12）。
  // 发布页单篇与批量卡片共用同一弹窗实例；owner 唯一、suspend/release 成对、
  // 卸载兜底（visible=false 与 onBeforeUnmount 双出口）。
  it('TopicTagManagerDialog：话题标签管理弹窗接入挂起，owner 为 topic-tag-manager-dialog', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/components/TopicTagManagerDialog.vue'), 'utf8')
    expect(src).toMatch(/const OVERLAY_OWNER = ['"]topic-tag-manager-dialog['"]/)

    const suspendBlock = src.match(/async function suspendOverlay \(\) \{[\s\S]*?\n\}/)
    const releaseBlock = src.match(/async function releaseOverlay \(\) \{[\s\S]*?\n\}/)
    expect(suspendBlock && suspendBlock[0]).toContain('await suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    expect(releaseBlock && releaseBlock[0]).toContain('await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    // 开合两条路径必须由同一个 watch 收口，且 immediate 覆盖「以 visible=true 首次挂载」
    expect(src).toMatch(
      /watch\(\(\) => props\.visible,[\s\S]*?if \(open\) \{[\s\S]*?suspendOverlay\(\)[\s\S]*?\} else \{[\s\S]*?releaseOverlay\(\)[\s\S]*?\}, \{ immediate: true \}\)/,
    )
    // 卸载兜底
    expect(src).toMatch(/onBeforeUnmount\(\(\) => \{ releaseOverlay\(\) \}\)/)
    // owner 一律经命名常量传递
    expect(src).not.toMatch(/EmbeddedViewsForOverlay\(['"]/)
  })

  // owner 登记表：CreateView BGM 素材库两个模态浮层（拆分方案 v3 §2.4，CreateView 拆分第 1 步）。
  // 素材库弹窗是一级浮层（openBgmLibraryDialog 挂起），删除确认是其内二级浮层（requestBgmDelete 挂起），
  // 各自持唯一 owner；释放成对且 beforeUnmount 兜底（父组件直接销毁时不经过 visible=false）。
  it('CreateView BGM 素材库：素材库弹窗 / 删除确认弹窗各自持唯一 owner 并成对释放 + 卸载兜底', () => {
    const bgmSrc = fs.readFileSync(path.join(ROOT, 'src/views/video-creation/composables/useBgmLibrary.js'), 'utf8')
    const createSrc = fs.readFileSync(path.join(ROOT, 'src/views/CreateView.vue'), 'utf8')

    expect(bgmSrc).toMatch(/BGM_LIBRARY_OVERLAY_OWNER = ['"]create-bgm-library-dialog['"]/)
    expect(bgmSrc).toMatch(/BGM_LIBRARY_DELETE_OVERLAY_OWNER = ['"]create-bgm-library-delete-dialog['"]/)

    // 素材库弹窗：open 挂起 / close 释放（成对）
    const openBlock = bgmSrc.match(/async function openBgmLibraryDialog \(\) \{[\s\S]*?\n\}/)
    const closeBlock = bgmSrc.match(/function closeBgmLibraryDialog \(\) \{[\s\S]*?\n\}/)
    expect(openBlock && openBlock[0]).toContain('await suspendEmbeddedViewsForOverlay(BGM_LIBRARY_OVERLAY_OWNER)')
    expect(closeBlock && closeBlock[0]).toContain('releaseEmbeddedViewsForOverlay(BGM_LIBRARY_OVERLAY_OWNER)')

    // 删除确认弹窗：request 挂起 / close 释放（成对）
    const reqBlock = bgmSrc.match(/function requestBgmDelete \(item\) \{[\s\S]*?\n\}/)
    const closeDelBlock = bgmSrc.match(/function closeBgmDeleteDialog \(\) \{[\s\S]*?\n\}/)
    expect(reqBlock && reqBlock[0]).toContain('suspendEmbeddedViewsForOverlay(BGM_LIBRARY_DELETE_OVERLAY_OWNER)')
    expect(closeDelBlock && closeDelBlock[0]).toContain('releaseEmbeddedViewsForOverlay(BGM_LIBRARY_DELETE_OVERLAY_OWNER)')

    // 卸载兜底：releaseAllOverlays 双 owner 都释放，且 CreateView beforeUnmount 调用
    const releaseAll = bgmSrc.match(/async function releaseAllOverlays \(\) \{[\s\S]*?\n\}/)
    expect(releaseAll && releaseAll[0]).toContain('releaseEmbeddedViewsForOverlay(BGM_LIBRARY_OVERLAY_OWNER)')
    expect(releaseAll && releaseAll[0]).toContain('releaseEmbeddedViewsForOverlay(BGM_LIBRARY_DELETE_OVERLAY_OWNER)')
    expect(createSrc).toMatch(/bgmLibraryMethods\.releaseAllOverlays\(\)/)

    // owner 一律经命名常量传递：出现字面量即意味着绕过登记
    expect(bgmSrc).not.toMatch(/EmbeddedViewsForOverlay\(['"]create-bgm/)
  })
})

describe('弹窗互斥：内嵌主页壳态（home-shell）不得挂起', () => {
  // 根因：home-shell 实例本身就是一张 WebContentsView。主进程任一时刻只让活动标签
  // 可见（全仓 setVisible(true) 仅 layout.js 一处，且只作用于 activeView），所以它
  // 内部的应用级模态不会被别的标签视图盖住；反而一挂起会经 _hideAllTabs() 把自己藏掉
  // —— 用户表现为「点缩略图后内容区整块空白」。
  // 同族守卫已存在于 App.vue 的 setShellMode（if (isHomeShell) return），本条补齐挂起路径。
  async function loadComposable () {
    vi.resetModules()
    return (await import('@/composables/useEmbeddedViewSuspension'))
  }

  function setUrl (search) {
    // 必须给出带 pathname 的完整相对路径：replaceState 传裸 '#/x' 只替换 fragment、
    // **保留既有 query**，那样「清空」清不掉 mp-home-shell=1，守卫会被上一条用例污染。
    window.history.replaceState({}, '', `/${search}#/publish`)
  }

  let calls
  beforeEach(() => {
    calls = []
    window.electronAPI = {
      pageManager: {
        suspendEmbeddedViews: (owner) => { calls.push(['suspend', owner]); return Promise.resolve(true) },
        resumeEmbeddedViews: (owner) => { calls.push(['resume', owner]); return Promise.resolve(true) },
      },
    }
  })

  afterEach(() => {
    setUrl('')
    delete window.electronAPI
  })

  it('home-shell 壳态下 suspend 直接 no-op：不发 IPC、不占 owner 计数', async () => {
    setUrl('?mp-home-shell=1')
    const mod = await loadComposable()

    await expect(mod.suspendEmbeddedViewsForOverlay('publish-cover-preview')).resolves.toBe(false)
    expect(calls).toEqual([])
    // 释放同样 no-op，且不得因为「没挂起过」而误发恢复
    await expect(mod.releaseEmbeddedViewsForOverlay('publish-cover-preview')).resolves.toBe(false)
    expect(calls).toEqual([])
  })

  it('主窗口壳态下行为不变：仍按 owner 各发一次挂起与恢复', async () => {
    setUrl('')
    const mod = await loadComposable()

    await expect(mod.suspendEmbeddedViewsForOverlay('publish-cover-preview')).resolves.toBe(true)
    expect(calls).toEqual([['suspend', 'publish-cover-preview']])
    await expect(mod.releaseEmbeddedViewsForOverlay('publish-cover-preview')).resolves.toBe(true)
    expect(calls).toEqual([
      ['suspend', 'publish-cover-preview'],
      ['resume', 'publish-cover-preview'],
    ])
  })

  it('壳态判据按调用时刻读取，不得在模块导入期冻结', async () => {
    setUrl('')
    const mod = await loadComposable()
    await expect(mod.suspendEmbeddedViewsForOverlay('owner-a')).resolves.toBe(true)

    // 同一已导入模块下切换到 home-shell：后续挂起必须立刻停止发 IPC
    setUrl('?mp-home-shell=1')
    await expect(mod.suspendEmbeddedViewsForOverlay('owner-b')).resolves.toBe(false)
    expect(calls.filter((c) => c[1] === 'owner-b')).toEqual([])
  })

  it('home-shell 参数值必须严格为 1，其他值不得误判为壳态', async () => {
    setUrl('?mp-home-shell=0')
    const mod = await loadComposable()
    await expect(mod.suspendEmbeddedViewsForOverlay('owner-c')).resolves.toBe(true)
    expect(calls).toEqual([['suspend', 'owner-c']])
  })
})

describe('弹窗互斥：WebviewManager 行为（mock）', () => {
  async function createManagerStub () {
    const WebviewManager = (await import(path.join(ROOT, 'electron/services/webview-manager.js'))).default
    const wm = Object.create(WebviewManager.prototype)
    wm._overlaySuspensions = new Set()
    wm._shellMode = 'browser'
    wm._tabViews = new Map()
    wm._tabStates = new Map()
    wm._authTabInfo = null
    wm._activeTabId = 'home'
    wm._homeTabId = 'home'
    wm.mainWindow = null
    const calls = []
    wm._hideAllTabs = () => calls.push('hide-tabs')
    wm._repositionAll = () => calls.push('reposition')
    wm._authViewManager = { hide: () => calls.push('hide-auth'), show: () => calls.push('show-auth') }
    wm._qrCodeLogin = { hide: () => calls.push('hide-qr'), show: () => calls.push('show-qr') }
    return { wm, calls }
  }

  it('suspend：计数 0→1 才隐藏；重复挂起不重复触发；release：归零才恢复', async () => {
    const { wm, calls } = await createManagerStub()

    expect(wm.suspendEmbeddedViewsForOverlay('a')).toBe(true)
    expect(calls).toEqual(['hide-tabs', 'hide-auth', 'hide-qr'])

    // 第二个浮层（如设置弹窗未关又弹升级窗）：不重复隐藏
    calls.length = 0
    expect(wm.suspendEmbeddedViewsForOverlay('b')).toBe(true)
    expect(calls).toEqual([])

    // 未知 owner 释放无效（防计数漂移）
    calls.length = 0
    expect(wm.releaseEmbeddedViewsForOverlay('unknown')).toBe(false)
    expect(calls).toEqual([])
    expect(wm.isEmbeddedViewsSuspended()).toBe(true)

    // 释放 'a' 后仍剩 'b'：未真正恢复（返回 false），但 owner 已从挂起集合移除
    expect(wm.releaseEmbeddedViewsForOverlay('a')).toBe(false)
    expect(wm.isEmbeddedViewsSuspended()).toBe(true)
    expect(calls).toEqual([])
    // 已移除的 owner 再释放：未知 owner，无效
    expect(wm.releaseEmbeddedViewsForOverlay('a')).toBe(false)

    calls.length = 0
    expect(wm.releaseEmbeddedViewsForOverlay('b')).toBe(true)
    expect(wm.isEmbeddedViewsSuspended()).toBe(false)
    expect(calls).toEqual(['reposition'])
  })

  it('workbench 壳态下释放不触发恢复（由 setShellMode 驱动）；重复释放不重复恢复', async () => {
    const { wm, calls } = await createManagerStub()
    wm._shellMode = 'workbench'
    wm.suspendEmbeddedViewsForOverlay('a')
    wm.releaseEmbeddedViewsForOverlay('a')
    expect(wm.isEmbeddedViewsSuspended()).toBe(false)
    expect(calls).toEqual(['hide-tabs', 'hide-auth', 'hide-qr']) // 无 reposition

    // 已归零后再释放：no-op
    calls.length = 0
    expect(wm.releaseEmbeddedViewsForOverlay('a')).toBe(false)
    expect(calls).toEqual([])
  })

  it('非法 owner（非字符串/空串）拒绝挂起', async () => {
    const { wm } = await createManagerStub()
    expect(wm.suspendEmbeddedViewsForOverlay('')).toBe(false)
    expect(wm.suspendEmbeddedViewsForOverlay(null)).toBe(false)
    expect(wm.isEmbeddedViewsSuspended()).toBe(false)
  })
})

describe('浮层 owner 接入登记：podcast-episode-publish-overlay（刀 3 第 4 片）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'components/PodcastPublishAction.vue'), 'utf8')

  it('owner 常量成对传给挂起与释放两侧', () => {
    expect(src).toContain('suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    expect(src).toContain('releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)')
    expect(src).toContain("const OVERLAY_OWNER = 'podcast-episode-publish-overlay'")
  })

  it('释放穷尽：watch(props.visible) 的 false 分支 + onBeforeUnmount 兜底', () => {
    // 判据必须只看代码：本文件所在组件的**块注释里就有 `watch(visible)` 与 `onBeforeUnmount` 的散文**，
    // 不剥注释会让「注释写了解放、代码没写」的假绿通过（同仓「结构锁不剥注释 = 幽灵通道」坑）。
    // 剥法刻意不用正则——反斜杠在本仓的脚本化补丁里已被吃掉过两次，这里按行首两字符判 `//`。
    const code = src.split(String.fromCharCode(10)).map((l) => (l.trimStart().slice(0, 2) === String.fromCharCode(47, 47) ? '' : l)).join(String.fromCharCode(10))
    const EOL = String.fromCharCode(10)
    const w = code.indexOf('watch(() => props.visible')
    expect(w).toBeGreaterThan(-1)
    const els = code.indexOf('} else {', w)
    expect(els).toBeGreaterThan(w)
    const elseEnd = code.indexOf(EOL + '  }', els)
    expect(elseEnd).toBeGreaterThan(els)
    expect(code.slice(els, elseEnd)).toContain('releaseOverlay()')
    const un = code.indexOf('onBeforeUnmount(')
    expect(un).toBeGreaterThan(els)
    const unEnd = code.indexOf(EOL + '})', un)
    expect(unEnd).toBeGreaterThan(un)
    expect(code.slice(un, unEnd)).toContain('releaseOverlay()')
  })

  it('浮层按需挂载且关闭不销毁（openedOnce 而非 visible）', () => {
    const entry = fs.readFileSync(path.resolve(__dirname, 'components/PodcastEpisodeEntry.vue'), 'utf8')
    expect(entry).toContain('v-if="openedOnce"')
    expect(entry).not.toContain('v-if="visible"')
  })
})
