// @ts-check
'use strict'
/**
 * kit-import 编排层契约测试（PR-3b 资产导入 · ⓪-⑦ 换入顺序）
 *
 * 覆盖：
 *   ① 严格模式校验失败 ⇒ 不落盘            ② 成功 ⇒ userData/film-kit 齐备 + 缓存已失效
 *   ④ 换入中途失败 ⇒ 无半份 kit、旧 kit 逐字未变
 *   ⑦ 源/目标重叠 ⇒ 拒                    ⑯ 父目录不可写/锁建不出来 ⇒ 立即退出、旧 kit 未动
 *   ⑬ 导入标记先置后删、锁同生命周期       ⑰ 存在有效锁 ⇒ 拒绝（不自动清）
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { importKit, REASON } = require('./kit-import')
const { lockPathOf, createLock } = require('./kit-import-lock')
const { auditFilePathOf } = require('./kit-import-audit')

function tmpDir (tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-imp-' + (tag || 'x') + '-'))
}

const REQUIRED = [
  'film-manifest.json', 'shot-library.json', 'reference-registry.json', 'prompt-doctrine.json',
  'shot-grammar.json', 'compliance-checklist.json', 'palette.json',
]

function makeSource (dir) {
  for (const name of REQUIRED) fs.writeFileSync(path.join(dir, name), '{"a":1}', 'utf8')
  fs.mkdirSync(path.join(dir, 'prompts', 'tasks', 't1', 'zh'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'prompts', 'tasks', 't1', 'zh', 's.md'), '# s', 'utf8')
  return dir
}

/** 假严格校验：有 film-manifest.json 就算通过 */
function fakeStrict (opts) {
  const dir = opts.kitDir
  if (fs.existsSync(path.join(dir, 'film-manifest.json'))) return { ok: true, kit: {} }
  return { ok: false, error: '缺少 film-manifest.json' }
}

function makeService () {
  const calls = { invalidate: 0, marker: [] }
  return {
    calls,
    invalidateKitCache () { calls.invalidate += 1 },
    setImportInProgress (on) { calls.marker.push(!!on) },
  }
}

/**
 * fs 替身（覆盖 `promises` 里的某几个方法）。
 * ⚠ 不能用 `Object.create(fs)` + 赋值 `promises`：`fs.promises` 是**只读 getter**
 *   ⇒ 赋值直接抛 `TypeError`（第一版就是这么写错的）。
 */
function stubFs (overrides) {
  const o = overrides || {}
  const out = Object.assign({}, fs, o)
  out.promises = Object.assign({}, fs.promises, o.promises || {})
  return out
}

describe('kit-import: 成功路径', () => {
  it('导入成功：目标 kit 齐备、staging 不存在、锁已删、缓存已失效、审计两行', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    const service = makeService()
    const res = await importKit({ kitDir: src, userDataDir: ud, service, loadFilmKit: fakeStrict })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(ud, 'film-kit', 'film-manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(ud, 'film-kit', 'prompts', 'tasks', 't1', 'zh', 's.md'))).toBe(true)
    expect(fs.existsSync(lockPathOf(ud))).toBe(false)
    expect(fs.readdirSync(ud).filter((n) => n.indexOf('staging') >= 0).length).toBe(0)
    expect(service.calls.invalidate).toBe(1)
    expect(service.calls.marker[0]).toBe(true)
    expect(service.calls.marker[service.calls.marker.length - 1]).toBe(false)
    const lines = fs.readFileSync(auditFilePathOf(ud), 'utf8').split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
    expect(lines[0].indexOf('start') >= 0).toBe(true)
    expect(lines[1].indexOf('PASS') >= 0).toBe(true)
  })

  it('成功后旧 kit 目录被替换（内容变成新资产）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.writeFileSync(path.join(ud, 'film-kit', 'old.txt'), 'old', 'utf8')
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(path.join(ud, 'film-kit', 'old.txt'))).toBe(false)
    expect(fs.existsSync(path.join(ud, 'film-kit', 'film-manifest.json'))).toBe(true)
  })
})

