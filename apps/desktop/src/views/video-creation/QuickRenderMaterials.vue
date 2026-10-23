<template>
  <!-- ── 首尾帧素材（keyframe 模式） ── -->
  <template v-if="mode === 'keyframe'">
    <div v-for="slot in frameSlots" :key="slot.key" class="form-group">
      <label>{{ slot.label }}</label>
      <div
        class="upload-zone"
        :data-testid="`quick-frame-slot-${slot.key}`"
        @click="emit('pick-frame', slot.key)"
        @dragover.prevent
        @drop.prevent="emit('drop-frame', slot.key, $event.dataTransfer && $event.dataTransfer.files)"
      >
        <p v-if="!frames[slot.key]">{{ $t('create.story2video.ui.quickUploadFrame') }}</p>
        <div v-else class="image-grid">
          <div class="image-thumb">
            <img :src="frames[slot.key].dataUrl" />
            <button class="remove-btn" :data-testid="`quick-frame-remove-${slot.key}`" @click.stop="emit('remove-frame', slot.key)">×</button>
          </div>
        </div>
      </div>
    </div>
  </template>

  <!-- ── 参考素材（reference 模式） ── -->
  <template v-if="mode === 'reference'">
    <div class="form-group">
      <label>{{ $t('create.story2video.ui.quickRefImagesLabel') }}</label>
      <div
        class="upload-zone"
        data-testid="quick-ref-images-zone"
        @click="emit('pick-images')"
        @dragover.prevent
        @drop.prevent="emit('drop-images', $event.dataTransfer && $event.dataTransfer.files)"
      >
        <p v-if="referenceImages.length === 0">{{ $t('create.story2video.ui.quickUploadImage') }}</p>
        <div v-else class="image-grid">
          <div v-for="(img, i) in referenceImages" :key="i" class="image-thumb">
            <img :src="img.dataUrl" />
            <button class="remove-btn" data-testid="quick-ref-image-remove" @click.stop="emit('remove-image', i)">×</button>
            <span class="image-index">{{ i + 1 }}</span>
          </div>
        </div>
      </div>
      <p v-if="referenceImages.length" class="text-muted quick-hint">
        {{ $t('create.story2video.ui.quickRefImagesCount', { count: referenceImages.length, max: maxImages }) }}
      </p>
    </div>

    <div class="form-group">
      <label>{{ $t('create.story2video.ui.quickRefAudiosLabel') }}</label>
      <div
        class="upload-zone"
        data-testid="quick-ref-audios-zone"
        @click="emit('pick-audios')"
        @dragover.prevent
        @drop.prevent="emit('drop-audios', $event.dataTransfer && $event.dataTransfer.files)"
      >
        <p v-if="referenceAudios.length === 0">{{ $t('create.story2video.ui.quickUploadAudio') }}</p>
        <div v-else class="image-grid">
          <div v-for="(aud, i) in referenceAudios" :key="i" class="image-thumb">
            <span class="image-index">{{ i + 1 }}</span>
            <button class="remove-btn" data-testid="quick-ref-audio-remove" @click.stop="emit('remove-audio', i)">×</button>
          </div>
        </div>
      </div>
      <p v-if="referenceAudios.length" class="text-muted quick-hint">
        {{ $t('create.story2video.ui.quickRefAudiosCount', { count: referenceAudios.length, max: maxAudios }) }}
      </p>
    </div>
  </template>

  <!-- ── 图片轮播素材（gallery 模式，本地 Remotion） ── -->
  <template v-if="mode === 'gallery'">
    <div class="form-group">
      <label>{{ $t('create.story2video.ui.quickGalleryImagesLabel') }}</label>
      <div
        class="upload-zone"
        data-testid="quick-gallery-zone"
        @click="emit('pick-gallery')"
        @dragover.prevent
        @drop.prevent="emit('drop-gallery', $event.dataTransfer && $event.dataTransfer.files)"
      >
        <p v-if="galleryImages.length === 0">{{ $t('create.story2video.ui.quickUploadImage') }}</p>
        <div v-else class="image-grid">
          <div v-for="(img, i) in galleryImages" :key="i" class="image-thumb">
            <img :src="img.dataUrl" />
            <button class="remove-btn" data-testid="quick-gallery-remove" @click.stop="emit('remove-gallery', i)">×</button>
            <span class="image-index">{{ i + 1 }}</span>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps({
  mode: { type: String, required: true },
  frames: { type: Object, required: true },
  referenceImages: { type: Array, required: true },
  referenceAudios: { type: Array, required: true },
  galleryImages: { type: Array, required: true },
  maxImages: { type: Number, default: 0 },
  maxAudios: { type: Number, default: 0 },
})

const emit = defineEmits([
  'pick-frame', 'pick-images', 'pick-audios', 'pick-gallery',
  'drop-frame', 'drop-images', 'drop-audios', 'drop-gallery',
  'remove-frame', 'remove-image', 'remove-audio', 'remove-gallery',
])

const frameSlots = computed(() => [
  { key: 'first', label: t('create.story2video.ui.quickFirstFrameLabel') },
  { key: 'last', label: t('create.story2video.ui.quickLastFrameLabel') },
])
</script>

<style scoped>
.quick-hint {
  font-size: 12px;
  margin: 6px 0 0;
  line-height: 1.5;
}
</style>
