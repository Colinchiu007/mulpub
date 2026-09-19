<template>
  <UiModal
    :visible="visible"
    :title="t('settings.title')"
    size="xl"
    width="1100px"
    @close="$emit('close')"
  >
    <div class="settings-dialog-content">
      <!-- 左侧 Tab 导航 -->
      <div class="settings-tabs">
        <button
          v-for="tab in tabs" :key="tab.key"
          class="settings-tab" :class="{ active: activeTab === tab.key, disabled: tab.disabled }"
          :disabled="tab.disabled"
          @click="onTabClick(tab)"
        >
          <span class="tab-label">{{ tab.label }}</span>
          <span v-if="tab.disabled" class="tab-badge">{{ t('settings.tabComingSoon') }}</span>
        </button>
      </div>
      <!-- 右侧内容区 -->
      <div class="settings-panel">
        <ModelProviders v-if="activeTab === 'model'" />
        <LogsSettings v-else-if="activeTab === 'general'" />
        <FeishuSettingsTab v-else-if="activeTab === 'feishu'" />
        <div v-else class="placeholder-panel">
          <div class="placeholder-icon">🚧</div>
          <p>{{ t('settings.placeholder') }}</p>
        </div>
      </div>
    </div>
  </UiModal>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiModal from './UiModal.vue'
import ModelProviders from '@/views/ModelProviders.vue'
import LogsSettings from './LogsSettings.vue'
import FeishuSettingsTab from './FeishuSettingsTab.vue'

defineProps({
  visible: { type: Boolean, default: false },
})
defineEmits(['close'])

const { t } = useI18n()
  const activeTab = ref('model')
  const tabs = computed(() => [
    { key: 'model', label: t('settings.tabModel'), disabled: false },
    { key: 'general', label: t('settings.tabGeneral'), disabled: false },
    { key: 'feishu', label: t('knowledgeBase.feishuApi'), disabled: false },
    { key: 'publish', label: t('settings.tabPublish'), disabled: true },
    { key: 'account', label: t('settings.tabAccount'), disabled: true },
  ])

function onTabClick (tab) {
  if (tab.disabled) return
  activeTab.value = tab.key
}
</script>

<style scoped>
.settings-dialog-content {
  display: flex;
  min-height: 600px;
  max-height: 70vh;
}

.settings-tabs {
  width: 180px;
  border-right: 1px solid var(--border-light);
  padding: 12px 0;
  flex-shrink: 0;
}

.settings-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 20px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  transition: all 150ms;
  text-align: left;
}

.settings-tab:hover:not(.disabled):not(.active) {
  background: var(--primary-light);
  color: var(--primary);
}

.settings-tab.active {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
  border-left: 3px solid var(--primary);
}

.settings-tab.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tab-badge {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--border-light);
  padding: 2px 6px;
  border-radius: 8px;
}

.settings-panel {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.placeholder-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.placeholder-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
</style>
