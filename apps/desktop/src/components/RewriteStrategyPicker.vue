<template>
  <div class="config-row">
    <label class="cohere-form-label">{{ labels.label }}</label>
    <div class="strategy-mode-row">
      <label class="strategy-radio" :class="{ disabled }">
        <input
          type="radio"
          name="strategy-mode"
          value="auto"
          :checked="strategyMode === 'auto'"
          :disabled="disabled"
          @change="$emit('update:strategyMode', 'auto')"
        />
        <span>{{ labels.auto }}</span>
      </label>
      <label class="strategy-radio" :class="{ disabled }">
        <input
          type="radio"
          name="strategy-mode"
          value="manual"
          :checked="strategyMode === 'manual'"
          :disabled="disabled"
          @change="$emit('update:strategyMode', 'manual')"
        />
        <span>{{ labels.manual }}</span>
      </label>
    </div>
    <!-- 自动模式：发起前预览将匹配的策略（失败降级为 --） -->
    <div v-if="strategyMode === 'auto'" class="strategy-preview">
      {{ labels.preview }}{{ labels.previewColon }}{{ previewName }}
    </div>
    <!-- 手动模式：策略下拉（列表加载失败时仅占位项，改写仍可发起） -->
    <select
      v-if="strategyMode === 'manual'"
      :value="strategyId"
      class="cohere-input strategy-select"
      :disabled="disabled"
      @change="$emit('update:strategyId', $event.target.value)"
    >
      <option value="">{{ labels.placeholder }}</option>
      <option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
    </select>
  </div>
</template>

<script setup>
/**
 * RewriteStrategyPicker — 改写策略选择区块
 *
 * 展示层组件：自动匹配/手动选择 radio + 策略下拉 + 自动模式匹配预览。
 * 数据与 IPC 调用归父组件（RewriteView），本组件只负责渲染与 v-model 透传，
 * 保持 RewriteView 在债务门禁（单文件 ≤500 行）约束内。
 */
defineProps({
  /** 'auto' | 'manual' */
  strategyMode: { type: String, required: true },
  /** 手动模式选中的策略 id（空串=未选） */
  strategyId: { type: String, default: '' },
  /** 启用策略列表（内置 + 远程下发） */
  strategies: { type: Array, default: () => [] },
  /** 自动模式预览的策略名（失败降级 '--'） */
  previewName: { type: String, default: '--' },
  /** 改写进行中禁用交互 */
  disabled: { type: Boolean, default: false },
  /** i18n 文案（由父组件注入，保持本组件无硬编码文案） */
  labels: {
    type: Object,
    required: true,
    validator: (v) => ['label', 'auto', 'manual', 'preview', 'previewColon', 'placeholder'].every((k) => typeof v[k] === 'string'),
  },
})

defineEmits(['update:strategyMode', 'update:strategyId'])
</script>

<style scoped>
.strategy-mode-row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 4px;
}
.strategy-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-primary);
}
.strategy-radio.disabled { opacity: 0.6; cursor: default; }
.strategy-preview {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
  padding: 4px 8px;
  background: var(--soft-stone);
  border-radius: 6px;
}
.strategy-select {
  max-width: 280px;
  margin-top: 4px;
}
</style>
