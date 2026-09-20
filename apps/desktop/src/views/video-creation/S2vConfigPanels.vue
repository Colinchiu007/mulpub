<template>
        <div class="s2v-config-sections" data-testid="story2video-config-sections">
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
              <span class="s2v-summary">{{ s2vSectionSummary('basic') }}<span v-if="s2vSectionAtDefault('basic')" class="s2v-summary-default">{{ $t('create.story2video.ui.sectionDefaultSuffix') }}</span></span>
            </summary>
            <div class="s2v-field-grid">
              <UiField class="config-item" option-key="basic.resolution" label="比例与分辨率">
                <UiSelect v-model="activeOutputConfig.resolution">
                  <option v-for="opt in outputResolutionOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </UiSelect>
              </UiField>
              <div class="config-item" v-if="s2vOptionVisible('basic.voiceSpeed')">
                <UiSlider
                  v-model="s2vConfig.voiceSpeed"
                  :min="0.5"
                  :max="2"
                  :step="0.1"
                  :default-value="1"
                  suffix="x"
                  testid="s2v-voice-speed"
                  :label="$t('create.story2video.ui.voiceSpeedLabel')"
                  :hint="$t('create.story2video.ui.doubleResetHint')"
                />
              </div>
              <div class="config-item" v-if="s2vOptionVisible('basic.voiceVolume')">
                <UiSlider
                  v-model="s2vConfig.voiceVolume"
                  :min="0"
                  :max="2"
                  :step="0.05"
                  :default-value="1"
                  testid="s2v-voice-volume"
                  :label="$t('create.story2video.ui.voiceVolumeLabel')"
                  :hint="$t('create.story2video.ui.doubleResetHint')"
                />
              </div>
              <div class="config-item" v-if="s2vOptionVisible('basic.voicePreview')">
                <label>旁白试听</label>
                <button type="button" class="btn-secondary" data-testid="s2v-voice-preview" @click="previewS2VVoice">试听</button>
                <span class="config-hint">按当前旁白语速与音量播放一段试听音频</span>
              </div>
              <div class="config-item config-span-2">
                <label>基础说明</label>
                <p class="config-hint">{{ $t('create.story2video.ui.flowGuide') }}</p>
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
              <span class="s2v-summary">{{ s2vSectionSummary('appearance') }}<span v-if="s2vSectionAtDefault('appearance')" class="s2v-summary-default">{{ $t('create.story2video.ui.sectionDefaultSuffix') }}</span></span>
            </summary>
            <div class="s2v-field-grid">
              <UiField class="config-item" option-key="visual.imageStyle" label="图片风格">
                <UiSelect v-model="s2vConfig.imageStyle">
                  <option value="cinematic">电影感</option>
                  <option value="realistic">写实</option>
                  <option value="anime">动漫</option>
                  <option value="watercolor">水彩</option>
                  <option value="minimalist">极简</option>
                </UiSelect>
                <span class="config-hint">{{ story2videoImageStyleHint }}</span>
              </UiField>
              <UiField class="config-item" option-key="visual.promptStyle" label="提示词风格">
                <UiSelect v-model="s2vConfig.promptStyle">
                  <option value="realistic">写实</option>
                  <option value="cinematic">电影感</option>
                  <option value="anime">动漫</option>
                  <option value="watercolor">水彩</option>
                  <option value="minimalist">极简</option>
                </UiSelect>
                <span class="config-hint">{{ story2videoPromptStyleHint }}</span>
              </UiField>
              <UiField class="config-item" :label="s2vMaxPromptLengthLabel">
                <UiSelect v-model="s2vConfig.maxPromptLength" testid="s2v-max-prompt-length-select">
                  <option v-for="n in s2vMaxPromptLengthOptions" :key="n" :value="n">{{ n }}</option>
                </UiSelect>
                <span class="config-hint">{{ s2vMaxPromptLengthHint }}</span>
              </UiField>
              <UiField class="config-item" option-key="visual.imageEffect" label="图片动效">
                <UiSelect v-model="s2vConfig.imageEffect">
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
                </UiSelect>
              </UiField>
              <UiField class="config-item" option-key="visual.transition" label="转场">
                <UiSelect v-model="s2vConfig.transition">
                  <option value="none">直接切换</option>
                  <option value="fade">渐隐渐显</option>
                  <option value="slide-left">左滑</option>
                  <option value="slide-right">右滑</option>
                  <option value="slide-up">上滑</option>
                  <option value="slide-down">下滑</option>
                </UiSelect>
              </UiField>
              <UiField class="config-item" option-key="visual.subtitleSize" label="字幕字号">
                <UiSelect v-model="s2vConfig.subtitleSize">
                  <option value="size1">特小</option>
                  <option value="size2">小</option>
                  <option value="size3">中</option>
                  <option value="size4">大</option>
                  <option value="size5">特大</option>
                  <option value="size6">超大</option>
                </UiSelect>
              </UiField>
              <UiField class="config-item" option-key="visual.subtitleStyle" label="字幕样式">
                <UiSelect v-model="s2vConfig.subtitleStyleName">
                  <option value="style1">描边</option>
                  <option value="style2">背景框</option>
                  <option value="style3">粗描边</option>
                </UiSelect>
              </UiField>
              <UiField class="config-item" option-key="visual.subtitleEnabled" label="字幕">
                <UiSelect v-model="s2vConfig.subtitleEnabled">
                  <option :value="true">启用</option>
                  <option :value="false">关闭</option>
                </UiSelect>
              </UiField>
              <UiField class="config-item" option-key="voice.bgm" label="背景音乐">
                <div class="inline-file-control">
                  <UiSelect v-model="s2vConfig.bgmPath" testid="s2v-bgm-select">
                    <option value="">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.noBgm', '不使用背景音乐', 'No background music') }}</option>
                    <option v-for="item in s2vBgmLibrary" :key="item.id" :value="item.path">{{ item.name }}</option>
                    <option v-if="s2vLegacyBgmPath" :value="s2vLegacyBgmPath">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.legacyBgm', '已选音频（未入库）', 'Selected audio (not in library)') }}</option>
                  </UiSelect>
                  <button type="button" class="btn-secondary" data-testid="s2v-bgm-manage-button" @click="openBgmLibraryDialog">{{ translateWithLocaleFallback('create.story2video.bgmLibrary.manage', '管理背景音乐', 'Manage music') }}</button>
                </div>
                <p class="config-hint">{{ mediaRequirementsBgmText }}</p>
              </UiField>
              <div class="config-item" v-if="s2vOptionVisible('voice.bgmVolume')">
                <UiSlider
                  v-model="s2vConfig.bgmVolume"
                  :min="0"
                  :max="10"
                  :step="1"
                  :default-value="5"
                  testid="s2v-bgm-volume"
                  :label="$t('create.story2video.ui.bgmVolumeLabel')"
                  :hint="$t('create.story2video.ui.doubleResetHint')"
                />
              </div>
              <div class="config-item" v-if="s2vOptionVisible('visual.watermarkText')">
                <label>{{ translateWithLocaleFallback('create.story2video.watermark.label', 'Watermark text', 'Watermark text') }}</label>
                <input v-model.trim="s2vConfig.watermarkText" class="form-input" :placeholder="translateWithLocaleFallback('create.story2video.watermark.placeholder', 'Optional', 'Optional')" />
              </div>
              <UiField class="config-item" data-testid="s2v-watermark-position" option-key="visual.watermarkPosition" :label="translateWithLocaleFallback('create.story2video.watermark.positionLabel', 'Watermark position', 'Watermark position')">
                <UiSelect v-model="s2vConfig.watermarkConfig.position">
                  <option value="center">{{ translateWithLocaleFallback('create.story2video.watermark.positionCenter', 'Center', 'Center') }}</option>
                  <option value="top-left">{{ translateWithLocaleFallback('create.story2video.watermark.positionTopLeft', 'Top left', 'Top left') }}</option>
                  <option value="top-right">{{ translateWithLocaleFallback('create.story2video.watermark.positionTopRight', 'Top right', 'Top right') }}</option>
                  <option value="bottom-left">{{ translateWithLocaleFallback('create.story2video.watermark.positionBottomLeft', 'Bottom left', 'Bottom left') }}</option>
                  <option value="bottom-right">{{ translateWithLocaleFallback('create.story2video.watermark.positionBottomRight', 'Bottom right', 'Bottom right') }}</option>
                  <option value="moving">{{ translateWithLocaleFallback('create.story2video.watermark.positionMoving', 'Moving (smooth drift)', 'Moving (smooth drift)') }}</option>
                </UiSelect>
                <p v-if="s2vConfig.watermarkConfig.position === 'moving'" class="config-hint">{{ translateWithLocaleFallback('create.story2video.watermark.movingHint', 'Moving is a smooth looping drift: the watermark starts near the center and wanders along a sine path, avoiding the flicker of per-frame random motion.', 'Moving is a smooth looping drift: the watermark starts near the center and wanders along a sine path, avoiding the flicker of per-frame random motion.') }}</p>
              </UiField>
              <UiField class="config-item" data-testid="s2v-watermark-fontsize" option-key="visual.watermarkFontSize" :label="translateWithLocaleFallback('create.story2video.watermark.fontSizeLabel', 'Watermark size', 'Watermark size')">
                <UiSelect v-model="s2vConfig.watermarkConfig.fontSize">
                  <option :value="16">16</option>
                  <option :value="24">24</option>
                  <option :value="32">32</option>
                  <option :value="40">40</option>
                  <option :value="48">48</option>
                </UiSelect>
                <span class="config-hint">{{ translateWithLocaleFallback('create.story2video.watermark.fontSizeHint', 'Larger sizes are more prominent; 24-40 recommended.', 'Larger sizes are more prominent; 24-40 recommended.') }}</span>
              </UiField>
              <UiField class="config-item" data-testid="s2v-watermark-opacity" option-key="visual.watermarkOpacity" :label="translateWithLocaleFallback('create.story2video.watermark.opacityLabel', 'Watermark opacity', 'Watermark opacity')">
                <UiSelect v-model="s2vConfig.watermarkConfig.opacity">
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
                </UiSelect>
                <span class="config-hint">{{ translateWithLocaleFallback('create.story2video.watermark.opacityHint', 'Lower opacity is subtler; 40% or higher recommended.', 'Lower opacity is subtler; 40% or higher recommended.') }}</span>
              </UiField>
              <UiField class="config-item" option-key="visual.imageProvider" label="图片生成器">
                <UiSelect v-model="s2vConfig.imageProvider">
                  <!-- 无可用图片生成器时下拉显示「无」，避免空白选中项（2026-08-12 Bug 修复） -->
                  <option v-if="s2vImageProviders.length === 0" value="">无</option>
                  <option v-for="provider in s2vImageProviderOptions" :key="provider.id" :value="provider.id">{{ provider.displayName }}</option>
                </UiSelect>
                <p v-if="s2vImageProviders.length === 0" class="config-hint">未找到可用的图片生成器，请先在「模型服务商」中配置并启用支持图片生成的模型（含多模态模型）。<a href="#/model-providers" class="config-hint-link">前往配置 →</a></p>
              </UiField>
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
              <span class="s2v-summary">{{ s2vSectionSummary('videoEnhance') }}<span v-if="s2vSectionAtDefault('videoEnhance')" class="s2v-summary-default">{{ $t('create.story2video.ui.sectionDefaultSuffix') }}</span></span>
            </summary>
            <div class="s2v-field-grid">
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
              <UiField class="config-item" option-key="videoEnhance.videoMode" :label="translateWithLocaleFallback('create.story2video.batch.videoModeLabel', '视频增强模式', 'Video enhancement mode')">
                <UiSelect v-model="s2vConfig.videoMode" testid="s2v-video-mode">
                  <option value="off">{{ translateWithLocaleFallback('videoConfig.videoModeOff', '纯图片轮播', 'Image carousel only') }}</option>
                  <option value="fixed">{{ translateWithLocaleFallback('videoConfig.videoModeFixed', '固定比例', 'Fixed ratio') }}</option>
                  <option value="ai-judged">{{ translateWithLocaleFallback('videoConfig.videoModeAiJudged', 'AI 智能选择', 'AI selected') }}</option>
                </UiSelect>
                <p class="config-hint">{{ translateWithLocaleFallback('create.story2video.videoModeHint', 'AI 视频更贵也更慢，仅用于最值得动态化的场景；其余场景继续图片轮播，节省额度。', 'AI video is more expensive and slower — used only for the most dynamic scenes; others use image carousel to save quota.') }}</p>
              </UiField>
              <!-- 单段视频短于分镜时长处理：仅 videoMode 为 fixed 或 ai-judged 时显示 -->
              <UiField v-if="s2vConfig.videoMode === 'fixed' || s2vConfig.videoMode === 'ai-judged'" class="config-item" :label="translateWithLocaleFallback('create.story2video.batch.shortVideoHandlingLabel', '单段视频短于分镜时长的处理', 'Handle short AI video clips')">
                <UiSelect v-model="s2vConfig.shortVideoHandling" testid="s2v-short-video-handling">
                  <option value="loop">{{ translateWithLocaleFallback('create.story2video.batch.shortVideoHandlingLoop', '循环播放', 'Loop playback') }}</option>
                  <option value="stop-at-end">{{ translateWithLocaleFallback('create.story2video.batch.shortVideoHandlingStopAtEnd', '播放完停止', 'Stop at end') }}</option>
                </UiSelect>
                <p class="config-hint">{{ translateWithLocaleFallback('create.story2video.batch.shortVideoHandlingHint', '仅在视频增强模式（固定比例/AI 智能选择）下生效。选择播放完停止时，AI 视频播放到最后一帧后将定格并慢慢放大。', 'Only applies in video enhancement mode (Fixed ratio / AI selected). When Stop at end is chosen, the AI video will freeze on the last frame and slowly zoom in.') }}</p>
              </UiField>
              <UiField v-if="s2vConfig.videoMode !== 'off'" class="config-item" :label="translateWithLocaleFallback('create.story2video.videoGenerator', '视频生成器', 'Video generator')">
                <UiSelect v-model="s2vConfig.videoProvider" @change="handleS2VVideoProviderChange" testid="s2v-video-provider">
                  <!-- 无可用视频生成器时下拉显示「无」，避免空白选中项（2026-08-12 审查 M2 对齐图片） -->
                  <option v-if="s2vVideoProviders.length === 0" value="">无</option>
                  <option v-for="provider in s2vVideoProviderOptions" :key="provider.id" :value="provider.id">{{ provider.displayName }}</option>
                </UiSelect>
                <p v-if="s2vVideoProviders.length === 0" class="config-hint">未找到可用的视频生成器，请先在「模型服务商」中配置并启用支持视频生成的模型。<a href="#/model-providers" class="config-hint-link">前往配置 →</a></p>
              </UiField>
              <div v-if="s2vConfig.videoMode === 'fixed'" class="config-item">
                <label>AI 视频占比: {{ s2vConfig.videoFixedRatio }}%（前段）</label>
                <UiSlider
                  v-model="s2vConfig.videoFixedRatio"
                  :min="10"
                  :max="50"
                  :step="5"
                  :default-value="25"
                  bare
                  suffix="%"
                  testid="s2v-video-fixed-ratio"
                  :aria-label="$t('create.story2video.ui.videoFixedRatioLabel')"
                />
                <p class="config-hint">成片前约 {{ s2vConfig.videoFixedRatio }}% 时长的场景使用 AI 视频（建议 20%-30%）。</p>
              </div>
              <div v-if="s2vConfig.videoMode === 'ai-judged'" class="config-item">
                <label>AI 视频占比区间: {{ s2vConfig.videoMinRatio }}% - {{ s2vConfig.videoMaxRatio }}%</label>
                <div class="config-item-inline">
                  <span class="config-hint">最少</span>
                  <UiSlider
                    v-model="s2vConfig.videoMinRatio"
                    :min="5"
                    :max="50"
                    :step="5"
                    :default-value="20"
                    bare
                    suffix="%"
                    testid="s2v-video-min-ratio"
                    :aria-label="$t('create.story2video.ui.videoMinRatioLabel')"
                  />
                  <span class="config-hint">最多</span>
                  <UiSlider
                    v-model="s2vConfig.videoMaxRatio"
                    :min="10"
                    :max="80"
                    :step="5"
                    :default-value="40"
                    bare
                    suffix="%"
                    testid="s2v-video-max-ratio"
                    :aria-label="$t('create.story2video.ui.videoMaxRatioLabel')"
                  />
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
              <span class="s2v-summary">{{ s2vSectionSummary('voice') }}<span v-if="s2vSectionAtDefault('voice')" class="s2v-summary-default">{{ $t('create.story2video.ui.sectionDefaultSuffix') }}</span></span>
            </summary>
            <div class="s2v-field-grid">
              <UiField class="config-item" option-key="voice.voiceProvider" label="语音生成器">
                <UiSelect v-model="s2vConfig.voiceProvider" @change="handleS2VVoiceProviderChange">
                  <!-- 首项「自动 Edge TTS」为常驻免费兜底（id=''），列表为空时下拉仍非空白；
                       仅补充配置引导提示（2026-08-12 复审 W1，与图片/视频空态提示对齐）。 -->
                  <option v-for="provider in s2vVoiceProviderOptions" :key="provider.id" :value="provider.id">{{ provider.displayName }}</option>
                </UiSelect>
                <p v-if="s2vVoiceProviders.length === 0" class="config-hint">未配置 TTS 模型时将使用自动 Edge TTS（免费）；如需 MiniMax 等语音模型与音色克隆能力，请先在「模型服务商」中配置。<a href="#/model-providers" class="config-hint-link">前往配置 →</a></p>
              </UiField>
              <UiField v-if="s2vConfig.voiceProvider && !s2vVoiceModelHidden" class="config-item" label="语音模型">
                <UiSelect
                  v-if="s2vVoiceModelOptions.length > 0"
                  v-model="s2vConfig.voiceModel"
                  @change="handleS2VVoiceModelChange"
                >
                  <option disabled value="">选择模型</option>
                  <option v-for="model in s2vVoiceModelOptions" :key="model" :value="model">{{ model }}</option>
                </UiSelect>
                <span v-else class="config-hint">当前服务商没有可用的语音模型。</span>
              </UiField>
              <UiField v-if="s2vConfig.voiceProvider && (s2vConfig.voiceModel || s2vVoiceModelHidden)" class="config-item" label="语音 / 音色 ID">
                <UiSelect
                  id="s2v-voice-catalog"
                  v-model="s2vConfig.voiceId"
                  :disabled="s2vVoiceCatalogLoading || s2vVoiceOptions.length === 0"
                  @change="handleS2VVoiceSelection"
                >
                  <option value="">使用服务商默认音色</option>
                  <option v-for="voice in s2vVoiceOptions" :key="voice.id" :value="voice.id" :disabled="voice.invalid">
                    {{ voice.invalid ? voice.name + '（已失效，请重新克隆）' : voice.name }}
                  </option>
                </UiSelect>
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
              </UiField>
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
              <span class="s2v-summary">{{ s2vSectionSummary('advanced') }}<span v-if="s2vSectionAtDefault('advanced')" class="s2v-summary-default">{{ $t('create.story2video.ui.sectionDefaultSuffix') }}</span></span>
            </summary>
            <div class="s2v-field-grid">
              <UiField class="config-item" option-key="advanced.contentType" label="内容类型">
                <UiSelect v-model="s2vConfig.contentType">
                  <option value="general">通用内容</option>
                  <option value="history">历史文章（自动识别时代与朝代）</option>
                </UiSelect>
              </UiField>
            </div>
            <div class="s2v-subgroup">
              <h4 class="s2v-subgroup-title">{{ s2vSubgroupLabel('splitTiming') }}</h4>
              <div class="s2v-field-grid">
                <UiField class="config-item" option-key="advanced.splitLanguage" label="分句语言">
                  <UiSelect v-model="s2vConfig.splitLanguage">
                    <option value="auto">自动识别</option>
                    <option value="zh">中文</option>
                    <option value="en">英文</option>
                  </UiSelect>
                </UiField>
                <UiField class="config-item" option-key="advanced.splitMode" label="分句模式">
                  <UiSelect v-model="s2vConfig.splitMode">
                    <option value="fast">快速</option>
                    <option value="balanced">均衡</option>
                    <option value="precise">精确</option>
                  </UiSelect>
                </UiField>
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
              <div class="s2v-field-grid">
                <UiField class="config-item" option-key="advanced.templateCategory" label="模板分类">
                  <UiSelect v-model="s2vTemplateCategory">
                    <option value="all">全部模板</option>
                    <option value="popular">热门</option>
                    <option value="business">商务</option>
                    <option value="creative">创意</option>
                    <option value="vlog">Vlog</option>
                    <option value="education">知识讲解</option>
                    <option value="custom">我的模板</option>
                  </UiSelect>
                </UiField>
                <UiField class="config-item" option-key="advanced.templateId" label="视频模板">
                  <UiSelect v-model="s2vConfig.templateId" @change="applyS2VTemplate">
                    <option v-for="template in s2vTemplates" :key="template.value" :value="template.value">{{ template.label }}</option>
                  </UiSelect>
                </UiField>
                <div class="config-item config-span-2">
                  <label>自定义模板</label>
                  <div class="template-editor">
                    <input v-model.trim="s2vCustomTemplateName" class="form-input" maxlength="80" placeholder="输入模板名称" />
                    <button type="button" class="btn-secondary" :disabled="!s2vCustomTemplateName" @click="saveCurrentS2VTemplate">保存当前参数</button>
                    <button v-if="selectedS2VTemplate?.category === 'custom'" type="button" class="btn-secondary danger" @click="requestTemplateDeletion">删除模板</button>
                  </div>
                </div>
                <UiField class="config-item" option-key="advanced.fps" label="帧率">
                  <UiSelect v-model.number="activeOutputConfig.fps">
                    <option :value="24">24 fps (电影)</option>
                    <option :value="30">30 fps (标准)</option>
                    <option :value="60">60 fps (流畅)</option>
                  </UiSelect>
                </UiField>
                <UiField class="config-item" option-key="advanced.format" label="格式">
                  <UiSelect v-model="activeOutputConfig.format">
                    <option value="mp4">MP4 (H.264)</option>
                    <option value="webm">WebM (VP9)</option>
                  </UiSelect>
                </UiField>
              </div>
            </div>
            <p class="s2v-controlled-defaults">部分高级运行参数由系统默认值管理。</p>
          </details>
          <details v-if="isOrchestratedPipeline(selectedPipeline.name) && s2vOptionVisible('publish._group')" class="s2v-config-section" data-testid="s2v-section-publish" :open="s2vOpenSections.publish" @toggle="setS2VSectionOpen('publish', $event)">
            <summary class="s2v-section-summary">
              <span>{{ s2vSectionLabel('publish') }}</span>
              <span class="s2v-summary">{{ s2vSectionSummary('publish') }}<span v-if="s2vSectionAtDefault('publish')" class="s2v-summary-default">{{ $t('create.story2video.ui.sectionDefaultSuffix') }}</span></span>
            </summary>
            <div class="s2v-field-grid">
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
        </div>
