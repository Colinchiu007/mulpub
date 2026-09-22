<template>
  <div class="cohere-content">
    <!-- 搜索栏 -->
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input v-model="search" class="cohere-input" :placeholder="t('knowledgeBase.searchPlaceholder')" @input="debouncedSearch" style="flex:1" />
    </div>
    <div class="cohere-card" style="overflow-x:auto">
      <table class="kb-table">
        <thead>
          <tr>
            <th style="width:50px">{{ t('knowledgeBase.colIndex') }}</th>
            <th style="width:180px">{{ t('knowledgeBase.colTitle') }}</th>
            <th style="width:80px">{{ t('knowledgeBase.colCover') }}</th>
            <th style="width:100px">{{ t('knowledgeBase.colAuthor') }}</th>
            <th style="width:200px">{{ t('knowledgeBase.colContent') }}</th>
            <th style="width:120px">{{ t('knowledgeBase.colTags') }}</th>
            <th style="width:70px" class="sortable" @click="sortBy('likes')">{{ t('knowledgeBase.colLikes') }}</th>
            <th style="width:70px" class="sortable" @click="sortBy('collections')">{{ t('knowledgeBase.colCollections') }}</th>
            <th style="width:70px" class="sortable" @click="sortBy('comments')">{{ t('knowledgeBase.colComments') }}</th>
            <th style="width:70px" class="sortable" @click="sortBy('like_collect_ratio')">{{ t('knowledgeBase.colRatio') }}</th>
            <th style="width:110px">{{ t('knowledgeBase.colPublishedAt') }}</th>
            <th style="width:80px">{{ t('knowledgeBase.colPlatform') }}</th>
            <th style="width:100px">{{ t('knowledgeBase.colActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="13" style="padding:16px">
              <UiSkeleton variant="table" :count="5" :columns="6" />
            </td>
          </tr>
          <tr v-else-if="!items.length">
            <td colspan="13">
              <EmptyState
                data-testid="viral-library-empty"
                icon="🔥"
                :title="t('knowledgeBase.empty.viral.title')"
                :description="t('knowledgeBase.empty.viral.message')"
                :action-text="t('knowledgeBase.empty.viral.action')"
                @action="emit('create')"
              />
            </td>
          </tr>
          <tr v-for="(item, idx) in items" :key="item.id">
            <td>{{ (page - 1) * pageSize + idx + 1 }}</td>
            <td>{{ item.title || '-' }}</td>
            <td><img v-if="item.cover_url" :src="item.cover_url" style="width:60px;height:60px;object-fit:cover;border-radius:4px" /></td>
            <td>{{ item.author || '-' }}</td>
            <td>{{ (item.content || '').slice(0, 80) }}{{ (item.content || '').length > 80 ? '...' : '' }}</td>
            <td>
              <el-tag v-for="tag in (item.tags || [])" :key="tag" size="small" style="margin-right:4px">{{ tag }}</el-tag>
            </td>
            <td>{{ formatNum(item.likes) }}</td>
            <td>{{ formatNum(item.collections) }}</td>
            <td>{{ formatNum(item.comments) }}</td>
            <td>{{ item.like_collect_ratio != null ? Number(item.like_collect_ratio).toFixed(1) : '-' }}</td>
            <td>{{ item.published_at ? item.published_at.slice(0, 10) : '-' }}</td>
            <td>{{ item.platform || '-' }}</td>
            <td>
              <button class="cohere-btn-ghost" @click="editItem(item)">{{ t('knowledgeBase.edit') }}</button>
              <button class="cohere-btn-ghost danger" @click="deleteItem(item)">{{ t('knowledgeBase.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <!-- 分页 -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px">
        <span>共 {{ total }} 条</span>
        <div style="display:flex;gap:4px;align-items:center">
          <button :disabled="page <= 1" @click="page--; loadData()">上一页</button>
          <span>{{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }}</span>
          <button :disabled="page >= Math.ceil(total / pageSize)" @click="page++; loadData()">下一页</button>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <ViralFormDialog v-if="editingItem" :item="editingItem" @close="editingItem = null" @saved="onEdited" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listViralItems, deleteViralItem } from '@/api/knowledge-library'
import ViralFormDialog from '@/components/ViralFormDialog.vue'

const { t } = useI18n()
// 空态 CTA：由宿主（KnowledgeBasePage）决定「新建」入口，面板不自建弹窗
const emit = defineEmits(['create'])

const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const search = ref('')
const sortByField = ref('')
const sortOrder = ref('desc')
const editingItem = ref(null)

let searchTimer = null

async function loadData () {
  loading.value = true
  try {
    const res = await listViralItems({
      page: page.value,
      pageSize: pageSize.value,
      search: search.value,
      sortBy: sortByField.value,
      sortOrder: sortOrder.value,
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

function sortBy (field) {
  if (sortByField.value === field) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortByField.value = field
    sortOrder.value = 'desc'
  }
  loadData()
}

function formatNum (n) {
  // P0 契约显示项：NULL/缺失 = 未知，显示 '-'（不得伪造 0）；真 0 如实显示
  if (n === null || n === undefined || n === '') return '-'
  const num = Number(n)
  if (!Number.isFinite(num)) return '-'
  return num >= 10000 ? (num / 1000).toFixed(1) + 'k' : String(num)
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
    const res = await deleteViralItem(item.id)
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
.kb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}
.kb-table th,
.kb-table td {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}
.kb-table th {
  font-weight: 500;
  color: var(--muted);
  white-space: nowrap;
  background: var(--soft-stone, #fafafa);
}
.kb-table th.sortable { cursor: pointer; user-select: none; }
.kb-table th.sortable:hover { color: var(--coral); }
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
