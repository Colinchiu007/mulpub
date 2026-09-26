/**
 * 账号云同步的逐条结果模型（从 AccountCloudSyncDialog.vue 拆出）
 *
 * 拆出的不是行数，是一整块**与组件状态无关的口径**：outcome → 标签/色调、
 * 服务端错误码 → 文案分组、以及「失败行必须永远有文字」的兜底规则。
 *
 * 两条硬口径（改动前务必读完整）：
 *   1. **失败行的原因栏必须永远有文字**。服务端对每条账号独立裁决并在 results[i].errorCode
 *      回一个语义码，码表比 PRD §7.5 更宽（真源是 packages/api-publish-engine/src/cloud-accounts
 *      的 validate-account.js / handlers.js / envelope-crypto.js / cloud-account-repository.js，
 *      外加主进程自己补的 ACCOUNT_REJECTED 等）。未登记的码一律落到 ERROR_FALLBACK_KEY，
 *      不再返回空串——空串就是界面上那片空白。
 *   2. **后端原始码/错误串不得直出界面**（本仓规则：UI 不展示内部枚举；主进程侧的
 *      errorMessage(e) 甚至可能是任意一句人话）。码只保留在开发者侧：主进程日志已记，
 *      渲染层再把它写进该行的 data-error-code 属性，供排障与测试断言。
 *
 * 不逐码建 locale：这些码里绝大多数对用户都是同一句话「云端没收这条，稍后再试」，
 * 逐码建键会造出一批几乎没人看的死键（AGENTS.md 禁止死键），故按用户能采取的动作分组。
 *
 * t / te 由调用方注入：本模块不自行 import i18n 单例，避免出现第二个翻译入口。
 */

const ERROR_KEY_PREFIX = 'accountsPage.cloudSyncErr'
const ERROR_FALLBACK_SUFFIX = 'cloudFailed'
const ERROR_FALLBACK_KEY = `${ERROR_KEY_PREFIX}.${ERROR_FALLBACK_SUFFIX}`

/** outcome → i18n 键；未登记的 outcome 不得渲染成假标签（留空 + muted） */
const OUTCOME_LABEL_KEYS = {
  created: 'accountsPage.cloudOutcomeCreated',
  updated: 'accountsPage.cloudOutcomeUpdated',
  unchanged: 'accountsPage.cloudOutcomeUnchanged',
  restored: 'accountsPage.cloudOutcomeRestored',
  'skipped-tombstone': 'accountsPage.cloudOutcomeSkippedTombstone',
  'conflict-resolved-local': 'accountsPage.cloudOutcomeConflictLocal',
  'conflict-resolved-cloud': 'accountsPage.cloudOutcomeConflictCloud',
  'invalid-credential': 'accountsPage.cloudOutcomeInvalidCredential',
  'uid-unavailable': 'accountsPage.cloudOutcomeUidUnavailable',
  failed: 'accountsPage.cloudOutcomeFailed',
}

const OUTCOME_CLASS = {
  created: 'is-success',
  updated: 'is-success',
  restored: 'is-success',
  unchanged: 'is-muted',
  'skipped-tombstone': 'is-muted',
  'uid-unavailable': 'is-muted',
  'conflict-resolved-local': 'is-warning',
  'conflict-resolved-cloud': 'is-warning',
  'invalid-credential': 'is-danger',
  failed: 'is-danger',
}

// PRD §7.5 原写作 accountsPage.cloudSync.err.<code>，但 vue-i18n 只按对象路径解析，
// 'cloudSync' 不能同时是按钮文案叶子与 err 的父对象；实际落为 cloudSyncErr.<分组名>
// （沿用同命名空间 accountCheckStatus 的错误码表先例）。
/** 一码一文案的既有专有条目（含义彼此不同，不宜并组） */
const ERROR_CODE_KEYS = {
  UNAUTHORIZED: 'unauthorized',
  BUSINESS_USER_REPOSITORY_NOT_CONFIGURED: 'serviceUnavailable',
  // 同一族：服务端未接业务库 / 缺业务身份，都是「服务端没准备好」而非用户数据有问题
  BUSINESS_USER_REQUIRED: 'serviceUnavailable',
  KMS_UNAVAILABLE: 'kmsUnavailable',
  // 同一族：KMS 配置非法与随机源不可用，均在加密阶段失败，未上传任何凭证
  KMS_CONFIG_INVALID: 'kmsUnavailable',
  CRYPTO_RANDOM_INVALID: 'kmsUnavailable',
  CREDENTIAL_TOO_LARGE: 'credentialTooLarge',
  SYNC_BUDGET_EXCEEDED: 'budgetExceeded',
  CLOUD_SYNC_IN_PROGRESS: 'inProgress',
}

