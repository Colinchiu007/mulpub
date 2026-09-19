<template>
  <section class="groups-panel" data-testid="account-groups-panel" aria-label="分组管理">
    <div class="groups-toolbar">
      <div class="search-box">
        <Search class="search-icon" />
        <input
          v-model="searchInput"
          type="search"
          placeholder="搜索分组"
          aria-label="搜索分组"
          data-testid="groups-search"
        >
      </div>
      <select v-model="platformFilter" aria-label="分组平台筛选" data-testid="groups-platform-filter">
        <option value="">全部</option>
        <option v-for="platform in platforms" :key="platform.id" :value="platform.id">{{ platform.label }}</option>
      </select>
      <label class="groups-mine-only" title="本设备的分组均由当前用户创建并包含其账号；接入团队共享后将用于过滤他人共享分组">
        <input v-model="mineOnly" type="checkbox" data-testid="groups-mine-only">
        <span>仅看包含我的分组</span>
      </label>
      <div class="groups-sort" role="group" aria-label="分组排序">
        <span class="groups-sort-label">设置排序</span>
        <select v-model="sortBy" aria-label="分组排序字段" data-testid="groups-sort-by">
          <option value="name">名称</option>
          <option value="members">账号数</option>
        </select>
        <button
          type="button"
          data-testid="groups-sort-order"
          :aria-label="`排序${sortOrder === 'desc' ? '降序' : '升序'}`"
          :title="`排序${sortOrder === 'desc' ? '降序' : '升序'}`"
          @click="sortOrder = sortOrder === 'desc' ? 'asc' : 'desc'"
        >
          <span aria-hidden="true">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span>
        </button>
      </div>
      <button
        class="groups-create-button"
        type="button"
        data-testid="groups-create-toggle"
        :aria-expanded="creating"
        @click="creating = !creating"
      >
        <Plus />创建分组
      </button>
    </div>

    <div v-if="creating" class="groups-create-row" data-testid="groups-create-row">
      <input
        v-model="newGroupName"
        type="text"
        placeholder="输入分组名称"
        maxlength="30"
        aria-label="新分组名称"
        data-testid="groups-create-name"
        @keyup.enter="submitCreate"
      >
      <select v-model="newGroupPlatform" aria-label="新分组平台" data-testid="groups-create-platform">
        <option value="">全部平台</option>
        <option v-for="platform in platforms" :key="platform.id" :value="platform.id">{{ platform.label }}</option>
      </select>
      <button type="button" data-testid="groups-create-submit" :disabled="!newGroupName.trim()" @click="submitCreate">确定</button>
      <button type="button" data-testid="groups-create-cancel" @click="cancelCreate">取消</button>
    </div>

    <div v-if="visibleGroups.length === 0" class="groups-empty" data-testid="groups-empty">
      <div class="groups-empty-icon" aria-hidden="true">☁</div>
      <p>暂无数据</p>
      <span v-if="groups.length > 0" class="groups-empty-hint">没有匹配的分组，试试调整搜索或筛选条件</span>
    </div>

    <div v-else class="groups-list">
      <section v-for="group in visibleGroups" :key="group.id" class="group-card" :data-testid="`group-card-${group.id}`">
        <header>
          <div v-if="editingGroupId !== group.id" class="group-card-title">
            <FolderOpened class="group-card-icon" />
            <h3>{{ group.name }}</h3>
            <span>{{ memberCount(group) }} / {{ eligibleAccounts(group).length }} 个账号</span>
          </div>
          <div v-else class="rename-group">
            <input
              :data-testid="`rename-group-${group.id}`"
              v-model="editingGroupName"
              type="text"
              maxlength="30"
              aria-label="分组名称"
              @keyup.enter="saveRename(group)"
              @keyup.esc="cancelRename"
            >
            <button type="button" data-testid="save-group-name" @click="saveRename(group)">保存</button>
            <button type="button" data-testid="cancel-group-name" @click="cancelRename">取消</button>
          </div>
          <div class="group-actions">
            <select
              :value="group.platformFilter || ''"
              :data-testid="`group-${group.id}-platform`"
              aria-label="分组平台"
              @change="$emit('set-platform', group.id, $event.target.value)"
            >
              <option value="">全部平台</option>
              <option v-for="platform in platforms" :key="platform.id" :value="platform.id">{{ platform.label }}</option>
            </select>
            <button v-if="editingGroupId !== group.id" type="button" class="rename-group-button" title="重命名分组" @click="startRename(group)">重命名</button>
            <button type="button" class="delete-group" title="删除分组" aria-label="删除分组" @click="$emit('delete', group.id)">
              <Delete />
            </button>
          </div>
        </header>
        <div class="member-list">
          <label v-for="account in eligibleAccounts(group)" :key="account.id" class="member-row">
            <input
              :data-testid="`group-${group.id}-account-${account.id}`"
              type="checkbox"
              :checked="(group.accountIds || []).includes(account.id)"
              @change="$emit('toggle-account', group.id, account.id)"
            >
            <span class="member-name">{{ account.account_name || account.name || '未命名账号' }}</span>
            <span class="member-platform">{{ platformLabel(account.platform) }}</span>
          </label>
          <div v-if="eligibleAccounts(group).length === 0" class="member-empty">该分组平台下暂无可选账号</div>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Delete, FolderOpened, Plus, Search } from '@element-plus/icons-vue'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  accounts: { type: Array, default: () => [] },
  platforms: { type: Array, default: () => [] },
  platformLabel: { type: Function, default: value => value },
})
const emit = defineEmits(['create', 'delete', 'rename', 'set-platform', 'toggle-account'])

