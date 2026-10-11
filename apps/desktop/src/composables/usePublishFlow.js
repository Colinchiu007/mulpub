// @ts-check
/**
 * usePublishFlow.js — 单篇发布流程 composable（从 Publish.vue 拆分）
 *
 * 职责：
 *   - 维护 publishing / progress / result / copied 状态
 *   - handlePublish：标题/正文校验 → 敏感词预检 → 离线检测 → publishBatch → 进度回调
 *   - addProgress：进度条目追加
 *   - copyUrl：剪贴板复制（含 fallback）
 *
 * 依赖（参数传入，避免循环引用）：
 *   - article: reactive 对象 { title, content, author, cover_url, video_path }
 *   - selectedPlatforms: ref<string[]>
 *   - selectedAccounts: ref<{[platformId]: accountId}>
 *   - precheckEnabled: ref<boolean>
 */
import { computed, ref, watch } from 'vue'
import i18n from '@/i18n'
import { formatUserError } from '@/utils/user-facing-error'
import { useLoginGate } from './useLoginGate'
import { useNotify } from './useNotify'
import { resolveNotifyText } from '@/utils/notifyCore'
import {
  publishBatch,
  sensitiveCheck,
  offlineStatus,
  offlineAddToCache,
  schedulerCreate,
  schedulerCancel,
  cancelTask,
  storeGetSetting,
  storeSetSetting,
  generateAiCover,
} from '@/api/publisher'
import {
  applyPlatformContentConversion,
  APP_ARTICLE_CONTENT_MAX,
  buildPublishTargets,
  getPlatformLabel,
  normalizePublishFile,
  normalizePublishFiles,
  normalizePublishMentions,
  normalizePublishStringList,
  minContentBudget,
  truncateByChars,
  truncateByUtf8Bytes,
  validatePlatformContent,
  validatePublishMetadata,
  validatePublishTargets,
  validateScheduleEntries,
} from '@/features/publish/publish-contract'
import { isMarkdownContent, normalizePlatformOverrides } from '@/features/publish/publish-overrides'
import { resolveCoverFields } from '@/features/publish/publish-upload-file'
import { attachRewriteLineage } from '@/utils/rewrite-lineage'
import { usePublishProgressStore } from '@/stores/publishProgress'

// 图文必填图片的平台（2026-09-29 实测取证：小红书/快手/抖音图文上传区要求至少 1 张图；
// 无图时 handlePublish 自动生成封面兜底——AI 生图优先，cover:generate-ai 内建本地标题卡回退）
// 2026-09-30 追加 toutiao：头条图文（=文章）的发布设置页「展示封面」是**必填项**（标签带 *），
// 且页面**默认选中「单图」**并强制要求提供封面图（实测：只把 radio 改到「无封面」会被 React
// 受控状态重置回「单图」，截图复核封面区始终为空）⇒ 不生成封面则发布被静默拦下
// （症状：publish verification timeout，日志无 uploadCover entry 行即表示 coverPath 为 null）。
const IMAGE_TEXT_PLATFORMS = ['xiaohongshu', 'kuaishou', 'douyin', 'toutiao']

// 2026-10-12 公众号补齐：**封面是公众号必填项**（`01-docs/platform-publish-options-audit/REPORT.md`：
// 「封面图｜公众号必填」），而 RPA 链此前既没上传封面、自动封面兜底也没把它写进 `cover_path`
// （只写 `images`）⇒ 同一条文案发快手有正文有封面、发公众号草稿箱只有标题。
// 自动封面集合 = 图文要求图片的平台 ∪ 封面必填的平台；**单一真源**，禁止在别处再列一份。
const AUTO_COVER_PLATFORMS = [...IMAGE_TEXT_PLATFORMS, 'wechat_mp']

function nowTimeString() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 单篇发布流程 composable
 * @param {object} options
 * @param {object} options.article
 * @param {object} options.selectedPlatforms
 * @param {object} options.selectedAccounts
 * @param {object} options.precheckEnabled
 * @returns {object} 响应式状态 + 方法
 */