</template>

<script setup>
/**
 * S2vConfigPanels —— 故事讲述流水线的配置面板组（basic / visual / videoEnhance / voice / advanced / publish）。
 *
 * 本文件的模板是从 CreateView.vue 逐字节搬运而来（抽取任务），仅去掉了根节点上的
 * v-if="isOrchestratedPipeline(selectedPipeline.name)"，改由父级在组件标签上守卫。
 * 因此所有标识符必须与父级同名：状态经 inject 的只读取值器投影，方法经白名单转发，
 * 不得在此另写一份 optionKey -> target/field 的映射（见 s2v-panel-contract.js）。
 */
import { computed, inject } from 'vue';
import UiSkeleton from '@/components/UiSkeleton.vue';
import UiField from '@/components/UiField.vue';
import UiSelect from '@/components/UiSelect.vue';
import UiSlider from '@/components/UiSlider.vue';
import { useS2VPanel } from './s2v-panel-contract';

const panel = useS2VPanel(inject);
const { state, fns, setState } = panel;

// ---- 只读状态投影（computed 保证父级整体替换对象时仍取到最新引用）----
const activeOutputConfig = computed(() => state.activeOutputConfig);
const mediaRequirementsBgmText = computed(() => state.mediaRequirementsBgmText);
const outputResolutionOptions = computed(() => state.outputResolutionOptions);
const s2vActiveConfigProfile = computed(() => state.s2vActiveConfigProfile);
const s2vBgmLibrary = computed(() => state.s2vBgmLibrary);
// 模板内存在对 's2vCloneOpen' 的标量直写：可写 computed 回写父实例，行为等价于抽取前的 this.s2vCloneOpen = ...
const s2vCloneOpen = computed({ get: () => state.s2vCloneOpen, set: (v) => setState('s2vCloneOpen', v) });
const s2vConfig = computed(() => state.s2vConfig);
// 模板内存在对 's2vCustomTemplateName' 的标量直写：可写 computed 回写父实例，行为等价于抽取前的 this.s2vCustomTemplateName = ...
const s2vCustomTemplateName = computed({ get: () => state.s2vCustomTemplateName, set: (v) => setState('s2vCustomTemplateName', v) });
const s2vImageProviderOptions = computed(() => state.s2vImageProviderOptions);
const s2vImageProviders = computed(() => state.s2vImageProviders);
const s2vLegacyBgmPath = computed(() => state.s2vLegacyBgmPath);
const s2vMaxPromptLengthHint = computed(() => state.s2vMaxPromptLengthHint);
const s2vMaxPromptLengthLabel = computed(() => state.s2vMaxPromptLengthLabel);
const s2vMaxPromptLengthOptions = computed(() => state.s2vMaxPromptLengthOptions);
// 模板内存在对 's2vMinSceneDurationView' 的标量直写：可写 computed 回写父实例，行为等价于抽取前的 this.s2vMinSceneDurationView = ...
const s2vMinSceneDurationView = computed({ get: () => state.s2vMinSceneDurationView, set: (v) => setState('s2vMinSceneDurationView', v) });
const s2vOpenSections = computed(() => state.s2vOpenSections);
// 模板内存在对 's2vSceneDurationEnabled' 的标量直写：可写 computed 回写父实例，行为等价于抽取前的 this.s2vSceneDurationEnabled = ...
const s2vPlatforms = computed(() => state.s2vPlatforms);
const s2vSceneDurationEnabled = computed({ get: () => state.s2vSceneDurationEnabled, set: (v) => setState('s2vSceneDurationEnabled', v) });
const s2vSplitCharsPerSecond = computed(() => state.s2vSplitCharsPerSecond);
// 模板内存在对 's2vSplitCharsView' 的标量直写：可写 computed 回写父实例，行为等价于抽取前的 this.s2vSplitCharsView = ...
const s2vSplitCharsView = computed({ get: () => state.s2vSplitCharsView, set: (v) => setState('s2vSplitCharsView', v) });
const s2vSplitEstimatedSeconds = computed(() => state.s2vSplitEstimatedSeconds);
const s2vSplitMaxSeconds = computed(() => state.s2vSplitMaxSeconds);
// 模板内存在对 's2vSplitSecondsView' 的标量直写：可写 computed 回写父实例，行为等价于抽取前的 this.s2vSplitSecondsView = ...
const s2vSplitSecondsView = computed({ get: () => state.s2vSplitSecondsView, set: (v) => setState('s2vSplitSecondsView', v) });
// 模板内存在对 's2vTemplateCategory' 的标量直写：可写 computed 回写父实例，行为等价于抽取前的 this.s2vTemplateCategory = ...
const s2vTemplateCategory = computed({ get: () => state.s2vTemplateCategory, set: (v) => setState('s2vTemplateCategory', v) });
const s2vTemplates = computed(() => state.s2vTemplates);
const s2vVideoProviderOptions = computed(() => state.s2vVideoProviderOptions);
const s2vVideoProviders = computed(() => state.s2vVideoProviders);
const s2vVoiceCapability = computed(() => state.s2vVoiceCapability);
const s2vVoiceCatalogError = computed(() => state.s2vVoiceCatalogError);
const s2vVoiceCatalogLoading = computed(() => state.s2vVoiceCatalogLoading);
const s2vVoiceCatalogRefreshable = computed(() => state.s2vVoiceCatalogRefreshable);
const s2vVoiceCloneError = computed(() => state.s2vVoiceCloneError);
const s2vVoiceCloneLoading = computed(() => state.s2vVoiceCloneLoading);
const s2vVoiceClonePending = computed(() => state.s2vVoiceClonePending);
// 模板内存在对 's2vVoiceCloneRenameDraft' 的标量直写：可写 computed 回写父实例，行为等价于抽取前的 this.s2vVoiceCloneRenameDraft = ...
const s2vVoiceCloneRenameDraft = computed({ get: () => state.s2vVoiceCloneRenameDraft, set: (v) => setState('s2vVoiceCloneRenameDraft', v) });
const s2vVoiceCloneRenamingId = computed(() => state.s2vVoiceCloneRenamingId);
const s2vVoiceCloneRequirements = computed(() => state.s2vVoiceCloneRequirements);
const s2vVoiceCloneSelection = computed(() => state.s2vVoiceCloneSelection);
const s2vVoiceClones = computed(() => state.s2vVoiceClones);
const s2vVoiceModelHidden = computed(() => state.s2vVoiceModelHidden);
const s2vVoiceModelOptions = computed(() => state.s2vVoiceModelOptions);
const s2vVoiceOptions = computed(() => state.s2vVoiceOptions);
const s2vVoiceProviderOptions = computed(() => state.s2vVoiceProviderOptions);
const s2vVoiceProviders = computed(() => state.s2vVoiceProviders);
const selectedPipeline = computed(() => state.selectedPipeline);
const selectedS2VTemplate = computed(() => state.selectedS2VTemplate);
const story2videoImageStyleHint = computed(() => state.story2videoImageStyleHint);
const story2videoPromptStyleHint = computed(() => state.story2videoPromptStyleHint);

