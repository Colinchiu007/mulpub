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
      :style="{ minHeight: height }"
      spellcheck="false"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { QuillEditor } from '@vueup/vue-quill'
import '@vueup/vue-quill/dist/vue-quill.snow.css'

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
  }
})

const emit = defineEmits(['update:modelValue'])

const editorMode = ref('rich')

const richContent = computed({
  get: () => props.modelValue,
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
  font-size: 12px;
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
  font-size: 14px;
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
.article-editor :deep(.ql-editor) {
  min-height: v-bind(height);
  font-size: 15px;
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
