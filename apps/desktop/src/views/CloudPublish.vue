<template>
  <div>
    <div class="cohere-page-header">
      <div style="display:flex;align-items:center;gap:var(--space-md);width:100%">
        <div style="flex:1">
          <div class="page-title">云端发布</div>
          <div class="page-subtitle">提交发布任务到 ECS 服务器，不依赖本地环境</div>
        </div>
        <span class="cohere-tag" :class="orchestratorOnline ? 'cohere-tag-success' : 'cohere-tag-warning'">
          {{ orchestratorOnline ? 'orchestrator 在线' : 'orchestrator 离线' }}
        </span>
      </div>
    </div>

    <div class="cohere-content" style="display:flex;flex-direction:column;gap:var(--space-md)">
      <!-- 提交新任务 -->
      <div class="cohere-card" style="cursor:default">
        <div class="cohere-form" @submit.prevent="handleSubmit">
          <div class="cohere-form-item">
            <label class="cohere-form-label">视频 URL</label>
            <UiInput v-model="form.videoUrl" placeholder="https://storage.example.com/videos/xxx.mp4" />
          </div>

          <div class="cohere-form-row" style="display:flex;gap:var(--space-md)">
            <div class="cohere-form-item" style="flex:1">
              <label class="cohere-form-label">目标平台</label>
              <select class="cohere-input" v-model="form.platform">
                <option v-for="p in platforms" :key="p.id" :value="p.id">{{ p.name || p.id }}</option>
              </select>
            </div>
            <div class="cohere-form-item" style="flex:2">
              <label class="cohere-form-label">标题</label>
              <UiInput v-model="form.title" placeholder="视频标题" maxlength="80" />
            </div>
          </div>

          <div class="cohere-form-item">
            <label class="cohere-form-label">描述</label>
            <UiInput type="textarea" v-model="form.desc" placeholder="视频描述" rows="3" style="resize:vertical;font-family:inherit;line-height:1.6"/>
          </div>

          <div class="cohere-form-item">
            <label class="cohere-form-label">标签</label>
            <UiInput v-model="tagsInput" placeholder="标签（逗号分隔）" @keydown.enter.prevent="addTag" />
            <div v-if="form.tags.length" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:var(--space-xs)">
              <span v-for="(tag, idx) in form.tags" :key="tag" class="cohere-tag cohere-tag-info" style="cursor:pointer" @click="form.tags.splice(idx, 1)">
                {{ tag }} ✕
              </span>
            </div>
          </div>

          <div class="cohere-form-item">
            <label class="cohere-form-label">封面 URL</label>
            <UiInput v-model="form.coverUrl" placeholder="https://storage.example.com/covers/xxx.jpg（可选）" />
          </div>

          <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md)">
            <UiButton @click="handleSubmit" :disabled="submitting">
              {{ submitting ? '提交中...' : '提交云端发布' }}
            </UiButton>
          </div>

          <div v-if="submitResult" class="cohere-form-item" style="margin-top:var(--space-sm)">
            <div v-if="submitResult.ok" class="cohere-tag cohere-tag-success">任务已创建: {{ submitResult.data?.task_id }}</div>
            <div v-else class="cohere-tag cohere-tag-error">提交失败: {{ submitResult.message }}</div>
          </div>
        </div>
      </div>

      <!-- 发布记录 -->
      <div class="cohere-card" style="cursor:default">
        <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md)">
          <span class="cohere-tag cohere-tag-info">发布记录</span>
          <span style="font-size:13px;color:var(--muted)">{{ tasks.length }} 条</span>
          <div style="flex:1"></div>
          <button class="cohere-btn-ghost" @click="refreshTasks" :disabled="loadingTasks">⟳ 刷新</button>
        </div>

        <div v-if="loadingTasks" style="padding:16px 0" data-testid="cloud-publish-loading">
          <UiSkeleton variant="table" :count="4" :columns="4" />
        </div>

        <table v-else-if="tasks.length" class="cohere-table" style="width:100%">
          <thead>
            <tr>
              <th>状态</th>
              <th>平台</th>
              <th>标题</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tasks" :key="t.id">
              <td>
                <span class="cohere-tag" :class="statusClass(t.status)">{{ statusLabel(t.status) }}</span>
              </td>
              <td>{{ t.input_data?.platform || '-' }}</td>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ t.input_data?.title || '-' }}</td>
              <td style="font-size:12px;color:var(--muted)">{{ formatTime(t.created_at) }}</td>
              <td>
                <button v-if="t.status === 'failed'" class="cohere-btn-ghost" @click="retryTask(t)" style="font-size:12px">重试</button>
              </td>
            </tr>
          </tbody>
        </table>

        <EmptyState v-else :title="$t('emptyStates.cloudPublish.title')" compact />
      </div>
    </div>
  </div>
