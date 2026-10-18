<template>
  <div v-if="visible" class="podcast-script-entry" role="dialog" aria-modal="true" data-testid="podcast-script-entry">
    <div class="podcast-script-entry__backdrop" @click="onCancel"></div>
    <section class="podcast-script-entry__panel">
      <h2 class="podcast-script-entry__title">{{ t('podcast.episode.entry') }}</h2>
      <p class="podcast-script-entry__notice">{{ t('podcast.episode.billingNotice') }}</p>

      <!-- 三个显示项只读自 podcast:episode:planPreview；本层不算任何一个数。
           缺失就整块不显示——回落 0 会被读成「不用调用服务商」，而真因是预览没给数。 -->
      <ul v-if="plan" class="podcast-script-entry__plan" data-testid="podcast-script-plan">
        <li v-if="plan.totalBlocks">{{ t('podcast.episode.planBlocks', { n: plan.totalBlocks }) }}</li>
        <li v-if="plan.totalCodepoints">{{ t('podcast.episode.planCodepoints', { n: plan.totalCodepoints }) }}</li>
      </ul>
      <p v-if="voice" class="podcast-script-entry__voice" data-testid="podcast-script-voice">
        {{ t('podcast.episode.planVoice', { provider: voice.providerId, model: voice.model, voice: voice.voiceId }) }}
        <span v-if="originLabel" class="podcast-script-entry__origin" data-testid="podcast-script-voice-origin">{{ originLabel }}</span>
      </p>

      <!-- 预览被拒 = 「这一期现在还发不了」：显示原因句；按钮仍可用（判据 3 + 4） -->
      <p v-if="previewReason" class="podcast-script-entry__reason" data-testid="podcast-script-reason">{{ previewReason }}</p>

      <div class="podcast-script-entry__actions">
        <button type="button" class="podcast-script-entry__cancel" data-testid="podcast-script-cancel" @click="onCancel">{{ t('podcast.episode.cancel') }}</button>
        <button type="button" class="podcast-script-entry__confirm" data-testid="podcast-script-confirm" :disabled="publishing" @click="onConfirm">{{ t('podcast.episode.entry') }}</button>
      </div>

      <p v-if="phase" class="podcast-script-entry__phase" data-testid="podcast-script-phase">{{ phaseText }}</p>
      <p v-if="message" class="podcast-script-entry__result" data-testid="podcast-script-result">{{ message }}</p>
    </section>
  </div>
</template>

