<template>
  <div>
    <h1 style="margin-bottom:16px">兑换码管理</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      运营人员批量签发 Pro 激活码（格式与桌面端 <code>redemption-codes.js</code> 一致：<code>MP-XXXX-XXXX-SIG</code>，
      HMAC-SHA256 签名，须配置 <code>OPS_REDEMPTION_SECRET</code> 且与桌面端 <code>REDEMPTION_SECRET</code> 一致方可被桌面端验证）。
      列表默认掩码展示；吊销后桌面端应拒绝激活。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;gap:8px">
          <el-select v-model="filterPlan" placeholder="套餐" clearable style="width:120px" @change="resetPage">
            <el-option v-for="p in PLAN_OPTIONS" :key="p" :label="p" :value="p" />
          </el-select>
          <el-select v-model="filterStatus" placeholder="状态" clearable style="width:120px" @change="resetPage">
            <el-option label="有效" value="active" />
            <el-option label="已吊销" value="revoked" />
          </el-select>
        </div>
        <el-button type="primary" @click="openGenerate">批量签发</el-button>
      </div>

      <el-table :data="items" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="code" label="兑换码（掩码）" min-width="220" />
        <el-table-column label="套餐" width="90">
          <template #default="{ row }">
            <el-tag size="small">{{ row.plan }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '有效' : '已吊销' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="batch_id" label="批次" min-width="130" />
        <el-table-column prop="expires_at" label="过期时间" min-width="150">
          <template #default="{ row }">{{ row.expires_at || '-' }}</template>
        </el-table-column>
        <el-table-column prop="created_at" label="签发时间" min-width="150" />
        <el-table-column prop="note" label="备注" min-width="120" show-overflow-tooltip />
        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <el-button v-if="row.status === 'active'" link type="warning" size="small" @click="revoke(row)">吊销</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
        <span style="color:#888;font-size:12px">共 {{ total }} 条</span>
        <div>
          <el-button size="small" :disabled="offset === 0" @click="page(-1)">上一页</el-button>
          <el-button size="small" :disabled="offset + PAGE_SIZE >= total" @click="page(1)">下一页</el-button>
        </div>
      </div>
    </el-card>

    <el-dialog v-model="showGenerate" title="批量签发兑换码" width="520px">
      <el-form label-width="110px" label-position="left">
        <el-form-item label="数量" required>
          <el-input-number v-model="form.count" :min="1" :max="200" style="width:100%" />
        </el-form-item>
        <el-form-item label="套餐" required>
          <el-select v-model="form.plan" style="width:100%">
            <el-option v-for="p in PLAN_OPTIONS" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="过期时间">
          <el-input v-model="form.expires_at" placeholder="ISO 时间或留空，如 2027-01-01T00:00:00Z" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" placeholder="批次备注（≤200 字）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGenerate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="generate">签发</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showResult" title="签发成功（完整码仅本次显示，请立即复制保存）" width="560px">
      <div style="max-height:320px;overflow:auto">
        <div v-for="c in lastCodes" :key="c" class="code-line">{{ c }}</div>
      </div>
      <p style="color:#f56c6c;font-size:12px;margin-top:8px">完整兑换码仅在此展示一次；关闭后列表只显示掩码，请立即复制分发。</p>
      <template #footer>
        <el-button type="primary" @click="showResult = false; load()">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>


<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createRedemptionBatch, listRedemptionCodes, revokeRedemptionCode, deleteRedemptionCode } from '../api/redemptionCodes'

const PLAN_OPTIONS = ['free', 'trial', 'pro']

const items = ref([])
const loading = ref(false)
const offset = ref(0)
const total = ref(0)
const PAGE_SIZE = 100
const saving = ref(false)
const showGenerate = ref(false)
const showResult = ref(false)
const lastCodes = ref([])
const filterPlan = ref('')
const filterStatus = ref('')

const form = reactive({ count: 10, plan: 'pro', expires_at: '', note: '' })

function resetPage() { offset.value = 0; load() }

onMounted(load)

async function load() {
  loading.value = true
  try {
    const params = { limit: PAGE_SIZE, offset: offset.value }
    if (filterPlan.value) params.plan = filterPlan.value
    if (filterStatus.value) params.status = filterStatus.value
    const data = await listRedemptionCodes(params)
    items.value = data.items || []
    total.value = data.total || 0
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载兑换码失败')
  } finally {
    loading.value = false
  }
}

function openGenerate() {
  Object.assign(form, { count: 10, plan: 'pro', expires_at: '', note: '' })
  showGenerate.value = true
}

async function generate() {
  saving.value = true
  try {
    const data = await createRedemptionBatch(JSON.parse(JSON.stringify(form)))
    lastCodes.value = data.codes || []
    showGenerate.value = false
    showResult.value = true
    ElMessage.success(`已签发 ${data.count} 个兑换码（批次 ${data.batch_id}）`)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '签发失败（请确认已配置 OPS_REDEMPTION_SECRET）')
  } finally {
    saving.value = false
  }
}

function page(delta) {
  offset.value = Math.max(0, offset.value + delta * PAGE_SIZE)
  load()
}

async function revoke(row) {
  try {
    await ElMessageBox.confirm(`确定吊销兑换码 ${row.code} 吗？吊销后桌面端应拒绝激活。`, '确认吊销', { type: 'warning' })
  } catch { return }
  try {
    await revokeRedemptionCode(row.id)
    ElMessage.success('已吊销')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '吊销失败')
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除兑换码 ${row.code} 吗？`, '确认删除', { type: 'warning' })
  } catch { return }
  try {
    await deleteRedemptionCode(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
</script>

<style scoped>
.code-line {
  font-family: monospace;
  padding: 4px 0;
  border-bottom: 1px solid #f0f0f0;
}
</style>
