<template>
  <UiModal
    v-if="visible"
    :visible="visible"
    :title="t('publishPage.coverPreview.title')"
    size="xl"
    test-id="cover-preview-dialog"
    :close-on-esc="true"
    @close="requestClose"
  >
    <div class="cover-preview-body">
      <img
        v-if="dataUrl"
        data-testid="cover-preview-image"
        class="cover-preview-image"
        :src="dataUrl"
        :alt="t('publishPage.coverPreview.title')"
        @load="onImageLoad"
        loading="eager" decoding="async">
      <div v-else class="cover-preview-empty">{{ error || t('publishPage.coverPreview.unavailable') }}</div>
      <p v-if="meta" class="cover-preview-meta">{{ meta }}</p>
    </div>
  </UiModal>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { releaseEmbeddedViewsForOverlay, suspendEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'
import UiModal from './UiModal.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  dataUrl: { type: String, default: '' },
  error: { type: String, default: '' },
  path: { type: String, default: '' },
})
const emit = defineEmits(['close'])
const { t } = useI18n()

// 本弹窗是应用级居中模态。内嵌 WebContentsView 是压在渲染 DOM 之上的原生图层，
// CSS z-index 对其无效，不挂起就会被浏览器/登录标签整块盖住。
const OVERLAY_OWNER = 'publish-cover-preview'
const naturalSize = ref(null)
let overlayHeld = false

async function suspendOverlay () {
  if (overlayHeld) return
  overlayHeld = true
  try {
    await suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)
  } catch (_) {
    overlayHeld = false
  }
}

async function releaseOverlay () {
  if (!overlayHeld) return
  overlayHeld = false
  await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)
}

function requestClose () {
  emit('close')
}

const fileName = computed(() => {
  const raw = String(props.path || '')
  if (!raw) return ''
  const parts = raw.split(/[\\/]/)
  return parts[parts.length - 1] || raw
})

const meta = computed(() => {
  const bits = []
  if (fileName.value) bits.push(fileName.value)
  if (naturalSize.value) bits.push(`${naturalSize.value.width}×${naturalSize.value.height}`)
  return bits.join(' · ')
})

function onImageLoad (event) {
  const width = event?.target?.naturalWidth
  const height = event?.target?.naturalHeight
  naturalSize.value = width && height ? { width, height } : null
}

// 换封面时收起：弹窗里的图必须等于真源，让用户确认一张已被替换的旧图
// 比没有预览更糟。关闭由父组件收回 visible，释放挂起走下面的统一出口。
watch(() => props.path, () => {
  if (props.visible) requestClose()
})

// 打开即挂起、关闭即释放；immediate 覆盖「以 visible=true 首次挂载」这一路径。
watch(() => props.visible, (open) => {
  if (open) {
    naturalSize.value = null
    suspendOverlay()
  } else {
    releaseOverlay()
  }
}, { immediate: true })

// 兜底：父组件直接 v-if 掉本组件或路由切走时，visible 不会经过 false，
// 只靠上面那条会残留挂起计数。
onBeforeUnmount(() => { releaseOverlay() })
</script>

<style scoped>
.cover-preview-body { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.cover-preview-image { max-width: 100%; max-height: 70vh; object-fit: contain; background: #1f2126; border-radius: 6px; }
.cover-preview-empty { padding: 32px 12px; color: var(--color-danger); font-size: var(--font-size-sm); }
.cover-preview-meta { margin: 0; color: var(--muted); font-size: var(--font-size-xs); word-break: break-all; text-align: center; }
</style>
