<template>
  <div class="staggered-list">
    <TransitionGroup name="staggered">
      <component
        :is="itemComponent"
        v-for="(item, index) in items"
        :key="item.key || item.id || index"
        :data-item-index="index"
        class="staggered-item"
        :class="itemClass"
        :style="{ '--stagger-index': index }"
      >
        <slot :item="item" :index="index">
          {{ item }}
        </slot>
      </component>
    </TransitionGroup>
  </div>
</template>

<script setup>
const props = defineProps({
  items: { type: Array, default: () => [] },
  itemComponent: { type: String, default: undefined },
  itemClass: { type: String, default: '' },
})
</script>

<style scoped>
.staggered-enter-active,
.staggered-leave-active {
  transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: opacity, transform;
}

.staggered-enter {
  opacity: 0;
  transform: translateY(24px);
}

.staggered-leave-to {
  opacity: 0;
  transform: translateY(-24px);
}

/* 延迟显现 */
.staggered-item {
  animation: staggered-reveal-up 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  animation-delay: calc(var(--data-item-index, 0) * 0.08s);
}

/* 响应式优化 */
@media (prefers-reduced-motion: reduce) {
  .staggered-enter-active,
  .staggered-leave-active {
    transition: none;
  }

  .staggered-enter,
  .staggered-leave-to {
    opacity: 1;
    transform: none;
  }

  .staggered-item {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