<script setup>
/**
 * 文本出期的计费二次确认浮层（tasks 4.3②-b，PRD §7.10.3 / §7.10.3.1 / §7.10.4.1）
 *
 * 与 PodcastEpisodeEntry.vue（成片链的入口+浮层成对装配）**刻意分开**：那条链的入参是
 * project/segments/videoPath，这条是正文本身，两者在「抽取那一站」之后才汇流。把两种模式
 * 塞进同一个组件会让 props 出现一半永远为空的字段——那是 §7.10.3.1 明确禁止的形状。
 *
 * 本组件不算任何一个显示值：分块与音色解析的唯一实现都在主进程，前端再抄一份就是第二套口径。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { episodePlanPreview, episodePublishFromScript, onEpisodePublishProgress } from '@/api/podcast-channel'
import { releaseEmbeddedViewsForOverlay, suspendEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'

const OVERLAY_OWNER = 'podcast-script-entry-overlay'
const ORIGIN_KEYS = {
  channel: 'podcast.episode.originChannel',
  preference: 'podcast.episode.originPreference',
  providerDefault: 'podcast.episode.originProviderDefault',
}
// §8.2.9 判据 2：三档里**只有 ②③ 需要标注**。`channel` 是用户自己填进频道的东西，
// 再告诉他一遍来源只会让他以为那是一层回退结果；所以这张表是「要不要出声」的白名单，
// 不是「有哪些档」的清单——判据 1 的闭集仍是上面那三把键，别把这里当闭集用。
const ANNOTATED_ORIGINS = ['preference', 'providerDefault']

const props = defineProps({
  visible: { type: Boolean, default: false },
  channelId: { type: String, default: '' },
  script: { type: String, default: '' },
  title: { type: String, default: '' },
})
const emit = defineEmits(['update:visible', 'published'])
const { t } = useI18n()

const plan = ref(null)
const voice = ref(null)
const previewReason = ref('')
const phase = ref('')
const message = ref('')
const publishing = ref(false)
let unsubscribe = null
let suspended = false

const originLabel = computed(() => {
  const origin = voice.value && voice.value.origin
  if (!origin) return ''
  // 判据 1：闭集外的值**不兜底成"取自频道"**（那等于伪造来源），出声一条 warn 供排障，
  // 界面按"没有可标注的来源"处理——三段音色照常显示，那部分不依赖 origin。
  if (!ORIGIN_KEYS[origin]) {
    console.warn('[podcast-script-entry] 音色来源取了闭集外的值，整行标注不显示:', origin)
    return ''
  }
  if (!ANNOTATED_ORIGINS.includes(origin)) return ''
  return t(ORIGIN_KEYS[origin])
})
// 相位文案取 §6.4.2 既有表；相位枚举由主进程给，前端不抄相位清单。
const phaseText = computed(() => (phase.value ? t('podcast.episode.phase.' + phase.value) : ''))

async function release () {
  if (!suspended) return
  suspended = false
  await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)
}

async function loadPreview () {
  plan.value = null
  voice.value = null
  previewReason.value = ''
  try {
    const res = await episodePlanPreview(JSON.parse(JSON.stringify({ channelId: props.channelId, script: props.script })))
    if (!res || res.available !== true) { previewReason.value = t('podcast.episode.progressUnavailable'); return }
    const data = res.result || {}
    if (data.ok && data.plan) { plan.value = data.plan; voice.value = data.voice || null; return }
    // 领域码 → 文案：按码取 locale，取不到就如实显示主进程给的 message
    previewReason.value = data.subCode ? t('podcast.errors.' + data.subCode) : (data.message || t('podcast.episode.progressUnavailable'))
    if (/podcast\.errors\./.test(previewReason.value)) previewReason.value = data.message || t('podcast.episode.progressUnavailable')
  } catch (e) {
    // 预览失败只降级为「不显示计数」，不得毁掉发起路径（§7.10.4.1 判据 4）
    previewReason.value = (e && e.message) || t('podcast.episode.progressUnavailable')
  }
}

function attachProgress () {
  if (unsubscribe) return
  Promise.resolve(onEpisodePublishProgress((evt) => { if (evt && evt.phase) phase.value = evt.phase }))
    .then((res) => {
      const fn = res && res.available === true ? res.result : res
      unsubscribe = typeof fn === 'function' ? fn : null
    })
    .catch(() => { unsubscribe = null })
}

function detachProgress () {
  const fn = unsubscribe
  unsubscribe = null
  if (typeof fn !== 'function') return
  try { fn() } catch (e) { /* 退订失败不影响卸载 */ }
}

async function onConfirm () {
  if (publishing.value) return
  publishing.value = true
  message.value = ''
  attachProgress()
  try {
    // billingConfirmed 是**用户刚刚做的事**，不是前端的默认值；runId 由这里生成一次，
    // 它的形态判据同时在主进程兼作临时目录名的穿越边界。
    const payload = {
      channelId: props.channelId,
      runId: 'txt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title: props.title,
      copy: { content: props.script },
      billingConfirmed: true,
    }
    const res = await episodePublishFromScript(JSON.parse(JSON.stringify(payload)))
    if (res && res.available === true) {
      const data = res.result || {}
      message.value = data.state === 'success' ? t('podcast.episode.success', { feedUrl: data.feedUrl || '' }) : (data.errorMessage || data.message || data.state || '')
      emit('published', data)
    } else {
      message.value = t('podcast.episode.progressUnavailable')
    }
  } catch (e) {
    message.value = (e && e.message) || t('podcast.episode.closeNotCancel')
  } finally {
    publishing.value = false
  }
}

function onCancel () {
  // 关闭 ≠ 取消出期：确认框阶段还没发起任何调用，所以这里只关窗，不发 cancel
  emit('update:visible', false)
}

watch(() => props.visible, async (v) => {
  if (v) {
    await suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)
    suspended = true
    void loadPreview()
  } else {
    detachProgress()
    await release()
  }
}, { immediate: true })

// 父组件直接 v-if 掉浮层时 visible 不经过 false —— 没有这条兜底就是残留挂起计数
onBeforeUnmount(() => { detachProgress(); void release() })
</script>

<style scoped>
.podcast-script-entry { position: fixed; inset: 0; z-index: 1200; }
.podcast-script-entry__backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); }
.podcast-script-entry__panel { position: relative; margin: 8vh auto; max-width: 560px; padding: 18px 20px; border-radius: 10px; background: var(--mp-surface, #fff); }
.podcast-script-entry__plan { margin: 8px 0; padding-left: 18px; }
.podcast-script-entry__reason, .podcast-script-entry__result { color: #c0392b; }
.podcast-script-entry__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
</style>
