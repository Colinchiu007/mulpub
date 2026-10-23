// @ts-check
'use strict'
/**
 * kit-import-scan — 资产导入的「白名单 + 第一遍扫描 + 形状校验」
 *
 * 归属：PR-3b（F-J 资产导入写路径）· 方案 `pr3b-import-design.md` §三 S1/S2/S6/S10/S13/S21/S22
 *
 * 职责（只做第一遍，**一个字节都不写**）：
 *   1. 枚举**白名单内**的候选文件（白名单外的条目一律跳过，S1：跳过是正常态、不记审计、不算失败）；
 *   2. 形状校验（S10）：固定深度、隐藏名、扩展名；
 *   3. 链与越界（S2）：软链 / 断链 / realpath 越界 / 同目录 (dev,ino) 硬链；
 *   4. 魔数（S13）：`*.json` 头须 `{` / `[`（去 BOM/空白）；
 *   5. 体积（S14/§九 决策 2）：单文件 ≤ MAX_KIT_FILE_BYTES、总量 ≤ MAX_KIT_TOTAL_BYTES；
 *   6. 内容哈希（S6）：SHA-256 记入 `firstPassStats`（键 = 相对路径），
 *      供第二遍拷贝时做「副本哈希 == 源哈希」与「源文件未被改动」两条对账。
 *
 * 诚实边界（写进 `SCHEMA.md` 的同名小节）：
 *   - **跨目录硬链不在本模块的判据范围内**（`nlink` 在 FAT/exFAT/网络盘不可靠 ⇒ 检测不到）
 *     ⇒ 非防篡改边界，补偿见方案 §四 取舍③。
 *   - 扫描**不判断**源目录是否与目标路径重叠（那属于 ⓪a 的前置断言，在编排层）。
 *
 * 依赖可注入（fs / hashFile / now），测试既可用真临时目录，也可用替身。
 */

const nodeFs = require('fs')
const nodePath = require('path')
const nodeCrypto = require('crypto')

/** 深度基准：`prompts/tasks` 任务库（相对 `prompts/` 根恰 3 层：`<task>/<lang>/<file>`） */
const BASE_PROMPT_PATH = 'prompts/tasks'
/** 单文件上限（32 MB）—— §九 决策 2；数值只在代码里存在一次（S14） */
const MAX_KIT_FILE_BYTES = 32 * 1024 * 1024
/** 整包上限（256 MB）—— §九 决策 2 */
const MAX_KIT_TOTAL_BYTES = 256 * 1024 * 1024

/** 根级必填（严格模式要求齐备，kit-loader 的 requireAssets 同口径） */
const ROOT_REQUIRED = Object.freeze([
  'film-manifest.json',
  'shot-library.json',
  'reference-registry.json',
  'prompt-doctrine.json',
  'shot-grammar.json',
  'compliance-checklist.json',
  'palette.json',
])
/** 根级可选（要拷但不强制） */
const ROOT_OPTIONAL = Object.freeze(['prompt-doctrine.zh.md'])

/**
 * 导入白名单（**机器可读唯一真源**，S14）。
 * 形态与 `film-kit/SCHEMA.md`「文件清单」表里标 ✅ 的行**逐行相等**（镜像断言见 kit-mirror-check.js）。
 * ⚠ `images/` **不在白名单内**（全仓无消费方 ⇒ 契约零价值）——排除本身写进 SCHEMA.md 的「排除项清单」。
 */
const WHITELIST_PATTERNS = Object.freeze(
  ROOT_REQUIRED.concat(ROOT_OPTIONAL).concat([BASE_PROMPT_PATH + '/**']).sort()
)

/** 根文件扩展名允许集 */
const ROOT_EXTENSIONS = Object.freeze(['.json', '.md'])
/** 任务库扩展名允许集（任务库只放提示词原文） */
const PROMPT_EXTENSIONS = Object.freeze(['.md'])

/** 失败原因（闭集见方案 §五；本模块只可能产出这几种） */
const REASON = Object.freeze({
  NOT_A_DIRECTORY: 'NOT_A_DIRECTORY',
  PATH_ESCAPE: 'PATH_ESCAPE',
  SYMLINK_REJECTED: 'SYMLINK_REJECTED',
  HARDLINK_REJECTED: 'HARDLINK_REJECTED',
  HIDDEN_NAME_REJECTED: 'HIDDEN_NAME_REJECTED',
  EXT_NOT_ALLOWED: 'EXT_NOT_ALLOWED',
  MAGIC_MISMATCH: 'MAGIC_MISMATCH',
  SIZE_EXCEEDED: 'SIZE_EXCEEDED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
})

/** 归一化（镜像断言口径）：posix 归一 + 去尾斜杠 */
function normalizePattern (p) {
  const s = String(p == null ? '' : p).replace(/\\/g, '/')
  const n = nodePath.posix.normalize(s)
  return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n
}

/** 隐藏名判定：路径任一组件以 `.` 开头（`.` / `..` 由枚举阶段先跳过，不走这里） */
function isHiddenComponent (relPath) {
  return normalizePattern(relPath)
    .split('/')
    .some((seg) => seg.length > 0 && seg.startsWith('.'))
}

