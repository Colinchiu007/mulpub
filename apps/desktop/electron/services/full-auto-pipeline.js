// @ts-check
/**
 * FullAutoPipeline — 全自动内容生产与发布管道编排引擎
 *
 * 将采集→改写→创作→发布四阶段串联为线性 DAG，一键全自动执行。
 * 支持视频发布（含视频创作）和图文发布（跳过创作）两条分支。
 *
 * 阶段：
 *   1. collect  — 采集阶段（单篇 URL / RSS 批量 / URL 列表）
 *   2. rewrite  — 改写阶段（逐篇 AI 改写）
 *   3. create   — 创作阶段（视频模式调 story2video-compose；图文模式跳过）
 *   4. publish  — 发布阶段（遍历所有账号，逐平台发布）
 *
 * 进度事件（EventEmitter）：
 *   - run:progress  { runId, ...snapshot }
 *   - run:log       { runId, time, message, level }
 *   - run:completed { runId, status, results }
 *   - run:error     { runId, stage, error }
 */
'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');

const STAGES = ['collect', 'rewrite', 'create', 'publish'];

const STAGE_LABELS = {
  collect: '采集',
  rewrite: '改写',
  create: '创作',
  publish: '发布',
};

const STAGE_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
};

const RUN_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const PUBLISH_INTERVAL_MS = 5000;

