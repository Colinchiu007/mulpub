/**
 * 账号云镜像同步文案（PRD-CLOUD-ACCOUNT-SYNC-2026-09-27 §10.4）
 *
 * 从 locales/en.js 的 accountsPage 命名空间拆出，由装配文件 locales/en.js import 后展开回原位置，
 * 键名与拆出前完全一致。zh/en 必须成对修改：check-locale-sync.js --pair-base 已把
 * locales/ 目录下每个 zh.js 与同名目录的 en.js 配成一个成对口径。
 */
export default {
  // ─── 账号云镜像同步（PRD-CLOUD-ACCOUNT-SYNC-2026-09-27 §10.4，与 zh.js 行序一致）───
  // 错误文案键落位说明见 zh.js 同段注释：flat 点分键不会被 vue-i18n 命中，故为 cloudSyncErr.<group>。
  cloudSync: 'Sync to Cloud',
  cloudSyncBusy: 'Syncing…',
  cloudSyncTitle: 'Sync to Cloud',
  cloudSyncAria: 'Sync accounts to the cloud',
  cloudDigestLoading: 'Loading your cloud accounts…',
  cloudDigestTotal: '{total} accounts in the cloud',
  cloudDigestEmpty: 'No cloud accounts yet, this run uploads your first mirror',
  cloudDigestLocal: '{local} local accounts will take part',
  cloudDigestTombstone: '{count} deleted accounts will not be restored',
  cloudDigestPrivacy: 'Sign-in credentials are encrypted before upload, and all cloud data can be cleared in one click',
  cloudDigestFailed: 'Cannot load cloud account info, please check the network and retry',
  cloudDigestRetry: 'Retry',
  cloudSyncProgress: 'Syncing {done}/{total}',
  cloudSyncElapsed: 'Elapsed {seconds}s',
  cloudSyncDone: (ctx) => {
    const parts = []
    if (Number(ctx.named('created')) > 0) parts.push('added ' + ctx.named('created'))
    if (Number(ctx.named('updated')) > 0) parts.push('updated ' + ctx.named('updated'))
    if (Number(ctx.named('restored')) > 0) parts.push('restored ' + ctx.named('restored'))
    return 'Sync complete' + (parts.length ? ': ' + parts.join(', ') : '')
  },
  cloudSyncPartial: 'Sync partially complete: {ok} succeeded, {fail} failed',
  cloudSyncAllFailed: 'Sync failed: {fail} accounts were not uploaded',
  cloudOutcomeCreated: 'Uploaded',
  cloudOutcomeUpdated: 'Updated',
  cloudOutcomeUnchanged: 'Already up to date',
  cloudOutcomeRestored: 'Restored to this device',
  cloudOutcomeSkippedTombstone: 'Skipped (deleted in cloud)',
  cloudOutcomeConflictLocal: 'Conflict: kept this device sign-in',
  cloudOutcomeConflictCloud: 'Conflict: used cloud sign-in',
  cloudOutcomeInvalidCredential: 'Credential expired, sign in again',
  cloudOutcomeUidUnavailable: 'Account identity not confirmed, skipped',
  cloudOutcomeFailed: 'Failed',
  cloudSyncBackground: 'Continue in background',
  cloudSyncStop: 'Stop syncing',
  cloudSyncStopping: 'Stopping…',
  cloudSyncStopped: 'Stopped: remaining accounts were not synced',
  cloudSyncClose: 'Done',
  cloudSyncNoAccounts: 'No accounts available to sync',
  cloudSyncGateBusy: 'Login check in progress, please sync afterwards',
  cloudDisconnect: 'Disconnect cloud',
  cloudDisconnectConfirm: 'This clears all {count} account mirrors in the cloud. Local accounts and sign-in status are untouched. Continue?',
  cloudDisconnectSuccess: 'Cloud accounts cleared',
  cloudDisconnectFailed: 'Cloud not fully cleared: {deleted} deleted, {remaining} still there, please retry',
  cloudSyncErr: {
    unauthorized: 'Please sign in before syncing',
    serviceUnavailable: 'Cloud sync service is unavailable, please try again later',
    kmsUnavailable: 'Cloud encryption service is not ready, no credentials were uploaded',
    credentialTooLarge: 'The sign-in data of this account is too large to upload',
    budgetExceeded: 'Sync timed out before completing',
    inProgress: 'A sync is already in progress',
    // Grouped by user-facing meaning rather than one key per server code (see AccountCloudSyncDialog.vue)
    invalidData: 'The account details are malformed and were not uploaded',
    invalidCredential: 'The sign-in data is malformed and was not uploaded',
    tooMany: 'Too many accounts in this batch, nothing was uploaded',
    // Only for disconnect-type failures inside the sync progress list; the Disconnect button keeps cloudDisconnectFailed (with counts)
    disconnectPartial: 'The cloud was not fully cleared, please retry',
    // Fallback for any unlisted code: a failed row never shows an empty reason
    cloudFailed: 'The cloud did not accept this account, please try again later',
  },
}
