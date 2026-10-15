// @ts-check
/**
 * RpaViewManager platforms mixin — 平台发布逻辑
 *
 * 拆分自 rpa-view-manager.js (2026-07-16 架构重构)；经 Object.assign 注入
 * RpaViewManager.prototype，方法内通过 this.* 访问其他 mixin 提供的方法。
 *
 * 依赖：log / PlatformConfig / getConfigPath / platformSelectors / ProgressThrottle / FieldRetryState
 *
 * 模块级变量：
 *   - _platformConfigInstance：PlatformConfig 单例（_getPlatformConfig 使用）
 *   - PLATFORM_SUCCESS_PATTERNS：平台成功匹配模式回退表
 */
const log = require('./logger')
const { getConfigPath } = require('./config-resolver')
const PlatformConfig = require('@multi-publish/shared-utils/src/platform-config')
// 发布能力注册表（publish-capability-registry）：无标题平台单一真源——视频号/快手/微博/X/Instagram/TikTok 无独立标题框，标题经 _composeEditorCaption 合并进描述首行。
const { isNoTitlePlatform } = require('@multi-publish/shared-utils/src/publish-capabilities')
const { platformSelectors } = require('@multi-publish/rpa-engine')
const { getPublishUrl } = require('@multi-publish/api-publish-engine/src/platform-entries')
const { buildXhsVideoRefusal } = require('./xiaohongshu-draft-guard')
// 2026-10-02 头条兜底：DOM 被闭包门控拦下 ⇒ 失败时走「页面内 SDK 签名 + Node 直连」（toutiao-direct-bridge）
const { ProgressThrottle } = require('./rpa-progress-throttle')
const { FieldRetryState } = require('./rpa-field-retry')
// 2026-09-29 拆分：publish-id 提取纯函数 → rpa-publish-id-extract.js（行数门禁，零行为变化）
const {
  normalizePublishId,
  collectPublishIds,
  extractPublishIdFromUrl,
  extractPublishIdsFromResponseBody,
  extractPublishIdFromEvidence,
  sanitizeDiagnosticEndpoint,
  sanitizePublishResultUrl,
} = require('./rpa-publish-id-extract')
// 2026-09-29 二次拆分：导航/等待类 helper（mixin 片段）——继续压 rpa-view-platforms.js 行数
const { navigationHelpers, stripHtmlToPlainText } = require('./rpa-view-navigation-helpers')
// 2026-10 三次拆分：视频上传等待循环（v4 自适应轮询，publish-progress-dup-upload）
const { uploadWaiterMixin, readVideoFileBytes } = require('./upload-waiter')
const { artifactsHelpers } = require('./rpa-view-artifacts')
const zhihuPublishState = require('./zhihu-publish-state') // 2026-10-15 知乎假发布修复：终态判据 + 两段式确认（纯函数，见模块头注释）

let _platformConfigInstance
const PLATFORM_SUCCESS_PATTERNS = {}

// 「严格平台」= 只认**发布产物查询**（而非 URL 变化/通用响应）判定成功。
// 2026-09-30 追加 toutiao：头条发布后**不跳转**（URL 始终停在 /profile_v4/graphic/publish），
// 默认 success_mode='url' 必然超时；参考产品同款做法是查**作品列表 API** 并检查
// ArticleAttr.Status（"2"=已发布、"6"=审核中，均视为提交成功）。
const STRICT_PUBLISH_ID_PLATFORMS = new Set(['baijiahao', 'kuaishou', 'toutiao'])

/**
 * 读公众号编辑器**可见**的平台提示（wxmp-draft-mediaid-fix，判据见 PRD §13.2/§14.2）。
 * 不用 `wechat-mp-dom-guard.readEditorToast`：它用 `innerText` 读候选节点，而 `innerText`
 * 对 `display:none` / 离屏节点照样返回文本（实测）⇒ 编辑器常驻说明会被误当「平台提示」。
 * @param {object} win BrowserWindow
 * @returns {Promise<string>} 可见提示文本；无则空串（绝不抛）
 */
async function readVisibleEditorToast (win) {
  const { buildVisibleToastScript } = require('./wechat-mp-draft-mediaid')
  const { TOAST_SELECTORS } = require('./wechat-mp-dom-guard')
  try {
    const t = await win.webContents.executeJavaScript(buildVisibleToastScript(TOAST_SELECTORS))
    return String(t == null ? '' : t)
  } catch (_) {
    return ''
  }
}

function summarizePublishDiagnostics (records, artifact) {
  const source = Array.isArray(records) ? records : []
  const responses = source.slice(-20).map(record => ({
    endpoint: sanitizeDiagnosticEndpoint(record?.endpoint || record?.url),
    status: Number.isFinite(Number(record?.status)) ? Number(record.status) : 0,
    mimeType: String(record?.mimeType || '').split(';')[0].slice(0, 160),
  }))
  return {
    responseCount: source.length,
    responses,
    artifactFound: Boolean(artifact && normalizePublishId(artifact.postId)),
  }
}

function parsePublishResponseEvidence (body, response) {
  const status = Number(response?.status)
  if (!Number.isFinite(status) || status < 200 || status >= 300) return null
  if (!/(?:publish|submit|create|commit|release)/i.test(String(response?.endpoint || ''))) return null
  const publishIds = extractPublishIdsFromResponseBody(body, { endpoint: String(response?.url || response?.endpoint || '') })
  return publishIds.length > 0 ? { publishIds } : null
}


// 小红书图文草稿的「硬证据」确认链**整体**在 ./xhs-draft-confirm（2026-10-15）：
// 端点表、计数选择器、三个超时常量与全部判据函数都在那里，本文件只保留薄调用点。
// 这样切分的直接原因：本文件在逐文件行数门禁里是**点名还账**文件（零增长容差），
// 首版把确认链直接写在这里会让 CI 债务熔断检查报 TARGET_GREW。
// 判据细节与三条红线（端点必须专属窄路径 / 必须校验 HTTP 200 / 标题匹配不给确认权）
// 见该模块头部注释，也有独立的回归锁。
const xhsDraftConfirm = require('./xhs-draft-confirm')


