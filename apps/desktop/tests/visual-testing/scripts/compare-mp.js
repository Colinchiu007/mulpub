/**
 * Multi-Publish 与真实参考产品截图的像素审计。
 *
 * 参考图、当前图和差异图都必须位于仓库内。缺少真实参考图时返回
 * REFERENCE_UNVERIFIED 并以非零退出，不能把 Multi-Publish 自己的
 * baseline 当作参考产品参考图。
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { PNG } = require('pngjs')
const pixelmatch = require('pixelmatch')

const REPO_ROOT = path.resolve(__dirname, '../../../../../')
const DEFAULT_MANIFEST = path.join(
  REPO_ROOT,
  '01-docs',
  'ui-reference',
  'visual-baseline-manifest.json',
)
const DEFAULT_DIFF_DIR = path.join(
  REPO_ROOT,
  'apps',
  'desktop',
  'tests',
  'visual-testing',
  'reports',
  'mp-pixel-diff',
)
const DEFAULT_REPORT_JSON = path.join(
  REPO_ROOT,
  'apps',
  'desktop',
  'tests',
  'visual-testing',
  'reports',
  'mp-pixel-audit.json',
)
const DEFAULT_REPORT_MARKDOWN = path.join(
  REPO_ROOT,
  'apps',
  'desktop',
  'tests',
  'visual-testing',
  'reports',
  'mp-pixel-audit.md',
)

const DEFAULT_MISMATCH_THRESHOLD = 0.1
const DEFAULT_PIXEL_THRESHOLD = 0.1
const REFERENCE_STATUS_PENDING = 'PENDING_REAL_CAPTURE'
const REFERENCE_STATUS_VERIFIED = 'CAPTURED_VERIFIED'

function createManifestError(message) {
  const error = new Error(`参考产品像素 manifest 无效：${message}`)
  error.code = 'ERR_MP_MANIFEST'
  return error
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function toRepoRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function findExistingAncestor(filePath) {
  let candidate = filePath
  while (true) {
    try {
      fs.lstatSync(candidate)
      return candidate
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw cause
      const parent = path.dirname(candidate)
      if (parent === candidate) throw cause
      candidate = parent
    }
  }
}

function assertNoSymlinkSegment(root, candidate, label) {
  const relative = path.relative(root, candidate)
  let cursor = root
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue
    cursor = path.join(cursor, segment)
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw createManifestError(label + '不能经过符号链接：' + toRepoRelative(root, cursor))
      }
    } catch (cause) {
      if (cause.code === 'ENOENT') break
      throw cause
    }
  }
}

function assertPhysicalPathWithinRoot(root, candidate, label) {
  try {
    assertNoSymlinkSegment(root, candidate, label)
    const physicalRoot = fs.realpathSync.native(root)
    const physicalCandidate = fs.realpathSync.native(findExistingAncestor(candidate))
    if (!isWithinRoot(physicalRoot, physicalCandidate)) {
      throw createManifestError(label + '的真实路径必须位于仓库目录内')
    }
  } catch (cause) {
    if (cause.code === 'ERR_MP_MANIFEST') throw cause
    throw createManifestError(label + '无法验证真实路径：' + cause.message)
  }
}

function resolveRepositoryPath(value, root = REPO_ROOT, label = '路径') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createManifestError(`${label}必须是非空字符串`)
  }
  const normalizedRoot = path.resolve(root)
  const candidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(normalizedRoot, value)
  if (!isWithinRoot(normalizedRoot, candidate)) {
    throw createManifestError(`${label}必须位于仓库目录内：${value}`)
  }
  assertPhysicalPathWithinRoot(normalizedRoot, candidate, label)
  return candidate
}

function safeImageName(value) {
  const name = String(value || '')
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || name.includes('..')) {
    throw createManifestError(`截图名称不合法：${name || '(空)'}`)
  }
  return name
}

function parseNumber(value, name, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw createManifestError(`${name}必须介于 ${minimum} 和 ${maximum} 之间`)
  }
  return number
}

function normalizeDimensions(value, name) {
  if (value == null) return null
  if (!Array.isArray(value) || value.length !== 2) {
    throw createManifestError(`${name}必须是 [width, height]`)
  }
  const dimensions = value.map((item) => Number(item))
  if (!dimensions.every((item) => Number.isInteger(item) && item > 0)) {
    throw createManifestError(`${name}必须包含正整数`)
  }
  return dimensions
}

function normalizeSha256(value, name) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw createManifestError(`${name}必须是 64 位 SHA-256 十六进制值`)
  }
  return value.toLowerCase()
}

function normalizeRect(value, name) {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createManifestError(`${name}必须是矩形对象`)
  }
  const rect = {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  }
  if (!Number.isInteger(rect.x) || rect.x < 0
    || !Number.isInteger(rect.y) || rect.y < 0
    || !Number.isInteger(rect.width) || rect.width <= 0
    || !Number.isInteger(rect.height) || rect.height <= 0) {
    throw createManifestError(`${name}必须包含非负整数 x/y 和正整数 width/height`)
  }
  return rect
}

function normalizeRectList(value, name) {
  if (value == null) return []
  if (!Array.isArray(value)) {
    throw createManifestError(`${name}必须是矩形数组`)
  }
  return value.map((rect, index) => normalizeRect(rect, `${name}[${index}]`))
}

function normalizeReferenceStatus(value) {
  if (value !== REFERENCE_STATUS_PENDING && value !== REFERENCE_STATUS_VERIFIED) {
    throw createManifestError(
      'referenceStatus 必须为 PENDING_REAL_CAPTURE 或 CAPTURED_VERIFIED',
    )
  }
  return value
}

function normalizeTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw createManifestError('targets 中的每一项必须是对象')
  }
  return {
    name: safeImageName(target.name),
    reference: target.reference,
    current: target.current,
    source: typeof target.source === 'string' ? target.source : '',
    referenceSha256: normalizeSha256(target.referenceSha256, 'referenceSha256'),
    referenceDimensions: normalizeDimensions(target.referenceDimensions, 'referenceDimensions'),
    referenceCrop: normalizeRect(target.referenceCrop, 'referenceCrop'),
    currentCrop: normalizeRect(target.currentCrop, 'currentCrop'),
    ignoreRegions: normalizeRectList(target.ignoreRegions, 'ignoreRegions'),
  }
}

function parseComparison(comparison = {}) {
  if (comparison == null) return {
    mismatchThreshold: DEFAULT_MISMATCH_THRESHOLD,
    pixelThreshold: DEFAULT_PIXEL_THRESHOLD,
  }
  if (typeof comparison !== 'object' || Array.isArray(comparison)) {
    throw createManifestError('comparison 必须是对象')
  }
  return {
    mismatchThreshold: comparison.mismatchThreshold == null
      ? DEFAULT_MISMATCH_THRESHOLD
      : parseNumber(comparison.mismatchThreshold, 'mismatchThreshold', 0, 100),
    pixelThreshold: comparison.pixelThreshold == null
      ? DEFAULT_PIXEL_THRESHOLD
      : parseNumber(comparison.pixelThreshold, 'pixelThreshold', 0, 1),
  }
}

function requireVerifiedReferenceMetadata(targets) {
  for (const target of targets) {
    if (!target.referenceSha256 || !target.referenceDimensions) {
      throw createManifestError(
        'CAPTURED_VERIFIED 的每个 target 必须提供 referenceSha256 和 referenceDimensions：'
          + target.name,
      )
    }
  }
}

function normalizeComparisonOptions(options = {}) {
  return {
    mismatchThreshold: options.mismatchThreshold == null
      ? DEFAULT_MISMATCH_THRESHOLD
      : parseNumber(options.mismatchThreshold, 'mismatchThreshold', 0, 100),
    pixelThreshold: options.pixelThreshold == null
      ? DEFAULT_PIXEL_THRESHOLD
      : parseNumber(options.pixelThreshold, 'pixelThreshold', 0, 1),
  }
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function readPng(filePath, label, displayPath = filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      status: label === 'reference' ? 'REFERENCE_UNVERIFIED' : 'CURRENT_MISSING',
      blocked: label === 'reference',
      reason: `${label === 'reference' ? '参考图不存在' : '当前图不存在'}：${displayPath}`,
    }
  }

  try {
    const buffer = fs.readFileSync(filePath)
    const image = PNG.sync.read(buffer)
    if (image.width <= 0 || image.height <= 0) {
      throw new Error('图片尺寸必须大于 0')
    }
    return {
      ok: true,
      image,
      dimensions: [image.width, image.height],
      bytes: buffer.length,
      sha256: hashBuffer(buffer),
    }
  } catch (cause) {
    return {
      ok: false,
      status: label === 'reference' ? 'REFERENCE_INVALID' : 'CURRENT_INVALID',
      blocked: label === 'reference',
      reason: `${label === 'reference' ? '参考图' : '当前图'}不是可解码 PNG：${displayPath}（${cause.message}）`,
    }
  }
}

function fullImageRect(image) {
  return { x: 0, y: 0, width: image.width, height: image.height }
}

function isRectWithinImage(rect, image) {
  return rect.x + rect.width <= image.width && rect.y + rect.height <= image.height
}

function cropImage(image, rect) {
  const cropped = new PNG({ width: rect.width, height: rect.height })
  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * image.width + rect.x) * 4
    const sourceEnd = sourceStart + rect.width * 4
    cropped.data.set(image.data.subarray(sourceStart, sourceEnd), row * rect.width * 4)
  }
  return cropped
}

function invalidCropResult(reason, reference, current, referenceCrop, currentCrop) {
  return {
    status: 'CROP_INVALID',
    passed: false,
    blocked: true,
    reason,
    dimensions: {
      reference: [reference.width, reference.height],
      current: [current.width, current.height],
    },
    referenceCrop,
    currentCrop,
    mismatchPixels: null,
    mismatchPercentage: null,
    maskedPixels: null,
    effectivePixels: null,
  }
}

function compareImages(reference, current, options = {}) {
  let referenceCrop
  let currentCrop
  let ignoreRegions
  try {
    referenceCrop = normalizeRect(options.referenceCrop, 'referenceCrop') || fullImageRect(reference)
    currentCrop = normalizeRect(options.currentCrop, 'currentCrop') || fullImageRect(current)
    ignoreRegions = normalizeRectList(options.ignoreRegions, 'ignoreRegions')
  } catch (cause) {
    return invalidCropResult(cause.message, reference, current, referenceCrop, currentCrop)
  }

  if (!isRectWithinImage(referenceCrop, reference)) {
    return invalidCropResult('referenceCrop 超出参考图边界', reference, current, referenceCrop, currentCrop)
  }
  if (!isRectWithinImage(currentCrop, current)) {
    return invalidCropResult('currentCrop 超出当前图边界', reference, current, referenceCrop, currentCrop)
  }

  const croppedReference = cropImage(reference, referenceCrop)
  const croppedCurrent = cropImage(current, currentCrop)
  if (croppedReference.width !== croppedCurrent.width || croppedReference.height !== croppedCurrent.height) {
    return {
      status: options.referenceCrop || options.currentCrop
        ? 'CROP_DIMENSION_MISMATCH'
        : 'DIMENSION_MISMATCH',
      passed: false,
      blocked: true,
      dimensions: {
        reference: [croppedReference.width, croppedReference.height],
        current: [croppedCurrent.width, croppedCurrent.height],
      },
      referenceCrop,
      currentCrop,
      mismatchPixels: null,
      mismatchPercentage: null,
      maskedPixels: 0,
      effectivePixels: null,
    }
  }

  const width = croppedReference.width
  const height = croppedReference.height
  const totalPixels = width * height
  const masked = new Uint8Array(totalPixels)
  let maskedPixels = 0
  for (let index = 0; index < ignoreRegions.length; index += 1) {
    const rect = ignoreRegions[index]
    if (!isRectWithinImage(rect, croppedReference)) {
      return invalidCropResult(
        `ignoreRegions[${index}] 超出裁剪后图像边界`,
        reference,
        current,
        referenceCrop,
        currentCrop,
      )
    }
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const pixelIndex = y * width + x
        if (masked[pixelIndex] === 0) {
          masked[pixelIndex] = 1
          maskedPixels += 1
        }
      }
    }
  }

  const effectivePixels = totalPixels - maskedPixels
  if (effectivePixels === 0) {
    return {
      status: 'NO_EFFECTIVE_PIXELS',
      passed: false,
      blocked: true,
      reason: 'ignoreRegions 覆盖了全部比较区域',
      dimensions: { reference: [width, height], current: [width, height] },
      referenceCrop,
      currentCrop,
      ignoreRegions,
      mismatchPixels: null,
      mismatchPercentage: null,
      maskedPixels,
      effectivePixels,
    }
  }

  const referenceData = Buffer.from(croppedReference.data)
  const currentData = Buffer.from(croppedCurrent.data)
  for (let pixelIndex = 0; pixelIndex < masked.length; pixelIndex += 1) {
    if (masked[pixelIndex] === 0) continue
    const offset = pixelIndex * 4
    referenceData.fill(0, offset, offset + 4)
    currentData.fill(0, offset, offset + 4)
  }

  const comparisonOptions = normalizeComparisonOptions(options)
  const diffImage = new PNG({ width, height })
  const mismatchPixels = pixelmatch(
    referenceData,
    currentData,
    diffImage.data,
    width,
    height,
    {
      threshold: comparisonOptions.pixelThreshold,
      includeAA: false,
      alpha: 0.5,
    },
  )
  const mismatchPercentage = (mismatchPixels / effectivePixels) * 100
  return {
    status: mismatchPercentage <= comparisonOptions.mismatchThreshold ? 'PASS' : 'FAIL',
    passed: mismatchPercentage <= comparisonOptions.mismatchThreshold,
    blocked: false,
    dimensions: {
      reference: [width, height],
      current: [width, height],
    },
    referenceCrop,
    currentCrop,
    ignoreRegions,
    mismatchPixels,
    mismatchPercentage,
    maskedPixels,
    effectivePixels,
    diffImage,
  }
}

function invalidTargetResult(target, root, cause) {
  return {
    name: typeof target?.name === 'string' ? target.name : 'unnamed',
    source: typeof target?.source === 'string' ? target.source : '',
    referencePath: null,
    currentPath: null,
    status: 'CONFIG_INVALID',
    passed: false,
    blocked: true,
    reason: cause.message,
    root: toRepoRelative(root, root),
  }
}

async function compareTarget(target, options = {}) {
  const root = path.resolve(options.root || REPO_ROOT)
  let normalizedTarget
  let referencePath
  let currentPath
  let diffDir
  let comparisonOptions
  let referenceStatus
  try {
    normalizedTarget = normalizeTarget(target)
    comparisonOptions = normalizeComparisonOptions(options)
    referenceStatus = options.referenceStatus == null
      ? null
      : normalizeReferenceStatus(options.referenceStatus)
    if (referenceStatus === REFERENCE_STATUS_VERIFIED) {
      requireVerifiedReferenceMetadata([normalizedTarget])
    }
    referencePath = resolveRepositoryPath(normalizedTarget.reference, root, 'reference')
    currentPath = resolveRepositoryPath(normalizedTarget.current, root, 'current')
    diffDir = options.diffDir == null
      ? null
      : resolveRepositoryPath(options.diffDir, root, 'diffDir')
  } catch (cause) {
    return invalidTargetResult(target, root, cause)
  }

  const result = {
    name: normalizedTarget.name,
    source: normalizedTarget.source,
    referencePath: toRepoRelative(root, referencePath),
    currentPath: toRepoRelative(root, currentPath),
    status: 'REFERENCE_UNVERIFIED',
    passed: false,
    blocked: true,
    reason: null,
  }

  if (referenceStatus === REFERENCE_STATUS_PENDING) {
    result.reason = '参考图状态为 PENDING_REAL_CAPTURE，尚未完成真实参考产品捕获和元数据核验'
    return result
  }

  const reference = readPng(referencePath, 'reference', result.referencePath)
  if (!reference.ok) {
    result.status = reference.status
    result.blocked = reference.blocked
    result.reason = reference.reason
    return result
  }
  if (normalizedTarget.referenceSha256 && reference.sha256 !== normalizedTarget.referenceSha256) {
    result.status = 'REFERENCE_CHANGED'
    result.reason = '参考图 SHA-256 与 manifest 记录不一致'
    result.referenceSha256 = reference.sha256
    return result
  }
  if (normalizedTarget.referenceDimensions
    && normalizedTarget.referenceDimensions.some((value, index) => value !== reference.dimensions[index])) {
    result.status = 'REFERENCE_DIMENSIONS_MISMATCH'
    result.reason = `参考图尺寸与 manifest 记录不一致：${reference.dimensions.join('x')}`
    result.referenceSha256 = reference.sha256
    return result
  }

  const current = readPng(currentPath, 'current', result.currentPath)
  if (!current.ok) {
    result.status = current.status
    result.blocked = current.blocked
    result.reason = current.reason
    return result
  }

  const comparison = compareImages(reference.image, current.image, {
    ...comparisonOptions,
    referenceCrop: normalizedTarget.referenceCrop,
    currentCrop: normalizedTarget.currentCrop,
    ignoreRegions: normalizedTarget.ignoreRegions,
  })
  result.status = comparison.status
  result.passed = comparison.passed
  result.blocked = comparison.blocked
  result.dimensions = comparison.dimensions
  result.mismatchPixels = comparison.mismatchPixels
  result.mismatchPercentage = comparison.mismatchPercentage
  result.referenceCrop = comparison.referenceCrop
  result.currentCrop = comparison.currentCrop
  result.ignoreRegions = comparison.ignoreRegions || normalizedTarget.ignoreRegions
  result.maskedPixels = comparison.maskedPixels
  result.effectivePixels = comparison.effectivePixels
  result.reason = comparison.reason || null
  result.referenceBytes = reference.bytes
  result.currentBytes = current.bytes
  result.referenceSha256 = reference.sha256
  result.currentSha256 = current.sha256

  if (!comparison.passed && comparison.diffImage && diffDir) {
    const diffPath = path.join(diffDir, `${normalizedTarget.name}.png`)
    await fs.promises.mkdir(path.dirname(diffPath), { recursive: true })
    resolveRepositoryPath(diffPath, root, '差异图')
    await fs.promises.writeFile(diffPath, PNG.sync.write(comparison.diffImage))
    result.diffPath = toRepoRelative(root, diffPath)
  }
  return result
}

function summarize(results) {
  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed && !result.blocked).length,
    blocked: results.filter((result) => result.blocked).length,
    referenceUnverified: results.filter((result) => result.status === 'REFERENCE_UNVERIFIED').length,
    dimensionMismatch: results.filter((result) => (
      result.status === 'DIMENSION_MISMATCH' || result.status === 'CROP_DIMENSION_MISMATCH'
    )).length,
    configurationInvalid: results.filter((result) => result.status === 'CONFIG_INVALID').length,
  }
}

function escapeMarkdownCell(value) {
  return String(value == null ? '-' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
}

function renderMarkdown(report) {
  const lines = [
    '# 参考产品真实基线像素审计',
    '',
    `生成时间：${escapeMarkdownCell(report.meta.generatedAt)}`,
    `Manifest：${escapeMarkdownCell(report.meta.manifest)}`,
    `参考图状态：${escapeMarkdownCell(report.meta.referenceStatus)}`,
    `阈值：整体误差 ${report.meta.mismatchThreshold}%；单像素阈值 ${report.meta.pixelThreshold}`,
    '',
    `汇总：${report.summary.passed}/${report.summary.total} 通过，${report.summary.failed} 失败，${report.summary.blocked} 阻断，${report.summary.referenceUnverified} 个参考图未验证。`,
    '',
    '| 视图 | 状态 | 参考图 | 当前图 | 尺寸 | 误差 | 备注 |',
    '|---|---|---|---|---|---:|---|',
  ]
  for (const result of report.results) {
    const dimensions = result.dimensions
      ? `${result.dimensions.reference.join('x')} / ${result.dimensions.current.join('x')}`
      : '-'
    const mismatch = Number.isFinite(result.mismatchPercentage)
      ? `${result.mismatchPercentage.toFixed(4)}%`
      : '-'
    const auditDetails = []
    if (result.referenceCrop) {
      auditDetails.push(`参考裁剪 ${result.referenceCrop.x},${result.referenceCrop.y},${result.referenceCrop.width}x${result.referenceCrop.height}`)
    }
    if (result.currentCrop) {
      auditDetails.push(`当前裁剪 ${result.currentCrop.x},${result.currentCrop.y},${result.currentCrop.width}x${result.currentCrop.height}`)
    }
    if (Number.isInteger(result.effectivePixels)) {
      auditDetails.push(`有效像素 ${result.effectivePixels}，遮罩 ${result.maskedPixels || 0}`)
    }
    lines.push([
      escapeMarkdownCell(result.name),
      escapeMarkdownCell(result.status),
      escapeMarkdownCell(result.referencePath),
      escapeMarkdownCell(result.currentPath),
      escapeMarkdownCell(dimensions),
      mismatch,
      escapeMarkdownCell([result.reason || result.source, ...auditDetails].filter(Boolean).join('；')),
    ].join(' | ').replace(/^/, '| ').concat(' |'))
  }
  lines.push('', '> `REFERENCE_UNVERIFIED` 不是通过；必须在同一窗口尺寸和登录状态下从真实参考产品捕获参考图后复跑。')
  return lines.join('\n') + '\n'
}

function loadManifest(manifestPath = DEFAULT_MANIFEST, options = {}) {
  const root = path.resolve(options.root || REPO_ROOT)
  const absolutePath = resolveRepositoryPath(manifestPath, root, 'manifest')
  if (!fs.existsSync(absolutePath)) {
    throw createManifestError(`manifest 不存在：${toRepoRelative(root, absolutePath)}`)
  }

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
  } catch (cause) {
    throw createManifestError(`无法解析 JSON：${cause.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createManifestError('根对象必须是对象')
  }
  if (parsed.version !== 1) {
    throw createManifestError('version 必须为 1')
  }
  if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) {
    throw createManifestError('targets 必须是非空数组')
  }
  const referenceStatus = normalizeReferenceStatus(parsed.referenceStatus)
  const targets = parsed.targets.map(normalizeTarget)
  if (referenceStatus === REFERENCE_STATUS_VERIFIED) {
    requireVerifiedReferenceMetadata(targets)
  }

  return {
    ...parsed,
    path: absolutePath,
    referenceStatus,
    comparison: parseComparison(parsed.comparison),
    targets,
  }
}

async function writeReport(filePath, content, root) {
  const destination = resolveRepositoryPath(filePath, root, '报告路径')
  await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  resolveRepositoryPath(destination, root, '报告路径')
  await fs.promises.writeFile(destination, content, 'utf8')
  return destination
}

async function runAudit(options = {}) {
  const root = path.resolve(options.root || REPO_ROOT)
  const comparisonOptions = normalizeComparisonOptions(options)
  const referenceStatus = options.referenceStatus == null
    ? null
    : normalizeReferenceStatus(options.referenceStatus)
  if (referenceStatus === REFERENCE_STATUS_VERIFIED) {
    requireVerifiedReferenceMetadata(options.targets || [])
  }
  const targetOptions = { ...options, ...comparisonOptions, referenceStatus, root }
  const results = []
  for (const target of options.targets || []) {
    results.push(await compareTarget(target, targetOptions))
  }
  const report = {
    meta: {
      generatedAt: options.generatedAt || new Date().toISOString(),
      manifest: options.manifestPath ? toRepoRelative(root, options.manifestPath) : toRepoRelative(root, DEFAULT_MANIFEST),
      referenceStatus,
      mismatchThreshold: comparisonOptions.mismatchThreshold,
      pixelThreshold: comparisonOptions.pixelThreshold,
      rule: '真实参考产品参考图必须可解码、在仓库内且尺寸一致；缺失参考图不得通过。',
    },
    summary: summarize(results),
    results,
  }
  if (options.outputJson) {
    await writeReport(options.outputJson, JSON.stringify(report, null, 2) + '\n', root)
  }
  if (options.outputMarkdown) {
    await writeReport(options.outputMarkdown, renderMarkdown(report), root)
  }
  return report
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const result = {}
  for (const argument of argv) {
    if (argument.startsWith('--manifest=')) {
      result.manifest = argument.slice('--manifest='.length)
    } else if (argument.startsWith('--mismatch-threshold=')) {
      result.mismatchThreshold = parseNumber(
        argument.slice('--mismatch-threshold='.length),
        'mismatch-threshold',
        0,
        100,
      )
    } else if (argument.startsWith('--pixel-threshold=')) {
      result.pixelThreshold = parseNumber(
        argument.slice('--pixel-threshold='.length),
        'pixel-threshold',
        0,
        1,
      )
    } else if (argument.startsWith('--diff-dir=')) {
      result.diffDir = argument.slice('--diff-dir='.length)
    } else {
      throw createManifestError(`不支持的参数：${argument}`)
    }
  }
  return result
}

async function main(argv = process.argv.slice(2)) {
  const cli = parseCliArgs(argv)
  const manifest = loadManifest(cli.manifest || DEFAULT_MANIFEST)
  const mismatchThreshold = cli.mismatchThreshold ?? manifest.comparison.mismatchThreshold
  const pixelThreshold = cli.pixelThreshold ?? manifest.comparison.pixelThreshold
  const report = await runAudit({
    targets: manifest.targets,
    manifestPath: manifest.path,
    referenceStatus: manifest.referenceStatus,
    mismatchThreshold,
    pixelThreshold,
    diffDir: cli.diffDir || DEFAULT_DIFF_DIR,
    outputJson: DEFAULT_REPORT_JSON,
    outputMarkdown: DEFAULT_REPORT_MARKDOWN,
  })
  console.log(renderMarkdown(report))
  if (report.summary.failed > 0 || report.summary.blocked > 0) {
    process.exitCode = 1
  }
  return report
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`参考产品像素审计失败：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  DEFAULT_DIFF_DIR,
  DEFAULT_MANIFEST,
  DEFAULT_MISMATCH_THRESHOLD,
  DEFAULT_PIXEL_THRESHOLD,
  compareImages,
  compareTarget,
  loadManifest,
  normalizeTarget,
  parseCliArgs,
  renderMarkdown,
  runAudit,
  summarize,
}
