<template>
  <div v-if="showBanner" class="trial-banner" :class="type">
    <div class="banner-content">
      <span v-if="isTrial" class="banner-icon">🎁</span>
      <span v-else class="banner-icon">🔒</span>
      <div class="banner-text">
        <template v-if="isTrial">
          试用期还剩 <strong>{{ daysRemaining }}</strong> 天，<strong>{{ daysRemaining }}</strong> 天后恢复免费版功能
        </template>
        <template v-else>
          当前为免费版，部分功能受限
        </template>
      </div>
      <button class="banner-btn" @click="$emit('upgrade')">
        {{ isTrial ? '立即购买' : '升级 Pro' }}
      </button>
      <button class="banner-close" @click="$emit('dismiss')">✕</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue"
import { useLicenseStore } from "@/stores/license"

const props = defineProps({
  dismissed: { type: Boolean, default: false },
})

defineEmits(["upgrade", "dismiss"])

const store = useLicenseStore()

const isTrial = computed(() => store.isTrial)
const isFree = computed(() => store.isFree)
const daysRemaining = computed(() => store.daysRemaining)
const showBanner = computed(() => (isTrial.value || isFree.value) && !props.dismissed)
const type = computed(() => isTrial.value ? "trial" : "free")
</script>

<style scoped>
/* 视觉精致化（2026-10-16）：与同项目 LoginExpiredBanner.vue 的横幅范式对齐 ——
 * 图标装进圆角色块、文字加 min-width:0 防溢出、按钮改描边式（hover 实底化），
 * 一改此前「裸 emoji + 实心小红按钮」的粗糙观感。
 * 类名保持不变：TrialBanner.test.js / more-tests.test.js 依赖 .trial-banner /
 * .banner-btn / .banner-close，contrast-probe.js 以 .banner-text 为探针，
 * tokens.css:365 另有 html[data-theme='dark'] .banner-btn 的暗色底覆盖。 */
.trial-banner {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  margin-bottom: var(--space-lg);
  border: 1px solid transparent;
}
.trial-banner.trial {
  /* #fef3c7 / #fbbf24 与 tokens --color-warning-soft / --color-warning 同值 */
  background: var(--color-warning-soft);
  border-color: var(--color-warning);
}
/* free 档保留原浅紫（#f3f0ff / #c4b5fd）：tokens 无对应紫槽，
 * --color-primary-light 亮色值是 #eff6fb（浅蓝），换过去会引入与需求无关的色相回归。 */
.trial-banner.free {
  background: #f3f0ff;
  border-color: #c4b5fd;
}

/* 深色模式覆盖（P4 2026-10-08）：.trial-banner.free 的 #f3f0ff 硬编码浅紫底
 * 暗色下不变，与 var(--text-primary)（暗色 #e8e8ed 浅字）组合成 1.09:1
 * 「浅字压浅底」（实测见研究方案 §3.3/§8）。暗色改用品牌紫半透明底 +
 * 暗色文字，与 tokens.css --color-primary-light 暗色变体同口径。 */
[data-theme='dark'] .trial-banner.free {
  background: rgba(123, 116, 255, .18);
  border-color: #7b74ff;
}
[data-theme='dark'] .banner-text {
  color: var(--color-text-primary);
}
[data-theme='dark'] .banner-icon {
  color: var(--color-text-primary);
}
.banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
}
/* 图标色块：emoji 装进圆角底块，避免裸 emoji 与文字基线错位 */
.banner-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base, 15px);
  line-height: 1;
  background: var(--color-canvas-translucent, rgba(255, 255, 255, .95));
}
.trial-banner.trial .banner-icon {
  background: rgba(251, 191, 36, .22);
}
.trial-banner.free .banner-icon {
  background: rgba(124, 92, 191, .14);
}
[data-theme='dark'] .banner-icon {
  background: rgba(255, 255, 255, .08);
}
/* min-width:0 是 flex 子项的必需项：缺了它，长文案不会收缩而是把容器撑破 */
.banner-text {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--color-text-primary);
}
.banner-text :deep(strong) {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* 描边式按钮：与底色同系描边，hover 实底化（对齐 LoginExpiredBanner 的成熟写法） */
.banner-btn {
  flex: 0 0 auto;
  padding: 6px 14px;
  border: 1px solid var(--coral, #f56c6c);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--coral, #f56c6c);
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}
.banner-btn:hover {
  background: var(--coral, #f56c6c);
  color: var(--color-on-primary, #fff);
}
.banner-close {
  flex: 0 0 auto;
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted, var(--muted));
  padding: 4px;
  border-radius: var(--radius-sm);
  line-height: 1;
  transition: background 0.15s ease, color 0.15s ease;
}
.banner-close:hover {
  background: rgba(0, 0, 0, .06);
  color: var(--color-text-primary);
}
[data-theme='dark'] .banner-close:hover {
  background: rgba(255, 255, 255, .1);
}

/* 窄屏兜底：按钮与关闭键换行，避免挤压正文 */
@media (max-width: 640px) {
  .banner-content {
    flex-wrap: wrap;
  }
  .banner-text {
    flex-basis: 100%;
    order: 3;
  }
}
</style>
