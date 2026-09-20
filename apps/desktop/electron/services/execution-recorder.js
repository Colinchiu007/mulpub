// @ts-check
/**
 * ExecutionRecorder — 生产回放录制服务（Backlot Task 9）
 *
 * 职责：
 *   - 订阅 PipelineEngine 所有事件，自动记录到 JSONL 文件
 *   - 每个事件记录：id、projectId、timestamp、type、stageName、data、snapshot
 *   - 提供 getReplay(projectId) 读取回放数据
 *   - 缓存最近 100 个事件在内存中
 *
 * 文件结构：
 *   projects/<id>/replay/execution.jsonl  — 每行一个 ExecutionEvent JSON
 *
 * 依赖：
 *   - ProjectService（获取项目目录）
 *   - PipelineEngine（订阅事件）
 *   - BoardService（构建快照，可选）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

// 订阅的 PipelineEngine 事件列表
const RECORDED_EVENTS = [
  'pipeline:start',
  'pipeline:complete',
  'pipeline:fail',
  'stage:start',
  'stage:complete',
  'stage:fail',
  'checkpoint:pause',
  'scene:complete',
  'scene:fail',
  'scene:retry',
  'contact_sheet:all_approved',
  'approval:resolved',
];

class ExecutionRecorder {
  /**
   * @param {object} deps
   * @param {object} deps.projectService - ProjectService 实例
   * @param {object} deps.pipelineEngine - PipelineEngine 实例
   * @param {object} [deps.boardService] - BoardService 实例（用于构建快照）
   * @param {string} [deps.userDataDir] - 用户数据目录覆盖（测试隔离）
   */
  constructor(deps) {
    this.projectService = deps.projectService;
    this.pipelineEngine = deps.pipelineEngine;
    this.boardService = deps.boardService || null;
    this._userDataDirOverride = deps.userDataDir || null;

    // projectId → { stream, events[], startTime }
    this._sessions = new Map();
    // projectId → 最近 100 个事件缓存
    this._cache = new Map();
    this._unsubscribers = [];
    this._listening = false;
    this._eventIdCounter = 0;
  }

  /**
   * 开始监听 PipelineEngine 事件
   */
  startListening() {
    if (this._listening) return;
    this._listening = true;
    for (const event of RECORDED_EVENTS) {
      const unsub = this.pipelineEngine.on(event, (data) => {
        this._handleEvent(event, data || {});
      });
      this._unsubscribers.push(unsub);
    }
    log.info('ExecutionRecorder', 'Started listening to ' + RECORDED_EVENTS.length + ' events');
  }

  /**
   * 停止监听
   */
  stopListening() {
    for (const unsub of this._unsubscribers) {
      try { unsub(); } catch (_) { /* ignore */ }
    }
    this._unsubscribers = [];
    this._listening = false;
  }

  /**
   * 处理 PipelineEngine 事件
   * @private
   */
  _handleEvent(type, data) {
    data = data || {};
    const projectId = data.projectId || data.runId;
    if (!projectId) return;

    // 如果还没有开始录制，自动开始
    if (!this._sessions.has(projectId)) {
      this.startRecording(projectId);
    }

    const stageName = data.stageName || '';
    this.recordEvent(projectId, type, stageName, data);
  }

  /**
   * 开始录制
   * @param {string} projectId
   */
  startRecording(projectId) {
    if (this._sessions.has(projectId)) return;

    const replayDir = this._getReplayDir(projectId);
    try {
      if (!fs.existsSync(replayDir)) {
        fs.mkdirSync(replayDir, { recursive: true });
      }
    } catch (e) {
      log.error('ExecutionRecorder', 'Failed to create replay dir: ' + e.message);
      return;
    }

    const jsonlPath = path.join(replayDir, 'execution.jsonl');
    let stream;
    try {
      // 使用 append 模式，如果文件已存在则追加
      stream = fs.createWriteStream(jsonlPath, { flags: 'a' });
      // 捕获异步错误（如目录被删除后写入），防止 uncaught exception
      stream.on('error', (e) => {
        log.error('ExecutionRecorder', 'JSONL stream error: ' + (e && e.message ? e.message : String(e)));
      });
    } catch (e) {
      log.error('ExecutionRecorder', 'Failed to open JSONL stream: ' + e.message);
      return;
    }

    this._sessions.set(projectId, {
      stream,
      events: [],
      startTime: Date.now(),
      jsonlPath,
    });
    this._cache.set(projectId, []);
    log.info('ExecutionRecorder', 'Started recording for project ' + projectId);
  }

  /**
   * 记录事件
   * @param {string} projectId
   * @param {string} type - 事件类型
   * @param {string} stageName - 阶段名
   * @param {object} data - 事件载荷
   */
  recordEvent(projectId, type, stageName, data) {
    // let：目录被并发删除后重启录制时需要更新引用（见下方两处重启分支）
    let session = this._sessions.get(projectId);
    if (!session) {
      log.warn('ExecutionRecorder', 'No recording session for project ' + projectId);
      return;
    }

    // 检查目录是否仍然存在（防止并发删除导致 ENOENT）
    try {
      if (!fs.existsSync(path.dirname(session.jsonlPath))) {
        log.warn('ExecutionRecorder', 'Replay directory deleted, restarting recording for project ' + projectId);
        this.stopRecording(projectId); // 旧 session 仍在 Map 中，startRecording 会短路，必须先停再启
        this.startRecording(projectId);
        const newSession = this._sessions.get(projectId);
        if (!newSession) return;
        session = newSession; // 重启后指向重建后的新 stream，避免事件写入孤儿流
      }
    } catch (e) {
      log.error('ExecutionRecorder', 'Failed to check replay dir: ' + e.message);
      return;
    }

    // 构建快照
    const snapshot = this._buildSnapshot(projectId);

    const event = {
      id: 'evt_' + (++this._eventIdCounter),
      projectId,
      timestamp: new Date().toISOString(),
      type,
      stageName: stageName || '',
      data: data || {},
      snapshot,
    };

    // 写入 JSONL
    try {
      // 双重检查：写入前再次确认目录存在
      if (!fs.existsSync(path.dirname(session.jsonlPath))) {
        log.warn('ExecutionRecorder', 'Replay directory deleted during write, restarting for project ' + projectId);
        this.stopRecording(projectId); // 旧 session 仍在 Map 中，startRecording 会短路，必须先停再启
        this.startRecording(projectId);
        const newSession = this._sessions.get(projectId);
        if (!newSession) return;
        session = newSession; // 更新 session 引用
      }
      
      session.stream.write(JSON.stringify(event) + '\n');
    } catch (e) {
      log.error('ExecutionRecorder', 'Failed to write event: ' + e.message);
    }

    // 缓存最近 100 个事件
    const cache = this._cache.get(projectId) || [];
    cache.push(event);
    if (cache.length > 100) {
      cache.shift();
    }
    this._cache.set(projectId, cache);
  }

  /**
   * 停止录制
   * @param {string} projectId
   */
  stopRecording(projectId) {
    const session = this._sessions.get(projectId);
    if (!session) return;

    try {
      session.stream.end();
    } catch (_) { /* ignore */ }

    this._sessions.delete(projectId);
    log.info('ExecutionRecorder', 'Stopped recording for project ' + projectId);
  }

  /**
   * 获取回放数据
   * @param {string} projectId
   * @returns {{ project: object|null, events: Array, totalDuration: number }}
   */
  getReplay(projectId) {
    // 获取项目信息
    let project = null;
    try {
      project = this.projectService.getProject(projectId);
    } catch (_) {
      // 项目不存在
    }

    // 读取 JSONL 文件
    const jsonlPath = path.join(this._getReplayDir(projectId), 'execution.jsonl');
    const events = [];

    try {
      if (!fs.existsSync(jsonlPath)) {
        return { project, events: [], totalDuration: 0 };
      }

      const content = fs.readFileSync(jsonlPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch (_) {
          // 跳过无效行
        }
      }
    } catch (e) {
      log.error('ExecutionRecorder', 'Failed to read replay: ' + e.message);
      return { project, events: [], totalDuration: 0 };
    }

    // 计算总耗时（秒）
    let totalDuration = 0;
    if (events.length >= 2) {
      const start = new Date(events[0].timestamp).getTime();
      const end = new Date(events[events.length - 1].timestamp).getTime();
      totalDuration = Math.round((end - start) / 1000);
    }

    return { project, events, totalDuration };
  }

  /**
   * 获取项目的回放目录
   * @private
   */
  _getReplayDir(projectId) {
    const projectsDir = this.projectService.getProjectsDir();
    return path.join(projectsDir, projectId, 'replay');
  }

  /**
   * 构建看板快照
   * @private
   */
  _buildSnapshot(projectId) {
    if (!this.boardService) return null;
    try {
      return this.boardService.buildBoardState(projectId);
    } catch (_) {
      return null;
    }
  }

  /**
   * 获取缓存的事件（用于测试）
   * @param {string} projectId
   * @returns {Array}
   */
  getCachedEvents(projectId) {
    return this._cache.get(projectId) || [];
  }

  /**
   * 清理所有录制会话（用于 shutdown）
   */
  cleanup() {
    for (const [projectId] of this._sessions) {
      this.stopRecording(projectId);
    }
    this.stopListening();
  }
}

module.exports = { ExecutionRecorder, RECORDED_EVENTS };
