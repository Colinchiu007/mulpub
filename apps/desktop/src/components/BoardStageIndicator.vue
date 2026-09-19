<template>
  <div class="stage-indicator">
    <template v-for="(stage, i) in stages" :key="i">
      <div
        class="stage-node"
        :class="stageClass(stage, i)"
        @click="$emit('select', i)"
      >
        <div class="stage-icon">
          <span v-if="stageStatus(stage, i) === 'completed'">✓</span>
          <span v-else-if="stageStatus(stage, i) === 'failed'">✕</span>
          <span v-else-if="stageStatus(stage, i) === 'running'" class="pulse"></span>
          <span v-else>○</span>
        </div>
        <div class="stage-label" :class="{ active: i === currentIndex }">
          {{ friendlyName(stage.name || stage) }}
        </div>
      </div>
      <div
        v-if="i < stages.length - 1"
        class="stage-connector"
        :class="{ completed: stageStatus(stages[i], i) === 'completed' }"
      ></div>
    </template>
  </div>
</template>

<script setup>
const props = defineProps({
  stages: { type: Array, default: () => [] },
  currentIndex: { type: Number, default: -1 },
})
defineEmits(['select'])

const nameMap = {
  research: '调研',
  proposal: '方案',
  script: '脚本',
  scenes: '分镜',
  storyboard: '分镜',
  assets: '素材',
  editing: '剪辑',
  edit: '剪辑',
  compose: '合成',
  render: '渲染',
  publish: '发布',
  upload: '上传',
  transcribe: '转录',
  captions: '字幕',
  ingest: '导入',
  grade: '调色',
  concept: '概念',
  animate: '动画',
  avatar_select: '选择头像',
  generate: '生成',
  character_design: '角色设计',
  rigging: '绑定',
  analyze: '分析',
  extract: '提取',
  caption: '字幕',
  export: '导出',
  narrate: '旁白',
  plan: '规划',
  merge: '合并',
  translate: '翻译',
  tts: '配音',
  sync: '同步',
  visualize: '可视化',
  assemble: '组装',
  record: '录制',
  annotate: '标注',
  verify: '验证',
  report: '报告',
  split: '分句',
  optimize: '优化',
  select_video_scenes: '视频场景选择',
  generate_assets: '资源生成',
}

function friendlyName(name) {
  if (!name) return ''
  return nameMap[name] || name
}

function stageStatus(stage, index) {
  if (stage && typeof stage === 'object' && stage.status) {
    return stage.status
  }
  if (index < props.currentIndex) return 'completed'
  if (index === props.currentIndex) return 'running'
  return 'pending'
}

function stageClass(stage, index) {
  const s = stageStatus(stage, index)
  return 'stage-' + s
}
</script>

<style scoped>
.stage-indicator {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0;
  padding: 16px 0;
}
.stage-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  min-width: 60px;
}
.stage-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  border: 2px solid var(--ep-border);
  background: #fff;
  color: var(--ep-info);
}
.stage-label {
  font-size: 12px;
  margin-top: 6px;
  color: var(--text-muted, #909399);
  text-align: center;
  white-space: nowrap;
}
.stage-label.active {
  font-weight: 700;
  color: var(--text, #303133);
}
.stage-completed .stage-icon {
  background: var(--ep-success);
  border-color: var(--ep-success);
  color: #fff;
}
.stage-running .stage-icon {
  background: var(--ep-primary);
  border-color: var(--ep-primary);
  color: #fff;
}
.stage-failed .stage-icon {
  background: var(--ep-danger);
  border-color: var(--ep-danger);
  color: #fff;
}
.stage-connector {
  flex: 1;
  min-width: 20px;
  height: 2px;
  background: var(--ep-border);
  margin-top: 13px;
  margin-left: 4px;
  margin-right: 4px;
}
.stage-connector.completed {
  background: var(--ep-success);
}
.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: pulse-anim 1.5s infinite;
}
@keyframes pulse-anim {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.7); }
}
</style>
