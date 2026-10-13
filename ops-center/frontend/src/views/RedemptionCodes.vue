<template>
  <div>
    <h1 style="margin-bottom:16px">兑换码管理</h1>
    <p style="color:var(--color-text-placeholder);margin-bottom:16px;font-size: var(--font-size-sm)">
      运营人员批量签发会员兑换码。签发由服务端 <code>api-publish-engine</code> 统一落库
      （<code>identity_redeem_codes</code>），本页面只负责发起签发与展示结果——
      ops 后端不生成、不存储任何兑换码。
      <br />
      兑换码为一次性资源，用户在桌面端「会员中心 → 激活码兑换」处核销，
      按填写的 <b>有效天数</b> 授予对应套餐权益。
    </p>

    <el-alert type="info" :closable="false" style="margin-bottom:16px">
      <template #title>
        列表中的兑换码<strong>默认掩码</strong>显示（如 <code>ABCD-****-****</code>）。
        需要完整码时点「显示完整码」——该操作会被服务端记入审计日志。
        删除操作<strong>不提供</strong>：服务端只支持作废（disabled），不做物理删除。
      </template>
    </el-alert>

    <el-card shadow="never">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
        <el-select v-model="filters.plan" placeholder="套餐" clearable style="width:140px">
          <el-option v-for="p in PLAN_OPTIONS" :key="p" :label="p" :value="p" />
        </el-select>
        <el-select v-model="filters.status" placeholder="状态" clearable style="width:150px">
          <el-option v-for="s in STATUS_OPTIONS" :key="s" :label="STATUS_LABELS[s]" :value="s" />
        </el-select>
        <el-input
          v-model="filters.batch"
          placeholder="批次号"
          clearable
          style="width:220px"
          @keyup.enter="loadList"
        />
        <el-button @click="loadList">查询</el-button>
        <el-switch
          v-model="reveal"
          active-text="显示完整码"
          style="margin-left:auto"
          @change="loadList"
        />
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <el-button type="primary" @click="openGenerate">批量签发</el-button>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadList"
          @size-change="loadList"
        />
      </div>

      <el-table :data="codes" v-loading="loading" empty-text="暂无兑换码">
        <el-table-column prop="code" label="兑换码" min-width="200" />
        <el-table-column prop="plan" label="套餐" width="100" />
        <el-table-column prop="durationDays" label="天数" width="80" />
        <el-table-column prop="batch" label="批次" min-width="180" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status] || 'info'" size="small">
              {{ STATUS_LABELS[row.status] || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="usedBy" label="使用者" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'active'"
              type="danger"
              size="small"
              link
              @click="confirmDisable(row)"
            >
              作废
            </el-button>
            <span v-else style="color:var(--color-text-placeholder);font-size:var(--font-size-xs)">
              {{ row.status === 'used' ? '已兑换' : '已作废' }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showGenerate" title="批量签发兑换码" width="520px">
      <el-form label-width="110px" label-position="left">
        <el-form-item label="数量" required>
          <el-input-number v-model="form.count" :min="1" :max="MAX_BATCH" style="width:100%" />
        </el-form-item>
        <el-form-item label="套餐" required>
          <el-select v-model="form.plan" style="width:100%">
            <el-option v-for="p in PLAN_OPTIONS" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="有效天数" required>
          <el-input-number v-model="form.durationDays" :min="1" :max="3650" style="width:100%" />
          <div style="color:var(--color-text-placeholder);font-size: var(--font-size-xs)">
            用户兑换后获得的会员时长（按天计），与「过期时间」无关。
          </div>
        </el-form-item>
        <el-form-item label="兑换码过期">
          <el-input v-model="form.expires_at" placeholder="ISO 时间或留空，如 2027-01-01T00:00:00Z" />
          <div style="color:var(--color-text-placeholder);font-size: var(--font-size-xs)">
            指兑换码本身的使用截止时间；留空表示长期有效。
          </div>
        </el-form-item>
        <el-form-item label="批次号">
          <el-input v-model="form.batch" placeholder="留空则由服务端自动生成" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGenerate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="generate">签发</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showResult" title="签发结果（完整码仅本次显示，请立即复制保存）" width="560px">
      <el-alert
        v-if="lastResult && lastResult.generated < lastResult.requested"
        type="error"
        :closable="false"
        style="margin-bottom:12px"
      >
        <template #title>
          请求 {{ lastResult.requested }} 个，实际签发 {{ lastResult.generated }} 个。
          服务端已重试补足仍未凑齐——下方列出的是<strong>已成功签发、可直接交付</strong>的码，
          请以这些为准，不要按请求数对外承诺。
        </template>
      </el-alert>
      <div style="max-height:320px;overflow:auto">
        <div v-for="c in lastCodes" :key="c" class="code-line">{{ c }}</div>
      </div>
      <p style="color:var(--color-danger);font-size: var(--font-size-xs);margin-top:8px">
        完整兑换码仅本次显示，关闭后无法再次查看。
      </p>
      <template #footer>
        <el-button type="primary" @click="showResult = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createRedemptionBatch, listRedemptionCodes, disableRedemptionCode } from '../api/redemptionCodes'

// 与后端 services/redeem_batch_service.py 的 SUPPORTED_PLANS 保持一致。
// 服务端拒 free（无套餐可授予），且不存在 trial 档——旧的 free/trial 已被真源淘汰。
const PLAN_OPTIONS = ['standard', 'pro']
// 与后端 MAX_BATCH 保持一致
const MAX_BATCH = 200

// STATUS_OPTIONS 沿用 ops 旧契约的对外词表（含 revoked），后端负责映射到
// 服务端的 disabled。UI 只用对外词表，避免把服务端内部状态泄漏成前端契约。
const STATUS_OPTIONS = ['active', 'used', 'revoked']
const STATUS_LABELS = { active: '未使用', used: '已兑换', revoked: '已作废' }
const STATUS_TAG = { active: 'success', used: 'info', revoked: 'danger' }

const showGenerate = ref(false)
const showResult = ref(false)
const saving = ref(false)
const lastCodes = ref([])
const lastResult = ref(null)

const codes = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
// 默认掩码。与服务端一致：只有运营显式打开才请求完整码，且会被服务端审计。
const reveal = ref(false)
const filters = reactive({ plan: '', status: '', batch: '' })

const form = reactive({ count: 10, plan: 'standard', durationDays: 30, expires_at: '', batch: '' })

async function loadList() {
  loading.value = true
  try {
    const data = await listRedemptionCodes({
      plan: filters.plan || undefined,
      status: filters.status || undefined,
      batch: filters.batch || undefined,
      limit: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
      reveal: reveal.value,
    })
    codes.value = data.codes || []
    total.value = data.total || 0
  } catch (e) {
    ElMessage.error(`查询失败：${describeError(e)}`)
  } finally {
    loading.value = false
  }
}

function describeError(e) {
  const detail = e?.response?.data?.detail
  // 补足失败时后端返回的是结构化 payload（error + 已签发码），不是字符串
  if (detail && typeof detail === 'object' && detail.error) return detail.error
  return detail || e?.message || '未知错误'
}

async function confirmDisable(row) {
  try {
    await ElMessageBox.confirm(
      `作废后该兑换码将无法被用户兑换。确认作废 ${row.code} 吗？`,
      '作废兑换码',
      { type: 'warning', confirmButtonText: '作废', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消
  }
  try {
    const data = await disableRedemptionCode(row.code)
    ElMessage.success(data.idempotent ? '该码已是作废状态' : '已作废')
    loadList()
  } catch (e) {
    ElMessage.error(`作废失败：${describeError(e)}`)
  }
}

function openGenerate() {
  Object.assign(form, { count: 10, plan: 'standard', durationDays: 30, expires_at: '', batch: '' })
  showGenerate.value = true
}

async function generate() {
  saving.value = true
  try {
    const data = await createRedemptionBatch({
      plan: form.plan,
      durationDays: form.durationDays,
      count: form.count,
      expires_at: form.expires_at,
      batch: form.batch,
    })
    lastResult.value = data
    lastCodes.value = data.codes || []
    showGenerate.value = false
    showResult.value = true
    ElMessage.success(`已签发 ${data.generated} 个兑换码（批次 ${data.batch}）`)
    loadList()
  } catch (e) {
    const detail = e?.response?.data?.detail
    // 碰撞补足失败：服务端已签发了一部分码。把它们显式带出来，
    // 否则运营既不知道拿到了几个、也拿不到可交付的那部分。
    if (detail && typeof detail === 'object' && detail.error === 'REDEEM_BATCH_INCOMPLETE') {
      lastResult.value = detail
      lastCodes.value = detail.codes || []
      showGenerate.value = false
      showResult.value = true
      ElMessage.warning(
        `补足失败：请求 ${detail.requested} 个，实际签发 ${detail.generated} 个，已列出可交付的码`
      )
      loadList()
      return
    }
    ElMessage.error(`签发失败：${describeError(e)}`)
  } finally {
    saving.value = false
  }
}

onMounted(loadList)
</script>
