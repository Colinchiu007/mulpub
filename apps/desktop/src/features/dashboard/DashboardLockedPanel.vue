<template>
  <div class="dash-locked" :data-testid="`dashboard-locked-${name}`" role="status">
    <div class="dash-locked-head">
      <el-icon><Lock /></el-icon>
      <span class="dash-locked-title">{{ title }}</span>
    </div>
    <p class="dash-locked-hint">{{ t('dashboard.lockedHint', { name: title }) }}</p>
    <button type="button" class="dash-locked-cta" @click="$emit('upgrade')">
      {{ t('dashboard.lockedCta') }}
    </button>
  </div>
</template>

<script setup>
/**
 * 套餐未解锁区块的占位（dash-full-entitlement）。
 *
 * 形态决策（PRD §3.3，三条候选里的唯一诚实解）：
 *   ① 整块隐藏 → 用户不知道「原来还有这个」，也失去升级动机；
 *   ② 骨架假数据 → 欺骗，且假数字会被读成真数据；
 *   ③ 占位 + 说明能解锁什么 → 诚实且有转化价值，采此条。
 *
 * 注意：本组件**不发起**任何 IPC。未解锁时不该去拿拿不到的数据
 * （省流量，也避免「请求了但被权益拒绝」的歧义状态）。
 */
import { Lock } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'

defineProps({
  /** 区块标题，同时用于占位文案与 data-testid 后缀 */
  title: { type: String, required: true },
  /** testid 语义名（英文短名），如 trend / platform / perf / pattern */
  name: { type: String, required: true },
})

defineEmits(['upgrade'])

const { t } = useI18n()
</script>

<style scoped>
/* 与页面既有 .dash-panel 同形态（圆角卡片 + 虚线边），保证免费版看到的
 * 占位与付费版看到的真实区块在版式上一致，不会显得像"缺了一块"。 */
.dash-locked {
  margin-bottom: var(--space-md);
  padding: 16px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md, 12px);
  background: var(--cream-surface, transparent);
}
.dash-locked-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
  font-weight: 600;
  font-size: var(--font-size-base, 15px);
  color: var(--deep-purple, var(--color-text-primary));
}
.dash-locked-hint {
  margin: var(--space-sm, 8px) 0 var(--space-md, 12px);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
.dash-locked-cta {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--lavender-primary, var(--color-primary));
  background: transparent;
  color: var(--lavender-primary, var(--color-primary));
  cursor: pointer;
  padding: 6px 14px;
  border-radius: var(--radius-sm, 8px);
  font-size: var(--font-size-xs);
  font-weight: 500;
  transition: background 0.15s ease, color 0.15s ease;
}
.dash-locked-cta:hover {
  background: var(--lavender-primary, var(--color-primary));
  color: var(--color-on-primary, #fff);
}
</style>