describe('kit-import: 失败即不落盘', () => {
  it('严格校验失败 ⇒ 不落盘（目标 kit 不存在）+ 审计有失败行', async () => {
    const src = tmpDir('src')
    fs.writeFileSync(path.join(src, 'film-manifest.json'), '{"a":1}', 'utf8') // 缺其余必填
    const ud = tmpDir('ud')
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.VALIDATION_ERROR)
    expect(fs.existsSync(path.join(ud, 'film-kit'))).toBe(false)
    const lines = fs.readFileSync(auditFilePathOf(ud), 'utf8').split('\n').filter(Boolean)
    expect(lines.some((l) => l.indexOf('VALIDATION_ERROR') >= 0)).toBe(true)
  })

  it('第一遍扫描不通过 ⇒ 旧 kit 逐字未变、无半份 kit', async () => {
    const src = makeSource(tmpDir('src'))
    // 放一个软链进白名单位置 ⇒ 扫描拒
    fs.rmSync(path.join(src, 'palette.json'))
    fs.symlinkSync(path.join(src, 'shot-library.json'), path.join(src, 'palette.json'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.writeFileSync(path.join(ud, 'film-kit', 'old.txt'), 'old', 'utf8')
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(false)
    expect(fs.readFileSync(path.join(ud, 'film-kit', 'old.txt'), 'utf8')).toBe('old')
    expect(fs.readdirSync(ud).filter((n) => n.indexOf('staging') >= 0).length).toBe(0)
    expect(fs.existsSync(lockPathOf(ud))).toBe(false)
  })

  it('源目录与目标路径重叠 ⇒ SOURCE_OVERLAPS_TARGET', async () => {
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    const res = await importKit({
      kitDir: path.join(ud, 'film-kit'),
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SOURCE_OVERLAPS_TARGET)
  })

  it('源目录是目标的父级 ⇒ 同样拒绝', async () => {
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    const res = await importKit({
      kitDir: ud,
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SOURCE_OVERLAPS_TARGET)
  })

  // ⚠ 2026-10-23 验证层外部评审（codex i5）命中：初版把 `film-kit.staging-` / `film-kit.bak-`
  //   **拼成字面路径**再比前缀 ⇒ 真实的 `film-kit.staging-<时间戳>` 目录**永远不匹配**
  //   ⇒ 这两条重叠判据是**死的**（用户选中自己的残留目录当源目录不会被拒）。
  it('源目录是 `.bak` 残留目录 ⇒ 拒绝（初版这条判据是死的）', async () => {
    const ud = tmpDir('ud')
    // ⚠ 同时造出 `film-kit` ⇒ ⓪a 的「残留未恢复」检查（kit 缺失）**不**先触发
    //   ⇒ 走到「源/目标重叠」这一格 ⇒ 验的正是那条**前缀目录**判据。
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    const bak = path.join(ud, 'film-kit.bak-2026-10-23T00-00-00-0000-abcd')
    fs.mkdirSync(bak, { recursive: true })
    const res = await importKit({
      kitDir: bak,
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SOURCE_OVERLAPS_TARGET)
  })

  it('源目录是 `.staging` 残留目录 ⇒ 拒绝', async () => {
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    const stg = path.join(ud, 'film-kit.staging-2026-10-23T00-00-00-0000-abcd')
    fs.mkdirSync(stg, { recursive: true })
    const res = await importKit({
      kitDir: stg,
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.SOURCE_OVERLAPS_TARGET)
  })
})

describe('kit-import: 残留档位与恢复指引（2026-10-23 验证层外部评审修）', () => {
  // ⚠ claude i3 / codex i6：初版 `swapIn` 回传了 `bakPath`，编排层**丢掉**它
  //   ⇒ 「旧备份没删掉」这件事永远到不了渲染端 ⇒ 恢复指引是空的。
  it('删 `.bak` 失败 ⇒ 导入仍生效，但必须回传 BAK_LEFT + 恢复路径', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.writeFileSync(path.join(ud, 'film-kit', 'old.txt'), 'old', 'utf8')
    const brokenFs = stubFs({
      promises: {
        unlink: async () => {
          const e = new Error('EPERM')
          e.code = 'EPERM'
          throw e
        },
      },
    })
    const res = await importKit({
      kitDir: src,
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
      fs: brokenFs,
    })
    expect(res.ok).toBe(true)
    expect(res.recoveryState).toBe('BAK_LEFT')
    expect(String(res.recoveryPath)).toContain('film-kit.bak-')
    // 新资产已生效
    expect(fs.existsSync(path.join(ud, 'film-kit', 'film-manifest.json'))).toBe(true)
  })

  // ⚠ **档位张冠李戴 = 数据丢失级误导**（自查交叉核对发现，两家模型都没抓到）：
  //   回滚失败 ⇒ film-kit **缺失**、`.bak` = 旧 kit ⇒ 恢复动作是「把 .bak 改名回来」
  //   ⇒ 档位必须是 `MISSING_KIT`；初版标成 `BAK_LEFT` ⇒ 渲染端会显示
  //   「可安全删除」⇒ **用户会删掉旧资产仅存的一份**。
  it('回滚失败 ⇒ 档位是 MISSING_KIT（不是 BAK_LEFT）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.writeFileSync(path.join(ud, 'film-kit', 'old.txt'), 'old', 'utf8')
    const brokenFs = stubFs({
      promises: {
        rename: async (from, to) => {
          // 换入（staging → film-kit）失败 ⇒ 触发回滚（`.bak` → `film-kit`）
          if (String(from).includes('staging')) {
            const e = new Error('EBUSY')
            e.code = 'EBUSY'
            throw e
          }
          // 回滚也失败 ⇒ 旧资产只剩 .bak 一份
          if (String(from).includes('film-kit.bak-')) {
            const e = new Error('EBUSY')
            e.code = 'EBUSY'
            throw e
          }
          return fs.promises.rename(from, to)
        },
      },
    })
    const res = await importKit({
      kitDir: src,
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
      fs: brokenFs,
    })
    expect(res.ok).toBe(false)
    expect(res.recoveryState).toBe('MISSING_KIT')
    expect(res.recoveryState).not.toBe('BAK_LEFT')
    expect(String(res.recoveryPath)).toContain('film-kit.bak-')
  })

  // ⚠ codex i3：初版成功路径上 `audit.append(...)` 的返回值被**丢弃**
  //   ⇒ 审计不完整这件事被静默吞掉（与「审计防静默」的目的相反）。
  it('审计结果行写失败 ⇒ 必须显式上报（auditWritten=false），不得当成普通成功', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    let writes = 0
    const brokenFs = stubFs({
      writeSync: (fd, ...rest) => {
        writes += 1
        if (writes === 2) throw new Error('disk on fire') // 第 2 次写 = 结果行
        return fs.writeSync(fd, ...rest)
      },
    })
    const res = await importKit({
      kitDir: src,
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
      fs: brokenFs,
    })
    expect(res.ok).toBe(true)
    expect(res.auditWritten).toBe(false)
    expect(String(res.auditMessage)).toContain('审计')
  })

  // ⚠ claude i1 / codex i6：**失败路径**的审计行写失败同样必须上报
  //   （初版只查了成功路径 ⇒ 「这次失败连审计都没留下」被静默）。
  it('失败路径的审计行写失败 ⇒ 失败信封也要带 auditWritten=false', async () => {
    const ud = tmpDir('ud')
    const brokenFs = stubFs({
      writeSync: () => { throw new Error('disk on fire') },
    })
    const res = await importKit({
      kitDir: tmpDir('src'), // 源目录不存在 ⇒ 走失败路径
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
      fs: brokenFs,
    })
    expect(res.ok).toBe(false)
    expect(res.auditWritten).toBe(false)
  })

  // ⚠ codex i2：② 阶段可能跑很久 ⇒ 期间租约可能过期、他人按「过期」清锁并开始自己的导入
  //   ⇒ 两个进程同时对 `film-kit` 做破坏性 rename。
  //   ⇒ 换入前必须复核「锁还在、且 nonce 还是我这份」，否则**中止**（旧 kit 未动）。
  it('换入前锁被他人接管 ⇒ 中止（LOCK_HELD），不碰旧 kit', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.writeFileSync(path.join(ud, 'film-kit', 'old.txt'), 'old', 'utf8')
    // 扫描/拷贝阶段把锁换成别人的 ⇒ nonce 不再匹配
    const brokenFs = stubFs({
      promises: {
        copyFile: async (from, to) => {
          // 第一次拷贝时把锁文件换成别人的 nonce（模拟「租约过期被他人清掉并接管」）
          fs.writeFileSync(
            lockPathOf(ud),
            JSON.stringify({ nonce: 'someone-else', pid: 1, startedAt: 'x' }),
            'utf8'
          )
          return fs.promises.copyFile(from, to)
        },
      },
    })
    const res = await importKit({
      kitDir: src,
      userDataDir: ud,
      service: makeService(),
      loadFilmKit: fakeStrict,
      fs: brokenFs,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.LOCK_HELD)
    // 旧 kit 逐字未变
    expect(fs.readFileSync(path.join(ud, 'film-kit', 'old.txt'), 'utf8')).toBe('old')
  })
})

describe('kit-import: 锁与残留', () => {
  it('存在有效锁 ⇒ LOCK_HELD（不自动清）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    createLock({ userDataDir: ud })
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.LOCK_HELD)
    expect(fs.existsSync(lockPathOf(ud))).toBe(true)
  })

  it('残留 `.bak` 且 film-kit 缺失 ⇒ 拒绝导入 + 带恢复路径', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit.bak-old'), { recursive: true })
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(false)
    expect(res.recoveryPath).toContain('film-kit.bak-old')
    expect(res.recoveryState).toBe('MISSING_KIT')
  })

  it('残留 `.bak` 但 film-kit 在位 ⇒ 继续导入（档位②）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    fs.mkdirSync(path.join(ud, 'film-kit'), { recursive: true })
    fs.mkdirSync(path.join(ud, 'film-kit.bak-old'), { recursive: true })
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(true)
  })

  it('过期锁 ⇒ 自动清锁后继续（不永久卡死）', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    createLock({ userDataDir: ud })
    const old = new Date(Date.now() - 120000)
    fs.utimesSync(lockPathOf(ud), old, old)
    const res = await importKit({ kitDir: src, userDataDir: ud, service: makeService(), loadFilmKit: fakeStrict })
    expect(res.ok).toBe(true)
  })
})

describe('kit-import: 审计不可写 ⇒ 拒绝导入', () => {
  it('审计父目录不可写 ⇒ AUDIT_UNAVAILABLE，且不碰旧 kit', async () => {
    const src = makeSource(tmpDir('src'))
    const ud = tmpDir('ud')
    const res = await importKit({
      kitDir: src,
      userDataDir: path.join(ud, 'no-such-dir'),
      service: makeService(),
      loadFilmKit: fakeStrict,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(REASON.AUDIT_UNAVAILABLE)
  })
})
