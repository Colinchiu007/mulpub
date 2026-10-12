<template>
  <div>
    <h1 style="margin-bottom:16px">内容类别管理</h1>
    <p style="color:var(--color-text-placeholder);margin-bottom:16px;font-size: var(--font-size-sm)">
      本列表是 <strong>热门选题分类、采集库类别标签、账号分组预设标签</strong> 的唯一真源，
      三处共用同一套类别，改名/停用会同时影响这三处显示。
      内置 11 类与桌面端抓取分类器（<code>classifier.js</code>）严格对齐，
      <strong>可改名、可停用、可排序，但不可删除</strong>（删除会让桌面端历史引用失效）。
      <br />
      生效时机：配置随运行时 bootstrap 下发，桌面端<strong>下次启动时</strong>生效；
      桌面端读不到下发值时回退内置 11 类，离线可用。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="color:var(--color-text-secondary);font-size: var(--font-size-xs)">
          共 {{ items.length }} 项 · 已停用 {{ disabledCount }} 项 · 自定义 {{ customCount }} 项
        </div>
        <div>
          <el-button :loading="loading" :disabled="saving || resetting" @click="load">刷新</el-button>
          <el-button :loading="resetting" :disabled="saving || loading" @click="resetAll">恢复默认</el-button>
          <el-button type="primary" :disabled="loading" @click="openCreate">新增类别</el-button>
        </div>
      </div>

      <el-table :data="items" stripe v-loading="loading" style="width:100%">
        <el-table-column label="#" width="60" align="center">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column prop="category_key" label="类别标识" min-width="140" />
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_preset" type="warning" size="small">内置</el-tag>
            <el-tag v-else type="info" size="small">自定义</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="(v) => toggleEnabled(row, v)" />
          </template>
        </el-table-column>
        <el-table-column prop="description" label="备注" min-width="200" show-overflow-tooltip />
        <el-table-column label="排序" width="180" align="center">
          <template #default="{ row, $index }">
            <el-button size="small" :disabled="$index === 0" @click="move(row, 'top')">⤒</el-button>
            <el-button size="small" :disabled="$index === 0" @click="move(row, 'up')">↑</el-button>
            <el-button size="small" :disabled="$index === items.length - 1" @click="move(row, 'down')">↓</el-button>
            <el-button size="small" :disabled="$index === items.length - 1" @click="move(row, 'bottom')">⤓</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-tooltip v-if="row.is_preset" content="内置类别不可删除，可改为禁用" placement="top">
              <span style="display:inline-block">
                <el-button link type="danger" size="small" disabled>删除</el-button>
              </span>
            </el-tooltip>
            <el-button v-else link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showDialog" :title="editing ? `编辑类别：${form.category_key}` : '新增类别'" width="560px">
      <el-form label-width="100px" label-position="left">
        <el-form-item label="类别标识" required>
          <el-input v-model="form.category_key" :disabled="editing" placeholder="如 tech（小写字母/数字/下划线，≤32）" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="显示名称（≤20 字）" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="运营备注（≤200 字）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listContentCategories,
  createContentCategory,
  updateContentCategory,
  deleteContentCategory,
  reorderContentCategory,
  resetContentCategories,
} from '../api/contentCategories'

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const showDialog = ref(false)
const editing = ref(false)

const KEY_RE = /^[a-z][a-z0-9_]{1,31}$/
const MAX_NAME_LEN = 20

const form = ref({ category_key: '', name: '', description: '' })

const disabledCount = computed(() => items.value.filter(i => !i.enabled).length)
const customCount = computed(() => items.value.filter(i => !i.is_preset).length)

async function load() {
  loading.value = true
  try {
    const data = await listContentCategories()
    items.value = data.items || []
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = { category_key: '', name: '', description: '' }
  showDialog.value = true
}

function openEdit(row) {
  editing.value = true
  form.value = { category_key: row.category_key, name: row.name, description: row.description || '' }
  showDialog.value = true
}

async function save() {
  const key = String(form.value.category_key || '').trim()
  const name = String(form.value.name || '').trim()
  if (!KEY_RE.test(key)) {
    ElMessage.warning('类别标识只能由小写字母、数字、下划线组成，且以字母开头，长度 2-32')
    return
  }
  if (!name) {
    ElMessage.warning('名称不能为空')
    return
  }
  if (name.length > MAX_NAME_LEN) {
    ElMessage.warning(`名称不能超过 ${MAX_NAME_LEN} 个字符`)
    return
  }
  const payload = { name, description: String(form.value.description || '').trim() }
  saving.value = true
  try {
    if (editing.value) {
      await updateContentCategory(key, payload)
      ElMessage.success('名称已更新')
    } else {
      await createContentCategory({ category_key: key, ...payload })
      ElMessage.success('类别已创建')
    }
    showDialog.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(row, value) {
  try {
    await updateContentCategory(row.category_key, { enabled: value })
    row.enabled = value
    ElMessage.success(value ? '已启用，桌面端下次启动将看到该类别' : '已禁用该类别，桌面端将不再显示')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
    await load()
  }
}

async function move(row, action) {
  try {
    const data = await reorderContentCategory(row.category_key, action)
    items.value = data.items || []
    if (data.result !== 'noop') ElMessage.success('排序已更新')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '排序失败')
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除类别「${row.name}」（${row.category_key}）吗？\n删除后正在使用该类别的采集内容 / 账号分组，其该标签将不再显示，但内容本身不会被删除。`,
      '确认删除',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await deleteContentCategory(row.category_key)
    ElMessage.success('类别已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}

async function resetAll() {
  try {
    await ElMessageBox.confirm(
      '将把内置 11 类的名称、备注、排序、启用状态恢复为目录默认值，自定义类别保留。继续吗？',
      '恢复默认',
      { type: 'warning' },
    )
  } catch {
    return
  }
  resetting.value = true
  try {
    const data = await resetContentCategories()
    items.value = data.items || []
    ElMessage.success('已恢复默认类别')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '恢复失败')
  } finally {
    resetting.value = false
  }
}

onMounted(load)
</script>