const searchInput = ref('')
const platformFilter = ref('')
// 当前为设备级单机分组：所有分组都由本机用户创建并包含其账号，
// 该开关恒为通过；接入团队共享后用于过滤他人共享的分组。
const mineOnly = ref(true)
const sortBy = ref('name')
const sortOrder = ref('asc')
const creating = ref(false)
const newGroupName = ref('')
const newGroupPlatform = ref('')
const editingGroupId = ref('')
const editingGroupName = ref('')

const visibleGroups = computed(() => {
  const query = searchInput.value.trim().toLowerCase()
  const list = props.groups.filter(group => {
    if (platformFilter.value && (group.platformFilter || '') !== platformFilter.value) return false
    // “包含我的分组”：未绑定任何账号的分组不符合条件
    if (mineOnly.value && !(group.accountIds || []).length) return false
    if (!query) return true
    return String(group.name || '').toLowerCase().includes(query)
  })
  const direction = sortOrder.value === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    const left = sortBy.value === 'members' ? memberCount(a) : String(a.name || '')
    const right = sortBy.value === 'members' ? memberCount(b) : String(b.name || '')
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction
    return String(left).localeCompare(String(right), 'zh-CN') * direction
  })
})

function eligibleAccounts (group) {
  return props.accounts.filter(account => !group.platformFilter || account.platform === group.platformFilter)
}

function memberCount (group) {
  const ids = new Set(group.accountIds || [])
  return eligibleAccounts(group).filter(account => ids.has(account.id)).length
}

function submitCreate () {
  const name = newGroupName.value.trim()
  if (!name) return
  emit('create', name, newGroupPlatform.value)
  cancelCreate()
}

function cancelCreate () {
  creating.value = false
  newGroupName.value = ''
  newGroupPlatform.value = ''
}

function startRename (group) {
  editingGroupId.value = group.id
  editingGroupName.value = group.name || ''
}

function cancelRename () {
  editingGroupId.value = ''
  editingGroupName.value = ''
}

function saveRename (group) {
  const name = editingGroupName.value.trim()
  if (!name || name === group.name) return cancelRename()
  emit('rename', group.id, name)
  cancelRename()
}
</script>

