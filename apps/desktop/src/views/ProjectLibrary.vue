<template>
  <div class="library-page">
    <div class="page-header">
      <h1>项目库</h1>
      <p class="text-muted">所有视频生产项目档案</p>
    </div>

    <!-- 加载状态：统一骨架屏（UiSkeleton + styles/skeleton.css 令牌） -->
    <div v-if="loading" class="loading-state" data-testid="project-library-loading">
      <div class="mp-skeleton-grid" style="--skeleton-grid-min: 240px">
        <UiSkeleton v-for="i in 6" :key="i" variant="card" class="mp-skeleton-card" />
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="error-state">
      <p class="error-msg">{{ error }}</p>
      <UiButton @click="refresh">重试</UiButton>
    </div>

    <!-- 空状态 -->
    <EmptyState
      v-else-if="projects.length === 0"
      data-testid="project-library-empty"
      icon="VideoCamera"
      :title="t('projectLibrary.empty.title')"
      :description="t('projectLibrary.empty.message')"
      :action-text="t('projectLibrary.empty.action')"
      @action="router.push('/create')"
    />

    <!-- 项目列表 -->
    <div v-else class="project-grid">
      <ProjectCard
        v-for="p in projects"
        :key="p.id"
        :project="p"
        @delete="handleDelete"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useProjectList } from '@/composables/useBacklot'
import ProjectCard from '@/components/ProjectCard.vue'
import UiButton from '@/components/UiButton.vue'
import { confirmDanger } from '@/utils/confirm-danger'

const { t } = useI18n()
const router = useRouter()
const { projects, loading, error, refresh, deleteProject } = useProjectList()

// 危险操作门禁（docs/frontend-interaction-spec.md §2）：删除项目为不可逆操作，
// 必须经 confirmDanger 二次确认，取消时不得触发底层删除 API。
async function handleDelete(projectId) {
  if (!projectId) return
  const target = projects.value.find(x => x && x.id === projectId)
  const name = target && target.name ? target.name : projectId
  const confirmed = await confirmDanger({
    title: t('projectLibrary.deleteConfirmTitle'),
    message: t('projectLibrary.deleteConfirmMessage', { name }),
    confirmText: t('projectLibrary.deleteConfirmButton'),
  })
  if (!confirmed) return
  await deleteProject(projectId)
}

onMounted(() => {
  refresh()
})
</script>

<style scoped>
.library-page {
  padding: 24px;
}
.page-header {
  margin-bottom: 24px;
}
.page-header h1 {
  font-size: var(--font-size-xl);
  font-weight: 700;
  margin: 0 0 4px 0;
}
.text-muted {
  color: var(--text-muted, #909399);
  font-size: var(--font-size-sm);
  margin: 0;
}

/* 加载骨架屏：外壳样式来自 styles/skeleton.css（.mp-skeleton-card / .mp-skeleton-grid） */

/* 错误状态 */
.error-state {
  text-align: center;
  padding: 48px 24px;
}
.error-msg {
  color: var(--coral, #f56c6c);
  margin-bottom: 16px;
}

/* 项目网格 */
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
</style>
