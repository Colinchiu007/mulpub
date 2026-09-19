<template>
  <UiModal :visible="visible" title="分组管理" size="md" @close="$emit('close')">
    <div class="group-manager">
      <div class="group-create">
        <input
          v-model="newGroupName"
          data-testid="new-group-name"
          type="text"
          placeholder="输入分组名称"
          maxlength="30"
          @keyup.enter="createGroup"
        >
        <button data-testid="create-group" type="button" :disabled="!newGroupName.trim()" @click="createGroup">
          <Plus />创建
        </button>
      </div>

      <div v-if="groups.length === 0" class="empty-groups">暂无自定义分组</div>
      <div v-else class="group-list">
        <section v-for="group in groups" :key="group.id" class="group-section">
          <header>
            <div v-if="editingGroupId !== group.id">
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
          </div>
        </section>
      </div>
    </div>
    <template #footer>
      <UiButton variant="ghost" @click="$emit('close')">关闭</UiButton>
    </template>
  </UiModal>
</template>

<script setup>
import { ref } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  groups: { type: Array, default: () => [] },
  accounts: { type: Array, default: () => [] },
  platformLabel: { type: Function, default: value => value },
  platforms: { type: Array, default: () => [] },
})
const emit = defineEmits(['create', 'delete', 'rename', 'set-platform', 'toggle-account', 'close'])
const newGroupName = ref('')
const editingGroupId = ref('')
const editingGroupName = ref('')

function eligibleAccounts (group) {
  return props.accounts.filter(account => !group.platformFilter || account.platform === group.platformFilter)
}

function memberCount (group) {
  const ids = new Set(group.accountIds || [])
  return eligibleAccounts(group).filter(account => ids.has(account.id)).length
}

function createGroup () {
  const name = newGroupName.value.trim()
  if (!name) return
  emit('create', name)
  newGroupName.value = ''
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
.group-manager { display: flex; flex-direction: column; gap: 14px; }
.group-create { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.group-create input {
  min-height: 36px;
  padding: 7px 10px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}
.group-create input:focus { border-color: #5048e5; box-shadow: 0 0 0 2px rgba(80, 72, 229, 0.1); }
.group-create button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border: 0;
  border-radius: 6px;
  background: #5048e5;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.group-create button:disabled { opacity: 0.45; cursor: not-allowed; }
.group-create svg { width: 15px; height: 15px; }
.empty-groups { padding: 32px 0; text-align: center; color: var(--muted, #85858f); font-size: 13px; }
.group-list { display: flex; flex-direction: column; gap: 10px; max-height: 420px; overflow: auto; }
.group-section { border: 1px solid var(--border-light, #e8e8ec); border-radius: 7px; overflow: hidden; }
.group-section header { display: flex; align-items: center; justify-content: space-between; padding: 9px 11px; background: #f8f8fa; }
.group-actions { display: inline-flex; align-items: center; gap: 6px; }
.group-actions select { max-width: 120px; min-height: 28px; border: 1px solid var(--border, #dedee5); border-radius: 5px; padding: 2px 22px 2px 6px; background: #fff; color: #5c5e6a; font-size: 11px; }
.rename-group { display: flex; align-items: center; gap: 5px; min-width: 0; }
.rename-group input { width: min(180px, 42vw); min-height: 28px; border: 1px solid #8e87ed; border-radius: 5px; padding: 3px 7px; font-size: 12px; }
.rename-group button, .rename-group-button { min-height: 28px; border: 1px solid #dedee5; border-radius: 5px; padding: 3px 7px; background: #fff; color: #5c5e6a; font-size: 11px; cursor: pointer; }
.rename-group button:first-of-type { border-color: #5048e5; background: #5048e5; color: #fff; }
.rename-group-button:hover { border-color: #5048e5; color: #5048e5; }
.group-section h3 { margin: 0; color: #303039; font-size: 13px; line-height: 20px; }
.group-section header span { color: var(--muted, #85858f); font-size: 11px; }
.delete-group { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: transparent; color: #c43d4d; cursor: pointer; }
.delete-group svg { width: 15px; height: 15px; }
.member-list { display: flex; flex-direction: column; }
.member-row { min-height: 36px; display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 8px; padding: 6px 11px; border-top: 1px solid #efeff2; font-size: 13px; cursor: pointer; }
.member-row input { accent-color: #5048e5; }
.member-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-platform { color: var(--muted, #85858f); font-size: 12px; }
</style>
