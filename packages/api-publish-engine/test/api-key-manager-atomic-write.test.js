const assert = require('node:assert/strict')
const { holdExclusiveWindowsFileLock } = require('../../../test-helpers/windows-file-lock.js')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const ApiKeyManager = require('../src/api-key-manager')

test('Windows 短暂文件锁释放后 API Key 原子保存成功', {
  skip: process.platform !== 'win32',
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-api-key-atomic-'))
  const keysPath = path.join(directory, 'api-keys.json')
  let fileLock

  try {
    const manager = new ApiKeyManager(keysPath)
    manager.load()
    manager.createKey('initial-key', ['publish:read'])

    fileLock = await holdExclusiveWindowsFileLock(keysPath, 180)
    const created = manager.createKey('after-lock', ['publish:submit'])
    await fileLock.release()

    assert.equal(created.name, 'after-lock')
    const persisted = JSON.parse(fs.readFileSync(keysPath, 'utf8'))
    assert.deepEqual(persisted.map(entry => entry.name), ['initial-key', 'after-lock'])
    assert.equal(persisted.every(entry => /^[a-f0-9]{64}$/.test(entry.keyHash)), true)
    assert.equal(fs.existsSync(`${keysPath}.tmp`), false)
  } finally {
    if (fileLock) await fileLock.release().catch(() => {})
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