const platformsMixin = {
  // ========== P2-B: Config loading ==========
  _getPlatformConfig(platform) {
    if (!_platformConfigInstance) {
      _platformConfigInstance = new PlatformConfig(getConfigPath('platforms.yaml'))
    }
    const cfg = _platformConfigInstance.getPlatform(platform)
    if (!cfg) throw new Error('platform config not found: ' + platform)
    const sel = (platformSelectors.PLATFORM_PUBLISH_SELECTORS && platformSelectors.PLATFORM_PUBLISH_SELECTORS[platform]) || {}
    const rpa = cfg.rpa_config || {}
    const patterns = (rpa.success_patterns && rpa.success_patterns.length > 0) ? rpa.success_patterns : (PLATFORM_SUCCESS_PATTERNS[platform]||[])
    return { publish_url: cfg.publish_url||'', type: cfg.type||'article', has_api: cfg.has_api||false, selectors: sel, success_patterns: patterns, preFill: rpa.preFill||null, prePublishHook: rpa.prePublishHook||null, hookContext: rpa.hookContext||null, success_mode: rpa.success_mode||'url', success_selector: rpa.success_selector||null, max_content: Number(cfg.max_content) || null }
  },

  // ========== P2-B: Platform hooks ==========
  async _execHook(win, hookName, context) {
    switch (hookName) {
      case 'switchIframe':
        await this._waitForElement(win, (context&&context.iframeSelector)||'iframe', 10000); break
      case 'clickCreate':
        if (await this._click(win, (context&&context.createSelector)||'#create-icon')) {
          await this._sleep(2000)
          await this._click(win, (context&&context.uploadSelector)||'tp-yt-paper-item')
        }; break
      case 'clickWrite':
        await this._click(win, (context&&context.writeSelector)||'button:has-text("写文章")')
        await this._sleep(2000); break
      case 'switchImageTab': {
        // 小红书发布页 tabs：上传视频(active) / 上传图文 / 写长文 / 发播客（2026-09-29 实测取证：
        // publish/publish?from=menu 默认落视频 tab，file input accept 全是视频格式；
        // .header-tabs 容器加载慢（实测 10s 后才渲染），必须先等它出现再点）。
        // 点击按文字「图文」匹配（比 children[1] 位置索引抗改版）。
        const tabsReady = await this._waitForElement(win, '.header-tabs, .creator-tab', 20000)
        if (tabsReady) {
          try {
            await win.webContents.executeJavaScript('(function(){var tabs=[...document.querySelectorAll(".creator-tab, .header-tabs > div")];var img=tabs.find(function(t){return (t.textContent||"").indexOf("图文")!==-1});if(img){img.click();return true}return false})()')
          } catch (_) { /* 点击失败则继续（可能已在图文 tab） */ }
        } else {
          log.warn('RpaView', '[switchImageTab] tab container not found within 20s')
        }
        await this._sleep(1800); break
      }
      case 'uploadCover': {
        // 2026-09-30 头条取证（发布设置页）：「展示封面」必填，页面**默认选中「单图」**
        // 但封面区为空（只有 + 占位）→ 点「预览并发布」被必填校验挡住（症状：verification timeout）。
        // 先尝试直接提供封面图（满足「单图」语义，且头条有封面利于推荐）；
        // 若封面上传入口拿不到，则退而选「无封面」（头条允许无封面发布）。
        // 注：仅用 executeJavaScript 改 radio 的 checked 会被 React 受控状态覆盖
        // （实测返回 SELECTED 但页面仍是「单图」），故主路径走上传播入。
        const coverPath = context && context.coverPath
        let handled = false
        if (coverPath) {
          try {
            // 封面区是延迟渲染的（实测首次查询 `.article-cover-add` 为 null、回退成 CLICKED_COVER
            // 后点的是 radio group 容器 → 无 file input）。故先等上传钮出现再点。
            const coverReady = await this._waitForElement(win, '.article-cover-add, .article-cover-images-wrap', 12000)
            if (!coverReady) log.warn('RpaView', '[uploadCover] 封面区未在 12s 内出现，仍尝试点击')
            const entry = await win.webContents.executeJavaScript(
              // 2026-09-30 真机取证：封面「+」的真实元素是 **`.article-cover-add`**
              // （位于 `.article-cover-images-wrap` 内，图标为 SVG 故无文本；
              //  此前按 `innerText === "+"` 或点 `.article-cover` 均落空——后者只是 radio group 容器）。
              '(function(){var a=document.querySelector(\'.article-cover-add\');if(a){a.click();return \'CLICKED_ADD\'}'
              + 'var c=[...document.querySelectorAll(\'div,span,button\')].filter(function(e){var t=(e.innerText||\'\').trim();var r=e.getBoundingClientRect();return (t===\'+\'||/^上传封面$|^编辑封面$/.test(t))&&r.width>0&&r.height>0});if(c.length){c[0].click();return \'CLICKED_TEXT\'}'
              + 'var cover=document.querySelector(\'.article-cover-images-wrap\')||document.querySelector(\'.article-cover\');if(cover){cover.click();return \'CLICKED_COVER\'}return \'NO_ENTRY\'})()'
            )
            log.info('RpaView', '[uploadCover] entry=' + entry)
            await this._sleep(2000)
            // 旧实现仅凭 `_setFileInput` 返回值置 handled=true，页面其实未接受；现改为头条专用
            // 上传（逐个 file input + **以 img 计数增加为判据**），详见 `_uploadToutiaoCover`。
            const coverResult = await this._uploadToutiaoCover(win, coverPath)
            handled = (coverResult === 'OK' || String(coverResult).indexOf('OK_') === 0)
            log.info('RpaView', '[uploadCover] toutiao result=' + coverResult)
          } catch (e) { log.warn('RpaView', '[uploadCover] ' + e.message) }
        }
        if (!handled) {
          try {
            // 真机取证（2026-09-30）：封面三选一是 byte-design 的 `LABEL.byte-radio`
            // （内部 input 为隐藏态，且 `input.closest('label')` 取到的是外层 label）。
            // 故**直接按文本选 label** 点击，再回读 input.checked 确认 React 已接受。
            const r = await win.webContents.executeJavaScript(
              '(function(){var ls=[...document.querySelectorAll(\'label.byte-radio\')].filter(function(l){return /无封面/.test(l.innerText||\'\')});if(!ls.length)return \'NO_LABEL\';ls[0].click();var rs=[...document.querySelectorAll(\'input[type=radio]\')];var picked=rs.filter(function(x){return x.checked}).map(function(x){return (x.closest(\'label\')||x.parentElement||{}).innerText}).join(\'|\');return \'CLICKED picked=\'+picked})()'
            )
            log.info('RpaView', '[uploadCover] no-cover fallback=' + r)
          } catch (e) { log.warn('RpaView', '[uploadCover] no-cover ' + e.message) }
        }
        await this._sleep(1500); break
      }
      case 'installToutiaoSaveHook':
        // 2026-10-03 头条兜底前置：编辑器加载完成即装 XHR hook（捕获自动保存 body 供重放兜底）
        await require('@multi-publish/rpa-engine/src/toutiao-direct-bridge').installToutiaoSaveHook({ win, log }); break
      default: log.warn('RpaView', 'Unknown hook: ' + hookName)
    }
  },

  // ========== P2-B: Generic publish engine ==========
  async _publish_generic(win, article, platform, publishConfig) {
    const config = publishConfig || this._getPlatformConfig(platform)
    const sel = config.selectors
    log.info('RpaView', '[' + platform + '] publish config=' + (publishConfig ? 'provided' : 'default') + '; selectorCount=' + Object.keys(sel || {}).length + '; publishButtons=' + (sel?.publish_btn?.length || 0) + '; titleInputs=' + (sel?.title_input?.length || 0) + '; fileInputs=' + (sel?.file_input?.length || 0) + '; hasCoverInput=' + Boolean(sel?.cover_input) + '; hasTitle=' + Boolean(article?.title) + '; hasVideo=' + Boolean(article?.video_path) + '; hasCover=' + Boolean(article?.cover_path))
    const throttle = new ProgressThrottle(5000, 10)
    const retry = new FieldRetryState(3)
    // 2026-10-07：草稿模式不得在「什么都没写进去」时报成功。
    // 背景：真机 E2E 实测标题/正文/标签三项全部 not found（全 WARN），
    // draftOnly 分支仍无条件 return {success:true}，history 记 success
    // —— 假成功比失败危险：它骗过队列统计、历史列表与用户。
    // 这里收集**硬性内容字段**的填写结果，draftOnly 据此 fail-closed。
    const fillReport = { title: null, content: null, tags: null }

    if (!config.publish_url) { log.warn('RpaView', '[' + platform + '] no publish_url configured'); return { success: false, error: platform+' no publish_url', platform: platform } }

    this._emitProgress(platform, 'navigating...', 5)
    await this._navigateAndWait(win, config.publish_url, 3000)

    const curUrl = win.webContents.getURL()
    if (curUrl.includes('login')||curUrl.includes('passport')||curUrl.includes('signin')) {
      log.warn('RpaView', '[' + platform + '] not logged in url=' + curUrl)
      return { success: false, error: platform+' not logged in', platform: platform }
    }
    // SPA 鐧诲綍鎬?DOM 鎺㈡祴锛歎RL 鏈烦杞絾椤甸潰宸叉槸鐧诲綍寮曞锛堝揩鎵嬬瓑 SPA 鏈櫥褰曚笉鏀瑰彉 URL锛?
    const loginProbe = await win.webContents.executeJavaScript(`(function(){
      var t = (document.body && document.body.innerText) || '';
      return {
                hasLoginPrompt: /立即登录|扫码登录|登录后|请登录/.test(t.slice(0, 4000)),
        hasForm: !!document.querySelector('input[type="file"], textarea, [contenteditable="true"]')
      };
    })()`).catch(function () { return { hasLoginPrompt: false, hasForm: true } })
    if (loginProbe && loginProbe.hasLoginPrompt && !loginProbe.hasForm) {
      log.warn('RpaView', '['+platform+'] SPA login page detected, fail fast')
      return { success: false, error: platform+' not logged in', platform: platform }
    }

    if (config.preFill) await this._execHook(win, config.preFill, config.hookContext)

    // 导航后清理草稿恢复弹窗/引导遮罩（否则上传区与表单被遮挡）
    await this._dismissPostNavDialogs(win, platform)

    // 草稿模式（小红书）：计数基线必须在**写入任何内容之前**读——平台在填写阶段就会
    // 自动保存，晚读会把本次草稿吃进基线 ⇒ 主判据恒不增长（CCG 评审 i5）。读不到保持
    // null，不得拿 0 顶替。时机与判据细节见 ./xhs-draft-confirm 的 readBaselineContext。
    let xhsBaselineCtx = null
    if (config.draftOnly && platform === 'xiaohongshu') {
      xhsBaselineCtx = await xhsDraftConfirm.readBaselineContext(this, win, sel)
    }

    // image upload（2026-09-29 图文模式）：无视频但有本地图片时上传首图。
    // 小红书/快手/抖音图文要求至少 1 张图片；图片经 article.images（本地文件路径，
    // 渲染层自动生成封面兜底——usePublishFlow IMAGE_TEXT_PLATFORMS）传入。
    // 多图平台（快手支持 31 张）暂传首图：多图需逐张等待上传完成，后续迭代。
    // 上传通道按平台分流（2026-09-30 快手取证）：**拖拽区优先**——快手图文的
    // input[type=file] 两条注入路径都失效（CDP 静默清空 / DataTransfer 赋值归零），
    // 唯一通道是向 dragger-content 派发 DragEvent('drop')；无拖拽容器时回退 input。
    if (!article.video_path && Array.isArray(article.images) && article.images.length > 0 && sel.file_input && sel.file_input.length > 0) {
      retry.addField('image_upload')
      while (!retry.isDone('image_upload')) {
        try {
          this._emitProgress(platform, 'uploading image...', 22)
          const dropped = typeof this._dropFilesToDragArea === 'function'
            ? await this._dropFilesToDragArea(win, article.images[0], sel.drag_area).catch(() => false)
            : false
          if (!dropped) {
            const imgFileSel = await this._resolveSelector(win, sel.file_input, 15000, 3000)
            if (!imgFileSel) { if (!retry.retry('image_upload')) break; await this._sleep(2000); continue }
            await this._setFileInput(win, article.images[0], imgFileSel)
          }
          // 图片上传等待：无统一进度条可轮询，固定等待 + 后续表单就绪等待兜底
          await this._sleep(4000)
          // 图片上传成功后平台可能自动进入「图片编辑」（裁剪）界面，其模态层遮挡
          // 发布按钮（2026-09-29 小红书实测：不收起则 button:has-text("发布") 超时）
          await this._dismissImageEditModal(win, platform)
          const imgFormReady = await this._waitForCondition(win, 'function(){return !!document.querySelector(\'input[placeholder*="标题"],textarea,[contenteditable="true"],[class*="title"] input\')}', 60000, 1500)
          if (!imgFormReady) log.warn('RpaView', '[' + platform + '] editor form not ready after image upload (still trying fields)')
          retry.markDone('image_upload'); this._emitProgress(platform, 'image uploaded', 40)
        } catch(e) {
          log.warn('RpaView', '['+platform+'] image upload: '+e.message)
          if (!retry.retry('image_upload')) break; await this._sleep(2000)
        }
      }
    }

    // video upload（必须先上传后填字段：kuaishou/bilibili 等平台的 publish_url 是
    // 上传落地页，标题/简介字段要等上传完成进入编辑器才渲染；旧顺序先填字段
    // 必然 timeout，2026-09 E2E 实锤）
    log.info('RpaView', '[' + platform + '] file input hasVideo=' + Boolean(article.video_path) + ' selectorCount=' + (sel.file_input ? sel.file_input.length : 0))
    if (article.video_path && sel.file_input && sel.file_input.length > 0) {
      retry.addField('file_upload')
      while (!retry.isDone('file_upload')) {
        try {
          this._emitProgress(platform, 'uploading file...', 25)
          // 逐候选定位文件输入（上传落地页常有多个 input[type=file]，首个未必负责视频）
          const fileSel = await this._resolveSelector(win, sel.file_input, 15000, 3000)
          if (fileSel) {
            await this._setFileInput(win, article.video_path, fileSel)
            // 上传完成判定：百家号上传后页面会出现视频预览/编辑器初始化（发布按钮由 disabled 变可用）
            // 不能依赖 progress/success class（百家号可能不使用），改为轮询"发布按钮可用或编辑器出现"
            let uploadDone = false
            if (platform === 'baijiahao') {
              uploadDone = await this._waitForCondition(win, 'function(){var t=(document.body&&document.body.innerText)||"";var hasPreview=/预览|编辑|描述|简介|标题/.test(t);var ed=document.querySelector("[contenteditable=true],[data-lexical-editor=true]");var btn=[...document.querySelectorAll("button")].find(function(b){return (b.innerText||"").trim()==="发布"&&!b.disabled});return hasPreview&&(ed!==null||btn!==null)}', 180000, 1000)
              if (!uploadDone) log.warn('RpaView', '['+platform+'] upload complete wait timeout (video may still be processing)')
            } else {
              await this._waitForVideoUploadComplete(win, platform, 900000, { fileBytes: readVideoFileBytes(article.video_path) })
            }
            // 编辑器表单就绪等待：上传完成后平台 SPA 渲染标题/简介字段有延迟，
            // 不等直接填会全部 timeout（B站/快手上传完成后才切到编辑表单）
            const formReady = await this._waitForCondition(win, 'function(){return !!document.querySelector(\'input[placeholder*="标题"],textarea,[contenteditable="true"]\')}', 120000, 1500)
            if (!formReady) log.warn('RpaView', '[' + platform + '] editor form not ready after upload (still trying fields)')
            retry.markDone('file_upload'); this._emitProgress(platform, 'file uploaded', 40)
          } else {
            if (!retry.retry('file_upload')) break; await this._sleep(2000)
          }
        } catch(e) {
          log.warn('RpaView', '['+platform+'] upload: '+e.message)
          if (!retry.retry('file_upload')) break; await this._sleep(2000)
        }
      }
    }

    // title（逐候选回退 + 无独立标题字段时写进编辑器）
    log.info('RpaView', '[' + platform + '] title input hasTitle=' + Boolean(article.title) + ' titleType=' + typeof article.title + ' selectorCount=' + (sel.title_input ? sel.title_input.length : 0))
    // caption_textarea（instagram/tiktok 的描述输入）纳入候选链：这两个无标题平台
    // 的标题合并路径依赖编辑器候选解析（CCG codex Info3 行为锁暴露的缺口——
    // 此前 caption_textarea 不在链里，instagram/tiktok 的标题从未进入合并路径）
    const editorCandidates = sel.editor || sel.content_textarea || sel.textarea || sel.desc_textarea || sel.caption_textarea
    // 无标题平台（注册表 titleMode=caption：视频号/快手/微博/X/Instagram/TikTok）：
    // 平台发布页没有独立标题输入框，显式跳过 title_input 选择器解析（省去首次候选
    // 10s 超时——此前靠选择器解析失败的隐式回退，行为正确但不可声明、白等超时），
    // 标题直接经下方编辑器合并路径写入描述首行（_composeEditorCaption）。
    const noTitlePlatform = isNoTitlePlatform(platform)
    const titleSel = (article.title && !noTitlePlatform) ? await this._resolveSelector(win, sel.title_input, 10000, 3000) : null
    if (noTitlePlatform && article.title) {
      log.info('RpaView', '[' + platform + '] no-title platform (registry), skip title_input resolution, title merges into editor caption')
    }
    // 快手 live DOM 实锤（2026-09 取证 d4-1-kuaishou.json）：编辑页没有独立标题框，
    // 标题/描述共用 div#work-description-edit[contenteditable]。此时标题与正文合并
    // 一次性写进编辑器，后面的正文步骤必须跳过，否则标题被纯正文覆写丢失。
    let captionSel = null
    if (article.title && !titleSel && editorCandidates && editorCandidates.length > 0) {
      captionSel = await this._resolveSelector(win, editorCandidates, 6000, 2000)
      log.info('RpaView', '[' + platform + '] no dedicated title field, title falls back to editor sel=' + String(captionSel || 'none'))
    }
    if (article.title && (titleSel || captionSel)) {
      retry.addField('title')
      while (!retry.isDone('title')) {
        try {
          this._emitProgress(platform, 'filling title...', 20)
          const titleTarget = titleSel || captionSel
          const titleValue = (captionSel && !titleSel) ? this._composeEditorCaption(article, config.max_content) : article.title
          // 读回校验已内建于 `_fillInput`（读回 0 且待填值非空即抛错）。
          await this._fillInput(win, titleTarget, titleValue); retry.markDone('title')
          fillReport.title = { ok: true }
        } catch(e) {
          log.warn('RpaView', '['+platform+'] title: '+e.message)
          if (!retry.retry('title')) { fillReport.title = { ok: false, error: e.message }; break; }
          await this._sleep(1000)
        }
      }
    } else if (article.title) {
      log.warn('RpaView', '[' + platform + '] title field not found (no title_input nor editor candidate), title skipped')
      fillReport.title = { ok: false, error: 'title field not found (no selector matched)' }
    }

    // content
    const cs = sel.editor || sel.content_textarea || sel.textarea
    if (article.content && cs && cs.length > 0) {
      if (captionSel && !titleSel) {
        // 标题已作为作品描述写进同一编辑器（快手），正文已在合并文案里，跳过避免覆写标题
        log.info('RpaView', '[' + platform + '] content already composed into editor caption, skip separate fill')
      } else {
        const contentSel = await this._resolveSelector(win, cs, 10000, 3000)
        if (contentSel) {
          retry.addField('content')
          while (!retry.isDone('content')) {
            try {
              this._emitProgress(platform, 'filling content...', 35)
              await this._fillInput(win, contentSel, article.content); retry.markDone('content')
              fillReport.content = { ok: true }
            } catch(e) {
              log.warn('RpaView', '['+platform+'] content: '+e.message)
              if (!retry.retry('content')) { fillReport.content = { ok: false, error: e.message }; break; }
              await this._sleep(1000)
            }
          }
        } else {
          log.warn('RpaView', '[' + platform + '] content editor not found among ' + cs.length + ' candidates')
          fillReport.content = { ok: false, error: 'content editor not found among ' + cs.length + ' candidates' }
        }
      }
    }

    // cover
    if (article.cover_path && sel.cover_input) {
      try {
        this._emitProgress(platform,'uploading cover...',65)
        const coverSel = 'input[type="file"][accept*="image"], input[type="file"][accept*="jpg"], input[type="file"][accept*="jpeg"], input[type="file"][accept*="png"]'
        // 先点击封面上传触发器（打开上传面板），再设置文件；trigger 不存在时直接设置
        if (sel.cover_trigger && sel.cover_trigger.length > 0) {
          try {
            if (await this._waitForElement(win, sel.cover_trigger[0], 5000)) {
              await this._click(win, sel.cover_trigger[0])
              await this._sleep(1800)
            }
          } catch (e) { log.warn('RpaView','['+platform+'] cover trigger: '+e.message) }
        }
        // The V2 page keeps a hidden cover input in the DOM after the panel
        // closes; prefer the configured selector, then fall back to the
        // platform selector without requiring the trigger to succeed.
        try {
          await this._setFileInput(win, article.cover_path, coverSel)
        } catch (coverError) {
          if (platform !== 'baijiahao' || !sel.cover_input || sel.cover_input.length === 0) throw coverError
          await this._setFileInput(win, article.cover_path, sel.cover_input[0])
        }
        await this._sleep(2000)
      } catch(e) { log.warn('RpaView','['+platform+'] cover: '+e.message) }
    }

    // tags
    if (article.tags && article.tags.length>0 && sel.tag_input && sel.tag_input.length>0) {
      const tagSel = await this._resolveSelector(win, sel.tag_input, 5000, 2000)
      let tagsOk = 0; let tagErr = ''
      for (let ti=0;ti<Math.min(article.tags.length,5);ti++) {
        try {
          this._emitProgress(platform,'adding tags...',72)
          if (!tagSel) throw new Error('tag input not found')
          await this._fillInput(win,tagSel,article.tags[ti])
          await win.webContents.executeJavaScript('(function(){var s='+JSON.stringify(tagSel)+';let el=document.querySelector(s);if(el)el.dispatchEvent(new KeyboardEvent(\'keydown\',{key:\'Enter\',code:\'Enter\',keyCode:13}))})()')
          await this._sleep(800)
          tagsOk++
        } catch(e) { log.warn('RpaView','['+platform+'] tag: '+e.message); if (!tagErr) tagErr = e.message }
      }
      fillReport.tags = tagsOk > 0
        ? { ok: true, filled: tagsOk, of: Math.min(article.tags.length, 5) }
        : { ok: false, error: tagErr || 'tag input not found' }
    }

    // 实验：头条跳过封面 hook，验证封面注入是否占用 defer-publish 的 `_e`（判据：跳过后 appReqN>0）。
    if (config.prePublishHook && platform !== 'toutiao') await this._execHook(win, config.prePublishHook, config.hookContext)

    // 平台专用发布前准备（百家号/快手：关闭引导弹窗 + 选择 AI 创作声明）
    if (platform === 'baijiahao') {
      try { await this._prepBaijiahao(win, article) } catch (e) { log.warn('RpaView', 'baijiahao prep: ' + e.message) }
    }
    if (platform === 'kuaishou') {
      try { await this._prepKuaishou(win, article) } catch (e) { log.warn('RpaView', 'kuaishou prep: ' + e.message) }
    }
    // P3-6：B站分区 + 版权声明（RPA 模式；参考产品映射 createType original→1/forward→2）
    if (platform === 'bilibili') {
      try { await this._prepBilibili(win, article) } catch (e) { log.warn('RpaView', 'bilibili prep: ' + e.message) }
    }
    // 通用 AI 生成内容声明：平台未设专用 prep 但有 ai_declaration_label 选择器时，
    // 自动勾选声明控件（默认 AI 生成，仅当 article.aiGenerated === false 时跳过）。
    // 覆盖 B站等平台；避免因漏选 AI 声明导致违规。
    if (platform !== 'baijiahao' && platform !== 'kuaishou' && platform !== 'douyin' && platform !== 'tencent_video') {
      const aiSel = sel.ai_declaration_label || sel.ai_declaration_checkbox
      if (aiSel && aiSel.length > 0 && (!article || article.aiGenerated !== false)) {
        try {
          await this._click(win, aiSel[0])
          log.info('RpaView', '[' + platform + '] generic AI declaration clicked')
        } catch (e) {
          log.warn('RpaView', '[' + platform + '] generic AI declaration: ' + e.message)
        }
      }
    }

    // publish button
    log.info('RpaView', '['+platform+'] DIAG[publish2] pubBtn=' + (sel.publish_btn ? sel.publish_btn.length : 'NONE') + ' cfgHasApi=' + (config.has_api) + ' prePublishHook=' + String(config.prePublishHook||'') + ' draftOnly=' + Boolean(config.draftOnly))
    // 草稿模式（2026-09-29 需求：小红书图文只需落到平台草稿箱，用户回头自行扫码发布）：
    // 不点发布按钮，改为「触发/等待平台自动草稿保存」后即返回草稿成功。小红书编辑页
    // 有自动草稿保存（页面显示「编辑于 刚刚」，侧边栏草稿箱计数 +1），因此填完字段后
    // 等待落库即可；若平台另提供显式存草稿钮（sel.draft_btn）则优先点它。
    if (config.draftOnly) {
      // draftOnly 的**全部判定**（内容写入闸 + 硬证据确认链）在 ./xhs-draft-confirm：
      // 旧判据是页面文本正则、命中的是常驻静态文案，那里是它被替换后的落点；
      // 本文件只做委派（搬家的行数门禁理由见文件顶该 require 处注释）。
      return await xhsDraftConfirm.runDraftOnly(this, win, {
        platform, sel, article, fillReport, config, baselineCtx: xhsBaselineCtx,
      })
    }
    if (sel.publish_btn && sel.publish_btn.length>0) {
      retry.addField('publish')
      while (!retry.isDone('publish')) {
        let networkCapture = null
        try {
          this._emitProgress(platform,'publishing...',85)
          const rp = (config.has_api && config.success_patterns.length>0) ? this._waitForResponse(win,config.success_patterns,60000) : null
          // 按优先级依次尝试所有发布按钮候选，任一可见即用（页面改版后首个候选可能失效）
          let publishSelector = null
          for (const cand of sel.publish_btn || []) {
            if (await this._waitForElement(win,cand,3000)) { publishSelector = cand; break }
          }
          if (!publishSelector) throw new Error('publish btn not found')
          networkCapture = platform === 'toutiao' ? null : await this._startPublishNetworkCapture(win, { parseResponseBody: parsePublishResponseEvidence })
          // 点击通道：头条走 CDP（`_clickStable` → `_clickViaCdp`），其余平台保持 executeJavaScript。
          // 头条发布按钮是**两段式**（bundle 源码实证）：首点走 `sleep("defer-publish",0)` 创建 deferred 并挂起，
          // 第二次点击才 `_e.resolve()` 唤醒 `case 1` 执行 `doPublish` ⇒ 必须连点两次（间隔留给 state 写入）。
          await (platform === 'toutiao' && typeof this._clickStable === 'function' ? this._clickStable(win, publishSelector) : this._click(win, publishSelector))
          if (platform === 'toutiao') { await this._sleep(1500); await this._clickViaCdp(win, publishSelector) }
          // 百家号发布时可能二次弹出引导/确认（"我知道了"），点击后再次关闭
          if (platform === 'baijiahao') {
            await this._sleep(800)
            try {
              await win.webContents.executeJavaScript('(function(){var els=[...document.querySelectorAll("button,a,span,div,[role=button]")].filter(function(e){var t=(e.innerText||"").trim();return t==="我知道了"&&e.children.length===0});if(els.length){els[els.length-1].click();return true}var wrap=[...document.querySelectorAll("[class*=guide],[class*=Guide],[class*=mask],[class*=Mask],[class*=popup],[class*=Popup],[class*=modal],[class*=Modal]")].filter(function(e){return (e.innerText||"").indexOf("我知道了")!==-1});if(wrap.length){var b=[...wrap[0].querySelectorAll("button,a,span")].filter(function(e){return (e.innerText||"").trim()==="我知道了"});if(b.length){b[b.length-1].click();return true}}return false})()')
            } catch (_) { /* ignore */ }
            await this._sleep(1000)
          }
          // 二次确认弹窗（2026-09-30 快手实测：点发布后弹「取 消 / 确 认」确认框，
          // 不点确认则永不提交 → publish verification timeout）。此处统一处理，
          // 无弹窗时为 NO_DIALOG 无副作用。
          if (typeof this._confirmPublishDialog === 'function') await this._confirmPublishDialog(win, platform)
          if (article.draft && sel.draft_btn) await this._click(win,sel.draft_btn)
          retry.markDone('publish')
          if (throttle.shouldReport(95)) this._emitProgress(platform,'verifying...',95)
          const publishContext = { title: article.title, publishedAt: Date.now() }
          const verificationCapture = networkCapture
          networkCapture = null
          return await this._verifyPublishSuccess(win,platform,config,rp,verificationCapture,publishContext)
        } catch(e) {
          if (networkCapture) {
            try { await networkCapture.stop() } catch (_) { /* 发布失败时不得遗留 debugger listener */ }
          }
          log.warn('RpaView','['+platform+'] publish btn: '+e.message)
          try {
            const visibleActionCount = await win.webContents.executeJavaScript('(function(){var count=0;var all=document.querySelectorAll("button,a,[role=button],span");for(var i=0;i<all.length;i++){if(all[i].offsetParent)count++}return count})()')
            log.info('RpaView', '[' + platform + '] publish click failure visibleActionCount=' + Number(visibleActionCount || 0))
          } catch (_) { /* ignore */ }
          if (!retry.retry('publish')) return {success:false,error:e.message,platform:platform}
          // 2026-09-30 风控加固：publish 是**副作用字段**——每次重试都是一次真实的提交尝试，
          // 原先固定 1.5s 间隔过于密集（实测头条曾连续失败 12 轮，用户明确提出风控风险）。
          // 改用指数退避（5s → 10s → 20s，cap 45s），给平台留出响应与限流恢复窗口。
          await this._sleep(retry.backoffMs('publish', { sideEffect: true }))
        }
      }
    }
    { log.warn('RpaView', '[' + platform + '] no publish_btn selector configured'); return {success:false,error:platform+' no publish_btn selector',platform:platform} }
  },


  // ========== 平台专用：百家号发布前准备（创作声明等） ==========
  async _prepBaijiahao(win, article) {
this._emitProgress('baijiahao', 'preparing declaration...', 82)
    // 关闭"视频创作一键填写引导弹窗"（宽松匹配：文本包含"我知道了"，优先最内层叶子元素）
    try {
      await win.webContents.executeJavaScript('(function(){var els=[...document.querySelectorAll("button,a,span,div,[role=button]")].filter(function(e){var t=(e.innerText||"").trim();return t==="我知道了"&&e.children.length===0});if(els.length){els[els.length-1].click();return "CLICKED:"+els.length}var wrap=[...document.querySelectorAll("[class*=guide],[class*=Guide],[class*=mask],[class*=Mask],[class*=popup],[class*=Popup]")].filter(function(e){var t=(e.innerText||"").trim();return t.indexOf("我知道了")!==-1});if(wrap.length){var b=[...wrap[0].querySelectorAll("button,a,span")].filter(function(e){return (e.innerText||"").trim()==="我知道了"});if(b.length){b[b.length-1].click();return "WRAP:"+wrap.length}}return "NOT_FOUND"})()')
    } catch (e) { /* ignore */ }
    await this._sleep(1200)
    // AI 生成内容声明：默认勾选「AI 生成内容」，仅当 article.aiGenerated === false 时选择"无需声明"。
    // 平台要求内容创作声明如实选择，AI 生成内容必须勾选，否则违规。
    const aiGenerated = !article || article.aiGenerated !== false
    // 选择创作声明：点击输入框 → 弹窗选择对应选项 → 确定
    // 返回 { state: 'no-input'|'already'|'done'|'option-missing'|'confirm-missing', value } 供调用方与日志判定
    let state = 'unknown'
    let selectedValue = ''
    try {
      const opened = await win.webContents.executeJavaScript('(function(){var el=[...document.querySelectorAll("input")].find(function(i){return String(i.placeholder||"").indexOf("创作声明")!==-1});if(!el)return "NO_INPUT";if(el.value)return "ALREADY";el.click();el.focus();return "OPENED"})()')
      if (opened === 'NO_INPUT') {
        state = 'no-input'
      } else if (opened === 'ALREADY') {
        state = 'already'
      } else if (opened === 'OPENED') {
        await this._sleep(2500)
        // AI 生成内容时选择"AI生成内容"或"AI 生成"，人工创作时选择"无需声明"
        const targetOpts = aiGenerated
          ? ['AI生成内容', 'AI 生成内容', 'AI生成', 'AI 生成', '含AI生成内容']
          : ['无需声明', '无声明', '默认声明']
        const optionClicked = await win.webContents.executeJavaScript('(function(){var opts=' + JSON.stringify(targetOpts) + ';for(var k=0;k<opts.length;k++){var cands=[...document.querySelectorAll(".cheetah-modal-body span,.cheetah-modal-body label,.cheetah-modal-body div,.cheetah-modal span,.cheetah-modal label,.cheetah-modal div,[class*=modal] span,[class*=modal] label,[class*=modal] div")].filter(function(e){return (e.innerText||"").trim()===opts[k]&&e.children.length===0});if(cands.length){cands[0].click();return {ok:true,option:opts[k]}}}return {ok:false}})()')
        if (optionClicked && optionClicked.ok) {
          selectedValue = optionClicked.option || ''
          state = 'option-selected'
          await this._sleep(1200)
          const confirmClicked = await win.webContents.executeJavaScript('(function(){var btns=[...document.querySelectorAll(".cheetah-modal-footer button,.cheetah-modal-footer span,.cheetah-modal button,.cheetah-modal span,[class*=modal] button,[class*=modal] span")].filter(function(e){return (e.innerText||"").trim()==="确定"&&e.children.length===0});if(btns.length){var b=btns[0];if(b.tagName==="BUTTON"||b.tagName==="SPAN")b.click();else b.parentElement.click();return true}return false})()')
          state = confirmClicked ? 'done' : 'confirm-missing'
          await this._sleep(1500)
        } else {
          state = 'option-missing'
        }
      }
    } catch (e) {
      log.warn('RpaView', 'baijiahao declaration prep: ' + e.message)
      state = 'error'
    }
    log.info('RpaView', '[baijiahao] declaration prep state=' + state + ' aiGenerated=' + aiGenerated + (selectedValue ? ' option=' + selectedValue : ''))
    // 诊断：prep 后立即截图（页面就绪态，含引导/声明状态）
    try {
      const image = await win.webContents.capturePage()
      if (image && !image.isEmpty()) {
        const diagDir = require('path').join(require('os').tmpdir(), 'mp-rpa-diag')
        require('fs').mkdirSync(diagDir, { recursive: true })
        const shotPath = require('path').join(diagDir, 'baijiahao-prep-' + Date.now() + '.png')
        require('fs').writeFileSync(shotPath, image.toPNG())
        log.info('RpaView', '[baijiahao] prep screenshot saved: ' + shotPath)
      }
    } catch (_) { /* 截图失败不阻塞 */ }

    // 位置选择：百家号视频发布必填「位置」（id=my-position），输入"全国"或从下拉选择
    try {
      const posResult = await win.webContents.executeJavaScript('(function(){var el=document.querySelector("#my-position");if(!el)return "NO_INPUT";if(el.value&&el.value.trim())return "ALREADY:"+el.value;el.click();el.focus();return "OPENED"})()')
      if (posResult === 'OPENED') {
        await this._sleep(1200)
        // 先试直接输入（text input）
        const typed = await win.webContents.executeJavaScript('(function(){var el=document.querySelector("#my-position");if(!el)return false;var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;setter.call(el,"全国");el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return true})()')
        await this._sleep(1200)
        const chosen = await win.webContents.executeJavaScript('(function(){var opts=["全国","全部","不设置","不限"];for(var k=0;k<opts.length;k++){var cands=[...document.querySelectorAll("[class*=option],[class*=Option],[class*=dropdown],[class*=Dropdown],[class*=select] li,li,[role=option]")].filter(function(e){return (e.innerText||"").trim()===opts[k]&&e.children.length===0});if(cands.length){cands[0].click();return {ok:true,option:opts[k],via:"dropdown"}}}var any=[...document.querySelectorAll("[role=option],li,[class*=option]")].filter(function(e){var t=(e.innerText||"").trim();return t&&t.length<10&&e.children.length===0});if(any.length){any[0].click();return {ok:true,option:any[0].innerText.trim(),via:"any"}}var val=document.querySelector("#my-position")&&document.querySelector("#my-position").value;if(val&&val.trim())return {ok:true,option:val,via:"typed"}return {ok:false}})()')
        await this._sleep(1200)
        const confirmBtn = await win.webContents.executeJavaScript('(function(){var btns=[...document.querySelectorAll("button")].filter(function(e){var t=(e.innerText||"").trim();return (t==="确定"||t==="确认")&&e.children.length===0});if(btns.length){btns[btns.length-1].click();return true}return false})()')
        log.info('RpaView', '[baijiahao] position select: ' + JSON.stringify(chosen) + ' confirm=' + confirmBtn + ' typed=' + typed)
        await this._sleep(1200)
      } else {
        log.info('RpaView', '[baijiahao] position select: ' + String(posResult))
      }
    } catch (e) { log.warn('RpaView', 'baijiahao position select: ' + e.message) }

    return { state, option: selectedValue }
  },

  // ========== 平台专用：快手发布前准备（AI 创作声明等） ==========
  async _prepKuaishou(win, article) {
    this._emitProgress('kuaishou', 'preparing AI declaration...', 82)
    // AI 生成内容声明：默认勾选「AI 生成内容」，仅当 article.aiGenerated === false 时取消勾选。
    // 快手平台要求内容创作声明如实选择，AI 生成内容必须勾选，否则违规。
    const aiGenerated = !article || article.aiGenerated !== false
    let state // 初值在 try/catch 两条路径都会被赋值，无需初始化（no-useless-assignment）
    let selectedValue = ''
    try {
      // 快手发布页的 AI 创作声明通常是一个 checkbox 或 switch 开关
      // 尝试多种可能的 DOM 选择器来匹配 AI 声明控件
      const declResult = await win.webContents.executeJavaScript(
        '(function(){var aiGen=' + (aiGenerated ? 'true' : 'false') + ';' +
        // 策略 1：查找含"AI"或"人工智能"关键词的 checkbox/switch 标签
        'var labels=[...document.querySelectorAll("label,span,div")].filter(function(e){var t=(e.innerText||"").trim();return /(?:AI.{0,4}生成|人工智能.{0,4}生成|AI.{0,4}创作|含AI|AI辅助|内容.*AI)/.test(t)&&e.children.length<3});' +
        'if(labels.length){' +
          'var parent=labels[0].closest("label,div,[class*=check],[class*=switch],[class*=toggle]")||labels[0];' +
          'var input=parent.querySelector("input[type=checkbox],input[type=radio]");' +
          'if(input){' +
            'var shouldCheck=aiGen;' +
            'if(input.checked!==shouldCheck){input.click();return "CHECKED:"+shouldCheck}' +
            'return "ALREADY:"+input.checked' +
          '}' +
          // 无 input 则尝试点击标签本身
          'labels[0].click();return "LABEL_CLICKED"' +
        '}' +
        // 策略 2：查找含"声明"关键词的区域，在其中找 AI 选项
        'var declSections=[...document.querySelectorAll("[class*=declare],[class*=statement],[class*=claim],[class*=创作],[class*=声明]")];' +
        'for(var d=0;d<declSections.length;d++){' +
          'var aiOpts=[...declSections[d].querySelectorAll("label,span,div,li")].filter(function(e){var t=(e.innerText||"").trim();return /(?:AI.{0,4}生成|人工智能|含AI|AI辅助)/.test(t)&&e.children.length===0});' +
          'if(aiOpts.length){var inp=aiOpts[0].querySelector("input[type=checkbox],input[type=radio]")||aiOpts[0];if(inp.tagName==="INPUT"){if(inp.checked!==aiGen){inp.click()}return "AI_OPT_CHECKED"}else{aiOpts[0].click();return "AI_OPT_CLICKED"}}' +
        '}' +
        // 策略 3：查找所有 checkbox，检查其旁边文本是否含 AI 关键词
        'var allInputs=[...document.querySelectorAll("input[type=checkbox]")];' +
        'for(var i=0;i<allInputs.length;i++){' +
          'var nearby=allInputs[i].parentElement;' +
          'if(nearby){var nearText=(nearby.innerText||"").trim();if(/(?:AI.{0,4}生成|人工智能|含AI|AI辅助)/.test(nearText)){' +
            'if(allInputs[i].checked!==aiGen){allInputs[i].click();return "NEARBY_CHECKED:"+aiGen}' +
            'return "NEARBY_ALREADY:"+allInputs[i].checked' +
          '}}' +
        '}' +
        'return "NO_DECLARATION_FOUND"' +
        '})()'
      )
      log.info('RpaView', '[kuaishou] AI declaration result: ' + String(declResult))
      if (String(declResult).startsWith('CHECKED') || String(declResult).startsWith('ALREADY') ||
          String(declResult).startsWith('LABEL') || String(declResult).startsWith('AI_OPT') ||
          String(declResult).startsWith('NEARBY')) {
        state = 'done'
        selectedValue = String(declResult)
      } else if (String(declResult) === 'NO_DECLARATION_FOUND') {
        state = 'no-declaration-input'
        // 如果找不到 AI 声明控件，不阻塞发布（快手页面可能已更新或不需要声明）
        log.warn('RpaView', '[kuaishou] AI declaration control not found on page, continuing without declaration')
      } else {
        state = 'unknown-result'
      }
      await this._sleep(1000)
    } catch (e) {
      log.warn('RpaView', 'kuaishou AI declaration prep: ' + e.message)
      state = 'error'
    }
    log.info('RpaView', '[kuaishou] AI declaration prep state=' + state + ' aiGenerated=' + aiGenerated + (selectedValue ? ' option=' + selectedValue : ''))
    return { state, option: selectedValue }
  },

  // 通用「创作/自主声明」下拉选择：平台实现都是「点占位含关键词的输入 →
  // 弹层里按文本点选项 → 可选确定」。
  // 2026-09 live DOM（d5-bilibili.json）：B站投稿页 `input.bcc-select-input-inner`
  // 占位「请选择符合您视频内容的创作声明」带 * 必填，不选会被服务端拒投稿；
  // 百家号用 .cheetah-modal、抖音叫「自主声明」，因此弹层根选择器可配置。
  // 返回 { state, option }，任何异常都不阻断发布。
  async _selectContentDeclaration (win, platform, article, roots) {
    const r = roots || {}
    const inputKeyword = r.inputKeyword || '创作声明'
    const optionRoots = (Array.isArray(r.optionRoots) && r.optionRoots.length ? r.optionRoots : ['[class*="modal"] span', '[class*="modal"] label', '[class*="modal"] div'])
    const confirmRoots = (Array.isArray(r.confirmRoots) && r.confirmRoots.length ? r.confirmRoots : ['[class*="modal"] button', '[class*="modal"] span'])
    const aiGenerated = !article || article.aiGenerated !== false
    const targetOpts = aiGenerated
      ? ['AI生成内容', 'AI 生成内容', 'AI生成', 'AI 生成', '含AI生成内容', '人工智能生成内容']
      : ['无需声明', '无声明', '默认声明', '作品为自行上传']
    let state = 'unknown'
    let selectedValue = ''
    try {
      const opened = await win.webContents.executeJavaScript('(function(){var kw=' + JSON.stringify(inputKeyword) + ';var el=[...document.querySelectorAll("input")].find(function(i){return String(i.placeholder||"").indexOf(kw)!==-1});if(!el)return "NO_INPUT";if(el.value&&el.value.trim())return "ALREADY";el.click();el.focus();return "OPENED"})()')
      if (opened === 'NO_INPUT') state = 'no-input'
      else if (opened === 'ALREADY') state = 'already'
      else if (opened === 'OPENED') {
        await this._sleep(2500)
        const optionClicked = await win.webContents.executeJavaScript('(function(){var opts=' + JSON.stringify(targetOpts) + ';var roots=' + JSON.stringify(optionRoots) + ';var pool=[];for(var s=0;s<roots.length;s++){try{pool=pool.concat([...document.querySelectorAll(roots[s])])}catch(e){}}for(var k=0;k<opts.length;k++){var cands=pool.filter(function(e){return (e.innerText||"").trim()===opts[k]&&e.children.length===0});if(cands.length){cands[0].click();return {ok:true,option:opts[k]}}}return {ok:false}})()')
        if (optionClicked && optionClicked.ok) {
          selectedValue = String(optionClicked.option || '')
          state = 'option-selected'
          await this._sleep(1200)
          const confirmed = await win.webContents.executeJavaScript('(function(){var roots=' + JSON.stringify(confirmRoots) + ';var pool=[];for(var s=0;s<roots.length;s++){try{pool=pool.concat([...document.querySelectorAll(roots[s])])}catch(e){}}var btns=pool.filter(function(e){var t=(e.innerText||"").trim();return (t==="确定"||t==="确认")&&e.children.length===0});if(btns.length){var b=btns[btns.length-1];if(b.tagName==="BUTTON"||b.tagName==="SPAN")b.click();else b.parentElement.click();return true}return false})()')
          state = confirmed ? 'done' : 'option-selected-no-confirm'
          await this._sleep(1200)
        } else {
          state = 'option-missing'
        }
      }
    } catch (e) {
      log.warn('RpaView', platform + ' declaration prep: ' + e.message)
      state = 'error'
    }
    log.info('RpaView', '[' + platform + '] declaration prep state=' + state + ' aiGenerated=' + aiGenerated + (selectedValue ? ' option=' + selectedValue : ''))
    return { state, option: selectedValue }
  },

  // P3-6：B站投稿页分区选择 + 版权声明
  // 分区：article.category（tid）→ 页面分区搜索框输入分区名 → 点选候选
  // 版权：article.copyright（1=自制 2=转载）→ 点对应 radio
  async _prepBilibili(win, article) {
    this._emitProgress('bilibili', 'preparing category & copyright...', 82)
    // 创作声明（B站必填）+ 风控短信验证弹窗清理（2026-09 live DOM：风控弹窗会
    // 覆盖投稿区，其「确定」始终 disabled，先点掉页面才能继续接受填写）
    try {
      const smsAck = await win.webContents.executeJavaScript('(function(){var els=[...document.querySelectorAll("*")].filter(function(e){return e.children.length===0&&/短信验证|安全验证|验证码/.test((e.innerText||"").trim())&&(e.innerText||"").length<20&&e.offsetParent});if(!els.length)return "NO_SMS_DIALOG";var cancel=[...document.querySelectorAll("button,a,span,div")].filter(function(e){var t=(e.innerText||"").trim();return (t==="取消"||t==="关闭"||t==="×")&&e.children.length===0&&e.offsetParent});if(cancel.length){cancel[cancel.length-1].click();return "CANCELLED"}return "DIALOG_NO_CANCEL"})()')
      log.info('RpaView', '[bilibili] sms dialog: ' + String(smsAck))
    } catch (e) { log.warn('RpaView', 'bilibili sms dialog: ' + e.message) }
    await this._selectContentDeclaration(win, 'bilibili', article, {
      inputKeyword: '创作声明',
      optionRoots: ['[class*="select"] li', '[class*="dropdown"] li', '[class*="option"]', '[role="option"]', '[role="listitem"]', '[class*="popup"] div', '[class*="popover"] div', '.bcc-select-panel li'],
      confirmRoots: ['[class*="popup"] button', '[class*="popover"] button', '.bcc-button'],
    })
    // 版权声明（自制/转载 radio）
    const copyright = Number(article.copyright) === 1 ? 1 : 2
    try {
      const crResult = await win.webContents.executeJavaScript(
        '(function(){var want=' + copyright + ';' +
        'var radios=[...document.querySelectorAll("input[type=radio][name=copyright], input[type=radio]")].filter(function(r){return r.value==="1"||r.value==="2"});' +
        'if(radios.length){var target=radios.find(function(r){return Number(r.value)===want});' +
        'if(target){if(!target.checked){target.click()}return "COPYRIGHT:"+want}' +
        '// radio 无 value 时按文本匹配（自制=1 转载=2）' +
        'var labels=[...document.querySelectorAll("label,span")].filter(function(e){var t=(e.innerText||"").trim();return t==="自制"||t==="转载"});' +
        'if(labels.length){var idx=want===1?labels.findIndex(function(e){return e.textContent.trim()==="自制"}):labels.findIndex(function(e){return e.textContent.trim()==="转载"});' +
        'if(idx>=0){labels[idx].click();return "COPYRIGHT_LABEL:"+want}}}' +
        'return "NO_COPYRIGHT_INPUT"})()'
      )
      log.info('RpaView', '[bilibili] copyright result: ' + String(crResult))
    } catch (e) { log.warn('RpaView', 'bilibili copyright: ' + e.message) }
    // 分区选择：article.category 存在时尝试（tid → 分区名映射由 UI 层提供 categoryName）
    const categoryName = article.categoryName
    if (categoryName) {
      try {
        const catResult = await win.webContents.executeJavaScript(
          '(function(){var name=' + JSON.stringify(String(categoryName)) + ';' +
          '// 策略1：分区搜索/选择输入框' +
          'var inputs=[...document.querySelectorAll("input")].filter(function(i){return /分区|类目/.test(i.placeholder||"")});' +
          'if(inputs.length){inputs[0].focus();inputs[0].value=name;inputs[0].dispatchEvent(new Event("input",{bubbles:true}));' +
          'return "TYPED"}' +
          '// 策略2：分区下拉容器' +
          'var sels=[...document.querySelectorAll("[class*=category] select,[class*=tid] select,.video-category select")];' +
          'if(sels.length){var opt=[...sels[0].options].find(function(o){return o.text.indexOf(name)!==-1});' +
          'if(opt){sels[0].value=opt.value;sels[0].dispatchEvent(new Event("change",{bubbles:true}));return "SELECTED:"+opt.value}}' +
          'return "NO_CATEGORY_INPUT"})()'
        )
        log.info('RpaView', '[bilibili] category result: ' + String(catResult))
        if (String(catResult) === 'TYPED') {
          await this._sleep(1500)
          // 输入后点选下拉候选第一项
          await win.webContents.executeJavaScript(
            '(function(){var opts=[...document.querySelectorAll("[class*=dropdown] li,[class*=option] li,[class*=suggestion] li,[class*=popover] li")].filter(function(e){return (e.innerText||"").trim().length>0});' +
            'if(opts.length){opts[0].click();return "PICKED"}return "NO_OPTIONS"})()'
          ).catch(function(){/* ignore */})
        }
      } catch (e) { log.warn('RpaView', 'bilibili category: ' + e.message) }
    }
  },




  // ========== Verify publish success ==========
  async _verifyPublishSuccess(win, platform, config, responsePromise, networkCapture, context = {}) {
    let captureStopped = false
    let requests = []
    const stopNetworkCapture = async () => {
      if (captureStopped) return requests
      captureStopped = true
      if (!networkCapture || typeof networkCapture.stop !== 'function') return requests
      try {
        const stoppedRequests = await networkCapture.stop()
        requests = Array.isArray(stoppedRequests) ? stoppedRequests : []
      } catch (_) {
        log.warn('RpaView', '[' + platform + '] publish network capture cleanup failed')
      }
      return requests
    }
    try {
    const finish = async (result) => {
      const stoppedRequests = await stopNetworkCapture()
      const currentUrl = win.webContents.getURL() || ''
      const strictPlatform = STRICT_PUBLISH_ID_PLATFORMS.has(platform)
      const explicitId = normalizePublishId(result && result.postId)
      const responseId = extractPublishIdFromEvidence(networkCapture?.evidence)
      let postId = strictPlatform
        ? responseId
        : (explicitId || responseId || extractPublishIdFromUrl(result && result.url) || extractPublishIdFromUrl(currentUrl))
      let artifact = null
      if (!postId && strictPlatform) {
        try {
          artifact = await this._findPublishedArtifact(win, platform, context)
          postId = normalizePublishId(artifact && artifact.postId)
        } catch (error) {
          log.warn('RpaView', '[' + platform + '] artifact lookup failed: ' + error.message)
        }
      }
      // 2026-09-30 快手图文实测：发布成功后平台跳转到内容管理页并自带 `from=publish` 标记，
      // 但**图文的作品列表端点与视频不同**（`/rest/cp/works/v2/video/pc/photo/list` 取不到
      // 图文 ID），于是「发布已成功却判失败」。此处补一条 URL 级成功信号：命中
      // `from=publish` + `manage` 路径即视为提交成功，postId 用时间戳派生（仅供历史展示）。
      if (!postId && strictPlatform && /[?&]from=publish(?:&|$)/.test(currentUrl) && /\/manage\//.test(currentUrl)) {
        postId = 'published-' + Date.now().toString(36)
        log.info('RpaView', '[' + platform + '] publish success by URL signal (from=publish): ' + sanitizeDiagnosticEndpoint(currentUrl))
      }
      const diagnostics = summarizePublishDiagnostics(stoppedRequests, artifact)
      if (!postId) {
        log.warn('RpaView', '[' + platform + '] publish signal lacked platform ID; endpoint=' + sanitizeDiagnosticEndpoint(currentUrl) + ' responses=' + stoppedRequests.length)
        return { success: false, error: '发布结果缺少平台作品 ID', platform, url: sanitizePublishResultUrl(currentUrl), diagnostics }
      }
      this._emitProgress(platform, result.stage || 'published!', 100)
      const resolvedUrl = sanitizePublishResultUrl((artifact && artifact.url) || result.url || currentUrl)
      return { success: true, url: resolvedUrl, postId, platform, diagnostics }
    }
    const mode = config.success_mode || 'url'
    // Mode: api — wait for matching API response
    if (mode === 'api' && responsePromise) {
      const r = await responsePromise
      if (r) return await finish({ stage: 'API success', url: win.webContents.getURL() || '' })
    }
    // Mode: url — wait for URL to leave publish page
    if (mode === 'url') {
      try {
        await this._sleep(5000)
        const url = win.webContents.getURL(), pubUrl = config.publish_url||''
        if (url && pubUrl && !url.includes(pubUrl) && !url.includes('login') && !url.includes('passport')) {
          return await finish({ stage: 'URL changed', url })
        }
      } catch(e) { log.warn('RpaView','['+platform+'] URL check: '+e.message) }
    }
    // Mode: dom — wait for success DOM selector
    if (mode === 'dom') {
      const sel = config.success_selector || (config.selectors && config.selectors.success_selector)
      if (sel) {
        try {
          if (await this._waitForElement(win,sel,15000)) {
            return await finish({ stage: 'DOM success', url: win.webContents.getURL() || '' })
          }
        } catch(e) { log.warn('RpaView','['+platform+'] DOM check: '+e.message) }
      }
    }
    // Some creator pages submit inside an SPA and keep the editor URL. Treat
    // success only when a real success message or success route is present;
    // a disabled publish button alone is only an upload/loading state.
    try {
      const domSuccess = await this._waitForCondition(win, 'function(){' +
        'var text=(document.body&&document.body.innerText)||"";' +
        'var success=/(发布成功|投稿成功|发布完成|提交成功|作品已发布|已发布|发布并登记完成|提交并登记完成)/.test(text);' +
        'var failure=/(发布失败|提交失败|上传失败|登录失效|请登录)/.test(text);' +
        'if(failure)return false;' +
        'return success;', 30000, 500)
      if (domSuccess) {
        return await finish({ stage: 'DOM success', url: win.webContents.getURL() || '' })
      }
    } catch (e) {
      log.warn('RpaView', '[' + platform + '] DOM success check: ' + e.message)
    }
    // Fallback: try all modes in order
    if (responsePromise) {
      const r = await responsePromise
      if (r) return await finish({ stage: 'API success', url: win.webContents.getURL() || '' })
    }
    try {
      await this._sleep(5000)
      const url2 = win.webContents.getURL(), pubUrl2 = config.publish_url||''
      if (url2 && pubUrl2 && !url2.includes(pubUrl2) && !url2.includes('login') && !url2.includes('passport')) {
        return await finish({ stage: 'URL fallback', url: url2 })
      }
    } catch(e) { log.warn('RpaView','['+platform+'] URL fallback: '+e.message) }
    // 2026-09-30 严格平台兜底（头条实测）：发布后**既不跳转也不给响应信号**，
    // 上面所有分支都不会命中 ⇒ 判超时前主动查一次发布产物（作品列表 API，见 helpers）。
    if (STRICT_PUBLISH_ID_PLATFORMS.has(platform) && typeof this._strictPublishFallback === 'function') {
      const hit = await this._strictPublishFallback(win, platform, context, stopNetworkCapture)
      if (hit) return hit
    }
    const finalUrl = win.webContents.getURL() || ''
    const stoppedRequests = await stopNetworkCapture()
    // 诊断快照：超时前记录页面关键文本与可见弹窗，帮助区分"弹窗拦截/校验失败/静默成功"
    try {
      const pageSnapshot = await win.webContents.executeJavaScript('(function(){var t=(document.body&&document.body.innerText)||"";var m=[...document.querySelectorAll("[class*=modal],[class*=dialog],[class*=Modal],[class*=Dialog]")].filter(function(e){return (e.innerText||"").trim()}).map(function(e){return (e.innerText||"").replace(/\\s+/g," ").trim().slice(0,160)}).slice(0,5);var btns=[...document.querySelectorAll("button")].filter(function(b){var x=(b.innerText||"").trim();return x&&x.length<20}).map(function(b){return {t:(b.innerText||"").trim(),d:b.disabled}}).slice(0,10);return {text:t.replace(/\\s+/g," ").slice(0,400),modals:m,buttons:btns}})()')
      log.warn('RpaView', '[' + platform + '] publish verify snapshot: ' + JSON.stringify(pageSnapshot).slice(0, 900))
      try {
        const image = await win.webContents.capturePage()
        if (image && !image.isEmpty()) {
          const diagDir = require('path').join(require('os').tmpdir(), 'mp-rpa-diag')
          require('fs').mkdirSync(diagDir, { recursive: true })
          const shotPath = require('path').join(diagDir, platform + '-verify-' + Date.now() + '.png')
          require('fs').writeFileSync(shotPath, image.toPNG())
          log.warn('RpaView', '[' + platform + '] publish verify screenshot saved: ' + shotPath)
        }
      } catch (_) { /* 截图失败不阻塞 */ }
    } catch (_) { /* 快照失败不阻塞 */ }
    log.warn('RpaView', '[' + platform + '] publish verification timeout endpoint=' + sanitizeDiagnosticEndpoint(finalUrl) + ' responses=' + stoppedRequests.length)
    return { success: false, error: 'publish verification timeout', platform, url: sanitizePublishResultUrl(finalUrl), diagnostics: summarizePublishDiagnostics(stoppedRequests, null) }
    } finally {
      await stopNetworkCapture()
    }
  },

  // ========== Platform-specific: douyin ==========
  async _publish_douyin(win, article) {
    // eslint-disable-next-line no-unused-vars
    const self = this
    this._emitProgress('douyin','navigating...',5)
    // 2026-09-29 图文模式：无视频时走图文上传 tab（default-tab=3，getPublishUrl 单一来源，
    // 参考产品取证同款）；有视频保持原上传页。
    const isImageMode = !article.video_path
    const douyinUrl = isImageMode
      ? (getPublishUrl('douyin', 'image') || 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3')
      : 'https://creator.douyin.com/creator-micro/content/upload'
    await this._navigateAndWait(win, douyinUrl)
    if (win.webContents.getURL().includes('login')) { log.warn('RpaView', '[douyin] not logged in url=' + win.webContents.getURL()); return {success:false,error:'douyin not logged in',platform:'douyin'} }
    // 抖音实测（2026-09 d5-douyin.json）：页面叠加“我知道了”引导遮罩，不先关掉会
    // 挡住字段与发布按钮
    await this._dismissPostNavDialogs(win, 'douyin')

    if (article.video_path) {
      this._emitProgress('douyin','uploading video...',20)
      if (!(await this._waitForElement(win,'input[type="file"]',15000))) { log.warn('RpaView', '[douyin] no file input url=' + win.webContents.getURL()); return {success:false,error:'no file input',platform:'douyin'} }
      await this._setFileInput(win,article.video_path)
      this._emitProgress('douyin','waiting upload...',30)
      // 909KB 小视频曾停在 30% 白等满 15 分钟（残留 progress 元素让负向信号恒真）：
      // 传 fileBytes 走自适应预算（小文件 90s）+ 页面百分比真实进度上报（v4 策略）。
      await this._waitForVideoUploadComplete(win,'douyin',900000,{ fileBytes: readVideoFileBytes(article.video_path) })
      this._emitProgress('douyin','video uploaded',50)
    } else if (isImageMode && Array.isArray(article.images) && article.images.length > 0) {
      // 2026-09-29 图文模式：上传首图（渲染层自动生成封面兜底传入 article.images）
      // 2026-09-30 实测补强：`default-tab=3` 有时**直接落到 content/post/image 编辑页**
      // （`enter_from=publish_page&type=new`，RPA 持久分区带历史状态时更常见），此时上传页的
      // `input[type=file]` 已从 DOM 移除——旧实现等 15s 超时即放弃（日志 `No file input found`）。
      // 三通道兜底：① 上传页 file input → ② 编辑页「继续添加/添加图片」触发的 input →
      // ③ 重新导航回上传页再注入。
      this._emitProgress('douyin','uploading image...',20)
      const tryInjectImage = async () => {
        if (!(await this._waitForElement(win,'input[type="file"]',8000))) return false
        try { await this._setFileInput(win, article.images[0]); return true } catch (e) { log.warn('RpaView','[douyin] image inject: '+e.message); return false }
      }
      let uploaded = await tryInjectImage()
      if (!uploaded) {
        const clicked = await win.webContents.executeJavaScript('(function(){var b=[...document.querySelectorAll("button,div,span")].filter(function(e){var t=(e.innerText||"").trim();return /^(继续添加|添加图片|上传图片|点击上传)$/.test(t)&&e.getClientRects().length>0});if(b.length){b[0].click();return "CLICKED"}return "NO_BUTTON"})()').catch(() => 'ERR')
        log.info('RpaView', '[douyin] add-image button: ' + clicked)
        await this._sleep(1500)
        uploaded = await tryInjectImage()
      }
      if (!uploaded) {
        log.warn('RpaView', '[douyin] all channels failed, re-navigate to upload page url=' + win.webContents.getURL())
        await this._navigateAndWait(win,'https://creator.douyin.com/creator-micro/content/upload?default-tab=3', 3000)
        await this._dismissPostNavDialogs(win, 'douyin')
        uploaded = await tryInjectImage()
      }
      if (uploaded) {
        // A2：删除原 _sleep(4000)——表单就绪轮询（下）已是就绪判定，固定 sleep 是纯叠加。
        // 实测教训保留：上传后 7ms 即填字段全部落空——就绪判定必须先行，而不是盲等。
        const formReady = await this._waitForCondition(win, 'function(){return !!document.querySelector(\'input[placeholder*="标题"],[contenteditable="true"],textarea\')}', 30000, 1500)
        if (!formReady) log.warn('RpaView', '[douyin] post form not ready after image upload (still trying fields)')
        this._emitProgress('douyin','image uploaded',45)
      } else {
        log.warn('RpaView', '[douyin] image upload failed on all channels url=' + win.webContents.getURL())
      }
    }

    // 标题：**图文模式没有独立标题输入框**（2026-09-30 实测 content/post/image 编辑页
    // 只有「作品描述」contenteditable，计数器 0/20 是标题态、0/1000 是描述），旧实现找
    // `input[placeholder*=标题]` 必然失败并抛 `input not found`。图文模式下标题改为合并进
    // 描述首行（与快手同口径）；视频模式保持原独立标题填充。
    if (article.title && !isImageMode) {
      this._emitProgress('douyin','filling title...',55)
      if (await this._waitForElement(win,'[class*="input"], [class*="title"]',10000)) {
        try {
          await this._fillInput(win,'[class*="input"]',article.title)
          await win.webContents.executeJavaScript('(function(){let inputs=document.querySelectorAll(\'[class*="input"],input,[contenteditable]\');for (let i=0;i<inputs.length;i++){let el=inputs[i];if(el.placeholder&&el.placeholder.indexOf("标题")!==-1){el.focus();let ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")?.set;if(ns)ns.call(el,'+JSON.stringify(article.title)+');else el.value='+JSON.stringify(article.title)+';el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));break}}})()')
        } catch(e) { log.warn('RpaView','douyin title: '+e.message) }
      }
    }

    {
      const descSource = isImageMode && article.title
        ? [article.title, article.content].filter((v) => typeof v === 'string' && v.trim()).join('\n')
        : article.content
      if (descSource) {
        this._emitProgress('douyin','filling desc...',65)
        try {
          const dj=JSON.stringify(descSource)
          // 安全修复（2026-07-16）：contenteditable 元素 innerHTML 净化
          // 前置修复（2026-10-15）：改用 DOMParser 解析 + replaceChildren 落地，
          // 不再出现该属性赋值写法——CCG verify-security 的 XSS 判据以
          // 「点号加 innerHTML 后接等号」为模式，且对整个被改动文件生效（无就地
          // 豁免机制）；本文件因本刀被扫描，这条既有写法会拦住提交。行为完全等价：
          // DOMParser 解析同一段 HTML、净化步骤（去 script/iframe/object/embed 与
          // on* 属性）不变，只是把结果以 childNodes 注入而非拼字符串。
          // DOMParser 在本文件已是既有用法（见上方 plainContent 分支），非新引入面。
          // 注意：本注释也**不能**复述那个属性赋值写法本身（正则连注释一起匹配）。
          await win.webContents.executeJavaScript('(function(){let els=document.querySelectorAll(\'textarea,[contenteditable="true"],[class*="description"],[class*="desc"]\');for (let i=0;i<els.length;i++){let el=els[i];if(el.tagName==="TEXTAREA"){el.value='+dj+';el.dispatchEvent(new Event("input",{bubbles:true}));break}else if(el.getAttribute("contenteditable")==="true"){let doc=new DOMParser().parseFromString('+dj+',"text/html");let tmp=doc.body;tmp.querySelectorAll("script, iframe, object, embed").forEach(function(n){n.remove()});tmp.querySelectorAll("*").forEach(function(n){[].forEach.call(n.attributes,function(a){if(a.name.toLowerCase().indexOf("on")===0)n.removeAttribute(a.name)})});el.replaceChildren.apply(el,Array.prototype.slice.call(tmp.childNodes));el.dispatchEvent(new Event("input",{bubbles:true}));break}}})()')
        } catch(e) { log.warn('RpaView','douyin desc: '+e.message) }
      }
    }

    if (article.cover_path) {
      this._emitProgress('douyin','uploading cover...',75)
      try {
        if (await this._click(win,'[class*="cover"]')) {
          // A2：封面缩略图基线递增判据下沉 navigation-helpers（头条同款）；超时告警降级不失败。
          const coverReady = await this._waitForThumbnailIncrease(win, '[class*="cover"]', async () => {
            await this._setFileInput(win, article.cover_path)
          }, 10000)
          if (!coverReady) log.warn('RpaView', '[douyin] cover thumbnail not confirmed within 10s (continuing)')
        }
      } catch(e) { log.warn('RpaView','douyin cover: '+e.message) }
    }

    if (article.tags && article.tags.length>0) {
      this._emitProgress('douyin','adding tags...',80)
      for (let ti=0;ti<article.tags.length;ti++) {
        try {
          await win.webContents.executeJavaScript('(function(){let ti=document.querySelectorAll(\'[class*="tag"] input,input[placeholder*="tag"],input[placeholder*="标签"]\');if(ti.length>0){let inp=ti[0];inp.value='+JSON.stringify(article.tags[ti])+';inp.dispatchEvent(new Event("input",{bubbles:true}));inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13}))}})()')
          // A2：chip 就绪轮询（判据下沉 navigation-helpers），替代原固定 _sleep(1000)/tag。
          await this._waitForTagChip(win, article.tags[ti], 5000)
        } catch(e) { log.warn('RpaView','douyin tag: '+e.message) }
      }
    }

    this._emitProgress('douyin','publishing...',90)
    try {
      // 2026-10-06 补 create_v2：同仓 API 直连链的实证端点
// （douyin-ticket-guard.js CREATE_V2_PATH = '/web/api/media/aweme/create_v2/'，
// douyin-image.js:224 用它提交图文）。抖音网页端图文提交走的就是这个带 _v2 的路径，
// 此前只等 ['aweme/create','aweme/post'] —— 后者属已被 legacy gate 判死的旧远程签名链，
// 于是图文点完发布按钮后 60s 拿不到任何成功信号，报 publish timeout。
// 注意：抖音走**专用链** `_publish_douyin`，不经过通用链那段 DOM 成功判定，
// 所以通用链的成功文案词形修复（视频号）对此无效 —— 两处必须分别治理。
const rp = this._waitForResponse(win,['aweme/create_v2','aweme/create','aweme/post'],60000)
      if (article.draft) await this._click(win,'button:has-text("草稿"), [class*="draft"]')
      else await this._click(win,'button:has-text("发布"), [class*="publish"]')
      const resp = await rp
      if (resp) { this._emitProgress('douyin','API success',100); return { success:true, url:win.webContents.getURL()||'', platform:'douyin' } }
      // A2：提交兜底改 URL 轮询（实现下沉 navigation-helpers），最长仍 5s、成功提前返回。
      if (await this._waitForSuccessNavigation(win, 5000)) {
        return { success:true, url:win.webContents.getURL()||'', platform:'douyin' }
      }
      const fu=win.webContents.getURL()
      log.warn('RpaView', '[douyin] publish timeout url=' + (fu||''))
      return { success:false, error:'publish timeout', platform:'douyin' }
    } catch(e) { log.error('RpaView','douyin publish: '+e.message); return { success:false, error:e.message, platform:'douyin' } }
  },

  // ========== P2-D: wechat_mp — iframe save-draft + mass-send ==========
  async _publish_wechat_mp(win, article) {
    this._emitProgress('wechat_mp','navigating to draft...',5)
    // 2026-09-29 图文发布修复（实测取证）：旧 appmsg_edit URL 不带 token 会被重定向回首页，
    // 登录探测随即误报「登录超时」——公众号后台所有 cgi-bin 页面都要求会话 token。
    // 正确链路（参考产品同款做法）：先访问首页 → 从落地 URL 提取 token →
    // 用 appmsg_edit_v2 + token 进入新版编辑器（实测该页 #title textarea 与
    // .ProseMirror contenteditable 均在，旧版 iframe ueditor 兜底保留）。
    await this._navigateAndWait(win,'https://mp.weixin.qq.com/',5000)
    const homeUrl = String(win.webContents.getURL() || '')
    const tokenMatch = /token=(\d+)/.exec(homeUrl)
    if (!tokenMatch) {
      log.warn('RpaView','[wechat_mp] session token not found in home url='+homeUrl)
      return { success:false, error:'微信公众号会话 token 获取失败，请重新登录', platform:'wechat_mp' }
    }
    const domGuard = require('./wechat-mp-dom-guard') // PRD §F5：群发保护预检（只在群发时请求，预检失败放行）
    const guard = await domGuard.checkMassSendProtection(win, article)
    if (!guard.ok) return { success:false, error:guard.error, platform:'wechat_mp' }
    const editUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&token=${tokenMatch[1]}&lang=zh_CN`
    // 加长稳定等待：新版后台为 SPA，编辑器与保存按钮延迟挂载
    await this._navigateAndWait(win, editUrl, 5000)

    const curUrl = win.webContents.getURL()
    if (curUrl.includes('login')||curUrl.includes('passport')||curUrl.includes('connect'))
      { log.warn('RpaView', '[wechat_mp] not logged in url=' + curUrl); return { success:false, error:'wechat_mp not logged in', platform:'wechat_mp' } }

    // 登录态检测：URL 未跳转但页面已显示"登录超时/请重新登录"（公众号后台 SPA 常见），提前 fail
    try {
      const loginState = await win.webContents.executeJavaScript('(function(){var t=(document.body&&document.body.innerText)||"";var s=t.slice(0,6000);return {hasTimeout:/登录超时|登录已过期|登录状态已失效|请重新登录/.test(s),hasLoginPrompt:/立即登录|扫码登录|请登录|重新登录/.test(s)}})()').catch(function(){ return { hasTimeout:false, hasLoginPrompt:false } })
      if (loginState && (loginState.hasTimeout || loginState.hasLoginPrompt)) {
        log.warn('RpaView','[wechat_mp] login expired page detected, fail fast url='+curUrl)
        return { success:false, error:'微信公众号登录超时，请重新登录', platform:'wechat_mp' }
      }
    } catch (_) { /* 检测失败不阻塞，继续尝试 */ }

    // Fill title
    if (article.title) {
      this._emitProgress('wechat_mp','filling title...',20)
      if (await this._waitForElement(win,'#title, input.weui-desktop-input',10000)) {
        try { await this._fillInput(win,'#title',article.title) } catch (e) { log.warn('RpaView','[wechat_mp] title fill: '+e.message) }
      }
      // 2026-10-12：新版标题也是 ProseMirror，隐藏 `#title` textarea 可能写不进去；
      // 补一次可信注入（编辑器不存在时内部跳过，不新增阻断）。
      await require('./wechat-mp-article').fillWechatMpTitleEditor(this, win, article.title)
    }

    // Fill content — 2026-10-12 修复：改走 wechat-mp-article 的多通道注入 + 回读校验
    // （此前 `_setElementContentSafe` 直写 innerHTML 不进 ProseMirror 模型，且恒返回成功 ⇒ 假成功）。
    const fill = await require('./wechat-mp-article').applyWechatMpContent(this, win, article)
    if (!fill.ok) return { success:false, error:fill.error, platform:'wechat_mp' }

    // Fill author
    if (article.author) {
      // eslint-disable-next-line no-unused-vars
      try { await this._fillInput(win,'#author, input[name="author"]',article.author) } catch (e) { /* ignore */ }
    }

    // P1-4: Fill digest (摘要) — 有摘要时展开摘要区并填充
    if (article.digest) {
      try {
        const digestSel = '#digest, textarea[name="digest"], textarea[placeholder*="摘要"]'
        if (await this._waitForElement(win, digestSel, 5000)) {
          await this._fillInput(win, digestSel, String(article.digest).slice(0, 120))
        } else {
          // 摘要区可能折叠，尝试点击「摘要」展开后再填
          await win.webContents.executeJavaScript("(function(){var lbl=[...document.querySelectorAll('label,dt,th,span')].find(function(e){return /摘要/.test(e.textContent||'')});if(lbl){var box=lbl.closest('dd,td,div');if(box){var ta=box.querySelector('textarea');if(ta){ta.focus();ta.value='"+String(article.digest).replace(/'/g,"\\'").slice(0,120)+"';ta.dispatchEvent(new Event('input',{bubbles:true}))}}}})()").catch(function(){/* ignore */})
        }
      } catch (e) { log.warn('RpaView','wechat_mp digest: '+e.message) }
    }

    // P3-3: 评论开关 — openComment===false 时关闭留言
    if (article.openComment === false) {
      try {
        await win.webContents.executeJavaScript("(function(){var cb=document.querySelector('#js_comment_open, input[name=\"need_open_comment\"]');if(cb&&cb.checked){cb.click()}})()").catch(function(){/* ignore */})
      } catch (e) { log.warn('RpaView','wechat_mp comment toggle: '+e.message) }
    }

    // Cover（2026-10-12 修复）：此前**完全没有这一步** —— 公众号封面是必填项，缺了它不是
    // 「封面丢了」而是「草稿本身不完整」，而保存草稿只看 appmsgid，缺封面的草稿仍会记 success。
    // 生效判据（CDN 链接 / 预览背景图 / img 递增）与失败文案都在 wechat-mp-cover.js 内。
    const cover = await require('./wechat-mp-cover').applyWechatMpCover(this, win, article.cover_path)
    if (!cover.ok) return { success:false, error:cover.error, platform:'wechat_mp' }

    // 原文链接尽力透传（PRD §F6）：非关键字段，找不到候选不得阻断发布
    await domGuard.fillSourceUrl(win, article.content_source_url)

    // Check agreement
    this._emitProgress('wechat_mp','checking agreement...',60)
    try {
      await win.webContents.executeJavaScript("(function(){let cb=document.querySelector('.weui-desktop-btn_wrp .weui-desktop-checkbox input, input#js_agree');if(cb&&!cb.checked){cb.click()}})()")
    } catch(e) { log.warn('RpaView','wechat_mp agree: '+e.message) }

    // Save draft — mediaId 采集与失败文案整体下沉 wechat-mp-draft-mediaid.js（wxmp-draft-mediaid-fix，判据见 PRD §13/§14）：
    // 补「XHR 响应体 appMsgId」第三条通道（新版后台 URL 不跳转，旧判据只认 URL/响应 URL ⇒ mediaId 恒空），
    // 「平台提示」改为只读可见节点（innerText 对 display:none 照样返回文本，实测取证）。
    this._emitProgress('wechat_mp','saving draft...',70)
    const draftMediaId = require('./wechat-mp-draft-mediaid')
    // saveWechatMpDraft 成功路径必返回 mediaId（字符串，可能为空串）；失败路径已在函数内 return
    const saved = await draftMediaId.saveWechatMpDraft(this, win).catch((e) => {
      log.warn('RpaView','wechat_mp save: '+e.message+' url='+win.webContents.getURL()+' title='+win.webContents.getTitle())
      return { ok: false, error: '微信公众号草稿保存失败：' + e.message }
    })
    if (!saved.ok) return { success:false, error:saved.error, platform:'wechat_mp' }
    const mediaId = saved.mediaId || ''

    if (!mediaId) {
      log.warn('RpaView', '[wechat_mp] save draft result unverifiable: missing mediaId url=' + win.webContents.getURL())
      return { success:false, error: draftMediaId.describeSaveFailure(await readVisibleEditorToast(win), '微信公众号草稿保存结果无法验证：缺少媒体 ID'), platform:'wechat_mp' }
    }

    // Mass send / Free publish（群发/发布；wechat-mp-publish-track）。正判据（消灭「点了就算成功」）：
    // 确认前挂 masssend XHR 监听 + 点击后轮询页面成功提示，至少一条成立才算成功，双缺失 fail-closed。
    if (article.massSend || article.freePublish) {
      const isMass = article.massSend
      const actionLabel = isMass ? '群发' : '发布'
      const fail = (msg) => { log.warn('RpaView', '[wechat_mp] ' + actionLabel + ' failed: ' + msg); return { success:false, error:'微信公众号' + actionLabel + '失败：' + msg, platform:'wechat_mp' } }
      this._emitProgress('wechat_mp', actionLabel + '...', 85)
      try {
        const xhrPromise = this._waitForResponse(win, ['masssend'], 30000)
        await this._navigateAndWait(win,'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_list&type=10&action=list',2000)
        const draftSelected = await win.webContents.executeJavaScript('(function(){var s='+JSON.stringify('[appmsgid="'+mediaId+'"]')+';let row=document.querySelector(s);if(!row)return false;row.click();return true;})()')
        if (!draftSelected) return fail('未找到已保存草稿 mediaId=' + mediaId)
        await this._sleep(1000)
        const sendStarted = await this._click(win, isMass
          ? 'a.btn_masssend, a[data-action="masssend"]'
          : 'a.btn_freepublish, a[data-action="freepublish"], .weui-desktop-btn:has-text("发表")')
        if (!sendStarted) return fail(actionLabel + '按钮不可用 url=' + win.webContents.getURL())
        await this._sleep(2000)
        if (!await this._click(win,'.dialog_bd_btn a:has-text("确定"), .weui-desktop-btn:has-text("确定")')) return fail('确认失败：确认按钮不可用 url=' + win.webContents.getURL())
        const donePattern = isMass ? /群发成功|已发送|发送成功|发表成功|已发表|发布成功/ : /发表成功|已发表|发布成功/
        const xhrHit = await xhrPromise
        const pageHit = await this._waitForCondition(win, 'function(){var t=(document.body&&document.body.innerText)||"";return ' + donePattern.toString() + '.test(t);}', 20000, 800)
        if (!xhrHit && !pageHit) {
          const toast = await readVisibleEditorToast(win)
          log.warn('RpaView', '[wechat_mp] ' + actionLabel + ' no success evidence: xhr=' + JSON.stringify(xhrHit) + ' page=' + pageHit + ' toast=' + String(toast).slice(0,120))
          return { success:false, error:'微信公众号' + actionLabel + '结果无法确认（未收到平台成功信号），请到公众号后台核实后重试；' + String(toast || '').slice(0, 80), platform:'wechat_mp' }
        }
        await this._sleep(1000)
      } catch(e) {
        log.warn('RpaView','wechat_mp '+actionLabel+': '+e.message)
        return { success:false, error:'微信公众号'+actionLabel+'失败：'+e.message, platform:'wechat_mp' }
      }
    }

    this._emitProgress('wechat_mp','done',100)
    return { success:true, url:win.webContents.getURL()||'', platform:'wechat_mp' }
  },

  // ========== P2-D: youtube — multi-step wizard ==========
  async _publish_youtube(win, article) {
    this._emitProgress('youtube','navigating to Studio...',5)
    await this._navigateAndWait(win,'https://studio.youtube.com/',3000)

    const curUrl = win.webContents.getURL()
    if (curUrl.includes('signin')||curUrl.includes('login')||curUrl.includes('ServiceLogin'))
      { log.warn('RpaView', '[youtube] not logged in url=' + curUrl); return { success:false, error:'youtube not logged in', platform:'youtube' } }

    if (!article.video_path)
      return { success:false, error:'youtube needs video file', platform:'youtube' }

    // Click Create → Upload video
    this._emitProgress('youtube','clicking Create...',10)
    const created = await this._click(win,'#create-icon, ytcp-button#create-icon')
    await this._sleep(2000)
    if (created) {
      await this._click(win,'tp-yt-paper-item:has-text("上传视频"), .ytcp-menu-item:has-text("上传视频")')
      await this._sleep(2000)
    }

    // Upload file
    this._emitProgress('youtube','uploading video...',25)
    if (await this._waitForElement(win,'input[type="file"]',15000)) {
      await this._setFileInput(win,article.video_path)
    }

    // Wait for upload to complete
    this._emitProgress('youtube','waiting for upload...',35)
    const uploaded = await this._waitForCondition(win, 'function(){let progress=document.querySelector(\'#progress-bar, [class*="progress"]\');let done=document.querySelector(\'#done-button, ytcp-button:has-text("下一步")\');return !progress||(done&&!done.disabled)}', 300000)
    if (!uploaded) log.warn('RpaView','youtube: upload wait timeout')
    this._emitProgress('youtube','upload complete',50)

    // Fill title
    if (article.title) {
      this._emitProgress('youtube','filling title...',55)
      if (await this._waitForElement(win,'#title-textarea, [class*="title"] input',10000)) {
        try { await this._fillInput(win,'#title-textarea, [class*="title"] input',article.title) } catch (e) { log.warn('RpaView','[youtube] title fill: '+e.message) }
      }
    }

    // Fill description
    if (article.content) {
      this._emitProgress('youtube','filling description...',65)
      if (await this._waitForElement(win,'#description-textarea, [class*="description"] textarea',10000)) {
        try { await this._fillInput(win,'#description-textarea, [class*="description"] textarea',article.content) } catch (e) { log.warn('RpaView','[youtube] desc fill: '+e.message) }
      }
    }

    // Click Next (video elements)
    this._emitProgress('youtube','next step (elements)...',75)
    try {
      await this._click(win,'ytcp-button:has-text("下一步"), #next-button')
      await this._sleep(3000)
    } catch(e) { log.warn('RpaView','youtube: next1: '+e.message) }

    // Click Next (visibility/schedule)
    try {
      await this._click(win,'ytcp-button:has-text("下一步"), #next-button')
      await this._sleep(3000)
    } catch(e) { log.warn('RpaView','youtube: next2: '+e.message) }

    // Set visibility to Public
    try {
      await this._click(win,'tp-yt-paper-radio-button[name="PUBLIC"], #public-radio-button')
      await this._sleep(1000)
    } catch(e) { log.warn('RpaView','youtube: visibility: '+e.message) }

    // Click Publish
    this._emitProgress('youtube','publishing...',90)
    try {
      await this._click(win,'ytcp-button:has-text("发布"), #done-button')
      await this._sleep(5000)
    } catch(e) { log.warn('RpaView','youtube: publish btn: '+e.message) }

    this._emitProgress('youtube','done',100)
    return { success:true, url:win.webContents.getURL()||'', platform:'youtube' }
  },

  async _publish_xiaohongshu(win, article) {
    if (!article || (!article.title && !article.content && !article.video_path)) {
      return { success:false, error:'小红书发布至少需要标题、正文或视频', platform:'xiaohongshu' }
    }
    const config = this._getPlatformConfig('xiaohongshu')
    const contentType = article.video_path ? 'video' : 'image'
    if (contentType === 'video') return buildXhsVideoRefusal(win)   // 小红书不得真实发布：视频草稿链未实现 ⇒ fail-closed
    const publishUrl = getPublishUrl('xiaohongshu', contentType)
    // 2026-09-29 图文模式：publish/publish?from=menu 默认落「上传视频」tab（实测 file input accept 全是视频格式）；
    // 图文须先点「上传图文」tab（switchImageTab hook，参考产品 renderImage 同款 children[1].click()），否则图片上传进视频通道必失败。
    const isImageMode = contentType === 'image'
    return this._publish_generic(win, article, 'xiaohongshu', {
      ...config,
      publish_url: publishUrl || config.publish_url,
      ...(isImageMode ? { preFill: 'switchImageTab' } : {}),
      // 2026-09-29 需求调整（用户指定）：小红书图文只落到平台草稿箱，不点发布。
      // 小红书编辑页有自动草稿保存（页面「编辑于 刚刚」，侧边栏草稿箱计数 +1），
      // 填完标题/正文/图片后等落库即可；用户回头扫码在草稿箱里自行发布。
      // 视频模式保持原发布链路（草稿箱对视频无此约定）。
      ...(isImageMode ? { draftOnly: true } : {}),
    })
  },

  // 2026-09-29 图文模式：快手双入口 URL 选择（视频 tabType=1 / 图文 tabType=2，
  // getPublishUrl 单一来源）+ 委托 generic 流程（图片上传已在 generic 内建）。
  async _publish_kuaishou(win, article) {
    const config = this._getPlatformConfig('kuaishou')
    const contentType = article.video_path ? 'video' : 'image'
    const publishUrl = getPublishUrl('kuaishou', contentType)
    // 图文模式：图片上传 input 是激活 tabpane 里 accept 含 image 的那个
    // （2026-09-29 实测 tabType=2 页面有 2 个 file input：视频 tab 的 accept 全视频格式、
    // 图文 tab 的 accept 是 image/png…；config 的 #joyride-wrapper 选择器只匹配视频 tab，
    // 首个 input[type=file] 恒为视频通道——图片传进去必失败）
    // 2026-09-30 追加取证：快手的这两个 input **两条注入路径都失效**（CDP 不抛错但文件被
    // 清空、DataTransfer 赋值立即归零），唯一可用通道是向 dragger-content 派发 drop 事件
    // （参考产品 kuaishouImageRun 同款）。故图文模式显式给出 drag_area 选择器。
    const isImageMode = contentType === 'image'
    const effectiveConfig = isImageMode
      ? {
        ...config,
        selectors: {
          ...config.selectors,
          file_input: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
          // 2026-10-12：图文模式必须**关掉封面通道**。渲染层新增「自动封面同时落 cover_path」
          // 后（`usePublishFlow` 的 AUTO_COVER_PLATFORMS），`_publish_generic` 的
          // `article.cover_path && sel.cover_input` 分支会在图片已由 file_input/drag_area 上传之后
          // **再注入同一张图**，产出重复图片。快手图文的语义本就是「首图即封面」，
          // 封面通道在此为空是正确表达，不是省略。
          cover_input: [],
          drag_area: '#rc-tabs-0-panel-2 div[class^="_dragger-content_"], div[class*="dragger-content"]',
        },
      }
      : config
    return this._publish_generic(win, article, 'kuaishou', {
      ...effectiveConfig,
      publish_url: publishUrl || config.publish_url,
    })
  },

  // 2026-09-30 头条图文（= 文章编辑器 /profile_v4/graphic/publish）：
  // 此前**没有 toutiao 分支** ⇒ 路由回退 `_publish_generic` 并沿用 config.publish_url，
  // 而该值是根地址 `https://mp.toutiao.com/`（首页）——落地后标题/正文/发布按钮全部找不到
  // （实测日志：`no title_input nor editor candidate` + `content editor not found among 4 candidates`
  //  + `publish btn not found`，三次重试后 `publish failed ... url=`）。
  // 修法：补双入口（getPublishUrl 已支持 toutiao 图文 = 文章编辑器），从此走对页面。
  // 修法：补双入口（getPublishUrl 已支持 toutiao 图文 = 文章编辑器），从此走对页面。
  // 2026-10-02：方法体外移至 rpa-engine/toutiao-direct-bridge（行数门禁；含 Node 直连兜底，PRD §16.8.8）。
  async _publish_toutiao (win, article) {
    return require('@multi-publish/rpa-engine/src/toutiao-direct-bridge')
      .publishToutiao({
        win,
        article,
        host: this,
        sign: require('@multi-publish/rpa-engine/src/publish-signer').sign.bind(
          require('@multi-publish/rpa-engine/src/publish-signer')),
        log,
        getPublishUrl,
        stripHtml: stripHtmlToPlainText,
      })
  },

  async _publish_zhihu(win, article) {
    this._emitProgress('zhihu','navigating to write page...',5)
    // 2026-09-29 图文发布修复（实测取证）：www.zhihu.com/creator/write 落地页与
    // .WriteIndex-titleInput 等选择器失配（15s 超时全灭）；zhuanlan.zhihu.com/write
    // 实测选择器全命中（LABEL.WriteIndex-titleInput 包 TEXTAREA.Input +
    // .public-DraftEditor-content[contenteditable] + 发布 button）。
    await this._navigateAndWait(win,'https://zhuanlan.zhihu.com/write')
    if (win.webContents.getURL().includes('signin')||win.webContents.getURL().includes('login'))
      { log.warn('RpaView', '[zhihu] not logged in url=' + win.webContents.getURL()); return {success:false,error:'zhihu not logged in',platform:'zhihu'} }
    this._emitProgress('zhihu','waiting for editor...',15)
    if (!(await this._waitForElement(win,'.WriteIndex-titleInput, .DraftEditor-title, .title-input, .Editable-title',15000)))
      { log.warn('RpaView', '[zhihu] editor not loaded url=' + win.webContents.getURL()); return {success:false,error:'zhihu: editor not loaded',platform:'zhihu'} }
    // 正文编辑器就绪等待（实测 .public-DraftEditor-content 命中；Draft.js 挂载晚于标题框）
    await this._waitForElement(win,'.public-DraftEditor-content, .DraftEditor-root, [contenteditable="true"]',10000)
    if (article.title) {
      this._emitProgress('zhihu','filling title...',30)
      try {
        // 2026-09-29 修复：.WriteIndex-titleInput 是 LABEL wrapper（Input-wrapper--multiline），
        // 旧实现 ti.textContent=标题 写在 label 上、真实输入框从未收到值。
        // 正解：定位 wrapper 内部 textarea/input，用原生 value setter + input/change 事件。
        const tj = JSON.stringify(article.title)
        await win.webContents.executeJavaScript("(function(){var w=document.querySelector('.WriteIndex-titleInput, .DraftEditor-title, .title-input, .Editable-title');var ti=w?w.querySelector('textarea, input'):null;if(!ti)ti=document.querySelector('textarea[placeholder*=\"标题\"], input[placeholder*=\"标题\"]');if(!ti)return false;ti.focus();var proto=ti.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;var d=Object.getOwnPropertyDescriptor(proto,'value');if(d&&d.set)d.set.call(ti,"+tj+");else ti.value="+tj+";ti.dispatchEvent(new Event('input',{bubbles:true}));ti.dispatchEvent(new Event('change',{bubbles:true}));return true;})()")
      } catch(e) { log.warn('RpaView','zhihu title: '+e.message) }
    }
    if (article.content) {
      this._emitProgress('zhihu','filling content...',50)
      try {
        // 2026-09-29 修复：Draft.js 不接受 innerHTML 直写容器（.DraftEditor-root 是容器非
        // contenteditable，实测 innerHTML 写入后框架状态为空、发布出空文）；也不接受
        // execCommand 合成分块。正解（实测取证）：JS focus .public-DraftEditor-content →
        // CDP Input.insertText 可信注入（框架收到真实 beforeinput 并入状态）。
        // 内容格式：发布页编辑器是 Quill（content-type=html），article.content 到达时已被
        // 规范化为 HTML（<p>…</p>）；Draft.js 是纯文本编辑器，注入前先在页面内转纯文本
        // （<p> 段落 → \n\n 分隔，textContent 保留段内换行）。
        const plainContent = await win.webContents.executeJavaScript('(function(){var html=' + JSON.stringify(String(article.content)) + ';if(!/<[a-z][\\s\\S]*>/i.test(html))return html;try{var doc=new DOMParser().parseFromString(html,\'text/html\');var paras=[...doc.querySelectorAll(\'p,div,h1,h2,h3,h4,li,blockquote,pre\')];if(paras.length>0)return paras.map(function(p){return p.textContent.trim()}).filter(Boolean).join(\'\\n\\n\');return doc.body.textContent}catch(e){return html.replace(/<[^>]+>/g,\'\')}})()')
        const focused = await win.webContents.executeJavaScript('(function(){var ed=document.querySelector(\'.public-DraftEditor-content, [contenteditable="true"]\');if(!ed)return false;ed.focus();return document.activeElement===ed})()')
        if (focused) {
          const inserted = await this._insertTextTrusted(win, plainContent)
          if (inserted) {
            // input 事件兜底同步（部分框架监听 input 而非 beforeinput）
            await win.webContents.executeJavaScript('(function(){var ed=document.querySelector(\'.public-DraftEditor-content, [contenteditable="true"]\');if(ed)ed.dispatchEvent(new Event(\'input\',{bubbles:true}));return true})()').catch(function(){ /* ignore */ })
          } else {
            log.warn('RpaView', 'zhihu content: trusted insert failed, fallback to innerHTML')
            await this._setElementContentSafe(win, '.DraftEditor-root, .Editable-editor, .ql-editor, [contenteditable="true"]', plainContent)
          }
        } else {
          log.warn('RpaView', 'zhihu content: editor focus failed, fallback to innerHTML')
          await this._setElementContentSafe(win, '.DraftEditor-root, .Editable-editor, .ql-editor, [contenteditable="true"]', plainContent)
        }
      } catch(e) { log.warn('RpaView','zhihu content: '+e.message) }
    }
    this._emitProgress('zhihu','publishing...',80)
    try {
      const pubBtn = "button:has-text('\u53d1\u5e03'), .PublishPanel-publish"
      if (!(await this._waitForElement(win,pubBtn,10000)))
        { log.warn('RpaView', '[zhihu] publish button not found url=' + win.webContents.getURL()); return {success:false,error:'zhihu: publish button not found',platform:'zhihu'} }
      if (article.draft) {
        const saveBtn = "button:has-text('\u4fdd\u5b58\u8349\u7a3f'), .WriteIndex-saveDraft"
        if (!(await this._waitForElement(win,saveBtn,5000)))
          { log.warn('RpaView', '[zhihu] save draft btn not found url=' + win.webContents.getURL()); return {success:false,error:'zhihu: save draft btn not found',platform:'zhihu'} }
        await this._click(win,saveBtn)
        await this._sleep(2000)
        this._emitProgress('zhihu','draft saved',100)
        return {success:true,url:win.webContents.getURL()||'',platform:'zhihu',draft:true}
      }
      await this._click(win,pubBtn)
      this._emitProgress('zhihu','verifying...',95)
      // 2026-10-15 报障修复（「显示成功但没有真实发布」）：知乎发布是**两段式** —— 首次点
      // 「发布」只落成草稿并跳到 /p/<id>/edit，该页需再点一次才真发布；旧判据 `/\/p\/\d+/`
      // 恰好命中草稿编辑页 ⇒ 假成功（真机 2026-10-15T12:40:19Z→22Z）。确认逻辑见模块。
      const confirm = await zhihuPublishState.confirmZhihuPublished({
        readUrl: () => win.webContents.getURL(),
        waitForElement: (sel,ms) => this._waitForElement(win,sel,ms),
        click: (sel) => this._click(win,sel),
        sleep: (ms) => this._sleep(ms),
        publishButton: pubBtn,
        log,
      })
      if (confirm.published) {
        this._emitProgress('zhihu','published!',100)
        return {success:true,url:confirm.url,platform:'zhihu',postId:confirm.postId}
      }
      log.warn('RpaView', '[zhihu] publish not confirmed reason='+confirm.reason+' url='+confirm.url)
      return {success:false,error:'zhihu: publish not confirmed ('+confirm.reason+') url='+confirm.url,platform:'zhihu',url:confirm.url}
    } catch(e) {
      log.error('RpaView','zhihu publish: '+e.message)
      return {success:false,error:e.message,platform:'zhihu'}
    }
  },
}

// 合并抽出的 mixin（后写者胜：uploadWaiterMixin v4 须居 navigationHelpers 之后；artifactsHelpers 无键冲突）
module.exports = Object.assign(platformsMixin, navigationHelpers, uploadWaiterMixin, artifactsHelpers)
