<template>
  <div
    v-if="visibleAnnouncements.length > 0"
    ref="rootEl"
    class="announcement-banners"
    role="region"
    :aria-label="t('announcement.regionLabel')"
    data-testid="announcement-banners"
  >
    <div
      v-for="(a, i) in visibleAnnouncements"
      :key="'ann-' + i"
      class="announcement-banner"
      :class="'severity-' + severityOf(a)"
      role="alert"
    >
      <span class="ann-badge">{{ severityLabel(a) }}</span>
      <div class="ann-body">
        <div class="ann-title">{{ a.title }}</div>
        <div v-if="a.content" class="ann-content">{{ a.content }}</div>
      </div>
      <button
        v-if="a.severity !== 'maintenance'"
        class="ann-close"
        :aria-label="t('announcement.closeLabel')"
        @click="dismiss(a)"
      >✕</button>
    </div>
  </div>
</template>

<script setup>
/**
 * 运营公告横幅（阶段 1.2 / audit-6）。
 *
 * 组件建好、数据链（ops-center → OpsCenterSync → `opsCenterSyncRuntime`）也建好，
 * 但全仓零引用 ⇒ 用户永远看不到任何公告。本批把它挂进 App.vue 的壳层。
 *
 * 为什么组件要**主动上报自己的高度**：`WebContentsView`（浏览器/登录标签的外部网页）
 * 是压在渲染进程 DOM 之上的原生图层，CSS z-index 对它无效，它的位置由主进程按镜像常量
 * `BROWSER_CHROME_TOP=76` 算出。横幅插在 DOM 流里之后，不把内嵌视图一起下移，
 * 就会被外部网页整块盖住——与 2026-09-23「设置弹窗被网页盖住」是同一形状。
 * 上报走 `inset` 事件交给壳层（App.vue），不在表现层里直接摸 IPC。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOpsCenterRuntime } from '@/composables/useOpsCenterRuntime'

const emit = defineEmits(['inset'])
const { t } = useI18n()
const { announcements, loadRuntime } = useOpsCenterRuntime()
const rootEl = ref(null)
const dismissedKeys = ref(new Set())

try {
  const raw = localStorage.getItem('announcement-banner-dismissed')
  if (raw) dismissedKeys.value = new Set(JSON.parse(raw))
} catch (_) { /* 存储不可用：本次会话仍可展示，不得因读压制记录失败而整块不渲染 */ }

const visibleAnnouncements = computed(() => {
  return (announcements.value || []).filter(a => !dismissedKeys.value.has(dismissKey(a)))
})

/** 徽标档位：只认三档已知 severity，未知值如实回落 info 的文案，但 class 仍按原值保留（配色可归因） */
function severityOf (a) {
  return a && a.severity ? a.severity : 'info'
}

function severityLabel (a) {
  const s = severityOf(a)
  if (s === 'warning') return t('announcement.severityWarning')
  if (s === 'maintenance') return t('announcement.severityMaintenance')
  return t('announcement.severityInfo')
}

function dismissKey (a) {
  // 优先用后端稳定 id；旧数据无 id 时回退内容摘要
  if (a.id !== undefined && a.id !== null && a.id !== '') return 'id:' + a.id
  return (a.severity || 'info') + ':' + (a.title || '') + ':' + (a.content || '')
}

function dismiss (a) {
  dismissedKeys.value.add(dismissKey(a))
  try { localStorage.setItem('announcement-banner-dismissed', JSON.stringify([...dismissedKeys.value])) } catch (_) { /* 压制记录写不进只是下次还会看见，不打断关闭动作 */ }
}

// ── 高度上报 ────────────────────────────────────────────────
let observer = null
let lastReported = -1

function reportInset () {
  const el = rootEl.value
  // 横幅消失（无公告 / 全部被关闭 / v-if 卸载）时必须回写 0，否则内嵌视图永久停在错误顶偏移
  const px = el && typeof el.offsetHeight === 'number' ? el.offsetHeight : 0
  if (px === lastReported) return
  lastReported = px
  emit('inset', px)
}

watch(visibleAnnouncements, async () => {
  await nextTick()
  attachObserver()
  reportInset()
})

function attachObserver () {
  const el = rootEl.value
  if (observer) { observer.disconnect(); observer = null }
  if (!el || typeof ResizeObserver !== 'function') return
  observer = new ResizeObserver(() => reportInset())
  observer.observe(el)
}

onMounted(() => {
  attachObserver()
  reportInset()
  loadRuntime()
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  observer = null
  // 卸载穷尽释放：横幅随壳层卸载时必须把下移还回去（与浮层互斥合同的"释放穷尽"同一条纪律）
  if (lastReported !== 0) emit('inset', 0)
})
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
  font-size: var(--font-size-sm);
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
  font-size: var(--font-size-xs);
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
  font-size: var(--font-size-sm);
  padding: 2px;
}
.ann-close:hover { opacity: 1; }
</style>
