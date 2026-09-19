<template>
  <Transition name="htcl-fade">
    <div
      v-if="visible"
      class="htcl-overlay"
      data-testid="hot-topics-central-loading"
      role="status"
      aria-live="polite"
    >
      <div class="htcl-card">
        <div class="htcl-spinner" aria-hidden="true"></div>
        <div class="htcl-title">
          {{ title }}<span class="htcl-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        </div>
        <div class="htcl-desc">{{ description }}</div>
        <div class="htcl-bar" aria-hidden="true"><span></span></div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
})
</script>

<style scoped>
/* 全屏半透明遮罩 + 居中动效卡片（非弹窗）。z-index 1001：高于应用内模态（UpgradeModal 等 z-1000） */
.htcl-overlay {
  position: fixed; inset: 0; z-index: 1001;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(2px);
}
.htcl-card {
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  padding: 36px 48px; background: #fff;
  border: 1px solid #e9e8f6; border-radius: 16px;
  box-shadow: 0 12px 40px rgba(81, 73, 232, 0.14);
  max-width: 460px; text-align: center;
}
.htcl-spinner {
  width: 42px; height: 42px; border-radius: 50%;
  border: 4px solid #eceafb; border-top-color: #5149e8;
  animation: htcl-spin 0.9s linear infinite;
}
.htcl-title {
  font-size: 17px; font-weight: 700; color: #333;
  display: flex; align-items: baseline; gap: 2px;
}
.htcl-desc { font-size: 13px; color: #777; line-height: 1.6; }
/* 流光进度条（渐变光带循环扫过） */
.htcl-bar {
  width: 240px; height: 6px; border-radius: 3px;
  background: #f0efff; overflow: hidden; position: relative;
}
.htcl-bar span {
  position: absolute; top: 0; left: 0; height: 100%; width: 40%;
  border-radius: 3px; background: linear-gradient(90deg, #5149e8, #8b83ff);
  animation: htcl-bar-sweep 1.4s ease-in-out infinite;
}
/* 跳动省略号 */
.htcl-dots { display: inline-flex; gap: 4px; margin-left: 4px; }
.htcl-dots span {
  width: 5px; height: 5px; border-radius: 50%; background: #5149e8;
  display: inline-block; animation: htcl-dot-bounce 1.2s ease-in-out infinite;
}
.htcl-dots span:nth-child(2) { animation-delay: 0.15s; }
.htcl-dots span:nth-child(3) { animation-delay: 0.3s; }
@media (prefers-reduced-motion: reduce) {
  .htcl-spinner { animation-duration: 2s; }
  .htcl-bar span { animation-duration: 3s; }
  .htcl-dots span { animation: none; }
}
/* keyframes 带 htcl- 前缀：scoped 不隔离 @keyframes 名，防跨组件冲突 */
@keyframes htcl-spin { to { transform: rotate(360deg); } }
@keyframes htcl-bar-sweep {
  0% { left: -40%; }
  100% { left: 100%; }
}
@keyframes htcl-dot-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-5px); opacity: 1; }
}
/* 淡入淡出 */
.htcl-fade-enter-active, .htcl-fade-leave-active { transition: opacity 0.25s ease; }
.htcl-fade-enter-from, .htcl-fade-leave-to { opacity: 0; }
</style>