</template>

<script>
// eslint-disable-next-line no-unused-vars
import { cloudPublishSubmit, cloudPublishListTasks, cloudPublishGetTask, cloudPublishPlatforms } from '../api/cloud-publisher'
import UiInput from '../components/UiInput.vue'
import UiButton from '../components/UiButton.vue'
import { reportError } from '../utils/report-error'
import { formatUserError } from '@/utils/user-facing-error'

export default {
  name: 'CloudPublish',
  components: { UiInput, UiButton },
  data () {
    return {
      orchestratorOnline: true,
      platforms: [],
      form: {
        videoUrl: '',
        platform: 'bilibili',
        title: '',
        desc: '',
        tags: [],
        coverUrl: '',
      },
      tagsInput: '',
      submitting: false,
      submitResult: null,
      tasks: [],
      loadingTasks: false,
      pollTimer: null,
    }
  },
  async mounted () {
    await this.loadPlatforms()
    await this.refreshTasks()
    this.startPolling()
  },
  beforeUnmount () {
    this.stopPolling()
  },
  methods: {
    async loadPlatforms () {
      const res = await cloudPublishPlatforms()
      if (res?.code === 0 && res.data && res.data.length) {
        this.platforms = res.data
        if (!this.form.platform && this.platforms.length) {
          this.form.platform = this.platforms[0].id
        }
      }
    },

    async refreshTasks () {
      this.loadingTasks = true
      try {
        const res = await cloudPublishListTasks()
        if (res?.code === 0 && res.data) {
          this.tasks = (res.data.items || []).slice(0, 50)
          this.orchestratorOnline = true
        } else {
          this.orchestratorOnline = false
        }
      } catch (e) {
        reportError('刷新发布任务列表失败', e)
      } finally {
        this.loadingTasks = false
      }
    },

    startPolling () {
      this.pollTimer = setInterval(async () => {
        // Only poll if there are active (non-terminal) tasks
        const active = this.tasks.filter(t => t.status === 'pending' || t.status === 'publishing' || t.status === 'downloading')
        if (active.length > 0) {
          await this.refreshTasks()
        }
      }, 3000)
    },

    stopPolling () {
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
    },

    addTag () {
      const tag = this.tagsInput.trim()
      if (tag && !this.form.tags.includes(tag)) {
        this.form.tags.push(tag)
      }
      this.tagsInput = ''
    },

    async handleSubmit () {
      if (!this.form.videoUrl || !this.form.title || !this.form.platform) {
        this.submitResult = { ok: false, message: '视频 URL、平台和标题为必填项' }
        return
      }

      this.submitting = true
      this.submitResult = null
      try {
        const res = await cloudPublishSubmit({
          videoUrl: this.form.videoUrl,
          platform: this.form.platform,
          title: this.form.title,
          desc: this.form.desc,
          tags: this.form.tags,
          coverUrl: this.form.coverUrl,
        })

        this.submitResult = res?.code === 0 ? { ok: true, data: res.data } : { ok: false, message: formatUserError(res, { fallback: '提交失败' }).message }

        if (res?.code === 0) {
          // Reset form
          this.form.videoUrl = ''
          this.form.title = ''
          this.form.desc = ''
          this.form.tags = []
          this.form.coverUrl = ''
          // Refresh task list
          await this.refreshTasks()
        }
      } catch (e) {
        reportError('提交发布任务失败', e)
      } finally {
        this.submitting = false
      }
    },

    async retryTask (task) {
      this.form.videoUrl = task.input_data?.video_url || ''
      this.form.platform = task.input_data?.platform || 'bilibili'
      this.form.title = task.input_data?.title || ''
      this.form.desc = task.input_data?.desc || ''
      this.form.tags = task.input_data?.tags || []
      this.form.coverUrl = task.input_data?.cover_url || ''
    },

    statusClass (status) {
      const map = {
        pending: 'cohere-tag-warning',
        downloading: 'cohere-tag-info',
        publishing: 'cohere-tag-info',
        success: 'cohere-tag-success',
        failed: 'cohere-tag-error',
      }
      return map[status] || ''
    },

    statusLabel (status) {
      const map = {
        pending: '等待中',
        downloading: '下载中',
        publishing: '发布中',
        success: '已完成',
        failed: '失败',
      }
      return map[status] || status
    },

    formatTime (ts) {
      if (!ts) return '-'
      try {
        const d = new Date(ts)
        const pad = n => String(n).padStart(2, '0')
        return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      // eslint-disable-next-line no-unused-vars
      } catch (e) {
        return ts
      }
    },
  },
}
</script>