// ---- 方法转发 ----
const applyS2VTemplate = (...args) => fns.applyS2VTemplate(...args);
const cancelS2VVoiceCloneRename = (...args) => fns.cancelS2VVoiceCloneRename(...args);
const chooseS2VVoiceCloneSamples = (...args) => fns.chooseS2VVoiceCloneSamples(...args);
const deleteS2VVoiceClone = (...args) => fns.deleteS2VVoiceClone(...args);
const handleS2VVideoProviderChange = (...args) => fns.handleS2VVideoProviderChange(...args);
const handleS2VVoiceModelChange = (...args) => fns.handleS2VVoiceModelChange(...args);
const handleS2VVoiceProviderChange = (...args) => fns.handleS2VVoiceProviderChange(...args);
const handleS2VVoiceSelection = (...args) => fns.handleS2VVoiceSelection(...args);
const isOrchestratedPipeline = (...args) => fns.isOrchestratedPipeline(...args);
const isS2VDefaultVoice = (...args) => fns.isS2VDefaultVoice(...args);
const openBgmLibraryDialog = (...args) => fns.openBgmLibraryDialog(...args);
const previewS2VVoice = (...args) => fns.previewS2VVoice(...args);
const refreshS2VVoiceCatalog = (...args) => fns.refreshS2VVoiceCatalog(...args);
const renameS2VVoiceClone = (...args) => fns.renameS2VVoiceClone(...args);
const requestTemplateDeletion = (...args) => fns.requestTemplateDeletion(...args);
const s2vOptionVisible = (...args) => fns.s2vOptionVisible(...args);
const s2vSectionAtDefault = (...args) => fns.s2vSectionAtDefault(...args);
const s2vSectionLabel = (...args) => fns.s2vSectionLabel(...args);
const s2vSectionSummary = (...args) => fns.s2vSectionSummary(...args);
const s2vSubgroupLabel = (...args) => fns.s2vSubgroupLabel(...args);
const s2vVoiceCloneHint = (...args) => fns.s2vVoiceCloneHint(...args);
const s2vVoiceCloneStatusText = (...args) => fns.s2vVoiceCloneStatusText(...args);
const saveCurrentS2VTemplate = (...args) => fns.saveCurrentS2VTemplate(...args);
const selectS2VVoice = (...args) => fns.selectS2VVoice(...args);
const setS2VSectionOpen = (...args) => fns.setS2VSectionOpen(...args);
const startS2VVoiceCloneRename = (...args) => fns.startS2VVoiceCloneRename(...args);
const translateWithLocaleFallback = (...args) => fns.translateWithLocaleFallback(...args);
</script>
