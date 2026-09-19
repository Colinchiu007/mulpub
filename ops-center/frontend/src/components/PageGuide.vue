<template>
  <el-card v-if="guide" class="page-guide" shadow="never">
    <div class="page-guide__heading">
      <el-icon class="page-guide__icon"><InfoFilled /></el-icon>
      <div>
        <div class="page-guide__title">{{ guide.title }}</div>
        <div class="page-guide__intro">{{ guide.intro }}</div>
      </div>
    </div>
    <div class="page-guide__purpose">
      <strong>主要作用：</strong>{{ guide.purpose }}
    </div>
  </el-card>
</template>

<script setup>
defineProps({
  guide: {
    type: Object,
    default: null,
  },
})
</script>

<style scoped>
.page-guide {
  margin-bottom: 18px;
  border: 1px solid var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
}
.page-guide :deep(.el-card__body) { padding: 16px 20px; }
.page-guide__heading { display: flex; gap: 12px; align-items: flex-start; }
.page-guide__icon { color: var(--el-color-primary); font-size: 22px; margin-top: 2px; }
.page-guide__title { color: var(--el-text-color-primary); font-size: 16px; font-weight: 600; }
.page-guide__intro { color: var(--el-text-color-regular); line-height: 1.6; margin-top: 4px; }
.page-guide__purpose { color: var(--el-text-color-regular); line-height: 1.6; margin: 12px 0 0 34px; }
.page-guide__purpose strong { color: var(--el-text-color-primary); }
</style>
