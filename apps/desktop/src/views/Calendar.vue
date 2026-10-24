<template>
  <div>
    <div class="cohere-page-header">
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
        <div>
          <div class="page-title">📅 发布日历</div>
          <div class="page-subtitle">可视化内容排期与发布历史</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="cohere-btn-secondary" @click="prevMonth">◀</button>
          <span style="font-weight:600;font-size: var(--font-size-base);min-width:140px;text-align:center">{{ currentMonthLabel }}</span>
          <button class="cohere-btn-secondary" @click="nextMonth">▶</button>
          <button class="cohere-btn-secondary" @click="today" style="margin-left:8px">今天</button>
        </div>
      </div>
    </div>

    <div class="cohere-content" style="display:flex;gap:var(--space-md)">
      <!-- 日历网格 -->
      <div style="flex:2;min-width:0">
        <div class="calendar-grid">
          <div class="cal-header" v-for="d in dayNames" :key="d">{{ d }}</div>
          <div role="button" tabindex="0" @keydown.enter.prevent="selectDay(day)" @keydown.space.prevent="selectDay(day)"
            v-for="(day, i) in calendarDays"
            :key="i"
            class="cal-day"
            :class="{
              'other-month': !day.isCurrentMonth,
              'today': day.isToday,
              'selected': selectedDate === day.dateStr,
              'has-event': day.events.length > 0,
            }"
            @click="selectDay(day)"
          >
            <span class="cal-day-num">{{ day.day }}</span>
            <div class="cal-day-events">
              <div
                v-for="e in day.events.slice(0, 3)"
                :key="e.id"
                class="cal-event-dot"
                :class="e.type"
                :title="e.title"
              ></div>
              <span v-if="day.events.length > 3" class="cal-event-more">+{{ day.events.length - 3 }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 详情面板 -->
      <div style="flex:1;min-width:280px">
        <div class="cohere-card" style="cursor:default;padding:16px">
          <div style="font-weight:600;font-size: var(--font-size-sm);margin-bottom:var(--space-md)">
            {{ selectedDateLabel || '选择日期查看详情' }}
          </div>

          <div v-if="!selectedDayEvents || selectedDayEvents.length === 0" style="text-align:center;padding:20px;color:var(--muted);font-size: var(--font-size-sm)">
            该日期暂无发布记录
          </div>

          <div v-else class="day-events">
            <div v-for="e in selectedDayEvents" :key="e.id" class="day-event-item" :class="e.type">
              <div class="event-time">{{ formatEventTime(e) }}</div>
              <div class="event-content">
                <span class="event-status">{{ e.type === 'scheduled' ? '⏰' : e.success !== false ? '✅' : '❌' }}</span>
                <span class="event-title">{{ e.title || e.article?.title || '(无标题)' }}</span>
              </div>
              <div class="event-platform">{{ e.platform }}</div>
              <!-- 定时任务取消入口（P2 修复）：此前唯一取消路径是发布页会话内的
                   cancelPublish（activeScheduleIds 内存态），离开页面即丢，用户排期后
                   无法从任何 UI 取消。pending 状态才可取消（executed 已进历史、
                   cancelled 不可再取消、dispatching 认领中取消会失败）。 -->
              <button
                v-if="e.type === 'scheduled' && e.id && isPendingSchedule(e)"
                class="cohere-btn-secondary event-cancel-btn"
                :data-testid="'cancel-schedule-' + e.id"
                :disabled="cancellingId === e.id"
                @click.stop="cancelSchedule(e)"
              >{{ t('calendarPage.cancelSchedule') }}</button>
              <!-- 批量排期取消入口（2026-10-06）：批次排期此前只能在发布页会话内
                   取消（scheduledBatchId 内存态），离开页面即无法取消。 -->
              <button
                v-if="e.type === 'scheduled-batch' && e.id"
                class="cohere-btn-secondary event-cancel-btn"
                :data-testid="'cancel-schedule-batch-' + e.id"
                :disabled="cancellingBatchId === e.id"
                @click.stop="cancelScheduledBatch(e)"
              >{{ t('calendarPage.cancelSchedule') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue"
import { getApi } from '@/api/electron-bridge'
import { usePlatformStore } from "@/stores/platforms"
import i18n from '@/i18n'
import { useNotify } from '@/composables/useNotify'
import { useScheduledBatches } from '@/composables/useScheduledBatches'
// 日期/时间解析纯函数已抽出：其中「YYYY-MM-DD 是日期键而非 UTC 时刻」与
// 「非法输入返回空串而不是回退到今天」两条语义必须原样保留，详见模块头注释。
import {
  formatCalendarDatePart,
  parseCalendarDate,
  toCalendarDateKey,
  toCalendarTime,
  calendarTimestamp,
} from '@/features/publish/calendar-date-utils'

const platformStore = usePlatformStore()
platformStore.load()
// eslint-disable-next-line no-unused-vars
function platformName(id) { return platformStore.getLabel(id) || id }

const { notifyConfirm, notifySuccess, notifyError } = useNotify()

// Calendar 页新增用户可见文案一律走 locales（zh/en 成对，CI 基线扫描拦截
// 渲染端非 locales 文件新增中文字符串字面量）；页面既有硬编码文案不在本次范围。
function t(key) { return i18n.global.t(key) }

// 批量排期的数据源与取消动作已拆至 composable（逐文件行数门禁）：
// 批次筛选 / 最早定时时间计算 / 取消流程与日历日期渲染无关，混在一起会让视图文件膨胀。
// loadData 为函数声明（提升），composable 仅在调用时引用它，无初始化顺序问题。
const { cancellingBatchId, batchEventsForDate, loadBatches, cancelScheduledBatch } =
  useScheduledBatches({ loadData, notifyError, notifySuccess, notifyConfirm, t })

const now = new Date()
const currentYear = ref(now.getFullYear())
const currentMonth = ref(now.getMonth())
const selectedDate = ref(null)
const scheduledTasks = ref([])
const publishHistory = ref([])
const loading = ref(false)

const dayNames = ["日", "一", "二", "三", "四", "五", "六"]

const currentMonthLabel = computed(() => {
  return currentYear.value + " 年 " + (currentMonth.value + 1) + " 月"
})

const calendarDays = computed(() => {
  const year = currentYear.value
  const month = currentMonth.value
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()
  const todayStr = toCalendarDateKey(new Date())

  const days = []

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i
    const dateStr = toCalendarDateKey(new Date(year, month - 1, d))
    days.push({ day: d, dateStr, isCurrentMonth: false, isToday: dateStr === todayStr, events: getEventsForDate(dateStr) })
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = toCalendarDateKey(new Date(year, month, d))
    days.push({ day: d, dateStr, isCurrentMonth: true, isToday: dateStr === todayStr, events: getEventsForDate(dateStr) })
  }

  // Next month days to fill grid
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const dateStr = toCalendarDateKey(new Date(year, month + 1, d))
    days.push({ day: d, dateStr, isCurrentMonth: false, isToday: dateStr === todayStr, events: getEventsForDate(dateStr) })
  }

  return days
})

const selectedDayEvents = computed(() => {
  if (!selectedDate.value) return []
  return getEventsForDate(selectedDate.value)
})

const selectedDateLabel = computed(() => {
  if (!selectedDate.value) return ""
  return selectedDate.value.replace(/-/g, "/")
})

function getEventsForDate(dateStr) {
  const events = []
  // Add scheduled tasks
  // 状态过滤（P2 修复）：只有 pending/dispatching（及无 status 的历史数据）才是
  // 「待发」事件；executed/failed 已由发布历史承载（✅/❌），cancelled 不该再
  // 显示为 ⏰ 待发布——否则用户看到已取消的任务以为它还会发。
  for (const t of scheduledTasks.value) {
    if (!t.publishTime || toCalendarDateKey(t.publishTime) !== dateStr) continue
    if (t.status && !isPendingSchedule(t) && t.status !== 'dispatching') continue
    events.push({ ...t, type: "scheduled" })
  }
  // Add history
  for (const r of publishHistory.value) {
    if (r.timestamp && toCalendarDateKey(r.timestamp) === dateStr) {
      events.push({ ...r, type: r.success !== false ? "success" : "failed" })
    }
  }
  // 批量排期批次（2026-10-06 拆入 useScheduledBatches）：此前唯一取消入口是发布页会话内的
  // scheduledBatchId（内存态），离开页面即丢，日历又只渲染 scheduler:* 任务 → 批次排期无法取消。
  events.push(...batchEventsForDate(dateStr, toCalendarDateKey))
  return events.sort((a, b) => calendarTimestamp(a.publishTime || a.timestamp) - calendarTimestamp(b.publishTime || a.timestamp))
}

// pending / 无 status（历史 JSONL 数据）视为可取消的待发排期。
// dispatching 是派发中的瞬态（认领窗口极短，且 scheduler.cancel 只认 pending），
// 显示为待发事件但不给取消按钮；executed/failed 已进发布历史；cancelled 不可再取消。
function isPendingSchedule(task) {
  const status = task && task.status
  return !status || status === 'pending'
}

function formatEventTime(e) {
  const t = e.publishTime || e.timestamp
  if (!t) return ""
  return toCalendarTime(t)
}

function selectDay(day) {
  selectedDate.value = day.dateStr
}

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value--
  } else {
    currentMonth.value--
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value++
  } else {
    currentMonth.value++
  }
}

