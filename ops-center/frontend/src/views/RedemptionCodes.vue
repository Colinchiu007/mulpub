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

    <el-alert type="warning" :closable="false" style="margin-bottom:16px">
      <template #title>
        列表 / 吊销 / 删除暂不可用：签发真源已收敛到服务端，但服务端尚未开放兑换码的
        查询与吊销接口。补齐后会恢复本页的历史列表与吊销操作。
        在此之前，签发出的码<strong>无法作废</strong>，请按批次自行留档。
      </template>
    </el-alert>

    <el-card shadow="never">
      <div style="display:flex;justify-content:flex-end;align-items:center">
        <el-button type="primary" @click="openGenerate">批量签发</el-button>
      </div>
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

    <el-dialog v-model="showResult" title="签发成功（完整码仅本次显示，请立即复制保存）" width="560px">
      <el-alert
        v-if="lastResult && lastResult.generated < lastResult.requested"
        type="error"
        :closable="false"
        style="margin-bottom:12px"
      >
        <template #title>
          请求 {{ lastResult.requested }} 个，实际签发 {{ lastResult.generated }} 个。
          差额由服务端唯一性约束丢弃，请以实际签发数量为准。
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
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { createRedemptionBatch } from '../api/redemptionCodes'

// 与后端 services/redeem_batch_service.py 的 SUPPORTED_PLANS 保持一致。
// 服务端拒 free（无套餐可授予），且不存在 trial 档——旧的 free/trial 已被真源淘汰。
const PLAN_OPTIONS = ['standard', 'pro']
// 与后端 MAX_BATCH 保持一致
const MAX_BATCH = 200

const showGenerate = ref(false)
const showResult = ref(false)
const saving = ref(false)
const lastCodes = ref([])
const lastResult = ref(null)

const form = reactive({ count: 10, plan: 'standard', durationDays: 30, expires_at: '', batch: '' })

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
  } catch (e) {
    ElMessage.error(`签发失败：${e?.response?.data?.detail || e?.message || '未知错误'}`)
  } finally {
    saving.value = false
  }
}
</script>
