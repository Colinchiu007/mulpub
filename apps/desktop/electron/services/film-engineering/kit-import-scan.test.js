// @ts-check
'use strict'
/**
 * kit-import-scan 契约测试（PR-3b 资产导入 · 第一遍扫描）
 *
 * 覆盖方案 `pr3b-import-design.md` 的判据：
 *   ⑤ 白名单外文件不被拷入（且不递归进入其子目录）· ⑨ 路径越界 ⇒ 拒
 *   ⑩ 硬链接 ⇒ 拒（同目录 (dev,ino) 相同）· ⑪ 隐藏名 ⇒ 拒
 *   ⑮ JSON 魔数不匹配 ⇒ 拒 · ⑥ 超限 ⇒ 拒且未开始拷
 *   ㉑ 第一遍记录（dev/ino/size/mtime/sha256）落进 firstPassStats
 *
 * 全部用例落在真临时目录（`os.tmpdir()`），**绝不触碰仓库文件**。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  scanKit,
  WHITELIST_PATTERNS,
  BASE_PROMPT_PATH,
  MAX_KIT_FILE_BYTES,
  MAX_KIT_TOTAL_BYTES,
  REASON,
  normalizePattern,
  isHiddenComponent,
} = require('./kit-import-scan')

function tmpDir (tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-scan-' + tag + '-'))
}

/** 造一个「合法 kit 源目录」：根级 7 必填 + 任务库 3 层 */
function makeKit (opts) {
  const o = opts || {}
  const dir = o.dir || tmpDir('ok')
  const rootFiles = o.rootFiles || [
    'film-manifest.json', 'shot-library.json', 'reference-registry.json', 'prompt-doctrine.json',
    'shot-grammar.json', 'compliance-checklist.json', 'palette.json',
  ]
  for (const name of rootFiles) {
    fs.writeFileSync(path.join(dir, name), o.content || '{"a":1}', 'utf8')
  }
  if (o.withTasks !== false) {
    const taskDir = path.join(dir, BASE_PROMPT_PATH, 't1', 'zh')
    fs.mkdirSync(taskDir, { recursive: true })
    fs.writeFileSync(path.join(taskDir, 'system.md'), '# zh', 'utf8')
  }
  return dir
}

describe('kit-import-scan: 白名单与形状', () => {
  it('合法源目录扫描通过，产出 firstPassStats（dev/ino/size/mtime/sha256）', async () => {
    const dir = makeKit({})
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(true)
    const rels = res.files.map((f) => f.relPath).sort()
    expect(rels).toContain('film-manifest.json')
    expect(rels).toContain(BASE_PROMPT_PATH + '/t1/zh/system.md')
    const stat = res.firstPassStats['film-manifest.json']
    expect(typeof stat.sha256).toBe('string')
    expect(stat.sha256.length).toBe(64)
    expect(typeof stat.dev).toBe('number')
    expect(typeof stat.ino).toBe('number')
    expect(stat.size).toBeGreaterThan(0)
    expect(typeof stat.mtimeMs).toBe('number')
  })

  it('白名单外的文件与目录被跳过（不进清单、不算失败）', async () => {
    const dir = makeKit({})
    fs.writeFileSync(path.join(dir, 'README.md'), '# hi', 'utf8')
    fs.mkdirSync(path.join(dir, 'extra', 'deep'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'extra', 'deep', 'x.json'), '{}', 'utf8')
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(true)
    const rels = res.files.map((f) => f.relPath)
    expect(rels.indexOf('README.md')).toBe(-1)
    expect(rels.indexOf('extra/deep/x.json')).toBe(-1)
  })

  it('images/ 不在白名单内（无消费方 ⇒ 不导入）', () => {
    expect(WHITELIST_PATTERNS.indexOf('images/**')).toBe(-1)
    expect(WHITELIST_PATTERNS.indexOf('images/*')).toBe(-1)
  })

  it('必填文件缺失 ⇒ VALIDATION_ERROR', async () => {
    const dir = makeKit({ rootFiles: ['film-manifest.json', 'shot-library.json'] })
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.VALIDATION_ERROR)
  })

  it('必填目录 prompts/tasks 缺失 ⇒ VALIDATION_ERROR', async () => {
    const dir = makeKit({ withTasks: false })
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.VALIDATION_ERROR)
  })

  it('源路径不是目录 ⇒ NOT_A_DIRECTORY', async () => {
    const dir = tmpDir('notdir')
    const file = path.join(dir, 'a.txt')
    fs.writeFileSync(file, 'x', 'utf8')
    const res = await scanKit({ kitDir: file })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.NOT_A_DIRECTORY)
  })

  it('隐藏名（含目录名）⇒ HIDDEN_NAME_REJECTED（只作用于白名单内条目）', async () => {
    // 白名单**外**的隐藏目录（如 .git/）按 S1 跳过，不算失败
    const dir = makeKit({})
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.git', 'config'), 'x', 'utf8')
    let res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(true)

    // 白名单**内**路径的隐藏组件 ⇒ 拒
    const dir2 = makeKit({})
    fs.writeFileSync(path.join(dir2, BASE_PROMPT_PATH, 't1', 'zh', '.hidden.md'), 'x', 'utf8')
    res = await scanKit({ kitDir: dir2 })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.HIDDEN_NAME_REJECTED)
  })

  it('扩展名不允许 ⇒ EXT_NOT_ALLOWED', async () => {
    const dir = makeKit({})
    fs.writeFileSync(path.join(dir, 'shot-library.json.exe'), 'x', 'utf8')
    // 扩展名不在允许集 ⇒ 但它也不在白名单里 ⇒ 应当被跳过而不是拒绝
    let res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(true)

    const dir2 = makeKit({})
    const taskDir = path.join(dir2, BASE_PROMPT_PATH, 't1', 'zh')
    fs.writeFileSync(path.join(taskDir, 'system.json'), '{}', 'utf8')
    res = await scanKit({ kitDir: dir2 })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.EXT_NOT_ALLOWED)
  })
})

