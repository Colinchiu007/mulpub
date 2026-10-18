<template>
  <svg
    class="sidebar-toggle-icon"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M6.4 4.2 2.6 8l3.8 3.8"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M9.6 4.2 13.4 8l-3.8 3.8"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup>
/**
 * 侧边栏折叠按钮图标：左右向的双 chevron（视觉上就是「<>」）。
 *
 * 为什么内联 SVG 而不引 UI 图标库：按钮位于 TabBar（每次进页面都会渲染的高频壳层），
 * 且 Element Plus 图标库缺这个「双向」语义；内联 2 条 path 无额外包体、无运行期依赖。
 * 几何取自 Lucide 的 chevron-left / chevron-right（MIT/ISC 许可，见
 * apps/desktop/THIRD-PARTY-NOTICES.md），16×16 viewBox，currentColor 跟随主题。
 */
</script>
