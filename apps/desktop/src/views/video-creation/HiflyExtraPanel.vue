<template>
  <section class="hifly-extra-panel" data-testid="hifly-extra-panel">
    <!-- 积分条：11 个端点里唯一能反映「还能不能生成」的读数 -->
    <header class="hifly-extra-header">
      <span class="hifly-extra-title">{{ t('hiflyExtraTitle') }}</span>
      <span class="hifly-extra-credit" data-testid="hifly-extra-credit">
        <template v-if="credit === null">{{ t('hiflyExtraCreditUnknown') }}</template>
        <template v-else>{{ t('hiflyExtraCreditLeft') }} {{ credit }}</template>
      </span>
    </header>

    <!-- 能力未就绪（上游 hifly-full-api 尚未合并时）→ 整体隐藏，不显示必然失败的入口 -->
    <p v-if="unsupported" class="config-hint" data-testid="hifly-extra-unsupported">
      {{ t('hiflyExtraUnsupported') }}
    </p>

    <template v-else>
      <!-- 模式选择 -->
      <div class="hifly-extra-tabs" role="tablist">
        <button
          v-for="mode in modes"
          :key="mode.key"
          type="button"
          role="tab"
          class="hifly-extra-tab"
          :class="{ 'hifly-extra-tab-active': activeMode === mode.key }"
          :aria-selected="activeMode === mode.key"
          :data-testid="`hifly-extra-tab-${mode.key}`"
          @click="switchMode(mode.key)"
        >{{ t(mode.labelKey) }}</button>
      </div>

      <!-- 收费提示：6 个创作模式都收费，且额度未知；不本地估算 -->
      <p v-if="currentMode.charge" class="hifly-extra-charge" data-testid="hifly-extra-charge">
        {{ t('hiflyExtraChargeHint') }}
      </p>

      <!-- 字段（由 MODES 配置驱动，避免 7 个表单各写一遍） -->
      <div class="hifly-extra-fields">
        <label v-for="field in currentMode.fields" :key="field.key" class="hifly-extra-field">
          <span class="hifly-extra-field-label">
            {{ t(field.labelKey) }}
            <em v-if="field.required" class="hifly-extra-required">*</em>
          </span>
          <input
            v-if="field.type === 'text' || field.type === 'number'"
            v-model.trim="draft[field.key]"
            class="form-input"
            :type="field.type === 'number' ? 'number' : 'text'"
            :placeholder="field.placeholder || ''"
            :data-testid="`hifly-extra-field-${field.key}`"
          />
          <span v-else-if="field.type === 'hint'" class="config-hint">{{ t(field.labelKey) }}</span>
        </label>
      </div>

      <!-- 模板选择（仅「网感模板」模式）：列表来自 listLivelyTemplates -->
      <div v-if="activeMode === 'template'" class="hifly-extra-templates" data-testid="hifly-extra-templates">
        <div class="hifly-extra-field-label">{{ t('hiflyExtraTemplatePick') }}</div>
        <div v-if="templatesLoading" class="config-hint">{{ t('hiflyExtraLoading') }}</div>
        <div v-else-if="templatesError" class="inline-error">{{ t('hiflyExtraTemplateLoadFailed') }}</div>
        <div v-else-if="templates.length === 0" class="config-hint">{{ t('hiflyExtraTemplateEmpty') }}</div>
        <div v-else class="hifly-extra-template-list">
          <button
            v-for="tpl in templates"
            :key="templateId(tpl)"
            type="button"
            class="hifly-extra-template"
            :class="{ 'hifly-extra-template-active': draft.template === templateId(tpl) }"
            :data-testid="`hifly-extra-template-${templateId(tpl)}`"
            @click="pickTemplate(tpl)"
          >{{ templateTitle(tpl) }}</button>
        </div>
      </div>

      <!-- 封面模式：额外加载封面模板列表 -->
      <div v-if="activeMode === 'cover'" class="hifly-extra-templates" data-testid="hifly-extra-cover-styles">
        <div class="hifly-extra-field-label">{{ t('hiflyExtraCoverStylePick') }}</div>
        <div v-if="coverStylesLoading" class="config-hint">{{ t('hiflyExtraLoading') }}</div>
        <div v-else-if="coverStyles.length === 0" class="config-hint">{{ t('hiflyExtraCoverStyleEmpty') }}</div>
        <div v-else class="hifly-extra-template-list">
          <button
            v-for="style in coverStyles"
            :key="styleId(style)"
            type="button"
            class="hifly-extra-template"
            :class="{ 'hifly-extra-template-active': draft.template === styleId(style) }"
            @click="draft.template = styleId(style)"
          >{{ styleTitle(style) }}</button>
        </div>
      </div>

      <div class="hifly-extra-actions">
        <button
          type="button"
          class="s2v-btn-primary s2v-btn-sm"
          :disabled="submitting || !canSubmit"
          data-testid="hifly-extra-submit"
          @click="submit"
        >{{ submitting ? t('hiflyExtraSubmitting') : t(currentMode.submitKey) }}</button>
        <span v-if="error" class="inline-error" data-testid="hifly-extra-error">{{ error }}</span>
      </div>

      <!-- 结果：taskId 可轮询/删除；封面直接给图片地址 -->
      <div v-if="result" class="hifly-extra-result" data-testid="hifly-extra-result">
        <span v-if="result.taskId">{{ t('hiflyExtraTaskCreated') }} {{ result.taskId }}</span>
        <span v-if="result.coverUrl">
          {{ t('hiflyExtraCoverCreated') }}
          <a :href="result.coverUrl" target="_blank" rel="noreferrer">{{ t('hiflyExtraOpenCover') }}</a>
        </span>
        <!-- 只有「普通视频创作」能删，翻译/唱歌/图片驱动的任务官方不支持删除 -->
        <button
          v-if="result.taskId && modeDeletable"
          type="button"
          class="s2v-btn-danger s2v-btn-sm"
          :disabled="deleting"
          data-testid="hifly-extra-delete"
          @click="removeWork"
        >{{ t('hiflyExtraDeleteWork') }}</button>
      </div>
    </template>
  </section>
