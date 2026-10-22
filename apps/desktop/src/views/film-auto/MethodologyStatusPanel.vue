<script setup>
/**
 * 方法论接入状态（**只读**，F-I）。
 *
 * 回答用户的一个问题：「我的自动分镜到底接上了多少方法论」。
 * 数据由主进程的**唯一一份**汇总实现产出（`buildMethodologySummary`）——
 * 规划结果与「重开项目的项目投影」都用它 ⇒ 渲染端**不另写实现**（两份实现必然漂移，
 * 漂移会让「面板显示的接上量」与「落盘的清单」对不上）。
 *
 * ⚠ 拆成子组件的动因：本仓 `check-max-lines.js` 的 `NEW_OVER_LIMIT`（单文件 ≤ 500 行）。
 *   父组件保留**数据源**（`methodology` 计算属性）与**外层卡片**（`fa-card` 样式是父组件的 scoped）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

// 阻断原因的 i18n 映射（key 必须是字面量，locale 扫描才认）
const METHODOLOGY_REASON_KEY = Object.freeze({
  byDesign: 'filmEngineering.auto.methodologyReasonByDesign',
  assetMissing: 'filmEngineering.auto.methodologyReasonAssetMissing',
  templateVar: 'filmEngineering.auto.methodologyReasonTemplateVar',
  badVarName: 'filmEngineering.auto.methodologyReasonBadVarName',
  oversizeVar: 'filmEngineering.auto.methodologyReasonOversizeVar',
})

const props = defineProps({
  /** 主进程汇总出的方法论接入状态（只读） */
  methodology: { type: Object, required: true },
})

const { t } = useI18n()

/**
 * 「不可直送」的聚合提示**按阻断原因分流**（第 9 轮 i7）。
 *
 * - 只要还有 **assetMissing**（真·资产缺口）⇒ 该提示**必须**说「或补齐对应资产」
 *   （第 7 轮 i7 把它整句删掉，是**矫枉过正** —— 对 assetMissing 的用户，
 *   「补资产」正是正解，删掉反而误导）；
 * - 只剩 **byDesign**（该变量本就没有资产源）⇒ 只说「人工补齐」，
 *   提「补资产」会把用户引到一个**不存在的修复动作**上。
 */
const notDeliverableKey = computed(() => {
  const m = props.methodology
  const blocked = (m && Array.isArray(m.blockedVars)) ? m.blockedVars : []
  const hasAssetGap = blocked.some(b => b && b.reason === 'assetMissing')
  return hasAssetGap
    ? 'filmEngineering.auto.methodologyNotDeliverableAssets'
    : 'filmEngineering.auto.methodologyNotDeliverable'
})
</script>

<template>
      <div class="fa-methodology" data-testid="fa-methodology">
        <div class="fa-label">{{ t('filmEngineering.auto.methodology') }}</div>
        <div><dt>{{ t('filmEngineering.auto.methodologyTask') }}</dt><dd data-testid="fa-methodology-task">{{ methodology.taskAvailable === false ? t('filmEngineering.auto.methodologyNoLibrary') : methodology.taskId }}</dd></div>
        <div><dt>{{ t('filmEngineering.auto.methodologyHit') }}</dt><dd data-testid="fa-methodology-hit">{{ methodology.hitVars }}/{{ methodology.totalVars }}</dd></div>
        <div v-if="methodology.blockedVars && methodology.blockedVars.length">
          <dt>{{ t('filmEngineering.auto.methodologyBlocked') }}</dt>
          <dd data-testid="fa-methodology-blocked"><span v-for="b in methodology.blockedVars" :key="b.name" class="fa-methodology-blocked-item">{{ b.name }}（{{ t(METHODOLOGY_REASON_KEY[b.reason] || METHODOLOGY_REASON_KEY.assetMissing) }}）</span></dd>
        </div>
        <div v-if="methodology.deliverable === false">
          <dt>{{ t('filmEngineering.auto.methodologyDeliverable') }}</dt>
          <dd data-testid="fa-methodology-not-deliverable">{{ t(notDeliverableKey) }}</dd>
        </div>
        <div v-if="methodology.assetsIncomplete && !methodology.stale">
          <dt>{{ t('filmEngineering.auto.methodologyAssets') }}</dt>
          <dd data-testid="fa-methodology-assets-incomplete">{{ t('filmEngineering.auto.methodologyAssetsIncomplete') }}</dd>
        </div>
        <div v-if="methodology.frameConstraintPending">
          <dt>{{ t('filmEngineering.auto.methodologyFrame') }}</dt>
          <dd data-testid="fa-methodology-frame-pending">{{ t('filmEngineering.auto.methodologyFramePending') }}</dd>
        </div>
        <!-- 区块级警告（不是一行字段）：kit 已被替换 ⇒ 整块状态已过期（第 12 轮 i6） -->
        <div v-if="methodology.stale" class="fa-methodology-stale" data-testid="fa-methodology-stale">
          {{ t('filmEngineering.auto.methodologyStale') }}
        </div>
        <!-- 区块级警告：清单被闸门截断 ⇒ 还有未显示的未接入变量（第 17 轮 i7） -->
        <div v-if="methodology.truncated" class="fa-methodology-stale" data-testid="fa-methodology-truncated">
          {{ t('filmEngineering.auto.methodologyTruncated') }}
        </div>
        <div><dt>{{ t('filmEngineering.auto.methodologyAssetHash') }}</dt><dd>{{ String(methodology.promptAssetHash || '').slice(0, 8) }}</dd></div>
      </div>
</template>

<style scoped src="./methodology-status-panel.css"></style>
