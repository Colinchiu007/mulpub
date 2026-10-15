<template>
  <div class="article-editor" data-testid="publish-editor">
    <!-- Mode toggle -->
    <div class="editor-mode-bar">
      <button
        :class="{ active: editorMode === 'rich' }"
        @click="editorMode = 'rich'"
        class="mode-btn"
      >
        富文本
      </button>
      <button
        :class="{ active: editorMode === 'markdown' }"
        @click="editorMode = 'markdown'"
        class="mode-btn"
      >
        Markdown
      </button>
    </div>

    <!-- Rich text mode (Quill) -->
    <QuillEditor
      v-if="editorMode === 'rich'"
      v-model:content="richContent"
      content-type="html"
      :options="editorOptions"
      :style="{ minHeight: height }"
    />

    <!-- Markdown mode -->
    <textarea
      v-else
      v-model="mdContent"
      class="md-editor"
      :placeholder="placeholder"
      :maxlength="maxChars"
      :style="{ minHeight: height }"
      spellcheck="false"
    />

    <!-- 字数计数（PRD-PLATFORM-CHAR-LIMITS-2026-10-02 §F1）：
         与发布校验同口径（原始字符串 Unicode 码点数），超限变红。 -->
    <div
      class="article-char-counter"
      :class="{ 'article-char-counter--over': charCount > maxChars }"
      data-testid="article-char-counter"
    >
      {{ charCount }}/{{ maxChars }}{{ t('publishPage.articleCharCount') }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { QuillEditor } from '@vueup/vue-quill'
import '@vueup/vue-quill/dist/vue-quill.snow.css'
import { useI18n } from 'vue-i18n'
import { APP_ARTICLE_CONTENT_MAX } from '@/features/publish/publish-contract'
// 正文承载形态原语（shared-utils ESM 孪生，已在 vite.config.js 登记 alias）：
// 富文本模式是 Quill 的 `content-type="html"` —— 它把传进去的值原样写进
// `quill.root.innerHTML`。纯文本（`第一段\n\n第二段`）进 HTML 语义时换行属**可忽略空白**，
// 整篇会塌成一整段，回写 modelValue 的又是 Quill 的 innerHTML（单个 `<p>`）——
// 2026-10-15 百家号「正文一整段」二次报障的第一性根因就在这一步：内容在**进入发布链之前**
// 就已是一段，发布链侧 `formatArticleBody` 再正确也救不回来。
// 故装载前必须经 `toHtmlBody`：纯文本按行成段、已是 HTML 原样透传（与发布链同判据）。
import { toHtmlBody } from '@multi-publish/shared-utils/src/article-body-format'

// 本地注册（2026-10-15 fix-newtab-home-slow）：QuillEditor 原先由 main.js 以
// app.component 全局注册，那会把 @vueup/vue-quill 拉进首屏 bundle 闭包。
// 改成本地注册后，Quill 只随 /publish 路由的懒加载 chunk 一起下载
// （实测 quill-DQhlSbIM.js 144KB 独立 chunk，不进 index.js）。
// 契约锁：src/main.bundle-contract.test.js 断言 main.js 不得再出现它。
const components = { QuillEditor }

const { t } = useI18n()

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  height: {
    type: String,
    default: '400px'
  },
  placeholder: {
    type: String,
    default: '在此编辑文章内容...'
  },
  // 应用端正文字数上限（PRD §F1）；默认取契约常量，可被调用方覆盖
  maxChars: {
    type: Number,
    default: APP_ARTICLE_CONTENT_MAX
  }
})

const emit = defineEmits(['update:modelValue'])

const editorMode = ref('rich')

// 与 validatePlatformContent / truncateByChars 同口径：按 Unicode 码点计数
// （emoji 等代理对算 1 个字符），禁止另用 .length（UTF-16 单元）造成口径漂移。
const charCount = computed(() => Array.from(props.modelValue || '').length)

const richContent = computed({
  // 装载：纯文本按行成段（`toHtmlBody`），已是 HTML 幂等透传。
  // ⛔ 不得改回直接 `props.modelValue`：那会让 Quill 把换行当可忽略空白，
  // 段落结构在编辑器装载那一刻就被吞掉（2026-10-15 百家号事故，回归锁见
  // ArticleEditor.test.js「富文本装载不得吞段落」与 article-body-format-parity.test.js）。
  get: () => toHtmlBody(props.modelValue),
  // 回写：Quill 的 innerHTML（此时每段都是真 `<p>` 块）；纯文本承载平台由发布链
  // 的 formatArticleBody 统一转回纯文本，故此处不做反向转换。
  set: (val) => emit('update:modelValue', val)
})

const mdContent = computed({
  get: () => props.modelValue,
  set: (val) => {
    emit('update:modelValue', val)
  }
})

const editorOptions = {
  theme: 'snow',
  placeholder: props.placeholder,
  modules: {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['blockquote', 'code-block'],
      [{ align: [] }],
      ['link', 'image'],
      ['clean']
    ]
  }
}
</script>

<style scoped>
.article-editor {
  width: 100%;
}
.editor-mode-bar {
  display: flex;
  gap: 0;
  margin-bottom: 0;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background: var(--bg-secondary);
  padding: 4px 8px;
}
.mode-btn {
  padding: 4px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--muted);
  border-radius: 3px;
  transition: all 0.15s;
}
.mode-btn.active {
  background: var(--coral);
  color: var(--surface);
}
.md-editor {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 0 0 4px 4px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  resize: vertical;
  background: var(--bg);
  color: var(--text);
  tab-size: 2;
}
.md-editor:focus {
  outline: none;
  border-color: var(--coral);
}
.article-char-counter {
  display: flex;
  justify-content: flex-end;
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  color: var(--muted);
  text-align: right;
  user-select: none;
}
.article-char-counter--over {
  color: var(--danger, #e5484d);
  font-weight: 600;
}
.article-editor :deep(.ql-editor) {
  min-height: v-bind(height);
  font-size: var(--font-size-base);
  line-height: 1.8;
}
.article-editor :deep(.ql-toolbar) {
  border-radius: 0;
  border-top: none;
}
.article-editor :deep(.ql-container) {
  border-radius: 0 0 4px 4px;
  border-top: none;
}
</style>
