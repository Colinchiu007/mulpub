<template>
  <!-- 账号健康度（free 可见）：运营必需信息，不给足会让用户无法判断基本可用与否 -->
  <div class="cohere-card dash-extra-panel" data-testid="dashboard-account-health">
    <div class="dash-extra-title">
      <el-icon><UserFilled /></el-icon> {{ t('dashboard.accountHealthTitle') }}
    </div>
    <p v-if="accountHealth.state === 'auth'" class="dash-extra-note" data-testid="account-health-auth">
      {{ t('dashboard.loginGateHint') }}
    </p>
    <p v-else-if="accountHealth.state === 'error'" class="dash-extra-note" data-testid="account-health-error">
      {{ t('dashboard.accountHealthLoadFailed') }}
    </p>
    <p v-else-if="accountHealth.state === 'empty'" class="dash-extra-note" data-testid="account-health-empty">
      {{ t('dashboard.accountHealthEmpty') }}
    </p>
    <template v-else>
      <div class="dash-health-row">
        <span class="dash-health-chip ok">{{ t('dashboard.accountHealthOk', { count: accountHealth.ok }) }}</span>
        <span class="dash-health-chip bad">{{ t('dashboard.accountHealthBad', { count: accountHealth.bad }) }}</span>
        <span class="dash-health-chip unknown">{{ t('dashboard.accountHealthUnknown', { count: accountHealth.unknown }) }}</span>
      </div>
      <ul v-if="accountHealth.badAccounts.length > 0" class="dash-health-list">
        <li v-for="id in accountHealth.badAccounts" :key="id">{{ id }}</li>
        <li v-if="accountHealth.badOverflow > 0" class="dash-health-more">
          {{ t('dashboard.accountHealthMore', { count: accountHealth.badOverflow }) }}
        </li>
      </ul>
    </template>
  </div>

  <!-- 发布队列状态（free 可见） -->
  <div class="cohere-card dash-extra-panel" data-testid="dashboard-queue-status">
    <div class="dash-extra-title">
      <el-icon><Timer /></el-icon> {{ t('dashboard.queueTitle') }}
    </div>
    <p v-if="queue.state === 'auth'" class="dash-extra-note" data-testid="queue-auth">
      {{ t('dashboard.loginGateHint') }}
    </p>
    <p v-else-if="queue.state === 'error'" class="dash-extra-note" data-testid="queue-error">
      {{ t('dashboard.queueLoadFailed') }}
    </p>
    <template v-else>
      <div class="dash-health-row">
        <span class="dash-health-chip run">{{ t('dashboard.queueRunning', { count: queue.running }) }}</span>
        <span class="dash-health-chip pending">{{ t('dashboard.queuePending', { count: queue.pending }) }}</span>
        <span class="dash-health-chip bad">{{ t('dashboard.queueFailed', { count: queue.failed }) }}</span>
      </div>
      <p v-if="queue.state === 'empty'" class="dash-extra-note" data-testid="queue-empty">
        {{ t('dashboard.queueEmpty') }}
      </p>
      <ul v-if="queue.failedTitles.length > 0" class="dash-health-list">
        <li v-for="(title, i) in queue.failedTitles" :key="i">{{ title }}</li>
      </ul>
    </template>
  </div>

  <!-- 题材表现榜（full 专属）：未解锁渲染锁区块占位，不发请求、不显示假数据 -->
  <DashboardLockedPanel v-if="!hasFull" name="pattern" :title="t('dashboard.patternTitle')" @upgrade="$emit('upgrade')" />
  <div v-else class="cohere-card dash-extra-panel" data-testid="dashboard-pattern-board">
    <div class="dash-extra-title">
      <el-icon><TrendCharts /></el-icon> {{ t('dashboard.patternTitle') }}
    </div>
    <p v-if="patternBoard.state === 'auth'" class="dash-extra-note" data-testid="pattern-auth">
      {{ t('dashboard.loginGateHint') }}
    </p>
    <p v-else-if="patternBoard.state === 'error'" class="dash-extra-note" data-testid="pattern-error">
      {{ t('dashboard.patternLoadFailed') }}
    </p>
    <p v-else-if="patternBoard.state === 'empty'" class="dash-extra-note" data-testid="pattern-empty">
      {{ t('dashboard.patternEmpty') }}
    </p>
    <ol v-else class="dash-pattern-list">
      <li v-for="row in patternBoard.rows" :key="row.value" class="dash-pattern-row">
        <span class="dash-pattern-name">{{ row.value }}</span>
        <span class="dash-pattern-score">{{ row.score }}</span>
      </li>
    </ol>
  </div>
</template>