function generateRunId() {
  return 'auto_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function formatTime() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

class FullAutoPipeline extends EventEmitter {
  /**
   * @param {object} deps
   * @param {object} deps.pythonBridge - Python 后端桥接
   * @param {object} deps.pipelineEngine - 流水线引擎
   * @param {object} deps.publisherRouter - 发布路由
   * @param {object} deps.accountManager - 账号管理器 { listAccounts }
   * @param {object} deps.runStateStore - 快照持久化
   * @param {object} deps.rpaViewManager - RPA 视图管理器（发布依赖）
   * @param {object} deps.store - 存储服务（发布依赖）
   * @param {object} deps.log - 日志服务
   */
  constructor(deps) {
    super();
    this._pythonBridge = deps.pythonBridge;
    this._pipelineEngine = deps.pipelineEngine;
    this._publisherRouter = deps.publisherRouter;
    this._accountManager = deps.accountManager;
    this._runStateStore = deps.runStateStore;
    this._rpaViewManager = deps.rpaViewManager;
    this._store = deps.store;
    this._log = deps.log || { info() {}, warn() {}, error() {} };
    this._runs = new Map();
    this._cancelFlags = new Map();
  }

  // ─── 公共 API ────────────────────────────────────────────

  async startRun(config) {
    if (!config || !config.contentType || !config.sourceType) {
      return { success: false, error: '缺少必要参数：contentType, sourceType' };
    }
    if (config.sourceType === 'url' && (!config.urls || config.urls.length === 0)) {
      return { success: false, error: '单篇采集模式下 urls 不能为空' };
    }
    if ((config.sourceType === 'rss' || config.sourceType === 'batch') &&
        (!config.urls || config.urls.length === 0) && !config.rssUrl) {
      return { success: false, error: '批量采集模式下 urls 或 rssUrl 不能为空' };
    }

    const runId = generateRunId();
    const run = this._createRunContext(runId, config);
    this._runs.set(runId, run);
    this._cancelFlags.set(runId, false);

    this._logRun(runId, 'info', '管道启动：' + config.contentType + ' / ' + config.sourceType);

    this._executeRun(runId).catch((err) => {
      this._log.error('FullAutoPipeline', 'run ' + runId + ' fatal: ' + (err && err.message ? err.message : String(err)));
    });

    return { success: true, runId };
  }

  getRunSnapshot(runId) {
    const run = this._runs.get(runId);
    if (!run) {
      const saved = this._runStateStore ? this._runStateStore.load(runId) : null;
      return saved || null;
    }
    return this._buildSnapshot(run);
  }

  listRuns() {
    const active = [];
    for (const run of this._runs.values()) {
      active.push(this._buildSnapshot(run));
    }
    return active;
  }

  cancelRun(runId) {
    const run = this._runs.get(runId);
    if (!run) return { success: false, error: '运行不存在' };
    if (run.status !== RUN_STATUS.RUNNING) return { success: false, error: '运行已结束' };
    this._cancelFlags.set(runId, true);
    run.status = RUN_STATUS.CANCELLED;
    this._logRun(runId, 'warn', '管道已取消');
    this._emitProgress(runId);
    this._persistRun(runId);
    this.emit('run:completed', { runId, status: 'cancelled' });
    return { success: true };
  }

  async resumeRun(runId) {
    let run = this._runs.get(runId);
    if (!run) {
      const saved = this._runStateStore ? this._runStateStore.load(runId) : null;
      if (!saved) return { success: false, error: '运行不存在' };
      run = this._restoreFromSnapshot(saved);
      this._runs.set(runId, run);
    }

    if (run.status === RUN_STATUS.COMPLETED) {
      return { success: false, error: '运行已完成，无需恢复' };
    }

    let startStage = 0;
    for (let i = 0; i < run.stages.length; i++) {
      const st = run.stages[i].status;
      if (st === STAGE_STATUS.COMPLETED || st === STAGE_STATUS.SKIPPED) {
        startStage = i + 1;
      } else {
        break;
      }
    }

    run.status = RUN_STATUS.RUNNING;
    run.currentStage = startStage;
    this._cancelFlags.set(runId, false);
    this._logRun(runId, 'info', '管道恢复：从阶段 ' + (startStage + 1) + ' 继续');

    this._executeRun(runId, startStage).catch((err) => {
      this._log.error('FullAutoPipeline', 'resume ' + runId + ' fatal: ' + (err && err.message ? err.message : String(err)));
    });

    return { success: true, runId };
  }

  // ─── 内部执行 ────────────────────────────────────────────

  _createRunContext(runId, config) {
    return {
      id: runId,
      config: {
        contentType: config.contentType,
        sourceType: config.sourceType,
        urls: config.urls || [],
        rssUrl: config.rssUrl || '',
        rewriteStyle: config.rewriteStyle || '轻松易懂',
        rewriteLength: config.rewriteLength || 'keep',
        videoConfig: config.videoConfig || {},
        publishAllAccounts: config.publishAllAccounts !== false,
        platforms: config.platforms || [],
      },
      status: RUN_STATUS.RUNNING,
      currentStage: 0,
      stages: STAGES.map((id) => ({
        id,
        label: STAGE_LABELS[id],
        status: STAGE_STATUS.PENDING,
        progress: 0,
        summary: '',
        error: null,
        startedAt: null,
        completedAt: null,
      })),
      context: {
        collect: { items: [] },
        rewrite: { items: [] },
        create: { items: [] },
        publish: { results: [] },
      },
      logs: [],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    };
  }

  async _executeRun(runId, startStage = 0) {
    const run = this._runs.get(runId);
    if (!run) return;

    for (let i = startStage; i < STAGES.length; i++) {
      if (this._cancelFlags.get(runId)) break;

      const stageId = STAGES[i];
      run.currentStage = i;
      run.stages[i].status = STAGE_STATUS.RUNNING;
      run.stages[i].startedAt = new Date().toISOString();
      this._emitProgress(runId);
      this._persistRun(runId);

      try {
        await this._executeStage(runId, stageId);
        if (this._cancelFlags.get(runId)) break;
        if (run.stages[i].status !== STAGE_STATUS.SKIPPED) {
          run.stages[i].status = STAGE_STATUS.COMPLETED;
        }
        run.stages[i].completedAt = new Date().toISOString();
      } catch (e) {
        run.stages[i].status = STAGE_STATUS.FAILED;
        run.stages[i].error = e && e.message ? e.message : String(e);
        run.status = RUN_STATUS.FAILED;
        this._logRun(runId, 'error', '阶段 ' + STAGE_LABELS[stageId] + ' 失败: ' + run.stages[i].error);
        this.emit('run:error', { runId, stage: stageId, error: run.stages[i].error });
        this._emitProgress(runId);
        this._persistRun(runId);
        return;
      }

      this._emitProgress(runId);
      this._persistRun(runId);
    }

    if (this._cancelFlags.get(runId)) {
      run.status = RUN_STATUS.CANCELLED;
    } else if (run.status !== RUN_STATUS.FAILED) {
      run.status = RUN_STATUS.COMPLETED;
    }
    run.endedAt = new Date().toISOString();
    this._emitProgress(runId);
    this._persistRun(runId);
    this.emit('run:completed', { runId, status: run.status, results: run.context.publish.results });
  }

  async _executeStage(runId, stageId) {
    switch (stageId) {
      case 'collect': return this._doCollect(runId);
      case 'rewrite': return this._doRewrite(runId);
      case 'create': return this._doCreate(runId);
      case 'publish': return this._doPublish(runId);
      default: throw new Error('Unknown stage: ' + stageId);
    }
  }

  // ─── 阶段 1：采集 ─────────────────────────────────────────

  async _doCollect(runId) {
    const run = this._runs.get(runId);
    const sourceType = run.config.sourceType;
    const urls = run.config.urls;
    const rssUrl = run.config.rssUrl;
    const stage = run.stages[0];

    this._logRun(runId, 'info', '开始采集阶段，来源类型：' + sourceType);

    if (sourceType === 'rss' || sourceType === 'batch') {
      const payload = { source_type: sourceType };
      if (rssUrl) payload.rss_url = rssUrl;
      if (urls && urls.length > 0) payload.urls = urls;

      this._logRun(runId, 'info', '发起批量采集请求...');
      const result = await this._pythonBridge.requestBackend('POST', '/aggregation/collect/batch', payload);

      if (result && result.code !== 0) {
        throw new Error('批量采集失败: ' + (result.message || '未知错误'));
      }

      const taskId = (result && result.data && result.data.task_id) ? result.data.task_id : (result && result.task_id);
      if (!taskId) {
        throw new Error('批量采集未返回 task_id');
      }

      this._logRun(runId, 'info', '批量采集任务已创建：' + taskId + '，等待完成...');
      run.context.collect.items = await this._pollBatchTask(runId, taskId, stage);
    } else {
      const items = [];
      const total = urls.length;
      for (let i = 0; i < urls.length; i++) {
        if (this._cancelFlags.get(runId)) break;
        const url = urls[i];
        this._logRun(runId, 'info', '采集 ' + (i + 1) + '/' + total + ': ' + url);

        try {
          const result = await this._pythonBridge.requestBackend('POST', '/aggregation/collect', { url });
          if (result && result.code === 0 && result.data) {
            const item = result.data;
            items.push({
              title: item.title || '',
              content: item.content || '',
              coverImage: item.cover_image || item.coverImage || '',
              sourceUrl: url,
              raw: item,
            });
            this._logRun(runId, 'info', '采集完成: ' + (item.title || url));
          } else {
            const errMsg = (result && result.message) || '未知错误';
            this._logRun(runId, 'error', '采集失败: ' + url + ' — ' + errMsg);
            items.push({ title: '', content: '', coverImage: '', sourceUrl: url, error: errMsg });
          }
        } catch (e) {
          this._logRun(runId, 'error', '采集异常: ' + url + ' — ' + (e && e.message ? e.message : String(e)));
          items.push({ title: '', content: '', coverImage: '', sourceUrl: url, error: e && e.message ? e.message : String(e) });
        }

        stage.progress = Math.round(((i + 1) / total) * 100);
        this._emitProgress(runId);
      }
      run.context.collect.items = items;
    }

    stage.summary = '采集完成（' + run.context.collect.items.length + ' 篇）';
    stage.progress = 100;
    this._logRun(runId, 'info', stage.summary);
  }

  async _pollBatchTask(runId, taskId, stage, maxWaitMs = 300000) {
    const startTime = Date.now();
    const pollInterval = 3000;

    while (Date.now() - startTime < maxWaitMs) {
      if (this._cancelFlags.get(runId)) return [];

      const result = await this._pythonBridge.requestBackend('GET', '/aggregation/tasks/' + encodeURIComponent(String(taskId)));
      const status = (result && result.status) || (result && result.data && result.data.status);

      if (status === 'completed' || status === 'success') {
        const items = (result && result.data && result.data.items) || (result && result.items) || [];
        return items.map((item) => ({
          title: item.title || '',
          content: item.content || '',
          coverImage: item.cover_image || item.coverImage || '',
          sourceUrl: item.source_url || item.sourceUrl || '',
          raw: item,
        }));
      }

      if (status === 'failed' || status === 'error') {
        throw new Error('批量采集任务失败: ' + ((result && result.message) || '未知错误'));
      }

      const progress = (result && result.data && result.data.progress) || (result && result.progress);
      if (typeof progress === 'number') {
        stage.progress = Math.min(99, Math.round(progress * 100));
        this._emitProgress(runId);
      }

      await this._sleep(pollInterval);
    }

    throw new Error('批量采集超时（超过 ' + (maxWaitMs / 1000) + ' 秒）');
  }

  // ─── 阶段 2：改写 ─────────────────────────────────────────

  async _doRewrite(runId) {
    const run = this._runs.get(runId);
    const items = run.context.collect.items;
    const stage = run.stages[1];
    const rewriteStyle = run.config.rewriteStyle;
    const rewriteLength = run.config.rewriteLength;

    if (!items || items.length === 0) {
      throw new Error('采集阶段无结果，无法改写');
    }

    this._logRun(runId, 'info', '开始改写阶段，共 ' + items.length + ' 篇，风格：' + rewriteStyle + '，长度：' + rewriteLength);

    const rewritten = [];
    const total = items.length;
    const CONCURRENCY = 3;

    for (let i = 0; i < items.length; i += CONCURRENCY) {
      if (this._cancelFlags.get(runId)) break;
      const batch = items.slice(i, i + CONCURRENCY);
      const promises = batch.map(async (item, bi) => {
        const idx = i + bi;
        if (!item.content) {
          this._logRun(runId, 'warn', '跳过改写 ' + (idx + 1) + '/' + total + ': 无内容');
          return { ...item, rewrittenContent: item.content, rewriteStatus: 'skipped' };
        }

        try {
          this._logRun(runId, 'info', '改写 ' + (idx + 1) + '/' + total + ': ' + (item.title || item.sourceUrl));
          const result = await this._pythonBridge.requestBackend('POST', '/aggregation/rewrite', {
            title: item.title,
            content: item.content,
            style: rewriteStyle,
            length: rewriteLength,
          });

          if (result && result.code === 0 && result.data) {
            const rewrittenContent = result.data.content || result.data.rewritten_content || '';
            this._logRun(runId, 'info', '改写完成 ' + (idx + 1) + '/' + total);
            return { ...item, rewrittenContent: rewrittenContent || item.content, rewriteStatus: 'success' };
          } else {
            const errMsg = (result && result.message) || '改写失败';
            this._logRun(runId, 'error', '改写失败 ' + (idx + 1) + '/' + total + ': ' + errMsg);
            return { ...item, rewrittenContent: item.content, rewriteStatus: 'failed', rewriteError: errMsg };
          }
        } catch (e) {
          this._logRun(runId, 'error', '改写异常 ' + (idx + 1) + '/' + total + ': ' + (e && e.message ? e.message : String(e)));
          return { ...item, rewrittenContent: item.content, rewriteStatus: 'failed', rewriteError: e && e.message ? e.message : String(e) };
        }
      });

      const batchResults = await Promise.all(promises);
      rewritten.push(...batchResults);
      stage.progress = Math.round((rewritten.length / total) * 100);
      this._emitProgress(runId);
    }

    run.context.rewrite.items = rewritten;
    const successCount = rewritten.filter((r) => r.rewriteStatus === 'success').length;
    stage.summary = '改写完成（' + successCount + '/' + total + '）';
    stage.progress = 100;
    this._logRun(runId, 'info', stage.summary);
  }

  // ─── 阶段 3：创作 ─────────────────────────────────────────

  async _doCreate(runId) {
    const run = this._runs.get(runId);
    const items = run.context.rewrite.items;
    const stage = run.stages[2];
    const contentType = run.config.contentType;

    if (contentType === 'article') {
      stage.status = STAGE_STATUS.SKIPPED;
      stage.summary = '图文模式，跳过创作阶段';
      stage.progress = 100;
      run.context.create.items = items.map((item) => ({
        ...item,
        videoPath: null,
        createStatus: 'skipped',
      }));
      this._logRun(runId, 'info', stage.summary);
      return;
    }

    if (!this._pipelineEngine) {
      throw new Error('pipelineEngine 未注入，无法进行视频创作');
    }

    this._logRun(runId, 'info', '开始视频创作阶段，共 ' + items.length + ' 篇');

    const created = [];
    const total = items.length;
    const MAX_CONCURRENT = 2;

    for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
      if (this._cancelFlags.get(runId)) break;
      const batch = items.slice(i, i + MAX_CONCURRENT);

      const promises = batch.map(async (item, bi) => {
        const idx = i + bi;
        const text = item.rewrittenContent || item.content;
        if (!text) {
          this._logRun(runId, 'warn', '跳过创作 ' + (idx + 1) + '/' + total + ': 无内容');
          return { ...item, videoPath: null, createStatus: 'skipped' };
        }

        try {
          this._logRun(runId, 'info', '视频创作 ' + (idx + 1) + '/' + total + ': ' + (item.title || item.sourceUrl));

          const params = {
            text,
            autoAdvance: true,
            background: true,
            checkpointPolicy: 'none',
            ...(run.config.videoConfig || {}),
          };

          const result = await this._pipelineEngine.startOrchestrated('story2video-compose', params);

          if (result && result.success) {
            const pipelineRunId = result.runId;
            this._logRun(runId, 'info', '视频创作已启动: runId=' + pipelineRunId + '，等待完成...');
            const videoResult = await this._pollPipelineRun(runId, pipelineRunId);
            return {
              ...item,
              videoPath: videoResult.videoPath || null,
              createRunId: pipelineRunId,
              createStatus: videoResult.success ? 'success' : 'failed',
              createError: videoResult.error || null,
            };
          } else {
            const errMsg = (result && result.error) || '视频创作启动失败';
            this._logRun(runId, 'error', '视频创作启动失败 ' + (idx + 1) + '/' + total + ': ' + errMsg);
            return { ...item, videoPath: null, createRunId: null, createStatus: 'failed', createError: errMsg };
          }
        } catch (e) {
          this._logRun(runId, 'error', '视频创作异常 ' + (idx + 1) + '/' + total + ': ' + (e && e.message ? e.message : String(e)));
          return { ...item, videoPath: null, createStatus: 'failed', createError: e && e.message ? e.message : String(e) };
        }
      });

      const batchResults = await Promise.all(promises);
      created.push(...batchResults);
      stage.progress = Math.round((created.length / total) * 100);
      this._emitProgress(runId);
    }

    run.context.create.items = created;
    const successCount = created.filter((r) => r.createStatus === 'success').length;
    stage.summary = '创作完成（' + successCount + '/' + total + ' 个视频）';
    stage.progress = 100;
    this._logRun(runId, 'info', stage.summary);
  }

  async _pollPipelineRun(runId, pipelineRunId, maxWaitMs = 1800000) {
    const startTime = Date.now();
    const pollInterval = 5000;

    while (Date.now() - startTime < maxWaitMs) {
      if (this._cancelFlags.get(runId)) return { success: false, error: '已取消' };

      try {
        const status = await this._pipelineEngine.getRunContext(pipelineRunId);
        if (status) {
          const runStatus = status.status || (status.run && status.run.status);
          if (runStatus === 'completed' || runStatus === 'success') {
            return { success: true, videoPath: this._extractVideoPath(status) };
          }
          if (runStatus === 'failed' || runStatus === 'error') {
            return { success: false, error: status.error || '视频创作失败' };
          }
          if (runStatus === 'cancelled') {
            return { success: false, error: '视频创作已取消' };
          }
        }
      } catch (e) {
        this._log.warn('FullAutoPipeline', 'poll pipeline run ' + pipelineRunId + ': ' + (e && e.message ? e.message : String(e)));
      }

      await this._sleep(pollInterval);
    }

    return { success: false, error: '视频创作超时（超过 ' + (maxWaitMs / 1000) + ' 秒）' };
  }

  _extractVideoPath(runStatus) {
    if (!runStatus) return null;
    const output = runStatus.output || runStatus.context || {};
    const stages = runStatus.stages || [];
    for (const s of stages) {
      if (s.type === 'compose' || s.id === 'compose') {
        const out = s.output || {};
        if (out.videoPath) return out.videoPath;
        if (out.video_path) return out.video_path;
      }
    }
    return output.videoPath || output.video_path || output.finalVideoPath || null;
  }

  // ─── 阶段 4：发布 ─────────────────────────────────────────

  async _doPublish(runId) {
    const run = this._runs.get(runId);
    const createItems = run.context.create.items;
    const stage = run.stages[3];
    const contentType = run.config.contentType;
    const publishAllAccounts = run.config.publishAllAccounts;
    const configPlatforms = run.config.platforms;

    let accounts = [];
    if (publishAllAccounts && this._accountManager && typeof this._accountManager.listAccounts === 'function') {
      try {
        accounts = await this._accountManager.listAccounts();
        this._logRun(runId, 'info', '获取到 ' + accounts.length + ' 个账号');
      } catch (e) {
        throw new Error('获取账号列表失败：' + (e && e.message ? e.message : String(e)), { cause: e });
      }
    }

    if (accounts.length === 0) {
      throw new Error('没有可用的发布账号');
    }

    let targetAccounts = accounts;
    if (configPlatforms && configPlatforms.length > 0) {
      targetAccounts = accounts.filter((a) => configPlatforms.indexOf(a.platform) !== -1);
      if (targetAccounts.length === 0) {
        throw new Error('指定的平台没有匹配的账号');
      }
    }

    this._logRun(runId, 'info', '开始发布阶段，共 ' + createItems.length + ' 篇内容，' + targetAccounts.length + ' 个目标账号');

    const allResults = [];
    const totalItems = createItems.length;
    const totalAccounts = targetAccounts.length;

    for (let i = 0; i < createItems.length; i++) {
      if (this._cancelFlags.get(runId)) break;
      const item = createItems[i];
      const itemTitle = item.title || item.sourceUrl || ('内容 ' + (i + 1));
      this._logRun(runId, 'info', '发布内容 ' + (i + 1) + '/' + totalItems + ': ' + itemTitle);

      for (let j = 0; j < targetAccounts.length; j++) {
        if (this._cancelFlags.get(runId)) break;
        const account = targetAccounts[j];
        const platform = account.platform;

        try {
          const task = this._buildPublishTask(contentType, item, platform, account);
          this._logRun(runId, 'info', '发布到 ' + platform + ' (' + (j + 1) + '/' + totalAccounts + ')');

          const publisher = this._publisherRouter.createPublisher(platform, {
            rpaViewManager: this._rpaViewManager,
            store: this._store,
            pythonBridge: this._pythonBridge,
          });

          const result = await publisher.publish(task);

          allResults.push({
            itemIndex: i,
            platform,
            accountId: account.id || account.accountId || account.account_id,
            success: !!(result && result.success),
            url: (result && result.url) || (result && result.postId) || '',
            error: (result && result.success) ? null : ((result && result.error) || '发布失败'),
          });

          const ok = result && result.success;
          this._logRun(runId, 'info', (ok ? '发布成功' : '发布失败') + ' ' + platform + (ok && result.url ? ' url=' + result.url : ''));
        } catch (e) {
          allResults.push({
            itemIndex: i,
            platform,
            accountId: account.id || account.accountId || account.account_id,
            success: false,
            url: '',
            error: e && e.message ? e.message : String(e),
          });
          this._logRun(runId, 'error', '发布异常 ' + platform + ': ' + (e && e.message ? e.message : String(e)));
        }

      if (j < targetAccounts.length - 1) {
        await this._sleep(PUBLISH_INTERVAL_MS);
      }

      // 每账号更新进度（一次内容可能有多个账号）
      stage.progress = Math.round(((i * targetAccounts.length + j + 1) / (totalItems * totalAccounts)) * 100);
      this._emitProgress(runId);
    }

  }

    run.context.publish.results = allResults;
    const successCount = allResults.filter((r) => r.success).length;
    stage.summary = '发布完成（' + successCount + '/' + allResults.length + ' 成功）';
    stage.progress = 100;
    this._logRun(runId, 'info', stage.summary);
  }

  _buildPublishTask(contentType, item, platform, account) {
    const title = item.title || '';
    const content = item.rewrittenContent || item.content || '';
    const article = {
      title,
      content,
      cover_path: item.coverImage || '',
      tags: [],
    };
    if (contentType === 'video') {
      article.video_path = item.videoPath || '';
    }
    return {
      id: 'auto_' + Date.now() + '_' + platform,
      platform,
      owner_subject: account.owner_subject,
      article,
    };
  }

  // ─── 辅助方法 ────────────────────────────────────────────

  _buildSnapshot(run) {
    return {
      runId: run.id,
      status: run.status,
      progress: this._calcTotalProgress(run),
      stages: run.stages.map((s) => ({
        id: s.id,
        label: s.label,
        status: s.status,
        progress: s.progress,
        summary: s.summary,
        error: s.error,
      })),
      logs: run.logs.slice(-100),
      config: run.config,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt || null,
    };
  }

  _calcTotalProgress(run) {
    const weights = [25, 25, 25, 25];
    let total = 0;
    for (let i = 0; i < run.stages.length; i++) {
      const s = run.stages[i];
      if (s.status === STAGE_STATUS.COMPLETED || s.status === STAGE_STATUS.SKIPPED) {
        total += weights[i];
      } else if (s.status === STAGE_STATUS.RUNNING) {
        total += (weights[i] * s.progress) / 100;
      }
    }
    return Math.round(total);
  }

  _emitProgress(runId) {
    const run = this._runs.get(runId);
    if (!run) return;
    this.emit('run:progress', this._buildSnapshot(run));
  }

  _logRun(runId, level, message) {
    const run = this._runs.get(runId);
    const entry = { time: formatTime(), message: String(message), level: level || 'info' };
    if (run) {
      run.logs.push(entry);
      if (run.logs.length > 500) run.logs = run.logs.slice(-500);
    }
    this.emit('run:log', { runId, time: entry.time, message: entry.message, level: entry.level });
    const logFn = this._log[level] || this._log.info;
    if (logFn) logFn('FullAutoPipeline', '[' + runId + '] ' + message);
  }

  _persistRun(runId) {
    if (!this._runStateStore) return;
    const run = this._runs.get(runId);
    if (!run) return;

    const snapshot = {
      id: run.id,
      pipeline: 'full-auto-pipeline',
      status: run.status,
      currentStage: run.currentStage,
      stages: run.stages.map((s) => ({ ...s })),
      context: run.context,
      params: run.config,
      error: null,
      orchestrationMode: 'full-auto',
      createdAt: run.createdAt,
      endedAt: run.endedAt || null,
    };

    try {
      if (run.status === RUN_STATUS.RUNNING) {
        this._runStateStore.saveRunning(snapshot);
      } else if (run.status === RUN_STATUS.FAILED || run.status === RUN_STATUS.CANCELLED) {
        this._runStateStore.saveFailed(snapshot);
      }
    } catch (e) {
      this._log.warn('FullAutoPipeline', 'persist run ' + runId + ' failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  _restoreFromSnapshot(snapshot) {
    let stages = (snapshot.stages || []).map((s) => ({
      id: s.id,
      label: STAGE_LABELS[s.id] || s.id,
      status: s.status || STAGE_STATUS.PENDING,
      progress: s.progress || 0,
      summary: s.summary || '',
      error: s.error || null,
      startedAt: s.startedAt || null,
      completedAt: s.completedAt || null,
    }));
    if (stages.length === 0) {
      stages = STAGES.map((id) => ({
        id, label: STAGE_LABELS[id], status: STAGE_STATUS.PENDING, progress: 0, summary: '', error: null,
      }));
    }
    return {
      id: snapshot.runId,
      config: snapshot.params || {},
      status: snapshot.status || RUN_STATUS.FAILED,
      currentStage: snapshot.currentStage || 0,
      stages,
      context: snapshot.context || { collect: { items: [] }, rewrite: { items: [] }, create: { items: [] }, publish: { results: [] } },
      logs: snapshot.logs || [],
      createdAt: snapshot.createdAt || new Date().toISOString(),
      startedAt: snapshot.createdAt || new Date().toISOString(),
    };
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { FullAutoPipeline, STAGES, STAGE_LABELS, RUN_STATUS, STAGE_STATUS };
