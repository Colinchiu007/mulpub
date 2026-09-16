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
      icon="🎬"
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

    <!-- 删除确认弹窗 -->
    <div v-if="deleteTarget" class="confirm-overlay" @click.self="deleteTarget = null">
      <div class="confirm-dialog">
        <p>确定要删除项目"{{ deleteTargetName }}"吗？此操作不可撤销。</p>
        <div class="confirm-actions">
          <UiButton variant="ghost" @click="deleteTarget = null">取消</UiButton>
          <UiButton variant="danger" @click="confirmDelete">删除</UiButton>
        </div>
      </div>
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

const { t } = useI18n()
const router = useRouter()
const { projects, loading, error, refresh, deleteProject } = useProjectList()

const deleteTarget = ref(null)
const deleteTargetName = computed(() => {
  if (!deleteTarget.value) return ''
  const p = projects.value.find(x => x.id === deleteTarget.value)
  return p ? p.name : ''
})

function handleDelete(projectId) {
  deleteTarget.value = projectId
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  await deleteProject(deleteTarget.value)
  deleteTarget.value = null
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
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 4px 0;
}
.text-muted {
  color: var(--text-muted, #909399);
  font-size: 14px;
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

/* 删除确认弹窗 */
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.confirm-dialog {
  background: var(--bg-card, #fff);
  border-radius: 12px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
}
.confirm-dialog p {
  margin: 0 0 20px 0;
  font-size: 15px;
  line-height: 1.6;
}
.confirm-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
</style>
