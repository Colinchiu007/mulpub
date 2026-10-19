<template>
  <svg
    class="sidebar-toggle-icon"
    viewBox="0 0 18 18"
    width="18"
    height="18"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <!--
      左缘竖矩形 = 「侧栏面板」这个对象本身。
      展开态实心、收起态虚线：两种状态的外轮廓**完全一致**，只换内部填充，
      用户感知到的是「同一个按钮换了内部状态」，而不是「换了个东西」。
    -->
    <rect
      v-if="!collapsed"
      x="2"
      y="3.5"
      width="6.5"
      height="11"
      rx="1.8"
      fill="currentColor"
    />
    <rect
      v-else
      x="2"
      y="3.5"
      width="6.5"
      height="11"
      rx="1.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-dasharray="2.2 1.6"
    />

    <!--
      箭头方向 = 「点击后侧栏往哪去」：
      展开态朝左（点了侧栏收去左边），收起态朝右（点了侧栏回到左边）。
    -->
    <path
      :d="collapsed ? 'M11.2 5.9 14.4 9l-3.2 3.1' : 'M14.4 5.9 11.2 9l3.2 3.1'"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup>
/**
 * 侧边栏折叠按钮图标：「左侧面板矩形 + 方向箭头」。
 *
 * 为什么不用双向 chevron（「<>」，sidebar-collapse-toggle 的初版做法）：
 *  - 在通行图标语义里 `<>` 读作「代码」或「展开更多」，与「收起侧栏」无关；
 *  - 初版两态共用同一图形，状态差异只落在颜色上 —— 颜色是单通道，
 *    对色觉障碍用户完全失效，也让普通用户无法从图标判断当前状态。
 *
 * 本实现把状态差异放进**形状**（面板实心/虚线 + 箭头方位），
 * 与颜色（收起态 `--color-primary` vs 常态 `--color-text-primary`）构成冗余编码，
 * 任一通道失效都不影响可读性。
 *
 * 为什么内联 SVG 而不引 UI 图标库：按钮位于 TabBar（每次进页面都会渲染的高频壳层），
 * 且 Element Plus 图标库缺「面板 + 方位箭头」这个组合语义；内联 1 rect + 1 path
 * 无额外包体、无运行期依赖。几何参照 Lucide 的 panel-left / chevron 系列
 * （MIT/ISC 许可，见 apps/desktop/THIRD-PARTY-NOTICES.md），18×18 viewBox，
 * currentColor 跟随主题。
 */
defineProps({
  /** 侧栏当前是否已收起；true 渲染「虚线面板 + 右向箭头」 */
  collapsed: { type: Boolean, default: false },
})
</script>
