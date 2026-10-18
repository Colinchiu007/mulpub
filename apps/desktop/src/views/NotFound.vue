<template>
  <div class="not-found" data-testid="not-found" role="alert">
    <div class="not-found-code">404</div>
    <h1 class="not-found-title">{{ t('common.notFoundTitle') }}</h1>
    <p class="not-found-hint">
      {{ t('common.notFoundHint') }}
      <code v-if="attemptedPath" class="not-found-path" data-testid="not-found-path">{{ attemptedPath }}</code>
    </p>
    <div class="not-found-actions">
      <UiButton variant="primary" data-testid="not-found-home" @click="goHome">{{ t('common.notFoundHome') }}</UiButton>
      <UiButton variant="secondary" data-testid="not-found-back" @click="goBack">{{ t('common.notFoundBack') }}</UiButton>
    </div>
    <p class="not-found-footnote">{{ t('common.notFoundFootnote') }}</p>
  </div>
</template>

<script setup>
/**
 * 404 / 未知路由兜底视图（UX-AUDIT-2026-10-17 阶段 1.9 / audit-19 家族）
 *
 * 此前 router/index.js 没有 catch-all：访问 `#/typo` 时 router-view 匹配不到任何组件，
 * 结果是**一片空白且没有任何提示** —— 用户无法区分「应用坏了」与「地址写错了」，
 * 只能靠重启应用排障。本视图给出的可行动出口：回首页 / 返回上一页，
 * 并如实显示用户尝试访问的路径（不吞掉它，那是下一次反馈里唯一可归因的信息）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import UiButton from '@/components/UiButton.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// 只展示 hash 路由里用户实际打出的那一段，不回显 query（可能含标题等用户文本）
const attemptedPath = computed(() => String(route.path || ''))

function goHome () {
  router.replace('/')
}

function goBack () {
  if (window.history.length > 1) router.back()
  else router.replace('/')
}
</script>

<style scoped>
.not-found {
  max-width: 520px;
  margin: 64px auto;
  padding: 28px;
  text-align: center;
  border: 1px solid var(--color-border, #dcdfe6);
  border-radius: 12px;
  background: var(--color-bg-card, var(--surface, #fff));
}
.not-found-code {
  font-size: 40px;
  font-weight: 800;
  color: var(--color-text-muted, var(--text-muted, #8a8a8f));
  line-height: 1.1;
}
.not-found-title {
  margin: 8px 0 4px;
  font-size: var(--font-size-lg, 18px);
  color: var(--color-text-primary, var(--text, #1d1d1f));
}
.not-found-hint {
  margin: 0 0 18px;
  font-size: var(--font-size-sm, 14px);
  color: var(--color-text-muted, var(--text-muted, #6b6b70));
}
.not-found-path {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-container, #f2f2f4);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  word-break: break-all;
}
.not-found-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.not-found-footnote {
  margin: 16px 0 0;
  font-size: var(--font-size-xs, 12px);
  color: var(--color-text-muted, var(--text-muted, #8a8a8f));
}
</style>
