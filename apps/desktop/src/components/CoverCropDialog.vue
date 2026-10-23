<template>
  <UiModal
    v-if="visible"
    class="cover-crop-dialog"
    :visible="visible"
    :title="t('publishPage.coverCrop.title')"
    width="760px"
    @close="$emit('close')"
  >
    <div class="cover-crop-body">
      <div v-if="loadError" class="crop-error">{{ loadError }}</div>
      <div v-else class="crop-preview-wrap">
        <div class="crop-preview" :style="previewStyle">
          <img
            v-if="previewUrl"
            ref="imgEl"
            class="crop-img"
            :src="previewUrl"
            alt="cover"
            draggable="false"
            @load="onImageLoad"
            loading="eager" decoding="async">
          <div
            v-if="previewUrl && imgNatural"
            class="crop-box"
            :style="cropBoxStyle"
            @mousedown.stop.prevent="onCropDragStart"
            @mousemove.stop.prevent="onCropDragMove"
            @mouseup.stop.prevent="onCropDragEnd"
          >
            <div class="crop-grid" />
            <div v-for="h in 8" :key="'h' + h" class="crop-handle" :class="'handle-' + h" />
          </div>
        </div>
        <p class="crop-hint">{{ t('publishPage.coverCrop.dragHint') }}</p>
      </div>
      <div class="crop-toolbar">
        <div class="crop-ratios">
          <button
            v-for="r in ratioPresets" :key="r.key"
            type="button"
            class="ratio-btn"
            :class="{ active: activeRatio === r.key }"
            @click="setRatio(r.key)"
          >
            {{ t('publishPage.coverCrop.ratio.' + r.key) }}
          </button>
        </div>
        <div class="crop-actions">
          <UiButton class="crop-close" variant="ghost" size="sm" @click="$emit('close')">
            {{ t('publishPage.coverCrop.cancel') }}
          </UiButton>
          <UiButton class="crop-confirm" variant="primary" size="sm" :loading="cropping" @click="confirmCrop">
            {{ t('publishPage.coverCrop.confirm') }}
          </UiButton>
        </div>
      </div>
    </div>
  </UiModal>
</template>

<script setup>
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@/api/electron-bridge'
import { useCoverPreview } from '@/composables/useCoverPreview'
import { releaseEmbeddedViewsForOverlay, suspendEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'
import UiModal from './UiModal.vue'
import UiButton from './UiButton.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  imagePath: { type: String, default: '' },
})
const emit = defineEmits(['close', 'success', 'error'])

const { t } = useI18n()

const activeImagePath = computed(() => (props.visible ? props.imagePath : ''))
// 「本地路径 → dataURL」的剥信封口径唯一实现在 useCoverPreview；
// 路径 getter 里带上 visible，等价于原先「仅在弹窗打开时加载」的命令式 loadImage。
const { dataUrl: previewUrl, error: loadError } = useCoverPreview(activeImagePath, {
  unavailableKey: 'publishPage.coverCrop.loadFailed',
})
const cropping = ref(false)
const imgEl = ref(null)
const imgNatural = ref(null)
const cropBox = ref({ x: 0, y: 0, width: 100, height: 100, displayW: 0, displayH: 0 })
const dragging = ref(null)
const activeRatio = ref('free')

const ratioPresets = [
  { key: 'free', ratio: null },
  { key: 'r169', ratio: 16 / 9 },
  { key: 'r11', ratio: 1 },
  { key: 'r43', ratio: 4 / 3 },
]

const previewStyle = computed(() => {
  if (!imgNatural.value) return {}
  return { position: 'relative', width: '640px', height: '360px', overflow: 'hidden', background: '#000' }
})

const cropBoxStyle = computed(() => ({
  left: cropBox.value.x + 'px',
  top: cropBox.value.y + 'px',
  width: cropBox.value.width + 'px',
  height: cropBox.value.height + 'px',
}))

// 换图（重新打开或切换封面）后必须先丢掉上一张的像素尺寸，
// 否则裁剪框会按旧图的缩放比例映射到新图上，rect 落到图外。
watch(previewUrl, () => { imgNatural.value = null })

function onImageLoad () {
  const img = imgEl.value
  if (!img) return
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  imgNatural.value = { width: nw, height: nh }
  const dispW = 640
  const dispH = Math.max(1, Math.round(nh * (dispW / nw)))
  cropBox.value = { x: 0, y: 0, width: dispW, height: dispH, displayW: dispW, displayH: dispH }
}