function today() {
  const t = new Date()
  currentYear.value = t.getFullYear()
  currentMonth.value = t.getMonth()
  selectedDate.value = toCalendarDateKey(t)
}

async function loadData() {
  loading.value = true
  const api = getApi()
  try {
    if (api) {
      if (api.schedulerList) {
        const sRes = await api.schedulerList()
        if (sRes && sRes.code === 0) scheduledTasks.value = sRes.data || []
      }
      await loadBatches()
      if (api.historyList) {
        const hRes = await api.historyList({ limit: 500 })
        if (hRes && hRes.code === 0) publishHistory.value = (hRes.data && hRes.data.records) || []
      }
    }
  // eslint-disable-next-line no-unused-vars
  } catch (e) { /* ignore */ }
  finally { loading.value = false }
}

// ── 定时任务取消（P2 修复：排期管理闭环）──────────────────────────────
// 此前唯一取消路径是发布页会话内的 cancelPublish（activeScheduleIds 内存态），
// 离开页面即丢。这里补上持久入口：日历 → 待发事件 → 取消按钮 → schedulerCancel。
const cancellingId = ref(null)

async function cancelSchedule(event) {
  if (!event || event.type !== 'scheduled' || !event.id) return
  if (cancellingId.value) return
  const confirmed = await notifyConfirm('calendarPage.cancelScheduleConfirm', {
    title: t('calendarPage.cancelScheduleTitle'),
    confirmButtonText: t('calendarPage.cancelScheduleConfirmButton'),
    cancelButtonText: t('calendarPage.cancelScheduleCancelButton'),
    type: 'warning',
  })
  if (!confirmed) return
  cancellingId.value = event.id
  try {
    const api = getApi()
    if (!api || typeof api.schedulerCancel !== 'function') {
      notifyError('calendarPage.cancelScheduleFailed', { fallback: t('calendarPage.cancelScheduleFailed') })
      return
    }
    const res = await api.schedulerCancel(event.id)
    if (!res || res.code !== 0) {
      notifyError('calendarPage.cancelScheduleFailed', { fallback: t('calendarPage.cancelScheduleFailed') })
      return
    }
    // P0 修复后此分支首次可达：主进程如实回传 data=false 表示「没取消掉」
    // （任务不存在 / 已 executed / 已 cancelled）。重试无意义，须区分文案，
    // 否则用户会反复点一个注定失败的重试按钮。
    if (res.data === false) {
      notifyError('calendarPage.scheduleCancelledUncancellable', { fallback: t('calendarPage.scheduleCancelledUncancellable') })
      await loadData()
      return
    }
    notifySuccess('calendarPage.cancelScheduleSuccess')
    await loadData()
  // eslint-disable-next-line no-unused-vars
  } catch (e) {
    notifyError('calendarPage.cancelScheduleFailed', { fallback: t('calendarPage.cancelScheduleFailed') })
  } finally {
    cancellingId.value = null
  }
}

