// @ts-check
'use strict'
/**
 * kit-import-swap 契约测试（PR-3b 资产导入 · 第二遍拷贝 / 换入 / 回滚 / 精确清单清理）
 *
 * 覆盖：
 *   ㉑ 两条对账（副本哈希 == 源哈希；拷贝后源文件未被改动）
 *   ⑧ 换入失败后旧 kit 逐字未变
 *   ⑫ 回滚本身失败 ⇒ `.bak` 仍在 + 报错带出恢复路径
 *   ⛔ 清理不递归删目录（精确清单 + 自底向上 rmdir）
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  copyToStaging,
  cleanupStaging,
  swapIn,
  makeStamp,
  stagingName,
  bakName,
  KIT_DIR_NAME,
  REASON,
} = require('./kit-import-swap')

function tmpDir (tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-swap-' + (tag || 'x') + '-'))
}

function makeSource (dir) {
  // 造一个**合法**的源 kit（7 个根级必填 + 任务库 3 层）⇒ 第一遍扫描能过
  for (const name of [
    'film-manifest.json', 'shot-library.json', 'reference-registry.json', 'prompt-doctrine.json',
    'shot-grammar.json', 'compliance-checklist.json', 'palette.json',
  ]) {
    fs.writeFileSync(path.join(dir, name), '{"a":1}', 'utf8')
  }
  fs.mkdirSync(path.join(dir, 'prompts', 'tasks', 't1', 'zh'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'prompts', 'tasks', 't1', 'zh', 's.md'), '# s', 'utf8')
  return dir
}

describe('kit-import-swap: 第二遍拷贝的两条对账', () => {
  it('正常拷贝 ⇒ 副本与源一致（对账通过）', async () => {
    const src = makeSource(tmpDir('src'))
    const staging = path.join(tmpDir('stg'), 'film-kit.staging-x')
    const { scanKit } = require('./kit-import-scan')
    const scan = await scanKit({ kitDir: src })
    expect(scan.ok).toBe(true)
    const res = await copyToStaging({
      files: scan.files,
      firstPassStats: scan.firstPassStats,
      stagingDir: staging,
    })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(staging, 'film-manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(staging, 'prompts', 'tasks', 't1', 'zh', 's.md'))).toBe(true)
  })

  it('副本哈希与源不一致 ⇒ 拒（不写盘完成）', async () => {
    const src = makeSource(tmpDir('src'))
    const staging = path.join(tmpDir('stg'), 'film-kit.staging-x')
    const { scanKit } = require('./kit-import-scan')
    const scan = await scanKit({ kitDir: src })
    const tampered = {}
    for (const k of Object.keys(scan.firstPassStats)) {
      tampered[k] = Object.assign({}, scan.firstPassStats[k], { sha256: 'deadbeef' })
    }
    const res = await copyToStaging({ files: scan.files, firstPassStats: tampered, stagingDir: staging })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.VALIDATION_ERROR)
  })

  it('源文件在拷贝期间被改动（mtime 变了）⇒ 拒', async () => {
    const src = makeSource(tmpDir('src'))
    const staging = path.join(tmpDir('stg'), 'film-kit.staging-x')
    const { scanKit } = require('./kit-import-scan')
    const scan = await scanKit({ kitDir: src })
    const tampered = {}
    for (const k of Object.keys(scan.firstPassStats)) {
      tampered[k] = Object.assign({}, scan.firstPassStats[k], { mtimeMs: scan.firstPassStats[k].mtimeMs - 1 })
    }
    const res = await copyToStaging({ files: scan.files, firstPassStats: tampered, stagingDir: staging })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.VALIDATION_ERROR)
  })
})

describe('kit-import-swap: 目录级换入与回滚', () => {
  it('换入成功：旧 kit → .bak → staging → film-kit，.bak 随后删除', async () => {
    const ud = tmpDir('ud')
    const oldKit = path.join(ud, KIT_DIR_NAME)
    fs.mkdirSync(oldKit, { recursive: true })
    fs.writeFileSync(path.join(oldKit, 'old.txt'), 'old', 'utf8')
    const staging = path.join(ud, stagingName('s1'))
    fs.mkdirSync(staging, { recursive: true })
    fs.writeFileSync(path.join(staging, 'new.txt'), 'new', 'utf8')

    const res = await swapIn({ userDataDir: ud, stagingDir: staging, stamp: 's1' })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(oldKit, 'old.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(oldKit, 'new.txt'), 'utf8')).toBe('new')
    expect(fs.existsSync(path.join(ud, bakName('s1')))).toBe(false)
  })

  it('旧 kit 不存在时直接换入', async () => {
    const ud = tmpDir('ud')
    const staging = path.join(ud, stagingName('s2'))
    fs.mkdirSync(staging, { recursive: true })
    fs.writeFileSync(path.join(staging, 'new.txt'), 'new', 'utf8')
    const res = await swapIn({ userDataDir: ud, stagingDir: staging, stamp: 's2' })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(ud, KIT_DIR_NAME, 'new.txt'))).toBe(true)
  })

  it('换入失败 ⇒ 旧 kit 逐字未变（回滚成功）', async () => {
    const ud = tmpDir('ud')
    const oldKit = path.join(ud, KIT_DIR_NAME)
    fs.mkdirSync(oldKit, { recursive: true })
    fs.writeFileSync(path.join(oldKit, 'old.txt'), 'old', 'utf8')
    const res = await swapIn({
      userDataDir: ud,
      stagingDir: path.join(ud, 'staging-missing'),
      stamp: 's3',
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SWAP_FAILED)
    expect(fs.readFileSync(path.join(oldKit, 'old.txt'), 'utf8')).toBe('old')
    expect(fs.existsSync(path.join(ud, bakName('s3')))).toBe(false)
  })

  // ⚠ 2026-10-23 验证层外部评审（claude i3 / codex i6）命中：初版把
  //   `swap.bakPath` 丢掉 ⇒ 「.bak 没删掉」这件事**永远到不了用户眼前**。
  it('删 `.bak` 失败 ⇒ 仍算生效，但必须回传 BAK_LEFT 残留档位与恢复路径', async () => {
    const ud = tmpDir('ud')
    const oldKit = path.join(ud, KIT_DIR_NAME)
    fs.mkdirSync(oldKit, { recursive: true })
    fs.writeFileSync(path.join(oldKit, 'old.txt'), 'old', 'utf8')
    const staging = path.join(ud, stagingName('s4'))
    fs.mkdirSync(staging, { recursive: true })
    fs.writeFileSync(path.join(staging, 'new.txt'), 'new', 'utf8')

    // 让 unlink 失败（模拟被占用 / 权限不足）
    // ⚠ 不能用 `Object.create(fs)` 后赋值 `promises`：`fs.promises` 是只读 getter。
    const brokenFs = Object.assign({}, fs, {
      promises: Object.assign({}, fs.promises, {
        unlink: async () => {
          const e = new Error('EPERM: operation not permitted')
          e.code = 'EPERM'
          throw e
        },
      }),
    })

    const res = await swapIn({ userDataDir: ud, stagingDir: staging, stamp: 's4', fs: brokenFs })
    expect(res.ok).toBe(true)
    expect(res.recoveryState).toBe('BAK_LEFT')
    expect(res.bakPath).toContain(bakName('s4'))
    // 新资产确实已生效
    expect(fs.existsSync(path.join(oldKit, 'new.txt'))).toBe(true)
  })

  it('删 `.bak` 成功 ⇒ 不留 BAK_LEFT 档位（旧资产目录整体消失）', async () => {
    const ud = tmpDir('ud')
    const oldKit = path.join(ud, KIT_DIR_NAME)
    fs.mkdirSync(path.join(oldKit, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(oldKit, 'sub', 'old.txt'), 'old', 'utf8')
    const staging = path.join(ud, stagingName('s5'))
    fs.mkdirSync(staging, { recursive: true })
    fs.writeFileSync(path.join(staging, 'new.txt'), 'new', 'utf8')
    const res = await swapIn({ userDataDir: ud, stagingDir: staging, stamp: 's5' })
    expect(res.ok).toBe(true)
    expect(res.recoveryState).toBeUndefined()
    expect(fs.existsSync(path.join(ud, bakName('s5')))).toBe(false)
  })
})

describe('kit-import-swap: 精确清单清理（⛔ 不递归删目录）', () => {
  it('按清单删文件 + 自底向上删空目录（含嵌套）', async () => {
    const staging = path.join(tmpDir('stg'), 'film-kit.staging-x')
    fs.mkdirSync(path.join(staging, 'prompts', 'tasks', 't1', 'zh'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'a.json'), '{}', 'utf8')
    fs.writeFileSync(path.join(staging, 'prompts', 'tasks', 't1', 'zh', 's.md'), 'x', 'utf8')
    const res = await cleanupStaging({
      stagingDir: staging,
      fileList: ['a.json', 'prompts/tasks/t1/zh/s.md'],
    })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(staging)).toBe(false)
  })

  it('清单里有「尚未写入」的路径 ⇒ 不抛、仍清干净', async () => {
    const staging = path.join(tmpDir('stg'), 'film-kit.staging-y')
    fs.mkdirSync(staging, { recursive: true })
    fs.writeFileSync(path.join(staging, 'a.json'), '{}', 'utf8')
    const res = await cleanupStaging({
      stagingDir: staging,
      fileList: ['a.json', 'never-written/b.json'],
    })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(staging)).toBe(false)
  })
})

describe('kit-import-swap: 命名唯一性', () => {
  it('makeStamp 每次不同 ⇒ `.bak` 不会撞名', () => {
    const a = makeStamp(1760000000000, 'aaaa')
    const b = makeStamp(1760000000000, 'bbbb')
    expect(a).not.toBe(b)
    expect(bakName(a)).not.toBe(bakName(b))
  })
})