function setRatio (key) {
  activeRatio.value = key
  const preset = ratioPresets.find((r) => r.key === key)
  if (!preset || !preset.ratio || !imgNatural.value) return
  const { displayW, displayH } = cropBox.value
  const r = preset.ratio
  let w = displayW
  let h = Math.round(w / r)
  if (h > displayH) {
    h = displayH
    w = Math.round(h * r)
  }
  cropBox.value = { ...cropBox.value, x: 0, y: 0, width: w, height: h }
}

function onCropDragStart (e) {
  const rect = e.currentTarget.getBoundingClientRect()
  dragging.value = {
    startX: e.clientX,
    startY: e.clientY,
    origX: rect.left,
    origY: rect.top,
  }
}

function onCropDragMove (e) {
  if (!dragging.value) return
  const { startX, startY, origX, origY } = dragging.value
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  const preset = ratioPresets.find((r) => r.key === activeRatio.value)
  let w = Math.max(20, Math.min(origX + dx, cropBox.value.displayW))
  let h = preset?.ratio ? Math.round(w / preset.ratio) : Math.max(20, origY + dy)
  if (h > cropBox.value.displayH) {
    h = cropBox.value.displayH
    if (preset?.ratio) w = Math.round(h * preset.ratio)
  }
  cropBox.value = {
    ...cropBox.value,
    x: 0,
    y: 0,
    width: Math.min(w, cropBox.value.displayW),
    height: h,
  }
}

function onCropDragEnd () {
  dragging.value = null
}

function toNaturalRect () {
  const { x, y, width, height, displayW, displayH } = cropBox.value
  const n = imgNatural.value
  if (!n) return null
  const scaleX = n.width / displayW
  const scaleY = n.height / displayH
  return {
    x: Math.round(x * scaleX),
    y: Math.round(y * scaleY),
    width: Math.round(width * scaleX),
    height: Math.round(height * scaleY),
  }
}

async function confirmCrop () {
  const rect = toNaturalRect()
  if (!rect) return
  cropping.value = true
  try {
    const res = await getApi()?.cropVideoCover?.({ imagePath: props.imagePath, rect, maxBytes: 512 * 1024 })
    if (res?.code === 0 && res?.data?.path) {
      emit('success', res.data)
    } else {
      emit('error', res?.message || t('publishPage.coverCrop.cropFailed'))
    }
  } catch (e) {
    emit('error', typeof e?.message === 'string' ? e.message : t('publishPage.coverCrop.cropFailed'))
  } finally {
    cropping.value = false
  }
}

// ─── 浮层互斥（AGENTS.md overlay view suspension 合同）────────────────
// 本弹窗是应用级居中模态。内嵌 WebContentsView（浏览器/登录标签）是压在渲染 DOM
// 之上的原生图层，CSS z-index 对其无效，不挂起就会被整块盖住。
const OVERLAY_OWNER = 'publish-cover-crop-dialog'
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

watch(() => props.visible, (open) => {
  if (open) suspendOverlay()
  else releaseOverlay()
}, { immediate: true })

// 组件销毁不得残留挂起计数
onBeforeUnmount(() => { releaseOverlay() })
</script>

<style scoped>
.cover-crop-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.crop-preview-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.crop-preview {
  border-radius: 8px;
  border: 1px solid var(--color-border, #e4e4e7);
}
.crop-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}
.crop-box {
  position: absolute;
  border: 2px solid var(--color-primary, #5048E5);
  box-sizing: border-box;
  cursor: move;
  z-index: 2;
}
.crop-grid {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg, transparent 0 33%, rgba(255, 255, 255, 0.35) 33% 34%,
    transparent 34% 66%, rgba(255, 255, 255, 0.35) 66% 67%
  ), repeating-linear-gradient(
    90deg, transparent 0 33%, rgba(255, 255, 255, 0.35) 33% 34%,
    transparent 34% 66%, rgba(255, 255, 255, 0.35) 66% 67%
  );
  pointer-events: none;
}
.crop-handle {
  display: none;
}
.crop-hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary, #909399);
}
.crop-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.crop-ratios {
  display: flex;
  gap: 6px;
}
.ratio-btn {
  padding: 4px 10px;
  font-size: var(--font-size-xs);
  border: 1px solid var(--color-border, #e4e4e7);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.ratio-btn.active {
  border-color: var(--color-primary, #5048E5);
  color: var(--color-primary, #5048E5);
}
.crop-actions {
  display: flex;
  gap: 8px;
}
.crop-error {
  color: var(--color-danger, #f56c6c);
  font-size: var(--font-size-sm);
  padding: 12px;
}
</style>