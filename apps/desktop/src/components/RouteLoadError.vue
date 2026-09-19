<template>
  <section class="route-load-error" data-testid="route-load-error" role="alert">
    <div class="route-load-error-icon" aria-hidden="true">!</div>
    <div class="route-load-error-content">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <p v-if="details" class="route-load-error-details">{{ details }}</p>
      <div class="route-load-error-actions">
        <button type="button" class="btn-primary" data-testid="route-load-retry" @click="$emit('retry')">{{ retryLabel }}</button>
        <button type="button" class="btn-secondary" data-testid="route-load-refresh" @click="$emit('refresh')">{{ refreshLabel }}</button>
      </div>
    </div>
  </section>
</template>

<script>
export default {
  name: 'RouteLoadError',
  emits: ['retry', 'refresh'],
  props: {
    title: { type: String, default: '页面加载失败' },
    message: { type: String, default: '页面资源没有成功加载，请重试。' },
    details: { type: String, default: '' },
    retryLabel: { type: String, default: '重试' },
    refreshLabel: { type: String, default: '刷新应用' },
  },
}
</script>

<style scoped>
.route-load-error {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  max-width: 720px;
  margin: 48px auto;
  padding: 24px;
  border: 1px solid #f0c7c7;
  border-radius: 12px;
  background: #fff8f8;
  color: #4a1d1d;
}
.route-load-error-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #c0392b;
  color: #fff;
  font-weight: 700;
}
.route-load-error-content { min-width: 0; }
.route-load-error h2 { margin: 0 0 8px; font-size: 18px; }
.route-load-error p { margin: 0 0 8px; line-height: 1.6; }
.route-load-error-details { color: #7b4a4a; font-size: 12px; word-break: break-word; }
.route-load-error-actions { display: flex; gap: 8px; margin-top: 16px; }
.btn-primary, .btn-secondary { border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; }
.btn-primary { background: #2563eb; color: #fff; }
.btn-secondary { background: #eef2f7; color: #1f2937; }
</style>