</template>

<script>
/**
 * HiflyExtraPanel — 飞影 11 个扩展端点的统一面板（change: hifly-full-api-ui）。
 *
 * 为什么一个面板装 7 个模式：11 个端点里 6 个是「同一件事的不同输入方式」
 * （声音/模板/翻译/唱歌/图片/音频），字段高度重叠。用一个数据驱动的表单渲染器
 * 比写 7 个几乎相同的组件更不容易漂移；字段差异全部集中在 MODES 配置里。
 *
 * 三条产品约束（见 PRD-HIFLY-FULL-API §4/§5）：
 *  1. 6 个创作模式都收费且额度未知 ⇒ 固定显示「将消耗积分」，不本地估算金额，
 *     余额为 0 时禁用提交（避免白打一次必然失败的请求）。
 *  2. 只有普通视频创作的任务能删除 ⇒ 删除按钮只在 `modeDeletable` 的模式下出现。
 *  3. 能力未就绪（上游 adapter 方法不存在）⇒ 整体显示「暂不可用」而不是逐个报错。
 */

// 字段配置：required 只用于 UI 提示，真正校验在主进程（IPC + adapter 两层）。
const MODES = [
  {
    key: 'audio',
    labelKey: 'hiflyExtraModeAudio',
    submitKey: 'hiflyExtraSubmitCreate',
    charge: true,
    deletable: true,
    method: 'createByAudio',
    fields: [
      { key: 'fileId', type: 'text', labelKey: 'hiflyExtraFieldFileId', required: true },
      { key: 'avatar', type: 'text', labelKey: 'hiflyExtraFieldAvatar', required: true },
      { key: 'title', type: 'text', labelKey: 'hiflyExtraFieldTitle' },
    ],
  },
  {
    key: 'template',
    labelKey: 'hiflyExtraModeTemplate',
    submitKey: 'hiflyExtraSubmitCreate',
    charge: true,
    deletable: true,
    method: 'createByTemplate',
    fields: [
      { key: 'text', type: 'text', labelKey: 'hiflyExtraFieldText', required: true },
      { key: 'voice', type: 'text', labelKey: 'hiflyExtraFieldVoice', required: true },
      { key: 'avatar', type: 'text', labelKey: 'hiflyExtraFieldAvatar', required: true },
      { key: 'title', type: 'text', labelKey: 'hiflyExtraFieldTitle' },
    ],
  },
  {
    key: 'translate',
    labelKey: 'hiflyExtraModeTranslate',
    submitKey: 'hiflyExtraSubmitTranslate',
    charge: true,
    // 官方明确：翻译任务不支持 DELETE /video/task
    deletable: false,
    method: 'translate',
    fields: [
      { key: 'videoFileId', type: 'text', labelKey: 'hiflyExtraFieldVideoFileId', required: true },
      { key: 'targetLanguageCode', type: 'text', labelKey: 'hiflyExtraFieldTargetLang', required: true },
    ],
  },
  {
    key: 'sing',
    labelKey: 'hiflyExtraModeSing',
    submitKey: 'hiflyExtraSubmitCreate',
    charge: true,
    deletable: false,
    method: 'createBySing',
    fields: [
      { key: 'imageFileId', type: 'text', labelKey: 'hiflyExtraFieldImageFileId', required: true },
      { key: 'audioFileId', type: 'text', labelKey: 'hiflyExtraFieldAudioFileId', required: true },
      { key: 'hint', type: 'hint', labelKey: 'hiflyExtraSingHint' },
    ],
  },
  {
    key: 'image',
    labelKey: 'hiflyExtraModeImage',
    submitKey: 'hiflyExtraSubmitCreate',
    charge: true,
    deletable: false,
    method: 'createByImage',
    fields: [
      { key: 'imageFileId', type: 'text', labelKey: 'hiflyExtraFieldImageFileId', required: true },
      { key: 'voice', type: 'text', labelKey: 'hiflyExtraFieldVoice', required: true },
      { key: 'text', type: 'text', labelKey: 'hiflyExtraFieldText', required: true },
      { key: 'model', type: 'number', labelKey: 'hiflyExtraFieldModel', placeholder: '5' },
    ],
  },
  {
    key: 'audioTts',
    labelKey: 'hiflyExtraModeAudioTts',
    submitKey: 'hiflyExtraSubmitCreate',
    charge: true,
    deletable: true,
    method: 'audioTts',
    fields: [
      { key: 'voice', type: 'text', labelKey: 'hiflyExtraFieldVoice', required: true },
      { key: 'text', type: 'text', labelKey: 'hiflyExtraFieldText', required: true },
      { key: 'title', type: 'text', labelKey: 'hiflyExtraFieldTitle' },
    ],
  },
  {
    key: 'cover',
    labelKey: 'hiflyExtraModeCover',
    submitKey: 'hiflyExtraSubmitCover',
    // 创建封面**免费**——与上面 6 个模式相反，因此不显示收费提示
    charge: false,
    deletable: false,
    method: 'createCover',
    fields: [
      { key: 'content', type: 'text', labelKey: 'hiflyExtraFieldCoverContent', required: true },
      { key: 'canvasPreset', type: 'text', labelKey: 'hiflyExtraFieldCanvas', placeholder: '9:16' },
      { key: 'outputFormat', type: 'text', labelKey: 'hiflyExtraFieldFormat', placeholder: 'jpg' },
    ],
  },
]

