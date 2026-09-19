<template>
  <div v-if="visibleAnnouncements.length > 0" class="announcement-banners" role="region" aria-label="运营公告">
    <div
      v-for="(a, i) in visibleAnnouncements"
      :key="'ann-' + i"
      class="announcement-banner"
      :class="'severity-' + (a.severity || 'info')"
      role="alert"
    >
      <span class="ann-badge">{{ SEVERITY_LABELS[a.severity] || '提示' }}</span>
      <div class="ann-body">
        <div class="ann-title">{{ a.title }}</div>
        <div v-if="a.content" class="ann-content">{{ a.content }}</div>
      </div>
      <button
        v-if="a.severity !== 'maintenance'"
        class="ann-close"
        aria-label="关闭公告"
        @click="dismiss(a)"
      >✕</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useOpsCenterRuntime } from '@/composables/useOpsCenterRuntime'

const { announcements, SEVERITY_LABELS, loadRuntime } = useOpsCenterRuntime()
const dismissedKeys = ref(new Set())

try {
  const raw = localStorage.getItem('announcement-banner-dismissed')
  if (raw) dismissedKeys.value = new Set(JSON.parse(raw))
} catch (_) { /* 忽略存储异常 */ }

const visibleAnnouncements = computed(() => {
  return (announcements.value || []).filter(a => !dismissedKeys.value.has(dismissKey(a)))
})

function dismissKey (a) {
  // 优先用后端稳定 id；旧数据无 id 时回退内容摘要
  if (a.id !== undefined && a.id !== null && a.id !== '') return 'id:' + a.id
  return (a.severity || 'info') + ':' + (a.title || '') + ':' + (a.content || '')
}

function dismiss (a) {
  dismissedKeys.value.add(dismissKey(a))
  try { localStorage.setItem('announcement-banner-dismissed', JSON.stringify([...dismissedKeys.value])) } catch (_) { /* ignore */ }
}

onMounted(() => { loadRuntime() })
</script>

<style scoped>
.announcement-banners {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px 0;
  z-index: 50;
}
.announcement-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  border: 1px solid;
}
.severity-info {
  background: #e8f0fe;
  border-color: #aecbfa;
  color: #174ea6;
}
.severity-warning {
  background: #fef7e0;
  border-color: #f9ab00;
  color: #7a4f01;
}
.severity-maintenance {
  background: #fce8e6;
  border-color: #f28b82;
  color: #8c1d18;
}
[data-theme="dark"] .severity-info { background: #1a2a4a; border-color: #3c5a9a; color: #aecbfa; }
[data-theme="dark"] .severity-warning { background: #3c331a; border-color: #8a6d1a; color: #fdd663; }
[data-theme="dark"] .severity-maintenance { background: #3c1a1a; border-color: #8a3c3c; color: #f28b82; }
.ann-badge {
  font-weight: 700;
  font-size: 12px;
  white-space: nowrap;
  padding-top: 1px;
}
.ann-body { flex: 1; min-width: 0; }
.ann-title { font-weight: 600; }
.ann-content { margin-top: 2px; line-height: 1.5; word-break: break-word; }
.ann-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
  font-size: 14px;
  padding: 2px;
}
.ann-close:hover { opacity: 1; }
</style>
