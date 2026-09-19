<template>
  <div class="cohere-content">
    <!-- 类别筛选 -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      <button class="style-chip" :class="{ active: !category }" @click="category = ''; loadData()">全部</button>
      <button
        v-for="c in categories" :key="c.value"
        class="style-chip"
        :class="{ active: category === c.value }"
        :style="category === c.value ? { borderColor: catColors[c.value] } : {}"
        @click="category = c.value; loadData()"
      >{{ c.label }}</button>
    </div>
    <!-- 搜索 -->
    <input v-model="search" class="cohere-input" :placeholder="t('knowledgeBase.searchPlaceholder')" @input="debouncedSearch" style="margin-bottom:12px" />
    <!-- 卡片列表 -->
    <div v-if="loading" style="padding:8px 0" data-testid="personal-knowledge-loading">
      <UiSkeleton variant="list" :count="3" />
    </div>
    <EmptyState
      v-else-if="!items.length"
      data-testid="personal-knowledge-empty"
      icon="📚"
      :title="t('knowledgeBase.empty.personal.title')"
      :description="t('knowledgeBase.empty.personal.message')"
      :action-text="t('knowledgeBase.empty.personal.action')"
      @action="emit('create')"
    />
    <div v-else class="kb-card-grid">
      <div v-for="item in items" :key="item.id" class="cohere-card kb-personal-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <span class="kb-category-tag" :style="{ background: catColors[item.category] || '#909399' }">{{ catLabels[item.category] || item.category }}</span>
          <div>
            <button class="cohere-btn-ghost" style="padding:2px 6px;font-size: var(--font-size-xs)" @click="editItem(item)">{{ t('knowledgeBase.edit') }}</button>
            <button class="cohere-btn-ghost danger" style="padding:2px 6px;font-size: var(--font-size-xs)" @click="deleteItem(item)">{{ t('knowledgeBase.delete') }}</button>
          </div>
        </div>
        <div v-if="item.title" style="font-weight:600;margin-bottom:4px">{{ item.title }}</div>
        <div style="color:var(--text-secondary);font-size: var(--font-size-sm);line-height:1.5">{{ (item.content || '').slice(0, 200) }}{{ (item.content || '').length > 200 ? '...' : '' }}</div>
        <div v-if="item.source_file" style="font-size: var(--font-size-xs);color:var(--muted);margin-top:8px">📄 {{ item.source_file }}</div>
        <div style="font-size: var(--font-size-xs);color:var(--muted);margin-top:4px">{{ item.created_at ? item.created_at.slice(0, 10) : '' }}</div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" style="display:flex;justify-content:space-between;align-items:center;padding:12px 0">
      <span>共 {{ total }} 条</span>
      <div style="display:flex;gap:4px;align-items:center">
        <button :disabled="page <= 1" @click="page--; loadData()">上一页</button>
        <span>{{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }}</span>
        <button :disabled="page >= Math.ceil(total / pageSize)" @click="page++; loadData()">下一页</button>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <PersonalFormDialog v-if="editingItem" :item="editingItem" @close="editingItem = null" @saved="onEdited" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listPersonalItems, deletePersonalItem, PERSONAL_CATEGORIES, PERSONAL_CATEGORY_LABELS } from '@/api/knowledge-library'
import PersonalFormDialog from '@/components/PersonalFormDialog.vue'

const { t } = useI18n()
// 空态 CTA：由宿主（KnowledgeBasePage）决定「新增知识」入口，面板不自建弹窗
const emit = defineEmits(['create'])

const categories = PERSONAL_CATEGORIES
const catLabels = PERSONAL_CATEGORY_LABELS
const catColors = {
  personal_ip_persona: '#5149e8',
  personal_background: '#67c23a',
  personal_stories: '#e6a23c',
  growth_experience: '#409eff',
  emotional_experience: '#f56c6c',
  work_experience: '#909399',
  project_experience: '#b37feb',
  personal_opinions: '#2c9678',
  family_stories: '#f47e60',
}

const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const search = ref('')
const category = ref('')
const editingItem = ref(null)

let searchTimer = null

async function loadData () {
  loading.value = true
  try {
    const res = await listPersonalItems({
      page: page.value,
      pageSize: pageSize.value,
      search: search.value,
      category: category.value || undefined,
    })
    if (res && res.code === 0 && res.data) {
      items.value = res.data.items || []
      total.value = res.data.total || 0
    } else {
      items.value = []
      total.value = 0
    }
  } catch (_e) {
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function debouncedSearch () {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadData()
  }, 300)
}

function editItem (item) {
  editingItem.value = item
}

function onEdited () {
  editingItem.value = null
  loadData()
}

async function deleteItem (item) {
  try {
    await ElMessageBox.confirm(t('knowledgeBase.confirmDelete'), t('knowledgeBase.delete'), {
      confirmButtonText: t('knowledgeBase.delete'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    })
  } catch (_e) {
    return
  }
  try {
    const res = await deletePersonalItem(item.id)
    if (res && res.code === 0) {
      ElMessage.success(t('knowledgeBase.deleteSuccess'))
      loadData()
    } else {
      ElMessage.error((res && res.message) || t('knowledgeBase.loadFailed'))
    }
  } catch (_e) {
    ElMessage.error(t('knowledgeBase.loadFailed'))
  }
}

onMounted(() => {
  loadData()
})

defineExpose({ loadData })
</script>

<style scoped>
.cohere-content { padding: 0; }
.cohere-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface, #fff);
  padding: 12px;
}
.cohere-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  outline: none;
  box-sizing: border-box;
}
.cohere-input:focus { border-color: var(--coral); }
.style-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface, #fff);
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--text-primary);
}
.style-chip.active {
  border-color: var(--coral);
  background: var(--coral-bg, #fef2f2);
  color: var(--coral);
}
.kb-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.kb-personal-card { display: flex; flex-direction: column; }
.kb-category-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  color: #fff;
  font-size: var(--font-size-xs);
}
.cohere-btn-ghost {
  padding: 4px 8px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  margin-right: 4px;
}
.cohere-btn-ghost:hover { border-color: var(--coral); color: var(--coral); }
.cohere-btn-ghost.danger { color: var(--danger, #c53b3b); }
.cohere-btn-ghost.danger:hover { border-color: var(--danger, #c53b3b); color: var(--danger, #c53b3b); }
</style>