<style scoped>
.groups-panel { display: flex; flex-direction: column; gap: 16px; padding: 20px 24px; }
.groups-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.groups-toolbar .search-box {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: min(220px, 100%);
}
.groups-toolbar .search-icon {
  position: absolute;
  left: 10px;
  width: 14px;
  height: 14px;
  color: var(--muted, #9a9aa5);
  pointer-events: none;
}
.groups-toolbar input[type="search"] {
  width: 100%;
  min-height: 34px;
  padding: 6px 10px 6px 30px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  outline: none;
}
.groups-toolbar input[type="search"]:focus { border-color: #5048e5; box-shadow: 0 0 0 2px rgba(80, 72, 229, 0.1); }
.groups-toolbar select {
  min-height: 34px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  padding: 4px 26px 4px 10px;
  background: #fff;
  color: #3c3e48;
  font-size: 13px;
}
.groups-mine-only {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #5c5e6a;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.groups-mine-only input { accent-color: #5048e5; }
.groups-sort { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
.groups-sort-label { color: var(--muted, #85858f); font-size: 12px; white-space: nowrap; }
.groups-sort select {
  min-height: 30px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  padding: 2px 22px 2px 8px;
  background: #fff;
  color: #5c5e6a;
  font-size: 12px;
}
.groups-sort button {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  background: #fff;
  color: #5c5e6a;
  cursor: pointer;
}
.groups-sort button:hover { border-color: #5048e5; color: #5048e5; }
.groups-create-button {
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
.groups-create-button:hover { background: #4239d6; }
.groups-create-button svg { width: 14px; height: 14px; }
.groups-create-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border: 1px dashed #c9c6f5;
  border-radius: 8px;
  background: #fafaff;
}
.groups-create-row input[type="text"] {
  flex: 1 1 180px;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}
.groups-create-row input[type="text"]:focus { border-color: #5048e5; }
.groups-create-row select {
  min-height: 34px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  padding: 4px 24px 4px 10px;
  background: #fff;
  font-size: 13px;
}
.groups-create-row button {
  min-height: 34px;
  padding: 6px 14px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  background: #fff;
  color: #5c5e6a;
  font-size: 13px;
  cursor: pointer;
}
.groups-create-row button[data-testid="groups-create-submit"] { border-color: #5048e5; background: #5048e5; color: #fff; }
.groups-create-row button[data-testid="groups-create-submit"]:disabled { opacity: 0.45; cursor: not-allowed; }
.groups-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 72px 0;
  border: 1px solid var(--border-light, #ececf1);
  border-radius: 10px;
  background: #fff;
}
.groups-empty-icon { font-size: 40px; color: #c9cbd8; line-height: 1; }
.groups-empty p { margin: 0; color: var(--muted, #85858f); font-size: 14px; }
.groups-empty-hint { color: #b1b2bd; font-size: 12px; }
.groups-list { display: flex; flex-direction: column; gap: 12px; }
.group-card { border: 1px solid var(--border-light, #e8e8ec); border-radius: 8px; background: #fff; overflow: hidden; }
.group-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: #f8f8fa;
}
.group-card-title { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.group-card-icon { width: 15px; height: 15px; color: #5048e5; flex: 0 0 auto; }
.group-card h3 { margin: 0; color: #303039; font-size: 14px; line-height: 20px; }
.group-card-title span { color: var(--muted, #85858f); font-size: 12px; white-space: nowrap; }
.group-actions { display: inline-flex; align-items: center; gap: 6px; }
.group-actions select {
  max-width: 130px;
  min-height: 28px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 5px;
  padding: 2px 22px 2px 6px;
  background: #fff;
  color: #5c5e6a;
  font-size: 11px;
}
.rename-group { display: flex; align-items: center; gap: 6px; min-width: 0; }
.rename-group input {
  width: min(220px, 46vw);
  min-height: 30px;
  border: 1px solid #8e87ed;
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 13px;
}
.rename-group button, .rename-group-button {
  min-height: 28px;
  border: 1px solid #dedee5;
  border-radius: 5px;
  padding: 3px 10px;
  background: #fff;
  color: #5c5e6a;
  font-size: 11px;
  cursor: pointer;
}
.rename-group button:first-of-type { border-color: #5048e5; background: #5048e5; color: #fff; }
.rename-group-button:hover { border-color: #5048e5; color: #5048e5; }
.delete-group {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #c43d4d;
  cursor: pointer;
}
.delete-group svg { width: 15px; height: 15px; }
.member-list { display: flex; flex-direction: column; }
.member-row {
  min-height: 38px;
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  border-top: 1px solid #efeff2;
  font-size: 13px;
  cursor: pointer;
}
.member-row input { accent-color: #5048e5; }
.member-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-platform { color: var(--muted, #85858f); font-size: 12px; }
.member-empty { padding: 14px; border-top: 1px solid #efeff2; color: var(--muted, #85858f); font-size: 12px; text-align: center; }
</style>