// ── 定时派发失败实时提示（2026-10-06）─────────────────────────────
// 定时任务到点后若入队失败（队列未配置 / 租户隔离入队被拒 / 认领写盘失败），
// 主进程此前只写日志：状态落为 failed，但既无提示也进不了发布历史，
// 用户完全无从得知「排的定时任务没发出去」。这里接收主进程推送并即时提示 + 刷新。
let stopDispatchFailedListener = null

function handleDispatchFailed(failure) {
  notifyError('calendarPage.scheduleDispatchFailed', {
    fallback: t('calendarPage.scheduleDispatchFailed'),
    params: {
      platform: failure && failure.platform ? failure.platform : '',
      reason: failure && failure.reason ? failure.reason : '',
    },
  })
  loadData()
}

onMounted(() => {
  loadData()
  selectedDate.value = toCalendarDateKey(new Date())

  const api = getApi()
  if (api && typeof api.onSchedulerDispatchFailed === 'function') {
    stopDispatchFailedListener = api.onSchedulerDispatchFailed(handleDispatchFailed)
  }
})

onBeforeUnmount(() => {
  if (typeof stopDispatchFailedListener === 'function') {
    try { stopDispatchFailedListener() } catch (e) { /* ignore */ }
  }
  stopDispatchFailedListener = null
})
</script>