<script setup>
/**
 * 看板下方三个附加区块：账号健康度 / 发布队列 / 题材表现榜（dash-full-entitlement）。
 *
 * 为什么抽成独立组件：三个区块直接写在 Dashboard.vue 里会让该文件从 796 行膨胀
 * 222 行，触发「行数债务熔断」（`check-max-lines.js` 的 LEDGER_GREW，容差 200）。
 * 正解是拆分而不是 `--update` 抬高债务上限 —— 后者违反「债务只能缩小」的纪律。
 *
 * 样式**自包含**：`.cohere-card` 是全局的（cohere-design-system.css），但
 * `.dash-panel` / `.dash-panel-title` 定义在 Dashboard.vue 的 scoped 样式里、
 * 子组件拿不到，所以这里用自己的 `.dash-extra-*` 并复制等价的盒模型值，
 * 保证与父页面其它卡片在版式上一致。
 *
 * 三态纪律（empty / error / auth）必须分开：前两种界面上都表现为"空"但含义相反，
 * 混同会让用户把「功能坏了」读成「我还没发过东西」。
 */
import { UserFilled, Timer, TrendCharts } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import DashboardLockedPanel from './DashboardLockedPanel.vue'

defineProps({
  /** toAccountHealthModel() 的输出 */
  accountHealth: { type: Object, required: true },
  /** toQueueStatusModel() 的输出 */
  queue: { type: Object, required: true },
  /** toPatternBoardModel() 的输出 */
  patternBoard: { type: Object, required: true },
  /** 是否已解锁 dashboard_full */
  hasFull: { type: Boolean, required: true },
})

defineEmits(['upgrade'])

const { t } = useI18n()
</script>

<style scoped>
/* 卡片外观直接复用**全局** .cohere-card（它给 background: var(--canvas)、
 * border: 1px solid var(--border-light)、radius、padding，亮暗双档均由主题 token 驱动）。
 * 本类只补父页面 .dash-panel 的增量（cursor / 下间距 / 16px padding）。
 * ⚠️ 不要在这里自己写 background/border —— 那要猜 token 名，而 --color-bg-surface
 * 在本仓根本不存在，写错会 fallback 成白底、暗色主题下放出白卡片。 */
.dash-extra-panel {
  cursor: default;
  margin-bottom: var(--space-md);
  padding: 16px;
}
/* 等价于 .dash-panel-title */
.dash-extra-title {
  display: flex;
  align-items: center;
  gap: var(--space-xs, 6px);
  font-weight: 600;
  font-size: var(--font-size-base);
  margin-bottom: var(--space-md);
}
/* 等价于 .dash-panel-note */
.dash-extra-note {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
}
.dash-health-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
/* ⚠️ chip 底色/字色**不得**用 --lavender-light / --deep-purple：这两个是 Dashboard.vue
 * :global(:root) 里写死的**亮色值**，暗色主题下不切换 —— 结果是在暗色卡片里放出一块
 * 浅紫亮斑（对比度虽高，但视觉突兀）。改用「半透明主色叠色 + 语义文字色」：
 * 叠色在亮暗底上都自然过渡，且无需主题分支（scoped 内 [data-theme] 分支实测不可靠，
 * 见 TrialBanner.vue 的三轮注释）。实测对比度：亮 13.54:1 / 暗 11.23:1。
 * .ok/.bad/.unknown 用语义 token，tokens.css 亮暗双档均有定义，
 * 暗色实测 ok 8.09 / bad 5.34 / unknown 6.12，均 ≥ 3:1。 */
.dash-health-chip {
  padding: 2px 10px;
  border-radius: var(--radius-full, 9999px);
  font-size: var(--font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: rgba(124, 92, 191, .12);
  color: var(--color-text-primary);
}
.dash-health-chip.ok { background: rgba(16, 185, 129, .12); color: var(--color-success); }
.dash-health-chip.bad { background: rgba(239, 68, 68, .12); color: var(--color-danger); }
.dash-health-chip.unknown { background: var(--color-border); color: var(--color-text-secondary); }
.dash-health-chip.run { background: rgba(124, 92, 191, .12); color: var(--color-text-primary); }
.dash-health-chip.pending { background: rgba(124, 92, 191, .12); color: var(--color-text-primary); }
.dash-health-list {
  margin: 0;
  padding-left: 18px;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}
.dash-health-more {
  color: var(--color-text-secondary);
  list-style: none;
  margin-left: -18px;
}
.dash-pattern-list {
  margin: 0;
  padding-left: 20px;
}
.dash-pattern-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: 4px 0;
  font-size: var(--font-size-sm);
}
.dash-pattern-name { color: var(--color-text-primary); }
.dash-pattern-score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
}
</style>