/** 扩展名允许集（按目录区分：根文件 vs 任务库） */
function allowedExtensionsFor (relPath) {
  return normalizePattern(relPath).startsWith(BASE_PROMPT_PATH + '/')
    ? PROMPT_EXTENSIONS
    : ROOT_EXTENSIONS
}

/** 默认文件哈希：SHA-256（十六进制） */
function defaultHashFile (fsImpl, absPath) {
  return new Promise((resolve, reject) => {
    const h = nodeCrypto.createHash('sha256')
    const stream = fsImpl.createReadStream(absPath)
    stream.on('error', reject)
    stream.on('data', (chunk) => h.update(chunk))
    stream.on('end', () => resolve(h.digest('hex')))
  })
}

/** 让出事件循环（心跳不得被扫描饿死 —— S18） */
function yieldToLoop () {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * 枚举候选文件（相对路径 + 绝对路径）。
 * 只认白名单内的路径；白名单外的条目**整目录跳过**（S1，不递归进入其子目录）。
 */
async function enumerateCandidates (fsImpl, kitDir) {
  const out = []
  const entries = await fsImpl.promises.readdir(kitDir, { withFileTypes: true })
  const byName = new Map(entries.map((e) => [e.name, e]))

  for (const name of ROOT_REQUIRED.concat(ROOT_OPTIONAL)) {
    const ent = byName.get(name)
    if (!ent) {
      if (ROOT_REQUIRED.indexOf(name) >= 0) {
        return { ok: false, reason: REASON.VALIDATION_ERROR, message: '必填文件缺失: ' + name }
      }
      continue
    }
    if (!ent.isFile() && !ent.isSymbolicLink()) {
      // 软链**不在这里拒**（要让它走到扫描里的 lstat 判定，才能区分「软链」与「断链」）
      return { ok: false, reason: REASON.NOT_A_DIRECTORY, message: '白名单条目不是普通文件: ' + name }
    }
    out.push(name)
  }

  // prompts/tasks/<task>/<lang>/<file>：固定 3 层
  // ⚠ BASE_PROMPT_PATH 是**多段路径**（'prompts/tasks'）⇒ 顶层 readdir 里只能查到第一段，
  //   逐段下钻，不能拿整段路径去顶层表里找。
  const baseSegs = BASE_PROMPT_PATH.split('/')
  let cursor = kitDir
  for (let i = 0; i < baseSegs.length; i++) {
    const seg = baseSegs[i]
    const segEnt = i === 0 ? byName.get(seg) : null
    if (i === 0) {
      if (!segEnt || !segEnt.isDirectory()) {
        return { ok: false, reason: REASON.VALIDATION_ERROR, message: '必填目录缺失: ' + BASE_PROMPT_PATH }
      }
    } else {
      let subEnts
      try {
        subEnts = await fsImpl.promises.readdir(cursor, { withFileTypes: true })
      } catch (_e) {
        return { ok: false, reason: REASON.VALIDATION_ERROR, message: '必填目录缺失: ' + BASE_PROMPT_PATH }
      }
      const found = subEnts.find((e) => e.name === seg)
      if (!found || !found.isDirectory()) {
        return { ok: false, reason: REASON.VALIDATION_ERROR, message: '必填目录缺失: ' + BASE_PROMPT_PATH }
      }
    }
    cursor = nodePath.join(cursor, seg)
  }
  const tasksRoot = cursor
  {
    const tasks = await fsImpl.promises.readdir(tasksRoot, { withFileTypes: true })
    for (const task of tasks) {
      if (task.name === '.' || task.name === '..') continue
      if (!task.isDirectory()) continue
      const taskDir = nodePath.join(tasksRoot, task.name)
      const langs = await fsImpl.promises.readdir(taskDir, { withFileTypes: true })
      for (const lang of langs) {
        if (lang.name === '.' || lang.name === '..') continue
        if (!lang.isDirectory()) continue
        const langDir = nodePath.join(taskDir, lang.name)
        const files = await fsImpl.promises.readdir(langDir, { withFileTypes: true })
        for (const f of files) {
          if (f.name === '.' || f.name === '..') continue
          if (!f.isFile()) continue
          out.push(BASE_PROMPT_PATH + '/' + task.name + '/' + lang.name + '/' + f.name)
        }
      }
    }
  }
  return { ok: true, candidates: out }
}

/**
 * 第一遍扫描。
 * @param {object} opts
 * @param {string} opts.kitDir - 源目录（用户选定）
 * @param {object} [opts.fs] - fs 替身（默认真 fs）
 * @param {(fsImpl:any, absPath:string)=>Promise<string>} [opts.hashFile] - 哈希实现
 * @returns {Promise<{ok:boolean, reason?:string, message?:string, files?:Array, firstPassStats?:object, totalBytes?:number}>}
 */
async function scanKit (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const hashFile = o.hashFile || defaultHashFile
  const kitDir = o.kitDir

  let kitStat
  try {
    kitStat = await fsImpl.promises.stat(kitDir)
  } catch (e) {
    return { ok: false, reason: REASON.NOT_A_DIRECTORY, message: '源目录不可读: ' + String(e && e.message) }
  }
  if (!kitStat.isDirectory()) {
    return { ok: false, reason: REASON.NOT_A_DIRECTORY, message: '源路径不是目录' }
  }

  const enumRes = await enumerateCandidates(fsImpl, kitDir)
  if (!enumRes.ok) return enumRes

  let kitReal
  try {
    kitReal = await fsImpl.promises.realpath(kitDir)
  } catch (e) {
    return { ok: false, reason: REASON.VALIDATION_ERROR, message: '源目录 realpath 失败: ' + String(e && e.message) }
  }

  /** 键 = 相对路径；值 = {dev, ino, size, mtimeMs, sha256} */
  const firstPassStats = {}
  /** 同目录硬链去重：dev:ino → 首次出现的相对路径 */
  const seenInodes = new Map()
  const files = []
  let totalBytes = 0

  for (const rel of enumRes.candidates) {
    await yieldToLoop()
    const norm = normalizePattern(rel)
    const abs = nodePath.join(kitDir, norm)

    // 形状：隐藏名 / 扩展名
    if (isHiddenComponent(norm)) {
      return { ok: false, reason: REASON.HIDDEN_NAME_REJECTED, message: '隐藏名路径: ' + norm }
    }
    const ext = nodePath.posix.extname(norm).toLowerCase()
    if (allowedExtensionsFor(norm).indexOf(ext) < 0) {
      return { ok: false, reason: REASON.EXT_NOT_ALLOWED, message: '扩展名不允许: ' + norm }
    }

    // 链：lstat（不跟随）
    let st
    try {
      st = await fsImpl.promises.lstat(abs)
    } catch (_e) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: 'lstat 失败: ' + norm }
    }
    if (st.isSymbolicLink()) {
      // 断链：lstat 说它是链接，但 stat 失败
      try {
        await fsImpl.promises.stat(abs)
      } catch (_e) {
        return { ok: false, reason: REASON.SYMLINK_REJECTED, message: '断链: ' + norm }
      }
      return { ok: false, reason: REASON.SYMLINK_REJECTED, message: '软链不跟随: ' + norm }
    }
    if (!st.isFile()) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '不是普通文件: ' + norm }
    }

    // 越界：realpath 必须仍在源目录内
    let real
    try {
      real = await fsImpl.promises.realpath(abs)
    } catch (_e) {
      return { ok: false, reason: REASON.SYMLINK_REJECTED, message: 'realpath 失败: ' + norm }
    }
    if (real !== kitReal && !real.startsWith(kitReal + nodePath.sep)) {
      return { ok: false, reason: REASON.PATH_ESCAPE, message: 'realpath 越出源目录: ' + norm }
    }

    // 硬链（同目录）：(dev, ino) 去重 —— 与 nlink 无关，任何文件系统都成立
    const inodeKey = String(st.dev) + ':' + String(st.ino)
    if (seenInodes.has(inodeKey)) {
      return {
        ok: false,
        reason: REASON.HARDLINK_REJECTED,
        message: '同目录硬链: ' + norm + ' 与 ' + seenInodes.get(inodeKey),
      }
    }
    seenInodes.set(inodeKey, norm)

    // 体积
    if (st.size > MAX_KIT_FILE_BYTES) {
      return { ok: false, reason: REASON.SIZE_EXCEEDED, message: '单文件超限: ' + norm }
    }
    totalBytes += st.size
    if (totalBytes > MAX_KIT_TOTAL_BYTES) {
      return { ok: false, reason: REASON.SIZE_EXCEEDED, message: '整包超限' }
    }

    // 魔数（S13）：json 头须 { / [
    if (ext === '.json') {
      const head = Buffer.alloc(8)
      let fh
      try {
        fh = await fsImpl.promises.open(abs, 'r')
        const { bytesRead } = await fh.read(head, 0, 8, 0)
        const text = head.slice(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '').trim()
        if (text !== '' && text[0] !== '{' && text[0] !== '[') {
          return { ok: false, reason: REASON.MAGIC_MISMATCH, message: 'JSON 魔数不匹配: ' + norm }
        }
      } catch (_e) {
        return { ok: false, reason: REASON.VALIDATION_ERROR, message: '读文件头失败: ' + norm }
      } finally {
        if (fh) await fh.close().catch(() => {})
      }
    }

    // 内容哈希
    const sha256 = await hashFile(fsImpl, abs)
    firstPassStats[norm] = {
      dev: st.dev,
      ino: st.ino,
      size: st.size,
      mtimeMs: st.mtimeMs,
      sha256,
    }
    files.push({ relPath: norm, absPath: abs, size: st.size, sha256 })
  }

  return { ok: true, files, firstPassStats, totalBytes }
}

module.exports = {
  BASE_PROMPT_PATH,
  MAX_KIT_FILE_BYTES,
  MAX_KIT_TOTAL_BYTES,
  ROOT_REQUIRED,
  ROOT_OPTIONAL,
  WHITELIST_PATTERNS,
  REASON,
  normalizePattern,
  isHiddenComponent,
  allowedExtensionsFor,
  scanKit,
}
