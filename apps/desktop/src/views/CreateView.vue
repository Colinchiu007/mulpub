<template>
  <div class="create-page" :class="{ 'create-page--pipeline-list': view === 'pipelines' && !selectedPipeline, 'create-page--pipeline-detail': view === 'pipelines' && selectedPipeline }">
    <div class="page-header">
      <div class="page-header-nav">
        <button class="nav-arrow-btn" @click="goBack" :disabled="!canGoBack" title="上一页">←</button>
        <button class="nav-arrow-btn" @click="goForward" :disabled="!canGoForward" title="下一页">→</button>
      </div>
      <h1>视频创作</h1>
      <p class="text-muted">基于 OpenMontage 流水线引擎，AI 驱动从脚本到成片的全流程</p>
    </div>

    <!-- Remotion 状态提示 -->
    <div v-if="renderStatus && !renderStatus.ready" class="status-banner warn">
      <span>⚠️ Remotion 渲染引擎未就绪</span>
      <span class="detail" v-if="renderStatus.ipcError">IPC 调用失败：{{ renderStatus.message || '检查 preload 是否暴露该方法' }}</span>
      <span class="detail" v-else-if="!renderStatus.composerExists">缺少 remotion-composer</span>
      <span class="detail" v-else-if="!renderStatus.nodeModulesExist">依赖未安装</span>
      <button v-if="!renderStatus.ipcError && renderStatus.composerExists && !renderStatus.nodeModulesExist" class="btn-install" @click="installDeps" :disabled="installing">{{ installing ? '安装中...' : '安装依赖' }}</button>
    </div>
    <div v-if="installLog" class="install-log">{{ installLog }}</div>

    <!-- 视图切换 -->
    <div class="view-tabs">
      <button :class="['view-tab', { active: view === 'pipelines' }]" @click="switchView('pipelines')">流水线创作</button>
      <button :class="['view-tab', { active: view === 'quick' }]" @click="switchView('quick')">快速渲染</button>
      <button :class="['view-tab', { active: view === 'history' }]" @click="switchView('history')">历史记录</button>
    </div>

    <div v-if="s2vOptionsToast" class="s2v-options-toast" role="status" data-testid="s2v-options-toast">{{ s2vOptionsToast }}</div>

    <!-- ==================== 流水线启动页（流水线创作） ==================== -->
    <div v-if="view === 'pipelines'" class="view-pane">
      <!-- 流水线列表 -->
      <div v-if="!selectedPipeline">
        <PipelineSelector
          :pipelines="pipelines"
          :loading="pipelineLoading"
          :error="pipelineError"
          :text-only="textPrefilledFromDraft"
          @select="selectPipeline"
          @retry="loadPipelines"
        />
      </div>

      <!-- 流水线启动页：配置与执行 -->
      <div v-else class="pipeline-detail">
        <button class="back-btn" @click="goToHistory()">← 返回</button>

        <div class="detail-header">
          <h2>{{ pipelineName(selectedPipeline.name) }}</h2>
          <p class="detail-desc">{{ pipelineDescription(selectedPipeline.name) }}</p>
          <p v-if="pipelineMode(selectedPipeline.name)" class="detail-mode" data-testid="pipeline-mode-label">{{ pipelineMode(selectedPipeline.name) }}</p>
        </div>

<div class="pipeline-detail-scroll">
        <!-- 输入区域 -->
        <div class="input-section">
          <h3>输入内容</h3>
          <div class="input-tabs">
            <button :class="['input-tab', { active: inputMode === 'text' }]" @click="inputMode = 'text'">文案</button>
            <button v-if="!isAutoPipeline(selectedPipeline.name)" :class="['input-tab', { active: inputMode === 'images' }]" @click="inputMode = 'images'">图片</button>
            <button v-if="!isAutoPipeline(selectedPipeline.name)" :class="['input-tab', { active: inputMode === 'audio' }]" @click="inputMode = 'audio'">旁白/批量音频</button>
            <button v-if="!isAutoPipeline(selectedPipeline.name) || isMediaAutoPipeline(selectedPipeline.name)" :class="['input-tab', { active: inputMode === 'video' }]" @click="inputMode = 'video'">视频素材</button>
          </div>

          <div v-if="inputMode === 'text'" class="input-area">
            <textarea v-model="pipelineText" placeholder="输入视频文案、主题描述或脚本..." rows="8" class="form-textarea" @input="enforceStory2VideoTextLimit"></textarea>
            <p v-if="isOrchestratedPipeline(selectedPipeline.name)" class="story2video-text-count">{{ story2videoTextCharacterCount }}/{{ MAX_STORY2VIDEO_TEXT_CHARACTERS }} 字符</p>
            <p v-if="s2vEstimateSummary" class="story2video-estimate" data-testid="s2v-estimate-row">
              预估 {{ s2vEstimateSummary.sceneCount }} 个分镜 · 旁白约 {{ s2vEstimateSummary.durationMin }}~{{ s2vEstimateSummary.durationMax }} 秒 · 成本约 ¥{{ s2vEstimateSummary.totalCost.toFixed(2) }}
              <span class="s2v-estimate-note">{{ s2vEstimateSummary.calibrated ? '（按本地 TTS 样本校准）' : '（静态估算，样本积累后自动校准）' }}</span>
            </p>
          </div>
          <div v-if="inputMode === 'images' && !isOrchestratedPipeline(selectedPipeline.name)" class="input-area">
            <div class="upload-zone" @click="$refs.pipelineFileInput?.click()" @dragover.prevent @drop.prevent="handlePipelineDrop">
              <p v-if="pipelineImages.length === 0">点击或拖拽图片到此处</p>
              <div v-else class="image-grid">
                <div v-for="(img, i) in pipelineImages" :key="i" class="image-thumb">
                  <img :src="img.preview" />
                  <button class="remove-btn" @click.stop="pipelineImages.splice(i, 1)">×</button>
                </div>
              </div>
            </div>
            <input ref="pipelineFileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple style="display:none" @change="handlePipelineFiles" />
            <p class="config-hint">{{ mediaRequirementsImageText }}</p>
          </div>
          <div v-if="inputMode === 'audio' && !isOrchestratedPipeline(selectedPipeline.name)" class="input-area">
            <div class="upload-zone" @click="$refs.pipelineAudioInput?.click()">
              <p v-if="pipelineAudio.length === 0">点击选择旁白音频，可一次选择多个片段</p>
              <div v-else class="file-list">
                <div v-for="(audio, i) in pipelineAudio" :key="audio.path || i" class="audio-file-row" @click.stop>
                  <div class="file-row">
                    <span>{{ i + 1 }}. {{ audio.name }}</span>
                    <button class="remove-btn" @click.stop="pipelineAudio.splice(i, 1)">×</button>
                  </div>
                  <textarea
                    v-model="audio.transcript"
                    class="form-textarea audio-transcript"
                    rows="2"
                    :placeholder="'输入或识别第 ' + (i + 1) + ' 段旁白文字'"
                  ></textarea>
                  <div class="audio-row-actions">
                    <button
                      type="button"
                      class="btn-secondary"
                      :disabled="audio.transcribing"
                      @click.stop="transcribePipelineAudio(i)"
                    >{{ audio.transcribing ? '识别中...' : '识别旁白' }}</button>
                    <span v-if="audio.transcriptionError" class="inline-error">{{ audio.transcriptionError }}</span>
                  </div>
                </div>
              </div>
            </div>
            <input ref="pipelineAudioInput" type="file" accept=".wav,.m4a,.mp3,audio/wav,audio/x-m4a,audio/mpeg" multiple style="display:none" @change="handlePipelineAudio" />
            <p class="config-hint">{{ mediaRequirementsAudioText }}</p>
          </div>
          <div v-if="inputMode === 'video' && !isOrchestratedPipeline(selectedPipeline.name)" class="input-area">
            <div class="upload-zone" @click="$refs.pipelineVideoInput?.click()">
              <p v-if="!pipelineVideo">点击上传参考视频（用于电影感/蒙太奇流水线）</p>
              <p v-else>✅ {{ pipelineVideo.name }}</p>
            </div>
            <input ref="pipelineVideoInput" type="file" accept="video/*" style="display:none" @change="handlePipelineVideo" />
            <p class="config-hint">{{ mediaRequirementsVideoText }}</p>
            <textarea
              v-if="isMediaAutoPipeline(selectedPipeline.name)"
              v-model="pipelineText"
              placeholder="口播文案（口播视频流水线必填，逐行或分段）..."
              rows="6"
              class="form-textarea media-script-input"
            ></textarea>
          </div>
        </div>

        <!-- 风格选择 -->
        <div v-if="!isOrchestratedPipeline(selectedPipeline.name)" class="config-section">
          <h3>视觉风格</h3>
          <div class="style-grid">
            <button v-for="s in styles" :key="s.value" :class="['style-card', { active: selectedStyle === s.value }]" @click="selectedStyle = s.value">
              <span class="style-name">{{ s.label }}</span>
              <span class="style-desc">{{ s.desc }}</span>
            </button>
          </div>
        </div>

        <!-- 常规流水线高级配置 -->
        <div v-if="!isOrchestratedPipeline(selectedPipeline.name)" class="config-section">
          <h3>高级配置</h3>
          <div class="config-grid">
            <div class="config-item">
              <label>LLM 模型</label>
              <span class="config-hint">使用默认模型（可在模型服务商设置中配置）</span>
              <a href="#/model-providers" class="config-hint-link">前往配置 →</a>
            </div>
            <div class="config-item">
              <label>温度: {{ llmConfig.temperature }}</label>
              <input type="range" v-model.number="llmConfig.temperature" min="0" max="1" step="0.1" class="form-range" />
            </div>
            <div class="config-item">
              <label>预算模式</label>
              <select v-model="budgetConfig.mode" class="form-select">
                <option value="observe">仅观察</option>
                <option value="warn">超额警告</option>
                <option value="cap">硬性上限</option>
              </select>
            </div>
            <div class="config-item">
              <label>预算上限 ($)</label>
              <input type="number" v-model.number="budgetConfig.totalUsd" min="0" step="0.5" class="form-input" />
            </div>
            <div class="config-item">
              <label>检查点策略</label>
              <select v-model="checkpointPolicy" class="form-select">
                <option value="guided">引导式（推荐）</option>
                <option value="manual_all">全部手动确认</option>
                <option value="auto_noncreative">自动跳过非创意阶段</option>
              </select>
            </div>
            <div class="config-item">
              <label>分镜模式</label>
              <select v-model="storyboardMode" class="form-select" data-testid="storyboard-mode-select">
                <option value="auto">自动（推荐）</option>
                <option value="creative">创意拓展（一句话生成整个视频）</option>
                <option value="fidelity">按原文保真（长文案按原文实现）</option>
                <option value="hybrid">混合（保真主旨 + 允许演绎）</option>
              </select>
              <span class="config-hint">自动：短文案（≤80 字）创意拓展，长文案（≥300 字）按原文保真，中间态混合；分镜会按原文提取关键人物/事件并对齐校验。</span>
            </div>
          </div>
        </div>

        <!-- Story2Video 配置：快速模式 + 五个折叠区 -->
        <div v-if="isOrchestratedPipeline(selectedPipeline.name)" class="s2v-config-sections" data-testid="story2video-config-sections">
          <div v-if="s2vActiveConfigProfile" class="s2v-active-config" data-testid="s2v-active-config" role="status">
            <span class="s2v-active-config-label">{{ translateWithLocaleFallback('create.story2video.configProfile.activeLabel', '当前配置', 'Active configuration') }}</span>
            <span class="s2v-active-config-name">{{ s2vActiveConfigProfile }}</span>
          </div>
          <details
            class="s2v-config-section"
            data-testid="s2v-section-basic"
            :open="s2vOpenSections.basic"
            @toggle="setS2VSectionOpen('basic', $event)"
          >
            <summary class="s2v-section-summary">
              <span>{{ s2vSectionLabel('basic') }}</span>
              <span class="s2v-summary">{{ s2vSectionSummary('basic') }}</span>
            </summary>
            <div class="config-grid">
              <div class="config-item" v-if="s2vOptionVisible('basic.resolution')">
                <label>比例与分辨率</label>
                <select v-model="activeOutputConfig.resolution" class="form-select">
                  <option v-for="opt in outputResolutionOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('basic.voiceSpeed')">
                <label>旁白语速: {{ Number(s2vConfig.voiceSpeed).toFixed(1) }}x</label>
                <input type="range" v-model.number="s2vConfig.voiceSpeed" min="0.5" max="2" step="0.1" class="form-range" />
              </div>
              <div class="config-item" v-if="s2vOptionVisible('basic.voiceVolume')">
                <label>旁白音量: {{ Number(s2vConfig.voiceVolume).toFixed(2) }}</label>
                <input type="range" v-model.number="s2vConfig.voiceVolume" min="0" max="2" step="0.05" class="form-range" />
              </div>
              <div class="config-item" v-if="s2vOptionVisible('basic.voicePreview')">
                <label>旁白试听</label>
                <button type="button" class="btn-secondary" data-testid="s2v-voice-preview" @click="previewS2VVoice">试听</button>
                <span class="config-hint">按当前旁白语速与音量播放一段试听音频</span>
              </div>
              <div class="config-item config-span-2">
                <label>基础说明</label>
                <p class="config-hint">确认基础参数后，点击“启动流水线”即可进行流水线自动多个阶段，不需逐步确认。</p>
              </div>
            </div>
          </details>

          <details
            class="s2v-config-section"
            data-testid="s2v-section-appearance"
            :open="s2vOpenSections.appearance"
            @toggle="setS2VSectionOpen('appearance', $event)"
          >
            <summary class="s2v-section-summary">
              <span>{{ s2vSectionLabel('appearance') }}</span>
              <span class="s2v-summary">{{ s2vSectionSummary('appearance') }}</span>
            </summary>
            <div class="config-grid">
              <div class="config-item" v-if="s2vOptionVisible('visual.imageStyle')">
                <label>图片风格</label>
                <select v-model="s2vConfig.imageStyle" class="form-select">
                  <option value="cinematic">电影感</option>
                  <option value="realistic">写实</option>
                  <option value="anime">动漫</option>
                  <option value="watercolor">水彩</option>
                  <option value="minimalist">极简</option>
                </select>
                <span class="config-hint">{{ story2videoImageStyleHint }}</span>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.promptStyle')">
                <label>提示词风格</label>
                <select v-model="s2vConfig.promptStyle" class="form-select">
                  <option value="realistic">写实</option>
                  <option value="cinematic">电影感</option>
                  <option value="anime">动漫</option>
                  <option value="watercolor">水彩</option>
                  <option value="minimalist">极简</option>
                </select>
                <span class="config-hint">{{ story2videoPromptStyleHint }}</span>
              </div>
              <div class="config-item">
                <label>{{ s2vMaxPromptLengthLabel }}</label>
                <select v-model="s2vConfig.maxPromptLength" class="form-select" data-testid="s2v-max-prompt-length-select">
                  <option v-for="n in s2vMaxPromptLengthOptions" :key="n" :value="n">{{ n }}</option>
                </select>
                <span class="config-hint">{{ s2vMaxPromptLengthHint }}</span>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.imageEffect')">
                <label>图片动效</label>
                <select v-model="s2vConfig.imageEffect" class="form-select">
                  <option value="none">无效果</option>
                  <option value="zoom-in">慢慢放大</option>
                  <option value="zoom-out">慢慢缩小</option>
                  <option value="pan-left">向左平移</option>
                  <option value="pan-right">向右平移</option>
                  <option value="pan-up">向上平移</option>
                  <option value="pan-down">向下平移</option>
                  <option value="zoom-pan">放大并平移</option>
                  <option value="rotate">缓慢旋转</option>
                  <option value="blur-in">模糊渐入</option>
                </select>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.transition')">
                <label>转场</label>
                <select v-model="s2vConfig.transition" class="form-select">
                  <option value="none">直接切换</option>
                  <option value="fade">渐隐渐显</option>
                  <option value="slide-left">左滑</option>
                  <option value="slide-right">右滑</option>
                  <option value="slide-up">上滑</option>
                  <option value="slide-down">下滑</option>
                </select>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.subtitleSize')">
                <label>字幕字号</label>
                <select v-model="s2vConfig.subtitleSize" class="form-select">
                  <option value="size1">特小</option>
                  <option value="size2">小</option>
                  <option value="size3">中</option>
                  <option value="size4">大</option>
                  <option value="size5">特大</option>
                  <option value="size6">超大</option>
                </select>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.subtitleStyle')">
                <label>字幕样式</label>
                <select v-model="s2vConfig.subtitleStyleName" class="form-select">
                  <option value="style1">描边</option>
                  <option value="style2">背景框</option>
                  <option value="style3">粗描边</option>
                </select>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.subtitleEnabled')">
                <label>字幕</label>
                <select v-model="s2vConfig.subtitleEnabled" class="form-select">
                  <option :value="true">启用</option>
                  <option :value="false">关闭</option>
                </select>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('voice.bgm')">
                <label>背景音乐</label>
                <div class="inline-file-control">
                  <select v-model="s2vConfig.bgmPath" class="form-select" data-testid="s2v-bgm-select">
                    <option value="">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.noBgm', '不使用背景音乐', 'No background music') }}</option>
                    <option v-for="item in s2vBgmLibrary" :key="item.id" :value="item.path">{{ item.name }}</option>
                    <option v-if="s2vLegacyBgmPath" :value="s2vLegacyBgmPath">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.legacyBgm', '已选音频（未入库）', 'Selected audio (not in library)') }}</option>
                  </select>
                  <button type="button" class="btn-secondary" data-testid="s2v-bgm-manage-button" @click="openBgmLibraryDialog">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.manage', '管理背景音乐', 'Manage music') }}</button>
                </div>
                <p class="config-hint">{{ mediaRequirementsBgmText }}</p>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('voice.bgmVolume')">
                <label>背景音乐音量: {{ s2vConfig.bgmVolume }}</label>
                <input type="range" v-model.number="s2vConfig.bgmVolume" min="0" max="10" step="1" class="form-range" />
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.watermarkText')">
                <label>{{ translateWithLocaleFallback('create.story2video.watermark.label', 'Watermark text', 'Watermark text') }}</label>
                <input v-model.trim="s2vConfig.watermarkText" class="form-input" :placeholder="translateWithLocaleFallback('create.story2video.watermark.placeholder', 'Optional', 'Optional')" />
              </div>
              <div class="config-item" data-testid="s2v-watermark-position" v-if="s2vOptionVisible('visual.watermarkPosition')">
                <label>{{ translateWithLocaleFallback('create.story2video.watermark.positionLabel', 'Watermark position', 'Watermark position') }}</label>
                <select v-model="s2vConfig.watermarkConfig.position" class="form-select">
                  <option value="center">{{ translateWithLocaleFallback('create.story2video.watermark.positionCenter', 'Center', 'Center') }}</option>
                  <option value="top-left">{{ translateWithLocaleFallback('create.story2video.watermark.positionTopLeft', 'Top left', 'Top left') }}</option>
                  <option value="top-right">{{ translateWithLocaleFallback('create.story2video.watermark.positionTopRight', 'Top right', 'Top right') }}</option>
                  <option value="bottom-left">{{ translateWithLocaleFallback('create.story2video.watermark.positionBottomLeft', 'Bottom left', 'Bottom left') }}</option>
                  <option value="bottom-right">{{ translateWithLocaleFallback('create.story2video.watermark.positionBottomRight', 'Bottom right', 'Bottom right') }}</option>
                  <option value="moving">{{ translateWithLocaleFallback('create.story2video.watermark.positionMoving', 'Moving (smooth drift)', 'Moving (smooth drift)') }}</option>
                </select>
                <p v-if="s2vConfig.watermarkConfig.position === 'moving'" class="config-hint">{{ translateWithLocaleFallback('create.story2video.watermark.movingHint', 'Moving is a smooth looping drift: the watermark starts near the center and wanders along a sine path, avoiding the flicker of per-frame random motion.', 'Moving is a smooth looping drift: the watermark starts near the center and wanders along a sine path, avoiding the flicker of per-frame random motion.') }}</p>
              </div>
              <div class="config-item" data-testid="s2v-watermark-fontsize" v-if="s2vOptionVisible('visual.watermarkFontSize')">
                <label>{{ translateWithLocaleFallback('create.story2video.watermark.fontSizeLabel', 'Watermark size', 'Watermark size') }}</label>
                <select v-model="s2vConfig.watermarkConfig.fontSize" class="form-select">
                  <option :value="16">16</option>
                  <option :value="24">24</option>
                  <option :value="32">32</option>
                  <option :value="40">40</option>
                  <option :value="48">48</option>
                </select>
                <span class="config-hint">{{ translateWithLocaleFallback('create.story2video.watermark.fontSizeHint', 'Larger sizes are more prominent; 24-40 recommended.', 'Larger sizes are more prominent; 24-40 recommended.') }}</span>
              </div>
              <div class="config-item" data-testid="s2v-watermark-opacity" v-if="s2vOptionVisible('visual.watermarkOpacity')">
                <label>{{ translateWithLocaleFallback('create.story2video.watermark.opacityLabel', 'Watermark opacity', 'Watermark opacity') }}</label>
                <select v-model="s2vConfig.watermarkConfig.opacity" class="form-select">
                  <option :value="0.1">10%</option>
                  <option :value="0.2">20%</option>
                  <option :value="0.3">30%</option>
                  <option :value="0.4">40%</option>
                  <option :value="0.5">50%</option>
                  <option :value="0.6">60%</option>
                  <option :value="0.7">70%</option>
                  <option :value="0.8">80%</option>
                  <option :value="0.9">90%</option>
                  <option :value="1.0">100%</option>
                </select>
                <span class="config-hint">{{ translateWithLocaleFallback('create.story2video.watermark.opacityHint', 'Lower opacity is subtler; 40% or higher recommended.', 'Lower opacity is subtler; 40% or higher recommended.') }}</span>
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.imageProvider')">
                <label>图片生成器</label>
                <select v-model="s2vConfig.imageProvider" class="form-select">
                  <!-- 无可用图片生成器时下拉显示「无」，避免空白选中项（2026-08-12 Bug 修复） -->
                  <option v-if="s2vImageProviders.length === 0" value="">无</option>
                  <option v-for="provider in s2vImageProviderOptions" :key="provider.id" :value="provider.id">{{ provider.displayName }}</option>
                </select>
                <p v-if="s2vImageProviders.length === 0" class="config-hint">未找到可用的图片生成器，请先在「模型服务商」中配置并启用支持图片生成的模型（含多模态模型）。<a href="#/model-providers" class="config-hint-link">前往配置 →</a></p>
              </div>
            </div>
          </details>

          <!-- 视频增强：AI 视频片段 + 图片轮播混合（2026-08-11） -->
          <details
            class="s2v-config-section"
            data-testid="s2v-section-videoEnhance"
            :open="s2vOpenSections.videoEnhance"
            @toggle="setS2VSectionOpen('videoEnhance', $event)"
          >
            <summary class="s2v-section-summary">
              <span>{{ s2vSectionLabel('videoEnhance') }}</span>
              <span class="s2v-summary">{{ s2vSectionSummary('videoEnhance') }}</span>
            </summary>
            <div class="config-grid">
              <!-- 创作模式（2026-08-12）：全自动 / 分镜素材自选 -->
              <div class="config-item" data-testid="s2v-creation-mode" v-if="s2vOptionVisible('advanced.creationMode')">
                <label>{{ translateWithLocaleFallback('create.story2video.creationMode.label', '创作模式', 'Creation Mode') }}</label>
                <div class="radio-group">
                  <label class="radio-option">
                    <input type="radio" value="auto" v-model="s2vConfig.creationMode" data-testid="s2v-creation-mode-auto" />
                    {{ translateWithLocaleFallback('create.story2video.creationMode.auto', '全自动（推荐）', 'Fully automatic (recommended)') }}
                  </label>
                  <label class="radio-option">
                    <input type="radio" value="manual" v-model="s2vConfig.creationMode" data-testid="s2v-creation-mode-manual" />
                    {{ translateWithLocaleFallback('create.story2video.creationMode.manual', '分镜素材自选', 'Manual scene asset selection') }}
                  </label>
                </div>
                <p v-if="s2vConfig.creationMode === 'manual'" class="config-hint s2v-cost-hint" data-testid="s2v-creation-mode-hint">
                  {{ translateWithLocaleFallback('create.story2video.creationMode.hint', '选择「分镜素材自选」模式后，每个分镜段落将生成多张图片和 1 个视频供您选择。Token 或积分消耗将大量增加，建议先用短文案测试后，再用于真实创作。', 'In "Manual scene asset selection" mode, each storyboard segment generates multiple images and 1 video for you to choose from. Token or credit consumption will increase significantly. Test with a short script first, then use it for real projects.') }}
                </p>
              </div>
              <template v-if="s2vConfig.creationMode === 'manual'">
                <div class="config-item" data-testid="s2v-material-mode" v-if="s2vOptionVisible('advanced.materialMode')">
                  <label>{{ translateWithLocaleFallback('create.story2video.creationMode.materialModeLabel', '素材模式', 'Material Mode') }}</label>
                  <div class="radio-group">
                    <label class="radio-option">
                      <input type="radio" value="all-images" v-model="s2vConfig.manualMaterialMode" data-testid="s2v-material-mode-all-images" />
                      {{ translateWithLocaleFallback('create.story2video.creationMode.materialAllImages', '全部图片轮播', 'Image carousel only') }}
                    </label>
                    <label class="radio-option">
                      <input type="radio" value="video-image" v-model="s2vConfig.manualMaterialMode" data-testid="s2v-material-mode-video-image" />
                      {{ translateWithLocaleFallback('create.story2video.creationMode.materialVideoImage', '视频+图片轮播', 'Video + image carousel') }}
                    </label>
                  </div>
                  <p class="config-hint" data-testid="s2v-material-mode-hint">
                    {{ translateWithLocaleFallback(
                      s2vConfig.manualMaterialMode === 'all-images'
                        ? 'create.story2video.creationMode.materialAllImagesHint'
                        : 'create.story2video.creationMode.materialVideoImageHint',
                      s2vConfig.manualMaterialMode === 'all-images'
                        ? '每个场景生成 2 张图片供您选择。'
                        : 'AI 视频场景生成 2 张图片 + 1 个视频供您选择（同一提示词），其余场景生成 2 张图片。',
                      s2vConfig.manualMaterialMode === 'all-images'
                        ? 'Each scene generates 2 images for you to choose from.'
                        : 'AI-video scenes generate 2 images + 1 video (same prompt) for you to choose from; other scenes generate 2 images.'
                    ) }}
                  </p>
                </div>
              </template>
              <!-- 视频增强模式：manual + 全部图片轮播 时忽略（不生成 AI 视频） -->
              <template v-if="s2vConfig.creationMode === 'auto' || s2vConfig.manualMaterialMode === 'video-image'">
              <div class="config-item" v-if="s2vOptionVisible('videoEnhance.videoMode')">
                <label>{{ translateWithLocaleFallback('create.story2video.batch.videoModeLabel', '视频增强模式', 'Video enhancement mode') }}</label>
                <select v-model="s2vConfig.videoMode" class="form-select" data-testid="s2v-video-mode">
                  <option value="off">{{ translateWithLocaleFallback('videoConfig.videoModeOff', '纯图片轮播', 'Image carousel only') }}</option>
                  <option value="fixed">{{ translateWithLocaleFallback('videoConfig.videoModeFixed', '固定比例', 'Fixed ratio') }}</option>
                  <option value="ai-judged">{{ translateWithLocaleFallback('videoConfig.videoModeAiJudged', 'AI 智能选择', 'AI selected') }}</option>
                </select>
                <p class="config-hint">{{ translateWithLocaleFallback('create.story2video.videoModeHint', 'AI 视频更贵也更慢，仅用于最值得动态化的场景；其余场景继续图片轮播，节省额度。', 'AI video is more expensive and slower — used only for the most dynamic scenes; others use image carousel to save quota.') }}</p>
              </div>
              <!-- 单段视频短于分镜时长处理：仅 videoMode 为 fixed 或 ai-judged 时显示 -->
              <div v-if="s2vConfig.videoMode === 'fixed' || s2vConfig.videoMode === 'ai-judged'" class="config-item">
                <label>{{ translateWithLocaleFallback('create.story2video.batch.shortVideoHandlingLabel', '单段视频短于分镜时长的处理', 'Handle short AI video clips') }}</label>
                <select v-model="s2vConfig.shortVideoHandling" class="form-select" data-testid="s2v-short-video-handling">
                  <option value="loop">{{ translateWithLocaleFallback('create.story2video.batch.shortVideoHandlingLoop', '循环播放', 'Loop playback') }}</option>
                  <option value="stop-at-end">{{ translateWithLocaleFallback('create.story2video.batch.shortVideoHandlingStopAtEnd', '播放完停止', 'Stop at end') }}</option>
                </select>
                <p class="config-hint">{{ translateWithLocaleFallback('create.story2video.batch.shortVideoHandlingHint', '仅在视频增强模式（固定比例/AI 智能选择）下生效。选择播放完停止时，AI 视频播放到最后一帧后将定格并慢慢放大。', 'Only applies in video enhancement mode (Fixed ratio / AI selected). When Stop at end is chosen, the AI video will freeze on the last frame and slowly zoom in.') }}</p>
              </div>
              <div v-if="s2vConfig.videoMode !== 'off'" class="config-item">
                <label>{{ translateWithLocaleFallback('create.story2video.videoGenerator', '视频生成器', 'Video generator') }}</label>
                <select v-model="s2vConfig.videoProvider" class="form-select" @change="handleS2VVideoProviderChange" data-testid="s2v-video-provider">
                  <!-- 无可用视频生成器时下拉显示「无」，避免空白选中项（2026-08-12 审查 M2 对齐图片） -->
                  <option v-if="s2vVideoProviders.length === 0" value="">无</option>
                  <option v-for="provider in s2vVideoProviderOptions" :key="provider.id" :value="provider.id">{{ provider.displayName }}</option>
                </select>
                <p v-if="s2vVideoProviders.length === 0" class="config-hint">未找到可用的视频生成器，请先在「模型服务商」中配置并启用支持视频生成的模型。<a href="#/model-providers" class="config-hint-link">前往配置 →</a></p>
              </div>
              <div v-if="s2vConfig.videoMode === 'fixed'" class="config-item">
                <label>AI 视频占比: {{ s2vConfig.videoFixedRatio }}%（前段）</label>
                <input type="range" v-model.number="s2vConfig.videoFixedRatio" min="10" max="50" step="5" class="form-range" data-testid="s2v-video-fixed-ratio" />
                <p class="config-hint">成片前约 {{ s2vConfig.videoFixedRatio }}% 时长的场景使用 AI 视频（建议 20%-30%）。</p>
              </div>
              <div v-if="s2vConfig.videoMode === 'ai-judged'" class="config-item">
                <label>AI 视频占比区间: {{ s2vConfig.videoMinRatio }}% - {{ s2vConfig.videoMaxRatio }}%</label>
                <div class="config-item-inline">
                  <span class="config-hint">最少</span>
                  <input type="range" v-model.number="s2vConfig.videoMinRatio" min="5" max="50" step="5" class="form-range" data-testid="s2v-video-min-ratio" />
                  <span class="config-hint">最多</span>
                  <input type="range" v-model.number="s2vConfig.videoMaxRatio" min="10" max="80" step="5" class="form-range" data-testid="s2v-video-max-ratio" />
                </div>
                <p class="config-hint">AI 根据场景精彩度自动选择视频片段，总占比控制在区间内（默认 20%-40%）；可生成场景数上限 {{ s2vConfig.videoMaxScenes }} 个。</p>
              </div>
              </template>
            </div>
          </details>

          <details
            class="s2v-config-section"
            data-testid="s2v-section-voice"
            :open="s2vOpenSections.voice"
            @toggle="setS2VSectionOpen('voice', $event)"
          >
            <summary class="s2v-section-summary">
              <span>{{ s2vSectionLabel('voice') }}</span>
              <span class="s2v-summary">{{ s2vSectionSummary('voice') }}</span>
            </summary>
            <div class="config-grid">
              <div class="config-item" v-if="s2vOptionVisible('voice.voiceProvider')">
                <label>语音生成器</label>
                <select v-model="s2vConfig.voiceProvider" class="form-select" @change="handleS2VVoiceProviderChange">
                  <!-- 首项「自动 Edge TTS」为常驻免费兜底（id=''），列表为空时下拉仍非空白；
                       仅补充配置引导提示（2026-08-12 复审 W1，与图片/视频空态提示对齐）。 -->
                  <option v-for="provider in s2vVoiceProviderOptions" :key="provider.id" :value="provider.id">{{ provider.displayName }}</option>
                </select>
                <p v-if="s2vVoiceProviders.length === 0" class="config-hint">未配置 TTS 模型时将使用自动 Edge TTS（免费）；如需 MiniMax 等语音模型与音色克隆能力，请先在「模型服务商」中配置。<a href="#/model-providers" class="config-hint-link">前往配置 →</a></p>
              </div>
              <div v-if="s2vConfig.voiceProvider && !s2vVoiceModelHidden" class="config-item">
                <label>语音模型</label>
                <select
                  v-if="s2vVoiceModelOptions.length > 0"
                  v-model="s2vConfig.voiceModel"
                  class="form-select"
                  @change="handleS2VVoiceModelChange"
                >
                  <option disabled value="">选择模型</option>
                  <option v-for="model in s2vVoiceModelOptions" :key="model" :value="model">{{ model }}</option>
                </select>
                <span v-else class="config-hint">当前服务商没有可用的语音模型。</span>
              </div>
              <div v-if="s2vConfig.voiceProvider && (s2vConfig.voiceModel || s2vVoiceModelHidden)" class="config-item">
                <label>语音 / 音色 ID</label>
                <select
                  id="s2v-voice-catalog"
                  v-model="s2vConfig.voiceId"
                  class="form-select"
                  :disabled="s2vVoiceCatalogLoading || s2vVoiceOptions.length === 0"
                  @change="handleS2VVoiceSelection"
                >
                  <option value="">使用服务商默认音色</option>
                  <option v-for="voice in s2vVoiceOptions" :key="voice.id" :value="voice.id" :disabled="voice.invalid">
                    {{ voice.invalid ? voice.name + '（已失效，请重新克隆）' : voice.name }}
                  </option>
                </select>
                <UiSkeleton v-if="s2vVoiceCatalogLoading" variant="text" style="display:inline-block;width:120px;margin-top:6px" />
                <span v-else-if="s2vVoiceCatalogError" class="inline-error">{{ s2vVoiceCatalogError }}</span>
                <button
                  v-if="s2vVoiceCatalogRefreshable"
                  type="button"
                  class="btn-secondary voice-catalog-refresh"
                  data-testid="s2v-voice-catalog-refresh"
                  :disabled="s2vVoiceCatalogLoading"
                  @click="refreshS2VVoiceCatalog"
                >刷新音色列表</button>
                <span v-else-if="s2vVoiceOptions.length === 0" class="config-hint">当前模型没有可用音色。</span>
              </div>
              <div v-if="s2vVoiceCapability?.type === 'provider_personal_slot'" class="config-item config-span-2 voice-slot-hint">
                <label>个人音色槽位</label>
                <p class="config-hint">请先在服务商官方控制台创建或管理个人音色，再刷新本地目录并在上方下拉列表中选择。当前页面不会伪造或复制服务商槽位。</p>
              </div>
              <div
                v-if="s2vVoiceCapability?.type === 'user_clone' && s2vVoiceCapability?.clone?.enabled === true"
                class="config-item config-span-2 voice-clone-panel"
              >
                <button type="button" class="voice-clone-toggle" :aria-expanded="s2vCloneOpen" data-testid="s2v-voice-clone-toggle" @click="s2vCloneOpen = !s2vCloneOpen">
                  <span>音色复制 / 克隆</span>
                  <span class="voice-clone-toggle-icon">{{ s2vCloneOpen ? '收起' : '展开' }}</span>
                </button>
                <template v-if="s2vCloneOpen">
                <p v-if="s2vVoiceCloneRequirements && s2vVoiceCloneHint()" class="config-hint">
                  {{ s2vVoiceCloneHint() }}
                </p>
                <p v-if="s2vVoiceCloneRequirements" class="config-hint">以上为当前模型能力数据驱动的本地校验提示，具体以供应商官方 API 合同为准。</p>
                <div class="voice-clone-actions">
                  <button type="button" class="btn-secondary" :disabled="s2vVoiceCloneLoading" @click="chooseS2VVoiceCloneSamples">
                    {{ s2vVoiceCloneLoading
                      ? translateWithLocaleFallback('create.story2video.voice.cloneInProgressButton', '正在克隆…', 'Cloning...')
                      : (s2vVoiceCloneSelection
                        ? translateWithLocaleFallback('create.story2video.voice.cloneReselectButton', '重新选择音频文件', 'Choose audio file again')
                        : translateWithLocaleFallback('create.story2video.voice.cloneSelectButton', '选择本地音频文件', 'Choose local audio file')) }}
                  </button>
                  <span v-if="s2vVoiceCloneSelection && !s2vVoiceClonePending" class="config-hint">已选择 {{ s2vVoiceCloneSelection.sampleCount }} 个样本</span>
                </div>
                <p v-if="s2vVoiceClonePending" class="voice-clone-status" role="status" data-testid="s2v-voice-clone-status">
                  <span class="spinner" aria-hidden="true"></span>
                  {{ s2vVoiceCloneStatusText() }}
                </p>
                <p class="config-hint">选择本地音频文件后将自动保存为克隆音色（默认名「音色001」，可点击「重命名」修改）。已授权样本只由可信主进程写入当前用户的本机私有目录，用于管理此克隆音色；页面不会接收原始文件路径或音频内容。</p>
                <p v-if="s2vVoiceCloneError" class="inline-error">{{ s2vVoiceCloneError }}</p>
                <div v-if="s2vVoiceClones.length > 0 || s2vVoiceClonePending" class="voice-clone-list">
                  <div v-for="voice in s2vVoiceClones" :key="voice.id" class="voice-clone-row" :class="{ 'voice-clone-row-default': isS2VDefaultVoice(voice.id) }">
                    <template v-if="s2vVoiceCloneRenamingId === voice.id">
                      <input
                        v-model.trim="s2vVoiceCloneRenameDraft"
                        class="form-input"
                        maxlength="128"
                        :placeholder="voice.name"
                        data-testid="s2v-voice-clone-rename-input"
                        @keyup.enter="renameS2VVoiceClone(voice.id)"
                        @keyup.esc="cancelS2VVoiceCloneRename"
                      />
                      <div class="voice-clone-actions">
                        <button type="button" class="btn-secondary" :disabled="s2vVoiceCloneLoading || !String(s2vVoiceCloneRenameDraft || '').trim()" @click="renameS2VVoiceClone(voice.id)">保存</button>
                        <button type="button" class="btn-secondary" :disabled="s2vVoiceCloneLoading" @click="cancelS2VVoiceCloneRename">取消</button>
                      </div>
                    </template>
                    <template v-else>
                      <span>
                        {{ voice.name }}
                        <span v-if="voice.invalid" class="voice-clone-invalid-badge">已失效，请重新克隆</span>
                        <span v-else-if="isS2VDefaultVoice(voice.id)" class="voice-clone-default-badge">默认</span>
                      </span>
                      <div class="voice-clone-actions">
                        <button type="button" class="btn-secondary" :disabled="s2vVoiceCloneLoading" @click="startS2VVoiceCloneRename(voice.id)">重命名</button>
                        <button type="button" class="btn-secondary" :disabled="s2vVoiceCloneLoading || voice.invalid || isS2VDefaultVoice(voice.id)" @click="selectS2VVoice(voice.id)">{{ isS2VDefaultVoice(voice.id) ? '已设为默认' : '设为默认' }}</button>
                        <button type="button" class="btn-secondary danger" :disabled="s2vVoiceCloneLoading" @click="deleteS2VVoiceClone(voice.id)">删除</button>
                      </div>
                    </template>
                  </div>
                  <div v-if="s2vVoiceClonePending" class="voice-clone-row voice-clone-row-pending" data-testid="s2v-voice-clone-pending-row">
                    <span>
                      {{ s2vVoiceClonePending.name }}
                      <span class="voice-clone-pending-badge">
                        <span class="spinner" aria-hidden="true"></span>
                        {{ translateWithLocaleFallback('create.story2video.voice.clonePendingLabel', '创建中…', 'Creating...') }}
                      </span>
                    </span>
                  </div>
                </div>
                </template>
              </div>
              <div v-else-if="s2vVoiceCapability?.type === 'user_clone'" class="config-item config-span-2 voice-slot-hint">
                <label>音色复制 / 克隆</label>
                <p class="config-hint">当前服务商尚未接入可用的音色克隆能力。</p>
              </div>
            </div>
          </details>

          <details
            class="s2v-config-section"
            data-testid="s2v-section-advanced"
            :open="s2vOpenSections.advanced"
            @toggle="setS2VSectionOpen('advanced', $event)"
          >
            <summary class="s2v-section-summary">
              <span>{{ s2vSectionLabel('advanced') }}</span>
              <span class="s2v-summary">{{ s2vSectionSummary('advanced') }}</span>
            </summary>
            <div class="config-grid">
              <div class="config-item" v-if="s2vOptionVisible('advanced.contentType')">
                <label>内容类型</label>
                <select v-model="s2vConfig.contentType" class="form-select">
                  <option value="general">通用内容</option>
                  <option value="history">历史文章（自动识别时代与朝代）</option>
                </select>
              </div>
            </div>
            <div class="s2v-subgroup">
              <h4 class="s2v-subgroup-title">{{ s2vSubgroupLabel('splitTiming') }}</h4>
              <div class="config-grid">
                <div class="config-item" v-if="s2vOptionVisible('advanced.splitLanguage')">
                <label>分句语言</label>
                  <select v-model="s2vConfig.splitLanguage" class="form-select">
                    <option value="auto">自动识别</option>
                    <option value="zh">中文</option>
                    <option value="en">英文</option>
                  </select>
                </div>
                <div class="config-item" v-if="s2vOptionVisible('advanced.splitMode')">
                <label>分句模式</label>
                  <select v-model="s2vConfig.splitMode" class="form-select">
                    <option value="fast">快速</option>
                    <option value="balanced">均衡</option>
                    <option value="precise">精确</option>
                  </select>
                </div>
                <div class="config-item" v-if="s2vOptionVisible('advanced.splitMaxSentenceLength')">
                <label>单句最大长度</label>
                  <input type="number" v-model.number="s2vConfig.splitMaxSentenceLength" min="20" max="1000" class="form-input" />
                </div>
                <div class="config-item" v-if="s2vOptionVisible('advanced.sceneGranularity')">
                <label>分镜粒度</label>
                  <div class="s2v-split-view-toggle" role="group" aria-label="分镜粒度视图">
                    <button type="button" class="s2v-view-btn" :class="{ active: s2vConfig.splitViewMode === 'seconds' }" :aria-pressed="s2vConfig.splitViewMode === 'seconds'" data-testid="s2v-split-view-seconds" @click="s2vConfig.splitViewMode = 'seconds'">目标时长</button>
                    <button type="button" class="s2v-view-btn" :class="{ active: s2vConfig.splitViewMode === 'chars' }" :aria-pressed="s2vConfig.splitViewMode === 'chars'" data-testid="s2v-split-view-chars" @click="s2vConfig.splitViewMode = 'chars'">目标字数</button>
                  </div>
                  <input
                    v-if="s2vConfig.splitViewMode === 'chars'"
                    type="number"
                    v-model.number="s2vSplitCharsView"
                    min="10" max="50" step="1" class="form-input"
                    data-testid="s2v-split-target-chars"
                  />
                  <input
                    v-else
                    type="number"
                    v-model.number="s2vSplitSecondsView"
                    min="1" :max="s2vSplitMaxSeconds" step="0.5" class="form-input"
                    data-testid="s2v-split-target-seconds"
                  />
                  <span class="s2v-field-hint">
                    <template v-if="s2vConfig.splitViewMode === 'chars'">约 {{ s2vSplitEstimatedSeconds }} 秒/分镜（按 {{ s2vSplitCharsPerSecond.toFixed(1) }} 字/秒估算）</template>
                    <template v-else>≈ {{ s2vConfig.splitTargetCharsPerScene }} 字/分镜（估算，实际以旁白音频为准）</template>
                  </span>
                </div>
                <div class="config-item config-span-2">
                  <label class="s2v-checkbox-label">
                    <input type="checkbox" v-model="s2vSceneDurationEnabled" data-testid="s2v-min-duration-toggle" />
                    启用最短场景时长
                  </label>
                  <span class="s2v-field-hint">开启后短旁白场景以静音补齐到「最短场景时长」，节奏更统一（默认关闭，跟随旁白）</span>
                </div>
                <div v-if="s2vSceneDurationEnabled" class="config-item">
                  <label>最短场景时长（秒）</label>
                  <input type="number" v-model.number="s2vMinSceneDurationView" min="1" max="60" step="1" class="form-input" data-testid="s2v-min-duration-input" />
                </div>
                <div class="config-item config-span-2">
                  <label>负向提示词</label>
                  <textarea v-model.trim="s2vConfig.negativePrompt" rows="2" maxlength="500" class="form-textarea"></textarea>
                </div>
              </div>
            </div>
            <div class="s2v-subgroup">
              <h4 class="s2v-subgroup-title">{{ s2vSubgroupLabel('templateOutput') }}</h4>
              <div class="config-grid">
                <div class="config-item" v-if="s2vOptionVisible('advanced.templateCategory')">
                <label>模板分类</label>
                  <select v-model="s2vTemplateCategory" class="form-select">
                    <option value="all">全部模板</option>
                    <option value="popular">热门</option>
                    <option value="business">商务</option>
                    <option value="creative">创意</option>
                    <option value="vlog">Vlog</option>
                    <option value="education">知识讲解</option>
                    <option value="custom">我的模板</option>
                  </select>
                </div>
                <div class="config-item" v-if="s2vOptionVisible('advanced.templateId')">
                <label>视频模板</label>
                  <select v-model="s2vConfig.templateId" class="form-select" @change="applyS2VTemplate">
                    <option v-for="template in s2vTemplates" :key="template.value" :value="template.value">{{ template.label }}</option>
                  </select>
                </div>
                <div class="config-item config-span-2">
                  <label>自定义模板</label>
                  <div class="template-editor">
                    <input v-model.trim="s2vCustomTemplateName" class="form-input" maxlength="80" placeholder="输入模板名称" />
                    <button type="button" class="btn-secondary" :disabled="!s2vCustomTemplateName" @click="saveCurrentS2VTemplate">保存当前参数</button>
                    <button v-if="selectedS2VTemplate?.category === 'custom'" type="button" class="btn-secondary danger" @click="requestTemplateDeletion">删除模板</button>
                  </div>
                </div>
                <div class="config-item" v-if="s2vOptionVisible('advanced.fps')">
                <label>帧率</label>
                  <select v-model.number="activeOutputConfig.fps" class="form-select">
                    <option :value="24">24 fps (电影)</option>
                    <option :value="30">30 fps (标准)</option>
                    <option :value="60">60 fps (流畅)</option>
                  </select>
                </div>
                <div class="config-item" v-if="s2vOptionVisible('advanced.format')">
                <label>格式</label>
                  <select v-model="activeOutputConfig.format" class="form-select">
                    <option value="mp4">MP4 (H.264)</option>
                    <option value="webm">WebM (VP9)</option>
                  </select>
                </div>
              </div>
            </div>
            <p class="s2v-controlled-defaults">部分高级运行参数由系统默认值管理。</p>
          </details>
        </div>

        <details v-if="isOrchestratedPipeline(selectedPipeline.name) && s2vOptionVisible('publish._group')" class="s2v-config-section" data-testid="s2v-section-publish" :open="s2vOpenSections.publish" @toggle="setS2VSectionOpen('publish', $event)">
          <summary class="s2v-section-summary">
            <span>{{ s2vSectionLabel('publish') }}</span>
            <span class="s2v-summary">{{ s2vSectionSummary('publish') }}</span>
          </summary>
          <div class="config-grid">
            <div class="config-item config-span-2">
              <label>发布平台</label>
              <div class="platform-checkboxes">
                <label v-for="platform in s2vPlatforms" :key="platform.value" class="checkbox-label">
                  <input v-model="s2vConfig.platforms" type="checkbox" :value="platform.value" />
                  <span>{{ platform.label }}</span>
                </label>
              </div>
            </div>
            <div class="config-item" v-if="s2vOptionVisible('publish.title')">
                <label>发布标题</label>
              <input v-model.trim="s2vConfig.title" class="form-input" placeholder="可选" />
            </div>
            <div class="config-item" v-if="s2vOptionVisible('publish.tags')">
                <label>发布标签</label>
              <input v-model.trim="s2vConfig.tagsText" class="form-input" placeholder="用逗号分隔" />
            </div>
            <div class="config-item config-span-2">
              <label>发布正文</label>
              <textarea v-model.trim="s2vConfig.publishContent" rows="3" maxlength="20000" class="form-textarea"></textarea>
            </div>
            <div class="config-item config-span-2">
              <label>封面 URL</label>
              <input v-model.trim="s2vConfig.coverUrl" class="form-input" maxlength="4096" />
            </div>
          </div>
        </details>
        <!-- 输出配置 -->
        <div v-if="!isOrchestratedPipeline(selectedPipeline?.name)" class="config-section">
          <h3>输出设置</h3>
          <div class="config-grid">
            <div class="config-item" v-if="s2vOptionVisible('publish.resolution')">
                <label>分辨率</label>
              <select v-model="activeOutputConfig.resolution" class="form-select">
                <option v-for="opt in outputResolutionOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
            <div class="config-item" v-if="s2vOptionVisible('advanced.fps')">
                <label>帧率</label>
              <select v-model.number="activeOutputConfig.fps" class="form-select">
                <option :value="24">24 fps (电影)</option>
                <option :value="30">30 fps (标准)</option>
                <option :value="60">60 fps (流畅)</option>
              </select>
            </div>
            <div class="config-item" v-if="s2vOptionVisible('advanced.format')">
                <label>格式</label>
              <select v-model="activeOutputConfig.format" class="form-select">
                <option value="mp4">MP4 (H.264)</option>
                <option value="webm">WebM (VP9)</option>
              </select>
            </div>
          </div>
        </div>
</div>

        <!-- 执行控制 -->
        <div class="action-bar" data-testid="pipeline-action-bar">
          <div v-if="!pipelineRunStatus || pipelineRunStatus.status === 'idle'">
            <UiButton class="btn-start" data-testid="start-story2video" @click="handleStartPipeline" :disabled="!canStartPipeline">
              {{ translateWithLocaleFallback('create.story2video.startPipeline', '启动流水线', 'Start pipeline') }}
            </UiButton>
            <UiButton
              v-if="isOrchestratedPipeline(selectedPipeline?.name)"
              variant="secondary"
              class="btn-start s2v-batch-trigger"
              data-testid="s2v-batch-trigger"
              @click="openS2VBatchDialog"
            >
              {{ translateWithLocaleFallback('create.story2video.batch.trigger', '批量创作', 'Batch create') }}
            </UiButton>
            <button v-if="isOrchestratedPipeline(selectedPipeline?.name)" type="button" class="reset-options-link" data-testid="reset-story2video-options" @click="resetS2VLastOptions">
              {{ translateWithLocaleFallback('create.story2video.resetOptions', '恢复默认选项', 'Reset to default options') }}
            </button>
            <button v-if="selectedPipeline?.name" type="button" class="reset-options-link" data-testid="s2v-config-profile-save" @click="openS2VConfigProfileSave">
              {{ translateWithLocaleFallback('create.story2video.configProfile.saveButton', '保存配置', 'Save configuration') }}
            </button>
            <button v-if="selectedPipeline?.name" type="button" class="reset-options-link" data-testid="s2v-config-profile-manage" @click="openS2VConfigProfileList">
              {{ translateWithLocaleFallback('create.story2video.configProfile.manageButton', '我的配置', 'My configurations') }}
            </button>
            <p v-if="!pipelineAvailable(selectedPipeline?.name)" class="unavailable-hint" data-testid="pipeline-unavailable-hint">
              {{ translateWithLocaleFallback('pipelines.availability.notImplementedHint', '该流水线尚未实现执行引擎，暂不能生成视频', 'This pipeline has no execution engine yet.') }}
            </p>
          </div>
          <div v-else class="running-controls">
            <template v-if="orchestrationRunId">
              <p v-if="isContentPolicyCheckpoint" class="orchestration-attention">
                {{ pipelineRunStatus.checkpoint.recommendation || translateWithLocaleFallback('create.story2video.contentPolicyAttention', '图片内容需要处理；取消后修改文案并重新启动流水线。', 'Some image content needs attention. Cancel, update the text, and start the pipeline again.') }}
              </p>
              <UiButton
                v-if="isContentPolicyCheckpoint"
                variant="secondary"
                class="s2v-edit-scenes-btn"
                data-testid="s2v-edit-scenes-trigger"
                :disabled="contentPolicyEditBusy"
                @click="editContentPolicyScenes"
              >
                ✎ {{ translateWithLocaleFallback('create.story2video.editScenes', '编辑场景', 'Edit scenes') }}
              </UiButton>
              <p v-else-if="sceneAssetSelectionActive" class="orchestration-waiting" data-testid="s2v-selection-waiting-text">
                {{ translateWithLocaleFallback('create.story2video.selectionWait.controlText', '⏳ 等待您选择分镜素材，确认后将生成旁白并合成视频。', 'Awaiting your asset selection — narration and compositing will start after you confirm.') }}
              </p>
              <!-- 编排流水线暂停（2026-08-16 UX 统一）：运行中可手动暂停，暂停点保存后可从历史记录断点续跑 -->
              <UiButton
                v-if="pipelineRunStatus?.status === 'running' && !sceneAssetSelectionActive && pipelineRunStatus?.checkpoint?.reason !== 'content_policy'"
                variant="secondary"
                class="s2v-pause-btn"
                data-testid="s2v-pause-trigger"
                :disabled="pauseActionBusy"
                @click="pauseOrchestrationPipeline"
              >⏸ {{ translateWithLocaleFallback('create.story2video.pause', 'Pause', 'Pause') }}</UiButton>
            </template>
            <template v-else>
              <UiButton v-if="pipelineRunStatus.status === 'paused'" @click="resumePipeline">▶ {{ translateWithLocaleFallback('create.story2video.resume', 'Resume', 'Resume') }}</UiButton>
              <UiButton v-else-if="pipelineRunStatus.status === 'running'" @click="pausePipeline">⏸ {{ translateWithLocaleFallback('create.story2video.pause', 'Pause', 'Pause') }}</UiButton>
              <UiButton v-if="needsCheckpoint" @click="advancePipeline">{{ translateWithLocaleFallback('create.story2video.confirmAndContinue', '确认并继续', 'Confirm and continue') }}</UiButton>
            </template>
            <UiButton variant="danger" data-testid="s2v-cancel-trigger" @click="requestCancelPipeline">✕ 取消</UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 快速渲染视图 ==================== -->
    <div v-if="view === 'quick'" class="quick-render">
      <div class="mode-tabs">
        <button v-for="m in quickModes" :key="m.value" :class="['mode-tab', { active: quickMode === m.value }]" @click="quickMode = m.value">{{ m.label }}</button>
      </div>
      <div class="form-group" v-if="quickMode === 'text'">
        <label>输入文案</label>
        <textarea v-model="quickText" placeholder="输入视频文案，每行一个场景..." rows="8" class="form-input textarea"></textarea>
        <button class="btn-secondary" @click="aiWrite" :disabled="aiLoading">{{ aiLoading ? '生成中...' : 'AI 写稿' }}</button>
      </div>
      <div class="form-group" v-if="quickMode === 'gallery'">
        <label>上传图片</label>
        <div class="upload-zone" @click="$refs.quickFileInput?.click()" @dragover.prevent @drop.prevent="handleQuickDrop">
          <p v-if="quickImages.length === 0">点击或拖拽图片到此处</p>
          <div v-else class="image-grid">
            <div v-for="(img, i) in quickImages" :key="i" class="image-thumb">
              <img :src="img.preview" />
              <button class="remove-btn" @click.stop="quickImages.splice(i, 1)">×</button>
              <span class="image-index">{{ i + 1 }}</span>
            </div>
          </div>
        </div>
        <input ref="quickFileInput" type="file" accept="image/*" multiple style="display:none" @change="handleQuickFiles" />
      </div>
      <div class="form-group">
        <label>输出平台</label>
        <UiSelect v-model="quickProfile" :options="profileOptions" />
      </div>
      <div class="form-group">
        <label>视频主题</label>
        <UiSelect v-model="quickTheme" :options="themeOptions" />
      </div>
      <div class="actions">
        <UiButton @click="startQuickRender" :disabled="!canQuickRender || quickRendering">{{ quickRendering ? '渲染中...' : '开始渲染' }}</UiButton>
        <button v-if="quickRendering" class="btn-secondary" @click="cancelQuickRender">取消</button>
      </div>
      <div v-if="quickRendering" class="progress-section">
        <div class="progress-bar"><div class="progress-fill" :style="{ width: quickProgress + '%' }"></div></div>
        <p class="progress-text">{{ quickProgress }}% — {{ quickStage }}</p>
      </div>
      <div v-if="quickResult" class="result-banner success"><p>视频渲染完成</p><UiButton @click="viewQuickResult">查看视频</UiButton></div>
      <div v-if="quickError" class="result-banner error"><p>{{ quickError }}</p><button class="btn-secondary" @click="quickError = null">重试</button></div>
    </div>


    <!-- ==================== 历史记录视图 ==================== -->
    <div v-if="view === 'history'">
      <CreateViewHistory
        :history="history"
        :history-loading="historyLoading"
        :history-local-mode="historyLocalMode"
        :history-local-mode-text="historyLocalModeText"
        :history-filter="historyFilter"
        :story2video-resuming="story2videoResuming"
        @update:historyFilter="historyFilter = $event"
        @resume-history="resumeHistoryItem"
        @open-result="openHistoryResult"
        @publish-history="publishHistoryItem"
        @delete-history="requestHistoryDeletion"
        @download-history="downloadHistoryVideo"
        @create-content="switchView('pipelines')"
        @reset-history-filter="historyFilter = 'all'"
        :deleting="deleting"
        @delete-history-batch="requestHistoryBatchDeletion"
      />
    </div>

    <UiModal
      :visible="pipelineProgressModalOpen"
      :title="pipelineProgressModalTitle"
      size="xl"
      width="960px"
      variant="progress"
      test-id="s2v-progress-modal"
      :close-on-overlay="false"
      :close-on-esc="false"
      :close-disabled="pipelineProgressCloseDisabled"
      :close-aria-label="pipelineProgressCloseLabel"
      @close="handlePipelineProgressClose"
    >
      <div class="pipeline-progress-modal-content" data-testid="pipeline-progress-modal-content">
        <StageProgress
          v-if="pipelineProgressStages.length"
          :stages="pipelineProgressStages"
          :progress-percent="orchestrationProgressPercent"
          :elapsed-ms="orchestrationElapsedMs"
          :summary="orchestrationSummary"
          :show-time-guidance="isOrchestratedPipeline(selectedPipeline?.name)"
          :orchestration-context="orchestrationContext"
          :checkpoint="pipelineRunStatus?.checkpoint || null"
        />
        <div
          v-if="!isOrchestratedPipeline(selectedPipeline?.name) && pipelineProgressStages.length === 0 && pipelineRunStatus && pipelineRunStatus.progress !== undefined"
          class="pipeline-progress-basic"
          data-testid="pipeline-progress-basic"
        >
          <div class="pipeline-progress-basic-track">
            <div class="pipeline-progress-basic-fill" :style="{ width: Math.max(0, Math.min(100, Number(pipelineRunStatus.progress) || 0)) + '%' }"></div>
          </div>
          <span>{{ Number.isFinite(Number(pipelineRunStatus.progress)) ? Math.round(Number(pipelineRunStatus.progress)) : 0 }}%</span>
        </div>

        <template v-if="sceneAssetSelectionActive">
          <div class="s2v-selection-banner" role="status" data-testid="s2v-selection-banner">
            <span class="s2v-selection-banner-text">
              {{ translateWithLocaleFallback('create.story2video.selectionWait.banner', '分镜素材已生成，请为每个分镜选择最终素材。', 'Storyboard assets are ready — pick the final material for each scene.', { count: sceneAssetCandidates.length }) }}
            </span>
            <UiButton class="s2v-selection-banner-cta" data-testid="s2v-selection-go" @click="scrollToSceneAssetPanel">
              {{ translateWithLocaleFallback('create.story2video.selectionWait.goSelect', '去选择素材', 'Select assets') }}
            </UiButton>
          </div>
          <div
            ref="sceneAssetPanel"
            class="s2v-scene-asset-panel"
            :class="{ 's2v-scene-asset-panel-attention': sceneAssetAttention }"
            data-testid="s2v-scene-asset-panel"
          >
            <SceneAssetSelection
              :run-id="orchestrationRunId"
              :candidates="sceneAssetCandidates"
              :confirming="sceneAssetConfirming"
              :error="sceneAssetSelectionError"
              @confirm="confirmSceneAssetSelections"
            />
          </div>
        </template>

        <div v-if="pipelineProgressCheckpointText" class="pipeline-progress-checkpoint" role="status" data-testid="pipeline-progress-checkpoint">
          {{ pipelineProgressCheckpointText }}
        </div>

        <div v-if="pipelineProgressStatusError" class="pipeline-progress-status-error" role="status" data-testid="pipeline-progress-status-error">
          {{ pipelineProgressStatusError }}
        </div>

        <div v-if="providerWarningText" class="provider-warning-banner" role="alert" data-testid="story2video-provider-warning-banner">
          ⚠️ {{ providerWarningText }}
          <button class="provider-warning-banner-close" data-testid="dismiss-provider-warning" @click="dismissProviderWarnings" :aria-label="translateWithLocaleFallback('common.close', '关闭', 'Close')">✕</button>
        </div>

        <div v-if="story2videoBgmSkippedNotice" class="bgm-skipped-notice" role="alert" data-testid="story2video-bgm-skipped-notice">
          🎵 {{ story2videoBgmSkippedNotice }}
          <button class="bgm-skipped-notice-close" data-testid="dismiss-bgm-skipped-notice" @click="dismissBgmSkippedNotice" :aria-label="translateWithLocaleFallback('common.close', '关闭', 'Close')">✕</button>
        </div>

        <div
          v-if="!pipelineProgressStages.length && !pipelineProgressHasNumericPercent"
          class="pipeline-progress-empty"
          role="status"
          data-testid="pipeline-progress-empty"
        >
          {{ pipelineProgressLoadingText }}
        </div>
      </div>

      <template #footer>
        <span v-if="pipelineProgressCloseDisabled" class="pipeline-progress-manual-hint" data-testid="pipeline-progress-manual-hint">{{ pipelineProgressManualHint }}</span>
        <UiButton
          v-if="canDetachPipelineToBackground"
          variant="secondary"
          data-testid="s2v-background-trigger"
          @click="detachPipelineToBackground"
        >
          {{ translateWithLocaleFallback('create.story2video.backgroundRun', '后台运行', 'Run in background') }}
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :visible="story2videoErrorDialog.visible"
      :title="story2videoErrorDialogUiText.dialogTitle"
      size="sm"
      @close="closeStory2VideoErrorDialog"
    >
      <p class="story2video-error-dialog-message">{{ story2videoErrorDialogMessage }}</p>
      <p v-if="story2videoErrorDialog.detail" class="story2video-error-dialog-detail">{{ story2videoErrorDialog.detail }}</p>
      <p v-if="canResumeStory2Video" class="story2video-error-dialog-hint">{{ story2videoErrorDialogUiText.resumeHint }}</p>
      <p v-else class="story2video-error-dialog-hint">如问题持续出现，请检查日志或重新启动流水线。</p>
      <template #footer>
        <UiButton
          v-if="canGoToModelSettings"
          variant="primary"
          data-testid="go-to-model-settings"
          @click="goToModelSettings"
        >{{ story2videoErrorDialogUiText.goToModelSettings }}</UiButton>
        <UiButton v-if="canResumeStory2Video" variant="primary" :disabled="story2videoResuming" @click="resumeStory2Video">{{ story2videoResuming ? story2videoErrorDialogUiText.resuming : story2videoErrorDialogUiText.resume }}</UiButton>
        <UiButton @click="closeStory2VideoErrorDialog">{{ story2videoErrorDialogUiText.acknowledge }}</UiButton>
      </template>
    </UiModal>

    <UiModal
      :visible="story2videoProjectDeleteDialog.visible"
      :title="story2videoErrorDialogUiText.dialogTitle"
      size="sm"
      @close="closeProjectDeletionDialog"
    >
      <p class="story2video-error-dialog-message">{{ story2videoProjectDeleteDialogMessage }}</p>
      <template #footer>
        <UiButton variant="secondary" @click="closeProjectDeletionDialog">{{ story2videoErrorDialogUiText.cancel }}</UiButton>
        <UiButton variant="danger" @click="confirmProjectDeletion">{{ story2videoErrorDialogUiText.confirmDelete }}</UiButton>
      </template>
    </UiModal>

    <!-- 流水线运行记录删除确认（2026-08-16）：历史记录中无 projectId 的 run 走 pipeline:delete-run -->
    <UiModal
      :visible="story2videoRunDeleteDialog.visible"
      :title="story2videoErrorDialogUiText.dialogTitle"
      size="sm"
      @close="closeRunDeletionDialog"
    >
      <p class="story2video-error-dialog-message">{{ story2videoRunDeleteDialogMessage }}</p>
      <template #footer>
        <UiButton variant="secondary" @click="closeRunDeletionDialog">{{ story2videoErrorDialogUiText.cancel }}</UiButton>
        <UiButton variant="danger" @click="confirmRunDeletion" data-testid="confirm-run-deletion">{{ story2videoErrorDialogUiText.confirmDelete }}</UiButton>
      </template>
    </UiModal>

    <UiModal
      :visible="story2videoTemplateDeleteDialog.visible"
      :title="story2videoErrorDialogUiText.dialogTitle"
      size="sm"
      @close="closeTemplateDeletionDialog"
    >
      <p class="story2video-error-dialog-message">{{ story2videoTemplateDeleteDialogMessage }}</p>
      <template #footer>
        <UiButton variant="secondary" @click="closeTemplateDeletionDialog">{{ story2videoErrorDialogUiText.cancel }}</UiButton>
        <UiButton variant="danger" @click="confirmTemplateDeletion">{{ story2videoErrorDialogUiText.confirmDelete }}</UiButton>
      </template>
    </UiModal>

    <UiModal
      :visible="story2videoBatchDeleteDialog.visible"
      :title="story2videoErrorDialogUiText.dialogTitle"
      size="sm"
      @close="closeBatchDeletionDialog"
    >
      <p class="story2video-error-dialog-message">{{ story2videoBatchDeleteDialogMessage }}</p>
      <p v-if="deleting" class="story2video-error-dialog-message" style="color: var(--s2v-text-secondary, #6b7280); margin-top: 8px;">{{ story2videoErrorDialogUiText.deleting }}</p>
      <template #footer>
        <UiButton variant="secondary" :disabled="deleting" @click="closeBatchDeletionDialog">{{ story2videoErrorDialogUiText.cancel }}</UiButton>
        <UiButton variant="danger" :disabled="deleting" data-testid="confirm-batch-deletion" @click="confirmBatchDeletion">{{ deleting ? story2videoErrorDialogUiText.deleting : story2videoErrorDialogUiText.confirmDelete }}</UiButton>
      </template>
    </UiModal>

    <!-- 背景音乐素材库管理（2026-08-14）：添加/重命名/删除，设备级持久化 -->
    <UiModal
      :visible="s2vBgmLibraryDialogOpen"
      :title="translateWithLocaleFallback('create.story2video.bgmLibrary.dialogTitle', '背景音乐素材库', 'Music library')"
      size="md"
      @close="closeBgmLibraryDialog"
    >
      <div class="bgm-library-dialog" data-testid="s2v-bgm-library-dialog">
        <div class="bgm-library-toolbar">
          <div class="bgm-library-toolbar-row">
            <input ref="s2vBgmLibraryInput" type="file" accept=".wav,.m4a,.mp3,audio/wav,audio/x-m4a,audio/mpeg" style="display:none" @change="handleBgmLibraryAddFile" />
            <UiButton variant="primary" :disabled="s2vBgmLibraryLoading" data-testid="s2v-bgm-add-button" @click="$refs.s2vBgmLibraryInput?.click()">
              <span class="material-symbols-outlined" style="font-size:16px">add</span>
              {{ translateWithLocaleFallback('create.story2video.bgmLibrary.add', '添加音乐', 'Add music') }}
            </UiButton>
            <UiSkeleton v-if="s2vBgmLibraryLoading" variant="text" style="display:inline-block;width:96px" />
          </div>
          <p class="bgm-library-toolbar-hint">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.addHint', '添加后将自动选中该音乐。', 'The added track is selected automatically.') }}</p>
        </div>
        <ul v-if="s2vBgmLibrary.length" class="bgm-library-list">
          <li v-for="item in s2vBgmLibrary" :key="item.id" class="bgm-library-item">
            <template v-if="s2vBgmLibraryRenamingId === item.id">
              <div class="bgm-library-rename-row">
                <input
                  v-model.trim="s2vBgmLibraryRenameDraft"
                  class="form-input"
                  maxlength="60"
                  :placeholder="translateWithLocaleFallback('create.story2video.bgmLibrary.renamePlaceholder', '输入音乐名称', 'Enter a name for the track')"
                  data-testid="s2v-bgm-rename-input"
                  @keyup.enter="saveBgmRename"
                  @keyup.esc="cancelBgmRename"
                />
                <div class="bgm-library-actions" style="opacity:1">
                  <button type="button" class="btn-icon" :disabled="s2vBgmLibraryLoading || !String(s2vBgmLibraryRenameDraft || '').trim()" @click="saveBgmRename" title="保存"><span class="material-symbols-outlined">check</span></button>
                  <button type="button" class="btn-icon" :disabled="s2vBgmLibraryLoading" @click="cancelBgmRename" title="取消"><span class="material-symbols-outlined">close</span></button>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="bgm-library-item-content">
                <span class="material-symbols-outlined bgm-library-item-icon">music_note</span>
                <span class="bgm-library-name" :title="item.path">{{ item.name }}</span>
              </div>
              <div class="bgm-library-actions">
                <button type="button" class="btn-icon" :disabled="s2vBgmLibraryLoading" @click="startBgmRename(item)" title="重命名"><span class="material-symbols-outlined">edit</span></button>
                <button type="button" class="btn-icon danger" :disabled="s2vBgmLibraryLoading" @click="requestBgmDelete(item)" title="删除"><span class="material-symbols-outlined">delete</span></button>
              </div>
            </template>
          </li>
        </ul>
        <p v-else class="config-hint">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.empty', '素材库为空。点击「添加音乐」导入本地音频文件，将自动加入素材库。', 'The library is empty. Click "Add music" to import a local audio file.') }}</p>
      </div>
      <template #footer>
        <UiButton variant="secondary" @click="closeBgmLibraryDialog">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.close', '关闭', 'Close') }}</UiButton>
      </template>
    </UiModal>

    <!-- 背景音乐删除确认 -->
    <UiModal
      :visible="s2vBgmLibraryDeleteDialogOpen"
      :title="story2videoErrorDialogUiText.dialogTitle"
      size="sm"
      @close="closeBgmDeleteDialog"
    >
      <p class="story2video-error-dialog-message">{{ story2videoBgmLibraryDeleteConfirmMessage }}</p>
      <template #footer>
        <UiButton variant="secondary" @click="closeBgmDeleteDialog">{{ story2videoErrorDialogUiText.cancel }}</UiButton>
        <UiButton variant="danger" data-testid="s2v-bgm-delete-confirm" @click="confirmBgmDelete">{{ story2videoErrorDialogUiText.confirmDelete }}</UiButton>
      </template>
    </UiModal>

    <!-- 流水线「保存配置」：保存弹窗（2026-08-28 s2v-pipeline-config-profiles） -->
    <UiModal
      :visible="s2vConfigProfileDialogOpen"
      :title="translateWithLocaleFallback('create.story2video.configProfile.saveTitle', '保存配置', 'Save configuration')"
      size="sm"
      @close="closeS2VConfigProfileSave"
    >
      <div class="config-profile-dialog" data-testid="s2v-config-profile-save-dialog">
        <p class="config-hint">{{ translateWithLocaleFallback('create.story2video.configProfile.saveHint', '保存当前流水线的所有选项，稍后可一键应用到新任务。', 'Saves every option of the current pipeline so you can re-apply it later.') }}</p>
        <input
          v-model.trim="s2vConfigProfileNameDraft"
          class="form-input"
          maxlength="60"
          :placeholder="translateWithLocaleFallback('create.story2video.configProfile.namePlaceholder', '配置名称（如：口播竖屏 1080p）', 'Configuration name (e.g. vertical 1080p voice-over)')"
          data-testid="s2v-config-profile-name-input"
          @keyup.enter="saveS2VConfigProfile"
          @keyup.esc="closeS2VConfigProfileSave"
        />
        <p v-if="s2vConfigProfileOverwriteNeeded" class="config-hint">{{ translateWithLocaleFallback('create.story2video.configProfile.duplicateName', '已存在同名配置，保存将覆盖它。', 'A configuration with this name already exists. Saving will overwrite it.') }}</p>
      </div>
      <template #footer>
        <UiButton variant="secondary" :disabled="s2vConfigProfilesLoading" @click="closeS2VConfigProfileSave">{{ translateWithLocaleFallback('create.story2video.configProfile.cancel', '取消', 'Cancel') }}</UiButton>
        <UiButton variant="primary" :disabled="s2vConfigProfilesLoading || !String(s2vConfigProfileNameDraft || '').trim()" data-testid="s2v-config-profile-save-confirm" @click="saveS2VConfigProfile">
          {{ s2vConfigProfileOverwriteNeeded
            ? translateWithLocaleFallback('create.story2video.configProfile.overwriteSave', '覆盖保存', 'Overwrite')
            : translateWithLocaleFallback('create.story2video.configProfile.save', '保存', 'Save') }}
        </UiButton>
      </template>
    </UiModal>

    <!-- 流水线「保存配置」：配置列表（应用/重命名/删除） -->
    <UiModal
      :visible="s2vConfigProfileListOpen"
      :title="translateWithLocaleFallback('create.story2video.configProfile.listTitle', '我的配置', 'My configurations')"
      size="md"
      @close="closeS2VConfigProfileList"
    >
      <div class="config-profile-list" data-testid="s2v-config-profile-list">
        <p v-if="s2vConfigProfileError" class="config-hint">{{ s2vConfigProfileError }}</p>
        <UiSkeleton v-if="s2vConfigProfilesLoading" variant="list" :count="3" />
        <ul v-else-if="s2vConfigProfiles.length" class="bgm-library-list">
          <li v-for="profile in s2vConfigProfiles" :key="profile.id" class="bgm-library-item">
            <template v-if="s2vConfigProfileRenamingId === profile.id">
              <div class="bgm-library-rename-row">
                <input v-model.trim="s2vConfigProfileRenameDraft" class="form-input" maxlength="60" data-testid="s2v-config-profile-rename-input" @keyup.enter="saveS2VConfigProfileRename" @keyup.esc="cancelS2VConfigProfileRename" />
                <div class="bgm-library-actions" style="opacity:1">
                  <button type="button" class="btn-icon" :disabled="s2vConfigProfilesLoading || !String(s2vConfigProfileRenameDraft || '').trim()" @click="saveS2VConfigProfileRename" title="保存"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></button>
                  <button type="button" class="btn-icon" :disabled="s2vConfigProfilesLoading" @click="cancelS2VConfigProfileRename" title="取消"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="bgm-library-item-content">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
                <span class="bgm-library-name" :title="profile.name">{{ profile.name }}</span>
                <span class="bgm-library-toolbar-hint">{{ pipelineName(profile.pipelineId) }} · {{ formatS2VConfigProfileTime(profile.updatedAt) }}</span>
              </div>
              <div class="bgm-library-actions">
                <button type="button" class="btn-icon" :disabled="s2vConfigProfilesLoading || !s2vConfigProfileCanApply(profile)" :title="s2vConfigProfileCanApply(profile) ? '应用到当前流水线' : '该配置属于其他流水线'" data-testid="s2v-config-profile-apply" @click="requestApplyS2VConfigProfile(profile)"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
                <button type="button" class="btn-icon" :disabled="s2vConfigProfilesLoading" @click="startS2VConfigProfileRename(profile)" title="重命名"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
                <button type="button" class="btn-icon danger" :disabled="s2vConfigProfilesLoading" @click="requestS2VConfigProfileDelete(profile)" title="删除"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg></button>
              </div>
            </template>
          </li>
        </ul>
        <p v-else class="config-hint">{{ translateWithLocaleFallback('create.story2video.configProfile.empty', '暂无保存的配置。在流水线页面点击「保存配置」即可创建。', 'No saved configurations yet. Click \"Save configuration\" on a pipeline page to create one.') }}</p>
      </div>
      <template #footer>
        <UiButton variant="secondary" @click="closeS2VConfigProfileList">{{ translateWithLocaleFallback('create.story2video.configProfile.close', '关闭', 'Close') }}</UiButton>
      </template>
    </UiModal>

    <!-- 流水线「保存配置」：应用确认 -->
    <UiModal :visible="s2vConfigProfileApplyDialogOpen" :title="translateWithLocaleFallback('create.story2video.configProfile.applyTitle', '应用配置', 'Apply configuration')" size="sm" @close="cancelApplyS2VConfigProfile">
      <p class="story2video-error-dialog-message">{{ translateWithLocaleFallback('create.story2video.configProfile.applyConfirm', '应用配置将覆盖当前已调整的选项，是否继续？', 'Applying this configuration will overwrite your current options. Continue?') }}</p>
      <template #footer>
        <UiButton variant="secondary" @click="cancelApplyS2VConfigProfile">{{ translateWithLocaleFallback('create.story2video.configProfile.cancel', '取消', 'Cancel') }}</UiButton>
        <UiButton variant="primary" data-testid="s2v-config-profile-apply-confirm" @click="confirmApplyS2VConfigProfile()">{{ translateWithLocaleFallback('create.story2video.configProfile.apply', '应用', 'Apply') }}</UiButton>
      </template>
    </UiModal>

    <!-- 流水线「保存配置」：删除确认 -->
    <UiModal :visible="s2vConfigProfileDeleteDialogOpen" :title="translateWithLocaleFallback('create.story2video.configProfile.deleteTitle', '删除配置', 'Delete configuration')" size="sm" @close="closeS2VConfigProfileDelete">
      <p class="story2video-error-dialog-message">{{ translateWithLocaleFallback('create.story2video.configProfile.deleteConfirm', '确定删除该配置吗？此操作不可恢复。', 'Delete this configuration? This cannot be undone.') }}</p>
      <template #footer>
        <UiButton variant="secondary" @click="closeS2VConfigProfileDelete">{{ translateWithLocaleFallback('create.story2video.configProfile.cancel', '取消', 'Cancel') }}</UiButton>
        <UiButton variant="danger" data-testid="s2v-config-profile-delete-confirm" @click="confirmS2VConfigProfileDelete">{{ translateWithLocaleFallback('create.story2video.configProfile.delete', '删除', 'Delete') }}</UiButton>
      </template>
    </UiModal>

    <!-- 分镜素材自选：取消二次确认（等待选择期间防误触，2026-08-13） -->
    <UiModal
      :visible="cancelConfirmDialog.visible"
      :title="translateWithLocaleFallback('create.story2video.selectionWait.cancelTitle', '取消流水线', 'Cancel pipeline')"
      size="sm"
      @close="closeCancelConfirmDialog"
    >
      <p class="story2video-error-dialog-message" data-testid="s2v-cancel-confirm-body">
        {{ translateWithLocaleFallback('create.story2video.selectionWait.cancelBody', '素材选择尚未完成，取消将终止本次创作，已生成的候选素材不会保留。确定取消吗？', 'Asset selection is not finished. Cancelling will stop this creation and discard the generated candidates. Cancel anyway?') }}
      </p>
      <p v-if="cancelConfirmDialog.error" class="story2video-error-dialog-detail" data-testid="s2v-cancel-confirm-error">
        {{ translateWithLocaleFallback('create.story2video.selectionWait.cancelFailed', '取消失败，请重试。', 'Failed to cancel. Please retry.') }}
      </p>
      <template #footer>
        <UiButton variant="secondary" @click="closeCancelConfirmDialog">{{ translateWithLocaleFallback('create.story2video.selectionWait.cancelKeep', '继续选择', 'Keep selecting') }}</UiButton>
        <UiButton variant="danger" data-testid="s2v-cancel-confirm-ok" @click="confirmCancelPipeline">{{ translateWithLocaleFallback('create.story2video.selectionWait.cancelConfirm', '确认取消', 'Confirm cancel') }}</UiButton>
      </template>
    </UiModal>

    <!-- 批量创作（2026-08-15 story2video-batch-create）：按队列依次运行；最大并行 2；手动任务运行中批量并行 1 -->
    <UiModal
      :visible="s2vBatchDialogOpen"
      :title="translateWithLocaleFallback('create.story2video.batch.dialogTitle', '批量创作', 'Batch create')"
      size="lg"
      @close="closeS2VBatchDialog"
    >
      <div class="s2v-batch-dialog" data-testid="s2v-batch-dialog">
        <!-- 创作模式：固定「全自动」且隐藏不显示（提交时写死 mode=text + creationMode=auto） -->
        <div class="config-item">
          <label>{{ translateWithLocaleFallback('create.story2video.batch.videoModeLabel', '视频增强模式', 'Video enhancement mode') }}</label>
          <select v-model="s2vBatchVideoMode" class="form-select" data-testid="s2v-batch-video-mode">
            <option value="off">{{ translateWithLocaleFallback('videoConfig.videoModeOff', '关闭', 'Off') }}</option>
            <option value="fixed">{{ translateWithLocaleFallback('videoConfig.videoModeFixed', '固定比例', 'Fixed ratio') }}</option>
            <option value="ai-judged">{{ translateWithLocaleFallback('videoConfig.videoModeAiJudged', 'AI 智能选择', 'AI selected') }}</option>
          </select>
        </div>
        <p class="config-hint s2v-batch-rule-hint" data-testid="s2v-batch-rule-hint">
          {{ translateWithLocaleFallback('create.story2video.batch.ruleHint', '批量创作按队列依次运行，软件最大并行任务数量为 2。如果当前有正在执行中的手动任务，批量创作在同一时间只运行 1 个任务。', 'Batch tasks run in a queue (max 2 in parallel). While a manual task is running, only 1 batch task runs at a time.') }}
        </p>

        <div class="s2v-batch-tabs" role="tablist" data-testid="s2v-batch-tabs">
          <button
            type="button"
            :class="['s2v-batch-tab', { active: s2vBatchTab === 'text' }]"
            data-testid="s2v-batch-tab-text"
            @click="s2vBatchTab = 'text'"
          >{{ translateWithLocaleFallback('create.story2video.batch.tabText', '输入文案', 'Text input') }}</button>
          <button
            type="button"
            :class="['s2v-batch-tab', { active: s2vBatchTab === 'files' }]"
            data-testid="s2v-batch-tab-files"
            @click="s2vBatchTab = 'files'"
          >{{ translateWithLocaleFallback('create.story2video.batch.tabFiles', '本地文件', 'Local files') }}</button>
        </div>

        <!-- 输入文案（1-10 条） -->
        <div v-if="s2vBatchTab === 'text'" class="s2v-batch-tab-body" data-testid="s2v-batch-text-pane">
          <div v-for="(text, index) in s2vBatchTexts" :key="index" class="s2v-batch-text-row">
            <textarea
              v-model="s2vBatchTexts[index]"
              class="form-input textarea s2v-batch-text-area"
              rows="3"
              :placeholder="translateWithLocaleFallback('create.story2video.batch.textPlaceholder', '输入第 ' + (index + 1) + ' 条文案（每条最多 ' + MAX_STORY2VIDEO_TEXT_CHARACTERS + ' 字）', 'Enter text ' + (index + 1) + ' (max ' + MAX_STORY2VIDEO_TEXT_CHARACTERS + ' chars each)', { index: index + 1, max: MAX_STORY2VIDEO_TEXT_CHARACTERS })"
              :data-testid="'s2v-batch-text-' + index"
            ></textarea>
            <button
              v-if="s2vBatchTexts.length > 1"
              type="button"
              class="btn-icon s2v-batch-text-remove"
              :data-testid="'s2v-batch-text-remove-' + index"
              :title="translateWithLocaleFallback('common.delete', '删除', 'Delete')"
              @click="removeS2VBatchText(index)"
            ><span class="material-symbols-outlined">close</span></button>
          </div>
          <div class="s2v-batch-text-actions">
            <UiButton variant="secondary" :disabled="s2vBatchTexts.length >= S2V_BATCH_MAX_TEXTS" data-testid="s2v-batch-add-text" @click="addS2VBatchText">
              + {{ translateWithLocaleFallback('create.story2video.batch.addText', '新增文案', 'Add text') }}
            </UiButton>
            <span v-if="s2vBatchTexts.length >= S2V_BATCH_MAX_TEXTS" class="config-hint">
              {{ translateWithLocaleFallback('create.story2video.batch.textLimitHint', '最多可输入 10 条文案', 'Up to 10 texts') }}
            </span>
          </div>
        </div>

        <!-- 本地文件（.txt/.md，最多 20 个） -->
        <div v-else class="s2v-batch-tab-body" data-testid="s2v-batch-files-pane">
          <input
            ref="s2vBatchFileInput"
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            multiple
            style="display:none"
            @change="handleS2VBatchFileInput"
          />
          <div class="s2v-batch-file-actions">
            <UiButton variant="secondary" data-testid="s2v-batch-pick-files" @click="pickS2VBatchFiles">
              {{ translateWithLocaleFallback('create.story2video.batch.pickFiles', '选择文件', 'Choose files') }}
            </UiButton>
            <span class="config-hint">
              {{ translateWithLocaleFallback('create.story2video.batch.fileHint', '仅支持 .txt / .md 文件，最多 20 个，单个文件最大 2MB。', 'Only .txt / .md files, up to 20 files, 2MB each.') }}
            </span>
          </div>
          <ul v-if="s2vBatchFiles.length" class="s2v-batch-file-list">
            <li v-for="(file, index) in s2vBatchFiles" :key="file.path" class="s2v-batch-file-item" :data-testid="'s2v-batch-file-' + index">
              <span class="s2v-batch-file-name" :title="file.path">{{ file.name }}</span>
              <button
                type="button"
                class="btn-icon"
                :title="translateWithLocaleFallback('common.delete', '删除', 'Delete')"
                @click="removeS2VBatchFile(index)"
              ><span class="material-symbols-outlined">close</span></button>
            </li>
          </ul>
          <p v-else class="config-hint">{{ translateWithLocaleFallback('create.story2video.batch.fileEmpty', '尚未选择文件。', 'No files selected yet.') }}</p>
        </div>

        <!-- 任务与排队信息 -->
        <div class="s2v-batch-status" data-testid="s2v-batch-status">
          <div class="s2v-batch-status-head">
            <span class="s2v-batch-status-title">{{ translateWithLocaleFallback('create.story2video.batch.queueTitle', '任务与排队', 'Tasks & queue') }}</span>
            <UiSkeleton v-if="s2vBatchLoading" variant="text" style="display:inline-block;width:72px" />
          </div>
          <p v-if="!s2vBatches.length && !s2vBatchLoading" class="config-hint" data-testid="s2v-batch-status-empty">
            {{ translateWithLocaleFallback('create.story2video.batch.queueEmpty', '暂无批量任务。启动后，任务与排队状态将显示在这里。', 'No batch tasks yet. Start a batch to see its queue status here.') }}
          </p>
          <div v-for="batch in s2vBatches" :key="batch.id" class="s2v-batch-card" :data-testid="'s2v-batch-card-' + batch.id">
            <div class="s2v-batch-card-head">
              <span class="s2v-batch-card-time">{{ formatS2VBatchCreatedAt(batch.createdAt) }}</span>
              <span class="s2v-batch-card-mode">{{ batch.mode === 'files' ? translateWithLocaleFallback('create.story2video.batch.modeFiles', '本地文件', 'Local files') : translateWithLocaleFallback('create.story2video.batch.modeText', '输入文案', 'Text input') }}</span>
              <span class="s2v-batch-card-summary">{{ batchSummaryText(batch) }}</span>
            </div>
            <ul class="s2v-batch-item-list">
              <li v-for="item in batch.items" :key="item.itemId" class="s2v-batch-item" :data-testid="'s2v-batch-item-' + item.itemId">
                <span class="s2v-batch-item-label" :title="item.label">{{ item.label }}</span>
                <span :class="['s2v-batch-item-badge', 'status-' + item.status]" data-testid="s2v-batch-item-status">{{ s2vBatchItemStatusText(item) }}</span>
                <span v-if="item.status === 'running'" class="s2v-batch-item-progress">
                  {{ item.progress != null ? item.progress + '%' : '' }}<template v-if="item.currentStage"> · {{ item.currentStage }}</template>
                </span>
                <button
                  v-if="item.status === 'pending'"
                  type="button"
                  class="btn-icon s2v-batch-item-cancel"
                  :title="translateWithLocaleFallback('create.story2video.batch.cancelItem', '取消排队', 'Cancel queued task')"
                  data-testid="s2v-batch-item-cancel"
                  @click="cancelS2VBatchItem(batch.id, item.itemId)"
                ><span class="material-symbols-outlined">close</span></button>
              </li>
            </ul>
          </div>
        </div>

        <p v-if="s2vBatchError" class="s2v-batch-error" role="alert" data-testid="s2v-batch-error">{{ s2vBatchError }}</p>
      </div>
      <template #footer>
        <UiButton variant="primary" :disabled="s2vBatchStarting || !s2vBatchCanStart" data-testid="s2v-batch-start" @click="startS2VBatch">
          {{ s2vBatchStarting ? translateWithLocaleFallback('common.loading', '启动中...', 'Starting...') : translateWithLocaleFallback('create.story2video.batch.start', '启动', 'Start') }}
        </UiButton>
        <UiButton variant="secondary" @click="closeS2VBatchDialog">{{ translateWithLocaleFallback('create.story2video.batch.close', '关闭', 'Close') }}</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<script>
import '@/styles/create-view.css'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import UiSelect from '@/components/UiSelect.vue'
import CreateViewHistory from './CreateViewHistory.vue'
import { buildPublishFromProject, publishDataToQuery } from '@/features/publish/publish-from-project'
import { story2videoSaveAs, draftList } from '@/api/publisher'
import { PipelineSelector, StageProgress, SceneAssetSelection } from './video-creation'
import { useLoginGate } from '@/composables/useLoginGate'
import {
  deleteCustomTemplate,
  getAllTemplates,
  getTemplateById,
  saveCustomTemplate,
} from '@multi-publish/story2video-engine/template-library'

import {
  renderStart, renderStartAiVideo, renderCancel, renderGetStatus, renderInstallDeps,
  onRenderProgress, onRenderComplete, onRenderError, onRenderInstallProgress, onPipelineUpdate,
  pipelineList, pipelineStart, pipelinePause, pipelineResume, pipelineCancel,
  pipelineStatus, pipelineAdvance, pipelineHistory,
  pipelineStartOrchestrated, pipelineResumeOrchestration, pipelineAdvanceToNextCheckpoint, pipelineConfirmSceneAssets, pipelineGetRunContext,
  pipelinePauseRun, pipelineDeleteRun,
  storeGetSetting, storeSetSetting,
  story2videoImportMedia, story2videoImportMediaPath, story2videoTranscribe, story2videoListProjects, story2videoGetThumbnail,
  story2videoDeleteProject,
  story2videoBgmLibraryList, story2videoBgmLibraryAdd,
  story2videoBgmLibraryRename, story2videoBgmLibraryDelete,
  story2videoConfigProfileList, story2videoConfigProfileCreate,
  story2videoConfigProfileRename, story2videoConfigProfileDelete,
  story2videoBatchCreate, story2videoBatchStatus, story2videoBatchCancel, story2videoPickBatchFiles
} from '@/api/publisher'
import { modelProviderList } from '@/api/model-providers'
import { getApi } from '@/api/electron-bridge'
import { settingsDialogRevision } from '@/stores/settings-dialog'
import { showPipelineBackgroundToast } from '@/stores/pipeline-background-toast'
import { opsCenterSyncRuntime, opsCenterSyncPipelineOptions } from '@/api/ops-center-sync'
import { formatUserError } from '@/utils/user-facing-error'
import {
  getTtsVoiceCatalog,
  getTtsVoiceCapability,
  selectTtsVoice,
  clearTtsVoicePreference,
} from '@/api/tts-voice-catalog'
import {
  addTtsVoiceClone,
  chooseTtsVoiceCloneSamples,
  deleteTtsVoiceClone,
  getTtsVoiceCloneRequirements,
  listTtsVoiceClones,
  renameTtsVoiceClone,
} from '@/api/tts-voice-clone'
import { confirmDanger } from '@/utils/confirm-danger'
import {
  getPipelineCategory,
  getPipelineDescription,
  getPipelineMode,
  getPipelineName,
  getPipelineStage,
  getPipelineStatus,
  isTextBasedPipeline,
} from '@/i18n/pipeline-labels'
import { getAppLocale } from '@/i18n'
import { RESUME_BLOCKING_ERROR_PATTERN, filterHistoryByStatus, latestHistoryTimestamp, markStaleRunningAsInterrupted, fillFailedPausedStage, policySceneQuery, sortHistoryByEffectiveTime } from './history-utils'
import {
  MAX_STORY2VIDEO_TEXT_CHARACTERS,
  STORY2VIDEO_NOTIFICATION_KEYS,
  countStory2VideoTextCharacters,
  formatStory2VideoNotification,
  formatBgmSkippedNotification,
  historyLoadFailureDetail,
  getStory2VideoLocale,
  getStory2VideoNotificationUiText,
  resolveStory2VideoNotification,
} from '@/story2video/story2video-notifications'
import {
  countSceneChars,
  estimateCharsPerSecond,
  estimateCharsPerScene,
  estimateDurationSeconds,
  getLanguageBaseWordsPerSecond,
} from '@/story2video/voice-estimate'
import {
  buildCalibrationFactors,
  estimateDurationRange,
  estimateDurationSecondsCalibrated,
  estimateSceneCount,
  estimateCost,
  getCalibrationFactor,
} from '@/story2video/tts-calibration'
import {
  MAX_OUTPUT_RESOLUTION_KEY,
  getOutputResolutionOptions,
  normalizeResolution,
} from '@/story2video/output-resolution'

import {
  IMPLEMENTED_PIPELINES,
  PIPELINE_TERMINAL_STATUSES,
  PIPELINE_END_STATUSES,
  PIPELINE_RUN_STATUSES,
  normalizeProgressPercent,
  normalizePipelineStages,
  mergePipelineStages,
  normalizePipelineStatusSnapshot,
  hasManualPipelineCheckpoint,
  hasLegacyPipelineCheckpointEvidence,
  normalizePipelineRunMeta,
  mergePipelineRunMeta,
  createPipelineRunMeta,
  createPipelineRunMetaFromSnapshot,
  normalizePipelineContext,
  VIDEO_CLONE_PIPELINE_ENTRY,
  withVideoCloneEntry,
  getStory2VideoOutputAspectRatio,
  settleHistoryRequest,
  STYLES,
  STORY2VIDEO_STAGE_NAMES,
  AUTO_PIPELINE_STAGES,
  S2V_PLATFORMS,
  S2V_RESTORE_ENUM_OPTIONS,
  S2V_RESTORE_OUTPUT_ENUM_OPTIONS,
  pickS2VConfigProfileFields,
  pickS2VOutputProfileFields,
  CATEGORY_LABELS,
  COST_LABELS,
  STABILITY_MAP,
} from './video-creation/create-view-module-utils'

export default {
  name: 'CreateView',
  // 模板使用但此前漏注册的子组件：PipelineSelector/StageProgress/CreateViewHistory
  // （缺失会导致 Vue 'Failed to resolve component'，流水线卡片不渲染）
  components: { UiButton, UiModal, UiSelect, CreateViewHistory, PipelineSelector, StageProgress, SceneAssetSelection },
  data() {
    return {
      // 视图
      view: 'pipelines',
      // 流水线
      pipelines: [VIDEO_CLONE_PIPELINE_ENTRY], pipelineLoading: true, pipelineError: null,
      selectedPipeline: null,
      pipelineRunStatus: null, needsCheckpoint: false, pollTimer: null, orchestrationStages: [], orchestrationStatusRequestId: 0,
      // 统一流水线进度弹窗：弹窗只承载观察内容，关闭/后台运行会使 renderer 脱离而不取消主进程任务。
      pipelineProgressModalOpen: false,
      // 单次状态请求失败时保留最近一次合法进度，并在弹窗内提示可恢复状态。
      pipelineProgressStatusError: '',
      // 普通流水线按名称查询状态，没有 runId；请求代际仍必须隔离切换/后台化后的旧响应。
      pipelineStatusRequestId: 0,
      // 普通流水线只有启动响应明确返回 runId/id 时才允许按单任务后台脱离。
      // 仅凭名称查询到的状态不能伪造 run identity。
      pipelineRunId: null,
      // 流水线输入
      inputMode: 'text', pipelineText: '', pipelineImages: [], pipelineAudio: [], pipelineVideo: null,
      // 带文案进入（/create?draft=xxx 预填成功）：非文案型流水线在选择列表中灰显不可选
      textPrefilledFromDraft: false,
      // 配置
      selectedStyle: 'clean-professional',
      llmConfig: { temperature: 0.7 },
      budgetConfig: { mode: 'warn', totalUsd: 10 },
      checkpointPolicy: 'guided',
      // 分镜双模式（video-content-fidelity）：auto 自动判定 / creative 创意拓展 / fidelity 按原文保真 / hybrid 混合
      storyboardMode: 'auto',
      outputConfig: { resolution: '1920x1080', fps: 30, format: 'mp4' },
      s2vOutputConfig: { resolution: '720x1280', fps: 30, format: 'mp4' },
      // 输出分辨率能力开关（运营后台）：'1080p'（默认，前端不出现 4K）| '4k'
      maxOutputResolution: '1080p',
      // 快速渲染
      quickMode: 'text', quickText: '', quickImages: [],
      quickProfile: 'youtube-landscape', quickTheme: 'clean-professional',
      quickRendering: false, quickProgress: 0, quickStage: '', quickResult: null, quickError: null,
      aiLoading: false,
      // Remotion 状态
      renderStatus: null, installing: false, installLog: '',
      // S2V 编排模式（story2video-compose）
      s2vTtsSamples: [],
      s2vConfig: {
        contentType: 'general', imageStyle: 'cinematic',
        imageProvider: '', imageModel: '',
        voiceId: '', voiceProvider: '', voiceModel: '',
        // 参数治理（7.1.19）：voicePitch 为系统管理参数（默认 0），前端不暴露不提交，由契约默认兜底。
        voiceSpeed: 1, voiceVolume: 1,
        // 参数治理 R2（7.1.19）：concurrency 为系统管理参数（契约默认 3，范围 1-8），前端不暴露不提交。
        templateId: '', imageEffect: 'zoom-in',
        // 视频+图片轮播混合模式（2026-08-11）：默认关闭保持纯图片轮播
        videoMode: 'off', shortVideoHandling: 'loop', videoProvider: '', videoModel: '',
        videoFixedRatio: 25, videoMinRatio: 20, videoMaxRatio: 40, videoMaxScenes: 3,
        // 创作模式（2026-08-12）：auto=全自动（默认）；manual=分镜素材自选（materialMode 仅 manual 生效）
        creationMode: 'auto', manualMaterialMode: 'all-images',
        splitLanguage: 'auto', splitMode: 'balanced', splitMaxSentenceLength: 200, splitTargetSeconds: 6,
        splitTargetCharsPerScene: 20, splitViewMode: 'seconds',
        // 参数治理（7.1.19）：splitBaseWordsPerSecond 自 Batch 5a 起由语言感知表驱动（voice-estimate.js），
        // 前端字段已移除（提交走 getLanguageBaseWordsPerSecond），旧快照键被白名单忽略。
        // 参数治理 R2：splitSpeechRate 为派生死提交（normalizer 硬覆盖为 voice.speed），前端字段已移除。
        splitMinWords: 10, splitMaxWords: 50,
        splitEnforceSentenceBoundary: true, splitOverflowToNext: true,
        sceneDurationMode: 'follow-audio', minSceneDuration: 6,
        splitSubtitleMinChars: 8, splitSubtitleMaxChars: 15, splitSubtitleTiming: 'proportional',
        // 参数治理（7.1.19）：creativeLevel 为系统管理参数（默认 5），前端不暴露不提交，由契约默认兜底。
        promptStyle: 'realistic', negativePrompt: '',
        // 图片提示词最大长度（2026-08-16）：上限放开到 8013 契约 2000，默认 2000，可调低控制成本
        maxPromptLength: 2000,
        transition: 'fade', subtitleEnabled: true,
        subtitleSize: 'size3', subtitleStyleName: 'style1',
        subtitleStyle: { size: 'md', style: 'style1', color: 'white' },
        bgmPath: '', bgmVolume: 5, watermark: false, watermarkText: '',
        watermarkConfig: { enabled: false, position: 'bottom-right', fontSize: 24, opacity: 0.6, color: 'white' },
        // 参数治理 R2：autoAdvance 恒 true（提交 params 字面量），前端字段已移除。
        platforms: [], publishEnabled: false, title: '', tagsText: '', publishContent: '', coverUrl: '',
      },
      orchestrationRunId: null, orchestrationContext: null, orchestrationContextRunId: null, orchestrationResultPath: null, orchestrationError: '', providerWarnings: [],
      // 启动请求代际：切换 tab、流水线或取消时使在途 IPC 响应失效，避免旧响应重新挂回创作页。
      orchestrationStartRequestId: 0,
      // 检查点/暂停/恢复等用户动作的独立代际：后台化或切换 run 后，旧 IPC 响应不得写回新任务。
      orchestrationActionRequestId: 0,
      // 分镜素材自选（2026-08-12）：scene_asset_selection 检查点激活与候选
      sceneAssetSelectionActive: false, sceneAssetCandidates: [], sceneAssetSelectionError: '', sceneAssetConfirming: false,
      // 等待态 UX（2026-08-13）：首次激活自动定位/高亮一次性标记 + 面板注意力高亮
      selectionGuided: false, sceneAssetAttention: false, sceneAssetAttentionTimer: null,
      dismissedBgmSkippedNotice: false,
      dismissedProviderWarnings: false,
      story2videoErrorDialog: { visible: false, messageKey: '', messageParams: {}, detail: '', rawError: '' },
      cancelConfirmDialog: { visible: false, error: '' },
      story2videoResuming: false,
      pauseActionBusy: false,
      contentPolicyEditBusy: false,
      startingPipeline: false,
      story2videoRunMeta: null,
      stageClockTick: 0,
      s2vRestoring: false,
      s2vOptionsToast: '',
      s2vCloneOpen: false,
      s2vOptionsToastTimer: null,
      s2vContentRewriteToastShown: false,
      story2videoProjectDeleteDialog: { visible: false, projectId: null },
      story2videoRunDeleteDialog: { visible: false, runId: null },
      story2videoTemplateDeleteDialog: { visible: false, templateId: null },
      story2videoBatchDeleteDialog: { visible: false, items: [] },
      deleting: false,
      // 背景音乐素材库（2026-08-14）：设备级持久化，添加/重命名/删除后自动刷新
      s2vBgmLibrary: [],
      s2vBgmLibraryLoading: false,
      s2vBgmLibraryDialogOpen: false,
      s2vBgmLibraryRenamingId: '',
      s2vBgmLibraryRenameDraft: '',
      s2vBgmLibraryDeleteDialogOpen: false,
      s2vBgmLibraryDeleteTargetId: null,
      // 流水线「保存配置」（2026-08-28 s2v-pipeline-config-profiles）：设备级命名组合配置
      s2vConfigProfiles: [],
      s2vConfigProfilesLoading: false,
      s2vConfigProfileDialogOpen: false,
      s2vConfigProfileNameDraft: '',
      s2vConfigProfileOverwriteNeeded: false,
      s2vConfigProfileListOpen: false,
      s2vConfigProfileRenamingId: '',
      s2vConfigProfileRenameDraft: '',
      s2vConfigProfileApplyDialogOpen: false,
      s2vConfigProfileApplyTarget: null,
      s2vConfigProfileApplyPipelineId: '',
      s2vConfigProfileApplying: false,
      // 当前已应用的配置名（2026-08-31）：应用配置后显示，用户改动选项后清除
      s2vActiveConfigProfile: '',
      s2vConfigProfileDeleteDialogOpen: false,
      s2vConfigProfileDeleteTarget: null,
      s2vConfigProfileListRequestId: 0,
      s2vConfigProfileError: '',
      // 批量创作（2026-08-15 story2video-batch-create）：弹窗状态 / 输入源 / 队列展示
      s2vBatchDialogOpen: false,
      s2vBatchTab: 'text',
      s2vBatchVideoMode: 'off',
      s2vBatchTexts: [''],
      s2vBatchFiles: [],
      s2vBatchStarting: false,
      s2vBatchLoading: false,
      s2vBatchError: '',
      s2vBatches: [],
      s2vBatchPollTimer: null,
      S2V_BATCH_MAX_TEXTS: 10,
      S2V_BATCH_MAX_FILES: 20,
      MAX_STORY2VIDEO_TEXT_CHARACTERS,
      s2vImageProviders: [], s2vVoiceProviders: [], s2vVideoProviders: [],
      s2vVoiceCatalog: [], s2vVoiceCatalogLoading: false, s2vVoiceCatalogError: '', s2vVoiceCatalogErrorCode: '', s2vVoiceCapability: null,
      s2vVoiceProviderRequestId: 0, s2vVoiceRequestId: 0, s2vVoiceSelectionRequestId: 0, s2vVoiceCloneRequestId: 0, s2vPersistedVoiceId: '',
      s2vVoiceCloneRequirements: null, s2vVoiceClones: [],
      s2vVoiceCloneSelection: null, s2vVoiceCloneLoading: false, s2vVoiceCloneError: '',
      // 克隆进行中占位行（选择本地音频后自动克隆期间的即时反馈，2026-08-13）
      s2vVoiceClonePending: null,
      s2vVoiceCloneRenamingId: '', s2vVoiceCloneRenameDraft: '',
      // 用户显式选择了「自动 Edge TTS」（voiceProvider=''）时为 true；用于区分「未选择」与「显式 Edge」，
      // 避免 loadS2VProviders 重入时被多模态默认覆盖。
      s2vVoiceProviderExplicitEdge: false,
      s2vTemplateLibrary: [], s2vTemplateCategory: 'all', s2vCustomTemplateName: '',
      s2vOpenSections: { basic: true, appearance: false, videoEnhance: false, voice: false, advanced: false, publish: false },
      // 运营中心选项控制（2026-08-31）：可见性与默认值
      s2vPipelineOptions: null,
      s2vPipelineOptionsLoading: false,
      // 历史
      history: [], historyLoading: false, historyLocalMode: false, historyFilter: 'all', historyRequestId: 0, historyPollTimer: null,
      // 页面导航历史
      viewHistory: [], viewHistoryIndex: -1,
      // 清理
      cleanups: [],
      quickModes: [
        { value: 'text', label: '文案生成' },
        { value: 'gallery', label: '图片轮播' },
      ],
    }
  },
  computed: {
    styles() { return STYLES },
    s2vTemplates() {
      const templates = this.s2vTemplateCategory === 'all'
        ? this.s2vTemplateLibrary
        : this.s2vTemplateLibrary.filter(template => template.category === this.s2vTemplateCategory)
      return [
        { value: '', label: '自定义参数' },
        ...templates.map(template => ({ value: template.id, label: template.name })),
      ]
    },
    selectedS2VTemplate() {
      return this.s2vTemplateLibrary.find(template => template.id === this.s2vConfig.templateId) || null
    },
    filteredHistory() {
      return filterHistoryByStatus(this.history, this.historyFilter)
    },
    activeOutputConfig() {
      return this.isOrchestratedPipeline(this.selectedPipeline?.name) ? this.s2vOutputConfig : this.outputConfig
    },
    outputResolutionOptions() {
      // 4K 开关关闭（默认 1080p）时前端所有流程不出现 3840x2160 选项
      return getOutputResolutionOptions(this.maxOutputResolution)
    },
    // 多模态模型（category=multimodal）在图片/语音能力选择器中用「（多模态）」后缀区分，
    // 便于用户识别「一个 Key 覆盖多能力」的模型，避免与单能力模型同名混淆。
    s2vImageProviderOptions() {
      return this.s2vImageProviders.map(provider => ({
        ...provider,
        displayName: provider.category === 'multimodal' ? provider.name + '（多模态）' : provider.name,
      }))
    },
    s2vVoiceProviderOptions() {
      // 首项「自动 Edge TTS」必须带 displayName，否则模板 {{ provider.displayName }} 渲染为空选项（2026-08-10 Bug 反哺）
      return [{ id: '', name: '自动 Edge TTS', displayName: '自动 Edge TTS' }, ...this.s2vVoiceProviders.map(provider => ({
        ...provider,
        displayName: provider.category === 'multimodal' ? provider.name + '（多模态）' : provider.name,
      }))]
    },
    s2vVideoProviderOptions() {
      return this.s2vVideoProviders.map(provider => ({
        ...provider,
        displayName: provider.category === 'multimodal' ? provider.name + '（多模态）' : provider.name,
      }))
    },
    s2vVideoModelOptions() {
      const provider = this.s2vVideoProviders.find(item => item?.id === this.s2vConfig.videoProvider)
      if (!provider) return []
      const strings = (Array.isArray(provider.models) ? provider.models : []).filter(model => typeof model === 'string' && model)
      // 多模态：只展示声明支持视频的默认模型（capability_models.video）
      if (provider.category === 'multimodal' && provider.capability_models && typeof provider.capability_models.video === 'string') {
        const videoModel = provider.capability_models.video
        return strings.includes(videoModel) ? [videoModel] : [videoModel, ...strings]
      }
      return strings
    },
    s2vVoiceCatalogRefreshable() {
      // 仅瞬时/未知错误提供「刷新音色列表」；配置类/不支持/模型不匹配/身份问题重试无效
      if (!this.s2vVoiceCatalogError) return false
      const code = this.s2vVoiceCatalogErrorCode
      return code === '' || code === 'VOICE_CATALOG_UNAVAILABLE'
    },
    s2vVoiceModelOptions() {
      const provider = this.s2vVoiceProviders.find(item => item?.id === this.s2vConfig.voiceProvider)
      if (!provider) return []
      const models = Array.isArray(provider.models) ? provider.models : []
      const strings = models.filter(model => typeof model === 'string' && model)
      // MiMo TTS：语音模型下拉隐藏（模型由「语音/音色 ID」区分：预置→mimo-v2.5-tts，克隆→mimo-v2.5-tts-voiceclone）
      if (provider.id === 'mimo-tts') return []
      // 多模态：只展示声明支持 TTS 的默认模型（capability_models.tts），
      // 避免把 image/video/llm 模型混入「语音模型」下拉。
      if (provider.category === 'multimodal' && provider.capability_models && typeof provider.capability_models.tts === 'string') {
        const ttsModel = provider.capability_models.tts
        return strings.includes(ttsModel) ? [ttsModel] : [ttsModel, ...strings]
      }
      return strings
    },
    // MiMo TTS 的「语音模型」下拉隐藏：mimo-v2.5-tts 与 mimo-v2.5-tts-voiceclone
    // 由「语音 / 音色 ID」下拉区分（预置音色 → tts，克隆音色 → voiceclone）。
    s2vVoiceModelHidden() {
      const provider = this.getS2VVoiceProvider()
      return Boolean(provider && provider.id === 'mimo-tts')
    },
    // MiMo TTS 下 catalog 请求使用的模型：预置音色目录用 mimo-v2.5-tts
    // （克隆音色由 tts-voice-clone-service 单独按 provider:model 管理）。
    s2vVoiceContextModel() {
      if (this.s2vVoiceModelHidden) return 'mimo-v2.5-tts'
      return typeof this.s2vConfig.voiceModel === 'string' ? this.s2vConfig.voiceModel.trim() : ''
    },
    s2vVoiceOptions() {
      const voices = [
        ...(Array.isArray(this.s2vVoiceCatalog) ? this.s2vVoiceCatalog : []),
        ...(Array.isArray(this.s2vVoiceClones) ? this.s2vVoiceClones : []),
      ]
      return [...new Map(voices.map(voice => [voice.id, voice])).values()]
    },
    story2videoConfigurationTitle() {
      return this.translateWithLocaleFallback(
        'create.story2video.configurationTitle',
        '故事讲述配置',
        'Story Telling Configuration'
      )
    },
    providerWarningText() {
      if (this.dismissedProviderWarnings) return ''
      const warnings = Array.isArray(this.providerWarnings) ? this.providerWarnings : []
      if (warnings.length === 0) return ''
      const names = warnings.map((w) => {
        const secs = Number.isFinite(Number(w.latencyMs)) ? Math.round(Number(w.latencyMs) / 1000) : 0
        return w.providerId + (secs > 0 ? '（' + secs + ' 秒）' : '')
      }).join('、')
      return '检测到模型服务响应异常：' + names + '。流水线已自动重试；若反复出现，建议到【模型设置】切换模型或检查该服务商。'
    },
    // 由 run.context.compose（compose 阶段输出，已含 bgmSkipped/bgmSkippedReason）驱动；
    // 用户关闭后本次运行不再显示，下次运行重新评估。
    story2videoBgmSkippedNotice() {
      if (this.dismissedBgmSkippedNotice) return ''
      const rawCompose = this.orchestrationContext && typeof this.orchestrationContext === 'object'
        ? this.orchestrationContext.compose
        : null
      // 兼容历史持久化运行可能的 { data } 包裹（与 extractOrchestrationVideoPath 防御范式一致）
      const compose = (rawCompose && rawCompose.data) || rawCompose
      if (!compose || compose.bgmSkipped !== true) return ''
      return formatBgmSkippedNotification(compose.bgmSkippedReason).message
    },
    story2videoImageStyleHint() {
      return this.translateWithLocaleFallback(
        'create.story2video.imageStyleHint',
        '控制每张生成图片的视觉外观。',
        'Controls the visual appearance of generated images.'
      )
    },
    story2videoPromptStyleHint() {
      return this.translateWithLocaleFallback(
        'create.story2video.promptStyleHint',
        '仅控制分镜图片提示词的写法与组织方式，不替代图片风格。',
        'Controls how image prompts are written and organized; it does not replace image style.'
      )
    },
    s2vMaxPromptLengthOptions: () => [200, 300, 400, 500, 700, 1000, 1500, 2000],
    s2vMaxPromptLengthLabel() {
      return typeof this.$t === 'function' ? this.$t('create.story2video.maxPromptLength') : 'create.story2video.maxPromptLength'
    },
    s2vMaxPromptLengthHint() {
      return typeof this.$t === 'function' ? this.$t('create.story2video.maxPromptLengthHint') : 'create.story2video.maxPromptLengthHint'
    },
    // ---- 分镜粒度双视图（三层模型①）：底层统一 targetCharsPerScene 主控 ----
    // 语言感知估算（Batch 5a）：zh 4.5 / en 2.8 / 其余 3.3 × voice.speed（speechRate 单一来源）
    s2vSplitCharsPerSecond() {
      return estimateCharsPerSecond(this.s2vConfig.splitLanguage, this.s2vConfig.voiceSpeed)
    },
    // 字数 → 估算时长（时长视图显示；与 normalizer 幂等反推一致取整数秒）
    s2vSplitEstimatedSeconds() {
      const chars = Number(this.s2vConfig.splitTargetCharsPerScene)
      if (!Number.isFinite(chars) || chars <= 0) return 6
      return estimateDurationSeconds(chars, this.s2vConfig.splitLanguage, this.s2vConfig.voiceSpeed)
    },
    // 时长视图可达上限：受每分镜字数上限（maxWords）约束，输入范围 = 可达范围（claude review W1）
    s2vSplitMaxSeconds() {
      const maxWords = Math.min(200, Number(this.s2vConfig.splitMaxWords) || 50)
      return Math.max(1, Math.min(60, Math.round(maxWords / this.s2vSplitCharsPerSecond)))
    },
    // 时长视图输入：编辑估算时长 → 语言感知反推并 clamp 主控字数
    s2vSplitSecondsView: {
      get() { return this.s2vSplitEstimatedSeconds },
      set(value) {
        const seconds = Number(value)
        if (!Number.isFinite(seconds) || seconds <= 0) return
        this.applyS2VTargetChars(estimateCharsPerScene(
          seconds,
          this.s2vConfig.splitLanguage,
          this.s2vConfig.voiceSpeed,
          this.s2vConfig.splitMinWords,
          this.s2vConfig.splitMaxWords,
        ))
      },
    },
    // 字数视图输入：直接主控，clamp 到 [minWords, maxWords] ∩ [1,200]
    s2vSplitCharsView: {
      get() { return this.s2vConfig.splitTargetCharsPerScene },
      set(value) { this.applyS2VTargetChars(Number(value)) },
    },
    // 最短场景时长开关（三层模型③）：默认 follow-audio（关闭）
    s2vSceneDurationEnabled: {
      get() { return this.s2vConfig.sceneDurationMode === 'min-duration' },
      set(enabled) { this.s2vConfig.sceneDurationMode = enabled ? 'min-duration' : 'follow-audio' },
    },
    // 最短场景时长 N 输入：UI 侧 clamp 到 1..60（normalizer fail-closed 兜底，此处自愈避免通用报错）
    s2vMinSceneDurationView: {
      get() { return this.s2vConfig.minSceneDuration },
      set(value) {
        const n = Number(value)
        if (!Number.isFinite(n) || n <= 0) return
        this.s2vConfig.minSceneDuration = Math.min(60, Math.max(1, Math.round(n)))
      },
    },
    mediaRequirementsImageText() {
      return this.translateWithLocaleFallback(
        'create.story2video.mediaRequirementsImage',
        '支持 jpg / jpeg / png / webp 格式，单个文件最大 10MB。',
        'Supports jpg / jpeg / png / webp. Max 10MB per file.'
      )
    },
    mediaRequirementsAudioText() {
      return this.translateWithLocaleFallback(
        'create.story2video.mediaRequirementsAudio',
        '支持 wav / m4a / mp3 格式，单个文件最大 50MB。',
        'Supports wav / m4a / mp3. Max 50MB per file.'
      )
    },
    mediaRequirementsBgmText() {
      return this.translateWithLocaleFallback(
        'create.story2video.mediaRequirementsBgm',
        '支持 wav / m4a / mp3 格式，单个文件最大 15MB。',
        'Supports wav / m4a / mp3. Max 15MB per file.'
      )
    },
    mediaRequirementsVideoText() {
      return this.translateWithLocaleFallback(
        'create.story2video.mediaRequirementsVideo',
        '支持 mp4 / mov / webm / mkv / avi 格式，单个文件最大 512MB。',
        'Supports mp4 / mov / webm / mkv / avi. Max 512MB per file.'
      )
    },
    s2vPlatforms() { return S2V_PLATFORMS },
    profileOptions() {
      return [
        { value: 'youtube-landscape', label: 'YouTube 横屏 (1920x1080)' },
        { value: 'youtube-shorts', label: 'YouTube Shorts (1080x1920)' },
        { value: 'tiktok', label: '抖音/TikTok (1080x1920)' },
        { value: 'bilibili', label: 'Bilibili (1920x1080)' },
        { value: 'wechat', label: '微信视频号 (1080x1920)' },
        { value: 'xiaohongshu', label: '小红书 (1080x1440)' },
      ]
    },
    themeOptions() {
      return STYLES.map(s => ({ value: s.value, label: s.label }))
    },
    canStartPipeline() {
      if (!this.selectedPipeline) return false
      if (!this.pipelineAvailable(this.selectedPipeline.name)) return false
      // 防重复启动（2026-08-21 回归修复）：启动请求在途禁止点击；编排 run 已挂到当前视图
      // （运行/暂停/检查点）时同样禁用「启动流水线」，防止连点起出重复后台任务。
      if (this.startingPipeline) return false
      if (this.isOrchestratedPipeline(this.selectedPipeline.name) && this.orchestrationRunId) return false
      if (this.isOrchestratedPipeline(this.selectedPipeline.name)) {
        return this.inputMode === 'text' && this.pipelineText.trim().length > 0
      }
      if (this.inputMode === 'text') return this.pipelineText.trim().length > 0
      if (this.inputMode === 'images') return this.pipelineImages.length > 0
      if (this.inputMode === 'audio') return this.pipelineAudio.length > 0
      if (this.inputMode === 'video') {
        return !this.isOrchestratedPipeline(this.selectedPipeline.name) && !!this.pipelineVideo
      }
      return true
    },
    story2videoTextCharacterCount() {
      return countStory2VideoTextCharacters(this.pipelineText)
    },
    // ---- 运营后台实时预估（Batch 5b）：分镜数 / 时长区间 / 成本 ----
    s2vEstimateFactors() {
      return buildCalibrationFactors(this.s2vTtsSamples)
    },
    s2vEstimateSummary() {
      if (!this.selectedPipeline || !this.isOrchestratedPipeline(this.selectedPipeline.name)) return null
      const text = String(this.pipelineText || '').trim()
      if (!text) return null
      // 与样本 chars / 切分器 normalizeText 同口径：折叠空白后计数（codex review W2），
      // 避免英文多行/双空格文案的分镜数系统性偏大。
      const totalChars = countSceneChars(text)
      const target = Number(this.s2vConfig.splitTargetCharsPerScene) > 0 ? Number(this.s2vConfig.splitTargetCharsPerScene) : 20
      const sceneCount = estimateSceneCount(totalChars, target)
      const factors = this.s2vEstimateFactors
      const ctx = {
        language: this.s2vConfig.splitLanguage,
        speed: this.s2vConfig.voiceSpeed,
        provider: this.s2vConfig.voiceProvider,
        voiceId: this.s2vConfig.voiceId,
      }
      const perScenePoint = estimateDurationSecondsCalibrated(target, factors, ctx)
      const [perMin, perMax] = estimateDurationRange(target, factors, ctx)
      const durationMin = sceneCount * perMin
      const durationMax = sceneCount * perMax
      const cost = estimateCost({ sceneCount, totalDurationSeconds: sceneCount * perScenePoint })
      return {
        sceneCount,
        durationMin,
        durationMax,
        totalCost: cost.totalCost,
        // W3（claude 5b）：仅当当前配置实际命中语言级或更特异校准维度时才标注“已校准”
        calibrated: getCalibrationFactor(factors, ctx) > 1,
      }
    },
    historyLocalModeText() {
      return formatStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.HISTORY_LOCAL_MODE }).message
    },
    // 历史/模板导入的 BGM 路径不在素材库时保留为独立选项，避免静默丢失已有配置
    s2vLegacyBgmPath() {
      const current = String(this.s2vConfig.bgmPath || '').trim()
      if (!current) return ''
      if (this.s2vBgmLibrary.some(item => String(item.path) === current)) return ''
      return current
    },
    story2videoBgmLibraryDeleteConfirmMessage() {
      const target = this.s2vBgmLibrary.find(item => item.id === this.s2vBgmLibraryDeleteTargetId)
      return formatStory2VideoNotification({
        messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_DELETE_CONFIRM,
        messageParams: { name: target ? target.name : '' },
      }).message
    },
    story2videoErrorDialogMessage() {
      return formatStory2VideoNotification({ messageKey: this.story2videoErrorDialog.messageKey, messageParams: this.story2videoErrorDialog.messageParams }).message
    },
    // 启动前置校验（models_required）：提供「去模型设置」直达入口
    canGoToModelSettings() {
      return Boolean(this.story2videoErrorDialog.visible) &&
        this.story2videoErrorDialog.messageKey === STORY2VIDEO_NOTIFICATION_KEYS.MODELS_REQUIRED
    },
    canResumeStory2Video() {
      if (!this.story2videoErrorDialog.visible || !this.orchestrationRunId || this.story2videoResuming) return false
      // 原始错误文本（showStory2VideoErrorDialog 时保留）与本地化消息一并参与门控，
      // 与历史列表/主进程使用同一关键字规则（content policy / content_policy / content-policy 均拦截）
      const raw = (this.story2videoErrorDialogMessage || '') + '\n' + (this.story2videoErrorDialog.rawError || '')
      // 内容政策失败需要人工修改文案，不允许原样恢复
      if (RESUME_BLOCKING_ERROR_PATTERN.test(raw)) return false
      return true
    },
    pipelineProgressStages() {
      const statusStages = this.pipelineRunStatus?.stages
      const stages = Array.isArray(statusStages) && statusStages.length > 0
        ? statusStages
        : this.orchestrationStages
      return normalizePipelineStages(stages)
    },
    pipelineProgressPercent() {
      return normalizeProgressPercent(this.pipelineRunStatus?.progress, null)
    },
    pipelineProgressHasNumericPercent() {
      return this.pipelineProgressPercent !== null
    },
    pipelineProgressLoadingText() {
      return this.translateWithLocaleFallback(
        'create.story2video.progressLoading',
        '正在加载流水线进度…',
        'Loading pipeline progress…',
      )
    },
    pipelineProgressModalTitle() {
      const name = this.pipelineName(this.selectedPipeline?.name) || this.selectedPipeline?.name || ''
      const translated = this.$t?.('create.story2video.progressTitle', { name })
      return typeof translated === 'string' && translated !== 'create.story2video.progressTitle'
        ? translated
        : (name ? 'Pipeline progress · ' + name : 'Pipeline progress')
    },
    pipelineProgressCloseDisabled() {
      // 内容政策检查点：关闭按钮可点击，点击=取消任务（作为失败/已取消处理），
      // 而不是静默后台化（后台化会让任务卡在 needs_user_input 状态无法继续）。
      if (this.isContentPolicyCheckpoint) return false
      return this.isPipelineManualCheckpoint()
    },
    pipelineProgressCloseLabel() {
      if (this.isContentPolicyCheckpoint) {
        const key = 'create.story2video.progressContentPolicyCloseLabel'
        const translated = this.$t?.(key)
        return typeof translated === 'string' && translated !== key
          ? translated
          : 'Close and cancel this task'
      }
      const key = this.pipelineProgressCloseDisabled
        ? 'create.story2video.progressManualCloseLabel'
        : 'create.story2video.progressCloseLabel'
      const translated = this.$t?.(key)
      return typeof translated === 'string' && translated !== key
        ? translated
        : (this.pipelineProgressCloseDisabled
          ? 'This task needs your input and cannot be closed or moved to the background'
          : 'Close and run in background')
    },
    pipelineProgressManualHint() {
      const key = this.pipelineProgressLegacyCheckpoint
        ? 'create.story2video.progressLegacyCheckpointHint'
        : 'create.story2video.progressManualHint'
      const translated = this.$t?.(key)
      return typeof translated === 'string' && translated !== key
        ? translated
        : (this.pipelineProgressLegacyCheckpoint
          ? 'This task comes from a legacy manual checkpoint and has no submit action protocol. Use Cancel below or restore it from History.'
          : 'This task needs your input before it can continue.')
    },
    pipelineProgressLegacyCheckpoint() {
      const snapshot = this.pipelineRunStatus
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
      const checkpoint = snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
        ? snapshot.checkpoint
        : null
      if (checkpoint?.type || checkpoint?.reason) return false
      return hasLegacyPipelineCheckpointEvidence(snapshot, this.orchestrationContext)
    },
    pipelineProgressCheckpointText() {
      const checkpoint = this.pipelineRunStatus?.checkpoint
      if (!checkpoint || typeof checkpoint !== 'object') return ''
      const key = checkpoint.reason === 'content_policy' || checkpoint.type === 'content_policy'
        ? 'create.story2video.progressContentPolicyHint'
        : (checkpoint.type === 'scene_asset_selection' || checkpoint.reason === 'scene_asset_selection' ? 'create.story2video.progressSelectionHint' : '')
      if (!key) return ''
      const translated = this.$t?.(key)
      return typeof translated === 'string' && translated !== key ? translated : ''
    },
    canDetachPipelineToBackground() {
      if (this._s2vAlive === false || !this.selectedPipeline || this.isPipelineManualCheckpoint()) return false
      const runId = typeof this.orchestrationRunId === 'string' ? this.orchestrationRunId.trim() : ''
      if (this.isOrchestratedPipeline(this.selectedPipeline.name)) return Boolean(runId)
      if (!this.pipelineRunId) return false
      const status = this.pipelineRunStatus?.status
      return Boolean(this.pipelineRunStatus && status && !['idle', 'completed', 'failed', 'cancelled'].includes(status))
    },
    // 内容政策检查点（2026-08-30）：图片提示词被判定敏感且重试耗尽，run 暂停于 needs_user_input。
    // 该任务不能断点续跑，必须修改受影响场景文案后重新生成；提供「编辑场景」直达入口。
    isContentPolicyCheckpoint() {
      const checkpoint = this.pipelineRunStatus?.checkpoint
      if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return false
      const reason = String(checkpoint.reason || '').trim().toLowerCase()
      const type = String(checkpoint.type || '').trim().toLowerCase()
      return reason === 'content_policy' || type === 'content_policy'
    },
    // 内容政策检查点携带的受影响场景号（1-based，升序去重）。
    contentPolicySceneNumbers() {
      const checkpoint = this.pipelineRunStatus?.checkpoint
      if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return []
      const numbers = new Set()
      if (Array.isArray(checkpoint.scenes)) {
        for (const scene of checkpoint.scenes) {
          const value = scene && Number.isInteger(scene.sceneNumber) && scene.sceneNumber > 0
            ? scene.sceneNumber
            : (scene && Number.isInteger(scene.sceneIndex) && scene.sceneIndex >= 0 ? scene.sceneIndex + 1 : null)
          if (value) numbers.add(value)
        }
      }
      const single = Number.isInteger(checkpoint.sceneNumber) && checkpoint.sceneNumber > 0
        ? checkpoint.sceneNumber
        : (Number.isInteger(checkpoint.sceneIndex) && checkpoint.sceneIndex >= 0 ? checkpoint.sceneIndex + 1 : null)
      if (single) numbers.add(single)
      return [...numbers].sort((a, b) => a - b)
    },
    // 当前 run 对应的可编辑项目 projectId（getRunSnapshot 透传 run.projectId）。
    contentPolicyProjectId() {
      const value = this.pipelineRunStatus?.projectId
      return typeof value === 'string' && value.trim() ? value.trim() : ''
    },
    orchestrationProgressPercent() {
      // 主进程权威值优先（_calcProgress = 阶段数占比 + 当前阶段 percent 加权，统一契约下发）
      const authoritative = normalizeProgressPercent(this.pipelineRunStatus?.progress, null)
      if (authoritative !== null) return authoritative
      // 回退：本地按阶段状态计算（历史 run / 旧快照无 progress 字段）
      const stages = this.pipelineRunStatus?.stages || this.orchestrationStages
      if (!Array.isArray(stages) || stages.length === 0) return 0
      const done = stages.filter(s => s.status === 'completed' || s.status === 'skipped').length
      return Math.round((done / stages.length) * 100)
    },
    orchestrationElapsedMs() {
      const meta = this.story2videoRunMeta
      if (!meta) return null
      // 新口径（2026-08-10）：已用时 = 流水线各步骤实际执行耗时总和（主进程 run.activeMs 累计），
      // 不含暂停/检查点等待/失败→断点恢复之间的空闲时间；运行中本地每秒补当前执行段增量（依赖
      // stageClockTick 每秒触发重算，暂停/终态后停止），终态定格。
      // 存在性守卫：必须显式排除 null/undefined（Number(null)===0 会把「无 activeMs 的旧数据」误当 0）。
      if (meta.activeMs !== null && meta.activeMs !== undefined && Number.isFinite(Number(meta.activeMs)) && Number(meta.activeMs) >= 0) {
        let total = Number(meta.activeMs)
        if (this.pipelineRunStatus?.status === 'running') {
          void this.stageClockTick // 每秒补差依赖
          if (meta.activeSegmentStartedAt) {
            const segmentStart = Date.parse(meta.activeSegmentStartedAt)
            if (Number.isFinite(segmentStart)) total += Math.max(0, Date.now() - segmentStart)
          }
        }
        return total
      }
      // 旧数据回退：无 activeMs 的历史运行按墙钟（createdAt→endedAt/now）展示，避免显示为空
      if (!meta.createdAt) return null
      const start = Date.parse(meta.createdAt)
      if (!Number.isFinite(start)) return null
      const end = meta.endedAt ? Date.parse(meta.endedAt) : Date.now()
      if (!Number.isFinite(end)) return null
      return Math.max(0, end - start)
    },
    orchestrationSummary() {
      const meta = this.story2videoRunMeta
      if (!meta || !meta.endedAt) return ''
      let durationMs = null
      // 新口径：完成汇总时长 = 步骤执行耗时累计（activeMs）；旧数据回退墙钟
      // 存在性守卫：显式排除 null/undefined（Number(null)===0 陷阱）
      if (meta.activeMs !== null && meta.activeMs !== undefined && Number.isFinite(Number(meta.activeMs)) && Number(meta.activeMs) >= 0) {
        durationMs = Number(meta.activeMs)
      } else if (meta.createdAt) {
        const start = Date.parse(meta.createdAt)
        const end = Date.parse(meta.endedAt)
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) durationMs = end - start
      }
      if (durationMs === null) return ''
      const durationText = this.formatDuration(durationMs)
      const durationLabel = this.translateWithLocaleFallback('story2video.summaryDuration', '完成时间共 ' + durationText, 'Finished in ' + durationText, { text: durationText })
      if (Number.isFinite(Number(meta.outputSizeBytes)) && Number(meta.outputSizeBytes) > 0) {
        const mb = (Number(meta.outputSizeBytes) / (1024 * 1024)).toFixed(1)
        const sizeLabel = this.translateWithLocaleFallback('story2video.summaryFileSize', '文件大小 ' + mb + ' M', 'Size ' + mb + ' MB', { size: mb })
        return durationLabel + ' · ' + sizeLabel
      }
      return durationLabel
    },
    story2videoErrorDialogUiText() {
      return getStory2VideoNotificationUiText(getStory2VideoLocale(), this.pipelineName(this.selectedPipeline?.name))
    },
    story2videoProjectDeleteDialogMessage() {
      return formatStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PROJECT_DELETE_CONFIRM }).message
    },
    story2videoRunDeleteDialogMessage() {
      return formatStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.RUN_DELETE_CONFIRM }).message
    },
    story2videoTemplateDeleteDialogMessage() {
      return formatStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEMPLATE_DELETE_CONFIRM }).message
    },
    story2videoBatchDeleteDialogMessage() {
      const count = this.story2videoBatchDeleteDialog.items.length
      return formatStory2VideoNotification({
        messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_CONFIRM,
        messageParams: { count },
      }).message
    },
    canQuickRender() {
      if (this.quickRendering) return false
      if (this.quickMode === 'text') return this.quickText.trim().length > 0
      if (this.quickMode === 'gallery') return this.quickImages.length > 0
      return false
    },
    canGoBack() { return this.viewHistoryIndex > 0; },
    canGoForward() { return this.viewHistoryIndex < this.viewHistory.length - 1; },
  },
  watch: {
    // 「返回」跳 /create?view=history 与直接输入地址时同步历史记录视图（2026-08-16 术语统一）
    '$route.query.view'(value) {
      if (value === 'history' && this.view !== 'history') {
        this.detachPipelineView('history')
        this.view = 'history'
        this.loadHistory()
      }
    },
    // 选项变更 1s 防抖自动保存，下次进入恢复上次选项
    s2vConfig: { deep: true, handler() { if (!this.s2vConfigProfileApplying) { this.s2vActiveConfigProfile = ''; this.scheduleS2VLastOptionsSave() } } },
    s2vOutputConfig: { deep: true, handler() { if (!this.s2vConfigProfileApplying) { this.s2vActiveConfigProfile = ''; this.scheduleS2VLastOptionsSave() } } },
    // 分镜素材自选等待态（2026-08-13）：首次激活自动滚动到面板并短时高亮；关闭后重置，下次激活再引导
    sceneAssetSelectionActive(active) {
      if (!active) {
        this.selectionGuided = false
        this.sceneAssetAttention = false
        if (this.sceneAssetAttentionTimer) { clearTimeout(this.sceneAssetAttentionTimer); this.sceneAssetAttentionTimer = null }
        return
      }
      if (!this.selectionGuided) {
        this.selectionGuided = true
        this.$nextTick(() => this.scrollToSceneAssetPanel())
      }
    },
  },
  methods: {
    // 页面导航箭头
    goBack() { if (this.viewHistoryIndex > 0) { this.viewHistoryIndex--; this.applyViewState(this.viewHistory[this.viewHistoryIndex]); } },
    goForward() { if (this.viewHistoryIndex < this.viewHistory.length - 1) { this.viewHistoryIndex++; this.applyViewState(this.viewHistory[this.viewHistoryIndex]); } },
    applyViewState(state) {
      if (!state) return;
      this.detachPipelineView(state.view)
      if (state.view) this.view = state.view;
      if (state.selectedPipeline !== undefined) this.selectedPipeline = state.selectedPipeline;
      if (state.view === 'history') this.loadHistory();
    },
    // 离开流水线创作视图只脱离 renderer 跟踪，不取消主进程 run；重新进入时回到新建列表。
    detachPipelineView(nextView) {
      if (this.view !== 'pipelines' || nextView === 'pipelines') return
      this.resetPipelineUiState()
      this.selectedPipeline = null
      this.s2vOptionsToast = ''
    },
    switchView(nextView) {
      if (!['pipelines', 'quick', 'history'].includes(nextView)) return
      this.detachPipelineView(nextView)
      this.view = nextView
      if (nextView === 'history') this.loadHistory()
      this.pushViewState({ view: nextView })
    },
    pushViewState(state) {
      this.viewHistory = this.viewHistory.slice(0, this.viewHistoryIndex + 1);
      this.viewHistory.push(state);
      this.viewHistoryIndex = this.viewHistory.length - 1;
    },
    // 返回历史记录页
    goToHistory() { this.detachPipelineView('history'); this.selectedPipeline = null; this.view = 'history'; this.loadHistory(); this.pushViewState({ view: 'history' }); },
    translateWithLocaleFallback(key, zhFallback, enFallback, params) {
      const translated = typeof this.$t === 'function' ? this.$t(key, params) : key
      if (typeof translated === 'string' && translated !== key) return translated
      return this.$i18n?.locale === 'en' ? enFallback : zhFallback
    },
    pipelineName(id) { return getPipelineName((key) => this.$t?.(key), id) },
    pipelineDescription(id) { return getPipelineDescription((key) => this.$t?.(key), id) },
    pipelineCategory(id) { return getPipelineCategory((key) => this.$t?.(key), id) },
    pipelineMode(id) { return getPipelineMode((key) => this.$t?.(key), id) },
    pipelineStage(id) { return getPipelineStage((key) => this.$t?.(key), id) },
    pipelineStatus(id) { return getPipelineStatus((key) => this.$t?.(key), id) },
    // 分镜素材自选等待态（2026-08-13）：滚动到面板 + 短时注意力高亮
    scrollToSceneAssetPanel() {
      const el = this.$refs.sceneAssetPanel
      if (!el) return
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      this.sceneAssetAttention = true
      if (this.sceneAssetAttentionTimer) clearTimeout(this.sceneAssetAttentionTimer)
      this.sceneAssetAttentionTimer = setTimeout(() => { this.sceneAssetAttention = false }, 2000)
    },
    requestCancelPipeline() {
      // 等待态 UX（2026-08-13，审查 C1）：仅素材选择检查点等待时二次确认，其他取消路径保持一步直达
      if (!this.sceneAssetSelectionActive) {
        void this.cancelPipeline()
        return
      }
      this.cancelConfirmDialog.error = ''
      this.cancelConfirmDialog.visible = true
    },
    closeCancelConfirmDialog() {
      this.cancelConfirmDialog.error = ''
      this.cancelConfirmDialog.visible = false
    },
    async confirmCancelPipeline() {
      try {
        await this.cancelPipeline()
      } catch (_error) {
        // 审查 W3：取消失败时保留确认框并给出反馈，避免「对话框已关但流水线未取消」的静默失败
        this.cancelConfirmDialog.error = 'cancel_failed'
      }
    },
    humanName(name) { if (!name) return ''; return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
    s2vSectionLabel(section) {
      const key = `create.story2video.sections.${section}`
      const fallback = { basic: '基础', appearance: '画面', videoEnhance: '视频增强', voice: '声音', advanced: '高级', publish: '发布' }[section] || section
      const english = { basic: 'Basics', appearance: 'Appearance', videoEnhance: 'Video Boost', voice: 'Voice', advanced: 'Advanced', publish: 'Publish' }[section] || section
      return this.translateWithLocaleFallback(key, fallback, english)
    },
    s2vSubgroupLabel(subgroup) {
      const key = `create.story2video.subgroups.${subgroup}`
      const fallback = { splitTiming: '分句与时长', templateOutput: '模板与输出' }[subgroup] || subgroup
      const english = { splitTiming: 'Split & Timing', templateOutput: 'Template & Output' }[subgroup] || subgroup
      return this.translateWithLocaleFallback(key, fallback, english)
    },
    s2vSectionSummary(section) {
      const summaries = {
        basic: `${this.activeOutputConfig.resolution || '720x1280'} · 语速 ${Number(this.s2vConfig.voiceSpeed).toFixed(1)}x · 音量 ${Number(this.s2vConfig.voiceVolume).toFixed(2)}`,
        appearance: `${this.s2vConfig.imageStyle || '电影感'} · ${this.s2vConfig.imageEffect || '无效果'}`,
        videoEnhance: this.s2vConfig.videoMode === 'off' || !this.s2vConfig.videoMode
          ? '纯图片轮播'
          : (this.s2vConfig.videoMode === 'fixed'
            ? `固定 ${this.s2vConfig.videoFixedRatio}%` + (this.s2vConfig.shortVideoHandling === 'stop-at-end' ? ' · 播完停止' : '')
            : `AI 判断 ${this.s2vConfig.videoMinRatio}%-${this.s2vConfig.videoMaxRatio}%` + (this.s2vConfig.shortVideoHandling === 'stop-at-end' ? ' · 播完停止' : '')),
        voice: `${this.s2vConfig.voiceProvider || '自动 Edge TTS'}${this.s2vConfig.voiceModel ? ` · ${this.s2vConfig.voiceModel}` : ''}${this.s2vConfig.voiceId ? ' · 已选音色' : ''}`,
        advanced: `${this.s2vConfig.splitLanguage === 'auto' ? '自动识别' : this.s2vConfig.splitLanguage} · ${this.s2vConfig.splitMode || '均衡'}`,
        publish: this.s2vConfig.platforms?.length ? `已选 ${this.s2vConfig.platforms.length} 个平台` : '不发布',
      }
      return summaries[section] || ''
    },
    setS2VSectionOpen(section, event) {
      if (!Object.prototype.hasOwnProperty.call(this.s2vOpenSections, section)) return
      this.s2vOpenSections[section] = Boolean(event?.target?.open)
    },
    // 旁白试听（2026-08-31）：使用浏览器内置 SpeechSynthesis API 按当前语速/音量播放试听文本
    previewS2VVoice() {
      try {
        if (!window.speechSynthesis) {
          this.showS2VOptionsToast('当前环境不支持语音合成')
          return
        }
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance('欢迎使用视频创作流水线。这是一段旁白试听音频，用于预览当前语速和音量效果。')
        const speed = Number(this.s2vConfig.voiceSpeed) || 1
        const volume = Math.min(1, Math.max(0, Number(this.s2vConfig.voiceVolume) || 1))
        utterance.rate = speed
        utterance.volume = volume
        utterance.lang = "zh-CN"
        if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
        window.speechSynthesis.speak(utterance)
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[previewS2VVoice] SpeechSynthesis failed:", e)
        }
      }
    },
    categoryLabel(cat) { return CATEGORY_LABELS[cat] || cat },
    costLabel(cost) { return COST_LABELS[cost] || cost },
    getStability(name) { return STABILITY_MAP[name] || 'experimental' },
    formatTime(iso) { if (!iso) return ''; return new Date(iso).toLocaleString('zh-CN') },
    historyStatusLabel(status) {
      return { completed: '已完成', failed: '执行失败', cancelled: '已取消', running: '进行中', paused: '已暂停', pending: '等待中' }[status] || status || '未知'
    },

    // 流水线操作
    async loadPipelines() {
      this.pipelineLoading = true; this.pipelineError = null
      try {
        const res = await pipelineList()
        if (res?.code === 0) this.pipelines = withVideoCloneEntry(res.data)
        else this.pipelineError = formatUserError(res, { fallback: '加载失败' }).message
      } catch (e) { this.pipelineError = formatUserError(e, { fallback: '加载失败' }).message }
      finally { this.pipelineLoading = false }
    },
    selectPipeline(p) {
      // 视频克隆是独立流水线（拆解/再创作页），点击入口卡直接路由，不走通用配置详情
      if (p?.name === 'video-clone') {
        this.$router.push('/video-clone')
        return
      }
      if (p?.name === 'film-engineering') {
        this.pushViewState({ view: 'pipelines', selectedPipeline: p });
        this.$router.push('/film-engineering')
        return
      }
      // 带文案进入场景：非文案型流水线不消费 pipelineText，直接拦截（与选择列表灰显一致）。
      // video-clone / film-engineering 的独立页路由分支在前：它们是「跳转到专属页面」而非
      // 「进入通用配置详情」，灰显拦截不应吞掉路由跳转语义（且两者在带文案场景同样被灰显，正常路径不可达）。
      if (this.textPrefilledFromDraft && p && !isTextBasedPipeline(p.name)) return
      this.stopPipelinePolling()
      this.closePipelineProgressModal()
      this.orchestrationStartRequestId += 1
      this.selectedPipeline = p
      this.startingPipeline = false
      this.pipelineRunStatus = null
      this.pipelineRunId = null
      this.orchestrationStages = (this.isAutoPipeline(p?.name) || this.isMediaAutoPipeline(p?.name)) ? this.getDefaultPipelineStages(p.name) : []
      this.orchestrationRunId = null
      this.orchestrationContext = null
      this.orchestrationContextRunId = null
      this.orchestrationResultPath = null
      this.orchestrationError = ''
      // 切换流水线时一并重置模型服务异常提示（跨流水线/跨运行不残留）
      this.providerWarnings = []
      this.dismissedProviderWarnings = false
      this.closeStory2VideoErrorDialog()
      if (this.isOrchestratedPipeline(p?.name) && this.inputMode !== 'text') this.inputMode = 'text'
      // 选中编排流水线时执行 6000 码点上限（含带文案预填场景：预填时不截断，选中时统一截断+提示）
      if (this.isOrchestratedPipeline(p?.name)) this.enforceStory2VideoTextLimit()
      // Bug 反哺（2026-08-09）：mounted 时 selectedPipeline 为 null，restore 守卫直接 return，
      // 导致「上次使用的选项」保存成功但从未恢复。选中编排流水线时主动触发恢复；
      // 生命周期内只恢复一次（由 restoreS2VLastOptions 内部设置 _s2vRestoredOnce），
      // 避免同会话切走再切回覆盖当前编辑。
      if (this.isOrchestratedPipeline(p?.name) && !this._s2vRestoredOnce) {
        this.restoreS2VLastOptions()
      }
    },
    // 改写页跳转预填充：读取草稿内容填入文案输入框，并按 query.pipeline 自动选择流水线
    async _loadDraftForRewrite (draftId) {
      try {
        const res = await draftList()
        const list = res && res.code === 0 && Array.isArray(res.data) ? res.data : []
        const draft = list.find(item => item && item.id === draftId)
        if (!draft) {
          // 草稿不存在/已删除：用户已跳转过来，必须给出可见提示而不是静默失败
          this.showS2VOptionsToast(this.translateWithLocaleFallback(
            'story2video.draftLoadFailed',
            '未找到要带入的草稿，请返回上一页重新发起',
            'Draft not found. Please go back and try again'
          ), 3200)
          return
        }
        const draftContent = typeof draft.content === 'string' ? draft.content : ''
        // 空 content 草稿（合集/外部链接等其他入口写入）不视为「带文案进入」，
        // 避免误置灰显标志导致非文案型流水线被无意义禁用
        if (!draftContent) return
        this.pipelineText = draftContent
        // 改写页跳转预填充：草稿标题（改写结果标题 ≤20 字）带入「发布标题」字段（2026-09-18）
        if (typeof draft.title === 'string' && draft.title.trim()) {
          this.s2vConfig.title = [...draft.title.trim()].slice(0, 20).join('')
        }
        // 注意：此处不做 6000 码点截断——该上限仅作用于编排流水线（story2video-compose），
        // 其余文案型流水线（talking-head 等）无此限制。截断推迟到 selectPipeline 选中
        // 编排流水线时由 enforceStory2VideoTextLimit() 执行（见 selectPipeline）。
        this.inputMode = 'text'
        // 带文案进入：非文案型流水线（素材/链接/录屏等）在选择列表中灰显不可选
        this.textPrefilledFromDraft = true
        const pipelineName = this.$route?.query?.pipeline
        if (pipelineName) {
          if (!this.pipelines.length) await this.loadPipelines()
          // query 指定的流水线若不适配带入文案（如历史链接指向素材型流水线），忽略并不选中
          const pipeline = isTextBasedPipeline(pipelineName)
            ? this.pipelines.find(p => p.name === pipelineName)
            : null
          if (pipeline) this.selectPipeline(pipeline)
        }
      } catch (_e) {
        // draftList IPC 调用失败（网络/进程通信异常）：与「草稿不存在」不同语义，需可见提示
        this.showS2VOptionsToast(this.translateWithLocaleFallback(
          'story2video.draftLoadFailed',
          '未找到要带入的草稿，请返回上一页重新发起',
          'Draft not found. Please go back and try again'
        ), 3200)
      }
    },
    isOrchestratedPipeline(name) { return name === 'story2video-compose' },
    isAutoPipeline(name) { return ['story2video-compose', 'animated-explainer', 'framework-smoke', 'documentary-montage', 'animation', 'avatar-spokesperson', 'character-animation', 'hybrid'].includes(name) },
    isMediaAutoPipeline(name) { return ['clip-factory', 'cinematic', 'talking-head', 'localization-dub'].includes(name) },
    pipelineAvailable(name) {
      const selected = this.selectedPipeline
      if (selected && selected.name === name && typeof selected.available === 'boolean') return selected.available
      const pipeline = (this.pipelines || []).find(item => item.name === name)
      if (pipeline && typeof pipeline.available === 'boolean') return pipeline.available
      return IMPLEMENTED_PIPELINES.includes(name)
    },
    availabilityLabel(available) {
      return this.translateWithLocaleFallback(
        available ? 'pipelines.availability.ready' : 'pipelines.availability.dev',
        available ? '可用' : '开发中',
        available ? 'Available' : 'In Development'
      )
    },
    availabilityHint(available) {
      return this.translateWithLocaleFallback(
        available ? 'pipelines.availability.readyHint' : 'pipelines.availability.notImplementedHint',
        available ? '该流水线可生成视频' : '该流水线尚未实现执行引擎，暂不能生成视频',
        available ? 'This pipeline can generate videos' : 'This pipeline has no execution engine yet.'
      )
    },
    getDefaultPipelineStages(name) {
      const pipeline = (this.pipelines || []).find(item => item.name === name)
      const stages = pipeline?.stages || AUTO_PIPELINE_STAGES[name] || STORY2VIDEO_STAGE_NAMES
      return stages.map(stageName => ({ name: stageName, status: 'pending' }))
    },
    getDefaultStory2VideoStages() {
      // 分镜素材自选（manual）：generate_assets 与 compose 之间插入 finalize_assets 阶段
      const names = this.s2vConfig?.creationMode === 'manual'
        ? STORY2VIDEO_STAGE_NAMES.flatMap(name => name === 'compose' ? ['finalize_assets', 'compose'] : [name])
        : STORY2VIDEO_STAGE_NAMES
      return names.map(name => ({ name, status: 'pending' }))
    },
    async ensureLoginForStart (message) {
      // 主动操作登录门（UI 层）：未登录弹登录窗口，登录成功后继续启动流水线。
      // 放在 UI 点击层而非 startPipeline 方法内，避免改变 startPipeline 的同步时序语义。
      const { ensureLogin } = useLoginGate()
      return ensureLogin({ message: message || '启动流水线需要登录后使用，是否立即登录？' })
    },
    // UI「启动流水线」入口：登录门 + 启动
    async handleStartPipeline () {
      // 双击防护（2026-08-21 回归修复）：启动请求在途时直接拦截，canStartPipeline 同步禁用按钮兜底
      // 与 startPipeline 内部 startingPipeline 守卫构成双重防线：登录门在途也拦截连点，
      // 防止绕过登录门直接调用 startPipeline 的入口跳过 busy 检查。
      if (this.startingPipeline) return false
      if (!(await this.ensureLoginForStart())) return false
      await this.startPipeline()
      return true
    },
    async startPipeline() {
      // 防重复启动（2026-08-21 回归修复）：请求在途用 busy 标志拦截；编排 run 已挂到当前视图
      // （运行/暂停/检查点）时同样拒绝，兜底 canStartPipeline 的按钮禁用与连点竞态。
      if (this.startingPipeline) return
      if (this.isOrchestratedPipeline(this.selectedPipeline?.name) && this.orchestrationRunId) return
      const startRequestId = ++this.orchestrationStartRequestId
      const pipelineName = this.selectedPipeline?.name
      this.startingPipeline = true
      try {
        // 新运行重置 BGM 跳过提示（下次 compose 完成时重新评估）
        this.dismissedBgmSkippedNotice = false
        // 新运行重置模型服务异常提示：清空旧警告并取消关闭状态（跨运行不残留）
        this.providerWarnings = []
        this.dismissedProviderWarnings = false
        if (!this.pipelineAvailable(this.selectedPipeline?.name)) {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PIPELINE_NOT_IMPLEMENTED })
          return
        }
        if (this.isAutoPipeline(this.selectedPipeline.name) || this.isMediaAutoPipeline(this.selectedPipeline.name)) {
          await this.startOrchestratedPipeline(startRequestId)
          return
        }
        const params = {
          text: this.pipelineText, style: this.selectedStyle,
          llm: this.llmConfig, budget: this.budgetConfig,
          checkpoint: this.checkpointPolicy, output: this.outputConfig,
          inputMode: this.inputMode,
          images: this.pipelineImages.map(i => i.preview),
          audio: this.pipelineAudio.map(a => ({ name: a.name, path: a.path })),
          video: this.pipelineVideo?.path || null,
        }
        const res = await pipelineStart(pipelineName, params)
        if (res?.code !== 0) {
          if (this.isCurrentOrchestrationStart(startRequestId) && this.selectedPipeline?.name === pipelineName) {
            this.showStory2VideoErrorDialog({ errorCode: res?.errorCode, error: res?.message })
          }
          return
        }
        if (!this.isCurrentOrchestrationStart(startRequestId) || this.selectedPipeline?.name !== pipelineName) return
        const startedRunId = typeof res?.data?.runId === 'string'
          ? res.data.runId.trim()
          : (typeof res?.data?.id === 'string' ? res.data.id.trim() : '')
        if (!startedRunId) {
          // 普通流水线的旧 IPC 响应没有稳定 run identity 时，禁止按名称查询状态。
          // 名称查询可能命中另一个任务；主进程已启动的任务仍继续执行，交给历史记录观察。
          await this.resetPipelineToNewTaskState({
            toastKey: 'create.story2video.backgroundStartedWithoutTracking',
            fallbackZh: '任务已启动并在后台运行，但当前无法实时跟踪进度，请在历史记录中查看。',
            fallbackEn: 'The task started and is running in the background, but live progress is unavailable. View it in History.',
            durationMs: 5000,
          })
          return
        }
        this.pipelineRunId = startedRunId
        {
          await this.updatePipelineStatus()
          // 首次状态拉取失败也要建立轮询：下一次 tick 继续重试，避免任务静默失联。
          if (
            this.isCurrentOrchestrationStart(startRequestId)
            && this.selectedPipeline?.name === pipelineName
            && this.pipelineRunId === startedRunId
            && !PIPELINE_TERMINAL_STATUSES.includes(this.pipelineRunStatus?.status)
            && !this.pollTimer
          ) {
            this.pollTimer = setInterval(() => { void this.updatePipelineStatus() }, 3000)
          }
        }
      } catch (error) {
        if (
          this.isCurrentOrchestrationStart(startRequestId)
          && this.selectedPipeline?.name === pipelineName
          && !this.isOrchestratedPipeline(pipelineName)
        ) {
          this.pipelineRunStatus = null
          this.pipelineRunId = null
          this.closePipelineProgressModal()
          this.showStory2VideoErrorDialog({ errorCode: error?.code || error?.errorCode, error: error?.message })
        }
      } finally {
        if (this.orchestrationStartRequestId === startRequestId) this.startingPipeline = false
      }
    },
    async startExplainerPipeline(startRequestId = this.orchestrationStartRequestId) {
      try {
        const text = this.pipelineText.trim()
        if (!text) {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_REQUIRED })
          return
        }
        const output = this.cloneForIpc(this.activeOutputConfig)
        const params = {
          text,
          inputMode: 'text',
          checkpointPolicy: 'none',
          autoAdvance: true,
          background: true,
          storyboardMode: this.storyboardMode,
          style: this.selectedStyle,
          resolution: output.resolution,
          fps: output.fps,
          format: output.format,
        }
        const res = await pipelineStartOrchestrated(this.selectedPipeline.name, this.cloneForIpc(params))
        const outcome = res?.data
        if (!this.isCurrentOrchestrationStart(startRequestId)) return
        if (res?.code === 0 && typeof outcome?.runId === 'string' && outcome.runId.trim() && outcome.success !== false) {
          this.orchestrationRunId = outcome.runId.trim()
          this.orchestrationContext = null
          this.orchestrationContextRunId = null
          await this.saveS2VLastOptions()
          if (!this.isCurrentOrchestrationStart(startRequestId)) return
          if (this.applyOrchestrationOutcome(outcome)) return
          if (outcome.paused === true) {
            await this.showOrchestrationCheckpoint(outcome.runId, this.selectedPipeline.name, outcome)
          } else {
            await this.startOrchestrationForeground(outcome.runId, this.selectedPipeline.name, outcome)
          }
        } else { this.setOrchestrationError({ code: res?.code, errorCode: res?.errorCode || outcome?.errorCode, errorParams: res?.errorParams || outcome?.errorParams, error: res?.message || outcome?.error }) }
      } catch (_) {
        if (!this.isCurrentOrchestrationStart(startRequestId)) return
        this.setOrchestrationError({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ORCHESTRATION_FAILED, messageParams: { reason: '' } })
      }
    },
    async startMediaPipeline(startRequestId = this.orchestrationStartRequestId) {
      try {
        const videoPath = this.pipelineVideo?.path
        if (!videoPath) {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_REQUIRED })
          return
        }
        const params = {
          video: videoPath,
          text: this.pipelineText.trim(),
          inputMode: 'video',
          checkpointPolicy: 'none',
          autoAdvance: true,
          background: true,
        }
        const res = await pipelineStartOrchestrated(this.selectedPipeline.name, this.cloneForIpc(params))
        const outcome = res?.data
        if (!this.isCurrentOrchestrationStart(startRequestId)) return
        if (res?.code === 0 && typeof outcome?.runId === 'string' && outcome.runId.trim() && outcome.success !== false) {
          this.orchestrationRunId = outcome.runId.trim()
          this.orchestrationContext = null
          this.orchestrationContextRunId = null
          await this.saveS2VLastOptions()
          if (!this.isCurrentOrchestrationStart(startRequestId)) return
          if (this.applyOrchestrationOutcome(outcome)) return
          if (outcome.paused === true) {
            await this.showOrchestrationCheckpoint(outcome.runId, this.selectedPipeline.name, outcome)
          } else {
            await this.startOrchestrationForeground(outcome.runId, this.selectedPipeline.name, outcome)
          }
        } else { this.setOrchestrationError({ code: res?.code, errorCode: res?.errorCode || outcome?.errorCode, errorParams: res?.errorParams || outcome?.errorParams, error: res?.message || outcome?.error }) }
      } catch (_) {
        if (!this.isCurrentOrchestrationStart(startRequestId)) return
        this.setOrchestrationError({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ORCHESTRATION_FAILED, messageParams: { reason: '' } })
      }
    },
    // ---- 选项设置持久化：图片轮播上次使用的选项（owner-scoped SQLite）----
    buildS2VLastOptions() {
      return {
        version: 1,
        s2vConfig: this.cloneForIpc(this.s2vConfig),
        s2vOutputConfig: this.cloneForIpc(this.s2vOutputConfig),
        ui: { expandedGroups: Object.keys(this.s2vOpenSections).filter(key => this.s2vOpenSections[key] === true) },
        savedAt: new Date().toISOString(),
      }
    },
    showS2VOptionsToast(text, durationMs = 1600) {
      this.s2vOptionsToast = text
      if (this.s2vOptionsToastTimer) clearTimeout(this.s2vOptionsToastTimer)
      this.s2vOptionsToastTimer = setTimeout(() => { this.s2vOptionsToast = '' }, durationMs)
    },
    async saveS2VLastOptions() {
      if (!this.isOrchestratedPipeline(this.selectedPipeline?.name) || this.s2vRestoring || this.s2vConfigProfileApplying) return
      try {
        await storeSetSetting('story2video.lastOptions.v1', this.buildS2VLastOptions())
        this.showS2VOptionsToast(this.translateWithLocaleFallback('story2video.optionsSaved', '选项已保存 ✓', 'Options saved ✓'))
      } catch (_) { /* 持久化失败不影响使用 */ }
    },
    scheduleS2VLastOptionsSave() {
      if (this.s2vConfigProfileApplying) return
      if (this._lastOptionsSaveTimer) clearTimeout(this._lastOptionsSaveTimer)
      this._lastOptionsSaveTimer = setTimeout(() => { this._lastOptionsSaveTimer = null; this.saveS2VLastOptions() }, 1000)
    },
    flushS2VLastOptionsSave() {
      if (this._lastOptionsSaveTimer) { clearTimeout(this._lastOptionsSaveTimer); this._lastOptionsSaveTimer = null }
      if (!this.s2vConfigProfileApplying) this.saveS2VLastOptions()
    },
    _applyS2VSnapshot(source, target) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return
      for (const key of Object.keys(target)) {
        const value = source[key]
        if (value === undefined || value === null) continue
        const defaultType = typeof target[key]
        if (Array.isArray(target[key])) {
          if (Array.isArray(value)) target[key] = JSON.parse(JSON.stringify(value))
          continue
        }
        if (defaultType === 'object') {
          if (value && typeof value === 'object' && !Array.isArray(value)) target[key] = JSON.parse(JSON.stringify(value))
          continue
        }
        if (typeof value === defaultType) target[key] = value
      }
    },
    // ─── 流水线「保存配置」：快照与应用（2026-08-28 s2v-pipeline-config-profiles）───
    s2vConfigProfileDefaults() {
      const defaults = (this.$options.data || (() => ({}))).call(this)
      return {
        s2vConfig: defaults.s2vConfig || {},
        s2vOutputConfig: defaults.s2vOutputConfig || {},
        legacy: {
          inputMode: 'text',
          selectedStyle: defaults.selectedStyle,
          llmConfig: defaults.llmConfig || {},
          budgetConfig: defaults.budgetConfig || {},
          checkpointPolicy: defaults.checkpointPolicy,
          storyboardMode: defaults.storyboardMode,
          outputConfig: defaults.outputConfig || {},
        },
      }
    },
    buildPipelineConfigSnapshot() {
      const now = new Date().toISOString()
      if (this.isOrchestratedPipeline(this.selectedPipeline?.name)) {
        return {
          schemaVersion: 1,
          capturedAt: now,
          kind: 'orchestrated',
          s2vConfig: pickS2VConfigProfileFields(this.s2vConfig),
          s2vOutputConfig: pickS2VOutputProfileFields(this.s2vOutputConfig),
          ui: { expandedGroups: Object.keys(this.s2vOpenSections).filter(key => this.s2vOpenSections[key] === true) },
        }
      }
      return {
        schemaVersion: 1,
        capturedAt: now,
        kind: 'legacy',
        legacy: {
          inputMode: this.inputMode,
          selectedStyle: this.selectedStyle,
          llmConfig: this.cloneForIpc(this.llmConfig),
          budgetConfig: this.cloneForIpc(this.budgetConfig),
          checkpointPolicy: this.checkpointPolicy,
          storyboardMode: this.storyboardMode,
          outputConfig: this.cloneForIpc(this.outputConfig),
        },
      }
    },
    s2vConfigProfileFormDirty() {
      const defaults = this.s2vConfigProfileDefaults()
      if (this.isOrchestratedPipeline(this.selectedPipeline?.name)) {
        return JSON.stringify(this.s2vConfig) !== JSON.stringify(defaults.s2vConfig) ||
          JSON.stringify(this.s2vOutputConfig) !== JSON.stringify(defaults.s2vOutputConfig)
      }
      const legacy = defaults.legacy
      return this.inputMode !== legacy.inputMode ||
        this.selectedStyle !== legacy.selectedStyle ||
        JSON.stringify(this.llmConfig) !== JSON.stringify(legacy.llmConfig) ||
        JSON.stringify(this.budgetConfig) !== JSON.stringify(legacy.budgetConfig) ||
        this.checkpointPolicy !== legacy.checkpointPolicy ||
        this.storyboardMode !== legacy.storyboardMode ||
        JSON.stringify(this.outputConfig) !== JSON.stringify(legacy.outputConfig)
    },
    async loadS2VConfigProfiles({ quiet = false } = {}) {
      const requestId = (this.s2vConfigProfileListRequestId || 0) + 1
      this.s2vConfigProfileListRequestId = requestId
      this.s2vConfigProfilesLoading = true
      this.s2vConfigProfileError = ''
      try {
        const result = await story2videoConfigProfileList()
        if (requestId !== this.s2vConfigProfileListRequestId) return
        const data = result && result.code === 0 ? result.data : null
        if (!Array.isArray(data)) throw new Error(result?.message || '配置列表加载失败')
        this.s2vConfigProfiles = Array.isArray(data)
          ? data.slice().sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
          : data
      } catch (error) {
        if (requestId !== this.s2vConfigProfileListRequestId) return
        this.s2vConfigProfileError = error?.message || '配置列表加载失败'
        if (!quiet) this.showS2VOptionsToast(this.s2vConfigProfileError, 2200)
      } finally {
        if (requestId === this.s2vConfigProfileListRequestId) this.s2vConfigProfilesLoading = false
      }
    },
    async openS2VConfigProfileSave() {
      this.s2vConfigProfileOverwriteNeeded = false
      this.s2vConfigProfileError = ''
      await this.loadS2VConfigProfiles({ quiet: true })
      this.s2vConfigProfileNameDraft = this.selectedPipeline?.name ? this.pipelineName(this.selectedPipeline.name) : ''
      this.s2vConfigProfileDialogOpen = true
    },
    closeS2VConfigProfileSave() {
      this.s2vConfigProfileDialogOpen = false
      this.s2vConfigProfileListRequestId = (this.s2vConfigProfileListRequestId || 0) + 1
      this.s2vConfigProfilesLoading = false
      this.s2vConfigProfileNameDraft = ''
      this.s2vConfigProfileOverwriteNeeded = false
    },
    async saveS2VConfigProfile() {
      const name = String(this.s2vConfigProfileNameDraft || '').trim()
      if (!name) {
        this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.nameRequired', '请输入配置名称', 'Enter a configuration name'), 2200)
        return
      }
      const pipelineId = this.selectedPipeline?.name
      if (!pipelineId) return
      if (!this.s2vConfigProfileOverwriteNeeded) {
        const duplicate = this.s2vConfigProfiles.find(p => p.pipelineId === pipelineId && p.name === name)
        if (duplicate) {
          this.s2vConfigProfileOverwriteNeeded = true
          this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.duplicateName', '已存在同名配置，再次点击保存将覆盖它', 'A configuration with this name already exists. Click save again to overwrite it.'), 2200)
          return
        }
      }
      const snapshot = this.buildPipelineConfigSnapshot()
      try {
        const result = await story2videoConfigProfileCreate({
          pipelineId,
          name,
          snapshot: JSON.parse(JSON.stringify(snapshot)),
          overwrite: this.s2vConfigProfileOverwriteNeeded,
        })
        if (!result || result.code !== 0) {
          const duplicate = result?.code === -2 && /同名|已经存在|already exists|duplicate/i.test(String(result?.message || ''))
          if (duplicate) {
            this.s2vConfigProfileOverwriteNeeded = true
            this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.duplicateName', '已存在同名配置，再次点击保存将覆盖它', 'A configuration with this name already exists. Click save again to overwrite it.'), 2200)
            return
          }
          this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.saveFailed', '配置保存失败，请稍后重试', 'Could not save the configuration. Please try again.'), 2600)
          return
        }
        this.s2vConfigProfiles = this.s2vConfigProfiles.filter(p => !(p.pipelineId === pipelineId && p.name === name))
        this.s2vConfigProfiles.push(result.data)
        this.closeS2VConfigProfileSave()
        this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.saved', '配置已保存', 'Configuration saved'))
      } catch (error) {
        this.showS2VOptionsToast(error?.message || '配置保存失败', 2600)
      }
    },
    async openS2VConfigProfileList() {
      this.s2vConfigProfileError = ''
      this.s2vConfigProfileListOpen = true
      await this.loadS2VConfigProfiles({ quiet: true })
    },
    closeS2VConfigProfileList() {
      this.s2vConfigProfileListOpen = false
      this.s2vConfigProfileListRequestId = (this.s2vConfigProfileListRequestId || 0) + 1
      this.s2vConfigProfilesLoading = false
      this.s2vConfigProfileRenamingId = ''
    },
    s2vConfigProfileCanApply(profile) {
      return Boolean(profile && this.selectedPipeline?.name && profile.pipelineId === this.selectedPipeline.name)
    },
    async requestApplyS2VConfigProfile(profile) {
      if (!this.s2vConfigProfileCanApply(profile)) {
        this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.wrongPipeline', '该配置属于其他流水线，无法在当前流水线应用', 'This configuration belongs to another pipeline and cannot be applied here.'), 2600)
        return
      }
      if (!this.s2vConfigProfileFormDirty()) {
        await this.confirmApplyS2VConfigProfile(profile)
        return
      }
      this.s2vConfigProfileApplyTarget = this.cloneForIpc(profile)
      this.s2vConfigProfileApplyPipelineId = this.selectedPipeline?.name || ''
      this.s2vConfigProfileApplyDialogOpen = true
    },
    cancelApplyS2VConfigProfile() {
      this.s2vConfigProfileApplyDialogOpen = false
      this.s2vConfigProfileApplyTarget = null
      this.s2vConfigProfileApplyPipelineId = ''
    },
    async confirmApplyS2VConfigProfile(profile) {
      const target = profile || this.s2vConfigProfileApplyTarget
      this.s2vConfigProfileApplyDialogOpen = false
      this.s2vConfigProfileApplyTarget = null
      const openedPipelineId = this.s2vConfigProfileApplyPipelineId
      this.s2vConfigProfileApplyPipelineId = ''
      if (!target) return
      const currentPipelineId = this.selectedPipeline?.name || ''
      if (target.pipelineId !== currentPipelineId || (openedPipelineId && openedPipelineId !== currentPipelineId)) {
        this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.wrongPipeline', '该配置属于其他流水线，无法在当前流水线应用', 'This configuration belongs to another pipeline and cannot be applied here.'), 2600)
        return
      }
      const applied = await this.applyS2VConfigProfileSnapshot(target)
      if (applied) {
        this.s2vActiveConfigProfile = target.name || ''
        this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.applied', '已应用配置', 'Configuration applied'))
      }
    },
    async applyS2VConfigProfileSnapshot(profile) {
      const snapshot = profile && profile.snapshot
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
      if (snapshot.kind === 'legacy') {
        const s = snapshot.legacy || {}
        if (typeof s.inputMode === 'string' && ['text', 'images', 'audio', 'video'].includes(s.inputMode)) this.inputMode = s.inputMode
        if (['guided', 'manual_all', 'auto_noncreative'].includes(s.checkpointPolicy)) this.checkpointPolicy = s.checkpointPolicy
        if (['auto', 'creative', 'fidelity', 'hybrid'].includes(s.storyboardMode)) this.storyboardMode = s.storyboardMode
        // 整对象快照语义：直接替换目标（_applyS2VSnapshot 只适合原地合并，不适配整对象恢复）
        if (typeof s.selectedStyle === 'string' && STYLES.some(style => style.value === s.selectedStyle)) this.selectedStyle = s.selectedStyle
        if (s.llmConfig && typeof s.llmConfig === 'object' && !Array.isArray(s.llmConfig)) this.llmConfig = JSON.parse(JSON.stringify(s.llmConfig))
        if (s.budgetConfig && typeof s.budgetConfig === 'object' && !Array.isArray(s.budgetConfig)) this.budgetConfig = JSON.parse(JSON.stringify(s.budgetConfig))
        if (s.outputConfig && typeof s.outputConfig === 'object' && !Array.isArray(s.outputConfig)) this.outputConfig = JSON.parse(JSON.stringify(s.outputConfig))
        const budgetModes = ['observe', 'warn', 'cap']
        if (!budgetModes.includes(this.budgetConfig.mode)) this.budgetConfig.mode = 'warn'
        const fps = Number(this.outputConfig.fps)
        this.outputConfig.fps = [24, 30, 60].includes(fps) ? fps : 30
        if (!['mp4', 'webm'].includes(this.outputConfig.format)) this.outputConfig.format = 'mp4'
        this.outputConfig.resolution = normalizeResolution(this.outputConfig.resolution, this.maxOutputResolution)
        return true
      }
      return this._applyS2VSnapshotObject(snapshot)
    },
    startS2VConfigProfileRename(profile) {
      this.s2vConfigProfileRenamingId = profile.id
      this.s2vConfigProfileRenameDraft = profile.name
    },
    cancelS2VConfigProfileRename() {
      this.s2vConfigProfileRenamingId = ''
    },
    async saveS2VConfigProfileRename() {
      const id = this.s2vConfigProfileRenamingId
      const name = String(this.s2vConfigProfileRenameDraft || '').trim()
      if (!id || !name) return
      try {
        const result = await story2videoConfigProfileRename(id, name)
        if (!result || result.code !== 0) { this.showS2VOptionsToast((result && result.message) || '重命名失败', 2600); return }
        const index = this.s2vConfigProfiles.findIndex(p => p.id === id)
        if (index >= 0) this.s2vConfigProfiles.splice(index, 1, result.data)
        this.s2vConfigProfileRenamingId = ''
        this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.renamed', '配置已重命名', 'Configuration renamed'))
      } catch (error) { this.showS2VOptionsToast(error?.message || '重命名失败', 2600) }
    },
    requestS2VConfigProfileDelete(profile) {
      this.s2vConfigProfileDeleteTarget = profile
      this.s2vConfigProfileDeleteDialogOpen = true
    },
    closeS2VConfigProfileDelete() {
      this.s2vConfigProfileDeleteDialogOpen = false
      this.s2vConfigProfileDeleteTarget = null
    },
    async confirmS2VConfigProfileDelete() {
      const target = this.s2vConfigProfileDeleteTarget
      this.s2vConfigProfileDeleteDialogOpen = false
      this.s2vConfigProfileDeleteTarget = null
      if (!target) return
      try {
        const result = await story2videoConfigProfileDelete(target.id)
        if (!result || result.code !== 0) { this.showS2VOptionsToast((result && result.message) || '删除失败', 2600); return }
        this.s2vConfigProfiles = this.s2vConfigProfiles.filter(p => p.id !== target.id)
        this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.configProfile.deleted', '配置已删除', 'Configuration deleted'))
      } catch (error) { this.showS2VOptionsToast(error?.message || '删除失败', 2600) }
    },
    formatS2VConfigProfileTime(ts) {
      if (!Number.isFinite(Number(ts))) return ''
      try {
        return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(Number(ts)))
      } catch (_) { return '' }
    },
    async _applyS2VSnapshotObject(snapshot, { applyUi = true } = {}) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
      this.s2vRestoring = true
      this.s2vConfigProfileApplying = true
      if (this._lastOptionsSaveTimer) { clearTimeout(this._lastOptionsSaveTimer); this._lastOptionsSaveTimer = null }
      try {
        const voiceProviders = new Set((this.s2vVoiceProviders || []).map(p => p.id))
        const imageProviders = new Set((this.s2vImageProviders || []).map(p => p.id))
        const videoProviders = new Set((this.s2vVideoProviders || []).map(p => p.id))
        const config = { ...(snapshot.s2vConfig || {}) }
        // 快照显式保存过「自动 Edge TTS」（voiceProvider=''）时标记，loadS2VProviders 重入不再切走
        this.s2vVoiceProviderExplicitEdge = config.voiceProvider === ''
        // 已不启用的 provider 不回填，避免恢复到无效模型
        if (config.voiceProvider && !voiceProviders.has(config.voiceProvider)) {
          delete config.voiceProvider; delete config.voiceModel; delete config.voiceId
        }
        this._applyS2VSnapshot(config, this.s2vConfig)
        // 2026-08-10 Bug 反哺：陈旧快照枚举值（如 imageStyle=anime-mslpadvn）不在当前选项
        // 列表时先归一化，避免下拉框空白选中项，也避免分镜自愈使用陈旧语言值估算。
        this.normalizeS2VRestoredEnums()
        // 旧快照缺新字段/带回陈旧 splitTargetSeconds → 按主控字数自愈（claude review M2/M6），
        // 避免「恢复→保存」循环污染与显示/提交口径不一致
        if (Number.isFinite(Number(this.s2vConfig.splitTargetCharsPerScene))) {
          this.applyS2VTargetChars(this.s2vConfig.splitTargetCharsPerScene)
        }
        if (this.s2vConfig.imageProvider && !imageProviders.has(this.s2vConfig.imageProvider)) {
          this.s2vConfig.imageProvider = this.s2vImageProviders[0]?.id || ''
          this.s2vConfig.imageModel = ''
        }
        // 视频增强开启时同样校验 videoProvider（双模型审查补充：restore 未覆盖的新恢复路径）
        if (this.s2vConfig.videoMode !== 'off' && this.s2vConfig.videoProvider && !videoProviders.has(this.s2vConfig.videoProvider)) {
          this.s2vConfig.videoProvider = ''
          this.s2vConfig.videoModel = ''
        }
        if (this.s2vConfig.videoMode === 'off') {
          this.s2vConfig.videoProvider = ''
          this.s2vConfig.videoModel = ''
        }
        this._applyS2VSnapshot(snapshot.s2vOutputConfig, this.s2vOutputConfig)
        // 运营开关：恢复的旧快照若含超出上限的分辨率（如历史 4K），归一化到最高允许档
        this.s2vOutputConfig.resolution = normalizeResolution(this.s2vOutputConfig.resolution, this.maxOutputResolution)
        // 输出枚举（fps/format）同样做白名单归一化
        this.normalizeS2VRestoredEnums()
        // 恢复表单折叠状态（类型守卫：仅接受字符串数组）
        if (applyUi && Array.isArray(snapshot.ui?.expandedGroups)) {
          const known = new Set(Object.keys(this.s2vOpenSections))
          for (const section of snapshot.ui.expandedGroups) {
            if (typeof section === 'string' && known.has(section)) this.s2vOpenSections[section] = true
          }
        }
        await this.loadS2VVoiceData()
        await this.$nextTick()
        return true
      } finally {
        this.s2vRestoring = false
        await this.$nextTick()
        this.s2vConfigProfileApplying = false
      }
    },
    async restoreS2VLastOptions() {
      if (!this.isOrchestratedPipeline(this.selectedPipeline?.name)) return
      // 生命周期内只恢复一次（selectPipeline/mounted 双触发点共用），避免重复恢复覆盖当前编辑
      if (this._s2vRestoredOnce) return
      this._s2vRestoredOnce = true
      let raw
      try { raw = await storeGetSetting('story2video.lastOptions.v1') } catch { return }
      const snapshot = raw && typeof raw === 'object' ? (raw.data ?? raw) : raw
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return
      const applied = await this._applyS2VSnapshotObject(snapshot)
      if (applied) {
        this.showS2VOptionsToast(this.translateWithLocaleFallback('story2video.optionsRestored', '已恢复上次的选项设置', 'Restored your last-used options'))
      }
    },
    // 2026-08-10 Bug 反哺：恢复「上次使用的选项」时，把不在当前选项列表中的陈旧枚举值
    // 归一化到 data() 默认值（幂等，可在恢复流程中多次调用）。
    normalizeS2VRestoredEnums() {
      const defaults = (this.$options.data || (() => ({}))).call(this)
      const defaultConfig = defaults.s2vConfig || {}
      for (const [field, options] of Object.entries(S2V_RESTORE_ENUM_OPTIONS)) {
        const value = this.s2vConfig[field]
        if (typeof value === 'string' && !options.includes(value)) {
          // 默认值本身也须在白名单内，避免 data() 默认变更后回退到非法值（claude review W2）
          this.s2vConfig[field] = options.includes(defaultConfig[field]) ? defaultConfig[field] : options[0]
        }
      }
      // 图片提示词最大长度（2026-08-16）：陈旧快照缺字段/越界时回落默认 2000；
      // 区间内非档位值吸附到最近档位（下拉 8 档，避免 select 无匹配项），引擎契约 [50,2000] 恒接受
      const maxPromptLength = Number(this.s2vConfig.maxPromptLength)
      if (Number.isFinite(maxPromptLength) && maxPromptLength >= 200 && maxPromptLength <= 2000) {
        this.s2vConfig.maxPromptLength = this.s2vMaxPromptLengthOptions.reduce(
          (a, b) => (Math.abs(b - maxPromptLength) < Math.abs(a - maxPromptLength) ? b : a)
        )
      } else {
        this.s2vConfig.maxPromptLength = 2000
      }
      const defaultOutput = defaults.s2vOutputConfig || {}
      for (const [field, options] of Object.entries(S2V_RESTORE_OUTPUT_ENUM_OPTIONS)) {
        const value = this.s2vOutputConfig[field]
        const valid = options.includes(value) || (typeof value === 'string' && options.includes(Number(value)))
        if (!valid) {
          this.s2vOutputConfig[field] = options.includes(defaultOutput[field]) ? defaultOutput[field] : options[0]
        }
      }
      this.normalizeS2VWatermarkOptions()
    },
    // 2026-08-14：水印选项恢复吸附（watermark-options）。陈旧快照的水印位置/字号/透明度
    // 若不在当前下拉档位，吸附到合法档位，避免下拉框空白选中项；非法数值回退默认值。
    normalizeS2VWatermarkOptions() {
      const wm = this.s2vConfig.watermarkConfig
      if (!wm || typeof wm !== 'object') return
      const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'moving']
      if (!validPositions.includes(wm.position)) wm.position = 'bottom-right'
      const fontTiers = [16, 24, 32, 40, 48]
      const font = wm.fontSize == null || wm.fontSize === '' ? NaN : Number(wm.fontSize)
      if (!fontTiers.includes(font)) {
        wm.fontSize = Number.isFinite(font)
          ? fontTiers.reduce((best, value) => Math.abs(value - font) <= Math.abs(best - font) ? value : best, fontTiers[0])
          : 24
      }
      const opacityTiers = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
      const opacity = wm.opacity == null || wm.opacity === '' ? NaN : Number(wm.opacity)
      if (!opacityTiers.includes(opacity)) {
        wm.opacity = Number.isFinite(opacity)
          ? opacityTiers.reduce((best, value) => Math.abs(value - opacity) <= Math.abs(best - opacity) ? value : best, opacityTiers[0])
          : 0.6
      }
    },
    async loadMaxOutputResolution() {
      // 运营开关（videoCreation.maxOutputResolution）：'1080p'（默认，禁止 4K）| '4k'
      // 优先级：运营后台功能开关（runtime 下发）→ 本地 store 设置 → 默认；失败一律 1080p（fail-closed）。
      try {
        let value = null
        try {
          const runtime = await opsCenterSyncRuntime()
          const ff = runtime && runtime.code === 0 ? runtime.data?.featureFlags?.[MAX_OUTPUT_RESOLUTION_KEY] : null
          if (ff === '4k' || ff === '1080p') value = ff
        } catch (_) { /* runtime 不可用走下一级 */ }
        if (value == null) {
          const raw = await storeGetSetting(MAX_OUTPUT_RESOLUTION_KEY)
          const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw.data ?? raw) : raw
          if (stored === '4k' || stored === '1080p') value = stored
        }
        this.maxOutputResolution = value === '4k' ? '4k' : '1080p'
      } catch (_) {
        this.maxOutputResolution = '1080p'
      }
    },
    async loadPipelineOptions() {
      // 运营中心选项控制（2026-08-31）：获取流水线选项可见性与默认值
      // 优先级：运营后台下发 → 桌面端本地默认值；失败一律使用本地默认值（fail-open，不阻塞创作）。
      this.s2vPipelineOptionsLoading = true
      try {
        const res = await opsCenterSyncPipelineOptions()
        const data = res && res.code === 0 ? res.data : null
        if (data && typeof data === 'object') {
          this.s2vPipelineOptions = {
            visibility: data.visibility || {},
            defaults: data.defaults || {},
          }
          // 应用默认值到当前配置（仅当用户未手动修改过时）
          this.applyS2VPipelineDefaults()
        }
      } catch (_) {
        // 运营中心不可用时使用本地默认值，不阻塞创作流程
        this.s2vPipelineOptions = null
      } finally {
        this.s2vPipelineOptionsLoading = false
      }
    },
    // 应用运营中心下发的选项默认值（2026-08-31）
    applyS2VPipelineDefaults() {
      const defaults = this.s2vPipelineOptions?.defaults
      if (!defaults || typeof defaults !== 'object') return
      // 映射 option_key 到 s2vConfig 字段
      const keyMap = {
        'basic.resolution': { target: 's2vOutputConfig', field: 'resolution' },
        'basic.voiceSpeed': { target: 's2vConfig', field: 'voiceSpeed' },
        'basic.voiceVolume': { target: 's2vConfig', field: 'voiceVolume' },
        'visual.imageStyle': { target: 's2vConfig', field: 'imageStyle' },
        'visual.imageProvider': { target: 's2vConfig', field: 'imageProvider' },
        'visual.promptStyle': { target: 's2vConfig', field: 'promptStyle' },
        'visual.imageEffect': { target: 's2vConfig', field: 'imageEffect' },
        'visual.imageCount': { target: 's2vConfig', field: 'imageCount' },
        'visual.subtitleStyle': { target: 's2vConfig', field: 'subtitleStyle' },
        'visual.watermarkConfig': { target: 's2vConfig', field: 'watermarkConfig' },
        'videoEnhance.videoMode': { target: 's2vConfig', field: 'videoMode' },
        'videoEnhance.videoFixedRatio': { target: 's2vConfig', field: 'videoFixedRatio' },
        'videoEnhance.videoMinRatio': { target: 's2vConfig', field: 'videoMinRatio' },
        'videoEnhance.videoMaxRatio': { target: 's2vConfig', field: 'videoMaxRatio' },
        'videoEnhance.shortVideoHandling': { target: 's2vConfig', field: 'shortVideoHandling' },
        'voice.voiceProvider': { target: 's2vConfig', field: 'voiceProvider' },
        'voice.voiceModel': { target: 's2vConfig', field: 'voiceModel' },
        'voice.voiceId': { target: 's2vConfig', field: 'voiceId' },
        'voice.bgm': { target: 's2vConfig', field: 'bgm' },
        'voice.bgmVolume': { target: 's2vConfig', field: 'bgmVolume' },
        'advanced.contentType': { target: 's2vConfig', field: 'contentType' },
        'advanced.creationMode': { target: 's2vConfig', field: 'creationMode' },
        'advanced.materialMode': { target: 's2vConfig', field: 'materialMode' },
        'advanced.splitLanguage': { target: 's2vConfig', field: 'splitLanguage' },
        'advanced.splitMode': { target: 's2vConfig', field: 'splitMode' },
        'advanced.splitMaxSentenceLength': { target: 's2vConfig', field: 'splitMaxSentenceLength' },
        'advanced.splitTargetCharsPerScene': { target: 's2vConfig', field: 'splitTargetCharsPerScene' },
        'advanced.templateId': { target: 's2vConfig', field: 'templateId' },
        'advanced.fps': { target: 's2vOutputConfig', field: 'fps' },
        'advanced.format': { target: 's2vOutputConfig', field: 'format' },
        'advanced.negativePrompt': { target: 's2vConfig', field: 'negativePrompt' },
        'publish.platforms': { target: 's2vConfig', field: 'platforms' },
      }
      for (const [key, value] of Object.entries(defaults)) {
        const mapping = keyMap[key]
        if (!mapping) continue
        const target = this[mapping.target]
        if (!target || typeof target !== 'object') continue
        // 仅当字段尚未被用户手动修改时应用默认值（undefined 或等于初始值）
        if (target[mapping.field] === undefined || target[mapping.field] === null) {
          try {
            target[mapping.field] = JSON.parse(value)
          } catch (_) {
            target[mapping.field] = value
          }
        }
      }
    },
    // 检查选项是否可见（2026-08-31）
    s2vOptionVisible(optionKey) {
      const vis = this.s2vPipelineOptions?.visibility
      if (!vis || typeof vis !== 'object') return true // 未下发配置时默认全部可见
      if (Object.prototype.hasOwnProperty.call(vis, optionKey)) return vis[optionKey] === true
      // 检查组级别可见性
      const group = optionKey.split('.')[0]
      const groupKey = group + '._group'
      if (Object.prototype.hasOwnProperty.call(vis, groupKey)) return vis[groupKey] === true
      return true // 默认可见
    },
    async loadS2VTtsSamples() {
      // Batch 5b：读取本地 TTS 时长样本用于自适应校准（best-effort，失败回退静态估算）。
      // 兼容 { code, data } 与直接数组两种返回形态（storeGetSetting 解包后为数组；测试/直连为原始对象）。
      try {
        const raw = await storeGetSetting('story2video.ttsSamples.v1')
        const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw.data ?? raw) : raw
        this.s2vTtsSamples = Array.isArray(value) ? value : []
      } catch (_) {
        this.s2vTtsSamples = []
      }
    },
    async resetS2VLastOptions() {
      const defaults = (this.$options.data || (() => ({}))).call(this)
      this.s2vRestoring = true
      try {
        this.s2vConfig = JSON.parse(JSON.stringify(defaults.s2vConfig || {}))
        this.s2vOutputConfig = JSON.parse(JSON.stringify(defaults.s2vOutputConfig || {}))
        // 重置后回到「未选择」状态，多模态默认重新生效
        this.s2vVoiceProviderExplicitEdge = false
        await this.loadS2VVoiceData()
        try { await storeSetSetting('story2video.lastOptions.v1', null) } catch { /* 清理失败可忽略 */ }
      } finally { this.s2vRestoring = false }
    },
    async startOrchestratedPipeline(startRequestId = this.orchestrationStartRequestId) {
      if (this.selectedPipeline.name !== 'story2video-compose' && this.isAutoPipeline(this.selectedPipeline.name)) {
        return this.startExplainerPipeline(startRequestId)
      }
      if (this.isMediaAutoPipeline(this.selectedPipeline.name)) {
        return this.startMediaPipeline(startRequestId)
      }
      try {
        if (this.inputMode !== 'text') {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_INPUT_ONLY })
          return
        }
        const text = this.pipelineText.trim()
        if (!text) {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_REQUIRED })
          return
        }
        if (countStory2VideoTextCharacters(text) > MAX_STORY2VIDEO_TEXT_CHARACTERS) {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_TOO_LONG, messageParams: { max: MAX_STORY2VIDEO_TEXT_CHARACTERS } })
          return
        }
        this.orchestrationError = ''
        const story2videoTextConfig = this.buildStory2VideoTextConfig(text)
        const params = {
          text,
          inputMode: 'text',
          checkpointPolicy: 'none',
          autoAdvance: true,
          background: true,
          // 历史记录提示词翻译（2026-08-12）：非 en 界面由主进程按场景生成只读翻译
          uiLocale: getAppLocale(),
          story2videoTextConfig,
        }
        const res = await pipelineStartOrchestrated(this.selectedPipeline.name, this.cloneForIpc(params))
        const outcome = res?.data
        if (!this.isCurrentOrchestrationStart(startRequestId)) return
        if (res?.code === 0 && typeof outcome?.runId === 'string' && outcome.runId.trim() && outcome.success !== false) {
          this.orchestrationRunId = outcome.runId.trim()
          this.orchestrationContext = null
          this.orchestrationContextRunId = null
          await this.saveS2VLastOptions()
          if (!this.isCurrentOrchestrationStart(startRequestId)) return
          if (this.applyOrchestrationOutcome(outcome)) return
          if (outcome.paused === true) {
            await this.showOrchestrationCheckpoint(outcome.runId, this.selectedPipeline.name, outcome)
          } else {
            await this.startOrchestrationForeground(outcome.runId, this.selectedPipeline.name, outcome)
          }
        } else { this.setOrchestrationError({ code: res?.code, errorCode: res?.errorCode || outcome?.errorCode, errorParams: res?.errorParams || outcome?.errorParams, error: res?.message || outcome?.error }) }
      } catch (_) {
        if (!this.isCurrentOrchestrationStart(startRequestId)) return
        this.setOrchestrationError({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ORCHESTRATION_FAILED, messageParams: { reason: '' } })
      }
    },
    // 批量创作/手动流水线共用配置构造（2026-08-15 story2video-batch-create）：
    // 从 s2vConfig 构建 Story2VideoTextConfig；批量模式取模板后删除 prompt 并按条注入。
    buildStory2VideoTextConfig(text) {
      const output = this.cloneForIpc(this.s2vOutputConfig)
      const config = this.cloneForIpc(this.s2vConfig)
      const tags = String(config.tagsText || '')
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean)
      return {
        version: 1,
        mode: 'text',
        prompt: text,
        size: output.resolution,
        contentType: config.contentType,
        split: {
          language: config.splitLanguage,
          mode: config.splitMode,
          maxSentenceLength: config.splitMaxSentenceLength,
          targetSeconds: config.splitTargetSeconds,
          targetCharsPerScene: config.splitTargetCharsPerScene,
          // 语言感知基准语速（Batch 5a）：zh 4.5 / en 2.8 / 其余 3.3，与 UI 估算同源
          baseWordsPerSecond: getLanguageBaseWordsPerSecond(config.splitLanguage),
          // 参数治理 R2：speechRate 由 normalizer 以 voice.speed 派生（单一来源），不提交。
          minWords: config.splitMinWords,
          maxWords: config.splitMaxWords,
          enforceSentenceBoundary: config.splitEnforceSentenceBoundary,
          overflowToNext: config.splitOverflowToNext,
          subtitleMinChars: config.splitSubtitleMinChars,
          subtitleMaxChars: config.splitSubtitleMaxChars,
          subtitleTiming: config.splitSubtitleTiming,
        },
        optimize: {
          style: config.promptStyle,
          // 图片提示词最大长度（2026-08-16）：渲染层可配置，主进程契约收敛 [50,2000]
          maxLength: config.maxPromptLength,
          // 参数治理（7.1.19）：creativeLevel 为系统管理参数，不提交，normalizer 默认 5 兜底。
          negativePrompt: config.negativePrompt,
        },
        image: {
          provider: config.imageProvider || '',
          model: config.imageModel || '',
          style: config.imageStyle,
          effect: config.imageEffect,
          aspectRatio: getStory2VideoOutputAspectRatio(output.resolution),
        },
        // 视频+图片轮播混合模式（2026-08-11）：off=纯图片轮播；fixed=前段固定比例 AI 视频；ai-judged=AI 智能选择
        video: {
          mode: config.videoMode || 'off',
          shortVideoHandling: config.shortVideoHandling || 'loop',
          provider: config.videoProvider || '',
          model: config.videoModel || '',
          fixedRatio: config.videoFixedRatio,
          minRatio: config.videoMinRatio,
          maxRatio: config.videoMaxRatio,
          maxScenes: config.videoMaxScenes,
        },
        // 创作模式（2026-08-12）：auto=全自动；manual=分镜素材自选（materialMode 仅 manual 生效）
        creation: {
          mode: config.creationMode || 'auto',
          materialMode: config.manualMaterialMode || 'all-images',
        },
        voice: {
          provider: config.voiceProvider || '',
          model: config.voiceModel || '',
          id: config.voiceId,
          speed: config.voiceSpeed,
          volume: config.voiceVolume,
          // 参数治理（7.1.19）：pitch 为系统管理参数，不提交，normalizer 默认 0 兜底。
        },
        subtitle: {
          enabled: config.subtitleEnabled,
          size: config.subtitleSize,
          style: config.subtitleStyleName,
          color: config.subtitleStyle?.color || 'white',
        },
        bgm: { enabled: Boolean(config.bgmPath), path: config.bgmPath || '', volume: config.bgmVolume },
        transition: config.transition,
        sceneDurationMode: config.sceneDurationMode,
        minSceneDuration: config.minSceneDuration,
        templateId: config.templateId || '',
        // 参数治理 R2：concurrency 为系统管理参数，不提交，normalizer 默认 3 兜底。
        watermark: {
          ...config.watermarkConfig,
          enabled: Boolean(config.watermarkText),
          text: config.watermarkText || '',
        },
        output: { fps: output.fps, format: output.format },
        publish: {
          enabled: config.publishEnabled === true || (Array.isArray(config.platforms) && config.platforms.length > 0),
          platforms: Array.isArray(config.platforms) ? config.platforms : [],
          title: config.title || '',
          content: config.publishContent || text,
          tags,
          coverUrl: config.coverUrl || '',
        },
      }
    },
    cloneForIpc(value) {
      try { return JSON.parse(JSON.stringify(value)) } catch { return {} }
    },
    // ---- 批量创作（2026-08-15 story2video-batch-create）----
    openS2VBatchDialog() {
      this.s2vBatchDialogOpen = true
      this.s2vBatchError = ''
      this.refreshS2VBatches()
      // 弹窗打开期间 3s 轮询队列状态；关闭后停止（批量任务在主进程队列继续后台执行）
      if (!this.s2vBatchPollTimer) {
        this.s2vBatchPollTimer = setInterval(() => {
          if (this.s2vBatchDialogOpen) this.refreshS2VBatches()
        }, 3000)
      }
    },
    closeS2VBatchDialog() {
      this.s2vBatchDialogOpen = false
      if (this.s2vBatchPollTimer) {
        clearInterval(this.s2vBatchPollTimer)
        this.s2vBatchPollTimer = null
      }
    },
    addS2VBatchText() {
      if (this.s2vBatchTexts.length >= this.S2V_BATCH_MAX_TEXTS) return
      this.s2vBatchTexts.push('')
    },
    removeS2VBatchText(index) {
      if (this.s2vBatchTexts.length <= 1) return
      this.s2vBatchTexts.splice(index, 1)
    },
    async pickS2VBatchFiles() {
      try {
        const res = await story2videoPickBatchFiles()
        const files = res?.code === 0 && Array.isArray(res.data?.files) ? res.data.files : []
        if (!files.length) return
        const merged = [...this.s2vBatchFiles]
        for (const file of files) {
          if (!file || typeof file.path !== 'string' || !file.path) continue
          if (merged.some(existing => existing.path === file.path)) continue
          if (merged.length >= this.S2V_BATCH_MAX_FILES) {
            this.s2vBatchError = this.translateWithLocaleFallback('create.story2video.batch.fileLimitError', '最多选择 20 个文件，超出部分已忽略。', 'Up to 20 files; extra selections were ignored.')
            break
          }
          merged.push({ name: file.name || String(file.path).split(/[\\/]/).pop(), path: file.path })
        }
        this.s2vBatchFiles = merged
      } catch (_) {
        this.s2vBatchError = this.translateWithLocaleFallback('create.story2video.batch.pickFailed', '打开文件选择窗口失败，请重试。', 'Failed to open the file picker. Please retry.')
      }
    },
    // 浏览器降级路径（非 Electron 环境）：隐藏 input 兜底选择
    handleS2VBatchFileInput(event) {
      const selected = Array.from(event?.target?.files || [])
      const merged = [...this.s2vBatchFiles]
      for (const file of selected) {
        const path = typeof file.path === 'string' && file.path ? file.path : file.name
        if (merged.some(existing => existing.path === path)) continue
        if (merged.length >= this.S2V_BATCH_MAX_FILES) break
        merged.push({ name: file.name, path })
      }
      this.s2vBatchFiles = merged
      if (event?.target) event.target.value = ''
    },
    removeS2VBatchFile(index) {
      this.s2vBatchFiles.splice(index, 1)
    },
    formatS2VBatchCreatedAt(iso) {
      if (!iso) return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    },
    batchSummaryText(batch) {
      const summary = batch && batch.summary ? batch.summary : null
      if (!summary) return ''
      const parts = []
      if (summary.running > 0) parts.push(this.translateWithLocaleFallback('create.story2video.batch.summaryRunning', summary.running + ' 运行中', summary.running + ' running', { count: summary.running }))
      if (summary.pending > 0) parts.push(this.translateWithLocaleFallback('create.story2video.batch.summaryPending', summary.pending + ' 排队中', summary.pending + ' queued', { count: summary.pending }))
      if (summary.completed > 0) parts.push(this.translateWithLocaleFallback('create.story2video.batch.summaryCompleted', summary.completed + ' 已完成', summary.completed + ' completed', { count: summary.completed }))
      if (summary.failed > 0) parts.push(this.translateWithLocaleFallback('create.story2video.batch.summaryFailed', summary.failed + ' 失败', summary.failed + ' failed', { count: summary.failed }))
      if (summary.cancelled > 0) parts.push(this.translateWithLocaleFallback('create.story2video.batch.summaryCancelled', summary.cancelled + ' 已取消', summary.cancelled + ' cancelled', { count: summary.cancelled }))
      return parts.join(' · ') || this.translateWithLocaleFallback('create.story2video.batch.summaryTotal', '共 ' + summary.total + ' 个任务', summary.total + ' tasks', { total: summary.total })
    },
    s2vBatchItemStatusText(item) {
      const statusMap = {
        pending: ['create.story2video.batch.statusPending', '排队中', 'Queued'],
        running: ['create.story2video.batch.statusRunning', '运行中', 'Running'],
        completed: ['create.story2video.batch.statusCompleted', '已完成', 'Completed'],
        failed: ['create.story2video.batch.statusFailed', '失败', 'Failed'],
        cancelled: ['create.story2video.batch.statusCancelled', '已取消', 'Cancelled'],
      }
      const entry = statusMap[item && item.status] || ['', String(item && item.status || ''), String(item && item.status || '')]
      return this.translateWithLocaleFallback(entry[0], entry[1], entry[2])
    },
    s2vBatchCanStart() {
      if (this.s2vBatchStarting) return false
      if (this.s2vBatchTab === 'text') return this.s2vBatchTexts.some(text => String(text || '').trim().length > 0)
      return this.s2vBatchFiles.length > 0
    },
    async startS2VBatch() {
      if (this.s2vBatchStarting) return
      this.s2vBatchError = ''
      const template = this.buildStory2VideoTextConfig('')
      delete template.prompt
      // 批量创作固定「全自动」创作模式 + 弹窗独立视频增强模式（不随主表单配置变化）
      template.creation = { mode: 'auto', materialMode: 'all-images' }
      template.video = { ...template.video, mode: this.s2vBatchVideoMode || 'off' }
      let payload
      if (this.s2vBatchTab === 'text') {
        const texts = this.s2vBatchTexts.map(text => String(text || '').trim()).filter(Boolean)
        if (!texts.length) {
          this.s2vBatchError = this.translateWithLocaleFallback('create.story2video.batch.noTextError', '请至少输入 1 条文案。', 'Enter at least 1 text.')
          return
        }
        payload = { mode: 'text', texts, story2videoTextConfigTemplate: template, uiLocale: getAppLocale() }
      } else {
        const files = this.s2vBatchFiles.map(file => ({ path: file.path, name: file.name }))
        if (!files.length) {
          this.s2vBatchError = this.translateWithLocaleFallback('create.story2video.batch.noFileError', '请至少选择 1 个文件。', 'Choose at least 1 file.')
          return
        }
        payload = { mode: 'files', files, story2videoTextConfigTemplate: template, uiLocale: getAppLocale() }
      }
      this.s2vBatchStarting = true
      try {
        const res = await story2videoBatchCreate(this.cloneForIpc(payload))
        if (res?.code === 0 && res?.data?.batchId) {
          await this.refreshS2VBatches()
          this.s2vBatchTexts = ['']
          this.s2vBatchFiles = []
        } else {
          const failedItems = Array.isArray(res?.failedItems) ? res.failedItems : []
          const failedLabel = failedItems.length > 0
            ? '（' + failedItems.map(item => item.label).join('、') + '）'
            : ''
          const message = (res?.message || '未知错误') + failedLabel
          this.s2vBatchError = this.translateWithLocaleFallback(
            'create.story2video.batch.createFailed',
            '启动失败：' + message,
            'Start failed: ' + message,
            { message }
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.s2vBatchError = this.translateWithLocaleFallback(
          'create.story2video.batch.createFailed',
          '启动失败：' + message,
          'Start failed: ' + message,
          { message }
        )
      } finally {
        this.s2vBatchStarting = false
      }
    },
    async refreshS2VBatches() {
      if (this.s2vBatchLoading) return
      this.s2vBatchLoading = true
      try {
        const res = await story2videoBatchStatus()
        if (res?.code === 0 && Array.isArray(res.data)) {
          this.s2vBatches = res.data
          this.surfaceS2VBatchModelRequirementErrors()
        }
      } catch (_) { /* 轮询失败静默，下个周期重试 */ } finally {
        this.s2vBatchLoading = false
      }
    },
    // 批量项启动前置校验失败（PIPELINE_MODEL_REQUIREMENTS_MISSING）→ 弹「去模型设置」提示
    // 每 itemId 只弹一次，避免轮询周期重复打扰；用户补齐模型后再启动的批次不受影响。
    surfaceS2VBatchModelRequirementErrors() {
      if (!Array.isArray(this.s2vBatches)) return
      if (!this._s2vModelsRequiredShownItemIds) this._s2vModelsRequiredShownItemIds = new Set()
      for (const batch of this.s2vBatches) {
        if (!batch || !Array.isArray(batch.items)) continue
        const item = batch.items.find((it) => it && it.status === 'failed' && it.errorCode === 'PIPELINE_MODEL_REQUIREMENTS_MISSING' && it.itemId)
        if (!item || this._s2vModelsRequiredShownItemIds.has(item.itemId)) continue
        this._s2vModelsRequiredShownItemIds.add(item.itemId)
        const errorParams = item.errorParams && typeof item.errorParams === 'object' ? item.errorParams : {}
        this.showStory2VideoErrorDialog({
          errorCode: 'PIPELINE_MODEL_REQUIREMENTS_MISSING',
          errorParams,
          error: typeof item.error === 'string' ? item.error : '',
        })
        return
      }
    },
    async cancelS2VBatchItem(batchId, itemId) {
      try {
        const res = await story2videoBatchCancel(batchId, [itemId])
        if (res?.code === 0) await this.refreshS2VBatches()
      } catch (_) { /* 取消失败静默 */ }
    },
    // 分镜字数主控：clamp 到 [minWords, maxWords] ∩ [1,200]，并同步旧 targetSeconds（估算，与 normalizer 幂等反推一致）
    applyS2VTargetChars(rawChars) {
      const chars = Number(rawChars)
      if (!Number.isFinite(chars) || chars <= 0) return
      const min = Math.max(1, Number(this.s2vConfig.splitMinWords) || 10)
      const max = Math.min(200, Number(this.s2vConfig.splitMaxWords) || 50)
      const clamped = Math.min(max, Math.max(min, Math.round(chars)))
      this.s2vConfig.splitTargetCharsPerScene = clamped
      const cps = this.s2vSplitCharsPerSecond
      this.s2vConfig.splitTargetSeconds = cps > 0 ? Math.min(60, Math.max(1, Math.round(clamped / cps))) : 6
    },
    applyS2VTemplate() {
      const template = getTemplateById(this.s2vConfig.templateId, window.localStorage)
      if (!template) return
      this.s2vConfig.imageEffect = template.imageEffect
      this.s2vConfig.transition = template.transitionEffect
      this.s2vConfig.subtitleEnabled = template.subtitleStyle?.enabled !== false
      this.s2vConfig.subtitleSize = template.subtitleStyle?.size || 'size3'
      this.s2vConfig.subtitleStyleName = template.subtitleStyle?.style || this.s2vConfig.subtitleStyleName
      this.s2vConfig.subtitleStyle = {
        ...this.s2vConfig.subtitleStyle,
        size: template.subtitleStyle?.size || 'md',
        style: template.subtitleStyle?.style || this.s2vConfig.subtitleStyle.style,
        color: template.subtitleStyle?.color || this.s2vConfig.subtitleStyle.color,
      }
      if (template.bgm && Number.isFinite(Number(template.bgm.volume))) {
        this.s2vConfig.bgmVolume = Math.min(10, Math.max(0, Number(template.bgm.volume)))
      }
      if (template.size) this.s2vOutputConfig.resolution = normalizeResolution(template.size, this.maxOutputResolution)
    },
    refreshS2VTemplates() {
      this.s2vTemplateLibrary = getAllTemplates('all', window.localStorage)
    },
    getS2VVoiceContext() {
      const providerId = typeof this.s2vConfig.voiceProvider === 'string' ? this.s2vConfig.voiceProvider.trim() : ''
      // MiMo TTS：语音模型下拉隐藏，catalog 请求固定用 mimo-v2.5-tts（预置音色目录）
      const model = this.s2vVoiceModelHidden
        ? 'mimo-v2.5-tts'
        : (typeof this.s2vConfig.voiceModel === 'string' ? this.s2vConfig.voiceModel.trim() : '')
      return providerId && model ? { providerId, model } : null
    },
    // MiMo TTS 克隆上下文：克隆 registry/偏好绑定在 voiceclone 模型下
    getS2VVoiceCloneContext() {
      const context = this.getS2VVoiceContext()
      if (!context) return null
      return this.s2vVoiceModelHidden
        ? { providerId: context.providerId, model: 'mimo-v2.5-tts-voiceclone' }
        : context
    },
    getS2VVoiceProvider(providerId = this.s2vConfig.voiceProvider) {
      return this.s2vVoiceProviders.find(provider => provider?.id === providerId) || null
    },
    getS2VDefaultVoiceModel(providerId = this.s2vConfig.voiceProvider) {
      const provider = this.getS2VVoiceProvider(providerId)
      const models = Array.isArray(provider?.models)
        ? provider.models.filter(model => typeof model === 'string' && model)
        : []
      // MiMo TTS：语音模型下拉隐藏，voiceModel 置空（模型由「语音/音色 ID」区分）
      if (provider?.id === 'mimo-tts') return ''
      // 多模态：默认取 capability_models.tts（能力默认模型），models 首项可能是 image/video/llm 模型。
      if (provider?.category === 'multimodal' && provider.capability_models && typeof provider.capability_models.tts === 'string') {
        const ttsModel = provider.capability_models.tts
        return models.includes(ttsModel) ? ttsModel : (ttsModel || models[0] || '')
      }
      const configuredDefault = typeof provider?.defaultModel === 'string' ? provider.defaultModel : ''
      return models.includes(configuredDefault) ? configuredDefault : (models[0] || '')
    },
    getS2VVideoProvider(providerId = this.s2vConfig.videoProvider) {
      return this.s2vVideoProviders.find(provider => provider?.id === providerId) || null
    },
    getS2VDefaultVideoModel(providerId = this.s2vConfig.videoProvider) {
      const provider = this.getS2VVideoProvider(providerId)
      const models = Array.isArray(provider?.models)
        ? provider.models.filter(model => typeof model === 'string' && model)
        : []
      // 多模态：默认取 capability_models.video（能力默认模型），models 首项可能是 image/llm 模型。
      if (provider?.category === 'multimodal' && provider.capability_models && typeof provider.capability_models.video === 'string') {
        const videoModel = provider.capability_models.video
        return models.includes(videoModel) ? videoModel : (videoModel || models[0] || '')
      }
      const configuredDefault = typeof provider?.defaultModel === 'string' ? provider.defaultModel : ''
      return models.includes(configuredDefault) ? configuredDefault : (models[0] || '')
    },
    handleS2VVideoProviderChange() {
      const nextProviderId = this.getS2VVideoProvider()?.id || ''
      this.s2vConfig.videoProvider = nextProviderId
      this.s2vConfig.videoModel = nextProviderId ? this.getS2VDefaultVideoModel(nextProviderId) : ''
    },
    isCurrentS2VVoiceRequest(requestId, context) {
      return requestId === this.s2vVoiceRequestId
        && this.s2vConfig.voiceProvider === context.providerId
        && this.s2vVoiceContextModel === context.model
    },
    isCurrentS2VVoiceCloneRequest(requestId, context) {
      // MiMo TTS：克隆请求的 context.model 是 mimo-v2.5-tts-voiceclone（与 catalog 的 tts 模型不同）
      const expectedModel = this.s2vVoiceModelHidden ? 'mimo-v2.5-tts-voiceclone' : this.s2vVoiceContextModel
      return requestId === this.s2vVoiceCloneRequestId
        && this.s2vConfig.voiceProvider === context.providerId
        && expectedModel === context.model
    },
    isCurrentS2VVoiceSelectionRequest(requestId, context, voiceId) {
      // MiMo TTS：克隆音色选择请求的 context.model 是 mimo-v2.5-tts-voiceclone
      const expectedModel = this.s2vVoiceModelHidden ? 'mimo-v2.5-tts-voiceclone' : this.s2vVoiceContextModel
      return requestId === this.s2vVoiceSelectionRequestId
        && this.s2vConfig.voiceProvider === context.providerId
        && expectedModel === context.model
        && this.s2vConfig.voiceId === voiceId
    },
    toS2VVoiceOption(voice) {
      const id = typeof voice?.id === 'string' ? voice.id.trim() : ''
      const name = typeof voice?.name === 'string' ? voice.name.trim() : ''
      if (!id || !name) return null
      return { id, name, invalid: voice.invalid === true }
    },
    isS2VDefaultVoice(voiceId) {
      return typeof voiceId === 'string' && voiceId.length > 0 && this.s2vConfig.voiceId === voiceId
    },
    story2videoKindLabel(kind) {
      const labels = {
        image: '图片',
        audio: '旁白音频',
        bgm: '背景音乐',
        video: '视频素材',
      }
      return labels[kind] || ''
    },
    toS2VVoiceCloneRequirements(requirements) {
      if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return null
      const toFiniteNumber = (value) => Number.isFinite(value) && value >= 0 ? value : null
      return {
        allowedExtensions: Array.isArray(requirements.allowedExtensions)
          ? requirements.allowedExtensions.filter(extension => typeof extension === 'string' && extension)
          : [],
        maxSampleCount: toFiniteNumber(requirements.maxSampleCount),
        maxSampleBytes: toFiniteNumber(requirements.maxSampleBytes),
        maxTotalBytes: toFiniteNumber(requirements.maxTotalBytes),
        minSampleDurationSeconds: toFiniteNumber(requirements.minSampleDurationSeconds) || 0,
        maxSampleDurationSeconds: toFiniteNumber(requirements.maxSampleDurationSeconds),
        maxTotalDurationSeconds: toFiniteNumber(requirements.maxTotalDurationSeconds),
      }
    },
    friendlyVoiceCatalogError(message) {
      const raw = String(message || '')
      const map = {
        VOICE_CATALOG_UNSUPPORTED: ['当前语音模型暂不支持音色列表与克隆功能，已使用默认音色。', 'This voice model does not support voice lists or cloning yet. Using the default voice.'],
        VOICE_CATALOG_CONFIG_UNAVAILABLE: ['当前语音服务商配置不可用，请在模型设置中检查并配置后重试。', 'The voice provider configuration is unavailable. Check it in model settings and retry.'],
        VOICE_CATALOG_UNAVAILABLE: ['暂时无法获取音色列表，已使用默认音色，请稍后重试。', 'The voice list is temporarily unavailable. Using the default voice. Please try again later.'],
        VOICE_MODEL_MISMATCH: ['所选语音模型与配置不一致，请检查模型设置。', 'The selected voice model does not match the configuration. Check the model settings.'],
        VOICE_PREFERENCE_STORE_UNAVAILABLE: ['音色偏好保存不可用，请检查本地存储。', 'Voice preference storage is unavailable. Check local storage.'],
        VOICE_OWNER_UNAVAILABLE: ['登录状态不可用，请重新登录后重试。', 'Sign-in state is unavailable. Sign in again and retry.'],
        VOICE_NOT_IN_CATALOG: ['所选音色不在当前音色列表中，请重新选择。', 'The selected voice is not in the current voice list. Select another voice.'],
        VOICE_CLONE_SAMPLE_INVALID: ['上传的音频文件不符合要求，请按提示调整格式、时长或大小后重试。', 'The uploaded audio does not meet the requirements. Adjust format, duration, or size and retry.'],
        VOICE_CLONE_SAMPLE_DURATION_INVALID: ['上传的音频文件时长不符合要求，请按提示调整时长后重试。', 'The uploaded audio duration does not meet the requirements. Adjust the duration and retry.'],
        VOICE_CLONE_SAMPLE_EXTENSION_UNSUPPORTED: ['上传的音频文件格式不符合要求，请使用 mp3、m4a 或 wav 格式。', 'The uploaded audio format is not supported. Use mp3, m4a, or wav.'],
        VOICE_CLONE_SAMPLE_TOO_LARGE: ['上传的音频文件大小超出限制，请压缩或更换文件后重试。', 'The uploaded audio is too large. Compress it or use another file.'],
        VOICE_CLONE_TOTAL_SIZE_EXCEEDED: ['上传的音频总大小超出限制，请减少文件后重试。', 'The total audio size exceeds the limit. Remove files and retry.'],
        VOICE_CLONE_TOTAL_DURATION_EXCEEDED: ['上传的音频总时长超出限制，请减少文件后重试。', 'The total audio duration exceeds the limit. Remove files and retry.'],
        VOICE_CLONE_PROVIDER_UNAVAILABLE: ['音色克隆服务暂时不可用，请稍后重试。', 'Voice cloning is temporarily unavailable. Please try again later.'],
        VOICE_CLONE_UNAVAILABLE: ['音色克隆服务暂时不可用，请稍后重试。', 'Voice cloning is temporarily unavailable. Please try again later.'],
        VOICE_CLONE_UNSUPPORTED: ['当前语音模型暂不支持音色克隆，已使用默认音色。', 'This voice model does not support voice cloning yet. Using the default voice.'],
        VOICE_CLONE_DIALOG_UNAVAILABLE: ['无法打开本地音频文件选择窗口，请重试。', 'Could not open the audio file picker. Please try again.'],
        VOICE_CLONE_DUPLICATE_ID: ['该克隆音色已存在，请更换名称后重试。', 'A cloned voice with this name already exists. Use another name.'],
        VOICE_CLONE_MODEL_MISMATCH: ['所选语音模型与克隆配置不一致，请检查模型设置。', 'The selected voice model does not match the clone configuration. Check the model settings.'],
        VOICE_CLONE_NOT_FOUND: ['未找到该克隆音色，请重新选择。', 'The cloned voice was not found. Select it again.'],
        VOICE_CLONE_REGISTRY_INVALID: ['克隆音色本地记录异常，请重新选择音频文件后重试。', 'The local clone voice record is invalid. Select the audio file again and retry.'],
        VOICE_CLONE_ROLLBACK_REQUIRED: ['克隆音色保存未完成，请重新选择音频文件后重试。', 'The clone voice save did not finish. Select the audio file again and retry.'],
        VOICE_CLONE_SELECTION_UNAVAILABLE: ['音频样本暂存不可用，请重新选择音频文件。', 'Audio sample staging is unavailable. Select the audio file again.'],
        VOICE_CLONE_STORE_UNAVAILABLE: ['克隆音色本地存储不可用，请检查磁盘空间后重试。', 'Clone voice storage is unavailable. Check disk space and retry.'],
        VOICE_CLONE_STORAGE_UNAVAILABLE: ['克隆音色本地存储不可用，请检查磁盘空间后重试。', 'Clone voice storage is unavailable. Check disk space and retry.'],
        VOICE_CLONE_INVALID_ARGUMENTS: ['克隆音色参数不合法，请重新选择音频文件。', 'Invalid clone voice parameters. Select the audio file again.'],
      }
      const found = Object.entries(map).find(([key]) => raw.includes(key))
      if (found) return this.translateWithLocaleFallback('create.story2video.voice.' + found[0], found[1][0], found[1][1])
      // 不向用户泄露系统技术错误码
      return this.translateWithLocaleFallback(
        'create.story2video.voice.catalogLoadFailed',
        '无法加载音色列表，已使用默认音色，请稍后重试。',
        'The voice list could not be loaded. Using the default voice. Please try again later.'
      )
    },
    s2vVoiceCloneHint() {
      const r = this.s2vVoiceCloneRequirements
      if (!r) return ''
      const parts = []
      if (Array.isArray(r.allowedExtensions) && r.allowedExtensions.length > 0) {
        const extText = r.allowedExtensions.map(ext => String(ext).replace(/^\./, '')).join('、')
        parts.push('上传的音频文件格式需为：' + extText + ' 格式')
      }
      if (r.minSampleDurationSeconds > 0 && r.maxSampleDurationSeconds > 0) {
        const maxMinutes = Math.round(r.maxSampleDurationSeconds / 60)
        parts.push('上传的音频文件的时长最少应不低于 ' + r.minSampleDurationSeconds + ' 秒，最长应不超过 ' + maxMinutes + ' 分钟')
      } else if (r.maxSampleDurationSeconds > 0) {
        parts.push('上传的音频文件的时长最长应不超过 ' + this.formatS2VVoiceCloneDuration(r.maxSampleDurationSeconds))
      }
      if (r.maxSampleBytes > 0) {
        parts.push('上传的音频文件大小需不超过 ' + this.formatS2VVoiceCloneBytes(r.maxSampleBytes))
      }
      return parts.length > 0 ? parts.join('；') + '。' : ''
    },
    resetS2VVoiceData() {
      this.s2vVoiceCatalog = []
      this.s2vVoiceCatalogLoading = false
      this.s2vVoiceCatalogError = ''
      this.s2vVoiceCatalogErrorCode = ''
      this.s2vVoiceCapability = null
      this.s2vPersistedVoiceId = ''
      this.s2vVoiceCloneRequirements = null
      this.s2vVoiceClones = []
      this.s2vVoiceCloneSelection = null
      this.s2vVoiceClonePending = null
      this.s2vVoiceCloneLoading = false
      this.s2vVoiceCloneError = ''
      this.s2vVoiceCloneRenamingId = ''
      this.s2vVoiceCloneRenameDraft = ''
    },
    async loadS2VVoiceData(options = {}) {
      // 卸载守卫：弹窗关闭触发的语音目录/能力重载可能跨越组件卸载（2026-08-12 复审 I1）
      if (this._s2vAlive === false) return
      const context = this.getS2VVoiceContext()
      const requestId = ++this.s2vVoiceRequestId
      this.s2vVoiceSelectionRequestId += 1
      this.s2vVoiceCloneRequestId += 1
      this.resetS2VVoiceData()
      if (!context) return

      this.s2vVoiceCatalogLoading = true
      const catalogInput = this.cloneForIpc({ ...context, refresh: options.refresh === true })
      // MiMo TTS：catalog 用 mimo-v2.5-tts（预置音色），capability/克隆用 mimo-v2.5-tts-voiceclone
      // （音色复刻能力由 voiceclone 模型声明）。语音模型下拉隐藏，模型由音色类型区分。
      const cloneContext = this.s2vVoiceModelHidden
        ? { providerId: context.providerId, model: 'mimo-v2.5-tts-voiceclone' }
        : context
      const [catalogResult, capabilityResult] = await Promise.allSettled([
        getTtsVoiceCatalog(catalogInput),
        getTtsVoiceCapability(this.cloneForIpc(cloneContext)),
      ])
      if (!this.isCurrentS2VVoiceRequest(requestId, context)) return

      const catalogResponse = catalogResult.status === 'fulfilled' ? catalogResult.value : null
      const capabilityResponse = capabilityResult.status === 'fulfilled' ? capabilityResult.value : null
      const catalogData = catalogResponse?.code === 0 && catalogResponse.data && typeof catalogResponse.data === 'object'
        ? catalogResponse.data
        : null
      const capabilityData = capabilityResponse?.code === 0 && capabilityResponse.data && typeof capabilityResponse.data === 'object'
        ? capabilityResponse.data
        : null
      this.s2vVoiceCatalog = [
        ...(Array.isArray(catalogData?.voices) ? catalogData.voices.map(voice => this.toS2VVoiceOption(voice)).filter(Boolean) : []),
        // 失效克隆音色（如旧版生成的非法 voice_id）：仅展示提示，不可选择
        ...(Array.isArray(catalogData?.invalidVoices) ? catalogData.invalidVoices.map(voice => this.toS2VVoiceOption(voice)).filter(Boolean) : []),
      ]
      this.s2vVoiceCapability = capabilityData
        ? {
            type: capabilityData.type,
            clone: { enabled: capabilityData.clone?.enabled === true },
          }
        : null
      this.s2vVoiceCatalogLoading = false
      this.s2vVoiceCatalogErrorCode = catalogData ? '' : String(catalogResponse?.message || '')
      if (!catalogData) {
        this.s2vVoiceCatalogError = this.friendlyVoiceCatalogError(catalogResponse?.message)
      }

      const cloneEnabled = this.s2vVoiceCapability?.type === 'user_clone'
        && this.s2vVoiceCapability?.clone?.enabled === true
      if (cloneEnabled) {
        const cloneRequestId = ++this.s2vVoiceCloneRequestId
        this.s2vVoiceCloneLoading = true
        const [requirementsResult, clonesResult] = await Promise.allSettled([
          getTtsVoiceCloneRequirements(this.cloneForIpc(cloneContext)),
          listTtsVoiceClones(this.cloneForIpc(cloneContext)),
        ])
        if (!this.isCurrentS2VVoiceRequest(requestId, context)
          || !this.isCurrentS2VVoiceCloneRequest(cloneRequestId, cloneContext)) return

        const requirementsResponse = requirementsResult.status === 'fulfilled' ? requirementsResult.value : null
        const clonesResponse = clonesResult.status === 'fulfilled' ? clonesResult.value : null
        this.s2vVoiceCloneRequirements = requirementsResponse?.code === 0
          ? this.toS2VVoiceCloneRequirements(requirementsResponse.data)
          : null
        this.s2vVoiceClones = clonesResponse?.code === 0 && Array.isArray(clonesResponse.data?.voices)
          ? clonesResponse.data.voices.map(voice => this.toS2VVoiceOption(voice)).filter(Boolean)
          : []
        this.s2vVoiceCloneError = requirementsResponse?.code === 0 && clonesResponse?.code === 0
          ? ''
          : (requirementsResponse?.message || clonesResponse?.message || '无法加载克隆音色信息。')
        this.s2vVoiceCloneLoading = false
      }

      if (!this.isCurrentS2VVoiceRequest(requestId, context)) return
      const selectedVoiceId = typeof catalogData?.selectedVoiceId === 'string' ? catalogData.selectedVoiceId : ''
      const configuredVoiceId = typeof this.s2vConfig.voiceId === 'string' ? this.s2vConfig.voiceId : ''
      const availableVoiceIds = new Set(this.s2vVoiceOptions.map(voice => voice.id))
      if (selectedVoiceId && availableVoiceIds.has(selectedVoiceId)) {
        this.s2vConfig.voiceId = selectedVoiceId
        this.s2vPersistedVoiceId = selectedVoiceId
      } else if (configuredVoiceId && availableVoiceIds.has(configuredVoiceId)) {
        this.s2vPersistedVoiceId = configuredVoiceId
      } else {
        this.s2vConfig.voiceId = ''
      }
    },
    async refreshS2VVoiceCatalog() {
      this.s2vVoiceCatalogError = ''
      await this.loadS2VVoiceData({ refresh: true })
    },
    async loadS2VProviders() {
      // 卸载守卫：弹窗关闭触发的重拉可能跨越组件卸载，异步恢复后不再写已卸载组件状态（2026-08-12 审查 m3 修复）。
      if (this._s2vAlive === false) return
      const providerRequestId = ++this.s2vVoiceProviderRequestId
      const [imageResult, voiceResult, videoResult] = await Promise.allSettled([
        modelProviderList('image'),
        modelProviderList('tts'),
        modelProviderList('video'),
      ])
      if (providerRequestId !== this.s2vVoiceProviderRequestId || this._s2vAlive === false) return

      // 只展示「已启用且已配置」的服务商（is_configured=true：有可用 API Key 或免 Key 本地模型）。
      // 未配置/Key 解密失败的 provider 不进入能力下拉，避免旧配置恢复选中后流水线反复重试
      // 「尚未配置 API Key」导致卡在 generate_assets（2026-08-09 排查：debug profile 残留失效 key）。
      // 仅本次拉取成功才替换列表/归一化；IPC 瞬时失败时保留旧列表与旧选中值，
      // 避免把「临时故障」误渲染成「未配置模型」并清空用户已选 provider（2026-08-12 审查 M1 修复）。
      const isFetchedOk = (result) => result.status === 'fulfilled' && result.value?.code === 0 && Array.isArray(result.value.data)
      const enabledProviders = (result) => isFetchedOk(result)
        ? result.value.data.filter(provider => provider?.enabled === true && provider.is_configured === true && provider.id && provider.name)
        : null

      const nextImageProviders = enabledProviders(imageResult)
      if (nextImageProviders) {
        this.s2vImageProviders = nextImageProviders
        // 图片生成器下拉归一化：已不存在/未配置的 provider 清空（含 imageModel），
        // 避免下拉出现空白选中项；无显式选择时默认取第一个可用图片 provider（2026-08-12 Bug 修复）。
        const imageProviderIds = new Set(this.s2vImageProviders.map(p => p.id))
        if (this.s2vConfig.imageProvider && !imageProviderIds.has(this.s2vConfig.imageProvider)) {
          this.s2vConfig.imageProvider = ''
          this.s2vConfig.imageModel = ''
        }
        if (!this.s2vConfig.imageProvider && this.s2vImageProviders[0]) this.s2vConfig.imageProvider = this.s2vImageProviders[0].id
      }

      const nextVideoProviders = enabledProviders(videoResult)
      if (nextVideoProviders) {
        this.s2vVideoProviders = nextVideoProviders
        // 视频生成器与图片对齐（2026-08-12 审查 M2）：陈旧 provider 清空（含 videoModel），
        // 未显式选择时默认取第一个可用视频 provider。
        const videoProviderIds = new Set(this.s2vVideoProviders.map(p => p.id))
        if (this.s2vConfig.videoProvider && !videoProviderIds.has(this.s2vConfig.videoProvider)) {
          this.s2vConfig.videoProvider = ''
          this.s2vConfig.videoModel = ''
        }
        if (!this.s2vConfig.videoProvider && this.s2vVideoProviders[0]) {
          this.s2vConfig.videoProvider = this.s2vVideoProviders[0].id
          this.s2vConfig.videoModel = this.getS2VDefaultVideoModel(this.s2vConfig.videoProvider)
        }
      }

      const nextVoiceProviders = enabledProviders(voiceResult)
      if (nextVoiceProviders) {
        this.s2vVoiceProviders = nextVoiceProviders
        const configuredProvider = this.getS2VVoiceProvider()
        // 默认选择多模态 TTS 模型（2026-08-12）：当模型设置保存了支持 TTS 能力的多模态模型
        // Key（category=multimodal 且 capabilities 含 tts，如 MiniMax）时，语音生成器默认选中它，
        // 其次才回退到普通 TTS 服务商首项；用户显式保存过的选择（configuredProvider / 显式 Edge）
        // 始终优先。多模态候选额外要求 capability_models.tts 存在，避免缺默认 TTS 模型时
        // getS2VDefaultVoiceModel 落到 image/video 模型（fail-closed 回退普通 TTS 首项）。
        const multimodalProvider = nextVoiceProviders.find(
          provider => provider?.category === 'multimodal' && typeof provider?.capability_models?.tts === 'string'
        ) || null
        const explicitEdge = this.s2vVoiceProviderExplicitEdge === true && !this.s2vConfig.voiceProvider
        const nextProviderId = explicitEdge
          ? ''
          : (configuredProvider?.id || multimodalProvider?.id || this.s2vVoiceProviders[0]?.id || '')
        const nextModel = nextProviderId
          ? (this.s2vVoiceModelOptions.includes(this.s2vConfig.voiceModel)
            ? this.s2vConfig.voiceModel
            : this.getS2VDefaultVoiceModel(nextProviderId))
          : ''
        const contextChanged = nextProviderId !== this.s2vConfig.voiceProvider || nextModel !== this.s2vConfig.voiceModel
        this.s2vConfig.voiceProvider = nextProviderId
        this.s2vConfig.voiceModel = nextModel
        if (contextChanged) this.s2vConfig.voiceId = ''
        await this.loadS2VVoiceData()
      }
    },
    async handleS2VVoiceProviderChange() {
      const nextProviderId = this.getS2VVoiceProvider()?.id || ''
      // 记录「显式选择自动 Edge TTS」：空 id 既是未选择也是显式 Edge，需区分以免被多模态默认覆盖
      this.s2vVoiceProviderExplicitEdge = !nextProviderId
      this.s2vConfig.voiceProvider = nextProviderId
      this.s2vConfig.voiceModel = nextProviderId ? this.getS2VDefaultVoiceModel(nextProviderId) : ''
      this.s2vConfig.voiceId = ''
      await this.loadS2VVoiceData()
    },
    async handleS2VVoiceModelChange() {
      const nextModel = this.s2vVoiceModelOptions.includes(this.s2vConfig.voiceModel)
        ? this.s2vConfig.voiceModel
        : this.getS2VDefaultVoiceModel()
      this.s2vConfig.voiceModel = nextModel
      this.s2vConfig.voiceId = ''
      await this.loadS2VVoiceData()
    },
    async handleS2VVoiceSelection() {
      await this.selectS2VVoice(this.s2vConfig.voiceId)
    },
    async selectS2VVoice(voiceId = this.s2vConfig.voiceId) {
      const context = this.getS2VVoiceContext()
      // MiMo TTS：克隆音色的偏好持久化到 voiceclone 模型下（与克隆 registry 同键域）
      const selectContext = this.s2vVoiceModelHidden && typeof voiceId === 'string' && voiceId.startsWith('mimo-clone-')
        ? { providerId: context?.providerId, model: 'mimo-v2.5-tts-voiceclone' }
        : context
      const normalizedVoiceId = typeof voiceId === 'string' ? voiceId.trim() : ''
      if (!selectContext) return false
      if (!normalizedVoiceId) {
        const requestId = ++this.s2vVoiceSelectionRequestId
        const result = await clearTtsVoicePreference(this.cloneForIpc(selectContext))
        if (!this.isCurrentS2VVoiceSelectionRequest(requestId, selectContext, this.s2vConfig.voiceId)) return false
        if (result?.code !== 0) {
          this.s2vVoiceCatalogError = this.friendlyVoiceCatalogError(result?.message) || formatUserError(result, { fallback: '音色目录加载失败' }).message
            ? this.friendlyVoiceCatalogError(result?.message)
            : '音色默认值恢复失败。'
          return false
        }
        const selectedVoiceId = typeof result.data?.selectedVoiceId === 'string' ? result.data.selectedVoiceId : ''
        this.s2vConfig.voiceId = selectedVoiceId
        this.s2vPersistedVoiceId = selectedVoiceId
        this.s2vVoiceCatalogError = ''
        return true
      }
      if (!this.s2vVoiceOptions.some(voice => voice.id === normalizedVoiceId)) {
        this.s2vVoiceCatalogError = '所选音色不在当前目录中。'
        return false
      }
      // 显式选择（下拉或克隆列表「设为默认」）先同步下拉框与配置：
      // 1) 让 isCurrentS2VVoiceSelectionRequest 并发守卫命中本次请求（否则结果被静默丢弃）；
      // 2) 让下拉框与克隆行「默认」徽标立即反映本次选择。
      const previousVoiceId = this.s2vConfig.voiceId
      this.s2vConfig.voiceId = normalizedVoiceId

      const requestId = ++this.s2vVoiceSelectionRequestId
      const result = await selectTtsVoice(this.cloneForIpc({ ...selectContext, voiceId: normalizedVoiceId }))
      if (!this.isCurrentS2VVoiceSelectionRequest(requestId, selectContext, normalizedVoiceId)) return false
      if (result?.code !== 0) {
        // 保存失败：回滚下拉与徽标，避免显示一个从未持久化的「默认」音色
        this.s2vConfig.voiceId = previousVoiceId
        this.s2vVoiceCatalogError = this.friendlyVoiceCatalogError(result?.message) || formatUserError(result, { fallback: '音色目录加载失败' }).message
          ? this.friendlyVoiceCatalogError(result?.message)
          : '音色选择保存失败。'
        return false
      }
      this.s2vPersistedVoiceId = typeof result.data?.selectedVoiceId === 'string'
        ? result.data.selectedVoiceId
        : normalizedVoiceId
      this.s2vVoiceCatalogError = ''
      return true
    },
    async chooseS2VVoiceCloneSamples() {
      const context = this.getS2VVoiceCloneContext()
      const cloneEnabled = this.s2vVoiceCapability?.type === 'user_clone'
        && this.s2vVoiceCapability?.clone?.enabled === true
      if (!context || !cloneEnabled) return

      const requestId = ++this.s2vVoiceCloneRequestId
      this.s2vVoiceCloneLoading = true
      this.s2vVoiceCloneError = ''
      try {
        const result = await chooseTtsVoiceCloneSamples(this.cloneForIpc(context))
        if (!this.isCurrentS2VVoiceCloneRequest(requestId, context)) return
        const selectionId = typeof result?.data?.selectionId === 'string' ? result.data.selectionId : ''
        const sampleCount = Array.isArray(result?.data?.samples) ? result.data.samples.length : 0
        if (result?.code === 0 && selectionId && sampleCount > 0) {
          this.s2vVoiceCloneSelection = { selectionId, sampleCount }
          // 2026-08-12 需求调整：选择本地文件后自动保存为克隆音色（默认名「音色XXX」），
          // 不再需要手动填写名称并点击「添加克隆音色」；如需改名使用列表中的「重命名」。
          // 先释放「选择中」加载态，让 addS2VVoiceClone 进入自己的加载流程。
          if (this.isCurrentS2VVoiceCloneRequest(requestId, context)) this.s2vVoiceCloneLoading = false
          await this.addS2VVoiceClone(this.nextS2VVoiceCloneName())
          return
        }
        this.s2vVoiceCloneSelection = null
        if (result?.code !== 0) this.s2vVoiceCloneError = this.friendlyVoiceCatalogError(result?.message) || '无法选择本地音频样本。'
      } catch (error) {
        // 异常路径硬化（2026-08-13 审查 W1）：IPC 封装层已将 reject 统一转为错误码，此处兜底
        if (this.isCurrentS2VVoiceCloneRequest(requestId, context)) {
          this.s2vVoiceCloneSelection = null
          this.s2vVoiceCloneError = this.friendlyVoiceCatalogError(error?.message) || '无法选择本地音频样本。'
        }
      } finally {
        if (this.isCurrentS2VVoiceCloneRequest(requestId, context)) this.s2vVoiceCloneLoading = false
      }
    },
    nextS2VVoiceCloneName() {
      // 自动克隆默认名「音色XXX」：以「当前克隆数量」与「现有最大音色序号」较大者 +1（3 位零填充）。
      // - 首个克隆为 音色001；按创建顺序递增 音色002/003…，重命名后不回退旧序号；
      // - 用户手动命名为 音色100 后，下一个自动名继续用 音色101。
      // 序号用 BigInt 解析/比较，避免超长数字名（如 128 位）经 Number 转浮点后污染名称。
      const clones = Array.isArray(this.s2vVoiceClones) ? this.s2vVoiceClones : []
      let maxIndex = 0n
      for (const voice of clones) {
        const match = /^音色(\d+)$/.exec(String(voice?.name || '').trim())
        if (match) {
          try {
            const index = BigInt(match[1])
            if (index > maxIndex) maxIndex = index
          } catch (_) { /* 非数字忽略 */ }
        }
      }
      const count = BigInt(clones.length)
      const nextIndex = (count > maxIndex ? count : maxIndex) + 1n
      return '音色' + String(nextIndex).padStart(3, '0')
    },
    async addS2VVoiceClone(name = this.nextS2VVoiceCloneName()) {
      const context = this.getS2VVoiceCloneContext()
      const selectionId = this.s2vVoiceCloneSelection?.selectionId
      const normalizedName = String(name || '').trim()
      if (!context || !selectionId || !normalizedName || this.s2vVoiceCloneLoading) return

      const requestId = ++this.s2vVoiceCloneRequestId
      this.s2vVoiceCloneLoading = true
      this.s2vVoiceCloneError = ''
      // 克隆进行中占位行：选完文件立即反馈「创建中」，避免长时间无响应观感（2026-08-13）
      this.s2vVoiceClonePending = {
        id: 'pending-' + requestId,
        name: normalizedName,
        sampleCount: this.s2vVoiceCloneSelection?.sampleCount || 1,
      }
      try {
        const result = await addTtsVoiceClone(this.cloneForIpc({
          ...context,
          name: normalizedName,
          selectionId,
          consent: true,
        }))
        if (!this.isCurrentS2VVoiceCloneRequest(requestId, context)) return
        const voice = result?.code === 0 ? this.toS2VVoiceOption(result.data?.voice) : null
        if (!voice) {
          // 自动保存失败：一次性选择令牌已被主进程销毁，清除本地快照避免「已选择 N 个样本」误导
          this.s2vVoiceCloneSelection = null
          this.s2vVoiceClonePending = null
          this.s2vVoiceCloneError = this.friendlyVoiceCatalogError(result?.message) || '无法添加克隆音色。'
          return
        }
        this.s2vVoiceClones = [
          ...this.s2vVoiceClones.filter(item => item.id !== voice.id),
          voice,
        ]
        this.s2vVoiceCloneSelection = null
        this.s2vVoiceClonePending = null
        this.s2vConfig.voiceId = voice.id
        await this.selectS2VVoice(voice.id)
        this.showS2VOptionsToast(this.translateWithLocaleFallback(
          'create.story2video.voice.cloneSuccessToast',
          '已添加克隆音色「' + voice.name + '」',
          'Cloned voice "' + voice.name + '" added',
          { name: voice.name },
        ))
      } catch (error) {
        // 异常路径硬化（2026-08-13 审查 W1）：IPC 封装层已将 reject 统一转为错误码，
        // 此处兜底保证未知 reject 也不「占位行凭空消失且无提示」。
        if (this.isCurrentS2VVoiceCloneRequest(requestId, context)) {
          this.s2vVoiceCloneSelection = null
          this.s2vVoiceClonePending = null
          this.s2vVoiceCloneError = this.friendlyVoiceCatalogError(error?.message) || '无法添加克隆音色。'
        }
      } finally {
        if (this.isCurrentS2VVoiceCloneRequest(requestId, context)) {
          this.s2vVoiceCloneLoading = false
          this.s2vVoiceClonePending = null
        }
      }
    },
    s2vVoiceCloneStatusText() {
      const pending = this.s2vVoiceClonePending
      if (!pending) return ''
      const count = Number.isFinite(pending.sampleCount) ? pending.sampleCount : 1
      return this.translateWithLocaleFallback(
        'create.story2video.voice.cloneStatusPending',
        '已选择 ' + count + ' 个样本，正在上传并克隆音色…（通常需要 10~60 秒，请勿重复操作）',
        'Selected ' + count + ' sample(s). Uploading and cloning the voice... (usually 10-60 s, please wait)',
        { count },
      )
    },
    async deleteS2VVoiceClone(voiceId) {
      const context = this.getS2VVoiceCloneContext()
      const normalizedVoiceId = typeof voiceId === 'string' ? voiceId.trim() : ''
      if (!context || !normalizedVoiceId || this.s2vVoiceCloneLoading) return

      const requestId = ++this.s2vVoiceCloneRequestId
      this.s2vVoiceCloneLoading = true
      this.s2vVoiceCloneError = ''
      try {
        // 危险操作门禁（docs/frontend-interaction-spec.md §2）：删除克隆音色不可逆，
        // 确认文案须说明后果并点名受影响音色；取消时直接返回，不调用删除 API。
        const target = this.s2vVoiceClones.find(item => item.id === normalizedVoiceId)
        const voiceName = target?.name || normalizedVoiceId
        const confirmed = await confirmDanger({
          title: this.$t('create.story2video.voice.cloneDeleteConfirmTitle'),
          message: this.$t('create.story2video.voice.cloneDeleteConfirmMessage', { name: voiceName }),
          confirmText: this.$t('create.story2video.voice.cloneDeleteConfirmButton'),
        })
        if (!confirmed) return

        const result = await deleteTtsVoiceClone(this.cloneForIpc({ ...context, voiceId: normalizedVoiceId }))
        if (!this.isCurrentS2VVoiceCloneRequest(requestId, context)) return
        if (result?.code !== 0) {
          this.s2vVoiceCloneError = this.friendlyVoiceCatalogError(result?.message) || '无法删除克隆音色。'
          return
        }
        this.s2vVoiceClones = this.s2vVoiceClones.filter(voice => voice.id !== normalizedVoiceId)
        this.s2vVoiceCatalog = this.s2vVoiceCatalog.filter(voice => voice.id !== normalizedVoiceId)
        if (this.s2vConfig.voiceId === normalizedVoiceId) {
          const fallbackVoiceId = this.s2vVoiceOptions[0]?.id || ''
          this.s2vConfig.voiceId = fallbackVoiceId
          this.s2vPersistedVoiceId = ''
          if (fallbackVoiceId) await this.selectS2VVoice(fallbackVoiceId)
        }
      } finally {
        if (this.isCurrentS2VVoiceCloneRequest(requestId, context)) this.s2vVoiceCloneLoading = false
      }
    },
    startS2VVoiceCloneRename(voiceId) {
      const voice = this.s2vVoiceClones.find(item => item.id === voiceId)
      if (!voice || this.s2vVoiceCloneLoading) return
      this.s2vVoiceCloneRenamingId = voiceId
      this.s2vVoiceCloneRenameDraft = voice.name || ''
      this.s2vVoiceCloneError = ''
    },
    cancelS2VVoiceCloneRename() {
      this.s2vVoiceCloneRenamingId = ''
      this.s2vVoiceCloneRenameDraft = ''
      this.s2vVoiceCloneError = ''
    },
    async renameS2VVoiceClone(voiceId) {
      const context = this.getS2VVoiceCloneContext()
      const normalizedVoiceId = typeof voiceId === 'string' ? voiceId.trim() : ''
      const name = String(this.s2vVoiceCloneRenameDraft || '').trim()
      if (!context || !normalizedVoiceId || !name || this.s2vVoiceCloneLoading) return

      const requestId = ++this.s2vVoiceCloneRequestId
      this.s2vVoiceCloneLoading = true
      this.s2vVoiceCloneError = ''
      try {
        const result = await renameTtsVoiceClone(this.cloneForIpc({ ...context, voiceId: normalizedVoiceId, name }))
        if (!this.isCurrentS2VVoiceCloneRequest(requestId, context)) return
        const voice = result?.code === 0 ? this.toS2VVoiceOption(result.data?.voice) : null
        if (!voice) {
          this.s2vVoiceCloneError = this.friendlyVoiceCatalogError(result?.message) || '无法重命名克隆音色。'
          return
        }
        // 重命名只更新展示名；保留旧条目的 invalid 标记，避免失效克隆在重命名后被误判为可用
        const previous = this.s2vVoiceClones.find(item => item.id === voice.id)
        if (previous?.invalid === true) voice.invalid = true
        this.s2vVoiceClones = this.s2vVoiceClones.map(item => item.id === voice.id ? voice : item)
        this.s2vVoiceCloneRenamingId = ''
        this.s2vVoiceCloneRenameDraft = ''
      } finally {
        if (this.isCurrentS2VVoiceCloneRequest(requestId, context)) this.s2vVoiceCloneLoading = false
      }
    },
    formatS2VVoiceCloneBytes(value) {
      if (!Number.isFinite(value) || value < 0) return '—'
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
      return `${(value / (1024 * 1024)).toFixed(value % (1024 * 1024) === 0 ? 0 : 1)} MB`
    },
    formatS2VVoiceCloneDuration(value) {
      if (!Number.isFinite(value) || value < 0) return '—'
      const seconds = Math.floor(value)
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = seconds % 60
      return minutes > 0 ? `${minutes} 分${remainingSeconds ? ` ${remainingSeconds} 秒` : ''}` : `${seconds} 秒`
    },
    saveCurrentS2VTemplate() {
      const name = String(this.s2vCustomTemplateName || '').trim()
      if (!name) return
      const id = 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
      saveCustomTemplate({
        id,
        name,
        description: '由当前创作参数保存',
        category: 'custom',
        imageEffect: this.s2vConfig.imageEffect,
        transitionEffect: this.s2vConfig.transition,
        size: this.s2vOutputConfig.resolution,
        subtitleStyle: {
          enabled: this.s2vConfig.subtitleEnabled !== false,
          size: this.s2vConfig.subtitleSize || 'size3',
          style: this.s2vConfig.subtitleStyleName || 'style1',
          color: this.s2vConfig.subtitleStyle.color || 'white',
        },
        bgm: this.s2vConfig.bgmPath
          ? { url: '', name: '自定义背景音乐', volume: Math.round(Number(this.s2vConfig.bgmVolume || 0)) }
          : undefined,
      }, window.localStorage)
      this.refreshS2VTemplates()
      this.s2vTemplateCategory = 'custom'
      this.s2vConfig.templateId = id
      this.s2vCustomTemplateName = ''
    },
    deleteSelectedS2VTemplate(templateId = this.selectedS2VTemplate?.id) {
      const template = this.s2vTemplateLibrary.find(item => item.id === templateId)
      if (!template || template.category !== 'custom') return
      deleteCustomTemplate(template.id, window.localStorage)
      if (this.s2vConfig.templateId === template.id) this.s2vConfig.templateId = ''
      this.refreshS2VTemplates()
    },
    requestTemplateDeletion() {
      const template = this.selectedS2VTemplate
      if (!template || template.category !== 'custom') return
      this.story2videoTemplateDeleteDialog = { visible: true, templateId: template.id }
    },
    closeTemplateDeletionDialog() {
      this.story2videoTemplateDeleteDialog = { visible: false, templateId: null }
    },
    confirmTemplateDeletion() {
      const templateId = this.story2videoTemplateDeleteDialog.templateId
      this.closeTemplateDeletionDialog()
      if (templateId) this.deleteSelectedS2VTemplate(templateId)
    },
    enforceStory2VideoTextLimit() {
      if (!this.selectedPipeline || !this.isOrchestratedPipeline(this.selectedPipeline.name)) return
      const characters = Array.from(this.pipelineText)
      if (characters.length <= MAX_STORY2VIDEO_TEXT_CHARACTERS) return
      this.pipelineText = characters.slice(0, MAX_STORY2VIDEO_TEXT_CHARACTERS).join('')
      this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TEXT_TOO_LONG, messageParams: { max: MAX_STORY2VIDEO_TEXT_CHARACTERS } })
    },
    showStory2VideoErrorDialog(notification = {}) {
      const resolved = resolveStory2VideoNotification(notification)
      const detail = notification.messageKey === STORY2VIDEO_NOTIFICATION_KEYS.HISTORY_LOAD_FAILED && typeof notification.detail === 'string'
        ? notification.detail
        : ''
      const rawError = String(notification?.error || notification?.message || '')
      this.story2videoErrorDialog = { visible: true, messageKey: resolved.key, messageParams: resolved.params, detail, rawError }
    },
    closeStory2VideoErrorDialog() {
      this.story2videoErrorDialog.visible = false
    },
    goToModelSettings() {
      this.story2videoErrorDialog.visible = false
      if (this.$router && typeof this.$router.push === 'function') {
        this.$router.push({ name: 'ModelProviders' })
      }
    },
    async resumeStory2Video() {
      const runId = this.orchestrationRunId
      if (!runId || this.story2videoResuming) return
      const actionRequestId = ++this.orchestrationActionRequestId
      this.story2videoResuming = true
      try {
        const res = await pipelineResumeOrchestration(runId)
        if (!this.isCurrentOrchestrationAction(runId, actionRequestId)) return
        const returnedRunId = typeof res?.data?.runId === 'string' ? res.data.runId.trim() : ''
        if (res?.code === 0 && res.data?.success && returnedRunId && returnedRunId !== runId) return
        if (res?.code === 0 && res.data?.success && returnedRunId) {
          this.orchestrationRunId = returnedRunId
          this.orchestrationContext = null
          this.orchestrationContextRunId = null
          this.orchestrationResultPath = null
          this.orchestrationError = ''
          this.closeStory2VideoErrorDialog()
          this.story2videoRunMeta = createPipelineRunMetaFromSnapshot(res.data)
          this.pipelineRunStatus = { status: 'running', progress: 0, stages: this.orchestrationStages }
          this.showS2VOptionsToast(this.translateWithLocaleFallback('create.story2video.resumeUsesCurrentModels', '已从断点继续，将使用当前默认的图片 / 语音 / 视频模型生成缺失素材。', 'Resumed from breakpoint. Missing assets will be generated with your current default image / voice / video models.'), 3200)
          await this.updateOrchestrationStatus()
          if (this.orchestrationRunId && !this.pollTimer) {
            this.pollTimer = setInterval(() => this.updateOrchestrationStatus(), 3000)
          }
        } else {
          this.showStory2VideoErrorDialog({
            errorCode: res?.data?.errorCode || res?.code,
            error: res?.data?.error || res?.message || '断点恢复失败，请稍后再试。',
          })
        }
      } finally {
        if (this.isCurrentOrchestrationAction(runId, actionRequestId)) this.story2videoResuming = false
      }
    },
    // 历史记录删除分流（2026-08-16）：有 projectId 的成片任务走项目删除；纯流水线运行记录走 delete-run
    requestHistoryDeletion(item) {
      if (!item) return
      if (item.projectId) {
        this.story2videoProjectDeleteDialog = { visible: true, projectId: item.projectId }
        return
      }
      const runId = item.id || item.runId
      if (!runId) return
      this.story2videoRunDeleteDialog = { visible: true, runId }
    },
    requestProjectDeletion(item) {
      if (!item?.projectId) return
      this.story2videoProjectDeleteDialog = { visible: true, projectId: item.projectId }
    },
    closeProjectDeletionDialog() {
      this.story2videoProjectDeleteDialog = { visible: false, projectId: null }
    },
    closeRunDeletionDialog() {
      this.story2videoRunDeleteDialog = { visible: false, runId: null }
    },
    async confirmRunDeletion() {
      const runId = this.story2videoRunDeleteDialog.runId
      this.closeRunDeletionDialog()
      if (!runId) return
      try {
        const result = await pipelineDeleteRun(runId)
        if (result?.code === 0) {
          this.history = this.history.filter(entry => (entry.id || entry.runId) !== runId)
        } else {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.RUN_DELETE_FAILED, error: result?.message })
        }
      } catch (error) {
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.RUN_DELETE_FAILED, error: error?.message })
      }
    },
    async confirmProjectDeletion() {
      const projectId = this.story2videoProjectDeleteDialog.projectId
      this.closeProjectDeletionDialog()
      if (projectId) await this.deleteHistory({ projectId })
    },
    requestHistoryBatchDeletion(items) {
      if (!Array.isArray(items) || items.length === 0) return
      this.story2videoBatchDeleteDialog = { visible: true, items: items.slice() }
    },
    closeBatchDeletionDialog() {
      this.story2videoBatchDeleteDialog = { visible: false, items: [] }
    },
    async confirmBatchDeletion() {
      if (this.deleting) return
      const items = this.story2videoBatchDeleteDialog.items
      if (!items || items.length === 0) return
      this.deleting = true
      let success = 0
      let failed = 0
      const succeededProjectIds = new Set()
      const succeededRunIds = new Set()
      try {
        const results = await Promise.allSettled(
          items.map(async (item) => {
            if (item.projectId) {
              const result = await story2videoDeleteProject(item.projectId)
              return { item, api: 'project', result }
            } else {
              const runId = item.id || item.runId
              if (!runId) throw new Error('missing runId')
              const result = await pipelineDeleteRun(runId)
              return { item, api: 'run', result, runId }
            }
          }),
        )
        for (const entry of results) {
          if (entry.status === 'rejected') {
            failed++
            continue
          }
          const { item, api, result, runId } = entry.value
          if (result?.code === 0) {
            success++
            if (api === 'project' && item.projectId) {
              succeededProjectIds.add(item.projectId)
            } else if (api === 'run' && runId) {
              succeededRunIds.add(runId)
            }
          } else {
            failed++
          }
        }
        if (succeededProjectIds.size > 0 || succeededRunIds.size > 0) {
          this.history = this.history.filter((entry) => {
            if (entry.projectId) return !succeededProjectIds.has(entry.projectId)
            const runId = entry.id || entry.runId
            return !(runId && succeededRunIds.has(runId))
          })
        }
        this.closeBatchDeletionDialog()
        if (failed === 0) {
          this.showS2VOptionsToast(
            formatStory2VideoNotification({
              messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_SUCCESS,
              messageParams: { count: success },
            }).message,
          )
        } else if (success === 0) {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_FAILED })
        } else {
          this.showS2VOptionsToast(
            formatStory2VideoNotification({
              messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_PARTIAL,
              messageParams: { success, failed },
            }).message,
          )
        }
      } catch (_error) {
        this.closeBatchDeletionDialog()
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_FAILED })
      } finally {
        this.deleting = false
      }
    },
    setOrchestrationError(notification, statusSnapshot = null) {
      this.orchestrationError = ''
      this.showStory2VideoErrorDialog(notification)
      this.stopPipelinePolling()
      this.closePipelineProgressModal()
      this.needsCheckpoint = false
      this.sceneAssetSelectionActive = false
      this.sceneAssetCandidates = []
      if (this.pipelineRunStatus?.status !== 'completed') {
        const snapshot = statusSnapshot && typeof statusSnapshot === 'object' && !Array.isArray(statusSnapshot)
          ? statusSnapshot
          : {}
        this.pipelineRunStatus = {
          ...(this.pipelineRunStatus || {}),
          ...snapshot,
          status: 'failed',
          progress: snapshot.progress ?? this.pipelineRunStatus?.progress ?? 0,
          stages: Array.isArray(snapshot.stages)
            ? snapshot.stages
            : (this.pipelineRunStatus?.stages || this.orchestrationStages),
        }
      }
    },
    isCurrentOrchestrationStart(requestId) {
      return requestId === this.orchestrationStartRequestId && this._s2vAlive !== false && this.view === 'pipelines'
    },
    isCurrentOrchestrationAction(runId, actionRequestId) {
      return Boolean(
        runId
        && runId === this.orchestrationRunId
        && actionRequestId === this.orchestrationActionRequestId
        && this._s2vAlive !== false
        && this.view === 'pipelines'
      )
    },
    syncPipelineCheckpointState(snapshot, context = this.orchestrationContext) {
      const status = snapshot && typeof snapshot === 'object' ? snapshot : this.pipelineRunStatus
      const checkpoint = status?.checkpoint && typeof status.checkpoint === 'object' ? status.checkpoint : null
      const checkpointType = String(checkpoint?.type || '').trim().toLowerCase()
      const checkpointReason = String(checkpoint?.reason || '').trim().toLowerCase()
      const selectionCheckpoint = checkpointType === 'scene_asset_selection' || checkpointReason === 'scene_asset_selection'
      this.sceneAssetSelectionActive = Boolean(selectionCheckpoint)
      if (selectionCheckpoint) {
        const snapshotContext = status?.context && typeof status.context === 'object' && !Array.isArray(status.context)
          ? status.context
          : (status?.status?.context && typeof status.status.context === 'object' && !Array.isArray(status.status.context) ? status.status.context : null)
        const candidateContext = [context, snapshotContext].find(value =>
          value && typeof value === 'object' && !Array.isArray(value)
          && Array.isArray(value.generate_assets?.candidates)
        )
        const manifest = candidateContext?.generate_assets
        this.sceneAssetCandidates = Array.isArray(manifest?.candidates) ? manifest.candidates : []
        this.sceneAssetSelectionError = ''
      } else {
        this.sceneAssetCandidates = []
        this.sceneAssetSelectionError = ''
      }
      this.needsCheckpoint = hasManualPipelineCheckpoint(status, false, context)
      return this.needsCheckpoint
    },
    setPipelineProgressStatusError() {
      this.pipelineProgressStatusError = this.translateWithLocaleFallback(
        'create.story2video.progressStatusUnavailable',
        '进度暂时不可用，任务仍在运行，系统将继续重试。',
        'Progress is temporarily unavailable. The task is still running and will be retried.',
      )
      if (this.pipelineRunStatus && this.selectedPipeline && !PIPELINE_TERMINAL_STATUSES.includes(this.pipelineRunStatus.status)) {
        this.openPipelineProgressModal()
      }
    },
    clearPipelineProgressStatusError() {
      this.pipelineProgressStatusError = ''
    },
    async updateOrchestrationStatus() {
      if (!this.orchestrationRunId) return { ok: false, reason: 'missing-run-id' }
      // runId 快照守卫（2026-08-13，后台运行审查 Critical 1）：detach/取消/切换 run 后，
      // 在飞的 pipelineGetRunContext 过期响应不得写回状态或触发跳转，防止僵尸重挂/污染新 run。
      const runId = this.orchestrationRunId
      const requestId = ++this.orchestrationStatusRequestId
      try {
        const statusResult = await pipelineGetRunContext(runId)
        if (this.orchestrationRunId !== runId || this.orchestrationStatusRequestId !== requestId) return { ok: false, stale: true }
        // 组件已卸载（离开页面/路由切换）时丢弃在飞响应，主进程 run 不受影响
        if (this._s2vAlive === false) return { ok: false, stale: true }
        if (statusResult?.code !== 0) {
          this.setPipelineProgressStatusError()
          return { ok: false, reason: 'request-failed' }
        }
        if (!statusResult.data) {
          this.setPipelineProgressStatusError()
          return { ok: false, reason: 'missing-data' }
        }
        const returnedRunId = statusResult.data.runId || statusResult.data.id
        if (typeof returnedRunId === 'string' && returnedRunId.trim() && returnedRunId.trim() !== runId) {
          this.setPipelineProgressStatusError()
          return { ok: false, reason: 'run-id-mismatch' }
        }
        const fallbackContext = this.orchestrationContextRunId === runId
          ? this.orchestrationContext
          : null
        const contextResult = normalizePipelineContext(statusResult.data, fallbackContext)
        const metaResult = normalizePipelineRunMeta(statusResult.data)
        if (!contextResult.valid || !metaResult.valid) {
          this.setPipelineProgressStatusError()
          return { ok: false, reason: 'invalid-data' }
        }
        const snapshotStatus = statusResult.data.status
        if (!snapshotStatus || typeof snapshotStatus !== 'object' || Array.isArray(snapshotStatus)) {
          this.setPipelineProgressStatusError()
          return { ok: false, reason: 'invalid-status' }
        }
        const stages = Array.isArray(statusResult.data.stages)
          ? statusResult.data.stages
          : (Array.isArray(snapshotStatus.stages) ? snapshotStatus.stages : (this.orchestrationStages.length ? this.orchestrationStages : this.getDefaultStory2VideoStages()))
        const checkpoint = Object.prototype.hasOwnProperty.call(statusResult.data, 'checkpoint')
          ? statusResult.data.checkpoint
          : (Object.prototype.hasOwnProperty.call(snapshotStatus, 'checkpoint') ? snapshotStatus.checkpoint : this.pipelineRunStatus?.checkpoint)
        const normalized = normalizePipelineStatusSnapshot({
          ...snapshotStatus,
          currentStage: statusResult.data.currentStage ?? snapshotStatus.currentStage,
          stages,
          checkpoint,
        }, this.orchestrationStages)
        if (!normalized) {
          this.setPipelineProgressStatusError()
          return { ok: false, reason: 'invalid-status' }
        }
        const hasProviderWarnings = Object.prototype.hasOwnProperty.call(statusResult.data, 'providerWarnings')
          || Object.prototype.hasOwnProperty.call(snapshotStatus, 'providerWarnings')
        const providerWarnings = Object.prototype.hasOwnProperty.call(statusResult.data, 'providerWarnings')
          ? statusResult.data.providerWarnings
          : snapshotStatus.providerWarnings
        // Full polling snapshots are authoritative: an omitted warning list means
        // the previous run warning is no longer active. Progress-only pushes use a
        // separate path and intentionally preserve warnings when the field is absent.
        this.providerWarnings = hasProviderWarnings && Array.isArray(providerWarnings)
          ? providerWarnings.filter(item => item && typeof item === 'object' && !Array.isArray(item))
          : []
        const mergedStages = mergePipelineStages(this.orchestrationStages, normalized.stages)
        if (normalized.status === 'completed' && !contextResult.value) {
          // A completed status without this run's final context is not enough to
          // select a result file. Keep the last valid foreground snapshot and
          // retry instead of treating an older run's context as this run's result.
          this.orchestrationStages = mergedStages
          this.pipelineRunStatus = {
            ...(this.pipelineRunStatus || {}),
            progress: normalized.progress ?? this.pipelineRunStatus?.progress ?? 0,
            stages: mergedStages,
            checkpoint: normalized.checkpoint,
            status: this.pipelineRunStatus?.status && !PIPELINE_TERMINAL_STATUSES.includes(this.pipelineRunStatus.status)
              ? this.pipelineRunStatus.status
              : 'running',
          }
          this.setPipelineProgressStatusError()
          this.syncPipelineCheckpointState(this.pipelineRunStatus, fallbackContext)
          this.openPipelineProgressModal()
          this.restartOrchestrationPolling()
          return { ok: false, reason: 'missing-terminal-context' }
        }
        this.clearPipelineProgressStatusError()
        if (contextResult.provided || this.orchestrationContextRunId !== runId) {
          this.orchestrationContext = contextResult.value
          this.orchestrationContextRunId = runId
        }
        this.story2videoRunMeta = mergePipelineRunMeta(this.story2videoRunMeta, metaResult)
        this.orchestrationStages = mergedStages
        normalized.stages = this.orchestrationStages
        this.pipelineRunStatus = normalized
        this.syncPipelineCheckpointState(normalized, this.orchestrationContext)
        if (PIPELINE_END_STATUSES.includes(normalized.status)) {
          this.applyOrchestrationTerminalStatus(normalized.status, {
            ...statusResult.data,
            status: normalized,
            context: contextResult.provided ? contextResult.value : null,
            error: statusResult.data.error || normalized.error,
            stages: normalized.stages,
          })
        } else {
          this.openPipelineProgressModal()
        }
        return { ok: true, status: normalized.status, terminal: PIPELINE_END_STATUSES.includes(normalized.status) }
      } catch (_error) {
        if (this._s2vAlive === false || this.orchestrationRunId !== runId || this.orchestrationStatusRequestId !== requestId) return { ok: false, stale: true }
        this.setPipelineProgressStatusError()
        return { ok: false, reason: 'exception' }
      }
    },
    async advanceOrchestration() {
      const runId = this.orchestrationRunId
      if (!runId) return
      const actionRequestId = ++this.orchestrationActionRequestId
      const res = await pipelineAdvanceToNextCheckpoint(runId)
      if (!this.isCurrentOrchestrationAction(runId, actionRequestId)) return
      const returnedRunId = res?.data?.runId || res?.data?.id
      if (typeof returnedRunId === 'string' && returnedRunId.trim() && returnedRunId.trim() !== runId) return
      if (res?.code === 0 && res.data?.success !== false) {
        if (!this.applyOrchestrationOutcome(res.data || {}, runId, actionRequestId) && this.isCurrentOrchestrationAction(runId, actionRequestId)) await this.updateOrchestrationStatus()
      }
      else { this.setOrchestrationError({ code: res?.code, error: res?.message || res?.data?.error }) }
    },
    // 分镜素材自选：确认全部场景素材选择并推进（finalize_assets → compose → publish）
    async confirmSceneAssetSelections(selections) {
      const runId = this.orchestrationRunId
      if (!runId || this.sceneAssetConfirming) return
      const actionRequestId = ++this.orchestrationActionRequestId
      this.sceneAssetConfirming = true
      this.sceneAssetSelectionError = ''
      try {
        const res = await pipelineConfirmSceneAssets(runId, this.cloneForIpc(selections))
        if (!this.isCurrentOrchestrationAction(runId, actionRequestId)) return
        const returnedRunId = res?.data?.runId || res?.data?.id
        if (typeof returnedRunId === 'string' && returnedRunId.trim() && returnedRunId.trim() !== runId) return
        if (res?.code === 0 && res.data?.success !== false) {
          this.sceneAssetSelectionActive = false
          this.sceneAssetCandidates = []
          // P0 反馈管道：采纳事件埋点（feature flag 开启且 API 存在时生效，缺失静默跳过）
          this.reportEvolutionFeedback({ type: 'accepted', detail: { mode: 'scene-asset-selection', runId } })
          if (!this.applyOrchestrationOutcome(res.data || {}, runId, actionRequestId) && this.isCurrentOrchestrationAction(runId, actionRequestId)) await this.updateOrchestrationStatus()
        } else {
          this.sceneAssetSelectionError = res?.data?.error || res?.message ||
            this.translateWithLocaleFallback('story2video.sceneAssetSelection.confirmError', '素材选择提交失败，请重试。', 'Failed to submit asset selection. Please try again.')
        }
      } catch (_) {
        if (this.isCurrentOrchestrationAction(runId, actionRequestId)) {
          this.sceneAssetSelectionError = this.translateWithLocaleFallback('story2video.sceneAssetSelection.confirmError', '素材选择提交失败，请重试。', 'Failed to submit asset selection. Please try again.')
        }
      } finally {
        if (this.isCurrentOrchestrationAction(runId, actionRequestId)) this.sceneAssetConfirming = false
      }
    },
    // P0 反馈管道：向主进程上报用户操作反馈（采纳/重新生成/编辑/下载）
    // feature flag（MP_EVOLUTION_ENABLED）与 preload API 均由主进程侧控制；
    // API 缺失（旧 preload / 浏览器 dev 环境）时静默跳过，绝不抛出。
    async reportEvolutionFeedback(payload) {
      try {
        const api = getApi()
        if (!api || typeof api.generationFeedback !== 'function') return
        const body = {
          type: payload?.type,
          detail: payload?.detail,
        }
        const sessionId = this.orchestrationRunId || this.pipelineRunStatus?.runId || null
        if (sessionId) body.sessionId = sessionId
        await api.generationFeedback(body)
      } catch (_) {
        // 埋点失败不影响用户操作
      }
    },
    extractOrchestrationVideoPath(context) {
      const publish = context?.publish?.data || context?.publish
      const compose = context?.compose?.data || context?.compose
      const clipExport = context?.export?.data || context?.export
      const cinematicRender = context?.render?.data || context?.render
      const smokeReport = context?.report?.data || context?.report
      return publish?.videoPath || publish?.path || compose?.videoPath || compose?.path ||
        clipExport?.videoPath || clipExport?.path ||
        cinematicRender?.videoPath || cinematicRender?.path ||
        smokeReport?.videoPath || smokeReport?.path || null
    },
    applyOrchestrationOutcome(outcome, expectedRunId = null, expectedActionRequestId = null) {
      // 卸载后残留响应不得写状态或触发跳转（2026-08-21 unmount 竞态守卫）
      if (this._s2vAlive === false) return false
      const runId = this.orchestrationRunId
      if (expectedRunId && !this.isCurrentOrchestrationAction(expectedRunId, expectedActionRequestId ?? this.orchestrationActionRequestId)) return false
      const outcomeRunId = typeof outcome?.runId === 'string' ? outcome.runId.trim() : ''
      if (outcomeRunId && ((expectedRunId && outcomeRunId !== expectedRunId) || (!expectedRunId && runId && outcomeRunId !== runId))) return false
      if (Array.isArray(outcome?.stages)) this.orchestrationStages = mergePipelineStages(this.orchestrationStages, normalizePipelineStages(outcome.stages))
      const hasOutcomeContext = Object.prototype.hasOwnProperty.call(outcome || {}, 'context')
      const outcomeContext = hasOutcomeContext && outcome.context && typeof outcome.context === 'object' && !Array.isArray(outcome.context)
        ? outcome.context
        : null
      if (hasOutcomeContext) {
        this.orchestrationContext = outcomeContext
        this.orchestrationContextRunId = outcomeContext ? runId : null
      }
      // 检查点确认/单步执行返回的终态 activeMs 优先于轮询缓存，避免结果页时长偏短（W2 审查闭环）
      if (outcome && outcome.activeMs !== null && outcome.activeMs !== undefined && Number.isFinite(Number(outcome.activeMs)) && Number(outcome.activeMs) >= 0) {
        this.story2videoRunMeta = {
          ...(this.story2videoRunMeta || {}),
          activeMs: Number(outcome.activeMs),
          activeSegmentStartedAt: null,
        }
      }
      if (outcome?.paused) {
        this.pipelineRunStatus = { status: 'paused', progress: this.pipelineRunStatus?.progress || 0 }
        this.needsCheckpoint = false
      }
      if (outcome?.success === false) {
        this.setOrchestrationError({ errorCode: outcome.errorCode, errorParams: outcome.errorParams, error: outcome.error }, outcome.status)
        return true
      }
      if (!outcome?.completed) return false
      const context = outcomeContext || (this.orchestrationContextRunId === runId ? this.orchestrationContext : null)
      if (!context) {
        this.pipelineRunStatus = {
          ...(this.pipelineRunStatus || {}),
          status: 'running',
          progress: normalizeProgressPercent(outcome.progress, this.pipelineRunStatus?.progress ?? 0),
          stages: this.orchestrationStages,
        }
        this.setPipelineProgressStatusError()
        this.openPipelineProgressModal()
        return false
      }
      const videoPath = this.extractOrchestrationVideoPath(context)
      const projectId = context?.story2videoProject?.projectId || null
      this.stopPipelinePolling()
      this.closePipelineProgressModal()
      this.pipelineRunStatus = {
        ...(this.pipelineRunStatus || {}),
        status: 'completed',
        progress: 100,
        stages: this.orchestrationStages,
      }
      this.needsCheckpoint = false
      this.orchestrationRunId = null
      if (!videoPath) {
        this.setOrchestrationError({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PREVIEW_MISSING })
        return true
      }
      if (this.orchestrationResultPath === videoPath) return true
      this.orchestrationResultPath = videoPath
      const meta = this.story2videoRunMeta || {}
      const query = { path: videoPath }
      if (projectId) query.project = projectId
      if (runId) query.runId = runId
      // 新口径：结果页时长 = 步骤执行耗时累计，不含暂停/断点恢复空闲时间
      // 存在性守卫：显式排除 null/undefined（Number(null)===0 陷阱）
      if (meta.activeMs !== null && meta.activeMs !== undefined && Number.isFinite(Number(meta.activeMs)) && Number(meta.activeMs) >= 0) {
        query.durationMs = Number(meta.activeMs)
      } else if (meta.createdAt && meta.endedAt) {
        const start = Date.parse(meta.createdAt)
        const end = Date.parse(meta.endedAt)
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) query.durationMs = end - start
      }
      if (Number.isFinite(Number(meta.outputSizeBytes)) && Number(meta.outputSizeBytes) > 0) query.sizeBytes = Number(meta.outputSizeBytes)
      // BGM 跳过信息透传到结果页（结果页展示同一 i18n 提示，避免「完成即跳转」时提示不可见）
      const composeOut = (context.compose && context.compose.data) || context.compose || null
      if (composeOut && composeOut.bgmSkipped === true) {
        query.bgmSkipped = '1'
        if (composeOut.bgmSkippedReason) query.bgmReason = composeOut.bgmSkippedReason
      }
      this.$router.push({ path: '/create/result', query })
      return true
    },
    applyOrchestrationTerminalStatus(status, snapshot = {}) {
      if (this._s2vAlive === false) return true
      if (status === 'idle') {
        this.stopPipelinePolling()
        this.closePipelineProgressModal()
        return true
      }
      if (status === 'completed') {
        const runId = this.orchestrationRunId
        const snapshotContext = snapshot.context && typeof snapshot.context === 'object' && !Array.isArray(snapshot.context)
          ? snapshot.context
          : null
        const context = snapshotContext || (this.orchestrationContextRunId === runId ? this.orchestrationContext : null)
        if (!context) {
          this.setPipelineProgressStatusError()
          this.openPipelineProgressModal()
          this.restartOrchestrationPolling()
          return false
        }
        this.stopPipelinePolling()
        return this.applyOrchestrationOutcome({
          ...snapshot,
          completed: true,
          success: true,
          context,
          stages: this.pipelineRunStatus?.stages || this.orchestrationStages,
        })
      }
      if (status === 'cancelled') {
        this.stopPipelinePolling()
        this.closePipelineProgressModal()
        this.pipelineRunStatus = {
          ...(this.pipelineRunStatus || {}),
          ...(snapshot.status || {}),
          status: 'cancelled',
          stages: Array.isArray(snapshot.stages)
            ? snapshot.stages
            : (this.pipelineRunStatus?.stages || this.orchestrationStages),
        }
        this.needsCheckpoint = false
        this.orchestrationRunId = null
        this.orchestrationContext = null
        this.orchestrationContextRunId = null
        return true
      }
      this.stopPipelinePolling()
      this.setOrchestrationError({ errorCode: snapshot.errorCode, error: snapshot.error || snapshot.status?.error }, snapshot.status)
      return true
    },
    stopPipelinePolling() {
      this.orchestrationStatusRequestId += 1
      this.pipelineStatusRequestId += 1
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
    },
    // 实时推送事件处理（openspec pipeline-progress-real-time-push）：
    // 事件 payload 为轻量快照（progressOnly，不含 context）——只更新阶段进度/状态与 run 级 progress，
    // 不覆盖完整 context（轮询 getRunContext 全量快照为准，避免事件与轮询竞态回退）。
    handlePipelinePush(snapshot) {
      if (this._s2vAlive === false || this.view !== 'pipelines' || !snapshot || typeof snapshot !== 'object' || !snapshot.runId) return
      if (!this.orchestrationRunId || snapshot.runId !== this.orchestrationRunId) return
      if (!snapshot.status || typeof snapshot.status !== 'object' || Array.isArray(snapshot.status)) return
      const prevStatus = (this.pipelineRunStatus && typeof this.pipelineRunStatus === 'object') ? this.pipelineRunStatus : {}
      const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
      const incomingStages = hasOwn(snapshot, 'stages')
        ? snapshot.stages
        : (hasOwn(snapshot.status, 'stages') ? snapshot.status.stages : prevStatus.stages)
      const checkpoint = hasOwn(snapshot, 'checkpoint')
        ? snapshot.checkpoint
        : (hasOwn(snapshot.status, 'checkpoint') ? snapshot.status.checkpoint : prevStatus.checkpoint)
      const normalized = normalizePipelineStatusSnapshot({
        ...prevStatus,
        ...snapshot.status,
        stages: incomingStages,
        checkpoint,
      }, this.orchestrationStages)
      if (!normalized) return
      this.orchestrationStages = mergePipelineStages(this.orchestrationStages, normalized.stages)
      normalized.stages = this.orchestrationStages
      this.pipelineRunStatus = normalized
      const hasProviderWarnings = hasOwn(snapshot, 'providerWarnings') || hasOwn(snapshot.status, 'providerWarnings')
      if (hasProviderWarnings) {
        const warnings = hasOwn(snapshot, 'providerWarnings') ? snapshot.providerWarnings : snapshot.status.providerWarnings
        this.providerWarnings = Array.isArray(warnings)
          ? warnings.filter(item => item && typeof item === 'object' && !Array.isArray(item))
          : []
      }
      const contextSource = hasOwn(snapshot, 'context') ? snapshot : (hasOwn(snapshot.status, 'context') ? snapshot.status : null)
      const contextResult = contextSource
        ? normalizePipelineContext(contextSource, this.orchestrationContextRunId === snapshot.runId ? this.orchestrationContext : null)
        : { valid: true, value: this.orchestrationContextRunId === snapshot.runId ? this.orchestrationContext : null, provided: false }
      if (!contextResult.valid) return
      if (contextResult.provided) {
        this.orchestrationContext = contextResult.value
        this.orchestrationContextRunId = contextResult.value ? snapshot.runId : null
      }
      if (PIPELINE_END_STATUSES.includes(normalized.status)) {
        // 推送事件通常是 progressOnly 快照，终态可能缺少最终 context/videoPath。
        // 有完整 context 时可直接收尾；否则先拉取一次全量 run context，禁止用残缺事件跳转结果页。
        // 终态收尾只信任本次快照携带的 context；缓存 context 可能来自旧进度，不能用来产出结果页。
        const eventContext = contextResult.provided ? contextResult.value : null
        if (eventContext) {
          const metaResult = normalizePipelineRunMeta(snapshot)
          if (metaResult.valid) this.story2videoRunMeta = mergePipelineRunMeta(this.story2videoRunMeta, metaResult)
          this.applyOrchestrationTerminalStatus(normalized.status, {
            ...snapshot,
            status: normalized,
            context: eventContext,
            stages: normalized.stages,
            error: snapshot.error || normalized.error,
          })
        } else {
          void this.updateOrchestrationStatus()
        }
        return
      }
      this.clearPipelineProgressStatusError()
      this.syncPipelineCheckpointState(normalized, this.orchestrationContext)
      this.openPipelineProgressModal()
      // 检测内容安全改写重试进行中：某张图片被判定敏感后程序自动改写提示词重试。
      // 通过 stage.progress.messageKey 识别（实时推送为 progressOnly 快照，不含 context），
      // 触发一次底部非弹窗 toast 提示，避免重复弹。
      this.maybeNotifyContentPolicyRewrite(normalized.stages)
      // 事件到达说明 run 活跃：重置 3s 轮询计时，压缩事件+轮询双写竞态窗口
      this.restartOrchestrationPolling()
    },
    maybeNotifyContentPolicyRewrite(stages) {
      const rewriting = Array.isArray(stages) && stages.some(stage =>
        stage && stage.progress && stage.progress.messageKey === 'stageProgress.assetsImageRewriting')
      if (!rewriting) return
      if (this.s2vContentRewriteToastShown) return
      this.s2vContentRewriteToastShown = true
      this.showS2VOptionsToast(this.$t('create.story2video.contentPolicyRewriteToast'), 3200)
    },
    restartOrchestrationPolling() {
      if (!this.orchestrationRunId || this._s2vAlive === false) return
      this.stopPipelinePolling()
      this.pollTimer = setInterval(() => this.updateOrchestrationStatus(), 3000)
    },
    async updatePipelineStatus() {
      const pipelineName = this.selectedPipeline?.name
      if (!pipelineName || this._s2vAlive === false || !this.pipelineRunId) return { ok: false, reason: 'missing-run-id' }
      const requestRunId = this.pipelineRunId
      const requestId = ++this.pipelineStatusRequestId
      try {
        const s = await pipelineStatus(pipelineName)
        if (
          this._s2vAlive === false
          || this.selectedPipeline?.name !== pipelineName
          || this.pipelineRunId !== requestRunId
          || this.pipelineStatusRequestId !== requestId
        ) return
        if (s?.code !== 0 || !s.data) {
          this.setPipelineProgressStatusError()
          return
        }
        const returnedRunId = typeof s.data.runId === 'string'
          ? s.data.runId.trim()
          : (typeof s.data.id === 'string' ? s.data.id.trim() : '')
        if (!returnedRunId || returnedRunId !== requestRunId) {
          this.setPipelineProgressStatusError()
          return { ok: false, reason: 'run-id-mismatch' }
        }
        const normalized = normalizePipelineStatusSnapshot(s.data, this.pipelineRunStatus?.stages || this.orchestrationStages)
        if (!normalized) {
          this.setPipelineProgressStatusError()
          return
        }
        this.clearPipelineProgressStatusError()
        normalized.runId = requestRunId
        this.pipelineRunStatus = normalized
        this.syncPipelineCheckpointState(normalized, null)
        if (PIPELINE_TERMINAL_STATUSES.includes(normalized.status)) {
          this.stopPipelinePolling()
          this.closePipelineProgressModal()
          return
        }
        this.openPipelineProgressModal()
      } catch (_error) {
        if (this._s2vAlive === false || this.selectedPipeline?.name !== pipelineName || this.pipelineRunId !== requestRunId || this.pipelineStatusRequestId !== requestId) return
        this.setPipelineProgressStatusError()
      }
    },
    async pausePipeline() { await pipelinePause(); await this.updatePipelineStatus() },
    // 编排流水线手动暂停（2026-08-16 UX 统一）：保存暂停点，历史记录「已暂停」可断点续跑
    async pauseOrchestrationPipeline() {
      const runId = this.orchestrationRunId
      if (!runId || this.pauseActionBusy) return
      const actionRequestId = ++this.orchestrationActionRequestId
      this.pauseActionBusy = true
      try {
        const result = await pipelinePauseRun(runId)
        if (!this.isCurrentOrchestrationAction(runId, actionRequestId)) return
        if (result?.code !== 0) {
          this.showStory2VideoErrorDialog({ errorCode: result?.errorCode, error: result?.message })
        }
        if (this.isCurrentOrchestrationAction(runId, actionRequestId)) await this.updateOrchestrationStatus()
      } catch (error) {
        if (this.isCurrentOrchestrationAction(runId, actionRequestId)) {
          this.showStory2VideoErrorDialog({ errorCode: error?.code || error?.errorCode, error: error?.message })
        }
      } finally {
        if (this.isCurrentOrchestrationAction(runId, actionRequestId)) this.pauseActionBusy = false
      }
    },
    async resumePipeline() { await pipelineResume(); await this.updatePipelineStatus() },
    dismissBgmSkippedNotice() {
      this.dismissedBgmSkippedNotice = true
    },
    dismissProviderWarnings() {
      this.dismissedProviderWarnings = true
    },
    // 运行态 UI 重置（取消/自动后台共用）：仅清理前端轮询与展示状态，不执行引擎操作。
    resetPipelineUiState() {
      this.orchestrationStartRequestId += 1
      this.orchestrationActionRequestId += 1
      this.pipelineStatusRequestId += 1
      this.stopPipelinePolling()
      this.closePipelineProgressModal()
      this.pipelineRunStatus = null; this.needsCheckpoint = false
      this.pipelineRunId = null
      this.pipelineProgressStatusError = ''
      this.orchestrationRunId = null; this.orchestrationContext = null; this.orchestrationContextRunId = null; this.orchestrationError = ''; this.providerWarnings = []
      this.startingPipeline = false
      this.pauseActionBusy = false
      this.story2videoResuming = false
      this.dismissedProviderWarnings = false
      this.orchestrationResultPath = null
      this.story2videoRunMeta = null
      this.sceneAssetSelectionActive = false; this.sceneAssetCandidates = []; this.sceneAssetSelectionError = ''; this.sceneAssetConfirming = false
      this.selectionGuided = false; this.sceneAssetAttention = false; this.cancelConfirmDialog.visible = false
      this.dismissedBgmSkippedNotice = false
      this.orchestrationStages = (this.isAutoPipeline(this.selectedPipeline?.name) || this.isMediaAutoPipeline(this.selectedPipeline?.name)) ? this.getDefaultPipelineStages(this.selectedPipeline?.name) : []
      this.closeStory2VideoErrorDialog()
    },
    async cancelPipeline() {
      await pipelineCancel()
      this.resetPipelineUiState()
    },
    isPipelineManualCheckpoint() {
      if (this.sceneAssetSelectionActive) return true
      // 保护显式 checkpoint、等待用户状态，以及带 checkpoint 语义的旧暂停阶段；
      // 普通手动暂停（没有这些证据）仍可按用户意图转入后台。
      return hasManualPipelineCheckpoint(this.pipelineRunStatus, this.needsCheckpoint, this.orchestrationContext)
    },
    openPipelineProgressModal() {
      if (this._s2vAlive === false || !this.selectedPipeline || !this.pipelineRunStatus) return false
      const status = this.pipelineRunStatus.status
      if (!PIPELINE_RUN_STATUSES.includes(status) || PIPELINE_TERMINAL_STATUSES.includes(status)) return false
      this.pipelineProgressModalOpen = true
      return true
    },
    closePipelineProgressModal() {
      this.pipelineProgressModalOpen = false
    },
    async resetPipelineToNewTaskState({ toastKey, fallbackZh, fallbackEn, durationMs = 4000 } = {}) {
      this.orchestrationStartRequestId += 1
      this.pipelineStatusRequestId += 1
      this.s2vContentRewriteToastShown = false
      this.stopPipelinePolling()
      this.resetPipelineUiState()
      this.selectedPipeline = null
      this.view = 'pipelines'
      if (toastKey) {
        this.s2vOptionsToast = this.translateWithLocaleFallback(toastKey, fallbackZh, fallbackEn)
        if (this.s2vOptionsToastTimer) clearTimeout(this.s2vOptionsToastTimer)
        this.s2vOptionsToastTimer = setTimeout(() => { this.s2vOptionsToast = '' }, durationMs)
      }
      try {
        await this.loadHistory()
      } catch (_) {
        // 历史刷新失败不能阻塞新建页复位；下次进入历史记录时再重试。
      }
      return true
    },
    async detachPipelineToBackground() {
      if (!this.canDetachPipelineToBackground) return false
      const detached = await this.resetPipelineToNewTaskState({
        toastKey: 'create.story2video.backgroundDetachedToast',
        fallbackZh: '任务已转入后台运行，在历史记录中可查看',
        fallbackEn: 'The task is now running in the background. You can view it in History.',
      })
      // 2026-09-12 需求：后台脱离成功后，应用界面正中央显示统一居中提示（数秒后消失）
      if (detached) showPipelineBackgroundToast()
      return detached
    },
    // 进度弹窗右上角关闭统一入口（2026-08-30）：
    // - 普通 running 编排任务：关闭=后台脱离（detachPipelineToBackground）。
    // - 内容政策检查点：关闭=取消任务并关闭弹窗（内容政策任务不能后台化，否则会静默卡在
    //   needs_user_input；关闭即放弃本次运行，作为已取消/失败处理）。
    // - 其他人工检查点（scene_asset_selection 等）：closeDisabled 为 true，不会触发本方法。
    async handlePipelineProgressClose() {
      if (this._s2vAlive === false) return false
      if (this.isContentPolicyCheckpoint) {
        return this.cancelContentPolicyTask()
      }
      return this.detachPipelineToBackground()
    },
    // 内容政策任务取消：调用 pipelineCancel 取消主进程 run，并复位前端跟踪态。
    // 返回 true 表示已成功取消并复位；false 表示取消失败（保留当前运行态，避免静默失败）。
    async cancelContentPolicyTask() {
      if (this.contentPolicyEditBusy) return false
      const runId = typeof this.orchestrationRunId === 'string' ? this.orchestrationRunId.trim() : ''
      if (!runId) return false
      this.contentPolicyEditBusy = true
      try {
        const result = await pipelineCancel()
        if (!result || result.code !== 0) {
          this.setPipelineProgressStatusError()
          return false
        }
        this.resetPipelineUiState()
        return true
      } catch (_error) {
        this.setPipelineProgressStatusError()
        return false
      } finally {
        this.contentPolicyEditBusy = false
      }
    },
    // 内容政策「编辑场景」：先取消当前 run（内容政策任务不能断点续跑，必须改文案后重新生成），
    // 再跳转结果页并定位受影响场景。若缺少可编辑项目或受影响场景，则仅取消并提示。
    async editContentPolicyScenes() {
      if (this.contentPolicyEditBusy) return
      const projectId = this.contentPolicyProjectId
      const sceneNumbers = this.contentPolicySceneNumbers
      this.contentPolicyEditBusy = true
      try {
        const result = await pipelineCancel()
        if (!result || result.code !== 0) {
          this.setPipelineProgressStatusError()
          return
        }
        this.resetPipelineUiState()
        if (!projectId) {
          // 缺少可编辑项目（run-only 记录或项目尚未落盘）：无法跳转编辑页，仅提示用户到历史记录处理。
          this.s2vOptionsToast = this.translateWithLocaleFallback(
            'create.story2video.contentPolicyNoProjectToast',
            '当前任务缺少可编辑项目，请在历史记录中查看并处理。',
            'This task has no editable project. Please handle it from History.',
          )
          return
        }
        const query = { project: projectId }
        if (sceneNumbers.length > 0) query.focusScenes = sceneNumbers.join(',')
        await this.$router.push({ path: '/create/result', query })
      } catch (_error) {
        this.setPipelineProgressStatusError()
      } finally {
        this.contentPolicyEditBusy = false
      }
    },
    // 后台恢复/继续一个 run：切到流水线视图并实时跟踪进度（不重置 runId）。
    // run 完成后自动跳转结果页；断点恢复是用户显式继续动作，跳到流水线页并持续拉取运行态。
    // 历史记录中的运行任务由用户显式重新挂回创作页，继续实时查看或断点续跑。
    async openRunningPipeline(runId, pipelineName, toastKey = 'create.story2video.backgroundResumeToast', outcome = {}) {
      const normalizedRunId = typeof runId === 'string' ? runId.trim() : ''
      if (!normalizedRunId) return false
      // 只停止已有轮询，不得调用 resetPipelineUiState（会把 orchestrationRunId 清成 null）
      this.stopPipelinePolling()
      this.closePipelineProgressModal()
      this.orchestrationActionRequestId += 1
      this.pauseActionBusy = false
      this.story2videoResuming = false
      this.orchestrationRunId = normalizedRunId
      this.orchestrationResultPath = null
      this.orchestrationError = ''
      this.orchestrationContext = null
      this.orchestrationContextRunId = null
      // 每条新 run 都从干净的前端展示态开始，对齐 startOrchestrationForeground（2026-09-05 修复）
      this.needsCheckpoint = false
      this.providerWarnings = []
      this.dismissedProviderWarnings = false
      this.sceneAssetSelectionActive = false
      this.sceneAssetCandidates = []
      this.sceneAssetSelectionError = ''
      this.sceneAssetConfirming = false
      this.dismissedBgmSkippedNotice = false
      this.story2videoRunMeta = createPipelineRunMetaFromSnapshot(outcome)
      this.orchestrationStages = this.getDefaultPipelineStages(pipelineName)
      this.selectedPipeline = (this.pipelines || []).find(p => p.name === pipelineName) || { name: pipelineName, available: true }
      this.view = 'pipelines'
      if (toastKey) {
        this.showS2VOptionsToast(
          this.translateWithLocaleFallback(toastKey, 'backgroundResumeToast', 'Pipeline resumed in the background. Tracking progress…'),
          3000
        )
        this.showS2VOptionsToast(
          this.translateWithLocaleFallback('create.story2video.resumeUsesCurrentModels', '已从断点继续，将使用当前默认的图片 / 语音 / 视频模型生成缺失素材。', 'Resumed from breakpoint. Missing assets will be generated with your current default image / voice / video models.'),
          3200
        )
      }
      await this.updateOrchestrationStatus()
      if (this._s2vAlive === false || this.orchestrationRunId !== normalizedRunId || this.view !== 'pipelines') return false
      this.openPipelineProgressModal()
      if (this._s2vAlive !== false && this.orchestrationRunId && !PIPELINE_TERMINAL_STATUSES.includes(this.pipelineRunStatus?.status) && !this.pollTimer) {
        this.pollTimer = setInterval(() => this.updateOrchestrationStatus(), 3000)
      }
      return true
    },
    // 启动即前台跟踪（2026-08-21 交互修订）：启动成功后与断点续跑同口径，在创作页
    // 实时轮询展示阶段进度；离开页面时 beforeUnmount 停止轮询，主进程 run 继续后台执行，
    // 仅历史记录可见；重新进入创作页回到全新新建初始态（mounted 不重挂任何 run）。
    async startOrchestrationForeground(runId, pipelineName, outcome = {}) {
      const normalizedRunId = typeof runId === 'string' ? runId.trim() : ''
      if (!normalizedRunId) return false
      // 只停止已有轮询，不得调用 resetPipelineUiState（会把 orchestrationRunId 清成 null）
      this.stopPipelinePolling()
      this.closePipelineProgressModal()
      this.orchestrationActionRequestId += 1
      this.pauseActionBusy = false
      this.story2videoResuming = false
      this.orchestrationRunId = normalizedRunId
      this.orchestrationResultPath = null
      this.orchestrationError = ''
      this.orchestrationContext = (outcome && typeof outcome === 'object' && outcome.context && typeof outcome.context === 'object' && !Array.isArray(outcome.context)) ? outcome.context : null
      this.orchestrationContextRunId = this.orchestrationContext ? normalizedRunId : null
      // 每条新 run 都从干净的前端展示态开始；不影响主进程中已启动的任务。
      this.needsCheckpoint = false
      this.providerWarnings = []
      this.dismissedProviderWarnings = false
      this.story2videoRunMeta = createPipelineRunMetaFromSnapshot(outcome)
      this.sceneAssetSelectionActive = false
      this.sceneAssetCandidates = []
      this.sceneAssetSelectionError = ''
      this.sceneAssetConfirming = false
      this.dismissedBgmSkippedNotice = false
      this.orchestrationStages = (outcome && Array.isArray(outcome.stages) && outcome.stages.length > 0)
        ? outcome.stages
        : this.getDefaultPipelineStages(pipelineName)
      this.selectedPipeline = (this.pipelines || []).find(p => p.name === pipelineName) || { name: pipelineName, available: true }
      this.view = 'pipelines'
      this.showS2VOptionsToast(
        this.translateWithLocaleFallback('create.story2video.startForegroundToast', '流水线已启动，正在实时展示进度；离开本页后任务继续后台运行，可在「历史记录」中查看（仍占用并发名额）。', 'Pipeline started. Progress is shown live here; it keeps running in the background after you leave this page, remains visible in History (still occupies a run slot).'),
        4000
      )
      await this.updateOrchestrationStatus()
      if (this._s2vAlive === false || this.orchestrationRunId !== normalizedRunId || this.view !== 'pipelines') return false
      this.openPipelineProgressModal()
      if (this._s2vAlive !== false && this.orchestrationRunId && !PIPELINE_TERMINAL_STATUSES.includes(this.pipelineRunStatus?.status) && !this.pollTimer) {
        this.pollTimer = setInterval(() => this.updateOrchestrationStatus(), 3000)
      }
      return true
    },
    async showOrchestrationCheckpoint(runId, pipelineName, outcome = {}) {
      const normalizedRunId = typeof runId === 'string' ? runId.trim() : ''
      if (!normalizedRunId) return false
      this.closePipelineProgressModal()
      this.orchestrationActionRequestId += 1
      this.pauseActionBusy = false
      this.story2videoResuming = false
      this.orchestrationRunId = normalizedRunId
      this.orchestrationResultPath = null
      this.orchestrationError = ''
      this.orchestrationContext = outcome.context && typeof outcome.context === 'object' && !Array.isArray(outcome.context) ? outcome.context : null
      this.orchestrationContextRunId = this.orchestrationContext ? normalizedRunId : null
      this.story2videoRunMeta = createPipelineRunMeta(outcome?.createdAt)
      this.pipelineRunStatus = {
        ...(outcome.status && typeof outcome.status === 'object' ? outcome.status : {}),
        status: 'paused',
        progress: Number.isFinite(Number(outcome.progress)) ? Number(outcome.progress) : 0,
        stages: Array.isArray(outcome.stages) && outcome.stages.length > 0
          ? outcome.stages
          : this.getDefaultPipelineStages(pipelineName),
        checkpoint: outcome.checkpoint || outcome.status?.checkpoint || null,
      }
      this.orchestrationStages = this.pipelineRunStatus.stages
      this.selectedPipeline = (this.pipelines || []).find(p => p.name === pipelineName) || { name: pipelineName, available: true }
      this.view = 'pipelines'
      await this.updateOrchestrationStatus()
      if (this._s2vAlive === false || this.orchestrationRunId !== normalizedRunId || this.view !== 'pipelines') return false
      this.openPipelineProgressModal()
      if (this._s2vAlive !== false && this.orchestrationRunId && !PIPELINE_TERMINAL_STATUSES.includes(this.pipelineRunStatus?.status) && !this.pollTimer) {
        this.pollTimer = setInterval(() => this.updateOrchestrationStatus(), 3000)
      }
      return true
    },
    async advancePipeline() { await pipelineAdvance(); await this.updatePipelineStatus() },
    async loadHistory() {
      const requestId = ++this.historyRequestId
      this.historyLoading = true
      try {
        const [projectsResult, pipelineResult] = await Promise.allSettled([
          settleHistoryRequest(() => story2videoListProjects()),
          settleHistoryRequest(() => pipelineHistory()),
        ])
        if (requestId !== this.historyRequestId) return
        const hasProjects = projectsResult.status === 'fulfilled'
          && projectsResult.value?.code === 0
          && Array.isArray(projectsResult.value.data)
        const hasRuns = pipelineResult.status === 'fulfilled'
          && pipelineResult.value?.code === 0
          && Array.isArray(pipelineResult.value.data)
        // 未登录本地模式：主进程在 owner 回退设备级命名空间时标记 localMode，供历史页提示条展示
        this.historyLocalMode = projectsResult.status === 'fulfilled'
          && projectsResult.value?.localMode === true
        const projects = hasProjects
          ? projectsResult.value.data.map(project => ({ ...project, historyType: 'story2video-project' }))
          : []
        const projectById = new Map(projects.map(project => [project.projectId, project]))
        const projectByRunId = new Map(
          projects
            .filter(project => typeof project?.runId === 'string' && project.runId.trim())
            .map(project => [project.runId, project]),
        )
        const projectByLegacyId = new Map(
          projects
            .filter(project => typeof project?.id === 'string' && project.id.trim())
            .map(project => [project.id, project]),
        )
        const matchedProjectIds = new Set()
        const runs = hasRuns
          ? pipelineResult.value.data.map(run => {
              const runKeys = [run?.projectId, run?.runId, run?.id]
                .filter(value => typeof value === 'string' && value.trim())
              const project = runKeys.reduce((matched, key) => matched || projectById.get(key) || projectByRunId.get(key) || projectByLegacyId.get(key), null)
              if (!project) {
                return {
                  ...run,
                  historyType: 'pipeline-run',
                  // run-only 记录（失败早于草稿创建，无 project 可匹配）：用 params 回填标题与原文案，
                  // 否则卡片标题回退为流水线名、文案预览显示「未生成」（2026-08-20 修复）
                  title: run.title || run.params?.title || run.params?.publishTitle || '',
                  sourceText: run.sourceText || run.params?.text || '',
                }
              }
              const projectId = project.projectId
              matchedProjectIds.add(projectId)
              return {
                ...run,
                ...project,
                projectId,
                runId: run.runId || run.id || project.runId || projectId,
                historyType: 'story2video-project',
                title: project.title || run.title || project.sourceText || run.sourceText || '',
                sourceText: project.sourceText || run.sourceText || '',
                segments: Array.isArray(project.segments) ? project.segments : run.segments,
                status: run.status || project.status,
                currentStage: run.currentStage ?? project.currentStage,
                stages: Array.isArray(run.stages) && run.stages.length ? run.stages : project.stages,
                checkpoint: run.checkpoint ?? project.checkpoint,
                error: run.error || project.error,
                activeMs: run.activeMs ?? project.activeMs,
                updatedAt: latestHistoryTimestamp(project, run) || project.updatedAt || run.updatedAt,
              }
            })
          : []
        const projectsWithoutRuns = projects.filter(project => !matchedProjectIds.has(project.projectId))
        // stale running 检测：updatedAt 超过 30 分钟仍为 running 的任务视为「已中断」
        // （应用退出/崩溃留下的运行残留；手动暂停任务经 savePaused 持久化为 paused，不受此转换影响）
        // 过期运行检测 + failed 阶段补充 pausedStage（2026-09-05 修复）：
        // runs 和 projectsWithoutRuns 都需处理，避免残留 running 导致编辑按钮不显示
        const now = Date.now()
        markStaleRunningAsInterrupted(runs, now)
        fillFailedPausedStage(runs)
        markStaleRunningAsInterrupted(projectsWithoutRuns, now)
        fillFailedPausedStage(projectsWithoutRuns)

        this.history = sortHistoryByEffectiveTime([...runs, ...projectsWithoutRuns])
        void this.hydrateHistoryThumbnails(this.history, requestId)
        this.scheduleHistoryRefresh()
        if (!hasProjects || !hasRuns) {
          // 具体原因透传：IPC 已返回 message（存储不可用/无法识别当前用户/…），
          // 映射为用户可读的可操作建议，替代笼统的「请稍后再试」。
          const failureMessages = [projectsResult, pipelineResult]
            .map(result => result.status === 'fulfilled' ? (result.value?.message || '') : (result.reason?.message || ''))
            .filter(Boolean)
          // 优先取能映射出具体建议的原因；全部无法映射时回退第一条原始 message（空 detail 隐藏）
          const failureMessage = failureMessages.find(message => historyLoadFailureDetail(message) !== '') || failureMessages[0] || ''
          this.showStory2VideoErrorDialog({
            messageKey: STORY2VIDEO_NOTIFICATION_KEYS.HISTORY_LOAD_FAILED,
            detail: historyLoadFailureDetail(failureMessage),
          })
        }
      } catch (_) {
        if (requestId !== this.historyRequestId) return
        this.history = []
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.HISTORY_LOAD_FAILED })
      } finally {
        if (requestId === this.historyRequestId) this.historyLoading = false
      }
    },
    async hydrateHistoryThumbnails(items, requestId) {
      const records = (Array.isArray(items) ? items : []).filter(item => item?.projectId)
      let cursor = 0
      const worker = async () => {
        while (cursor < records.length) {
          const index = cursor++
          const item = records[index]
          if (requestId !== this.historyRequestId) return
          try {
            const result = await settleHistoryRequest(() => story2videoGetThumbnail(item.projectId))
            if (requestId !== this.historyRequestId) return
            const data = result?.code === 0 ? result.data : null
            item.thumbnailUrl = data?.status === 'ready' ? (data.url || null) : null
            item.thumbnailStatus = data?.status || 'missing'
          } catch (_) {
            if (requestId !== this.historyRequestId) return
            item.thumbnailUrl = null
            item.thumbnailStatus = 'failed'
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, records.length) }, () => worker()))
    },
    openHistoryResult(item) {
      // 仅真实 story2video 项目可进入编辑页；run-only 记录（historyType=pipeline-run）的 projectId
      // 是主进程回退的 runId，项目不存在，进入结果页必然加载失败（2026-08-30 修复）。
      if (!item || item.historyType !== 'story2video-project' || !item?.projectId || item.status === 'running') return
      const query = { project: item.projectId }
      const runId = this.historyRunId(item)
      if (runId) query.runId = runId
      // 内容政策拦截任务不能断点续跑：携带场景号让结果页定位涉及场景，用户改文案后重新合成
      const focusScenes = policySceneQuery(item.error)
      if (item.status === 'failed' && focusScenes && !this.historyItemResumable(item)) query.focusScenes = focusScenes
      this.$router.push({ path: '/create/result', query })
    },
    // 历史视频一键发布：从已完成项目提取发布数据，跳转发布页并预填充（视频模式）。
    // 仅 completed 且有成片路径的项目可发布；发布走视频首帧封面，不携带自定义封面。
    publishHistoryItem(item) {
      if (!item || item.status !== 'completed' || !item.projectId) return
      const data = buildPublishFromProject(item)
      if (!data.video_path) return
      this.$router.push({ path: '/publish', query: publishDataToQuery(data) })
    },
    /** 下载历史视频到本地（2026-09-04） */
    async downloadHistoryVideo(item) {
      if (!item || typeof item.videoPath !== 'string' || !item.videoPath.trim()) return
      try {
        const suggestedName = String(item.videoPath || '').split(/[\\/]/).pop() || 'video_' + Date.now() + '.mp4'
        const result = await story2videoSaveAs(item.videoPath, suggestedName)
        if (result?.code !== 0) throw new Error(result?.message || '下载失败')
        if (result.data?.cancelled) return
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SAVE_COMPLETED })
      } catch (_) {
        this.showStory2VideoOperationFailure()
      }
    },
    historyRunId(item) {
      const value = item?.runId || item?.id
      return typeof value === 'string' && value.trim() ? value.trim() : ''
    },
    // Kept as a compatibility alias for callers outside the history component.
    // It is deliberately read-only for non-completed records.
    openHistory(item) {
      if (item?.status !== 'running') this.openHistoryResult(item)
    },
    historyItemResumable(item) {
      if (!item || !['failed', 'paused', 'interrupted'].includes(item.status) || !(item.id || item.runId)) return false
      // 内容政策/需要用户输入类失败必须修改文案后重新启动，不允许原样恢复
      if (RESUME_BLOCKING_ERROR_PATTERN.test(String(item.error || ''))) return false
      return true
    },
    async resumeHistoryItem(item) {
      const runId = this.historyRunId(item)
      if (!runId || this.story2videoResuming) return
      this.story2videoResuming = true
      try {
        const res = await pipelineResumeOrchestration(runId)
        if (res?.code === 0 && res.data?.success && typeof res.data?.runId === 'string' && res.data.runId.trim()) {
          const pipelineName = item.pipeline || item.name
          // 分镜素材自选暂停点恢复：保持 paused，进入选择面板（updateOrchestrationStatus 会激活）
          const selectionPaused = res.data.paused === true
          if (!selectionPaused) {
            // 失败任务断点恢复：后端已 fire-and-forget 启动 _autoAdvanceRun 推进，
            // 这里必须跳转并持有 runId 实时跟踪，否则流水线页会因 runId 为空而看不到任何进展。
            await this.openRunningPipeline(res.data.runId, pipelineName)
            return
          }
          await this.showOrchestrationCheckpoint(res.data.runId, pipelineName, {
            ...res.data,
            stages: Array.isArray(item.stages) && item.stages.length > 0 ? item.stages : res.data.stages,
          })
          await this.loadHistory()
        } else {
          this.showStory2VideoErrorDialog({
            errorCode: res?.data?.errorCode || res?.code,
            error: res?.data?.error || res?.message || '断点恢复失败，请稍后再试。',
          })
        }
      } catch (_) {
        this.showStory2VideoErrorDialog({ errorCode: _?.code || _?.errorCode, error: _?.message })
      } finally {
        this.story2videoResuming = false
      }
    },
    historyStageState(stage) {
      if (!stage || typeof stage !== 'object') return ''
      const status = stage.status || ''
      if (status === 'completed') return 'done'
      if (status === 'running') return 'active'
      if (status === 'failed' || status === 'needs_user_input' || status === 'cancelled') return 'failed'
      return 'pending'
    },
    historyStageLabel(stage) {
      if (!stage) return ''
      return typeof stage === 'object' ? (stage.name || stage.stage || '') : String(stage)
    },
    historyStageTitle(stage) {
      const name = this.historyStageLabel(stage)
      const status = stage && typeof stage === 'object' ? (stage.status || '') : ''
      return name + (status ? ' · ' + status : '')
    },
    scheduleHistoryRefresh() {
      if (this.historyPollTimer) { clearInterval(this.historyPollTimer); this.historyPollTimer = null }
      const hasRunning = (this.history || []).some(item => item && item.status === 'running')
      if (!hasRunning) return
      this.historyPollTimer = setInterval(() => {
        if (this.view === 'history') this.refreshRunningHistory()
      }, 5000)
    },
    // 原地刷新运行中流水线的阶段状态（保持列表对象身份稳定），避免整表重渲染导致闪烁
    async refreshRunningHistory() {
      if (this.view !== 'history' || this._historyRefreshing) return
      this._historyRefreshing = true
      try {
        const r = await settleHistoryRequest(() => pipelineHistory())
        if (!r || r.code !== 0 || !Array.isArray(r.data)) return
        const runningById = new Map(r.data
          .filter(item => item && item.status === 'running')
          .map(item => [this.historyRunId(item), item])
          .filter(([runId]) => Boolean(runId)))
        const list = this.history || []
        let finishedTransition = false
        for (let i = list.length - 1; i >= 0; i--) {
          const item = list[i]
          if (!item || item.status !== 'running') continue
          const runId = this.historyRunId(item)
          const fresh = runningById.get(runId)
          if (fresh) {
            item.stages = Array.isArray(fresh.stages) && fresh.stages.length ? fresh.stages : item.stages
            item.currentStage = fresh.currentStage ?? item.currentStage
            item.checkpoint = fresh.checkpoint ?? item.checkpoint
            item.progress = fresh.progress ?? item.progress
            item.error = fresh.error ?? item.error ?? null
            item.activeMs = fresh.activeMs ?? item.activeMs
            item.activeSegmentStartedAt = fresh.activeSegmentStartedAt ?? item.activeSegmentStartedAt ?? null
            item.updatedAt = fresh.updatedAt ?? item.updatedAt
            runningById.delete(runId)
          } else {
            // 运行已结束（完成/失败/取消）：触发一次完整加载，
            // 让该任务以终态（已完成/失败/已取消）继续留在历史中，而不是直接消失。
            finishedTransition = true
            list.splice(i, 1)
          }
        }
        if (finishedTransition) {
          await this.loadHistory()
          return
        }
        if (runningById.size > 0) {
          list.push(...runningById.values())
        }
        const sorted = sortHistoryByEffectiveTime(list)
        list.splice(0, list.length, ...sorted)
      } catch (_) {
        // 刷新失败保留现有状态，下一轮重试
      } finally {
        this._historyRefreshing = false
      }
    },
    async deleteHistory(item) {
      if (!item?.projectId) return
      // 确认门禁由上游 requestHistoryDeletion 的应用内删除对话框承担（唯一确认，勿叠加）
      const result = await story2videoDeleteProject(item.projectId)
      if (result?.code === 0) this.history = this.history.filter(entry => entry.projectId !== item.projectId)
      else this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PROJECT_DELETE_FAILED })
    },

    // 文件处理
    handlePipelineFiles(e) {
      Array.from(e.target.files || []).forEach(file => {
        if (!this.validateStory2VideoFile(file, 'image')) return
        const reader = new FileReader()
        reader.onload = (ev) => { this.pipelineImages.push({ name: file.name, preview: ev.target.result }) }
        reader.readAsDataURL(file)
      })
    },
    handlePipelineDrop(e) {
      Array.from(e.dataTransfer?.files || []).forEach(file => {
        if (!this.validateStory2VideoFile(file, 'image')) return
        const reader = new FileReader()
        reader.onload = (ev) => { this.pipelineImages.push({ name: file.name, preview: ev.target.result }) }
        reader.readAsDataURL(file)
      })
    },
    validateStory2VideoFile(file, kind) {
      const extension = String(file?.name || '').toLowerCase().match(/\.[^.]+$/)?.[0] || ''
      const rules = {
        image: { extensions: ['.jpg', '.jpeg', '.png', '.webp'], maxBytes: 10 * 1024 * 1024, label: '图片' },
        audio: { extensions: ['.wav', '.m4a', '.mp3'], maxBytes: 50 * 1024 * 1024, label: '旁白音频' },
        bgm: { extensions: ['.wav', '.m4a', '.mp3'], maxBytes: 15 * 1024 * 1024, label: '背景音乐' },
        video: { extensions: ['.mp4', '.mov', '.webm', '.mkv', '.avi'], maxBytes: 512 * 1024 * 1024, label: '视频素材' },
      }
      const rule = rules[kind]
      if (!rule || !rule.extensions.includes(extension)) {
        // 细分提示：明确指出不支持的具体格式与允许的格式列表
        this.showStory2VideoErrorDialog({
          messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_FORMAT_INVALID,
          messageParams: {
            extension: extension ? extension.toUpperCase() : '该',
            kindLabel: rule?.label || '',
            extensions: rule?.extensions || [],
          },
        })
        return false
      }
      if (Number(file?.size) > rule.maxBytes) {
        // 细分提示：明确指出大小上限与实际大小
        this.showStory2VideoErrorDialog({
          messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_SIZE_EXCEEDED,
          messageParams: {
            kindLabel: rule.label,
            maxMb: rule.maxBytes / (1024 * 1024),
            actualMb: Math.max(1, Number(file?.size) / (1024 * 1024)),
          },
        })
        return false
      }
      return true
    },
    resolveMediaImportFailure(result, kindLabel = '') {
      // 主进程返回的具体失败原因 → 映射为可读的细分提示（带类别宾语）；无法识别时回退通用 MEDIA_INVALID
      const message = String(result?.message || result?.error || '').trim()
      const label = typeof kindLabel === 'string' ? kindLabel : ''
      if (/不支持的媒体格式|格式不支持|extension|format/i.test(message)) {
        return {
          messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_FORMAT_INVALID,
          messageParams: { extension: '', kindLabel: label, extensions: '' },
        }
      }
      if (/超过大小上限|大小超限|超出.*大小|size|太大/i.test(message)) {
        return {
          messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_SIZE_EXCEEDED,
          messageParams: { kindLabel: label, maxMb: '', actualMb: '' },
        }
      }
      if (/无法读取媒体文件路径|无法获取.*路径|file path/i.test(message)) {
        // preload 拿不到 File 本地路径（跨 contextBridge 后路径丢失等）→ 引导重新选择，而不是暗示文件损坏
        return { messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_PATH_UNRESOLVED, messageParams: { kindLabel: label } }
      }
      if (/不存在|不可读|无法读取|被占用|corrupt|locked/i.test(message)) {
        return { messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_UNREADABLE, messageParams: { kindLabel: label } }
      }
      return { messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_INVALID, messageParams: { kindLabel: label } }
    },
    async importStory2VideoMedia(file, kind) {
      if (!file || !this.validateStory2VideoFile(file, kind)) return null
      const kindLabel = this.story2videoKindLabel(kind)
      try {
        const result = await story2videoImportMedia(file, kind)
        if (result?.code === 0 && result.data?.path) return result.data
        // 主进程拒绝时把具体原因透传为细分提示（带类别宾语），而不是笼统的「所选文件不符合要求」
        this.showStory2VideoErrorDialog(this.resolveMediaImportFailure(result, kindLabel))
        return null
      } catch (_) {
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_UNREADABLE, messageParams: { kindLabel } })
        return null
      }
    },
    async handlePipelineAudio(e) {
      const files = Array.from(e.target.files || [])
      const resolved = []
      for (const file of files) {
        const imported = await this.importStory2VideoMedia(file, 'audio')
        if (imported?.path) {
          resolved.push({
            name: file.name || imported.originalName,
            path: imported.path,
            transcript: '',
            transcribing: false,
            transcriptionError: '',
          })
        }
      }
      // 失败的单个文件已在 importStory2VideoMedia 内展示细分原因（格式/大小/不可读），
      // 这里不再重复弹笼统的 MEDIA_INVALID，避免同一次操作弹出两个对话框。
      this.pipelineAudio = resolved
    },
    async transcribePipelineAudio(index) {
      const audio = this.pipelineAudio[index]
      if (!audio?.path || audio.transcribing) return
      audio.transcribing = true
      audio.transcriptionError = ''
      try {
        const result = await story2videoTranscribe(audio.path)
        const transcript = result?.code === 0 ? String(result.data?.text || '').trim() : ''
        if (!transcript) throw new Error(result?.message || '语音识别未返回文字')
        audio.transcript = transcript
      } catch (error) {
        audio.transcriptionError = error?.message || '旁白识别失败'
      } finally {
        audio.transcribing = false
      }
    },
    async handlePipelineVideo(e) {
      const file = e.target.files?.[0]
      if (!file) return
      if (!this.validateStory2VideoFile(file, 'video')) {
        this.pipelineVideo = null
        return
      }
      // File 对象跨 contextBridge 后路径会丢失；先经 getPathForFile 拿到真实路径，
      // 再走基于路径的导入（复制到应用控制目录，供后续 canonical 白名单校验）。
      const filePath = typeof getApi()?.getPathForFile === 'function'
        ? await getApi().getPathForFile(file)
        : ''
      if (!filePath) {
        this.pipelineVideo = null
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_UNREADABLE, messageParams: { kindLabel: '视频素材' } })
        return
      }
      const imported = await story2videoImportMediaPath(filePath, 'video')
      if (!imported || imported.code !== 0 || !imported.data?.path) {
        this.pipelineVideo = null
        this.showStory2VideoErrorDialog(this.resolveMediaImportFailure(imported))
        return
      }
      this.pipelineVideo = { name: file.name || imported.data.originalName, path: imported.data.path }
    },
    async handleS2VBgmFile(e) {
      const file = e.target.files?.[0]
      if (!file) return
      await this.addFileToBgmLibrary(file)
    },
    // 背景音乐素材库（2026-08-14）：添加成功后入库并自动选中；失败沿用媒体细分提示。
    async addFileToBgmLibrary(file) {
      if (!file || !this.validateStory2VideoFile(file, 'bgm')) {
        this.s2vConfig.bgmPath = ''
        return null
      }
      try {
        const result = await story2videoBgmLibraryAdd(file)
        if (result?.code === 0 && result.data?.path) {
          await this.loadS2VBgmLibrary({ silent: true })
          this.s2vConfig.bgmPath = result.data.path
          return result.data
        }
        this.s2vConfig.bgmPath = ''
        this.showStory2VideoErrorDialog(this.resolveMediaImportFailure(result, '背景音乐'))
        return null
      } catch (_) {
        this.s2vConfig.bgmPath = ''
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_UNREADABLE, messageParams: { kindLabel: '背景音乐' } })
        return null
      }
    },
    async loadS2VBgmLibrary(options = {}) {
      this.s2vBgmLibraryLoading = true
      try {
        const result = await story2videoBgmLibraryList()
        if (result?.code === 0 && Array.isArray(result.data)) {
          this.s2vBgmLibrary = result.data
        } else if (!options.silent) {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_LOAD_FAILED })
        }
      } catch (_) {
        if (!options.silent) {
          this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_LOAD_FAILED })
        }
      } finally {
        this.s2vBgmLibraryLoading = false
      }
    },
    async openBgmLibraryDialog() {
      this.s2vBgmLibraryDialogOpen = true
      await this.loadS2VBgmLibrary()
    },
    closeBgmLibraryDialog() {
      this.s2vBgmLibraryDialogOpen = false
      this.cancelBgmRename()
      this.closeBgmDeleteDialog()
    },
    async handleBgmLibraryAddFile(e) {
      const file = e.target.files?.[0]
      if (!file) return
      const added = await this.addFileToBgmLibrary(file)
      if (added && this.$refs.s2vBgmLibraryInput) {
        // 清空 input 允许连续选择同一文件
        this.$refs.s2vBgmLibraryInput.value = ''
      }
    },
    startBgmRename(item) {
      this.s2vBgmLibraryRenamingId = item.id
      this.s2vBgmLibraryRenameDraft = item.name
    },
    async saveBgmRename() {
      const id = this.s2vBgmLibraryRenamingId
      const name = String(this.s2vBgmLibraryRenameDraft || '').trim()
      if (!id || !name || this.s2vBgmLibraryLoading) return
      this.s2vBgmLibraryLoading = true
      try {
        const result = await story2videoBgmLibraryRename(id, name)
        if (result?.code === 0) {
          await this.loadS2VBgmLibrary({ silent: true })
          this.cancelBgmRename()
          return
        }
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_RENAME_FAILED })
      } catch (_) {
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_RENAME_FAILED })
      } finally {
        this.s2vBgmLibraryLoading = false
      }
    },
    cancelBgmRename() {
      this.s2vBgmLibraryRenamingId = ''
      this.s2vBgmLibraryRenameDraft = ''
    },
    requestBgmDelete(item) {
      this.s2vBgmLibraryDeleteTargetId = item.id
      this.s2vBgmLibraryDeleteDialogOpen = true
    },
    closeBgmDeleteDialog() {
      this.s2vBgmLibraryDeleteDialogOpen = false
      this.s2vBgmLibraryDeleteTargetId = null
    },
    async confirmBgmDelete() {
      const id = this.s2vBgmLibraryDeleteTargetId
      if (!id || this.s2vBgmLibraryLoading) return
      this.s2vBgmLibraryLoading = true
      try {
        const result = await story2videoBgmLibraryDelete(id)
        if (result?.code === 0) {
          // 删除当前选中项时回退为「不使用背景音乐」
          const target = this.s2vBgmLibrary.find(item => item.id === id)
          if (target && String(this.s2vConfig.bgmPath) === String(target.path)) this.s2vConfig.bgmPath = ''
          await this.loadS2VBgmLibrary({ silent: true })
          this.closeBgmDeleteDialog()
          return
        }
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_DELETE_FAILED })
      } catch (_) {
        this.showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_DELETE_FAILED })
      } finally {
        this.s2vBgmLibraryLoading = false
      }
    },
    handleQuickFiles(e) {
      Array.from(e.target.files || []).forEach(file => {
        const reader = new FileReader()
        reader.onload = (ev) => { this.quickImages.push({ name: file.name, preview: ev.target.result }) }
        reader.readAsDataURL(file)
      })
    },
    handleQuickDrop(e) {
      Array.from(e.dataTransfer?.files || []).forEach(file => {
        if (!file.type.startsWith('image/')) return
        const reader = new FileReader()
        reader.onload = (ev) => { this.quickImages.push({ name: file.name, preview: ev.target.result }) }
        reader.readAsDataURL(file)
      })
    },

    // 快速渲染
    async startQuickRender() {
      this.quickRendering = true; this.quickProgress = 0; this.quickStage = '开始渲染'; this.quickError = null; this.quickResult = null
      try {
        if (this.quickMode === 'text') {
          // 文案生成：调用 AI 视频生成模型（主进程提交 + 轮询 + 下载），产出真实 AI 视频
          const prompt = this.quickText.split('\n').filter(l => l.trim()).join('。').trim()
          const res = await renderStartAiVideo({ prompt })
          if (res?.code === 0) { this.quickResult = res.data; this.quickRendering = false }
          else { this.quickError = formatUserError(res, { fallback: '渲染失败' }).message; this.quickRendering = false }
        } else {
          // 图片轮播：本地 Remotion 渲染静态图片轮播（不调用视频生成模型）
          const cuts = this.quickImages.map((img, i) => ({ id: 'scene-' + i, type: 'anime_scene', images: [img.preview], animation: 'ken-burns', in_seconds: i * 5, out_seconds: (i + 1) * 5 - 0.5 }))
          const res = await renderStart({ props: { cuts, theme: this.quickTheme, renderer_family: 'explainer-data' }, profile: this.quickProfile })
          if (res?.code === 0) { this.quickResult = res.data }
          else { this.quickError = formatUserError(res, { fallback: '渲染失败' }).message; this.quickRendering = false }
        }
      } catch (e) { this.quickError = '渲染异常: ' + formatUserError(e, { fallback: '未知错误' }).message; this.quickRendering = false }
    },
    cancelQuickRender() { renderCancel(); this.quickRendering = false },
    viewQuickResult() { this.$router.push({ path: '/create/result', query: { path: this.quickResult?.outputPath || '' } }) },
    async aiWrite() {
      this.aiLoading = true
      try {
        const { aiGenerate, modelProviderGetDefault } = await import('@/api/publisher')
        const def = await modelProviderGetDefault('llm'), providerId = def?.code === 0 && def.data?.id ? def.data.id : null
        const r = await aiGenerate('llm', providerId, { prompt: '为短视频写一个30秒文案，风格：' + this.quickTheme })
        if (r?.code === 0 && r.data?.content) this.quickText = r.data.content // P0-1: content 非 text
      } catch (e) { this.quickError = 'AI 写稿失败: ' + formatUserError(e, { fallback: '未知错误' }).message }
      this.aiLoading = false
    },
    // Remotion 安装
    async installDeps() {
      this.installing = true; this.installLog = ''
      try {
        const result = await renderInstallDeps()
        this.installLog = result?.log || '安装完成'
      } catch (e) { this.installLog = '安装失败: ' + formatUserError(e, { fallback: '未知错误' }).message }
      this.installing = false
      const s = await renderGetStatus()
      this.renderStatus = s?.code === 0 && s.data ? s.data : { ready: false, ipcError: true, message: s?.message || 'IPC 调用失败' }
    },

    // 阶段显示
    stageStateClass(stage, i) {
      if (!this.pipelineRunStatus) return ''
      const idx = this.pipelineRunStatus.currentStage || 0
      if (stage.status === 'failed') return 'failed'
      if (stage.status === 'needs_user_input') return 'needs-user-input'
      if (stage.status === 'cancelled') return 'cancelled'
      if (i < idx || stage.status === 'completed') return 'done'
      if (i === idx && stage.status === 'running') return 'active'
      if (stage.status === 'waiting_approval') return 'waiting'
      return 'pending'
    },
    stageStateIcon(stage, i) {
      if (!this.pipelineRunStatus) return '⭕'
      const idx = this.pipelineRunStatus.currentStage || 0
      if (stage.status === 'failed') return '❌'
      if (stage.status === 'needs_user_input') return '⚠️'
      if (stage.status === 'cancelled') return '⏹️'
      if (i < idx || stage.status === 'completed') return '✅'
      if (i === idx && stage.status === 'running') return ''
      if (stage.status === 'waiting_approval') return '⚠️'
      return '⭕'
    },
    stageStatusLabel(stage) {
      return this.pipelineStatus(stage?.status || 'pending')
    },
    // 阶段详情：拆分场景数 / 优化 x/y / 图片·旁白 x/y
    stageDetailText(stage, _index) {
      if (!stage || (stage.status !== 'completed' && stage.status !== 'running')) return ''
      const hasSummary = typeof stage.summary === 'string' && stage.summary
      const hasMessage = Boolean(stage.progress && typeof stage.progress.message === 'string' && stage.progress.message)
      if (stage.status === 'completed' && hasSummary) return stage.summary
      if (hasMessage) return stage.progress.message
      const ctx = this.orchestrationContext || {}
      if (stage.name === 'split') {
        const scenes = Array.isArray(ctx.split) ? ctx.split : (ctx.split?.scenes || null)
        if (Array.isArray(scenes) && scenes.length > 0) {
          return this.translateWithLocaleFallback('story2video.splitSceneCount', '拆分为了 ' + scenes.length + ' 个场景', 'Split into ' + scenes.length + ' scenes', { count: scenes.length })
        }
      }
      if (stage.name === 'optimize') {
        const p = ctx.optimize_progress
        if (p && Number.isInteger(p.total) && Number.isInteger(p.done)) {
          return this.translateWithLocaleFallback('story2video.optimizeProgress', '共 ' + p.total + ' 个场景，已完成 ' + p.done + ' 个', p.done + '/' + p.total + ' scenes optimized', { total: p.total, done: p.done })
        }
      }
      if (stage.name === 'select_video_scenes') {
        const plan = ctx.video_plan
        if (plan && plan.mode !== 'off' && Number.isInteger(plan.selectedCount) && plan.selectedCount > 0) {
          return this.translateWithLocaleFallback('story2video.selectVideoScenes', '已选 ' + plan.selectedCount + ' 个 AI 视频场景（约 ' + plan.ratio + '%）', plan.selectedCount + ' AI video scenes selected (~' + plan.ratio + '%)', { count: plan.selectedCount, ratio: plan.ratio })
        }
        if (plan && plan.mode === 'off') {
          return this.translateWithLocaleFallback('story2video.selectVideoScenesOff', '纯图片轮播模式', 'Image carousel mode')
        }
      }
      if (stage.name === 'generate_assets') {
        const p = ctx.assets_progress
        if (p && Number.isInteger(p.imagesTotal) && Number.isInteger(p.ttsTotal)) {
          if (Number.isInteger(p.videosTotal) && p.videosTotal > 0) {
            return this.translateWithLocaleFallback('story2video.assetsProgressVideo', '图片 ' + p.imagesDone + '/' + p.imagesTotal + ' · 视频 ' + p.videosDone + '/' + p.videosTotal + ' · 旁白 ' + p.ttsDone + '/' + p.ttsTotal, 'Images ' + p.imagesDone + '/' + p.imagesTotal + ' · Videos ' + p.videosDone + '/' + p.videosTotal + ' · Narration ' + p.ttsDone + '/' + p.ttsTotal, { imagesDone: p.imagesDone, imagesTotal: p.imagesTotal, videosDone: p.videosDone, videosTotal: p.videosTotal, ttsDone: p.ttsDone, ttsTotal: p.ttsTotal })
          }
          return this.translateWithLocaleFallback('story2video.assetsProgress', '图片 ' + p.imagesDone + '/' + p.imagesTotal + ' · 旁白 ' + p.ttsDone + '/' + p.ttsTotal, 'Images ' + p.imagesDone + '/' + p.imagesTotal + ' · Narration ' + p.ttsDone + '/' + p.ttsTotal, { imagesDone: p.imagesDone, imagesTotal: p.imagesTotal, ttsDone: p.ttsDone, ttsTotal: p.ttsTotal })
        }
      }
      if (stage.name === 'compose') {
        const p = ctx.compose_progress
        if (p && Number.isFinite(p.percent) && p.percent >= 0 && p.percent <= 100) {
          if (p.phase === 'concat') {
            if (getAppLocale() !== 'en' && typeof p.message === 'string' && p.message.trim()) return p.message
            return this.$t('stageProgress.composeConcat', { percent: Math.round(p.percent) })
          }
          if (p.phase === 'segments' && Number.isInteger(p.segmentsTotal) && p.segmentsTotal > 0 && Number.isInteger(p.segmentsDone)) {
            return this.translateWithLocaleFallback('story2video.composeSegments', '正在合成片段 ' + p.segmentsDone + '/' + p.segmentsTotal + ' · ' + Math.round(p.percent) + '%', 'Composing segment ' + p.segmentsDone + '/' + p.segmentsTotal + ' · ' + Math.round(p.percent) + '%', { done: p.segmentsDone, total: p.segmentsTotal, percent: Math.round(p.percent) })
          }
          return this.translateWithLocaleFallback('story2video.composeProgress', '视频合成 ' + Math.round(p.percent) + '%', 'Composing ' + Math.round(p.percent) + '%')
        }
      }
      return ''
    },
    // compose 子进度百分比：仅 compose running 且 context.compose_progress.percent 合法（有限且 0-100）时返回，
    // 否则返回 null（历史 run / 旧数据安全降级，不渲染子进度条）。
    composeSubProgressPercent(stage) {
      if (!stage || stage.name !== 'compose' || stage.status !== 'running') return null
      const p = this.orchestrationContext && this.orchestrationContext.compose_progress
      if (!p || !Number.isFinite(p.percent) || p.percent < 0 || p.percent > 100) return null
      return Math.round(p.percent)
    },
    // 阶段耗时（mm 分 ss 秒）
    stageTimeText(stage) {
      if (!stage || !stage.startedAt) return ''
      if (stage.status !== 'running' && stage.status !== 'completed' && stage.status !== 'failed') return ''
      const start = Date.parse(stage.startedAt)
      if (!Number.isFinite(start)) return ''
      const end = stage.completedAt ? Date.parse(stage.completedAt) : Date.now()
      if (!Number.isFinite(end)) return ''
      return this.formatDuration(Math.max(0, end - start))
    },
    formatDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000))
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      if (minutes > 0) {
        return this.translateWithLocaleFallback('story2video.durationMinSec', minutes + ' 分 ' + seconds + ' 秒', minutes + 'm ' + seconds + 's', { minutes, seconds })
      }
      return this.translateWithLocaleFallback('story2video.durationSec', seconds + ' 秒', seconds + 's', { seconds })
    },
    startStageClock() {
      if (this._stageClockTimer) return
      this._stageClockTimer = setInterval(() => { this.stageClockTick += 1 }, 1000)
    },
  },
  async mounted() {
    this._s2vAlive = true
    this.refreshS2VTemplates()
    this.startStageClock()
    // 「设置 → 模型设置」弹窗关闭后重新加载模型服务商列表（2026-08-12 Bug 修复）：
    // 用户在当前页新增/启用多模态模型（如 MiniMax）后，图片/语音生成器下拉与
    // 音色克隆能力立即可见，不再停留在 mounted 时的旧列表。
    this._settingsDialogUnwatch = this.$watch(
      () => settingsDialogRevision.value,
      () => { this.loadS2VProviders() }
    )
    await Promise.all([this.loadPipelines(), this.loadS2VProviders()])
    await this.loadMaxOutputResolution()
      await this.loadPipelineOptions()
    // 路由直接进入历史记录视图（/create?view=history）
    if (this.$route?.query?.view === 'history') {
      this.detachPipelineView('history')
      this.view = 'history'
      this.loadHistory()
    }
    this.restoreS2VLastOptions()
    this.loadS2VTtsSamples()
    // 背景音乐素材库（2026-08-14）：静默加载，失败不打扰创作主流程（弹窗打开时再提示）
    this.loadS2VBgmLibrary({ silent: true })
        renderGetStatus().then(s => { this.renderStatus = s?.code === 0 && s.data ? s.data : { ready: false, ipcError: true, message: s?.message || 'IPC 调用失败' } }).catch(() => { this.renderStatus = { ready: false, ipcError: true, message: 'renderGetStatus 异常' } })
    this.cleanups.push(onRenderProgress((pct, stg) => { if (this.quickRendering) { this.quickProgress = pct; this.quickStage = stg } }))
    this.cleanups.push(onRenderComplete((res) => { this.quickRendering = false; this.quickResult = res }))
    // 流水线阶段进度实时推送（openspec pipeline-progress-real-time-push）：事件驱动更新，3s 轮询兜底
    this.cleanups.push(onPipelineUpdate((snapshot) => this.handlePipelinePush(snapshot)))
    this.cleanups.push(onRenderError((err) => { this.quickRendering = false; this.quickError = formatUserError(err, { fallback: '渲染错误' }).message }))
    this.cleanups.push(onRenderInstallProgress(({ text }) => { this.installLog += text + '\n' }))
    // 改写页跳转预填充：加载草稿文案并自动选择流水线
    const rewriteDraftId = this.$route?.query?.draft
    if (rewriteDraftId) {
      this._loadDraftForRewrite(String(rewriteDraftId))
    }
  },
  beforeUnmount() {
    this._s2vAlive = false
    this.stopPipelinePolling()
    this.cleanups.forEach(fn => { try { fn() } catch(_e) { /* ignore cleanup errors */ } })
    if (this._settingsDialogUnwatch) { this._settingsDialogUnwatch(); this._settingsDialogUnwatch = null }
    if (this.s2vOptionsToastTimer) { clearTimeout(this.s2vOptionsToastTimer); this.s2vOptionsToastTimer = null }
    if (this._stageClockTimer) { clearInterval(this._stageClockTimer); this._stageClockTimer = null }
    if (this.historyPollTimer) { clearInterval(this.historyPollTimer); this.historyPollTimer = null }
    if (this.s2vBatchPollTimer) { clearInterval(this.s2vBatchPollTimer); this.s2vBatchPollTimer = null }
    if (this.sceneAssetAttentionTimer) { clearTimeout(this.sceneAssetAttentionTimer); this.sceneAssetAttentionTimer = null }
    this.flushS2VLastOptionsSave()
  },
}
</script>