<style scoped>
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.cal-header {
  padding: 10px 4px;
  text-align: center;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--muted);
  background: var(--soft-stone, #f8f8f8);
  border-bottom: 1px solid var(--border);
}
.cal-day {
  min-height: 80px;
  padding: 6px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  position: relative;
  transition: background 0.1s;
}
.cal-day:nth-child(7n) { border-right: none; }
.cal-day:hover { background: var(--soft-stone, #f5f5f5); }
.cal-day.other-month { opacity: 0.3; }
.cal-day.today .cal-day-num {
  background: var(--coral, #f56c6c);
  color: #fff;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cal-day.selected { background: #fef2f2; }
.cal-day.has-event .cal-day-num::after {
  content: "";
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--coral);
}
.cal-day-num {
  font-size: var(--font-size-sm);
  font-weight: 500;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.cal-day-events {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: 4px;
  padding: 0 2px;
}
.cal-event-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.cal-event-dot.scheduled { background: #fbbf24; }
.cal-event-dot.success { background: #34d399; }
.cal-event-dot.failed { background: #f87171; }
.cal-event-more {
  font-size: var(--font-size-xs);
  color: var(--muted);
}
.day-events {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.day-event-item {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: var(--font-size-sm);
}
.day-event-item.scheduled { border-left: 3px solid #fbbf24; }
.day-event-item.success { border-left: 3px solid #34d399; }
.day-event-item.failed { border-left: 3px solid #f87171; }
.event-time {
  font-size: var(--font-size-xs);
  color: var(--muted);
  margin-bottom: 2px;
}
.event-content {
  display: flex;
  align-items: center;
  gap: 4px;
}
.event-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.event-platform {
  font-size: var(--font-size-xs);
  color: var(--muted);
  margin-top: 2px;
}
.event-cancel-btn {
  margin-top: 6px;
  padding: 2px 10px;
  font-size: var(--font-size-xs);
}
</style>