describe('kit-import-scan: 链与越界', () => {
  it('软链 ⇒ SYMLINK_REJECTED', async () => {
    const dir = makeKit({})
    const outside = path.join(tmpDir('out'), 'secret.json')
    fs.writeFileSync(outside, '{}', 'utf8')
    fs.rmSync(path.join(dir, 'palette.json'))
    fs.symlinkSync(outside, path.join(dir, 'palette.json'))
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SYMLINK_REJECTED)
  })

  it('断链 ⇒ SYMLINK_REJECTED', async () => {
    const dir = makeKit({})
    const missing = path.join(tmpDir('miss'), 'nope.json')
    fs.rmSync(path.join(dir, 'palette.json'))
    fs.symlinkSync(missing, path.join(dir, 'palette.json'))
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SYMLINK_REJECTED)
  })

  it('同目录硬链 ⇒ HARDLINK_REJECTED（与 nlink 无关）', async () => {
    const dir = makeKit({})
    const target = path.join(dir, 'palette.json')
    const link = path.join(dir, 'compliance-checklist.json')
    fs.rmSync(link)
    fs.linkSync(target, link)
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.HARDLINK_REJECTED)
  })
})

describe('kit-import-scan: 魔数与体积', () => {
  it('JSON 魔数不匹配 ⇒ MAGIC_MISMATCH（不写盘）', async () => {
    const dir = makeKit({})
    fs.writeFileSync(path.join(dir, 'palette.json'), 'not-json', 'utf8')
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.MAGIC_MISMATCH)
  })

  it('JSON 头带 BOM 仍算合法', async () => {
    const dir = makeKit({})
    fs.writeFileSync(path.join(dir, 'palette.json'), '\uFEFF{"a":1}', 'utf8')
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(true)
  })

  it('单文件超限 ⇒ SIZE_EXCEEDED', async () => {
    const dir = makeKit({})
    const big = path.join(dir, 'shot-library.json')
    const fh = fs.openSync(big, 'w')
    fs.ftruncateSync(fh, MAX_KIT_FILE_BYTES + 1)
    fs.closeSync(fh)
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SIZE_EXCEEDED)
  })

  it('上限常量与方案一致（32MB / 256MB）', () => {
    expect(MAX_KIT_FILE_BYTES).toBe(32 * 1024 * 1024)
    expect(MAX_KIT_TOTAL_BYTES).toBe(256 * 1024 * 1024)
  })
})

