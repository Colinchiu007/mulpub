<!--
  敏感词警告横幅（fix-rewrite-warning-severity，2026-10-21）。

  存在意义：改写引擎的前置敏感词拦截已关（PR #4103，用户 8000 字史料曾因「爆炸」
  一词被整篇拒绝），后置 warnings 成为唯一防线。但改写页此前把 warnings 写进
  rewriteError —— 那是 role="alert" 的**红色错误区**，与同刻的 notifySuccess、
  已赋值的 rewriteResult 形成「红色错误 + 成功提示 + 有结果」三者并存的矛盾形态。

  本组件把这件事收成一处：warnings 是「成功但需注意」，用暖橙 warning 样式
  （复用截断横幅的类），刻意不用红色错误样式——那条路是「改写失败」。

  从 RewriteView.vue 拆出的直接动因：该文件已贴住 max-lines 上限（origin/main
  实测 1418/1419），任何新增都会触发 LEDGER_GREW。
-->
<template>
  <div
    v-if="warnings.length > 0"
    class="rewrite-output-truncated-banner"
    data-testid="rewrite-sensitive-warning"
  >
    ⚠️ {{ $t('rewritePage.rewriteSensitiveWarning', { words: warnings.join('；') }) }}
  </div>
</template>

<script setup>
defineProps({
  // 引擎后置检测的 warnings（已归一化为数组）；空数组 = 无警告，不渲染
  warnings: { type: Array, default: () => [] },
})
</script>
