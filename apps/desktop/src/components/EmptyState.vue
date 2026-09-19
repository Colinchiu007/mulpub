<template>
  <div class="mp-empty-state" :class="{ 'mp-empty-state--compact': compact }">
    <div class="mp-empty-state__icon" aria-hidden="true">
      <slot name="icon">{{ icon }}</slot>
    </div>
    <p class="mp-empty-state__title">{{ title }}</p>
    <p v-if="description" class="mp-empty-state__hint">{{ description }}</p>
    <div v-if="hasActions || actionText" class="mp-empty-state__actions">
      <slot name="actions">
        <button class="mp-empty-state__action" type="button" @click="$emit('action')">
          {{ actionText }}
        </button>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { useSlots } from 'vue'

defineProps({
  icon: { type: String, default: '📭' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  actionText: { type: String, default: '' },
  compact: { type: Boolean, default: false }
})
defineEmits(['action'])

const slots = useSlots()
const hasActions = !!slots.actions
</script>

<style scoped>
.mp-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-3);
  min-height: 260px;
  padding: var(--spacing-6);
  text-align: center;
  color: var(--color-text-secondary);
}
.mp-empty-state--compact {
  min-height: 120px;
  gap: var(--spacing-2);
  padding: var(--spacing-3);
}
.mp-empty-state__icon {
  font-size: 38px;
  line-height: 1;
}
.mp-empty-state--compact .mp-empty-state__icon {
  font-size: 24px;
}
.mp-empty-state__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
}
.mp-empty-state--compact .mp-empty-state__title {
  font-size: var(--font-size-sm);
}
.mp-empty-state__hint {
  margin: 0;
  font-size: var(--font-size-sm);
}
.mp-empty-state__actions {
  margin-top: var(--spacing-2);
}
.mp-empty-state__action {
  padding: var(--spacing-2) var(--spacing-5);
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.mp-empty-state__action:hover {
  background: var(--color-primary-hover);
}
</style>
