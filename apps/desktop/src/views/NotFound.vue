<template>
  <section class="not-found" data-testid="not-found-page" :aria-labelledby="headingId">
    <h1 :id="headingId" class="not-found__title">{{ t('common.notFoundTitle') }}</h1>
    <p class="not-found__desc">{{ t('common.notFoundMessage') }}</p>
    <p class="not-found__path">
      <span class="not-found__path-label">{{ t('common.notFoundPathLabel') }}</span>
      <code class="not-found__path-value" data-testid="not-found-path">{{ badPath }}</code>
    </p>
    <p class="not-found__hint">{{ t('common.notFoundHint') }}</p>
    <div class="not-found__actions">
      <button
        type="button"
        class="cohere-btn not-found__btn"
        data-testid="not-found-go-home"
        @click="goHome"
      >{{ t('common.notFoundBackHome') }}</button>
      <!-- 无处可退时不渲染，而不是渲染一个点了没反应的禁用按钮 -->
      <button
        v-if="canGoBack"
        type="button"
        class="cohere-btn not-found__btn"
        data-testid="not-found-go-back"
        @click="goBack"
      >{{ t('common.notFoundGoBack') }}</button>
    </div>
  </section>
</template>

<script setup>
/**
 * NotFound — 未知地址兜底页（UX 审计 1.9）
 *
 * 为什么需要它：`router/index.js` 原先没有 catch-all，任何解析不到记录的 hash 地址
 * 都让 `<router-view>` 渲染**空内容** —— 外壳还在、内容区什么都没有，用户会把它读成
 * 「应用卡死」，且没有任何提示告诉他「是这个地址不对」。
 *
 * 与「页面加载失败」（`common.pageLoadFailed` / `setRouteLoadError`）是两种故障：
 * 那种是 chunk 拉不到（有异常对象可显示），这种是地址根本不存在（只显示用户输入的路径）。
 * 因此本页**不**读取任何 error 对象，也不显示组件名/堆栈。
 *
 * 后退能力复用 `useSpaNavHistory`（本仓唯一实现）：它读 vue-router 写进
 * `window.history.state.position` 的栈索引。这里刻意不用 `window.history.length` ——
 * hash SPA 下它包含应用外条目，会把「栈首无处可退」读成「可后退」。
 */
import { computed, onBeforeUnmount, onMounted, useId } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSpaNavHistory } from '@/composables/useSpaNavHistory'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const headingId = useId()

const { canGoBack, attach, dispose } = useSpaNavHistory(router)

// 只回显用户输入的地址；route.name 恒为 'NotFound'，属于内部实现，不外露
const badPath = computed(() => route.fullPath || '/')

function goHome () {
  // replace 而非 push：兜底页不该留在历史里，否则用户从主页后退又撞回这个死胡同
  router.replace('/')
}

function goBack () {
  try {
    router.back()
  } catch (error) {
    console.warn('[not-found] goBack failed', error)
  }
}

onMounted(() => { attach() })
onBeforeUnmount(() => { dispose() })
</script>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-md);
  padding: var(--space-xxl);
  max-width: 720px;
}

.not-found__title {
  margin: 0;
  font-size: var(--font-size-xxl);
  font-weight: 600;
  color: var(--color-text-primary);
}

.not-found__desc {
  margin: 0;
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
}

.not-found__path {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-xs);
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.not-found__path-value {
  padding: 2px var(--space-xs);
  border-radius: var(--r-sm);
  background: var(--color-bg-inset);
  color: var(--color-text-primary);
  font-family: monospace;
  /* 长地址不得撑破布局：允许在任意字符处换行 */
  overflow-wrap: anywhere;
  word-break: break-all;
}

.not-found__hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.not-found__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}
</style>