export function usePublishFlow(options) {
  const article = options.article
  const selectedPlatforms = options.selectedPlatforms
  const selectedAccounts = options.selectedAccounts
  const precheckEnabled = options.precheckEnabled
  const diffEdits = options.diffEdits || null
  const isAccountAvailable = typeof options.isAccountAvailable === 'function'
    ? options.isAccountAvailable
    : null
  const activeMode = options.activeMode || null
  // 主动操作登录门：发布前未登录 → 弹登录引导，登录成功后继续
  const { ensureLogin } = useLoginGate()
  // 统一通知通道（D1 决策）：toast/确认框走 useNotify，进度条文案走 resolveNotifyText
  const { notify, notifyError, notifySuccess, notifyWarning, notifyInfo, notifyConfirm } = useNotify()

  // 进度条文案解析（非 toast，组件内展示；M6 路径：文案统一进 locales）
  function progressText (messageKey, params, fallback) {
    const { text, resolved } = resolveNotifyText(messageKey, params)
    return resolved ? text : (fallback || '')
  }

  const publishing = ref(false)
  const progress = ref([])
  const result = ref(null)
  const copied = ref(false)
  const activeTaskIds = ref([])
  const activeScheduleIds = ref([])
  let precheckInitialized = false
  let loadingPrecheckPreference = false

  // publish-progress-ux：进度状态由全局 store 承载（App 级订阅，不随本组件卸载死亡）。
  // 本 composable 只做两件事：IPC 返回后登记会话；watch 会话终态驱动页面结果卡。
  const publishProgressStore = usePublishProgressStore()

  /** 当前发布动作对应的 store 会话（按 activeTaskIds 归属） */
  const activeSession = computed(() => {
    const ids = activeTaskIds.value
    if (!ids || ids.length === 0) return null
    return publishProgressStore.sessions.find(
      (s) => ids.some((id) => Object.prototype.hasOwnProperty.call(s.tasks, id)),
    ) || null
  })

  // 会话终态 → 页面结果卡 + 时间线汇总条目（修复「用户不知道发布是否成功」的页面呈现）
  watch(() => activeSession.value && activeSession.value.status, (status) => {
    if (!status || status !== 'done') return
    const session = activeSession.value
    const tasks = Object.values(session.tasks)
    const succeeded = tasks.filter((t) => t.phase === 'success').length
    const failed = tasks.filter((t) => t.phase === 'failed').length
    const firstUrl = tasks.find((t) => t.phase === 'success' && t.result && typeof t.result.url === 'string' && t.result.url)
    if (failed === 0) {
      result.value = {
        success: true,
        message: progressText('publishPage.publishFlow.resultAllSuccess', { count: succeeded }),
        url: (firstUrl && firstUrl.result.url) || '',
      }
      addProgress(result.value.message, 'success')
    } else {
      result.value = {
        success: false,
        message: progressText('publishPage.publishFlow.resultPartial', { succeeded, failed }),
        url: '',
      }
      addProgress(result.value.message, 'danger')
    }
  })

  watch(precheckEnabled, value => {
    if (!precheckInitialized || loadingPrecheckPreference) return
    Promise.resolve(storeSetSetting('precheckEnabled', Boolean(value))).catch(() => {})
  }, { flush: 'sync' })

  async function loadPrecheckPreference() {
    loadingPrecheckPreference = true
    try {
      const value = await storeGetSetting('precheckEnabled')
      precheckEnabled.value = value === true || value === 'true'
    } catch (_) {
      precheckEnabled.value = false
    } finally {
      loadingPrecheckPreference = false
      precheckInitialized = true
    }
  }

  function addProgress(text, type) {
    const t = type === undefined ? 'primary' : type
    progress.value.push({ text: text, time: nowTimeString(), type: t })
  }

  function copyUrl(url) {
    return Promise.resolve()
      .then(function () {
        return navigator.clipboard.writeText(url)
      })
      .then(function () {
        copied.value = true
        setTimeout(function () { copied.value = false }, 2000)
      })
      .catch(function () {
        // fallback for older browsers
        const ta = document.createElement('textarea')
        ta.value = url
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        copied.value = true
        setTimeout(function () { copied.value = false }, 2000)
      })
  }

  async function notifyFailure (title, body) {
    // 统一通知通道：错误级 toast + notify:log 上报（替代 showNotification 死通道）
    notifyError('publishPage.publishFlow.publishFailed', { message: body, module: 'publishFlow' })
  }

  function getTargets () {
    return buildPublishTargets(selectedPlatforms.value, selectedAccounts.value)
  }

  function buildArticleData () {
    const md = isMarkdownContent(article.content)
    const imageFiles = normalizePublishFiles([
      ...normalizePublishFiles(article.image_files),
      ...normalizePublishFiles(article.images),
    ])
    const cover = resolveCoverFields(article)
    const tags = normalizePublishStringList(article.tags)
    const topics = normalizePublishStringList(article.topics)
    const mentions = normalizePublishMentions(article.mentions)
    const data = {
      title: article.title,
      content: article.content,
      contentFormat: md ? 'markdown' : 'html',
      author: article.author || '',
      cover_url: cover.cover_url,
      video_path: article.video_path || '',
      precheck: precheckEnabled.value,
      platformOverrides: normalizePlatformOverrides(diffEdits),
    }
    // AI 生成内容声明：默认勾选（AI 生成内容），仅显式 false 时取消勾选。
    // 各平台发布时须如实声明内容创作方式，AI 生成内容不勾选会违规。
    data.aiGenerated = article.aiGenerated !== false
    // P1-5 语义级可见性：通用区档位随 article 流入 payload，由主进程 resolver
    // 按注册表 semanticValues 映射到各平台字段值（平台 override 仍优先）。
    if (article.visibilitySemantic) data.visibilitySemantic = article.visibilitySemantic
    // 归因链（PRD-PUBLISH-REWRITE-LINEAGE-2026-10-05）：本正文来自哪一次改写。
    // 只在真有关联时挂键 —— 无条件挂 null/空串会让下游无法区分「没关联」与「关联被抹」，
    // 而主进程侧（phase4-events 读 task.article?.rewriteHistoryId）从写下起就在等这个键。
    // 挂载规则与批量侧同一条（utils/rewrite-lineage.attachRewriteLineage）。
    attachRewriteLineage(data, article.rewriteHistoryId)
    if (imageFiles.length > 0) {
      data.images = imageFiles.map(file => file.path)
      data.image_files = imageFiles
    }
    if (cover.cover_path) data.cover_path = cover.cover_path
    if (cover.cover_file) data.cover_file = cover.cover_file
    if (tags.length > 0) data.tags = tags
    if (topics.length > 0) data.topics = topics
    if (mentions.length > 0) data.mentions = mentions
    return data
  }

  async function scheduleTargets (targets, data) {
    const scheduleIds = []
    activeScheduleIds.value = []
    try {
      for (const target of targets) {
        const res = await schedulerCreate(toPlainJson({
          platform: target.platform,
          publishTime: article.publishTime,
          article: { ...data, accountId: target.accountId },
        }))
        if (!res || res.code !== 0) {
          throw new Error(formatUserError(res, { fallback: progressText('publishPage.publishFlow.scheduleCreateFailed') }).message)
        }
        const scheduleId = res.data && res.data.id
        if (!scheduleId) throw new Error(progressText('publishPage.publishFlow.scheduleCreateNoId'))
        scheduleIds.push(scheduleId)
        activeScheduleIds.value = scheduleIds.slice()
      }
      return scheduleIds
    } catch (error) {
      const rollbackResults = await Promise.allSettled(
        scheduleIds.map(scheduleId => schedulerCancel(scheduleId)),
      )
      const rollbackFailedIds = scheduleIds.filter((scheduleId, index) => {
        const rollback = rollbackResults[index]
        return rollback.status === 'rejected' || !rollback.value || rollback.value.code !== 0 || rollback.value.data === false
      })
      activeScheduleIds.value = rollbackFailedIds
      if (rollbackFailedIds.length > 0) {
        const message = formatUserError(error, { fallback: progressText('publishPage.publishFlow.scheduleCreateFailed') }).message
        throw new Error(message + '；' + progressText('publishPage.publishFlow.scheduleRollbackFailed', { count: rollbackFailedIds.length }))
      }
      throw error
    }
  }

  async function handlePublish() {
    if (publishing.value) return
    // M-1 重入锁修复：锁必须前置到第一个 await 之前。
    // 原实现把 `publishing = true` 放在全部同步校验之后（:414），而 :285 的
    // `await ensureLogin()` 会弹确认框 + 走 OAuth（可达秒级到分钟级）——
    // 窗口内二次点击两次都通过 :283 守卫，产生两次真实 publishBatch。
    // 同时 `try` 起点必须上移到置锁处：否则 :286-412 之间的 return 会绕过
    // 末尾的 finally，把锁永久留在 true（按钮永久禁用）。
    publishing.value = true
    try {
      // 主动操作登录门：未登录弹登录窗口，登录成功后继续发布
      if (!(await ensureLogin())) return
      if (!article.title.trim()) {
        notifyWarning('publishPage.titleRequired', { message: i18n.global.t('publishPage.titleRequired') })
        return
      }
    const isVideoMode = activeMode && activeMode.value === 'video'
    if (isVideoMode && !article.video_path) {
      notifyWarning('publishPage.publishFlow.videoFileRequired', { message: progressText('publishPage.publishFlow.videoFileRequired') })
      return
    }
    if (!isVideoMode && !article.content.trim()) {
      notifyWarning('publishPage.publishFlow.contentRequired', { message: progressText('publishPage.publishFlow.contentRequired') })
      return
    }
    if (!Array.isArray(selectedPlatforms.value) || selectedPlatforms.value.length === 0) {
      notifyWarning('publishPage.publishFlow.platformRequired', { message: progressText('publishPage.publishFlow.platformRequired') })
      return
    }

    const targets = getTargets()
    if (
      isAccountAvailable &&
      targets.some(target => target.accountId && !isAccountAvailable(target.platform, target.accountId))
    ) {
      notifyWarning('publishPage.publishFlow.accountInvalid', { message: progressText('publishPage.publishFlow.accountInvalid') })
      return
    }
    const targetCheck = validatePublishTargets(targets)
    if (!targetCheck.valid) {
      notifyWarning('publishPage.publishFlow.targetInvalid', { message: targetCheck.message })
      return
    }
    const metadataCheck = validatePublishMetadata(article)
    if (!metadataCheck.valid) {
      notifyWarning('publishPage.publishFlow.metadataInvalid', { message: metadataCheck.message })
      return
    }
    // 应用级正文上限（PRD-PLATFORM-CHAR-LIMITS-2026-10-02 §F1）：
    // 超出 10000 字先截断并提示，再进入平台级校验/转换，两级截断各自出声。
    // 提示缓冲：handlePublish 在通过全部校验后会重置 progress（publishing 锁开启时），
    // 截断发生在校验阶段 → 直接 addProgress 会被清空（旧 contentAutoTruncated 同病）。
    // 故先收集，待 progress 重置后统一发出。
    const truncationNotices = []
    const appContentBefore = Array.from(String(article.content || '')).length
    if (appContentBefore > APP_ARTICLE_CONTENT_MAX) {
      article.content = truncateByChars(article.content, APP_ARTICLE_CONTENT_MAX)
      truncationNotices.push({
        key: 'publishPage.publishFlow.articleContentTruncated',
        params: { before: appContentBefore, after: APP_ARTICLE_CONTENT_MAX },
      })
    }

    // 按平台的提交文本转换（PRD §F3）：超限平台写差异化覆盖（diffEdits 就地更新，
    // buildArticleData 经 normalizePlatformOverrides 原样进 payload），未超限平台
    // 保持全文 —— 取代旧「最小预算全局一刀切」（公众号等大限平台不再被误伤）。
    // 无差异化覆盖通道的旧调用方（diffEdits 为空）：退化回最小预算全局截断，
    // 保证转换结果仍能进 payload（写入临时对象会被丢弃，导致校验仍失败）。
    if (diffEdits) {
      const conversion = applyPlatformContentConversion({
        platforms: selectedPlatforms.value,
        article,
        platformOverrides: diffEdits,
      })
      for (const truncation of conversion.truncations) {
        truncationNotices.push({
          key: 'publishPage.publishFlow.platformContentTruncated',
          params: {
            platform: truncation.label,
            limit: truncation.limit,
            before: truncation.before,
            after: truncation.after,
          },
        })
      }
    } else {
      const budget = minContentBudget(selectedPlatforms.value, article.title)
      const before = Array.from(String(article.content || '')).length
      if (budget !== null && before > budget) {
        article.content = truncateByChars(article.content, budget)
        truncationNotices.push({
          key: 'publishPage.publishFlow.contentAutoTruncated',
          params: { platform: '', limit: budget, before, after: Array.from(String(article.content || '')).length },
        })
      }
    }

    const contentCheck = validatePlatformContent({
      platforms: selectedPlatforms.value,
      article,
      platformOverrides: diffEdits || {},
    })
    if (!contentCheck.valid) {
      // 一键发布/历史视频预填场景：百家号标题按 UTF-8 字节数校验（上限 149 字节），
      // 预填文案可能超长。若仅因百家号标题超长失败，自动按字节截断标题后继续，
      // 避免阻断自动一站式流程；其他平台/字段超长仍提示并阻断，让用户手动调整。
      // 2026-10-02 演进：正文超长已由上方 applyPlatformContentConversion 按**各平台
      // 自己的上限**生成差异化覆盖（取代 2026-10-01 的最小预算全局截断），此处只剩
      // 百家号标题的自动截断路径；正文仍失败（理论上罕见）则阻断并给出明确原因。
      const autoTruncatable = contentCheck.platform === 'baijiahao' && contentCheck.field === 'title'
      if (autoTruncatable && Number.isFinite(contentCheck.limit) && contentCheck.limit > 0) {
        // 截断来源：若差异化面板为 baijiahao 单独设置了覆盖标题，则截断覆盖标题；
        // 否则截断全局标题。校验用 override.title || article.title，若只改 article.title
        // 则 override 路径截断失效，buildArticleData 仍会发送超长覆盖标题。
        const baijiahaoOverride = diffEdits && diffEdits.baijiahao && typeof diffEdits.baijiahao.title === 'string'
          ? diffEdits.baijiahao
          : null
        if (baijiahaoOverride) {
          baijiahaoOverride.title = truncateByUtf8Bytes(baijiahaoOverride.title, contentCheck.limit)
        } else {
          article.title = truncateByUtf8Bytes(article.title, contentCheck.limit)
        }
        addProgress(progressText('publishPage.publishFlow.baijiahaoTitleTruncated'), 'warning')
        // 截断标题后重新校验剩余平台：可能仍超过
        // xiaohongshu(20字)/toutiao(30字) 等更严格平台的上限，需重新校验并阻断。
        const recheck = validatePlatformContent({
          platforms: selectedPlatforms.value,
          article,
          platformOverrides: diffEdits || {},
        })
        if (!recheck.valid) {
          notifyWarning('publishPage.publishFlow.contentInvalid', { message: recheck.message })
          return
        }
      } else {
        notifyWarning('publishPage.publishFlow.contentInvalid', { message: contentCheck.message })
        return
      }
    }

    // M-1：锁已在前置处置锁，此处不再重复赋值
    progress.value = []
    // 发出校验阶段缓冲的截断提示（在 progress 重置后，避免被清空）
    for (const notice of truncationNotices) {
      addProgress(progressText(notice.key, notice.params), 'warning')
    }
    result.value = null
    activeTaskIds.value = []
    activeScheduleIds.value = []

      // 敏感词预检
      if (sensitiveCheck) {
      const titleResult = await sensitiveCheck(article.title)
      const contentResult = await sensitiveCheck(article.content)
      const allWords = [].concat(
        (titleResult.data && titleResult.data.words) || [],
        (contentResult.data && contentResult.data.words) || []
      )
        if (allWords.length > 0) {
          const confirmed = await notifyConfirm('publishPage.publishFlow.sensitiveMessage', {
            params: { words: allWords.join('、') },
            title: progressText('publishPage.publishFlow.sensitiveTitle'),
            confirmButtonText: progressText('publishPage.publishFlow.sensitiveForcePublish'),
            cancelButtonText: progressText('publishPage.publishFlow.sensitiveModify'),
            type: 'warning',
          })
          if (!confirmed) return
        }
      }

      // 2026-09-29 图文发布兜底 + 2026-10-12 公众号补齐：图文发布缺图/缺封面时自动生成封面
      // （AI 生图优先，本地标题卡兜底——cover:generate-ai 已内建回退）。生成失败不阻断发布
      // （无图平台照常发，图片平台会在引擎层如实报错）；成功则附加进表单（用户可见，透明）。
      //
      // 触发条件必须**完备**——四项同时成立才生成：
      //   ① 非视频发布；② 选中平台命中 AUTO_COVER_PLATFORMS；
      //   ③ 无图片（image_files / images 都空）；
      //   ④ **无任何封面**（cover_path / cover_file / cover_url 都空）。
      // ④ 是本次补的：此前漏了它，导致「用户已选封面但没选图片」时仍会多生成一张，
      // 既浪费一次生图调用，又让「用户选的封面」与「系统生成的封面」在同一次发布里并存。
      const isTextImagePublish = !isVideoMode && selectedPlatforms.value.some(p => AUTO_COVER_PLATFORMS.includes(p))
      const hasImages = (Array.isArray(article.image_files) && article.image_files.length > 0)
        || (Array.isArray(article.images) && article.images.length > 0)
      const hasCover = Boolean(
        String(article.cover_path || '').trim()
        || article.cover_file
        || String(article.cover_url || '').trim(),
      )
      if (isTextImagePublish && article.title.trim()) {
        if (hasCover) {
          if (!hasImages) addProgress(progressText('publishPage.publishFlow.coverAlreadySet'), 'info')
        } else if (!hasImages) {
          try {
            addProgress(progressText('publishPage.publishFlow.generatingCover'), 'info')
            const coverRes = await generateAiCover({ prompt: article.title, ratio: '3:4' })
            if (coverRes && coverRes.code === 0 && coverRes.data && coverRes.data.coverPath) {
              const coverFile = normalizePublishFile({ path: coverRes.data.coverPath })
              if (coverFile) {
                // 双通道落值（2026-10-12）：图片通道给「要求至少一张图」的平台（小红书/快手/抖音/头条），
                // 封面通道给「封面必填」的平台（公众号）。只落一侧就会出现「快手有封面、公众号没有」。
                article.image_files = [coverFile]
                article.images = [coverFile.path]
                article.cover_file = coverFile
                article.cover_path = coverFile.path
                addProgress(progressText('publishPage.publishFlow.coverGenerated'), 'success')
              }
            } else {
              // 生成失败不阻断：无图平台照常发布，但必须出声（此前是静默 catch，用户看不到原因）
              addProgress(progressText('publishPage.publishFlow.coverGeneratedFailed'), 'warning')
            }
          } catch (_) {
            addProgress(progressText('publishPage.publishFlow.coverGeneratedFailed'), 'warning')
          }
        }
      }

      const data = buildArticleData()
      if (article.publishTime) {
        const scheduleCheck = validateScheduleEntries(
          targets.map(target => ({ ...target, publishTime: article.publishTime })),
          // 注入 i18n：校验提示走 locales（en 用户不再看到中文硬编码字面量）
          // 注入 platformLabel：提示里显示「百家号」而非内部 id「baijiahao」
          // （2026-10-07 真机 E2E，PR #3033）
          {
            translate: (key, params) => progressText(`publishPage.scheduleValidation.${key}`, params),
            platformLabel: (id) => getPlatformLabel(id),
          },
        )
        if (!scheduleCheck.valid) {
          addProgress(progressText('publishPage.publishFlow.scheduleInvalidProgress', { message: scheduleCheck.message }), 'danger')
          result.value = { success: false, message: scheduleCheck.message }
          // 2026-10-07 真机 E2E（PR #3033）：此前这里只写进度面板（页面底部），
          // 点「一键发布」后**当场没有任何反馈**，用户要滚动到页面最下方才知道被拦，
          // 与「无标题」「缺正文」等兄弟分支的行为不一致。统一补 toast。
          notifyWarning('publishPage.publishFlow.scheduleInvalidToast', { message: scheduleCheck.message })
          return
        }
      }

      // 离线检测
      //
      // 平台侧定时（2026-10-07）的重要边界：**平台侧定时不需要联网**。
      // 创建定时任务只是「把排期提交给平台」，而定时分支走的是主进程 scheduler
      // （本地 JSONL + Node 直连 HTTP），主进程并不依赖 renderer 的网络在线态。
      // 因此带 publishTime 时**不走离线缓存** —— 旧实现把定时任务落进离线缓存
      // （缓存形状只有 {targets,data}、不含 publishTime），网络恢复后会**立即发布**，
      // 用户以为排了期、实际已发出，正是本变更要消灭的形态。
      if (!article.publishTime) {
        const offlineRes = await offlineStatus()
        if (offlineRes && offlineRes.code === 0 && offlineRes.data && offlineRes.data.offline) {
          const cacheRes = await offlineAddToCache(toPlainJson({ targets, data }))
          if (!cacheRes || cacheRes.code !== 0 || cacheRes.data === false) {
            throw new Error((cacheRes && cacheRes.message) || progressText('publishPage.publishFlow.offlineCacheFailed'))
          }
          addProgress(progressText('publishPage.publishFlow.offlineProgress'), 'warning')
          notifyWarning('publishPage.publishFlow.offlineCached', { message: progressText('publishPage.publishFlow.offlineCached') })
          return
        }
      }

      if (article.publishTime) {
        const scheduleIds = await scheduleTargets(targets, data)
        addProgress(progressText('publishPage.publishFlow.scheduleCreated', { count: scheduleIds.length }), 'success')
        result.value = { success: true, message: progressText('publishPage.publishFlow.scheduleCreatedResult'), scheduled: true }
        return
      }

      // publish-progress-ux：本地进度监听已删除（原 finally 无条件 off() 使监听器在
      // IPC 毫秒级返回后即死亡——任务执行期间全部事件无人接收，用户不知道发布是否成功）。
      // 进度事件由全局 store 的 App 级订阅接收；此处只登记会话。
      addProgress(progressText('publishPage.publishFlow.publishTargets', { count: targets.length }), 'info')
      const payload = toPlainJson({ targets, data })
      const res = await publishBatch(payload.targets, payload.data)
      if (res.code === 0) {
        activeTaskIds.value = Array.isArray(res.data && res.data.taskIds)
          ? res.data.taskIds.slice()
          : []
        const count = activeTaskIds.value.length
        addProgress(progressText('publishPage.publishFlow.taskAdded', { count }), 'success')
        result.value = { success: true, message: res.message || progressText('publishPage.publishFlow.taskQueued'), url: '' }
        // 登记进全局进度 store：全局面板自动展开、跨路由持续跟踪、终态驱动上方 watch
        publishProgressStore.registerSession({
          taskIds: activeTaskIds.value,
          title: (data && data.title) || article.title || '',
        })
      } else {
        const message = formatUserError(res, { fallback: progressText('publishPage.publishFlow.publishFailedTitle') }).message
        addProgress(progressText('publishPage.publishFlow.publishFailedProgress', { message }), 'danger')
        result.value = { success: false, message }
        await notifyFailure(progressText('publishPage.publishFlow.publishFailedTitle'), message)
      }
    } catch (e) {
      const message = formatUserError(e, { fallback: progressText('publishPage.publishFlow.publishErrorTitle') }).message
      addProgress(progressText('publishPage.publishFlow.publishErrorProgress', { message }), 'danger')
      result.value = { success: false, message }
      await notifyFailure(progressText('publishPage.publishFlow.publishErrorTitle'), message)
    } finally {
      publishing.value = false
    }
  }

  // 2026-10-02 定时发布验证修复：删除 aa7e7cf0（2026-08-23）替换式重构残留的旧版
  // cancelPublish（Promise.all 版）。JS 函数声明后者覆盖前者，旧版一直是死代码，
  // fdd30498（2026-08-30）的通知迁移甚至误改在死副本上。保留下方 allSettled 版
  // （失败任务保留 ID 供重试），结构锁见 usePublishFlow.test.js「单一定义结构锁」。
  async function cancelPublish () {
    const taskIds = activeTaskIds.value.slice()
    const scheduleIds = activeScheduleIds.value.slice()
    if (taskIds.length === 0 && scheduleIds.length === 0) {
      notifyInfo('publishPage.noActiveTasks', { message: i18n.global.t('publishPage.noActiveTasks') })
      return { success: false, cancelled: 0, pending: 0 }
    }
    const results = await Promise.allSettled([
      ...taskIds.map(id => Promise.resolve().then(() => cancelTask(id))),
      ...scheduleIds.map(id => Promise.resolve().then(() => schedulerCancel(id))),
    ])
    const cancelledTaskIds = taskIds.filter((_, index) => isCancelSettled(results[index]))
    const cancelledScheduleIds = scheduleIds.filter((_, index) => {
      return isCancelSettled(results[taskIds.length + index])
    })
    const cancelled = cancelledTaskIds.length + cancelledScheduleIds.length
    activeTaskIds.value = taskIds.filter(id => !cancelledTaskIds.includes(id))
    activeScheduleIds.value = scheduleIds.filter(id => !cancelledScheduleIds.includes(id))
    const pendingCount = activeTaskIds.value.length + activeScheduleIds.value.length
    const message = buildCancelMessage(cancelled, pendingCount)
    const detail = pendingCount > 0
      ? message + i18n.global.t('publishPage.cancelledRetryHint')
      : message
    addProgress(detail, pendingCount > 0 ? 'danger' : 'warning')
    result.value = { success: false, cancelled, message }
    return {
      success: cancelled > 0 && pendingCount === 0,
      cancelled,
      pending: pendingCount,
    }
  }

  function isCancelSettled (settled) {
    return settled.status === 'fulfilled' &&
      settled.value &&
      settled.value.code === 0 &&
      settled.value.data !== false
  }

  function buildCancelMessage (cancelled, pending) {
    if (cancelled > 0 && pending > 0) {
      return i18n.global.t('publishPage.cancelPartial', { count: cancelled, failed: pending })
    }
    if (pending > 0) return i18n.global.t('publishPage.cancelFailed')
    return i18n.global.t('publishPage.cancelledCount', { count: cancelled })
  }


  async function retryPublish () {
    if (!result.value || result.value.success) {
      notifyInfo('publishPage.noFailedPublish', { message: i18n.global.t('publishPage.noFailedPublish') })
      return
    }
    return handlePublish()
  }

  return {
    publishing,
    progress,
    result,
    copied,
    activeTaskIds,
    activeScheduleIds,
    handlePublish,
    cancelPublish,
    retryPublish,
    loadPrecheckPreference,
    addProgress,
    copyUrl,
  }
}
