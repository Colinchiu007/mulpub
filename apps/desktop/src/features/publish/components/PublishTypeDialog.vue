<template>
    <Transition name="publish-type-modal">
      <div
        v-if="visible"
        class="publish-type-backdrop"
        data-testid="publish-type-dialog"
        @click.self="emit('close')"
        @keydown.esc="emit('close')"
      >
        <section
          class="publish-type-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-type-dialog-title"
          tabindex="-1"
        >
          <header class="publish-type-header">
            <h2 id="publish-type-dialog-title" data-testid="publish-type-dialog-title">{{ t('publishType.title') }}</h2>
            <button class="publish-type-close" type="button" :aria-label="t('publishType.close')" @click="emit('close')">×</button>
          </header>

          <div class="publish-type-grid">
            <button
              v-for="option in typeOptions"
              :key="option.value"
              class="publish-type-card"
              :data-testid="`publish-type-card-${option.value}`"
              type="button"
              @click="emit('select', option.value)"
            >
              <span class="publish-type-icon" :class="`tone-${option.tone}`" aria-hidden="true">{{ option.icon }}</span>
              <span class="publish-type-card-title">{{ option.label }}</span>
              <span class="publish-type-support">{{ t('publishType.supportCount', { count: option.platforms.length }) }}</span>
              <span v-if="option.platforms.length" class="publish-type-platforms" :aria-label="t('publishType.supportedAria')">
                <span
                  v-for="platform in option.platforms.slice(0, 7)"
                  :key="platform.id"
                  class="publish-type-platform-icon"
                  :title="platform.label"
                  aria-hidden="true"
                ><img v-if="platform.iconUrl" :src="platform.iconUrl" :alt="platform.label" class="publish-type-platform-icon-img" width="16" height="16"><span v-else>{{ platform.icon }}</span></span>
                <span v-if="option.platforms.length > 7" class="publish-type-platform-more">+{{ option.platforms.length - 7 }}</span>
              </span>
            </button>
          </div>
        </section>
      </div>
    </Transition>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { PLATFORM_ICONS, PLATFORM_NAMES } from '@multi-publish/shared-utils/src/platform-definitions'
import { getPlatformIconUrl } from '@/composables/usePlatformIconUrl'

const { t } = useI18n()

const props = defineProps({
  visible: { type: Boolean, default: false },
  platforms: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'select'])

const fallbackPlatforms = Object.entries(PLATFORM_NAMES).map(([id, label]) => ({
  id,
  label,
  icon: PLATFORM_ICONS[id] || '•',
}))

// 2026-09 合并发布类型：原 image（图文发布）/article（文章发布）/wechat（公众号）三个入口
// 在编辑器、IPC payload、主进程链路完全等价（都落 activeMode='article'），合并为单一
// "图文文章发布"入口；平台集合取原 image ∪ article 并集（去重）。video 保持独立。
const typeDefinitions = [
  { value: 'video', labelKey: 'typeVideo', icon: '▶', tone: 'violet', ids: ['douyin', 'kuaishou', 'tencent_video', 'bilibili', 'youtube', 'tiktok', 'weibo', 'xiaohongshu', 'toutiao'] },
  { value: 'article', labelKey: 'typeArticleImage', icon: '▤', tone: 'pink', ids: ['douyin', 'xiaohongshu', 'weibo', 'zhihu', 'toutiao', 'baijiahao', 'wechat_mp', 'instagram', 'facebook', 'bilibili', 'twitter'] },
]

const availablePlatforms = computed(() => {
  const source = props.platforms.length ? props.platforms : fallbackPlatforms
  return source.map(platform => ({
    id: String(platform.id),
    label: platform.label || PLATFORM_NAMES[platform.id] || platform.id,
    icon: platform.icon || PLATFORM_ICONS[platform.id] || '•',
    iconUrl: getPlatformIconUrl(platform.id) || '',
  }))
})

const typeOptions = computed(() => typeDefinitions.map(definition => ({
  ...definition,
  label: t('publishType.' + definition.labelKey),
  platforms: availablePlatforms.value.filter(platform => definition.ids.includes(platform.id)),
})))
</script>

<style scoped>
.publish-type-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(22, 23, 34, .78);
}

.publish-type-dialog {
  width: min(900px, 100%);
  box-sizing: border-box;
  padding: 24px;
  border-radius: 14px;
  background: #f7f8fb;
  box-shadow: 0 24px 80px rgba(13, 15, 30, .32);
}

.publish-type-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.publish-type-header h2 {
  margin: 0;
  color: #252633;
  font-size: 20px;
  line-height: 28px;
}

.publish-type-close {
  width: 32px;
  height: 32px;
  border: 0;
  background: transparent;
  color: #747783;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}

.publish-type-close:hover,
.publish-type-close:focus-visible {
  color: #5149e8;
}

.publish-type-close:focus-visible,
.publish-type-card:focus-visible {
  outline: 2px solid #5149e8;
  outline-offset: 3px;
}

.publish-type-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.publish-type-card {
  min-height: 286px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 22px 18px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: #fff;
  color: #30323d;
  text-align: left;
  cursor: pointer;
  transition: transform .15s ease, border-color .15s ease, box-shadow .15s ease;
}

.publish-type-card:hover {
  transform: translateY(-2px);
  border-color: #d8d6fa;
  box-shadow: 0 10px 22px rgba(63, 57, 153, .12);
}

.publish-type-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  margin-bottom: 18px;
  border-radius: 12px;
  color: #fff;
  font-size: 24px;
  font-weight: 700;
}

.tone-violet { background: linear-gradient(135deg, #a77cff, #7664e8); }
.tone-blue { background: linear-gradient(135deg, #72a9ff, #4f8eeb); }
.tone-pink { background: linear-gradient(135deg, #ff7fa5, #f05283); }
.tone-purple { background: linear-gradient(135deg, #b084ff, #7e5ae5); }

.publish-type-card-title {
  margin-bottom: 26px;
  color: #30323d;
  font-size: 16px;
  font-weight: 700;
}

.publish-type-support {
  color: #8a8d99;
  font-size: 12px;
}

.publish-type-platforms {
  min-height: 28px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
}

.publish-type-platform-icon,
.publish-type-platform-more {
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f0f1f6;
  color: #525563;
  font-size: 13px;
}

.publish-type-platform-more {
  width: auto;
  min-width: 23px;
  padding: 0 5px;
  border-radius: 12px;
  color: #76798a;
  font-size: 11px;
}

.publish-type-modal-enter-active,
.publish-type-modal-leave-active { transition: opacity .16s ease; }
.publish-type-modal-enter-active .publish-type-dialog,
.publish-type-modal-leave-active .publish-type-dialog { transition: transform .16s ease; }
.publish-type-modal-enter-from,
.publish-type-modal-leave-to { opacity: 0; }
.publish-type-modal-enter-from .publish-type-dialog,
.publish-type-modal-leave-to .publish-type-dialog { transform: scale(.98) translateY(8px); }

@media (max-width: 760px) {
  .publish-type-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .publish-type-card { min-height: 220px; }
}

@media (max-width: 430px) {
  .publish-type-backdrop { padding: 12px; }
  .publish-type-dialog { padding: 16px; }
  .publish-type-grid { gap: 10px; }
  .publish-type-card { min-height: 190px; padding: 14px; }
  .publish-type-card-title { margin-bottom: 18px; }
}
</style>