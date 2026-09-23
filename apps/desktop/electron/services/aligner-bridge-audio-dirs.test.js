// @ts-check
/**
 * AlignerBridge → audio-aligner 的目录白名单注入契约（体检报告 P2 安全小项）
 *
 * Python 侧默认只信系统临时目录（fail-closed）。桌面端必须在 spawn 时把自己的真实落盘目录
 * 告诉子进程，否则「字幕对齐」会在生产上全线 403 —— 这条链路没有别的配置入口，
 * 只能靠契约测试锁住。
 */
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const AlignerBridge = require('./aligner-bridge')
const { resolveAllowedAudioDirs } = AlignerBridge

const split = (v) => String(v).split(path.delimiter).filter(Boolean)

describe('resolveAllowedAudioDirs', () => {
  it('默认包含系统临时目录（TTS 产物根）', () => {
    expect(split(resolveAllowedAudioDirs({}))).toContain(os.tmpdir())
  })

  it('外部已配置的目录作为追加项保留，不被静默丢弃', () => {
    const roots = split(resolveAllowedAudioDirs({ AUDIO_ALIGNER_ALLOWED_DIRS: ['D:/media/audio'].join(path.delimiter) }))
    expect(roots).toContain(os.tmpdir())
    expect(roots).toContain('D:/media/audio')
  })

  it('空配置项不产生空元素（空元素会被 Python 侧当成整串分隔符解析）', () => {
    const roots = split(resolveAllowedAudioDirs({ AUDIO_ALIGNER_ALLOWED_DIRS: path.delimiter + path.delimiter }))
    expect(roots.every((r) => r.trim().length > 0)).toBe(true)
  })

  it('纯 Node 环境下 electron 不可用也不抛错（require("electron") 返回路径字符串）', () => {
    expect(() => resolveAllowedAudioDirs({})).not.toThrow()
  })
})

describe('AlignerBridge._spawnEnv', () => {
  it('spawn 环境里带上 AUDIO_ALIGNER_ALLOWED_DIRS', () => {
    const bridge = new AlignerBridge({})
    const env = bridge._spawnEnv()
    expect(typeof env.AUDIO_ALIGNER_ALLOWED_DIRS).toBe('string')
    expect(split(env.AUDIO_ALIGNER_ALLOWED_DIRS)).toContain(os.tmpdir())
  })

  it('基类默认不追加任何变量（其它 bridge 行为不变）', () => {
    const { BasePythonBridge } = require('./base-python-bridge')
    const base = new BasePythonBridge({ name: 'X', pythonModule: 'x', port: 1, host: '127.0.0.1', workDir: process.cwd(), log: { info () {}, warn () {}, error () {} } })
    expect(base._spawnEnv()).toEqual({})
  })
})