/** 语义分组：组名即 locale 后缀；未列出的码走 ERROR_FALLBACK_SUFFIX */
const ERROR_CODE_GROUPS = {
  invalidData: [
    'ACCOUNT_FIELD_NOT_ALLOWED',
    'ACCOUNT_PLATFORM_UNSUPPORTED',
    'ACCOUNT_UID_INVALID',
    'ACCOUNT_NAME_NOISE',
    'ACCOUNT_AVATAR_INVALID',
    'ACCOUNT_FOLLOWERS_INVALID',
    'ACCOUNT_TIMESTAMP_INVALID',
    'ACCOUNT_DEVICE_LABEL_INVALID',
    // 批次请求体本身不是数组/不是对象：对用户同样是「信息格式不正确」
    'ACCOUNT_BATCH_INVALID',
  ],
  invalidCredential: ['CREDENTIAL_SHAPE_INVALID'],
  tooMany: ['ACCOUNT_BATCH_TOO_LARGE'],
  disconnectPartial: ['CLOUD_DISCONNECT_PARTIAL', 'DISCONNECT_CONFIRMATION_REQUIRED'],
  // 显式登记「云端自己的问题」，与「未知码」同组：未知码同样走这条，见 errorKeyFor
  cloudFailed: [
    'ACCOUNT_REJECTED',
    'INTERNAL_SERVER_ERROR',
    'ROUTE_NOT_FOUND',
    'METHOD_NOT_ALLOWED',
    'CLOUD_ACCOUNTS_NOT_CONFIGURED',
  ],
}

/** 码 → 组名：由上表反向展开，避免正/反两份表漂移 */
const ERROR_GROUP_OF_CODE = Object.create(null)
for (const [group, codes] of Object.entries(ERROR_CODE_GROUPS)) {
  for (const code of codes) ERROR_GROUP_OF_CODE[code] = group
}

export function createCloudSyncResultModel ({ t, te } = {}) {
  function outcomeLabel (outcome) {
    const key = OUTCOME_LABEL_KEYS[outcome]
    return key ? t(key) : ''
  }

  function outcomeClass (outcome) {
    return OUTCOME_CLASS[outcome] || 'is-muted'
  }

  function resolveErrorSuffix (code) {
    return ERROR_CODE_KEYS[code] || ERROR_GROUP_OF_CODE[code] || ''
  }

  /** 组名 → 文案键；locale 缺键属实现错误（accounts-cloud-sync-copy.test.js 已锁两语成对存在），
   *  此时退回兜底句，而不是把键名或后端原文吐到界面上。 */
  function keyOfSuffix (suffix) {
    const key = `${ERROR_KEY_PREFIX}.${suffix}`
    return te(key) ? key : ERROR_FALLBACK_KEY
  }

  /** 逐条失败行用的码 → 文案键：任意非空码（含未登记码）都解析出一个已存在的键，绝不返回空串 */
  function errorKeyFor (code) {
    const normalized = String(code || '').trim()
    if (!normalized) return ''
    return keyOfSuffix(resolveErrorSuffix(normalized) || ERROR_FALLBACK_SUFFIX)
  }

  /**
   * 批次级失败（整批没有跑起来）用的码 → 文案键：**只认已登记的码**。
   * 未登记的码交给 accountsPage.operationFailed —— 「云端未接受该账号」是单账号口径，
   * 用在整批上会把「批次没发起成功」误导成「每条都被拒」，排障方向就歪了。
   */
  function batchErrorKeyFor (code) {
    const normalized = String(code || '').trim()
    if (!normalized) return ''
    const suffix = resolveErrorSuffix(normalized)
    return suffix ? keyOfSuffix(suffix) : ''
  }

  /**
   * 失败行的原因文案。
   *   - 带码（含未知码）→ 分组文案，永远非空；
   *   - 无码但结果为 failed → 同样给兜底句：「失败」标签孤零零一行没有解释，等于没报错；
   *   - 无码且结果本身已带语义（created/invalid-credential/…）→ 不产出该行。
   */
  function reasonFor (outcome, code) {
    const key = errorKeyFor(code)
    if (key) return t(key)
    return outcome === 'failed' ? t(ERROR_FALLBACK_KEY) : ''
  }

  return {
    ERROR_FALLBACK_KEY,
    ERROR_KEY_PREFIX,
    OUTCOME_CLASS,
    OUTCOME_LABEL_KEYS,
    batchErrorKeyFor,
    errorKeyFor,
    outcomeClass,
    outcomeLabel,
    reasonFor,
  }
}
