<template>
  <div
    v-if="visibleAnnouncements.length > 0"
    class="announcement-banners"
    role="region"
    :aria-label="t('announcement.regionLabel')"
  >
    <div
      v-for="a in visibleAnnouncements"
      :key="dismissKey(a)"
      class="announcement-banner"
      :class="'severity-' + severityOf(a)"
      role="alert"
    >
      <span class="ann-badge">{{ t(severityLabelKey(a)) }}</span>
      <div class="ann-body">
        <div class="ann-title">{{ a.title }}</div>
        <div v-if="a.content" class="ann-content">{{ a.content }}</div>
      </div>
      <button
        v-if="severityOf(a) !== 'maintenance'"
        class="ann-close"
        :aria-label="t('announcement.closeLabel')"
        @click="dismiss(a)"
      >✕</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOpsCenterRuntime, SEVERITIES } from '@/composables/useOpsCenterRuntime'

const { t } = useI18n()
const { announcements, loadRuntime } = useOpsCenterRuntime()
const DISMISSED_STORAGE_KEY = 'announcement-banner-dismissed'
// 声明顺序刻意排在上面这次调用之前：`<script setup>` 现在会把字面量 const 提升到 setup 之外
// （实测 `@vue/compiler-sfc` 生成的产物里它已在 `setup()` 上方，所以旧顺序不会 TDZ），
// 但那是编译器优化不是语言保证——把值换成非静态表达式就会落回 setup 内，
// 而 readDismissed() 的 try/catch 会把 ReferenceError 吞成「什么都没关过」。
const dismissedKeys = ref(readDismissed())

const visibleAnnouncements = computed(() =>
  (announcements.value || []).filter((a) => !dismissedKeys.value.has(dismissKey(a)))
)

// 分档只认闭合词表里的机器值；未知或缺失一律落 info。
// 这里刻意**不**丢弃整条：公告是"运营要让用户看到"的东西，
// 分档失败可以降级样式，不可以降级成"看不见"。
function severityOf (a) {
  return SEVERITIES.includes(a && a.severity) ? a.severity : 'info'
}

function severityLabelKey (a) {
  return 'announcement.severity.' + severityOf(a)
}

// 记忆键必须能归因到"具体一条"。优先后端稳定 id；
// 旧数据无 id 时降级为内容摘要，**不得**用数组下标——新公告插到前面会让
// 已关闭的那条复活、且无辜的新那条消失（两个方向同时错）。
// id=0 是合法 id，所以判存在用 `!= null` 而不是真值。
function dismissKey (a) {
  if (!a) return 'invalid'
  const id = a.id
  if (id !== undefined && id !== null && id !== '') return 'id:' + id
  return (severityOf(a)) + ':' + (a.title || '') + ':' + (a.content || '')
}

function dismiss (a) {
  dismissedKeys.value = new Set([...dismissedKeys.value, dismissKey(a)])
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...dismissedKeys.value]))
  } catch (_) {
    // 存储不可用（隐私模式 / 配额）只影响"下次还记得吗"，不影响本次可见性
  }
}

function readDismissed () {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch (_) {
    // 坏 JSON 必须回落"都没关过"，不能让整块公告消失（读失败不是"用户关掉了全部"）
    return new Set()
  }
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
