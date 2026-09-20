/**
});
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
 * 重启录制后又被重新赋值（`session = newSession`），触发 no-const-assign——
 * 开发期 ESLint 直接报错，运行时抛 TypeError「Assignment to constant variable」
 * 被 catch 吞掉后表现为「事件静默丢失」；且第一处重启分支完全不更新引用，
 * 后续写入落向已删除目录的孤儿 stream，新 execution.jsonl 永远没有内容。
 */
'use strict';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { ExecutionRecorder } = require('./execution-recorder');

function createRecorder(projectsDir) {
  const projectService = { getProjectsDir: () => projectsDir };
  const pipelineEngine = { on: () => () => {} };
  return new ExecutionRecorder({ projectService, pipelineEngine });
}

describe('ExecutionRecorder.recordEvent — replay 目录被删除后的自愈', () => {
  let tmpDir;
  let recorder;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-exec-rec-'));
    recorder = createRecorder(tmpDir);
  });

  afterEach(() => {
    try { recorder.cleanup(); } catch (_) { /* ignore */ }
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function jsonlPathOf(projectId) {
    return path.join(tmpDir, projectId, 'replay', 'execution.jsonl');
  }

  function readJsonlLines(projectId) {
    const p = jsonlPathOf(projectId);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  }

  // stream.write 落盘是异步的，轮询等待（最多 timeoutMs）
  async function waitForLines(projectId, expected, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (readJsonlLines(projectId).length < expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50)); // 让出事件循环，等待 stream 异步刷盘
    }
    return readJsonlLines(projectId).length >= expected;
  }

  // 等待 stream 真正打开（fd 就绪），防止 Windows 下 rmSync 删掉 delete-pending 文件
  function waitForFlush(rec, projectId) {
    const s = rec._sessions.get(projectId);
    if (!s) return Promise.resolve();
    if (s.stream.fd) return Promise.resolve();
    return new Promise((resolve) => s.stream.once('open', resolve));
  }

  it('目录检查分支重启后，新 session 必须继续承接事件（不写孤儿 stream）', async () => {
    recorder.startRecording('proj-a');
    recorder.recordEvent('proj-a', 'stage:start', 'draft', { foo: 1 });
    await waitForFlush(recorder, 'proj-a'); // 等 fd 真正打开，避免 rmSync 与异步 open 竞态
    expect(await waitForLines('proj-a', 1)).toBe(true);

    // 删除整个 replay 目录，模拟并发清理
    fs.rmSync(path.join(tmpDir, 'proj-a', 'replay'), { recursive: true, force: true });

    recorder.recordEvent('proj-a', 'stage:complete', 'draft', { foo: 2 });

    // 事故行为：新目录被重建但事件写向孤儿 stream，新文件为空
    expect(fs.existsSync(path.join(tmpDir, 'proj-a', 'replay'))).toBe(true);
    expect(await waitForLines('proj-a', 1)).toBe(true); // 重启后写全新文件，旧事件随目录删除
    const lines = readJsonlLines('proj-a');
    expect(JSON.parse(lines[lines.length - 1]).type).toBe('stage:complete');
  });

  it('写入前双检分支重启后，不得抛 Assignment to constant variable，事件必须落盘', async () => {
    const logger = require('./logger');
    const errSpy = vi.spyOn(logger, 'error');
    recorder.startRecording('proj-b');
    recorder.recordEvent('proj-b', 'stage:start', 'draft', { warm: 1 });
    await waitForFlush(recorder, 'proj-b');
    expect(await waitForLines('proj-b', 1)).toBe(true);
    errSpy.mockClear();

    fs.rmSync(path.join(tmpDir, 'proj-b', 'replay'), { recursive: true, force: true });
    recorder.recordEvent('proj-b', 'scene:complete', 'storyboard', { ok: true });

    const logged = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).not.toMatch(/Assignment to constant variable/i);
    expect(logged).not.toMatch(/Failed to write event/i);
    expect(await waitForLines('proj-b', 1)).toBe(true); // 重启后写全新文件，旧事件随目录删除
    const lines = readJsonlLines('proj-b');
    expect(JSON.parse(lines[lines.length - 1]).type).toBe('scene:complete');
  });
});
