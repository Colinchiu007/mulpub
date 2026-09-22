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
      <nav class="settings-tabs" :aria-label="t('settings.title')">
        <button
          v-for="tab in tabs" :key="tab.key"
          class="settings-tab" :class="{ active: activeTab === tab.key, disabled: tab.disabled }"
          :disabled="tab.disabled"
          :aria-current="activeTab === tab.key ? 'true' : undefined"
          @click="onTabClick(tab)"
        >
          <span class="tab-icon"><el-icon><component :is="tab.icon" /></el-icon></span>
          <span class="tab-label">{{ tab.label }}</span>
          <span v-if="tab.disabled" class="tab-badge">{{ t('settings.tabComingSoon') }}</span>
        </button>
      </nav>
      <!-- 右侧内容区 -->
      <div class="settings-panel">
        <ModelProviders v-if="activeTab === 'model'" />
        <LogsSettings v-else-if="activeTab === 'general'" />
        <FeishuSettingsTab v-else-if="activeTab === 'feishu'" />
        <div v-else class="placeholder-panel">
          <div class="placeholder-icon"><el-icon><Compass /></el-icon></div>
          <p>{{ t('settings.placeholder') }}</p>
        </div>
      </div>
    </div>
  </UiModal>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Connection, Setting, Link, Upload, User, Compass } from '@element-plus/icons-vue'
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
    { key: 'model', label: t('settings.tabModel'), icon: Connection, disabled: false },
    { key: 'general', label: t('settings.tabGeneral'), icon: Setting, disabled: false },
    { key: 'feishu', label: t('knowledgeBase.feishuApi'), icon: Link, disabled: false },
    { key: 'publish', label: t('settings.tabPublish'), icon: Upload, disabled: true },
    { key: 'account', label: t('settings.tabAccount'), icon: User, disabled: true },
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

/* ===== 左侧 Tab 导航 ===== */
.settings-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 200px;
  padding: 16px 12px;
  border-right: 1px solid var(--border-light, #eee);
  background: var(--color-bg-inset, #faf6f8);
  flex-shrink: 0;
}

.settings-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-muted, #707080);
  font-size: var(--font-size-sm, 13px);
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
}

.tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 16px;
  color: inherit;
  flex-shrink: 0;
  transition: color 180ms ease, transform 180ms ease;
}

.tab-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* hover：仅对可点击且未激活项 */
.settings-tab:hover:not(.disabled):not(.active) {
  background: var(--primary-light, rgba(80, 72, 229, 0.06));
  color: var(--primary, #5048E5);
}

/* 键盘可达性焦点环 */
.settings-tab:focus-visible {
  outline: 2px solid var(--primary, #5048E5);
  outline-offset: 2px;
}

/* active：填充卡片 + 左侧强调条 + 图标微放大 */
.settings-tab.active {
  background: var(--color-bg-card, #fff);
  color: var(--primary, #5048E5);
  font-weight: 600;
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(30, 27, 75, 0.08));
}
.settings-tab.active .tab-icon {
  transform: scale(1.08);
}
.settings-tab.active::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--primary, #5048E5);
}

/* disabled：降透明 + 禁用光标 */
.settings-tab.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.tab-badge {
  font-size: var(--font-size-xs, 12px);
  font-weight: 500;
  line-height: 1;
  color: var(--text-muted, #9898a8);
  background: var(--border-light, #eee);
  padding: 3px 7px;
  border-radius: var(--radius-full, 9999px);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ===== 右侧内容区 ===== */
.settings-panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px 28px;
}

/* 弹窗内子页面自带页级水平 padding（.cohere-page-header / .cohere-content 各 32px），
   会与面板留白叠加成双重缩进；且零内边距的行（模型筛选条 / 飞书表单）会贴住左侧导航分隔线。
   统一由面板提供水平留白，去掉子页级左右 padding，使各区块对齐到同一基线。 */
.settings-panel :deep(.cohere-page-header),
.settings-panel :deep(.cohere-content) {
  padding-left: 0;
  padding-right: 0;
}

.placeholder-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-muted, #9898a8);
}

.placeholder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full, 9999px);
  background: var(--primary-light, rgba(80, 72, 229, 0.06));
  color: var(--primary, #5048E5);
  font-size: 28px;
}

.placeholder-panel p {
  font-size: var(--font-size-sm, 13px);
  margin: 0;
}

/* ===== 暗色模式 ===== */
[data-theme="dark"] .settings-tabs {
  background: var(--color-bg-inset, #1e1e23);
  border-right-color: var(--color-border, #32323a);
}
[data-theme="dark"] .settings-tab {
  color: #b4b2c6;
}
[data-theme="dark"] .settings-tab.active {
  background: #2a2a34;
  color: #a5a0ff;
}
[data-theme="dark"] .settings-tab.active::before {
  background: #a5a0ff;
}
[data-theme="dark"] .tab-badge {
  background: #32323a;
  color: #9a9cb3;
}
</style>