describe('kit-import-scan: 归一化与辅助判定', () => {
  it('normalizePattern 去尾斜杠并做 posix 归一', () => {
    expect(normalizePattern('a/b/')).toBe('a/b')
    expect(normalizePattern('a\\b')).toBe('a/b')
    expect(normalizePattern('./a/./b')).toBe('a/b')
  })

  it('isHiddenComponent 覆盖目录名与文件名', () => {
    expect(isHiddenComponent('.git/config')).toBe(true)
    expect(isHiddenComponent('a/.b/c')).toBe(true)
    expect(isHiddenComponent('a/b/c')).toBe(false)
  })
})

// ⚠ 以下三条是 2026-10-23 **验证层外部评审**（claude i5 / codex i8）命中后补的回归锁。
describe('kit-import-scan: 硬链范围与任务库形状（外部评审修）', () => {
  // ⚠ claude i5：初版去重键只用 `dev:ino`（**全局**）⇒ 把**跨目录**硬链也一起拒了，
  //   而契约明写「跨目录硬链 = 非防篡改边界」⇒ 那是**超出声明的误拒**
  //   （同一个文件被放进两个任务目录的合法包会被整包拒掉）。
  it('跨目录硬链**不拒**（去重键按父目录分桶）', async () => {
    const dir = makeKit({})
    const t2 = path.join(dir, BASE_PROMPT_PATH, 't2', 'zh')
    fs.mkdirSync(t2, { recursive: true })
    const src = path.join(dir, BASE_PROMPT_PATH, 't1', 'zh', 'system.md')
    let linked = false
    try {
      fs.linkSync(src, path.join(t2, 'system.md'))
      linked = true
    } catch (_e) { /* 所在卷不支持硬链 ⇒ 跳过该断言 */ }
    if (!linked) return
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(true)
    const rels = res.files.map((f) => f.relPath)
    expect(rels).toContain(BASE_PROMPT_PATH + '/t1/zh/system.md')
    expect(rels).toContain(BASE_PROMPT_PATH + '/t2/zh/system.md')
  })

  it('**同目录**硬链仍拒（去重键带父目录 ⇒ 同一目录内重复照样命中）', async () => {
    const dir = makeKit({})
    const langDir = path.join(dir, BASE_PROMPT_PATH, 't1', 'zh')
    const src = path.join(langDir, 'system.md')
    let linked = false
    try {
      fs.linkSync(src, path.join(langDir, 'copy.md'))
      linked = true
    } catch (_e) { /* 不支持硬链 ⇒ 跳过 */ }
    if (!linked) return
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.HARDLINK_REJECTED)
  })

  // ⚠ codex i8：初版把层级不符 / 非普通文件的条目**静默跳过**
  //   ⇒ 一个缺任务、深度错乱的包能「导入成功」（任务库实际是空的）。
  it('任务库层级不符（少一层）⇒ 拒，不静默跳过', async () => {
    const dir = makeKit({})
    fs.writeFileSync(path.join(dir, BASE_PROMPT_PATH, 'stray.md'), '# stray', 'utf8')
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.VALIDATION_ERROR)
  })

  it('任务库内出现软链/联接点 ⇒ 拒（SYMLINK_REJECTED），不静默跳过', async () => {
    const dir = makeKit({})
    const langDir = path.join(dir, BASE_PROMPT_PATH, 't1', 'zh')
    let linked = false
    try {
      fs.symlinkSync(path.join(dir, 'palette.json'), path.join(langDir, 'link.md'), 'file')
      linked = true
    } catch (_e) { /* 无权限 ⇒ 跳过 */ }
    if (!linked) return
    const res = await scanKit({ kitDir: dir })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SYMLINK_REJECTED)
  })

  // ⚠ codex i4：部分网络盘 / FUSE **恒返回 ino = 0** ⇒ 此时 (dev,ino) 不可信
  //   ⇒ 若照样拿它去重，同目录下所有文件会撞到同一个键 ⇒ **合法包被整包误拒**。
  it('ino = 0（不可信）⇒ 跳过硬链判据，不误拒合法包', async () => {
    const dir = makeKit({})
    const zeroInoFs = Object.assign({}, fs, {
      promises: Object.assign({}, fs.promises, {
        lstat: async (p) => {
          const st = await fs.promises.lstat(p)
          return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ino: 0 })
        },
      }),
    })
    const res = await scanKit({ kitDir: dir, fs: zeroInoFs })
    expect(res.ok).toBe(true)
    expect(res.files.length).toBeGreaterThan(0)
  })
})