export default {
  name: 'HiflyExtraPanel',
  props: {
    /** 从壳层注入的 i18n 函数（与其它面板同型） */
    t: { type: Function, required: true },
    /** 11 个端点的 API（由壳层把 src/api/hifly-extra.js 的导出聚成对象） */
    api: { type: Object, default: null },
  },
  data () {
    return {
      modes: MODES,
      activeMode: 'audio',
      draft: {},
      credit: null,
      unsupported: false,
      submitting: false,
      deleting: false,
      error: '',
      result: null,
      templates: [],
      templatesLoading: false,
      templatesError: false,
      coverStyles: [],
      coverStylesLoading: false,
    }
  },
  computed: {
    currentMode () {
      return this.modes.find((m) => m.key === this.activeMode) || this.modes[0]
    },
    modeDeletable () {
      return this.currentMode.deletable === true
    },
    /** 余额已知且 ≤ 0 时禁用提交（收费模式）；免费模式不受限。 */
    canSubmit () {
      if (!this.currentMode.charge) return true
      return this.credit === null || this.credit > 0
    },
  },
  watch: {
    activeMode () {
      this.result = null
      this.error = ''
      if (this.activeMode === 'template') this.loadTemplates()
      if (this.activeMode === 'cover') this.loadCoverStyles()
    },
  },
  async mounted () {
    await this.loadCredit()
  },
  methods: {
    async loadCredit () {
      if (!this.api || typeof this.api.credit !== 'function') {
        this.unsupported = true
        return
      }
      const res = await this.api.credit()
      if (res && res.code === 0 && res.data && Number.isInteger(res.data.left)) {
        this.credit = res.data.left
      } else if (res && res.message === 'HIFLY_EXTRA_UNSUPPORTED') {
        // 上游能力未就绪：整体显示「暂不可用」，不逐个报错
        this.unsupported = true
      } else {
        this.credit = null
      }
    },
    switchMode (key) {
      this.activeMode = key
    },
    pickTemplate (tpl) {
      this.draft.template = this.templateId(tpl)
    },
    templateId (tpl) {
      return String((tpl && (tpl.template || tpl.id)) || '')
    },
    templateTitle (tpl) {
      return String((tpl && (tpl.title || tpl.name)) || this.templateId(tpl))
    },
    styleId (style) {
      return String((style && (style.template || style.id)) || '')
    },
    styleTitle (style) {
      return String((style && (style.title || style.name)) || this.styleId(style))
    },
    async loadTemplates () {
      if (!this.api || typeof this.api.livelyTemplates !== 'function') return
      this.templatesLoading = true
      this.templatesError = false
      try {
        const res = await this.api.livelyTemplates({ page: 1, size: 20, type: 0 })
        if (res && res.code === 0 && res.data && Array.isArray(res.data.templates)) {
          this.templates = res.data.templates
        } else {
          this.templatesError = true
        }
      } finally {
        this.templatesLoading = false
      }
    },
    async loadCoverStyles () {
      if (!this.api || typeof this.api.coverStyles !== 'function') return
      this.coverStylesLoading = true
      try {
        const res = await this.api.coverStyles({ page: 1, size: 20 })
        if (res && res.code === 0 && res.data && Array.isArray(res.data.styles)) {
          this.coverStyles = res.data.styles
        }
      } finally {
        this.coverStylesLoading = false
      }
    },
    buildPayload () {
      const payload = {}
      for (const field of this.currentMode.fields) {
        if (field.type === 'hint') continue
        const raw = this.draft[field.key]
        if (raw === undefined || raw === null || String(raw).trim() === '') continue
        payload[field.key] = field.type === 'number' ? Number(raw) : String(raw).trim()
      }
      return payload
    },
    async submit () {
      if (!this.api || typeof this.api[this.currentMode.method] !== 'function') {
        this.error = this.t('hiflyExtraUnsupported')
        return
      }
      this.submitting = true
      this.error = ''
      this.result = null
      try {
        const res = await this.api[this.currentMode.method](this.buildPayload())
        if (!res || res.code !== 0) {
          // 服务端 message 是开发者向技术文案，不直出；但 UNSUPPORTED 要单独说清
          this.error = (res && res.message === 'HIFLY_EXTRA_UNSUPPORTED')
            ? this.t('hiflyExtraUnsupported')
            : this.t('hiflyExtraFailed')
          return
        }
        const data = res.data || {}
        this.result = { taskId: data.taskId || '', coverUrl: data.coverUrl || '' }
        // 收费模式成功后刷新余额（不本地自减——并发任务会让推算失真）
        if (this.currentMode.charge) await this.loadCredit()
      } finally {
        this.submitting = false
      }
    },
    async removeWork () {
      if (!this.api || typeof this.api.deleteWork !== 'function' || !this.result) return
      this.deleting = true
      try {
        const res = await this.api.deleteWork({ taskId: this.result.taskId })
        if (res && res.code === 0) {
          this.result = null
        } else {
          this.error = this.t('hiflyExtraDeleteFailed')
        }
      } finally {
        this.deleting = false
      }
    },
  },
}
</script>

