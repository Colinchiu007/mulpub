<template>
  <section class="favorites-panel" data-testid="account-favorites-panel" aria-label="收藏分组">
    <div class="favorites-toolbar">
      <div class="search-box">
        <Search class="search-icon" />
        <input
          v-model="searchInput"
          type="search"
          placeholder="搜索收藏"
          aria-label="搜索收藏"
          data-testid="favorites-search"
        >
      </div>
      <span class="favorites-guide">如何使用收藏分组？将常用账号加星后，可在这里按分组快速找到它们。</span>
      <button class="favorites-create-button" type="button" data-testid="favorites-create" disabled title="收藏分组功能即将上线">
        <Plus />创建分组
      </button>
    </div>

    <div class="favorites-table-wrap">
      <table class="favorites-table">
        <thead>
          <tr>
            <th>分组名称</th>
            <th>账号数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody v-if="visibleGroups.length > 0">
          <tr v-for="group in visibleGroups" :key="group.id" :data-testid="`favorite-group-${group.id}`">
            <td class="favorite-group-name">
              <FolderOpened class="favorite-group-icon" />
              {{ group.name }}
            </td>
            <td>{{ group.accountIds?.length || 0 }}</td>
            <td>
              <button type="button" class="favorite-group-action" @click="$emit('open-group', group)">查看账号</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="visibleGroups.length === 0" class="favorites-empty" data-testid="favorites-empty">
        <div class="favorites-empty-icon" aria-hidden="true">☁</div>
        <p>暂无数据</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { FolderOpened, Plus, Search } from '@element-plus/icons-vue'

const props = defineProps({
  groups: { type: Array, default: () => [] },
})
defineEmits(['open-group'])

const searchInput = ref('')

const visibleGroups = computed(() => {
  const query = searchInput.value.trim().toLowerCase()
  const withFavorites = props.groups.filter(group => (group.accountIds || []).length > 0)
  if (!query) return withFavorites
  return withFavorites.filter(group => String(group.name || '').toLowerCase().includes(query))
})
</script>

<style scoped>
.favorites-panel { display: flex; flex-direction: column; gap: 16px; padding: 20px 24px; }
.favorites-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.favorites-toolbar .search-box {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: min(220px, 100%);
}
.favorites-toolbar .search-icon {
  position: absolute;
  left: 10px;
  width: 14px;
  height: 14px;
  color: var(--muted, #9a9aa5);
  pointer-events: none;
}
.favorites-toolbar input[type="search"] {
  width: 100%;
  min-height: 34px;
  padding: 6px 10px 6px 30px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  outline: none;
}
.favorites-toolbar input[type="search"]:focus { border-color: #5048e5; box-shadow: 0 0 0 2px rgba(80, 72, 229, 0.1); }
.favorites-guide { flex: 1 1 auto; color: var(--muted, #85858f); font-size: 12px; line-height: 1.5; }
.favorites-create-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 6px 14px;
  border: 0;
  border-radius: 6px;
  background: #5048e5;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.favorites-create-button:disabled { opacity: 0.5; cursor: not-allowed; }
.favorites-create-button svg { width: 14px; height: 14px; }
.favorites-table-wrap {
  border: 1px solid var(--border-light, #ececf1);
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}
.favorites-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.favorites-table th {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, #ececf1);
  background: #f8f8fa;
  color: #5c5e6a;
  font-weight: 500;
  text-align: left;
}
.favorites-table td { padding: 12px 16px; border-bottom: 1px solid #f1f1f5; color: #303039; }
.favorites-table tbody tr:last-child td { border-bottom: 0; }
.favorite-group-name { display: inline-flex; align-items: center; gap: 8px; }
.favorite-group-icon { width: 15px; height: 15px; color: #5048e5; }
.favorite-group-action {
  border: 1px solid var(--border, #dedee5);
  border-radius: 5px;
  padding: 4px 10px;
  background: #fff;
  color: #5048e5;
  font-size: 12px;
  cursor: pointer;
}
.favorite-group-action:hover { border-color: #5048e5; }
.favorites-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 64px 0;
}
.favorites-empty-icon { font-size: 40px; color: #c9cbd8; line-height: 1; }
.favorites-empty p { margin: 0; color: var(--muted, #85858f); font-size: 14px; }
</style>