<style scoped>
.hifly-extra-panel { display: flex; flex-direction: column; gap: 10px; }
.hifly-extra-header { display: flex; justify-content: space-between; align-items: baseline; }
.hifly-extra-title { font-weight: 600; }
.hifly-extra-credit { font-size: 12px; opacity: 0.75; }
.hifly-extra-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.hifly-extra-tab { font-size: 12px; padding: 4px 10px; border-radius: 12px; border: 1px solid rgba(0,0,0,0.15); background: transparent; cursor: pointer; }
.hifly-extra-tab-active { background: rgba(0,0,0,0.08); font-weight: 600; }
.hifly-extra-charge { font-size: 12px; color: #b45309; }
.hifly-extra-fields { display: flex; flex-direction: column; gap: 6px; }
.hifly-extra-field { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.hifly-extra-field-label { font-weight: 500; }
.hifly-extra-required { color: #dc2626; font-style: normal; }
.hifly-extra-template-list { display: flex; flex-wrap: wrap; gap: 6px; }
.hifly-extra-template { font-size: 12px; padding: 4px 8px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.15); background: transparent; cursor: pointer; }
.hifly-extra-template-active { background: rgba(0,0,0,0.08); font-weight: 600; }
.hifly-extra-actions { display: flex; align-items: center; gap: 10px; }
.hifly-extra-result { display: flex; align-items: center; gap: 10px; font-size: 12px; }
</style>
